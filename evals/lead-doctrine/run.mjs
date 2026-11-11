#!/usr/bin/env node
// Regression eval for plugins/code-ops-suite/hooks/lead-doctrine.mjs, the SessionStart hook that
// hands the Claude session lead the lead-only doctrine. It pins the contract the hook promises:
//   - on Claude (CLAUDECODE=1) with a live payload, stdout is the doctrine file, exactly, as plain
//     text under the host's 8,000-character context cap, for every SessionStart source;
//   - empty or blank stdin (the OpenCode bake convention) prints nothing;
//   - CLAUDECODE unset or not `1` (Codex, other hosts) prints nothing;
//   - GROK_PLUGIN_ROOT set prints nothing, because Grok discards SessionStart stdout;
//   - a missing, empty, or unreadable doctrine file prints the one visible missing line;
//   - every path exits 0, and no off switch silences it;
//   - hooks.json registers it as a SessionStart command with no matcher.
// The failure cases run against a temp copy of the hooks folder, never the real file.
//
//   node evals/lead-doctrine/run.mjs

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const hooksDir = join(root, 'plugins', 'code-ops-suite', 'hooks');
const hook = join(hooksDir, 'lead-doctrine.mjs');
const leadFile = join(hooksDir, 'lead-doctrine.claude.md');
const { fails, expect } = tally();
const CONTEXT_CAP = 8000;
const MISSING = /^code-ops lead doctrine is missing \(hooks\/lead-doctrine\.claude\.md\).*reinstall or update the code-ops-suite plugin\.\n$/;

// The parent may itself run inside Claude Code or Grok, so every spawn sets the host variables.
function run(input, env = {}, script = hook) {
  const base = { ...process.env };
  for (const key of ['CLAUDECODE', 'CLAUDE_PROJECT_DIR', 'GROK_PLUGIN_ROOT']) delete base[key];
  return spawnSync(process.execPath, [script], { input, encoding: 'utf8', env: { ...base, ...env }, timeout: 30000 });
}
const payload = (source) => JSON.stringify({ hook_event_name: 'SessionStart', source, session_id: 'lead-eval-0001', cwd: root });
const CLAUDE = { CLAUDECODE: '1' };

// ---------------------------------------------------------------- Claude, live payload
const doctrine = readFileSync(leadFile, 'utf8').replace(/^﻿/, '').trim();
expect(doctrine.length > 0, 'the real doctrine file is not empty');
for (const source of ['startup', 'resume', 'clear', 'compact']) {
  const r = run(payload(source), CLAUDE);
  expect(r.status === 0 && r.stdout === `${doctrine}\n`, `${source}: stdout must be the doctrine file, got ${r.status}/${JSON.stringify(r.stdout.slice(0, 80))}`);
}
const live = run(payload('startup'), CLAUDE);
let parsesAsJson = true;
try { JSON.parse(live.stdout); } catch { parsesAsJson = false; }
expect(!parsesAsJson && live.stderr === '', 'output is plain context text, as routing-card.mjs prints, with no stderr');
expect(live.stdout.length < CONTEXT_CAP, `output stays under the ${CONTEXT_CAP}-character context cap, got ${live.stdout.length}`);
expect(/^# Lead doctrine\n/.test(live.stdout) && /## Route models and work/.test(live.stdout), 'output carries the doctrine heading and its routing section');
const bom = run(`﻿${payload('startup')}`, CLAUDE);
expect(bom.status === 0 && bom.stdout === live.stdout, 'a BOM-prefixed payload still gets the doctrine');
for (const sw of ['off', '0', 'false']) {
  const r = run(payload('startup'), { ...CLAUDE, CODE_OPS_LEAD_DOCTRINE: sw, CODE_OPS_ROUTING_CARD: sw });
  expect(r.stdout === live.stdout, `no off switch: ${sw} must not silence the doctrine`);
}
console.log(`ok   Claude with a payload gets the doctrine (${Buffer.byteLength(live.stdout)} bytes) on startup, resume, clear, and compact`);

// ---------------------------------------------------------------- other hosts and the bake
const silent = [
  ['empty stdin', '', CLAUDE],
  ['blank stdin', '  \n', CLAUDE],
  ['CLAUDECODE unset', payload('startup'), {}],
  ['CLAUDECODE=0', payload('startup'), { CLAUDECODE: '0' }],
  ['CLAUDE_PROJECT_DIR only', payload('startup'), { CLAUDE_PROJECT_DIR: root }],
  ['Grok adapter', payload('startup'), { ...CLAUDE, GROK_PLUGIN_ROOT: join(root, 'plugins', 'code-ops-suite') }],
];
for (const [name, input, env] of silent) {
  const r = run(input, env);
  expect(r.status === 0 && r.stdout === '', `${name}: must exit 0 with no output, got ${r.status}/${JSON.stringify(r.stdout.slice(0, 80))}`);
}
console.log(`ok   ${silent.length} non-Claude or bake cases print nothing`);

// ---------------------------------------------------------------- fail visible (temp copy)
const tmp = mkdtempSync(join(tmpdir(), 'lead-doctrine-eval-'));
try {
  const copy = join(tmp, 'lead-doctrine.mjs');
  copyFileSync(hook, copy);
  const copyLead = join(tmp, 'lead-doctrine.claude.md');
  const cases = [
    ['missing file', () => {}],
    ['empty file', () => writeFileSync(copyLead, '')],
    ['whitespace-only file', () => writeFileSync(copyLead, '\n\n  \n')],
    ['unreadable file (a directory)', () => { rmSync(copyLead, { force: true }); mkdirSync(copyLead); }],
  ];
  for (const [name, setup] of cases) {
    setup();
    const r = run(payload('startup'), CLAUDE, copy);
    expect(r.status === 0 && MISSING.test(r.stdout), `${name}: must print the one missing line and exit 0, got ${r.status}/${JSON.stringify(r.stdout)}`);
    rmSync(copyLead, { recursive: true, force: true });
  }
  const quiet = run('', CLAUDE, copy);
  expect(quiet.status === 0 && quiet.stdout === '', 'missing file with empty stdin still prints nothing');
  console.log(`ok   ${cases.length} missing or unreadable doctrine cases print the visible line and exit 0`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------- registration
const manifest = JSON.parse(readFileSync(join(hooksDir, 'hooks.json'), 'utf8'));
const groups = (manifest.hooks?.SessionStart ?? []).filter((g) => (g.hooks ?? []).some((h) => /hooks\/lead-doctrine\.mjs"?$/.test(h.command ?? '')));
expect(groups.length === 1 && !groups[0].matcher, 'hooks.json registers lead-doctrine.mjs once on SessionStart with no matcher');
const elsewhere = Object.entries(manifest.hooks ?? {}).filter(([event, list]) => event !== 'SessionStart' && JSON.stringify(list).includes('lead-doctrine.mjs'));
expect(elsewhere.length === 0, 'lead-doctrine.mjs is registered on no other event');
console.log('ok   hooks.json registers the hook on SessionStart with no matcher');

if (fails.length) {
  for (const f of fails) console.log(`  x ${f}`);
  console.log(`\nlead-doctrine eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('\nlead-doctrine eval passed');
