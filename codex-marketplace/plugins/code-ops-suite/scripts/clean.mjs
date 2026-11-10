#!/usr/bin/env node
// `co clean`: reports what code-ops scratch and state is reclaimable, and removes it only on request.
//
//   node scripts/clean.mjs [--apply] [--scope state|tmp|runs|worktrees|branches]... [--store <name>]...
//                          [--older-than <days>] [--json] [--root <dir>] [--home <dir>]
//
// WHY: nothing prunes the user state folder, the run folders, the host scratch folders, merged
// worktrees, or merged branches, so leads and agents work around stale files. A deleting tool fails by
// deleting evidence, another repository's live state, or uncommitted work, so every rule below keeps
// when it is unsure and says so.
//
// DRY RUN is the default: one line per scope (file count, bytes, the rule), then a total. `--apply`
// deletes only the scopes named with `--scope`; `--apply` without one is a usage error.
//
// SCOPES
//   state      `<home>/.claude/code-ops/<store>`, one age threshold per store (STORES). A store is `auto`
//              only when its reader has a bounded window or its content rebuilds on a miss; every other
//              store is `manual`: reported, and removed only when `--store <name>` names it under
//              `--apply`. Nothing newer than 24 hours, no lock file, and nothing a session seen in the
//              last 24 hours holds (by id, id slug, or id sha256) is ever removed. One exception: a
//              `recall/<slug>/<session>/build.lock` over an hour old whose recorded pid is dead (ESRCH
//              only; a live, unreadable, or pid-less lock stays) is removed with its store, and does not
//              keep its unit.
//   tmp        files older than 2 days under `<root>/<host folder>/.tmp`, for every host folder.
//   runs       a run folder under a docs hub `80 Runs/` is removed only when SESSION.json says
//              `retention: working`, its newest file is over 30 days old, it holds no HANDOFF.md without
//              a HANDOFF.consumed, and no tracked file cites its name. An `evidence` run, a `programs`
//              folder, and a run with no retention mark are kept; the unmarked ones are listed with the
//              command that marks them. handoff-state.mjs reads a missing or invalid mark as evidence.
//   worktrees  a worktree under `<root>/<host folder>/worktrees` whose status is empty (ignored files
//              included, because `git worktree remove` deletes them), whose branch is merged into main,
//              that is not locked, detached, or the working directory. `git worktree remove`, never
//              --force; a failure is reported. The branch stays.
//   branches   report only: merged local branches whose upstream is gone. Ancestry misleads after a
//              squash merge, so the operator verifies content before deleting one.
//
// SAFETY: every delete target is resolved through symlinks and must sit inside its scope root. A walk
// never follows a link or junction; a link is unlinked, never its target. Only files, links, and empty
// directories are removed (never a recursive remove). `--older-than` only raises a threshold; a value
// below a selected scope's floor is a usage error.
//
// `CODE_OPS_CLEAN` of `off`, `0`, or `false` silences the SessionStart advisory (`cleanAdvisory`, called
// by hooks/routing-card.mjs); the command always works.
//
// Exit: 0 = done (a failed delete is listed, not escalated); 2 = usage error.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_FOLDERS, detectHost, resolveLayout } from './workspace-layout.mjs';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN_AGE_MS = DAY; // nothing newer than this is ever removed
export const FLOOR_DAYS = 14; // no state store is cleaned sooner
export const TMP_DAYS = 2;
export const RUNS_DAYS = 30;
const SCOPES = ['state', 'tmp', 'runs', 'worktrees', 'branches'];
const SELF = fileURLToPath(import.meta.url);

// One row per store under `<home>/.claude/code-ops/`, in walk order (large bytes first, so a budgeted
// walk keeps the biggest numbers). `days` is the age threshold; `mode` is `auto` or `manual`; `unit`
// `dir2` removes `<slug>/<session>` as a whole. Each `why` names the reader. A store read by a
// 14-day window has at least 30 days. `feed` is absent on purpose: change-feed.mjs bounds
// events.jsonl at MAX_EVENTS and prunes its own cursors at 14 days (CURSOR_KEEP_MS).
const row = (days, mode, why, unit = 'file', keep = null) => Object.freeze({ days, mode, why, unit, keep });
export const STORES = Object.freeze({
  // recall and index are `auto` at 30 days because both rebuild on a miss (confirmed in D-016): a removed
  // index costs one rebuild on the next call, never evidence.
  recall: row(30, 'auto', 'transcript-recall.mjs rebuilds a missing or drifted index on the next call (needOf, refresh), so an expired unit is regenerable', 'dir2'),
  index: row(30, 'auto', 'context-query.mjs rebuilds a missing index on any command, so an expired file is regenerable'),
  // The receipts file itself stays (it is rewritten, never deleted), so a receipt never outlives its raw file.
  digest: row(30, 'manual', 'a model re-reads a digest\'s raw file by the path in DIGEST_RECEIPTS.jsonl; no window, and the raw output is not regenerable', 'file', /^DIGEST_RECEIPTS\.jsonl$/),
  snapshots: row(30, 'manual', 'routing-card.mjs and handoff-state.mjs read a snapshot by session id only; rebuildable, no window'),
  handoff: row(30, 'manual', 'session-receipt.mjs reads one marker by session id; its `peak` must not be lowered, no window'),
  agents: row(30, 'auto', 'agent-ledger.mjs pendingReport reads a 14-day window (DEFAULT_MAX_AGE_MS); a file with an unsettled background dispatch is kept'),
  board: row(30, 'auto', 'handoff-state.mjs readBoard marks a record idle after 30 minutes (BOARD_IDLE_MS); an older record is expired'),
  collision: row(30, 'manual', 'collision-lib.mjs reads one per-session seen-set; no window, a lost set only repeats a note'),
  sessions: row(30, 'manual', 'handoff-state.mjs sessionRecords reads every record and `co handoff live` resolves a name through them; no window'),
  dispatch: row(30, 'manual', 'dispatch-guard.mjs keys counters and briefs by agent id with no expiry'),
  'snapshot-cache': row(30, 'manual', 'no reader or writer in this tree, so nothing shows it expired or regenerable'),
});

