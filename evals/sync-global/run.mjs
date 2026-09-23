#!/usr/bin/env node
// Regression eval for scripts/sync-global.mjs. It copies the script into a scratch repo layout,
// points it at temp homes with CODE_OPS_SYNC_HOME, and puts stub claude/codex/grok CLIs first on
// PATH (a sh script on POSIX, a .cmd shim on Windows). It asserts a fresh install, an idempotent
// re-run, refusal on a local edit, --force with a backup, --capture, --check exit codes, the
// byte-identical Claude pair, host skips, a dry run that writes nothing, and the exact argv each
// stub CLI receives.
//
//   node evals/sync-global/run.mjs   (exit 0 = all assertions pass)

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';
const fails = [];
const check = (name, cond, detail = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) { fails.push(name); if (detail) console.log(detail); } };
const tmp = mkdtempSync(join(tmpdir(), 'sync-global-'));

// Scratch repo: the script, its helper, a marketplace manifest, and two contract sources.
const repo = join(tmp, 'repo');
mkdirSync(join(repo, 'scripts'), { recursive: true });
mkdirSync(join(repo, 'global-contracts'));
mkdirSync(join(repo, '.claude-plugin'));
for (const f of ['sync-global.mjs', 'cli-lib.mjs']) copyFileSync(join(REPO, 'scripts', f), join(repo, 'scripts', f));
writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'code-ops', plugins: ['code-ops-suite', 'rigor', 'researcher', 'privacy-opsec-suite'].map((name) => ({ name })) }));
const SRC_MAIN = '# Global contract\n\nShared rule.\n';
const SRC_CODEX = '# Global contract\n\nCodex host rule.\n';
const srcMain = join(repo, 'global-contracts', 'AGENTS.md');
const srcCodex = join(repo, 'global-contracts', 'AGENTS.codex.md');
writeFileSync(srcMain, SRC_MAIN);
writeFileSync(srcCodex, SRC_CODEX);

// Stub CLIs: each appends its argv to a log and answers the read-only list commands.
const bin = join(tmp, 'bin');
mkdirSync(bin);
const stub = join(tmp, 'stub.mjs');
const log = join(tmp, 'argv.log');
writeFileSync(stub, `import { appendFileSync } from 'node:fs';
const [host, ...args] = process.argv.slice(2);
appendFileSync(process.env.SYNC_STUB_LOG, JSON.stringify([host, ...args]) + '\\n');
const cmd = args.join(' ');
if (process.env.SYNC_STUB_FAIL && cmd.startsWith(process.env.SYNC_STUB_FAIL)) { console.error('stub failure'); process.exit(3); }
const out = {
  'claude plugin list --json': JSON.stringify([{ id: 'code-ops-suite@code-ops' }, { id: 'rigor@code-ops' }, { id: 'other@elsewhere' }]),
  'codex plugin list --marketplace code-ops --json': JSON.stringify({ installed: [{ name: 'code-ops-suite', marketplaceName: 'code-ops' }, { name: 'x', marketplaceName: 'other' }], available: [] }),
  'grok plugin marketplace list': '  xAI Official: https://github.com/xai-org/plugin-marketplace.git\\n  code-ops: https://github.com/skylarsabo/code-ops.git',
  'grok plugin list --json': JSON.stringify([{ name: 'researcher', marketplace: 'code-ops' }, { name: 'x', marketplace: 'other' }]),
}[host + ' ' + cmd];
if (out !== undefined) console.log(out);
`);
function writeStub(host) {
  if (WIN) writeFileSync(join(bin, `${host}.cmd`), `@"${process.execPath}" "${stub}" ${host} %*\r\n`);
  else { writeFileSync(join(bin, host), `#!/bin/sh\nexec "${process.execPath}" "${stub}" ${host} "$@"\n`); chmodSync(join(bin, host), 0o755); }
}
const HOSTS = ['claude', 'codex', 'grok'];
for (const h of HOSTS) writeStub(h);

