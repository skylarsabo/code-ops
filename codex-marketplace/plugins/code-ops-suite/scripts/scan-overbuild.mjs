#!/usr/bin/env node
// Deterministic over-build scanner for one diff. It is the mechanical floor under the
// code-economy ladder (CONVENTIONS §11 "Size discipline") and the size-and-boundary lens
// (§10): a reviewer's eye decides, and the scanner names what an eye skips.
//
//   node scripts/scan-overbuild.mjs --git <range> [--root <dir>] [--exclude <prefix>]... [--report-only] [--json]
//
// <range> is `<base>..<head>`; a lone ref means `<ref>..HEAD`. Every tell reads the diff and
// the tree at <head> through git, never the working tree, so a run is reproducible from a sha.
// `--exclude <prefix>` drops files under that path from the diff and from the tree lookups, for
// derived copies (a rendered distribution, a vendored mirror) that would repeat every hit.
//
// Tells, each reported as `!! TELL  file:line  message`:
//   NEW-FILE-RATIO     two or more new source files averaging under NEW_FILE_MIN_LINES added
//                      lines. The bound is half of this repository's 25th-percentile new-script
//                      size (88 lines, from `git log --diff-filter=A --numstat -- 'scripts/*.mjs'`).
//   SINGLE-IMPLEMENTOR a new interface, abstract class, or ABC with at most one implementor in
//                      the tree at <head>.
//   PASS-THROUGH       a new function whose whole body forwards its own parameters to one call.
//   NEW-DEPENDENCY     a new entry in a package manifest with no decision record in the same
//                      diff (a changed file under decisions/, adr/, or a *-docs/ hub that names
//                      the package). BLOCKING; every other tell is advisory.
//   TEST-BLOAT         a new test file over twice the median size of its sibling test files.
//   UNREAD-CONFIG      a new top-level key in a root config file that no other file names.
//   DUPLICATE-HELPER   a new exported name that another file already exports.
//   COMMENTED-CODE     three or more consecutive added comment lines shaped like code.
//
// Ceiling: the tells are line-shaped heuristics for JavaScript, TypeScript, and Python, not a
// parse. A pass-through hidden behind a destructured parameter, an implementor registered by
// string, or a config key read through a computed name escapes them. A hit is a lead for the
// review, and a clean run is not a proof of right-sizing.
//
// Exit: 1 when a blocking tell fires (unless --report-only), 0 otherwise, 2 on a usage error or
// a git failure.

import { execFileSync } from 'node:child_process';
import { basename, dirname, extname, posix } from 'node:path';
import { parseOrDie, usage } from './cli-lib.mjs';

const USAGE = 'usage: scan-overbuild.mjs --git <range> [--root <dir>] [--exclude <prefix>]... [--report-only] [--json]';
const die = (msg) => usage([`x ${msg}`, USAGE], 2);

const argv = process.argv.slice(2);
// `-h` carries one dash, which the shared parser leaves as a positional, so help is answered
// before the parse; this script takes no positional, so one left over is a typo'd flag.
if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0); }
const { flags, positional } = parseOrDie(argv, {
  git: { value: true, missing: 'needs a range' },
  root: { value: true, default: process.cwd(), missing: 'needs a directory' },
  exclude: { value: true, many: true, missing: 'needs a path prefix' },
  'report-only': { value: false },
  json: { value: false },
}, USAGE);
if (positional.length) die(`unknown argument: ${positional[0]}`);
if (flags.root === '') die('--root needs a directory');
const { git: range, root, 'report-only': reportOnly = false, json = false } = flags;
const excludes = flags.exclude.map((v) => v.replace(/\\/g, '/').replace(/\/+$/, '') + '/');
if (!range) die('--git <range> is required');

function git(args, { ok = [0] } = {}) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (ok.includes(e.status)) return e.stdout ?? '';
    console.error(`x git ${args.slice(0, 3).join(' ')} failed: ${String(e.stderr ?? e.message).trim()}`);
    process.exit(2);
  }
}

