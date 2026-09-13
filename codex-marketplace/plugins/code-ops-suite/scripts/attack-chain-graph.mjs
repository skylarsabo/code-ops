#!/usr/bin/env node
// Defensive security-campaign graph compiler. It records evidence and control paths,
// never payloads or weaponized exploitation instructions.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATES = new Set(['OPEN', 'BLOCKED', 'EXHAUSTED', 'CLOSED']);
const KINDS = new Set(['entry', 'guard', 'primitive', 'sink']);
const VALIDATION = new Set(['PENDING', 'SURVIVED', 'REFUTED']);
const BANNED = new Set(['git-history', 'changelog', 'cve-database', 'patched-diff']);
const DIRECT = new Set(['source', 'runtime', 'framework', 'database', 'library', 'dependency-source', 'configuration', 'test', 'deployment', 'command', 'receipt']);

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
function usage() { console.error('usage: attack-chain-graph.mjs check|report --campaign <ATTACK_CAMPAIGN.json> --contract <RUN_CONTRACT.json> --ledger <DISPATCH_LEDGER.md> [--root <repo>] [--final]'); process.exit(2); }
function readJson(path, label) {
  if (!path || !existsSync(path)) throw new Error(`${label} not found: ${path || '(missing)'}`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim().length > 0; }
function unique(values) { return new Set(values).size === values.length; }
function actor(unit) { return `${unit.role}@${unit.model}`; }
function location(value) {
  const normalized = value.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/#L(\d+)(?:C(\d+))?$/i, (_, line, column) => `:${line}${column ? `:${column}` : ''}`);
  if (!/^.+:\d+(?::\d+)?$/.test(normalized)) return null;
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
function fileOf(value) { return value.replace(/:\d+(?::\d+)?$/, ''); }

function bannedTerm(value) {
  const match = value.toLowerCase().match(/git[^a-z0-9]*history|change[^a-z0-9]*logs?|cve[^a-z0-9]*databases?|patched(?:[^a-z0-9]*version)?[^a-z0-9]*diffs?/);
  if (!match) return null;
  const normalized = match[0].replace(/[\s_-]+/g, '-');
  if (normalized.startsWith('change')) return 'changelog';
  if (normalized.startsWith('cve')) return 'cve-database';
  if (normalized.startsWith('git')) return 'git-history';
  return 'patched-diff';
}
function scanBanned(value, path, errors) {
  if (typeof value === 'string') { const found = bannedTerm(value); if (found) errors.push(`${path} contains banned provenance ${found}`); }
  else if (Array.isArray(value)) value.forEach((item, index) => scanBanned(item, `${path}[${index}]`, errors));
  else if (object(value)) for (const [key, item] of Object.entries(value)) scanBanned(item, `${path}.${key}`, errors);
}
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function referenceErrors(reference, label, root) {
  if (!object(reference) || !text(reference.path) || !/^[0-9a-f]{64}$/.test(reference.sha256 || '')) return [`${label} needs repository-relative path and sha256`];
  if (isAbsolute(reference.path) || reference.path.includes('\\') || reference.path.split('/').includes('..')) return [`${label} path must stay inside --root`];
  const absolute = resolve(root, reference.path); const rootReal = realpathSync(root);
  if (!existsSync(absolute)) return [`${label} does not exist: ${reference.path}`];
  const actual = realpathSync(absolute); const rel = relative(rootReal, actual);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) return [`${label} resolves outside --root`];
  if (!statSync(actual).isFile()) return [`${label} must name a regular file`];
  if (digest(readFileSync(actual)) !== reference.sha256) return [`${label} sha256 drifted: ${reference.path}`];
  return [];
}
function evidenceErrors(items, label, root) {
  const errors = [];
  if (!Array.isArray(items) || items.length === 0) return [`${label} must be a non-empty evidence array`];
  items.forEach((item, index) => {
    const here = `${label}[${index}]`;
    if (!object(item) || !text(item.source)) { errors.push(`${here} needs source and reference`); return; }
    const source = item.source.trim().toLowerCase();
    if (BANNED.has(source)) errors.push(`${here} uses banned provenance ${source}`);
    else if (!DIRECT.has(source)) errors.push(`${here} source ${source} is not direct evidence`);
    errors.push(...referenceErrors(item.reference, `${here}.reference`, root));
    if (item.provenance !== undefined) errors.push(...evidenceErrors(item.provenance, `${here}.provenance`, root));
    scanBanned(item, here, errors);
  });
  return [...new Set(errors)];
}
function containsNotApplicable(value) {
  if (typeof value === 'string') return /\bnot[- ]applicable\b/i.test(value);
  if (Array.isArray(value)) return value.some(containsNotApplicable);
  return object(value) && Object.values(value).some(containsNotApplicable);
}
function receiptErrors(receipt, label, root, execution = false) {
  if (!object(receipt)) return [`${label} must be an object`];
  const errors = referenceErrors(receipt.reference, `${label}.reference`, root);
  if (execution) {
    if (!text(receipt.command) || !object(receipt.result) || receipt.result.exitCode !== 0 || receipt.result.impactObserved !== true || !text(receipt.result.startPrivilege) || !text(receipt.result.impact)) errors.push(`${label} needs command and structured successful result`);
    if (errors.length === 0) {
      try {
        const artifact = JSON.parse(readFileSync(resolve(root, receipt.reference.path), 'utf8'));
        if (artifact.command !== receipt.command || JSON.stringify(artifact.result) !== JSON.stringify(receipt.result)) errors.push(`${label} command and result must match the hashed receipt artifact`);
      } catch { errors.push(`${label} must reference a JSON artifact containing command and result`); }
    }
  }
  return errors;
}
function inspectionErrors(inspection, hypothesisId, root) {
  const errors = []; const references = new Set();
  const sources = { runtime: 'runtime', framework: 'framework', database: 'database', library: 'library', dependencySource: 'dependency-source' };
  for (const [layer, source] of Object.entries(sources)) {
    const items = inspection?.[layer];
    if (!Array.isArray(items) || items.length !== 1) { errors.push(`hypothesis ${hypothesisId} directInspection.${layer} must contain exactly one layer-bound receipt`); continue; }
    const item = items[0]; const key = `${item.reference?.path || ''}\0${item.reference?.sha256 || ''}`;
    if (references.has(key)) errors.push(`hypothesis ${hypothesisId} directInspection layers must use distinct references`); references.add(key);
    if (item.source !== source) errors.push(`hypothesis ${hypothesisId} directInspection.${layer} must use source ${source}`);
    if (referenceErrors(item.reference, `hypothesis ${hypothesisId} directInspection.${layer}.reference`, root).length === 0) {
      try {
        const artifact = JSON.parse(readFileSync(resolve(root, item.reference.path), 'utf8'));
        if (artifact.hypothesisId !== hypothesisId || artifact.layer !== layer) errors.push(`hypothesis ${hypothesisId} directInspection.${layer} receipt must bind hypothesis and layer`);
      } catch { errors.push(`hypothesis ${hypothesisId} directInspection.${layer} must reference a layer-bound JSON receipt`); }
    }
  }
  return errors;
}
function pathTo(nodes, edges, from, wanted) {
  const next = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) if (Array.isArray(edge) && edge.length === 2) next.get(edge[0])?.push(edge[1]);
  const pending = [[from, [from]]]; const seen = new Set();
  while (pending.length) { const [id, path] = pending.shift(); if (seen.has(id)) continue; seen.add(id); if (wanted.has(id)) return path; for (const child of next.get(id) || []) pending.push([child, [...path, child]]); }
  return null;
}
function entrySinkPath(hypothesis) {
  const sinks = new Set(hypothesis.nodes.filter((node) => node.kind === 'sink').map((node) => node.id));
  for (const entry of hypothesis.nodes.filter((node) => node.kind === 'entry')) { const path = pathTo(hypothesis.nodes, hypothesis.edges, entry.id, sinks); if (path) return path; }
  return null;
}
function bindingErrors(binding, label, units, validator = false) {
  if (!object(binding) || !text(binding.unit) || !text(binding.actor) || !Number.isInteger(binding.wave) || binding.wave < 1) return [`${label} needs unit, actor, and positive wave`];
  const unit = units.get(binding.unit); if (!unit) return [`${label} names unknown contract unit ${binding.unit}`];
  const errors = [];
  if (binding.actor !== actor(unit) || binding.wave !== unit.wave) errors.push(`${label} actor and wave must match contract unit ${binding.unit}`);
  if (validator !== ['review', 'refutation'].includes(unit.kind)) errors.push(`${label} must bind a ${validator ? 'review or refutation' : 'work'} unit`);
  return errors;
}

