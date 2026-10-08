#!/usr/bin/env node
// Regression eval for scripts/context-query-mcp.mjs, the stdio MCP wrapper over the symbol index.
//
//   node evals/context-query-mcp/run.mjs
//
// Reuses evals/context-query/fixture as a throwaway git repository and pins the contract:
//   - initialize answers with the server name code-ops-query;
//   - tools/list declares exactly context_query, context_refresh, and transcript_recall;
//   - transcript_recall answers a status and a search over a one-session transcript written under
//     a temporary home (never a real transcript), and a bad command, a missing session, and a
//     budget under the floor each come back as -32602;
//   - a tools/call for find over the fixture returns the query script's JSON as text content;
//   - status needs no target, and explore honours a budget;
//   - context_refresh re-indexes and reports the file count;
//   - an unknown command, an unknown tool, a missing target, and a bad budget each come back as
//     a JSON-RPC error, and the server still exits 0;
//   - an unknown method is -32601 and a non-string method is -32600.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectSlug } from '../../scripts/transcript-lib.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const server = join(root, 'scripts', 'context-query-mcp.mjs');
const fixture = join(root, 'evals', 'context-query', 'fixture');
const { fails, expect } = tally();

const work = mkdtempSync(join(tmpdir(), 'context-query-mcp-'));
const store = mkdtempSync(join(tmpdir(), 'context-index-mcp-'));
const home = mkdtempSync(join(tmpdir(), 'context-query-mcp-home-'));
const env = { ...process.env, CODE_OPS_INDEX_DIR: store, CODE_OPS_HOME: home, HOME: home, USERPROFILE: home };
delete env.CODE_OPS_INDEX;
delete env.CODE_OPS_RECALL;

const call = (name, args) => ({ method: 'tools/call', params: { name, arguments: args } });
// One server process answers the whole batch, which is also how a client uses it.
function speak(requests) {
  const input = requests.map((body, i) => JSON.stringify({ jsonrpc: '2.0', id: i + 1, ...body })).join('\n') + '\n';
  const r = spawnSync('node', [server], { input, encoding: 'utf8', cwd: work, env });
  const replies = new Map();
  for (const line of r.stdout.split('\n')) {
    if (!line.trim()) continue;
    try { const msg = JSON.parse(line); replies.set(msg.id, msg); } catch { fails.push(`the server wrote a non-JSON line: ${line}`); }
  }
  return { r, replies };
}
const payload = (reply) => { try { return JSON.parse(reply.result.content[0].text); } catch { return null; } };

