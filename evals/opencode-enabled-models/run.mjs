#!/usr/bin/env node
// Proves the OpenCode dispatch binds only an enabled model, per the design's
// "OpenCode enabled models" section. A dispatch passes only when the live host list
// names its model, the operator profile names it (when the profile has an enabled
// list), the desktop Models settings do not hide it, and the provider switches of
// the OpenCode config allow it. Nothing left is a denial before launch. The cases
// cover a live list, a warm cache, no cache, the lead clone, and the routing switch. The startup
// cases drive the config hook with two enabled-model sets, a cold-cache ask through a fake host
// command, and a failing command that leaves the static model and shows a fallback note.
// A second pass runs the same cases against a copy of the plugin whose check is
// removed and expects the denials to vanish, so a case that passes on both fails.
//
//   node evals/opencode-enabled-models/run.mjs
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally } from '../harness.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'oc-enabled-models-'));
const { fails, expect } = tally();

const floors = `const KNOWN_MODELS = {
  "provider-a": { "claude-opus-5-5": "strong", "claude-fable-5-1": "frontier" },
  "provider-b": { "gpt-6-luna": "light", "gpt-5.6-terra": "strong", "gpt-6-sol": "frontier" }
};
`;
const source = readFileSync(join(root, 'scripts', 'opencode-lifecycle.js'), 'utf8');
const CALL = 'await assertDispatchModel(';
expect(source.includes(CALL), 'the lifecycle plugin has no call to assertDispatchModel');
const plugins = {};
const LADDER = '.filter((id) => providerAllowed(id, switches));\n  const byTier';
expect(source.includes(LADDER), 'the startup ladder does not filter by the provider switches');
const DISTINCT = '.filter((id) => id.toLowerCase() !== strong.toLowerCase())';
expect(source.includes(DISTINCT), 'the premium pick does not filter out the strong pick');
for (const [label, text] of [
  ['real', source],
  ['nodistinct', source.replace(DISTINCT, '.filter(() => true)')],
  ['mutant', source.replace(CALL, 'await (async () => ({ swap: false, note: null }))(')],
  ['noladder', source.replace(LADDER, ';\n  const byTier')],
]) {
  const dir = join(work, label);
  mkdirSync(dir);
  writeFileSync(join(dir, 'code-ops-model-floors.js'), floors);
  writeFileSync(join(dir, 'code-ops-lifecycle.js'), text);
  plugins[label] = (await import(pathToFileURL(join(dir, 'code-ops-lifecycle.js')).href)).CodeOpsLifecycle;
}

for (const name of ['CODE_OPS_OPENCODE_MODELS', 'CODE_OPS_OPENCODE_CMD', 'CODE_OPS_CHOOSER_CHILD', 'CODE_OPS_DISPATCH_GUARD', 'CODE_OPS_CONTEXT_CEILING', 'CODE_OPS_CONTEXT_THRESHOLD']) delete process.env[name];
process.env.CODE_OPS_RECEIPTS = join(work, 'receipts.jsonl');
process.env.CODE_OPS_COST_LEDGER = join(work, 'cost.jsonl');
process.env.HOME = work;
process.env.USERPROFILE = work;

const IMPLEMENTER = 'code-ops-suite-implementer';
const OPUS = 'provider-a/claude-opus-5-5';
const FABLE = 'provider-a/claude-fable-5-1';
const LUNA = 'provider-b/gpt-6-luna';
const SOL = 'provider-b/gpt-6-sol';
const TERRA = 'provider-b/gpt-5.6-terra';
const HOST = [OPUS, FABLE, LUNA, SOL];

