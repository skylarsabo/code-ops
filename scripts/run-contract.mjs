#!/usr/bin/env node
// Fail-closed compiler for a bounded, auditable multi-agent run contract.
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TIER_ORDER, TIER_RANK, modelRankOf, modelSupportsTier, providerOfConfigSlug } from './model-tiers.mjs';
import { LEDGER_ROW_RE, LEDGER_STATUSES, replayDispatchJournal } from './ledger-grammar.mjs';
import { git, repoRelative, scopesIntersect, verifySnapshotReceipt } from './context-index-lib.mjs';
import { validateRuntimeConfig, verifyRuntimeConfig } from './runtime-lib.mjs';
import { ACCEPT_HEADER, actorError, parseAcceptance as readAcceptance } from './acceptance-lib.mjs';

const TOP_V1 = ['version', 'revision', 'runId', 'head', 'objective', 'nonGoals', 'lead', 'quality', 'budget', 'sharedContext', 'replanOn', 'units'];
const TOP_V2 = new Set([...TOP_V1, 'context']);
const TOP_V3 = new Set([...TOP_V2, 'runtime']);
const TOP_V4 = new Set([...TOP_V3, 'orchestration', 'calibration', 'routingPolicy']);
const OPTIONAL_TOP_V4 = new Set(['calibration', 'routingPolicy']);
const CALIBRATION = new Set(['arm', 'track']);
const CALIBRATION_ARMS = new Set(['b', 'c']);
const CONTEXT = new Set(['snapshot', 'snapshotId', 'bundleDir', 'untrackedPolicy', 'maxBundleBytes', 'maxAtlasExcerptBytes', 'maxScopeShare', 'requiredViewSections']);
const OPTIONAL_CONTEXT = new Set(['maxScopeShare', 'requiredViewSections']);
const LEAD = new Set(['model', 'tier', 'effort']);
const QUALITY = new Set(['dimensions', 'criteria']);
const CRITERION = new Set(['id', 'dimension', 'description', 'oracle', 'proof', 'blocking', 'owner']);
const BUDGET = new Set(['maxDispatches', 'maxParallel', 'maxRetriesPerUnit']);
const UNIT = new Set(['id', 'phase', 'wave', 'lens', 'mode', 'role', 'kind', 'model', 'tier', 'effort', 'brief', 'scope', 'artifact', 'dependsOn', 'qualityCriteria', 'tokenBudget']);
const UNIT_V4 = new Set([...UNIT, 'validates', 'independentOf', 'routingRationale', 'peerException']);
const OPTIONAL_UNIT = new Set(['tokenBudget']);
const OPTIONAL_UNIT_V4 = new Set([...OPTIONAL_UNIT, 'routingRationale', 'peerException']);
const ORCHESTRATION = new Set(['mode', 'minOperatives', 'minParallel', 'singleUnitReason']);
const OPTIONAL_ORCHESTRATION = new Set(['singleUnitReason']);
const TOKEN_BUDGET = new Set(['input', 'output', 'reasoning']);
const DIMENSIONS = new Set(['correctness', 'evidence', 'coverage', 'security', 'privacy', 'usability', 'performance', 'documentation', 'efficiency', 'maintainability']);
const ORACLES = new Set(['command', 'receipt', 'review', 'artifact']);
const OWNERS = new Set(['lead', 'reviewer', 'tool', 'user']);
const KINDS = new Set(['mechanical', 'breadth', 'execution', 'judgment', 'review', 'refutation']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const PEER_CLASSES = new Set(['architecture', 'refutation', 'mathematics', 'synthesis']);
const PEER_EXCEPTION = new Set(['class', 'rationale', 'stoppingCriterion']);
const VIEW_SECTIONS = new Set(['rows', 'context']);
const REPLAN = ['scope-change', 'new-dependency', 'failed-dispatch', 'quality-gate-failure'];
const REPLAN_V2 = [...REPLAN, 'context-drift'];
const REPLAN_V3 = [...REPLAN_V2, 'runtime-drift'];

function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
function usage() { die('usage: run-contract.mjs init --run <ignored run dir> --lead-model <id> [--lead-tier <tier>] [--lead-effort <effort>] [--host <name>] [--untracked metadata|exclude] [--atlas <dir>] [--stable-prefix <path>]... [--root <dir>] [--force]\n       run-contract.mjs check --contract <path> [--root <dir>]\n       run-contract.mjs reconcile --contract <path> --ledger <path> [--strict | --in-flight] [--root <dir>]\n       run-contract.mjs record --contract <path> --acceptance <path> --criterion Q-NNN --verdict PASS|FAIL|UNKNOWN|N/A --proof <text> --actor <role@model|tool|user> [--reason <text>]\n       run-contract.mjs finalize --contract <path> --acceptance <path> --dispatch-ledger <path> --result <path> [--root <dir>]', 2); }
function flags(args, known, booleans = new Set(), repeated = new Set()) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!known.has(key) || (!repeated.has(key) && out[key] !== undefined)) usage();
    if (booleans.has(key)) { out[key] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) usage();
    if (repeated.has(key)) (out[key] ??= []).push(value);
    else out[key] = value;
  }
  return out;
}
function exact(value, keys, label, errors, optional = new Set()) {
  if (!value || Array.isArray(value) || typeof value !== 'object') { errors.push(`${label} must be an object`); return; }
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`${label} has unknown key ${key}`);
  for (const key of keys) if (!optional.has(key) && !(key in value)) errors.push(`${label} is missing ${key}`);
}
function safePath(value) {
  return typeof value === 'string' && value.length > 0 && value !== '.' && !isAbsolute(value) && !value.includes('\\') && !value.split('/').includes('..') && !value.startsWith('./') && !value.endsWith('/') && !value.includes('//') && value.split('/').every((part) => part === part.trim() && !part.endsWith('.'));
}
function portablePath(value) { return value.normalize('NFC').toLowerCase(); }
function scopeKey(scope) { return scope.map(portablePath).sort().join('\0'); }
function words(value) { return value.trim().split(/\s+/).filter(Boolean).length; }
function tierFor(model, declared) { return modelSupportsTier(model, declared); }
function isValidator(unit) { return ['review', 'refutation'].includes(unit.kind); }
function gitHead(root) { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } }
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { die(`cannot parse ${path}: ${error.message}`); } }
function loadContract(path, root) { const contract = readJson(path); const warnings = []; const errors = validate(contract, root, warnings); for (const warning of warnings) console.log(`! ${warning}`); if (errors.length) die(`contract invalid:\n${errors.map((x) => `  - ${x}`).join('\n')}`); verifyContext(contract, path, root); return contract; }

