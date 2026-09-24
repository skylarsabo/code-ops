#!/usr/bin/env node
// SessionStart hook: prints a hard-capped routing card so the lead defaults into
// standard operating mode from the first turn. After compaction it adds a short restore
// instruction; unlike PreCompact stdout, SessionStart context is consumed by Claude/Codex.
//
// Grok passive-hook stdout is ignored, so its instruction files carry this doctrine and this
// hook emits nothing there. Fail-open: any error exits 0 silently.
//
// PENDING HANDOFF LIST. A fresh session (`source` of `startup` or `clear`, never `resume` or
// `compact`) also gets one passive line listing up to PENDING_LIST unconsumed `HANDOFF.md` files the
// handoff skill left in dated run folders, newest first. A new session is new work: the line never
// tells the session to resume, because that imperative survived into compaction summaries and sent
// sessions back to a handoff they had already consumed. ON BY DEFAULT, OFF PER REPOSITORY OR USER:
// the line is omitted when `CODE_OPS_HANDOFF_PICKUP` is `off`, `0`, or `false` (case-insensitive),
// the same switch shape `CODE_OPS_HANDOFF_CARD` uses in hooks/handoff-card.mjs.
//
// SESSION IDENTITY. When the payload carries `session_id`, the card names its first 8 characters so
// the lead can identify itself to peers. After compaction the card reads this session's record,
// `<home>/.claude/code-ops/sessions/<slug(cwd)>/<slug(session id)>.json`, which `co.mjs run open` and
// `handoff resume` write, and restates the session name, run folder, and consumed handoff, so the
// summary cannot send the session back to a handoff it already resumed.
//
//   node hooks/routing-card.mjs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { homedir } from 'node:os';

// A handoff older than this is history rather than pending state: the tree has moved too far for
// its claims to be worth a resumed session's verification pass.
const PENDING_DAYS = 14;
const PENDING_LIST = 3;

// Pending HANDOFF.md files under a documentation hub's `80 Runs/`, newest first, at most
// PENDING_LIST. Pending means no sibling `HANDOFF.consumed` (check-handoff.mjs --consume writes that
// once a resume verifies the file; existence alone counts, whatever its body) and an mtime inside
// PENDING_DAYS. The hub layout rule (vault-standard.md) puts one `<repo>-docs/` hub at the
// repository root with dated run folders under its `80 Runs/`, so this reads two bounded directory
// levels, never a recursive walk: the root's own entries, then `80 Runs/` in the root and in each
// `-docs` hub beside it. Every read is guarded, because a SessionStart hook stays inside a few
// milliseconds and fails open.
function pendingHandoffs(cwd) {
  const roots = [cwd];
  let entries;
  try { entries = readdirSync(cwd, { withFileTypes: true }); } catch { return []; }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith('-docs')) roots.push(join(cwd, entry.name));
  }
  const cutoff = Date.now() - PENDING_DAYS * 86_400_000;
  const found = [];
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
      if (mtime >= cutoff) found.push({ file, folder: folder.name, mtime });
    }
  }
  // Repo-relative with forward slashes, so the path reads the same on Windows and POSIX. Folder
  // names carry spaces ("80 Runs", "2026-09-18 token-spend-audit") and are never quoted here.
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, PENDING_LIST)
    .map((h) => ({ path: relative(cwd, h.file).split(sep).join('/'), name: sessionName(h.file) ?? h.folder }));
}

