#!/usr/bin/env node
// Beat-the-bare-model benchmark harness (design: code-ops-docs/10 Design/Beat the bare model
// benchmark 2026-10.md).
//
//   node evals/bench/bench.mjs check [--group <name>] [--tasks <file>]
//     exit 0 = the matrix, targets, changes, seeds, and tasks are valid.
//     --group limits the seed proofs to ANSWER_KEY.seeds/<name>.json.
//     --tasks checks the tasks in <file> (a JSON array) in place of the matrix tasks.
//
// `check` runs no model. It validates bench-matrix.json, recomputes each target's tree
// digest, runs the visible suite on a pristine copy, and proves the answer-key material in
// each target directory:
//   ANSWER_KEY.changes/<id>.json  a change: `review` (the commit a deep-review task reviews)
//                                 or `reference` (a ship task's reference solution). Applied
//                                 to the pristine tree, it leaves the visible suite green.
//   ANSWER_KEY.seeds/<group>.json an array of seeds. On its base (the pristine tree, or the
//                                 pristine tree plus the review change named in `base`), the
//                                 seed's `find` occurs once and its oracle passes. With the seed
//                                 applied, the visible suite stays green, a defect fails its
//                                 oracle, and a decoy passes it. No replace text adds a tell word.
//   ANSWER_KEY.oracles/<file>     hidden node:test files: seed oracles and ship acceptance tests.
// Each task's seeds sit at least 10 lines apart in a file, apply together on the task's base,
// and leave the visible suite green. A ship task's acceptance test fails on the pristine tree
// and passes with its reference change. Every proof runs in a copy under the OS temp
// directory, never in the tracked tree.
//
// The model-in-the-loop verbs live in lib/runner.mjs and lib/score.mjs and load only on demand,
// so `check` and CI never import them:
//   plan   --run <dir> [--reps 4] [--pilot] [--model claude-opus-5-5] [--cap-usd 5] [--timeout-min 60]
//          [--target <name>] [--isolation config-dir|bare] [--permission-mode bypassPermissions]
//          [--tasks <id,id,...>]  --target and --tasks narrow the plan to that target or those tasks.
//          config-dir (default) gives each unit a fresh, empty CLAUDE_CONFIG_DIR. bare adds --bare,
//          which also drops plugin agents (observed on 2.1.293), so the skill arm loses its agents.
//   run    --run <dir> [--limit <n>]       resumable; one result file per unit
//   score  --run <dir>                     writes scores.json
//   report --run <dir>                     writes REPORT.md

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const SKILLS = [
  'rigor:bug-hunt',
  'rigor:deep-review',
  'code-ops-suite:debug',
  'code-ops-suite:codebase-audit',
  'code-ops-suite:ship',
];
export const CLASSES = [
  'off-by-one',
  'inverted-guard',
  'missing-guard',
  'wrong-default',
  'swallowed-error',
  'missing-await',
  'wrong-order',
  'wrong-variable',
  'unsafe-input',
];
// A replace text may not add any of these, case-insensitive, beyond the count in its find text.
export const TELL_WORDS = ['bug', 'seed', 'plant', 'decoy', 'todo', 'fixme', 'xxx', 'hack', 'inject', 'mutant', 'oracle'];
export const MIN_SEED_GAP = 10;
// The visible suite. An explicit glob keeps oracle files out of the run.
export const VISIBLE_TESTS = 'test/**/*.test.js';
const ORACLE_DIR = 'ANSWER_KEY.oracles';
const SEEDS_DIR = 'ANSWER_KEY.seeds';
const CHANGES_DIR = 'ANSWER_KEY.changes';

