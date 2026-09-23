#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/dispatch-guard.mjs, the default-on
// PreToolUse backstop for the brief's Round budget and for two dispatch-level context leaks.
// It pins the contract the hook promises:
//   - a main-thread tool call that is not a dispatch is silent, whatever the tool;
//   - inside a subagent (`agent_id` present) the hook counts tool calls, stays silent under the
//     budget, warns exactly at the budget and at every further 20 rounds, and names both the
//     rounds used and the checkpoint-and-return instruction;
//   - at twice the budget it denies with a reason telling the operative to report now, and
//     `CODE_OPS_DISPATCH_GUARD=warn` lifts only that hard stop;
//   - concurrent subagents never share a counter, and `CODE_OPS_ROUND_BUDGET` overrides 40;
//   - a dispatch (tool_name Agent, and legacy Task) with a wide-surface, context-inheriting, or
//     missing type is denied unless the brief carries a "Wide-surface reason:" line, and a
//     Workflow script with an agent() call but no agentType is denied the same way; a `model`
//     override (naming the agent's declared tier when a definition declares one) and a prompt
//     with no Round budget stay advisory clauses in the same output, and warn mode downgrades
//     every denial to an advisory;
//   - a dispatch that names a narrow agent, no model, and a Round budget is silent;
//   - at and past the context ceiling (300,000 by default, CODE_OPS_CONTEXT_CEILING overrides
//     or disables it), a main-thread dispatch is denied until a handoff Skill call or the
//     `assessed` CLI verb records the current 150,000-token band, and the next band re-gates;
//   - the off switch silences every branch, and bad JSON, another event name, empty stdin, and a
//     missing agent id all fail open with no output and exit 0.
//
//   node evals/dispatch-guard/run.mjs

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

function runHook(payload, { home, guard, budget, ceiling, grok = false, pluginRoot = suite } = {}) {
  const env = { ...process.env };
  delete env.CODE_OPS_DISPATCH_GUARD;
  delete env.CODE_OPS_ROUND_BUDGET;
  delete env.CODE_OPS_CONTEXT_CEILING;
  delete env.GROK_PLUGIN_ROOT;
  if (guard !== undefined) env.CODE_OPS_DISPATCH_GUARD = guard;
  if (ceiling !== undefined) env.CODE_OPS_CONTEXT_CEILING = ceiling;
  if (budget !== undefined) env.CODE_OPS_ROUND_BUDGET = String(budget);
  if (grok) env.GROK_PLUGIN_ROOT = pluginRoot;
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync('node', [hook], { input, encoding: 'utf8', env });
}

function runControl(args, { home, budget, cwd = root } = {}) {
  const env = { ...process.env };
  delete env.CODE_OPS_ROUND_BUDGET;
  if (budget !== undefined) env.CODE_OPS_ROUND_BUDGET = String(budget);
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  return spawnSync('node', [hook, ...args], { encoding: 'utf8', env, cwd });
}

