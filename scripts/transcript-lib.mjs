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
//   - Claude subagent transcripts live under `<session>/subagents/`. Codex stores every
//     rollout as a peer JSONL and links children through `parent_thread_id`; both layouts are
//     resolved without relying on filenames.
//   - Grok writes cumulative usage snapshots per prompt to `updates.jsonl`. Repeated snapshots
//     are collapsed by prompt id before prompts are summed.
//   - Tool results are attributed to the tool by `tool_use_id` → the earlier `tool_use` block
//     in the same file; a result whose call lives in another file lands in the `?` bucket.
//   - `messages.user` counts human turns only; tool-result carrier lines are excluded.
//
// Sanitized by default: labels are tool names, command families (first word plus a plain
// subcommand), and file extensions — never paths, arguments, or content. `raw: true` keeps a
// truncated command / path for local inspection only.

import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, basename, dirname } from 'node:path';
import { homedir } from 'node:os';

export const USAGE_FIELDS = ['input', 'cacheRead', 'cacheCreate', 'output', 'thinking'];
export const UNKNOWN = 'UNKNOWN';

// Context shape: what a turn carried IN (input + cache read + cache creation). Spend follows the
// resident context, not the reply, so the band a turn sits in is the unit that predicts cost.
// Lower edges in tokens; the last band is open-ended.
export const CONTEXT_BAND_EDGES = [0, 60000, 100000, 150000, 200000, 300000];
export const CONTEXT_BAND_LABELS = CONTEXT_BAND_EDGES.map((edge, i) => i === CONTEXT_BAND_EDGES.length - 1
  ? `${edge / 1000}K+` : `${edge / 1000}K-${CONTEXT_BAND_EDGES[i + 1] / 1000}K`);
// A turn that recreates more than half of a large context paid for a cache miss it could reuse.
const REWRITE_SHARE = 0.5, REWRITE_FLOOR = 40000;

export function contextBandIndex(ctx) {
  let i = 0;
  while (i + 1 < CONTEXT_BAND_EDGES.length && ctx >= CONTEXT_BAND_EDGES[i + 1]) i++;
  return i;
}

const emptyBands = () => CONTEXT_BAND_EDGES.map(() => ({ turns: 0, tokens: 0 }));

// Tokens a thread carried in across every usage-bearing turn — the band table's own total.
export const inputSideOf = (s) => (s.contextBands || []).reduce((n, b) => n + (b.tokens || 0), 0);

// Nearest-rank percentile over a numeric sample; 0 for an empty sample.
export function percentile(values, q) {
  const a = values.filter((n) => typeof n === 'number').sort((x, y) => x - y);
  return a.length ? a[Math.min(a.length - 1, Math.max(0, Math.floor(q * (a.length - 1))))] : 0;
}
export const median = (values) => percentile(values, 0.5);

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

function normalizeGrokUsage(u) {
  if (!u || typeof u !== 'object') return null;
  const reportedInput = tokenCount(u.inputTokens);
  const cacheRead = tokenCount(u.cachedReadTokens);
  const cacheCreate = tokenCount(u.cacheCreationTokens);
  const output = tokenCount(u.outputTokens);
  const thinking = tokenCount(u.reasoningTokens);
  const input = typeof reportedInput === 'number' && typeof cacheRead === 'number'
    && typeof cacheCreate === 'number' && reportedInput >= cacheRead + cacheCreate
    ? reportedInput - cacheRead - cacheCreate : UNKNOWN;
  const reportedTotal = tokenCount(u.totalTokens);
  return {
    input, cacheRead, cacheCreate, output, thinking,
    total: typeof reportedTotal === 'number' ? reportedTotal : tokenSum(reportedInput, output),
  };
}

const GROK_USAGE_FIELDS = ['inputTokens', 'cachedReadTokens', 'cacheCreationTokens', 'outputTokens', 'reasoningTokens', 'totalTokens', 'modelCalls', 'numTurns'];