const [base, head] = range.includes('..') ? range.replace('...', '..').split('..') : [range, 'HEAD'];
const headRef = head || 'HEAD';
const span = `${base}..${headRef}`;

// ---------------------------------------------------------------- diff and tree material

const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.rb']);
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.\w+$|_test\.\w+$|(^|\/)test_\w+\.py$/;
const isSource = (f) => SOURCE_EXT.has(extname(f));
const isTest = (f) => TEST_RE.test(f);

const excluded = (f) => excludes.some((p) => f.startsWith(p));
const numstat = new Map();
for (const row of git(['diff', '--numstat', span]).split('\n')) {
  const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(row);
  if (m && !excluded(m[3])) numstat.set(m[3], { added: m[1] === '-' ? 0 : Number(m[1]), deleted: m[2] === '-' ? 0 : Number(m[2]) });
}
const changedFiles = [...numstat.keys()];
const newFiles = git(['diff', '--name-only', '--diff-filter=A', span]).split('\n').filter((f) => f && !excluded(f));
// Path to blob id at <head>: a byte-identical vendored copy shares the blob and is not a duplicate.
const blobOf = new Map();
for (const row of git(['ls-tree', '-r', headRef]).split('\n')) {
  const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(row);
  if (m && !excluded(m[2])) blobOf.set(m[2], m[1]);
}
const tree = [...blobOf.keys()];

// Added lines with their line numbers at <head>, grouped by file.
const added = new Map();
{
  let file = null;
  let line = 0;
  for (const row of git(['diff', '-U0', '--no-color', span]).split('\n')) {
    if (row.startsWith('+++ ')) { file = row.slice(4).replace(/^b\//, ''); if (file === '/dev/null') file = null; continue; }
    if (row.startsWith('--- ') || row.startsWith('diff ') || row.startsWith('index ')) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (h) { line = Number(h[1]); continue; }
    if (file && !excluded(file) && row.startsWith('+')) {
      if (!added.has(file)) added.set(file, []);
      added.get(file).push({ line, text: row.slice(1) });
      line++;
    }
  }
}

const showCache = new Map();
function show(ref, file) {
  const key = `${ref}:${file}`;
  if (!showCache.has(key)) showCache.set(key, git(['show', key], { ok: [0, 128] }));
  return showCache.get(key);
}
const headLines = (file) => show(headRef, file).split('\n');

// `git grep` over the tree at <head>; returns [{file, line, text}] and never throws on no match.
// Patterns use POSIX classes only: on macOS `git grep -E` runs the system regex, which has no
// `\s`, `\w`, or `\b`, and a pattern with them silently matches nothing there.
const SP = '[[:space:]]';
const WORD = '[[:alnum:]_]';
const END = `([^[:alnum:]_]|$)`;
function treeGrep(pattern, { fixed = false, exclude = null } = {}) {
  const args = ['grep', '-n', '-I', fixed ? '-F' : '-E', '-e', pattern, headRef, '--', '.'];
  if (exclude) args.push(`:(exclude)${exclude}`);
  return git(args, { ok: [0, 1] }).split('\n').filter(Boolean).map((row) => {
    const m = /^[^:]+:(.+?):(\d+):(.*)$/.exec(row);
    return m ? { file: m[1], line: Number(m[2]), text: m[3] } : null;
  }).filter((r) => r && !excluded(r.file));
}

const hits = [];
const hit = (tell, file, line, message, blocking = false) => hits.push({ tell, file, line, message, blocking });

// ---------------------------------------------------------------- NEW-FILE-RATIO

const NEW_FILE_MIN_LINES = 44;
{
  const fresh = newFiles.filter((f) => isSource(f) && !isTest(f));
  const total = fresh.reduce((n, f) => n + (numstat.get(f)?.added ?? 0), 0);
  if (fresh.length >= 2 && total / fresh.length < NEW_FILE_MIN_LINES) {
    for (const f of fresh) {
      const n = numstat.get(f)?.added ?? 0;
      if (n < NEW_FILE_MIN_LINES) hit('NEW-FILE-RATIO', f, 1, `${fresh.length} new source files average ${Math.round(total / fresh.length)} lines; this one adds ${n}`);
    }
  }
}

// ---------------------------------------------------------------- SINGLE-IMPLEMENTOR

{
  const DEF_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:interface|abstract\s+class)\s+([A-Z]\w*)|^\s*class\s+([A-Z]\w*)\((?:[^)]*\b(?:ABC|Protocol)\b[^)]*)\)/;
  for (const [file, rows] of added) {
    if (!isSource(file)) continue;
    for (const { line, text } of rows) {
      const m = DEF_RE.exec(text);
      if (!m) continue;
      const name = m[1] ?? m[2];
      const users = treeGrep(`(implements|extends)${SP}+${name}${END}|class${SP}+${WORD}+\\([^)]*[^[:alnum:]_]${name}${END}`).filter((r) => !(r.file === file && r.line === line));
      if (users.length <= 1) hit('SINGLE-IMPLEMENTOR', file, line, `${name} has ${users.length} implementor${users.length === 1 ? '' : 's'} in the tree`);
    }
  }
}

