#!/usr/bin/env node
// Context audit — where do a project's context tokens go? Reads the host's LOCAL session
// transcripts (exact per-message usage, tool-result volume, model mix) and the SessionEnd
// receipt ledger. No model in the loop, no egress, no estimates.
//
//   node scripts/context-audit.mjs [--transcripts <dir>] [--cwd <dir>] [--since <ISO>]
//                                  [--top N] [--json] [--raw] [--out <file>]
//   node scripts/context-audit.mjs receipts [--ledger <file>] [--json] [--cwd <dir> | --all] [--by-arm]
//
// Default transcript dir: `~/.claude/projects/<slug of --cwd or the current directory>`.
// Default ledger: $CODE_OPS_RECEIPTS or `~/.claude/code-ops/session-receipts.jsonl`.
//
// Output is sanitized by default (tool names, command families, file extensions). `--raw`
// keeps truncated commands and paths and is meant for local inspection, never for a
// published table. `--json` emits the aggregate for receipts and evals.
//
// Exit: 0 = report written; 1 = no transcripts found; 2 = bad invocation.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { defaultTranscriptDir, summarizeDirectory, renderMarkdown, mergeSummaries, emptySummary, USAGE_FIELDS } from './transcript-lib.mjs';

function usage() {
  console.error('usage: context-audit.mjs [--transcripts <dir>] [--cwd <dir>] [--since <ISO>] [--top N] [--json] [--raw] [--out <file>]');
  console.error('       context-audit.mjs receipts [--ledger <file>] [--cwd <dir> | --all] [--json] [--by-arm]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const mode = argv[0] === 'receipts' ? 'receipts' : 'transcripts';
if (mode === 'receipts') argv.shift();
const opt = { transcripts: null, cwd: process.cwd(), since: null, top: 15, json: false, raw: false, out: null, ledger: null, all: false, byArm: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const need = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) usage(); return v; };
  if (a === '--transcripts') opt.transcripts = need();
  else if (a === '--cwd') opt.cwd = need();
  else if (a === '--since') opt.since = need();
  else if (a === '--top') { opt.top = Number(need()); if (!Number.isInteger(opt.top) || opt.top < 0) usage(); }
  else if (a === '--json') opt.json = true;
  else if (a === '--raw') opt.raw = true;
  else if (a === '--out') opt.out = need();
  else if (a === '--ledger') opt.ledger = need();
  else if (a === '--all') opt.all = true;
  else if (a === '--by-arm') opt.byArm = true;
  else usage();
}
if (opt.since && !Number.isFinite(Date.parse(opt.since))) usage();

function emit(text) {
  if (opt.out) writeFileSync(resolve(opt.out), text.endsWith('\n') ? text : text + '\n');
  else process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}

if (mode === 'transcripts') {
  const dir = resolve(opt.transcripts || defaultTranscriptDir(resolve(opt.cwd)));
  const agg = summarizeDirectory(dir, { top: opt.top, raw: opt.raw, since: opt.since });
  if (agg.files === 0) {
    console.error(`  x no transcripts under ${dir}`);
    process.exit(1);
  }
  if (opt.json) {
    const pick = (s) => ({
      files: s.files, sessions: s.sessions, messages: s.messages, models: s.models, usage: s.usage,
      toolCalls: s.toolCalls, toolResults: s.toolResults, toolResultChars: s.toolResultChars,
      toolResultCharsTotal: s.toolResultCharsTotal, textChars: s.textChars, bashFamilies: s.bashFamilies,
      repeatReads: s.repeatReads, largest: s.largest, firstTs: s.firstTs, lastTs: s.lastTs,
    });
    emit(JSON.stringify({ v: 1, dir: opt.raw ? dir : undefined, files: agg.files, main: pick(agg.main), subagents: pick(agg.subagents), all: pick(agg.all) }, null, 2));
  } else {
    emit(renderMarkdown(agg, { top: opt.top }));
  }
  process.exit(0);
}

