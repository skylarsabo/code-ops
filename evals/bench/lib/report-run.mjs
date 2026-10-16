// The score and report verbs: read a run folder's frozen keys and unit results, summarize each
// skill with lib/score.mjs, and write scores.json and REPORT.md into the run folder.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBench, readLedger } from './runner.mjs';
import { renderReport, summarizeSkill } from './score.mjs';

export const ITERATIONS = 10000;
export const SEED = 1;

// The target size rule's exclusions (design doc, "Target"), plus the answer-key folders.
const NOT_SOURCE = /^(?:test|dist|docs|node_modules|ANSWER_KEY\..*)$/;

/** Physical line count of the JavaScript files under dir, outside test/, dist/, docs/, and ANSWER_KEY.*. */
export function countLines(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) n += NOT_SOURCE.test(e.name) ? 0 : countLines(p);
    else if (/\.[cm]?js$/.test(e.name)) {
      const text = readFileSync(p, 'utf8');
      n += text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    }
  }
  return n;
}

const readJsonDir = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));

/** Summarize every matrix skill from the run folder; write and return the path of scores.json. */
export function scoreRun({ runDir, benchDir, iterations = ITERATIONS, seed = SEED }) {
  const plan = JSON.parse(readFileSync(join(runDir, 'plan.json'), 'utf8'));
  const { matrix, targets } = loadBench(benchDir);
  const keys = Object.fromEntries(readJsonDir(join(runDir, 'keys')).map((k) => [k.task, k]));
  const units = readJsonDir(join(runDir, 'units'));
  const planned = new Set(plan.units.map((u) => u.id));
  const missing = [...planned].filter((id) => !units.some((u) => u.unitId === id));
  const lines = Object.fromEntries(Object.entries(targets).map(([name, dir]) => [name, countLines(dir)]));
  const plannedTasks = new Set(plan.units.map((u) => u.task));
  const summaries = matrix.skills.map((matrixSkill) => {
    // The planned tasks' targets set the size; a skill planned on several targets gets their mean.
    const sizes = matrix.tasks.filter((t) => t.skill === matrixSkill.id && plannedTasks.has(t.id)).map((t) => lines[t.target]);
    const srcLines = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
    return summarizeSkill({ skill: matrixSkill.id, matrixSkill, units, keys, srcLines, iterations, seed });
  });
  const scores = { iterations, seed, unitsPlanned: planned.size, unitsScored: units.length, missing, summaries };
  const out = join(runDir, 'scores.json');
  writeFileSync(out, `${JSON.stringify(scores, null, 2)}\n`);
  return out;
}

/**
 * Spend totals over every attempt. The ledger holds every attempt, including those of a unit that
 * never got a record (an API error after a void, a killed rerun); a unit with no ledger line is a
 * legacy record and counts its own attempts, or its costUsd.
 */
export function spendSummary(units, ledger) {
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);
  const inLedger = new Set(ledger.map((e) => e.unitId));
  const legacy = units.filter((u) => !inLedger.has(u.unitId)).flatMap((u) => u.attempts ?? [{ costUsd: u.costUsd ?? 0, void: false }]);
  const attempts = [...ledger, ...legacy];
  return {
    totalUsd: sum(attempts.map((a) => a.costUsd ?? 0)),
    voidUsd: sum(attempts.filter((a) => a.void).map((a) => a.costUsd ?? 0)),
    // Attempts whose spend is unknown: killed mid-attempt, no result line, or a throw.
    unrecorded: ledger.filter((e) => ['killed-unrecorded', 'no-result', 'error'].includes(e.status) && e.costUsd == null).length,
    scoredUsd: sum(units.map((u) => u.costUsd ?? 0)),
  };
}

/** Render REPORT.md from plan.json and scores.json; return its path. */
export function reportRun({ runDir }) {
  const plan = JSON.parse(readFileSync(join(runDir, 'plan.json'), 'utf8'));
  const scores = JSON.parse(readFileSync(join(runDir, 'scores.json'), 'utf8'));
  const head = {
    ...plan,
    model: plan.bound.model,
    host: plan.bound.host,
    head: plan.bound.head,
    iterations: scores.iterations,
    seed: scores.seed,
    unitsPlanned: scores.unitsPlanned,
    unitsScored: scores.unitsScored,
    unitsMissing: scores.missing.length,
  };
  const out = join(runDir, 'REPORT.md');
  const body = renderReport({ plan: head, summaries: scores.summaries });
  const warn = scores.missing.length
    ? `> Incomplete run: ${scores.missing.length} planned unit(s) have no result (${scores.missing.join(', ')}). The verdicts below rest on the units that ran.\n\n`
    : '';
  const sp = spendSummary(readJsonDir(join(runDir, 'units')), readLedger(runDir));
  const spend = `\n## Spend\n\n- Total recorded spend, all attempts: $${sp.totalUsd.toFixed(2)}\n- Void attempts: $${sp.voidUsd.toFixed(2)}\n- Attempts with unrecorded spend (killed or no result): ${sp.unrecorded}\n- Scored units: $${sp.scoredUsd.toFixed(2)}\n`;
  writeFileSync(out, warn + body + spend);
  return out;
}