function mergeGrokSnapshot(into, from) {
  for (const key of GROK_USAGE_FIELDS) {
    const n = tokenCount(from?.[key]);
    if (typeof n === 'number') into[key] = Math.max(typeof into[key] === 'number' ? into[key] : 0, n);
  }
  if (from?.modelUsage && typeof from.modelUsage === 'object') {
    into.modelUsage ??= {};
    for (const [model, usage] of Object.entries(from.modelUsage)) {
      if (!usage || typeof usage !== 'object') continue;
      into.modelUsage[model] ??= {};
      mergeGrokSnapshot(into.modelUsage[model], usage);
    }
  }
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
    toolCalls: {}, skills: {}, toolResults: 0, toolResultChars: {}, toolResultCharsTotal: 0,
    textChars: { assistant: 0, user: 0, thinking: 0 },
    bashFamilies: {},
    repeatReads: { paths: 0, extraReads: 0, extraChars: 0 },
    largest: [],
    firstTs: null, lastTs: null, durationMs: 0,
    // Tokens the last assistant message carried in: the context resident at session end, which
    // is the cost a verbatim payload leaves behind and the metric the query index targets.
    contextAtEnd: 0,
    // Context shape. `turns` counts usage-bearing assistant turns after dedup; `contextBands`
    // is one {turns, tokens} entry per CONTEXT_BAND_EDGES band. A host that reports no
    // per-turn usage leaves contextFirst / contextMax UNKNOWN and every counter at zero.
    contextFirst: 0, contextMax: 0, turns: 0,
    contextBands: emptyBands(), cacheRewrites: { turns: 0, tokens: 0 },
    // Filled by mergeSummaries: one entry per merged thread, so medians survive the merge.
    threads: [],
  };
}

const bump = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };

