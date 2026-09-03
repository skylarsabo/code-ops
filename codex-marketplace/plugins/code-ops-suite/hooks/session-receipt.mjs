#!/usr/bin/env node
// SessionEnd hook: appends one receipt row per session to a LOCAL ledger — exact token usage
// by class (from the transcript the host already wrote), tool calls by tool, model mix, and
// wall time. Nothing is printed to the model and nothing leaves the machine.
//
// WHY: the suite's measurement was hand-entered token notes and model evals. A receipt per
// session turns every ordinary run into a measurement, at zero model cost, so a mechanism's
// before-and-after arms come from normal work on the same repository.
//
// Ledger: $CODE_OPS_RECEIPTS, else `~/.claude/code-ops/session-receipts.jsonl` — a home-dir
// file on purpose, so it can never be committed by accident. `CODE_OPS_RECEIPTS=off` (or `0`,
// `false`) disables the hook. Read the ledger with `node scripts/context-audit.mjs receipts`.
//
// Fail-open on every path: bad stdin, missing transcript, unwritable ledger → exit 0 silently.
// stdin may never close on some Windows shells, so a short timer finishes with what arrived.
//
// Row shape (v: 1): { v, ts, sessionId, cwd, reason, durationMs, models, turns, toolCalls,
//   toolResultChars, files, skipped, tokens: { main: {...}, subagents: {...} } }

import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

let input = '';
let pending = null;

function ledgerPath() {
  return process.env.CODE_OPS_RECEIPTS || join(homedir(), '.claude', 'code-ops', 'session-receipts.jsonl');
}

// Every caller (stdin end, stdin error, the timer) awaits the same promise, so a late
// caller can never exit the process while the first is still writing the row.
const on = (name) => !/^(off|0|false)$/i.test(process.env[name] ?? '');

function finish() {
  if (!pending) pending = doFinish();
  return pending;
}

async function doFinish() {
  try {
    if (/^(off|0|false)$/i.test(process.env.CODE_OPS_RECEIPTS || '')) return;
    const payload = JSON.parse(input.replace(/^\uFEFF/, ''));
    const transcript = typeof payload?.transcript_path === 'string' ? payload.transcript_path : '';
    if (!transcript || !existsSync(transcript)) return;
    const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'transcript-lib.mjs');
    const lib = await import(pathToFileURL(libPath).href);
    const main = lib.summarizeTranscript(readFileSync(transcript, 'utf8'), { top: 0 });
    const subFiles = lib.subagentFilesFor(transcript);
    const subs = [];
    for (const f of subFiles) {
      try { subs.push(lib.summarizeTranscript(readFileSync(f, 'utf8'), { top: 0 })); } catch { /* counted in skipped */ }
    }
    const sub = lib.mergeSummaries(subs, { top: 0 });
    const strip = (u) => ({ input: u.input, cacheRead: u.cacheRead, cacheCreate: u.cacheCreate, output: u.output, thinking: u.thinking, total: u.total });
    const row = {
      v: 1,
      ts: new Date().toISOString(),
      sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
      cwd: typeof payload.cwd === 'string' ? payload.cwd : process.cwd(),
      reason: typeof payload.reason === 'string' ? payload.reason : null,
      durationMs: main.durationMs,
      models: main.models,
      turns: main.messages.assistant,
      toolCalls: main.toolCalls,
      toolResultChars: main.toolResultCharsTotal,
      contextAtEnd: main.contextAtEnd,
      // Which mechanisms this session ran under, read from the same switches the hooks read: on
      // unless the switch says off, so the ledger can compare an arm against sessions run with it off.
      arms: { digest: on('CODE_OPS_DIGEST'), ladderCard: on('CODE_OPS_LADDER_CARD'), index: on('CODE_OPS_INDEX') },
      files: 1 + subFiles.length,
      skipped: subFiles.length - subs.length,
      tokens: { main: strip(main.usage), subagents: strip(sub.usage) },
    };
    const out = ledgerPath();
    mkdirSync(dirname(out), { recursive: true });
    appendFileSync(out, JSON.stringify(row) + '\n');
  } catch {
    // fail open
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => { finish().finally(() => process.exit(0)); });
process.stdin.on('error', () => { finish().finally(() => process.exit(0)); });
setTimeout(() => { finish().finally(() => process.exit(0)); }, 1500).unref();
