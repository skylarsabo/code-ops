#!/usr/bin/env node
// SubagentStart hook: hands an implementer-class subagent the code-economy ladder as a card of
// at most ten lines, because SessionStart context never reaches a subagent and the ladder
// (CONVENTIONS §11 "Size discipline") is what an implementer needs before it writes code.
//
// ON BY DEFAULT, OFF PER REPOSITORY OR USER, and a measured arm. The hook does nothing when
// `CODE_OPS_LADDER_CARD` is `off`, `0`, or `false` (case-insensitive) in its environment, which
// the `env` block of a `.claude/settings.json` sets at user or repository scope. Phase 6 of the
// context and code economy design note reads the session receipts for the card against sessions
// run with it off, and removes it if it does not earn its lines.
//
// Host contract (host 2.1.257 bundle): the SubagentStart input carries `agent_id` and
// `agent_type` (offset 183160743; the input is built at 190336771), and the hook's
// `hookSpecificOutput.additionalContext` (183169362) is appended to the subagent's own messages
// (188311119). The `matcher` field of a SubagentStart hook matches `agent_type`, so a
// `hooks.json` with no matcher fires for every type and the filter below decides.
//
// Only an implementer-class type gets the card. A read-only operative (explorer, reviewer,
// tracer, verifier, gatherer, claim-checker, privacy-reviewer, mech-review, and any type that
// ends in `explorer` or `reviewer`) never writes code, so the card would cost tokens for
// nothing. A plugin-qualified type (`code-ops-suite:explorer`) is judged by its last segment.
//
// Fail-open on every path: bad JSON, a missing type, or an internal error exits 0 with no
// output. It reads stdin, imports one builtin, and spawns nothing.

import { readFileSync, writeSync } from 'node:fs';

const READ_ONLY = new Set(['explorer', 'reviewer', 'tracer', 'verifier', 'gatherer', 'claim-checker', 'privacy-reviewer', 'mech-review', 'plan', 'explore']);

const CARD = [
  'Code-economy ladder (code-ops):',
  '1. Objective order: correctness and the safety floor, module boundaries, measured performance on hot paths, readability, then size. Fewer lines wins only between candidates equal on the first four.',
  '2. Does it need to exist? Scope is the request.',
  '3. Does it exist here? Search before you write.',
  '4. Does the standard library, the platform, or an installed dependency do it? Verify against current docs, never memory.',
  '5. Does it fit inside the owning module? Extend before you add a file.',
  '6. Extract only on evidence: a second caller, a unit that needs its own test, or a file past the repository\'s own size norm.',
  '7. Then write the minimum edge-case-correct implementation.',
  '8. Never trade algorithmic complexity for brevity on a measured hot path.',
  '9. Mark a deliberate simplification with a deferred(<ceiling>, <upgrade path>) comment.',
].join('\n');

function implementerClass(agentType) {
  if (typeof agentType !== 'string' || !agentType.trim()) return false;
  const leaf = agentType.split(':').pop().trim().toLowerCase();
  if (READ_ONLY.has(leaf)) return false;
  return !/(explorer|reviewer)$/.test(leaf);
}

function main() {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_LADDER_CARD ?? '')) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  if (payload?.hook_event_name && payload.hook_event_name !== 'SubagentStart') return;
  if (!implementerClass(payload?.agent_type)) return;
  writeSync(1, `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: CARD } })}\n`);
}

try { main(); } catch { /* fail open */ }