const providersOf = (ids) => {
  const by = {};
  for (const id of ids) {
    const [provider, model] = [id.slice(0, id.indexOf('/')), id.slice(id.indexOf('/') + 1)];
    (by[provider] ??= { id: provider, models: {} }).models[model] = {};
  }
  return Object.values(by);
};
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// One dispatch of the implementer against a fresh plugin instance.
//   live        model ids the host client lists, or null for a client that lists none
//   noClient    the host client has no model list call at all
//   cache       ids an earlier run cached, read by the config hook and the fallback
//   cacheAfter  ids the cache holds at dispatch time, when the host list changed since startup
//   configured  model the operator set on the agent before the ladder ran
//   lead        model of the dispatching session
//   profile     the operator profile; hidden, the desktop-hidden ids; config, extra OpenCode config
//   routing     false turns CODE_OPS_TIER_ROUTING off
//   prompt      the dispatch brief, when a case sets a Tier line
async function dispatch(label, o) {
  const dir = mkdtempSync(join(work, 'case-'));
  process.env.CODE_OPS_CHOOSER_CACHE = join(dir, 'cache.json');
  process.env.CODE_OPS_MODEL_PROFILE = join(dir, 'profile.json');
  process.env.CODE_OPS_DESKTOP_STORE = join(dir, 'store.dat');
  if (o.cache) writeFileSync(process.env.CODE_OPS_CHOOSER_CACHE, JSON.stringify({ hosts: { [basename(process.execPath)]: { ids: o.cache } } }));
  if (o.profile) writeFileSync(process.env.CODE_OPS_MODEL_PROFILE, JSON.stringify(o.profile));
  if (o.hidden) {
    writeFileSync(process.env.CODE_OPS_DESKTOP_STORE, JSON.stringify({
      model: { user: o.hidden.map((id) => ({ providerID: id.split('/')[0], modelID: id.split('/')[1], visibility: 'hide' })) },
    }));
  }
  if (o.routing === false) process.env.CODE_OPS_TIER_ROUTING = 'off'; else delete process.env.CODE_OPS_TIER_ROUTING;
  const client = o.noClient ? {} : {
    config: { providers: async () => ({ data: { providers: o.live ? providersOf(o.live) : [] } }) },
  };
  const hooks = await plugins[label]({ directory: dir, client });
  const config = { agent: { [IMPLEMENTER]: { prompt: 'Build.', description: 'Builds.', ...(o.configured ? { model: o.configured } : {}) } }, ...o.config };
  await hooks.config(config);
  if (o.cacheAfter) writeFileSync(process.env.CODE_OPS_CHOOSER_CACHE, JSON.stringify({ hosts: { [basename(process.execPath)]: { ids: o.cacheAfter } } }));
  const [providerID, id] = o.lead.split('/');
  await hooks['chat.params']({ sessionID: 'lead', agent: 'build', model: { providerID, id } }, {});
  if (o.live) {
    await hooks.event({ event: { type: 'session.created', properties: {} } });
    await sleep(40);
  }
  const args = { subagent_type: IMPLEMENTER, prompt: o.prompt ?? 'Round budget: 5. Build the unit.' };
  let denied = null;
  try {
    await hooks['tool.execute.before']({ tool: 'task', sessionID: 'lead', callID: 'c1' }, { args });
  } catch (error) {
    denied = String(error?.message ?? error);
  }
  const after = { output: 'done' };
  await hooks['tool.execute.after']({ tool: 'task', sessionID: 'lead', callID: 'c1' }, after);
  return { denied, agent: args.subagent_type, output: after.output, config };
}

