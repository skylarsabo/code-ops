// Dependency-free primitives shared by the repository context compiler.
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTEXT_INDEX_VERSION = 1;
const MAX_BUFFER = 64 * 1024 * 1024;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const digestJson = (value) => sha256(canonical(value));

export function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'buffer',
    timeout: 10000,
    maxBuffer: MAX_BUFFER,
  });
}

export function gitText(root, args) {
  return git(root, args).toString('utf8').trim();
}

export function gitPaths(root, args) {
  return git(root, args).toString('utf8').split('\0').filter(Boolean).map(toPosix);
}

export function toPosix(value) {
  return value.split(sep).join('/');
}

export function portableKey(value) {
  return value.normalize('NFC').toLowerCase();
}

export function samePhysicalFile(first, second) {
  if (!existsSync(first) || !existsSync(second)) return false;
  // Windows file IDs routinely exceed Number.MAX_SAFE_INTEGER. Keep device and
  // inode values lossless so distinct files cannot alias after number rounding.
  const firstStat = statSync(first, { bigint: true });
  const secondStat = statSync(second, { bigint: true });
  return portableKey(realpathSync.native(first)) === portableKey(realpathSync.native(second))
    || (firstStat.dev === secondStat.dev && firstStat.ino === secondStat.ino);
}

export function assertNoAmbiguousIndexFlags(root) {
  const ambiguous = [];
  for (const entry of git(root, ['ls-files', '-v', '-z']).toString('utf8').split('\0')) {
    if (!entry) continue;
    if (entry.length < 3 || entry[1] !== ' ') throw new Error('malformed Git index flag output');
    if (/^[a-zSM]$/.test(entry[0])) ambiguous.push(toPosix(entry.slice(2)));
  }
  if (ambiguous.length) {
    const sample = ambiguous.slice(0, 5).join(', ');
    const remainder = ambiguous.length > 5 ? ` (+${ambiguous.length - 5} more)` : '';
    throw new Error(`ambiguous Git index flags must be cleared before reading worktree state: ${sample}${remainder}`);
  }
}

export function assertNoTrackedPortableAlias(root, path, label = 'path') {
  const key = portableKey(toPosix(path));
  const match = gitPaths(root, ['--literal-pathspecs', 'ls-files', '-z'])
    .find((tracked) => portableKey(tracked) === key);
  if (match) throw new Error(`${label} must not portably alias tracked Git path: ${match}`);
}

export function assertNoSymlinkComponents(root, absolute, label = 'path') {
  const lexical = relative(resolve(root), resolve(absolute));
  if (lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    throw new Error(`${label} must stay inside the repository`);
  }
  let cursor = resolve(root);
  for (const component of lexical.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, component);
    if (!existsSync(cursor)) break;
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`${label} must not contain symbolic-link components`);
  }
}

export function assertTrackedStage0RegularFiles(root, paths, label = 'path') {
  const entries = new Map();
  const raw = git(root, ['--literal-pathspecs', 'ls-files', '--stage', '-z', '--', ...paths]).toString('utf8');
  for (const record of raw.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t');
    const header = separator === -1 ? null : /^([0-7]{6}) ([0-9a-f]+) ([0-3])$/.exec(record.slice(0, separator));
    if (!header) throw new Error('malformed Git stage entry');
    const path = toPosix(record.slice(separator + 1));
    const candidates = entries.get(path) || [];
    candidates.push({ mode: header[1], stage: Number(header[3]) });
    entries.set(path, candidates);
  }
  for (const path of paths) {
    const candidates = entries.get(path) || [];
    if (candidates.length !== 1 || candidates[0].stage !== 0 || !['100644', '100755'].includes(candidates[0].mode)) {
      throw new Error(`${label} must name a regular Git stage-0 file: ${path}`);
    }
    const absolute = checkedPath(root, path);
    assertNoSymlinkComponents(root, absolute, label);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
      throw new Error(`${label} must name a regular worktree file: ${path}`);
    }
  }
}

export function safeRelative(value) {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && !isAbsolute(value)
    && !value.includes('\\')
    && !value.startsWith('./')
    && !value.endsWith('/')
    && !value.includes('//')
    && !value.split('/').includes('..');
}

