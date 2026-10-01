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
//   - phase 8 (install): the baseline verb and `done 8` refuse while a path is lost, while the inventory
//     counts disagree, and while a note is unreachable, and write nothing then; a clean tree yields a
//     sorted, dateless baseline with the same bytes on every run, and `done 8` writes it too; the
//     baseline cites copies of its inventories in the hub, a refused install copies nothing, and a
//     re-run removes a copy the new baseline does not cite;
//   - the gate: it holds on the baseline tree, also with the run-folder inventory deleted, and exits 1 on a new loss, a new unreachable note, and
//     a changed inventory;
//   - the maintain pass: it starts only after phase 8 is done and needs a budget, an item counts once,
//     the round that reaches the budget stops the pass at a checkpoint, a checkpointed pass resumes,
//     and the pass ends only on a passing gate check;
//   - the same verbs twice leave the same state bytes.
// One live run walks phase 1 to phase 8 and a maintain pass through the real verbs. Every other case starts from a
// state file written for its phase, so a mutant run costs a few spawns and not a whole walk.
//
// The mutants: each copy of the script breaks one rule, and the case that pins the rule must
// change its verdict. A case no mutant can fail asserts nothing, so this eval fails on one.
//
//   node evals/distill-vault/run.mjs   (exit 0 = pass)

import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const BASELINE = `${HUB}/98 System/DISTILL_BASELINE.json`;
const TRIAGE = `${HUB}/98 System/TRIAGE.md`;
const INDEX = `${HUB}/10 Design/INDEX.md`;
const STRAY = `${HUB}/10 Design/stray.md`;
const INVENTORY = 'inventory/docs.json';
const COPIES = `${HUB}/98 System/DISTILL_INVENTORIES`;
const COPY = `${COPIES}/inventory-1.json`;
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
  const tool = (sub, ...flags) => run(script, [sub, '--root', repo, ...flags]);
  return { repo, stateFile, st, read, phaseOf, batchOf, enter, live, seed, tool, script };
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
}

const fixtureText = (rel) => readFileSync(join(FIXTURE, rel), 'utf8');
const baselineVerb = (c) => c.tool('baseline', '--hub', HUB, '--inventory', INVENTORY);

// The tree the install check refuses: the fixture's own forwarding file and index, one triage queue.
function plant(c) {
  put(c.repo, FORWARDING, fixtureText(FORWARDING));
  put(c.repo, INDEX, fixtureText(INDEX));
  put(c.repo, TRIAGE, '- docs/old-notes.md | archive | 2026-09-30\n- vault/10 Design/drafts/onboarding-plan.md | current | 2026-09-30\n');
}
// The same tree with the loss closed and the orphan linked.
function repair(c) {
  put(c.repo, FORWARDING, REPAIRED);
  put(c.repo, INDEX, `${fixtureText(INDEX)}- [Orphan notes](orphan-notes.md)\n`);
}

