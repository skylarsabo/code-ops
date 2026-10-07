#!/usr/bin/env node
// Redundancy-measure regression eval for scripts/measure-redundancy.mjs.
//
//   node evals/measure-redundancy/run.mjs   (exit 0 = pass)
//
// The fixture is a throwaway git repository with two commits:
//   first   a.md and b.md share one 40-word passage; a.md and c.md share a 39-word passage,
//           which sits one word below the threshold; an evals/ copy of the 40-word passage
//           must not count.
//   second  d.md repeats the 40-word passage, so it costs 80 redundant words, not 40.
// The CLI reads the first commit by --rev while the working tree holds the second, which
// proves it reads blobs through git and not from disk.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPassages, isMeasured } from '../../scripts/measure-redundancy.mjs';
import { tally } from '../harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'scripts', 'measure-redundancy.mjs');
const { fails, check } = tally();

// n distinct words, so no 12-word shingle repeats outside the passages the fixture plants.
const run = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join(' ');
const FORTY = run('fortyword', 40);
const THIRTY_NINE = run('thirtynine', 39);
const files = {
  'docs/a.md': `${run('atop', 5)} ${FORTY} ${run('amid', 5)} ${THIRTY_NINE} ${run('atail', 5)}\n`,
  'docs/b.md': `${run('btop', 5)} ${FORTY} ${run('btail', 5)}\n`,
  'docs/c.md': `${run('ctop', 5)} ${THIRTY_NINE} ${run('ctail', 5)}\n`,
  'evals/x/copy.md': `${run('xtop', 5)} ${FORTY} ${run('xtail', 5)}\n`,
};

// ---- 1. the pure core -------------------------------------------------------------------
const measured = new Map(Object.entries(files).filter(([path]) => isMeasured(path)));
check('the evals/ copy is not measured', !measured.has('evals/x/copy.md') && measured.size === 3);
const passages = findPassages(measured);
check('one passage reaches 40 words', passages.length === 1, JSON.stringify(passages));
check('the passage is 40 words shared by a and b', passages[0]?.words === 40 && passages[0].files.join() === 'docs/a.md,docs/b.md', JSON.stringify(passages[0]));
check('the 39-word overlap does not count', passages.every((p) => p.words !== 39));
check('a passage costs words times extra files', passages[0]?.redundant === 40, String(passages[0]?.redundant));
check('the superseded designs are kept only by --all', !isMeasured('code-ops-docs/10 Design/Docs state and history 2026-09.md') && isMeasured('code-ops-docs/10 Design/Docs state and history 2026-09.md', true));
check('derived hosts and vendored copies are skipped', ['opencode-dist/x.md', 'codex-marketplace/x.md', 'plugins/p/scripts/x.md', 'plugins/p/reference/x.md'].every((p) => !isMeasured(p)));

// ---- 2. the CLI over a repository -------------------------------------------------------
const work = mkdtempSync(join(tmpdir(), 'code-ops-measure-redundancy-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
const env = { ...process.env, GIT_CEILING_DIRECTORIES: work, GIT_CONFIG_GLOBAL: join(work, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
writeFileSync(join(work, 'gitconfig'), '[user]\n\tname = Fixture\n\temail = fixture@example.invalid\n[commit]\n\tgpgsign = false\n');
const repo = join(work, 'repo');
mkdirSync(repo);
const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8', env });
const write = (map) => {
  for (const [path, text] of Object.entries(map)) {
    mkdirSync(join(repo, dirname(path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
};
git('init', '-q', '-b', 'main');
write(files);
git('add', '-A');
git('commit', '-q', '--no-verify', '-m', 'first');
write({ 'docs/d.md': `${run('dtop', 5)} ${FORTY} ${run('dtail', 5)}\n` });
git('add', '-A');
git('commit', '-q', '--no-verify', '-m', 'second');

const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: repo, encoding: 'utf8', env });
const first = JSON.parse(cli('--rev', 'HEAD~1', '--json').stdout);
check('--rev reads the first commit', first.passages === 1 && first.redundant === 40 && first.files === 3, JSON.stringify(first.classes));
const head = JSON.parse(cli('--json').stdout);
check('the default rev is HEAD', head.passages === 1 && head.redundant === 80 && head.files === 4, JSON.stringify(head.classes));
check('the class breakdown names the file set', first.classes['F other']?.redundant === 40 && Object.keys(first.classes).length === 1, JSON.stringify(first.classes));
const text = cli('--rev', 'HEAD~1');
check('the text report gives the totals and each class', text.status === 0 && /1 passages, 40 redundant words/.test(text.stdout) && /F other: 1 passages, 40 redundant words/.test(text.stdout), text.stdout);
const bad = cli('--rev', 'no-such-rev');
check('an unknown rev exits 1 and names git', bad.status === 1 && /measure-redundancy: git ls-tree failed/.test(bad.stderr), bad.stderr);
const unknown = cli('--bogus');
check('an unknown flag exits 2', unknown.status === 2, unknown.stderr);

if (fails.length) {
  console.error('FAIL — measure-redundancy eval:');
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('PASS — measure-redundancy eval: a 40-word shared passage counts, a 39-word overlap and the excluded paths do not, and --rev reads commits through git.');
