#!/usr/bin/env node
// Keep this machine current with the marketplace: install the user-wide agent contracts from
// global-contracts/ and refresh the installed code-ops plugin caches for Claude Code, Codex, and
// Grok Build. Run it after every merge to main, because the caches pull merged main from GitHub.
//
//   node scripts/sync-global.mjs [--dry-run | --check] [--only contracts|caches]
//                                [--hosts claude,codex,grok] [--force | --capture]
//
// Contracts. Each host has fixed targets:
//   claude  ~/.claude/CLAUDE.md and ~/.claude/AGENTS.md    <- global-contracts/AGENTS.md
//           (byte-identical, verified after the write)
//   codex   $CODEX_HOME/AGENTS.md (default ~/.codex)        <- global-contracts/AGENTS.codex.md
//   grok    $GROK_HOME/rules/code-ops-global.md             <- global-contracts/AGENTS.md
//           (default ~/.grok; Grok loads every rules/*.md as a global rule)
// A host whose home directory does not exist is skipped. Content is compared and written with
// LF line endings, so a CRLF checkout on Windows never reads as drift.
//
// Safety: another user's own global contract is never silently replaced. The state file
// ~/.claude/code-ops/global-sync.json records the sha256 this script last wrote per target. A
// target is overwritten only when it is absent, already equal to the source, or still equal to
// the last-written sha. Otherwise the host is refused until the operator picks --force (back up
// and overwrite) or --capture (copy the live file into the repo source, then sync). Different
// content is always backed up to <file>.bak-YYYY-MM-DD before an overwrite.
//
// Caches. Per host, only the code-ops plugins already installed there are refreshed:
//   claude  plugin marketplace update code-ops, then plugin update <p>@code-ops
//   codex   plugin marketplace upgrade code-ops, then plugin add <p>@code-ops. Codex keeps a
//           per-version copy under ~/.codex/plugins/cache/code-ops/<p>/<version>/ written at
//           install time, so a snapshot upgrade alone does not install a bumped version.
//   grok    plugin marketplace update code-ops (the name; the URL is refused), then plugin update <p>
// A missing host CLI is a skip, not a failure. Every CLI runs with a fixed argv; a .cmd/.bat
// shim on Windows runs through cmd.exe only after every argument passes a strict character check.
//
// --dry-run writes nothing and runs only the read-only list commands; it prints each change and
// each command it would run. --check compares contracts only, writes nothing, and exits 1 on
// drift. CODE_OPS_SYNC_HOME overrides the home directory (the eval uses a temp home).
//
// Exit: 0 = every step passed or was skipped; 1 = a step failed, a target was refused, or
// --check found drift; 2 = bad invocation.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrDie, usage } from './cli-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'global-contracts');
const MARKETPLACE = 'code-ops';
const HOSTS = ['claude', 'codex', 'grok'];
const CMD_TIMEOUT_MS = 300000;
const USAGE = 'usage: sync-global.mjs [--dry-run | --check] [--only contracts|caches] [--hosts claude,codex,grok] [--force | --capture]';

const { flags } = parseOrDie(process.argv.slice(2), {
  'dry-run': { value: false }, check: { value: false }, force: { value: false }, capture: { value: false },
  only: { value: true }, hosts: { value: true },
}, USAGE);
if (flags.only !== undefined && !['contracts', 'caches'].includes(flags.only)) usage([`x --only must be contracts or caches`, USAGE]);
if (flags.force && flags.capture) usage(['x --force and --capture are exclusive', USAGE]);
if (flags.check && (flags['dry-run'] || flags.force || flags.capture || flags.only === 'caches')) {
  usage(['x --check compares contracts only and takes no --dry-run, --force, --capture, or --only caches', USAGE]);
}
const hosts = flags.hosts === undefined ? HOSTS : flags.hosts.split(',').map((h) => h.trim()).filter(Boolean);
if (!hosts.length || hosts.some((h) => !HOSTS.includes(h))) usage([`x --hosts takes a comma list of ${HOSTS.join(', ')}`, USAGE]);
const dryRun = flags['dry-run'];
const doContracts = flags.only !== 'caches';
const doCaches = flags.only !== 'contracts' && !flags.check;

