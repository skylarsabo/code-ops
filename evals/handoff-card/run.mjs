#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/handoff-card.mjs, the opt-in
// UserPromptSubmit context-size nudge. It pins the contract the hook promises:
//   - on by default: without CODE_OPS_HANDOFF_CARD a crossing transcript prints once, and off,
//     0, or false silences it for the same fixture;
//   - below 200,000 tokens of resident context (input + cache-read + cache-creation on the last
//     assistant usage record), the hook is silent and writes no marker;
//   - crossing 200,000 prints exactly one JSON line, naming the approximate token count and
//     pointing at /code-ops-suite:handoff, on both systemMessage and hookSpecificOutput's
//     additionalContext, with hookEventName UserPromptSubmit and no permissionDecision;
//   - a second prompt in the same 200k band stays silent;
//   - crossing into the next 200k band prints again;
//   - falling back under 200,000 re-arms: the next crossing prints again;
//   - fail open: bad JSON, no hook_event_name match, a missing transcript file, a missing
//     session_id, and empty stdin all exit 0 with no output;
//   - Grok's passive-hook adapter emits nothing, matching routing-card.mjs and ladder-card.mjs.
//
//   node evals/handoff-card/run.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

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

function writeTranscript(dir, content, name = 'transcript.jsonl') {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function payloadFor({ transcript, sessionId = 'sess-1', cwd = 'C:/fixture-project', eventName = 'UserPromptSubmit', extra = {} }) {
  return JSON.stringify({ hook_event_name: eventName, session_id: sessionId, transcript_path: transcript, cwd, prompt: 'continue', ...extra });
}

function runHook(input, { home, switchValue, grok = false } = {}) {
  const env = { ...process.env };
  delete env.CODE_OPS_HANDOFF_CARD;
  delete env.GROK_PLUGIN_ROOT;
  if (switchValue !== undefined) env.CODE_OPS_HANDOFF_CARD = switchValue;
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

  // Below 200,000: silent, no output.
  let transcript = writeTranscript(dir, assistantLine(150_000));
  let r = runHook(payloadFor({ transcript, sessionId }), { home });
  expect(r.status === 0 && r.stdout === '', `below threshold must be silent, got ${r.status}/${JSON.stringify(r.stdout)}`);

  // Crossing 200,000 (band 1): prints once.
  transcript = writeTranscript(dir, assistantLine(250_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  let out = parseOut(r);
  expect(r.status === 0 && out && out !== 'unparsable', `crossing must print one parsable JSON line, got ${r.status}/${JSON.stringify(r.stdout)}`);
  if (out && out !== 'unparsable') {
    expect(typeof out.systemMessage === 'string' && out.systemMessage.includes('/code-ops-suite:handoff'), 'systemMessage must name /code-ops-suite:handoff');
    expect(out.systemMessage.includes('251,000') || out.systemMessage.includes('250,000'), `systemMessage must name the approximate token count, got ${out.systemMessage}`);
    expect(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(out.systemMessage), 'the message must carry no emoji');
    const hso = out.hookSpecificOutput || {};
    expect(hso.hookEventName === 'UserPromptSubmit', `hookEventName must be UserPromptSubmit, got ${hso.hookEventName}`);
    expect(hso.additionalContext === out.systemMessage, 'additionalContext must match systemMessage');
    expect(!Object.hasOwn(hso, 'permissionDecision'), 'a UserPromptSubmit nudge must never carry a permissionDecision');
  }

  // Same band, a later prompt: silent.
  transcript = writeTranscript(dir, assistantLine(255_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  expect(r.status === 0 && r.stdout === '', `same band must stay silent, got ${r.status}/${JSON.stringify(r.stdout)}`);

  // Next band (2): prints again.
  transcript = writeTranscript(dir, assistantLine(450_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  out = parseOut(r);
  expect(r.status === 0 && out && out !== 'unparsable', `the next band must print again, got ${r.status}/${JSON.stringify(r.stdout)}`);

  // Falls back under 200,000: silent, and re-arms.
  transcript = writeTranscript(dir, assistantLine(50_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  expect(r.status === 0 && r.stdout === '', `dropping under the threshold must stay silent, got ${r.status}/${JSON.stringify(r.stdout)}`);

  // Crossing 200,000 again after the drop: prints once more.
  transcript = writeTranscript(dir, assistantLine(210_000));
  r = runHook(payloadFor({ transcript, sessionId }), { home });
  out = parseOut(r);
  expect(r.status === 0 && out && out !== 'unparsable', `re-armed crossing must print again, got ${r.status}/${JSON.stringify(r.stdout)}`);

  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   crossing prints once, the same band stays silent, the next band prints, and dropping below 200,000 re-arms it');
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

// ---------------------------------------------------------------- Grok passive adapter

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-grok-'));
  const transcript = writeTranscript(dir, assistantLine(300_000));
  const r = runHook(payloadFor({ transcript, sessionId: 'sess-grok' }), { home, grok: true });
  expect(r.status === 0 && r.stdout === '', `Grok passive-hook adapter must emit nothing, got ${r.status}/${JSON.stringify(r.stdout)}`);
  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   Grok passive-hook adapter emits no card, matching routing-card.mjs and ladder-card.mjs');
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

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\nhandoff-card eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nhandoff-card eval passed');
