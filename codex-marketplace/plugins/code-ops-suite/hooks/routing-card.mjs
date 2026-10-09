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
// summary cannot send the session back to a handoff it already resumed. When the record names a run
// folder, the card also lists that folder's unchecked TASKS.md lines (at most 12, 80 characters
// each), so host auto-compaction, the default context relief on Claude and Codex, loses no open item.
// It also lists the agents the agent ledger (`../scripts/agent-ledger.mjs`) shows this session
// launched and never saw report, as a `Pending agents:` block (at most 8 lines of 80 characters,
// with a shown-of-total count), so a compaction does not forget a running background agent. The
// block is omitted when `CODE_OPS_AGENT_LEDGER` is `off`, `0`, or `false`, and any error prints nothing.
// With no home record, the card finds the run folder whose SESSION.json names this session in
// `sessionId` or `hostSessionId` (bounded hub scan, newest 200 folders) and lists its open items.
// A `startup` card also lists, under the same caps and switch, the agents earlier sessions in this
// directory launched and never saw report, headed `Left pending when an earlier session here ended:`.
//
// COMPACT SNAPSHOT. The `compact` card no longer tells the lead to reload TASKS.md and RUN_LOG.md.
// It prints one live git line (branch, short HEAD, dirty paths; nothing outside a repository), the
// latest `Next:` line from the tail of the run folder's RUN_LOG.md (at most NEXT_CHARS), and the
// state of COMPACT_SNAPSHOT.md (`../scripts/compact-snapshot.mjs`, written by hooks/compact-snapshot.mjs
// at PreCompact), looked up in the run folder and then the home state directory. `Snapshot fresh`
// means the transcript holds exactly one more `compact_boundary` than the snapshot header, or the same
// count when the snapshot was written at or after the latest boundary (the host flushes the boundary
// row after this hook can run; snapshotState() states the rule). The card then gives its path and
// counts and says it outranks the summary on running work and peers, and omits the open-item lines.
// A `snapshot also holds:` line counts the decisions, authority grants, and in-flight lines it carries
// and names its run folder, and `Snapshot partial: missing <inputs>` names what a partial one lacks.
// With no run folder resolved (the card's own lookup, or the snapshot's `Missing: run folder`), one line
// tells the lead the snapshot's grants and decisions are unrecorded, not none, and to tag the run's
// RUN_LOG.md; it prints on the `compact` source only.
// `Snapshot STALE` or no snapshot keeps the open-item lines as before. The line
// `active N/12 (last snapshot M)` counts the live unchecked TASKS.md lines against the header's
// count, with ` GROWING` when N exceeds M and ` OVER CAP` when N exceeds 12. Pending agents stay live
// from the ledger. Up to PEER_LINES lines list the snapshot's reply-owed peers, because an unanswered
// peer is the costliest miss. Every step fails open to its own omission.
//
// RECALL POINTER. After the snapshot lines, the `compact` card adds one `exact earlier detail:` line
// naming the MCP tool `transcript_recall` and `co recall search --session <full session id> --terms
// <words>`, so the session can recover what the summary lost. It prints only when `CODE_OPS_RECALL` is
// not `off`, `0`, or `false`, the payload carries a session id, and its `transcript_path` names an
// existing file. It never checks for the index, because the detached PreCompact prebuild may not have
// landed and the first recall call builds it. Any error omits the line.
//
// ROUTING LINE. When this session's ledger rows hold at least one judgment dispatch, the card ends with
// the one `Routing:` line `routingSummary` (`../scripts/agent-ledger.mjs`) prints, for example
// `Routing: 7 judgment, 2 triggered, 0 premium -> STARVED`, so under-routing and premium overuse show
// during the session. It is one line under the card's own caps and prints on every source that carries a
// session id; no routed dispatch, `CODE_OPS_AGENT_LEDGER` off, or any error prints nothing.
//
//   node hooks/routing-card.mjs

import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, readSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A handoff older than this is history rather than pending state: the tree has moved too far for
// its claims to be worth a resumed session's verification pass.
const PENDING_DAYS = 14;
const PENDING_LIST = 3;

// The hub run folders, scanned as scripts/handoff-state.mjs scans them (runsRoots there, not exported):
// `80 Runs/` in the working directory and in each `*-docs` hub beside it. Two bounded directory
// levels; an unreadable cwd is no folders.
function runsDirs(cwd) {
  let entries;
  try { entries = readdirSync(cwd, { withFileTypes: true }); } catch { return []; }
  const hubs = [cwd, ...entries.filter((e) => e.isDirectory() && e.name.endsWith('-docs')).map((e) => join(cwd, e.name))];
  return hubs.map((hub) => join(hub, '80 Runs'));
}

