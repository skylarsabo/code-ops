#!/usr/bin/env node
// Regression eval for scripts/check-handoff.mjs, the structural floor under the handoff
// skill's write contract (plugins/code-ops-suite/skills/handoff/SKILL.md). Asserts a
// conformant fixture passes and each distinct, isolated defect fails closed with the expected
// violation text, never a different check tripping instead. It also pins the sections that answer
// the operator's five resume questions, the verbatim `Request:` line, the confidence label every
// Key findings bullet carries, and that `--consume` writes `HANDOFF.consumed` only on a pass.
// Check 9 cases pin the Program lineage: the ledger's shape and cap, scope documents on the
// tree, and that a predecessor's request and open-item ids carry forward.
//
//   node evals/handoff-check/run.mjs   (exit 0 = all assertions pass)

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const checker = join(REPO, 'scripts', 'check-handoff.mjs');

const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };
// Every run binds an explicit --root, because the L-062 pointer check resolves citations against
// a tree and a cwd-relative default would make these assertions depend on where CI invoked node.
const run = (args, root = REPO) => spawnSync('node', [checker, ...args, '--root', root], { encoding: 'utf8' });
const outOf = (r) => (r.stdout || '') + (r.stderr || '');

// A conformant Open items bullet, held in one place so every fixture below mutates a single
// piece of it and nothing else, isolating each check from the others.
const goodOpenItem = '- PAR-100 close-out: not started · Owner: agent · Done when: register item closed-with-proof · Pointer: path:line';

// The three sections the operator's five questions added, and the Goal section's verbatim
// `Request:` line, each held in one place so a case below swaps exactly one of them.
const BASE_GOAL = [
  '## Goal and state of play',
  '',
  'Request: exercise check-handoff.mjs against a conformant fixture.',
  '',
  '- Objective: exercise check-handoff.mjs. History: base..head (no exceptions).',
  '',
].join('\n');

const BASE_SECTIONS = {
  scope: '## Scope and constraints\n\n- Repository: this fixture. Branch: none. Out of scope: prose quality.\n\n',
  workCompleted: '## Work completed\n\n- base..head across scripts/check-handoff.mjs: fixture shape updated.\n\n',
  keyFindings: '## Key findings\n\n- CONFIRMED: the checker reads headings by prefix. Pointer: scripts/check-handoff.mjs:5\n\n',
  authority: '## Authority\n\n- No grants recorded in this fixture. None carries into a resumed session.\n\n',
  openItems: `## Open items\n\n${goodOpenItem}\n\n`,
  carriedContext: '## Carried context\n\n- Nothing carried; this fixture needs no analysis file.\n',
};

// Check 9: the durable program ledger. Its scope document and the Program path are absolute, so
// one ledger serves the REPO-rooted runs and the temp-rooted pointer and same-tree runs alike.
// Ledger fixtures take a `ledger-` prefix, because a case-insensitive filesystem would merge
// PROGRAM-x.md with a handoff named program-x.md.
const work = mkdtempSync(join(tmpdir(), 'coh-handoff-'));
const write = (name, text) => { const p = join(work, name); writeFileSync(p, text); return p; };
const BASE_REQUEST = 'exercise check-handoff.mjs against a conformant fixture.';
const PRIOR_REQUEST = 'start the check-handoff program with an earlier hop.';
function buildProgram({
  goal = 'Keep a handoff chain from losing program scope.',
  history = [`- 2026-09-22: ${PRIOR_REQUEST}`, `- 2026-09-23: ${BASE_REQUEST}`],
  scope = [`- \`${checker}\` · Status: current · Role: the checker under test`],
  closed = ['- OI-9 closed-with-proof abc1234 · Pointer: scripts/check-handoff.mjs'],
  filler = '',
} = {}) {
  return ['# PROGRAM: check-handoff eval', '', '## Program goal', '', goal, '', '## Request history', '', ...history, '',
    '## Scope documents', '', ...scope, '', '## Decisions ledger', '', '- 2026-09-22: a synthetic ledger stands in for a real one.', '',
    '## Closed items', '', ...closed, '', filler].join('\n');
}
const programAt = (name, opts) => write(name, buildProgram(opts));
const programSection = (programPath, predecessor = 'none') => `## Program\n\nProgram: ${programPath}\nPredecessor: ${predecessor}\n\n`;
const BASE_PROGRAM_SECTION = programSection(programAt('PROGRAM.md'));

