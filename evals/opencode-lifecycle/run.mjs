#!/usr/bin/env node
// Proves the OpenCode lifecycle plugin: a stable system prefix, tail notes, a
// fail-closed chooser, a cost ledger the report can gate, the context-ceiling
// dispatch gate with its handoff unlock, and the subagent stop at twice the budget.
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
delete process.env.CODE_OPS_CONTEXT_CEILING;
delete process.env.CODE_OPS_CONTEXT_THRESHOLD;
// Round counters and assessment markers live under the home directory; keep
// them inside the scratch tree.
process.env.HOME = work;
process.env.USERPROFILE = work;

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

// GitHub Copilot: the shipped floor plugin carries prices, so the chooser ranks
// the priced catalog by workload cost and the cost report prices cache writes.
const copilotDir = join(work, 'copilot');
mkdirSync(copilotDir);
for (const file of ['plugins/code-ops-model-floors.js', 'plugins/code-ops-lifecycle.js', 'code-ops/cost-report.mjs']) {
  writeFileSync(join(copilotDir, file.split('/').pop()), readFileSync(join(root, 'opencode-dist', file)));
}
const copilot = (await import(pathToFileURL(join(copilotDir, 'code-ops-lifecycle.js')).href)).CodeOpsLifecycle.internals;
const starter = JSON.parse(readFileSync(join(root, 'opencode-dist', 'configs', 'model-profile.github-copilot.json'), 'utf8'));
const copilotCatalog = starter.enabled;
for (const profileCase of [{}, starter]) {
  const label = profileCase === starter ? 'starter profile' : 'shipped prices';
  const picks = Object.fromEntries(['light', 'mid', 'strong', 'frontier'].map((tier) => [tier, copilot.pickChooserModel(tier, copilotCatalog, profileCase)]));
  const want = { light: 'github-copilot/gpt-6-luna', mid: 'github-copilot/gemini-3.8-flash', strong: 'github-copilot/gpt-6-sol', frontier: 'github-copilot/gpt-6-sol' };
  expect(JSON.stringify(picks) === JSON.stringify(want), `Copilot ${label} picks were ${JSON.stringify(picks)}`);
}
expect(copilot.classifyChooserModel('github-copilot/mai-code-1.1-flash') === 'light', 'mai-code-1.1-flash should classify light');
const withoutLuna = copilotCatalog.filter((id) => !id.endsWith('/gpt-6-luna'));
expect(copilot.pickChooserModel('light', withoutLuna, starter) === 'github-copilot/mai-code-1.1-flash', 'mai-code should take light once luna is absent');
expect(['mid', 'strong', 'frontier'].every((tier) => copilot.pickChooserModel(tier, ['github-copilot/mai-code-1.1-flash'], starter) === null), 'mai-code bound above light');
const { modelSupportsTier } = await import(pathToFileURL(join(root, 'scripts', 'model-tiers.mjs')).href);
expect(modelSupportsTier('claude-opus-5.5', 'strong'), 'the Copilot Opus 5.5 spelling should support strong');
const copilotLedger = join(copilotDir, 'ledger.jsonl');
writeFileSync(copilotLedger, `${JSON.stringify({
  sessionId: 'copilot-lead', ts: new Date().toISOString(), turns: 1, costUsd: 0, models: ['github-copilot/gpt-6-sol'],
  tokens: { input: 1_000_000, cacheCreate: 1_000_000, cacheRead: 0, output: 0, thinking: 0 },
})}\n`);
const copilotReport = spawnSync(process.execPath, [join(copilotDir, 'cost-report.mjs'), '--ledger', copilotLedger, '--profile', join(work, 'no-profile.json'), '--json'], { encoding: 'utf8' });
const copilotUsd = JSON.parse(copilotReport.stdout || '{}').totals?.usd;
expect(Math.abs(copilotUsd - 4.5) < 1e-9, `cost report should price cache writes at cacheWrite ($4.50), got ${copilotUsd}`);

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

