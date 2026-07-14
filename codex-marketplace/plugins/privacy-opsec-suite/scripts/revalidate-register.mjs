#!/usr/bin/env node
// Register freshness checker for the code-ops suite.
//
//   node scripts/revalidate-register.mjs <register.md> [...more] [--root <repo>] [--report-only]
//
// WHY: registers are live backlogs (CONVENTIONS SSOT). The proven field failure is
// a register that re-lists items already fixed in code — stale findings get re-ranked
// and re-shown. This re-greps each item's cited `file:line` against the CURRENT tree
// so a skill (or CI) can drop/re-tier anything that no longer reproduces BEFORE acting
// on it. It is a FLOOR, not a proof: PRESENT means the location still exists, not that
// the original defect is still there — confirm survivors by reading them.
//
// Statuses per item:
//   FRESH      every cited file:line still exists and is in range (and, if an Anchor is given, still carries it)
//   MOVED      file exists but the cited line is now out of range (code shifted/shrank)
//   DRIFTED    the cited line still exists but no longer contains the item's `Anchor:` substring — the
//              code under the citation changed (a hallucinated or stale citation). Only checked when the
//              item carries an `Anchor:` (a verbatim substring copied from the cited line, CONVENTIONS §9/§E).
//   GONE       a cited file no longer exists anywhere in the tree (likely resolved/moved)
//   AMBIGUOUS  the literal path is gone but >1 file matches its name, or a ref escapes root — verify by hand
//   NO-REF     the item cites no file:line (can't be auto-checked — verify by hand)
// Plus advisories (non-gating): an item's `Verified-at:` sha != the repo's current HEAD, and an
// item whose `Anchor:` value is not backtick/quote-delimited (unparseable, so its DRIFTED check is skipped).
//
// Exit: non-zero if any item is MOVED/DRIFTED/GONE/AMBIGUOUS/NO-REF (needs re-triage), unless --report-only.
//
// STRICT MODE (opt-in; default behavior above is unchanged without these flags):
//   --strict --profile <finding|finding-rigor|leak|research|idea>
//     A fail-closed SCHEMA gate for the register's labeled per-item fields (weak-model floor:
//     an executing model that omits Tier/Disconfirmation/Proof no longer passes silently).
//     Per profile, each item block must carry the mandatory `Field:` labels with non-empty
//     values; under `finding-rigor`, a Tier CONFIRMED item must also carry a Proof: that
//     RESOLVES — a cited file that exists in the tree, a backticked runnable command, or a
//     backtick/quoted test name found by grep — else the report says "attach a resolvable
//     proof or downgrade to PROBABLE" and the run fails. A register file that carries schema
//     labels but zero parseable item IDs fails under strict (a mangled register otherwise
//     vacates every per-item gate); a file with no labels at all passes with an explicit
//     "(empty register)" notice. Severity floor: an item citing a sensitive path (auth/
//     session/token/secret/crypto/migration/deletion/payment) or a security/privacy Lens
//     whose Severity sits below high must carry a `Panel-exempt: <reason>` line.
//   --refutation-log <REFUTATION_LOG.md>   (strict, finding/finding-rigor profiles)
//     Validates panel receipts: a critical/high item not proven by an executed repro needs
//     >=1 log line for its ID; a critical item needs an odd panel of >=3; a REFUTED line must
//     carry file:line + a delimited anchor that still greps on the cited line; majority-
//     REFUTED items must appear only as SPECULATIVE.
//   --consumed <pre-run-register.md>
//     Terminal-state gate for consuming skills: every ID present before the run must still
//     exist after it, and a closure claim must use one of the pinned terminal forms —
//     `closed-with-proof <ref>`, `deferred-with-reason <reason>`, `OBSOLETE-AT <sha>`.
//   --dispatch-ledger <DISPATCH_LEDGER.md>
//     Advisory-only check (never affects the exit code): flags rows still `dispatched` — a
//     dangling row means the operative may have died or hung and the unit should be
//     re-dispatched or marked failed before resuming. Row grammar (CONVENTIONS §12/§10/§11):
//     `| D-NNN | role | brief | expected artifact | status |`, status one of
//     `dispatched | reported | failed | redispatched`.
// An Anchor of `<REDACTED-LINE>` skips the DRIFTED comparison (line-existence only, advisory)
// so the anchor rule never forces a secret substring into the register.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, isAbsolute, join, sep, basename } from 'node:path';

