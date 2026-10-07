#!/usr/bin/env node
// Validates and stamps a repository's sole authored-documentation registry.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
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
function usage() { die('usage: docs-manifest.mjs check|sync|plan|runs [--root <repo>] [--out <file>] [--base <ref>] [--all] [--index] [--only <id>] [--attested <rev>[,<rev>...]] [--now <YYYY-MM-DD>]', 2); }
function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--all' || key === '--index') { if (out[key]) usage(); out[key] = true; continue; }
    if (!['--root', '--out', '--base', '--only', '--attested', '--now'].includes(key) || out[key]) usage();
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
export function hashPaths(root, paths, read = (path) => readFileSync(resolve(root, path))) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) { hash.update(path); hash.update('\0'); hash.update(read(path)); hash.update('\0'); }
  return hash.digest('hex');
}
// The one source-digest path. A manifest domain and a state page that declares `sources:` both
// match patterns against the repository file list and hash the matches with hashPaths, so a page
// digest and a domain digest cannot drift apart. `skip` drops files the owner must not hash.
export const repoFiles = (root) => gitPaths(root, ['ls-files', '-co', '--exclude-standard', '-z']);
export const matchSources = (files, patterns, skip = () => false) =>
  files.filter((file) => patterns.some((pattern) => pathMatchesGlob(pattern, file)) && !skip(file));