const MATRIX_KEYS = ['version', 'skills', 'targets', 'tasks'];
const SKILL_KEYS = ['id', 'metric', 'minDelta', 'tasks'];
const TARGET_KEYS = ['name', 'upstream', 'commit', 'license', 'treeDigest'];
const TASK_KEYS = ['id', 'skill', 'target', 'statement', 'seeds', 'change', 'acceptance'];
const SEED_KEYS = ['id', 'kind', 'class', 'base', 'file', 'find', 'replace', 'oracle', 'symptom'];
const CHANGE_KEYS = ['id', 'kind', 'message', 'edits'];
const EDIT_KEYS = ['file', 'find', 'replace'];
const METRICS = ['keyed-f05', 'resolved-rate', 'accepted-rate'];
const ID = /^[a-z0-9][a-z0-9-]*$/;
const ORACLE_NAME = /^[\w.-]+\.test\.js$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const countOf = (text, needle) => (needle ? text.split(needle).length - 1 : 0);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const native = (dir, rel) => join(dir, ...rel.split('/'));

/** Report keys that are missing or not allowed. */
function exactKeys(obj, keys, where, problems) {
  if (!isObj(obj)) { problems.push(`${where}: must be an object`); return false; }
  for (const k of keys) if (!(k in obj)) problems.push(`${where}: missing key "${k}"`);
  for (const k of Object.keys(obj)) if (!keys.includes(k)) problems.push(`${where}: unknown key "${k}"`);
  return true;
}

/** True for any path segment that names answer-key material. */
const isAnswerKeyPath = (rel) => rel.split('/').some((seg) => seg.startsWith('ANSWER_KEY.'));

/** A path a seed or change may edit: inside the target, outside test/ and answer-key material. */
const editablePath = (rel) => nonEmpty(rel) && !isAnswerKeyPath(rel) && !rel.split('/').includes('..')
  && !rel.startsWith('/') && !rel.includes('\\') && !rel.startsWith('test/');

/** Report tell words that `replace` adds over `find`. */
function tellWords(find, replace, where, problems) {
  const f = String(find ?? '').toLowerCase();
  const r = String(replace ?? '').toLowerCase();
  for (const w of TELL_WORDS) if (countOf(r, w) > countOf(f, w)) problems.push(`${where}: replace adds the tell word "${w}"`);
}

/** Sorted POSIX relative paths of every file under dir, without answer-key material. */
export function listTargetFiles(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.name === 'node_modules' || isAnswerKeyPath(r)) continue;
      if (ent.isDirectory()) walk(join(abs, ent.name), r);
      else if (ent.isFile()) out.push(r);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** Digest over each file's path and content hash; answer-key material is excluded. */
export function treeDigest(dir) {
  const lines = listTargetFiles(dir).map((r) => `${r}\0${sha256(readFileSync(native(dir, r)))}\n`);
  return `sha256:${sha256(lines.join(''))}`;
}

/** Copy one file, creating its parent directories. */
function copyFile(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

/** Copy the target without answer-key material into a fresh temp directory. */
function pristineCopy(targetDir) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-check-'));
  for (const r of listTargetFiles(targetDir)) copyFile(native(targetDir, r), native(dir, r));
  return dir;
}

/** The parent environment without settings that change how node --test runs. */
function childEnv() {
  const env = { ...process.env };
  for (const k of ['NODE_OPTIONS', 'NODE_TEST_CONTEXT', 'NODE_V8_COVERAGE']) delete env[k];
  return env;
}

/** Run node --test on the given patterns in dir; resolves { ok, out }. */
function runTests(dir, patterns) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--test', ...patterns], { cwd: dir, env: childEnv(), windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ ok: code === 0, out: out.trim().split('\n').slice(-6).join('\n') });
    });
  });
}

/** Run async jobs with bounded concurrency. */
async function pool(jobs, limit = Math.max(2, Math.min(8, availableParallelism()))) {
  let next = 0;
  const worker = async () => { while (next < jobs.length) await jobs[next++](); };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

/** Apply edits in order to the copy in dir; returns a problem string or null. */
function applyEdits(dir, edits, label) {
  for (const e of edits) {
    const path = native(dir, e.file);
    if (e.find === null) {
      if (existsSync(path)) return `${label}: creates ${e.file}, which already exists`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, e.replace);
      continue;
    }
    if (!existsSync(path)) return `${label}: ${e.file} does not exist`;
    const text = readFileSync(path, 'utf8');
    const n = countOf(text, e.find);
    if (n !== 1) return `${label}: find occurs ${n} times in ${e.file}, expected exactly 1`;
    writeFileSync(path, text.replace(e.find, () => e.replace));
  }
  return null;
}

