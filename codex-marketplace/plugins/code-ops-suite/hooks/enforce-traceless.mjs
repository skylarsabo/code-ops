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
// The same hook gates branch names (scripts/branch-name.mjs): a command that creates or renames a
// branch, commits, pushes, or opens a pull request is blocked (exit 2) when a branch it names or
// runs on starts with an AI-tool name or ends in a generated token. A branch problem is
// fail-closed; a failure to run the check is fail-open, as for the scanner.
//
//   node hooks/enforce-traceless.mjs   (reads the PreToolUse JSON payload on stdin)

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A commit/PR-open/-merge invocation, tolerant of `git -C <dir>` / `git --flag=val`
// prefixes ahead of the subcommand. Anything else is out of scope for this gate.
const GATED_RE = /\bgit(?:\s+-[Cc]\s+\S+|\s+--\S+=\S+)*\s+commit\b|\bgh\s+pr\s+(?:create|merge)\b/i;

// A command that may name or run on a branch: any git command carrying one of the branch-relevant
// subcommand words, or gh pr create. Cheap to test; the parse and the git lookup run only on a match.
const BRANCH_RE = /\bgit\b[\s\S]*\b(?:commit|push|checkout|switch|branch|worktree)\b|\bgh\s+pr\s+create\b/i;

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

// The branch-name gate. Returns the block message, or null when the command is clean or the check
// cannot run (infrastructure failure, fail-open).
async function branchViolation(command, payload) {
  try {
    const lib = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'branch-name.mjs')).href);
    const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const violations = lib.commandBranchViolations(command, cwd);
    if (!violations.length) return null;
    const lines = violations.flatMap((v) => v.problems.map((p) => `${p} (${v.source}).`));
    return `${lines.map((l) => `Branch-name gate: ${l}`).join('\n')}\n${lib.FIX_TEXT}\n`;
  } catch {
    return null;
  }
}

async function main() {
  const raw = readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return 0; // malformed input, defensive fail-open
  }
  const command = commandInput(payload);
  if (command === null) return 0;

  if (BRANCH_RE.test(command)) {
    const message = await branchViolation(command, payload);
    if (message !== null) {
      process.stderr.write(message);
      return 2;
    }
  }

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

process.exit(await main());
