#!/usr/bin/env node
// In-house "current docs" engine — a self-hosted, local-first answer to Context7.
// Resolves a library's INSTALLED version from the project and returns its real docs
// (README + exported type signatures) with ZERO network BY DEFAULT. The library-source
// fallback (llms.txt / GitHub README) is OPT-IN: pass --fetch (CLI) or noFetch:false (API).
// No third-party indexer, no query egress — you verify APIs against the version you run.
//
// WHY: an agent that trusts training-data memory for a library's API silently drifts from
// whatever version is actually installed; resolving docs from the installed package keeps every
// answer pinned to the code that will actually run, with no query leaving the machine
// unless the caller explicitly opts in to the fallback.
//
//   node lib-docs.mjs <library> [topic] [--root <repo>] [--ecosystem <name>] [--fetch] [--json]
//
// Ecosystems: npm (package-lock/pnpm-lock/yarn.lock + node_modules), python (uv.lock/
// poetry.lock/requirements pins + .venv site-packages), rust (Cargo.lock + the cargo registry
// source), go (go.mod/go.sum + the module cache), dotnet (packages.lock.json/PackageReference +
// the NuGet cache). --ecosystem (or a language alias such as ts, py, csharp) picks one;
// otherwise the manifests at --root decide. The lockfile version wins; the installed copy
// supplies the docs, and a lockfile/installed mismatch is printed.
//
// Exposes getDocs()/resolveLibrary() for the MCP server (lib-docs-mcp.mjs) to reuse.
//
// Exit: 0 = version resolved and docs printed; 3 = miss (not installed, version unresolved,
// invalid name, or unsupported-ecosystem), with the searched paths printed; 2 = usage error.

import { readFileSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, sep, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseOrDie, usage } from './cli-lib.mjs';

// Names are validated per ecosystem before any path join — no '..', no absolute paths — so
// resolution stays inside the lookup directories (SEC-001/BUG-005).
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9-._]*\/)?[a-z0-9][a-z0-9-._]*$/i;
export function validLibraryName(library, ecosystem = 'npm') {
  const eco = ECOSYSTEMS[ecosystem];
  return typeof library === 'string' && library.length > 0 && library.length <= 214 && !!eco && eco.name.test(library) && !library.includes('..');
}

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
const parseJson = (t) => { try { return JSON.parse(t); } catch { return null; } };
const ls = (d) => { try { return readdirSync(d); } catch { return []; } };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pyNorm = (s) => s.toLowerCase().replace(/[-_.]+/g, '-'); // PEP 503

// One parser per lockfile FORMAT, each (text, name) -> exact version | null. The ecosystem
// table maps file names onto these, so a format shared by several tools is parsed once.
const LOCK = {
  // Cargo.lock, uv.lock, and poetry.lock share the TOML [[package]] name/version block.
  // deferred(first match wins, pick by dependency path when a crate is locked at two versions)
  toml(text, name, norm = (s) => s) {
    for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
      const n = block.match(/^name\s*=\s*"([^"]+)"/m), v = block.match(/^version\s*=\s*"([^"]+)"/m);
      if (n && v && norm(n[1]) === norm(name)) return v[1];
    }
    return null;
  },
  npmJson(text, name) {
    const j = parseJson(text);
    return j?.packages?.[`node_modules/${name}`]?.version ?? j?.dependencies?.[name]?.version ?? null;
  },
  pnpm(text, name) { return text.match(new RegExp(`^\\s+'?/?${esc(name)}[@/](\\d[^\\s:('"]*)`, 'm'))?.[1] ?? null; },
  yarn(text, name) {
    for (const entry of text.split(/\r?\n\s*\r?\n/)) {
      const [head = '', ...rest] = entry.trim().split(/\r?\n/);
      const specs = head.replace(/:$/, '').split(/,\s*/).map((s) => s.replace(/^"|"$/g, ''));
      if (!specs.some((s) => s.startsWith(`${name}@`))) continue;
      const v = rest.join('\n').match(/^\s+version:?\s+"?([^"\s]+)"?/m);
      if (v) return v[1];
    }
    return null;
  },
  requirements(text, name) {
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*===?\s*([^\s;#,]+)/);
      if (m && pyNorm(m[1]) === pyNorm(name)) return m[2];
    }
    return null;
  },
  // go.mod require lines and go.sum hash lines both read "<module> v<version>".
  goMod(text, name) { return text.match(new RegExp(`^\\s*(?:require\\s+)?${esc(name)}\\s+(v[^\\s/]+)`, 'm'))?.[1] ?? null; },
  nugetJson(text, name) {
    for (const deps of Object.values(parseJson(text)?.dependencies || {})) {
      for (const [id, d] of Object.entries(deps || {})) if (id.toLowerCase() === name.toLowerCase() && d?.resolved) return d.resolved;
    }
    return null;
  },
  // deferred(attribute form only, parse a child <Version> element when a project needs it)
  msbuild(text, name) { return text.match(new RegExp(`<Package(?:Reference|Version)\\s+Include="${esc(name)}"[^>]*?\\sVersion="\\[?([^"\\],]+)`, 'i'))?.[1] ?? null; },
};

