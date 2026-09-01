// Shared schema, prefix, and receipt primitives for provider-neutral long-horizon runs.
import { existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { TextDecoder } from 'node:util';
import {
  checkedPath,
  digestJson,
  git,
  gitPaths,
  readJson,
  repoRelative,
  safeRelative,
  sha256,
} from './context-index-lib.mjs';

export const CAPABILITY_NAMES = ['promptCaching', 'compaction', 'contextEditing', 'hostMemory', 'taskBudget'];
export const CAPABILITY_STATES = ['controllable', 'managed-observable', 'managed-unobservable', 'unsupported', 'unknown'];
export const RUNTIME_POLICIES = ['off', 'prefer', 'require', 'require-observable'];
export const CACHE_EVENTS = ['hit', 'miss', 'write'];
export const CACHE_OBSERVABILITY = ['observed', 'unobservable', 'unsupported'];
export const OBSERVATION_SOURCES = ['provider-usage', 'host-telemetry', 'operator'];
export const RUNTIME_RECEIPT_VERSION = 1;

const RUNTIME_KEYS = new Set(['capabilities', 'receipts', 'stablePrefix', 'maxStablePrefixBytes', 'policy']);
const CAPABILITY_KEYS = new Set(['version', 'host', 'provider', 'model', 'source', 'observedAt', 'capabilities']);
const BINDING_KEYS = new Set(['runId', 'contractRevision', 'contractSha256', 'head', 'snapshotId', 'snapshotReceiptSha256', 'hostCapabilities', 'stablePrefix']);
const HOST_BINDING_KEYS = new Set(['sha256', 'host', 'provider', 'model', 'source', 'observedAt', 'states', 'outcomes']);
const PREFIX_KEYS = new Set(['sha256', 'bytes', 'entries']);
const PREFIX_ENTRY_KEYS = new Set(['path', 'sha256', 'bytes']);
const RECEIPT_KEYS = new Set(['version', 'sequence', 'kind', 'recordedAt', 'previousReceiptSha256', 'binding', 'references', 'observation', 'receiptSha256']);
const REFERENCE_KEYS = new Set(['ledger', 'acceptance', 'handoff', 'bundles', 'artifacts']);
const FILE_REFERENCE_KEYS = new Set(['path', 'sha256']);
const LEDGER_REFERENCE_KEYS = new Set(['path', 'sha256', 'journalPath', 'journalSha256']);
const BUNDLE_REFERENCE_KEYS = new Set(['unitId', 'path', 'bundleId', 'sha256']);
const OBSERVATION_KEYS = new Set(['observability', 'cacheEvents', 'source', 'cacheReadInputTokens', 'cacheWriteInputTokens', 'inputTokens', 'outputTokens']);
const RECEIPT_KINDS = new Set(['init', 'checkpoint', 'resume', 'replan', 'observation']);
const SHA256_RE = /^[0-9a-f]{64}$/;
const GIT_OID_RE = /^[0-9a-f]{40,64}$/;
const MAX_RUNTIME_BYTES = 32 * 1024 * 1024;
const UTF8 = new TextDecoder('utf-8', { fatal: true });

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exact(value, keys, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`${label} has unknown key ${key}`);
  for (const key of keys) if (!(key in value)) errors.push(`${label} is missing ${key}`);
  return true;
}

