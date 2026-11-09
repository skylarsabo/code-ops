#!/usr/bin/env node
// Regression eval for scripts/procs.mjs (`co ps`) and the stray-process advisory in
// hooks/routing-card.mjs. Most checks run the pure core over a synthetic process table, so they start no
// process. A few start real children from the OS temp folder to pin the platform read and the reap:
// every child sleeps by itself for 90 seconds at most, and the eval ends only pids it spawned
// (a guarded kill refuses any other pid, and the final cleanup re-checks each pid's command line).
// It pins the contract:
//   - a process whose parent is alive is not a stray candidate; an old orphan with a code-ops path is;
//   - an orphan outside code-ops paths, a user's own path under the repository, another repository's
//     scratch, a young orphan (the launching shell that exited while its agent works), and an orphan
//     whose tree started a process in the last 5 minutes are not;
//   - a reused parent pid does not look alive; POSIX reparenting to init reads as a dead parent;
//   - an MCP server is a candidate only when no live host started before it;
//   - a tree that holds a host, or this process, is never a candidate;
//   - outside a code-ops checkout (marker: `plugins/code-ops-suite/.claude-plugin/plugin.json` naming
//     `code-ops-suite`) a user's `scripts/`, `hooks/`, and `evals/` command lines are neither related nor
//     candidates; only the plugin cache and `<repo>/<host folder>/.tmp` count, and a bare `/hooks/` in a
//     command line labels nothing;
//   - a secret-looking argument is redacted (`-p`, `--pass` and `--password` forms, `-u user:pass`, the
//     named flags with a space or `=`, Authorization headers, URL passwords, NAME_TOKEN/KEY/SECRET/PASSWORD
//     assignments) and a command line is cut to 160 characters;
//   - `--reap` ends the fixture stray and nothing else; `--reap --pid` on a non-candidate is refused;
//     a changed start time, a changed command line, or a tree that started a child skips the kill;
//   - the win32 kill is one `taskkill /PID <pid> /F` per verified tree pid, never `/T`, re-reading the
//     table before each and never passing a pid outside the tree (a reused pid included);
//   - an unreadable table fails soft (exit 0, nothing listed, nothing killed); usage errors exit 2;
//   - the advisory fires once per 24 hours, honors `CODE_OPS_PROCS=off`, reads with a 2-second timeout.
//
//   node evals/procs/run.mjs

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_FOLDERS } from '../../scripts/workspace-layout.mjs';
import { RECENT_TREE_MS, analyze, isCodeOpsCheckout, killTree, normPath, parseClock, parsePosix, parseWin32, procsAdvisory, readTable, reapStrays, redact, staleLocks } from '../../scripts/procs.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const cli = join(repoRoot, 'scripts', 'procs.mjs');
const { fails, check } = tally((name, detail) => `${name} — ${String(detail).slice(0, 300)}`);
const MIN = 60_000;
const SCRATCH = HOST_FOLDERS.other; // a folder name that is not a host's own, so the fixtures stay generic
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'procs-eval-')));

// ---- a synthetic table ------------------------------------------------------------------------

const NOW = Date.now(); // real, so a stamp file written now reads as fresh
const ROOT = '/work/repo';
const CACHE = '/home/u/.claude/plugins/cache/code-ops';
let nextPid = 1000;
// A row that started `age` minutes ago. `cpu` is seconds of CPU time.
const row = (name, cmd, { age = 60, ppid = 1, pid = nextPid++, cpu = 0, rss = 10 * 1024 * 1024 } = {}) => ({ pid, ppid, name, startMs: NOW - age * MIN, rss, cpu, cmd });
const opts = (extra = {}) => ({ now: NOW, root: ROOT, checkout: true, cacheRoots: [CACHE], selfPid: 99999, win: false, ...extra });
const scratchCmd = (file = 'job.mjs') => `node ${ROOT}/${SCRATCH}/.tmp/${file}`;
const verdict = (rows, pid, extra) => analyze(rows, opts(extra)).byPid.get(pid);
// A live parent pid that is not init, so POSIX reparenting does not apply: the row exists in the table.
const shell = (age = 120) => row('bash', 'bash -l', { age, ppid: 5 });
const dead = 4242; // a parent pid that no row holds

// ---- classification: candidate or not ---------------------------------------------------------

