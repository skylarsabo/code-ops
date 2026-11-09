#!/usr/bin/env node
// `co ps`: reports code-ops related processes and, on request, ends the ones that are provably stray.
//
//   node scripts/procs.mjs [--json] [--all] [--sample <seconds>]
//                          [--reap [--older-than <minutes>] [--pid <n>]...]
//
// WHY: nothing in code-ops tracks a process. An operative's shell can leave a stuck child pinning a
// core (a `cat` or `python` heredoc), and a detached build leaves no registry. A tool that kills fails
// by killing a live session's work, another repository's process, or a process of the user's own, so
// every rule below keeps a process when it is unsure and says why.
//
// READ-ONLY is the default: one block per related process (origin, age, resident memory, CPU time,
// parent state, whether a live host owns it, the verdict and its evidence), the stale lock files, and
// a count. `--all` adds the other shell and node processes for context. `--sample <s>` takes a second
// snapshot and marks a process `busy` when its CPU time rose by at least 90 percent of the interval.
// `--reap` is the only way anything ends.
//
// A STRAY CANDIDATE is a process for which ALL of these hold (see `strayBlockers`):
//   1. its command line names a code-ops path, resolved and normalized (drive-letter case, separators),
//      never a substring match. Two roots count in every repository: the suite plugin cache and
//      `<repo top>/<host folder>/.tmp`. Only when the repository is a code-ops checkout (see
//      `isCodeOpsCheckout`: `plugins/code-ops-suite/.claude-plugin/plugin.json` names `code-ops-suite`)
//      does a path under its `scripts/`, `plugins/`, `evals/`, or `hooks/` folder count too. In any other
//      repository a user's own `scripts/`, `hooks/`, or `evals/` script is not related. A scratch folder
//      of ANOTHER repository is listed but never a candidate; a bare `cat` or `python` heredoc child is
//      listed as a suspect, and any other path is not code-ops related. An MCP server is a candidate
//      only when no live host started before it, because a live session owns its servers and only the
//      host's own start time shows that.
//   2. its parent is dead: the pid is absent, or now belongs to a process that started after the child
//      (a reused pid), or (POSIX) the process was reparented to init;
//   3. it does not descend from a live host (claude, codex, opencode, grok, copilot);
//   4. it is older than the threshold (default 30 minutes, never below 30 on the command line);
//   5. no process in its own tree started in the last 5 minutes (a tree still spawning is alive);
//   6. its tree holds no host process and nothing of this process (this process, its ancestors, or its
//      descendants).
// A launching shell that exited while its agent still works therefore stays a non-candidate while it
// is young or still spawning. A long quiet orphan can still qualify, which is why `--reap` is an
// explicit request and the listing shows the evidence first.
//
// `--reap` re-reads the table immediately before each kill and skips a pid whose start time, command
// line, or candidate status changed. `--reap --pid <n>` reaps one pid and only if it is a candidate;
// anything else is refused with the reason. Kills are by verified tree, top-down, one pid at a time:
// win32 `taskkill /PID <pid> /F` per pid (never `/T`, which walks parent pids with no start-time check),
// re-reading the table before each kill and skipping a pid whose start time or command line changed;
// POSIX SIGTERM to each verified pid, then SIGKILL after 3 seconds to the ones whose start time still
// matches. Never by name pattern, never a process group, never this process tree.
//
// LOCKS (report only; `co clean` owns removal): `recall/*/*/build.lock` files in the state folder whose
// recorded pid is dead, and `.git/*.lock` files, which record no pid.
//
// The table: win32 reads one `Get-CimInstance Win32_Process` through PowerShell; POSIX reads
// `ps -ww -eo pid,ppid,etimes,rss,time,args` (`etime` when `etimes` is missing). Both run as argument
// arrays with a timeout and kill on timeout. An unreadable table prints why and lists nothing (exit 0).
// `CODE_OPS_PROCS_READ_MS` sets that timeout in milliseconds (default 20000).
//
// `CODE_OPS_PROCS` of `off`, `0`, or `false` silences the SessionStart advisory (`procsAdvisory`, called
// by hooks/routing-card.mjs); the command always works. Command lines print cut to 160 characters with
// secret-looking arguments replaced by `<REDACTED:secret>`; the environment is never read or printed.
//
// Exit: 0 = done (a failed read or kill is listed, not escalated); 2 = usage error.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBytes } from './clean.mjs';
import { HOST_FOLDERS, detectHost, resolveLayout } from './workspace-layout.mjs';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
export const DEFAULT_STRAY_MIN = 30;
export const RECENT_TREE_MS = 5 * MIN; // a tree that started a process this recently is alive
export const BUSY_RATIO = 0.9;
const SKEW_MS = 2000; // `ps` start times are whole seconds
const HEREDOC_MIN_MS = 5 * MIN;
const CMD_MAX = 160;
const SELF = fileURLToPath(import.meta.url);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const stateHome = () => process.env.CODE_OPS_HOME || homedir();

// ---- reading the table ------------------------------------------------------------------------

