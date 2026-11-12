#!/usr/bin/env node
// Regression eval for the provider-neutral local judgment-eval planner and scorer.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { digestJson } from '../../scripts/context-index-lib.mjs';
import { tally, trimmed } from '../harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..', '..');
const SCRIPT = join(SOURCE, 'scripts', 'judgment-evals.mjs');
const { fails, check } = tally(trimmed(240));

function git(root, args) { return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', timeout: 15000 }).trim(); }
// The child bounds each of its own git and scorer calls, so this cap only guards against a hang.
// It sits far above the slowest loaded run, because a kill is not a verdict: a killed child
// fails the eval by name, and its null status can never satisfy a check that expects exit 0.
const CHILD_TIMEOUT_MS = 600000;
function run(args, root) {
  const started = Date.now();
  try { return { status: 0, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: CHILD_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }), stderr: '' }; }
  catch (error) {
    if (error.status === null || error.status === undefined) {
      const reason = `judgment-evals.mjs ${args[0]} was killed (${error.code || error.signal || 'no exit status'}) after ${Date.now() - started} ms`;
      check(`${args[0]} subprocess exits on its own`, false, reason);
      return { status: null, stdout: String(error.stdout || ''), stderr: `${String(error.stderr || '')}${reason}\n` };
    }
    return { status: error.status, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') };
  }
}