const argv = process.argv.slice(2);
const reportOnly = argv.includes('--report-only');
const strict = argv.includes('--strict');
let root = '.';
let profile = null;
let refutationLogPath = null;
let consumedPath = null;
let ledgerPath = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') {
    root = argv[++i];
    if (root === undefined || root.startsWith('--')) { console.error('x --root needs a path'); process.exit(2); }
  } else if (argv[i] === '--profile') {
    profile = argv[++i];
    if (!['finding', 'finding-rigor', 'leak', 'research', 'idea'].includes(profile ?? '')) { console.error('x --profile needs one of: finding, finding-rigor, leak, research, idea'); process.exit(2); }
  } else if (argv[i] === '--refutation-log') {
    refutationLogPath = argv[++i];
    if (!refutationLogPath || refutationLogPath.startsWith('--')) { console.error('x --refutation-log needs a path'); process.exit(2); }
  } else if (argv[i] === '--consumed') {
    consumedPath = argv[++i];
    if (!consumedPath || consumedPath.startsWith('--')) { console.error('x --consumed needs a path'); process.exit(2); }
  } else if (argv[i] === '--dispatch-ledger') {
    ledgerPath = argv[++i];
    if (!ledgerPath || ledgerPath.startsWith('--')) { console.error('x --dispatch-ledger needs a path'); process.exit(2); }
  } else if (argv[i] === '--report-only' || argv[i] === '--strict') continue;
  else files.push(argv[i]);
}
if (files.length === 0 && !ledgerPath) {
  console.error('usage: revalidate-register.mjs <register.md> [...] [--root <repo>] [--report-only] [--strict --profile <type>] [--refutation-log <log>] [--consumed <pre-run register>] [--dispatch-ledger <DISPATCH_LEDGER.md>]');
  process.exit(2);
}
if (strict && !profile) { console.error('x --strict needs --profile <finding|finding-rigor|leak|research|idea>'); process.exit(2); }
root = resolve(root);

// Strict-mode schema profiles: the labeled fields every item block must carry, per register type.
const PROFILES = {
  finding: ['Tier', 'Location', 'Anchor', 'Verified-at', 'Disconfirmation', 'Refutation', 'Track'],
  'finding-rigor': ['Tier', 'Location', 'Anchor', 'Verified-at', 'Disconfirmation', 'Refutation', 'Track', 'Proof'],
  leak: ['Tier', 'Location', 'Anchor', 'Verified-at', 'Disconfirmation', 'Adversary', 'Leak-class', 'Track'],
  research: ['Tier', 'Verified-at'],
  idea: ['Evidence', 'Verified-at'],
};
const SENSITIVE_PATH_RE = /auth|authz|session|token|secret|credential|crypt|migrat|delet|payment/i;
const SCHEMA_LABEL_RE = /^\s*[-|*·]*\s*\**(Tier|Location|Leak-class|Anchor|Track|Adversary|Proof)\**\s*:/im;
const hasField = (block, field) => new RegExp(`\\b${field}\\s*:\\s*\\S`, 'i').test(block);

let headSha = null;
try { headSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git repo */ }

// Item IDs like BUG-007, PERF-003. Skip common standards/identifiers (RFC-2616, CVE-2021-44228,
// ISO-8601, UTF-8, SHA-256) that legitimately appear in a finding's prose.
const ID_RE = /\b([A-Z][A-Z0-9]{1,}-\d{1,6})\b/g;
const ID_IGNORE = new Set(['RFC', 'ISO', 'CVE', 'CWE', 'CAPEC', 'GHSA', 'UTF', 'SHA', 'MD', 'AES', 'RGB', 'HTTP', 'HTTPS', 'IEEE', 'ANSI', 'FIPS', 'NIST', 'PEP', 'ECMA', 'UTC', 'GMT', 'IPV']);
// file:line where the filename ends in a known code/doc extension — prevents matching version
// strings (v1.2.3:4), host:port (h.io:8080) and IP:port (1.1.1.1:53) as references. The
// directory part is matched segment-by-segment so the path quantifiers cannot overlap (no ReDoS).
const REF_RE = /\b((?:[\w.-]+\/)*[\w.-]+\.(?:mjs|cjs|js|tsx?|jsx|json|md|markdown|txt|ya?ml|toml|sh|py|rb|go|rs|java|cpp|cc|css|html?)):(\d+)\b/gi;
const VERIFIED_RE = /Verified-at:\s*([0-9a-f]{7,40}|HEAD)\b/i;
// An optional per-item `Anchor:` — a verbatim substring of the cited line (CONVENTIONS §9/§E), delimited
// by backticks or quotes so it can contain spaces/punctuation. When present, the cited line must still
// contain it or the item is DRIFTED. Absent → the item is checked exactly as before (backward-compatible).
// An `Anchor:` label whose value has no delimiter cannot be parsed — that earns a per-item advisory in
// the report below, never a silent fall-back to plain line-existence checking.
const ANCHOR_RE = /Anchor:\s*(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)')/i;

