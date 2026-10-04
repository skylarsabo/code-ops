#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/handoff-card.mjs, the opt-in
// UserPromptSubmit context-size nudge. It pins the contract the hook promises:
//   - on by default: without CODE_OPS_HANDOFF_CARD a crossing transcript prints once, and off,
//     0, or false silences it for the same fixture;
//   - below 150,000 tokens of resident context (input + cache-read + cache-creation on the last
//     assistant usage record), the hook is silent and writes no marker;
//   - crossing 150,000 prints exactly one JSON line, naming the approximate token count and
//     the host's relief (auto-compaction on Claude and Codex), on both systemMessage and hookSpecificOutput's
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
//   - on Claude and Codex (DEC-73) band 1 names host auto-compaction as the relief and asks the lead
//     to checkpoint (TASKS.md current, a RUN_LOG.md `Next:` line); Claude ends with the PreCompact
//     snapshot sentence and Codex with `co snapshot`, and Codex is any non-Grok host without
//     CLAUDECODE or CLAUDE_PROJECT_DIR. Band 2 and above says to finish the step, checkpoint, ask
//     for /compact if the host has not compacted, and hand off only for new work or a clean session.
//     No card says to hand off on a token count; on Claude, with CLAUDE_CODE_AUTO_COMPACT_WINDOW
//     unset, the card adds one line naming it; on Grok each band asks for /compact and names
//     COMPACT_SNAPSHOT.md. A higher band asks for another compact when the summary dropped it;
//   - a crossing at or past the context ceiling (CODE_OPS_CONTEXT_CEILING, default 300,000)
//     ends with one sentence saying new dispatches are gated; off drops only that sentence, an
//     override moves it, an invalid value falls back to 300,000, and Grok gets it from 200,000;
//   - on Grok only, the card fires once more at the 200,000-token price line and asks for /compact;
//     with no operator prompt since the last card, it says to checkpoint and stop new work;
//   - on Grok only, a Continue-until bound (tokens or turns) in the run's RUN_LOG.md holds the card
//     until it passes, then the card fires once; a malformed bound sets none, and off still
//     silences. Claude and Codex ignore the line.
//
// It also pins the history read notice: a PostToolUse Read, Grep, or shell call (Claude, Codex, and
// Grok payloads) that opens a superseded or amended decision record adds one context line naming
// the status, the replacing record, and the register; an in-force, evidence, unlisted, or outside
// path, a pathless Grep, and a non-read tool get nothing; `CODE_OPS_READ_NOTICE` off values silence
// it while the card and feed switches do not; a corrupt state.json fails open.
//
// It also covers the other half of the handoff loop, the pending-handoff pickup line
// plugins/code-ops-suite/hooks/routing-card.mjs injects at SessionStart: which sources get it,
// what makes a handoff pending, and the CODE_OPS_HANDOFF_PICKUP switch. After compaction the same
// card lists the session run folder's unchecked TASKS.md lines (at most 12, 80 characters each).
//
//   node evals/handoff-card/run.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { markSessionEnded, recordFromPayload } from '../../scripts/agent-ledger.mjs';
import { repoIdentity, updateBoard } from '../../scripts/handoff-state.mjs';
import { handoffMarkerPath, handoffPeakBand, residentContext, residentContextReading } from '../../scripts/transcript-lib.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const hook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'handoff-card.mjs');

const { fails, expect } = tally();

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