/** A temp copy of the target with the change applied; resolves { dir } or { problem }. */
function baseCopy(targetDir, change) {
  const dir = pristineCopy(targetDir);
  const problem = change ? applyEdits(dir, change.edits, `change ${change.id}`) : null;
  if (problem) { rmSync(dir, { recursive: true, force: true }); return { problem }; }
  return { dir };
}

/** Copy an oracle into dir/oracle/ and run it. */
function runOracle(targetDir, dir, file) {
  copyFile(join(targetDir, ORACLE_DIR, file), join(dir, 'oracle', file));
  return runTests(dir, [`oracle/${file}`]);
}

/** Load the JSON files of one answer-key directory; returns [{ name, data, error }]. */
function loadDir(targetDir, sub) {
  const dir = join(targetDir, sub);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).sort()) {
    const name = f.replace(/.json$/, '');
    if (!f.endsWith('.json')) { out.push({ name, data: null, error: `${sub}/${f}: only .json files belong here` }); continue; }
    try { out.push({ name, data: JSON.parse(readFileSync(join(dir, f), 'utf8')), error: null }); } catch (e) {
      out.push({ name, data: null, error: `${sub}/${f}: not JSON: ${e.message}` });
    }
  }
  return out;
}

/** Validate a change record; returns true when it is usable. */
function checkChangeShape(change, name, problems) {
  const where = `change ${name}`;
  if (!exactKeys(change, CHANGE_KEYS, where, problems)) return false;
  let ok = true;
  if (change.id !== name) { problems.push(`${where}: id must equal the file name`); ok = false; }
  if (!['review', 'reference'].includes(change.kind)) { problems.push(`${where}: kind must be review or reference`); ok = false; }
  // A review change becomes the sandbox's second commit, so it needs a neutral commit message.
  if (change.kind === 'review' && !nonEmpty(change.message)) { problems.push(`${where}: a review change needs a non-empty message`); ok = false; }
  if (change.kind === 'reference' && change.message !== null) { problems.push(`${where}: a reference change has message null`); ok = false; }
  if (typeof change.message === 'string') tellWords('', change.message, `${where} message`, problems);
  if (!Array.isArray(change.edits) || !change.edits.length) { problems.push(`${where}: edits must be a non-empty array`); return false; }
  change.edits.forEach((e, i) => {
    const w = `${where} edit[${i}]`;
    if (!exactKeys(e, EDIT_KEYS, w, problems)) { ok = false; return; }
    if (!editablePath(e.file)) { problems.push(`${w}: file must be a target source path outside test/ and answer-key material`); ok = false; }
    if (e.find !== null && !nonEmpty(e.find)) { problems.push(`${w}: find must be non-empty text, or null to create a file`); ok = false; }
    if (typeof e.replace !== 'string' || e.find === e.replace) { problems.push(`${w}: replace must be text that differs from find`); ok = false; }
    tellWords(e.find, e.replace, w, problems);
  });
  return ok;
}

/** Validate a seed record; returns true when it is usable. */
function checkSeedShape(seed, i, group, changes, problems) {
  const where = `seed ${group}[${i}]${nonEmpty(seed?.id) ? ` ${seed.id}` : ''}`;
  if (!exactKeys(seed, SEED_KEYS, where, problems)) return false;
  let ok = true;
  const bad = (msg) => { problems.push(`${where}: ${msg}`); ok = false; };
  if (!ID.test(String(seed.id))) bad('id must be lowercase kebab-case');
  if (!['defect', 'decoy'].includes(seed.kind)) bad('kind must be defect or decoy');
  if (!CLASSES.includes(seed.class)) bad(`class must be one of ${CLASSES.join(', ')}`);
  if (seed.symptom !== null && !nonEmpty(seed.symptom)) bad('symptom must be a string or null');
  if (!nonEmpty(seed.find) || typeof seed.replace !== 'string' || seed.find === seed.replace) bad('find must be non-empty and differ from replace');
  if (!nonEmpty(seed.oracle) || !ORACLE_NAME.test(seed.oracle)) bad(`oracle must be a bare *.test.js file name in ${ORACLE_DIR}/`);
  if (!editablePath(seed.file)) bad('file must be a target source path outside test/ and answer-key material');
  tellWords(seed.find, seed.replace, where, problems);
  if (seed.base !== null) {
    const change = changes.get(seed.base);
    if (!change) bad(`base ${seed.base} is not a known change`);
    else if (change.kind !== 'review') bad(`base ${seed.base} must be a review change`);
    else if (nonEmpty(seed.find) && !change.edits.some((e) => e.file === seed.file && e.replace.includes(seed.find) && !(e.find ?? '').includes(seed.find))) {
      bad(`find must sit inside text that change ${seed.base} adds to ${seed.file}`);
    }
  }
  return ok;
}

