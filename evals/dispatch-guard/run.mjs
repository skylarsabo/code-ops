#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/dispatch-guard.mjs, the default-on
// PreToolUse backstop for the brief's Round budget and for two dispatch-level context leaks.
// It pins the contract the hook promises:
//   - a main-thread tool call that is not a dispatch is silent, whatever the tool;
//   - inside a subagent (`agent_id` present) the hook counts tool calls, stays silent under the
//     budget, warns exactly at the budget and at every further 20 rounds, and names both the
//     rounds used and the checkpoint-and-return instruction;
//   - at three times the budget it denies with a reason telling the operative to report now,
//     and `CODE_OPS_DISPATCH_GUARD=warn` lifts only that hard stop;
//   - concurrent subagents never share a counter, and `CODE_OPS_ROUND_BUDGET` overrides 40;
//   - a dispatch (tool_name Agent, and legacy Task) is never denied, and earns one advisory for
//     a `model` override (naming the agent's declared tier when a definition declares one), one
//     for a wide-surface or context-inheriting type or a missing type, and one for a prompt with
//     no Round budget, combined into one short output;
//   - a dispatch that names a narrow agent, no model, and a Round budget is silent;
//   - the off switch silences every branch, and bad JSON, another event name, empty stdin, and a
//     missing agent id all fail open with no output and exit 0.
//
//   node evals/dispatch-guard/run.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const suite = join(root, 'plugins', 'code-ops-suite');
const hook = join(suite, 'hooks', 'dispatch-guard.mjs');

const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };

// Each case gets its own fake HOME so the round counters never touch the real operator's
// `~/.claude/code-ops/dispatch/`, the isolation evals/handoff-card/run.mjs uses for its markers.
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dispatch-home-'));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

function runHook(payload, { home, guard, budget, pluginRoot = suite } = {}) {
  const env = { ...process.env };
  delete env.CODE_OPS_DISPATCH_GUARD;
  delete env.CODE_OPS_ROUND_BUDGET;
  if (guard !== undefined) env.CODE_OPS_DISPATCH_GUARD = guard;
  if (budget !== undefined) env.CODE_OPS_ROUND_BUDGET = String(budget);
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync('node', [hook], { input, encoding: 'utf8', env });
}

const subagentCall = (agentId, extra = {}) => ({
  hook_event_name: 'PreToolUse', session_id: 'sess-1', cwd: 'C:/fixture-project',
  tool_name: 'Read', tool_input: { file_path: 'a.txt' }, tool_use_id: 'tu-1',
  agent_id: agentId, agent_type: 'implementer', ...extra,
});

const dispatchCall = (toolInput, extra = {}) => ({
  hook_event_name: 'PreToolUse', session_id: 'sess-1', cwd: 'C:/fixture-project',
  tool_name: 'Agent', tool_input: toolInput, tool_use_id: 'tu-2', ...extra,
});

function parseOut(r) {
  if (r.stdout.trim() === '') return null;
  try { return JSON.parse(r.stdout); } catch { return 'unparsable'; }
}

const contextOf = (out) => (out && out !== 'unparsable' ? out.hookSpecificOutput?.additionalContext : undefined);

// ---------------------------------------------------------------- main thread, ordinary tool call

{
  const { home, cleanup } = fakeHome();
  for (const tool of ['Read', 'Bash', 'Edit', 'Grep']) {
    const r = runHook({ hook_event_name: 'PreToolUse', cwd: 'C:/fixture-project', tool_name: tool, tool_input: {} }, { home });
    expect(r.status === 0 && r.stdout === '', `a main-thread ${tool} call must be silent, got ${r.status}/${JSON.stringify(r.stdout)}`);
  }
  cleanup();
  console.log('ok   a main-thread tool call that is not a dispatch is silent');
}

// ---------------------------------------------------------------- the round counter

