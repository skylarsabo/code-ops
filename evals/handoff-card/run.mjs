#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/handoff-card.mjs, the opt-in
// UserPromptSubmit context-size nudge. It pins the contract the hook promises:
//   - on by default: without CODE_OPS_HANDOFF_CARD a crossing transcript prints once, and off,
//     0, or false silences it for the same fixture;
//   - below 150,000 tokens of resident context (input + cache-read + cache-creation on the last
//     assistant usage record), the hook is silent and writes no marker;
//   - crossing 150,000 prints exactly one JSON line, naming the approximate token count and
//     pointing at /code-ops-suite:handoff, on both systemMessage and hookSpecificOutput's
//     additionalContext, with hookEventName UserPromptSubmit and no permissionDecision;
//   - a second prompt in the same 150k band stays silent;
//   - crossing into the next 150k band prints again;
//   - falling back under 150,000 re-arms: the next crossing prints again, and the marker keeps
//     the highest band reached in `peak`, which the session receipt reads;
//   - fail open: bad JSON, no hook_event_name match, a missing transcript file, a missing
//     session_id, and empty stdin all exit 0 with no output;
//   - Grok UserPromptSubmit emits nothing, because that stdout is discarded. Grok PostToolUse
//     reads updates.jsonl and emits one additionalContext per new band, with hookEventName
//     PostToolUse and no systemMessage;
//   - each band requests a CONTINUE, COMPACT, or HANDOFF assessment; a higher band asks before a
//     new workstream without claiming an earlier warning
//     was received;
//   - a crossing at or past the context ceiling (CODE_OPS_CONTEXT_CEILING, default 300,000)
//     ends with one sentence saying new dispatches are gated; off drops only that sentence, an
//     override moves it, an invalid value falls back to 300,000, and Grok gets it from 200,000.
//
// It also covers the other half of the handoff loop, the pending-handoff pickup line
// plugins/code-ops-suite/hooks/routing-card.mjs injects at SessionStart: which sources get it,
// what makes a handoff pending, and the CODE_OPS_HANDOFF_PICKUP switch.
//
//   node evals/handoff-card/run.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { handoffMarkerPath, handoffPeakBand, residentContext, residentContextReading } from '../../scripts/transcript-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const hook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'handoff-card.mjs');

const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };

// Each test gets its own fake HOME so the marker store never touches the real operator's
// `~/.claude/code-ops/handoff/`, the same isolation technique evals/digest-hook/run.mjs uses
// for CODE_OPS_DIGEST_DIR.
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'handoff-home-'));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

// A one-line synthetic Claude transcript whose last assistant usage record sums to
// `input + cacheRead + cacheCreate` tokens of resident context.
function assistantLine(cacheRead, input = 1000, cacheCreate = 0) {
  return JSON.stringify({
    type: 'assistant',
    message: { id: 'msg_1', model: 'claude-test', usage: {
      input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate, output_tokens: 5,
    } },
  }) + '\n';
}

function codexTokenLine(inputTokens) {
  return JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: inputTokens } } } }) + '\n';
}

