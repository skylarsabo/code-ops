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
  return { path: relative(cwd, best.file).split(sep).join('/'), written: localDate(best.mtime), program: programPath(best.file) };
}

// The `Program:` path under the handoff's `## Program` heading, or null. The handoff is capped at
// 8 KB, so only its first PROGRAM_SCAN_BYTES are read. A path longer than PROGRAM_PATH_CHARS or
// still a `[FILL:` placeholder is left off the card, which keeps the card's size bounded.
const PROGRAM_SCAN_BYTES = 8192;
const PROGRAM_PATH_CHARS = 200;
function programPath(file) {
  let text;
  try { text = readFileSync(file, 'utf8').slice(0, PROGRAM_SCAN_BYTES); } catch { return null; }
  const section = /^##[ \t]+Program[ \t]*\r?$([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m.exec(text)?.[1] ?? '';
  const value = /^[-*\t ]*Program:[^\S\r\n]*(.*)$/m.exec(section)?.[1].trim().replace(/^`(.*)`$/, '$1').trim();
  if (!value || value.length > PROGRAM_PATH_CHARS || value.includes('[FILL:') || /[\u0000-\u001f]/.test(value)) return null;
  return value;
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
    'substantive work -> session lead, task-based tiers, disjoint units in parallel when the graph allows; strong is the judgment floor',
    'a dispatch costs context times turns: code-ops-suite:implementer for build work, a round budget, breadth agents at their declared tier',
    'one frontier peer only for a bounded architecture, refutation, mathematics, or synthesis decision; the lead keeps the verdict',
    'say what you are about to do, then close with a recap that stands on its own',
    'only you see a command\'s output; put what the user needs to read in your reply',
    'context economy: read the named convention sections only, skim before a whole file, and query the symbol index before a map',
  ];
  if (payload?.source === 'compact') {
    lines.push('compaction resume: restore decisions, constraints, completed and open work, exact identifiers, and named durable artifacts before continuing; never restore redacted values');
  } else if ((payload?.source === 'startup' || payload?.source === 'clear')
    && !/^(off|0|false)$/i.test(process.env.CODE_OPS_HANDOFF_PICKUP ?? '')) {
    const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const pending = pendingHandoff(cwd);
    if (pending) {
      const ledger = pending.program ? ` Program ledger: ${pending.program}; read it first.` : '';
      lines.push(`pending handoff: ${pending.path} (written ${pending.written}).${ledger} Before other work, run the code-ops-suite:handoff skill in resume mode on it, verify its claims, and open your reply with a recap under five headings: work completed, key findings, in progress, left to do, project scope and constraints. If the operator's first request is unrelated, name the pending handoff in one line and proceed with their request.`);
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