{
  const sh = shell();
  const child = row('node', scratchCmd(), { age: 90, ppid: sh.pid });
  check('a child whose parent is alive is not a candidate', !verdict([sh, child], child.pid).stray && verdict([sh, child], child.pid).parent === 'alive', '');
  const orphan = row('node', scratchCmd(), { age: 90, ppid: dead });
  const e = verdict([orphan], orphan.pid);
  check('an old orphan with a scratch-folder path is a candidate, with its evidence', e.stray && e.origin === 'host-tmp-script' && e.evidence.length === 4, JSON.stringify(e.blockers));
  const hook = row('node', `node ${CACHE}/code-ops-suite/2.86.0/hooks/recall-spawn.mjs`, { age: 90, ppid: dead });
  check('an old orphan under the suite plugin cache is a candidate (origin suite-hook)', verdict([hook], hook.pid).stray && verdict([hook], hook.pid).origin === 'suite-hook', '');
  const evalRun = row('node', `node ${ROOT}/evals/clean/run.mjs`, { age: 90, ppid: dead });
  check('an old orphan eval run under the repository is a candidate (origin eval)', verdict([evalRun], evalRun.pid).stray && verdict([evalRun], evalRun.pid).origin === 'eval', '');
  const outside = row('node', 'node /elsewhere/job.mjs', { age: 90, ppid: dead });
  check('an orphan outside code-ops paths is not a candidate', !verdict([outside], outside.pid).stray, '');
  const mine = row('node', `node ${ROOT}/src/server.js`, { age: 90, ppid: dead });
  check('a path under the repository that is not code-ops is the user\'s own and is not related', !verdict([mine], mine.pid).stray && verdict([mine], mine.pid).scope === 'none', '');
  const other = row('node', `node /other/repo/${SCRATCH}/.tmp/x.mjs`, { age: 90, ppid: dead });
  const oe = verdict([other], other.pid);
  check('another repository\'s scratch script is listed but never a candidate', !oe.stray && oe.scope === 'other-tmp' && oe.origin === 'host-tmp-script', JSON.stringify(oe.blockers));
  const sibling = row('node', `node ${ROOT}2/${SCRATCH}/.tmp/x.mjs`, { age: 90, ppid: dead });
  check('a path prefix without a slash boundary does not match the repository', verdict([sibling], sibling.pid).scope === 'other-tmp', '');
  const young = row('node', scratchCmd(), { age: 10, ppid: dead });
  check('a young orphan (the launching shell exited, the agent still works) is not a candidate', !verdict([young], young.pid).stray && /under 30m/.test(verdict([young], young.pid).blockers.join()), '');
  const root = row('node', scratchCmd('gate.mjs'), { age: 90, ppid: dead });
  const fresh = row('node', 'node build.mjs', { age: 2, ppid: root.pid });
  check('an orphan whose tree started a child 2 minutes ago is not a candidate', !verdict([root, fresh], root.pid).stray && /tree started/.test(verdict([root, fresh], root.pid).blockers.join()), '');
  const stale = row('node', 'node build.mjs', { age: 80, ppid: root.pid });
  check('an orphan whose whole tree is old is a candidate, and its tree size is counted', verdict([root, stale], root.pid).stray && verdict([root, stale], root.pid).tree === 2, '');
  const edge = row('node', scratchCmd('edge.mjs'), { age: 90, ppid: dead });
  const justUnder = row('node', 'x', { age: RECENT_TREE_MS / MIN - 0.1, ppid: edge.pid });
  check('the 5-minute tree rule keeps an orphan just under it', !verdict([edge, justUnder], edge.pid).stray, '');
  const hostRow = row('claude.exe', 'claude.exe', { age: 300, ppid: 3 });
  const inHost = row('node', scratchCmd('host.mjs'), { age: 90, ppid: dead });
  const hostKid = row('claude.exe', 'claude.exe', { age: 80, ppid: inHost.pid });
  check('a tree that holds a host process is never a candidate', !verdict([hostRow, inHost, hostKid], inHost.pid).stray && /host process/.test(verdict([hostRow, inHost, hostKid], inHost.pid).blockers.join()), '');
  const self = row('node', 'node evals/procs/run.mjs', { age: 80, ppid: inHost.pid, pid: 99999 });
  check('a tree that holds this process is never a candidate', !verdict([inHost, self], inHost.pid).stray && /this process/.test(verdict([inHost, self], inHost.pid).blockers.join()), '');
  const underHostKid = row('node', scratchCmd('uh.mjs'), { age: 90, ppid: hostRow.pid });
  check('a descendant of a live host is not a candidate', !verdict([hostRow, underHostKid], underHostKid.pid).stray && verdict([hostRow, underHostKid], underHostKid.pid).underHost, '');
}

// ---- scope: a code-ops checkout versus any other repository -----------------------------------