function campaignErrors(campaign, contract, root, ledgerPath, final) {
  const errors = []; const fail = (message) => errors.push(message);
  if (!object(contract) || contract.version !== 4 || !Array.isArray(contract.units)) return ['contract must be a version-4 run contract with units'];
  const units = new Map(contract.units.filter(object).map((unit) => [unit.id, unit]));
  if (!object(campaign)) return ['campaign must be an object'];
  scanBanned(campaign, 'campaign', errors);
  if (campaign.version !== 2) fail('version must be 2');
  if (campaign.mode !== 'security') fail('mode must be "security"');
  errors.push(...evidenceErrors(campaign.discoveryEvidence, 'discoveryEvidence', root));
  const ledgerRows = new Map();
  for (const line of readFileSync(ledgerPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\|\s*(D-\d+)\s*\|[^|]*\|[^|]*\|[^|]*\|\s*([^|]*?)\s*\|$/); if (match) ledgerRows.set(match[1], match[2]);
  }
  const journalUnits = new Set();
  for (const line of readFileSync(`${ledgerPath}.journal.jsonl`, 'utf8').split(/\r?\n/).filter(Boolean)) { try { const event = JSON.parse(line); if (event.op === 'add') journalUnits.add(event.id); } catch {} }
  const artifactUnits = new Set();
  if (!object(campaign.runEvidence)) fail('runEvidence must bind the ledger, journal, and reported unit artifacts');
  else {
    errors.push(...referenceErrors(campaign.runEvidence.ledger, 'runEvidence.ledger', root), ...referenceErrors(campaign.runEvidence.journal, 'runEvidence.journal', root));
    if (resolve(root, campaign.runEvidence.ledger?.path || '') !== resolve(ledgerPath)) fail('runEvidence.ledger must match --ledger');
    if (resolve(root, campaign.runEvidence.journal?.path || '') !== resolve(`${ledgerPath}.journal.jsonl`)) fail('runEvidence.journal must match the dispatch journal');
    if (!Array.isArray(campaign.runEvidence.artifacts)) fail('runEvidence.artifacts must be an array');
    for (const item of Array.isArray(campaign.runEvidence.artifacts) ? campaign.runEvidence.artifacts : []) {
      if (!object(item) || !text(item.unit) || !units.has(item.unit)) { fail('runEvidence artifact names an unknown unit'); continue; }
      if (artifactUnits.has(item.unit)) fail(`runEvidence repeats artifact for ${item.unit}`); artifactUnits.add(item.unit);
      const unit = units.get(item.unit); if (item.reference?.path !== unit.artifact) fail(`runEvidence artifact for ${item.unit} must match its contract artifact`);
      errors.push(...referenceErrors(item.reference, `runEvidence artifact ${item.unit}`, root));
    }
    if (final) for (const id of units.keys()) if (!artifactUnits.has(id)) fail(`runEvidence lacks final artifact for ${id}`);
  }
  if (!Array.isArray(campaign.families) || campaign.families.length < 2) fail('at least two exploit families are required to resist convergence');
  if (!Array.isArray(campaign.hypotheses) || !campaign.hypotheses.length) fail('hypotheses must be a non-empty array');
  if (!Array.isArray(campaign.launches)) fail('launches must be an array');
  if (!object(campaign.goal) || !text(campaign.goal.startPrivilege) || !text(campaign.goal.impact)) fail('goal needs startPrivilege and impact');
  if (!object(campaign.goal?.deployment) || campaign.goal.deployment.profile !== 'common') fail('goal deployment must name a common profile');
  else errors.push(...evidenceErrors(campaign.goal.deployment.evidence, 'goal deployment evidence', root));

  const families = new Map(); const familyUnits = new Map();
  for (const family of campaign.families || []) {
    if (!object(family) || !text(family.id) || !text(family.title)) { fail('every family needs id and title'); continue; }
    if (families.has(family.id)) fail(`duplicate family ${family.id}`); families.set(family.id, family);
    errors.push(...bindingErrors(family.owner, `family ${family.id} owner`, units));
    if (text(family.owner?.unit)) {
      if (familyUnits.has(family.owner.unit)) fail(`families ${familyUnits.get(family.owner.unit)} and ${family.id} share work unit ${family.owner.unit}`);
      else familyUnits.set(family.owner.unit, family.id);
    }
  }
  const ownerWaves = new Set([...families.values()].map((family) => family.owner?.wave));
  if (ownerWaves.size > 1) fail('all exploit-family work units must run in the same parallel wave');

  const hypotheses = new Map(); const familyCounts = new Map(); const closedValidationReceipts = new Set();
  for (const hypothesis of campaign.hypotheses || []) {
    const prefix = `hypothesis ${hypothesis?.id || '(missing id)'}`;
    if (!object(hypothesis) || !text(hypothesis.id)) { fail('every hypothesis needs an id'); continue; }
    if (hypotheses.has(hypothesis.id)) fail(`duplicate hypothesis ${hypothesis.id}`); hypotheses.set(hypothesis.id, hypothesis);
    const family = families.get(hypothesis.family);
    if (!family) fail(`${prefix}: unknown family ${hypothesis.family || '(missing)'}`);
    else {
      familyCounts.set(hypothesis.family, (familyCounts.get(hypothesis.family) || 0) + 1);
      if (hypothesis.work?.unit !== family.owner?.unit || hypothesis.work?.actor !== family.owner?.actor) fail(`${prefix}: work must match its family's distinct operative unit and actor`);
    }
    errors.push(...bindingErrors(hypothesis.work, `${prefix} work`, units));
    if (!STATES.has(hypothesis.state)) fail(`${prefix}: invalid state`);
    if (!Number.isInteger(hypothesis.likelihood) || hypothesis.likelihood < 1 || hypothesis.likelihood > 5) fail(`${prefix}: likelihood must be 1..5`);
    if (!Number.isInteger(hypothesis.impact) || hypothesis.impact < 1 || hypothesis.impact > 5) fail(`${prefix}: impact must be 1..5`);
    if (!Array.isArray(hypothesis.nodes) || hypothesis.nodes.length < 2) fail(`${prefix}: nodes must describe a chain`);
    const ids = [];
    for (const node of hypothesis.nodes || []) { if (!object(node) || !text(node.id) || !KINDS.has(node.kind) || !text(node.label) || !text(node.location) || !location(node.location)) fail(`${prefix}: every node needs id, kind, label, and canonical file:line location`); else ids.push(node.id); }
    if (!unique(ids)) fail(`${prefix}: node ids must be unique within a chain`);
    const kinds = new Set((hypothesis.nodes || []).map((node) => node?.kind));
    for (const kind of KINDS) if (!kinds.has(kind)) fail(`${prefix}: chain needs ${kind === 'entry' ? 'an' : 'a'} ${kind} node`);
    if (!Array.isArray(hypothesis.edges) || !hypothesis.edges.length) fail(`${prefix}: edges must connect the chain`);
    for (const edge of hypothesis.edges || []) if (!Array.isArray(edge) || edge.length !== 2 || !ids.includes(edge[0]) || !ids.includes(edge[1])) fail(`${prefix}: each edge must name two known node ids`);
    for (const node of hypothesis.nodes || []) {
      if (node.kind === 'entry' && (hypothesis.edges || []).some(([, right]) => right === node.id)) fail(`${prefix}: entry ${node.id} must have indegree zero`);
      if (node.kind === 'sink' && (hypothesis.edges || []).some(([left]) => left === node.id)) fail(`${prefix}: sink ${node.id} must have outdegree zero`);
    }
    if (kinds.has('entry') && kinds.has('sink') && !entrySinkPath(hypothesis)) fail(`${prefix}: no directed entry-to-sink chain exists`);
    if (kinds.has('entry') && kinds.has('sink')) {
      const entries = hypothesis.nodes.filter((node) => node.kind === 'entry').map((node) => node.id);
      const sinks = hypothesis.nodes.filter((node) => node.kind === 'sink').map((node) => node.id);
      const next = new Map(ids.map((id) => [id, []])); const previous = new Map(ids.map((id) => [id, []]));
      for (const [left, right] of hypothesis.edges || []) { next.get(left)?.push(right); previous.get(right)?.push(left); }
      const walk = (starts, graph) => { const seen = new Set(); const pending = [...starts]; while (pending.length) { const id = pending.shift(); if (seen.has(id)) continue; seen.add(id); pending.push(...(graph.get(id) || [])); } return seen; };
      const fromEntry = walk(entries, next); const toSink = walk(sinks, previous);
      const participating = new Set(ids.filter((id) => fromEntry.has(id) && toSink.has(id)));
      for (const id of ids) if (!participating.has(id)) fail(`${prefix}: node ${id} does not participate in a directed entry-to-sink path`);
    }

    const validation = hypothesis.validation;
    if (!object(validation) || validation.outOfBand !== true || !VALIDATION.has(validation.status)) fail(`${prefix}: validation needs an out-of-band status`);
    else {
      errors.push(...bindingErrors(validation.discoveredBy, `${prefix} discoverer`, units), ...bindingErrors(validation.validator, `${prefix} validator`, units, true));
      if (validation.discoveredBy?.unit !== hypothesis.work?.unit) fail(`${prefix}: discoverer must be the hypothesis work unit`);
      if (validation.validator?.unit === validation.discoveredBy?.unit) fail(`${prefix}: validator must use a different contract unit from its discoverer`);
      const validator = units.get(validation.validator?.unit);
      if (validator && (!(validator.validates || []).includes(hypothesis.work?.unit) || !(validator.independentOf || []).includes(hypothesis.work?.unit))) fail(`${prefix}: validator contract unit must validate and be independentOf the work unit`);
      errors.push(...receiptErrors(validation.receipt, `${prefix} validator receipt`, root));
      if (object(validation.receipt)) errors.push(...evidenceErrors(validation.receipt.evidence, `${prefix} validator receipt evidence`, root));
    }
    if (hypothesis.implementationDependent !== true) fail(`${prefix}: implementationDependent must be true for every security hypothesis`);
    if (hypothesis.implementationDependent === true) {
      if (!object(hypothesis.directInspection)) fail(`${prefix}: implementation-dependent chain needs directInspection`);
      else for (const field of ['runtime', 'framework', 'database', 'library', 'dependencySource']) {
        errors.push(...evidenceErrors(hypothesis.directInspection[field], `${prefix} directInspection.${field}`, root));
        if (containsNotApplicable(hypothesis.directInspection[field])) fail(`${prefix}: directInspection.${field} cannot use not-applicable for an implementation-dependent chain`);
      }
      errors.push(...inspectionErrors(hypothesis.directInspection, hypothesis.id, root));
    }
    if (hypothesis.state === 'OPEN' && validation?.status !== 'PENDING') fail(`${prefix}: OPEN chains require PENDING independent validation`);
    if (hypothesis.state === 'BLOCKED' && !text(hypothesis.blockReason)) fail(`${prefix}: BLOCKED chains need blockReason`);
    if (hypothesis.state === 'EXHAUSTED') errors.push(...evidenceErrors(hypothesis.exhaustionEvidence, `${prefix} exhaustionEvidence`, root));
    if (hypothesis.state === 'CLOSED') {
      if (validation?.status !== 'SURVIVED') fail(`${prefix}: CLOSED chains need SURVIVED independent validation`);
      if (!object(hypothesis.closure) || hypothesis.closure.startPrivilege !== campaign.goal?.startPrivilege || hypothesis.closure.impact !== campaign.goal?.impact) fail(`${prefix}: CLOSED chain must prove the campaign start-privilege to impact goal`);
      if (!object(hypothesis.closure?.deployment) || hypothesis.closure.deployment.profile !== 'common') fail(`${prefix}: CLOSED chain must prove a realistic common deployment`);
      else errors.push(...evidenceErrors(hypothesis.closure.deployment.evidence, `${prefix} closure deployment evidence`, root));
      const receipt = hypothesis.closure?.executionReceipt;
      errors.push(...receiptErrors(receipt, `${prefix} CLOSED execution receipt`, root, true));
      if (object(receipt)) errors.push(...evidenceErrors(receipt.evidence, `${prefix} execution receipt evidence`, root));
      if (object(receipt?.result) && (receipt.result.startPrivilege !== campaign.goal?.startPrivilege || receipt.result.impact !== campaign.goal?.impact)) fail(`${prefix}: CLOSED execution result must match the campaign goal`);
      const validationRef = hypothesis.validation?.receipt?.reference;
      const validationKey = `${validationRef?.path || ''}\0${validationRef?.sha256 || ''}`;
      if (closedValidationReceipts.has(validationKey)) fail(`${prefix}: CLOSED validator receipt cannot be reused`); closedValidationReceipts.add(validationKey);
      if (referenceErrors(validationRef, `${prefix} validator receipt reference`, root).length === 0) {
        try {
          const artifact = JSON.parse(readFileSync(resolve(root, validationRef.path), 'utf8'));
          if (artifact.hypothesisId !== hypothesis.id || artifact.status !== hypothesis.validation.status || artifact.validatorUnit !== hypothesis.validation.validator.unit || artifact.validatorActor !== hypothesis.validation.validator.actor) fail(`${prefix}: CLOSED validator receipt must bind hypothesis, status, and validator`);
        } catch { fail(`${prefix}: CLOSED validator receipt must be a binding JSON artifact`); }
      }
    }
  }

  if ([...familyCounts.keys()].length < 2) fail('hypotheses must cover at least two exploit families');
  const launches = new Map(); const sequences = []; const launchedHypotheses = new Set();
  for (const launch of campaign.launches || []) {
    if (!object(launch) || !text(launch.id) || !families.has(launch.family) || !['initial', 'neglected'].includes(launch.reason) || !text(launch.hypothesis) || !Number.isInteger(launch.sequence) || launch.sequence < 1) { fail('each launch needs id, sequence, known family, initial|neglected reason, and hypothesis'); continue; }
    if (launches.has(launch.id)) fail(`duplicate launch ${launch.id}`); launches.set(launch.id, launch); sequences.push(launch.sequence);
    if (launchedHypotheses.has(launch.hypothesis)) fail(`hypothesis ${launch.hypothesis} is launched more than once`); launchedHypotheses.add(launch.hypothesis);
    const hypothesis = hypotheses.get(launch.hypothesis);
    if (!hypothesis) fail(`launch ${launch.id} names unknown hypothesis ${launch.hypothesis}`); else if (hypothesis.family !== launch.family) fail(`launch ${launch.id} family does not match its hypothesis`);
    errors.push(...bindingErrors(launch.work, `launch ${launch.id} work`, units));
    if (hypothesis && (launch.work?.unit !== hypothesis.work?.unit || launch.work?.actor !== hypothesis.work?.actor || launch.work?.wave !== hypothesis.work?.wave)) fail(`launch ${launch.id} work must match its hypothesis work binding`);
  }
  if (!unique(sequences)) fail('launch sequences must be unique');
  const boundUnits = new Set([
    ...(campaign.families || []).map((family) => family.owner?.unit),
    ...(campaign.hypotheses || []).flatMap((hypothesis) => [hypothesis.work?.unit, hypothesis.validation?.discoveredBy?.unit, hypothesis.validation?.validator?.unit]),
    ...(campaign.launches || []).map((launch) => launch.work?.unit),
  ].filter(Boolean));
  for (const id of boundUnits) {
    if (!ledgerRows.has(id) || !journalUnits.has(id)) fail(`campaign binding ${id} lacks an actual ledger row and dispatch journal add event`);
    if (ledgerRows.get(id) === 'reported' && !artifactUnits.has(id)) fail(`reported campaign binding ${id} lacks a hash-bound artifact`);
  }
  for (const family of families.keys()) { if (!familyCounts.has(family)) fail(`family ${family} is neglected without a launched hypothesis`); if (![...launches.values()].some((launch) => launch.family === family)) fail(`family ${family} lacks a recorded launch`); }
  const openLaunches = [...launches.values()].sort((a, b) => a.sequence - b.sequence);
  const counts = new Map(); let dominantFamily = null;
  const dominant = () => { const total = [...counts.values()].reduce((sum, value) => sum + value, 0); return [...counts].find(([, count]) => total >= 3 && count * 2 > total)?.[0] || null; };
  for (const launch of openLaunches) {
    if (dominantFamily && (launch.reason !== 'neglected' || launch.family === dominantFamily)) fail(`launch ${launch.id} deepens dominant family ${dominantFamily} before an immediate neglected-family counter-launch`);
    counts.set(launch.family, (counts.get(launch.family) || 0) + 1);
    dominantFamily = dominant();
  }
  if (dominantFamily) fail(`family ${dominantFamily} remains dominant; launch a currently OPEN neglected-family counter-hypothesis immediately after dominance`);
  return errors;
}

