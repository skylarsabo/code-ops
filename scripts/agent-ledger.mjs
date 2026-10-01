#!/usr/bin/env node
// Agent ledger: records every subagent launch and every subagent report, so a tool can list the
// agents still unreported. A background agent reports only to the session that launched it, so
// when that session hands off or ends, its report is lost and the agent is forgotten. The ledger
// outlives the session.
//
//   node scripts/agent-ledger.mjs pending [--session <id>] [--cwd <path>] [--run <dir>] [--unknown <reason>] [--json]
//   node scripts/agent-ledger.mjs settle <id> --failed --reason <text> [--session <id>] [--run <dir>]
//   co agents pending [--session <id>] [--json]
//   co agents settle <id> --failed --reason <text> [--session <id>]
//
// `pending` prints one `<agent_id> <agent_type> <age> <description>` line per `dispatched` row with
// no `reported` or `failed` row, newest first, or `none`. Without `--session` it reads every recent session's file and
// keeps the launches made in the current directory (or `--cwd`). With `--run` it also merges the
// run folder's `DISPATCH_LEDGER.md` rows still `dispatched`, deduped on actor id, and it prints the
// sources it read on stderr. It prints `unknown` only when `--unknown` carries a host signal that
// the ledger cannot be trusted; a missing file is an empty source.
//
// `settle` is the exit for a lost report: it appends a `failed` row with the reason, so a worker
// the operator abandons stops blocking the handoff draft.
//
// Library: `recordFromPayload(payload, { stateDir })` is the hook's whole write path, and
// `pendingAgents({ sessionId, stateDir, cwd, runDir, now, maxAgeMs, endedOnly })` is the read path
// (its `pendingReport` twin also returns the sources read). `settleAgent` is the settle path and
// `markSessionEnded({ sessionId, cwd, stateDir, now })` appends the SessionEnd marker. The hook
// `hooks/agent-ledger.mjs` calls the first; the handoff draft and the compaction restore call the
// second; `hooks/session-receipt.mjs` writes the marker and the startup card reads `endedOnly`.
//
// STORAGE. One append-only JSONL file per parent session at
// `<home>/.claude/code-ops/agents/<sha256 session id>.jsonl`, in the directory family the
// dispatch guard uses. A row holds ids, the agent type, a description cut to 80 characters, the
// directory, a timestamp, and the `report_path` parsed from the brief's `Report path:` line (the
// path only, see reportPathOf). It never holds a prompt or message content. Reading is defensive:
// a malformed line is skipped.
//
// ROUTING FIELDS. A `dispatched` row also carries `unit`, `requestedTier`, `requestedEffort`
// (parsed from the brief's `Unit:`, `Tier:`, and `Effort:` lines, with the label rule the dispatch
// guard uses for brief fields), `appliedModel` (the dispatch's `model` override, else the agent
// frontmatter `model:`), `appliedEffort` with `effortSource` (`workflow` for an `effort` option on the
// dispatch, `frontmatter` for the agent's `effort:`), and `flag` (`ok`, `under`, or `over`: the
// applied rung against the requested one). A field that is absent records `null`; none of them
// can fail the hook. `attemptOf` derives a unit's attempt from the rows, and `routingSummary` reads
// the rows back as the starvation and overuse advisories (advisory only, never a failure).
//
// HOSTS. A Grok SubagentStop carries camelCase `subagentId` and `subagentType` and no `agent_id`;
// `rowsFromPayload` maps them when the snake_case fields are absent.
//
// Imports node builtins only, so it vendors beside the hook without a dependency.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_ROW_RE, replayDispatchJournal } from './ledger-grammar.mjs';

