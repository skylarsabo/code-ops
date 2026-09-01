#!/usr/bin/env node
// Durable record-collection lifecycle for the documentation vault.
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import {
  adoptionHistoryProfiles, canonical, citationAuthority, classificationProblems, classify, cleanWorktree,
  completeHistory, digestJson, dirtyIndexPaths, extractCitations, filteredBlobOid, findBlobByDigest, FULL_ID_RE, git,
  gitPaths, historicalTarget, indexSemantic, indexSnapshot, jsonl, nativePath, pathHasHistory, physicalRoot, posix,
  maskMarkdownFenceAndTopLevelIndentBlocks, readJson, readJsonl, recordId, relativeRoot, renderIndex, resolveCitation,
  resolvePrefix, safePath, sha256, targetAt, targetsAt, trackedPaths, treePathsAt,
  validateCollection, validateLedger, verifyIndex, writeAtomically,
} from './record-lib.mjs';
import { assertNoTrackedPortableAlias } from './context-index-lib.mjs';

class HistoryUnavailableError extends Error {}
class LostMutationLeaseError extends Error {}
class DurableMutationLockLossError extends Error {}

function fail(message, code = 1) {
  console.error(`records: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = {}; const flags = new Set(['strict', 'no-stage', 'legacy', 'incremental', 'require-delta']);
  const values = new Set(['root', 'manifest', 'collection', 'record', 'state', 'at', 'out', 'review']);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument ${token}`);
    const key = token.slice(2);
    if (!flags.has(key) && !values.has(key)) throw new Error(`unknown option --${key}`);
    if (Object.hasOwn(options, key)) throw new Error(`duplicate option --${key}`);
    if (flags.has(key)) options[key] = true;
    else {
      if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new Error(`--${key} needs a value`);
      options[key] = argv[++index];
    }
  }
  return options;
}

function validateInvocation(command, options) {
  const shared = ['root', 'manifest', 'collection'];
  const commandOptions = {
    classify: shared, adopt: [...shared, 'review'],
    'plan-adoption': [...shared, 'out', 'incremental', 'require-delta'], append: [...shared, 'record', 'no-stage'],
    curate: [...shared, 'record', 'state', 'at'], render: [...shared, 'legacy'],
    check: shared, 'verify-history': [...shared, 'strict'], 'reindex-locators': shared,
  };
  const allowed = commandOptions[command];
  if (!allowed) throw new Error('commands: classify plan-adoption adopt curate append render check verify-history reindex-locators');
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) throw new Error(`--${key} is not valid for ${command}`);
  }
  if (command === 'verify-history' && options.strict !== true) throw new Error('verify-history requires --strict');
  if (options['require-delta'] && !options.incremental) throw new Error('--require-delta requires --incremental');
}

function manifestPath(root, options) {
  if (options.manifest) return nativePath(root, options.manifest);
  const matches = trackedPaths(root).filter((path) => path.endsWith('/98 System/DOCS_MANIFEST.json'));
  if (matches.length !== 1) throw new Error('expected exactly one tracked DOCS_MANIFEST.json; use --manifest');
  return nativePath(root, matches[0]);
}

function loadContext(root, options) {
  const manifestFile = manifestPath(root, options);
  const manifestRepoPath = relativeRoot(root, manifestFile);
  const manifestIndex = indexSnapshot(root, [manifestRepoPath]).get(manifestRepoPath);
  let manifest;
  try { manifest = JSON.parse(manifestIndex.bytes.toString('utf8')); }
  catch { throw new Error(`documentation manifest has invalid Git-index JSON: ${manifestRepoPath}`); }
  if (manifest.version !== 2) throw new Error('record collections require documentation manifest v2');
  if (!manifest.runs || !['ignored', 'tracked'].includes(manifest.runs.tracking)) {
    throw new Error('manifest v2 requires runs.tracking as ignored or tracked');
  }
  const collections = manifest.recordCollections || [];
  const collectionRoots = collections.map((candidate) => candidate.root.toLowerCase());
  const generatedPaths = new Set(collections.flatMap((candidate) => ['inventory', 'citations', 'curationLedger', 'index']
    .map((key) => `${manifest.hub}/${candidate[key]}`.toLowerCase())));
  for (const entry of manifest.legacyPaths || []) {
    const foldedPath = entry?.path?.toLowerCase();
    if (!entry || !safePath(entry.path) || !safePath(entry.target)
      || !entry.target.startsWith(`${manifest.hub}/`)
      || collectionRoots.some((recordRoot) => foldedPath === recordRoot || foldedPath.startsWith(`${recordRoot}/`))
      || generatedPaths.has(foldedPath)) throw new Error(`legacy path overlaps governed records or generated metadata: ${entry?.path}`);
  }
  const collection = collections.find((candidate) => candidate.id === options.collection);
  if (!options.collection || !collection) throw new Error('--collection must name a manifest record collection');
  validateCollection(collection, manifest.hub);
  const output = {};
  for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
    output[key] = nativePath(root, `${manifest.hub}/${collection[key]}`);
  }
  const history = completeHistory(root);
  const context = {
    root, manifest, manifestFile, manifestRepoPath, manifestIndex, hub: manifest.hub, collection, output,
    history, manifestVersions: null,
  };
  if (history.ok) {
    context.manifestVersions = committedManifestVersions(root);
    assertManifestHistory(context, context.manifestVersions);
  }
  return context;
}

function collect(context, { allowProblems = false } = {}) {
  const paths = trackedPaths(context.root);
  const rows = classify(context.collection, paths);
  const problems = classificationProblems(rows);
  if (!allowProblems && problems.length) {
    const detail = problems.map((row) => `${row.path} (${row.candidates.length} scope matches${row.kind === 'forbidden' ? ', forbidden' : ''})`);
    throw new Error(`invalid collection classification: ${detail.join('; ')}`);
  }
  return { paths, rows, problems };
}

function outputRepoPath(context, key) { return relativeRoot(context.root, context.output[key]); }

function gitObjectFormat(root) { return git(root, ['rev-parse', '--show-object-format']).trim(); }
function headOid(root) { return git(root, ['rev-parse', 'HEAD']).trim(); }
function stagedPaths(root) { return new Set(gitPaths(root, ['diff', '--cached', '--name-only', '-z'])); }
function literalPath(path) { return `:(literal)${path}`; }

function indexedState(root, paths) {
  return { files: indexSnapshot(root, paths), dirty: dirtyIndexPaths(root, paths) };
}
function fileMatches(state, path, expectedSha256) {
  const file = state.files.get(path);
  return Boolean(file && !state.dirty.has(path) && file.targetSha256 === expectedSha256);
}
function targetFromIndexState(root, state, path) {
  const file = state.files.get(path);
  if (!file) return null;
  return {
    objectFormat: gitObjectFormat(root), blobOid: file.blobOid, commitOid: null,
    path, targetSha256: file.targetSha256,
  };
}

function assertGeneratedUntouched(context) {
  for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
    const path = outputRepoPath(context, key);
    if (git(context.root, ['status', '--porcelain=v1', '--untracked-files=all', '--', literalPath(path)]).trim()) {
      throw new Error(`pre-existing generated-file edit: ${path}`);
    }
  }
}

function writeVerified(writes, verify, assertLease = () => {}) {
  const originals = writes.map(([path]) => [path, existsSync(path) ? readFileSync(path) : null]);
  let wrote = false;
  try {
    assertLease();
    writeAtomically(writes);
    wrote = true;
    verify();
  } catch (error) {
    if (!wrote) throw error;
    try {
      assertLease();
      const existing = originals.filter(([, bytes]) => bytes !== null);
      if (existing.length) writeAtomically(existing);
      for (const [path, bytes] of originals) if (bytes === null) rmSync(path, { force: true });
    } catch (rollbackError) {
      throw new Error(`${error.message}; generated-authority rollback failed: ${rollbackError.message}`, { cause: error });
    }
    throw error;
  }
}

function assertCanonicalPrefix(label, baseline, current) {
  if (!Array.isArray(baseline) || !Array.isArray(current) || current.length < baseline.length) {
    throw new Error(`${label} is not append-only`);
  }
  for (let index = 0; index < baseline.length; index += 1) {
    if (canonical(baseline[index]) !== canonical(current[index])) throw new Error(`${label} changed at entry ${index + 1}`);
  }
}

const AUTHORITY_BATCH_TYPES = new Set(['genesis-adoption', 'incremental-adoption', 'native-append', 'v2-migration']);
const AUTHORITY_REF_TYPES = new Set(['record', 'artifact']);

function manifestSha256(context) {
  const { manifestRepoPath: path, manifestIndex: initial } = context;
  const target = indexSnapshot(context.root, [path]).get(path);
  if (target.blobOid !== initial.blobOid) {
    throw new Error('documentation manifest Git-index state changed during operation');
  }
  if (filteredBlobOid(context.root, path) !== target.blobOid) {
    throw new Error('documentation manifest differs between the Git index and working tree');
  }
  return target.targetSha256;
}

function authorityObjectRefs(inventory) {
  return [
    ...(inventory.entries || []).map((entry) => ({
      type: 'record', path: entry.path, objectDigest: digestJson(entry),
    })),
    ...(inventory.artifacts || []).map((artifact) => ({
      type: 'artifact', path: artifact.path, objectDigest: digestJson(artifact),
    })),
  ].sort(authorityRefCompare);
}

function authorityRefKey(ref) { return `${ref.type}:${ref.path}`; }
function validAuthorityRef(ref) {
  return Boolean(ref && Object.keys(ref).sort().join(',') === 'objectDigest,path,type'
    && AUTHORITY_REF_TYPES.has(ref.type) && safePath(ref.path) && /^[0-9a-f]{64}$/.test(ref.objectDigest || ''));
}
function authorityRefCompare(left, right) {
  const leftKey = authorityRefKey(left); const rightKey = authorityRefKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}
function authorityDigest(refs) { return digestJson([...refs].sort(authorityRefCompare)); }

function batchWithoutDigest(batch) {
  const { batchDigest: _batchDigest, ...authority } = batch;
  return authority;
}

function makeAuthorityBatch(context, inventory, {
  type, objects, review = null, reviewReceiptDigest = null, baseBindings = null,
}) {
  const prior = authorityObjectRefs(inventory);
  const sequence = (inventory.authorityBatches || []).length + 1;
  const batch = {
    version: 1,
    sequence,
    type,
    previousBatchDigest: inventory.authorityBatches?.at(-1)?.batchDigest || null,
    sourceHead: headOid(context.root),
    manifestSha256: manifestSha256(context),
    priorAuthorityDigest: authorityDigest(prior),
    authorityDigest: authorityDigest([...prior, ...objects]),
    baseBindings,
    objects: [...objects].sort(authorityRefCompare),
    review,
    reviewReceiptDigest,
  };
  return { ...batch, batchDigest: digestJson(batch) };
}

function generatedBindings(context, inventory, citations, events) {
  const citationSemantics = {
    version: citations.version, collectionUuid: citations.collectionUuid,
    entries: (citations.entries || []).map(citationAuthority),
  };
  return {
    inventorySha256: digestJson(inventory),
    citationsSha256: digestJson(citationSemantics),
    curationLedgerSha256: sha256(Buffer.from(jsonl(events))),
    indexSha256: digestJson(indexSemantic(context.collection, inventory, events)),
    authorityBatchHead: inventory.authorityBatches?.at(-1)?.batchDigest || null,
  };
}

function validBindings(bindings) {
  return bindings && Object.keys(bindings).sort().join(',')
    === 'authorityBatchHead,citationsSha256,curationLedgerSha256,indexSha256,inventorySha256'
    && ['inventorySha256', 'citationsSha256', 'curationLedgerSha256', 'indexSha256']
      .every((key) => /^[0-9a-f]{64}$/.test(bindings[key] || ''))
    && (bindings.authorityBatchHead === null || /^[0-9a-f]{64}$/.test(bindings.authorityBatchHead || ''));
}

