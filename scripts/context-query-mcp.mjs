#!/usr/bin/env node
// Zero-dependency MCP (stdio) server wrapping context-query.mjs, so a host with no Bash tool
// reaches the same symbol index. Newline-delimited JSON-RPC 2.0 over stdio. Tools:
// context_query, context_refresh, transcript_recall.
//
// WHY: the query tool's whole point is that an operative asks a structural question instead of
// reading a map. On a host that cannot run a shell command, that path does not exist at all, and
// the operative falls back to whole-file reads — the cost the index was built to remove.
//
//   node scripts/context-query-mcp.mjs   (invoked by an MCP client over stdio; not run standalone)
//
// Each call spawns the sibling context-query.mjs (transcript-recall.mjs for transcript_recall) with
// --json and returns its JSON as the tool's text content. A query that finds nothing still answers: the script prints its JSON and exits 1,
// and that JSON is the result. A bad argument or a usage error comes back as a JSON-RPC error
// object, never a process exit — one bad request must not kill a long-lived server.
//
// Exit: 0 on a clean stdin close, after in-flight calls drain (bounded to 10s).

import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUERY = fileURLToPath(new URL('./context-query.mjs', import.meta.url));
const RECALL = fileURLToPath(new URL('./transcript-recall.mjs', import.meta.url));
const COMMANDS = ['find', 'callers', 'callees', 'blast', 'explore', 'status'];
const RECALL_COMMANDS = ['status', 'outline', 'search', 'zoom'];
const SERVER = { name: 'code-ops-query', version: '1.0.0' };
const TIMEOUT_MS = 120000;

const TOOLS = [
  {
    name: 'context_query',
    description: 'Ask the symbol index a structural question and get file:line anchors, one-line signatures, and edge lists — never a verbatim dump. find: definitions of a symbol. callers/callees: resolved call edges. blast: importers of a path and its definitions with caller counts. explore: definitions and lines matching terms, within a byte budget. status: index age and the files changed since it was built.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: COMMANDS, description: 'the query to run' },
        target: { type: 'string', description: 'a symbol name or `path:name` pin for find, callers, and callees; a repository path for blast; search terms for explore; omitted for status' },
        budget: { type: 'integer', minimum: 200, description: 'explore only: byte budget for the answer (default 4000)' },
        fuzzy: { type: 'boolean', description: 'find only: match a substring of the symbol name' },
        root: { type: 'string', description: 'repository root (default: cwd)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'context_refresh',
    description: 'Re-index the repository so later queries answer from current files. Re-parses only files whose content changed; pass paths to re-parse just those.',
    inputSchema: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: 'repository paths to re-index (default: every tracked code file)' },
        root: { type: 'string', description: 'repository root (default: cwd)' },
      },
    },
  },
  {
    name: 'transcript_recall',
    description: 'Recover exact detail from this session\'s own host transcript after compaction, without reading the file. Every answer ends at the original bytes and carries their sha256; a changed transcript fails with "anchor drift". status: index state. outline: the labelled tree (session, epoch, turn, step, block) below an id. search: blocks ranked by terms, each with an id, a label, and a masked snippet. zoom: an interior id lists its children; a block id returns its masked text, paged. Output is masked and bounded by budget.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: RECALL_COMMANDS, description: 'the recall command to run' },
        session: { type: 'string', description: 'the host session id (the transcript file name without .jsonl)' },
        id: { type: 'string', description: 'outline and zoom: a node id such as @1648+294, a block uuid, or line:<n> (default for outline: the session)' },
        line: { type: 'integer', minimum: 1, description: 'zoom: the transcript line number of a block or of one of its results (a snapshot stub prints these)' },
        terms: { type: 'string', description: 'search: words to find; an exact identifier (a SHA, a path, an id, a test name) weighs more' },
        kind: { type: 'string', enum: ['text', 'tool', 'error'], description: 'search: count only text, tool input and output, or error results' },
        depth: { type: 'integer', minimum: 1, description: 'outline: levels below the id (default 1)' },
        page: { type: 'integer', minimum: 0, description: 'page of the answer (default 0)' },
        budget: { type: 'integer', minimum: 200, description: 'byte budget per page (default 4000)' },
        root: { type: 'string', description: 'repository root (default: cwd)' },
      },
      required: ['command', 'session'],
    },
  },
];

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

