#!/usr/bin/env node
// Skill trigger measurement harness (P6). Local and model-in-the-loop: it spends money, so it is
// never a merge gate and CI does not run it. CI runs evals/trigger/run.mjs (logic only).
//
//   node evals/trigger/trigger.mjs --queries evals/trigger/queries/research-verify.json --out <dir>
//     [--runs 3] [--split all|train|test] [--seed 1] [--test-fraction 0.4]
//     [--max-budget-usd 0.50] [--limit N] [--model <alias>] [--setting-sources project] [--target <dir>]
//
// Each query runs --runs times as `claude -p` with every plugin under plugins/ loaded, so sibling
// skills compete. Each session runs in its own fresh copy of --target (default
// evals/bench/targets/hyparquet, minus every ANSWER_KEY path and PROVENANCE.md), removed afterwards,
// so a query about code has code to read. The query goes on stdin, never into a command line. The first Skill tool_use
// is recorded and the process is killed there (early stop). A session that reaches --max-budget-usd
// without a Skill call fired no skill within the cap: it is recorded as a non-fire with its cost
// and capped: true, and the run continues. Any other session error ends the run. The output is a
// trigger table as <out>/trigger-<skill>.json and .md. The harness reports only; it never edits a SKILL.md.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runQuery } from './lib/claude.mjs';
import { resolveClaude } from './lib/env.mjs';
import { parseQuerySet } from './lib/queries.mjs';
import { renderMarkdown, scoreResults } from './lib/score.mjs';
import { stratifiedSplit } from './lib/split.mjs';
import { withSessionCopy } from './lib/target.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_TARGET = join(ROOT, 'evals', 'bench', 'targets', 'hyparquet');

/** Parse argv into options. Throws on an unknown or malformed flag. */
export function parseArgs(argv) {
  const o = { runs: 3, split: 'all', seed: 1, testFraction: 0.4, budget: 0.5, limit: null, model: null, settingSources: 'project', target: null, queries: null, out: null };
  const num = (flag, v, min) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min) throw new Error(`${flag} needs a number >= ${min}`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = () => {
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
      return argv[++i];
    };
    if (flag === '--queries') o.queries = val();
    else if (flag === '--out') o.out = val();
    else if (flag === '--runs') o.runs = num(flag, val(), 1);
    else if (flag === '--seed') o.seed = num(flag, val(), 0);
    else if (flag === '--test-fraction') o.testFraction = num(flag, val(), 0);
    else if (flag === '--max-budget-usd') o.budget = num(flag, val(), 0.01);
    else if (flag === '--limit') o.limit = num(flag, val(), 1);
    else if (flag === '--model') o.model = val();
    else if (flag === '--setting-sources') o.settingSources = val();
    else if (flag === '--target') o.target = val();
    else if (flag === '--split') {
      o.split = val();
      if (!['all', 'train', 'test'].includes(o.split)) throw new Error('--split must be all, train, or test');
    } else throw new Error(`unknown argument ${flag}`);
  }
  if (!o.queries) throw new Error('--queries <file> is required');
  if (!o.out) throw new Error('--out <dir> is required');
  return o;
}

const usd = (c) => (typeof c === 'number' ? c.toFixed(4) : 'n/a');

/**
 * Run each query runsPerQuery times through runSession(q), which resolves a runQuery result.
 * A capped session without a Skill call is a non-fire ({ skill: null, costUsd, capped: true }).
 * Any other error stops the loop. Resolves { results, failure } with the runs recorded so far.
 */
export async function collectRuns(chosen, runsPerQuery, runSession, log = console.log) {
  const results = [];
  let failure = null;
  for (const q of chosen) {
    const runs = [];
    for (let n = 0; n < runsPerQuery && !failure; n++) {
      const r = await runSession(q);
      if (!r.skill && r.capped) {
        log(`${q.stratum} run ${n + 1}: none (capped, cost ${usd(r.costUsd)})`);
        runs.push({ skill: null, costUsd: r.costUsd, toolsBefore: r.toolsBefore, capped: true });
        continue;
      }
      log(`${q.stratum} run ${n + 1}: ${r.skill ?? 'none'}${r.error ? ` ERROR ${r.error}` : ''}`);
      if (r.error) failure = `session failed for "${q.query.slice(0, 60)}": ${r.error}`;
      else runs.push({ skill: r.skill, costUsd: r.costUsd, toolsBefore: r.toolsBefore });
    }
    if (runs.length) results.push({ ...q, runs });
    if (failure) break;
  }
  return { results, failure };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const set = parseQuerySet(readFileSync(resolve(o.queries), 'utf8'));
  const bin = resolveClaude();
  if (!bin) throw new Error('claude binary not found on PATH');
  const pluginsDir = join(ROOT, 'plugins');
  const pluginDirs = readdirSync(pluginsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(pluginsDir, d.name));
  const { train, test } = stratifiedSplit(set.queries, { seed: o.seed, testFraction: o.testFraction });
  let chosen = o.split === 'train' ? train : o.split === 'test' ? test : set.queries;
  if (o.limit) chosen = chosen.slice(0, o.limit);
  if (chosen.length === 0) throw new Error('the selected split has no queries');

  const target = o.target ? resolve(o.target) : DEFAULT_TARGET;
  const { results, failure } = await collectRuns(chosen, o.runs, (q) =>
    withSessionCopy(target, (cwd) => runQuery(bin, q.query, { pluginDirs, budgetUsd: o.budget, settingSources: o.settingSources, model: o.model, cwd })));

  const table = scoreResults(set.skill, results);
  mkdirSync(resolve(o.out), { recursive: true });
  const stem = join(resolve(o.out), `trigger-${set.skill.replace(':', '-')}`);
  const meta = { split: o.split, seed: o.seed, runsPerQuery: o.runs, detail: results };
  writeFileSync(`${stem}.json`, `${JSON.stringify({ table, meta: { ...meta, detail: undefined }, results }, null, 2)}\n`);
  writeFileSync(`${stem}.md`, renderMarkdown(table, meta));
  console.log(`wrote ${stem}.json and ${stem}.md`);
  if (failure) throw new Error(failure);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`FAIL — trigger: ${e.message}`);
    process.exit(1);
  });
}
