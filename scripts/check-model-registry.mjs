#!/usr/bin/env node
// Re-verify the pinned model ids in scripts/model-tiers.mjs against the models.dev registry.
//
// WHY: the tier table binds each capability rung to a concrete model id, and opencode
// resolves those ids through models.dev. A provider renaming or retiring a model would leave
// the suite pointing at an id that no longer resolves — a failure the user only meets at run
// time, as an unbound agent.
//
// Network access is OPT-IN and this check is deliberately NOT in CI, matching the same
// local-first stance as scripts/lib-docs.mjs: the renderer and the lint gate stay offline and
// deterministic, and a third-party registry outage can never fail this repository's build.
// Run it when bumping REGISTRY_VERIFIED_AT, adding a provider, or auditing a stale table.
//
//   node scripts/check-model-registry.mjs            (offline: shape checks only)
//   node scripts/check-model-registry.mjs --fetch     (also resolve every id against models.dev)
//
// Exit: 0 = every pinned id checked out; 1 = a pin failed; 2 = usage error or fetch failure.

import { PROVIDER_TIERS, REGISTRY_VERIFIED_AT, TIER_ORDER, leadInherits } from './model-tiers.mjs';

const REGISTRY_URL = 'https://models.dev/api.json';
const argv = process.argv.slice(2);
const FETCH = argv.includes('--fetch');
if (argv.some((arg) => arg !== '--fetch')) {
  console.error('usage: node scripts/check-model-registry.mjs [--fetch]');
  process.exit(2);
}

const failures = [];
const fail = (message) => failures.push(message);

// ---- offline: the table is complete and internally consistent ---------------------
for (const [id, provider] of Object.entries(PROVIDER_TIERS)) {
  if (provider.id !== id) fail(`${id}: entry key does not match its own id "${provider.id}"`);
  if (!provider.label) fail(`${id}: no label`);
  if (!provider.notes) fail(`${id}: no notes — a reader needs to know why the ladder looks like this`);
  for (const tier of TIER_ORDER) {
    if (tier === 'frontier' && provider.models?.frontier === null) continue; // lead inherits the session model
    if (!provider.models?.[tier]) fail(`${id}: no model pinned for the ${tier} tier`);
  }
  if (provider.registry === 'cli' && !/^\d{4}-\d{2}-\d{2}$/.test(provider.verifiedAt ?? '')) fail(`${id}: a cli-verified provider needs a verifiedAt date`);
}

let checked = 0;
if (FETCH) {
  let registry;
  try {
    const response = await fetch(REGISTRY_URL, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    registry = await response.json();
  } catch (e) {
    // A registry outage is not a repository defect. Exit 2 (usage/infrastructure), never 1,
    // so a caller can tell "the pins are wrong" apart from "the network was down".
    console.error(`x could not reach ${REGISTRY_URL}: ${e.message}`);
    process.exit(2);
  }

  for (const [id, provider] of Object.entries(PROVIDER_TIERS)) {
    // A provider verified against its host's own model list is not in models.dev; its ids are
    // checked with `opencode models` on the date the entry records, never fetched here.
    if (provider.registry === 'cli') { console.log(`  skip ${id}: verified against the host CLI on ${provider.verifiedAt}`); continue; }
    const known = registry[id]?.models;
    if (!known) { fail(`${id}: provider is absent from the registry — check the provider id`); continue; }
    // One id can serve several rungs, so verify the distinct set and report each rung using it.
    const byModel = new Map();
    for (const tier of TIER_ORDER) {
      const model = provider.models[tier];
      if (model === null) continue;
      if (!byModel.has(model)) byModel.set(model, []);
      byModel.get(model).push(tier);
    }
    for (const [model, tiers] of byModel) {
      checked++;
      if (!(model in known)) fail(`${id}/${model}: pinned for ${tiers.join(', ')} but not in the registry`);
    }
  }
}

if (failures.length) {
  console.error('FAIL — model registry pins:');
  for (const failure of failures) console.error('  x ' + failure);
  console.error('\nFix scripts/model-tiers.mjs, then re-render: node scripts/build-opencode-dist.mjs');
  process.exit(1);
}

const providers = Object.keys(PROVIDER_TIERS).length;
if (FETCH) {
  console.log(`OK — ${checked} pinned model id(s) across ${providers} provider(s) resolve in the registry.`);
  console.log(`If this is a re-verification, set REGISTRY_VERIFIED_AT in scripts/model-tiers.mjs (currently ${REGISTRY_VERIFIED_AT}).`);
} else {
  console.log(`OK — ${providers} provider(s), every tier pinned (shape only; pass --fetch to resolve ids against ${REGISTRY_URL}).`);
}
