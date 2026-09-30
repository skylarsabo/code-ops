#!/usr/bin/env node
// Regression eval for scripts/handoff-state.mjs (`co handoff draft|resume`). On a scratch git
// repository with a fixture run folder, it asserts that draft fills the mechanical facts and that
// its unfilled skeleton FAILS check-handoff.mjs; that resume passes, writes HANDOFF.consumed, and
// prints operator-owned items first on a good handoff; and that resume refuses to consume once an
// anchor drifted. The chain cases pin `co run open`, Session and Hop numbering 1 then 2, resume
// by session name with the seeded successor run and the version 2 consumed marker, the ambiguous
// name refusal, the draft refusals, the legacy marker, and `co handoff live` walking two hops.
// The continuity cases pin the established session name outranking the PROGRAM.md title, the
// host session id in SESSION.json, the record, and `live`, the resume links block and title line,
// and the predecessor's judgment bullets carried forward under the 8 KB cap. The links cases pin
// the `links:` block after `run open` and `draft --out`, on stderr for a bare draft, and the
// check 16 warning that resume passes through for a bare open-item pointer. The scope-digest cases
// pin SCOPE_DIGESTS.md from `draft --out`: placeholders with no predecessor entry, an unchanged
// entry's digest carried forward and a changed one reset, the overwrite refusal, resume refusing
// an unfilled file, the unchanged, changed, and missing summary lines, and a legacy handoff with
// no file resuming without them. The program cases pin `co program archive`, `split`, and `merge`:
// split refusing while an item is unassigned, both children and the Forwarded-to trail, merge
// renumbering across the ledger and archive with a Was: trail, the running-head refusal, and check 9
// following Forwarded-to and Was:. The overlap cases (design C6) pin the `program overlap:` block at
// `run open --program` and `resume`: one warning per shared scope document, a merge suggestion for
// two or more, and no output for no overlap, an idle or ended session, the program's own sessions, or
// a merged program; and that corrupt records, a missing ledger, or an unreadable board skip silently.
// The pending-agent cases pin draft refusing while this session has a dispatched agent with no
// report, naming each as `<agent_id> <agent_type> <age> <description>` and the two ways out, another
// session's agent and a reported one not blocking, the session id coming from `--session` or the
// run folder's SESSION.json, the directory fallback naming itself, `--pending-agents-ok` writing a
// `Pending agent:` line under In-flight boundaries, and CODE_OPS_AGENT_LEDGER=0 skipping the check.
// Every fixture lives in an OS temp dir, and CODE_OPS_HOME points the session records at a temp
// home, so nothing writes under the repository or the real home.
//
//   node evals/handoff-state/run.mjs   (exit 0 = all assertions pass)

import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { repoIdentity } from '../../scripts/handoff-state.mjs';
import { recordFromPayload } from '../../scripts/agent-ledger.mjs';
import { tally } from '../harness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const co = join(REPO, 'scripts', 'co.mjs');
const checker = join(REPO, 'scripts', 'check-handoff.mjs');

const { fails, check } = tally();
const tmp = mkdtempSync(join(tmpdir(), 'handoff-state-'));
const home = mkdtempSync(join(tmpdir(), 'handoff-state-home-'));
// A scrubbed environment: no host session id leaks in, and session records land in the temp home.
const env = { ...process.env, CODE_OPS_HOME: home };
delete env.CLAUDE_CODE_SESSION_ID;
delete env.CODEX_SESSION_ID;
const node = (args, cwd = tmp) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env });
const gitIn = (...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], { cwd: tmp, stdio: 'ignore' });

