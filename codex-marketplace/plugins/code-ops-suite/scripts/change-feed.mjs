// The change feed (C3 of the program-state design): a bounded, per-repository log of moves that
// other sessions on the same machine should hear about. It is a library, never a process. The
// existing hooks import it lazily: hooks/handoff-card.mjs records a `git push` or `gh pr merge`
// and delivers new events to each session's next prompt or tool call; hooks/index-refresh.mjs
// records an edit to a shared hub file; scripts/records.mjs posts a seal at its start and its end.
//
// STORE. `<home>/.claude/code-ops/feed/<repository key>/events.jsonl`, with one read cursor per
// session under `cursors/`. The key is the presence board's key (`repoIdentity` in
// handoff-state.mjs), so a worktree and its main checkout share one feed. Nothing is written into
// the repository, and nothing leaves the machine. An event holds a session name, a branch, a
// commit, and repository-relative paths, never an absolute path.
//
// BOUNDS. The file keeps at most MAX_EVENTS events and MAX_BYTES bytes; an append drops the
// oldest first. A read looks at the last 2 * MAX_BYTES bytes only. A line that fails to parse or
// validate is skipped, and the next append rewrites the file without it.
//
// FAST PATH. Every append also writes `<feed root>/last.json` with the newest event id, and each
// session records the last id it looked at under `<feed root>/seen/`. A call that finds the two
// equal returns after two small file reads, without loading handoff-state.mjs, which keeps the
// added cost on every prompt and tool call near zero while nothing is new.
//
// DELIVERY. `deliver` returns at most MAX_LINES lines: events from other sessions that arrived
// since this session's cursor and that intersect this session's branch or its board edits and
// claims. The cursor advances past every event it looked at, so a line is delivered once. A
// session with no cursor reads the last LOOKBACK_MS of the feed, which covers a peer that
// started just before an event and skips older history.
//
// OFF SWITCH. `CODE_OPS_FEED` (`off`, `0`, or `false`, case-insensitive) turns the feed off. So
// does `CODE_OPS_PEER_GUARD`, the switch for every board-backed coordination hook, because the
// feed reads the board for a session's name, branch, and edits and never runs without it. A
// separate `CODE_OPS_FEED` exists because `CODE_OPS_HANDOFF_CARD=off` must silence only the
// context card, and turning the peer guard off should not be the only way to stop the feed's
// extra context line on every prompt.
//
// FAIL OPEN. Every exported function catches its own errors and returns an empty result. The
// feed is advisory and never blocks a tool call, a prompt, or a seal.
//
// deferred(two appends inside one read-write window, an atomic append log): appends read, then
// rewrite the file through a rename, so two events posted in the same few milliseconds can lose
// one. Events are rare and the loss costs one advisory line.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const MAX_EVENTS = 200;
export const MAX_BYTES = 64 * 1024;
export const MAX_LINES = 3;
const MAX_PATHS = 20;
const LOOKBACK_MS = 10 * 60 * 1000;
const SEAL_LIVE_MS = 30 * 60 * 1000;
const HUB_DEDUPE_MS = 5 * 60 * 1000;
const CURSOR_KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const KINDS = new Set(['push', 'merge', 'hub-edit', 'seal-start', 'seal-land', 'seal-abort']);
const SHA = /^[0-9a-f]{7,64}$/i;
const PUSH = /(?:^|[\s;&|(])git\s+(?:(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?)\s+)*push\b/;
const MERGE = /(?:^|[\s;&|(])gh\s+pr\s+merge\b/;
const DRY_RUN = /\s(?:--dry-run|-n)\b/;
// One ref line of a push summary: `   a..b  src -> dst`, `+ a...b  src -> dst (forced update)`, or
// `* [new branch]  src -> dst`. The flag is a space for a fast-forward.
const PUSH_LINE = /^\s*([+*=!-])?\s*(?:([0-9a-f]{7,40})(\.\.\.?)([0-9a-f]{7,40})|\[([^\]]+)\])\s+(\S+)(?:\s+->\s+(\S+))?/i;
const REF_NAME = /^[\w./@+-]+$/;

const off = (name, env) => /^(off|0|false)$/i.test(env[name] ?? '');
export const feedOff = (env = process.env) => off('CODE_OPS_FEED', env) || off('CODE_OPS_PEER_GUARD', env);
export const storeHome = () => process.env.CODE_OPS_HOME || homedir();
export const feedRoot = (home = storeHome()) => join(home, '.codex', 'code-ops', 'feed');
const slug = (s) => String(s).replace(/[^A-Za-z0-9]/g, '-');
const text = (v, n = 120) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
const state = () => import('./handoff-state.mjs');

function relPath(p) {
  const s = String(p ?? '').replace(/\\/g, '/');
  return s && s.length <= 200 && !/[\u0000-\u001f]/.test(s) && !/^(?:[A-Za-z]:|\/)/.test(s) && !s.split('/').includes('..') ? s : null;
}

// The event kind a shell command produces, or null. A dry run and a command that only names the
// words in a string are still matched by shape; the caller checks the tool result too.
export function commandKind(command) {
  if (typeof command !== 'string') return null;
  if (PUSH.test(command) && !DRY_RUN.test(command)) return 'push';
  return MERGE.test(command) ? 'merge' : null;
}

const responseText = (response) => (typeof response === 'string' ? response : `${response?.stdout ?? ''}\n${response?.stderr ?? ''}`);

// True when a Bash result says nothing moved: a failed exit or an up-to-date push.
export function moveFailed(response) {
  if (response && typeof response === 'object') {
    const code = response.exit_code ?? response.exitCode ?? response.code;
    if (typeof code === 'number' && code !== 0) return true;
    if (response.interrupted === true) return true;
  }
  return /Everything up-to-date/i.test(responseText(response));
}

// One event, validated and clamped. Returns null for anything that is not a well-formed event.
function normalize(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !KINDS.has(raw.kind)) return null;
  const id = text(raw.id, 64);
  const sid = text(raw.sid, 128);
  const at = Date.parse(raw.at);
  if (!id || !sid || Number.isNaN(at)) return null;
  const paths = (Array.isArray(raw.paths) ? raw.paths : []).map(relPath).filter(Boolean).slice(0, MAX_PATHS);
  return {
    v: 1, id, at: new Date(at).toISOString(), kind: raw.kind, branch: text(raw.branch, 100) || null,
    commit: SHA.test(raw.commit) ? String(raw.commit).toLowerCase() : null, session: text(raw.session, 60) || sid.slice(0, 8), sid, paths,
    ...(raw.seal ? { seal: text(raw.seal, 64) } : {}), ...(raw.note ? { note: text(raw.note) } : {}),
  };
}