function traceTails(hypothesis, start) {
  const byId = new Map(hypothesis.nodes.map((node) => [node.id, node])); const next = new Map(hypothesis.nodes.map((node) => [node.id, []]));
  for (const [left, right] of hypothesis.edges) next.get(left)?.push(right);
  const tails = []; const pending = [[start, []]];
  while (pending.length) { const [id, path] = pending.shift(); if (path.includes(id)) { tails.push({ status: 'cycle', ids: [...path, id] }); continue; } const following = next.get(id) || []; const traced = [...path, id]; if (!following.length || byId.get(id)?.kind === 'sink') tails.push({ status: hypothesis.state === 'OPEN' ? 'open' : 'terminal', ids: traced }); else for (const child of following) pending.push([child, traced]); }
  return tails.map((tail) => ({ status: tail.status, nodes: tail.ids.map((id) => byId.get(id)?.label || id) }));
}
function collisions(campaign) {
  const locations = new Map(); const files = new Map();
  for (const hypothesis of campaign.hypotheses) for (const node of hypothesis.nodes) {
    const outgoing = hypothesis.edges.filter(([left]) => left === node.id).length;
    const sinks = new Set(hypothesis.nodes.filter((item) => item.kind === 'sink').map((item) => item.id));
    const loc = location(node.location); const entry = {
      id: hypothesis.id, state: hypothesis.state, kind: node.kind, label: node.label, location: loc,
      blockedTerminal: hypothesis.state === 'BLOCKED' && outgoing === 0,
      reachableOpenEntry: hypothesis.state === 'OPEN' && node.kind === 'entry' && Boolean(pathTo(hypothesis.nodes, hypothesis.edges, node.id, sinks)),
      tails: traceTails(hypothesis, node.id),
    };
    for (const [map, key] of [[locations, loc], [files, fileOf(loc)]]) map.set(key, [...(map.get(key) || []), entry]);
  }
  const collect = (map, type) => [...map].filter(([, entries]) => new Set(entries.map((entry) => entry.id)).size > 1).map(([key, entries]) => {
    const resumptions = type === 'location' ? new Set(entries.filter((entry) => entry.blockedTerminal).flatMap((blocked) => entries.filter((entry) => entry.reachableOpenEntry).map((open) => `${blocked.id}->${open.id}`))) : new Set();
    return { type, key, entries: entries.sort((a, b) => a.id.localeCompare(b.id)), resumptions: [...resumptions].sort() };
  });
  return [...collect(files, 'file'), ...collect(locations, 'location')].sort((a, b) => a.type.localeCompare(b.type) || a.key.localeCompare(b.key));
}
function ranked(campaign, index) {
  const weights = new Map();
  for (const item of index.filter((entry) => entry.type === 'location')) for (const id of new Set(item.entries.map((entry) => entry.id))) weights.set(id, (weights.get(id) || 0) + 1);
  return campaign.hypotheses.filter((hypothesis) => hypothesis.state === 'OPEN').map((hypothesis) => { const path = entrySinkPath(hypothesis); const nodes = new Map(hypothesis.nodes.map((node) => [node.id, node])); const count = weights.get(hypothesis.id) || 0; return { hypothesis, entry: nodes.get(path[0]), sink: nodes.get(path.at(-1)), count, score: hypothesis.impact * 20 + hypothesis.likelihood * 10 + count * 5 }; }).sort((a, b) => b.score - a.score || a.hypothesis.id.localeCompare(b.hypothesis.id));
}
function report(campaign) {
  const index = collisions(campaign); console.log('# Defensive attack-chain campaign'); console.log(`Goal: ${campaign.goal.startPrivilege} -> ${campaign.goal.impact} (${campaign.goal.deployment.profile} deployment)`); console.log('\n## File and location collisions');
  if (!index.length) console.log('No cross-chain file or location collisions yet.');
  for (const item of index) { console.log(`- ${item.type}:${item.key}${item.resumptions.length ? `; blocked-to-open resumptions ${item.resumptions.join(', ')}` : ''}`); for (const entry of item.entries) console.log(`  - ${entry.id} ${entry.state} ${entry.kind}:${entry.label} -> ${entry.tails.map((tail) => `${tail.status} ${tail.nodes.join(' -> ')}`).join(' | ')}`); }
  console.log('\n## Ranked open chains for out-of-band validation'); const open = ranked(campaign, index); if (!open.length) console.log('No OPEN chains.');
  for (const item of open) console.log(`- ${item.hypothesis.id} (${item.hypothesis.family}) ${item.entry.label}@${item.entry.location} -> ${item.sink.label}@${item.sink.location}; score ${item.score}; location collisions ${item.count}; validator ${item.hypothesis.validation.validator.actor} PENDING; receipt ${item.hypothesis.validation.receipt.reference.path}`);
}

