#!/usr/bin/env node
// Regression eval for scripts/repo-map.mjs — pins the phase-0 repo-map contract:
// blank/missing flag values and unknown flags fail closed, a --root outside any git
// work tree fails closed, a normal run extracts definitions (including through a
// BOM-prefixed file), marks a binary file, and reports accurate footer counts,
// --max-file-kb 0 is legal and skips every non-empty file by size, and per-file
// definition truncation is announced at exactly 40 definitions.
//
//   node evals/repo-map/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'repo-map.mjs');

const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };

// Spawn the real script directly (never a shell string); capture status via the thrown
// error's .status on non-zero exit, per execFileSync semantics.
const run = (args, opts = {}) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000, ...opts });
    return { status: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

const git = (args, cwd) => execFileSync('git', args, { cwd, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });

const FIXTURE_FILES = ['alpha.mjs', 'bom.py', 'binary.dat', 'plain.txt', 'manyconsts.mjs'];

function buildFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'coh-repomap-'));
  git(['init', '-q'], dir);

  // alpha.mjs — export function alpha(), class Beta, const GAMMA = (top-level, column 0:
  // the JS definition rules are anchored to line start).
  writeFileSync(join(dir, 'alpha.mjs'), [
    'export function alpha() {',
    '  return 1;',
    '}',
    '',
    'class Beta {',
    '  constructor() {}',
    '}',
    '',
    'const GAMMA = 42;',
    '',
  ].join('\n'));

  // bom.py — UTF-8 BOM-prefixed, def bomfn(): must still be extracted.
  writeFileSync(join(dir, 'bom.py'), Buffer.concat([
    Buffer.from([0xEF, 0xBB, 0xBF]),
    Buffer.from('def bomfn():\n    pass\n', 'utf8'),
  ]));

  // binary.dat — contains a NUL byte within the first 8000 bytes -> '(binary)' marker.
  writeFileSync(join(dir, 'binary.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0x00, 0x10]));

  // plain.txt — no extension rules, just a line-count entry.
  writeFileSync(join(dir, 'plain.txt'), 'just some plain text\nwith two lines\n');

  // manyconsts.mjs — 45 top-level const definitions -> exactly 40 shown + truncation note.
  const manyLines = [];
  for (let i = 0; i < 45; i++) manyLines.push(`export const c${i} = ${i};`);
  writeFileSync(join(dir, 'manyconsts.mjs'), manyLines.join('\n') + '\n');

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

  // a. normal run -> exit 0; map contains extracted definitions (incl. through the BOM file),
  // the binary marker, and a footer matching the fixture counts.
  const outA = join(repo, 'MAP.md');
  const a = run(['--root', repo, '--out', outA]);
  check('a. normal run exits 0', a.status === 0);
  let mapText = '';
  try { mapText = readFileSync(outA, 'utf8'); } catch { /* leave empty; checks below fail loudly */ }
  check('a. map contains function alpha', /\balpha\b/.test(mapText));
  check('a. map contains class Beta', /\bBeta\b/.test(mapText));
  check('a. map contains const GAMMA', /\bGAMMA\b/.test(mapText));
  check('a. map contains bomfn (BOM handled)', /\bbomfn\b/.test(mapText));
  check('a. map marks binary.dat as (binary)', /binary\.dat \(binary\)/.test(mapText));
  const expectedFooter = '— 5 files: 4 scanned, 0 skipped (size), 1 binary, 0 unreadable.';
  check('a. footer matches fixture counts', mapText.includes(expectedFooter));

  // b. --max-file-kb "" -> exit 1
  const b = run(['--root', repo, '--max-file-kb', '']);
  check('b. --max-file-kb "" exits 1', b.status === 1);

  // c. --max-file-kb 0 is LEGAL -> exit 0; every non-empty file line carries the size-skip marker.
  const outC = join(repo, 'MAP_C.md');
  const c = run(['--root', repo, '--out', outC, '--max-file-kb', '0']);
  check('c. --max-file-kb 0 exits 0 (legal)', c.status === 0);
  let mapC = '';
  try { mapC = readFileSync(outC, 'utf8'); } catch { /* leave empty; checks below fail loudly */ }
  const allSkipped = FIXTURE_FILES.every((f) => mapC.includes(`${f} (skipped: >0 KB)`));
  check("c. every non-empty file marked '(skipped: >0 KB)'", allSkipped);

  // d. unknown flag -> exit 1
  const d = run(['--root', repo, '--unknown-flag']);
  check('d. unknown flag exits 1', d.status === 1);

  // e. --root pointing at a fresh NON-git temp dir -> exit 1
  const nonGitDir = mkdtempSync(join(tmpdir(), 'coh-repomap-nogit-'));
  cleanupDirs.push(nonGitDir);
  const e = run(['--root', nonGitDir]);
  check('e. non-git --root exits 1', e.status === 1);

  // f. a file with 45 definitions shows exactly 40, then the truncation note. Matched by
  // filename + the "(N lines)" header shape rather than a hardcoded line count: a trailing
  // newline in the fixture makes the split()-based line count 46, not 45 — a fixture-authoring
  // detail, not part of what this case pins (the 40-defs-then-truncated behavior).
  const mapLines = mapText.split('\n');
  const mcStart = mapLines.findIndex((l) => /^manyconsts\.mjs \(\d+ lines\)$/.test(l));
  check('f. manyconsts.mjs entry present', mcStart !== -1);
  const mcBlock = [];
  if (mcStart !== -1) {
    for (let i = mcStart + 1; i < mapLines.length && mapLines[i].startsWith('  '); i++) mcBlock.push(mapLines[i]);
  }
  const defLines = mcBlock.filter((l) => /^ {2}\d+: const c\d+/.test(l));
  check('f. exactly 40 defs shown for the 45-def file', defLines.length === 40);
  check("f. truncation note '(+5 more truncated)'", mcBlock.includes('  (+5 more truncated)'));
} finally {
  for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} repo-map regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all repo-map regression checks passed.');