const HOME = resolve(process.env.CODE_OPS_SYNC_HOME || homedir());
const STATE_PATH = join(HOME, '.claude', 'code-ops', 'global-sync.json');
let failed = false;
const line = (tag, host, text) => console.log(`${tag.padEnd(5)} ${host.padEnd(6)} ${text}`);
const fail = (host, text) => { failed = true; line('FAIL', host, text); };

// ---------------------------------------------------------------- hosts

function hostHome(host) {
  if (host === 'claude') return join(HOME, '.claude');
  if (host === 'codex') return resolve(process.env.CODEX_HOME || join(HOME, '.codex'));
  return resolve(process.env.GROK_HOME || join(HOME, '.grok'));
}

function contractTargets(host) {
  const dir = hostHome(host);
  if (host === 'claude') return { source: 'AGENTS.md', files: [join(dir, 'CLAUDE.md'), join(dir, 'AGENTS.md')] };
  if (host === 'codex') return { source: 'AGENTS.codex.md', files: [join(dir, 'AGENTS.md')] };
  return { source: 'AGENTS.md', files: [join(dir, 'rules', 'code-ops-global.md')] };
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// ---------------------------------------------------------------- contracts

const lf = (text) => text.replace(/\r\n/g, '\n');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const readLf = (path) => (existsSync(path) ? lf(readFileSync(path, 'utf8')) : null);

function loadState() {
  try {
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    return state && typeof state.targets === 'object' && state.targets ? state : { version: 1, targets: {} };
  } catch { return { version: 1, targets: {} }; }
}

function backupPath(file) {
  const base = `${file}.bak-${new Date().toISOString().slice(0, 10)}`;
  let candidate = base;
  for (let n = 2; existsSync(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

// Classify one live file against its source: current, create, update (safe overwrite), or drift.
function classify(file, source, state) {
  const live = readLf(file);
  if (live === null) return { file, live, kind: 'create' };
  if (live === source) return { file, live, kind: readFileSync(file, 'utf8') === source ? 'current' : 'update' };
  if (state.targets[file] === sha(live)) return { file, live, kind: 'update' };
  return { file, live, kind: 'drift' };
}

function syncContracts(activeHosts) {
  const state = loadState();
  const sources = {};
  const readSource = (name) => (sources[name] ??= readLf(join(SOURCE_DIR, name)));
  const plans = [];
  for (const host of activeHosts) {
    const { source, files } = contractTargets(host);
    if (readSource(source) === null) { fail(host, `source missing: ${join(SOURCE_DIR, source)}`); continue; }
    plans.push({ host, source, files });
  }

  // --capture: a drifted live file becomes the new repo source. Two different live edits for
  // one source cannot both win, so that source fails instead of picking one silently.
  if (flags.capture) {
    const captured = {};
    for (const plan of plans) {
      for (const file of plan.files) {
        const c = classify(file, readSource(plan.source), state);
        if (c.kind !== 'drift') continue;
        if (captured[plan.source] !== undefined && captured[plan.source] !== c.live) {
          fail(plan.host, `${file}: conflicts with another live edit of ${plan.source}; capture one by hand`);
          plan.refused = true;
          continue;
        }
        captured[plan.source] = c.live;
        line(dryRun ? 'would' : 'ok', plan.host, `capture ${file} -> ${join(SOURCE_DIR, plan.source)}`);
      }
    }
    for (const [name, text] of Object.entries(captured)) {
      if (!dryRun) writeFileSync(join(SOURCE_DIR, name), text);
      sources[name] = text;
    }
  }

  let stateChanged = false;
  for (const plan of plans) {
    if (plan.refused) continue;
    const source = readSource(plan.source);
    const checks = plan.files.map((file) => classify(file, source, state));
    const drifted = checks.filter((c) => c.kind === 'drift');
    if (flags.check) {
      for (const c of checks) {
        if (c.kind === 'current') line('ok', plan.host, `${c.file} current`);
        else fail(plan.host, `${c.file} ${c.kind === 'create' ? 'absent' : 'differs from'} ${plan.source}`);
      }
      continue;
    }
    // The host is all-or-nothing, so the Claude pair never ends up half-written.
    if (drifted.length && !flags.force) {
      for (const c of drifted) fail(plan.host, `${c.file} has local edits this script did not write; rerun with --force to back up and overwrite, or --capture to copy it into ${join(SOURCE_DIR, plan.source)}`);
      continue;
    }
    for (const c of checks) {
      if (c.kind === 'current') {
        // Record a matching file too, or the next source change would read it as a local edit.
        if (!dryRun && state.targets[c.file] !== sha(source)) { state.targets[c.file] = sha(source); stateChanged = true; }
        line('ok', plan.host, `${c.file} current`);
        continue;
      }
      const backup = c.live !== null && c.live !== source ? backupPath(c.file) : null;
      const note = `${c.kind === 'create' ? 'create' : 'update'} ${c.file}${backup ? ` (backup ${backup})` : ''}`;
      if (dryRun) { line('would', plan.host, note); continue; }
      if (backup) writeFileSync(backup, readFileSync(c.file));
      mkdirSync(dirname(c.file), { recursive: true });
      writeFileSync(c.file, source);
      state.targets[c.file] = sha(source);
      stateChanged = true;
      line('ok', plan.host, note);
    }
    if (!dryRun && plan.files.length > 1) {
      const [first, ...rest] = plan.files.map((f) => readFileSync(f));
      if (rest.some((b) => !b.equals(first))) fail(plan.host, `${plan.files.join(' and ')} are not byte-identical`);
    }
  }
  if (stateChanged && !dryRun) {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
  }
}

// ---------------------------------------------------------------- host CLIs

// PATH lookup without a shell. On Windows only PATHEXT extensions resolve, which is how a
// shell would resolve a bare name too.
function which(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      try {
        if (!statSync(candidate).isFile()) continue;
        if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
        return candidate;
      } catch { /* not here */ }
    }
  }
  return null;
}

// Every argument is a fixed token or a value checked here, so nothing a host CLI printed can
// reach cmd.exe as syntax. A value outside this set fails the step instead of being escaped.
const SAFE_ARG = /^[A-Za-z0-9@._:/+-]+$/;

function run(exe, args) {
  if (args.some((a) => !SAFE_ARG.test(a))) return { status: null, error: `unsafe argument in ${JSON.stringify(args)}` };
  let file = exe;
  let argv = args;
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CMD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 };
  // Node refuses to spawn a .cmd/.bat shim without a shell (CVE-2024-27980 hardening).
  if (process.platform === 'win32' && /^\.(cmd|bat)$/i.test(extname(exe))) {
    if (/["%^&|<>]/.test(exe)) return { status: null, error: `shim path has cmd metacharacters: ${exe}` };
    file = process.env.ComSpec || 'cmd.exe';
    argv = ['/d', '/s', '/c', `""${exe}" ${args.join(' ')}"`];
    options.windowsVerbatimArguments = true;
  }
  const r = spawnSync(file, argv, options);
  if (r.error) return { status: null, error: r.error.message };
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const lastLine = (text) => (text || '').trim().split(/\r?\n/).pop() || '';

function parseJson(text) { try { return JSON.parse(text); } catch { return undefined; } }

// Each host: the read-only probes that decide the plan, then the mutating commands.
const CACHE_HOSTS = {
  claude(exe, plugins) {
    const r = run(exe, ['plugin', 'list', '--json']);
    const list = r.status === 0 ? parseJson(r.stdout) : undefined;
    if (!Array.isArray(list)) return { error: `plugin list --json failed: ${r.error || lastLine(r.stderr)}` };
    const names = list.map((p) => String(p?.id || '')).filter((id) => id.endsWith(`@${MARKETPLACE}`))
      .map((id) => id.slice(0, -MARKETPLACE.length - 1)).filter((n) => plugins.includes(n));
    return { names, commands: [['plugin', 'marketplace', 'update', MARKETPLACE], ...names.map((n) => ['plugin', 'update', `${n}@${MARKETPLACE}`])] };
  },
  codex(exe, plugins) {
    const r = run(exe, ['plugin', 'list', '--marketplace', MARKETPLACE, '--json']);
    const list = r.status === 0 ? parseJson(r.stdout) : undefined;
    if (!Array.isArray(list?.installed)) return { error: `plugin list --json failed: ${r.error || lastLine(r.stderr)}` };
    const names = list.installed.filter((p) => p?.marketplaceName === MARKETPLACE && plugins.includes(p?.name)).map((p) => p.name);
    return { names, commands: [['plugin', 'marketplace', 'upgrade', MARKETPLACE], ...names.map((n) => ['plugin', 'add', `${n}@${MARKETPLACE}`])] };
  },
  grok(exe, plugins) {
    const m = run(exe, ['plugin', 'marketplace', 'list']);
    if (m.status !== 0) return { error: `plugin marketplace list failed: ${m.error || lastLine(m.stderr)}` };
    const url = m.stdout.split(/\r?\n/).map((l) => l.match(new RegExp(`^\\s*${MARKETPLACE}:\\s*(\\S+)\\s*$`))).find(Boolean)?.[1];
    if (!url) return { names: [], skip: `marketplace ${MARKETPLACE} is not configured` };
    const r = run(exe, ['plugin', 'list', '--json']);
    const list = r.status === 0 ? parseJson(r.stdout) : undefined;
    if (!Array.isArray(list)) return { error: `plugin list --json failed: ${r.error || lastLine(r.stderr)}` };
    const names = list.filter((p) => p?.marketplace === MARKETPLACE && plugins.includes(p?.name)).map((p) => p.name);
    return { names, commands: [['plugin', 'marketplace', 'update', MARKETPLACE], ...names.map((n) => ['plugin', 'update', n])] };
  },
};

function syncCaches(activeHosts) {
  let plugins;
  try {
    plugins = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins.map((p) => p.name);
  } catch (error) { fail('caches', `cannot read .claude-plugin/marketplace.json: ${error.message}`); return; }
  for (const host of activeHosts) {
    const exe = which(host);
    if (!exe) { line('skip', host, `${host} CLI not on PATH; caches not refreshed`); continue; }
    const plan = CACHE_HOSTS[host](exe, plugins);
    if (plan.error) { fail(host, plan.error); continue; }
    if (plan.skip || !plan.names.length) { line('skip', host, plan.skip || `no ${MARKETPLACE} plugins installed`); continue; }
    for (const args of plan.commands) {
      const shown = `$ ${host} ${args.join(' ')}`;
      if (dryRun) { line('would', host, shown); continue; }
      const r = run(exe, args);
      if (r.status === 0) line('ok', host, shown);
      else { fail(host, `${shown} -> ${r.error || `exit ${r.status}: ${lastLine(r.stderr) || lastLine(r.stdout)}`}`); break; }
    }
  }
}

// ---------------------------------------------------------------- main

const activeHosts = hosts.filter((host) => {
  if (isDir(hostHome(host))) return true;
  line('skip', host, `${hostHome(host)} does not exist`);
  return false;
});
if (doContracts) syncContracts(activeHosts);
if (doCaches) syncCaches(activeHosts);
if (dryRun) console.log('dry run: nothing was written');
process.exit(failed ? 1 : 0);