// A short free-text value bound for the card: trimmed, one backtick pair stripped, and null when
// empty, longer than max, a `[FILL:` placeholder, or holding a control character. This keeps the
// card's size bounded and keeps a hostile file from injecting extra card lines.
const cardValue = (raw, max) => {
  const value = typeof raw === 'string' ? raw.trim().replace(/^`(.*)`$/, '$1').trim() : '';
  if (!value || value.length > max || value.includes('[FILL:') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
};

// The `Session:` name under the handoff's `## Program` heading, or null (a legacy handoff has none).
// The handoff is capped at 8 KB, so only its first SCAN_BYTES are read.
const SCAN_BYTES = 8192;
const NAME_CHARS = 120;
function sessionName(file) {
  let text;
  try { text = readFileSync(file, 'utf8').slice(0, SCAN_BYTES); } catch { return null; }
  const section = /^##[ \t]+Program[ \t]*\r?$([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m.exec(text)?.[1] ?? '';
  return cardValue(/^[-*\t ]*Session:[^\S\r\n]*(.*)$/m.exec(section)?.[1], NAME_CHARS);
}

// This mirrors projectSlug() in scripts/transcript-lib.mjs, the canonical copy; importing that
// module would load far more than this hook needs on every session start.
const slug = (value) => String(value).replace(/[^A-Za-z0-9]/g, '-');

// This session's record (the shared data contract in the handoff v2 spec), or null when it is
// absent, unreadable, or malformed.
const PATH_CHARS = 200;
function sessionRecord(cwd, sessionId) {
  let record;
  try {
    record = JSON.parse(readFileSync(join(homedir(), '.claude', 'code-ops', 'sessions', slug(cwd), `${slug(sessionId)}.json`), 'utf8'));
  } catch { return null; }
  const name = cardValue(record?.name, NAME_CHARS);
  const runDir = cardValue(record?.runDir, PATH_CHARS);
  if (!name || !runDir) return null;
  return { name, runDir, resumed: cardValue(record?.resumed, PATH_CHARS) };
}

function main() {
  if (process.env.GROK_PLUGIN_ROOT) return 0;
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}'); } catch { /* ordinary start */ }
  const lines = [
    'code-ops standard operating mode',
    'debug a bug -> /code-ops-suite:debug',
    'ship a feature/change -> /code-ops-suite:ship',
    'audit/quality sweep -> /code-ops-suite:everything plugins: suite or plugins: rigor',
    'privacy/leak concern -> /code-ops-suite:everything plugins: privacy',
    'library/dependency decision -> /researcher:library-eval',
    'claim verification -> /researcher:research-verify',
    'everything (broad/multi-domain) -> /code-ops-suite:everything',
    'substantive work -> session lead, task-based tiers, disjoint units in parallel when the graph allows; strong is the judgment floor',
    'a dispatch costs context times turns: code-ops-suite:implementer for build work, a round budget, breadth agents at their declared tier',
    'one frontier peer only for a bounded architecture, refutation, mathematics, or synthesis decision; the lead keeps the verdict',
    'say what you are about to do, then close with a recap that stands on its own',
    'only you see a command\'s output; put what the user needs to read in your reply',
    'context economy: read the named convention sections only, skim before a whole file, and query the symbol index before a map',
  ];
  const sessionId = typeof payload?.session_id === 'string' ? payload.session_id : '';
  const shortId = sessionId.slice(0, 8);
  if (/^[A-Za-z0-9_-]+$/.test(shortId)) lines.push(`this session: ${shortId}`);
  const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  if (payload?.source === 'compact') {
    lines.push('compaction resume: restore decisions, constraints, completed and open work, exact identifiers, and named durable artifacts before continuing; never restore redacted values');
    const record = sessionId ? sessionRecord(cwd, sessionId) : null;
    if (!record) {
      lines.push('a handoff resumed earlier in this session stays consumed; never resume it again');
    } else {
      const resumed = record.resumed
        ? `it already resumed ${record.resumed} and must not resume it or any earlier handoff again`
        : 'it resumed no handoff and must not resume any earlier handoff now';
      lines.push(`compaction resume: this session is ${record.name}, run folder ${record.runDir}; ${resumed}; reload ${record.runDir}/TASKS.md and RUN_LOG.md, then continue`);
    }
  } else if ((payload?.source === 'startup' || payload?.source === 'clear')
    && !/^(off|0|false)$/i.test(process.env.CODE_OPS_HANDOFF_PICKUP ?? '')) {
    const pending = pendingHandoffs(cwd);
    if (pending.length) {
      lines.push(`handoffs awaiting resume (this session is new work unless the operator resumes one): ${pending.map((h) => `${h.name} -> ${h.path}`).join('; ')}`);
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
