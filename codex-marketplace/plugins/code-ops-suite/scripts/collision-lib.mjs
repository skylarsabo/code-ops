// Collision warnings (design C2, "Program state handoffs and coordination 2026-09"). The library
// behind dispatch-guard.mjs's lazy import: given one PreToolUse payload it returns a short
// advisory note, or null. It only warns. It never denies, never writes into a repository, and
// every failure returns null.
//
// TWO TRIGGERS.
//   1. An edit tool (Edit, Write, MultiEdit, NotebookEdit, and the other hosts' edit names, the
//      same set hooks/index-refresh.mjs records). When another LIVE board session claimed the path,
//      or edited it within the last 6 hours, the note names the peer (program session name,
//      branch, worktree) and gives a ready SendMessage line. A peer with no heartbeat for 30 minutes
//      is idle and one whose record is ended is finished; neither is a collision.
//   2. A shell command that runs `git pull`, `git merge`, `git rebase`, or `git push`. The note
//      lists the live peers on this session's branch and their recent edits that overlap this
//      session's uncommitted files (`git status --porcelain --untracked-files=all`, limited to the
//      peers' edited paths, three seconds at most; if git is unavailable, this session's own recent
//      board edits stand in). With no live peer on the branch, or none with a recent edit, it runs
//      no git at all.
//
// DEDUPE. An edit note fires once per (path, peer) per session. A subagent is a separate context,
// so it keeps its own seen-set, keyed by its `agent_id`. The seen-set is one small JSON file per
// session under `<home>/.claude/code-ops/collision/<repo key>/`, never in the repository, and it
// records only peer session ids and repo-relative paths. The caller commits it after the note is
// actually delivered, so a call the guard denies does not use up a warning.
//
// OFF SWITCH. `CODE_OPS_PEER_GUARD` (`off`, `0`, or `false`), the board's own switch, not a new
// variable. The note reads the presence board that switch owns and only makes sense while a
// session both publishes to that board and consumes it; a session that turned the board off gets
// neither its writes nor this read. The caller checks it before importing this file.
//
// BOUNDS. The board is read through readBoard (scripts/handoff-state.mjs), the seen-set is read
// only under MAX_SEEN_BYTES and holds at most MAX_SEEN keys, and the note names at most MAX_PEERS
// peers and MAX_PATHS paths per peer. Board values come from another local session, so every
// interpolated string is stripped of control characters and cut to a bound.
// deferred(readBoard parses every record in the repository's board directory and nothing sweeps
// ended records, so the cost grows with abandoned sessions; skip a record by file mtime, or sweep
// ended records at SessionEnd, if the measured p95 ever nears the 50 ms hook budget)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { boardPath, readBoard, repoIdentity } from './handoff-state.mjs';

export const RECENT_EDIT_MS = 6 * 60 * 60 * 1000;
const MAX_SEEN = 500;
const MAX_SEEN_BYTES = 64 * 1024;
const MAX_PEERS = 3;
const MAX_PATHS = 5;
const GIT_TIMEOUT_MS = 3000;
const MAX_PATHSPECS = 100;
const GIT_VERBS = new Set(['pull', 'merge', 'rebase', 'push']);
const EDIT_TOOLS = new Set(['edit', 'write', 'search_replace', 'multiedit', 'notebookedit', 'apply_patch', 'functions.apply_patch']);
const SHELL_TOOLS = new Set(['bash', 'shell', 'exec_command', 'functions.exec_command', 'run_terminal_command']);
// Global options that take their value as the next word.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

const storeHome = () => process.env.CODE_OPS_HOME || homedir();
const clean = (value, limit = 80) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const toolName = (payload) => String(payload?.tool_name ?? payload?.toolName ?? payload?.tool?.name ?? '').toLowerCase();
const inTools = (name, tools) => [...tools].some((tool) => name === tool || name.endsWith(`.${tool}`));
const toolInput = (payload) => payload?.tool_input ?? payload?.toolInput ?? payload?.input;

// The file paths an edit tool call names, as the tool wrote them.
function editedFiles(payload) {
  if (!inTools(toolName(payload), EDIT_TOOLS)) return [];
  const input = toolInput(payload);
  const direct = input?.file_path ?? input?.filePath ?? input?.notebook_path ?? input?.path;
  if (typeof direct === 'string' && direct.trim()) return [direct];
  const patch = input?.patch ?? input?.input;
  if (typeof patch !== 'string') return [];
  return [...patch.matchAll(/^\*\*\* (?:Add|Update) File: (.+)$/gm)].map((match) => match[1].trim());
}