// A skill id as the receipt stores it: the colon form (`code-ops-suite:handoff`) with any leading
// slash removed. Anything else is not an id and returns null, so no transcript text reaches a row.
const SKILL_ID_RE = /^[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)*$/;
export function skillId(raw) {
  if (typeof raw !== 'string') return null;
  const id = raw.trim().replace(/^\//, '');
  return id.length <= 128 && SKILL_ID_RE.test(id) ? id : null;
}
const COMMAND_NAME_RE = /<command-name>\s*([^<]*?)\s*<\/command-name>/;
// The skill an operator ran as a slash command: a prompt that opens with the host command tag.
// Only a namespaced `plugin:skill` name counts, because a bare name such as `/clear` or
// `/compact` is a host built-in the transcript does not tell apart from a user skill.
function slashSkill(prompt) {
  if (!prompt.trimStart().startsWith('<command-')) return null;
  const id = skillId(prompt.match(COMMAND_NAME_RE)?.[1]);
  return id && id.includes(':') ? id : null;
}

// Summarize one JSONL transcript. Malformed lines are skipped, never fatal.
export function summarizeTranscript(text, opts = {}) {
  const top = Math.max(0, Number(opts.top ?? 15));
  const s = emptySummary();
  s.files = 1;
  const usageById = new Map();
  const normalizedById = new Map();
  const modelById = new Map();
  const codexResponses = new Map();
  const grokPrompts = new Map();
  const codexMessageIds = new Set();
  const modelsByTurn = new Map();
  let codexCumulative = null, codexLast = null, grokLast = null;
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
    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp)
      : typeof o.timestamp === 'number' && Number.isFinite(o.timestamp)
        ? (o.timestamp < 1e12 ? o.timestamp * 1000 : o.timestamp) : NaN;
    if (Number.isFinite(ts)) {
      if (first === null || ts < first) first = ts;
      if (last === null || ts > last) last = ts;
    }
    let msg = o.message;
    const grokUpdate = o.params?.update;
    if (grokUpdate?.usage && typeof grokUpdate.usage === 'object') {
      const id = typeof grokUpdate.prompt_id === 'string' ? grokUpdate.prompt_id
        : typeof o.params?.sessionId === 'string' ? `${o.params.sessionId}:unkeyed` : `line-${s.lines}`;
      const usage = grokPrompts.get(id) || {};
      mergeGrokSnapshot(usage, grokUpdate.usage);
      grokPrompts.set(id, usage);
      grokLast = grokUpdate.usage;
      bump(s.hosts, 'grok', 0);
      continue;
    }
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
      if (!carriesResult) {
        s.messages.user++;
        const prompt = typeof msg.content === 'string' ? msg.content
          : Array.isArray(msg.content) ? msg.content.map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('') : '';
        const skill = o.isMeta ? null : slashSkill(prompt);
        if (skill) bump(s.skills, skill);
      }
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
        if (name === 'Skill') { const id = skillId(b.input?.skill); if (id) bump(s.skills, id); }
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
  const grokUsage = emptyUsage();
  for (const usage of grokPrompts.values()) {
    const perModel = usage.modelUsage && Object.entries(usage.modelUsage);
    if (perModel?.length) {
      for (const [model, raw] of perModel) {
        const u = normalizeGrokUsage(raw);
        if (u) { account(u, model); addNormalizedUsage(grokUsage, u); }
        bump(s.models, model, typeof raw.modelCalls === 'number' ? raw.modelCalls : 1);
      }
    } else {
      const u = normalizeGrokUsage(usage);
      if (u) { account(u, UNKNOWN); addNormalizedUsage(grokUsage, u); }
    }
  }
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
  if (grokPrompts.size) {
    const priorTotal = s.usage.total;
    addUsage(s.usage, Object.fromEntries(USAGE_FIELDS.map((k) => [k, typeof grokUsage[k] === 'number' ? grokUsage[k] : 0])));
    s.usage.total = tokenSum(priorTotal, grokUsage.total);
  }
  // Context shape, over the SAME dedup identity as the token totals (usageById, per-field max),
  // in transcript order. Only the Claude branch reports per-turn context; other hosts stay UNKNOWN.
  for (const u of usageById.values()) {
    const ctx = u.input + u.cacheRead + u.cacheCreate;
    if (!ctx) continue;
    if (!s.turns) s.contextFirst = ctx;
    s.contextMax = Math.max(s.contextMax, ctx);
    s.turns++;
    const band = s.contextBands[contextBandIndex(ctx)];
    band.turns++;
    band.tokens += ctx;
    if (s.turns > 1 && u.cacheCreate > REWRITE_SHARE * ctx && ctx > REWRITE_FLOOR) {
      s.cacheRewrites.turns++;
      s.cacheRewrites.tokens += u.cacheCreate;
    }
  }
  if (!s.turns && (codexResponses.size || codexCumulative || grokPrompts.size || codexMessageIds.size)) {
    s.contextFirst = UNKNOWN;
    s.contextMax = UNKNOWN;
  }
  const lastUsage = [...usageById.values()].pop();
  s.contextAtEnd = lastUsage ? lastUsage.input + lastUsage.cacheRead + lastUsage.cacheCreate : 0;
  if (codexLast) s.contextAtEnd = tokenCount(codexLast.input_tokens);
  if (grokLast) s.contextAtEnd = tokenCount(grokLast.inputTokens);
  if ('claude' in s.hosts) s.hosts.claude = usageById.size;
  if ('codex' in s.hosts) s.hosts.codex = codexResponses.size;
  if ('grok' in s.hosts) s.hosts.grok = grokPrompts.size;
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
    for (const [k, v] of Object.entries(s.skills || {})) bump(m.skills, k, v);
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
    m.turns += s.turns || 0;
    for (let i = 0; i < m.contextBands.length; i++) {
      m.contextBands[i].turns += s.contextBands?.[i]?.turns || 0;
      m.contextBands[i].tokens += s.contextBands?.[i]?.tokens || 0;
    }
    m.cacheRewrites.turns += s.cacheRewrites?.turns || 0;
    m.cacheRewrites.tokens += s.cacheRewrites?.tokens || 0;
    // An already-merged summary carries its thread list; a single transcript contributes itself.
    if (s.threads?.length) m.threads.push(...s.threads);
    else if (s.turns > 0) m.threads.push({ contextFirst: s.contextFirst, contextMax: s.contextMax, turns: s.turns, inputSide: inputSideOf(s) });
    if (s.firstTs) { const t = Date.parse(s.firstTs); if (first === null || t < first) first = t; }
    if (s.lastTs) { const t = Date.parse(s.lastTs); if (last === null || t > last) last = t; }
  }
  m.largest.sort((a, c) => c.chars - a.chars);
  m.largest.length = Math.min(m.largest.length, top);
  // Across a merge, first context is the earliest thread's and max is the widest thread's.
  m.contextFirst = m.threads.length ? m.threads[0].contextFirst : 0;
  m.contextMax = m.threads.reduce((n, t) => Math.max(n, typeof t.contextMax === 'number' ? t.contextMax : 0), 0);
  m.firstTs = first === null ? null : new Date(first).toISOString();
  m.lastTs = last === null ? null : new Date(last).toISOString();
  return m;
}

