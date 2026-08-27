// Dependency-free primitives for durable documentation record collections.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';

export const RECORD_VERSION = 1;
export const FULL_ID_RE = /^REC-[A-Z2-7]{26}$/;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const VALID_PAIRS = new Set([
  'record:append-only', 'artifact:mutable', 'artifact:frozen', 'artifact:superseded',
  'executable:frozen', 'executable:superseded', 'forbidden:forbidden',
]);
const COLLECTION_KEYS = [
  'citations', 'collectionUuid', 'curationLedger', 'id', 'identityVersion', 'index', 'inventory', 'root', 'scopes',
];
const V1_SCOPE_KEYS = ['kind', 'pattern', 'policy'];
const V2_SCOPE_KEYS = ['id', 'kind', 'match', 'paths', 'policy'];
const MAX_HISTORY_PATHS = 10000;
const MAX_HISTORY_EVENTS = 250000;
const MAX_HISTORY_BATCH_PATHS = 128;
const MAX_HISTORY_COMMAND_UNITS = 24000;
const MAX_BLOB_BATCH_BYTES = 32 * 1024 * 1024;

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const canonical = (value) => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
export const digestJson = (value) => sha256(canonical(value));
export const posix = (value) => value.split(sep).join('/').normalize('NFC');
export const safePath = (value) => typeof value === 'string' && value.length > 0
  && value === value.normalize('NFC') && !value.startsWith('/') && !value.includes('\\')
  && !/^[A-Za-z]:/.test(value)
  && !value.startsWith('./') && !value.endsWith('/') && !value.includes('//')
  && !value.split('/').some((part) => part === '.' || part === '..' || part !== part.trim());

function sameNativePath(left, right) {
  const normalizedLeft = resolve(left); const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}
function contained(root, target, allowRoot = false) {
  const value = relative(root, target);
  return (allowRoot && value === '')
    || (value !== '' && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}
function existingAncestor(path) {
  let cursor = path;
  while (true) {
    try { lstatSync(cursor); return cursor; }
    catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error('path has no existing ancestor: ' + path);
      cursor = parent;
    }
  }
}
function assertPhysicalContainment(root, target) {
  const rootPhysical = realpathSync.native(root);
  const physicalAncestor = realpathSync.native(existingAncestor(target));
  if (!contained(rootPhysical, physicalAncestor, true)) throw new Error('path escapes repository through a link');
}

export function physicalRoot(value) {
  const root = resolve(value);
  try { return realpathSync.native(root); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('repository root does not exist: ' + root);
    if (error.code === 'ENOTDIR') throw new Error('repository root contains a non-directory component: ' + root);
    throw error;
  }
}