const DESCRIPTION_MAX = 80;
const REASON_MAX = 200;
const CAPTURE_FILE = 'payload-keys.ndjson';
const CAPTURE_MAX_KEYS = 200;
const CAPTURE_KEY_MAX = 64;
const CAPTURE_FLAG = 'capture.on';
const CAPTURE_MAX_ENV = 30;
const CAPTURE_ENV_NAME = /^(CODEX|GROK|CLAUDE|OPENCODE)/i;
const CAPTURE_VALUE_FIELDS = ['hook_event_name', 'tool_name', 'agent_type', 'subagent_type'];
const DEFAULT_MAX_AGE_MS = 14 * 24 * 3_600_000;
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
const AGENT_ID_TEXT = /agentId:\s*([A-Za-z0-9]+)/;
const REPORT_PATH_MAX = 300;
const REPORT_PATH_LINE = /^[ \t>*-]*Report path:[ \t]*(.+?)[ \t]*$/im;
// A path, not prose: an absolute path, a relative one with a separator in its first word, or `~`.
const PATH_START = /^(?:[A-Za-z]:[\\/]|~?[\\/]|\.{1,2}[\\/]|[\w.-]+[\\/])/;
const FILE_END = /^(.+?\.[A-Za-z0-9]{1,8})(?=$|[\s)`"',;:])/;

const SAFE_AGENT = /^[A-Za-z0-9_-]{1,128}$/;
const TIER_RUNGS = ['light', 'mid', 'strong', 'premium', 'frontier'];
const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const UNIT_MAX = 80;
const MODEL_MAX = 64;
const JUDGMENT_AGENTS = new Set(['implementer', 'reviewer', 'tracer', 'verifier', 'privacy-reviewer']);
export const DEFAULT_PREMIUM_CEILING = 0.25;
// The fewest judgment dispatches before the overuse advisory can fire; a smaller sample is noise.
export const MIN_OVERUSE_DISPATCHES = 4;

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

// The path on a brief's `Report path:` line, or '' when the line is absent, says `none`, or holds
// prose. The value may carry spaces (a hub folder such as `80 Runs`) and trailing prose after the
// file, so it ends at the first file extension that a separator or a space follows. Path only: the
// rest of the brief is never read into a row.
export function reportPathOf(prompt) {
  if (typeof prompt !== 'string') return '';
  const value = REPORT_PATH_LINE.exec(prompt)?.[1]?.replace(/^[`'"]+/, '') ?? '';
  if (!PATH_START.test(value)) return '';
  const path = FILE_END.exec(value)?.[1] ?? (/\s/.test(value) ? '' : value.replace(/[`'",;:).]+$/, ''));
  return path.length <= REPORT_PATH_MAX && !/[\u0000-\u001f\u007f]/.test(path) ? path : '';
}

const oneLine = (value, max = DESCRIPTION_MAX) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// A SubagentStop that carries an error. The host's error field is UNVERIFIED, so this reads the
// shapes a stop could plausibly use and treats anything else as a normal report.
const stopFailed = (payload) => Boolean(payload.error) || payload.is_error === true
  || /^(error|failed|failure)$/i.test(String(payload.status ?? payload.stop_reason ?? ''));

// The value on a brief's `<label>:` line, or null. The label rule is the dispatch guard's briefHas:
// leading whitespace, one list marker, and bold markers may precede the label, and bold markers or a
// parenthetical may sit before the colon. Only the one line after the colon is read.
function briefLine(prompt, label) {
  if (typeof prompt !== 'string') return null;
  const re = new RegExp(`^[ \\t]*(?:(?:[-*]|\\d+\\.)[ \\t]+)?(?:\\*\\*|__)?${label}(?:\\*\\*|__)?[ \\t]*(?:\\([^)\\n]*\\))?[ \\t]*(?:\\*\\*|__)?[ \\t]*:[ \\t]*(?:\\*\\*|__)?[ \\t]*([^\\r\\n]*)`, 'im');
  const value = (re.exec(prompt)?.[1] ?? '').replace(/^[`'"]+/, '').replace(/(?:\*\*|__|[`'"])+[ \t]*$/, '').trim();
  return value || null;
}

// The first word of a brief value when it is one of `allowed`, lowercased, else null.
const wordIn = (value, allowed) => {
  const word = value?.split(/[\s,;:()]+/)[0]?.toLowerCase();
  return word && allowed.has(word) ? word : null;
};

// The `model:` and `effort:` of an agent's frontmatter, from `<agentsDir>/<name>.md`; an unknown or
// unsafe name, or a missing file, gives nulls.
function frontmatterOf(agentType, agentsDir) {
  const name = agentType.split(':').pop();
  if (!SAFE_AGENT.test(name)) return { model: null, effort: null };
  let text;
  try { text = readFileSync(join(agentsDir, `${name}.md`), 'utf8'); } catch { return { model: null, effort: null }; }
  const lines = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '').split(/\r?\n/);
  const field = (key) => lines.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '') || null;
  return { model: field('model'), effort: field('effort') };
}

