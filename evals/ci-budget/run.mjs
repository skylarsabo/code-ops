#!/usr/bin/env node
// Regression eval for scripts/ci-budget.mjs.
//
//   node evals/ci-budget/run.mjs   (exit 0 = pass)
//
// The script reads the real .github/ci-budgets.json, so the compare fixtures name a job and a
// step from that file and read their budgets from it. Each fixture is a gh api jobs payload.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally, withDetail } from '../harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const SCRIPT = resolve(ROOT, 'scripts', 'ci-budget.mjs');
const BUDGETS = JSON.parse(readFileSync(resolve(ROOT, '.github', 'ci-budgets.json'), 'utf8'));

const JOB = 'structural-lint-windows-shard-1';
const STEP = 'Run actions/checkout';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const wallBudget = BUDGETS.platforms.windows[JOB].wallSeconds.budgetSeconds;
const stepBudget = BUDGETS.platforms.windows[JOB].steps[STEP].budgetSeconds;

const START = Date.parse('2026-10-01T00:00:00Z');
const at = (seconds) => new Date(START + seconds * 1000).toISOString();
const timed = (seconds, fields) => ({ started_at: at(0), completed_at: at(seconds), conclusion: 'success', ...fields });
const payload = (...jobs) => JSON.stringify({ jobs });

const { fails, check } = tally(withDetail);
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const work = mkdtempSync(join(tmpdir(), 'coh-ci-budget-'));
const fixture = (name, body) => {
  const file = join(work, `${name}.json`);
  writeFileSync(file, body);
  return file;
};

try {
  let output = run('check');
  check('check on the real budget file exits 0', output.status === 0 && /ci-budget check: \d+ jobs/.test(output.stdout), output.stderr || output.stdout);

  // A job and its budgeted step both over budget; the step name carries the runner's pinned-action suffix.
  const over = fixture('over', payload(timed(wallBudget + 1, {
    name: JOB,
    steps: [timed(stepBudget + 1, { name: `${STEP}@${SHA}` })],
  })));
  output = run('compare', over);
  check('compare without --strict reports findings and exits 0',
    output.status === 0 && output.stdout.includes(`${JOB} wall:`) && output.stdout.includes(`${JOB}/${STEP}:`) && /2 over budget/.test(output.stdout),
    output.stdout);

  output = run('compare', over, '--strict');
  check('compare --strict exits 1 when a step exceeds its budget', output.status === 1, `status ${output.status}`);

  // Exactly at budget is within budget; a failed job over budget has no comparable duration and is skipped.
  const within = fixture('within', payload(
    timed(wallBudget, { name: JOB, steps: [timed(stepBudget, { name: STEP })] }),
    timed(wallBudget * 10, { name: JOB, conclusion: 'failure' }),
  ));
  output = run('compare', within, '--strict');
  check('within-budget compare --strict exits 0', output.status === 0 && /0 over budget/.test(output.stdout), output.stdout);

  output = run('compare');
  check('compare without a jobs file is a usage error (exit 2)', output.status === 2 && /usage:/.test(output.stderr), `status ${output.status}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL - ${fails.length} ci-budget regression check(s) failed:`);
  for (const failure of fails) console.error('  x ' + failure);
  process.exit(1);
}
console.log('\nOK - all ci-budget regression checks passed.');
