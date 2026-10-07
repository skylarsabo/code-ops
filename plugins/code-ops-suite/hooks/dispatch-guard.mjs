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
// SIX BEHAVIOURS, ONE REGISTRATION, because every registered PreToolUse command spawns a
// process per tool call on every thread:
//   1. BOUND ROUND COUNTER, inside a subagent whose exact `agent_id` was registered by a
//      controller. The host dispatch event does not expose the eventual child `agent_id`, so
//      the hook never guesses from timing or agent type. A controller that knows that id runs
//      `dispatch-guard.mjs register --agent-id <id> --budget <rounds>` before work begins.
//      The hook warns at that unit's bound budget and denies after a two-call checkpoint
//      allowance. `receipt --agent-id <id>` emits only allowlisted local measurements.
//   2. LEGACY ROUND COUNTER, inside every other subagent (`agent_id` present). It keeps the
//      warning cadence and stops at 1.5 times the budget, rounded down (`stopCall`), the safe
//      fallback when exact controller
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
//      `Workflow` script is checked one `agent(` call at a time: a call whose inline options lack
//      `agentType`, or name a wide literal one, is denied the same way unless the script carries
//      `Wide-surface reason:`, and one denial line gives the failing count and the first call's
//      1-based index. A literal `effort` of `xhigh` or `max` is denied with no reason escape; a
//      variable passes. A call whose options are a variable or a spread cannot be read and earns
//      an advisory. A parse surprise (an unclosed literal, or a call past the bounded scan) falls
//      back to the script-wide test: an `agent(` call, no `agentType:`, and no reason text.
//      A readable script with two or more calls, or any unreadable call, and no readable script-wide
//      `Run contract: <path>` line earns an advisory only (`workflow-contract`); it never denies.
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
//      without that line passes. The field denial names `co brief <type>`, which prints every
//      field as a `Label:` line (scripts/brief-template.mjs), and the output then opens with one
//      such line per missing field, ready to paste. Only the message helps; the label test above
//      stays strict. A brief with no Round budget stays an advisory clause; the Round budget
//      advisory is dropped when a field denial already names it. Every denial and advisory for one
//      dispatch lands in one output.
//      ROUTING. Only an agent whose `Brief requires:` lists `Tier` is routed (DESIGN_TIER_ROUTING.md,
//      "Enforcement"); every other agent keeps the checks above and nothing more. A `model`
//      override no longer earns a blanket advisory: one that matches the brief `Tier` passes
//      silently. For a routed agent the hook denies (a) an override that ranks below the agent's
//      frontmatter floor, (b) a `Tier` that disagrees with the effective rung (premium needs
//      `model:"opus"`, frontier `model:"fable"`, strong needs no override or one at strong), (c) a
//      `Route basis` surface that differs from a non-`none` surface derived from the Scope paths
//      with `surfaceOfScope`, which no `Route override:` line clears (a declared surface over a
//      derived `none` routes up and earns an advisory only), (d) a `Tier` or `Effort` below
//      `routeUnit` of the basis with the derived surface and the ledger-derived attempt, unless a
//      `Route override:` line is present and the shortfall comes from the ambiguity or attempt
//      triggers (rules 7b, 7c) or the table rows; the surface triggers (7a, 7d) are never cleared,
//      (e) a brief `Effort` above the agent's frontmatter effort, because the Agent tool carries no
//      effort (Workflow `agent()` does), (f) a literal `xhigh` or `max` brief `Effort`, and (g) a
//      second frontier dispatch in the session, counted from agent-ledger rows (a Workflow script
//      counts its literal frontier `model` calls with them: more than one in total denies), and
//      (h) a `Route basis` surface that is not a surface. The Scope block ends at a blank line or any
//      `Label:` line, and reads past blank lines after an empty `Scope:` colon; a Scope path drops a
//      trailing line anchor (`:120-180`, `#L120`) and matches case-insensitively. The declared kind
//      is raised to the agent's minimum (AGENT_MIN_KIND in route-unit.mjs: reviewer and
//      privacy-reviewer review, verifier refutation, tracer judgment) with an advisory. A rung
//      above `routeUnit`, a raised kind, a `model` override that cannot be ranked (Tier goes
//      unchecked), a brief `Effort` below the frontmatter effort, and a non-literal Workflow
//      `model` or `effort` are advisories. A Workflow `agent()` call also denies a literal `model`
//      below the floor of its literal `agentType`, and `spawn_subagent` or `spawn_agent` input with a
//      literal `xhigh` or `max` effort denies. scripts/route-unit.mjs and scripts/agent-ledger.mjs
//      load lazily and only for a routed dispatch or a Workflow `model`; an import or ledger error
//      skips the routing checks (fail open).
//   5. COLLISION NOTE (warn only), on every thread, for an edit tool (Edit, Write, MultiEdit,
//      NotebookEdit, and the other hosts' edit names) and for a shell command that runs `git pull`,
//      `git merge`, `git rebase`, or `git push`. scripts/collision-lib.mjs, imported lazily and
//      only for those calls, reads the repository's presence board. An edit of a path that another
//      live session claimed or edited within 6 hours adds context naming that peer and a ready
//      `SendMessage` line, once per path per peer per session (a subagent keeps its own seen-set);
//      a git command lists the live peers on this branch and their recent edits that overlap this
//      session's uncommitted files. The note never denies and never changes a decision: it joins
//      the `additionalContext` of an advisory this hook already emits, or stands alone, and it is
//      dropped, with its once-only mark unspent, beside a denial. Any error, an unreadable board,
//      or a missing library fails open with no note. It runs inside this registration so no hook
//      process is added (Program state handoffs and coordination 2026-09, "Cross-cutting: hook
//      cost", DEC-66). Its off switch is `CODE_OPS_PEER_GUARD`, the presence board's own switch:
//      the note reads that board, and a session that turned the board off should neither publish
//      to it nor consume it. `CODE_OPS_DISPATCH_GUARD=off` also silences it, as it does every branch.
//   6. LEGACY AND DERIVED PATH DENY, on every thread, for an edit tool (the names behaviour 5
//      lists). An edit whose target lies under a `removed` legacy path of the documentation
//      manifest (version 3, `<hub>/98 System/DOCS_MANIFEST.json`) is denied, and the reason names
//      the removed root and, when `<hub>/98 System/FORWARDING.json` maps it, the new location
//      (Program state handoffs and coordination 2026-09, W3). An edit under a `derived` legacy
//      path, a generated tree such as `opencode-dist/`, is denied the same way, and the reason
//      names the entry's `generator` command. A hub whose manifest is missing, oversize, or
//      corrupt, or one that lists no `derived` entry, falls back to a built-in derived list, so a
//      broken manifest never opens the generated trees. A fallback entry applies only where its
//      generator script exists; a repository with no hub is never denied. scripts/legacy-paths-lib.mjs,
//      imported lazily and only for an edit tool, finds the hub as the one top-level directory
//      holding the manifest, reads at most 2 MiB per file, and spawns nothing; any other error,
//      or a missing library, fails open. A denial on a subagent still counts the call, because
//      the denial and any round advisory leave in one output. `CODE_OPS_DISPATCH_GUARD=warn`
//      downgrades it to advisory text. Its own off switch is `CODE_OPS_LEGACY_PATHS`, taking
//      `off`, `0`, or `false`.
//
// DECISION ROWS. Every output that denies or advises, from any behaviour above, appends one row
// to `guard-decisions.jsonl` beside the session-receipt ledger (`dirname` of `CODE_OPS_RECEIPTS`,
// else `~/.claude/code-ops/`). A row holds ids and counts only, never brief text or paths; the
// shape is in the "Dispatch guard hook" section of CONTRACTS.md. `CODE_OPS_RECEIPTS=off` stops
// the rows, and a write error fails open.
//
// The warning asks for a written checkpoint (done items, each dirty path marked complete or
// partial, the exact next edit, gates run) before the stop, and the stop asks for it in the final
// report, so a runaway still stops but never leaves unrecorded half-applied work. The default
// stays role-blind: the audits above measure overruns, not a per-role need for more rounds, and
// the brief's own Round budget line already binds a larger budget for one unit. `register --budget`
// binds one only inside the unregistered stop, and says so on stderr when it caps. MAX_BRIEF_BUDGET is 120: the largest measured spend is the reviewers' mean of about 90
// rounds, so a 120-round warning covers it with a third to spare, and the 180-call stop still
// bounds a runaway brief at four and a half times the default.
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
// one assessment marker per session at `<sha256 repository root>/<sha256 session id>.assessed.json`
// (`{version: 1, band}`; the root is `stateRoot(cwd)`, so a shell that changes directory keeps
// its assessment), the storage convention `handoffMarkerPath`
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
// budget than the controller record intended. That denial, like an unavailable bound counter,
// states the fix: report now, then re-dispatch under a new id bound with `register`.

