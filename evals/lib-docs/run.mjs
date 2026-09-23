#!/usr/bin/env node
// lib-docs engine eval — builds a throwaway node_modules fixture in a temp dir
// (node_modules is gitignored, so we synthesize it) and asserts the engine resolves
// the INSTALLED version, returns the topic-matched README section + extracted type
// exports, and stays local-only (--no-fetch, zero network). Per-ecosystem fixtures (npm
// lockfiles and workspaces, python, rust, go, dotnet) assert lockfile-first versions, the
// installed-source docs, a visible lockfile/installed mismatch, exit 3 with searched paths on
// a miss, and an explicit unsupported-ecosystem result. Caches are redirected through the
// tools' own env vars (CARGO_HOME, GOMODCACHE, NUGET_PACKAGES), so no real cache is read.
//
//   node evals/lib-docs/run.mjs   (exit 0 = pass)

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getDocs } from '../../scripts/lib-docs.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(here, '..', '..', 'scripts', 'lib-docs.mjs');

const root = mkdtempSync(join(tmpdir(), 'lib-docs-'));
const pkg = join(root, 'node_modules', 'acme-widgets');
mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, 'package.json'), JSON.stringify({
  name: 'acme-widgets', version: '2.3.1',
  description: 'Widgets for the Acme platform.',
  homepage: 'https://acme.example/widgets', types: 'index.d.ts',
}, null, 2));
writeFileSync(join(pkg, 'README.md'), [
  '# acme-widgets', '',
  'Widgets for the Acme platform — a small toolkit for building and rendering widgets.', '',
  '## Install', '', '    npm install acme-widgets', '',
  '## Usage', '',
  "    import { makeWidget } from 'acme-widgets';",
  "    const w = makeWidget({ size: 'lg', label: 'Hello' });",
  '    console.log(w.render());', '',
  '## API', '',
  'makeWidget(options) returns a Widget. See the bundled type declarations for the full surface.', '',
].join('\n'));
writeFileSync(join(pkg, 'index.d.ts'), [
  "export interface WidgetOptions { size: 'sm' | 'md' | 'lg'; label?: string; }",
  'export interface Widget { id: string; render(): string; }',
  'export declare function makeWidget(opts: WidgetOptions): Widget;',
].join('\n'));

const { fails, expect } = tally();
const tmp = mkdtempSync(join(tmpdir(), 'lib-docs-eco-'));
const env = { ...process.env, VIRTUAL_ENV: '', CARGO_HOME: join(tmp, 'cargo'), GOMODCACHE: join(tmp, 'gomod'), NUGET_PACKAGES: join(tmp, 'nuget') };
const run = (args) => spawnSync('node', [engine, ...args], { encoding: 'utf8', env });
const json = (args) => {
  const r = run([...args, '--json']);
  try { return { ...JSON.parse(r.stdout), exit: r.status }; } catch { return { exit: r.status, text: r.stdout + r.stderr }; }
};
const put = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const LONG = 'Real documentation paragraph long enough to clear the thin-docs threshold. '.repeat(4);

