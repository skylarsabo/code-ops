#!/usr/bin/env node
// Distill vault-mode regression eval (scripts/distill-check.mjs `state` verbs, `co docs distill state`).
//
// The eval copies the fixture under evals/distill-vault/repo to a temp folder and drives the state
// verbs through the phases of a vault-mode run. The fixture hub plants a moved file with no
// forwarding entry and an unreachable note, so the run meets both refusals the design names:
// no-loss at the end of the relocate phase, and findability on request. The cases pin:
//   - the fixture itself: no-loss reports the one planted loss, findability the one orphan;
//   - order: a phase starts only after the one before it is done, a phase starts once, a phase
//     checkpoints only from running with an existing artifact, and done needs a review note;
//   - the relocate phase: done refuses while any input path is lost and stays checkpointed, then
//     passes once the forwarding entry exists, and records the counts and the findability result;
//   - the drafts phase: done with --require-findable refuses while a note is unreachable;
//   - batches (phases 3 and 7): a defect in the 10% sample sends the batch to full review, a worker
//     never takes the same batch twice, a full-review batch leaves by a whole read, an unresolved
//     batch blocks done, and a phase with no batches takes none;
//   - phase 8 is not built, and show names it as the stop;
//   - the same verbs twice leave the same state bytes.
// One live run walks phase 1 to phase 7 through the real verbs. Every other case starts from a
// state file written for its phase, so a mutant run costs a few spawns and not a whole walk.
//
// The mutants: each copy of the script breaks one rule, and the case that pins the rule must
// change its verdict. A case no mutant can fail asserts nothing, so this eval fails on one.
//
//   node evals/distill-vault/run.mjs   (exit 0 = pass)

import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally, withDetail } from '../harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(ROOT, 'scripts');
const SCRIPT = join(SCRIPTS, 'distill-check.mjs');
const FIXTURE = join(ROOT, 'evals', 'distill-vault', 'repo');
const HUB = 'vault';
const LOST = 'docs/runbook-old.md';
const ORPHAN = 'vault/10 Design/orphan-notes.md';
const PHASE_NAMES = ['inventory', 'relocate', 'classify', 'chain', 'drafts', 'ledgers', 'synthesis', 'install'];
const work = mkdtempSync(join(tmpdir(), 'coh-distill-vault-'));
const { fails, check } = tally(withDetail);
let counter = 0;

const run = (script, args) => new Promise((done) => {
  const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { err += chunk; });
  child.on('close', (status) => done({ status, out, err, all: `${out}${err}` }));
});
const json = (result) => { try { return JSON.parse(result.out); } catch { return null; } };
const put = (repo, rel, text) => { mkdirSync(dirname(join(repo, rel)), { recursive: true }); writeFileSync(join(repo, rel), text); };
const walk = (dir, base = '') => readdirSync(join(dir, base), { withFileTypes: true })
  .flatMap((entry) => (entry.isDirectory() ? walk(dir, `${base}${entry.name}/`) : [`${base}${entry.name}`])).sort();

const FORWARDING = `${HUB}/98 System/FORWARDING.json`;
const forwardingWith = (...pairs) => `${JSON.stringify({ version: 1, forwards: pairs.map(([from, to]) => ({ from, to, movedAt: '2026-09-30', reason: 'relocate wave 1' })) }, null, 2)}\n`;
const REPAIRED = forwardingWith(['docs/guide.md', `${HUB}/10 Design/guide.md`], [LOST, `${HUB}/10 Design/runbook.md`]);
const ART = ['--artifact', 'run/plan.json'];

