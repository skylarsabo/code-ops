#!/usr/bin/env node
// PreToolUse hook: tool-layer backstop for the traceless-publishing rule.
//
// Reads a coding-agent PreToolUse payload from stdin. When the Bash command about to
// run is a commit or PR-open/-merge, the bundled scan-ai-tells.mjs scans it in --command
// mode before the tool call proceeds: the raw command string, and each message, trailer,
// title, and body argument value the command would publish, on its own line. A scanner
// exit other than 0 blocks the call (exit 2). A scanner that cannot spawn fails open
// (exit 0), because the "Traceless publishing (PR commits, title, body)" step of
// .github/workflows/validate.yml is the fail-closed backstop on every pull request.
//
//   node hooks/enforce-traceless.mjs   (reads the PreToolUse JSON payload on stdin)

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A commit/PR-open/-merge invocation, tolerant of `git -C <dir>` / `git --flag=val`
// prefixes ahead of the subcommand. Anything else is out of scope for this gate.
const GATED_RE = /\bgit(?:\s+-[Cc]\s+\S+|\s+--\S+=\S+)*\s+commit\b|\bgh\s+pr\s+(?:create|merge)\b/i;

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function commandInput(payload) {
  const name = String(payload?.tool_name ?? payload?.toolName ?? payload?.tool?.name ?? '').toLowerCase();
  if (!['bash', 'shell', 'exec_command', 'functions.exec_command', 'run_terminal_command'].some((tool) => name === tool || name.endsWith(`.${tool}`))) return null;
  const input = payload?.tool_input ?? payload?.toolInput ?? payload?.input;
  if (!input || typeof input !== 'object') return null;
  const command = input.command ?? input.cmd;
  return typeof command === 'string' ? command : null;
}

function main() {
  const raw = readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return 0; // malformed input, defensive fail-open
  }
  const command = commandInput(payload);
  if (command === null) return 0;

  if (!GATED_RE.test(command)) return 0; // fast path: no fs/spawn for the common case

  const scannerPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scan-ai-tells.mjs');
  const tmpFile = join(tmpdir(), `traceless-hook-${randomUUID()}.txt`);
  try {
    writeFileSync(tmpFile, command, 'utf8');
    execFileSync(process.execPath, [scannerPath, '--command', tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    return 0; // scanner exited 0, clean
  } catch (e) {
    if (typeof e.status === 'number') {
      // The scanner ran and found hits (exit 1); block the tool call.
      const report = (e.stdout ?? '').toString();
      process.stderr.write('Traceless gate: AI-tell in commit/PR command.\n');
      process.stderr.write(report);
      process.stderr.write(
        '\nRewrite the message without the flagged content. If the hit is in a non-message ' +
          'part of a compound command, run the commit as its own command.\n',
      );
      return 2;
    }
    // Spawn-level failure (ENOENT, permissions, ...): infra error, fail open.
    return 0;
  } finally {
    try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
  }
}

process.exit(main());