const stateKey = (value) => createHash('sha256').update(String(value)).digest('hex');
const legacySlug = (value) => String(value).replace(/[^A-Za-z0-9]/g, '-');

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
const reasonOf = (out) => (out && out !== 'unparsable' ? out.hookSpecificOutput?.permissionDecisionReason : undefined);

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
  for (let i = 1; i <= budget * 2; i++) outputs.push(parseOut(runHook(subagentCall('agent-A'), { home, budget })));

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

  // At twice the budget, and not one round earlier: deny, with a reason that tells the
  // operative to report now.
  expect(outputs.slice(0, budget * 2 - 1).every((out) => out?.hookSpecificOutput?.permissionDecision !== 'deny'),
    `no round before twice the budget may deny, got ${JSON.stringify(outputs)}`);
  const stop = outputs[budget * 2 - 1];
  const hso = stop && stop !== 'unparsable' ? stop.hookSpecificOutput ?? {} : {};
  expect(hso.permissionDecision === 'deny', `twice the budget must deny, got ${JSON.stringify(stop)}`);
  expect(/8 tool rounds used, 2 times the 4-round budget/.test(hso.permissionDecisionReason ?? ''),
    `the stop reason must cite the 2x multiple, got ${hso.permissionDecisionReason}`);
  expect(typeof hso.permissionDecisionReason === 'string' && /report now/i.test(hso.permissionDecisionReason),
    `the deny reason must tell the operative to return its report now, got ${hso.permissionDecisionReason}`);
  expect(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(JSON.stringify(outputs)), 'no hook output carries an emoji');
  cleanup();
  console.log('ok   under the budget is silent, the budget round warns, and twice the budget denies');
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

  // All three leaks at once: an override, a wide type, and no Round budget. The wide type
  // denies, and the reason still carries the two advisory clauses.
  const leaky = { description: 'do a thing', prompt: 'Fix the parser.', subagent_type: 'general-purpose', model: 'haiku' };
  let out = parseOut(runHook(dispatchCall(leaky), { home }));
  let text = reasonOf(out);
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny' && typeof text === 'string', `a wide dispatch with no reason must deny, got ${JSON.stringify(out)}`);
  expect(/model override/i.test(text ?? ''), `the reason must flag the model override, got ${text}`);
  expect(/general-purpose/.test(text ?? '') && /code-ops-suite:implementer/.test(text ?? '') && /Wide-surface reason: <why>/.test(text ?? ''),
    `the reason must flag the wide type, name the narrow choice, and name the escape line, got ${text}`);
  expect(/Round budget/.test(text ?? '') && /40/.test(text ?? '') && /80/.test(text ?? '') && !/120/.test(text ?? ''),
    `the reason must flag the missing Round budget and name both limits at 2x, got ${text}`);
  expect(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text ?? ''), 'the deny reason carries no emoji');

  // Warn mode keeps the same clauses as one short advisory, never a decision.
  out = parseOut(runHook(dispatchCall(leaky), { home, guard: 'warn' }));
  text = contextOf(out);
  expect(typeof text === 'string' && !Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision') && /general-purpose/.test(text),
    `warn mode must downgrade the wide deny to an advisory, got ${JSON.stringify(out)}`);
  expect((text ?? '').length <= 400, `the combined advisory must stay short, got ${(text ?? '').length} characters`);

  // A same-line Wide-surface reason allows the wide type; the other clauses stay advisory.
  out = parseOut(runHook(dispatchCall({ ...leaky, prompt: 'Fix the parser.\nWide-surface reason: needs the MCP browser tools.' }), { home }));
  text = contextOf(out) ?? '';
  expect(!Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision') && /model override/i.test(text) && !/general-purpose/.test(text),
    `a stated Wide-surface reason must allow the dispatch and drop the wide clause, got ${JSON.stringify(out)}`);
  out = parseOut(runHook(dispatchCall({ ...leaky, prompt: 'Fix the parser.\nWide-surface reason:\n' }), { home }));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `an empty Wide-surface reason must still deny, got ${JSON.stringify(out)}`);
  out = parseOut(runHook(dispatchCall({ ...leaky, prompt: 'Round budget: 5\n  Wide-surface reason: indented' }), { home }));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `the reason must start its own line, got ${JSON.stringify(out)}`);

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

  // A missing subagent_type reads as the default surface, and denies.
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 10 rounds' }), { home }));
  text = reasonOf(out) ?? '';
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny' && /An unnamed type starts from a large default or inherited context/.test(text),
    `an absent subagent_type must deny, got ${JSON.stringify(out)}`);

  // Legacy tool name.
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 10 rounds', subagent_type: 'fork' }, { tool_name: 'Task' }), { home }));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny' && /inherited context/.test(reasonOf(out) ?? ''),
    `the legacy Task tool name must be denied too, got ${JSON.stringify(out)}`);

  // Workflow: an agent() call with no agentType denies; agentType or a stated reason allows.
  const workflow = (script, guard) => parseOut(runHook(dispatchCall({ script }, { tool_name: 'Workflow' }), { home, guard }));
  out = workflow("const r = await agent({ prompt: 'scan the repo' });");
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny' && /no agentType/.test(reasonOf(out) ?? ''),
    `a Workflow agent() call without agentType must deny, got ${JSON.stringify(out)}`);
  out = workflow("const r = await agent({ prompt: 'scan the repo' });", 'warn');
  expect(/no agentType/.test(contextOf(out) ?? '') && !Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision'),
    `warn mode must downgrade the Workflow deny, got ${JSON.stringify(out)}`);
  for (const allowed of [
    "const r = await agent({ agentType: 'code-ops-suite:explorer', prompt: 'scan' });",
    "// Wide-surface reason: needs browser tools\nconst r = await agent({ prompt: 'scan' });",
    "const x = 1;",
  ]) {
    const r = runHook(dispatchCall({ script: allowed }, { tool_name: 'Workflow' }), { home });
    expect(r.status === 0 && r.stdout === '', `a Workflow with agentType, a stated reason, or no agent() call must be silent, got ${JSON.stringify(r.stdout)}`);
  }

  // A clean dispatch: narrow agent, no override, a Round budget in the brief.
  const clean = runHook(dispatchCall({ description: 'build it', prompt: 'Scope: one file.\nRound budget: 25 tool rounds', subagent_type: 'code-ops-suite:implementer' }), { home });
  expect(clean.status === 0 && clean.stdout === '', `a clean dispatch must be silent, got ${clean.status}/${JSON.stringify(clean.stdout)}`);
  cleanup();
  console.log('ok   a wide dispatch denies unless it states a reason, warn downgrades it, and a clean dispatch is silent');
}

