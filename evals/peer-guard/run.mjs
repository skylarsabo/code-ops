#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/peer-guard.mjs, the PreToolUse guard that
// denies a message to a peer session that already handed off. It pins the contract:
//   - a handed-off target named by hostSessionId, sessionId, or name (case-insensitive) is denied,
//     and the reason names the live head's name, host session id, and run folder;
//   - a two-hop chain names the head, not the first successor;
//   - a target or successor that wrote an unconsumed HANDOFF.md is denied as not resumed yet,
//     naming the successor from its Session line;
//   - a SendMessage `to` ending in a ` [<ref>]` suffix matches without the suffix;
//   - a legacy HANDOFF.consumed with no successor link is denied as unresolved;
//   - a live target, an unknown target, an absent record store, another tool, the off switch,
//     and malformed stdin all pass: exit 0 with no output;
//   - Grok's camelCase toolName and toolInput map onto the same checks.
//
//   node evals/peer-guard/run.mjs

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sessionRecordPath } from '../../scripts/transcript-lib.mjs';
import { repoIdentity } from '../../scripts/handoff-state.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(resolve(here, '..', '..'), 'plugins', 'code-ops-suite', 'hooks', 'peer-guard.mjs');
const editHook = join(resolve(here, '..', '..'), 'plugins', 'code-ops-suite', 'hooks', 'index-refresh.mjs');
const endHook = join(resolve(here, '..', '..'), 'plugins', 'code-ops-suite', 'hooks', 'session-receipt.mjs');
const stateScript = join(resolve(here, '..', '..'), 'scripts', 'handoff-state.mjs');
const { fails, check } = tally((name, detail) => `${name} — ${String(detail).slice(0, 300)}`);

const tmp = mkdtempSync(join(tmpdir(), 'peer-guard-'));
const home = join(tmp, 'home');
const repo = join(tmp, 'repo');
const runs = 'repo-docs/80 Runs';

function run(folder, { session, handoff, consumed }) {
  const dir = join(repo, runs, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SESSION.json'), JSON.stringify({ v: 1, ...session }));
  if (handoff) writeFileSync(join(dir, 'HANDOFF.md'), `# Handoff\n\n## Program\n\n- Session: ${handoff}\n- Hop: 1\n`);
  if (consumed !== undefined) {
    writeFileSync(join(dir, 'HANDOFF.consumed'), consumed === null
      ? '2026-09-01T00:00:00.000Z\n'
      : JSON.stringify({ v: 2, successorRun: `${runs}/${consumed}` }));
  }
  const file = sessionRecordPath(repo, session.sessionId, home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ v: 1, ...session, runDir: `${runs}/${folder}`, hop: 0, updatedAt: session.updatedAt ?? '2026-09-01T00:00:00.000Z' }));
}

// One-hop chain: alpha handed off to alpha HO 1, which is live.
run('a0', { session: { sessionId: 'sid-a0', hostSessionId: 'local_a0', name: 'Alpha' }, handoff: 'Alpha HO 1', consumed: 'a1' });
run('a1', { session: { sessionId: 'sid-a1', hostSessionId: 'local_a1', name: 'Alpha HO 1', updatedAt: '2026-09-02T00:00:00.000Z' } });
// Two-hop chain: beta -> beta HO 1 -> beta HO 2 (live, no host id recorded).
run('b0', { session: { sessionId: 'sid-b0', name: 'Beta' }, handoff: 'Beta HO 1', consumed: 'b1' });
run('b1', { session: { sessionId: 'sid-b1', name: 'Beta HO 1' }, handoff: 'Beta HO 2', consumed: 'b2' });
run('b2', { session: { sessionId: 'sid-b2', hostSessionId: 'local_b2', name: 'Beta HO 2' } });
// Awaiting resume: gamma -> gamma HO 1, which wrote its own unconsumed handoff.
run('c0', { session: { sessionId: 'sid-c0', name: 'Gamma' }, handoff: 'Gamma HO 1', consumed: 'c1' });
run('c1', { session: { sessionId: 'sid-c1', name: 'Gamma HO 1' }, handoff: 'Gamma HO 2' });
// Legacy marker with no successor link.
run('d0', { session: { sessionId: 'sid-d0', name: 'Delta' }, handoff: 'Delta HO 1', consumed: null });
// One-hop chain whose live head records no host session id.
run('e0', { session: { sessionId: 'sid-e0', hostSessionId: 'local_e0', name: 'Epsilon' }, handoff: 'Epsilon HO 1', consumed: 'e1' });
run('e1', { session: { sessionId: 'sid-e1', name: 'Epsilon HO 1' } });