// ---- path safety ---------------------------------------------------------------------------

const rel = (root, target) => relative(root, target);
const inside = (root, target) => {
  const r = rel(root, target);
  return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r);
};
const fwd = (path) => path.replace(/\\/g, '/');
const isLock = (name) => /(^|\.)(lock|lck)$/i.test(name) || /\.lock(\.|$)/i.test(name);

/**
 * Removes one file, link, or EMPTY directory, or says why not. The target resolves through its parent
 * directory's real path, so a `..` segment or a symlinked parent that leaves `root` is refused, while a
 * link as the leaf is removed itself and never followed. Returns null on success, `gone`, or a reason.
 * @param {string} target @param {string} root
 */
export function removeTarget(target, root) {
  const abs = resolve(target);
  let real;
  let rootReal;
  try {
    rootReal = realpathSync.native(root);
    real = join(realpathSync.native(dirname(abs)), basename(abs));
  } catch (error) { return `unresolvable (${error.code ?? 'error'})`; }
  if (!inside(rootReal, real)) return `refused: outside ${fwd(root)}`;
  let stat;
  try { stat = lstatSync(real); } catch { return 'gone'; }
  try {
    if (stat.isDirectory()) rmdirSync(real); // empty only: never recursive
    else {
      try { unlinkSync(real); } catch (error) {
        // Windows reports a directory junction as a link that unlink refuses; rmdir removes the link alone.
        if (stat.isSymbolicLink() && (error.code === 'EPERM' || error.code === 'EISDIR')) rmdirSync(real);
        else throw error;
      }
    }
  } catch (error) { return `failed (${error.code ?? 'error'})`; }
  return null;
}

// Depth-first walk that never follows a link or junction. `visit(path, lstat)` sees files and links;
// a visit that sets ctx.stop ends the walk, and a passed ctx.deadline ends it with ctx.truncated.
function walk(dir, visit, ctx = {}) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (ctx.stop) return;
    if (ctx.deadline && performance.now() > ctx.deadline) { ctx.truncated = true; ctx.stop = true; return; }
    const path = join(dir, entry.name);
    let stat;
    try { stat = lstatSync(path); } catch { continue; }
    if (stat.isDirectory()) { ctx.dirs?.push(path); walk(path, visit, ctx); } else visit(path, stat);
  }
}

// Deletes the files, then the directories they emptied (never `root`). Returns what went.
// A stale build lock (`lockText` set by the scan) is deleted only while its bytes still equal what the
// scan read: a live build that reclaimed the lock since then wrote a new pid and stamp, so the lock stays.
export function removeItems(items, root) {
  const out = { files: 0, bytes: 0, failed: [] };
  const parents = new Set();
  for (const item of items) {
    if (item.lockText !== undefined) {
      let current = null;
      try { current = readFileSync(item.path, 'utf8'); } catch { /* gone: nothing to remove */ }
      if (current !== item.lockText) continue;
    }
    const reason = removeTarget(item.path, root);
    if (reason === null) { out.files += 1; out.bytes += item.bytes; parents.add(dirname(item.path)); } else if (reason !== 'gone') out.failed.push(`${fwd(item.path)}: ${reason}`);
  }
  const dirs = new Set();
  for (const parent of parents) for (let dir = parent; inside(resolve(root), resolve(dir)); dir = dirname(dir)) dirs.add(dir);
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) removeTarget(dir, root); // a non-empty directory refuses
  return out;
}

// ---- helpers shared by the scopes ----------------------------------------------------------

const stateHome = () => process.env.CODE_OPS_HOME || homedir();
const stateDir = (home) => join(home, '.codex', 'code-ops');
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const slugOf = (value) => String(value).replace(/[^A-Za-z0-9]/g, '-');
const age = (stat, now) => now - stat.mtimeMs;

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

