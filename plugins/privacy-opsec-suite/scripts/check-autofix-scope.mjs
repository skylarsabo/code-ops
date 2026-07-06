#!/usr/bin/env node
// Auto-apply diff gate for the code-ops suite.
//
//   node scripts/check-autofix-scope.mjs (--diff <file> | --git <ref>) [--interactive]
//                                        [--level auto-safe|gated] [--root <repo>] [--require-test]
//
// WHY: the NOW-SAFE lane lets an agent auto-apply a fix without a human reading the diff first.
// NOW-SAFE is a model judgment call, and a weak model that misclassifies a behavior-changing edit
// as NOW-SAFE must be DENIED by mechanics, not trusted. Before anything is applied, this checks
// the ACTUAL diff against the always-gated categories and the NOW-SAFE shape constraints.
//
// FAIL-CLOSED DEFAULT: with no mode flags every apply is denied — headless mode is the default;
// an operator-present run opts in with `--interactive --level auto-safe`. `--level gated` also
// denies everything (gated means a human approves each batch, so nothing auto-applies).
//
// Checks (each violation reported per-item with its clause):
//   MODE          the auto-apply lane is not enabled (headless default, or --level gated)
//   DIFF          no changed files could be parsed — an empty/unparseable diff is denied, not waved through
//   DENYLIST      a changed path matches an always-gated category: auth/authn/authz/session/token/
//                 secret/credential/crypto path segments, migration dirs/files, lockfiles (*.lock,
//                 package-lock.json, yarn.lock, Cargo.lock, poetry.lock, ...), .github/workflows/**,
//                 schema files (*.sql, schema.*, *.prisma). Seeded defaults below; extendable via an
//                 optional `.autofix-scope.json` at --root (keys: extraDenyGlobs, maxLines, maxFiles).
//   SIZE          total changed lines > maxLines (default 50) or files touched > maxFiles (default 3)
//   EXPORTS       a +/- diff line (never context) touches a public surface — export / module.exports /
//                 pub fn / public class-member patterns. Best-effort by design: a false DENY only
//                 escalates to human review, so the patterns err toward matching.
//   TESTEVIDENCE  with --require-test the diff must also touch a test file (a path containing
//                 test/spec/__tests__); without the flag this check is advisory (warn only).
//
// One-directional semantics: a DENY makes an item un-auto-appliable (reclassify it NEEDS-REVIEW);
// a PASS never by itself makes something NOW-SAFE — classification still owns that judgment.
//
// Changed paths are matched as strings only — never resolved or read from disk — so a hostile
// path in a diff cannot make this script touch the filesystem. The --git ref is passed to git as
// argv tokens via execFileSync (no shell), and option-like tokens (leading '-') are rejected so a
// ref value cannot smuggle git options (mirrors scan-ai-tells's --git hardening).
//
// Exit: 0 = every check passed (the auto-apply lane is open), 1 = any DENY, 2 = usage/config error.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const usage = () => {
  console.error('usage: check-autofix-scope.mjs (--diff <file> | --git <ref>) [--interactive] [--level auto-safe|gated] [--root <repo>] [--require-test]');
  process.exit(2);
};

const argv = process.argv.slice(2);
let root = '.', diffFile = null, gitRef = null, interactive = false, level = null, requireTest = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--root') {
    root = argv[++i];
    if (root === undefined || root.startsWith('--')) { console.error('x --root needs a path'); process.exit(2); }
  } else if (a === '--diff') {
    diffFile = argv[++i];
    if (diffFile === undefined || diffFile.startsWith('--')) { console.error('x --diff needs a file'); process.exit(2); }
  } else if (a === '--git') {
    gitRef = argv[++i]; // option-like values are rejected below with a specific message, before git runs
    if (gitRef === undefined) { console.error('x --git needs a ref'); process.exit(2); }
  } else if (a === '--level') {
    level = argv[++i];
    // fail closed on a malformed gate config rather than silently treating a typo as "denied anyway"
    if (level !== 'auto-safe' && level !== 'gated') { console.error(`x --level must be auto-safe or gated (got: ${level ?? '<missing>'})`); process.exit(2); }
  } else if (a === '--interactive') interactive = true;
  else if (a === '--require-test') requireTest = true;
  else { console.error(`x unknown argument: ${a}`); usage(); }
}
if ((diffFile === null) === (gitRef === null)) usage(); // exactly one diff source
root = resolve(root);

