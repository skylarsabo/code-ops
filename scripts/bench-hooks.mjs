#!/usr/bin/env node
// Measures the wall-clock cost of every hook command in a plugin's hooks.json, per event entry.
// Each case spawns the commands of one entry one after another with a representative stdin
// payload, in a throwaway repository and home, and compares the total against the same number
// of bare `node -e 0` spawns. Cases and baselines run interleaved, so drift hits all of them.
// The fixture board holds 5 live peers and the feed holds their push events, so the collision
// note and the change feed do real work in the Edit and `git push` cases. The `-solo` push cases
// run against an empty home with no other live peer, and reset it before each run.
// Sequential spawning is the conservative model: a host that runs an entry's commands in
// parallel adds less. Exits non-zero when any spawn fails, so a broken hook is never a fast one.
//
//   node scripts/bench-hooks.mjs [--plugin-root <dir>] [--runs <n>] [--warmup <n>] [--env KEY=VAL]... [--json]
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

let cleanup = () => {};
const die = (message, code = 1) => { console.error(`x ${message}`); cleanup(); process.exit(code); };
const usage = () => die('usage: bench-hooks.mjs [--plugin-root <dir>] [--runs <n>] [--warmup <n>] [--env KEY=VAL]... [--json]', 2);

function parse(argv) {
  const options = { pluginRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'code-ops-suite'), runs: 100, warmup: 2, env: {}, json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') { options.json = true; continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) usage();
    if (flag === '--plugin-root') options.pluginRoot = resolve(value);
    else if (flag === '--runs' || flag === '--warmup') {
      if (!/^\d+$/.test(value) || (flag === '--runs' && Number(value) < 1) || Number(value) > 10000) usage();
      options[flag.slice(2)] = Number(value);
    } else if (flag === '--env') {
      const at = value.indexOf('=');
      if (at < 1) usage();
      options.env[value.slice(0, at)] = value.slice(at + 1);
    } else usage();
  }
  return options;
}

// The bench key of one hooks.json entry. An entry the bench has no payload for fails closed.
function idOf(event, matcher) {
  const m = matcher ?? '';
  if (event === 'PreToolUse') return /Bash/.test(m) ? 'pre-bash' : /Send/.test(m) ? 'pre-message' : m ? null : 'pre-all';
  if (event === 'PostToolUse') return /Edit/.test(m) ? 'post-edit' : /Agent/.test(m) ? 'post-agent' : m ? null : 'post-all';
  return ['UserPromptSubmit', 'SessionStart', 'SessionEnd', 'SubagentStart', 'SubagentStop'].includes(event) ? event : null;
}

const pushCommand = 'git push origin HEAD';