function commonGitDir(root) {
  const configured = git(root, ['rev-parse', '--git-common-dir']).trim();
  return resolve(root, configured);
}

function mutationLockPath(context) {
  return join(commonGitDir(context.root), 'code-ops-record-locks', `${context.collection.collectionUuid}.lock`);
}

function lockIdentity(path) {
  const state = statSync(path, { bigint: true });
  if (state.ino === 0n) {
    throw new Error('cannot verify collection mutation lock identity');
  }
  return { dev: state.dev.toString(), ino: state.ino.toString(), mtimeMs: Number(state.mtimeMs) };
}

function sameLockIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function readLockOwner(owner) {
  try {
    return JSON.parse(readFileSync(owner, 'utf8'));
  } catch { return null; }
}

function restoreQuarantinedLock(lock, owner, quarantine) {
  // mkdir reserves the original name without replacing a lease that appeared after rename.
  try { mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('collection mutation lock changed during stale recovery');
    throw error;
  }
  try {
    const quarantinedOwner = join(quarantine, 'owner.json');
    if (existsSync(quarantinedOwner)) {
      writeFileSync(owner, readFileSync(quarantinedOwner), { flag: 'wx' });
    }
    rmSync(quarantine, { recursive: true, force: false });
  } catch (error) {
    // Keep the reserved directory: removing it could erase a replacement that won the race.
    throw error;
  }
}

function requireMutationLease(lease, ErrorType, message) {
  let metadata = null; let identity = null;
  try {
    metadata = JSON.parse(readFileSync(lease.owner, 'utf8'));
    identity = lockIdentity(lease.lock);
  } catch { /* throw the uniform ownership error below */ }
  if (metadata?.token !== lease.token || !identity || !sameLockIdentity(lease.identity, identity)) {
    throw new ErrorType(message);
  }
}

function assertMutationLease(lease) {
  requireMutationLease(lease, Error, 'collection mutation lock ownership changed before authority write');
}

function acquireMutationLock(context) {
  const lock = mutationLockPath(context);
  const owner = join(lock, 'owner.json');
  const staleAfterMs = 10 * 60 * 1000;
  mkdirSync(dirname(lock), { recursive: true });
  for (;;) {
    try { mkdirSync(lock); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let observed;
      try { observed = lockIdentity(lock); }
      catch (statError) {
        if (statError.code === 'ENOENT') continue;
        throw statError;
      }
      const metadata = readLockOwner(owner);
      const age = Date.now() - observed.mtimeMs;
      let alive = false;
      if (Number.isInteger(metadata?.pid) && metadata.pid > 0) {
        try { process.kill(metadata.pid, 0); alive = true; } catch (processError) { if (processError.code !== 'ESRCH') alive = true; }
      }
      if (alive || age < staleAfterMs) throw new Error('collection mutation lock is held');
      const quarantine = `${lock}.stale-${randomUUID()}`;
      try { renameSync(lock, quarantine); }
      catch (renameError) {
        if (['ENOENT', 'EEXIST'].includes(renameError.code)) continue;
        throw renameError;
      }
      const quarantined = lockIdentity(quarantine);
      if (!sameLockIdentity(observed, quarantined)) {
        restoreQuarantinedLock(lock, owner, quarantine);
        throw new Error('collection mutation lock changed during stale recovery');
      }
      rmSync(quarantine, { recursive: true, force: false });
      continue;
    }
    const token = randomUUID();
    try { writeFileSync(owner, `${JSON.stringify({ pid: process.pid, token, acquiredAt: new Date().toISOString() })}\n`); }
    catch (error) { rmSync(lock, { recursive: true, force: true }); throw error; }
    return { lock, owner, token, identity: lockIdentity(lock) };
  }
}

function releaseMutationLock(lease) {
  requireMutationLease(lease, LostMutationLeaseError, 'collection mutation lock ownership changed before release');
  rmSync(lease.lock, { recursive: true, force: false });
}

function settleMutationLock(lease, mutationError = null) {
  try { releaseMutationLock(lease); }
  catch (releaseError) {
    console.warn(`records: warning: collection mutation lock was not released after the mutation attempt: ${releaseError.message}`);
    if (mutationError) throw mutationError;
    if (releaseError instanceof LostMutationLeaseError) {
      throw new DurableMutationLockLossError('durable mutation completed but collection lock ownership was lost; do not retry');
    }
  }
  if (mutationError) throw mutationError;
}

function withMutationLock(context, mutate) {
  const lease = acquireMutationLock(context);
  let result;
  try {
    manifestSha256(context);
    result = mutate(lease);
  }
  catch (error) { settleMutationLock(lease, error); }
  settleMutationLock(lease);
  return result;
}

const MANIFEST_GLOB = ':(glob)**/98 System/DOCS_MANIFEST.json';

function committedManifestAt(root, commit, candidatePaths = null) {
  if (candidatePaths) {
    const found = [];
    for (const path of candidatePaths) {
      try { found.push({ commit, path, bytes: git(root, ['show', `${commit}:${path}`], true) }); }
      catch { /* absent at this commit */ }
    }
    if (found.length > 1) throw new Error(`multiple documentation manifests exist at ${commit}: ${found.map((item) => item.path).join(', ')}`);
    return found[0] || { commit, path: null, bytes: null };
  }
  const paths = gitPaths(root, ['ls-tree', '-r', '--name-only', '-z', commit])
    .filter((path) => path.endsWith('/98 System/DOCS_MANIFEST.json'));
  if (paths.length > 1) throw new Error(`multiple documentation manifests exist at ${commit}: ${paths.join(', ')}`);
  if (!paths.length) return { commit, path: null, bytes: null };
  return { commit, path: paths[0], bytes: git(root, ['show', `${commit}:${paths[0]}`], true) };
}

function committedManifestVersions(root) {
  let commits = [];
  try { commits = git(root, ['log', '--format=%H', '--reverse', '--', MANIFEST_GLOB]).trim().split(/\s+/).filter(Boolean); }
  catch (error) { throw new Error(`cannot read manifest history: ${error.message}`); }
  return commits.map((commit) => committedManifestAt(root, commit));
}

function collectionOutputPaths(context, key, manifestVersions = context.manifestVersions ?? committedManifestVersions(context.root)) {
  const paths = new Set([outputRepoPath(context, key)]);
  for (const version of manifestVersions) {
    if (!version.bytes || !version.path) continue;
    let manifest;
    try { manifest = JSON.parse(version.bytes.toString('utf8')); } catch { continue; }
    const collection = (manifest.recordCollections || [])
      .find((item) => item.collectionUuid === context.collection.collectionUuid);
    if (!collection?.[key]) continue;
    const suffix = '/98 System/DOCS_MANIFEST.json';
    if (!version.path.endsWith(suffix)) throw new Error(`nonstandard documentation manifest path at ${version.commit}`);
    const hub = version.path.slice(0, -suffix.length);
    paths.add(posix(`${hub}/${collection[key]}`));
  }
  return [...paths];
}

function committedFileVersions(root, paths) {
  const candidates = Array.isArray(paths) ? [...new Set(paths)] : [paths];
  let commits = [];
  try { commits = git(root, ['log', '--format=%H', '--reverse', '--', ...candidates.map(literalPath)]).trim().split(/\s+/).filter(Boolean); }
  catch (error) { throw new Error(`cannot read generated-file history: ${error.message}`); }
  return commits.map((commit) => {
    const found = [];
    for (const path of candidates) {
      try { found.push({ path, bytes: git(root, ['show', `${commit}:${path}`], true) }); } catch { /* absent */ }
    }
    if (found.length > 1) throw new Error(`multiple historical ${candidates.join(' / ')} authorities exist at ${commit}`);
    return found.length ? { commit, ...found[0] } : { commit, path: null, bytes: null };
  });
}

function authoritativeJsonVersions(context, key, authority = (value) => value) {
  const versions = committedFileVersions(context.root, collectionOutputPaths(context, key));
  const parsed = [];
  let introduced = false;
  for (const version of versions) {
    if (!version.bytes) {
      if (introduced) throw new Error(`${key} was deleted after its immutable baseline was introduced at ${version.commit}`);
      continue;
    }
    introduced = true;
    let document;
    try { document = JSON.parse(version.bytes.toString('utf8')); }
    catch { throw new Error(`${key} has invalid committed JSON at ${version.commit}`); }
    parsed.push({
      commit: version.commit, version: document.version, collectionUuid: document.collectionUuid,
      adoptionReview: document.adoptionReview,
      entries: (document.entries || []).map(authority), artifacts: document.artifacts || [],
      authorityBatches: document.authorityBatches || [],
    });
  }
  return parsed;
}

function historicalOutputBytes(context, key, commit, paths = collectionOutputPaths(context, key)) {
  const found = [];
  for (const path of paths) {
    try { found.push({ path, bytes: git(context.root, ['show', `${commit}:${path}`], true) }); }
    catch { /* absent at this commit */ }
  }
  if (found.length > 1) throw new Error(`multiple historical ${key} authorities exist at ${commit}`);
  return found[0]?.bytes ?? null;
}

function generatedStateAt(context, commit, outputPaths = {}) {
  const inventoryBytes = historicalOutputBytes(context, 'inventory', commit, outputPaths.inventory);
  const citationBytes = historicalOutputBytes(context, 'citations', commit, outputPaths.citations);
  const ledgerBytes = historicalOutputBytes(context, 'curationLedger', commit, outputPaths.curationLedger);
  if (inventoryBytes === null || citationBytes === null || ledgerBytes === null) return null;
  let inventory; let citations; let events;
  try {
    inventory = JSON.parse(inventoryBytes.toString('utf8'));
    citations = JSON.parse(citationBytes.toString('utf8'));
    const ledger = ledgerBytes.toString('utf8').trim();
    events = ledger ? ledger.split(/\r?\n/).map((line) => JSON.parse(line)) : [];
  } catch { throw new Error(`generated authority has invalid JSON at ${commit}`); }
  return { inventory, citations, events, bindings: generatedBindings(context, inventory, citations, events) };
}

function inventoryVersionDocument(version, batchCount = null) {
  const document = {
    version: version.version, collectionUuid: version.collectionUuid,
    ...(version.adoptionReview === undefined ? {} : { adoptionReview: structuredClone(version.adoptionReview) }),
    entries: structuredClone(version.entries || []), artifacts: structuredClone(version.artifacts || []),
  };
  if (version.version !== 3) return document;
  const authorityBatches = structuredClone(batchCount === null
    ? (version.authorityBatches || []) : (version.authorityBatches || []).slice(0, batchCount));
  if (batchCount !== null) {
    const covered = new Set(authorityBatches.flatMap((batch) => batch.objects.map(authorityRefKey)));
    document.entries = document.entries.filter((entry) => covered.has(`record:${entry.path}`));
    document.artifacts = document.artifacts.filter((artifact) => covered.has(`artifact:${artifact.path}`));
  }
  return { ...document, authorityBatches };
}

function pathHasHistoryAt(root, commit, path) {
  return Boolean(git(root, ['log', '--full-history', '--format=%H', commit, '--', literalPath(path)]).trim());
}

function commitIsAncestor(root, ancestor, descendant) {
  try { git(root, ['merge-base', '--is-ancestor', ancestor, descendant]); return true; }
  catch { return false; }
}

function pathCommitsBetween(root, from, to, path) {
  return git(root, ['log', '--full-history', '--format=%H', `${from}..${to}`, '--', literalPath(path)])
    .trim().split(/\s+/).filter(Boolean);
}

