#!/usr/bin/env node
// Cost split (MT-C3, D-008): what the Claude session transcripts cost, by model and by agent type.
// It reads the host's LOCAL transcripts, counts tokens with transcript-lib's per-field max over
// each message id, and prices them against the table below. No model in the loop, no egress.
//
//   node scripts/cost-split.mjs [--transcripts <dir> | --all] [--cwd <dir>] [--since <ISO>]
//                               [--json] [--check]
//
// Default transcript dir: `<home>/.claude/projects/<slug of --cwd or the current directory>`.
// `--all` reads every project directory under `<home>/.claude/projects`. `--since` drops a main
// session whose last timestamp is older than the date, with its subagent threads, as
// context-audit.mjs does. Claude transcripts only: the price table is Anthropic's.
//
// PRICES. The table below is this script's own. It is not `PROVIDER_PRICES` in model-tiers.mjs,
// whose keys feed the opencode distribution, so a price edit here never changes a shipped file.
// An entry names one exact model id. A prefix or family match would price an older model at a
// newer model's rate, so an id with no entry is UNPRICED: it is listed with its tokens, costs
// nothing in the subtotal, and `--check` exits 1 for it. Unpriced is never read as $0.
//
// CAVEATS, also printed in the report:
//   - Cache writes bill at the 5-minute rate. The transcript carries a 5m/1h split, but
//     transcript-lib normalizes it away. The main thread writes at the 1h rate on a subscription,
//     so lead cost is understated.
//   - Thinking tokens are part of output, so only output bills.
//   - A message with no usage lands under model UNKNOWN and is counted as incomplete, not priced.
//   - ADVISOR (OI-11). A call is a `server_tool_use` block named `advisor`. Its tokens sit only in
//     `message.usage.iterations[]` entries of type `advisor_message`, each with its own `model`;
//     the top-level usage fields cover the `message` iterations alone, so advisor tokens add to
//     the lead's and never double count. Streamed lines repeat a message id, so calls dedupe by tool
//     id and iterations by message id and position. The price key is the iteration's `model`, never
//     the line's `advisorModel` or a settings alias. A call with no `advisor_message` iteration is
//     counted and reported as usage absent, not priced.
//
// Exit: 0 = report written; 1 = no transcripts found, or `--check` found an unpriced model id
// that carries tokens; 2 = bad invocation.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrDie } from './cli-lib.mjs';
import { defaultTranscriptDir, percentile, subagentFilesFor, summarizeTranscript } from './transcript-lib.mjs';

const USAGE = 'usage: cost-split.mjs [--transcripts <dir> | --all] [--cwd <dir>] [--since <ISO>] [--json] [--check]';

export const PRICING_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';
export const PRICES_VERIFIED_AT = '2026-10-07';
// USD per million tokens, list prices, no batch discount. Keys are exact model ids.
// The Sonnet 5.5 cache read rate follows the pricing table ($0.20); the page prose says $0.10.
export const PRICES = {
  'claude-opus-5-5': { input: 4, cacheRead: 0.2, cacheWrite5m: 5, output: 20 },
  'claude-sonnet-5-5': { input: 2, cacheRead: 0.2, cacheWrite5m: 2.5, output: 10 },
  'claude-haiku-4-5-20251001': { input: 1, cacheRead: 0.1, cacheWrite5m: 1.25, output: 5 },
  'claude-haiku-4-5': { input: 1, cacheRead: 0.1, cacheWrite5m: 1.25, output: 5 },
};
// A model that has a list price this table cannot apply, with the reason.
const UNPRICEABLE = {
  'claude-haiku-5-5': 'input price rises above 100k prompt tokens, a per-request tier that session totals cannot apply',
};

const FIELDS = ['input', 'cacheWrite', 'cacheRead', 'output'];
const SOURCE_FIELD = { input: 'input', cacheWrite: 'cacheCreate', cacheRead: 'cacheRead', output: 'output' };
const round = (n) => Math.round(n * 1e6) / 1e6;
const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const usd = (n) => `$${n.toFixed(2)}`;