// Claude host layout: `<home>/.claude/projects/<cwd with every non-alphanumeric byte replaced by "-">`.
// Only the Claude branch uses this slug. The Codex branch reads `$CODEX_HOME/sessions`.
export function projectSlug(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

// Handoff marker store, shared by the two hooks that touch it: `hooks/handoff-card.mjs` writes
// one marker per session and `hooks/session-receipt.mjs` reads it back into the receipt row.
// Path: `<home>/.claude/code-ops/handoff/<project slug>/<session slug>.json`; body
// `{ v: 1, band, peak, ts }`, where `band` is the live band the card compares against and `peak`
// is the highest band the session ever reached, which a re-arm must not lower.
export function handoffMarkerPath(cwd, sessionId, home = homedir()) {
  return join(home, '.claude', 'code-ops', 'handoff', projectSlug(cwd), `${projectSlug(sessionId)}.json`);
}

// Session record store, which binds a live session to its run folder. `scripts/handoff-state.mjs`
// writes it on `run open` and on a passing `handoff resume`, and the SessionStart card reads it on
// compaction. Path: `<home>/.claude/code-ops/sessions/<project slug>/<session slug>.json`; body
// `{ v: 1, sessionId, name, runDir, resumed, hop, updatedAt }`, with repo-relative paths.
export function sessionRecordPath(cwd, sessionId, home = homedir()) {
  return join(home, '.claude', 'code-ops', 'sessions', projectSlug(cwd), `${projectSlug(sessionId)}.json`);
}

// The highest band a marker records, or 0 for a missing, unreadable, or malformed marker. A
// marker written before `peak` existed reports its `band`.
export function handoffPeakBand(path) {
  try {
    const m = JSON.parse(readFileSync(path, 'utf8'));
    return Math.max(0, Number(m.peak) || 0, Number(m.band) || 0);
  } catch { return 0; }
}

// Context ceiling shared by `hooks/dispatch-guard.mjs`, which gates new dispatches at and past
// it, and `hooks/handoff-card.mjs`, which says so in its band nudge. `CODE_OPS_CONTEXT_CEILING`
// takes `off`, `0`, or `false` (case-insensitive) to disable the gate (null), an integer of at
// least 150,000 to override the default, and anything else reads as the host default: 200,000
// under Grok (`GROK_PLUGIN_ROOT` set, the sibling hooks' host test), whose price doubles above
// that line, and 300,000 elsewhere. The 150,000-token band rule is the same on every host.
export const CONTEXT_CEILING_DEFAULT = 300_000;
export const CONTEXT_CEILING_GROK = 200_000;
export const CONTEXT_CEILING_MIN = 150_000;
export function contextCeiling(raw = process.env.CODE_OPS_CONTEXT_CEILING, grok = Boolean(process.env.GROK_PLUGIN_ROOT)) {
  const value = String(raw ?? '').trim();
  if (/^(off|0|false)$/i.test(value)) return null;
  const n = /^[0-9]+$/.test(value) ? Number(value) : NaN;
  if (Number.isSafeInteger(n) && n >= CONTEXT_CEILING_MIN) return n;
  return grok ? CONTEXT_CEILING_GROK : CONTEXT_CEILING_DEFAULT;
}

// The ceiling band a context sits in: 0 below the ceiling, then 1 plus one per further
// 150,000 tokens. `hooks/dispatch-guard.mjs` applies the same formula.
export const CEILING_BAND_TOKENS = 150_000;
export function ceilingBand(context, ceiling) {
  return context < ceiling ? 0 : 1 + Math.floor((context - ceiling) / CEILING_BAND_TOKENS);
}

// Records a handoff assessment for the context-ceiling gate. `hooks/dispatch-guard.mjs` reads
// and writes the same marker, `<home>/.claude/code-ops/dispatch/<sha256 cwd>/<sha256 session
// id>.assessed.json` with body `{ version: 1, band }`, and keeps its own synchronous copy of the
// path for its CLI. `hooks/handoff-card.mjs` calls this when the operator types the handoff
// command, which the host expands without a Skill tool call the guard could see. The band only
// rises. Returns the band now recorded, or 0 when nothing was written.
export function recordCeilingAssessment(cwd, sessionId, context, ceiling, home = homedir()) {
  if (ceiling === null || typeof context !== 'number') return 0;
  const band = ceilingBand(context, ceiling);
  if (band < 1) return 0;
  const key = (value) => createHash('sha256').update(String(value)).digest('hex');
  const path = join(home, '.claude', 'code-ops', 'dispatch', key(cwd), `${key(sessionId)}.assessed.json`);
  let prior = 0;
  try {
    const marker = JSON.parse(readFileSync(path, 'utf8'));
    if (marker?.version === 1 && Number.isSafeInteger(marker.band) && marker.band > 0) prior = marker.band;
  } catch { /* no marker yet */ }
  if (prior >= band) return prior;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, band }) + '\n');
  return band;
}