const [command, ...rest] = process.argv.slice(2); let campaignPath = ''; let contractPath = ''; let ledgerPath = ''; let root = process.cwd(); let final = false;
for (let i = 0; i < rest.length; i++) { if (rest[i] === '--campaign') campaignPath = rest[++i] || ''; else if (rest[i] === '--contract') contractPath = rest[++i] || ''; else if (rest[i] === '--ledger') ledgerPath = rest[++i] || ''; else if (rest[i] === '--root') root = rest[++i] || ''; else if (rest[i] === '--final') final = true; else usage(); }
if (!['check', 'report'].includes(command) || !campaignPath || !contractPath || !ledgerPath) usage();
try {
  root = realpathSync(resolve(root)); campaignPath = resolve(campaignPath); contractPath = resolve(contractPath); ledgerPath = resolve(ledgerPath);
  execFileSync(process.execPath, [resolve(SCRIPT_DIR, 'run-contract.mjs'), 'check', '--contract', contractPath, '--root', root], { cwd: root, encoding: 'utf8' });
  const reconcileArgs = [resolve(SCRIPT_DIR, 'run-contract.mjs'), 'reconcile', '--contract', contractPath, '--ledger', ledgerPath]; if (final) reconcileArgs.push('--strict'); reconcileArgs.push('--root', root);
  execFileSync(process.execPath, reconcileArgs, { cwd: root, encoding: 'utf8' });
  const campaign = readJson(campaignPath, 'campaign'); const contract = readJson(contractPath, 'contract'); const errors = campaignErrors(campaign, contract, root, ledgerPath, final);
  if (errors.length) { console.error(`x attack-chain campaign rejected:\n${errors.map((error) => `  - ${error}`).join('\n')}`); process.exit(1); }
  if (command === 'report') report(campaign); else console.log(`ok attack-chain campaign: ${campaign.families.length} families, ${campaign.hypotheses.length} hypotheses`);
}
catch (error) { console.error(`x ${error.message}`); process.exit(2); }
