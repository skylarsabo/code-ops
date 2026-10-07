#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/dispatch-guard.mjs, the default-on
// PreToolUse backstop for the brief's Round budget and for two dispatch-level context leaks.
// It pins the contract the hook promises:
//   - a main-thread tool call that is not a dispatch is silent, whatever the tool;
//   - inside a subagent (`agent_id` present) the hook counts tool calls, stays silent under the
//     budget, warns exactly at the budget and at every further 20 rounds, and names both the
//     rounds used, the call the stop lands on, and the checkpoint-and-return instruction: start
//     no new edit, settle the partial one, and write done items, each dirty path marked complete
//     or partial, the exact next edit, and gates run to the Report path;
//   - at 1.5 times the budget, rounded down and at least one call past the budget, it denies
//     with a reason telling the operative to report now with that checkpoint (the old 2x call is
//     no longer the stop), and
//     `CODE_OPS_DISPATCH_GUARD=warn` lifts only that hard stop;
//   - concurrent subagents never share a counter, and `CODE_OPS_ROUND_BUDGET` overrides 40;
//   - the `Round budget:` line of the subagent's brief, the first line of its own transcript,
//     binds its counter (60 warns at 60 and 80 and stops at 90), clamps above 120 with one advisory,
//     falls back on zero or conflicting values with an advisory, and keeps the default without a
//     line or a readable transcript; later transcript text never moves the cached value, and a
//     controller binding outranks the brief;
//   - a dispatch (tool_name Agent, and legacy Task) with a wide-surface, context-inheriting, or
//     missing type is denied unless the brief carries a "Wide-surface reason:" line, and a
//     Workflow script is checked per agent() call (an untyped or wide-typed call denies even beside
//     a typed one, the denial names the failing count and the first call), a literal effort of
//     xhigh or max denies with no reason escape, an options variable is an advisory, a parse
//     surprise falls back to the script-wide test, and a mutant that reverts to it fails; a `model`
//     override (naming the agent's declared tier when a definition declares one) and a prompt
//     with no Round budget stay advisory clauses in the same output, and warn mode downgrades
//     every denial to an advisory;
//   - a dispatch to a suite agent (`<plugin>:<agent>` in any of the four plugins, resolved in the
//     repo layout and the installed cache layout) whose prompt lacks a field its `## Contract`
//     `Brief requires:` line lists is denied, warn mode downgrades it, and unknown, bare,
//     non-suite, and contract-less agents pass; the denial names the exact `co brief <type>`
//     command and opens with one `Label:` line per missing field, and with every field missing
//     those lines equal the template `co brief` prints;
//   - a malformed controller binding and an unavailable bound counter deny with the fix: report
//     now, then re-dispatch under a new agent id bound by the exact `register` command;
//   - a dispatch that names a narrow agent, no model, and a complete brief is silent;
//   - at and past the context ceiling (300,000 by default, CODE_OPS_CONTEXT_CEILING overrides
//     or disables it), a main-thread dispatch is denied until a handoff Skill call or the
//     `assessed` CLI verb records the current 150,000-token band, and the next band re-gates;
//   - an edit tool (Write, Edit, NotebookEdit, apply_patch, a camelCase search_replace) whose target
//     lies under a manifest `removed` legacy path is denied with the root and the FORWARDING.json
//     location; relocated roots, prefix siblings, outside paths, and every non-edit tool pass; the
//     off values of `CODE_OPS_LEGACY_PATHS` and the whole-hook switch silence it, `warn` makes it
//     advisory, a denied subagent call counts a round, and a corrupt, wrong-version, or absent
//     manifest fails open;
//   - the off switch silences every branch, and bad JSON, another event name, empty stdin, and a
//     missing agent id all fail open with no output and exit 0.
//
//   node evals/dispatch-guard/run.mjs

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repoIdentity } from '../../scripts/handoff-state.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const suite = join(root, 'plugins', 'code-ops-suite');
const hook = join(suite, 'hooks', 'dispatch-guard.mjs');

const { fails, expect } = tally();