function writeTranscript(dir, content, name = 'transcript.jsonl') {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function payloadFor({ transcript, sessionId = 'sess-1', cwd = 'C:/fixture-project', eventName = 'UserPromptSubmit', extra = {} }) {
  return JSON.stringify({ hook_event_name: eventName, session_id: sessionId, transcript_path: transcript, cwd, prompt: 'continue', ...extra });
}

function runHook(input, { home, switchValue, grok = false, ceiling } = {}) {
  const env = { ...process.env };
  delete env.CODE_OPS_HANDOFF_CARD;
  delete env.GROK_PLUGIN_ROOT;
  delete env.CODE_OPS_CONTEXT_CEILING;
  if (switchValue !== undefined) env.CODE_OPS_HANDOFF_CARD = switchValue;
  if (ceiling !== undefined) env.CODE_OPS_CONTEXT_CEILING = ceiling;
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  if (grok) env.GROK_PLUGIN_ROOT = join(root, 'plugins', 'code-ops-suite');
  return spawnSync('node', [hook], { input, encoding: 'utf8', env });
}

function parseOut(r) {
  if (r.stdout.trim() === '') return null;
  try { return JSON.parse(r.stdout); } catch { return 'unparsable'; }
}

// ---------------------------------------------------------------- crossing / band / re-arm sequence

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-transcript-'));
  const sessionId = 'sess-sequence';

  // Below 150,000: silent, no output.
  let transcript = writeTranscript(dir, assistantLine(140_000));
  let r = runHook(payloadFor({ transcript, sessionId }), { home });
  expect(r.status === 0 && r.stdout === '', `below threshold must be silent, got ${r.status}/${JSON.stringify(r.stdout)}`);

  // Crossing 150,000 (band 1): prints once.
  transcript = writeTranscript(dir, assistantLine(160_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  let out = parseOut(r);
  expect(r.status === 0 && out && out !== 'unparsable', `crossing must print one parsable JSON line, got ${r.status}/${JSON.stringify(r.stdout)}`);
  if (out && out !== 'unparsable') {
    expect(typeof out.systemMessage === 'string' && out.systemMessage.includes('/code-ops-suite:handoff'), 'systemMessage must name /code-ops-suite:handoff');
    expect(out.systemMessage.includes('161,000') || out.systemMessage.includes('160,000'), `systemMessage must name the approximate token count, got ${out.systemMessage}`);
    expect(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(out.systemMessage), 'the message must carry no emoji');
    const hso = out.hookSpecificOutput || {};
    expect(hso.hookEventName === 'UserPromptSubmit', `hookEventName must be UserPromptSubmit, got ${hso.hookEventName}`);
    expect(hso.additionalContext === out.systemMessage, 'additionalContext must match systemMessage');
    expect(!Object.hasOwn(hso, 'permissionDecision'), 'a UserPromptSubmit nudge must never carry a permissionDecision');
  }

  // Same band, a later prompt: silent.
  transcript = writeTranscript(dir, assistantLine(165_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  expect(r.status === 0 && r.stdout === '', `same band must stay silent, got ${r.status}/${JSON.stringify(r.stdout)}`);

  // Next band (2): prints again.
  transcript = writeTranscript(dir, assistantLine(310_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  out = parseOut(r);
  expect(r.status === 0 && out && out !== 'unparsable', `the next band must print again, got ${r.status}/${JSON.stringify(r.stdout)}`);

  // Falls back under 150,000: silent, and re-arms.
  transcript = writeTranscript(dir, assistantLine(50_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  expect(r.status === 0 && r.stdout === '', `dropping under the threshold must stay silent, got ${r.status}/${JSON.stringify(r.stdout)}`);

  // The re-arm lowers the live band but never the peak, which is what the session receipt reads.
  const marker = handoffMarkerPath('C:/fixture-project', sessionId, home);
  const stored = JSON.parse(readFileSync(marker, 'utf8'));
  expect(stored.band === 0 && stored.peak === 2, `the re-armed marker keeps the highest band reached, got ${JSON.stringify(stored)}`);
  expect(handoffPeakBand(marker) === 2, `handoffPeakBand reads the peak, got ${handoffPeakBand(marker)}`);
  expect(handoffPeakBand(join(dir, 'no-such-marker.json')) === 0, 'a missing marker reads as band 0');

  // Crossing 150,000 again after the drop: prints once more.
  transcript = writeTranscript(dir, assistantLine(155_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  out = parseOut(r);
  expect(r.status === 0 && out && out !== 'unparsable', `re-armed crossing must print again, got ${r.status}/${JSON.stringify(r.stdout)}`);

  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   crossing prints once, the same band stays silent, the next band prints, and dropping below 150,000 re-arms it');
}

// ---------------------------------------------------------------- compaction boundary

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-compact-'));
  const sessionId = 'sess-compact';
  const marker = handoffMarkerPath('C:/fixture-project', sessionId, home);
  const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: 320_000 } }) + '\n';

  // Band 1 recorded before the compaction.
  runHook(payloadFor({ transcript: writeTranscript(dir, assistantLine(160_000), 'pre.jsonl'), sessionId }), { home });
  const before = readFileSync(marker, 'utf8');

  // The first prompt after /compact: the only usage record predates the boundary, so the size is
  // unknown. The hook stays silent and leaves the marker untouched rather than writing a stale band
  // (a stale read of this band-2 size would print and record band 2).
  let content = assistantLine(319_000) + boundary;
  let r = runHook(payloadFor({ transcript: writeTranscript(dir, content, 'compact.jsonl'), sessionId }), { home });
  expect(r.status === 0 && r.stdout === '', `a pre-boundary usage record must not print a stale size, got ${JSON.stringify(r.stdout)}`);
  expect(readFileSync(marker, 'utf8') === before, 'an unknown post-compaction size must not rewrite the marker');

  // The first post-boundary usage record is read as usual: under 150,000 it re-arms the band.
  content += assistantLine(75_919);
  r = runHook(payloadFor({ transcript: writeTranscript(dir, content, 'compact.jsonl'), sessionId }), { home });
  expect(r.status === 0 && r.stdout === '', `a post-boundary size under the threshold must stay silent, got ${JSON.stringify(r.stdout)}`);
  const stored = JSON.parse(readFileSync(marker, 'utf8'));
  expect(stored.band === 0 && stored.peak === 1, `a post-boundary size must re-arm the band, got ${JSON.stringify(stored)}`);

  // Codex writes a `compacted` row; a token_count before it is equally stale.
  const codexCompacted = codexTokenLine(230_000) + JSON.stringify({ type: 'compacted', payload: { message: '' } }) + '\n';
  r = runHook(payloadFor({ transcript: writeTranscript(dir, codexCompacted, 'codex.jsonl'), sessionId: 'sess-codex-compact' }), { home });
  expect(r.status === 0 && r.stdout === '', `a Codex token_count before a compacted row must not print, got ${JSON.stringify(r.stdout)}`);

  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   a compaction boundary newer than the last usage record reads as unknown, and the next usage record re-arms the band');
}

// ---------------------------------------------------------------- compaction postTokens
// A boundary that carries compactMetadata.postTokens (real Claude transcripts do) reads as that
// size, labeled `compaction`, until a newer usage record replaces it. The hook re-arms the band
// on the first prompt after /compact instead of waiting for a turn.
{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-posttokens-'));
  const sessionId = 'sess-posttokens';
  const marker = handoffMarkerPath('C:/fixture-project', sessionId, home);
  const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 320_000, postTokens: 14_788 } }) + '\n';
  const read = (content, name) => residentContextReading({ transcript_path: writeTranscript(dir, content, name) }, { home });

  runHook(payloadFor({ transcript: writeTranscript(dir, assistantLine(160_000), 'pre.jsonl'), sessionId }), { home });
  let content = assistantLine(319_000) + boundary;
  const atBoundary = read(content, 'boundary.jsonl');
  expect(atBoundary?.tokens === 14_788 && atBoundary.source === 'compaction', `a boundary with postTokens must read as a compaction size, got ${JSON.stringify(atBoundary)}`);
  expect(residentContext({ transcript_path: join(dir, 'boundary.jsonl') }, { home }) === 14_788, 'residentContext must return the postTokens size');
  const r = runHook(payloadFor({ transcript: join(dir, 'boundary.jsonl'), sessionId }), { home });
  expect(r.status === 0 && r.stdout === '', `a small post-compaction size must stay silent, got ${JSON.stringify(r.stdout)}`);
  const stored = JSON.parse(readFileSync(marker, 'utf8'));
  expect(stored.band === 0 && stored.peak === 1, `a postTokens size must re-arm the band, got ${JSON.stringify(stored)}`);

  content += assistantLine(75_919);
  const after = read(content, 'after.jsonl');
  expect(after?.tokens === 76_919 && after.source === 'usage', `a newer usage record must replace the compaction size, got ${JSON.stringify(after)}`);

  const bare = JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'manual', preTokens: 320_000, postTokens: 'n/a' } }) + '\n';
  expect(read(assistantLine(319_000) + bare, 'bad.jsonl') === null, 'a non-numeric postTokens must read as unknown');

  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   a boundary postTokens reads as a compaction-labeled size until the next usage record');
}