// The keys a live session's files may carry: its id, the id's slug, and the id's sha256, because each
// store names its files differently. A session is live when its record or board entry changed in the
// last 24 hours.
function liveKeys(home, now) {
  const keys = new Set();
  for (const store of ['sessions', 'board']) {
    const root = join(stateDir(home), store);
    let repos = [];
    try { repos = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { continue; }
    for (const repo of repos) {
      let files = [];
      try { files = readdirSync(join(root, repo.name)).filter((f) => f.endsWith('.json')); } catch { continue; }
      for (const file of files) {
        const path = join(root, repo.name, file);
        let stat;
        try { stat = statSync(path); } catch { continue; }
        const body = readJson(path);
        const seen = Math.max(stat.mtimeMs, Date.parse(body?.updatedAt) || 0, Date.parse(body?.heartbeat) || 0);
        if (now - seen > DAY) continue;
        for (const id of [basename(file, '.json'), body?.sessionId, body?.hostSessionId]) {
          if (typeof id === 'string' && id.length >= 8) { keys.add(id); keys.add(slugOf(id)); keys.add(sha256(id)); }
        }
      }
    }
  }
  return keys;
}

const holdsLiveKey = (relPath, keys) => relPath.split(/[\\/]/).some((segment) => {
  const stem = segment.split('.')[0];
  for (const key of keys) if (stem.startsWith(key)) return true;
  return false;
});

// A recall build lock over an hour old whose recorded pid is gone. Only ESRCH means gone (EPERM is a
// live process of another user), and a lock with no readable pid is kept: the build's own stale rule
// (transcript-recall.mjs lockStale) judges those at the next build.
// Returns the lock's text, so removeItems can refuse to delete a lock that changed after this scan, or null.
function deadBuildLock(path, stat, now) {
  if (now - stat.mtimeMs <= HOUR) return null;
  let text;
  let pid;
  try { text = readFileSync(path, 'utf8'); pid = JSON.parse(text)?.pid; } catch { return null; }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return null; } catch (error) { return error.code === 'ESRCH' ? text : null; }
}

// The ledger file that a state file's keep rule reads: a journal follows its ledger.
function agentKeep(path, cache) {
  const ledger = path.endsWith('.journal.jsonl') ? `${path.slice(0, -'.journal.jsonl'.length)}.jsonl` : path;
  if (!cache.has(ledger)) {
    // Mirrors agent-ledger.mjs: a background dispatch with an agent id and no reported or failed row.
    const rows = [];
    try { for (const line of readFileSync(ledger, 'utf8').split('\n')) { try { rows.push(JSON.parse(line)); } catch { /* skip a bad line */ } } } catch { /* unreadable: keep */ cache.set(ledger, true); return true; }
    const settled = new Set(rows.filter((r) => (r.status === 'reported' || r.status === 'failed') && r.agent_id).map((r) => r.agent_id));
    cache.set(ledger, rows.some((r) => r.status === 'dispatched' && r.background && r.agent_id && !settled.has(r.agent_id)));
  }
  return cache.get(ledger);
}

// ---- scope: state --------------------------------------------------------------------------

/**
 * Plans the state scope. Returns one entry per store with its removable items and what was kept.
 * @param {{ home: string, now: number, days?: number, deadline?: number, only?: string[] }} opt
 */
export function scanState({ home, now, days = 0, deadline, only }) {
  const ctx = { deadline, truncated: false, stop: false };
  const keys = liveKeys(home, now);
  const agentCache = new Map();
  const stores = [];
  for (const [name, spec] of Object.entries(STORES)) {
    if (only?.length && !only.includes(name)) continue;
    const root = join(stateDir(home), name);
    const entry = { name, mode: spec.mode, days: Math.max(spec.days, days), root, items: [], files: 0, bytes: 0, kept: { fresh: 0, lock: 0, live: 0, unsettled: 0 } };
    stores.push(entry);
    if (!existsSync(root)) continue;
    const threshold = entry.days * DAY;
    // A `dir2` unit (`<slug>/<session>`) is judged as one: its newest file sets the age, and a lock,
    // a live key, or a fresh file anywhere in it keeps the whole unit.
    const units = new Map();
    const deadLocks = [];
    walk(root, (path, stat) => {
      if (spec.keep?.test(basename(path))) return;
      const relPath = rel(root, path);
      const deadLock = name === 'recall' && basename(path) === 'build.lock' && relPath.split(sep).length === 3 ? deadBuildLock(path, stat, now) : null;
      if (deadLock !== null) {
        deadLocks.push({ path, bytes: stat.size, lockText: deadLock });
        return;
      }
      const unitKey = spec.unit === 'dir2' ? relPath.split(sep).slice(0, 2).join(sep) : relPath;
      const unit = units.get(unitKey) ?? { items: [], newest: 0, lock: false, link: false };
      units.set(unitKey, unit);
      unit.items.push({ path, bytes: stat.isSymbolicLink() ? 0 : stat.size });
      unit.newest = Math.max(unit.newest, stat.mtimeMs);
      if (isLock(basename(path))) unit.lock = true;
    }, ctx);
    for (const lock of deadLocks) { entry.items.push(lock); entry.files += 1; entry.bytes += lock.bytes; }
    for (const [unitKey, unit] of units) {
      const verdict = now - unit.newest < Math.max(threshold, MIN_AGE_MS) ? 'fresh'
        : unit.lock ? 'lock'
        : holdsLiveKey(unitKey, keys) ? 'live'
        : name === 'agents' && unit.items.some((i) => agentKeep(i.path, agentCache)) ? 'unsettled' : null;
      if (verdict) { entry.kept[verdict] += unit.items.length; continue; }
      for (const item of unit.items) { entry.items.push(item); entry.files += 1; entry.bytes += item.bytes; }
    }
  }
  return { stores, truncated: ctx.truncated };
}

