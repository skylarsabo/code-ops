#!/usr/bin/env node
// Regression eval for program convergence (DEC-74), check 19 of scripts/check-handoff.mjs and the
// resume summary of scripts/handoff-state.mjs. A PROGRAM.md "## Finish line" section opts in: then
// "## Open items" holds at most 12 bullets, each carrying `Blocks: F<n>` that names a Finish line
// id. A predecessor item moved to BACKLOG.md passes as `deferred`. Without a Finish line, more than
// 12 open items only warns. The check prints a burn-down line, resume repeats it before
// "Blocked on operator:", and resume lists open items whose line is unchanged across five hops.
// Draft carries a Blocks field through unchanged.
//
//   node evals/handoff-convergence/run.mjs   (exit 0 = all assertions pass)

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const checker = join(REPO, 'scripts', 'check-handoff.mjs');
const state = join(REPO, 'scripts', 'handoff-state.mjs');

const { fails, check } = tally();
const tmp = mkdtempSync(join(tmpdir(), 'handoff-convergence-'));
const home = mkdtempSync(join(tmpdir(), 'handoff-convergence-home-'));
// A scrubbed environment: no host session id leaks in, and session records land in the temp home.
const env = { ...process.env, CODE_OPS_HOME: home };
delete env.CLAUDE_CODE_SESSION_ID;
delete env.CODEX_SESSION_ID;
const node = (args) => spawnSync(process.execPath, args, { cwd: tmp, encoding: 'utf8', env });
const verify = (handoff) => node([checker, handoff, '--root', tmp]);
const outOf = (r) => (r.stdout || '') + (r.stderr || '');

const REQUEST = 'converge the program.';
const item = (n, blocks = 'F1', extra = '') => `- OI-${n} fixture item ${n}${extra}: open · Owner: agent · Done when: the item lands${blocks ? ` · Blocks: ${blocks}` : ''}`;

// One program ledger per case, because BACKLOG.md sits beside the ledger it belongs to.
function programAt(slug, { finish = ['- F1 the first finish line item', '- F2 the second finish line item'], backlog = null, closed = [] } = {}) {
  const dir = join(tmp, 'programs', slug);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'PROGRAM.md');
  writeFileSync(file, ['# PROGRAM: convergence fixture', '', '## Program goal', '', 'Keep open items converging on a finish line.', '',
    '## Request history', '', `- 2026-09-30: ${REQUEST}`, '', '## Scope documents', '', '## Decisions ledger', '', '- 2026-09-30: a synthetic ledger stands in for a real one.', '',
    '## Closed items', '', ...closed, '', ...(finish ? ['## Finish line', '', ...finish, ''] : [])].join('\n'));
  if (backlog) writeFileSync(join(dir, 'BACKLOG.md'), `# Backlog\n\n${backlog.join('\n')}\n`);
  return file;
}

function handoffAt(name, { program, predecessor = 'none', hop = 1, items }) {
  const dir = join(tmp, 'runs', name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'HANDOFF.md');
  writeFileSync(file, ['# HANDOFF: convergence fixture', '', 'Verified-at: abc1234 (main, clean)', '',
    '## Program', '', `Program: ${program}`, `Predecessor: ${predecessor}`, `Session: Conv HO ${hop}`, `Hop: ${hop}`, '',
    '## Goal and state of play', '', `Request: ${REQUEST}`, '',
    '## Scope and constraints', '', '- Repository: this fixture. Branch: none. Out of scope: prose quality.', '',
    '## Work completed', '', '- Nothing beyond the fixture.', '',
    '## Key findings', '', '- CONFIRMED: the fixture is synthetic.', '',
    '## Registers and artifacts', '', '- None in this fixture.', '',
    '## Decisions made', '', '- None in this fixture.', '',
    '## Traps and dead ends', '', '- None in this fixture.', '',
    '## In-flight boundaries', '', '- Nothing in flight.', '',
    '## Open items', '', ...items, '',
    '## Authority', '', '- No grants recorded in this fixture. None carries into a resumed session.', '',
    '## Carried context', '', '- Nothing carried.', ''].join('\n'));
  return file;
}
const range = (n, blocks) => Array.from({ length: n }, (_, i) => item(i + 1, blocks));

