#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/subagent-report.mjs, the advisory
// SubagentStop return validator. It pins the contract the hook promises:
//   - pass: a report whose first line starts with a declared verdict and fits the cap gets nothing;
//   - wrong verdict: a first line without a declared token gets one systemMessage that names the
//     declared tokens, and a token prefix such as NOT-CONFIRMED does not satisfy CONFIRMED;
//   - over cap: a report past the agent's `Report cap` words gets one systemMessage with the count;
//   - transcript fallback: with no last_assistant_message, the last assistant text in
//     agent_transcript_path is checked;
//   - unknown agent: a bare, custom, traversal, or missing type gets nothing;
//   - malformed payload: bad JSON, an empty input, a non-object, and another event exit 0 silently;
//   - never blocks: no output carries decision, continue, or additionalContext, and every run
//     exits 0; the off switch and the Grok adapter silence it.
//
//   node evals/subagent-report/run.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const suite = join(root, 'plugins', 'code-ops-suite');
const hook = join(suite, 'hooks', 'subagent-report.mjs');
const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };

function runHook(input, extraEnv = {}) {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: suite };
  delete env.GROK_PLUGIN_ROOT;
  delete env.CODE_OPS_SUBAGENT_REPORT;
  Object.assign(env, extraEnv);
  return spawnSync('node', [hook], { input, encoding: 'utf8', env });
}
const payload = (type, message, extra = {}) => JSON.stringify({
  hook_event_name: 'SubagentStop', session_id: 's1', stop_hook_active: false, agent_id: 'a1', agent_type: type,
  ...(message === undefined ? {} : { last_assistant_message: message }), ...extra,
});
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
function note(r, label) {
  expect(r.status === 0, `${label}: must exit 0, got ${r.status}`);
  let out;
  try { out = JSON.parse(r.stdout); } catch { fails.push(`${label}: expected one JSON line, got ${JSON.stringify(r.stdout)}`); return ''; }
  expect(r.stdout.trim().split('\n').length === 1, `${label}: exactly one output line`);
  for (const k of ['decision', 'continue', 'hookSpecificOutput', 'stopReason']) expect(!Object.hasOwn(out, k), `${label}: output must not carry ${k}`);
  expect(typeof out.systemMessage === 'string' && out.systemMessage.length > 0, `${label}: output must be a systemMessage`);
  return out.systemMessage ?? '';
}
const silent = (r, label) => expect(r.status === 0 && r.stdout === '', `${label}: must exit 0 with no output, got ${r.status}/${JSON.stringify(r.stdout)}`);

// ---------------------------------------------------------------- pass
const passing = [
  ['code-ops-suite:implementer', 'DONE: D-002.md, 3 files changed\nNext: lead runs the gate chain'],
  ['code-ops-suite:implementer', '\n  CHECKPOINT: 40 rounds used\nNext: continue'],
  ['code-ops-suite:mech', 'PASS\nall gates green'],
  ['code-ops-suite:reviewer', 'CHANGES: two findings'],
  ['rigor:verifier', 'NOT-CONFIRMED: the repro did not fail'],
  ['researcher:gatherer', 'ANSWERED - three sources'],
  ['privacy-opsec-suite:privacy-reviewer', `APPROVE ${words(598)}`],
];
for (const [type, msg] of passing) silent(runHook(payload(type, msg)), `pass ${type}`);
console.log(`ok   ${passing.length} conforming reports across four plugins get nothing`);

// ---------------------------------------------------------------- wrong verdict
const wrong = [
  ['code-ops-suite:implementer', 'Done. I changed three files.', 'DONE | CHECKPOINT | BLOCKED'],
  ['code-ops-suite:implementer', 'DONEISH: close enough', 'DONE | CHECKPOINT | BLOCKED'],
  ['code-ops-suite:mech', '**PASS**', 'PASS | FAIL | ESCALATE'],
  ['rigor:verifier', 'NOT-CONFIRMED-YET', 'CONFIRMED | NOT-CONFIRMED | ESCALATE'],
  ['code-ops-suite:explorer', 'Here is what I found:\nANSWERED', 'ANSWERED | PARTIAL | ESCALATE'],
];
for (const [type, msg, tokens] of wrong) {
  const m = note(runHook(payload(type, msg)), `wrong verdict ${type} ${JSON.stringify(msg)}`);
  expect(m.includes('declared verdict') && m.includes(tokens) && m.includes(type), `wrong verdict ${type}: message names the type and tokens, got ${JSON.stringify(m)}`);
  expect(!/cap/.test(m), `wrong verdict ${type}: a short report must not be flagged over cap`);
}
console.log(`ok   ${wrong.length} reports without a declared first-line verdict get one advisory note`);