export function checkedPath(root, path) {
  if (!safeRelative(path)) throw new Error(`unsafe relative path: ${path}`);
  const absolute = resolve(root, path);
  const rootReal = realpathSync.native(root);
  let cursor = existsSync(absolute) ? absolute : dirname(absolute);
  while (!existsSync(cursor) && dirname(cursor) !== cursor) cursor = dirname(cursor);
  const cursorReal = realpathSync.native(cursor);
  if (cursorReal !== rootReal && !cursorReal.startsWith(`${rootReal}${sep}`)) {
    throw new Error(`path escapes root: ${path}`);
  }
  return absolute;
}

export function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseNameStatus(root, args) {
  const fields = git(root, [...args, '-z']).toString('utf8').split('\0');
  const records = [];
  for (let index = 0; index < fields.length - 1;) {
    const status = fields[index++];
    if (!status) continue;
    const code = status.slice(0, 1);
    if (!fields[index]) throw new Error('malformed git name-status output');
    const first = fields[index++];
    const path = code === 'R' || code === 'C' ? fields[index++] : first;
    if (!path) throw new Error('malformed git rename/copy output');
    records.push({ status, path: toPosix(path) });
  }
  return records;
}

function untrackedState(root, policy, allowlist) {
  const paths = gitPaths(root, ['ls-files', '--others', '--exclude-standard', '-z']).sort();
  const all = [];
  for (const path of paths) {
    const absolute = checkedPath(root, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(absolute);
      const resolvedTarget = resolve(dirname(absolute), target);
      const rootReal = realpathSync.native(root);
      const lexical = relative(resolve(root), resolvedTarget);
      const canonicalTarget = lexical === '' ? rootReal : existsSync(resolvedTarget)
        ? realpathSync.native(resolvedTarget) : resolve(rootReal, lexical);
      if (lexical === '..' || lexical.startsWith(`..${sep}`) || (canonicalTarget !== rootReal && !canonicalTarget.startsWith(`${rootReal}${sep}`))) {
        throw new Error(`symlink escapes root: ${path}`);
      }
      all.push({ path, type: 'symlink', sha256: sha256(target) });
    } else if (stat.isFile()) {
      all.push({ path, type: 'file', sha256: sha256(readFileSync(absolute)) });
    } else {
      throw new Error(`unsupported untracked entry: ${path}`);
    }
  }
  const allowed = policy === 'allowlist'
    ? all.filter((entry) => allowlist.some((prefix) => entry.path === prefix || entry.path.startsWith(`${prefix}/`)))
    : all;
  const receiptEntries = policy === 'metadata' || policy === 'allowlist' ? allowed : [];
  return {
    identity: { policy, count: all.length, digest: digestJson(all) },
    receipt: {
      policy,
      count: all.length,
      allowlist: policy === 'allowlist' ? allowlist : [],
      ...(policy === 'exclude' ? {} : { entries: receiptEntries }),
      ...(policy === 'allowlist' ? { excludedCount: all.length - allowed.length } : {}),
    },
  };
}

export function generatorIdentity(scriptDir = SCRIPT_DIR) {
  const names = ['context-index-lib.mjs', 'context-snapshot.mjs', 'repo-map.mjs', 'import-graph.mjs', 'atlas-check.mjs'];
  return Object.fromEntries(names.map((name) => [name.replace('.mjs', 'Sha256'), sha256(readFileSync(resolve(scriptDir, name)))]));
}

export function normalizeAtlasConfig(root, atlasPath) {
  if (!atlasPath) return { status: 'absent' };
  if (!safeRelative(atlasPath)) throw new Error('atlas path must be repository-relative');
  const path = repoRelative(root, resolve(root, atlasPath));
  const manifest = resolve(root, path, 'MANIFEST.json');
  if (!existsSync(manifest)) throw new Error('atlas MANIFEST.json does not exist');
  const parsed = readJson(manifest);
  return { status: 'available', path, manifestSha256: sha256(canonical(parsed)) };
}