// Pending HANDOFF.md files under a documentation hub's `80 Runs/`, newest first, at most
// PENDING_LIST. Pending means no sibling `HANDOFF.consumed` (check-handoff.mjs --consume writes that
// once a resume verifies the file; existence alone counts, whatever its body) and an mtime inside
// PENDING_DAYS. The hub layout rule (vault-standard.md) puts one `<repo>-docs/` hub at the
// repository root with dated run folders under its `80 Runs/`, so this reads two bounded directory
// levels, never a recursive walk: the root's own entries, then `80 Runs/` in the root and in each
// `-docs` hub beside it. Every read is guarded, because a SessionStart hook stays inside a few
// milliseconds and fails open.
function pendingHandoffs(cwd) {
  const cutoff = Date.now() - PENDING_DAYS * 86_400_000;
  const found = [];
  for (const runs of runsDirs(cwd)) {
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

// This mirrors stateRoot() in scripts/transcript-lib.mjs, the canonical copy: the nearest ancestor of
// `cwd` (itself included) holding a `.git` entry, which keys the session record store, or `cwd` itself
// when none does or any check throws. It stats only.
function stateRoot(cwd) {
  try {
    let dir = resolve(String(cwd));
    for (;;) {
      if (existsSync(join(dir, '.git'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) return cwd;
      dir = parent;
    }
  } catch { return cwd; }
}

// This session's record (the shared data contract in the handoff v2 spec), or null when it is
// absent, unreadable, or malformed. The store is keyed on the repository root, as sessionRecordPath()
// keys it; a record an older build wrote under the raw working directory is read as a fallback.
const PATH_CHARS = 200;
function sessionRecord(cwd, sessionId) {
  let record = null;
  for (const key of new Set([slug(stateRoot(cwd)), slug(cwd)])) {
    try {
      record = JSON.parse(readFileSync(join(homedir(), '.codex', 'code-ops', 'sessions', key, `${slug(sessionId)}.json`), 'utf8'));
      break;
    } catch { /* try the next key */ }
  }
  if (!record) return null;
  const name = cardValue(record?.name, NAME_CHARS);
  const runDir = cardValue(record?.runDir, PATH_CHARS);
  if (!name || !runDir) return null;
  return { name, runDir, resumed: cardValue(record?.resumed, PATH_CHARS) };
}

// The run folder whose SESSION.json names this session in `sessionId` or `hostSessionId`, as a
// repo-relative forward-slash path, or null. This is the fallback for a compaction with no home
// session record. It reuses runsDirs() and reads at most RUN_SCAN folders, newest name first, so a
// long run history cannot slow the card. deferred(RUN_SCAN folders, index the session ids once if a
// hub outgrows it)
const RUN_SCAN = 200;
function sessionRunFolder(cwd, sessionId) {
  const folders = [];
  for (const runs of runsDirs(cwd)) {
    try {
      for (const f of readdirSync(runs, { withFileTypes: true })) if (f.isDirectory()) folders.push({ dir: join(runs, f.name), name: f.name });
    } catch { /* no runs here */ }
  }
  folders.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  for (const { dir } of folders.slice(0, RUN_SCAN)) {
    let session;
    try { session = JSON.parse(readFileSync(join(dir, 'SESSION.json'), 'utf8')); } catch { continue; }
    if (session?.sessionId === sessionId || session?.hostSessionId === sessionId) {
      return cardValue(relative(cwd, dir).split(sep).join('/'), PATH_CHARS);
    }
  }
  return null;
}

// The unchecked lines of the run folder's TASKS.md, so the session sees its open items right after
// compaction without a file read. The card stays bounded: at most OPEN_ITEMS lines of OPEN_CHARS
// characters each, from the first TASKS_BYTES of the file. Any read failure is no lines.
const OPEN_ITEMS = 12;
const OPEN_CHARS = 80;
const TASKS_BYTES = 65_536;
// The run folder's unchecked TASKS.md items, cut to OPEN_CHARS, or null when the file cannot be read.
function openItems(cwd, runDir) {
  let text;
  try { text = readFileSync(resolve(cwd, runDir, 'TASKS.md'), 'utf8').slice(0, TASKS_BYTES); } catch { return null; }
  const open = [];
  for (const line of text.split(/\r?\n/)) {
    const item = /^[ \t]*[-*][ \t]+\[ \][ \t]+(.*)$/.exec(line)?.[1];
    if (item) open.push(item.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, OPEN_CHARS));
  }
  return open;
}
function openItemLines(runDir, open) {
  if (!open?.length) return [];
  const shown = open.slice(0, OPEN_ITEMS);
  return [`open items in ${runDir}/TASKS.md (${shown.length} of ${open.length} shown):`, ...shown];
}

// The live state a compaction summary cannot hold. One git process gives the branch, the short HEAD,
// and the dirty-path count; outside a repository, or on any failure, the line is omitted.
const GIT_MS = 3000;
function gitLine(cwd) {
  try {
    const run = spawnSync('git', ['status', '--porcelain=v2', '--branch'], { cwd, encoding: 'utf8', timeout: GIT_MS, windowsHide: true });
    if (run.error || run.status !== 0) return [];
    const rows = run.stdout.split('\n').filter(Boolean);
    const oid = /^# branch\.oid (\S+)/m.exec(run.stdout)?.[1] ?? '';
    const branch = /^# branch\.head (\S+)/m.exec(run.stdout)?.[1] ?? '';
    if (!oid || !branch) return [];
    const dirty = rows.filter((r) => !r.startsWith('#')).length;
    return [`git: ${cardValue(branch, 60) ?? '?'} @ ${/^[0-9a-f]+$/.test(oid) ? oid.slice(0, 7) : oid}, ${dirty ? `${dirty} dirty path(s)` : 'clean'}`];
  } catch { return []; }
}

// The latest `Next:` line in the tail of the run folder's RUN_LOG.md: the lead writes one at each
// assessment and phase boundary, naming the step in flight, its next command, and the file:line it
// edits. Only the last LOG_TAIL bytes are read. The line is cut to NEXT_CHARS, longer than the
// other card lines because it carries a command and a location.
const LOG_TAIL = 16_384;
const NEXT_CHARS = 200;
function nextLine(cwd, runDir) {
  let fd;
  try {
    const file = resolve(cwd, runDir, 'RUN_LOG.md');
    fd = openSync(file, 'r');
    const size = statSync(file).size;
    const length = Math.min(size, LOG_TAIL);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    const found = buffer.toString('utf8').split(/\r?\n/).map((l) => /^[ \t]*(?:[-*][ \t]+)?(?:\*\*)?Next:(?:\*\*)?[ \t]*(\S.*)$/.exec(l)?.[1]).filter(Boolean);
    const last = found.at(-1)?.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return last ? [`Next: ${last.slice(0, NEXT_CHARS)}`] : [];
  } catch { return []; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ } }
}

// COMPACT_SNAPSHOT.md for this session: the run folder's copy first, then the home state
// directory's. `state` is `fresh` or `stale` by the library's boundary-count rule (a payload with no
// readable transcript is stale), `absent` when no file holds a snapshot header for this session, and
// `unavailable` when the library does not load, which prints no Snapshot line at all.
const PEER_LINES = 4;
const PEER_CHARS = 160;
const clean = (value) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
async function readSnapshot(cwd, runDir, sessionId, transcriptPath) {
  try {
    const scripts = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');
    const lib = await import(pathToFileURL(join(scripts, 'compact-snapshot.mjs')).href);
    const { boundaryInfo } = await import(pathToFileURL(join(scripts, 'transcript-lib.mjs')).href);
    const candidates = [runDir ? join(resolve(cwd, runDir), lib.SNAPSHOT_FILE) : null, ...(sessionId ? lib.homeSnapshotPaths(cwd, sessionId) : [])].filter(Boolean);
    for (const path of candidates) {
      let text;
      try { text = readFileSync(path, 'utf8'); } catch { continue; }
      const header = lib.readSnapshotHeader(text);
      if (!header || (header.sessionId !== sessionId && header.sessionId !== 'unknown')) continue;
      let info = { count: NaN, lastAt: null };
      try { info = boundaryInfo(readFileSync(transcriptPath, 'utf8')); } catch { /* no transcript: stale */ }
      return { state: lib.snapshotState(header, info.count, info.lastAt), path, text, header };
    }
    return { state: 'absent' };
  } catch { return { state: 'unavailable' }; }
}

// The card lines for a snapshot: its state, the live active count against the header's, and the
// reply-owed peers. `open` is the live list of unchecked items, or null when TASKS.md is unreadable.
function snapshotLines(snap, cwd, open, sessionId) {
  const lines = [];
  const shown = snap.path ? (() => { const rel = relative(cwd, snap.path); return (rel.startsWith('..') || isAbsolute(rel) ? snap.path : rel).split(sep).join('/'); })() : '';
  const counts = snap.header?.counts;
  if (snap.state === 'fresh') {
    lines.push(`Snapshot fresh (${counts ? `${counts.words} operator words, ${counts.running} running, ${counts.items} items, ${counts.peers} reply-owed peers` : 'counts unreadable'}): ${shown}`);
    lines.push('the snapshot outranks the summary on running work and peers; read it first');
  } else if (snap.state === 'stale') {
    lines.push(`Snapshot STALE: ${shown} predates an earlier compaction; verify its running work and peers`);
  } else if (snap.state === 'absent' && sessionId) {
    lines.push(`Snapshot absent: rebuild it with co snapshot --session ${sessionId}`);
  }
  // What the snapshot also holds, and what it lacks: a partial snapshot names each missing input so the
  // session knows which part of the state to rebuild from the run folder.
  if (snap.state === 'fresh' || snap.state === 'stale') {
    const runGap = snap.header?.missing?.some((m) => m.startsWith('run folder'));
    if (counts && Number.isInteger(counts.decisions)) lines.push(`snapshot also holds: ${runGap ? 'decisions not recorded, grants not recorded, in-flight lines not recorded' : `${counts.decisions} decisions, ${counts.grants} authority grants, ${counts.flight} in-flight lines, the next command`}${snap.header.run && snap.header.run !== 'unknown' ? `, run folder ${clean(snap.header.run).slice(0, PATH_CHARS)}` : ''}`);
    if (snap.header?.status === 'partial') lines.push(`Snapshot partial: missing ${clean(snap.header.missing.join(', ') || 'unnamed input').slice(0, PEER_CHARS)}; rebuild that input from the run folder or run co snapshot --session ${sessionId || '<id>'}`);
  }
  if (open) {
    const last = counts ? ` (last snapshot ${counts.items})` : '';
    lines.push(`active ${open.length}/12${last}${counts && open.length > counts.items ? ' GROWING' : ''}${open.length > 12 ? ' OVER CAP' : ''}`);
  }
  if (snap.text) {
    const peers = snap.text.split(/^## Peers/m)[1] ?? '';
    const owed = [...peers.matchAll(/^- REPLY OWED (.*)$/gm)].map((m) => clean(`reply owed: ${m[1]}`).slice(0, PEER_CHARS));
    lines.push(...(owed.length > PEER_LINES ? [...owed.slice(0, PEER_LINES - 1), `${owed.length - PEER_LINES + 1} more reply-owed peers in the snapshot`] : owed));
  }
  return lines;
}

// The agents this session launched that never reported, from the agent ledger, so a background
// agent is not forgotten across compaction. The ledger module loads only here, on the compact
// path. The block stays bounded: a header with the shown-of-total count, then at most
// PENDING_SHOWN lines cut to PENDING_CHARS. The off switch, no query, or any failure is no lines.
// `query` is the pendingAgents() input: `{ sessionId }` for this session after compaction,
// `{ cwd, endedOnly: true }` for the sessions in this directory that have ended at startup, so a
// live peer session's workers stay off the card; `skip` drops this session's own rows.
const PENDING_SHOWN = 8;
const PENDING_CHARS = 80;
async function pendingAgentLines(query, head, skip = '') {
  if (!query || /^(off|0|false)$/i.test(process.env.CODE_OPS_AGENT_LEDGER ?? '')) return [];
  try {
    const lib = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'agent-ledger.mjs');
    const { pendingAgents, formatLine } = await import(pathToFileURL(lib).href);
    const list = pendingAgents(query).filter((a) => !skip || a.session_id !== skip);
    if (!list.length) return [];
    const shown = list.slice(0, PENDING_SHOWN);
    return [`${head} (${shown.length} of ${list.length} shown)`,
      ...shown.map((a) => formatLine(a).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, PENDING_CHARS))];
  } catch { return []; }
}

// The `Routing:` line over this session's own ledger rows, or no line when the session has no judgment
// dispatch, the ledger is off, or the module fails to load.
async function routingLine(sessionId) {
  if (!sessionId || /^(off|0|false)$/i.test(process.env.CODE_OPS_AGENT_LEDGER ?? '')) return [];
  try {
    const lib = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'agent-ledger.mjs');
    const { ledgerRows, routingSummary } = await import(pathToFileURL(lib).href);
    const summary = routingSummary(ledgerRows({ sessionId }));
    return summary.judgment ? [summary.line] : [];
  } catch { return []; }
}