// ---------------------------------------------------------------- explicit controller bindings

{
  const { home, cleanup } = fakeHome();
  const boundId = 'bound-agent';
  const otherId = 'same-type-but-unbound';
  const cwd = root;
  const registered = runControl(['register', '--agent-id', boundId, '--budget', '2', '--allowance', '2'], { home, budget: 3, cwd });
  expect(registered.status === 0 && registered.stdout === '', `registration must be local and silent, got ${registered.status}/${registered.stdout}`);

  // Lead dispatch events have no child agent id. A matching type after this event must not
  // inherit the registration by timing or type; it remains on the legacy fallback.
  const lead = runHook(dispatchCall({ prompt: 'Round budget: 2 tool rounds', subagent_type: 'code-ops-suite:implementer' }, { cwd }), { home, budget: 3 });
  expect(lead.stdout === '', `a clean lead dispatch must not auto-bind a future worker, got ${lead.stdout}`);
  for (let i = 0; i < 2; i++) expect(runHook(subagentCall(otherId, { cwd }), { home, budget: 3 }).stdout === '', 'an unregistered same-type worker must retain its own legacy counter');
  const fallbackWarning = contextOf(parseOut(runHook(subagentCall(otherId, { cwd }), { home, budget: 3 })));
  expect(typeof fallbackWarning === 'string' && !/controller-bound/.test(fallbackWarning), `no guessed binding may alter the fallback, got ${fallbackWarning}`);

  const bound = [];
  for (let i = 0; i < 5; i++) bound.push(parseOut(runHook(subagentCall(boundId, { cwd }), { home, budget: 3 })));
  expect(/controller-bound 2-round budget/.test(contextOf(bound[1]) ?? ''), `a registered id must warn at its declared budget, got ${JSON.stringify(bound[1])}`);
  expect(bound[2] === null && bound[3] === null, `the two-call allowance must execute after the bound budget, got ${JSON.stringify(bound.slice(2, 4))}`);
  expect(bound[4]?.hookSpecificOutput?.permissionDecision === 'deny' && /attempted tool calls/.test(bound[4]?.hookSpecificOutput?.permissionDecisionReason ?? ''),
    `the call after the allowance must deny and label attempted calls, got ${JSON.stringify(bound[4])}`);

  const receipt = parseOut(runControl(['read', '--agent-id', boundId], { home, cwd }));
  const measured = receipt?.measurement ?? {};
  expect(measured.declaredBudget === 2 && measured.effectiveBudget === 'UNKNOWN' && measured.allowance === 2 && measured.calls === 5
    && measured.source === 'controller-registration' && measured.status === 'BOUND', `the receipt must expose bound local measurements without inventing hook-environment limits, got ${JSON.stringify(receipt)}`);
  expect(receipt?.unobserved?.model === 'UNKNOWN' && receipt?.unobserved?.requests === 'UNKNOWN' && receipt?.unobserved?.tokens === 'UNKNOWN'
    && receipt?.unobserved?.cache === 'UNKNOWN' && receipt?.unobserved?.context === 'UNKNOWN',
  `unobserved model/request/token/cache/context fields must stay UNKNOWN, got ${JSON.stringify(receipt)}`);
  expect(!JSON.stringify(receipt).includes(boundId) && !JSON.stringify(receipt).includes(cwd) && !/prompt|command/i.test(JSON.stringify(receipt)),
    `receipt must not expose the agent id, cwd, prompt, or command, got ${JSON.stringify(receipt)}`);
  cleanup();
  console.log('ok   only an exact controller registration binds a worker, with a bounded allowance and sanitized receipt');
}

