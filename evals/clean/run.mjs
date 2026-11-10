#!/usr/bin/env node
// Regression eval for scripts/clean.mjs (`co clean`) and the cleanup advisory in
// hooks/routing-card.mjs. Every tree is a temp fixture; no spawned process sees the real home,
// repository, or worktrees (`--home`, `--root`, and HOME, USERPROFILE, CODE_OPS_HOME all point at the
// fixture). It pins the contract:
//   - a dry run deletes nothing; `--apply` without `--scope` and a threshold below a floor exit 2;
//   - state: an expired auto-store file goes, and a fresh file, a lock, a live session's file, a
//     ledger with an unsettled agent, a manual store, and a link target all stay; digest raw files and
//     DIGEST_RECEIPTS.jsonl stay consistent;
//   - tmp: old scratch goes, fresh scratch, the layout `.gitignore`, and the folder stay;
//   - runs: only an old, uncited `working` run with no open handoff goes; evidence, cited, open-handoff,
//     unmarked, no-session, recent, and `programs` runs stay;
//   - worktrees: only a clean, merged, old, unlocked worktree goes, never the branch;
//   - branches: reported, never deleted;
//   - a symlink or junction out of the root is not followed, and a `..` target is refused;
//   - the advisory fires once per 24 hours, honors `CODE_OPS_CLEAN=off`, and deletes nothing;
//   - the advisory budget binds every scan it starts: a spent deadline truncates the tmp walk and skips
//     the worktree part before any git call.
//
//   node evals/clean/run.mjs

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FLOOR_DAYS, STORES, cleanAdvisory, removeItems, removeTarget, scanState, scanTmp, scanWorktrees } from '../../scripts/clean.mjs';
import { HOST_FOLDERS } from '../../scripts/workspace-layout.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const cli = join(repoRoot, 'scripts', 'clean.mjs');
const card = join(repoRoot, 'plugins', 'code-ops-suite', 'hooks', 'routing-card.mjs');
const { fails, check } = tally((name, detail) => `${name} — ${String(detail).slice(0, 300)}`);

const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'clean-eval-')));
const DAY = 86_400_000;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const put = (path, text = 'x', days = 0) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); if (days) setAge(path, days); return path; };
const setAge = (path, days) => { const t = new Date(Date.now() - days * DAY); utimesSync(path, t, t); };
// Ages a whole tree, children first, so a directory's own mtime is old too.
const ageTree = (dir, days) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (lstatSync(p).isDirectory()) ageTree(p, days); else setAge(p, days); } setAge(dir, days); };
const tree = (dir) => { const out = []; const go = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); const s = lstatSync(p); if (s.isDirectory()) go(p); else out.push(`${p}|${s.size}|${s.mtimeMs}`); } }; go(dir); return out.sort().join('\n'); };

const home = join(base, 'home');
const store = (name, ...parts) => join(home, '.claude', 'code-ops', name, ...parts);
const envFor = (extra = {}) => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:CLAUDE|CODEX_|OPENCODE|GROK_|COPILOT_|CODE_OPS_)/.test(key)) delete env[key];
  return Object.assign(env, { HOME: home, USERPROFILE: home, CODE_OPS_HOME: home }, extra);
};
const clean = (root, args, cwd = base) => spawnSync(process.execPath, [cli, '--home', home, '--root', root, ...args], { encoding: 'utf8', env: envFor(), cwd, timeout: 60000 });
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.email=e@example.invalid', '-c', 'user.name=eval', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
const makeRepo = (name) => { const dir = join(base, 'repos', name); mkdirSync(dir, { recursive: true }); git(dir, 'init', '-q', '-b', 'main'); git(dir, 'commit', '-q', '--allow-empty', '-m', 'init'); return dir; };

// ---- the table ------------------------------------------------------------------------------
check('the store table is frozen and no threshold is below the floor',
  Object.isFrozen(STORES) && Object.values(STORES).every((s) => Object.isFrozen(s) && s.days >= FLOOR_DAYS) && STORES.agents.days >= 30, JSON.stringify(Object.keys(STORES)));
check('a store with no bounded reader window and no rebuild is manual', ['dispatch', 'digest', 'sessions'].every((n) => STORES[n].mode === 'manual'), '');
check('recall and index rebuild on a miss, so both are auto at 30 days', ['recall', 'index'].every((n) => STORES[n].mode === 'auto' && STORES[n].days === 30), '');

