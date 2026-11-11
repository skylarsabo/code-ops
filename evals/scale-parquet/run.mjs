#!/usr/bin/env node
// Regression eval for the scale-parquet judgment fixture: the tracked bytes match build.mjs, the
// answer key anchors match repo/, the build check fails on drift, and on the tracked tree every
// planted defect fails its hidden oracle while every decoy and the visible suite pass.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally, withDetail } from '../harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ORACLES = join(ROOT, 'evals', 'bench', 'targets', 'hyparquet', 'ANSWER_KEY.oracles');
const { fails, check } = tally(withDetail);
const node = (args, cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 300_000 });
const tail = (r) => `${r.stdout}${r.stderr}`.trim().split('\n').slice(-5).join(' | ');

const built = node(['evals/scale-parquet/build.mjs', '--check']);
check('tracked fixture matches its derivation', built.status === 0, tail(built));
const anchored = node(['evals/score.mjs', 'evals/scale-parquet/ANSWER_KEY.json', '--check']);
check('answer key anchors match repo/', anchored.status === 0, tail(anchored));

// The build check runs on a copy, so tampering never touches the tracked tree.
const copy = mkdtempSync(join(tmpdir(), 'scale-parquet-eval-'));
try {
  for (const rel of ['evals/bench/bench.mjs', 'evals/bench/lib', 'evals/bench/targets/hyparquet', 'evals/scale-parquet']) {
    cpSync(join(ROOT, rel), join(copy, rel), { recursive: true });
  }
  const scan = join(copy, 'evals/scale-parquet/repo/src/scan.js');
  const pristine = readFileSync(scan);
  appendFileSync(scan, '\n');
  const edited = node(['evals/scale-parquet/build.mjs', '--check'], copy);
  check('build check fails on an edited fixture file', edited.status === 1 && edited.stderr.includes('differs repo/src/scan.js'), tail(edited));
  writeFileSync(scan, pristine);
  writeFileSync(join(copy, 'evals/scale-parquet/repo/src/extra.js'), 'export {}\n');
  const extra = node(['evals/scale-parquet/build.mjs', '--check'], copy);
  check('build check fails on a file the derivation does not produce', extra.status === 1 && extra.stderr.includes('not derived repo/src/extra.js'), tail(extra));
  rmSync(join(copy, 'evals/scale-parquet/repo/src/extra.js'));
  rmSync(scan);
  const missing = node(['evals/scale-parquet/build.mjs', '--check'], copy);
  check('build check fails on a missing fixture file', missing.status === 1 && missing.stderr.includes('missing repo/src/scan.js'), tail(missing));
  writeFileSync(scan, pristine);
  appendFileSync(join(copy, 'evals/scale-parquet/ANSWER_KEY.json'), '\n');
  const keyDrift = node(['evals/scale-parquet/build.mjs', '--check'], copy);
  check('build check fails on an edited answer key', keyDrift.status === 1 && keyDrift.stderr.includes('differs ANSWER_KEY.json'), tail(keyDrift));
} finally {
  rmSync(copy, { recursive: true, force: true });
}

/** Run node --test on file in dir; resolves true when it exits 0. */
const passes = (dir, file) => new Promise((done) => {
  const child = spawn(process.execPath, ['--test', file], { cwd: dir, stdio: 'ignore', timeout: 120_000, windowsHide: true });
  child.on('close', (code) => done(code === 0));
});

async function pool(jobs, width) {
  const out = new Array(jobs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
  }));
  return out;
}

const key = JSON.parse(readFileSync(join(HERE, 'ANSWER_KEY.json'), 'utf8'));
const tree = mkdtempSync(join(tmpdir(), 'scale-parquet-oracles-'));
try {
  cpSync(join(HERE, 'repo'), tree, { recursive: true });
  mkdirSync(join(tree, 'oracle'));
  const items = [...key.planted.map((p) => ({ ...p, defect: true })), ...key.decoys.map((d) => ({ ...d, defect: false }))];
  for (const it of items) cpSync(join(ORACLES, it.oracle), join(tree, 'oracle', it.oracle));
  const results = await pool([
    ...items.map((it) => () => passes(tree, `oracle/${it.oracle}`)),
    () => passes(tree, 'test/characterization.test.js'),
  ], availableParallelism());
  const visible = results.pop();
  const defectsPassing = items.filter((it, i) => it.defect && results[i]).map((it) => it.id);
  const decoysFailing = items.filter((it, i) => !it.defect && !results[i]).map((it) => it.id);
  check(`every planted defect fails its oracle (${key.planted.length})`, key.planted.length > 0 && !defectsPassing.length, defectsPassing.join(', '));
  check(`every decoy passes its oracle (${key.decoys.length})`, key.decoys.length > 0 && !decoysFailing.length, decoysFailing.join(', '));
  check('the visible suite passes on the seeded tree', visible, 'test/characterization.test.js failed');
} finally {
  rmSync(tree, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nscale-parquet eval: ${fails.length} failure(s)`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nscale-parquet eval: all checks pass');