// ---------------------------------------------------------------- PASS-THROUGH

const params = (s) => s.split(',').map((p) => p.trim().replace(/[:=].*$/, '').replace(/^\.\.\./, '').trim()).filter(Boolean).join(',');
const callArgs = (s) => s.split(',').map((p) => p.trim().replace(/^\.\.\./, '')).filter(Boolean).join(',');
{
  const FN_RE = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{\s*(.*)$/;
  const ARROW_RE = /^\s*(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>\s*(.*)$/;
  const DEF_RE = /^\s*def\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*[^:]+)?:\s*$/;
  const FORWARD_RE = /^\s*(?:return\s+)?(?:await\s+)?([\w.]+)\(([^()]*)\);?\s*\}?\s*$/;
  for (const [file, rows] of added) {
    if (!isSource(file)) continue;
    const byLine = new Map(rows.map((r) => [r.line, r.text]));
    for (const { line, text } of rows) {
      let name; let sig; let body;
      let m = FN_RE.exec(text) || ARROW_RE.exec(text);
      if (m) {
        [, name, sig, body] = m;
        if (!body.trim() || body.trim() === '{') body = byLine.get(line + 1) ?? '';
      } else if ((m = DEF_RE.exec(text))) {
        [, name, sig] = m;
        body = byLine.get(line + 1) ?? '';
      } else continue;
      const f = FORWARD_RE.exec(body);
      if (!f) continue;
      const callee = f[1].split('.').pop();
      if (callee === name) continue;
      const self = /^self\.|^this\./.test(sig) ? sig.replace(/^(self|this)\s*,?\s*/, '') : sig;
      if (params(self) === callArgs(f[2])) hit('PASS-THROUGH', file, line, `${name} forwards its parameters to ${f[1]} and adds nothing`);
    }
  }
}

// ---------------------------------------------------------------- NEW-DEPENDENCY

