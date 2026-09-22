#!/usr/bin/env node
// Proves the OpenCode lifecycle plugin: a stable system prefix, tail notes, a
// fail-closed chooser, and a cost ledger the report can gate.
//
//   node evals/opencode-lifecycle/run.mjs
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const work = mkdtempSync(join(tmpdir(), 'oc-lifecycle-'));
const fails = [];
const expect = (ok, msg) => { if (!ok) fails.push(msg); };

const floors = `const KNOWN_MODELS = {
  "anthropic": { "claude-haiku-4-5-20251001": "light", "claude-sonnet-5": "mid", "claude-opus-5-5": "strong", "claude-fable-5-1": "frontier" },
  "openai": { "gpt-6-luna": "light", "gpt-5.1": "mid", "gpt-5.6-terra": "strong", "gpt-6-sol": "frontier" },
  "xai": { "grok-4.7": "frontier", "grok-build-0.1": "light" },
  "opencode": { "muse-spark-1.3-contributor-free": "strong" },
  "accepted": { "claude-opus-5": "strong", "gpt-5.6-luna": "light", "grok-4.6": "frontier" }
};
`;
writeFileSync(join(work, 'code-ops-model-floors.js'), floors);
writeFileSync(join(work, 'code-ops-lifecycle.js'), readFileSync(join(root, 'scripts', 'opencode-lifecycle.js')));
writeFileSync(join(work, 'cost-report.mjs'), readFileSync(join(root, 'scripts', 'opencode-cost-report.mjs')));

const runs = join(work, 'code-ops-docs', '80 Runs', '2026-09-22 pending');
mkdirSync(runs, { recursive: true });
writeFileSync(join(runs, 'HANDOFF.md'), '# pending\n');

process.env.CODE_OPS_RECEIPTS = join(work, 'session-receipts.jsonl');
process.env.CODE_OPS_COST_LEDGER = join(work, 'opencode-cost.jsonl');
process.env.CODE_OPS_MODEL_PROFILE = join(work, 'no-profile.json');
process.env.CODE_OPS_DESKTOP_STORE = join(work, 'no-desktop-store.dat');
process.env.CODE_OPS_ROUND_BUDGET = '2';
process.env.CODE_OPS_OPENCODE_MODELS = [
  'provider-a/claude-opus-5-5',
  'provider-a/claude-sonnet-5',
  'provider-a/claude-fable-5-1',
  'provider-b/gpt-6-luna',
  'provider-b/gpt-6-sol',
  'provider-c/grok-4.7',
  'provider-c/grok-build-0.1',
  'opencode/muse-spark-1.3-contributor-free',
  'provider-z/not-a-real-model',
].join('\n');
delete process.env.CODE_OPS_LADDER_CARD;
delete process.env.CODE_OPS_HANDOFF_CARD;
delete process.env.CODE_OPS_HANDOFF_PICKUP;
delete process.env.CODE_OPS_DISPATCH_GUARD;

const overlay = await import(pathToFileURL(join(work, 'code-ops-lifecycle.js')).href);
expect(Object.keys(overlay).length === 1, `lifecycle exported ${Object.keys(overlay).join(', ')}`);
const { classifyChooserModel, pickChooserModel, buildChooserLadder } = overlay.CodeOpsLifecycle.internals;
const catalog = process.env.CODE_OPS_OPENCODE_MODELS.split('\n');
expect(classifyChooserModel('provider-b/gpt-6-luna') === 'light', 'gpt-6-luna should be light');
expect(classifyChooserModel('provider-a/claude-opus-5-5') === 'strong', 'opus 5.5 should be strong');
expect(classifyChooserModel('provider-c/grok-4.7') === 'frontier', 'grok-4.7 should meet frontier');
expect(classifyChooserModel('provider-c/grok-build-0.1') === 'light', 'grok-build should be light');
expect(classifyChooserModel('provider-z/not-a-real-model') === null, 'an unknown model must stay unbound');
expect(classifyChooserModel('github-copilot/gpt-5.6-luna') === 'light', 'a reseller id should use the accepted bare id');
expect(pickChooserModel('light', catalog) === 'provider-b/gpt-6-luna', `light pick should be gpt-6-luna, got ${pickChooserModel('light', catalog)}`);
expect(pickChooserModel('strong', catalog) === 'provider-a/claude-opus-5-5', `strong pick should be opus 5.5, got ${pickChooserModel('strong', catalog)}`);
const ladder = buildChooserLadder(catalog);
expect(!Object.values(ladder.agents).some((id) => String(id).includes('muse-spark')), 'chooser bound the Zen fallback');
expect(ladder.agents['code-ops-suite-explorer'] === 'provider-b/gpt-6-luna', 'explorer should bind luna');
expect(ladder.agents['code-ops-suite-implementer'] === 'provider-a/claude-opus-5-5', 'implementer should bind opus 5.5');