{
  const { home, cleanup } = fakeHome();
  const budget = 4;
  const outputs = [];
  for (let i = 1; i <= budget * 3; i++) outputs.push(parseOut(runHook(subagentCall('agent-A'), { home, budget })));

  for (let i = 1; i < budget; i++) {
    expect(outputs[i - 1] === null, `round ${i} under the budget must be silent, got ${JSON.stringify(outputs[i - 1])}`);
  }
  const atBudget = contextOf(outputs[budget - 1]);
  expect(typeof atBudget === 'string' && atBudget.includes(`${budget} tool rounds used`), `the budget round must warn, got ${JSON.stringify(outputs[budget - 1])}`);
  expect(typeof atBudget === 'string' && /checkpoint/i.test(atBudget) && atBudget.includes('file:line') && /fresh operative/.test(atBudget),
    `the warning must name the checkpoint, the evidence shape, and the fresh operative, got ${atBudget}`);
  expect(!Object.hasOwn(outputs[budget - 1]?.hookSpecificOutput ?? {}, 'permissionDecision'), 'a warning must carry no permissionDecision');
  expect(outputs[budget - 1]?.hookSpecificOutput?.hookEventName === 'PreToolUse', 'the warning must name hookEventName PreToolUse');
  expect(outputs[budget] === null, `the round after the budget must be silent, got ${JSON.stringify(outputs[budget])}`);

  // At three times the budget: deny, with a reason that tells the operative to report now.
  const stop = outputs[budget * 3 - 1];
  const hso = stop && stop !== 'unparsable' ? stop.hookSpecificOutput ?? {} : {};
  expect(hso.permissionDecision === 'deny', `three times the budget must deny, got ${JSON.stringify(stop)}`);
  expect(typeof hso.permissionDecisionReason === 'string' && /report now/i.test(hso.permissionDecisionReason),
    `the deny reason must tell the operative to return its report now, got ${hso.permissionDecisionReason}`);
  expect(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(JSON.stringify(outputs)), 'no hook output carries an emoji');
  cleanup();
  console.log('ok   under the budget is silent, the budget round warns, and three times the budget denies');
}

// Every further 20 rounds warns again, on the default 40-round budget.
{
  const { home, cleanup } = fakeHome();
  const warned = [];
  for (let i = 1; i <= 61; i++) {
    const out = parseOut(runHook(subagentCall('agent-B'), { home }));
    if (out) warned.push(i);
  }
  expect(JSON.stringify(warned) === JSON.stringify([40, 60]), `the default budget must warn at 40 and 60 only, got ${JSON.stringify(warned)}`);
  cleanup();
  console.log('ok   the default 40-round budget warns at 40 and at every further 20 rounds');
}

// ---------------------------------------------------------------- warn mode lifts only the stop

