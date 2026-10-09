#!/usr/bin/env node
// Cost split (MT-C3, D-008): what the Claude session transcripts cost, by model and by agent type.
// It reads the host's LOCAL transcripts, counts tokens with transcript-lib's per-field max over
// each message id, and prices them against the table below. No model in the loop, no egress.
//
//   node scripts/cost-split.mjs [--transcripts <dir> | --all] [--cwd <dir>] [--since <ISO>]
//                               [--repo <dir>] [--json] [--check]
//
// Default transcript dir: `<home>/.claude/projects/<slug of --cwd or the current directory>`.
// `--all` reads every project directory under `<home>/.claude/projects`. `--since` counts only the
// messages whose own timestamp is at or after the date, in the main thread and in each subagent
// thread alike. A line with no timestamp follows its thread's last timestamp. Claude transcripts
// only: the price table is Anthropic's.
//
// COST PER MERGED PR. `--repo <dir>` (default: `--cwd`; skipped with `--all`, which spans projects)
// counts the PRs merged into HEAD of that git repository in the same window, by churn.mjs's rule:
// a merge commit whose subject starts `Merge pull request #<n>`. It then divides the lead and the
// total priced USD by that count. Local git only, no network. The window is the commit time of the
// merge, so the count and the transcripts share one start date but not one clock.
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
//   - TIERED models (Haiku 5.5) price each message by its own prompt size; see TIERED below.
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

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, parseOrDie } from './cli-lib.mjs';
import { defaultTranscriptDir, isBoundary, percentile, subagentFilesFor, summarizeTranscript } from './transcript-lib.mjs';