function assertAuthorityBatchHistory(context, versions) {
  const firstV3 = versions.findIndex((version) => version.version === 3);
  if (firstV3 >= 0 && versions[firstV3].authorityBatches?.[0]?.type === 'v2-migration'
    && (firstV3 === 0 || versions[firstV3 - 1].version !== 2)) {
    throw new Error('v2 migration authority requires an observed committed v2 predecessor');
  }
  const manifestVersions = context.manifestVersions ?? committedManifestVersions(context.root);
  const manifestPaths = [...new Set(manifestVersions.map((version) => version.path).filter(Boolean))];
  const outputPaths = Object.fromEntries(['inventory', 'citations', 'curationLedger']
    .map((key) => [key, collectionOutputPaths(context, key, manifestVersions)]));
  const sourceStates = new Map();
  const stateAt = (commit) => {
    if (!sourceStates.has(commit)) sourceStates.set(commit, generatedStateAt(context, commit, outputPaths));
    return sourceStates.get(commit);
  };
  const manifestDigests = new Map();
  const manifestDigestAt = (commit) => {
    if (commit === 'current') return manifestSha256(context);
    if (!manifestDigests.has(commit)) {
      const manifest = committedManifestAt(context.root, commit, manifestPaths);
      if (!manifest.bytes) throw new Error(`authority batch introduction lacks a documentation manifest: ${commit}`);
      manifestDigests.set(commit, sha256(manifest.bytes));
    }
    return manifestDigests.get(commit);
  };
  for (let versionIndex = 0; versionIndex < versions.length; versionIndex += 1) {
    const version = versions[versionIndex];
    if (version.version !== 3) continue;
    const prior = versions[versionIndex - 1];
    const priorBatchCount = prior?.version === 3 ? (prior.authorityBatches || []).length : 0;
    for (let batchIndex = priorBatchCount; batchIndex < (version.authorityBatches || []).length; batchIndex += 1) {
      const batch = version.authorityBatches[batchIndex];
      if (batch.manifestSha256 !== manifestDigestAt(version.commit)) {
        throw new Error(`authority batch manifest does not match its introduction state: sequence ${batch.sequence}`);
      }
      const introducedAt = version.commit === 'current' ? 'HEAD' : version.commit;
      if (version.commit === 'current' && batch.sourceHead !== headOid(context.root)) {
        throw new Error(`uncommitted authority batch must bind current HEAD: sequence ${batch.sequence}`);
      }
      const sourceReachable = commitIsReachable(context.root, batch.sourceHead);
      if (sourceReachable && !commitIsAncestor(context.root, batch.sourceHead, introducedAt)) {
        throw new Error(`authority batch source does not precede its introduction: sequence ${batch.sequence}`);
      }
      if (!sourceReachable && batch.type !== 'genesis-adoption') {
        throw new Error(`authority batch source commit is not reachable from HEAD: sequence ${batch.sequence}`);
      }
      if (sourceReachable && ['genesis-adoption', 'incremental-adoption'].includes(batch.type)
        && batch.manifestSha256 !== manifestDigestAt(batch.sourceHead)) {
        throw new Error(`adoption authority batch manifest does not match its source state: sequence ${batch.sequence}`);
      }
      // A genesis receipt may survive a content-preserving history rewrite. In that
      // case its source commit is only a locator; checkInventory applies the same
      // rewrite-tolerant content-and-risk rule used by inventory v2.
      if (batch.type === 'genesis-adoption') continue;
      const source = stateAt(batch.sourceHead);
      if (!source) throw new Error(`authority batch source lacks generated predecessor state: sequence ${batch.sequence}`);
      const expectedBindings = batchIndex === priorBatchCount
        ? source.bindings
        : generatedBindings(context, inventoryVersionDocument(version, batchIndex), source.citations, source.events);
      if (canonical(batch.baseBindings) !== canonical(expectedBindings)) {
        throw new Error(`authority batch base bindings do not match its predecessor state: sequence ${batch.sequence}`);
      }
      if (batch.type !== 'native-append') continue;
      for (const ref of batch.objects) {
        if (pathHasHistoryAt(context.root, batch.sourceHead, ref.path)) {
          throw new Error(`native authority path has history before admission: ${ref.path}`);
        }
        if (version.commit === 'current') continue;
        const commits = pathCommitsBetween(context.root, batch.sourceHead, version.commit, ref.path);
        if (commits.length !== 1 || commits[0] !== version.commit) {
          throw new Error(`native authority path was not introduced with its batch: ${ref.path}`);
        }
      }
    }
  }
}

function assertManifestHistory(context, manifestVersions = context.manifestVersions ?? committedManifestVersions(context.root)) {
  const versions = manifestVersions
    .filter((version) => version.bytes)
    .map((version) => {
      try { return { commit: version.commit, manifest: JSON.parse(version.bytes.toString('utf8')) }; }
      catch { throw new Error(`documentation manifest has invalid committed JSON at ${version.commit}`); }
    });
  versions.push({ commit: 'current', manifest: context.manifest });
  const permanent = ['collectionUuid', 'identityVersion', 'root', 'inventory', 'citations', 'curationLedger', 'index'];
  for (let index = 1; index < versions.length; index += 1) {
    const priorCollections = new Map((versions[index - 1].manifest.recordCollections || []).map((item) => [item.collectionUuid, item]));
    const nextCollections = new Map((versions[index].manifest.recordCollections || []).map((item) => [item.collectionUuid, item]));
    for (const [uuid, prior] of priorCollections) {
      const next = nextCollections.get(uuid);
      if (!next) throw new Error(`permanent record collection ${uuid} was removed after ${versions[index - 1].commit}`);
      for (const field of permanent) {
        if (canonical(prior[field]) !== canonical(next[field])) throw new Error(`permanent record collection ${uuid} changed ${field}`);
      }
    }
  }
}

function assertBaseline(context, inventory, citations, ledgerText, historyComplete = true) {
  if (!historyComplete) return;
  const inventoryVersions = authoritativeJsonVersions(context, 'inventory');
  inventoryVersions.push({
    commit: 'current', version: inventory.version, collectionUuid: inventory.collectionUuid,
    adoptionReview: inventory.adoptionReview,
    entries: inventory.entries || [], artifacts: inventory.artifacts || [],
    authorityBatches: inventory.authorityBatches || [],
  });
  for (let index = 1; index < inventoryVersions.length; index += 1) {
    const priorVersion = inventoryVersions[index - 1].version;
    const currentVersion = inventoryVersions[index].version;
    const migration = priorVersion === 2 && currentVersion === 3;
    if ((!migration && priorVersion !== currentVersion)
      || inventoryVersions[index - 1].collectionUuid !== inventoryVersions[index].collectionUuid) {
      throw new Error('record inventory header changed after introduction');
    }
    if (canonical(inventoryVersions[index - 1].adoptionReview) !== canonical(inventoryVersions[index].adoptionReview)) {
      throw new Error('record adoption review changed after introduction');
    }
    assertCanonicalPrefix('record inventory', inventoryVersions[index - 1].entries, inventoryVersions[index].entries);
    assertCanonicalPrefix('artifact inventory', inventoryVersions[index - 1].artifacts, inventoryVersions[index].artifacts);
    if (priorVersion === 3) {
      assertCanonicalPrefix('authority batch chain', inventoryVersions[index - 1].authorityBatches, inventoryVersions[index].authorityBatches);
    } else if (currentVersion === 3) {
      const migrationBatch = inventoryVersions[index].authorityBatches[0];
      const inherited = authorityObjectRefs(inventoryVersions[index - 1]);
      if (migrationBatch?.type !== 'v2-migration') throw new Error('inventory v2 to v3 transition lacks a migration authority batch');
      if (canonical(migrationBatch.objects) !== canonical(inherited)) {
        throw new Error('v2 migration authority batch does not exactly cover inherited objects');
      }
    }
  }
  assertAuthorityBatchHistory(context, inventoryVersions);
  const citationVersions = authoritativeJsonVersions(context, 'citations', citationAuthority);
  citationVersions.push({
    commit: 'current', version: citations.version, collectionUuid: citations.collectionUuid,
    entries: (citations.entries || []).map(citationAuthority), artifacts: [],
  });
  for (let index = 1; index < citationVersions.length; index += 1) {
    if (citationVersions[index - 1].version !== citationVersions[index].version
      || citationVersions[index - 1].collectionUuid !== citationVersions[index].collectionUuid) {
      throw new Error('citation inventory header changed after introduction');
    }
    assertCanonicalPrefix('citation inventory', citationVersions[index - 1].entries, citationVersions[index].entries);
  }
  const ledgerVersions = committedFileVersions(context.root, collectionOutputPaths(context, 'curationLedger'));
  let prior = null; let introduced = false;
  for (const version of [...ledgerVersions, { commit: 'current', bytes: Buffer.from(ledgerText) }]) {
    if (!version.bytes) {
      if (introduced) throw new Error(`curation ledger was deleted after introduction at ${version.commit}`);
      continue;
    }
    introduced = true;
    const text = version.bytes.toString('utf8');
    if (prior !== null && !text.startsWith(prior)) throw new Error(`curation ledger rewrote committed history at ${version.commit}`);
    prior = text;
  }
}

function recordFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('native record requires YAML frontmatter');
  const schema = /^recordSchema:\s*(\d+)\s*$/m.exec(match[1]);
  const supersedes = /^supersedes:\s*(\[[^\r\n]*\])\s*$/m.exec(match[1]);
  if (!schema || Number(schema[1]) !== 1 || !supersedes) {
    throw new Error('native record requires recordSchema: 1 and a JSON-array supersedes field');
  }
  let ids;
  try { ids = JSON.parse(supersedes[1]); } catch { throw new Error('supersedes must be a JSON array'); }
  if (!Array.isArray(ids) || ids.some((id) => !FULL_ID_RE.test(id))) throw new Error('supersedes must contain full record IDs');
  if (new Set(ids).size !== ids.length) throw new Error('supersedes contains duplicate record IDs');
  return { recordSchema: 1, supersedes: ids };
}

function citationEntries(context, entry, sourceText, knownPaths, policyRows, mode) {
  const policy = new Map(policyRows.map((row) => [row.path, row]));
  const current = new Set(trackedPaths(context.root));
  if (mode === 'adopt' && !entry.baselineCommit) throw new Error(`missing adopted record baseline: ${entry.path}`);
  const baselineCommit = mode === 'adopt' ? entry.baselineCommit : null;
  const resolved = extractCitations(sourceText, entry.path).map((citation) => ({
    citation, resolution: resolveCitation(citation.rawTarget, entry.path, knownPaths),
  }));
  const targetPaths = mode === 'index' ? [...new Set(resolved
    .filter(({ resolution }) => resolution.state === 'resolved' && resolution.matches.length === 1)
    .map(({ resolution }) => resolution.matches[0]))] : [];
  const indexState = mode === 'index' && targetPaths.length ? indexedState(context.root, targetPaths) : null;
  return resolved.map(({ citation, resolution }) => {
    const base = {
      recordId: entry.id, sourceLine: citation.sourceLine, rawTarget: citation.rawTarget,
      normalizedTarget: resolution.normalizedTarget, resolvedVia: resolution.resolvedVia,
    };
    if (resolution.state === 'external') return { ...base, state: 'external' };
    if (resolution.state === 'glob') return { ...base, state: 'glob', matches: resolution.matches };
    if (resolution.state === 'ambiguous') return { ...base, state: 'ambiguous', matches: resolution.matches };
    if (resolution.state === 'dead-at-adoption') {
      if (mode === 'adopt') {
        const historical = historicalTarget(context.root, resolution.normalizedTarget, baselineCommit);
        if (historical?.ambiguous) return {
          ...base, state: 'ambiguous',
          historicalCandidates: historical.targets.map((target) => ({ targetSha256: target.targetSha256 })),
        };
        if (historical) return { ...base, state: 'redirected', target: historical };
      }
      return { ...base, state: 'dead-at-adoption' };
    }
    const targetPath = resolution.matches[0];
    const target = mode === 'index' ? targetFromIndexState(context.root, indexState, targetPath)
      : targetAt(context.root, baselineCommit, targetPath);
    if (!target) return { ...base, state: 'dead-at-adoption' };
    if (mode === 'index' && indexState.dirty.has(targetPath)) {
      throw new Error(`staged citation target differs from working tree: ${targetPath}`);
    }
    const row = policy.get(targetPath);
    const mutable = row?.policy === 'mutable';
    const citationState = mode === 'adopt' && !current.has(targetPath) ? 'redirected'
      : mutable ? 'resolved-mutable' : 'resolved-immutable';
    return { ...base, state: citationState, target };
  });
}

