// Bench plan and run verbs (design: code-ops-docs/10 Design/Beat the bare model benchmark 2026-10.md,
// sections "What the arms compare", "Answer-key isolation", "Cost and time", and "Harness").
//
// plan binds every input a snapshot depends on and writes the derived answer keys and the canary
// into the run folder. run spawns one `claude -p` process per unit in a fresh sandbox under the OS
// temp directory, audits the transcripts, and writes one result file per unit, so an interrupted
// run resumes where it stopped. The run folder lives under code-ops-docs/80 Runs/ and never enters
// a sandbox.

import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeDigest } from '../bench.mjs';
import { afterRun, deriveKey, materialize, newCanary, stableJson } from './sandbox.mjs';
import { auditUnit } from './audit.mjs';
import { resolveProof } from './score.mjs';

const BENCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(BENCH_DIR, '..', '..');
export const PLAN_VERSION = 1;
export const ARMS = ['skill', 'control'];
const HOME = homedir();
if (!HOME) throw new Error('bench runner: os.homedir() is empty, so the key file location is unknown');
const KEY_FILE = join(HOME, '.bench-key');
// Optional: the workspace for an organization-level key, sent as the anthropic-workspace-id header.
const WORKSPACE_FILE = join(HOME, '.bench-workspace');

/** The anthropic-workspace-id header line, or null when no workspace file exists. */
export function workspaceHeader(file = WORKSPACE_FILE) {
  if (!existsSync(file)) return null;
  const id = readFileSync(file, 'utf8').trim();
  if (!/^wrkspc_[A-Za-z0-9]+$/.test(id)) throw new Error(`${file} must hold one workspace id (wrkspc_...)`);
  return `anthropic-workspace-id: ${id}`;
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const fileDigest = (path) => `sha256:${sha256(readFileSync(path))}`;

/** Digest over every answer-key file of a target (seeds, changes, oracles). */
export function answerKeyDigest(targetDir) {
  const lines = [];
  for (const sub of readdirSync(targetDir).filter((n) => n.startsWith('ANSWER_KEY.')).sort()) {
    for (const f of readdirSync(join(targetDir, sub)).sort()) lines.push(`${sub}/${f}\0${sha256(readFileSync(join(targetDir, sub, f)))}\n`);
  }
  return `sha256:${sha256(lines.join(''))}`;
}

/** The text of one `## <name>` section of EXIT_CONTRACT.md. */
export function contractSection(text, name) {
  const m = text.split(/^## /m).find((s) => s.startsWith(`${name}\n`));
  if (!m) throw new Error(`EXIT_CONTRACT.md has no "## ${name}" section`);
  return m.slice(name.length + 1).trim();
}

/** Plugin directory name for a skill id such as rigor:bug-hunt. */
export const pluginOf = (skill) => skill.split(':')[0];

/** Fixed alternating order: arms swap first place on each task and each rep. */
export function unitOrder(taskIds, reps) {
  const units = [];
  for (let rep = 1; rep <= reps; rep++) {
    taskIds.forEach((task, i) => {
      const arms = (rep + i) % 2 ? ARMS : [...ARMS].reverse();
      for (const arm of arms) units.push({ id: `${task}.${arm}.r${rep}`, task, arm, rep });
    });
  }
  return units;
}

/** Load the bench inputs the plan binds. */
export function loadBench(benchDir) {
  const matrixPath = join(benchDir, 'bench-matrix.json');
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  const targets = Object.fromEntries(matrix.targets.map((t) => [t.name, join(benchDir, 'targets', t.name)]));
  const answerKey = (targetDir) => {
    const read = (sub) => {
      const dir = join(targetDir, sub);
      return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))) : [];
    };
    return { seeds: read('ANSWER_KEY.seeds').flat(), changes: read('ANSWER_KEY.changes') };
  };
  return { matrixPath, matrix, targets, answerKey };
}