/** Validate the matrix shape; returns the parsed matrix or null. */
export function checkMatrix(matrix, problems) {
  if (!exactKeys(matrix, MATRIX_KEYS, 'matrix', problems)) return null;
  if (matrix.version !== 1) problems.push('matrix: version must be 1');
  for (const k of ['skills', 'targets', 'tasks']) {
    if (!Array.isArray(matrix[k])) { problems.push(`matrix: ${k} must be an array`); return null; }
  }
  const skillIds = matrix.skills.map((s) => s?.id);
  matrix.skills.forEach((s, i) => {
    const where = `skills[${i}]`;
    if (!exactKeys(s, SKILL_KEYS, where, problems)) return;
    if (!SKILLS.includes(s.id)) problems.push(`${where}: unknown skill ${s.id}`);
    if (!METRICS.includes(s.metric)) problems.push(`${where}: metric must be one of ${METRICS.join(', ')}`);
    if (typeof s.minDelta !== 'number' || !(s.minDelta > 0 && s.minDelta < 1)) problems.push(`${where}: minDelta must be in (0, 1)`);
    if (!Number.isInteger(s.tasks) || s.tasks < 1) problems.push(`${where}: tasks must be a positive integer`);
  });
  for (const id of SKILLS) if (skillIds.filter((x) => x === id).length !== 1) problems.push(`skills: ${id} must appear exactly once`);
  const targetNames = new Set();
  matrix.targets.forEach((t, i) => {
    const where = `targets[${i}]`;
    if (!exactKeys(t, TARGET_KEYS, where, problems)) return;
    if (!ID.test(String(t.name))) problems.push(`${where}: name must be lowercase kebab-case`);
    if (targetNames.has(t.name)) problems.push(`${where}: duplicate target ${t.name}`);
    targetNames.add(t.name);
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(String(t.upstream))) problems.push(`${where}: upstream must be a GitHub repository URL`);
    if (!/^[0-9a-f]{40}$/.test(String(t.commit))) problems.push(`${where}: commit must be a full 40-character SHA`);
    if (!nonEmpty(t.license)) problems.push(`${where}: license must be named`);
    if (!/^sha256:[0-9a-f]{64}$/.test(String(t.treeDigest))) problems.push(`${where}: treeDigest must be sha256:<64 hex>`);
  });
  checkTaskShapes(matrix.tasks, matrix.skills, targetNames, problems);
  return matrix;
}