function verifyContext(contract, contractPath, root) {
  if (contract.version < 2) return;
  const receiptPath = resolve(dirname(contractPath), contract.context.snapshot);
  try {
    const receipt = readJson(receiptPath);
    if (receipt.snapshotId !== contract.context.snapshotId) die('context snapshot ID does not match receipt');
    if (receipt.state?.untracked?.policy !== contract.context.untrackedPolicy) die('context untrackedPolicy does not match receipt');
    verifySnapshotReceipt(root, receipt);
    // WHY (calibration lesson L-057): rewriting every failure into snapshot drift told an
    // operator to prepare a new receipt for faults a new receipt cannot clear, including
    // generator drift, atlas drift, an unsupported untracked entry, a symlink escape, and a
    // git timeout or maxBuffer overflow on a large monorepo. Only an identifier mismatch is
    // drift; every other cause keeps its own message and says so.
  } catch (error) { die(error.message.includes('context snapshot drift') ? error.message : `${error.message}; this is not context snapshot drift, so a new receipt will not clear it`); }
  if (contract.version >= 3) {
    try { verifyRuntimeConfig(root, contract.runtime); }
    catch (error) { die(error.message); }
  }
}

function validate(c, root, warnings = []) {
  const errors = [];
  if (!c || Array.isArray(c) || typeof c !== 'object') return ['contract must be an object'];
  exact(c, c.version === 1 ? new Set(TOP_V1) : c.version === 2 ? TOP_V2 : c.version === 3 ? TOP_V3 : TOP_V4, 'contract', errors, OPTIONAL_TOP_V4);
  if (![1, 2, 3, 4].includes(c.version)) errors.push('version must be 1, 2, 3, or 4');
  if (c.version === 1 && ('context' in c || 'runtime' in c)) errors.push('version 1 must not contain context or runtime');
  if (c.version === 2 && 'runtime' in c) errors.push('version 2 must not contain runtime');
  if (c.version >= 2) {
    exact(c.context, CONTEXT, 'context', errors, OPTIONAL_CONTEXT);
    if (!safePath(c.context?.snapshot) || !safePath(c.context?.bundleDir)) errors.push('context snapshot and bundleDir must be safe relative paths');
    if (!/^[0-9a-f]{64}$/.test(c.context?.snapshotId || '')) errors.push('context.snapshotId must be lowercase SHA-256');
    if (!['metadata', 'exclude', 'allowlist'].includes(c.context?.untrackedPolicy)) errors.push('context.untrackedPolicy is invalid');
    for (const key of ['maxBundleBytes', 'maxAtlasExcerptBytes']) if (!Number.isInteger(c.context?.[key]) || c.context[key] < 1) errors.push(`context.${key} must be a positive integer`);
    // WHY (calibration lesson L-060): the share of the repository a unit may hold was a
    // literal in context-bundle.mjs, so a unit whose honest slice ran wider than a quarter of
    // the files had no contract-level way to say so. Raising it is a slice-design decision the
    // lead records here; the recursive-glob and risky-prefix triggers ignore it.
    if ('maxScopeShare' in (c.context || {}) && (typeof c.context.maxScopeShare !== 'number' || !Number.isFinite(c.context.maxScopeShare) || c.context.maxScopeShare <= 0 || c.context.maxScopeShare > 1)) errors.push('context.maxScopeShare must be a number greater than 0 and at most 1');
    if ('requiredViewSections' in (c.context || {}) && (!Array.isArray(c.context.requiredViewSections) || !c.context.requiredViewSections.length || new Set(c.context.requiredViewSections).size !== c.context.requiredViewSections.length || c.context.requiredViewSections.some((section) => !VIEW_SECTIONS.has(section)))) errors.push('context.requiredViewSections must be a nonempty unique array of rows or context');
  }
  if (c.version >= 3) errors.push(...validateRuntimeConfig(c.runtime));
  if (!Number.isInteger(c.revision) || c.revision < 1) errors.push('revision must be a positive integer');
  if (typeof c.runId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.runId)) errors.push('runId must be kebab-case');
  const head = gitHead(root); if (!head) errors.push('cannot resolve current git HEAD'); else if (c.head !== head) errors.push('head does not match current git HEAD');
  if (typeof c.objective !== 'string' || !c.objective.trim()) errors.push('objective must be nonempty');
  if (!Array.isArray(c.nonGoals) || !c.nonGoals.length || c.nonGoals.some((x) => typeof x !== 'string' || !x.trim())) errors.push('nonGoals must be a nonempty string array');
  exact(c.lead, LEAD, 'lead', errors);
  // WHY (operator decision, 2026-09-23): the lead block records the session model, which the
  // operator chose before any contract existed. It is validated for shape only; a weak or
  // unplaceable lead is a warning, and the unit floors below carry the quality guarantee.
  if (typeof c.lead?.model !== 'string' || !c.lead.model.trim() || !TIER_ORDER.includes(c.lead?.tier) || !EFFORTS.has(c.lead?.effort)) errors.push('lead must record a nonempty model, a known tier, and a known effort');
  else {
    if (TIER_RANK[c.lead.tier] < TIER_RANK.strong) warnings.push(`lead tier ${c.lead.tier} is below strong; keep judgment and review in strong operatives`);
    if (!tierFor(c.lead.model, c.lead.tier)) warnings.push(`lead model ${c.lead.model} is not placed at tier ${c.lead.tier} by the model registry`);
  }
  let calibrated = false;
  const taskBased = c.version === 4 && 'routingPolicy' in c;
  if (taskBased && c.routingPolicy !== 'task-based') errors.push('routingPolicy must be task-based');
  if (c.version === 4 && 'calibration' in c) {
    // The pre-registered calibration arms b and c run a strong lead on the assess-only track.
    // A valid block lets units run at, never above, the
    // lead tier, only for read-mode units whose artifacts land outside every assessed scope.
    // A lead model that also serves the frontier rung runs the frontier model, so the arm
    // could not measure the strong-versus-frontier gap it exists to measure.
    const before = errors.length;
    exact(c.calibration, CALIBRATION, 'calibration', errors);
    if (!CALIBRATION_ARMS.has(c.calibration?.arm)) errors.push('calibration.arm must be b or c');
    if (c.calibration?.track !== 'assess-only') errors.push('calibration.track must be assess-only');
    if (c.lead?.effort !== 'high') errors.push('calibration requires lead effort high');
    if (c.lead?.tier !== 'strong') errors.push('calibration requires a strong lead; a frontier lead declares no calibration block');
    else if (modelSupportsTier(c.lead.model, 'strong') && modelSupportsTier(c.lead.model, 'frontier')) errors.push(`calibration arm needs a lead model distinct from the frontier model; ${c.lead.model} serves both`);
    const units = Array.isArray(c.units) ? c.units : [];
    const scopes = units.flatMap((unit) => Array.isArray(unit?.scope) ? unit.scope.filter(safePath) : []);
    units.forEach((unit, index) => {
      const label = unit?.id || `D-${String(index + 1).padStart(3, '0')}`;
      if (unit?.mode !== 'read') errors.push(`${label} must use read mode on the assess-only calibration track`);
      if (safePath(unit?.artifact) && scopesIntersect([unit.artifact], scopes)) errors.push(`${label} artifact must stay outside every assessed scope on the assess-only calibration track`);
    });
    calibrated = errors.length === before;
  }
  if (taskBased && 'calibration' in c) errors.push('routingPolicy task-based cannot combine with calibration');
  exact(c.quality, QUALITY, 'quality', errors);
  if (!Array.isArray(c.quality?.dimensions) || !c.quality.dimensions.length || new Set(c.quality.dimensions).size !== c.quality.dimensions.length || c.quality.dimensions.some((x) => !DIMENSIONS.has(x))) errors.push('quality dimensions must be unique supported dimensions');
  const criterionIds = new Set();
  if (!Array.isArray(c.quality?.criteria) || !c.quality.criteria.length) errors.push('quality criteria must be nonempty');
  (c.quality?.criteria || []).forEach((item, index) => {
    exact(item, CRITERION, `criterion ${index + 1}`, errors);
    const expected = `Q-${String(index + 1).padStart(3, '0')}`;
    if (item.id !== expected || criterionIds.has(item.id)) errors.push(`criterion ${index + 1} must be ${expected}`); criterionIds.add(item.id);
    if (!c.quality?.dimensions?.includes(item.dimension)) errors.push(`${item.id || expected} has undeclared dimension`);
    if (typeof item.description !== 'string' || !item.description.trim() || typeof item.proof !== 'string' || !item.proof.trim()) errors.push(`${item.id || expected} needs description and proof`);
    if (!ORACLES.has(item.oracle) || typeof item.blocking !== 'boolean' || !OWNERS.has(item.owner)) errors.push(`${item.id || expected} has invalid oracle, blocking, or owner`);
  });
  exact(c.budget, BUDGET, 'budget', errors);
  for (const key of BUDGET) if (!Number.isInteger(c.budget?.[key]) || c.budget[key] < 1) errors.push(`budget.${key} must be a positive integer`);
  if (!Array.isArray(c.sharedContext) || !c.sharedContext.length || c.sharedContext.some((x) => !safePath(x))) errors.push('sharedContext must be nonempty safe relative paths');
  const expectedReplan = c.version >= 3 ? REPLAN_V3 : c.version === 2 ? REPLAN_V2 : REPLAN;
  if (!Array.isArray(c.replanOn) || c.replanOn.length !== expectedReplan.length || new Set(c.replanOn).size !== expectedReplan.length || expectedReplan.some((x) => !c.replanOn.includes(x))) errors.push('replanOn must contain the canonical set exactly once');
  const unitIds = new Set(); const byId = new Map(); const waves = new Map();
  if (!Array.isArray(c.units) || !c.units.length) errors.push('units must be nonempty');
  if (c.units?.length > c.budget?.maxDispatches) errors.push('units exceed maxDispatches');
  if (c.version === 4) {
    exact(c.orchestration, ORCHESTRATION, 'orchestration', errors, OPTIONAL_ORCHESTRATION);
    if (c.orchestration?.mode !== 'lead-and-operatives') errors.push('orchestration.mode must be lead-and-operatives');
    // WHY: a split made only to satisfy the two-operative floor costs each extra operative its
    // startup context plus its turns. A recorded singleUnitReason lowers the floor to one; the
    // reason contradicts a plan that still demands two or more of both.
    const singleUnit = c.orchestration && 'singleUnitReason' in c.orchestration;
    if (singleUnit && (typeof c.orchestration.singleUnitReason !== 'string' || !c.orchestration.singleUnitReason.trim() || words(c.orchestration.singleUnitReason) > 20)) errors.push('orchestration.singleUnitReason must be a nonempty string of at most twenty words');
    const floor = singleUnit ? 1 : 2;
    for (const key of ['minOperatives', 'minParallel']) if (!Number.isInteger(c.orchestration?.[key]) || c.orchestration[key] < floor) errors.push(`orchestration.${key} must be an integer of at least ${floor}${singleUnit ? '' : '; record orchestration.singleUnitReason to plan a single unit'}`);
    if (singleUnit && c.orchestration?.minOperatives >= 2 && c.orchestration?.minParallel >= 2) errors.push('orchestration.singleUnitReason contradicts minOperatives and minParallel of at least 2');
    if (c.orchestration?.minOperatives > c.budget?.maxDispatches) errors.push('orchestration.minOperatives exceeds maxDispatches');
    if (c.orchestration?.minParallel > c.budget?.maxParallel) errors.push('orchestration.minParallel exceeds maxParallel');
  }
  (c.units || []).forEach((unit, index) => {
    exact(unit, c.version === 4 ? UNIT_V4 : UNIT, `unit ${index + 1}`, errors, c.version === 4 ? OPTIONAL_UNIT_V4 : OPTIONAL_UNIT);
    const expected = `D-${String(index + 1).padStart(3, '0')}`;
    if (unit.id !== expected || unitIds.has(unit.id)) errors.push(`unit ${index + 1} must be ${expected}`); unitIds.add(unit.id); byId.set(unit.id, unit);
    if (!Number.isInteger(unit.wave) || unit.wave < 1 || typeof unit.phase !== 'string' || !unit.phase || typeof unit.lens !== 'string' || !unit.lens) errors.push(`${unit.id || expected} needs phase, lens, positive wave`);
    if (!['read', 'write'].includes(unit.mode) || !KINDS.has(unit.kind) || !EFFORTS.has(unit.effort) || !TIER_ORDER.includes(unit.tier) || !tierFor(unit.model, unit.tier)) errors.push(`${unit.id || expected} has invalid routing fields`);
    const rank = TIER_RANK[unit.tier];
    const peerAtXhigh = taskBased && unit.peerException !== undefined && unit.tier === 'frontier' && unit.effort === 'xhigh';
    if (calibrated && rank > TIER_RANK[c.lead.tier]) errors.push(`${unit.id || expected} must not run above the lead tier`);
    if (unit.kind === 'execution' && (rank < TIER_RANK.mid || !['medium', 'high'].includes(unit.effort))) errors.push(`${unit.id || expected} violates execution routing floor`);
    if (unit.kind === 'judgment' && (rank < TIER_RANK.strong || !['medium', 'high', ...(peerAtXhigh ? ['xhigh'] : [])].includes(unit.effort))) errors.push(`${unit.id || expected} violates judgment routing floor`);
    if (['review', 'refutation'].includes(unit.kind) && (rank < TIER_RANK.strong || (unit.effort !== 'high' && !peerAtXhigh))) errors.push(`${unit.id || expected} violates review routing floor`);
    if (['breadth', 'mechanical'].includes(unit.kind) && ['high', 'xhigh'].includes(unit.effort)) errors.push(`${unit.id || expected} violates breadth/mechanical effort ceiling`);
    if (typeof unit.role !== 'string' || !unit.role || typeof unit.brief !== 'string' || !unit.brief.trim() || words(unit.brief) > 10) errors.push(`${unit.id || expected} needs role and a brief of at most ten words`);
    if (taskBased && (typeof unit.routingRationale !== 'string' || !unit.routingRationale.trim() || words(unit.routingRationale) > 20)) errors.push(`${unit.id || expected} needs a routingRationale of at most twenty words`);
    if (!taskBased && ('routingRationale' in unit || 'peerException' in unit)) errors.push(`${unit.id || expected} task-based routing fields require routingPolicy task-based`);
    if (unit.peerException !== undefined) {
      exact(unit.peerException, PEER_EXCEPTION, `${unit.id || expected} peerException`, errors);
      if (!taskBased) errors.push(`${unit.id || expected} peerException requires routingPolicy task-based`);
      if (!PEER_CLASSES.has(unit.peerException?.class)) errors.push(`${unit.id || expected} peerException.class is invalid`);
      for (const key of ['rationale', 'stoppingCriterion']) if (typeof unit.peerException?.[key] !== 'string' || !unit.peerException[key].trim()) errors.push(`${unit.id || expected} peerException.${key} must be nonempty`);
      if (unit.tier !== 'frontier' || !['high', 'xhigh'].includes(unit.effort)) errors.push(`${unit.id || expected} peerException requires frontier tier and high or xhigh effort`);
      if (unit.peerException?.class === 'refutation' ? unit.kind !== 'refutation' : unit.kind !== 'judgment') errors.push(`${unit.id || expected} peerException class and kind do not match`);
    } else if (taskBased && unit.tier === 'frontier') errors.push(`${unit.id || expected} frontier routing requires peerException`);
    if (unit.tokenBudget !== undefined) {
      exact(unit.tokenBudget, TOKEN_BUDGET, `${unit.id || expected} tokenBudget`, errors);
      for (const key of TOKEN_BUDGET) if (!Number.isSafeInteger(unit.tokenBudget?.[key]) || unit.tokenBudget[key] < 1) errors.push(`${unit.id || expected} tokenBudget.${key} must be a positive safe integer`);
    }
    if (!Array.isArray(unit.scope) || !unit.scope.length || unit.scope.some((x) => !safePath(x)) || !safePath(unit.artifact)) errors.push(`${unit.id || expected} needs safe scope and artifact paths`);
    if (Array.isArray(unit.scope) && new Set(unit.scope.map(portablePath)).size !== unit.scope.length) errors.push(`${unit.id || expected} repeats a scope path`);
    if (!Array.isArray(unit.dependsOn) || !Array.isArray(unit.qualityCriteria) || !unit.qualityCriteria.length || unit.qualityCriteria.some((x) => !criterionIds.has(x))) errors.push(`${unit.id || expected} has invalid dependencies or quality criteria`);
    if (c.version === 4 && (!Array.isArray(unit.validates) || !Array.isArray(unit.independentOf))) errors.push(`${unit.id || expected} needs validates and independentOf arrays`);
    if (!waves.has(unit.wave)) waves.set(unit.wave, []); waves.get(unit.wave).push(unit);
  });
  for (const [wave, units] of waves) {
    if (units.length > c.budget?.maxParallel) errors.push(`wave ${wave} exceeds maxParallel`);
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j]; const aTargets = [...a.scope, a.artifact], bTargets = [...b.scope, b.artifact]; const overlap = scopesIntersect(aTargets, bTargets);
      if (a.mode === 'write' && b.mode === 'write' && overlap) errors.push(`wave ${wave} has overlapping write scopes or artifacts`);
    }
  }
  if (c.version === 4) {
    const operatives = (c.units || []).filter((unit) => !isValidator(unit));
    if (operatives.length < c.orchestration?.minOperatives) errors.push('planned work operatives do not meet orchestration.minOperatives; review and refutation units do not count');
    const widestWave = Math.max(0, ...[...waves.values()].map((units) => units.filter((unit) => !isValidator(unit)).length));
    if (widestWave < c.orchestration?.minParallel) errors.push('work-operative plan does not meet orchestration.minParallel; review and refutation units do not count');
  }
  if (taskBased) {
    const peers = (c.units || []).filter((unit) => unit.peerException !== undefined);
    if (peers.length > 1) errors.push('routingPolicy task-based allows at most one frontier peer');
    for (const peer of peers) if (!(peer.qualityCriteria || []).some((id) => c.quality?.criteria?.some((item) => item.id === id && item.blocking && item.owner === 'lead'))) errors.push(`${peer.id} frontier peer requires a lead-owned blocking criterion`);
  }
  for (let i = 0; i < (c.units || []).length; i++) for (let j = i + 1; j < c.units.length; j++) {
    const a = c.units[i], b = c.units[j];
    if (a.phase === b.phase && a.lens === b.lens && scopeKey(a.scope) === scopeKey(b.scope) && !['review', 'refutation'].includes(a.kind) && !['review', 'refutation'].includes(b.kind)) errors.push(`${a.id} and ${b.id} duplicate phase, lens, and scope`);
  }
  const visiting = new Set(), visited = new Set();
  const visit = (id) => { if (visiting.has(id)) { errors.push(`dependency cycle at ${id}`); return; } if (visited.has(id)) return; visiting.add(id); const unit = byId.get(id); for (const dep of unit?.dependsOn || []) { const parent = byId.get(dep); if (!parent) errors.push(`${id} depends on unknown ${dep}`); else { if (parent.wave >= unit.wave) errors.push(`${id} dependency ${dep} must be in an earlier wave`); visit(dep); } } visiting.delete(id); visited.add(id); };
  for (const id of byId.keys()) visit(id);
  if (c.version === 4) for (const unit of c.units || []) {
    for (const target of unit.validates || []) {
      const source = byId.get(target);
      if (!source) errors.push(`${unit.id} validates unknown ${target}`);
      else if (!['review', 'refutation'].includes(unit.kind)) errors.push(`${unit.id} validates work but is not review or refutation`);
      else if (!(unit.dependsOn || []).includes(target)) errors.push(`${unit.id} must depend on validated unit ${target}`);
    }
    for (const target of unit.independentOf || []) {
      const source = byId.get(target);
      if (!source) errors.push(`${unit.id} is independent of unknown ${target}`);
    }
    for (const target of unit.validates || []) if (!(unit.independentOf || []).includes(target)) errors.push(`${unit.id} must declare independentOf for validated unit ${target}`);
  }
  // WHY (calibration lesson L-063): doctrine already seats a refutation panel at an odd
  // number of at least three lenses, and nothing enforced it. An even panel deadlocks, and
  // repeated lenses buy seats without buying independence. One refutation unit is not a panel
  // and stays legal. Legacy versions are replay-only, so the rule lands in the version 4 block.
  if (c.version === 4) {
    const panels = new Map();
    for (const unit of c.units || []) {
      if (unit.kind !== 'refutation') continue;
      for (const target of unit.validates || []) {
        if (!panels.has(target)) panels.set(target, []);
        panels.get(target).push(unit);
      }
    }
    for (const [target, seats] of panels) {
      if (seats.length < 2) continue;
      if (seats.length % 2 === 0) errors.push(`${target} refutation panel has ${seats.length} seats; a panel seats an odd number of at least three lenses`);
      const seen = new Set(); const repeated = new Set();
      for (const seat of seats) { if (seen.has(seat.lens)) repeated.add(seat.lens); else seen.add(seat.lens); }
      for (const lens of repeated) errors.push(`${target} refutation panel repeats lens ${lens}`);
    }
    const validated = new Set((c.units || []).flatMap((unit) => unit.validates || []));
    for (const unit of c.units || []) if (!['review', 'refutation'].includes(unit.kind) && !validated.has(unit.id)) errors.push(`${unit.id} lacks an independent review or refutation unit`);
  }
  return errors;
}