// ---------------------------------------------------------------- lifecycle assessment reminder

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-band-'));
  const first = runHook(payloadFor({ transcript: writeTranscript(dir, assistantLine(160_000), 'b1.jsonl'), sessionId: 'sess-band-1' }), { home });
  const second = runHook(payloadFor({ transcript: writeTranscript(dir, assistantLine(330_000), 'b2.jsonl'), sessionId: 'sess-band-2' }), { home });
  const m1 = (parseOut(first) || {}).systemMessage || '';
  const m2 = (parseOut(second) || {}).systemMessage || '';
  expect(/handoff assess/.test(m1) && /CONTINUE, COMPACT, or HANDOFF/.test(m1) && /next safe boundary/.test(m1), `band 1 must request the lifecycle assessment at a safe boundary, got ${m1}`);
  expect(/handoff assess/.test(m2) && /before starting a new workstream/.test(m2), `band 2 must request the lifecycle assessment before a new workstream, got ${m2}`);
  expect(!/handoff now|declined|every turn re-reads all|full price/i.test(`${m1} ${m2}`), `the advisory must not assert the old handoff or cost claims, got ${m1} / ${m2}`);
  expect(m1 !== m2 && m2.includes('/code-ops-suite:handoff'), 'band 2 must escalate past band 1 and still name the command');
  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   both bands request a lifecycle assessment; the higher band asks before a new workstream');
}

