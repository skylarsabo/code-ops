#!/usr/bin/env node
// Fail-closed compiler for a bounded, auditable multi-agent run contract.
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PROVIDER_TIERS, TIER_ORDER, TIER_RANK } from './model-tiers.mjs';
import { LEDGER_ROW_RE, LEDGER_STATUSES, replayDispatchJournal } from './ledger-grammar.mjs';
import { scopesIntersect, verifySnapshotReceipt } from './context-index-lib.mjs';

const TOP = new Set(['version', 'revision', 'runId', 'head', 'objective', 'nonGoals', 'lead', 'quality', 'budget', 'sharedContext', 'replanOn', 'units', 'context']);
const CONTEXT = new Set(['snapshot', 'snapshotId', 'bundleDir', 'untrackedPolicy', 'maxBundleBytes', 'maxAtlasExcerptBytes']);
const LEAD = new Set(['model', 'tier', 'effort']);
const QUALITY = new Set(['dimensions', 'criteria']);
const CRITERION = new Set(['id', 'dimension', 'description', 'oracle', 'proof', 'blocking', 'owner']);
const BUDGET = new Set(['maxDispatches', 'maxParallel', 'maxRetriesPerUnit']);
const UNIT = new Set(['id', 'phase', 'wave', 'lens', 'mode', 'role', 'kind', 'model', 'tier', 'effort', 'brief', 'scope', 'artifact', 'dependsOn', 'qualityCriteria']);
const DIMENSIONS = new Set(['correctness', 'evidence', 'coverage', 'security', 'privacy', 'usability', 'performance', 'documentation', 'efficiency', 'maintainability']);
const ORACLES = new Set(['command', 'receipt', 'review', 'artifact']);
const OWNERS = new Set(['lead', 'reviewer', 'tool', 'user']);
const KINDS = new Set(['mechanical', 'breadth', 'execution', 'judgment', 'review', 'refutation']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const REPLAN = ['scope-change', 'new-dependency', 'failed-dispatch', 'quality-gate-failure'];
const REPLAN_V2 = [...REPLAN, 'context-drift'];
const ACCEPT_HEADER = '| criterion | attempt | verdict | proof | accepted by | reason |\n| --- | --- | --- | --- | --- | --- |\n';

function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
function usage() { die('usage: run-contract.mjs check --contract <path> [--root <dir>]\n       run-contract.mjs reconcile --contract <path> --ledger <path> [--strict] [--root <dir>]\n       run-contract.mjs record --contract <path> --acceptance <path> --criterion Q-NNN --verdict PASS|FAIL|UNKNOWN|N/A --proof <text> --actor <role@model|tool|user> [--reason <text>]\n       run-contract.mjs finalize --contract <path> --acceptance <path> --dispatch-ledger <path> --result <path> [--root <dir>]', 2); }
function flags(args, known, booleans = new Set()) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!known.has(key) || out[key] !== undefined) usage();
    if (booleans.has(key)) { out[key] = true; continue; }
    const value = args[++i];
    if (!value || value.startsWith('--')) usage();
    out[key] = value;
  }
  return out;
}
function exact(value, keys, label, errors) {
  if (!value || Array.isArray(value) || typeof value !== 'object') { errors.push(`${label} must be an object`); return; }
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`${label} has unknown key ${key}`);
  for (const key of keys) if (!(key in value)) errors.push(`${label} is missing ${key}`);
}
function safePath(value) {
  return typeof value === 'string' && value.length > 0 && value !== '.' && !isAbsolute(value) && !value.includes('\\') && !value.split('/').includes('..') && !value.startsWith('./') && !value.endsWith('/') && !value.includes('//') && value.split('/').every((part) => part === part.trim() && !part.endsWith('.'));
}
function portablePath(value) { return value.normalize('NFC').toLowerCase(); }
function scopeKey(scope) { return scope.map(portablePath).sort().join('\0'); }
function words(value) { return value.trim().split(/\s+/).filter(Boolean).length; }
function tierFor(model, declared) { return Object.values(PROVIDER_TIERS).some((provider) => provider.models[declared] === model); }
function gitHead(root) { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } }
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { die(`cannot parse ${path}: ${error.message}`); } }
function loadContract(path, root) { const contract = readJson(path); const errors = validate(contract, root); if (errors.length) die(`contract invalid:\n${errors.map((x) => `  - ${x}`).join('\n')}`); verifyContext(contract, path, root); return contract; }

