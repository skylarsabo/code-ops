#!/usr/bin/env node
// PostToolUse hook: replaces a long Bash or Read result with its digest before the model sees it.
//
// Reads a PostToolUse payload from stdin and hands tool_name, tool_response, and the thread
// (payload.agent_id, set only inside a subagent) to digestToolResponse in scripts/digest-lib.mjs,
// which owns the thresholds, the switches, and the raw store. When it returns a replacement, the
// hook prints `{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":<it>}}`.
// Otherwise it prints nothing.
//
//   node hooks/digest-post.mjs   (reads the PostToolUse JSON payload on stdin)
//
// SELF-FILTER. Only `Bash` and `Read` are digested. Any other tool name, including a Codex or
// opencode tool name, exits 0 silently, so the Codex build, which drops hook matchers, stays harmless.
//
// FAIL-OPEN on every path: bad JSON, a missing field, a failed import, or any thrown error exits
// 0 with no output. The hook never exits 2 and never prints on an error, because a stray byte on
// stdout would replace the tool output with garbage.

import { readFileSync, writeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

async function main() {
  let payload;
  try { payload = JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, '')); } catch { return; }
  const tool = payload?.tool_name;
  if (tool !== 'Bash' && tool !== 'Read') return;

  const libPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'digest-lib.mjs');
  const { digestToolResponse } = await import(pathToFileURL(libPath).href);
  const command = payload.tool_input?.command;
  const replacement = digestToolResponse(tool, payload.tool_response, {
    agentId: typeof payload.agent_id === 'string' && payload.agent_id !== '' ? payload.agent_id : undefined,
    cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
    sessionId: typeof payload.session_id === 'string' && payload.session_id !== '' ? payload.session_id : undefined,
    filePath: typeof payload.tool_input?.file_path === 'string' ? payload.tool_input.file_path : undefined,
    ranged: payload.tool_input?.offset !== undefined || payload.tool_input?.limit !== undefined,
    command: typeof command === 'string' ? command : undefined,
  });
  if (replacement === null || replacement === undefined) return;

  writeSync(1, `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: replacement } })}\n`);
}

try { await main(); } catch { /* fail open: a hook error must never alter a tool result */ }
process.exit(0);
