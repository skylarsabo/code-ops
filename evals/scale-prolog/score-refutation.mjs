#!/usr/bin/env node
// @ts-check
// Scores a refutation candidate for a scale-prolog claim set against its key, by default
// ANSWER_KEY.refutation.json; `--key <path>` names another key, such as ANSWER_KEY.refutation-hard.json.
//   node evals/scale-prolog/score-refutation.mjs <candidate.md> [--key <path>] [--json]
// A candidate line reads `- <id> · REAL|NOT-A-DEFECT · <reason>`, where <id> is a claim id of the key such
// as C-NN or H-NN; the list marker is optional and the verdict is case-insensitive. Ids the key does not
// hold are ignored, and the total is the claim count of the key. A claim with no verdict, or with two
// different verdicts, is wrong.
// Exit 0 when it scored, 2 on a usage error or an unreadable file.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ id: string, verdict: 'REAL' | 'NOT-A-DEFECT', file: string, line: number }} Claim */

const HERE = dirname(fileURLToPath(import.meta.url));
// Only the field after the id is a verdict, so a reason that names either verdict never counts.
const LINE = /^\s*(?:[-*]\s+)?([A-Z]+-\d{2})\s*·\s*(REAL|NOT-A-DEFECT)(?![\w-])/i;

/**
 * @param {string} msg
 * @returns {never}
 */
function usage(msg) {
  console.error(`score-refutation: ${msg}\nusage: node evals/scale-prolog/score-refutation.mjs <candidate.md> [--key <path>] [--json]`);
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
const at = args.indexOf('--key');
const keyPath = at === -1 ? join(HERE, 'ANSWER_KEY.refutation.json') : args[at + 1];
if (keyPath === undefined || keyPath.startsWith('--')) usage('--key needs a path');
const rest = args.filter((a, i) => a !== '--json' && (at === -1 || (i !== at && i !== at + 1)));
if (rest.length !== 1 || rest[0].startsWith('--')) usage('expected exactly one candidate file');

/** @type {{ claims: Claim[] }} */
const key = JSON.parse(read(keyPath));
const known = new Set(key.claims.map((c) => c.id));
/** @type {Map<string, Set<string>>} */
const given = new Map();
for (const line of read(rest[0]).split(/\r?\n/)) {
  const m = LINE.exec(line);
  if (!m) continue;
  const id = m[1].toUpperCase();
  if (!known.has(id)) continue;
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