const WIN_SCRIPT = [
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8;',
  '$ErrorActionPreference="Stop";',
  '$rows=@(Get-CimInstance Win32_Process | ForEach-Object {',
  '[pscustomobject]@{ p=[int]$_.ProcessId; pp=[int]$_.ParentProcessId; n=$_.Name;',
  's=$(if($_.CreationDate){[DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds()}else{$null});',
  'r=[int64]$_.WorkingSetSize; c=([double]$_.KernelModeTime+[double]$_.UserModeTime)/1e7; a=$_.CommandLine } });',
  'ConvertTo-Json -InputObject $rows -Compress',
].join(' ');

/** Parses the PowerShell JSON. Returns rows or null. @param {string} text */
export function parseWin32(text) {
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return null; }
  if (!Array.isArray(data)) data = data ? [data] : [];
  const rows = [];
  for (const d of data) {
    if (!Number.isInteger(d?.p) || d.p <= 0) continue;
    rows.push({ pid: d.p, ppid: Number.isInteger(d.pp) ? d.pp : 0, name: String(d.n ?? ''), startMs: Number.isFinite(d.s) ? d.s : null, rss: Number(d.r) || 0, cpu: Number(d.c) || 0, cmd: typeof d.a === 'string' ? d.a : '' });
  }
  return rows.length ? rows : null;
}

/** `[[dd-]hh:]mm:ss` or plain seconds, as seconds, or null. @param {string} text */
export function parseClock(text) {
  if (/^\d+$/.test(text)) return Number(text);
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)(?:\.\d+)?$/.exec(text);
  return m ? Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3]) * 60 + Number(m[4]) : null;
}

/** Parses `ps -eo pid,ppid,etimes|etime,rss,time,args` output taken at `now`. Returns rows or null. */
export function parsePosix(text, now) {
  const rows = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.*?)\s*$/.exec(line);
    if (!m) continue;
    const elapsed = parseClock(m[3]);
    const cpu = parseClock(m[5]);
    if (elapsed === null) continue;
    const cmd = m[6];
    const first = /^"[^"]*"|^\S+/.exec(cmd)?.[0] ?? '';
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), name: first.startsWith('[') ? first.replace(/^\[|\]$/g, '') : basename(first), startMs: now - elapsed * 1000, rss: Number(m[4]) * 1024, cpu: cpu ?? 0, cmd });
  }
  return rows.length ? rows : null;
}

const winExe = (name) => {
  const dir = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const full = join(dir, ...name.split('/'));
  return existsSync(full) ? full : basename(full);
};

/**
 * One snapshot of the process table: `{ ok, rows, ms, reason }`. Never throws. `run` replaces spawnSync
 * so a test can fake the platform's answer.
 * @param {{ platform?: string, timeoutMs?: number, run?: typeof spawnSync, now?: () => number }} [opt]
 */