// Representative payloads: synthetic ids and the throwaway fixture paths only.
function payloadsFor(id, ctx) {
  const base = { session_id: 'bench-session', transcript_path: ctx.transcript, cwd: ctx.repo };
  const pre = (tool_name, tool_input) => ({ ...base, hook_event_name: 'PreToolUse', tool_name, tool_input });
  const post = (tool_name, tool_input, tool_response) => ({ ...base, hook_event_name: 'PostToolUse', tool_name, tool_input, tool_response });
  const readInput = { file_path: join(ctx.repo, 'README.md') };
  const agent = 'code-ops-suite:implementer';
  switch (id) {
    case 'pre-bash': return [
      { id, label: 'PreToolUse, Bash `git status`', payload: pre('Bash', { command: 'git status --short' }) },
      { id: 'pre-bash-commit', label: 'PreToolUse, Bash `git commit`', payload: pre('Bash', { command: 'git commit -m "Add hook latency bench"' }) },
      { id: 'pre-bash-push', label: 'PreToolUse, Bash `git push`', payload: pre('Bash', { command: pushCommand }) },
    ];
    // The Edit and git push cases run against the seeded board: 5 live peers, one overlapping path.
    // The Edit case clears the collision seen-set first, so every timed run pays the first-fire path.
    case 'pre-all': return [
      { id, label: 'PreToolUse, all tools (`Read`)', payload: pre('Read', readInput) },
      { id: 'pre-all-edit', label: 'PreToolUse, all tools (`Edit`, collision)', payload: pre('Edit', { file_path: join(ctx.repo, 'src', 'a.mjs'), old_string: 'a', new_string: 'b' }), reset: ctx.resetCollision },
      { id: 'pre-all-bash', label: 'PreToolUse, all tools (Bash `git status`, no collision)', payload: pre('Bash', { command: 'git status --short' }) },
      { id: 'pre-all-push', label: 'PreToolUse, all tools (Bash `git push`, collision)', payload: pre('Bash', { command: pushCommand }) },
      { id: 'pre-all-push-solo', label: 'PreToolUse, all tools (Bash `git push`, solo session)', payload: pre('Bash', { command: pushCommand }), reset: ctx.resetSolo, solo: true },
      { id: 'pre-all-agent', label: 'PreToolUse, all tools (`Agent` dispatch)', payload: pre('Agent', { subagent_type: agent, description: 'bench', prompt: ['Scope: one file.', 'Objective: bench.', 'Round budget: 20.', 'Report cap: 40 lines.', 'Report path: report.md', 'Expected return: verdict.'].join('\n') }) },
    ];
    case 'pre-message': return [{ id, label: 'PreToolUse, message tool (`SendMessage`)', payload: pre('SendMessage', { to: 'peer-session', message: 'status' }) }];
    case 'post-edit': return [{ id, label: 'PostToolUse, edit tool (`Edit`)', payload: post('Edit', { file_path: join(ctx.repo, 'src', 'a.mjs'), old_string: 'a', new_string: 'b' }, { success: true }) }];
    case 'post-agent': return [{ id, label: 'PostToolUse, dispatch tool (`Agent`, background launch)', payload: post('Agent', { subagent_type: agent, description: 'bench', run_in_background: true }, { status: 'async_launched', agentId: 'bench-agent' }) }];
    // The push case records the move, then delivers the seeded peer events; it resets the feed cursors first.
    case 'post-all': return [
      { id, label: 'PostToolUse, all tools (`Read`)', payload: post('Read', readInput, { type: 'text' }) },
      { id: 'post-all-push', label: 'PostToolUse, all tools (Bash `git push`, seeded feed)', payload: post('Bash', { command: pushCommand }, { stdout: '', stderr: ctx.pushSummary, exit_code: 0 }), reset: ctx.resetFeed },
      { id: 'post-all-push-solo', label: 'PostToolUse, all tools (Bash `git push`, solo session)', payload: post('Bash', { command: pushCommand }, { stdout: '', stderr: ctx.pushSummary, exit_code: 0 }), reset: ctx.resetSolo, solo: true },
    ];
    case 'UserPromptSubmit': return [{ id, label: 'UserPromptSubmit', payload: { ...base, hook_event_name: id, prompt: 'Continue with the next unit.' } }];
    case 'SessionStart': return [{ id, label: 'SessionStart', payload: { ...base, hook_event_name: id, source: 'startup' } }];
    case 'SessionEnd': return [{ id, label: 'SessionEnd', payload: { ...base, hook_event_name: id, reason: 'other' } }];
    case 'SubagentStart': return [{ id, label: 'SubagentStart', payload: { ...base, hook_event_name: id, agent_type: agent, agent_id: 'bench-agent' } }];
    case 'SubagentStop': return [{ id, label: 'SubagentStop', payload: { ...base, hook_event_name: id, agent_type: agent, agent_id: 'bench-agent', last_assistant_message: 'DONE: bench, 1 file changed' } }];
    default: return die(`no payload for ${id}`);
  }
}

