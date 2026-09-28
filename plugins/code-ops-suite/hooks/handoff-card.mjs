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
// HANDOFF POINT (DEC-3, H6 of the program-state design). Inside the bands, the card fires once
// more when context first reaches `HANDOFF_POINT` (225,000; 200,000 on Grok, where the price
// doubles), and every card at or past that point says to hand off at the next phase boundary.
// When no operator prompt arrived since the last card of this arm, the session runs
// autonomously, and the card says to write the handoff instead of assessing again. The marker
// counts prompts: each `UserPromptSubmit` that shows no card adds one (on Grok the silent
// UserPromptSubmit call records it), and each shown card resets the count.
//
// CONTINUE-UNTIL. The session record (`sessionRecordPath` in transcript-lib.mjs) names the run
// folder. When the last 64 KiB of its RUN_LOG.md end in a `Continue-until: <N> tokens` or
// `Continue-until: <N> turns` line, the card stays quiet until the bound passes, then fires
// once more. Tokens compare with resident context; a turn is one call on the card's own event
// (a prompt, or a tool call on Grok), counted from the first call that saw the line. The line's
// byte offset keys the bound, so a passed bound never suppresses again. A malformed latest line
// sets no bound, and a missing record or log reads as no bound.
//
// FAIL-OPEN on every path: bad JSON, a missing or unreadable transcript, a transcript whose
// tail window carries no assistant usage, or any thrown error exits 0 with no output. The hook
// never blocks a prompt (never exits 2) and never spawns a process.

import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const THRESHOLD = 150_000;
const HANDOFF_POINT = 225_000;
const HANDOFF_POINT_GROK = 200_000;
const RUN_LOG_TAIL = 64 * 1024;
const HANDOFF_COMMAND = /code-ops-suite[:-]handoff/;
const BOUND_LINE = /^[ \t>*-]*Continue-until:[ \t]*(.*?)[ \t]*$/gm;
const BOUND_VALUE = /^(\d{1,3}(?:,\d{3})+|\d+)\s+(tokens|turns)$/i;

// The marker body. `band` is the live band, which a re-arm resets to 0; `handoffPeakBand`
// (transcript-lib.mjs) reads `peak`, the highest band the session ever reached. `point` and
// `fired` record the handoff-point card and any shown card of this arm, `prompts` counts
// operator prompts since the last shown card, and `until` tracks the Continue-until bound.
function readMarker(path) {
  let m = {};
  try { m = JSON.parse(readFileSync(path, 'utf8')) || {}; } catch { /* missing or malformed */ }
  const until = m.until && typeof m.until.key === 'string'
    ? { key: m.until.key, turns: Math.max(0, Number(m.until.turns) || 0), done: m.until.done === true } : null;
  return {
    band: Math.max(0, Number(m.band) || 0), point: m.point === true, fired: m.fired === true,
    prompts: Math.max(0, Number(m.prompts) || 0), until,
  };
}

// `peak` only ever rises, so a session that compacted back under the threshold still tells the
// receipt it was nudged. Evidence: the handoff-card row in MEASUREMENTS.md.
function writeMarker(path, state, peak) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ v: 1, ...state, peak: Math.max(peak, state.band), ts: new Date().toISOString() }));
}

// The latest `Continue-until:` line of the run's RUN_LOG.md, read from a bounded tail as latin1
// so a string index is a byte offset. Returns `{ key, kind, n }`, or null for no record, no log,
// no line, or a malformed latest line.
function continueBound(cwd, sessionId, sessionRecordPath) {
  let runDir;
  try { runDir = JSON.parse(readFileSync(sessionRecordPath(cwd, sessionId, homedir()), 'utf8'))?.runDir; } catch { return null; }
  if (typeof runDir !== 'string' || !runDir) return null;
  let fd;
  try {
    fd = openSync(join(resolve(cwd, runDir), 'RUN_LOG.md'), 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - RUN_LOG_TAIL);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('latin1');
    let skip = 0;
    // A window that starts mid-line drops the fragment, so a line tail never parses as a bound.
    if (start > 0) { skip = text.indexOf('\n') + 1; if (skip === 0) return null; text = text.slice(skip); }
    let last = null;
    for (const m of text.matchAll(BOUND_LINE)) last = m;
    if (!last) return null;
    const value = BOUND_VALUE.exec(last[1]);
    if (!value) return null;
    const n = Number(value[1].replace(/,/g, ''));
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    return { key: `${start + skip + last.index}:${last[1]}`, kind: value[2].toLowerCase(), n };
  } catch { return null; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* fail open */ } }
}

