#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/agent-ledger.mjs and scripts/agent-ledger.mjs.
// It pins the contract that keeps a background agent from being forgotten at a handoff:
//   - a background launch followed by its SubagentStop report leaves nothing pending;
//   - a background launch with no report is pending, and `co agents pending` prints it;
//   - the agent id parses from `agentId: <id>` text when the structured field is absent;
//   - a SubagentStop with an empty agent_type (an internal summarizer) writes nothing;
//   - a foreground launch that completed is never pending;
//   - a description is cut to 80 characters and no prompt is stored;
//   - `CODE_OPS_AGENT_LEDGER=0` writes nothing;
//   - malformed stdin and a payload with no session exit 0 silently;
//   - pending across sessions is scoped to the current directory and sorted newest first.
//
//   node evals/agent-ledger/run.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally } from '../harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hook = join(repo, 'plugins', 'code-ops-suite', 'hooks', 'agent-ledger.mjs');
const co = join(repo, 'scripts', 'co.mjs');
const { pendingAgents } = await import(pathToFileURL(join(repo, 'scripts', 'agent-ledger.mjs')).href);
const { fails, check } = tally((name, detail) => `${name} - ${String(detail).slice(0, 300)}`);

const home = mkdtempSync(join(tmpdir(), 'agent-ledger-eval-'));
const stateDir = join(home, '.claude', 'code-ops', 'agents');
const cwd = join(home, 'project');
const env = (extra = {}) => ({ ...process.env, CODE_OPS_HOME: home, CODE_OPS_AGENT_LEDGER: '', GROK_PLUGIN_ROOT: '', ...extra });
const feed = (input, extra) => spawnSync(process.execPath, [hook], { input, encoding: 'utf8', env: env(extra), timeout: 20000 });
const send = (payload, extra) => feed(JSON.stringify(payload), extra);
const files = () => (existsSync(stateDir) ? readdirSync(stateDir) : []);
const pending = (sessionId) => pendingAgents({ sessionId, stateDir });

const launch = (session, id, over = {}) => ({
  hook_event_name: 'PostToolUse', session_id: session, cwd, tool_name: 'Agent',
  tool_input: { subagent_type: 'code-ops-suite:implementer', description: 'Build the ledger', prompt: 'SECRET-PROMPT-TEXT', run_in_background: true },
  tool_response: { status: 'async_launched', agentId: id }, ...over,
});
const stop = (session, id, type = 'code-ops-suite:implementer') => ({ hook_event_name: 'SubagentStop', session_id: session, cwd, agent_id: id, agent_type: type });