/** Every bound input, recomputed from the current tree. */
export function bindings({ benchDir = BENCH_DIR, repoRoot = REPO_ROOT, matrix, targets, model, host }) {
  const skills = [...new Set(matrix.tasks.map((t) => t.skill))].sort();
  return {
    head: git(repoRoot, ['rev-parse', 'HEAD']),
    matrixDigest: fileDigest(join(benchDir, 'bench-matrix.json')),
    exitContractDigest: fileDigest(join(benchDir, 'EXIT_CONTRACT.md')),
    targetDigests: Object.fromEntries(Object.entries(targets).map(([n, d]) => [n, treeDigest(d)])),
    answerKeyDigests: Object.fromEntries(Object.entries(targets).map(([n, d]) => [n, answerKeyDigest(d)])),
    pluginDigests: Object.fromEntries([...new Set(skills.map(pluginOf))].map((p) => [p, treeDigest(join(repoRoot, 'plugins', p))])),
    model,
    host,
  };
}

// A unit's diff can be large (a generated file); the default 1 MiB buffer would throw mid-run.
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }).trim();

/** Resolve the claude executable; Windows shims need the where.exe probe (scripts/preflight.mjs:51). */
export function claudeBin() {
  if (process.platform !== 'win32') return 'claude';
  return execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).find((l) => /\.(exe|cmd)$/i.test(l.trim())).trim();
}

/**
 * The matrix tasks a plan covers: all of them, narrowed to the named target and to the listed
 * task ids (comma-separated) when given. An unknown name or id is refused, not ignored.
 */
export function planTasks(matrix, target, taskIds) {
  let tasks = matrix.tasks;
  if (target !== undefined) {
    if (!matrix.targets.some((t) => t.name === target)) throw new Error(`--target ${target}: not a matrix target`);
    tasks = tasks.filter((t) => t.target === target);
  }
  if (taskIds !== undefined) {
    const ids = taskIds.split(',').map((s) => s.trim()).filter(Boolean);
    const missing = ids.filter((id) => !tasks.some((t) => t.id === id));
    if (!ids.length || missing.length) throw new Error(`--tasks: not a planned matrix task: ${missing.join(', ') || '(none given)'}`);
    tasks = tasks.filter((t) => ids.includes(t.id));
  }
  return tasks;
}

/**
 * Refuse a run folder inside the repo that git does not ignore: it holds the derived answer keys
 * and the canary, which must never be committable. A folder outside the repo is allowed.
 */