// deferred(a local name map, upgrade path: read the dispatch rungs from model-tiers.mjs once the
// premium binding lands there). The rung a dispatch's model id or alias runs at: `sonnet` is the mid
// alias, a full Sonnet id is the strong binding, `opus` is premium, `fable` is frontier. An id this
// map does not know has no rung, so its flag is null.
export function rungOfModel(model) {
  const id = typeof model === 'string' ? model.trim().toLowerCase() : '';
  if (!id) return null;
  if (id.includes('haiku')) return 'light';
  if (id === 'sonnet') return 'mid';
  if (id.includes('sonnet')) return 'strong';
  if (id.includes('opus')) return 'premium';
  if (id.includes('fable')) return 'frontier';
  return null;
}

// The routing fields of one `dispatched` row. Brief lines are read for the unit, tier, and effort
// only; no other brief text is kept. Every field is null when its source is absent.
function routingOf(input, agentType, agentsDir) {
  const prompt = input.prompt;
  const fm = frontmatterOf(agentType, agentsDir);
  const option = typeof input.effort === 'string' && input.effort.trim() ? input.effort.trim().toLowerCase().slice(0, 16) : null;
  const appliedModel = typeof input.model === 'string' && input.model.trim() ? input.model.trim().slice(0, MODEL_MAX) : fm.model;
  const requestedTier = wordIn(briefLine(prompt, 'Tier'), new Set(TIER_RUNGS));
  const applied = rungOfModel(appliedModel);
  return {
    unit: oneLine(briefLine(prompt, 'Unit') ?? '', UNIT_MAX) || null,
    requestedTier,
    requestedEffort: wordIn(briefLine(prompt, 'Effort'), EFFORT_LEVELS),
    appliedModel: appliedModel ?? null,
    appliedEffort: option ?? fm.effort,
    effortSource: option ? 'workflow' : fm.effort ? 'frontmatter' : null,
    flag: requestedTier && applied ? ['under', 'ok', 'over'][Math.sign(TIER_RUNGS.indexOf(applied) - TIER_RUNGS.indexOf(requestedTier)) + 1] : null,
  };
}

// The rows one hook payload earns: none, one `dispatched` row, a `dispatched` row with its
// `reported` row for a foreground launch, or one `reported` or `failed` row. Statuses are the
// dispatch ledger's own (LEDGER_STATUSES in ledger-grammar.mjs), so the two stores can merge.
// `agentsDir` is where agent frontmatter lives; the default is the `agents` folder beside the
// plugin's `scripts` folder, which is the vendored copy's location.
export function rowsFromPayload(payload, now = new Date(), { agentsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents') } = {}) {
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
    const report_path = reportPathOf(input.prompt);
    const dispatched = { status: 'dispatched', agent_id, agent_type, session_id, description: oneLine(input.description), background, cwd: String(payload.cwd ?? ''), launched_at: at, ...(report_path && { report_path }), ...routingOf(input, agent_type, agentsDir) };
    return background ? [dispatched] : [dispatched, { status: 'reported', agent_id, agent_type, session_id, reported_at: at }];
  }
  const hook = payload.hook_event_name ?? payload.hookEventName;
  // Grok's SubagentStop carries `subagentId` and `subagentType` and no snake_case form.
  const agent_id = payload.agent_id || payload.subagentId;
  const agent_type = payload.agent_type || payload.subagentType;
  if ((hook === 'SubagentStop' || (!hook && !tool)) && typeof agent_id === 'string' && agent_id
    && typeof agent_type === 'string' && agent_type) {
    return [{ status: stopFailed(payload) ? 'failed' : 'reported', agent_id, agent_type, session_id, reported_at: at }];
  }
  return [];
}