export function git(root, args, binary = false) {
  return execFileSync('git', args, {
    cwd: root, encoding: binary ? 'buffer' : 'utf8', timeout: 30000,
    maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function gitInput(root, args, input, binary = false, maxBuffer = 64 * 1024 * 1024) {
  return execFileSync('git', args, {
    cwd: root, input, encoding: binary ? 'buffer' : 'utf8', timeout: 30000,
    maxBuffer, stdio: ['pipe', 'pipe', 'pipe'],
  });
}
export function gitPaths(root, args) {
  return git(root, args, true).toString('utf8').split('\0').filter(Boolean).map(posix);
}
export function trackedPaths(root) { return gitPaths(root, ['ls-files', '-z']); }

export class GitStateError extends Error {}

function literalPath(path) { return `:(literal)${path}`; }
function oidInput(oids) { return Buffer.from(`${oids.join('\n')}\n`, 'ascii'); }

function blobMetadata(root, oids) {
  if (!oids.length) return [];
  let output;
  try {
    output = gitInput(root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], oidInput(oids));
  } catch (error) { throw new GitStateError(`git-state: Git subprocess failed while reading index state: ${error.message}`); }
  const lines = output.trim().split(/\r?\n/);
  if (lines.length !== oids.length) throw new GitStateError('git-state: malformed cat-file batch metadata');
  return lines.map((line, index) => {
    const match = /^([0-9a-f]+) (\S+) (\d+)$/.exec(line);
    if (!match || match[1] !== oids[index] || match[2] !== 'blob') {
      throw new GitStateError(`git-state: malformed cat-file batch response for ${oids[index]}`);
    }
    return { oid: match[1], size: Number(match[3]) };
  });
}

function blobBatches(metadata) {
  const batches = []; let batch = []; let bytes = 0;
  for (const entry of metadata) {
    if (batch.length && bytes + entry.size > MAX_BLOB_BATCH_BYTES) {
      batches.push(batch); batch = []; bytes = 0;
    }
    batch.push(entry); bytes += entry.size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function readBlobBatch(root, batch) {
  const expectedBytes = batch.reduce((total, entry) => total + entry.size + entry.oid.length + 32, 0);
  let output;
  try {
    output = gitInput(root, ['cat-file', '--batch'], oidInput(batch.map((entry) => entry.oid)), true,
      Math.max(64 * 1024 * 1024, expectedBytes + 1024));
  } catch (error) { throw new GitStateError(`git-state: Git subprocess failed while reading index state: ${error.message}`); }
  const blobs = new Map(); let offset = 0;
  for (const expected of batch) {
    const headerEnd = output.indexOf(10, offset);
    if (headerEnd < 0) throw new GitStateError(`git-state: malformed cat-file batch response for ${expected.oid}`);
    const header = output.subarray(offset, headerEnd).toString('ascii');
    const match = /^([0-9a-f]+) (\S+) (\d+)$/.exec(header);
    const size = match ? Number(match[3]) : -1;
    const contentStart = headerEnd + 1; const contentEnd = contentStart + size;
    if (!match || match[1] !== expected.oid || match[2] !== 'blob' || size !== expected.size
      || contentEnd >= output.length || output[contentEnd] !== 10) {
      throw new GitStateError(`git-state: malformed cat-file batch response for ${expected.oid}`);
    }
    const bytes = output.subarray(contentStart, contentEnd);
    blobs.set(expected.oid, { bytes: Buffer.from(bytes), targetSha256: sha256(bytes) });
    offset = contentEnd + 1;
  }
  if (offset !== output.length) throw new GitStateError('git-state: malformed trailing cat-file batch data');
  return blobs;
}

export function indexSnapshot(root, paths) {
  if (!Array.isArray(paths)) throw new GitStateError('git-state: requested paths must be an array');
  const requested = [...new Set(paths)].sort();
  for (const path of requested) if (!safePath(path)) throw new GitStateError(`git-state: invalid requested path: ${path}`);
  const rows = new Map(requested.map((path) => [path, []]));
  for (const batch of historyPathBatches(requested)) {
    let output;
    try { output = git(root, ['ls-files', '--stage', '-z', '--', ...batch.map(literalPath)], true); }
    catch (error) { throw new GitStateError(`git-state: Git subprocess failed while reading index state: ${error.message}`); }
    for (const record of output.toString('utf8').split('\0').filter(Boolean)) {
      const match = /^(\d+) ([0-9a-f]+) (\d+)\t([\s\S]+)$/.exec(record);
      if (!match) throw new GitStateError('git-state: malformed ls-files --stage record');
      const path = posix(match[4]);
      if (!rows.has(path)) throw new GitStateError(`git-state: unexpected index entry: ${path}`);
      rows.get(path).push({ mode: match[1], blobOid: match[2], stage: Number(match[3]) });
    }
  }
  const entries = new Map();
  for (const path of requested) {
    const matches = rows.get(path);
    if (!matches.length) throw new GitStateError(`git-state: missing stage-0 index entry: ${path}`);
    if (matches.length !== 1 || matches[0].stage !== 0) throw new GitStateError(`git-state: non-single or unmerged index entry: ${path}`);
    if (!['100644', '100755'].includes(matches[0].mode)) {
      throw new GitStateError(`git-state: unsupported Git index mode ${matches[0].mode}: ${path}`);
    }
    entries.set(path, matches[0]);
  }
  const oids = [...new Set([...entries.values()].map((entry) => entry.blobOid))].sort();
  const metadata = blobMetadata(root, oids);
  const oversized = metadata.find((entry) => entry.size > MAX_BLOB_BATCH_BYTES);
  if (oversized) {
    const path = [...entries].find(([, entry]) => entry.blobOid === oversized.oid)?.[0] || oversized.oid;
    throw new GitStateError(`git-state: blob exceeds ${MAX_BLOB_BATCH_BYTES}-byte limit: ${path}`);
  }
  const blobs = new Map();
  for (const batch of blobBatches(metadata)) for (const [oid, blob] of readBlobBatch(root, batch)) blobs.set(oid, blob);
  for (const [path, entry] of entries) Object.assign(entry, blobs.get(entry.blobOid));
  return entries;
}

export function dirtyIndexPaths(root, paths) {
  if (!Array.isArray(paths)) throw new GitStateError('git-state: requested paths must be an array');
  const requested = [...new Set(paths)].sort(); const dirty = new Set();
  for (const path of requested) if (!safePath(path)) throw new GitStateError(`git-state: invalid requested path: ${path}`);
  for (const batch of historyPathBatches(requested)) {
    let changed;
    try { changed = gitPaths(root, ['diff', '--name-only', '-z', '--', ...batch.map(literalPath)]); }
    catch (error) { throw new GitStateError(`git-state: Git subprocess failed while reading index state: ${error.message}`); }
    for (const path of changed) dirty.add(path);
  }
  return dirty;
}

export function filteredBlobOid(root, path, bytes) {
  if (!safePath(path)) throw new GitStateError(`git-state: invalid requested path: ${path}`);
  try {
    return (bytes === undefined
      ? git(root, ['hash-object', `--path=${path}`, '--', path])
      : gitInput(root, ['hash-object', `--path=${path}`, '--stdin'], bytes)).trim();
  } catch (error) { throw new GitStateError(`git-state: Git subprocess failed while filtering ${path}: ${error.message}`); }
}
export function nativePath(root, path) {
  if (!safePath(path)) throw new Error('unsafe path: ' + path);
  const absoluteRoot = resolve(root); const absolute = resolve(absoluteRoot, path);
  if (!contained(absoluteRoot, absolute)) throw new Error('path escapes repository');
  assertPhysicalContainment(absoluteRoot, absolute);
  return absolute;
}
export function relativeRoot(root, absolute) {
  const absoluteRoot = resolve(root); const target = resolve(absolute);
  if (!contained(absoluteRoot, target)) throw new Error('path escapes repository');
  assertPhysicalContainment(absoluteRoot, target);
  const value = posix(relative(absoluteRoot, target));
  if (!safePath(value)) throw new Error('path escapes repository');
  return value;
}
export function readJson(path, fallback) {
  if (!existsSync(path)) {
    if (arguments.length > 1) return fallback;
    throw new Error('missing JSON file: ' + path);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function base32(bytes) {
  let bits = 0; let value = 0; let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) output += BASE32[(value >>> (bits -= 5)) & 31];
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}
export function recordId(collectionUuid, gitPath) {
  if (typeof collectionUuid !== 'string' || !collectionUuid) throw new Error('collectionUuid is required');
  if (!safePath(gitPath)) throw new Error('invalid record path: ' + gitPath);
  const input = 'code-ops-record-v1\0' + collectionUuid + '\0' + gitPath;
  const digest = createHash('sha256').update(input, 'utf8').digest().subarray(0, 16);
  return 'REC-' + base32(digest);
}

function escapeRegex(character) {
  return '.+^$()|[]{}\\'.includes(character) ? '\\' + character : character;
}
export function matchGlob(pattern, candidate) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      index += 1;
      if (pattern[index + 1] === '/') { index += 1; source += '(?:.*/)?'; }
      else source += '.*';
    } else if (character === '*') source += '[^/]*';
    else if (character === '?') source += '[^/]';
    else source += escapeRegex(character);
  }
  return new RegExp('^' + source + '$', 'u').test(candidate.normalize('NFC'));
}

function shapeErrors(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${label} must be an object`];
  const errors = [];
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${label} has unknown key ${key}`);
  for (const key of keys) if (!(key in value)) errors.push(`${label} is missing ${key}`);
  return errors;
}

export function scopeValidationErrors(collection, tracked = null) {
  const errors = [];
  const declaredVersion = Object.hasOwn(collection || {}, 'classificationVersion');
  const version = declaredVersion ? collection.classificationVersion : 1;
  if (declaredVersion && version !== 2) errors.push('classificationVersion must be 2 when present');
  if (!Array.isArray(collection?.scopes) || !collection.scopes.length) return [...errors, 'needs scopes'];
  const ids = new Set(); const exactOwners = new Map();
  for (const [index, scope] of collection.scopes.entries()) {
    const label = `scope ${index + 1}`;
    if (version === 1) {
      const shape = shapeErrors(scope, V1_SCOPE_KEYS, label);
      if (shape.length) { errors.push(...shape); continue; }
      if (typeof scope.pattern !== 'string' || !scope.pattern || scope.pattern !== scope.pattern.normalize('NFC')
        || scope.pattern.startsWith('/') || scope.pattern.includes('\\')) errors.push(`${label} has an invalid pattern`);
      if (typeof scope.kind !== 'string' || typeof scope.policy !== 'string'
        || !VALID_PAIRS.has(`${scope.kind}:${scope.policy}`)) errors.push(`${label} has an invalid kind/policy pair`);
      continue;
    }
    const shape = shapeErrors(scope, V2_SCOPE_KEYS, label);
    if (shape.length) { errors.push(...shape); continue; }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(scope.id || '') || ids.has(scope.id)) errors.push(`${label} has an invalid or duplicate id`);
    else ids.add(scope.id);
    if (!Array.isArray(scope.match) || !Array.isArray(scope.paths) || (!scope.match.length && !scope.paths.length)) {
      errors.push(`${label} needs at least one match or path selector`);
    }
    if (Array.isArray(scope.match)) {
      if (new Set(scope.match).size !== scope.match.length) errors.push(`${label} has duplicate match selectors`);
      for (const pattern of scope.match) {
        if (typeof pattern !== 'string' || !pattern || pattern !== pattern.normalize('NFC')
          || pattern.startsWith('/') || pattern.includes('\\')) errors.push(`${label} has an invalid match selector`);
      }
    }
    if (Array.isArray(scope.paths)) {
      if (new Set(scope.paths).size !== scope.paths.length) errors.push(`${label} has duplicate path selectors`);
      for (const path of scope.paths) {
        if (!safePath(path) || /[*?]/.test(path)) { errors.push(`${label} has an invalid exact path selector`); continue; }
        if (exactOwners.has(path)) errors.push(`${label} duplicates exact path ${path} owned by ${exactOwners.get(path)}`);
        else exactOwners.set(path, scope.id);
      }
    }
    if (typeof scope.kind !== 'string' || typeof scope.policy !== 'string'
      || !VALID_PAIRS.has(`${scope.kind}:${scope.policy}`)) errors.push(`${label} has an invalid kind/policy pair`);
  }
  if (version === 2 && Array.isArray(tracked) && safePath(collection?.root)) {
    const trackedSet = new Set(tracked); const folded = new Map(tracked.map((path) => [path.toLowerCase(), path]));
    for (const scope of collection.scopes.filter((candidate) => Array.isArray(candidate?.paths))) {
      for (const relativePath of scope.paths) {
        if (!safePath(relativePath) || /[*?]/.test(relativePath)) continue;
        const fullPath = `${collection.root}/${relativePath}`;
        if (trackedSet.has(fullPath)) continue;
        const alias = folded.get(fullPath.toLowerCase());
        errors.push(alias ? `scope ${scope.id} exact path casing differs from Git index: ${alias}`
          : `scope ${scope.id} exact path is not tracked: ${relativePath}`);
      }
    }
  }
  return errors;
}