// The git verb a shell command runs, or null. Only the first word of each `&&`, `||`, `;`, `|`, or
// newline segment counts, so `echo git push` and `git merge-base` never match; `git -C <dir>` and
// `-c k=v` global options are skipped.
// deferred(a quoted global option value with a space, as in `git -C "my dir" push`, splits into
// two words and reads as no match; tokenize quotes if a real command is missed)
export function gitVerb(command) {
  if (typeof command !== 'string') return null;
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/);
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    if (!/^(?:.*[\\/])?git(?:\.exe)?$/i.test(words.shift() ?? '')) continue;
    while (words.length && words[0].startsWith('-')) {
      const option = words.shift();
      if (GIT_VALUE_OPTIONS.has(option)) words.shift();
    }
    if (GIT_VERBS.has(words[0])) return words[0];
  }
  return null;
}

const minutes = (ms) => Math.max(0, Math.round(ms / 60000));
const peerName = (peer) => clean(peer.name) || clean(peer.sessionId, 8);
const peerTarget = (peer) => clean(peer.name) || clean(peer.hostSessionId ?? peer.sessionId, 64);
const where = (peer) => `branch ${clean(peer.branch) || 'unknown'}, worktree ${clean(peer.worktree) || '.'}`;
const pathList = (paths) => paths.slice(0, MAX_PATHS).map((p) => clean(p, 120)).join(', ')
  + (paths.length > MAX_PATHS ? ` and ${paths.length - MAX_PATHS} more` : '');
const sendLine = (peer, message) => `SendMessage ${JSON.stringify({ to: peerTarget(peer), message })}`;

// Live board peers other than this session, `sid` being its host session id.
function livePeers(cwd, sid, now) {
  return readBoard(cwd, storeHome(), now)
    .filter((r) => r.state === 'live' && r.sessionId !== sid && r.hostSessionId !== sid);
}

const recentEdits = (peer, now) => (Array.isArray(peer.edits) ? peer.edits : [])
  .filter((e) => e && typeof e.path === 'string' && now - Date.parse(e.at) <= RECENT_EDIT_MS)
  .map((e) => ({ path: e.path, ago: now - Date.parse(e.at) }));

function seenFile(ident, sid, agentId) {
  const key = createHash('sha256').update(`${sid}\0${agentId ?? ''}`).digest('hex');
  return join(storeHome(), '.codex', 'code-ops', 'collision', ident.key, `${key}.json`);
}

function readSeen(file) {
  try {
    if (statSync(file).size > MAX_SEEN_BYTES) return [];
    const body = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(body?.seen) ? body.seen.filter((k) => typeof k === 'string') : [];
  } catch { return []; }
}