// ---------------------------------------------------------------- over cap
const over = [
  ['code-ops-suite:implementer', 600], ['code-ops-suite:mech', 300], ['code-ops-suite:explorer', 400], ['rigor:tracer', 400],
];
for (const [type, cap] of over) {
  const token = { 'code-ops-suite:implementer': 'DONE', 'code-ops-suite:mech': 'PASS', 'code-ops-suite:explorer': 'ANSWERED', 'rigor:tracer': 'TRACED' }[type];
  silent(runHook(payload(type, `${token} ${words(cap - 1)}`)), `at cap ${type}`);
  const m = note(runHook(payload(type, `${token} ${words(cap)}`)), `over cap ${type}`);
  expect(m.includes(`${cap + 1} words`) && m.includes(`${cap}-word cap`) && !m.includes('declared verdict'), `over cap ${type}: message names count and cap only, got ${JSON.stringify(m)}`);
}
const both = note(runHook(payload('code-ops-suite:mech', `Report follows ${words(400)}`)), 'wrong verdict and over cap');
expect(both.includes('declared verdict') && both.includes('300-word cap'), 'both problems land in one note');
console.log(`ok   ${over.length} agents: the cap boundary is exact, and both problems share one note`);

// ---------------------------------------------------------------- transcript fallback
const dir = mkdtempSync(join(tmpdir(), 'subagent-report-'));
const transcript = join(dir, 'agent-a1.jsonl');
writeFileSync(transcript, [
  JSON.stringify({ type: 'user', message: { role: 'user', content: 'brief' } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'DONE: earlier' }] } }),
  '{torn line',
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All finished.' }, { type: 'tool_use', id: 't', name: 'x', input: {} }] } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'x', input: {} }] } }),
  '',
].join('\n'));
const fb = note(runHook(payload('code-ops-suite:implementer', undefined, { agent_transcript_path: transcript })), 'transcript fallback');
expect(fb.includes('declared verdict'), 'transcript fallback checks the last assistant text, not an earlier message');
silent(runHook(payload('code-ops-suite:implementer', '', { agent_transcript_path: join(dir, 'missing.jsonl') })), 'missing transcript');
console.log('ok   an absent last_assistant_message falls back to the agent transcript; a missing transcript is silent');

// ---------------------------------------------------------------- unknown agent
for (const type of ['implementer', 'general-purpose', 'acme:builder', 'code-ops-suite:no-such-agent', 'code-ops-suite:../agents/implementer', '../x:implementer', 'a:b:c', 7, '', undefined]) {
  silent(runHook(payload(type, 'nonsense first line')), `unknown agent ${JSON.stringify(type)}`);
}
console.log('ok   bare, custom, traversal, missing, and non-string types get nothing');

// ---------------------------------------------------------------- malformed payload
const malformed = [
  ['bad JSON', '{not json'],
  ['empty input', ''],
  ['JSON null', 'null'],
  ['JSON array', '[1,2]'],
  ['another event', JSON.stringify({ hook_event_name: 'SubagentStart', agent_type: 'code-ops-suite:implementer', last_assistant_message: 'nope' })],
  ['non-string message', JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'code-ops-suite:implementer', last_assistant_message: { a: 1 }, agent_transcript_path: 5 })],
  ['blank message', payload('code-ops-suite:implementer', '   ')],
];
for (const [name, input] of malformed) silent(runHook(input), `malformed ${name}`);
const bom = runHook(`﻿${payload('code-ops-suite:implementer', 'nope')}`);
expect(/systemMessage/.test(bom.stdout), 'a BOM-prefixed payload is still read');
console.log(`ok   ${malformed.length} malformed payloads fail open; a BOM-prefixed payload is read`);

// ---------------------------------------------------------------- switches
for (const sw of ['off', '0', 'false', 'OFF']) silent(runHook(payload('code-ops-suite:implementer', 'nope'), { CODE_OPS_SUBAGENT_REPORT: sw }), `switch ${sw}`);
for (const sw of ['on', '1', '']) note(runHook(payload('code-ops-suite:implementer', 'nope'), { CODE_OPS_SUBAGENT_REPORT: sw }), `switch ${JSON.stringify(sw)}`);
silent(runHook(payload('code-ops-suite:implementer', 'nope'), { GROK_PLUGIN_ROOT: suite }), 'Grok adapter');
console.log('ok   off, 0, and false silence the hook; other values leave it on; the Grok adapter is silent');

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\nsubagent-report eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nsubagent-report eval passed');