export function validateCollection(collection, hub) {
  const keys = [...COLLECTION_KEYS, ...(Object.hasOwn(collection || {}, 'classificationVersion') ? ['classificationVersion'] : [])];
  if (!collection || Object.keys(collection).sort().join(',') !== keys.sort().join(',')) throw new Error('record collection has an invalid shape');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(collection.id)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(collection.collectionUuid)
    || collection.identityVersion !== 1 || !safePath(collection.root) || !safePath(hub)) throw new Error('invalid collection ' + collection.id);
  for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
    if (!safePath(collection[key]) || !collection[key].startsWith('98 System/Records/')) {
      throw new Error(collection.id + ' has ' + key + ' outside 98 System/Records/');
    }
    const generated = `${hub}/${collection[key]}`;
    const foldedGenerated = generated.toLowerCase(); const foldedRoot = collection.root.toLowerCase();
    if (foldedGenerated === foldedRoot || foldedGenerated.startsWith(`${foldedRoot}/`)) {
      throw new Error(`${collection.id} generated ${key} overlaps its immutable root`);
    }
  }
  const scopeErrors = scopeValidationErrors(collection);
  if (scopeErrors.length) throw new Error(`invalid scope in ${collection.id}: ${scopeErrors.join('; ')}`);
  return collection;
}
export function classify(collection, paths) {
  const prefix = collection.root + '/';
  const foldedPrefix = prefix.toLowerCase();
  const casingAliases = paths.filter((path) => path.toLowerCase().startsWith(foldedPrefix) && !path.startsWith(prefix));
  if (casingAliases.length) throw new Error(`collection root casing differs from Git index: ${casingAliases.join(', ')}`);
  const scopeErrors = scopeValidationErrors(collection, paths);
  if (scopeErrors.length) throw new Error(`invalid scope in ${collection.id}: ${scopeErrors.join('; ')}`);
  const version = Object.hasOwn(collection, 'classificationVersion') ? collection.classificationVersion : 1;
  const ordered = version === 2
    ? [...collection.scopes].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    : null;
  return paths.filter((path) => path.startsWith(prefix)).map((path) => {
    const relativePath = path.slice(prefix.length);
    if (version === 1) {
      const candidates = collection.scopes.filter((scope) => matchGlob(scope.pattern, relativePath));
      return {
        path, relativePath, candidates,
        ...(candidates.length === 1 ? { kind: candidates[0].kind, policy: candidates[0].policy } : {}),
      };
    }
    const exact = ordered.filter((scope) => scope.paths.includes(relativePath));
    const globs = ordered.filter((scope) => !scope.paths.includes(relativePath)
      && scope.match.some((pattern) => matchGlob(pattern, relativePath)));
    const candidates = exact.length ? exact : globs;
    const resolution = exact.length ? 'exact-path' : 'glob';
    return {
      path, relativePath, candidates,
      matchedScopeIds: [...new Set([...exact, ...globs].map((scope) => scope.id))].sort(),
      ...(candidates.length === 1 ? {
        kind: candidates[0].kind, policy: candidates[0].policy, scopeId: candidates[0].id, resolution,
      } : {}),
    };
  });
}
export function classificationProblems(rows) {
  return rows.filter((row) => row.candidates.length !== 1 || row.kind === 'forbidden'
    || /(?:^|\/)__pycache__\/|\.pyc$/i.test(row.path));
}

export function completeHistory(root) {
  try {
    if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') return { ok: false, reason: 'shallow repository' };
  } catch { return { ok: false, reason: 'history configuration is unreadable' }; }
  try {
    if (git(root, ['config', '--get', 'extensions.partialclone']).trim()) return { ok: false, reason: 'partial repository' };
  } catch { /* absent is complete-compatible */ }
  try {
    const promisor = git(root, ['config', '--get-regexp', '^remote\\..*\\.promisor$']).trim();
    if (promisor.split(/\r?\n/).some((line) => /\s+true$/i.test(line))) return { ok: false, reason: 'promisor repository' };
  } catch { /* no promisor configuration */ }
  try {
    const missing = git(root, ['rev-list', '--objects', '--all', '--missing=print'])
      .split(/\r?\n/).some((line) => line.startsWith('?'));
    if (missing) return { ok: false, reason: 'required history objects are unavailable' };
  } catch { return { ok: false, reason: 'required history objects cannot be verified' }; }
  return { ok: true };
}
export function cleanWorktree(root) {
  return git(root, ['status', '--porcelain=v1', '--untracked-files=all']).trim() === '';
}
function parseHistory(output) {
  const tokens = output.split('\0'); const events = []; let commit = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]; const trimmed = token.trim();
    if (/^[0-9a-f]{40,64}$/.test(trimmed)) { commit = trimmed; continue; }
    const match = /^:[0-7]{6} [0-7]{6} ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(trimmed);
    if (!match || !commit || index + 1 >= tokens.length) continue;
    const oldPath = posix(tokens[++index]);
    const newPath = match[3] === 'R' && index + 1 < tokens.length ? posix(tokens[++index]) : oldPath;
    const row = { commit, oldBlobOid: match[1], newBlobOid: match[2], status: match[3], oldPath, newPath };
    const prior = events.at(-1);
    if (!prior || canonical(prior) !== canonical(row)) events.push(row);
  }
  return events;
}