// ---------- config: optional .autofix-scope.json at --root ----------
// Read if present. Malformed content or wrong types exit 2 — a broken gate config must never
// silently widen (or silently shrink) the gate.
const cfg = { extraDenyGlobs: [], maxLines: 50, maxFiles: 3 };
const cfgPath = join(root, '.autofix-scope.json');
if (existsSync(cfgPath)) {
  let raw;
  try { raw = JSON.parse(readFileSync(cfgPath, 'utf8')); }
  catch (e) { console.error(`x malformed .autofix-scope.json: ${e.message}`); process.exit(2); }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) { console.error('x .autofix-scope.json must be a JSON object'); process.exit(2); }
  if (raw.extraDenyGlobs !== undefined) {
    if (!Array.isArray(raw.extraDenyGlobs) || raw.extraDenyGlobs.some((g) => typeof g !== 'string' || g.length === 0)) {
      console.error('x .autofix-scope.json: extraDenyGlobs must be an array of non-empty strings'); process.exit(2);
    }
    cfg.extraDenyGlobs = raw.extraDenyGlobs;
  }
  for (const k of ['maxLines', 'maxFiles']) {
    if (raw[k] !== undefined) {
      if (typeof raw[k] !== 'number' || !Number.isFinite(raw[k]) || raw[k] < 1) { console.error(`x .autofix-scope.json: ${k} must be a positive number`); process.exit(2); }
      cfg[k] = Math.floor(raw[k]);
    }
  }
}

// ---------- diff acquisition ----------
let label, diffText;
if (diffFile !== null) {
  if (!existsSync(diffFile)) { console.error(`x diff file not found: ${diffFile}`); process.exit(2); }
  diffText = readFileSync(diffFile, 'utf8');
  label = diffFile;
} else {
  // execFileSync (no shell) — the ref is passed as argv tokens, so shell metacharacters cannot inject.
  // Also reject option-like tokens (leading '-') so a ref value cannot smuggle git options
  // (e.g. --output=<path>); a real rev never starts with '-'. A trailing '--' marks end-of-options.
  const refTokens = gitRef.split(/\s+/).filter(Boolean);
  if (refTokens.length === 0) { console.error('x --git needs a ref'); process.exit(2); }
  if (refTokens.some((t) => t.startsWith('-'))) { console.error(`x --git ref must not contain option-like tokens: ${gitRef}`); process.exit(2); }
  try { diffText = execFileSync('git', ['diff', ...refTokens, '--'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { console.error(`x git diff ${gitRef} failed: ${e.message}`); process.exit(2); }
  label = `git ${gitRef}`;
}

// ---------- unified diff parsing (best-effort, structural) ----------
// Strips 'a/'/'b/' prefixes and normalizes to forward slashes. File headers are recognized by the
// `--- old` + `+++ new` pair (so a hunk line that merely starts with '-' can't be mistaken for one),
// with the `diff --git` line as a fallback for header-less entries (binary files, pure renames).
function normDiffPath(p) {
  let s = p.replace(/^"(.*)"$/, '$1').replace(/\\/g, '/').trim();
  if (s.startsWith('a/') || s.startsWith('b/')) s = s.slice(2);
  return s.replace(/^\.\//, '');
}
function parseUnifiedDiff(text) {
  const files = [];
  const lines = text.split(/\r?\n/);
  let cur = null, inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.startsWith('diff --git ')) {
      const m = raw.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/);
      cur = { path: normDiffPath(m ? m[2] : raw.slice('diff --git '.length)), headerResolved: false, changed: [] };
      files.push(cur); inHunk = false; continue;
    }
    if (raw.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      const oldP = raw.slice(4).trim();
      const newP = lines[i + 1].slice(4).trim();
      const chosen = newP === '/dev/null' ? oldP : newP; // deletions keep the old path
      if (cur && !cur.headerResolved) { cur.path = normDiffPath(chosen); cur.headerResolved = true; }
      else { cur = { path: normDiffPath(chosen), headerResolved: true, changed: [] }; files.push(cur); } // plain `diff -u` (no diff --git line)
      i++; inHunk = false; continue;
    }
    if (raw.startsWith('@@') && cur) { inHunk = true; continue; }
    if (inHunk && cur) {
      if (raw.startsWith('+')) cur.changed.push({ sign: '+', text: raw.slice(1) });
      else if (raw.startsWith('-')) cur.changed.push({ sign: '-', text: raw.slice(1) });
      else if (raw !== '' && !raw.startsWith(' ') && !raw.startsWith('\\')) inHunk = false; // '\ No newline...' stays in-hunk
    }
  }
  return files;
}

// ---------- DENYLIST: seeded always-gated categories ----------
// Segment words are compared exactly (segments split on '/', then on non-alphanumerics), so
// `src/auth/login.mjs` and `lib/token-cache.py` hit while `authoring.md` and `tokenizer.rs` do not.
const SENSITIVE_WORDS = new Set(['auth', 'authn', 'authz', 'session', 'sessions', 'token', 'tokens', 'secret', 'secrets', 'credential', 'credentials', 'crypto']);
const MIGRATION_WORDS = new Set(['migration', 'migrations', 'migrate']);
const LOCK_BASENAMES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'bun.lockb', 'go.sum']); // *.lock (yarn.lock, Cargo.lock, poetry.lock, ...) is matched by suffix below
function seededDenyReason(p) {
  if (p.startsWith('.github/workflows/')) return 'CI workflow (.github/workflows/**)';
  for (const seg of p.split('/')) {
    for (const w of seg.toLowerCase().split(/[^a-z0-9]+/)) {
      if (SENSITIVE_WORDS.has(w)) return `'${w}' path segment (auth/session/token/secret/credential/crypto family)`;
      if (MIGRATION_WORDS.has(w)) return `'${w}' path segment (migrations)`;
    }
  }
  const base = p.split('/').pop().toLowerCase();
  if (base.endsWith('.lock') || LOCK_BASENAMES.has(base)) return 'lockfile';
  if (/\.(sql|prisma)$/.test(base) || base.startsWith('schema.')) return 'schema file (*.sql / schema.* / *.prisma)';
  return null;
}

