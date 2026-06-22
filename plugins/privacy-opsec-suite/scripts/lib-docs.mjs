#!/usr/bin/env node
// In-house "current docs" engine — a self-hosted, local-first answer to Context7.
// Resolves a library's INSTALLED version from the project and returns its real docs
// (README + exported type signatures) with ZERO network by default; only fetches from
// the library's own source (llms.txt / GitHub README) as a fallback when bundled docs
// are thin. No third-party indexer, no query egress — you verify APIs against the
// version you actually run.
//
//   node lib-docs.mjs <library> [topic] [--root <repo>] [--no-fetch] [--json]
//
// Exposes getDocs()/resolveInstalled() for the MCP server (lib-docs-mcp.mjs) to reuse.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function resolveInstalled(library, root) {
  const dir = join(root, 'node_modules', library);
  const pj = join(dir, 'package.json');
  if (!existsSync(pj)) return null;
  let meta;
  try { meta = JSON.parse(readFileSync(pj, 'utf8')); } catch { return null; }
  return {
    dir,
    name: meta.name || library,
    version: meta.version || '?',
    description: meta.description || '',
    homepage: meta.homepage || '',
    repository: meta.repository || '',
    types: meta.types || meta.typings || null,
  };
}

function findReadme(dir) {
  for (const f of (existsSync(dir) ? readdirSync(dir) : [])) {
    if (/^readme(\.md|\.markdown|\.txt)?$/i.test(f)) return join(dir, f);
  }
  return null;
}

function findTypes(pkg) {
  if (pkg.types) { const p = join(pkg.dir, pkg.types); if (existsSync(p)) return p; }
  const idx = join(pkg.dir, 'index.d.ts');
  if (existsSync(idx)) return idx;
  for (const f of readdirSync(pkg.dir)) if (f.endsWith('.d.ts')) return join(pkg.dir, f);
  return null;
}

function extractExports(dts, max = 60) {
  const out = [];
  for (const raw of dts.split('\n')) {
    const l = raw.replace(/\r$/, '').trim();
    if (/^(export|declare)\b/.test(l) && !l.startsWith('//')) out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

function filterReadme(md, topic, maxLines = 160) {
  const lines = md.split('\n');
  if (!topic) return lines.slice(0, maxLines).join('\n');
  const t = topic.toLowerCase();
  const sections = [];
  let cur = null;
  for (const raw of lines) {
    const l = raw.replace(/\r$/, '');
    if (/^#{1,6}\s/.test(l)) { if (cur) sections.push(cur); cur = [l]; }
    else if (cur) cur.push(l);
  }
  if (cur) sections.push(cur);
  const hits = sections.filter((s) => s.join('\n').toLowerCase().includes(t));
  return (hits.length ? hits : sections).map((s) => s.join('\n')).join('\n').split('\n').slice(0, maxLines).join('\n');
}

async function fetchFallback(pkg, library, topic, maxLines) {
  const urls = [];
  if (pkg && pkg.homepage) urls.push(pkg.homepage.replace(/\/+$/, '') + '/llms.txt');
  const repo = pkg && (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url);
  const gh = repo && repo.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (gh) for (const br of ['main', 'master']) urls.push(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${br}/README.md`);
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) { const text = await r.text(); if (text && text.length > 80) return { url, text: filterReadme(text, topic, maxLines) }; }
    } catch { /* best-effort, non-fatal */ }
  }
  return null;
}

export async function getDocs({ library, topic = '', root = '.', noFetch = false, maxLines = 160 }) {
  root = resolve(root);
  const pkg = resolveInstalled(library, root);
  const parts = [];

  if (!pkg) {
    if (noFetch) return { source: 'none', text: `${library}: not installed under ${root}/node_modules (--no-fetch set).` };
    const fb = await fetchFallback({ homepage: '', repository: '' }, library, topic, maxLines);
    if (!fb) return { source: 'none', text: `${library}: not installed under ${root}/node_modules and no docs could be fetched.` };
    return { source: 'fetched', text: `# ${library}  (source: fetched — NOT installed; version unverified)\n\n## Fetched docs (${fb.url})\n${fb.text}` };
  }

  parts.push(`# ${pkg.name}@${pkg.version}  (source: local — installed)`);
  if (pkg.description) parts.push(pkg.description);
  if (pkg.homepage) parts.push(`homepage: ${pkg.homepage}`);

  const readmePath = findReadme(pkg.dir);
  const readme = readmePath ? readFileSync(readmePath, 'utf8') : '';
  const typesPath = findTypes(pkg);
  const exportsList = typesPath ? extractExports(readFileSync(typesPath, 'utf8')) : [];

  let thin = true;
  if (readme && readme.length > 200) { parts.push(`\n## README${topic ? ` (topic: ${topic})` : ''}\n${filterReadme(readme, topic, maxLines)}`); thin = false; }
  if (exportsList.length) { parts.push(`\n## Exported API (from types)\n${exportsList.join('\n')}`); thin = false; }

  let source = 'local';
  if (thin && !noFetch) {
    const fb = await fetchFallback(pkg, library, topic, maxLines);
    if (fb) { source = 'local+fetched'; parts.push(`\n## Fetched docs (${fb.url})\n${fb.text}`); }
  }
  if (thin && source === 'local') parts.push('\n(no substantial bundled README/types — re-run without --no-fetch to try the library source)');
  return { source, text: parts.join('\n') };
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const rootI = argv.indexOf('--root');
  const root = rootI >= 0 ? argv[rootI + 1] : '.';
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--root');
  const library = positional[0];
  const topic = positional.slice(1).join(' ');
  if (!library) { console.error('usage: lib-docs.mjs <library> [topic] [--root <repo>] [--no-fetch] [--json]'); process.exit(2); }
  const res = await getDocs({ library, topic, root, noFetch: flags.has('--no-fetch') });
  console.log(flags.has('--json') ? JSON.stringify(res, null, 2) : res.text);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