// The startup ladder binds only a model the provider switches allow. The unfiltered ladder picks
// OPUS for the strong tier, so each case plants a switch that moves the binding off provider-a.
const bound = (r) => Object.values(r.config.agent).map((a) => a.model).filter((m) => typeof m === 'string');
const ladderCases = [
  { name: 'a disabled provider never appears in a bound agent model at startup', o: { live: HOST, cache: HOST, lead: FABLE, config: { disabled_providers: ['provider-a'] } },
    ok: (r) => r.config.agent[IMPLEMENTER].model === SOL && bound(r).length > 0 && bound(r).every((m) => m.startsWith('provider-b/')) },
  { name: 'enabled_providers restricts the startup ladder', o: { live: HOST, cache: HOST, lead: FABLE, config: { enabled_providers: ['provider-b'] } },
    ok: (r) => r.config.agent[IMPLEMENTER].model === SOL && bound(r).length > 0 && bound(r).every((m) => m.startsWith('provider-b/')) },
  { name: 'with no switch the ladder still binds provider-a', o: { live: HOST, cache: HOST, lead: FABLE },
    ok: (r) => r.config.agent[IMPLEMENTER].model === OPUS },
];
for (const c of ladderCases) {
  const real = await dispatch('real', c.o);
  expect(c.ok(real), `${c.name}: bound ${JSON.stringify(bound(real))}`);
  if (c.name.startsWith('with no switch')) continue;
  const mutant = await dispatch('noladder', c.o);
  expect(!c.ok(mutant), `${c.name}: still passes with the ladder filter removed (${JSON.stringify(bound(mutant))})`);
}

// Premium binds the best-scoring enabled strong-class model that differs from the strong pick,
// and only from the models the guard allows. The profile measures OPUS above TERRA, so the
// strong pick is also the best-scoring model and a premium pick with no "differs" filter
// lands on it and collapses.
const PREMIUM_HOST = [OPUS, TERRA, LUNA];
const MEASURED = { models: { 'claude-opus-5-5': { index: 40, cost: 1, tokens: 1000 }, 'gpt-5.6-terra': { index: 38, cost: 1, tokens: 1000 } } };
const PREMIUM_BRIEF = 'Round budget: 5.\nTier: premium\nBuild the unit.';
const COLLAPSE_NOTE = 'premium collapsed to strong: no distinct enabled model';
const premiumCases = [
  { name: 'premium bind: two enabled strong-class models give a distinct premium clone',
    o: { live: PREMIUM_HOST, cache: PREMIUM_HOST, lead: OPUS, profile: MEASURED, prompt: PREMIUM_BRIEF },
    ok: (r) => r.denied === null && r.agent === `${IMPLEMENTER}-premium` && r.config.agent[IMPLEMENTER].model === OPUS
      && r.config.agent[`${IMPLEMENTER}-premium`]?.model === TERRA && !r.output.includes(COLLAPSE_NOTE) },
  { name: 'premium collapse: one enabled strong-class model runs at strong with a note',
    o: { live: [OPUS, LUNA], cache: [OPUS, LUNA], lead: OPUS, profile: MEASURED, prompt: PREMIUM_BRIEF },
    ok: (r) => r.denied === null && r.agent === IMPLEMENTER && !(`${IMPLEMENTER}-premium` in r.config.agent)
      && r.output.includes(COLLAPSE_NOTE) },
  { name: 'premium collapse: a second strong-class model on a disabled provider is never bound',
    o: { live: PREMIUM_HOST, cache: PREMIUM_HOST, lead: OPUS, profile: MEASURED, prompt: PREMIUM_BRIEF, config: { disabled_providers: ['provider-b'] } },
    ok: (r) => r.denied === null && r.agent === IMPLEMENTER && !(`${IMPLEMENTER}-premium` in r.config.agent)
      && r.output.includes(COLLAPSE_NOTE) },
];
for (const c of premiumCases) {
  const real = await dispatch('real', c.o);
  expect(c.ok(real), `${c.name}: ${JSON.stringify({ denied: real.denied, agent: real.agent, output: real.output, bound: bound(real) }).slice(0, 300)}`);
}
// The "differs from strong" filter is load-bearing: without it the bind case collapses.
const bindCase = premiumCases[0];
const nodistinct = await dispatch('nodistinct', bindCase.o);
expect(!bindCase.ok(nodistinct), `${bindCase.name}: still passes with the differs-from-strong filter removed`);

