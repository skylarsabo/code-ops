// Transcript summarizer for the code-ops suite — reads the host's local session transcripts
// (JSONL) and returns exact token usage plus tool-output volume, with no model in the loop.
//
// WHY: the suite's only token figures were hand-entered notes (calibration-graph) or
// byte-over-four estimates. Every assistant message in a local transcript already carries
// exact `usage` (input, cache read, cache creation, output, thinking) and a model id.
// Reading that file costs no model tokens and never leaves the machine. This library is the
// shared parser behind `scripts/context-audit.mjs` (the CLI) and the SessionEnd receipt hook.
//
// Correctness notes, learned from real transcripts:
//   - One assistant message is written as SEVERAL lines (one per content block), each
//     repeating the same `message.id` and `usage`. Usage is deduplicated by message id, taking
//     the per-field maximum across the duplicates (the last chunk carries the final counts).
//   - Subagent transcripts live beside the session file: `<dir>/<sessionId>/subagents/*.jsonl`,
//     and their lines carry `isSidechain: true`. They are summarized separately from the main
//     thread because operative cost is the number the tiering doctrine needs.
//   - Tool results are attributed to the tool by `tool_use_id` → the earlier `tool_use` block
//     in the same file; a result whose call lives in another file lands in the `?` bucket.
//   - `messages.user` counts human turns only; tool-result carrier lines are excluded.
//
// Sanitized by default: labels are tool names, command families (first word plus a plain
// subcommand), and file extensions — never paths, arguments, or content. `raw: true` keeps a
// truncated command / path for local inspection only.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { homedir } from 'node:os';

export const USAGE_FIELDS = ['input', 'cacheRead', 'cacheCreate', 'output', 'thinking'];
export const UNKNOWN = 'UNKNOWN';

const emptyUsage = () => ({ input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0, total: 0 });

const tokenCount = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : UNKNOWN;
const tokenSum = (...counts) => counts.every((n) => typeof n === 'number') ? counts.reduce((a, b) => a + b, 0) : UNKNOWN;

// Categories are disjoint except thinking, which is a subset of output. Claude input
// excludes cache tokens; Codex input includes them. Missing telemetry stays UNKNOWN.
export function normalizeUsage(u, host = 'claude') {
  if (!u || typeof u !== 'object') return null;
  const cacheRead = tokenCount(host === 'codex' ? u.cached_input_tokens : u.cache_read_input_tokens);
  const cacheCreate = tokenCount(host === 'codex' ? u.cache_write_input_tokens : u.cache_creation_input_tokens);
  const reportedInput = tokenCount(u.input_tokens);
  const output = tokenCount(u.output_tokens);
  const thinking = tokenCount(host === 'codex' ? u.reasoning_output_tokens : u.output_tokens_details?.thinking_tokens);
  const input = host === 'codex'
    ? typeof reportedInput === 'number' && typeof cacheRead === 'number' && typeof cacheCreate === 'number'
      && reportedInput >= cacheRead + cacheCreate ? reportedInput - cacheRead - cacheCreate : UNKNOWN
    : reportedInput;
  const codexTotal = tokenSum(reportedInput, output);
  return { input, cacheRead, cacheCreate, output, thinking,
    total: host === 'codex' ? typeof codexTotal === 'number' ? codexTotal : tokenCount(u.total_tokens)
      : tokenSum(input, cacheRead, cacheCreate, output) };
}

export function addNormalizedUsage(into, u) {
  for (const k of [...USAGE_FIELDS, 'total']) into[k] = tokenSum(into[k], u[k]);
  return into;
}

function maxNormalizedUsage(into, u) {
  for (const k of [...USAGE_FIELDS, 'total']) {
    if (typeof u[k] === 'number') into[k] = typeof into[k] === 'number' ? Math.max(into[k], u[k]) : u[k];
  }
}

