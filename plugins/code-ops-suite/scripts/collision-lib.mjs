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
// A THIRD KIND, PEER SURFACES (design "Agent state machine and host parity 2026-09", PR 9). A
// program's PROGRAM.md may carry a `## Peers` section that declares surfaces shared with another
// program: `- <slug | *> · Surfaces: <path or glob>, process:<name> · Notify: edit|merge`. Peers
// are discovered, never configured: a peer is any live board session on this repository whose
// program (from its run folder) differs from this session's, named by the live head of its handoff
// chain. A surface note fires for an edit to a declared path (Notify edit), a `git merge` or
// `git push` whose diff touches one (Notify edit or merge), and a kill command (`taskkill`,
// `pkill`, `kill`, `Stop-Process`) that names a declared `process:` surface. It needs no recent
// peer edit, names the peer's live session, and gives a ready SendMessage line. A malformed line
// is ignored, every failure is no note, and the same off switch applies.
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
import { basename, dirname, join, resolve } from 'node:path';
import { boardPath, programOfRun, readBoard, recordBase, repoIdentity, sessionRecords, walkHead } from './handoff-state.mjs';

export const RECENT_EDIT_MS = 6 * 60 * 60 * 1000;
const MAX_SEEN = 500;
const MAX_SEEN_BYTES = 64 * 1024;
const MAX_PEERS = 3;
const MAX_PATHS = 5;
const GIT_TIMEOUT_MS = 3000;
const MAX_PATHSPECS = 100;
const MAX_LEDGER_BYTES = 1024 * 1024;
const MAX_SURFACES = 20;
const MAX_REFS = 3;
const MAX_DIFF_FILES = 2000;
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
function gitCall(command) {
  if (typeof command !== 'string') return null;
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/);
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    if (!/^(?:.*[\\/])?git(?:\.exe)?$/i.test(words.shift() ?? '')) continue;
    while (words.length && words[0].startsWith('-')) {
      const option = words.shift();
      if (GIT_VALUE_OPTIONS.has(option)) words.shift();
    }
    if (GIT_VERBS.has(words[0])) return { verb: words[0], args: words.slice(1) };
  }
  return null;
}
export const gitVerb = (command) => gitCall(command)?.verb ?? null;

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
  return join(storeHome(), '.claude', 'code-ops', 'collision', ident.key, `${key}.json`);
}

function readSeen(file) {
  try {
    if (statSync(file).size > MAX_SEEN_BYTES) return [];
    const body = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(body?.seen) ? body.seen.filter((k) => typeof k === 'string') : [];
  } catch { return []; }
}

// Records keys as delivered. It rereads the file, so two notes of one call commit side by side.
function markSeen(file, fresh) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ v: 1, seen: [...new Set([...readSeen(file), ...fresh])].slice(-MAX_SEEN) })}\n`);
}

// The worktree-relative paths an edit tool call names.
const editPaths = (payload, ctx) => [...new Set(editedFiles(payload).map((f) => boardPath(ctx.ident, resolve(ctx.cwd, f))).filter(Boolean))];

function editNote(payload, ctx) {
  const { cwd, ident, sid, now } = ctx;
  const paths = editPaths(payload, ctx);
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
  return { text: `Collision note (warn only, nothing is blocked): ${lines.join(' | ')}`, commit: () => markSeen(file, fresh) };
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

// ---- Peer surfaces ----

const lower = (v) => String(v ?? '').toLowerCase();
const forwardPath = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

// The surfaces a PROGRAM.md `## Peers` section declares: `[{ target, surfaces, notify }]`. A line is
// `- <slug | *> · Surfaces: <path or glob>, process:<name> · Notify: edit|merge`; any other line is
// ignored, so one typo never hides the rest. `target` is a program slug or `*`.
export function parsePeers(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  let inside = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^##\s/.test(line)) { inside = /^##[^\S\r\n]+Peers[^\S\r\n]*$/i.test(line); continue; }
    const item = inside ? /^[-*]\s+(.+)$/.exec(line) : null;
    const parts = item?.[1].split('·').map((p) => p.trim());
    if (!parts || parts.length !== 3) continue;
    const [target, listed, notified] = parts;
    const notify = /^Notify:\s*(edit|merge)$/i.exec(notified)?.[1].toLowerCase();
    const body = /^Surfaces:\s*(.+)$/i.exec(listed)?.[1];
    if (!notify || !body || !/^(?:\*|[A-Za-z0-9][\w.-]*)$/.test(target)) continue;
    const surfaces = body.split(',').map((x) => x.trim().replace(/^`(.*)`$/, '$1').trim()).filter(Boolean)
      .map((x) => (/^process:/i.test(x) ? `process:${x.slice(8).trim().replace(/\.exe$/i, '')}` : forwardPath(x)))
      .filter((x) => x !== 'process:' && x.length <= 200).slice(0, MAX_SURFACES);
    if (surfaces.length) out.push({ target, surfaces, notify });
  }
  return out;
}