// One line per live peer on this repository, at most PEER_LINES, from `discoverPeers` in
// collision-lib.mjs: a live board session whose program differs from this session's, resolved to
// the head of its handoff chain. A session whose program cannot be read has no program to differ
// from, so every other live session with a program counts. `peers` is the snapshot's `## Peers`
// text when it is fresh, else null, which omits the reply-owed marker.
// CODE_OPS_PEER_GUARD=off, an unreadable board, or any failure is no lines.
async function peerLines(cwd, sessionId, peers) {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_PEER_GUARD ?? '')) return [];
  try {
    const lib = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'collision-lib.mjs')).href);
    const owed = (peers ?? '').split(/\r?\n/).filter((l) => l.startsWith('- REPLY OWED ')).map((l) => l.slice(13).toLowerCase());
    return lib.discoverPeers(cwd, sessionId ?? '').slice(0, PEER_LINES).map((peer) => {
      const program = clean(peer.program).slice(0, NAME_CHARS);
      const name = clean(String(peer.name || String(peer.sessionId ?? '').slice(0, 8))).slice(0, NAME_CHARS);
      const ids = peer.ids.map((v) => v.toLowerCase());
      const isOwed = owed.some((l) => l.startsWith(`${name.toLowerCase()} `) || ids.some((id) => l.split(/\s+/).includes(id)));
      return `peer: ${program} \u00b7 live session ${name}${isOwed ? ' \u00b7 reply owed' : ''}`.slice(0, PEER_CHARS);
    });
  } catch { return []; }
}