{
  const userLines = [`node ${ROOT}/app/scripts/dev-server.mjs`, `node ${ROOT}/app/src/hooks/build.mjs`, `node ${ROOT}/app/evals/x/run.mjs`,
    `node ${ROOT}/scripts/gate.mjs`, `node ${ROOT}/hooks/a.mjs`, `node ${ROOT}/plugins/p/hooks/a.mjs`, `node ${ROOT}/evals/x/run.mjs`];
  const userRows = userLines.map((cmd) => row('node', cmd, { age: 90, ppid: dead }));
  for (const [label, extra] of [['checkout false', { checkout: false }], ['checkout absent', { checkout: undefined }]]) {
    const plan = analyze(userRows, opts(extra));
    check(`${label}: a user's scripts, hooks, and evals folders are neither related nor candidates`,
      userRows.every((r) => { const e = plan.byPid.get(r.pid); return e.scope === 'none' && !e.stray && !plan.related.includes(e) && !plan.strays.includes(e); }), JSON.stringify(plan.entries.map((e) => [e.pid, e.scope, e.stray])));
  }
  const own = row('node', scratchCmd('own.mjs'), { age: 90, ppid: dead });
  const cached = row('node', `node ${CACHE}/code-ops-suite/2.86.0/hooks/recall-spawn.mjs`, { age: 90, ppid: dead });
  const plan = analyze([own, cached], opts({ checkout: false }));
  check('not a checkout: the repository\'s own host scratch folder and the plugin cache still count', plan.byPid.get(own.pid).stray && plan.byPid.get(cached.pid).stray && plan.byPid.get(cached.pid).origin === 'suite-hook', JSON.stringify(plan.entries.map((e) => [e.pid, e.scope, e.origin, e.blockers])));
  // The hooks pattern is anchored: a `/hooks/` argument beside a real code-ops path labels nothing.
  const strayHook = row('node', `${scratchCmd('x.mjs')} /elsewhere/hooks/a.mjs`, { age: 90, ppid: dead });
  const cacheArg = row('node', `node ${CACHE}/code-ops-suite/2.86.0/scripts/x.mjs /elsewhere/hooks/a.mjs`, { age: 90, ppid: dead });
  const labelled = analyze([strayHook, cacheArg], opts({ checkout: false }));
  check('a bare /hooks/ in another argument is not a hook', labelled.byPid.get(strayHook.pid).origin === 'host-tmp-script' && labelled.byPid.get(cacheArg.pid).origin === 'suite-script', JSON.stringify(labelled.entries.map((e) => e.origin)));
  const inCheckout = [
    row('node', `node ${ROOT}/plugins/code-ops-suite/hooks/a.mjs`, { age: 90, ppid: dead }), row('node', `node ${ROOT}/evals/x/run.mjs`, { age: 90, ppid: dead }),
    row('node', `node ${ROOT}/scripts/gate.mjs`, { age: 90, ppid: dead }), row('node', `node ${ROOT}/app/hooks/build.mjs`, { age: 90, ppid: dead }),
    row('node', `node ${ROOT}/app/evals/x/run.mjs`, { age: 90, ppid: dead }),
  ];
  const co = analyze(inCheckout, opts());
  check('a code-ops checkout: its plugin hook, eval, and script are candidates with their origins; a nested app/ folder is not code-ops',
    co.byPid.get(inCheckout[0].pid).origin === 'suite-hook' && co.byPid.get(inCheckout[1].pid).origin === 'eval' && co.byPid.get(inCheckout[2].pid).origin === 'suite-script'
    && inCheckout.slice(0, 3).every((r) => co.byPid.get(r.pid).stray) && inCheckout.slice(3).every((r) => co.byPid.get(r.pid).scope === 'none' && !co.byPid.get(r.pid).stray),
    JSON.stringify(co.entries.map((e) => [e.pid, e.scope, e.origin])));

  // Real folders: the marker decides, and a fixture checkout classifies its own scratch, script, and cache processes.
  const marker = (dir, text) => { mkdirSync(join(dir, 'plugins', 'code-ops-suite', '.claude-plugin'), { recursive: true }); writeFileSync(join(dir, 'plugins', 'code-ops-suite', '.claude-plugin', 'plugin.json'), text); return dir; };
  const checkout = marker(join(base, 'co-checkout'), '{"name":"code-ops-suite","version":"1.0.0"}');
  const lookalike = marker(join(base, 'co-lookalike'), '{"name":"my-app"}');
  const broken = marker(join(base, 'co-broken'), 'not json');
  mkdirSync(join(base, 'co-plain', 'scripts'), { recursive: true });
  check('isCodeOpsCheckout: the suite plugin manifest names code-ops-suite; a lookalike, a broken file, a plain repository, and null are not',
    isCodeOpsCheckout(checkout) && !isCodeOpsCheckout(lookalike) && !isCodeOpsCheckout(broken) && !isCodeOpsCheckout(join(base, 'co-plain')) && !isCodeOpsCheckout(join(base, 'missing')) && !isCodeOpsCheckout(null), '');
  const win = process.platform === 'win32';
  const fwd = (p) => p.replace(/\\/g, '/');
  const fixtureRows = (dir) => [row('node', `node ${fwd(dir)}/${SCRATCH}/.tmp/job.mjs`, { age: 90, ppid: dead }), row('node', `node ${fwd(dir)}/scripts/tool.mjs`, { age: 90, ppid: dead }),
    row('node', `node ${CACHE}/code-ops-suite/2.86.0/hooks/h.mjs`, { age: 90, ppid: dead })];
  const real = fixtureRows(checkout);
  const checkoutPlan = analyze(real, { now: NOW, root: checkout, checkout: isCodeOpsCheckout(checkout), cacheRoots: [CACHE], selfPid: 99999, win });
  check('a real code-ops checkout fixture classifies its own .tmp, script, and plugin-cache processes as candidates', real.every((r) => checkoutPlan.byPid.get(r.pid).stray), JSON.stringify(checkoutPlan.entries.map((e) => [e.scope, e.origin, e.blockers])));
  const other = fixtureRows(lookalike);
  const otherPlan = analyze(other, { now: NOW, root: lookalike, checkout: isCodeOpsCheckout(lookalike), cacheRoots: [CACHE], selfPid: 99999, win });
  check('a repository without the marker keeps only its .tmp and the plugin cache; its scripts folder is not code-ops', otherPlan.byPid.get(other[0].pid).stray && otherPlan.byPid.get(other[2].pid).stray && otherPlan.byPid.get(other[1].pid).scope === 'none' && !otherPlan.byPid.get(other[1].pid).stray, JSON.stringify(otherPlan.entries.map((e) => [e.scope, e.origin])));
}

// ---- parent state: pid reuse and reparenting --------------------------------------------------

{
  const reused = row('bash', 'bash', { age: 10, ppid: 5, pid: 7001 }); // started AFTER the child
  const child = row('node', scratchCmd('reuse.mjs'), { age: 90, ppid: 7001 });
  check('a reused parent pid (started after the child) does not look alive', verdict([reused, child], child.pid).parent === 'dead' && verdict([reused, child], child.pid).stray, '');
  const real = row('bash', 'bash', { age: 200, ppid: 5, pid: 7002 });
  const kid = row('node', scratchCmd('real.mjs'), { age: 90, ppid: 7002 });
  check('an older parent with the same pid is alive', verdict([real, kid], kid.pid).parent === 'alive', '');
  const init = row('init', 'init', { age: 9000, ppid: 0, pid: 1 });
  const posixOrphan = row('node', scratchCmd('init.mjs'), { age: 90, ppid: 1 });
  check('POSIX: a process reparented to init has a dead parent', verdict([init, posixOrphan], posixOrphan.pid).parent === 'dead' && verdict([init, posixOrphan], posixOrphan.pid).stray, '');
  check('win32: pid 1 is not special', verdict([init, posixOrphan], posixOrphan.pid, { win: true }).parent === 'alive', '');
}

// ---- MCP servers ------------------------------------------------------------------------------

{
  const host = row('claude.exe', 'claude.exe', { age: 500, ppid: 3 });
  const mcp = row('node', `node ${CACHE}/code-ops-suite/2.86.0/scripts/lib-docs-mcp.mjs`, { age: 120, ppid: dead });
  check('an MCP server is not a candidate while a live host started before it', !verdict([host, mcp], mcp.pid).stray, '');
  const later = row('claude.exe', 'claude.exe', { age: 5, ppid: 3 });
  check('an MCP server is a candidate only when every live host started after it', verdict([later, mcp], mcp.pid).stray, '');
  const live = row('node', `node ${CACHE}/code-ops-suite/2.86.0/scripts/context-query-mcp.mjs`, { age: 120, ppid: host.pid });
  check('an MCP server of a live session is never a candidate', !verdict([host, live], live.pid).stray && verdict([host, live], live.pid).underHost, '');
}

// ---- heredoc suspects and busy ----------------------------------------------------------------