function runHook(input, { home, switchValue, grok = false, ceiling, env: extra = {} } = {}) {
  const env = { ...process.env };
  delete env.CODE_OPS_HANDOFF_CARD;
  delete env.GROK_PLUGIN_ROOT;
  delete env.CODE_OPS_CONTEXT_CEILING;
  delete env.CODE_OPS_READ_NOTICE;
  // A host marker from the session running this eval must not reach the hook under test.
  for (const key of ['CLAUDECODE', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW']) delete env[key];
  Object.assign(env, extra);
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

// The exact Claude and Codex card text (DEC-73). Each piece is pinned here so a wording drift fails.
const held = (approx) => `This session holds approximately ${approx} tokens of context. `;
const BAND1 = 'Host auto-compaction is the relief, so no handoff is needed. At the next safe boundary, checkpoint: keep TASKS.md current and append a `Next:` line to RUN_LOG.md naming the step in flight, its next command, and the file:line it edits. ';
const SNAPSHOT_CLAUDE = 'The PreCompact snapshot keeps operator words, running work, and peers.';
const SNAPSHOT_CODEX = 'Then run `co snapshot`, because the Codex PreCompact hook does not fire.';
const BAND2 = 'Finish the step in flight and checkpoint as above. If the host has not compacted, ask the operator to run /compact. Hand off only for new work or a clean session that loads updated code-ops plugins.';
const SETTING_LINE = ' CLAUDE_CODE_AUTO_COMPACT_WINDOW is unset; set it (250000 recommended) in the env block of your Claude Code settings so the host compacts near that size.';
const GATED = ' New dispatches are now gated until you run /code-ops-suite:handoff assess.';
const CLAUDE_WINDOW_SET = { CLAUDECODE: '1', CLAUDE_CODE_AUTO_COMPACT_WINDOW: '250000' };
// The old non-Grok card told the lead to run the assessment; no Claude or Codex card may again.
const OLD_ASSESS = /run \/code-ops-suite:handoff assess to choose/;

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
    expect(out.systemMessage === held('160,000') + BAND1 + SNAPSHOT_CODEX, `a host-neutral band 1 card must be the exact Codex text, got ${out.systemMessage}`);
    expect(!OLD_ASSESS.test(out.systemMessage), 'the card must not tell the lead to run the assessment');
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

// ---------------------------------------------------------------- marker keyed by repository root
// A lead whose shell changes directory reports a different payload cwd on each prompt. The marker
// keys on the repository root (nearest ancestor holding `.git`), so one session shows one card per
// band across those cwds, while two repository roots keep separate markers.

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-stateroot-'));
  const repoA = join(dir, 'repo-a');
  const repoB = join(dir, 'repo-b');
  const sub = join(repoA, 'pkg', 'deep');
  mkdirSync(sub, { recursive: true });
  mkdirSync(repoB, { recursive: true });
  // `.git` is a file in a worktree and a directory in a clone; the walk accepts both.
  writeFileSync(join(repoA, '.git'), 'gitdir: elsewhere\n');
  mkdirSync(join(repoB, '.git'));
  const transcript = writeTranscript(dir, assistantLine(160_000));
  const cardFrom = (cwd, sessionId) => parseOut(runHook(payloadFor({ transcript, sessionId, cwd }), { home }));

  const first = cardFrom(repoA, 'sess-root-keyed');
  expect(first && first !== 'unparsable', `the first prompt of the band must print a card, got ${JSON.stringify(first)}`);
  const second = cardFrom(sub, 'sess-root-keyed');
  expect(second === null, `a prompt from a subdirectory of the same repository must not repeat the band card, got ${JSON.stringify(second)}`);
  expect(cardFrom(repoA, 'sess-root-keyed') === null, 'a return to the repository root must stay silent');
  expect(handoffMarkerPath(repoA, 'sess-root-keyed', home) === handoffMarkerPath(sub, 'sess-root-keyed', home),
    'the root and a subdirectory must resolve to one marker path');

  const other = cardFrom(repoB, 'sess-root-keyed');
  expect(other && other !== 'unparsable', `a separate repository root must keep its own marker and print its own card, got ${JSON.stringify(other)}`);
  expect(handoffMarkerPath(repoA, 'sess-root-keyed', home) !== handoffMarkerPath(repoB, 'sess-root-keyed', home),
    'two repository roots must resolve to separate markers');

  // No `.git` above the cwd: the cwd keys the marker itself, as before.
  const loose = join(dir, 'loose');
  mkdirSync(loose);
  expect(handoffMarkerPath(loose, 'sess-root-keyed', home) !== handoffMarkerPath(repoA, 'sess-root-keyed', home),
    'a cwd with no repository root above it must not share the repository marker');

  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   one session shows one band card across cwds under one repository root, and separate roots keep separate markers');
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
  // Each card is the exact text for its host and band. The ceiling is off so band 2 carries no gate
  // sentence; the ceiling block below pins that one.
  const cardAt = (context, sessionId, env = {}) => (parseOut(runHook(payloadFor({ transcript: writeTranscript(dir, assistantLine(context), `${sessionId}.jsonl`), sessionId }), { home, ceiling: 'off', env })) || {}).systemMessage || '';
  const SETTING = /CLAUDE_CODE_AUTO_COMPACT_WINDOW is unset; set it \(250000 recommended\)/;
  const codex1 = cardAt(160_000, 'sess-codex-1');
  const codex2 = cardAt(330_000, 'sess-codex-2');
  const claude1 = cardAt(160_000, 'sess-claude-1', CLAUDE_WINDOW_SET);
  const claude2 = cardAt(330_000, 'sess-claude-2', CLAUDE_WINDOW_SET);
  const claude1Unset = cardAt(160_000, 'sess-env-claude', { CLAUDECODE: '1' });
  const claude2Unset = cardAt(330_000, 'sess-env-claude-2', { CLAUDECODE: '1' });
  const project1Unset = cardAt(160_000, 'sess-env-project', { CLAUDE_PROJECT_DIR: '/fixture' });
  // DEC-73: Claude and Codex name host auto-compaction as the relief and ask for a checkpoint; no card
  // says to hand off on a token count. Codex is any non-Grok host without a Claude marker.
  expect(codex1 === held('160,000') + BAND1 + SNAPSHOT_CODEX, `Codex band 1 must be the exact text ending with co snapshot, got ${codex1}`);
  expect(codex2 === held('330,000') + BAND2, `Codex band 2 must be the exact escalated text, got ${codex2}`);
  expect(claude1 === held('160,000') + BAND1 + SNAPSHOT_CLAUDE, `Claude band 1 with the window set must be the exact text, got ${claude1}`);
  expect(claude2 === held('330,000') + BAND2, `Claude band 2 with the window set must be the exact escalated text, got ${claude2}`);
  expect(claude1Unset === held('160,000') + BAND1 + SNAPSHOT_CLAUDE + SETTING_LINE, `Claude band 1 with the window unset must end with the setting line, got ${claude1Unset}`);
  expect(claude2Unset === held('330,000') + BAND2 + SETTING_LINE, `Claude band 2 with the window unset must end with the setting line, got ${claude2Unset}`);
  expect(project1Unset === claude1Unset, `CLAUDE_PROJECT_DIR must also mark a Claude host, got ${project1Unset}`);
  for (const m of [codex1, codex2, claude1, claude2, claude1Unset, claude2Unset]) {
    expect(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(m), `a card must carry no emoji, got ${m}`);
    expect(!OLD_ASSESS.test(m) && !/handoff assess|CONTINUE|HANDOFF/.test(m), `a Claude or Codex card must not ask for an assessment, got ${m}`);
    expect(!/hand off (now|at the next|by)|handoff point|write the handoff|Continue-until/i.test(m), `a Claude or Codex card must never say to hand off on token count, got ${m}`);
    expect(!/handoff now|declined|every turn re-reads all|full price/i.test(m), `the card must not assert the old handoff or cost claims, got ${m}`);
  }
  expect(codex1 !== codex2 && claude1 !== claude2, 'band 2 must escalate past band 1');

  // The setting line: Claude only, only while CLAUDE_CODE_AUTO_COMPACT_WINDOW is unset.
  expect(SETTING.test(claude1Unset) && SETTING.test(claude2Unset), 'Claude with the window unset must get the setting line on both bands');
  expect(!SETTING.test(claude1) && !SETTING.test(claude2), 'Claude with the window set must get no setting line');
  expect(!SETTING.test(codex1) && !SETTING.test(codex2), 'a host that is not Claude (Codex) must get no setting line');
  expect(/Host auto-compaction is the relief.*PreCompact snapshot keeps operator words, running work, and peers\. CLAUDE_CODE_AUTO_COMPACT_WINDOW is unset/.test(claude1Unset), 'the setting line must follow the checkpoint advice in the same card');
  expect(/Hand off only for new work or a clean session that loads updated code-ops plugins\. CLAUDE_CODE_AUTO_COMPACT_WINDOW is unset/.test(claude2Unset), 'the setting line must follow the band 2 advice in the same card');

  // Grok asks for a suite compact and never gets the Claude setting line.
  const grokBand = (parseOut(runHook(payloadFor({ transcript: writeTranscript(dir, grokUsageLine(160_000), 'grok-band-updates.jsonl'), sessionId: 'sess-band-grok', eventName: 'PostToolUse' }), { home, grok: true, env: { CLAUDECODE: '1' } })) || {}).hookSpecificOutput?.additionalContext || '';
  expect(/compact this session before the 200,000-token price line/.test(grokBand) && /COMPACT_SNAPSHOT\.md outranks/.test(grokBand) && !SETTING.test(grokBand) && !/auto-compaction/.test(grokBand), `Grok band 1 must ask for a suite compact with no Claude setting line, got ${grokBand}`);
  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   Claude and Codex cards pin exact text, with auto-compaction as the relief and no assessment; Claude gets the window setting line only while it is unset; Grok asks for a suite compact');
}

// ---------------------------------------------------------------- context ceiling sentence

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-ceiling-'));
  const gated = /New dispatches are now gated until you run \/code-ops-suite:handoff assess\./;
  const gatedGrok = /New dispatches are now gated until you run \/compact or \/code-ops-suite:handoff assess\./;
  const relief = /Host auto-compaction is the relief/;
  const messageAt = (context, sessionId, ceiling, env) => {
    const opts = ceiling === undefined ? {} : { ceiling };
    return (parseOut(runHook(payloadFor({ transcript: writeTranscript(dir, assistantLine(context), `${sessionId}.jsonl`), sessionId }), { home, ...opts, env })) || {}).systemMessage || '';
  };
  const below = messageAt(160_000, 'sess-ceil-below');
  expect(relief.test(below) && !gated.test(below), `a crossing under the ceiling must not claim a dispatch gate, got ${below}`);
  const above = messageAt(310_000, 'sess-ceil-above');
  expect(above === held('310,000') + BAND2 + GATED, `a Codex crossing at or past the ceiling must be band 2 text ending with the gate sentence, got ${above}`);
  const aboveClaude = messageAt(310_000, 'sess-ceil-above-claude', undefined, CLAUDE_WINDOW_SET);
  expect(aboveClaude === held('310,000') + BAND2 + GATED, `a Claude crossing at or past the ceiling must end with the gate sentence, got ${aboveClaude}`);
  const aboveUnset = messageAt(310_000, 'sess-ceil-above-unset', undefined, { CLAUDECODE: '1' });
  expect(aboveUnset === held('310,000') + BAND2 + SETTING_LINE + GATED, `the gate sentence must follow the setting line, got ${aboveUnset}`);
  expect(!OLD_ASSESS.test(above) && !OLD_ASSESS.test(aboveClaude) && !OLD_ASSESS.test(aboveUnset) && !gatedGrok.test(above), 'a non-Grok gate sentence must not reuse the Grok wording or ask to choose an assessment');
  expect(gated.test(messageAt(300_000, 'sess-ceil-exact')), 'a crossing exactly at the ceiling must name the gate');
  for (const value of ['off', '0', 'false']) {
    const off = messageAt(310_000, `sess-ceil-off-${value}`, value);
    expect(off === held('310,000') + BAND2, `CODE_OPS_CONTEXT_CEILING=${value} must drop only the gate sentence, got ${off}`);
  }
  expect(gated.test(messageAt(160_000, 'sess-ceil-override', '150000')), 'an overridden 150,000 ceiling must name the gate at band 1');
  expect(!gated.test(messageAt(460_000, 'sess-ceil-high', '500000')), 'context under an overridden ceiling must not name the gate');
  expect(gated.test(messageAt(310_000, 'sess-ceil-invalid', '100000')), 'an invalid ceiling must fall back to 300,000');
  const grok = runHook(payloadFor({ transcript: writeTranscript(dir, grokUsageLine(210_000), 'updates.jsonl'), sessionId: 'sess-ceil-grok', eventName: 'PostToolUse' }), { home, grok: true });
  const grokNote = (parseOut(grok) || {}).hookSpecificOutput?.additionalContext || '';
  expect(/\/compact/.test(grokNote) && gatedGrok.test(grokNote) && !gated.test(grokNote), `Grok past its 200,000-token ceiling must name the spawn_subagent gate, got ${grokNote}`);
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
  expect(r.status === 0 && message === held('310,000') + BAND2 + GATED, `a Codex token_count transcript must receive the exact band 2 card with the gate sentence, got ${r.status}/${message}`);
  expect(!OLD_ASSESS.test(message), 'the Codex card must not ask to choose an assessment');
  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   a Codex token-count transcript receives the compaction card');
}

// ---------------------------------------------------------------- price line and Continue-until
// DEC-73: Claude and Codex have no price line and ignore Continue-until; their cards ask for a
// checkpoint at any size. On Grok the card fires once more at the 200,000-token price line and
// asks for /compact; with no operator prompt since the last card, it says to checkpoint and stop
// new work. A Continue-until bound in the run log holds the Grok card until the bound passes; a
// malformed bound sets none.

{
  const { home, cleanup } = fakeHome();
  const project = mkdtempSync(join(tmpdir(), 'handoff-point-'));
  const message = (r) => { const o = parseOut(r); return o && o !== 'unparsable' ? (o.systemMessage || o.hookSpecificOutput?.additionalContext || '') : ''; };
  const at = (context, sessionId, opts = {}) => runHook(payloadFor({ transcript: writeTranscript(project, assistantLine(context), `${sessionId}.jsonl`), sessionId, cwd: project }), { home, ...opts });
  const handOff = /past the 200,000-token price line, where input is billed double/;
  const autonomousText = /no operator prompt has arrived since the last card\. At the next phase boundary, checkpoint and stop new work so the operator can run \/compact\./;
  const compaction = /Host auto-compaction is the relief|Finish the step in flight and checkpoint as above/;
  const noHandoffOnTokens = (text) => !/handoff point|hand off (now|at the next|by)|write the handoff|Continue-until/i.test(text);

  // Claude and Codex: the card at 225,000 is the plain band-1 compaction card, once per arm.
  const first = message(at(225_000, 'sess-point-fresh'));
  expect(compaction.test(first) && noHandoffOnTokens(first) && !autonomousText.test(first), `a Claude or Codex card at 225,000 must ask for CONTINUE or COMPACT and not for a handoff, got ${first}`);
  expect(message(at(226_000, 'sess-point-fresh')) === '', 'a Claude or Codex session fires once per band, with no extra handoff-point card');
  expect(at(240_000, 'sess-point-fresh').stdout === '', 'a Claude or Codex session past 225,000 stays silent within its band');

  // Two consecutive band-crossing prompts never claim that no prompt arrived.
  at(160_000, 'sess-consecutive');
  const consecutive = message(at(310_000, 'sess-consecutive'));
  expect(compaction.test(consecutive) && noHandoffOnTokens(consecutive) && !autonomousText.test(consecutive), `two consecutive card prompts must keep the compaction wording, got ${consecutive}`);

  // Continue-until is Grok only: a Claude or Codex session with the line in its run log gets the
  // normal band-1 card, with no bound held or announced.
  const runDir = join(project, 'run');
  mkdirSync(runDir, { recursive: true });
  const bindRun = (sessionId, log) => {
    const recordDir = join(home, '.claude', 'code-ops', 'sessions', project.replace(/[^A-Za-z0-9]/g, '-'));
    mkdirSync(recordDir, { recursive: true });
    writeFileSync(join(recordDir, `${sessionId.replace(/[^A-Za-z0-9]/g, '-')}.json`), JSON.stringify({ v: 1, sessionId, name: 'fixture', runDir: 'run' }));
    writeFileSync(join(runDir, 'RUN_LOG.md'), log);
  };
  bindRun('sess-claude-until', '# RUN_LOG\n\nContinue-until: 400,000 tokens\n');
  const ignoredBound = message(at(230_000, 'sess-claude-until'));
  expect(compaction.test(ignoredBound) && !/Continue-until bound/.test(ignoredBound), `a Claude or Codex card must ignore a Continue-until bound, got ${ignoredBound}`);

  // Grok: the point is 200,000, and its silent UserPromptSubmit call records the prompt.
  const grokAt = (context, sessionId, eventName = 'PostToolUse', opts = {}) => runHook(payloadFor({ transcript: writeTranscript(project, grokUsageLine(context), `${sessionId}-updates.jsonl`), sessionId, cwd: project, eventName }), { home, grok: true, ...opts });
  const grokFresh = message(grokAt(205_000, 'sess-point-grok-fresh'));
  expect(handOff.test(grokFresh) && !autonomousText.test(grokFresh), `a Grok card at 205,000 must ask for /compact past the price line, got ${grokFresh}`);
  expect(/compact this session before the 200,000-token price line/.test(message(grokAt(190_000, 'sess-point-grok-under'))), 'a Grok band-1 card under 200,000 must ask for a compact before the price line');
  expect(message(grokAt(206_000, 'sess-point-grok-fresh')) === '', 'the Grok handoff-point card must fire once per arm');
  grokAt(160_000, 'sess-grok-point');
  expect(grokAt(170_000, 'sess-grok-point', 'UserPromptSubmit').stdout === '', 'Grok UserPromptSubmit stays silent while it records the prompt');
  const grokPoint = message(grokAt(205_000, 'sess-grok-point'));
  expect(handOff.test(grokPoint) && !autonomousText.test(grokPoint), `Grok past 200,000 with a prompt between must get the prompted compact wording, got ${grokPoint}`);
  grokAt(171_000, 'sess-grok-point', 'UserPromptSubmit');
  const grokBand2 = message(grokAt(310_000, 'sess-grok-point'));
  expect(/compact again if the host summary dropped the snapshot/.test(grokBand2) && !autonomousText.test(grokBand2), `Grok band 2 right after the price-line card must ask for another compact, got ${grokBand2}`);
  // Grok autonomous: a band-1 card, then tool calls with no prompt until the point.
  grokAt(160_000, 'sess-grok-auto');
  const grokAuto = message(grokAt(205_000, 'sess-grok-auto'));
  expect(autonomousText.test(grokAuto) && /Do not write a handoff for the token count/.test(grokAuto), `Grok with no prompt since the last card must say to stop for /compact, got ${grokAuto}`);

  // Continue-until on Grok: the session record names the run folder, whose RUN_LOG.md holds the bound.
  const passedText = /The Continue-until bound in the run log has passed\./;

  bindRun('sess-until-tokens', '# RUN_LOG\n\n- Assessment: CONTINUE\n- Continue-until: 260,000 tokens\n');
  expect(grokAt(230_000, 'sess-until-tokens').stdout === '' && grokAt(255_000, 'sess-until-tokens').stdout === '', 'a tokens bound must hold the card below it');
  const tokensPassed = message(grokAt(265_000, 'sess-until-tokens'));
  expect(passedText.test(tokensPassed) && /price line/.test(tokensPassed), `past a tokens bound the card must fire again, got ${tokensPassed}`);
  expect(grokAt(270_000, 'sess-until-tokens').stdout === '', 'a passed bound fires once');
  expect(message(grokAt(310_000, 'sess-until-tokens')) !== '', 'after a passed bound the next band fires as usual');

  bindRun('sess-until-turns', '# RUN_LOG\n\nContinue-until: 2 turns\n');
  const turns = [grokAt(230_000, 'sess-until-turns'), grokAt(231_000, 'sess-until-turns'), grokAt(232_000, 'sess-until-turns')];
  expect(turns[0].stdout === '' && turns[1].stdout === '', 'a turns bound must hold the card for that many turns');
  expect(passedText.test(message(turns[2])), `the turn after a turns bound must fire, got ${JSON.stringify(turns[2].stdout)}`);

  for (const [label, log] of [
    ['a bound without a unit', 'Continue-until: 260000\n'],
    ['a zero bound', 'Continue-until: 0 turns\n'],
    ['a prose bound', 'Continue-until: after the refactor\n'],
    ['a malformed latest line after a valid one', 'Continue-until: 900000 tokens\nContinue-until: soon\n'],
  ]) {
    const sessionId = `sess-until-bad-${label.replace(/\W+/g, '-')}`;
    bindRun(sessionId, log);
    const bad = message(grokAt(230_000, sessionId));
    expect(handOff.test(bad) && !passedText.test(bad), `${label} must set no bound and fire as normal, got ${bad}`);
  }

  bindRun('sess-until-off', 'Continue-until: 100000 tokens\n');
  expect(grokAt(230_000, 'sess-until-off', 'PostToolUse', { switchValue: 'off' }).stdout === '', 'the off switch must silence a passed bound too');
  expect(grokAt(230_000, 'sess-point-off', 'PostToolUse', { switchValue: 'off' }).stdout === '', 'the off switch must silence the handoff-point card');

  rmSync(project, { recursive: true, force: true });
  cleanup();
  console.log('ok   Claude and Codex have no price line and ignore Continue-until; Grok asks for /compact at 200,000, autonomous Grok sessions are told to stop for it, and Continue-until holds the Grok card until its bound');
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
  const transcript = writeTranscript(dir, assistantLine(100_000), 'low.jsonl');
  const ignored = runHook(payloadFor({ transcript, sessionId: 'sess-grok-prompt' }), { home, grok: true });
  expect(ignored.status === 0 && ignored.stdout === '', `Grok UserPromptSubmit under 200,000 tokens must emit nothing, got ${ignored.status}/${JSON.stringify(ignored.stdout)}`);
  const price = writeTranscript(dir, grokUsageLine(210_000), 'price-updates.jsonl');
  const blocked = runHook(payloadFor({ transcript: price, sessionId: 'sess-grok-block', eventName: 'UserPromptSubmit' }), { home, grok: true });
  const blockBody = parseOut(blocked) || {};
  expect(blocked.status === 0 && blockBody.decision === 'block' && /Run \/compact/.test(blockBody.reason ?? '') && blockBody.hookSpecificOutput === undefined,
    `a typed prompt past 200,000 tokens must block, got ${JSON.stringify(blocked.stdout)}`);
  const compactOk = runHook(payloadFor({ transcript: price, sessionId: 'sess-grok-compact', eventName: 'UserPromptSubmit', extra: { prompt: 'please /compact now' } }), { home, grok: true });
  expect(compactOk.status === 0 && compactOk.stdout === '', `/compact past the price line must pass, got ${JSON.stringify(compactOk.stdout)}`);
  const unlocked = runHook(payloadFor({ transcript: price, sessionId: 'sess-grok-compact', eventName: 'UserPromptSubmit', extra: { prompt: 'continue the work' } }), { home, grok: true });
  const unlockedBody = parseOut(unlocked) || {};
  expect(unlocked.status === 0 && unlockedBody.decision !== 'block',
    `a prompt after /compact must pass while context stays in the assessed band, got ${JSON.stringify(unlocked.stdout)}`);
  const nextBand = writeTranscript(dir, grokUsageLine(360_000), 'next-band-updates.jsonl');
  const reblocked = runHook(payloadFor({ transcript: nextBand, sessionId: 'sess-grok-compact', eventName: 'UserPromptSubmit', extra: { prompt: 'continue the work' } }), { home, grok: true });
  const reblockedBody = parseOut(reblocked) || {};
  expect(reblocked.status === 0 && reblockedBody.decision === 'block',
    `the next ceiling band must block again, got ${JSON.stringify(reblocked.stdout)}`);
  const compactAgain = runHook(payloadFor({ transcript: nextBand, sessionId: 'sess-grok-compact', eventName: 'UserPromptSubmit', extra: { prompt: '/compact' } }), { home, grok: true });
  expect(compactAgain.status === 0 && compactAgain.stdout === '', `/compact in the next band must pass, got ${JSON.stringify(compactAgain.stdout)}`);
  const unlockedAgain = runHook(payloadFor({ transcript: nextBand, sessionId: 'sess-grok-compact', eventName: 'UserPromptSubmit', extra: { prompt: 'continue the work' } }), { home, grok: true });
  const unlockedAgainBody = parseOut(unlockedAgain) || {};
  expect(unlockedAgain.status === 0 && unlockedAgainBody.decision !== 'block',
    `a prompt after the second /compact must pass, got ${JSON.stringify(unlockedAgain.stdout)}`);
  const compactHook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'compact-snapshot.mjs');
  const hostEnv = { ...process.env, HOME: home, USERPROFILE: home, GROK_PLUGIN_ROOT: join(root, 'plugins', 'code-ops-suite') };
  delete hostEnv.CODE_OPS_HANDOFF_CARD;
  const hostCompact = spawnSync(process.execPath, [compactHook], {
    input: JSON.stringify({ hook_event_name: 'PreCompact', session_id: 'sess-grok-host-compact', transcript_path: price, cwd: 'C:/fixture-project' }),
    encoding: 'utf8',
    env: hostEnv,
  });
  const afterHost = runHook(payloadFor({ transcript: price, sessionId: 'sess-grok-host-compact', eventName: 'UserPromptSubmit', extra: { prompt: 'continue the work' } }), { home, grok: true });
  const afterHostBody = parseOut(afterHost) || {};
  expect(hostCompact.status === 0 && afterHost.status === 0 && afterHostBody.decision !== 'block',
    `a host PreCompact must unlock the current band, got compact ${hostCompact.status}/${hostCompact.stderr} prompt ${JSON.stringify(afterHost.stdout)}`);
  const staleAdmit = runHook(payloadFor({ transcript: nextBand, sessionId: 'sess-grok-host-compact', eventName: 'UserPromptSubmit', extra: { prompt: 'continue the work' } }), { home, grok: true });
  const staleAdmitBody = parseOut(staleAdmit) || {};
  expect(staleAdmit.status === 0 && staleAdmitBody.decision !== 'block',
    `a host compact must admit the next prompt when its token reading is still in a lower band, got ${JSON.stringify(staleAdmit.stdout)}`);
  const staleLocked = runHook(payloadFor({ transcript: nextBand, sessionId: 'sess-grok-host-compact', eventName: 'UserPromptSubmit', extra: { prompt: 'continue the work' } }), { home, grok: true });
  const staleLockedBody = parseOut(staleLocked) || {};
  expect(staleLocked.status === 0 && staleLockedBody.decision !== 'block',
    `the admitted prompt must record its own ceiling band, got ${JSON.stringify(staleLocked.stdout)}`);
  const unreadPath = join(dir, 'missing-updates.jsonl');
  const unreadCompact = spawnSync(process.execPath, [compactHook], {
    input: JSON.stringify({ hookEventName: 'pre_compact', sessionId: 'sess-grok-unread', transcriptPath: unreadPath, cwd: 'C:/fixture-project' }),
    encoding: 'utf8',
    env: hostEnv,
  });
  const unreadPrompt = runHook(payloadFor({ transcript: price, sessionId: 'sess-grok-unread', eventName: 'UserPromptSubmit', extra: { prompt: 'continue the work' } }), { home, grok: true });
  const unreadBody = parseOut(unreadPrompt) || {};
  expect(unreadCompact.status === 0 && unreadPrompt.status === 0 && unreadBody.decision !== 'block',
    `a compact with no readable context must still admit the next prompt, got compact ${unreadCompact.status} prompt ${JSON.stringify(unreadPrompt.stdout)}`);
  const unreadAgain = runHook(payloadFor({ transcript: price, sessionId: 'sess-grok-unread', eventName: 'UserPromptSubmit', extra: { prompt: 'continue the work' } }), { home, grok: true });
  const unreadAgainBody = parseOut(unreadAgain) || {};
  expect(unreadAgain.status === 0 && unreadAgainBody.decision !== 'block',
    `the prompt admitted after an unreadable compact must stay in that band, got ${JSON.stringify(unreadAgain.stdout)}`);

  const updates = writeTranscript(dir, grokUsageLine(160_000), 'updates.jsonl');
  const first = runHook(payloadFor({ transcript: updates, sessionId: 'sess-grok-tool', eventName: 'PostToolUse' }), { home, grok: true });
  const body = parseOut(first) || {};
  const note = body.hookSpecificOutput?.additionalContext || '';
  expect(first.status === 0 && body.systemMessage === undefined
    && body.hookSpecificOutput?.hookEventName === 'PostToolUse'
    && /160,000 tokens/.test(note) && /compact this session before the 200,000-token price line/.test(note),
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
  const runCard = (payload, { switchValue, home, extraEnv = {} } = {}) => {
    const env = { ...process.env };
    for (const key of ['CODE_OPS_HANDOFF_PICKUP', 'GROK_PLUGIN_ROOT', 'CLAUDECODE', 'CODE_OPS_OPERATOR_SHELL']) delete env[key];
    if (switchValue !== undefined) env.CODE_OPS_HANDOFF_PICKUP = switchValue;
    if (home) { env.HOME = home; env.USERPROFILE = home; }
    Object.assign(env, extraEnv);
    const input = payload === null ? '' : JSON.stringify(payload);
    return spawnSync('node', [routingCard], { input, encoding: 'utf8', env });
  };
  const PREFIX = 'handoffs awaiting resume (this session is new work unless the operator resumes one): ';
  const pickupLine = (r) => (r.stdout || '').split('\n').find((l) => l.startsWith(PREFIX)) || null;

  // A hub-shaped fixture: the vault layout rule puts `80 Runs/` inside a `<repo>-docs/` hub, and
  // both the hub folder and the dated run folder carry spaces in real repositories.
  const project = mkdtempSync(join(tmpdir(), 'handoff-pickup-'));
  const runsDir = join(project, 'fixture-docs', '80 Runs');
  const folder = join(runsDir, '2026-09-18 token spend audit');
  mkdirSync(folder, { recursive: true });
  const handoff = join(folder, 'HANDOFF.md');
  writeFileSync(handoff, '# HANDOFF\n');
  const startup = { hook_event_name: 'SessionStart', source: 'startup', cwd: project };

  // Passive: a legacy handoff (no Session line) is listed by its folder name, and the card never
  // tells a new session to resume it.
  const fresh = runCard(startup);
  const line = pickupLine(fresh);
  expect(fresh.status === 0 && line !== null, `a fresh session must list the pending handoff, got ${JSON.stringify(fresh.stdout)}`);
  if (line) {
    expect(line === `${PREFIX}2026-09-18 token spend audit -> fixture-docs/80 Runs/2026-09-18 token spend audit/HANDOFF.md`,
      `the pickup line must be the passive folder-named entry with a repo-relative forward-slash path, got ${line}`);
    expect(!/Before other work|resume mode|verify its claims/.test(fresh.stdout), `the card must carry no resume imperative, got ${fresh.stdout}`);
    expect(!/\/(?:code-ops-suite|privacy-opsec-suite|rigor|researcher):/.test(line), 'the pickup line must carry no Claude-only slash syntax');
    expect(fresh.stdout.split('\n').filter((l) => l.startsWith(PREFIX)).length === 1, 'the pickup line must print once');
  }
  // A v2 handoff is listed by the Session line under "## Program". A decoy elsewhere, a [FILL:
  // placeholder, an overlong name, or a control character falls back to the folder name.
  const namedLine = (value) => {
    writeFileSync(handoff, `# HANDOFF\n\nVerified-at: abc1234\r\n\r\n## Program\r\n\r\nProgram: p/PROGRAM.md\r\nPredecessor: none\r\nSession: ${value}\r\nHop: 2\r\n\r\n## Goal and state of play\n\nSession: decoy\n`);
    return pickupLine(runCard(startup)) || '';
  };
  expect(namedLine('Ledger2 AMM HO 2').startsWith(`${PREFIX}Ledger2 AMM HO 2 -> fixture-docs/80 Runs/2026-09-18 token spend audit/HANDOFF.md`),
    'a handoff with a Session line must be listed by that session name');
  for (const [label, value] of [['a [FILL: placeholder', '[FILL: session name]'], ['a name over 120 characters', 'x'.repeat(121)]]) {
    const got = namedLine(value);
    expect(got.startsWith(`${PREFIX}2026-09-18 token spend audit -> `) && !got.includes('decoy'), `${label} must fall back to the folder name, got ${got}`);
  }
  writeFileSync(handoff, '# HANDOFF\n');
  expect(pickupLine(runCard({ ...startup, source: 'clear' })) !== null, 'a cleared session must also get the pickup line');
  for (const source of ['resume', 'compact']) {
    expect(pickupLine(runCard({ ...startup, source })) === null, `source ${source} must not get the pickup line`);
  }
  for (const value of ['off', '0', 'false', 'OFF']) {
    expect(pickupLine(runCard(startup, { switchValue: value })) === null, `CODE_OPS_HANDOFF_PICKUP=${value} must silence the pickup line`);
  }
  expect(pickupLine(runCard(startup, { switchValue: 'on' })) !== null, 'a non-off switch value must leave the pickup on');

  // Newest first, a root-level `80 Runs/` is searched beside the hub's, and at most 3 are listed.
  const rootFolder = join(project, '80 Runs', '2026-09-19 newer run');
  mkdirSync(rootFolder, { recursive: true });
  writeFileSync(join(rootFolder, 'HANDOFF.md'), '# HANDOFF\n');
  const aged = Date.now() / 1000 - 3600;
  utimesSync(handoff, aged, aged);
  const two = pickupLine(runCard(startup)) || '';
  expect(two === `${PREFIX}2026-09-19 newer run -> 80 Runs/2026-09-19 newer run/HANDOFF.md; 2026-09-18 token spend audit -> fixture-docs/80 Runs/2026-09-18 token spend audit/HANDOFF.md`,
    `pending handoffs must be listed newest first, including one under a root-level 80 Runs/, got ${two}`);
  const extras = ['2026-09-20 a', '2026-09-21 b', '2026-09-22 c'].map((name, i) => {
    const dir = join(runsDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'HANDOFF.md'), '# HANDOFF\n');
    const t = Date.now() / 1000 + 60 * (i + 1);
    utimesSync(join(dir, 'HANDOFF.md'), t, t);
    return dir;
  });
  const three = pickupLine(runCard(startup)) || '';
  expect(three.split('; ').length === 3 && three.startsWith(`${PREFIX}2026-09-22 c -> `) && three.includes('2026-09-20 a -> ') && !three.includes('newer run'),
    `at most 3 pending handoffs, newest first, got ${three}`);
  for (const dir of extras) rmSync(dir, { recursive: true, force: true });

  // A consumed sibling retires the handoff whatever its body: the v2 JSON body and the legacy
  // single-timestamp body both count.
  writeFileSync(join(rootFolder, 'HANDOFF.consumed'), JSON.stringify({ v: 2, consumedAt: new Date().toISOString(), bySession: 's1', successorRun: 'x', name: 'n HO 1' }));
  expect(pickupLine(runCard(startup)) === `${PREFIX}2026-09-18 token spend audit -> fixture-docs/80 Runs/2026-09-18 token spend audit/HANDOFF.md`,
    'a v2 consumed sibling must retire that handoff and leave the older pending one');
  writeFileSync(join(folder, 'HANDOFF.consumed'), `${new Date().toISOString()}\n`);
  expect(pickupLine(runCard(startup)) === null, 'a legacy consumed sibling must retire its handoff too');

  // Older than 14 days is history, not pending.
  rmSync(join(folder, 'HANDOFF.consumed'));
  const old = Date.now() / 1000 - 15 * 86_400;
  utimesSync(handoff, old, old);
  expect(pickupLine(runCard(startup)) === null, 'a handoff older than 14 days must not be advertised');

  // Fail open: a cwd that does not exist still prints the routing card itself.
  const missing = runCard({ ...startup, cwd: join(project, 'no-such-dir') });
  expect(missing.status === 0 && /code-ops standard operating mode/.test(missing.stdout) && pickupLine(missing) === null,
    'an unreadable cwd must fail open with the card and no pickup line');

  // Session identity: the card names the first 8 characters of the payload session id, on every
  // source, and prints no identity line without one.
  const sid = 'a1b2c3d4-e5f6-7788-99aa-bbccddeeff00';
  expect(runCard({ ...startup, session_id: sid }).stdout.split('\n').includes('this session: a1b2c3d4'), 'a payload session_id must print this session: <first 8>');
  expect(!/this session:/.test(runCard(startup).stdout), 'no session_id must print no identity line');

  // Compaction: with a session record the card restates this session's name, run folder, and
  // consumed handoff; without one it keeps the generic restore line and adds the consumed rule.
  const home = mkdtempSync(join(tmpdir(), 'handoff-pickup-home-'));
  const compactRun = (payload) => runCard({ ...payload, source: 'compact' }, { home });
  const bareCompact = compactRun({ ...startup, session_id: sid });
  expect(/compaction resume: restore decisions, constraints, completed and open work/.test(bareCompact.stdout)
    && bareCompact.stdout.includes('a handoff resumed earlier in this session stays consumed; never resume it again')
    && !bareCompact.stdout.includes('compaction resume: this session is'),
  `compact without a record must keep the generic line and add the consumed rule, got ${JSON.stringify(bareCompact.stdout)}`);
  const recordDir = join(home, '.claude', 'code-ops', 'sessions', project.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(recordDir, { recursive: true });
  const recordFile = join(recordDir, `${sid.replace(/[^A-Za-z0-9]/g, '-')}.json`);
  const writeRecord = (fields) => writeFileSync(recordFile, JSON.stringify({ v: 1, sessionId: sid, name: 'Ledger2 AMM HO 2', runDir: 'fixture-docs/80 Runs/2026-09-24-ledger2-amm-ho2',
    resumed: 'fixture-docs/80 Runs/2026-09-23-ledger2-amm-ho1/HANDOFF.md', hop: 2, updatedAt: new Date().toISOString(), ...fields }));
  writeRecord({});
  const withRecord = compactRun({ ...startup, session_id: sid });
  expect(withRecord.stdout.includes('compaction resume: this session is Ledger2 AMM HO 2, run folder fixture-docs/80 Runs/2026-09-24-ledger2-amm-ho2; it already resumed fixture-docs/80 Runs/2026-09-23-ledger2-amm-ho1/HANDOFF.md and must not resume it or any earlier handoff again; continue from the state below')
    && !/reload .*TASKS\.md/.test(withRecord.stdout)
    && !withRecord.stdout.includes('stays consumed; never resume it again') && pickupLine(withRecord) === null,
  `compact with a record must name the session, run folder, and consumed handoff, got ${JSON.stringify(withRecord.stdout)}`);
  // The compact card lists the run folder's unchecked TASKS.md lines: ids and the first 80
  // characters, at most 12, none checked, none from outside the open state.
  expect(!withRecord.stdout.includes('open items in '), 'a run folder with no TASKS.md must add no open-item lines');
  const taskDir = join(project, 'fixture-docs', '80 Runs', '2026-09-24-ledger2-amm-ho2');
  mkdirSync(taskDir, { recursive: true });
  const tasks = ['# TASKS', '', '- [x] OI-1 done item · Owner: agent'];
  for (let n = 2; n <= 15; n += 1) tasks.push(`- [ ] OI-${n} open item number ${n} ${'x'.repeat(n === 2 ? 120 : 0)}· Owner: agent · Done when: check`);
  tasks.push('- [ ] OI-16 tab\u0001control · Owner: agent');
  writeFileSync(join(taskDir, 'TASKS.md'), tasks.join('\r\n'));
  const listed = compactRun({ ...startup, session_id: sid }).stdout.split('\n');
  const headAt = listed.findIndex((l) => l.startsWith('open items in fixture-docs/80 Runs/2026-09-24-ledger2-amm-ho2/TASKS.md'));
  const itemLines = headAt < 0 ? [] : listed.slice(headAt + 1).filter((l) => /^OI-/.test(l.trim()));
  expect(headAt >= 0 && listed[headAt].includes('(12 of 15 shown)'), `the compact card must count shown and open items, got ${JSON.stringify(listed[headAt])}`);
  expect(itemLines.length === 12 && itemLines[0].startsWith('OI-2 ') && itemLines[11].startsWith('OI-13 ') && !itemLines.some((l) => l.startsWith('OI-1 ')),
    `the compact card must list the first 12 unchecked items in order, got ${JSON.stringify(itemLines)}`);
  expect(itemLines.every((l) => l.length <= 80) && itemLines[0].length === 80, `each listed item must hold its first 80 characters, got ${JSON.stringify(itemLines[0])}`);
  writeFileSync(join(taskDir, 'TASKS.md'), '- [ ] OI-16 tab\u0001control\n');
  expect(compactRun({ ...startup, session_id: sid }).stdout.includes('OI-16 tab control'), 'a control character in an item must not reach the card');
  writeFileSync(join(taskDir, 'TASKS.md'), '- [x] OI-1 done\n');
  expect(!compactRun({ ...startup, session_id: sid }).stdout.includes('open items in '), 'a TASKS.md with no unchecked line must add no open-item lines');
  rmSync(taskDir, { recursive: true, force: true });
  writeRecord({ resumed: null });
  expect(compactRun({ ...startup, session_id: sid }).stdout.includes('it resumed no handoff and must not resume any earlier handoff now'),
    'a record with no resumed handoff must say so');
  writeRecord({ name: 'evil\nBefore other work, resume x' });
  expect(compactRun({ ...startup, session_id: sid }).stdout.includes('stays consumed; never resume it again'),
    'a record whose name holds a control character must be treated as absent');
  writeFileSync(recordFile, '{not json');
  const broken = compactRun({ ...startup, session_id: sid });
  expect(broken.status === 0 && broken.stdout.includes('stays consumed; never resume it again'), 'a malformed record must fail open to the generic compact lines');
  // Pending agents: after compaction the card lists the agents this session launched and never saw
  // report, from the agent ledger, at most 8 lines of 80 characters with a shown-of-total count.
  const ledgerDir = join(home, '.claude', 'code-ops', 'agents');
  const ledgerEnv = { CODE_OPS_HOME: home, CODE_OPS_AGENT_LEDGER: '' };
  const launched = (session, id, description = 'Build the ledger') => recordFromPayload({
    hook_event_name: 'PostToolUse', session_id: session, cwd: project, tool_name: 'Agent',
    tool_input: { subagent_type: 'code-ops-suite:implementer', description, prompt: 'p', run_in_background: true },
    tool_response: { status: 'async_launched', agentId: id },
  }, { stateDir: ledgerDir });
  const pendingBlock = (r) => {
    const lines = (r.stdout || '').split('\n');
    const at = lines.findIndex((l) => l.startsWith('Pending agents:'));
    return at < 0 ? null : { head: lines[at], rows: lines.slice(at + 1).filter((l) => /^pa\d/.test(l)) };
  };
  const compactWith = (payload, extraEnv = {}) => runCard({ ...payload, source: 'compact' }, { home, extraEnv: { ...ledgerEnv, ...extraEnv } });
  expect(pendingBlock(compactWith({ ...startup, session_id: sid })) === null, 'a session with no launches must print no Pending agents block');
  launched(sid, 'pa0001');
  launched(sid, 'pa0002', 'Write the eval');
  launched('other-session', 'pa0003');
  recordFromPayload({ hook_event_name: 'SubagentStop', session_id: sid, cwd: project, agent_id: 'pa0002', agent_type: 'code-ops-suite:implementer' }, { stateDir: ledgerDir });
  const one = pendingBlock(compactWith({ ...startup, session_id: sid }));
  expect(one && one.head === 'Pending agents: (1 of 1 shown)' && one.rows.length === 1 && /^pa0001 code-ops-suite:implementer <1m Build the ledger$/.test(one.rows[0]),
    `the compact card must list only this session's unreported agent, got ${JSON.stringify(one)}`);
  for (let n = 4; n <= 12; n += 1) launched(sid, `pa${String(n).padStart(4, '0')}`, `Long description ${'y'.repeat(70)}`);
  const capped = pendingBlock(compactWith({ ...startup, session_id: sid }));
  expect(capped && capped.head === 'Pending agents: (8 of 10 shown)' && capped.rows.length === 8 && capped.rows.every((l) => l.length <= 80) && capped.rows[0].length === 80,
    `the compact card must cap the block at 8 lines of 80 characters with the shown-of-total count, got ${JSON.stringify(capped)}`);
  for (const value of ['0', 'off', 'FALSE']) {
    expect(pendingBlock(compactWith({ ...startup, session_id: sid }, { CODE_OPS_AGENT_LEDGER: value })) === null, `CODE_OPS_AGENT_LEDGER=${value} must omit the Pending agents block`);
  }
  expect(pendingBlock(runCard({ ...startup, session_id: sid }, { home, extraEnv: ledgerEnv })) === null, 'a startup card must not print the Pending agents block');
  expect(pendingBlock(compactWith({ ...startup })) === null, 'a compact payload with no session id must print no Pending agents block');
  writeFileSync(join(ledgerDir, `${createHash('sha256').update(sid).digest('hex')}.jsonl`), '{not json\n');
  const torn = compactWith({ ...startup, session_id: sid });
  expect(torn.status === 0 && pendingBlock(torn) === null && /compaction resume:/.test(torn.stdout), 'a torn ledger file must fail open with no block');

  // Run-folder fallback: with no home session record, the run folder whose SESSION.json names the
  // payload session id in sessionId or hostSessionId supplies the open items; a miss adds nothing.
  rmSync(recordFile, { force: true });
  const runsHub = join(project, 'fixture-docs', '80 Runs');
  const seedRun = (name, session, tasks) => {
    const dir = join(runsHub, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SESSION.json'), JSON.stringify({ v: 1, hop: 0, predecessor: null, ...session }));
    if (tasks) writeFileSync(join(dir, 'TASKS.md'), tasks);
  };
  seedRun('2026-09-26-fallback-run', { sessionId: 'co-session-fallback', hostSessionId: sid }, '- [x] OI-1 done\n- [ ] OI-2 fallback open item\n- [ ] OI-3 second open item\n');
  seedRun('2026-09-27-other-run', { sessionId: 'co-session-other', hostSessionId: 'host-other' }, '- [ ] OI-9 belongs to another session\n');
  const FALLBACK_HEAD = 'open items in fixture-docs/80 Runs/2026-09-26-fallback-run/TASKS.md (2 of 2 shown):';
  const viaHost = compactWith({ ...startup, session_id: sid });
  const viaHostLines = viaHost.stdout.split('\n');
  const hostAt = viaHostLines.indexOf(FALLBACK_HEAD);
  expect(viaHost.status === 0 && hostAt >= 0 && viaHostLines[hostAt + 1] === 'OI-2 fallback open item' && viaHostLines[hostAt + 2] === 'OI-3 second open item'
    && !viaHost.stdout.includes('OI-9') && viaHost.stdout.includes('a handoff resumed earlier in this session stays consumed; never resume it again')
    && !viaHost.stdout.includes('compaction resume: this session is'),
  `a compaction with no record must list the open items of the run folder naming the host session id, got ${JSON.stringify(viaHost.stdout)}`);
  expect(compactWith({ ...startup, session_id: 'co-session-fallback' }).stdout.split('\n').includes(FALLBACK_HEAD), 'a run folder naming the payload id in sessionId must also match');
  const miss = compactWith({ ...startup, session_id: 'nobody-knows-this-session' });
  expect(miss.status === 0 && !miss.stdout.includes('open items in ') && miss.stdout.includes('a handoff resumed earlier in this session stays consumed; never resume it again'),
    `a session no run folder names must add no open-item lines, got ${JSON.stringify(miss.stdout)}`);
  writeFileSync(join(runsHub, '2026-09-26-fallback-run', 'SESSION.json'), '{not json');
  const brokenSession = compactWith({ ...startup, session_id: sid });
  expect(brokenSession.status === 0 && !brokenSession.stdout.includes('open items in '), 'a malformed SESSION.json must fail open with no open-item lines');
  writeFileSync(join(runsHub, '2026-09-26-fallback-run', 'SESSION.json'), JSON.stringify({ v: 1, sessionId: 'co-session-fallback', hostSessionId: sid }));
  // The run folder's dispatch rows still `dispatched` join the Pending agents block, so a host
  // without the ledger hook still lists them after compaction.
  const fallbackLedger = join(runsHub, '2026-09-26-fallback-run', 'DISPATCH_LEDGER.md');
  writeFileSync(fallbackLedger, ['| id | role | brief | expected artifact | status |', '| --- | --- | --- | --- | --- |',
    '| D-007 | implementer@model-x | Dispatch only | d7.md | dispatched |', '| D-008 | implementer@model-x | Done | d8.md | reported |', ''].join('\n'));
  const viaDispatch = compactWith({ ...startup, session_id: sid }).stdout.split('\n');
  const dispatchAt = viaDispatch.indexOf('Pending agents: (1 of 1 shown)');
  expect(dispatchAt >= 0 && /^D-007 implementer@model-x \S+ Dispatch only$/.test(viaDispatch[dispatchAt + 1]) && !viaDispatch.some((l) => l.startsWith('D-008 ')),
    `a compaction must list the run folder's dispatched rows under Pending agents, got ${JSON.stringify(viaDispatch)}`);
  rmSync(fallbackLedger, { force: true });
  writeRecord({});
  expect(!compactWith({ ...startup, session_id: sid }).stdout.includes('open items in fixture-docs/80 Runs/2026-09-26-fallback-run'),
    'a home session record must win over the run-folder fallback');
  rmSync(recordFile, { force: true });

  // Startup flag: workers an earlier session in this directory launched and never saw report are
  // listed under their own header, under the same 8-line, 80-character caps and the ledger switch.
  const LEFT = 'Left pending when an earlier session here ended:';
  const leftBlock = (r) => {
    const lines = (r.stdout || '').split('\n');
    const at = lines.findIndex((l) => l.startsWith(LEFT));
    return at < 0 ? null : { head: lines[at], rows: lines.slice(at + 1).filter((l) => /^p[ab]\d/.test(l)) };
  };
  const startupWith = (payload, extraEnv = {}) => runCard({ ...payload, source: 'startup' }, { home, extraEnv: { ...ledgerEnv, ...extraEnv } });
  launched('prior-session', 'pb0001', 'Prior build');
  // Only a session with a SessionEnd marker counts as ended. A live peer in the same directory
  // (pl0001, no marker) stays off the card until its own marker lands.
  launched('live-peer', 'pl0001', 'Peer build');
  const ended = (session) => markSessionEnded({ sessionId: session, cwd: project, stateDir: ledgerDir });
  const beforeMarkers = startupWith({ ...startup, session_id: sid });
  expect(leftBlock(beforeMarkers) === null && !beforeMarkers.stdout.includes('pb0001') && !beforeMarkers.stdout.includes('pa0003'),
    `a startup card must list no worker of a session that has not ended, got ${JSON.stringify(leftBlock(beforeMarkers))}`);
  ended('other-session');
  ended('prior-session');
  const left = leftBlock(startupWith({ ...startup, session_id: sid }));
  expect(left && left.head === `${LEFT} (2 of 2 shown)` && left.rows.length === 2 && left.rows.some((l) => /^pb0001 code-ops-suite:implementer <1m Prior build$/.test(l))
    && left.rows.some((l) => l.startsWith('pa0003 ')) && !left.rows.some((l) => l.startsWith('pa0001 ')),
  `a startup card must list the earlier sessions' pending workers and skip its own, got ${JSON.stringify(left)}`);
  expect(!startupWith({ ...startup, session_id: sid }).stdout.includes('pl0001'), 'a live peer session in the same directory must not be listed at startup');
  for (let n = 2; n <= 10; n += 1) launched('prior-session', `pb${String(n).padStart(4, '0')}`, `Long description ${'z'.repeat(70)}`);
  expect(leftBlock(startupWith({ ...startup, session_id: sid }))?.head === `${LEFT} (1 of 1 shown)`, 'a session that launched again after its marker reads as live until it ends again');
  ended('prior-session');
  const leftCapped = leftBlock(startupWith({ ...startup, session_id: sid }));
  expect(leftCapped && leftCapped.head === `${LEFT} (8 of 11 shown)` && leftCapped.rows.length === 8 && leftCapped.rows.every((l) => l.length <= 80),
    `the startup block must cap at 8 lines of 80 characters with the shown-of-total count, got ${JSON.stringify(leftCapped)}`);
  for (const value of ['0', 'off', 'FALSE']) {
    expect(leftBlock(startupWith({ ...startup, session_id: sid }, { CODE_OPS_AGENT_LEDGER: value })) === null, `CODE_OPS_AGENT_LEDGER=${value} must omit the startup block`);
  }
  expect(leftBlock(startupWith({ ...startup, session_id: sid }, { CODE_OPS_HANDOFF_PICKUP: 'off' })) !== null, 'the handoff pickup switch must not silence the startup block');
  expect(leftBlock(runCard({ ...startup, source: 'clear', session_id: sid }, { home, extraEnv: ledgerEnv })) === null
    && leftBlock(compactWith({ ...startup, session_id: sid })) === null, 'only a startup card carries the block');
  expect(leftBlock(startupWith({ ...startup, cwd: join(project, 'no-such-dir'), session_id: sid })) === null, 'workers launched elsewhere must not appear');
  const ledgerFile = join(ledgerDir, `${createHash('sha256').update('prior-session').digest('hex')}.jsonl`);
  // The capped prior session is dropped so the 8-line cap cannot hide the peer.
  rmSync(ledgerFile, { force: true });
  ended('live-peer');
  const peerEnded = startupWith({ ...startup, session_id: sid });
  expect(leftBlock(peerEnded)?.head === `${LEFT} (2 of 2 shown)` && /^pl0001 code-ops-suite:implementer <1m Peer build$/m.test(peerEnded.stdout),
    `the same peer must be listed once its SessionEnd marker lands, got ${JSON.stringify(peerEnded.stdout)}`);
  writeFileSync(ledgerFile, '{not json\n');
  const tornStartup = startupWith({ ...startup, session_id: sid });
  expect(tornStartup.status === 0 && /code-ops standard operating mode/.test(tornStartup.stdout), 'a torn ledger file must fail open on startup');
  rmSync(home, { recursive: true, force: true });

  // Operator shell (O1), the win32 quoting trap (O3), and the brief-template pointer (U1). The shell
  // line prints on every host but Claude Code; empty stdin, as build-opencode-dist.mjs runs the card,
  // prints neither platform line, so the baked dist stays the same on every build machine.
  const cardLines = (r) => (r.stdout || '').split(/\r?\n/);
  const shellLine = (r) => cardLines(r).find((l) => l.startsWith('operator shell: ')) ?? null;
  const TRAP = 'win32 shell trap: write a multi-line script to a file; never nest quotes in node -e inside bash';
  const derived = { win32: 'PowerShell', darwin: 'zsh' }[process.platform] ?? 'bash';
  const plain = runCard(startup);
  expect(shellLine(plain) === `operator shell: ${derived} (${process.platform})`, `a non-Claude host must get the derived shell line, got ${shellLine(plain)}`);
  expect(cardLines(plain).includes(TRAP) === (process.platform === 'win32'), `the quoting-trap line must print on win32 only, got ${JSON.stringify(plain.stdout)}`);
  expect(cardLines(plain).includes('brief template -> co brief <agent>'), 'the card must name co brief <agent>');
  expect(shellLine(runCard(startup, { extraEnv: { CODE_OPS_OPERATOR_SHELL: 'pwsh 7' } })) === `operator shell: pwsh 7 (${process.platform})`,
    'CODE_OPS_OPERATOR_SHELL must override the derived shell');
  for (const [label, value] of [['a control character', 'bash\ninjected line'], ['an overlong value', 'x'.repeat(41)], ['an empty value', '']]) {
    expect(shellLine(runCard(startup, { extraEnv: { CODE_OPS_OPERATOR_SHELL: value } })) === `operator shell: ${derived} (${process.platform})`,
      `an override with ${label} must fall back to the derived shell`);
  }
  const claude = runCard(startup, { extraEnv: { CLAUDECODE: '1' } });
  expect(shellLine(claude) === null, 'Claude Code must not get the shell line');
  expect(cardLines(claude).includes(TRAP) === (process.platform === 'win32'), 'Claude Code on win32 must still get the quoting-trap line');
  const baked = runCard(null, { extraEnv: { CODE_OPS_OPERATOR_SHELL: 'pwsh' } });
  expect(baked.status === 0 && /code-ops standard operating mode/.test(baked.stdout) && baked.stdout.includes('brief template -> co brief <agent>')
    && shellLine(baked) === null && !cardLines(baked).includes(TRAP), `empty stdin must print the card without platform lines, got ${JSON.stringify(baked.stdout)}`);

  rmSync(project, { recursive: true, force: true });
  console.log('ok   the routing card lists pending handoffs passively, names the session, restates the session record after compaction, and honors its switch');
  console.log('ok   the routing card names the operator shell off Claude Code, the win32 quoting trap, and co brief, and keeps empty-stdin output platform-free');
}

// ---------------------------------------------------------------- peer lines (routing card)

// One `peer:` line per live session of another program on the presence board, from the board
// records under CODE_OPS_HOME. A same-program session, an ended one, and an unreadable record add
// nothing; a predecessor and its successor give one line, named by the head; a fresh snapshot adds
// the reply-owed marker on the compact card only; at most 4 lines; CODE_OPS_PEER_GUARD off silences.
{
  const routingCard = join(root, 'plugins', 'code-ops-suite', 'hooks', 'routing-card.mjs');
  const home = mkdtempSync(join(tmpdir(), 'peer-lines-home-'));
  const repo = mkdtempSync(join(tmpdir(), 'peer-lines-repo-'));
  mkdirSync(join(repo, '.git'));
  const DOT = '·';
  const OWN_HOST = 'host-own-1';
  const runCard = (payload, extraEnv = {}) => {
    const env = { ...process.env };
    for (const key of ['CODE_OPS_HANDOFF_PICKUP', 'GROK_PLUGIN_ROOT', 'CLAUDECODE', 'CODE_OPS_OPERATOR_SHELL']) delete env[key];
    Object.assign(env, { HOME: home, USERPROFILE: home, CODE_OPS_HOME: home, CODE_OPS_PEER_GUARD: '', CODE_OPS_AGENT_LEDGER: '', ...extraEnv });
    return spawnSync('node', [routingCard], { input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: repo, session_id: OWN_HOST, ...payload }), encoding: 'utf8', env });
  };
  const peerLinesOf = (r) => (r.stdout || '').split(/\r?\n/).filter((l) => l.startsWith('peer: '));
  const line = (program, name, owed = false) => `peer: ${program} ${DOT} live session ${name}${owed ? ` ${DOT} reply owed` : ''}`;

  const runsRoot = join(repo, 'fixture-docs', '80 Runs');
  const relRun = (name) => `fixture-docs/80 Runs/${name}`;
  for (const program of ['alpha', 'beta', 'gamma', 'delta', 'theta', 'epsilon', 'zeta', 'eta']) {
    mkdirSync(join(repo, 'fixture-docs', 'programs', program), { recursive: true });
    writeFileSync(join(repo, 'fixture-docs', 'programs', program, 'PROGRAM.md'), '# PROGRAM\n');
  }
  const seedRun = (name, program, session) => {
    mkdirSync(join(runsRoot, name), { recursive: true });
    writeFileSync(join(runsRoot, name, 'SESSION.json'), JSON.stringify({ v: 1, hop: 0, predecessor: null, program: `fixture-docs/programs/${program}/PROGRAM.md`, ...session }));
    return relRun(name);
  };
  const onBoard = (sessionId, fields, ended = false) => updateBoard(repo, sessionId, (rec) => {
    Object.assign(rec, fields);
    if (ended) rec.ended = new Date().toISOString();
  }, home);
  const peer = (sessionId, program, name, extra = {}) => onBoard(sessionId, { name, runDir: seedRun(`run-${sessionId}`, program, { sessionId, name }), ...extra });

  const ownRun = seedRun('run-own', 'alpha', { sessionId: 'co-own', hostSessionId: OWN_HOST, name: 'Own HO 1' });
  onBoard('co-own', { name: 'Own HO 1', hostSessionId: OWN_HOST, runDir: ownRun });
  peer('co-beta', 'beta', 'Beta HO 3');
  peer('co-gamma', 'gamma', 'Gamma HO 1', { hostSessionId: 'host-gamma-1' });
  peer('co-alpha-peer', 'alpha', 'Alpha Peer');
  onBoard('co-iota', { name: 'Iota', runDir: seedRun('run-iota', 'delta', { sessionId: 'co-iota', name: 'Iota' }) }, true);
  const boardDir = join(home, '.claude', 'code-ops', 'board', repoIdentity(repo).key);
  writeFileSync(join(boardDir, 'broken.json'), '{not json');
  writeFileSync(join(boardDir, 'badrun.json'), JSON.stringify({ v: 1, sessionId: 'co-badrun', heartbeat: new Date().toISOString(), runDir: 7 }));
  writeFileSync(join(boardDir, 'norun.json'), JSON.stringify({ v: 1, sessionId: 'co-norun', heartbeat: new Date().toISOString(), runDir: 'fixture-docs/80 Runs/no-such-run' }));

  // Two live peers of other programs show with program and live session name; a same-program
  // peer, an ended one, and malformed records add nothing and never break the card.
  const startup = runCard({ source: 'startup' });
  const sorted = (lines) => [...lines].sort();
  expect(startup.status === 0 && /code-ops standard operating mode/.test(startup.stdout)
    && JSON.stringify(sorted(peerLinesOf(startup))) === JSON.stringify(sorted([line('beta', 'Beta HO 3'), line('gamma', 'Gamma HO 1')])),
  `the startup card must list the two other-program live peers and not the same-program, ended, or malformed ones, got ${JSON.stringify(startup.stdout)}`);
  expect(!startup.stdout.includes('Alpha Peer') && !startup.stdout.includes('Iota'), 'a same-program peer and an ended session must not be shown');
  // The clear source prints them too; resume prints none.
  expect(peerLinesOf(runCard({ source: 'clear' })).length === 2, 'a cleared session must also list the peers');
  expect(peerLinesOf(runCard({ source: 'resume' })).length === 0, 'a resumed session must list no peers');
  // With no program of its own, every other live program-bearing session shows, the same-program one too.
  const unknownOwn = runCard({ source: 'startup', session_id: 'nobody-knows-this-session' });
  expect(peerLinesOf(unknownOwn).length === 4 && peerLinesOf(unknownOwn).includes(line('alpha', 'Alpha Peer')) && peerLinesOf(unknownOwn).includes(line('alpha', 'Own HO 1')),
    `a session with no program must see every other live program-bearing session, got ${JSON.stringify(peerLinesOf(unknownOwn))}`);

  // A handed-off peer shows once, by its head: the predecessor's folder is consumed and names the
  // successor run, and both sessions are live on the board.
  const delta1 = seedRun('run-delta-1', 'delta', { sessionId: 'co-delta-1', name: 'Delta HO 1' });
  const delta2 = seedRun('run-delta-2', 'delta', { sessionId: 'co-delta-2', name: 'Delta HO 2' });
  writeFileSync(join(runsRoot, 'run-delta-1', 'HANDOFF.md'), '# HANDOFF\n');
  writeFileSync(join(runsRoot, 'run-delta-1', 'HANDOFF.consumed'), JSON.stringify({ v: 2, consumedAt: new Date().toISOString(), bySession: 'co-delta-2', successorRun: delta2, name: 'Delta HO 2' }));
  onBoard('co-delta-1', { name: 'Delta HO 1', runDir: delta1 });
  onBoard('co-delta-2', { name: 'Delta HO 2', runDir: delta2 });
  const handed = peerLinesOf(runCard({ source: 'startup' }));
  expect(handed.length === 3 && handed.filter((l) => l.startsWith('peer: delta ')).join() === line('delta', 'Delta HO 2'),
    `a handed-off peer must show once, by its head, got ${JSON.stringify(handed)}`);

  // The reply-owed marker comes from a fresh snapshot on the compact card, matched by name or by
  // session id, and only there.
  const transcript = join(repo, 'transcript.jsonl');
  const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
  writeFileSync(transcript, `${boundary}\n`);
  const snapshot = ['# Compact snapshot', `Written: ${new Date().toISOString()}`, `Session: ${OWN_HOST}`, 'Boundaries: 0', 'Status: complete',
    'Counts: operator words 0, running work 0, active items 0, reply-owed peers 2', '', '## Operator words (0, oldest first)', 'none', '',
    '## Peers (2 reply-owed, 0 quiet)', '- REPLY OWED Beta HO 3 co-beta 5m: need an answer', '- REPLY OWED - host-gamma-1 2m: and one here', ''].join('\n');
  writeFileSync(join(runsRoot, 'run-own', 'COMPACT_SNAPSHOT.md'), snapshot);
  const compactPayload = { source: 'compact', transcript_path: transcript };
  const compact = runCard(compactPayload);
  expect(compact.stdout.includes('Snapshot fresh (') && peerLinesOf(compact).includes(line('beta', 'Beta HO 3', true)) && peerLinesOf(compact).includes(line('gamma', 'Gamma HO 1', true))
    && peerLinesOf(compact).includes(line('delta', 'Delta HO 2')),
  `the compact card on a fresh snapshot must mark the reply-owed peers by name and by session id and no other, got ${JSON.stringify(peerLinesOf(compact))}`);
  const startupWithSnapshot = peerLinesOf(runCard({ source: 'startup', transcript_path: transcript }));
  expect(startupWithSnapshot.length === 3 && !startupWithSnapshot.some((l) => l.includes('reply owed')), `the startup card must carry no reply-owed marker, got ${JSON.stringify(startupWithSnapshot)}`);
  writeFileSync(transcript, `${boundary}\n${boundary}\n`);
  const stale = runCard(compactPayload);
  expect(stale.stdout.includes('Snapshot STALE') && peerLinesOf(stale).length === 3 && !peerLinesOf(stale).some((l) => l.includes('reply owed')),
    `a stale snapshot must add the peer lines but no reply-owed marker, got ${JSON.stringify(peerLinesOf(stale))}`);

  // The program is read from the head's handoff when no SESSION.json names it; the board name stands.
  const thetaDir = join(runsRoot, 'run-theta');
  mkdirSync(thetaDir, { recursive: true });
  writeFileSync(join(thetaDir, 'HANDOFF.md'), '# HANDOFF\n\n## Program\n\nProgram: fixture-docs/programs/theta/PROGRAM.md\nPredecessor: none\nSession: Theta HO 1\nHop: 0\n');
  onBoard('co-theta', { name: 'Theta Board Name', runDir: relRun('run-theta') });
  expect(peerLinesOf(runCard({ source: 'startup' })).includes(line('theta', 'Theta Board Name')), 'with no SESSION.json the board name must stand for the head');

  // CODE_OPS_PEER_GUARD off values silence the lines on both cards; any other value leaves them on.
  for (const value of ['off', '0', 'false', 'OFF']) {
    expect(peerLinesOf(runCard({ source: 'startup' }, { CODE_OPS_PEER_GUARD: value })).length === 0 && peerLinesOf(runCard(compactPayload, { CODE_OPS_PEER_GUARD: value })).length === 0,
      `CODE_OPS_PEER_GUARD=${value} must show no peer lines`);
  }
  expect(peerLinesOf(runCard({ source: 'startup' }, { CODE_OPS_PEER_GUARD: 'on' })).length === 4, 'a non-off CODE_OPS_PEER_GUARD value must leave the lines on');

  // The 4-line cap: more live peers than the cap show exactly 4 lines, each within 160 characters.
  for (const program of ['epsilon', 'zeta', 'eta']) peer(`co-${program}`, program, `${program} ${'long'.repeat(40)}`);
  const capped = runCard({ source: 'startup' });
  expect(capped.status === 0 && peerLinesOf(capped).length === 4 && peerLinesOf(capped).every((l) => l.length <= 160),
    `the card must cap the peer lines at 4 of at most 160 characters, got ${JSON.stringify(peerLinesOf(capped))}`);
  expect(peerLinesOf(runCard(compactPayload)).length === 4, 'the compact card must cap the peer lines at 4');

  // Fail open: a board path that is a file is no board at all, and the card still prints.
  rmSync(boardDir, { recursive: true, force: true });
  writeFileSync(boardDir, 'not a directory');
  const noBoard = runCard({ source: 'startup' });
  expect(noBoard.status === 0 && /code-ops standard operating mode/.test(noBoard.stdout) && peerLinesOf(noBoard).length === 0, 'an unreadable board must fail open with the card and no peer lines');

  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
  console.log('ok   the routing card lists live peers of other programs once by head, marks reply-owed peers from a fresh snapshot, caps at 4 lines, and honors CODE_OPS_PEER_GUARD');
}

