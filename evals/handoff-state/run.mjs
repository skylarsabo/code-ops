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
// no file resuming without them.
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
} finally {
  rmSync(g2, { recursive: true, force: true });
}

if (fails.length) { console.error(`\n${fails.length} assertion(s) failed`); process.exit(1); }
console.log('\nhandoff-state eval: all assertions pass');
