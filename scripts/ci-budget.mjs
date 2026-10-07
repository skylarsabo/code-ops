#!/usr/bin/env node
// Read the measured CI time budgets in .github/ci-budgets.json. Advisory: findings print as
// GitHub warning annotations and the exit code stays 0 unless --strict is given.
//
//   node scripts/ci-budget.mjs check [--strict]
//       Validate the budget file shape and that each budgeted job exists in validate.yml.
//   node scripts/ci-budget.mjs compare <jobs.json> [--strict]
//       Report each job or step slower than its budget. <jobs.json> is the output of
//       gh api repos/<owner>/<repo>/actions/runs/<id>/jobs (use - for stdin).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGETS = resolve(ROOT, '.github', 'ci-budgets.json');
const WORKFLOW = resolve(ROOT, '.github', 'workflows', 'validate.yml');
const STAT_KEYS = ['samples', 'min', 'median', 'max', 'budgetSeconds'];

const [mode, ...rest] = process.argv.slice(2);
const strict = rest.includes('--strict');
const operands = rest.filter((arg) => arg !== '--strict');
if ((mode !== 'check' && mode !== 'compare') || (mode === 'check' ? operands.length : operands.length !== 1)) {
  console.error('usage: node scripts/ci-budget.mjs check [--strict] | compare <jobs.json|-> [--strict]');
  process.exit(2);
}

const findings = [];
const finding = (message) => { findings.push(message); console.log(`::warning title=ci-budget::${message}`); };
const budgets = JSON.parse(readFileSync(BUDGETS, 'utf8'));

function jobsOf() {
  return Object.entries(budgets.platforms ?? {}).flatMap(([platform, jobs]) => Object.entries(jobs).map(([name, job]) => ({ platform, name, job })));
}

function checkStat(label, stat) {
  const numbers = STAT_KEYS.every((key) => Number.isFinite(stat?.[key]) && stat[key] >= 0);
  if (!numbers) return finding(`${label}: ${STAT_KEYS.join(', ')} must be non-negative numbers`);
  if (!(stat.min <= stat.median && stat.median <= stat.max)) finding(`${label}: min, median, max are out of order`);
  if (stat.budgetSeconds !== stat.max) finding(`${label}: budgetSeconds ${stat.budgetSeconds} is not the measured max ${stat.max}`);
}

if (mode === 'check') {
  if (budgets.schemaVersion !== 1) finding(`schemaVersion ${budgets.schemaVersion} is not 1`);
  const workflow = readFileSync(WORKFLOW, 'utf8');
  for (const { platform, name, job } of jobsOf()) {
    if (!new RegExp(`^  ${name}:\\s*$`, 'm').test(workflow)) finding(`${platform}/${name}: no such job in validate.yml`);
    checkStat(`${platform}/${name} wall`, job.wallSeconds);
    for (const [step, stat] of Object.entries(job.steps ?? {})) checkStat(`${platform}/${name}/${step}`, stat);
  }
  const count = jobsOf().length;
  console.log(`ci-budget check: ${count} jobs, sample n=${budgets.sample?.n}, ${findings.length} finding(s)`);
} else {
  const input = JSON.parse(readFileSync(operands[0] === '-' ? 0 : operands[0], 'utf8'));
  const seconds = (item) => Math.round((Date.parse(item.completed_at) - Date.parse(item.started_at)) / 1000);
  const byName = new Map(jobsOf().map(({ name, job }) => [name, job]));
  // A skipped, failed, or cancelled job has no comparable duration, so only successful jobs count.
  for (const run of (input.jobs ?? []).filter((item) => item.conclusion === 'success')) {
    const job = byName.get(run.name);
    if (!job) { finding(`${run.name}: no budget for this job`); continue; }
    if (seconds(run) > job.wallSeconds.budgetSeconds) finding(`${run.name} wall: ${seconds(run)} s over budget ${job.wallSeconds.budgetSeconds} s`);
    for (const step of run.steps ?? []) {
      const name = step.name.replace(/@[0-9a-f]{40}$/, '');
      const budget = job.steps?.[name]?.budgetSeconds;
      if (step.conclusion === 'success' && budget !== undefined && seconds(step) > budget) finding(`${run.name}/${name}: ${seconds(step)} s over budget ${budget} s`);
    }
  }
  console.log(`ci-budget compare: ${input.jobs?.length ?? 0} jobs, ${findings.length} over budget or unbudgeted`);
}
process.exit(strict && findings.length ? 1 : 0);