// Directories from root up to the enclosing repository root (the first one holding .git),
// so a workspace subpackage finds a hoisted node_modules and a root-level lockfile.
function upward(root) {
  const dirs = [];
  for (let d = resolve(root); ; d = dirname(d)) {
    dirs.push(d);
    if (existsSync(join(d, '.git')) || dirname(d) === d) return dirs;
  }
}

// A version-addressed cache (cargo, go, NuGet) is only searchable with a locked version.
function pickDir(locked, candidates, searched) {
  for (const d of candidates(locked || '<no locked version>')) {
    searched.push(d);
    if (locked && existsSync(d)) return d;
  }
  return null;
}

function npmInstalled(name, root, locked, searched) {
  for (const dir of upward(root)) {
    const d = join(dir, 'node_modules', name), pj = join(d, 'package.json');
    searched.push(pj);
    const meta = parseJson(read(pj));
    if (!meta) continue;
    const pkg = { dir: d, version: meta.version || null, description: meta.description || '', homepage: meta.homepage || '', repository: meta.repository || '', types: meta.types || meta.typings || null };
    return { ...pkg, readme: findReadme(d), apiFiles: [findTypes(pkg)].filter(Boolean) };
  }
  return null;
}

function pythonInstalled(name, root, locked, searched) {
  for (const base of [process.env.VIRTUAL_ENV, join(root, '.venv'), join(root, 'venv')].filter(Boolean)) {
    const sites = [join(base, 'Lib', 'site-packages'), ...ls(join(base, 'lib')).filter((n) => n.startsWith('python')).map((n) => join(base, 'lib', n, 'site-packages'))];
    for (const sp of sites) {
      searched.push(join(sp, `${name}-*.dist-info`));
      const info = ls(sp).find((e) => e.endsWith('.dist-info') && pyNorm(e.slice(0, -10).replace(/-[^-]*$/, '')) === pyNorm(name));
      if (!info) continue;
      const [head, ...body] = (read(join(sp, info, 'METADATA')) || '').split(/\r?\n\r?\n/);
      const field = (k) => head.match(new RegExp(`^${k}:\\s*(.+)$`, 'mi'))?.[1].trim() || '';
      const top = (read(join(sp, info, 'top_level.txt')) || '').split(/\r?\n/)[0].trim();
      const mod = /^[A-Za-z0-9_]+$/.test(top) ? top : name.toLowerCase().replace(/[-.]/g, '_');
      const modDir = join(sp, mod);
      const api = [join(modDir, '__init__.pyi'), ...ls(modDir).filter((f) => f.endsWith('.pyi')).map((f) => join(modDir, f)), join(sp, `${mod}.pyi`), join(modDir, '__init__.py')].find((p) => existsSync(p));
      return { dir: modDir, version: field('Version') || null, description: field('Summary'), homepage: field('Home-page') || head.match(/^Project-URL:[^,]*,\s*(\S+)/mi)?.[1] || '', repository: '', readme: findReadme(modDir), readmeText: body.join('\n\n'), apiFiles: api ? [api] : [] };
    }
  }
  return null;
}