export function assertRunDirIgnored(runDir, repoRoot = REPO_ROOT) {
  const rel = relative(repoRoot, resolve(runDir));
  if (rel.startsWith('..') || isAbsolute(rel)) return;
  try {
    execFileSync('git', ['check-ignore', '-q', '--', join(resolve(runDir), 'plan.json')], { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    throw new Error(`${runDir} is inside the repo and not git-ignored; use a folder under code-ops-docs/80 Runs/ or outside the repo`);
  }
}

/** Write plan.json, the derived keys, and the canary into runDir. */
export function planBench({ runDir, model, reps, pilot, target, taskIds, capUsd, timeoutMs, isolation, permissionMode, benchDir = BENCH_DIR }) {
  if (existsSync(join(runDir, 'plan.json'))) throw new Error(`${runDir} already holds a plan; use a new run folder`);
  assertRunDirIgnored(runDir);
  const { matrix, targets, answerKey } = loadBench(benchDir);
  const tasks = planTasks(matrix, target, taskIds);
  const host = execFileSync(claudeBin(), ['--version'], { encoding: 'utf8' }).trim();
  const canary = newCanary();
  mkdirSync(join(runDir, 'keys'), { recursive: true });
  for (const task of tasks) {
    const { seeds, changes } = answerKey(targets[task.target]);
    const key = deriveKey({ task, seeds, changes, targetDir: targets[task.target], canary });
    writeFileSync(join(runDir, 'keys', `${task.id}.json`), stableJson(key));
  }
  writeFileSync(join(runDir, 'canary.txt'), `${canary}\n`);
  const plan = {
    version: PLAN_VERSION,
    pilot: Boolean(pilot),
    reps,
    target: target ?? null,
    tasks: taskIds ?? null,
    capUsd,
    timeoutMs,
    isolation,
    permissionMode,
    mcp: 'none (--strict-mcp-config with an empty server list in both arms)',
    bound: { ...bindings({ benchDir, matrix, targets, model, host }), canaryDigest: `sha256:${sha256(canary)}`, keysDigest: keysDigest(runDir) },
    units: unitOrder(tasks.map((t) => t.id), reps),
  };
  writeFileSync(join(runDir, 'plan.json'), stableJson(plan));
  return plan;
}

/** Digest over the derived keys in runDir/keys. */
function keysDigest(runDir) {
  const dir = join(runDir, 'keys');
  return `sha256:${sha256(readdirSync(dir).sort().map((f) => `${f}\0${sha256(readFileSync(join(dir, f)))}\n`).join(''))}`;
}

/** Problems with a plan whose bound inputs drifted; an empty list means run may proceed. */
export function planDrift(plan, runDir, benchDir = BENCH_DIR) {
  const { matrix, targets } = loadBench(benchDir);
  const now = bindings({ benchDir, matrix, targets, model: plan.bound.model, host: execFileSync(claudeBin(), ['--version'], { encoding: 'utf8' }).trim() });
  const canary = readFileSync(join(runDir, 'canary.txt'), 'utf8').trim();
  Object.assign(now, { canaryDigest: `sha256:${sha256(canary)}`, keysDigest: keysDigest(runDir) });
  return Object.keys(plan.bound).filter((k) => stableJson(plan.bound[k]) !== stableJson(now[k])).map((k) => `bound input ${k} drifted since plan`);
}

/** The exit contract section a task's units get: change for debug and ship, else detection. */
export const sectionFor = (task) => (['code-ops-suite:debug', 'code-ops-suite:ship'].includes(task.skill) ? 'change' : 'detection');

/** The prompt for one unit: slash command (skill arm only), statement, exit contract. */
export function promptFor(task, arm, contractText) {
  const body = `${task.statement}\n\n${contractSection(contractText, sectionFor(task))}\n`;
  return arm === 'skill' ? `/${task.skill} ${body}` : body;
}

// The only inherited variables: what the claude binary and Git Bash need to start. Everything
// else (GH_TOKEN, cloud credentials, SSH agent sockets) stays out of the unit. Compared upper-case.
const ENV_ALLOW = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMMONPROGRAMFILES', 'SYSTEMDRIVE',
  'CLAUDE_CODE_GIT_BASH_PATH']);

/** Environment for the child: an allowlist, a scratch home under home, and a fresh config dir. */
export function unitEnv(configDir, home, source = process.env) {
  const env = {};
  for (const [k, v] of Object.entries(source)) if (ENV_ALLOW.has(k.toUpperCase())) env[k] = v;
  const roaming = join(home, 'AppData', 'Roaming');
  const local = join(home, 'AppData', 'Local');
  for (const d of [roaming, local]) mkdirSync(d, { recursive: true });
  Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: roaming, LOCALAPPDATA: local, CLAUDE_CONFIG_DIR: configDir });
  const header = workspaceHeader();
  if (header) env.ANTHROPIC_CUSTOM_HEADERS = header;
  return env;
}

/** text with every exact occurrence of secret replaced; text unchanged when there is no secret. */
export const maskSecret = (text, secret, label = '<REDACTED:api-key>') => (secret ? text.split(secret).join(label) : text);

/** Kill a process tree; Windows needs taskkill for the children of the shim. */
function killTree(child) {
  if (process.platform !== 'win32') { child.kill('SIGKILL'); return; }
  // A missing taskkill must not crash the runner: fall back to killing the shim alone.
  spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
}

/** Spawn one claude process; resolves { exitCode, timedOut, wallMs, stdout } with the secret masked. */
function spawnUnit({ bin, args, cwd, env, prompt, timeoutMs, transcriptPath, secret }) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd, env, windowsHide: true });
    let raw = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { raw += d; });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      const stdout = maskSecret(raw, secret);
      writeFileSync(transcriptPath, stdout);
      done({ exitCode: code, timedOut, wallMs: Date.now() - started, stdout });
    });
    child.stdin.end(prompt);
  });
}