function immutableRows(rows) {
  return rows.filter((row) => row.kind === 'record' || ['frozen', 'superseded'].includes(row.policy));
}

function adoptionPlan(context, rows, indexed = indexSnapshot(context.root, rows.map((row) => row.path)), extension = {}) {
  const profiles = adoptionHistoryProfiles(context.root, context.collection, rows, { indexed });
  const candidates = immutableRows(rows).map((row) => {
    const profile = profiles.get(row.path);
    return {
      ...profile,
      disposition: profile.adoptionReadiness === 'review-required' ? null : 'not-required',
      rationale: '',
    };
  });
  return {
    version: extension.mode === 'incremental' ? 2 : 1,
    ...(extension.mode ? { mode: extension.mode } : {}),
    collectionUuid: context.collection.collectionUuid,
    classificationVersion: context.collection.classificationVersion || 1,
    sourceHead: headOid(context.root),
    manifestSha256: manifestSha256(context),
    ...(extension.baseBindings ? { baseBindings: extension.baseBindings } : {}),
    candidates,
  };
}

function reviewAuthority(candidate) {
  return {
    path: candidate.path, kind: candidate.kind, policy: candidate.policy,
    currentSha256: candidate.currentSha256, history: candidate.history,
    historyDigest: candidate.historyDigest, adoptionReadiness: candidate.adoptionReadiness,
    reason: candidate.reason,
  };
}

function reviewCoversCurrentHistory(reviewed, current, exact = false) {
  if (!current) return false;
  if (exact) return canonical(reviewAuthority(reviewed)) === canonical(reviewAuthority(current));
  for (const key of ['path', 'kind', 'policy', 'currentSha256']) {
    if (reviewed[key] !== current[key]) return false;
  }
  const prior = reviewed.history; const now = current.history;
  if (!prior || !now) return false;
  return now.contentTransitions <= prior.contentTransitions
    && now.priorIncarnations <= prior.priorIncarnations;
}

function expectedReviewRisk(history) {
  if (history.priorIncarnations > 0) return { adoptionReadiness: 'review-required', reason: 'deleted-readded' };
  if (history.contentTransitions > 0) return { adoptionReadiness: 'review-required', reason: 'historically-revised' };
  return { adoptionReadiness: 'ready', reason: 'stable-so-far' };
}

function candidateRiskIsConsistent(candidate) {
  const expected = expectedReviewRisk(candidate.history);
  return candidate.adoptionReadiness === expected.adoptionReadiness && candidate.reason === expected.reason;
}

function adoptionCandidatePaths(context, inventory, historyComplete) {
  const versions = historyComplete ? authoritativeJsonVersions(context, 'inventory') : [];
  const authority = versions[0] || { entries: inventory.entries || [], artifacts: historyComplete ? inventory.artifacts || [] : [] };
  return new Set([
    ...(authority.entries || []).filter((entry) => entry.provenance === 'adopted').map((entry) => entry.path),
    ...(authority.artifacts || []).map((artifact) => artifact.path),
  ]);
}

function ignoredReviewPath(context, path) {
  if (!safePath(path)) throw new Error(`adoption review path must be repository-relative and safe: ${path}`);
  assertNoTrackedPortableAlias(context.root, path, 'adoption review path');
  try { git(context.root, ['check-ignore', '-q', '--no-index', '--', path]); }
  catch { throw new Error('adoption review plans must use a repository-relative ignored path'); }
  return nativePath(context.root, path);
}

function planAdoption(context, options) {
  if (!options.out) throw new Error('plan-adoption requires --out <repo-relative-ignored-path>');
  const output = ignoredReviewPath(context, posix(options.out));
  if (!cleanWorktree(context.root)) throw new Error('adoption planning requires a clean worktree');
  const history = context.history;
  if (!history.ok) throw new HistoryUnavailableError(`adoption planning refused: ${history.reason}`);
  const { rows } = collect(context);
  let planRows = rows; let extension = {};
  if (options.incremental) {
    if (!Object.values(context.output).every(existsSync)) throw new Error('incremental admission planning requires existing generated baselines');
    const checked = runCheck(context, { allowPending: true });
    const pending = new Set(checked.pendingAdmission);
    planRows = immutableRows(rows).filter((row) => pending.has(row.path));
    if (!planRows.length) {
      if (options['require-delta']) throw new Error('incremental admission requires at least one pending immutable path');
      console.log(JSON.stringify({ mode: 'incremental', status: 'no-op', reason: 'no-pending-admission', candidates: 0 }));
      return;
    }
    const inventory = readJson(context.output.inventory);
    const citations = readJson(context.output.citations);
    const events = readJsonl(context.output.curationLedger);
    extension = { mode: 'incremental', baseBindings: generatedBindings(context, inventory, citations, events) };
  } else if (Object.values(context.output).some(existsSync)) {
    throw new Error('adoption planning refuses existing generated baselines');
  }
  const plan = adoptionPlan(context, planRows, undefined, extension);
  writeAtomically([[output, `${JSON.stringify(plan, null, 2)}\n`]]);
  console.log(JSON.stringify({
    plan: relativeRoot(context.root, output), candidates: plan.candidates.length,
    reviewRequired: plan.candidates.filter((candidate) => candidate.adoptionReadiness === 'review-required').length,
  }));
}

function adoptionReview(context, expected, reviewPath) {
  const required = expected.candidates.filter((candidate) => candidate.adoptionReadiness === 'review-required');
  if (required.length && !reviewPath) {
    throw new Error(`adoption review required for ${required.map((candidate) => candidate.path).join(', ')}; run plan-adoption --out <repo-relative-ignored-path>`);
  }
  let supplied = expected;
  if (reviewPath) {
    supplied = readJson(ignoredReviewPath(context, posix(reviewPath)));
    const bindingKeys = expected.mode === 'incremental'
      ? ['version', 'mode', 'collectionUuid', 'classificationVersion', 'sourceHead', 'manifestSha256', 'baseBindings']
      : ['version', 'collectionUuid', 'classificationVersion', 'sourceHead', 'manifestSha256'];
    for (const key of bindingKeys) {
      if (canonical(supplied?.[key]) !== canonical(expected[key])) throw new Error(`adoption review is stale: ${key} changed`);
    }
    if (!Array.isArray(supplied.candidates) || supplied.candidates.length !== expected.candidates.length) {
      throw new Error('adoption review is stale: candidate set changed');
    }
    for (let index = 0; index < expected.candidates.length; index += 1) {
      if (canonical(reviewAuthority(supplied.candidates[index])) !== canonical(reviewAuthority(expected.candidates[index]))) {
        throw new Error(`adoption review is stale: candidate changed at ${expected.candidates[index].path}`);
      }
    }
  }
  const reviewed = [];
  for (const candidate of supplied.candidates) {
    if (candidate.adoptionReadiness !== 'review-required') continue;
    if (candidate.disposition !== 'freeze-current' || typeof candidate.rationale !== 'string' || !candidate.rationale.trim()) {
      throw new Error(`adoption review requires freeze-current and rationale for ${candidate.path}`);
    }
    reviewed.push({
      path: candidate.path, currentSha256: candidate.currentSha256, historyDigest: candidate.historyDigest,
      disposition: candidate.disposition, rationale: candidate.rationale.trim(),
    });
  }
  const receipt = {
    version: expected.mode === 'incremental' ? 2 : 1,
    ...(expected.mode ? { mode: expected.mode } : {}),
    collectionUuid: expected.collectionUuid, sourceHead: expected.sourceHead,
    manifestSha256: expected.manifestSha256,
    ...(expected.baseBindings ? { baseBindings: expected.baseBindings } : {}),
    candidates: expected.candidates.map(reviewAuthority), reviewed,
  };
  return { ...receipt, receiptDigest: digestJson(receipt) };
}

function inventoryEntry(context, row, provenance, baseline = null, indexed = null) {
  const path = row.path;
  const file = (indexed || indexSnapshot(context.root, [path])).get(path);
  const bytes = file?.bytes;
  if (!bytes) throw new Error(`record bytes unavailable: ${path}`);
  const entry = {
    id: recordId(context.collection.collectionUuid, path), identityVersion: context.collection.identityVersion,
    path, provenance, sha256: file.targetSha256, kind: row.kind, policy: row.policy,
  };
  if (provenance === 'adopted') {
    if (!baseline?.introducedCommit || !baseline?.baselineCommit) throw new Error(`missing adopted record baseline: ${path}`);
    entry.introducedCommit = baseline.introducedCommit;
    entry.baselineCommit = baseline.baselineCommit;
  }
  else { entry.introducedCommit = null; entry.introducedIndexHead = headOid(context.root); }
  return entry;
}

function authorityRefsForPaths(inventory, paths) {
  const wanted = new Set(paths);
  return authorityObjectRefs(inventory).filter((ref) => wanted.has(ref.path));
}

function migrateV2Inventory(context, inventory, baseBindings) {
  if (inventory.version === 3) return structuredClone(inventory);
  if (inventory.version !== 2) throw new Error('incremental authority requires inventory v2 or v3');
  const migrated = { ...structuredClone(inventory), version: 3, authorityBatches: [] };
  const empty = { ...migrated, entries: [], artifacts: [], authorityBatches: [] };
  const objects = authorityObjectRefs(migrated);
  const receiptDigest = migrated.adoptionReview?.receiptDigest || null;
  migrated.authorityBatches.push(makeAuthorityBatch(context, empty, {
    type: 'v2-migration', objects, reviewReceiptDigest: receiptDigest, baseBindings,
  }));
  return migrated;
}

function addAuthorityBatch(context, inventory, type, before, paths, { review = null, baseBindings = null } = {}) {
  const objects = authorityRefsForPaths(inventory, paths);
  if (objects.length !== new Set(paths).size) throw new Error(`${type} authority batch does not cover its complete object set`);
  const reviewReceiptDigest = review?.receiptDigest || null;
  inventory.authorityBatches.push(makeAuthorityBatch(context, before, {
    type, objects, review, reviewReceiptDigest, baseBindings,
  }));
}

function renderCurrent(context, inventory, events) {
  return renderIndex(context.collection, context.hub, inventory, events);
}