// ---------------------------------------------------------------- controller conflicts, malformed records, and legacy migration

{
  const { home, cleanup } = fakeHome();
  const cwd = root;
  const id = 'conflict-agent';
  runControl(['register', '--agent-id', id, '--budget', '2'], { home, budget: 3, cwd });
  const duplicate = runControl(['register', '--agent-id', id, '--budget', '99', '--allowance', '4'], { home, budget: 3, cwd });
  expect(duplicate.status === 2 && duplicate.stderr.trim() === 'dispatch-guard CONFLICT',
    `a conflicting registration must return a concise nonsecret failure, got ${duplicate.status}/${JSON.stringify(duplicate.stderr)}`);
  const conflict = parseOut(runControl(['receipt', '--agent-id', id], { home, budget: 3, cwd }));
  expect(conflict?.measurement?.declaredBudget === 2 && conflict?.measurement?.allowance === 2,
    `a conflicting registration must not enlarge the first binding, got ${JSON.stringify(conflict)}`);

  const malformedId = 'malformed-agent';
  const state = join(home, '.claude', 'code-ops', 'dispatch', stateKey(cwd));
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, `${stateKey(malformedId)}.binding.json`), '{not json');
  const malformed = parseOut(runHook(subagentCall(malformedId, { cwd }), { home, budget: 3 }));
  expect(malformed?.hookSpecificOutput?.permissionDecision === 'deny' && /binding is malformed/i.test(malformed?.hookSpecificOutput?.permissionDecisionReason ?? ''),
    `a malformed explicit binding must fail closed, got ${JSON.stringify(malformed)}`);
  const malformedWarn = parseOut(runHook(subagentCall(malformedId, { cwd }), { home, budget: 3, guard: 'warn' }));
  expect(malformedWarn?.hookSpecificOutput?.permissionDecision === 'deny',
    `warn mode must not fail open a malformed explicit binding, got ${JSON.stringify(malformedWarn)}`);
  const invalidReceipt = parseOut(runControl(['receipt', '--agent-id', malformedId], { home, budget: 3, cwd }));
  expect(invalidReceipt?.measurement?.status === 'INVALID' && invalidReceipt?.measurement?.calls === 'UNKNOWN',
    `a malformed binding receipt must not invent measurements, got ${JSON.stringify(invalidReceipt)}`);

  const legacyId = 'legacy-agent';
  const legacy = join(home, '.claude', 'code-ops', 'dispatch', legacySlug(cwd));
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, `${legacySlug(legacyId)}.rounds`), '.'.repeat(79));
  const migrated = parseOut(runHook(subagentCall(legacyId, { cwd }), { home, budget: 40 }));
  expect(migrated?.hookSpecificOutput?.permissionDecision === 'deny', `a legacy count of 79 must deny on its next call after hashed-state rollout, got ${JSON.stringify(migrated)}`);
  const invalid = runControl(['register', '--agent-id', 'invalid-agent', '--budget', '0'], { home, budget: 3, cwd });
  expect(invalid.status === 2 && invalid.stderr.trim() === 'dispatch-guard INVALID_ARGUMENT',
    `an invalid registration must return a concise nonsecret failure, got ${invalid.status}/${JSON.stringify(invalid.stderr)}`);
  const unavailable = runControl(['register', '--agent-id', 'unavailable-agent', '--budget', '2'], { home: hook, budget: 3, cwd });
  expect(unavailable.status === 2 && unavailable.stderr.trim() === 'dispatch-guard UNAVAILABLE',
    `an unavailable controller state directory must fail nonzero and sanitized, got ${unavailable.status}/${JSON.stringify(unavailable.stderr)}`);
  cleanup();
  console.log('ok   conflicting and malformed registrations never enlarge a budget, and legacy counters retain their stop');
}

// ---------------------------------------------------------------- bound cap and concurrent registration isolation