// receipts mode — summarize the SessionEnd ledger written by the session-receipt hook.
const ledger = resolve(opt.ledger || process.env.CODE_OPS_RECEIPTS || join(homedir(), '.claude', 'code-ops', 'session-receipts.jsonl'));
if (!existsSync(ledger)) {
  console.error(`  x no receipt ledger at ${ledger}`);
  process.exit(1);
}
const rows = [];
for (const line of readFileSync(ledger, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { const r = JSON.parse(line); if (r && typeof r === 'object' && r.v === 1) rows.push(r); } catch { /* skip */ }
}
const wanted = opt.all ? null : resolve(opt.cwd).replace(/\\/g, '/').toLowerCase();
const mine = rows.filter((r) => !wanted || String(r.cwd || '').replace(/\\/g, '/').toLowerCase() === wanted);
// --by-arm: one group per combination of opt-in switches a session ran under, so an arm reads
// against its control on the same repository. Rows written before the switches were recorded
// group as `unknown`. Every figure is a per-session mean, because arms have different counts.
const armKey = (r) => {
  if (!r.arms || typeof r.arms !== 'object') return 'unknown';
  const on = Object.entries(r.arms).filter(([, v]) => v === true).map(([k]) => k).sort();
  return on.length ? on.join('+') : 'none';
};
if (opt.byArm) {
  const groups = new Map();
  for (const r of mine) {
    const key = armKey(r);
    if (!groups.has(key)) groups.set(key, { arm: key, sessions: 0, durationMs: 0, tokens: 0, input: 0, cacheRead: 0, output: 0, toolResultChars: 0, contextAtEnd: 0, turns: 0, toolCalls: 0 });
    const g = groups.get(key);
    g.sessions++;
    g.durationMs += Number(r.durationMs) || 0;
    for (const scope of ['main', 'subagents']) {
      const u = r.tokens?.[scope];
      if (!u) continue;
      g.input += Number(u.input) || 0; g.cacheRead += Number(u.cacheRead) || 0; g.output += Number(u.output) || 0;
      g.tokens += (Number(u.input) || 0) + (Number(u.cacheRead) || 0) + (Number(u.cacheCreate) || 0) + (Number(u.output) || 0);
    }
    g.toolResultChars += Number(r.toolResultChars) || 0;
    g.contextAtEnd += Number(r.contextAtEnd) || 0;
    g.turns += Number(r.turns) || 0;
    g.toolCalls += Object.values(r.toolCalls || {}).reduce((n, v) => n + (Number(v) || 0), 0);
  }
  const arms = [...groups.values()].sort((a, b) => a.arm.localeCompare(b.arm));
  const per = (g, k) => (g.sessions ? g[k] / g.sessions : 0);
  const means = arms.map((g) => ({ arm: g.arm, sessions: g.sessions, perSession: {
    minutes: per(g, 'durationMs') / 60000, tokens: per(g, 'tokens'), input: per(g, 'input'), cacheRead: per(g, 'cacheRead'), output: per(g, 'output'),
    toolResultChars: per(g, 'toolResultChars'), contextAtEnd: per(g, 'contextAtEnd'), turns: per(g, 'turns'), toolCalls: per(g, 'toolCalls'),
    toolResultCharsPerTurn: per(g, 'turns') ? per(g, 'toolResultChars') / per(g, 'turns') : 0 } }));
  if (opt.json) emit(JSON.stringify({ v: 1, byArm: means }, null, 2));
  else {
    const f = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d });
    const L = ['# Session receipts by arm', '', 'Per-session means. An arm reads against `none` on the same directory; `unknown` rows predate the switch record.', '',
      '| Arm | Sessions | Minutes | Tokens | Cache read | Output | Tool-result chars | Per turn | Context at end | Tool calls |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'];
    for (const m of means) L.push(`| ${m.arm} | ${m.sessions} | ${f(m.perSession.minutes, 1)} | ${f(m.perSession.tokens)} | ${f(m.perSession.cacheRead)} | ${f(m.perSession.output)} | ${f(m.perSession.toolResultChars)} | ${f(m.perSession.toolResultCharsPerTurn)} | ${f(m.perSession.contextAtEnd)} | ${f(m.perSession.toolCalls)} |`);
    emit(L.join('\n'));
  }
  process.exit(0);
}
const sum = emptySummary();
const byModel = {};
let durationMs = 0;
for (const r of mine) {
  durationMs += Number(r.durationMs) || 0;
  for (const scope of ['main', 'subagents']) {
    const u = r.tokens?.[scope];
    if (!u) continue;
    for (const k of USAGE_FIELDS) sum.usage[k] += Number(u[k]) || 0;
  }
  for (const [k, v] of Object.entries(r.models || {})) byModel[k] = (byModel[k] || 0) + (Number(v) || 0);
  for (const [k, v] of Object.entries(r.toolCalls || {})) sum.toolCalls[k] = (sum.toolCalls[k] || 0) + (Number(v) || 0);
}
sum.usage.total = sum.usage.input + sum.usage.cacheRead + sum.usage.cacheCreate + sum.usage.output;
if (opt.json) {
  emit(JSON.stringify({ v: 1, sessions: mine.length, durationMs, usage: sum.usage, models: byModel, toolCalls: sum.toolCalls }, null, 2));
} else {
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const L = ['# Session receipts', '', `Ledger rows: ${mine.length}${wanted ? ' for this directory' : ''}. Wall time: ${(durationMs / 60000).toFixed(1)} min.`, '',
    '| Input | Cache read | Cache create | Output | Thinking | Total |', '| ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${fmt(sum.usage.input)} | ${fmt(sum.usage.cacheRead)} | ${fmt(sum.usage.cacheCreate)} | ${fmt(sum.usage.output)} | ${fmt(sum.usage.thinking)} | ${fmt(sum.usage.total)} |`, '',
    '| Model | Assistant messages |', '| --- | ---: |'];
  for (const [k, v] of Object.entries(byModel).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${fmt(v)} |`);
  L.push('', '| Tool | Calls |', '| --- | ---: |');
  for (const [k, v] of Object.entries(sum.toolCalls).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${fmt(v)} |`);
  emit(L.join('\n'));
}
process.exit(0);