import { appendFileSync, closeSync, constants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { agentFile } from './agent-file.mjs';

const DEFAULT_BUDGET = 40;
const WARN_EVERY = 20;
const STOP_MULTIPLE = 1.5;
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
// `spawn_agent` is Codex's dispatch tool. Whether PreToolUse fires for it is UNVERIFIED, so the
// name is covered here and stays inert until a captured payload shows the hook runs.
const DISPATCH_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'spawn_subagent', 'spawn_agent']);
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
// The mechanical fix both controller-binding denials state. The agent cannot repair its own
// binding, so it returns, and the unit restarts under a new identity with a fresh binding.
const BOUND_FAILURE_FIX = `Make no further edits. Return your report now with the checkpoint: ${CHECKPOINT}. `
  + 'The controller then re-dispatches the unit under a new agent identity and, before its first tool call, '
  + `binds it from the project root: \`node "${HOOK_PATH}" register --agent-id <new agent id> --budget <rounds>\`.`;

// The first denied call for an unbound budget: STOP_MULTIPLE times it, rounded down so a
// fractional product never moves the stop later, and at least one call past the budget so the
// budget-round checkpoint line always lands before the stop.
const stopCall = (budget) => Math.max(budget + 1, Math.floor(budget * STOP_MULTIPLE));
const off = (name) => /^(off|0|false)$/i.test(process.env[name] ?? '');
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
  const legacyPermitted = stopCall(fallbackBudget) - 1;
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