// Only Codex names the operator's shell to the model, so every other host gets the shell
// line. CODE_OPS_OPERATOR_SHELL overrides the platform default. On Windows the lead's own bash
// calls also get the quoting-trap line.
const SHELL_CHARS = 40;
const DEFAULT_SHELL = { win32: 'PowerShell', darwin: 'zsh' };
function shellLines() {
  const lines = [];
  if (process.env.CLAUDECODE !== '1') {
    const shell = cardValue(process.env.CODE_OPS_OPERATOR_SHELL, SHELL_CHARS) ?? DEFAULT_SHELL[process.platform] ?? 'bash';
    lines.push(`operator shell: ${shell} (${process.platform})`);
  }
  if (process.platform === 'win32') {
    lines.push('win32 shell trap: write a multi-line script to a file; never nest quotes in node -e inside bash');
  }
  return lines;
}

// One line telling a compacted session it can recover exact earlier detail from its own transcript.
// It needs recall on, a session id, and a payload transcript that exists. It never reads the index:
// the PreCompact prebuild is detached and may not have landed, and the first recall call builds it.
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
function recallLine(sessionId, transcriptPath) {
  try {
    if (/^(off|0|false)$/i.test(process.env.CODE_OPS_RECALL ?? '') || !SESSION_ID_RE.test(sessionId)) return [];
    if (typeof transcriptPath !== 'string' || !transcriptPath || !statSync(transcriptPath).isFile()) return [];
    return [`exact earlier detail: the summary is lossy, so call the MCP tool transcript_recall or run co recall search --session ${sessionId} --terms <words> before relying on memory`];
  } catch { return []; }
}