// Resident-context measurement for the hooks, which must stay inside a tens-of-milliseconds
// budget: only the last CONTEXT_TAIL_BYTES of the transcript are read, never the whole file.
const CONTEXT_TAIL_BYTES = 256 * 1024;

// The last CONTEXT_TAIL_BYTES of the file, with a possibly-truncated leading partial line dropped.
function readTail(path) {
  const size = statSync(path).size;
  const length = Math.min(size, CONTEXT_TAIL_BYTES);
  const offset = size - length;
  const buf = Buffer.allocUnsafe(length);
  const fd = openSync(path, 'r');
  try { readSync(fd, buf, 0, length, offset); } finally { closeSync(fd); }
  const text = buf.toString('utf8');
  if (offset === 0) return text;
  const nl = text.indexOf('\n');
  return nl < 0 ? '' : text.slice(nl + 1);
}

// The last assistant-turn usage record in the tail window, or null. Claude writes one line per
// content block of the same message, each repeating `usage`, and the last one carries the final
// counts (see the header), so the first assistant usage line found scanning backward from the
// end of the file is already the turn's final number; no dedup pass needed. A compaction marker
// newer than every usage record makes the usage before it stale, since that is the
// pre-compaction size. Claude's `compact_boundary` system row carries the post-compaction size
// in `compactMetadata.postTokens`, which stands in with source `compaction` until the first
// post-compaction turn records usage. A boundary without it, and Codex's `compacted` row,
// return null: the size is unknown. The result is `{ tokens, source }`, source `usage` or
// `compaction`.
function lastContextSize(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'system' && o.subtype === 'compact_boundary') {
      const n = o.compactMetadata?.postTokens;
      return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? { tokens: n, source: 'compaction' } : null;
    }
    if (o.type === 'compacted') return null;
    if (o.type === 'assistant' && o.message && typeof o.message === 'object') {
      const u = normalizeUsage(o.message.usage);
      if (u && typeof u.input === 'number' && typeof u.cacheRead === 'number' && typeof u.cacheCreate === 'number') {
        return { tokens: u.input + u.cacheRead + u.cacheCreate, source: 'usage' };
      }
      return null;
    }
    // Codex best-effort branch: the host's own last-turn usage snapshot, read directly rather
    // than through normalizeUsage's codex path, because Codex's own contextAtEnd is the raw,
    // cache-inclusive input_tokens field, not the cache-excluded `input` normalizeUsage computes.
    if (o.type === 'event_msg' && o.payload?.type === 'token_count') {
      const n = o.payload.info?.last_token_usage?.input_tokens;
      return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? { tokens: n, source: 'usage' } : null;
    }
  }
  return null;
}

