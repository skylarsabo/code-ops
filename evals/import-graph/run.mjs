#!/usr/bin/env node
// Regression eval for scripts/import-graph.mjs — pins the import-graph contract:
// blank/missing flag values and unknown flags fail closed, a --root outside any git
// work tree fails closed, a normal run resolves a relative import chain (a -> b -> c)
// in both directions (imports + imported-by), resolves a directory specifier to its
// index file, lists an unresolved relative import without dropping it, notes a
// non-literal dynamic import as skipped, counts a bare specifier without turning it
// into an edge, resolves an a<->b cycle on both sides without hanging, --focus
// restricts the body to one file's one-hop subgraph, and the footer counts match the
// fixture exactly.
//
//   node evals/import-graph/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'import-graph.mjs');

const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };

// Spawn the real script directly (never a shell string); capture status via the thrown
// error's .status on non-zero exit, per execFileSync semantics.
const run = (args, opts = {}) => {
  try {
    const outp = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000, ...opts });
    return { status: 0, stdout: outp, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

const git = (args, cwd) => execFileSync('git', args, { cwd, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });

function buildFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'coh-importgraph-'));
  git(['init', '-q'], dir);

  // a -> b -> c: a resolved relative chain, checked in both directions.
  writeFileSync(join(dir, 'a.mjs'), "import { b } from './b.mjs';\n");
  writeFileSync(join(dir, 'b.mjs'), "import { c } from './c.mjs';\nexport const b = 1;\n");
  writeFileSync(join(dir, 'c.mjs'), 'export const c = 1;\n');

  // useindex.mjs -> ./libdir resolves to libdir/index.mjs (index resolution).
  mkdirSync(join(dir, 'libdir'));
  writeFileSync(join(dir, 'libdir', 'index.mjs'), 'export const val = 1;\n');
  writeFileSync(join(dir, 'useindex.mjs'), "import { val } from './libdir';\n");

  // bad.mjs -> ./missing.mjs never exists: unresolved, never dropped.
  writeFileSync(join(dir, 'bad.mjs'), "import './missing.mjs';\n");

  // dyn.mjs -> template-literal specifier: non-literal, so "dynamic import skipped".
  writeFileSync(join(dir, 'dyn.mjs'), 'const load = (name) => import(`./${name}.mjs`);\n');

  // bare.mjs -> 'left-pad': bare (package) specifier, counted but never an edge.
  writeFileSync(join(dir, 'bare.mjs'), "import leftPad from 'left-pad';\n");

  // cyc1 <-> cyc2: a genuine cycle. Forward-edge extraction (no graph traversal) means
  // this can never hang the generator; both directions must still show up.
  writeFileSync(join(dir, 'cyc1.mjs'), "import './cyc2.mjs';\n");
  writeFileSync(join(dir, 'cyc2.mjs'), "import './cyc1.mjs';\n");

  // A non-code extension: never scanned, never noted, not part of any count.
  writeFileSync(join(dir, 'notes.md'), '# notes\n');

  git(['add', '-A'], dir);
  // Fixture identity is fake and disposable; gpgsign is disabled so a machine with a global
  // signing requirement can't hang this eval on a passphrase prompt.
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval Runner', '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', 'fixture'], dir);
  return dir;
}