function pathHistory(root, path, follow = false) {
  return parseHistory(git(root, [
    'log', '--topo-order', ...(follow ? ['--follow'] : []),
    '--diff-merges=first-parent', '--format=%H%x00', '--raw', '-z', '-M', '--no-abbrev',
    '--', `:(literal)${path}`,
  ], true).toString('utf8'));
}

function pathsHistory(root, paths) {
  return parseHistory(git(root, [
    'log', '--topo-order', '--diff-merges=first-parent', '--format=%H%x00', '--raw', '-z', '--no-renames', '--no-abbrev',
    '--', ...paths.map((path) => `:(literal)${path}`),
  ], true).toString('utf8'));
}

export function pathHasHistory(root, path) {
  if (!safePath(path)) throw new Error(`invalid history path: ${path}`);
  return Boolean(git(root, ['log', '--full-history', '--format=%H', '--', `:(literal)${path}`]).trim());
}

export function historyPathBatches(paths) {
  const batches = []; let batch = []; let commandUnits = 1024;
  for (const path of paths) {
    const argumentUnits = (`:(literal)${path}`).length * 2 + 3;
    if (batch.length && (batch.length >= MAX_HISTORY_BATCH_PATHS
      || commandUnits + argumentUnits > MAX_HISTORY_COMMAND_UNITS)) {
      batches.push(batch); batch = []; commandUnits = 1024;
    }
    batch.push(path); commandUnits += argumentUnits;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function repositoryHistory(root, rows) {
  const lineagePaths = new Set(rows.map((row) => row.path)); const discovered = new Map();
  for (const path of [...lineagePaths].sort()) {
    for (const event of pathHistory(root, path, true)) {
      discovered.set(canonical(event), event);
      if (event.status === 'R') { lineagePaths.add(event.oldPath); lineagePaths.add(event.newPath); }
      if (lineagePaths.size > MAX_HISTORY_PATHS) throw new Error(`record history profile exceeds ${MAX_HISTORY_PATHS} lineage paths`);
    }
  }
  const exactPaths = [...lineagePaths].sort();
  for (const batch of historyPathBatches(exactPaths)) {
    for (const event of pathsHistory(root, batch)) {
      discovered.set(canonical(event), event);
      if (discovered.size > MAX_HISTORY_EVENTS) throw new Error(`record history profile exceeds ${MAX_HISTORY_EVENTS} relevant events`);
    }
  }
  const commitRows = git(root, ['rev-list', '--topo-order', '--parents', 'HEAD']).trim().split(/\r?\n/)
    .filter(Boolean).map((line) => line.split(/\s+/));
  const commitOrder = new Map(commitRows.map(([commit], index) => [commit, index]));
  const commitParents = new Map(commitRows.map(([commit, ...parents]) => [commit, parents]));
  const events = [...discovered.values()];
  const renameAdds = new Set(); const renameDeletes = new Set();
  for (const event of events.filter((candidate) => candidate.status === 'R')) {
    renameAdds.add(canonical([event.commit, event.newPath, event.newBlobOid]));
    renameDeletes.add(canonical([event.commit, event.oldPath, event.oldBlobOid]));
  }
  const duplicateMergeAdds = new Set();
  for (const event of events.filter((candidate) => candidate.status === 'A')) {
    const parents = commitParents.get(event.commit) || [];
    if (parents.length < 2) continue;
    const inherited = parents.some((parent) => {
      try { return git(root, ['rev-parse', `${parent}:${event.newPath}`]).trim() === event.newBlobOid; }
      catch { return false; }
    });
    if (inherited) duplicateMergeAdds.add(canonical(event));
  }
  return events.filter((event) => !duplicateMergeAdds.has(canonical(event)) && (event.status === 'R'
    || (event.status === 'A' && !renameAdds.has(canonical([event.commit, event.newPath, event.newBlobOid])))
    || (event.status === 'D' && !renameDeletes.has(canonical([event.commit, event.oldPath, event.oldBlobOid])))
    || !['A', 'D'].includes(event.status)))
    .sort((left, right) => {
      const order = (commitOrder.get(left.commit) ?? Number.MAX_SAFE_INTEGER)
        - (commitOrder.get(right.commit) ?? Number.MAX_SAFE_INTEGER);
      return order || canonical(left).localeCompare(canonical(right));
    });
}

function stableHistoryEvents(root, events, blobDigests) {
  const contentDigest = (oid) => {
    if (/^0+$/.test(oid)) return null;
    if (!blobDigests.has(oid)) blobDigests.set(oid, sha256(git(root, ['cat-file', '-p', oid], true)));
    return blobDigests.get(oid);
  };
  return events.map((event) => ({
    status: event.status, oldPath: event.oldPath, newPath: event.newPath,
    oldSha256: contentDigest(event.oldBlobOid), newSha256: contentDigest(event.newBlobOid),
  })).sort((left, right) => canonical(left).localeCompare(canonical(right)));
}

export function adoptionHistoryProfiles(root, collection, rows, { allowUncommitted = false, indexed = null } = {}) {
  const immutable = rows.filter((candidate) => candidate.kind === 'record' || ['frozen', 'superseded'].includes(candidate.policy));
  const events = repositoryHistory(root, immutable); const profiles = new Map(); const blobDigests = new Map();
  const currentIndex = indexed || indexSnapshot(root, immutable.map((row) => row.path));
  for (const row of immutable) {
    const exactEvents = events.flatMap((event, eventIndex) => {
      if (event.status === 'R' && event.newPath === row.path) return [{ ...event, eventIndex, status: 'A', path: row.path, renamedFrom: event.oldPath }];
      if (event.status === 'R' && event.oldPath === row.path) {
        return [{ ...event, eventIndex, status: 'D', path: row.path, newBlobOid: '0'.repeat(event.newBlobOid.length), renamedTo: event.newPath }];
      }
      return event.status !== 'R' && event.newPath === row.path ? [{ ...event, eventIndex, path: row.path }] : [];
    });
    const admissionIndex = exactEvents.findIndex((event) => event.status === 'A');
    const currentTarget = currentIndex.get(row.path);
    if (!currentTarget) throw new Error(`record bytes unavailable from Git index: ${row.path}`);
    const headTarget = targetAt(root, 'HEAD', row.path);
    const indexDiffersFromHead = !headTarget || headTarget.blobOid !== currentTarget.blobOid;
    if (admissionIndex < 0) {
      if (allowUncommitted && indexDiffersFromHead) {
        profiles.set(row.path, {
          path: row.path, kind: row.kind, policy: row.policy, currentSha256: currentTarget.targetSha256,
          adoptionReadiness: 'pending-commit', reason: 'uncommitted-index-entry',
        });
        continue;
      }
      throw new Error(`record introduction is unresolvable for ${row.path}: no exact-path add event exists in current history`);
    }
    const currentEventRefs = exactEvents.slice(0, admissionIndex + 1);
    const lineageEventRefs = [...currentEventRefs];
    const lineageEventIndexes = new Set(currentEventRefs.map((event) => event.eventIndex));
    const lineagePaths = new Set([row.path]);
    let lineagePath = currentEventRefs.at(-1).renamedFrom || null;
    if (lineagePath) {
      lineagePaths.add(lineagePath);
      const admissionCommit = currentEventRefs.at(-1).commit;
      const admissionPosition = events.findIndex((event) => event.commit === admissionCommit
        && event.status === 'R' && event.newPath === row.path && event.oldPath === lineagePath);
      for (let eventIndex = admissionPosition + 1; eventIndex < events.length && lineagePath; eventIndex += 1) {
        const event = events[eventIndex];
        if (lineagePath && event.status === 'R' && event.newPath === lineagePath) {
          lineageEventRefs.push({ ...event, eventIndex, path: lineagePath });
          lineageEventIndexes.add(eventIndex);
          lineagePath = event.oldPath;
          lineagePaths.add(lineagePath);
          continue;
        }
        if (lineagePath && event.status !== 'R' && event.newPath === lineagePath) {
          lineageEventRefs.push({ ...event, eventIndex, path: lineagePath });
          lineageEventIndexes.add(eventIndex);
          if (event.status === 'A') lineagePath = null;
        }
      }
    }
    const stripEventIndex = ({ eventIndex: _eventIndex, ...event }) => event;
    const currentEvents = currentEventRefs.map(stripEventIndex);
    const lineageEvents = lineageEventRefs.map(stripEventIndex);
    const allPriorEvents = events.flatMap((event, eventIndex) => {
      if (lineageEventIndexes.has(eventIndex)) return [];
      const priorPath = [...lineagePaths].find((path) => event.oldPath === path || event.newPath === path);
      return priorPath ? [{ ...event, path: priorPath }] : [];
    });
    const contentChanged = lineageEvents.some((event) => event.status !== 'A'
      && event.oldBlobOid !== event.newBlobOid && !/^0+$/.test(event.newBlobOid));
    const baselineEvent = currentEvents.find((event) => event.newBlobOid === currentTarget.blobOid);
    if (!baselineEvent) {
      if (allowUncommitted && indexDiffersFromHead) {
        profiles.set(row.path, {
          path: row.path, kind: row.kind, policy: row.policy, currentSha256: currentTarget.targetSha256,
          adoptionReadiness: 'pending-commit', reason: 'uncommitted-index-entry',
        });
        continue;
      }
      throw new Error(`record baseline is unresolvable for ${row.path}: current index blob is absent from exact-path history`);
    }
    const history = {
      admittedCommit: currentEvents[admissionIndex].commit,
      baselineCommit: baselineEvent.commit,
      firstRelevantCommit: lineageEvents.at(-1).commit,
      lastRelevantCommit: lineageEvents[0].commit,
      contentTransitions: lineageEvents.filter((event) => event.status !== 'A'
        && event.oldBlobOid !== event.newBlobOid && !/^0+$/.test(event.newBlobOid)).length,
      priorIncarnations: allPriorEvents.filter((event) => event.status === 'A'
        || (event.status === 'R' && event.newPath === event.path)).length,
    };
    const historyDigest = digestJson({
      path: row.path,
      lineageEvents: stableHistoryEvents(root, lineageEvents, blobDigests),
      priorEvents: stableHistoryEvents(root, allPriorEvents, blobDigests),
    });
    const adoptionReadiness = contentChanged || allPriorEvents.length ? 'review-required' : 'ready';
    profiles.set(row.path, {
      path: row.path, kind: row.kind, policy: row.policy, currentSha256: currentTarget.targetSha256,
      history, historyDigest, adoptionReadiness,
      reason: allPriorEvents.length ? 'deleted-readded' : contentChanged ? 'historically-revised' : 'stable-so-far',
    });
  }
  return profiles;
}
export function treePathsAt(root, commit) {
  return gitPaths(root, ['ls-tree', '-r', '-z', '--name-only', commit]);
}
export function targetAt(root, commit, path) {
  try {
    const blobOid = git(root, ['rev-parse', commit + ':' + path]).trim();
    const content = git(root, ['cat-file', '-p', blobOid], true);
    return { objectFormat: git(root, ['rev-parse', '--show-object-format']).trim(), blobOid, commitOid: commit, path, targetSha256: sha256(content) };
  } catch { return null; }
}
export function targetAtIndex(root, path) {
  try {
    const entry = indexSnapshot(root, [path]).get(path);
    return {
      objectFormat: git(root, ['rev-parse', '--show-object-format']).trim(), blobOid: entry.blobOid,
      commitOid: null, path, targetSha256: entry.targetSha256,
    };
  } catch (error) {
    if (error instanceof GitStateError && error.message.startsWith('git-state: missing stage-0 index entry:')) return null;
    throw error;
  }
}
export function findBlobByDigest(root, digest) {
  const rows = git(root, ['rev-list', '--objects', '--all', '--missing=print']).split(/\r?\n/)
    .filter((line) => line && !line.startsWith('?')).sort();
  const seen = new Set();
  for (const row of rows) {
    const [oid, ...pathParts] = row.split(' ');
    if (seen.has(oid)) continue;
    seen.add(oid);
    try {
      if (git(root, ['cat-file', '-t', oid]).trim() !== 'blob') continue;
      const content = git(root, ['cat-file', '-p', oid], true);
      if (sha256(content) === digest) return {
        objectFormat: git(root, ['rev-parse', '--show-object-format']).trim(),
        blobOid: oid, commitOid: null, path: pathParts.join(' ') || null, targetSha256: digest,
      };
    } catch { /* another object may still resolve */ }
  }
  return null;
}
export function historicalTarget(root, path, boundCommit) {
  let commits = [];
  try { commits = git(root, ['rev-list', boundCommit, '--', path]).trim().split(/\s+/).filter(Boolean); } catch { return null; }
  const candidates = [];
  for (const commit of commits) {
    const target = targetAt(root, commit, path);
    if (target) candidates.push(target);
  }
  const maximal = candidates.filter((candidate) => !candidates.some((other) => {
    if (candidate.commitOid === other.commitOid) return false;
    try { git(root, ['merge-base', '--is-ancestor', candidate.commitOid, other.commitOid]); return true; }
    catch { return false; }
  }));
  const byDigest = new Map();
  for (const target of maximal.sort((left, right) => left.commitOid.localeCompare(right.commitOid))) {
    if (!byDigest.has(target.targetSha256)) byDigest.set(target.targetSha256, target);
  }
  const targets = [...byDigest.values()].sort((left, right) => left.targetSha256.localeCompare(right.targetSha256));
  if (!targets.length) return null;
  return targets.length === 1 ? targets[0] : { ambiguous: true, targets };
}

const ACCESSOR = /\[(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d+)\](?=(?:#|::|$))/;
const RANGE = /(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)(?=(?:#(?!L\d)|$))/;
const SYMBOL = /::[A-Za-z_$][\w$.:/-]*(?=(?:#|$))/;
export function normalizeCitation(raw, knownPaths) {
  const original = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(original) || original.startsWith('//')) {
    return { rawTarget: raw, normalizedTarget: original, resolvedVia: [], state: 'external', matches: [] };
  }
  const known = new Set(knownPaths);
  if (known.has(original)) return { rawTarget: raw, normalizedTarget: original, resolvedVia: ['exact'], state: 'resolved', matches: [original] };
  let candidate = original; const resolvedVia = [];
  let changed = true;
  while (changed) {
    changed = false;
    if (ACCESSOR.test(candidate)) { candidate = candidate.replace(ACCESSOR, ''); resolvedVia.push('accessor-stripped'); changed = true; continue; }
    if (RANGE.test(candidate)) { candidate = candidate.replace(RANGE, ''); resolvedVia.push('range-stripped'); changed = true; continue; }
    if (SYMBOL.test(candidate)) { candidate = candidate.replace(SYMBOL, ''); resolvedVia.push('symbol-stripped'); changed = true; continue; }
    if (/#.+$/.test(candidate)) { candidate = candidate.replace(/#.+$/, ''); resolvedVia.push('fragment-stripped'); changed = true; }
  }
  const glob = /[*?]/.test(candidate);
  const matches = glob ? [...known].filter((path) => matchGlob(candidate, path)) : known.has(candidate) ? [candidate] : [];
  if (glob) resolvedVia.push('glob-expanded');
  return {
    rawTarget: raw, normalizedTarget: candidate, resolvedVia,
    state: glob ? 'glob' : matches.length === 1 ? 'resolved' : matches.length > 1 ? 'ambiguous' : 'dead-at-adoption',
    matches,
  };
}
export function resolveCitation(raw, sourcePath, knownPaths) {
  const direct = normalizeCitation(raw, knownPaths);
  if (direct.state !== 'dead-at-adoption' || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return direct;
  if (!/^\.\.?\//.test(direct.normalizedTarget)) return direct;
  const parts = dirname(sourcePath).split(/[\\/]/).filter((part) => part && part !== '.');
  for (const part of direct.normalizedTarget.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  const joined = parts.join('/');
  const matches = /[*?]/.test(joined) ? knownPaths.filter((path) => matchGlob(joined, path))
    : knownPaths.includes(joined) ? [joined] : [];
  return {
    ...direct, normalizedTarget: joined,
    state: matches.length === 1 ? 'resolved' : matches.length > 1 ? 'glob' : 'dead-at-adoption',
    matches,
  };
}
function escapedAt(text, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}
function nextCodeTick(text, from) {
  let index = text.indexOf('`', from);
  while (index >= 0 && escapedAt(text, index)) index = text.indexOf('`', index + 1);
  return index;
}
function codeSpanRanges(text) {
  const ranges = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = nextCodeTick(text, cursor);
    if (start < 0) break;
    let endTick = start;
    while (text[endTick] === '`') endTick += 1;
    const ticks = text.slice(start, endTick); let end = -1; let search = endTick;
    while (search < text.length) {
      const candidate = text.indexOf(ticks, search);
      if (candidate < 0) break;
      if (!escapedAt(text, candidate) && text[candidate - 1] !== '`' && text[candidate + ticks.length] !== '`') { end = candidate; break; }
      search = candidate + ticks.length;
    }
    if (end < 0) { cursor = endTick; continue; }
    ranges.push([start, end + ticks.length]);
    cursor = end + ticks.length;
  }
  return ranges;
}
export function isInsideCodeSpan(text, index) {
  return codeSpanRanges(text).some(([start, end]) => index >= start && index < end);
}
export function maskCodeSpans(text) {
  let masked = '';
  let cursor = 0;
  for (const [start, end] of codeSpanRanges(text)) {
    masked += text.slice(cursor, start);
    masked += text.slice(start, end).replace(/[^\r\n]/g, ' ');
    cursor = end;
  }
  return masked + text.slice(cursor);
}

function stripBlockquoteMarkers(raw, limit = Number.POSITIVE_INFINITY) {
  let rest = raw; let depth = 0;
  while (depth < limit) {
    const marker = /^ {0,3}>[ \t]?/.exec(rest);
    if (!marker) break;
    rest = rest.slice(marker[0].length); depth += 1;
  }
  return { depth, rest };
}

function endColumn(value, startColumn = 0) {
  let columns = startColumn;
  for (const character of value) {
    if (character === ' ') columns += 1;
    else if (character === '\t') columns += 4 - (columns % 4);
    else break;
  }
  return columns;
}

function stripIndentColumns(line, requiredColumns) {
  let columns = 0; let offset = 0;
  while (offset < line.length && columns < requiredColumns) {
    if (line[offset] === ' ') columns += 1;
    else if (line[offset] === '\t') columns += 4 - (columns % 4);
    else return null;
    offset += 1;
  }
  if (columns < requiredColumns) return null;
  return `${' '.repeat(columns - requiredColumns)}${line.slice(offset)}`;
}

function markdownListItem(line) {
  const marker = /^( {0,3})([-+*]|\d{1,9}[.)])([ \t]*)(.*)$/.exec(line);
  if (!marker || (marker[3] === '' && marker[4] !== '')) return null;
  const markerEnd = marker[1].length + marker[2].length;
  const spacingColumns = endColumn(marker[3], markerEnd) - markerEnd;
  if (marker[4] !== '' && spacingColumns === 0) return null;
  const consumedSpacing = spacingColumns > 4 ? marker[3].slice(0, 1) : marker[3];
  const content = spacingColumns > 4
    ? `${marker[3].slice(consumedSpacing.length)}${marker[4]}` : marker[4];
  return {
    content,
    contentIndent: consumedSpacing === '' ? markerEnd + 1 : endColumn(consumedSpacing, markerEnd),
    orderedStart: /^\d/.test(marker[2]) ? Number.parseInt(marker[2], 10) : null,
  };
}

function listLine(line, current, atBlockBoundary) {
  let topLevel = markdownListItem(line);
  if (topLevel && !current && !atBlockBoundary
      && (topLevel.content.trim() === ''
        || (topLevel.orderedStart !== null && topLevel.orderedStart !== 1))) topLevel = null;
  if (topLevel) {
    const indents = [topLevel.contentIndent]; let candidate = topLevel.content;
    while (true) {
      const nested = markdownListItem(candidate);
      if (!nested) return { candidate, indents };
      indents.push(indents.at(-1) + nested.contentIndent); candidate = nested.content;
    }
  }
  if (!current || line.trim() === '') return { candidate: line, indents: current?.indents || [] };
  for (let index = current.indents.length - 1; index >= 0; index -= 1) {
    const parentIndent = current.indents[index]; const stripped = stripIndentColumns(line, parentIndent);
    if (stripped === null) continue;
    const indents = current.indents.slice(0, index + 1); let candidate = stripped;
    while (true) {
      const nested = markdownListItem(candidate);
      if (!nested) return { candidate, indents };
      indents.push(indents.at(-1) + nested.contentIndent); candidate = nested.content;
    }
  }
  return { candidate: line, indents: [] };
}

// Mask fenced Markdown blocks only. Inline spans and indented content stay
// visible so fail-closed prose validators cannot silently miss identifiers.
// Container-scoped fences close when their blockquote or list container ends.
export function maskMarkdownFencedBlocks(text, sourcePath = null) {
  const lines = text.split(/\r?\n/); const masked = [];
  let fence = null; let list = null; let previousBlank = true; let previousQuoteDepth = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (fence) {
      const quoted = stripBlockquoteMarkers(raw, fence.quoteDepth);
      let candidate = quoted.rest; let insideContainer = quoted.depth === fence.quoteDepth;
      if (insideContainer && fence.listIndents.length > 0 && candidate.trim() !== '') {
        const stripped = stripIndentColumns(candidate, fence.listIndent);
        insideContainer = stripped !== null;
        if (insideContainer) candidate = stripped;
      }
      if (insideContainer) {
        const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(candidate);
        if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
        masked.push(' '.repeat(raw.length)); previousBlank = true; continue;
      }
      const parentIndents = fence.listIndents.slice(0, -1);
      list = quoted.depth === fence.quoteDepth && parentIndents.length > 0
        ? { quoteDepth: fence.quoteDepth, indents: parentIndents } : null;
      fence = null;
    }

    const quote = stripBlockquoteMarkers(raw);
    const quoteDepth = quote.depth; let candidate = quote.rest; let listIndent = null;
    if (list && list.quoteDepth !== quoteDepth) list = null;
    const parsedList = listLine(candidate, list, previousBlank || quoteDepth !== previousQuoteDepth);
    candidate = parsedList.candidate;
    list = parsedList.indents.length > 0 ? { quoteDepth, indents: parsedList.indents } : null;
    if (list) listIndent = list.indents.at(-1);
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(candidate);
    const validMarker = marker && !(marker[1][0] === '`' && marker[2].includes('`'));
    if (validMarker) {
      fence = {
        character: marker[1][0], length: marker[1].length, quoteDepth,
        listIndent, listIndents: list?.indents || [], sourceLine: index + 1,
      };
      masked.push(' '.repeat(raw.length)); previousBlank = true; previousQuoteDepth = quoteDepth; continue;
    }
    masked.push(raw); previousBlank = candidate.trim() === ''; previousQuoteDepth = quoteDepth;
  }
  if (fence && fence.quoteDepth === 0 && fence.listIndents.length === 0) {
    const location = sourcePath ? ` in ${sourcePath}:${fence.sourceLine}` : ` at line ${fence.sourceLine}`;
    throw new Error(`unterminated Markdown fence${location}`);
  }
  return { maskedText: masked.join('\n') };
}

// Prefix validation masks indentation only at an unambiguous top-level block
// boundary. List content and indentation after non-blank prose stay visible.
export function maskMarkdownFenceAndTopLevelIndentBlocks(text, sourcePath = null) {
  const { maskedText } = maskMarkdownFencedBlocks(text, sourcePath);
  const lines = maskedText.split('\n'); const masked = [];
  let previousBlank = true; let listOpen = false; let previousQuoteDepth = 0;
  for (const raw of lines) {
    const quote = /^ {0,3}(?:>[ \t]?)+/.exec(raw);
    const quoteDepth = quote ? (quote[0].match(/>/g) || []).length : 0;
    const line = quote ? raw.slice(quote[0].length) : raw;
    const blank = line.trim() === '';
    const indented = /^(?: {4,}|\t)/.test(line);
    if (quoteDepth !== previousQuoteDepth) listOpen = false;
    if (!blank && indented && previousBlank && !listOpen) masked.push(' '.repeat(raw.length));
    else masked.push(raw);
    if (!blank && !indented) listOpen = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/.test(line);
    previousBlank = blank; previousQuoteDepth = quoteDepth;
  }
  return { maskedText: masked.join('\n') };
}

// Citation syntax keeps its established indented-block exclusion. Prefix
// validation uses the narrower top-level helper so ambiguous indentation stays
// visible in the gate's fail-closed direction.
export function maskMarkdownFenceAndIndentBlocks(text, sourcePath = null) {
  const { maskedText } = maskMarkdownFencedBlocks(text, sourcePath);
  return { maskedText: maskedText.split('\n')
    .map((line) => (/^(?: {4}|\t)/.test(line) ? ' '.repeat(line.length) : line)).join('\n') };
}

function referenceLabel(label) { return label.trim().replace(/\s+/g, ' ').toLowerCase(); }
export function extractCitations(text, sourcePath = null) {
  const { maskedText } = maskMarkdownFenceAndIndentBlocks(text, sourcePath);
  const scanned = maskCodeSpans(maskedText).split('\n');

  const definitions = new Map(); const definitionLines = new Set();
  for (let index = 0; index < scanned.length; index += 1) {
    const match = /^ {0,3}\[([^\]]+)\]:[ \t]*(?:<([^>\n]+)>|([^\s]+))(?:[ \t]+.*)?$/.exec(scanned[index]);
    if (!match) continue;
    const label = referenceLabel(match[1]);
    if (!definitions.has(label)) definitions.set(label, (match[2] || match[3]).replace(/^<|>$/g, ''));
    definitionLines.add(index);
  }

  const found = [];
  for (let index = 0; index < scanned.length; index += 1) {
    const line = scanned[index]; let match;
    const inline = /!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g;
    while ((match = inline.exec(line))) {
      const bracket = match.index + (line[match.index] === '!' ? 1 : 0);
      if (escapedAt(line, bracket)) continue;
      found.push({ sourceLine: index + 1, rawTarget: match[1].replace(/^<|>$/g, '') });
    }
    if (definitionLines.has(index)) continue;
    const reference = /!?\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g;
    while ((match = reference.exec(line))) {
      const bracket = match.index + (line[match.index] === '!' ? 1 : 0);
      if (escapedAt(line, bracket)) continue;
      if (line[match.index + match[0].length] === '(') continue;
      const label = referenceLabel(match[2] === undefined || match[2] === '' ? match[1] : match[2]);
      const target = definitions.get(label);
      if (target) found.push({ sourceLine: index + 1, rawTarget: target });
    }
  }
  return found;
}

export function readJsonl(path) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  if (text && !text.endsWith('\n')) throw new Error('curation ledger must end with a newline');
  return text.split('\n').filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch { throw new Error('invalid curation JSONL at line ' + (index + 1)); }
  });
}
export function jsonl(events) { return events.map((event) => canonical(event) + '\n').join(''); }
export function validateLedger(events, collectionUuid) {
  let previous = null; const perRecord = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]; const priorRecord = perRecord.get(event.recordId) || null;
    if (event.collectionUuid !== collectionUuid || event.sequence !== index + 1
      || event.previousEventDigest !== previous || event.previousRecordEventDigest !== priorRecord
      || !event.state || typeof event.state !== 'object' || Array.isArray(event.state)) {
      throw new Error('curation ledger predecessor chain is invalid');
    }
    const copy = { ...event }; delete copy.eventDigest;
    const digest = digestJson(copy);
    if (event.eventDigest !== digest) throw new Error('curation ledger event digest mismatch');
    previous = digest; perRecord.set(event.recordId, digest);
  }
  return previous;
}
export function foldedCuration(events) {
  const state = new Map();
  for (const event of events) state.set(event.recordId, event.state);
  return state;
}
export function inventorySemantic(inventory, events = []) {
  const curation = foldedCuration(events);
  return (inventory.entries || []).map((entry) => ({
    id: entry.id, identityVersion: entry.identityVersion, path: entry.path,
    provenance: entry.provenance, sha256: entry.sha256,
    supersedes: entry.provenance === 'native' ? entry.supersedes : null,
    state: curation.get(entry.id) || null,
  })).sort((left, right) => left.id.localeCompare(right.id));
}
export function indexSemantic(collection, inventory, events = []) {
  return { generatorVersion: 1, collectionUuid: collection.collectionUuid, records: inventorySemantic(inventory, events) };
}
export function renderIndex(collection, hub, inventory, events = []) {
  const semantic = indexSemantic(collection, inventory, events); const digest = digestJson(semantic);
  const from = dirname(hub + '/' + collection.index);
  const rows = semantic.records.map((record) => {
    const target = posix(relative(from, record.path));
    const state = record.state ? ' — ' + JSON.stringify(record.state) : '';
    return '<a id="' + record.id + '"></a>\n- [' + record.id + '](<' + encodeURI(target) + '>)' + state;
  });
  return '<!-- records-generator: 1; semantic-digest: ' + digest + ' -->\n# ' + collection.id
    + ' records\n\n' + rows.join('\n') + '\n';
}
export function verifyIndex(text, collection, inventory, events = []) {
  const expectedDigest = digestJson(indexSemantic(collection, inventory, events));
  const header = /records-generator:\s*(\d+);\s*semantic-digest:\s*([0-9a-f]{64})/.exec(text);
  if (!header || Number(header[1]) !== 1 || header[2] !== expectedDigest) throw new Error('semantic index drift');
  const anchors = [...text.matchAll(/<a id="(REC-[A-Z2-7]{26})"><\/a>/g)].map((match) => match[1]).sort();
  const expected = inventorySemantic(inventory, events).map((record) => record.id).sort();
  if (canonical(anchors) !== canonical(expected)) throw new Error('semantic index anchors drift');
}

export function citationAuthority(entry) {
  const copy = structuredClone(entry);
  if (copy.target) copy.target = { targetSha256: copy.target.targetSha256 };
  return copy;
}
export function resolvePrefix(prefix, ids) {
  if (!/^REC-[A-Z2-7]{8,26}$/.test(prefix)) throw new Error('invalid record prefix ' + prefix);
  const matches = ids.filter((id) => id.startsWith(prefix));
  if (matches.length !== 1) throw new Error('record prefix ' + prefix + ' is ' + (matches.length ? 'ambiguous' : 'unresolved'));
  return matches[0];
}

export function atomicWrite(path, text) { writeAtomically([[path, text]]); }
function pathKey(path) { return process.platform === 'win32' ? path.toLowerCase() : path; }
function pathState(path) {
  try { return lstatSync(path); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}
function assertNoSymlinkComponents(path) {
  const absolute = resolve(path); const parsed = parse(absolute);
  const parts = absolute.slice(parsed.root.length).split(sep).filter(Boolean);
  let cursor = parsed.root;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = resolve(cursor, parts[index]);
    const state = pathState(cursor);
    if (!state) continue;
    if (state.isSymbolicLink()) throw new Error('atomic path contains a symbolic link: ' + cursor);
    if (index < parts.length - 1 && !state.isDirectory()) throw new Error('atomic path component is not a directory: ' + cursor);
  }
}
function assertResolvedParent(path) {
  const parent = dirname(path); const physicalParent = realpathSync.native(parent);
  if (!sameNativePath(parent, physicalParent)
    || !sameNativePath(path, resolve(physicalParent, basename(path)))) {
    throw new Error('atomic destination escapes its resolved parent: ' + path);
  }
}
export function writeAtomically(entries) {
  const destinations = []; const prepared = []; const replaced = new Set();
  try {
    if (!Array.isArray(entries) || entries.some((entry) => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string')) {
      throw new Error('atomic entries must be [absolute path, content] pairs');
    }
    const seen = new Set();
    for (const [rawPath, text] of entries) {
      const path = resolve(rawPath);
      if (!isAbsolute(rawPath) || !sameNativePath(rawPath, path)) throw new Error('atomic destination must be an absolute normalized path: ' + rawPath);
      const key = pathKey(path);
      if (seen.has(key)) throw new Error('duplicate atomic destination: ' + path);
      seen.add(key); assertNoSymlinkComponents(path);
      const state = pathState(path);
      if (state && !state.isFile()) throw new Error('atomic destination is not a file: ' + path);
      destinations.push({ path, text, existed: Boolean(state) });
    }
    for (let left = 0; left < destinations.length; left += 1) {
      for (let right = left + 1; right < destinations.length; right += 1) {
        if (contained(destinations[left].path, destinations[right].path)
          || contained(destinations[right].path, destinations[left].path)) {
          throw new Error('atomic destinations cannot contain one another');
        }
      }
    }
    for (const destination of destinations) {
      const { path, text, existed } = destination; const parent = dirname(path);
      assertNoSymlinkComponents(path);
      mkdirSync(parent, { recursive: true });
      assertNoSymlinkComponents(path); assertResolvedParent(path);
      const state = pathState(path);
      if (Boolean(state) !== existed || (state && !state.isFile())) throw new Error('atomic destination changed during preparation: ' + path);
      const transactionDir = mkdtempSync(resolve(parent, '.records-atomic-'));
      const temp = resolve(transactionDir, 'new'); const backup = resolve(transactionDir, 'old');
      const item = { path, temp, backup, transactionDir, existed };
      prepared.push(item);
      assertNoSymlinkComponents(temp); assertResolvedParent(temp);
      writeFileSync(temp, text, { flag: 'wx' });
      if (existed) copyFileSync(path, backup);
    }
    for (const item of prepared) {
      assertNoSymlinkComponents(item.path); assertResolvedParent(item.path);
      assertNoSymlinkComponents(item.temp); assertResolvedParent(item.temp);
      const state = pathState(item.path);
      if (Boolean(state) !== item.existed || (state && !state.isFile())) throw new Error('atomic destination changed before replacement: ' + item.path);
      renameSync(item.temp, item.path); replaced.add(item.path);
    }
    for (const item of prepared) {
      try { rmSync(item.transactionDir, { recursive: true, force: true }); }
      catch (error) { console.warn('records: warning: committed write left transaction files for manual cleanup: ' + item.transactionDir + ' (' + error.code + ')'); }
    }
  } catch (error) {
    let rollbackError = null;
    for (const item of [...prepared].reverse()) {
      try {
        if (!replaced.has(item.path)) continue;
        if (item.existed && existsSync(item.backup)) renameSync(item.backup, item.path);
        else if (!item.existed) rmSync(item.path, { force: true });
      } catch (rollbackFailure) { rollbackError ||= rollbackFailure; }
    }
    if (rollbackError) throw new AggregateError([error, rollbackError], 'atomic write failed and rollback was incomplete; backup files were preserved');
    for (const item of prepared) {
      try { rmSync(item.transactionDir, { recursive: true, force: true }); }
      catch (cleanupError) { console.warn('records: warning: failed transaction cleanup: ' + item.transactionDir + ' (' + cleanupError.code + ')'); }
    }
    throw error;
  }
}
