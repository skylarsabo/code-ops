#!/usr/bin/env node
// PreToolUse hook: the mechanical backstop for the three dispatch-level token leaks the
// 2026-09-18 cross-project transcript audit measured (see "Three readings follow" in
// MEASUREMENTS.md). The brief's Round budget was advisory and did not bind (one operative
// spent 71 tool uses against a 40-round budget); a dispatch-level `model` override silently
// replaced an agent's declared tier; and a wide-surface or context-inheriting operative
// started 33,000 to 39,000 tokens above a restricted agent on every turn.
//
// TWO BEHAVIOURS, ONE REGISTRATION, because every registered PreToolUse command spawns a
// process per tool call on every thread:
//   1. ROUND COUNTER, inside a subagent only (`agent_id` present). It counts that subagent's
//      tool calls. At the budget, and at every further 20 rounds, it injects one line telling
//      the operative to checkpoint and return so the lead can respawn a fresh one. At three
//      times the budget it denies further tool calls.
//   2. DISPATCH ADVISORIES, on the main thread only (`agent_id` absent) and only for the
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
// STATE. One counter file per subagent under `<host home>/.claude/code-ops/dispatch/<project
// slug>/<agent id slug>.rounds`, the storage convention `handoffMarkerPath`
// (scripts/transcript-lib.mjs) sets for the sibling hooks. The count is the file's byte
// length, appended one byte per tool call, so two concurrent tool calls from the same
// subagent cannot lose a round the way a read-modify-write of a JSON counter would. Distinct
// subagents have distinct `agent_id` values and so never share a counter. The slug helper is
// duplicated from `projectSlug` rather than imported, because this hook runs on every tool
// call on every thread and must not pay a module import to decide it has nothing to do.
// deferred(one small file per subagent per project, never swept, so a long-lived checkout
// accumulates a few hundred bytes per operative; sweep them from session-receipt.mjs at
// SessionEnd if the directory ever grows enough to matter)
//
// FAIL-OPEN on every path: bad JSON, a missing field, an unwritable state directory, or any
// thrown error exits 0 with no output, which leaves the tool call exactly as it was.

import { appendFileSync, mkdirSync, readFileSync, statSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const DEFAULT_BUDGET = 40;
const WARN_EVERY = 20;
const STOP_MULTIPLE = 3;
const DISPATCH_TOOLS = new Set(['Agent', 'Task']);
// Agent types that start from the host's full tool surface or inherit the lead's context.
const WIDE_TYPES = new Set(['general-purpose', 'claude', 'fork']);

const slug = (value) => String(value).replace(/[^A-Za-z0-9]/g, '-');

function roundBudget() {
  const raw = Number(process.env.CODE_OPS_ROUND_BUDGET);
  return Number.isSafeInteger(raw) && raw > 0 ? raw : DEFAULT_BUDGET;
}

function counterPath(cwd, agentId) {
  return join(homedir(), '.claude', 'code-ops', 'dispatch', slug(cwd), `${slug(agentId)}.rounds`);
}

// The subagent's round count after this tool call, one appended byte per call.
function countRound(path) {
  try {
    appendFileSync(path, '.');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, '.');
  }
  return statSync(path).size;
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
function guardSubagent(payload, budget, hardStop) {
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  let used;
  try { used = countRound(counterPath(cwd, payload.agent_id)); } catch { return; }

  if (hardStop && used >= budget * STOP_MULTIPLE) {
    emit({ hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Dispatch guard: ${used} tool rounds used, ${STOP_MULTIPLE} times the `
        + `${budget}-round budget. Return your report now: what is done with file:line evidence, what `
        + 'remains, the exact next action, and any uncommitted state.',
    } });
    return;
  }
  if (used !== budget && (used < budget || (used - budget) % WARN_EVERY !== 0)) return;
  emit({ hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: `Dispatch guard: ${used} tool rounds used against a ${budget}-round budget. `
      + 'Unless your brief names a larger budget, stop at the next consistent state and checkpoint to '
      + 'your report: what is done with file:line evidence, what remains, and the exact next action. '
      + 'Then return, so the lead continues this unit in a fresh operative.',
  } });
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
      + 'drop it unless the brief names why.');
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