function parseLedger(path) {
  if (!existsSync(path)) die(`ledger does not exist: ${path}`);
  const rows = []; const malformed = [];
  readFileSync(path, 'utf8').split(/\r?\n/).forEach((line, index) => {
    if (!line.startsWith('|') || /^\|\s*(id|---)/i.test(line)) return;
    const match = line.match(LEDGER_ROW_RE);
    if (!match) { malformed.push(index + 1); return; }
    rows.push({ id: match[1], role: match[2], brief: match[3], artifact: match[4], status: match[5] });
  });
  return { rows, malformed };
}
// WHY (calibration lesson L-055): a version 4 dispatch journal accrues permanent violations
// (a missing actor, a reused actor, an early activation, a non-independent validator, a
// duplicate known actor) the instant they occur, so both a mid-run checkpoint and a final
// reconciliation must catch them. Only two checks are inherently end-of-run: whether every
// planned unit ever got an actor, and whether the widest recorded overlap met
// orchestration.minParallel — both require the complete journal to decide. One walk computes
// the shared, always-decidable violations plus the running actor/overlap state final needs.
function walkDispatchJournal(contract, journal) {
  const errors = [];
  const workById = new Map(contract.units.filter((unit) => !isValidator(unit)).map((unit) => [unit.id, unit]));
  const allById = new Map(contract.units.map((unit) => [unit.id, unit]));
  const activeByWave = new Map(); const actorByUnit = new Map(); const unitByActor = new Map(); const statusByUnit = new Map();
  let widestOverlap = 0;
  for (const event of journal.events) {
    // WHY (calibration lesson L-053): dispatch-ledger.mjs add --contract stamps the add event's
    // runId, but nothing stopped a lead from skipping --contract altogether — an unbound add
    // still dispatches, still journals, and only mis-keys a row the moment units go out of
    // contract order. ledger-grammar.mjs's replay already refuses a journal that straddles
    // bound and unbound adds or names more than one run; this is the other half, verified here
    // rather than there because only reconcile holds the contract this journal is reconciled
    // against — every add must actually name THIS run, not merely agree with its own siblings.
    if (event.op === 'add') {
      if (!event.runId) errors.push(`dispatch journal add for ${event.id} is not bound to contract run ${contract.runId}; dispatch with dispatch-ledger.mjs add --contract --unit`);
      else if (event.runId !== contract.runId) errors.push(`dispatch journal add for ${event.id} names run ${event.runId}, not contract run ${contract.runId}`);
    }
    const nextStatus = event.op === 'add' ? event.status : event.to;
    if (['dispatched', 'redispatched'].includes(nextStatus)) {
      if (!event.actorId) errors.push(`dispatch journal activation for ${event.id} lacks actorId`);
      else {
        const priorUnit = unitByActor.get(event.actorId);
        if (priorUnit && priorUnit !== event.id) errors.push(`dispatch actor ${event.actorId} is reused across ${priorUnit} and ${event.id}`);
        unitByActor.set(event.actorId, event.id);
        actorByUnit.set(event.id, event.actorId);
      }
      const unit = allById.get(event.id);
      for (const dependency of unit?.dependsOn || []) if (statusByUnit.get(dependency) !== 'reported') {
        errors.push(`dispatch journal activates ${event.id} before dependency ${dependency} is reported`);
      }
    }
    statusByUnit.set(event.id, nextStatus);
    const unit = workById.get(event.id);
    if (!unit) continue;
    if (!activeByWave.has(unit.wave)) activeByWave.set(unit.wave, new Map());
    const active = activeByWave.get(unit.wave);
    if (['dispatched', 'redispatched'].includes(nextStatus)) active.set(unit.id, event.actorId || null);
    else if (['reported', 'failed'].includes(nextStatus)) active.delete(unit.id);
    widestOverlap = Math.max(widestOverlap, new Set([...active.values()].filter(Boolean)).size);
  }
  const actors = [...actorByUnit.values()];
  if (new Set(actors).size !== actors.length) errors.push('version 4 dispatch actors must be distinct across work and validation units');
  for (const validator of contract.units.filter(isValidator)) for (const target of validator.validates || []) {
    if (actorByUnit.get(validator.id) && actorByUnit.get(validator.id) === actorByUnit.get(target)) errors.push(`${validator.id} actor is not independent from validated unit ${target}`);
  }
  return { errors, actorByUnit, widestOverlap };
}
// WHY (calibration lesson L-055): reconcile has three modes, not a boolean. `plan` (the
// pre-existing non-strict default) tolerates unreported and unrepresented units. `in-flight`
// adds the version 4 journal's permanent violations so a checkpoint or replan mid-run cannot
// bind a corrupt dispatch history, but still tolerates rows not yet reported, planned units
// with no row, units with no actor yet, and the minParallel overlap check — each decidable
// only once the run finishes. `final` keeps every existing strict outcome unchanged.
function reconcile(contract, ledgerPath, mode) {
  const final = mode === 'final';
  const { rows, malformed } = parseLedger(ledgerPath); const errors = []; const warnings = []; const byId = new Map(contract.units.map((x) => [x.id, x])); const seen = new Set();
  if (malformed.length) errors.push(`malformed ledger rows at ${malformed.join(', ')}`);
  for (const row of rows) {
    const unit = byId.get(row.id); if (!unit) { errors.push(`unplanned ledger row ${row.id}`); continue; }
    if (seen.has(row.id)) errors.push(`duplicate ledger row ${row.id}`); seen.add(row.id);
    if (row.role !== `${unit.role}@${unit.model}`) errors.push(`${row.id} role/model differs from contract`);
    if (row.brief !== unit.brief) errors.push(`${row.id} brief differs from contract`);
    if (row.artifact !== unit.artifact) errors.push(`${row.id} artifact differs from contract`);
    if (!LEDGER_STATUSES.includes(row.status)) errors.push(`${row.id} has unknown status ${row.status}`);
    if (final && row.status !== 'reported') errors.push(`${row.id} is not reported`);
  }
  for (const unit of contract.units) if (!seen.has(unit.id)) (final ? errors : warnings).push(`missing planned ledger row ${unit.id}`);
  const journalPath = `${ledgerPath}.journal.jsonl`;
  let journal = null;
  if (existsSync(journalPath)) {
    const retries = new Map();
    const replayed = replayDispatchJournal(readFileSync(journalPath, 'utf8'));
    journal = replayed;
    errors.push(...replayed.violations.map((violation) => `dispatch journal ${violation}`));
    for (const entry of replayed.events) if (entry.op === 'update' && entry.to === 'redispatched') retries.set(entry.id, (retries.get(entry.id) || 0) + 1);
    for (const id of replayed.expected.keys()) if (!byId.has(id)) errors.push(`dispatch journal names unplanned ${id}`);
    for (const [id, count] of retries) if (count > contract.budget.maxRetriesPerUnit) errors.push(`${id} exceeds maxRetriesPerUnit (${count} > ${contract.budget.maxRetriesPerUnit})`);
    if (contract.version === 4) {
      const rowById = new Map(rows.map((row) => [row.id, row]));
      for (const row of rows) if (!replayed.expected.has(row.id)) errors.push(`dispatch journal has no add event for ${row.id}`);
      for (const [id, status] of replayed.expected) if (rowById.get(id)?.status !== status) errors.push(`dispatch journal status for ${id} differs from ledger`);
    }
  }
  if (mode !== 'plan' && contract.version === 4) {
    if (!journal) errors.push(`version 4 ${final ? 'finalization' : 'in-flight reconciliation'} requires a dispatch journal`);
    else {
      const walked = walkDispatchJournal(contract, journal);
      errors.push(...walked.errors);
      if (final) {
        for (const unit of contract.units) if (!walked.actorByUnit.has(unit.id)) errors.push(`dispatch journal does not identify the actor for ${unit.id}`);
        if (walked.widestOverlap < contract.orchestration.minParallel) errors.push(`dispatch journal records at most ${walked.widestOverlap} overlapping active work intervals; orchestration.minParallel is ${contract.orchestration.minParallel}`);
      }
    }
  }
  return { errors, warnings, rows, journal };
}
function printReconciliation(result) { for (const warning of result.warnings) console.log(`! ${warning}`); if (result.errors.length) die(`reconciliation failed:\n${result.errors.map((x) => `  - ${x}`).join('\n')}`); console.log(`ok reconciliation: ${result.rows.length} ledger row(s)`); }
function parseAcceptance(path, contract) {
  try { return readAcceptance(path, contract); }
  catch (error) { die(error.message); }
}
function cleanCell(value) { return value.replace(/[|\r\n]/g, ' ').trim(); }
function atomicWrite(path, contents) { const temp = `${path}.tmp-${process.pid}`; writeFileSync(temp, contents); renameSync(temp, path); }

