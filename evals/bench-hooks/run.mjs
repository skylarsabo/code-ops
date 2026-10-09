#!/usr/bin/env node
// Smoke eval for scripts/bench-hooks.mjs. It pins the contract that makes the bench trustworthy:
//   - a real run reports one case per hooks.json entry variant, plus baselines, with numeric stats;
//   - the per-tool-call rows cover the six tool-call shapes, and the seeded board and feed make
//     the collision note (Edit, git push) and the change feed (git push) emit output on every timed run;
//   - a hook command that fails makes the bench exit non-zero instead of reporting a fast number;
//   - a hooks.json entry with no bench payload, and an unknown flag, fail closed.
//
//   node evals/bench-hooks/run.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(repo, 'scripts', 'bench-hooks.mjs');
const { fails, check } = tally((name, detail) => `${name} - ${String(detail).slice(0, 300)}`);
const run = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 180000 });

const real = run(['--runs', '2', '--warmup', '1', '--json']);
let report;
try { report = JSON.parse(real.stdout); } catch { report = null; }
const ids = (report?.cases ?? []).map((c) => c.id);
const want = ['pre-bash', 'pre-all', 'pre-message', 'pre-write', 'post-edit', 'post-all', 'UserPromptSubmit', 'SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop', 'base1', 'pre-bash-push', 'pre-all-edit', 'pre-all-bash', 'pre-all-push', 'post-all-push', 'pre-all-push-solo', 'post-all-push-solo', 'post-output', 'post-output-small', 'post-output-read'];
check('a. the real plugin benches every event entry and the baseline', real.status === 0 && want.every((id) => ids.includes(id)), `${real.status} ${ids.join(',')} ${real.stderr}`);
check('b. every case carries numeric p50, p95, and added figures',
  (report?.cases ?? []).every((c) => [c.p50, c.p95, c.addedP50, c.addedP95].every(Number.isFinite)), JSON.stringify(report?.cases?.[0]));
check('c. the tool-call rows cover Bash, git push with peers and solo, Edit, other, and message calls', (report?.toolCalls ?? []).length === 6, JSON.stringify(report?.toolCalls));
const edit = (report?.toolCalls ?? []).find((r) => r.label === 'Edit tool call');
check('c2. the Edit row sums the collision case, and the seeded cases emit output on every run',
  edit?.entries?.[0] === 'pre-all-edit' && ['pre-all-edit', 'pre-all-push', 'post-all-push'].every((id) => report.cases.find((c) => c.id === id)?.stdoutRuns === 2),
  JSON.stringify(edit) + JSON.stringify((report?.cases ?? []).map((c) => [c.id, c.stdoutRuns])));

const tmp = mkdtempSync(join(tmpdir(), 'bench-hooks-eval-'));
try {
  const plugin = (name, hooks) => {
    const root = join(tmp, name);
    mkdirSync(join(root, 'hooks'), { recursive: true });
    writeFileSync(join(root, 'hooks', 'hooks.json'), JSON.stringify({ hooks }));
    writeFileSync(join(root, 'hooks', 'ok.mjs'), 'process.exit(0);\n');
    writeFileSync(join(root, 'hooks', 'bad.mjs'), 'process.exit(3);\n');
    return root;
  };
  const entry = (file, matcher) => ({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${file}"` }] });
  const good = run(['--runs', '1', '--warmup', '0', '--plugin-root', plugin('good', { SessionStart: [entry('ok.mjs')] })]);
  check('d. a passing fixture plugin benches and exits 0', good.status === 0 && /SessionStart/.test(good.stdout), `${good.status} ${good.stderr}`);
  const failing = run(['--runs', '1', '--warmup', '0', '--plugin-root', plugin('bad', { SessionStart: [entry('bad.mjs')] })]);
  check('e. a hook that exits non-zero fails the bench', failing.status !== 0 && /failed/.test(failing.stderr), `${failing.status} ${failing.stderr}`);
  const unknown = run(['--runs', '1', '--warmup', '0', '--plugin-root', plugin('unknown', { PreToolUse: [entry('ok.mjs', 'Grep')] })]);
  check('f. an entry with no bench payload fails closed', unknown.status !== 0 && /no bench payload/.test(unknown.stderr), `${unknown.status} ${unknown.stderr}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const flag = run(['--bogus', 'x']);
check('g. an unknown flag exits 2 with usage', flag.status === 2 && /usage/.test(flag.stderr), `${flag.status} ${flag.stderr}`);

if (fails.length) { console.error(`\nFAIL ${fails.length}\n${fails.join('\n')}`); process.exit(1); }
console.log('\nbench-hooks smoke ok');
