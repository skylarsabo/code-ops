#!/usr/bin/env node
// MCP server smoke test — drives lib-docs-mcp.mjs over stdio (newline-delimited
// JSON-RPC) and asserts the protocol: initialize → tools/list (2 tools) → tools/call
// get-docs against a temp node_modules fixture returns the installed version + a type.
//
//   node evals/lib-docs/mcp-smoke.mjs   (exit 0 = pass)

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const server = resolve(here, '..', '..', 'scripts', 'lib-docs-mcp.mjs');

const root = mkdtempSync(join(tmpdir(), 'lib-docs-mcp-'));
const pkg = join(root, 'node_modules', 'acme-widgets');
mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'acme-widgets', version: '2.3.1', types: 'index.d.ts', description: 'Widgets.' }));
writeFileSync(join(pkg, 'README.md'), '# acme-widgets\n\nWidgets for Acme. A toolkit big enough to count as real documentation for the thin-check threshold to pass cleanly here.\n\n## Usage\n\n    makeWidget({ size: "lg" })\n');
writeFileSync(join(pkg, 'index.d.ts'), 'export declare function makeWidget(opts: { size: string }): { render(): string };\n');

const child = spawn('node', [server], { stdio: ['pipe', 'pipe', 'inherit'] });
const responses = new Map();
let buf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (c) => {
  buf += c;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { const m = JSON.parse(line); if (m.id !== undefined) responses.set(m.id, m); } catch { /* ignore */ }
  }
});

const w = (m) => child.stdin.write(JSON.stringify(m) + '\n');
w({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
w({ jsonrpc: '2.0', method: 'notifications/initialized' });
w({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
w({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get-docs', arguments: { library: 'acme-widgets', root, noFetch: true } } });

const deadline = Date.now() + 10000;
while (responses.size < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
child.stdin.end();
child.kill();
try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort temp cleanup */ }

const fails = [];
const expect = (c, m) => { if (!c) fails.push(m); };
const init = responses.get(1), list = responses.get(2), call = responses.get(3);
expect(init && init.result && init.result.serverInfo && init.result.serverInfo.name === 'code-ops-docs', 'initialize returns serverInfo code-ops-docs');
expect(list && list.result && Array.isArray(list.result.tools) && list.result.tools.length === 2, 'tools/list returns 2 tools');
expect(list && list.result && list.result.tools.some((t) => t.name === 'get-docs') && list.result.tools.some((t) => t.name === 'resolve-library'), 'tools are resolve-library + get-docs');
const text = call && call.result && call.result.content && call.result.content[0] && call.result.content[0].text || '';
expect(text.includes('2.3.1') && text.includes('makeWidget'), 'get-docs returns installed version + type export');

if (fails.length) {
  console.error('FAIL — MCP smoke test:');
  for (const f of fails) console.error('  x ' + f);
  console.error('responses: ' + JSON.stringify([...responses.values()]).slice(0, 600));
  process.exit(1);
}
console.log('PASS — MCP smoke: initialize + tools/list (2) + tools/call get-docs over stdio JSON-RPC.');
