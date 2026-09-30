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
// type, a description cut to 80 characters, the directory, and a timestamp, never a prompt or a
// message. The format, the storage path, and the read side live in `../scripts/agent-ledger.mjs`.
//
// Host contract (host 2.1.276): the `PostToolUse` payload carries `tool_name`, `tool_input`, and
// `tool_response`; an async launch returns `status: "async_launched"` and an `agentId`. The
// `SubagentStop` payload carries `agent_id` and `agent_type`; an empty `agent_type` marks an
// internal summarizer, which the ledger ignores. The Grok adapter's payloads are UNVERIFIED for
// both events, so the hook stays silent under Grok.
//
// Fail-open on every path: bad JSON, a missing field, an unwritable directory, or an internal
// error exits 0 with no output. It reads stdin, appends one file, and spawns nothing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main() {
  if (process.env.GROK_PLUGIN_ROOT) return;
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_AGENT_LEDGER ?? '')) return;
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }
  let payload;
  try { payload = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
  if (!payload || typeof payload !== 'object') return;
  const lib = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'agent-ledger.mjs');
  const { recordFromPayload } = await import(pathToFileURL(lib).href);
  recordFromPayload(payload);
}

main().catch(() => { /* fail open */ });
