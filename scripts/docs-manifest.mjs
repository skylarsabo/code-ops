#!/usr/bin/env node
// Validates and stamps a repository's sole authored-documentation registry.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicWrite, pathMatchesGlob, safeRelative, sha256, toPosix } from './context-index-lib.mjs';

const REQUIRED = new Set(['architecture', 'contracts', 'data-model', 'engineering-standards', 'api-reference', 'ci-delivery', 'infrastructure', 'observability', 'design-system', 'guides', 'atlas']);
const TOP_KEYS_V1 = new Set(['version', 'hub', 'domains']);
const TOP_KEYS_V2 = new Set(['version', 'hub', 'runs', 'recordCollections', 'legacyPaths', 'domains']);
const KEYS = new Set(['id', 'path', 'status', 'evidence', 'sources', 'sourceDigest', 'contentDigest']);
const COLLECTION_KEYS = new Set(['id', 'collectionUuid', 'identityVersion', 'root', 'inventory', 'citations', 'curationLedger', 'index', 'scopes']);
const SCOPE_KEYS = new Set(['pattern', 'kind', 'policy']);
const LEGACY_KEYS = new Set(['path', 'disposition', 'target', 'requiredBy']);
const SCOPE_POLICIES = new Map([
  ['record', new Set(['append-only'])],
  ['artifact', new Set(['mutable', 'frozen', 'superseded'])],
  ['executable', new Set(['frozen', 'superseded'])],
  ['forbidden', new Set(['forbidden'])],
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
function usage() { die('usage: docs-manifest.mjs check|sync|plan [--root <repo>] [--out <file>]', 2); }
function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--root', '--out'].includes(key) || out[key]) usage();
    const value = args[++i];
    if (!value || value.startsWith('--')) usage();
    out[key] = value;
  }
  return out;
}
function gitPaths(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean).map((path) => toPosix(path));
}
function hashPaths(root, paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) { hash.update(path); hash.update('\0'); hash.update(readFileSync(resolve(root, path))); hash.update('\0'); }
  return hash.digest('hex');
}
function contentPaths(root, hub, path) {
  const absolute = resolve(root, hub, path);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [`${hub}/${path}`];
  const prefix = `${hub}/${path}/`;
  return gitPaths(root, ['ls-files', '-co', '--exclude-standard', '-z']).filter((entry) => entry.startsWith(prefix));
}
function findManifest(root) {
  const candidates = gitPaths(root, ['ls-files', '-co', '--exclude-standard', '-z'])
    .filter((file) => file.endsWith('/98 System/DOCS_MANIFEST.json'));
  if (candidates.length !== 1) die(candidates.length ? `multiple documentation manifests found: ${candidates.join(', ')}` : 'no documentation manifest found at <hub>/98 System/DOCS_MANIFEST.json');
  const path = resolve(root, candidates[0]);
  let manifest;
  try { manifest = JSON.parse(readFileSync(path, 'utf8')); } catch (error) { die(`cannot parse documentation manifest: ${error.message}`); }
  const hub = candidates[0].slice(0, -'/98 System/DOCS_MANIFEST.json'.length);
  if (!manifest || manifest.hub !== hub) die(`documentation manifest hub must equal ${hub}`);
  return { path, manifest, hub };
}
function exactKeys(value, keys, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${label} must be an object`); return false; }
  for (const key of Object.keys(value)) if (!keys.has(key)) errors.push(`${label} has unknown key ${key}`);
  for (const key of keys) if (!(key in value)) errors.push(`${label} is missing ${key}`);
  return true;
}
function standardVersion(root, hub) {
  const path = resolve(root, hub, 'Standard.md');
  if (!existsSync(path)) return null;
  const match = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const value = match[1].split(/\r?\n/).map((line) => /^standard-version:\s*["']?([^"']+?)["']?\s*$/.exec(line)).find(Boolean)?.[1];
  return value === undefined ? null : Number(value);
}
function inspectCollections(manifest, hub, files, errors) {
  if (manifest.version !== 2) return;
  if (!exactKeys(manifest.runs, new Set(['tracking']), 'runs', errors)
    || !['tracked', 'ignored'].includes(manifest.runs?.tracking)) errors.push('runs.tracking must be tracked or ignored');
  if (!Array.isArray(manifest.recordCollections)) errors.push('recordCollections must be an array');
  if (!Array.isArray(manifest.legacyPaths)) errors.push('legacyPaths must be an array');
  const ids = new Set(); const uuids = new Set(); const roots = [];
  for (const collection of manifest.recordCollections || []) {
    exactKeys(collection, COLLECTION_KEYS, `record collection ${collection?.id || '<unknown>'}`, errors);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(collection?.id || '') || ids.has(collection.id)) errors.push(`invalid or duplicate record collection id ${collection?.id}`);
    else ids.add(collection.id);
    if (!UUID_RE.test(collection?.collectionUuid || '') || uuids.has(collection.collectionUuid?.toLowerCase())) errors.push(`${collection?.id || 'record collection'} has an invalid or duplicate collectionUuid`);
    else uuids.add(collection.collectionUuid.toLowerCase());
    if (collection?.identityVersion !== 1) errors.push(`${collection?.id || 'record collection'} identityVersion must be 1`);
    if (!safeRelative(collection?.root)) errors.push(`${collection?.id || 'record collection'} root must be a safe repository-relative path`);
    else {
      const normalized = collection.root.toLowerCase();
      if (roots.some((root) => normalized === root || normalized.startsWith(`${root}/`) || root.startsWith(`${normalized}/`))) errors.push(`${collection.id} root overlaps another record collection`);
      roots.push(normalized);
      const prefix = `${collection.root}/`; const foldedPrefix = prefix.toLowerCase();
      const aliases = files.filter((file) => file.toLowerCase().startsWith(foldedPrefix) && !file.startsWith(prefix));
      if (aliases.length) errors.push(`${collection.id} root casing differs from Git index: ${aliases.join(', ')}`);
    }
    for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
      if (!safeRelative(collection?.[key])) errors.push(`${collection?.id || 'record collection'} ${key} must be hub-relative`);
      else if (safeRelative(collection?.root)) {
        const generatedPath = `${hub}/${collection[key]}`;
        const foldedGenerated = generatedPath.toLowerCase(); const foldedRoot = collection.root.toLowerCase();
        if (foldedGenerated === foldedRoot || foldedGenerated.startsWith(`${foldedRoot}/`)) {
          errors.push(`${collection.id} generated ${key} overlaps its immutable root`);
        }
      }
    }
    if (!Array.isArray(collection?.scopes) || !collection.scopes.length) errors.push(`${collection?.id || 'record collection'} needs scopes`);
    for (const [index, scope] of (collection?.scopes || []).entries()) {
      exactKeys(scope, SCOPE_KEYS, `${collection.id} scope ${index + 1}`, errors);
      if (typeof scope?.pattern !== 'string' || !scope.pattern || scope.pattern.startsWith('/') || scope.pattern.includes('\\')) errors.push(`${collection.id} scope ${index + 1} has an invalid pattern`);
      if (!SCOPE_POLICIES.get(scope?.kind)?.has(scope?.policy)) errors.push(`${collection.id} scope ${index + 1} has an invalid kind/policy pair`);
    }
  }
  const generated = new Set();
  for (const collection of manifest.recordCollections || []) for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
    const path = `${hub}/${collection[key]}`.toLowerCase();
    if (generated.has(path)) errors.push(`${collection.id} reuses generated record path ${collection[key]}`);
    generated.add(path);
  }
  const legacy = new Set();
  for (const [index, entry] of (manifest.legacyPaths || []).entries()) {
    exactKeys(entry, LEGACY_KEYS, `legacy path ${index + 1}`, errors);
    if (!safeRelative(entry?.path) || legacy.has(entry.path?.toLowerCase())) errors.push(`legacy path ${index + 1} has an invalid or duplicate path`);
    else legacy.add(entry.path.toLowerCase());
    if (!['pointer', 'tombstone'].includes(entry?.disposition)) errors.push(`legacy path ${index + 1} has an invalid disposition`);
    if (safeRelative(entry?.path) && roots.some((root) => entry.path.toLowerCase() === root || entry.path.toLowerCase().startsWith(`${root}/`))) {
      errors.push(`legacy path ${index + 1} overlaps an immutable record root`);
    }
    if (safeRelative(entry?.path) && generated.has(entry.path.toLowerCase())) errors.push(`legacy path ${index + 1} overlaps generated record metadata`);
    if (!safeRelative(entry?.target) || !entry.target.startsWith(`${hub}/`)) errors.push(`legacy path ${index + 1} target must be inside the documentation hub`);
    if (!Array.isArray(entry?.requiredBy) || !entry.requiredBy.length
      || entry.requiredBy.some((item) => !item || typeof item !== 'object' || Array.isArray(item)
        || !['record', 'commit', 'external'].includes(item.kind) || typeof item.ref !== 'string' || !item.ref.trim()
        || Object.keys(item).some((key) => !['kind', 'ref'].includes(key)))) errors.push(`legacy path ${index + 1} needs qualifying requiredBy evidence`);
  }
}
function inspect(root, manifest, hub) {
  const errors = [];
  const files = gitPaths(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  const topKeys = manifest.version === 2 ? TOP_KEYS_V2 : TOP_KEYS_V1;
  for (const key of Object.keys(manifest)) if (!topKeys.has(key)) errors.push(`manifest has unknown key ${key}`);
  for (const key of topKeys) if (!(key in manifest)) errors.push(`manifest is missing ${key}`);
  if (![1, 2].includes(manifest.version) || !safeRelative(hub) || !Array.isArray(manifest.domains)) errors.push('manifest must use version 1 or 2, a safe hub, and a domains array');
  const claimedStandard = standardVersion(root, hub);
  if (manifest.version === 2 && (!Number.isInteger(claimedStandard) || claimedStandard < 4)) errors.push('manifest version 2 requires Standard.md standard-version 4 or newer');
  inspectCollections(manifest, hub, files, errors);
  const ids = new Set(); const paths = new Set();
  for (const domain of manifest.domains || []) {
    for (const key of Object.keys(domain)) if (!KEYS.has(key)) errors.push(`${domain.id || 'domain'} has unknown key ${key}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(domain.id || '') || ids.has(domain.id)) errors.push(`invalid or duplicate domain id ${domain.id}`);
    ids.add(domain.id);
    if (!safeRelative(domain.path) || paths.has(domain.path.toLowerCase())) errors.push(`${domain.id} has invalid or duplicate path`);
    paths.add(domain.path.toLowerCase());
    if (!['current', 'not-applicable'].includes(domain.status)) errors.push(`${domain.id} has invalid status`);
    if (domain.status === 'not-applicable' && (!domain.evidence || domain.evidence.length < 40)) errors.push(`${domain.id} needs concrete not-applicable evidence`);
    const validSources = Array.isArray(domain.sources) && domain.sources.length > 0
      && domain.sources.every((pattern) => typeof pattern === 'string' && pattern);
    if (!validSources) errors.push(`${domain.id} needs source patterns`);
    const sources = validSources
      ? files.filter((file) => domain.sources.some((pattern) => pathMatchesGlob(pattern, file)) && !file.startsWith(`${hub}/`))
      : [];
    if (validSources && !sources.length) errors.push(`${domain.id} source patterns match no repository files`);
    const contents = contentPaths(root, hub, domain.path);
    if (!contents.length) errors.push(`${domain.id} target is missing or empty: ${domain.path}`);
    const expectedSource = hashPaths(root, sources); const expectedContent = hashPaths(root, contents);
    if (domain.sourceDigest !== expectedSource) errors.push(`${domain.id} source digest is stale`);
    if (domain.contentDigest !== expectedContent) errors.push(`${domain.id} content digest is stale`);
    domain._computed = { sourceDigest: expectedSource, contentDigest: expectedContent };
  }
  for (const id of REQUIRED) if (!ids.has(id)) errors.push(`missing required documentation domain ${id}`);
  const collectionRoots = (manifest.recordCollections || []).map((collection) => `${collection.root}/`);
  const legacyPaths = new Set((manifest.legacyPaths || []).map((entry) => entry.path));
  const legacy = files.filter((file) => file.startsWith('docs/') && /\.md$/i.test(file)
    && !collectionRoots.some((rootPath) => file.startsWith(rootPath)) && !legacyPaths.has(file));
  if (legacy.length) errors.push(`authored Markdown remains outside ${hub}: ${legacy.join(', ')}`);
  return errors;
}

