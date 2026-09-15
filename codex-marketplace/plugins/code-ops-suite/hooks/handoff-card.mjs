#!/usr/bin/env node
// UserPromptSubmit hook: once a session's resident context crosses 200,000 tokens, and again
// every further 200,000-token band, tells the operator and the lead to hand off at the next
// workstream boundary with code-ops-suite:handoff instead of paying full price on every turn.
// SPECULATIVE: the 200k threshold and the 200k band width are not yet calibrated against
// session receipts. See the "Handoff card" pre-registration in MEASUREMENTS.md.
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
// `band = floor(context / 200000)`. The hook nudges again only when the band goes up, and
// re-arms (clears the marker) once context falls back under 200,000 tokens, which a
// compaction typically causes.
//
// HOST COVERAGE. Claude and Codex both document `UserPromptSubmit` with `session_id` on stdin;
// every other hook this plugin ships also reads `transcript_path` there, but Codex's own hook
// reference does not list it as an event-specific field for this event, so a Codex payload that
// omits it degrades silently to no nudge, exactly like a missing transcript file. Grok is
// treated as a passive event here, matching `routing-card.mjs` and `ladder-card.mjs`: its
// instruction files carry the same doctrine instead of a working hook. OpenCode has no
// transcript or usage callback in its plugin API — the same gap that makes
// `session-receipt.mjs` unavailable there — so this hook is not ported to OpenCode.
//
// FAIL-OPEN on every path: bad JSON, a missing or unreadable transcript, a transcript whose
// tail window carries no assistant usage, or any thrown error exits 0 with no output. The hook
// never blocks a prompt (never exits 2) and never spawns a process.

import { existsSync, mkdirSync, openSync, readSync, closeSync, statSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THRESHOLD = 200_000;
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

function markerPath(cwd, sessionId, home, projectSlug) {
  return join(home, '.codex', 'code-ops', 'handoff', projectSlug(cwd), `${projectSlug(sessionId)}.json`);
}

function lastBand(path) {
  try { return Math.max(0, Number(JSON.parse(readFileSync(path, 'utf8')).band) || 0); } catch { return 0; }
}

function writeBand(path, band) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ v: 1, band, ts: new Date().toISOString() }));
}

async function main() {
  if (process.env.GROK_PLUGIN_ROOT) return;
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_HANDOFF_CARD ?? '')) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  if (payload?.hook_event_name && payload.hook_event_name !== 'UserPromptSubmit') return;
  const transcript = payload?.transcript_path ?? payload?.transcriptPath ?? payload?.transcript?.path;
  const sessionId = payload?.session_id ?? payload?.sessionId;
  if (typeof transcript !== 'string' || !transcript || typeof sessionId !== 'string' || !sessionId) return;
  if (!existsSync(transcript)) return;

  const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'transcript-lib.mjs');
  const { normalizeUsage, projectSlug } = await import(pathToFileURL(libPath).href);
  const context = lastContextSize(readTail(transcript), normalizeUsage);
  if (typeof context !== 'number') return;

  const band = Math.floor(context / THRESHOLD);
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const marker = markerPath(cwd, sessionId, homedir(), projectSlug);
  const seen = lastBand(marker);

  if (band === 0) {
    if (seen !== 0) writeBand(marker, 0); // re-armed: context fell back under the threshold
    return;
  }
  if (band <= seen) return;
  writeBand(marker, band);

  const approx = Math.round(context / 10_000) * 10_000;
  const message = `This session holds approximately ${approx.toLocaleString('en-US')} tokens of context, and every `
    + 'turn re-reads all of it. Hand off at the next workstream boundary with code-ops-suite:handoff and start fresh.';
  writeSync(1, `${JSON.stringify({
    systemMessage: message,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message },
  })}\n`);
}

main().catch(() => { /* fail open */ });
