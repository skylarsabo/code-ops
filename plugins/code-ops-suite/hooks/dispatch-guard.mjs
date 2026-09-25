#!/usr/bin/env node
// PreToolUse hook: the mechanical backstop for the three dispatch-level token leaks the
// 2026-09-18 cross-project transcript audit measured (see "Three readings follow" in
// MEASUREMENTS.md). The brief's Round budget was advisory and did not bind (one operative
// spent 71 tool uses against a 40-round budget); a dispatch-level `model` override silently
// replaced an agent's declared tier; and a wide-surface or context-inheriting operative
// started 33,000 to 39,000 tokens above a restricted agent on every turn.
//
// A later audit of this repository (2026-09, ten days) found leads spending 73% of their input
// tokens on turns above 300,000 tokens of context, with the 150,000-token handoff nudge
// advisory and ignored, and reviewers averaging about 90 tool rounds, under the old 3x stop.
//
// FOUR BEHAVIOURS, ONE REGISTRATION, because every registered PreToolUse command spawns a
// process per tool call on every thread:
//   1. BOUND ROUND COUNTER, inside a subagent whose exact `agent_id` was registered by a
//      controller. The host dispatch event does not expose the eventual child `agent_id`, so
//      the hook never guesses from timing or agent type. A controller that knows that id runs
//      `dispatch-guard.mjs register --agent-id <id> --budget <rounds>` before work begins.
//      The hook warns at that unit's bound budget and denies after a two-call checkpoint
//      allowance. `receipt --agent-id <id>` emits only allowlisted local measurements.
//   2. LEGACY ROUND COUNTER, inside every other subagent (`agent_id` present). It keeps the
//      warning cadence and stops at twice the budget, the safe fallback when exact controller
//      registration is unavailable. A bound allowance never extends it. The budget is the
//      `Round budget: <n>` line of the subagent's own brief, the first user entry of its host
//      transcript, which the lead wrote. The hook reads that entry once per agent, on its first
//      counted call, and caches the result, so text the operative later reads or writes never
//      moves it. A brief budget above MAX_BRIEF_BUDGET clamps to it; a zero, conflicting, or
//      absent line, an unreadable transcript, and Grok (whose transcript layout is unverified)
//      keep the environment budget. Each fallback except an absent line or transcript adds one
//      advisory line on that first call.
//   3. CONTEXT CEILING GATE, on the main thread only (`agent_id` absent), for the dispatch tools
//      `Agent`, `Task` (its name before the host renamed it), and `Workflow`. Resident context
//      comes from `residentContext` (scripts/transcript-lib.mjs), the bounded transcript-tail
//      read hooks/handoff-card.mjs shares. At and past the ceiling the gate band is
//      `1 + floor((context - ceiling) / 150000)`, and a dispatch is denied until a handoff
//      assessment has recorded that band. A main-thread `Skill` call whose skill matches
//      `code-ops-suite:handoff` records the band current at that call; so does the CLI verb
//      `dispatch-guard.mjs assessed --session <id> --band <n>`, run from the project root, for a
//      host without a skill tool. The record only rises, so each new 150,000-token band re-gates.
//      Unreadable context, a missing transcript, or a session id outside [A-Za-z0-9._-] fails open.
//   4. DISPATCH REVIEW, on the main thread for the same tools. A wide-surface, context-inheriting,
//      or unnamed `subagent_type` on `Agent` or `Task` is denied unless the brief has a line
//      starting `Wide-surface reason:` with the reason on that line. Grok's `spawn_subagent`
//      schema has no agent-type field, so a spawn without one skips only this type check. A
//      `Workflow` script with an `agent(` call, no `agentType:`, and no `Wide-surface reason:` text is denied the same way.
//      The same review enforces the target agent's brief contract. A `subagent_type` of the form
//      `<plugin>:<agent>`, where the plugin is code-ops-suite, rigor, privacy-opsec-suite, or
//      researcher, resolves to `agents/<agent>.md` in that sibling plugin: `../<plugin>/` beside
//      this plugin's root in the repo, or `../../<plugin>/<version>/` in the installed cache, where
//      the highest all-numeric version directory wins (hooks/agent-file.mjs, shared with
//      subagent-report.mjs). When that file's `## Contract` section has a `Brief requires:` line,
//      the dispatch is denied unless the prompt carries every listed field. A field is present
//      when a line starts with its label, case-insensitive, after only whitespace, a list marker,
//      and `**` or `__`, and the label is followed by a colon, optionally after bold markers and
//      a parenthetical qualifier (`Scope (edit authority):`), or when a markdown heading line
//      starts with it. A bare, unknown, or non-suite type, an unreadable file, or an agent
//      without that line passes. A `model` override and a brief with no Round budget stay
//      advisory clauses; the Round budget advisory is dropped when a field denial already names
//      it. Every denial and advisory for one dispatch lands in one output.
//
// The warning asks for a written checkpoint (done items, each dirty path marked complete or
// partial, the exact next edit, gates run) before the stop, and the stop asks for it in the final
// report, so a runaway still stops but never leaves unrecorded half-applied work. The default
// stays role-blind: the audits above measure overruns, not a per-role need for more rounds, and
// `register --budget` and the brief's own Round budget line already bind a larger budget for one
// unit. MAX_BRIEF_BUDGET is 120: the largest measured spend is the reviewers' mean of about 90
// rounds, so a 120-round warning covers it with a third to spare, and the 240-call stop still
// bounds a runaway brief at six times the default.
//
// SWITCHES. `CODE_OPS_ROUND_BUDGET` overrides the 40-round default (a positive integer only).
// A readable brief budget overrides both; a controller binding overrides the brief.
// `CODE_OPS_DISPATCH_GUARD` takes `off`, `0`, or `false` (case-insensitive) to disable the
// whole hook, ceiling gate included, and `warn` to turn every denial except a malformed or
// unavailable controller binding into advisory text. One variable carries both so an
// operator has one name to remember; the default is on, with every denial.
// `CODE_OPS_CONTEXT_CEILING` sets the ceiling: `off`, `0`, or `false` disables only the gate,
// an integer of at least 150,000 overrides the default (200,000 on Grok, 300,000 elsewhere),
// and anything else reads as the default (`contextCeiling` in scripts/transcript-lib.mjs,
// shared with the handoff card).
//
// HOST COVERAGE. The ceiling gate and the dispatch review key on the dispatch tool names: Claude's
// `Agent`, `Task`, and `Workflow`, and Grok's `spawn_subagent` (~/.grok/docs/user-guide
// 16-subagents.md). Grok sends camelCase `toolName`, `toolInput`, and `sessionId`
// (10-hooks.md), which main() maps onto the snake_case keys. Grok sends no `agent_id`; inside
// a subagent the payload carries `subagentType` and the child session's own `sessionId`, which
// main() uses as the round counter's agent key (PROBABLE: the docs state the child session and
// the field, not a captured payload). Codex's dispatch tool name is UNVERIFIED, so there both
// behaviours stay inert unless that tool shares a name; the round counters keep the per-host
// coverage INFRASTRUCTURE.md records.
// Codex transcripts are measured through their token_count snapshots, Grok's through
// updates.jsonl, as residentContext documents. OpenCode runs its own lifecycle guard.
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
//   - The `Workflow` tool's `script` input and its `agent(` calls with an `agentType:` field
//     come from the operator's brief, not from a located declaration in that bundle
//     (UNVERIFIED), and a `Skill` call's `tool_input.skill` names the skill, as the Claude
//     host's Skill tool documents.
//   - A subagent's hook input carries the lead session's `transcript_path` (`<project>/<session
//     id>.jsonl`, 203510159), not its own. The host writes the subagent transcript at
//     `<project>/<session id>/subagents/agent-<agent_id>.jsonl` (198245300), or in a named
//     subdirectory of `subagents` (a workflow agent), which this hook does not resolve and so
//     reads as absent. Its first line is the brief: a `user` entry with a null `parentUuid`, the
//     same `agentId`, and `message.content` as a string (observed on 2.1.276).
//   That an injected `additionalContext` on an allowed subagent tool call lands in the
//   subagent's own context, rather than the lead's, is PROBABLE rather than confirmed: the
//   host collects hook `additionalContexts` independently of the permission decision
//   (201484217, 201505279) and delivers subagent hook feedback to the subagent (103817573),
//   but no single declaration states it for this event.
//
// STATE. One counter and optional binding per exact `(cwd, agent_id)` under `<host
// home>/.claude/code-ops/dispatch/<sha256 cwd>/<sha256 agent id>.{rounds,binding.json}`, one
// parsed brief budget per agent beside them (`.brief.json`, numbers and a status only, never
// brief text), and
// one assessment marker per session at `<sha256 cwd>/<sha256 session id>.assessed.json`
// (`{version: 1, band}`), the storage convention `handoffMarkerPath`
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

import { appendFileSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { agentFile } from './agent-file.mjs';

const DEFAULT_BUDGET = 40;
const WARN_EVERY = 20;
const STOP_MULTIPLE = 2;
const DEFAULT_CHECKPOINT_ALLOWANCE = 2;
const MAX_CHECKPOINT_ALLOWANCE = 4;
const MAX_BRIEF_BUDGET = 120;
// Only the brief's first line is read, and only this much of the transcript.
const BRIEF_HEAD_BYTES = 262_144;
const SAFE_AGENT = /^[A-Za-z0-9_-]{1,128}$/;
// A `Round budget:` label line, in the forms briefHas accepts, with the number after the colon.
const BRIEF_BUDGET = /^[ \t]*(?:(?:[-*]|\d+\.)[ \t]+)?(?:\*\*|__)?Round[ \t]+budget(?:\*\*|__)?[ \t]*(?:\([^)\n]*\))?[ \t]*(?:\*\*|__)?[ \t]*:[ \t]*(?:\*\*|__)?[ \t]*(\d+)/gim;
const BRIEF_STATUSES = new Set(['BRIEF', 'CLAMPED', 'INVALID', 'NONE', 'MISSING']);
// The checkpoint the warning asks for and the stop requires, so a fresh operative resumes from
// recorded state instead of rediscovering half-applied dirty work.
const CHECKPOINT = 'done items with file:line evidence, each dirty (uncommitted) path marked complete or partial, '
  + 'the exact next edit, and each gate run with its result';