{
  const { home, cleanup } = fakeHome();
  const cwd = root;
  for (const id of ['bound-A', 'bound-B']) runControl(['register', '--agent-id', id, '--budget', '99', '--allowance', '4'], { home, budget: 3, cwd });
  for (let i = 0; i < 5; i++) {
    for (const id of ['bound-A', 'bound-B']) {
      const out = parseOut(runHook(subagentCall(id, { cwd }), { home, budget: 3 }));
      expect(out?.hookSpecificOutput?.permissionDecision !== 'deny', `concurrent bound counters must not share a cap for ${id}, got ${JSON.stringify(out)}`);
    }
  }
  for (const id of ['bound-A', 'bound-B']) {
    const stopped = parseOut(runHook(subagentCall(id, { cwd }), { home, budget: 3 }));
    expect(stopped?.hookSpecificOutput?.permissionDecision === 'deny', `the bound cap must not exceed the legacy fallback cap for ${id}, got ${JSON.stringify(stopped)}`);
    const view = parseOut(runControl(['read', '--agent-id', id], { home, budget: 3, cwd }));
    expect(view?.measurement?.effectiveBudget === 'UNKNOWN' && view?.measurement?.allowance === 4,
      `the read view must expose the declared allowance without inventing a hook-environment effective budget for ${id}, got ${JSON.stringify(view)}`);
  }
  cleanup();
  console.log('ok   concurrent registered workers stay isolated and their allowance cannot extend the legacy cap');
}

// ---------------------------------------------------------------- registered counter I/O fails closed

{
  const { home, cleanup } = fakeHome();
  const cwd = root;
  const id = 'bound-counter-unavailable';
  runControl(['register', '--agent-id', id, '--budget', '2'], { home, budget: 3, cwd });
  runHook(subagentCall(id, { cwd }), { home, budget: 3 });
  const roundPath = join(home, '.claude', 'code-ops', 'dispatch', stateKey(cwd), `${stateKey(id)}.rounds`);
  rmSync(roundPath, { force: true });
  mkdirSync(roundPath);
  const unavailable = parseOut(runHook(subagentCall(id, { cwd }), { home, budget: 3 }));
  expect(unavailable?.hookSpecificOutput?.permissionDecision === 'deny' && /counter is unavailable/i.test(unavailable?.hookSpecificOutput?.permissionDecisionReason ?? ''),
    `a registered counter I/O failure must deny instead of bypassing its cap, got ${JSON.stringify(unavailable)}`);
  const receipt = parseOut(runControl(['receipt', '--agent-id', id], { home, cwd }));
  expect(receipt?.measurement?.status === 'UNAVAILABLE' && receipt?.measurement?.calls === 'UNKNOWN',
    `a receipt must report unavailable counter state as UNKNOWN, got ${JSON.stringify(receipt)}`);
  cleanup();
  console.log('ok   a registered counter I/O failure denies and its receipt stays unknown');
}

// ---------------------------------------------------------------- the context ceiling gate