// Appends the rows a payload earns to its session's file. Returns the rows written.
export function recordFromPayload(payload, { stateDir = ledgerDir(), now, agentsDir } = {}) {
  if (isOff()) return [];
  const rows = rowsFromPayload(payload, now, agentsDir ? { agentsDir } : undefined);
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

const isSettled = (row) => (row.status === 'reported' || row.status === 'failed') && row.agent_id;

// A session has ended when its file carries an `ended` marker and no launch after the last one, so
// a session resumed under the same id (and launching again) reads as live until it ends again.
function isEnded(rows) {
  const at = rows.findLastIndex((r) => r.status === 'ended');
  return at >= 0 && !rows.slice(at + 1).some((r) => r.status === 'dispatched');
}

// Appends one `ended` row to the session's ledger file: the SessionEnd marker that tells a later
// reader the session can no longer receive its workers' reports. Idempotent: a session already
// marked ended (no launch since) gains nothing. A session with no ledger file launched no worker,
// so it gets no file. Returns the row, or null when nothing was written.
export function markSessionEnded({ sessionId, cwd = '', stateDir = ledgerDir(), now = new Date() } = {}) {
  if (isOff() || typeof sessionId !== 'string' || !sessionId) return null;
  const file = ledgerFile(stateDir, sessionId);
  const rows = readRows(file);
  if (!rows.length || isEnded(rows)) return null;
  const row = { status: 'ended', session_id: sessionId, cwd: String(cwd ?? ''), ended_at: now.toISOString() };
  appendFileSync(file, JSON.stringify(row) + '\n');
  return row;
}

function ledgerFiles(stateDir) {
  try { return readdirSync(stateDir).filter((f) => f.endsWith('.jsonl')).map((f) => join(stateDir, f)); } catch { return []; }
}

// The `DISPATCH_LEDGER.md` rows of a run folder. The table holds no actor id: dispatch-ledger.mjs
// records it in the sibling journal (`<ledger>.journal.jsonl`, the path it builds in
// `journalPathFor`), on the `add` event and on a `redispatched` update. Rows come from the shared
// grammar (ledger-grammar.mjs), the same import the other ledger readers use; dispatch-ledger.mjs
// itself runs its CLI on import, so it cannot serve as the reader. A missing file is an empty source.
function readDispatch(runDir) {
  const path = join(runDir, 'DISPATCH_LEDGER.md');
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return { path, present: false, rows: [], mtime: null }; }
  const actors = new Map();
  try {
    for (const event of replayDispatchJournal(readFileSync(`${path}.journal.jsonl`, 'utf8')).events) {
      if (event.actorId && (event.op === 'add' || (event.op === 'update' && event.to === 'redispatched'))) actors.set(event.id, event.actorId);
    }
  } catch { /* no journal: the rows carry no actor id */ }
  const rows = [];
  for (const raw of text.split('\n')) {
    const match = LEDGER_ROW_RE.exec(raw.replace(/\r$/, '').trim());
    if (match) rows.push({ id: match[1], role: match[2], brief: match[3], status: match[5], actor: actors.get(match[1]) ?? null });
  }
  let mtime = null;
  try { mtime = statSync(path).mtimeMs; } catch { /* the age stays unknown */ }
  return { path, present: true, rows, mtime };
}

