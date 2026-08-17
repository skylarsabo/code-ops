// opencode port of the traceless-publishing PreToolUse gate.
//
// WHY: the canonical Claude hook (plugins/code-ops-suite/hooks/enforce-traceless.mjs) is a
// stdin/exit-code contract that opencode does not speak. opencode plugins subscribe to
// `tool.execute.before` and block a call by throwing, so the gate is ported rather than
// copied. The policy is identical: scan a commit / PR-open / PR-merge shell command for
// AI or tooling trace with the bundled scan-ai-tells.mjs, block on a hit, and fail OPEN on
// any scanner infrastructure failure — CI (`scan-ai-tells.mjs --git <range>`) is the
// fail-closed backstop that this hook only shortens the feedback loop for.
//
// Install: copy to <opencode config dir>/plugins/. It resolves the scanner relative to its
// own location, so keep the distribution layout intact.

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// A commit/PR-open/-merge invocation, tolerant of `git -C <dir>` / `git --flag=val`
// prefixes ahead of the subcommand. Anything else is out of scope for this gate.
const GATED_RE = /\bgit(?:\s+-[Cc]\s+\S+|\s+--\S+=\S+)*\s+commit\b|\bgh\s+pr\s+(?:create|merge)\b/i;

const SCANNER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'code-ops',
  'code-ops-suite',
  'scripts',
  'scan-ai-tells.mjs',
);

export const CodeOpsTraceless = async () => ({
  'tool.execute.before': async (input, output) => {
    if (input?.tool !== 'bash') return;
    const command = output?.args?.command;
    if (typeof command !== 'string') return;
    if (!GATED_RE.test(command)) return; // fast path: no fs/spawn for the common case

    const tmpFile = join(tmpdir(), `traceless-hook-${randomUUID()}.txt`);
    let report = null;
    try {
      writeFileSync(tmpFile, command, 'utf8');
      execFileSync(process.execPath, [SCANNER, tmpFile], { stdio: ['ignore', 'pipe', 'pipe'] });
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