{
  const MANIFESTS = new Set(['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', 'requirements.txt']);
  const records = changedFiles.filter((f) => /(^|\/)(decisions|adrs?)\/|-docs\//i.test(f)).map((f) => show(headRef, f).toLowerCase());
  const recorded = (name) => records.some((t) => t.includes(name.toLowerCase()));
  const sectionAt = (lines, idx) => { for (let i = idx; i >= 0; i--) { const m = /^\s*\[([^\]]+)\]/.exec(lines[i]); if (m) return m[1]; } return ''; };
  for (const file of changedFiles) {
    const name = basename(file);
    if (!MANIFESTS.has(name)) continue;
    const rows = added.get(file) ?? [];
    const found = [];
    if (name === 'package.json') {
      const parse = (t) => { try { return JSON.parse(t); } catch { return {}; } };
      const before = parse(show(base, file));
      const after = parse(show(headRef, file));
      const lines = headLines(file);
      for (const sect of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const dep of Object.keys(after[sect] ?? {})) {
          if (before[sect]?.[dep] !== undefined) continue;
          const at = lines.findIndex((l) => l.includes(`"${dep}"`)) + 1;
          found.push([dep, at || 1]);
        }
      }
    } else if (name === 'Cargo.toml' || name === 'pyproject.toml') {
      const lines = headLines(file);
      // A pyproject entry sits either under a section whose name carries "dependencies" or
      // inside a `dependencies = [` array; a Cargo entry sits under such a section only.
      const inDepArray = (idx) => {
        for (let i = idx; i >= 0; i--) {
          const m = /^\s*([\w.-]+)\s*=\s*\[/.exec(lines[i]);
          if (m) return /dependencies/.test(m[1]);
          if (/^\s*\]|^\s*\[/.test(lines[i])) return false;
        }
        return false;
      };
      for (const { line, text } of rows) {
        const sect = sectionAt(lines, line - 1);
        let dep = null;
        if (name === 'Cargo.toml') dep = /dependencies/.test(sect) ? /^\s*([A-Za-z0-9_.-]+)\s*=/.exec(text)?.[1] : null;
        else if (/dependencies/.test(sect)) dep = /^\s*"?([A-Za-z][A-Za-z0-9_.-]*)/.exec(text)?.[1];
        else if (inDepArray(line - 2)) dep = /^\s*"([A-Za-z][A-Za-z0-9_.-]*)/.exec(text)?.[1];
        if (dep && dep !== 'dependencies') found.push([dep, line]);
      }
    } else if (name === 'go.mod') {
      for (const { line, text } of rows) { const m = /^\s*([\w./-]+)\s+v\d/.exec(text); if (m) found.push([m[1], line]); }
    } else {
      for (const { line, text } of rows) { const m = /^\s*([A-Za-z0-9_.-]+)/.exec(text); if (m && !text.trim().startsWith('#') && !text.trim().startsWith('-')) found.push([m[1], line]); }
    }
    for (const [dep, line] of found) {
      if (!recorded(dep)) hit('NEW-DEPENDENCY', file, line, `${dep} is added with no decision record in the diff`, true);
    }
  }
}

// ---------------------------------------------------------------- TEST-BLOAT

const nonBlank = (text) => text.split('\n').filter((l) => l.trim()).length;
{
  for (const file of newFiles) {
    if (!isTest(file) || !isSource(file)) continue;
    const dir = dirname(file);
    const siblings = tree.filter((f) => f !== file && dirname(f) === dir && isTest(f) && isSource(f));
    if (siblings.length < 2) continue;
    const sizes = siblings.map((f) => nonBlank(show(headRef, f))).sort((a, b) => a - b);
    const median = sizes[Math.floor(sizes.length / 2)];
    const mine = nonBlank(show(headRef, file));
    if (median > 0 && mine > 2 * median) hit('TEST-BLOAT', file, 1, `${mine} non-blank lines against a sibling median of ${median}`);
  }
}

// ---------------------------------------------------------------- UNREAD-CONFIG

