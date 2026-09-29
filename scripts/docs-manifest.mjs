#!/usr/bin/env node
// Validates and stamps a repository's sole authored-documentation registry.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, pathMatchesGlob, safeRelative, sha256, toPosix } from './context-index-lib.mjs';
import { safePath, scopeValidationErrors } from './record-lib.mjs';

const REQUIRED = new Set(['architecture', 'contracts', 'data-model', 'engineering-standards', 'api-reference', 'ci-delivery', 'infrastructure', 'observability', 'design-system', 'guides', 'atlas']);
const TOP_KEYS_V1 = new Set(['version', 'hub', 'domains']);
const TOP_KEYS_V2 = new Set(['version', 'hub', 'runs', 'recordCollections', 'legacyPaths', 'domains']);
const TOP_KEYS_V3 = new Set([...TOP_KEYS_V2, 'drafts', 'state']);
const TOP_KEYS = { 1: TOP_KEYS_V1, 2: TOP_KEYS_V2, 3: TOP_KEYS_V3 };
const MIN_STANDARD = { 2: 4, 3: 5 };
const LEGACY_DISPOSITIONS = { 2: ['pointer', 'tombstone'], 3: ['pointer', 'tombstone', 'relocated', 'removed'] };
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEYS = new Set(['id', 'path', 'status', 'evidence', 'sources', 'sourceDigest', 'contentDigest']);
const COLLECTION_KEYS = new Set(['id', 'collectionUuid', 'identityVersion', 'root', 'inventory', 'citations', 'curationLedger', 'index', 'scopes']);
const COLLECTION_KEYS_V2 = new Set([...COLLECTION_KEYS, 'classificationVersion']);
const LEGACY_KEYS = new Set(['path', 'disposition', 'target', 'requiredBy']);
const LEGACY_KEYS_REMOVED = new Set(['path', 'disposition', 'requiredBy']);
const RECORDS_ROOT = '98 System/Records/';
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
export function hashPaths(root, paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) { hash.update(path); hash.update('\0'); hash.update(readFileSync(resolve(root, path))); hash.update('\0'); }
  return hash.digest('hex');
}
// The one source-digest path. A manifest domain and a state page that declares `sources:` both
// match patterns against the repository file list and hash the matches with hashPaths, so a page
// digest and a domain digest cannot drift apart. `skip` drops files the owner must not hash.
export const repoFiles = (root) => gitPaths(root, ['ls-files', '-co', '--exclude-standard', '-z']);
export const matchSources = (files, patterns, skip = () => false) =>
  files.filter((file) => patterns.some((pattern) => pathMatchesGlob(pattern, file)) && !skip(file));
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
const uniqueArray = (value, valid) => Array.isArray(value) && value.every(valid) && new Set(value).size === value.length;
// Manifest v3 profile blocks. This function validates their shape. Only `drafts.statuses` has a
// readers, check-vault-standard.mjs (rules 9 and 11 to 15) for `drafts.statuses` and
// `drafts.maxAgeDays`. No code reads `runs.tracking`, `runs.retain`, or `state`.
function inspectProfileV3(manifest, errors) {
  const { runs, drafts, state } = manifest;
  if (exactKeys(runs, new Set(['tracking', 'retain']), 'runs', errors)) {
    if (!['tracked', 'closeout', 'ignored'].includes(runs.tracking)) errors.push('runs.tracking must be tracked, closeout, or ignored');
    if (!uniqueArray(runs.retain, safeRelative)) errors.push('runs.retain must be an array of unique safe run-relative globs');
    else if (runs.retain.length && runs.tracking !== 'closeout') errors.push('runs.retain applies only when runs.tracking is closeout');
  }
  if (exactKeys(drafts, new Set(['maxAgeDays', 'statuses']), 'drafts', errors)) {
    if (!Number.isInteger(drafts.maxAgeDays) || drafts.maxAgeDays < 1) errors.push('drafts.maxAgeDays must be a positive integer');
    if (!uniqueArray(drafts.statuses, (status) => typeof status === 'string' && SLUG_RE.test(status))
      || !drafts.statuses.length) errors.push('drafts.statuses must be a non-empty array of unique slug statuses');
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) { errors.push('state must be an object'); return; }
  const surfaces = new Set();
  for (const [surface, spec] of Object.entries(state)) {
    const folded = surface.toLowerCase();
    if (!safeRelative(surface) || !folded.endsWith('.md') || /[*?]/.test(surface) || surfaces.has(folded)) errors.push(`state surface ${surface} must be a unique hub-relative Markdown path`);
    surfaces.add(folded);
    if (exactKeys(spec, new Set(['budgetWords']), `state surface ${surface}`, errors)
      && (!Number.isInteger(spec.budgetWords) || spec.budgetWords < 1)) errors.push(`state surface ${surface} budgetWords must be a positive integer`);
  }
}
function inspectCollections(root, manifest, hub, files, tracked, errors) {
  if (manifest.version !== 2 && manifest.version !== 3) return;
  if (manifest.version === 3) inspectProfileV3(manifest, errors);
  else if (!exactKeys(manifest.runs, new Set(['tracking']), 'runs', errors)
    || !['tracked', 'ignored'].includes(manifest.runs?.tracking)) errors.push('runs.tracking must be tracked or ignored');
  if (!Array.isArray(manifest.recordCollections)) errors.push('recordCollections must be an array');
  if (!Array.isArray(manifest.legacyPaths)) errors.push('legacyPaths must be an array');
  const collections = Array.isArray(manifest.recordCollections) ? manifest.recordCollections : [];
  const legacyPaths = Array.isArray(manifest.legacyPaths) ? manifest.legacyPaths : [];
  if (Array.isArray(manifest.legacyPaths) && manifest.legacyPaths.length
    && !collections.length) {
    errors.push('legacyPaths require a record collection so CI can verify their evidence');
  }
  const ids = new Set(); const uuids = new Set(); const roots = [];
  for (const collection of collections) {
    const collectionKeys = Object.hasOwn(collection || {}, 'classificationVersion') ? COLLECTION_KEYS_V2 : COLLECTION_KEYS;
    if (!exactKeys(collection, collectionKeys, `record collection ${collection?.id || '<unknown>'}`, errors)) continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(collection?.id || '') || ids.has(collection.id)) errors.push(`invalid or duplicate record collection id ${collection?.id}`);
    else ids.add(collection.id);
    if (!UUID_RE.test(collection?.collectionUuid || '') || uuids.has(collection.collectionUuid?.toLowerCase())) errors.push(`${collection?.id || 'record collection'} has an invalid or duplicate collectionUuid`);
    else uuids.add(collection.collectionUuid.toLowerCase());
    if (collection?.identityVersion !== 1) errors.push(`${collection?.id || 'record collection'} identityVersion must be 1`);
    if (!safePath(collection?.root)) errors.push(`${collection?.id || 'record collection'} root must be a safe repository-relative path`);
    else {
      const normalized = collection.root.toLowerCase();
      if (roots.some((root) => normalized === root || normalized.startsWith(`${root}/`) || root.startsWith(`${normalized}/`))) errors.push(`${collection.id} root overlaps another record collection`);
      roots.push(normalized);
      const prefix = `${collection.root}/`; const foldedPrefix = prefix.toLowerCase();
      const aliases = files.filter((file) => file.toLowerCase().startsWith(foldedPrefix) && !file.startsWith(prefix));
      if (aliases.length) errors.push(`${collection.id} root casing differs from Git index: ${aliases.join(', ')}`);
    }
    for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
      if (!safePath(collection?.[key]) || !collection[key].startsWith(RECORDS_ROOT)) errors.push(`${collection?.id || 'record collection'} ${key} must be inside ${RECORDS_ROOT}`);
      else if (safePath(collection?.root)) {
        const generatedPath = `${hub}/${collection[key]}`;
        const foldedGenerated = generatedPath.toLowerCase(); const foldedRoot = collection.root.toLowerCase();
        if (foldedGenerated === foldedRoot || foldedGenerated.startsWith(`${foldedRoot}/`)) {
          errors.push(`${collection.id} generated ${key} overlaps its immutable root`);
        }
      }
    }
    const collectionLabel = collection?.id || 'record collection';
    errors.push(...scopeValidationErrors(collection, tracked).map((error) => `${collectionLabel} ${error}`));
  }
  const generated = new Set();
  for (const collection of collections) for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
    if (!collection || typeof collection !== 'object' || Array.isArray(collection)) continue;
    const path = `${hub}/${collection[key]}`.toLowerCase();
    if (generated.has(path)) errors.push(`${collection.id} reuses generated record path ${collection[key]}`);
    generated.add(path);
  }
  const legacy = new Set();
  for (const [index, entry] of legacyPaths.entries()) {
    const disposition = LEGACY_DISPOSITIONS[manifest.version].includes(entry?.disposition) ? entry.disposition : null;
    exactKeys(entry, disposition === 'removed' ? LEGACY_KEYS_REMOVED : LEGACY_KEYS, `legacy path ${index + 1}`, errors);
    if (!safeRelative(entry?.path) || legacy.has(entry.path?.toLowerCase())) errors.push(`legacy path ${index + 1} has an invalid or duplicate path`);
    else legacy.add(entry.path.toLowerCase());
    if (!disposition) errors.push(`legacy path ${index + 1} has an invalid disposition`);
    if (['relocated', 'removed'].includes(disposition) && safeRelative(entry.path) && existsSync(resolve(root, entry.path))) {
      errors.push(`legacy path ${index + 1} is ${disposition} but still exists on disk`);
    }
    if (disposition === 'relocated' && safeRelative(entry.target) && !existsSync(resolve(root, entry.target))) {
      errors.push(`legacy path ${index + 1} relocated target does not exist`);
    }
    if (safeRelative(entry?.path) && roots.some((root) => entry.path.toLowerCase() === root || entry.path.toLowerCase().startsWith(`${root}/`))) {
      errors.push(`legacy path ${index + 1} overlaps an immutable record root`);
    }
    if (safeRelative(entry?.path) && generated.has(entry.path.toLowerCase())) errors.push(`legacy path ${index + 1} overlaps generated record metadata`);
    if (disposition !== 'removed' && (!safeRelative(entry?.target) || !entry.target.startsWith(`${hub}/`))) errors.push(`legacy path ${index + 1} target must be inside the documentation hub`);
    if (!Array.isArray(entry?.requiredBy) || !entry.requiredBy.length
      || entry.requiredBy.some((item) => !item || typeof item !== 'object' || Array.isArray(item)
        || !['record', 'commit', 'external'].includes(item.kind) || typeof item.ref !== 'string' || !item.ref.trim()
        || Object.keys(item).some((key) => !['kind', 'ref'].includes(key)))) errors.push(`legacy path ${index + 1} needs qualifying requiredBy evidence`);
    if (entry?.requiredBy?.some((item) => item.kind === 'record'
      && !/^REC-[A-Z2-7]{8,26}$/.test(item.ref))) errors.push(`legacy path ${index + 1} record evidence must use a record ID prefix`);
    if (!entry?.requiredBy?.some((item) => item.kind === 'record') && !entry?.requiredBy?.some((item) => item.kind === 'external' || item.kind === 'commit')) errors.push(`legacy path ${index + 1} needs a verifiable control`);
  }
}
function inspect(root, manifest, hub) {
  const errors = [];
  const files = gitPaths(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  const tracked = gitPaths(root, ['ls-files', '-z']);
  const topKeys = TOP_KEYS[manifest.version] || TOP_KEYS_V1;
  for (const key of Object.keys(manifest)) if (!topKeys.has(key)) errors.push(`manifest has unknown key ${key}`);
  for (const key of topKeys) if (!(key in manifest)) errors.push(`manifest is missing ${key}`);
  if (![1, 2, 3].includes(manifest.version) || !safeRelative(hub) || !Array.isArray(manifest.domains)) errors.push('manifest must use version 1, 2, or 3, a safe hub, and a domains array');
  const claimedStandard = standardVersion(root, hub); const minStandard = MIN_STANDARD[manifest.version];
  if (minStandard && (!Number.isInteger(claimedStandard) || claimedStandard < minStandard)) errors.push(`manifest version ${manifest.version} requires Standard.md standard-version ${minStandard} or newer`);
  inspectCollections(root, manifest, hub, files, tracked, errors);
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
      ? matchSources(files, domain.sources, (file) => file.startsWith(`${hub}/`))
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
  const collectionRoots = (Array.isArray(manifest.recordCollections) ? manifest.recordCollections : [])
    .filter((collection) => collection && typeof collection === 'object' && !Array.isArray(collection))
    .map((collection) => `${collection.root}/`);
  const legacyPaths = new Set((Array.isArray(manifest.legacyPaths) ? manifest.legacyPaths : []).map((entry) => entry?.path));
  const legacy = files.filter((file) => file.startsWith('docs/') && /\.md$/i.test(file)
    && !collectionRoots.some((rootPath) => file.startsWith(rootPath)) && !legacyPaths.has(file));
  if (legacy.length) errors.push(`authored Markdown remains outside ${hub}: ${legacy.join(', ')}`);
  return errors;
}

// Import-safe: check-vault-standard.mjs reuses the digest helpers above, so the CLI runs only when
// this file is the entry point. A symlinked entry compares by real path.
const isEntry = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntry) {
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
}