// The one anchored pointer the base fixture carries. It names this checker's own second line, so
// the conformant case exercises the L-062 resolution against a file that really exists.
const BASE_POINTER = '- Nothing in flight. Pointer: scripts/check-handoff.mjs:2 · Anchor: `HANDOFF.md structural checker`';

// Builds a full, otherwise-conformant HANDOFF.md from the variable sections above, so a test
// case swaps in exactly one broken section and leaves every other check clean.
function buildHandoff({ program = BASE_PROGRAM_SECTION, goal = BASE_GOAL, scope = BASE_SECTIONS.scope, workCompleted = BASE_SECTIONS.workCompleted, keyFindings = BASE_SECTIONS.keyFindings, authority = BASE_SECTIONS.authority, openItems = BASE_SECTIONS.openItems, carriedContext = BASE_SECTIONS.carriedContext, inFlight = BASE_POINTER, filler = '' } = {}) {
  return [
    '# HANDOFF: check-handoff eval fixture',
    '',
    'Verified-at: abc1234 (main, clean).',
    '',
    program,
    goal,
    scope,
    workCompleted,
    keyFindings,
    '## Registers and artifacts',
    '',
    '- FINDINGS_REGISTER.md: fixture register, pointed at rather than re-pasted. Verified-at: abc1234.',
    '',
    '## Decisions made',
    '',
    '- Used a synthetic fixture instead of a real handoff, because a real one is private run scratch.',
    '',
    '## Traps and dead ends',
    '',
    '- None encountered in this fixture.',
    '',
    '## In-flight boundaries',
    '',
    inFlight,
    '',
    openItems,
    authority,
    carriedContext,
    filler,
  ].join('\n');
}

// === passing fixture ===
const good = write('good.md', buildHandoff());
const rGood = run([good]);
check('conformant fixture exits 0', rGood.status === 0);
check('conformant fixture reports OK', /^OK —/.test(rGood.stdout));

// === unfilled draft placeholder ===
const unfilled = write('unfilled.md', buildHandoff({ carriedContext: '## Carried context\n\n- [FILL: analyses the successor needs]\n' }));
const rUnfilled = run([unfilled]);
check('an unfilled [FILL: placeholder exits 1', rUnfilled.status === 1);
check('the placeholder violation is reported', /"\[FILL:" placeholder/.test(outOf(rUnfilled)));

// === missing Authority ===
const noAuthority = write('no-authority.md', buildHandoff({ authority: '' }));
const rNoAuthority = run([noAuthority]);
check('missing Authority section exits 1', rNoAuthority.status === 1);
check('missing Authority section names the heading', /missing required heading: "## Authority"/.test(outOf(rNoAuthority)));

// === Open items entry without Owner ===
const noOwnerItem = '- PAR-100 close-out: not started · Done when: register item closed-with-proof · Pointer: path:line';
const noOwner = write('no-owner.md', buildHandoff({ openItems: `## Open items\n\n${noOwnerItem}\n\n` }));
const rNoOwner = run([noOwner]);
check('Open items entry without Owner exits 1', rNoOwner.status === 1);
check('missing-Owner violation is reported', /missing "Owner: agent\|operator"/.test(outOf(rNoOwner)));
check('missing-Owner fixture does not also trip the imperative check', !/opens with an imperative verb/.test(outOf(rNoOwner)));

// === a noun-phrase label that shares a word with a verb stays conformant ===
const nounItem = '- Review receipts (OI-3): pending · Owner: operator · Done when: both receipts land · Pointer: path:line';
const rNoun = run([write('noun-item.md', buildHandoff({ openItems: `## Open items\n\n${nounItem}\n\n` }))]);
check('noun-phrase Open items label ("Review receipts") exits 0', rNoun.status === 0);

// === over the size cap ===
const overCap = write('over-cap.md', buildHandoff({ filler: `\n## Carried context filler\n\n${'x'.repeat(9000)}\n` }));
const rOverCap = run([overCap]);
check('over-cap fixture exits 1', rOverCap.status === 1);
check('over-cap violation names the byte cap', /over the 8192-byte cap/.test(outOf(rOverCap)));
check('the conformant fixture sits under the raised cap', /\(\d+ bytes\)/.test(rGood.stdout));