/** Parsed stream-json lines; malformed lines are skipped. */
function streamLines(text) {
  return text.split(/\r?\n/).filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** Every .jsonl under dir, as strings (the subagent sidechain transcripts). */
function sidechains(dir) {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.jsonl')) out.push(readFileSync(join(d, e.name), 'utf8'));
    }
  };
  walk(dir);
  return out;
}

/** The upstream names a network command must not carry: the target name and its PROVENANCE.md URLs. */
function upstreamOf(name, targetDir) {
  const prov = readFileSync(join(targetDir, 'PROVENANCE.md'), 'utf8');
  return [name, ...new Set(prov.match(/https?:\/\/[^\s)`>]+/g) ?? [])];
}

const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; } };

// Tools a unit must not use. Host-wide process kills took down the runner itself (a unit ran
// taskkill /IM node.exe). Bare mode skips hooks, so deny rules on the command line are the
// mechanism. Both arms get the same list.
export const DENIED_TOOLS = ['WebFetch', 'WebSearch',
  'Bash(taskkill:*)', 'Bash(pkill:*)', 'Bash(killall:*)', 'Bash(Stop-Process:*)',
  'Bash(*taskkill*)', 'Bash(*pkill*)', 'Bash(*killall*)', 'Bash(*Stop-Process*)'];

/** The claude command-line arguments for one unit; pluginCopy is null for the control arm. */
export function claudeArgs({ plan, aux, pluginCopy }) {
  const args = ['-p', '--settings', join(aux, 'settings.json'), '--model', plan.bound.model, '--output-format', 'stream-json', '--verbose',
    '--max-budget-usd', String(plan.capUsd), '--permission-mode', plan.permissionMode, '--strict-mcp-config', '--mcp-config', join(aux, 'mcp.json'),
    '--disallowedTools', ...DENIED_TOOLS];
  if (plan.isolation === 'bare') args.unshift('--bare');
  if (pluginCopy) args.push('--plugin-dir', pluginCopy);
  return args;
}

/** One file per attempt, so a rerun never overwrites the evidence of the attempt before it. */
const attemptFile = (runDir, dir, unitId, n, ext) => join(runDir, dir, `${unitId}.a${n}.${ext}`);

/** The CONFIRMED findings and whether each one's proof resolves in dest (tier compared case-insensitively). */
export function proofResults(findings, dest) {
  return (findings ?? []).flatMap((f, index) => (String(f?.tier).toUpperCase() === 'CONFIRMED' ? [{ index, resolves: resolveProof(f.proof, dest) }] : []));
}

/** Run one unit once; returns the result record (without voidReruns). */
async function runOnce({ unit, task, key, plan, runDir, targetDir, answerKey, contractText, canary, bin, attempt: n }) {
  const box = mkdtempSync(join(tmpdir(), 'bench-box-'));
  const aux = mkdtempSync(join(tmpdir(), 'bench-aux-'));
  // The key helper lives outside every path the unit may touch; the audit treats it as protected.
  const keyDir = mkdtempSync(join(tmpdir(), 'bench-key-'));
  try {
    const secret = readFileSync(KEY_FILE, 'utf8').trim();
    const configDir = join(aux, 'config');
    mkdirSync(configDir);
    const dest = join(box, 'repo');
    // Both arms get the same sandbox: the contract section is in the prompt and in CLAUDE.md.
    materialize({ task, seeds: answerKey.seeds, changes: answerKey.changes, targetDir, dest, contract: contractSection(contractText, sectionFor(task)) });
    const base = git(dest, ['rev-parse', 'HEAD']);
    const helper = join(keyDir, 'key-helper.mjs');
    writeFileSync(helper, `import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync(${JSON.stringify(KEY_FILE)}, 'utf8').trim());\n`);
    writeFileSync(join(aux, 'settings.json'), JSON.stringify({ apiKeyHelper: `node "${helper}"` }));
    writeFileSync(join(aux, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
    const pluginCopy = unit.arm === 'skill' ? join(aux, 'plugin') : null;
    if (pluginCopy) cpSync(join(REPO_ROOT, 'plugins', pluginOf(task.skill)), pluginCopy, { recursive: true });
    const args = claudeArgs({ plan, aux, pluginCopy });
    const allowedPaths = [box, aux];
    mkdirSync(join(runDir, 'transcripts'), { recursive: true });
    const ran = await spawnUnit({ bin, args, cwd: dest, env: unitEnv(configDir, join(aux, 'home')), prompt: promptFor(task, unit.arm, contractText),
      timeoutMs: plan.timeoutMs, transcriptPath: attemptFile(runDir, 'transcripts', unit.id, n, 'jsonl'), secret });
    const lines = streamLines(ran.stdout);
    const result = lines.findLast((l) => l.type === 'result');
    const findingsFile = readJson(join(dest, 'BENCH_FINDINGS.json'));
    const summary = readJson(join(dest, 'BENCH_SUMMARY.json'));
    const findingsText = existsSync(join(dest, 'BENCH_FINDINGS.json')) ? readFileSync(join(dest, 'BENCH_FINDINGS.json'), 'utf8') : '';
    const audit = auditUnit({ transcriptTexts: [ran.stdout, ...sidechains(configDir)], findingsText, repoRoot: REPO_ROOT, runFolder: runDir,
      canary, upstream: upstreamOf(task.target, targetDir), allowedPaths, protectedPaths: [KEY_FILE, WORKSPACE_FILE, helper] });
    const findings = Array.isArray(findingsFile?.findings) ? findingsFile.findings : null;
    // The agent's work only: commits after the materialized base, then uncommitted and untracked
    // paths. The diff and the proofs are taken before afterRun copies the oracles in and runs them.
    const diff = [
      git(dest, ['log', '-p', '--format=commit %H%n%s', '--reverse', `${base}..HEAD`]),
      git(dest, ['diff', 'HEAD']),
      git(dest, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).map((p) => `untracked ${p}`).join('\n'),
    ].filter(Boolean).join('\n');
    const proofs = proofResults(findings, dest);
    const after = await afterRun({ task, derivedKey: key, targetDir, dest });
    mkdirSync(join(runDir, 'diffs'), { recursive: true });
    writeFileSync(attemptFile(runDir, 'diffs', unit.id, n, 'patch'), diff);
    const r = result ?? {};
    const usage = r.usage ?? {};
    return {
      unitId: unit.id, task: task.id, skill: task.skill, arm: unit.arm, rep: unit.rep,
      exitCode: ran.exitCode, timedOut: ran.timedOut, noResult: !result,
      capHit: /budget/i.test(`${r.subtype ?? ''} ${r.terminal_reason ?? ''}`),
      wallMs: ran.wallMs, turns: r.num_turns ?? 0,
      // null, not 0, when the stream held no result line: the spend is unknown, not zero.
      costUsd: r.total_cost_usd ?? null,
      tokens: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0 },
      models: Object.keys(r.modelUsage && !Array.isArray(r.modelUsage) ? r.modelUsage : {}).sort(),
      subagents: r.subagent_stats ?? null,
      apiError: r.api_error_status ?? null,
      audit, voidReruns: 0,
      findings, verdict: typeof findingsFile?.verdict === 'string' ? findingsFile.verdict : null,
      summary, after, proofs,
    };
  } finally {
    removeBestEffort(box);
    removeBestEffort(aux);
    removeBestEffort(keyDir);
  }
}

/** Remove a sandbox directory; a file a child process still holds on Windows must not lose a paid unit. */
function removeBestEffort(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
  } catch (err) {
    console.error(`warning: could not remove ${dir}: ${err.code ?? err.message}`);
  }
}

const inflightPath = (runDir, unitId) => join(runDir, 'inflight', `${unitId}.json`);

/** Append one attempt to the run folder's append-only spend ledger (spend.jsonl). */
export function appendSpend(runDir, entry) {
  appendFileSync(join(runDir, 'spend.jsonl'), `${JSON.stringify(entry)}\n`);
}

/** The ledger's lines; none when the run folder has no ledger yet. */
export function readLedger(runDir) {
  const path = join(runDir, 'spend.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

/** The cost on the last result line of an attempt's transcript, or null when there is none. */
function transcriptCost(path, notBefore = 0) {
  if (!existsSync(path) || statSync(path).mtimeMs < notBefore) return null;
  return streamLines(readFileSync(path, 'utf8')).findLast((l) => l.type === 'result')?.total_cost_usd ?? null;
}

/** The per-attempt summary kept on the unit record and in the ledger. */
export function attemptOf(record) {
  return {
    costUsd: record.costUsd ?? null, wallMs: record.wallMs, void: Boolean(record.audit?.void),
    triggers: (record.audit?.triggers ?? []).map((t) => t.rule),
    capHit: record.capHit, timedOut: record.timedOut, exitCode: record.exitCode,
  };
}

/**
 * Run one attempt between an in-flight marker write and its removal; a runner that dies
 * mid-attempt leaves the marker for recoverInflight. Every finished attempt, including one
 * that ended in an API error, no result line, or a throw, gets a ledger line.
 */
async function attempt(ctx, n, run, log) {
  const marker = inflightPath(ctx.runDir, ctx.unit.id);
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, stableJson({ unitId: ctx.unit.id, attempt: n, startedAt: new Date().toISOString(), runnerPid: process.pid }));
  let record;
  try {
    record = await run({ ...ctx, attempt: n });
  } catch (err) {
    const costUsd = transcriptCost(attemptFile(ctx.runDir, 'transcripts', ctx.unit.id, n, 'jsonl'));
    const error = String(err?.message ?? err).slice(0, 300);
    appendSpend(ctx.runDir, { unitId: ctx.unit.id, attempt: n, status: 'error', costUsd, error, at: new Date().toISOString() });
    log(`error ${ctx.unit.id} attempt ${n}: ${error}`);
    throw err;
  } finally {
    rmSync(marker, { force: true });
  }
  const entry = attemptOf(record);
  const status = record.apiError ? 'api-error' : record.noResult ? 'no-result' : 'ok';
  appendSpend(ctx.runDir, { unitId: ctx.unit.id, attempt: n, status, ...entry, at: new Date().toISOString() });
  return { record, entry };
}

/**
 * Run a unit, rerunning once when the audit voids it. Returns { record } carrying the attempts
 * array and spentUsd, { apiError } when an attempt ended with an API error, or { noResult } when
 * an attempt that did not time out left no result line. costUsd stays the scored attempt's cost;
 * spentUsd sums every attempt. ctx.firstAttempt numbers the attempts of a resumed unit.
 */
export async function runUnit(ctx, { run = runOnce, log = console.log } = {}) {
  const attempts = [];
  const first = ctx.firstAttempt ?? 1;
  const unfinished = (record) => {
    if (record.apiError) return { apiError: record.apiError };
    if (record.noResult && !record.timedOut) return { noResult: `exit ${record.exitCode}` };
    return null;
  };
  let { record, entry } = await attempt(ctx, first, run, log);
  attempts.push(entry);
  if (unfinished(record)) return unfinished(record);
  if (record.audit.void) {
    log(`void ${ctx.unit.id}: ${record.audit.triggers.map((t) => t.rule).join(', ')}; rerunning once`);
    ({ record, entry } = await attempt(ctx, first + 1, run, log));
    attempts.push(entry);
    if (unfinished(record)) return unfinished(record);
    record = { ...record, voidReruns: 1 };
  }
  return { record: { ...record, attempts, spentUsd: attempts.reduce((a, e) => a + (e.costUsd ?? 0), 0) } };
}

/** Whether a process id belongs to a live process; EPERM means it exists but is not ours. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * Settle the markers a dead runner left; each is a killed attempt. The ledger gets its line
 * (cost from the attempt's own transcript when that file is newer than the marker and holds a
 * result line, else null), then the marker goes. A marker whose runner is still alive is left
 * alone. Returns { killed: the ledger entries, live: the unit ids a live runner holds }.
 */
export function recoverInflight(runDir, log = console.log) {
  const dir = join(runDir, 'inflight');
  const out = { killed: [], live: [] };
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const path = join(dir, f);
    const marker = readJson(path) ?? { unitId: f.slice(0, -5) };
    if (pidAlive(marker.runnerPid)) {
      log(`skip ${marker.unitId}: a live runner (pid ${marker.runnerPid}) holds its in-flight marker`);
      out.live.push(marker.unitId);
      continue;
    }
    // An older transcript belongs to an earlier attempt of the same unit, not the killed one.
    const costUsd = marker.attempt == null ? null
      : transcriptCost(attemptFile(runDir, 'transcripts', marker.unitId, marker.attempt, 'jsonl'), Date.parse(marker.startedAt ?? ''));
    const entry = { unitId: marker.unitId, attempt: marker.attempt ?? null, status: 'killed-unrecorded', costUsd, startedAt: marker.startedAt ?? null, runnerPid: marker.runnerPid ?? null, at: new Date().toISOString() };
    appendSpend(runDir, entry);
    rmSync(path, { force: true });
    log(`recovered ${marker.unitId}: the previous runner died mid-attempt; recorded as killed, rerunning`);
    out.killed.push(entry);
  }
  return out;
}

/** The next attempt number for a unit: one past the highest the ledger holds. */
const nextAttempt = (ledger, unitId) => 1 + Math.max(0, ...ledger.filter((e) => e.unitId === unitId).map((e) => e.attempt ?? 0));

/**
 * Run every unit in plan order that has no result yet. Stops on an API billing error, an attempt
 * with no result line, a thrown error, or drift of any bound input since plan.
 */
export async function runBench({ runDir, limit = Infinity, benchDir = BENCH_DIR, log = console.log }) {
  const plan = JSON.parse(readFileSync(join(runDir, 'plan.json'), 'utf8'));
  const { matrix, targets, answerKey } = loadBench(benchDir);
  const contractText = readFileSync(join(benchDir, 'EXIT_CONTRACT.md'), 'utf8');
  const canary = readFileSync(join(runDir, 'canary.txt'), 'utf8').trim();
  const bin = claudeBin();
  mkdirSync(join(runDir, 'units'), { recursive: true });
  const { live } = recoverInflight(runDir, log);
  const ledger = readLedger(runDir);
  let ran = 0;
  for (const unit of plan.units) {
    const out = join(runDir, 'units', `${unit.id}.json`);
    if (existsSync(out) || live.includes(unit.id)) continue;
    if (ran >= limit) break;
    // Re-checked before every paid unit: a plugin or target edited mid-run would split the run.
    const drift = planDrift(plan, runDir, benchDir);
    if (drift.length) {
      log(`stop ${unit.id}: ${drift.join('; ')}`);
      return { ran, stopped: `plan drifted: ${drift.join('; ')}` };
    }
    const task = matrix.tasks.find((t) => t.id === unit.task);
    const key = JSON.parse(readFileSync(join(runDir, 'keys', `${task.id}.json`), 'utf8'));
    const ctx = { unit, task, key, plan, runDir, targetDir: targets[task.target], answerKey: answerKey(targets[task.target]), contractText, canary, bin,
      firstAttempt: nextAttempt(ledger, unit.id) };
    let outcome;
    try {
      outcome = await runUnit(ctx, { log });
    } catch (err) {
      return { ran, stopped: `error in ${unit.id}: ${String(err?.message ?? err).slice(0, 200)}` };
    }
    const { record, apiError, noResult } = outcome;
    if (apiError || noResult) {
      const why = apiError ? `api error ${apiError}` : `no result line (${noResult})`;
      log(`stop ${unit.id}: ${why}; no result written`);
      return { ran, stopped: why };
    }
    writeFileSync(out, stableJson(record));
    ran++;
    const cost = record.costUsd == null ? 'cost unknown' : `$${record.costUsd.toFixed(2)}`;
    log(`unit ${unit.id}: ${cost} (spent $${record.spentUsd.toFixed(2)}) ${Math.round(record.wallMs / 1000)}s${record.audit.void ? ' VOID' : ''}${record.capHit ? ' CAP' : ''}${record.timedOut ? ' TIMEOUT' : ''}`);
  }
  return { ran, stopped: null };
}

export { BENCH_DIR, REPO_ROOT };