const DISPATCH_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'spawn_subagent']);
// Agent types that start from the host's full tool surface or inherit the lead's context.
const WIDE_TYPES = new Set(['general-purpose', 'claude', 'fork']);
// A brief line that justifies a wide or unnamed agent type, with the reason on the same line.
const WIDE_REASON = /^Wide-surface reason:[ \t]*\S/m;
const BAND_TOKENS = 150_000;
const HANDOFF_SKILL = /code-ops-suite[:-]handoff/;
// Session ids key the assessment marker and appear in the unlock command the deny prints, so
// only a shell-safe id is gated; any other id fails open.
const SAFE_SESSION = /^[A-Za-z0-9._-]{1,256}$/;
const HOOK_PATH = fileURLToPath(import.meta.url);

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

function assessedPath(cwd, sessionId) {
  return join(stateDir(cwd), `${stateKey(sessionId)}.assessed.json`);
}

// The highest ceiling band a handoff assessment unlocked, or 0 for a missing or malformed marker.
function assessedBand(path) {
  try {
    const marker = JSON.parse(readFileSync(path, 'utf8'));
    return marker?.version === 1 && Number.isSafeInteger(marker.band) && marker.band > 0 ? marker.band : 0;
  } catch { return 0; }
}

// Records an assessment at `band`. The marker only rises, so a stale unlock never lowers it.
function recordAssessment(cwd, sessionId, band) {
  const path = assessedPath(cwd, sessionId);
  if (band < 1 || assessedBand(path) >= band) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, band }) + '\n');
}

const gateBand = (context, ceiling) => (context < ceiling ? 0 : 1 + Math.floor((context - ceiling) / BAND_TOKENS));

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

// The first line of the subagent's own transcript, or null when it is absent or longer than
// BRIEF_HEAD_BYTES.
function transcriptHead(payload) {
  const lead = payload.transcript_path;
  if (typeof lead !== 'string' || !lead.endsWith('.jsonl') || !SAFE_AGENT.test(payload.agent_id)) return null;
  const path = join(lead.slice(0, -'.jsonl'.length), 'subagents', `agent-${payload.agent_id}.jsonl`);
  let fd;
  try {
    fd = openSync(path, 'r');
    const buffer = Buffer.alloc(BRIEF_HEAD_BYTES);
    const size = readSync(fd, buffer, 0, BRIEF_HEAD_BYTES, 0);
    const text = buffer.subarray(0, size).toString('utf8');
    const end = text.indexOf('\n');
    return end >= 0 ? text.slice(0, end) : size < BRIEF_HEAD_BYTES ? text : null;
  } catch { return null; } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* fail open */ }
  }
}