// ---- usage errors ---------------------------------------------------------------------------
const plain = makeRepo('plain');
check('--apply without --scope is exit 2', clean(plain, ['--apply']).status === 2, '');
check('a threshold below the floor of a selected scope is exit 2', clean(plain, ['--scope', 'state', '--older-than', '13']).status === 2 && clean(plain, ['--scope', 'runs', '--older-than', '5']).status === 2, '');
check('an unknown scope, store, or flag is exit 2', clean(plain, ['--scope', 'nope']).status === 2 && clean(plain, ['--scope', 'state', '--store', 'nope']).status === 2 && clean(plain, ['--bogus']).status === 2, '');
check('--apply --store without --scope state is exit 2', clean(plain, ['--apply', '--scope', 'tmp', '--store', 'dispatch']).status === 2, '');

// ---- state fixtures -------------------------------------------------------------------------
const outside = join(base, 'outside');
put(join(outside, 'precious.txt'), 'keep me', 400);
put(store('agents', 'expired.jsonl'), '{"status":"dispatched","background":true,"agent_id":"a1"}\n{"status":"reported","agent_id":"a1"}\n', 40);
put(store('agents', 'unsettled.jsonl'), '{"status":"dispatched","background":true,"agent_id":"lost"}\n', 40);
put(store('agents', 'fresh.jsonl'), '{}\n', 0.2);
put(store('agents', 'edge.jsonl'), '{}\n', 12); // under the 30-day threshold
put(store('agents', `${sha('live-session-0001')}.jsonl`), '{}\n', 60); // old, but its session is live
put(store('sessions', 'repo-key', 'live-session-0001.json'), JSON.stringify({ v: 1, sessionId: 'live-session-0001', runDir: 'x', updatedAt: new Date().toISOString() }), 0);
put(store('board', 'repo-key', 'ended-0001-aaaa.json'), '{"ended":true}', 50);
put(store('dispatch', 'hash', 'agent.rounds'), '.', 90); // manual store
put(store('recall', 'slug', 'sess-old', 'tree.json'), '{}', 40);
put(store('recall', 'slug', 'sess-young', 'tree.json'), '{}', 20); // under the 30-day threshold
put(store('recall', 'slug', 'sess-locked', 'tree.json'), '{}', 40);
put(store('recall', 'slug', 'sess-locked', 'build.lock'), '1', 40); // no readable pid: kept
const deadPid = spawnSync(process.execPath, ['-e', '0']).pid; // exited, so ESRCH
const lockOf = (pid) => JSON.stringify({ pid, at: Date.now() });
put(store('recall', 'slug', 'sess-dead-old', 'tree.json'), '{}', 0.5);
put(store('recall', 'slug', 'sess-dead-old', 'build.lock'), lockOf(deadPid), 0.1); // 2.4 hours old, dead pid: removed
setAge(store('recall', 'slug', 'sess-dead-old', 'build.lock'), 0.1);
put(store('recall', 'slug', 'sess-live', 'tree.json'), '{}', 0.5);
put(store('recall', 'slug', 'sess-live', 'build.lock'), lockOf(process.pid), 0.1); // live pid: kept
put(store('recall', 'slug', 'sess-fresh-dead', 'tree.json'), '{}', 0.5);
put(store('recall', 'slug', 'sess-fresh-dead', 'build.lock'), lockOf(deadPid), 0.01); // 14 minutes old: kept
put(store('index', 'proj', 'old.json'), '{}', 40);
put(store('index', 'proj', 'young.json'), '{}', 20);
// A junction (a symlink off Windows) in an auto store that points outside the root.
symlinkSync(outside, store('agents', 'escape'), 'junction');
const digestDir = store('digest', 'slug');
const rawOld = put(join(digestDir, '2026-01-01', '000001-aaaa.txt'), 'old raw output', 45);
const rawNew = put(join(digestDir, '2026-11-01', '000002-bbbb.txt'), 'new raw output', 1);
const receiptLines = [{ raw: rawOld, argv: ['a'] }, { raw: rawNew, argv: ['b'] }, { argv: ['no raw'] }].map((r) => JSON.stringify(r));
put(join(digestDir, 'DIGEST_RECEIPTS.jsonl'), `${receiptLines.join('\n')}\n`, 1);
const homeBefore = tree(home);