{
  const sh = shell();
  const cat = row('cat', 'cat', { age: 40, ppid: sh.pid });
  const e = verdict([sh, cat], cat.pid);
  const both = analyze([sh, cat], opts());
  check('a bare cat child of a shell is a heredoc suspect and never a candidate', e.origin === 'heredoc' && !e.stray && both.related.some((r) => r.pid === cat.pid), '');
  const reading = row('cat', 'cat notes.txt', { age: 40, ppid: sh.pid });
  check('cat with an argument is not a heredoc suspect', verdict([sh, reading], reading.pid).origin === 'other', '');
  const py = row('python3', 'python3 -', { age: 40, ppid: sh.pid });
  check('python reading stdin is a heredoc suspect', verdict([sh, py], py.pid).origin === 'heredoc', '');

  const a = row('node', scratchCmd('a.mjs'), { age: 90, ppid: dead, cpu: 100 });
  const b = row('node', scratchCmd('b.mjs'), { age: 120, ppid: dead, cpu: 50 });
  const before = [{ ...a, cpu: 70 }, { ...b, cpu: 50 }];
  const sampled = analyze([a, b], opts({ prev: before, intervalMs: 30_000 }));
  check('--sample marks a process busy when its CPU time rose by 90 percent of the interval', sampled.byPid.get(a.pid).busy === true && sampled.byPid.get(b.pid).busy === false, '');
  check('a busy stray is listed first, ahead of an older idle one', sampled.strays[0].pid === a.pid, sampled.strays.map((s) => s.pid).join());
  check('without a sample busy is unknown', analyze([a], opts()).byPid.get(a.pid).busy === null, '');
}

// ---- redaction and display --------------------------------------------------------------------

{
  const cases = [
    ['node job.mjs --token abc123xyz', 'abc123xyz'],
    ['node job.mjs --api-key=hunter2hunter2', 'hunter2hunter2'],
    ['node job.mjs password=swordfish', 'swordfish'],
    ['node job.mjs --client-secret "two words"', 'two words'],
    // `-p`, the `--pass` family, `-u user:pass`, the named flags in both forms, a Basic header, a URL password with `/`, and NAME_* assignments.
    ['node job.mjs -p hunter2pw', 'hunter2pw'],
    ['node job.mjs -p=hunter2pw', 'hunter2pw'],
    ['mysql -phunter2pw db', 'hunter2pw'],
    ['node job.mjs --pass hunter2pw', 'hunter2pw'],
    ['node job.mjs --pass=hunter2pw', 'hunter2pw'],
    ['node job.mjs --password hunter2pw', 'hunter2pw'],
    ['node job.mjs --password=hunter2pw', 'hunter2pw'],
    ['node job.mjs --passwd hunter2pw', 'hunter2pw'],
    ['node job.mjs --passwd=hunter2pw', 'hunter2pw'],
    ['curl -u alice:s3cretpw https://example.invalid', 's3cretpw'],
    ['curl -ualice:s3cretpw https://example.invalid', 's3cretpw'],
    ['curl --user alice:s3cretpw https://example.invalid', 's3cretpw'],
    ['curl --user=alice:s3cretpw https://example.invalid', 's3cretpw'],
    ['curl -u "alice:s3cret pw" https://example.invalid', 'pw"'],
    ['curl -u "alice:s3cret pw" https://example.invalid', 's3cret'],
    ['node job.mjs --token tok3nvalue', 'tok3nvalue'],
    ['node job.mjs --token=tok3nvalue', 'tok3nvalue'],
    ['node job.mjs --secret s3cr3tvalue', 's3cr3tvalue'],
    ['node job.mjs --secret=s3cr3tvalue', 's3cr3tvalue'],
    ['node job.mjs --api-key k3yvalue', 'k3yvalue'],
    ['node job.mjs --api-key=k3yvalue', 'k3yvalue'],
    ['node job.mjs --key k3yvalue', 'k3yvalue'],
    ['node job.mjs --key=k3yvalue', 'k3yvalue'],
    ['node job.mjs --ssh-key k3yvalue', 'k3yvalue'],
    ['curl -H "Authorization: Basic dXNlcjpwYXNz" https://example.invalid', 'dXNlcjpwYXNz'],
    ['git clone https://user:p/w@example.invalid/r.git', 'p/w'],
    ['git clone https://user:p@ss@example.invalid/r.git', 'ss@'],
    ['GITHUB_TOKEN=gh4t0ken node job.mjs', 'gh4t0ken'],
    ['DEPLOY_KEY=d3ploykey node job.mjs', 'd3ploykey'],
    ['DB_SECRET=db5ecret node job.mjs', 'db5ecret'],
    ['DB_PASSWORD=dbp4ss node job.mjs', 'dbp4ss'],
    ['env DB_PASSWORD="two words" node job.mjs', 'two words'],
    ['curl -H "Authorization: Bearer abcdef0123456789"', 'abcdef0123456789'],
    ['node job.mjs sk-abcdefghijklmnopqrstuvwx', 'sk-abcdefghijklmnopqrstuvwx'],
    ['git clone https://user:pa55word@example.invalid/r.git', 'pa55word'],
    [`node job.mjs ghp_${'a1B2c3D4e5'.repeat(3)}`, 'a1B2c3D4e5'],
  ];
  for (const [input, secret] of cases) {
    const out = redact(input);
    check(`redact: ${input.slice(0, 34)}`, !out.includes(secret) && out.includes('<REDACTED:secret>'), out);
  }
  check('redact keeps a path and a plain flag', redact('node /a/b/job.mjs --verbose --out /tmp/x') === 'node /a/b/job.mjs --verbose --out /tmp/x', redact('node /a/b/job.mjs --verbose --out /tmp/x'));
  check('redact keeps the script path and the user of a -u pair', redact('node /a/b/job.mjs -p hunter2pw') === 'node /a/b/job.mjs -p <REDACTED:secret>' && redact('curl -u alice:s3cretpw https://example.invalid') === 'curl -u alice:<REDACTED:secret> https://example.invalid', `${redact('node /a/b/job.mjs -p hunter2pw')} | ${redact('curl -u alice:s3cretpw https://example.invalid')}`);
  check('redact leaves a word that only contains key or pass alone', redact('node /a/keyboard.mjs --keyboard us --bypass') === 'node /a/keyboard.mjs --keyboard us --bypass', redact('node /a/keyboard.mjs --keyboard us --bypass'));
  const long = redact(`node ${'x'.repeat(400)}`);
  check('a command line is cut to 160 characters', long.length === 160 && long.endsWith('...'), String(long.length));
  const secretTail = redact(`node ${'x'.repeat(150)} --token supersecretvalue`);
  check('a secret past the cut never prints', !secretTail.includes('supersecretvalue'), secretTail);
  const e = verdict([row('node', `${scratchCmd()} --token abc123xyz`, { age: 90, ppid: dead })], nextPid - 1);
  check('the analysis entry carries only the redacted command line', e.cmd.includes('<REDACTED:secret>') && !JSON.stringify(e).includes('abc123xyz'), JSON.stringify(e).slice(0, 200));
}