// Launches with no report, newest first, with the sources read. With `sessionId`, reads that
// session's hook file only. Without it, reads every hook file touched within `maxAgeMs` and keeps
// launches made in `cwd` when given. With `runDir`, it always merges that run folder's dispatch rows
// still `dispatched`: hook rows win, a dispatch row whose actor id matches a hook row (or whose
// actor id or `D-NNN` id a hook report already settled) drops out. Each entry names its `source`.
// `unknown` is a reason string for a host signal that the ledger cannot be trusted; the report
// carries it, and a missing file never sets it. `endedOnly` keeps hook launches from sessions whose
// file carries an `ended` marker (see markSessionEnded), so a live session's workers in the same
// directory are not reported as abandoned. `ended` rows are markers, never agents.
//
// deferred(a dispatch row has no launch time, so its age is a floor from the ledger file mtime,
// upgrade path: stamp a launch time in the journal add event).
export function pendingReport({ sessionId, stateDir = ledgerDir(), cwd, runDir, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS, unknown, endedOnly = false } = {}) {
  let files = sessionId ? [ledgerFile(stateDir, sessionId)] : ledgerFiles(stateDir);
  if (!sessionId) files = files.filter((f) => { try { return now - statSync(f).mtimeMs <= maxAgeMs; } catch { return false; } });
  const agents = [];
  const settledAll = new Set();
  let hookRows = 0;
  for (const file of files) {
    const rows = readRows(file);
    hookRows += rows.length;
    const settled = new Set(rows.filter(isSettled).map((r) => r.agent_id));
    for (const id of settled) settledAll.add(id);
    if (endedOnly && !isEnded(rows)) continue;
    const seen = new Set();
    for (const row of rows) {
      if (row.status !== 'dispatched' || !row.background || !row.agent_id || settled.has(row.agent_id) || seen.has(row.agent_id)) continue;
      seen.add(row.agent_id);
      if (!sessionId && cwd && !sameDir(row.cwd, cwd)) continue;
      const age_ms = Math.max(0, now - Date.parse(row.launched_at));
      agents.push({ source: 'hook', status: 'dispatched', agent_id: row.agent_id, agent_type: row.agent_type ?? '', description: row.description ?? '', session_id: row.session_id ?? '', cwd: row.cwd ?? '', report_path: row.report_path ?? '', launched_at: row.launched_at, age_ms: Number.isFinite(age_ms) ? age_ms : 0 });
    }
  }
  const sources = [{ source: 'hook', path: stateDir, rows: hookRows }];
  if (runDir) {
    const dispatch = readDispatch(runDir);
    sources.push({ source: 'dispatch', path: dispatch.path, rows: dispatch.rows.length, present: dispatch.present });
    const known = new Set(agents.map((a) => a.agent_id));
    const launched_at = dispatch.mtime === null ? '' : new Date(dispatch.mtime).toISOString();
    const age_ms = dispatch.mtime === null ? 0 : Math.max(0, now - dispatch.mtime);
    for (const row of dispatch.rows) {
      const agent_id = row.actor ?? row.id;
      if (row.status !== 'dispatched' || known.has(agent_id) || settledAll.has(agent_id) || settledAll.has(row.id)) continue;
      known.add(agent_id);
      agents.push({ source: 'dispatch', status: 'dispatched', agent_id, dispatch_id: row.id, agent_type: row.role, description: row.brief, session_id: '', cwd: '', report_path: '', launched_at, age_ms });
    }
  }
  agents.sort((a, b) => Date.parse(b.launched_at) - Date.parse(a.launched_at) || 0);
  return { agents, sources, unknown: unknown || null };
}

export const pendingAgents = (options) => pendingReport(options).agents;

// The rows of one session's file, or of every file in the state dir without `sessionId`. The
// read side of `attemptOf` and `routingSummary`.
export function ledgerRows({ sessionId, stateDir = ledgerDir() } = {}) {
  return (sessionId ? [ledgerFile(stateDir, sessionId)] : ledgerFiles(stateDir)).flatMap(readRows);
}

// The attempt number a new dispatch of `unit` would be: one more than the dispatches of that unit
// that failed or were redispatched. A `failed` row carries no unit of its own, so it joins its
// unit through the `dispatched` row with the same agent id; each such agent counts once. A unit
// with no history, and a row set with no unit, is attempt 1.
export function attemptOf(rows, unit) {
  if (typeof unit !== 'string' || !unit || !Array.isArray(rows)) return 1;
  const unitOf = new Map(rows.filter((r) => r.unit && r.agent_id).map((r) => [r.agent_id, r.unit]));
  const spent = new Set();
  rows.forEach((r, i) => {
    if ((r.status === 'failed' || r.status === 'redispatched') && (r.unit ?? unitOf.get(r.agent_id)) === unit) spent.add(r.agent_id ?? r.id ?? i);
  });
  return spent.size + 1;
}

