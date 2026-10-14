// The score and report verbs: read a run folder's frozen keys and unit results, summarize each
// skill with lib/score.mjs, and write scores.json and REPORT.md into the run folder.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBench } from './runner.mjs';
import { renderReport, summarizeSkill } from './score.mjs';

export const ITERATIONS = 10000;
export const SEED = 1;

/** Physical line count of every file under dir, recursively. */
export function countLines(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) n += countLines(p);
    else {
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
  const targetOf = Object.fromEntries(matrix.tasks.map((t) => [t.id, t.target]));
  const summaries = matrix.skills.map((matrixSkill) => {
    const target = targetOf[matrix.tasks.find((t) => t.skill === matrixSkill.id).id];
    const srcLines = countLines(join(targets[target], 'src'));
    return summarizeSkill({ skill: matrixSkill.id, matrixSkill, units, keys, srcLines, iterations, seed });
  });
  const scores = { iterations, seed, unitsPlanned: planned.size, unitsScored: units.length, missing, summaries };
  const out = join(runDir, 'scores.json');
  writeFileSync(out, `${JSON.stringify(scores, null, 2)}\n`);
  return out;
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
  writeFileSync(out, warn + body);
  return out;
}
