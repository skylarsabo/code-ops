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
// Plus an advisory (non-gating) when an item's `Verified-at:` sha != the repo's current HEAD.
//
// Exit: non-zero if any item is MOVED/DRIFTED/GONE/AMBIGUOUS/NO-REF (needs re-triage), unless --report-only.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, isAbsolute, join, sep, basename } from 'node:path';

const argv = process.argv.slice(2);
const reportOnly = argv.includes('--report-only');
let root = '.';
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') {
    root = argv[++i];
    if (root === undefined || root.startsWith('--')) { console.error('x --root needs a path'); process.exit(2); }
  } else if (argv[i] === '--report-only') continue;
  else files.push(argv[i]);
}
if (files.length === 0) {
  console.error('usage: revalidate-register.mjs <register.md> [...] [--root <repo>] [--report-only]');
  process.exit(2);
}
root = resolve(root);

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
  if (ids.length === 0) { console.log('  (no item IDs found — not a register, or a free-form doc)'); continue; }

  // Merge blocks by ID (an ID may recur; take the union of refs across its occurrences).
  const items = new Map();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i][1];
    const block = text.slice(ids[i].index, ids[i + 1]?.index ?? text.length);
    const cur = items.get(id) ?? { refs: [], verifiedAt: null, anchor: null };
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
        if (item.anchor && target) {
          const lineText = readLineAt(target, r.line);
          if (lineText != null) { anchorCheckable = true; if (lineText.includes(item.anchor)) anchorHit = true; }
        }
      }
      // The cited line(s) still exist but none carries the anchor → the citation drifted off its code.
      if (item.anchor && anchorCheckable && !anchorHit) {
        status = escalate(status, 'DRIFTED');
        notes.push(`anchor ${JSON.stringify(item.anchor)} not on cited line`);
      }
    }
    if (item.verifiedAt && headSha && item.verifiedAt !== 'HEAD' && item.verifiedAt !== headSha)
      notes.push(`Verified-at ${item.verifiedAt} != HEAD ${headSha} — re-confirm`); // advisory only (non-gating)
    if (status !== 'FRESH') totalStale++;
    const flag = status === 'FRESH' ? 'ok ' : '!! ';
    console.log(`  ${flag}${status.padEnd(9)} ${id}${notes.length ? '  — ' + notes.join('; ') : ''}`);
  }
}

console.log(`\n${totalItems} item(s), ${totalStale} needing re-triage.`);
if (totalStale > 0 && !reportOnly) {
  console.error('Stale or unverifiable items found — re-confirm against current code before acting on this register.');
  process.exit(1);
}
