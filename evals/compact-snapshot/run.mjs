#!/usr/bin/env node
// Regression eval for scripts/compact-snapshot.mjs and conversationOf() in scripts/transcript-lib.mjs.
// Synthetic transcripts only; no real transcript text enters the repository. It pins:
//   - each observed record shape: operator prompts, `AskUserQuestion` answers, peer messages,
//     `SendMessage` uses, and the four kinds of long-running work, with a notification closing its entry;
//   - the noise that must stay out: task notifications, `isMeta` bodies, the compaction summary,
//     command wrappers, hook and system-reminder context, and duplicates by text;
//   - the section budgets, the truncation order, and that an answer and a short directive never stub;
//   - peer threads: reply-owed, quiet, and reply-owed again after the peer speaks last;
//   - the agent ledger: `report_path` parsed from the brief's `Report path:` line (path only), and a
//     running agent read live, so a report clears it from the next snapshot;
//   - REQUIRED: a stale second compaction (boundary count against the header), a masking failure
//     (a stub that keeps only the transcript line, never the raw text), and the run folder fallback
//     (SESSION.json lookup, then the home state directory when the folder is not git-ignored);
//   - Grok: a PreCompact payload with snake_case keys and camelCase twins, over a synthetic
//     `chat_history.jsonl` and `updates.jsonl`, writes the snapshot with the operator words; three
//     mutants (prompts ignored, wrapper kept, chunks ignored) must each be caught;
//   - an atomic write, a `partial` status, malformed lines failing open, and the usage errors.
// The PreCompact hook, its off switch, and the card's fresh and stale forms belong to their own evals;
// this eval pins the library side they call (readSnapshotHeader, snapshotState).
//
//   node evals/compact-snapshot/run.mjs   (exit 0 = all assertions pass)

import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally } from '../harness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(REPO, 'scripts');
const load = (name) => import(pathToFileURL(join(SCRIPTS, name)).href);
const { conversationOf, countBoundaries, boundaryInfo } = await load('transcript-lib.mjs');
const snap = await load('compact-snapshot.mjs');
const { reportPathOf } = await load('agent-ledger.mjs');
const { buildSnapshot, readSnapshotHeader, snapshotState, findRunFolder, homeSnapshotPath, homeSnapshotPaths, BUDGET, CARRIED_FIELDS, readRunLog } = snap;

const same = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };
const { fails, check } = tally((name, detail) => `${name} - ${String(detail).slice(0, 300)}`);
const tmp = mkdtempSync(join(tmpdir(), 'compact-snapshot-eval-'));
const home = join(tmp, 'home');
mkdirSync(home, { recursive: true });
const SID = 'sess-eval-0001';