let r = clean(plain, ['--scope', 'state']);
check('a dry run lists the stores and deletes nothing', r.status === 0 && /agents:/.test(r.stdout) && /total/.test(r.stdout) && tree(home) === homeBefore, r.stdout + r.stderr);
r = clean(plain, []);
check('the default dry run covers every scope', r.status === 0 && ['state', 'tmp', 'runs', 'worktrees', 'branches'].every((s) => new RegExp(`^${s}\\s`, 'm').test(r.stdout)) && tree(home) === homeBefore, r.stdout);
const plan = scanState({ home, now: Date.now() });
const agents = plan.stores.find((s) => s.name === 'agents');
check('the walk does not follow a junction out of the store', !agents.items.some((i) => i.path.includes('precious')) && agents.files === 1, JSON.stringify(agents.items.map((i) => i.path)));
const recallPlan = plan.stores.find((s) => s.name === 'recall');
const indexPlan = plan.stores.find((s) => s.name === 'index');
check('the dry run counts a dead-pid lock over an hour old, and not a live, a fresh, or a pid-less one',
  recallPlan.items.some((i) => i.path.endsWith(join('sess-dead-old', 'build.lock'))) && !recallPlan.items.some((i) => /sess-(live|fresh-dead|locked)/.test(i.path) && i.path.endsWith('build.lock')), JSON.stringify(recallPlan.items.map((i) => i.path)));
check('recall and index files over 30 days are selected and younger ones are not',
  recallPlan.items.some((i) => i.path.includes('sess-old')) && !recallPlan.items.some((i) => i.path.includes('sess-young')) && indexPlan.items.some((i) => i.path.endsWith('old.json')) && !indexPlan.items.some((i) => i.path.endsWith('young.json')), JSON.stringify([recallPlan.items, indexPlan.items].map((l) => l.map((i) => i.path))));

r = clean(plain, ['--apply', '--scope', 'state']);
check('--apply --scope state removes the expired auto-store file',
  r.status === 0 && !existsSync(store('agents', 'expired.jsonl')) && !existsSync(store('board', 'repo-key', 'ended-0001-aaaa.json')), r.stdout + r.stderr);
check('it keeps a fresh file, an under-threshold file, a live session\'s file, and an unsettled ledger',
  existsSync(store('agents', 'fresh.jsonl')) && existsSync(store('agents', 'edge.jsonl')) && existsSync(store('agents', `${sha('live-session-0001')}.jsonl`)) && existsSync(store('agents', 'unsettled.jsonl')), '');
check('it never touches a manual store without --store',
  existsSync(store('dispatch', 'hash', 'agent.rounds')) && existsSync(rawOld), '');
check('the default apply removes an expired recall unit and index file, and keeps the younger ones',
  !existsSync(store('recall', 'slug', 'sess-old')) && existsSync(store('recall', 'slug', 'sess-young', 'tree.json')) && !existsSync(store('index', 'proj', 'old.json')) && existsSync(store('index', 'proj', 'young.json')), r.stdout + r.stderr);
check('it removes a dead-pid lock over an hour old and keeps its unit',
  !existsSync(store('recall', 'slug', 'sess-dead-old', 'build.lock')) && existsSync(store('recall', 'slug', 'sess-dead-old', 'tree.json')), '');
check('it keeps a live-pid lock, a fresh dead-pid lock, and a pid-less lock',
  existsSync(store('recall', 'slug', 'sess-live', 'build.lock')) && existsSync(store('recall', 'slug', 'sess-fresh-dead', 'build.lock')) && existsSync(store('recall', 'slug', 'sess-locked', 'build.lock')), '');
check('the link out of the root and its target survive', lstatSync(store('agents', 'escape')).isSymbolicLink() && existsSync(join(outside, 'precious.txt')), '');

r = clean(plain, ['--apply', '--scope', 'state', '--store', 'recall']);
check('--store recall keeps a unit holding a lock',
  r.status === 0 && existsSync(store('recall', 'slug', 'sess-young', 'tree.json')) && existsSync(store('recall', 'slug', 'sess-locked', 'build.lock')) && existsSync(store('recall', 'slug', 'sess-locked', 'tree.json')), r.stdout + r.stderr);
