#!/usr/bin/env node
// Compiles one bounded, deterministic context bundle from a verified repository snapshot.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atomicWrite,
  assertSnapshotSelfConsistency,
  cacheEntryPath,
  digestJson,
  parseAtlasReport,
  parseImportGraph,
  parseRepoMap,
  readJson,
  repoRelative,
  safeRelative,
  scopeMatches,
  scopesIntersect,
  sha256,
  snapshotDelta,
  validateCacheEntry,
  verifySnapshotReceipt,
} from './context-index-lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const COMPILER_SHA256 = sha256(readFileSync(fileURLToPath(import.meta.url)));

function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
function usage() {
  die('usage: context-bundle.mjs build --root <repo> --contract <file> --unit <D-NNN> --cache <dir> --out <file> [--previous <receipt> --delta <file>]\n'
    + '       context-bundle.mjs verify --root <repo> --contract <file> --unit <D-NNN> --bundle <file>', 2);
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
function loadBinding(root, contractPath, unitId) {
  const contract = readJson(contractPath);
  if (contract.version !== 2 || !contract.context) throw new Error('context bundles require a version 2 run contract');
  const unit = contract.units?.find((candidate) => candidate.id === unitId);
  if (!unit) throw new Error(`unknown contract unit ${unitId}`);
  const receiptPath = resolve(dirname(contractPath), contract.context.snapshot);
  const receipt = readJson(receiptPath);
  if (receipt.snapshotId !== contract.context.snapshotId) throw new Error('context snapshot ID does not match contract');
  if (receipt.state?.untracked?.policy !== contract.context.untrackedPolicy) throw new Error('context untrackedPolicy does not match receipt');
  verifySnapshotReceipt(root, receipt, SCRIPT_DIR);
  return { contract, unit, receipt, receiptPath };
}
function markerPath(out, name) { return `${out}.${name}`; }
function broadScope(scope, totalFiles, scopedFiles) {
  const risky = /^(?:\.github|migrations?|schema|security|privacy)(?:\/|$)/i;
  return scope.includes('**') || scope.some((entry) => risky.test(entry.replace(/\/\*\*$/, '')))
    || (totalFiles > 0 && scopedFiles / totalFiles > 0.25);
}
function atlasSections(root, meta, scope, maxBytes) {
  if (meta.atlas?.status !== 'available' || !meta.atlas.path) return [];
  const atlasRoot = resolve(root, meta.atlas.path);
  const manifest = readJson(resolve(atlasRoot, 'MANIFEST.json'));
  const report = parseAtlasReport(readFileSync(resolve(meta.entry, meta.payloads.atlasState.file), 'utf8'));
  let used = 0;
  return (manifest.sections || []).filter((section) => scopesIntersect(scope, section.scope || [])).map((section) => {
    const state = report.get(section.slug) || { verdict: 'STALE', detail: 'missing from atlas report' };
    const base = { slug: section.slug, file: `${meta.atlas.path}/${section.file}`, scope: section.scope, verdict: state.verdict, detail: state.detail };
    if (state.verdict !== 'FRESH') return base;
    const text = readFileSync(resolve(atlasRoot, section.file), 'utf8');
    const remaining = maxBytes - used;
    if (Buffer.byteLength(text) > remaining) return { ...base, excerpt: null, omitted: 'atlas excerpt budget exhausted' };
    used += Buffer.byteLength(text);
    return { ...base, excerpt: text };
  });
}
function normalizeBundle(bundle) {
  const clone = structuredClone(bundle);
  delete clone.bundleId;
  delete clone.actualBytes;
  return clone;
}
function writeFailure(out, name, payload) {
  atomicWrite(markerPath(out, name), `${JSON.stringify(payload, null, 2)}\n`);
}
function pathRecord(value) {
  return value && typeof value === 'object' && typeof value.path === 'string' && safeRelative(value.path)
    && typeof value.status === 'string';
}
function validateDelta(value, previous, receipt, scope) {
  const top = new Set(['version', 'fromSnapshotId', 'toSnapshotId', 'changed', 'atlas', 'generatorChanged', 'requiresFullIndex']);
  assertSnapshotSelfConsistency(previous); assertSnapshotSelfConsistency(receipt);
  const expected = snapshotDelta(previous, receipt);
  if (digestJson(value) !== digestJson(expected)) throw new Error('delta does not match the bound snapshot receipts');
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !top.has(key))
    || value.version !== 1 || !/^[0-9a-f]{64}$/.test(value.fromSnapshotId || '') || value.toSnapshotId !== receipt.snapshotId
    || !value.changed || typeof value.changed !== 'object' || Array.isArray(value.changed)
    || !Array.isArray(value.changed.staged) || !Array.isArray(value.changed.unstaged) || !Array.isArray(value.changed.untracked)
    || !value.changed.staged.every(pathRecord) || !value.changed.unstaged.every(pathRecord)
    || !value.changed.untracked.every((item) => item && typeof item === 'object' && safeRelative(item.path) && ['added', 'removed', 'modified'].includes(item.kind))
    || !value.atlas || typeof value.atlas !== 'object' || !Array.isArray(value.atlas.freshToStale) || typeof value.atlas.newlyMalformed !== 'boolean'
    || typeof value.generatorChanged !== 'boolean' || value.requiresFullIndex !== true) throw new Error('delta schema or binding is invalid');
  return {
    fromSnapshotId: value.fromSnapshotId,
    relevant: [
      ...value.changed.staged.filter((item) => scopeMatches(scope, item.path)).map((item) => ({ source: 'staged', status: item.status, path: item.path })),
      ...value.changed.unstaged.filter((item) => scopeMatches(scope, item.path)).map((item) => ({ source: 'unstaged', status: item.status, path: item.path })),
      ...value.changed.untracked.filter((item) => scopeMatches(scope, item.path)).map((item) => ({ source: 'untracked', kind: item.kind, path: item.path })),
    ],
  };
}