// Each case gets its own fake HOME so the round counters never touch the real operator's
// `~/.claude/code-ops/dispatch/`, the isolation evals/handoff-card/run.mjs uses for its markers.
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dispatch-home-'));
  return { home, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

// Every hook run below writes its decision rows beside this receipts path, so the last section can
// compare the rows with the outputs the cases saw.
const rowsDir = mkdtempSync(join(tmpdir(), 'guard-rows-'));
const receiptsFile = join(rowsDir, 'session-receipts.jsonl');
const rowsFile = join(rowsDir, 'guard-decisions.jsonl');
let expectedRows = 0;

// True for a PreToolUse output that denies or advises, the outputs that earn one row.
function decides(stdout) {
  try {
    const out = JSON.parse(stdout)?.hookSpecificOutput;
    return out?.hookEventName === 'PreToolUse' && (out.permissionDecision === 'deny' || (typeof out.additionalContext === 'string' && out.additionalContext !== ''));
  } catch { return false; }
}

function runHook(payload, { home, guard, budget, ceiling, grok = false, pluginRoot = suite, env: extra = {} } = {}) {
  const env = { ...process.env };
  delete env.CODE_OPS_DISPATCH_GUARD;
  delete env.CODE_OPS_ROUND_BUDGET;
  delete env.CODE_OPS_CONTEXT_CEILING;
  delete env.GROK_PLUGIN_ROOT;
  delete env.CODE_OPS_LEGACY_PATHS;
  env.CODE_OPS_RECEIPTS = receiptsFile;
  Object.assign(env, extra);
  if (guard !== undefined) env.CODE_OPS_DISPATCH_GUARD = guard;
  if (ceiling !== undefined) env.CODE_OPS_CONTEXT_CEILING = ceiling;
  if (budget !== undefined) env.CODE_OPS_ROUND_BUDGET = String(budget);
  if (grok) env.GROK_PLUGIN_ROOT = pluginRoot;
  if (home) { env.HOME = home; env.USERPROFILE = home; }
  env.CLAUDE_PLUGIN_ROOT = pluginRoot;
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync('node', [hook], { input, encoding: 'utf8', env });
  if (env.CODE_OPS_RECEIPTS === receiptsFile && decides(result.stdout)) expectedRows++;
  return result;
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

// A `Run contract:` comment line over a contract file in `home` that parses as JSON with a runId,
// so a Workflow case with two or more agent() calls reaches the contract check with the line present.
function contractLine(home, body = { runId: 'run-1' }, name = 'RUN_CONTRACT.json') {
  const file = join(home, name);
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
  return `// Run contract: ${file}`;
}

// A brief that carries every field the suite agents' `Brief requires:` lines name.
const FULL_BRIEF = 'Scope: one file.\nObjective: fix it.\nRound budget: 25 tool rounds\n'
  + 'Report cap: 200 words.\nReport path: r.md\nExpected return: a verdict line.\n'
  // Routing lines from `co route --kind judgment --ambiguity h --reversible yes --agent code-ops-suite:implementer`.
  + 'Unit: fix-one-file\nTier: strong\nEffort: high\nRoute basis: judgment; surface=none; ambiguity=high; reversible=yes';

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

  // The budget-round checkpoint line arrives exactly once before the stop.
  expect(outputs.slice(0, 5).filter((out) => contextOf(out)).length === 1,
    `the checkpoint line must arrive once before the stop, got ${JSON.stringify(outputs.slice(0, 5))}`);

  // At 1.5 times the budget (call 6), and not one round earlier: deny, with a reason that tells
  // the operative to report now. The old stop at twice the budget (call 8) is not the first deny.
  const firstDeny = outputs.findIndex((out) => out?.hookSpecificOutput?.permissionDecision === 'deny') + 1;
  expect(firstDeny === 6 && firstDeny !== budget * 2, `the first deny must land on call 6, not the old 2x call 8, got call ${firstDeny}`);
  const stop = outputs[5];
  const hso = stop && stop !== 'unparsable' ? stop.hookSpecificOutput ?? {} : {};
  expect(hso.permissionDecision === 'deny', `1.5 times the budget must deny, got ${JSON.stringify(stop)}`);
  expect(/6 tool rounds used, the hard stop at 1\.5 times the 4-round budget, rounded down/.test(hso.permissionDecisionReason ?? ''),
    `the stop reason must cite the 1.5x multiple, got ${hso.permissionDecisionReason}`);
  expect(typeof hso.permissionDecisionReason === 'string' && /report now/i.test(hso.permissionDecisionReason),
    `the deny reason must tell the operative to return its report now, got ${hso.permissionDecisionReason}`);
  expect(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(JSON.stringify(outputs)), 'no hook output carries an emoji');
  cleanup();
  console.log('ok   under the budget is silent, the budget round warns once, and 1.5 times the budget denies');

  // The warning asks for a written checkpoint before the stop, and the stop requires the same
  // checkpoint in the final report, so a stopped operative never leaves unrecorded dirty work.
  const checkpointFields = [/each dirty \(uncommitted\) path marked complete or partial/, /exact next edit/, /each gate run with its result/, /file:line/];
  for (const field of checkpointFields) {
    expect(field.test(atBudget ?? ''), `the warning must require the checkpoint field ${field}, got ${atBudget}`);
    expect(field.test(hso.permissionDecisionReason ?? ''), `the stop must require the checkpoint field ${field}, got ${hso.permissionDecisionReason}`);
  }
  expect(/Start no new edit/.test(atBudget ?? '') && /Finish or revert the partial edit/.test(atBudget ?? ''),
    `the warning must stop new edits and settle the partial one, got ${atBudget}`);
  expect(/write a checkpoint to the brief's Report path \(or the run folder\)/.test(atBudget ?? ''),
    `the warning must direct the checkpoint to the Report path before the stop, got ${atBudget}`);
  expect((atBudget ?? '').includes('hard stop denies every tool call from call 6'),
    `the warning must name the call the stop lands on, got ${atBudget}`);
  expect(/Make no further edits/.test(hso.permissionDecisionReason ?? '') && /checkpoint/.test(hso.permissionDecisionReason ?? ''),
    `the stop must forbid further edits and name the checkpoint, got ${hso.permissionDecisionReason}`);
  console.log('ok   the warning requires a written checkpoint before the stop, and the stop requires it in the report');
}

// The default 40-round budget warns once at 40 and stops at 60, before a 20-round repeat.
{
  const { home, cleanup } = fakeHome();
  const warned = [];
  const denied = [];
  for (let i = 1; i <= 61; i++) {
    const out = parseOut(runHook(subagentCall('agent-B'), { home }));
    if (contextOf(out)) warned.push(i);
    if (out?.hookSpecificOutput?.permissionDecision === 'deny') denied.push(i);
  }
  expect(JSON.stringify(warned) === JSON.stringify([40]), `the default budget must warn at 40 only, got ${JSON.stringify(warned)}`);
  expect(JSON.stringify(denied) === JSON.stringify([60, 61]), `the default budget must deny from call 60, got ${JSON.stringify(denied)}`);
  cleanup();
  console.log('ok   the default 40-round budget warns once at 40 and denies from call 60');
}

// A fractional 1.5x product rounds down, and the stop always lands past the budget round.
{
  const { home, cleanup } = fakeHome();
  for (const [budget, stopAt] of [[3, 4], [5, 7], [1, 2]]) {
    const id = `agent-round-${budget}`;
    const outs = [];
    for (let i = 1; i <= stopAt; i++) outs.push(parseOut(runHook(subagentCall(id), { home, budget })));
    const firstDeny = outs.findIndex((out) => out?.hookSpecificOutput?.permissionDecision === 'deny') + 1;
    expect(firstDeny === stopAt, `a ${budget}-round budget must first deny at call ${stopAt}, got ${firstDeny}`);
    expect(/checkpoint/.test(contextOf(outs[budget - 1]) ?? '') && (contextOf(outs[budget - 1]) ?? '').includes(`from call ${stopAt}`),
      `a ${budget}-round budget must warn at its budget and name stop call ${stopAt}, got ${JSON.stringify(outs[budget - 1])}`);
    expect(outs.slice(0, budget - 1).every((out) => out === null), `a ${budget}-round budget must be silent below the budget`);
  }
  cleanup();
  console.log('ok   the 1.5x stop rounds down (3 -> 4, 5 -> 7) and stays one past a 1-round budget');
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
  expect(!/hard stop/.test(contextOf(outputs[budget - 1]) ?? '') && /checkpoint/.test(contextOf(outputs[budget - 1]) ?? ''),
    `warn mode has no stop to name but still asks for the checkpoint, got ${contextOf(outputs[budget - 1])}`);
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
  expect(!/model override/i.test(text ?? ''), `the blanket model-override advisory is gone, got ${text}`);
  expect(/general-purpose/.test(text ?? '') && /code-ops-suite:implementer/.test(text ?? '') && /Wide-surface reason: <why>/.test(text ?? ''),
    `the reason must flag the wide type, name the narrow choice, and name the escape line, got ${text}`);
  expect(/Round budget/.test(text ?? '') && /warns at 40 rounds, stops at 60\./.test(text ?? '') && !/80|120/.test(text ?? ''),
    `the reason must flag the missing Round budget and name both limits at 1.5x, got ${text}`);
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
  expect(!Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision') && !/model override/i.test(text) && /No Round budget/.test(text) && !/general-purpose/.test(text),
    `a stated Wide-surface reason must allow the dispatch and drop the wide clause, got ${JSON.stringify(out)}`);
  out = parseOut(runHook(dispatchCall({ ...leaky, prompt: 'Fix the parser.\nWide-surface reason:\n' }), { home }));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `an empty Wide-surface reason must still deny, got ${JSON.stringify(out)}`);
  out = parseOut(runHook(dispatchCall({ ...leaky, prompt: 'Round budget: 5\n  Wide-surface reason: indented' }), { home }));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `the reason must start its own line, got ${JSON.stringify(out)}`);

  // The blanket override advisory is deleted: an override on an agent with no Tier requirement
  // passes silently, whatever the agent's declared tier, and so does one on an unreadable definition.
  let quiet = runHook(dispatchCall({ prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:explorer', model: 'opus' }), { home });
  expect(quiet.status === 0 && quiet.stdout === '', `an override on a narrow agent with a budget must be silent, got ${JSON.stringify(quiet.stdout)}`);
  quiet = runHook(dispatchCall({ prompt: 'Round budget: 20 rounds', subagent_type: 'no-such-agent', model: 'opus' }), { home, pluginRoot: join(home, 'missing') });
  expect(quiet.status === 0 && quiet.stdout === '', `an override on a missing definition must be silent, got ${JSON.stringify(quiet.stdout)}`);

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

  // Workflow, per call: each agent() call is checked on its own, so one typed call no longer
  // covers an untyped one; a literal effort above high is denied with no reason escape.
  const typed = "agent({ agentType: 'code-ops-suite:explorer', prompt: 'scan' })";
  const untyped = "agent({ prompt: `look ${path} over`, effort: 'high' })";
  const denies = (script, pattern, label, guard) => {
    const res = workflow(script, guard);
    expect(res?.hookSpecificOutput?.permissionDecision === 'deny' && pattern.test(reasonOf(res) ?? ''),
      `${label}: must deny matching ${pattern}, got ${JSON.stringify(res)}`);
  };
  const silent = (script, label) => {
    const r = runHook(dispatchCall({ script }, { tool_name: 'Workflow' }), { home });
    expect(r.status === 0 && r.stdout === '', `${label}: must be silent, got ${JSON.stringify(r.stdout)}`);
  };
  denies(`${typed};\n${untyped};`, /1 of 2 Workflow agent\(\) calls.*first is call 2/, 'one typed and one untyped call');
  denies(`${untyped};\n${typed};\n${untyped};`, /2 of 3 Workflow agent\(\) calls.*first is call 1/, 'two untyped calls name the count and the first');
  const contract = contractLine(home);
  silent(`${contract}\n${typed};\nawait agent({ agentType: "rigor:tracer", prompt: 'x' });`, 'two typed calls');
  denies("agent({ agentType: 'general-purpose', prompt: 'x' });", /1 of 1 .*first is call 1/, 'a wide literal agentType');
  denies("agent({ agentType: \"code-ops-suite:Fork\", prompt: 'x' });", /first is call 1/, 'a wide literal agentType after a plugin prefix, any case');
  silent(`${contract}\n// Wide-surface reason: needs browser tools\n${untyped};\nagent({ agentType: 'claude' });`, 'a Wide-surface reason');
  silent(`${contract}\nagent({ agentType: kind, prompt: 'x' }); agent({ agentType, prompt: 'x' });`, 'a variable agentType');
  silent("agent({ prompt: 'agent({ in a string', agentType: 'code-ops-suite:probe', nested: { agentType: 'fork' } });", 'agentType read at the top level of the options only');
  for (const effort of ["'max'", '"xhigh"', '`max`']) {
    const script = `agent({ agentType: 'code-ops-suite:reviewer', effort: ${effort} });`;
    denies(script, /call 1 sets an effort above high/, `literal effort ${effort}`);
    denies(`// Wide-surface reason: wide on purpose\n${script}`, /call 1 sets an effort above high/, `literal effort ${effort} with a reason line`);
  }
  denies(`${typed};\nagent({ agentType: 'code-ops-suite:reviewer', effort: 'max' });`, /call 2 sets an effort above high \(1 of 2/, 'effort names its own call');
  silent("agent({ agentType: 'code-ops-suite:reviewer', effort: 'high' });", "literal effort 'high'");
  // A non-literal model or effort cannot be checked against the floor or the ceiling: advisory, never a denial.
  const nonLiteral = (script, label) => {
    const res = workflow(script);
    expect(!Object.hasOwn(res?.hookSpecificOutput ?? {}, 'permissionDecision') && /1 of 1 Workflow agent\(\) calls pass a model or effort that is not a literal string/.test(contextOf(res) ?? ''),
      `${label}: must earn the non-literal advisory and no denial, got ${JSON.stringify(res)}`);
  };
  nonLiteral("agent({ agentType: 'code-ops-suite:reviewer', effort: level });", 'a variable effort');
  nonLiteral("agent({ agentType: 'code-ops-suite:reviewer', prompt: 'max', effort });", 'a shorthand effort');
  nonLiteral("agent({ agentType: 'code-ops-suite:reviewer', model: pick });", 'a variable model');
  out = workflow(`const opts = { prompt: 'x' };\nawait agent(opts);\n${typed};`);
  expect(!Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision') && /1 of 2 Workflow agent\(\) calls pass options the guard cannot read/.test(contextOf(out) ?? ''),
    `an options variable earns an advisory and no denial, got ${JSON.stringify(out)}`);
  out = workflow("agent({ ...base, prompt: 'x' });");
  expect(!Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision') && /cannot read/.test(contextOf(out) ?? ''),
    `a spread without agentType earns an advisory, got ${JSON.stringify(out)}`);
  // Warn mode downgrades both per-call denials to context.
  for (const script of [`${typed};\n${untyped};`, "agent({ agentType: 'code-ops-suite:reviewer', effort: 'max' });"]) {
    out = workflow(script, 'warn');
    expect(Object.hasOwn(out?.hookSpecificOutput ?? {}, 'additionalContext') && !Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision'),
      `warn mode must downgrade the per-call Workflow denial, got ${JSON.stringify(out)}`);
  }
  // A parse surprise falls back to the script-wide test: an unclosed options literal.
  denies("agent({ prompt: 'never closed", /no agentType/, 'an unparsable script with no agentType falls back to the script-wide deny');
  silent("agent({ agentType: 'code-ops-suite:probe', prompt: 'never closed", 'an unparsable script with an agentType falls back to pass');
  // Run contract advisory: two or more agent() calls, or any call the guard cannot read, without a
  // readable `Run contract:` line earn one advisory that states the call count against the guideline of
  // 10 and the calls with no effort. It never denies; a one-call script, a parse failure, and a
  // script with a readable contract stay silent.
  const advises = (script, pattern, label, extra = {}) => {
    const res = parseOut(runHook(dispatchCall({ script }, { tool_name: 'Workflow', ...extra }), { home }));
    expect(!Object.hasOwn(res?.hookSpecificOutput ?? {}, 'permissionDecision') && pattern.test(contextOf(res) ?? ''),
      `${label}: must advise matching ${pattern} and not deny, got ${JSON.stringify(res)}`);
  };
  const effortCall = (n) => `agent({ agentType: 'code-ops-suite:explorer', effort: 'medium', prompt: '${n}' })`;
  const NO_LINE = /has no script-wide "Run contract: <path>" line; add that line naming the run's RUN_CONTRACT\.json\. It is never denied\./;
  const BAD_LINE = /"Run contract: <path>" line names a file that is missing or is not JSON with a runId/;
  advises(`${typed};\n${typed};`, /makes 2 agent\(\) call\(s\) against the guideline of 10, 2 of them set no effort, and it /, 'two calls with no line state the count and the missing effort');
  advises(`${typed};\n${typed};`, NO_LINE, 'two calls with no line name the missing line');
  advises(`${effortCall(1)};\n${typed};`, /makes 2 .*, 1 of them set no effort/, 'one of two calls sets an effort');
  const eleven = Array.from({ length: 11 }, (_, i) => effortCall(i)).join(';\n');
  advises(eleven, /makes 11 agent\(\) call\(s\) against the guideline of 10, 0 of them set no effort/, 'eleven calls, none without effort');
  advises("const opts = { prompt: 'x' };\nawait agent(opts);", /makes 1 agent\(\) call\(s\).*"Run contract: <path>" line/, 'one unreadable call with no line');
  silent(typed, 'one readable call needs no line');
  silent(`${contract}\n${eleven}`, 'eleven calls with a readable contract');
  silent(`${typed};\nagent({ agentType: 'code-ops-suite:probe', prompt: 'never closed`, 'a parse failure with two calls is unchanged');
  // The line is script-wide: a comment or a bare line counts, a string that merely contains it does not.
  const file = contract.slice('// Run contract: '.length);
  for (const line of [`Run contract: ${file}`, `/* Run contract: ${file} */`, ` * Run contract: ${file}`, `\t// Run contract: ${file}  `]) {
    silent(`${line}\n${typed};\n${typed};`, `the line form ${JSON.stringify(line.replace(file, '<file>'))}`);
  }
  advises(`const s = "Run contract: ${file.replace(/\\/g, '/')}";\n${typed};\n${typed};`, NO_LINE, 'a string holding the line does not count');
  // With the line present only the path is checked: it must exist and parse as JSON with a runId.
  advises(`// Run contract: ${join(home, 'missing.json')}\n${typed};\n${typed};`, BAD_LINE, 'a path that does not exist');
  advises(`${contractLine(home, { head: 'abc' }, 'norun.json')}\n${typed};\n${typed};`, BAD_LINE, 'a contract with no runId');
  advises(`${contractLine(home, { runId: '' }, 'emptyrun.json')}\n${typed};\n${typed};`, BAD_LINE, 'a contract with an empty runId');
  advises(`${contractLine(home, 'not json {', 'notjson.json')}\n${typed};\n${typed};`, BAD_LINE, 'a contract that is not JSON');
  advises(`// Run contract: ${home}\n${typed};\n${typed};`, BAD_LINE, 'a directory');
  // A relative path resolves against the session directory.
  advises(`// Run contract: RUN_CONTRACT.json\n${typed};\n${typed};`, BAD_LINE, 'a relative path with the wrong session directory');
  const relative = runHook(dispatchCall({ script: `// Run contract: RUN_CONTRACT.json\n${typed};\n${typed};` }, { tool_name: 'Workflow', cwd: home }), { home });
  expect(relative.status === 0 && relative.stdout === '', `a relative path must resolve against the session cwd, got ${JSON.stringify(relative.stdout)}`);
  console.log('ok   the Workflow run contract advisory states the count and no-effort calls, checks only the path, and never denies');
  // Mutation: a hook that reverts to the script-wide test must pass the mixed script, and so fail the case above.
  const mutantDir = join(home, 'mutant');
  mkdirSync(mutantDir);
  const source = readFileSync(hook, 'utf8');
  const mutated = source.replace('const calls = workflowCalls(script);', 'const calls = null;');
  expect(mutated !== source, 'the mutation must change the hook source');
  writeFileSync(join(mutantDir, 'dispatch-guard.mjs'), mutated);
  writeFileSync(join(mutantDir, 'agent-file.mjs'), readFileSync(join(suite, 'hooks', 'agent-file.mjs'), 'utf8'));
  const mutant = spawnSync('node', [join(mutantDir, 'dispatch-guard.mjs')], {
    input: JSON.stringify(dispatchCall({ script: `${typed};\n${untyped};` }, { tool_name: 'Workflow' })),
    encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home, CODE_OPS_DISPATCH_GUARD: '' },
  });
  expect(mutant.status === 0 && mutant.stdout === '', `the script-wide mutant must let a mixed script through, got ${JSON.stringify(mutant.stdout)}`);
  console.log('ok   a Workflow is checked per agent() call, effort above high denies, an options variable is an advisory, and the script-wide mutant fails');

  // A clean dispatch: narrow agent, no override, a Round budget in the brief.
  const clean = runHook(dispatchCall({ description: 'build it', prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:implementer', effort: 'high' }), { home });
  expect(clean.status === 0 && clean.stdout === '', `a clean dispatch must be silent, got ${clean.status}/${JSON.stringify(clean.stdout)}`);
  cleanup();
  console.log('ok   a wide dispatch denies unless it states a reason, warn downgrades it, and a clean dispatch is silent');
}

// ---------------------------------------------------------------- brief contract fields

{
  const { home, cleanup } = fakeHome();
  const deny = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';
  const brief = (drop) => FULL_BRIEF.split('\n').filter((line) => !line.startsWith(drop)).join('\n');

  // A missing field denies and names it; the other fields are not named.
  let out = parseOut(runHook(dispatchCall({ prompt: brief('Report path'), subagent_type: 'code-ops-suite:implementer', effort: 'high' }), { home }));
  let text = reasonOf(out) ?? '';
  expect(deny(out) && /missing: Report path;/.test(text) && /code-ops-suite:implementer Contract/.test(text),
    `a brief missing a Contract field must deny and name it, got ${JSON.stringify(out)}`);
  // The denial opens with a skeleton of only the missing labels, one per line, and names the
  // exact `co brief <type>` command for the full template. The labels lead because Grok keeps
  // the start of a denial and drops the tail.
  expect(text.startsWith('Report path:\n') && text.split('\n').length === 2,
    `the field denial must open with one skeleton line per missing label, got ${JSON.stringify(text)}`);
  expect(text.includes(`"${join(suite, 'scripts', 'co.mjs')}" brief code-ops-suite:implementer\``),
    `the field denial must name the exact co brief command, got ${JSON.stringify(text)}`);

  // With every field missing, the skeleton is the full template `co brief` prints, in contract
  // order, and the Round budget advisory does not split it.
  out = parseOut(runHook(dispatchCall({ prompt: 'no labels here', subagent_type: 'code-ops-suite:implementer', model: 'x' }), { home }));
  const template = spawnSync('node', [join(root, 'scripts', 'co.mjs'), 'brief', 'code-ops-suite:implementer'], { encoding: 'utf8' });
  // `co brief` follows its label lines with a legend and a `co route` hint; the denial carries the labels only.
  const templateLabels = template.stdout.split('\n').filter((line) => /^[A-Z][A-Za-z ]*:$/.test(line)).join('\n');
  const skeleton = (reasonOf(out) ?? '').split('\n').slice(0, -1).join('\n');
  expect(deny(out) && template.status === 0 && skeleton === templateLabels
    && skeleton === 'Scope:\nObjective:\nRound budget:\nReport cap:\nReport path:\nExpected return:\nUnit:\nTier:\nEffort:\nRoute basis:',
    `the full skeleton must equal co brief's label lines, got ${JSON.stringify(skeleton)} vs ${JSON.stringify(template.stdout)}`);
  // An advisory-only output carries no skeleton.
  out = parseOut(runHook(dispatchCall({ prompt: 'Fix it.', subagent_type: 'code-ops-suite:no-such-agent' }), { home }));
  expect(!deny(out) && /No Round budget/.test(contextOf(out) ?? '') && !(contextOf(out) ?? '').includes('\n'),
    `an advisory-only dispatch must carry no skeleton, got ${JSON.stringify(out)}`);

  // Every field present passes, including loose forms: case, bold, a parenthetical, list
  // markers, leading whitespace, and a markdown heading.
  const loose = 'scope (edit authority): one file.\n## Objective\nfix it.\n**Round budget:** 10\n'
    + '- Report cap: 100 words.\n  1. Report path: r.md\n* EXPECTED RETURN: a line.\n'
    + '**Unit:** loose-unit\n- TIER: strong\n  effort (high only): high\n1. Route basis: judgment; surface=none; ambiguity=high; reversible=yes';
  let r = runHook(dispatchCall({ prompt: loose, subagent_type: 'code-ops-suite:implementer', effort: 'high' }), { home });
  expect(r.status === 0 && r.stdout === '', `a brief with every field in loose form must pass, got ${JSON.stringify(r.stdout)}`);

  // A label inside a longer word, or with no colon, does not count.
  out = parseOut(runHook(dispatchCall({ prompt: brief('Scope').replace('Objective:', 'Microscope: x\nObjective is'), subagent_type: 'code-ops-suite:implementer', effort: 'high' }), { home }));
  expect(deny(out) && /missing: Scope, Objective;/.test(reasonOf(out) ?? ''), `an embedded or colonless label must not count, got ${JSON.stringify(out)}`);

  // The label must start its line: `Out of scope:`, an inline mid-sentence `Scope:`, and a
  // field placed after another field on the same line do not count.
  for (const [label, line] of [
    ['Out of scope', 'Out of scope: docs'],
    ['mid-sentence', 'Edit only the files relevant to Scope: a path'],
    ['after another field', 'Objective: fix it. Scope: one file.'],
  ]) {
    out = parseOut(runHook(dispatchCall({ prompt: `${brief('Scope')}\n${line}`, subagent_type: 'code-ops-suite:implementer', effort: 'high' }), { home }));
    expect(deny(out) && /missing: Scope;/.test(reasonOf(out) ?? ''), `${label} must not satisfy Scope, got ${JSON.stringify(out)}`);
  }
  // A bold list item with a parenthetical, and a heading, do count.
  for (const line of ['- **Scope (edit authority):** x', '## Scope']) {
    r = runHook(dispatchCall({ prompt: `${brief('Scope')}\n${line}`, subagent_type: 'code-ops-suite:implementer', effort: 'high' }), { home });
    expect(r.status === 0 && r.stdout === '', `${JSON.stringify(line)} must satisfy Scope, got ${JSON.stringify(r.stdout)}`);
  }

  // A field denial that names Round budget carries no separate Round budget advisory.
  out = parseOut(runHook(dispatchCall({ prompt: brief('Round budget'), subagent_type: 'code-ops-suite:implementer', effort: 'high' }), { home }));
  text = reasonOf(out) ?? '';
  expect(deny(out) && /missing: Round budget;/.test(text) && !/No Round budget/.test(text),
    `a Round budget field denial must not repeat as an advisory, got ${JSON.stringify(out)}`);

  // Warn mode downgrades the denial to an advisory.
  out = parseOut(runHook(dispatchCall({ prompt: brief('Objective'), subagent_type: 'code-ops-suite:implementer', effort: 'high' }), { home, guard: 'warn' }));
  expect(!deny(out) && /missing: Objective;/.test(contextOf(out) ?? '') && (contextOf(out) ?? '').startsWith('Objective:\n'),
    `warn mode must downgrade the field denial and keep its skeleton, got ${JSON.stringify(out)}`);

  // A sibling plugin's agent resolves from the repo layout.
  out = parseOut(runHook(dispatchCall({ prompt: brief('Scope'), subagent_type: 'rigor:tracer' }), { home }));
  expect(deny(out) && /rigor:tracer Contract.*missing: Scope;/.test(reasonOf(out) ?? ''), `rigor:tracer must resolve across plugins, got ${JSON.stringify(out)}`);
  r = runHook(dispatchCall({ prompt: FULL_BRIEF, subagent_type: 'researcher:gatherer' }), { home });
  expect(r.stdout === '', `a complete brief to researcher:gatherer must pass, got ${JSON.stringify(r.stdout)}`);

  // Unknown, bare, and non-suite types pass unchanged.
  for (const type of ['code-ops-suite:no-such-agent', 'implementer', 'other-plugin:implementer', 'rigor:../tracer']) {
    r = runHook(dispatchCall({ prompt: 'Round budget: 5', subagent_type: type }), { home });
    expect(r.stdout === '', `${type} must pass with no contract check, got ${JSON.stringify(r.stdout)}`);
  }

  // The installed cache layout: sibling plugins at <marketplace>/<plugin>/<version>/, the
  // highest numeric version wins (10.0.0 over 9.0.0, which a string sort would pick), and an
  // agent without a Contract passes.
  const cache = join(home, 'cache', 'code-ops');
  const suiteRoot = join(cache, 'code-ops-suite', '2.0.0');
  const agent = (plugin, version, name, body) => {
    mkdirSync(join(cache, plugin, version, 'agents'), { recursive: true });
    writeFileSync(join(cache, plugin, version, 'agents', `${name}.md`), body);
  };
  agent('code-ops-suite', '2.0.0', 'implementer', '---\nname: implementer\n---\nBody.\n\n## Contract\n\nBrief requires: Widget\n');
  agent('rigor', '9.0.0', 'tracer', '## Contract\n\nBrief requires: Old field\n');
  agent('rigor', '10.0.0', 'tracer', '## Contract\r\n\r\nBrief requires: Scope, Gadget\r\nEdits: none\r\n\r\n## Later\r\nBrief requires: Ignored\r\n');
  agent('rigor', '10.0.0', 'bare', '---\nname: bare\n---\nNo contract here.\nBrief requires: Outside\n');
  out = parseOut(runHook(dispatchCall({ prompt: 'Scope: x', subagent_type: 'rigor:tracer' }), { home, pluginRoot: suiteRoot }));
  expect(deny(out) && /missing: Gadget;/.test(reasonOf(out) ?? ''), `the cache layout must resolve rigor 10.0.0, got ${JSON.stringify(out)}`);
  r = runHook(dispatchCall({ prompt: 'Scope: x\nGadget: y\nRound budget: 5', subagent_type: 'rigor:tracer' }), { home, pluginRoot: suiteRoot });
  expect(r.stdout === '', `only the Contract section's line binds, got ${JSON.stringify(r.stdout)}`);
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 5', subagent_type: 'code-ops-suite:implementer', effort: 'high' }), { home, pluginRoot: suiteRoot }));
  expect(deny(out) && /missing: Widget;/.test(reasonOf(out) ?? ''), `the hook's own cached plugin must resolve, got ${JSON.stringify(out)}`);
  r = runHook(dispatchCall({ prompt: 'Round budget: 5', subagent_type: 'rigor:bare' }), { home, pluginRoot: suiteRoot });
  expect(r.stdout === '', `an agent without a Contract must pass, got ${JSON.stringify(r.stdout)}`);
  cleanup();
  console.log('ok   a suite agent\'s Contract fields deny when missing, resolve across plugins in the repo and the cache, and warn mode downgrades');
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
  const lead = runHook(dispatchCall({ prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:implementer', effort: 'high' }, { cwd }), { home, budget: 3 });
  expect(lead.stdout === '', `a clean lead dispatch must not auto-bind a future worker, got ${lead.stdout}`);
  for (let i = 0; i < 2; i++) expect(runHook(subagentCall(otherId, { cwd }), { home, budget: 3 }).stdout === '', 'an unregistered same-type worker must retain its own legacy counter');
  const fallbackWarning = contextOf(parseOut(runHook(subagentCall(otherId, { cwd }), { home, budget: 3 })));
  expect(typeof fallbackWarning === 'string' && !/controller-bound/.test(fallbackWarning), `no guessed binding may alter the fallback, got ${fallbackWarning}`);

  const bound = [];
  // A fallback of 4 (stop at call 6) leaves room for the 2-round budget and its 2-call allowance.
  for (let i = 0; i < 5; i++) bound.push(parseOut(runHook(subagentCall(boundId, { cwd }), { home, budget: 4 })));
  expect(/controller-bound 2-round budget/.test(contextOf(bound[1]) ?? ''), `a registered id must warn at its declared budget, got ${JSON.stringify(bound[1])}`);
  expect(bound[2] === null && bound[3] === null, `the two-call allowance must execute after the bound budget, got ${JSON.stringify(bound.slice(2, 4))}`);
  expect(bound[4]?.hookSpecificOutput?.permissionDecision === 'deny' && /attempted tool calls/.test(bound[4]?.hookSpecificOutput?.permissionDecisionReason ?? ''),
    `the call after the allowance must deny and label attempted calls, got ${JSON.stringify(bound[4])}`);
  const boundWarning = contextOf(bound[1]) ?? '';
  expect(boundWarning.includes('hard stop denies every tool call from call 5') && /controller replan/.test(boundWarning)
    && /marked complete or partial/.test(boundWarning) && /Report path/.test(boundWarning),
    `the bound warning must name its stop call, the replan, and the checkpoint, got ${boundWarning}`);
  expect(/marked complete or partial/.test(bound[4]?.hookSpecificOutput?.permissionDecisionReason ?? ''),
    `the bound stop must require the checkpoint, got ${JSON.stringify(bound[4])}`);

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
  // The denial states the mechanical fix: report now, then re-dispatch under a new id bound
  // with the exact register command.
  const malformedReason = malformed?.hookSpecificOutput?.permissionDecisionReason ?? '';
  expect(malformedReason.includes('Return your report now with the checkpoint: ')
    && malformedReason.includes(`node "${hook}" register --agent-id <new agent id> --budget <rounds>`),
    `a malformed binding denial must state the fix, got ${JSON.stringify(malformed)}`);
  const malformedWarn = parseOut(runHook(subagentCall(malformedId, { cwd }), { home, budget: 3, guard: 'warn' }));
  expect(malformedWarn?.hookSpecificOutput?.permissionDecision === 'deny',
    `warn mode must not fail open a malformed explicit binding, got ${JSON.stringify(malformedWarn)}`);
  const invalidReceipt = parseOut(runControl(['receipt', '--agent-id', malformedId], { home, budget: 3, cwd }));
  expect(invalidReceipt?.measurement?.status === 'INVALID' && invalidReceipt?.measurement?.calls === 'UNKNOWN',
    `a malformed binding receipt must not invent measurements, got ${JSON.stringify(invalidReceipt)}`);

  const legacyId = 'legacy-agent';
  const legacy = join(home, '.claude', 'code-ops', 'dispatch', legacySlug(cwd));
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, `${legacySlug(legacyId)}.rounds`), '.'.repeat(59));
  const migrated = parseOut(runHook(subagentCall(legacyId, { cwd }), { home, budget: 40 }));
  expect(migrated?.hookSpecificOutput?.permissionDecision === 'deny', `a legacy count of 59 must deny on its next call, the 60-call stop, after hashed-state rollout, got ${JSON.stringify(migrated)}`);
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
  // A fallback of 3 stops at call 4, so the bound cap permits 3 calls whatever the registration asks.
  for (let i = 0; i < 3; i++) {
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

// ---------------------------------------------------------------- a capped bound budget is reported, never silent

{
  const { home, cleanup } = fakeHome();
  const cwd = root;
  // The 40-round default stops at call 60, so a 90-round registration warns at 57 and denies from 60.
  const capped = runControl(['register', '--agent-id', 'capped-90', '--budget', '90'], { home, cwd });
  expect(capped.status === 0 && capped.stdout === ''
    && /^dispatch-guard CAPPED: the 90-round budget exceeds the 60-call stop of the 40-round default, so the hook warns at 57 and denies from call 60\./.test(capped.stderr),
    `a bound budget above the unregistered stop must report the cap on stderr, got ${capped.status}/${capped.stdout}/${capped.stderr}`);
  const inside = runControl(['register', '--agent-id', 'inside-40', '--budget', '40'], { home, cwd });
  expect(inside.status === 0 && inside.stdout === '' && inside.stderr === '', `a bound budget inside the stop must register silently, got ${inside.status}/${inside.stderr}`);
  // A fallback of 4 stops at call 6, so a 10-round registration warns at 3 and names both budgets.
  runControl(['register', '--agent-id', 'capped-10', '--budget', '10'], { home, budget: 4, cwd });
  const calls = [];
  for (let i = 0; i < 6; i++) calls.push(parseOut(runHook(subagentCall('capped-10', { cwd }), { home, budget: 4 })));
  const warning = contextOf(calls[2]) ?? '';
  expect(calls[0] === null && calls[1] === null && /controller-bound 3-round budget \(registered 10, capped by the 4-round default's stop\)/.test(warning)
    && warning.includes('from call 6'), `a capped binding must warn at its effective budget and name the registered one, got ${JSON.stringify(calls.slice(0, 3))}`);
  expect(calls[5]?.hookSpecificOutput?.permissionDecision === 'deny', `a capped binding must still deny at the unregistered stop, got ${JSON.stringify(calls[5])}`);
  cleanup();
  console.log('ok   a bound budget above the unregistered stop is capped and reported at register and at the warning');
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
  const counterReason = unavailable?.hookSpecificOutput?.permissionDecisionReason ?? '';
  expect(counterReason.includes(join(home, '.claude', 'code-ops', 'dispatch', stateKey(cwd)))
    && counterReason.includes(`Return your report now with the checkpoint: `)
    && counterReason.includes(`node "${hook}" register --agent-id <new agent id> --budget <rounds>`),
    `an unavailable counter denial must name its directory and state the fix, got ${JSON.stringify(counterReason)}`);
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
  const clean = { description: 'build it', prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:implementer', effort: 'high' };
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

  // A compact boundary newer than the last usage record makes the pre-compaction size stale:
  // the context reads as unknown, and the first post-boundary usage record gates again.
  const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'manual', preTokens: 900_000 } }) + '\n';
  const compacted = join(dir, 'compacted.jsonl');
  writeFileSync(compacted, readFileSync(transcriptAt(dir, 900_000, 'pre.jsonl'), 'utf8') + boundary);
  r = runHook(dispatchCall(clean, { cwd, session_id: 'sess-compact', transcript_path: compacted }), { home });
  expect(r.status === 0 && r.stdout === '', `a stale pre-compaction size must not gate, got ${JSON.stringify(r.stdout)}`);
  writeFileSync(compacted, readFileSync(compacted, 'utf8') + readFileSync(transcriptAt(dir, 310_000, 'post.jsonl'), 'utf8'));
  out = parseOut(runHook(dispatchCall(clean, { cwd, session_id: 'sess-compact', transcript_path: compacted }), { home }));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `a post-boundary usage record past the ceiling must deny, got ${JSON.stringify(out)}`);

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

// ---------------------------------------------------------------- ceiling assessment keyed by repository root
// A lead whose shell changes directory reports a different payload cwd on each call. The
// assessment marker keys on the repository root (nearest ancestor holding `.git`), so an
// assessment recorded from a subdirectory unlocks a dispatch from the root, and another repository
// root stays gated on its own.

{
  const { home, cleanup } = fakeHome();
  const dir = mkdtempSync(join(tmpdir(), 'dispatch-stateroot-'));
  const repoA = join(dir, 'repo-a');
  const repoB = join(dir, 'repo-b');
  const sub = join(repoA, 'pkg', 'deep');
  mkdirSync(sub, { recursive: true });
  mkdirSync(repoB, { recursive: true });
  // `.git` is a file in a worktree and a directory in a clone; the walk accepts both.
  writeFileSync(join(repoA, '.git'), 'gitdir: elsewhere\n');
  mkdirSync(join(repoB, '.git'));
  const session = 'sess-stateroot';
  const clean = { description: 'build it', prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:implementer', effort: 'high' };
  const dispatchFrom = (cwd, context = 310_000) => runHook(dispatchCall(clean, {
    cwd, session_id: session, transcript_path: transcriptAt(dir, context, `t-${context}.jsonl`),
  }), { home });
  const denied = (r) => parseOut(r)?.hookSpecificOutput?.permissionDecision === 'deny';

  expect(denied(dispatchFrom(repoA)), 'a dispatch past the ceiling must deny before any assessment');
  const skill = runHook({
    hook_event_name: 'PreToolUse', cwd: sub, session_id: session, tool_name: 'Skill', tool_use_id: 'tu-root',
    tool_input: { skill: 'code-ops-suite:handoff', args: 'assess' }, transcript_path: transcriptAt(dir, 310_000, 's-310000.jsonl'),
  }, { home });
  expect(skill.status === 0 && skill.stdout === '', `the handoff skill call from a subdirectory must be silent, got ${JSON.stringify(skill.stdout)}`);
  expect(dispatchFrom(repoA).stdout === '', 'an assessment recorded from a subdirectory must unlock a dispatch from the repository root');
  expect(dispatchFrom(sub).stdout === '', 'the same assessment must unlock a dispatch from the subdirectory itself');
  expect(denied(dispatchFrom(repoB)), 'another repository root must not inherit the assessment');

  // The CLI verb run from a subdirectory lands on the same marker.
  expect(denied(dispatchFrom(repoA, 460_000)), 'the next band must re-gate from the repository root');
  const cli = runControl(['assessed', '--session', session, '--band', '2'], { home, cwd: sub });
  expect(cli.status === 0 && cli.stdout === '', `the assessed verb from a subdirectory must succeed, got ${cli.status}/${cli.stderr}`);
  expect(dispatchFrom(repoA, 460_000).stdout === '', 'a CLI assessment from a subdirectory must unlock a dispatch from the repository root');

  // No `.git` anywhere above the cwd: the cwd itself keys the marker, as before.
  const loose = join(dir, 'loose');
  mkdirSync(loose);
  runControl(['assessed', '--session', session, '--band', '1'], { home, cwd: loose });
  expect(existsSync(join(home, '.claude', 'code-ops', 'dispatch', stateKey(loose), `${stateKey(session)}.assessed.json`)),
    'a cwd with no repository root above it must key its own marker');

  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   a ceiling assessment recorded from a subdirectory unlocks the repository root, and another root stays gated');
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
  expect(/^Dispatch guard: Run \/compact\./.test(reasonOf(out) ?? '') && /about 10,000 tokens past the 200,000-token context ceiling/.test(reasonOf(out) ?? ''),
    `a Grok spawn past 200,000 must deny at the Grok ceiling and lead with /compact, got ${JSON.stringify(out)}`);
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
  for (let i = 0; i < 3; i++) seen.push(parseOut(childCall('child-1')));
  expect(/2 tool rounds used against a 2-round budget/.test(contextOf(seen[budget - 1]) ?? ''),
    `a Grok subagent must warn at its budget, got ${JSON.stringify(seen[budget - 1])}`);
  expect(seen[2]?.hookSpecificOutput?.permissionDecision === 'deny',
    `a Grok subagent must stop at 1.5 times its budget (call 3), got ${JSON.stringify(seen[2])}`);
  expect(childCall('child-2').stdout === '', 'another Grok subagent must keep its own counter');
  for (let i = 0; i < budget * 2; i++) {
    r = runHook({ hook_event_name: 'PreToolUse', sessionId: 'main-grok', cwd, toolName: 'read_file', toolInput: {} }, { home, budget, grok: true });
    expect(r.stdout === '', `a Grok main-thread tool call must never be counted, got ${JSON.stringify(r.stdout)}`);
  }

  rmSync(dir, { recursive: true, force: true });
  cleanup();
  console.log('ok   Grok gates at its 200,000-token ceiling and counts rounds per child session');
}

// ---------------------------------------------------------------- the brief's Round budget binds

{
  const { home, cleanup } = fakeHome();
  const project = join(home, 'project');
  const leadTranscript = join(project, 'sess-1.jsonl');
  // The host layout: the lead transcript arrives as transcript_path, and the subagent's own
  // transcript sits under `<session id>/subagents/`, its first line the lead's brief.
  const transcriptOf = (id) => join(project, 'sess-1', 'subagents', `agent-${id}.jsonl`);
  const briefEntry = (id, content) => JSON.stringify({ parentUuid: null, isSidechain: true, agentId: id, type: 'user', message: { role: 'user', content } });
  const writeBrief = (id, content, rest = '') => {
    mkdirSync(dirname(transcriptOf(id)), { recursive: true });
    writeFileSync(transcriptOf(id), `${briefEntry(id, content)}\n${rest}`);
  };
  const briefCall = (id) => subagentCall(id, { transcript_path: leadTranscript });

  // Brief 60: silent to 59, warns at 60 as brief-bound, denies first at 90.
  writeBrief('brief-60', `${FULL_BRIEF.replace('Round budget: 25 tool rounds', 'Round budget: 60')}`);
  const outs = [];
  for (let i = 1; i <= 90; i++) outs.push(parseOut(runHook(briefCall('brief-60'), { home })));
  expect(outs.slice(0, 59).every((out) => out === null), `rounds 1-59 of a 60-round brief must be silent, got ${JSON.stringify(outs.slice(0, 59).find((o) => o !== null))}`);
  const warn60 = contextOf(outs[59]);
  expect(typeof warn60 === 'string' && warn60.includes('60 tool rounds used against a brief-bound 60-round budget') && warn60.includes('from call 90'),
    `a 60-round brief must warn at 60 and name stop call 90, got ${warn60}`);
  expect(typeof warn60 === 'string' && !warn60.includes('If your brief names a larger budget'), 'a brief-bound warning must not invite a larger brief budget');
  expect(outs.slice(0, 89).every((out) => out?.hookSpecificOutput?.permissionDecision !== 'deny'), 'no call before 90 may deny under a 60-round brief');
  expect(/90 tool rounds used, the hard stop at 1\.5 times the 60-round budget/.test(reasonOf(outs[89]) ?? ''), `call 90 must deny, got ${JSON.stringify(outs[89])}`);
  expect(contextOf(outs[79])?.includes('80 tool rounds used against a brief-bound 60-round budget'),
    `a 60-round brief warns again at 80 rather than stopping there, got ${JSON.stringify(outs[79])}`);
  console.log('ok   a 60-round brief warns at 60 and stops at 90, not at the 40-round default');

  // Above the maximum: clamped to 120, with one advisory on the first call only.
  writeBrief('brief-500', 'Scope: x\nRound budget: 500 rounds\n');
  const first = contextOf(parseOut(runHook(briefCall('brief-500'), { home })));
  expect(typeof first === 'string' && first.includes("brief's 500-round budget exceeds the 120-round maximum") && first.includes('uses 120'),
    `a brief above the maximum must clamp with an advisory, got ${first}`);
  const second = runHook(briefCall('brief-500'), { home });
  expect(second.stdout === '', `the clamp advisory must appear once, got ${second.stdout}`);
  const cache = JSON.parse(readFileSync(join(home, '.claude', 'code-ops', 'dispatch', stateKey('C:/fixture-project'), `${stateKey('brief-500')}.brief.json`), 'utf8'));
  expect(cache.budget === 120 && cache.status === 'CLAMPED' && !JSON.stringify(cache).includes('Scope'),
    `the cache must hold the clamped number and no brief text, got ${JSON.stringify(cache)}`);
  console.log('ok   a brief budget above 120 clamps to 120 with one advisory');

  // Zero and two different values keep the environment budget, with an advisory.
  for (const [id, content] of [['brief-zero', 'Round budget: 0'], ['brief-two', 'Round budget: 5\n- **Round budget:** 9']]) {
    writeBrief(id, content);
    const out = contextOf(parseOut(runHook(briefCall(id), { home, budget: 1 })));
    expect(typeof out === 'string' && out.includes('not one whole number from 1 to 120') && out.includes('1 tool rounds used against a 1-round budget'),
      `${id}: an invalid brief budget must fall back to the environment budget with an advisory, got ${out}`);
  }
  console.log('ok   a zero or conflicting brief budget keeps the environment budget with an advisory');

  // No Round budget line, a missing transcript, and a missing transcript_path keep the default.
  writeBrief('brief-none', 'Scope: x\nObjective: y');
  for (const [name, payload] of [['no line', briefCall('brief-none')], ['missing transcript', briefCall('brief-absent')], ['no transcript_path', subagentCall('brief-nopath')]]) {
    const runs = [1, 2, 3].map(() => parseOut(runHook(payload, { home, budget: 3 })));
    expect(runs[0] === null && runs[1] === null && contextOf(runs[2])?.includes('3 tool rounds used against a 3-round budget'),
      `${name}: must keep the environment budget silently, got ${JSON.stringify(runs)}`);
  }
  console.log('ok   no budget line or no readable transcript keeps the default budget');

  // Array content blocks carry the brief too; later transcript text never moves the bound value.
  writeBrief('brief-late', [{ type: 'text', text: 'Round budget: 3' }]);
  runHook(briefCall('brief-late'), { home });
  writeBrief('brief-late', 'Round budget: 999', `${JSON.stringify({ type: 'user', message: { content: 'tool output: Round budget: 999' } })}\n`);
  const late = [2, 3].map(() => contextOf(parseOut(runHook(briefCall('brief-late'), { home }))));
  expect(late[0] === undefined && late[1]?.includes('3 tool rounds used against a brief-bound 3-round budget'),
    `a later "Round budget: 999" must not change the cached budget, got ${JSON.stringify(late)}`);
  console.log('ok   the first call binds the brief budget; later transcript text does not move it');

  // A controller binding outranks the brief and never reads it.
  writeBrief('brief-bound', 'Round budget: 60');
  runControl(['register', '--agent-id', 'brief-bound', '--budget', '2', '--allowance', '1'], { home, cwd: root });
  const boundOuts = [1, 2].map(() => contextOf(parseOut(runHook(subagentCall('brief-bound', { cwd: root, transcript_path: leadTranscript }), { home }))));
  expect(boundOuts[0] === undefined && boundOuts[1]?.includes('against a controller-bound 2-round budget'),
    `a register binding must override the brief, got ${JSON.stringify(boundOuts)}`);
  expect(!existsSync(join(home, '.claude', 'code-ops', 'dispatch', stateKey(root), `${stateKey('brief-bound')}.brief.json`)), 'a bound agent must not read its brief');
  console.log('ok   a controller binding overrides the brief budget');
  cleanup();
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

// ---------------------------------------------------------------- legacy path deny (behaviour 6)

// A throwaway repository whose hub lists one removed legacy root (docs/old, forwarded to hub/new),
// one relocated root, and a second removed root with no forwarding entry.
function legacyRepo({ manifest, forwarding = true, noManifest = false, generators = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'legacy-repo-'));
  mkdirSync(join(repo, '.git'));
  if (generators) {
    mkdirSync(join(repo, 'scripts'));
    for (const name of ['build-codex-marketplace.mjs', 'build-opencode-dist.mjs']) writeFileSync(join(repo, 'scripts', name), '');
  }
  const system = join(repo, 'hub', '98 System');
  mkdirSync(system, { recursive: true });
  const evidence = [{ kind: 'external', ref: 'fixture' }];
  if (!noManifest) writeFileSync(join(system, 'DOCS_MANIFEST.json'), manifest ?? JSON.stringify({
    version: 3, hub: 'hub', recordCollections: [],
    legacyPaths: [
      { path: 'docs/old', disposition: 'removed', requiredBy: evidence },
      { path: 'docs/orphan', disposition: 'removed', requiredBy: evidence },
      { path: 'docs/moved', disposition: 'relocated', target: 'hub/moved', requiredBy: evidence },
    ],
  }));
  if (forwarding) {
    writeFileSync(join(system, 'FORWARDING.json'), JSON.stringify({
      version: 1, forwards: [{ from: 'docs/old', to: 'hub/new', movedAt: '2026-09-30', reason: 'vault move' }],
    }));
  }
  return { repo, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

{
  const { home, cleanup } = fakeHome();
  const fixture = legacyRepo();
  const edit = (tool, input, extra = {}) => ({
    hook_event_name: 'PreToolUse', session_id: 'sess-L', cwd: fixture.repo, tool_name: tool, tool_input: input, ...extra,
  });
  const denial = (r) => parseOut(r)?.hookSpecificOutput;

  const deny = denial(runHook(edit('Write', { file_path: 'docs/old/guide/a.md', content: 'x' }), { home }));
  expect(deny?.permissionDecision === 'deny' && deny.hookEventName === 'PreToolUse'
    && deny.permissionDecisionReason.includes('docs/old') && deny.permissionDecisionReason.includes('hub/new/guide/a.md'),
  `a Write under a removed root must be denied with the root and its forwarded path, got ${JSON.stringify(deny)}`);
  console.log('ok   an edit under a removed legacy root is denied, naming the root and the forwarded path');

  const absolute = denial(runHook(edit('Edit', { file_path: join(fixture.repo, 'docs', 'old', 'b.md'), old_string: 'a', new_string: 'b' }), { home }));
  expect(absolute?.permissionDecision === 'deny', `an absolute path under the root must be denied, got ${JSON.stringify(absolute)}`);
  const folded = denial(runHook(edit('NotebookEdit', { notebook_path: 'docs/old/n.ipynb' }), { home }));
  expect(folded?.permissionDecision === 'deny', `NotebookEdit must be denied, got ${JSON.stringify(folded)}`);
  const patch = denial(runHook(edit('apply_patch', { input: '*** Begin Patch\n*** Update File: docs/old/c.md\n@@\n-a\n+b\n*** End Patch' }), { home }));
  expect(patch?.permissionDecision === 'deny' && patch.permissionDecisionReason.includes('hub/new/c.md'),
    `an apply_patch target under the root must be denied, got ${JSON.stringify(patch)}`);
  const grokEdit = denial(runHook({ hookEventName: 'pre_tool_use', hook_event_name: 'PreToolUse', sessionId: 'sess-L', cwd: fixture.repo,
    toolName: 'search_replace', toolInput: { path: 'docs/old/d.md' } }, { home }));
  expect(grokEdit?.permissionDecision === 'deny', `a camelCase edit payload must be denied, got ${JSON.stringify(grokEdit)}`);
  console.log('ok   absolute paths, NotebookEdit, apply_patch targets, and camelCase payloads are denied');

  const orphan = denial(runHook(edit('Write', { file_path: 'docs/orphan/a.md', content: 'x' }), { home }));
  expect(orphan?.permissionDecision === 'deny' && orphan.permissionDecisionReason.includes('docs/orphan')
    && orphan.permissionDecisionReason.includes('maps no new location'),
  `a removed root with no forwarding entry must say so, got ${JSON.stringify(orphan)}`);
  console.log('ok   a removed root with no FORWARDING.json entry is denied without a new location');

  for (const [name, input] of [
    ['a relocated (not removed) root', { file_path: 'docs/moved/a.md' }],
    ['a path outside every legacy root', { file_path: 'src/a.mjs' }],
    ['a sibling that shares the root prefix', { file_path: 'docs/older/a.md' }],
    ['a path outside the repository', { file_path: join(tmpdir(), 'docs', 'old', 'a.md') }],
  ]) {
    const r = runHook(edit('Write', input), { home });
    expect(r.status === 0 && r.stdout === '', `${name} must pass silently, got ${JSON.stringify(r.stdout)}`);
  }
  console.log('ok   relocated roots, unrelated paths, prefix siblings, and outside paths pass');

  for (const tool of ['Read', 'Grep', 'Bash', 'Glob']) {
    const r = runHook(edit(tool, { file_path: 'docs/old/a.md', path: 'docs/old', command: 'cat docs/old/a.md' }), { home });
    expect(r.status === 0 && r.stdout === '', `${tool} under a removed root must stay untouched, got ${JSON.stringify(r.stdout)}`);
  }
  console.log('ok   non-edit tools under a removed root are untouched');

  for (const value of ['0', 'off', 'FALSE']) {
    const r = runHook(edit('Write', { file_path: 'docs/old/a.md' }), { home, env: { CODE_OPS_LEGACY_PATHS: value } });
    expect(r.status === 0 && r.stdout === '', `CODE_OPS_LEGACY_PATHS=${value} must silence the deny, got ${JSON.stringify(r.stdout)}`);
  }
  const wholeOff = runHook(edit('Write', { file_path: 'docs/old/a.md' }), { home, guard: 'off' });
  expect(wholeOff.stdout === '', `CODE_OPS_DISPATCH_GUARD=off must silence the deny, got ${JSON.stringify(wholeOff.stdout)}`);
  console.log('ok   CODE_OPS_LEGACY_PATHS off values and the whole-hook switch silence the deny');

  const warn = denial(runHook(edit('Write', { file_path: 'docs/old/a.md' }), { home, guard: 'warn' }));
  expect(warn?.permissionDecision === undefined && warn?.additionalContext?.includes('docs/old'),
    `warn mode must downgrade the deny to context, got ${JSON.stringify(warn)}`);
  console.log('ok   warn mode downgrades the legacy deny to advisory context');

  // A denied subagent call still counts a round and keeps its round advisory in the same output.
  const child = denial(runHook(edit('Write', { file_path: 'docs/old/a.md' }, { agent_id: 'agent-L' }), { home, budget: 1 }));
  expect(child?.permissionDecision === 'deny' && child.permissionDecisionReason.includes('docs/old')
    && child.permissionDecisionReason.includes('1 tool rounds used'),
  `a denied subagent call must count and merge the round advisory, got ${JSON.stringify(child)}`);
  expect(readFileSync(join(home, '.claude', 'code-ops', 'dispatch', stateKey(fixture.repo), `${stateKey('agent-L')}.rounds`)).length === 1,
    'the denied subagent call must count as one round');
  console.log('ok   a denied subagent call counts one round and merges the round advisory');
  fixture.cleanup();

  for (const [name, options] of [
    ['a corrupt manifest', { manifest: '{not json "removed"' }],
    ['a manifest of another version', { manifest: JSON.stringify({ version: 2, hub: 'hub', legacyPaths: [{ path: 'docs/old', disposition: 'removed' }] }) }],
    ['a manifest with no removed root', { manifest: JSON.stringify({ version: 3, hub: 'hub', legacyPaths: [] }) }],
    ['an empty manifest', { manifest: '' }],
  ]) {
    const broken = legacyRepo(options);
    const r = runHook({ hook_event_name: 'PreToolUse', session_id: 'sess-L', cwd: broken.repo, tool_name: 'Write', tool_input: { file_path: 'docs/old/a.md' } }, { home });
    expect(r.status === 0 && r.stdout === '', `${name} must fail open, got ${r.status}/${JSON.stringify(r.stdout)}`);
    broken.cleanup();
  }
  const noForwarding = legacyRepo({ forwarding: false });
  const bare = denial(runHook({ hook_event_name: 'PreToolUse', session_id: 'sess-L', cwd: noForwarding.repo, tool_name: 'Write', tool_input: { file_path: 'docs/old/a.md' } }, { home }));
  expect(bare?.permissionDecision === 'deny' && bare.permissionDecisionReason.includes('maps no new location'),
    `a missing FORWARDING.json must still deny, got ${JSON.stringify(bare)}`);
  noForwarding.cleanup();
  const noHub = mkdtempSync(join(tmpdir(), 'legacy-nohub-'));
  mkdirSync(join(noHub, '.git'));
  const none = runHook({ hook_event_name: 'PreToolUse', session_id: 'sess-L', cwd: noHub, tool_name: 'Write', tool_input: { file_path: 'docs/old/a.md' } }, { home });
  expect(none.status === 0 && none.stdout === '', `a repository with no hub must fail open, got ${JSON.stringify(none.stdout)}`);
  rmSync(noHub, { recursive: true, force: true });
  console.log('ok   a corrupt, wrong-version, empty, or removal-free manifest and a missing hub fail open; a missing FORWARDING.json still denies');
  cleanup();
}

// ---------------------------------------------------------------- derived path deny (behaviour 6)

// The manifest names its own derived trees when it lists any; the built-in list is the fallback for
// a hub whose manifest is missing, unreadable, or lists none, and a repository with no hub is never
// denied. docs-manifest.mjs does not yet accept the derived disposition, so a real manifest lists none.
{
  const { home, cleanup } = fakeHome();
  const GEN = 'node scripts/build-gen.mjs';
  const derivedManifest = JSON.stringify({
    version: 2, hub: 'hub', runs: { tracking: 'ignored' }, recordCollections: [],
    legacyPaths: [{ path: 'gen-out/', disposition: 'derived', generator: GEN }, { path: 'bare-out', disposition: 'derived' }],
  });
  const edit = (repo, tool, input) => ({ hook_event_name: 'PreToolUse', session_id: 'sess-D', cwd: repo, tool_name: tool, tool_input: input });
  const reasonFor = (repo, tool, input, options) => reasonOf(parseOut(runHook(edit(repo, tool, input), { home, ...options })));
  const silent = (repo, input, label, options) => {
    const r = runHook(edit(repo, 'Write', input), { home, ...options });
    expect(r.status === 0 && r.stdout === '', `${label} must pass silently, got ${JSON.stringify(r.stdout)}`);
  };

  // A manifest entry triggers the deny, with its generator named.
  const declared = legacyRepo({ manifest: derivedManifest });
  const a = reasonFor(declared.repo, 'Write', { file_path: 'gen-out/x/a.md', content: 'x' });
  expect(typeof a === 'string' && a.startsWith('Derived path guard:') && a.includes('gen-out/x/a.md') && a.includes(`\`${GEN}\``)
    && a.includes('the documentation manifest marks derived'), `a manifest entry must deny an edit under it, naming the generator, got ${a}`);
  const noGenerator = reasonFor(declared.repo, 'Edit', { file_path: join(declared.repo, 'bare-out', 'b.js'), old_string: 'a', new_string: 'b' });
  expect(/its generator instead/.test(noGenerator ?? ''), `an entry with no generator must still deny, got ${noGenerator}`);
  const patched = reasonFor(declared.repo, 'apply_patch', { input: '*** Begin Patch\n*** Update File: gen-out/c.md\n@@\n-a\n+b\n*** End Patch' });
  expect(/Derived path guard:/.test(patched ?? ''), `an apply_patch target under a derived entry must deny, got ${patched}`);
  console.log('ok   a manifest derived entry denies Write, Edit, and apply_patch targets under it, naming its generator');

  // The manifest replaces the built-in list, so a hub that does not declare opencode-dist/ may edit it.
  silent(declared.repo, { file_path: 'opencode-dist/a.js' }, 'a path the readable manifest does not list');
  silent(declared.repo, { file_path: 'gen-outer/a.md' }, 'a prefix sibling of a derived entry');
  silent(declared.repo, { file_path: 'src/a.mjs' }, 'an unrelated path');
  for (const tool of ['Read', 'Grep', 'Bash']) {
    const r = runHook(edit(declared.repo, tool, { file_path: 'gen-out/a.md', command: 'node scripts/build-gen.mjs > gen-out/a.md' }), { home });
    expect(r.status === 0 && r.stdout === '', `${tool} under a derived tree must stay untouched, got ${JSON.stringify(r.stdout)}`);
  }
  silent(declared.repo, { file_path: 'gen-out/a.md' }, 'CODE_OPS_LEGACY_PATHS=off', { env: { CODE_OPS_LEGACY_PATHS: 'off' } });
  const warned = parseOut(runHook(edit(declared.repo, 'Write', { file_path: 'gen-out/a.md' }), { home, guard: 'warn' }));
  expect(warned?.hookSpecificOutput?.permissionDecision === undefined && /Derived path guard:/.test(contextOf(warned) ?? ''),
    `warn mode must downgrade the derived deny to context, got ${JSON.stringify(warned)}`);
  declared.cleanup();
  console.log('ok   the readable manifest replaces the fallback list; prefix siblings, other tools, the off switch, and warn mode behave as for removed roots');

  // A readable manifest that lists no derived path uses the built-in list: version 1 declares no
  // legacy paths, a version 2 manifest may list none, and the default version 3 fixture lists only
  // removed and relocated roots (the shape the real manifest has today).
  for (const [name, options] of [
    ['a version 2 manifest with no derived entry', { manifest: JSON.stringify({ version: 2, hub: 'hub', legacyPaths: [] }) }],
    ['a version 1 manifest', { manifest: JSON.stringify({ version: 1, hub: 'hub', domains: [] }) }],
    ['a version 3 manifest with removed roots only', {}],
  ]) {
    const repo = legacyRepo(options);
    const reason = reasonFor(repo.repo, 'Write', { file_path: 'opencode-dist/a.js', content: 'x' });
    expect(typeof reason === 'string' && reason.startsWith('Derived path guard:') && reason.includes('this repository treats as derived')
      && reason.includes('`node scripts/build-opencode-dist.mjs`'), `${name} must fall back and deny an edit under opencode-dist/, got ${reason}`);
    silent(repo.repo, { file_path: 'src/a.mjs' }, `${name} must not deny an unrelated path`);
    repo.cleanup();
  }
  console.log('ok   a readable manifest with no derived entry falls back to the built-in derived list');

  // The fallback list denies when the manifest is missing, corrupt, empty, or of an unknown shape.
  const FALLBACK = [['opencode-dist/x/a.js', 'node scripts/build-opencode-dist.mjs'], ['codex-marketplace/plugins/a.json', 'node scripts/build-codex-marketplace.mjs'],
    ['.agents/plugins/marketplace.json', 'node scripts/build-codex-marketplace.mjs']];
  for (const [name, options] of [
    ['a missing manifest', { noManifest: true }],
    ['a corrupt manifest', { manifest: '{not json' }],
    ['an empty manifest', { manifest: '' }],
    ['a manifest of an unknown version', { manifest: JSON.stringify({ version: 9, hub: 'hub', legacyPaths: [] }) }],
    ['a version 2 manifest whose legacyPaths is not an array', { manifest: JSON.stringify({ version: 2, hub: 'hub', legacyPaths: 'x' }) }],
  ]) {
    const repo = legacyRepo(options);
    for (const [file, generator] of FALLBACK) {
      const reason = reasonFor(repo.repo, 'Write', { file_path: file, content: 'x' });
      expect(typeof reason === 'string' && reason.startsWith('Derived path guard:') && reason.includes(`\`${generator}\``)
        && reason.includes('this repository treats as derived'), `${name} must fall back to the built-in list for ${file}, got ${reason}`);
    }
    silent(repo.repo, { file_path: 'src/a.mjs' }, `${name} must not deny an unrelated path`);
    repo.cleanup();
  }
  console.log('ok   a missing, corrupt, empty, or unrecognised manifest falls back to the built-in derived list');

  // A fallback entry applies only where its generator script exists, so an adopting repository with a
  // hub keeps its own hand-authored .agents/ tree, and a repository with one generator gets only its trees.
  for (const [name, options] of [['a hub with a readable manifest', {}], ['a hub with no manifest', { noManifest: true }]]) {
    const bare = legacyRepo({ ...options, generators: false });
    for (const [file] of FALLBACK) silent(bare.repo, { file_path: file }, `${name} and no generator script, for ${file}`);
    bare.cleanup();
  }
  const partial = legacyRepo({ generators: false });
  mkdirSync(join(partial.repo, 'scripts'));
  writeFileSync(join(partial.repo, 'scripts', 'build-opencode-dist.mjs'), '');
  expect(/Derived path guard:/.test(reasonFor(partial.repo, 'Write', { file_path: 'opencode-dist/a.js' }) ?? ''), 'a present generator must keep its tree denied');
  silent(partial.repo, { file_path: '.agents/plugins/marketplace.json' }, 'a tree whose generator script is absent');
  partial.cleanup();
  console.log('ok   a fallback entry applies only where its generator script exists');

  // Without a hub the fallback never applies, so another repository may edit its own .agents/ file.
  const noHub = mkdtempSync(join(tmpdir(), 'derived-nohub-'));
  mkdirSync(join(noHub, '.git'));
  silent(noHub, { file_path: '.agents/plugins/marketplace.json' }, 'a repository with no hub');
  rmSync(noHub, { recursive: true, force: true });
  console.log('ok   a repository with no documentation hub is never denied');
  cleanup();
}

// ---------------------------------------------------------------- peer note (behaviour 5)

// One live peer claims a path on the repository's presence board; an edit of that path by another
// session earns a Collision note, which the decision rows record under the peer-note gate.
{
  const { home, cleanup } = fakeHome();
  const repo = mkdtempSync(join(tmpdir(), 'peer-repo-'));
  const init = spawnSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' });
  expect(init.status === 0, `git init must succeed, got ${init.stderr}`);
  const boardDir = join(home, '.claude', 'code-ops', 'board', repoIdentity(repo).key);
  mkdirSync(boardDir, { recursive: true });
  writeFileSync(join(boardDir, 'Alpha.json'), JSON.stringify({
    v: 1, sessionId: 'Alpha', hostSessionId: 'local_Alpha', name: 'Alpha', branch: 'main', worktree: '.',
    claims: ['src/claimed.js'], edits: [], heartbeat: new Date(Date.now() - 120_000).toISOString(), ended: null,
  }));
  const claimed = (extra = {}) => runHook({ hook_event_name: 'PreToolUse', session_id: 'sess-P', cwd: repo, tool_name: 'Edit',
    tool_input: { file_path: join(repo, 'src', 'claimed.js') } }, { home, env: { CODE_OPS_HOME: home, CODE_OPS_PEER_GUARD: '', ...extra } });
  const note = contextOf(parseOut(claimed()));
  expect((note ?? '').startsWith('Collision note (warn only') && note.includes('"Alpha"'), `an edit of a claimed path must warn naming the peer, got ${note}`);
  const again = claimed();
  expect(again.status === 0 && again.stdout === '', `the same path warns once per session, got ${JSON.stringify(again.stdout)}`);
  const off = runHook({ hook_event_name: 'PreToolUse', session_id: 'sess-Q', cwd: repo, tool_name: 'Edit',
    tool_input: { file_path: join(repo, 'src', 'claimed.js') } }, { home, env: { CODE_OPS_HOME: home, CODE_OPS_PEER_GUARD: 'off' } });
  expect(off.status === 0 && off.stdout === '', `CODE_OPS_PEER_GUARD=off must silence the note, got ${JSON.stringify(off.stdout)}`);
  console.log('ok   an edit of a path a live peer claimed earns one Collision note, and the board switch silences it');
  rmSync(repo, { recursive: true, force: true });
  cleanup();
}

// ---------------------------------------------------------------- tier routing (slice 4)

// Fake agent definitions in a temp cache layout, so these cases read only the guard and the vendored
// router, never the real agents' Contract lines. `reviewer` and `implementer` pin the strong model at
// high effort; `steady` pins medium effort; `plain` has no `Tier` in its Contract.
{
  const { home, cleanup } = fakeHome();
  const suiteRoot = join(home, 'cache', 'code-ops', 'code-ops-suite', '2.0.0');
  mkdirSync(join(suiteRoot, 'agents'), { recursive: true });
  const ROUTED = 'Scope, Objective, Round budget, Report cap, Report path, Expected return, Unit, Tier, Effort, Route basis';
  const fake = (name, model, effort, requires) => writeFileSync(join(suiteRoot, 'agents', `${name}.md`),
    `---\nname: ${name}\nmodel: ${model}\neffort: ${effort}\n---\nBody.\n\n## Contract\n\nBrief requires: ${requires}\nEdits: none\n`);
  fake('reviewer', 'claude-sonnet-5-5', 'high', ROUTED);
  fake('implementer', 'claude-sonnet-5-5', 'high', ROUTED);
  fake('steady', 'claude-sonnet-5-5', 'medium', ROUTED);
  fake('plain', 'sonnet', 'low', 'Scope, Objective, Round budget, Report cap, Report path, Expected return');

  const brief = (o = {}) => {
    const v = { scope: 'src/app.js only.', unit: 'u1', tier: 'strong', effort: 'high', basis: 'judgment; surface=none; ambiguity=low; reversible=yes', ...o };
    return [`Scope: ${v.scope}`, 'Objective: x', 'Round budget: 25', 'Report cap: 200 words.', 'Report path: r.md', 'Expected return: a line.',
      `Unit: ${v.unit}`, `Tier: ${v.tier}`, `Effort: ${v.effort}`, `Route basis: ${v.basis}`, ...(v.override ? [`Route override: ${v.override}`] : [])].join('\n');
  };
  const agents = join(home, '.claude', 'code-ops', 'agents');
  const seed = (rows, session = 'sess-1') => {
    mkdirSync(agents, { recursive: true });
    writeFileSync(join(agents, `${stateKey(session)}.jsonl`), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  };
  const sendRaw = (type, over, input = {}, opts = {}) => parseOut(runHook(dispatchCall({ subagent_type: type, prompt: brief(over), ...input }),
    { home, pluginRoot: suiteRoot, env: { CODE_OPS_HOME: home }, ...opts }));
  // The reviewer's minimum kind is review, so a reviewer brief here declares review where it would say judgment.
  // `sendRaw` sends the declared kind as given.
  const send = (type, over = {}, input = {}, opts = {}) => sendRaw(type, type === 'code-ops-suite:reviewer'
    ? { ...over, basis: (over.basis ?? 'judgment; surface=none; ambiguity=low; reversible=yes').replace(/^judgment/, 'review') } : over, input, opts);
  const denied = (out, pattern, label) => expect(out?.hookSpecificOutput?.permissionDecision === 'deny' && pattern.test(reasonOf(out) ?? ''),
    `${label}: must deny matching ${pattern}, got ${JSON.stringify(out)}`);
  const quiet = (out, label) => expect(out === null, `${label}: must be silent, got ${JSON.stringify(out)}`);
  const advised = (out, pattern, label) => expect(!Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision') && pattern.test(contextOf(out) ?? ''),
    `${label}: must advise matching ${pattern} and not deny, got ${JSON.stringify(out)}`);
  const REV = 'code-ops-suite:reviewer';
  const IMP = 'code-ops-suite:implementer';

  // Baseline and the silent override: strong with no override, and an override that matches Tier.
  quiet(send(REV), 'strong, no override');
  quiet(send(REV, {}, { model: 'claude-sonnet-5-5' }), 'an override at strong matches Tier strong');
  const hard = { basis: 'judgment; surface=none; ambiguity=high; reversible=no' };
  quiet(send(REV, { ...hard, tier: 'premium' }, { model: 'opus' }), 'premium with opus');
  quiet(send(REV, { ...hard, tier: 'premium', override: 'x' }, { model: 'opus' }), 'premium with opus and an override line');

  // Tier and the effective rung must agree.
  denied(send(REV, { ...hard, tier: 'premium' }), /Tier: premium but the dispatch runs at strong.*pass model "opus"/, 'premium with no model');
  denied(send(REV, { tier: 'strong' }, { model: 'opus' }), /Tier: strong but the dispatch runs at premium.*omit the model override/, 'strong with opus');
  denied(send(REV, { tier: 'frontier' }, { model: 'opus' }), /Tier: frontier but the dispatch runs at premium.*pass model "fable"/, 'frontier with opus');
  denied(send(REV, { tier: 'mid' }), /Tier: mid but the dispatch runs at strong/, 'a Tier below the agent floor');
  denied(send(REV, { tier: 'ultra' }), /"ultra" is not a rung/, 'an unknown Tier');

  // An override below the agent floor, in the AGENT_MODEL_FLOORS sense: sonnet ranks mid.
  denied(send(REV, { tier: 'mid' }, { model: 'sonnet' }), /"sonnet" runs code-ops-suite:reviewer at mid, below its strong floor/, 'sonnet on reviewer');
  denied(send(IMP, { tier: 'light' }, { model: 'haiku' }), /"haiku" runs code-ops-suite:implementer at light, below its strong floor/, 'haiku on implementer');
  expect(!/Tier: mid but/.test(reasonOf(send(REV, { tier: 'mid' }, { model: 'sonnet' })) ?? ''), 'a below-floor override is reported once, not again as a Tier mismatch');

  // Surface is derived from Scope. A declared surface that contradicts it is denied, with or without an override.
  const gate = { scope: 'plugins/code-ops-suite/hooks/dispatch-guard.mjs and evals/dispatch-guard/.', basis: 'judgment; surface=none; ambiguity=low; reversible=yes' };
  denied(send(IMP, gate), /says surface=none but the Scope paths derive surface=gate-script/, 'a gate-script Scope with surface=none');
  denied(send(IMP, { ...gate, override: 'the lead knows better' }), /derive surface=gate-script.*does not clear a surface mismatch/, 'the same with a Route override');
  quiet(send(IMP, { ...gate, basis: 'judgment; surface=gate-script; ambiguity=low; reversible=yes' }), 'the declared surface matches Scope');
  // A derived none never contradicts a declared surface: routing up is allowed and earns an advisory at most.
  const dir = { scope: 'plugins/code-ops-suite/hooks/ and evals/dispatch-guard/', basis: 'judgment; surface=gate-script; ambiguity=low; reversible=yes' };
  advised(send(IMP, dir), /surface=gate-script but the Scope paths derive no surface; routing up is allowed/, 'a directory-level Scope declaring gate-script');
  advised(send(IMP, { basis: 'judgment; surface=security; ambiguity=low; reversible=yes' }), /surface=security but the Scope paths derive no surface/, 'a surface declared with no Scope path behind it');
  advised(send(IMP, { ...dir, override: 'the lead knows the surface' }), /derive no surface/, 'a directory-level Scope declaring a surface, with a Route override');
  // The other direction stays denied: a Scope file that derives a surface, declared none, even with an override.
  denied(send(IMP, { scope: 'plugins/code-ops-suite/hooks/dispatch-guard.mjs', basis: 'judgment; surface=none; ambiguity=low; reversible=yes', override: 'x' }),
    /says surface=none but the Scope paths derive surface=gate-script.*does not clear a surface mismatch/, 'a gate-script file declared none with a Route override');
  denied(send(IMP, { basis: 'judgment; ambiguity=low; reversible=yes' }), /names no surface=/, 'a basis with no surface');
  denied(send(IMP, { basis: 'sorcery; surface=none; ambiguity=low; reversible=yes' }), /Route basis is not valid: kind must be one of/, 'an unknown kind');
  // A Scope path with spaces reaches the pattern whole, and a bare word never matches.
  const contract = { scope: 'Edit only the code-ops-docs/35 Contracts and Data/CONTRACTS.md file.', basis: 'judgment; surface=none; ambiguity=low; reversible=yes' };
  denied(send(IMP, contract), /derive surface=public-contract/, 'a Scope path with spaces derives public-contract');
  quiet(send(IMP, { scope: 'fix the auth flow in the parser; secrets are out of scope' }), 'prose with a bare auth word derives no surface');
  quiet(send(IMP, { scope: 'src/app.js.\nOut of scope: plugins/code-ops-suite/hooks/dispatch-guard.mjs' }), 'a path under Out of scope does not count');
  denied(send(IMP, { scope: 'src/app.js.\n  - plugins/code-ops-suite/hooks/dispatch-guard.mjs' }), /derive surface=gate-script/, 'a Scope path on a continuation line counts');
  // A line anchor on a Scope path never hides its surface.
  for (const anchored of ['scripts/lint-plugins.mjs:120-180', 'scripts/lint-plugins.mjs:120', 'scripts/lint-plugins.mjs#L120', 'scripts/lint-plugins.mjs#L120-L180',
    'see (scripts/lint-plugins.mjs:120).', 'code-ops-docs/35 Contracts and Data/CONTRACTS.md:10-20']) {
    denied(send(IMP, { scope: anchored }), /derive surface=(?:gate-script|public-contract)/, `an anchored Scope path (${anchored}) derives its surface`);
  }
  // The gate-script and public-contract paths match any case and either separator.
  for (const variant of ['Scripts/Lint-Plugins.mjs', 'scripts\\lint-plugins.mjs', '.GITHUB/Workflows/validate.yml', 'code-ops-docs\\35 Contracts and Data\\CONTRACTS.md']) {
    denied(send(IMP, { scope: variant }), /derive surface=(?:gate-script|public-contract)/, `a case or separator variant (${variant}) derives its surface`);
  }
  // A Scope with an empty colon value reads the bullets after its blank lines.
  denied(send(IMP, { scope: '\n\n- plugins/code-ops-suite/hooks/dispatch-guard.mjs' }), /derive surface=gate-script/, 'a blank-line Scope reads its bullets');
  quiet(send(IMP, { scope: '\n\nObjective: x\n- plugins/code-ops-suite/hooks/dispatch-guard.mjs' }), 'an empty Scope followed by a label reads no bullets');
  // Any Label: line ends the Scope block, not only the closed list; a drive-letter path is no label.
  quiet(send(IMP, { scope: 'src/app.js.\nContext: see plugins/code-ops-suite/hooks/dispatch-guard.mjs for background' }), 'a non-stop label ends the Scope');
  quiet(send(IMP, { scope: 'src/app.js.\n- Notes (read only): scripts/lint-plugins.mjs' }), 'a bulleted label with a qualifier ends the Scope');
  denied(send(IMP, { scope: 'src/app.js.\nC:/work/code-ops/scripts/lint-plugins.mjs' }), /derive surface=gate-script/, 'a drive-letter continuation line still counts');
  // A declared surface that is not a surface is malformed.
  denied(send(IMP, { basis: 'judgment; surface=everywhere; ambiguity=low; reversible=yes' }), /surface=everywhere, which is not a surface/, 'an unknown declared surface');
  // The reviewer declared as a lower kind is raised to review before routing, then denied when under-routed.
  const swap = { scope: 'src/auth/login.js', basis: 'judgment; surface=security; ambiguity=low; reversible=yes' };
  denied(sendRaw(REV, swap), /below premium at high effort \(rule 7a/, 'a reviewer declared as judgment on a security surface routes as a review');
  advised(sendRaw(REV, { basis: 'execution; surface=none; ambiguity=low; reversible=yes' }), /kind=execution is below the minimum for code-ops-suite:reviewer; routing it as review/, 'the kind raise is advised');
  quiet(sendRaw(IMP, swap), 'an agent with no minimum kind keeps its declared kind');
  // An override that cannot be ranked leaves Tier unchecked, and the guard says so.
  for (const model of ['inherit', 'default', 'gpt-x']) {
    advised(send(IMP, {}, { model }), new RegExp(`override "${model}" cannot be ranked`), `an unrankable override (${model}) with Tier set`);
  }

  // Premium triggers. 7a (review on a surface) is never cleared by a Route override.
  const secReview = { scope: 'src/auth/login.js', basis: 'review; surface=security; ambiguity=low; reversible=yes' };
  denied(send(REV, secReview), /below premium at high effort \(rule 7a/, 'a security review at strong');
  denied(send(REV, { ...secReview, override: 'cost' }), /below premium at high effort \(rule 7a.*does not clear a surface trigger/, 'a security review at strong with a Route override');
  quiet(send(REV, { ...secReview, tier: 'premium' }, { model: 'opus' }), 'a security review at premium');
  // 7d (public-contract judgment at high ambiguity) is a surface trigger too.
  const pc = { scope: 'code-ops-docs/35 Contracts and Data/CONTRACTS.md', basis: 'judgment; surface=public-contract; ambiguity=high; reversible=yes' };
  denied(send(IMP, { ...pc, override: 'cost' }), /rule 7d.*does not clear a surface trigger/, 'a 7d unit with a Route override');
  // 7b (high ambiguity, not reversible) is cleared by an override; effort is the other half of the check.
  denied(send(IMP, hard), /below premium at high effort \(rule 7b/, 'a 7b unit at strong');
  quiet(send(IMP, { ...hard, override: 'one more strong try first' }), 'a 7b unit at strong with a Route override');
  denied(send(IMP, { basis: 'judgment; surface=none; ambiguity=high; reversible=yes', effort: 'medium' }), /below strong at high effort \(rule 5/, 'effort below the routed effort');
  advised(send(IMP, { basis: 'judgment; surface=none; ambiguity=high; reversible=yes', effort: 'medium', override: 'small unit' }), /^Dispatch guard: Effort: medium is below the high that code-ops-suite:implementer runs at[^\n]*$/,
    'effort below the routed effort with a Route override earns only the frontmatter-effort advisory');
  // 7c, from the ledger: a failed strong attempt on this unit makes the next attempt 2.
  seed([
    { status: 'dispatched', agent_id: 'a1', agent_type: IMP, session_id: 'sess-1', unit: 'u-retry', requestedTier: 'strong' },
    { status: 'failed', agent_id: 'a1', agent_type: IMP, session_id: 'sess-1' },
  ]);
  denied(send(IMP, { unit: 'u-retry' }), /below premium at high effort \(rule 7c/, 'attempt 2 after a failed strong attempt');
  quiet(send(IMP, { unit: 'u-retry', override: 'the failure was the harness' }), 'attempt 2 with a Route override');
  quiet(send(IMP, { unit: 'u-retry', tier: 'premium' }, { model: 'opus' }), 'attempt 2 at premium');
  quiet(send(IMP, { unit: 'u-other' }), 'a different unit is still attempt 1');

  // A rung above the route is an advisory, never a denial.
  advised(send(IMP, { tier: 'premium' }, { model: 'opus' }), /Tier: premium is above the routed strong \(rule 4\); it costs more/, 'premium on a unit that routes strong');

  // Effort the Agent tool can deliver.
  denied(send('code-ops-suite:steady', { effort: 'high' }), /Effort: high is above the medium that code-ops-suite:steady runs at.*Workflow agent\(/, 'Agent Effort above the frontmatter effort');
  advised(send('code-ops-suite:steady', { effort: 'low', override: 'small unit' }),/Effort: low is below the medium that code-ops-suite:steady runs at.*Workflow agent\(\)/, 'Agent Effort below the frontmatter effort');
  quiet(send('code-ops-suite:steady', { effort: 'medium' }), 'Agent Effort equal to the frontmatter effort');
  // The Agent call's own effort (CLI 2.1.292 and later) replaces the frontmatter effort.
  quiet(send('code-ops-suite:steady', { effort: 'high' }, { effort: 'high' }), 'Agent effort that raises the run to the brief Effort');
  quiet(send('code-ops-suite:steady', { effort: 'low', override: 'small unit' }, { effort: 'low' }), 'Agent effort that lowers the run to the brief Effort');
  denied(send('code-ops-suite:steady', { effort: 'high' }, { effort: 'medium' }), /Effort: high is above the medium that the Agent call passes\. Pass effort: "high"/, 'Agent effort below the brief Effort');
  denied(send('code-ops-suite:steady', { effort: 'medium' }, { effort: 'xhigh' }), /The Agent call passes effort "xhigh"; pass low, medium, or high/, 'Agent effort above high');
  denied(send(IMP, { effort: 'xhigh' }), /Effort: xhigh is above high/, 'a brief Effort of xhigh');
  denied(send(IMP, { effort: 'max', override: 'x' }), /Effort: max is above high/, 'a brief Effort of max with a Route override');

  // One frontier dispatch per run, counted from the ledger.
  advised(send(IMP, { tier: 'frontier' }, { model: 'fable' }), /Tier: frontier is above the routed strong/, 'the first frontier dispatch');
  seed([{ status: 'dispatched', agent_id: 'f1', agent_type: IMP, session_id: 'sess-1', unit: 'u9', requestedTier: 'frontier', appliedModel: 'fable' }]);
  denied(send(IMP, { tier: 'frontier' }, { model: 'fable' }), /frontier dispatch already ran in this session/, 'a second frontier dispatch');
  quiet(send(IMP, { tier: 'premium', basis: hard.basis }, { model: 'opus' }), 'a premium dispatch after a frontier one');
  // A ledger row counts on its applied model alone, with no requestedTier.
  seed([{ status: 'dispatched', agent_id: 'f3', agent_type: IMP, session_id: 'sess-1', unit: 'u10', appliedModel: 'fable' }]);
  denied(send(IMP, { tier: 'frontier' }, { model: 'fable' }), /frontier dispatch already ran in this session \(1 in the ledger\)/, 'a frontier row matched on appliedModel alone');
  // The effective rung counts when the brief Tier is empty, so no Tier check fires first.
  denied(send(IMP, { tier: '' }, { model: 'fable' }), /frontier dispatch already ran in this session/, 'a frontier override with an empty Tier');
  seed([]);
  quiet(send(IMP, { tier: '' }, { model: 'fable' }), 'a frontier override with an empty Tier and no prior frontier dispatch');
  seed([]);
  seed([{ status: 'dispatched', agent_id: 'f1', agent_type: IMP, session_id: 'other-session', requestedTier: 'frontier' }], 'other-session');
  advised(send(IMP, { tier: 'frontier' }, { model: 'fable' }), /Tier: frontier is above/, 'a frontier dispatch in another session does not count');

  // An agent whose Contract does not list Tier keeps today's behavior exactly.
  const plainBrief = 'Scope: plugins/code-ops-suite/hooks/dispatch-guard.mjs\nObjective: x\nRound budget: 9\nReport cap: 1\nReport path: r.md\nExpected return: x\n'
    + 'Tier: ultra\nEffort: xhigh\nRoute basis: nonsense';
  for (const model of ['haiku', 'opus', 'fable', 'x']) {
    quiet(parseOut(runHook(dispatchCall({ subagent_type: 'code-ops-suite:plain', prompt: plainBrief, model }), { home, pluginRoot: suiteRoot, env: { CODE_OPS_HOME: home } })),
      `an agent with no Tier requirement and model ${model}`);
  }

  // Workflow: a literal model below the floor of its literal agentType denies; the floor and above pass.
  const runContract = contractLine(home);
  const wf = (script, guard) => parseOut(runHook(dispatchCall({ script }, { tool_name: 'Workflow' }), { home, pluginRoot: suiteRoot, guard }));
  denied(wf(`agent({ agentType: '${REV}', model: 'sonnet', prompt: 'x' });`), /call 1 sets model "sonnet" \(mid\), below the strong floor of code-ops-suite:reviewer/, 'a Workflow model below the floor');
  denied(wf(`agent({ agentType: '${REV}', prompt: 'x' });\nagent({ agentType: 'code-ops-suite:plain', model: 'haiku', prompt: 'x' });`), /call 2 sets model "haiku" \(light\), below the mid floor/, 'the failing call is named');
  quiet(wf(`${runContract}\nagent({ agentType: '${REV}', model: 'claude-sonnet-5-5', effort: 'high' }); agent({ agentType: '${REV}', model: 'opus' }); agent({ agentType: 'code-ops-suite:plain', model: 'sonnet' });`), 'Workflow models at or above their floors');
  quiet(wf(`${runContract}\nagent({ agentType: 'no-such:agent', model: 'haiku' }); agent({ agentType: '${REV}', model: 'unknown-model' });`), 'a model or agent the guard cannot rank');
  advised(wf(`agent({ agentType: '${REV}', model: choice });`), /not a literal string/, 'a Workflow model that is a variable');
  // One frontier dispatch per run covers a Workflow: literal frontier models in the script plus frontier ledger rows.
  seed([]);
  const fableCall = `agent({ agentType: '${REV}', model: 'fable' });`;
  quiet(wf(fableCall), 'one literal frontier Workflow call');
  denied(wf(`${fableCall}\n${fableCall}`), /frontier model on 2 agent\(\) call\(s\) and 0 frontier dispatch/, 'two literal frontier Workflow calls');
  quiet(wf(`${runContract}\n${fableCall}\nagent({ agentType: '${REV}', model: 'opus' });`), 'one frontier and one premium Workflow call');
  seed([{ status: 'dispatched', agent_id: 'f4', agent_type: IMP, session_id: 'sess-1', unit: 'u11', appliedModel: 'fable' }]);
  denied(wf(fableCall), /frontier model on 1 agent\(\) call\(s\) and 1 frontier dispatch\(es\) already ran/, 'a frontier Workflow call after a frontier ledger row');
  quiet(wf(`agent({ agentType: '${REV}', model: 'opus' });`), 'a premium Workflow call after a frontier ledger row');
  seed([]);
  const warned = wf(`agent({ agentType: '${REV}', model: 'sonnet' });`, 'warn');
  expect(Object.hasOwn(warned?.hookSpecificOutput ?? {}, 'additionalContext') && !Object.hasOwn(warned?.hookSpecificOutput ?? {}, 'permissionDecision'),
    `warn mode must downgrade the Workflow model denial, got ${JSON.stringify(warned)}`);

  // spawn_subagent and spawn_agent: a literal xhigh or max effort denies; high passes.
  const spawn = (tool, input) => parseOut(runHook(dispatchCall({ prompt: 'Round budget: 5', ...input }, { tool_name: tool }), { home, pluginRoot: suiteRoot }));
  denied(spawn('spawn_subagent', { effort: 'xhigh' }), /spawn_subagent sets effort above high/, 'spawn_subagent xhigh');
  denied(spawn('spawn_agent', { reasoning_effort: 'max' }), /spawn_agent sets reasoning_effort above high/, 'spawn_agent max');
  quiet(spawn('spawn_subagent', { effort: 'high' }), 'spawn_subagent high');
  quiet(spawn('spawn_agent', { reasoning_effort: 'low' }), 'spawn_agent low');

  // spawn_subagent and spawn_agent run the Tier and surface checks. Grok does not run the
  // Claude model named in the agent file, so a valid Tier is not rejected for that mismatch.
  const grokSpawn = (type, over) => parseOut(runHook(dispatchCall({
    subagent_type: type, prompt: brief(over),
  }, { tool_name: 'spawn_subagent' }), { home, pluginRoot: suiteRoot, grok: true, env: { CODE_OPS_HOME: home } }));
  quiet(grokSpawn(IMP, {}), 'a Grok implementer at Tier strong is silent');
  advised(grokSpawn(IMP, { tier: 'frontier' }), /Tier: frontier is above the routed strong/, 'a Grok frontier Tier does not demand a Claude model');
  expect(!/pass model/.test(contextOf(grokSpawn(IMP, { tier: 'frontier' })) ?? ''), 'a Grok frontier Tier must not ask for a Claude model');
  denied(grokSpawn(REV, { scope: 'src/auth/login.js', basis: 'review; surface=security; ambiguity=low; reversible=yes', tier: 'strong' }),
    /below premium at high effort \(rule 7a/, 'a Grok security review at strong still routes up');
  denied(parseOut(runHook(dispatchCall({
    subagent_type: IMP, prompt: brief({ tier: 'premium' }),
  }, { tool_name: 'spawn_agent' }), { home, pluginRoot: suiteRoot, env: { CODE_OPS_HOME: home } })),
    /Tier: premium but the dispatch runs at strong/, 'spawn_agent premium without a model still matches the frontmatter rung');

  // Warn mode downgrades every routing denial to context.
  const lax = send(REV, { tier: 'mid' }, { model: 'sonnet' }, { guard: 'warn' });
  expect(Object.hasOwn(lax?.hookSpecificOutput ?? {}, 'additionalContext') && !Object.hasOwn(lax?.hookSpecificOutput ?? {}, 'permissionDecision'),
    `warn mode must downgrade a routing denial, got ${JSON.stringify(lax)}`);

  // Fail open: with the vendored libraries absent, the routing checks skip and the field denial stays.
  const iso = join(home, 'iso', 'hooks');
  mkdirSync(iso, { recursive: true });
  for (const file of ['dispatch-guard.mjs', 'agent-file.mjs']) writeFileSync(join(iso, file), readFileSync(join(suite, 'hooks', file), 'utf8'));
  const bare = (input) => spawnSync('node', [join(iso, 'dispatch-guard.mjs')], {
    input: JSON.stringify(dispatchCall(input)), encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CODE_OPS_HOME: home, CODE_OPS_DISPATCH_GUARD: '', CLAUDE_PLUGIN_ROOT: suiteRoot },
  });
  let res = bare({ subagent_type: REV, prompt: brief({ tier: 'mid' }), model: 'sonnet' });
  expect(res.status === 0 && res.stdout === '', `a missing routing library must skip the routing checks, got ${res.status}/${JSON.stringify(res.stdout)}`);
  res = bare({ subagent_type: REV, prompt: 'Round budget: 5', model: 'sonnet' });
  expect(/missing: Scope/.test(parseOut(res)?.hookSpecificOutput?.permissionDecisionReason ?? ''), `the field denial must survive a missing routing library, got ${JSON.stringify(res.stdout)}`);
  // Each library alone: a copy of the suite scripts with one file removed skips the routing checks; the full copy denies.
  const isolated = (name, without) => {
    const root = join(home, name);
    mkdirSync(join(root, 'hooks'), { recursive: true });
    for (const file of ['dispatch-guard.mjs', 'agent-file.mjs']) writeFileSync(join(root, 'hooks', file), readFileSync(join(suite, 'hooks', file), 'utf8'));
    cpSync(join(suite, 'scripts'), join(root, 'scripts'), { recursive: true });
    if (without) rmSync(join(root, 'scripts', without));
    return (input) => spawnSync('node', [join(root, 'hooks', 'dispatch-guard.mjs')], {
      input: JSON.stringify(dispatchCall(input)), encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home, CODE_OPS_HOME: home, CODE_OPS_DISPATCH_GUARD: '', CLAUDE_PLUGIN_ROOT: suiteRoot },
    });
  };
  const below = { subagent_type: REV, prompt: brief({ tier: 'mid' }), model: 'sonnet' };
  expect(parseOut(isolated('iso-full')(below))?.hookSpecificOutput?.permissionDecision === 'deny', 'the isolated full copy of the scripts must still deny, or the fail-open cases prove nothing');
  for (const missing of ['route-unit.mjs', 'agent-ledger.mjs']) {
    res = isolated(`iso-no-${missing}`, missing)(below);
    expect(res.status === 0 && res.stdout === '', `a missing ${missing} must skip the routing checks, got ${res.status}/${JSON.stringify(res.stdout)}`);
  }
  cleanup();
  console.log('ok   routing: tier against rung, floor, surface from Scope, 7a-7d with the override rule, effort, frontier count, Workflow model, spawn effort, and an agent without Tier is untouched');
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

// ---------------------------------------------------------------- decision rows

// Every case above wrote rows to the shared file. One row per deny or advisory output, ids and
// counts only, and every gate in the hook's table fired at least once across the cases.
{
  const rows = existsSync(rowsFile) ? readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  expect(rows.length === expectedRows && rows.length > 0, `one row per deny or advisory output: expected ${expectedRows}, wrote ${rows.length}`);

  const KEYS = ['decision', 'gates', 'ledger', 'subagent', 'tool', 'ts', 'sessionId', 'v'].sort();
  const known = [...readFileSync(hook, 'utf8').slice(readFileSync(hook, 'utf8').indexOf('const GATES = ['))
    .split('\n];')[0].matchAll(/^ {2}\['([a-z-]+)', \//gm)].map((match) => match[1]);
  expect(known.length >= 12, `the eval must read the gate table from the hook, found ${known.length} ids`);
  const bad = rows.filter((row) => {
    const keys = Object.keys(row).filter((key) => key !== 'workflow').sort();
    return JSON.stringify(keys) !== JSON.stringify(KEYS) || row.v !== 1 || !['deny', 'advisory'].includes(row.decision)
      || !Number.isFinite(Date.parse(row.ts)) || !Array.isArray(row.gates) || !row.gates.length || !Array.isArray(row.ledger)
      || row.gates.some((id) => !known.includes(id)) || row.ledger.some((id) => !/^[A-Z0-9]+-\d+$/.test(id))
      || typeof row.subagent !== 'boolean' || (row.sessionId !== null && typeof row.sessionId !== 'string');
  });
  expect(!bad.length, `every row must carry exactly the contract fields and known ids, got ${JSON.stringify(bad[0])}`);
  const unclassified = rows.filter((row) => row.gates.includes('other'));
  expect(!unclassified.length, `no output may fall outside the gate table, got ${JSON.stringify(unclassified[0])}`);
  const fired = new Set(rows.flatMap((row) => row.gates));
  const silentGates = known.filter((id) => !fired.has(id));
  expect(!silentGates.length, `every gate must fire in at least one case, never fired: ${silentGates.join(', ')}`);
  expect(rows.some((row) => row.decision === 'deny') && rows.some((row) => row.decision === 'advisory'), 'the rows must include both denials and advisories');
  expect(rows.some((row) => row.subagent) && rows.some((row) => !row.subagent), 'the rows must mark subagent and main-thread decisions');
  console.log(`ok   ${rows.length} decision rows match ${expectedRows} deny or advisory outputs; ${known.length} gates fired, none outside the table`);

  // A Workflow row carries the call counts and nothing else of the script.
  const { home, cleanup } = fakeHome();
  const before = rows.length;
  const secret = 'SENTINEL-ROW-TEXT-8841';
  const script = `agent({ agentType: 'code-ops-suite:implementer', prompt: '${secret}' });\nagent(options);\nagent({ prompt: '${secret}' });`;
  const r = runHook(dispatchCall({ script }, { tool_name: 'Workflow', session_id: 'sess-W', cwd: 'C:/secret-project-dir' }), { home });
  const after = readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean);
  const last = JSON.parse(after.at(-1) ?? 'null');
  expect(after.length === before + 1 && r.stdout !== '', `a denied Workflow must write one row, wrote ${after.length - before}`);
  expect(last?.tool === 'Workflow' && last.decision === 'deny' && last.sessionId === 'sess-W' && last.gates.includes('wide-type')
    && last.workflow?.calls === 3 && last.workflow.unreadable === 1 && last.workflow.contract === false,
    `the Workflow row must carry the call and unreadable counts and no contract line, got ${JSON.stringify(last)}`);
  runHook(dispatchCall({ script: `// Run contract: x.json\n${script}` }, { tool_name: 'Workflow', session_id: 'sess-W', cwd: 'C:/secret-project-dir' }), { home });
  const afterLine = readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean);
  const withLine = JSON.parse(afterLine.at(-1) ?? 'null');
  expect(withLine?.workflow?.contract === true && withLine.gates.includes('workflow-contract'),
    `a Workflow with a bad contract line must record the flag and the advisory gate, got ${JSON.stringify(withLine)}`);
  expect(!/SENTINEL|secret-project-dir|agentType|prompt/.test(readFileSync(rowsFile, 'utf8')), 'a row must carry no script, brief, or path text');
  console.log('ok   a Workflow row carries the call and unreadable counts and no script or path text');

  // The off switch, the default location, and a write failure.
  const offRun = runHook(dispatchCall({ subagent_type: 'general-purpose', prompt: 'x' }), { home, env: { CODE_OPS_RECEIPTS: 'off' } });
  expect(offRun.stdout !== '' && !existsSync(join(home, '.claude', 'code-ops', 'guard-decisions.jsonl')) && readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).length === afterLine.length,
    'CODE_OPS_RECEIPTS=off must still decide but write no row');
  const defaulted = runHook(dispatchCall({ subagent_type: 'general-purpose', prompt: 'x' }), { home, env: { CODE_OPS_RECEIPTS: '' } });
  const homeRows = join(home, '.claude', 'code-ops', 'guard-decisions.jsonl');
  expect(defaulted.stdout !== '' && existsSync(homeRows) && JSON.parse(readFileSync(homeRows, 'utf8').trim()).gates.includes('wide-type'),
    'with no CODE_OPS_RECEIPTS the row goes to ~/.claude/code-ops/guard-decisions.jsonl');
  writeFileSync(join(home, 'file-not-dir'), 'x');
  const unwritable = runHook(dispatchCall({ subagent_type: 'general-purpose', prompt: 'x' }), { home, env: { CODE_OPS_RECEIPTS: join(home, 'file-not-dir', 'r.jsonl') } });
  expect(unwritable.status === 0 && /"permissionDecision":"deny"/.test(unwritable.stdout), `an unwritable rows directory must fail open and still deny, got ${unwritable.status}/${unwritable.stdout}`);
  console.log('ok   CODE_OPS_RECEIPTS=off writes no row, the default location holds the row, and a write failure still decides');
  cleanup();
}

rmSync(rowsDir, { recursive: true, force: true });

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\ndispatch-guard eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\ndispatch-guard eval passed');
