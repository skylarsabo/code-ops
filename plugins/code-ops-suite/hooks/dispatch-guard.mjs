#!/usr/bin/env node
// PreToolUse hook: the mechanical backstop for the three dispatch-level token leaks the
// 2026-09-18 cross-project transcript audit measured (see "Three readings follow" in
// MEASUREMENTS.md). The brief's Round budget was advisory and did not bind (one operative
// spent 71 tool uses against a 40-round budget); a dispatch-level `model` override silently
// replaced an agent's declared tier; and a wide-surface or context-inheriting operative
// started 33,000 to 39,000 tokens above a restricted agent on every turn.
//
// THREE BEHAVIOURS, ONE REGISTRATION, because every registered PreToolUse command spawns a
// process per tool call on every thread:
//   1. BOUND ROUND COUNTER, inside a subagent whose exact `agent_id` was registered by a
//      controller. The host dispatch event does not expose the eventual child `agent_id`, so
//      the hook never guesses from timing or agent type. A controller that knows that id runs
//      `dispatch-guard.mjs register --agent-id <id> --budget <rounds>` before work begins.
//      The hook warns at that unit's bound budget and denies after a two-call checkpoint
//      allowance. `receipt --agent-id <id>` emits only allowlisted local measurements.
//   2. LEGACY ROUND COUNTER, inside every other subagent (`agent_id` present). It preserves
//      the prior environment budget, warning cadence, and three-times-budget stop as the safe
//      fallback when exact controller registration is unavailable.
//   3. DISPATCH ADVISORIES, on the main thread only (`agent_id` absent) and only for the
//      dispatch tool (`Agent`, or `Task` before the host renamed it). It never denies: it adds
//      at most three short clauses about a `model` override, a wide-surface or
//      context-inheriting agent type, and a brief with no Round budget.
//
// SWITCHES. `CODE_OPS_ROUND_BUDGET` overrides the 40-round default (a positive integer only).
// `CODE_OPS_DISPATCH_GUARD` takes `off`, `0`, or `false` (case-insensitive) to disable the
// whole hook, and `warn` to keep every advisory while lifting the hard stop. One variable
// carries both so an operator has one name to remember; the default is on, with the stop.
//
// HOST CONTRACT (confirmed against the installed host 2.1.276 bundle, byte offsets in it):
//   - Every hook input carries optional `agent_id` and `agent_type` (196890439). `agent_id` is
//     "Present only when the hook fires from within a subagent (e.g., a tool called by an
//     AgentTool worker). Absent for the main thread, even in --agent sessions", and the schema
//     itself says to key on it rather than on `agent_type`. PreToolUse extends that base with
//     `tool_name`, `tool_input`, and `tool_use_id` in the same declaration.
//   - PreToolUse `hookSpecificOutput` accepts `additionalContext` with `permissionDecision`
//     optional (196904285), so a warning needs no permission decision, and the host caps
//     `additionalContext` at 8,000 characters (201578375).
//   - A hooks.json group with an empty or absent `matcher` matches every tool (195521449).
//   - The dispatch tool is `Agent`; the host renames the older `Task` to it (195073281). Its
//     input carries `description`, `prompt`, optional `subagent_type`, and an optional `model`
//     that "Takes precedence over the agent definition's model frontmatter" (208306001).
//   That an injected `additionalContext` on an allowed subagent tool call lands in the
//   subagent's own context, rather than the lead's, is PROBABLE rather than confirmed: the
//   host collects hook `additionalContexts` independently of the permission decision
//   (201484217, 201505279) and delivers subagent hook feedback to the subagent (103817573),
//   but no single declaration states it for this event.
//
// STATE. One counter and optional binding per exact `(cwd, agent_id)` under `<host
// home>/.claude/code-ops/dispatch/<sha256 cwd>/<sha256 agent id>.{rounds,binding.json}`, the
// storage convention `handoffMarkerPath`
// (scripts/transcript-lib.mjs) sets for the sibling hooks. The count is the file's byte
// length, appended one byte per tool call, so two concurrent tool calls from the same
// subagent cannot lose a round the way a read-modify-write of a JSON counter would. The
// counter is attempted PreToolUse calls, including a call the hook denies. It is not an
// executed request, model request, token, cache, or context measurement. Distinct subagents
// never share a counter. State keys are local hashes so receipts and directory entries do not
// expose a project path or host id.
// deferred(one small file per subagent per project, never swept, so a long-lived checkout
// accumulates a few hundred bytes per operative; sweep them from session-receipt.mjs at
// SessionEnd if the directory ever grows enough to matter)
//
// FAIL-OPEN on host input and absent binding evidence. A present but malformed or conflicting
// controller binding instead fails closed for that id: it must never silently grant a larger
// budget than the controller record intended.

import { appendFileSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const DEFAULT_BUDGET = 40;
const WARN_EVERY = 20;
const STOP_MULTIPLE = 3;
const DEFAULT_CHECKPOINT_ALLOWANCE = 2;
const MAX_CHECKPOINT_ALLOWANCE = 4;
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
// Agent types that start from the host's full tool surface or inherit the lead's context.
const WIDE_TYPES = new Set(['general-purpose', 'claude', 'fork']);

const stateKey = (value) => createHash('sha256').update(String(value)).digest('hex');
const legacySlug = (value) => String(value).replace(/[^A-Za-z0-9]/g, '-');

function roundBudget() {
  const raw = Number(process.env.CODE_OPS_ROUND_BUDGET);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_BUDGET;
}

function stateDir(cwd) {
  return join(homedir(), '.claude', 'code-ops', 'dispatch', stateKey(cwd));
}

function counterPath(cwd, agentId) {
  return join(stateDir(cwd), `${stateKey(agentId)}.rounds`);
}

function legacyCounterPath(cwd, agentId) {
  return join(homedir(), '.claude', 'code-ops', 'dispatch', legacySlug(cwd), `${legacySlug(agentId)}.rounds`);
}

function bindingPath(cwd, agentId) {
  return join(stateDir(cwd), `${stateKey(agentId)}.binding.json`);
}

// The subagent's round count after this tool call, one appended byte per call. A prior slug-key
// counter is seeded once into the hashed location, so rollout cannot reset legacy enforcement.
function countRound(path, priorPath) {
  try {
    if (!existsSync(path) && existsSync(priorPath)) {
      mkdirSync(dirname(path), { recursive: true });
      try { copyFileSync(priorPath, path, constants.COPYFILE_EXCL); } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    appendFileSync(path, '.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, '.');
  }
  const current = statSync(path).size;
  const prior = callsAt(priorPath);
  // A race with an earlier migration can leave a shorter hashed counter. Counting both values
  // in that exceptional state stops early rather than reset or extend a prior enforcement.
  return current < prior ? current + prior : current;
}

function bindingState(cwd, agentId) {
  const path = bindingPath(cwd, agentId);
  try {
    if (!existsSync(path)) return { status: 'MISSING' };
    const binding = JSON.parse(readFileSync(path, 'utf8'));
    if (binding?.version !== 1 || binding?.key !== stateKey(agentId)
      || !Number.isSafeInteger(binding?.budget) || binding.budget < 1
      || !Number.isSafeInteger(binding?.allowance) || binding.allowance < 1
      || binding.allowance > MAX_CHECKPOINT_ALLOWANCE) return { status: 'INVALID' };
    return { status: 'BOUND', binding };
  } catch { return { status: 'INVALID' }; }
}

function callsAt(path) {
  try {
    const state = statSync(path);
    return state.isFile() ? state.size : 0;
  } catch { return 0; }
}

function observedCalls(cwd, agentId) {
  const paths = [counterPath(cwd, agentId), legacyCounterPath(cwd, agentId)];
  const counts = [];
  for (const path of paths) {
    try {
      const state = statSync(path);
      if (!state.isFile()) return null;
      counts.push(state.size);
    } catch (error) {
      if (error?.code !== 'ENOENT') return null;
    }
  }
  return Math.max(0, ...counts);
}

function boundLimits(binding, fallbackBudget) {
  const legacyPermitted = fallbackBudget * STOP_MULTIPLE - 1;
  const allowance = Math.min(binding.allowance, Math.max(1, legacyPermitted - 1));
  const effectiveBudget = Math.min(binding.budget, legacyPermitted - allowance);
  return { allowance, effectiveBudget, permitted: effectiveBudget + allowance };
}

function registerBinding(cwd, agentId, budget, allowance) {
  const current = bindingState(cwd, agentId);
  if (current.status === 'BOUND') return 'CONFLICT';
  if (current.status !== 'MISSING') return 'INVALID_RECORD';
  try {
    const path = bindingPath(cwd, agentId);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 1, key: stateKey(agentId), budget, allowance }) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') return 'CONFLICT';
    return 'UNAVAILABLE';
  }
  return 'BOUND';
}

// The `model:` tier an agent's own definition declares, or null when there is no readable
// definition for this type. Only the rare dispatch that carries an override reaches this.
function declaredTier(subagentType) {
  const leaf = String(subagentType ?? '').split(':').pop().trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(leaf)) return null;
  const root = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    const head = readFileSync(join(root, 'agents', `${leaf}.md`), 'utf8').slice(0, 600);
    return head.match(/^model:[ \t]*([A-Za-z0-9._-]+)[ \t]*$/m)?.[1] ?? null;
  } catch { return null; }
}

