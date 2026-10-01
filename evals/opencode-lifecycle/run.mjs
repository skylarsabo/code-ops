#!/usr/bin/env node
// Proves the OpenCode lifecycle plugin: a stable system prefix, tail notes, a
// fail-closed chooser, a cost ledger the report can gate, the context-ceiling
// dispatch gate with its handoff unlock, the subagent stop at 1.5 times the budget,
// rounded down and at least one call past it, and a
// pickup line that names the handoff's program ledger only when it has one, the deny of an
// edit under a manifest `removed` legacy path, and the read notice for a record not in force.
//
//   node evals/opencode-lifecycle/run.mjs
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const work = mkdtempSync(join(tmpdir(), 'oc-lifecycle-'));
const { fails, expect } = tally();

const floors = `const KNOWN_MODELS = {
  "anthropic": { "claude-haiku-4-5-20251001": "light", "claude-sonnet-5": "mid", "claude-opus-5-5": "strong", "claude-fable-5-1": "frontier" },
  "openai": { "gpt-6-luna": "light", "gpt-5.1": "mid", "gpt-5.6-terra": "strong", "gpt-6-sol": "frontier" },
  "xai": { "grok-4.7": "frontier", "grok-build-0.1": "light" },
  "opencode": { "muse-spark-1.3-contributor-free": "strong" },
  "github-copilot": { "gpt-6-sol": "frontier", "grok-4.7": "strong" },
  "accepted": { "claude-opus-5": "strong", "gpt-5.6-luna": "light", "grok-4.6": "frontier" }
};
const SPECIALIST_MODELS = {
  "github-copilot": ["grok-4.7"]
};
`;
writeFileSync(join(work, 'code-ops-model-floors.js'), floors);
writeFileSync(join(work, 'code-ops-lifecycle.js'), readFileSync(join(root, 'scripts', 'opencode-lifecycle.js')));
writeFileSync(join(work, 'cost-report.mjs'), readFileSync(join(root, 'scripts', 'opencode-cost-report.mjs')));
writeFileSync(join(work, 'legacy-paths-lib.mjs'), readFileSync(join(root, 'scripts', 'legacy-paths-lib.mjs')));

const runs = join(work, 'code-ops-docs', '80 Runs', '2026-09-22 pending');
mkdirSync(runs, { recursive: true });
writeFileSync(join(runs, 'HANDOFF.md'), '# pending\n\n## Program\n\nProgram: `code-ops-docs/80 Runs/PROGRAM.md`\nPredecessor: none\nSession: Ledger2 AMM HO 1\nHop: 1\n\n## Next\n');

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
const { classifyChooserModel, pickChooserModel, buildChooserLadder, pendingHandoffs } = overlay.CodeOpsLifecycle.internals;
const catalog = process.env.CODE_OPS_OPENCODE_MODELS.split('\n');
expect(classifyChooserModel('provider-b/gpt-6-luna') === 'light', 'gpt-6-luna should be light');
expect(classifyChooserModel('provider-a/claude-opus-5-5') === 'strong', 'opus 5.5 should be strong');
expect(classifyChooserModel('provider-c/grok-4.7') === 'frontier', 'grok-4.7 should meet frontier');
expect(classifyChooserModel('provider-c/grok-build-0.1') === 'light', 'grok-build should be light');
expect(classifyChooserModel('reseller/grok-4.7') === 'frontier', `a Copilot specialist row set the reseller grok-4.7 tier: ${classifyChooserModel('reseller/grok-4.7')}`);
expect(classifyChooserModel('github-copilot/grok-4.7') === 'strong', 'the Copilot grok-4.7 row should still resolve strong');
expect(classifyChooserModel('github-copilot/gpt-6-sol') === 'frontier', 'the Copilot gpt-6-sol ladder row should still resolve frontier');
expect(classifyChooserModel('provider-z/not-a-real-model') === null, 'an unknown model must stay unbound');
expect(classifyChooserModel('github-copilot/gpt-5.6-luna') === 'light', 'a reseller id should use the accepted bare id');
expect(pickChooserModel('light', catalog) === 'provider-b/gpt-6-luna', `light pick should be gpt-6-luna, got ${pickChooserModel('light', catalog)}`);
expect(pickChooserModel('strong', catalog) === 'provider-a/claude-opus-5-5', `strong pick should be opus 5.5, got ${pickChooserModel('strong', catalog)}`);
const ladder = buildChooserLadder(catalog);
expect(!Object.values(ladder.agents).some((id) => String(id).includes('muse-spark')), 'chooser bound the Zen fallback');
expect(ladder.agents['code-ops-suite-explorer'] === 'provider-b/gpt-6-luna', 'explorer should bind luna');
expect(ladder.agents['code-ops-suite-implementer'] === 'provider-a/claude-opus-5-5', 'implementer should bind opus 5.5');
expect(ladder.warning === null, `an absent enabled list warned: ${ladder.warning}`);