async function main() {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_HANDOFF_CARD ?? '')) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  const grok = Boolean(process.env.GROK_PLUGIN_ROOT);
  const event = payload?.hook_event_name;
  // Grok discards UserPromptSubmit output, so that call only records the operator prompt.
  const promptOnly = grok && event === 'UserPromptSubmit';
  if (grok) {
    if (event !== 'PostToolUse' && !promptOnly) return;
  } else if (event && event !== 'UserPromptSubmit') return;
  const sessionId = payload?.session_id ?? payload?.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) return;

  const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'transcript-lib.mjs');
  const { residentContext, contextCeiling, handoffMarkerPath, handoffPeakBand, recordCeilingAssessment, sessionRecordPath } = await import(pathToFileURL(libPath).href);
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const marker = handoffMarkerPath(cwd, sessionId, homedir());
  if (promptOnly) {
    const state = readMarker(marker);
    if (state.fired) writeMarker(marker, { ...state, prompts: state.prompts + 1 }, handoffPeakBand(marker));
    return;
  }
  const context = residentContext(payload, { grok, home: homedir() });
  if (typeof context !== 'number') return;

  const band = Math.floor(context / THRESHOLD);
  // A typed handoff command expands without a Skill tool call, so the dispatch guard never sees
  // it. Recording it here unlocks the context-ceiling gate the same way.
  if (!grok && typeof payload.prompt === 'string' && HANDOFF_COMMAND.test(payload.prompt)) {
    try { recordCeilingAssessment(cwd, sessionId, context, contextCeiling(), homedir()); } catch { /* fail open */ }
  }
  const state = readMarker(marker);
  const peak = handoffPeakBand(marker);

  if (band === 0) {
    // Re-armed: context fell back under the threshold. The Continue-until state survives, so a
    // passed bound stays passed.
    if (state.band !== 0 || state.point || state.fired || state.prompts) {
      writeMarker(marker, { band: 0, point: false, fired: false, prompts: 0, until: state.until }, peak);
    }
    return;
  }

  const point = grok ? HANDOFF_POINT_GROK : HANDOFF_POINT;
  const pastPoint = context >= point;
  const bound = continueBound(cwd, sessionId, sessionRecordPath);
  let until = state.until;
  if (bound && until?.key !== bound.key) until = { key: bound.key, turns: 0, done: false };
  const open = Boolean(bound) && !until.done;
  if (open) until = { ...until, turns: until.turns + 1 };
  const passed = open && (bound.kind === 'tokens' ? context >= bound.n : until.turns > bound.n);
  const due = band > state.band || (pastPoint && !state.point);
  const fire = open ? passed : due;
  if (fire && open) until = { ...until, done: true };
  // A held card still records its band and point, so it does not fire late once the bound passes
  // unless the bound itself passes.
  const next = {
    band: Math.max(band, state.band), point: state.point || pastPoint,
    fired: state.fired || fire, prompts: fire ? 0 : state.prompts + (grok ? 0 : 1), until,
  };
  writeMarker(marker, next, peak);
  if (!fire) return;

  const approx = Math.round(context / 10_000) * 10_000;
  const held = `This session holds approximately ${approx.toLocaleString('en-US')} tokens of context. `;
  const after = open ? 'The Continue-until bound in the run log has passed. ' : '';
  const pointText = `the ${point.toLocaleString('en-US')}-token handoff point`;
  // The dispatch guard gates Agent, Task, Workflow, and Grok's spawn_subagent dispatches at and
  // past the ceiling, so every host gets the sentence.
  const ceiling = contextCeiling();
  const gated = ceiling !== null && context >= ceiling
    ? ' New dispatches are now gated until that assessment runs.' : '';
  // Autonomous: an earlier card of this arm was shown and no operator prompt followed it.
  const autonomous = pastPoint && state.fired && state.prompts === 0;
  let advice;
  if (autonomous) {
    advice = `This session is past ${pointText}, and no operator prompt has arrived since the last card. At the next phase boundary, run /code-ops-suite:handoff write instead of assessing again. Checkpoint durable state first.`;
  } else if (band === 1 && pastPoint) {
    advice = `This session is past ${pointText}. At the next phase boundary, run /code-ops-suite:handoff assess and hand off. Choose CONTINUE only for a short coherent finish, and record a Continue-until: bound in the run log.`;
  } else if (band === 1) {
    advice = 'At the next safe boundary, run /code-ops-suite:handoff assess to choose CONTINUE, COMPACT, or HANDOFF. Continue a short coherent finish; checkpoint durable state before compacting; use explicit write only for a transfer or recovery.';
  } else {
    advice = 'Finish the step in flight, then run /code-ops-suite:handoff assess to choose CONTINUE, COMPACT, or HANDOFF before starting a new workstream. Checkpoint durable state first. This advisory band does not prove an earlier warning was seen; a host /compact action is pending operator action unless a callable capability executes it.'
      + ` Past ${pointText}, hand off at the next phase boundary unless a short coherent finish remains.`;
  }
  const message = held + after + advice + gated;
  const body = grok
    ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } }
    : {
      systemMessage: message,
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: message },
    };
  writeSync(1, `${JSON.stringify(body)}\n`);
}

main().catch(() => { /* fail open */ });