// The routing advisories over `dispatched` rows, each agent once. Judgment dispatches are the
// strong-floor agents. `triggered` is the judgment dispatches that asked for premium or frontier
// (`requestedTier`), or the ones `options.triggered(row)` selects; a triggered dispatch whose applied
// rung is below premium is starved. `premium` counts judgment dispatches applied at premium or
// above, and the overuse advisory fires when its share of judgment dispatches exceeds `ceiling`
// (a guess until ledgers measure it) and there are at least `MIN_OVERUSE_DISPATCHES` of them; below
// that a share is noise, so the line prints the counts without the verdict. Advisory only: it
// returns text, and nothing here fails.
//
// deferred(the ledger stores the requested tier, not the guard's computed trigger, so a lead that
// never asks for premium reads as triggered 0, upgrade path: stamp the guard's derived trigger on
// the row and pass it as options.triggered).
export function routingSummary(rows, { ceiling = DEFAULT_PREMIUM_CEILING, triggered = (r) => r.requestedTier === 'premium' || r.requestedTier === 'frontier' } = {}) {
  const seen = new Set();
  const judgment = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (r.status !== 'dispatched' || !JUDGMENT_AGENTS.has(String(r.agent_type ?? '').split(':').pop())) return false;
    if (!r.agent_id) return true;
    return !seen.has(r.agent_id) && Boolean(seen.add(r.agent_id));
  });
  const atPremium = (r) => TIER_RUNGS.indexOf(rungOfModel(r.appliedModel)) >= TIER_RUNGS.indexOf('premium');
  const premium = judgment.filter(atPremium).length;
  const asked = judgment.filter(triggered);
  const starvedCount = asked.filter((r) => !atPremium(r)).length;
  const share = judgment.length ? premium / judgment.length : 0;
  const starved = starvedCount > 0;
  const overused = judgment.length >= MIN_OVERUSE_DISPATCHES && share > ceiling;
  const advisories = [];
  if (starved) advisories.push(`advisory: routing starved - ${starvedCount} of ${asked.length} triggered judgment dispatch(es) ran below premium`);
  if (overused) advisories.push(`advisory: routing overuse - premium share ${Math.round(share * 100)}% (${premium} of ${judgment.length} judgment dispatches) is above the ${Math.round(ceiling * 100)}% ceiling`);
  const verdict = [starved && 'STARVED', overused && 'OVERUSED'].filter(Boolean).join('/') || 'ok';
  return { judgment: judgment.length, triggered: asked.length, premium, share, ceiling, starved, overused, advisories, line: `Routing: ${judgment.length} judgment, ${asked.length} triggered, ${premium} premium -> ${verdict}` };
}

