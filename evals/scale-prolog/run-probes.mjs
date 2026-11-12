#!/usr/bin/env node
// @ts-check
// Runs the probes of a refutation key against the interpreter in repo/ and prints one JSON object
// that maps each claim id to its observed outcome.
//   node evals/scale-prolog/run-probes.mjs <key.json>
// A query probe consults `program` (if any) in a fresh session and collects up to 10 answers. The
// outcome is the answers in pl.format_answer form joined by ` ; `, or `false` when there is none.
// A `js` probe evaluates its expression with `pl` in scope and prints String() of the awaited value.
// Each probe has its own time limit, so a probe that never answers shows as `timeout`.
// Exit 0 when every probe ran, 2 on a usage error or an unreadable key.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ program?: string, query?: string, js?: string, expect: string }} Probe */

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES = join(HERE, 'repo', 'modules');
const LIBRARIES = ['lists', 'format', 'charsio', 'random', 'statistics', 'js', 'os', 'concurrent', 'promises'];
const MAX_ANSWERS = 10;
const LIMIT_MS = 5000;

const require = createRequire(import.meta.url);
const pl = require(join(MODULES, 'core.js'));
for (const lib of LIBRARIES) require(join(MODULES, `${lib}.js`))(pl);

/**
 * @template T
 * @param {Promise<T>} work
 * @returns {Promise<T | string>}
 */
const timed = (work) => {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  /** @type {Promise<string>} */
  const late = new Promise((done) => { timer = setTimeout(() => done('timeout'), LIMIT_MS); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
};

/** @param {Probe} probe */
async function solve(probe) {
  const session = pl.create(100000);
  /** @type {unknown} */
  const consulted = await new Promise((done) => session.consult(probe.program ?? '', { success: () => done(null), error: done }));
  if (consulted !== null) return `consult error: ${pl.format_answer(consulted)}`;
  /** @type {unknown} */
  const parsed = await new Promise((done) => session.query(probe.query, { success: () => done(null), error: done }));
  if (parsed !== null) return pl.format_answer(parsed);
  /** @type {string[]} */
  const out = [];
  while (out.length < MAX_ANSWERS) {
    /** @type {string | null} */
    const next = await new Promise((done) => session.answer({
      success: (/** @type {unknown} */ a) => done(pl.format_answer(a)),
      error: (/** @type {unknown} */ e) => done(pl.format_answer(e)),
      fail: () => done(null),
      limit: () => done('limit'),
    }));
    if (next === null) break;
    out.push(next);
    if (next === 'limit' || next.startsWith('uncaught exception')) break;
  }
  return out.length ? out.join(' ; ') : 'false';
}

/** @param {Probe} probe */
async function observe(probe) {
  try {
    if (probe.js !== undefined) return String(await timed(Promise.resolve(new Function('pl', `return (${probe.js});`)(pl))));
    return String(await timed(solve(probe)));
  } catch (e) {
    return `js error: ${/** @type {Error} */ (e).message}`;
  }
}

const [path, ...extra] = process.argv.slice(2);
if (!path || extra.length) {
  console.error('usage: node evals/scale-prolog/run-probes.mjs <key.json>');
  process.exit(2);
}
/** @type {{ claims: { id: string, probe: Probe }[] }} */
let key;
try {
  key = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.error(`run-probes: cannot read ${path}: ${/** @type {Error} */ (e).message}`);
  process.exit(2);
}
/** @type {Record<string, string>} */
const seen = {};
for (const c of key.claims) seen[c.id] = await observe(c.probe);
console.log(JSON.stringify(seen));
process.exit(0);
