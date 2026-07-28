#!/usr/bin/env node
// Deterministic calibration-metrics extractor + sanitized-note validator for the suite's
// real-scale calibration channel (evals/README.md "Real-scale calibrations run against a
// private mirror repo ... that channel is one-way — only a sanitized calibration note ...
// crosses back into this repo").
//
//   node scripts/calibration-metrics.mjs --artifacts <dir> [--out <file>]
//   node scripts/calibration-metrics.mjs --validate-note <file>
//
// MODE 1 (--artifacts): reads a run's artifact directory and emits a compact metrics block —
// dispatch-ledger row grammar (scripts/dispatch-ledger.mjs), findings-register Tier/Severity
// fields (scripts/revalidate-register.mjs's schema), refutation-log receipt verdicts, and a
// per-artifact non-blank line count flagged against scan-narration.mjs's length-discipline
// thresholds (CONVENTIONS §12: advisory once a run summary drifts past a page, hard once it's
// clearly a transcript). Each of the three named artifacts is OPTIONAL — its absence is
// reported as "not present", never an error — and a malformed row/item/line is counted and
// reported as "unparseable: N", never silently skipped (the same skip-noting convention the
// referenced scripts use). This mode always exits 0: it reports a run's shape, it does not
// gate it.
//
// MODE 2 (--validate-note): a structural scrub gate for a sanitized calibration note before it
// crosses the one-way channel back into this repo. Fails CLOSED (exit 1) on any hit of: an
// absolute or relative file path (Windows drive-letter, or unix-style with 2+ slash-separated
// segments), a fenced code block, a URL, or an email-like token — each reported with its line
// number and category. The suite's own standard artifact filenames and backticked
// `plugin:skill` slug references are allowlisted first (they are public vocabulary, not a
// leak) so a clean note that legitimately names them never trips the gate.
//
// Exit: mode 1 -> always 0 (advisory report). Mode 2 -> 0 clean, 1 on any structural hit
// (fail-closed) unless --report-only, 2 on a usage error (no mode flag, unknown flag, a
// missing --validate-note target).

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

function usage() {
  console.error('usage: calibration-metrics.mjs --artifacts <dir> [--out <file>]');
  console.error('       calibration-metrics.mjs --validate-note <file> [--report-only]');
  process.exit(2);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// -------------------------------------------------------------------------------------
// MODE 1: metrics
// -------------------------------------------------------------------------------------

const LEDGER_ROW_RE = /^\|\s*(D-\d+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/;
const LEDGER_STATUSES = ['dispatched', 'reported', 'failed', 'redispatched'];

// Row grammar per scripts/dispatch-ledger.mjs: | D-NNN | role | brief | expected artifact | status |.
// A row whose shape doesn't match, or whose status isn't one of the four known values, is
// unparseable — counted, never dropped silently.
function summarizeLedger(text) {
  const rows = [];
  let malformed = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line.startsWith('|')) continue;
    if (/^\|\s*id\s*\|/i.test(line)) continue; // header
    if (/^\|(\s*:?-+:?\s*\|)+$/.test(line)) continue; // rule row
    const m = LEDGER_ROW_RE.exec(line);
    if (!m) { malformed++; continue; }
    const [, id, role, brief, artifact, status] = m;
    if (!LEDGER_STATUSES.includes(status)) { malformed++; continue; }
    rows.push({ id, role, brief, artifact, status });
  }
  const total = rows.length;
  const byRole = {};
  const byStatus = { dispatched: 0, reported: 0, failed: 0, redispatched: 0 };
  for (const r of rows) {
    byRole[r.role] = (byRole[r.role] ?? 0) + 1;
    byStatus[r.status]++;
  }
  const pct = (n) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
  return { total, malformed, byRole, byStatus, pct };
}

// Findings-register item IDs per revalidate-register.mjs's grammar (e.g. BUG-007, PERF-003),
// ignoring common standards identifiers that legitimately appear in prose.
const ID_RE = /\b([A-Z][A-Z0-9]{1,}-\d{1,6})\b/g;
const ID_IGNORE = new Set(['RFC', 'ISO', 'CVE', 'CWE', 'CAPEC', 'GHSA', 'UTF', 'SHA', 'MD', 'AES', 'RGB', 'HTTP', 'HTTPS', 'IEEE', 'ANSI', 'FIPS', 'NIST', 'PEP', 'ECMA', 'UTC', 'GMT', 'IPV']);
const TIER_RE = /\bTier\s*:\s*([A-Za-z]+)/i;
const SEVERITY_RE = /\bSeverity\s*:\s*([A-Za-z]+)/i;
const KNOWN_TIERS = ['CONFIRMED', 'PROBABLE', 'SPECULATIVE'];