// The valid events of the feed file, oldest first, from a bounded tail read.
function readEvents(file) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - 2 * MAX_BYTES);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines.map((line) => { try { return normalize(JSON.parse(line)); } catch { return null; } }).filter(Boolean);
  } catch { return []; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* fail open */ } }
}

// Appends one event and drops the oldest past either bound, then swaps the file in by rename.
function appendEvent(file, event) {
  const lines = [...readEvents(file), event].slice(-MAX_EVENTS).map((e) => JSON.stringify(e));
  let bytes = lines.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0);
  while (bytes > MAX_BYTES && lines.length > 1) bytes -= Buffer.byteLength(lines.shift()) + 1;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${lines.join('\n')}\n`);
  try { renameSync(tmp, file); } catch (error) { try { unlinkSync(tmp); } catch { /* best effort */ } throw error; }
}

const headBranch = (ident) => {
  try {
    const head = readFileSync(join(ident.gitDir, 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 12);
  } catch { return null; }
};

const lastFile = (home) => join(feedRoot(home), 'last.json');
const seenFile = (home, sid) => join(feedRoot(home), 'seen', `${slug(sid)}.json`);
const readId = (file) => { try { return JSON.parse(readFileSync(file, 'utf8'))?.id ?? null; } catch { return null; } };
const eventFile = (ident, home) => join(feedRoot(home), ident.key, 'events.jsonl');

// Posts an event for the repository `cwd` belongs to. `input` carries kind, sid, and optionally
// branch, commit, paths, seal, note. Paths become worktree-relative; the session name comes from
// the board. A hub-edit that repeats the same session's last one within five minutes is dropped.
// Returns the stored event, or null.
export async function postEvent(cwd, input, home = storeHome()) {
  try {
    if (!input?.sid) return null;
    const { repoIdentity, readBoard, boardPath } = await state();
    const ident = repoIdentity(cwd);
    const me = readBoard(cwd, home).find((r) => r.sessionId === input.sid);
    const event = normalize({
      id: `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`, at: new Date().toISOString(), kind: input.kind,
      branch: input.branch ?? (ident.gitDir ? headBranch(ident) : null), commit: input.commit, sid: input.sid,
      session: me?.name ?? input.name, paths: (input.paths ?? []).map((p) => boardPath(ident, p)).filter(Boolean),
      seal: input.seal, note: input.note,
    });
    if (!event) return null;
    const file = eventFile(ident, home);
    if (event.kind === 'hub-edit') {
      const last = readEvents(file).reverse().find((e) => e.sid === event.sid && e.kind === 'hub-edit' && e.branch === event.branch);
      if (last && last.paths.join('\n') === event.paths.join('\n') && Date.parse(event.at) - Date.parse(last.at) < HUB_DEDUPE_MS) return null;
    }
    appendEvent(file, event);
    writeFileSync(lastFile(home), JSON.stringify({ id: event.id }));
    return event;
  } catch { return null; }
}

// The ref updates a push summary reports: `{ seen, refs }`, `seen` being true when any ref line
// parsed. `refs` holds only the updates that moved a branch (a fast-forward, a forced update, or a
// new branch), never a rejected, deleted, up-to-date, or tag line.
export function parsePush(output) {
  const refs = [];
  let seen = false;
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const m = PUSH_LINE.exec(line);
    if (!m) continue;
    seen = true;
    const [, flag = '', from, sep, to, summary, src, dst] = m;
    const moved = to ? flag === '' || flag === '+' : summary === 'new branch' && flag === '*';
    if (moved && dst && REF_NAME.test(src) && !src.includes('..')) refs.push({ from, sep, to, src, dst: dst.replace(/^refs\/heads\//, '') });
  }
  return { seen, refs };
}

const commonDir = (gitDir) => { try { return resolve(gitDir, readFileSync(join(gitDir, 'commondir'), 'utf8').trim()); } catch { return gitDir; } };

// The commit a ref names, read from the repository files without git. Null for anything the files
// do not settle: a missing ref, or a ref store other than loose and packed refs.
function readRef(ident, ref, depth = 0) {
  if (!ident?.gitDir || depth > 4) return null;
  const common = commonDir(ident.gitDir);
  for (const dir of [ident.gitDir, common]) {
    try {
      const value = readFileSync(join(dir, ref), 'utf8').trim();
      if (value.startsWith('ref: ')) return readRef(ident, value.slice(5), depth + 1);
      return SHA.test(value) ? value.toLowerCase() : null;
    } catch { /* try the next folder */ }
  }
  try {
    for (const line of readFileSync(join(common, 'packed-refs'), 'utf8').split('\n')) {
      const [sha, name] = line.trimEnd().split(' ');
      if (name === ref && SHA.test(sha)) return sha.toLowerCase();
    }
  } catch { /* no packed refs */ }
  return null;
}

// The remote's default branch as `origin/<name>`, from `refs/remotes/origin/HEAD`, or null.
function defaultBase(ident) {
  try {
    const head = readFileSync(join(commonDir(ident.gitDir), 'refs', 'remotes', 'origin', 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/remotes/') ? head.slice(18) : null;
  } catch { return null; }
}

// The commit, branch, and changed paths of a push or a PR merge, repo-relative and capped. `moved`
// is false when the push summary shows no branch moved. A push reads its range, branch, and commit
// from the summary git printed (`output`, the tool result) and reads the current commit and the
// default branch from the repository files, so it spawns one `git diff` at most. That also covers
// `git push origin a:b`, which names a target ref, not the current branch. Output with no ref line
// falls back to asking git: the upstream tracking ref against its previous value, then the branch
// against the default branch, then the last commit. A merge diffs the branch against the default
// branch. `ident` is the repository identity; `run` replaces `spawnSync` in tests. `diff: false` skips
// every `git diff`, so the paths stay empty and a push spawns nothing when the files settle the rest.
export function gitFacts(cwd, kind, { output = '', ident = null, run = spawnSync, diff = true } = {}) {
  const git = (args) => {
    const r = run('git', args, { cwd, encoding: 'utf8', timeout: 3000, windowsHide: true });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  const names = (out) => (out ? out.split(/\r?\n/).filter(Boolean) : null);
  const head = () => {
    const sha = readRef(ident, 'HEAD') ?? git(['rev-parse', 'HEAD']);
    return sha && SHA.test(sha) ? sha : null;
  };
  const base = () => defaultBase(ident) ?? git(['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']) ?? 'origin/main';
  const facts = (commit, paths, branch = null) => ({ moved: true, branch, commit, paths: (paths ?? []).slice(0, MAX_PATHS) });
  const changed = (...range) => (diff ? names(git(['diff', '--name-only', ...range])) : null);
  if (kind !== 'push') return facts(head(), changed(`${base()}...HEAD`));
  const parsed = parsePush(output);
  if (!parsed.seen) {
    return facts(head(), changed('@{u}@{1}', '@{u}') ?? changed(`${base()}...HEAD`) ?? changed('HEAD~1', 'HEAD'));
  }
  const current = ident?.gitDir ? headBranch(ident) : null;
  const ref = parsed.refs.find((r) => r.dst === current) ?? parsed.refs[0];
  if (!ref) return { moved: false, branch: null, commit: null, paths: [] };
  const tip = readRef(ident, ref.src === 'HEAD' ? 'HEAD' : `refs/heads/${ref.src}`);
  if (ref.to) {
    const commit = tip?.startsWith(ref.to.toLowerCase()) ? tip : ref.to;
    return facts(commit, changed(`${ref.from}${ref.sep}${ref.to}`), ref.dst);
  }
  const commit = tip ?? (ref.dst === current ? head() : null);
  return facts(commit, commit ? changed(`${base()}...${commit}`) : null, ref.dst);
}

// Records a completed `git push` or `gh pr merge` that this session ran in `cwd`. `response` is the
// Bash tool result, whose push summary names the range, the branch, and the commit. With no other
// live session on the board the event keeps its commit and branch but names no paths, which spares
// the one `git diff`: no peer is there to hear an overlap, and a later one still hears the branch.
export async function recordMove(cwd, sid, kind, home = storeHome(), response = null) {
  try {
    const { repoIdentity, readBoard } = await state();
    const peers = readBoard(cwd, home).some((r) => r.state === 'live' && r.sessionId !== sid && r.hostSessionId !== sid);
    const facts = gitFacts(cwd, kind, { output: responseText(response), ident: repoIdentity(cwd), diff: peers });
    if (!facts.moved) return null;
    return await postEvent(cwd, { kind, sid, branch: facts.branch, commit: facts.commit, paths: facts.paths }, home);
  } catch { return null; }
}

const list = (paths) => `${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ` (+${paths.length - 3} more)` : ''}`;

function describe(event, overlap) {
  const sha = event.commit ? event.commit.slice(0, 7) : null;
  const branch = event.branch ?? 'a branch';
  const body = {
    push: `${branch} moved${sha ? ` to ${sha}` : ''} by ${event.session}`,
    merge: `a PR was merged by ${event.session}${sha ? ` (head ${sha})` : ''}`,
    'hub-edit': `${event.paths[0] ?? 'a shared hub file'} was edited by ${event.session} on ${branch}`,
    'seal-start': `${event.session} started a seal on ${branch}${sha ? ` at ${sha}` : ''}`,
    'seal-land': `${event.session} landed a seal on ${branch}${sha ? ` at ${sha}` : ''}`,
    'seal-abort': `${event.session} abandoned a seal on ${branch}${sha ? ` at ${sha}` : ''}`,
  }[event.kind];
  return `code-ops change feed: ${body}${overlap.length ? `; it touched files you edited: ${list(overlap)}` : ''}.`;
}

const within = (path, roots) => roots.some((r) => path === r || path.startsWith(`${r.replace(/\/+$/, '')}/`));

// The lines this session should hear at its next prompt or tool call. Advances the read cursor.
export async function deliver(cwd, sid, home = storeHome(), now = Date.now()) {
  try {
    const last = sid ? readId(lastFile(home)) : null;
    if (!last || last === readId(seenFile(home, sid))) return [];
    const lines = await collect(cwd, sid, home, now);
    writeSmall(seenFile(home, sid), { id: last });
    return lines;
  } catch { return []; }
}

async function collect(cwd, sid, home, now) {
  const { repoIdentity, readBoard } = await state();
  const ident = repoIdentity(cwd);
  const events = readEvents(eventFile(ident, home));
  const cursorFile = join(feedRoot(home), ident.key, 'cursors', `${slug(sid)}.json`);
  let cursor = null;
  try { cursor = JSON.parse(readFileSync(cursorFile, 'utf8')); } catch { /* first call, or corrupt */ }
  if (!cursor || typeof cursor !== 'object') cursor = null;
  let fresh;
  if (!cursor) fresh = events.filter((e) => Date.parse(e.at) > now - LOOKBACK_MS);
  else {
    const index = events.findIndex((e) => e.id === cursor.id);
    fresh = index >= 0 ? events.slice(index + 1) : events.filter((e) => Date.parse(e.at) > (Date.parse(cursor.at) || 0));
  }
  const tail = events.at(-1);
  if (tail && (fresh.length || !cursor)) writeCursor(cursorFile, tail);
  fresh = fresh.filter((e) => e.sid !== sid);
  if (!fresh.length) return [];
  const me = readBoard(cwd, home, now).find((r) => r.sessionId === sid);
  const branch = me?.branch ?? (ident.gitDir ? headBranch(ident) : null);
  const mine = [...(me?.edits ?? []).map((e) => e?.path), ...(me?.claims ?? [])].filter((p) => typeof p === 'string' && p);
  const relevant = fresh.map((e) => ({ e, overlap: e.paths.filter((p) => within(p, mine)) }))
    .filter(({ e, overlap }) => (branch && e.branch === branch) || overlap.length);
  const shown = relevant.slice(-MAX_LINES).map(({ e, overlap }) => describe(e, overlap));
  const skipped = relevant.length - shown.length;
  return skipped > 0 ? [`code-ops change feed: ${skipped} earlier event${skipped === 1 ? '' : 's'} not shown.`, ...shown] : shown;
}

// Writes a small state file, and on the first write for a session prunes the files of sessions
// long gone from the same folder.
function writeSmall(file, body) {
  const first = !existsSync(file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(body));
  if (!first) return;
  for (const name of readdirSync(dirname(file))) {
    const other = join(dirname(file), name);
    try { if (Date.now() - statSync(other).mtimeMs > CURSOR_KEEP_MS) unlinkSync(other); } catch { /* best effort */ }
  }
}
const writeCursor = (file, tail) => writeSmall(file, { v: 1, id: tail.id, at: tail.at });

// The session id a seal posts under: the host's session id when a hook or shell exports it,
// else a per-process id, so a bare command line seal still counts as one seal.
const sealSid = () => process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_SESSION_ID || `cli-${process.pid}`;

// Posts a seal-start for `base` and returns `{ seal, warnings }`. A warning names each other
// in-flight seal on the same base head: started within 30 minutes, no land or abort after it.
// The caller prints the warnings and continues; a seal is never refused on this basis.
export async function startSeal(cwd, { base, note }, home = storeHome()) {
  try {
    const { repoIdentity } = await state();
    const events = readEvents(eventFile(repoIdentity(cwd), home));
    const ended = new Set(events.filter((e) => e.kind === 'seal-land' || e.kind === 'seal-abort').map((e) => e.seal));
    const warnings = events
      .filter((e) => e.kind === 'seal-start' && e.commit === base && !ended.has(e.seal) && Date.now() - Date.parse(e.at) < SEAL_LIVE_MS)
      .map((e) => `${e.session} started a seal on this base head (${base.slice(0, 7)}) at ${e.at} and has not landed it. A second seal on the same head fails its baseBindings check.`);
    const seal = randomUUID();
    await postEvent(cwd, { kind: 'seal-start', sid: sealSid(), name: 'records seal', commit: base, seal, note }, home);
    return { seal, warnings };
  } catch { return { seal: null, warnings: [] }; }
}

// Posts the end of a seal: `land` for a completed one, `abort` for one that threw.
export async function endSeal(cwd, { seal, land, base, paths, note }, home = storeHome()) {
  if (!seal) return null;
  return postEvent(cwd, { kind: land ? 'seal-land' : 'seal-abort', sid: sealSid(), name: 'records seal', commit: base, paths, seal, note }, home);
}