// === imperative-led Open items line ===
const imperativeItem = '- Fix PAR-100 next · Owner: agent · Done when: register item closed-with-proof · Pointer: path:line';
const imperative = write('imperative.md', buildHandoff({ openItems: `## Open items\n\n${imperativeItem}\n\n` }));
const rImperative = run([imperative]);
check('imperative-led Open items line exits 1', rImperative.status === 1);
check('imperative violation is reported', /opens with an imperative verb/.test(outOf(rImperative)));
check('imperative fixture still has Owner and Done when (isolates the one check)', !/missing "Owner|missing "Done when/.test(outOf(rImperative)));

// === the three sections the operator's five questions require ===
for (const [name, patch, heading] of [
  ['Scope and constraints', { scope: '' }, 'Scope and constraints'],
  ['Work completed', { workCompleted: '' }, 'Work completed'],
  ['Key findings', { keyFindings: '' }, 'Key findings'],
]) {
  const r = run([write(`no-${heading.replace(/\s+/g, '-').toLowerCase()}.md`, buildHandoff(patch))]);
  check(`missing ${name} section exits 1`, r.status === 1);
  check(`missing ${name} section names the heading`, new RegExp(`missing required heading: "## ${heading}"`).test(outOf(r)));
}

// === the verbatim Request: line inside Goal and state of play ===
const goalNoRequest = BASE_GOAL.replace(/^Request:.*$/m, 'The operator asked for a fixture.');
const rNoRequest = run([write('no-request.md', buildHandoff({ goal: goalNoRequest }))]);
check('a Goal section with no Request: line exits 1', rNoRequest.status === 1);
check('the missing-Request violation names the line', /no non-empty "Request:" line/.test(outOf(rNoRequest)));
const rEmptyRequest = run([write('empty-request.md', buildHandoff({ goal: BASE_GOAL.replace(/^Request:.*$/m, 'Request:') }))]);
check('an empty Request: line exits 1', rEmptyRequest.status === 1);
// A `Request:` written as a bullet is the same line for this check, so the write contract may
// format it either way.
const rBulletRequest = run([write('bullet-request.md', buildHandoff({ goal: BASE_GOAL.replace(/^Request:/m, '- Request:') }))]);
check('a bulleted Request: line still passes', rBulletRequest.status === 0);

// === Key findings carry a confidence label ===
const unlabelled = '## Key findings\n\n- The checker reads headings by prefix. Pointer: scripts/check-handoff.mjs:5\n\n';
const rUnlabelled = run([write('unlabelled-finding.md', buildHandoff({ keyFindings: unlabelled }))]);
check('a Key findings bullet with no confidence label exits 1', rUnlabelled.status === 1);
check('the unlabelled-finding violation names the labels', /carries no confidence label \(CONFIRMED\|PROBABLE\|SPECULATIVE\)/.test(outOf(rUnlabelled)));
for (const label of ['PROBABLE', 'SPECULATIVE', 'UNVERIFIED']) {
  const r = run([write(`finding-${label}.md`, buildHandoff({ keyFindings: `## Key findings\n\n- ${label}: one line of state. Pointer: scripts/check-handoff.mjs:5\n\n` }))]);
  check(`a ${label} finding passes`, r.status === 0);
}

// === --consume writes the marker, and only on a passing check ===
const consumeDir = mkdtempSync(join(tmpdir(), 'coh-consume-'));
const consumeGood = join(consumeDir, 'HANDOFF.md');
writeFileSync(consumeGood, buildHandoff());
const rConsume = run([consumeGood, '--consume']);
const marker = join(consumeDir, 'HANDOFF.consumed');
check('--consume on a passing check exits 0', rConsume.status === 0);
check('--consume writes HANDOFF.consumed beside the file', existsSync(marker));
check('the marker holds one ISO timestamp line', existsSync(marker)
  && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\n$/.test(readFileSync(marker, 'utf8')));