// Last Grok usage snapshot in the tail. `inputTokens` already includes cache tokens, the same
// figure the Grok summarizer above stores as `contextAtEnd`.
function lastGrokContext(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || !line.includes('inputTokens')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const n = o?.params?.update?.usage?.inputTokens;
    if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) return n;
  }
  return null;
}

// Claude and Codex name a transcript. Grok names `updates.jsonl`, or `chat_history.jsonl`
// with that stream beside it. A missing path falls back to the Grok session directory.
function contextFile(payload, grok, home) {
  const transcript = payload?.transcript_path ?? payload?.transcriptPath ?? payload?.transcript?.path;
  if (typeof transcript === 'string' && transcript) {
    if (grok && /chat_history\.jsonl$/i.test(transcript)) {
      const updates = join(dirname(transcript), 'updates.jsonl');
      if (existsSync(updates)) return { path: updates, grok: true };
    }
    if (existsSync(transcript)) return { path: transcript, grok: grok && /updates\.jsonl$/i.test(transcript) };
  }
  if (!grok) return null;
  const sessionId = payload?.session_id ?? payload?.sessionId;
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd : '';
  if (typeof sessionId !== 'string' || !sessionId || !cwd) return null;
  const grokHome = process.env.GROK_HOME || join(home, '.grok');
  const candidate = join(grokHome, 'sessions', encodeURIComponent(cwd), sessionId, 'updates.jsonl');
  return existsSync(candidate) ? { path: candidate, grok: true } : null;
}

// The session's resident context in tokens from a hook payload, or null when it cannot be read.
// Claude: input plus cache-read plus cache-creation on the last assistant usage record. Codex:
// the last token_count snapshot's input_tokens. Grok (`grok: true`): the last updates.jsonl
// snapshot's inputTokens. After a Claude compaction with no newer usage record, the boundary's
// postTokens. Never throws, so a caller fails open on null.
export function residentContext(payload, options) {
  return residentContextReading(payload, options)?.tokens ?? null;
}

// residentContext with its source: `{ tokens, source }`, where source `compaction` marks a size
// read from compaction metadata rather than a usage record. Null when unknown.
export function residentContextReading(payload, { grok = false, home = homedir() } = {}) {
  try {
    const file = contextFile(payload, grok, home);
    if (!file) return null;
    const text = readTail(file.path);
    if (!file.grok) return lastContextSize(text);
    const n = lastGrokContext(text);
    return n === null ? null : { tokens: n, source: 'usage' };
  } catch { return null; }
}

export function defaultTranscriptDir(cwd = process.cwd(), host = 'claude') {
  return host === 'codex' ? join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
    : join(homedir(), '.claude', 'projects', projectSlug(cwd));
}

function codexSessionLink(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const chunks = [];
    let total = 0, newline = -1;
    while (total < 8 * 1024 * 1024 && newline < 0) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, 8 * 1024 * 1024 - total));
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (!n) break;
      const part = chunk.subarray(0, n);
      newline = part.indexOf(10);
      chunks.push(newline < 0 ? part : part.subarray(0, newline));
      total += newline < 0 ? n : newline;
    }
    const row = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''));
    if (row?.type !== 'session_meta') return null;
    const payload = row.payload || {};
    const parent = payload.parent_thread_id ?? payload.source?.subagent?.thread_spawn?.parent_thread_id
      ?? payload.thread_source?.subagent?.thread_spawn?.parent_thread_id;
    return { id: typeof payload.id === 'string' ? payload.id : null, parent: typeof parent === 'string' ? parent : null };
  } catch { /* not a readable Codex transcript */ }
  finally { if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ } }
  return null;
}