function emit(body) {
  writeSync(1, `${JSON.stringify(body)}\n`);
}

// Behaviour 1: the subagent's own tool call.
function guardSubagent(payload, fallbackBudget, hardStop) {
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const state = bindingState(cwd, payload.agent_id);
  if (state.status === 'INVALID') {
    emit({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'Dispatch guard: controller binding is malformed or conflicts. Return to the controller for a new agent identity.',
    } });
    return;
  }
  const binding = state.binding;
  const limits = binding ? boundLimits(binding, fallbackBudget) : null;
  const budget = limits?.effectiveBudget ?? fallbackBudget;
  const bound = state.status === 'BOUND';
  let used;
  try { used = countRound(counterPath(cwd, payload.agent_id), legacyCounterPath(cwd, payload.agent_id)); } catch {
    if (bound) emit({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'Dispatch guard: controller-bound counter is unavailable. Return to the controller for a new agent identity.',
    } });
    return;
  }

  const legacyCap = fallbackBudget * STOP_MULTIPLE;
  const exceedsBoundAllowance = bound && used > limits.permitted;
  if (hardStop && (exceedsBoundAllowance || (!bound && used >= legacyCap))) {
    emit({ hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: (bound
        ? `Dispatch guard: ${used} attempted tool calls used after the ${limits.allowance}-call checkpoint `
          + `allowance following the controller-bound ${budget}-round budget. Return your report now: what is done with file:line evidence, what `
        : `Dispatch guard: ${used} tool rounds used, ${STOP_MULTIPLE} times the ${budget}-round budget. Return your report now: what is done with file:line evidence, what `)
        + 'remains, the exact next action, and any uncommitted state.',
    } });
    return;
  }
  if (used !== budget && (used < budget || (used - budget) % WARN_EVERY !== 0)) return;
  emit({ hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: `Dispatch guard: ${used} tool rounds used against ${bound ? 'a controller-bound' : 'a'} ${budget}-round budget. `
      + (bound ? 'Request a controller replan; ' : 'Unless your brief names a larger budget, ')
      + 'stop at the next consistent state and checkpoint to '
      + 'your report: what is done with file:line evidence, what remains, and the exact next action. '
      + 'Then return, so the lead continues this unit in a fresh operative.',
  } });
}

function cliValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length || args.indexOf(name, index + 1) >= 0) return null;
  const value = args[index + 1];
  return typeof value === 'string' && value ? value : null;
}

function cliAgentId(args) {
  const agentId = cliValue(args, '--agent-id');
  return agentId && agentId.length <= 512 ? agentId : null;
}