function adopt(context, options) {
  if (!cleanWorktree(context.root)) throw new Error('adoption requires a clean worktree');
  const history = context.history;
  if (!history.ok) throw new HistoryUnavailableError(`adoption refused: ${history.reason}`);
  const supplied = options.review ? readJson(ignoredReviewPath(context, posix(options.review))) : null;
  const incremental = supplied?.mode === 'incremental';
  const generatedExist = Object.values(context.output).map(existsSync);
  if (incremental && !generatedExist.every(Boolean)) throw new Error('incremental admission requires existing generated baselines');
  if (!incremental && generatedExist.some(Boolean)) throw new Error('adoption refuses existing generated baselines');
  return withMutationLock(context, (lease) => {
    if (!cleanWorktree(context.root)) throw new Error('adoption state changed before mutation lock acquisition');
    const { rows } = collect(context);
    if (!incremental) {
      const indexed = indexSnapshot(context.root, rows.map((row) => row.path));
      const plan = adoptionPlan(context, rows, indexed);
      const review = adoptionReview(context, plan, options.review);
      const records = rows.filter((row) => row.kind === 'record');
      const profiles = new Map(plan.candidates.map((candidate) => [candidate.path, candidate]));
      const entries = records.map((row) => {
        const profile = profiles.get(row.path);
        return inventoryEntry(context, row, 'adopted', {
          introducedCommit: profile.history.admittedCommit, baselineCommit: profile.history.baselineCommit,
        }, indexed);
      });
      if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('record ID collision');
      const artifacts = rows.filter((row) => ['frozen', 'superseded'].includes(row.policy)).map((row) => ({
        path: row.path, sha256: indexed.get(row.path).targetSha256, kind: row.kind, policy: row.policy,
        provenance: 'adopted',
      }));
      const inventory = {
        version: 3, collectionUuid: context.collection.collectionUuid, adoptionReview: review,
        authorityBatches: [], entries, artifacts,
      };
      const empty = { ...inventory, entries: [], artifacts: [], authorityBatches: [] };
      inventory.authorityBatches.push(makeAuthorityBatch(context, empty, {
        type: 'genesis-adoption', objects: authorityObjectRefs(inventory),
        reviewReceiptDigest: review.receiptDigest,
      }));
      validateAuthorityBatches(inventory, { root: context.root, historyComplete: true });
      const citationInventory = { version: 1, collectionUuid: context.collection.collectionUuid, entries: [] };
      for (const entry of entries) {
        const sourceText = git(context.root, ['show', `${entry.baselineCommit}:${entry.path}`], true).toString('utf8');
        const known = treePathsAt(context.root, entry.baselineCommit);
        citationInventory.entries.push(...citationEntries(context, entry, sourceText, known, rows, 'adopt'));
      }
      const writes = [
        [context.output.inventory, `${JSON.stringify(inventory, null, 2)}\n`],
        [context.output.citations, `${JSON.stringify(citationInventory, null, 2)}\n`],
        [context.output.curationLedger, ''],
        [context.output.index, renderCurrent(context, inventory, [])],
      ];
      writeVerified(writes, () => runCheck(context), () => assertMutationLease(lease));
      console.log(JSON.stringify({ mode: 'genesis', adopted: entries.length, artifacts: artifacts.length, citations: citationInventory.entries.length }));
      return;
    }

    assertGeneratedUntouched(context);
    const checked = runCheck(context, { allowPending: true });
    const pending = new Set(checked.pendingAdmission);
    const deltaRows = immutableRows(rows).filter((row) => pending.has(row.path));
    const indexed = indexSnapshot(context.root, deltaRows.map((row) => row.path));
    const existingInventory = readJson(context.output.inventory);
    const citations = readJson(context.output.citations);
    const priorCitationCount = (citations.entries || []).length;
    const events = readJsonl(context.output.curationLedger);
    const ledgerText = jsonl(events);
    const baseBindings = generatedBindings(context, existingInventory, citations, events);
    const plan = adoptionPlan(context, deltaRows, indexed, { mode: 'incremental', baseBindings });
    const review = adoptionReview(context, plan, options.review);
    if (!deltaRows.length) throw new Error('incremental admission review is stale or already applied');
    const profiles = new Map(plan.candidates.map((candidate) => [candidate.path, candidate]));
    const beforeMigration = structuredClone(existingInventory);
    const inventory = migrateV2Inventory(context, existingInventory, baseBindings);
    const beforeAdmission = structuredClone(inventory);
    const admissionBaseBindings = generatedBindings(context, beforeAdmission, citations, events);
    const newEntries = deltaRows.filter((row) => row.kind === 'record').map((row) => {
      const profile = profiles.get(row.path);
      return inventoryEntry(context, row, 'adopted', {
        introducedCommit: profile.history.admittedCommit, baselineCommit: profile.history.baselineCommit,
      }, indexed);
    });
    const newArtifacts = deltaRows.filter((row) => ['frozen', 'superseded'].includes(row.policy)).map((row) => ({
      path: row.path, sha256: indexed.get(row.path).targetSha256, kind: row.kind, policy: row.policy,
      provenance: 'adopted',
    }));
    inventory.entries.push(...newEntries);
    inventory.artifacts.push(...newArtifacts);
    if (new Set(inventory.entries.map((entry) => entry.id)).size !== inventory.entries.length) throw new Error('record ID collision');
    addAuthorityBatch(context, inventory, 'incremental-adoption', beforeAdmission,
      [...newEntries, ...newArtifacts].map((item) => item.path), { review, baseBindings: admissionBaseBindings });
    validateAuthorityBatches(inventory, { root: context.root, historyComplete: true });
    for (const entry of newEntries) {
      const sourceText = git(context.root, ['show', `${entry.baselineCommit}:${entry.path}`], true).toString('utf8');
      const known = treePathsAt(context.root, entry.baselineCommit);
      citations.entries.push(...citationEntries(context, entry, sourceText, known, rows, 'adopt'));
    }
    assertBaseline(context, inventory, citations, ledgerText);
    const writes = [
      [context.output.inventory, `${JSON.stringify(inventory, null, 2)}\n`],
      [context.output.citations, `${JSON.stringify(citations, null, 2)}\n`],
      [context.output.index, renderCurrent(context, inventory, events)],
    ];
    writeVerified(writes, () => runCheck(context), () => assertMutationLease(lease));
    console.log(JSON.stringify({
      mode: 'incremental', migrated: beforeMigration.version === 2, adopted: newEntries.length,
      artifacts: newArtifacts.length, citations: citations.entries.length - priorCitationCount,
      authorityBatch: inventory.authorityBatches.at(-1).batchDigest,
    }));
  });
}

function validateReviewReceipt(review, collectionUuid, expectedVersion) {
  const versionOneKeys = 'candidates,collectionUuid,manifestSha256,receiptDigest,reviewed,sourceHead,version';
  const versionTwoKeys = 'baseBindings,candidates,collectionUuid,manifestSha256,mode,receiptDigest,reviewed,sourceHead,version';
  const expectedKeys = expectedVersion === 2 ? versionTwoKeys : versionOneKeys;
  if (!review || Object.keys(review).sort().join(',') !== expectedKeys
    || ![1, 2].includes(expectedVersion) || review.version !== expectedVersion || review.collectionUuid !== collectionUuid
    || (review.version === 2 && (review.mode !== 'incremental' || !validBindings(review.baseBindings)))
    || !/^[0-9a-f]{40,64}$/.test(review.sourceHead || '') || !/^[0-9a-f]{64}$/.test(review.manifestSha256 || '')
    || !/^[0-9a-f]{64}$/.test(review.receiptDigest || '') || !Array.isArray(review.candidates) || !Array.isArray(review.reviewed)) {
    throw new Error('invalid record adoption review');
  }
  const { receiptDigest, ...authority } = review;
  if (receiptDigest !== digestJson(authority)) throw new Error('record adoption review digest mismatch');
  const candidates = new Map(); const reviewed = new Map();
  for (const candidate of review.candidates) {
    const history = candidate?.history;
    if (!candidate || Object.keys(candidate).sort().join(',') !== 'adoptionReadiness,currentSha256,history,historyDigest,kind,path,policy,reason'
      || !safePath(candidate.path) || candidates.has(candidate.path)
      || !/^[0-9a-f]{64}$/.test(candidate.currentSha256 || '') || !/^[0-9a-f]{64}$/.test(candidate.historyDigest || '')
      || !['ready', 'review-required'].includes(candidate.adoptionReadiness)
      || !['stable-so-far', 'historically-revised', 'deleted-readded'].includes(candidate.reason)
      || !history || Object.keys(history).sort().join(',') !== 'admittedCommit,baselineCommit,contentTransitions,firstRelevantCommit,lastRelevantCommit,priorIncarnations'
      || !['admittedCommit', 'baselineCommit', 'firstRelevantCommit', 'lastRelevantCommit'].every((key) => /^[0-9a-f]{40,64}$/.test(history[key] || ''))
      || !Number.isInteger(history.contentTransitions) || history.contentTransitions < 0
      || !Number.isInteger(history.priorIncarnations) || history.priorIncarnations < 0
      || !candidateRiskIsConsistent(candidate)) throw new Error('invalid adoption review candidate');
    candidates.set(candidate.path, candidate);
  }
  for (const item of review.reviewed) {
    if (!item || Object.keys(item).sort().join(',') !== 'currentSha256,disposition,historyDigest,path,rationale'
      || !safePath(item.path) || reviewed.has(item.path) || !/^[0-9a-f]{64}$/.test(item.currentSha256 || '')
      || !/^[0-9a-f]{64}$/.test(item.historyDigest || '') || item.disposition !== 'freeze-current'
      || typeof item.rationale !== 'string' || !item.rationale.trim()) throw new Error('invalid reviewed adoption candidate');
    const candidate = candidates.get(item.path);
    if (!candidate || candidate.adoptionReadiness !== 'review-required'
      || candidate.currentSha256 !== item.currentSha256 || candidate.historyDigest !== item.historyDigest) {
      throw new Error(`reviewed adoption candidate does not match its history profile: ${item.path}`);
    }
    reviewed.set(item.path, item);
  }
  for (const candidate of candidates.values()) if (candidate.adoptionReadiness === 'review-required'
    && !reviewed.has(candidate.path)) throw new Error(`missing reviewed adoption candidate: ${candidate.path}`);
  return { candidates, reviewed };
}

function commitIsReachable(root, commit) {
  try { git(root, ['merge-base', '--is-ancestor', commit, 'HEAD']); return true; }
  catch { return false; }
}

