#!/usr/bin/env node
// Agent ledger: records every subagent launch and every subagent report, so a tool can list the
// agents still unreported. A background agent reports only to the session that launched it, so
// when that session hands off or ends, its report is lost and the agent is forgotten. The ledger
// outlives the session.
//
//   node scripts/agent-ledger.mjs pending [--session <id>] [--cwd <path>] [--json]
//   co agents pending [--session <id>] [--json]
//
// `pending` prints one `<agent_id> <agent_type> <age> <description>` line per `dispatched` row with
// no `reported` or `failed` row, newest first, or `none`. Without `--session` it reads every recent session's file and
// keeps the launches made in the current directory (or `--cwd`).
//
// Library: `recordFromPayload(payload, { stateDir })` is the hook's whole write path, and
// `pendingAgents({ sessionId, stateDir, cwd, now, maxAgeMs })` is the read path. The hook
// `hooks/agent-ledger.mjs` calls the first; the handoff draft and the compaction restore call the
// second.
//
// STORAGE. One append-only JSONL file per parent session at
// `<home>/.claude/code-ops/agents/<sha256 session id>.jsonl`, in the directory family the
// dispatch guard uses. A row holds ids, the agent type, a description cut to 80 characters, the
// directory, and a timestamp. It never holds a prompt or message content. Reading is defensive:
// a malformed line is skipped.
//
// Imports node builtins only, so it vendors beside the hook without a dependency.

import { appendFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESCRIPTION_MAX = 80;
const DEFAULT_MAX_AGE_MS = 14 * 24 * 3_600_000;
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
const AGENT_ID_TEXT = /agentId:\s*([A-Za-z0-9]+)/;

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const isOff = () => /^(off|0|false)$/i.test(process.env.CODE_OPS_AGENT_LEDGER ?? '');

export function ledgerDir() {
  return join(process.env.CODE_OPS_HOME || homedir(), '.claude', 'code-ops', 'agents');
}

const ledgerFile = (stateDir, sessionId) => join(stateDir, `${sha256(sessionId)}.jsonl`);

// Every string inside a tool response, to a bounded depth. The host's text result carries the
// id as `agentId: <id>` when the structured field is absent.
function strings(value, depth = 0, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (depth < 4 && value && typeof value === 'object') {
    for (const item of Object.values(value)) strings(item, depth + 1, out);
  }
  return out;
}

function agentIdOf(response) {
  if (response && typeof response === 'object' && typeof response.agentId === 'string' && response.agentId) return response.agentId;
  for (const text of strings(response)) {
    const id = text.match(AGENT_ID_TEXT)?.[1];
    if (id) return id;
  }
  return null;
}

const oneLine = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, DESCRIPTION_MAX) : '');

// A SubagentStop that carries an error. The host's error field is UNVERIFIED, so this reads the
// shapes a stop could plausibly use and treats anything else as a normal report.
const stopFailed = (payload) => Boolean(payload.error) || payload.is_error === true
  || /^(error|failed|failure)$/i.test(String(payload.status ?? payload.stop_reason ?? ''));

// The rows one hook payload earns: none, one `dispatched` row, a `dispatched` row with its
// `reported` row for a foreground launch, or one `reported` or `failed` row. Statuses are the
// dispatch ledger's own (LEDGER_STATUSES in ledger-grammar.mjs), so the two stores can merge.
export function rowsFromPayload(payload, now = new Date()) {
  if (!payload || typeof payload !== 'object') return [];
  const session_id = payload.session_id ?? payload.sessionId;
  if (typeof session_id !== 'string' || !session_id) return [];
  const at = now.toISOString();
  const tool = payload.tool_name ?? payload.toolName;
  if (DISPATCH_TOOLS.has(tool)) {
    const input = payload.tool_input ?? payload.toolInput ?? {};
    const response = payload.tool_response ?? payload.toolResponse;
    const agent_id = agentIdOf(response);
    if (!agent_id) return [];
    const background = response?.status === 'async_launched' || input.run_in_background === true;
    const agent_type = typeof input.subagent_type === 'string' ? input.subagent_type : '';
    const dispatched = { status: 'dispatched', agent_id, agent_type, session_id, description: oneLine(input.description), background, cwd: String(payload.cwd ?? ''), launched_at: at };
    return background ? [dispatched] : [dispatched, { status: 'reported', agent_id, agent_type, session_id, reported_at: at }];
  }
  const hook = payload.hook_event_name ?? payload.hookEventName;
  if ((hook === 'SubagentStop' || (!hook && !tool)) && typeof payload.agent_id === 'string' && payload.agent_id
    && typeof payload.agent_type === 'string' && payload.agent_type) {
    return [{ status: stopFailed(payload) ? 'failed' : 'reported', agent_id: payload.agent_id, agent_type: payload.agent_type, session_id, reported_at: at }];
  }
  return [];
}