// Rewrites a digest slug's receipts without the lines for the raw files about to go, atomically, then
// reports which raw files may be deleted. A receipts file that changed between read and rename, or
// cannot be rewritten, leaves both. A line with no raw path, or one outside the store, stays.
function settleDigest(items, root) {
  const bySlug = new Map();
  for (const item of items) {
    const slug = rel(root, item.path).split(sep)[0];
    if (item.path.endsWith('.txt')) bySlug.set(slug, [...(bySlug.get(slug) ?? []), item]);
  }
  const allowed = [];
  const skipped = [];
  const key = (path) => resolve(path).toLowerCase();
  for (const [slug, slugItems] of bySlug) {
    const receipts = join(root, slug, 'DIGEST_RECEIPTS.jsonl');
    const going = new Set(slugItems.map((i) => key(i.path)));
    if (!existsSync(receipts)) { allowed.push(...slugItems); continue; }
    try {
      const before = statSync(receipts);
      const kept = readFileSync(receipts, 'utf8').split('\n').filter((line) => {
        if (!line.trim()) return false;
        try { const raw = JSON.parse(line)?.raw; return !(typeof raw === 'string' && going.has(key(raw))); } catch { return true; }
      });
      const temp = `${receipts}.clean.tmp`;
      writeFileSync(temp, kept.length ? `${kept.join('\n')}\n` : '');
      const after = statSync(receipts);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) { unlinkSync(temp); skipped.push(...slugItems); continue; }
      renameSync(temp, receipts);
      allowed.push(...slugItems);
    } catch { skipped.push(...slugItems); }
  }
  return { allowed, skipped, others: items.filter((i) => !i.path.endsWith('.txt')) };
}

// ---- scope: tmp ----------------------------------------------------------------------------

/** A passed `deadline` (a `performance.now()` value) ends the walk with `truncated` set; the totals are then a lower bound. */
export function scanTmp({ root, now, days = TMP_DAYS, deadline }) {
  const result = { items: [], files: 0, bytes: 0, roots: [], truncated: false };
  const ctx = { deadline, truncated: false, stop: false };
  for (const folder of new Set(Object.values(HOST_FOLDERS))) {
    if (ctx.stop || (deadline && performance.now() > deadline)) { ctx.truncated = true; break; }
    const tmp = join(root, folder, '.tmp');
    if (!existsSync(tmp)) continue;
    result.roots.push(tmp);
    walk(tmp, (path, stat) => {
      if (dirname(path) === tmp && basename(path) === '.gitignore') return; // the layout's own ignore file
      if (age(stat, now) < Math.max(days * DAY, MIN_AGE_MS)) return;
      result.items.push({ path, bytes: stat.isSymbolicLink() ? 0 : stat.size, root: tmp });
      result.files += 1;
      result.bytes += stat.isSymbolicLink() ? 0 : stat.size;
    }, ctx);
  }
  result.truncated = ctx.truncated;
  return result;
}

// ---- scope: runs ---------------------------------------------------------------------------

// handoff-state.mjs runsRoots (not exported): the repository's own `80 Runs` and each `*-docs` hub's.
function runsRoots(root) {
  const hubs = [root];
  try { for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && e.name.endsWith('-docs')) hubs.push(join(root, e.name)); } catch { /* unreadable root */ }
  return hubs.map((hub) => join(hub, '80 Runs')).filter((dir) => existsSync(dir));
}

// Tracked files' text, read once, for the citation test; null when git cannot list them.
function trackedCitations(root, names) {
  const cited = new Set();
  const list = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (list.status !== 0 || list.error) return null;
  for (const file of list.stdout.split('\0').filter(Boolean)) {
    if (file.split('/').includes('80 Runs')) continue;
    let text;
    try { const abs = resolve(root, file); const stat = statSync(abs); if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue; text = readFileSync(abs, 'utf8'); } catch { continue; }
    for (const name of names) if (!cited.has(name) && text.includes(name)) cited.add(name);
  }
  return cited;
}

/**
 * Plans the runs scope. `light` skips sizes and the citation test (the SessionStart advisory counts
 * only). Retention follows handoff-state.mjs: `evidence` keeps, `working` is disposable scratch, and a
 * missing or invalid mark is evidence by default, so it is listed as unmarked and never removed.
 * @param {{ root: string, now: number, days?: number, light?: boolean, deadline?: number }} opt
 */