function rustInstalled(name, root, locked, searched) {
  const src = join(process.env.CARGO_HOME || join(homedir(), '.cargo'), 'registry', 'src');
  const indexes = ls(src);
  const d = pickDir(locked, (v) => (indexes.length ? indexes : ['*']).map((i) => join(src, i, `${name}-${v}`)), searched);
  if (!d) return null;
  const toml = read(join(d, 'Cargo.toml')) || '';
  const field = (k) => toml.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] || '';
  return { dir: d, version: locked, description: field('description'), homepage: field('homepage'), repository: field('repository'), readme: findReadme(d), apiFiles: [join(d, 'src', 'lib.rs')].filter((p) => existsSync(p)) };
}

function goInstalled(name, root, locked, searched) {
  const cache = process.env.GOMODCACHE || join((process.env.GOPATH || '').split(delimiter)[0] || join(homedir(), 'go'), 'pkg', 'mod');
  const escaped = name.replace(/[A-Z]/g, (c) => '!' + c.toLowerCase()); // module cache case-encoding
  const d = pickDir(locked, (v) => [join(cache, `${escaped}@${v}`)], searched);
  if (!d) return null;
  const goFiles = ls(d).filter((f) => f.endsWith('.go') && !f.endsWith('_test.go')).map((f) => join(d, f));
  return { dir: d, version: locked, description: '', homepage: '', repository: '', readme: findReadme(d), apiFiles: goFiles };
}

function dotnetInstalled(name, root, locked, searched) {
  const cache = process.env.NUGET_PACKAGES || join(homedir(), '.nuget', 'packages');
  const d = pickDir(locked, (v) => [join(cache, name.toLowerCase(), v.toLowerCase())], searched);
  if (!d) return null;
  const spec = ls(d).filter((f) => f.endsWith('.nuspec')).map((f) => read(join(d, f)))[0] || '';
  const tag = (t) => spec.match(new RegExp(`<${t}>([^<]*)</${t}>`))?.[1].trim() || '';
  const lib = join(d, 'lib');
  const xml = ls(lib).sort().reverse().flatMap((t) => ls(join(lib, t)).filter((f) => f.endsWith('.xml')).map((f) => join(lib, t, f)))[0];
  return { dir: d, version: locked, description: tag('description'), homepage: tag('projectUrl'), repository: spec.match(/<repository[^>]*\burl="([^"]+)"/)?.[1] || '', readme: findReadme(d), apiFiles: xml ? [xml] : [] };
}

// The resolver table: detection markers, name shape, lockfiles (nearest directory wins),
// the API-line pattern for the docs extract, and the installed-source finder.
const ECOSYSTEMS = {
  npm: {
    aliases: ['node', 'js', 'javascript', 'ts', 'typescript', 'pnpm', 'yarn'],
    markers: ['package.json', 'node_modules', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'],
    name: NPM_NAME,
    locks: [['package-lock.json', LOCK.npmJson], ['npm-shrinkwrap.json', LOCK.npmJson], ['pnpm-lock.yaml', LOCK.pnpm], ['yarn.lock', LOCK.yarn]],
    api: /^(export|declare)\b/,
    installed: npmInstalled,
  },
  python: {
    aliases: ['py', 'pip', 'uv', 'poetry'],
    markers: ['pyproject.toml', 'uv.lock', 'poetry.lock', 'setup.py', 'setup.cfg', '.venv', /^requirements[\w.-]*\.txt$/],
    name: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    locks: [['uv.lock', (t, n) => LOCK.toml(t, n, pyNorm)], ['poetry.lock', (t, n) => LOCK.toml(t, n, pyNorm)], [/^requirements[\w.-]*\.txt$/, LOCK.requirements]],
    api: /^(async\s+def|def|class)\s/,
    installed: pythonInstalled,
  },
  rust: {
    aliases: ['cargo', 'rs'],
    markers: ['Cargo.toml', 'Cargo.lock'],
    name: /^[A-Za-z0-9_-]+$/,
    locks: [['Cargo.lock', LOCK.toml]],
    api: /^pub\s+(fn|struct|enum|trait|type|const|static|mod|use|macro)\b/,
    installed: rustInstalled,
  },
  go: {
    aliases: ['golang'],
    markers: ['go.mod'],
    name: /^[A-Za-z0-9][A-Za-z0-9._~-]*(\/[A-Za-z0-9._~-]+)*$/,
    locks: [['go.mod', LOCK.goMod], ['go.sum', LOCK.goMod]],
    api: /^(func\s+(\([^)]*\)\s*)?[A-Z]|type\s+[A-Z]|(const|var)\s+[A-Z])/,
    installed: goInstalled,
  },
  dotnet: {
    aliases: ['nuget', 'csharp', 'c#', 'cs', 'fsharp', 'f#', '.net'],
    markers: ['packages.lock.json', 'Directory.Packages.props', /\.(cs|fs|vb)proj$/, /\.sln$/],
    name: /^[A-Za-z0-9_][A-Za-z0-9._-]*$/,
    locks: [['packages.lock.json', LOCK.nugetJson], [/\.(cs|fs|vb)proj$/, LOCK.msbuild], ['Directory.Packages.props', LOCK.msbuild]],
    api: /^<member name="[TMPEF]:/,
    installed: dotnetInstalled,
  },
};