/** Validate task records against the declared skills and targets. */
function checkTaskShapes(tasks, skills, targetNames, problems) {
  const taskIds = new Set();
  tasks.forEach((t, i) => {
    const where = `tasks[${i}]${nonEmpty(t?.id) ? ` ${t.id}` : ''}`;
    if (!exactKeys(t, TASK_KEYS, where, problems)) return;
    if (!ID.test(String(t.id))) problems.push(`${where}: id must be lowercase kebab-case`);
    if (taskIds.has(t.id)) problems.push(`${where}: duplicate task ${t.id}`);
    taskIds.add(t.id);
    if (!SKILLS.includes(t.skill)) problems.push(`${where}: unknown skill ${t.skill}`);
    if (!targetNames.has(t.target)) problems.push(`${where}: unknown target ${t.target}`);
    if (!nonEmpty(t.statement)) problems.push(`${where}: statement must be non-empty`);
    if (!Array.isArray(t.seeds) || t.seeds.some((x) => !nonEmpty(x))) problems.push(`${where}: seeds must be an array of seed ids`);
    if (t.change !== null && !nonEmpty(t.change)) problems.push(`${where}: change must be a change id or null`);
    if (t.acceptance !== null && !(nonEmpty(t.acceptance) && ORACLE_NAME.test(t.acceptance))) {
      problems.push(`${where}: acceptance must be a bare *.test.js file name or null`);
    }
    const needs = {
      'rigor:deep-review': t.change !== null && t.acceptance === null,
      'code-ops-suite:ship': t.change !== null && t.acceptance !== null && Array.isArray(t.seeds) && t.seeds.length === 0,
    }[t.skill] ?? (t.change === null && t.acceptance === null && Array.isArray(t.seeds) && t.seeds.length > 0);
    if (!needs) {
      problems.push(`${where}: ${t.skill} task shape is wrong (deep-review: a review change; ship: a reference change, an acceptance test, and no seeds; others: seeds and no change or acceptance)`);
    }
  });
  for (const s of skills) {
    const n = tasks.filter((t) => t?.skill === s?.id).length;
    if (isObj(s) && n > s.tasks) problems.push(`skills: ${s.id} has ${n} tasks, more than the ${s.tasks} declared`);
  }
}