export function scanRuns({ root, now, days = RUNS_DAYS, light = false, deadline }) {
  const out = { candidates: [], unmarked: [], kept: { recent: 0, evidence: 0, handoff: 0, cited: 0 }, files: 0, bytes: 0, stale: 0, truncated: false, citationsChecked: true };
  const cutoff = now - Math.max(days * DAY, MIN_AGE_MS);
  const ctx = { deadline, truncated: false, stop: false };
  for (const runs of runsRoots(root)) {
    let folders = [];
    try { folders = readdirSync(runs, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'programs'); } catch { continue; }
    for (const folder of folders) {
      if (deadline && performance.now() > deadline) { ctx.truncated = true; break; }
      const dir = join(runs, folder.name);
      const info = { dir, runs, name: folder.name, files: [], bytes: 0, handoffDirs: new Set(), consumedDirs: new Set() };
      const probe = { stop: false };
      // One newer file makes the run recent and ends its walk, so a recent run costs a few stats. The
      // advisory (`light`) looks only at the top level: an approximate count, never a delete list.
      const visit = (path, stat) => {
        if (stat.mtimeMs >= cutoff) probe.stop = true;
        if (!light) { const bytes = stat.isSymbolicLink() ? 0 : stat.size; info.files.push({ path, bytes }); info.bytes += bytes; }
        if (basename(path) === 'HANDOFF.md') info.handoffDirs.add(dirname(path));
        if (basename(path) === 'HANDOFF.consumed') info.consumedDirs.add(dirname(path));
      };
      if (light) {
        try { for (const name of readdirSync(dir)) { try { visit(join(dir, name), lstatSync(join(dir, name))); } catch { /* vanished */ } } } catch { /* unreadable: no count */ }
      } else walk(dir, visit, probe);
      if (probe.stop || statSync(dir).mtimeMs >= cutoff) { out.kept.recent += 1; continue; }
      if ([...info.handoffDirs].some((d) => !info.consumedDirs.has(d))) { out.kept.handoff += 1; continue; }
      const session = readJson(join(dir, 'SESSION.json'));
      const mark = session?.retention;
      if (mark === 'evidence') { out.kept.evidence += 1; continue; }
      out.stale += 1;
      if (mark !== 'working') { out.unmarked.push({ ...info, hasSession: Boolean(session) }); continue; }
      out.candidates.push(info);
    }
  }
  out.truncated = ctx.truncated;
  if (!light && out.candidates.length) {
    const cited = trackedCitations(root, out.candidates.map((c) => c.name));
    out.citationsChecked = cited !== null;
    out.candidates = out.candidates.filter((c) => {
      if (cited === null || cited.has(c.name)) { out.kept.cited += 1; return false; }
      return true;
    });
    for (const c of out.candidates) { out.files += c.files.length; out.bytes += c.bytes; }
  }
  return out;
}

// ---- scopes: worktrees and branches --------------------------------------------------------

const git = (cwd, args, timeout = 30_000) => spawnSync('git', args, { cwd, encoding: 'utf8', timeout, windowsHide: true });
// `left`, when given, returns the milliseconds a caller still has; each git call gets at most that much
// and none starts once it is spent, so a bounded caller (the advisory) is never held by this lookup.
const mainBranch = (root, left) => ['main', 'master'].find((b) => {
  const timeout = left ? left() : 30_000;
  return timeout > 0 && git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], timeout).status === 0;
}) ?? null;
const lines = (text) => String(text ?? '').split(/\r?\n/).filter(Boolean);

// The layout stubs `ensureLayout` writes (a `.gitignore` in `.tmp` and `worktrees`) are not work.
function onlyLayoutStubs(wt, entry) {
  const dir = resolve(wt, entry.replace(/\/$/, ''));
  const parts = rel(wt, dir).split(sep);
  if (parts.length !== 2 || !['.tmp', 'worktrees'].includes(parts[1]) || !Object.values(HOST_FOLDERS).includes(parts[0])) return false;
  try { return readdirSync(dir).every((f) => f === '.gitignore'); } catch { return false; }
}

/**
 * Plans the worktrees scope. Returns the removable worktrees and why each other one stays.
 * `quick` (the advisory) spawns no git when no worktrees folder holds a worktree, and skips sizes.
 * @param {{ root: string, now: number, cwd?: string, deadline?: number, quick?: boolean }} opt
 */