// Context ceiling: past 300,000 tokens the lead assesses before it dispatches.
const setContext = (hooksFor, sessionID, input, id) => hooksFor.event({
  event: { type: 'message.updated', properties: { info: { role: 'assistant', sessionID, id, tokens: { input, output: 0, cache: { read: 0, write: 0 } } } } },
});
const dispatch = async (hooksFor, sessionID) => {
  try {
    await hooksFor['tool.execute.before']({ tool: 'task', sessionID, callID: 'd' }, { args: { prompt: 'Round budget: 5. do it', subagent_type: 'code-ops-suite-implementer' } });
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
};
await setContext(hooks, 'ceil', 320000, 'c1');
const ceilTurn = { parts: [{ type: 'text', text: 'keep going' }] };
await hooks['chat.message']({ sessionID: 'ceil', agent: 'build' }, ceilTurn);
expect(ceilTurn.parts[0].text.includes('New dispatches are gated until that assessment runs.'), 'the handoff note did not name the dispatch gate');
let gate = await dispatch(hooks, 'ceil');
expect(gate?.startsWith('Dispatch guard:') && gate.includes('300,000-token context ceiling') && gate.includes('/code-ops-suite-handoff assess'), `past the ceiling a dispatch was not gated: ${gate}`);
await hooks['tool.execute.before']({ tool: 'skill', sessionID: 'ceil', callID: 's' }, { args: { name: 'code-ops-suite-handoff' } });
gate = await dispatch(hooks, 'ceil');
expect(gate === null, `the handoff skill did not unlock dispatch: ${gate}`);
const marker = join(work, '.claude', 'code-ops', 'dispatch');
expect(existsSync(marker), 'no assessment marker was written');
await setContext(hooks, 'ceil', 460000, 'c2');
gate = await dispatch(hooks, 'ceil');
expect(gate?.includes('past the 300,000-token context ceiling'), `the next band did not re-gate: ${gate}`);
// A user-typed handoff command on a later prompt counts as the assessment too.
await hooks['chat.message']({ sessionID: 'ceil', agent: 'build' }, { parts: [{ type: 'text', text: '/code-ops-suite-handoff assess' }] });
gate = await dispatch(hooks, 'ceil');
expect(gate === null, `a typed handoff did not unlock dispatch: ${gate}`);
// The assessed band survives a host restart.
const restarted = await overlay.CodeOpsLifecycle({ directory: work, client: { session: { get: async () => ({}) } } });
await setContext(restarted, 'ceil', 470000, 'c3');
gate = await dispatch(restarted, 'ceil');
expect(gate === null, `the assessment did not survive a restart: ${gate}`);

const ceilingCase = async (value, sessionID, input) => {
  if (value === undefined) delete process.env.CODE_OPS_CONTEXT_CEILING; else process.env.CODE_OPS_CONTEXT_CEILING = value;
  await setContext(hooks, sessionID, input, `${sessionID}-1`);
  const result = await dispatch(hooks, sessionID);
  delete process.env.CODE_OPS_CONTEXT_CEILING;
  return result;
};
expect(await ceilingCase('off', 'env-off', 900000) === null, 'CODE_OPS_CONTEXT_CEILING=off still gated');
expect(await ceilingCase('0', 'env-zero', 900000) === null, 'CODE_OPS_CONTEXT_CEILING=0 still gated');
expect(await ceilingCase('400000', 'env-under', 320000) === null, 'an override of 400000 gated at 320,000 tokens');
expect((await ceilingCase('400000', 'env-over', 410000))?.includes('400,000-token context ceiling'), 'an override of 400000 did not gate at 410,000 tokens');
expect((await ceilingCase('1000', 'env-small', 320000))?.includes('300,000-token context ceiling'), 'an override below 150000 did not fall back to the default');
expect((await ceilingCase('lots', 'env-junk', 320000))?.includes('300,000-token context ceiling'), 'a junk override did not fall back to the default');

process.env.CODE_OPS_DISPATCH_GUARD = 'warn';
await setContext(hooks, 'warned', 320000, 'w1');
gate = await dispatch(hooks, 'warned');
const warnOut = { output: 'done' };
await hooks['tool.execute.after']({ tool: 'task', sessionID: 'warned', callID: 'd' }, warnOut);
delete process.env.CODE_OPS_DISPATCH_GUARD;
expect(gate === null && warnOut.output.includes('context ceiling'), `warn mode did not downgrade the gate to a note: ${gate} / ${warnOut.output}`);

// A subagent stops at twice its round budget (CODE_OPS_ROUND_BUDGET=2 above).
const rounds = [];
for (let i = 0; i < 4; i += 1) {
  try {
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 'child', callID: `r${i}` }, { args: {} });
    rounds.push(null);
  } catch (error) {
    rounds.push(String(error?.message ?? error));
  }
}
expect(rounds.slice(0, 3).every((r) => r === null) && rounds[3]?.includes('4 tool rounds used, twice the 2-round budget'), `the subagent stop was not at twice the budget: ${JSON.stringify(rounds)}`);

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
