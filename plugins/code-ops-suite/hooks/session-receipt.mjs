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
//   toolResultChars, contextAtEnd, arms, handoff: { band, invoked }, files, skipped,
//   tokens: { main: {...}, subagents: {...} } }. Fields are added without a version bump:
//   every reader tolerates an unknown key and treats a missing one as absent.

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

const HANDOFF_COMMAND_RE = /<command-name>\s*\/code-ops-suite:handoff\s*<\/command-name>/;

// True when the operator ran the handoff command after the session's first prompt. Only an
// operator prompt that opens with a host command tag counts: the same marker quoted inside a
// tool call or a tool result is conversation about the command, not a run of it. The first
// prompt is skipped because a handoff command there resumes an earlier session, and the
// decision rule reads whether this session handed off.
function handoffInvoked(text) {
  let prompts = 0;
  for (const line of text.split('\n')) {
    if (!line.includes('"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o?.type !== 'user' || o.isMeta) continue;
    const c = o.message?.content;
    const prompt = typeof c === 'string' ? c
      : Array.isArray(c) && !c.some((b) => b?.type === 'tool_result') ? c.map((b) => (b?.type === 'text' ? b.text : '')).join('')
        : null;
    if (prompt === null) continue;
    prompts++;
    if (prompts > 1 && prompt.trimStart().startsWith('<command-') && HANDOFF_COMMAND_RE.test(prompt)) return true;
  }
  return false;
}

function finish() {
  if (!pending) pending = doFinish();
  return pending;
}

async function doFinish() {
  try {
    if (/^(off|0|false)$/i.test(process.env.CODE_OPS_RECEIPTS || '')) return;
    const payload = JSON.parse(input.replace(/^\uFEFF/, ''));
    const transcriptValue = payload?.transcript_path ?? payload?.transcriptPath ?? payload?.transcript?.path;
    const transcript = typeof transcriptValue === 'string' ? transcriptValue : '';
    if (!transcript || !existsSync(transcript)) return;
    const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'transcript-lib.mjs');
    const lib = await import(pathToFileURL(libPath).href);
    const measuredTranscript = lib.measurementTranscriptFor(transcript);
    const mainText = readFileSync(measuredTranscript, 'utf8');
    const main = lib.summarizeTranscript(mainText, { top: 0 });
    const subFiles = lib.subagentFilesFor(transcript);
    const subs = [];
    for (const f of subFiles) {
      try { subs.push(lib.summarizeTranscript(readFileSync(f, 'utf8'), { top: 0 })); } catch { /* counted in skipped */ }
    }
    const sub = lib.mergeSummaries(subs, { top: 0 });
    const strip = (u) => ({ input: u.input, cacheRead: u.cacheRead, cacheCreate: u.cacheCreate, output: u.output, thinking: u.thinking, total: u.total });
    const sessionId = typeof (payload.session_id ?? payload.sessionId) === 'string' ? (payload.session_id ?? payload.sessionId) : null;
    const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
    // The handoff-card outcome: how far the session's context climbed, and whether the operator
    // answered a nudge by running the command. Only the two summary values are stored, never
    // transcript text. A missing or unreadable marker reads as band 0, like any other fail-open path.
    const handoff = {
      band: sessionId ? lib.handoffPeakBand(lib.handoffMarkerPath(cwd, sessionId, homedir())) : 0,
      invoked: handoffInvoked(mainText),
    };
    const row = {
      v: 1,
      ts: new Date().toISOString(),
      sessionId,
      cwd,
      reason: typeof payload.reason === 'string' ? payload.reason : null,
      durationMs: main.durationMs,
      models: main.models,
      turns: main.messages.assistant,
      toolCalls: main.toolCalls,
      toolResultChars: main.toolResultCharsTotal,
      contextAtEnd: main.contextAtEnd,
      // Which mechanisms this session ran under, read from the same switches the hooks read: on
      // unless the switch says off, so the ledger can compare an arm against sessions run with it off.
      arms: { digest: on('CODE_OPS_DIGEST'), ladderCard: !process.env.GROK_PLUGIN_ROOT && on('CODE_OPS_LADDER_CARD'), index: on('CODE_OPS_INDEX'),
        handoffCard: !process.env.GROK_PLUGIN_ROOT && on('CODE_OPS_HANDOFF_CARD') },
      handoff,
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