// WHY (OI-10): a version 4 run needs a snapshot receipt, host capabilities, and a runtime block
// before check can pass, and leads skipped the contract rather than capture them by hand. init
// fills every field the tree can answer and leaves the judgment fields empty, so check keeps
// failing until the lead writes them. It generates input for validate and never relaxes it.
const INIT_FILES = { contract: 'RUN_CONTRACT.json', snapshot: 'CONTEXT_SNAPSHOT.json', capabilities: 'HOST_CAPABILITIES.json', receipts: 'RUN_RUNTIME_RECEIPTS.jsonl' };
const LEAD_FIELDS = ['objective', 'nonGoals', 'quality.dimensions', 'quality.criteria', 'units'];
const CAPABILITY_FLAGS = ['--prompt-caching', '--compaction', '--context-editing', '--host-memory', '--task-budget'];
function runSibling(script, args, root) {
  try { execFileSync(process.execPath, [fileURLToPath(new URL(`./${script}`, import.meta.url)), ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 64 * 1024 * 1024 }); }
  catch (error) { die(`${script} failed: ${String(error.stderr || error.stdout || error.message).trim()}`); }
}
function tracked(root, path) { try { return git(root, ['ls-files', '--', path]).length > 0; } catch { return false; } }
function init(f) {
  const root = resolve(f['--root'] || process.cwd());
  const runDir = resolve(f['--run']);
  let runRel;
  try { runRel = repoRelative(root, runDir); } catch { die('--run must name a directory inside --root'); }
  const runId = basename(runDir);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId)) die(`run directory name ${runId} must be kebab-case, because it becomes runId`);
  const rel = (name) => `${runRel}/${name}`;
  try { git(root, ['check-ignore', '-q', '--no-index', '--', rel(INIT_FILES.contract)]); }
  catch { die(`run directory ${runRel} must be ignored by Git, because runtime receipts must stay untracked`); }
  const contractPath = resolve(runDir, INIT_FILES.contract);
  const existing = [INIT_FILES.contract, INIT_FILES.snapshot, INIT_FILES.capabilities].filter((name) => existsSync(resolve(runDir, name)));
  if (existing.length && !f['--force']) die(`refusing to overwrite ${existing.join(', ')} in ${runRel} without --force`);
  const model = f['--lead-model'];
  const rank = modelRankOf(model);
  // Only the registry or the operator places the lead; an unplaced model is never guessed.
  const tier = f['--lead-tier'] || (rank === undefined ? null : TIER_ORDER[rank]);
  if (!TIER_ORDER.includes(tier)) die(`lead model ${model} is not placed by the model registry; pass --lead-tier ${TIER_ORDER.join('|')}`);
  const effort = f['--lead-effort'] || 'high';
  if (!EFFORTS.has(effort)) die(`--lead-effort must be one of ${[...EFFORTS].join(', ')}`);
  const untracked = f['--untracked'] || 'metadata';
  if (!['metadata', 'exclude'].includes(untracked)) die('--untracked must be metadata or exclude; an allowlist run is written by hand');
  const stablePrefix = f['--stable-prefix'] || ['AGENTS.md', 'CLAUDE.md'].filter((path) => tracked(root, path)).slice(0, 1);
  if (!stablePrefix.length) die('no tracked AGENTS.md or CLAUDE.md; name the stable prefix with --stable-prefix');
  const head = gitHead(root);
  if (!head) die('cannot resolve current git HEAD');
  if (existing.includes(INIT_FILES.capabilities)) rmSync(resolve(runDir, INIT_FILES.capabilities));
  const prepare = ['prepare', '--root', root, '--out', resolve(runDir, INIT_FILES.snapshot), '--cache', resolve(runDir, 'cache'), '--untracked', untracked];
  if (f['--atlas']) prepare.push('--atlas', f['--atlas']);
  runSibling('context-snapshot.mjs', prepare, root);
  // A script cannot observe caching, compaction, context editing, host memory, or task budgets,
  // so every state is unknown. The lead edits the receipt only with real host evidence.
  const host = f['--host'] || (process.env.CLAUDECODE === '1' ? 'claude-code' : 'unknown');
  runSibling('host-capabilities.mjs', ['init', '--root', root, '--out', rel(INIT_FILES.capabilities), '--host', host, '--provider', providerOfConfigSlug(model) || 'unknown', '--model', model, '--source', 'host-probe', ...CAPABILITY_FLAGS.flatMap((flag) => [flag, 'unknown'])], root);
  const receipt = readJson(resolve(runDir, INIT_FILES.snapshot));
  const contract = {
    version: 4, revision: 1, runId, head,
    objective: '', nonGoals: [],
    lead: { model, tier, effort },
    quality: { dimensions: [], criteria: [] },
    budget: { maxDispatches: 4, maxParallel: 2, maxRetriesPerUnit: 1 },
    sharedContext: stablePrefix,
    replanOn: REPLAN_V3,
    units: [],
    context: { snapshot: INIT_FILES.snapshot, snapshotId: receipt.snapshotId, bundleDir: 'bundles', untrackedPolicy: untracked, maxBundleBytes: 1000000, maxAtlasExcerptBytes: 100000 },
    runtime: { capabilities: rel(INIT_FILES.capabilities), receipts: rel(INIT_FILES.receipts), stablePrefix, maxStablePrefixBytes: 100000, policy: { promptCaching: 'prefer', compaction: 'prefer', contextEditing: 'prefer', hostMemory: 'prefer', taskBudget: 'prefer' } },
    orchestration: { mode: 'lead-and-operatives', minOperatives: 2, minParallel: 2 },
    routingPolicy: 'task-based',
  };
  verifyContext(contract, contractPath, root);
  atomicWrite(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  console.log(`ok initialized ${runId} at ${rel(INIT_FILES.contract)}`);
  console.log(`! lead must fill ${LEAD_FIELDS.join(', ')}; check fails until they are set`);
}