function validateAuthorityBatches(inventory, { root = null, historyComplete = false } = {}) {
  if (!Array.isArray(inventory.authorityBatches) || !inventory.authorityBatches.length) {
    throw new Error('inventory v3 requires an authority batch chain');
  }
  const actual = new Map();
  const recordObjects = new Map((inventory.entries || []).map((entry) => [entry.path, entry]));
  const artifactObjects = new Map((inventory.artifacts || []).map((artifact) => [artifact.path, artifact]));
  for (const ref of authorityObjectRefs(inventory)) {
    const key = authorityRefKey(ref);
    if (actual.has(key)) throw new Error(`duplicate authority object: ${ref.path}`);
    actual.set(key, ref);
  }
  const covered = new Map(); const incrementalReviews = [];
  let previousBatchDigest = null; let runningRefs = [];
  for (let index = 0; index < inventory.authorityBatches.length; index += 1) {
    const batch = inventory.authorityBatches[index];
    const keys = 'authorityDigest,baseBindings,batchDigest,manifestSha256,objects,previousBatchDigest,priorAuthorityDigest,review,reviewReceiptDigest,sequence,sourceHead,type,version';
    if (!batch || Object.keys(batch).sort().join(',') !== keys || batch.version !== 1
      || batch.sequence !== index + 1 || !AUTHORITY_BATCH_TYPES.has(batch.type)
      || batch.previousBatchDigest !== previousBatchDigest
      || !/^[0-9a-f]{40,64}$/.test(batch.sourceHead || '') || !/^[0-9a-f]{64}$/.test(batch.manifestSha256 || '')
      || !/^[0-9a-f]{64}$/.test(batch.priorAuthorityDigest || '') || !/^[0-9a-f]{64}$/.test(batch.authorityDigest || '')
      || !Array.isArray(batch.objects) || !/^[0-9a-f]{64}$/.test(batch.batchDigest || '')
      || (batch.baseBindings !== null && !validBindings(batch.baseBindings))) throw new Error('invalid authority batch');
    if ((index === 0) !== ['genesis-adoption', 'v2-migration'].includes(batch.type)) throw new Error('invalid authority batch genesis');
    if ((batch.type === 'genesis-adoption' && batch.baseBindings !== null)
      || (batch.type !== 'genesis-adoption' && (!validBindings(batch.baseBindings)
        || batch.baseBindings.authorityBatchHead !== previousBatchDigest))) {
      throw new Error('authority batch has invalid base bindings for its type');
    }
    if (historyComplete && batch.type === 'native-append' && (!root || !commitIsReachable(root, batch.sourceHead))) {
      throw new Error('authority batch source commit is not reachable from HEAD');
    }
    if (batch.objects.some((ref) => !validAuthorityRef(ref))) throw new Error('invalid authority object reference');
    const nativeSourceTargets = historyComplete && batch.type === 'native-append'
      ? targetsAt(root, batch.sourceHead, batch.objects.map((ref) => ref.path))
      : null;
    if (batch.priorAuthorityDigest !== authorityDigest(runningRefs)) throw new Error('authority batch prior digest mismatch');
    const batchKeys = new Set();
    for (const ref of batch.objects) {
      const key = authorityRefKey(ref);
      if (batchKeys.has(key) || covered.has(key)) throw new Error(`authority object has duplicate batch coverage: ${ref.path}`);
      if (canonical(actual.get(key)) !== canonical(ref)) throw new Error(`authority object digest mismatch: ${ref.path}`);
      if (ref.type === 'record') {
        const record = recordObjects.get(ref.path);
        if (['genesis-adoption', 'incremental-adoption'].includes(batch.type) && record.provenance !== 'adopted') {
          throw new Error(`adoption authority batch contains a non-adopted record: ${ref.path}`);
        }
        if (batch.type === 'native-append' && (record.provenance !== 'native'
          || record.introducedIndexHead !== batch.sourceHead
          || (historyComplete && nativeSourceTargets.get(ref.path) !== null))) {
          throw new Error(`native authority batch contradicts record provenance: ${ref.path}`);
        }
      } else {
        const artifact = artifactObjects.get(ref.path);
        if (['genesis-adoption', 'incremental-adoption'].includes(batch.type) && artifact.provenance !== 'adopted') {
          throw new Error(`adoption authority batch contains a non-adopted artifact: ${ref.path}`);
        }
        if (batch.type === 'native-append' && (artifact.provenance !== 'native'
          || artifact.introducedIndexHead !== batch.sourceHead
          || (historyComplete && nativeSourceTargets.get(ref.path) !== null))) {
          throw new Error(`native authority batch contradicts artifact provenance: ${ref.path}`);
        }
        if (batch.type === 'v2-migration' && Object.hasOwn(artifact, 'provenance')) {
          throw new Error(`v2 migration cannot manufacture artifact provenance: ${ref.path}`);
        }
      }
      batchKeys.add(key); covered.set(key, batch); runningRefs.push(ref);
    }
    if (batch.authorityDigest !== authorityDigest(runningRefs)) throw new Error('authority batch resulting digest mismatch');
    if (batch.batchDigest !== digestJson(batchWithoutDigest(batch))) throw new Error('authority batch digest mismatch');
    if (batch.type === 'incremental-adoption') {
      if (!batch.review || batch.reviewReceiptDigest !== batch.review.receiptDigest) throw new Error('incremental authority batch lacks its review receipt');
      const parsed = validateReviewReceipt(batch.review, inventory.collectionUuid, 2);
      if (batch.review.version !== 2 || batch.review.mode !== 'incremental') throw new Error('incremental authority batch has the wrong review mode');
      const priorBatch = inventory.authorityBatches[index - 1];
      const reviewBindingsMatch = canonical(batch.baseBindings) === canonical(batch.review.baseBindings)
        || (priorBatch?.type === 'v2-migration' && priorBatch.sourceHead === batch.sourceHead
          && canonical(priorBatch.baseBindings) === canonical(batch.review.baseBindings));
      if (batch.sourceHead !== batch.review.sourceHead || batch.manifestSha256 !== batch.review.manifestSha256
        || !reviewBindingsMatch) {
        throw new Error('incremental authority batch contradicts its review receipt');
      }
      const expectedPaths = [...parsed.candidates.keys()].sort();
      const objectPaths = batch.objects.map((ref) => ref.path).sort();
      if (canonical(expectedPaths) !== canonical(objectPaths)) throw new Error('incremental authority batch review coverage mismatch');
      incrementalReviews.push({ review: batch.review, ...parsed });
    } else if (batch.review !== null) throw new Error('non-incremental authority batch embeds a review');
    if (['genesis-adoption', 'v2-migration'].includes(batch.type)) {
      if (batch.reviewReceiptDigest !== (inventory.adoptionReview?.receiptDigest || null)) throw new Error('authority genesis review binding mismatch');
      if (batch.type === 'genesis-adoption'
        && (batch.sourceHead !== inventory.adoptionReview?.sourceHead
          || batch.manifestSha256 !== inventory.adoptionReview?.manifestSha256)) {
        throw new Error('authority genesis contradicts its adoption review');
      }
    } else if (batch.type === 'native-append' && batch.reviewReceiptDigest !== null) {
      throw new Error('native authority batch cannot bind an adoption review');
    }
    previousBatchDigest = batch.batchDigest;
  }
  if (covered.size !== actual.size) {
    const missing = [...actual.keys()].find((key) => !covered.has(key));
    throw new Error(`authority object lacks batch coverage: ${missing}`);
  }
  return incrementalReviews;
}

function checkInventory(context, rows, inventory, state, historyComplete = true) {
  if (![1, 2, 3].includes(inventory.version) || inventory.collectionUuid !== context.collection.collectionUuid) throw new Error('invalid record inventory header');
  if (inventory.version === 1 && Object.hasOwn(inventory, 'adoptionReview')) throw new Error('inventory v1 cannot contain an adoption review');
  const reviewCandidates = new Map(); const reviewedCandidates = new Map(); const reviewSources = new Map();
  const originalReviewPaths = new Set();
  if ([2, 3].includes(inventory.version)) {
    const review = inventory.adoptionReview;
    const parsed = validateReviewReceipt(review, inventory.collectionUuid, 1);
    for (const [path, candidate] of parsed.candidates) {
      originalReviewPaths.add(path); reviewCandidates.set(path, candidate); reviewSources.set(path, review.sourceHead);
    }
    for (const [path, reviewed] of parsed.reviewed) reviewedCandidates.set(path, reviewed);
  }
  if (inventory.version === 3) {
    for (const parsed of validateAuthorityBatches(inventory, { root: context.root, historyComplete })) {
      for (const [path, candidate] of parsed.candidates) {
        if (reviewCandidates.has(path)) throw new Error(`adoption candidate has duplicate receipt coverage: ${path}`);
        reviewCandidates.set(path, candidate); reviewSources.set(path, parsed.review.sourceHead);
      }
      for (const [path, reviewed] of parsed.reviewed) reviewedCandidates.set(path, reviewed);
    }
  }
  const recordRows = new Map(rows.filter((row) => row.kind === 'record').map((row) => [row.path, row]));
  const ids = new Set();
  for (const entry of inventory.entries || []) {
    const row = recordRows.get(entry.path);
    if (!row) throw new Error(`immutable record deleted, renamed, or reclassified: ${entry.path}`);
    if (!FULL_ID_RE.test(entry.id) || entry.id !== recordId(context.collection.collectionUuid, entry.path)
      || entry.identityVersion !== context.collection.identityVersion) throw new Error(`record identity drift: ${entry.path}`);
    if (!['adopted', 'native'].includes(entry.provenance) || entry.kind !== row.kind || entry.policy !== row.policy) {
      throw new Error(`invalid record provenance or classification: ${entry.path}`);
    }
    if (!fileMatches(state, entry.path, entry.sha256)) throw new Error(`immutable record drift: ${entry.path}`);
    if (entry.provenance === 'adopted') {
      if (!/^[0-9a-f]{40,64}$/.test(entry.introducedCommit || '') || 'introducedIndexHead' in entry || 'supersedes' in entry) {
        throw new Error(`invalid adopted record metadata: ${entry.path}`);
      }
      if ([2, 3].includes(inventory.version) && !/^[0-9a-f]{40,64}$/.test(entry.baselineCommit || '')) {
        throw new Error(`invalid adopted record baseline: ${entry.path}`);
      }
      const candidate = reviewCandidates.get(entry.path);
      if ([2, 3].includes(inventory.version) && candidate
        && (entry.introducedCommit !== candidate.history.admittedCommit
          || entry.baselineCommit !== candidate.history.baselineCommit)) {
        throw new Error(`adopted record history does not match its review receipt: ${entry.path}`);
      }
      if (inventory.version === 1 && 'baselineCommit' in entry) throw new Error(`inventory v1 record has a baseline commit: ${entry.path}`);
    } else {
      const metadata = recordFrontmatter(state.files.get(entry.path).bytes.toString('utf8'));
      if (entry.introducedCommit !== null || !/^[0-9a-f]{40,64}$/.test(entry.introducedIndexHead || '')
        || canonical(entry.supersedes) !== canonical(metadata.supersedes)) throw new Error(`invalid native record metadata: ${entry.path}`);
    }
    ids.add(entry.id); recordRows.delete(entry.path);
  }
  const pendingAdmission = [...recordRows.keys()];
  let pendingAdmissionProblem = recordRows.size ? `record missing from inventory: ${pendingAdmission[0]}` : null;
  if (ids.size !== (inventory.entries || []).length) throw new Error('duplicate record identity');
  const immutableRows = new Map(rows.filter((row) => ['frozen', 'superseded'].includes(row.policy)).map((row) => [row.path, row]));
  for (const artifact of inventory.artifacts || []) {
    const row = immutableRows.get(artifact.path);
    if (!row || artifact.kind !== row.kind || artifact.policy !== row.policy) {
      throw new Error(`frozen artifact deleted, renamed, or reclassified: ${artifact.path}`);
    }
    if (!fileMatches(state, artifact.path, artifact.sha256)) throw new Error(`frozen artifact drift: ${artifact.path}`);
    if (inventory.version === 3 && artifact.provenance === 'adopted' && 'introducedIndexHead' in artifact) {
      throw new Error(`invalid adopted artifact metadata: ${artifact.path}`);
    }
    if (inventory.version === 3 && artifact.provenance === 'native'
      && !/^[0-9a-f]{40,64}$/.test(artifact.introducedIndexHead || '')) {
      throw new Error(`invalid native artifact metadata: ${artifact.path}`);
    }
    immutableRows.delete(artifact.path);
  }
  pendingAdmission.push(...immutableRows.keys());
  if (!pendingAdmissionProblem && immutableRows.size) {
    pendingAdmissionProblem = `frozen artifact missing from inventory: ${[...immutableRows.keys()][0]}`;
  }
  if ([2, 3].includes(inventory.version)) {
    const expectedCandidatePaths = adoptionCandidatePaths(context, inventory, historyComplete);
    for (const path of expectedCandidatePaths) if (!reviewCandidates.has(path)) {
      throw new Error(`adoption review is missing original candidate: ${path}`);
    }
    for (const path of originalReviewPaths) if (historyComplete && !expectedCandidatePaths.has(path)) {
      throw new Error(`adoption review contains a non-original candidate: ${path}`);
    }
    const inventoryAuthority = new Map([
      ...(inventory.entries || []).map((entry) => [entry.path, entry]),
      ...(inventory.artifacts || []).map((artifact) => [artifact.path, artifact]),
    ]);
    for (const candidate of reviewCandidates.values()) {
      const pinned = inventoryAuthority.get(candidate.path);
      if (!pinned || pinned.sha256 !== candidate.currentSha256
        || pinned.kind !== candidate.kind || pinned.policy !== candidate.policy) {
        throw new Error(`adoption review candidate is not pinned by inventory: ${candidate.path}`);
      }
    }
    if (historyComplete) {
      const candidateRows = rows.filter((row) => reviewCandidates.has(row.path));
      const currentProfiles = adoptionHistoryProfiles(context.root, context.collection, candidateRows);
      const pathsBySource = new Map();
      for (const candidate of reviewCandidates.values()) {
        const sourceHead = reviewSources.get(candidate.path);
        if (!pathsBySource.has(sourceHead)) pathsBySource.set(sourceHead, []);
        pathsBySource.get(sourceHead).push(candidate.path);
      }
      const sourceStates = new Map();
      for (const [sourceHead, paths] of pathsBySource) {
        const reachable = commitIsReachable(context.root, sourceHead);
        sourceStates.set(sourceHead, {
          reachable,
          targets: reachable ? targetsAt(context.root, sourceHead, paths) : null,
        });
      }
      for (const candidate of reviewCandidates.values()) {
        const current = currentProfiles.get(candidate.path);
        const sourceHead = reviewSources.get(candidate.path);
        const source = sourceStates.get(sourceHead);
        if (source.reachable && source.targets.get(candidate.path)?.targetSha256 !== candidate.currentSha256) {
          throw new Error(`adoption review source does not contain its candidate: ${candidate.path}`);
        }
        if (!reviewCoversCurrentHistory(candidate, current, source.reachable)) {
          throw new Error(`adoption review history drift: ${candidate.path}`);
        }
        if (current.adoptionReadiness === 'review-required' && !reviewedCandidates.has(candidate.path)) {
          throw new Error(`missing reviewed adoption candidate: ${candidate.path}`);
        }
      }
    }
  }
  return { ids, pendingAdmission, pendingAdmissionProblem };
}