function makeHome(name, hosts = HOSTS) {
  const home = join(tmp, name);
  for (const h of hosts) mkdirSync(join(home, `.${h}`), { recursive: true });
  return home;
}
function sync(home, args, extraEnv = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(path|codex_home|grok_home|sync_stub_fail)$/i.test(k)) delete env[k];
  Object.assign(env, { PATH: bin, CODE_OPS_SYNC_HOME: home, SYNC_STUB_LOG: log }, extraEnv);
  writeFileSync(log, '');
  const r = spawnSync(process.execPath, [join(repo, 'scripts', 'sync-global.mjs'), ...args], { env, encoding: 'utf8' });
  const argv = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).join(' '));
  return { code: r.status, out: `${r.stdout}${r.stderr}`, argv };
}
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
const paths = (home) => ({
  claudeMd: join(home, '.claude', 'CLAUDE.md'), claudeAgents: join(home, '.claude', 'AGENTS.md'),
  codex: join(home, '.codex', 'AGENTS.md'), grok: join(home, '.grok', 'rules', 'code-ops-global.md'),
  state: join(home, '.claude', 'code-ops', 'global-sync.json'),
});
const backups = (file) => readdirSync(dirname(file)).filter((f) => f.startsWith(`${file.split(/[\\/]/).pop()}.bak-`));

