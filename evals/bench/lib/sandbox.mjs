// Sandbox, derived answer key, and post-run oracle checks for the beat-the-bare-model benchmark
// (design: code-ops-docs/10 Design/Beat the bare model benchmark 2026-10.md; shapes:
// code-ops-docs/80 Runs/2026-10-14-bench-design/units/STEP4_SHAPES.md).
//
//   deriveKey     the answer key for one task, computed from the seeds and the target (no model).
//   materialize   a fresh Git repository under the OS temp directory that holds what the agent sees.
//   afterRun      the hidden oracles and the visible suite, run after the agent process exits.
//
// Copied from bench.mjs, which does not export them: copyFile, childEnv, runTests (here with a TAP
// failure count), countOf, lineOf, native, and the edit-apply rule of applyEdits.

import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { listTargetFiles } from '../bench.mjs';

const ORACLE_DIR = 'ANSWER_KEY.oracles';
const LINE_TOLERANCE = 3;
const FIXED_DATE = '2026-01-01T00:00:00Z';
const FIXED_WHO = { name: 'Bench', email: 'bench@example.invalid' };
// Target files the agent must not see: they name the upstream project.
const WITHHELD = new Set(['PROVENANCE.md']);
// The sandbox file that carries the exit contract, so that plugin subagents load it too.
export const CONTRACT_FILE = 'CLAUDE.md';
// Agent instruction files a vendored target must not ship: they would replace or add to the contract.
const AGENT_FILES = /^(?:CLAUDE\.md$|AGENTS\.md$|\.claude\/|\.cursorrules$|\.github\/copilot-instructions\.md$)/;

const countOf = (text, needle) => (needle ? text.split(needle).length - 1 : 0);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const native = (dir, rel) => join(dir, ...rel.split('/'));
const asList = (v) => (Array.isArray(v) ? v : v ? Object.values(v) : []);

function copyFile(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

// The only variables a child process inherits; the rest of the parent's environment may hold
// credentials or the repository path. Compared case-insensitively (Windows spells Path, PATH).
const ENV_ALLOW = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES', 'SYSTEMDRIVE']);

let scratchHome = null;
/** An empty directory that stands in for the home directory. Removed at process exit. */
function homeDir() {
  if (scratchHome) return scratchHome;
  const dir = mkdtempSync(join(tmpdir(), 'bench-home-'));
  scratchHome = dir;
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function childEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (ENV_ALLOW.has(k.toUpperCase())) env[k] = v;
  env.HOME = homeDir();
  env.USERPROFILE = env.HOME;
  return env;
}

/** A fresh 32-hex canary. */
export const newCanary = () => randomBytes(16).toString('hex');

/** JSON with sorted object keys, 2-space indent, and a trailing newline. */
export function stableJson(obj) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    return v;
  };
  return `${JSON.stringify(sort(obj), null, 2)}\n`;
}

/**
 * Apply the review change, then the seeds, in memory. Returns the touched files' final text and the
 * seed positions. A file not in `files` is untouched. Throws when a find does not occur exactly once.
 */