// ---- paths and parsers ------------------------------------------------------------------------

{
  check('normPath lower-cases and slashes a win32 path, and maps an MSYS drive', normPath('"C:\\Work\\Repo"', true) === '"c:/work/repo"' && normPath('x /C/Work/Repo/a', true) === 'x c:/work/repo/a', normPath('x /C/Work/Repo/a', true));
  const winRow = row('node.exe', '"C:\\Program Files\\nodejs\\node.exe" "C:\\Work\\Repo\\.agent-work\\.tmp\\job.mjs"', { age: 90, ppid: dead });
  check('win32 matching ignores case and slash direction', analyze([winRow], opts({ win: true, root: 'c:\\work\\REPO' })).byPid.get(winRow.pid).stray, '');
  const msys = row('bash.exe', 'bash /c/work/repo/.agent-work/.tmp/job.sh', { age: 90, ppid: dead });
  check('win32 matching accepts an MSYS drive path', analyze([msys], opts({ win: true, root: 'C:\\Work\\Repo' })).byPid.get(msys.pid).stray, '');

  check('parseClock reads every ps time shape', parseClock('1-02:03:04') === 93784 && parseClock('02:03') === 123 && parseClock('1:02:03') === 3723 && parseClock('45') === 45 && parseClock('x') === null, '');
  const ps = [
    '  PID  PPID     ELAPSED   RSS     TIME COMMAND',
    '    1     0  1000000  4096 00:00:03 /sbin/init splash',
    ' 2001     1     3600 20480 00:01:02 node /tmp/with space/job.mjs --flag value',
    ' 2002  2001      120  2048 1-02:03:04 [kworker/0:1]',
    'garbage line',
  ].join('\n');
  const parsed = parsePosix(ps, NOW);
  check('parsePosix reads pid, parent, start, memory, CPU, and an args column with spaces',
    parsed.length === 3 && parsed[1].pid === 2001 && parsed[1].ppid === 1 && parsed[1].startMs === NOW - 3_600_000 && parsed[1].rss === 20480 * 1024 && parsed[1].cpu === 62
    && parsed[1].cmd === 'node /tmp/with space/job.mjs --flag value' && parsed[1].name === 'node' && parsed[2].cpu === 93784 && parsed[2].name === 'kworker/0:1', JSON.stringify(parsed[1]));
  check('parseWin32 reads one object as a list of one, and rejects non-JSON', parseWin32('{"p":5,"pp":1,"n":"a.exe","s":1700000000000,"r":10,"c":1.5,"a":null}')?.[0].pid === 5 && parseWin32('nope') === null, '');
}

// ---- stale locks ------------------------------------------------------------------------------

{
  const home = join(base, 'lockhome');
  const lock = (slug, session, body) => { const dir = join(home, '.claude', 'code-ops', 'recall', slug, session); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'build.lock'), body); return dir; };
  const live = row('node', 'node x', { age: 100, pid: 6001 });
  lock('r', 'live', JSON.stringify({ pid: 6001, at: NOW - 50 * MIN }));
  lock('r', 'gone', JSON.stringify({ pid: 6002, at: NOW - 3 * 60 * MIN }));
  lock('r', 'reused', JSON.stringify({ pid: 6001, at: NOW - 500 * MIN })); // the pid now belongs to a process that started later
  lock('r', 'broken', 'not json');
  const gitDir = join(base, 'gitdir');
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, 'index.lock'), '');
  writeFileSync(join(gitDir, 'HEAD'), 'ref');
  const found = staleLocks({ home, gitDir, rows: [live], now: NOW });
  const names = found.recall.dead.map((l) => l.path.split(/[\\/]/).slice(-2)[0]).sort();
  check('stale recall locks: a dead pid, a reused pid, and an unreadable lock; the live one stays', found.recall.total === 4 && names.join() === 'broken,gone,reused', names.join());
  check('a git lock is listed with no pid and the table says no git process runs', found.git.length === 1 && found.git[0].pid === null && /no git process/.test(found.git[0].note), JSON.stringify(found.git));
  check('lock reporting never deletes', staleLocks({ home, gitDir, rows: null, now: NOW }).recall.total === 4, '');
}

// ---- reap over a fake table -------------------------------------------------------------------