function verifyContext(contract, contractPath, root) {
  if (contract.version !== 2) return;
  const receiptPath = resolve(dirname(contractPath), contract.context.snapshot);
  try {
    const receipt = readJson(receiptPath);
    if (receipt.snapshotId !== contract.context.snapshotId) die('context snapshot ID does not match receipt');
    if (receipt.state?.untracked?.policy !== contract.context.untrackedPolicy) die('context untrackedPolicy does not match receipt');
    verifySnapshotReceipt(root, receipt);
  } catch (error) { die(error.message.includes('context snapshot drift') ? error.message : `context snapshot drift; prepare a new receipt, increment contract revision, and re-bundle affected units`); }
}

function validate(c, root) {
  const errors = [];
  if (!c || Array.isArray(c) || typeof c !== 'object') return ['contract must be an object'];
  exact(c, c.version === 1 ? new Set([...TOP].filter((key) => key !== 'context')) : TOP, 'contract', errors);
  if (![1, 2].includes(c.version)) errors.push('version must be 1 or 2');
  if (c.version === 1 && 'context' in c) errors.push('version 1 must not contain context');
  if (c.version === 2) {
    exact(c.context, CONTEXT, 'context', errors);
    if (!safePath(c.context?.snapshot) || !safePath(c.context?.bundleDir)) errors.push('context snapshot and bundleDir must be safe relative paths');
    if (!/^[0-9a-f]{64}$/.test(c.context?.snapshotId || '')) errors.push('context.snapshotId must be lowercase SHA-256');
    if (!['metadata', 'exclude', 'allowlist'].includes(c.context?.untrackedPolicy)) errors.push('context.untrackedPolicy is invalid');
    for (const key of ['maxBundleBytes', 'maxAtlasExcerptBytes']) if (!Number.isInteger(c.context?.[key]) || c.context[key] < 1) errors.push(`context.${key} must be a positive integer`);
  }
  if (!Number.isInteger(c.revision) || c.revision < 1) errors.push('revision must be a positive integer');
  if (typeof c.runId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.runId)) errors.push('runId must be kebab-case');
  const head = gitHead(root); if (!head) errors.push('cannot resolve current git HEAD'); else if (c.head !== head) errors.push('head does not match current git HEAD');
  if (typeof c.objective !== 'string' || !c.objective.trim()) errors.push('objective must be nonempty');
  if (!Array.isArray(c.nonGoals) || !c.nonGoals.length || c.nonGoals.some((x) => typeof x !== 'string' || !x.trim())) errors.push('nonGoals must be a nonempty string array');
  exact(c.lead, LEAD, 'lead', errors);
  if (!TIER_ORDER.includes(c.lead?.tier) || TIER_RANK[c.lead?.tier] < TIER_RANK.strong || !tierFor(c.lead?.model, c.lead?.tier)) errors.push('lead model must support declared strong or frontier tier');
  if (c.lead?.effort !== 'high') errors.push('lead effort must be high');
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
  const expectedReplan = c.version === 2 ? REPLAN_V2 : REPLAN;
  if (!Array.isArray(c.replanOn) || c.replanOn.length !== expectedReplan.length || new Set(c.replanOn).size !== expectedReplan.length || expectedReplan.some((x) => !c.replanOn.includes(x))) errors.push('replanOn must contain the canonical set exactly once');
  const unitIds = new Set(); const byId = new Map(); const waves = new Map();
  if (!Array.isArray(c.units) || !c.units.length) errors.push('units must be nonempty');
  if (c.units?.length > c.budget?.maxDispatches) errors.push('units exceed maxDispatches');
  (c.units || []).forEach((unit, index) => {
    exact(unit, UNIT, `unit ${index + 1}`, errors);
    const expected = `D-${String(index + 1).padStart(3, '0')}`;
    if (unit.id !== expected || unitIds.has(unit.id)) errors.push(`unit ${index + 1} must be ${expected}`); unitIds.add(unit.id); byId.set(unit.id, unit);
    if (!Number.isInteger(unit.wave) || unit.wave < 1 || typeof unit.phase !== 'string' || !unit.phase || typeof unit.lens !== 'string' || !unit.lens) errors.push(`${unit.id || expected} needs phase, lens, positive wave`);
    if (!['read', 'write'].includes(unit.mode) || !KINDS.has(unit.kind) || !EFFORTS.has(unit.effort) || !TIER_ORDER.includes(unit.tier) || !tierFor(unit.model, unit.tier)) errors.push(`${unit.id || expected} has invalid routing fields`);
    const rank = TIER_RANK[unit.tier];
    if (unit.kind === 'execution' && (rank < TIER_RANK.mid || !['medium', 'high'].includes(unit.effort))) errors.push(`${unit.id || expected} violates execution routing floor`);
    if (unit.kind === 'judgment' && (rank < TIER_RANK.strong || !['medium', 'high'].includes(unit.effort))) errors.push(`${unit.id || expected} violates judgment routing floor`);
    if (['review', 'refutation'].includes(unit.kind) && (rank < TIER_RANK.strong || unit.effort !== 'high')) errors.push(`${unit.id || expected} violates review routing floor`);
    if (['breadth', 'mechanical'].includes(unit.kind) && ['high', 'xhigh'].includes(unit.effort)) errors.push(`${unit.id || expected} violates breadth/mechanical effort ceiling`);
    if (typeof unit.role !== 'string' || !unit.role || typeof unit.brief !== 'string' || !unit.brief.trim() || words(unit.brief) > 10) errors.push(`${unit.id || expected} needs role and a brief of at most ten words`);
    if (!Array.isArray(unit.scope) || !unit.scope.length || unit.scope.some((x) => !safePath(x)) || !safePath(unit.artifact)) errors.push(`${unit.id || expected} needs safe scope and artifact paths`);
    if (Array.isArray(unit.scope) && new Set(unit.scope.map(portablePath)).size !== unit.scope.length) errors.push(`${unit.id || expected} repeats a scope path`);
    if (!Array.isArray(unit.dependsOn) || !Array.isArray(unit.qualityCriteria) || !unit.qualityCriteria.length || unit.qualityCriteria.some((x) => !criterionIds.has(x))) errors.push(`${unit.id || expected} has invalid dependencies or quality criteria`);
    if (!waves.has(unit.wave)) waves.set(unit.wave, []); waves.get(unit.wave).push(unit);
  });
  for (const [wave, units] of waves) {
    if (units.length > c.budget?.maxParallel) errors.push(`wave ${wave} exceeds maxParallel`);
    for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j]; const aTargets = [...a.scope, a.artifact], bTargets = [...b.scope, b.artifact]; const overlap = scopesIntersect(aTargets, bTargets);
      if (a.mode === 'write' && b.mode === 'write' && overlap) errors.push(`wave ${wave} has overlapping write scopes or artifacts`);
    }
  }
  for (let i = 0; i < (c.units || []).length; i++) for (let j = i + 1; j < c.units.length; j++) {
    const a = c.units[i], b = c.units[j];
    if (a.phase === b.phase && a.lens === b.lens && scopeKey(a.scope) === scopeKey(b.scope) && !['review', 'refutation'].includes(a.kind) && !['review', 'refutation'].includes(b.kind)) errors.push(`${a.id} and ${b.id} duplicate phase, lens, and scope`);
  }
  const visiting = new Set(), visited = new Set();
  const visit = (id) => { if (visiting.has(id)) { errors.push(`dependency cycle at ${id}`); return; } if (visited.has(id)) return; visiting.add(id); const unit = byId.get(id); for (const dep of unit?.dependsOn || []) { const parent = byId.get(dep); if (!parent) errors.push(`${id} depends on unknown ${dep}`); else { if (parent.wave >= unit.wave) errors.push(`${id} dependency ${dep} must be in an earlier wave`); visit(dep); } } visiting.delete(id); visited.add(id); };
  for (const id of byId.keys()) visit(id);
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
function reconcile(contract, ledgerPath, strict) {
  const { rows, malformed } = parseLedger(ledgerPath); const errors = []; const warnings = []; const byId = new Map(contract.units.map((x) => [x.id, x])); const seen = new Set();
  if (malformed.length) errors.push(`malformed ledger rows at ${malformed.join(', ')}`);
  for (const row of rows) {
    const unit = byId.get(row.id); if (!unit) { errors.push(`unplanned ledger row ${row.id}`); continue; }
    if (seen.has(row.id)) errors.push(`duplicate ledger row ${row.id}`); seen.add(row.id);
    if (row.role !== `${unit.role}@${unit.model}`) errors.push(`${row.id} role/model differs from contract`);
    if (row.brief !== unit.brief) errors.push(`${row.id} brief differs from contract`);
    if (row.artifact !== unit.artifact) errors.push(`${row.id} artifact differs from contract`);
    if (!LEDGER_STATUSES.includes(row.status)) errors.push(`${row.id} has unknown status ${row.status}`);
    if (strict && row.status !== 'reported') errors.push(`${row.id} is not reported`);
  }
  for (const unit of contract.units) if (!seen.has(unit.id)) (strict ? errors : warnings).push(`missing planned ledger row ${unit.id}`);
  const journalPath = `${ledgerPath}.journal.jsonl`;
  if (existsSync(journalPath)) {
    const retries = new Map();
    const replayed = replayDispatchJournal(readFileSync(journalPath, 'utf8'));
    errors.push(...replayed.violations.map((violation) => `dispatch journal ${violation}`));
    for (const entry of replayed.events) if (entry.op === 'update' && entry.to === 'redispatched') retries.set(entry.id, (retries.get(entry.id) || 0) + 1);
    for (const id of replayed.expected.keys()) if (!byId.has(id)) errors.push(`dispatch journal names unplanned ${id}`);
    for (const [id, count] of retries) if (count > contract.budget.maxRetriesPerUnit) errors.push(`${id} exceeds maxRetriesPerUnit (${count} > ${contract.budget.maxRetriesPerUnit})`);
  }
  return { errors, warnings, rows };
}
function printReconciliation(result) { for (const warning of result.warnings) console.log(`! ${warning}`); if (result.errors.length) die(`reconciliation failed:\n${result.errors.map((x) => `  - ${x}`).join('\n')}`); console.log(`ok reconciliation: ${result.rows.length} ledger row(s)`); }
function actorError(criterion, actor) {
  if (criterion.owner === 'tool' && actor !== 'tool') return 'actor does not match criterion owner';
  if (criterion.owner === 'user' && actor !== 'user') return 'actor does not match criterion owner';
  if (['lead', 'reviewer'].includes(criterion.owner)) {
    const match = actor.match(/^([^@]+)@(.+)$/);
    const rank = match && Object.values(PROVIDER_TIERS).map((provider) => Object.entries(provider.models).find(([, model]) => model === match[2])?.[0]).filter(Boolean).map((tier) => TIER_RANK[tier]).sort((a, b) => b - a)[0];
    if (!match || match[1] !== criterion.owner || !Number.isInteger(rank) || rank < TIER_RANK.strong) return 'actor must be owner@strong-or-better-model';
  }
  return null;
}
function parseAcceptance(path, contract) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  if (!text.startsWith(ACCEPT_HEADER)) die(`acceptance ledger has invalid header: ${path}`);
  const rows = []; const attempts = new Map(); const criteria = new Map(contract.quality.criteria.map((x) => [x.id, x]));
  text.slice(ACCEPT_HEADER.length).split(/\r?\n/).forEach((line, index) => {
    if (!line) return;
    const cells = line.split('|').slice(1, -1).map((x) => x.trim());
    if (!line.startsWith('|') || !line.endsWith('|') || cells.length !== 6 || !/^Q-\d{3}$/.test(cells[0]) || !/^\d+$/.test(cells[1]) || !['PASS', 'FAIL', 'UNKNOWN', 'N/A'].includes(cells[2])) die(`acceptance ledger has malformed row ${index + 3}`);
    const row = { criterion: cells[0], attempt: Number(cells[1]), verdict: cells[2], proof: cells[3], actor: cells[4], reason: cells[5] };
    const criterion = criteria.get(row.criterion); if (!criterion) die(`acceptance ledger row ${index + 3} names unknown criterion ${row.criterion}`);
    const expected = (attempts.get(row.criterion) || 0) + 1; if (row.attempt !== expected) die(`acceptance ledger row ${index + 3} breaks attempt sequence for ${row.criterion}`); attempts.set(row.criterion, row.attempt);
    if (!row.proof) die(`acceptance ledger row ${index + 3} has empty proof`);
    const actorProblem = actorError(criterion, row.actor); if (actorProblem) die(`acceptance ledger row ${index + 3}: ${actorProblem}`);
    rows.push(row);
  });
  return rows;
}
function cleanCell(value) { return value.replace(/[|\r\n]/g, ' ').trim(); }
function atomicWrite(path, contents) { const temp = `${path}.tmp-${process.pid}`; writeFileSync(temp, contents); renameSync(temp, path); }

