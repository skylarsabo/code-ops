#!/usr/bin/env node
// Regression eval for the recall prebuild in the two suite hooks: `hooks/compact-snapshot.mjs`
// (PreCompact) and `hooks/session-receipt.mjs` (SessionEnd) each start a detached
// `transcript-recall.mjs build --session <id> --transcript <file>` and never wait for it.
// Deterministic, no model call, and no real transcript is read: the eval generates its own JSONL
// fixtures, points CODE_OPS_HOME, HOME, and USERPROFILE at temp directories, and runs the hooks
// from a temporary plugin layout (hooks/ beside a scripts/ copy of the root scripts/), so the hooks
// resolve the script the way an installed plugin does and no vendored file is touched.
//
//   node evals/recall-prebuild/run.mjs
//
// Gates, once per hook unless noted:
//   G1 the hook returns while its build is still blocked on a held build lock (it never waits), and
//      once the lock frees, the index exists, is current, and `search` finds a planted needle;
//   G2 a build killed mid-run (pid read from its lock file) leaves no index, and a later `status`
//      call catches the index up (the lazy path), after which `search` finds the needle;
//   G3 `CODE_OPS_RECALL=off|0|false` suppresses the spawn, and a stub script shows the spawn
//      itself passes `build --session <id> --transcript <file>` with the payload's cwd;
//   G4 a missing script, a missing session id, or a missing transcript changes neither the hook's
//      exit, nor its stdout, nor the receipt row (compared against a run with the script present).
//   G5 the detached build's bound: a build past its deadline exits 1 and frees only a lock it holds, a
//      SIGTERM frees the lock (not on win32), and a second build stands down while a live build holds it;
// Informational, never gated: the full-build time on a generated fixture of at least 5 MB, the
// hook wall time on that fixture, and the time until the index appears.
// Cleanup kills any build still alive (its pid is in its lock file) and waits for the lock to clear
// before the temp directories go.

import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexDir } from '../../scripts/transcript-recall.mjs';
import { tally, withDetail } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const { fails, check } = tally(withDetail);

const NEEDLE = 'recallprebuildneedle9917';
const MB = 1024 * 1024;
const BUILD_MIN_BYTES = 5 * MB;
const KILL_BYTES = 12 * MB;
const WAIT_MS = 90_000;
const HOOKS = ['compact-snapshot', 'session-receipt'];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const boxes = [];

// ---------------------------------------------------------------- fixtures and layouts