// ---------------------------------------------------------------- history read notice

// A throwaway repository whose hub carries a state.json: a superseded decision and the in-force
// decision that replaces it, an amended decision with its amendment, and an evidence record.
function noticeRepo({ state } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'notice-repo-'));
  mkdirSync(join(repo, '.git'));
  const system = join(repo, 'hub', '98 System');
  mkdirSync(join(system, 'Records'), { recursive: true });
  writeFileSync(join(system, 'DOCS_MANIFEST.json'), JSON.stringify({ version: 3, hub: 'hub', legacyPaths: [] }));
  const record = (id, path, kind, status, key) => ({ id, collection: 'main', path, kind, ...(key ? { key } : {}), status, pendingSeal: null });
  writeFileSync(join(system, 'Records', 'state.json'), state ?? JSON.stringify({ version: 1, records: [
    record('REC-OLD', 'hub/20 Decisions/Records/old.md', 'decision', 'superseded', 'deploy/window'),
    record('REC-NEW', 'hub/20 Decisions/Records/new.md', 'decision', 'in-force', 'deploy/window'),
    record('REC-AMD', 'hub/20 Decisions/Records/amended.md', 'decision', 'amended', 'api/versioning'),
    record('REC-AMDA', 'hub/20 Decisions/Records/amendment.md', 'amendment', 'in-force', 'api/versioning'),
    record('REC-EV', 'hub/99 Archive/evidence.md', 'evidence', 'historical'),
  ] }, null, 2));
  return { repo, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

{
  const { home, cleanup } = fakeHome();
  const fixture = noticeRepo();
  const post = (toolName, toolInput, extra = {}) => JSON.stringify({
    hook_event_name: 'PostToolUse', session_id: 'sess-notice', cwd: fixture.repo, tool_name: toolName, tool_input: toolInput,
    tool_response: { type: 'text' }, ...extra,
  });
  const contextOf = (r) => parseOut(r)?.hookSpecificOutput?.additionalContext ?? null;
  const OLD = 'hub/20 Decisions/Records/old.md';

  const read = runHook(post('Read', { file_path: OLD }), { home });
  const readOut = parseOut(read);
  expect(read.status === 0 && readOut?.hookSpecificOutput?.hookEventName === 'PostToolUse' && readOut.systemMessage === undefined
    && contextOf(read)?.includes('REC-OLD') && contextOf(read).includes('superseded') && contextOf(read).includes('Replaced by REC-NEW')
    && contextOf(read).includes('hub/20 Decisions/REGISTER.md') && !contextOf(read).includes('\n'),
  `a Read of a superseded record must add one notice line naming status, replacement, and register, got ${JSON.stringify(read.stdout)}`);
  const absolute = runHook(post('Read', { file_path: join(fixture.repo, 'hub', '20 Decisions', 'Records', 'old.md') }), { home });
  expect(contextOf(absolute)?.includes('REC-OLD'), `an absolute Read path must match, got ${JSON.stringify(absolute.stdout)}`);
  const amended = runHook(post('Read', { file_path: 'hub/20 Decisions/Records/amended.md' }), { home });
  expect(contextOf(amended)?.includes('REC-AMD') && contextOf(amended).includes('Amended by REC-AMDA'),
    `an amended record must name its amendment, got ${JSON.stringify(amended.stdout)}`);
  console.log('ok   a Read of a superseded or amended record adds one line naming status, replacing record, and register');

  const grep = runHook(post('Grep', { pattern: 'window', path: OLD }), { home });
  expect(contextOf(grep)?.includes('REC-OLD'), `a Grep with a record path must add the notice, got ${JSON.stringify(grep.stdout)}`);
  const grepNoPath = runHook(post('Grep', { pattern: 'window' }), { home });
  expect(grepNoPath.status === 0 && grepNoPath.stdout === '', `a Grep with no path gets nothing, got ${JSON.stringify(grepNoPath.stdout)}`);
  const bash = runHook(post('Bash', { command: `cat "${OLD}" | head -20` }), { home });
  expect(contextOf(bash)?.includes('REC-OLD'), `a shell command naming a record path must add the notice, got ${JSON.stringify(bash.stdout)}`);
  const bashPlain = runHook(post('Bash', { command: 'git status --short' }), { home });
  expect(bashPlain.status === 0 && bashPlain.stdout === '', `a shell command with no record path gets nothing, got ${JSON.stringify(bashPlain.stdout)}`);
  const codex = runHook(post('exec_command', { cmd: `sed -n 1,20p '${OLD}'` }), { home });
  expect(contextOf(codex)?.includes('REC-OLD'), `a Codex exec_command must add the notice, got ${JSON.stringify(codex.stdout)}`);
  const grokRead = runHook(JSON.stringify({ hookEventName: 'post_tool_use', hook_event_name: 'PostToolUse', sessionId: 'sess-notice', cwd: fixture.repo,
    toolName: 'read_file', toolInput: { path: OLD }, toolOutput: 'x' }), { home, grok: true });
  expect(contextOf(grokRead)?.includes('REC-OLD'), `a Grok read_file payload with a path key must add the notice, got ${JSON.stringify(grokRead.stdout)}`);
  const grokShell = runHook(JSON.stringify({ hookEventName: 'post_tool_use', hook_event_name: 'PostToolUse', sessionId: 'sess-notice', cwd: fixture.repo,
    toolName: 'run_terminal_command', toolInput: { command: `cat "${OLD}"` } }), { home, grok: true });
  expect(contextOf(grokShell)?.includes('REC-OLD'), `a Grok run_terminal_command payload must add the notice, got ${JSON.stringify(grokShell.stdout)}`);
  console.log('ok   Grep, Bash, Codex exec_command, and Grok read_file and run_terminal_command payloads add the notice; a call with no record path gets nothing');

  for (const [name, input] of [
    ['an in-force record', { file_path: 'hub/20 Decisions/Records/new.md' }],
    ['an evidence record that is historical by default', { file_path: 'hub/99 Archive/evidence.md' }],
    ['an unlisted file', { file_path: 'hub/20 Decisions/Records/unlisted.md' }],
    ['a file outside the repository', { file_path: join(tmpdir(), 'hub', '20 Decisions', 'Records', 'old.md') }],
  ]) {
    const r = runHook(post('Read', input), { home });
    expect(r.status === 0 && r.stdout === '', `${name} must get no notice, got ${JSON.stringify(r.stdout)}`);
  }
  const edit = runHook(post('Edit', { file_path: OLD, old_string: 'a', new_string: 'b' }), { home });
  expect(edit.status === 0 && edit.stdout === '', `an Edit of a record gets no notice, got ${JSON.stringify(edit.stdout)}`);
  console.log('ok   an in-force, evidence, unlisted, or outside path and a non-read tool get no notice');

  for (const value of ['0', 'off', 'False']) {
    const r = runHook(post('Read', { file_path: OLD }), { home, env: { CODE_OPS_READ_NOTICE: value } });
    expect(r.status === 0 && r.stdout === '', `CODE_OPS_READ_NOTICE=${value} must silence the notice, got ${JSON.stringify(r.stdout)}`);
  }
  const independent = runHook(post('Read', { file_path: OLD }), { home, switchValue: 'off', env: { CODE_OPS_FEED: 'off' } });
  expect(contextOf(independent)?.includes('REC-OLD'), `the card and feed switches must not silence the notice, got ${JSON.stringify(independent.stdout)}`);
  const promptEvent = runHook(post('Read', { file_path: OLD }, { hook_event_name: 'UserPromptSubmit' }), { home });
  expect(!contextOf(promptEvent)?.includes('REC-OLD'), `a UserPromptSubmit call must carry no notice, got ${JSON.stringify(promptEvent.stdout)}`);
  console.log('ok   CODE_OPS_READ_NOTICE off values silence the notice, the card and feed switches leave it on, and only PostToolUse carries it');
  fixture.cleanup();

  for (const [name, options] of [
    ['a corrupt state.json', { state: '{not json "superseded"' }],
    ['an empty state.json', { state: '' }],
    ['a state.json whose records are not a list', { state: '{"records": {"status": "superseded"}}' }],
    ['a state.json with only in-force records', { state: JSON.stringify({ version: 1, records: [{ id: 'REC-X', path: 'hub/x.md', kind: 'decision', status: 'in-force' }] }) }],
  ]) {
    const broken = noticeRepo(options);
    const r = runHook(JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'sess-notice', cwd: broken.repo, tool_name: 'Read',
      tool_input: { file_path: 'hub/20 Decisions/Records/old.md' } }), { home });
    expect(r.status === 0 && r.stdout === '', `${name} must fail open with no output, got ${r.status}/${JSON.stringify(r.stdout)}`);
    broken.cleanup();
  }
  const bare = mkdtempSync(join(tmpdir(), 'notice-bare-'));
  mkdirSync(join(bare, '.git'));
  const noHub = runHook(JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'sess-notice', cwd: bare, tool_name: 'Read', tool_input: { file_path: 'a.md' } }), { home });
  expect(noHub.status === 0 && noHub.stdout === '', `a repository with no hub gets nothing, got ${JSON.stringify(noHub.stdout)}`);
  rmSync(bare, { recursive: true, force: true });
  console.log('ok   a corrupt, empty, malformed, or in-force-only state.json and a missing hub fail open');
  cleanup();
}

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\nhandoff-card eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nhandoff-card eval passed');