{
  const sh = shell();
  const stray = row('node', scratchCmd('reap.mjs'), { age: 90, ppid: dead, pid: 8001 });
  const control = row('node', scratchCmd('control.mjs'), { age: 90, ppid: sh.pid, pid: 8002 });
  const table = [sh, stray, control, row('node', 'node /elsewhere/x.mjs', { age: 90, ppid: dead, pid: 8003 })];
  const killed = [];
  const kill = (entry) => { killed.push(entry.pid); return { ok: true, detail: 'fake kill' }; };
  const read = (rows) => () => ({ ok: true, rows, ms: 1, reason: '' });
  const analysis = { root: ROOT, cacheRoots: [CACHE], selfPid: 99999, win: false };

  const done = reapStrays({ read: read(table), kill, now: () => NOW, analysis });
  check('--reap kills the candidate and nothing else', killed.join() === '8001' && done.killed.length === 1 && done.skipped.length === 0, killed.join());

  killed.length = 0;
  const refused = reapStrays({ read: read(table), kill, now: () => NOW, analysis, pids: [8002, 8003, 31337] });
  check('--reap --pid on a non-candidate is refused with the reason, and nothing is killed', killed.length === 0 && refused.refused.length === 3 && /parent is alive/.test(refused.refused[0].reason) && /no code-ops path/.test(refused.refused[1].reason) && refused.refused[2].reason === 'no such process', JSON.stringify(refused.refused));
  const named = reapStrays({ read: read(table), kill, now: () => NOW, analysis, pids: [8001] });
  check('--reap --pid on a candidate reaps it', named.killed.length === 1 && killed.join() === '8001', '');

  killed.length = 0;
  let calls = 0;
  const reusedPid = { ...stray, startMs: stray.startMs + 30 * MIN }; // the same pid, now a different process
  const swap = () => ({ ok: true, rows: ++calls === 1 ? table : [sh, reusedPid, control], ms: 1, reason: '' });
  const guard = reapStrays({ read: swap, kill, now: () => NOW, analysis });
  check('pid-reuse guard: a changed start time skips the kill', killed.length === 0 && /start time or command line changed/.test(guard.skipped[0]?.reason ?? ''), JSON.stringify(guard));

  calls = 0;
  const reworded = () => ({ ok: true, rows: ++calls === 1 ? table : [sh, { ...stray, cmd: `${stray.cmd} --other` }, control], ms: 1, reason: '' });
  check('a changed command line skips the kill', reapStrays({ read: reworded, kill, now: () => NOW, analysis }).skipped.length === 1 && killed.length === 0, '');

  calls = 0;
  const spawning = () => ({ ok: true, rows: ++calls === 1 ? table : [...table, row('node', 'node child.mjs', { age: 1, ppid: stray.pid })], ms: 1, reason: '' });
  const late = reapStrays({ read: spawning, kill, now: () => NOW, analysis });
  check('a tree that starts a child before the kill is no longer a candidate and is skipped', killed.length === 0 && /no longer a candidate/.test(late.skipped[0]?.reason ?? ''), JSON.stringify(late));

  killed.length = 0;
  const unreadable = reapStrays({ read: () => ({ ok: false, rows: [], ms: 1, reason: 'boom' }), kill, now: () => NOW, analysis });
  check('an unreadable table kills nothing and says why', killed.length === 0 && unreadable.unreadable === 'boom', '');
}

// ---- the win32 kill: per verified pid, never /T -----------------------------------------------

{
  const top = row('node', scratchCmd('tree.mjs'), { age: 90, ppid: dead, pid: 9001 });
  const mid = row('node', 'node child.mjs', { age: 80, ppid: 9001, pid: 9002 });
  const leaf = row('node', 'node grand.mjs', { age: 70, ppid: 9002, pid: 9003 });
  const unrelated = row('node', 'node /elsewhere/other.mjs', { age: 85, ppid: 5, pid: 9100 });
  const table = [top, mid, leaf, unrelated];
  const entry = analyze(table, opts()).byPid.get(9001);
  const treePids = entry._tree.map((r) => r.pid);
  const attempt = (freshRows, status = () => 0) => {
    const calls = [];
    const run = (_cmd, args) => { calls.push(args); return { status: status(args) }; };
    const read = typeof freshRows === 'function' ? freshRows : () => ({ ok: true, rows: freshRows, ms: 1, reason: '' });
    const done = killTree(entry, { platform: 'win32', run, read });
    return { calls, done, pids: calls.map((a) => Number(a[1])) };
  };
  const clean = (calls) => calls.every((a) => a.length === 3 && a[0] === '/PID' && a[2] === '/F' && !a.some((x) => /^\/T$/i.test(x)));
  check('the fixture tree is the candidate and its two descendants', entry.stray && treePids.join() === '9001,9002,9003', treePids.join());

  const all = attempt(table);
  check('win32 kill: one `/PID <pid> /F` per verified tree member, top-down, never /T', clean(all.calls) && all.pids.join() === '9001,9002,9003' && all.done.ok, JSON.stringify(all.calls));

  // Pid reuse: the tree top exited and its pid now belongs to a newer unrelated process that has a child of its own.
  const reusedTop = row('node', 'node /elsewhere/newer.mjs', { age: 1, ppid: 5, pid: 9001 });
  const newerKid = row('node', 'node /elsewhere/newer-child.mjs', { age: 0.5, ppid: 9001, pid: 9900 });
  const reuse = attempt([reusedTop, mid, leaf, newerKid, unrelated]);
  check('win32 kill: a tree pid reused by a newer unrelated process is skipped, and neither it nor its child is ever passed to taskkill',
    clean(reuse.calls) && !reuse.pids.includes(9001) && !reuse.pids.includes(9900) && !reuse.pids.includes(9100) && reuse.pids.every((p) => treePids.includes(p)) && reuse.pids.join() === '9002,9003', JSON.stringify(reuse.calls));

  const reworded = attempt([top, { ...mid, cmd: `${mid.cmd} --other` }, leaf]);
  check('win32 kill: a member whose command line changed is skipped; the others still end', clean(reworded.calls) && reworded.pids.join() === '9001,9003', JSON.stringify(reworded.calls));
  const restarted = attempt([top, mid, { ...leaf, startMs: leaf.startMs + 30 * MIN }]);
  check('win32 kill: a member whose start time changed is skipped', restarted.pids.join() === '9001,9002', JSON.stringify(restarted.calls));
  const gone = attempt([top, leaf]);
  check('win32 kill: a member that already exited is not passed to taskkill', gone.pids.join() === '9001,9003', JSON.stringify(gone.calls));

  let reads = 0;
  const flaky = attempt(() => (++reads === 2 ? { ok: false, rows: [], ms: 1, reason: 'boom' } : { ok: true, rows: table, ms: 1, reason: '' }));
  check('win32 kill: the table is re-read before every kill, and an unreadable re-read skips that pid', reads === 3 && flaky.pids.join() === '9001,9003', `${reads} ${JSON.stringify(flaky.calls)}`);
  const none = attempt(() => ({ ok: false, rows: [], ms: 1, reason: 'boom' }));
  check('win32 kill: with the table unreadable nothing is killed and the result is not ok', none.calls.length === 0 && !none.done.ok, JSON.stringify(none));
  const failing = attempt(table, () => 128);
  check('win32 kill: a taskkill that fails is not counted as ended', !failing.done.ok && /0 ended, 3 skipped/.test(failing.done.detail), failing.done.detail);

  // End to end through reapStrays: only tree pids reach the kill, whatever else is in the table.
  const reapCalls = [];
  const reapRun = (_cmd, args) => { reapCalls.push(args); return { status: 0 }; };
  const readTableFake = () => ({ ok: true, rows: table, ms: 1, reason: '' });
  const reaped = reapStrays({ read: readTableFake, kill: (e) => killTree(e, { platform: 'win32', run: reapRun, read: readTableFake }), now: () => NOW, analysis: { root: ROOT, checkout: true, cacheRoots: [CACHE], selfPid: 99999, win: false } });
  check('reapStrays on win32 ends exactly the verified tree and not the unrelated process', reaped.killed.length === 1 && clean(reapCalls) && reapCalls.map((a) => Number(a[1])).join() === '9001,9002,9003', JSON.stringify(reapCalls));

  // A POSIX start time is the read time minus whole elapsed seconds, so the re-read before the kill
  // reports each start up to a second or two off. That is the same process, not a restarted one.
  const shifted = (ms) => { let n = 0; return () => ({ ok: true, rows: n++ === 0 ? table : table.map((r) => ({ ...r, startMs: r.startMs + ms })), ms: 1, reason: '' }); };
  const reapWith = (read) => { const killed = []; return { out: reapStrays({ read, kill: (e) => { killed.push(e.pid); return { ok: true, detail: 'fake' }; }, now: () => NOW, analysis: { root: ROOT, checkout: true, cacheRoots: [CACHE], selfPid: 99999, win: false } }), killed }; };
  const jitter = reapWith(shifted(1000));
  check('reapStrays: a re-read whose start times differ by one second still ends the stray', jitter.killed.join() === '9001' && jitter.out.skipped.length === 0, JSON.stringify(jitter.out));
  const moved = reapWith(shifted(30 * MIN));
  check('reapStrays: a re-read whose start time moved by minutes is skipped as a changed process', moved.killed.length === 0 && /start time or command line changed/.test(moved.out.skipped[0]?.reason ?? ''), JSON.stringify(moved.out));
}