const root = mkdtempSync(join(tmpdir(), 'judgment-orchestration-'));
// A sibling of the throwaway repository, so stage destinations sit outside it.
const stageRoot = mkdtempSync(join(tmpdir(), 'judgment-stage-'));
let linkedParent = null;
try {
  for (const path of ['evals/score.mjs', 'evals/judgment-matrix.json', 'evals/bug-garden', 'evals/leak-lab', 'evals/drifted-docs', 'evals/hasty-code', 'evals/trap-garden', 'evals/calibration-traps', 'evals/xfn-traps', 'evals/scale-parquet', 'evals/scale-prolog', 'plugins/rigor/skills/bug-hunt/SKILL.md', 'plugins/privacy-opsec-suite/skills/metadata-leak-audit/SKILL.md', 'plugins/privacy-opsec-suite/skills/tor-egress-audit/SKILL.md', 'plugins/privacy-opsec-suite/skills/anon-session-audit/SKILL.md', 'plugins/code-ops-suite/skills/doc-alignment/SKILL.md', 'plugins/code-ops-suite/skills/normalize/SKILL.md']) {
    const from = join(SOURCE, path); const to = join(root, path);
    mkdirSync(dirname(to), { recursive: true }); cpSync(from, to, { recursive: true });
  }
  writeFileSync(join(root, '.gitignore'), 'run/\nevals/*/_run/\n');
  git(root, ['init', '-b', 'main']); git(root, ['config', 'user.email', 'eval@example.invalid']); git(root, ['config', 'user.name', 'Eval']);
  git(root, ['add', '.']); git(root, ['commit', '-m', 'fixture']);
  mkdirSync(join(root, 'Run'), { recursive: true });
  const trackedVictim = join(root, 'Run/Victim.md');
  const victimBytes = Buffer.from('tracked authority\n');
  writeFileSync(trackedVictim, victimBytes);
  git(root, ['add', '-f', 'Run/Victim.md']); git(root, ['commit', '-m', 'tracked mixed-case authority']);
  const trackedAliasPlan = run(['plan', '--root', root, '--mode', 'trend', '--execution', 'available',
    '--out', 'run/victim.md', '--strong-model', 'strong-model'], root);
  const trackedAliasPlanPreserved = readFileSync(trackedVictim).equals(victimBytes);
  check('plan output rejects a portable alias of a tracked path without mutation', trackedAliasPlan.status !== 0
    && trackedAliasPlan.stderr.includes('tracked Git path') && trackedAliasPlanPreserved, trackedAliasPlan.stderr);
  writeFileSync(trackedVictim, victimBytes);
  mkdirSync(join(root, 'run/trend'), { recursive: true });
  const planPath = 'run/trend/plan.json';
  const hiddenTarget = 'evals/bug-garden/repo/src/auth.js';
  for (const [flag, clearFlag, label] of [
    ['--skip-worktree', '--no-skip-worktree', 'skip-worktree'],
    ['--assume-unchanged', '--no-assume-unchanged', 'assume-unchanged'],
  ]) {
    git(root, ['update-index', flag, hiddenTarget]);
    writeFileSync(join(root, hiddenTarget), `hidden ${label} drift\n`);
    const hiddenPlan = run(['plan', '--root', root, '--mode', 'trend', '--execution', 'available',
      '--out', `run/${label}/plan.json`, '--strong-model', 'strong-model'], root);
    check(`${label} fixture state blocks judgment planning`, hiddenPlan.status !== 0 && hiddenPlan.stderr.includes('ambiguous Git index'), hiddenPlan.stderr);
    git(root, ['update-index', clearFlag, hiddenTarget]);
    git(root, ['checkout', '--', hiddenTarget]);
    rmSync(join(root, 'run', label), { recursive: true, force: true });
  }
  const planned = run(['plan', '--root', root, '--mode', 'trend', '--execution', 'available', '--out', planPath, '--strong-model', 'strong-model'], root);
  check('trend plan compiles from one canonical matrix', planned.status === 0, planned.stderr);
  const plan = JSON.parse(readFileSync(join(root, planPath), 'utf8'));
  const planBytes = readFileSync(join(root, planPath));
  const planAlias = join(root, 'run/plan-alias');
  symlinkSync(join(root, 'run/trend'), planAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedPlan = run(['plan', '--root', root, '--mode', 'trend', '--execution', 'available', '--out', 'run/plan-alias/plan.json', '--strong-model', 'strong-model'], root);
  const linkedPlanPreserved = readFileSync(join(root, planPath)).equals(planBytes);
  check('plan output rejects linked components without replacing existing authority', linkedPlan.status !== 0
    && linkedPlan.stderr.includes('symbolic-link components') && linkedPlanPreserved, linkedPlan.stderr);
  writeFileSync(join(root, planPath), planBytes);
  unlinkSync(planAlias);
  check('trend plan has one strong skill arm per fixture', plan.execution === 'available'
    && plan.units.length === 9 && plan.units.every((unit) => unit.tier === 'strong' && unit.arm === 'skill' && unit.rep === 1));
  check('worker units do not expose answer-key paths', plan.units.every((unit) => !Object.hasOwn(unit, 'answerKey')));
  const checked = run(['check-plan', '--root', root, '--plan', planPath], root);
  check('plan revalidates HEAD and all fixture inputs', checked.status === 0, checked.stderr);
  // No --root: the documented launch runs stage from the repository top.
  const stageDest = join(stageRoot, 'trend');
  const staged = run(['stage', '--plan', planPath, '--dest', stageDest], root);
  const stageManifestBytes = staged.status === 0 ? readFileSync(join(stageDest, 'STAGE.json')) : Buffer.alloc(0);
  const stageManifest = staged.status === 0 ? JSON.parse(stageManifestBytes.toString('utf8')) : null;
  const fixtureIds = [...new Set(plan.units.map((unit) => unit.fixture))];
  const fixtureOf = (id) => plan.matrix.fixtures.find((fixture) => fixture.id === id);
  check('stage copies one directory per planned fixture outside the repository', staged.status === 0
    && readdirSync(stageDest).sort().join(' ') === [...fixtureIds, 'STAGE.json'].sort().join(' ')
    && Object.keys(stageManifest).join(' ') === 'version planSha256 headSha fixtures'
    && stageManifest.version === 1 && stageManifest.planSha256 === plan.planSha256 && stageManifest.headSha === plan.headSha
    && stageManifest.fixtures.map((entry) => entry.id).join(' ') === fixtureIds.join(' ')
    && stageManifest.fixtures.every((entry) => Object.keys(entry).join(' ') === 'id path files treeSha256'
      && staged.stdout.includes(`${entry.id} -> ${entry.path}`)
      && entry.treeSha256 === fixtureOf(entry.id)?.targetTreeSha256
      && entry.files === git(root, ['ls-files', '--', fixtureOf(entry.id)?.target]).split('\n').filter(Boolean).length), staged.stderr);
  check('the stage manifest names no in-repository fixture path', staged.status === 0 && !stageManifestBytes.toString('utf8').includes('evals/'));
  check('a staged file is byte-equal to its tracked source', staged.status === 0
    && readFileSync(join(stageDest, 'bug-garden/src/auth.js')).equals(readFileSync(join(root, hiddenTarget))));
  check('no answer key reaches the staged copy', staged.status === 0 && existsSync(join(root, 'evals/bug-garden/ANSWER_KEY.json'))
    && !readdirSync(stageDest, { recursive: true }).some((name) => String(name).includes('ANSWER_KEY')));
  const insideStage = run(['stage', '--root', root, '--plan', planPath, '--dest', join(root, 'run/stage-in')], root);
  check('stage refuses a destination inside the repository', insideStage.status !== 0
    && insideStage.stderr.includes('outside the repository') && !existsSync(join(root, 'run/stage-in')), insideStage.stderr);
  const stageLink = join(stageRoot, 'link-in');
  symlinkSync(join(root, 'run'), stageLink, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedStage = run(['stage', '--root', root, '--plan', planPath, '--dest', join(stageLink, 'staged')], root);
  check('stage resolves a linked destination ancestor into the repository and refuses it', linkedStage.status !== 0
    && linkedStage.stderr.includes('outside the repository') && !existsSync(join(root, 'run/staged')), linkedStage.stderr);
  unlinkSync(stageLink);
  const stagedAuth = join(stageDest, 'bug-garden/src/auth.js');
  const stagedAuthBytes = existsSync(stagedAuth) ? readFileSync(stagedAuth) : null;
  const fullStage = run(['stage', '--root', root, '--plan', planPath, '--dest', stageDest], root);
  check('stage refuses a non-empty destination and leaves the earlier stage intact', fullStage.status !== 0 && fullStage.stderr.includes('must be empty')
    && staged.status === 0 && existsSync(join(stageDest, 'STAGE.json')) && readFileSync(join(stageDest, 'STAGE.json')).equals(stageManifestBytes)
    && existsSync(stagedAuth) && readFileSync(stagedAuth).equals(stagedAuthBytes), fullStage.stderr);
  const fileDest = join(stageRoot, 'plain-file');
  writeFileSync(fileDest, 'not a directory\n');
  const fileStage = run(['stage', '--root', root, '--plan', planPath, '--dest', fileDest], root);
  check('stage refuses a destination that is a file', fileStage.status !== 0 && fileStage.stderr.includes('an absent path or a plain directory')
    && readFileSync(fileDest, 'utf8') === 'not a directory\n', fileStage.stderr);
  // The link points at an empty directory outside the repository, so only the link rule refuses it.
  mkdirSync(join(stageRoot, 'link-target'));
  const linkDest = join(stageRoot, 'link-dest');
  symlinkSync(join(stageRoot, 'link-target'), linkDest, process.platform === 'win32' ? 'junction' : 'dir');
  const linkDestStage = run(['stage', '--root', root, '--plan', planPath, '--dest', linkDest], root);
  check('stage refuses a destination that is itself a link', linkDestStage.status !== 0
    && linkDestStage.stderr.includes('an absent path or a plain directory') && readdirSync(join(stageRoot, 'link-target')).length === 0, linkDestStage.stderr);
  unlinkSync(linkDest);

  // A replace ref changes what `cat-file` returns for one index blob, while the index, the tree
  // digest, and the clean check still see the planned blob. Only copy verification sees it.
  const lastFixture = fixtureOf(fixtureIds.at(-1));
  const replacedBlob = git(root, ['ls-files', '-s', '--', lastFixture.target]).split('\n')[0].split(' ')[1];
  const replacement = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: 'replaced blob\n', encoding: 'utf8', timeout: 15000 }).trim();
  git(root, ['replace', replacedBlob, replacement]);
  const replacedStage = run(['stage', '--root', root, '--plan', planPath, '--dest', join(stageRoot, 'replaced')], root);
  check('a blob that differs from its index entry fails copy verification and leaves no copy', replacedStage.status !== 0
    && replacedStage.stderr.includes('does not match the Git index') && !existsSync(join(stageRoot, 'replaced')), replacedStage.stderr);
  const emptyDest = join(stageRoot, 'empty');
  mkdirSync(emptyDest);
  const emptyStage = run(['stage', '--root', root, '--plan', planPath, '--dest', emptyDest], root);
  check('a failed stage into an existing empty directory leaves it existing and empty', emptyStage.status !== 0
    && emptyStage.stderr.includes('does not match the Git index') && existsSync(emptyDest) && readdirSync(emptyDest).length === 0, emptyStage.stderr);
  const nestedStage = run(['stage', '--root', root, '--plan', planPath, '--dest', join(stageRoot, 'absent', 'nested')], root);
  check('a failed stage removes every directory it created', nestedStage.status !== 0
    && nestedStage.stderr.includes('does not match the Git index') && !existsSync(join(stageRoot, 'absent')), nestedStage.stderr);
  git(root, ['replace', '-d', replacedBlob]);

  // Containment covers every checkout of the repository, not only the one `--root` names.
  linkedParent = mkdtempSync(join(tmpdir(), 'judgment-linked-'));
  const linked = join(linkedParent, 'wt');
  git(root, ['worktree', 'add', '--detach', linked]);
  const intoLinked = run(['stage', '--root', root, '--plan', planPath, '--dest', join(linked, 'run/stage-in')], root);
  check('stage refuses a destination inside a second worktree of the repository', intoLinked.status !== 0
    && intoLinked.stderr.includes('outside the repository') && !existsSync(join(linked, 'run/stage-in')), intoLinked.stderr);
  mkdirSync(join(linked, 'run/linked'), { recursive: true });
  const linkedPlanned = run(['plan', '--root', linked, '--mode', 'trend', '--execution', 'available', '--out', 'run/linked/plan.json', '--strong-model', 'strong-model'], linked);
  const fromLinked = run(['stage', '--root', linked, '--plan', 'run/linked/plan.json', '--dest', join(root, 'run/stage-main')], linked);
  check('stage from a linked worktree refuses a destination inside the main checkout', linkedPlanned.status === 0 && fromLinked.status !== 0
    && fromLinked.stderr.includes('outside the repository') && !existsSync(join(root, 'run/stage-main')), `${linkedPlanned.stderr}${fromLinked.stderr}`);
  git(root, ['worktree', 'remove', '--force', linked]);
  const forgedPlan = structuredClone(plan);
  forgedPlan.units[0].arm = 'control'; forgedPlan.units[0].skillDocs = [];
  const { planSha256: omitted, ...forgedBody } = forgedPlan;
  forgedPlan.planSha256 = digestJson(forgedBody);
  writeFileSync(join(root, planPath), `${JSON.stringify(forgedPlan, null, 2)}\n`);
  const forged = run(['check-plan', '--root', root, '--plan', planPath], root);
  check('self-digested hand edits cannot replace canonical matrix expansion', forged.status !== 0 && forged.stderr.includes('canonical matrix expansion'), forged.stderr);
  const forgedStage = run(['stage', '--root', root, '--plan', planPath, '--dest', join(stageRoot, 'forged')], root);
  check('stage refuses a self-digested hand-edited plan', forgedStage.status !== 0
    && forgedStage.stderr.includes('canonical matrix expansion') && !existsSync(join(stageRoot, 'forged')), forgedStage.stderr);
  writeFileSync(join(root, planPath), `${JSON.stringify(plan, null, 2)}\n`);
  for (const unit of plan.units) { mkdirSync(dirname(join(root, unit.findingsPath)), { recursive: true }); writeFileSync(join(root, unit.findingsPath), '[]\n'); }
  const aliasedOutput = run(['score', '--root', root, '--plan', planPath, '--out', 'run/trend/PLAN.json'], root);
  check('score output cannot case-alias and overwrite its plan', aliasedOutput.status !== 0
    && aliasedOutput.stderr.includes('must not overwrite')
    && JSON.parse(readFileSync(join(root, planPath), 'utf8')).planSha256 === plan.planSha256, aliasedOutput.stderr);
  const scoreAlias = join(root, 'run/score-alias');
  symlinkSync(join(root, 'run/trend'), scoreAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const linkedScore = run(['score', '--root', root, '--plan', planPath, '--out', 'run/score-alias/plan.json'], root);
  const linkedScorePreserved = readFileSync(join(root, planPath)).equals(planBytes);
  check('score output rejects linked components without replacing its plan', linkedScore.status !== 0
    && linkedScore.stderr.includes('symbolic-link components') && linkedScorePreserved, linkedScore.stderr);
  writeFileSync(join(root, planPath), planBytes);
  unlinkSync(scoreAlias);
  const hardlinkOutput = join(root, 'run/trend/scores-hardlink.json');
  linkSync(join(root, planPath), hardlinkOutput);
  const hardlinkedScore = run(['score', '--root', root, '--plan', planPath, '--out', 'run/trend/scores-hardlink.json'], root);
  check('score output rejects a physical alias without replacing its plan', hardlinkedScore.status !== 0
    && hardlinkedScore.stderr.includes('must not overwrite') && readFileSync(join(root, planPath)).equals(planBytes), hardlinkedScore.stderr);
  rmSync(hardlinkOutput, { force: true });
  const trackedAliasScore = run(['score', '--root', root, '--plan', planPath, '--out', 'run/victim.md'], root);
  const trackedAliasScorePreserved = readFileSync(trackedVictim).equals(victimBytes);
  check('score output rejects a portable alias of a tracked path without mutation', trackedAliasScore.status !== 0
    && trackedAliasScore.stderr.includes('tracked Git path') && trackedAliasScorePreserved, trackedAliasScore.stderr);
  writeFileSync(trackedVictim, victimBytes);
  const scored = run(['score', '--root', root, '--plan', planPath, '--out', 'run/trend/scores.json'], root);
  const receipt = scored.status === 0 ? JSON.parse(readFileSync(join(root, 'run/trend/scores.json'), 'utf8')) : null;
  check('scores every local result and writes a digest-bound receipt', scored.status === 0 && receipt.execution === 'available'
    && receipt.completedUnits === 9 && /^[0-9a-f]{64}$/.test(receipt.receiptSha256), scored.stderr);
  const receiptCheck = run(['check-receipt', '--root', root, '--plan', planPath, '--receipt', 'run/trend/scores.json'], root);
  check('receipt replay re-scores every bound candidate', receiptCheck.status === 0, receiptCheck.stderr);
  writeFileSync(join(root, plan.units[0].findingsPath), '[{"file":"forged.js","line":1}]\n');
  const receiptDrift = run(['check-receipt', '--root', root, '--plan', planPath, '--receipt', 'run/trend/scores.json'], root);
  check('candidate drift invalidates the score receipt', receiptDrift.status !== 0 && receiptDrift.stderr.includes('drifted after receipt'), receiptDrift.stderr);
  writeFileSync(join(root, plan.units[0].findingsPath), '[]\n');

  mkdirSync(join(root, 'run/floor'), { recursive: true });
  const floor = run(['plan', '--root', root, '--mode', 'floor', '--execution', 'unavailable', '--out', 'run/floor/plan.json', '--strong-model', 'strong-model', '--weak-model', 'weak-model'], root);
  const floorPlan = floor.status === 0 ? JSON.parse(readFileSync(join(root, 'run/floor/plan.json'), 'utf8')) : null;
  check('floor plan preserves the registered 2x2 repetition asymmetry', floor.status === 0 && floorPlan.units.length === 72
    && floorPlan.units.filter((unit) => unit.tier === 'strong').length === 18
    && floorPlan.units.filter((unit) => unit.tier === 'weak').length === 54, floor.stderr);
  const sameModel = run(['plan', '--root', root, '--mode', 'floor', '--execution', 'unavailable', '--out', 'run/floor/same-model.json', '--strong-model', 'same-model', '--weak-model', 'SAME-MODEL'], root);
  check('floor calibration refuses identical normalized model IDs', sameModel.status !== 0 && sameModel.stderr.includes('distinct strong and weak'), sameModel.stderr);

  // The register arm: one unit per model tier a fixture declares, same skill and same answer key,
  // so the only thing that varies between the two resulting registers is the tier.
  mkdirSync(join(root, 'run/register'), { recursive: true });
  const register = run(['plan', '--root', root, '--mode', 'register', '--execution', 'unavailable', '--out', 'run/register/plan.json', '--strong-model', 'strong-model', '--weak-model', 'weak-model'], root);
  const registerPlan = register.status === 0 ? JSON.parse(readFileSync(join(root, 'run/register/plan.json'), 'utf8')) : null;
  check('the register arm compiles one unit per declared tier against the same key', register.status === 0
    && registerPlan.units.length === 2
    && registerPlan.units.every((unit) => unit.fixture === 'bug-garden' && unit.arm === 'register' && unit.rep === 1 && unit.skillDocs.length === 1)
    && registerPlan.units.map((unit) => `${unit.tier}:${unit.model}`).join(' ') === 'strong:strong-model weak:weak-model', register.stderr);
  check('each register unit names its tier in the id the receipt scores by',
    registerPlan && registerPlan.units.map((unit) => unit.id).join(' ') === 'bug-garden-strong-register-r1 bug-garden-weak-register-r1',
    JSON.stringify(registerPlan?.units?.map((unit) => unit.id)));
  const registerCheck = run(['check-plan', '--root', root, '--plan', 'run/register/plan.json'], root);
  check('the register plan revalidates against the canonical matrix expansion', registerCheck.status === 0, registerCheck.stderr);
  const registerNoWeak = run(['plan', '--root', root, '--mode', 'register', '--execution', 'unavailable', '--out', 'run/register/no-weak.json', '--strong-model', 'strong-model'], root);
  check('the register arm refuses a single model tier', registerNoWeak.status !== 0 && registerNoWeak.stderr.includes('requires --weak-model'), registerNoWeak.stderr);

  writeFileSync(join(root, 'drift.txt'), 'new\n'); git(root, ['add', 'drift.txt']); git(root, ['commit', '-m', 'drift']);
  const drift = run(['check-plan', '--root', root, '--plan', planPath], root);
  check('new HEAD invalidates an old judgment plan', drift.status !== 0 && drift.stderr.includes('HEAD drift'), drift.stderr);
  const driftStage = run(['stage', '--root', root, '--plan', planPath, '--dest', join(stageRoot, 'drift')], root);
  check('stage refuses a plan from an old HEAD', driftStage.status !== 0
    && driftStage.stderr.includes('HEAD drift') && !existsSync(join(stageRoot, 'drift')), driftStage.stderr);

  // With autocrlf, adding a CRLF copy stores the same LF blob and refreshes the index stat, so the
  // status check passes. Stage copies the index blob, so the copy holds the committed LF bytes.
  mkdirSync(join(root, 'run/crlf'), { recursive: true });
  const crlfPlan = run(['plan', '--root', root, '--mode', 'trend', '--execution', 'available', '--out', 'run/crlf/plan.json', '--strong-model', 'strong-model'], root);
  const sourceBytes = readFileSync(join(root, hiddenTarget));
  const repoGit = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const committedBytes = execFileSync('git', ['cat-file', 'blob', `HEAD:${hiddenTarget}`], { cwd: root, timeout: 15000 });
  git(root, ['config', 'core.autocrlf', 'true']);
  writeFileSync(join(root, hiddenTarget), sourceBytes.toString('utf8').replace(/\n/g, '\r\n'));
  repoGit(['add', '--', hiddenTarget]);
  const crlfStatus = repoGit(['status', '--porcelain']);
  const crlfStage = run(['stage', '--root', root, '--plan', 'run/crlf/plan.json', '--dest', join(stageRoot, 'crlf')], root);
  const crlfCopy = join(stageRoot, 'crlf', 'bug-garden/src/auth.js');
  check('a converted checkout stages the committed bytes, not the working-tree bytes', crlfPlan.status === 0 && crlfStatus === ''
    && readFileSync(join(root, hiddenTarget)).includes('\r\n') && !committedBytes.includes('\r')
    && crlfStage.status === 0 && existsSync(crlfCopy) && readFileSync(crlfCopy).equals(committedBytes),
  `${crlfPlan.stderr}${crlfStatus}${crlfStage.stderr}`);
  writeFileSync(join(root, hiddenTarget), sourceBytes);
  repoGit(['add', '--', hiddenTarget]);
  git(root, ['config', '--unset', 'core.autocrlf']);

  // A bare repository's Git directory holds every blob, answer keys included, and sits outside
  // its worktrees. The worktree list marks it bare, so only the common-directory identity refuses it.
  const bare = join(stageRoot, 'bare.git');
  const bareTree = join(stageRoot, 'bare-tree');
  git(root, ['clone', '--bare', '--quiet', root, bare]);
  git(bare, ['worktree', 'add', '--detach', bareTree]);
  mkdirSync(join(bareTree, 'run/bare'), { recursive: true });
  const barePlanned = run(['plan', '--root', bareTree, '--mode', 'trend', '--execution', 'available', '--out', 'run/bare/plan.json', '--strong-model', 'strong-model'], bareTree);
  const bareStage = run(['stage', '--root', bareTree, '--plan', 'run/bare/plan.json', '--dest', join(bare, 'staged')], bareTree);
  check('stage refuses a destination inside a Git directory outside every worktree', barePlanned.status === 0 && bareStage.status !== 0
    && bareStage.stderr.includes('outside the repository') && !existsSync(join(bare, 'staged')), `${barePlanned.stderr}${bareStage.stderr}`);
} finally {
  rmSync(root, { recursive: true, force: true });
  rmSync(stageRoot, { recursive: true, force: true });
  if (linkedParent) rmSync(linkedParent, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} judgment-orchestration failure(s):`);
  for (const failure of fails) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\njudgment-orchestration eval: PASS');
