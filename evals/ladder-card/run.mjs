#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/ladder-card.mjs, the opt-in SubagentStart
// card. It pins the contract the hook promises:
//   - on by default: without CODE_OPS_LADDER_CARD an implementer type gets the card, and off, 0,
//     or false silences it for every payload;
//   - on, an implementer-class type (general-purpose, mech, claude, a custom name, and a
//     plugin-qualified implementer) gets exactly one JSON line whose additionalContext is the
//     card, at most ten lines, under 1200 characters, with hookEventName SubagentStart and no
//     permissionDecision;
//   - on, every read-only type (bare or plugin-qualified, and any name ending in explorer or
//     reviewer) gets nothing;
//   - fail open: bad JSON, a payload with no type, a non-string type, and another event name
//     all exit 0 with no output;
//   - the card names the ordered objective, the six rungs, the hot-path rule, and the marker.
//
//   node evals/ladder-card/run.mjs

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const hook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'ladder-card.mjs');
const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };

function runHook(input, sw) {
  const env = { ...process.env };
  delete env.CODE_OPS_LADDER_CARD;
  if (sw !== undefined) env.CODE_OPS_LADDER_CARD = sw;
  return spawnSync('node', [hook], { input, encoding: 'utf8', env });
}
const payload = (type, extra = {}) => JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'a1', agent_type: type, ...extra });

const IMPLEMENTERS = ['general-purpose', 'mech', 'claude', 'implementer', 'my-team:builder', 'code-ops-suite:fixer'];
const READ_ONLY = ['explorer', 'reviewer', 'tracer', 'verifier', 'gatherer', 'claim-checker', 'privacy-reviewer', 'mech-review', 'Explore', 'Plan',
  'code-ops-suite:explorer', 'code-ops-suite:reviewer', 'rigor:tracer', 'rigor:verifier', 'researcher:gatherer', 'researcher:claim-checker',
  'privacy-opsec-suite:privacy-reviewer', 'privacy-opsec-suite:explorer', 'acme:schema-explorer', 'acme:diff-reviewer'];

// ---------------------------------------------------------------- the off switch
for (const t of [...IMPLEMENTERS, ...READ_ONLY]) {
  for (const sw of ['off', '0', 'false', 'OFF']) {
    const r = runHook(payload(t), sw);
    expect(r.status === 0 && r.stdout === '', `${t} under ${sw}: must get nothing, got ${r.status}/${JSON.stringify(r.stdout)}`);
  }
}
for (const t of IMPLEMENTERS) {
  const r = runHook(payload(t));
  expect(r.status === 0 && /additionalContext/.test(r.stdout), `on by default: ${t} with no switch must get the card, got ${r.status}/${JSON.stringify(r.stdout.slice(0, 60))}`);
}
console.log(`ok   off, 0, and false silence the card for ${IMPLEMENTERS.length + READ_ONLY.length} types; unset leaves it on`);

// ---------------------------------------------------------------- on, implementer-class
let card = null;
for (const sw of ['1', 'on', 'true', 'yes', '']) {
  for (const t of IMPLEMENTERS) {
    const r = runHook(payload(t), sw);
    expect(r.status === 0 && r.stdout.trim().split('\n').length === 1, `${t} under ${sw}: one JSON line, got ${r.status}/${JSON.stringify(r.stdout)}`);
    let out;
    try { out = JSON.parse(r.stdout).hookSpecificOutput; } catch { fails.push(`${t}: output must parse as JSON`); continue; }
    expect(out.hookEventName === 'SubagentStart', `${t}: hookEventName must be SubagentStart`);
    expect(!Object.hasOwn(out, 'permissionDecision') && !Object.hasOwn(out, 'permissionDecisionReason'), `${t}: no permission decision belongs on a SubagentStart output`);
    expect(typeof out.additionalContext === 'string' && out.additionalContext.length > 0, `${t}: additionalContext must be the card`);
    if (card === null) card = out.additionalContext;
    else expect(out.additionalContext === card, `${t}: the card must be the same text for every implementer type`);
  }
}
const lines = (card ?? '').split('\n');
expect(lines.length <= 10, `the card is at most ten lines, got ${lines.length}`);
expect((card ?? '').length < 1200, `the card stays under 1200 characters, got ${(card ?? '').length}`);
expect(/correctness and the safety floor, module boundaries, measured performance on hot paths, readability, then size/.test(card ?? ''), 'the card states the ordered objective');
for (const rung of ['Does it need to exist', 'Does it exist here', 'standard library', 'owning module', 'Extract only on evidence', 'minimum edge-case-correct']) {
  expect((card ?? '').includes(rung), `the card carries the rung "${rung}"`);
}
expect(/hot path/.test(card ?? '') && /deferred\(<ceiling>, <upgrade path>\)/.test(card ?? ''), 'the card carries the hot-path rule and the marker');
console.log(`ok   implementer-class types get the ${lines.length}-line card (${(card ?? '').length} chars) under five non-off values`);

// ---------------------------------------------------------------- on, read-only
for (const t of READ_ONLY) {
  const r = runHook(payload(t), 'on');
  expect(r.status === 0 && r.stdout === '', `read-only ${t} must get nothing, got ${r.status}/${JSON.stringify(r.stdout)}`);
}
console.log(`ok   ${READ_ONLY.length} read-only types get nothing with the switch on`);

// ---------------------------------------------------------------- fail open
const cases = [
  ['bad JSON', '{not json'],
  ['no type', JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'a1' })],
  ['non-string type', JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 7 })],
  ['blank type', payload('   ')],
  ['another event', JSON.stringify({ hook_event_name: 'PreToolUse', agent_type: 'general-purpose' })],
  ['empty input', ''],
];
for (const [name, input] of cases) {
  const r = runHook(input, 'on');
  expect(r.status === 0 && r.stdout === '', `${name}: must exit 0 with no output, got ${r.status}/${JSON.stringify(r.stdout)}`);
}
const bom = runHook(`\uFEFF${payload('general-purpose')}`, 'on');
expect(bom.status === 0 && /additionalContext/.test(bom.stdout), 'a BOM-prefixed payload is still read');
console.log(`ok   ${cases.length} malformed payloads fail open; a BOM-prefixed payload is read`);

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\nladder-card eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nladder-card eval passed');