{
  const SKIP = /^(package(-lock)?\.json|tsconfig.*\.json|jsconfig\.json|deno\.json|composer\.json|\.eslintrc.*|\.prettierrc.*)$/;
  for (const file of changedFiles) {
    if (file.includes('/') || !/\.(json|ya?ml)$/.test(file) || SKIP.test(file)) continue;
    const keys = [];
    if (file.endsWith('.json')) {
      const parse = (t) => { try { const v = JSON.parse(t); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
      const before = parse(show(base, file));
      const after = parse(show(headRef, file));
      const lines = headLines(file);
      for (const k of Object.keys(after)) if (!(k in before)) keys.push([k, lines.findIndex((l) => l.includes(`"${k}"`)) + 1 || 1]);
    } else {
      for (const { line, text } of added.get(file) ?? []) { const m = /^([A-Za-z_][\w.-]*):/.exec(text); if (m) keys.push([m[1], line]); }
    }
    for (const [k, line] of keys) {
      if (treeGrep(k, { fixed: true, exclude: file }).length === 0) hit('UNREAD-CONFIG', file, line, `${k} is read by no other file in the tree`);
    }
  }
}

// ---------------------------------------------------------------- DUPLICATE-HELPER

{
  const EXPORT_RE = /^\s*export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)|^\s*module\.exports\.(\w+)\s*=|^def\s+(\w+)\s*\(|^class\s+(\w+)\b/;
  for (const [file, rows] of added) {
    if (!isSource(file)) continue;
    for (const { line, text } of rows) {
      const m = EXPORT_RE.exec(text);
      if (!m) continue;
      const name = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (name.length < 3) continue;
      const others = treeGrep(`(export${SP}+(async${SP}+)?(function|const|let|class)${SP}+${name}${END}|module\\.exports\\.${name}${SP}*=|^def${SP}+${name}${SP}*\\(|^class${SP}+${name}${END})`, { exclude: file })
        .filter((r) => blobOf.get(r.file) !== blobOf.get(file));
      if (others.length > 0) hit('DUPLICATE-HELPER', file, line, `${name} is already exported by ${others[0].file}:${others[0].line}`);
    }
  }
}

// ---------------------------------------------------------------- COMMENTED-CODE

{
  const COMMENT_RE = /^\s*(?:\/\/|#(?!!)|\*(?!\/)|\/\*)\s?(.*)$/;
  // Shaped like code: starts like a statement (a keyword, or a name followed by `=`, `(`, or `.`)
  // and ends in statement punctuation. Prose with a stray operator does not qualify.
  const codeLike = (s) => /[;{})]\s*$/.test(s) && /^(return|const|let|var|if|for|while|def|import|from|self|this|await|new|throw)\b|^[\w.$]+\s*(=|\(|\.)/.test(s) && !/https?:\/\//.test(s);
  for (const [file, rows] of added) {
    if (!isSource(file)) continue;
    let run = [];
    const flush = () => { if (run.length >= 3) hit('COMMENTED-CODE', file, run[0], `${run.length} consecutive comment lines shaped like code`); run = []; };
    let prev = -2;
    for (const { line, text } of rows) {
      const m = COMMENT_RE.exec(text);
      const ok = m && codeLike(m[1]);
      if (ok && line === prev + 1) run.push(line);
      else { flush(); if (ok) run = [line]; }
      prev = line;
    }
    flush();
  }
}

// ---------------------------------------------------------------- report

hits.sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.file.localeCompare(b.file) || a.line - b.line);
const blocking = hits.filter((h) => h.blocking).length;
if (json) {
  process.stdout.write(`${JSON.stringify({ range: span, files: changedFiles.length, newFiles: newFiles.length, hits, blocking }, null, 2)}\n`);
} else {
  const addedTotal = [...numstat.values()].reduce((n, s) => n + s.added, 0);
  console.log(`# ${span} (${addedTotal} added lines in ${changedFiles.length} files, ${newFiles.length} new)`);
  for (const h of hits) console.log(`  !! ${h.tell.padEnd(18)} ${posix.normalize(h.file)}:${h.line}  ${h.message}${h.blocking ? ' (blocking)' : ''}`);
  console.log(hits.length ? `\n${hits.length} over-build tell(s), ${blocking} blocking.` : '\nclean: no over-build tells.');
}
process.exit(blocking > 0 && !reportOnly ? 1 : 0);
