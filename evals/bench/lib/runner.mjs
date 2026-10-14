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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeDigest } from '../bench.mjs';
import { afterRun, deriveKey, materialize, newCanary, stableJson } from './sandbox.mjs';
import { auditUnit } from './audit.mjs';
import { resolveProof } from './score.mjs';

const BENCH_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(BENCH_DIR, '..', '..');
export const PLAN_VERSION = 1;
export const ARMS = ['skill', 'control'];
const KEY_FILE = join(process.env.USERPROFILE || process.env.HOME || '', '.bench-key');
// Optional: the workspace for an organization-level key, sent as the anthropic-workspace-id header.
const WORKSPACE_FILE = join(process.env.USERPROFILE || process.env.HOME || '', '.bench-workspace');

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

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** Resolve the claude executable; Windows shims need the where.exe probe (scripts/preflight.mjs:51). */
export function claudeBin() {
  if (process.platform !== 'win32') return 'claude';
  return execFileSync('where', ['claude'], { encoding: 'utf8' }).split(/\r?\n/).find((l) => /\.(exe|cmd)$/i.test(l.trim())).trim();
}

/** Write plan.json, the derived keys, and the canary into runDir. */
export function planBench({ runDir, model, reps, pilot, capUsd, timeoutMs, isolation, permissionMode, benchDir = BENCH_DIR }) {
  if (existsSync(join(runDir, 'plan.json'))) throw new Error(`${runDir} already holds a plan; use a new run folder`);
  const { matrix, targets, answerKey } = loadBench(benchDir);
  const host = execFileSync(claudeBin(), ['--version'], { encoding: 'utf8' }).trim();
  const canary = newCanary();
  mkdirSync(join(runDir, 'keys'), { recursive: true });
  for (const task of matrix.tasks) {
    const { seeds, changes } = answerKey(targets[task.target]);
    const key = deriveKey({ task, seeds, changes, targetDir: targets[task.target], canary });
    writeFileSync(join(runDir, 'keys', `${task.id}.json`), stableJson(key));
  }
  writeFileSync(join(runDir, 'canary.txt'), `${canary}\n`);
  const plan = {
    version: PLAN_VERSION,
    pilot: Boolean(pilot),
    reps,
    capUsd,
    timeoutMs,
    isolation,
    permissionMode,
    mcp: 'none (--strict-mcp-config with an empty server list in both arms)',
    bound: { ...bindings({ benchDir, matrix, targets, model, host }), canaryDigest: `sha256:${sha256(canary)}`, keysDigest: keysDigest(runDir) },
    units: unitOrder(matrix.tasks.map((t) => t.id), reps),
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

/** The prompt for one unit: slash command (skill arm only), statement, exit contract. */
export function promptFor(task, arm, contractText) {
  const section = ['code-ops-suite:debug', 'code-ops-suite:ship'].includes(task.skill) ? 'change' : 'detection';
  const body = `${task.statement}\n\n${contractSection(contractText, section)}\n`;
  return arm === 'skill' ? `/${task.skill} ${body}` : body;
}

/** Environment for the child: no inherited Claude or suite session state. */
function unitEnv(configDir) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    // The Git Bash location is host setup, not session state, and claude needs it on Windows.
    if (/^(CLAUDE|CODE_OPS|ANTHROPIC|OTEL)_?/i.test(k) && k !== 'CLAUDE_CODE_GIT_BASH_PATH') continue;
    env[k] = v;
  }
  env.CLAUDE_CONFIG_DIR = configDir;
  const header = workspaceHeader();
  if (header) env.ANTHROPIC_CUSTOM_HEADERS = header;
  return env;
}

/** Kill a process tree; Windows needs taskkill for the children of the shim. */
function killTree(child) {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGKILL');
}

/** Spawn one claude process; resolves { exitCode, timedOut, wallMs, stdout }. */
function spawnUnit({ bin, args, cwd, env, prompt, timeoutMs, transcriptPath }) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(bin, args, { cwd, env, windowsHide: true });
    let stdout = '';
    let timedOut = false;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', () => {});
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
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