const command = process.argv[2];
if (command === 'build') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--contract', '--unit', '--cache', '--out', '--previous', '--delta']));
  if (!f['--root'] || !f['--contract'] || !f['--unit'] || !f['--cache'] || !f['--out']) usage();
  if (Boolean(f['--previous']) !== Boolean(f['--delta'])) die('--previous and --delta must be supplied together', 2);
  try {
    const root = resolve(f['--root']);
    const contractPath = resolve(f['--contract']);
    const out = resolve(f['--out']);
    const { contract, unit, receipt } = loadBinding(root, contractPath, f['--unit']);
    rmSync(markerPath(out, 'BROAD_CONTEXT_REQUIRED'), { force: true });
    rmSync(markerPath(out, 'BUDGET_EXCEEDED'), { force: true });
    rmSync(markerPath(out, 'EMPTY_SCOPE'), { force: true });
    const outputRelative = repoRelative(dirname(contractPath), out);
    if (!scopeMatches([contract.context.bundleDir], outputRelative)) throw new Error('bundle output must be inside contract context.bundleDir');
    const entry = cacheEntryPath(resolve(f['--cache']), receipt.snapshotId);
    const generator = receipt.generator.digests;
    const meta = validateCacheEntry(entry, receipt.snapshotId, generator);
    if (!meta) throw new Error('context cache is absent or corrupt; prepare the snapshot again');
    meta.entry = entry;
    const repoMap = parseRepoMap(readFileSync(resolve(entry, meta.payloads.repoMap.file), 'utf8'));
    const graph = parseImportGraph(readFileSync(resolve(entry, meta.payloads.importGraph.file), 'utf8'), repoMap.files.map((file) => file.path));
    const scoped = repoMap.files.filter((file) => scopeMatches(unit.scope, file.path));
    if (scoped.length === 0) {
      writeFailure(out, 'EMPTY_SCOPE', { version: 1, unitId: unit.id, scope: unit.scope, reason: 'scope matches no indexed repository paths' });
      die(`context bundle scope is empty for ${unit.id}`);
    }
    if (broadScope(unit.scope, repoMap.files.length, scoped.length)) {
      writeFailure(out, 'BROAD_CONTEXT_REQUIRED', { version: 1, unitId: unit.id, scope: unit.scope, reason: 'scope requires the full repository index' });
      die(`broad context required for ${unit.id}`);
    }
    const related = new Set(scoped.map((file) => file.path));
    for (const file of scoped) {
      const edges = graph.files[file.path];
      for (const path of [...(edges?.imports || []), ...(edges?.importedBy || [])]) related.add(path);
    }
    const mapByPath = new Map(repoMap.files.map((file) => [file.path, file]));
    const files = [...related].sort().flatMap((path) => mapByPath.has(path) ? [mapByPath.get(path)] : []);
    const edges = Object.fromEntries([...related].sort().flatMap((path) => graph.files[path] ? [[path, graph.files[path]]] : []));
    const statePaths = [...receipt.state.staged, ...receipt.state.unstaged, ...(receipt.state.untracked.entries || [])]
      .filter((item) => scopeMatches(unit.scope, item.path));
    let delta = { fromSnapshotId: null, relevant: [] };
    if (f['--delta']) {
      delta = validateDelta(readJson(resolve(f['--delta'])), readJson(resolve(f['--previous'])), receipt, unit.scope);
    }
    const bundle = {
      version: 1,
      status: 'READY',
      runId: contract.runId,
      contractRevision: contract.revision,
      unitId: unit.id,
      snapshotId: receipt.snapshotId,
      compiler: { contextBundleSha256: COMPILER_SHA256 },
      scope: unit.scope,
      context: {
        files,
        importGraph: edges,
        visibleChanges: statePaths,
        delta,
        atlas: atlasSections(root, meta, unit.scope, contract.context.maxAtlasExcerptBytes),
      },
      completeness: {
        repositoryIndex: 'EXACT-SNAPSHOT',
        ignoredContent: receipt.state.completeness,
        imports: 'STATIC-BEST-EFFORT',
        atlas: meta.atlas.status === 'available' ? 'FRESHNESS-GATED' : 'ABSENT',
      },
    };
    bundle.bundleId = digestJson(normalizeBundle(bundle));
    let rendered = '';
    for (let attempt = 0; attempt < 16; attempt++) {
      rendered = `${JSON.stringify(bundle, null, 2)}\n`;
      const actualBytes = Buffer.byteLength(rendered);
      if (bundle.actualBytes === actualBytes) break;
      bundle.actualBytes = actualBytes;
    }
    rendered = `${JSON.stringify(bundle, null, 2)}\n`;
    if (bundle.actualBytes !== Buffer.byteLength(rendered)) throw new Error('context bundle byte count did not converge');
    if (Buffer.byteLength(rendered) > contract.context.maxBundleBytes) {
      writeFailure(out, 'BUDGET_EXCEEDED', { version: 1, unitId: unit.id, actualBytes: Buffer.byteLength(rendered), maxBundleBytes: contract.context.maxBundleBytes });
      die(`context bundle exceeds maxBundleBytes for ${unit.id}`);
    }
    atomicWrite(out, rendered);
    console.log(`ok context bundle ${unit.id} ${bundle.bundleId}`);
  } catch (error) { die(error.message); }
} else if (command === 'verify') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--contract', '--unit', '--bundle']));
  if (!f['--root'] || !f['--contract'] || !f['--unit'] || !f['--bundle']) usage();
  try {
    const root = resolve(f['--root']);
    const { contract, receipt } = loadBinding(root, resolve(f['--contract']), f['--unit']);
    const bundlePath = resolve(f['--bundle']);
    if (!existsSync(bundlePath)) throw new Error('context bundle is missing');
    const bundle = readJson(bundlePath);
    if (bundle.version !== 1 || bundle.status !== 'READY') throw new Error('context bundle is not READY');
    if (bundle.runId !== contract.runId || bundle.contractRevision !== contract.revision || bundle.unitId !== f['--unit'] || bundle.snapshotId !== receipt.snapshotId) throw new Error('context bundle binding does not match contract');
    if (bundle.compiler?.contextBundleSha256 !== COMPILER_SHA256) throw new Error('context bundle compiler drift; rebuild the bundle');
    if (!/^[0-9a-f]{64}$/.test(bundle.bundleId || '') || digestJson(normalizeBundle(bundle)) !== bundle.bundleId) throw new Error('context bundle digest is invalid');
    if (Buffer.byteLength(readFileSync(bundlePath)) > contract.context.maxBundleBytes) throw new Error('context bundle exceeds maxBundleBytes');
    console.log(`ok context bundle ${bundle.unitId}`);
  } catch (error) { die(error.message); }
} else usage();