/** Check one target and its answer-key material; appends to problems, logs progress lines. */
export async function checkTarget(target, tasks, targetDir, problems, { log = () => {}, group = null } = {}) {
  if (!existsSync(targetDir)) { problems.push(`target ${target.name}: ${targetDir} does not exist`); return; }
  for (const f of ['LICENSE', 'PROVENANCE.md', 'package.json']) {
    if (!existsSync(join(targetDir, f))) problems.push(`target ${target.name}: missing ${f}`);
  }
  const digest = treeDigest(targetDir);
  if (digest !== target.treeDigest) problems.push(`target ${target.name}: tree digest is ${digest}, matrix records ${target.treeDigest}`);

  const pristine = pristineCopy(targetDir);
  const base = await runTests(pristine, [VISIBLE_TESTS]);
  rmSync(pristine, { recursive: true, force: true });
  if (!base.ok) { problems.push(`target ${target.name}: visible suite fails on the pristine tree\n${base.out}`); return; }
  log(`target ${target.name}: pristine visible suite passes`);

  // Load and shape-check changes, then seeds. A group run loads only its own seed file and
  // reports change problems only for the changes its seeds and tasks name, so parallel
  // authors of other groups cannot fail it.
  const changes = new Map();
  const changeProblems = new Map();
  for (const { name, data, error } of loadDir(targetDir, CHANGES_DIR)) {
    const own = error ? [error] : [];
    if (!error && checkChangeShape(data, name, own)) changes.set(name, data);
    changeProblems.set(name, own);
  }
  const ownTaskList = tasks.filter((t) => t.target === target.name);
  const seeds = new Map();
  const groupOf = new Map();
  const usable = new Set();
  const seedFiles = loadDir(targetDir, SEEDS_DIR).filter((f) => group === null || f.name === group);
  if (group !== null && !seedFiles.length) problems.push(`group ${group}: ${SEEDS_DIR}/${group}.json does not exist`);
  const named = new Set(ownTaskList.map((t) => t.change).filter(Boolean));
  for (const { data } of seedFiles) if (Array.isArray(data)) for (const s of data) if (nonEmpty(s?.base)) named.add(s.base);
  for (const [name, list] of changeProblems) if (group === null || named.has(name)) problems.push(...list);
  for (const { name, data, error } of seedFiles) {
    if (error) { problems.push(error); continue; }
    if (!Array.isArray(data)) { problems.push(`${SEEDS_DIR}/${name}.json: must be an array`); continue; }
    data.forEach((s, i) => {
      if (nonEmpty(s?.id) && seeds.has(s.id)) problems.push(`seed ${s.id}: duplicate id`);
      if (checkSeedShape(s, i, name, changes, problems)) usable.add(s.id);
      if (nonEmpty(s?.id)) { seeds.set(s.id, s); groupOf.set(s.id, name); }
    });
  }
  for (const s of seeds.values()) {
    if (usable.has(s.id) && !existsSync(join(targetDir, ORACLE_DIR, s.oracle))) {
      problems.push(`seed ${s.id}: oracle ${ORACLE_DIR}/${s.oracle} does not exist`);
      usable.delete(s.id);
    }
  }

  const ownTasks = tasks.filter((t) => t.target === target.name);
  const inScope = (id) => group === null || groupOf.get(id) === group;
  const scopedTasks = group === null ? ownTasks : ownTasks.filter((t) => t.seeds.some(inScope) || (t.seeds.length === 0 && t.change !== null));
  const neededChanges = new Set([
    ...[...seeds.values()].filter((s) => inScope(s.id) && s.base !== null).map((s) => s.base),
    ...scopedTasks.map((t) => t.change).filter(Boolean),
  ]);
  if (group === null) for (const id of changes.keys()) neededChanges.add(id);

  const jobs = [];
  const lines = new Map();

  // Each change leaves the visible suite green.
  for (const id of neededChanges) {
    const change = changes.get(id);
    if (!change) continue;
    jobs.push(async () => {
      const b = baseCopy(targetDir, change);
      if (b.problem) { problems.push(b.problem); return; }
      try {
        const visible = await runTests(b.dir, [VISIBLE_TESTS]);
        if (!visible.ok) problems.push(`change ${id}: visible suite fails with the change applied\n${visible.out}`);
        else log(`change ${id}: proved`);
      } finally { rmSync(b.dir, { recursive: true, force: true }); }
    });
  }

  // Each seed: unique find on its base, oracle green on the base, the seed's effect, visible green.
  for (const s of seeds.values()) {
    if (!usable.has(s.id) || !inScope(s.id)) continue;
    jobs.push(async () => {
      const b = baseCopy(targetDir, s.base === null ? null : changes.get(s.base));
      if (b.problem) { problems.push(`seed ${s.id}: ${b.problem}`); return; }
      try {
        const path = native(b.dir, s.file);
        if (!existsSync(path)) { problems.push(`seed ${s.id}: file ${s.file} does not exist`); return; }
        const text = readFileSync(path, 'utf8');
        const n = countOf(text, s.find);
        if (n !== 1) { problems.push(`seed ${s.id}: find occurs ${n} times in ${s.file}, expected exactly 1`); return; }
        lines.set(s.id, lineOf(text, text.indexOf(s.find)));
        const clean = await runOracle(targetDir, b.dir, s.oracle);
        if (!clean.ok) { problems.push(`seed ${s.id}: oracle fails on the seed's base\n${clean.out}`); return; }
        rmSync(join(b.dir, 'oracle'), { recursive: true, force: true });
        applyEdits(b.dir, [s], `seed ${s.id}`);
        const [visible, oracle] = await Promise.all([runTests(b.dir, [VISIBLE_TESTS]), runOracle(targetDir, b.dir, s.oracle)]);
        if (!visible.ok) problems.push(`seed ${s.id}: visible suite fails with the seed applied\n${visible.out}`);
        if (s.kind === 'defect' && oracle.ok) problems.push(`seed ${s.id}: defect seed passes its oracle`);
        if (s.kind === 'decoy' && !oracle.ok) problems.push(`seed ${s.id}: decoy seed fails its oracle\n${oracle.out}`);
        log(`seed ${s.id}: proved`);
      } finally { rmSync(b.dir, { recursive: true, force: true }); }
    });
  }
  await pool(jobs);

  // Each task: shape against its skill, spacing, seeds together on the base, ship acceptance.
  const taskJobs = [];
  for (const t of scopedTasks) {
    const missing = t.seeds.filter((id) => !seeds.has(id));
    if (missing.length) { problems.push(`task ${t.id}: unknown seeds ${missing.join(', ')}`); continue; }
    if (new Set(t.seeds).size !== t.seeds.length) problems.push(`task ${t.id}: repeats a seed`);
    const set = t.seeds.map((id) => seeds.get(id));
    const change = t.change === null ? null : changes.get(t.change);
    if (t.change !== null && !change) { problems.push(`task ${t.id}: unknown change ${t.change}`); continue; }
    if (t.skill === 'rigor:deep-review') {
      if (change.kind !== 'review') problems.push(`task ${t.id}: change ${t.change} must be a review change`);
      for (const s of set) if (s.base !== t.change) problems.push(`task ${t.id}: seed ${s.id} must have base ${t.change}`);
    } else {
      for (const s of set) if (s.base !== null) problems.push(`task ${t.id}: seed ${s.id} must have a null base`);
    }
    if (t.skill === 'code-ops-suite:debug') {
      if (set.length !== 1 || set[0].kind !== 'defect' || !nonEmpty(set[0].symptom)) {
        problems.push(`task ${t.id}: a debug task holds exactly one defect seed with a symptom`);
      }
    }
    if (t.skill === 'code-ops-suite:ship') {
      if (change.kind !== 'reference') problems.push(`task ${t.id}: change ${t.change} must be a reference change`);
      if (!existsSync(join(targetDir, ORACLE_DIR, t.acceptance))) {
        problems.push(`task ${t.id}: acceptance ${ORACLE_DIR}/${t.acceptance} does not exist`);
        continue;
      }
      taskJobs.push(async () => {
        const pristineDir = pristineCopy(targetDir);
        const b = baseCopy(targetDir, change);
        try {
          if (b.problem) { problems.push(`task ${t.id}: ${b.problem}`); return; }
          const [before, after] = await Promise.all([
            runOracle(targetDir, pristineDir, t.acceptance),
            runOracle(targetDir, b.dir, t.acceptance),
          ]);
          if (before.ok) problems.push(`task ${t.id}: acceptance test passes on the pristine tree`);
          if (!after.ok) problems.push(`task ${t.id}: acceptance test fails with the reference change\n${after.out}`);
          if (!before.ok && after.ok) log(`task ${t.id}: acceptance proved`);
        } finally {
          rmSync(pristineDir, { recursive: true, force: true });
          if (b.dir) rmSync(b.dir, { recursive: true, force: true });
        }
      });
      continue;
    }
    for (let a = 0; a < set.length; a++) {
      for (let c = a + 1; c < set.length; c++) {
        const [x, y] = [set[a], set[c]];
        if (x.file === y.file && lines.has(x.id) && lines.has(y.id) && Math.abs(lines.get(x.id) - lines.get(y.id)) < MIN_SEED_GAP) {
          problems.push(`task ${t.id}: seeds ${x.id} and ${y.id} are closer than ${MIN_SEED_GAP} lines in ${x.file}`);
        }
      }
    }
    if (!set.length || !set.every((s) => lines.has(s.id))) continue;
    taskJobs.push(async () => {
      const b = baseCopy(targetDir, change);
      if (b.problem) { problems.push(`task ${t.id}: ${b.problem}`); return; }
      try {
        const clash = applyEdits(b.dir, set, `task ${t.id}`);
        if (clash) { problems.push(clash); return; }
        const visible = await runTests(b.dir, [VISIBLE_TESTS]);
        if (!visible.ok) problems.push(`task ${t.id}: visible suite fails with all its seeds applied\n${visible.out}`);
        else log(`task ${t.id}: seed set proved`);
      } finally { rmSync(b.dir, { recursive: true, force: true }); }
    });
  }
  await pool(taskJobs);
  if (group === null && seedFiles.length === 0) log(`target ${target.name}: 0 seeds`);
}

