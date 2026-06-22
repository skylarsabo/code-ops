#!/usr/bin/env node
// Zero-dependency MCP (stdio) server wrapping lib-docs.mjs — the in-house, local-first
// "current docs" capability as an always-on, Context7-shaped tool. Newline-delimited
// JSON-RPC 2.0 over stdio. Tools: resolve-library, get-docs.

import { getDocs, resolveInstalled } from './lib-docs.mjs';

const SERVER = { name: 'code-ops-docs', version: '1.0.0' };
const TOOLS = [
  {
    name: 'resolve-library',
    description: 'Resolve a library to the version INSTALLED in this project (from node_modules). Returns name@version or that it is not installed.',
    inputSchema: {
      type: 'object',
      properties: { library: { type: 'string', description: 'package name, e.g. "zod" or "@scope/pkg"' }, root: { type: 'string', description: 'project root (default: cwd)' } },
      required: ['library'],
    },
  },
  {
    name: 'get-docs',
    description: 'Get current, version-accurate docs for a library from its INSTALLED version (README + exported type signatures), local-first; fetches from the library source only as a fallback. Use before coding against an unfamiliar API instead of relying on memory.',
    inputSchema: {
      type: 'object',
      properties: {
        library: { type: 'string' },
        topic: { type: 'string', description: 'optional focus, e.g. "streaming" or "auth"' },
        root: { type: 'string', description: 'project root (default: cwd)' },
        noFetch: { type: 'boolean', description: 'disable the network fallback (default false)' },
      },
      required: ['library'],
    },
  },
];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function callTool(name, args = {}) {
  const root = args.root || process.cwd();
  if (name === 'resolve-library') {
    const pkg = resolveInstalled(args.library, root);
    return pkg ? `${pkg.name}@${pkg.version}${pkg.homepage ? ` — ${pkg.homepage}` : ''}` : `${args.library}: not installed under ${root}/node_modules`;
  }
  if (name === 'get-docs') {
    const res = await getDocs({ library: args.library, topic: args.topic || '', root, noFetch: !!args.noFetch });
    return res.text;
  }
  throw new Error(`unknown tool: ${name}`);
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') return ok(id, { protocolVersion: (params && params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER });
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const text = await callTool(params && params.name, (params && params.arguments) || {});
      return ok(id, { content: [{ type: 'text', text }] });
    } catch (e) {
      return ok(id, { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true });
    }
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return; // fire-and-forget
  if (id !== undefined) fail(id, -32601, `method not found: ${method}`);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    Promise.resolve(handle(msg)).catch((e) => process.stderr.write(`handler error: ${e.message}\n`));
  }
});
process.stdin.on('end', () => process.exit(0));