function editNote(payload, ctx) {
  const files = editedFiles(payload);
  if (!files.length) return null;
  const { cwd, ident, sid, now } = ctx;
  const paths = [...new Set(files.map((f) => boardPath(ident, resolve(cwd, f))).filter(Boolean))];
  if (!paths.length) return null;
  const peers = livePeers(cwd, sid, now);
  if (!peers.length) return null;
  const file = seenFile(ident, sid, payload.agent_id);
  const seen = new Set(readSeen(file));
  const fresh = [];
  const lines = [];
  for (const peer of peers) {
    const claims = Array.isArray(peer.claims) ? peer.claims : [];
    const edits = recentEdits(peer, now);
    const hits = [];
    for (const path of paths) {
      const key = `${peer.sessionId}\t${path}`;
      if (seen.has(key)) continue;
      const edit = edits.find((e) => e.path === path);
      if (!claims.includes(path) && !edit) continue;
      hits.push({ path, why: claims.includes(path) ? 'claimed' : `edited ${minutes(edit.ago)} min ago` });
      fresh.push(key);
    }
    if (!hits.length || lines.length >= MAX_PEERS) continue;
    lines.push(`${hits.map((h) => `${clean(h.path, 120)} (${h.why})`).join(', ')} by live session "${peerName(peer)}" (${where(peer)}). `
      + sendLine(peer, `I am about to edit ${pathList(hits.map((h) => h.path))}, which you claimed or edited recently. Tell me if that collides.`));
  }
  if (!lines.length) return null;
  const commit = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ v: 1, seen: [...seen, ...fresh].slice(-MAX_SEEN) })}\n`);
  };
  return { text: `Collision note (warn only, nothing is blocked): ${lines.join(' | ')}`, commit };
}

// This session's uncommitted paths, relative to the worktree top, or null when git is unavailable.
// `only` limits the status to those paths (literal, never a glob), which is all an overlap check
// needs and which spares git a walk of the rest of the tree; more than MAX_PATHSPECS paths read the
// whole status. `--no-optional-locks` keeps a status from refreshing the index under a peer's git.
function dirtyPaths(top, only, spawn) {
  try {
    const limit = only.length > 0 && only.length <= MAX_PATHSPECS;
    const args = ['--no-optional-locks', ...(limit ? ['--literal-pathspecs'] : []), 'status', '--porcelain', '--untracked-files=all', ...(limit ? ['--', ...only] : [])];
    const run = spawn('git', args, { cwd: top, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true });
    if (run.status !== 0 || typeof run.stdout !== 'string') return null;
    return run.stdout.split('\n').filter((l) => l.length > 3)
      .map((l) => l.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));
  } catch { return null; }
}

// The checked-out branch, or the short commit of a detached HEAD, read from HEAD without git.
function currentBranch(ident) {
  try {
    const head = readFileSync(join(ident.gitDir, 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 12) || null;
  } catch { return null; }
}

function gitNote(verb, ctx) {
  const { cwd, ident, sid, now, spawn } = ctx;
  const board = readBoard(cwd, storeHome(), now);
  const own = board.find((r) => r.sessionId === sid || r.hostSessionId === sid);
  const branch = ident.gitDir ? currentBranch(ident) : null;
  const peers = board.filter((r) => r.state === 'live' && r !== own && r.sessionId !== sid && r.hostSessionId !== sid
    && branch !== null && r.branch === branch);
  if (!peers.length) return null;
  // Only the named peers' recent edits can overlap, so git runs only when one has any.
  const wanted = [...new Set(peers.slice(0, MAX_PEERS).flatMap((peer) => recentEdits(peer, now).map((e) => e.path)))];
  const dirty = new Set(wanted.length ? dirtyPaths(ident.top, wanted, spawn) ?? recentEdits(own ?? {}, now).map((e) => e.path) : []);
  const lines = peers.slice(0, MAX_PEERS).map((peer) => {
    const overlap = [...new Set(recentEdits(peer, now).map((e) => e.path).filter((p) => dirty.has(p)))];
    const beat = Number.isNaN(Date.parse(peer.heartbeat)) ? 'unknown' : `${minutes(now - Date.parse(peer.heartbeat))} min ago`;
    return `"${peerName(peer)}" (${where(peer)}, heartbeat ${beat}): `
      + (overlap.length ? `its recent edits overlap your uncommitted files: ${pathList(overlap)}. `
        : 'none of its recent edits overlap your uncommitted files. ')
      + sendLine(peer, `I am about to run git ${verb} on ${clean(branch)}. Tell me if that collides with your work.`);
  });
  return { text: `Collision note (warn only, nothing is blocked): git ${verb} with ${peers.length} other live session${peers.length === 1 ? '' : 's'} on branch ${clean(branch)}. ${lines.join(' | ')}`, commit: () => {} };
}

// The advisory for one PreToolUse payload: `{ text, commit }`, or null when there is nothing to
// say or anything fails. `commit()` records the note as delivered; call it only after the text is
// actually emitted. `now` and `spawn` (the process launcher) are injectable for tests.
export function collisionNote(payload, now = Date.now(), spawn = spawnSync) {
  try {
    const name = toolName(payload);
    const edit = inTools(name, EDIT_TOOLS);
    if (!edit && !inTools(name, SHELL_TOOLS)) return null;
    const input = toolInput(payload);
    const verb = edit ? null : gitVerb(typeof input?.command === 'string' ? input.command : input?.cmd);
    if (!edit && !verb) return null;
    const sid = payload.session_id ?? payload.sessionId;
    if (typeof sid !== 'string' || !sid) return null;
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const ctx = { cwd, ident: repoIdentity(cwd), sid, now, spawn };
    return edit ? editNote(payload, ctx) : gitNote(verb, ctx);
  } catch { return null; }
}