// Appends the rows a payload earns to its session's file. Returns the rows written.
export function recordFromPayload(payload, { stateDir = ledgerDir(), now } = {}) {
  if (isOff()) return [];
  const rows = rowsFromPayload(payload, now);
  if (!rows.length) return [];
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(ledgerFile(stateDir, payload.session_id ?? payload.sessionId), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return rows;
}

function readRows(path) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') rows.push(row);
    } catch { /* a torn line is skipped */ }
  }
  return rows;
}

const sameDir = (a, b) => {
  const norm = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  return Boolean(a) && Boolean(b) && norm(a) === norm(b);
};

// Launches with no report, newest first. With `sessionId`, reads that session only. Without it,
// reads every ledger file touched within `maxAgeMs` and keeps launches made in `cwd` when given.
export function pendingAgents({ sessionId, stateDir = ledgerDir(), cwd, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  let files;
  if (sessionId) files = [ledgerFile(stateDir, sessionId)];
  else {
    try { files = readdirSync(stateDir).filter((f) => f.endsWith('.jsonl')).map((f) => join(stateDir, f)); } catch { return []; }
    files = files.filter((f) => { try { return now - statSync(f).mtimeMs <= maxAgeMs; } catch { return false; } });
  }
  const pending = [];
  for (const file of files) {
    const rows = readRows(file);
    const settled = new Set(rows.filter((r) => (r.status === 'reported' || r.status === 'failed') && r.agent_id).map((r) => r.agent_id));
    const seen = new Set();
    for (const row of rows) {
      if (row.status !== 'dispatched' || !row.background || !row.agent_id || settled.has(row.agent_id) || seen.has(row.agent_id)) continue;
      seen.add(row.agent_id);
      if (!sessionId && cwd && !sameDir(row.cwd, cwd)) continue;
      const age_ms = Math.max(0, now - Date.parse(row.launched_at));
      pending.push({ status: 'dispatched', agent_id: row.agent_id, agent_type: row.agent_type ?? '', description: row.description ?? '', session_id: row.session_id ?? '', cwd: row.cwd ?? '', launched_at: row.launched_at, age_ms: Number.isFinite(age_ms) ? age_ms : 0 });
    }
  }
  return pending.sort((a, b) => Date.parse(b.launched_at) - Date.parse(a.launched_at));
}

export function formatAge(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export const formatLine = (a) => `${a.agent_id} ${a.agent_type || '-'} ${formatAge(a.age_ms)} ${a.description}`.trimEnd();

function cli(argv) {
  const usage = 'usage: agent-ledger.mjs pending [--session <id>] [--cwd <path>] [--json]';
  const [verb, ...rest] = argv;
  if (verb !== 'pending') { console.error(usage); return 2; }
  const opts = { json: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--json') opts.json = true;
    else if ((flag === '--session' || flag === '--cwd') && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--')) opts[flag.slice(2)] = rest[++i];
    else { console.error(usage); return 2; }
  }
  const list = pendingAgents({ sessionId: opts.session, cwd: opts.session ? undefined : opts.cwd ?? process.cwd() });
  if (opts.json) console.log(JSON.stringify(list, null, 2));
  else console.log(list.length ? list.map(formatLine).join('\n') : 'none');
  return 0;
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) process.exitCode = cli(process.argv.slice(2));
