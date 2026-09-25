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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sessionRecordPath } from '../../scripts/transcript-lib.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const hook = join(resolve(here, '..', '..'), 'plugins', 'code-ops-suite', 'hooks', 'peer-guard.mjs');
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

function call(input, env = {}) {
  const r = spawnSync(process.execPath, [hook], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CODE_OPS_HOME: home, CODE_OPS_PEER_GUARD: '', ...env },
  });
  let out = null;
  try { out = r.stdout.trim() ? JSON.parse(r.stdout) : null; } catch { out = 'unparsable'; }
  return { status: r.status, stdout: r.stdout, out, reason: out?.hookSpecificOutput?.permissionDecisionReason ?? '' };
}
const send = (target, extra = {}) => ({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'mcp__ccd_session_mgmt__send_message', tool_input: { session_id: target, message: 'hi' }, ...extra });
const denied = (r) => r.status === 0 && r.out?.hookSpecificOutput?.permissionDecision === 'deny' && r.out.hookSpecificOutput.hookEventName === 'PreToolUse';
const silent = (r) => r.status === 0 && r.stdout === '';

try {
  let r = call(send('local_a0'));
  check('handed-off target by hostSessionId is denied naming the successor', denied(r)
    && r.reason.includes('Alpha HO 1') && r.reason.includes('host session local_a1') && r.reason.includes(`${runs}/a1`), r.stdout);

  r = call(send('SID-A0'));
  check('handed-off target by sessionId, any case, is denied', denied(r) && r.reason.includes('local_a1'), r.stdout);

  r = call({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'SendMessage', tool_input: { to: 'alpha', message: 'hi' } });
  check('SendMessage to a handed-off name is denied', denied(r) && r.reason.includes('Alpha HO 1'), r.stdout);

  r = call(send('Beta'));
  check('two-hop chain names the head', denied(r) && r.reason.includes('Beta HO 2') && r.reason.includes('local_b2')
    && r.reason.includes(`${runs}/b2`) && !r.reason.includes('Beta HO 1 ('), r.stdout);

  r = call(send('Beta HO 1'));
  check('a middle hop also resolves to the head', denied(r) && r.reason.includes(`${runs}/b2`), r.stdout);

  r = call(send('Gamma'));
  check('awaiting resume is denied as not resumed yet', denied(r) && r.reason.includes('has not been resumed yet')
    && r.reason.includes('Gamma HO 2') && r.reason.includes('co handoff live'), r.stdout);

  r = call(send('Gamma HO 1'));
  check('target with its own unconsumed HANDOFF.md is denied naming its Session line', denied(r)
    && r.reason.includes('has not been resumed yet') && r.reason.includes('Gamma HO 2') && r.reason.includes(`${runs}/c1/HANDOFF.md`), r.stdout);

  r = call({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'SendMessage', tool_input: { to: 'Beta HO 1 [3fa9c1]', message: 'hi' } });
  check('SendMessage ref suffix is stripped before matching', denied(r) && r.reason.includes('Beta HO 2'), r.stdout);
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
  check('Grok camelCase payload is denied the same way', denied(r) && r.reason.includes('Alpha HO 1'), r.stdout);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `peer-guard: ${fails.length} failure(s)\n${fails.join('\n')}` : 'peer-guard: all checks pass');
process.exit(fails.length ? 1 : 0);