// A snapshot is where digest inputs come from: the working tree (the default), the index
// (--index, the bytes a commit takes), or a commit tree (--attested). It lists the files, reads
// a path's bytes, and resolves a domain's page or folder. The working-tree snapshot keeps the
// historical behavior: `files` is `ls-files -co`, so untracked files count.
const BLOB_BUFFER = 1024 * 1024 * 1024;
function workingSnapshot(root) {
  const files = repoFiles(root);
  return {
    files, tracked: gitPaths(root, ['ls-files', '-z']),
    read: (path) => readFileSync(resolve(root, path)),
    contents(hub, path) {
      const absolute = resolve(root, hub, path);
      if (!existsSync(absolute)) return [];
      if (statSync(absolute).isFile()) return [`${hub}/${path}`];
      const prefix = `${hub}/${path}/`;
      return files.filter((entry) => entry.startsWith(prefix));
    },
  };
}
// Reads every blob of a tree listing through one `git cat-file --batch`, so the index or a rev
// costs one process, not one per file.
// deferred(whole tree held in memory, stream cat-file per domain if a repository outgrows BLOB_BUFFER)
function blobSnapshot(root, entries) {
  const shas = [...new Set(entries.map((entry) => entry.sha))];
  const blobs = new Map();
  if (shas.length) {
    const out = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: `${shas.join('\n')}\n`, maxBuffer: BLOB_BUFFER });
    let at = 0;
    for (const sha of shas) {
      const eol = out.indexOf(0x0a, at);
      const [, type, size] = (eol < 0 ? '' : out.toString('latin1', at, eol)).split(' ');
      if (type !== 'blob') die(`cannot read object ${sha} through git cat-file`);
      blobs.set(sha, out.subarray(eol + 1, eol + 1 + Number(size)));
      at = eol + 1 + Number(size) + 1;
    }
  }
  const byPath = new Map(entries.map((entry) => [entry.path, blobs.get(entry.sha)]));
  const files = [...byPath.keys()];
  return {
    files, tracked: files, read: (path) => byPath.get(path),
    contents(hub, path) {
      if (byPath.has(`${hub}/${path}`)) return [`${hub}/${path}`];
      const prefix = `${hub}/${path}/`;
      return files.filter((entry) => entry.startsWith(prefix));
    },
  };
}
// Both listings are NUL-separated records of `<metadata>\t<path>`. A gitlink (a submodule commit)
// has no blob, so `parse` returns null for it and the entry drops out.
function listing(root, args, parse) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean).flatMap((record) => {
      const tab = record.indexOf('\t');
      const entry = parse(record.slice(0, tab).split(' '), record.slice(tab + 1));
      return entry ? [entry] : [];
    });
}
function indexSnapshot(root) {
  return blobSnapshot(root, listing(root, ['ls-files', '-s', '-z'], ([mode, sha, stage], path) => {
    if (stage !== '0') die(`the index has unmerged paths (${path}); resolve them before using --index`);
    return mode === '160000' ? null : { path, sha };
  }));
}
function treeSnapshot(root, rev) {
  return blobSnapshot(root, listing(root, ['ls-tree', '-r', '-z', rev], ([, type, sha], path) => (type === 'blob' ? { path, sha } : null)));
}
const MANIFEST_SUFFIX = '/98 System/DOCS_MANIFEST.json';
// `fromSnapshot` reads the manifest bytes from the snapshot instead of the file on disk. `check
// --index` uses it, so the digests it compares are the ones the commit would carry.
function findManifest(snap, root, fromSnapshot) {
  const candidates = snap.files.filter((file) => file.endsWith(MANIFEST_SUFFIX));
  if (candidates.length !== 1) die(candidates.length ? `multiple documentation manifests found: ${candidates.join(', ')}` : 'no documentation manifest found at <hub>/98 System/DOCS_MANIFEST.json');
  const path = resolve(root, candidates[0]);
  let manifest;
  try { manifest = JSON.parse(fromSnapshot ? snap.read(candidates[0]).toString('utf8') : readFileSync(path, 'utf8')); } catch (error) { die(`cannot parse documentation manifest: ${error.message}`); }
  const hub = candidates[0].slice(0, -MANIFEST_SUFFIX.length);
  if (!manifest || manifest.hub !== hub) die(`documentation manifest hub must equal ${hub}`);
  return { path, manifest, hub, relative: candidates[0] };
}
// The files a domain digests: source matches outside the hub, plus the domain's own page or folder.
function domainInputs(snap, hub, domain) {
  return {
    sources: matchSources(snap.files, domain.sources, (file) => file.startsWith(`${hub}/`)),
    contents: snap.contents(hub, domain.path),
  };
}
const digestsOf = (snap, root, { sources, contents }) => ({
  sourceDigest: hashPaths(root, sources, snap.read), contentDigest: hashPaths(root, contents, snap.read),
});
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
function inspect(root, manifest, hub, snap) {
  const errors = [];
  const files = snap.files;
  const tracked = snap.tracked;
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
    const { sources, contents } = validSources ? domainInputs(snap, hub, domain) : { sources: [], contents: snap.contents(hub, domain.path) };
    if (validSources && !sources.length) errors.push(`${domain.id} source patterns match no repository files`);
    if (!contents.length) errors.push(`${domain.id} target is missing or empty: ${domain.path}`);
    const { sourceDigest: expectedSource, contentDigest: expectedContent } = digestsOf(snap, root, { sources, contents });
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

// --attested: a drifted domain is restamped only when each named commit already carried correct
// digests for it. At that commit the manifest entry must name the same sources and page as the
// current one and equal the digests computed from that commit's own tree. Both sides of a merge
// then vouched for the domain, so restamping it is mechanical. A domain either side left stale,
// or whose definition changed, is not attested and keeps its bytes.
function attestedIds(root, revs, relative, hub, candidates) {
  let attested = new Set(candidates.map((domain) => domain.id));
  for (const rev of revs) {
    if (!attested.size) break;
    const snap = treeSnapshot(root, rev);
    let there = null;
    try { there = JSON.parse(snap.read(relative).toString('utf8')); } catch { /* absent or unparsable at this commit: nothing is attested */ }
    const byId = new Map((there?.hub === hub && Array.isArray(there.domains) ? there.domains : []).map((entry) => [entry?.id, entry]));
    attested = new Set(candidates.filter((domain) => {
      const entry = byId.get(domain.id);
      if (!attested.has(domain.id) || !entry || entry.path !== domain.path || !Array.isArray(entry.sources)
        || !entry.sources.every((pattern) => typeof pattern === 'string' && pattern)
        || JSON.stringify(entry.sources) !== JSON.stringify(domain.sources)) return false;
      const digests = digestsOf(snap, root, domainInputs(snap, hub, entry));
      return entry.sourceDigest === digests.sourceDigest && entry.contentDigest === digests.contentDigest;
    }).map((domain) => domain.id));
  }
  return attested;
}
// A plain sync hashes the working tree, but a commit takes the index. Paths that differ between
// the two are named so the author can stage them or pass --index. This warns and never refuses:
// the remedy for an atlas stamp is itself an unstaged edit inside a domain.
function unstagedInputs(root, inputs) {
  const dirty = new Set([...gitPaths(root, ['diff', '--name-only', '-z', '--']), ...gitPaths(root, ['ls-files', '--others', '--exclude-standard', '-z'])]);
  return [...new Set(inputs.flatMap(({ sources, contents }) => [...sources, ...contents]))].filter((file) => dirty.has(file)).sort();
}
function parseRevs(root, value) {
  const revs = value.split(',');
  if (revs.some((rev) => !rev || rev.startsWith('-'))) usage();
  for (const rev of revs) {
    try { execFileSync('git', ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], { cwd: root, stdio: 'ignore' }); } catch { die(`--attested: ${rev} is not a commit`); }
  }
  return revs;
}

