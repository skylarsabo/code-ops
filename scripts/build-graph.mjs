#!/usr/bin/env node
// @ts-check
// Build graph gate: validates a program's BUILD_GRAPH.json and prints its dependency waves.
//
//   node scripts/build-graph.mjs check <graph.json>
//   node scripts/build-graph.mjs plan <graph.json>
//   co build-graph check|plan <graph.json>
//
// Schema (version 1), no other keys:
//   { version: 1, program, units: [{ id, repo, scope: [paths], dependsOn: [ids], doneWhen, gate, roundBudget }] }
//
// `check` lists every problem and exits 1 when: the file is unreadable or not JSON; the schema is
// invalid (including unknown keys, an empty `doneWhen` or `gate`, or a `roundBudget` that is not a
// positive integer); ids repeat; a dependency names no unit; the graph has a cycle; two units in
// one repo with no ordering path between them (transitively, either direction) share a path; or a
// scope holds a generated or stamped path, a glob, or an empty or `.` segment (a leading `./` and
// one trailing slash are allowed). Paths compare case-insensitively with forward slashes,
// and a directory scope overlaps every path under it. Scopes are repo-relative, so units in
// different repos never share a path. It prints `ok` and exits 0 on a clean graph.
//
// `plan` runs the same check, then prints one line per wave, `wave <n>: <id>, <id>`, where a wave
// holds the units whose dependencies sit in earlier waves.
//
// GENERATED paths come from derived-merge.mjs GROUPS (vendored copies, host distributions, the docs
// manifest) minus its `versions` group, which holds hand-bumped version files. The digest store
// and the rendered global contracts have no exported list, so their patterns live here.
//
// Read-only: writes nothing but stdout and stderr. Exit: 0 = ok; 1 = problems; 2 = usage error.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseOrDie, usage } from './cli-lib.mjs';
import { GROUPS } from './derived-merge.mjs';

const USAGE = 'usage: build-graph.mjs <check|plan> <graph.json>';
const TOP_KEYS = ['version', 'program', 'units'];
const UNIT_KEYS = ['id', 'repo', 'scope', 'dependsOn', 'doneWhen', 'gate', 'roundBudget'];

/**
 * @typedef {{ id: string, repo: string, scope: string[], dependsOn: string[], doneWhen: string, gate: string, roundBudget: number }} Unit
 */

// Patterns the derived-merge groups do not carry. Scopes are tested folded to lower case, and the
// manifest pattern repeats a group match because that group matches the upper-case basename.
const EXTRA_GENERATED = [
  /(^|\/)docs_manifest\.json$/,
  /(^|\/)98 system\/digests(\/|$)/,
  /^global-contracts\/agents\.(?!source\.md$)[^/]+\.md$/,
];
const GENERATED_GROUPS = GROUPS.filter((group) => group.id !== 'versions');

/** @param {string} path */
export const normalize = (path) => path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^(\.\/)+/, '').replace(/\/$/, '').replace(/^\.$/, '').toLowerCase();

// The reason a scope path cannot be compared by string, or '' when it can. A leading `./` and one
// trailing slash are allowed (normalize drops them); a lone `.` is the whole repo.
/** @param {string} path */
function unsafeSegment(path) {
  const trimmed = path.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/$/, '');
  if (trimmed === '' || trimmed === '.') return '';
  for (const segment of trimmed.split('/')) {
    if (segment === '') return 'has an empty segment';
    if (segment === '.') return 'has a `.` segment';
    if (/[*?[]/.test(segment)) return 'is a glob';
  }
  return '';
}

/** @param {string} a @param {string} b */
export const overlaps = (a, b) => a === b || a === '' || b === '' || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** @param {string} path A normalized scope path. */
function isGenerated(path) {
  // A directory scope holds generated files when its own path, with a slash, is one.
  return [path, `${path}/`].some((candidate) =>
    GENERATED_GROUPS.some((group) => group.match(candidate)) || EXTRA_GENERATED.some((re) => re.test(candidate)));
}

/** @param {unknown} v @returns {v is string} */
const isText = (v) => typeof v === 'string' && v.trim() !== '';
/** @param {unknown} v @returns {v is Record<string, any>} */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Check one parsed graph and return every problem found.
 * @param {unknown} graph
 * @returns {string[]}
 */