class BadArgs extends Error {}

// Exit 2 is the query script's usage error, so it is the caller's fault and becomes an
// Invalid-params error. Every other exit carries JSON on stdout and is a real answer.
function run(args, root, script = QUERY) {
  const name = basename(script);
  const r = spawnSync(process.execPath, [script, ...args, '--json'], { cwd: root, encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 1 << 26 });
  if (r.error) throw new Error(`${name} did not run: ${r.error.message}`);
  if (r.status === 2) throw new BadArgs((r.stderr || r.stdout || 'usage error').trim().split('\n')[0]);
  if (!r.stdout.trim()) throw new Error(`${name} exited ${r.status} with no output: ${(r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout;
}

function callTool(name, args) {
  const root = typeof args.root === 'string' && args.root ? args.root : process.cwd();
  if (name === 'context_query') {
    if (!COMMANDS.includes(args.command)) throw new BadArgs(`command must be one of ${COMMANDS.join(', ')}`);
    const needsTarget = args.command !== 'status';
    if (needsTarget && (typeof args.target !== 'string' || !args.target.trim())) throw new BadArgs(`${args.command} needs a non-empty target`);
    const flags = [];
    if (args.fuzzy === true) flags.push('--fuzzy');
    if (args.budget !== undefined) {
      if (!Number.isInteger(args.budget) || args.budget < 200) throw new BadArgs('budget must be an integer of at least 200');
      flags.push('--budget', String(args.budget));
    }
    return run([args.command, ...(needsTarget ? [args.target] : []), ...flags], root);
  }
  if (name === 'context_refresh') {
    const paths = args.paths ?? [];
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string' || !p.trim())) throw new BadArgs('paths must be an array of non-empty strings');
    return run(['refresh', ...paths], root);
  }
  if (name === 'transcript_recall') {
    if (!RECALL_COMMANDS.includes(args.command)) throw new BadArgs(`command must be one of ${RECALL_COMMANDS.join(', ')}`);
    if (typeof args.session !== 'string' || !args.session.trim()) throw new BadArgs('session must be a non-empty string');
    const flags = ['--session', args.session];
    for (const key of ['id', 'terms', 'kind']) {
      if (args[key] === undefined) continue;
      if (typeof args[key] !== 'string' || !args[key].trim()) throw new BadArgs(`${key} must be a non-empty string`);
      flags.push(`--${key}`, args[key]);
    }
    for (const [key, min] of [['line', 1], ['depth', 1], ['page', 0], ['budget', 200]]) {
      if (args[key] === undefined) continue;
      if (!Number.isInteger(args[key]) || args[key] < min) throw new BadArgs(`${key} must be an integer of at least ${min}`);
      flags.push(`--${key}`, String(args[key]));
    }
    return run([args.command, ...flags], root, RECALL);
  }
  throw new BadArgs(`unknown tool: ${name}`);
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') return ok(id, { protocolVersion: (params && params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER });
  if (method === 'ping') return ok(id, {});
  if (method === 'tools/list') return ok(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try {
      return ok(id, { content: [{ type: 'text', text: callTool(params && params.name, (params && params.arguments) || {}) }] });
    } catch (e) {
      // A caller's mistake is Invalid params; a failure inside the query script is Internal error.
      return fail(id, e instanceof BadArgs ? -32602 : -32603, e.message);
    }
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) return undefined;
  if (id !== undefined) {
    if (typeof method !== 'string') return fail(id, -32600, 'Invalid Request: "method" must be a string');
    return fail(id, -32601, `method not found: ${method}`);
  }
  return undefined;
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
    try { handle(msg); } catch (e) { process.stderr.write(`handler error: ${e.message}\n`); }
  }
});
process.stdin.on('end', () => process.exit(0));