export function ecosystemFor(value) {
  const v = String(value || '').toLowerCase();
  return Object.keys(ECOSYSTEMS).find((k) => k === v || ECOSYSTEMS[k].aliases.includes(v)) || null;
}

function detect(root) {
  const names = ls(root);
  return Object.keys(ECOSYSTEMS).filter((k) => ECOSYSTEMS[k].markers.some((m) => (typeof m === 'string' ? names.includes(m) : names.some((n) => m.test(n)))));
}

function findLocked(ecosystem, name, root, searched) {
  for (const dir of upward(root)) {
    const files = ECOSYSTEMS[ecosystem].locks
      .flatMap(([f, parse]) => (typeof f === 'string' ? [f] : ls(dir).filter((n) => f.test(n))).map((n) => [join(dir, n), parse]))
      .filter(([p]) => existsSync(p));
    if (!files.length) continue;
    for (const [p, parse] of files) {
      searched.push(p);
      const text = read(p);
      const version = text && parse(text, name);
      if (version) return { file: p, version };
    }
    return null; // the nearest lockfile is authoritative: no entry there means not locked
  }
  searched.push(`(no ${ecosystem} lockfile from ${resolve(root)} up to the repository root)`);
  return null;
}

function resolveIn(ecosystem, library, root) {
  const searched = [];
  const base = { ecosystem, name: library, version: null, lockedVersion: null, lockFile: null, installedVersion: null, searched };
  if (!validLibraryName(library, ecosystem)) return { ...base, status: 'invalid-name' };
  const lock = findLocked(ecosystem, library, root, searched);
  const locked = lock?.version ?? null;
  const pkg = ECOSYSTEMS[ecosystem].installed(library, root, locked, searched);
  const version = locked ?? pkg?.version ?? null;
  return { ...base, status: !pkg ? 'not-installed' : version ? 'resolved' : 'unresolved', version, lockedVersion: locked, lockFile: lock?.file ?? null, installedVersion: pkg?.version ?? null, pkg };
}

// -> { status: resolved|unresolved|not-installed|invalid-name|unsupported-ecosystem, ecosystem,
//      name, version (lockfile first, null when unresolved), lockedVersion, lockFile,
//      installedVersion, searched[], pkg? }. A polyglot root tries every detected ecosystem.
export function resolveLibrary(library, root = '.', ecosystem = '') {
  root = resolve(root);
  const ecos = ecosystem ? [ecosystemFor(ecosystem)].filter(Boolean) : detect(root);
  if (!ecos.length) return { status: 'unsupported-ecosystem', ecosystem: ecosystem || null, name: library, version: null, searched: [root] };
  const results = ecos.map((e) => resolveIn(e, library, root));
  return results.find((r) => r.status === 'resolved') || results.find((r) => r.pkg) || results.find((r) => r.lockedVersion)
    || { ...results[0], searched: results.flatMap((r) => r.searched) };
}