// The lock is re-read at removal: a live build that reclaimed a stale lock after the scan keeps it.
{
  const reclaimed = put(store('recall', 'slug-race', 'sess-reclaimed', 'build.lock'), lockOf(deadPid), 0.1);
  const unchanged = put(store('recall', 'slug-race', 'sess-unchanged', 'build.lock'), lockOf(deadPid), 0.1);
  const racePlan = scanState({ home, now: Date.now(), only: ['recall'] }).stores[0];
  const planned = (path) => racePlan.items.find((i) => i.path === path);
  check('the scan selects both stale locks and records the bytes it read', Boolean(planned(reclaimed)) && Boolean(planned(unchanged)) && typeof planned(reclaimed).lockText === 'string', JSON.stringify(racePlan.items.map((i) => i.path)));
  writeFileSync(reclaimed, lockOf(process.pid)); // another build took the lock after the scan: new pid and stamp
  const settled = removeItems([planned(reclaimed), planned(unchanged)], racePlan.root);
  check('a lock whose pid and stamp changed after the scan is not deleted', existsSync(reclaimed) && JSON.parse(readFileSync(reclaimed, 'utf8')).pid === process.pid, '');
  check('a lock that did not change is deleted, and only it is counted', !existsSync(unchanged) && settled.files === 1 && settled.failed.length === 0, JSON.stringify(settled));
  const vanished = removeItems([{ path: join(dirname(unchanged), 'absent', 'build.lock'), bytes: 0, lockText: '{}' }], racePlan.root);
  check('a lock that is already gone is neither removed nor a failure', vanished.files === 0 && vanished.failed.length === 0, JSON.stringify(vanished));
}

