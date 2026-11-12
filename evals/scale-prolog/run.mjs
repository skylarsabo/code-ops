#!/usr/bin/env node
// Regression eval for the scale-prolog judgment fixture: the tracked bytes match build.mjs, the
// answer key anchors match repo/, the build check fails on drift, and on the tracked tree every
// planted defect fails its hidden oracle while every decoy and the visible suite pass. It also checks
// the refutation claim set against its key and the seed sites, checks the hard claim set and runs its
// probes against repo/, and pins score-refutation.mjs on both keys.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally, withDetail } from '../harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ORACLES = join(ROOT, 'evals', 'bench', 'targets', 'tau-prolog', 'ANSWER_KEY.oracles');
const { fails, check } = tally(withDetail);
const node = (args, cwd = ROOT) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 300_000 });
const tail = (r) => `${r.stdout}${r.stderr}`.trim().split('\n').slice(-5).join(' | ');

const built = node(['evals/scale-prolog/build.mjs', '--check']);
check('tracked fixture matches its derivation', built.status === 0, tail(built));
const anchored = node(['evals/score.mjs', 'evals/scale-prolog/ANSWER_KEY.json', '--check']);
check('answer key anchors match repo/', anchored.status === 0, tail(anchored));

// The build check runs on a copy, so tampering never touches the tracked tree.
const copy = mkdtempSync(join(tmpdir(), 'scale-prolog-eval-'));
try {
  for (const rel of ['evals/bench/bench.mjs', 'evals/bench/lib', 'evals/bench/targets/tau-prolog', 'evals/scale-prolog']) {
    cpSync(join(ROOT, rel), join(copy, rel), { recursive: true });
  }
  const mod = join(copy, 'evals/scale-prolog/repo/modules/format.js');
  const pristine = readFileSync(mod);
  appendFileSync(mod, '\n');
  const edited = node(['evals/scale-prolog/build.mjs', '--check'], copy);
  check('build check fails on an edited fixture file', edited.status === 1 && edited.stderr.includes('differs repo/modules/format.js'), tail(edited));
  writeFileSync(mod, pristine);
  writeFileSync(join(copy, 'evals/scale-prolog/repo/modules/extra.js'), 'module.exports = {}\n');
  const extra = node(['evals/scale-prolog/build.mjs', '--check'], copy);
  check('build check fails on a file the derivation does not produce', extra.status === 1 && extra.stderr.includes('not derived repo/modules/extra.js'), tail(extra));
  rmSync(join(copy, 'evals/scale-prolog/repo/modules/extra.js'));
  rmSync(mod);
  const missing = node(['evals/scale-prolog/build.mjs', '--check'], copy);
  check('build check fails on a missing fixture file', missing.status === 1 && missing.stderr.includes('missing repo/modules/format.js'), tail(missing));
  writeFileSync(mod, pristine);
  appendFileSync(join(copy, 'evals/scale-prolog/ANSWER_KEY.json'), '\n');
  const keyDrift = node(['evals/scale-prolog/build.mjs', '--check'], copy);
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

// The refutation task: REFUTATION_CLAIMS.md is worker-facing, so its wording must not leak the label.
const refKey = JSON.parse(readFileSync(join(HERE, 'ANSWER_KEY.refutation.json'), 'utf8')).claims;
const claimsText = readFileSync(join(HERE, 'REFUTATION_CLAIMS.md'), 'utf8');
const claims = [...claimsText.matchAll(/^- (C-\d{2}) · (modules\/[\w.]+):(\d+) · (.+)$/gm)]
  .map(([, id, file, line, text]) => ({ id, file, line: Number(line), words: text.trim().split(/\s+/).length, text }));
const ids = (list) => list.map((c) => c.id).join(',');
const inOrder = Array.from({ length: 30 }, (_, i) => `C-${String(i + 1).padStart(2, '0')}`).join(',');
check('claims file and key hold 30 claims each', claims.length === 30 && refKey.length === 30, `${claims.length}, ${refKey.length}`);
check('claim ids are unique and in order in both files', ids(claims) === inOrder && ids(refKey) === inOrder, ids(claims));
const verdicts = refKey.map((c) => c.verdict);
check('15 claims of each verdict', verdicts.filter((v) => v === 'REAL').length === 15 && verdicts.filter((v) => v === 'NOT-A-DEFECT').length === 15, verdicts.join(','));
const site = new Map([...key.planted.map((s) => [s.id, { ...s, verdict: 'REAL' }]), ...key.decoys.map((s) => [s.id, { ...s, verdict: 'NOT-A-DEFECT' }])]);
const offSite = refKey.filter((c, i) => {
  const s = site.get(c.seed);
  return !s || s.verdict !== c.verdict || s.file !== c.file || s.line !== c.line || claims[i]?.file !== s.file || claims[i]?.line !== s.line;
});
check('every claim sits on its seed site with the seed kind as verdict', !offSite.length, ids(offSite));
const seeds = refKey.map((c) => c.seed);
check('every decoy is used once and no seed twice', new Set(seeds).size === 30 && key.decoys.every((d) => seeds.filter((s) => s === d.id).length === 1), seeds.join(','));
const badLength = claims.filter((c) => c.words < 18 || c.words > 40);
check('every claim holds 18 to 40 words', !badLength.length, badLength.map((c) => `${c.id}=${c.words}`).join(', '));
const forbidden = ['decoy', 'equivalent', 'planted', 'seed', ...site.keys()].filter((w) => claimsText.toLowerCase().includes(w.toLowerCase()));
check('the claims file holds no forbidden word or seed id', !forbidden.length, forbidden.join(', '));
check('the claims file holds no verdict word', !/\breal\b|not-a-defect/i.test(claimsText), 'verdict word found');
const maxRun = verdicts.reduce((acc, v, i) => {
  const run = i > 0 && v === verdicts[i - 1] ? acc.run + 1 : 1;
  return { run, max: Math.max(acc.max, run) };
}, { run: 0, max: 0 }).max;
check('no run of one verdict is longer than 3', maxRun <= 3, `max run ${maxRun}`);
const firstHalfReal = verdicts.slice(0, 15).filter((v) => v === 'REAL').length;
check('C-01 to C-15 hold 6 to 9 of each verdict', firstHalfReal >= 6 && firstHalfReal <= 9, `${firstHalfReal} REAL`);
const meanWords = (verdict) => {
  const of = claims.filter((_, i) => verdicts[i] === verdict);
  return of.reduce((n, c) => n + c.words, 0) / (of.length || 1);
};
const means = `REAL ${meanWords('REAL').toFixed(1)}, NOT-A-DEFECT ${meanWords('NOT-A-DEFECT').toFixed(1)}`;
check(`mean words per verdict differ by at most 3 (${means})`, Math.abs(meanWords('REAL') - meanWords('NOT-A-DEFECT')) <= 3, means);

// The hard set: its claims need code far from the cited line, so each label is fixed by an executed probe.
const HARD_KEY = 'evals/scale-prolog/ANSWER_KEY.refutation-hard.json';
const hardKey = JSON.parse(readFileSync(join(ROOT, HARD_KEY), 'utf8')).claims;
const hardText = readFileSync(join(HERE, 'REFUTATION_CLAIMS_HARD.md'), 'utf8');
const hard = [...hardText.matchAll(/^- (H-\d{2}) · (modules\/[\w.]+):(\d+) · (.+)$/gm)]
  .map(([, id, file, line, text]) => ({ id, file, line: Number(line), words: text.trim().split(/\s+/).length }));
const hardOrder = Array.from({ length: 20 }, (_, i) => `H-${String(i + 1).padStart(2, '0')}`).join(',');
check('hard claims file and key hold 20 claims each', hard.length === 20 && hardKey.length === 20, `${hard.length}, ${hardKey.length}`);
check('hard claim ids are unique and in order in both files', ids(hard) === hardOrder && ids(hardKey) === hardOrder, ids(hard));
const hardVerdicts = hardKey.map((c) => c.verdict);
check('10 hard claims of each verdict', hardVerdicts.filter((v) => v === 'REAL').length === 10 && hardVerdicts.filter((v) => v === 'NOT-A-DEFECT').length === 10, hardVerdicts.join(','));
const hardMoved = hardKey.filter((c, i) => hard[i]?.file !== c.file || hard[i]?.line !== c.line);
check('every hard claim cites the file and line of its key entry', !hardMoved.length, ids(hardMoved));
// A real hard claim sits on a planted site the first set leaves out; C-19's site is the one allowed reuse.
const firstSites = new Set(refKey.filter((c) => c.id !== 'C-19').map((c) => `${c.file}:${c.line}`));
const plantedSites = new Set(key.planted.map((p) => `${p.file}:${p.line}`));
const hardOffSite = hardKey.filter((c) => {
  const at = `${c.file}:${c.line}`;
  return (c.verdict === 'REAL' && !plantedSites.has(at)) || firstSites.has(at);
});
check('every real hard claim sits on a planted site and no hard claim on a first-set site', !hardOffSite.length, ids(hardOffSite));
const hardLength = hard.filter((c) => c.words < 18 || c.words > 40);
check('every hard claim holds 18 to 40 words', !hardLength.length, hardLength.map((c) => `${c.id}=${c.words}`).join(', '));
const hardForbidden = ['decoy', 'equivalent', 'planted', 'seed', 'unreachable', 'guard', ...site.keys()].filter((w) => hardText.toLowerCase().includes(w.toLowerCase()));
check('the hard claims file holds no forbidden word or seed id', !hardForbidden.length, hardForbidden.join(', '));
check('the hard claims file holds no verdict word', !/\breal\b|not-a-defect/i.test(hardText), 'verdict word found');
const hardRun = hardVerdicts.reduce((acc, v, i) => {
  const run = i > 0 && v === hardVerdicts[i - 1] ? acc.run + 1 : 1;
  return { run, max: Math.max(acc.max, run) };
}, { run: 0, max: 0 }).max;
check('no run of one hard verdict is longer than 3', hardRun <= 3, `max run ${hardRun}`);
const hardMean = (verdict) => {
  const of = hard.filter((_, i) => hardVerdicts[i] === verdict);
  return of.reduce((n, c) => n + c.words, 0) / (of.length || 1);
};
const hardMeans = `REAL ${hardMean('REAL').toFixed(1)}, NOT-A-DEFECT ${hardMean('NOT-A-DEFECT').toFixed(1)}`;
check(`mean words per hard verdict differ by at most 3 (${hardMeans})`, Math.abs(hardMean('REAL') - hardMean('NOT-A-DEFECT')) <= 3, hardMeans);
check('at most 4 hard probes use js', hardKey.filter((c) => c.probe?.js !== undefined).length <= 4, 'too many js probes');
const probed = node(['evals/scale-prolog/run-probes.mjs', HARD_KEY]);
/** @type {Record<string, string>} */
const seen = probed.status === 0 ? JSON.parse(probed.stdout) : {};
const drifted = hardKey.filter((c) => typeof c.probe?.expect !== 'string' || seen[c.id] !== c.probe.expect);
check('every hard probe observes its expected outcome on repo/', probed.status === 0 && !drifted.length,
  probed.status === 0 ? drifted.map((c) => `${c.id}: ${seen[c.id]}`).join(' | ') : tail(probed));

const scratch = mkdtempSync(join(tmpdir(), 'scale-prolog-refutation-'));
try {
  /** Score candidate lines with --json; returns the parsed result, or null when the scorer failed. */
  const score = (name, lines, extra = []) => {
    const file = join(scratch, name);
    writeFileSync(file, `${lines.join('\n')}\n`);
    const r = node(['evals/scale-prolog/score-refutation.mjs', file, '--json', ...extra]);
    return r.status === 0 ? JSON.parse(r.stdout) : null;
  };
  // Each reason names the other verdict, so a scorer that reads past the verdict field fails here.
  const perfect = score('perfect.md', refKey.map((c) => `- ${c.id} · ${c.verdict.toLowerCase()} · not ${c.verdict === 'REAL' ? 'NOT-A-DEFECT' : 'REAL'}`));
  check('the scorer gives 30 for a perfect candidate', perfect?.correct === 30 && perfect.real.correct === 15 && perfect.false.correct === 15, JSON.stringify(perfect));
  const allReal = score('all-real.md', refKey.map((c) => `${c.id} · REAL · reason`));
  check('the scorer gives 15 for an all-REAL candidate', allReal?.correct === 15 && allReal.real.correct === 15 && allReal.false.correct === 0, JSON.stringify(allReal));
  const gaps = score('gaps.md', [...refKey.slice(1).map((c) => `* ${c.id} · ${c.verdict} · reason`), `- C-02 · ${refKey[1].verdict === 'REAL' ? 'NOT-A-DEFECT' : 'REAL'} · reason`]);
  check('the scorer counts a missing and a double verdict as wrong', gaps?.correct === 28 && gaps.wrong.join(',') === 'C-01,C-02', JSON.stringify(gaps));
  const withKey = ['--key', HARD_KEY];
  const hardPerfect = score('hard-perfect.md', hardKey.map((c) => `- ${c.id} · ${c.verdict} · not ${c.verdict === 'REAL' ? 'NOT-A-DEFECT' : 'REAL'}`), withKey);
  check('the scorer gives 20 for a perfect hard candidate', hardPerfect?.correct === 20 && hardPerfect.total === 20 && hardPerfect.real.correct === 10 && hardPerfect.false.correct === 10, JSON.stringify(hardPerfect));
  const hardAllReal = score('hard-all-real.md', [...hardKey.map((c) => `${c.id} · REAL · reason`), '- C-01 · REAL · reason'], withKey);
  check('the scorer gives 10 for an all-REAL hard candidate and ignores ids outside the key', hardAllReal?.correct === 10 && hardAllReal.total === 20 && hardAllReal.false.correct === 0, JSON.stringify(hardAllReal));
  const noKeyPath = node(['evals/scale-prolog/score-refutation.mjs', join(scratch, 'hard-perfect.md'), '--key']);
  check('the scorer exits 2 on --key with no path', noKeyPath.status === 2, String(noKeyPath.status));
  const misuse = node(['evals/scale-prolog/score-refutation.mjs']);
  const unreadable = node(['evals/scale-prolog/score-refutation.mjs', join(scratch, 'absent.md')]);
  check('the scorer exits 2 on a usage error and an unreadable file', misuse.status === 2 && unreadable.status === 2, `${misuse.status}, ${unreadable.status}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const tree = mkdtempSync(join(tmpdir(), 'scale-prolog-oracles-'));
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
  console.error(`\nscale-prolog eval: ${fails.length} failure(s)`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nscale-prolog eval: all checks pass');
