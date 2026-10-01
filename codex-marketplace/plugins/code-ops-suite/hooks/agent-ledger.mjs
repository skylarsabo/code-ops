#!/usr/bin/env node
// PostToolUse (Agent, Task) and SubagentStop hook: records every subagent launch and every
// subagent report in an append-only ledger, so a tool can list the agents still unreported
// after the launching session hands off or ends (`co agents pending`). A background agent
// reports only to the session that launched it, so without the ledger its report is lost and the
// agent is forgotten.
//
// ON BY DEFAULT, OFF PER REPOSITORY OR USER. The hook does nothing when `CODE_OPS_AGENT_LEDGER`
// is `off`, `0`, or `false` (case-insensitive) in its environment.
//
// RECORD ONLY. It prints nothing, never blocks, and never adds context. It stores ids, the agent
// type, a description cut to 80 characters, the directory, a timestamp, and the path on the brief's
// `Report path:` line, never a prompt or a message. The format, the storage path, and the read side
// live in `../scripts/agent-ledger.mjs`.
//
// Host contract (host 2.1.276): the `PostToolUse` payload carries `tool_name`, `tool_input`, and
// `tool_response`; an async launch returns `status: "async_launched"` and an `agentId`. The
// `SubagentStop` payload carries `agent_id` and `agent_type`; an empty `agent_type` marks an
// internal summarizer, which the ledger ignores. A launch row also carries the routing fields
// (`unit`, `requestedTier`, `requestedEffort`, `appliedModel`, `appliedEffort`, `effortSource`,
// `flag`), read from the brief's `Unit:`, `Tier:`, and `Effort:` lines and the agent frontmatter.
// Grok's SubagentStop (live capture, 2026-10-01) carries camelCase `subagentId` and `subagentType`
// and no `agent_id`; the library maps them, so under Grok the hook records the stop. The Grok
// launch payload is UNVERIFIED, so a Grok launch records nothing.
//
// PAYLOAD CAPTURE, OFF BY DEFAULT. With `CODE_OPS_AGENT_LEDGER_CAPTURE=1`, or a `capture.on` flag
// file in the ledger directory (`captureOn` in the library), the hook also appends the payload's
// key names, a few allowlisted scalar values, and the host to `payload-keys.ndjson` in that
// directory, so the Codex and Grok payloads can be checked before a writer is built for them. It
// runs before the Grok and ledger-off early returns, so every host's payload is captured; a Grok
// launch still records no row, and `CODE_OPS_AGENT_LEDGER=off` still writes no ledger row.
//
// Fail-open on every path: bad JSON, a missing field, an unwritable directory, or an internal
// error exits 0 with no output. It reads stdin, appends one or two files, and spawns nothing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main() {
  const lib = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'agent-ledger.mjs');
  const { captureKeys, captureOn, recordFromPayload } = await import(pathToFileURL(lib).href);
  let capture = false;
  try { capture = captureOn(); } catch { /* an unreadable state dir means capture off */ }
  const grok = Boolean(process.env.GROK_PLUGIN_ROOT);
  const ledgerOff = /^(off|0|false)$/i.test(process.env.CODE_OPS_AGENT_LEDGER ?? '');
  if (!capture && ledgerOff) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  if (!payload || typeof payload !== 'object') return;
  if (capture) { try { captureKeys(payload); } catch { /* capture never blocks the record */ } }
  if (ledgerOff) return;
  // Grok records only the stop: its launch payload is UNVERIFIED, its stop is captured (2026-10-01).
  if (grok && (payload.hook_event_name ?? payload.hookEventName) !== 'SubagentStop') return;
  recordFromPayload(payload);
}

main().catch(() => { /* fail open */ });