// The agent type a subagent thread ran under, from the `<thread>.meta.json` beside its JSONL.
// deferred(mirrors the private agentTypeOf in transcript-lib.mjs, upgrade path: export it there
// and drop this copy once that vendored file is next edited for a bump).
function agentTypeOf(file) {
  try {
    const type = JSON.parse(readFileSync(file.replace(/\.jsonl$/i, '.meta.json'), 'utf8'))?.agentType;
    return typeof type === 'string' && type.trim() ? type.trim() : 'unknown';
  } catch { return 'unknown'; }
}

// Advisor calls and usage in one transcript's text. A call is a `server_tool_use` block named
// `advisor`; its tokens are the `advisor_message` entries of `usage.iterations`. Calls dedupe by tool
// id. Streamed lines repeat a message id, so each iteration keeps its per-field max by message id and
// position, as transcript-lib does for plain usage. Most lines never name the advisor, so the
// substring test keeps the second scan cheap.
export function scanAdvisor(text) {
  const callIds = new Set();
  const byMessage = new Map();
  for (const raw of text.split('\n')) {
    if (!raw.includes('advisor')) continue;
    let msg;
    try { msg = JSON.parse(raw)?.message; } catch { continue; }
    if (!msg || typeof msg !== 'object') continue;
    if (Array.isArray(msg.content)) {
      for (const b of msg.content) if (b?.type === 'server_tool_use' && b.name === 'advisor' && typeof b.id === 'string') callIds.add(b.id);
    }
    if (typeof msg.id !== 'string' || !Array.isArray(msg.usage?.iterations)) continue;
    const slots = byMessage.get(msg.id) ?? [];
    msg.usage.iterations.filter((it) => it?.type === 'advisor_message').forEach((it, i) => {
      const slot = slots[i] ?? (slots[i] = { model: null });
      if (typeof it.model === 'string' && it.model) slot.model = it.model;
      for (const f of FIELDS) {
        const n = it[{ input: 'input_tokens', cacheWrite: 'cache_creation_input_tokens', cacheRead: 'cache_read_input_tokens', output: 'output_tokens' }[f]];
        if (typeof n === 'number') slot[f] = Math.max(slot[f] ?? 0, n);
      }
    });
    byMessage.set(msg.id, slots);
  }
  const usage = [...byMessage.values()].flat();
  return { calls: Math.max(callIds.size, usage.length), usage };
}

const costOf = (price, row) => (
  row.input * price.input + row.cacheRead * price.cacheRead
  + row.cacheWrite * price.cacheWrite5m + row.output * price.output) / 1e6;