const r = run(['acme-widgets', 'usage', '--root', root, '--no-fetch']);
const out = r.stdout || '';
expect(r.status === 0, `exit 0, got ${r.status}`);
expect(out.includes('2.3.1'), 'resolves the installed version 2.3.1');
expect(out.includes('source: local'), 'reports local source (no fetch)');
expect(out.includes('makeWidget'), 'extracts the exported type signature');
expect(/##\s*Usage/i.test(out) && out.includes('makeWidget({'), 'returns the Usage section for the topic');
expect(!/##\s*Install/i.test(out), 'topic filter narrows the README (off-topic Install section excluded)');

const r2 = run(['no-such-lib-xyz', '--root', root, '--no-fetch']);
expect(/not installed/.test(r2.stdout || ''), 'reports not-installed for a missing lib under --no-fetch (zero network)');
expect(r2.status === 3, `a miss exits 3, got ${r2.status}`);
expect((r2.stdout || '').includes(join('node_modules', 'no-such-lib-xyz', 'package.json')), 'a miss lists the searched paths');

// A traversal-shaped name must be rejected, not resolved outside node_modules (SEC-001).
const r3 = run(['../../../etc', '--root', root, '--no-fetch']);
expect(/not a valid package name|not installed/.test(r3.stdout || ''), 'rejects a path-traversal library name');

// EVAL-006: the local-only guarantee must be enforced, not assumed. Stub fetch in-process and
// assert it is NEVER called on a thin package under noFetch, and IS attempted when opted in.
const thin = join(root, 'node_modules', 'thinpkg');
mkdirSync(thin, { recursive: true });
writeFileSync(join(thin, 'package.json'), JSON.stringify({ name: 'thinpkg', version: '0.0.1', homepage: 'https://example.com' }));
writeFileSync(join(thin, 'README.md'), 'tiny'); // < 200 chars => thin => exercises the fallback path
const realFetch = globalThis.fetch;
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; return { ok: true, body: null, text: async () => ('# fetched\n' + 'x'.repeat(300)) }; };
await getDocs({ library: 'thinpkg', root, noFetch: true });
expect(fetchCalls === 0, `no network under noFetch:true, got ${fetchCalls} fetch call(s)`);
await getDocs({ library: 'thinpkg', root, noFetch: false });
expect(fetchCalls >= 1, 'opt-in (noFetch:false) attempts the library-source fallback on a thin package');
globalThis.fetch = realFetch;

// npm: lockfile version first, from a workspace subpackage (walk up), with the hoisted
// installed copy supplying docs and the version mismatch kept visible.
const ws = join(tmp, 'npm-ws');
put(join(ws, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/acme-widgets': { version: '2.3.0' } } }));
put(join(ws, 'packages', 'app', 'package.json'), '{"name":"app"}');
put(join(ws, 'node_modules', 'acme-widgets', 'package.json'), JSON.stringify({ name: 'acme-widgets', version: '2.3.1', types: 'index.d.ts' }));
put(join(ws, 'node_modules', 'acme-widgets', 'index.d.ts'), 'export declare function makeWidget(): void;\n');
const npmWs = json(['acme-widgets', '--root', join(ws, 'packages', 'app')]);
expect(npmWs.exit === 0 && npmWs.ecosystem === 'npm', `npm workspace resolves (exit ${npmWs.exit})`);
expect(npmWs.version === '2.3.0' && npmWs.lockedVersion === '2.3.0' && npmWs.installedVersion === '2.3.1', 'npm: lockfile version first, installed version kept');
expect(/MISMATCH/.test(npmWs.text || '') && (npmWs.text || '').includes('makeWidget'), 'npm: mismatch visible, docs from the installed copy');
const LOCKS = [
  ['pnpm-lock.yaml', "lockfileVersion: '9.0'\n\npackages:\n\n  acme-widgets@2.3.1:\n    resolution: {integrity: sha512-x}\n"],
  ['yarn.lock', '# yarn lockfile v1\n\n"acme-widgets@^2.3.0", acme-widgets@^2.3.1:\n  version "2.3.1"\n  resolved "https://example.invalid/a.tgz"\n'],
];
for (const [file, body] of LOCKS) {
  const d = join(tmp, file);
  put(join(d, file), body);
  put(join(d, 'node_modules', 'acme-widgets', 'package.json'), JSON.stringify({ name: 'acme-widgets', version: '2.3.1' }));
  const res = json(['acme-widgets', '--root', d]);
  expect(res.lockedVersion === '2.3.1' && (res.lockFile || '').endsWith(file), `npm: ${file} parsed for the locked version`);
}
const noVer = join(tmp, 'npm-nover');
put(join(noVer, 'node_modules', 'bare', 'package.json'), '{"name":"bare"}');
const bare = json(['bare', '--root', noVer]);
expect(bare.exit === 3 && bare.version === null && !/@\?/.test(bare.text || ''), 'npm: a missing version is unresolved (exit 3), never "?"');

// python: uv.lock + .venv dist-info METADATA and .pyi stubs.
const py = join(tmp, 'py');
put(join(py, 'pyproject.toml'), '[project]\nname = "app"\n');
put(join(py, 'uv.lock'), 'version = 1\n\n[[package]]\nname = "acme-http"\nversion = "1.4.0"\n');
const sp = join(py, '.venv', 'lib', 'python3.12', 'site-packages');
put(join(sp, 'acme_http-1.4.0.dist-info', 'METADATA'), `Metadata-Version: 2.1\nName: acme-http\nVersion: 1.4.0\nSummary: HTTP for Acme.\n\n# acme-http\n\n${LONG}\n`);
put(join(sp, 'acme_http-1.4.0.dist-info', 'top_level.txt'), 'acme_http\n');
put(join(sp, 'acme_http', '__init__.pyi'), 'def get(url: str) -> bytes: ...\nclass Client: ...\n');
const pyRes = json(['acme-http', '--root', py]);
expect(pyRes.exit === 0 && pyRes.ecosystem === 'python' && pyRes.version === '1.4.0', `python resolves 1.4.0 from uv.lock (exit ${pyRes.exit})`);
expect(/def get\(url/.test(pyRes.text || '') && /Real documentation/.test(pyRes.text || ''), 'python: .pyi API and METADATA README surfaced');

// python miss: a requirements pin with no installed copy exits 3 and keeps the locked version.
const req = join(tmp, 'req');
put(join(req, 'requirements.txt'), 'requests==2.31.0\n');
const reqRes = json(['requests', '--root', req, '--ecosystem', 'py']);
expect(reqRes.exit === 3 && reqRes.source === 'none' && reqRes.lockedVersion === '2.31.0', 'python miss: exit 3, source none, requirements pin kept');
expect((reqRes.searched || []).some((p) => p.includes('site-packages')), 'python miss: searched site-packages paths reported');

// rust: Cargo.lock + the cargo registry source.
const rs = join(tmp, 'rs');
put(join(rs, 'Cargo.toml'), '[package]\nname = "app"\n');
put(join(rs, 'Cargo.lock'), 'version = 3\n\n[[package]]\nname = "app"\nversion = "0.1.0"\n\n[[package]]\nname = "serde"\nversion = "1.0.200"\n');
const crate = join(tmp, 'cargo', 'registry', 'src', 'index.crates.io-0000', 'serde-1.0.200');
put(join(crate, 'Cargo.toml'), '[package]\nname = "serde"\ndescription = "A serialization framework"\n');
put(join(crate, 'README.md'), `# serde\n\n${LONG}\n`);
put(join(crate, 'src', 'lib.rs'), 'pub trait Serialize {}\nfn private() {}\n');
const rsRes = json(['serde', '--root', rs]);
expect(rsRes.exit === 0 && rsRes.ecosystem === 'rust' && rsRes.version === '1.0.200', `rust resolves serde 1.0.200 from Cargo.lock (exit ${rsRes.exit})`);
expect(/pub trait Serialize/.test(rsRes.text || '') && !/fn private/.test(rsRes.text || ''), 'rust: only the pub API is extracted');

// go: go.mod + the case-encoded module cache.
const go = join(tmp, 'go');
put(join(go, 'go.mod'), 'module example.com/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/Acme/Kit v1.2.0\n)\n');
const gomod = join(tmp, 'gomod', 'github.com', '!acme', '!kit@v1.2.0');
put(join(gomod, 'kit.go'), 'package kit\n\nfunc New() *Kit { return nil }\nfunc helper() {}\ntype Kit struct{}\n');
put(join(gomod, 'README.md'), `# kit\n\n${LONG}\n`);
const goRes = json(['github.com/Acme/Kit', '--root', go]);
expect(goRes.exit === 0 && goRes.ecosystem === 'go' && goRes.version === 'v1.2.0', `go resolves v1.2.0 from go.mod (exit ${goRes.exit})`);
expect(/func New\(\)/.test(goRes.text || '') && !/func helper/.test(goRes.text || ''), 'go: only the exported API is extracted');

// dotnet: csproj PackageReference + the NuGet cache XML docs.
const net = join(tmp, 'net');
put(join(net, 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /></ItemGroup></Project>\n');
const nupkg = join(tmp, 'nuget', 'newtonsoft.json', '13.0.3');
put(join(nupkg, 'newtonsoft.json.nuspec'), '<package><metadata><id>Newtonsoft.Json</id><description>Json.NET</description></metadata></package>\n');
put(join(nupkg, 'lib', 'net6.0', 'Newtonsoft.Json.xml'), '<doc>\n<members>\n<member name="T:Newtonsoft.Json.JsonConvert">\n<summary>Converts.</summary>\n</member>\n</members>\n</doc>\n');
const netRes = json(['Newtonsoft.Json', '--root', net]);
expect(netRes.exit === 0 && netRes.ecosystem === 'dotnet' && netRes.version === '13.0.3', `dotnet resolves 13.0.3 from the csproj (exit ${netRes.exit})`);
expect(/JsonConvert/.test(netRes.text || ''), 'dotnet: XML doc members extracted');

// Unsupported: no supported manifest at the root, or an unknown explicit ecosystem.
const java = join(tmp, 'java');
put(join(java, 'pom.xml'), '<project/>\n');
const javaRes = run(['guava', '--root', java]);
expect(javaRes.status === 3 && /unsupported-ecosystem/.test(javaRes.stdout || ''), 'no supported manifest: unsupported-ecosystem, exit 3');
const explicit = json(['guava', '--root', py, '--ecosystem', 'java']);
expect(explicit.exit === 3 && /unsupported-ecosystem/.test(explicit.text || ''), 'unknown --ecosystem: unsupported-ecosystem, exit 3');

rmSync(tmp, { recursive: true, force: true });
rmSync(root, { recursive: true, force: true });
if (fails.length) {
  console.error('FAIL — lib-docs eval:');
  for (const f of fails) console.error('  x ' + f);
  console.error('\n--- output ---\n' + out);
  process.exit(1);
}
console.log('PASS — lib-docs eval: resolves installed version + topic README + type exports, local-only; npm/python/rust/go/dotnet lockfile-first, miss exit 3, unsupported-ecosystem.');