// A fresh copy of the fixture with the verbs bound to it. `live` runs the real transitions to enter
// a phase, and otherwise the state file is written for that phase.
function context(script, live = false) {
  const repo = join(work, `repo-${counter++}`);
  cpSync(FIXTURE, repo, { recursive: true });
  put(repo, 'run/plan.json', '{}\n');
  const stateFile = join(repo, 'run', 'state.json');
  const st = (verb, phase, ...flags) => run(script, ['state', verb, ...(phase === null ? [] : [String(phase)]), '--root', repo, '--state', stateFile, ...flags]);
  const read = () => { try { return JSON.parse(readFileSync(stateFile, 'utf8')); } catch { return null; } };
  const phaseOf = (n) => read()?.phases?.[n - 1];
  const batchOf = (n, id) => phaseOf(n)?.batches?.find((b) => b.id === id);
  const seed = (n, status) => put(repo, 'run/state.json', `${JSON.stringify({
    version: 1,
    hub: HUB,
    inventories: ['inventory/docs.json'],
    phases: PHASE_NAMES.map((name, index) => {
      const at = index + 1;
      const own = at < n ? 'done' : at === n ? status : 'pending';
      return { phase: at, name, status: own, artifacts: own === 'checkpointed' || own === 'done' ? ['run/plan.json'] : [], review: own === 'done' ? 'seeded' : null, checks: null, ...(at === 3 || at === 7 ? { batches: [] } : {}) };
    }),
  }, null, 2)}\n`);
  // Enter phase n as `running` or `checkpointed`.
  const enter = async (n, status) => {
    if (!live) return seed(n, status);
    if (n === 7) { await st('start', 6); await st('checkpoint', 6, ...ART); await st('done', 6, '--review', 'read every disposition'); }
    await st('start', n);
    if (status === 'checkpointed') await st('checkpoint', n, ...(n === 2 ? ['--artifact', FORWARDING] : ART));
    return undefined;
  };
  return { repo, stateFile, st, read, phaseOf, batchOf, enter, live };
}

// Each segment records facts and leaves its phase done, so a live run chains them. Nothing here
// throws on a refusal, because a mutant must be able to accept what the real script refuses.
async function ordering(c, f) {
  const { st } = c;
  f.init = await st('init', null, '--hub', HUB, '--inventory', 'inventory/docs.json');
  f.reinit = (await st('init', null, '--hub', HUB, '--inventory', 'inventory/docs.json')).status;
  f.outOfOrder = (await st('start', 2)).status;
  await st('start', 1);
  f.restart = (await st('start', 1)).status;
  f.checkpointNoArtifact = (await st('checkpoint', 1)).status;
  f.checkpointMissing = (await st('checkpoint', 1, '--artifact', 'run/absent.json')).status;
  await st('checkpoint', 1, ...ART);
  f.doneNoReview = (await st('done', 1)).status;
  await st('done', 1, '--review', 'read the totals');
  f.checkpointDone = (await st('checkpoint', 1, ...ART)).status;
  f.bytes = readFileSync(c.stateFile, 'utf8');
}

async function relocate(c, f) {
  const { st } = c;
  await c.enter(2, 'checkpointed');
  const lossy = await st('done', 2, '--review', 'plan approved');
  f.lossRefused = lossy.status === 1 && lossy.all.includes(`LOSS ${LOST}`) && c.phaseOf(2)?.status === 'checkpointed';
  put(c.repo, FORWARDING, REPAIRED);
  f.lossFixed = (await st('done', 2, '--review', 'plan approved')).status;
  f.relocateChecks = c.phaseOf(2)?.checks;
}