function verifyLocator(root, target, history) {
  if (!target?.targetSha256) return { state: 'digest-mismatch' };
  if (target.blobOid) {
    try {
      const bytes = git(root, ['cat-file', '-p', target.blobOid], true);
      if (sha256(bytes) === target.targetSha256) return { state: 'resolved', target };
    } catch { /* content digest lookup decides the semantic result */ }
  }
  if (!history.ok) return { state: 'history-unavailable' };
  const recovered = findBlobByDigest(root, target.targetSha256);
  return recovered ? { state: 'resolved', target: recovered } : { state: 'evidence-lost' };
}

function scanRecordPrefixes(context, allIds) {
  const markdown = trackedPaths(context.root).filter((path) => path.startsWith(`${context.hub}/`) && path.endsWith('.md'));
  const seen = new Set();
  for (const path of markdown) {
    const text = readFileSync(nativePath(context.root, path), 'utf8');
    const { maskedText } = maskMarkdownFenceAndTopLevelIndentBlocks(text, path);
    for (const match of maskedText.matchAll(/REC-[A-Z2-7]{8,26}(?![A-Z2-7])/g)) seen.add(match[0]);
  }
  for (const value of seen) {
    if (FULL_ID_RE.test(value) && allIds.includes(value)) continue;
    resolvePrefix(value, allIds);
  }
}

function allCollectionIds(context) {
  const ids = [];
  for (const collection of context.manifest.recordCollections || []) {
    const path = nativePath(context.root, `${context.hub}/${collection.inventory}`);
    if (existsSync(path)) ids.push(...(readJson(path).entries || []).map((entry) => entry.id));
  }
  return ids;
}

function legacyContent(context, entry) {
  const from = dirname(nativePath(context.root, entry.path));
  const to = nativePath(context.root, entry.target);
  const target = encodeURI(posix(relative(from, to)));
  const type = entry.disposition === 'pointer' ? 'legacy-pointer' : 'tombstone';
  const label = entry.disposition === 'pointer' ? 'Canonical documentation' : 'Evidence disposition';
  return `<!-- generated by records.mjs ${type} v1 -->\n[${label}](<${target}>)\n`;
}

function legacyEligible(context, entry, citations, ids) {
  for (const requirement of entry.requiredBy || []) {
    if (requirement.kind === 'record') {
      let id;
      try { id = FULL_ID_RE.test(requirement.ref) ? requirement.ref : resolvePrefix(requirement.ref, ids); } catch { continue; }
      if (citations.some((citation) => citation.recordId === id
        && (citation.normalizedTarget === entry.path || citation.target?.path === entry.path))) return true;
    } else if (requirement.kind === 'commit') {
      try {
        if (!git(context.root, ['for-each-ref', '--format=%(refname)', '--contains', requirement.ref]).trim()) continue;
        if (git(context.root, ['show', '-s', '--format=%B', requirement.ref]).includes(entry.path)) return true;
      } catch { /* not reachable */ }
    } else if (requirement.kind === 'external') {
      try {
        if (trackedPaths(context.root).includes(requirement.ref)
          && readFileSync(nativePath(context.root, requirement.ref), 'utf8').includes(entry.path)) return true;
      } catch { /* unsafe or unreadable evidence does not qualify */ }
    }
  }
  return false;
}

function legacyMatches(context, entry) {
  const path = nativePath(context.root, entry.path); const expected = legacyContent(context, entry);
  if (!existsSync(path)) return false;
  return filteredBlobOid(context.root, entry.path) === filteredBlobOid(context.root, entry.path, Buffer.from(expected));
}

function checkLegacy(context, citations, ids) {
  for (const entry of context.manifest.legacyPaths || []) {
    if (!legacyEligible(context, entry, citations, ids)) throw new Error(`ineligible legacy path: ${entry.path}`);
    if (!legacyMatches(context, entry)) throw new Error(`legacy path drift: ${entry.path}`);
  }
}

function runCheck(context, {
  strict = false, allowPending = false, skipIndex = false, skipLegacyDrift = false,
} = {}) {
  manifestSha256(context);
  const { rows } = collect(context);
  for (const path of Object.values(context.output)) if (!existsSync(path)) throw new Error(`missing generated record file: ${relativeRoot(context.root, path)}`);
  const inventory = readJson(context.output.inventory);
  const citations = readJson(context.output.citations);
  const events = readJsonl(context.output.curationLedger);
  const ledgerText = jsonl(events);
  const current = new Set(trackedPaths(context.root));
  const statePaths = new Set([
    ...rows.map((row) => row.path),
    ...(citations.entries || []).map((citation) => citation.target?.path).filter((path) => path && current.has(path)),
    ...(context.manifest.legacyPaths || []).map((entry) => entry.path).filter((path) => current.has(path)),
  ]);
  const state = indexedState(context.root, [...statePaths]);
  const history = context.history;
  const checkedInventory = checkInventory(context, rows, inventory, state, history.ok);
  const { ids } = checkedInventory;
  if (citations.version !== 1 || citations.collectionUuid !== context.collection.collectionUuid) throw new Error('invalid citation inventory header');
  validateLedger(events, context.collection.collectionUuid);
  for (const event of events) {
    if (!FULL_ID_RE.test(event.recordId) || !ids.has(event.recordId)) throw new Error(`curation event references unknown record ${event.recordId}`);
  }
  if (strict && !history.ok) throw new HistoryUnavailableError(`infrastructure history unavailable: ${history.reason}`);
  assertBaseline(context, inventory, citations, ledgerText, history.ok);
  const warnings = [];
  if (!history.ok) warnings.push(`history-unavailable: ${history.reason}`);
  const recordById = new Map((inventory.entries || []).map((entry) => [entry.id, entry]));
  const allIds = allCollectionIds(context);
  const allowedStates = new Set(['resolved-immutable', 'resolved-mutable', 'dead-at-adoption', 'ambiguous', 'external', 'glob', 'redirected', 'tombstoned']);
  for (const citation of citations.entries || []) {
    if (!ids.has(citation.recordId)) throw new Error(`citation references unknown record ${citation.recordId}`);
    if (!allowedStates.has(citation.state) || !Array.isArray(citation.resolvedVia)
      || typeof citation.rawTarget !== 'string' || typeof citation.normalizedTarget !== 'string') {
      throw new Error(`invalid citation entry for ${citation.recordId}`);
    }
    if (recordById.get(citation.recordId)?.provenance === 'native'
      && ['dead-at-adoption', 'ambiguous', 'glob'].includes(citation.state)) {
      throw new Error(`native record contains unresolved citation: ${citation.rawTarget}`);
    }
    if (citation.target && !/^[0-9a-f]{64}$/.test(citation.target.targetSha256 || '')) {
      throw new Error(`digest-mismatch: ${citation.normalizedTarget}`);
    }
    const legacyEntry = (context.manifest.legacyPaths || []).find((entry) => entry.path === citation.target?.path);
    const exactLegacyReplacement = legacyEntry && current.has(legacyEntry.path)
      && legacyMatches(context, legacyEntry)
      && legacyEligible(context, legacyEntry, citations.entries || [], allIds);
    if (['resolved-immutable', 'resolved-mutable'].includes(citation.state) && !current.has(citation.target?.path)) {
      throw new Error(`resolved-to-dead citation regression: ${citation.normalizedTarget}`);
    }
    if (citation.state === 'resolved-mutable' && current.has(citation.target?.path) && !exactLegacyReplacement) {
      if (!fileMatches(state, citation.target.path, citation.target.targetSha256)) {
        warnings.push(`mutable-drifted: ${citation.target.path}`);
      }
    }
    if (citation.state === 'resolved-immutable' && current.has(citation.target?.path) && !exactLegacyReplacement
      && !fileMatches(state, citation.target.path, citation.target.targetSha256)) {
      throw new Error(`digest-mismatch: ${citation.target.path}`);
    }
    if (citation.target) {
      const locator = verifyLocator(context.root, citation.target, history);
      if (locator.state === 'evidence-lost') throw new Error(`evidence-lost: ${citation.target.targetSha256}`);
      if (locator.state === 'digest-mismatch') throw new Error(`digest-mismatch: ${citation.normalizedTarget}`);
      if (locator.state === 'history-unavailable') warnings.push(`history-unavailable: ${citation.normalizedTarget}`);
    }
  }
  if (!skipIndex) verifyIndex(readFileSync(context.output.index, 'utf8'), context.collection, inventory, events);
  scanRecordPrefixes(context, allIds);
  if (skipLegacyDrift) {
    for (const entry of context.manifest.legacyPaths || []) {
      if (!legacyEligible(context, entry, citations.entries || [], allIds)) throw new Error(`ineligible legacy path: ${entry.path}`);
    }
  } else checkLegacy(context, citations.entries || [], allIds);
  if (!allowPending && checkedInventory.pendingAdmissionProblem) {
    throw new Error(`pending-admission: ${checkedInventory.pendingAdmissionProblem}`);
  }
  manifestSha256(context);
  for (const warning of [...new Set(warnings)]) console.warn(`records: warning: ${warning}`);
  const stateCounts = {};
  for (const citation of citations.entries || []) stateCounts[citation.state] = (stateCounts[citation.state] || 0) + 1;
  return {
    records: ids.size, citations: (citations.entries || []).length, states: stateCounts,
    history: history.ok ? 'complete' : 'history-unavailable', warnings: [...new Set(warnings)].length,
    pendingAdmission: checkedInventory.pendingAdmission,
  };
}