try {
  const git = (...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], { cwd: tmp, stdio: 'ignore' });
  git('init', '-q');
  writeFileSync(join(tmp, 'README.md'), 'fixture\n');
  git('add', 'README.md');
  git('commit', '-q', '-m', 'base');

  // ---- finish line: pass and the three failures ----
  const pass = verify(handoffAt('fin-pass', { program: programAt('fin-pass'), items: [item(1, 'F1'), item(2, 'F2'), item(3, 'F1, F2')] }));
  check('finish line: items that name Finish line ids pass', pass.status === 0 && /^OK —/m.test(pass.stdout));
  if (pass.status !== 0) console.error(outOf(pass));

  const over = verify(handoffAt('fin-13', { program: programAt('fin-13'), items: range(13, 'F1') }));
  check('finish line: 13 open items fail and name the backlog path',
    over.status === 1 && /check 19: 13 open items exceed the cap of 12; move the rest to programs\/fin-13\/BACKLOG\.md/.test(outOf(over)));
  const atCap = verify(handoffAt('fin-12', { program: programAt('fin-12'), items: range(12, 'F1') }));
  check('finish line: exactly 12 open items pass', atCap.status === 0);

  const noBlocks = verify(handoffAt('fin-no-blocks', { program: programAt('fin-no-blocks'), items: [item(1, 'F1'), item(2, null)] }));
  check('finish line: an open item without Blocks fails by id', noBlocks.status === 1
    && /check 19: open item lacks "Blocks: F<n>".*OI-2/.test(outOf(noBlocks)) && !/lacks "Blocks: F<n>".*OI-1 /.test(outOf(noBlocks)));

  const unknown = verify(handoffAt('fin-unknown', { program: programAt('fin-unknown'), items: [item(1, 'F1'), item(2, 'F9')] }));
  check('finish line: a Blocks id absent from the Finish line fails', unknown.status === 1
    && /check 19: open item Blocks: F9 is not in PROGRAM\.md "## Finish line".*OI-2/.test(outOf(unknown)));

  const emptyFinish = verify(handoffAt('fin-empty', { program: programAt('fin-empty', { finish: ['(none yet)'] }), items: [item(1, 'F1')] }));
  check('finish line: a section with no F bullet fails', emptyFinish.status === 1 && /"## Finish line" holds no "- F<n> \.\.\." bullet/.test(outOf(emptyFinish)));

  // ---- no finish line: the old behavior, plus a warning past the cap ----
  const legacy = verify(handoffAt('legacy-13', { program: programAt('legacy-13', { finish: null }), items: range(13, null) }));
  check('no finish line: 13 open items pass with a warning', legacy.status === 0
    && /^ {2}warning: check 19: 13 open items exceed the cap of 12; move the rest to programs\/legacy-13\/BACKLOG\.md$/m.test(legacy.stderr));
  const legacyOk = verify(handoffAt('legacy-2', { program: programAt('legacy-2', { finish: null }), items: range(2, null) }));
  check('no finish line: two open items pass with no check 19 message', legacyOk.status === 0 && !outOf(legacyOk).includes('check 19'));

  // ---- backlog: a predecessor item moved to BACKLOG.md passes as deferred ----
  const priorOf = (slug, program, items) => handoffAt(`${slug}-prior`, { program, hop: 1, items });
  const deferredProgram = programAt('deferred', { backlog: ['- OI-2 fixture item 2: deferred past the finish line'] });
  const deferredPrior = priorOf('deferred', deferredProgram, [item(1), item(2)]);
  const deferred = verify(handoffAt('deferred', { program: deferredProgram, predecessor: deferredPrior, hop: 2, items: [item(1)] }));
  check('backlog: a predecessor item now in BACKLOG.md passes and is reported deferred', deferred.status === 0
    && /^ {2}deferred: OI-2 \(moved to BACKLOG\.md\)$/m.test(deferred.stderr));
  const lostProgram = programAt('lost');
  const lost = verify(handoffAt('lost', { program: lostProgram, predecessor: priorOf('lost', lostProgram, [item(1), item(2)]), hop: 2, items: [item(1)] }));
  check('backlog: the same item absent from BACKLOG.md still fails as dropped', lost.status === 1 && /predecessor open item OI-2 was dropped/.test(outOf(lost)));

  // ---- burn-down: the check prints it, and GROWING flags an open set that grew ----
  const growProgram = programAt('grow');
  const grow = verify(handoffAt('grow', { program: growProgram, predecessor: priorOf('grow', growProgram, [item(1), item(2)]), hop: 2, items: [item(1), item(2), item(3)] }));
  check('burn-down: a grown open set prints counts and GROWING', grow.status === 0
    && /^ {2}burn-down: active 3 \(predecessor 2, \+1 -0\), backlog 0 GROWING$/m.test(grow.stderr));
  const shrinkProgram = programAt('shrink', { closed: ['- OI-3 closed-with-proof abc1234'], backlog: ['- OI-4 fixture item 4: deferred'] });
  const shrink = verify(handoffAt('shrink', { program: shrinkProgram, predecessor: priorOf('shrink', shrinkProgram, [item(1), item(2), item(3), item(4)]), hop: 2, items: [item(1), item(2)] }));
  check('burn-down: a shrunk open set prints counts, the backlog size, and no flag', shrink.status === 0
    && /^ {2}burn-down: active 2 \(predecessor 4, \+0 -2\), backlog 1$/m.test(shrink.stderr));

  const resumeGrow = node([state, 'resume', join(tmp, 'runs', 'grow', 'HANDOFF.md'), '--root', tmp]);
  const burn = resumeGrow.stdout.indexOf('burn-down: active 3 (predecessor 2, +1 -0), backlog 0 GROWING');
  check('resume prints the burn-down line before "Blocked on operator:"', resumeGrow.status === 0 && burn >= 0 && burn < resumeGrow.stdout.indexOf('Blocked on operator:'));
  if (resumeGrow.status !== 0) console.error(outOf(resumeGrow));

  // ---- demotion candidates: five chained handoffs ----
  // OI-1 keeps the same line on every hop, OI-2 changes on each hop, and OI-3 joins only on hop 5.
  const chainProgram = programAt('chain');
  const chain = [];
  for (let hop = 1; hop <= 5; hop++) {
    chain.push(handoffAt(`chain-${hop}`, {
      program: chainProgram, hop, predecessor: hop === 1 ? 'none' : chain[hop - 2],
      items: [item(1), item(2, 'F1', ` revision ${hop}`), ...(hop === 5 ? [item(3)] : [])],
    }));
  }
  const fiveHop = node([state, 'resume', chain[4], '--root', tmp]);
  check('resume lists open items unchanged across five hops', fiveHop.status === 0 && /^unchanged 5\+ hops: OI-1$/m.test(fiveHop.stdout));
  if (fiveHop.status !== 0) console.error(outOf(fiveHop));
  const fourHop = node([state, 'resume', chain[3], '--root', tmp]);
  check('resume prints no unchanged line with fewer than five hops', fourHop.status === 0 && !fourHop.stdout.includes('unchanged 5+'));

  const cutProgram = programAt('cut');
  const cut = [];
  for (let hop = 1; hop <= 5; hop++) {
    cut.push(handoffAt(`cut-${hop}`, { program: cutProgram, hop, predecessor: hop === 1 ? 'none' : cut[hop - 2], items: [item(1)] }));
  }
  rmSync(join(tmp, 'runs', 'cut-3'), { recursive: true });
  const cutResume = node([state, 'resume', cut[4], '--root', tmp]);
  check('resume ends the walk quietly at a missing predecessor file', cutResume.status === 0 && !cutResume.stdout.includes('unchanged 5+'));

  // ---- draft carries Blocks through unchanged ----
  const draftRun = join(tmp, 'runs', 'draft');
  mkdirSync(draftRun, { recursive: true });
  const blocked = '- [ ] OI-7 fixture item 7: open · Owner: agent · Done when: the item lands · Blocks: F1, F2';
  writeFileSync(join(draftRun, 'TASKS.md'), `# Tasks\n\n${blocked}\n`);
  const draft = node([state, 'draft', '--run', 'runs/draft', '--root', tmp]);
  check('draft carries a Blocks field through unchanged', draft.status === 0 && draft.stdout.includes(`${blocked}\n`));
  if (draft.status !== 0) console.error(outOf(draft));
} finally {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\nhandoff-convergence eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nhandoff-convergence eval passed');
