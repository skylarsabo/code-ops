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
//     Workflow script with an agent() call but no agentType is denied the same way; a `model`
//     override (naming the agent's declared tier when a definition declares one) and a prompt
//     with no Round budget stay advisory clauses in the same output, and warn mode downgrades
//     every denial to an advisory;
//   - a dispatch to a suite agent (`<plugin>:<agent>` in any of the four plugins, resolved in the
//     repo layout and the installed cache layout) whose prompt lacks a field its `## Contract`
//     `Brief requires:` line lists is denied, warn mode downgrades it, and unknown, bare,
//     non-suite, and contract-less agents pass; the denial names the exact `co brief <type>`
//     command and ends with one `Label:` line per missing field, and with every field missing
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
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

function runHook(payload, { home, guard, budget, ceiling, grok = false, pluginRoot = suite, env: extra = {} } = {}) {
  const env = { ...process.env };
  delete env.CODE_OPS_DISPATCH_GUARD;
  delete env.CODE_OPS_ROUND_BUDGET;
  delete env.CODE_OPS_CONTEXT_CEILING;
  delete env.GROK_PLUGIN_ROOT;
  delete env.CODE_OPS_LEGACY_PATHS;
  Object.assign(env, extra);
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

// A brief that carries every field the suite agents' `Brief requires:` lines name.
const FULL_BRIEF = 'Scope: one file.\nObjective: fix it.\nRound budget: 25 tool rounds\n'
  + 'Report cap: 200 words.\nReport path: r.md\nExpected return: a verdict line.';

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
  expect(/model override/i.test(text ?? ''), `the reason must flag the model override, got ${text}`);
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
  expect(!Object.hasOwn(out?.hookSpecificOutput ?? {}, 'permissionDecision') && /model override/i.test(text) && !/general-purpose/.test(text),
    `a stated Wide-surface reason must allow the dispatch and drop the wide clause, got ${JSON.stringify(out)}`);
  out = parseOut(runHook(dispatchCall({ ...leaky, prompt: 'Fix the parser.\nWide-surface reason:\n' }), { home }));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `an empty Wide-surface reason must still deny, got ${JSON.stringify(out)}`);
  out = parseOut(runHook(dispatchCall({ ...leaky, prompt: 'Round budget: 5\n  Wide-surface reason: indented' }), { home }));
  expect(out?.hookSpecificOutput?.permissionDecision === 'deny', `the reason must start its own line, got ${JSON.stringify(out)}`);

  // A code-ops-suite agent's declared tier is named from its own definition.
  out = parseOut(runHook(dispatchCall({ prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:explorer', model: 'opus' }), { home }));
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
  const clean = runHook(dispatchCall({ description: 'build it', prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:implementer' }), { home });
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
  let out = parseOut(runHook(dispatchCall({ prompt: brief('Report path'), subagent_type: 'code-ops-suite:implementer' }), { home }));
  let text = reasonOf(out) ?? '';
  expect(deny(out) && /missing: Report path;/.test(text) && /code-ops-suite:implementer Contract/.test(text),
    `a brief missing a Contract field must deny and name it, got ${JSON.stringify(out)}`);
  // The denial ends with a skeleton of only the missing labels, one per line, and names the
  // exact `co brief <type>` command for the full template.
  expect(text.endsWith('\nReport path:') && text.split('\n').length === 2,
    `the field denial must end with one skeleton line per missing label, got ${JSON.stringify(text)}`);
  expect(text.includes(`"${join(suite, 'scripts', 'co.mjs')}" brief code-ops-suite:implementer\``),
    `the field denial must name the exact co brief command, got ${JSON.stringify(text)}`);

  // With every field missing, the skeleton is the full template `co brief` prints, in contract
  // order, and the Round budget advisory does not split it.
  out = parseOut(runHook(dispatchCall({ prompt: 'no labels here', subagent_type: 'code-ops-suite:implementer', model: 'x' }), { home }));
  const template = spawnSync('node', [join(root, 'scripts', 'co.mjs'), 'brief', 'code-ops-suite:implementer'], { encoding: 'utf8' });
  const skeleton = (reasonOf(out) ?? '').split('\n').slice(1).join('\n');
  expect(deny(out) && template.status === 0 && skeleton === template.stdout.trimEnd()
    && skeleton === 'Scope:\nObjective:\nRound budget:\nReport cap:\nReport path:\nExpected return:',
    `the full skeleton must equal co brief's template, got ${JSON.stringify(skeleton)} vs ${JSON.stringify(template.stdout)}`);
  // An advisory-only output carries no skeleton.
  out = parseOut(runHook(dispatchCall({ prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:implementer', model: 'x' }), { home }));
  expect(!deny(out) && /model override/.test(contextOf(out) ?? '') && !(contextOf(out) ?? '').includes('\n'),
    `an advisory-only dispatch must carry no skeleton, got ${JSON.stringify(out)}`);

  // Every field present passes, including loose forms: case, bold, a parenthetical, list
  // markers, leading whitespace, and a markdown heading.
  const loose = 'scope (edit authority): one file.\n## Objective\nfix it.\n**Round budget:** 10\n'
    + '- Report cap: 100 words.\n  1. Report path: r.md\n* EXPECTED RETURN: a line.';
  let r = runHook(dispatchCall({ prompt: loose, subagent_type: 'code-ops-suite:implementer' }), { home });
  expect(r.status === 0 && r.stdout === '', `a brief with every field in loose form must pass, got ${JSON.stringify(r.stdout)}`);

  // A label inside a longer word, or with no colon, does not count.
  out = parseOut(runHook(dispatchCall({ prompt: brief('Scope').replace('Objective:', 'Microscope: x\nObjective is'), subagent_type: 'code-ops-suite:implementer' }), { home }));
  expect(deny(out) && /missing: Scope, Objective;/.test(reasonOf(out) ?? ''), `an embedded or colonless label must not count, got ${JSON.stringify(out)}`);

  // The label must start its line: `Out of scope:`, an inline mid-sentence `Scope:`, and a
  // field placed after another field on the same line do not count.
  for (const [label, line] of [
    ['Out of scope', 'Out of scope: docs'],
    ['mid-sentence', 'Edit only the files relevant to Scope: a path'],
    ['after another field', 'Objective: fix it. Scope: one file.'],
  ]) {
    out = parseOut(runHook(dispatchCall({ prompt: `${brief('Scope')}\n${line}`, subagent_type: 'code-ops-suite:implementer' }), { home }));
    expect(deny(out) && /missing: Scope;/.test(reasonOf(out) ?? ''), `${label} must not satisfy Scope, got ${JSON.stringify(out)}`);
  }
  // A bold list item with a parenthetical, and a heading, do count.
  for (const line of ['- **Scope (edit authority):** x', '## Scope']) {
    r = runHook(dispatchCall({ prompt: `${brief('Scope')}\n${line}`, subagent_type: 'code-ops-suite:implementer' }), { home });
    expect(r.status === 0 && r.stdout === '', `${JSON.stringify(line)} must satisfy Scope, got ${JSON.stringify(r.stdout)}`);
  }

  // A field denial that names Round budget carries no separate Round budget advisory.
  out = parseOut(runHook(dispatchCall({ prompt: brief('Round budget'), subagent_type: 'code-ops-suite:implementer' }), { home }));
  text = reasonOf(out) ?? '';
  expect(deny(out) && /missing: Round budget;/.test(text) && !/No Round budget/.test(text),
    `a Round budget field denial must not repeat as an advisory, got ${JSON.stringify(out)}`);

  // Warn mode downgrades the denial to an advisory.
  out = parseOut(runHook(dispatchCall({ prompt: brief('Objective'), subagent_type: 'code-ops-suite:implementer' }), { home, guard: 'warn' }));
  expect(!deny(out) && /missing: Objective;/.test(contextOf(out) ?? '') && (contextOf(out) ?? '').endsWith('\nObjective:'),
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
  out = parseOut(runHook(dispatchCall({ prompt: 'Round budget: 5', subagent_type: 'code-ops-suite:implementer' }), { home, pluginRoot: suiteRoot }));
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
  const lead = runHook(dispatchCall({ prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:implementer' }, { cwd }), { home, budget: 3 });
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
  const clean = { description: 'build it', prompt: FULL_BRIEF, subagent_type: 'code-ops-suite:implementer' };
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
function legacyRepo({ manifest, forwarding = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'legacy-repo-'));
  mkdirSync(join(repo, '.git'));
  const system = join(repo, 'hub', '98 System');
  mkdirSync(system, { recursive: true });
  const evidence = [{ kind: 'external', ref: 'fixture' }];
  writeFileSync(join(system, 'DOCS_MANIFEST.json'), manifest ?? JSON.stringify({
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