// One-line summary (MCP resolve-library) or the full miss explanation.
export function describeResolution(r) {
  if (r.status === 'unsupported-ecosystem') {
    return `${r.name}: unsupported-ecosystem (${r.ecosystem ? `"${r.ecosystem}"` : `no supported manifest in ${r.searched[0]}`}). Supported: ${Object.keys(ECOSYSTEMS).join(', ')}.`;
  }
  if (r.status === 'invalid-name') return `${r.name}: not a valid package name (ecosystem: ${r.ecosystem}).`;
  const lock = r.lockFile ? `lockfile ${r.lockedVersion} (${r.lockFile})` : 'lockfile: none';
  if (!r.pkg) return [`${r.name}: not installed (ecosystem: ${r.ecosystem}; ${lock}). Searched:`, ...r.searched.map((p) => `  - ${p}`)].join('\n');
  const lines = [`${r.name}@${r.version ?? 'unresolved'} (ecosystem: ${r.ecosystem}; ${lock}; installed ${r.installedVersion ?? 'unknown'} at ${r.pkg.dir})`];
  if (r.lockedVersion && r.installedVersion && r.lockedVersion !== r.installedVersion) {
    lines.push(`MISMATCH: the lockfile pins ${r.lockedVersion} but ${r.installedVersion} is installed; the docs come from the installed copy.`);
  }
  if (r.status === 'unresolved') lines.push('Version unresolved: no lockfile entry and no installed version field.');
  return lines.join('\n');
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

function extractExports(text, pattern, max = 60) {
  const out = [];
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\r$/, '').trim();
    if (pattern.test(l)) out.push(l);
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

// -> the resolveLibrary() record minus `pkg`, plus { dir, source: local|local+fetched|none, text }.
export async function getDocs({ library, topic = '', root = '.', noFetch = true, maxLines = 160, ecosystem = '' }) {
  const r = resolveLibrary(library, root, ecosystem);
  const { pkg, ...info } = r;
  if (!pkg) return { ...info, source: 'none', text: describeResolution(r) };

  const parts = [`# ${r.name}@${r.version ?? 'unresolved'}  (source: local — installed)`, describeResolution(r)];
  if (pkg.description) parts.push(pkg.description);
  if (pkg.homepage) parts.push(`homepage: ${pkg.homepage}`);

  const readme = pkg.readme ? readPrefix(pkg.readme) : (pkg.readmeText || '');
  const apiText = pkg.apiFiles.map((f) => readPrefix(f, 64 * 1024)).join('\n');
  const exportsList = apiText ? extractExports(apiText, ECOSYSTEMS[r.ecosystem].api) : [];

  let thin = true;
  if (readme && readme.length > 200) { parts.push(`\n## README${topic ? ` (topic: ${topic})` : ''}\n${filterReadme(readme, topic, maxLines)}`); thin = false; }
  if (exportsList.length) { parts.push(`\n## Exported API\n${exportsList.join('\n')}`); thin = false; }

  let source = 'local';
  if (thin && !noFetch) {
    const fb = await fetchFallback(pkg, library, topic, maxLines);
    if (fb) { source = 'local+fetched'; parts.push(`\n## Fetched docs (${fb.url})\n${fb.text}`); }
  }
  if (thin && source === 'local') parts.push('\n(no substantial bundled README/API — re-run with --fetch to try the library source)');
  return { ...info, dir: pkg.dir, source, text: parts.join('\n') };
}

async function main() {
  const USAGE = 'usage: lib-docs.mjs <library> [topic] [--root <repo>] [--ecosystem <npm|python|rust|go|dotnet>] [--fetch] [--json]';
  // PRIV-001: local-only by default; opt in to the network fallback with --fetch. (--no-fetch
  // remains accepted as a harmless explicit form of the default.)
  const { flags, positional } = parseOrDie(process.argv.slice(2), {
    root: { value: true, default: '.', missing: 'needs a path' },
    ecosystem: { value: true, default: '', missing: 'needs a name' },
    fetch: {}, 'no-fetch': {}, json: {},
  }, USAGE);
  if (!flags.root.trim()) usage(['x --root needs a path', USAGE]);
  const [library, ...topic] = positional;
  if (!library) usage(USAGE);
  const res = await getDocs({ library, topic: topic.join(' '), root: flags.root, noFetch: !flags.fetch, ecosystem: flags.ecosystem });
  console.log(flags.json ? JSON.stringify(res, null, 2) : res.text);
  process.exitCode = res.status === 'resolved' ? 0 : 3;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