export function collectState(root, policy = 'metadata', allowlist = [], atlasConfig = { status: 'absent' }) {
  if (!['metadata', 'exclude', 'allowlist'].includes(policy)) {
    throw new Error('untracked policy must be metadata, exclude, or allowlist');
  }
  if (policy === 'allowlist' && !allowlist.length) throw new Error('allowlist requires --allow-untracked');
  if (allowlist.some((entry) => !safeRelative(entry))) throw new Error('allowlist contains an unsafe path');
  assertNoAmbiguousIndexFlags(root);
  const untracked = untrackedState(root, policy, allowlist);
  const head = gitText(root, ['rev-parse', 'HEAD']);
  const visibleState = {
    staged: parseNameStatus(root, ['diff', '--cached', '--name-status']),
    unstaged: parseNameStatus(root, ['diff', '--name-status']),
    untracked: untracked.receipt,
    ignoredPolicy: 'excluded',
    completeness: 'IGNORED-CONTENT-UNKNOWN',
  };
  const identity = {
    version: CONTEXT_INDEX_VERSION,
    head,
    trackedWorktreeDiffSha256: sha256(git(root, ['diff', '--no-ext-diff', '--binary', '--full-index', 'HEAD', '--'])),
    indexEntriesSha256: sha256(git(root, ['ls-files', '-s', '-z'])),
    untracked: untracked.identity,
    ignoredPolicy: 'excluded',
    atlas: atlasConfig,
    visibleStateSha256: digestJson(visibleState),
  };
  return {
    identity,
    head,
    ...visibleState,
  };
}

export function snapshotIdFor(state, generator) {
  return digestJson({ ...state.identity, generator });
}

export function assertSnapshotSelfConsistency(receipt) {
  if (!receipt || receipt.version !== 1 || !receipt.identity || !receipt.generator?.digests
    || receipt.identity.visibleStateSha256 !== digestJson(receipt.state)
    || snapshotIdFor({ identity: receipt.identity }, receipt.generator.digests) !== receipt.snapshotId) {
    throw new Error('context snapshot receipt is self-inconsistent');
  }
}

export function snapshotDelta(from, to) {
  assertSnapshotSelfConsistency(from); assertSnapshotSelfConsistency(to);
  const before = new Map((from.state?.untracked?.entries || []).map((entry) => [entry.path, entry.sha256]));
  const after = new Map((to.state?.untracked?.entries || []).map((entry) => [entry.path, entry.sha256]));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return {
    version: 1, fromSnapshotId: from.snapshotId, toSnapshotId: to.snapshotId,
    changed: { staged: to.state.staged, unstaged: to.state.unstaged, untracked: paths.flatMap((path) => !before.has(path) ? [{ kind: 'added', path }] : !after.has(path) ? [{ kind: 'removed', path }] : before.get(path) === after.get(path) ? [] : [{ kind: 'modified', path }]) },
    atlas: { freshToStale: [], newlyMalformed: false },
    generatorChanged: digestJson(from.generator.digests) !== digestJson(to.generator.digests), requiresFullIndex: true,
  };
}

export function verifySnapshotReceipt(root, receipt, scriptDir = SCRIPT_DIR) {
  if (!receipt || receipt.version !== 1 || !/^[0-9a-f]{64}$/.test(receipt.snapshotId || '')) {
    throw new Error('invalid context snapshot receipt');
  }
  assertSnapshotSelfConsistency(receipt);
  const policy = receipt.state?.untracked?.policy;
  const allowlist = receipt.state?.untracked?.allowlist || [];
  const currentGenerator = generatorIdentity(scriptDir);
  if (digestJson(currentGenerator) !== digestJson(receipt.generator?.digests || {})) {
    throw new Error('context generator drift; prepare a new receipt and rebuild bundles');
  }
  const atlasConfig = receipt.atlas?.config?.status === 'available'
    ? normalizeAtlasConfig(root, receipt.atlas.config.path)
    : { status: 'absent' };
  if (digestJson(atlasConfig) !== digestJson(receipt.atlas?.config || { status: 'absent' })) {
    throw new Error('atlas configuration drift; prepare a new receipt and rebuild bundles');
  }
  const state = collectState(root, policy, allowlist, atlasConfig);
  if (snapshotIdFor(state, currentGenerator) !== receipt.snapshotId) {
    throw new Error('context snapshot drift; prepare a new receipt, increment contract revision, and re-bundle affected units');
  }
  return state;
}

export function cacheEntryPath(cacheRoot, snapshotId) {
  return resolve(cacheRoot, 'context-index', `v${CONTEXT_INDEX_VERSION}`, snapshotId);
}

export function validateCacheEntry(entry, snapshotId, generator) {
  try {
    const meta = readJson(resolve(entry, 'META.json'));
    if (meta.version !== 1 || meta.snapshotId !== snapshotId || digestJson(meta.generator) !== digestJson(generator)) return null;
    for (const payload of Object.values(meta.payloads || {})) {
      if (!payload || !safeRelative(payload.file)) return null;
      const path = resolve(entry, payload.file);
      if (!existsSync(path) || sha256(readFileSync(path)) !== payload.sha256) return null;
    }
    return meta;
  } catch {
    return null;
  }
}