async function classify(c, f) {
  const { st } = c;
  await c.enter(3, 'running');
  const notes = walk(c.repo, `${HUB}/`).filter((p) => p.endsWith('.md') && !p.startsWith(`${HUB}/80 Runs/`));
  const list = join(c.repo, 'run', 'notes.txt');
  put(c.repo, 'run/notes.txt', `${notes.join('\n')}\n`);
  f.plan = (await st('plan', 3, '--paths', list, '--size', '8')).status;
  f.replan = (await st('plan', 3, '--paths', list)).status;
  f.noteCount = notes.length;
  f.batches = c.phaseOf(3)?.batches?.map((b) => ({ id: b.id, paths: b.paths.length, sample: b.sample.length, sampleInBatch: b.sample.every((p) => b.paths.includes(p)) }));
  await st('assign', 3, '--batch', 'B01', '--worker', 'w1');
  await st('result', 3, '--batch', 'B01', '--defects', '1');
  f.sampleDefect = c.batchOf(3, 'B01')?.status;
  f.sameWorker = (await st('assign', 3, '--batch', 'B01', '--worker', 'w1')).status;
  await st('assign', 3, '--batch', 'B01', '--worker', 'w2');
  await st('result', 3, '--batch', 'B01', '--defects', '0');
  f.secondPass = c.batchOf(3, 'B01')?.status;
  await st('assign', 3, '--batch', 'B02', '--worker', 'w1');
  await st('result', 3, '--batch', 'B02', '--defects', '2');
  f.reviewClean = (await st('review', 3, '--batch', 'B01')).status;
  f.reviewWhole = (await st('review', 3, '--batch', 'B02')).status === 0 && c.batchOf(3, 'B02')?.status === 'reviewed';
  await st('checkpoint', 3, ...ART);
  const open = await st('done', 3, '--review', 'read every ruling');
  f.unresolvedDone = open.status === 1 && open.all.includes('B03') && c.phaseOf(3)?.status === 'checkpointed';
  await st('reopen', 3);
  await st('assign', 3, '--batch', 'B03', '--worker', 'w1');
  await st('result', 3, '--batch', 'B03', '--defects', '0');
  await st('checkpoint', 3, ...ART);
  f.doneThree = (await st('done', 3, '--review', 'read every ruling')).status;
}

async function chain(c, f) {
  const { st } = c;
  await c.enter(4, 'running');
  const planned = await st('plan', 4, '--paths', join(c.repo, 'run', 'plan.json'));
  f.planPhase4 = planned.status === 1 && /takes no batches/.test(planned.err);
  await st('checkpoint', 4, ...ART);
  await st('done', 4, '--review', 'read every chain edge');
}

async function drafts(c, f) {
  const { st } = c;
  await c.enter(5, 'checkpointed');
  put(c.repo, FORWARDING, REPAIRED);
  const unreachable = await st('done', 5, '--review', 'read the archive choices', '--require-findable');
  f.requireFindable = unreachable.status === 1 && unreachable.all.includes(`UNREACHABLE ${ORPHAN}`) && c.phaseOf(5)?.status === 'checkpointed';
  const index = readFileSync(join(c.repo, HUB, '10 Design', 'INDEX.md'), 'utf8');
  put(c.repo, `${HUB}/10 Design/INDEX.md`, `${index}- [Orphan notes](orphan-notes.md)\n`);
  f.doneFive = (await st('done', 5, '--review', 'read the archive choices', '--require-findable')).status;
  f.draftChecks = c.phaseOf(5)?.checks;
}

async function synthesis(c, f) {
  const { st } = c;
  await c.enter(7, 'running');
  put(c.repo, 'run/synthesis.txt', `${HUB}/30 Synthesis/retention-overview.md\n`);
  await st('plan', 7, '--paths', join(c.repo, 'run', 'synthesis.txt'));
  await st('assign', 7, '--batch', 'B01', '--worker', 'w1');
  await st('result', 7, '--batch', 'B01', '--defects', '0');
  await st('checkpoint', 7, ...ART);
  f.doneSeven = (await st('done', 7, '--review', 'read a sample')).status;
  const shown = json(await st('show', null, '--json'));
  f.show = shown && { next: shown.next, last: shown.lastCheckpoint, done: shown.phases.filter((p) => p.status === 'done').length };
  const eight = await st('start', 8);
  f.start8 = eight.status === 1 && /not built/.test(eight.all);
}

const SEGMENTS = { ordering, relocate, classify, chain, drafts, synthesis };
const facts = async (script, names) => {
  const f = {};
  for (const name of names) await SEGMENTS[name](context(script), f);
  return f;
};
// The live run: one context, every segment in order, through the real verbs.
async function liveRun(script) {
  const c = context(script, true);
  const f = {};
  for (const name of ['ordering', 'relocate', 'classify', 'chain', 'drafts', 'synthesis']) await SEGMENTS[name](c, f);
  return f;
}