// The startup ladder binds the models this machine enables. The config hook reads the cached or
// environment list; with neither it asks the host CLI once (`models --pure`), caches the answer,
// and reports a fallback when no list arrives. A fake host command stands in for the CLI.
const fakeHost = join(work, 'fake-opencode.mjs');
writeFileSync(fakeHost, `import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2).join(' ');
if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, args + ' child=' + process.env.CODE_OPS_CHOOSER_CHILD + '\\n');
if (args !== 'models --pure') process.exit(2);
if (process.env.FAKE_MODE === 'fail') process.exit(1);
if (process.env.FAKE_MODE === 'empty') process.exit(0);
console.log(process.env.FAKE_IDS.split(',').join('\\n'));
`);
const STATIC = 'static/zen-free';
const startupLog = join(work, 'ask.log');

async function startup(label, o) {
  const dir = mkdtempSync(join(work, 'start-'));
  const cachePath = o.cachePath ?? join(dir, 'cache.json');
  process.env.CODE_OPS_CHOOSER_CACHE = cachePath;
  process.env.CODE_OPS_MODEL_PROFILE = join(dir, 'profile.json');
  process.env.CODE_OPS_DESKTOP_STORE = join(dir, 'store.dat');
  delete process.env.CODE_OPS_TIER_ROUTING;
  rmSync(startupLog, { force: true });
  for (const name of ['CODE_OPS_OPENCODE_CMD', 'FAKE_MODE', 'FAKE_IDS', 'FAKE_LOG', 'CODE_OPS_CHOOSER_CHILD']) delete process.env[name];
  if (o.cache) writeFileSync(cachePath, JSON.stringify({ hosts: { [basename(process.execPath)]: { ids: o.cache } } }));
  if (o.ask) {
    process.env.CODE_OPS_OPENCODE_CMD = JSON.stringify([process.execPath, fakeHost]);
    process.env.FAKE_LOG = startupLog;
    process.env.FAKE_MODE = o.ask.mode ?? 'ok';
    process.env.FAKE_IDS = (o.ask.ids ?? []).join(',');
  }
  if (o.child) process.env.CODE_OPS_CHOOSER_CHILD = '1';
  const hooks = await plugins[label]({ directory: dir, client: {} });
  const config = { agent: { [IMPLEMENTER]: { prompt: 'Build.', description: 'Builds.', model: STATIC } } };
  await hooks.config(config);
  const definition = { description: 'Delegate.', parameters: {} };
  await hooks['tool.definition']({ toolID: 'task' }, definition);
  let cached = null;
  try { cached = JSON.parse(readFileSync(cachePath, 'utf8')).hosts[basename(process.execPath)].ids; } catch { /* no cache written */ }
  let asks = [];
  try { asks = readFileSync(startupLog, 'utf8').trim().split('\n').filter(Boolean); } catch { /* the host was never asked */ }
  for (const name of ['CODE_OPS_OPENCODE_CMD', 'FAKE_MODE', 'FAKE_IDS', 'FAKE_LOG', 'CODE_OPS_CHOOSER_CHILD']) delete process.env[name];
  return { model: config.agent[IMPLEMENTER].model, card: definition.description, cached, asks, cachePath };
}

