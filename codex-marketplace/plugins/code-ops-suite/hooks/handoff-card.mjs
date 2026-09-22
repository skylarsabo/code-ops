#!/usr/bin/env node
// UserPromptSubmit hook: once a session's resident context crosses 150,000 tokens, and again
// every further 150,000-token band, reminds the operator and the lead to assess CONTINUE,
// COMPACT, or HANDOFF at the next safe boundary. It is not a host limit or a cost claim.
// The threshold moved from 200k to 150k on 2026-09-18, when a transcript audit found 71% of
// lead input-side tokens spent above 200k. The exact value stays SPECULATIVE until session
// receipts calibrate it. See the "Handoff card" pre-registration in MEASUREMENTS.md.
//
// The message escalates with the band. Both bands request the same lifecycle assessment; a higher
// band asks the lead to resolve it before starting a new workstream. The marker proves only that
// this hook wrote earlier advice, not that a host displayed it or a boundary was available.
//
// ON BY DEFAULT, OFF PER REPOSITORY OR USER. The hook does nothing when `CODE_OPS_HANDOFF_CARD`
// is `off`, `0`, or `false` (case-insensitive) in its environment, which the `env` block of a
// the host environment supplies at user or repository scope; rendered hosts use their documented
// process environment. No other switch exists: the threshold is fixed by design, not tunable.
//
// METRIC. The context size is the last assistant turn's usage record: input plus cache-read
// plus cache-creation tokens, read from only the last 256 KiB of the transcript the payload
// names, never the whole file, so the hook stays inside a tens-of-milliseconds budget
// regardless of transcript size. `normalizeUsage` and `projectSlug`
// (scripts/transcript-lib.mjs) do the token math and the storage-path convention this hook
// reuses; the bounded tail read is the only new parsing this file adds.
//
// ONCE PER CROSSING. A small per-session marker under `<host home>/code-ops/handoff/<project
// slug>/<session id>.json` remembers the highest band already nudged, where
// `band = floor(context / 150000)`. The hook nudges again only when the band goes up, and
// re-arms (clears the marker) once context falls back under 150,000 tokens, which a
// compaction typically causes.
//
// HOST COVERAGE. Claude and Codex both document `UserPromptSubmit` with `session_id` on stdin;
// every other hook this plugin ships also reads `transcript_path` there, but Codex's own hook
// reference does not list it as an event-specific field for this event, so a Codex payload that
// omits it degrades silently to no nudge, exactly like a missing transcript file. Grok discards
// UserPromptSubmit stdout, so on that host the same script runs at PostToolUse and emits
// `additionalContext`, which the model reads beside the tool result. Usage comes from the
// session `updates.jsonl` (the payload's transcript path, its `chat_history.jsonl` sibling, or
// `~/.grok/sessions/<encoded cwd>/<session id>/updates.jsonl`). Resident context there is the
// last snapshot's `inputTokens`, the same figure `transcript-lib.mjs` stores as `contextAtEnd`.
// That path covers the TUI, headless `grok -p`, and the ACP agent (`grok agent`). A turn with
// no tool call never fires it, so the instruction files still tell the lead to assess before
// the 200,000-token price cliff. OpenCode has no transcript callback; its lifecycle plugin
// carries the note instead.
//
// FAIL-OPEN on every path: bad JSON, a missing or unreadable transcript, a transcript whose
// tail window carries no assistant usage, or any thrown error exits 0 with no output. The hook
// never blocks a prompt (never exits 2) and never spawns a process.

import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THRESHOLD = 150_000;
const TAIL_BYTES = 256 * 1024;

