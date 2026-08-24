#!/usr/bin/env node
// Validates and stamps a repository's sole authored-documentation registry.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { atomicWrite, pathMatchesGlob, safeRelative, sha256, toPosix } from './context-index-lib.mjs';

const REQUIRED = new Set(['architecture', 'contracts', 'data-model', 'engineering-standards', 'api-reference', 'ci-delivery', 'infrastructure', 'observability', 'design-system', 'guides', 'atlas']);
const TOP_KEYS = new Set(['version', 'hub', 'domains']);
const KEYS = new Set(['id', 'path', 'status', 'evidence', 'sources', 'sourceDigest', 'contentDigest']);
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
function inspect(root, manifest, hub) {
  const errors = [];
  for (const key of Object.keys(manifest)) if (!TOP_KEYS.has(key)) errors.push(`manifest has unknown key ${key}`);
  for (const key of TOP_KEYS) if (!(key in manifest)) errors.push(`manifest is missing ${key}`);
  if (manifest.version !== 1 || !safeRelative(hub) || !Array.isArray(manifest.domains)) errors.push('manifest must use version 1, a safe hub, and a domains array');
  const ids = new Set(); const paths = new Set(); const files = gitPaths(root, ['ls-files', '-co', '--exclude-standard', '-z']);
  for (const domain of manifest.domains || []) {
    for (const key of Object.keys(domain)) if (!KEYS.has(key)) errors.push(`${domain.id || 'domain'} has unknown key ${key}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(domain.id || '') || ids.has(domain.id)) errors.push(`invalid or duplicate domain id ${domain.id}`);
    ids.add(domain.id);
    if (!safeRelative(domain.path) || paths.has(domain.path.toLowerCase())) errors.push(`${domain.id} has invalid or duplicate path`);
    paths.add(domain.path.toLowerCase());
    if (!['current', 'not-applicable'].includes(domain.status)) errors.push(`${domain.id} has invalid status`);
    if (domain.status === 'not-applicable' && (!domain.evidence || domain.evidence.length < 40)) errors.push(`${domain.id} needs concrete not-applicable evidence`);
    if (!Array.isArray(domain.sources) || !domain.sources.length || domain.sources.some((pattern) => typeof pattern !== 'string' || !pattern)) errors.push(`${domain.id} needs source patterns`);
    const sources = files.filter((file) => domain.sources?.some((pattern) => pathMatchesGlob(pattern, file)) && !file.startsWith(`${hub}/`));
    const contents = contentPaths(root, hub, domain.path);
    if (!contents.length) errors.push(`${domain.id} target is missing or empty: ${domain.path}`);
    const expectedSource = hashPaths(root, sources); const expectedContent = hashPaths(root, contents);
    if (domain.sourceDigest !== expectedSource) errors.push(`${domain.id} source digest is stale`);
    if (domain.contentDigest !== expectedContent) errors.push(`${domain.id} content digest is stale`);
    domain._computed = { sourceDigest: expectedSource, contentDigest: expectedContent };
  }
  for (const id of REQUIRED) if (!ids.has(id)) errors.push(`missing required documentation domain ${id}`);
  const legacy = files.filter((file) => file.startsWith('docs/') && /\.md$/i.test(file));
  if (legacy.length) errors.push(`authored Markdown remains outside ${hub}: ${legacy.join(', ')}`);
  return errors;
}

const command = process.argv[2];
if (!['check', 'sync', 'plan'].includes(command)) usage();
const f = flags(process.argv.slice(3)); const root = resolve(f['--root'] || process.cwd());
const { path, manifest, hub } = findManifest(root); const errors = inspect(root, manifest, hub);
if (command === 'sync') {
  const structural = errors.filter((error) => !error.includes('digest is stale'));
  if (structural.length) die(`documentation manifest invalid:\n${structural.map((error) => `  - ${error}`).join('\n')}`);
  for (const domain of manifest.domains) { domain.sourceDigest = domain._computed.sourceDigest; domain.contentDigest = domain._computed.contentDigest; delete domain._computed; }
  atomicWrite(path, `${JSON.stringify(manifest, null, 2)}\n`); console.log(`ok documentation manifest synced (${manifest.domains.length} domains)`);
} else if (command === 'check') {
  if (errors.length) die(`documentation manifest invalid:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  console.log(`ok documentation manifest (${manifest.domains.length} domains)`);
} else {
  const changed = new Set([...gitPaths(root, ['diff', '--name-only', '-z', 'HEAD', '--']), ...gitPaths(root, ['ls-files', '--others', '--exclude-standard', '-z'])]);
  const plan = { version: 1, hub, manifestSha256: sha256(readFileSync(path)), changed: [...changed].sort(), domains: manifest.domains.map((domain) => ({ id: domain.id, path: `${hub}/${domain.path}`, affectedSources: [...changed].filter((file) => domain.sources.some((pattern) => pathMatchesGlob(pattern, file))).sort(), status: domain.status })).filter((domain) => domain.affectedSources.length) };
  for (const domain of manifest.domains) delete domain._computed;
  const output = `${JSON.stringify(plan, null, 2)}\n`; if (f['--out']) atomicWrite(resolve(f['--out']), output); else process.stdout.write(output);
}