const FALLBACK_HEAD = 'Ladder fallbacks on this host:';
const PROVIDER_B = [LUNA, TERRA, SOL];
const startupCases = [
  { name: 'two enabled-model sets bind different models', run: async (label) => {
    const both = await startup(label, { cache: HOST });
    const onlyB = await startup(label, { cache: PROVIDER_B });
    return { r: { both: both.model, onlyB: onlyB.model }, ok: both.model === OPUS && onlyB.model === TERRA && both.model !== onlyB.model };
  } },
  { name: 'a cold cache asks the host once, binds its list, and caches it', run: async (label) => {
    const r = await startup(label, { ask: { ids: PROVIDER_B } });
    const warm = await startup(label, { cache: r.cached, ask: { mode: 'fail' } });
    return { r: { r, warm: warm.model }, ok: r.model === TERRA && r.asks.length === 1 && r.asks[0] === 'models --pure child=1'
      && JSON.stringify(r.cached) === JSON.stringify([...PROVIDER_B].sort()) && !r.card.includes(FALLBACK_HEAD)
      && warm.model === TERRA && warm.asks.length === 0 };
  }, mutates: true },
  { name: 'a failing host command keeps the static model and shows a fallback note', run: async (label) => {
    const r = await startup(label, { ask: { mode: 'fail' } });
    return { r, ok: r.model === STATIC && r.asks.length === 1 && r.cached === null
      && r.card.includes(FALLBACK_HEAD) && r.card.includes('opencode models failed (exit 1)') && r.card.includes('static ladder') };
  }, mutates: true, noteMutant: true },
  { name: 'a host list with no model keeps the static model and says so', run: async (label) => {
    const r = await startup(label, { ask: { mode: 'empty' } });
    return { r, ok: r.model === STATIC && r.cached === null && r.card.includes('opencode models listed nothing') };
  } },
  { name: 'no host binary and no command keeps the static model and names the switch', run: async (label) => {
    const r = await startup(label, {});
    return { r, ok: r.model === STATIC && r.asks.length === 0 && r.card.includes(FALLBACK_HEAD) && r.card.includes('CODE_OPS_OPENCODE_CMD') };
  } },
  { name: 'the model-list child never asks again', run: async (label) => {
    const r = await startup(label, { ask: { ids: PROVIDER_B }, child: true });
    return { r, ok: r.model === STATIC && r.asks.length === 0 && r.card.includes('model-list child') };
  } },
  { name: 'a rung with no model of its class borrows a neighbor and reports it', run: async (label) => {
    const r = await startup(label, { cache: [LUNA] });
    return { r, ok: r.card.includes(FALLBACK_HEAD) && /strong has no enabled model of its class and uses/.test(r.card) };
  } },
];
const noask = source.replace('await askHostModels(directory)', '{ ids: [], reason: null }');
const nonote = source.replace('...(fallbacks.length ?', '...(false ?');
expect(noask !== source && nonote !== source, 'a startup mutant did not apply');
for (const [label, text] of [['noask', noask], ['nonote', nonote]]) {
  const dir = join(work, label);
  mkdirSync(dir);
  writeFileSync(join(dir, 'code-ops-model-floors.js'), floors);
  writeFileSync(join(dir, 'code-ops-lifecycle.js'), text);
  plugins[label] = (await import(pathToFileURL(join(dir, 'code-ops-lifecycle.js')).href)).CodeOpsLifecycle;
}
for (const c of startupCases) {
  const real = await c.run('real');
  expect(real.ok, `${c.name}: ${JSON.stringify(real.r).slice(0, 400)}`);
  // The cold-cache ask and the fallback note are load-bearing: with either removed, its case must fail.
  if (c.mutates) {
    const mutant = await c.run(c.noteMutant ? 'nonote' : 'noask');
    expect(!mutant.ok, `${c.name}: still passes with the ${c.noteMutant ? 'fallback note' : 'cold-cache ask'} removed`);
  }
}