function usageOf(u) {
  if (!u || typeof u !== 'object') return null;
  return {
    input: Number(u.input_tokens) || 0,
    cacheRead: Number(u.cache_read_input_tokens) || 0,
    cacheCreate: Number(u.cache_creation_input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    thinking: Number(u.output_tokens_details?.thinking_tokens) || 0,
  };
}

function addUsage(into, u) {
  for (const k of USAGE_FIELDS) into[k] += u[k] || 0;
  into.total = into.input + into.cacheRead + into.cacheCreate + into.output;
}

function contentText(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return c == null ? '' : JSON.stringify(c);
  let s = '';
  for (const b of c) {
    if (!b || typeof b !== 'object') continue;
    if (typeof b.text === 'string') s += b.text;
    else if (b.type === 'image') continue;
    else s += JSON.stringify(b);
  }
  return s;
}

// `cd <dir> && git status` → `git status`; `FOO=1 node scripts/x.mjs` → `node`.
// Contract: a family is the command word alone, or the command word plus its subcommand for
// the commands in SUBCOMMAND_TOOLS, or `(script)` / `(assignment)` placeholders. A first
// argument is never a key for any other command (`rg <pattern>`, `ssh <host>`, `cat <file>`
// all key as the bare word), so a family table is safe to publish.
const WORD_RE = /^[A-Za-z][A-Za-z0-9-]*$/;
const SUBCOMMAND_TOOLS = new Set(['git', 'gh', 'npm', 'pnpm', 'yarn', 'bun', 'cargo', 'go', 'docker', 'kubectl', 'helm',
  'pip', 'pipx', 'uv', 'poetry', 'dotnet', 'gradle', 'mvn', 'terraform', 'tofu', 'pulumi', 'aws', 'gcloud', 'az',
  'brew', 'apt', 'apt-get', 'dnf', 'systemctl', 'jj', 'hg', 'svn', 'claude', 'codex', 'rtk', 'codegraph']);
export function bashFamily(cmd) {
  let c = String(cmd || '').trim();
  for (let i = 0; i < 50; i++) {
    const m = c.match(/^cd\s+(?:"[^"]*"|'[^']*'|[^\s"']\S*)\s*(?:&&|;|\n)\s*/);
    if (!m) break;
    c = c.slice(m[0].length);
  }
  c = c.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|(?!\$\()\S*)\s+)+/, '');
  const toks = c.split(/\s+/).filter(Boolean).map((t) => t.replace(/^["'(]+|["');|&]+$/g, ''));
  if (toks.length === 0 || toks[0] === '') return '(empty)';
  if (toks[0].includes('=')) return '(assignment)';
  const first = WORD_RE.test(toks[0]) ? toks[0] : '(script)';
  const second = toks[1] || '';
  if (SUBCOMMAND_TOOLS.has(first.toLowerCase()) && WORD_RE.test(second)) return `${first} ${second}`;
  return first;
}

function sanitizedLabel(tool, input) {
  if (tool === 'Bash') return `Bash ${bashFamily(input?.command)}`;
  if (tool === 'Read') return `Read *${extname(String(input?.file_path || '')) || '(no ext)'}`;
  return tool;
}

function rawLabel(tool, input) {
  const s = tool === 'Bash' ? String(input?.command || '')
    : String(input?.file_path || input?.pattern || input?.path || '');
  return `${tool} ${s.replace(/\s+/g, ' ').slice(0, 80)}`;
}

export function emptySummary() {
  return {
    files: 0, lines: 0, sessions: 0, sidechain: false,
    messages: { user: 0, assistant: 0 },
    models: {},
    usage: emptyUsage(),
    normalizedUsage: emptyUsage(), usageByModel: {}, hosts: {},
    toolCalls: {}, toolResults: 0, toolResultChars: {}, toolResultCharsTotal: 0,
    textChars: { assistant: 0, user: 0, thinking: 0 },
    bashFamilies: {},
    repeatReads: { paths: 0, extraReads: 0, extraChars: 0 },
    largest: [],
    firstTs: null, lastTs: null, durationMs: 0,
    // Tokens the last assistant message carried in: the context resident at session end, which
    // is the cost a verbatim payload leaves behind and the metric the query index targets.
    contextAtEnd: 0,
  };
}

const bump = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };

// Summarize one JSONL transcript. Malformed lines are skipped, never fatal.
export function summarizeTranscript(text, opts = {}) {
  const top = Math.max(0, Number(opts.top ?? 15));
  const s = emptySummary();
  s.files = 1;
  const usageById = new Map();
  const normalizedById = new Map();
  const modelById = new Map();
  const codexResponses = new Map();
  const codexMessageIds = new Set();
  const modelsByTurn = new Map();
  let codexCumulative = null, codexLast = null;
  const toolById = new Map();
  const readsByPath = new Map();
  const readResultsByPath = new Map();
  let first = null, last = null;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line.replace(/^\uFEFF/, '')); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    s.lines++;
    if (o.isSidechain === true) s.sidechain = true;
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (first === null || ts < first) first = ts;
      if (last === null || ts > last) last = ts;
    }
    let msg = o.message;
    if (o.type === 'session_meta') {
      bump(s.hosts, 'codex', 0);
      if (o.payload?.source?.subagent || o.payload?.thread_source?.subagent) s.sidechain = true;
    }
    if (o.type === 'turn_context' && typeof o.payload?.turn_id === 'string' && typeof o.payload?.model === 'string') {
      modelsByTurn.set(o.payload.turn_id, o.payload.model);
    }
    if (o.type === 'token_usage_record') {
      const p = o.payload;
      const u = normalizeUsage(p?.usage, 'codex');
      if (u) {
        const id = typeof p.response_id === 'string' ? p.response_id : `line-${s.lines}`;
        const prev = codexResponses.get(id);
        if (prev) {
          for (const k of ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens']) {
            const n = tokenCount(p.usage[k]);
            if (typeof n === 'number') prev.raw[k] = Math.max(typeof prev.raw[k] === 'number' ? prev.raw[k] : 0, n);
          }
        } else codexResponses.set(id, { raw: { ...p.usage }, model: modelsByTurn.get(p.turn_id) || null });
        codexLast = p.usage;
        bump(s.hosts, 'codex', 0);
      }
      continue;
    }
    if (o.type === 'event_msg' && o.payload?.type === 'token_count') {
      const info = o.payload.info;
      if (info?.total_token_usage) codexCumulative = normalizeUsage(info.total_token_usage, 'codex');
      if (info?.last_token_usage) codexLast = info.last_token_usage;
      bump(s.hosts, 'codex', 0);
      continue;
    }
    const codex = o.type === 'response_item';
    if (codex) {
      const p = o.payload;
      bump(s.hosts, 'codex', 0);
      if (p?.type === 'message') {
        o.type = p.role;
        msg = { id: p.id, content: Array.isArray(p.content) ? p.content.map((b) => ({ ...b, type: 'text' })) : p.content };
      } else if (p?.type === 'function_call' || p?.type === 'custom_tool_call') {
        let input = p.input;
        if (typeof p.arguments === 'string') { try { input = JSON.parse(p.arguments); } catch { input = null; } }
        o.type = 'assistant';
        msg = { content: [{ type: 'tool_use', id: p.call_id, name: p.name, input }] };
      } else if (p?.type === 'function_call_output' || p?.type === 'custom_tool_call_output') {
        o.type = 'user';
        msg = { content: [{ type: 'tool_result', tool_use_id: p.call_id, content: p.output }] };
      } else if (p?.type === 'reasoning') {
        o.type = 'assistant';
        msg = { content: Array.isArray(p.summary) ? p.summary.map((b) => ({ type: 'thinking', thinking: b?.text })) : [] };
      }
    }
    if (!msg || typeof msg !== 'object') continue;
    if (codex && o.type === 'assistant') {
      if (o.payload?.type === 'message') {
        const id = msg.id || `line-${s.lines}`;
        if (!codexMessageIds.has(id)) { s.messages.assistant++; codexMessageIds.add(id); }
      }
    } else if (o.type === 'assistant') {
      bump(s.hosts, 'claude', 0);
      const id = typeof msg.id === 'string' ? msg.id : `line-${s.lines}`;
      const u = usageOf(msg.usage);
      const normalized = normalizeUsage(msg.usage);
      if (normalized) {
        if (normalizedById.has(id)) maxNormalizedUsage(normalizedById.get(id), normalized);
        else normalizedById.set(id, normalized);
        modelById.set(id, typeof msg.model === 'string' ? msg.model : UNKNOWN);
      } else if (!normalizedById.has(id)) {
        normalizedById.set(id, Object.fromEntries([...USAGE_FIELDS, 'total'].map((k) => [k, UNKNOWN])));
        modelById.set(id, UNKNOWN);
      }
      if (u) {
        const prev = usageById.get(id);
        if (!prev) {
          s.messages.assistant++;
          if (typeof msg.model === 'string') bump(s.models, msg.model);
          usageById.set(id, u);
        } else {
          for (const k of USAGE_FIELDS) prev[k] = Math.max(prev[k], u[k]);
        }
      } else if (!usageById.has(id)) {
        s.messages.assistant++;
        usageById.set(id, { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0 });
      }
    } else if (o.type === 'user') {
      // A human turn, not a tool-result carrier line (those also arrive as `type: "user"`).
      const carriesResult = Array.isArray(msg.content) && msg.content.some((b) => b && b.type === 'tool_result');
      if (!carriesResult) s.messages.user++;
    }
    const content = msg.content;
    if (typeof content === 'string') {
      if (o.type === 'user') s.textChars.user += content.length;
      else if (o.type === 'assistant') s.textChars.assistant += content.length;
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        const name = typeof b.name === 'string' ? b.name : '?';
        bump(s.toolCalls, name);
        toolById.set(b.id, { name, input: b.input });
        if (name === 'Bash') bump(s.bashFamilies, bashFamily(b.input?.command), 0);
        if (name === 'Read' && typeof b.input?.file_path === 'string') {
          readsByPath.set(b.input.file_path, (readsByPath.get(b.input.file_path) || 0) + 1);
        }
      } else if (b.type === 'tool_result') {
        const t = toolById.get(b.tool_use_id) || { name: '?', input: null };
        const n = contentText(b.content).length;
        s.toolResults++;
        bump(s.toolResultChars, t.name, n);
        s.toolResultCharsTotal += n;
        if (t.name === 'Bash') bump(s.bashFamilies, bashFamily(t.input?.command), n);
        if (t.name === 'Read' && typeof t.input?.file_path === 'string') {
          const cnt = (readResultsByPath.get(t.input.file_path) || 0) + 1;
          readResultsByPath.set(t.input.file_path, cnt);
          if (cnt > 1) { s.repeatReads.extraReads++; s.repeatReads.extraChars += n; }
        }
        const label = opts.raw ? rawLabel(t.name, t.input) : sanitizedLabel(t.name, t.input);
        if (top > 0) {
          s.largest.push({ chars: n, label });
          if (s.largest.length > top * 4) {
            s.largest.sort((a, c) => c.chars - a.chars);
            s.largest.length = top;
          }
        }
      } else if (b.type === 'text' && typeof b.text === 'string') {
        if (o.type === 'assistant') s.textChars.assistant += b.text.length;
        else if (o.type === 'user') s.textChars.user += b.text.length;
      } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
        s.textChars.thinking += b.thinking.length;
      }
    }
  }
  for (const u of usageById.values()) addUsage(s.usage, u);
  const account = (u, key) => {
    addNormalizedUsage(s.normalizedUsage, u);
    if (!s.usageByModel[key]) s.usageByModel[key] = emptyUsage();
    addNormalizedUsage(s.usageByModel[key], u);
  };
  for (const [id, u] of normalizedById) {
    u.total = tokenSum(u.input, u.cacheRead, u.cacheCreate, u.output);
    account(u, modelById.get(id));
  }
  if (codexResponses.size) {
    for (const { raw, model: key } of codexResponses.values()) {
      const u = normalizeUsage(raw, 'codex');
      account(u, key || UNKNOWN);
      if (key) bump(s.models, key);
    }
  } else if (codexCumulative) account(codexCumulative, UNKNOWN);
  else if (codexMessageIds.size) account(Object.fromEntries([...USAGE_FIELDS, 'total'].map((k) => [k, UNKNOWN])), UNKNOWN);
  if (codexResponses.size || codexCumulative) {
    const u = codexResponses.size ? [...codexResponses.values()].reduce((a, r) => addNormalizedUsage(a, normalizeUsage(r.raw, 'codex')), emptyUsage()) : codexCumulative;
    // Numeric usage remains the historical receipt contract. Cost consumers use normalizedUsage.
    addUsage(s.usage, Object.fromEntries(USAGE_FIELDS.map((k) => [k, typeof u[k] === 'number' ? u[k] : 0])));
    if (typeof u.total === 'number') s.usage.total = tokenSum(...[...usageById.values()].map((v) => v.input + v.cacheRead + v.cacheCreate + v.output), u.total);
  }
  const lastUsage = [...usageById.values()].pop();
  s.contextAtEnd = lastUsage ? lastUsage.input + lastUsage.cacheRead + lastUsage.cacheCreate : 0;
  if (codexLast) s.contextAtEnd = tokenCount(codexLast.input_tokens);
  if ('claude' in s.hosts) s.hosts.claude = usageById.size;
  if ('codex' in s.hosts) s.hosts.codex = codexResponses.size;
  for (const n of readsByPath.values()) if (n > 1) s.repeatReads.paths++;
  s.largest.sort((a, c) => c.chars - a.chars);
  s.largest.length = Math.min(s.largest.length, top);
  s.firstTs = first === null ? null : new Date(first).toISOString();
  s.lastTs = last === null ? null : new Date(last).toISOString();
  s.durationMs = first === null || last === null ? 0 : last - first;
  s.sessions = s.lines > 0 ? 1 : 0;
  return s;
}