function isItemId(id, after, afterNext) {
  if (ID_IGNORE.has(id.split('-')[0].toUpperCase())) return false;
  // SCR-015: only a digit after the trailing '-' marks a longer numeric token (CVE-2021-44228);
  // a slug suffix (BUG-042-auth-bypass) is still a real item ID.
  if (after === '-' && /\d/.test(afterNext || '')) return false;
  return true;
}

function lineCount(absPath) {
  try {
    const t = readFileSync(absPath, 'utf8');
    if (t.length === 0) return 0;
    const nl = (t.match(/\n/g) || []).length;
    return t.endsWith('\n') ? nl : nl + 1; // a trailing newline does not add a line
  } catch { return -1; }
}

// Read a single 1-indexed line's text (for the optional Anchor check); null if unreadable/out of range.
function readLineAt(absPath, lineNo) {
  try {
    const line = readFileSync(absPath, 'utf8').split('\n')[lineNo - 1];
    return line ?? null;
  } catch { return null; }
}

// Walk the repo once (excluding .git/node_modules) so a bare-filename ref (cited without its
// directory) can be resolved to its real location instead of being falsely reported GONE.
let fileIndex = null;
function indexFiles() {
  if (fileIndex) return fileIndex;
  fileIndex = [];
  const walk = (dir, depth) => {
    if (depth > 16) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile()) fileIndex.push(full);
    }
  };
  walk(root, 0);
  return fileIndex;
}
function findByName(refPath) {
  const norm = refPath.replace(/\\/g, '/').replace(/^\.?\//, '');
  const idx = indexFiles().map((f) => ({ full: f, slash: f.replace(/\\/g, '/') }));
  const bySuffix = idx.filter((f) => f.slash.endsWith('/' + norm)).map((f) => f.full);
  if (bySuffix.length) return bySuffix;
  const base = basename(norm);
  return idx.filter((f) => basename(f.slash) === base).map((f) => f.full);
}

// A Proof: value RESOLVES if it names something checkable on the current tree: a cited
// file that exists under root, a backticked runnable command (contains a space), or a
// backtick/quoted test name that greps in the tree (test-ish files first, then the rest).
function proofResolves(value) {
  for (const m of value.matchAll(REF_RE)) {
    const abs = resolve(root, m[1]);
    if ((abs === root || abs.startsWith(root + sep)) && existsSync(abs)) return true;
  }
  for (const m of value.matchAll(/`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'/g)) {
    const tok = m[1] ?? m[2] ?? m[3];
    if (!tok) continue;
    if (/\s/.test(tok.trim()) && m[1]) return true; // backticked multi-word = runnable command
    const abs = resolve(root, tok);
    if ((abs === root || abs.startsWith(root + sep)) && existsSync(abs)) return true;
    const all = indexFiles();
    const testish = all.filter((f) => /test|spec/i.test(f));
    for (const set of [testish, all]) {
      for (const f of set) {
        try { if (statSync(f).size < 524288 && readFileSync(f, 'utf8').includes(tok)) return true; } catch { /* unreadable */ }
      }
      // fall through: token not found in test-ish files — the full tree is a genuine fallback
    }
  }
  return false;
}

// Refutation log: one verdict per line, keyed by the finding's own ID (e.g.
// "BUG-007 · r2 · REFUTED · reviewer · src/api/limits.ts:88 · Anchor: `clamp(size, MAX)`").
let refutationLog = null;
if (refutationLogPath) {
  const p = isAbsolute(refutationLogPath) ? refutationLogPath : resolve(refutationLogPath);
  if (!existsSync(p)) { console.error(`x refutation log not found: ${refutationLogPath}`); process.exit(2); }
  refutationLog = new Map();
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = [...line.matchAll(ID_RE)].filter((x) => isItemId(x[1], line[x.index + x[0].length], line[x.index + x[0].length + 1]))[0];
    if (!m || !/\b(REFUTED|SURVIVED)\b/.test(line)) continue;
    if (!refutationLog.has(m[1])) refutationLog.set(m[1], []);
    refutationLog.get(m[1]).push(line);
  }
}

let totalStale = 0;
let totalItems = 0;
// SCR-014: explicit status precedence so a later MOVED cannot clobber an earlier AMBIGUOUS.
const RANK = { FRESH: 0, MOVED: 1, DRIFTED: 2, AMBIGUOUS: 3, GONE: 4 };
const escalate = (cur, next) => (RANK[next] > RANK[cur] ? next : cur);

for (const file of files) {
  const regPath = isAbsolute(file) ? file : resolve(file);
  if (!existsSync(regPath)) { console.error(`x register not found: ${file}`); totalStale++; continue; }
  const text = readFileSync(regPath, 'utf8');
  const ids = [...text.matchAll(ID_RE)].filter((m) => isItemId(m[1], text[m.index + m[0].length], text[m.index + m[0].length + 1]));
  console.log(`\n# ${file}${headSha ? `  (HEAD ${headSha})` : ''}`);
  if (ids.length === 0) {
    // Under strict, a file carrying schema labels but no parseable IDs is a mangled register —
    // exiting 0 here would silently vacate every per-item gate (the verified fail-open).
    if (strict && SCHEMA_LABEL_RE.test(text)) {
      console.log('  !! schema labels present but zero parseable item IDs — mangled register (strict)');
      totalStale++;
    } else {
      console.log(strict ? '  (empty register — no items, no schema labels)' : '  (no item IDs found — not a register, or a free-form doc)');
    }
    // Do NOT skip the --consumed gate: an updated register with every item vanished is the
    // worst case the gate exists for, not an exemption from it.
    if (!consumedPath) continue;
  }

  // Merge blocks by ID (an ID may recur; take the union of refs across its occurrences).
  const items = new Map();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i][1];
    const block = text.slice(ids[i].index, ids[i + 1]?.index ?? text.length);
    const cur = items.get(id) ?? { refs: [], verifiedAt: null, anchor: null, anchorUnparsed: false, block: '' };
    cur.block += block;
    for (const m of block.matchAll(REF_RE)) {
      // SEC-004 (fix): REF_RE's leading \b drops a path-traversal/absolute prefix (../, ./, /),
      // which would silently re-root an escaping citation inside the repo and report it FRESH.
      // Restore the prefix so the confinement check below classifies it AMBIGUOUS instead.
      const esc = block.slice(0, m.index).match(/(?:\.{0,2}\/)+$/);
      cur.refs.push({ path: (esc ? esc[0] : '') + m[1], line: Number(m[2]) });
    }
    const v = block.match(VERIFIED_RE);
    if (v && !cur.verifiedAt) cur.verifiedAt = v[1];
    const a = block.match(ANCHOR_RE);
    if (a && !cur.anchor) cur.anchor = a[1] ?? a[2] ?? a[3];
    if (!a && /\bAnchor:/i.test(block)) cur.anchorUnparsed = true; // labeled but undelimited — unparseable
    items.set(id, cur);
  }

  for (const [id, item] of items) {
    totalItems++;
    let status = 'FRESH';
    const notes = [];
    // Anchor check (only when the item carries one): the anchor must appear on at least one of the
    // item's still-in-range cited lines, else the citation has DRIFTED off the code it named.
    let anchorCheckable = false, anchorHit = false;
    if (item.refs.length === 0) {
      status = 'NO-REF';
    } else {
      for (const r of item.refs) {
        const abs = resolve(root, r.path);
        if (abs !== root && !abs.startsWith(root + sep)) { // SEC-004: refuse to stat paths escaping root
          status = escalate(status, 'AMBIGUOUS');
          notes.push(`${r.path} escapes root — not checked`);
          continue;
        }
        let target = null; // the resolved file whose cited line we can anchor-check (null if line is out of range)
        if (existsSync(abs) && statSync(abs).isFile()) {
          const lc = lineCount(abs);
          if (lc >= 0 && r.line > lc) { status = escalate(status, 'MOVED'); notes.push(`${r.path}:${r.line} > ${lc} lines`); }
          else target = abs;
        } else {
          // BUG-008: literal path missing — resolve by name before declaring GONE
          const found = findByName(r.path);
          if (found.length === 1) {
            const lc = lineCount(found[0]);
            if (lc >= 0 && r.line > lc) { status = escalate(status, 'MOVED'); notes.push(`${r.path} (as ${found[0].slice(root.length + 1)}):${r.line} > ${lc} lines`); }
            else target = found[0];
          } else if (found.length > 1) {
            status = escalate(status, 'AMBIGUOUS');
            notes.push(`${r.path}: ${found.length} files match by name — verify by hand`);
          } else {
            status = escalate(status, 'GONE'); notes.push(`${r.path} missing`);
          }
        }
        if (item.anchor && item.anchor !== '<REDACTED-LINE>' && target) {
          const lineText = readLineAt(target, r.line);
          if (lineText != null) { anchorCheckable = true; if (lineText.includes(item.anchor)) anchorHit = true; }
        }
      }
      // The cited line(s) still exist but none carries the anchor → the citation drifted off its code.
      if (item.anchor && item.anchor !== '<REDACTED-LINE>' && anchorCheckable && !anchorHit) {
        status = escalate(status, 'DRIFTED');
        notes.push(`anchor ${JSON.stringify(item.anchor)} not on cited line`);
      }
      // A secret-bearing line may not put any part of its value in the register: `<REDACTED-LINE>`
      // downgrades this item's anchor gate to line-existence only, and says so (advisory).
      if (item.anchor === '<REDACTED-LINE>')
        notes.push('redacted anchor — line-existence check only');
    }
    // Advisory: an `Anchor:` whose value is not backtick/quote-delimited is invisible to ANCHOR_RE —
    // say so instead of silently degrading the DRIFTED gate to plain line-existence checking.
    if (item.anchorUnparsed && !item.anchor)
      notes.push('Anchor present but not backtick/quote-delimited — unparseable, DRIFTED check skipped');
    if (item.verifiedAt && headSha && item.verifiedAt !== 'HEAD' && item.verifiedAt !== headSha)
      notes.push(`Verified-at ${item.verifiedAt} != HEAD ${headSha} — re-confirm`); // advisory only (non-gating)

    // ---- strict-mode schema + proof + severity-floor + refutation legs (opt-in) ----
    let schemaFail = false;
    if (strict) {
      const required = PROFILES[profile].filter((f) => !(profile === 'research' && (f === 'Anchor' || f === 'Location') && item.refs.length === 0));
      const missing = required.filter((f) => !hasField(item.block, f));
      if (missing.length) { schemaFail = true; notes.push(`missing field(s): ${missing.join(', ')} (strict/${profile})`); }
      const confirmed = /\bTier\b[^\n]*\bCONFIRMED\b/i.test(item.block);
      if (confirmed && profile === 'finding-rigor') {
        const proofLine = item.block.match(/\bProof\s*:\s*([^\n]+)/i);
        if (!proofLine || !proofResolves(proofLine[1])) {
          schemaFail = true;
          notes.push('CONFIRMED without a resolvable Proof — attach a resolvable proof or downgrade to PROBABLE');
        }
      }
      // Severity floor: sensitive path or security/privacy lens at sub-high severity needs an
      // explicit Panel-exempt justification — deflation may not silently dodge the panel.
      if (profile !== 'research' && profile !== 'idea') {
        const sensitive = item.refs.some((r) => SENSITIVE_PATH_RE.test(r.path)) || /\bLens\b[^\n]*(security|privacy)/i.test(item.block);
        const subHigh = /\bSeverity\b[^\n]*\b(low|medium|nit)\b/i.test(item.block);
        if (sensitive && subHigh && !hasField(item.block, 'Panel-exempt')) {
          schemaFail = true;
          notes.push('sensitive-path finding below high severity without Panel-exempt: <reason> — deflation may not dodge the panel');
        }
      }
      // Refutation receipts: a load-bearing item not proven by an executed repro needs panel lines.
      if (refutationLog && (profile === 'finding' || profile === 'finding-rigor')) {
        const loadBearing = /\bSeverity\b[^\n]*\b(critical|high)\b/i.test(item.block);
        const repro = /\bTier\b[^\n]*\bCONFIRMED\b/i.test(item.block) && hasField(item.block, 'Proof');
        if (loadBearing && !repro) {
          const lines = refutationLog.get(id) ?? [];
          const critical = /\bSeverity\b[^\n]*\bcritical\b/i.test(item.block);
          if (lines.length === 0) { schemaFail = true; notes.push('critical/high item with no refutation-log line (strict)'); }
          else if (critical && (lines.length < 3 || lines.length % 2 === 0)) { schemaFail = true; notes.push(`critical item needs an odd panel of >=3 (log has ${lines.length})`); }
          else {
            const refuted = lines.filter((l) => /\bREFUTED\b/.test(l));
            for (const l of refuted) {
              const ref = l.match(REF_RE);
              const anc = l.match(ANCHOR_RE);
              const val = anc && (anc[1] ?? anc[2] ?? anc[3]);
              const abs = ref && resolve(root, ref[1]);
              const ok = ref && val && abs && (abs === root || abs.startsWith(root + sep)) && (readLineAt(abs, Number(ref[2])) ?? '').includes(val);
              if (!ok) { schemaFail = true; notes.push('REFUTED verdict without a re-greppable file:line + anchor for the killing guard'); break; }
            }
            if (refuted.length > lines.length / 2 && !/\bTier\b[^\n]*\bSPECULATIVE\b/i.test(item.block)) {
              schemaFail = true;
              notes.push(`majority-REFUTED (${refuted.length}/${lines.length}) but item is not SPECULATIVE — drop or downgrade`);
            }
          }
        }
      }
    }

    if (status !== 'FRESH' || schemaFail) totalStale++;
    const flag = status === 'FRESH' && !schemaFail ? 'ok ' : '!! ';
    console.log(`  ${flag}${(schemaFail && status === 'FRESH' ? 'SCHEMA' : status).padEnd(9)} ${id}${notes.length ? '  — ' + notes.join('; ') : ''}`);
  }

  // ---- --consumed: terminal-state gate for register-consuming skills -------------
  if (consumedPath) {
    const prePath = isAbsolute(consumedPath) ? consumedPath : resolve(consumedPath);
    if (!existsSync(prePath)) { console.error(`x pre-run register not found: ${consumedPath}`); totalStale++; }
    else {
      const preText = readFileSync(prePath, 'utf8');
      const preIds = new Set([...preText.matchAll(ID_RE)].filter((m) => isItemId(m[1], preText[m.index + m[0].length], preText[m.index + m[0].length + 1])).map((m) => m[1]));
      const TERMINAL_RE = /closed-with-proof\s+\S|deferred-with-reason\s+\S|OBSOLETE-AT\s+[0-9a-f]{7,40}/i;
      // A closure CLAIM is a status-position token (start of a line/cell, optionally behind a
      // Status/Resolution/Track/State label or the item heading dash) — free prose like
      // 'not yet resolved' or 'the deferred discussion' must not demand a terminal form.
      const CLAIM_RE = /(?:^|\n)\s*(?:[|>*-]\s*)*(?:\*\*)?(?:status|resolution|track|state)?(?:\*\*)?\s*[:\u2014-]?\s*(closed|resolved|deferred|obsoleted?)\b|\u00b7[^\n]{0,40}\u2014\s*(closed|resolved|deferred|obsoleted?)\b/i;
      for (const id of preIds) {
        if (!items.has(id)) { totalStale++; console.log(`  !! VANISHED  ${id}  — present before the run, absent after; a consumed item must end in a pinned terminal state, never disappear`); continue; }
        const blk = items.get(id).block;
        if (CLAIM_RE.test(blk) && !TERMINAL_RE.test(blk)) {
          totalStale++;
          console.log(`  !! UNTERMED  ${id}  — closure claim without a pinned terminal form (closed-with-proof <ref> | deferred-with-reason <reason> | OBSOLETE-AT <sha>)`);
        }
      }
    }
  }
}

// ---- --dispatch-ledger: dangling-dispatch advisory (never gates the exit code) --------
if (ledgerPath) {
  const ledgerAbs = isAbsolute(ledgerPath) ? ledgerPath : resolve(ledgerPath);
  if (!existsSync(ledgerAbs)) {
    console.log(`\n  advisory: ${ledgerPath}: dispatch ledger not found — nothing to check`);
  } else {
    const rows = readFileSync(ledgerAbs, 'utf8').split('\n')
      .map((l) => /^\|\s*(D-\d+)\s*\|.*\|\s*(dispatched|reported|failed|redispatched)\s*\|\s*$/.exec(l))
      .filter(Boolean);
    const dangling = rows.filter((m) => m[2] === 'dispatched');
    if (rows.length === 0) console.log(`\n  advisory: ${ledgerPath}: no parseable ledger rows`);
    for (const m of dangling)
      console.log(`  advisory: ${ledgerPath}: ${m[1]} still 'dispatched' — operative may have died or hung; re-dispatch or mark failed before resuming`);
  }
}

console.log(`\n${totalItems} item(s), ${totalStale} needing re-triage.`);
if (totalStale > 0 && !reportOnly) {
  console.error('Stale or unverifiable items found — re-confirm against current code before acting on this register.');
  process.exit(1);
}
