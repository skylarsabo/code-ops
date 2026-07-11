#!/usr/bin/env node
// In-house "current docs" engine — a self-hosted, local-first answer to Context7.
// Resolves a library's INSTALLED version from the project and returns its real docs
// (README + exported type signatures) with ZERO network BY DEFAULT. The library-source
// fallback (llms.txt / GitHub README) is OPT-IN: pass --fetch (CLI) or noFetch:false (API).
// No third-party indexer, no query egress — you verify APIs against the version you run.
//
//   node lib-docs.mjs <library> [topic] [--root <repo>] [--fetch] [--json]
//
// Exposes getDocs()/resolveInstalled() for the MCP server (lib-docs-mcp.mjs) to reuse.

import { readFileSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Accept only real npm package specifiers — no path separators, no '..', no leading dot/underscore.
// This keeps resolution inside <root>/node_modules and blocks path traversal (SEC-001/BUG-005).
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9-._]*\/)?[a-z0-9][a-z0-9-._]*$/i;
export function validLibraryName(library) {
  return typeof library === 'string' && library.length > 0 && library.length <= 214 && NPM_NAME.test(library) && !library.includes('..');
}

// Read at most maxBytes from a file (PERF-001): READMEs/.d.ts can be multi-MB but we only
// ever surface the first ~160/60 lines, so never load the whole file into memory.
function readPrefix(path, maxBytes = 256 * 1024) {
  try {
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(maxBytes);
      const n = readSync(fd, buf, 0, maxBytes, 0);
      return buf.subarray(0, n).toString('utf8');
    } finally { closeSync(fd); }
  } catch { return ''; }
}

export function resolveInstalled(library, root) {
  if (!validLibraryName(library)) return null;
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

export function findTypes(pkg) {
  if (pkg.types) {
    // SEC-001 (fix): a package-supplied `types` value must not escape the package dir
    // (e.g. "../../secret.d.ts"). Resolve and confine before reading it.
    const p = resolve(pkg.dir, pkg.types);
    const base = resolve(pkg.dir);
    if ((p === base || p.startsWith(base + sep)) && existsSync(p)) return p;
  }
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

// SEC-002: only fetch https URLs to public hosts — never a package-supplied http URL or a
// loopback/private/link-local host (an installed dependency must not be able to point the
// fallback at an internal endpoint).
export function safeFetchUrl(u) {
  let url;
  try { url = new URL(u); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const h = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0') return false;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h)) return false; // IPv6 ULA / link-local
  // SEC-002 (fix): IPv4-mapped/compatible IPv6 (e.g. ::ffff:7f00:1, the hex-normalized form the
  // WHATWG URL parser produces for [::ffff:127.0.0.1] / [::ffff:169.254.169.254]) slips past the
  // dotted-decimal IPv4 checks above. Reject any IPv6 literal that maps or embeds an IPv4 address.
  if (h.includes(':') && (/^::ffff:/i.test(h) || /\d{1,3}(\.\d{1,3}){3}/.test(h))) return false;
  return true;
}

export async function readCapped(resp, maxBytes = 256 * 1024) {
  const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;
  if (!reader) return (await resp.text()).slice(0, maxBytes);
  const dec = new TextDecoder();
  let out = '', received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    // SCR-013: enforce the cap on the appended bytes, not just at loop entry, so one oversized
    // chunk cannot blow past maxBytes.
    const room = maxBytes - received;
    const chunk = value.length > room ? value.subarray(0, room) : value;
    received += chunk.length;
    out += dec.decode(chunk, { stream: true });
    if (received >= maxBytes) break;
  }
  try { await reader.cancel(); } catch { /* best-effort */ }
  return out;
}

async function fetchFallback(pkg, library, topic, maxLines) {
  const candidates = [];
  if (pkg && pkg.homepage) candidates.push(pkg.homepage.replace(/\/+$/, '') + '/llms.txt');
  const repo = pkg && (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository && pkg.repository.url);
  const gh = repo && repo.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (gh) for (const br of ['main', 'master']) candidates.push(`https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${br}/README.md`);
  for (const url of candidates.filter(safeFetchUrl)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      if (r.ok) { const text = await readCapped(r); if (text && text.length > 80) return { url, text: filterReadme(text, topic, maxLines) }; }
    } catch { /* best-effort, non-fatal */ }
  }
  return null;
}

export async function getDocs({ library, topic = '', root = '.', noFetch = true, maxLines = 160 }) {
  root = resolve(root);
  if (!validLibraryName(library)) return { source: 'none', text: `${library}: not a valid package name.` };
  const pkg = resolveInstalled(library, root);
  if (!pkg) return { source: 'none', text: `${library}: not installed under ${root}/node_modules.` };

  const parts = [`# ${pkg.name}@${pkg.version}  (source: local — installed)`];
  if (pkg.description) parts.push(pkg.description);
  if (pkg.homepage) parts.push(`homepage: ${pkg.homepage}`);

  const readmePath = findReadme(pkg.dir);
  const readme = readmePath ? readPrefix(readmePath) : '';
  const typesPath = findTypes(pkg);
  const exportsList = typesPath ? extractExports(readPrefix(typesPath)) : [];

  let thin = true;
  if (readme && readme.length > 200) { parts.push(`\n## README${topic ? ` (topic: ${topic})` : ''}\n${filterReadme(readme, topic, maxLines)}`); thin = false; }
  if (exportsList.length) { parts.push(`\n## Exported API (from types)\n${exportsList.join('\n')}`); thin = false; }

  let source = 'local';
  if (thin && !noFetch) {
    const fb = await fetchFallback(pkg, library, topic, maxLines);
    if (fb) { source = 'local+fetched'; parts.push(`\n## Fetched docs (${fb.url})\n${fb.text}`); }
  }
  if (thin && source === 'local') parts.push('\n(no substantial bundled README/types — re-run with --fetch to try the library source)');
  return { source, text: parts.join('\n') };
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const rootI = argv.indexOf('--root');
  let root = '.';
  if (rootI >= 0) {
    root = argv[rootI + 1];
    if (root === undefined || root.startsWith('--')) { console.error('x --root needs a path'); process.exit(2); }
  }
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--root');
  const library = positional[0];
  const topic = positional.slice(1).join(' ');
  if (!library) { console.error('usage: lib-docs.mjs <library> [topic] [--root <repo>] [--fetch] [--json]'); process.exit(2); }
  // PRIV-001: local-only by default; opt in to the network fallback with --fetch. (--no-fetch
  // remains accepted as a harmless explicit form of the default.)
  const noFetch = !flags.has('--fetch');
  const res = await getDocs({ library, topic, root, noFetch });
  console.log(flags.has('--json') ? JSON.stringify(res, null, 2) : res.text);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