function cliBudget(args) {
  const raw = cliValue(args, '--budget');
  return raw && /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

function cliAllowance(args) {
  const raw = cliValue(args, '--allowance');
  if (raw === null) return DEFAULT_CHECKPOINT_ALLOWANCE;
  return /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= MAX_CHECKPOINT_ALLOWANCE
    ? Number(raw) : null;
}

function receipt(cwd, agentId) {
  const state = bindingState(cwd, agentId);
  const binding = state.binding;
  const used = binding ? observedCalls(cwd, agentId) : 'UNKNOWN';
  const status = !binding ? state.status === 'INVALID' ? 'INVALID' : 'UNBOUND' : used === null ? 'UNAVAILABLE' : 'BOUND';
  const measurement = binding
    ? { declaredBudget: binding.budget, effectiveBudget: 'UNKNOWN', allowance: binding.allowance, calls: used ?? 'UNKNOWN', source: 'controller-registration', status }
    : { declaredBudget: 'UNKNOWN', effectiveBudget: 'UNKNOWN', allowance: 'UNKNOWN', calls: 'UNKNOWN', source: state.status === 'INVALID' ? 'controller-registration' : 'unavailable', status };
  emit({ version: 1, measurement, unobserved: { model: 'UNKNOWN', requests: 'UNKNOWN', tokens: 'UNKNOWN', cache: 'UNKNOWN', context: 'UNKNOWN' } });
}

function cliFailure(status) {
  writeSync(2, `dispatch-guard ${status}\n`);
  process.exitCode = 2;
  return true;
}

function command() {
  const [verb, ...args] = process.argv.slice(2);
  if (!verb) return false;
  const agentId = cliAgentId(args);
  if (!agentId) return cliFailure('INVALID_ARGUMENT');
  const cwd = process.cwd();
  if (verb === 'register') {
    const budget = cliBudget(args);
    const allowance = cliAllowance(args);
    if (!budget || !allowance) return cliFailure('INVALID_ARGUMENT');
    const status = registerBinding(cwd, agentId, budget, allowance);
    return status === 'BOUND' ? true : cliFailure(status);
  }
  if (verb === 'receipt' || verb === 'read') {
    receipt(cwd, agentId);
    return true;
  }
  return cliFailure('INVALID_COMMAND');
}

// Behaviour 2: the lead's own dispatch. Advisory only, never a decision.
function adviseDispatch(payload, budget) {
  const input = payload.tool_input;
  if (!input || typeof input !== 'object') return;
  const type = typeof input.subagent_type === 'string' ? input.subagent_type.trim() : '';
  const clauses = [];

  if (input.model !== undefined && input.model !== null && input.model !== '') {
    const tier = declaredTier(type);
    clauses.push(`A model override replaces the agent's declared tier${tier ? ` (${tier})` : ''}; `
      + 'verify task rationale and tier floor.');
  }
  if (!type || WIDE_TYPES.has(type.split(':').pop().toLowerCase())) {
    clauses.push(`${type || 'An unnamed type'} starts from a large default or inherited context; `
      + 'prefer code-ops-suite:implementer, explorer, reviewer, or mech.');
  }
  if (typeof input.prompt === 'string' && !/round budget/i.test(input.prompt)) {
    clauses.push(`No Round budget in the brief; the guard warns at ${budget} rounds, `
      + `stops at ${budget * STOP_MULTIPLE}.`);
  }
  if (!clauses.length) return;
  emit({ hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: `Dispatch guard: ${clauses.join(' ')}`,
  } });
}

function main() {
  if (command()) return;
  const setting = process.env.CODE_OPS_DISPATCH_GUARD ?? '';
  if (/^(off|0|false)$/i.test(setting)) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  if (!payload || typeof payload !== 'object') return;
  if (payload.hook_event_name && payload.hook_event_name !== 'PreToolUse') return;

  const budget = roundBudget();
  const agentId = payload.agent_id;
  if (typeof agentId === 'string' && agentId) {
    guardSubagent(payload, budget, !/^warn$/i.test(setting));
    return;
  }
  if (DISPATCH_TOOLS.has(payload.tool_name)) adviseDispatch(payload, budget);
}

try { main(); } catch { /* fail open */ }