const USAGE = 'usage: cost-split.mjs [--transcripts <dir> | --all] [--cwd <dir>] [--since <ISO>] [--repo <dir>] [--json] [--check]';

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
// Per-request tiers. The rate depends on one request's prompt size, so a row prices message by
// message, never from its session totals. Working assumption, UNVERIFIED in the docs: prompt =
// input + cache read + cache write tokens of one request, and a prompt over the threshold puts the
// whole request in the higher tier (worst case). The report prints this assumption.
export const TIERED = {
  'claude-haiku-5-5': {
    threshold: 100000,
    low: { input: 0.1, cacheRead: 0.01, cacheWrite5m: 0.125, output: 0.5 },
    high: { input: 0.5, cacheRead: 0.05, cacheWrite5m: 0.625, output: 2.5 },
  },
};
const tierOf = (spec, u) => (u.input + u.cacheRead + u.cacheWrite > spec.threshold ? spec.high : spec.low);
const TIER_NOTE = 'Tiered models (claude-haiku-5-5) price per message. Assumption, unverified in the docs: prompt = input + cache read + cache write tokens of one request, and a prompt over 100,000 puts the whole request in the higher tier.';

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
export function scanAdvisor(text, prior = null) {
  const callIds = new Set();
  const byMessage = new Map();
  for (const raw of text.split('\n')) {
    if (!raw.includes('advisor')) continue;
    let msg;
    try { msg = JSON.parse(raw)?.message; } catch { continue; }
    if (!msg || typeof msg !== 'object' || prior?.has(msg.id)) continue;
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

// Per-message usage of the tiered models in one transcript's text, deduped by message id at the
// per-field max, as transcript-lib does. The first line's model names the message.
function scanTiered(text, prior) {
  const ids = Object.keys(TIERED);
  const byId = new Map();
  for (const raw of text.split('\n')) {
    if (!ids.some((id) => raw.includes(id))) continue;
    let o;
    try { o = JSON.parse(raw); } catch { continue; }
    const msg = o?.message;
    if (o?.type !== 'assistant' || !msg?.usage || !Object.hasOwn(TIERED, msg.model) || prior.has(msg.id)) continue;
    const key = typeof msg.id === 'string' ? msg.id : `line-${byId.size}`;
    const m = byId.get(key) ?? { model: msg.model, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    for (const f of FIELDS) m[f] = Math.max(m[f], msg.usage[{ input: 'input_tokens', cacheWrite: 'cache_creation_input_tokens', cacheRead: 'cache_read_input_tokens', output: 'output_tokens' }[f]] ?? 0);
    byId.set(key, m);
  }
  return [...byId.values()];
}

// The input side of one request that puts a turn in the "Over 250K turns" count.
export const OVER_TURN = 250000;

// A line's own timestamp in epoch milliseconds, or null. Same reading as transcript-lib.
const stampOf = (o) => {
  const t = o?.timestamp;
  const ms = typeof t === 'string' ? Date.parse(t) : typeof t === 'number' && Number.isFinite(t) ? (t < 1e12 ? t * 1000 : t) : NaN;
  return Number.isFinite(ms) ? ms : null;
};
const inWindow = (stamp, sinceMs) => stamp === null || stamp >= sinceMs;

// The lines of one thread's text whose own timestamp is at or after `sinceMs`. A line with no
// timestamp, or one that does not parse, follows the last timestamp before it, or the thread's
// first timestamp when it opens the file. A thread with no timestamp at all has no basis to drop a
// line, so it keeps them all. Returns '' when no line is left.
export function windowText(text, sinceMs) {
  const rows = String(text).split('\n').filter((raw) => raw.trim()).map((raw) => {
    try { return { raw, stamp: stampOf(JSON.parse(raw.replace(/^﻿/, ''))) }; } catch { return { raw, stamp: null }; }
  });
  let current = rows.find((r) => r.stamp !== null)?.stamp ?? null;
  const kept = [];
  for (const r of rows) {
    if (r.stamp !== null) current = r.stamp;
    if (inWindow(current, sinceMs)) kept.push(r.raw);
  }
  return kept.join('\n');
}

// Turns whose input side (input + cache read + cache write) is over OVER_TURN, and the compaction
// boundaries, in one thread's text. Turns dedupe by message id at the per-field max, as
// transcript-lib does, and skip ids earlier files claimed. A boundary counts once per uuid across
// every file read, so a forked session that repeats its parent's rows does not count them twice.
function scanContext(text, prior, seenBoundaries) {
  const byId = new Map();
  let compactions = 0;
  let index = 0;
  for (const raw of text.split('\n')) {
    index++;
    const boundary = raw.includes('"compact_boundary"');
    if (!boundary && !raw.includes('"usage"')) continue;
    let o;
    try { o = JSON.parse(raw.replace(/^﻿/, '')); } catch { continue; }
    if (isBoundary(o)) {
      if (typeof o.uuid === 'string') {
        if (seenBoundaries.has(o.uuid)) continue;
        seenBoundaries.add(o.uuid);
      }
      compactions++;
      continue;
    }
    const msg = o?.message;
    if (o?.type !== 'assistant' || !msg?.usage || typeof msg.usage !== 'object') continue;
    if (typeof msg.id === 'string' && prior.has(msg.id)) continue;
    const key = typeof msg.id === 'string' ? msg.id : `line-${index}`;
    const prev = byId.get(key) ?? [0, 0, 0];
    byId.set(key, [msg.usage.input_tokens, msg.usage.cache_read_input_tokens, msg.usage.cache_creation_input_tokens]
      .map((n, i) => Math.max(prev[i], Number(n) || 0)));
  }
  return { over: [...byId.values()].filter((f) => f[0] + f[1] + f[2] > OVER_TURN).length, compactions };
}

// Group every thread under `lead` or `agent:<type>`, then total tokens per group and model.
export function splitCost(dirs, { since = null } = {}) {
  const sinceMs = since ? Date.parse(since) : null;
  const boundaries = new Set();
  const rows = new Map();
  const advisor = new Map();
  const threads = new Map();
  const out = { files: 0, sessions: 0, subagentThreads: 0 };
  const rowOf = (group, model) => {
    const key = `${group}\t${model}`;
    if (!rows.has(key)) rows.set(key, { group, kind: group === 'lead' || group === 'advisor' ? group : 'subagent', model, messages: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, incomplete: false, tierUsd: 0, tierOver: 0 });
    return rows.get(key);
  };
  const addTier = (row, u) => {
    const spec = TIERED[row.model];
    row.tierUsd += costOf(tierOf(spec, u), u);
    if (tierOf(spec, u) === spec.high) row.tierOver++;
  };
  // Message ids earlier files claimed. A forked or resumed session repeats ids across files, so a
  // message counts once across everything read; a message with no id still counts per line.
  const claimed = new Set();
  const take = (group, s, text) => {
    for (const [model, u] of Object.entries(s.usageByModel)) {
      const row = rowOf(group, model);
      for (const f of FIELDS) {
        const n = u[SOURCE_FIELD[f]];
        if (typeof n === 'number') row[f] += n; else row.incomplete = true;
      }
    }
    for (const [model, n] of Object.entries(s.models)) rowOf(group, model).messages += n;
    for (const m of scanTiered(text, claimed)) addTier(rowOf(group, m.model), m);
    const ctx = scanContext(text, claimed, boundaries);
    if (!s.turns && !ctx.compactions) return;
    const t = threads.get(group) ?? { turns: [], peaks: [], over: 0, compactions: 0 };
    t.over += ctx.over;
    t.compactions += ctx.compactions;
    if (s.turns) {
      t.turns.push(s.turns);
      t.peaks.push(s.contextMax);
    }
    threads.set(group, t);
  };
  // Advisor usage joins the same rows under group `advisor`, so the price rule and `--check` cover it.
  const takeAdvisor = (session, caller, text) => {
    const a = scanAdvisor(text, claimed);
    if (!a.calls) return;
    const s = advisor.get(session) ?? { session, leadCalls: 0, subagentCalls: 0, usageAbsent: 0 };
    s[caller === 'lead' ? 'leadCalls' : 'subagentCalls'] += a.calls;
    s.usageAbsent += a.calls - a.usage.length;
    advisor.set(session, s);
    for (const slot of a.usage) {
      const row = rowOf('advisor', slot.model ?? 'UNKNOWN');
      row.messages++;
      if (!slot.model) row.incomplete = true;
      if (Object.hasOwn(TIERED, row.model)) addTier(row, { input: slot.input ?? 0, cacheWrite: slot.cacheWrite ?? 0, cacheRead: slot.cacheRead ?? 0, output: slot.output ?? 0 });
      for (const f of FIELDS) if (typeof slot[f] === 'number') row[f] += slot[f]; else row.incomplete = true;
    }
  };
  // One thread's text, cut to the window, with its summary. Null when nothing of it is in the window.
  // A file last written before the window holds no in-window line, so its mtime skips the read.
  const load = (file) => {
    try {
      if (sinceMs !== null && statSync(file).mtimeMs < sinceMs) return null;
      let text = readFileSync(file, 'utf8');
      if (sinceMs !== null && !(text = windowText(text, sinceMs))) return null;
      const own = new Set();
      return { text, own, s: summarizeTranscript(text, { priorIds: claimed, ownIds: own }) };
    } catch { return null; }
  };
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = join(dir, entry.name);
      const session = entry.name.slice(0, -'.jsonl'.length);
      const main = load(file);
      if (!main && sinceMs === null) continue;
      if (main) {
        out.files++;
        if (main.s.sidechain) { take('agent:unknown', main.s, main.text); takeAdvisor(session, 'subagent', main.text); out.subagentThreads++; main.own.forEach((id) => claimed.add(id)); continue; }
        out.sessions++;
        take('lead', main.s, main.text);
        takeAdvisor(session, 'lead', main.text);
        main.own.forEach((id) => claimed.add(id));
      }
      // A session's subagent threads are cut to the window on their own timestamps, so they count
      // even when the main thread holds no in-window line.
      for (const sub of subagentFilesFor(file)) {
        const thread = load(sub);
        if (!thread) continue;
        out.files++;
        out.subagentThreads++;
        take(`agent:${agentTypeOf(sub)}`, thread.s, thread.text);
        takeAdvisor(session, 'subagent', thread.text);
        thread.own.forEach((id) => claimed.add(id));
      }
    }
  }
  const tierStats = new Map();
  const list = [...rows.values()].map(({ tierUsd, tierOver, ...row }) => {
    const tokens = FIELDS.reduce((n, f) => n + row[f], 0);
    const tiered = Object.hasOwn(TIERED, row.model);
    const price = Object.hasOwn(PRICES, row.model) ? PRICES[row.model] : null;
    if (tiered && tokens > 0) {
      const s = tierStats.get(row.model) ?? { model: row.model, messages: 0, overThreshold: 0 };
      s.messages += row.messages;
      s.overThreshold += tierOver;
      tierStats.set(row.model, s);
    }
    return { ...row, tokens, priced: tiered || Boolean(price), usd: tiered ? round(tierUsd) : price ? round(costOf(price, row)) : null };
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
    peakMedian: percentile(t.peaks, 0.5), peakP90: percentile(t.peaks, 0.9), peakMax: Math.max(0, ...t.peaks),
    // Threads whose peak crossed the Haiku 5.5 prompt step, the size a light-rung move must fit under.
    overStep: t.peaks.filter((p) => p > TIERED['claude-haiku-5-5'].threshold).length,
    // Turns with an input side over OVER_TURN, and compact_boundary rows, across the group's threads.
    over250kTurns: t.over, compactions: t.compactions,
  })).sort((a, b) => a.group.localeCompare(b.group));
  const unpriced = merge(list.filter((row) => !row.priced && row.tokens > 0), (row) => row.model)
    .map((m) => ({ model: m.model, reason: 'no price pinned', messages: m.messages, input: m.input, cacheWrite: m.cacheWrite, cacheRead: m.cacheRead, output: m.output }));
  const sessions = [...advisor.values()].sort((a, b) => a.session.localeCompare(b.session));
  const sum = (key) => sessions.reduce((n, x) => n + x[key], 0);
  const calls = sum('leadCalls') + sum('subagentCalls');
  return {
    v: 1, pricesVerifiedAt: PRICES_VERIFIED_AT, pricingSource: PRICING_SOURCE, cacheWriteRate: '5m', since,
    ...out, rows: list, byKind, context, unpriced, tiered: [...tierStats.values()],
    advisor: { calls, leadCalls: sum('leadCalls'), subagentCalls: sum('subagentCalls'), usageAbsent: sum('usageAbsent'), sessions },
    incomplete: list.filter((row) => row.incomplete).map((row) => ({ group: row.group, model: row.model })),
    totals: { pricedUsd: round(list.reduce((n, row) => n + (row.usd ?? 0), 0)) },
  };
}