// A one-line Claude transcript whose last assistant usage record sums to `context` tokens.
function transcriptAt(dir, context, name = 'transcript.jsonl') {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({
    type: 'assistant',
    message: { id: 'msg_1', model: 'claude-test', usage: {
      input_tokens: 1000, cache_read_input_tokens: context - 1000, cache_creation_input_tokens: 0, output_tokens: 5,
    } },
  }) + '\n');
  return path;
}

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-ceiling-'));
  const cwd = root;
  const session = 'sess-ceil';
  const clean = { description: 'build it', prompt: 'Scope: one file.\nRound budget: 25 tool rounds', subagent_type: 'code-ops-suite:implementer' };
  const dispatchAt = (context, opts = {}, sessionId = session) => runHook(dispatchCall(clean, {
    cwd, session_id: sessionId, transcript_path: transcriptAt(dir, context, `t-${context}.jsonl`),
  }), { home, ...opts });
  const skillAt = (context, skill) => runHook({
    hook_event_name: 'PreToolUse', cwd, session_id: session, tool_name: 'Skill', tool_use_id: 'tu-3',
    tool_input: { skill, args: 'assess' }, transcript_path: transcriptAt(dir, context, `s-${context}.jsonl`),
  }, { home });

  // Under the ceiling a clean dispatch stays silent; at and past it, it denies.
  let r = dispatchAt(290_000);
  expect(r.status === 0 && r.stdout === '', `a clean dispatch under the ceiling must be silent, got ${JSON.stringify(r.stdout)}`);
  let out = parseOut(dispatchAt(310_000));
  let reason = reasonOf(out) ?? '';
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `a dispatch past the ceiling must deny, got ${JSON.stringify(out)}`);
  expect(/about 10,000 tokens past the 300,000-token context ceiling/.test(reason)
    && reason.includes('/code-ops-suite:handoff assess (CONTINUE, COMPACT, or HANDOFF) before dispatching new work')
    && /unlocks dispatch until the next 150,000-token band/.test(reason),
  `the ceiling reason must name the overage, the assessment, and the band unlock, got ${reason}`);
  expect(reason.includes(`\`node "${hook}" assessed --session ${session} --band 1\`.`),
    `the ceiling reason must carry the exact CLI unlock command, got ${reason}`);
  out = parseOut(dispatchAt(300_000));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `exactly the ceiling must deny, got ${JSON.stringify(out)}`);
  out = parseOut(dispatchAt(310_000, { guard: 'warn' }));
  expect(/context ceiling/.test(contextOf(out) ?? '') && !Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision'),
    `warn mode must downgrade the ceiling deny to an advisory, got ${JSON.stringify(out)}`);

  // A non-handoff skill unlocks nothing; the handoff skill records the band and unlocks it.
  expect(skillAt(310_000, 'code-ops-suite:repo-docs').stdout === '', 'another skill call must stay silent');
  expect(parseOut(dispatchAt(310_000))?.hookSpecificOutput?.permissionDecision === 'deny', 'another skill must not unlock dispatch');
  r = skillAt(310_000, 'code-ops-suite:handoff');
  expect(r.status === 0 && r.stdout === '', `the handoff skill call itself must be silent, got ${JSON.stringify(r.stdout)}`);
  const marker = join(home, '.claude', 'code-ops', 'dispatch', stateKey(cwd), `${stateKey(session)}.assessed.json`);
  let stored = null;
  try { stored = JSON.parse(readFileSync(marker, 'utf8')); } catch { /* checked below */ }
  expect(stored?.version === 1 && stored?.band === 1, `the handoff skill must record band 1, got ${JSON.stringify(stored)}`);
  r = dispatchAt(440_000);
  expect(r.stdout === '', `an assessed band must unlock dispatch until the next band, got ${JSON.stringify(r.stdout)}`);

  // The next 150,000-token band re-gates, with the new band in the unlock command.
  out = parseOut(dispatchAt(460_000));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny' && (reasonOf(out) ?? '').includes(`--session ${session} --band 2`),
    `the next band must re-gate and name band 2, got ${JSON.stringify(out)}`);

  // The CLI verb unlocks from the project root, only ever raises the marker, and validates input.
  r = runControl(['assessed', '--session', session, '--band', '2'], { home, cwd });
  expect(r.status === 0 && r.stdout === '', `the assessed verb must be silent on success, got ${r.status}/${r.stdout}/${r.stderr}`);
  expect(dispatchAt(460_000).stdout === '', 'the CLI assessment must unlock band 2');
  runControl(['assessed', '--session', session, '--band', '1'], { home, cwd });
  expect(dispatchAt(460_000).stdout === '', 'a lower CLI band must never lower the recorded assessment');
  expect(skillAt(310_000, 'code-ops-suite:handoff').stdout === '' && dispatchAt(460_000).stdout === '',
    'a lower handoff-skill band must never lower the recorded assessment');
  for (const args of [
    ['assessed', '--session', session],
    ['assessed', '--session', session, '--band', '0'],
    ['assessed', '--session', session, '--band', 'two'],
    ['assessed', '--session', 'bad session', '--band', '1'],
    ['assessed', '--band', '1'],
  ]) {
    const bad = runControl(args, { home, cwd });
    expect(bad.status === 2 && bad.stderr.trim() === 'dispatch-guard INVALID_ARGUMENT',
      `invalid assessed arguments must fail concisely, got ${bad.status}/${JSON.stringify(bad.stderr)} for ${args.join(' ')}`);
  }

  // A second session in the same project is gated on its own.
  out = parseOut(dispatchAt(460_000, {}, 'sess-other'));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `another session must not inherit an assessment, got ${JSON.stringify(out)}`);

  // CODE_OPS_CONTEXT_CEILING: off values disable, an integer of at least 150,000 overrides, and
  // anything else reads as the 300,000 default.
  for (const value of ['off', '0', 'false', 'OFF']) {
    expect(dispatchAt(900_000, { ceiling: value }, 'sess-env').stdout === '', `CODE_OPS_CONTEXT_CEILING=${value} must disable the gate`);
  }
  expect(dispatchAt(460_000, { ceiling: '500000' }, 'sess-env').stdout === '', 'an overridden ceiling must admit context under it');
  out = parseOut(dispatchAt(510_000, { ceiling: '500000' }, 'sess-env'));
  expect(/about 10,000 tokens past the 500,000-token context ceiling/.test(reasonOf(out) ?? ''), `an overridden ceiling must gate at its own value, got ${JSON.stringify(out)}`);
  out = parseOut(dispatchAt(160_000, { ceiling: '150000' }, 'sess-env'));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `the 150,000 minimum override must gate, got ${JSON.stringify(out)}`);
  for (const value of ['abc', '100000', '2.5', '-400000', '']) {
    out = parseOut(dispatchAt(310_000, { ceiling: value }, 'sess-env'));
    expect(/past the 300,000-token context ceiling/.test(reasonOf(out) ?? ''), `CODE_OPS_CONTEXT_CEILING=${value} must fall back to 300,000, got ${JSON.stringify(out)}`);
    expect(dispatchAt(290_000, { ceiling: value }, 'sess-env').stdout === '', `CODE_OPS_CONTEXT_CEILING=${value} must not gate under 300,000`);
  }

  // The ceiling and a wide type deny together in one reason; the off switch silences both.
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 5', subagent_type: 'general-purpose' }, {
    cwd, session_id: 'sess-both', transcript_path: transcriptAt(dir, 310_000, 'both.jsonl'),
  }), { home }));
  reason = reasonOf(out) ?? '';
  expect(/context ceiling/.test(reason) && /general-purpose/.test(reason), `one deny must carry both reasons, got ${reason}`);
  expect(dispatchAt(900_000, { guard: 'off' }, 'sess-both').stdout === '', 'CODE_OPS_DISPATCH_GUARD=off must silence the ceiling gate');

  // Fail open: unreadable context, an absent or unsafe session id, and subagent calls.
  r = runHook(dispatchCall(clean, { cwd, session_id: session, transcript_path: join(dir, 'missing.jsonl') }), { home });
  expect(r.status === 0 && r.stdout === '', `an unreadable transcript must fail open, got ${JSON.stringify(r.stdout)}`);
  writeFileSync(join(dir, 'no-usage.jsonl'), JSON.stringify({ type: 'user', message: { content: 'hi' } }) + '\n');
  r = runHook(dispatchCall(clean, { cwd, session_id: session, transcript_path: join(dir, 'no-usage.jsonl') }), { home });
  expect(r.status === 0 && r.stdout === '', `a transcript with no usage must fail open, got ${JSON.stringify(r.stdout)}`);
  for (const sessionId of [undefined, 'bad session id', '']) {
    r = runHook(dispatchCall(clean, { cwd, session_id: sessionId, transcript_path: transcriptAt(dir, 900_000, 'big.jsonl') }), { home });
    expect(r.status === 0 && r.stdout === '', `session id ${JSON.stringify(sessionId)} must fail open, got ${JSON.stringify(r.stdout)}`);
  }
  r = runHook(subagentCall('agent-ceil', { tool_name: 'Agent', tool_input: clean, transcript_path: transcriptAt(dir, 900_000, 'big.jsonl') }), { home });
  expect(r.status === 0 && r.stdout === '', `a subagent call must not meet the main-thread ceiling gate, got ${JSON.stringify(r.stdout)}`);

  // Grok: camelCase keys and `spawn_subagent`, whose schema has no agent-type field. The
  // ceiling still gates it; the missing type alone is not a wide-type deny.
  const grokSpawn = (context, sessionId, toolInput = { prompt: 'Round budget: 5' }) => runHook({
    hook_event_name: 'PreToolUse', hookEventName: 'pre_tool_use', sessionId, cwd,
    toolName: 'spawn_subagent', toolInput, transcriptPath: transcriptAt(dir, context, `g-${context}.jsonl`),
  }, { home });
  out = parseOut(grokSpawn(310_000, 'sess-grok'));
  reason = reasonOf(out) ?? '';
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny' && /context ceiling/.test(reason) && !/unnamed type/i.test(reason),
    `a Grok spawn past the ceiling must deny on the ceiling alone, got ${JSON.stringify(out)}`);
  r = grokSpawn(290_000, 'sess-grok');
  expect(r.status === 0 && r.stdout === '', `a Grok spawn with no agent type under the ceiling must be silent, got ${JSON.stringify(r.stdout)}`);
  out = parseOut(grokSpawn(290_000, 'sess-grok', { prompt: 'Round budget: 5', subagent_type: 'general-purpose' }));
  expect(/general-purpose/.test(reasonOf(out) ?? ''), `a Grok spawn naming a wide type must still deny, got ${JSON.stringify(out)}`);
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 5' }, { cwd, session_id: session, transcript_path: transcriptAt(dir, 290_000, 'claude.jsonl') }), { home }));
  expect(/unnamed type/i.test(reasonOf(out) ?? ''), `a Claude Agent call with no subagent_type must still deny, got ${JSON.stringify(out)}`);

  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   the context ceiling denies dispatch until a handoff assessment records the band, and each switch behaves');
}