// Cases a mutant can break: what a correct script answers for the facts of one segment.
const CASES = {
  outOfOrder: { segment: 'ordering', holds: (f) => f.outOfOrder === 1 },
  restart: { segment: 'ordering', holds: (f) => f.restart === 1 },
  checkpointNeedsArtifact: { segment: 'ordering', holds: (f) => f.checkpointNoArtifact === 2 && f.checkpointMissing === 1 },
  checkpointOnlyFromRunning: { segment: 'ordering', holds: (f) => f.checkpointDone === 1 },
  doneNeedsReview: { segment: 'ordering', holds: (f) => f.doneNoReview === 2 },
  lossRefused: { segment: 'relocate', holds: (f) => f.lossRefused === true && f.lossFixed === 0 },
  relocateChecks: { segment: 'relocate', holds: (f) => f.relocateChecks?.noLoss?.inputs === 4 && f.relocateChecks.noLoss.accounted === 4 && f.relocateChecks.noLoss.moved === 2
    && f.relocateChecks.noLoss.archived === 1 && f.relocateChecks.findability?.unreachable === 1 },
  batchPlan: { segment: 'classify', holds: (f) => f.plan === 0 && f.replan === 1 && f.noteCount === 18 && f.batches?.map((b) => b.paths).join() === '8,8,2' && f.batches.every((b) => b.sample === 1 && b.sampleInBatch) },
  sampleDefect: { segment: 'classify', holds: (f) => f.sampleDefect === 'full-review' && f.secondPass === 'clean' },
  sameWorker: { segment: 'classify', holds: (f) => f.sameWorker === 1 },
  reviewWhole: { segment: 'classify', holds: (f) => f.reviewClean === 1 && f.reviewWhole === true },
  unresolvedDone: { segment: 'classify', holds: (f) => f.unresolvedDone === true && f.doneThree === 0 },
  noBatchesInPhase4: { segment: 'chain', holds: (f) => f.planPhase4 === true },
  requireFindable: { segment: 'drafts', holds: (f) => f.requireFindable === true && f.doneFive === 0 && f.draftChecks?.findability?.unreachable === 0 },
  phaseEight: { segment: 'synthesis', holds: (f) => f.start8 === true && f.doneSeven === 0 && f.show?.next?.phase === 8 && f.show.next.action === 'stop' && f.show.last?.phase === 7 && f.show.done === 7 },
};

// Each mutant breaks one rule. `replace` maps an exact source string to its replacement, and every
// pinned case must stop holding.
const MUTANTS = [
  { name: 'starts a phase before the one before it is done', replace: ['n > 1 && doc.phases[n - 2].status !== \'done\'', 'false'], pins: ['outOfOrder'] },
  { name: 'starts a phase twice', replace: ['if (phase.status !== \'pending\') refuse(', 'if (false) refuse('], pins: ['restart'] },
  { name: 'checkpoints without an artifact', replace: ['if (!flags.artifact.length) die(', 'if (false) die('], pins: ['checkpointNeedsArtifact'] },
  { name: 'checkpoints from any status', replace: ['if (phase.status !== \'running\') refuse(`phase ${n} is ${phase.status}; only a running phase checkpoints`);', ''], pins: ['checkpointOnlyFromRunning'] },
  { name: 'finishes a phase with no review note', replace: ['if (!review) die(', 'if (false) die('], pins: ['doneNeedsReview'] },
  { name: 'skips no-loss at the end of a moving phase', replace: ['if (MOVING.has(n))', 'if (false)'], pins: ['lossRefused', 'relocateChecks'] },
  { name: 'ignores --require-findable', replace: ['requireFindable && (found.error || found.unreachable > 0)', 'false'], pins: ['requireFindable'] },
  { name: 'sends a defective sample to no full review', replace: ['defects === 0 ? \'clean\' : \'full-review\'', '\'clean\''], pins: ['sampleDefect'] },
  { name: 'lets a worker take its own batch twice', replace: ['batch.workers.includes(flags.worker)', 'false'], pins: ['sameWorker'] },
  { name: 'reads a clean batch as a full review', replace: ['if (batch.status !== \'full-review\') refuse(`batch ${batch.id} is ${batch.status}; only a full-review batch is read whole`);', ''], pins: ['reviewWhole'] },
  { name: 'finishes a phase with an unresolved batch', replace: ['if (open.length) refuse(', 'if (false) refuse('], pins: ['unresolvedDone'] },
  { name: 'plans batches for any phase', replace: ['if (!BATCHED.has(n)) refuse(', 'if (false) refuse('], pins: ['noBatchesInPhase4'] },
  { name: 'starts phase 8', replace: ['const NOT_BUILT = new Set([8]);', 'const NOT_BUILT = new Set([]);'], pins: ['phaseEight'] },
];