// ---- the advisory -----------------------------------------------------------------------------

{
  const home = join(base, 'advhome');
  const strayRows = [row('node', scratchCmd('adv.mjs'), { age: 90, ppid: dead, rss: 50 * 1024 * 1024 })];
  let asked = null;
  let reads = 0;
  const read = (o) => { reads += 1; asked = o; return { ok: true, rows: strayRows, ms: 1, reason: '' }; };
  const cwd = join(base, 'advrepo');
  mkdirSync(join(cwd, '.git'), { recursive: true });
  writeFileSync(join(cwd, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const env = { CODE_OPS_HOME: home };
  // The fixture repository is this process's working tree for the root, so give the scratch path to match it.
  strayRows[0].cmd = `node ${cwd.replace(/\\/g, '/')}/${SCRATCH}/.tmp/adv.mjs`;
  strayRows[0].startMs = NOW - 90 * MIN;
  const first = procsAdvisory({ cwd, home, now: NOW, env, read });
  check('the advisory names the stray count, the size, and `co ps`', /^processes: 1 stray code-ops processes \(50\.0 MB\); run `co ps`$/.test(first ?? ''), String(first));
  check('the advisory reads with a 2-second timeout', asked?.timeoutMs === 2000, JSON.stringify(asked));
  check('a second start within 24 hours stays silent and reads nothing', procsAdvisory({ cwd, home, now: NOW + 3 * 3_600_000, env, read }) === null && reads === 1, String(reads));
  const stamp = join(home, '.claude', 'code-ops', 'procs-advisory', 'scan.stamp');
  const old = new Date(NOW - 2 * 86_400_000);
  utimesSync(stamp, old, old);
  check('a stamp older than 24 hours lets it speak again', procsAdvisory({ cwd, home, now: NOW, env, read }) !== null && reads === 2, '');
  utimesSync(stamp, old, old);
  check('CODE_OPS_PROCS=off silences it without a read', procsAdvisory({ cwd, home, now: NOW, env: { ...env, CODE_OPS_PROCS: 'off' }, read }) === null && reads === 2, '');
  const quiet = join(base, 'quiethome');
  check('no stray, no line; an unreadable table, no line (the stamp is still written first)', procsAdvisory({ cwd, home: quiet, now: NOW, env, read: () => ({ ok: true, rows: [], ms: 1, reason: '' }) }) === null
    && procsAdvisory({ cwd, home: join(base, 'quiet2'), now: NOW, env, read: () => ({ ok: false, rows: [], ms: 1, reason: 'x' }) }) === null, '');
}

// ---- the command line -------------------------------------------------------------------------

const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: { ...process.env, CODE_OPS_HOME: join(base, 'clihome'), ...env }, cwd: base, timeout: 60_000 });
for (const [label, args] of [['an unknown flag', ['--bogus']], ['--pid without --reap', ['--pid', '5']], ['--older-than below 30', ['--reap', '--older-than', '10']], ['--sample 0', ['--sample', '0']],
  ['--sample over 600', ['--sample', '601']], ['--pid not a number', ['--reap', '--pid', 'abc']], ['--sample with no value', ['--sample']], ['--older-than not a number', ['--older-than', 'soon']]]) {
  check(`${label} is exit 2`, run(args).status === 2, args.join(' '));
}
check('--help prints the usage and exits 0', run(['--help']).status === 0 && /usage: procs\.mjs/.test(run(['--help']).stdout), '');
const soft = run(['--reap'], { CODE_OPS_PROCS_READ_MS: '1' });
check('an unreadable table fails soft: exit 0, says why, lists and kills nothing', soft.status === 0 && /process table unreadable/.test(soft.stdout) && /nothing killed/.test(soft.stdout) && !/^killed/m.test(soft.stdout), `${soft.status} ${soft.stdout.slice(0, 200)}`);
const json = run(['--json']);
let parsed = null;
try { parsed = JSON.parse(json.stdout); } catch { /* reported below */ }
check('--json prints one parseable report with the table summary and no raw command field', json.status === 0 && parsed?.table && Array.isArray(parsed.processes) && Array.isArray(parsed.strays) && !json.stdout.includes('_raw'), json.stdout.slice(0, 120));
const softJson = JSON.parse(run(['--json'], { CODE_OPS_PROCS_READ_MS: '1' }).stdout);
check('--json with an unreadable table is an empty list and the reason', softJson.table.ok === false && softJson.processes.length === 0 && softJson.table.reason.length > 0, JSON.stringify(softJson.table));
check('the platform read returns a table of at least a few processes', (() => { const t = readTable(); return t.ok && t.rows.length > 3 && t.rows.some((r) => r.pid === process.pid && r.cmd.includes('run.mjs')); })(), '');

