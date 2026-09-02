#!/usr/bin/env node
// Context audit — where do a project's context tokens go? Reads the host's LOCAL session
// transcripts (exact per-message usage, tool-result volume, model mix) and the SessionEnd
// receipt ledger. No model in the loop, no egress, no estimates.
//
//   node scripts/context-audit.mjs [--transcripts <dir>] [--cwd <dir>] [--since <ISO>]
//                                  [--top N] [--json] [--raw] [--out <file>]
//   node scripts/context-audit.mjs receipts [--ledger <file>] [--json] [--cwd <dir>]
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
  console.error('       context-audit.mjs receipts [--ledger <file>] [--cwd <dir>] [--json]');
  process.exit(2);
}

const argv = process.argv.slice(2);
const mode = argv[0] === 'receipts' ? 'receipts' : 'transcripts';
if (mode === 'receipts') argv.shift();
const opt = { transcripts: null, cwd: process.cwd(), since: null, top: 15, json: false, raw: false, out: null, ledger: null };
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
const wanted = opt.cwd ? resolve(opt.cwd).replace(/\\/g, '/').toLowerCase() : null;
const mine = rows.filter((r) => !wanted || String(r.cwd || '').replace(/\\/g, '/').toLowerCase() === wanted);
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