function isItemId(id, after, afterNext) {
  if (ID_IGNORE.has(id.split('-')[0].toUpperCase())) return false;
  if (after === '-' && /\d/.test(afterNext || '')) return false;
  return true;
}

// Per-item Tier (CONFIRMED/PROBABLE/SPECULATIVE) and Severity fields, per revalidate-register's
// schema (CONVENTIONS §7). An item with no Tier field, or a Tier value outside the known set,
// is unparseable — counted, never dropped silently.
function summarizeRegister(text) {
  const ids = [...text.matchAll(ID_RE)].filter((m) => isItemId(m[1], text[m.index + m[0].length], text[m.index + m[0].length + 1]));
  let malformed = 0;
  const byTier = { CONFIRMED: 0, PROBABLE: 0, SPECULATIVE: 0 };
  const bySeverity = {};
  for (let i = 0; i < ids.length; i++) {
    const block = text.slice(ids[i].index, ids[i + 1]?.index ?? text.length);
    const tm = block.match(TIER_RE);
    const tier = tm && tm[1].toUpperCase();
    if (!tier || !KNOWN_TIERS.includes(tier)) { malformed++; continue; }
    byTier[tier]++;
    const sm = block.match(SEVERITY_RE);
    if (sm) {
      const sev = sm[1].toUpperCase();
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    }
  }
  const total = ids.length - malformed;
  const pct = (n) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
  return { totalItems: ids.length, malformed, byTier, bySeverity, total, pct };
}

// Refutation-log receipt lines per revalidate-register.mjs's comment grammar: one verdict per
// line, keyed by the finding's own ID, carrying a SURVIVED|REFUTED token. A line that carries an
// item ID (so it reads as a receipt) but no recognized verdict token is unparseable — counted,
// never dropped silently. A line with no item ID at all (prose, headers) is not a receipt row.
const VERDICT_RE = /\b(SURVIVED|REFUTED)\b/;

function summarizeRefutation(text) {
  let total = 0, survived = 0, refuted = 0, malformed = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const ids = [...line.matchAll(ID_RE)].filter((m) => isItemId(m[1], line[m.index + m[0].length], line[m.index + m[0].length + 1]));
    if (ids.length === 0) continue; // not a receipt row
    const vm = line.match(VERDICT_RE);
    if (!vm) { malformed++; continue; }
    total++;
    if (vm[1] === 'SURVIVED') survived++; else refuted++;
  }
  const pct = (n) => (total ? ((n / total) * 100).toFixed(1) : '0.0');
  return { total, survived, refuted, malformed, pct };
}

// scan-narration.mjs's length-discipline bounds (CONVENTIONS §12): advisory once a run
// artifact drifts past roughly a page, hard once it reads as a transcript rather than a
// synthesis.
const ADVISORY_LINES = 60;
const HARD_LINES = 120;

function nonBlankCount(text) {
  return text.split('\n').filter((l) => l.replace(/\r$/, '').trim() !== '').length;
}

function headShaFor(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).toString().trim();
  } catch {
    return 'unknown'; // fail-open: not a git tree, or git unavailable
  }
}

