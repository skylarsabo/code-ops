#!/usr/bin/env node
// Captures an exact visible repository state and reuses its structural index by content address.
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  atomicWrite,
  cacheEntryPath,
  collectState,
  CONTEXT_INDEX_VERSION,
  digestJson,
  generatorIdentity,
  normalizeAtlasConfig,
  readJson,
  repoRelative,
  safeRelative,
  sha256,
  snapshotDelta,
  snapshotIdFor,
  validateCacheEntry,
  verifySnapshotReceipt,
} from './context-index-lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function die(message, code = 1) {
  console.error(`x ${message}`);
  process.exit(code);
}

function usage() {
  die('usage: context-snapshot.mjs prepare --root <repo> --out <receipt> --cache <dir> [--atlas <dir>] [--untracked metadata|exclude|allowlist] [--allow-untracked <path> ...] [--previous <receipt> --delta-out <file>]\n'
    + '       context-snapshot.mjs verify --root <repo> --snapshot <receipt>\n'
    + '       context-snapshot.mjs delta --from <receipt> --to <receipt> --out <file>', 2);
}

function flags(args, known, repeated = new Set()) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!known.has(key) || (!repeated.has(key) && out[key] !== undefined)) usage();
    const value = args[++i];
    if (!value || value.startsWith('--')) usage();
    if (repeated.has(key)) (out[key] ??= []).push(value);
    else out[key] = value;
  }
  return out;
}


function runIndex(script, root, out) {
  execFileSync(process.execPath, [resolve(SCRIPT_DIR, script), '--root', root, '--out', out], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function buildCache(root, cacheRoot, snapshotId, generator, atlasConfig) {
  const target = cacheEntryPath(cacheRoot, snapshotId);
  const existing = validateCacheEntry(target, snapshotId, generator);
  if (existing) return { entry: target, meta: existing, status: 'reused' };

  const temp = `${target}.tmp-${process.pid}`;
  mkdirSync(temp, { recursive: true });
  const repoMap = resolve(temp, 'REPO_MAP.md');
  const importGraph = resolve(temp, 'IMPORT_GRAPH.md');
  const atlasState = resolve(temp, 'ATLAS_STATE.txt');
  runIndex('repo-map.mjs', root, repoMap);
  runIndex('import-graph.mjs', root, importGraph);

  let atlas = { status: 'absent', path: null };
  if (atlasConfig.status === 'available') {
    const atlasAbsolute = resolve(root, atlasConfig.path);
    const atlasRelative = atlasConfig.path;
    let report;
    try {
      report = execFileSync(process.execPath, [resolve(SCRIPT_DIR, 'atlas-check.mjs'), 'check', '--atlas', atlasAbsolute, '--root', root], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      throw new Error(`atlas index failed: ${String(error.stdout || error.stderr || error.message).trim()}`);
    }
    atomicWrite(atlasState, report);
    atlas = { status: 'available', path: atlasRelative };
  } else atomicWrite(atlasState, '# atlas absent\n');

  const payloads = Object.fromEntries([
    ['repoMap', 'REPO_MAP.md'],
    ['importGraph', 'IMPORT_GRAPH.md'],
    ['atlasState', 'ATLAS_STATE.txt'],
  ].map(([key, file]) => [key, { file, sha256: sha256(readFileSync(resolve(temp, file))) }]));
  const meta = { version: 1, snapshotId, generator, atlas, payloads };
  atomicWrite(resolve(temp, 'META.json'), `${JSON.stringify(meta, null, 2)}\n`);

  if (existsSync(target)) renameSync(target, `${target}.invalid-${Date.now()}`);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(temp, target);
  return { entry: target, meta, status: 'created' };
}

const command = process.argv[2];
if (command === 'verify') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--snapshot']));
  if (!f['--root'] || !f['--snapshot']) usage();
  try {
    verifySnapshotReceipt(resolve(f['--root']), readJson(resolve(f['--snapshot'])), SCRIPT_DIR);
    console.log('ok context snapshot');
  } catch (error) { die(error.message); }
} else if (command === 'delta') {
  const f = flags(process.argv.slice(3), new Set(['--from', '--to', '--out']));
  if (!f['--from'] || !f['--to'] || !f['--out']) usage();
  try {
    atomicWrite(resolve(f['--out']), `${JSON.stringify(snapshotDelta(readJson(resolve(f['--from'])), readJson(resolve(f['--to']))), null, 2)}\n`);
    console.log('ok context delta');
  } catch (error) { die(error.message); }
} else if (command === 'prepare') {
  const f = flags(
    process.argv.slice(3),
    new Set(['--root', '--out', '--cache', '--atlas', '--untracked', '--allow-untracked', '--previous', '--delta-out']),
    new Set(['--allow-untracked']),
  );
  if (!f['--root'] || !f['--out'] || !f['--cache']) usage();
  if (Boolean(f['--previous']) !== Boolean(f['--delta-out'])) die('--previous and --delta-out must be supplied together', 2);
  if (f['--atlas'] && !safeRelative(f['--atlas'])) die('--atlas must be repository-relative', 2);
  const root = resolve(f['--root']);
  try {
    const policy = f['--untracked'] || 'metadata';
    const atlasConfig = normalizeAtlasConfig(root, f['--atlas']);
    const state = collectState(root, policy, f['--allow-untracked'] || [], atlasConfig);
    const generator = generatorIdentity(SCRIPT_DIR);
    const snapshotId = snapshotIdFor(state, generator);
    const cache = buildCache(root, resolve(f['--cache']), snapshotId, generator, atlasConfig);
    const receipt = {
      version: 1,
      snapshotId,
      head: state.head,
      identity: state.identity,
      createdAt: new Date().toISOString(),
      state: {
        staged: state.staged,
        unstaged: state.unstaged,
        untracked: state.untracked,
        ignoredPolicy: 'excluded',
        completeness: state.completeness,
      },
      generator: { contextIndexVersion: CONTEXT_INDEX_VERSION, digests: generator },
      index: {
        cacheKey: snapshotId,
        status: cache.status,
        payloadSha256: digestJson(cache.meta.payloads),
      },
      atlas: {
        status: cache.meta.atlas.status,
        reportSha256: cache.meta.payloads.atlasState.sha256,
        config: atlasConfig,
      },
    };
    atomicWrite(resolve(f['--out']), `${JSON.stringify(receipt, null, 2)}\n`);
    if (f['--previous']) {
      atomicWrite(resolve(f['--delta-out']), `${JSON.stringify(snapshotDelta(readJson(resolve(f['--previous'])), receipt), null, 2)}\n`);
    }
    console.log(`ok context snapshot ${snapshotId} (${cache.status})`);
  } catch (error) { die(error.message); }
} else usage();