// ---------------------------------------------------------------- context ceiling sentence

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-ceiling-'));
  const gated = /New dispatches are now gated until that assessment runs\./;
  const messageAt = (context, sessionId, ceiling) => {
    const env = ceiling === undefined ? {} : { ceiling };
    return (parseOut(runHook(payloadFor({ transcript: writeTranscript(dir, assistantLine(context), `${sessionId}.jsonl`), sessionId }), { home, ...env })) || {}).systemMessage || '';
  };
  const below = messageAt(160_000, 'sess-ceil-below');
  expect(/handoff assess/.test(below) && !gated.test(below), `a crossing under the ceiling must not claim a dispatch gate, got ${below}`);
  const above = messageAt(310_000, 'sess-ceil-above');
  expect(gated.test(above) && above.trim().endsWith('assessment runs.'), `a crossing at or past the ceiling must end with the gate sentence, got ${above}`);
  expect(gated.test(messageAt(300_000, 'sess-ceil-exact')), 'a crossing exactly at the ceiling must name the gate');
  for (const value of ['off', '0', 'false']) {
    const off = messageAt(310_000, `sess-ceil-off-${value}`, value);
    expect(/handoff assess/.test(off) && !gated.test(off), `CODE_OPS_CONTEXT_CEILING=${value} must drop only the gate sentence, got ${off}`);
  }
  expect(gated.test(messageAt(160_000, 'sess-ceil-override', '150000')), 'an overridden 150,000 ceiling must name the gate at band 1');
  expect(!gated.test(messageAt(460_000, 'sess-ceil-high', '500000')), 'context under an overridden ceiling must not name the gate');
  expect(gated.test(messageAt(310_000, 'sess-ceil-invalid', '100000')), 'an invalid ceiling must fall back to 300,000');
  const grok = runHook(payloadFor({ transcript: writeTranscript(dir, grokUsageLine(210_000), 'updates.jsonl'), sessionId: 'sess-ceil-grok', eventName: 'PostToolUse' }), { home, grok: true });
  const grokNote = (parseOut(grok) || {}).hookSpecificOutput?.additionalContext || '';
  expect(/handoff assess/.test(grokNote) && gated.test(grokNote), `Grok past its 200,000-token ceiling must name the spawn_subagent gate, got ${grokNote}`);
  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   a crossing at or past the context ceiling says new dispatches are gated, on Grok from 200,000');
}