function call(input, env = {}) {
  const r = spawnSync(process.execPath, [hook], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CODE_OPS_HOME: home, CODE_OPS_PEER_GUARD: '', ...env },
  });
  let out = null;
  try { out = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { out = 'unparsable'; }
  return { status: r.status, stdout: r.stdout, out, reason: out?.hookSpecificOutput?.permissionDecisionReason ?? '', notice: out?.hookSpecificOutput?.additionalContext ?? '' };
}
const send = (target, extra = {}) => ({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'mcp__ccd_session_mgmt__send_message', tool_input: { session_id: target, message: 'hi' }, ...extra });
const denied = (r) => r.status === 0 && r.out?.hookSpecificOutput?.permissionDecision === 'deny' && r.out.hookSpecificOutput.hookEventName === 'PreToolUse';
const silent = (r) => r.status === 0 && r.stdout === '';
const redirected = (r, field, value) => r.status === 0 && r.out?.hookSpecificOutput?.hookEventName === 'PreToolUse'
  && r.out.hookSpecificOutput.updatedInput?.[field] === value && !r.out.hookSpecificOutput.permissionDecision;

try {
  let r = call(send('local_a0'));
  check('redirect-rewrites-target: hostSessionId target is rewritten to the head (Claude/Codex shape)', redirected(r, 'session_id', 'local_a1')
    && r.out.hookSpecificOutput.updatedInput.message === 'hi' && r.notice.includes('Alpha HO 1') && r.notice.includes(`${runs}/a1`), r.stdout);

  r = call(send('SID-A0'));
  check('handed-off target by sessionId, any case, is redirected', redirected(r, 'session_id', 'local_a1'), r.stdout);

  r = call({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'SendMessage', tool_input: { to: 'alpha', message: 'hi' } });
  check('SendMessage to a handed-off name is redirected to the head name', redirected(r, 'to', 'Alpha HO 1'), r.stdout);

  r = call(send('Beta'));
  check('two-hop chain redirects to the head', redirected(r, 'session_id', 'local_b2') && r.notice.includes(`${runs}/b2`) && !r.notice.includes('Beta HO 1 ('), r.stdout);

  r = call(send('Beta HO 1'));
  check('a middle hop also redirects to the head', redirected(r, 'session_id', 'local_b2'), r.stdout);

  r = call(send('Epsilon'));
  check('a live head without a host session id is still denied for session_id', denied(r) && r.reason.includes('Epsilon HO 1')
    && r.reason.includes('no host session id recorded'), r.stdout);

  r = call(send('Gamma'));
  check('awaiting resume is denied as not resumed yet', denied(r) && r.reason.includes('has not been resumed yet')
    && r.reason.includes('Gamma HO 2') && r.reason.includes('co handoff live'), r.stdout);

  r = call(send('Gamma HO 1'));
  check('target with its own unconsumed HANDOFF.md is denied naming its Session line', denied(r)
    && r.reason.includes('has not been resumed yet') && r.reason.includes('Gamma HO 2') && r.reason.includes(`${runs}/c1/HANDOFF.md`), r.stdout);

  r = call({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'SendMessage', tool_input: { to: 'Beta HO 1 [3fa9c1]', message: 'hi' } });
  check('SendMessage ref suffix is stripped before matching', redirected(r, 'to', 'Beta HO 2'), r.stdout);
  check('live name with a ref suffix passes', silent(call({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'SendMessage', tool_input: { to: 'Beta HO 2 [3fa9c1]' } })), '');

  r = call(send('Delta'));
  check('legacy consumed marker is denied as unresolved', denied(r) && r.reason.includes('could not be resolved'), r.stdout);

  check('live target passes', silent(call(send('local_a1'))), '');
  check('live target by name passes', silent(call(send('Beta HO 2'))), '');
  check('unknown target passes', silent(call(send('local_nobody'))), '');
  check('prefix of a handed-off id passes (exact match only)', silent(call(send('local_a'))), '');
  check('no record store passes', silent(call(send('local_a0'), { CODE_OPS_HOME: join(tmp, 'empty') })), '');
  check('another tool passes', silent(call({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'Bash', tool_input: { session_id: 'local_a0' } })), '');
  check('another event passes', silent(call(send('local_a0', { hook_event_name: 'PostToolUse' }))), '');
  for (const off of ['0', 'off', 'FALSE']) check(`CODE_OPS_PEER_GUARD=${off} passes`, silent(call(send('local_a0'), { CODE_OPS_PEER_GUARD: off })), '');
  for (const [name, input] of [['bad JSON', '{not json'], ['empty stdin', ''], ['JSON null', 'null'], ['string target missing', JSON.stringify(send(42))]]) {
    check(`malformed input passes: ${name}`, silent(call(input)), '');
  }

  r = call({ hook_event_name: 'PreToolUse', cwd: repo, toolName: 'SendMessage', toolInput: { to: 'Alpha' }, sessionId: 'x' }, { GROK_PLUGIN_ROOT: tmp });
  check('deny-kept-on-unverified-host: Grok camelCase payload is denied, not rewritten', denied(r) && r.reason.includes('Alpha HO 1') && !r.stdout.includes('updatedInput'), r.stdout);
  r = call(send('local_a0'), { GROK_PLUGIN_ROOT: tmp });
  check('deny-kept-on-unverified-host: GROK_PLUGIN_ROOT alone keeps the denial', denied(r) && r.reason.includes('local_a1'), r.stdout);

  boardCases();
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Presence board and the repository-keyed session store (design C1), exercised through
// handoff-state.mjs, the PostToolUse edit hook, the SessionEnd hook, and the peer guard.
function boardCases() {
  const bhome = join(tmp, 'bhome');
  const main = join(tmp, 'wt', 'main');
  const linked = join(tmp, 'wt', 'main', '.claude', 'worktrees', 'side');
  mkdirSync(join(main, '.git', 'worktrees', 'side'), { recursive: true });
  writeFileSync(join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(join(main, '.git', 'worktrees', 'side', 'HEAD'), 'ref: refs/heads/feat/side\n');
  mkdirSync(linked, { recursive: true });
  writeFileSync(join(linked, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'side')}\n`);
  const env = { ...process.env, CODE_OPS_HOME: bhome, CODE_OPS_PEER_GUARD: '', CODE_OPS_INDEX: 'off', CODE_OPS_RECEIPTS: 'off' };
  const cli = (cwd, ...args) => spawnSync(process.execPath, [stateScript, ...args], { cwd, encoding: 'utf8', env });
  const hookRun = (file, cwd, payload, extra = {}) => spawnSync(process.execPath, [file], { cwd, input: JSON.stringify(payload), encoding: 'utf8', env: { ...env, ...extra } });
  const files = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name)) : []);

  const a = repoIdentity(main);
  const b = repoIdentity(linked);
  check('worktree resolves to repo key: a linked worktree shares the main key', a.key === b.key && b.worktree === '.claude/worktrees/side' && a.worktree === '.', JSON.stringify({ a: a.key, b: b.key, w: b.worktree }));
  check('worktree resolves to repo key: the key holds no absolute path', !a.key.includes(':') && !a.key.includes('/') && !a.key.includes(tmp.replace(/[^A-Za-z0-9]/g, '-')), a.key);

  let r = cli(linked, 'board-claim', 'docs/a.md', 'src/b.mjs', '--session', 'sid-side');
  check('claim/release round trip: claim records both paths', r.status === 0 && r.stdout.includes('docs/a.md, src/b.mjs'), r.stdout + r.stderr);
  r = cli(linked, 'board-release', 'docs/a.md', '--session', 'sid-side');
  check('claim/release round trip: release of one path keeps the other', r.status === 0 && r.stdout.trim() === 'claims: src/b.mjs', r.stdout + r.stderr);
  r = cli(linked, 'board-release', '--session', 'sid-side');
  check('claim/release round trip: bare release clears every claim', r.status === 0 && r.stdout.trim() === 'claims: none', r.stdout + r.stderr);
  r = cli(linked, 'board-claim', '../../outside.md', '--session', 'sid-side');
  check('claim outside the worktree is refused', r.status !== 0, r.stdout + r.stderr);
  cli(linked, 'board-claim', 'docs/a.md', '--session', 'sid-side');
  cli(linked, 'board-task', 'build', 'the', 'board', '--session', 'sid-side');

  r = hookRun(editHook, linked, { hook_event_name: 'PostToolUse', tool_name: 'Edit', session_id: 'sid-side', cwd: linked, tool_input: { file_path: join(linked, 'src', 'c.mjs') } });
  const r2 = hookRun(editHook, linked, { hook_event_name: 'PostToolUse', tool_name: 'Write', session_id: 'sid-side', cwd: linked, tool_input: { file_path: join(tmp, 'elsewhere.txt') } });
  check('edit hook records a worktree-relative edit silently', r.status === 0 && r.stdout === '' && r2.status === 0 && r2.stdout === '', r.stdout + r.stderr);

  r = cli(main, 'board');
  check('co board from the main worktree lists the linked session', r.status === 0 && r.stdout.includes('[live] branch feat/side') && r.stdout.includes('worktree .claude/worktrees/side')
    && r.stdout.includes('claims: docs/a.md') && r.stdout.includes('src/c.mjs (') && !r.stdout.includes('elsewhere') && r.stdout.includes('task: build the board'), r.stdout + r.stderr);

  const boardRoot = join(bhome, '.claude', 'code-ops', 'board');
  const treeFiles = files(join(tmp, 'wt'));
  const boardFiles = files(boardRoot);
  const bodies = boardFiles.map((p) => readFileSync(p, 'utf8'));
  check('board-writes-home-only: the tree gains no file and every board record sits under home', treeFiles.length === 3 && boardFiles.length === 1, JSON.stringify(treeFiles));
  check('board-writes-home-only: no board record holds an absolute path', bodies.length === 1 && bodies.every((t) => !t.includes(JSON.stringify(tmp).slice(1, -1)) && !t.includes(tmp.replace(/\\/g, '/'))
    && !/"[A-Za-z]:[\\/]/.test(t) && !/"\/(tmp|home|Users|var)\//.test(t)), bodies.join('\n'));

  r = hookRun(endHook, linked, { hook_event_name: 'SessionEnd', session_id: 'sid-side', cwd: linked });
  check('SessionEnd marks the board record ended', r.status === 0 && r.stdout === '' && cli(main, 'board').stdout.includes('[ended]'), r.stdout + r.stderr);

  // Peer guard from the main worktree follows a chain that lives in the linked worktree.
  const runsDir = join(linked, 'x-docs', '80 Runs');
  const store = join(bhome, '.claude', 'code-ops', 'sessions', a.key);
  mkdirSync(store, { recursive: true });
  for (const [dir, session] of [['s0', { sessionId: 'sid-s0', hostSessionId: 'local_s0', name: 'Side' }], ['s1', { sessionId: 'sid-s1', hostSessionId: 'local_s1', name: 'Side HO 1' }]]) {
    mkdirSync(join(runsDir, dir), { recursive: true });
    writeFileSync(join(runsDir, dir, 'SESSION.json'), JSON.stringify({ v: 1, ...session }));
    writeFileSync(join(store, `${session.sessionId}.json`), JSON.stringify({ v: 1, ...session, worktree: '.claude/worktrees/side', runDir: `x-docs/80 Runs/${dir}`, updatedAt: '2026-09-01T00:00:00.000Z' }));
  }
  writeFileSync(join(runsDir, 's0', 'HANDOFF.md'), '# Handoff\n');
  writeFileSync(join(runsDir, 's0', 'HANDOFF.consumed'), JSON.stringify({ v: 2, successorRun: 'x-docs/80 Runs/s1' }));
  const sendSide = { hook_event_name: 'PreToolUse', cwd: main, tool_name: 'mcp__ccd_session_mgmt__send_message', tool_input: { session_id: 'local_s0' } };
  r = call(sendSide, { CODE_OPS_HOME: bhome });
  check('peer guard sees a worktree session through the repository key', redirected(r, 'session_id', 'local_s1'), r.stdout);

  // board-corrupt-fails-open: a corrupt board record, board path, or session record yields no output and no crash.
  writeFileSync(boardFiles[0], '{not json');
  writeFileSync(join(boardRoot, a.key, 'stray.json'), 'null');
  r = cli(main, 'board');
  check('board-corrupt-fails-open: co board skips corrupt records', r.status === 0 && r.stdout.includes('no sessions recorded'), r.stdout + r.stderr);
  const editD = { hook_event_name: 'PostToolUse', tool_name: 'Edit', session_id: 'sid-side', cwd: linked, tool_input: { file_path: join(linked, 'd.mjs') } };
  r = hookRun(editHook, linked, editD);
  check('board-corrupt-fails-open: the edit hook rewrites a corrupt record silently', r.status === 0 && r.stdout === '' && JSON.parse(readFileSync(boardFiles[0], 'utf8')).edits[0].path === 'd.mjs', r.stdout + r.stderr);
  writeFileSync(join(store, 'sid-s0.json'), '{not json');
  check('board-corrupt-fails-open: peer guard passes a corrupt session record', silent(call(sendSide, { CODE_OPS_HOME: bhome })), '');
  rmSync(boardRoot, { recursive: true, force: true });
  writeFileSync(boardRoot, 'not a directory');
  r = hookRun(editHook, linked, editD);
  const r3 = hookRun(endHook, linked, { hook_event_name: 'SessionEnd', session_id: 'sid-side', cwd: linked });
  check('board-corrupt-fails-open: an unusable board path leaves both hooks silent', r.status === 0 && r.stdout === '' && r3.status === 0 && r3.stdout === '', r.stderr + r3.stderr);
  r = hookRun(editHook, linked, { ...editD, session_id: 'sid-off' }, { CODE_OPS_PEER_GUARD: 'off', CODE_OPS_HOME: join(tmp, 'offhome') });
  check('CODE_OPS_PEER_GUARD=off writes no board record', r.status === 0 && !existsSync(join(tmp, 'offhome')), r.stderr);
}

console.log(fails.length ? `peer-guard: ${fails.length} failure(s)\n${fails.join('\n')}` : 'peer-guard: all checks pass');
process.exit(fails.length ? 1 : 0);
