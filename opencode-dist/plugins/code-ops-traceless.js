// opencode port of the traceless-publishing PreToolUse gate.
//
// WHY: the canonical Claude hook (plugins/code-ops-suite/hooks/enforce-traceless.mjs) is a
// stdin/exit-code contract that opencode does not speak. opencode plugins subscribe to
// `tool.execute.before` and block a call by throwing, so the gate is ported rather than
// copied. The policy is identical: scan a commit / PR-open / PR-merge shell command with
// the bundled scan-ai-tells.mjs in --command mode, which covers the raw command and each
// message, trailer, title, and body argument value it would publish. Block on a hit, and
// fail OPEN when the scanner cannot spawn, because the "Traceless publishing (PR commits,
// title, body)" CI step is the fail-closed backstop on every pull request.
//
// The same plugin gates branch names, as the Claude hook does, with the bundled
// scripts/branch-name.mjs: a command that creates or renames a branch, commits, pushes, or
// opens a pull request is blocked when a branch it names or runs on starts with an AI-tool
// name or ends in a generated token. A branch problem is fail-closed; a failure to run the
// check is fail-open, as for the scanner.
//
// Install: copy to <opencode config dir>/plugins/. It resolves the scanner and the branch
// check relative to its own location, so keep the distribution layout intact.

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
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

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'code-ops', 'code-ops-suite', 'scripts');
const SCANNER = join(SCRIPTS, 'scan-ai-tells.mjs');
const BRANCH_CHECK = join(SCRIPTS, 'branch-name.mjs');

// The branch-name gate. Returns the block message, or null when the command is clean or the
// check cannot run (infrastructure failure, fail-open).
async function branchViolation(command, cwd) {
  try {
    const lib = await import(pathToFileURL(BRANCH_CHECK).href);
    const violations = lib.commandBranchViolations(command, cwd);
    if (!violations.length) return null;
    const lines = violations.flatMap((v) => v.problems.map((p) => `${p} (${v.source}).`));
    return `${lines.map((l) => `Branch-name gate: ${l}`).join('\n')}\n${lib.FIX_TEXT}`;
  } catch {
    return null;
  }
}

export const CodeOpsTraceless = async ({ directory } = {}) => ({
  'tool.execute.before': async (input, output) => {
    if (input?.tool !== 'bash') return;
    const command = output?.args?.command;
    if (typeof command !== 'string') return;

    if (BRANCH_RE.test(command)) {
      const message = await branchViolation(command, typeof directory === 'string' && directory ? directory : process.cwd());
      if (message !== null) throw new Error(message);
    }

    if (!GATED_RE.test(command)) return; // fast path: no fs/spawn for the common case

    const tmpFile = join(tmpdir(), `traceless-hook-${randomUUID()}.txt`);
    let report = null;
    try {
      writeFileSync(tmpFile, command, 'utf8');
      execFileSync(process.execPath, [SCANNER, '--command', tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      // The scanner ran and found hits (exit 1). Anything else — ENOENT, permissions — is
      // an infrastructure failure, and this gate fails open on those by design.
      if (typeof e.status === 'number') report = (e.stdout ?? '').toString();
    } finally {
      try { unlinkSync(tmpFile); } catch { /* best-effort cleanup */ }
    }

    if (report !== null) {
      throw new Error(
        'Traceless gate: AI-tell in commit/PR command.\n' +
          report +
          '\nRewrite the message without the flagged content. If the hit is in a non-message ' +
          'part of a compound command, run the commit as its own command.',
      );
    }
  },
});