// An enabled list that names nothing this host offers enables nothing: no
// catalog fallback, no binding, and a warning that names the profile path.
const unmatched = buildChooserLadder(catalog, { enabled: ['other-host/claude-opus-5'] });
expect(Object.keys(unmatched.agents).length === 0, `an unmatched enabled list bound ${JSON.stringify(unmatched.agents)}`);
expect(Object.values(unmatched.byTier).every((id) => !id), `an unmatched enabled list filled the ladder: ${JSON.stringify(unmatched.byTier)}`);
expect(unmatched.warning?.includes(process.env.CODE_OPS_MODEL_PROFILE), `the unmatched-list warning should name the profile path: ${unmatched.warning}`);
const narrowed = buildChooserLadder(catalog, { enabled: ['gpt-6-luna'] });
expect(Object.values(narrowed.agents).every((id) => id === 'provider-b/gpt-6-luna') && narrowed.warning === null, `a matching enabled list should bind only its models: ${JSON.stringify(narrowed.agents)}`);

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
  client: { session: { get: async ({ path }) => (path.id.startsWith('child') ? { parentID: 'lead' } : {}) } },
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

// Effort ceiling: a request above high runs at high and says so.
expect(overlay.CodeOpsLifecycle.internals.resolveEffort('code-ops-suite-implementer', 'xhigh').level === 'high', 'resolveEffort did not clamp xhigh to high');
await hooks['tool.execute.before']({ tool: 'task', sessionID: 'eff-lead', callID: 'e1' }, { args: { prompt: 'Round budget: 5.\nEffort: xhigh\ndo it', subagent_type: 'code-ops-suite-implementer' } });
const effTurn = { parts: [{ type: 'text', text: 'continue' }] };
await hooks['chat.message']({ sessionID: 'eff-lead', agent: 'build' }, effTurn);
expect(effTurn.parts[0].text.includes('Effort "xhigh" is above high; it runs at high.'), `an Effort: xhigh dispatch did not surface the clamp note: ${effTurn.parts[0].text}`);
await hooks['chat.message']({ sessionID: 'eff-child', agent: 'code-ops-suite-implementer' }, { parts: [{ type: 'text', text: 'Effort: xhigh\ndo it' }] });
const effParams = {};
await hooks['chat.params']({ sessionID: 'eff-child', agent: 'code-ops-suite-implementer', model: { providerID: 'p', id: 'm', variants: { low: { e: 'low' }, high: { e: 'high' }, xhigh: { e: 'xhigh' } } } }, effParams);
expect(effParams.options?.e === 'high', `an Effort: xhigh child did not clamp to the high variant: ${JSON.stringify(effParams.options)}`);

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
expect(ceilTurn.parts[0].text.includes('New dispatches are now gated until you run /code-ops-suite-handoff assess.'), 'the handoff note did not name the dispatch gate');
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