const failDir = mkdtempSync(join(tmpdir(), 'coh-consume-fail-'));
const consumeBad = join(failDir, 'HANDOFF.md');
writeFileSync(consumeBad, buildHandoff({ authority: '' }));
const rConsumeFail = run([consumeBad, '--consume']);
check('--consume on a failing check exits 1', rConsumeFail.status === 1);
check('--consume writes no marker when the check fails', !existsSync(join(failDir, 'HANDOFF.consumed')));
rmSync(consumeDir, { recursive: true, force: true });
rmSync(failDir, { recursive: true, force: true });

// === check 9: Program lineage ===
// Each failing case differs from a passing twin in the one piece named, so a different check
// tripping instead would show as the wrong violation text.
const expectFail = (name, file, re, root = REPO) => {
  const r = run([file], root);
  check(`${name} exits 1`, r.status === 1);
  check(`${name} names the violation`, re.test(outOf(r)));
};
const expectPass = (name, file) => {
  const r = run([file]);
  check(`${name} exits 0`, r.status === 0);
  if (r.status !== 0) console.error(outOf(r));
};

expectFail('a handoff with no Program section', write('no-program.md', buildHandoff({ program: '' })), /missing required heading: "## Program"/);
expectFail('a Program section with no Program line', write('no-program-line.md', buildHandoff({ program: '## Program\n\nPredecessor: none\n\n' })), /no non-empty "Program: <path>" line/);
expectFail('a Program section with no Predecessor line', write('no-predecessor-line.md', buildHandoff({ program: BASE_PROGRAM_SECTION.replace(/^Predecessor:.*$/m, '') })), /no "Predecessor: <path to prior HANDOFF.md \| none>" line/);
expectFail('a Program path that does not resolve', write('program-gone.md', buildHandoff({ program: programSection(join(work, 'no-such-PROGRAM.md')) })), /Program path does not resolve to a file/);
expectPass('a Program path relative to --root', write('program-relative.md', buildHandoff({ program: programSection(relative(REPO, join(work, 'PROGRAM.md')).split('\\').join('/')) })));

// Oversized ledger: 20 KB passes, proving its cap is not the handoff's 8 KB; 40 KB fails.
const filler = (n) => `## Notes\n\n${'x'.repeat(n)}\n`;
expectPass('a 20 KB PROGRAM.md under its own cap', write('program-20k.md', buildHandoff({ program: programSection(programAt('ledger-20k.md', { filler: filler(20 * 1024) })) })));
expectFail('an oversized PROGRAM.md', write('program-40k.md', buildHandoff({ program: programSection(programAt('ledger-40k.md', { filler: filler(40 * 1024) })) })), /PROGRAM\.md .* is \d+ bytes, over the 32768-byte cap/);