// The `model:` and `effort:` an agent's own frontmatter declares (null each when absent), or null
// when there is no readable definition for this type. The declared model is the agent's floor:
// lint-plugins.mjs fails a definition whose model sits below its AGENT_MODEL_FLOORS entry, and
// every definition today declares exactly its floor. Only a routed dispatch reaches this.
function agentFrontmatter(subagentType) {
  const path = agentFile(subagentType);
  if (!path) return null;
  try {
    const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(path, 'utf8'))?.[1] ?? '';
    const field = (key) => new RegExp(`^${key}:[ \\t]*["']?([A-Za-z0-9._-]+)["']?[ \\t]*$`, 'm').exec(head)?.[1] ?? null;
    return { model: field('model'), effort: field('effort') };
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
const labelSource = (field) => field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[ \\t]+');
const LABEL_HEAD = '^[ \\t]*(?:(?:[-*]|\\d+\\.)[ \\t]+)?(?:\\*\\*|__)?';
const LABEL_TAIL = '(?:\\*\\*|__)?[ \\t]*(?:\\([^)\\n]*\\))?[ \\t]*(?:\\*\\*|__)?[ \\t]*:';

function briefHas(prompt, field) {
  const label = labelSource(field);
  return new RegExp(`${LABEL_HEAD}${label}${LABEL_TAIL}`, 'im').test(prompt)
    || new RegExp(`^[ \\t]*#{1,6}[ \\t]+${label}(?![A-Za-z0-9])`, 'im').test(prompt);
}

// The text on a brief's `<field>:` line, or null when the line is absent or empty. The label rule
// is briefHas's; the value drops leading quotes and trailing bold markers or quotes, as the agent
// ledger's own reader does, so a `Unit:` value here equals the one the ledger stored.
function briefValue(prompt, field) {
  const match = new RegExp(`${LABEL_HEAD}${labelSource(field)}${LABEL_TAIL}[ \\t]*(?:\\*\\*|__)?[ \\t]*([^\\r\\n]*)`, 'im').exec(prompt);
  const value = (match?.[1] ?? '').replace(/^[`'"]+/, '').replace(/(?:\*\*|__|[`'"])+[ \t]*$/, '').trim();
  return value || null;
}

// Behaviour 5's note for this call, behaviour 6's denial text, and whether any output has gone
// out yet.
let collision = null;
let legacy = null;
let emitted = false;
// The tool call this process decides, for the decision row. Null for a CLI verb, so only a hook
// output writes a row. `workflow` holds the per-call counts reviewWorkflow reads.
let current = null;
let workflow = null;

// Decision rows. Each gate that can deny or advise has one id, the contract-rule ledger ids it
// backs, and a phrase unique to its message. An output can carry several gates, so a row lists
// every id whose phrase appears, in table order, and `other` when none does. The dispatch-guard
// eval fires every row, so a reworded message that no longer matches fails there.
const GATES = [
  ['round-warn', /tool rounds used against/, ['GC-25']],
  ['round-stop', /the hard stop at |checkpoint allowance following/, ['GC-25']],
  ['round-note', /-round budget exceeds|Round budget is not one whole number/, ['GC-25']],
  ['binding', /controller binding is malformed|controller-bound counter is unavailable/, ['GC-25']],
  ['ceiling', /-token context ceiling/, ['GB-07', 'GB-17', 'GB-19']],
  ['wide-type', /starts from (?:a large default or inherited context|the default surface)/, ['GB-05', 'GD-01', 'R1-07']],
  ['effort-cap', /effort is at most high|is not an effort/, []],
  ['brief-fields', /requires these brief fields, missing/, ['GD-06']],
  ['budget-missing', /No Round budget in the brief/, ['GC-25']],
  ['route-tier', /is not a rung|cannot be ranked|, below its .* floor|but the dispatch runs at|\bruns at; the Agent tool|Tier \S+ \/ Effort|is above the routed|below the \S+ floor of/, ['GC-05', 'GC-06']],
  ['route-basis', /Route basis/, []],
  ['frontier', /only one frontier peer/, []],
  ['workflow-opaque', /Workflow agent\(\) calls pass (?:options the guard cannot read|a model or effort that is not a literal)/, []],
  ['workflow-contract', /"Run contract: <path>" line/, []],
  ['legacy-path', /Legacy path guard:/, []],
  ['derived-path', /Derived path guard:/, []],
  ['peer-note', /^(?:Collision|Surface) note/m, []],
];
const TOOL_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

// The row for one PreToolUse output that denies or advises, or null for anything else. It holds
// ids and counts only: no brief, script, path, or message text.
function decisionRow(body) {
  const out = body?.hookSpecificOutput;
  if (!current || out?.hookEventName !== 'PreToolUse') return null;
  const deny = out.permissionDecision === 'deny';
  const text = deny ? out.permissionDecisionReason : out.additionalContext;
  if (typeof text !== 'string' || !text) return null;
  const hits = GATES.filter(([, phrase]) => phrase.test(text));
  const row = {
    v: 1, ts: new Date().toISOString(),
    sessionId: SAFE_SESSION.test(String(current.session_id ?? '')) ? current.session_id : null,
    tool: TOOL_ID.test(String(current.tool_name ?? '')) ? current.tool_name : 'other',
    subagent: Boolean(current.subagent),
    decision: deny ? 'deny' : 'advisory',
    gates: hits.length ? hits.map(([id]) => id) : ['other'],
    ledger: [...new Set(hits.flatMap(([, , ids]) => ids))].sort(),
  };
  if (workflow && current.tool_name === 'Workflow') row.workflow = workflow;
  return row;
}

// `guard-decisions.jsonl` beside the session-receipt ledger, or null when `CODE_OPS_RECEIPTS` is off.
function decisionsPath() {
  if (off('CODE_OPS_RECEIPTS')) return null;
  const receipts = process.env.CODE_OPS_RECEIPTS;
  return join(receipts ? dirname(receipts) : join(homedir(), '.claude', 'code-ops'), 'guard-decisions.jsonl');
}

function recordDecision(body) {
  try {
    const row = decisionRow(body);
    const path = row && decisionsPath();
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(row)}\n`);
  } catch { /* fail open */ }
}

function emit(body) {
  // Behaviour 6 turns any PreToolUse output into a denial that keeps the rest of the text.
  const held = body?.hookSpecificOutput;
  if (legacy && held?.hookEventName === 'PreToolUse') {
    const rest = held.permissionDecisionReason ?? held.additionalContext;
    body = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: rest ? `${legacy} ${rest}` : legacy } };
  }
  const out = body?.hookSpecificOutput;
  // A note joins an advisory's context. A denial and a payload with no context stay as they are.
  const merge = collision && out?.hookEventName === 'PreToolUse' && out.permissionDecision === undefined
    && typeof out.additionalContext === 'string' ? collision : null;
  const sent = merge ? { ...body, hookSpecificOutput: { ...out, additionalContext: `${out.additionalContext}\n${merge.text}` } } : body;
  writeSync(1, `${JSON.stringify(sent)}\n`);
  emitted = true;
  recordDecision(sent);
  if (merge) { collision = null; try { merge.commit(); } catch { /* fail open */ } }
}

// Behaviour 5. The lazy import and the note run only for an edit tool or a shell tool, so every
// other call pays nothing; anything that goes wrong is no note.
const COLLISION_TOOLS = /(?:^|\.)(?:edit|write|search_replace|multiedit|notebookedit|apply_patch|bash|shell|exec_command|run_terminal_command)$/i;
const EDIT_TOOL_NAME = /(?:^|\.)(?:edit|write|search_replace|multiedit|notebookedit|apply_patch)$/i;
const GIT_VERB_HINT = /\bgit\b[\s\S]*\b(?:pull|merge|rebase|push)\b|\b(?:taskkill|pkill|kill|Stop-Process)\b/i;

async function collisionFor(payload, agentId) {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_PEER_GUARD ?? '')) return null;
  if (!COLLISION_TOOLS.test(String(payload.tool_name ?? ''))) return null;
  // A shell call that names no git pull, merge, rebase, or push skips the import, which costs
  // about 30 ms cold. The library still parses the command exactly.
  const input = payload.tool_input ?? payload.toolInput;
  const command = typeof input?.command === 'string' ? input.command : input?.cmd;
  if (!EDIT_TOOL_NAME.test(String(payload.tool_name ?? '')) && !(typeof command === 'string' && GIT_VERB_HINT.test(command))) return null;
  try {
    const lib = await import(pathToFileURL(join(dirname(HOOK_PATH), '..', 'scripts', 'collision-lib.mjs')).href);
    return lib.collisionNote({ ...payload, agent_id: typeof agentId === 'string' && agentId ? agentId : undefined }) ?? null;
  } catch { return null; }
}

// Behaviour 6. The lazy import runs only for an edit tool, so every other call pays nothing.
async function legacyFor(payload) {
  if (off('CODE_OPS_LEGACY_PATHS') || !EDIT_TOOL_NAME.test(String(payload.tool_name ?? ''))) return null;
  try {
    const lib = await import(pathToFileURL(join(dirname(HOOK_PATH), '..', 'scripts', 'legacy-paths-lib.mjs')).href);
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    return lib.legacyDenial(cwd, payload.tool_input) ?? null;
  } catch { return null; }
}

// A denial no other output carried goes out alone.
function finishLegacy() {
  if (legacy && !emitted) emit({ hookSpecificOutput: { hookEventName: 'PreToolUse' } });
}

// A note no advisory carried goes out alone.
function finishCollision() {
  const note = collision;
  collision = null;
  if (!note || emitted) return;
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note.text } });
  try { note.commit(); } catch { /* fail open */ }
}

// Behaviour 1: the subagent's own tool call.
function guardSubagent(payload, fallbackBudget, hardStop, readBrief) {
  const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  const state = bindingState(cwd, payload.agent_id);
  if (state.status === 'INVALID') {
    emit({ hookSpecificOutput: {
      hookEventName: 'PreToolUse', permissionDecision: 'deny',
      permissionDecisionReason: 'Dispatch guard: the controller binding is malformed or conflicts, so every tool call '
        + `for this agent is denied. ${BOUND_FAILURE_FIX}`,
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
      permissionDecisionReason: 'Dispatch guard: the controller-bound counter is unavailable because its round file '
        + `under ${stateDir(cwd)} cannot be updated, so every tool call for this agent is denied. `
        + `The controller makes that directory writable first. ${BOUND_FAILURE_FIX}`,
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

  const legacyCap = stopCall(unboundBudget);
  const exceedsBoundAllowance = bound && used > limits.permitted;
  if (hardStop && (exceedsBoundAllowance || (!bound && used >= legacyCap))) {
    emit({ hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: (bound
        ? `Dispatch guard: ${used} attempted tool calls used after the ${limits.allowance}-call checkpoint `
          + `allowance following the controller-bound ${budget}-round budget. `
        : `Dispatch guard: ${used} tool rounds used, the hard stop at ${STOP_MULTIPLE} times the ${budget}-round budget, rounded down. `)
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
      + (bound && binding.budget > budget ? ` (registered ${binding.budget}, capped by the ${fallbackBudget}-round default's stop)` : '')
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

// The assessment marker's key directory for `cwd`: the repository root, or `cwd` itself when the
// shared library cannot load (fail open).
async function assessmentRoot(cwd) {
  try {
    const lib = await import(pathToFileURL(join(dirname(HOOK_PATH), '..', 'scripts', 'transcript-lib.mjs')).href);
    return lib.stateRoot(cwd);
  } catch { return cwd; }
}

async function command() {
  const [verb, ...args] = process.argv.slice(2);
  if (!verb) return false;
  if (verb === 'assessed') {
    const sessionId = cliValue(args, '--session');
    const band = cliPositive(args, '--band');
    if (!sessionId || !SAFE_SESSION.test(sessionId) || !band) return cliFailure('INVALID_ARGUMENT');
    try { recordAssessment(await assessmentRoot(process.cwd()), sessionId, band); } catch { return cliFailure('UNAVAILABLE'); }
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
    if (status !== 'BOUND') return cliFailure(status);
    // The binding stays inside the unregistered stop, so a larger budget is capped. Say so now,
    // under this environment's CODE_OPS_ROUND_BUDGET, rather than at the first warning.
    const fallback = roundBudget();
    const limits = boundLimits({ budget, allowance }, fallback);
    if (limits.effectiveBudget < budget) {
      writeSync(2, `dispatch-guard CAPPED: the ${budget}-round budget exceeds the ${stopCall(fallback)}-call stop of the `
        + `${fallback}-round default, so the hook warns at ${limits.effectiveBudget} and denies from call `
        + `${limits.permitted + 1}. Raise CODE_OPS_ROUND_BUDGET in the hook environment to keep the larger budget.\n`);
    }
    return true;
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
  // The assessment marker is keyed by the repository root, so a cwd change mid-session keeps it.
  return { cwd: lib.stateRoot(cwd), sessionId, context, ceiling, band: gateBand(context, ceiling) };
}

const tokens = (n) => (Math.round(n / 1000) * 1000).toLocaleString('en-US');

function ceilingReason(gate) {
  const reason = `This session holds about ${tokens(gate.context - gate.ceiling)} tokens past the `
    + `${gate.ceiling.toLocaleString('en-US')}-token context ceiling. Run /code-ops-suite:handoff assess `
    + '(CONTINUE, COMPACT, or HANDOFF) before dispatching new work; the assessment unlocks dispatch '
    + `until the next ${BAND_TOKENS.toLocaleString('en-US')}-token band. Without a skill tool, run this exact `
    + `command from the project root: \`node "${HOOK_PATH}" assessed --session ${gate.sessionId} --band ${gate.band}\`.`;
  return process.env.GROK_PLUGIN_ROOT
    ? `Run /compact. It records this ceiling band and unlocks dispatch. ${reason}`
    : reason;
}

const AGENT_CALL = /\bagent\s*\(/g;
const OPTION_KEY = /(agentType|effort|model)\s*(?=[:,}])/y;
const OVER_HIGH_EFFORT = new Set(['xhigh', 'max']);
// A script-wide `Run contract: <path>` line, bare or inside a comment, with the path on that line.
// The compliance counts planned for scripts/context-audit.mjs must match this same pattern.
const RUN_CONTRACT_LINE = /^[ \t]*(?:\/\/+|\/?\*+)?[ \t]*Run contract:[ \t]*(\S.*?)(?:[ \t]*\*\/)?[ \t\r]*$/m;
// The agent() call count past which a Workflow script is large; the advisory only states it.
const WORKFLOW_CALL_GUIDELINE = 10;
// The bounded scan reads at most this many characters of one call's options.
const MAX_CALL_SCAN = 20_000;

// The index after the string literal that opens at `i`, or -1 when it does not close inside
// `end`. A template `${}` expression is skipped balanced; a bare newline ends a quoted string.
function readString(s, i, end) {
  const q = s[i];
  for (let j = i + 1; j < end; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === q) return j + 1;
    if (q === '`' && c === '$' && s[j + 1] === '{') {
      let depth = 1;
      for (j += 2; j < end && depth > 0; j++) {
        const e = s[j];
        if (e === '"' || e === "'" || e === '`') {
          const next = readString(s, j, end);
          if (next < 0) return -1;
          j = next - 1;
        } else if (e === '{') depth++;
        else if (e === '}') depth--;
      }
      if (depth > 0) return -1;
      j--;
    } else if (q !== '`' && c === '\n') return -1;
  }
  return -1;
}

// The literal string a property holds, null for a shorthand or any non-literal value.
function propertyLiteral(s, from, end) {
  let i = from;
  while (/\s/.test(s[i] ?? '')) i++;
  if (s[i] !== ':') return null;
  i++;
  while (/\s/.test(s[i] ?? '')) i++;
  if (s[i] !== '"' && s[i] !== "'" && s[i] !== '`') return null;
  const next = readString(s, i, end);
  return next < 0 || s.slice(i, next).includes('${') ? null : s.slice(i + 1, next - 1);
}

// The top-level `agentType`, `effort`, and `model` of the options object that opens at `open`, with the
// index after it; null on a parse surprise. Each key maps to its literal string or null.
function readOptions(s, open) {
  const end = Math.min(s.length, open + MAX_CALL_SCAN);
  const keys = new Map();
  let depth = 0;
  let spread = false;
  for (let i = open; i < end; i++) {
    const c = s[i];
    if (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) {
      const stop = s[i + 1] === '/' ? s.indexOf('\n', i) : s.indexOf('*/', i + 2) + 1;
      if (stop <= 0 || stop >= end) return null;
      i = stop;
    } else if (c === '"' || c === "'" || c === '`') {
      const next = readString(s, i, end);
      if (next < 0) return null;
      if (depth === 1 && /^\s*:/.test(s.slice(next, next + 40))) {
        const name = s.slice(i + 1, next - 1);
        if (name === 'agentType' || name === 'effort' || name === 'model') keys.set(name, propertyLiteral(s, next, end));
      }
      i = next - 1;
    } else if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') {
      if (--depth === 0) return { keys, spread, end: i + 1 };
    } else if (depth === 1) {
      if (s.startsWith('...', i)) { spread = true; i += 2; }
      else if (!/[\w$.]/.test(s[i - 1] ?? '')) {
        OPTION_KEY.lastIndex = i;
        const m = OPTION_KEY.exec(s);
        // A bare name that merely reads as a shorthand key (a value `effort`) never replaces a literal.
        if (m && (!keys.has(m[1]) || s[i + m[0].length] === ':')) {
          keys.set(m[1], propertyLiteral(s, i + m[1].length, end));
        }
      }
    }
  }
  return null;
}

// Each `agent(` call of a Workflow script as its options (null when the first argument is not an
// inline object, so it cannot be read), or null when the script does not parse.
function workflowCalls(script) {
  const calls = [];
  AGENT_CALL.lastIndex = 0;
  let m;
  while ((m = AGENT_CALL.exec(script))) {
    let i = m.index + m[0].length;
    while (/\s/.test(script[i] ?? '')) i++;
    if (script[i] !== '{') { calls.push(null); continue; }
    const options = readOptions(script, i);
    if (!options) return null;
    calls.push(options);
    AGENT_CALL.lastIndex = options.end;
  }
  return calls;
}

// Whether the file a `Run contract:` line names, resolved against the session directory, parses as
// JSON with a runId. Any read or parse failure is a miss.
function contractReadable(path, cwd) {
  try {
    const contract = JSON.parse(readFileSync(resolve(cwd, path), 'utf8'));
    return typeof contract?.runId === 'string' && contract.runId !== '';
  } catch { return false; }
}

// The contract advisory of a readable Workflow script: one note when it makes two or more agent()
// calls, or any call the guard cannot read, without a readable run contract. It never denies, and
// an internal error adds nothing.
function reviewWorkflowContract(script, calls, unreadable, noEffort, cwd, advisories) {
  try {
    if (calls.length < 2 && !unreadable) return;
    const path = RUN_CONTRACT_LINE.exec(script)?.[1];
    if (path === undefined) {
      advisories.push(`This Workflow script makes ${calls.length} agent() call(s) against the guideline of ${WORKFLOW_CALL_GUIDELINE}, `
        + `${noEffort} of them set no effort, and it has no script-wide "Run contract: <path>" line; add that line `
        + 'naming the run\'s RUN_CONTRACT.json. It is never denied.');
    } else if (!contractReadable(path, cwd)) {
      advisories.push('The Workflow script\'s "Run contract: <path>" line names a file that is missing or is not JSON with a runId; '
        + 'point it at the run\'s RUN_CONTRACT.json. It is never denied.');
    }
  } catch { /* fail open */ }
}

// A Workflow script's per-call review. `agentType` must name a narrow type on every readable
// call (a wide-surface reason excuses it); a literal effort above high never passes.
async function reviewWorkflow(script, denials, advisories, sessionId, cwd) {
  const calls = workflowCalls(script);
  if (!calls) {
    // deferred(parse surprise, a fuller JavaScript tokenizer): fall back to the script-wide test.
    if (/\bagent\s*\(/.test(script) && !/\bagentType\s*:/.test(script) && !script.includes('Wide-surface reason:')) {
      denials.push('A Workflow agent() call with no agentType starts from the default surface; set agentType '
        + 'to a code-ops-suite agent, or add "Wide-surface reason: <why>" to the script.');
    }
    return;
  }
  const failed = [];
  const high = [];
  const belowFloor = [];
  let unreadable = 0;
  let nonLiteral = 0;
  let noEffort = 0;
  // A literal model is judged against its literal agentType's floor, which needs the rung table.
  const libs = calls.some((call) => call && typeof call.keys.get('model') === 'string') ? await getRoutingLibs() : null;
  calls.forEach((call, index) => {
    if (!call) { unreadable++; return; }
    const { keys, spread } = call;
    const effort = keys.get('effort')?.trim().toLowerCase();
    if (OVER_HIGH_EFFORT.has(effort)) high.push(index + 1);
    // A spread may carry an effort, so only a call without one counts.
    if (!spread && !keys.has('effort')) noEffort++;
    // A variable or shorthand model or effort cannot be checked here.
    if ((keys.has('effort') && keys.get('effort') === null) || (keys.has('model') && keys.get('model') === null)) nonLiteral++;
    const model = keys.get('model');
    const literalType = keys.get('agentType');
    if (libs && typeof model === 'string' && typeof literalType === 'string') {
      const floor = libs.rungOf(agentFrontmatter(literalType.trim())?.model);
      const rung = libs.rungOf(model.trim());
      if (floor && rung && libs.floorRank[rung] < libs.floorRank[floor]) belowFloor.push({ call: index + 1, model: model.trim(), rung, type: literalType.trim(), floor });
    }
    if (!keys.has('agentType')) {
      if (spread) unreadable++; else failed.push(index + 1);
      return;
    }
    const type = keys.get('agentType');
    if (type !== null && (!type.trim() || WIDE_TYPES.has(type.trim().split(':').pop().toLowerCase()))) failed.push(index + 1);
  });
  workflow = { calls: calls.length, unreadable, contract: RUN_CONTRACT_LINE.test(script) };
  if (failed.length && !script.includes('Wide-surface reason:')) {
    denials.push(`${failed.length} of ${calls.length} Workflow agent() calls name no agentType or a wide-surface one `
      + `(the first is call ${failed[0]}), which starts from the default surface; set agentType on each to a `
      + 'code-ops-suite agent, or add "Wide-surface reason: <why>" to the script.');
  }
  if (high.length) {
    denials.push(`Workflow agent() call ${high[0]} sets an effort above high (${high.length} of ${calls.length} calls do); `
      + 'effort is at most high, and no Wide-surface reason allows more.');
  }
  if (belowFloor.length) {
    const first = belowFloor[0];
    denials.push(`Workflow agent() call ${first.call} sets model "${first.model}" (${first.rung}), below the ${first.floor} floor of ${first.type}`
      + `${belowFloor.length > 1 ? ` (${belowFloor.length} of ${calls.length} calls do)` : ''}; omit the model so the agent's frontmatter applies, or name one at its floor or above.`);
  }
  // One frontier dispatch per run: literal frontier models in this script, plus frontier ledger rows.
  const frontier = libs ? calls.filter((call) => typeof call?.keys.get('model') === 'string' && libs.rungOf(call.keys.get('model').trim()) === 'frontier').length : 0;
  if (frontier) {
    const prior = frontierCount(libs, sessionRows(libs, sessionId));
    if (frontier + prior > 1) {
      denials.push(`This Workflow script sets a frontier model on ${frontier} agent() call(s) and ${prior} frontier dispatch(es) already ran in this session; `
        + 'only one frontier peer runs per run. Use premium or strong for the rest.');
    }
  }
  if (unreadable) {
    advisories.push(`${unreadable} of ${calls.length} Workflow agent() calls pass options the guard cannot read (a variable or `
      + 'a spread); confirm each names a narrow agentType and an effort no higher than high.');
  }
  if (nonLiteral) {
    advisories.push(`${nonLiteral} of ${calls.length} Workflow agent() calls pass a model or effort that is not a literal string, `
      + 'so the guard cannot check it against the agent floor or the effort ceiling; confirm the value.');
  }
  reviewWorkflowContract(script, calls, unreadable, noEffort, cwd, advisories);
}

// The routing libraries, loaded once and only for a routed dispatch or a Workflow model. Null when
// either file is missing or malformed, so every routing check then skips (fail open).
let routingLibs;
async function getRoutingLibs() {
  if (routingLibs !== undefined) return routingLibs;
  routingLibs = null;
  try {
    const scripts = join(dirname(HOOK_PATH), '..', 'scripts');
    const load = (name) => import(pathToFileURL(join(scripts, name)).href);
    const [route, ledger] = await Promise.all([load('route-unit.mjs'), load('agent-ledger.mjs')]);
    for (const fn of [route.routeUnit, route.surfaceOfScope, route.applyMinKind, ledger.attemptOf, ledger.ledgerRows, ledger.rungOfModel]) {
      if (typeof fn !== 'function') throw new TypeError('routing library');
    }
    routingLibs = {
      routeUnit: route.routeUnit, surfaceOfScope: route.surfaceOfScope, rungRank: route.RUNG_RANK, floorRank: route.FLOOR_RANK,
      efforts: route.EFFORTS, surfaces: route.SURFACES, applyMinKind: route.applyMinKind, attemptOf: ledger.attemptOf, ledgerRows: ledger.ledgerRows, rungOf: ledger.rungOfModel,
    };
  } catch { routingLibs = null; }
  return routingLibs;
}

// Any `Label:` line ends a Scope block, so `Out of scope:` paths and the lines after the Scope never count.
// A label is words at line start under briefHas's rule; a colon followed by a slash (`C:/dir`) is a drive.
const LABEL_LINE = new RegExp(`${LABEL_HEAD}[A-Za-z][A-Za-z\\t -]{0,40}${LABEL_TAIL}(?![\\\\/])`, 'i');
const SCOPE_MAX = 8_000;
const word = (value) => value?.split(/[\s,;:()]+/)[0]?.toLowerCase().slice(0, 24) ?? null;

// The text of every `Scope:` line (or `## Scope` heading) block of the brief. A colon block runs to
// the next blank line or label line (blank lines after an empty `Scope:` do not end it); a heading
// block to the next heading or label line.
function scopeText(prompt) {
  const label = labelSource('Scope');
  const colon = new RegExp(`${LABEL_HEAD}${label}${LABEL_TAIL}(.*)$`, 'i');
  const heading = new RegExp(`^[ \\t]*#{1,6}[ \\t]+${label}(?![A-Za-z0-9])(.*)$`, 'i');
  const parts = [];
  let mode = null;
  let empty = false;
  for (const line of prompt.split(/\r?\n/)) {
    if (mode) {
      if (empty && !line.trim()) continue;
      const ends = LABEL_LINE.test(line) || (mode === 'colon' ? !line.trim() : /^[ \t]*#{1,6}[ \t]/.test(line));
      if (!ends) { empty = false; parts.push(line); continue; }
      mode = null;
    }
    const start = colon.exec(line);
    const head = start ? null : heading.exec(line);
    if (start || head) { mode = start ? 'colon' : 'heading'; empty = start !== null && !start[1].trim(); parts.push((start ?? head)[1]); }
  }
  return parts.join('\n').slice(0, SCOPE_MAX);
}

// Path candidates in a Scope text: each token holding a separator, alone and with up to five following
// tokens, so a path with spaces (`35 Contracts and Data`) reaches the surface patterns whole. A bare
// word such as `auth` in prose is never a candidate. A trailing line anchor (`:120-180`, `#L120`) drops.
function scopePaths(text) {
  const tokens = text.split(/[\s,;`'"()<>[\]{}|]+/)
    .map((token) => token.replace(/[.,:;!?]+$/, '').replace(/(?:#L\d+(?:-L?\d+)?|:\d+(?:[-:]\d+)?)$/i, '')).filter(Boolean);
  const paths = new Set();
  tokens.forEach((token, i) => {
    if (!/[\\/]/.test(token)) return;
    for (let n = 1; n <= 6 && i + n <= tokens.length; n++) paths.add(tokens.slice(i, i + n).join(' '));
  });
  return [...paths];
}

// The session's ledger rows, or [] for an unsafe session id or a ledger error.
function sessionRows(libs, sessionId) {
  try { return SAFE_SESSION.test(String(sessionId ?? '')) ? libs.ledgerRows({ sessionId }) : []; } catch { return []; }
}

// Frontier dispatches in ledger rows: `dispatched` rows that asked for frontier or applied a frontier
// model, each agent once.
function frontierCount(libs, rows) {
  const seen = new Set();
  return rows.filter((row) => row.status === 'dispatched' && (row.requestedTier === 'frontier' || libs.rungOf(row.appliedModel) === 'frontier')
    && (!row.agent_id || (!seen.has(row.agent_id) && seen.add(row.agent_id)))).length;
}

// `Route basis: <kind>; surface=<s>; ambiguity=<a>; reversible=<r>` as its parts.
function parseRouteBasis(line) {
  const get = (key) => new RegExp(`\\b${key}\\s*=\\s*([A-Za-z-]+)`, 'i').exec(line)?.[1]?.toLowerCase();
  return { kind: line.split(';')[0].trim().toLowerCase(), surface: get('surface'), ambiguity: get('ambiguity'), reversible: get('reversible') };
}

const SURFACE_TRIGGERS = new Set(['7a', '7d']);

// Behaviour 4, routing half, for a dispatch of an agent whose Contract requires `Tier`.
// Every denial here tightens the guard; a `Route override:` line clears only the shortfalls that come
// from the ambiguity and attempt triggers (7b, 7c) and the table rows, never a surface trigger.
function routeChecks(libs, input, type, prompt, sessionId, denials, advisories) {
  const fm = agentFrontmatter(type);
  const floorRung = libs.rungOf(fm?.model);
  const override = typeof input.model === 'string' ? input.model.trim() : '';
  // Grok does not run the Claude frontmatter model, so a valid Tier is not compared to it.
  const effective = process.env.GROK_PLUGIN_ROOT && !override ? null : (override ? libs.rungOf(override) : floorRung);
  const tier = word(briefValue(prompt, 'Tier'));
  const effort = word(briefValue(prompt, 'Effort'));
  const hasOverride = briefValue(prompt, 'Route override') !== null;
  const tierOk = tier !== null && Object.hasOwn(libs.rungRank, tier);
  const effortOk = effort !== null && libs.efforts.includes(effort);
  let rows = null;
  const ledger = () => {
    rows ??= sessionRows(libs, sessionId);
    return rows;
  };

  if (override && effective === null && tier !== null) {
    advisories.push(`The model override "${override}" cannot be ranked, so the guard cannot check Tier: ${tier} against the rung it runs at; confirm they agree.`);
  }
  if (tier !== null && !tierOk) denials.push(`Tier: "${tier}" is not a rung; use light, mid, strong, premium, or frontier.`);
  if (effort !== null && OVER_HIGH_EFFORT.has(effort)) {
    denials.push(`Effort: ${effort} is above high; effort is at most high, and no Route override allows more.`);
  } else if (effort !== null && !effortOk) denials.push(`Effort: "${effort}" is not an effort; use low, medium, or high.`);

  // Rung of the dispatch: the override against the agent floor, then against the brief Tier.
  const belowFloor = override && libs.rungOf(override) && floorRung && libs.floorRank[libs.rungOf(override)] < libs.floorRank[floorRung];
  if (belowFloor) {
    denials.push(`The model override "${override}" runs ${type} at ${libs.rungOf(override)}, below its ${floorRung} floor; `
      + `omit the override so the frontmatter model (${fm.model}) applies.`);
  } else if (tierOk && effective && tier !== effective) {
    const fix = tier === 'premium' ? 'pass model "opus"' : tier === 'frontier' ? 'pass model "fable"'
      : tier === 'strong' ? 'omit the model override' : `${type} cannot run below its ${floorRung} floor, so raise Tier`;
    denials.push(`Tier: ${tier} but the dispatch runs at ${effective}${override ? ` (model "${override}")` : ` (the frontmatter ${fm.model})`}; ${fix}.`);
  }

  // Frontier is one dispatch per run, counted from the ledger.
  if (tier === 'frontier' || effective === 'frontier') {
    const prior = frontierCount(libs, ledger());
    if (prior >= 1) denials.push(`A frontier dispatch already ran in this session (${prior} in the ledger); only one frontier peer runs per run. Dispatch at premium or strong.`);
  }

  // Effort the host can deliver: the Agent tool has no effort parameter.
  const fmEffort = fm?.effort && libs.efforts.includes(fm.effort) ? fm.effort : null;
  if (effortOk && fmEffort) {
    const asked = libs.efforts.indexOf(effort);
    const given = libs.efforts.indexOf(fmEffort);
    if (asked > given) {
      denials.push(`Effort: ${effort} is above the ${fmEffort} that ${type} runs at; the Agent tool carries no effort. `
        + 'Use Workflow agent({ agentType, model, effort }) to dispatch at that effort.');
    } else if (asked < given) {
      advisories.push(`Effort: ${effort} is below the ${fmEffort} that ${type} runs at; the Agent tool cannot lower it. Use Workflow agent() to run at ${effort}.`);
    }
  }

  // Surface, then the routed floor for Tier and Effort.
  const basisLine = briefValue(prompt, 'Route basis');
  if (basisLine === null) return;
  const basis = parseRouteBasis(basisLine);
  const derived = libs.surfaceOfScope(scopePaths(scopeText(prompt)));
  if (basis.surface === undefined) {
    denials.push('Route basis names no surface=<s>; add it (none, security, egress, migration, public-contract, or gate-script).');
  } else if (!libs.surfaces.includes(basis.surface)) {
    denials.push(`Route basis names surface=${basis.surface}, which is not a surface; use ${libs.surfaces.join(', ')}.`);
  } else if (basis.surface !== derived && derived !== 'none') {
    denials.push(`Route basis says surface=${basis.surface} but the Scope paths derive surface=${derived}; correct the line or the Scope. `
      + 'A Route override line does not clear a surface mismatch.');
  } else if (basis.surface !== derived) {
    // No Scope path derives a surface (a directory-level Scope, say), so a declared surface routes up; it is never a contradiction.
    advisories.push(`Route basis says surface=${basis.surface} but the Scope paths derive no surface; routing up is allowed, and it costs more.`);
  }
  const unit = (briefValue(prompt, 'Unit') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null;
  const { kind, raisedFrom } = libs.applyMinKind(basis.kind, type);
  if (raisedFrom) advisories.push(`Route basis kind=${raisedFrom} is below the minimum for ${type}; routing it as ${kind}.`);
  const base = { kind, ambiguity: basis.ambiguity, reversible: basis.reversible, surface: derived };
  const floorTier = ['light', 'mid', 'strong', 'frontier'][libs.floorRank[floorRung]];
  if (floorTier) base.floor = floorTier;
  let full;
  let hard;
  try {
    full = libs.routeUnit({ ...base, attempt: unit ? libs.attemptOf(ledger(), unit) : 1 });
    // The surface triggers alone: no ambiguity-and-irreversible trigger, no retry trigger.
    hard = libs.routeUnit({ ...base, reversible: 'yes', attempt: 1 });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    denials.push(`Route basis is not valid: ${error.message}.`);
    return;
  }
  if (!tierOk) return;
  const under = (route) => libs.rungRank[tier] < libs.rungRank[route.rung]
    || (effortOk && route.effort !== 'adaptive' && libs.efforts.indexOf(effort) < libs.efforts.indexOf(route.effort));
  const want = (route) => `${route.rung} at ${route.effort} effort (rule ${route.rule}: ${route.why})`;
  if (SURFACE_TRIGGERS.has(hard.rule) && under(hard)) {
    denials.push(`Tier ${tier} / Effort ${effort ?? 'unset'} is below ${want(hard)}; a Route override line does not clear a surface trigger.`);
  } else if (under(full) && !hasOverride) {
    denials.push(`Tier ${tier} / Effort ${effort ?? 'unset'} is below ${want(full)}; raise them (\`co route\` prints the block), `
      + 'or add a "Route override: <reason>" line to depart from the table.');
  }
  if (libs.rungRank[tier] > libs.rungRank[full.rung]) {
    advisories.push(`Tier: ${tier} is above the routed ${full.rung} (rule ${full.rule}); it costs more and is never denied.`);
  }
}

async function reviewRouting(input, type, prompt, sessionId, denials, advisories) {
  const libs = await getRoutingLibs();
  if (!libs) return;
  try { routeChecks(libs, input, type, prompt, sessionId, denials, advisories); } catch { /* fail open */ }
}

// Behaviour 4: the lead's own dispatch. A wide surface without a stated reason is a denial, and so
// is a routing breach for an agent that requires `Tier`; a missing Round budget stays advisory.
async function reviewDispatch(tool, input, budget, denials, advisories, sessionId, cwd) {
  if (tool === 'Workflow') {
    await reviewWorkflow(typeof input.script === 'string' ? input.script : '', denials, advisories, sessionId, cwd);
    return [];
  }
  const type = typeof input.subagent_type === 'string' ? input.subagent_type.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const spawn = tool === 'spawn_subagent' || tool === 'spawn_agent';

  // The spawn tools take their effort as an input field; a literal above high never passes.
  // deferred(the field name is UNVERIFIED on each host, upgrade path: read it from a captured payload).
  if (spawn) {
    const over = ['effort', 'reasoning_effort', 'reasoningEffort'].find((key) => OVER_HIGH_EFFORT.has(String(input[key] ?? '').trim().toLowerCase()));
    if (over) denials.push(`${tool} sets ${over} above high; effort is at most high, and no Wide-surface reason allows more.`);
  }
  const typeless = spawn && input.subagent_type === undefined;
  if (!typeless && (!type || WIDE_TYPES.has(type.split(':').pop().toLowerCase())) && !WIDE_REASON.test(prompt)) {
    denials.push(`${type || 'An unnamed type'} starts from a large default or inherited context; `
      + 'dispatch code-ops-suite:implementer, explorer, reviewer, mech, web-researcher, or probe, or add a '
      + '"Wide-surface reason: <why>" line to the brief.');
  }
  const required = requiredFields(type);
  const missing = required.filter((field) => !briefHas(prompt, field));
  if ((tool === 'Agent' || tool === 'Task' || spawn) && required.some((field) => /^tier$/i.test(field))) {
    await reviewRouting(input, type, prompt, sessionId, denials, advisories);
  }
  if (missing.length) {
    denials.push(`The ${type} Contract requires these brief fields, missing: ${missing.join(', ')}; `
      + 'add each as a "Label:" line or a heading. The missing lines open this denial, ready to fill; '
      + `\`node "${join(dirname(dirname(HOOK_PATH)), 'scripts', 'co.mjs')}" brief ${type}\` prints the full template.`);
  }
  // A field denial that already names Round budget makes this advisory a repeat.
  const deniedBudget = missing.some((field) => /^round budget$/i.test(field));
  if (typeof input.prompt === 'string' && !deniedBudget && !/round budget/i.test(input.prompt)) {
    advisories.push(`No Round budget in the brief; the guard warns at ${budget} rounds, `
      + `stops at ${stopCall(budget)}.`);
  }
  return missing.map((field) => `${field}:`);
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
  const skeleton = await reviewDispatch(tool, input, budget, denials, advisories, payload.session_id,
    typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd());
  if (!denials.length && !advisories.length) return;
  // The skeleton opens the text, one label per line. Grok keeps the start of a denial and
  // drops the tail, so a skeleton that closed the text never reached the retry.
  const prose = `Dispatch guard: ${[...denials, ...advisories].join(' ')}`;
  const text = skeleton.length ? `${skeleton.join('\n')}\n${prose}` : prose;
  emit({ hookSpecificOutput: hardStop && denials.length
    ? { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text }
    : { hookEventName: 'PreToolUse', additionalContext: text } });
}

async function main() {
  if (await command()) return;
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
  current = { tool_name: payload.tool_name, session_id: payload.session_id, subagent: typeof agentId === 'string' && agentId !== '' };
  collision = await collisionFor(payload, agentId);
  const denial = await legacyFor(payload);
  if (denial && hardStop) legacy = denial;
  // Warn mode lifts the denial: the text joins the note, which reaches the model as context.
  else if (denial) collision = { text: collision ? `${denial}\n${collision.text}` : denial, commit: collision?.commit ?? (() => {}) };
  if (typeof agentId === 'string' && agentId) {
    // Only the host's own `agent_id` locates a subagent transcript; Grok's layout is unverified.
    guardSubagent({ ...payload, agent_id: agentId }, budget, hardStop, agentId === payload.agent_id);
    finishLegacy();
    finishCollision();
    return;
  }
  await guardMainThread(payload, budget, hardStop);
  finishLegacy();
  finishCollision();
}

main().catch(() => { /* fail open */ });