// Grok prices double above 200,000 tokens, so a session on a Grok model gates there.
const modelContext = (sessionID, input, modelID) => hooks.event({
  event: { type: 'message.updated', properties: { info: { role: 'assistant', sessionID, id: `${sessionID}-1`, providerID: 'provider-c', modelID, tokens: { input, output: 0, cache: { read: 0, write: 0 } } } } },
});
await modelContext('grok-lead', 210000, 'grok-4.7');
gate = await dispatch(hooks, 'grok-lead');
expect(gate?.includes('200,000-token context ceiling'), `a Grok session was not gated at 210,000 tokens: ${gate}`);
await modelContext('other-lead', 250000, 'gpt-6-sol');
gate = await dispatch(hooks, 'other-lead');
expect(gate === null, `a non-Grok session was gated at 250,000 tokens: ${gate}`);

process.env.CODE_OPS_DISPATCH_GUARD = 'warn';
await setContext(hooks, 'warned', 320000, 'w1');
gate = await dispatch(hooks, 'warned');
const warnOut = { output: 'done' };
await hooks['tool.execute.after']({ tool: 'task', sessionID: 'warned', callID: 'd' }, warnOut);
delete process.env.CODE_OPS_DISPATCH_GUARD;
expect(gate === null && warnOut.output.includes('context ceiling'), `warn mode did not downgrade the gate to a note: ${gate} / ${warnOut.output}`);

// A subagent stops at 1.5 times its round budget, rounded down and at least one call
// past the budget (CODE_OPS_ROUND_BUDGET=2 above, so stop at call 3).
const roundStop = async (sessionID, calls) => {
  const out = [];
  for (let i = 0; i < calls; i += 1) {
    try {
      await hooks['tool.execute.before']({ tool: 'read', sessionID, callID: `r${i}` }, { args: {} });
      out.push(null);
    } catch (error) {
      out.push(String(error?.message ?? error));
    }
  }
  return out;
};
const rounds = await roundStop('child', 3);
expect(rounds.slice(0, 2).every((r) => r === null) && rounds[2]?.includes('3 tool rounds used, the hard stop at 1.5 times the 2-round budget, rounded down'), `the subagent stop was not at 1.5 times the budget: ${JSON.stringify(rounds)}`);

// A 3-round budget stops at call 4 (floor(3 * 1.5) = 4, and one past the budget).
process.env.CODE_OPS_ROUND_BUDGET = '3';
const roundsThree = await roundStop('child3', 4);
expect(roundsThree.slice(0, 3).every((r) => r === null) && roundsThree[3]?.includes('4 tool rounds used, the hard stop at 1.5 times the 3-round budget, rounded down'), `the 3-round budget did not stop at call 4: ${JSON.stringify(roundsThree)}`);

// The default 40-round budget stops at call 60.
delete process.env.CODE_OPS_ROUND_BUDGET;
const roundsDefault = await roundStop('child40', 60);
expect(roundsDefault.slice(0, 59).every((r) => r === null) && roundsDefault[59]?.includes('60 tool rounds used, the hard stop at 1.5 times the 40-round budget, rounded down'), `the default budget did not stop at call 60: ${roundsDefault[59]}`);
process.env.CODE_OPS_ROUND_BUDGET = '2';

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

// Pickup is passive: it lists pending handoffs by Session name (the folder name for a legacy
// handoff) and never tells a new session to resume one.
const pickupTurn = { parts: [{ type: 'text', text: 'hello' }] };
await hooks['chat.message']({ sessionID: 'pickup', agent: 'build' }, pickupTurn);
const pickupText = pickupTurn.parts[0].text;
expect(pickupText.includes('handoffs awaiting resume (this session is new work unless the operator resumes one): Ledger2 AMM HO 1 -> code-ops-docs/80 Runs/2026-09-22 pending/HANDOFF.md')
  && !pickupText.includes('Before other work'), `pickup was not the passive session-named list: ${pickupText}`);