{
  const { home, cleanup } = fakeHome();
  const budget = 3;
  const outputs = [];
  for (let i = 1; i <= budget * 4; i++) outputs.push(parseOut(runHook(subagentCall('agent-C'), { home, budget, guard: 'warn' })));
  expect(outputs.every((out) => !Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision')),
    `warn mode must never deny, got ${JSON.stringify(outputs)}`);
  expect(typeof contextOf(outputs[budget - 1]) === 'string' && contextOf(outputs[budget - 1]).includes('3 tool rounds used'),
    `warn mode still warns at the budget, got ${JSON.stringify(outputs[budget - 1])}`);
  cleanup();
  console.log('ok   CODE_OPS_DISPATCH_GUARD=warn keeps the warnings and lifts the hard stop');
}

// ---------------------------------------------------------------- one counter per subagent

{
  const { home, cleanup } = fakeHome();
  const budget = 3;
  // Two subagents interleave their calls; neither reaches the budget on its own.
  for (let i = 0; i < budget - 1; i++) {
    for (const id of ['agent-D', 'agent-E']) {
      const r = runHook(subagentCall(id), { home, budget });
      expect(r.stdout === '', `interleaved subagents must not share a counter, ${id} spoke at round ${i + 1}: ${r.stdout}`);
    }
  }
  const d = parseOut(runHook(subagentCall('agent-D'), { home, budget }));
  expect(typeof contextOf(d) === 'string' && contextOf(d).includes('3 tool rounds used'), `the third call of one subagent warns, got ${JSON.stringify(d)}`);
  // A different project path is a different counter store, too.
  const other = runHook(subagentCall('agent-D', { cwd: 'C:/other-project' }), { home, budget });
  expect(other.stdout === '', `a different cwd must start a fresh counter, got ${other.stdout}`);
  cleanup();
  console.log('ok   each subagent, and each project path, counts rounds on its own');
}

// ---------------------------------------------------------------- dispatch advisories

{
  const { home, cleanup } = fakeHome();

  // All three leaks at once: an override, a wide type, and no Round budget.
  let out = parseOut(runHook(dispatchCall({ description: 'do a thing', prompt: 'Fix the parser.', subagent_type: 'general-purpose', model: 'haiku' }), { home }));
  let text = contextOf(out);
  expect(typeof text === 'string', `a leaky dispatch must print an advisory, got ${JSON.stringify(out)}`);
  expect(!Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision'), 'a dispatch advisory must never deny');
  expect(/model override/i.test(text ?? ''), `the advisory must flag the model override, got ${text}`);
  expect(/general-purpose/.test(text ?? '') && /code-ops-suite:implementer/.test(text ?? ''), `the advisory must flag the wide type and name the narrow choice, got ${text}`);
  expect(/Round budget/.test(text ?? '') && /40/.test(text ?? '') && /120/.test(text ?? ''), `the advisory must flag the missing Round budget and name both limits, got ${text}`);
  expect((text ?? '').length <= 320, `the combined advisory must stay short, got ${(text ?? '').length} characters`);

  // A code-ops-suite agent's declared tier is named from its own definition.
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 20 rounds', subagent_type: 'code-ops-suite:explorer', model: 'opus' }), { home }));
  text = contextOf(out) ?? '';
  const declared = readFileSync(join(suite, 'agents', 'explorer.md'), 'utf8').match(/^model:[ \t]*(\S+)$/m)[1];
  expect(text.includes(`(${declared})`), `the advisory must name the declared tier ${declared}, got ${text}`);
  expect(!/code-ops-suite:implementer/.test(text) && !/Round budget/.test(text), `a narrow type with a budget earns only the override clause, got ${text}`);

  // An unreadable agent definition degrades to the clause without a tier, and never throws.
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 20 rounds', subagent_type: 'no-such-agent', model: 'opus' }), { home, pluginRoot: join(home, 'missing') }));
  text = contextOf(out) ?? '';
  expect(/model override/i.test(text) && !/\(/.test(text), `a missing definition drops the tier, got ${text}`);

  // A missing subagent_type reads as the default surface.
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 10 rounds' }), { home }));
  text = contextOf(out) ?? '';
  expect(/large default or inherited context/.test(text), `an absent subagent_type must be flagged, got ${text}`);

  // Legacy tool name.
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 10 rounds', subagent_type: 'fork' }, { tool_name: 'Task' }), { home }));
  expect(/inherited context/.test(contextOf(out) ?? ''), `the legacy Task tool name must be advised too, got ${JSON.stringify(out)}`);

  // A clean dispatch: narrow agent, no override, a Round budget in the brief.
  const clean = runHook(dispatchCall({ description: 'build it', prompt: 'Scope: one file.\nRound budget: 25 tool rounds', subagent_type: 'code-ops-suite:implementer' }), { home });
  expect(clean.status === 0 && clean.stdout === '', `a clean dispatch must be silent, got ${clean.status}/${JSON.stringify(clean.stdout)}`);
  cleanup();
  console.log('ok   a leaky dispatch earns one short advisory and a clean dispatch is silent');
}

// ---------------------------------------------------------------- the off switch

{
  const { home, cleanup } = fakeHome();
  const budget = 2;
  for (const value of ['off', '0', 'false', 'OFF', 'False']) {
    for (let i = 0; i < budget * 3; i++) {
      const r = runHook(subagentCall(`agent-off-${value}`), { home, budget, guard: value });
      expect(r.status === 0 && r.stdout === '', `CODE_OPS_DISPATCH_GUARD=${value} must silence the counter, got ${JSON.stringify(r.stdout)}`);
    }
    const r = runHook(dispatchCall({ prompt: 'no budget here', subagent_type: 'general-purpose', model: 'haiku' }), { home, guard: value });
    expect(r.status === 0 && r.stdout === '', `CODE_OPS_DISPATCH_GUARD=${value} must silence the advisories, got ${JSON.stringify(r.stdout)}`);
  }
  for (const value of [undefined, 'on', '1', 'true', '']) {
    const r = runHook(dispatchCall({ prompt: 'no budget here', subagent_type: 'general-purpose', model: 'haiku' }), { home, guard: value });
    expect(r.status === 0 && r.stdout !== '', `unset or a non-off value leaves the hook on, got ${JSON.stringify(r.stdout)} for ${value}`);
  }
  cleanup();
  console.log('ok   off, 0, and false silence every branch; unset and non-off values leave it on');
}

// ---------------------------------------------------------------- an invalid budget falls back

{
  const { home, cleanup } = fakeHome();
  for (const bad of ['0', '-5', 'many', '2.5', '']) {
    const r = runHook(dispatchCall({ prompt: 'no budget here', subagent_type: 'general-purpose' }), { home, budget: bad });
    expect(r.stdout.includes('40 rounds'), `CODE_OPS_ROUND_BUDGET=${bad} must fall back to 40, got ${JSON.stringify(r.stdout)}`);
  }
  cleanup();
  console.log('ok   an invalid CODE_OPS_ROUND_BUDGET falls back to the 40-round default');
}

// ---------------------------------------------------------------- fail open

{
  const { home, cleanup } = fakeHome();
  const cases = [
    ['bad JSON', '{not json'],
    ['empty stdin', ''],
    ['a JSON scalar', '42'],
    ['another event name', JSON.stringify({ ...subagentCall('agent-F'), hook_event_name: 'PostToolUse' })],
    ['no tool name and no agent id', JSON.stringify({ hook_event_name: 'PreToolUse', cwd: 'C:/fixture-project' })],
    ['a dispatch with no tool_input', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Agent', cwd: 'C:/fixture-project' })],
    ['an empty agent id', JSON.stringify(subagentCall(''))],
  ];
  for (const [name, input] of cases) {
    const r = runHook(input, { home, budget: 1 });
    expect(r.status === 0 && r.stdout === '', `${name}: must exit 0 with no output, got ${r.status}/${JSON.stringify(r.stdout)}`);
  }
  console.log(`ok   ${cases.length} malformed or missing-evidence payloads fail open`);

  const bom = runHook(`\uFEFF${JSON.stringify(subagentCall('agent-G'))}`, { home, budget: 1 });
  expect(bom.status === 0 && bom.stdout !== '', `a BOM-prefixed payload is still read, got ${JSON.stringify(bom.stdout)}`);
  console.log('ok   a BOM-prefixed payload is still read');

  // An unwritable state directory fails open rather than blocking the tool call.
  const blocked = join(home, 'blocked');
  mkdirSync(blocked, { recursive: true });
  writeFileSync(join(blocked, '.claude'), 'not a directory');
  const r = runHook(subagentCall('agent-H'), { home: blocked, budget: 1 });
  expect(r.status === 0 && r.stdout === '', `an unwritable counter store must fail open, got ${r.status}/${JSON.stringify(r.stdout)}`);
  console.log('ok   an unwritable counter store fails open');
  cleanup();
}

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\ndispatch-guard eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\ndispatch-guard eval passed');