const cleanupDirs = [];
try {
  const repo = buildFixtureRepo();
  cleanupDirs.push(repo);

  // a. normal run -> exit 0.
  const outA = join(repo, 'GRAPH.md');
  const a = run(['--root', repo, '--out', outA]);
  check('a. normal run exits 0', a.status === 0);
  let graph = '';
  try { graph = readFileSync(outA, 'utf8'); } catch { /* leave empty; checks below fail loudly */ }

  // Per-file blocks, split for targeted assertions.
  const block = (file) => {
    const re = new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)(?=\\n\\S|\\n$)`, 'm');
    const m = re.exec(graph);
    return m ? m[1] : '';
  };

  check('a. a.mjs imports b.mjs (resolved chain)', /imports:\s*\n\s*b\.mjs/.test(block('a.mjs')));
  check('a. b.mjs imports c.mjs (resolved chain, 2nd hop)', /imports:\s*\n\s*c\.mjs/.test(block('b.mjs')));
  check('a. b.mjs is imported-by a.mjs (reverse edge)', /imported-by:\s*\n\s*a\.mjs/.test(block('b.mjs')));
  check('a. c.mjs is imported-by b.mjs (reverse edge, leaf file)', /imported-by:\s*\n\s*b\.mjs/.test(block('c.mjs')));
  check('a. useindex.mjs resolves ./libdir to libdir/index.mjs', /imports:\s*\n\s*libdir\/index\.mjs/.test(block('useindex.mjs')));
  check('a. bad.mjs lists ./missing.mjs as unresolved (never dropped)', /unresolved:\s*\n\s*\.\/missing\.mjs/.test(block('bad.mjs')));
  check('a. dyn.mjs notes dynamic import skipped', /dynamic import skipped/.test(block('dyn.mjs')));
  check('a. bare.mjs lists left-pad as bare (no edge)', /bare:\s*\n\s*left-pad/.test(block('bare.mjs')));
  check('a. cyc1.mjs imports cyc2.mjs', /imports:\s*\n\s*cyc2\.mjs/.test(block('cyc1.mjs')));
  check('a. cyc2.mjs imports cyc1.mjs (both cycle edges present)', /imports:\s*\n\s*cyc1\.mjs/.test(block('cyc2.mjs')));
  check('a. notes.md never appears (unsupported extension)', !graph.includes('notes.md'));

  const expectedFooter = '— 11 files: 10 scanned, 0 skipped (size), 0 binary, 0 unreadable, '
    + '5 edges, 1 unresolved, 1 dynamic-skipped, 1 bare specifiers.';
  check('a. footer matches fixture counts exactly', graph.includes(expectedFooter));

  // b. --max-file-kb "" -> exit 1.
  const b = run(['--root', repo, '--max-file-kb', '']);
  check('b. --max-file-kb "" exits 1', b.status === 1);

  // c. unknown flag -> exit 1.
  const c = run(['--root', repo, '--unknown-flag']);
  check('c. unknown flag exits 1', c.status === 1);

  // d. --root pointing at a fresh NON-git temp dir -> exit 1.
  const nonGitDir = mkdtempSync(join(tmpdir(), 'coh-importgraph-nogit-'));
  cleanupDirs.push(nonGitDir);
  const d = run(['--root', nonGitDir]);
  check('d. non-git --root exits 1', d.status === 1);

  // e. --focus a.mjs restricts the body to a.mjs's own one-hop subgraph: a.mjs's block
  // stays (imports b.mjs), but b.mjs's own block (which would show b -> c) is not
  // separately emitted, and unrelated files (bare.mjs, cyc1.mjs) are absent entirely.
  const outE = join(repo, 'GRAPH_FOCUS.md');
  const e = run(['--root', repo, '--out', outE, '--focus', 'a.mjs']);
  check('e. --focus run exits 0', e.status === 0);
  let graphFocus = '';
  try { graphFocus = readFileSync(outE, 'utf8'); } catch { /* leave empty; checks below fail loudly */ }
  check('e. focused graph still contains a.mjs -> b.mjs', /imports:\s*\n\s*b\.mjs/.test(graphFocus) && graphFocus.includes('a.mjs'));
  check('e. focused graph omits unrelated bare.mjs', !graphFocus.includes('bare.mjs'));
  check('e. focused graph omits unrelated cyc1.mjs', !graphFocus.includes('cyc1.mjs'));
  check('e. focused header notes the focus path', graphFocus.includes('(focused on a.mjs)'));
} finally {
  for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} import-graph regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all import-graph regression checks passed.');