const command = process.argv[2];
if (!command) usage();
if (command === 'init') {
  const f = flags(process.argv.slice(3), new Set(['--run', '--root', '--lead-model', '--lead-tier', '--lead-effort', '--host', '--untracked', '--atlas', '--stable-prefix', '--force']), new Set(['--force']), new Set(['--stable-prefix'])); if (!f['--run'] || !f['--lead-model']) usage();
  init(f);
} else if (command === 'check') {
  const f = flags(process.argv.slice(3), new Set(['--contract', '--root'])); if (!f['--contract']) usage();
  const root = resolve(f['--root'] || process.cwd()); const contract = loadContract(resolve(f['--contract']), root); console.log(`ok contract ${contract.runId} revision ${contract.revision}`);
} else if (command === 'reconcile') {
  const f = flags(process.argv.slice(3), new Set(['--contract', '--ledger', '--root', '--strict', '--in-flight']), new Set(['--strict', '--in-flight'])); if (!f['--contract'] || !f['--ledger']) usage();
  if (f['--strict'] && f['--in-flight']) usage();
  const root = resolve(f['--root'] || process.cwd()); printReconciliation(reconcile(loadContract(resolve(f['--contract']), root), resolve(f['--ledger']), f['--strict'] ? 'final' : f['--in-flight'] ? 'in-flight' : 'plan'));
} else if (command === 'record') {
  const f = flags(process.argv.slice(3), new Set(['--contract', '--acceptance', '--criterion', '--verdict', '--proof', '--actor', '--reason', '--root'])); if (!f['--contract'] || !f['--acceptance'] || !f['--criterion'] || !f['--verdict'] || !f['--proof'] || !f['--actor']) usage();
  const root = resolve(f['--root'] || process.cwd()); const contract = loadContract(resolve(f['--contract']), root); const criterion = contract.quality.criteria.find((x) => x.id === f['--criterion']); if (!criterion) die(`unknown criterion ${f['--criterion']}`); if (!['PASS', 'FAIL', 'UNKNOWN', 'N/A'].includes(f['--verdict'])) die('invalid verdict');
  if (!cleanCell(f['--proof'])) die('proof must be nonempty');
  const actor = f['--actor']; const actorProblem = actorError(criterion, actor); if (actorProblem) die(actorProblem);
  const acceptance = resolve(f['--acceptance']); const attempt = parseAcceptance(acceptance, contract).filter((x) => x.criterion === criterion.id).reduce((max, x) => Math.max(max, x.attempt), 0) + 1;
  if (!existsSync(acceptance)) writeFileSync(acceptance, ACCEPT_HEADER);
  appendFileSync(acceptance, `| ${criterion.id} | ${attempt} | ${f['--verdict']} | ${cleanCell(f['--proof'])} | ${cleanCell(actor)} | ${cleanCell(f['--reason'] || '')} |\n`); console.log(`ok recorded ${criterion.id} attempt ${attempt}`);
} else if (command === 'finalize') {
  const f = flags(process.argv.slice(3), new Set(['--contract', '--acceptance', '--dispatch-ledger', '--result', '--root'])); if (!f['--contract'] || !f['--acceptance'] || !f['--dispatch-ledger'] || !f['--result']) usage();
  const root = resolve(f['--root'] || process.cwd()); const contract = loadContract(resolve(f['--contract']), root); const resultPath = resolve(f['--result']); if (existsSync(resultPath)) die(`result already exists: ${resultPath}`); const reconciled = reconcile(contract, resolve(f['--dispatch-ledger']), 'final'); if (reconciled.errors.length) die(`cannot finalize:\n${reconciled.errors.map((x) => `  - ${x}`).join('\n')}`);
  if (contract.version === 4) {
    const missing = contract.units.filter((unit) => {
      const artifact = resolve(root, unit.artifact);
      try { return !existsSync(artifact) || !readFileSync(artifact).length; } catch { return true; }
    });
    if (missing.length) die(`cannot finalize; missing or empty operative artifacts: ${missing.map((unit) => unit.id).join(', ')}`);
  }
  const latest = new Map(); for (const row of parseAcceptance(resolve(f['--acceptance']), contract)) { if (!latest.has(row.criterion) || latest.get(row.criterion).attempt < row.attempt) latest.set(row.criterion, row); }
  const failed = contract.quality.criteria.filter((x) => x.blocking && latest.get(x.id)?.verdict !== 'PASS'); if (failed.length) die(`cannot finalize; blocking criteria not PASS: ${failed.map((x) => x.id).join(', ')}`);
  const result = { version: 1, runId: contract.runId, revision: contract.revision, head: contract.head, status: 'PASS', criteria: contract.quality.criteria.map((x) => ({ id: x.id, verdict: latest.get(x.id)?.verdict || 'MISSING' })), dispatch: { planned: contract.units.length, reported: reconciled.rows.length }, completedAt: new Date().toISOString() };
  atomicWrite(resultPath, `${JSON.stringify(result, null, 2)}\n`); console.log(`ok finalized ${contract.runId}`);
} else usage();
