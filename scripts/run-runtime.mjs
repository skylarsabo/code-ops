#!/usr/bin/env node
// Compiles cache-ready prompt prefixes and hash-chained runtime checkpoints.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atomicWrite,
  checkedPath,
  digestJson,
  readJson,
  repoRelative,
  safeRelative,
  sha256,
} from './context-index-lib.mjs';
import {
  CACHE_EVENTS,
  CACHE_OBSERVABILITY,
  OBSERVATION_SOURCES,
  emptyRuntimeReferences,
  receiptSha256,
  replayRuntimeReceipts,
  runtimeBinding,
  runtimeMetrics,
} from './runtime-lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const RUN_CONTRACT = resolve(SCRIPT_DIR, 'run-contract.mjs');
const DISPATCH_LEDGER = resolve(SCRIPT_DIR, 'dispatch-ledger.mjs');
const CONTEXT_BUNDLE = resolve(SCRIPT_DIR, 'context-bundle.mjs');
const REPEATABLE = new Set(['--artifact', '--bundle', '--cache-event']);

function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
function usage() {
  die('usage: run-runtime.mjs init --root <repo> --contract <path>\n'
    + '       run-runtime.mjs checkpoint --root <repo> --contract <path> --ledger <path> [--acceptance <path>] [--handoff <path>] [--bundle <path> ...] [--artifact <path> ...]\n'
    + '       run-runtime.mjs resume --root <repo> --contract <path>\n'
    + '       run-runtime.mjs replan --root <repo> --contract <path> --ledger <path> [--acceptance <path>] [--handoff <path>] [--bundle <path> ...] [--artifact <path> ...]\n'
    + '       run-runtime.mjs observe --root <repo> --contract <path> --observability observed|unobservable|unsupported --source provider-usage|host-telemetry|operator [--cache-event hit|miss|write ...] [--cache-read-input-tokens <n>] [--cache-write-input-tokens <n>] [--input-tokens <n>] [--output-tokens <n>]\n'
    + '       run-runtime.mjs verify --root <repo> --contract <path>\n'
    + '       run-runtime.mjs prefix --root <repo> --contract <path>\n'
    + '       run-runtime.mjs metrics --root <repo> --contract <path> [--json]', 2);
}

function flags(args, known, booleans = new Set()) {
  const out = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!known.has(key) || (out[key] !== undefined && !REPEATABLE.has(key))) usage();
    if (booleans.has(key)) { out[key] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) usage();
    if (REPEATABLE.has(key)) (out[key] ??= []).push(value);
    else out[key] = value;
  }
  return out;
}

function resolveInput(root, value, label) {
  let absolute;
  let relative;
  try {
    absolute = isAbsolute(value) ? resolve(value) : resolve(root, value);
    relative = repoRelative(root, absolute);
  } catch {
    throw new Error(`${label} must resolve to a repository-relative path inside root`);
  }
  return { absolute: checkedPath(root, relative), relative };
}