async function install(c, f) {
  const { st } = c;
  await c.enter(8, 'running');
  plant(c);
  f.earlyStart = (await st('maintain-start', null, '--budget', '3')).status;
  await st('checkpoint', 8, '--artifact', TRIAGE);

  const lossBase = await baselineVerb(c);
  f.baselineLoss = lossBase.status === 1 && lossBase.all.includes(`LOSS ${LOST}`) && !existsSync(join(c.repo, BASELINE));
  const lossDone = await st('done', 8, '--review', 'read the baseline');
  f.doneLoss = lossDone.status === 1 && lossDone.all.includes(`LOSS ${LOST}`) && c.phaseOf(8)?.status === 'checkpointed' && !existsSync(join(c.repo, BASELINE));

  put(c.repo, FORWARDING, REPAIRED);
  const orphanBase = await baselineVerb(c);
  f.baselineOrphan = orphanBase.status === 1 && orphanBase.all.includes(`UNREACHABLE ${ORPHAN}`) && !existsSync(join(c.repo, BASELINE));
  const orphanDone = await st('done', 8, '--review', 'read the baseline');
  f.doneOrphan = orphanDone.status === 1 && orphanDone.all.includes(`UNREACHABLE ${ORPHAN}`) && c.phaseOf(8)?.status === 'checkpointed' && !existsSync(join(c.repo, BASELINE));

  repair(c);
  const inventory = JSON.parse(readFileSync(join(c.repo, INVENTORY), 'utf8'));
  put(c.repo, INVENTORY, `${JSON.stringify({ ...inventory, count: inventory.count + 1 }, null, 2)}\n`);
  const mismatch = await baselineVerb(c);
  f.baselineMismatch = mismatch.status === 1 && /MISMATCH/.test(mismatch.all) && !existsSync(join(c.repo, BASELINE));
  f.refusalsCopyNothing = !existsSync(join(c.repo, COPIES));
  put(c.repo, INVENTORY, fixtureText(INVENTORY));

  const first = await baselineVerb(c);
  const text = existsSync(join(c.repo, BASELINE)) ? readFileSync(join(c.repo, BASELINE), 'utf8') : '';
  const second = await baselineVerb(c);
  const doc = (() => { try { return JSON.parse(text); } catch { return null; } })();
  f.baselineOk = first.status === 0 && second.status === 0 && text === (existsSync(join(c.repo, BASELINE)) ? readFileSync(join(c.repo, BASELINE), 'utf8') : null);
  f.baselineDoc = doc && { copy: existsSync(join(c.repo, COPY)) && readFileSync(join(c.repo, COPY), 'utf8') === fixtureText(INVENTORY), inventories: doc.inventories.map((i) => `${i.path}:${i.inputs}:${i.accounted}:${i.counts['in-place']}${i.counts.moved}${i.counts.archived}`).join(), noLoss: doc.noLoss, findability: doc.findability, triage: doc.triage, dateless: !/\d{4}-\d{2}-\d{2}/.test(text) };
  rmSync(join(c.repo, BASELINE), { force: true });
  f.doneEight = (await st('done', 8, '--review', 'read the baseline')).status;
  f.doneEightWrote = existsSync(join(c.repo, BASELINE)) && readFileSync(join(c.repo, BASELINE), 'utf8') === text && c.phaseOf(8)?.checks?.baseline === BASELINE && c.phaseOf(8).checks.findability?.unreachable === 0;
  const shown = json(await st('show', null, '--json'));
  f.afterEight = shown && { next: shown.next, done: shown.phases.filter((p) => p.status === 'done').length };
}

// The tree at the baseline: phases 1 to 8 done, the loss closed, the orphan linked, one baseline.
async function atBaseline(c) {
  if (!c.live) c.seed(9, 'done');
  plant(c);
  repair(c);
  return baselineVerb(c);
}