// Appends a `failed` row with the operator's reason for a worker whose report was lost. The row
// lands in the launching session's file, so every reader of that session sees the agent settled.
// An id only a dispatch row knows has no session to write to, so it needs `sessionId`. Throws on a
// missing reason, an unknown id, or an id that already reported.
export function settleAgent({ agentId, reason, sessionId, stateDir = ledgerDir(), runDir, now = new Date() } = {}) {
  const why = oneLine(reason, REASON_MAX);
  if (typeof agentId !== 'string' || !agentId) throw new Error('settle needs an agent id');
  if (!why) throw new Error('settle needs a non-empty reason');
  let launch = null;
  let done = false;
  for (const file of sessionId ? [ledgerFile(stateDir, sessionId)] : ledgerFiles(stateDir)) {
    const rows = readRows(file);
    const row = rows.find((r) => r.status === 'dispatched' && r.agent_id === agentId);
    if (!row) continue;
    if (rows.some((r) => isSettled(r) && r.agent_id === agentId)) done = true;
    else { launch = row; break; }
  }
  const session = sessionId ?? launch?.session_id;
  let agent_type = launch?.agent_type ?? '';
  if (!launch) {
    if (done) throw new Error(`agent ${agentId} already reported or failed`);
    const dispatched = runDir ? readDispatch(runDir).rows.find((r) => r.status === 'dispatched' && (r.actor ?? r.id) === agentId) : null;
    if (!dispatched) throw new Error(`unknown agent id ${agentId}: no pending launch in the agent ledger${runDir ? ' or the dispatch ledger' : ''}`);
    if (!session) throw new Error(`agent ${agentId} is known only from a dispatch row, which has no session; pass --session <id>`);
    agent_type = dispatched.role;
  }
  if (!session) throw new Error(`agent ${agentId} has no session id; pass --session <id>`);
  const failed = { status: 'failed', agent_id: agentId, agent_type, session_id: session, reported_at: now.toISOString(), reason: why, by: 'settle' };
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(ledgerFile(stateDir, session), JSON.stringify(failed) + '\n');
  return failed;
}

// Key paths of a payload, never a value: nested object keys to a bounded depth, arrays folded into
// `[]`, each key cut and the list capped. A map keyed by user data could still name a key that is
// data, which the cut and the cap bound.
function keyPaths(value, prefix = '', depth = 0, out = new Set()) {
  if (out.size >= CAPTURE_MAX_KEYS || !value || typeof value !== 'object' || depth > 3) return out;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 3)) keyPaths(item, `${prefix}[]`, depth + 1, out);
    return out;
  }
  for (const [key, item] of Object.entries(value)) {
    if (out.size >= CAPTURE_MAX_KEYS) break;
    const path = `${prefix}${prefix ? '.' : ''}${key.slice(0, CAPTURE_KEY_MAX)}`;
    out.add(path);
    keyPaths(item, path, depth + 1, out);
  }
  return out;
}

// Capture is on when `CODE_OPS_AGENT_LEDGER_CAPTURE` is `1`, `true`, or `on`, or when a flag file
// `capture.on` exists in the state dir. The flag file lets an operator switch capture on for a host
// whose hooks do not inherit the shell environment: `New-Item <state dir>\capture.on` to start,
// delete the file to stop. Off by default.
export function captureOn({ stateDir = ledgerDir(), env = process.env } = {}) {
  if (/^(1|true|on)$/i.test(env.CODE_OPS_AGENT_LEDGER_CAPTURE ?? '')) return true;
  try { return existsSync(join(stateDir, CAPTURE_FLAG)); } catch { return false; }
}

// The host, read from environment variable NAMES only, never a value: Grok when `GROK_PLUGIN_ROOT`
// is set, else Codex, Claude, or OpenCode by name prefix, else `other`.
function hostOf(env) {
  if (env.GROK_PLUGIN_ROOT) return 'grok';
  const names = Object.keys(env);
  if (names.some((name) => name.startsWith('CODEX_'))) return 'codex';
  if (names.some((name) => name.startsWith('CLAUDE_'))) return 'claude';
  if (names.some((name) => name.startsWith('OPENCODE'))) return 'opencode';
  return 'other';
}

// The only values capture records: top-level scalar names that carry no user content. Each is a
// string cut to CAPTURE_KEY_MAX; any other field, and any non-string, is never recorded as a value.
function allowedValues(payload) {
  const values = {};
  for (const field of CAPTURE_VALUE_FIELDS) {
    if (typeof payload[field] === 'string') values[field] = payload[field].slice(0, CAPTURE_KEY_MAX);
  }
  return values;
}