// ---- real processes ---------------------------------------------------------------------------

const spawned = new Set();
const fixture = join(base, 'repo');
const scratchDir = join(fixture, SCRATCH, '.tmp');
mkdirSync(scratchDir, { recursive: true });
mkdirSync(join(base, 'elsewhere'), { recursive: true });
const sleeper = 'setTimeout(() => {}, 90000);\n';
const files = { stray: join(scratchDir, 'stray.mjs'), control: join(scratchDir, 'control.mjs'), plain: join(base, 'elsewhere', 'plain.mjs'), parent: join(base, 'elsewhere', 'parent.mjs') };
for (const f of [files.stray, files.control, files.plain]) writeFileSync(f, sleeper);
// The intermediate starts two detached sleepers with no inherited pipe, prints their pids, and exits,
// so the sleepers are orphans. detached + unref + stdio ignore is what lets spawnSync return at once.
writeFileSync(files.parent, `import { spawn } from 'node:child_process';
const go = (file) => { const c = spawn(process.execPath, [file], { detached: true, stdio: 'ignore', windowsHide: true }); c.unref(); return c.pid; };
console.log(JSON.stringify({ stray: go(${JSON.stringify(files.stray)}), plain: go(${JSON.stringify(files.plain)}) }));
`);
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const guardedKill = (entry) => (entry._tree.every((r) => spawned.has(r.pid)) ? killTree(entry) : { ok: false, detail: 'refused: a pid this eval did not spawn' });
const cleanup = () => { for (const pid of spawned) { try { process.kill(pid); } catch { /* gone */ } } };
process.on('exit', cleanup);
try {
  const control = spawn(process.execPath, [files.control], { stdio: 'ignore', windowsHide: true });
  spawned.add(control.pid);
  const parent = spawnSync(process.execPath, [files.parent], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  const ids = JSON.parse(parent.stdout || '{}');
  for (const pid of Object.values(ids)) spawned.add(pid);
  check('the fixture started an alive control and two orphaned sleepers', Number.isInteger(ids.stray) && Number.isInteger(ids.plain) && Number.isInteger(control.pid), parent.stdout + parent.stderr);

  const analysis = { root: fixture, cacheRoots: [join(base, 'cache')], selfPid: process.pid, thresholdMs: 30 * MIN };
  const later = () => Date.now() + 40 * MIN; // age is faked; the process-tree and parent rules read the real table
  const table = readTable();
  const plan = analyze(table.rows, { ...analysis, now: later() });
  const sEntry = plan.byPid.get(ids.stray);
  // A POSIX orphan reparents to init only without a subreaper; with one the parent is alive and the case does not apply.
  const orphaned = !!sEntry && sEntry.parent === 'dead';
  if (!orphaned) console.log(`skip real-orphan cases: the sleeper's parent reads ${sEntry?.parent ?? 'absent'} on this platform`);
  else {
    check('real: the orphaned scratch-folder sleeper is a candidate', sEntry.stray, JSON.stringify(sEntry?.blockers));
    check('real: the orphan outside code-ops paths is not', !plan.byPid.get(ids.plain).stray, '');
    check('real: a child whose parent is alive is not', !plan.byPid.get(control.pid).stray && plan.byPid.get(control.pid).parent === 'alive', '');
    check('real: nothing else on this machine is a candidate under the fixture root', plan.strays.every((e) => spawned.has(e.pid)), plan.strays.map((e) => e.pid).join());

    const refusedReal = reapStrays({ read: readTable, kill: guardedKill, now: later, analysis, pids: [ids.plain, control.pid] });
    check('real: --reap --pid on the control and the outside orphan is refused', refusedReal.refused.length === 2 && refusedReal.killed.length === 0, JSON.stringify(refusedReal.refused));
    if (plan.strays.every((e) => spawned.has(e.pid))) {
      const reaped = reapStrays({ read: readTable, kill: guardedKill, now: later, analysis });
      const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };
      for (let i = 0; i < 40 && alive(ids.stray); i++) nap(100);
      check('real: --reap ends the stray, and the control and the outside sleeper survive', reaped.killed.length === 1 && reaped.killed[0].pid === ids.stray && !alive(ids.stray) && alive(control.pid) && alive(ids.plain), JSON.stringify(reaped));
    }
  }
  const viaCli = run(['--reap', '--pid', String(control.pid)]);
  check('real CLI: --reap --pid on a live child of this eval is refused and exits 0', viaCli.status === 0 && new RegExp(`refused pid ${control.pid}: not a stray candidate`).test(viaCli.stdout) && /reaped 0, skipped 0, refused 1/.test(viaCli.stdout), viaCli.stdout.slice(-300));
} finally {
  // Re-check each pid's command line against the fixture folder before ending it, so a reused pid is never hit.
  const table = readTable();
  for (const pid of spawned) {
    const r = table.ok ? table.rows.find((x) => x.pid === pid) : null;
    if (r && r.cmd.includes(base)) { try { process.kill(pid); } catch { /* gone */ } }
  }
  spawned.clear();
  process.off('exit', cleanup);
  rmSync(base, { recursive: true, force: true, maxRetries: 3 });
}

console.log(fails.length ? `procs: ${fails.length} failure(s)\n${fails.join('\n')}` : 'procs: all checks pass');
process.exit(fails.length ? 1 : 0);
