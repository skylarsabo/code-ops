#!/usr/bin/env node
// Provider-neutral planner and deterministic scorer for local judgment evals.
// The host dispatches read-only model workers from the generated units; this script
// binds the exact fixture, skill, model, candidate, and score evidence into one receipt.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertNoAmbiguousIndexFlags,
  assertNoSymlinkComponents,
  assertNoTrackedPortableAlias,
  assertTrackedStage0RegularFiles,
  atomicWrite,
  canonical,
  checkedPath,
  digestJson,
  git,
  gitText,
  portableKey,
  readJson,
  safeRelative,
  samePhysicalFile,
  sha256,
} from './context-index-lib.mjs';

const DEFAULT_MATRIX = 'evals/judgment-matrix.json';
// `register` is the arm mode: a fixture declares which model tiers its register-producing skill
// runs at, and the planner compiles one unit per declared tier against the same answer key. It
// leaves the trend and floor expansions untouched, so the registered 2x2 asymmetry is unchanged.
const MODES = ['trend', 'floor', 'register'];
const TIERS = ['strong', 'weak'];
const ARMS = ['skill', 'control', 'register'];
const EXECUTION_POLICIES = ['available', 'unavailable'];
const PLAN_VERSION = 1;
const RECEIPT_VERSION = 1;
const DIGEST = /^[0-9a-f]{64}$/;
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_FINDINGS_BYTES = 4 * 1024 * 1024;

function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
function usage() {
  die('usage: judgment-evals.mjs plan --root <repo> --mode trend|floor|register --execution available|unavailable --out <ignored-path> --strong-model <id> [--weak-model <id>] [--matrix <path>]\n'
    + '       judgment-evals.mjs check-plan --root <repo> --plan <path>\n'
    + '       judgment-evals.mjs score --root <repo> --plan <path> --out <ignored-path>\n'
    + '       judgment-evals.mjs check-receipt --root <repo> --plan <path> --receipt <ignored-path>', 2);
}

function flags(args, known) {
  const out = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!known.has(key) || out[key] !== undefined) usage();
    const value = args[++index];
    if (!value || value.startsWith('--')) usage();
    out[key] = value;
  }
  return out;
}

function ignored(root, value, label, mustExist = false) {
  if (!safeRelative(value)) throw new Error(`${label} must be a repository-relative portable path`);
  const absolute = checkedPath(root, value);
  assertNoSymlinkComponents(root, absolute, label);
  assertNoTrackedPortableAlias(root, value, label);
  if (mustExist && (!existsSync(absolute) || !statSync(absolute).isFile())) throw new Error(`${label} must name an existing file`);
  try { git(root, ['check-ignore', '-q', '--no-index', '--', value]); }
  catch { throw new Error(`${label} must be ignored by Git`); }
  return { relative: value, absolute };
}

function trackedFile(root, value, label) {
  if (!safeRelative(value)) throw new Error(`${label} has an unsafe path`);
  const absolute = checkedPath(root, value);
  assertTrackedStage0RegularFiles(root, [value], label);
  return { path: value, sha256: sha256(readFileSync(absolute)) };
}

function treeDigest(root, path) {
  if (!safeRelative(path)) throw new Error(`fixture target has an unsafe path: ${path}`);
  const entries = git(root, ['ls-files', '-s', '-z', '--', path]);
  if (!entries.length) throw new Error(`fixture target has no tracked files: ${path}`);
  return sha256(entries);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || canonical(Object.keys(value).sort()) !== canonical([...keys].sort())) {
    throw new Error(`${label} has unexpected or missing fields`);
  }
}