// ---------------------------------------------------------------- typed handoff command unlocks the guard

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-typed-'));
  const guard = join(root, 'plugins', 'code-ops-suite', 'hooks', 'dispatch-guard.mjs');
  const transcript = writeTranscript(dir, assistantLine(310_000), 'typed.jsonl');
  const dispatch = JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'sess-typed', transcript_path: transcript, cwd: 'C:/fixture-project',
    tool_name: 'Agent', tool_input: { subagent_type: 'code-ops-suite:explorer', prompt: [
      // A full brief, so the guard's Brief-requires check passes and only the ceiling decides.
      'Scope: fixture', 'Objective: fixture', 'Round budget: 10 rounds',
      'Report cap: 100 words', 'Report path: fixture.md', 'Expected return: verdict',
    ].join('\n') } });
  const runGuard = () => {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CODE_OPS_CONTEXT_CEILING; delete env.CODE_OPS_DISPATCH_GUARD; delete env.GROK_PLUGIN_ROOT;
    return (parseOut(spawnSync('node', [guard], { input: dispatch, encoding: 'utf8', env })) || {}).hookSpecificOutput?.permissionDecision;
  };
  expect(runGuard() === 'deny', 'the guard must deny a dispatch past the ceiling before any assessment');
  runHook(payloadFor({ transcript, sessionId: 'sess-typed', extra: { prompt: 'plain request' } }), { home });
  expect(runGuard() === 'deny', 'a prompt that does not name the handoff command must not unlock the guard');
  runHook(payloadFor({ transcript, sessionId: 'sess-typed', extra: { prompt: '/code-ops-suite:handoff assess' } }), { home });
  expect(runGuard() !== 'deny', 'a typed handoff command must unlock the guard for the current band');
  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   a typed handoff command records the assessment the dispatch guard reads');
}

// ---------------------------------------------------------------- Codex token-count fixture

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-codex-'));
  const r = runHook(payloadFor({ transcript: writeTranscript(dir, codexTokenLine(310_000), 'codex.jsonl'), sessionId: 'sess-codex' }), { home });
  const message = (parseOut(r) || {}).systemMessage || '';
  expect(r.status === 0 && /handoff assess/.test(message), `a Codex token_count transcript must receive lifecycle guidance, got ${r.status}/${message}`);
  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   a Codex token-count transcript receives the lifecycle assessment reminder');
}

// ---------------------------------------------------------------- the off switch

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-off-'));
  const transcript = writeTranscript(dir, assistantLine(300_000));
  for (const value of ['off', '0', 'false', 'OFF', 'False']) {
    const r = runHook(payloadFor({ transcript, sessionId: `sess-off-${value}` }), { home, switchValue: value });
    expect(r.status === 0 && r.stdout === '', `CODE_OPS_HANDOFF_CARD=${value} must silence a crossing transcript, got ${r.status}/${JSON.stringify(r.stdout)}`);
  }
  for (const value of [undefined, 'on', '1', 'true', '']) {
    const r = runHook(payloadFor({ transcript, sessionId: `sess-on-${String(value)}` }), { home, switchValue: value });
    expect(r.status === 0 && r.stdout !== '', `unset or a non-off value must leave the hook on, got ${r.status}/${JSON.stringify(r.stdout)} for ${value}`);
  }
  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   off, 0, and false silence a crossing transcript; unset and non-off values leave it on');
}

// ---------------------------------------------------------------- Grok delivery channel

