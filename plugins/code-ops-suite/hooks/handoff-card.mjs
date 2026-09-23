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
// `.claude/settings.json` sets at user or repository scope; rendered hosts use their documented
// process environment. The 150,000-token threshold is fixed by design, not tunable.
//
// CEILING SENTENCE. When the nudge fires at or above the dispatch guard's context ceiling
// (`contextCeiling` in scripts/transcript-lib.mjs: 200,000 on Grok and 300,000 elsewhere by
// default, overridden or disabled by `CODE_OPS_CONTEXT_CEILING`), the message gains one
// sentence saying new dispatches are now gated until the assessment runs. That variable changes only this sentence, never the bands.
//
// METRIC. The context size is the last assistant turn's usage record: input plus cache-read
// plus cache-creation tokens, read from only the last 256 KiB of the transcript the payload
// names, never the whole file, so the hook stays inside a tens-of-milliseconds budget
// regardless of transcript size. `residentContext` (scripts/transcript-lib.mjs) owns that
// bounded tail read and the per-host usage parsing, shared with hooks/dispatch-guard.mjs;
// `handoffMarkerPath` there owns the storage-path convention.
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

import { mkdirSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THRESHOLD = 150_000;
const HANDOFF_COMMAND = /code-ops-suite[:-]handoff/;
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
  if (typeof sessionId !== 'string' || !sessionId) return;

  const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'transcript-lib.mjs');
  const { residentContext, contextCeiling, handoffMarkerPath, handoffPeakBand, recordCeilingAssessment } = await import(pathToFileURL(libPath).href);
  const context = residentContext(payload, { grok, home: homedir() });
  if (typeof context !== 'number') return;

  const band = Math.floor(context / THRESHOLD);
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  // A typed handoff command expands without a Skill tool call, so the dispatch guard never sees
  // it. Recording it here unlocks the context-ceiling gate the same way.
  if (!grok && typeof payload.prompt === 'string' && HANDOFF_COMMAND.test(payload.prompt)) {
    try { recordCeilingAssessment(cwd, sessionId, context, contextCeiling(), homedir()); } catch { /* fail open */ }
  }
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
  // The dispatch guard gates Agent, Task, Workflow, and Grok's spawn_subagent dispatches at and
  // past the ceiling, so every host gets the sentence.
  const ceiling = contextCeiling();
  const gated = ceiling !== null && context >= ceiling
    ? ' New dispatches are now gated until that assessment runs.' : '';
  const message = (band === 1
    ? held + 'At the next safe boundary, run /code-ops-suite:handoff assess to choose CONTINUE, COMPACT, or HANDOFF. Continue a short coherent finish; checkpoint durable state before compacting; use explicit write only for a transfer or recovery.'
    : held + 'Finish the step in flight, then run /code-ops-suite:handoff assess to choose CONTINUE, COMPACT, or HANDOFF before starting a new workstream. Checkpoint durable state first. This advisory band does not prove an earlier warning was seen; a host /compact action is pending operator action unless a callable capability executes it.') + gated;
  const body = grok
    ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }
    : {
      systemMessage: message,
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message },
    };
  writeSync(1, `${JSON.stringify(body)}\n`);
}

main().catch(() => { /* fail open */ });
