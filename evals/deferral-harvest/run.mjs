#!/usr/bin/env node
// Regression eval for scripts/harvest-deferrals.mjs.
//
//   node evals/deferral-harvest/run.mjs
//
// Builds a throwaway git repository in the OS temp dir holding three markers (a JavaScript
// line comment, a Python comment, and a Markdown HTML comment) and four decoys (the word
// deferred in prose, a `deferred(x)` call outside a comment, the doctrine template with its
// angle-bracket placeholders in a Markdown bold line, and a Markdown heading), then asserts:
//   - exactly the three markers land in the register, with ceiling and upgrade split at the
//     first comma, and every decoy stays out;
//   - the register's items are FRESH under revalidate-register.mjs, so a deferral carries a
//     route back the suite's own checker understands;
//   - ids are stable: moving a marker down four lines keeps its id, and --check reports the
//     line drift, while changing a ceiling changes the id;
//   - --check exits 0 on a register in sync and 1 on a stale one;
//   - the default output lands in the docs hub when exactly one `*-docs/98 System` exists.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const harvest = join(root, 'scripts', 'harvest-deferrals.mjs');
const revalidate = join(root, 'scripts', 'revalidate-register.mjs');
const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };
const run = (args, cwd) => spawnSync('node', args, { encoding: 'utf8', cwd });

const work = mkdtempSync(join(tmpdir(), 'deferral-harvest-'));
const git = (...args) => {
  const r = spawnSync('git', ['-c', 'user.name=h', '-c', 'user.email=h@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd: work, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (rel, text) => { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), text); };

const JS = [
  "export function page(rows, n) {",
  "  // deferred(handles up to 1000 rows in memory, stream the rows when the table passes that)",
  "  return rows.slice(0, n);",
  "}",
  "",
  "// The deferred write path is documented in the hub, not here.",
  "export const later = deferred(work, 'not a comment');",
  "",
].join('\n');
const PY = [
  "def load(path):",
  "    # deferred(reads the whole file, switch to a line iterator past 50 MB)",
  "    return open(path).read()",
  "",
].join('\n');
const MD = [
  "# Notes on deferred(work, items)",
  "",
  "**Rule.** Mark a deliberate simplification with a `deferred(<ceiling>, <upgrade path>)` comment.",
  "",
  "<!-- deferred(one hub per repository, split the hub when a second product lands) -->",
  "",
].join('\n');

try {
  git('init', '-q');
  write('src/page.js', JS);
  write('src/load.py', PY);
  write('site-docs/98 System/notes.md', MD);
  git('add', '-A');
  git('commit', '-q', '-m', 'markers');
  const head = git('rev-parse', 'HEAD');

  // ---------------------------------------------------------------- the harvest
  const first = run([harvest], work);
  expect(first.status === 0, `harvest must exit 0, got ${first.status}: ${first.stderr}`);
  const registerPath = join(work, 'site-docs', '98 System', 'DEFERRALS_REGISTER.md');
  let register = '';
  try { register = readFileSync(registerPath, 'utf8'); } catch { fails.push('the default register must land in the single docs hub'); }
  const ids = [...register.matchAll(/^### (DEF-\d{6})$/gm)].map((m) => m[1]);
  expect(ids.length === 3, `three markers must be harvested, got ${ids.length}:\n${register}`);
  expect(register.includes('- Ceiling: handles up to 1000 rows in memory') && register.includes('- Upgrade: stream the rows when the table passes that'), 'the JavaScript marker splits at the first comma');
  expect(register.includes('- File: `src/load.py:2`'), 'the Python marker cites its line');
  expect(register.includes('- File: `site-docs/98 System/notes.md:5`'), 'the Markdown HTML comment marker is harvested');
  const items = register.slice(register.indexOf('### '));
  expect(!items.includes('not a comment') && !items.includes('work, items') && !items.includes('<ceiling>'), 'the call, the heading, and the template must stay out of the items');
  expect(register.includes(`- Verified-at: ${head}`), 'every item carries the HEAD sha');
  console.log(`ok   three markers harvested, four decoys excluded (${ids.join(', ')})`);

  // ---------------------------------------------------------------- the suite's checker reads it
  const fresh = run([revalidate, registerPath, '--root', work, '--report-only'], work);
  expect(fresh.status === 0 && (fresh.stdout.match(/FRESH/g) ?? []).length >= 3 && !/MOVED|DRIFTED|GONE|NO-REF/.test(fresh.stdout), `revalidate-register must find every item FRESH:\n${fresh.stdout}${fresh.stderr}`);
  console.log('ok   revalidate-register.mjs reads the register and finds every item FRESH');

  // ---------------------------------------------------------------- --check in sync, then drift
  const inSync = run([harvest, '--check'], work);
  expect(inSync.status === 0 && /in sync/.test(inSync.stdout), `--check must exit 0 on a fresh register, got ${inSync.status}: ${inSync.stdout}`);
  write('src/page.js', `// moved\n// down\n// four\n// lines\n${JS}`);
  git('add', '-A');
  git('commit', '-q', '-m', 'move');
  const drifted = run([harvest, '--check'], work);
  expect(drifted.status === 1 && /out of date/.test(drifted.stdout), `--check must exit 1 after a line move, got ${drifted.status}: ${drifted.stdout}`);
  const second = run([harvest, '--json'], work);
  const moved = JSON.parse(second.stdout).items.find((it) => it.file === 'src/page.js');
  expect(moved && moved.line === 6 && ids.includes(moved.id), `a moved marker keeps its id, got ${JSON.stringify(moved)}`);
  write('src/page.js', JS.replace('handles up to 1000 rows', 'handles up to 2000 rows'));
  git('add', '-A');
  git('commit', '-q', '-m', 'ceiling');
  const third = run([harvest, '--json'], work);
  const changed = JSON.parse(third.stdout).items.find((it) => it.file === 'src/page.js');
  expect(changed && !ids.includes(changed.id), 'a changed ceiling changes the id');
  console.log('ok   --check reports drift; ids survive a line move and change with the ceiling');

  // ---------------------------------------------------------------- usage errors
  const bad = run([harvest, '--out'], work);
  expect(bad.status === 2, `a bare --out must exit 2, got ${bad.status}`);
  console.log('ok   a bad flag value exits 2');
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\ndeferral-harvest eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\ndeferral-harvest eval passed');