try {
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=q', '-c', 'user.email=q@example.invalid', '-c', 'core.autocrlf=false', ...args], { cwd: work, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr}`);
  };
  git('init', '-q');
  cpSync(fixture, work, { recursive: true });
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');

  // ---------------------------------------------------------------- handshake and catalogue
  const { r: base, replies } = speak([
    { method: 'initialize', params: {} },
    { method: 'tools/list' },
    call('context_refresh', {}),
    call('context_query', { command: 'find', target: 'slugify' }),
    call('context_query', { command: 'status' }),
    call('context_query', { command: 'explore', target: 'slug', budget: 200 }),
  ]);
  expect(base.status === 0, `the server exits 0 on a clean close, got ${base.status}: ${base.stderr}`);
  expect(replies.get(1)?.result?.serverInfo?.name === 'code-ops-query', `initialize names the server, got ${JSON.stringify(replies.get(1))}`);
  const tools = (replies.get(2)?.result?.tools ?? []).map((t) => t.name);
  expect(tools.join(',') === 'context_query,context_refresh,transcript_recall', `tools/list declares the three tools, got ${tools.join(',')}`);
  console.log('ok   initialize and tools/list answer the contract');

  // ---------------------------------------------------------------- the tools answer
  expect(payload(replies.get(3))?.files === 11, `context_refresh indexes the fixture, got ${JSON.stringify(replies.get(3))}`);
  const found = payload(replies.get(4));
  expect(found?.definitions?.length === 2 && found.definitions.every((d) => d.name === 'slugify'), `find returns the query script's JSON, got ${JSON.stringify(replies.get(4))}`);
  expect(payload(replies.get(5))?.files === 11, `status answers without a target, got ${JSON.stringify(replies.get(5))}`);
  expect(payload(replies.get(6))?.truncated === true, `explore honours the budget, got ${JSON.stringify(replies.get(6))}`);
  console.log('ok   context_query and context_refresh return the query script\'s JSON');

  // ---------------------------------------------------------------- transcript_recall answers
  // A one-session transcript under the temporary home, where the script looks for it from cwd.
  const session = 'mcp-recall-session';
  const needle = '7d1e4c9a2b8f60351c7e9d4a2b6f8031c5e7a9d2';
  const rows = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: 'Check the invoice rounding.' } },
    { type: 'assistant', uuid: 'a1', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'git log --oneline -1' } }] } },
    { type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: `${needle} fix rounding` }] } },
  ];
  const projectDir = join(home, '.claude', 'projects', projectSlug(work));
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(projectDir, `${session}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const { r: recalled, replies: recall } = speak([
    call('transcript_recall', { command: 'status', session }),
    call('transcript_recall', { command: 'search', session, terms: needle }),
  ]);
  expect(recalled.status === 0, `the recall batch exits 0, got ${recalled.status}: ${recalled.stderr}`);
  expect(payload(recall.get(1))?.current === true && payload(recall.get(1)).nodes > 1, `transcript_recall status reports a current index, got ${JSON.stringify(recall.get(1))}`);
  const top = payload(recall.get(2))?.results?.[0];
  expect(Boolean(top?.id) && String(top.snippet).includes(needle), `transcript_recall search finds the planted SHA, got ${JSON.stringify(recall.get(2))}`);
  const { replies: zoomed } = speak([call('transcript_recall', { command: 'zoom', session, id: top?.id ?? '@0+0' })]);
  expect(payload(zoomed.get(1))?.verified === true && String(payload(zoomed.get(1)).text).includes(needle), `transcript_recall zoom returns the verified row, got ${JSON.stringify(zoomed.get(1))}`);
  console.log('ok   transcript_recall answers status, search, and zoom over a temporary transcript');

  // ---------------------------------------------------------------- errors stay JSON-RPC errors
  const { r: errored, replies: errors } = speak([
    call('context_query', { command: 'bogus', target: 'slugify' }),
    call('context_query', { command: 'find' }),
    call('context_query', { command: 'explore', target: 'slug', budget: 4 }),
    call('context_refresh', { paths: [17] }),
    call('context_nothing', {}),
    { method: 'no/such/method' },
    { method: 17 },
    call('transcript_recall', { command: 'bogus', session: 'x' }),
    call('transcript_recall', { command: 'status' }),
    call('transcript_recall', { command: 'search', session: 'x', terms: 'a', budget: 100 }),
  ]);
  expect(errored.status === 0, `a batch of bad calls still exits 0, got ${errored.status}: ${errored.stderr}`);
  for (const [id, why] of [[1, 'an unknown command'], [2, 'a missing target'], [3, 'a budget under the floor'], [4, 'a non-string path'], [5, 'an unknown tool'], [8, 'an unknown recall command'], [9, 'a recall call with no session'], [10, 'a recall budget under the floor']]) {
    expect(errors.get(id)?.error?.code === -32602 && errors.get(id).result === undefined, `${why} is an Invalid-params error, got ${JSON.stringify(errors.get(id))}`);
  }
  expect(errors.get(6)?.error?.code === -32601, `an unknown method is Method-not-found, got ${JSON.stringify(errors.get(6))}`);
  expect(errors.get(7)?.error?.code === -32600, `a non-string method is an Invalid Request, got ${JSON.stringify(errors.get(7))}`);
  console.log('ok   every bad request answers with a JSON-RPC error and the server survives');
} finally {
  for (const dir of [work, store, home]) rmSync(dir, { recursive: true, force: true });
}

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\ncontext-query-mcp eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\ncontext-query-mcp eval passed');