// ---------- extraDenyGlobs matcher (no third-party glob lib) ----------
// Supported subset: '**' matches any number of whole segments, '*' matches within one segment,
// everything else is literal. A glob with no '/' matches against the basename at any depth.
function segToRe(pat) {
  return new RegExp('^' + pat.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$');
}
function globMatch(glob, path) {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  if (!g.includes('/')) return segToRe(g).test(path.split('/').pop());
  const gs = g.split('/').filter(Boolean).map((s) => (s === '**' ? '**' : segToRe(s)));
  const ps = path.split('/');
  const m = (gi, pi) => {
    if (gi === gs.length) return pi === ps.length;
    if (gs[gi] === '**') return m(gi + 1, pi) || (pi < ps.length && m(gi, pi + 1));
    return pi < ps.length && gs[gi].test(ps[pi]) && m(gi + 1, pi + 1);
  };
  return m(0, 0);
}

// ---------- EXPORTS: public-surface patterns (documented best-effort) ----------
// Applied to the CONTENT of +/- lines only — context lines and @@ hunk headers are never scanned.
// Over-matching is acceptable here (a false DENY escalates to human review); under-matching is not,
// so prose that begins a line with `public ...` or `export ...` will hit. Comments prefixed with
// // or # naturally don't match the ^-anchored forms.
const EXPORT_RES = [
  { what: 'ES export', re: /^\s*export\s+(?:default\b|(?:async\s+)?(?:function|class)\b|(?:const|let|var|interface|type|enum|abstract|declare|namespace)\b)|^\s*export\s*(?:\{|\*)/ },
  { what: 'CommonJS export', re: /\bmodule\.exports\b|(?<![.\w$])exports\.[A-Za-z_$]/ },
  { what: 'Rust pub item', re: /^\s*pub(?:\s*\((?:crate|super|self|in\s+[\w:]+)\))?\s+(?:async\s+|const\s+|unsafe\s+|extern\s+"[^"]*"\s+)*(?:fn|struct|enum|trait|mod|const|static|type|use|impl)\b/ },
  { what: 'public class member', re: /^\s*(?:(?:static|final|abstract|sealed|override|partial|export)\s+)*public\s+[A-Za-z_$@]/ },
  { what: 'Python __all__', re: /^\s*__all__\s*\+?=/ },
];

// ---------- TESTEVIDENCE path shape ----------
const TEST_PATH_RE = /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^/]+$|(^|\/)test_[^/]+$|_(test|spec)s?\.[^/.]+$/i;

// ---------- run the checks ----------
const files = parseUnifiedDiff(diffText);
const totalChanged = files.reduce((n, f) => n + f.changed.length, 0);
const laneEnabled = interactive && level === 'auto-safe';
const modeDesc = !interactive ? 'headless (default)' : level === 'auto-safe' ? 'interactive / auto-safe' : level === 'gated' ? 'interactive / gated' : 'interactive (no --level)';

console.log(`# autofix scope gate — ${label}`);
console.log(`  mode: ${modeDesc}   files: ${files.length}   changed lines: ${totalChanged}   limits: ${cfg.maxFiles} files / ${cfg.maxLines} lines${cfg.extraDenyGlobs.length ? `   extraDenyGlobs: ${cfg.extraDenyGlobs.length}` : ''}\n`);

let denies = 0;
const CAP = 20; // per-check item cap so a huge diff can't flood the report
const line = (flag, clause, msg) => console.log(`  ${flag} ${clause.padEnd(13)}${msg}`);
const deny = (clause, msg) => { denies++; line('!!', clause, msg); };

// MODE — the lane must be explicitly enabled; everything else about the diff is subordinate to this.
if (laneEnabled) line('ok', 'MODE', 'auto-apply lane enabled (--interactive --level auto-safe)');
else if (interactive && level === 'gated') deny('MODE', 'level gated — a human approves each batch; nothing auto-applies');
else deny('MODE', 'headless mode is the default; an operator-present run opts in with --interactive --level auto-safe');

// DIFF — an empty/unparseable diff is denied, not waved through.
if (files.length === 0) deny('DIFF', 'no changed files parsed from the diff (empty or unparseable) — fail closed');

// DENYLIST — per changed path, seeded categories first, then config extras.
const denylistHits = [];
for (const f of files) {
  const why = seededDenyReason(f.path);
  if (why) { denylistHits.push({ path: f.path, why }); continue; }
  const g = cfg.extraDenyGlobs.find((gl) => globMatch(gl, f.path));
  if (g) denylistHits.push({ path: f.path, why: `matches extraDenyGlobs '${g}' (.autofix-scope.json)` });
}
if (denylistHits.length === 0) line('ok', 'DENYLIST', `no changed path matches an always-gated category (${files.length} path(s) checked)`);
for (const h of denylistHits.slice(0, CAP)) deny('DENYLIST', `${h.path} — ${h.why}`);
if (denylistHits.length > CAP) { denies += denylistHits.length - CAP; line('!!', 'DENYLIST', `... and ${denylistHits.length - CAP} more`); }

// SIZE — a NOW-SAFE fix is small by definition.
if (totalChanged > cfg.maxLines) deny('SIZE', `${totalChanged} changed line(s) > maxLines ${cfg.maxLines}`);
else if (files.length > cfg.maxFiles) deny('SIZE', `${files.length} file(s) touched > maxFiles ${cfg.maxFiles}`);
else line('ok', 'SIZE', `${totalChanged} changed line(s) <= ${cfg.maxLines}, ${files.length} file(s) <= ${cfg.maxFiles}`);

// EXPORTS — any +/- line that touches a public surface.
const exportHits = [];
for (const f of files) {
  for (const c of f.changed) {
    const hit = EXPORT_RES.find((r) => r.re.test(c.text));
    if (hit) exportHits.push({ path: f.path, sign: c.sign, text: c.text.trim().slice(0, 70), what: hit.what });
  }
}
if (exportHits.length === 0) line('ok', 'EXPORTS', 'no +/- line touches an export/public surface');
for (const h of exportHits.slice(0, CAP)) deny('EXPORTS', `${h.path} — ${h.sign}${h.text}  (${h.what})`);
if (exportHits.length > CAP) { denies += exportHits.length - CAP; line('!!', 'EXPORTS', `... and ${exportHits.length - CAP} more`); }

// TESTEVIDENCE — gating only under --require-test; advisory otherwise.
const testFiles = files.filter((f) => TEST_PATH_RE.test(f.path)).map((f) => f.path);
if (testFiles.length > 0) line('ok', 'TESTEVIDENCE', `test file touched: ${testFiles[0]}${testFiles.length > 1 ? ` (+${testFiles.length - 1} more)` : ''}`);
else if (requireTest) deny('TESTEVIDENCE', 'no changed path looks like a test (test/spec/__tests__) — required by --require-test');
else line('~ ', 'TESTEVIDENCE', 'advisory: no test file touched (pass --require-test to make this gate)');

// ---------- verdict ----------
if (denies > 0) {
  console.log(`\nDENY — ${denies} violation(s). Not auto-appliable: reclassify the item NEEDS-REVIEW. (One-directional: a DENY only closes the auto-apply lane; it does not judge the fix itself.)`);
  process.exit(1);
}
console.log('\nALLOW — every mechanical check passed. A PASS never by itself makes a fix NOW-SAFE; classification still owns that judgment.');
