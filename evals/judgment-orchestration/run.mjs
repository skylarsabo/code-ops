#!/usr/bin/env node
// Regression eval for the provider-neutral local judgment-eval planner and scorer.

import { execFileSync } from 'node:child_process';
import { cpSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { digestJson } from '../../scripts/context-index-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '..', '..');
const SCRIPT = join(SOURCE, 'scripts', 'judgment-evals.mjs');
const fails = [];

function check(name, condition, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`);
}
function git(root, args) { return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8', timeout: 15000 }).trim(); }
function run(args, root) {
  try { return { status: 0, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 }), stderr: '' }; }
  catch (error) { return { status: error.status ?? 1, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') }; }
}

const root = mkdtempSync(join(tmpdir(), 'judgment-orchestration-'));
try {
  for (const path of ['evals/score.mjs', 'evals/judgment-matrix.json', 'evals/bug-garden', 'evals/leak-lab', 'evals/drifted-docs', 'evals/hasty-code', 'evals/trap-garden', 'evals/calibration-traps', 'evals/xfn-traps', 'plugins/rigor/skills/bug-hunt/SKILL.md', 'plugins/privacy-opsec-suite/skills/metadata-leak-audit/SKILL.md', 'plugins/privacy-opsec-suite/skills/tor-egress-audit/SKILL.md', 'plugins/privacy-opsec-suite/skills/anon-session-audit/SKILL.md', 'plugins/code-ops-suite/skills/doc-alignment/SKILL.md', 'plugins/code-ops-suite/skills/normalize/SKILL.md']) {
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
    && plan.units.length === 7 && plan.units.every((unit) => unit.tier === 'strong' && unit.arm === 'skill' && unit.rep === 1));
  check('worker units do not expose answer-key paths', plan.units.every((unit) => !Object.hasOwn(unit, 'answerKey')));
  const checked = run(['check-plan', '--root', root, '--plan', planPath], root);
  check('plan revalidates HEAD and all fixture inputs', checked.status === 0, checked.stderr);
  const forgedPlan = structuredClone(plan);
  forgedPlan.units[0].arm = 'control'; forgedPlan.units[0].skillDocs = [];
  const { planSha256: omitted, ...forgedBody } = forgedPlan;
  forgedPlan.planSha256 = digestJson(forgedBody);
  writeFileSync(join(root, planPath), `${JSON.stringify(forgedPlan, null, 2)}\n`);
  const forged = run(['check-plan', '--root', root, '--plan', planPath], root);
  check('self-digested hand edits cannot replace canonical matrix expansion', forged.status !== 0 && forged.stderr.includes('canonical matrix expansion'), forged.stderr);
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
    && receipt.completedUnits === 7 && /^[0-9a-f]{64}$/.test(receipt.receiptSha256), scored.stderr);
  const receiptCheck = run(['check-receipt', '--root', root, '--plan', planPath, '--receipt', 'run/trend/scores.json'], root);
  check('receipt replay re-scores every bound candidate', receiptCheck.status === 0, receiptCheck.stderr);
  writeFileSync(join(root, plan.units[0].findingsPath), '[{"file":"forged.js","line":1}]\n');
  const receiptDrift = run(['check-receipt', '--root', root, '--plan', planPath, '--receipt', 'run/trend/scores.json'], root);
  check('candidate drift invalidates the score receipt', receiptDrift.status !== 0 && receiptDrift.stderr.includes('drifted after receipt'), receiptDrift.stderr);
  writeFileSync(join(root, plan.units[0].findingsPath), '[]\n');

  mkdirSync(join(root, 'run/floor'), { recursive: true });
  const floor = run(['plan', '--root', root, '--mode', 'floor', '--execution', 'unavailable', '--out', 'run/floor/plan.json', '--strong-model', 'strong-model', '--weak-model', 'weak-model'], root);
  const floorPlan = floor.status === 0 ? JSON.parse(readFileSync(join(root, 'run/floor/plan.json'), 'utf8')) : null;
  check('floor plan preserves the registered 2x2 repetition asymmetry', floor.status === 0 && floorPlan.units.length === 56
    && floorPlan.units.filter((unit) => unit.tier === 'strong').length === 14
    && floorPlan.units.filter((unit) => unit.tier === 'weak').length === 42, floor.stderr);
  const sameModel = run(['plan', '--root', root, '--mode', 'floor', '--execution', 'unavailable', '--out', 'run/floor/same-model.json', '--strong-model', 'same-model', '--weak-model', 'SAME-MODEL'], root);
  check('floor calibration refuses identical normalized model IDs', sameModel.status !== 0 && sameModel.stderr.includes('distinct strong and weak'), sameModel.stderr);

  writeFileSync(join(root, 'drift.txt'), 'new\n'); git(root, ['add', 'drift.txt']); git(root, ['commit', '-m', 'drift']);
  const drift = run(['check-plan', '--root', root, '--plan', planPath], root);
  check('new HEAD invalidates an old judgment plan', drift.status !== 0 && drift.stderr.includes('HEAD drift'), drift.stderr);
} finally { rmSync(root, { recursive: true, force: true }); }

if (fails.length) {
  console.error(`\n${fails.length} judgment-orchestration failure(s):`);
  for (const failure of fails) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\njudgment-orchestration eval: PASS');