export function readTable({ platform = process.platform, timeoutMs = Number(process.env.CODE_OPS_PROCS_READ_MS) || 20_000, run = spawnSync, now = Date.now } = {}) {
  const started = performance.now();
  const spawn = (cmd, args) => run(cmd, args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const fail = (reason) => ({ ok: false, rows: [], ms: Math.round(performance.now() - started), reason });
  try {
    if (platform === 'win32') {
      const r = spawn(winExe('WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT]);
      if (r.error) return fail(`powershell: ${r.error.code ?? r.error.message}`);
      if (r.status !== 0) return fail(`powershell exited ${r.status}`);
      const rows = parseWin32(String(r.stdout));
      return rows ? { ok: true, rows, ms: Math.round(performance.now() - started), reason: '' } : fail('powershell output was not a process list');
    }
    let last = 'ps failed';
    for (const elapsed of ['etimes', 'etime']) { // macOS has no etimes
      const at = now();
      const r = spawn('ps', ['-ww', '-eo', `pid,ppid,${elapsed},rss,time,args`]);
      if (r.error) return fail(`ps: ${r.error.code ?? r.error.message}`);
      const rows = r.status === 0 ? parsePosix(String(r.stdout), at) : null;
      if (rows) return { ok: true, rows, ms: Math.round(performance.now() - started), reason: '' };
      last = `ps exited ${r.status}`;
    }
    return fail(last);
  } catch (error) { return fail(String(error?.message ?? error).slice(0, 120)); }
}

// ---- redaction and display -------------------------------------------------------------------

// A name that holds a secret: a word containing one of the secret words, or `key` or `pass` as the whole
// name or its last part (`--key`, `NAME_KEY`, `--db-pass`). A bare `key` prefix is not enough (`keyboard`).
const SECRET_KEY = '(?:[\\w.-]*(?:token|secret|passw(?:or)?d|passwd|passphrase|pwd|api[-_]?key|apikey|access[-_]?key|auth(?:orization)?|credential|bearer)[\\w.-]*|(?:[\\w.-]*[_.-])?(?:key|pass))';
const SECRET = '<REDACTED:secret>';
const VALUE = '("[^"]*"|\'[^\']*\'|\\S+)';
// `-u`/`--user` as a flag (not inside a longer word or option), then its value, attached or separate.
const USER_FLAG = '(?<![\\w-])(?:-u|--user)(?:[=\\s]+|(?=[^\\s=-]))';
// Applied in order: `Bearer <value>` first, or `Authorization: Bearer <value>` would lose only the word Bearer.
// Over-redaction is accepted (`mkdir -p dir` loses `dir`); a leak is not.
const SECRET_PATTERNS = [
  [/(\b(?:Bearer|Basic)\s+)\S+/gi, `$1${SECRET}`],
  // `-u user:pass` and `--user user:pass` keep the user and redact the password, quoted or not.
  [new RegExp(`(${USER_FLAG}(["'])[^:"']*:)[^"']*\\2`, 'g'), `$1${SECRET}$2`],
  [new RegExp(`(${USER_FLAG}[^\\s:"']*:)[^\\s"']+`, 'g'), `$1${SECRET}`],
  // `-p x`, `-p=x`, and the attached `-px`; `--pass` and `--password` fall to the named-flag pattern below.
  [new RegExp(`((?<![\\w-])-p(?:[=\\s]+|(?=[^\\s=-])))${VALUE}`, 'g'), `$1${SECRET}`],
  [new RegExp(`(--?${SECRET_KEY}[=\\s]+)${VALUE}`, 'gi'), `$1${SECRET}`],
  [new RegExp(`(\\b${SECRET_KEY}\\s*[=:]\\s*)${VALUE}`, 'gi'), `$1${SECRET}`],
  // `scheme://user:pass@host`: the password may hold `/` or `@`, so it runs to the last `@` of the token.
  [/(:\/\/[^\s/:@]+:)\S*@/g, `$1${SECRET}@`],
];
const SECRET_SHAPES = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)/g;

/** A command line with secret-looking arguments replaced, cut to 160 characters. @param {string} cmd */
export function redact(cmd) {
  let out = String(cmd);
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  out = out.replace(SECRET_SHAPES, SECRET).replace(/\s+/g, ' ').trim();
  return out.length > CMD_MAX ? `${out.slice(0, CMD_MAX - 3)}...` : out;
}

const pad2 = (n) => String(n).padStart(2, '0');
export function fmtAge(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h${pad2(m % 60)}m` : `${Math.floor(h / 24)}d${pad2(h % 24)}h`;
}

// ---- classification ----------------------------------------------------------------------------

const HOST_NAME = /^(?:claude|codex|opencode|grok|copilot)$/;
const HOST_CMD = /[\\/]@anthropic-ai[\\/]claude-code[\\/]|[\\/]@openai[\\/]codex[\\/]|[\\/]opencode-ai[\\/]/i;
const SHELL_NAME = /^(?:bash|sh|zsh|dash|fish|ksh|pwsh|powershell|cmd)$/;
const CONTEXT_NAME = /^(?:node|bash|sh|zsh|dash|fish|ksh|pwsh|powershell|cmd|python[\d.]*|py|cat|git)$/;
const HEREDOC_NAME = /^(?:cat|python[\d.]*|py)$/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const HOST_TMP = new RegExp(`/(?:${Object.values(HOST_FOLDERS).map(escapeRe).join('|')})/\\.tmp/`);
// Under a code-ops checkout, only these folders hold code-ops' own scripts. Any other path under it can
// be the user's own process, so it is not code-ops related. Under any other repository none of them is.
const CODE_OPS_DIRS = ['scripts', 'plugins', 'evals', 'hooks'];
// What follows a code-ops root in a command line: a hook script, or an eval entry point.
const CACHE_HOOK_TAIL = /^[^\s"']*\/hooks\/[^/\s"']+\.mjs\b/;
const CHECKOUT_HOOK_TAIL = /^(?:plugins\/[^/\s"']+\/)?hooks\/[^/\s"']+\.mjs\b/;
const EVAL_TAIL = /^evals\/[^/\s"']+\/run\.mjs\b/;
const baseName = (name) => name.toLowerCase().replace(/\.exe$/, '');

/**
 * True when `root` is a code-ops checkout: `plugins/code-ops-suite/.claude-plugin/plugin.json` exists
 * and names `code-ops-suite`. That file ships in no other repository, so a user's own `scripts/`,
 * `hooks/`, or `evals/` folder never makes its repository look like one.
 * @param {string | null} root
 */
export function isCodeOpsCheckout(root) {
  if (!root) return false;
  try { return JSON.parse(readFileSync(join(root, 'plugins', 'code-ops-suite', '.claude-plugin', 'plugin.json'), 'utf8')).name === 'code-ops-suite'; } catch { return false; }
}

/** Lower-cases on win32, uses forward slashes, and turns an MSYS `/c/` prefix into `c:/`. */
export function normPath(text, win) {
  let s = String(text).replace(/\\/g, '/');
  if (win) s = s.toLowerCase().replace(/(^|[\s"'=(,;])\/([a-z])\//g, '$1$2:/');
  return s.replace(/\/+$/, '');
}

// The text after each `root/` in `cmd` that has a boundary character before it: one entry per mention.
function tailsOf(cmd, root) {
  const out = [];
  if (!root) return out;
  const needle = `${root}/`;
  for (let at = cmd.indexOf(needle); at !== -1; at = cmd.indexOf(needle, at + 1)) {
    if (at === 0 || /[\s"'=(,;]/.test(cmd[at - 1])) out.push(cmd.slice(at + needle.length));
  }
  return out;
}
const mentions = (cmd, root) => tailsOf(cmd, root).length > 0;

/**
 * Origin and scope of one row. `scope` is `repo`, `cache`, `other-tmp` (scratch of another repository),
 * or `none`. The origin names the evidence: suite-mcp, suite-hook, host-tmp-script, eval, suite-script,
 * git, heredoc, or other. A path under the repository root counts only for a code-ops checkout
 * (`ctx.checkout`); in any other repository only the plugin cache and its own host scratch folders do.
 */
function classify(row, ctx) {
  const name = baseName(row.name);
  const cmd = normPath(row.cmd, ctx.win);
  const inCheckout = ctx.checkout && mentions(cmd, ctx.root);
  const inScratch = ctx.scratch.some((s) => mentions(cmd, s));
  const inCache = ctx.cacheRoots.some((c) => mentions(cmd, c));
  let scope = 'none';
  if (inCheckout || inScratch) scope = 'repo';
  else if (inCache) scope = 'cache';
  else if (HOST_TMP.test(cmd)) scope = 'other-tmp';
  let origin = 'other';
  if (scope !== 'none') {
    const underRoot = inCheckout ? tailsOf(cmd, ctx.root) : [];
    // A hook script counts only under the plugin cache or a checkout's `plugins/<name>/hooks/`, never a bare `/hooks/`.
    const isHook = underRoot.some((t) => CHECKOUT_HOOK_TAIL.test(t)) || ctx.cacheRoots.some((c) => tailsOf(cmd, c).some((t) => CACHE_HOOK_TAIL.test(t)));
    if (/-mcp\.mjs\b/.test(cmd)) origin = 'suite-mcp';
    else if (name === 'git') origin = 'git';
    else if (isHook) origin = 'suite-hook';
    else if (inScratch || scope === 'other-tmp') origin = 'host-tmp-script';
    else if (underRoot.some((t) => EVAL_TAIL.test(t))) origin = 'eval';
    else if (inCache || (inCheckout && CODE_OPS_DIRS.some((d) => mentions(cmd, `${ctx.root}/${d}`)))) origin = 'suite-script';
    else { scope = 'none'; origin = 'other'; } // a path under the repository that is not code-ops: the user's own process
  } else if (name === 'git') origin = 'git';
  return { scope, origin, name };
}

const isBareHeredoc = (row, name) => {
  if (!HEREDOC_NAME.test(name)) return false;
  const rest = row.cmd.replace(/^\s*(?:"[^"]*"|\S+)\s*/, '');
  return rest === '' || rest === '-';
};

const isHost = (row) => HOST_NAME.test(baseName(row.name)) || HOST_CMD.test(row.cmd);

// ---- analysis ----------------------------------------------------------------------------------

/**
 * Classifies every row of one snapshot. Pure: no clock, no process, no file.
 * @param {Array<{pid:number,ppid:number,name:string,startMs:number|null,rss:number,cpu:number,cmd:string}>} rows
 * `checkout` says `root` is a code-ops checkout (`isCodeOpsCheckout`); it is false unless a caller proves it,
 * so by default only the plugin cache and `<root>/<host folder>/.tmp` count.
 * @param {{ now: number, thresholdMs?: number, root?: string|null, checkout?: boolean, cacheRoots?: string[], selfPid?: number, win?: boolean,
 *           prev?: typeof rows, intervalMs?: number }} opt
 */
export function analyze(rows, opt) {
  const win = opt.win ?? process.platform === 'win32';
  const thresholdMs = opt.thresholdMs ?? DEFAULT_STRAY_MIN * MIN;
  const root = opt.root ? normPath(opt.root, win) : null;
  const scratch = root ? [...new Set(Object.values(HOST_FOLDERS))].map((folder) => normPath(`${root}/${folder}/.tmp`, win)) : [];
  const ctx = { win, root, checkout: opt.checkout === true, scratch, cacheRoots: (opt.cacheRoots ?? []).map((c) => normPath(c, win)) };
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const prev = new Map((opt.prev ?? []).map((r) => [r.pid, r]));

  const parentState = (r) => {
    if (!r.ppid || r.ppid === r.pid) return 'none';
    if (!win && r.ppid === 1) return 'dead'; // reparented to init
    const parent = byPid.get(r.ppid);
    if (!parent) return 'dead';
    if (r.startMs !== null && parent.startMs !== null && parent.startMs > r.startMs + SKEW_MS) return 'dead'; // the pid was reused
    return 'alive';
  };
  const kids = new Map();
  for (const r of rows) if (parentState(r) === 'alive') (kids.get(r.ppid) ?? kids.set(r.ppid, []).get(r.ppid)).push(r);
  const descendants = (root) => {
    const out = [];
    const seen = new Set([root.pid]);
    for (const queue = [root]; queue.length;) {
      for (const kid of kids.get(queue.shift().pid) ?? []) if (!seen.has(kid.pid)) { seen.add(kid.pid); out.push(kid); queue.push(kid); }
    }
    return out;
  };
  const ancestors = (r) => {
    const out = [];
    for (let cur = r, i = 0; i < 64 && parentState(cur) === 'alive'; i++) { cur = byPid.get(cur.ppid); out.push(cur); }
    return out;
  };

  const selfRow = opt.selfPid ? byPid.get(opt.selfPid) : null;
  const selfSet = new Set(selfRow ? [selfRow.pid, ...ancestors(selfRow).map((r) => r.pid), ...descendants(selfRow).map((r) => r.pid)] : []);
  const hosts = rows.filter(isHost);

  const entries = rows.map((row) => {
    const { scope, origin: found, name } = classify(row, ctx);
    const parent = parentState(row);
    let origin = found;
    if (origin === 'other' && isBareHeredoc(row, name) && (parent === 'dead' || SHELL_NAME.test(baseName(byPid.get(row.ppid)?.name ?? '')))) origin = 'heredoc';
    const ageMs = row.startMs === null ? null : opt.now - row.startMs;
    const tree = [row, ...descendants(row)];
    const starts = tree.map((r) => r.startMs).filter((s) => s !== null);
    const newestAgeMs = starts.length ? opt.now - Math.max(...starts) : null;
    const underHost = ancestors(row).some(isHost);
    const before = prev.get(row.pid);
    let busy = null;
    if (before && before.startMs === row.startMs && opt.intervalMs > 0) busy = (row.cpu - before.cpu) * 1000 >= BUSY_RATIO * opt.intervalMs;
    const entry = { pid: row.pid, ppid: row.ppid, name, origin, scope, parent, underHost, ageMs, rss: row.rss, cpu: row.cpu, busy, tree: tree.length, treeRss: tree.reduce((n, r) => n + r.rss, 0), newestAgeMs, startMs: row.startMs, cmd: redact(row.cmd), stray: false, blockers: [], evidence: [] };
    Object.defineProperties(entry, { _raw: { value: row.cmd }, _tree: { value: tree } });
    entry.blockers = strayBlockers(entry, { tree, hosts, selfSet, thresholdMs, row, parentRow: byPid.get(row.ppid) });
    entry.stray = entry.blockers.length === 0;
    if (entry.stray) entry.evidence = [`parent ${row.ppid} ${win || row.ppid !== 1 ? 'not running or reused' : 'is init'}`, 'no live host above it', `age ${fmtAge(ageMs)} >= ${fmtAge(thresholdMs)}`, `${tree.length > 1 ? `newest of ${tree.length} processes` : 'alone'} started ${fmtAge(newestAgeMs)} ago`];
    return entry;
  });
  const related = (e) => e.scope !== 'none' || e.origin === 'heredoc';
  const order = (a, b) => (b.stray - a.stray) || ((b.busy === true) - (a.busy === true)) || ((b.ageMs ?? -1) - (a.ageMs ?? -1));
  entries.sort(order);
  return { entries, strays: entries.filter((e) => e.stray), related: entries.filter(related), context: entries.filter((e) => !related(e) && CONTEXT_NAME.test(e.name)), byPid: new Map(entries.map((e) => [e.pid, e])) };
}

// The reasons a process is NOT a stray candidate, each a short phrase. Empty means it is one.
function strayBlockers(e, { tree, hosts, selfSet, thresholdMs, row }) {
  const out = [];
  if (e.scope === 'none') out.push(e.origin === 'heredoc' ? 'a heredoc child carries no code-ops path, so it is reported only' : 'no code-ops path in its command line');
  else if (e.scope === 'other-tmp') out.push('scratch folder of another repository');
  if (e.origin === 'suite-mcp') {
    if (row.startMs === null || hosts.some((h) => h.startMs !== null && h.startMs <= row.startMs + SKEW_MS)) out.push('a live host that started before this MCP server may own it');
  }
  if (e.parent !== 'dead') out.push(`parent is ${e.parent === 'alive' ? 'alive' : 'unknown'}`);
  if (e.underHost) out.push('descends from a live host');
  if (e.ageMs === null) out.push('start time unknown');
  else if (e.ageMs < thresholdMs) out.push(`age ${fmtAge(e.ageMs)} is under ${fmtAge(thresholdMs)}`);
  if (e.newestAgeMs === null) out.push('tree start times unknown');
  else if (e.newestAgeMs < RECENT_TREE_MS) out.push(`its tree started a process ${fmtAge(e.newestAgeMs)} ago`);
  if (tree.some(isHost)) out.push('its tree holds a host process');
  if (tree.some((r) => selfSet.has(r.pid))) out.push('its tree holds this process');
  return out;
}

// ---- reaping -----------------------------------------------------------------------------------

// The same process as in the snapshot: same pid, start time within the table's resolution, same command
// line. An unknown start time never matches, so an unverifiable pid is skipped.
const sameProcess = (now, then) => !!now && now.pid === then.pid && now.startMs !== null && then.startMs !== null
  && Math.abs(now.startMs - then.startMs) <= SKEW_MS && now.cmd === then.cmd;

// One `taskkill /PID <pid> /F` per verified tree member, top-down, never `/T`: `/T` walks parent pids
// with no start-time check and can reach a process that reused a pid. The table is re-read before each
// kill; a pid that is gone is done, and a pid that changed or cannot be read is skipped.
function killWin(entry, { run = spawnSync, read = readTable } = {}) {
  let ended = 0;
  let skipped = 0;
  for (const member of entry._tree) {
    const fresh = read();
    const current = fresh.ok ? fresh.rows.find((r) => r.pid === member.pid) : undefined;
    if (fresh.ok && !current) continue; // already gone
    if (!sameProcess(current, member)) { skipped += 1; continue; }
    const r = run(winExe('taskkill.exe'), ['/PID', String(member.pid), '/F'], { encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (!r.error && r.status === 0) ended += 1; else skipped += 1;
  }
  return { ok: ended > 0, detail: `taskkill /F per verified pid: ${ended} ended, ${skipped} skipped` };
}

function killPosix(entry, { read = readTable } = {}) {
  const tree = entry._tree;
  let hit = 0;
  for (const r of tree) { try { process.kill(r.pid, 'SIGTERM'); hit += 1; } catch { /* already gone */ } }
  sleep(3000);
  const fresh = read();
  if (fresh.ok) {
    const alive = new Map(fresh.rows.map((r) => [r.pid, r]));
    for (const r of tree) {
      const now = alive.get(r.pid);
      if (now && now.startMs !== null && r.startMs !== null && Math.abs(now.startMs - r.startMs) <= SKEW_MS) { try { process.kill(r.pid, 'SIGKILL'); } catch { /* gone */ } }
    }
  }
  return { ok: hit > 0, detail: 'SIGTERM, then SIGKILL after 3 s' };
}

/**
 * The platform's tree kill: `taskkill /F` on each verified pid on win32, signals to each verified pid
 * elsewhere. `platform`, `run`, and `read` are injectable for a test.
 * @param {object} entry
 * @param {{ platform?: string, run?: typeof spawnSync, read?: typeof readTable }} [deps]
 */
export const killTree = (entry, deps = {}) => ((deps.platform ?? process.platform) === 'win32' ? killWin(entry, deps) : killPosix(entry, deps));

/**
 * Ends stray candidates, or the named `pids` when each is one. Reads the table, picks the targets, then
 * re-reads right before every kill and skips a pid whose start time, command line, or candidate status
 * changed. `read`, `kill`, and `now` are injectable. Returns `{ killed, skipped, refused, unreadable }`.
 * @param {{ read?: () => ReturnType<typeof readTable>, kill?: (entry: object) => {ok:boolean,detail:string}, now?: () => number,
 *           analysis: object, pids?: number[] }} opt `analysis` holds analyze's options except `now` and `prev`.
 */
export function reapStrays({ read = readTable, kill = killTree, now = Date.now, analysis, pids = [] }) {
  const out = { killed: [], skipped: [], refused: [], unreadable: '' };
  const first = read();
  if (!first.ok) { out.unreadable = first.reason; return out; }
  const plan = analyze(first.rows, { ...analysis, now: now() });
  let targets = plan.strays;
  if (pids.length) {
    targets = [];
    for (const pid of pids) {
      const e = plan.byPid.get(pid);
      if (!e) out.refused.push({ pid, reason: 'no such process' });
      else if (!e.stray) out.refused.push({ pid, reason: `not a stray candidate: ${e.blockers.join('; ')}` });
      else targets.push(e);
    }
  }
  for (const target of targets) {
    const again = read();
    if (!again.ok) { out.skipped.push({ pid: target.pid, reason: `table unreadable before the kill: ${again.reason}` }); continue; }
    const e = analyze(again.rows, { ...analysis, now: now() }).byPid.get(target.pid);
    if (!e) { out.skipped.push({ pid: target.pid, reason: 'already gone' }); continue; }
    if (e.startMs !== target.startMs || e._raw !== target._raw) { out.skipped.push({ pid: target.pid, reason: 'start time or command line changed' }); continue; }
    if (!e.stray) { out.skipped.push({ pid: target.pid, reason: `no longer a candidate: ${e.blockers.join('; ')}` }); continue; }
    const done = kill(e);
    (done.ok ? out.killed : out.skipped).push({ pid: e.pid, origin: e.origin, tree: e.tree, cmd: e.cmd, reason: done.detail });
  }
  return out;
}

// ---- stale locks -------------------------------------------------------------------------------

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };
const dirs = (dir) => { try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };

/**
 * Lock files that look abandoned. Recall locks record `{pid, at}`; a pid is dead when the table lacks it,
 * or holds a process that started after the lock was taken (a reused pid), or, with no table, when
 * signal 0 reports ESRCH. Git locks record no pid, so they are listed as `pid not recorded`.
 * Report only. @param {{ home: string, gitDir?: string|null, rows?: Array<object>|null, now: number }} opt
 */
export function staleLocks({ home, gitDir = null, rows = null, now }) {
  const byPid = rows ? new Map(rows.map((r) => [r.pid, r])) : null;
  const alive = (pid, at) => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (byPid) { const r = byPid.get(pid); return !!r && !(r.startMs !== null && Number.isFinite(at) && r.startMs > at + SKEW_MS); }
    try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
  };
  const out = { recall: { total: 0, dead: [] }, git: [] };
  const base = join(home, '.codex', 'code-ops', 'recall');
  for (const slug of dirs(base)) {
    for (const session of dirs(join(base, slug))) {
      const path = join(base, slug, session, 'build.lock');
      let stat;
      try { stat = statSync(path); } catch { continue; }
      out.recall.total += 1;
      const held = readJson(path);
      const at = Number.isFinite(held?.at) ? held.at : stat.mtimeMs;
      if (!alive(held?.pid, at)) out.recall.dead.push({ path, pid: Number.isInteger(held?.pid) ? held.pid : null, ageMs: now - at });
    }
  }
  if (gitDir) {
    const gitRunning = rows ? rows.some((r) => baseName(r.name) === 'git') : null;
    let names = [];
    try { names = readdirSync(gitDir).filter((n) => /\.lock$/.test(n)); } catch { /* no git dir */ }
    for (const name of names) {
      try { out.git.push({ path: join(gitDir, name), ageMs: now - statSync(join(gitDir, name)).mtimeMs, pid: null, note: gitRunning === false ? 'pid not recorded; no git process is running' : 'pid not recorded' }); } catch { /* gone */ }
    }
  }
  return out;
}

// ---- the SessionStart advisory -----------------------------------------------------------------

/** Plugin cache folders of the hosts that install code-ops (sync-global.mjs): Codex and Codex. @param {string} home */
export const cacheRootsOf = (home) => [join(home, '.codex', 'plugins', 'cache', 'code-ops'), join(home, '.codex', 'plugins', 'cache', 'code-ops')];

const repoRootOf = (cwd, env) => { const layout = resolveLayout(cwd, detectHost(env)); return layout ? layout.mainTop ?? layout.top : null; };

/**
 * One advisory line or null. At most once per 24 hours per machine (a stamp in the state folder, written
 * BEFORE the table read so a slow or failed read is not retried at every start). The read has a hard
 * timeout (default 2000 ms) and is killed on expiry. It never ends a process.
 * @param {{ cwd: string, home?: string, now?: number, timeoutMs?: number, env?: Record<string, string | undefined>, read?: typeof readTable }} opt
 */
export function procsAdvisory({ cwd, home = stateHome(), now = Date.now(), timeoutMs = 2000, env = process.env, read = readTable }) {
  try {
    if (/^(off|0|false)$/i.test(env.CODE_OPS_PROCS ?? '')) return null;
    const stampDir = join(home, '.codex', 'code-ops', 'procs-advisory');
    const stamp = join(stampDir, 'scan.stamp');
    try { if (now - statSync(stamp).mtimeMs < DAY) return null; } catch { /* no stamp yet */ }
    try { mkdirSync(stampDir, { recursive: true }); writeFileSync(stamp, new Date(now).toISOString()); } catch { return null; } // never read without a stamp
    const table = read({ timeoutMs });
    if (!table.ok) return null;
    const root = repoRootOf(cwd, env);
    const plan = analyze(table.rows, { now, root, checkout: isCodeOpsCheckout(root), cacheRoots: cacheRootsOf(home), selfPid: process.pid });
    if (!plan.strays.length) return null;
    const size = plan.strays.reduce((n, e) => n + e.treeRss, 0);
    return `processes: ${plan.strays.length} stray code-ops processes (${formatBytes(size)}); run \`co ps\``;
  } catch { return null; }
}

// ---- the command -------------------------------------------------------------------------------

const USAGE = [
  'usage: procs.mjs [--json] [--all] [--sample <seconds>] [--reap [--older-than <minutes>] [--pid <n>]...]',
  '  read-only unless --reap is given; --reap ends stray candidates only; --pid needs --reap',
  `  --older-than takes at least ${DEFAULT_STRAY_MIN} minutes; --sample takes 1 to 600 seconds`,
];
const usageError = (message) => { console.error([message, ...USAGE].join('\n')); return 2; };

function parse(argv) {
  const opt = { json: false, all: false, sample: 0, reap: false, olderThan: DEFAULT_STRAY_MIN, pids: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`); return v; };
    if (flag === '--json') opt.json = true;
    else if (flag === '--all') opt.all = true;
    else if (flag === '--reap') opt.reap = true;
    else if (flag === '--sample') { const v = Number(value()); if (!Number.isFinite(v) || v < 1 || v > 600) throw new Error('--sample takes 1 to 600 seconds'); opt.sample = v; }
    else if (flag === '--older-than') { const v = Number(value()); if (!Number.isFinite(v) || v < DEFAULT_STRAY_MIN) throw new Error(`--older-than takes at least ${DEFAULT_STRAY_MIN} minutes`); opt.olderThan = v; }
    else if (flag === '--pid') { const raw = value(); const v = Number(raw); if (!/^\d+$/.test(raw) || v <= 0) throw new Error('--pid takes a positive process id'); opt.pids.push(v); }
    else throw new Error(`unknown argument: ${flag}`);
  }
  if (opt.pids.length && !opt.reap) throw new Error('--pid needs --reap');
  return opt;
}

const mb = (bytes) => formatBytes(bytes);
function entryLines(e) {
  const verdict = e.stray ? `STRAY${e.busy ? ' busy' : ''}` : `kept${e.busy ? ' busy' : ''}`;
  const why = e.stray ? e.evidence.join('; ') : e.blockers.slice(0, 2).join('; ');
  const fields = [`pid ${e.pid}`, e.origin, `age ${e.ageMs === null ? '?' : fmtAge(e.ageMs)}`, `rss ${mb(e.rss)}`, `cpu ${fmtAge(e.cpu * 1000)}`, `parent ${e.parent}`, `host ${e.underHost ? 'yes' : 'no'}`, ...(e.tree > 1 ? [`tree ${e.tree}`] : [])];
  return [`${verdict.padEnd(11)}${fields.join(' | ')}`, `           ${e.cmd}`, `           ${e.stray ? 'because' : 'kept because'}: ${why}`];
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE.join('\n')); return 0; }
  let opt;
  try { opt = parse(argv); } catch (error) { return usageError(error.message); }
  const env = process.env;
  const home = stateHome();
  const root = repoRootOf(process.cwd(), env);
  const analysis = { thresholdMs: opt.olderThan * MIN, root, checkout: isCodeOpsCheckout(root), cacheRoots: cacheRootsOf(home), selfPid: process.pid };
  const table = readTable();
  let plan = null;
  if (table.ok) {
    let prev;
    let intervalMs = 0;
    let rows = table.rows;
    if (opt.sample) {
      sleep(opt.sample * 1000);
      const second = readTable();
      if (second.ok) { prev = table.rows; rows = second.rows; intervalMs = opt.sample * 1000; }
    }
    plan = analyze(rows, { ...analysis, now: Date.now(), prev, intervalMs });
  }
  const gitDirOf = () => { const layout = resolveLayout(process.cwd(), detectHost(env)); const top = layout ? layout.mainTop ?? layout.top : null; return top && existsSync(join(top, '.git', 'HEAD')) ? join(top, '.git') : null; };
  const locks = staleLocks({ home, gitDir: gitDirOf(), rows: table.ok ? table.rows : null, now: Date.now() });
  const shown = plan ? [...plan.related, ...(opt.all ? plan.context : [])].sort((a, b) => (b.stray - a.stray) || ((b.busy === true) - (a.busy === true)) || ((b.ageMs ?? -1) - (a.ageMs ?? -1))) : [];
  let reaped = null;
  if (opt.reap) reaped = reapStrays({ analysis, pids: opt.pids });

  if (opt.json) {
    console.log(JSON.stringify({ table: { ok: table.ok, count: table.rows.length, ms: table.ms, reason: table.reason }, thresholdMinutes: opt.olderThan, processes: shown, strays: plan ? plan.strays.map((e) => e.pid) : [], locks, reaped }, null, 2));
    return 0;
  }
  if (!table.ok) console.log(`process table unreadable: ${table.reason}; nothing listed`);
  else {
    console.log(`processes: ${table.rows.length} read in ${table.ms} ms; ${plan.related.length} code-ops related, ${plan.strays.length} stray candidates (older than ${fmtAge(opt.olderThan * MIN)}, parent dead, no live host)`);
    // MCP servers of live sessions are routine: one summary line, in full only with --all.
    const routine = (e) => !opt.all && !e.stray && e.origin === 'suite-mcp' && e.parent === 'alive' && e.underHost;
    const quiet = shown.filter(routine);
    for (const e of shown) if (!routine(e)) for (const line of entryLines(e)) console.log(line);
    if (quiet.length) console.log(`kept       ${quiet.length} suite MCP servers of live sessions (${mb(quiet.reduce((n, e) => n + e.rss, 0))}); --all lists them`);
  }
  const dead = locks.recall.dead;
  if (dead.length) {
    console.log(`locks: ${dead.length} of ${locks.recall.total} recall build.lock files name a dead pid (oldest ${fmtAge(Math.max(...dead.map((l) => l.ageMs)))}); \`co clean\` owns removal`);
    for (const l of dead.slice(0, 3)) console.log(`           ${l.path.replace(/\\/g, '/')} pid ${l.pid ?? '?'} age ${fmtAge(l.ageMs)}`);
  }
  for (const l of locks.git) console.log(`locks: ${l.path.replace(/\\/g, '/')} age ${fmtAge(l.ageMs)} (${l.note})`);
  if (reaped) {
    if (reaped.unreadable) console.log(`reap: process table unreadable (${reaped.unreadable}); nothing killed`);
    for (const k of reaped.killed) console.log(`killed pid ${k.pid} (${k.tree} process${k.tree === 1 ? '' : 'es'}, ${k.origin}): ${k.reason}`);
    for (const s of reaped.skipped) console.log(`skipped pid ${s.pid}: ${s.reason}`);
    for (const r of reaped.refused) console.log(`refused pid ${r.pid}: ${r.reason}`);
    console.log(`reaped ${reaped.killed.length}, skipped ${reaped.skipped.length}, refused ${reaped.refused.length}`);
  } else if (plan) console.log(`read-only: nothing was killed; \`co ps --reap\` ends stray candidates only${plan.strays.length ? '' : ' (none now)'}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) process.exitCode = main(process.argv.slice(2));