/** Run one unit once; returns the result record (without voidReruns). */
async function runOnce({ unit, task, key, plan, runDir, targetDir, answerKey, contractText, canary, bin }) {
  const box = mkdtempSync(join(tmpdir(), 'bench-box-'));
  const aux = mkdtempSync(join(tmpdir(), 'bench-aux-'));
  const configDir = join(aux, 'config');
  mkdirSync(configDir);
  const dest = join(box, 'repo');
  materialize({ task, seeds: answerKey.seeds, changes: answerKey.changes, targetDir, dest });
  const helper = join(aux, 'key-helper.mjs');
  writeFileSync(helper, `import { readFileSync } from 'node:fs';\nprocess.stdout.write(readFileSync(${JSON.stringify(KEY_FILE)}, 'utf8').trim());\n`);
  writeFileSync(join(aux, 'settings.json'), JSON.stringify({ apiKeyHelper: `node "${helper}"` }));
  writeFileSync(join(aux, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  const args = ['-p', '--settings', join(aux, 'settings.json'), '--model', plan.bound.model, '--output-format', 'stream-json', '--verbose',
    '--max-budget-usd', String(plan.capUsd), '--permission-mode', plan.permissionMode, '--strict-mcp-config', '--mcp-config', join(aux, 'mcp.json'),
    '--disallowedTools', 'WebFetch', 'WebSearch'];
  if (plan.isolation === 'bare') args.unshift('--bare');
  const allowedPaths = [box, aux];
  if (unit.arm === 'skill') {
    const pluginCopy = join(aux, 'plugin');
    cpSync(join(REPO_ROOT, 'plugins', pluginOf(task.skill)), pluginCopy, { recursive: true });
    args.push('--plugin-dir', pluginCopy);
  }
  mkdirSync(join(runDir, 'transcripts'), { recursive: true });
  const ran = await spawnUnit({ bin, args, cwd: dest, env: unitEnv(configDir), prompt: promptFor(task, unit.arm, contractText),
    timeoutMs: plan.timeoutMs, transcriptPath: join(runDir, 'transcripts', `${unit.id}.jsonl`) });
  const lines = streamLines(ran.stdout);
  const result = lines.findLast((l) => l.type === 'result') ?? {};
  const findingsFile = readJson(join(dest, 'BENCH_FINDINGS.json'));
  const summary = readJson(join(dest, 'BENCH_SUMMARY.json'));
  const findingsText = existsSync(join(dest, 'BENCH_FINDINGS.json')) ? readFileSync(join(dest, 'BENCH_FINDINGS.json'), 'utf8') : '';
  const audit = auditUnit({ transcriptTexts: [ran.stdout, ...sidechains(configDir)], findingsText, repoRoot: REPO_ROOT, runFolder: runDir,
    canary, upstream: upstreamOf(task.target, targetDir), allowedPaths });
  const findings = Array.isArray(findingsFile?.findings) ? findingsFile.findings : null;
  const after = await afterRun({ task, derivedKey: key, targetDir, dest });
  const proofs = (findings ?? []).flatMap((f, index) => (f?.tier === 'CONFIRMED' ? [{ index, resolves: resolveProof(f.proof, dest) }] : []));
  const diff = git(dest, ['log', '-p', '--format=commit %H%n%s', '--reverse', '-n', '20']);
  mkdirSync(join(runDir, 'diffs'), { recursive: true });
  writeFileSync(join(runDir, 'diffs', `${unit.id}.patch`), diff);
  const usage = result.usage ?? {};
  const record = {
    unitId: unit.id, task: task.id, skill: task.skill, arm: unit.arm, rep: unit.rep,
    exitCode: ran.exitCode, timedOut: ran.timedOut,
    capHit: /budget/i.test(`${result.subtype ?? ''} ${result.terminal_reason ?? ''}`),
    wallMs: ran.wallMs, turns: result.num_turns ?? 0,
    costUsd: result.total_cost_usd ?? 0,
    tokens: { input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0, cacheRead: usage.cache_read_input_tokens ?? 0, cacheWrite: usage.cache_creation_input_tokens ?? 0 },
    models: Object.keys(result.modelUsage && !Array.isArray(result.modelUsage) ? result.modelUsage : {}).sort(),
    subagents: result.subagent_stats ?? null,
    apiError: result.api_error_status ?? null,
    audit, voidReruns: 0,
    findings, verdict: typeof findingsFile?.verdict === 'string' ? findingsFile.verdict : null,
    summary, after, proofs,
  };
  rmSync(box, { recursive: true, force: true });
  rmSync(aux, { recursive: true, force: true });
  return record;
}

/** Run every unit in plan order that has no result yet. Stops on an API billing error. */
export async function runBench({ runDir, limit = Infinity, benchDir = BENCH_DIR, log = console.log }) {
  const plan = JSON.parse(readFileSync(join(runDir, 'plan.json'), 'utf8'));
  const drift = planDrift(plan, runDir, benchDir);
  if (drift.length) throw new Error(`plan refused: ${drift.join('; ')}`);
  const { matrix, targets, answerKey } = loadBench(benchDir);
  const contractText = readFileSync(join(benchDir, 'EXIT_CONTRACT.md'), 'utf8');
  const canary = readFileSync(join(runDir, 'canary.txt'), 'utf8').trim();
  const bin = claudeBin();
  mkdirSync(join(runDir, 'units'), { recursive: true });
  let ran = 0;
  for (const unit of plan.units) {
    const out = join(runDir, 'units', `${unit.id}.json`);
    if (existsSync(out)) continue;
    if (ran >= limit) break;
    const task = matrix.tasks.find((t) => t.id === unit.task);
    const key = JSON.parse(readFileSync(join(runDir, 'keys', `${task.id}.json`), 'utf8'));
    const ctx = { unit, task, key, plan, runDir, targetDir: targets[task.target], answerKey: answerKey(targets[task.target]), contractText, canary, bin };
    let record = await runOnce(ctx);
    if (record.apiError) {
      log(`stop ${unit.id}: API error ${record.apiError}; no result written`);
      return { ran, stopped: `api error ${record.apiError}` };
    }
    if (record.audit.void) {
      log(`void ${unit.id}: ${record.audit.triggers.map((t) => t.rule).join(', ')}; rerunning once`);
      record = { ...(await runOnce(ctx)), voidReruns: 1 };
    }
    writeFileSync(out, stableJson(record));
    ran++;
    log(`unit ${unit.id}: $${record.costUsd.toFixed(2)} ${Math.round(record.wallMs / 1000)}s${record.audit.void ? ' VOID' : ''}${record.capHit ? ' CAP' : ''}${record.timedOut ? ' TIMEOUT' : ''}`);
  }
  return { ran, stopped: null };
}

export { BENCH_DIR, REPO_ROOT };