// True when a worktree-relative path falls under a declared surface: an exact path or directory,
// or a glob where `*` and `?` stay inside one segment and `**` crosses segments.
function surfaceMatches(surface, path) {
  if (!/[*?]/.test(surface)) { const dir = surface.replace(/\/+$/, ''); return path === dir || path.startsWith(`${dir}/`); }
  let re = '';
  for (let i = 0; i < surface.length; i++) {
    const c = surface[i];
    if (c === '*' && surface[i + 1] === '*') {
      i++;
      if (surface[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(path);
}

const KILL_COMMANDS = /^(?:.*[\\/])?(?:taskkill|pkill|kill|stop-process)(?:\.exe)?$/i;
// The `&&`, `||`, `;`, or newline statements of a command that run a kill command in any pipeline stage.
function killStatements(command) {
  if (typeof command !== 'string') return [];
  return command.split(/&&|\|\||[;\n]/).filter((statement) => statement.split('|').some((stage) => {
    const words = stage.trim().split(/\s+/);
    while (words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]) || words[0] === 'sudo')) words.shift();
    return KILL_COMMANDS.test(words[0] ?? '');
  }));
}
const namesProcess = (statements, name) => statements.some((s) => new RegExp(`(?<![\\w.-])${name.replace(/[.+^${}()|[\]\\*?]/g, '\\$&')}(?:\\.exe)?(?![\\w-])`, 'i').test(s));

const readLedger = (file) => {
  try { return file && statSync(file).size <= MAX_LEDGER_BYTES ? parsePeers(readFileSync(file, 'utf8')) : []; } catch { return []; }
};
const slugOfLedger = (file) => (file ? basename(dirname(file)) : '');
const readJsonFile = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const sessionIds = (r) => [r?.sessionId, r?.hostSessionId].filter((id) => typeof id === 'string' && id);
const sameSession = (a, b) => sessionIds(a).some((id) => sessionIds(b).includes(id));
const sameFile = (a, b) => lower(resolve(a)) === lower(resolve(b));

// The live peers on this repository whose program differs from this session's, grouped by the live
// head of each handoff chain so a predecessor and its successor are one peer. Each is `{ program,
// programFile, name, sessionId, hostSessionId, branch, worktree, runDir }`: the program slug and
// ledger, the head session's name and ids, the head run folder, and `ids`, every id the live record
// and the head carry. A live record with no run folder, no program, this session's own program, or
// a head the board marks ended is skipped.
// `own` is this session's PROGRAM.md when the caller already holds it (null for none).
function peerSet(cwd, sid, now, own) {
  const ident = repoIdentity(cwd);
  const board = readBoard(cwd, storeHome(), now);
  const live = board.filter((r) => r.state === 'live' && r.sessionId !== sid && r.hostSessionId !== sid);
  if (!live.length) return { ident, ownFile: null, peers: [] };
  const { records } = sessionRecords(cwd);
  // A board row names its own run folder; an older row falls back to the session record.
  const runOf = (row) => {
    const rec = typeof row.runDir === 'string' && row.runDir ? row : records.find((r) => sameSession(r, row));
    if (typeof rec?.runDir !== 'string' || !rec.runDir) return null;
    const base = recordBase(rec, ident, ident.top);
    return { base, dir: resolve(base, rec.runDir) };
  };
  let ownFile = own;
  if (ownFile === undefined) {
    const mine = board.find((r) => sessionIds(r).includes(sid)) ?? records.find((r) => sessionIds(r).includes(sid));
    const run = mine && runOf(mine);
    ownFile = run ? programOfRun(run.dir, run.base) : null;
  }
  const groups = new Map();
  for (const peer of live) {
    const run = runOf(peer);
    if (!run) continue;
    const { base, dir } = run;
    const head = walkHead(dir, base, ident.top);
    const programFile = programOfRun(head.dir, base) ?? programOfRun(dir, base);
    const key = lower(resolve(head.dir));
    if (!programFile || (ownFile && sameFile(programFile, ownFile)) || groups.has(key)) continue;
    const session = readJsonFile(join(head.dir, 'SESSION.json')) ?? {};
    const headRec = board.find((r) => sameSession(r, session)) ?? peer;
    if (headRec.state === 'ended' || sessionIds(session).includes(sid)) continue;
    groups.set(key, {
      program: slugOfLedger(programFile), programFile,
      name: typeof session.name === 'string' && session.name ? session.name : peer.name,
      sessionId: session.sessionId ?? peer.sessionId, hostSessionId: session.hostSessionId ?? peer.hostSessionId,
      ids: [...new Set([...sessionIds(peer), ...sessionIds(session)])],
      branch: headRec.branch, worktree: headRec.worktree, runDir: head.dir,
    });
  }
  return { ident, ownFile: ownFile ?? null, peers: [...groups.values()] };
}

export const discoverPeers = (cwd, sid, now = Date.now(), own) => {
  try { return peerSet(cwd, sid, now, own).peers; } catch { return []; }
};

// The surfaces two programs share, with the notify level each line declared: lines this program
// wrote for the peer's slug or `*`, and lines the peer wrote for this program's slug or `*`.
function sharedSurfaces(ownFile, peer) {
  const aims = (line, slug) => line.target === '*' || (slug !== '' && lower(line.target) === lower(slug));
  return [...readLedger(ownFile).filter((l) => aims(l, peer.program)), ...readLedger(peer.programFile).filter((l) => aims(l, slugOfLedger(ownFile)))]
    .flatMap((l) => l.surfaces.map((surface) => ({ surface, notify: l.notify })));
}

const SURFACE_ACTION = {
  edit: (paths) => `I am about to edit ${pathList(paths)}, a surface our programs share. Tell me if that collides.`,
  merge: (paths, what) => `I am about to run ${what}, which changes ${pathList(paths)}, a surface our programs share. Tell me if that collides.`,
  kill: (names) => `I am about to run a command that stops ${names.join(', ')}, a process you rely on. Tell me if that collides.`,
};

// kind `edit` or `merge` takes `subject()`, the worktree-relative paths touched, called at most once
// and only after a path surface is declared; kind `kill` takes the command's kill statements.
function surfaceNote(kind, ctx, subject, what) {
  const { cwd, sid, now } = ctx;
  const { ident, ownFile, peers } = peerSet(cwd, sid, now);
  if (!peers.length) return null;
  const file = seenFile(ident, sid, ctx.agentId);
  const seen = new Set(readSeen(file));
  let touched = null;
  const lines = [];
  const fresh = [];
  for (const peer of peers) {
    if (lines.length >= MAX_PEERS) break;
    const hits = [];
    for (const { surface, notify } of sharedSurfaces(ownFile, peer)) {
      const key = `surface\t${peer.sessionId}\t${surface}`;
      const isProc = surface.startsWith('process:');
      if (seen.has(key) || fresh.includes(key) || isProc !== (kind === 'kill') || (kind === 'edit' && notify !== 'edit')) continue;
      const matched = isProc ? (namesProcess(subject, surface.slice(8)) ? [surface.slice(8)] : [])
        : (touched ??= subject()).filter((p) => surfaceMatches(surface, p));
      if (!matched.length) continue;
      hits.push({ surface, matched });
      fresh.push(key);
    }
    if (!hits.length) continue;
    const matched = [...new Set(hits.flatMap((h) => h.matched))];
    lines.push(`surface ${hits.map((h) => clean(h.surface, 120)).join(', ')} shared with program "${clean(peer.program)}", live session "${peerName(peer)}" (${where(peer)}). `
      + sendLine(peer, SURFACE_ACTION[kind](matched, what)));
  }
  if (!lines.length) return null;
  return { text: `Surface note (warn only, nothing is blocked): ${lines.join(' | ')}`, commit: () => markSeen(file, fresh) };
}

// The worktree-relative files a `git merge` or `git push` would change, or [] when they cannot be
// read. A merge diffs HEAD against each named ref (three dots, so only the merged side counts); a
// push diffs HEAD against its upstream, else against origin/HEAD.
// deferred(a push on a branch with no upstream and no origin/HEAD reads no diff and gives no note;
// read the remote's default branch if that real case is missed)
function diffFiles(call, ctx) {
  const ref = /^[A-Za-z0-9_][\w./@^~{}-]*$/;
  const ranges = call.verb === 'merge' ? call.args.filter((a) => ref.test(a)).slice(0, MAX_REFS).map((r) => [`HEAD...${r}`])
    : [['@{upstream}..HEAD', 'origin/HEAD...HEAD']];
  const files = new Set();
  for (const options of ranges) {
    for (const range of options) {
      const run = ctx.spawn('git', ['--no-optional-locks', 'diff', '--name-only', range, '--'], { cwd: ctx.ident.top, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, windowsHide: true });
      if (run.status !== 0 || typeof run.stdout !== 'string') continue;
      for (const line of run.stdout.split('\n')) if (line.trim()) files.add(forwardPath(line.trim()));
      break;
    }
  }
  return [...files].slice(0, MAX_DIFF_FILES);
}

const safely = (fn) => { try { return fn(); } catch { return null; } };

// The advisory for one PreToolUse payload: `{ text, commit }`, or null when there is nothing to
// say or anything fails. `commit()` records the note as delivered; call it only after the text is
// actually emitted. `now` and `spawn` (the process launcher) are injectable for tests.
export function collisionNote(payload, now = Date.now(), spawn = spawnSync) {
  try {
    const name = toolName(payload);
    const edit = inTools(name, EDIT_TOOLS);
    if (!edit && !inTools(name, SHELL_TOOLS)) return null;
    const input = toolInput(payload);
    const command = typeof input?.command === 'string' ? input.command : input?.cmd;
    const call = edit ? null : gitCall(command);
    const kills = edit ? [] : killStatements(command);
    if (!edit && !call && !kills.length) return null;
    const sid = payload.session_id ?? payload.sessionId;
    if (typeof sid !== 'string' || !sid) return null;
    const cwd = typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const ctx = { cwd, ident: repoIdentity(cwd), sid, now, spawn, agentId: payload.agent_id };
    const shift = call && (call.verb === 'merge' || call.verb === 'push');
    const notes = (edit ? [safely(() => editNote(payload, ctx)), safely(() => surfaceNote('edit', ctx, () => editPaths(payload, ctx)))]
      : [call && safely(() => gitNote(call.verb, ctx)),
        shift && safely(() => surfaceNote('merge', ctx, () => diffFiles(call, ctx), `git ${call.verb}`)),
        kills.length && safely(() => surfaceNote('kill', ctx, kills))]).filter(Boolean);
    if (!notes.length) return null;
    if (notes.length === 1) return notes[0];
    return { text: notes.map((n) => n.text).join('\n'), commit: () => { for (const n of notes) n.commit(); } };
  } catch { return null; }
}