export function checkGraph(graph) {
  /** @type {string[]} */
  const problems = [];
  if (!isObject(graph)) return ['graph must be a JSON object'];
  for (const key of Object.keys(graph)) if (!TOP_KEYS.includes(key)) problems.push(`unknown key: ${key}`);
  if (graph.version !== 1) problems.push('version must be 1');
  if (!isText(graph.program)) problems.push('program must be a non-empty string');
  if (!Array.isArray(graph.units) || graph.units.length === 0) return [...problems, 'units must be a non-empty array'];

  /** @type {Map<string, Unit>} */
  const byId = new Map();
  /** @type {Unit[]} */
  const valid = [];
  graph.units.forEach((unit, index) => {
    const at = isObject(unit) && isText(unit.id) ? `unit ${unit.id}` : `unit #${index + 1}`;
    if (!isObject(unit)) { problems.push(`${at}: must be an object`); return; }
    for (const key of Object.keys(unit)) if (!UNIT_KEYS.includes(key)) problems.push(`${at}: unknown key: ${key}`);
    let sound = true;
    /** @param {string} message */
    const bad = (message) => { problems.push(`${at}: ${message}`); sound = false; };
    if (!isText(unit.id)) bad('id must be a non-empty string');
    else if (byId.has(unit.id)) bad(`duplicate id ${unit.id}`);
    if (!isText(unit.repo)) bad('repo must be a non-empty string');
    if (!Array.isArray(unit.scope) || unit.scope.length === 0 || !unit.scope.every(isText)) bad('scope must be a non-empty array of non-empty strings');
    else {
      for (const path of unit.scope) {
        if (/^([a-z]:|[\\/])/i.test(path) || path.replace(/\\/g, '/').split('/').includes('..')) bad(`scope path ${path} must stay inside the repo`);
        else if (unsafeSegment(path)) bad(`scope path ${path} ${unsafeSegment(path)}; list literal paths or a directory`);
        else if (isGenerated(normalize(path))) bad(`scope path ${path} is generated or stamped`);
      }
    }
    if (!Array.isArray(unit.dependsOn) || !unit.dependsOn.every(isText)) bad('dependsOn must be an array of ids');
    if (!isText(unit.doneWhen)) bad('doneWhen must be a non-empty string');
    if (!isText(unit.gate)) bad('gate must be a non-empty string');
    if (!Number.isInteger(unit.roundBudget) || unit.roundBudget <= 0) bad('roundBudget must be a positive integer');
    if (isText(unit.id) && !byId.has(unit.id) && sound) { byId.set(unit.id, unit); valid.push(unit); }
    else if (isText(unit.id) && !byId.has(unit.id)) byId.set(unit.id, unit);
  });

  for (const unit of valid) {
    for (const dep of unit.dependsOn) if (!byId.has(dep)) problems.push(`unit ${unit.id}: unknown dependency ${dep}`);
  }

  const cyclic = levels(valid).stuck;
  if (cyclic.length) problems.push(`dependency cycle among: ${cyclic.join(', ')}`);

  const ancestors = closure(valid);
  const folded = valid.map((unit) => ({ unit, paths: unit.scope.map(normalize) }));
  for (let i = 0; i < folded.length; i++) {
    for (let j = i + 1; j < folded.length; j++) {
      const a = folded[i];
      const b = folded[j];
      if (!a || !b || a.unit.repo !== b.unit.repo) continue;
      if (ancestors.get(a.unit.id)?.has(b.unit.id) || ancestors.get(b.unit.id)?.has(a.unit.id)) continue;
      const shared = a.paths.flatMap((pa) => b.paths.filter((pb) => overlaps(pa, pb)).map((pb) => (pa.length >= pb.length ? pa : pb)));
      if (shared.length) problems.push(`units ${a.unit.id} and ${b.unit.id} share ${[...new Set(shared)].join(', ')} with no ordering between them`);
    }
  }
  return problems;
}

// Every unit a unit depends on, directly or not. A visited set keeps a cycle from looping.
/** @param {Unit[]} units @returns {Map<string, Set<string>>} */
function closure(units) {
  const direct = new Map(units.map((unit) => [unit.id, unit.dependsOn]));
  return new Map(units.map((unit) => {
    const seen = new Set();
    const queue = [...unit.dependsOn];
    for (let dep = queue.pop(); dep !== undefined; dep = queue.pop()) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      queue.push(...(direct.get(dep) ?? []));
    }
    return [unit.id, seen];
  }));
}

// Wave n holds the units whose known dependencies all sit in earlier waves. `stuck` lists the
// units no wave reaches, which is every unit on or behind a cycle.
/** @param {Unit[]} units @returns {{ waves: string[][], stuck: string[] }} */
function levels(units) {
  const known = new Set(units.map((unit) => unit.id));
  const placed = new Set();
  /** @type {string[][]} */
  const waves = [];
  for (;;) {
    const wave = units.filter((unit) => !placed.has(unit.id) && unit.dependsOn.every((dep) => placed.has(dep) || !known.has(dep))).map((unit) => unit.id);
    if (!wave.length) break;
    for (const id of wave) placed.add(id);
    waves.push(wave);
  }
  return { waves, stuck: units.filter((unit) => !placed.has(unit.id)).map((unit) => unit.id) };
}

/**
 * Waves of a graph that passed checkGraph.
 * @param {any} graph
 * @returns {string[][]}
 */
export const planWaves = (graph) => levels(graph.units).waves;

/** @param {string} file @returns {{ graph?: unknown, problems: string[] }} */
function load(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (error) { return { problems: [`cannot read ${file}: ${error instanceof Error ? error.message : error}`] }; }
  let graph;
  try { graph = JSON.parse(text); } catch (error) { return { problems: [`invalid JSON in ${file}: ${error instanceof Error ? error.message : error}`] }; }
  return { graph, problems: checkGraph(graph) };
}

/** @param {string[]} argv */
function cli(argv) {
  const { positional } = parseOrDie(argv, {}, USAGE);
  const [verb, file, ...extra] = positional;
  if ((verb !== 'check' && verb !== 'plan') || !file || extra.length) usage(USAGE);
  const { graph, problems } = load(/** @type {string} */ (file));
  if (problems.length) {
    for (const problem of problems) console.error(`x ${problem}`);
    console.error(`${problems.length} problem${problems.length === 1 ? '' : 's'}`);
    return 1;
  }
  if (verb === 'check') console.log('ok');
  else planWaves(graph).forEach((wave, index) => console.log(`wave ${index + 1}: ${wave.join(', ')}`));
  return 0;
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) process.exitCode = cli(process.argv.slice(2));