// Run retention tiers (code-ops-docs/55 Operations/RUN_RETENTION.md). A run folder under
// `<hub>/80 Runs/` is aged from its YYYY-MM-DD name prefix, or from its mtime when the name has no
// valid date, and falls into one of three tiers. The tiers only classify. Nothing here deletes or moves.
export const RUN_TIER_DAYS = Object.freeze({ active: 30, distillReady: 180 });
const MS_PER_DAY = 86_400_000;
const RUN_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?![0-9])/;
const dayOf = (ms) => Math.floor(ms / MS_PER_DAY);
// The UTC day of a name's date prefix, or null when the name has no prefix or the date does not exist.
function nameDay(name) {
  const m = RUN_DATE_RE.exec(name);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? dayOf(ms) : null;
}
export function runRetentionTier(path, mtimeMs, nowMs = Date.now()) {
  const name = basename(path);
  const byName = nameDay(name);
  const ageDays = Math.max(0, dayOf(nowMs) - (byName ?? dayOf(mtimeMs)));
  const tier = ageDays <= RUN_TIER_DAYS.active ? 'active' : ageDays <= RUN_TIER_DAYS.distillReady ? 'distill-ready' : 'archive';
  return { name, ageDays, source: byName === null ? 'mtime' : 'name', tier };
}
// Read-only: lists the directories directly under a runs folder with their tier, oldest first.
export function listRunTiers(runsDir, nowMs = Date.now()) {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => runRetentionTier(entry.name, statSync(resolve(runsDir, entry.name)).mtimeMs, nowMs))
    .sort((a, b) => b.ageDays - a.ageDays || a.name.localeCompare(b.name));
}
function reportRuns(root, hub, now) {
  const rows = listRunTiers(resolve(root, hub, '80 Runs'), now);
  for (const tier of ['active', 'distill-ready', 'archive']) {
    const inTier = rows.filter((row) => row.tier === tier);
    console.log(`${tier} (${inTier.length})`);
    for (const row of inTier) console.log(`  ${String(row.ageDays).padStart(4)}d  ${row.source.padEnd(5)}  ${row.name}`);
  }
}