export function mergeSummaries(list, opts = {}) {
  const top = Math.max(0, Number(opts.top ?? 15));
  const m = emptySummary();
  let first = null, last = null;
  for (const s of list) {
    m.files += s.files; m.lines += s.lines; m.sessions += s.sessions;
    m.sidechain = m.sidechain || s.sidechain;
    m.messages.user += s.messages.user; m.messages.assistant += s.messages.assistant;
    for (const [k, v] of Object.entries(s.models)) bump(m.models, k, v);
    addUsage(m.usage, s.usage);
    addNormalizedUsage(m.normalizedUsage, s.normalizedUsage);
    for (const [k, u] of Object.entries(s.usageByModel)) {
      if (!m.usageByModel[k]) m.usageByModel[k] = emptyUsage();
      addNormalizedUsage(m.usageByModel[k], u);
    }
    for (const [k, n] of Object.entries(s.hosts)) bump(m.hosts, k, n);
    for (const [k, v] of Object.entries(s.toolCalls)) bump(m.toolCalls, k, v);
    m.toolResults += s.toolResults;
    for (const [k, v] of Object.entries(s.toolResultChars)) bump(m.toolResultChars, k, v);
    m.toolResultCharsTotal += s.toolResultCharsTotal;
    for (const k of Object.keys(m.textChars)) m.textChars[k] += s.textChars[k];
    for (const [k, v] of Object.entries(s.bashFamilies)) bump(m.bashFamilies, k, v);
    m.repeatReads.paths += s.repeatReads.paths;
    m.repeatReads.extraReads += s.repeatReads.extraReads;
    m.repeatReads.extraChars += s.repeatReads.extraChars;
    m.largest.push(...s.largest);
    m.durationMs += s.durationMs;
    m.contextAtEnd = typeof m.contextAtEnd === 'number' && typeof s.contextAtEnd === 'number'
      ? Math.max(m.contextAtEnd, s.contextAtEnd) : UNKNOWN;
    if (s.firstTs) { const t = Date.parse(s.firstTs); if (first === null || t < first) first = t; }
    if (s.lastTs) { const t = Date.parse(s.lastTs); if (last === null || t > last) last = t; }
  }
  m.largest.sort((a, c) => c.chars - a.chars);
  m.largest.length = Math.min(m.largest.length, top);
  m.firstTs = first === null ? null : new Date(first).toISOString();
  m.lastTs = last === null ? null : new Date(last).toISOString();
  return m;
}