const bare = join(work, 'bare');
mkdirSync(join(bare, '80 Runs', '2026-09-22 bare'), { recursive: true });
writeFileSync(join(bare, '80 Runs', '2026-09-22 bare', 'HANDOFF.md'), '# pending\n\n## Next\n');
const barePending = pendingHandoffs(bare);
expect(barePending.length === 1 && barePending[0].path === '80 Runs/2026-09-22 bare/HANDOFF.md' && barePending[0].name === '2026-09-22 bare',
  `a legacy handoff must be named by its folder, got ${JSON.stringify(barePending)}`);
for (const n of [3, 4, 5, 6]) {
  mkdirSync(join(bare, '80 Runs', `2026-09-2${n} extra`), { recursive: true });
  writeFileSync(join(bare, '80 Runs', `2026-09-2${n} extra`, 'HANDOFF.md'), '# pending\n');
}
expect(pendingHandoffs(bare).length === 3, 'pickup must list at most 3 pending handoffs');

// Hub guards: a denial of an edit under a removed legacy root and a notice for a read of a record
// that is not in force. The fixture repository carries a manifest, a forwarding map, and a state.
{
  const repo = join(work, 'hub-repo');
  const system = join(repo, 'hub', '98 System');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(system, 'Records'), { recursive: true });
  writeFileSync(join(system, 'DOCS_MANIFEST.json'), JSON.stringify({
    version: 3, hub: 'hub', recordCollections: [],
    legacyPaths: [{ path: 'docs/old', disposition: 'removed', requiredBy: [{ kind: 'external', ref: 'fixture' }] }],
  }));
  writeFileSync(join(system, 'FORWARDING.json'), JSON.stringify({ version: 1, forwards: [{ from: 'docs/old', to: 'hub/new', movedAt: '2026-09-30', reason: 'vault move' }] }));
  const rec = (id, path, kind, status, key) => ({ id, collection: 'main', path, kind, ...(key ? { key } : {}), status, pendingSeal: null });
  writeFileSync(join(system, 'Records', 'state.json'), JSON.stringify({ version: 1, records: [
    rec('REC-OLD', 'hub/20 Decisions/Records/old.md', 'decision', 'superseded', 'deploy/window'),
    rec('REC-NEW', 'hub/20 Decisions/Records/new.md', 'decision', 'in-force', 'deploy/window'),
  ] }));
  const hubHooks = await overlay.CodeOpsLifecycle({
    directory: repo,
    client: { session: { get: async ({ path }) => (path.id.startsWith('child') ? { parentID: 'lead' } : {}) } },
  });
  const before = async (tool, args, sessionID = 'hublead', callID = 'h1') => {
    try {
      await hubHooks['tool.execute.before']({ tool, sessionID, callID }, { args });
      return null;
    } catch (error) {
      return String(error?.message ?? error);
    }
  };
  const afterText = async (tool, args, { input = true, sessionID = 'hublead', callID = 'h1' } = {}) => {
    const output = { title: '', output: 'tool output', metadata: {} };
    await hubHooks['tool.execute.after']({ tool, sessionID, callID, ...(input ? { args } : {}) }, output);
    return output.output;
  };

  const denied = await before('write', { filePath: 'docs/old/a.md', content: 'x' });
  expect(denied?.startsWith('Legacy path guard:') && denied.includes('docs/old') && denied.includes('hub/new/a.md'),
    `a write under a removed root must throw the guard with the forwarded path, got ${denied}`);
  const patched = await before('apply_patch', { patchText: '*** Begin Patch\n*** Update File: docs/old/b.md\n@@\n-a\n+b\n*** End Patch' }, 'hublead', 'h2');
  expect(patched?.startsWith('Legacy path guard:') && patched.includes('hub/new/b.md'), `an apply_patch target under the root must throw, got ${patched}`);
  for (const [name, tool, args] of [
    ['a write outside the root', 'write', { filePath: 'src/a.mjs' }],
    ['a read under the root', 'read', { filePath: 'docs/old/a.md' }],
    ['a shell command naming the root', 'bash', { command: 'cat docs/old/a.md' }],
  ]) {
    expect(await before(tool, args) === null, `${name} must pass the before hook`);
  }
  process.env.CODE_OPS_LEGACY_PATHS = 'off';
  expect(await before('write', { filePath: 'docs/old/a.md' }) === null, 'CODE_OPS_LEGACY_PATHS=off must silence the deny');
  delete process.env.CODE_OPS_LEGACY_PATHS;
  process.env.CODE_OPS_DISPATCH_GUARD = 'warn';
  expect(await before('write', { filePath: 'docs/old/a.md' }) === null, 'warn mode must not throw');
  const warnNote = await afterText('read', {}, { callID: 'h3' });
  expect(warnNote.includes('Legacy path guard: docs/old/a.md'), `warn mode must queue the denial as a note, got ${warnNote}`);
  delete process.env.CODE_OPS_DISPATCH_GUARD;
  // A denied subagent call counts one round: with a 2-round budget, the third call meets the stop.
  const retry = await before('write', { filePath: 'docs/old/a.md' }, 'childhub', 'c1');
  const rest = [await before('read', {}, 'childhub', 'c2'), await before('read', {}, 'childhub', 'c3')];
  expect(retry?.startsWith('Legacy path guard:') && rest[0] === null && rest[1]?.includes('3 tool rounds used'),
    `a denied subagent call must count as a round, got ${JSON.stringify([retry, ...rest])}`);
  console.log('ok   OpenCode denies edits under a removed root, forwards the path, honors both switches, and counts a denied subagent call');

  // The distribution layout: the plugin under plugins/ and the library under code-ops/code-ops-suite/scripts/.
  const distDir = join(work, 'dist');
  mkdirSync(join(distDir, 'plugins'), { recursive: true });
  mkdirSync(join(distDir, 'code-ops', 'code-ops-suite', 'scripts'), { recursive: true });
  writeFileSync(join(distDir, 'plugins', 'code-ops-lifecycle.js'), readFileSync(join(work, 'code-ops-lifecycle.js')));
  writeFileSync(join(distDir, 'plugins', 'code-ops-model-floors.js'), floors);
  writeFileSync(join(distDir, 'code-ops', 'code-ops-suite', 'scripts', 'legacy-paths-lib.mjs'), readFileSync(join(root, 'scripts', 'legacy-paths-lib.mjs')));
  const distPlugin = await (await import(pathToFileURL(join(distDir, 'plugins', 'code-ops-lifecycle.js')).href)).CodeOpsLifecycle({ directory: repo });
  let distDenied = null;
  try { await distPlugin['tool.execute.before']({ tool: 'edit', sessionID: 'distlead', callID: 'd1' }, { args: { filePath: 'docs/old/a.md' } }); } catch (error) { distDenied = String(error?.message ?? error); }
  expect(distDenied?.startsWith('Legacy path guard:'), `the distribution layout must resolve the library, got ${distDenied}`);
  const bareDir = join(work, 'no-lib');
  mkdirSync(bareDir, { recursive: true });
  writeFileSync(join(bareDir, 'code-ops-lifecycle.js'), readFileSync(join(work, 'code-ops-lifecycle.js')));
  writeFileSync(join(bareDir, 'code-ops-model-floors.js'), floors);
  const bareHooks = await (await import(pathToFileURL(join(bareDir, 'code-ops-lifecycle.js')).href)).CodeOpsLifecycle({ directory: repo });
  let bareResult = null;
  try { await bareHooks['tool.execute.before']({ tool: 'edit', sessionID: 'barelead', callID: 'b1' }, { args: { filePath: 'docs/old/a.md' } }); } catch (error) { bareResult = String(error?.message ?? error); }
  expect(bareResult === null, `a missing library must fail open, got ${bareResult}`);
  console.log('ok   the distribution layout resolves the shared library, and a missing library fails open');

  const OLD = 'hub/20 Decisions/Records/old.md';
  const readNote = await afterText('read', { filePath: OLD });
  expect(readNote.startsWith('tool output\n') && readNote.includes('History read notice: REC-OLD') && readNote.includes('Replaced by REC-NEW')
    && readNote.includes('hub/20 Decisions/REGISTER.md'), `a read of a superseded record must append the notice, got ${readNote}`);
  const grepNote = await afterText('grep', { pattern: 'window', path: OLD }, { callID: 'h4' });
  expect(grepNote.includes('REC-OLD'), `a grep with a record path must append the notice, got ${grepNote}`);
  const bashNote = await afterText('bash', { command: `cat "${OLD}"` }, { callID: 'h5' });
  expect(bashNote.includes('REC-OLD'), `a shell command naming a record must append the notice, got ${bashNote}`);
  // A host whose after-event input carries no arguments falls back to the arguments the before hook saw.
  await before('read', { filePath: OLD }, 'hublead', 'h6');
  const stashed = await afterText('read', { filePath: OLD }, { input: false, callID: 'h6' });
  expect(stashed.includes('REC-OLD'), `an after event with no args must reuse the before-hook args, got ${stashed}`);
  for (const [name, tool, args] of [
    ['an in-force record', 'read', { filePath: 'hub/20 Decisions/Records/new.md' }],
    ['a grep with no path', 'grep', { pattern: 'window' }],
    ['a shell command naming no record', 'bash', { command: 'git status' }],
    ['a write of the record', 'write', { filePath: OLD }],
  ]) {
    expect(await afterText(tool, args, { callID: `n-${tool}` }) === 'tool output', `${name} must get no notice`);
  }
  process.env.CODE_OPS_READ_NOTICE = '0';
  expect(await afterText('read', { filePath: OLD }, { callID: 'h7' }) === 'tool output', 'CODE_OPS_READ_NOTICE=0 must silence the notice');
  delete process.env.CODE_OPS_READ_NOTICE;
  writeFileSync(join(system, 'Records', 'state.json'), '{not json "superseded"');
  expect(await afterText('read', { filePath: OLD }, { callID: 'h8' }) === 'tool output', 'a corrupt state.json must fail open');
  console.log('ok   OpenCode appends the read notice for read, grep, and bash, skips in-force and pathless calls, and honors its switch');
}