function runMetrics(dir, outPath) {
  const lines = [];
  const p = (s = '') => lines.push(s);

  const readIfPresent = (name) => {
    const full = join(dir, name);
    if (!existsSync(full)) return null;
    try { return readFileSync(full, 'utf8'); }
    catch (e) { console.error(`x cannot read ${full}: ${e.message}`); return null; }
  };

  p(`# calibration-metrics — ${dir}`);

  // ---- dispatches --------------------------------------------------------------
  p('\n## Dispatches (DISPATCH_LEDGER.md)');
  const ledgerText = readIfPresent('DISPATCH_LEDGER.md');
  if (ledgerText === null) {
    p('  not present');
  } else {
    const s = summarizeLedger(ledgerText);
    p(`  ${s.total} dispatch(es), unparseable: ${s.malformed}`);
    const roleList = Object.entries(s.byRole).map(([r, n]) => `${r} ${n}`).join(', ') || '(none)';
    p(`  by role: ${roleList}`);
    const statusList = LEDGER_STATUSES.map((st) => `${st} ${s.byStatus[st]} (${s.pct(s.byStatus[st])}%)`).join(', ');
    p(`  by status: ${statusList}`);
    p(`  dangling rate: ${s.pct(s.byStatus.dispatched)}% (${s.byStatus.dispatched}/${s.total})`);
    p(`  failed rate: ${s.pct(s.byStatus.failed)}% (${s.byStatus.failed}/${s.total})`);
    p(`  redispatched rate: ${s.pct(s.byStatus.redispatched)}% (${s.byStatus.redispatched}/${s.total})`);
  }

  // ---- findings -----------------------------------------------------------------
  p('\n## Findings (FINDINGS_REGISTER.md)');
  const registerText = readIfPresent('FINDINGS_REGISTER.md');
  if (registerText === null) {
    p('  not present');
  } else {
    const s = summarizeRegister(registerText);
    p(`  ${s.total} finding(s), unparseable: ${s.malformed}`);
    const tierList = KNOWN_TIERS.map((t) => `${t} ${s.byTier[t]} (${s.pct(s.byTier[t])}%)`).join(', ');
    p(`  by tier: ${tierList}`);
    p(`  CONFIRMED ratio: ${s.pct(s.byTier.CONFIRMED)}%`);
    const sevEntries = Object.entries(s.bySeverity);
    p(`  by severity: ${sevEntries.length ? sevEntries.map(([sv, n]) => `${sv} ${n}`).join(', ') : '(none labeled)'}`);
  }

  // ---- refutations ----------------------------------------------------------------
  p('\n## Refutations (REFUTATION_LOG.md)');
  const refutationText = readIfPresent('REFUTATION_LOG.md');
  if (refutationText === null) {
    p('  not present');
  } else {
    const s = summarizeRefutation(refutationText);
    p(`  ${s.total} receipt(s), unparseable: ${s.malformed}`);
    p(`  SURVIVED ${s.survived} (${s.pct(s.survived)}%), REFUTED ${s.refuted} (${s.pct(s.refuted)}%)`);
    p(`  survival rate: ${s.pct(s.survived)}%`);
  }

  // ---- per-artifact line counts (CONVENTIONS §12 length discipline) ------------
  p(`\n## Artifact line counts (advisory ${ADVISORY_LINES} / hard ${HARD_LINES} non-blank lines, CONVENTIONS §12)`);
  let mdFiles = [];
  if (existsSync(dir)) {
    try { mdFiles = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md') && statSync(join(dir, f)).isFile()).sort(); }
    catch { mdFiles = []; }
  }
  if (mdFiles.length === 0) {
    p('  (no .md artifacts found)');
  } else {
    for (const f of mdFiles) {
      let text;
      try { text = readFileSync(join(dir, f), 'utf8'); }
      catch (e) { p(`  ${f}: unreadable (${e.message})`); continue; }
      const n = nonBlankCount(text);
      const flag = n > HARD_LINES ? '  !! HARD' : n > ADVISORY_LINES ? '  .. advisory' : '';
      p(`  ${f}: ${n} non-blank line(s)${flag}`);
    }
  }

  // ---- footer ---------------------------------------------------------------------
  p(`\n## Footer\n  HEAD: ${headShaFor(process.cwd())}`);

  const report = lines.join('\n') + '\n';
  console.log(report);
  if (outPath) {
    try { writeFileSync(outPath, report); }
    catch (e) { console.error(`x cannot write --out ${outPath}: ${e.message}`); }
  }
  process.exit(0); // this mode always reports; it never gates
}

// -------------------------------------------------------------------------------------
// MODE 2: sanitized-note validation
// -------------------------------------------------------------------------------------

// Public vocabulary, not a leak: the suite's own standard artifact filenames (CONVENTIONS
// §12 "Standard filenames" plus the calibration-channel additions this eval introduces).
const STANDARD_FILENAMES = [
  'DISPATCH_LEDGER.md', 'FINDINGS_REGISTER.md', 'EXECUTIVE_SUMMARY.md', 'REFUTATION_LOG.md',
  'RUN_RECEIPTS.md', 'REPO_MAP.md', 'IMPORT_GRAPH.md', 'CALIBRATION_NOTE.md', 'FLOOR_TABLE.md',
  'CALIBRATION_TABLE.md',
];

// Strip allowlisted tokens BEFORE running any structural detector, so neither the exact
// detector shape nor match order can let an allowlisted mention leak through as a false
// positive — the allowlist is a pre-filter, not a post-hoc exemption.
function stripAllowlisted(line) {
  let out = line;
  for (const name of STANDARD_FILENAMES) {
    out = out.replace(new RegExp('`?' + escapeRe(name) + '`?', 'g'), ' ');
  }
  // A backticked `plugin:skill` slug (lowercase, hyphenated) is public vocabulary too.
  out = out.replace(/`[a-z][a-z0-9-]*:[a-z][a-z0-9-]*`/gi, ' ');
  return out;
}

const URL_RE_G = /https?:\/\/[^\s`'")]+/gi;
const CODE_FENCE_RE = /```/;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b/;
const WINDOWS_PATH_RE = /\b[A-Za-z]:[\\/][^\s`'")]*/;
// Unix-style path: 2+ slash-separated segments (a bare filename like `DISPATCH_LEDGER.md` has
// no slash and never matches this on its own).
const UNIX_PATH_RE = /(?:\.{1,2}\/)?[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*/;

function validateNote(text) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const lineNo = i + 1;

    if (CODE_FENCE_RE.test(line)) hits.push({ line: lineNo, cat: 'CODE-FENCE', snippet: line.trim().slice(0, 90) });

    const urlMatches = [...line.matchAll(URL_RE_G)];
    if (urlMatches.length) hits.push({ line: lineNo, cat: 'URL', snippet: line.trim().slice(0, 90) });
    const withoutUrls = line.replace(URL_RE_G, ' '); // avoid double-flagging a URL's own slashes as PATH

    if (EMAIL_RE.test(withoutUrls)) hits.push({ line: lineNo, cat: 'EMAIL', snippet: line.trim().slice(0, 90) });

    const sanitized = stripAllowlisted(withoutUrls);
    if (WINDOWS_PATH_RE.test(sanitized)) hits.push({ line: lineNo, cat: 'PATH-WINDOWS', snippet: line.trim().slice(0, 90) });
    else if (UNIX_PATH_RE.test(sanitized)) hits.push({ line: lineNo, cat: 'PATH-UNIX', snippet: line.trim().slice(0, 90) });
  });
  return hits;
}

function runValidateNote(filePath, reportOnly) {
  if (!existsSync(filePath)) { console.error(`x not found: ${filePath}`); process.exit(2); }
  let text;
  try { text = readFileSync(filePath, 'utf8'); }
  catch (e) { console.error(`x cannot read ${filePath}: ${e.message}`); process.exit(2); }

  const hits = validateNote(text);
  console.log(`# calibration-note validation — ${filePath}${hits.length ? '' : '  — clean'}`);
  for (const h of hits) console.log(`  !! ${h.cat.padEnd(13)} L${h.line}  ${h.snippet}`);
  console.log(`\n${hits.length} structural hit(s).`);
  if (hits.length > 0 && !reportOnly) {
    console.error('Sanitized-note structural scrub failed (fail-closed) — remove paths/fences/URLs/emails before this note crosses the one-way calibration channel.');
    process.exit(1);
  }
}

// -------------------------------------------------------------------------------------
// dispatch
// -------------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const reportOnly = argv.includes('--report-only');
const rest = argv.filter((a) => a !== '--report-only');

if (rest[0] === '--artifacts') {
  const dirArg = rest[1];
  if (dirArg === undefined || dirArg.trim() === '' || dirArg.startsWith('--')) { console.error('x --artifacts needs a directory'); usage(); }
  let outPath = null;
  if (rest[2] === '--out') {
    outPath = rest[3];
    if (outPath === undefined || outPath.trim() === '' || outPath.startsWith('--')) { console.error('x --out needs a path'); usage(); }
  } else if (rest.length > 2) {
    console.error(`x unknown argument: ${rest[2]}`);
    usage();
  }
  runMetrics(resolve(dirArg), outPath ? resolve(outPath) : null);
} else if (rest[0] === '--validate-note') {
  const fileArg = rest[1];
  if (fileArg === undefined || fileArg.trim() === '' || fileArg.startsWith('--')) { console.error('x --validate-note needs a file'); usage(); }
  if (rest.length > 2) { console.error(`x unknown argument: ${rest[2]}`); usage(); }
  runValidateNote(resolve(fileArg), reportOnly);
} else {
  usage();
}