// churn.mjs's rule for a merged PR, mirrored: a merge commit whose subject starts with this.
// deferred(a copy of churn.mjs's private PR_MERGE_RE, upgrade path: export it from churn.mjs once
// that file is next edited for another reason).
const PR_MERGE_RE = /^Merge pull request #(\d+)/;

// The PRs merged into HEAD of `repo` since `since` (all history when null), counted by number.
// Local git only. Returns null when `repo` is not a readable git repository.
export function countMergedPrs(repo, since = null) {
  const bound = since ? [`--max-age=${Math.floor(Date.parse(since) / 1000)}`] : [];
  try {
    const subjects = git(['log', 'HEAD', '--merges', '--format=%s', ...bound, '--'], { cwd: repo, timeout: 300000, maxBuffer: 1 << 29 });
    return new Set(subjects.split('\n').map((s) => PR_MERGE_RE.exec(s)?.[1]).filter(Boolean)).size;
  } catch { return null; }
}

// Lead and total priced USD over the merged PR count. A window with no merged PR has no per-PR cost.
export function costPerPr(rep, merged) {
  const leadUsd = round(rep.byKind.filter((k) => k.kind === 'lead' && k.priced).reduce((n, k) => n + k.usd, 0));
  const totalUsd = rep.totals.pricedUsd;
  return {
    mergedPrs: merged, leadUsd, totalUsd,
    leadUsdPerPr: merged ? round(leadUsd / merged) : null, totalUsdPerPr: merged ? round(totalUsd / merged) : null,
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
  L.push('## Context per thread', '', 'Peak context is the largest input side a thread carried in one turn. Over 250K turns counts turns across the group; compactions counts its compact_boundary rows.', '');
  table(['Group', 'Threads', 'Median turns', 'Median peak', 'P90 peak', 'Max peak', 'Over 100K', 'Over 250K turns', 'Compactions'], 1, rep.context,
    (c) => [c.group, fmt(c.threads), fmt(c.turnsMedian), fmt(c.peakMedian), fmt(c.peakP90), fmt(c.peakMax), fmt(c.overStep), fmt(c.over250kTurns), fmt(c.compactions)]);
  L.push('## Cost per merged PR', '');
  const pr = rep.perPr;
  if (!pr) L.push(rep.perPrNote, '');
  else if (!pr.mergedPrs) L.push(`No PR merged in ${pr.repo}${rep.since ? ` since ${rep.since}` : ''}, so there is no per-PR cost.`, '');
  else {
    table(['Merged PRs', 'Lead USD', 'Total USD', 'Lead USD per PR', 'Total USD per PR'], 0, [pr],
      (p) => [fmt(p.mergedPrs), usd(p.leadUsd), usd(p.totalUsd), usd(p.leadUsdPerPr), usd(p.totalUsdPerPr)]);
    L.push(`Merges counted in ${pr.repo} (HEAD history, subject "Merge pull request #<n>"); the USD columns are priced rows only.`, '');
  }
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
  if (rep.tiered.length) L.push(TIER_NOTE, `Priced per message: ${rep.tiered.map((t) => `${t.model} ${fmt(t.messages)} message(s), ${fmt(t.overThreshold)} over the threshold`).join('; ')}.`, '');
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
    since: { value: true }, repo: { value: true }, json: {}, check: {},
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
  rep.perPr = null;
  if (flags.all) rep.perPrNote = 'Cost per merged PR is skipped: it needs a single project, and --all spans every project.';
  else {
    const repo = resolve(flags.repo ?? flags.cwd);
    const merged = countMergedPrs(repo, rep.since);
    if (merged === null) rep.perPrNote = `Cost per merged PR is skipped: ${repo} is not a readable git repository.`;
    else rep.perPr = { repo, ...costPerPr(rep, merged) };
  }
  console.log(flags.json ? JSON.stringify(rep, null, 2) : render(rep));
  if (flags.check && rep.unpriced.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