function cleanLabel(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

function normalizedTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function validSha(value) {
  return typeof value === 'string' && SHA256_RE.test(value);
}

function uniquePortablePaths(paths) {
  return new Set(paths.map((path) => path.normalize('NFC').toLowerCase())).size === paths.length;
}

export function validateRuntimeConfig(runtime) {
  const errors = [];
  if (!exact(runtime, RUNTIME_KEYS, 'runtime', errors)) return errors;
  if (!safeRelative(runtime.capabilities)) errors.push('runtime.capabilities must be a safe repository-relative path');
  if (!safeRelative(runtime.receipts)) errors.push('runtime.receipts must be a safe repository-relative path');
  if (runtime.capabilities === runtime.receipts) errors.push('runtime.capabilities and runtime.receipts must differ');
  if (!Array.isArray(runtime.stablePrefix) || runtime.stablePrefix.length === 0
    || runtime.stablePrefix.some((path) => !safeRelative(path))) {
    errors.push('runtime.stablePrefix must be a nonempty array of safe repository-relative paths');
  } else if (!uniquePortablePaths(runtime.stablePrefix)) errors.push('runtime.stablePrefix repeats a portable path');
  if (!Number.isInteger(runtime.maxStablePrefixBytes) || runtime.maxStablePrefixBytes < 1) {
    errors.push('runtime.maxStablePrefixBytes must be a positive integer');
  }
  if (exact(runtime.policy, new Set(CAPABILITY_NAMES), 'runtime.policy', errors)) {
    for (const name of CAPABILITY_NAMES) {
      if (!RUNTIME_POLICIES.includes(runtime.policy[name])) errors.push(`runtime.policy.${name} is invalid`);
    }
  }
  return errors;
}

export function validateHostCapabilities(value) {
  const errors = [];
  if (!exact(value, CAPABILITY_KEYS, 'host capabilities', errors)) return errors;
  if (value.version !== 1) errors.push('host capabilities version must be 1');
  for (const key of ['host', 'provider', 'model']) if (!cleanLabel(value[key])) errors.push(`host capabilities ${key} must be nonempty printable text of at most 128 characters`);
  if (!['operator', 'host-probe', 'provider-docs'].includes(value.source)) errors.push('host capabilities source is invalid');
  if (!normalizedTimestamp(value.observedAt)) errors.push('host capabilities observedAt must be a normalized UTC timestamp');
  if (exact(value.capabilities, new Set(CAPABILITY_NAMES), 'host capabilities capabilities', errors)) {
    for (const name of CAPABILITY_NAMES) {
      if (!CAPABILITY_STATES.includes(value.capabilities[name])) errors.push(`host capability ${name} is invalid`);
    }
  }
  return errors;
}

export function loadHostCapabilities(root, path) {
  if (!safeRelative(path)) throw new Error('host capabilities path must be repository-relative');
  const absolute = checkedPath(root, path);
  if (!existsSync(absolute)) throw new Error(`host capabilities do not exist: ${path}`);
  if (!statSync(absolute).isFile()) throw new Error('host capabilities path must name a file');
  const bytes = readFileSync(absolute);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch (error) { throw new Error(`cannot parse host capabilities: ${error.message}`); }
  const errors = validateHostCapabilities(value);
  if (errors.length) throw new Error(`host capabilities invalid:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  return { value, sha256: sha256(bytes), bytes: bytes.length };
}

export function evaluateRuntimePolicy(runtime, descriptor) {
  const errors = [];
  const decisions = {};
  const available = new Set(['controllable', 'managed-observable', 'managed-unobservable']);
  const observable = new Set(['controllable', 'managed-observable']);
  for (const name of CAPABILITY_NAMES) {
    const policy = runtime.policy[name];
    const state = descriptor.capabilities[name];
    if (policy === 'require' && !available.has(state)) errors.push(`${name} is required but host state is ${state}`);
    if (policy === 'require-observable' && !observable.has(state)) errors.push(`${name} must be observable but host state is ${state}`);
    decisions[name] = {
      policy,
      state,
      outcome: policy === 'off' ? 'disabled' : available.has(state) ? 'available' : 'durable-fallback',
    };
  }
  if (errors.length) throw new Error(`runtime capability policy is unsatisfied:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  return decisions;
}

export function compileStablePrefix(root, runtime) {
  const configErrors = validateRuntimeConfig(runtime);
  if (configErrors.length) throw new Error(`runtime config invalid:\n${configErrors.map((error) => `  - ${error}`).join('\n')}`);
  const tracked = new Set(gitPaths(root, ['ls-files', '-z']));
  const parts = [Buffer.from('CODE-OPS-STABLE-PREFIX 1\n', 'utf8')];
  const entries = [];
  for (const path of runtime.stablePrefix) {
    if (!tracked.has(path)) throw new Error(`stable prefix path is not an exact Git-index path: ${path}`);
    const absolute = checkedPath(root, path);
    if (!statSync(absolute).isFile()) throw new Error(`stable prefix path must name a file: ${path}`);
    const bytes = readFileSync(absolute);
    try { UTF8.decode(bytes); } catch { throw new Error(`stable prefix path is not valid UTF-8 text: ${path}`); }
    if (bytes.includes(0)) throw new Error(`stable prefix path contains a NUL byte: ${path}`);
    const encodedPath = JSON.stringify(path);
    parts.push(Buffer.from(`\nBEGIN ${encodedPath} ${bytes.length}\n`, 'utf8'));
    parts.push(bytes);
    if (bytes.length === 0 || bytes.at(-1) !== 0x0a) parts.push(Buffer.from('\n', 'utf8'));
    parts.push(Buffer.from(`END ${encodedPath}\n`, 'utf8'));
    entries.push({ path, sha256: sha256(bytes), bytes: bytes.length });
  }
  const payload = Buffer.concat(parts);
  if (payload.length > runtime.maxStablePrefixBytes) {
    throw new Error(`stable prefix exceeds maxStablePrefixBytes (${payload.length} > ${runtime.maxStablePrefixBytes})`);
  }
  return { payload, metadata: { sha256: sha256(payload), bytes: payload.length, entries } };
}

export function verifyRuntimeConfig(root, runtime) {
  const errors = validateRuntimeConfig(runtime);
  if (errors.length) throw new Error(`runtime config invalid:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  for (const [label, path] of [['capabilities', runtime.capabilities], ['receipts', runtime.receipts]]) {
    try { git(root, ['check-ignore', '-q', '--', path]); }
    catch { throw new Error(`runtime.${label} must use a repository-ignored path`); }
  }
  const capabilities = loadHostCapabilities(root, runtime.capabilities);
  const decisions = evaluateRuntimePolicy(runtime, capabilities.value);
  const prefix = compileStablePrefix(root, runtime);
  return { capabilities, decisions, prefix };
}

export function runtimeBinding(root, contractPath, contract) {
  if (contract.version !== 3 || !contract.runtime || !contract.context) throw new Error('runtime binding requires a version 3 run contract');
  const contractRelative = repoRelative(root, resolve(contractPath));
  const contractAbsolute = checkedPath(root, contractRelative);
  const verified = verifyRuntimeConfig(root, contract.runtime);
  const snapshotAbsolute = checkedPath(root, repoRelative(root, resolve(dirname(contractAbsolute), contract.context.snapshot)));
  const snapshotBytes = readFileSync(snapshotAbsolute);
  const snapshot = readJson(snapshotAbsolute);
  if (snapshot.snapshotId !== contract.context.snapshotId) throw new Error('context snapshot ID does not match contract');
  return {
    binding: {
      runId: contract.runId,
      contractRevision: contract.revision,
      contractSha256: sha256(readFileSync(contractAbsolute)),
      head: contract.head,
      snapshotId: contract.context.snapshotId,
      snapshotReceiptSha256: sha256(snapshotBytes),
      hostCapabilities: {
        sha256: verified.capabilities.sha256,
        host: verified.capabilities.value.host,
        provider: verified.capabilities.value.provider,
        model: verified.capabilities.value.model,
        source: verified.capabilities.value.source,
        observedAt: verified.capabilities.value.observedAt,
        states: verified.capabilities.value.capabilities,
        outcomes: Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, verified.decisions[name].outcome])),
      },
      stablePrefix: verified.prefix.metadata,
    },
    capabilities: verified.capabilities.value,
    decisions: verified.decisions,
    prefix: verified.prefix.payload,
  };
}

export function receiptSha256(receipt) {
  const body = structuredClone(receipt);
  delete body.receiptSha256;
  return digestJson(body);
}

function validateFileReference(value, label, errors) {
  if (!exact(value, FILE_REFERENCE_KEYS, label, errors)) return;
  if (!safeRelative(value.path) || !validSha(value.sha256)) errors.push(`${label} is invalid`);
}

function validateLedgerReference(value, errors) {
  if (!exact(value, LEDGER_REFERENCE_KEYS, 'runtime ledger reference', errors)) return;
  if (!safeRelative(value.path) || !validSha(value.sha256)) errors.push('runtime ledger reference is invalid');
  const bothNull = value.journalPath === null && value.journalSha256 === null;
  const bothPresent = safeRelative(value.journalPath) && validSha(value.journalSha256);
  if (!bothNull && !bothPresent) errors.push('runtime ledger journal reference is invalid');
}

function validateBundleReference(value, index, errors) {
  const label = `runtime bundle reference ${index + 1}`;
  if (!exact(value, BUNDLE_REFERENCE_KEYS, label, errors)) return;
  if (!/^D-\d{3}$/.test(value.unitId || '') || !safeRelative(value.path) || !validSha(value.bundleId) || !validSha(value.sha256)) errors.push(`${label} is invalid`);
}

function validateBinding(value, errors) {
  if (!exact(value, BINDING_KEYS, 'runtime binding', errors)) return;
  if (typeof value.runId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.runId)
    || !Number.isInteger(value.contractRevision) || value.contractRevision < 1
    || !validSha(value.contractSha256) || !GIT_OID_RE.test(value.head || '') || !validSha(value.snapshotId)
    || !validSha(value.snapshotReceiptSha256)) errors.push('runtime binding fields are invalid');
  if (exact(value.hostCapabilities, HOST_BINDING_KEYS, 'runtime hostCapabilities binding', errors)) {
    if (!validSha(value.hostCapabilities.sha256) || !cleanLabel(value.hostCapabilities.host) || !cleanLabel(value.hostCapabilities.provider)
      || !cleanLabel(value.hostCapabilities.model) || !['operator', 'host-probe', 'provider-docs'].includes(value.hostCapabilities.source)
      || !normalizedTimestamp(value.hostCapabilities.observedAt)) errors.push('runtime hostCapabilities binding identity is invalid');
    if (exact(value.hostCapabilities.states, new Set(CAPABILITY_NAMES), 'runtime host capability states', errors)) {
      for (const name of CAPABILITY_NAMES) if (!CAPABILITY_STATES.includes(value.hostCapabilities.states[name])) errors.push(`runtime host capability state ${name} is invalid`);
    }
    if (exact(value.hostCapabilities.outcomes, new Set(CAPABILITY_NAMES), 'runtime host capability outcomes', errors)) {
      for (const name of CAPABILITY_NAMES) if (!['disabled', 'available', 'durable-fallback'].includes(value.hostCapabilities.outcomes[name])) errors.push(`runtime host capability outcome ${name} is invalid`);
    }
  }
  if (!exact(value.stablePrefix, PREFIX_KEYS, 'runtime stablePrefix binding', errors)) return;
  if (!validSha(value.stablePrefix.sha256) || !Number.isInteger(value.stablePrefix.bytes) || value.stablePrefix.bytes < 1
    || !Array.isArray(value.stablePrefix.entries) || value.stablePrefix.entries.length === 0) errors.push('runtime stablePrefix binding is invalid');
  for (const [index, entry] of (value.stablePrefix.entries || []).entries()) {
    const label = `runtime stablePrefix entry ${index + 1}`;
    if (!exact(entry, PREFIX_ENTRY_KEYS, label, errors)) continue;
    if (!safeRelative(entry.path) || !validSha(entry.sha256) || !Number.isInteger(entry.bytes) || entry.bytes < 0) errors.push(`${label} is invalid`);
  }
}

function validateReferences(value, errors) {
  if (!exact(value, REFERENCE_KEYS, 'runtime references', errors)) return;
  if (value.ledger !== null) validateLedgerReference(value.ledger, errors);
  if (value.acceptance !== null) validateFileReference(value.acceptance, 'runtime acceptance reference', errors);
  if (value.handoff !== null) validateFileReference(value.handoff, 'runtime handoff reference', errors);
  if (!Array.isArray(value.bundles)) errors.push('runtime bundles must be an array');
  else value.bundles.forEach((item, index) => validateBundleReference(item, index, errors));
  if (!Array.isArray(value.artifacts)) errors.push('runtime artifacts must be an array');
  else value.artifacts.forEach((item, index) => validateFileReference(item, `runtime artifact reference ${index + 1}`, errors));
}

function validateObservation(value, errors) {
  if (!exact(value, OBSERVATION_KEYS, 'runtime observation', errors)) return;
  if (!CACHE_OBSERVABILITY.includes(value.observability) || !OBSERVATION_SOURCES.includes(value.source)) errors.push('runtime observation observability or source is invalid');
  const cacheEventsValid = Array.isArray(value.cacheEvents) && new Set(value.cacheEvents).size === value.cacheEvents.length
    && value.cacheEvents.every((event) => CACHE_EVENTS.includes(event));
  if (!cacheEventsValid) errors.push('runtime observation cacheEvents must be a unique supported array');
  for (const key of ['cacheReadInputTokens', 'cacheWriteInputTokens', 'inputTokens', 'outputTokens']) {
    if (value[key] !== null && (!Number.isInteger(value[key]) || value[key] < 0)) errors.push(`runtime observation ${key} must be null or a nonnegative integer`);
  }
  const metrics = ['cacheReadInputTokens', 'cacheWriteInputTokens', 'inputTokens', 'outputTokens'].filter((key) => value[key] !== null);
  if (['unobservable', 'unsupported'].includes(value.observability) && (metrics.length || (Array.isArray(value.cacheEvents) && value.cacheEvents.length))) errors.push(`${value.observability} cache observations cannot carry cache events or token metrics`);
  if (value.observability === 'observed' && value.source === 'provider-usage' && metrics.length === 0) errors.push('provider-usage observation requires token metrics');
}

function emptyReferences(value) {
  return value.ledger === null && value.acceptance === null && value.handoff === null
    && value.bundles.length === 0 && value.artifacts.length === 0;
}

export function replayRuntimeReceipts(text) {
  if (Buffer.byteLength(text) > MAX_RUNTIME_BYTES) throw new Error('runtime receipt chain exceeds 32 MiB');
  if (!text || !text.endsWith('\n')) throw new Error('runtime receipt chain is empty or has a torn tail');
  const lines = text.slice(0, -1).split('\n');
  if (lines.some((line) => line.length === 0)) throw new Error('runtime receipt chain contains a blank record');
  const events = [];
  let activeBinding = null;
  let latestCheckpoint = null;
  for (const [index, line] of lines.entries()) {
    let event;
    try { event = JSON.parse(line); } catch (error) { throw new Error(`runtime receipt ${index + 1} is invalid JSON: ${error.message}`); }
    const errors = [];
    if (!exact(event, RECEIPT_KEYS, `runtime receipt ${index + 1}`, errors)) throw new Error(errors.join('; '));
    if (event.version !== RUNTIME_RECEIPT_VERSION || !RECEIPT_KINDS.has(event.kind)
      || !normalizedTimestamp(event.recordedAt) || !validSha(event.receiptSha256)) errors.push(`runtime receipt ${index + 1} has invalid identity fields`);
    if (event.sequence !== index + 1) errors.push(`runtime receipt ${index + 1} sequence must be ${index + 1}`);
    const expectedPrevious = index === 0 ? null : events[index - 1].receiptSha256;
    if (event.previousReceiptSha256 !== expectedPrevious) errors.push(`runtime receipt ${index + 1} has an invalid previous receipt digest`);
    validateBinding(event.binding, errors);
    validateReferences(event.references, errors);
    if (event.observation === null) {
      if (event.kind === 'observation') errors.push(`runtime receipt ${index + 1} is missing observation data`);
    } else {
      validateObservation(event.observation, errors);
      if (event.kind !== 'observation') errors.push(`runtime receipt ${index + 1} carries observation data under ${event.kind}`);
    }
    if (receiptSha256(event) !== event.receiptSha256) errors.push(`runtime receipt ${index + 1} receipt digest is invalid`);
    if (index === 0 && (event.kind !== 'init' || !emptyReferences(event.references) || event.observation !== null)) errors.push('runtime receipt chain must start with an empty init receipt');
    if (index > 0 && event.kind === 'init') errors.push('runtime receipt chain contains a second init');
    if (['checkpoint', 'replan'].includes(event.kind) && event.references.ledger === null) errors.push(`${event.kind} receipt requires a ledger reference`);
    if (event.kind === 'observation' && !emptyReferences(event.references)) errors.push('runtime observation receipt must not duplicate checkpoint references');
    if (event.kind === 'replan') {
      if (!activeBinding || event.binding.runId !== activeBinding.runId || event.binding.contractRevision !== activeBinding.contractRevision + 1) {
        errors.push('runtime replan must preserve runId and increment contract revision by one');
      }
    } else if (activeBinding && digestJson(event.binding) !== digestJson(activeBinding)) {
      errors.push(`runtime ${event.kind} receipt has binding drift without a replan`);
    }
    if (event.kind === 'resume' && (!latestCheckpoint || digestJson(event.references) !== digestJson(latestCheckpoint.references))) {
      errors.push('runtime resume does not replay the latest checkpoint references');
    }
    if (errors.length) throw new Error(errors.join('; '));
    events.push(event);
    if (event.kind === 'init' || event.kind === 'replan') activeBinding = event.binding;
    if (['checkpoint', 'replan'].includes(event.kind)) latestCheckpoint = event;
  }
  return { events, activeBinding, latestCheckpoint };
}

export function emptyRuntimeReferences() {
  return { ledger: null, acceptance: null, handoff: null, bundles: [], artifacts: [] };
}

export function runtimeMetrics(replayed, sourceBytes) {
  const observations = replayed.events.filter((event) => event.kind === 'observation').map((event) => event.observation);
  const observability = Object.fromEntries(CACHE_OBSERVABILITY.map((state) => [state, observations.filter((item) => item.observability === state).length]));
  const events = Object.fromEntries(CACHE_EVENTS.map((event) => [event, observations.filter((item) => item.cacheEvents.includes(event)).length]));
  const sum = (key) => observations.reduce((total, item) => total + (item[key] ?? 0), 0);
  const sizes = replayed.events.map((event) => Buffer.byteLength(`${JSON.stringify(event)}\n`));
  const prefixDigests = new Set(replayed.events.filter((event) => ['init', 'replan'].includes(event.kind)).map((event) => event.binding.stablePrefix.sha256));
  return {
    version: 1,
    receipts: replayed.events.length,
    checkpoints: replayed.events.filter((event) => event.kind === 'checkpoint').length,
    resumes: replayed.events.filter((event) => event.kind === 'resume').length,
    replans: replayed.events.filter((event) => event.kind === 'replan').length,
    observations: observations.length,
    hostCapabilities: replayed.activeBinding.hostCapabilities,
    stablePrefix: { ...replayed.activeBinding.stablePrefix, versions: prefixDigests.size },
    promptCache: {
      observability,
      events,
      cacheReadInputTokens: sum('cacheReadInputTokens'),
      cacheWriteInputTokens: sum('cacheWriteInputTokens'),
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
    },
    chainBytes: Buffer.byteLength(sourceBytes),
    receiptBytes: {
      min: Math.min(...sizes),
      max: Math.max(...sizes),
      mean: Math.round(sizes.reduce((total, size) => total + size, 0) / sizes.length),
    },
    elapsed: 'UNKNOWN',
  };
}
