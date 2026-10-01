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
//   - pending across sessions is scoped to the current directory and sorted newest first;
//   - a lost SubagentStop gets a recorded exit: `co agents settle <id> --failed --reason` appends a
//     failed row and clears pending; a missing reason or an unknown id fails;
//   - pending merges dispatched DISPATCH_LEDGER rows, deduped on actor id, names its sources, and
//     prints `unknown` only on a host signal (a missing file is an empty source);
//   - the opt-in payload capture (env var or a `capture.on` flag file) writes key names plus an
//     allowlist of scalar values, records the host from environment variable names, dedupes on host,
//     keys, and values, is off by default, and runs before the Grok early return;
//   - the SessionEnd marker (`markSessionEnded`) is one idempotent `ended` row, never an agent; the
//     `endedOnly` read lists a session's workers only after its marker, and the off switch writes none.
//
//   node evals/agent-ledger/run.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally } from '../harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hook = join(repo, 'plugins', 'code-ops-suite', 'hooks', 'agent-ledger.mjs');
const co = join(repo, 'scripts', 'co.mjs');
const { captureKeys, captureOn, markSessionEnded, pendingAgents, pendingReport } = await import(pathToFileURL(join(repo, 'scripts', 'agent-ledger.mjs')).href);
const { fails, check } = tally((name, detail) => `${name} - ${String(detail).slice(0, 300)}`);