// Host convention: `~/.claude/projects/<cwd with every non-alphanumeric byte replaced by "-">`.
export function projectSlug(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

export function defaultTranscriptDir(cwd = process.cwd(), host = 'claude') {
  return host === 'codex' ? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
    : join(homedir(), '.claude', 'projects', projectSlug(cwd));
}

// The subagent transcripts that belong to one session file: `<dir>/<sessionId>/subagents/*.jsonl`.
export function subagentFilesFor(sessionFile) {
  const dir = join(sessionFile.replace(/\.jsonl$/i, ''), 'subagents');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)).sort();
}

// Summarize every session in a transcript directory: main threads and their subagents apart.
export function summarizeDirectory(dir, opts = {}) {
  const out = { dir, files: 0, main: null, subagents: null, all: null, sessions: [] };
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out;
  const find = (d) => readdirSync(d, { withFileTypes: true }).flatMap((entry) => {
    const path = join(d, entry.name);
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path]
      : opts.host === 'codex' && entry.isDirectory() ? find(path) : [];
  });
  const mains = find(dir).sort();
  const mainSums = [], subSums = [];
  for (const f of mains) {
    let s;
    try {
      const text = readFileSync(f, 'utf8');
      if (opts.cwd && opts.host === 'codex') {
        let cwd = null;
        for (const line of text.split('\n')) {
          try { const o = JSON.parse(line.replace(/^\uFEFF/, '')); if (o.type === 'session_meta') { cwd = o.payload?.cwd; break; } } catch { /* skip */ }
        }
        if (typeof cwd !== 'string' || cwd.replace(/\\/g, '/').toLowerCase()
          !== String(opts.cwd).replace(/\\/g, '/').toLowerCase()) continue;
      }
      s = summarizeTranscript(text, opts);
    } catch { continue; }
    if (opts.since && s.lastTs && Date.parse(s.lastTs) < Date.parse(opts.since)) continue;
    out.files++;
    (s.sidechain ? subSums : mainSums).push(s);
    const subs = [];
    for (const sf of subagentFilesFor(f)) {
      try { subs.push(summarizeTranscript(readFileSync(sf, 'utf8'), opts)); out.files++; } catch { /* skip */ }
    }
    subSums.push(...subs);
    out.sessions.push({ file: basename(f), main: s, subagents: mergeSummaries(subs, opts) });
  }
  out.main = mergeSummaries(mainSums, opts);
  out.subagents = mergeSummaries(subSums, opts);
  out.all = mergeSummaries([...mainSums, ...subSums], opts);
  return out;
}

