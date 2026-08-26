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
  const physicalRoot = realpathSync.native(root);
  const physicalAncestor = realpathSync.native(existingAncestor(target));
  if (!contained(physicalRoot, physicalAncestor, true)) throw new Error('path escapes repository through a link');
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
export function gitPaths(root, args) {
  return git(root, args, true).toString('utf8').split('\0').filter(Boolean).map(posix);
}
export function trackedPaths(root) { return gitPaths(root, ['ls-files', '-z']); }
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

export function validateCollection(collection, hub) {
  const keys = ['citations', 'collectionUuid', 'curationLedger', 'id', 'identityVersion', 'index', 'inventory', 'root', 'scopes'];
  if (!collection || Object.keys(collection).sort().join(',') !== keys.join(',')) throw new Error('record collection has an invalid shape');
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
  if (!Array.isArray(collection.scopes) || !collection.scopes.length) throw new Error(collection.id + ' needs scopes');
  for (const scope of collection.scopes) {
    if (!scope || Object.keys(scope).sort().join(',') !== 'kind,pattern,policy'
      || typeof scope.pattern !== 'string' || !scope.pattern || scope.pattern.includes('\\')
      || !VALID_PAIRS.has(scope.kind + ':' + scope.policy)) throw new Error('invalid scope in ' + collection.id);
  }
  return collection;
}
export function classify(collection, paths) {
  const prefix = collection.root + '/';
  const foldedPrefix = prefix.toLowerCase();
  const casingAliases = paths.filter((path) => path.toLowerCase().startsWith(foldedPrefix) && !path.startsWith(prefix));
  if (casingAliases.length) throw new Error(`collection root casing differs from Git index: ${casingAliases.join(', ')}`);
  return paths.filter((path) => path.startsWith(prefix)).map((path) => {
    const relativePath = path.slice(prefix.length);
    const candidates = collection.scopes.filter((scope) => matchGlob(scope.pattern, relativePath));
    return {
      path, relativePath, candidates,
      ...(candidates.length === 1 ? { kind: candidates[0].kind, policy: candidates[0].policy } : {}),
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
export function introductionCommit(root, path) {
  const commits = git(root, ['log', '--follow', '--diff-filter=A', '--format=%H', '--reverse', '--', path])
    .trim().split(/\s+/).filter(Boolean);
  if (!commits.length) throw new Error('required historical object is unavailable for ' + path);
  return commits[0];
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
    const line = git(root, ['ls-files', '--stage', '--', path]).trim().split(/\r?\n/)[0];
    const match = /^\d+\s+([0-9a-f]+)\s+\d+\t/.exec(line || '');
    if (!match) return null;
    const content = git(root, ['show', ':' + path], true);
    return { objectFormat: git(root, ['rev-parse', '--show-object-format']).trim(), blobOid: match[1], commitOid: null, path, targetSha256: sha256(content) };
  } catch { return null; }
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
function referenceLabel(label) { return label.trim().replace(/\s+/g, ' ').toLowerCase(); }
export function extractCitations(text) {
  const lines = text.split(/\r?\n/); const fenceScanned = []; let fence = null;
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!fence && marker) { fence = { character: marker[1][0], length: marker[1].length }; fenceScanned.push(' '.repeat(line.length)); continue; }
    const closing = fence && /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
    if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) {
      fence = null; fenceScanned.push(' '.repeat(line.length)); continue;
    }
    if (fence || /^(?: {4}|\t)/.test(line)) { fenceScanned.push(' '.repeat(line.length)); continue; }
    fenceScanned.push(line);
  }
  const scanned = maskCodeSpans(fenceScanned.join('\n')).split('\n');

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
