#!/usr/bin/env node
// PreToolUse hook: tool-layer backstop for the traceless-publishing rule.
//
// Reads a coding-agent PreToolUse payload from stdin. When the Bash command about to
// run is a commit or PR-open/-merge, the full command string is scanned with the
// bundled scan-ai-tells.mjs for AI/tooling trace before the tool call is allowed to
// proceed. A hit blocks the call (exit 2); everything else, including any scanner
// infra failure, fails open (exit 0), because CI (`scan-ai-tells.mjs --git <range>`)
// is the fail-closed backstop this hook only shortens the feedback loop for.
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

function main() {
  const raw = readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return 0; // malformed input, defensive fail-open
  }
  if (payload?.tool_name !== 'Bash') return 0;
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string') return 0;

  if (!GATED_RE.test(command)) return 0; // fast path: no fs/spawn for the common case

  const scannerPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'scan-ai-tells.mjs');
  const tmpFile = join(tmpdir(), `traceless-hook-${randomUUID()}.txt`);
  try {
    writeFileSync(tmpFile, command, 'utf8');
    execFileSync(process.execPath, [scannerPath, tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
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