const pct = (n, d) => (d > 0 ? `${(100 * n / d).toFixed(1)}%` : '-');
const fmt = (n) => n === UNKNOWN ? UNKNOWN : Number(n || 0).toLocaleString('en-US');

// Compact Markdown report. Sanitized unless the summaries were built with `raw: true`.
export function renderMarkdown(agg, opts = {}) {
  const top = Math.max(0, Number(opts.top ?? 15));
  const { main, subagents, all } = agg;
  const L = [];
  L.push(`# Context audit`);
  L.push('');
  L.push(`Transcripts: ${agg.files} file(s), ${main.sessions} session(s), ${subagents.files} subagent thread(s). Window: ${all.firstTs || '-'} to ${all.lastTs || '-'}.`);
  L.push('');
  L.push('## Exact tokens (deduplicated by host usage identity)');
  L.push('');
  L.push('UNKNOWN means the host did not report that category. Thinking is included in output.');
  L.push('');
  L.push('| Thread | Messages | Input | Cache read | Cache create | Output | Thinking | Total |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [name, s] of [['main', main], ['subagents', subagents], ['all', all]]) {
    const u = s.normalizedUsage;
    L.push(`| ${name} | ${fmt(s.messages.assistant)} | ${fmt(u.input)} | ${fmt(u.cacheRead)} | ${fmt(u.cacheCreate)} | ${fmt(u.output)} | ${fmt(u.thinking)} | ${fmt(u.total)} |`);
  }
  L.push('');
  L.push('## Context bytes by source (characters, all threads)');
  L.push('');
  const total = all.toolResultCharsTotal + all.textChars.assistant + all.textChars.user + all.textChars.thinking;
  L.push('| Source | Chars | Share |');
  L.push('| --- | ---: | ---: |');
  L.push(`| Tool results | ${fmt(all.toolResultCharsTotal)} | ${pct(all.toolResultCharsTotal, total)} |`);
  const tools = Object.entries(all.toolResultChars).sort((a, b) => b[1] - a[1]).slice(0, top);
  for (const [k, v] of tools) L.push(`| . ${k} | ${fmt(v)} | ${pct(v, total)} |`);
  L.push(`| Assistant text | ${fmt(all.textChars.assistant)} | ${pct(all.textChars.assistant, total)} |`);
  L.push(`| Thinking text | ${fmt(all.textChars.thinking)} | ${pct(all.textChars.thinking, total)} |`);
  L.push(`| User and system text | ${fmt(all.textChars.user)} | ${pct(all.textChars.user, total)} |`);
  L.push('');
  L.push('## Tool calls');
  L.push('');
  L.push('| Tool | Calls |');
  L.push('| --- | ---: |');
  for (const [k, v] of Object.entries(all.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, top)) L.push(`| ${k} | ${fmt(v)} |`);
  L.push('');
  L.push('## Models');
  L.push('');
  L.push('| Model | Assistant messages |');
  L.push('| --- | ---: |');
  for (const [k, v] of Object.entries(all.models).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${fmt(v)} |`);
  L.push('');
  L.push('## Bash output by command family');
  L.push('');
  L.push('| Family | Result chars |');
  L.push('| --- | ---: |');
  for (const [k, v] of Object.entries(all.bashFamilies).sort((a, b) => b[1] - a[1]).slice(0, top)) L.push(`| ${k} | ${fmt(v)} |`);
  L.push('');
  L.push(`## Repeat reads`);
  L.push('');
  L.push(`Paths read more than once: ${fmt(all.repeatReads.paths)}. Extra reads: ${fmt(all.repeatReads.extraReads)}. Chars re-read: ${fmt(all.repeatReads.extraChars)}.`);
  L.push('');
  L.push('## Largest single results');
  L.push('');
  L.push('| Chars | Label |');
  L.push('| ---: | --- |');
  for (const r of all.largest.slice(0, top)) L.push(`| ${fmt(r.chars)} | ${r.label} |`);
  L.push('');
  return L.join('\n');
}