function appendRecord(context, options) {
  if (!options.record) throw new Error('append requires --record');
  const recordPath = posix(options.record);
  if (!trackedPaths(context.root).includes(recordPath) || !stagedPaths(context.root).has(recordPath)) {
    throw new Error('record must be tracked in the Git index and staged');
  }
  assertGeneratedUntouched(context);
  const history = context.history;
  if (!history.ok) throw new HistoryUnavailableError(`append refused: ${history.reason}`);
  withMutationLock(context, (lease) => {
    assertGeneratedUntouched(context);
    runCheck(context, { allowPending: true });
    const { paths, rows } = collect(context);
    const row = rows.find((candidate) => candidate.path === recordPath);
    if (!row || row.kind !== 'record' || row.policy !== 'append-only') throw new Error('record is not classified as append-only');
    if (pathHasHistory(context.root, recordPath)) {
      throw new Error(`native append requires a new path with no reachable history: ${recordPath}; use reviewed adoption`);
    }
    const currentInventory = readJson(context.output.inventory);
    const citations = readJson(context.output.citations);
    const events = readJsonl(context.output.curationLedger);
    const ledgerText = jsonl(events);
    validateLedger(events, context.collection.collectionUuid);
    if ((currentInventory.entries || []).some((entry) => entry.path === recordPath)) throw new Error('record is already inventoried');
    const inventoriedArtifacts = new Set((currentInventory.artifacts || []).map((artifact) => artifact.path));
    const newArtifacts = rows.filter((candidate) => ['frozen', 'superseded'].includes(candidate.policy)
      && !inventoriedArtifacts.has(candidate.path));
    const stagedSet = stagedPaths(context.root);
    for (const artifact of newArtifacts) {
      if (!stagedSet.has(artifact.path)) throw new Error(`new immutable artifact must be staged with append: ${artifact.path}`);
      if (pathHasHistory(context.root, artifact.path)) {
        throw new Error(`native append requires a new immutable artifact path with no reachable history: ${artifact.path}; use reviewed adoption`);
      }
    }
    const immutablePaths = [recordPath, ...newArtifacts.map((artifact) => artifact.path)];
    const state = indexedState(context.root, immutablePaths);
    if (state.dirty.has(recordPath)) throw new Error('staged record differs from working tree');
    for (const artifact of newArtifacts) if (state.dirty.has(artifact.path)) {
      throw new Error(`staged artifact differs from working tree: ${artifact.path}`);
    }
    const staged = state.files.get(recordPath).bytes;
    const metadata = recordFrontmatter(staged.toString('utf8'));
    const knownIds = new Set((currentInventory.entries || []).map((entry) => entry.id));
    for (const id of metadata.supersedes) if (!knownIds.has(id)) throw new Error(`supersedes references unknown record ${id}`);
    const baseBindings = generatedBindings(context, currentInventory, citations, events);
    const inventory = currentInventory.version === 2
      ? migrateV2Inventory(context, currentInventory, baseBindings)
      : structuredClone(currentInventory);
    const beforeAdmission = structuredClone(inventory);
    const admissionBaseBindings = generatedBindings(context, beforeAdmission, citations, events);
    const entry = inventoryEntry(context, row, 'native', null, state.files);
    entry.supersedes = metadata.supersedes;
    const additions = citationEntries(context, entry, staged.toString('utf8'), paths, rows, 'index');
    for (const citation of additions) {
      if (['dead-at-adoption', 'ambiguous', 'glob'].includes(citation.state)
        || citation.resolvedVia.includes('glob-expanded')) throw new Error(`native record has unresolved citation: ${citation.rawTarget}`);
      if (citation.state === 'resolved-mutable' && !citation.target?.targetSha256) throw new Error(`native mutable citation lacks a target digest: ${citation.rawTarget}`);
    }
    for (const artifact of newArtifacts) {
      inventory.artifacts.push({
        path: artifact.path, sha256: state.files.get(artifact.path).targetSha256,
        kind: artifact.kind, policy: artifact.policy, provenance: 'native',
        introducedIndexHead: headOid(context.root),
      });
    }
    inventory.entries.push(entry);
    if (inventory.version === 3) {
      addAuthorityBatch(context, inventory, 'native-append', beforeAdmission, immutablePaths,
        { baseBindings: admissionBaseBindings });
      validateAuthorityBatches(inventory, { root: context.root, historyComplete: true });
    }
    citations.entries.push(...additions);
    assertBaseline(context, inventory, citations, ledgerText);
    const writes = [
      [context.output.inventory, `${JSON.stringify(inventory, null, 2)}\n`],
      [context.output.citations, `${JSON.stringify(citations, null, 2)}\n`],
      [context.output.index, renderCurrent(context, inventory, events)],
    ];
    const generated = writes.map(([path]) => relativeRoot(context.root, path));
    const originals = writes.map(([path]) => [path, readFileSync(path)]);
    let stagedGenerated = false;
    let wrote = false;
    try {
      assertMutationLease(lease);
      writeAtomically(writes);
      wrote = true;
      if (!options['no-stage']) {
        git(context.root, ['add', '--', ...generated]); stagedGenerated = true;
        git(context.root, ['diff', '--cached', '--check']);
      }
      runCheck(context);
    } catch (error) {
      if (stagedGenerated) git(context.root, ['reset', '--quiet', 'HEAD', '--', ...generated]);
      if (wrote) assertMutationLease(lease);
      if (wrote) writeAtomically(originals);
      throw error;
    }
    console.log(JSON.stringify({
      staged: options['no-stage'] ? [] : [recordPath, ...generated], written: generated,
      migrated: currentInventory.version === 2,
      ...(inventory.version === 3 ? { authorityBatch: inventory.authorityBatches.at(-1).batchDigest } : {}),
    }));
  });
}

function curate(context, options) {
  if (!options.record || !options.state) throw new Error('curate requires --record and complete JSON --state');
  const history = context.history;
  if (!history.ok) throw new HistoryUnavailableError(`curation refused: ${history.reason}`);
  let state;
  try { state = JSON.parse(options.state); } catch { throw new Error('--state must be valid JSON'); }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('--state must be a complete JSON object');
  withMutationLock(context, (lease) => {
    runCheck(context, { allowPending: true });
    const inventory = readJson(context.output.inventory);
    const ids = (inventory.entries || []).map((entry) => entry.id);
    const record = FULL_ID_RE.test(options.record) ? options.record : resolvePrefix(options.record, ids);
    if (!ids.includes(record)) throw new Error(`unknown record ${record}`);
    const events = readJsonl(context.output.curationLedger);
    const ledgerText = jsonl(events);
    const previousEventDigest = validateLedger(events, context.collection.collectionUuid);
    const previousRecordEventDigest = [...events].reverse().find((event) => event.recordId === record)?.eventDigest || null;
    const event = {
      collectionUuid: context.collection.collectionUuid, sequence: events.length + 1,
      previousEventDigest, recordId: record, previousRecordEventDigest,
      state, curatedAt: options.at || new Date().toISOString(),
    };
    event.eventDigest = digestJson(event);
    const nextText = ledgerText + jsonl([event]);
    const citations = readJson(context.output.citations);
    assertBaseline(context, inventory, citations, nextText);
    const writes = [
      [context.output.curationLedger, nextText],
      [context.output.index, renderCurrent(context, inventory, [...events, event])],
    ];
    writeVerified(writes, () => runCheck(context, { allowPending: true }), () => assertMutationLease(lease));
    console.log(JSON.stringify({ sequence: event.sequence, eventDigest: event.eventDigest }));
  });
}

function render(context, options) {
  withMutationLock(context, (lease) => {
    runCheck(context, { allowPending: true, skipIndex: true, skipLegacyDrift: options.legacy === true });
    const inventory = readJson(context.output.inventory);
    const events = readJsonl(context.output.curationLedger);
    const writes = [[context.output.index, renderCurrent(context, inventory, events)]];
    let citations = null; let ids = null;
    if (options.legacy) {
      citations = readJson(context.output.citations).entries || [];
      ids = allCollectionIds(context);
      for (const entry of context.manifest.legacyPaths || []) {
        if (!legacyEligible(context, entry, citations, ids)) throw new Error(`ineligible legacy path: ${entry.path}`);
        writes.push([nativePath(context.root, entry.path), legacyContent(context, entry)]);
      }
    }
    writeVerified(writes, () => {
      verifyIndex(readFileSync(context.output.index, 'utf8'), context.collection, inventory, events);
      if (options.legacy) checkLegacy(context, citations, ids);
      runCheck(context, { allowPending: true });
    }, () => assertMutationLease(lease));
    console.log(JSON.stringify({ written: writes.map(([path]) => relativeRoot(context.root, path)) }));
  });
}

function reindexLocators(context) {
  const history = context.history;
  if (!history.ok) throw new HistoryUnavailableError(`infrastructure history unavailable: ${history.reason}`);
  withMutationLock(context, (lease) => {
    runCheck(context, { allowPending: true });
    const citations = readJson(context.output.citations);
    let changed = 0;
    for (const citation of citations.entries || []) {
      if (!citation.target?.targetSha256) continue;
      const recovered = findBlobByDigest(context.root, citation.target.targetSha256);
      if (!recovered) throw new Error(`evidence-lost: ${citation.target.targetSha256}`);
      if (recovered.targetSha256 !== citation.target.targetSha256) {
        throw new Error(`digest-mismatch while reindexing ${citation.target.path}`);
      }
      const before = canonical(citation.target);
      // Path, introduction commit, and content digest are evidence identity. Object
      // format and blob OID are regenerable locator cache fields only.
      citation.target = {
        ...citation.target,
        objectFormat: recovered.objectFormat,
        blobOid: recovered.blobOid,
      };
      if (canonical(citation.target) !== before) changed += 1;
    }
    writeVerified([[context.output.citations, `${JSON.stringify(citations, null, 2)}\n`]],
      () => runCheck(context, { allowPending: true }), () => assertMutationLease(lease));
    console.log(JSON.stringify({ locatorsUpdated: changed, objectFormat: gitObjectFormat(context.root) }));
  });
}

function classifyCommand(context) {
  const { rows, problems } = collect(context, { allowProblems: true });
  const history = context.history;
  let rendered = rows;
  let readiness = problems.length
    ? { status: 'classification-invalid' }
    : { status: 'history-unavailable', reason: history.reason };
  if (history.ok && !problems.length) {
    const indexed = indexSnapshot(context.root, rows.map((row) => row.path));
    const profiles = adoptionHistoryProfiles(context.root, context.collection, rows, { allowUncommitted: true, indexed });
    rendered = rows.map((row) => {
      const profile = profiles.get(row.path);
      return profile ? {
        ...row, adoptionReadiness: profile.adoptionReadiness,
        ...(profile.historyDigest ? { historyDigest: profile.historyDigest, history: profile.history } : {}),
        historyReason: profile.reason,
      } : row;
    });
    const reviewRequired = [...profiles.values()].filter((profile) => profile.adoptionReadiness === 'review-required').length;
    const pendingCommit = [...profiles.values()].filter((profile) => profile.adoptionReadiness === 'pending-commit').length;
    readiness = { status: reviewRequired ? 'review-required' : pendingCommit ? 'pending-commit' : 'ready', reviewRequired, pendingCommit };
  }
  console.log(JSON.stringify({
    classificationStatus: problems.length ? 'invalid' : 'partition-valid', adoptionReadiness: readiness, rows: rendered,
  }, null, 2));
  if (problems.length) throw new Error(`invalid collection classification: ${problems.map((row) => row.path).join(', ')}`);
}

const [command, ...argv] = process.argv.slice(2);
try {
  const options = parseArgs(argv);
  validateInvocation(command, options);
  const root = physicalRoot(options.root || process.cwd());
  const context = loadContext(root, options);
  if (command === 'classify') classifyCommand(context);
  else if (command === 'plan-adoption') planAdoption(context, options);
  else if (command === 'adopt') adopt(context, options);
  else if (command === 'append') appendRecord(context, options);
  else if (command === 'curate') curate(context, options);
  else if (command === 'render') render(context, options);
  else if (command === 'check') console.log(JSON.stringify(runCheck(context)));
  else if (command === 'verify-history') console.log(JSON.stringify(runCheck(context, { strict: options.strict === true })));
  else if (command === 'reindex-locators') reindexLocators(context);
} catch (error) {
  fail(error.message, error instanceof HistoryUnavailableError ? 2 : error instanceof DurableMutationLockLossError ? 3 : 1);
}