function grokUsageLine(inputTokens) {
  return JSON.stringify({
    timestamp: 1,
    params: { update: { prompt_id: 'p1', usage: { inputTokens, cachedReadTokens: 10, cacheCreationTokens: 0, outputTokens: 5, totalTokens: inputTokens + 5 } } },
  }) + '\n';
}

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-grok-'));
  const transcript = writeTranscript(dir, assistantLine(300_000));
  const ignored = runHook(payloadFor({ transcript, sessionId: 'sess-grok-prompt' }), { home, grok: true });
  expect(ignored.status === 0 && ignored.stdout === '', `Grok UserPromptSubmit must emit nothing, got ${ignored.status}/${JSON.stringify(ignored.stdout)}`);

  const updates = writeTranscript(dir, grokUsageLine(160_000), 'updates.jsonl');
  const first = runHook(payloadFor({ transcript: updates, sessionId: 'sess-grok-tool', eventName: 'PostToolUse' }), { home, grok: true });
  const body = parseOut(first) || {};
  const note = body.hookSpecificOutput?.additionalContext || '';
  expect(first.status === 0 && body.systemMessage === undefined
    && body.hookSpecificOutput?.hookEventName === 'PostToolUse'
    && /160,000 tokens/.test(note) && /handoff assess/.test(note),
    `Grok PostToolUse must emit one additionalContext, got ${first.status}/${JSON.stringify(first.stdout)}`);
  const again = runHook(payloadFor({ transcript: updates, sessionId: 'sess-grok-tool', eventName: 'PostToolUse' }), { home, grok: true });
  expect(again.status === 0 && again.stdout === '', `the same Grok band must stay silent, got ${JSON.stringify(again.stdout)}`);

  const off = runHook(payloadFor({ transcript: writeTranscript(dir, grokUsageLine(320_000), 'updates-off.jsonl'), sessionId: 'sess-grok-off', eventName: 'PostToolUse' }), { home, grok: true, switchValue: 'off' });
  expect(off.status === 0 && off.stdout === '', `CODE_OPS_HANDOFF_CARD=off must silence Grok PostToolUse, got ${JSON.stringify(off.stdout)}`);

  const chatDir = mkdtempSync(join(tmpdir(), 'handoff-grok-chat-'));
  writeTranscript(chatDir, '{}\n', 'chat_history.jsonl');
  const sibling = writeTranscript(chatDir, grokUsageLine(170_000), 'updates.jsonl');
  const viaChat = runHook(payloadFor({ transcript: join(chatDir, 'chat_history.jsonl'), sessionId: 'sess-grok-chat', eventName: 'PostToolUse' }), { home, grok: true });
  const chatNote = (parseOut(viaChat) || {}).hookSpecificOutput?.additionalContext || '';
  expect(viaChat.status === 0 && /170,000 tokens/.test(chatNote), `a chat_history path must read the sibling updates stream, got ${JSON.stringify(viaChat.stdout)}`);
  expect(sibling.length > 0, 'sibling updates fixture must exist');

  rmSync(dir, { recursive: true, force: true });
  rmSync(chatDir, { recursive: true, force: true });
  cleanup();
  console.log('ok   Grok UserPromptSubmit stays silent; PostToolUse emits one note per band from updates.jsonl');
}