function matrixState(root, path) {
  const file = trackedFile(root, path, 'judgment matrix');
  const value = readJson(checkedPath(root, path));
  exactKeys(value, ['version', 'fixtures'], 'judgment matrix');
  if (value.version !== 1 || !Array.isArray(value.fixtures) || !value.fixtures.length) throw new Error('judgment matrix is malformed');
  const ids = new Set();
  const fixtures = value.fixtures.map((fixture) => {
    // `arms` is the only optional field, and it names model tiers, so a fixture that declares none
    // keeps the exact shape every earlier plan was validated against.
    const declaresArms = !!fixture && typeof fixture === 'object' && !Array.isArray(fixture) && 'arms' in fixture;
    exactKeys(fixture, declaresArms ? ['id', 'target', 'answerKey', 'skillDocs', 'arms'] : ['id', 'target', 'answerKey', 'skillDocs'],
      `fixture ${fixture?.id || '<unknown>'}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fixture.id || '') || ids.has(fixture.id)
      || !safeRelative(fixture.target) || !safeRelative(fixture.answerKey)
      || !Array.isArray(fixture.skillDocs) || !fixture.skillDocs.length
      || fixture.skillDocs.some((entry) => !safeRelative(entry))
      || (declaresArms && (!Array.isArray(fixture.arms) || !fixture.arms.length
        || fixture.arms.some((tier) => !TIERS.includes(tier))
        || new Set(fixture.arms).size !== fixture.arms.length))) throw new Error('judgment matrix fixture is malformed');
    ids.add(fixture.id);
    return {
      ...fixture,
      answerKeySha256: trackedFile(root, fixture.answerKey, 'answer key').sha256,
      skillDocs: fixture.skillDocs.map((entry) => trackedFile(root, entry, 'skill document')),
      targetTreeSha256: treeDigest(root, fixture.target),
    };
  });
  return { path, sha256: file.sha256, fixtures };
}

function clean(root) {
  assertNoAmbiguousIndexFlags(root);
  return git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).length === 0;
}

function planSha256(plan) {
  const { planSha256: omitted, ...body } = plan;
  return digestJson(body);
}

function unitId(fixture, tier, arm, rep) { return `${fixture}-${tier}-${arm}-r${rep}`; }

function unitsFor(fixtures, mode, strongModel, weakModel, planFolder) {
  const units = [];
  const add = (fixture, tier, model, arm, rep) => {
    const id = unitId(fixture.id, tier, arm, rep);
    units.push({
      id,
      fixture: fixture.id,
      tier,
      model,
      arm,
      rep,
      target: fixture.target,
      skillDocs: arm === 'control' ? [] : fixture.skillDocs.map((entry) => entry.path),
      findingsPath: `${planFolder}/findings/${id}.json`,
    });
  };
  for (const fixture of fixtures) {
    if (mode === 'trend') add(fixture, 'strong', strongModel, 'skill', 1);
    // One unit per declared tier, same skill, same answer key: the arm varies the model tier and
    // nothing else, which is what makes the two resulting registers comparable.
    else if (mode === 'register') for (const tier of fixture.arms ?? []) add(fixture, tier, tier === 'strong' ? strongModel : weakModel, 'register', 1);
    else {
      for (const arm of ['skill', 'control']) add(fixture, 'strong', strongModel, arm, 1);
      for (const arm of ['skill', 'control']) for (const rep of [1, 2, 3]) add(fixture, 'weak', weakModel, arm, rep);
    }
  }
  return units;
}

function validatePlanShape(plan) {
  exactKeys(plan, ['version', 'mode', 'execution', 'headSha', 'matrix', 'models', 'units', 'createdAt', 'planSha256'], 'judgment plan');
  exactKeys(plan.matrix, ['path', 'sha256', 'fixtures'], 'judgment plan matrix');
  exactKeys(plan.models, ['strong', 'weak'], 'judgment plan models');
  if (plan.version !== PLAN_VERSION || !MODES.includes(plan.mode) || !EXECUTION_POLICIES.includes(plan.execution) || !SHA.test(plan.headSha || '')
    || !safeRelative(plan.matrix.path) || !DIGEST.test(plan.matrix.sha256 || '')
    || !Array.isArray(plan.matrix.fixtures) || !plan.matrix.fixtures.length
    || typeof plan.models.strong !== 'string' || !plan.models.strong
    || (plan.mode === 'trend' ? plan.models.weak !== null : !(typeof plan.models.weak === 'string' && plan.models.weak))
    || !Array.isArray(plan.units) || !plan.units.length || Number.isNaN(Date.parse(plan.createdAt || ''))
    || !DIGEST.test(plan.planSha256 || '') || planSha256(plan) !== plan.planSha256) throw new Error('judgment plan is malformed or self-inconsistent');
  const ids = new Set();
  for (const unit of plan.units) {
    exactKeys(unit, ['id', 'fixture', 'tier', 'model', 'arm', 'rep', 'target', 'skillDocs', 'findingsPath'], `judgment unit ${unit?.id || '<unknown>'}`);
    if (!/^[a-z0-9-]+$/.test(unit.id || '') || ids.has(unit.id) || !TIERS.includes(unit.tier)
      || !ARMS.includes(unit.arm) || ![1, 2, 3].includes(unit.rep)
      || typeof unit.model !== 'string' || !unit.model || !safeRelative(unit.target)
      || !Array.isArray(unit.skillDocs) || unit.skillDocs.some((entry) => !safeRelative(entry))
      || (unit.arm === 'control') !== (unit.skillDocs.length === 0) || !safeRelative(unit.findingsPath)) throw new Error('judgment plan unit is malformed');
    ids.add(unit.id);
  }
  if (plan.mode !== 'trend' && portableKey(plan.models.strong) === portableKey(plan.models.weak)) {
    throw new Error(`${plan.mode} mode requires distinct strong and weak model IDs`);
  }
}

function loadCurrent(root, argument) {
  if (!clean(root)) throw new Error('commit all tracked and untracked changes before using a judgment plan');
  const path = ignored(root, argument, 'judgment plan', true);
  const plan = readJson(path.absolute);
  validatePlanShape(plan);
  if (gitText(root, ['rev-parse', 'HEAD']) !== plan.headSha) throw new Error('judgment plan HEAD drift');
  const matrix = matrixState(root, plan.matrix.path);
  if (matrix.sha256 !== plan.matrix.sha256 || digestJson(matrix.fixtures) !== digestJson(plan.matrix.fixtures)) throw new Error('judgment fixture, key, or skill input drift');
  const planFolder = path.relative.slice(0, path.relative.lastIndexOf('/'));
  const expectedUnits = unitsFor(matrix.fixtures, plan.mode, plan.models.strong, plan.models.weak, planFolder);
  if (digestJson(expectedUnits) !== digestJson(plan.units)) throw new Error('judgment plan units do not match the canonical matrix expansion');
  for (const unit of plan.units) ignored(root, unit.findingsPath, `findings path for ${unit.id}`);
  return { plan, path };
}

function scoreUnit(root, scorerPath, unit, answerKey, execution) {
  const findings = ignored(root, unit.findingsPath, `findings for ${unit.id}`, true);
  const bytes = readFileSync(findings.absolute);
  if (!bytes.length || bytes.length > MAX_FINDINGS_BYTES) throw new Error(`findings for ${unit.id} are empty or exceed the size limit`);
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`findings for ${unit.id} are not valid JSON`); }
  if (!Array.isArray(parsed) || parsed.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry)
    || typeof entry.file !== 'string' || !Number.isInteger(entry.line))) throw new Error(`findings for ${unit.id} must be an array of {file,line} objects`);
  let output;
  try {
    const args = [scorerPath, answerKey, findings.absolute, '--no-exit'];
    if (execution === 'unavailable') args.push('--no-exec');
    output = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const detail = `${error.stdout || ''}${error.stderr || ''}`.trim();
    throw new Error(`scorer failed for ${unit.id}${detail ? `: ${detail}` : ''}`);
  }
  const verdict = /Verdict:\s+PASS\b/.test(output) ? 'PASS' : /Verdict:\s+FAIL\b/.test(output) ? 'FAIL' : null;
  if (!verdict) throw new Error(`scorer produced no verdict for ${unit.id}`);
  return { id: unit.id, findingsSha256: sha256(bytes), findingsBytes: bytes.length, verdict, scoreSha256: sha256(output), score: output.trim() };
}

function scoreUnits(root, scorerPath, plan) {
  const keys = new Map(plan.matrix.fixtures.map((fixture) => [fixture.id, fixture.answerKey]));
  return plan.units.map((unit) => {
    const answerKey = keys.get(unit.fixture);
    if (!answerKey) throw new Error(`answer key binding is missing for ${unit.id}`);
    return scoreUnit(root, scorerPath, unit, answerKey, plan.execution);
  });
}

function receiptSha256(receipt) {
  const { receiptSha256: omitted, ...body } = receipt;
  return digestJson(body);
}

function validateScoreReceipt(root, current, argument) {
  const path = ignored(root, argument, 'judgment score receipt', true);
  const receipt = readJson(path.absolute);
  exactKeys(receipt, ['version', 'planSha256', 'headSha', 'execution', 'recordedAt', 'completedUnits', 'passingUnits', 'scores', 'receiptSha256'], 'judgment score receipt');
  if (receipt.version !== RECEIPT_VERSION || receipt.planSha256 !== current.plan.planSha256
    || receipt.headSha !== current.plan.headSha || receipt.execution !== current.plan.execution || Number.isNaN(Date.parse(receipt.recordedAt || ''))
    || !Number.isSafeInteger(receipt.completedUnits) || receipt.completedUnits !== current.plan.units.length
    || !Number.isSafeInteger(receipt.passingUnits) || receipt.passingUnits < 0
    || !Array.isArray(receipt.scores) || receipt.scores.length !== current.plan.units.length
    || !DIGEST.test(receipt.receiptSha256 || '') || receiptSha256(receipt) !== receipt.receiptSha256) {
    throw new Error('judgment score receipt is malformed, stale, or self-inconsistent');
  }
  for (const score of receipt.scores) {
    exactKeys(score, ['id', 'findingsSha256', 'findingsBytes', 'verdict', 'scoreSha256', 'score'], `judgment score ${score?.id || '<unknown>'}`);
    if (typeof score.id !== 'string' || !DIGEST.test(score.findingsSha256 || '')
      || !Number.isSafeInteger(score.findingsBytes) || score.findingsBytes < 1
      || !['PASS', 'FAIL'].includes(score.verdict) || !DIGEST.test(score.scoreSha256 || '')
      || typeof score.score !== 'string' || !score.score) throw new Error('judgment score entry is malformed');
  }
  if (receipt.passingUnits !== receipt.scores.filter((entry) => entry.verdict === 'PASS').length) throw new Error('judgment passing-unit count is inconsistent');
  const scorer = trackedFile(root, 'evals/score.mjs', 'judgment scorer');
  const currentScores = scoreUnits(root, checkedPath(root, scorer.path), current.plan);
  if (digestJson(currentScores) !== digestJson(receipt.scores)) throw new Error('judgment findings or deterministic scores drifted after receipt creation');
  return { path, receipt };
}

const command = process.argv[2];
if (command === 'plan') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--mode', '--execution', '--out', '--strong-model', '--weak-model', '--matrix']));
  if (!f['--root'] || !f['--mode'] || !f['--execution'] || !f['--out'] || !f['--strong-model']) usage();
  try {
    const root = resolve(f['--root']);
    if (!MODES.includes(f['--mode'])) throw new Error(`mode must be one of: ${MODES.join(', ')}`);
    if (!EXECUTION_POLICIES.includes(f['--execution'])) throw new Error('execution must be available or unavailable');
    if (f['--mode'] !== 'trend' && !f['--weak-model']) throw new Error(`${f['--mode']} mode requires --weak-model`);
    if (f['--mode'] !== 'trend' && portableKey(f['--strong-model']) === portableKey(f['--weak-model'])) {
      throw new Error(`${f['--mode']} mode requires distinct strong and weak model IDs`);
    }
    if (!clean(root)) throw new Error('commit all tracked and untracked changes before planning judgment evals');
    const out = ignored(root, f['--out'], 'judgment plan output');
    const matrix = matrixState(root, f['--matrix'] || DEFAULT_MATRIX);
    if (f['--mode'] === 'register' && !matrix.fixtures.some((fixture) => fixture.arms?.length)) {
      throw new Error('register mode needs at least one matrix fixture declaring arms');
    }
    const planFolder = out.relative.includes('/') ? out.relative.slice(0, out.relative.lastIndexOf('/')) : '';
    if (!planFolder) throw new Error('judgment plan output must live in an ignored run directory');
    const plan = {
      version: PLAN_VERSION,
      mode: f['--mode'],
      execution: f['--execution'],
      headSha: gitText(root, ['rev-parse', 'HEAD']),
      matrix,
      models: { strong: f['--strong-model'], weak: f['--mode'] === 'trend' ? null : f['--weak-model'] },
      units: unitsFor(matrix.fixtures, f['--mode'], f['--strong-model'], f['--weak-model'], planFolder),
      createdAt: new Date().toISOString(),
      planSha256: null,
    };
    plan.planSha256 = planSha256(plan);
    validatePlanShape(plan);
    atomicWrite(out.absolute, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`ok judgment plan ${plan.planSha256} ${plan.units.length} unit(s)`);
  } catch (error) { die(error.message); }
} else if (command === 'check-plan') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--plan']));
  if (!f['--root'] || !f['--plan']) usage();
  try {
    const current = loadCurrent(resolve(f['--root']), f['--plan']);
    console.log(`ok judgment plan ${current.plan.planSha256} ${current.plan.units.length} unit(s)`);
  } catch (error) { die(error.message); }
} else if (command === 'score') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--plan', '--out']));
  if (!f['--root'] || !f['--plan'] || !f['--out']) usage();
  try {
    const root = resolve(f['--root']);
    const current = loadCurrent(root, f['--plan']);
    const out = ignored(root, f['--out'], 'judgment score output');
    const findings = current.plan.units.map((unit) => ignored(root, unit.findingsPath, `findings path for ${unit.id}`));
    if (portableKey(out.relative) === portableKey(current.path.relative)
      || findings.some((entry) => portableKey(entry.relative) === portableKey(out.relative))
      || [current.path, ...findings].some((entry) => samePhysicalFile(entry.absolute, out.absolute))) {
      throw new Error('judgment score output must not overwrite its plan or findings');
    }
    const scorer = trackedFile(root, 'evals/score.mjs', 'judgment scorer');
    const scores = scoreUnits(root, checkedPath(root, scorer.path), current.plan);
    const receipt = {
      version: RECEIPT_VERSION,
      planSha256: current.plan.planSha256,
      headSha: current.plan.headSha,
      execution: current.plan.execution,
      recordedAt: new Date().toISOString(),
      completedUnits: scores.length,
      passingUnits: scores.filter((entry) => entry.verdict === 'PASS').length,
      scores,
      receiptSha256: null,
    };
    receipt.receiptSha256 = receiptSha256(receipt);
    atomicWrite(out.absolute, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`ok judgment scores ${receipt.passingUnits}/${receipt.completedUnits} passing; receipt ${receipt.receiptSha256}`);
  } catch (error) { die(error.message); }
} else if (command === 'check-receipt') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--plan', '--receipt']));
  if (!f['--root'] || !f['--plan'] || !f['--receipt']) usage();
  try {
    const root = resolve(f['--root']);
    const current = loadCurrent(root, f['--plan']);
    const checked = validateScoreReceipt(root, current, f['--receipt']);
    console.log(`ok judgment receipt ${checked.receipt.receiptSha256} ${checked.receipt.passingUnits}/${checked.receipt.completedUnits} passing`);
  } catch (error) { die(error.message); }
} else usage();