try {
  let r = send(launch('s1', 'aaa111'));
  check('a. a background launch exits 0 and is pending', r.status === 0 && r.stdout === '' && pending('s1').length === 1 && pending('s1')[0].agent_id === 'aaa111', `${r.status} ${r.stderr} ${JSON.stringify(pending('s1'))}`);
  r = send(stop('s1', 'aaa111'));
  check('b. the report clears it', r.status === 0 && pending('s1').length === 0, JSON.stringify(pending('s1')));

  send(launch('s2', 'bbb222'));
  check('c. a launch with no report stays pending with its type and description', pending('s2').length === 1
    && pending('s2')[0].agent_type === 'code-ops-suite:implementer' && pending('s2')[0].description === 'Build the ledger', JSON.stringify(pending('s2')));

  send(launch('s3', 'x', { tool_response: { status: 'async_launched', content: [{ type: 'text', text: 'Async agent launched.\nagentId: ccc333abc (internal ID)' }] } }));
  check('d. an agent id found only in text content parses', pending('s3')[0]?.agent_id === 'ccc333abc', JSON.stringify(pending('s3')));
  send(launch('s3b', 'x', { tool_response: { status: 'async_launched', content: 'no id here' } }));
  check('d2. a launch with no agent id records nothing', pending('s3b').length === 0 && files().length === 3, files().join(','));

  send(stop('s4', 'ddd444', ''));
  send(stop('s4', 'ddd444', null));
  check('e. a SubagentStop with an empty or absent agent_type writes nothing', files().length === 3, files().join(','));

  send(launch('s5', 'eee555', { tool_input: { subagent_type: 'code-ops-suite:probe', description: 'Probe', prompt: 'p' }, tool_response: { status: 'completed', agentId: 'eee555', content: [{ type: 'text', text: 'done' }] } }));
  check('f. a foreground completed launch is not pending', pending('s5').length === 0 && files().length === 4, JSON.stringify(pending('s5')));

  send(launch('s6', 'fff666', { tool_name: 'Task', tool_input: { subagent_type: 'x', description: 'd'.repeat(200), prompt: 'SECRET-PROMPT-TEXT', run_in_background: true }, tool_response: { agentId: 'fff666' } }));
  const stored = files().map((f) => readFileSync(join(stateDir, f), 'utf8')).join('');
  check('g. Task is accepted, a description is cut to 80 characters, and no prompt is stored',
    pending('s6')[0]?.description.length === 80 && !stored.includes('SECRET-PROMPT-TEXT'), JSON.stringify(pending('s6')));

  send(launch('s10', 'jjj000'));
  send({ ...stop('s10', 'jjj000'), error: 'boom' });
  const rows10 = readFileSync(join(stateDir, files().find((f) => readFileSync(join(stateDir, f), 'utf8').includes('jjj000'))), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  check('g2. rows use the dispatch ledger statuses and snake_case fields; an error stop is failed and settles the agent',
    pending('s10').length === 0 && rows10[0].status === 'dispatched' && rows10[1].status === 'failed'
    && rows10[0].launched_at && rows10[1].reported_at && rows10[0].session_id === 's10' && rows10[1].agent_type === 'code-ops-suite:implementer', JSON.stringify(rows10));

  const n = files().length;
  send(launch('s7', 'ggg777'), { CODE_OPS_AGENT_LEDGER: '0' });
  send(stop('s1', 'zzz'), { CODE_OPS_AGENT_LEDGER: 'OFF' });
  check('h. the off switch writes nothing', files().length === n && pending('s7').length === 0, files().join(','));

  const bad = ['', 'not json', '{"tool_name":', '[]', 'null', JSON.stringify({ tool_name: 'Agent' }), JSON.stringify({ tool_name: 'Agent', session_id: 's8', tool_response: 7 })];
  const results = bad.map((input) => feed(input));
  check('i. malformed stdin and incomplete payloads exit 0 with no output', results.every((x) => x.status === 0 && x.stdout === '' && x.stderr === ''), results.map((x) => `${x.status}:${x.stderr}`).join('|'));
  check('i2. the hook stays silent under Grok', (() => { const m = files().length; send(launch('s9', 'hhh888'), { GROK_PLUGIN_ROOT: '/x' }); return files().length === m; })());

  const tooOld = pendingAgents({ stateDir, cwd, now: Date.now() + 15 * 24 * 3_600_000 });
  const all = pendingAgents({ stateDir, cwd });
  const newestFirst = all.every((a, i) => i === 0 || Date.parse(all[i - 1].launched_at) >= Date.parse(a.launched_at));
  check('j. across sessions, pending lists this directory newest first, without settled agents',
    newestFirst && all.map((a) => a.agent_id).sort().join() === 'bbb222,ccc333abc,fff666', JSON.stringify(all.map((a) => a.agent_id)));
  check('j2. another directory and stale files are excluded', pendingAgents({ stateDir, cwd: join(home, 'elsewhere') }).length === 0 && tooOld.length === 0, '');

  const cli = (args) => spawnSync(process.execPath, [co, 'agents', 'pending', ...args], { encoding: 'utf8', env: env(), cwd: home, timeout: 20000 });
  const line = cli(['--session', 's2']);
  check('k. co agents pending prints agentId, type, age, and description', line.status === 0 && /^bbb222 code-ops-suite:implementer <1m Build the ledger$/m.test(line.stdout), `${line.status} ${line.stdout} ${line.stderr}`);
  check('k2. co agents pending prints none for a settled session', cli(['--session', 's1']).stdout.trim() === 'none', cli(['--session', 's1']).stdout);
  const json = cli(['--session', 's2', '--json']);
  let parsed = null;
  try { parsed = JSON.parse(json.stdout); } catch { /* checked below */ }
  check('k3. --json prints the list', Array.isArray(parsed) && parsed[0]?.agent_id === 'bbb222', json.stdout);
  check('k4. a bad flag exits 2', cli(['--bogus']).status === 2, '');
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nagent-ledger: all checks passed');