// Group every thread under `lead` or `agent:<type>`, then total tokens per group and model.
export function splitCost(dirs, { since = null } = {}) {
  const rows = new Map();
  const advisor = new Map();
  const threads = new Map();
  const out = { files: 0, sessions: 0, subagentThreads: 0 };
  const rowOf = (group, model) => {
    const key = `${group}\t${model}`;
    if (!rows.has(key)) rows.set(key, { group, kind: group === 'lead' || group === 'advisor' ? group : 'subagent', model, messages: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, incomplete: false });
    return rows.get(key);
  };
  const take = (group, s) => {
    for (const [model, u] of Object.entries(s.usageByModel)) {
      const row = rowOf(group, model);
      for (const f of FIELDS) {
        const n = u[SOURCE_FIELD[f]];
        if (typeof n === 'number') row[f] += n; else row.incomplete = true;
      }
    }
    for (const [model, n] of Object.entries(s.models)) rowOf(group, model).messages += n;
    if (!s.turns) return;
    const t = threads.get(group) ?? { turns: [], peaks: [] };
    t.turns.push(s.turns);
    t.peaks.push(s.contextMax);
    threads.set(group, t);
  };
  // Advisor usage joins the same rows under group `advisor`, so the price rule and `--check` cover it.
  const takeAdvisor = (session, caller, text) => {
    const a = scanAdvisor(text);
    if (!a.calls) return;
    const s = advisor.get(session) ?? { session, leadCalls: 0, subagentCalls: 0, usageAbsent: 0 };
    s[caller === 'lead' ? 'leadCalls' : 'subagentCalls'] += a.calls;
    s.usageAbsent += a.calls - a.usage.length;
    advisor.set(session, s);
    for (const slot of a.usage) {
      const row = rowOf('advisor', slot.model ?? 'UNKNOWN');
      row.messages++;
      if (!slot.model) row.incomplete = true;
      for (const f of FIELDS) if (typeof slot[f] === 'number') row[f] += slot[f]; else row.incomplete = true;
    }
  };
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = join(dir, entry.name);
      const session = entry.name.slice(0, -'.jsonl'.length);
      let main, mainText;
      try { mainText = readFileSync(file, 'utf8'); main = summarizeTranscript(mainText); } catch { continue; }
      if (since && main.lastTs && Date.parse(main.lastTs) < Date.parse(since)) continue;
      out.files++;
      if (main.sidechain) { take('agent:unknown', main); takeAdvisor(session, 'subagent', mainText); out.subagentThreads++; continue; }
      out.sessions++;
      take('lead', main);
      takeAdvisor(session, 'lead', mainText);
      for (const sub of subagentFilesFor(file)) {
        let s, text;
        try { text = readFileSync(sub, 'utf8'); s = summarizeTranscript(text); } catch { continue; }
        out.files++;
        out.subagentThreads++;
        take(`agent:${agentTypeOf(sub)}`, s);
        takeAdvisor(session, 'subagent', text);
      }
    }
  }
  const list = [...rows.values()].map((row) => {
    const tokens = FIELDS.reduce((n, f) => n + row[f], 0);
    const price = Object.hasOwn(PRICES, row.model) ? PRICES[row.model] : null;
    return { ...row, tokens, priced: Boolean(price), usd: price ? round(costOf(price, row)) : null };
  }).filter((row) => row.tokens > 0 || row.incomplete).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0) || b.tokens - a.tokens);
  const merge = (items, keyOf) => {
    const by = new Map();
    for (const row of items) {
      const key = keyOf(row);
      const m = by.get(key) ?? { kind: row.kind, model: row.model, messages: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, usd: 0, priced: true };
      for (const f of ['messages', ...FIELDS]) m[f] += row[f];
      if (row.priced) m.usd = round(m.usd + row.usd); else m.priced = false;
      by.set(key, m);
    }
    return [...by.values()];
  };
  const byKind = merge(list, (row) => `${row.kind}\t${row.model}`);
  const context = [...threads].map(([group, t]) => ({
    group, threads: t.turns.length, turnsMedian: percentile(t.turns, 0.5),
    peakMedian: percentile(t.peaks, 0.5), peakP90: percentile(t.peaks, 0.9),
  })).sort((a, b) => a.group.localeCompare(b.group));
  const unpriced = merge(list.filter((row) => !row.priced && row.tokens > 0), (row) => row.model)
    .map((m) => ({ model: m.model, reason: UNPRICEABLE[m.model] ?? 'no price pinned', messages: m.messages, input: m.input, cacheWrite: m.cacheWrite, cacheRead: m.cacheRead, output: m.output }));
  const sessions = [...advisor.values()].sort((a, b) => a.session.localeCompare(b.session));
  const sum = (key) => sessions.reduce((n, x) => n + x[key], 0);
  const calls = sum('leadCalls') + sum('subagentCalls');
  return {
    v: 1, pricesVerifiedAt: PRICES_VERIFIED_AT, pricingSource: PRICING_SOURCE, cacheWriteRate: '5m', since,
    ...out, rows: list, byKind, context, unpriced,
    advisor: { calls, leadCalls: sum('leadCalls'), subagentCalls: sum('subagentCalls'), usageAbsent: sum('usageAbsent'), sessions },
    incomplete: list.filter((row) => row.incomplete).map((row) => ({ group: row.group, model: row.model })),
    totals: { pricedUsd: round(list.reduce((n, row) => n + (row.usd ?? 0), 0)) },
  };
}