// Opt-in capture (see captureOn, off by default): appends one line per distinct host, key-path
// list, and allowlisted-value set to `payload-keys.ndjson` in the state dir, so a host whose
// payload the repository has never seen can be checked without storing a prompt or a message. A
// line is `{at, host, envNames, values, keys}`: `envNames` lists up to 30 environment variable
// names that start with CODEX, GROK, CLAUDE, or OPENCODE (names only), `values` holds the
// allowlisted fields (`hook_event_name`, `tool_name`, `agent_type`, `subagent_type`), and `keys`
// holds every key path. The file is not `.jsonl`, so `pendingAgents` never reads it as a ledger.
// Returns the keys, or null.
export function captureKeys(payload, { stateDir = ledgerDir(), now = new Date(), env = process.env } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !captureOn({ stateDir, env })) return null;
  const keys = [...keyPaths(payload)].sort();
  const values = allowedValues(payload);
  const host = hostOf(env);
  const envNames = Object.keys(env).filter((name) => CAPTURE_ENV_NAME.test(name)).sort().slice(0, CAPTURE_MAX_ENV);
  const path = join(stateDir, CAPTURE_FILE);
  mkdirSync(stateDir, { recursive: true });
  let prior = '';
  try { prior = readFileSync(path, 'utf8'); } catch { /* first capture */ }
  const shape = JSON.stringify({ host, values, keys });
  const seen = prior.split('\n').some((line) => {
    try { const row = JSON.parse(line); return JSON.stringify({ host: row.host, values: row.values, keys: row.keys }) === shape; } catch { return false; }
  });
  if (!seen) appendFileSync(path, JSON.stringify({ at: now.toISOString(), host, envNames, values, keys }) + '\n');
  return keys;
}

export function formatAge(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export const formatLine = (a) => `${a.agent_id} ${a.agent_type || '-'} ${formatAge(a.age_ms)} ${a.description}`.trimEnd();

const describeSource = (s) => `${s.source} ${s.path} (${s.present === false ? 'missing' : `${s.rows} row(s)`})`;

// Parses `args` against the flags a verb takes: `bools` are bare, `values` take one non-flag value.
// Returns null on anything else, so the caller prints the usage line.
function parseArgs(args, { bools = [], values = [] }) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (bools.includes(flag)) opts[flag.slice(2)] = true;
    else if (values.includes(flag) && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) opts[flag.slice(2)] = args[++i];
    else return null;
  }
  return opts;
}

function cli(argv) {
  const usage = [
    'usage: agent-ledger.mjs pending [--session <id>] [--cwd <path>] [--run <dir>] [--unknown <reason>] [--json]',
    '       agent-ledger.mjs settle <id> --failed --reason <text> [--session <id>] [--run <dir>]',
  ].join('\n');
  const [verb, ...rest] = argv;
  if (verb === 'settle') {
    const [agentId, ...flags] = rest;
    const opts = agentId && !agentId.startsWith('--') ? parseArgs(flags, { bools: ['--failed'], values: ['--reason', '--session', '--run'] }) : null;
    if (!opts?.failed || !opts.reason) { console.error(`${usage}\nx settle needs an agent id, --failed, and --reason <text>`); return 2; }
    try {
      const row = settleAgent({ agentId, reason: opts.reason, sessionId: opts.session, runDir: opts.run ? resolve(opts.run) : undefined });
      console.log(`settled ${row.agent_id} as failed (session ${row.session_id}): ${row.reason}`);
      return 0;
    } catch (e) { console.error(`x ${e.message}`); return 1; }
  }
  const opts = verb === 'pending' ? parseArgs(rest, { bools: ['--json'], values: ['--session', '--cwd', '--run', '--unknown'] }) : null;
  if (!opts) { console.error(usage); return 2; }
  const report = pendingReport({ sessionId: opts.session, cwd: opts.session ? undefined : opts.cwd ?? process.cwd(), runDir: opts.run ? resolve(opts.run) : undefined, unknown: opts.unknown });
  console.error(`sources: ${report.sources.map(describeSource).join('; ')}`);
  if (opts.json) console.log(JSON.stringify(report.agents, null, 2));
  else console.log(report.agents.length ? report.agents.map(formatLine).join('\n') : report.unknown ? `unknown (${report.unknown})` : 'none');
  return 0;
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) process.exitCode = cli(process.argv.slice(2));