// ---- transcript fixture writers ----
let clock = Date.parse('2026-09-30T10:00:00Z');
const ts = () => new Date((clock += 60_000)).toISOString();
const rec = (o) => JSON.stringify({ timestamp: ts(), sessionId: SID, ...o });
const enqueue = (content) => rec({ type: 'queue-operation', operation: 'enqueue', content });
const human = (content, extra = {}) => rec({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content }, ...extra });
const use = (id, name, input) => rec({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, toolUseResult, content = 'ok') => rec({ type: 'user', toolUseResult, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const boundary = () => rec({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' });
const note = (id, status = 'completed') => enqueue(`<task-notification> <task-id>${id}</task-id> <tool-use-id>toolu_x</tool-use-id> <status>${status}</status> <summary>finished</summary> </task-notification>`);
const peer = (name, session, body) => enqueue(`<cross-session-message from="uds:x" from-session="${session}" from-name="${name}" from-mode="bypass"> ${name}: ${body} </cross-session-message>`);
const send = (id, to, message) => use(id, 'SendMessage', { to, summary: `to ${to}`, message });
const words = (conversation) => conversation.operatorWords.map((w) => w.text);
const texts = (list) => list.map((x) => x.text);

try {
  // ---- 1. observed shapes and the noise that stays out ----
  const SKILL_BODY = 'Base directory for this skill: C:\\plugins\\x\\skills\\handoff\n# Handoff\nBODY-NOISE\nARGUMENTS: resume the program';
  const lines = [
    enqueue('merge when green and keep going'),
    human('merge when green and keep going'),
    enqueue('<system-reminder>REMINDER-NOISE</system-reminder>\nuse a workflow'),
    enqueue('/demo:handoff resume "Program 7" with notes'),
    enqueue('<command-message>demo:handoff</command-message> <command-name>/demo:handoff</command-name> <command-args>resume "Program 7" with notes</command-args>'),
    enqueue('/clear'),
    enqueue('/autocompact 250k'),
    enqueue('<local-command-stdout>STDOUT-NOISE</local-command-stdout>'),
    enqueue('<user-prompt-submit-hook>HOOK-NOISE</user-prompt-submit-hook>'),
    enqueue('<ci-monitor-event>CI-NOISE</ci-monitor-event>'),
    enqueue('[Request interrupted by user]'),
    human(SKILL_BODY, { isMeta: true }),
    human(SKILL_BODY),
    human('This session is being continued SUMMARY-NOISE', { isCompactSummary: true }),
    enqueue('not json at all follows'),
    '{"type":"user","message":{"content":"torn line',
    '[1,2,3]',
    '',
    use('q1', 'AskUserQuestion', { questions: [{ question: 'How to proceed?', header: 'Direction', options: [] }] }),
    result('q1', { questions: [{ question: 'How to proceed?', header: 'Direction' }], answers: { 'How to proceed?': 'Redirect (Recommended)' } }),
    use('q2', 'AskUserQuestion', { questions: [{ question: 'May I edit outside?', header: 'Authority', options: [] }] }),
    result('q2', { answers: { 'May I edit outside?': ['tell peer', 'set autocompact'] } }),
    use('q3', 'AskUserQuestion', { questions: [{ question: 'Window?', header: 'Window', options: [] }] }),
    result('q3', null, 'The user answered: "Window?"="3 days"'),
    peer('Peer One', 'local_aaaa-1111', 'finish line set, 12 active'),
    peer('Peer One', 'local_aaaa-1111', 'finish line set, 12 active'),
    send('s1', 'Peer One', 'ack'),
    use('a1', 'Agent', { subagent_type: 'suite:implementer', description: 'Build one', prompt: 'Report path: x' }),
    result('a1', { isAsync: true, status: 'async_launched', agentId: 'agentone1', description: 'Build one' }),
    use('a2', 'Agent', { subagent_type: 'suite:probe', description: 'Probe two' }),
    result('a2', { isAsync: true, status: 'async_launched', agentId: 'agenttwo2', description: 'Probe two' }),
    use('a3', 'Agent', { subagent_type: 'suite:probe', description: 'Foreground' }),
    result('a3', { status: 'completed' }),
    use('b1', 'Bash', { command: 'gh pr checks 9 --watch', description: 'Wait for checks', run_in_background: true }),
    result('b1', { backgroundTaskId: 'bgshell01' }),
    use('b2', 'Bash', { command: 'npm test' }),
    result('b2', { backgroundTaskId: 'bgshell02', timedOutAfterMs: 120000 }),
    use('w1', 'Workflow', { script: 'x' }),
    result('w1', { status: 'async_launched', taskId: 'wftask01', runId: 'wf_run01', workflowName: 'panel', summary: 'Judge panel' }),
    use('k1', 'ScheduleWakeup', { delaySeconds: 1800, reason: 'fallback check' }),
    result('k1', { scheduledFor: Date.parse('2026-09-30T23:00:00Z') }),
    note('agentone1'),
    note('wftask01'),
    note('agenttwo2', 'running'),
    boundary(),
    boundary(),
  ];
  const convo = conversationOf(lines.join('\n'));
  check('1a. operator words keep prompts and drop every noise shape, deduped by text',
    JSON.stringify(words(convo)) === JSON.stringify(['merge when green and keep going', 'use a workflow', 'resume "Program 7" with notes', '/autocompact 250k', 'resume the program', 'not json at all follows']),
    JSON.stringify(words(convo)));
  check('1b. a wrapper and its slash twin dedupe to the args; a bare built-in without args is dropped', convo.operatorWords.filter((w) => w.text.startsWith('resume "Program 7"')).length === 1 && !words(convo).includes('/clear'));
  check('1c. a skill body in a prompt keeps its ARGUMENTS line only', words(convo).includes('resume the program') && !JSON.stringify(convo).includes('BODY-NOISE'));
  check('1d. no noise text survives', !/NOISE|REMINDER|SUMMARY|task-notification/.test(JSON.stringify(convo.operatorWords)), JSON.stringify(convo.operatorWords));
  check('1e. answers are header plus chosen label, from the structured answers or the result text',
    JSON.stringify(texts(convo.answers)) === JSON.stringify(['Direction: Redirect (Recommended)', 'Authority: tell peer; set autocompact', 'Window: 3 days']), JSON.stringify(texts(convo.answers)));
  check('1f. a peer message keeps name, full session id, and body, and a duplicate drops',
    convo.peerMessages.length === 1 && convo.peerMessages[0].name === 'Peer One' && convo.peerMessages[0].session === 'local_aaaa-1111' && convo.peerMessages[0].text === 'finish line set, 12 active', JSON.stringify(convo.peerMessages));
  check('1g. SendMessage uses are outbound', convo.outbound.length === 1 && convo.outbound[0].to === 'Peer One' && convo.outbound[0].message === 'ack', JSON.stringify(convo.outbound));
  const byId = Object.fromEntries(convo.work.map((w) => [w.id, w]));
  check('1h. work has the four kinds with their ids', ['agentone1', 'agenttwo2', 'bgshell01', 'bgshell02', 'wf_run01'].every((id) => byId[id]) && byId.k1?.kind === 'wakeup' && byId.bgshell01.kind === 'shell' && byId.wf_run01.kind === 'workflow' && !byId.a3, JSON.stringify(convo.work.map((w) => [w.kind, w.id])));
  check('1i. a finished notification closes its entry, by either workflow id; a running status does not',
    byId.agentone1.closed && byId.wf_run01.closed && !byId.agenttwo2.closed && !byId.bgshell01.closed, JSON.stringify(convo.work.map((w) => [w.id, w.closed])));
  check('1j. boundaries count and lines are 1-based physical lines', convo.boundaries === 2 && countBoundaries(lines.join('\n')) === 2 && convo.operatorWords[0].line === 1 && convo.operatorWords[1].line === 3);
  check('1k. malformed and non-object lines cost only themselves', conversationOf('{bad\n[1]\n"x"\nnull\n').operatorWords.length === 0 && convo.lines > 30);

  // ---- 2. budgets and truncation order (pure builder, identity mask) ----
  const id = (list) => list;
  const long = (n) => `directive ${n} ` + 'lorem ipsum dolor sit amet '.repeat(30);
  const manyWords = {
    operatorWords: [...Array.from({ length: 30 }, (_, i) => ({ text: long(i), at: 1_700_000_000_000, line: 10 + i })), { text: 'merge when green', at: 1_700_000_000_000, line: 50 }],
    answers: [{ text: `Authority: ${'grant '.repeat(25)}`, at: 1_700_000_000_000, line: 12 }],
    peerMessages: [], outbound: [], work: [], boundaries: 1,
  };
  const now = 1_700_000_600_000;
  let b = buildSnapshot({ conversation: manyWords, running: [], items: { total: 0, lines: [] }, now, sessionId: SID, mask: id });
  const section = (text, title) => text.split(/^## /m).find((s) => s.startsWith(title)) ?? '';
  const wordsSection = section(b.text, 'Operator words');
  check('2a. over budget, older long messages become stubs and the newest stay whole', wordsSection.length <= BUDGET.words && /L10 prompt[^\n]*\[stub, transcript line 10\]/.test(wordsSection) && !/L39 prompt[^\n]*\[stub/.test(wordsSection) && /L39 prompt[^\n]*chars omitted, transcript line 39/.test(wordsSection), `${wordsSection.length}`);
  check('2b. an answer and a short directive never stub', /L12 answer[^\n]*grant grant/.test(wordsSection) && !/L12 answer[^\n]*\[stub/.test(wordsSection) && /L50 prompt[^\n]*: merge when green$/m.test(wordsSection));
  check('2c. the whole file fits 12,000 characters', b.chars <= BUDGET.total && !b.overBudget, `${b.chars}`);
  const cutLine = /L39 prompt[^\n]*/.exec(wordsSection)?.[0] ?? '';
  check('2d. a long message cuts to about 600 characters: head, omitted count, tail', cutLine.length < 720 && /\[\d+ chars omitted, transcript line 39\]/.test(cutLine), `${cutLine.length}`);

  const items = (n, width) => ({ total: n, lines: Array.from({ length: n }, (_, i) => ({ n: i + 1, text: `OI-${i + 1} ${'x'.repeat(width)} - Owner: a - Done when: b` })) });
  const quietPeers = (n) => Array.from({ length: n }, (_, i) => ({ name: `Quiet ${i}`, session: `local_q${i}-0000-0000-0000-000000000000`, text: 'hi', at: 1, line: 100 + i }));
  const t1 = buildSnapshot({ conversation: { ...manyWords, operatorWords: [], answers: [], peerMessages: quietPeers(4).map((p) => p), outbound: quietPeers(4).map((p) => ({ to: p.name, line: 500 })) }, running: [{ agent_id: 'a1x', agent_type: 't', description: 'keep this description', age_ms: 1000, report_path: 'r/x.md' }], items: items(16, 260), now, mask: id });
  const itemLine = /^- OI-1 [^\n]*/m.exec(t1.text)?.[0] ?? '';
  check('2e. item lines over budget are cut first while quiet peers and descriptions stay', itemLine.length > 0 && itemLine.length < 242 && itemLine.length <= 162 && (t1.text.match(/^- quiet /gm) ?? []).length === 4 && t1.text.includes('keep this description'), `${itemLine.length}`);
  const t2 = buildSnapshot({
    conversation: { ...manyWords, operatorWords: [], answers: [], peerMessages: [...quietPeers(60), { name: 'Owed Peer', session: 'local_owed-1234-5678-9abc-def012345678', text: 'need an answer '.repeat(30), at: now - 120_000, line: 900 }], outbound: quietPeers(60).map((p) => ({ to: p.session, line: 500 })) },
    running: [], items: items(3, 10), now, mask: id });
  const peersSection = section(t2.text, 'Peers');
  check('2f. quiet peers drop before reply-owed peers, and the owed peer keeps its full session id with a cut message', peersSection.length <= BUDGET.peers && (peersSection.match(/^- quiet /gm) ?? []).length < 60 && /more quiet not shown/.test(peersSection)
    && peersSection.includes('- REPLY OWED Owed Peer local_owed-1234-5678-9abc-def012345678 2m: need an answer') && /need an answer[^\n]{0,260}…$/m.test(peersSection), peersSection.slice(0, 300));
  const agents = Array.from({ length: 20 }, (_, i) => ({ agent_id: `agent${String(i).padStart(2, '0')}id`, agent_type: 'suite:implementer', description: `description number ${i} ${'d'.repeat(50)}`, age_ms: 60_000 * i, report_path: `C:/repo/80 Runs/2026-09-30-x/reports/unit-${i}-with-a-long-report-name.md` }));
  const t3 = buildSnapshot({ conversation: { ...manyWords, operatorWords: [], answers: [] }, running: agents, items: items(1, 5), now, mask: id });
  const workSection = section(t3.text, 'Running work');
  check('2g. running-work descriptions cut last; ids and report paths are never cut', agents.every((a) => workSection.includes(a.agent_id) && workSection.includes(a.report_path)) && !workSection.includes('description number'), workSection.slice(0, 200));

  // ---- 3. peer threads ----
  const tconvo = (peerMessages, outbound) => ({ operatorWords: [], answers: [], peerMessages, outbound, work: [], boundaries: 0 });
  const owedOf = (c) => (buildSnapshot({ conversation: c, running: [], items: null, now, mask: id }).text.match(/^- REPLY OWED [^\n]*/gm) ?? []);
  check('3a. a peer message with no reply is reply-owed', owedOf(tconvo([{ name: 'P', session: 'local_p', text: 'q?', at: 1, line: 5 }], [])).length === 1);
  check('3b. a later reply, matched on name or session id, makes it quiet', owedOf(tconvo([{ name: 'P', session: 'local_p', text: 'q?', at: 1, line: 5 }], [{ to: 'p', line: 6 }])).length === 0 && owedOf(tconvo([{ name: 'P', session: 'local_p', text: 'q?', at: 1, line: 5 }], [{ to: 'local_p', line: 6 }])).length === 0);
  check('3c. a peer that speaks again after the reply is reply-owed again', owedOf(tconvo([{ name: 'P', session: 'local_p', text: 'q?', at: 1, line: 5 }, { name: 'P', session: 'local_p', text: 'again', at: 2, line: 9 }], [{ to: 'P', line: 6 }])).length === 1);

  // ---- 4. running work: ledger agents live, transcript shell/workflow/wakeup, closed and due entries gone ----
  const runConvo = conversationOf([
    use('b1', 'Bash', { command: 'sleep 9', description: 'Long shell', run_in_background: true }), result('b1', { backgroundTaskId: 'shell-live' }),
    use('b2', 'Bash', { command: 'sleep 1', description: 'Done shell', run_in_background: true }), result('b2', { backgroundTaskId: 'shell-done' }), note('shell-done'),
    use('w1', 'Workflow', {}), result('w1', { status: 'async_launched', taskId: 'wt1', runId: 'wf_live', summary: 'Live flow' }),
    use('k1', 'ScheduleWakeup', { reason: 'future' }), result('k1', { scheduledFor: Date.now() + 3_600_000 }),
    use('k2', 'ScheduleWakeup', { reason: 'past' }), result('k2', { scheduledFor: Date.now() - 3_600_000 }),
    use('a1', 'Agent', { description: 'Transcript agent' }), result('a1', { isAsync: true, agentId: 'transcript-agent', description: 'Transcript agent' }),
  ].join('\n'));
  const live = buildSnapshot({ conversation: runConvo, running: [{ agent_id: 'ledger-agent', agent_type: 't', description: 'Ledger agent', age_ms: 5000, report_path: 'reports/a.md' }], items: null, now: Date.now(), mask: id });
  const runText = section(live.text, 'Running work');
  check('4a. running work lists ledger agents, open shell, workflow, and a future wakeup; not closed or due entries',
    /- agent ledger-agent t <1m report: reports\/a\.md - Ledger agent/.test(runText) && runText.includes('- shell shell-live') && runText.includes('- workflow wf_live') && /- wakeup k1 - due in \S+ - future/.test(runText)
    && !runText.includes('shell-done') && !runText.includes('Transcript agent') && (runText.match(/- wakeup /g) ?? []).length === 1, runText);

  // ---- 5. masking (pure builder and the real scanner) ----
  const secret = `ghp_${'Ab3'.repeat(12)}`;
  const maskConvo = { ...tconvo([], []), operatorWords: [{ text: 'SENTINEL-ONE plain words', at: 1, line: 3 }, { text: `use token ${secret}\nsecond line stays`, at: 2, line: 4 }] };
  const real = buildSnapshot({ conversation: maskConvo, running: [], items: null, now, mask: snap.maskTexts });
  check('5a. the scanner masks a secret-shaped line and leaves the rest', real.text.includes('<REDACTED:secret-shape>') && !real.text.includes(secret) && real.text.includes('second line stays') && real.text.includes('SENTINEL-ONE plain words'), real.text);
  const thrown = buildSnapshot({ conversation: maskConvo, running: [{ agent_id: 'idkeep1', agent_type: 't', description: 'SENTINEL-DESC', age_ms: 1, report_path: 'r.md' }], items: { total: 1, lines: [{ n: 7, text: 'SENTINEL-ITEM' }] }, now, mask: () => { throw new Error('scanner down'); } });
  check('5b. REQUIRED masking failure: every text becomes a stub keeping only its transcript line', !/SENTINEL|second line/.test(thrown.text) && /- L3 prompt[^\n]*: \[withheld: masking failed\]/.test(thrown.text) && /\(TASKS\.md line 7\)/.test(thrown.text) && thrown.text.includes('idkeep1') && thrown.text.includes('r.md'), thrown.text);
  const partialMask = buildSnapshot({ conversation: maskConvo, running: [], items: null, now, mask: (list) => list.map((t, i) => (i === 0 ? null : t)) });
  check('5c. a message the scanner cannot vouch for stubs alone', /- L3 prompt[^\n]*: \[withheld: masking failed\]/.test(partialMask.text) && partialMask.text.includes('second line stays') && !partialMask.text.includes('SENTINEL-ONE'));
  const wrongShape = buildSnapshot({ conversation: maskConvo, running: [], items: null, now, mask: () => ['only one'] });
  check('5d. a mask that returns the wrong shape stubs everything', !wrongShape.text.includes('only one') && (wrongShape.text.match(/\[withheld: masking failed\]/g) ?? []).length === 2);

  // ---- 6. the CLI in temp repositories ----
  const initRepo = (name, ignore) => {
    const dir = join(tmp, name);
    mkdirSync(join(dir, '80 Runs'), { recursive: true });
    spawnSync('git', ['init', '-q'], { cwd: dir });
    if (ignore) writeFileSync(join(dir, '.gitignore'), '80 Runs/\n');
    return dir;
  };
  const runFolder = (repo, name, session, extra = {}) => {
    const dir = join(repo, '80 Runs', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SESSION.json'), JSON.stringify({ v: 1, ...session }));
    writeFileSync(join(dir, 'TASKS.md'), `# Tasks\n- [ ] OI-1 first item Owner: agent Done when: it lands\n- [x] OI-2 done\n- [ ] OI-3 second Owner: lead Done when: ok\n${extra.tasks ?? ''}`);
    return dir;
  };
  const cli = (cwd, args, { script = join(SCRIPTS, 'compact-snapshot.mjs'), env = {} } = {}) => spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8', timeout: 60_000, env: { ...process.env, CODE_OPS_HOME: home, CODE_OPS_AGENT_LEDGER: '', ...env },
  });
  const transcript = (name, list) => { const file = join(tmp, name); writeFileSync(file, `${list.join('\n')}\n`); return file; };
  const repo = initRepo('repo-ignored', true);
  const folder = runFolder(repo, '2026-09-30-eval-ho1', { sessionId: SID, name: 'Eval HO 1' });
  runFolder(repo, '2026-09-29-eval-ho0', { hostSessionId: 'other-session' });

  // the stale second compaction: write before compaction one, then count again after each compaction
  const before = [enqueue('first directive words'), enqueue('second directive words')];
  const tPath = transcript('t.jsonl', before);
  let r = cli(repo, ['--session', SID, '--transcript', tPath, '--json']);
  let out = {};
  try { out = JSON.parse(r.stdout); } catch { /* reported below */ }
  const snapPath = join(folder, 'COMPACT_SNAPSHOT.md');
  check('6a. the CLI writes COMPACT_SNAPSHOT.md in the git-ignored run folder and prints --json', r.status === 0 && out.location === 'run' && same(out.path, snapPath) && existsSync(snapPath) && out.counts?.words === 2 && out.status === 'complete', `${r.status} ${r.stderr} ${r.stdout}`);
  const header = readSnapshotHeader(readFileSync(snapPath, 'utf8'));
  check('6b. the header records the boundary count, status, session, and counts', header?.boundaries === 0 && header.status === 'complete' && header.sessionId === SID && header.counts?.words === 2 && header.counts.items === 2, JSON.stringify(header));
  writeFileSync(tPath, `${[...before, boundary()].join('\n')}\n`);
  check('6c. fresh: the card sees exactly one more boundary than the header', snapshotState(header, countBoundaries(readFileSync(tPath, 'utf8'))) === 'fresh');
  writeFileSync(tPath, `${[...before, boundary(), enqueue('third directive words'), boundary()].join('\n')}\n`);
  check('6d. REQUIRED stale second compaction: two boundaries against a header of zero is stale', snapshotState(header, countBoundaries(readFileSync(tPath, 'utf8'))) === 'stale');
  check('6e. no new boundary, an unreadable header, and a missing count are stale too', snapshotState(header, 0) === 'stale' && snapshotState(null, 1) === 'stale' && snapshotState(readSnapshotHeader('# Compact snapshot\nBoundaries: x\n\n'), 1) === 'stale' && readSnapshotHeader('not a snapshot') === null);
  r = cli(repo, ['--session', SID, '--transcript', tPath]);
  const rewritten = readSnapshotHeader(readFileSync(snapPath, 'utf8'));
  check('6f. each write replaces the file, leaves no temporary file, and records the new count', r.status === 0 && rewritten.boundaries === 2 && readFileSync(snapPath, 'utf8').includes('third directive words') && readdirSync(folder).every((f) => !f.endsWith('.tmp')), `${r.stdout}${r.stderr}`);

  // partial status: no transcript
  r = cli(repo, ['--session', SID, '--transcript', join(tmp, 'absent.jsonl'), '--json']);
  const partialText = readFileSync(snapPath, 'utf8');
  check('6g. no readable transcript still writes the other sections and says partial', r.status === 0 && /^Status: partial$/m.test(partialText) && /^Missing: transcript$/m.test(partialText) && partialText.includes('OI-1 first item') && readSnapshotHeader(partialText).missing.join() === 'transcript', partialText.slice(0, 300));

  // the run folder fallback: SESSION.json by sessionId, hostSessionId, and the hub beside the root
  check('6h. REQUIRED fallback: findRunFolder resolves the folder by sessionId and by hostSessionId, newest name first',
    findRunFolder(repo, SID)?.endsWith('2026-09-30-eval-ho1') && findRunFolder(repo, 'other-session')?.endsWith('2026-09-29-eval-ho0') && findRunFolder(repo, 'unknown-session') === null && findRunFolder(repo, '') === null);
  const hubRepo = join(tmp, 'hub-root');
  mkdirSync(join(hubRepo, 'demo-docs', '80 Runs', '2026-09-30-x-ho1'), { recursive: true });
  writeFileSync(join(hubRepo, 'demo-docs', '80 Runs', '2026-09-30-x-ho1', 'SESSION.json'), JSON.stringify({ hostSessionId: 'hub-session' }));
  check('6i. a `*-docs` hub beside the root is searched', findRunFolder(hubRepo, 'hub-session')?.endsWith('2026-09-30-x-ho1'));

  // the gitignore rule: a run folder that is not ignored sends the file to the home state directory
  const open = initRepo('repo-open', false);
  const openFolder = runFolder(open, '2026-09-30-open-ho1', { sessionId: 'open-session' });
  r = cli(open, ['--session', 'open-session', '--transcript', tPath, '--json']);
  const homeRoot = join(home, '.claude', 'code-ops', 'snapshots');
  try { out = JSON.parse(r.stdout); } catch { out = {}; }
  check('6j. a run folder that git does not ignore is never written; the home state file is', r.status === 0 && out.location === 'home' && out.path.startsWith(homeRoot) && out.path.endsWith(homeSnapshotPath('x', 'open-session', home).split(/[\\/]/).pop()) && existsSync(out.path) && !existsSync(join(openFolder, 'COMPACT_SNAPSHOT.md')) && readFileSync(out.path, 'utf8').includes('OI-1 first item'), `${r.stdout}${r.stderr}`);
  const bare = join(tmp, 'not-a-repo');
  mkdirSync(join(bare, '80 Runs', '2026-09-30-bare-ho1'), { recursive: true });
  writeFileSync(join(bare, '80 Runs', '2026-09-30-bare-ho1', 'SESSION.json'), JSON.stringify({ sessionId: 'bare-session' }));
  r = cli(bare, ['--session', 'bare-session', '--transcript', tPath, '--json']);
  check('6k. outside a git repository the file also goes to the home state directory', r.status === 0 && JSON.parse(r.stdout).location === 'home' && !existsSync(join(bare, '80 Runs', '2026-09-30-bare-ho1', 'COMPACT_SNAPSHOT.md')), `${r.stdout}${r.stderr}`);

  // no run folder for the session: the file still lands, partial, naming the run folder
  r = cli(repo, ['--session', 'no-such-session', '--transcript', tPath, '--json']);
  const orphan = r.status === 0 ? JSON.parse(r.stdout).path : '';
  check('6l. a session with no run folder writes partial to the home directory', r.status === 0 && orphan.startsWith(homeRoot) && /^Missing: run folder$/m.test(readFileSync(orphan, 'utf8')), `${r.stdout}${r.stderr}`);

  // masking failure end to end: a scripts copy with no scanner must stub, never write the raw text
  const noscan = join(tmp, 'noscan', 'scripts');
  mkdirSync(noscan, { recursive: true });
  for (const f of ['compact-snapshot.mjs', 'agent-ledger.mjs', 'cli-lib.mjs', 'transcript-lib.mjs', 'ledger-grammar.mjs']) copyFileSync(join(SCRIPTS, f), join(noscan, f));
  const secretPath = transcript('secret.jsonl', [enqueue('SENTINEL-RAW-DIRECTIVE must never appear'), enqueue(`token ${secret}`)]);
  r = cli(repo, ['--session', SID, '--transcript', secretPath], { script: join(noscan, 'compact-snapshot.mjs') });
  const stubbed = readFileSync(snapPath, 'utf8');
  check('6m. REQUIRED masking failure end to end: no scanner, so stubs with transcript lines and no raw text', r.status === 0 && !stubbed.includes('SENTINEL-RAW') && !stubbed.includes(secret) && /- L1 prompt[^\n]*: \[withheld: masking failed\]/.test(stubbed) && /- L2 prompt/.test(stubbed) && stubbed.includes('(TASKS.md line 2)'), stubbed.slice(0, 400));
  r = cli(repo, ['--session', SID, '--transcript', secretPath]);
  const masked = readFileSync(snapPath, 'utf8');
  check('6n. with the scanner present the secret line masks and the directive stays', r.status === 0 && masked.includes('SENTINEL-RAW-DIRECTIVE must never appear') && masked.includes('<REDACTED:secret-shape>') && !masked.includes(secret), masked.slice(0, 400));

  // the agent ledger: report_path from the Report path line, a live running list, no prompt stored
  const hook = join(REPO, 'plugins', 'code-ops-suite', 'hooks', 'agent-ledger.mjs');
  const feed = (payload) => spawnSync(process.execPath, [hook], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CODE_OPS_HOME: home, CODE_OPS_AGENT_LEDGER: '' }, timeout: 20_000 });
  const reportLine = 'C:/Users/me/repo-docs/80 Runs/2026-09-30-eval/reports/unit-e1.md';
  feed({ hook_event_name: 'PostToolUse', session_id: SID, cwd: repo, tool_name: 'Agent',
    tool_input: { subagent_type: 'suite:implementer', description: 'Build the snapshot', prompt: `Objective: SECRET-PROMPT-TEXT\nReport path: ${reportLine} (write it there)\nRound budget: 9`, run_in_background: true },
    tool_response: { status: 'async_launched', agentId: 'ledgeragent1' } });
  const ledgerDir = join(home, '.claude', 'code-ops', 'agents');
  const ledgerText = readdirSync(ledgerDir).filter((f) => f.endsWith('.jsonl')).map((f) => readFileSync(join(ledgerDir, f), 'utf8')).join('');
  check('6o. the ledger row records report_path and never the prompt', ledgerText.includes(`"report_path":"${reportLine}"`) && !ledgerText.includes('SECRET-PROMPT-TEXT'), ledgerText.slice(0, 300));
  r = cli(repo, ['--session', SID, '--transcript', tPath]);
  check('6p. a running agent appears live with its id and report path', /- agent ledgeragent1 suite:implementer \S+ report: C:\/Users\/me\/repo-docs\/80 Runs\/2026-09-30-eval\/reports\/unit-e1\.md - Build the snapshot/.test(readFileSync(snapPath, 'utf8')), readFileSync(snapPath, 'utf8'));
  feed({ hook_event_name: 'SubagentStop', session_id: SID, cwd: repo, agent_id: 'ledgeragent1', agent_type: 'suite:implementer' });
  r = cli(repo, ['--session', SID, '--transcript', tPath]);
  check('6q. once the agent reports, the next snapshot no longer lists it', !readFileSync(snapPath, 'utf8').includes('ledgeragent1'));

  const paths = [
    ['Report path: C:/a/b c/d.md (write it)', 'C:/a/b c/d.md'], ['Report path: `code-ops-docs/80 Runs/x/r.md` and more', 'code-ops-docs/80 Runs/x/r.md'],
    ['Report path: none; return the report as your final message (saved to code-ops-docs/x/y.md).', ''], ['Report path: ./reports/u1.md', './reports/u1.md'],
    ['no such line', ''], ['Report path: prose about the work', ''], ['  - Report path: /abs/r.md.', '/abs/r.md'], ['Report path: reports/dir', 'reports/dir'],
  ];
  check('6r. reportPathOf keeps the path and drops prose, none, and a missing line', paths.every(([prompt, want]) => reportPathOf(prompt) === want), JSON.stringify(paths.map(([p]) => reportPathOf(p))));

  // usage errors and the co façade
  check('6s. no --session and no --run, an unknown flag, and a positional argument all exit 2',
    cli(repo, []).status === 2 && cli(repo, ['--bogus', '--session', SID]).status === 2 && cli(repo, ['--session', SID, 'extra']).status === 2 && cli(repo, ['--session']).status === 2);
  r = spawnSync(process.execPath, [join(SCRIPTS, 'co.mjs'), 'snapshot'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CODE_OPS_HOME: home } });
  check('6t. co snapshot reaches the script and exits 2 on the same usage error', r.status === 2 && /compact-snapshot\.mjs/.test(r.stderr), `${r.status} ${r.stderr}`);

  // ---- 7. the PreCompact hook and the SessionStart compact card ----
  const HOOKS = join(REPO, 'plugins', 'code-ops-suite', 'hooks');
  const cleanEnv = { ...process.env, HOME: home, USERPROFILE: home, CODE_OPS_HOME: home, CODE_OPS_AGENT_LEDGER: '', CODE_OPS_COMPACT_SNAPSHOT: '' };
  delete cleanEnv.GROK_PLUGIN_ROOT;
  const runHook = (name, input, extraEnv = {}, cwd = tmp) => spawnSync(process.execPath, [join(HOOKS, name)], { cwd, input, encoding: 'utf8', timeout: 60_000, env: { ...cleanEnv, ...extraEnv } });
  const CARD = 'Card-session-0001';
  const cardRepo = initRepo('repo-card', true);
  const git = (...args) => spawnSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], { cwd: cardRepo, encoding: 'utf8' });
  git('add', '.gitignore');
  git('commit', '-q', '-m', 'base');
  writeFileSync(join(cardRepo, 'dirty.txt'), 'x\n');
  const cardRun = runFolder(cardRepo, '2026-09-30-card-ho1', { sessionId: CARD, name: 'Card HO 1' });
  const cardSnap = join(cardRun, 'COMPACT_SNAPSHOT.md');
  const logTail = `${'filler line of log text\n'.repeat(1500)}`;
  writeFileSync(join(cardRun, 'RUN_LOG.md'), `# Log\nNext: old step that a later line replaces\n${logTail}- Next: edit routing-card.mjs:10, then run the eval\nclosing prose\n`);
  const cardSteps = [enqueue('first directive words'), peer('Peer One', 'local_aaaa-1111', 'need an answer please'), enqueue('second directive words')];
  const cardT = transcript('card.jsonl', cardSteps);
  const payloadOf = (extra = {}) => JSON.stringify({ hook_event_name: 'PreCompact', session_id: CARD, transcript_path: cardT, cwd: cardRepo, ...extra });

  // the hook: the snapshot lands, nothing prints, every path exits 0
  let h = runHook('compact-snapshot.mjs', payloadOf(), {}, cardRepo);
  const writtenHeader = existsSync(cardSnap) ? readSnapshotHeader(readFileSync(cardSnap, 'utf8')) : null;
  check('7a. the PreCompact hook writes the snapshot for the payload session, prints nothing, exits 0',
    h.status === 0 && h.stdout === '' && h.stderr === '' && writtenHeader?.sessionId === CARD && writtenHeader.counts?.words === 2 && writtenHeader.counts.peers === 1 && writtenHeader.counts.items === 2, `${h.status} ${h.stdout}${h.stderr} ${JSON.stringify(writtenHeader)}`);
  check('7b. REGISTRATION: hooks.json lists the hook under PreCompact', JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8')).hooks?.PreCompact?.[0]?.hooks?.[0]?.command?.includes('hooks/compact-snapshot.mjs'));
  rmSync(cardSnap);
  for (const value of ['0', 'off', 'FALSE']) {
    h = runHook('compact-snapshot.mjs', payloadOf(), { CODE_OPS_COMPACT_SNAPSHOT: value }, cardRepo);
    check(`7c. CODE_OPS_COMPACT_SNAPSHOT=${value} turns the hook off: exit 0, no output, no file`, h.status === 0 && h.stdout === '' && !existsSync(cardSnap), `${h.status} ${h.stderr}`);
  }
  for (const [label, input] of [['empty stdin', ''], ['a non-JSON payload', '{not json'], ['a JSON array', '[]'], ['an empty object', '{}'], ['non-string fields', JSON.stringify({ session_id: 7, transcript_path: {}, cwd: [] })]]) {
    h = runHook('compact-snapshot.mjs', input, {}, cardRepo);
    check(`7d. fail-open on ${label}: exit 0, no output, no snapshot`, h.status === 0 && h.stdout === '' && h.stderr === '' && !existsSync(cardSnap), `${h.status} ${h.stdout}${h.stderr}`);
  }
  h = runHook('compact-snapshot.mjs', payloadOf({ transcript_path: join(tmp, 'never-written.jsonl') }), {}, cardRepo);
  check('7e. a transcript that cannot be read still exits 0 silently and writes a partial snapshot', h.status === 0 && h.stdout === '' && /^Status: partial$/m.test(readFileSync(cardSnap, 'utf8')), `${h.status} ${h.stderr}`);
  h = runHook('compact-snapshot.mjs', payloadOf({ cwd: join(tmp, 'no-such-directory') }), {}, cardRepo);
  check('7f. a payload cwd that does not exist exits 0 silently', h.status === 0 && h.stdout === '' && h.stderr === '', `${h.status} ${h.stderr}`);

  // payload capture: opt-in, key names only, and a transcript path never becomes a value
  const captureFile = join(home, '.claude', 'code-ops', 'agents', 'payload-keys.ndjson');
  h = runHook('compact-snapshot.mjs', payloadOf(), { CODE_OPS_AGENT_LEDGER_CAPTURE: '' }, cardRepo);
  check('7f2. with capture off the PreCompact hook writes no capture file', h.status === 0 && h.stdout === '' && !existsSync(captureFile), `${h.status} ${h.stderr}`);
  h = runHook('compact-snapshot.mjs', payloadOf(), { CODE_OPS_AGENT_LEDGER_CAPTURE: '1' }, cardRepo);
  const captured = existsSync(captureFile) ? readFileSync(captureFile, 'utf8') : '';
  const captureRow = captured.trim() ? JSON.parse(captured.trim().split('\n')[0]) : null;
  check('7f3. with capture on the PreCompact hook records the key names, never the transcript path value',
    h.status === 0 && h.stdout === '' && h.stderr === '' && captureRow?.keys?.includes('transcript_path') && captureRow.values?.hook_event_name === 'PreCompact'
      && !captured.includes(cardT) && !captured.includes(JSON.stringify(cardT).slice(1, -1)) && !captured.includes(CARD) && !captured.includes(cardRepo), captured.slice(0, 300));

  // Grok: the PreCompact payload keys (snake_case plus camelCase twins) and the `chat_history.jsonl` and
  // `updates.jsonl` line shapes, as captured live 2026-10-01 and rebuilt here with synthetic text only.
  // Each mutant breaks one parser branch in a copy of the plugin's scripts, and the case must catch it.
  const GROK = 'Grok-session-0001';
  const grokRepo = initRepo('repo-grok', true);
  const grokRun = runFolder(grokRepo, '2026-10-01-grok-ho1', { sessionId: GROK, name: 'Grok HO 1' });
  const grokSnap = join(grokRun, 'COMPACT_SNAPSHOT.md');
  const grokLine = (o) => JSON.stringify(o);
  const grokUser = (text, extra = {}) => grokLine({ type: 'user', content: [{ type: 'text', text }], ...extra });
  const grokChat = [
    grokLine({ type: 'system', content: 'GROK-SYSTEM-NOISE' }),
    grokUser('<user_info>GROK-INFO-NOISE</user_info>'),
    grokUser('<system-reminder>GROK-REMINDER-NOISE</system-reminder>', { synthetic_reason: 'system_reminder' }),
    grokUser('<user_query>\ngrok directive words first\n</user_query>', { prompt_index: 0 }),
    grokLine({ type: 'reasoning', id: 'r1', summary: [{ type: 'text', text: 'GROK-THOUGHT-NOISE' }], status: 'completed' }),
    grokLine({ type: 'assistant', content: 'GROK-ANSWER-NOISE', tool_calls: [{ id: 'c1', name: 'read_file', arguments: '{}' }], model_id: 'grok-x' }),
    grokLine({ type: 'tool_result', tool_call_id: 'c1', content: 'GROK-RESULT-NOISE' }),
    grokUser('attached context line\n<user_query>\ngrok directive words second\n</user_query>', { prompt_index: 1 }),
    grokUser('<user_query>\ngrok directive words first\n</user_query>', { prompt_index: 2 }),
  ];
  const grokUpdate = (n, update) => grokLine({ timestamp: 1_790_000_000_000 + n, method: 'session/update', params: { sessionId: GROK, update, _meta: { eventId: `e${n}`, agentTimestampMs: 1_790_000_000_000 + n } } });
  const grokUpdates = [
    grokUpdate(1, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'updates directive words' }, _meta: { modelId: 'grok-x', promptIndex: 0 } }),
    grokUpdate(2, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'GROK-REPLY-NOISE' } }),
    grokLine({ timestamp: 1_790_000_000_003, method: '_x.ai/session/update', params: { sessionId: GROK, update: { sessionUpdate: 'turn_completed', prompt_id: 'p0', stop_reason: 'end_turn', elapsed_ms: 5 } } }),
  ];
  const grokChatT = transcript('grok-chat_history.jsonl', grokChat);
  const grokUpdatesT = transcript('grok-updates.jsonl', grokUpdates);
  const grokOps = (file) => words(conversationOf(readFileSync(file, 'utf8')));
  check('7g1. a Grok chat_history keeps each typed prompt (its user_query body, deduped) and none of the context or model lines',
    JSON.stringify(grokOps(grokChatT)) === JSON.stringify(['grok directive words first', 'grok directive words second']) && !/NOISE|user_query/.test(JSON.stringify(conversationOf(grokChat.join('\n')))), JSON.stringify(grokOps(grokChatT)));
  check('7g2. a Grok updates.jsonl keeps each user_message_chunk and nothing else', JSON.stringify(grokOps(grokUpdatesT)) === JSON.stringify(['updates directive words']), JSON.stringify(grokOps(grokUpdatesT)));
  const grokPayload = (file) => JSON.stringify({ cwd: grokRepo, hookEventName: 'PreCompact', hook_event_name: 'PreCompact', permissionMode: 'default', permission_mode: 'default',
    sessionId: GROK, session_id: GROK, source: 'auto', timestamp: '2026-10-01T09:00:00Z', transcriptPath: file, transcript_path: file, workspaceRoot: grokRepo });
  const grokHook = (file, script = join(HOOKS, 'compact-snapshot.mjs')) => {
    rmSync(grokSnap, { force: true });
    const run = spawnSync(process.execPath, [script], { cwd: grokRepo, input: grokPayload(file), encoding: 'utf8', timeout: 60_000, env: cleanEnv });
    return { run, text: existsSync(grokSnap) ? readFileSync(grokSnap, 'utf8') : '' };
  };
  let g = grokHook(grokChatT);
  check('7g3. a Grok PreCompact payload writes COMPACT_SNAPSHOT.md with the operator words, silently',
    g.run.status === 0 && g.run.stdout === '' && g.run.stderr === '' && readSnapshotHeader(g.text)?.sessionId === GROK && readSnapshotHeader(g.text).counts?.words === 2
      && g.text.includes('grok directive words first') && g.text.includes('grok directive words second') && !/NOISE|user_query/.test(g.text), `${g.run.status} ${g.run.stderr} ${g.text.slice(0, 300)}`);
  g = grokHook(grokUpdatesT);
  check('7g4. a payload naming the Grok updates.jsonl writes its operator words too', g.run.status === 0 && readSnapshotHeader(g.text)?.counts?.words === 1 && g.text.includes('updates directive words') && !g.text.includes('GROK-REPLY-NOISE'), `${g.run.status} ${g.text.slice(0, 300)}`);
  const mutantRoot = join(tmp, 'grok-mutant');
  cpSync(join(HOOKS, '..', 'scripts'), join(mutantRoot, 'scripts'), { recursive: true });
  mkdirSync(join(mutantRoot, 'hooks'), { recursive: true });
  copyFileSync(join(HOOKS, 'compact-snapshot.mjs'), join(mutantRoot, 'hooks', 'compact-snapshot.mjs'));
  const mutantLib = join(mutantRoot, 'scripts', 'transcript-lib.mjs');
  const pristine = readFileSync(join(HOOKS, '..', 'scripts', 'transcript-lib.mjs'), 'utf8');
  g = grokHook(grokChatT, join(mutantRoot, 'hooks', 'compact-snapshot.mjs'));
  check('7g5. the unmutated copy of the plugin scripts passes the same case, so a mutant failure is the mutation', readSnapshotHeader(g.text)?.counts?.words === 2, g.text.slice(0, 200));
  for (const [label, from, to, file, caught] of [
    ['the parser ignores Grok chat_history prompts', 'Number.isInteger(o.prompt_index)', 'false', grokChatT, (t) => readSnapshotHeader(t)?.counts?.words === 0],
    ['the parser keeps the user_query wrapper', 'GROK_QUERY_RE.exec(b.text)?.[1] ?? b.text', 'b.text', grokChatT, (t) => t.includes('<user_query>')],
    ['the parser ignores Grok user_message_chunk updates', "'user_message_chunk'", "'never_a_chunk'", grokUpdatesT, (t) => readSnapshotHeader(t)?.counts?.words === 0],
  ]) {
    check(`7g6. mutant harness: the source still holds the text it mutates (${label})`, pristine.includes(from) && pristine.replace(from, to) !== pristine);
    writeFileSync(mutantLib, pristine.replace(from, to));
    g = grokHook(file, join(mutantRoot, 'hooks', 'compact-snapshot.mjs'));
    check(`7g7. MUTANT CAUGHT: ${label}`, caught(g.text), g.text.slice(0, 300));
  }

  // the card: fresh form, one boundary past the header
  feed({ hook_event_name: 'PostToolUse', session_id: CARD, cwd: cardRepo, tool_name: 'Agent',
    tool_input: { subagent_type: 'suite:implementer', description: 'Card pending agent', prompt: 'Report path: r/card.md', run_in_background: true },
    tool_response: { status: 'async_launched', agentId: 'cardagent1' } });
  runHook('compact-snapshot.mjs', payloadOf(), {}, cardRepo);
  writeFileSync(cardT, `${[...cardSteps, boundary()].join('\n')}\n`);
  const cardOf = (extra = {}, extraEnv = {}) => runHook('routing-card.mjs', JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', session_id: CARD, transcript_path: cardT, cwd: cardRepo, ...extra }), extraEnv, cardRepo);
  const linesOf = (r) => r.stdout.split('\n');
  let c = cardOf();
  let cl = linesOf(c);
  check('7g. fresh card: the Snapshot fresh line has counts and a path, and the snapshot outranks the summary',
    c.status === 0 && cl.some((l) => /^Snapshot fresh \(2 operator words, 1 running, 2 items, 1 reply-owed peers\): .*COMPACT_SNAPSHOT\.md$/.test(l)) && cl.includes('the snapshot outranks the summary on running work and peers; read it first'), c.stdout);
  check('7h. fresh card: no open-item lines and no instruction to reload TASKS.md or RUN_LOG.md', !c.stdout.includes('open items in ') && !/reload/i.test(c.stdout) && !cl.some((l) => /^OI-\d/.test(l)), c.stdout);
  check('7i. the Next: line is the latest one from the RUN_LOG.md tail and never an older one', cl.includes('Next: edit routing-card.mjs:10, then run the eval') && !c.stdout.includes('old step'), c.stdout);
  check('7j. one live git line: branch, short HEAD, and the dirty count', cl.some((l) => /^git: \S+ @ [0-9a-f]{7}, 1 dirty path\(s\)$/.test(l)), c.stdout);
  check('7k. the active line has N/12 and the snapshot count, and no flag when N does not exceed M', cl.includes('active 2/12 (last snapshot 2)'), c.stdout);
  check('7l. reply-owed peers come from the snapshot, with the full session id', cl.some((l) => /^reply owed: Peer One local_aaaa-1111 \S+: need an answer please$/.test(l)), c.stdout);
  check('7m. pending agents stay live from the ledger on a fresh card', cl.some((l) => l.startsWith('Pending agents: (1 of 1 shown)')) && cl.some((l) => l.startsWith('cardagent1 suite:implementer')), c.stdout);

  // GROWING and OVER CAP
  const tasksFile = join(cardRun, 'TASKS.md');
  const unchecked = (n) => `# Tasks\n${Array.from({ length: n }, (_, i) => `- [ ] OI-${i + 1} item ${i + 1} Owner: agent Done when: ok`).join('\n')}\n`;
  writeFileSync(tasksFile, unchecked(5));
  cl = linesOf(cardOf());
  check('7n. GROWING: more open items than the snapshot counted', cl.includes('active 5/12 (last snapshot 2) GROWING'), cl.filter((l) => l.startsWith('active')).join('|'));
  writeFileSync(tasksFile, unchecked(13));
  cl = linesOf(cardOf());
  check('7o. OVER CAP: more than 12 open items, flagged with GROWING', cl.includes('active 13/12 (last snapshot 2) GROWING OVER CAP'), cl.filter((l) => l.startsWith('active')).join('|'));
  writeFileSync(tasksFile, unchecked(1));
  check('7p. fewer items than the snapshot counted carry no flag', linesOf(cardOf()).includes('active 1/12 (last snapshot 2)'));
  writeFileSync(tasksFile, unchecked(2));

  // stale: a second compaction since the snapshot
  writeFileSync(cardT, `${[...cardSteps, boundary(), enqueue('third directive words'), boundary()].join('\n')}\n`);
  c = cardOf();
  cl = linesOf(c);
  check('7q. REQUIRED stale card: Snapshot STALE, the open-item lines return, and the active line still counts', cl.some((l) => /^Snapshot STALE: .*COMPACT_SNAPSHOT\.md predates an earlier compaction; verify its running work and peers$/.test(l))
    && !c.stdout.includes('Snapshot fresh') && cl.some((l) => l.startsWith('open items in ') && l.includes('(2 of 2 shown)')) && cl.includes('OI-1 item 1 Owner: agent Done when: ok') && cl.includes('active 2/12 (last snapshot 2)'), c.stdout);
  check('7r. a stale snapshot still lists its reply-owed peers, and the Next: and git lines stay', cl.some((l) => l.startsWith('reply owed: Peer One')) && cl.some((l) => l.startsWith('Next: edit')) && cl.some((l) => l.startsWith('git: ')), c.stdout);
  c = cardOf({ transcript_path: undefined });
  check('7s. a payload with no transcript path cannot prove freshness, so it reads STALE', linesOf(c).some((l) => l.startsWith('Snapshot STALE:')) && !c.stdout.includes('Snapshot fresh'), c.stdout);

  // absent and corrupt
  rmSync(cardSnap);
  c = cardOf();
  cl = linesOf(c);
  check('7t. absent snapshot: the card says so, names the rebuild command, and keeps the open-item lines', cl.includes(`Snapshot absent: rebuild it with co snapshot --session ${CARD}`) && cl.some((l) => l.startsWith('open items in ')) && !c.stdout.includes('Snapshot fresh') && !cl.some((l) => l.startsWith('reply owed:')), c.stdout);
  writeFileSync(cardSnap, 'garbage that is not a snapshot\n- REPLY OWED Nobody x: y\n');
  c = cardOf();
  check('7u. a file without the snapshot header reads as absent and lists no peer', c.status === 0 && linesOf(c).some((l) => l.startsWith('Snapshot absent:')) && !c.stdout.includes('Nobody'), c.stdout);
  rmSync(cardSnap);

  // the home state copy: a run folder git does not ignore sends the snapshot to the home directory
  const homeSnap = homeSnapshotPath(cardRepo, CARD, home);
  mkdirSync(dirname(homeSnap), { recursive: true });
  writeFileSync(homeSnap, buildSnapshot({ conversation: conversationOf(`${cardSteps.join('\n')}\n`), running: [], items: { total: 2, lines: [] }, sessionId: CARD, mask: (t) => t }).text);
  writeFileSync(cardT, `${[...cardSteps, boundary()].join('\n')}\n`);
  c = cardOf();
  check('7v. with no run-folder file the card finds the home state copy and reads it fresh', linesOf(c).some((l) => /^Snapshot fresh \(.*\): /.test(l) && l.includes('.claude')), c.stdout);
  rmSync(homeSnap);

  // the peer cap: at most 4 reply-owed lines, the last one a count
  const crowd = [...Array.from({ length: 6 }, (_, i) => peer(`Crowd ${i}`, `local_crowd${i}-0000`, `question ${i}`)), enqueue('after the peers')];
  writeFileSync(cardT, `${crowd.join('\n')}\n`);
  runHook('compact-snapshot.mjs', payloadOf(), {}, cardRepo);
  writeFileSync(cardT, `${[...crowd, boundary()].join('\n')}\n`);
  cl = linesOf(cardOf());
  const peerLines = cl.filter((l) => l.startsWith('reply owed:') || /more reply-owed peers in the snapshot$/.test(l));
  check('7w. six reply-owed peers print at most 4 lines: three peers and a count', peerLines.length === 4 && peerLines.filter((l) => l.startsWith('reply owed:')).length === 3 && peerLines[3] === '3 more reply-owed peers in the snapshot', peerLines.join('|'));

  // the other sources keep today's card, and the routing lines stay
  c = runHook('routing-card.mjs', JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: CARD, cwd: cardRepo }), {}, cardRepo);
  check('7x. a startup card prints no snapshot, git, or Next: line', c.status === 0 && c.stdout.includes('code-ops standard operating mode') && !/^(Snapshot|git:|Next:|active )/m.test(c.stdout), c.stdout);
  c = cardOf({ cwd: join(tmp, 'no-such-directory') });
  check('7y. an unreadable cwd fails open: the routing card still prints with no snapshot lines', c.status === 0 && c.stdout.includes('code-ops standard operating mode') && !/^(git:|Next:|active )/m.test(c.stdout), c.stdout);

  // the home copy is keyed on the repository root: payload cwds that differ inside one repository agree
  const RK = 'Root-key-session-0001';
  const rootRepo = initRepo('repo-root-key', false);
  const subDir = join(rootRepo, 'pkg', 'deep');
  mkdirSync(subDir, { recursive: true });
  const rkSteps = [enqueue('root key directive words')];
  const rkT = transcript('root-key.jsonl', rkSteps);
  const rkHome = homeSnapshotPath(rootRepo, RK, home);
  const rkHook = (cwd) => runHook('compact-snapshot.mjs', JSON.stringify({ hook_event_name: 'PreCompact', session_id: RK, transcript_path: rkT, cwd }), {}, cwd);
  const rkCard = (cwd) => {
    writeFileSync(rkT, `${[...rkSteps, boundary()].join('\n')}\n`);
    return runHook('routing-card.mjs', JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', session_id: RK, transcript_path: rkT, cwd }), {}, cwd);
  };
  const rkFresh = (r) => r.status === 0 && r.stdout.split('\n').some((l) => /^Snapshot fresh \(1 operator words, /.test(l) && l.includes('.claude'));
  check('7z1. the home path is the same from the root and from a subdirectory of the repository', homeSnapshotPath(subDir, RK, home) === rkHome && homeSnapshotPaths(subDir, RK, home)[0] === rkHome);
  h = rkHook(subDir);
  check('7z2. the hook run from a subdirectory writes the home copy under the root key, silently', h.status === 0 && h.stdout === '' && h.stderr === '' && existsSync(rkHome), `${h.status} ${h.stderr}`);
  c = rkCard(rootRepo);
  check('7z3. the card run from the root reads the copy the subdirectory hook wrote, fresh', rkFresh(c), c.stdout);
  rmSync(rkHome);
  writeFileSync(rkT, `${rkSteps.join('\n')}\n`);
  h = rkHook(rootRepo);
  check('7z4. the hook run from the root writes the same file', h.status === 0 && h.stdout === '' && existsSync(rkHome), `${h.status} ${h.stderr}`);
  c = rkCard(subDir);
  check('7z5. the card run from a subdirectory reads the copy the root hook wrote, fresh', rkFresh(c), c.stdout);
  const legacyHome = homeSnapshotPaths(subDir, RK, home)[1];
  check('7z6. the raw-cwd key stays a separate fallback path', legacyHome !== rkHome && homeSnapshotPaths(rootRepo, RK, home).length === 1);
  mkdirSync(dirname(legacyHome), { recursive: true });
  writeFileSync(legacyHome, readFileSync(rkHome, 'utf8'));
  rmSync(rkHome);
  c = rkCard(subDir);
  check('7z7. a copy an older build wrote under the raw-cwd key is still read as a fallback', rkFresh(c), c.stdout);

  // ---- 8. the Routing line over this session's ledger rows (DESIGN_TIER_ROUTING slice 7) ----
  const STARVED = 'Starved-session-0001';
  const launchAs = (session, agentId, type, prompt, model) => feed({ hook_event_name: 'PostToolUse', session_id: session, cwd: cardRepo, tool_name: 'Agent',
    tool_input: { subagent_type: type, description: `Routing fixture ${agentId}`, prompt, run_in_background: true, ...(model ? { model } : {}) },
    tool_response: { status: 'async_launched', agentId } });
  const routingOf = (r) => r.stdout.split('\n').filter((l) => l.startsWith('Routing:'));
  const cardFor = (session, source, extraEnv = {}) => runHook('routing-card.mjs', JSON.stringify({ hook_event_name: 'SessionStart', source, session_id: session, cwd: cardRepo }), extraEnv, cardRepo);
  c = cardFor(CARD, 'compact');
  check('8a. a session with a routed dispatch prints one Routing line from its ledger rows', c.status === 0 && routingOf(c).length === 1 && /^Routing: \d+ judgment, 0 triggered, 0 premium -> ok$/.test(routingOf(c)[0]), c.stdout);
  check('8b. the Routing line adds one short line and nothing else', routingOf(c)[0].length < 80 && c.stdout.trimEnd().split('\n').at(-1) === routingOf(c)[0], c.stdout);
  c = cardFor(STARVED, 'compact');
  check('8c. a session with no dispatch prints no Routing line', c.status === 0 && routingOf(c).length === 0, c.stdout);
  launchAs(STARVED, 'probe0001', 'suite:probe', 'Objective: read only', 'haiku');
  check('8d. a non-judgment dispatch alone prints no Routing line', routingOf(cardFor(STARVED, 'compact')).length === 0);
  launchAs(STARVED, 'starve0001', 'suite:implementer', 'Unit: U1\nTier: premium\nEffort: high', 'claude-sonnet-5-5');
  launchAs(STARVED, 'starve0002', 'suite:reviewer', 'Unit: U2\nTier: premium\nEffort: high', 'claude-sonnet-5-5');
  for (const source of ['compact', 'startup', 'resume']) {
    c = cardFor(STARVED, source);
    check(`8e. ${source} card: triggered dispatches that ran below premium print the STARVED verdict`, c.status === 0 && routingOf(c).join('|') === 'Routing: 2 judgment, 2 triggered, 0 premium -> STARVED', c.stdout);
  }
  c = runHook('routing-card.mjs', JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', cwd: cardRepo }), {}, cardRepo);
  check('8f. a payload with no session id prints no Routing line', c.status === 0 && routingOf(c).length === 0, c.stdout);
  c = cardFor(STARVED, 'compact', { CODE_OPS_AGENT_LEDGER: 'off' });
  check('8g. CODE_OPS_AGENT_LEDGER=off prints no Routing line', c.status === 0 && routingOf(c).length === 0 && c.stdout.includes('code-ops standard operating mode'), c.stdout);

  // ---- 9. compaction carries what a handoff carries (D-010) ----
  const FID = 'Fidelity-session-0001';
  const fidRepo = initRepo('repo-fidelity', true);
  const fidRun = runFolder(fidRepo, '2026-10-07-fidelity-ho1', { sessionId: FID, name: 'Fidelity HO 1' });
  const fidSnap = join(fidRun, 'COMPACT_SNAPSHOT.md');
  const GRANT = 'Operator granted: create branch eng/x and open one PR, never merge (2026-10-06, verbatim)';
  writeFileSync(join(fidRun, 'RUN_LOG.md'), [
    '# Run log', '- 2026-10-06T10:00:00Z: opened',
    '- Decision: DEC-1 use the run folder path over a copy; rejected: a second field list, because it drifts',
    '**Decision:** DEC-2 keep grants uncut; rejected: truncating grants',
    `Grant: ${GRANT}`, `Grant: token ${secret} stays out`,
    'In flight: scripts/compact-snapshot.mjs:120-180 partial', 'In flight: plugins/code-ops-suite/hooks/routing-card.mjs:275 done',
    'Next: node evals/compact-snapshot/run.mjs', ''].join('\r\n'));
  const fidSteps = [enqueue('fidelity directive words'), peer('Fid Peer', 'local_fid-1111', 'answer me please'), enqueue('second fidelity words')];
  const fidT = join(tmp, 'fid.jsonl');
  const fidCard = (extra = {}) => runHook('routing-card.mjs', JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', session_id: FID, transcript_path: fidT, cwd: fidRepo, ...extra }), {}, fidRepo);
  const fidPre = () => runHook('compact-snapshot.mjs', JSON.stringify({ hook_event_name: 'PreCompact', session_id: FID, transcript_path: fidT, cwd: fidRepo }), {}, fidRepo);
  const dated = (offsetMs, o = {}) => rec({ timestamp: new Date(Date.now() + offsetMs).toISOString(), type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', ...o });
  writeFileSync(fidT, `${fidSteps.join('\n')}\n`);
  fidPre();
  const fidText = existsSync(fidSnap) ? readFileSync(fidSnap, 'utf8') : '';
  const fidHeader = readSnapshotHeader(fidText);
  const missingFields = CARRIED_FIELDS.filter((e) => (e.section === 'header' ? !/^Run: 80 Runs\/2026-10-07-fidelity-ho1$/m.test(fidText) : !fidText.includes(`\n## ${e.section}`))).map((e) => e.section);
  check('9a. PARITY: every CARRIED_FIELDS section, and the Run: path, is in a simulated compaction snapshot', missingFields.length === 0 && CARRIED_FIELDS.length >= 8, `${missingFields.join(',')}\n${fidText.slice(0, 400)}`);
  check('9b. the tagged lines land verbatim: both decisions with rejected options, the grant, in-flight file:line, and the next command',
    fidText.includes('- DEC-1 use the run folder path over a copy; rejected: a second field list, because it drifts') && fidText.includes('- DEC-2 keep grants uncut; rejected: truncating grants')
    && fidText.includes(`- ${GRANT}`) && fidText.includes('- scripts/compact-snapshot.mjs:120-180 partial') && fidText.includes('- node evals/compact-snapshot/run.mjs'), fidText);
  check('9c. a grant passes the redaction scanner like other text, and the header counts the new sections',
    fidText.includes('- <REDACTED:secret-shape>') && !fidText.includes(secret) && fidHeader?.counts?.decisions === 2 && fidHeader.counts.grants === 2 && fidHeader.counts.flight === 2 && fidHeader.run === '80 Runs/2026-10-07-fidelity-ho1', JSON.stringify(fidHeader));
  const skillText = readFileSync(join(REPO, 'plugins', 'code-ops-suite', 'skills', 'handoff', 'SKILL.md'), 'utf8');
  const writeBullets = [...(skillText.split(/^## Write/m)[1]?.split(/^## /m)[0] ?? '').matchAll(/^- \*\*([^:*]+):\*\*/gm)].map((m) => m[1]);
  const covered = new Set(CARRIED_FIELDS.flatMap((e) => e.fields.map((f) => f.replace(/ \(.*\)$/, ''))));
  check('9d. PARITY: every handoff Write field has a CARRIED_FIELDS entry, and the skill cites the list instead of copying it',
    writeBullets.length >= 9 && writeBullets.every((name) => covered.has(name)) && skillText.includes('CARRIED_FIELDS') && skillText.includes('co snapshot --fields'), `${writeBullets.join('|')}`);
  const fieldsRun = cli(repo, ['--fields']);
  const tags = CARRIED_FIELDS.filter((e) => e.tag).map((e) => e.tag);
  check('9e. co snapshot --fields prints each tag line from the one list, and the startup card names the same tags',
    fieldsRun.status === 0 && tags.length === 4 && tags.every((t) => fieldsRun.stdout.includes(`"${t}: <text>"`))
    && tags.every((t) => runHook('routing-card.mjs', JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', session_id: FID, cwd: fidRepo }), {}, fidRepo).stdout.includes(`${t}:`)), `${fieldsRun.status} ${fieldsRun.stdout}`);

  // the card on a fresh snapshot: the new line, and no regression of the existing ones
  writeFileSync(fidT, `${[...fidSteps, boundary()].join('\n')}\n`);
  c = fidCard();
  cl = linesOf(c);
  check('9f. the fresh card says what else the snapshot holds and names its run folder',
    cl.some((l) => /^Snapshot fresh \(2 operator words, 0 running, 2 items, 1 reply-owed peers\): /.test(l)) && cl.includes('snapshot also holds: 2 decisions, 2 authority grants, 2 in-flight lines, the next command, run folder 80 Runs/2026-10-07-fidelity-ho1') && !c.stdout.includes('Snapshot partial'), c.stdout);

  // the race: the host flushes the boundary row after SessionStart can already run
  const prior = [...fidSteps, dated(-5000), enqueue('after the first compaction')];
  writeFileSync(fidT, `${prior.join('\n')}\n`);
  fidPre();
  const raced = readSnapshotHeader(readFileSync(fidSnap, 'utf8'));
  c = fidCard();
  check('9g. RACE: the card counts the header number (the new boundary row has not landed) and the snapshot is still fresh', raced?.boundaries === 1 && linesOf(c).some((l) => l.startsWith('Snapshot fresh (')) && !c.stdout.includes('Snapshot STALE'), c.stdout);
  writeFileSync(fidT, `${[...prior, dated(0), enqueue('after the second compaction')].join('\n')}\n`);
  const oneLater = linesOf(fidCard());
  writeFileSync(fidT, `${[...prior, dated(0), dated(1), enqueue('x')].join('\n')}\n`);
  const twoLater = linesOf(fidCard());
  check('9h. the same snapshot is fresh one boundary later, and stale two later',
    oneLater.some((l) => l.startsWith('Snapshot fresh (')) && twoLater.some((l) => l.startsWith('Snapshot STALE:')), `${oneLater.join('|')}\n${twoLater.join('|')}`);
  writeFileSync(fidT, `${[...fidSteps, dated(3_600_000)].join('\n')}\n`);
  c = fidCard();
  check('9i. an old snapshot stays stale: same count as the header, but written before the latest boundary', raced?.boundaries === 1 && linesOf(c).some((l) => l.startsWith('Snapshot STALE:')) && !c.stdout.includes('Snapshot fresh'), c.stdout);

  // the library rule behind 9g and 9i
  const hdr = (boundaries, writtenAt = '2026-10-07T00:00:10.000Z') => ({ boundaries, writtenAt });
  const at = Date.parse('2026-10-07T00:00:05.000Z');
  check('9j. RACE rule: header N, count N, Written at or after the latest boundary is fresh; before it is stale',
    snapshotState(hdr(2), 2, at) === 'fresh' && snapshotState(hdr(2), 2, Date.parse('2026-10-07T00:00:10.000Z')) === 'fresh' && snapshotState(hdr(2), 2, Date.parse('2026-10-07T00:00:11.000Z')) === 'stale');
  check('9k. RACE rule fails closed: the strict form, an unknown boundary time, a bad Written time, and any other count stay stale',
    snapshotState(hdr(2), 2) === 'stale' && snapshotState(hdr(2), 2, null) === 'stale' && snapshotState(hdr(2, 'garbage'), 2, at) === 'stale'
    && snapshotState(hdr(2), 4, at) === 'stale' && snapshotState(hdr(2), 1, at) === 'stale' && snapshotState(hdr(2), 3, at) === 'fresh' && snapshotState(hdr(2), NaN, at) === 'stale' && snapshotState(null, 2, at) === 'stale');
  check('9l. before the first compaction lands, header 0 and count 0 is fresh only with the race argument', snapshotState(hdr(0), 0, null) === 'fresh' && snapshotState(hdr(0), 0) === 'stale');
  const info = boundaryInfo(`${[enqueue('a'), dated(-60_000), dated(-1000), enqueue('b')].join('\n')}\n`);
  check('9m. boundaryInfo returns the count and the newest boundary time, null when there is none', info.count === 2 && Math.abs(info.lastAt - (Date.now() - 1000)) < 60_000 && boundaryInfo('').lastAt === null && boundaryInfo('').count === 0 && countBoundaries(`${dated(0)}\n`) === 1);

  // an older snapshot header, without the new counts, still reads, and the card adds no new-section line for it
  const oldHeader = readSnapshotHeader('# Compact snapshot\nWritten: 2026-10-01T00:00:00.000Z\nSession: s\nBoundaries: 1\nStatus: complete\nCounts: operator words 1, running work 0, active items 2, reply-owed peers 0\n\n## x\n');
  check('9n. an older header reads: the first four counts parse, the new ones are undefined, and no Run: is a blank', oldHeader?.counts?.items === 2 && oldHeader.counts.decisions === undefined && oldHeader.run === '', JSON.stringify(oldHeader));

  // partial: the card names the missing piece
  const PART = 'Partial-session-0001';
  const partRepo = initRepo('repo-partial', false);
  const partT = join(tmp, 'part.jsonl');
  writeFileSync(partT, `${[enqueue('partial directive words')].join('\n')}\n`);
  runHook('compact-snapshot.mjs', JSON.stringify({ hook_event_name: 'PreCompact', session_id: PART, transcript_path: partT, cwd: partRepo }), {}, partRepo);
  writeFileSync(partT, `${[enqueue('partial directive words'), boundary()].join('\n')}\n`);
  c = runHook('routing-card.mjs', JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact', session_id: PART, transcript_path: partT, cwd: partRepo }), {}, partRepo);
  check('9o. PARTIAL: the card prints Snapshot partial with the missing input and how to rebuild it',
    c.status === 0 && linesOf(c).some((l) => /^Snapshot partial: missing run folder; rebuild that input from the run folder or run co snapshot --session Partial-session-0001$/.test(l)) && linesOf(c).some((l) => l.startsWith('Snapshot fresh (')), c.stdout);
  c = fidCard();
  check('9p. a complete snapshot prints no Snapshot partial line', !c.stdout.includes('Snapshot partial'), c.stdout);

  // the tag parser
  const logDir = join(tmp, 'taglog');
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, 'RUN_LOG.md'), ['See Decision: not at line start', '- **Grant:** one', '* Grant: two', 'Grant: one', 'Decision: d1', 'Decision: d1', 'In flight: a:1', 'In flight: b:2', 'In flight: none.', 'In flight: c:3', 'Next: first', 'Next: second', 'Decision:', 'Decision:no space', '- **Decision**: d2', '**Grant**: three', '**In flight**: c:4', '**Next**: third'].join('\r\n'));
  const parsed = readRunLog(logDir);
  check('9q. the tag parser: bullets and bold match with the colon inside or outside the bold, CRLF is fine, duplicates keep their first place, In flight: none clears, the last Next wins, a mid-line tag is ignored',
    JSON.stringify(parsed) === JSON.stringify({ decisions: ['d1', 'no space', 'd2'], grants: ['one', 'two', 'three'], flight: ['c:3', 'c:4'], next: 'third' }), JSON.stringify(parsed));
  check('9r. a missing RUN_LOG.md reads as null and the builder renders none in each new section without going partial',
    readRunLog(join(tmp, 'no-such-log-dir')) === null && (() => { const b2 = buildSnapshot({ conversation: manyWords, running: [], items: { total: 0, lines: [] }, runLog: null, runFolder: 'r', now, sessionId: SID, mask: id }); return b2.status === 'complete' && /## Authority grants \(0, verbatim, RUN_LOG\.md\)\nnone\n/.test(b2.text); })());

  // budgets: the new sections cut by the documented order, and the never-cut set survives a full snapshot
  const bigLog = {
    decisions: Array.from({ length: 30 }, (_, i) => `DEC-${i + 1} chose option ${i} over the other because ${'z'.repeat(500)}`),
    grants: Array.from({ length: 6 }, (_, i) => `Grant ${i}: operator said ${'verbatim words '.repeat(8)}`.trimEnd()),
    flight: Array.from({ length: 8 }, (_, i) => `src/file${i}.mjs:${i + 10}-${i + 40} ${'partial '.repeat(40)}`),
    next: `node scripts/long-command.mjs --flag ${'arg '.repeat(50)}`.trim(),
  };
  const manyAgents = Array.from({ length: 20 }, (_, i) => ({ agent_id: `bigagent${i}`, agent_type: 'suite:implementer', description: `big description ${i} ${'d'.repeat(60)}`, age_ms: 60_000, report_path: `reports/u${i}.md` }));
  const big = buildSnapshot({ conversation: manyWords, running: manyAgents, items: items(16, 200), runLog: bigLog, runFolder: '80 Runs/big', now, sessionId: SID, mask: id });
  const shownIds = [...big.text.matchAll(/^- (DEC-\d+) /gm)].map((m) => m[1]);
  check('9s. a full snapshot fits 12,000 characters', big.chars <= BUDGET.total && !big.overBudget, `${big.chars}`);
  check('9t. never cut: every grant and the next command stay whole, the newest decisions keep their ids, and the run path stays',
    bigLog.grants.every((g) => big.text.includes(`- ${g}\n`)) && big.text.includes(`- ${bigLog.next}\n`) && shownIds.includes('DEC-30') && shownIds.length >= 6 && big.text.includes('Run: 80 Runs/big') && manyAgents.every((a) => big.text.includes(a.agent_id)), `${shownIds.join(',')}`);
  check('9u. decision text cuts before older decisions drop, and the newest in-flight line survives', /^- DEC-30 [^\n]*…$/m.test(big.text) && big.text.includes('src/file7.mjs:17-47'), big.text.slice(-1500));
  // 40 grants of 590 characters (24,000 characters uncut) must not push the file past the total budget.
  const grantFlood = Array.from({ length: 40 }, (_, i) => `G-${String(i + 1).padStart(2, '0')} ${'g'.repeat(586)}`);
  const flood = buildSnapshot({ conversation: manyWords, running: manyAgents, items: items(16, 200), runLog: { ...bigLog, grants: grantFlood }, runFolder: '80 Runs/big', now, sessionId: SID, mask: id });
  check('9s2. 40 long grants stay within 12,000 characters: the newest grants stay within 800, one line counts the older ones, and the next command and Run: line stay',
    flood.chars <= BUDGET.total && !flood.overBudget && /^- \d+ older grants in RUN_LOG\.md$/m.test(flood.text) && flood.text.includes('- G-40 ') && !flood.text.includes('- G-01 ')
    && /## Authority grants \(1 of 40 shown, verbatim, RUN_LOG\.md\)\n- 39 older grants in RUN_LOG\.md\n/.test(flood.text) && flood.text.includes(`- ${bigLog.next}\n`) && flood.text.includes('Run: 80 Runs/big') && /grants 40,/.test(flood.text), `${flood.chars}`);
  const maskOff = buildSnapshot({ conversation: null, running: [], items: null, runLog: bigLog, now, sessionId: SID, mask: () => { throw new Error('scanner down'); } });
  check('9v. a failing mask withholds grants and the next command rather than writing them raw', !maskOff.text.includes('verbatim words') && !maskOff.text.includes('long-command') && (maskOff.text.match(/\[withheld: masking failed\]/g) ?? []).length >= 7, maskOff.text.slice(0, 200));

  // init records the session, so the lookup by SESSION.json finds a hand-made run folder
  const initRoot = join(tmp, 'init-root');
  mkdirSync(join(initRoot, '80 Runs', '2026-10-07-init-eval'), { recursive: true });
  const sh = (...args) => spawnSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', ...args], { cwd: initRoot, encoding: 'utf8' });
  sh('init', '-q');
  sh('config', 'core.autocrlf', 'false');
  writeFileSync(join(initRoot, 'AGENTS.md'), '# Contract\n');
  writeFileSync(join(initRoot, '.gitignore'), '80 Runs/\n');
  sh('add', '.');
  sh('commit', '-qm', 'init');
  const initRun = join(initRoot, '80 Runs', '2026-10-07-init-eval');
  const initEnv = { ...process.env, CODE_OPS_HOME: home, CLAUDE_CODE_SESSION_ID: '', CODEX_SESSION_ID: '' };
  const runInit = (extra, env = initEnv) => spawnSync(process.execPath, [join(SCRIPTS, 'run-contract.mjs'), 'init', '--root', initRoot, '--run', initRun, '--lead-model', 'claude-opus-5-5', '--force', ...extra], { encoding: 'utf8', timeout: 120_000, env });
  let ri = runInit([]);
  check('9w. init with no session id says so and writes no SESSION.json', ri.status === 0 && /no session id/.test(ri.stdout) && !existsSync(join(initRun, 'SESSION.json')), `${ri.status} ${ri.stdout}${ri.stderr}`);
  ri = runInit(['--session', 'init-session-0001', '--host-session', 'local_init-1']);
  const recorded = existsSync(join(initRun, 'SESSION.json')) ? JSON.parse(readFileSync(join(initRun, 'SESSION.json'), 'utf8')) : {};
  check('9x. init --session records the session, and findRunFolder resolves the folder by either id',
    ri.status === 0 && recorded.sessionId === 'init-session-0001' && recorded.hostSessionId === 'local_init-1' && recorded.name === '2026-10-07-init-eval' && same(findRunFolder(initRoot, 'init-session-0001') ?? '', initRun) && same(findRunFolder(initRoot, 'local_init-1') ?? '', initRun), `${ri.stdout}${ri.stderr} ${JSON.stringify(recorded)}`);
  ri = runInit([], { ...initEnv, CLAUDE_CODE_SESSION_ID: 'init-session-0001' });
  check('9y. init takes the session from the host environment, and re-running keeps the other recorded fields', ri.status === 0 && JSON.parse(readFileSync(join(initRun, 'SESSION.json'), 'utf8')).hostSessionId === 'local_init-1', `${ri.stdout}${ri.stderr}`);
  ri = runInit(['--session', 'another-session']);
  check('9z. init leaves a SESSION.json that names another session alone and says so', ri.status === 0 && /names session init-session-0001, not another-session; left unchanged/.test(ri.stdout) && JSON.parse(readFileSync(join(initRun, 'SESSION.json'), 'utf8')).sessionId === 'init-session-0001', `${ri.stdout}${ri.stderr}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\ncompact-snapshot eval: ${fails.length} failure(s)`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\ncompact-snapshot eval: all assertions pass');