// Each case plants one fault and names whether a dispatch must be denied.
const cases = [
  { name: 'an enabled model passes untouched', deny: false, o: { live: HOST, cache: HOST, lead: FABLE },
    check: (r) => r.agent === IMPLEMENTER && !r.output.includes('Routing:') },
  { name: 'a model on a disabled provider is denied before launch', deny: true, o: { live: HOST, configured: OPUS, lead: FABLE, config: { disabled_providers: ['provider-a'] } },
    check: (r) => r.denied?.includes(OPUS) },
  { name: 'a provider outside enabled_providers is denied', deny: true, o: { live: HOST, configured: OPUS, lead: FABLE, config: { enabled_providers: ['provider-b'] } } },
  { name: 'a model off the profile enabled list is denied', deny: true, o: { live: HOST, configured: OPUS, lead: FABLE, profile: { enabled: ['gpt-6-sol'] } } },
  { name: 'a model hidden in the desktop Models settings is denied', deny: true, o: { live: HOST, configured: OPUS, lead: FABLE, hidden: [OPUS, FABLE] } },
  { name: 'a profile list that names no available model denies', deny: true, o: { live: HOST, configured: OPUS, lead: FABLE, profile: { enabled: ['other/model'] } } },
  { name: 'a model the live list no longer names is denied', deny: true, o: { live: [LUNA, SOL], configured: OPUS, lead: LUNA } },
  { name: 'live list null with a warm cache lets the cache pass an enabled model', deny: false, o: { live: null, cache: HOST, lead: FABLE },
    check: (r) => r.agent === IMPLEMENTER },
  { name: 'live list null with a warm cache denies a disabled provider', deny: true, o: { live: null, cacheAfter: HOST, configured: OPUS, lead: FABLE, config: { disabled_providers: ['provider-a'] } } },
  { name: 'live list null with a cache that omits the model denies', deny: true, o: { live: null, cache: HOST, cacheAfter: [LUNA], lead: LUNA } },
  { name: 'live list null with no cache denies and says to restart', deny: true, o: { noClient: true, lead: FABLE, configured: OPUS },
    check: (r) => /Restart OpenCode/.test(r.denied) },
  { name: 'an empty live list with no cache denies', deny: true, o: { live: null, lead: FABLE, configured: OPUS } },
  { name: 'the lead clone is accepted when the lead meets every condition and the floor', deny: false, o: { live: HOST, configured: OPUS, lead: SOL, config: { disabled_providers: ['provider-a'] } },
    check: (r) => r.agent === `${IMPLEMENTER}-lead` && r.output.includes('inherits your model') },
  { name: 'the lead clone is refused when the lead is below the agent floor', deny: true, o: { live: HOST, configured: OPUS, lead: LUNA, config: { disabled_providers: ['provider-a'] } } },
  { name: 'the lead clone is refused when the lead is off the profile list', deny: true, o: { live: HOST, configured: OPUS, lead: SOL, profile: { enabled: ['gpt-6-luna'] } } },
  { name: 'the lead clone is refused when the lead is hidden', deny: true, o: { live: HOST, configured: OPUS, lead: SOL, hidden: [OPUS, SOL] } },
  { name: 'routing off still denies a disabled provider', deny: true, o: { live: HOST, configured: OPUS, lead: FABLE, routing: false, config: { disabled_providers: ['provider-a'] } } },
  { name: 'routing off still passes an enabled model untouched', deny: false, o: { live: HOST, cache: HOST, lead: FABLE, routing: false },
    check: (r) => r.agent === IMPLEMENTER },
];

for (const c of cases) {
  const real = await dispatch('real', c.o);
  const verdict = real.denied === null ? 'passed' : 'denied';
  expect(c.deny ? real.denied?.startsWith('Dispatch guard:') : real.denied === null, `${c.name}: the dispatch ${verdict}${real.denied ? ` (${real.denied.slice(0, 120)})` : ''}`);
  if (c.check && !c.check(real)) fails.push(`${c.name}: wrong result ${JSON.stringify(real).slice(0, 200)}`);
  // Mutation: with the check removed, a denial case must launch.
  if (c.deny) {
    const mutant = await dispatch('mutant', c.o);
    expect(mutant.denied === null, `${c.name}: still denied with assertDispatchModel removed (${String(mutant.denied).slice(0, 120)})`);
  }
}

rmSync(work, { recursive: true, force: true });
if (fails.length) {
  console.error(fails.map((msg) => `FAIL ${msg}`).join('\n'));
  process.exit(1);
}
console.log('PASS OpenCode enabled models');