// One argv per command: `node "<path>"` with the plugin root substituted, run by this Node.
function argvOf(command, pluginRoot) {
  const tokens = [...command.replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot).matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  if (tokens[0] !== 'node' || tokens.length < 2) die(`unsupported hook command: ${command}`);
  return [process.execPath, ...tokens.slice(1)];
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bench-hooks-'));
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  mkdirSync(join(repo, 'src'), { recursive: true });
  const soloHome = join(root, 'home-solo');
  mkdirSync(home, { recursive: true });
  mkdirSync(soloHome, { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# Fixture\n');
  writeFileSync(join(repo, 'src', 'a.mjs'), 'export const a = 1;\n');
  const turn = (i) => JSON.stringify({ type: 'assistant', timestamp: '2026-09-29T00:00:00.000Z', message: { role: 'assistant', model: 'claude-sonnet-5-5', usage: { input_tokens: 3, cache_read_input_tokens: 40000 + i, cache_creation_input_tokens: 500, output_tokens: 200 }, content: [{ type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }] } });
  const transcript = join(root, 'transcript.jsonl');
  writeFileSync(transcript, `${Array.from({ length: 200 }, (_, i) => turn(i)).join('\n')}\n`);
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', ...args], { cwd: repo, encoding: 'utf8' });
    if (r.status !== 0) die(`git ${args[0]} failed: ${r.stderr || r.error}`);
    return r.stdout.trim();
  };
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'Fixture');
  writeFileSync(join(repo, 'src', 'b.mjs'), 'export const b = 2;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'Second commit');
  writeFileSync(join(repo, 'src', 'wip.mjs'), 'export const wip = 3;\n'); // uncommitted, so `git status` has a path to overlap
  // The push summary git prints for the second commit, which the PostToolUse push case replays.
  const pushSummary = `To origin\n   ${git('rev-parse', '--short', 'HEAD~1')}..${git('rev-parse', '--short', 'HEAD')}  HEAD -> ${git('rev-parse', '--abbrev-ref', 'HEAD')}`;
  return { root, repo, home, soloHome, transcript, pushSummary };
}

// Seeds the presence board with 5 live peers on this branch. Peer 0 claims and recently edited
// `src/a.mjs` (the Edit case's path) and edited `src/wip.mjs` (the uncommitted file), so both the
// edit note and the git note fire. Then seeds the change feed with one push event per peer.
async function seed(ctx) {
  const { repoIdentity, updateBoard, boardEdits } = await import('./handoff-state.mjs');
  const { postEvent, feedRoot } = await import('./change-feed.mjs');
  for (let i = 0; i < 5; i++) {
    const own = Array.from({ length: 4 }, (_, k) => join('src', `peer${i}-${k}.mjs`));
    const edits = i === 0 ? ['src/a.mjs', 'src/wip.mjs', ...own] : own;
    updateBoard(ctx.repo, `bench-peer-${i}`, (rec, ident) => {
      rec.name = `bench peer ${i}`;
      rec.task = 'bench fixture peer';
      rec.claims = i === 0 ? ['src/a.mjs'] : [];
      boardEdits(edits)(rec, ident);
    }, ctx.home);
    const move = await postEvent(ctx.repo, { kind: 'push', sid: `bench-peer-${i}`, commit: `${i}`.repeat(7), paths: edits }, ctx.home);
    if (!move) die('cannot seed the change feed');
  }
  const ident = repoIdentity(ctx.repo);
  const feed = join(feedRoot(ctx.home), ident.key);
  const events = readFileSync(join(feed, 'events.jsonl'), 'utf8');
  ctx.resetCollision = () => rmSync(join(ctx.home, '.claude', 'code-ops', 'collision'), { recursive: true, force: true });
  ctx.resetSolo = () => rmSync(join(ctx.soloHome, '.claude'), { recursive: true, force: true });
  ctx.resetFeed = () => {
    writeFileSync(join(feed, 'events.jsonl'), events);
    rmSync(join(feed, 'cursors'), { recursive: true, force: true });
    rmSync(join(feedRoot(ctx.home), 'seen'), { recursive: true, force: true });
  };
}

function percentile(sorted, p) { return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]; }
const stats = (values) => { const s = [...values].sort((a, b) => a - b); return { p50: percentile(s, 0.5), p95: percentile(s, 0.95) }; };
const round1 = (n) => Math.round(n * 10) / 10;