function render(rep) {
  const L = ['# Cost split', '',
    `List prices verified ${rep.pricesVerifiedAt} (${rep.pricingSource}). Cache writes are priced at the 5m rate, so lead cost is understated where the host wrote at 1h. Thinking is inside output.`,
    `Transcripts: ${fmt(rep.files)} file(s), ${fmt(rep.sessions)} main session(s), ${fmt(rep.subagentThreads)} subagent thread(s).${rep.since ? ` Since ${rep.since}.` : ''}`, ''];
  const table = (head, left, items, cells) => {
    L.push(`| ${head.join(' | ')} |`, `| ${head.map((_, i) => (i < left ? '---' : '---:')).join(' | ')} |`);
    for (const item of items) L.push(`| ${cells(item).join(' | ')} |`);
    L.push('');
  };
  const tail = (r) => [fmt(r.messages), fmt(r.input), fmt(r.cacheWrite), fmt(r.cacheRead), fmt(r.output), r.priced ? usd(r.usd) : 'unpriced'];
  const cols = ['Messages', 'Input', 'Cache write', 'Cache read', 'Output', 'USD'];
  L.push('## By thread kind and model', '');
  table(['Kind', 'Model', ...cols], 2, rep.byKind, (r) => [r.kind, r.model, ...tail(r)]);
  L.push('## By agent type and model', '');
  table(['Group', 'Model', ...cols], 2, rep.rows, (r) => [r.group, r.model, ...tail(r)]);
  L.push('## Context per thread', '', 'Peak context is the largest input side a thread carried in one turn.', '');
  table(['Group', 'Threads', 'Median turns', 'Median peak', 'P90 peak'], 1, rep.context,
    (c) => [c.group, fmt(c.threads), fmt(c.turnsMedian), fmt(c.peakMedian), fmt(c.peakP90)]);
  L.push('## Advisor calls', '');
  const adv = rep.advisor;
  if (!adv.calls) L.push('None.', '');
  else {
    table(['Session', 'Lead calls', 'Subagent calls', 'Calls without usage'], 1, adv.sessions,
      (a) => [a.session, fmt(a.leadCalls), fmt(a.subagentCalls), fmt(a.usageAbsent)]);
    L.push(adv.usageAbsent === adv.calls
      ? 'The transcripts carry no advisor usage, so these calls are counted only and cost nothing in the subtotal.'
      : `Advisor tokens bill under the advisor model id (group advisor, kind advisor) in the tables above. Usage is absent for ${fmt(adv.usageAbsent)} of ${fmt(adv.calls)} call(s): counted, not priced.`, '');
  }
  L.push('## Unpriced model ids', '');
  if (!rep.unpriced.length) L.push('None.', '');
  else table(['Model', 'Reason', ...cols.slice(0, 5)], 2, rep.unpriced, (u) => [u.model, u.reason, ...tail({ ...u, priced: true, usd: 0 }).slice(0, 5)]);
  if (rep.incomplete.length) L.push(`Messages with missing or partial usage sit under: ${rep.incomplete.map((i) => `${i.group} / ${i.model}`).join(', ')}.`, '');
  L.push(`Priced subtotal, excludes unpriced ids: ${usd(rep.totals.pricedUsd)}.`);
  return L.join('\n');
}

function main() {
  const { flags } = parseOrDie(process.argv.slice(2), {
    transcripts: { value: true }, all: {}, cwd: { value: true, default: process.cwd() },
    since: { value: true }, json: {}, check: {},
  }, USAGE);
  if (flags.since !== undefined && !Number.isFinite(Date.parse(flags.since))) {
    console.error(`x --since is not a date: ${flags.since}`);
    process.exit(2);
  }
  if (flags.all && flags.transcripts) {
    console.error('x --all and --transcripts are exclusive');
    process.exit(2);
  }
  let dirs = [flags.transcripts ?? defaultTranscriptDir(flags.cwd)];
  if (flags.all) {
    const root = join(homedir(), '.claude', 'projects');
    try { dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(root, e.name)); } catch { dirs = []; }
  }
  const rep = splitCost(dirs, { since: flags.since ?? null });
  if (rep.files === 0) {
    console.error('x no Claude transcripts found');
    process.exit(1);
  }
  console.log(flags.json ? JSON.stringify(rep, null, 2) : render(rep));
  if (flags.check && rep.unpriced.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