try {
  writeFileSync(join(tmp, 'src.txt'), 'alpha line\nbeta line\n');
  gitIn('init', '-q');
  gitIn('add', 'src.txt');
  gitIn('commit', '-q', '-m', 'base');
  const base = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();
  writeFileSync(join(tmp, 'src.txt'), 'alpha line\nbeta line\ngamma line\n');
  gitIn('commit', '-qam', 'second');
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();

  const run = join(tmp, 'runs', 'r1');
  mkdirSync(run, { recursive: true });
  const operatorItem = '- [ ] OI-2 Merge decision: awaiting answer · Owner: operator · Done when: operator replies yes or no · Pointer: src.txt';
  const agentItem = '- [ ] OI-1 Beta rewrite: not started · Owner: agent · Done when: src.txt line 2 reads beta v2 · Pointer: src.txt:2';
  writeFileSync(join(run, 'TASKS.md'), `# Tasks\n\n${agentItem}\n- [x] Alpha audit: done · Owner: agent · Done when: audit noted · Pointer: src.txt:1\n${operatorItem}\n`);
  writeFileSync(join(run, 'FINDINGS_REGISTER.md'), '# Findings\n\n### FND-001 alpha is present\n- Location: src.txt:1 · Anchor: `alpha line`\n');

  // ---- draft ----
  const d = node([co, 'handoff', 'draft', '--run', 'runs/r1', '--base', base]);
  const skeleton = d.stdout;
  check('draft exits 0', d.status === 0);
  check('draft stamps Verified-at with HEAD', skeleton.includes(`Verified-at: ${head}`));
  check('draft records the base..HEAD range', skeleton.includes(`${base}..${head}, 1 commit(s)`));
  // --untracked-files=all lists each file of the untracked run folder, each with the first 16 hex
  // of the sha256 of its bytes, so check-handoff.mjs can tell a later edit from the drafted tree.
  check('draft lists each file of the untracked run folder', /^- Dirty: `\?\? runs\/r1\/TASKS\.md`/m.test(skeleton)
    && !/^- Dirty: `\?\? runs\/`/m.test(skeleton));
  const tasksHash = createHash('sha256').update(readFileSync(join(run, 'TASKS.md'))).digest('hex').slice(0, 16);
  check('draft records the content hash of each dirty path', skeleton.includes(`- Dirty: \`?? runs/r1/TASKS.md\` · sha256:${tasksHash}\n`));
  check('draft maps unchecked TASKS.md lines verbatim', skeleton.includes(agentItem) && skeleton.includes(operatorItem));
  check('draft omits checked TASKS.md lines', !skeleton.includes('Alpha audit'));
  check('draft stamps each artifact', skeleton.includes(`\`runs/r1/FINDINGS_REGISTER.md\` · Verified-at: ${head}`));
  check('draft opens with the Program section', skeleton.indexOf('## Program\n') > 0 && skeleton.indexOf('## Program\n') < skeleton.indexOf('## Goal and state of play'));
  check('draft leaves Program and Predecessor as placeholders with no consumed sibling',
    /^Program: \[FILL: /m.test(skeleton) && /^Predecessor: \[FILL: [^\n]*no sibling run folder holds a consumed HANDOFF\.md\]$/m.test(skeleton));

  const handoff = join(run, 'HANDOFF.md');
  writeFileSync(handoff, skeleton);
  const unfilled = node([checker, handoff, '--root', tmp]);
  check('unfilled skeleton fails check-handoff', unfilled.status === 1);
  check('unfilled skeleton fails on the empty Request line', unfilled.stderr.includes('no non-empty "Request:" line'));
  check('unfilled skeleton fails on the unlabelled finding', unfilled.stderr.includes('Key findings entry carries no confidence label'));

  // ---- resume on a good handoff ----
  // The writer fills the Program section and keeps the durable ledger beside the run folders.
  const programDir = join(tmp, 'runs', 'programs', 'p1');
  mkdirSync(programDir, { recursive: true });
  writeFileSync(join(programDir, 'PROGRAM.md'), ['# PROGRAM: p1', '', '## Program goal', '', 'Keep alpha and rewrite beta.', '',
    '## Request history', '', '- 2026-09-23: keep alpha and rewrite beta.', '', '## Scope documents', '',
    '- `src.txt` · Status: current · Role: the file under change', '', '## Decisions ledger', '', '- 2026-09-23: alpha stays.', '',
    '## Closed items', '', '- OI-0 alpha audit: closed-with-proof in the fixture', ''].join('\n'));
  const filled = skeleton
    .replace(/^Program: \[FILL:[^\n]*$/m, 'Program: runs/programs/p1/PROGRAM.md')
    .replace(/^Predecessor: \[FILL:[^\n]*$/m, 'Predecessor: none')
    .replace(/^Session: [^\n]*$/m, 'Session: p1 HO 1')
    .replace(/^Hop: [^\n]*$/m, 'Hop: 1')
    .replace(/^Request:\n\[FILL:[^\n]*\]/m, 'Request: keep alpha and rewrite beta.')
    .replace(/^- \[FILL: one line per finding[^\n]*$/m, '- CONFIRMED: alpha is on line 1. Pointer: runs/r1/FINDINGS_REGISTER.md')
    .replace(/^\[FILL: the done-against[^\n]*$/m, '- Alpha kept. Pointer: src.txt:1 · Anchor: `alpha line`')
    .replace(/^\[FILL:[^\n]*\]$/gm, 'Recorded in the fixture.');
  writeFileSync(handoff, filled);
  const good = node([co, 'handoff', 'resume', handoff, '--root', tmp]);
  check('resume passes on a good handoff', good.status === 0);
  check('resume revalidates the named register', /ok register `?runs\/r1\/FINDINGS_REGISTER\.md/.test(good.stdout));
  check('resume counts anchors by status', good.stdout.includes('anchors: FRESH 1'));
  check('resume writes HANDOFF.consumed', existsSync(join(run, 'HANDOFF.consumed')));
  const blocked = good.stdout.indexOf('Blocked on operator:');
  check('operator items print first', blocked >= 0 && blocked < good.stdout.indexOf(operatorItem)
    && good.stdout.indexOf(operatorItem) < good.stdout.indexOf('Agent-owned:')
    && good.stdout.indexOf('Agent-owned:') < good.stdout.indexOf(agentItem));

  // ---- draft prefills the lineage from the consumed predecessor ----
  const run2 = join(tmp, 'runs', 'r2');
  mkdirSync(run2, { recursive: true });
  writeFileSync(join(run2, 'TASKS.md'), '# Tasks\n\n- [x] OI-2 Merge decision: answered yes · Owner: operator · Done when: reply recorded · Pointer: src.txt\n');
  const next = node([co, 'handoff', 'draft', '--run', 'runs/r2']).stdout;
  check('draft prefills Predecessor with the consumed sibling', /^Predecessor: runs\/r1\/HANDOFF\.md$/m.test(next));
  check("draft prefills Program from the predecessor's Program line", /^Program: runs\/programs\/p1\/PROGRAM\.md$/m.test(next));
  check('draft carries an unclosed predecessor item verbatim', next.includes(agentItem));
  check('draft turns an item TASKS.md checked off into a Closed items placeholder',
    next.includes('[FILL: OI-2 is checked in TASKS.md; record it in PROGRAM.md Closed items]') && !next.includes(operatorItem));
  const programFile = join(programDir, 'PROGRAM.md');
  writeFileSync(programFile, `${readFileSync(programFile, 'utf8')}- OI-1 beta rewrite: closed-with-proof in the fixture\n`);
  const closedDraft = node([co, 'handoff', 'draft', '--run', 'runs/r2']).stdout;
  check('draft drops an item PROGRAM.md already closed', !closedDraft.includes('OI-1 Beta rewrite'));
  // A consumed sibling on another program makes the predecessor ambiguous, so nothing is guessed.
  const run3 = join(tmp, 'runs', 'r3');
  mkdirSync(run3, { recursive: true });
  writeFileSync(join(run3, 'HANDOFF.md'), '# HANDOFF: r3\n\n## Program\n\nProgram: runs/programs/other/PROGRAM.md\nPredecessor: none\n\n## Open items\n\n- OI-9 other: open · Owner: agent · Done when: x\n');
  writeFileSync(join(run3, 'HANDOFF.consumed'), 'fixture\n');
  const ambiguous = node([co, 'handoff', 'draft', '--run', 'runs/r2']).stdout;
  check('draft leaves an ambiguous predecessor as a placeholder naming the candidates',
    /^Predecessor: \[FILL: [^\n]*ambiguous consumed candidates: [^\n]*runs\/r3\/HANDOFF\.md/m.test(ambiguous)
    && /^Program: \[FILL: /m.test(ambiguous) && !ambiguous.includes('OI-9'));
  rmSync(run2, { recursive: true, force: true });
  rmSync(run3, { recursive: true, force: true });

  // ---- resume refuses to consume a drifted anchor ----
  rmSync(join(run, 'HANDOFF.consumed'));
  writeFileSync(join(tmp, 'src.txt'), 'omega line\nbeta line\ngamma line\n');
  const drifted = node([co, 'handoff', 'resume', handoff, '--root', tmp]);
  check('resume fails on a drifted anchor', drifted.status === 1);
  check('resume names the drifted pointer', /DRIFTED src\.txt:1/.test(drifted.stdout));
  check('resume does not write HANDOFF.consumed on failure', !existsSync(join(run, 'HANDOFF.consumed')));
  check('resume reports it did not consume', drifted.stdout.includes('not consumed'));

  // ---- draft on a large dirty tree stays under the 8 KB handoff cap ----
  // 190 tracked files with long names, 150 of them derived (host dists and vendored scripts);
  // the files of the untracked runs/ folder add to the non-derived count, which git status reports.
  const dirs = { 'opencode-dist/skills': 60, '.agents/plugins': 30, 'plugins/code-ops-suite/scripts': 60, 'scripts': 25, 'evals/case': 15 };
  const tracked = [];
  for (const [dir, n] of Object.entries(dirs)) {
    mkdirSync(join(tmp, dir), { recursive: true });
    for (let i = 0; i < n; i++) {
      const path = `${dir}/a-deliberately-long-file-name-for-the-cap-${String(i).padStart(3, '0')}.mjs`;
      writeFileSync(join(tmp, path), 'one\n');
      tracked.push(path);
    }
  }
  gitIn('add', '--', ...Object.keys(dirs));
  gitIn('commit', '-q', '-m', 'wide');
  for (const path of tracked) writeFileSync(join(tmp, path), 'two\n');
  const wide = node([co, 'handoff', 'draft', '--run', 'runs/r1']);
  const bytes = Buffer.byteLength(wide.stdout);
  check(`large dirty draft exits 0 and stays under 8 KB (${bytes} B)`, wide.status === 0 && bytes < 8 * 1024);
  check('large dirty draft counts paths per top-level directory',
    wide.stdout.includes('`.agents/` 30') && wide.stdout.includes('`opencode-dist/` 60') && wide.stdout.includes('`plugins/` 60') && wide.stdout.includes('`scripts/` 25'));
  check('large dirty draft omits derived paths', !/- Dirty: `[^`]*(opencode-dist|\.agents|plugins\/code-ops-suite\/scripts)\//.test(wide.stdout)
    && wide.stdout.includes('Derived dirty paths not listed: 150'));
  const listedLines = wide.stdout.split('\n').filter((l) => l.startsWith('- Dirty: `'));
  const nonDerived = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: tmp, encoding: 'utf8' })
    .split('\n').filter((l) => l && !/^.{3}(opencode-dist|\.agents|plugins\/[^/]+\/scripts)\//.test(l)).length;
  check(`large dirty draft lists at most 20 paths and a +N more line (${nonDerived} non-derived)`,
    nonDerived > 40 && listedLines.length === 20 && wide.stdout.includes(`- +${nonDerived - 20} more non-derived dirty path(s)`));

  // ---- pending agents (agent ledger) ----
  const ledgerDir = join(home, '.claude', 'code-ops', 'agents');
  const launch = (session, id, description = 'Build the ledger') => recordFromPayload({
    hook_event_name: 'PostToolUse', session_id: session, cwd: tmp, tool_name: 'Agent',
    tool_input: { subagent_type: 'code-ops-suite:implementer', description, prompt: 'p', run_in_background: true },
    tool_response: { status: 'async_launched', agentId: id },
  }, { stateDir: ledgerDir });
  const settle = (session, id) => recordFromPayload({ hook_event_name: 'SubagentStop', session_id: session, cwd: tmp, agent_id: id, agent_type: 'code-ops-suite:implementer' }, { stateDir: ledgerDir });
  const draftAs = (extra, extraEnv = {}) => spawnSync(process.execPath, [co, 'handoff', 'draft', '--run', 'runs/r1', ...extra], { cwd: tmp, encoding: 'utf8', env: { ...env, ...extraEnv } });
  const inFlight = (text) => text.slice(text.indexOf('## In-flight boundaries'), text.indexOf('## Open items'));

  launch('sess-pend', 'pend111');
  const refused = draftAs(['--session', 'sess-pend']);
  check('pending: draft refuses while this session has an unreported agent', refused.status === 1 && refused.stdout === '', `${refused.status} ${String(refused.stdout).slice(0, 80)}`);
  check('pending: the refusal names the agent as id, type, age, and description', /^ {2}pend111 code-ops-suite:implementer <1m Build the ledger$/m.test(refused.stderr), refused.stderr);
  check('pending: the refusal names both ways out', refused.stderr.includes('Wait for them to report') && refused.stderr.includes('--pending-agents-ok'), refused.stderr);
  check("pending: another session's agent does not block", draftAs(['--session', 'sess-other']).status === 0);

  const allowed = draftAs(['--session', 'sess-pend', '--pending-agents-ok']);
  check('pending: --pending-agents-ok drafts and exits 0', allowed.status === 0, allowed.stderr);
  check('pending: the override writes a Pending agent state line under In-flight boundaries',
    /^- Pending agent: pend111 code-ops-suite:implementer <1m Build the ledger · launched \d{4}-\d\d-\d\dT/m.test(inFlight(allowed.stdout)), inFlight(allowed.stdout));
  check('pending: a draft with no pending agent writes no Pending agent line', !draftAs(['--session', 'sess-other']).stdout.includes('Pending agent:'));

  const off = draftAs(['--session', 'sess-pend'], { CODE_OPS_AGENT_LEDGER: '0' });
  check('pending: CODE_OPS_AGENT_LEDGER=0 skips the check', off.status === 0 && !off.stdout.includes('Pending agent:'), off.stderr);

  settle('sess-pend', 'pend111');
  check('pending: a reported agent no longer blocks', draftAs(['--session', 'sess-pend']).status === 0);

  // The session id may come from the run folder's SESSION.json instead of a flag or the environment.
  const runPend = join(tmp, 'runs', 'r-pend');
  mkdirSync(runPend, { recursive: true });
  writeFileSync(join(runPend, 'SESSION.json'), JSON.stringify({ v: 1, sessionId: 'sess-fromfile', name: 'Pend', hop: 0, predecessor: null, createdAt: new Date().toISOString() }));
  launch('sess-fromfile', 'file222');
  const fromFile = spawnSync(process.execPath, [co, 'handoff', 'draft', '--run', 'runs/r-pend'], { cwd: tmp, encoding: 'utf8', env });
  check("pending: the run folder's SESSION.json sessionId selects the ledger file", fromFile.status === 1 && fromFile.stderr.includes('file222 '), fromFile.stderr);
  check('pending: a known session id never reports a directory fallback', !fromFile.stderr.includes('matched by directory'), fromFile.stderr);

  // No session id anywhere: match the launches made in this directory, and say so.
  const runBare = join(tmp, 'runs', 'r-bare');
  mkdirSync(runBare, { recursive: true });
  launch('sess-unknown', 'dir333', 'Directory match');
  const bare = spawnSync(process.execPath, [co, 'handoff', 'draft', '--run', 'runs/r-bare'], { cwd: tmp, encoding: 'utf8', env });
  check('pending: with no session id draft matches by directory and says so', bare.status === 1 && bare.stderr.includes('dir333 ') && bare.stderr.includes('agents are matched by directory'), bare.stderr);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---- the session chain: run open, Session and Hop, resume by name, successor runs, live head ----
const repo = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-chain-')));
const gitAt = (...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], { cwd: repo, stdio: 'ignore' });
const inRepo = (args) => node(args, repo);
const json = (p) => JSON.parse(readFileSync(join(repo, p), 'utf8'));
// The repository-keyed session record store handoff-state.mjs writes.
const sessionRecordPath = (cwd, sid, root) => join(root, '.claude', 'code-ops', 'sessions', repoIdentity(cwd).key, `${sid.replace(/[^A-Za-z0-9]/g, '-')}.json`);
const record = (sid) => JSON.parse(readFileSync(sessionRecordPath(repo, sid, home), 'utf8'));
const enc = (p) => p.replace(/ /g, '%20');
const REQ1 = 'start the ledger program.';
const REQ2 = 'continue the ledger program.';
// Fills a draft the way a writer does: the judgment placeholders only, confirming each carried
// bullet. Session and Hop stay as drafted.
const fill = (draftText, request) => draftText
  .replace(/^- \[FILL: confirm still true\] /gm, '- ')
  .replace(/^Program: \[FILL:[^\n]*$/m, 'Program: 80 Runs/programs/ledger2/PROGRAM.md')
  .replace(/^Request:\n\[FILL:[^\n]*\]/m, `Request: ${request}`)
  .replace(/^- \[FILL: one line per finding[^\n]*$/m, '- CONFIRMED: alpha is on line 1. Pointer: src.txt:1')
  .replace(/^\[FILL: the done-against[^\n]*$/m, '- Alpha kept. Pointer: src.txt:1 · Anchor: `alpha line`')
  .replace(/^\[FILL:[^\n]*\]$/gm, 'Recorded in the fixture.');
try {
  writeFileSync(join(repo, 'src.txt'), 'alpha line\n');
  writeFileSync(join(repo, 'design.md'), '# Design\n\nAlpha stays.\n');
  mkdirSync(join(repo, 'specs'));
  writeFileSync(join(repo, 'specs', 'a.md'), 'spec a\n');
  writeFileSync(join(repo, 'specs', 'b.md'), 'spec b\n');
  gitAt('init', '-q');
  gitAt('add', 'src.txt', 'design.md', 'specs');
  gitAt('commit', '-q', '-m', 'base');
  mkdirSync(join(repo, '80 Runs', 'programs', 'ledger2'), { recursive: true });
  writeFileSync(join(repo, '80 Runs', 'programs', 'ledger2', 'PROGRAM.md'), ['# PROGRAM: Ledger2 AMM', '', '## Program goal', '', 'Keep alpha.', '',
    '## Request history', '', `- 2026-09-23: ${REQ1}`, `- 2026-09-24: ${REQ2}`, '', '## Scope documents', '',
    '- `src.txt` · Status: current · Role: the file under change', '- `design.md` · Status: current · Role: the design',
    '- `specs` · Status: current · Role: the spec folder', '', '## Decisions ledger', '', '- 2026-09-23: alpha stays.', '',
    '## Closed items', '', '- OI-0 setup: closed in the fixture', ''].join('\n'));

  // run open: a new session's own folder, SESSION.json, TASKS.md, RUN_LOG.md, and the session record.
  const opened = inRepo([co, 'run', 'open', 'ledger', '--name', 'Ledger2 AMM', '--session', 'sess-zero-0000']);
  const run0 = opened.stdout.split('\n')[0];
  check('run open exits 0 and prints a dated folder under 80 Runs', opened.status === 0 && /^80 Runs\/\d{4}-\d{2}-\d{2}-ledger$/.test(run0));
  check('run open follows the folder with a links block for the run',
    opened.stdout === `${run0}\nlinks:\n  run: [${run0}](${enc(run0)})\n`);
  const s0 = existsSync(join(repo, run0, 'SESSION.json')) ? json(`${run0}/SESSION.json`) : {};
  check('run open writes SESSION.json with hop 0 and no predecessor',
    s0.v === 1 && s0.sessionId === 'sess-zero-0000' && s0.name === 'Ledger2 AMM' && s0.hop === 0 && s0.predecessor === null);
  check('run open writes a header-only TASKS.md and a RUN_LOG.md',
    existsSync(join(repo, run0, 'TASKS.md')) && readFileSync(join(repo, run0, 'TASKS.md'), 'utf8') === '# Tasks\n' && existsSync(join(repo, run0, 'RUN_LOG.md')));
  const r0 = existsSync(sessionRecordPath(repo, 'sess-zero-0000', home)) ? record('sess-zero-0000') : {};
  check('run open writes the session record in the temp home',
    r0.v === 1 && r0.runDir === run0 && r0.resumed === null && r0.hop === 0 && r0.name === 'Ledger2 AMM');
  const again = inRepo([co, 'run', 'open', 'ledger', '--session', 'sess-other-0000', '--host-session', 'local_open-0000']);
  check('run open suffixes a taken folder name with -2', again.stdout.split('\n')[0] === `${run0}-2`);
  check('run open stores --host-session in SESSION.json and the session record',
    s0.hostSessionId === null && json(`${run0}-2/SESSION.json`).hostSessionId === 'local_open-0000'
    && record('sess-other-0000').hostSessionId === 'local_open-0000' && r0.hostSessionId === null);

  // hop 1: the first handoff names its successor "Ledger2 AMM HO 1".
  const item = '- [ ] OI-1 Beta rewrite: not started · Owner: agent · Done when: src.txt holds beta · Pointer: src.txt:1';
  writeFileSync(join(repo, run0, 'TASKS.md'), `# Tasks\n\n${item}\n`);
  const d1 = inRepo([co, 'handoff', 'draft', '--run', run0, '--session', 'sess-zero-0000']);
  check('draft on a run-open folder sets Predecessor none, Session HO 1, and Hop 1',
    /^Predecessor: none$/m.test(d1.stdout) && /^Session: Ledger2 AMM HO 1$/m.test(d1.stdout) && /^Hop: 1$/m.test(d1.stdout));
  check('draft without --out prints its links block on stderr and keeps the skeleton clean',
    !d1.stdout.includes('links:') && d1.stderr.includes(`links:\n  run: [${run0}](${enc(run0)})\n  OI-1 pointer: [src.txt:1](src.txt)`));
  // The hop 1 writer records one bullet in each judgment section, for the carry-forward case.
  const JUDGED = { 'Decisions made': 'Alpha stays because beta reads it.', 'Traps and dead ends': 'Sorting src.txt breaks the anchor.', 'Carried context': 'Analysis sits in notes.md.' };
  let h1 = fill(d1.stdout, REQ1);
  for (const [heading, bullet] of Object.entries(JUDGED)) h1 = h1.replace(`## ${heading}\n\nRecorded in the fixture.\n`, `## ${heading}\n\nRecorded in the fixture.\n- ${bullet}\n`);
  writeFileSync(join(repo, run0, 'HANDOFF.md'), h1);
  gitAt('add', '-A');
  gitAt('commit', '-q', '-m', 'hop 1');

  // resume by name, case-insensitively: successor folder seeded, v2 marker, session record.
  const res1 = inRepo([co, 'handoff', 'resume', 'ledger2 amm ho 1', '--session', 'sess-one-11111', '--root', '.']);
  const succ1 = /^successor run: (.+)$/m.exec(res1.stdout)?.[1];
  check('resume by session name passes and prints the session name', res1.status === 0 && res1.stdout.includes('session name: Ledger2 AMM HO 1'));
  check('resume names a successor run <date>-<program slug>-ho1', /^80 Runs\/\d{4}-\d{2}-\d{2}-ledger2-ho1$/.test(succ1 ?? ''));
  const s1 = succ1 && existsSync(join(repo, succ1, 'SESSION.json')) ? json(`${succ1}/SESSION.json`) : {};
  check('successor SESSION.json names the session, its hop, and the predecessor handoff',
    s1.sessionId === 'sess-one-11111' && s1.name === 'Ledger2 AMM HO 1' && s1.hop === 1 && s1.predecessor === `${run0}/HANDOFF.md`);
  check('successor TASKS.md is seeded with the open items verbatim', Boolean(succ1) && readFileSync(join(repo, succ1, 'TASKS.md'), 'utf8').includes(item));
  const mark1 = json(`${run0}/HANDOFF.consumed`);
  check('HANDOFF.consumed is the v2 body naming the session and successor',
    mark1.v === 2 && mark1.bySession === 'sess-one-11111' && mark1.successorRun === succ1 && mark1.name === 'Ledger2 AMM HO 1' && typeof mark1.consumedAt === 'string');
  const r1 = record('sess-one-11111');
  check('resume writes the session record with runDir, resumed, and hop',
    r1.runDir === succ1 && r1.resumed === `${run0}/HANDOFF.md` && r1.hop === 1 && r1.name === 'Ledger2 AMM HO 1');
  check('resume prints the check 16 warning for a bare open-item pointer and still passes',
    res1.status === 0 && res1.stdout.includes('\nwarning: check 16: HANDOFF.md Open items pointer carries no delimited Anchor: OI-1 Pointer: src.txt:1\n'));
  check('resume links the program, scope documents, handoff, successor run, and pointers as markdown',
    res1.stdout.includes('\nlinks:\n') && res1.stdout.includes('  program: [80 Runs/programs/ledger2/PROGRAM.md](80%20Runs/programs/ledger2/PROGRAM.md)')
    && res1.stdout.includes('  scope document: [src.txt](src.txt)') && res1.stdout.includes(`  handoff: [${run0}/HANDOFF.md](${enc(run0)}/HANDOFF.md)`)
    && res1.stdout.includes(`  successor run: [${succ1}](${enc(succ1 ?? '')})`) && res1.stdout.includes('  OI-1 pointer: [src.txt:1](src.txt)'));
  check('a passing resume ends with the set title action line', res1.stdout.trimEnd().endsWith('set title: "Ledger2 AMM HO 1"'));
  check('a legacy handoff with no SCOPE_DIGESTS.md resumes with no digest step or scope status lines',
    res1.status === 0 && !res1.stdout.includes('scope digests') && !/^ {2}(unchanged|changed|missing) /m.test(res1.stdout));

  // draft refusals: a consumed folder, and a folder another session owns.
  const refusedConsumed = inRepo([co, 'handoff', 'draft', '--run', run0, '--out', `${run0}/HANDOFF-2.md`]);
  check('draft refuses an --out folder holding HANDOFF.consumed',
    refusedConsumed.status === 1 && refusedConsumed.stderr.includes('HANDOFF.consumed') && !existsSync(join(repo, run0, 'HANDOFF-2.md')));
  const refusedOwner = inRepo([co, 'handoff', 'draft', '--run', succ1, '--out', `${succ1}/HANDOFF.md`, '--session', 'sess-intruder-9']);
  check("draft refuses an --out folder whose SESSION.json names another session",
    refusedOwner.status === 1 && refusedOwner.stderr.includes('sess-one-11111') && !existsSync(join(repo, succ1, 'HANDOFF.md')));

  // hop 2: the predecessor comes from SESSION.json and the Hop counts up.
  const d2 = inRepo([co, 'handoff', 'draft', '--run', succ1, '--out', `${succ1}/HANDOFF.md`, '--session', 'sess-one-11111']);
  const d2text = existsSync(join(repo, succ1, 'HANDOFF.md')) ? readFileSync(join(repo, succ1, 'HANDOFF.md'), 'utf8') : '';
  check('draft takes the predecessor from SESSION.json and numbers Session HO 2 and Hop 2',
    d2.status === 0 && d2text.includes(`Predecessor: ${run0}/HANDOFF.md`) && /^Session: Ledger2 AMM HO 2$/m.test(d2text) && /^Hop: 2$/m.test(d2text));
  check('draft --out prints wrote, then links to the draft, run, program, predecessor, and pointers',
    d2.stdout === [`wrote ${succ1}/HANDOFF.md`, 'links:', `  handoff draft: [${succ1}/HANDOFF.md](${enc(succ1)}/HANDOFF.md)`,
      `  scope digests: [${succ1}/SCOPE_DIGESTS.md](${enc(succ1)}/SCOPE_DIGESTS.md)`, `  run: [${succ1}](${enc(succ1)})`, '  program: [80 Runs/programs/ledger2/PROGRAM.md](80%20Runs/programs/ledger2/PROGRAM.md)',
      `  predecessor: [${run0}/HANDOFF.md](${enc(run0)}/HANDOFF.md)`, '  OI-1 pointer: [src.txt:1](src.txt)', ''].join('\n'));
  check("draft carries the predecessor's judgment bullets as confirm placeholders",
    Object.values(JUDGED).every((b) => d2text.includes(`- [FILL: confirm still true] ${b}`))
    && d2text.indexOf('Alpha stays because') > d2text.indexOf('## Decisions made') && d2text.indexOf('Alpha stays because') < d2text.indexOf('## Traps and dead ends'));
  // Scope digests: the predecessor wrote none, so every PROGRAM.md scope document is a placeholder.
  const digests1 = join(repo, succ1, 'SCOPE_DIGESTS.md');
  const dg1 = existsSync(digests1) ? readFileSync(digests1, 'utf8') : '';
  const entryRe = (path) => new RegExp(`^## \`${path.replace(/\./g, '\\.')}\`\\n\\nHash: sha256:[0-9a-f]{64}\\nVerified-at: [0-9a-f]{7,}\\n\\n\\[FILL: digest\\]$`, 'm');
  check('draft --out writes SCOPE_DIGESTS.md with a hashed placeholder entry per scope document',
    ['src.txt', 'design.md', 'specs'].every((p) => entryRe(p).test(dg1)) && (dg1.match(/^## /gm) ?? []).length === 3);
  check('the draft points Registers and artifacts at SCOPE_DIGESTS.md',
    d2text.includes(`- Scope digests: \`${succ1}/SCOPE_DIGESTS.md\` · Verified-at: `) && d2text.includes('0 carried unchanged, 3 to write'));
  writeFileSync(join(repo, succ1, 'HANDOFF.md'), fill(d2text, REQ2));
  gitAt('add', '-A');
  gitAt('commit', '-q', '-m', 'hop 2');
  const unfilledDigests = inRepo([co, 'handoff', 'resume', 'Ledger2 AMM HO 2', '--session', 'sess-two-22222']);
  check('resume refuses a SCOPE_DIGESTS.md that still holds [FILL: digest] and does not consume',
    unfilledDigests.status === 1 && /^x {2}scope digests$/m.test(unfilledDigests.stdout) && unfilledDigests.stdout.includes('3 line(s) still hold')
    && unfilledDigests.stdout.includes('not consumed') && !existsSync(join(repo, succ1, 'HANDOFF.consumed')));
  // The writer fills src.txt and specs and drops the design.md entry; specs then changes.
  const pre = (path) => `(## \`${path}\`\\n\\nHash: [^\\n]*\\nVerified-at: [^\\n]*\\n\\n)\\[FILL: digest\\]\\n\\n?`;
  writeFileSync(digests1, dg1.replace(new RegExp(pre('design\\.md')), '')
    .replace(new RegExp(pre('src\\.txt')), '$1src.txt holds the alpha line.\n\n')
    .replace(new RegExp(pre('specs')), '$1specs holds two notes.\n\n'));
  writeFileSync(join(repo, 'specs', 'b.md'), 'spec b, revised\n');
  gitAt('add', '-A');
  gitAt('commit', '-q', '-m', 'digests');
  const res2 = inRepo([co, 'handoff', 'resume', 'Ledger2 AMM HO 2', '--session', 'sess-two-22222', '--host-session', 'local_host-2222']);
  const succ2 = /^successor run: (.+)$/m.exec(res2.stdout)?.[1];
  check('the second resume passes and names a -ho2 successor', res2.status === 0 && /-ledger2-ho2$/.test(succ2 ?? ''));
  check('resume marks each scope document unchanged, changed, or missing against SCOPE_DIGESTS.md',
    /^ok scope digests$/m.test(res2.stdout) && res2.stdout.includes(`scope documents (digests in ${succ1}/SCOPE_DIGESTS.md):\n`
      + '  unchanged src.txt: read its digest, not the document\n  missing design.md: no digest entry; read the document\n  changed specs: re-read the document\n')
    && res2.stdout.includes(`  scope digests: [${succ1}/SCOPE_DIGESTS.md](${enc(succ1)}/SCOPE_DIGESTS.md)`));
  check('resume stores --host-session in the successor SESSION.json and the session record',
    Boolean(succ2) && json(`${succ2}/SESSION.json`).hostSessionId === 'local_host-2222' && record('sess-two-22222').hostSessionId === 'local_host-2222'
    && record('sess-two-22222').runDir === succ2 && record('sess-one-11111').hostSessionId === null);

  // Name drift: a PROGRAM.md title that differs from the established session name never renames the hop.
  const ledger = join(repo, '80 Runs', 'programs', 'ledger2', 'PROGRAM.md');
  const ledgerText = readFileSync(ledger, 'utf8');
  writeFileSync(ledger, ledgerText.replace('# PROGRAM: Ledger2 AMM', '# PROGRAM: Platform operations'));
  const d3 = inRepo([co, 'handoff', 'draft', '--run', succ2, '--session', 'sess-two-22222']).stdout;
  check("draft keeps the predecessor's Session base name over a different PROGRAM.md title",
    /^Session: Ledger2 AMM HO 3$/m.test(d3) && /^Hop: 3$/m.test(d3) && !d3.includes('Platform operations'));
  writeFileSync(ledger, ledgerText);

  // Hop 3 digests: the unchanged src.txt keeps its digest and Verified-at; changed and missing reset.
  const d3out = inRepo([co, 'handoff', 'draft', '--run', succ2, '--out', `${succ2}/HANDOFF.md`, '--session', 'sess-two-22222']);
  const dg2 = existsSync(join(repo, succ2, 'SCOPE_DIGESTS.md')) ? readFileSync(join(repo, succ2, 'SCOPE_DIGESTS.md'), 'utf8') : '';
  const priorSrc = /^## `src\.txt`\n\nHash: [^\n]*\nVerified-at: ([^\n]*)\n\nsrc\.txt holds the alpha line\.$/m.exec(readFileSync(digests1, 'utf8'))?.[1];
  check('draft carries an unchanged entry forward with its digest and Verified-at',
    d3out.status === 0 && Boolean(priorSrc) && new RegExp(`^## \`src\\.txt\`\\n\\nHash: sha256:[0-9a-f]{64}\\nVerified-at: ${priorSrc}\\n\\nsrc\\.txt holds the alpha line\\.$`, 'm').test(dg2));
  check('draft resets a changed entry and a missing entry to [FILL: digest]',
    entryRe('specs').test(dg2) && entryRe('design.md').test(dg2) && !dg2.includes('specs holds two notes')
    && readFileSync(join(repo, succ2, 'HANDOFF.md'), 'utf8').includes('1 carried unchanged, 2 to write'));
  rmSync(join(repo, succ2, 'HANDOFF.md'));
  const redraft = inRepo([co, 'handoff', 'draft', '--run', succ2, '--out', `${succ2}/HANDOFF.md`, '--session', 'sess-two-22222']);
  check('draft refuses to overwrite an existing SCOPE_DIGESTS.md',
    redraft.status === 1 && redraft.stderr.includes('SCOPE_DIGESTS.md') && !existsSync(join(repo, succ2, 'HANDOFF.md')));

  // live walks two hops from the first handoff, from a session name, and from a session id.
  const liveFromPath = inRepo([co, 'handoff', 'live', `${run0}/HANDOFF.md`]);
  check('live walks two hops from the first handoff to the live head',
    liveFromPath.status === 0 && liveFromPath.stdout.includes('head session: Ledger2 AMM HO 2') && liveFromPath.stdout.includes('session id: sess-two-22222')
    && liveFromPath.stdout.includes(`run dir: ${succ2}`) && liveFromPath.stdout.includes('state: live') && liveFromPath.stdout.includes('hops walked: 2'));
  check('live prints the head host session when recorded', liveFromPath.stdout.includes('host session: local_host-2222'));
  const liveFromHost = inRepo([co, 'handoff', 'live', 'local_host-2222']);
  check('live from a host session id finds that session', liveFromHost.status === 0 && liveFromHost.stdout.includes('head session: Ledger2 AMM HO 2'));
  const liveNoHost = inRepo([co, 'handoff', 'live', `${run0}/HANDOFF.md`, '--host-session', 'x']);
  check('live rejects --host-session', liveNoHost.status === 2);
  const liveFromName = inRepo([co, 'handoff', 'live', 'ledger2 amm ho 1']);
  check('live from a session name walks from that session to the head',
    liveFromName.stdout.includes('session id: sess-two-22222') && liveFromName.stdout.includes('hops walked: 1'));
  const liveFromId = inRepo([co, 'handoff', 'live', 'sess-zer']);
  check('live from a unique 8-character session id prefix reaches the head', liveFromId.stdout.includes('head session: Ledger2 AMM HO 2'));
  writeFileSync(join(repo, succ2, 'HANDOFF.md'), '# HANDOFF\n\n## Program\n\nSession: Ledger2 AMM HO 3\nHop: 3\n');
  const liveAwaiting = inRepo([co, 'handoff', 'live', `${run0}/HANDOFF.md`]);
  check('live marks a head that wrote an unconsumed handoff as awaiting resume',
    liveAwaiting.stdout.includes('state: awaiting resume') && liveAwaiting.stdout.includes('Ledger2 AMM HO 3'));

  // a legacy consumed body is still consumed, with no successor link to follow.
  writeFileSync(join(repo, succ2, 'HANDOFF.consumed'), '2026-09-01T00:00:00.000Z\n');
  const liveLegacy = inRepo([co, 'handoff', 'live', `${run0}/HANDOFF.md`]);
  check('live accepts a legacy consumed body and stops at it', liveLegacy.status === 0 && liveLegacy.stdout.includes('state: unknown: a legacy HANDOFF.consumed'));
  const legacyByName = inRepo([co, 'handoff', 'resume', 'Ledger2 AMM HO 3']);
  check('resume by name skips a handoff with a legacy consumed body', legacyByName.status === 1 && legacyByName.stderr.includes('no file or unconsumed handoff'));

  // an ambiguous name lists the candidates and exits 1; so does an unknown one.
  for (const n of ['a', 'b']) {
    mkdirSync(join(repo, '80 Runs', `dup-${n}`));
    writeFileSync(join(repo, '80 Runs', `dup-${n}`, 'HANDOFF.md'), '# HANDOFF\n\n## Program\n\nSession: Dup HO 1\nHop: 1\n');
  }
  const dup = inRepo([co, 'handoff', 'resume', 'dup ho 1']);
  check('resume by an ambiguous name exits 1 and lists both candidates',
    dup.status === 1 && dup.stderr.includes('ambiguous session name') && dup.stderr.includes('dup-a/HANDOFF.md') && dup.stderr.includes('dup-b/HANDOFF.md'));
  const none = inRepo([co, 'handoff', 'resume', 'Nobody HO 9']);
  check('resume by an unknown name exits 1 and lists the unconsumed handoffs', none.status === 1 && none.stderr.includes('Dup HO 1 -> 80 Runs/dup-a/HANDOFF.md'));

  // A long predecessor: carried judgment bullets stop at the 8 KB cap and count the rest.
  mkdirSync(join(repo, '80 Runs', 'cap-pred'));
  mkdirSync(join(repo, '80 Runs', 'cap-run'));
  const many = Array.from({ length: 200 }, (_, i) => `- Decision ${i}: a deliberately long line that fills the handoff past its cap quickly.`);
  writeFileSync(join(repo, '80 Runs', 'cap-pred', 'HANDOFF.md'), `# HANDOFF\n\n## Program\n\nSession: Single tap ledger2 data HO 1\nHop: 1\n\n## Decisions made\n\n${many.join('\n')}\n\n## Traps and dead ends\n\n- Trap kept?\n`);
  writeFileSync(join(repo, '80 Runs', 'cap-run', 'SESSION.json'), JSON.stringify({ v: 1, sessionId: null, name: 'Single tap ledger2 data HO 1', hop: 1, predecessor: '80 Runs/cap-pred/HANDOFF.md' }));
  const capped = inRepo([co, 'handoff', 'draft', '--run', '80 Runs/cap-run']).stdout;
  const kept = capped.split('\n').filter((l) => l.startsWith('- [FILL: confirm still true] Decision ')).length;
  const left = Number(/\[FILL: (\d+) more predecessor bullet\(s\) not carried under the 8 KB cap/.exec(capped)?.[1]);
  check(`a long predecessor's carried bullets stay under 8 KB and count the rest (${Buffer.byteLength(capped)} B, ${kept} kept)`,
    Buffer.byteLength(capped) < 8 * 1024 && kept > 0 && kept + left === many.length && capped.includes('80 Runs/cap-pred/HANDOFF.md'));
  check('draft keeps the recorded case of the session base name', /^Session: Single tap ledger2 data HO 2$/m.test(capped));
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

// ---- ledger grammar 2: draft tiers, anchors, dispositions, write-back, and program archive ----
const g2 = mkdtempSync(join(tmpdir(), 'handoff-g2-'));
const inG2 = (args) => spawnSync(process.execPath, args, { cwd: g2, encoding: 'utf8', env });
try {
  const gitG2 = (...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], { cwd: g2, stdio: 'ignore' });
  writeFileSync(join(g2, 'src.txt'), 'alpha line\nbeta line\n');
  gitG2('init', '-q');
  gitG2('add', 'src.txt');
  gitG2('commit', '-q', '-m', 'base');
  const hub = join(g2, '80 Runs');
  const ledgerFile = join(hub, 'programs', 'g2', 'PROGRAM.md');
  mkdirSync(dirname(ledgerFile), { recursive: true });
  const oi1 = '- [ ] OI-1 alpha kept · Owner: agent · Done when: alpha stays · Pointer: src.txt:1 · Anchor: `alpha line`';
  const oi2 = '- [ ] OI-2 beta rewrite not started · Owner: agent · Done when: beta reads v2 · Pointer: src.txt:1 · Anchor: `alpha line`';
  const ledgerText = (open) => ['# PROGRAM: G2', '', 'Grammar: 2', '', '## Program goal', '', 'Rewrite beta.', '', '## Request history', '',
    '- 2026-09-20: rewrite beta.', '', '## Scope documents', '', '- `src.txt` · Status: current · Role: the file under change', '',
    '## Open items', '', ...open, '', '## Decisions ledger', '',
    '- DEC-1 2026-09-20 Beta keeps its name · Rejected: a rename · Hop: 0 · Disposition: pending',
    '- DEC-2 2026-09-21 Beta moves to v2 · Rejected: v3 · Hop: 2 · Disposition: pending', '', '## Closed items', '', ''].join('\n');
  writeFileSync(ledgerFile, ledgerText([oi1, oi2]));
  const prior = join(hub, 'g2-r0');
  mkdirSync(prior);
  writeFileSync(join(prior, 'HANDOFF.md'), '# HANDOFF: g2-r0\n\n## Program\n\nProgram: 80 Runs/programs/g2/PROGRAM.md\nPredecessor: none\nSession: G2 HO 2\nHop: 2\n\n## Open items\n\n');
  const runG2 = join(hub, 'g2-r1');
  mkdirSync(runG2);
  writeFileSync(join(runG2, 'SESSION.json'), JSON.stringify({ v: 1, sessionId: null, name: 'G2 HO 2', hop: 2, predecessor: '80 Runs/g2-r0/HANDOFF.md' }));
  const oi2Now = '- [ ] OI-2 beta rewrite in progress · Owner: agent · Done when: beta reads v2 · Pointer: src.txt:2';
  const oi3 = '- [ ] OI-3 gamma not started · Owner: agent · Done when: gamma exists · Pointer: src.txt';
  writeFileSync(join(runG2, 'TASKS.md'), `# Tasks\n\n${oi1}\n${oi2Now}\n${oi3}\n`);
  const dG2 = inG2([co, 'handoff', 'draft', '--run', '80 Runs/g2-r1', '--out', '80 Runs/g2-r1/HANDOFF.md']);
  const g2Draft = existsSync(join(runG2, 'HANDOFF.md')) ? readFileSync(join(runG2, 'HANDOFF.md'), 'utf8') : '';
  check('grammar 2 draft exits 0', dG2.status === 0);
  check('grammar 2 draft shows a carried item as id and title only', g2Draft.includes('\n- [ ] OI-1 alpha kept\n'));
  check('grammar 2 draft fills an active item Anchor from the cited line', g2Draft.includes(`${oi2Now} · Anchor: \`beta line\``));
  check('grammar 2 draft marks a line-less pointer for an anchor', g2Draft.includes(`${oi3} · Anchor: [FILL: verbatim text from the cited line]`));
  check('grammar 2 draft lists an earlier pending decision for a disposition, and only that one',
    g2Draft.includes('- [FILL: disposition] DEC-1 2026-09-20 Beta keeps its name') && !g2Draft.includes('[FILL: disposition] DEC-2'));
  check('grammar 2 draft asks for one-clause decision lines', g2Draft.includes('[FILL: one `- DEC-<n> <one clause>` line per decision made this hop'));
  const ledgerAfter = readFileSync(ledgerFile, 'utf8');
  check('grammar 2 draft writes the active item back to the ledger', dG2.stdout.includes('open item line(s)')
    && ledgerAfter.includes(`${oi2Now} · Anchor: \`beta line\``) && ledgerAfter.includes(oi1) && !ledgerAfter.includes('OI-3'));

  // OI-29: a first hop names its ledger with --program, so it gets scope digests.
  const first = join(hub, 'g2-first');
  mkdirSync(first);
  writeFileSync(join(first, 'SESSION.json'), JSON.stringify({ v: 1, sessionId: null, name: 'G2', hop: 0, predecessor: null }));
  const dFirst = inG2([co, 'handoff', 'draft', '--run', '80 Runs/g2-first', '--out', '80 Runs/g2-first/HANDOFF.md', '--program', '80 Runs/programs/g2/PROGRAM.md']);
  check('a first-hop draft with --program names the ledger and writes scope digests', dFirst.status === 0
    && readFileSync(join(first, 'HANDOFF.md'), 'utf8').includes('Program: 80 Runs/programs/g2/PROGRAM.md') && existsSync(join(first, 'SCOPE_DIGESTS.md')));

  // ---- co program archive (DEC-32) ----
  const bigFile = join(hub, 'programs', 'big', 'PROGRAM.md');
  mkdirSync(dirname(bigFile), { recursive: true });
  const requests = Array.from({ length: 30 }, (_, i) => `- 2026-09-${String(i % 28 + 1).padStart(2, '0')}: request ${i} ${'r'.repeat(1200)}`);
  writeFileSync(bigFile, ['# PROGRAM: Big', '', 'Grammar: 2', '', '## Program goal', '', 'Stay under the cap.', '', '## Request history', '', ...requests, '',
    '## Scope documents', '', '- `src.txt` · Status: current · Role: the file', '', '## Open items', '', oi1, '', '## Decisions ledger', '',
    '- DEC-1 2026-09-20 Settled locally · Hop: 0 · Disposition: local', '- DEC-2 2026-09-21 Still open · Hop: 1 · Disposition: pending',
    '- DEC-3 2026-09-21 Promoted · Hop: 1 · Disposition: promoted:D-001', '', '## Closed items', '', '- OI-4 closed · closed by DEC-1', '  continued proof line', ''].join('\n'));
  check('the fixture ledger starts over the 32 KB cap', Buffer.byteLength(readFileSync(bigFile)) > 32 * 1024);
  const arch = inG2([co, 'program', 'archive', 'big', '--root', '.']);
  const bigAfter = readFileSync(bigFile, 'utf8');
  const archFile = join(dirname(bigFile), 'PROGRAM.archive.md');
  const archText = existsSync(archFile) ? readFileSync(archFile, 'utf8') : '';
  check('program archive exits 0 and brings the ledger under 32 KB', arch.status === 0 && Buffer.byteLength(bigAfter) <= 32 * 1024);
  check('program archive keeps the first and the last ten requests', bigAfter.includes(requests[0]) && requests.slice(-10).every((r) => bigAfter.includes(r))
    && !bigAfter.includes(requests[1]) && !bigAfter.includes(requests[19]));
  check('program archive moves the middle requests verbatim', requests.slice(1, 20).every((r) => archText.includes(r)) && !archText.includes(requests[0]));
  check('program archive moves settled decisions and keeps the pending one', archText.includes('DEC-1 2026-09-20') && archText.includes('DEC-3 2026-09-21')
    && !archText.includes('DEC-2') && bigAfter.includes('DEC-2 2026-09-21 Still open') && !bigAfter.includes('DEC-1 2026-09-20'));
  check('program archive moves closed items with their continuation lines', archText.includes('- OI-4 closed · closed by DEC-1\n  continued proof line') && !bigAfter.includes('OI-4'));
  check('the archive holds only the three archived headings', (archText.match(/^## .+$/gm) ?? []).join('|') === '## Request history|## Decisions ledger|## Closed items');
  const again = inG2([co, 'program', 'archive', '80 Runs/programs/big/PROGRAM.md', '--root', '.']);
  check('a second archive run has nothing to move', again.status === 0 && again.stdout.includes('nothing to archive') && readFileSync(archFile, 'utf8') === archText);
  writeFileSync(join(hub, 'programs', 'big', 'G1.md'), bigAfter.replace('Grammar: 2\n', ''));
  const g1 = inG2([co, 'program', 'archive', '80 Runs/programs/big/G1.md', '--root', '.']);
  check('program archive refuses a grammar 1 ledger', g1.status === 1 && /no "Grammar: 2" line/.test(g1.stderr));

  // An over-cap ledger with nothing settled to move fails closed instead of reporting success.
  const overFile = join(hub, 'programs', 'over', 'PROGRAM.md');
  mkdirSync(dirname(overFile), { recursive: true });
  const overText = ['# PROGRAM: Over', '', 'Grammar: 2', '', '## Decisions ledger', '',
    `- DEC-1 2026-09-20 Unsettled ${'d'.repeat(33 * 1024)} · Hop: 0 · Disposition: pending`, ''].join('\n');
  writeFileSync(overFile, overText);
  const over = inG2([co, 'program', 'archive', 'over', '--root', '.']);
  check('an over-cap ledger with nothing movable exits 1 and reports it is over the cap', over.status === 1
    && over.stdout.includes('nothing to archive') && over.stdout.includes('still over it') && readFileSync(overFile, 'utf8') === overText);

  // Fixtures for the line-ending and prose checks: 13 requests so two move, a settled decision, and a closed item.
  const smallReqs = Array.from({ length: 13 }, (_, i) => `- 2026-09-${String(i + 1).padStart(2, '0')}: small request ${i}`);
  const smallLedger = (closed) => ['# PROGRAM: Small', '', 'Grammar: 2', '', '## Request history', '', ...smallReqs, '', '## Decisions ledger', '',
    '- DEC-1 2026-09-20 Settled · Hop: 0 · Disposition: local', '- DEC-2 2026-09-21 Open · Hop: 1 · Disposition: pending', '', '## Closed items', '', ...closed, ''].join('\n');
  const smallDir = (name) => { const d = join(hub, 'programs', name); mkdirSync(d, { recursive: true }); return d; };

  // S3: a CRLF ledger archives the same entries as its LF twin and keeps its line ending.
  const lfDir = smallDir('lf');
  const crDir = smallDir('crlf');
  writeFileSync(join(lfDir, 'PROGRAM.md'), smallLedger(['- OI-4 closed · closed by DEC-1', '  continued proof line']));
  writeFileSync(join(crDir, 'PROGRAM.md'), smallLedger(['- OI-4 closed · closed by DEC-1', '  continued proof line']).replace(/\n/g, '\r\n'));
  const lfRun = inG2([co, 'program', 'archive', 'lf', '--root', '.']);
  const crRun = inG2([co, 'program', 'archive', 'crlf', '--root', '.']);
  const readIn = (dir, name) => readFileSync(join(dir, name), 'utf8');
  const crLedger = readIn(crDir, 'PROGRAM.md');
  const crArchive = readIn(crDir, 'PROGRAM.archive.md');
  check('a CRLF ledger archives the same entries as the LF ledger', lfRun.status === 0 && crRun.status === 0
    && crLedger.replace(/\r\n/g, '\n') === readIn(lfDir, 'PROGRAM.md') && crArchive.replace(/\r\n/g, '\n') === readIn(lfDir, 'PROGRAM.archive.md')
    && readIn(lfDir, 'PROGRAM.archive.md').includes('- OI-4 closed · closed by DEC-1\n  continued proof line') && readIn(lfDir, 'PROGRAM.archive.md').includes('small request 1')
    && !readIn(lfDir, 'PROGRAM.md').includes('OI-4'));
  check('a CRLF ledger and its archive keep CRLF line endings', crLedger.includes('\r\n') && crArchive.includes('\r\n')
    && !/(^|[^\r])\n/.test(crLedger + crArchive));

  // B2: prior archive prose survives a run, and a moved entry keeps a blank-separated continuation paragraph.
  const proseDir = smallDir('prose');
  const proseArchive = join(proseDir, 'PROGRAM.archive.md');
  writeFileSync(proseArchive, ['# PROGRAM archive: Small', '', 'Intro paragraph the archive keeps.', '', '## Request history', '', '- 2026-08-01: older request',
    'Prose under requests.', '', '## Decisions ledger', '', '## Closed items', '', '- OI-1 older closed', '', 'Trailing prose under closed items.', ''].join('\n'));
  const paragraph = ['- OI-4 closed · closed by DEC-1', '  first continuation line', '', '  second paragraph after a blank line'];
  writeFileSync(join(proseDir, 'PROGRAM.md'), smallLedger(paragraph));
  const proseRun = inG2([co, 'program', 'archive', 'prose', '--root', '.']);
  const proseText = readFileSync(proseArchive, 'utf8');
  const proseKept = (t) => ['Intro paragraph the archive keeps.', 'Prose under requests.', 'Trailing prose under closed items.', '- 2026-08-01: older request', '- OI-1 older closed']
    .every((s) => t.includes(s));
  check('prior archive prose and entries survive an archive run', proseRun.status === 0 && proseKept(proseText)
    && proseText.indexOf('older request') < proseText.indexOf('small request 1') && proseText.indexOf('- OI-1 older closed') < proseText.indexOf('- OI-4 closed'));
  check('a moved entry keeps its blank-separated continuation paragraph', proseText.includes(`${paragraph.join('\n')}\n`)
    && !readIn(proseDir, 'PROGRAM.md').includes('second paragraph'));
  writeFileSync(join(proseDir, 'PROGRAM.md'), smallLedger(['- OI-5 closed later']));
  const proseAgain = inG2([co, 'program', 'archive', 'prose', '--root', '.']);
  const proseText2 = readFileSync(proseArchive, 'utf8');
  check('prior archive prose survives a second archive run', proseAgain.status === 0 && proseKept(proseText2)
    && proseText2.includes(paragraph.join('\n')) && proseText2.includes('- OI-5 closed later'));

  // ---- co program split and merge (design L5) ----
  const ANCHORED = 'Pointer: scripts/check-handoff.mjs:2 · Anchor: `HANDOFF.md structural checker`';
  const item = (id, title) => `- [ ] ${id} ${title} · Owner: agent · Done when: ${title} is done · ${ANCHORED}`;
  const decision = (id, hop, disposition) => `- ${id} 2026-09-2${hop} Decision ${id} · Hop: ${hop} · Disposition: ${disposition}`;
  const ledgerOf = (slug, { requests, open, decisions, scope = ['scripts/check-handoff.mjs'] }) => {
    const file = join(hub, 'programs', slug, 'PROGRAM.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, [`# PROGRAM: ${slug}`, '', 'Grammar: 2', '', '## Program goal', '', `Goal of ${slug}.`, '', '## Request history', '', ...requests, '',
      '## Scope documents', '', ...scope.map((s) => `- \`${s}\` · Status: current · Role: fixture`), '', '## Open items', '', ...open, '',
      '## Decisions ledger', '', ...decisions, '', '## Closed items', '', ''].join('\n'));
    return file;
  };
  const readAt = (slug, name = 'PROGRAM.md') => readFileSync(join(hub, 'programs', slug, name), 'utf8');
  const splitFixture = { requests: ['- 2026-09-20: start the split program.', '- 2026-09-21: keep the split going.'], open: [item('OI-1', 'alpha'), item('OI-2', 'beta')],
    decisions: [decision('DEC-1', 1, 'pending'), decision('DEC-2', 0, 'local'), decision('DEC-3', 1, 'pending')] };
  const splitArchive = ['# PROGRAM archive: sp', '', '## Request history', '', '- 2026-09-01: older archived request.', '', '## Decisions ledger', '', '## Closed items', ''].join('\n');
  const spFile = ledgerOf('sp', splitFixture);
  writeFileSync(join(dirname(spFile), 'PROGRAM.archive.md'), splitArchive);
  const spBefore = readFileSync(spFile, 'utf8');
  const split = (...args) => inG2([co, 'program', 'split', ...args, '--root', '.']);

  const partial = split('sp', '--into', 'sa,sb', '--assign', 'OI-1=sa,DEC-1=sa');
  check('split-refuses-unassigned exits 1 and names every unassigned id and only those', partial.status === 1 && partial.stderr.includes('unassigned: OI-2, DEC-3')
    && !partial.stderr.includes('DEC-2'));
  check('split-refuses-unassigned writes no child and leaves the parent as it was', !existsSync(join(hub, 'programs', 'sa')) && readFileSync(spFile, 'utf8') === spBefore);
  const stray = split('sp', '--into', 'sa,sb', '--assign', 'OI-1=zz,OI-2=sb,DEC-1=sa,DEC-3=sb');
  check('split refuses an assignment to a child --into does not name', stray.status === 1 && stray.stderr.includes('OI-1 is assigned to zz') && readFileSync(spFile, 'utf8') === spBefore);

  const done = split('sp', '--into', 'sa,sb', '--assign', 'OI-1=sa,DEC-1=sa,OI-2=sb,DEC-3=sb');
  const [sa, sb, spAfter] = existsSync(join(hub, 'programs', 'sb', 'PROGRAM.md')) ? [readAt('sa'), readAt('sb'), readFileSync(spFile, 'utf8')] : ['', '', ''];
  check('split writes both children as grammar 2 ledgers with the goal, every request, and the scope documents', done.status === 0
    && [sa, sb].every((t) => /^Grammar: 2$/m.test(t) && t.includes('Split-from: sp') && t.includes('Goal of sp.') && t.includes('- 2026-09-20: start the split program.')
      && t.includes('- 2026-09-21: keep the split going.') && t.includes('- 2026-09-01: older archived request.') && t.includes('- `scripts/check-handoff.mjs` · Status: current')));
  check('split gives each child only its assigned items, with their original ids and lines', sa.includes(splitFixture.open[0]) && sa.includes(splitFixture.decisions[0])
    && sb.includes(splitFixture.open[1]) && sb.includes(splitFixture.decisions[2])
    && !/OI-2|DEC-3|DEC-2/.test(sa) && !/OI-1|DEC-1|DEC-2/.test(sb));
  check('split marks each parent open item and pending decision Forwarded-to and leaves the settled one alone',
    spAfter.includes(`${splitFixture.open[0]} · Forwarded-to: sa/OI-1`) && spAfter.includes(`${splitFixture.open[1]} · Forwarded-to: sb/OI-2`)
    && spAfter.includes(`${splitFixture.decisions[0]} · Forwarded-to: sa/DEC-1`) && spAfter.includes(`${splitFixture.decisions[2]} · Forwarded-to: sb/DEC-3`)
    && !spAfter.split('\n').find((l) => l.startsWith('- DEC-2')).includes('Forwarded-to'));
  const twin = ledgerOf('sp2', splitFixture);
  const twinBefore = readFileSync(twin, 'utf8');
  const clash = split('sp2', '--into', 'sa,sc', '--assign', 'OI-1=sa,DEC-1=sa,OI-2=sc,DEC-3=sc');
  check('split refuses an existing child ledger and writes nothing', clash.status === 1 && /sa already has a ledger/.test(clash.stderr)
    && readFileSync(twin, 'utf8') === twinBefore && !existsSync(join(hub, 'programs', 'sc')));

  // A CRLF parent keeps its line ending in the parent and in each child.
  const crFile = ledgerOf('spcr', splitFixture);
  writeFileSync(crFile, readFileSync(crFile, 'utf8').replace(/\n/g, '\r\n'));
  const crSplit = split('spcr', '--into', 'ca,cb', '--assign', 'OI-1=ca,DEC-1=ca,OI-2=ca,DEC-3=ca');
  const crTexts = [readFileSync(crFile, 'utf8'), readAt('ca'), readAt('cb')];
  check('split keeps CRLF in the parent and both children', crSplit.status === 0 && crTexts.every((t) => t.includes('\r\n') && !/(^|[^\r])\n/.test(t))
    && crTexts[0].includes('Forwarded-to: ca/OI-2'));

  // Check 9 (design L5): a predecessor item a split or a merge moved does not count as dropped.
  const handoffText = ({ program, predecessor = 'none', request, hop, open = '', decisions = 'None this hop.' }) => ['# HANDOFF: split eval', '', 'Verified-at: abc1234 (main, clean).', '',
    `## Program\n\nProgram: ${program}\nPredecessor: ${predecessor}\nSession: Sp HO ${hop}\nHop: ${hop}\n`,
    `## Goal and state of play\n\nRequest: ${request}\n\n- Objective: exercise the split and merge cases. History: base..head (no exceptions).\n`,
    '## Scope and constraints\n\n- Repository: this fixture. Branch: none. Out of scope: prose quality.\n',
    '## Work completed\n\n- base..head across scripts/handoff-state.mjs: fixture shape.\n',
    '## Key findings\n\n- CONFIRMED: the fixture checks lineage. Pointer: scripts/check-handoff.mjs:5\n',
    '## Registers and artifacts\n\n- FINDINGS_REGISTER.md: fixture register, pointed at rather than re-pasted. Verified-at: abc1234.\n',
    `## Decisions made\n\n${decisions}\n`, '## Traps and dead ends\n\n- None encountered in this fixture.\n',
    `## In-flight boundaries\n\n- Nothing in flight. ${ANCHORED}\n`, `## Open items\n\n${open}\n`,
    '## Authority\n\n- No grants recorded in this fixture. None carries into a resumed session.\n',
    '## Carried context\n\n- Nothing carried; this fixture needs no analysis file.\n'].join('\n');
  const wr = (name, text) => { const p = join(g2, name); writeFileSync(p, text); return p; };
  const coh = (file) => spawnSync(process.execPath, [checker, file, '--root', REPO], { encoding: 'utf8', env });
  const ledgerPath = (slug) => join(hub, 'programs', slug, 'PROGRAM.md');
  const chain = (name, { from, to, fromRequest, toRequest, open }) => {
    const prior = wr(`${name}-prior.md`, handoffText({ program: ledgerPath(from), request: fromRequest, hop: 1, open }));
    return coh(wr(`${name}-next.md`, handoffText({ program: ledgerPath(to), predecessor: prior, request: toRequest, hop: 2 })));
  };
  const priorOpen = `${splitFixture.open[0]}\n${splitFixture.open[1]}`;
  const forwarded = chain('fwd', { from: 'sp', to: 'sp', fromRequest: 'start the split program.', toRequest: 'keep the split going.', open: priorOpen });
  check('check 9 passes a predecessor item that the ledger carries with Forwarded-to', forwarded.status === 0);
  if (forwarded.status !== 0) console.error(forwarded.stdout + forwarded.stderr);
  ledgerOf('sp3', splitFixture);
  const unforwarded = chain('unfwd', { from: 'sp', to: 'sp3', fromRequest: 'start the split program.', toRequest: 'keep the split going.', open: priorOpen });
  check('check 9 still fails an item the ledger neither carries nor forwards', unforwarded.status === 1
    && /predecessor open item OI-1 was dropped/.test(unforwarded.stderr) && /predecessor open item OI-2 was dropped/.test(unforwarded.stderr));
  const childChain = coh(wr('child.md', handoffText({ program: ledgerPath('sa'), request: 'keep the split going.', hop: 1 })));
  check('a split child ledger passes check-handoff', childChain.status === 0);
  if (childChain.status !== 0) console.error(childChain.stdout + childChain.stderr);

  // A split child's first hop resumes the parent's last handoff: ids the parent forwarded to the child or to a
  // sibling pass checks 9 and 13 with the sibling's items absent, and an id forwarded nowhere still fails.
  const parentLast = ({ open = '', decisions = '' } = {}) => wr('parent-last.md', handoffText({ program: ledgerPath('sp'), request: 'start the split program.', hop: 1,
    open: [priorOpen, open].filter(Boolean).join('\n'), decisions: ['- DEC-1 alpha choice', '- DEC-3 beta choice', decisions].filter(Boolean).join('\n') }));
  const childFirst = (slug, predecessor) => coh(wr(`first-${slug}.md`, handoffText({ program: ledgerPath(slug), predecessor, request: 'keep the split going.', hop: 2 })));
  const firstA = childFirst('sa', parentLast());
  check('a split child first handoff passes checks 9 and 13 with the sibling-assigned ids absent', firstA.status === 0);
  if (firstA.status !== 0) console.error(firstA.stdout + firstA.stderr);
  const firstB = childFirst('sb', parentLast());
  check('the sibling child passes the same way', firstB.status === 0);
  const strayItem = `- [ ] OI-7 stray · Owner: agent · Done when: never · ${ANCHORED}`;
  const notForwarded = childFirst('sa', parentLast({ open: strayItem, decisions: '- DEC-2 settled locally' }));
  check('a split child first handoff fails an open item and a decision the parent forwarded nowhere',
    notForwarded.status === 1 && /predecessor open item OI-7 was dropped/.test(notForwarded.stderr) && /check 13: predecessor decision DEC-2 /.test(notForwarded.stderr)
    && !/OI-[12] was dropped|decision DEC-[13] /.test(notForwarded.stderr));
  ledgerOf('sx', { requests: splitFixture.requests, open: [], decisions: [] });
  const unrelated = childFirst('sx', parentLast());
  check('a ledger that is neither the forward target nor a Split-from child gets no pass for the parent forwards', unrelated.status === 1
    && /predecessor open item OI-1 was dropped/.test(unrelated.stderr) && /check 13: predecessor decision DEC-3 /.test(unrelated.stderr));

  // merge-renumbers-with-was: both ledgers hold DEC-1 and OI-1, and the target's archive holds OI-6 and DEC-4.
  const merge = (...args) => inG2([co, 'program', 'merge', ...args, '--root', '.']);
  const maFile = ledgerOf('ma', { requests: ['- 2026-09-20: keep the target going.'], open: [item('OI-1', 'target alpha')], decisions: [decision('DEC-1', 1, 'pending')] });
  writeFileSync(join(dirname(maFile), 'PROGRAM.archive.md'), ['# PROGRAM archive: ma', '', '## Request history', '', '## Decisions ledger', '', decision('DEC-4', 0, 'local'), '',
    '## Closed items', '', '- OI-6 closed earlier · closed by DEC-4', ''].join('\n'));
  const beta = `- [ ] OI-2 source beta blocked by OI-1 · Owner: agent · Done when: OI-1 lands · ${ANCHORED}`;
  const mbFile = ledgerOf('mb', { requests: ['- 2026-09-21: finish the source program.'], scope: ['scripts/check-handoff.mjs', 'scripts/handoff-state.mjs'],
    open: [item('OI-1', 'source alpha'), beta], decisions: [decision('DEC-1', 1, 'pending'), decision('DEC-2', 0, 'local')] });
  const merged = merge('mb', '--into', 'ma');
  const ma = readAt('ma');
  const mb = readAt('mb');
  check('merge exits 0 and reports each renumbered id', merged.status === 0 && merged.stdout.includes('OI-1 -> OI-7 (Was: mb/OI-1)') && merged.stdout.includes('DEC-1 -> DEC-5 (Was: mb/DEC-1)'));
  check('merge gives each imported item the next free id across the ledger and its archive, with a Was: trail',
    ma.includes(`${item('OI-7', 'source alpha')} · Was: mb/OI-1`) && ma.includes(`${decision('DEC-5', 1, 'pending')} · Was: mb/DEC-1`)
    && ma.includes(`- [ ] OI-8 source beta blocked by OI-7 · Owner: agent · Done when: OI-7 lands · ${ANCHORED} · Was: mb/OI-2`)
    && ma.includes(item('OI-1', 'target alpha')) && ma.includes(decision('DEC-1', 1, 'pending')) && !ma.includes('DEC-2'));
  const leading = [ma, readAt('ma', 'PROGRAM.archive.md')].flatMap((t) => t.split('\n')).map((l) => /^[-*]\s+(?:\[[ xX]\]\s+)?((?:DEC|OI)-\d+)\b/.exec(l)?.[1]).filter(Boolean);
  check('merge leaves every DEC and OI id unique across the target and its archive', leading.length === 7 && new Set(leading).size === leading.length);
  check('merge tags each source request and adds only the scope documents the target lacks',
    ma.includes('- 2026-09-21 [from mb]: finish the source program.') && ma.includes('- 2026-09-20: keep the target going.')
    && ma.split('`scripts/check-handoff.mjs`').length === 2 && ma.split('`scripts/handoff-state.mjs`').length === 2);
  check('merge marks the source merged and each imported source item Forwarded-to', /## Program goal\n\nStatus: merged into ma\n/.test(mb)
    && mb.includes(`${item('OI-1', 'source alpha')} · Forwarded-to: ma/OI-7`) && mb.includes(`· Forwarded-to: ma/OI-8`) && mb.includes(`${decision('DEC-1', 1, 'pending')} · Forwarded-to: ma/DEC-5`)
    && !mb.split('\n').find((l) => l.startsWith('- DEC-2')).includes('Forwarded-to'));
  const remerge = merge('mb', '--into', 'ma');
  check('merge refuses a source that is already merged', remerge.status === 1 && remerge.stderr.includes('Status: merged into ma') && readAt('ma') === ma);
  const mbPrior = wr('was-prior.md', handoffText({ program: mbFile, request: 'finish the source program.', hop: 1, open: `${item('OI-1', 'source alpha')}\n${beta}` }));
  const wasNext = (program, predecessor) => coh(wr('was-next.md', handoffText({ program, predecessor, request: 'keep the target going.', hop: 2 })));
  const wasPass = wasNext(maFile, mbPrior);
  check('check 9 passes a predecessor item a Was: trail names, and check 18 holds on the merged ledger', wasPass.status === 0);
  if (wasPass.status !== 0) console.error(wasPass.stdout + wasPass.stderr);
  const otherPrior = wr('was-other-prior.md', handoffText({ program: join(hub, 'programs', 'zz', 'PROGRAM.md'), request: 'finish the source program.', hop: 1, open: item('OI-1', 'source alpha') }));
  const wasOther = wasNext(maFile, otherPrior);
  check('check 9 does not let a Was: trail satisfy an id of another program', wasOther.status === 1 && /predecessor open item OI-1 was dropped/.test(wasOther.stderr));

  // A running source head blocks a merge until --head-ended: an unconsumed handoff, or a consumed one whose successor run has no handoff yet.
  const one = (n) => ({ requests: [`- 2026-09-22: request of ${n}.`], open: [item('OI-1', n)], decisions: [] });
  const heads = (slug, consumed) => {
    const dir = join(hub, `${slug}-r1`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'HANDOFF.md'), `# HANDOFF\n\n## Program\n\nProgram: 80 Runs/programs/${slug}/PROGRAM.md\nPredecessor: none\n`);
    if (consumed) {
      mkdirSync(join(hub, `${slug}-r2`), { recursive: true });
      writeFileSync(join(dir, 'HANDOFF.consumed'), JSON.stringify({ v: 2, consumedAt: 'now', bySession: null, successorRun: `80 Runs/${slug}-r2`, name: null }));
    }
  };
  for (const [source, consumed, state] of [['rs', false, 'awaiting resume'], ['cs', true, 'live']]) {
    const sFile = ledgerOf(source, one(source));
    const tFile = ledgerOf(`${source}t`, one(`${source}t`));
    heads(source, consumed);
    const [sBefore, tBefore] = [readFileSync(sFile, 'utf8'), readFileSync(tFile, 'utf8')];
    const blockedMerge = merge(source, '--into', `${source}t`);
    check(`merge refuses a source whose head is ${state} without --head-ended and writes nothing`, blockedMerge.status === 1
      && blockedMerge.stderr.includes('head session looks running') && blockedMerge.stderr.includes(state) && readFileSync(sFile, 'utf8') === sBefore && readFileSync(tFile, 'utf8') === tBefore);
    const ended = merge(source, '--into', `${source}t`, '--head-ended');
    check(`merge --head-ended proceeds past a ${state} head`, ended.status === 0 && readFileSync(sFile, 'utf8').includes(`Status: merged into ${source}t`));
  }

  // ---- resume: UNLANDED, register drift, and forwarding (design L4) ----
  // A v3-like hub is enough: a tracked manifest, Records/state.json, and Records/intake.jsonl. Commit c1 holds D-001 and D-003
  // in force, D-005 superseded, and D-002 staged in intake. Commit c2 supersedes D-001 and amends D-003, so a handoff verified
  // at c1 sees drift on both and none on D-005 (already superseded) or D-002 (still in force). D-404 is nowhere.
  const lcWrite = (rel, text) => { mkdirSync(dirname(join(g2, rel)), { recursive: true }); writeFileSync(join(g2, rel), text); };
  const STATE = 'docs/98 System/Records/state.json';
  const FORWARDING = 'docs/98 System/FORWARDING.json';
  const stateOf = (records) => `${JSON.stringify({ records })}\n`;
  lcWrite('docs/98 System/DOCS_MANIFEST.json', '{}\n');
  lcWrite(STATE, stateOf([{ id: 'D-001', status: 'in-force' }, { id: 'D-003', status: 'in-force' }, { id: 'D-005', status: 'superseded' }]));
  lcWrite('docs/98 System/Records/intake.jsonl', `${JSON.stringify({ type: 'record', recordId: 'D-002', intakeId: 'INT-1' })}\n`);
  lcWrite('scripts/check-handoff.mjs', readFileSync(checker, 'utf8'));
  lcWrite('docs/new-scope/spec.md', '# spec\n');
  lcWrite('docs/new/plan-v2.md', '# plan heading\n');
  gitG2('add', 'docs', 'scripts');
  gitG2('commit', '-q', '-m', 'hub at c1');
  const c1 = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: g2, encoding: 'utf8' }).trim();
  lcWrite(STATE, stateOf([{ id: 'D-001', status: 'superseded' }, { id: 'D-003', status: 'amended' }, { id: 'D-005', status: 'superseded' }]));
  gitG2('commit', '-qam', 'register moved on');
  const lcLedger = (slug, decisions, scope) => ledgerOf(slug, { requests: ['- 2026-09-20: resume with the register in view.'], open: [], decisions, scope });
  const lcHandoff = (name, slug, { verified = c1, pointer = ANCHORED } = {}) => {
    const file = join(hub, name, 'HANDOFF.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, handoffText({ program: ledgerPath(slug), request: 'resume with the register in view.', hop: 1 })
      .replace('Verified-at: abc1234 (main, clean).', `Verified-at: ${verified} (main, clean).`)
      .replace(/^- FINDINGS_REGISTER\.md:.*$/m, '- None in this fixture.')
      .replace(ANCHORED, pointer));
    return file;
  };
  const lcResume = (file) => inG2([co, 'handoff', 'resume', file, '--root', g2]);
  const promotions = ['D-001', 'D-003', 'D-005', 'D-002'].map((id, i) => decision(`DEC-${i + 1}`, 1, `promoted:${id}`));

  lcLedger('lc-reg', promotions);
  const reg = lcResume(lcHandoff('lc-reg-run', 'lc-reg'));
  check('resume reports a promoted id staged in intake as UNLANDED, a warning that keeps exit 0', reg.status === 0
    && /^warning: UNLANDED DEC-4 promoted:D-002: staged in intake/m.test(reg.stdout) && !/UNLANDED DEC-[123] /.test(reg.stdout));
  check('resume lists each promoted id superseded or amended since Verified-at as DRIFTED', /^DRIFTED DEC-1 promoted:D-001: now superseded/m.test(reg.stdout)
    && /^DRIFTED DEC-2 promoted:D-003: now amended/m.test(reg.stdout));
  check('resume reports no drift for an id already superseded at Verified-at or still in force', !/DRIFTED DEC-[34] /.test(reg.stdout));
  check('register drift does not fail resume', reg.status === 0 && reg.stdout.includes('consumed:'));
  const unknownSha = lcResume(lcHandoff('lc-reg-unknown', 'lc-reg', { verified: 'abc1234' }));
  check('resume reports no drift when the Verified-at sha is not a commit', unknownSha.status === 0 && !/DRIFTED DEC-/.test(unknownSha.stdout));
  lcLedger('lc-404', [decision('DEC-1', 1, 'promoted:D-404')]);
  const lost = lcResume(lcHandoff('lc-404-run', 'lc-404'));
  check('resume fails check 14 on an unresolved promoted id and still names it UNLANDED', lost.status === 1
    && /check 14: .*DEC-1 promoted:D-404/.test(lost.stdout) && /^warning: UNLANDED DEC-1 promoted:D-404: in neither state\.json nor intake/m.test(lost.stdout));

  // ---- overlap-warns-never-denies (design C6): resume warns on a scope document another live program lists ----
  const ovScope = ['docs/new-scope/spec.md', 'docs/new/plan-v2.md'];
  lcLedger('ov-a', [], ovScope);
  lcLedger('ov-b', [], [...ovScope, 'docs/only-b.md']);
  lcLedger('ov-c', [], ['docs/new/plan-v2.md']);
  const ovOpen = (sid, slug, name, program) => inG2([co, 'run', 'open', slug, '--name', name, '--session', sid, '--program', `80 Runs/programs/${program}/PROGRAM.md`, '--root', '.']);
  ovOpen('sess-ovb', 'ovb-run', 'Ovb HO 3', 'ov-b');
  const ovResume = () => inG2([co, 'handoff', 'resume', lcHandoff('lc-ova-run', 'ov-a'), '--root', g2, '--session', 'sess-ova']);
  const ovA = ovResume();
  const ovLines = ovA.stdout.trimEnd().split('\n');
  check('overlap-warns-never-denies: resume with a shared scope document warns, exits 0, and still consumes', ovA.status === 0 && ovA.stdout.includes('consumed:')
    && ovLines.includes('  warning: program ov-b (live head: Ovb HO 3) also lists docs/new-scope/spec.md'));
  check('resume prints one warning per shared path and one merge suggestion for a multi-path overlap',
    ovLines.filter((l) => l.startsWith('  warning: program ov-b')).length === 2 && ovLines.includes('  warning: program ov-b (live head: Ovb HO 3) also lists docs/new/plan-v2.md')
    && ovLines.includes('  suggest: 2 shared paths with ov-b; if they are one effort, run co program merge ov-a --into ov-b') && !ovA.stdout.includes('only-b.md'));
  const ovAt = ovLines.indexOf('program overlap:');
  check('resume puts the overlap block right before the links block and keeps the set title line last',
    ovAt > 0 && ovLines[ovAt + 4] === 'links:' && ovLines.lastIndexOf('links:') === ovAt + 4 && ovLines.at(-1).startsWith('set title: "'));
  ovOpen('sess-ovc', 'ovc-run', 'Ovc HO 1', 'ov-c');
  const ovCOut = inG2([co, 'handoff', 'resume', lcHandoff('lc-ovc-run', 'ov-c'), '--root', g2, '--session', 'sess-ovc-resume']).stdout;
  check('resume lists a single shared path without a merge suggestion, and never names its own program', ovCOut.includes('program overlap:') && !ovCOut.includes('suggest:')
    && ovCOut.includes('also lists docs/new/plan-v2.md') && !ovCOut.includes('program ov-c'));

  // Forwarding: the scope document moved by prefix, the pointer's file was renamed, so it would otherwise report GONE.
  const forwardingDoc = { version: 1, forwards: [
    { from: 'docs/old-scope', to: 'docs/new-scope', movedAt: '2026-09-28', reason: 'vault move' },
    { from: 'docs/old/plan.md', to: 'docs/new/plan-v2.md', movedAt: '2026-09-28', reason: 'renamed on move' }] };
  lcWrite(FORWARDING, `${JSON.stringify(forwardingDoc)}\n`);
  lcLedger('lc-fwd', [], ['docs/old-scope/spec.md']);
  const forwardedPointer = 'Pointer: docs/old/plan.md:1 · Anchor: `plan heading`';
  const fwdHandoff = lcHandoff('lc-fwd-run', 'lc-fwd', { pointer: forwardedPointer });
  writeFileSync(join(dirname(fwdHandoff), 'SCOPE_DIGESTS.md'), ['# Scope digests', '', '## `docs/old-scope/spec.md`', '',
    `Hash: sha256:${createHash('sha256').update('# spec\n').digest('hex')}`, 'Verified-at: abc1234', '', 'The spec, unchanged since the move.', ''].join('\n'));
  const fwd = lcResume(fwdHandoff);
  check('resume passes a forwarded scope document and a forwarded pointer', fwd.status === 0);
  check('resume warns MOVED for the forwarded scope document', /^warning: MOVED scope document docs\/old-scope\/spec\.md -> docs\/new-scope\/spec\.md$/m.test(fwd.stdout));
  check('resume digests and links the forwarded scope document at its new path', /unchanged docs\/old-scope\/spec\.md: read its digest/.test(fwd.stdout)
    && /scope document: \[docs\/old-scope\/spec\.md\]\(docs\/new-scope\/spec\.md\)/.test(fwd.stdout));
  check('resume reports the forwarded pointer as MOVED with its new path, not GONE', fwd.stdout.includes('anchors: MOVED 1')
    && /^ {3}MOVED docs\/old\/plan\.md:1 .*forwarded to docs\/new\/plan-v2\.md/m.test(fwd.stdout) && !/GONE/.test(fwd.stdout));
  lcWrite(FORWARDING, `${JSON.stringify({ version: 2, forwards: [] })}\n`);
  const badForwarding = lcResume(lcHandoff('lc-bad-run', 'lc-fwd', { pointer: forwardedPointer }));
  check('resume reports an invalid FORWARDING.json and does not consume', badForwarding.status === 1
    && /FORWARDING\.json is invalid/.test(badForwarding.stdout) && badForwarding.stdout.includes('not consumed'));
} finally {
  rmSync(g2, { recursive: true, force: true });
}

// ---- program overlap at run open (design C6): live programs on the presence board, warn only ----
const ov = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-overlap-')));
try {
  execFileSync('git', ['init', '-q'], { cwd: ov, stdio: 'ignore' });
  const ledger = (slug, scope, status = '') => {
    const file = join(ov, '80 Runs', 'programs', slug, 'PROGRAM.md');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, [`# PROGRAM: ${slug}`, '', '## Program goal', '', `Goal of ${slug}.`, ...(status ? [status] : []), '', '## Scope documents', '',
      ...scope.map((s) => `- \`${s}\` · Status: current · Role: fixture`), '', '## Open items', ''].join('\n'));
    return file;
  };
  const openOn = (sid, program, name = sid) => spawnSync(process.execPath, [co, 'run', 'open', sid, '--name', name, '--session', sid, '--program', `80 Runs/programs/${program}/PROGRAM.md`],
    { cwd: ov, encoding: 'utf8', env });
  const warned = (res) => res.stdout.split('\n').filter((l) => l.startsWith('  warning: ') || l.startsWith('  suggest: '));
  const boardFile = (sid) => join(home, '.claude', 'code-ops', 'board', repoIdentity(ov).key, `${sid}.json`);
  const patchBoard = (sid, change) => { const r = JSON.parse(readFileSync(boardFile(sid), 'utf8')); change(r); writeFileSync(boardFile(sid), JSON.stringify(r)); };
  ledger('beta', ['shared-one.md', 'shared-two.md', 'only-beta.md']);
  ledger('alpha', ['shared-one.md', 'shared-two.md', 'only-alpha.md']);
  ledger('gamma', ['shared-one.md', 'only-gamma.md']);
  ledger('delta', ['unrelated.md']);

  const first = openOn('sess-beta', 'beta', 'Beta HO 1');
  check('overlap: the first live program prints no overlap block', first.status === 0 && !first.stdout.includes('program overlap:') && first.stdout.split('\n')[1] === 'links:');
  const multi = openOn('sess-alpha', 'alpha', 'Alpha HO 1');
  const multiLines = multi.stdout.split('\n');
  check('overlap-warns-never-denies: run open warns per shared path, suggests a merge for two, and exits 0', multi.status === 0
    && JSON.stringify(warned(multi)) === JSON.stringify(['  warning: program beta (live head: Beta HO 1) also lists shared-one.md', '  warning: program beta (live head: Beta HO 1) also lists shared-two.md',
      '  suggest: 2 shared paths with beta; if they are one effort, run co program merge alpha --into beta']));
  check('run open puts the overlap block between the run folder line and the links block', multiLines[1] === 'program overlap:' && multiLines[5] === 'links:' && multiLines.length === 8 && multiLines[7] === '');
  const single = openOn('sess-gamma', 'gamma', 'Gamma HO 1');
  check('overlap: a single shared path warns once per program and suggests no merge', single.status === 0 && warned(single).length === 2
    && warned(single).every((l) => l.startsWith('  warning: ') && l.endsWith('also lists shared-one.md')) && !single.stdout.includes('suggest:'));
  const none = openOn('sess-delta', 'delta', 'Delta HO 1');
  check('overlap: no shared scope document prints nothing extra', none.status === 0 && !none.stdout.includes('program overlap:') && !none.stdout.includes('warning:'));
  const own = openOn('sess-alpha-2', 'alpha', 'Alpha HO 1b');
  check('overlap: another session of the same program is not an overlap', own.status === 0 && !own.stdout.includes('program alpha') && warned(own).some((l) => l.includes('program beta')));

  ledger('epsilon', ['only-beta.md']);
  check('overlap: a live peer warns before the idle and ended cases', warned(openOn('sess-eps-1', 'epsilon')).length === 1);
  patchBoard('sess-beta', (r) => { r.heartbeat = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); });
  check('overlap: an idle session (no heartbeat for 30 minutes) is ignored', !openOn('sess-eps-2', 'epsilon').stdout.includes('program beta'));
  patchBoard('sess-beta', (r) => { r.heartbeat = new Date().toISOString(); r.ended = new Date().toISOString(); });
  check('overlap: an ended session is ignored', !openOn('sess-eps-3', 'epsilon').stdout.includes('program beta'));
  patchBoard('sess-beta', (r) => { r.ended = null; });
  check('overlap: the same session warns again once it is live', warned(openOn('sess-eps-4', 'epsilon')).length === 1);

  ledger('zeta', ['zeta-only.md'], 'Status: merged into beta');
  openOn('sess-zeta', 'zeta');
  ledger('theta', ['zeta-only.md']);
  check('overlap: a program marked merged or closed is not compared', !openOn('sess-theta', 'theta').stdout.includes('program overlap:'));

  // Fail open: garbage records, an unresolvable run folder, a deleted ledger, and finally a board path that is a file.
  const boardDir = dirname(boardFile('x'));
  writeFileSync(join(boardDir, 'garbage.json'), '{{{ not json');
  writeFileSync(join(boardDir, 'strange.json'), JSON.stringify({ sessionId: 'strange', heartbeat: new Date().toISOString(), runDir: 5, name: { a: 1 } }));
  writeFileSync(join(boardDir, 'lost.json'), JSON.stringify({ sessionId: 'lost', heartbeat: new Date().toISOString(), runDir: '../../nowhere', worktree: '.' }));
  ledger('iota', ['shared-one.md']);
  openOn('sess-iota', 'iota');
  rmSync(join(ov, '80 Runs', 'programs', 'iota'), { recursive: true, force: true });
  ledger('kappa', ['shared-one.md']);
  const corrupt = openOn('sess-kappa', 'kappa');
  check('overlap-warns-never-denies: corrupt records and a missing ledger are skipped, valid peers still warn, exit 0', corrupt.status === 0
    && warned(corrupt).some((l) => l.includes('program alpha')) && !corrupt.stdout.includes('program iota') && !corrupt.stderr.includes('Error'));
  rmSync(boardDir, { recursive: true, force: true });
  writeFileSync(boardDir, 'not a directory');
  const noBoard = openOn('sess-lambda', 'kappa', 'Lambda HO 1');
  check('overlap: an unreadable board fails open with exit 0 and no overlap block', noBoard.status === 0 && !noBoard.stdout.includes('program overlap:') && noBoard.stdout.includes('links:'));

} finally {
  rmSync(ov, { recursive: true, force: true });
}

if (fails.length) { console.error(`\n${fails.length} assertion(s) failed`); process.exit(1); }
console.log('\nhandoff-state eval: all assertions pass');