const options = parse(process.argv.slice(2));
let hooks;
try { hooks = JSON.parse(readFileSync(join(options.pluginRoot, 'hooks', 'hooks.json'), 'utf8')).hooks; } catch (error) { die(`cannot read hooks.json under --plugin-root: ${error.message}`, 2); }
const ctx = fixture();
cleanup = () => rmSync(ctx.root, { recursive: true, force: true });
try {
  await seed(ctx);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CODE_OPS_|GROK_|CODEX_|CLAUDE_PLUGIN_ROOT$)/.test(k)));
  const homeEnv = (home) => ({ CODE_OPS_HOME: home, HOME: home, USERPROFILE: home });
  Object.assign(env, { CLAUDE_PLUGIN_ROOT: options.pluginRoot }, homeEnv(ctx.home), options.env);
  const soloEnv = { ...env, ...homeEnv(ctx.soloHome), ...options.env };

  const cases = [];
  for (const [event, entries] of Object.entries(hooks)) {
    for (const entry of entries) {
      const id = idOf(event, entry.matcher);
      if (!id) die(`no bench payload for ${event} matcher "${entry.matcher}"`);
      const argvs = entry.hooks.map((h) => argvOf(h.command, options.pluginRoot));
      for (const variant of payloadsFor(id, ctx)) cases.push({ ...variant, argvs, input: JSON.stringify(variant.payload), samples: [], stdoutRuns: 0 });
    }
  }
  for (const k of new Set(cases.map((c) => c.argvs.length))) {
    cases.push({ id: `base${k}`, label: `Baseline, ${k} x \`node -e 0\``, baseline: k, argvs: Array.from({ length: k }, () => [process.execPath, '-e', '0']), input: '', samples: [], stdoutRuns: 0 });
  }

  const once = (c, timed) => {
    c.reset?.();
    const start = performance.now();
    for (const argv of c.argvs) {
      const r = spawnSync(argv[0], argv.slice(1), { cwd: ctx.repo, env: c.solo ? soloEnv : env, input: c.input, encoding: 'utf8', timeout: 60000 });
      if (r.error || r.status !== 0) die(`${c.label}: ${argv.slice(1).join(' ').slice(-60)} failed (${r.error?.message ?? `exit ${r.status}`}) ${String(r.stderr).slice(0, 200)}`);
      if (timed && r.stdout) c.stdoutRuns++;
    }
    return performance.now() - start;
  };
  for (let i = 0; i < options.warmup + options.runs; i++) {
    const timed = i >= options.warmup;
    for (let j = 0; j < cases.length; j++) { // rotate the start so no case always runs first
      const c = cases[(i + j) % cases.length];
      const ms = once(c, timed);
      if (timed) c.samples.push(ms);
    }
  }

  const baseline = (c) => cases.find((b) => b.baseline === c.argvs.length);
  const rows = cases.map((c) => {
    const own = stats(c.samples);
    const added = c.baseline ? { p50: 0, p95: 0 } : { p50: own.p50 - stats(baseline(c).samples).p50, p95: own.p95 - stats(baseline(c).samples).p95 };
    return { id: c.id, label: c.label, commands: c.argvs.length, p50: round1(own.p50), p95: round1(own.p95), addedP50: round1(added.p50), addedP95: round1(added.p95), stdoutRuns: c.stdoutRuns };
  });

  // Added latency per tool call: the entries that fire together, summed per iteration.
  const byId = Object.fromEntries(cases.map((c) => [c.id, c]));
  const calls = [
    ['Bash tool call', ['pre-bash', 'pre-all-bash', 'post-all']],
    ['Bash `git push` tool call, with peers', ['pre-bash-push', 'pre-all-push', 'post-all-push']],
    ['Bash `git push` tool call, solo session', ['pre-bash-push', 'pre-all-push-solo', 'post-all-push-solo']],
    ['Edit tool call', ['pre-all-edit', 'post-edit', 'post-all']],
    ['Other tool call (`Read`)', ['pre-all', 'post-all']],
    ['Message tool call', ['pre-all', 'pre-message', 'post-all']],
  ].filter(([, ids]) => ids.every((id) => byId[id])).map(([label, ids]) => {
    const total = options.runs;
    const sum = (pick) => Array.from({ length: total }, (_, i) => ids.reduce((acc, id) => acc + pick(byId[id], i), 0));
    const own = stats(sum((c, i) => c.samples[i]));
    const base = stats(sum((c, i) => baseline(c).samples[i]));
    return { label, entries: ids, p50: round1(own.p50), p95: round1(own.p95), addedP50: round1(own.p50 - base.p50), addedP95: round1(own.p95 - base.p95) };
  });

  const meta = { node: process.version, platform: process.platform, runs: options.runs, warmup: options.warmup, env: options.env };
  if (options.json) console.log(JSON.stringify({ version: 1, ...meta, cases: rows, toolCalls: calls }, null, 2));
  else {
    console.log(`Node ${meta.node} on ${meta.platform}; ${meta.warmup} warmups, ${meta.runs} timed runs per case; env overrides: ${JSON.stringify(meta.env)}\n`);
    console.log('| Case | Commands | p50 ms | p95 ms | Added p50 ms | Added p95 ms | Spawns with stdout |\n| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) console.log(`| ${r.label} | ${r.commands} | ${r.p50} | ${r.p95} | ${r.addedP50} | ${r.addedP95} | ${r.stdoutRuns} |`);
    console.log('\n| Tool call | Entries | p50 ms | p95 ms | Added p50 ms | Added p95 ms |\n| --- | --- | --- | --- | --- | --- |');
    for (const r of calls) console.log(`| ${r.label} | ${r.entries.join(' + ')} | ${r.p50} | ${r.p95} | ${r.addedP50} | ${r.addedP95} |`);
  }
} finally {
  cleanup();
}