// The subagent transcripts that belong to one session. Claude uses a nested directory;
// Codex writes peer rollouts and links the complete descendant graph by thread id.
export function subagentFilesFor(sessionFile) {
  const dir = join(sessionFile.replace(/\.jsonl$/i, ''), 'subagents');
  if (existsSync(dir)) return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => join(dir, f)).sort();
  const root = codexSessionLink(sessionFile);
  if (!root?.id) return [];
  const links = [];
  for (const name of readdirSync(dirname(sessionFile))) {
    if (!name.endsWith('.jsonl')) continue;
    const file = join(dirname(sessionFile), name);
    if (file === sessionFile) continue;
    const link = codexSessionLink(file);
    if (link?.id && link.parent) links.push({ ...link, file });
  }
  const descendants = [], pending = [root.id], seen = new Set([root.id]);
  while (pending.length) {
    const parent = pending.shift();
    for (const link of links) {
      if (link.parent !== parent || seen.has(link.id)) continue;
      seen.add(link.id);
      descendants.push(link.file);
      pending.push(link.id);
    }
  }
  return descendants.sort();
}

// Grok's hook transcript path names chat_history.jsonl; exact usage lives beside it.
export function measurementTranscriptFor(sessionFile) {
  const updates = join(dirname(sessionFile), 'updates.jsonl');
  return /chat_history\.jsonl$/i.test(sessionFile) && existsSync(updates) ? updates : sessionFile;
}

// The agent type a subagent thread ran under, from the `<thread>.meta.json` the host writes
// beside the JSONL. A missing or malformed file is `unknown`, never fatal. The type is a
// registry label (`verifier`, `mech`), so it is safe to publish next to counts.
function agentTypeOf(sessionFile) {
  try {
    const meta = JSON.parse(readFileSync(sessionFile.replace(/\.jsonl$/i, '.meta.json'), 'utf8'));
    const type = meta?.agentType;
    return typeof type === 'string' && type.trim() ? type.trim() : 'unknown';
  } catch { return 'unknown'; }
}

const dominantModel = (s) => Object.entries(s.models).sort((a, b) => b[1] - a[1])[0]?.[0] || UNKNOWN;

// Summarize every session in a transcript directory: main threads and their subagents apart.
export function summarizeDirectory(dir, opts = {}) {
  const out = { dir, files: 0, main: null, subagents: null, all: null, sessions: [], byAgentType: {} };
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
      let sub;
      try { sub = summarizeTranscript(readFileSync(sf, 'utf8'), opts); } catch { continue; }
      subs.push(sub);
      out.files++;
      if (!sub.turns) continue;
      const key = `${agentTypeOf(sf)} / ${dominantModel(sub)}`;
      const b = out.byAgentType[key] ??= { key, threads: 0, turns: 0, first: [], max: [], inputSide: 0 };
      b.threads++;
      b.turns += sub.turns;
      b.first.push(sub.contextFirst);
      b.max.push(sub.contextMax);
      b.inputSide += inputSideOf(sub);
    }
    subSums.push(...subs);
    out.sessions.push({ file: basename(f), main: s, subagents: mergeSummaries(subs, opts) });
  }
  out.main = mergeSummaries(mainSums, opts);
  out.subagents = mergeSummaries(subSums, opts);
  out.all = mergeSummaries([...mainSums, ...subSums], opts);
  for (const [key, b] of Object.entries(out.byAgentType)) {
    out.byAgentType[key] = { key, threads: b.threads, turns: b.turns,
      medianContextFirst: median(b.first), medianContextMax: median(b.max), inputSide: b.inputSide,
      first: b.first, max: b.max };
  }
  return out;
}