export function scanWorktrees({ root, now, cwd = process.cwd(), deadline, quick = false }) {
  const out = { candidates: [], kept: [], files: 0, bytes: 0, note: null };
  const homes = [...new Set(Object.values(HOST_FOLDERS))].map((f) => join(root, f, 'worktrees')).filter((d) => { try { return readdirSync(d).some((n) => n !== '.gitignore'); } catch { return false; } }).map((d) => realpathSync.native(d));
  if (quick && !homes.length) return out;
  // The time left in ms, or 30 s with no deadline. 0 or less means the budget is spent: no git call starts.
  const left = () => (deadline ? Math.ceil(deadline - performance.now()) : 30_000);
  const spent = () => { out.note = 'time budget spent'; return out; };
  const main = mainBranch(root, left);
  if (!main) { if (left() <= 0) return spent(); out.note = 'no main or master branch'; return out; }
  const bounded = (cwd, args) => (left() > 0 ? git(cwd, args, left()) : { status: null, stdout: '' }); // a spent budget starts no git call
  const listed = bounded(root, ['worktree', 'list', '--porcelain']);
  if (listed.status !== 0) { if (left() <= 0) return spent(); out.note = 'git worktree list failed'; return out; }
  const merged = new Set(lines(bounded(root, ['branch', '--merged', main, '--format=%(refname:short)']).stdout));
  if (left() <= 0) return spent();
  let here = null;
  try { here = realpathSync.native(cwd); } catch { /* unknown working directory */ }
  for (const block of listed.stdout.split(/\r?\n\r?\n/)) {
    const fields = Object.fromEntries(lines(block).map((l) => { const i = l.indexOf(' '); return i < 0 ? [l, true] : [l.slice(0, i), l.slice(i + 1)]; }));
    if (!fields.worktree) continue;
    let path;
    try { path = realpathSync.native(fields.worktree); } catch { continue; }
    if (!homes.some((home) => inside(home, path))) continue; // main checkout, or outside the layout
    if (deadline && performance.now() > deadline) { out.note = 'time budget spent'; break; }
    const branch = typeof fields.branch === 'string' ? fields.branch.replace(/^refs\/heads\//, '') : null;
    const keep = (why) => out.kept.push({ path, branch, why });
    if (fields.locked) { keep('locked'); continue; }
    if (fields.prunable) { keep('prunable (missing on disk): run git worktree prune'); continue; }
    if (!branch) { keep('detached HEAD'); continue; }
    if (branch === main || !merged.has(branch)) { keep(branch === main ? 'on the main branch' : `branch ${branch} is not merged into ${main}`); continue; }
    if (here && (here === path || inside(path, here))) { keep('current working directory'); continue; }
    const status = bounded(path, ['status', '--porcelain', '--ignored']);
    if (status.status !== 0) { keep('git status failed'); continue; }
    const dirty = lines(status.stdout).find((l) => !l.startsWith('!! ') || !onlyLayoutStubs(path, l.slice(3)));
    if (dirty) { keep(`not clean: ${dirty.slice(0, 80)}`); continue; }
    // A worktree created in the last day may hold work its owner has not started to record.
    const gitFile = join(path, '.git');
    const mtimeOf = (file) => { try { return statSync(file).mtimeMs; } catch { return Infinity; } }; // unknown reads as new
    const newest = Math.max(mtimeOf(path), mtimeOf(gitFile));
    if (now - newest < MIN_AGE_MS) { keep('changed in the last 24 hours'); continue; }
    const item = { path, branch, files: 0, bytes: 0 };
    if (!quick) walk(path, (file, stat) => { item.files += 1; item.bytes += stat.isSymbolicLink() ? 0 : stat.size; });
    out.candidates.push(item);
    out.files += item.files;
    out.bytes += item.bytes;
  }
  return out;
}

export function scanBranches({ root }) {
  const main = mainBranch(root);
  if (!main) return { branches: [], note: 'no main or master branch' };
  const merged = new Set(lines(git(root, ['branch', '--merged', main, '--format=%(refname:short)']).stdout));
  const current = lines(git(root, ['branch', '--show-current']).stdout)[0];
  const checkedOut = new Set(lines(git(root, ['worktree', 'list', '--porcelain']).stdout).filter((l) => l.startsWith('branch ')).map((l) => l.slice(7).replace(/^refs\/heads\//, '')));
  const refs = lines(git(root, ['for-each-ref', '--format=%(refname:short)\t%(upstream:track)', 'refs/heads']).stdout);
  const branches = refs.map((l) => l.split('\t')).filter(([name, track]) => track === '[gone]' && merged.has(name) && name !== main && name !== current && !checkedOut.has(name)).map(([name]) => name);
  return { branches, note: null };
}

// ---- the SessionStart advisory ---------------------------------------------------------------

const ADVISORY_BYTES = 500 * 1024 * 1024;
const ADVISORY_RUNS = 30;

/**
 * One advisory line or null. At most once per 24 hours per repository (a stamp in the state folder,
 * written BEFORE the walk so a slow or failed check is not retried at every start), within a hard time
 * budget. A walk the budget cuts short is a lower bound, so the line says "at least". It never deletes.
 * @param {{ cwd: string, home?: string, now?: number, budgetMs?: number, env?: Record<string, string | undefined> }} opt
 */
export function cleanAdvisory({ cwd, home = stateHome(), now = Date.now(), budgetMs = 300, env = process.env }) {
  try {
    if (/^(off|0|false)$/i.test(env.CODE_OPS_CLEAN ?? '')) return null;
    const layout = resolveLayout(cwd, detectHost(env));
    if (!layout) return null;
    const root = layout.mainTop ?? layout.top;
    const stampDir = join(stateDir(home), 'clean-advisory');
    const stamp = join(stampDir, `${slugOf(root)}.stamp`);
    try { if (now - statSync(stamp).mtimeMs < DAY) return null; } catch { /* no stamp yet */ }
    try { mkdirSync(stampDir, { recursive: true }); writeFileSync(stamp, new Date(now).toISOString()); } catch { return null; } // never walk without a stamp
    const deadline = performance.now() + budgetMs;
    // Cheapest and most decisive first; the state walk takes whatever budget is left.
    // Every scan shares the one deadline. The worst case is the budget plus the unfinished step when it
    // passes: one directory read, or one git call, which `scanWorktrees` bounds by the time left.
    const runs = scanRuns({ root, now, light: true, deadline });
    const tmp = scanTmp({ root, now, deadline });
    const trees = scanWorktrees({ root, now, cwd, deadline, quick: true });
    const state = scanState({ home, now, deadline });
    const bytes = state.stores.reduce((sum, s) => sum + s.bytes, 0) + tmp.bytes;
    if (bytes <= ADVISORY_BYTES && runs.stale <= ADVISORY_RUNS && !trees.candidates.length) return null;
    const partial = state.truncated || runs.truncated || tmp.truncated ? 'at least ' : '';
    return `cleanup: ${partial}${formatBytes(bytes)} reclaimable, ${partial}${runs.stale} stale run folders; run \`co clean\` to see it`;
  } catch { return null; }
}

// ---- the command -----------------------------------------------------------------------------

const USAGE = [
  'usage: clean.mjs [--apply] [--scope state|tmp|runs|worktrees|branches]... [--store <name>]... [--older-than <days>] [--json] [--root <dir>] [--home <dir>]',
  '  a dry run is the default; --apply deletes only the scopes named with --scope',
  `  stores: ${Object.keys(STORES).join(', ')}`,
];
const usageError = (message) => { console.error([message, ...USAGE].join('\n')); return 2; };

function parse(argv) {
  const opt = { apply: false, json: false, scopes: [], stores: [], days: 0, root: null, home: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`); return v; };
    if (flag === '--apply') opt.apply = true;
    else if (flag === '--json') opt.json = true;
    else if (flag === '--scope') { const v = value(); if (!SCOPES.includes(v)) throw new Error(`unknown scope: ${v}`); opt.scopes.push(v); }
    else if (flag === '--store') { const v = value(); if (!Object.hasOwn(STORES, v)) throw new Error(`unknown store: ${v}`); opt.stores.push(v); }
    else if (flag === '--older-than') { const v = Number(value()); if (!Number.isFinite(v) || v <= 0) throw new Error('--older-than takes a positive number of days'); opt.days = v; }
    else if (flag === '--root') opt.root = resolve(value());
    else if (flag === '--home') opt.home = resolve(value());
    else throw new Error(`unknown argument: ${flag}`);
  }
  return opt;
}

// The lowest `--older-than` each selected scope accepts: the per-store thresholds, 2 days for tmp, 30 for runs.
function floorFor(scope, stores) {
  if (scope === 'state') return Math.max(...(stores.length ? stores : Object.keys(STORES)).map((s) => STORES[s].days));
  return scope === 'tmp' ? TMP_DAYS : scope === 'runs' ? RUNS_DAYS : 0;
}

function main(argv) {
  let opt;
  try { opt = parse(argv); } catch (error) { return usageError(error.message); }
  if (opt.apply && !opt.scopes.length) return usageError('--apply needs at least one explicit --scope');
  if (opt.stores.length && !(opt.scopes.length ? opt.scopes : SCOPES).includes('state')) return usageError('--store applies to the state scope');
  if (opt.apply && opt.stores.length && !opt.scopes.includes('state')) return usageError('--apply --store needs --scope state');
  const scopes = opt.scopes.length ? [...new Set(opt.scopes)] : SCOPES;
  for (const scope of scopes) {
    if (opt.days && opt.days < floorFor(scope, opt.stores)) return usageError(`--older-than ${opt.days} is below the ${floorFor(scope, opt.stores)}-day floor of scope ${scope}`);
  }
  const now = Date.now();
  const home = opt.home ?? stateHome();
  const layout = opt.root ? null : resolveLayout(process.cwd(), detectHost(process.env));
  const root = opt.root ?? (layout ? layout.mainTop ?? layout.top : null);
  const report = { dryRun: !opt.apply, scopes: [], failed: [] };
  const add = (entry) => report.scopes.push(entry);
  const apply = opt.apply;

  if (scopes.includes('state')) {
    const plan = scanState({ home, now, days: opt.days });
    const chosen = plan.stores.filter((s) => (opt.stores.length ? opt.stores.includes(s.name) : s.mode === 'auto'));
    const detail = plan.stores.filter((s) => s.files || Object.values(s.kept).some(Boolean)).map((s) => `${s.name}: ${s.files} files ${formatBytes(s.bytes)} (${s.mode}, ${s.days}d; kept ${s.kept.fresh} fresh, ${s.kept.lock} lock, ${s.kept.live} live, ${s.kept.unsettled} unsettled)`);
    const entry = { scope: 'state', files: plan.stores.reduce((n, s) => n + s.files, 0), bytes: plan.stores.reduce((n, s) => n + s.bytes, 0), rule: 'per-store age threshold; manual stores need --store <name>', detail };
    if (apply) {
      let removed = { files: 0, bytes: 0 };
      for (const store of chosen) {
        let items = store.items;
        if (store.name === 'digest') { const settled = settleDigest(items, store.root); items = [...settled.allowed, ...settled.others]; }
        const done = removeItems(items, store.root);
        removed = { files: removed.files + done.files, bytes: removed.bytes + done.bytes };
        report.failed.push(...done.failed);
      }
      entry.applied = removed;
    }
    add(entry);
  }
  if (scopes.includes('tmp')) {
    if (!root) add({ scope: 'tmp', files: 0, bytes: 0, rule: 'no repository', detail: [] });
    else {
      const plan = scanTmp({ root, now, days: Math.max(opt.days, TMP_DAYS) });
      const entry = { scope: 'tmp', files: plan.files, bytes: plan.bytes, rule: `files older than ${Math.max(opt.days, TMP_DAYS)} days under <host folder>/.tmp`, detail: [] };
      if (apply) {
        const removed = { files: 0, bytes: 0 };
        for (const tmp of plan.roots) {
          const done = removeItems(plan.items.filter((i) => i.root === tmp), tmp);
          removed.files += done.files; removed.bytes += done.bytes; report.failed.push(...done.failed);
        }
        entry.applied = removed;
      }
      add(entry);
    }
  }
  if (scopes.includes('runs')) {
    if (!root) add({ scope: 'runs', files: 0, bytes: 0, rule: 'no repository', detail: [] });
    else {
      const days = Math.max(opt.days, RUNS_DAYS);
      const plan = scanRuns({ root, now, days });
      const detail = [`kept: ${plan.kept.evidence} evidence, ${plan.kept.handoff} open handoff, ${plan.kept.cited} cited, ${plan.kept.recent} recent`];
      if (!plan.citationsChecked) detail.push('git ls-files failed, so every working run was kept');
      if (plan.unmarked.length) {
        detail.push(`unmarked (never removed): ${plan.unmarked.length} runs, ${formatBytes(plan.unmarked.reduce((n, r) => n + r.bytes, 0))}; handoff-state.mjs reads a missing mark as evidence`);
        detail.push('  to allow removal the operator marks a run: co run retention "<run dir>" working --operator');
        for (const run of plan.unmarked.sort((a, b) => b.bytes - a.bytes).slice(0, 3)) {
          detail.push(`  ${run.hasSession ? `co run retention "${fwd(relative(root, run.dir))}" working --operator` : `${fwd(relative(root, run.dir))} has no SESSION.json, so it cannot be marked`} (${formatBytes(run.bytes)})`);
        }
      }
      const entry = { scope: 'runs', files: plan.files, bytes: plan.bytes, rule: `retention: working, newest file over ${days} days, no open handoff, no tracked citation`, detail };
      if (apply) {
        const removed = { files: 0, bytes: 0 };
        for (const run of plan.candidates) {
          const done = removeItems(run.files, run.runs);
          removeTarget(run.dir, run.runs);
          removed.files += done.files; removed.bytes += done.bytes; report.failed.push(...done.failed);
        }
        entry.applied = removed;
      }
      add(entry);
    }
  }
  if (scopes.includes('worktrees')) {
    if (!root) add({ scope: 'worktrees', files: 0, bytes: 0, rule: 'no repository', detail: [] });
    else {
      const plan = scanWorktrees({ root, now });
      const detail = [...(plan.note ? [plan.note] : []), ...plan.kept.map((k) => `kept ${fwd(k.path)}: ${k.why}`), ...plan.candidates.map((c) => `removable ${fwd(c.path)} (branch ${c.branch} merged)`)];
      const entry = { scope: 'worktrees', files: plan.files, bytes: plan.bytes, rule: 'clean status incl. ignored, branch merged into main, not locked, detached, or the working directory', detail };
      if (apply) {
        const removed = { files: 0, bytes: 0 };
        for (const tree of plan.candidates) {
          const done = git(root, ['worktree', 'remove', tree.path]);
          if (done.status === 0) { removed.files += tree.files; removed.bytes += tree.bytes; } else report.failed.push(`${fwd(tree.path)}: git worktree remove failed: ${String(done.stderr).trim().slice(0, 120)}`);
        }
        entry.applied = removed;
      }
      add(entry);
    }
  }
  if (scopes.includes('branches')) {
    if (!root) add({ scope: 'branches', files: 0, bytes: 0, rule: 'no repository', detail: [] });
    else {
      const plan = scanBranches({ root });
      const detail = [...(plan.note ? [plan.note] : []), ...plan.branches.map((b) => `merged, upstream gone: ${b}`)];
      if (plan.branches.length) detail.push('ancestry can mislead after a squash merge: verify content before deleting a branch');
      if (apply) detail.push('branches are report-only: --apply --scope branches deleted nothing');
      add({ scope: 'branches', files: 0, bytes: 0, count: plan.branches.length, rule: 'report only: merged into main with the upstream gone', detail });
    }
  }

  const total = report.scopes.reduce((n, s) => ({ files: n.files + s.files, bytes: n.bytes + s.bytes }), { files: 0, bytes: 0 });
  if (opt.json) { console.log(JSON.stringify({ ...report, total }, null, 2)); return 0; }
  for (const s of report.scopes) {
    console.log(`${s.scope.padEnd(10)} ${String(s.files).padStart(7)} files ${formatBytes(s.bytes).padStart(9)}  rule: ${s.rule}${s.count !== undefined ? ` (${s.count} branches)` : ''}`);
    for (const line of s.detail) console.log(`  ${line}`);
    if (s.applied) console.log(`  removed ${s.applied.files} files, ${formatBytes(s.applied.bytes)}`);
  }
  console.log(`total      ${String(total.files).padStart(7)} files ${formatBytes(total.bytes).padStart(9)}  ${apply ? '(applied scopes listed above)' : 'dry run: nothing deleted; --apply --scope <name> deletes one scope'}`);
  for (const line of report.failed) console.log(`failed: ${line}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) process.exitCode = main(process.argv.slice(2));