// ---------------------------------------------------------------- fail open

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-failopen-'));
  const transcript = writeTranscript(dir, assistantLine(300_000));

  const cases = [
    ['bad JSON', '{not json'],
    ['empty stdin', ''],
    ['another event name', payloadFor({ transcript, sessionId: 'sess-a', eventName: 'PreToolUse' })],
    ['missing session_id', JSON.stringify({ hook_event_name: 'UserPromptSubmit', transcript_path: transcript, cwd: 'C:/fixture-project' })],
    ['missing transcript_path', JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'sess-b', cwd: 'C:/fixture-project' })],
    ['transcript file does not exist', payloadFor({ transcript: join(dir, 'no-such-file.jsonl'), sessionId: 'sess-c' })],
    ['transcript with no assistant usage', payloadFor({ transcript: writeTranscript(dir, JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n', 'no-usage.jsonl'), sessionId: 'sess-d' })],
  ];
  for (const [name, input] of cases) {
    const r = runHook(input, { home });
    expect(r.status === 0 && r.stdout === '', `${name}: must exit 0 with no output, got ${r.status}/${JSON.stringify(r.stdout)}`);
  }
  console.log(`ok   ${cases.length} malformed or missing-evidence payloads fail open`);

  const bom = runHook(`\uFEFF${payloadFor({ transcript, sessionId: 'sess-bom' })}`, { home });
  expect(bom.status === 0 && bom.stdout !== '', 'a BOM-prefixed payload is still read');
  console.log('ok   a BOM-prefixed payload is still read');

  rmSync(dir, { recursive: true, force: true });
  cleanup();
}

// ---------------------------------------------------------------- pending-handoff pickup (routing card)

{
  const routingCard = join(root, 'plugins', 'code-ops-suite', 'hooks', 'routing-card.mjs');
  const runCard = (payload, { switchValue } = {}) => {
    const env = { ...process.env };
    delete env.CODE_OPS_HANDOFF_PICKUP;
    delete env.GROK_PLUGIN_ROOT;
    if (switchValue !== undefined) env.CODE_OPS_HANDOFF_PICKUP = switchValue;
    return spawnSync('node', [routingCard], { input: JSON.stringify(payload), encoding: 'utf8', env });
  };
  const pickupLine = (r) => (r.stdout || '').split('\n').find((l) => l.startsWith('pending handoff:')) || null;

  // A hub-shaped fixture: the vault layout rule puts `80 Runs/` inside a `<repo>-docs/` hub, and
  // both the hub folder and the dated run folder carry spaces in real repositories.
  const project = mkdtempSync(join(tmpdir(), 'handoff-pickup-'));
  const runsDir = join(project, 'fixture-docs', '80 Runs');
  const folder = join(runsDir, '2026-09-18 token spend audit');
  mkdirSync(folder, { recursive: true });
  const handoff = join(folder, 'HANDOFF.md');
  writeFileSync(handoff, '# HANDOFF\n');
  const startup = { hook_event_name: 'SessionStart', source: 'startup', cwd: project };

  const fresh = runCard(startup);
  const line = pickupLine(fresh);
  expect(fresh.status === 0 && line !== null, `a fresh session must name the pending handoff, got ${JSON.stringify(fresh.stdout)}`);
  if (line) {
    expect(line.includes('fixture-docs/80 Runs/2026-09-18 token spend audit/HANDOFF.md'),
      `the pickup line must carry the repo-relative path with forward slashes, got ${line}`);
    const today = new Date();
    const stamp = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(line.includes(`(written ${stamp})`), `the pickup line must carry the write date, got ${line}`);
    expect(line.includes('code-ops-suite:handoff') && !line.includes('/code-ops-suite:handoff'),
      `the pickup line must name the skill without Claude-only slash syntax, so the Codex projection stays valid, got ${line}`);
    expect(/five headings: work completed, key findings, in progress, left to do, project scope and constraints/.test(line),
      `the pickup line must name the five recap headings, got ${line}`);
    expect(fresh.stdout.split('\n').filter((l) => l.startsWith('pending handoff:')).length === 1, 'the pickup line must print once');
  }
  // A handoff naming its Program ledger puts that path on the pickup line, ahead of the resume
  // instruction. A placeholder or an overlong value stays off, so the card size stays bounded.
  const programLine = (value) => {
    writeFileSync(handoff, `# HANDOFF\n\nVerified-at: abc1234\r\n\r\n## Program\r\n\r\nProgram: ${value}\r\nPredecessor: none\r\n\r\n## Goal and state of play\n\nProgram: decoy/PROGRAM.md\n`);
    return pickupLine(runCard(startup)) || '';
  };
  const withProgram = programLine('`fixture-docs/80 Runs/programs/p1/PROGRAM.md`');
  expect(withProgram.includes('Program ledger: fixture-docs/80 Runs/programs/p1/PROGRAM.md; read it first.')
    && withProgram.indexOf('Program ledger:') < withProgram.indexOf('Before other work'),
  `a handoff with a Program line must name the ledger before the resume instruction, got ${withProgram}`);
  expect(!withProgram.includes('decoy'), 'only the Program line under "## Program" may reach the card');
  const bare = (() => { writeFileSync(handoff, '# HANDOFF\n'); return pickupLine(runCard(startup)) || ''; })();
  expect(!bare.includes('Program ledger:'), 'a handoff without a Program section must not name a ledger');
  expect(!programLine("[FILL: path to this program's PROGRAM.md ledger]").includes('Program ledger:'), 'a [FILL: placeholder must stay off the card');
  expect(!programLine(`${'x/'.repeat(120)}PROGRAM.md`).includes('Program ledger:'), 'a Program path over 200 characters must stay off the card');
  expect(Buffer.byteLength(withProgram) - Buffer.byteLength(bare) <= 240,
    `the ledger must add at most 240 bytes to the pickup line, added ${Buffer.byteLength(withProgram) - Buffer.byteLength(bare)}`);
  writeFileSync(handoff, '# HANDOFF\n');
  expect(pickupLine(runCard({ ...startup, source: 'clear' })) !== null, 'a cleared session must also get the pickup line');
  const compact = runCard({ ...startup, source: 'compact' });
  expect(/compaction resume: restore decisions, constraints, completed and open work/.test(compact.stdout),
    `a compact source must receive the durable-state restore instruction, got ${JSON.stringify(compact.stdout)}`);
  for (const source of ['resume', 'compact']) {
    expect(pickupLine(runCard({ ...startup, source })) === null, `source ${source} must not get the pickup line`);
  }
  for (const value of ['off', '0', 'false', 'OFF']) {
    expect(pickupLine(runCard(startup, { switchValue: value })) === null, `CODE_OPS_HANDOFF_PICKUP=${value} must silence the pickup line`);
  }
  expect(pickupLine(runCard(startup, { switchValue: 'on' })) !== null, 'a non-off switch value must leave the pickup on');

  // The newest pending handoff wins, and a root-level `80 Runs/` is searched beside the hub's.
  const rootFolder = join(project, '80 Runs', '2026-09-19 newer run');
  mkdirSync(rootFolder, { recursive: true });
  writeFileSync(join(rootFolder, 'HANDOFF.md'), '# HANDOFF\n');
  const aged = Date.now() / 1000 - 3600;
  utimesSync(handoff, aged, aged);
  expect((pickupLine(runCard(startup)) || '').includes('80 Runs/2026-09-19 newer run/HANDOFF.md'),
    'the newest pending handoff must win, including one under a root-level 80 Runs/');

  // A consumed sibling retires the handoff; with both retired, nothing is advertised.
  writeFileSync(join(rootFolder, 'HANDOFF.consumed'), `${new Date().toISOString()}\n`);
  expect((pickupLine(runCard(startup)) || '').includes('2026-09-18 token spend audit'),
    'a consumed sibling must retire that handoff and let the older pending one show');
  writeFileSync(join(folder, 'HANDOFF.consumed'), `${new Date().toISOString()}\n`);
  expect(pickupLine(runCard(startup)) === null, 'two consumed handoffs must leave no pickup line');

  // Older than 14 days is history, not pending.
  rmSync(join(folder, 'HANDOFF.consumed'));
  const old = Date.now() / 1000 - 15 * 86_400;
  utimesSync(handoff, old, old);
  expect(pickupLine(runCard(startup)) === null, 'a handoff older than 14 days must not be advertised');

  // Fail open: a cwd that does not exist still prints the routing card itself.
  const missing = runCard({ ...startup, cwd: join(project, 'no-such-dir') });
  expect(missing.status === 0 && /code-ops standard operating mode/.test(missing.stdout) && pickupLine(missing) === null,
    'an unreadable cwd must fail open with the card and no pickup line');

  rmSync(project, { recursive: true, force: true });
  console.log('ok   the routing card names the newest pending handoff, skips consumed and stale ones, and honors its switch');
}

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\nhandoff-card eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nhandoff-card eval passed');