r = clean(plain, ['--apply', '--scope', 'state', '--store', 'digest']);
const receiptsAfter = readFileSync(join(digestDir, 'DIGEST_RECEIPTS.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
check('digest raw files and receipts stay consistent',
  r.status === 0 && !existsSync(rawOld) && existsSync(rawNew) && receiptsAfter.length === 2 && receiptsAfter.every((x) => !x.raw || existsSync(x.raw)) && receiptsAfter.some((x) => x.raw === rawNew) && receiptsAfter.some((x) => !x.raw), r.stdout + JSON.stringify(receiptsAfter));
check('a digest slug whose every raw file goes keeps an empty receipts file, never a dangling line', (() => {
  const raw = put(join(store('digest', 'race'), '2026-01-01', 'x.txt'), 'race', 45);
  put(join(store('digest', 'race'), 'DIGEST_RECEIPTS.jsonl'), `${JSON.stringify({ raw })}\n`, 1);
  const res = clean(plain, ['--apply', '--scope', 'state', '--store', 'digest']);
  return res.status === 0 && !existsSync(raw) && readFileSync(join(store('digest', 'race'), 'DIGEST_RECEIPTS.jsonl'), 'utf8').trim() === '';
})(), '');

// ---- path safety ----------------------------------------------------------------------------
const safeRoot = join(base, 'safe');
const victim = put(join(base, 'victim.txt'), 'v', 100);
put(join(safeRoot, 'inside.txt'), 'i', 100);
symlinkSync(outside, join(safeRoot, 'out-link'), 'junction');
check('a `..` target is refused and the file survives', /refused/.test(removeTarget(join(safeRoot, '..', 'victim.txt'), safeRoot) ?? '') && existsSync(victim), '');
check('a target under a link that leaves the root is refused', /refused/.test(removeTarget(join(safeRoot, 'out-link', 'precious.txt'), safeRoot) ?? '') && existsSync(join(outside, 'precious.txt')), '');
check('the root itself is refused', /refused/.test(removeTarget(safeRoot, safeRoot) ?? ''), '');
check('removing a link unlinks the link and never its target', removeTarget(join(safeRoot, 'out-link'), safeRoot) === null && !existsSync(join(safeRoot, 'out-link')) && existsSync(join(outside, 'precious.txt')), '');
check('a non-empty directory is never removed recursively', removeTarget(safeRoot, base) !== null && existsSync(join(safeRoot, 'inside.txt')), '');
put(join(safeRoot, 'win.txt'), 'w', 100);
check('a Windows-style path form (drive-letter case, backslashes) resolves the same',
  process.platform !== 'win32' || removeTarget(join(safeRoot, 'win.txt').replace(/\//g, '\\').replace(/^[a-z]:/i, (d) => d.toLowerCase()), safeRoot.replace(/^[a-z]:/i, (d) => d.toUpperCase())) === null, '');

// ---- tmp ------------------------------------------------------------------------------------
const tmpRepo = makeRepo('tmp');
const t = join(tmpRepo, '.claude', '.tmp');
put(join(t, '.gitignore'), '*\n', 30);
put(join(t, 'old.txt'), 'o', 5);
put(join(t, 'fresh.txt'), 'f', 0.1);
put(join(t, 'nested', 'old2.txt'), 'o', 9);
put(join(tmpRepo, HOST_FOLDERS.other, '.tmp', 'old3.txt'), 'o', 4);
r = clean(tmpRepo, ['--apply', '--scope', 'tmp']);
check('tmp removes old scratch under every host folder and keeps fresh files, the ignore file, and the folder',
  r.status === 0 && !existsSync(join(t, 'old.txt')) && !existsSync(join(t, 'nested')) && !existsSync(join(tmpRepo, HOST_FOLDERS.other, '.tmp', 'old3.txt'))
  && existsSync(join(t, 'fresh.txt')) && existsSync(join(t, '.gitignore')) && existsSync(t), r.stdout + r.stderr);

// ---- runs -----------------------------------------------------------------------------------
const runRepo = makeRepo('runs');
const runs = join(runRepo, 'code-ops-docs', '80 Runs');
const mkRun = (name, session, extra = {}) => {
  const dir = join(runs, name);
  put(join(dir, 'RUN_LOG.md'), 'log');
  if (session !== null) put(join(dir, 'SESSION.json'), JSON.stringify(session));
  for (const [file, text] of Object.entries(extra)) put(join(dir, file), text);
  ageTree(dir, 60);
  return dir;
};
mkRun('2026-01-01-disposable', { v: 1, retention: 'working' });
mkRun('2026-01-02-cited', { v: 1, retention: 'working' });
mkRun('2026-01-03-evidence', { v: 1, retention: 'evidence' });
mkRun('2026-01-04-handoff', { v: 1, retention: 'working' }, { 'HANDOFF.md': 'open' });
mkRun('2026-01-05-consumed', { v: 1, retention: 'working' }, { 'HANDOFF.md': 'done', 'HANDOFF.consumed': '{}' });
mkRun('2026-01-06-unmarked', { v: 1 });
mkRun('2026-01-07-nosession', null);
mkRun('2026-01-08-invalid', { v: 1, retention: 'scratch' });
const recent = mkRun('2026-11-01-recent', { v: 1, retention: 'working' });
setAge(join(recent, 'RUN_LOG.md'), 1);
setAge(recent, 1);
mkRun('programs', null);
const programs = join(runs, 'programs', 'p1');
put(join(programs, 'PROGRAM.md'), 'ledger'); put(join(programs, 'SESSION.json'), '{"retention":"working"}');
ageTree(join(runs, 'programs'), 90);
put(join(runRepo, 'NOTES.md'), 'see 2026-01-02-cited for the evidence\n');
git(runRepo, 'add', 'NOTES.md');
git(runRepo, 'commit', '-q', '-m', 'notes');
const runsBefore = tree(runs);
r = clean(runRepo, ['--scope', 'runs']);
check('a runs dry run deletes nothing, reports unmarked runs, and prints the mark command',
  r.status === 0 && tree(runs) === runsBefore && /unmarked \(never removed\): 3 runs/.test(r.stdout) && /co run retention "[^"]+" working --operator/.test(r.stdout), r.stdout);
r = clean(runRepo, ['--apply', '--scope', 'runs']);
const alive = (name) => existsSync(join(runs, name));
check('runs removes only the old, uncited, working run with no open handoff', r.status === 0 && !alive('2026-01-01-disposable') && !alive('2026-01-05-consumed'), r.stdout + r.stderr);
check('runs keeps cited, evidence, open-handoff, unmarked, no-session, invalid-mark, recent, and programs folders',
  ['2026-01-02-cited', '2026-01-03-evidence', '2026-01-04-handoff', '2026-01-06-unmarked', '2026-01-07-nosession', '2026-01-08-invalid', '2026-11-01-recent'].every(alive) && existsSync(join(programs, 'PROGRAM.md')), '');
check('a non-git root keeps every working run', (() => {
  const loose = join(base, 'loose');
  const dir = join(loose, 'code-ops-docs', '80 Runs', '2026-01-01-w');
  put(join(dir, 'SESSION.json'), '{"retention":"working"}');
  ageTree(dir, 60);
  clean(loose, ['--apply', '--scope', 'runs']);
  return existsSync(dir);
})(), '');

// ---- worktrees and branches -----------------------------------------------------------------
const wtRepo = makeRepo('wt');
put(join(wtRepo, '.gitignore'), '.claude/\nsecret.local\n');
git(wtRepo, 'add', '.gitignore'); git(wtRepo, 'commit', '-q', '-m', 'ignore');
mkdirSync(join(wtRepo, '.claude', 'worktrees'), { recursive: true });
const wt = (name) => join(wtRepo, '.claude', 'worktrees', name);
const addTree = (name, age = 5) => { const res = git(wtRepo, 'worktree', 'add', '-q', '-b', name, wt(name)); if (res.status !== 0) throw new Error(res.stderr); if (age) { setAge(join(wt(name), '.git'), age); setAge(wt(name), age); } };
for (const name of ['merged-clean', 'dirty', 'unmerged', 'ignored-file', 'locked', 'cwd-tree']) addTree(name);
addTree('fresh', 0);
put(join(wt('dirty'), 'scratch.txt'), 'uncommitted work');
put(join(wt('unmerged'), 'f.txt'), 'f'); git(wt('unmerged'), 'add', 'f.txt'); git(wt('unmerged'), 'commit', '-q', '-m', 'work');
put(join(wt('ignored-file'), 'secret.local'), 'ignored but real');
git(wtRepo, 'worktree', 'lock', wt('locked'));
setAge(join(wt('ignored-file'), '.git'), 5); setAge(wt('ignored-file'), 5);
// A detached worktree.
git(wtRepo, 'worktree', 'add', '-q', '--detach', wt('detached')); setAge(join(wt('detached'), '.git'), 5); setAge(wt('detached'), 5);
// A branch merged with its upstream gone.
const remote = join(base, 'remote.git');
git(base, 'init', '-q', '--bare', remote);
git(wtRepo, 'remote', 'add', 'origin', remote);
git(wtRepo, 'branch', 'gone-merged');
git(wtRepo, 'push', '-q', '-u', 'origin', 'main', 'gone-merged');
git(wtRepo, 'push', '-q', 'origin', '--delete', 'gone-merged');
git(wtRepo, 'fetch', '-q', '--prune', 'origin');
const branchesBefore = git(wtRepo, 'branch', '--format=%(refname:short)').stdout;
r = clean(wtRepo, ['--scope', 'worktrees']);
check('a worktree dry run removes nothing and says why each one stays',
  r.status === 0 && existsSync(wt('merged-clean')) && /removable .*merged-clean/.test(r.stdout) && /dirty: not clean/.test(r.stdout) && /unmerged: branch unmerged is not merged/.test(r.stdout), r.stdout);
r = clean(wtRepo, ['--apply', '--scope', 'worktrees'], wt('cwd-tree'));
check('worktrees removes a clean, merged, old worktree and keeps its branch', r.status === 0 && !existsSync(wt('merged-clean')) && /merged-clean/.test(git(wtRepo, 'branch', '--list', 'merged-clean').stdout), r.stdout + r.stderr);
check('worktrees keeps a dirty, unmerged, ignored-file, locked, detached, fresh, and current-directory worktree',
  ['dirty', 'unmerged', 'ignored-file', 'locked', 'detached', 'fresh', 'cwd-tree'].every((n) => existsSync(wt(n))) && existsSync(join(wt('dirty'), 'scratch.txt')) && existsSync(join(wt('ignored-file'), 'secret.local')), r.stdout);
r = clean(wtRepo, ['--scope', 'branches']);
check('branches lists a merged branch with a gone upstream and the squash-merge caution', r.status === 0 && /gone-merged/.test(r.stdout) && /squash/.test(r.stdout) && !/unmerged/.test(r.stdout), r.stdout);
r = clean(wtRepo, ['--apply', '--scope', 'branches']);
check('--apply --scope branches deletes nothing and says so', r.status === 0 && /deleted nothing/.test(r.stdout) && git(wtRepo, 'branch', '--format=%(refname:short)').stdout === branchesBefore, r.stdout);

// ---- the advisory ---------------------------------------------------------------------------
const advRepo = makeRepo('adv');
for (let i = 0; i < 31; i++) {
  const dir = join(advRepo, 'code-ops-docs', '80 Runs', `2026-01-${String(i + 1).padStart(2, '0')}-run`);
  put(join(dir, 'SESSION.json'), '{"v":1}');
  ageTree(dir, 70);
}
const advBefore = tree(join(advRepo, 'code-ops-docs'));
const start = (extra = {}, payload = {}) => spawnSync(process.execPath, [card], {
  input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'adv-session-0001', cwd: advRepo, ...payload }), encoding: 'utf8', env: envFor({ CLAUDE_PROJECT_DIR: advRepo, ...extra }), cwd: advRepo, timeout: 30000,
});
const quiet = start({ CODE_OPS_CLEAN: 'off' });
check('CODE_OPS_CLEAN=off silences the advisory', quiet.status === 0 && !/cleanup:/.test(quiet.stdout) && !existsSync(store('clean-advisory')), quiet.stdout);
const first = start();
check('the card carries one cleanup line when over the stale-run threshold', first.status === 0 && /^cleanup: .*31 stale run folders; run `co clean` to see it$/m.test(first.stdout), first.stdout);
const second = start();
check('a second start inside 24 hours is silent', second.status === 0 && !/cleanup:/.test(second.stdout), second.stdout);
const stamps = existsSync(store('clean-advisory')) ? readdirSync(store('clean-advisory')) : [];
check('one stamp per repository is written', stamps.length === 1, stamps.join(','));
for (const f of stamps) setAge(store('clean-advisory', f), 2);
check('a stamp older than 24 hours lets it speak again', /cleanup:/.test(start().stdout), '');
for (const f of readdirSync(store('clean-advisory'))) setAge(store('clean-advisory', f), 2);
check('a compact resume and an empty-stdin run print no cleanup line', !/cleanup:/.test(start({}, { source: 'compact' }).stdout)
  && !/cleanup:/.test(spawnSync(process.execPath, [card], { input: '', encoding: 'utf8', env: envFor(), cwd: advRepo }).stdout), '');
check('the advisory deleted nothing', tree(join(advRepo, 'code-ops-docs')) === advBefore, '');

// ---- the advisory budget --------------------------------------------------------------------
// A deadline already in the past stands for a slow walk or clock: every scan the advisory starts must
// honor it, and none may start a git call once the budget is spent.
{
  const tmpRepo = join(base, 'budget-tmp');
  put(join(tmpRepo, '.claude', '.tmp', 'old', 'a.txt'), 'x', 400);
  const open = scanTmp({ root: tmpRepo, now: Date.now(), deadline: performance.now() + 60_000 });
  check('scanTmp with time left walks everything and is not truncated', open.items.length === 1 && !open.truncated, JSON.stringify(open));
  const late = scanTmp({ root: tmpRepo, now: Date.now(), deadline: performance.now() - 1 });
  check('scanTmp past its deadline stops, reports truncated, and lists nothing', late.truncated && late.items.length === 0, JSON.stringify(late));
  check('scanTmp without a deadline is unchanged', scanTmp({ root: tmpRepo, now: Date.now() }).items.length === 1 && !scanTmp({ root: tmpRepo, now: Date.now() }).truncated, '');

  // A non-git root with a worktree folder: with time left, git runs and finds no main branch; with none, no git call starts.
  const noGit = join(base, 'budget-nogit');
  put(join(noGit, '.claude', 'worktrees', 'w1', 'f.txt'));
  const withTime = scanWorktrees({ root: noGit, now: Date.now(), deadline: performance.now() + 60_000, quick: true });
  check('scanWorktrees with time left asks git and reports no main branch', withTime.note === 'no main or master branch', String(withTime.note));
  const t0 = performance.now();
  const spent = scanWorktrees({ root: noGit, now: Date.now(), deadline: performance.now() - 1, quick: true });
  check('scanWorktrees with the budget spent skips the worktree part without a git call', spent.note === 'time budget spent' && spent.candidates.length === 0 && performance.now() - t0 < 1000, String(spent.note));

  const slowHome = join(base, 'budget-home');
  const t1 = performance.now();
  const line = cleanAdvisory({ cwd: advRepo, home: slowHome, now: Date.now(), budgetMs: -1, env: {} });
  check('cleanAdvisory with a spent budget returns at once and never claims more than a lower bound', performance.now() - t1 < 2000 && (line === null || /^cleanup: at least /.test(line)), String(line));
}

rmSync(base, { recursive: true, force: true, maxRetries: 3 });
console.log(fails.length ? `clean: ${fails.length} failure(s)\n${fails.join('\n')}` : 'clean: all checks pass');
process.exit(fails.length ? 1 : 0);