const hooks = await overlay.CodeOpsLifecycle({
  directory: work,
  client: { session: { get: async ({ path }) => (path.id === 'child' ? { parentID: 'lead' } : {}) } },
});
const leadSystem = { system: [] };
await hooks['experimental.chat.system.transform']({ sessionID: 'lead' }, leadSystem);
const later = { system: [] };
await hooks['experimental.chat.system.transform']({ sessionID: 'lead' }, later);
expect(JSON.stringify(later.system) === JSON.stringify(leadSystem.system), 'system prefix changed between model calls');

await hooks['chat.params']({ sessionID: 'lead', agent: 'build', model: { providerID: 'xai', id: 'grok-4.7' } });
await hooks.event({
  event: {
    type: 'message.updated',
    properties: {
      info: {
        role: 'assistant', sessionID: 'lead', providerID: 'xai', modelID: 'grok-4.7', id: 'msg-1', cost: 2,
        tokens: { input: 160000, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now() - 1000, completed: Date.now() },
      },
    },
  },
});
const nudge = { parts: [{ type: 'text', text: 'continue' }] };
await hooks['chat.message']({ sessionID: 'lead', agent: 'build' }, nudge);
const after = { system: [] };
await hooks['experimental.chat.system.transform']({ sessionID: 'lead' }, after);
expect(nudge.parts[0].text.includes('approximately 160,000 tokens'), 'handoff note missing from the user turn');
expect(nudge.parts[0].text.includes('about $2.00'), 'handoff note missing the host-reported spend');
expect(JSON.stringify(after.system) === JSON.stringify(leadSystem.system), 'the handoff note reached the system prompt');

let blocked = false;
try {
  await hooks['tool.execute.before']({ tool: 'task', sessionID: 'lead', callID: '1' }, { args: { prompt: 'do it', agent: 'general' } });
} catch (error) {
  blocked = String(error?.message ?? '').includes('is not a suite subagent');
}
expect(blocked, 'a general dispatch was not blocked');

const again = {
  role: 'assistant', sessionID: 'costlead', id: 'msg-1', cost: 2, providerID: 'xai', modelID: 'grok-4.7',
  tokens: { input: 1000, output: 20, reasoning: 0, cache: { read: 159000, write: 0 } }, time: { created: Date.now() },
};
await hooks.event({ event: { type: 'message.updated', properties: { info: again } } });
await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'costlead' } } });
await hooks.event({ event: { type: 'message.updated', properties: { info: { ...again, id: 'msg-2', cost: 0.5 } } } });
await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'costlead' } } });
const rows = readFileSync(process.env.CODE_OPS_COST_LEDGER, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((row) => row.sessionId === 'costlead');
expect(rows.length === 2 && rows[0].turns === 1 && rows[1].turns === 2 && rows[1].costUsd === 2.5, `cost ledger rows were ${JSON.stringify(rows)}`);

const profile = join(work, 'gate.json');
writeFileSync(profile, JSON.stringify({ credits_per_usd: 40, cost_gates: { max_context_peak: 100000 } }));
const tight = spawnSync(process.execPath, [join(work, 'cost-report.mjs'), '--ledger', process.env.CODE_OPS_COST_LEDGER, '--profile', profile, '--check'], { encoding: 'utf8' });
expect(tight.status === 1 && tight.stdout.includes('max_context_peak'), `cost report did not fail the gate: ${tight.stdout}`);

rmSync(work, { recursive: true, force: true });
if (fails.length) {
  console.error(fails.map((msg) => `FAIL ${msg}`).join('\n'));
  process.exit(1);
}
console.log('PASS OpenCode lifecycle');
if (!existsSync(join(root, 'scripts', 'opencode-lifecycle.js'))) process.exit(1);
