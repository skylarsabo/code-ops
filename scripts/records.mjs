#!/usr/bin/env node
// Durable record-collection lifecycle for the documentation vault.
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import {
  canonical, citationAuthority, classificationProblems, classify, cleanWorktree,
  completeHistory, digestJson, extractCitations, findBlobByDigest, FULL_ID_RE, git,
  gitPaths, historicalTarget, jsonl, nativePath, posix,
  readJson, readJsonl, recordId, relativeRoot, renderIndex, resolveCitation,
  resolvePrefix, safePath, sha256, targetAt, targetAtIndex, trackedPaths, treePathsAt,
  validateCollection, validateLedger, verifyIndex, writeAtomically,
} from './record-lib.mjs';

class HistoryUnavailableError extends Error {}

function fail(message, code = 1) {
  console.error(`records: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const options = {}; const flags = new Set(['strict', 'no-stage', 'legacy']);
  const values = new Set(['root', 'manifest', 'collection', 'record', 'state', 'at']);
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
    classify: shared, adopt: shared, append: [...shared, 'record', 'no-stage'],
    curate: [...shared, 'record', 'state', 'at'], render: [...shared, 'legacy'],
    check: shared, 'verify-history': [...shared, 'strict'], 'reindex-locators': shared,
  };
  const allowed = commandOptions[command];
  if (!allowed) throw new Error('commands: classify adopt curate append render check verify-history reindex-locators');
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) throw new Error(`--${key} is not valid for ${command}`);
  }
  if (command === 'verify-history' && options.strict !== true) throw new Error('verify-history requires --strict');
}

function manifestPath(root, options) {
  if (options.manifest) return nativePath(root, options.manifest);
  const matches = trackedPaths(root).filter((path) => path.endsWith('/98 System/DOCS_MANIFEST.json'));
  if (matches.length !== 1) throw new Error('expected exactly one tracked DOCS_MANIFEST.json; use --manifest');
  return nativePath(root, matches[0]);
}

function loadContext(root, options) {
  const manifestFile = manifestPath(root, options);
  const manifest = readJson(manifestFile);
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
  const context = { root, manifest, manifestFile, hub: manifest.hub, collection, output };
  if (completeHistory(root).ok) assertManifestHistory(context);
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

function fileDigest(path) { return sha256(readFileSync(path)); }
function outputRepoPath(context, key) { return relativeRoot(context.root, context.output[key]); }

function gitObjectFormat(root) { return git(root, ['rev-parse', '--show-object-format']).trim(); }
function headOid(root) { return git(root, ['rev-parse', 'HEAD']).trim(); }
function stagedPaths(root) { return new Set(gitPaths(root, ['diff', '--cached', '--name-only', '-z'])); }
function literalPath(path) { return `:(literal)${path}`; }

function indexEntry(root, path) {
  const rows = git(root, ['ls-files', '-s', '-z', '--', literalPath(path)], true).toString('utf8').split('\0').filter(Boolean);
  if (rows.length !== 1) throw new Error(`expected one index entry for ${path}`);
  const match = /^(\d+) ([0-9a-f]+) \d+\t([\s\S]+)$/.exec(rows[0]);
  if (!match || match[3] !== path) throw new Error(`malformed index entry for ${path}`);
  if (!['100644', '100755'].includes(match[1])) throw new Error(`unsupported Git index mode ${match[1]} for ${path}`);
  return { mode: match[1], blobOid: match[2] };
}

function stagedBytes(root, path) {
  return git(root, ['cat-file', '-p', indexEntry(root, path).blobOid], true);
}

function assertGeneratedUntouched(context) {
  for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
    const path = outputRepoPath(context, key);
    if (git(context.root, ['status', '--porcelain=v1', '--untracked-files=all', '--', literalPath(path)]).trim()) {
      throw new Error(`pre-existing generated-file edit: ${path}`);
    }
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

const MANIFEST_GLOB = ':(glob)**/98 System/DOCS_MANIFEST.json';

function committedManifestVersions(root) {
  let commits = [];
  try { commits = git(root, ['log', '--format=%H', '--reverse', '--', MANIFEST_GLOB]).trim().split(/\s+/).filter(Boolean); }
  catch (error) { throw new Error(`cannot read manifest history: ${error.message}`); }
  return commits.map((commit) => {
    const paths = gitPaths(root, ['ls-tree', '-r', '--name-only', '-z', commit])
      .filter((path) => path.endsWith('/98 System/DOCS_MANIFEST.json'));
    if (paths.length > 1) throw new Error(`multiple documentation manifests exist at ${commit}: ${paths.join(', ')}`);
    if (!paths.length) return { commit, path: null, bytes: null };
    return { commit, path: paths[0], bytes: git(root, ['show', `${commit}:${paths[0]}`], true) };
  });
}

function collectionOutputPaths(context, key) {
  const paths = new Set([outputRepoPath(context, key)]);
  for (const version of committedManifestVersions(context.root)) {
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
      entries: (document.entries || []).map(authority), artifacts: document.artifacts || [],
    });
  }
  return parsed;
}

function assertManifestHistory(context) {
  const versions = committedManifestVersions(context.root)
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
    entries: inventory.entries || [], artifacts: inventory.artifacts || [],
  });
  for (let index = 1; index < inventoryVersions.length; index += 1) {
    if (inventoryVersions[index - 1].version !== inventoryVersions[index].version
      || inventoryVersions[index - 1].collectionUuid !== inventoryVersions[index].collectionUuid) {
      throw new Error('record inventory header changed after introduction');
    }
    assertCanonicalPrefix('record inventory', inventoryVersions[index - 1].entries, inventoryVersions[index].entries);
    assertCanonicalPrefix('artifact inventory', inventoryVersions[index - 1].artifacts, inventoryVersions[index].artifacts);
  }
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
  return extractCitations(sourceText).map((citation) => {
    const resolution = resolveCitation(citation.rawTarget, entry.path, knownPaths);
    const base = {
      recordId: entry.id, sourceLine: citation.sourceLine, rawTarget: citation.rawTarget,
      normalizedTarget: resolution.normalizedTarget, resolvedVia: resolution.resolvedVia,
    };
    if (resolution.state === 'external') return { ...base, state: 'external' };
    if (resolution.state === 'glob') return { ...base, state: 'glob', matches: resolution.matches };
    if (resolution.state === 'ambiguous') return { ...base, state: 'ambiguous', matches: resolution.matches };
    if (resolution.state === 'dead-at-adoption') {
      if (mode === 'adopt') {
        const historical = historicalTarget(context.root, resolution.normalizedTarget, entry.introducedCommit);
        if (historical?.ambiguous) return {
          ...base, state: 'ambiguous',
          historicalCandidates: historical.targets.map((target) => ({ targetSha256: target.targetSha256 })),
        };
        if (historical) return { ...base, state: 'redirected', target: historical };
      }
      return { ...base, state: 'dead-at-adoption' };
    }
    const targetPath = resolution.matches[0];
    const target = mode === 'index' ? targetAtIndex(context.root, targetPath) : targetAt(context.root, entry.introducedCommit, targetPath);
    if (!target) return { ...base, state: 'dead-at-adoption' };
    if (mode === 'index' && existsSync(nativePath(context.root, targetPath))
      && fileDigest(nativePath(context.root, targetPath)) !== target.targetSha256) {
      throw new Error(`staged citation target differs from working tree: ${targetPath}`);
    }
    const row = policy.get(targetPath);
    const mutable = row?.policy === 'mutable';
    const state = mode === 'adopt' && !current.has(targetPath) ? 'redirected' : mutable ? 'resolved-mutable' : 'resolved-immutable';
    return { ...base, state, target };
  });
}

function introductionCommit(root, path) {
  const commits = git(root, ['log', '--follow', '--diff-filter=A', '--format=%H', '--reverse', '--', literalPath(path)])
    .trim().split(/\s+/).filter(Boolean);
  if (!commits.length) throw new Error(`required historical object is unavailable for ${path}`);
  return commits[0];
}

function inventoryEntry(context, row, provenance, staged = false) {
  const path = row.path;
  const index = indexEntry(context.root, path);
  const bytes = staged ? stagedBytes(context.root, path) : readFileSync(nativePath(context.root, path));
  if (!bytes) throw new Error(`record bytes unavailable: ${path}`);
  const entry = {
    id: recordId(context.collection.collectionUuid, path), identityVersion: context.collection.identityVersion,
    path, provenance, sha256: sha256(staged ? bytes : git(context.root, ['cat-file', '-p', index.blobOid], true)), kind: row.kind, policy: row.policy,
  };
  if (provenance === 'adopted') entry.introducedCommit = introductionCommit(context.root, path);
  else { entry.introducedCommit = null; entry.introducedIndexHead = headOid(context.root); }
  return entry;
}

function renderCurrent(context, inventory, events) {
  return renderIndex(context.collection, context.hub, inventory, events);
}

function adopt(context) {
  if (!cleanWorktree(context.root)) throw new Error('adoption requires a clean worktree');
  const history = completeHistory(context.root);
  if (!history.ok) throw new HistoryUnavailableError(`adoption refused: ${history.reason}`);
  if (Object.values(context.output).some(existsSync)) throw new Error('adoption refuses existing generated baselines');
  const { rows } = collect(context);
  for (const row of rows) indexEntry(context.root, row.path);
  const records = rows.filter((row) => row.kind === 'record');
  const entries = records.map((row) => inventoryEntry(context, row, 'adopted', true));
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) throw new Error('record ID collision');
  const artifacts = rows.filter((row) => ['frozen', 'superseded'].includes(row.policy)).map((row) => {
    const index = indexEntry(context.root, row.path);
    return { path: row.path, sha256: sha256(git(context.root, ['cat-file', '-p', index.blobOid], true)), kind: row.kind, policy: row.policy };
  });
  const inventory = { version: 1, collectionUuid: context.collection.collectionUuid, entries, artifacts };
  const citationInventory = { version: 1, collectionUuid: context.collection.collectionUuid, entries: [] };
  for (const entry of entries) {
    const sourceText = git(context.root, ['show', `${entry.introducedCommit}:${entry.path}`], true).toString('utf8');
    const known = treePathsAt(context.root, entry.introducedCommit);
    citationInventory.entries.push(...citationEntries(context, entry, sourceText, known, rows, 'adopt'));
  }
  writeAtomically([
    [context.output.inventory, `${JSON.stringify(inventory, null, 2)}\n`],
    [context.output.citations, `${JSON.stringify(citationInventory, null, 2)}\n`],
    [context.output.curationLedger, ''],
    [context.output.index, renderCurrent(context, inventory, [])],
  ]);
  console.log(JSON.stringify({ adopted: entries.length, artifacts: artifacts.length, citations: citationInventory.entries.length }));
}

function checkInventory(context, rows, inventory) {
  if (inventory.version !== 1 || inventory.collectionUuid !== context.collection.collectionUuid) throw new Error('invalid record inventory header');
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
    if (entry.provenance === 'adopted') {
      if (!/^[0-9a-f]{40,64}$/.test(entry.introducedCommit || '') || 'introducedIndexHead' in entry || 'supersedes' in entry) {
        throw new Error(`invalid adopted record metadata: ${entry.path}`);
      }
    } else {
      const metadata = recordFrontmatter(readFileSync(nativePath(context.root, entry.path), 'utf8'));
      if (entry.introducedCommit !== null || !/^[0-9a-f]{40,64}$/.test(entry.introducedIndexHead || '')
        || canonical(entry.supersedes) !== canonical(metadata.supersedes)) throw new Error(`invalid native record metadata: ${entry.path}`);
    }
    if (fileDigest(nativePath(context.root, entry.path)) !== entry.sha256) throw new Error(`immutable record drift: ${entry.path}`);
    ids.add(entry.id); recordRows.delete(entry.path);
  }
  if (recordRows.size) throw new Error(`record missing from inventory: ${[...recordRows.keys()][0]}`);
  if (ids.size !== (inventory.entries || []).length) throw new Error('duplicate record identity');
  const immutableRows = new Map(rows.filter((row) => ['frozen', 'superseded'].includes(row.policy)).map((row) => [row.path, row]));
  for (const artifact of inventory.artifacts || []) {
    if (!immutableRows.has(artifact.path)) throw new Error(`frozen artifact deleted, renamed, or reclassified: ${artifact.path}`);
    if (fileDigest(nativePath(context.root, artifact.path)) !== artifact.sha256) throw new Error(`frozen artifact drift: ${artifact.path}`);
    immutableRows.delete(artifact.path);
  }
  if (immutableRows.size) throw new Error(`frozen artifact missing from inventory: ${[...immutableRows.keys()][0]}`);
  return ids;
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
    for (const match of text.matchAll(/REC-[A-Z2-7]{8,26}(?![A-Z2-7])/g)) seen.add(match[0]);
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

function checkLegacy(context, citations, ids) {
  for (const entry of context.manifest.legacyPaths || []) {
    if (!legacyEligible(context, entry, citations, ids)) throw new Error(`ineligible legacy path: ${entry.path}`);
    const path = nativePath(context.root, entry.path);
    if (!existsSync(path) || readFileSync(path, 'utf8') !== legacyContent(context, entry)) throw new Error(`legacy path drift: ${entry.path}`);
  }
}

function runCheck(context, { strict = false } = {}) {
  const { rows } = collect(context);
  for (const path of Object.values(context.output)) if (!existsSync(path)) throw new Error(`missing generated record file: ${relativeRoot(context.root, path)}`);
  const inventory = readJson(context.output.inventory);
  const citations = readJson(context.output.citations);
  const ledgerText = readFileSync(context.output.curationLedger, 'utf8');
  const events = readJsonl(context.output.curationLedger);
  const ids = checkInventory(context, rows, inventory);
  if (citations.version !== 1 || citations.collectionUuid !== context.collection.collectionUuid) throw new Error('invalid citation inventory header');
  validateLedger(events, context.collection.collectionUuid);
  for (const event of events) {
    if (!FULL_ID_RE.test(event.recordId) || !ids.has(event.recordId)) throw new Error(`curation event references unknown record ${event.recordId}`);
  }
  const history = completeHistory(context.root);
  if (strict && !history.ok) throw new HistoryUnavailableError(`infrastructure history unavailable: ${history.reason}`);
  assertBaseline(context, inventory, citations, ledgerText, history.ok);
  const warnings = [];
  if (!history.ok) warnings.push(`history-unavailable: ${history.reason}`);
  const current = new Set(trackedPaths(context.root));
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
      && readFileSync(nativePath(context.root, legacyEntry.path), 'utf8') === legacyContent(context, legacyEntry)
      && legacyEligible(context, legacyEntry, citations.entries || [], allIds);
    if (['resolved-immutable', 'resolved-mutable'].includes(citation.state) && !current.has(citation.target?.path)) {
      throw new Error(`resolved-to-dead citation regression: ${citation.normalizedTarget}`);
    }
    if (citation.state === 'resolved-mutable' && current.has(citation.target?.path) && !exactLegacyReplacement) {
      const digest = fileDigest(nativePath(context.root, citation.target.path));
      if (digest !== citation.target.targetSha256) warnings.push(`mutable-drifted: ${citation.target.path}`);
    }
    if (citation.state === 'resolved-immutable' && current.has(citation.target?.path) && !exactLegacyReplacement
      && fileDigest(nativePath(context.root, citation.target.path)) !== citation.target.targetSha256) {
      throw new Error(`digest-mismatch: ${citation.target.path}`);
    }
    if (citation.target) {
      const locator = verifyLocator(context.root, citation.target, history);
      if (locator.state === 'evidence-lost') throw new Error(`evidence-lost: ${citation.target.targetSha256}`);
      if (locator.state === 'digest-mismatch') throw new Error(`digest-mismatch: ${citation.normalizedTarget}`);
      if (locator.state === 'history-unavailable') warnings.push(`history-unavailable: ${citation.normalizedTarget}`);
    }
  }
  verifyIndex(readFileSync(context.output.index, 'utf8'), context.collection, inventory, events);
  scanRecordPrefixes(context, allIds);
  checkLegacy(context, citations.entries || [], allIds);
  for (const warning of [...new Set(warnings)]) console.warn(`records: warning: ${warning}`);
  const stateCounts = {};
  for (const citation of citations.entries || []) stateCounts[citation.state] = (stateCounts[citation.state] || 0) + 1;
  return { records: ids.size, citations: (citations.entries || []).length, states: stateCounts, history: history.ok ? 'complete' : 'history-unavailable', warnings: [...new Set(warnings)].length };
}

function appendRecord(context, options) {
  if (!options.record) throw new Error('append requires --record');
  const recordPath = posix(options.record);
  if (!trackedPaths(context.root).includes(recordPath) || !stagedPaths(context.root).has(recordPath)) {
    throw new Error('record must be tracked in the Git index and staged');
  }
  const staged = stagedBytes(context.root, recordPath);
  if (!staged || !existsSync(nativePath(context.root, recordPath))
    || !readFileSync(nativePath(context.root, recordPath)).equals(staged)) throw new Error('staged record differs from working tree');
  assertGeneratedUntouched(context);
  const history = completeHistory(context.root);
  if (!history.ok) throw new HistoryUnavailableError(`append refused: ${history.reason}`);
  const metadata = recordFrontmatter(staged.toString('utf8'));
  const { paths, rows } = collect(context);
  const row = rows.find((candidate) => candidate.path === recordPath);
  if (!row || row.kind !== 'record' || row.policy !== 'append-only') throw new Error('record is not classified as append-only');
  const inventory = readJson(context.output.inventory);
  const citations = readJson(context.output.citations);
  const events = readJsonl(context.output.curationLedger);
  validateLedger(events, context.collection.collectionUuid);
  if ((inventory.entries || []).some((entry) => entry.path === recordPath)) throw new Error('record is already inventoried');
  const knownIds = new Set((inventory.entries || []).map((entry) => entry.id));
  for (const id of metadata.supersedes) if (!knownIds.has(id)) throw new Error(`supersedes references unknown record ${id}`);
  const entry = inventoryEntry(context, row, 'native', true);
  entry.supersedes = metadata.supersedes;
  const additions = citationEntries(context, entry, staged.toString('utf8'), paths, rows, 'index');
  for (const citation of additions) {
    if (['dead-at-adoption', 'ambiguous', 'glob'].includes(citation.state)
      || citation.resolvedVia.includes('glob-expanded')) throw new Error(`native record has unresolved citation: ${citation.rawTarget}`);
    if (citation.state === 'resolved-mutable' && !citation.target?.targetSha256) throw new Error(`native mutable citation lacks a target digest: ${citation.rawTarget}`);
  }
  const inventoriedArtifacts = new Set((inventory.artifacts || []).map((artifact) => artifact.path));
  const newArtifacts = rows.filter((candidate) => ['frozen', 'superseded'].includes(candidate.policy)
    && !inventoriedArtifacts.has(candidate.path));
  const stagedSet = stagedPaths(context.root);
  for (const artifact of newArtifacts) {
    if (!stagedSet.has(artifact.path)) throw new Error(`new immutable artifact must be staged with append: ${artifact.path}`);
    const bytes = stagedBytes(context.root, artifact.path);
    if (!bytes || !existsSync(nativePath(context.root, artifact.path))
      || !readFileSync(nativePath(context.root, artifact.path)).equals(bytes)) {
      throw new Error(`staged artifact differs from working tree: ${artifact.path}`);
    }
    inventory.artifacts.push({ path: artifact.path, sha256: sha256(bytes), kind: artifact.kind, policy: artifact.policy });
  }
  inventory.entries.push(entry);
  citations.entries.push(...additions);
  assertBaseline(context, inventory, citations, readFileSync(context.output.curationLedger, 'utf8'));
  const writes = [
    [context.output.inventory, `${JSON.stringify(inventory, null, 2)}\n`],
    [context.output.citations, `${JSON.stringify(citations, null, 2)}\n`],
    [context.output.index, renderCurrent(context, inventory, events)],
  ];
  const generated = writes.map(([path]) => relativeRoot(context.root, path));
  const originals = writes.map(([path]) => [path, readFileSync(path)]);
  let stagedGenerated = false;
  try {
    writeAtomically(writes);
    if (!options['no-stage']) {
      git(context.root, ['add', '--', ...generated]); stagedGenerated = true;
      git(context.root, ['diff', '--cached', '--check']);
      runCheck(context);
    }
  } catch (error) {
    if (stagedGenerated) git(context.root, ['reset', '--quiet', 'HEAD', '--', ...generated]);
    writeAtomically(originals);
    throw error;
  }
  console.log(JSON.stringify({ staged: options['no-stage'] ? [] : [recordPath, ...generated], written: generated }));
}

function acquireCurationLock(lock) {
  const owner = `${lock}/owner.json`;
  const staleAfterMs = 10 * 60 * 1000;
  try { mkdirSync(lock); }
  catch {
    let metadata = null;
    try { metadata = JSON.parse(readFileSync(owner, 'utf8')); } catch { /* corrupt locks require age proof below */ }
    const age = Date.now() - statSync(lock).mtimeMs;
    let alive = false;
    if (Number.isInteger(metadata?.pid) && metadata.pid > 0) {
      try { process.kill(metadata.pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') alive = true; }
    }
    if (alive || age < staleAfterMs) throw new Error('curation is single-writer and the lock is held');
    // A lock older than the lease whose local PID is dead is recoverable. The
    // lock contains no ledger data, so removing it cannot rewrite an event.
    rmSync(lock, { recursive: true, force: false });
    mkdirSync(lock);
  }
  writeFileSync(owner, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
}

function curate(context, options) {
  if (!options.record || !options.state) throw new Error('curate requires --record and complete JSON --state');
  const history = completeHistory(context.root);
  if (!history.ok) throw new HistoryUnavailableError(`curation refused: ${history.reason}`);
  const inventory = readJson(context.output.inventory);
  const ids = (inventory.entries || []).map((entry) => entry.id);
  const record = FULL_ID_RE.test(options.record) ? options.record : resolvePrefix(options.record, ids);
  if (!ids.includes(record)) throw new Error(`unknown record ${record}`);
  let state;
  try { state = JSON.parse(options.state); } catch { throw new Error('--state must be valid JSON'); }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('--state must be a complete JSON object');
  const lock = `${context.output.curationLedger}.lock`;
  acquireCurationLock(lock);
  try {
    const ledgerText = existsSync(context.output.curationLedger) ? readFileSync(context.output.curationLedger, 'utf8') : '';
    const events = readJsonl(context.output.curationLedger);
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
    writeAtomically([
      [context.output.curationLedger, nextText],
      [context.output.index, renderCurrent(context, inventory, [...events, event])],
    ]);
    console.log(JSON.stringify({ sequence: event.sequence, eventDigest: event.eventDigest }));
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

function render(context, options) {
  const inventory = readJson(context.output.inventory);
  const events = readJsonl(context.output.curationLedger);
  const writes = [[context.output.index, renderCurrent(context, inventory, events)]];
  if (options.legacy) {
    const citations = readJson(context.output.citations).entries || [];
    const ids = allCollectionIds(context);
    for (const entry of context.manifest.legacyPaths || []) {
      if (!legacyEligible(context, entry, citations, ids)) throw new Error(`ineligible legacy path: ${entry.path}`);
      writes.push([nativePath(context.root, entry.path), legacyContent(context, entry)]);
    }
  }
  writeAtomically(writes);
  console.log(JSON.stringify({ written: writes.map(([path]) => relativeRoot(context.root, path)) }));
}

function reindexLocators(context) {
  const history = completeHistory(context.root);
  if (!history.ok) throw new HistoryUnavailableError(`infrastructure history unavailable: ${history.reason}`);
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
  writeAtomically([[context.output.citations, `${JSON.stringify(citations, null, 2)}\n`]]);
  console.log(JSON.stringify({ locatorsUpdated: changed, objectFormat: gitObjectFormat(context.root) }));
}

function classifyCommand(context) {
  const { rows, problems } = collect(context, { allowProblems: true });
  console.log(JSON.stringify(rows, null, 2));
  if (problems.length) throw new Error(`invalid collection classification: ${problems.map((row) => row.path).join(', ')}`);
}

const [command, ...argv] = process.argv.slice(2);
try {
  const options = parseArgs(argv);
  validateInvocation(command, options);
  const root = resolve(options.root || process.cwd());
  const context = loadContext(root, options);
  if (command === 'classify') classifyCommand(context);
  else if (command === 'adopt') adopt(context);
  else if (command === 'append') appendRecord(context, options);
  else if (command === 'curate') curate(context, options);
  else if (command === 'render') render(context, options);
  else if (command === 'check') console.log(JSON.stringify(runCheck(context)));
  else if (command === 'verify-history') console.log(JSON.stringify(runCheck(context, { strict: options.strict === true })));
  else if (command === 'reindex-locators') reindexLocators(context);
} catch (error) {
  fail(error.message, error instanceof HistoryUnavailableError ? 2 : 1);
}