/** Run every check for the bench rooted at benchDir; resolves the problem list. */
export async function checkBench(benchDir = HERE, { log = () => {}, group = null, tasksFile = null } = {}) {
  const problems = [];
  let matrix;
  try { matrix = JSON.parse(readFileSync(join(benchDir, 'bench-matrix.json'), 'utf8')); } catch (e) {
    return [`bench-matrix.json: ${e.message}`];
  }
  if (!checkMatrix(matrix, problems) || problems.length) return problems;
  let tasks = matrix.tasks;
  if (tasksFile !== null) {
    try { tasks = JSON.parse(readFileSync(tasksFile, 'utf8')); } catch (e) { return [`--tasks ${tasksFile}: ${e.message}`]; }
    if (!Array.isArray(tasks)) return [`--tasks ${tasksFile}: must be a JSON array`];
    checkTaskShapes(tasks, matrix.skills, new Set(matrix.targets.map((t) => t.name)), problems);
    if (problems.length) return problems;
  }
  for (const target of matrix.targets) {
    await checkTarget(target, tasks, join(benchDir, 'targets', target.name), problems, { log, group });
  }
  return problems;
}

/** Parse --flag value pairs (and bare boolean flags) for the model-in-the-loop verbs. */
function parseFlags(rest, booleans) {
  const out = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith('--')) return null;
    if (booleans.includes(k)) { out[k.slice(2)] = true; continue; }
    if (!nonEmpty(rest[i + 1])) return null;
    out[k.slice(2)] = rest[++i];
  }
  return out;
}