// Ledger shape: a missing section, an undated request, and a missing scope document.
const noClosed = buildProgram().replace(/## Closed items[\s\S]*$/, '');
expectFail('a PROGRAM.md with no Closed items section', write('program-no-closed.md', buildHandoff({ program: programSection(write('ledger-no-closed.md', noClosed)) })), /PROGRAM\.md .* missing required heading: "## Closed items"/);
expectFail('an undated Request history entry', write('program-undated.md', buildHandoff({ program: programSection(programAt('ledger-undated.md', { history: [`- ${BASE_REQUEST}`] })) })), /Request history entry has no leading YYYY-MM-DD date/);
expectFail('a Scope document missing from the tree', write('program-scope-gone.md', buildHandoff({ program: programSection(programAt('ledger-scope-gone.md', { scope: ['- `design/NO_SUCH_SPEC.md` · Status: draft · Role: the vanished spec'] })) })), /Scope document does not exist on the tree: design\/NO_SUCH_SPEC\.md/);
expectPass('a Scope document relative to --root', write('program-scope-rel.md', buildHandoff({ program: programSection(programAt('ledger-scope-rel.md', { scope: ['- `scripts/check-handoff.mjs` · Status: current · Role: the checker'] })) })));
expectFail('a handoff whose own Request is not in the ledger', write('program-own-request.md', buildHandoff({ program: programSection(programAt('ledger-own.md', { history: [`- 2026-09-22: ${PRIOR_REQUEST}`] })) })), /this handoff's Request: text is not in PROGRAM\.md "## Request history"/);
expectFail('an Open items bullet with no id', write('open-no-id.md', buildHandoff({ openItems: '## Open items\n\n- Close-out: not started · Owner: agent · Done when: register item closed · Pointer: path:line\n\n' })), /Open items entry carries no stable id token/);

// Predecessor carry-forward. The prior hop left OI-1 and OI-2 open. The passing successor keeps
// OI-1 open and closes OI-2 in the ledger.
const priorGoal = BASE_GOAL.replace(/^Request:.*$/m, `Request: ${PRIOR_REQUEST}`);
const priorOpen = [
  '## Open items', '',
  '- OI-1 ledger check: in progress · Owner: agent · Done when: eval passes · Pointer: path:line',
  '- OI-2 docs page: not started · Owner: agent · Done when: page lists Program · Pointer: path:line', '', ''].join('\n');
const prior = write('prior-HANDOFF.md', buildHandoff({ goal: priorGoal, openItems: priorOpen }));
const keptOpen = '## Open items\n\n- OI-1 ledger check: in progress · Owner: agent · Done when: eval passes · Pointer: path:line\n\n';
const closesTwo = programAt('ledger-lineage.md', { closed: ['- OI-2 closed-with-proof abc1234 · Pointer: docs page'] });
expectPass('a successor that carries OI-1 and closes OI-2', write('succ-good.md', buildHandoff({ program: programSection(closesTwo, prior), openItems: keptOpen })));
const dropsTwo = programAt('ledger-drops.md');
expectFail('a successor that silently drops OI-2', write('succ-drop.md', buildHandoff({ program: programSection(dropsTwo, prior), openItems: keptOpen })), /predecessor open item OI-2 was dropped/);
check('the dropped-item case names only the dropped id', !/open item OI-1 was dropped/.test(outOf(run([join(work, 'succ-drop.md')]))));
const forgetsPrior = programAt('ledger-forgets.md', { history: [`- 2026-09-23: ${BASE_REQUEST}`], closed: ['- OI-2 closed-with-proof abc1234 · Pointer: docs page'] });
expectFail('a ledger missing the predecessor request', write('succ-no-prior-request.md', buildHandoff({ program: programSection(forgetsPrior, prior), openItems: keptOpen })), /the predecessor's Request: text is not in PROGRAM\.md "## Request history"/);
expectFail('a Predecessor path that does not resolve', write('succ-pred-gone.md', buildHandoff({ program: programSection(closesTwo, join(work, 'no-such-HANDOFF.md')), openItems: keptOpen })), /Predecessor path does not resolve to a file/);

// === usage errors ===
const rNoArgs = run([]);
check('no argument exits 2', rNoArgs.status === 2);
const rMissingFile = run([join(work, 'does-not-exist.md')]);
check('missing file exits 2', rMissingFile.status === 2);

// === L-062: anchored pointers resolve against the working tree ===
// Shape alone proved nothing about a pointer. These four fixtures share one target file, so each
// case differs from the passing one in exactly the pointer it carries.
writeFileSync(join(work, 'target.mjs'), 'const first = 1;\nconst guard = clamp(size, MAX);\nconst third = 3;\n');
const pointed = (pointer) => write(`ptr-${Buffer.from(pointer).toString('hex').slice(0, 12)}.md`, buildHandoff({ inFlight: `- Nothing in flight. Pointer: ${pointer}` }));
const anchored = (cite, anchor) => pointed(`${cite} · Anchor: \`${anchor}\``);

const rExact = run([anchored('target.mjs:2', 'clamp(size, MAX)')], work);
check('a pointer whose anchor sits on the cited line exits 0', rExact.status === 0);
check('the resolving pointer reports FRESH', /FRESH\s+target\.mjs:2/.test(outOf(rExact)));

const offByOne = anchored('target.mjs:3', 'clamp(size, MAX)');
const rMoved = run([offByOne], work);
check('an off-by-one pointer reports MOVED', /MOVED\s+target\.mjs:3.*anchor now on line 2/.test(outOf(rMoved)));
check('a MOVED pointer is a warning by default (exit 0)', rMoved.status === 0);
const rMovedStrict = run([offByOne, '--strict-anchors'], work);
check('a MOVED pointer fails under --strict-anchors', rMovedStrict.status === 1);
check('the --strict-anchors failure names the pointer', /pointer MOVED: target\.mjs:3/.test(outOf(rMovedStrict)));

const rDrifted = run([anchored('target.mjs:2', 'no such guard')], work);
check('an anchor absent from the file reports DRIFTED', /DRIFTED\s+target\.mjs:2/.test(outOf(rDrifted)));
check('a DRIFTED pointer fails closed', rDrifted.status === 1);

const rGone = run([anchored('vanished.mjs:2', 'clamp(size, MAX)')], work);
check('a pointer into a missing file reports GONE', /GONE\s+vanished\.mjs:2/.test(outOf(rGone)));
check('a GONE pointer fails closed', rGone.status === 1);

// A doubled-backtick anchor (L-059) carries a backtick of its own and still resolves.
writeFileSync(join(work, 'tick.mjs'), 'const label = `${name} shard`;\n');
const rTick = run([pointed('tick.mjs:1 · Anchor: ``const label = `${name} shard`;``')], work);
check('a doubled-backtick anchor containing a backtick resolves FRESH', rTick.status === 0 && /FRESH\s+tick\.mjs:1/.test(outOf(rTick)));

// The Verified-at advisory never gates. It needs a git root, so it is asserted on the
// repository-rooted conformant run, whose fixture sha is not this repository's HEAD.
check('a stale Verified-at sha is an advisory, not a violation', rGood.status === 0 && /advisory: Verified-at abc1234/.test(outOf(rGood)));
check('a stale Verified-at sha never reports same-tree', !/same-tree:/.test(outOf(rGood)));

// === same-tree: Verified-at equals HEAD on a clean tree ===
// A throwaway repository pins HEAD. The handoff file sits untracked inside it, and a gitignored
// scratch file sits beside it; neither may count as a dirty tree.
const tree = mkdtempSync(join(tmpdir(), 'coh-same-tree-'));
const gitIn = (...args) => spawnSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: tree, encoding: 'utf8' });
writeFileSync(join(tree, 'target.mjs'), 'const guard = clamp(size, MAX);\n');
writeFileSync(join(tree, '.gitignore'), 'scratch/\n');
gitIn('init', '-q'); gitIn('add', '-A'); gitIn('commit', '-q', '-m', 'fixture');
const treeHead = gitIn('rev-parse', '--short', 'HEAD').stdout.trim();
const treeHandoff = join(tree, 'HANDOFF.md');
const stampHandoff = (sha) => writeFileSync(treeHandoff, buildHandoff({ inFlight: '- Nothing in flight. Pointer: target.mjs:1 · Anchor: `clamp(size, MAX)`' }).replace('Verified-at: abc1234 (main, clean).', `Verified-at: ${sha} (main, clean).`));
stampHandoff(treeHead);
mkdirSync(join(tree, 'scratch')); writeFileSync(join(tree, 'scratch', 'run.md'), 'x');
const rSame = run([treeHandoff], tree);
check('Verified-at at HEAD on a clean tree reports same-tree', rSame.status === 0 && /same-tree: Verified-at matches HEAD on a clean tree/.test(outOf(rSame)));
check('the same-tree status prints on stderr, never stdout', !/same-tree:/.test(rSame.stdout || ''));
writeFileSync(join(tree, 'target.mjs'), 'const guard = clamp(size, MAX);\nconst edited = true;\n');
const rDirty = run([treeHandoff], tree);
check('a dirty tracked file suppresses same-tree', rDirty.status === 0 && !/same-tree:/.test(outOf(rDirty)));
gitIn('checkout', '-q', '--', 'target.mjs');
writeFileSync(join(tree, 'untracked.txt'), 'new\n');
const rUntracked = run([treeHandoff], tree);
check('an untracked non-handoff file suppresses same-tree', rUntracked.status === 0 && !/same-tree:/.test(outOf(rUntracked)));
rmSync(join(tree, 'untracked.txt'));
stampHandoff('abc1234');
const rStaleTree = run([treeHandoff], tree);
check('a clean tree with a stale Verified-at reports no same-tree', rStaleTree.status === 0 && !/same-tree:/.test(outOf(rStaleTree)) && /advisory: Verified-at abc1234/.test(outOf(rStaleTree)));
rmSync(tree, { recursive: true, force: true });

rmSync(work, { recursive: true, force: true });

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\nhandoff-check eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nhandoff-check eval passed');