const command = process.argv[2];
if (!command) usage();
if (command === 'check') {
  const f = flags(process.argv.slice(3), new Set(['--contract', '--root'])); if (!f['--contract']) usage();
  const root = resolve(f['--root'] || process.cwd()); const contract = loadContract(resolve(f['--contract']), root); console.log(`ok contract ${contract.runId} revision ${contract.revision}`);
} else if (command === 'reconcile') {
  const f = flags(process.argv.slice(3), new Set(['--contract', '--ledger', '--root', '--strict']), new Set(['--strict'])); if (!f['--contract'] || !f['--ledger']) usage();
  const root = resolve(f['--root'] || process.cwd()); printReconciliation(reconcile(loadContract(resolve(f['--contract']), root), resolve(f['--ledger']), Boolean(f['--strict'])));
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
  const root = resolve(f['--root'] || process.cwd()); const contract = loadContract(resolve(f['--contract']), root); const resultPath = resolve(f['--result']); if (existsSync(resultPath)) die(`result already exists: ${resultPath}`); const reconciled = reconcile(contract, resolve(f['--dispatch-ledger']), true); if (reconciled.errors.length) die(`cannot finalize:\n${reconciled.errors.map((x) => `  - ${x}`).join('\n')}`);
  const latest = new Map(); for (const row of parseAcceptance(resolve(f['--acceptance']), contract)) { if (!latest.has(row.criterion) || latest.get(row.criterion).attempt < row.attempt) latest.set(row.criterion, row); }
  const failed = contract.quality.criteria.filter((x) => x.blocking && latest.get(x.id)?.verdict !== 'PASS'); if (failed.length) die(`cannot finalize; blocking criteria not PASS: ${failed.map((x) => x.id).join(', ')}`);
  const result = { version: 1, runId: contract.runId, revision: contract.revision, head: contract.head, status: 'PASS', criteria: contract.quality.criteria.map((x) => ({ id: x.id, verdict: latest.get(x.id)?.verdict || 'MISSING' })), dispatch: { planned: contract.units.length, reported: reconciled.rows.length }, completedAt: new Date().toISOString() };
  atomicWrite(resultPath, `${JSON.stringify(result, null, 2)}\n`); console.log(`ok finalized ${contract.runId}`);
} else usage();
