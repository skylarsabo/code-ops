#!/usr/bin/env node
// @ts-check
// Scores a refutation candidate for the scale-prolog claim set against ANSWER_KEY.refutation.json.
//   node evals/scale-prolog/score-refutation.mjs <candidate.md> [--json]
// A candidate line reads `- C-NN · REAL|NOT-A-DEFECT · <reason>`; the list marker is optional and the
// verdict is case-insensitive. A claim with no verdict, or with two different verdicts, is wrong.
// Exit 0 when it scored, 2 on a usage error or an unreadable file.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ id: string, verdict: 'REAL' | 'NOT-A-DEFECT', seed: string, file: string, line: number }} Claim */

const HERE = dirname(fileURLToPath(import.meta.url));
// Only the field after the id is a verdict, so a reason that names either verdict never counts.
const LINE = /^\s*(?:[-*]\s+)?(C-\d{2})\s*·\s*(REAL|NOT-A-DEFECT)(?![\w-])/i;

/**
 * @param {string} msg
 * @returns {never}
 */
function usage(msg) {
  console.error(`score-refutation: ${msg}\nusage: node evals/scale-prolog/score-refutation.mjs <candidate.md> [--json]`);
  process.exit(2);
}

/** @param {string} path */
function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    return usage(`cannot read ${path}: ${/** @type {Error} */ (e).message}`);
  }
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const rest = args.filter((a) => a !== '--json');
if (rest.length !== 1 || rest[0].startsWith('--')) usage('expected exactly one candidate file');

/** @type {{ claims: Claim[] }} */
const key = JSON.parse(read(join(HERE, 'ANSWER_KEY.refutation.json')));
/** @type {Map<string, Set<string>>} */
const given = new Map();
for (const line of read(rest[0]).split(/\r?\n/)) {
  const m = LINE.exec(line);
  if (!m) continue;
  const id = m[1].toUpperCase();
  const verdicts = given.get(id) ?? new Set();
  verdicts.add(m[2].toUpperCase());
  given.set(id, verdicts);
}

/** @param {Claim} c */
const right = (c) => {
  const v = given.get(c.id);
  return v !== undefined && v.size === 1 && v.has(c.verdict);
};
/** @param {Claim['verdict']} verdict */
const split = (verdict) => {
  const of = key.claims.filter((c) => c.verdict === verdict);
  return { correct: of.filter(right).length, total: of.length };
};
const wrong = key.claims.filter((c) => !right(c)).map((c) => c.id);
const result = {
  correct: key.claims.length - wrong.length,
  total: key.claims.length,
  real: split('REAL'),
  false: split('NOT-A-DEFECT'),
  wrong,
};

if (json) {
  console.log(JSON.stringify(result));
} else {
  console.log(`correct ${result.correct} of ${result.total}`);
  console.log(`real claims correct ${result.real.correct} of ${result.real.total}`);
  console.log(`false claims correct ${result.false.correct} of ${result.false.total}`);
  console.log(`wrong: ${wrong.length ? wrong.join(', ') : 'none'}`);
}