async function maintain(c, f) {
  const { st } = c;
  await atBaseline(c);
  const gate = () => c.tool('gate', '--hub', HUB);
  const pass = () => c.read()?.maintain;
  f.gateClean = (await gate()).status;
  f.noBudget = (await st('maintain-start', null)).status;
  f.roundNoPass = (await st('maintain-round', null, '--item', 'docs/guide.md')).status;
  f.start = (await st('maintain-start', null, '--budget', '2')).status;
  f.round1 = (await st('maintain-round', null, '--item', 'docs/guide.md')).status;
  f.sameItem = (await st('maintain-round', null, '--item', 'docs/guide.md')).status;
  f.restartRunning = (await st('maintain-start', null, '--budget', '2')).status;
  f.round2 = (await st('maintain-round', null, '--item', 'docs/old-notes.md')).status;
  f.budgetStop = pass()?.status === 'checkpointed' && pass().checkpoint?.reason === 'budget' && pass().rounds === 2 && pass().worked.length === 2;
  f.pastBudget = (await st('maintain-round', null, '--item', 'docs/kept.md')).status;
  const shown = json(await st('show', null, '--json'));
  f.stopNext = shown?.next?.action === 'maintain-start' && shown.maintain?.status === 'checkpointed';
  f.resume = (await st('maintain-start', null)).status === 0 && pass()?.status === 'running' && pass().rounds === 0 && pass().budget === 2 && pass().worked.length === 2;

  const runbook = `${HUB}/10 Design/runbook.md`;
  const original = readFileSync(join(c.repo, runbook), 'utf8');
  rmSync(join(c.repo, runbook), { force: true });
  const lost = await gate();
  f.gateLoss = lost.status === 1 && lost.all.includes(`LOSS ${LOST}`);
  f.endNoReview = (await st('maintain-done', null)).status;
  const lossDone = await st('maintain-done', null, '--review', 'read the worked items');
  f.endLoss = lossDone.status === 1 && lossDone.all.includes(`LOSS ${LOST}`) && pass()?.status === 'running';
  put(c.repo, runbook, original);
  f.gateRestored = (await gate()).status;

  put(c.repo, STRAY, '# Stray note\n\nNo index links this note.\n');
  const stray = await gate();
  f.gateUnreachable = stray.status === 1 && stray.all.includes(`UNREACHABLE ${STRAY}`);
  const strayDone = await st('maintain-done', null, '--review', 'read the worked items');
  f.endUnreachable = strayDone.status === 1 && strayDone.all.includes(`UNREACHABLE ${STRAY}`) && pass()?.status === 'running';
  rmSync(join(c.repo, STRAY), { force: true });

  const inventory = JSON.parse(readFileSync(join(c.repo, COPY), 'utf8'));
  const kept = inventory.files.filter((file) => file.path !== 'docs/kept.md');
  put(c.repo, COPY, `${JSON.stringify({ ...inventory, count: kept.length, files: kept }, null, 2)}\n`);
  const changed = await gate();
  f.gateInventory = changed.status === 1 && changed.all.includes(`CHANGED ${COPY}`);
  put(c.repo, COPY, fixtureText(INVENTORY));

  f.maintainDone = (await st('maintain-done', null, '--review', 'read the worked items')).status;
  f.maintainChecks = pass()?.status === 'done' && pass().checks?.findability?.unreachable === 0 && pass().review === 'read the worked items';
  f.roundAfterDone = (await st('maintain-round', null, '--item', 'docs/kept.md')).status;
  f.nextPass = (await st('maintain-start', null, '--budget', '1')).status === 0 && pass()?.pass === 2 && pass().worked.length === 0;
}

// The baseline carries its own inventories: the copies sit in the hub, a rerun yields the same bytes,
// and the gate holds in a tree with no run-folder inventory, even after a new hub inventory lists the copies.
async function copies(c, f) {
  await atBaseline(c);
  const read = (rel) => (existsSync(join(c.repo, rel)) ? readFileSync(join(c.repo, rel), 'utf8') : null);
  const gate = () => c.tool('gate', '--hub', HUB);
  const before = [read(BASELINE), read(COPY)];
  f.rerunSame = (await baselineVerb(c)).status === 0 && before[0] !== null && before[1] === fixtureText(INVENTORY) && read(BASELINE) === before[0] && read(COPY) === before[1];

  put(c.repo, `${COPIES}/inventory-9.json`, '{}\n');
  const rerun = await baselineVerb(c);
  f.staleRemoved = rerun.status === 0 && !existsSync(join(c.repo, COPIES, 'inventory-9.json')) && read(BASELINE) === before[0];

  const doc = (() => { try { return JSON.parse(read(BASELINE)); } catch { return null; } })();
  f.recordsCopy = doc?.inventories?.map((i) => i.path).join() === COPY;
  rmSync(join(c.repo, INVENTORY), { force: true });
  f.gateNoSource = (await gate()).status;
  const listed = join(c.repo, 'after-copies.json');
  await run(c.script, ['inventory', '--root', c.repo, '--hub', HUB, '--out', listed]);
  f.listsCopy = readFileSync(listed, 'utf8').includes(COPY);
  f.gateAfterInventory = (await gate()).status;

  // A copy already in the folder is cited as is, with the source gone.
  const inFolder = await c.tool('baseline', '--hub', HUB, '--inventory', COPY);
  f.inFolderAsIs = inFolder.status === 0 && read(BASELINE) === before[0] && read(COPY) === before[1] && walk(c.repo, `${COPIES}/`).join() === `${COPIES}/inventory-1.json`;
}