function mutantScript(index, [from, to]) {
  const source = readFileSync(SCRIPT, 'utf8');
  if (!source.includes(from)) throw new Error(`mutant anchor not found in distill-check.mjs: ${from}`);
  const sibling = (name) => pathToFileURL(join(SCRIPTS, name)).href;
  const mutated = source.replace(from, () => to).replace(/from '\.\/([\w-]+\.mjs)'/g, (_, name) => `from '${sibling(name)}'`);
  const file = join(work, `mutant-${index}.mjs`);
  writeFileSync(file, mutated);
  return file;
}

try {
  // The mutant runs start first and finish while the live run and the fixture checks work.
  const mutantRuns = MUTANTS.map((mutant, index) => {
    const script = mutantScript(index, mutant.replace);
    const segments = [...new Set(mutant.pins.map((name) => CASES[name].segment))];
    return facts(script, segments).then((f) => ({ mutant, f }));
  });

  // the fixture, before any phase
  const bare = join(work, 'bare');
  cpSync(FIXTURE, bare, { recursive: true });
  const inventory = join(bare, 'inventory', 'docs.json');
  const noLoss = json(await run(SCRIPT, ['no-loss', '--root', bare, '--inventory', inventory, '--hub', HUB, '--json']));
  check('the fixture plants one lost path and accounts for the rest', noLoss?.ok === false && noLoss.lost.join() === LOST && noLoss.counts.moved === 1 && noLoss.counts.archived === 1 && noLoss.counts['in-place'] === 1, JSON.stringify(noLoss));
  const found = json(await run(SCRIPT, ['findability', '--root', bare, '--hub', HUB, '--json']));
  check('the fixture plants one unreachable note and leaves 80 Runs out', found?.ok === false && found.unreachablePaths.join() === ORPHAN && found.notes === 18, JSON.stringify(found));
  put(bare, FORWARDING, REPAIRED);
  const fixed = await run(SCRIPT, ['no-loss', '--root', bare, '--inventory', inventory, '--hub', HUB]);
  check('a forwarding entry for the runbook closes the loss', fixed.status === 0 && /moved: 2/.test(fixed.out), fixed.all);

  // the state machine against the real script
  const real = await liveRun(SCRIPT);
  check('state init creates the file once', real.init.status === 0 && real.reinit === 1, real.init.all);
  for (const [name, entry] of Object.entries(CASES)) check(`live run, case ${name}`, entry.holds(real), JSON.stringify(real));
  const seeded = await facts(SCRIPT, Object.keys(SEGMENTS));
  for (const [name, entry] of Object.entries(CASES)) check(`seeded run, case ${name}`, entry.holds(seeded), JSON.stringify(seeded));
  const again = {};
  await ordering(context(SCRIPT), again);
  check('the same verbs twice leave the same state bytes', again.bytes === seeded.bytes);

  const facade = await run(join(SCRIPTS, 'co.mjs'), ['docs', 'distill', 'state', 'show', '--state', join(work, 'absent-state.json')]);
  check('co docs distill reaches the state verbs', facade.status === 2 && /cannot read state/.test(facade.err), facade.all);
  const bogus = await run(SCRIPT, ['state', 'bogus', '--state', join(work, 'absent-state.json')]);
  check('an unknown state verb exits 2', bogus.status === 2 && /usage: state/.test(bogus.err), bogus.all);

  // mutants
  for (const { mutant, f } of await Promise.all(mutantRuns)) {
    for (const name of mutant.pins) check(`mutant "${mutant.name}" fails case ${name}`, !CASES[name].holds(f));
  }
} catch (error) {
  check('eval ran to completion', false, error.stack);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} distill vault check(s) failed:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK: distill vault regression eval passed.');