/** The plan, run, score, and report verbs. */
async function modelVerb(verb, rest) {
  const f = parseFlags(rest, ['--pilot']);
  if (!f || !nonEmpty(f.run)) {
    console.error(`usage: node evals/bench/bench.mjs ${verb} --run <dir> ...  (see the header comment)`);
    return 2;
  }
  const runDir = resolve(f.run);
  if (verb === 'plan') {
    const { planBench } = await import('./lib/runner.mjs');
    const plan = planBench({
      runDir, pilot: Boolean(f.pilot), reps: Number(f.reps ?? (f.pilot ? 1 : 4)), target: f.target, taskIds: f.tasks, model: f.model ?? 'claude-opus-5-5',
      capUsd: Number(f['cap-usd'] ?? 5), timeoutMs: Number(f['timeout-min'] ?? 60) * 60_000,
      isolation: f.isolation ?? 'config-dir', permissionMode: f['permission-mode'] ?? 'bypassPermissions',
    });
    console.log(`plan: ${plan.units.length} units, cap ${plan.capUsd} each, ${runDir}`);
    return 0;
  }
  if (verb === 'run') {
    const { runBench } = await import('./lib/runner.mjs');
    const r = await runBench({ runDir, limit: f.limit ? Number(f.limit) : Infinity });
    console.log(`run: ${r.ran} unit(s) ran${r.stopped ? `; stopped: ${r.stopped}` : ''}`);
    return r.stopped ? 1 : 0;
  }
  const { scoreRun, reportRun } = await import('./lib/report-run.mjs');
  if (verb === 'score') { console.log(scoreRun({ runDir, benchDir: HERE })); return 0; }
  console.log(reportRun({ runDir, benchDir: HERE }));
  return 0;
}

async function main(argv) {
  const [verb, ...rest] = argv;
  if (['plan', 'run', 'score', 'report'].includes(verb)) return modelVerb(verb, rest);
  const opts = { log: (line) => console.log(`ok   ${line}`), group: null, tasksFile: null };
  let bad = verb !== 'check';
  for (let i = 0; i < rest.length && !bad; i += 2) {
    const value = rest[i + 1];
    if (!nonEmpty(value)) bad = true;
    else if (rest[i] === '--group' && ID.test(value)) opts.group = value;
    else if (rest[i] === '--tasks') opts.tasksFile = resolve(value);
    else bad = true;
  }
  if (bad) {
    console.error('usage: node evals/bench/bench.mjs check [--group <name>] [--tasks <file>] | plan | run | score | report');
    return 2;
  }
  const problems = await checkBench(HERE, opts);
  for (const p of problems) console.error(`FAIL ${p}`);
  console.log(problems.length ? `bench check: ${problems.length} problem(s)` : 'bench check: OK');
  return problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // No top-level await: lib/ modules import this file, and a pending top-level await here would
  // deadlock the dynamic import of lib/runner.mjs by the plan and run verbs.
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 1; });
}