// The last TAIL_BYTES of the file, with a possibly-truncated leading partial line dropped.
function readTail(path) {
  const size = statSync(path).size;
  const length = Math.min(size, TAIL_BYTES);
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
// counts (scripts/transcript-lib.mjs:11-12), so the first assistant usage line found scanning
// backward from the end of the file is already the turn's final number; no dedup pass needed.
function lastContextSize(text, normalizeUsage) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'assistant' && o.message && typeof o.message === 'object') {
      const u = normalizeUsage(o.message.usage);
      if (u && typeof u.input === 'number' && typeof u.cacheRead === 'number' && typeof u.cacheCreate === 'number') {
        return u.input + u.cacheRead + u.cacheCreate;
      }
      return null;
    }
    // Codex best-effort branch: the host's own last-turn usage snapshot, read directly rather
    // than through normalizeUsage's codex path (scripts/transcript-lib.mjs:258-264), because
    // Codex's own contextAtEnd is the raw, cache-inclusive input_tokens field, not the
    // cache-excluded `input` normalizeUsage computes.
    if (o.type === 'event_msg' && o.payload?.type === 'token_count') {
      const n = o.payload.info?.last_token_usage?.input_tokens;
      return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
    }
  }
  return null;
}

// The marker's live band, which a re-arm resets to 0. `handoffPeakBand` (transcript-lib.mjs)
// reads the other field, the highest band the session ever reached.
function lastBand(path) {
  try { return Math.max(0, Number(JSON.parse(readFileSync(path, 'utf8')).band) || 0); } catch { return 0; }
}

// `peak` only ever rises, so a session that compacted back under the threshold still tells the
// receipt it was nudged. Evidence: the handoff-card row in MEASUREMENTS.md.
function writeBand(path, band, peak) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ v: 1, band, peak: Math.max(peak, band), ts: new Date().toISOString() }));
}

// Last Grok usage snapshot in the tail. `inputTokens` already includes cache tokens;
// `transcript-lib.mjs` uses that field as resident context.
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
// with that stream beside it. A missing path falls back to the session directory.
function measureFile(payload, grok) {
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
  const home = process.env.GROK_HOME || join(homedir(), '.grok');
  const candidate = join(home, 'sessions', encodeURIComponent(cwd), sessionId, 'updates.jsonl');
  return existsSync(candidate) ? { path: candidate, grok: true } : null;
}

async function main() {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_HANDOFF_CARD ?? '')) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  const grok = Boolean(process.env.GROK_PLUGIN_ROOT);
  const event = payload?.hook_event_name;
  if (grok) {
    if (event !== 'PostToolUse') return;
  } else if (event && event !== 'UserPromptSubmit') return;
  const sessionId = payload?.session_id ?? payload?.sessionId;
  const file = measureFile(payload, grok);
  if (!file || typeof sessionId !== 'string' || !sessionId) return;

  const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'transcript-lib.mjs');
  const { normalizeUsage, handoffMarkerPath, handoffPeakBand } = await import(pathToFileURL(libPath).href);
  const text = readTail(file.path);
  const context = file.grok ? lastGrokContext(text) : lastContextSize(text, normalizeUsage);
  if (typeof context !== 'number') return;

  const band = Math.floor(context / THRESHOLD);
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const marker = handoffMarkerPath(cwd, sessionId, homedir());
  const seen = lastBand(marker);
  const peak = handoffPeakBand(marker);

  if (band === 0) {
    if (seen !== 0) writeBand(marker, 0, peak); // re-armed: context fell back under the threshold
    return;
  }
  if (band <= seen) return;
  writeBand(marker, band, peak);

  const approx = Math.round(context / 10_000) * 10_000;
  const held = `This session holds approximately ${approx.toLocaleString('en-US')} tokens of context. `;
  const message = band === 1
    ? held + 'At the next safe boundary, run code-ops-suite:handoff assess to choose CONTINUE, COMPACT, or HANDOFF. Continue a short coherent finish; checkpoint durable state before compacting; use explicit write only for a transfer or recovery.'
    : held + 'Finish the step in flight, then run code-ops-suite:handoff assess to choose CONTINUE, COMPACT, or HANDOFF before starting a new workstream. Checkpoint durable state first. This advisory band does not prove an earlier warning was seen; a host /compact action is pending operator action unless a callable capability executes it.';
  const body = grok
    ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }
    : {
      systemMessage: message,
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message },
    };
  writeSync(1, `${JSON.stringify(body)}\n`);
}

main().catch(() => { /* fail open */ });