// ---------------------------------------------------------------- Grok: host ceiling and child-session counter

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-grok-'));
  const cwd = root;
  // Grok's session log: cumulative usage snapshots whose inputTokens is the resident context.
  const updatesAt = (context) => {
    mkdirSync(join(dir, String(context)), { recursive: true });
    const path = join(dir, String(context), 'updates.jsonl');
    writeFileSync(path, JSON.stringify({ timestamp: 1, params: { update: { prompt_id: 'p1', usage: {
      inputTokens: context, cachedReadTokens: 10, cacheCreationTokens: 0, outputTokens: 5, totalTokens: context + 5,
    } } } }) + '\n');
    return path;
  };
  const spawnAt = (context, opts = {}) => runHook({
    hook_event_name: 'PreToolUse', hookEventName: 'pre_tool_use', sessionId: 'sess-grok-host', cwd,
    toolName: 'spawn_subagent', toolInput: { prompt: 'Round budget: 5' }, transcriptPath: updatesAt(context),
  }, { home, grok: true, ...opts });

  // Grok bills double above 200,000 tokens, so its default ceiling sits there; the override wins.
  let out = parseOut(spawnAt(210_000));
  expect(/about 10,000 tokens past the 200,000-token context ceiling/.test(reasonOf(out) ?? ''),
    `a Grok spawn past 200,000 must deny at the Grok ceiling, got ${JSON.stringify(out)}`);
  let r = spawnAt(190_000);
  expect(r.status === 0 && r.stdout === '', `a Grok spawn under 200,000 must be silent, got ${JSON.stringify(r.stdout)}`);
  expect(spawnAt(210_000, { ceiling: '300000' }).stdout === '', 'CODE_OPS_CONTEXT_CEILING must override the Grok default');
  const lib = await import(pathToFileURL(join(root, 'scripts', 'transcript-lib.mjs')).href);
  expect(lib.contextCeiling('', true) === 200_000 && lib.contextCeiling('', false) === 300_000
    && lib.contextCeiling('250000', true) === 250_000 && lib.contextCeiling('off', true) === null,
  'contextCeiling must default to 200,000 on Grok, 300,000 elsewhere, and honour the override');

  // No agent_id on Grok: a subagent's tool call carries subagentType and its child sessionId,
  // which keys the round counter; the main thread (no subagentType) is never counted.
  const budget = 2;
  const childCall = (sessionId) => runHook({
    hook_event_name: 'PreToolUse', hookEventName: 'pre_tool_use', sessionId, cwd, subagentType: 'code-ops-suite-implementer',
    toolName: 'read_file', toolInput: { path: 'a.txt' },
  }, { home, budget, grok: true });
  const seen = [];
  for (let i = 0; i < budget * 2; i++) seen.push(parseOut(childCall('child-1')));
  expect(/2 tool rounds used against a 2-round budget/.test(contextOf(seen[budget - 1]) ?? ''),
    `a Grok subagent must warn at its budget, got ${JSON.stringify(seen[budget - 1])}`);
  expect(seen[budget * 2 - 1]?.hookSpecificOutput?.permissionDecision === 'deny',
    `a Grok subagent must stop at twice its budget, got ${JSON.stringify(seen[budget * 2 - 1])}`);
  expect(childCall('child-2').stdout === '', 'another Grok subagent must keep its own counter');
  for (let i = 0; i < budget * 2; i++) {
    r = runHook({ hook_event_name: 'PreToolUse', sessionId: 'main-grok', cwd, toolName: 'read_file', toolInput: {} }, { home, budget, grok: true });
    expect(r.stdout === '', `a Grok main-thread tool call must never be counted, got ${JSON.stringify(r.stdout)}`);
  }

  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   Grok gates at its 200,000-token ceiling and counts rounds per child session');
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