async function main() {
  if (process.env.GROK_PLUGIN_ROOT) return 0;
  let raw = '';
  try { raw = readFileSync(0, 'utf8').replace(/^\uFEFF/, ''); } catch { /* no stdin */ }
  let payload = {};
  try { payload = JSON.parse(raw || '{}'); } catch { /* ordinary start */ }
  const lines = [
    'code-ops standard operating mode',
    'debug a bug -> code-ops-suite:debug',
    'ship a feature/change -> code-ops-suite:ship',
    'audit/quality sweep -> code-ops-suite:everything plugins: suite or plugins: rigor',
    'privacy/leak concern -> code-ops-suite:everything plugins: privacy',
    'library/dependency decision -> researcher:library-eval',
    'claim verification -> researcher:research-verify',
    'everything (broad/multi-domain) -> code-ops-suite:everything',
    'substantive work -> session lead, task-based tiers, disjoint units in parallel when the graph allows; strong is the judgment floor',
    'a dispatch costs context times turns: code-ops-suite:implementer for build work, a round budget, breadth agents at their declared tier',
    'one frontier peer only for a bounded architecture, refutation, mathematics, or synthesis decision; the lead keeps the verdict',
    'say what you are about to do, then close with a recap that stands on its own',
    'only you see a command\'s output; put what the user needs to read in your reply',
    'context economy: read the named convention sections only, skim before a whole file, and query the symbol index before a map',
    'compaction keeps what a handoff keeps: tag RUN_LOG.md lines Decision:, Grant:, In flight:, Next: (co snapshot --fields)',
    'brief template -> co brief <agent>',
  ];
  // build-opencode-dist.mjs runs this hook with empty stdin and bakes the card into the dist, so
  // the platform lines print only for a live host payload and the dist stays machine-independent.
  if (raw.trim()) lines.push(...shellLines());
  const sessionId = typeof payload?.session_id === 'string' ? payload.session_id : '';
  const shortId = sessionId.slice(0, 8);
  if (/^[A-Za-z0-9_-]+$/.test(shortId)) lines.push(`this session: ${shortId}`);
  const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
  if (payload?.source === 'compact') {
    lines.push('compaction resume: restore decisions, constraints, completed and open work, exact identifiers, and named durable artifacts before continuing; never restore redacted values');
    const record = sessionId ? sessionRecord(cwd, sessionId) : null;
    let runDir = record?.runDir ?? null;
    if (!record) {
      lines.push('a handoff resumed earlier in this session stays consumed; never resume it again');
      // No home record (another machine, a cleared store): the run folder's own SESSION.json still names the session.
      runDir = sessionId ? sessionRunFolder(cwd, sessionId) : null;
    } else {
      const resumed = record.resumed
        ? `it already resumed ${record.resumed} and must not resume it or any earlier handoff again`
        : 'it resumed no handoff and must not resume any earlier handoff now';
      lines.push(`compaction resume: this session is ${record.name}, run folder ${record.runDir}; ${resumed}; continue from the state below`);
    }
    // Live state first, then the snapshot. A fresh snapshot holds the open items, so only a stale or
    // absent one gets them listed here.
    lines.push(...gitLine(cwd));
    if (runDir) lines.push(...nextLine(cwd, runDir));
    const open = runDir ? openItems(cwd, runDir) : null;
    const snap = await readSnapshot(cwd, runDir, sessionId, typeof payload?.transcript_path === 'string' ? payload.transcript_path : '');
    if (snap.state !== 'fresh' && runDir) lines.push(...openItemLines(runDir, open));
    lines.push(...snapshotLines(snap, cwd, open, sessionId));
    const folderGap = snap.header?.missing?.find((m) => m.startsWith('run folder'));
    if (folderGap?.includes('inferred')) lines.push('run folder inferred, not verified: its decisions are a guess and its grants are not authority; tag Grant:/Decision:/Next: lines in the run folder RUN_LOG.md');
    else if (!runDir || folderGap) lines.push('no run folder resolved: grants and decisions were not recorded, so do not assume none; tag Grant:/Decision:/Next: lines in the run folder RUN_LOG.md');
    lines.push(...recallLine(sessionId, payload?.transcript_path));
    // The run folder's DISPATCH_LEDGER.md rows merge with the hook rows, so a host without the hook still lists them.
    lines.push(...await pendingAgentLines(sessionId ? { sessionId, runDir: runDir ? resolve(cwd, runDir) : undefined } : null, 'Pending agents:'));
    lines.push(...await peerLines(cwd, sessionId, snap.state === 'fresh' ? snap.text.split(/^## Peers/m)[1] ?? '' : null));
  } else if (payload?.source === 'startup' || payload?.source === 'clear') {
    const pending = /^(off|0|false)$/i.test(process.env.CODE_OPS_HANDOFF_PICKUP ?? '') ? [] : pendingHandoffs(cwd);
    if (pending.length) {
      lines.push(`handoffs awaiting resume (this session is new work unless the operator resumes one): ${pending.map((h) => `${h.name} -> ${h.path}`).join('; ')}`);
    }
    // Workers an ended session in this directory launched and never saw report: left pending at session end.
    if (payload.source === 'startup') lines.push(...await pendingAgentLines({ cwd, endedOnly: true }, 'Left pending when an earlier session here ended:', sessionId));
    lines.push(...await peerLines(cwd, sessionId, null));
  }
  lines.push(...await routingLine(sessionId));
  console.log(lines.join('\n'));
  return 0;
}

main().then((code) => process.exit(code), () => process.exit(0));