// The Round budget the lead's brief states: BRIEF within 1..MAX_BRIEF_BUDGET, CLAMPED above it,
// INVALID for zero or two different values, NONE without a line, MISSING without a readable brief.
function parseBrief(payload) {
  let entry;
  try { entry = JSON.parse(transcriptHead(payload) ?? ''); } catch { return { status: 'MISSING' }; }
  if (entry?.type !== 'user' || entry.parentUuid !== null
    || (entry.agentId !== undefined && entry.agentId !== payload.agent_id)) return { status: 'MISSING' };
  const content = entry.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('\n')
    : '';
  const values = [...new Set([...text.matchAll(BRIEF_BUDGET)].map((match) => Number(match[1])))];
  if (!values.length) return { status: 'NONE' };
  if (values.length > 1 || values[0] < 1) return { status: 'INVALID' };
  const requested = Math.min(values[0], Number.MAX_SAFE_INTEGER);
  return requested > MAX_BRIEF_BUDGET
    ? { status: 'CLAMPED', requested, budget: MAX_BRIEF_BUDGET }
    : { status: 'BRIEF', budget: requested };
}

function validBrief(record, agentId) {
  return record?.version === 1 && record.key === stateKey(agentId) && BRIEF_STATUSES.has(record.status)
    && (record.budget === undefined || (Number.isSafeInteger(record.budget) && record.budget >= 1 && record.budget <= MAX_BRIEF_BUDGET));
}