// Import-safe: check-vault-standard.mjs reuses the digest helpers above, so the CLI runs only when
// this file is the entry point. A symlinked entry compares by real path.
const isEntry = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntry) {
  const command = process.argv[2];
  if (!['check', 'sync', 'plan', 'runs'].includes(command)) usage();
  const f = flags(process.argv.slice(3)); const root = resolve(f['--root'] || process.cwd());
  const nowDay = /^\d{4}-\d{2}-\d{2}$/.test(f['--now'] ?? '') ? nameDay(f['--now']) : null;
  if (f['--now'] !== undefined && nowDay === null) usage();
  const nowDate = nowDay === null ? Date.now() : nowDay * MS_PER_DAY;
  if ((f['--now'] && command !== 'runs') || (command === 'runs' && Object.keys(f).some((key) => !['--root', '--now'].includes(key)))
    || ((f['--attested'] || f['--only']) && command !== 'sync') || (f['--index'] && command === 'plan')
    || (f['--attested'] && f['--all'])) usage();
  const revs = f['--attested'] ? parseRevs(root, f['--attested']) : null;
  const snap = f['--index'] ? indexSnapshot(root) : workingSnapshot(root);
  const { path, manifest, hub, relative } = findManifest(snap, root, Boolean(f['--index']) && command === 'check');
  if (f['--only'] && !manifest.domains?.some((domain) => domain.id === f['--only'])) die(`--only: no documentation domain ${f['--only']}`);
  if (command === 'runs') { reportRuns(root, hub, nowDate); process.exit(0); }
  const errors = inspect(root, manifest, hub, snap);
  const digestDrift = /^[a-z0-9]+(?:-[a-z0-9]+)* (?:source|content) digest is stale$/;
  const structuralErrors = errors.filter((error) => !digestDrift.test(error));
  if (command === 'sync') {
    if (structuralErrors.length) die(`documentation manifest invalid:\n${structuralErrors.map((error) => `  - ${error}`).join('\n')}`);
    // Stamp digests only where they drift. Unrelated domains keep their existing
    // lines so parallel feature PRs stop colliding on the whole DOCS_MANIFEST.json.
    // Pass --base <ref> to further limit stamping to domains whose sources or
    // content paths differ from that ref (plus untracked files). Pass --all to
    // restamp every domain even when digests already match. Pass --only <id> to
    // stamp one domain. Pass --index to hash the index instead of the working tree.
    // Pass --attested <rev>,<rev> to stamp only domains those commits already carried
    // correctly (see attestedIds); a domain left stale is named below and keeps its bytes.
    const changed = f['--base']
      ? new Set([...gitPaths(root, ['diff', '--name-only', '-z', f['--base'], '--']),
                 ...gitPaths(root, ['ls-files', '--others', '--exclude-standard', '-z'])])
      : null;
    const forceAll = Boolean(f['--all']);
    const wanted = [];
    for (const domain of manifest.domains) {
      const next = domain._computed;
      delete domain._computed;
      const inputs = domainInputs(snap, hub, domain);
      const inBaseScope = changed === null
        || inputs.sources.some((entry) => changed.has(entry))
        || inputs.contents.some((entry) => changed.has(entry));
      const drifted = domain.sourceDigest !== next.sourceDigest
        || domain.contentDigest !== next.contentDigest;
      if ((!f['--only'] || domain.id === f['--only']) && inBaseScope && (forceAll || drifted)) wanted.push({ domain, next, inputs });
    }
    const attested = revs ? attestedIds(root, revs, relative, hub, wanted.map((entry) => entry.domain)) : null;
    const stamps = wanted.filter((entry) => !attested || attested.has(entry.domain.id));
    for (const { domain, next } of stamps) {
      domain.sourceDigest = next.sourceDigest;
      domain.contentDigest = next.contentDigest;
    }
    const stale = wanted.filter((entry) => !stamps.includes(entry)).map((entry) => entry.domain.id);
    if (!f['--index'] && stamps.length) {
      const unstaged = unstagedInputs(root, stamps.map((entry) => entry.inputs));
      if (unstaged.length) console.error(`warn ${unstaged.length} unstaged path(s) fed these digests (${unstaged.slice(0, 3).join(', ')}${unstaged.length > 3 ? ', ...' : ''}); a commit takes the staged bytes, so stage them first or pass --index`);
    }
    atomicWrite(path, `${JSON.stringify(manifest, null, 2)}\n`);
    const scope = forceAll ? 'all' : (changed === null ? `${stamps.length} ${revs ? 'attested' : 'drifted'}` : `${stamps.length} changed vs ${f['--base']}`);
    console.log(`ok documentation manifest synced (${manifest.domains.length} domains, ${scope}${f['--only'] ? `, only ${f['--only']}` : ''}${f['--index'] ? ', index' : ''})`);
    if (stale.length) console.log(`left stale, not attested at ${revs.join(', ')}: ${stale.join(', ')}`);
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