function runCheck(script, args, label) {
  try { return execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' }); }
  catch (error) {
    const detail = `${error.stdout || ''}${error.stderr || ''}`.trim();
    throw new Error(`${label} failed${detail ? `:\n${detail}` : ''}`);
  }
}

function loadCurrent(root, contractArgument) {
  const contractPath = resolveInput(root, contractArgument, 'contract path');
  runCheck(RUN_CONTRACT, ['check', '--contract', contractPath.absolute, '--root', root], 'run contract check');
  const contract = readJson(contractPath.absolute);
  if (contract.version !== 3 || !contract.runtime) throw new Error('long-horizon runtime requires a version 3 run contract');
  const bound = runtimeBinding(root, contractPath.absolute, contract);
  const runtimePath = { relative: contract.runtime.receipts, absolute: checkedPath(root, contract.runtime.receipts) };
  return { contract, contractPath, runtimePath, ...bound };
}

function loadChain(path) {
  if (!existsSync(path)) throw new Error('runtime receipt chain does not exist; run init first');
  if (!statSync(path).isFile()) throw new Error('runtime receipt chain path is not a file');
  const text = readFileSync(path, 'utf8');
  return { text, replayed: replayRuntimeReceipts(text) };
}

function same(left, right) {
  return digestJson(left) === digestJson(right);
}

function requireCurrentBinding(current, replayed) {
  if (!same(current.binding, replayed.activeBinding)) throw new Error('runtime binding drift; append a replan before continuing');
}

function lockPath(runtimePath) { return `${runtimePath}.lock`; }

function withRuntimeLock(runtimePath, operation) {
  const lock = lockPath(runtimePath);
  mkdirSync(dirname(runtimePath), { recursive: true });
  try { mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`runtime mutation lock exists: ${repoRelative(dirname(runtimePath), lock)}; verify the owner is gone and the receipt chain is valid before removing it`);
    throw error;
  }
  try {
    writeFileSync(resolve(lock, 'owner.json'), `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`);
    return operation();
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

function appendReceipt(runtimePath, build) {
  return withRuntimeLock(runtimePath, () => {
    const { text, replayed } = loadChain(runtimePath);
    const event = build(replayed);
    event.receiptSha256 = receiptSha256(event);
    const rendered = `${JSON.stringify(event)}\n`;
    replayRuntimeReceipts(`${text}${rendered}`);
    atomicWrite(runtimePath, `${text}${rendered}`);
    return event;
  });
}

function newReceipt(kind, binding, references, observation, replayed) {
  return {
    version: 1,
    sequence: replayed ? replayed.events.length + 1 : 1,
    kind,
    recordedAt: new Date().toISOString(),
    previousReceiptSha256: replayed ? replayed.events.at(-1).receiptSha256 : null,
    binding,
    references,
    observation,
    receiptSha256: null,
  };
}

function fileReference(root, argument, label) {
  const path = resolveInput(root, argument, label);
  if (!statSync(path.absolute).isFile()) throw new Error(`${label} must name a file`);
  return { path: path.relative, sha256: sha256(readFileSync(path.absolute)) };
}

function checkLedger(root, argument) {
  const ledger = resolveInput(root, argument, 'ledger path');
  runCheck(DISPATCH_LEDGER, ['check', '--ledger', ledger.absolute, '--strict'], 'strict dispatch ledger check');
  const journalAbsolute = `${ledger.absolute}.journal.jsonl`;
  const journalRelative = `${ledger.relative}.journal.jsonl`;
  return {
    path: ledger.relative,
    sha256: sha256(readFileSync(ledger.absolute)),
    journalPath: existsSync(journalAbsolute) ? journalRelative : null,
    journalSha256: existsSync(journalAbsolute) ? sha256(readFileSync(journalAbsolute)) : null,
  };
}

function portableUnique(items, label) {
  const keys = items.map((item) => item.path.normalize('NFC').toLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error(`${label} repeats a portable path`);
}

function bundleReference(root, contractPath, argument) {
  const path = resolveInput(root, argument, 'bundle path');
  if (!statSync(path.absolute).isFile()) throw new Error('bundle path must name a file');
  const bundle = readJson(path.absolute);
  if (!/^D-\d{3}$/.test(bundle.unitId || '')) throw new Error(`bundle has invalid unitId: ${path.relative}`);
  runCheck(CONTEXT_BUNDLE, ['verify', '--root', root, '--contract', contractPath, '--unit', bundle.unitId, '--bundle', path.absolute], `context bundle ${bundle.unitId} verification`);
  return { unitId: bundle.unitId, path: path.relative, bundleId: bundle.bundleId, sha256: sha256(readFileSync(path.absolute)) };
}

function buildReferences(root, current, f) {
  const bundles = (f['--bundle'] || []).map((value) => bundleReference(root, current.contractPath.absolute, value)).sort((a, b) => a.path.localeCompare(b.path));
  const artifacts = (f['--artifact'] || []).map((value) => fileReference(root, value, 'artifact path')).sort((a, b) => a.path.localeCompare(b.path));
  portableUnique(bundles, 'bundle references');
  portableUnique(artifacts, 'artifact references');
  return {
    ledger: checkLedger(root, f['--ledger']),
    acceptance: f['--acceptance'] ? fileReference(root, f['--acceptance'], 'acceptance path') : null,
    handoff: f['--handoff'] ? fileReference(root, f['--handoff'], 'handoff path') : null,
    bundles,
    artifacts,
  };
}

function verifyFileReference(root, reference, label) {
  const current = fileReference(root, reference.path, label);
  if (current.sha256 !== reference.sha256) throw new Error(`${label} drift: ${reference.path}`);
}

function verifyReferences(root, current, references) {
  if (!references) return;
  if (references.ledger) {
    const actual = checkLedger(root, references.ledger.path);
    if (!same(actual, references.ledger)) throw new Error(`dispatch ledger drift: ${references.ledger.path}`);
  }
  if (references.acceptance) verifyFileReference(root, references.acceptance, 'acceptance ledger');
  if (references.handoff) verifyFileReference(root, references.handoff, 'handoff');
  for (const reference of references.artifacts) verifyFileReference(root, reference, 'checkpoint artifact');
  for (const reference of references.bundles) {
    const actual = bundleReference(root, current.contractPath.absolute, reference.path);
    if (!same(actual, reference)) throw new Error(`context bundle drift: ${reference.path}`);
  }
}

function parseToken(f, name) {
  if (f[name] === undefined) return null;
  if (!/^(?:0|[1-9]\d*)$/.test(f[name])) throw new Error(`${name} must be a nonnegative integer`);
  const value = Number(f[name]);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} exceeds the safe integer range`);
  return value;
}

function receiptFlags(args) {
  const known = new Set(['--root', '--contract', '--ledger', '--acceptance', '--handoff', '--bundle', '--artifact']);
  const f = flags(args, known);
  if (!f['--root'] || !f['--contract'] || !f['--ledger']) usage();
  return f;
}

const command = process.argv[2];
if (command === 'init') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--contract']));
  if (!f['--root'] || !f['--contract']) usage();
  try {
    const root = resolve(f['--root']);
    const current = loadCurrent(root, f['--contract']);
    const event = withRuntimeLock(current.runtimePath.absolute, () => {
      if (existsSync(current.runtimePath.absolute)) throw new Error('runtime receipt chain already exists');
      const created = newReceipt('init', current.binding, emptyRuntimeReferences(), null, null);
      created.receiptSha256 = receiptSha256(created);
      const rendered = `${JSON.stringify(created)}\n`;
      replayRuntimeReceipts(rendered);
      atomicWrite(current.runtimePath.absolute, rendered);
      return created;
    });
    console.log(`ok runtime ${current.contract.runId} sequence ${event.sequence}`);
  } catch (error) { die(error.message); }
} else if (command === 'checkpoint') {
  const f = receiptFlags(process.argv.slice(3));
  try {
    const root = resolve(f['--root']);
    const current = loadCurrent(root, f['--contract']);
    const event = appendReceipt(current.runtimePath.absolute, (replayed) => {
      requireCurrentBinding(current, replayed);
      const references = buildReferences(root, current, f);
      return newReceipt('checkpoint', current.binding, references, null, replayed);
    });
    console.log(`ok runtime ${current.contract.runId} sequence ${event.sequence}`);
  } catch (error) { die(error.message); }
} else if (command === 'resume') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--contract']));
  if (!f['--root'] || !f['--contract']) usage();
  try {
    const root = resolve(f['--root']);
    const current = loadCurrent(root, f['--contract']);
    const event = appendReceipt(current.runtimePath.absolute, (replayed) => {
      requireCurrentBinding(current, replayed);
      if (!replayed.latestCheckpoint) throw new Error('runtime has no checkpoint to resume');
      verifyReferences(root, current, replayed.latestCheckpoint.references);
      return newReceipt('resume', current.binding, replayed.latestCheckpoint.references, null, replayed);
    });
    console.log(`ok runtime ${current.contract.runId} sequence ${event.sequence}`);
  } catch (error) { die(error.message); }
} else if (command === 'replan') {
  const f = receiptFlags(process.argv.slice(3));
  try {
    const root = resolve(f['--root']);
    const current = loadCurrent(root, f['--contract']);
    const event = appendReceipt(current.runtimePath.absolute, (replayed) => {
      if (current.binding.runId !== replayed.activeBinding.runId || current.binding.contractRevision !== replayed.activeBinding.contractRevision + 1) {
        throw new Error('replan requires the same runId and exactly the next contract revision');
      }
      const references = buildReferences(root, current, f);
      return newReceipt('replan', current.binding, references, null, replayed);
    });
    console.log(`ok runtime ${current.contract.runId} sequence ${event.sequence}`);
  } catch (error) { die(error.message); }
} else if (command === 'observe') {
  const known = new Set(['--root', '--contract', '--observability', '--cache-event', '--source', '--cache-read-input-tokens', '--cache-write-input-tokens', '--input-tokens', '--output-tokens']);
  const f = flags(process.argv.slice(3), known);
  if (!f['--root'] || !f['--contract'] || !f['--observability'] || !f['--source']) usage();
  try {
    if (!CACHE_OBSERVABILITY.includes(f['--observability'])) throw new Error('cache observability is invalid');
    if (!OBSERVATION_SOURCES.includes(f['--source'])) throw new Error('observation source is invalid');
    const cacheEvents = [...new Set(f['--cache-event'] || [])].sort((left, right) => CACHE_EVENTS.indexOf(left) - CACHE_EVENTS.indexOf(right));
    if (cacheEvents.some((event) => !CACHE_EVENTS.includes(event))) throw new Error('cache event is invalid');
    const root = resolve(f['--root']);
    const current = loadCurrent(root, f['--contract']);
    const observation = {
      observability: f['--observability'],
      cacheEvents,
      source: f['--source'],
      cacheReadInputTokens: parseToken(f, '--cache-read-input-tokens'),
      cacheWriteInputTokens: parseToken(f, '--cache-write-input-tokens'),
      inputTokens: parseToken(f, '--input-tokens'),
      outputTokens: parseToken(f, '--output-tokens'),
    };
    const event = appendReceipt(current.runtimePath.absolute, (replayed) => {
      requireCurrentBinding(current, replayed);
      return newReceipt('observation', current.binding, emptyRuntimeReferences(), observation, replayed);
    });
    console.log(`ok runtime ${current.contract.runId} sequence ${event.sequence}`);
  } catch (error) { die(error.message); }
} else if (command === 'verify') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--contract']));
  if (!f['--root'] || !f['--contract']) usage();
  try {
    const root = resolve(f['--root']);
    const current = loadCurrent(root, f['--contract']);
    const { replayed } = loadChain(current.runtimePath.absolute);
    requireCurrentBinding(current, replayed);
    verifyReferences(root, current, replayed.latestCheckpoint?.references);
    console.log(`ok runtime ${current.contract.runId} ${replayed.events.length} receipt(s)`);
  } catch (error) { die(error.message); }
} else if (command === 'prefix') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--contract']));
  if (!f['--root'] || !f['--contract']) usage();
  try {
    const root = resolve(f['--root']);
    const current = loadCurrent(root, f['--contract']);
    const { replayed } = loadChain(current.runtimePath.absolute);
    requireCurrentBinding(current, replayed);
    process.stdout.write(current.prefix);
  } catch (error) { die(error.message); }
} else if (command === 'metrics') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--contract', '--json']), new Set(['--json']));
  if (!f['--root'] || !f['--contract']) usage();
  try {
    const root = resolve(f['--root']);
    const contractPath = resolveInput(root, f['--contract'], 'contract path');
    const contract = readJson(contractPath.absolute);
    if (contract.version !== 3 || !safeRelative(contract.runtime?.receipts)) throw new Error('metrics require a version 3 runtime contract');
    const runtimePath = checkedPath(root, contract.runtime.receipts);
    const { text, replayed } = loadChain(runtimePath);
    const metrics = runtimeMetrics(replayed, text);
    if (f['--json']) process.stdout.write(`${JSON.stringify(metrics)}\n`);
    else {
      console.log(`runtime receipts: ${metrics.receipts}; checkpoints: ${metrics.checkpoints}; resumes: ${metrics.resumes}; replans: ${metrics.replans}`);
      console.log(`stable prefix: ${metrics.stablePrefix.bytes} byte(s), ${metrics.stablePrefix.versions} version(s)`);
      console.log(`prompt cache: ${JSON.stringify(metrics.promptCache.events)}; read ${metrics.promptCache.cacheReadInputTokens}; write ${metrics.promptCache.cacheWriteInputTokens}`);
      console.log(`elapsed: ${metrics.elapsed}`);
    }
  } catch (error) { die(error.message); }
} else usage();