function compose({ task, seeds, changes, targetDir }) {
  const files = new Map();
  const read = (rel) => {
    if (files.has(rel)) return files.get(rel);
    const path = native(targetDir, rel);
    if (!existsSync(path)) throw new Error(`${task.id}: ${rel} does not exist`);
    return readFileSync(path, 'utf8');
  };
  const byId = (list) => new Map(asList(list).map((x) => [x.id, x]));
  const seedById = byId(seeds);
  const change = task.skill === 'rigor:deep-review' && task.change
    ? byId(changes).get(task.change) : null;
  if (task.skill === 'rigor:deep-review' && !change) throw new Error(`${task.id}: review change ${task.change} not supplied`);
  const ordered = (task.seeds ?? []).map((id) => {
    const s = seedById.get(id);
    if (!s) throw new Error(`${task.id}: seed ${id} not supplied`);
    return s;
  });
  for (const e of change?.edits ?? []) {
    if (e.find === null) {
      if (files.has(e.file) || existsSync(native(targetDir, e.file))) throw new Error(`${task.id}: change creates ${e.file}, which exists`);
      files.set(e.file, e.replace);
      continue;
    }
    const text = read(e.file);
    if (countOf(text, e.find) !== 1) throw new Error(`${task.id}: change find occurs ${countOf(text, e.find)} times in ${e.file}`);
    files.set(e.file, text.replace(e.find, () => e.replace));
  }
  const marks = [];
  for (const s of ordered) {
    if (s.base && s.base !== change?.id) throw new Error(`${task.id}: seed ${s.id} is based on ${s.base}, which this task does not apply`);
    const text = read(s.file);
    if (countOf(text, s.find) !== 1) throw new Error(`${task.id}: seed ${s.id} find occurs ${countOf(text, s.find)} times in ${s.file}`);
    const at = text.indexOf(s.find);
    const delta = s.replace.length - s.find.length;
    for (const m of marks) {
      if (m.file !== s.file) continue;
      if (m.pos >= at && m.pos < at + s.find.length) throw new Error(`${task.id}: seeds ${m.seed.id} and ${s.id} overlap`);
      if (m.pos > at) m.pos += delta;
    }
    marks.push({ seed: s, file: s.file, pos: at });
    files.set(s.file, text.slice(0, at) + s.replace + text.slice(at + s.find.length));
  }
  return { files, marks, change };
}

/** The 1-based line and anchor of one seed in its file's final text. */
function locate(text, mark) {
  const { seed, pos } = mark;
  let at = pos;
  if (seed.replace.trim() !== '') {
    // Start at the first non-blank line of the replace text.
    const lead = seed.replace.length - seed.replace.replace(/^(?:[ \t\r]*\n)+/, '').length;
    at = pos + lead;
  } else {
    // A deleted snippet: the line that now holds the text that followed it, skipping blank lines.
    const rest = text.slice(at);
    const blank = rest.match(/^(?:[ \t\r]*\n)+/);
    if (rest.split('\n')[0].trim() === '' && blank) at += blank[0].length;
  }
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const end = text.indexOf('\n', at);
  const anchor = text.slice(start, end === -1 ? text.length : end).trim();
  if (anchor === '') throw new Error(`${seed.id}: no text at the seed position`);
  return { line: lineOf(text, at), anchor };
}

/** The derived answer key for one task; serialize it with stableJson. */
export function deriveKey({ task, seeds, changes, targetDir, canary }) {
  const { files, marks } = compose({ task, seeds, changes, targetDir });
  const entries = marks.map((m) => {
    const { line, anchor } = locate(files.get(m.file), m);
    return { id: m.seed.id, kind: m.seed.kind, class: m.seed.class, file: m.file, line, anchor, oracle: m.seed.oracle };
  });
  let oracles = [];
  if (task.skill === 'code-ops-suite:debug') oracles = [...new Set(marks.map((m) => m.seed.oracle))].sort();
  else if (task.skill === 'code-ops-suite:ship') oracles = [].concat(task.acceptance ?? []).sort();
  return {
    task: task.id,
    skill: task.skill,
    canary,
    lineTolerance: LINE_TOLERANCE,
    entries,
    oracles,
    cleanChange: task.skill === 'rigor:deep-review' && !marks.some((m) => m.seed.kind === 'defect'),
  };
}

let emptyConfig = null;
/** An empty file that Git reads as the global and system config. Removed at process exit. */
function gitConfigPath() {
  if (emptyConfig) return emptyConfig;
  const dir = mkdtempSync(join(tmpdir(), 'bench-gitcfg-'));
  emptyConfig = join(dir, 'empty.gitconfig');
  writeFileSync(emptyConfig, '');
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  return emptyConfig;
}