const command = process.argv[2];
if (!['check', 'sync', 'plan'].includes(command)) usage();
const f = flags(process.argv.slice(3)); const root = resolve(f['--root'] || process.cwd());
const { path, manifest, hub } = findManifest(root); const errors = inspect(root, manifest, hub);
const digestDrift = /^[a-z0-9]+(?:-[a-z0-9]+)* (?:source|content) digest is stale$/;
const structuralErrors = errors.filter((error) => !digestDrift.test(error));
if (command === 'sync') {
  if (structuralErrors.length) die(`documentation manifest invalid:\n${structuralErrors.map((error) => `  - ${error}`).join('\n')}`);
  for (const domain of manifest.domains) { domain.sourceDigest = domain._computed.sourceDigest; domain.contentDigest = domain._computed.contentDigest; delete domain._computed; }
  atomicWrite(path, `${JSON.stringify(manifest, null, 2)}\n`); console.log(`ok documentation manifest synced (${manifest.domains.length} domains)`);
} else if (command === 'check') {
  if (errors.length) die(`documentation manifest invalid:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  console.log(`ok documentation manifest (${manifest.domains.length} domains)`);
} else {
  if (structuralErrors.length) die(`documentation manifest invalid:\n${structuralErrors.map((error) => `  - ${error}`).join('\n')}`);
  const changed = new Set([...gitPaths(root, ['diff', '--name-only', '-z', 'HEAD', '--']), ...gitPaths(root, ['ls-files', '--others', '--exclude-standard', '-z'])]);
  const records = (manifest.recordCollections || []).map((collection) => {
    const generated = ['inventory', 'citations', 'curationLedger', 'index'].map((key) => `${hub}/${collection[key]}`);
    const affectedSources = [...changed].filter((file) => file === collection.root || file.startsWith(`${collection.root}/`) || generated.includes(file)).sort();
    return { id: collection.id, index: `${hub}/${collection.index}`, inventory: `${hub}/${collection.inventory}`, affectedSources };
  }).filter((collection) => collection.affectedSources.length);
  const plan = { version: manifest.version, hub, manifestSha256: sha256(readFileSync(path)), changed: [...changed].sort(), domains: manifest.domains.map((domain) => ({ id: domain.id, path: `${hub}/${domain.path}`, affectedSources: [...changed].filter((file) => domain.sources.some((pattern) => pathMatchesGlob(pattern, file))).sort(), status: domain.status })).filter((domain) => domain.affectedSources.length), records };
  for (const domain of manifest.domains) delete domain._computed;
  const output = `${JSON.stringify(plan, null, 2)}\n`; if (f['--out']) atomicWrite(resolve(f['--out']), output); else process.stdout.write(output);
}