const home = mkdtempSync(join(tmpdir(), 'agent-ledger-eval-'));
const stateDir = join(home, '.claude', 'code-ops', 'agents');
const cwd = join(home, 'project');
const env = (extra = {}) => ({ ...process.env, CODE_OPS_HOME: home, CODE_OPS_AGENT_LEDGER: '', CODE_OPS_AGENT_LEDGER_CAPTURE: '', GROK_PLUGIN_ROOT: '', ...extra });
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

  // PR 1: a lost report gets a recorded exit, and pending merges the dispatch ledger.
  const agents = (verb, args, extra) => spawnSync(process.execPath, [co, 'agents', verb, ...args], { encoding: 'utf8', env: env(extra), cwd: home, timeout: 20000 });
  const ledgerRows = (session) => {
    const file = files().find((f) => readFileSync(join(stateDir, f), 'utf8').includes(`"session_id":"${session}"`));
    return file ? readFileSync(join(stateDir, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };

  send(launch('s11', 'lost111'));
  check('l. a launch whose SubagentStop never arrived is pending', pending('s11').length === 1 && pending('s11')[0].source === 'hook', JSON.stringify(pending('s11')));
  const settle = agents('settle', ['lost111', '--failed', '--reason', 'report lost at handoff', '--session', 's11']);
  const settled11 = ledgerRows('s11');
  check('l2. settle appends a failed row with the reason and clears pending',
    settle.status === 0 && pending('s11').length === 0 && settled11.at(-1)?.status === 'failed' && settled11.at(-1)?.reason === 'report lost at handoff' && settled11.at(-1)?.agent_id === 'lost111',
    `${settle.status} ${settle.stderr} ${JSON.stringify(settled11)}`);

  send(launch('s12', 'lost222'));
  const inferred = agents('settle', ['lost222', '--failed', '--reason', 'abandoned']);
  check('l3. settle without --session finds the launching session from the ledger', inferred.status === 0 && pending('s12').length === 0, `${inferred.status} ${inferred.stderr}`);

  send(launch('s13', 'lost333'));
  const noReason = agents('settle', ['lost333', '--failed']);
  const blankReason = agents('settle', ['lost333', '--failed', '--reason', '   ']);
  const noFailed = agents('settle', ['lost333', '--reason', 'why']);
  check('l4. settle without --reason (or blank, or without --failed) fails and writes nothing',
    noReason.status !== 0 && blankReason.status !== 0 && noFailed.status !== 0 && pending('s13').length === 1 && ledgerRows('s13').length === 1,
    `${noReason.status} ${blankReason.status} ${noFailed.status} ${JSON.stringify(ledgerRows('s13'))}`);
  const nobody = agents('settle', ['nosuchagent', '--failed', '--reason', 'why']);
  check('l5. settle of an unknown id exits non-zero with a message', nobody.status !== 0 && /unknown agent id nosuchagent/.test(nobody.stderr), `${nobody.status} ${nobody.stderr}`);
  const again = agents('settle', ['lost111', '--failed', '--reason', 'again']);
  check('l6. settle of an already settled id exits non-zero', again.status !== 0 && /already reported or failed/.test(again.stderr), `${again.status} ${again.stderr}`);

  const runDir = join(home, 'run');
  mkdirSync(runDir, { recursive: true });
  const dispatchRow = (id, status) => `| ${id} | implementer@model-x | Build ${id} | ${id}.md | ${status} |`;
  writeFileSync(join(runDir, 'DISPATCH_LEDGER.md'), ['| id | role | brief | expected artifact | status |', '| --- | --- | --- | --- | --- |',
    dispatchRow('D-001', 'dispatched'), dispatchRow('D-002', 'reported'), dispatchRow('D-003', 'dispatched'), dispatchRow('D-004', 'dispatched'), dispatchRow('D-005', 'dispatched'), ''].join('\n'));
  writeFileSync(join(runDir, 'DISPATCH_LEDGER.md.journal.jsonl'), [
    { op: 'add', id: 'D-001', status: 'dispatched', actorId: 'dispatchonly1' },
    { op: 'add', id: 'D-002', status: 'dispatched', actorId: 'done2' },
    { op: 'update', id: 'D-002', to: 'reported' },
    { op: 'add', id: 'D-003', status: 'dispatched' },
    { op: 'add', id: 'D-004', status: 'dispatched', actorId: 'both444' },
    { op: 'add', id: 'D-005', status: 'dispatched', actorId: 'stopped555' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  send(launch('s14', 'both444'));
  send(launch('s15', 'stopped555'));
  send(stop('s15', 'stopped555'));

  const merged = pendingReport({ stateDir, cwd, runDir });
  const byId = Object.fromEntries(merged.agents.map((a) => [a.agent_id, a]));
  check('m. a dispatch-only row is pending with source dispatch, named by its actor id (or row id without one)',
    byId.dispatchonly1?.source === 'dispatch' && byId.dispatchonly1.dispatch_id === 'D-001' && byId['D-003']?.source === 'dispatch' && !byId.done2, JSON.stringify(merged.agents.map((a) => [a.agent_id, a.source])));
  check('m2. a row in both sources appears once, from the hook', merged.agents.filter((a) => a.agent_id === 'both444').length === 1 && byId.both444.source === 'hook', JSON.stringify(merged.agents.map((a) => [a.agent_id, a.source])));
  check('m3. a dispatch row whose actor the hook saw report is not pending', !byId.stopped555, JSON.stringify(Object.keys(byId)));
  check('m4. the report names the sources it read and is not unknown', merged.sources.map((s) => s.source).join() === 'hook,dispatch' && merged.sources[1].present === true && merged.sources[1].rows === 5 && merged.unknown === null, JSON.stringify(merged.sources));
  const noRun = pendingReport({ stateDir, cwd, runDir: join(home, 'no-such-run') });
  check('m5. a missing dispatch ledger is an empty source, not unknown', noRun.sources[1].present === false && noRun.sources[1].rows === 0 && noRun.unknown === null && noRun.agents.every((a) => a.source === 'hook'), JSON.stringify(noRun.sources));
  check('m6. unknown appears only on a host signal', pendingReport({ stateDir, cwd, unknown: 'host cannot report workers' }).unknown === 'host cannot report workers' && pendingAgents({ stateDir, cwd }).every((a) => a.source === 'hook'), '');
  const viaCli = agents('pending', ['--run', runDir, '--cwd', join(home, 'elsewhere')]);
  check('m7. co agents pending --run prints dispatch rows on stdout and the sources on stderr', viaCli.status === 0 && /^dispatchonly1 implementer@model-x /m.test(viaCli.stdout) && /sources: hook .*; dispatch .*DISPATCH_LEDGER\.md \(5 row\(s\)\)/.test(viaCli.stderr), `${viaCli.stdout} | ${viaCli.stderr}`);
  const unknownCli = agents('pending', ['--session', 'never-seen', '--unknown', 'host cannot report workers']);
  check('m8. an empty list prints unknown only with the host signal', unknownCli.stdout.trim() === 'unknown (host cannot report workers)' && agents('pending', ['--session', 'never-seen']).stdout.trim() === 'none', unknownCli.stdout);

  const needSession = agents('settle', ['dispatchonly1', '--failed', '--reason', 'gone', '--run', runDir]);
  const withSession = agents('settle', ['dispatchonly1', '--failed', '--reason', 'gone', '--run', runDir, '--session', 's16']);
  check('m9. a dispatch-only id needs --session to settle, then leaves pending', needSession.status !== 0 && withSession.status === 0
    && !pendingAgents({ stateDir, cwd, runDir }).some((a) => a.agent_id === 'dispatchonly1'), `${needSession.stderr} ${withSession.stderr}`);

  // Payload capture: key names only, off by default, before the Grok early return.
  const captureFile = join(stateDir, 'payload-keys.ndjson');
  const secret = launch('s17', 'cap99912', { tool_input: { subagent_type: 'x', description: 'SECRET-DESCRIPTION', prompt: 'SECRET-PROMPT-TEXT', run_in_background: true } });
  send(secret);
  check('n. payload capture is off by default', !existsSync(captureFile), files().join(','));
  r = send(secret, { CODE_OPS_AGENT_LEDGER_CAPTURE: '1' });
  const captured = existsSync(captureFile) ? readFileSync(captureFile, 'utf8') : '';
  check('n2. capture writes key names and no values', r.status === 0 && r.stdout === '' && captured.includes('"tool_input.prompt"') && captured.includes('"tool_response.agentId"') && captured.includes('"session_id"')
    && !/SECRET|cap99912|s17|async_launched|code-ops-suite:implementer/.test(captured), captured);
  const before = captured.trim().split('\n').length;
  send(secret, { CODE_OPS_AGENT_LEDGER_CAPTURE: '1' });
  check('n3. a repeated shape is captured once', readFileSync(captureFile, 'utf8').trim().split('\n').length === before, '');
  const rowsBefore = files().length;
  r = send(launch('s18', 'grokcap1'), { CODE_OPS_AGENT_LEDGER_CAPTURE: '1', GROK_PLUGIN_ROOT: '/x' });
  check('n4. capture runs before the Grok early return, which still records no rows',
    r.status === 0 && r.stdout === '' && readFileSync(captureFile, 'utf8').includes('"host":"grok"') && files().length === rowsBefore && pending('s18').length === 0, files().join(','));
  check('n5. capture never reads as a ledger', pendingAgents({ stateDir, cwd }).every((a) => a.source === 'hook'), '');

  // Capture switch, values, host, and dedupe, on library calls with an injected env and a temp state dir.
  const flagFile = join(stateDir, 'capture.on');
  rmSync(captureFile, { force: true });
  writeFileSync(flagFile, '');
  r = send(launch('s21', 'flagcap1'));
  check('n6. the capture.on flag file turns capture on with the env var unset', r.status === 0 && existsSync(captureFile) && JSON.parse(readFileSync(captureFile, 'utf8').trim().split('\n')[0]).keys.includes('session_id'), files().join(','));
  rmSync(flagFile);
  rmSync(captureFile, { force: true });
  send(launch('s22', 'flagcap2'));
  check('n7. no flag file and no env var records nothing', !existsSync(captureFile) && captureOn({ stateDir, env: {} }) === false, files().join(','));

  const capDir = (name) => join(home, 'cap', name);
  const rowsOf = (dir) => (existsSync(join(dir, 'payload-keys.ndjson')) ? readFileSync(join(dir, 'payload-keys.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  const onEnv = (extra = {}) => ({ CODE_OPS_AGENT_LEDGER_CAPTURE: '1', ...extra });
  const dirV = capDir('values');
  captureKeys({ hook_event_name: 'PostToolUse', tool_name: 'spawn_agent', agent_type: 'a'.repeat(100), subagent_type: 7, prompt: 'LEAK-PROMPT', cwd: 'LEAK-CWD', session_id: 'LEAK-SESSION', message: 'LEAK-MESSAGE', nested: { tool_name: 'LEAK-NESTED' } }, { stateDir: dirV, env: onEnv() });
  const valueText = existsSync(join(dirV, 'payload-keys.ndjson')) ? readFileSync(join(dirV, 'payload-keys.ndjson'), 'utf8') : '';
  const valueRow = rowsOf(dirV)[0];
  check('n8. the allowlisted values are recorded, strings cut to 64, and a non-string is skipped',
    valueRow?.values?.hook_event_name === 'PostToolUse' && valueRow.values.tool_name === 'spawn_agent' && valueRow.values.agent_type === 'a'.repeat(64) && !('subagent_type' in valueRow.values) && Object.keys(valueRow.values).length === 3, valueText);
  check('n9. no other value appears anywhere in the capture file, only key names', valueRow?.keys?.includes('prompt') && valueRow.keys.includes('nested.tool_name') && !/LEAK/.test(valueText), valueText);

  const hostOfEnv = (name, extra) => {
    const dir = capDir(name);
    captureKeys({ hook_event_name: 'PreCompact' }, { stateDir: dir, env: onEnv(extra) });
    return { row: rowsOf(dir)[0], text: existsSync(join(dir, 'payload-keys.ndjson')) ? readFileSync(join(dir, 'payload-keys.ndjson'), 'utf8') : '' };
  };
  const hostCases = [
    ['codex', { CODEX_HOME: 'VALUE-CODEX' }, 'codex'],
    ['codexclaude', { CODEX_HOME: 'VALUE-CODEX', CLAUDE_PLUGIN_ROOT: 'VALUE-CLAUDE' }, 'codex'],
    ['grok', { GROK_PLUGIN_ROOT: 'VALUE-GROK', CODEX_HOME: 'VALUE-CODEX' }, 'grok'],
    ['claude', { CLAUDE_PLUGIN_ROOT: 'VALUE-CLAUDE' }, 'claude'],
    ['opencode', { OPENCODE_CONFIG: 'VALUE-OPENCODE' }, 'opencode'],
    ['other', { PATH: 'VALUE-PATH' }, 'other'],
  ];
  const hostResults = hostCases.map(([name, extra, want]) => ({ name, want, ...hostOfEnv(name, extra) }));
  check('n10. the host comes from environment variable names: grok, codex, claude, opencode, else other', hostResults.every((x) => x.row?.host === x.want), JSON.stringify(hostResults.map((x) => [x.name, x.row?.host])));
  check('n11. env values never appear in the capture file, and envNames lists matching names sorted',
    hostResults.every((x) => !/VALUE-/.test(x.text)) && hostResults[1].row.envNames.join() === 'CLAUDE_PLUGIN_ROOT,CODEX_HOME' && hostResults[5].row.envNames.length === 0, JSON.stringify(hostResults.map((x) => x.row?.envNames)));
  const manyDir = capDir('many');
  captureKeys({ hook_event_name: 'x' }, { stateDir: manyDir, env: onEnv(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`CODEX_VAR_${String(i).padStart(2, '0')}`, 'VALUE-MANY']))) });
  check('n12. envNames is capped at 30', rowsOf(manyDir)[0]?.envNames.length === 30, JSON.stringify(rowsOf(manyDir)[0]?.envNames?.length));

  const dedupe = capDir('dedupe');
  const base = { hook_event_name: 'PostToolUse', tool_name: 'Agent' };
  captureKeys(base, { stateDir: dedupe, env: onEnv({ CODEX_HOME: 'a' }) });
  captureKeys({ ...base, prompt: 'LEAK-ONE' }, { stateDir: dedupe, env: onEnv({ CODEX_HOME: 'a' }) });
  captureKeys({ ...base, prompt: 'LEAK-TWO' }, { stateDir: dedupe, env: onEnv({ CODEX_HOME: 'a' }) });
  check('n13. the same keys, values, and host dedupe to one line even when other values differ', rowsOf(dedupe).length === 2, JSON.stringify(rowsOf(dedupe).map((x) => x.keys)));
  captureKeys({ ...base, tool_name: 'spawn_agent', prompt: 'x' }, { stateDir: dedupe, env: onEnv({ CODEX_HOME: 'a' }) });
  check('n14. a new tool_name value is a new line', rowsOf(dedupe).length === 3, '');
  captureKeys({ ...base, tool_name: 'spawn_agent', prompt: 'x' }, { stateDir: dedupe, env: onEnv({ CLAUDE_PLUGIN_ROOT: 'a' }) });
  check('n15. a new host is a new line', rowsOf(dedupe).length === 4 && rowsOf(dedupe)[3].host === 'claude', JSON.stringify(rowsOf(dedupe).map((x) => x.host)));
  const offBefore = captureOn({ stateDir: dedupe, env: { CODE_OPS_AGENT_LEDGER_CAPTURE: '0' } });
  const envOn = captureOn({ stateDir: dedupe, env: { CODE_OPS_AGENT_LEDGER_CAPTURE: 'on' } });
  writeFileSync(join(dedupe, 'capture.on'), '');
  check('n16. captureOn reads the env var (1, true, on) and the flag file, and nothing else', !offBefore && envOn && captureOn({ stateDir: dedupe, env: {} }), `${offBefore} ${envOn}`);

  // The SessionEnd marker: the startup card lists only workers of sessions that ended.
  const endedIds = () => pendingAgents({ stateDir, cwd, endedOnly: true }).map((a) => a.agent_id).sort().join();
  send(launch('s19', 'live1919'));
  const liveOnly = endedIds();
  check('o. a live session (no marker) is pending by directory but absent from the ended-only list', pending('s19').length === 1
    && pendingAgents({ stateDir, cwd }).some((a) => a.agent_id === 'live1919') && !liveOnly.includes('live1919'), liveOnly);
  const marker = markSessionEnded({ sessionId: 's19', cwd, stateDir });
  check('o2. the marker appends one ended row to the session file and the session is then listed', marker?.status === 'ended' && marker.session_id === 's19'
    && ledgerRows('s19').at(-1)?.status === 'ended' && ledgerRows('s19').filter((x) => x.status === 'ended').length === 1 && endedIds().includes('live1919'), JSON.stringify(ledgerRows('s19')));
  const again19 = markSessionEnded({ sessionId: 's19', cwd, stateDir });
  check('o3. the marker is idempotent', again19 === null && ledgerRows('s19').length === 2, JSON.stringify(ledgerRows('s19')));
  check('o4. an ended row is never an agent and pending still counts the worker once',
    pending('s19').length === 1 && pending('s19')[0].agent_id === 'live1919' && pendingAgents({ stateDir, cwd, endedOnly: true }).every((a) => a.status === 'dispatched' && a.agent_id), JSON.stringify(pending('s19')));
  const n19 = files().length;
  check('o5. a session with no ledger file gets no marker and no file', markSessionEnded({ sessionId: 'never-launched', cwd, stateDir }) === null && files().length === n19, files().join(','));
  send(launch('s19', 'live2929'));
  check('o6. a launch after the marker makes the session live again, and a second marker lands when it ends',
    !endedIds().includes('live1919') && markSessionEnded({ sessionId: 's19', cwd, stateDir }) !== null && endedIds().includes('live2929'), endedIds());
  send(launch('s20', 'live2020'));
  process.env.CODE_OPS_AGENT_LEDGER = 'off';
  const offMarker = markSessionEnded({ sessionId: 's20', cwd, stateDir });
  delete process.env.CODE_OPS_AGENT_LEDGER;
  check('o7. the off switch writes no marker', offMarker === null && ledgerRows('s20').length === 1 && !endedIds().includes('live2020'), JSON.stringify(ledgerRows('s20')));
  const settledEnded = ['s1', 's10'].map((s) => markSessionEnded({ sessionId: s, cwd, stateDir }));
  check('o8. an ended session whose workers all reported lists nothing', settledEnded.every((x) => x?.status === 'ended') && !endedIds().includes('aaa111'), endedIds());
} finally {
  rmSync(home, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} failed:\n${fails.map((f) => `  - ${f}`).join('\n')}`);
  process.exit(1);
}
console.log('\nagent-ledger: all checks passed');