// Compaction push: the compacting hook carries the session run folder's open items, its pending
// dispatch rows, and the snapshot path into the summary context. A run folder is found by SESSION.json.
{
  const repo = join(work, 'compact-repo');
  const run = join(repo, 'code-ops-docs', '80 Runs', '2026-09-30 compact');
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'SESSION.json'), JSON.stringify({ v: 1, sessionId: 'cc-1', hostSessionId: 'host-1', name: 'Compact fixture' }));
  const items = Array.from({ length: 15 }, (_, i) => `- [ ] OI-${String(i + 1).padStart(2, '0')} open item${i === 0 ? ` ${'x'.repeat(300)}` : ''}`);
  writeFileSync(join(run, 'TASKS.md'), ['# Tasks', '- [x] OI-99 closed item', ...items].join('\r\n'));
  const rows = Array.from({ length: 10 }, (_, i) => `| D-${String(i + 1).padStart(3, '0')} | implementer@gpt-6-sol | build unit ${i + 1} | report-${i + 1}.md | dispatched |`);
  writeFileSync(join(run, 'DISPATCH_LEDGER.md'), ['| id | role | brief | expected artifact | status |', '| --- | --- | --- | --- | --- |',
    '| D-090 | explorer@gpt-6-luna | map it | MAP.md | reported |', ...rows].join('\n'));
  const compact = async (hooksFor, sessionID) => {
    const out = { context: [] };
    await hooksFor['experimental.session.compacting']({ sessionID }, out);
    return out.context.slice(2).join('\n');
  };
  const compactHooks = await overlay.CodeOpsLifecycle({ directory: repo, client: { session: { get: async () => ({}) } } });
  const pushed = await compact(compactHooks, 'host-1');
  expect(pushed.includes('OI-01 open item') && pushed.includes('OI-12') && !pushed.includes('OI-13') && pushed.includes('(12 of 15 shown)'),
    `the push did not cap the open items at 12 of 15: ${pushed.slice(0, 300)}`);
  expect(!pushed.includes('OI-99'), 'a checked item was pushed');
  expect(pushed.includes('D-001 implementer@gpt-6-sol: build unit 1 -> report-1.md') && pushed.includes('D-008') && !pushed.includes('D-009')
    && pushed.includes('(8 of 10 shown)') && !pushed.includes('D-090'), `the push did not cap the pending dispatch rows at 8 of 10: ${pushed.slice(0, 600)}`);
  expect(pushed.split('\n').every((line) => line.length <= 200), 'a pushed line passed 200 characters');
  expect(pushed.includes('COMPACT_SNAPSHOT.md is not written; run co snapshot'), `the push did not name run co snapshot: ${pushed.slice(-200)}`);
  writeFileSync(join(run, 'COMPACT_SNAPSHOT.md'), '# snapshot\n');
  const withSnapshot = await compact(compactHooks, 'cc-1');
  expect(withSnapshot.includes('Compaction snapshot: code-ops-docs/80 Runs/2026-09-30 compact/COMPACT_SNAPSHOT.md') && !withSnapshot.includes('run co snapshot'),
    `a written snapshot was not named by path: ${withSnapshot.slice(-200)}`);
  // Fail open: an unknown session, a corrupt SESSION.json, and a context that is not a list push nothing extra and never throw.
  expect(await compact(compactHooks, 'no-such-session') === '', 'an unknown session pushed run folder lines');
  writeFileSync(join(run, 'SESSION.json'), '{not json');
  expect(await compact(compactHooks, 'host-1') === '', 'a corrupt SESSION.json pushed run folder lines');
  let threw = false;
  try { await compactHooks['experimental.session.compacting']({ sessionID: 'host-1' }, { context: 'not a list' }); } catch { threw = true; }
  expect(!threw, 'a malformed compaction context threw');
  // Mutation: with the push call removed, the first case must lose its lines.
  const PUSH = 'const push = compactionPush(row.cwd, row.id);';
  const lifecycleSource = readFileSync(join(root, 'scripts', 'opencode-lifecycle.js'), 'utf8');
  expect(lifecycleSource.includes(PUSH), 'the compacting hook has no compactionPush call');
  const mutantDir = join(work, 'compact-mutant');
  mkdirSync(mutantDir);
  writeFileSync(join(mutantDir, 'code-ops-model-floors.js'), floors);
  writeFileSync(join(mutantDir, 'code-ops-lifecycle.js'), lifecycleSource.replace(PUSH, 'const push = null;'));
  writeFileSync(join(run, 'SESSION.json'), JSON.stringify({ v: 1, sessionId: 'cc-1', hostSessionId: 'host-1' }));
  const mutant = await import(pathToFileURL(join(mutantDir, 'code-ops-lifecycle.js')).href);
  const mutantPush = await compact(await mutant.CodeOpsLifecycle({ directory: repo, client: { session: { get: async () => ({}) } } }), 'host-1');
  expect(mutantPush === '' && pushed !== '', 'the compaction cases still pass with the push removed');
  console.log('ok   OpenCode compaction pushes open items, pending dispatches, and the snapshot path, capped and fail-open');
}

rmSync(work, { recursive: true, force: true });
if (fails.length) {
  console.error(fails.map((msg) => `FAIL ${msg}`).join('\n'));
  process.exit(1);
}
console.log('PASS OpenCode lifecycle');
if (!existsSync(join(root, 'scripts', 'opencode-lifecycle.js'))) process.exit(1);