// One cycle is an operator prompt, an assistant step with a Bash call, and its result.
function makeTranscript(file, session, minBytes) {
  const start = Date.parse('2026-10-01T10:00:00Z');
  const rows = [];
  let bytes = 0;
  let n = 0;
  const push = (o) => {
    const line = `${JSON.stringify({ sessionId: session, timestamp: new Date(start + 1000 * n).toISOString(), uuid: `u-${n}`, ...o })}\n`;
    n++;
    bytes += Buffer.byteLength(line);
    rows.push(line);
  };
  for (let i = 0; bytes < minBytes || i < 6; i++) {
    const body = `line ${i} of the log `.repeat(90);
    push({ type: 'user', message: { role: 'user', content: i === 3 ? `Check the ${NEEDLE} setting in the config.` : `Prompt ${i}: review module ${i} and report.` } });
    push({ type: 'assistant', message: { id: `msg_${i}`, role: 'assistant', content: [{ type: 'text', text: `Looking at module ${i} now.` }, { type: 'tool_use', id: `tu_${i}`, name: 'Bash', input: { command: `cat module-${i}.log` } }] } });
    push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu_${i}`, content: body }] } });
  }
  writeFileSync(file, rows.join(''));
  return bytes;
}

function plugin(label, { stub = false, withScript = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `prebuild-${label}-plugin-`));
  mkdirSync(join(dir, 'hooks'));
  for (const h of HOOKS) cpSync(join(root, 'plugins', 'code-ops-suite', 'hooks', `${h}.mjs`), join(dir, 'hooks', `${h}.mjs`));
  // Both hooks import the shared spawn helper beside them.
  cpSync(join(root, 'plugins', 'code-ops-suite', 'hooks', 'recall-spawn.mjs'), join(dir, 'hooks', 'recall-spawn.mjs'));
  cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
  const script = join(dir, 'scripts', 'transcript-recall.mjs');
  if (!withScript) rmSync(script, { force: true });
  else if (stub) {
    // Records its argv and cwd, then exits: the spawn contract, with no build behind it.
    writeFileSync(script, "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.STUB_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + '\\n');\n");
  }
  return dir;
}

function sandbox(label, opts) {
  const home = mkdtempSync(join(tmpdir(), `prebuild-${label}-home-`));
  const work = mkdtempSync(join(tmpdir(), `prebuild-${label}-work-`));
  const box = {
    home, work, plugin: plugin(label, opts), session: `prebuild-${label}`,
    transcript: join(work, 'session.jsonl'), ledger: join(home, 'receipts.jsonl'), stubLog: join(home, 'stub.log'),
    env: { ...process.env, CODE_OPS_HOME: home, HOME: home, USERPROFILE: home },
  };
  box.env.CODE_OPS_RECEIPTS = box.ledger;
  box.env.STUB_LOG = box.stubLog;
  delete box.env.CODE_OPS_RECALL;
  box.recall = join(home, '.claude', 'code-ops', 'recall');
  box.dir = indexDir(work, box.session, home);
  boxes.push(box);
  return box;
}

const payload = (box, extra = {}) => JSON.stringify({ session_id: box.session, transcript_path: box.transcript, cwd: box.work, hook_event_name: 'PreCompact', reason: 'other', ...extra });

// Runs one hook to completion on the payload and returns its timing, exit, and stdout.
function runHook(box, hook, input, env = box.env) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(box.plugin, 'hooks', `${hook}.mjs`)], { cwd: box.work, env, input, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  return { ms: Date.now() - t0, exitedAt: Date.now(), status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// The same run without blocking, so a gate can watch the build while the hook is still working.
function startHook(box, hook, input) {
  const child = spawn(process.execPath, [join(box.plugin, 'hooks', `${hook}.mjs`)], { cwd: box.work, env: box.env, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
  child.stdin.end(input);
  return new Promise((done) => child.on('close', (status) => done({ status })));
}

const recallCli = (box, args, env = box.env) => {
  const r = spawnSync(process.execPath, [join(box.plugin, 'scripts', 'transcript-recall.mjs'), ...args, '--session', box.session, '--transcript', box.transcript, '--json'], { cwd: box.work, env, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { status: r.status, json, ms: 0 };
};

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const metaOf = (box) => readJson(join(box.dir, 'meta.json'));
const lockPid = (box) => readJson(join(box.dir, 'build.lock'))?.pid;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function until(test, ms = WAIT_MS, step = 25) {
  const stop = Date.now() + ms;
  for (;;) {
    const value = test();
    if (value) return value;
    if (Date.now() > stop) return null;
    await sleep(step);
  }
}

const needleHit = (box) => {
  const r = recallCli(box, ['search', '--terms', NEEDLE]);
  return Boolean(r.json?.results?.length);
};

// ---------------------------------------------------------------- the hook table

const HOOK_CASES = {
  'compact-snapshot': (box, extra) => ({ hook: 'compact-snapshot', input: payload(box, extra) }),
  'session-receipt': (box, extra) => ({ hook: 'session-receipt', input: payload(box, { hook_event_name: 'SessionEnd', reason: 'logout', ...extra }) }),
};

// ---------------------------------------------------------------- gates

async function g1(name) {
  const box = sandbox(`g1-${name}`);
  makeTranscript(box.transcript, box.session, 200 * 1024);
  mkdirSync(box.dir, { recursive: true });
  // A live lock holder (this process) keeps the spawned build waiting, so "the hook returned first"
  // is a fact of the lock and no race against build speed.
  const lock = join(box.dir, 'build.lock');
  writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }));
  const { hook, input } = HOOK_CASES[name](box);
  const ran = runHook(box, hook, input);
  check(`G1 ${name}: the hook exits 0 and prints nothing to the model`, ran.status === 0 && ran.stdout === '', `${ran.status} ${ran.stdout.slice(0, 80)}`);
  await sleep(700);
  check(`G1 ${name}: the build is still blocked after the hook returned (no index yet)`, !existsSync(join(box.dir, 'meta.json')) && existsSync(lock));
  // The spawned build sees a live lock held by another pid and stands down (it never waits and never
  // takes the lock), so the lock stays ours and no index appears until a later call catches up.
  check(`G1 ${name}: the build stood down and left the live lock to its holder`, lockPid(box) === process.pid, String(lockPid(box)));
  rmSync(lock, { force: true });
  const meta = await until(() => metaOf(box), 3000);
  check(`G1 ${name}: no second build ran while the lock was held`, meta === null, JSON.stringify(meta));
  const catchUp = recallCli(box, ['build']);
  check(`G1 ${name}: a later call catches the index up`, catchUp.status === 0 && Boolean(metaOf(box)), JSON.stringify(catchUp.json));
  const status = recallCli(box, ['status']);
  check(`G1 ${name}: the prebuilt index is current for the transcript`, status.json?.current === true && status.json?.action === 'none', JSON.stringify(status.json));
  check(`G1 ${name}: search finds the planted needle`, needleHit(box));
}

async function g2(name) {
  const box = sandbox(`g2-${name}`);
  const size = makeTranscript(box.transcript, box.session, KILL_BYTES);
  const { hook, input } = HOOK_CASES[name](box);
  const exited = startHook(box, hook, input);
  const pid = await until(() => lockPid(box), 20_000, 2);
  let killed = false;
  if (pid && pid !== process.pid && alive(pid)) {
    try { process.kill(pid, 'SIGKILL'); killed = true; } catch { /* already gone */ }
  }
  await until(() => !alive(pid), 10_000, 10);
  const ran = await exited;
  check(`G2 ${name}: the build started and was killed before it wrote an index (${(size / MB).toFixed(1)} MB fixture)`, ran.status === 0 && killed && !existsSync(join(box.dir, 'meta.json')), `status=${ran.status} pid=${pid} killed=${killed} meta=${existsSync(join(box.dir, 'meta.json'))}`);
  const status = recallCli(box, ['status']);
  check(`G2 ${name}: a later status call catches the index up from the stale lock`, status.status === 0 && status.json?.current === true && existsSync(join(box.dir, 'meta.json')), JSON.stringify(status.json));
  check(`G2 ${name}: search finds the planted needle after the catch-up`, needleHit(box));
}

async function g3(name) {
  const box = sandbox(`g3-${name}`, { stub: true });
  makeTranscript(box.transcript, box.session, 4096);
  const logged = () => (existsSync(box.stubLog) ? readFileSync(box.stubLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  for (const value of ['off', '0', 'false', 'OFF']) {
    const { hook, input } = HOOK_CASES[name](box);
    const ran = runHook(box, hook, input, { ...box.env, CODE_OPS_RECALL: value });
    check(`G3 ${name}: CODE_OPS_RECALL=${value} still exits 0`, ran.status === 0);
  }
  const { hook, input } = HOOK_CASES[name](box);
  const ran = runHook(box, hook, input);
  const calls = await until(() => (logged().length ? logged() : null), 15_000, 20);
  await sleep(300);
  const all = logged();
  check(`G3 ${name}: only the unswitched run spawned the script`, ran.status === 0 && all.length === 1, `${all.length} calls`);
  const call = all[0];
  const want = ['build', '--session', box.session, '--transcript', box.transcript];
  check(`G3 ${name}: the spawn passes build, the session, and the transcript`, Boolean(calls) && JSON.stringify(call?.argv) === JSON.stringify(want), JSON.stringify(call?.argv));
  const samePath = (a, b) => a && b && resolve(a).toLowerCase() === resolve(b).toLowerCase();
  check(`G3 ${name}: the child runs in the payload cwd`, samePath(call?.cwd, box.work), String(call?.cwd));
}

async function g4(name) {
  const present = sandbox(`g4p-${name}`, { stub: true });
  const missing = sandbox(`g4m-${name}`, { withScript: false });
  const noSession = sandbox(`g4s-${name}`, { stub: true });
  for (const b of [present, missing, noSession]) makeTranscript(b.transcript, b.session, 4096);
  const rowOf = (b) => {
    if (!existsSync(b.ledger)) return null;
    const row = JSON.parse(readFileSync(b.ledger, 'utf8').trim().split('\n')[0]);
    delete row.ts;
    return JSON.stringify({ ...row, sessionId: 'x', cwd: 'x' });
  };
  const withScript = (() => { const c = HOOK_CASES[name](present); return runHook(present, c.hook, c.input); })();
  const without = (() => { const c = HOOK_CASES[name](missing); return runHook(missing, c.hook, c.input); })();
  check(`G4 ${name}: a missing script changes neither exit nor stdout`, without.status === withScript.status && without.stdout === withScript.stdout && without.status === 0, `${without.status}/${withScript.status}`);
  if (name === 'session-receipt') check('G4 session-receipt: a missing script leaves the receipt row unchanged', rowOf(missing) !== null && rowOf(missing) === rowOf(present), `${rowOf(missing)} vs ${rowOf(present)}`);
  await until(() => existsSync(present.stubLog), 15_000, 20);
  const c = HOOK_CASES[name](noSession, { session_id: undefined });
  const bare = runHook(noSession, c.hook, c.input);
  await sleep(500);
  check(`G4 ${name}: a payload without a session id spawns nothing and still exits 0`, bare.status === 0 && !existsSync(noSession.stubLog), `${bare.status}`);
  const badCwd = HOOK_CASES[name](present, { cwd: join(present.work, 'does-not-exist') });
  const odd = runHook(present, badCwd.hook, badCwd.input);
  check(`G4 ${name}: a payload cwd that does not exist still exits 0`, odd.status === 0, `${odd.status}`);
}

// G5 is the detached build's own bound (transcript-recall.mjs superviseBuild): a build past its deadline
// exits 1 and frees only a lock it holds, a SIGTERM frees the lock, and a build stands down while another
// live build holds the lock. The deadline is cut from 60 seconds to 4 and the build is made slow in a copy
// of the script (a 60-second sleep inside the lock, where the index write starts), so each case takes
// seconds on any machine. Every build has its own 25-second limit that kills it, so a bound that is
// missing fails the case and leaves no process.
const DEADLINE_MS = 4_000;
const SLOW_ANCHORS = [
  ['const BUILD_LIMIT_MS = 60_000;', `const BUILD_LIMIT_MS = ${DEADLINE_MS};`],
  ["const wrote = writeIndex(ctx, need === 'extend' ? idx : null);", "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000); const wrote = writeIndex(ctx, need === 'extend' ? idx : null);"],
];

function slowBox(label) {
  const box = sandbox(label);
  makeTranscript(box.transcript, box.session, 4096);
  const script = join(box.plugin, 'scripts', 'transcript-recall.mjs');
  let source = readFileSync(script, 'utf8');
  for (const [from, to] of SLOW_ANCHORS) {
    if (!source.includes(from)) throw new Error(`G5 anchor not found, the eval is stale: ${from}`);
    source = source.replace(from, () => to);
  }
  writeFileSync(script, source);
  box.script = script;
  return box;
}

// One detached build, as recall-spawn.mjs starts it, watched instead of released.
function detachedBuild(box) {
  const child = spawn(process.execPath, [box.script, 'build', '--session', box.session, '--transcript', box.transcript], {
    cwd: box.work, env: { ...box.env, CODE_OPS_RECALL_DETACHED: '1' }, stdio: 'ignore', windowsHide: true,
  });
  const started = Date.now();
  const limit = setTimeout(() => child.kill('SIGKILL'), 25_000);
  const done = new Promise((res) => child.on('close', (code, signal) => { clearTimeout(limit); res({ code, signal, ms: Date.now() - started }); }));
  return { child, done };
}

async function g5() {
  const box = slowBox('g5');
  const lock = join(box.dir, 'build.lock');
  const owned = (pid) => () => lockPid(box) === pid;
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore', windowsHide: true });
  try {
    // 1. Deadline, lock still ours: exit 1 at the deadline (not at the 60-second sleep), lock gone.
    let build = detachedBuild(box);
    check('G5 deadline: the build takes its lock', Boolean(await until(owned(build.child.pid), 15_000, 10)), String(lockPid(box)));
    let end = await build.done;
    check('G5 deadline: the build exits 1 at the deadline, well before its own 60-second sleep ends', end.code === 1 && end.ms < 20_000, JSON.stringify(end));
    check('G5 deadline: the build released its own lock', !existsSync(lock));
    check('G5 deadline: no index was written', metaOf(box) === null);

    // 2. Deadline, lock reclaimed by another builder while this one ran: the lock stays with its holder.
    build = detachedBuild(box);
    await until(owned(build.child.pid), 15_000, 10);
    writeFileSync(lock, JSON.stringify({ pid: holder.pid, at: Date.now() }));
    end = await build.done;
    check('G5 deadline: the build still exits 1', end.code === 1, JSON.stringify(end));
    check('G5 deadline: a lock another process holds is left alone', lockPid(box) === holder.pid, String(lockPid(box)));
    rmSync(lock, { force: true });

    // 3. A SIGTERM during the build frees the lock. win32 delivers no SIGTERM to a handler.
    if (process.platform === 'win32') console.log('skip G5 SIGTERM: win32 does not deliver SIGTERM to a handler, so the case runs on other platforms');
    else {
      build = detachedBuild(box);
      await until(owned(build.child.pid), 15_000, 10);
      build.child.kill('SIGTERM');
      end = await build.done;
      check('G5 SIGTERM: the build exits 143 at once', end.code === 143 && end.ms < 20_000, JSON.stringify(end));
      check('G5 SIGTERM: the build released its lock', !existsSync(lock));
    }

    // 4. A second build stands down while a live build holds the lock, and the first build keeps it.
    const first = detachedBuild(box);
    await until(owned(first.child.pid), 15_000, 10);
    const second = await detachedBuild(box).done;
    check('G5 stand-down: the second build exits 0 at once', second.code === 0 && second.ms < 15_000, JSON.stringify(second));
    check('G5 stand-down: the first build keeps its lock and nothing was built', lockPid(box) === first.child.pid && metaOf(box) === null, `${lockPid(box)} ${first.child.pid}`);
    first.child.kill('SIGKILL');
    await first.done;
  } finally {
    holder.kill('SIGKILL');
  }
}

async function measure() {
  const box = sandbox('measure');
  const size = makeTranscript(box.transcript, box.session, BUILD_MIN_BYTES + MB);
  const t0 = Date.now();
  const built = recallCli(box, ['build']);
  const fullMs = Date.now() - t0;
  check(`measure: a full build of a ${(size / MB).toFixed(1)} MB fixture succeeds`, built.status === 0 && size >= BUILD_MIN_BYTES, JSON.stringify(built.json));
  console.log(`info full build: ${fullMs} ms for ${size} bytes (${(size / MB).toFixed(1)} MB), ${built.json?.nodes ?? '?'} nodes`);
  for (const name of HOOKS) {
    const b = sandbox(`measure-${name}`);
    makeTranscript(b.transcript, b.session, BUILD_MIN_BYTES + MB);
    const { hook, input } = HOOK_CASES[name](b);
    const started = Date.now();
    const ran = runHook(b, hook, input);
    const meta = await until(() => metaOf(b));
    console.log(`info ${name}: hook returned in ${ran.ms} ms, index visible after ${meta ? Date.now() - started : 'never'} ms`);
    check(`measure ${name}: the prebuild produced an index on the large fixture`, ran.status === 0 && Boolean(meta));
    await until(() => !existsSync(join(b.dir, 'build.lock')));
  }
}

// ---------------------------------------------------------------- cleanup

async function cleanup() {
  for (const box of boxes) {
    const pid = lockPid(box);
    if (pid && pid !== process.pid && alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  await sleep(200);
  for (const box of boxes) {
    for (const dir of [box.home, box.work, box.plugin]) {
      for (let i = 0; i < 20; i++) {
        try { rmSync(dir, { recursive: true, force: true }); break; } catch { await sleep(250); }
      }
    }
  }
}

try {
  for (const name of HOOKS) {
    await g1(name);
    await g2(name);
    await g3(name);
    await g4(name);
  }
  await g5();
  await measure();
} finally {
  await cleanup();
}

console.log(fails.length ? `FAIL ${fails.length}: ${fails.join('; ')}` : 'recall-prebuild eval: all gates pass');
process.exit(fails.length ? 1 : 0);
