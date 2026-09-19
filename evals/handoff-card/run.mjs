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
//   - Grok's passive-hook adapter emits nothing, matching routing-card.mjs and ladder-card.mjs;
//   - band 1 advises a handoff at the next boundary, and band 2 and above escalates to "now".
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
import { handoffMarkerPath, handoffPeakBand } from '../../scripts/transcript-lib.mjs';

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

// ---------------------------------------------------------------- band escalation

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'handoff-band-'));
  const first = runHook(payloadFor({ transcript: writeTranscript(dir, assistantLine(160_000), 'b1.jsonl'), sessionId: 'sess-band-1' }), { home });
  const second = runHook(payloadFor({ transcript: writeTranscript(dir, assistantLine(330_000), 'b2.jsonl'), sessionId: 'sess-band-2' }), { home });
  const m1 = (parseOut(first) || {}).systemMessage || '';
  const m2 = (parseOut(second) || {}).systemMessage || '';
  expect(/next workstream boundary/.test(m1) && /resume line/.test(m1), `band 1 must advise the next boundary and name the resume line, got ${m1}`);
  expect(/handoff now/.test(m2) && /no new workstream/.test(m2), `band 2 must ask for the handoff now and forbid a new workstream, got ${m2}`);
  expect(m1 !== m2 && m2.includes('/code-ops-suite:handoff'), 'band 2 must escalate past band 1 and still name the command');
  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   band 1 advises the next boundary; band 2 escalates to writing the handoff now');
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
  expect(pickupLine(runCard({ ...startup, source: 'clear' })) !== null, 'a cleared session must also get the pickup line');
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
