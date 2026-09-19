#!/usr/bin/env node
// SessionStart hook: prints a hard-capped routing card so the lead defaults into
// standard operating mode from the first turn. After compaction it adds a short restore
// instruction; unlike PreCompact stdout, SessionStart context is consumed by Claude/Codex.
//
// Grok passive-hook stdout is ignored, so its instruction files carry this doctrine and this
// hook emits nothing there. Fail-open: any error exits 0 silently.
//
// PENDING HANDOFF PICKUP. A fresh session (`source` of `startup` or `clear`, never `resume` or
// `compact`) also gets one line naming the newest unconsumed `HANDOFF.md` the handoff skill left
// in a dated run folder, so the state a previous session captured is picked up without the
// operator re-explaining it. ON BY DEFAULT, OFF PER REPOSITORY OR USER: the line is omitted when
// `CODE_OPS_HANDOFF_PICKUP` is `off`, `0`, or `false` (case-insensitive), the same switch shape
// `CODE_OPS_HANDOFF_CARD` uses in hooks/handoff-card.mjs.
//
//   node hooks/routing-card.mjs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// A handoff older than this is history rather than pending state: the tree has moved too far for
// its claims to be worth a resumed session's verification pass.
const PENDING_DAYS = 14;

const localDate = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The newest pending HANDOFF.md under a documentation hub's `80 Runs/`, or null. Pending means no
// sibling `HANDOFF.consumed` (check-handoff.mjs --consume writes that once a resume verifies the
// file) and an mtime inside PENDING_DAYS. The hub layout rule (vault-standard.md) puts one
// `<repo>-docs/` hub at the repository root with dated run folders under its `80 Runs/`, so this
// reads two bounded directory levels, never a recursive walk: the root's own entries, then
// `80 Runs/` in the root and in each `-docs` hub beside it. Every read is guarded, because a
// SessionStart hook stays inside a few milliseconds and fails open.
function pendingHandoff(cwd) {
  const roots = [cwd];
  let entries;
  try { entries = readdirSync(cwd, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith('-docs')) roots.push(join(cwd, entry.name));
  }
  const cutoff = Date.now() - PENDING_DAYS * 86_400_000;
  let best = null;
  for (const root of roots) {
    const runs = join(root, '80 Runs');
    let folders;
    try { folders = readdirSync(runs, { withFileTypes: true }); } catch { continue; }
    for (const folder of folders) {
      if (!folder.isDirectory()) continue;
      const dir = join(runs, folder.name);
      if (existsSync(join(dir, 'HANDOFF.consumed'))) continue;
      const file = join(dir, 'HANDOFF.md');
      let mtime;
      try { mtime = statSync(file).mtimeMs; } catch { continue; }
      if (mtime < cutoff) continue;
      if (!best || mtime > best.mtime) best = { file, mtime };
    }
  }
  if (!best) return null;
  // Repo-relative with forward slashes, so the path reads the same on Windows and POSIX. Folder
  // names carry spaces ("80 Runs", "2026-09-18 token-spend-audit") and are never quoted here.
  return { path: relative(cwd, best.file).split(sep).join('/'), written: localDate(best.mtime) };
}

function main() {
  if (process.env.GROK_PLUGIN_ROOT) return 0;
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}'); } catch { /* ordinary start */ }
  const lines = [
    'code-ops standard operating mode',
    'debug a bug -> code-ops-suite:debug',
    'ship a feature/change -> code-ops-suite:ship',
    'audit/quality sweep -> code-ops-suite:full-sweep or rigor:rigor-sweep',
  'privacy/leak concern -> privacy-opsec-suite:full-sweep',
    'library/dependency decision -> researcher:library-eval',
    'claim verification -> researcher:research-verify',
    'everything (broad/multi-domain) -> code-ops-suite:everything',
    'substantive work -> frontier orchestrator plus strong operatives; delegate every independently briefable unit and launch at least two disjoint units in parallel when possible',
    'the root continuously synthesizes, challenges assumptions, reprioritizes, and redirects; inline busy work requires a stated trivial-or-indivisible exception',
    'a dispatch costs context times turns: use the narrowest shipped agent (code-ops-suite:implementer for build work, never general-purpose), name a round budget in the brief, keep breadth agents at their declared tier, and batch independent tool calls',
    'premium frontier peers only for the hardest bounded architecture, refutation, or synthesis; verdicts and acceptance stay with the lead',
    'say in a line what you are about to do, give brief updates while you work, and close with a recap that stands on its own',
    'only you see a command\'s output; put what the user needs to read in your reply',
    'context economy: skim before reading, query the symbol index before a map, digest output is on by default, size is a tie-breaker behind correctness, boundaries, performance, and readability',
    'see: in the code-ops repository, https://github.com/skylarsabo/code-ops/blob/main/code-ops-docs/40%20Engineering/Handbook/11-standard-operating-mode.md and https://github.com/skylarsabo/code-ops/blob/main/code-ops-docs/40%20Engineering/Techniques/dispatch-brief-template.md',
  ];
  if (payload?.source === 'compact') {
    lines.push('compaction resume: restore decisions, constraints, completed and open work, exact identifiers, and named durable artifacts before continuing; never restore redacted values');
  } else if ((payload?.source === 'startup' || payload?.source === 'clear')
    && !/^(off|0|false)$/i.test(process.env.CODE_OPS_HANDOFF_PICKUP ?? '')) {
    const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const pending = pendingHandoff(cwd);
    if (pending) {
      lines.push(`pending handoff: ${pending.path} (written ${pending.written}). Before other work, run the code-ops-suite:handoff skill in resume mode on it, verify its claims, and open your reply with a recap under five headings: work completed, key findings, in progress, left to do, project scope and constraints. If the operator's first request is unrelated, name the pending handoff in one line and proceed with their request.`);
    }
  }
  console.log(lines.join('\n'));
  return 0;
}

try {
  process.exit(main());
} catch {
  process.exit(0);
}