const SEGMENTS = { ordering, relocate, classify, chain, drafts, synthesis, install, maintain, copies };
const facts = async (script, names) => {
  const f = {};
  for (const name of names) await SEGMENTS[name](context(script), f);
  return f;
};
// The live run: one context, every segment in order, through the real verbs.
async function liveRun(script) {
  const c = context(script, true);
  const f = {};
  for (const name of Object.keys(SEGMENTS)) await SEGMENTS[name](c, f);
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
  phaseEightNext: { segment: 'synthesis', holds: (f) => f.doneSeven === 0 && f.show?.next?.phase === 8 && f.show.next.action === 'start' && f.show.last?.phase === 7 && f.show.done === 7 },
  installRefusesLoss: { segment: 'install', holds: (f) => f.baselineLoss === true && f.doneLoss === true },
  installRefusesMismatch: { segment: 'install', holds: (f) => f.baselineMismatch === true },
  installRefusesUnreachable: { segment: 'install', holds: (f) => f.baselineOrphan === true && f.doneOrphan === true },
  installWritesBaseline: { segment: 'install', holds: (f) => f.baselineOk === true && f.doneEight === 0 && f.doneEightWrote === true
    && f.baselineDoc?.copy === true && f.baselineDoc?.inventories === `${COPY}:4:4:121` && f.baselineDoc.noLoss?.inputs === 4 && f.baselineDoc.noLoss.accounted === 4
    && f.baselineDoc.findability?.notes === 19 && f.baselineDoc.findability.unreachable === 0 && f.baselineDoc.triage?.path === TRIAGE && f.baselineDoc.triage.entries === 2 },
  refusedInstallCopiesNothing: { segment: 'install', holds: (f) => f.refusalsCopyNothing === true },
  baselineIsSelfContained: { segment: 'copies', holds: (f) => f.recordsCopy === true && f.gateNoSource === 0 && f.listsCopy === true && f.gateAfterInventory === 0 },
  baselineRerunIsIdempotent: { segment: 'copies', holds: (f) => f.rerunSame === true && f.staleRemoved === true && f.inFolderAsIs === true },
  baselineIsDateless: { segment: 'install', holds: (f) => f.baselineDoc?.dateless === true },
  installIsLast: { segment: 'install', holds: (f) => f.afterEight?.done === 8 && f.afterEight.next === null },
  maintainNeedsInstall: { segment: 'install', holds: (f) => f.earlyStart === 1 },
  gateHoldsBaseline: { segment: 'maintain', holds: (f) => f.gateClean === 0 && f.gateRestored === 0 },
  gateNewLoss: { segment: 'maintain', holds: (f) => f.gateLoss === true },
  gateNewUnreachable: { segment: 'maintain', holds: (f) => f.gateUnreachable === true },
  gateChangedInventory: { segment: 'maintain', holds: (f) => f.gateInventory === true },
  maintainNeedsBudget: { segment: 'maintain', holds: (f) => f.noBudget === 2 && f.start === 0 },
  maintainOnlyRunning: { segment: 'maintain', holds: (f) => f.roundNoPass === 1 && f.pastBudget === 1 && f.restartRunning === 1 && f.roundAfterDone === 1 },
  maintainItemOnce: { segment: 'maintain', holds: (f) => f.round1 === 0 && f.sameItem === 1 },
  maintainBudgetStop: { segment: 'maintain', holds: (f) => f.round2 === 0 && f.budgetStop === true && f.stopNext === true },
  maintainResume: { segment: 'maintain', holds: (f) => f.resume === true },
  maintainEndsOnGate: { segment: 'maintain', holds: (f) => f.endNoReview === 2 && f.endLoss === true && f.endUnreachable === true && f.maintainDone === 0 && f.maintainChecks === true && f.nextPass === true },
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
  { name: 'installs past a lost path', replace: ['for (const item of report.lost) problems.push(`LOSS ${item}`);', ''], pins: ['installRefusesLoss'] },
  { name: 'installs past an inventory count mismatch', replace: ['for (const item of report.problems) problems.push(`MISMATCH ${item}`);', ''], pins: ['installRefusesMismatch'] },
  { name: 'installs past an unreachable note', replace: ['for (const path of found.unreachablePaths ?? []) problems.push(`UNREACHABLE ${path}`);', ''], pins: ['installRefusesUnreachable'] },
  { name: 'finishes phase 8 with no install check', replace: ['if (n === INSTALL) phase.checks = installChecks(root, doc);', 'if (false) phase.checks = installChecks(root, doc);'], pins: ['installRefusesLoss', 'installRefusesUnreachable'] },
  { name: 'writes no baseline', replace: ['writeFileSync(join(root, path), `${JSON.stringify(document, null, 2)}\\n`);', ''], pins: ['installWritesBaseline'] },
  { name: 'records the source path and not the copy', replace: ['document.inventories = document.inventories.map((entry) => ({ ...entry, path: placed.get(entry.path) }))', 'document.inventories = document.inventories.map((entry) => ({ ...entry, path: entry.path }))'], pins: ['baselineIsSelfContained', 'installWritesBaseline'] },
  { name: 'copies the inventories before the install refusal', replace: ['if (problems.length) refuseOn(problems, \'install refused\');', 'placeInventories(root, hub, paths); if (problems.length) refuseOn(problems, \'install refused\');'], pins: ['refusedInstallCopiesNothing'] },
  { name: 'keeps a copy the new baseline does not cite', replace: ['!keep.has(`${folder}/${name}`)', 'false'], pins: ['baselineRerunIsIdempotent'] },
  { name: 'writes a date into the baseline', replace: ['version: BASELINE_VERSION,', 'version: BASELINE_VERSION, writtenAt: \'2026-09-30\','], pins: ['baselineIsDateless'] },
  { name: 'starts a maintain pass before phase 8 is done', replace: ['if (doc.phases[INSTALL - 1].status !== \'done\') refuse(', 'if (false) refuse('], pins: ['maintainNeedsInstall'] },
  { name: 'gate ignores a new loss', replace: ['const problems = [...now.problems];', 'const problems = now.problems.filter((line) => !line.startsWith(\'LOSS\'));'], pins: ['gateNewLoss'] },
  { name: 'gate ignores a new unreachable note', replace: ['const problems = [...now.problems];', 'const problems = now.problems.filter((line) => !line.startsWith(\'UNREACHABLE\'));'], pins: ['gateNewUnreachable'] },
  { name: 'gate ignores a changed inventory', replace: ['.digest !== was.digest', '.digest === undefined'], pins: ['gateChangedInventory'] },
  { name: 'starts a pass with no budget', replace: ['if (budget === null) die(', 'if (false) die('], pins: ['maintainNeedsBudget'] },
  { name: 'works a round with no running pass', replace: ['return pass?.status === \'running\' ? pass : refuse(', 'return pass ?? refuse('], pins: ['maintainOnlyRunning'] },
  { name: 'counts an item twice in one pass', replace: ['if (pass.worked.includes(flags.item)) refuse(', 'if (false) refuse('], pins: ['maintainItemOnce'] },
  { name: 'runs a maintain pass past its budget without a checkpoint', replace: ['if (pass.rounds >= pass.budget) Object.assign(', 'if (false) Object.assign('], pins: ['maintainBudgetStop'] },
  { name: 'resumes a pass with its old round count', replace: ['{ status: \'running\', rounds: 0, checkpoint: null,', '{ status: \'running\', checkpoint: null,'], pins: ['maintainResume'] },
  { name: 'ends a pass without the gate check', replace: ['if (ending.problems.length) refuseOn(', 'if (false) refuseOn('], pins: ['maintainEndsOnGate'] },
  { name: 'ends a pass with no review note', replace: ['if (!review) die(\'maintain-done needs', 'if (false) die(\'maintain-done needs'], pins: ['maintainEndsOnGate'] },
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