try {
  // Fresh install.
  const home = makeHome('home');
  const p = paths(home);
  let r = sync(home, ['--only', 'contracts']);
  check('fresh install exits 0', r.code === 0, r.out);
  check('fresh install writes the Claude pair', read(p.claudeMd) === SRC_MAIN && read(p.claudeAgents) === SRC_MAIN);
  check('Claude pair is byte-identical', readFileSync(p.claudeMd).equals(readFileSync(p.claudeAgents)));
  check('fresh install writes the Codex variant', read(p.codex) === SRC_CODEX);
  check('fresh install creates the Grok rules file', read(p.grok) === SRC_MAIN);
  check('fresh install records state', existsSync(p.state));
  check('contracts-only runs no host CLI', r.argv.length === 0, r.argv.join('\n'));

  // Idempotent re-run and --check.
  r = sync(home, ['--only', 'contracts']);
  check('re-run exits 0 and reports current', r.code === 0 && /current/.test(r.out) && !/create|update/.test(r.out), r.out);
  check('re-run writes no backup', backups(p.codex).length === 0);
  check('--check exits 0 when current', sync(home, ['--check']).code === 0);

  // A source change propagates to targets this script wrote, with a backup.
  writeFileSync(srcMain, `${SRC_MAIN}Second rule.\n`);
  r = sync(home, ['--only', 'contracts']);
  check('source change updates recorded targets', r.code === 0 && read(p.claudeMd) === `${SRC_MAIN}Second rule.\n` && read(p.grok) === `${SRC_MAIN}Second rule.\n`, r.out);
  check('source change backs up the old content', backups(p.claudeMd).length === 1);
  writeFileSync(srcMain, SRC_MAIN);
  sync(home, ['--only', 'contracts']);

  // Refusal on a local edit, then --check drift, then --force.
  writeFileSync(p.codex, 'my own contract\n');
  r = sync(home, ['--only', 'contracts']);
  check('local edit is refused with exit 1', r.code === 1 && /--force/.test(r.out) && /--capture/.test(r.out), r.out);
  check('refused target is untouched', read(p.codex) === 'my own contract\n');
  check('--check exits 1 on drift', sync(home, ['--check']).code === 1);
  r = sync(home, ['--only', 'contracts', '--force']);
  check('--force overwrites', r.code === 0 && read(p.codex) === SRC_CODEX, r.out);
  const codexBackups = backups(p.codex);
  check('--force writes a dated backup of the edit', codexBackups.length === 1 && /\.bak-\d{4}-\d{2}-\d{2}$/.test(codexBackups[0])
    && read(join(dirname(p.codex), codexBackups[0])) === 'my own contract\n');

  // --capture copies a live edit into the repo source and syncs it to the other targets.
  writeFileSync(p.grok, `${SRC_MAIN}Grok-side edit.\n`);
  r = sync(home, ['--only', 'contracts', '--capture']);
  check('--capture exits 0', r.code === 0, r.out);
  check('--capture updates the repo source', read(srcMain) === `${SRC_MAIN}Grok-side edit.\n`);
  check('--capture syncs the Claude pair', read(p.claudeMd) === `${SRC_MAIN}Grok-side edit.\n` && readFileSync(p.claudeMd).equals(readFileSync(p.claudeAgents)));
  check('--check exits 0 after capture', sync(home, ['--check']).code === 0);
  writeFileSync(srcMain, SRC_MAIN);
  sync(home, ['--only', 'contracts']);

  // A CRLF checkout of the source is not drift.
  writeFileSync(srcMain, SRC_MAIN.replace(/\n/g, '\r\n'));
  check('CRLF source reads as current', sync(home, ['--check']).code === 0);
  writeFileSync(srcMain, SRC_MAIN);

  // Dry run on a fresh home writes nothing and runs only the read-only list commands.
  const dryHome = makeHome('dry');
  r = sync(dryHome, ['--dry-run']);
  const dp = paths(dryHome);
  check('dry run exits 0', r.code === 0, r.out);
  check('dry run writes nothing', [dp.claudeMd, dp.claudeAgents, dp.codex, dp.grok, dp.state].every((f) => !existsSync(f)));
  check('dry run prints the mutating commands', /would\s+codex\s+\$ codex plugin add code-ops-suite@code-ops/.test(r.out), r.out);
  check('dry run runs only list commands', r.argv.length > 0 && r.argv.every((a) => / list( |$)/.test(a)), r.argv.join('\n'));

  // Caches: exact argv per host, installed code-ops plugins only.
  r = sync(home, ['--only', 'caches']);
  check('caches exit 0', r.code === 0, r.out);
  const want = [
    'claude plugin list --json', 'claude plugin marketplace update code-ops',
    'claude plugin update code-ops-suite@code-ops', 'claude plugin update rigor@code-ops',
    'codex plugin list --marketplace code-ops --json', 'codex plugin marketplace upgrade code-ops',
    'codex plugin add code-ops-suite@code-ops',
    'grok plugin marketplace list', 'grok plugin list --json',
    'grok plugin marketplace update code-ops', 'grok plugin update researcher',
  ];
  check('stub CLIs receive the expected argv', JSON.stringify(r.argv) === JSON.stringify(want), r.argv.join('\n'));
  check('--hosts limits the run', JSON.stringify(sync(home, ['--only', 'caches', '--hosts', 'codex']).argv) === JSON.stringify(want.slice(4, 7)));
  r = sync(home, ['--only', 'caches'], { SYNC_STUB_FAIL: 'plugin update' });
  check('a failing CLI command exits 1', r.code === 1 && /FAIL/.test(r.out), r.out);

  // Host skips: a missing home directory and a missing CLI are notes, not failures.
  const partial = makeHome('partial', ['claude', 'codex']);
  rmSync(join(bin, WIN ? 'grok.cmd' : 'grok'));
  r = sync(partial, []);
  check('missing host home is skipped', r.code === 0 && /skip\s+grok\s+.*does not exist/.test(r.out) && !existsSync(paths(partial).grok), r.out);
  r = sync(home, ['--only', 'caches']);
  check('missing CLI is skipped', r.code === 0 && /skip\s+grok\s+grok CLI not on PATH/.test(r.out), r.out);
  writeStub('grok');

  // Bad invocations.
  check('--force with --capture is exit 2', sync(home, ['--force', '--capture']).code === 2);
  check('unknown host is exit 2', sync(home, ['--hosts', 'cursor']).code === 2);
  check('--check with --only caches is exit 2', sync(home, ['--check', '--only', 'caches']).code === 2);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} assertion(s) failed` : '\nall sync-global assertions pass');
process.exit(fails.length ? 1 : 0);