// The brief budget record for this agent, parsed from the transcript on the first call only and
// cached beside the counter; `fresh` marks the call that parsed it.
function briefBudget(cwd, payload) {
  const path = join(stateDir(cwd), `${stateKey(payload.agent_id)}.brief.json`);
  let prior = null;
  try { prior = JSON.parse(readFileSync(path, 'utf8')); } catch { /* parse the brief */ }
  if (validBrief(prior, payload.agent_id)) return prior;
  // Concurrent first calls parse the same immutable first line, so either write is the same record.
  const record = { version: 1, key: stateKey(payload.agent_id), ...parseBrief(payload) };
  try { writeFileSync(path, JSON.stringify(record) + '\n'); } catch { /* fail open: parse again next call */ }
  return { ...record, fresh: true };
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

// The fields the agent's `## Contract` section lists on its `Brief requires:` line, or [] when
// the type is unknown, the definition is unreadable, or it declares no contract.
function requiredFields(subagentType) {
  const path = agentFile(subagentType);
  if (!path) return [];
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { return []; }
  const section = /^## Contract[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? '';
  const line = /^Brief requires:[ \t]*(.+)$/m.exec(section)?.[1] ?? '';
  return line.split(',').map((field) => field.trim()).filter(Boolean);
}

// A brief carries a field when a line starts with the label, case-insensitive, followed by a
// colon. Only leading whitespace, one list marker (`-`, `*`, or `1.`), and bold markers may
// precede the label; bold markers or a parenthetical may sit between it and the colon. A
// markdown heading line that starts with the label also counts. A label mid-line, as in
// `Out of scope:` or `relevant to Scope: x`, does not.
function briefHas(prompt, field) {
  const label = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[ \\t]+');
  return new RegExp(`^[ \\t]*(?:(?:[-*]|\\d+\\.)[ \\t]+)?(?:\\*\\*|__)?${label}(?:\\*\\*|__)?[ \\t]*(?:\\([^)\\n]*\\))?[ \\t]*(?:\\*\\*|__)?[ \\t]*:`, 'im').test(prompt)
    || new RegExp(`^[ \\t]*#{1,6}[ \\t]+${label}(?![A-Za-z0-9])`, 'im').test(prompt);
}

function emit(body) {
  writeSync(1, `${JSON.stringify(body)}\n`);
}

// Behaviour 1: the subagent's own tool call.
function guardSubagent(payload, fallbackBudget, hardStop, readBrief) {
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
  const bound = state.status === 'BOUND';
  let used;
  try { used = countRound(counterPath(cwd, payload.agent_id), legacyCounterPath(cwd, payload.agent_id)); } catch {
    if (bound) emit({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'Dispatch guard: controller-bound counter is unavailable. Return to the controller for a new agent identity.',
    } });
    return;
  }
  // A controller binding outranks the brief, so a bound agent never reads its transcript.
  const brief = !bound && readBrief ? briefBudget(cwd, payload) : null;
  const briefBound = brief?.budget !== undefined && brief?.budget !== null;
  const unboundBudget = briefBound ? brief.budget : fallbackBudget;
  const budget = limits?.effectiveBudget ?? unboundBudget;
  const note = !brief?.fresh ? ''
    : brief.status === 'CLAMPED' ? `Dispatch guard: the brief's ${brief.requested}-round budget exceeds the `
      + `${MAX_BRIEF_BUDGET}-round maximum a brief can bind; the guard uses ${MAX_BRIEF_BUDGET}.`
    : brief.status === 'INVALID' ? 'Dispatch guard: the brief\'s Round budget is not one whole number from 1 to '
      + `${MAX_BRIEF_BUDGET}; the guard uses the ${fallbackBudget}-round default.`
    : '';

  const legacyCap = unboundBudget * STOP_MULTIPLE;
  const exceedsBoundAllowance = bound && used > limits.permitted;
  if (hardStop && (exceedsBoundAllowance || (!bound && used >= legacyCap))) {
    emit({ hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: (bound
        ? `Dispatch guard: ${used} attempted tool calls used after the ${limits.allowance}-call checkpoint `
          + `allowance following the controller-bound ${budget}-round budget. `
        : `Dispatch guard: ${used} tool rounds used, ${STOP_MULTIPLE} times the ${budget}-round budget. `)
        + `Make no further edits. Return your report now with the checkpoint: ${CHECKPOINT}.`,
    } });
    return;
  }
  if (used !== budget && (used < budget || (used - budget) % WARN_EVERY !== 0)) {
    if (note) emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note } });
    return;
  }
  // The first denied call: one past the bound allowance, or the legacy cap itself.
  const stopAt = bound ? limits.permitted + 1 : legacyCap;
  emit({ hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    additionalContext: (note ? `${note} ` : '')
      + `Dispatch guard: ${used} tool rounds used against ${bound ? 'a controller-bound' : briefBound ? 'a brief-bound' : 'a'} ${budget}-round budget`
      + (hardStop ? `; the hard stop denies every tool call from call ${stopAt}. ` : '. ')
      + 'Start no new edit. Finish or revert the partial edit to reach a consistent state, then write a '
      + `checkpoint to the brief's Report path (or the run folder): ${CHECKPOINT}. `
      + (bound ? 'Then request a controller replan and return, ' : 'Then return, ')
      + 'so the lead continues this unit in a fresh operative from the checkpoint.'
      + (bound || briefBound ? '' : ' If your brief names a larger budget, continue instead and keep the checkpoint current.'),
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

function cliPositive(args, name) {
  const raw = cliValue(args, name);
  return raw && /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}

const cliBudget = (args) => cliPositive(args, '--budget');

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
  if (verb === 'assessed') {
    const sessionId = cliValue(args, '--session');
    const band = cliPositive(args, '--band');
    if (!sessionId || !SAFE_SESSION.test(sessionId) || !band) return cliFailure('INVALID_ARGUMENT');
    try { recordAssessment(process.cwd(), sessionId, band); } catch { return cliFailure('UNAVAILABLE'); }
    return true;
  }
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

// The session's resident context against the ceiling, or null when the gate is off or any
// input is missing or unreadable (fail open).
async function ceilingGate(payload) {
  const sessionId = payload.session_id;
  if (typeof sessionId !== 'string' || !SAFE_SESSION.test(sessionId)) return null;
  let lib;
  try { lib = await import(pathToFileURL(join(dirname(HOOK_PATH), '..', 'scripts', 'transcript-lib.mjs')).href); } catch { return null; }
  const ceiling = lib.contextCeiling();
  if (ceiling === null) return null;
  const context = lib.residentContext(payload, { grok: Boolean(process.env.GROK_PLUGIN_ROOT), home: homedir() });
  if (typeof context !== 'number') return null;
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  return { cwd, sessionId, context, ceiling, band: gateBand(context, ceiling) };
}

const tokens = (n) => (Math.round(n / 1000) * 1000).toLocaleString('en-US');

function ceilingReason(gate) {
  return `This session holds about ${tokens(gate.context - gate.ceiling)} tokens past the `
    + `${gate.ceiling.toLocaleString('en-US')}-token context ceiling. Run /code-ops-suite:handoff assess `
    + '(CONTINUE, COMPACT, or HANDOFF) before dispatching new work; the assessment unlocks dispatch '
    + `until the next ${BAND_TOKENS.toLocaleString('en-US')}-token band. Without a skill tool, run this exact `
    + `command from the project root: \`node "${HOOK_PATH}" assessed --session ${gate.sessionId} --band ${gate.band}\`.`;
}

// Behaviour 4: the lead's own dispatch. A wide surface without a stated reason is a denial; a
// model override and a missing Round budget stay advisory.
function reviewDispatch(tool, input, budget, denials, advisories) {
  if (tool === 'Workflow') {
    const script = typeof input.script === 'string' ? input.script : '';
    if (/\bagent\s*\(/.test(script) && !/\bagentType\s*:/.test(script) && !script.includes('Wide-surface reason:')) {
      denials.push('A Workflow agent() call with no agentType starts from the default surface; set agentType '
        + 'to a code-ops-suite agent, or add "Wide-surface reason: <why>" to the script.');
    }
    return;
  }
  const type = typeof input.subagent_type === 'string' ? input.subagent_type.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';

  if (input.model !== undefined && input.model !== null && input.model !== '') {
    const tier = declaredTier(type);
    advisories.push(`A model override replaces the agent's declared tier${tier ? ` (${tier})` : ''}; `
      + 'verify task rationale and tier floor.');
  }
  const typeless = tool === 'spawn_subagent' && input.subagent_type === undefined;
  if (!typeless && (!type || WIDE_TYPES.has(type.split(':').pop().toLowerCase())) && !WIDE_REASON.test(prompt)) {
    denials.push(`${type || 'An unnamed type'} starts from a large default or inherited context; `
      + 'dispatch code-ops-suite:implementer, explorer, reviewer, or mech, or add a '
      + '"Wide-surface reason: <why>" line to the brief.');
  }
  const missing = requiredFields(type).filter((field) => !briefHas(prompt, field));
  if (missing.length) {
    denials.push(`The ${type} Contract requires these brief fields, missing: ${missing.join(', ')}; `
      + 'add each as a "Label:" line or a heading.');
  }
  // A field denial that already names Round budget makes this advisory a repeat.
  const deniedBudget = missing.some((field) => /^round budget$/i.test(field));
  if (typeof input.prompt === 'string' && !deniedBudget && !/round budget/i.test(input.prompt)) {
    advisories.push(`No Round budget in the brief; the guard warns at ${budget} rounds, `
      + `stops at ${budget * STOP_MULTIPLE}.`);
  }
}

// Behaviours 3 and 4: the main thread. A handoff Skill call records the assessment; a dispatch
// meets the ceiling gate and then the dispatch review, in one output.
async function guardMainThread(payload, budget, hardStop) {
  const tool = payload.tool_name;
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : null;
  if (tool === 'Skill') {
    if (!HANDOFF_SKILL.test(String(input?.skill ?? ''))) return;
    const gate = await ceilingGate(payload);
    if (gate) try { recordAssessment(gate.cwd, gate.sessionId, gate.band); } catch { /* fail open */ }
    return;
  }
  if (!DISPATCH_TOOLS.has(tool) || !input) return;
  const denials = [];
  const advisories = [];
  const gate = await ceilingGate(payload);
  if (gate && gate.band >= 1 && assessedBand(assessedPath(gate.cwd, gate.sessionId)) < gate.band) {
    denials.push(ceilingReason(gate));
  }
  reviewDispatch(tool, input, budget, denials, advisories);
  if (!denials.length && !advisories.length) return;
  const text = `Dispatch guard: ${[...denials, ...advisories].join(' ')}`;
  emit({ hookSpecificOutput: hardStop && denials.length
    ? { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text }
    : { hookEventName: 'PreToolUse', additionalContext: text } });
}

async function main() {
  if (command()) return;
  const setting = process.env.CODE_OPS_DISPATCH_GUARD ?? '';
  if (/^(off|0|false)$/i.test(setting)) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  if (!payload || typeof payload !== 'object') return;
  payload = {
    ...payload,
    tool_name: payload.tool_name ?? payload.toolName,
    tool_input: payload.tool_input ?? payload.toolInput,
    session_id: payload.session_id ?? payload.sessionId,
  };
  if (payload.hook_event_name && payload.hook_event_name !== 'PreToolUse') return;

  const budget = roundBudget();
  const hardStop = !/^warn$/i.test(setting);
  // Grok sends no `agent_id`. A subagent there runs in its own child session, and every event
  // that fires inside it carries `subagentType` (10-hooks.md), so that child's `sessionId` keys
  // its counter.
  const agentId = payload.agent_id
    ?? (typeof payload.subagentType === 'string' && payload.subagentType ? payload.session_id : undefined);
  if (typeof agentId === 'string' && agentId) {
    // Only the host's own `agent_id` locates a subagent transcript; Grok's layout is unverified.
    guardSubagent({ ...payload, agent_id: agentId }, budget, hardStop, agentId === payload.agent_id);
    return;
  }
  await guardMainThread(payload, budget, hardStop);
}

main().catch(() => { /* fail open */ });