export function parseRepoMap(text) {
  const files = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    if (!line.startsWith(' ')) {
      const scanned = /^(.+) \((\d+) lines\)$/.exec(line);
      const special = /^(.+) \((binary|unreadable|skipped: .+)\)$/.exec(line);
      if (scanned) {
        current = { path: scanned[1], state: 'scanned', lineCount: Number(scanned[2]), definitions: [], definitionOverflow: 0 };
        files.push(current);
      } else if (special) {
        current = { path: special[1], state: special[2], lineCount: null, definitions: [], definitionOverflow: 0 };
        files.push(current);
      } else current = null;
      continue;
    }
    if (!current) continue;
    const definition = /^  (\d+): (\S+) (.+)$/.exec(line);
    const overflow = /^  \(\+(\d+) more truncated\)$/.exec(line);
    if (definition) current.definitions.push({ line: Number(definition[1]), kind: definition[2], name: definition[3] });
    else if (overflow) current.definitionOverflow = Number(overflow[1]);
  }
  return { version: 1, files };
}

export function parseImportGraph(text, trackedPaths) {
  const tracked = new Set(trackedPaths);
  const files = {};
  let current = null;
  let mode = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\r$/, '');
    if (tracked.has(line)) {
      current = line;
      mode = null;
      files[current] ??= { imports: [], importedBy: [], unresolved: [], bare: [], dynamicSkipped: 0 };
      continue;
    }
    if (!current) continue;
    const label = /^  (imports|imported-by|unresolved|bare):$/.exec(line);
    if (label) { mode = label[1]; continue; }
    const dynamic = /^  dynamic import skipped \((\d+)\)$/.exec(line);
    if (dynamic) { files[current].dynamicSkipped = Number(dynamic[1]); continue; }
    const value = /^    (.+)$/.exec(line);
    if (!value || !mode) { if (line && !line.startsWith(' ')) current = null; continue; }
    const key = mode === 'imported-by' ? 'importedBy' : mode;
    files[current][key].push(value[1]);
  }
  return { version: 1, files };
}

export function parseAtlasReport(text) {
  const sections = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*(?:ok|!!)\s+(FRESH|STALE)\s+([a-z0-9-]+)\s*(.*)$/.exec(raw);
    if (match) sections.set(match[2], { verdict: match[1], detail: match[3].replace(/^—\s*/, '') });
  }
  return sections;
}

export function pathMatchesGlob(pattern, path) {
  const entry = pattern.normalize('NFC').toLowerCase();
  const candidate = path.normalize('NFC').toLowerCase();
  if (entry.includes('*') || entry.includes('?')) {
    const escaped = entry.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const regex = escaped.replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('?', '[^/]').replaceAll('\u0000', '.*');
    return new RegExp(`^${regex}$`).test(candidate);
  }
  return candidate === entry || candidate.startsWith(`${entry}/`);
}

export function scopeMatches(scope, path) {
  return scope.some((entry) => pathMatchesGlob(entry, path));
}

export function scopesIntersect(left, right) {
  return left.some((a) => right.some((b) => {
    const aGlob = /[*?]/.test(a); const bGlob = /[*?]/.test(b);
    const globIntersectsLiteral = (glob, literal) => {
      if (pathMatchesGlob(glob, literal)) return true;
      const prefix = glob.normalize('NFC').toLowerCase().split(/[?*]/, 1)[0].replace(/\/$/, '');
      const target = literal.normalize('NFC').toLowerCase();
      return (prefix && (prefix === target || prefix.startsWith(`${target}/`))) || (!prefix && glob.includes('/'));
    };
    if (aGlob && !bGlob) return globIntersectsLiteral(a, b);
    if (bGlob && !aGlob) return globIntersectsLiteral(b, a);
    const aa = a.normalize('NFC').toLowerCase().split(/[?*]/, 1)[0].replace(/\/$/, '');
    const bb = b.normalize('NFC').toLowerCase().split(/[?*]/, 1)[0].replace(/\/$/, '');
    if (aGlob && bGlob) return aa.startsWith(bb) || bb.startsWith(aa);
    return a === '**' || b === '**' || aa === bb || aa.startsWith(`${bb}/`) || bb.startsWith(`${aa}/`);
  }));
}

export function repoRelative(root, absolute) {
  const value = toPosix(relative(root, absolute));
  if (!safeRelative(value)) throw new Error('path must stay inside repository');
  return value;
}