/** Run git in dir with fixed identity and no user or system config; returns stdout. */
function git(dir, args) {
  const cfg = gitConfigPath();
  const env = {
    ...childEnv(),
    GIT_CONFIG_GLOBAL: cfg,
    GIT_CONFIG_SYSTEM: cfg,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: FIXED_WHO.name,
    GIT_AUTHOR_EMAIL: FIXED_WHO.email,
    GIT_AUTHOR_DATE: FIXED_DATE,
    GIT_COMMITTER_NAME: FIXED_WHO.name,
    GIT_COMMITTER_EMAIL: FIXED_WHO.email,
    GIT_COMMITTER_DATE: FIXED_DATE,
    GIT_TERMINAL_PROMPT: '0',
  };
  return execFileSync('git', args, { cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}

function commit(dest, message) {
  git(dest, ['add', '-A']);
  git(dest, ['-c', 'commit.gpgsign=false', 'commit', '--no-verify', '--allow-empty-message', '-m', message]);
}

/**
 * Build the sandbox at dest (a fresh directory under the OS temp directory) and return
 * { dest, head, commits }. No oracle file, answer-key path, PROVENANCE.md, id, or seed text but the
 * seeded source itself enters it. When contract is given, it is written as CLAUDE.md and committed in
 * the initial import, so it is never part of a review change or of the agent's own commit.
 */
export function materialize({ task, seeds, changes, targetDir, dest, contract }) {
  const { files, change } = compose({ task, seeds, changes, targetDir });
  const listed = listTargetFiles(targetDir);
  const agentFile = listed.find((rel) => AGENT_FILES.test(rel));
  if (agentFile) throw new Error(`${task.id}: the target ships an agent instruction file, ${agentFile}`);
  mkdirSync(dest, { recursive: true });
  for (const rel of listed) {
    if (!WITHHELD.has(rel)) copyFile(native(targetDir, rel), native(dest, rel));
  }
  if (contract !== undefined) writeFileSync(native(dest, CONTRACT_FILE), `${contract.trim()}\n`);
  git(dest, ['init', '-q', '-b', 'main']);
  git(dest, ['config', 'core.autocrlf', 'false']);
  git(dest, ['config', 'core.safecrlf', 'false']);
  const write = () => { for (const [rel, text] of files) { mkdirSync(dirname(native(dest, rel)), { recursive: true }); writeFileSync(native(dest, rel), text); } };
  if (task.skill === 'rigor:deep-review') {
    commit(dest, 'Initial import');
    write();
    commit(dest, change.message);
  } else {
    // Ship has no seeds, so `files` is empty and the one commit is the pristine target.
    write();
    commit(dest, 'Initial import');
  }
  return { dest, head: git(dest, ['rev-parse', 'HEAD']).trim(), commits: Number(git(dest, ['rev-list', '--count', 'HEAD']).trim()) };
}

/** Run node --test on patterns in dir; resolves { ok, failures } using the TAP summary. */
function runTests(dir, patterns) {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', ...patterns], { cwd: dir, env: childEnv(), windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 120_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const counted = out.match(/^# fail (\d+)/m);
      // A crash or timeout prints no summary; count it as one failure.
      done({ ok: code === 0, failures: counted ? Number(counted[1]) : code === 0 ? 0 : 1 });
    });
  });
}

/** Run the task's hidden oracles and the visible suite in dest, after the agent has exited. */
export async function afterRun({ derivedKey, targetDir, dest }) {
  const headCommits = Number(git(dest, ['rev-list', '--count', 'HEAD']).trim());
  const oracles = {};
  for (const file of derivedKey.oracles) copyFile(join(targetDir, ORACLE_DIR, file), join(dest, 'oracle', file));
  const results = await Promise.all(derivedKey.oracles.map((file) => runTests(dest, [`oracle/${file}`])));
  derivedKey.oracles.forEach((file, i) => { oracles[file] = results[i].ok; });
  // The visible suite is the target's own test files, restored to their pristine bytes, so a
  // failing repro test the agent added or a test it weakened never moves the count.
  const visibleFiles = listTargetFiles(targetDir).filter((rel) => /^test\/.*\.test\.js$/.test(rel));
  for (const rel of visibleFiles) copyFile(native(targetDir, rel), native(dest, rel));
  const visible = visibleFiles.length ? await runTests(dest, visibleFiles) : { failures: 0 };
  return { oracles, visibleFailures: visible.failures, headCommits };
}