// Merge the per-agent-type tables of several directories (one per project under `--all`).
export function mergeAgentTypes(tables) {
  const out = {};
  for (const table of tables) {
    for (const [key, b] of Object.entries(table || {})) {
      const m = out[key] ??= { key, threads: 0, turns: 0, medianContextFirst: 0, medianContextMax: 0, inputSide: 0, first: [], max: [] };
      m.threads += b.threads;
      m.turns += b.turns;
      m.inputSide += b.inputSide;
      m.first.push(...(b.first || []));
      m.max.push(...(b.max || []));
    }
  }
  // Medians do not sum, so each group's median is recomputed over every contributing thread.
  for (const m of Object.values(out)) {
    m.medianContextFirst = median(m.first);
    m.medianContextMax = median(m.max);
  }
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
  L.push('## Context shape');
  L.push('');
  L.push('Context is what a turn carried in (input + cache read + cache creation), per deduplicated turn.');
  L.push('');
  L.push('| Thread | Threads | Turns | First p10 | First p50 | First p90 | Max p10 | Max p50 | Max p90 |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [name, s] of [['main', main], ['subagents', subagents]]) {
    const firsts = (s.threads || []).map((t) => t.contextFirst);
    const maxes = (s.threads || []).map((t) => t.contextMax);
    L.push(`| ${name} | ${fmt((s.threads || []).length)} | ${fmt(s.turns)} | ${fmt(percentile(firsts, 0.1))} | ${fmt(percentile(firsts, 0.5))} | ${fmt(percentile(firsts, 0.9))} | ${fmt(percentile(maxes, 0.1))} | ${fmt(percentile(maxes, 0.5))} | ${fmt(percentile(maxes, 0.9))} |`);
  }
  L.push('');
  L.push('## Spend by context band');
  L.push('');
  L.push('| Band | Main turns | Main tokens | Main share | Subagent turns | Subagent tokens | Subagent share |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  const mainSide = inputSideOf(main), subSide = inputSideOf(subagents);
  CONTEXT_BAND_LABELS.forEach((label, i) => {
    const mb = main.contextBands?.[i] || { turns: 0, tokens: 0 };
    const sb = subagents.contextBands?.[i] || { turns: 0, tokens: 0 };
    L.push(`| ${label} | ${fmt(mb.turns)} | ${fmt(mb.tokens)} | ${pct(mb.tokens, mainSide)} | ${fmt(sb.turns)} | ${fmt(sb.tokens)} | ${pct(sb.tokens, subSide)} |`);
  });
  L.push('');
  L.push(`Full cache rewrites (over half of a context above ${fmt(REWRITE_FLOOR)} tokens recreated): main ${fmt(main.cacheRewrites?.turns)} turn(s), ${fmt(main.cacheRewrites?.tokens)} tokens; subagents ${fmt(subagents.cacheRewrites?.turns)} turn(s), ${fmt(subagents.cacheRewrites?.tokens)} tokens.`);
  L.push('');
  L.push('## Subagents by agent type');
  L.push('');
  L.push('| Type / model | Threads | Turns | Median first | Median max | Input-side tokens |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const b of Object.values(agg.byAgentType || {}).sort((a, c) => c.inputSide - a.inputSide)) {
    L.push(`| ${b.key} | ${fmt(b.threads)} | ${fmt(b.turns)} | ${fmt(b.medianContextFirst)} | ${fmt(b.medianContextMax)} | ${fmt(b.inputSide)} |`);
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
  if (agg.projects) {
    L.push('## Projects');
    L.push('');
    L.push('| Project | Main input-side | Subagent input-side |');
    L.push('| --- | ---: | ---: |');
    for (const p of agg.projects) L.push(`| ${p.slug} | ${fmt(p.mainInputSide)} | ${fmt(p.subagentInputSide)} |`);
    L.push('');
  }
  return L.join('\n');
}
