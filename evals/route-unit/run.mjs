#!/usr/bin/env node
// Regression eval for scripts/route-unit.mjs, the tier-routing rubric behind `co route`.
//
// The rubric is a table, so the eval pins it three ways: named basis fixtures that map to an
// exact rung and effort, properties that must hold over the whole input grid (monotonicity, no
// output below a floor, no effort above high, breadth never high), and mutants. A mutant is a
// copy of the script with one rule broken. Each must fail at least one case, which proves the
// fixtures and properties would notice that rule drifting.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally, withDetail } from '../harness.mjs';
import * as real from '../../scripts/route-unit.mjs';
import { CLAUDE_ALIAS_TIER, PROVIDER_TIERS, TIER_ORDER, modelClassOf, modelRankOf, modelSupportsTier } from '../../scripts/model-tiers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'route-unit.mjs');

// ---- fixtures: basis -> exact rung, effort, and rule -------------------------------------
const FIXTURES = [
  ['row 1 breadth', { kind: 'breadth', ambiguity: 'low', reversible: 'yes' }, 'light', 'low', '1'],
  ['row 1 read with synthesis raises effort', { kind: 'mechanical-read', ambiguity: 'low', reversible: 'yes', synthesis: true }, 'light', 'medium', '1'],
  ['row 1 breadth ignores the irreversible trigger', { kind: 'breadth', ambiguity: 'high', reversible: 'no' }, 'light', 'low', '1'],
  ['row 1 breadth ignores a gate surface', { kind: 'breadth', ambiguity: 'high', reversible: 'no', surface: 'gate-script' }, 'light', 'low', '1'],
  ['row 2 mechanical edit', { kind: 'mechanical-edit', ambiguity: 'low', reversible: 'yes' }, 'mid', 'low', '2'],
  ['row 2 gate run', { kind: 'gate-run', ambiguity: 'medium', reversible: 'yes' }, 'mid', 'low', '2'],
  ['row 2 edit ignores a later attempt', { kind: 'mechanical-edit', ambiguity: 'high', reversible: 'no', attempt: 2 }, 'mid', 'low', '2'],
  ['row 3 execution', { kind: 'execution', ambiguity: 'low', reversible: 'yes' }, 'strong', 'medium', '3'],
  ['row 3 execution at high ambiguity stays strong', { kind: 'execution', ambiguity: 'high', reversible: 'yes' }, 'strong', 'medium', '3'],
  ['row 4 judgment low', { kind: 'judgment', ambiguity: 'low', reversible: 'yes' }, 'strong', 'medium', '4'],
  ['row 4 judgment medium', { kind: 'judgment', ambiguity: 'medium', reversible: 'yes' }, 'strong', 'medium', '4'],
  ['row 4 irreversible alone is no trigger', { kind: 'judgment', ambiguity: 'low', reversible: 'no' }, 'strong', 'medium', '4'],
  ['row 5 judgment high', { kind: 'judgment', ambiguity: 'high', reversible: 'yes' }, 'strong', 'high', '5'],
  ['row 6 review', { kind: 'review', ambiguity: 'low', reversible: 'yes' }, 'strong', 'high', '6'],
  ['row 6 refutation', { kind: 'refutation', ambiguity: 'medium', reversible: 'yes' }, 'strong', 'high', '6'],
  ['7a review on a gate script', { kind: 'review', ambiguity: 'low', reversible: 'yes', surface: 'gate-script' }, 'premium', 'high', '7a'],
  ['7a refutation on security', { kind: 'refutation', ambiguity: 'low', reversible: 'yes', surface: 'security' }, 'premium', 'high', '7a'],
  ['7a review on a public contract', { kind: 'review', ambiguity: 'medium', reversible: 'yes', surface: 'public-contract' }, 'premium', 'high', '7a'],
  ['7a does not lift judgment on a gate script', { kind: 'judgment', ambiguity: 'medium', reversible: 'yes', surface: 'gate-script' }, 'strong', 'medium', '4'],
  ['7b judgment high and irreversible', { kind: 'judgment', ambiguity: 'high', reversible: 'no' }, 'premium', 'high', '7b'],
  ['7b execution high and irreversible', { kind: 'execution', ambiguity: 'high', reversible: 'no' }, 'premium', 'high', '7b'],
  ['7c second attempt after a strong try', { kind: 'judgment', ambiguity: 'medium', reversible: 'yes', attempt: 2 }, 'premium', 'high', '7c'],
  ['7c third attempt on execution', { kind: 'execution', ambiguity: 'low', reversible: 'yes', attempt: 3 }, 'premium', 'high', '7c'],
  ['7c does not lift a light unit', { kind: 'breadth', ambiguity: 'low', reversible: 'yes', attempt: 2 }, 'light', 'low', '1'],
  ['7d judgment high on a public contract', { kind: 'judgment', ambiguity: 'high', reversible: 'yes', surface: 'public-contract' }, 'premium', 'high', '7d'],
  ['7d needs high ambiguity', { kind: 'judgment', ambiguity: 'medium', reversible: 'yes', surface: 'public-contract' }, 'strong', 'medium', '4'],
  ['7d needs the public-contract surface', { kind: 'judgment', ambiguity: 'high', reversible: 'yes', surface: 'gate-script' }, 'strong', 'high', '5'],
  ['row 8 peer with the exception', { kind: 'peer', ambiguity: 'high', reversible: 'no', peerException: true }, 'frontier', 'adaptive', '8'],
  ['peer without the exception routes as judgment', { kind: 'peer', ambiguity: 'low', reversible: 'yes' }, 'strong', 'medium', '4'],
  ['peer without the exception still meets 7b', { kind: 'peer', ambiguity: 'high', reversible: 'no' }, 'premium', 'high', '7b'],
  ['the exception does nothing off a peer unit', { kind: 'mechanical-edit', ambiguity: 'low', reversible: 'yes', peerException: true }, 'mid', 'low', '2'],
  ['a strong floor raises breadth', { kind: 'breadth', ambiguity: 'low', reversible: 'yes', floor: 'strong' }, 'strong', 'low', '1'],
  ['a mid floor leaves a mid unit', { kind: 'mechanical-edit', ambiguity: 'low', reversible: 'yes', floor: 'mid' }, 'mid', 'low', '2'],
  ['a floor never lowers premium', { kind: 'review', ambiguity: 'low', reversible: 'yes', surface: 'egress', floor: 'light' }, 'premium', 'high', '7a'],
  ['a frontier floor is capped at strong', { kind: 'mechanical-read', ambiguity: 'low', reversible: 'yes', floor: 'frontier' }, 'strong', 'low', '1'],
];

const basisOf = (spec) => ({ surface: 'none', attempt: 1, floor: null, peerException: false, synthesis: false, ...spec });

// ---- the grid the properties run over -----------------------------------------------------
const FLOORS = [null, 'light', 'mid', 'strong', 'frontier'];
const KIND_CHAIN = ['breadth', 'mechanical-read', 'mechanical-edit', 'gate-run', 'execution', 'judgment', 'review', 'refutation'];
function* grid(mod) {
  for (const kind of mod.KINDS) for (const ambiguity of mod.AMBIGUITIES) for (const reversible of ['yes', 'no'])
    for (const surface of mod.SURFACES) for (const attempt of [1, 2, 3]) for (const floor of FLOORS)
      for (const synthesis of [false, true]) for (const peerException of [false, true])
        yield { kind, ambiguity, reversible, surface, attempt, floor, synthesis, peerException };
}

// Every single-input raise of a basis. `kind` raises along the chain only: peer is not on it,
// because a peer without the exception routes as judgment and sits below a review on a surface.
function raisesOf(mod, basis) {
  const next = (list, value) => list[list.indexOf(value) + 1];
  const out = [];
  if (basis.ambiguity !== 'high') out.push({ ...basis, ambiguity: next(mod.AMBIGUITIES, basis.ambiguity) });
  if (basis.reversible === 'yes') out.push({ ...basis, reversible: 'no' });
  if (basis.surface === 'none') for (const surface of mod.SURFACES.slice(1)) out.push({ ...basis, surface });
  out.push({ ...basis, attempt: basis.attempt + 1 });
  if (basis.floor !== 'frontier') out.push({ ...basis, floor: next(FLOORS, basis.floor) });
  if (!basis.peerException) out.push({ ...basis, peerException: true });
  const at = KIND_CHAIN.indexOf(basis.kind);
  if (at >= 0 && at < KIND_CHAIN.length - 1) out.push({ ...basis, kind: KIND_CHAIN[at + 1] });
  return out;
}

const SURFACE_CASES = [
  ['scripts/lint-plugins.mjs', 'gate-script'],
  ['evals/score.mjs', 'gate-script'],
  ['.github/workflows/validate.yml', 'gate-script'],
  ['plugins/code-ops-suite/hooks/dispatch-guard.mjs', 'gate-script'],
  ['.\\scripts\\lint-plugins.mjs', 'gate-script'],
  ['./evals/score.mjs', 'gate-script'],
  ['C:/work/code-ops/scripts/lint-plugins.mjs', 'gate-script'],
  ['src/auth/session.ts', 'security'],
  ['lib/oauth-client.js', 'security'],
  ['config/credentials.json', 'security'],
  ['svc/egress/allowlist.yaml', 'egress'],
  ['db/migrations/0042_add_index.sql', 'migration'],
  ['scripts/migrate-users.mjs', 'migration'],
  ['code-ops-docs/35 Contracts and Data/CONTRACTS.md', 'public-contract'],
  ['plugins/rigor/.claude-plugin/plugin.json', 'public-contract'],
  ['.claude-plugin/marketplace.json', 'public-contract'],
  // Deliberately outside the narrow list: the rest of hooks/ and scripts/, and near-miss names.
  ['plugins/code-ops-suite/hooks/session-receipt.mjs', 'none'],
  ['scripts/co.mjs', 'none'],
  ['scripts/lint-plugins.mjs.bak', 'none'],
  ['evals/lint-plugins/run.mjs', 'none'],
  ['docs/author-notes.md', 'none'],
  ['src/authority.ts', 'none'],
  ['README.md', 'none'],
  // A trailing line anchor never hides the surface.
  ['scripts/lint-plugins.mjs:120-180', 'gate-script'],
  ['scripts/lint-plugins.mjs:120', 'gate-script'],
  ['scripts/lint-plugins.mjs#L120', 'gate-script'],
  ['scripts/lint-plugins.mjs#L120-L180', 'gate-script'],
  ['code-ops-docs/35 Contracts and Data/CONTRACTS.md:10-20', 'public-contract'],
  ['src/auth/login.ts:42', 'security'],
  // Gate-script and public-contract paths ignore case and take either separator.
  ['Scripts/Lint-Plugins.mjs', 'gate-script'],
  ['EVALS/SCORE.MJS', 'gate-script'],
  ['.GitHub/Workflows/validate.yml', 'gate-script'],
  ['Plugins\\Code-Ops-Suite\\Hooks\\Dispatch-Guard.mjs', 'gate-script'],
  ['code-ops-docs\\35 Contracts and Data\\CONTRACTS.md', 'public-contract'],
  ['PLUGINS/RIGOR/.CLAUDE-PLUGIN/PLUGIN.JSON', 'public-contract'],
  ['scripts/lint-plugins.mjs.bak:12', 'none'],
];

// [agent, declared kind, kind after the agent minimum]
const MIN_KIND_CASES = [
  ['code-ops-suite:reviewer', 'execution', 'review'],
  ['code-ops-suite:reviewer', 'breadth', 'review'],
  ['code-ops-suite:reviewer', 'peer', 'review'],
  ['code-ops-suite:reviewer', 'review', 'review'],
  ['code-ops-suite:reviewer', 'refutation', 'refutation'],
  ['privacy-opsec-suite:privacy-reviewer', 'judgment', 'review'],
  ['rigor:verifier', 'review', 'refutation'],
  ['rigor:verifier', 'mechanical-edit', 'refutation'],
  ['rigor:verifier', 'refutation', 'refutation'],
  ['rigor:tracer', 'execution', 'judgment'],
  ['rigor:tracer', 'gate-run', 'judgment'],
  ['rigor:tracer', 'judgment', 'judgment'],
  ['rigor:tracer', 'peer', 'peer'],
  ['rigor:tracer', 'refutation', 'refutation'],
  ['code-ops-suite:implementer', 'breadth', 'breadth'],
  ['code-ops-suite:explorer', 'mechanical-read', 'mechanical-read'],
  ['code-ops-suite:reviewer', 'vibes', 'vibes'],
];

// One pass over every rule in a module. `rec(group, ok, message)` records a result. The real
// run reports each group; a mutant run only needs to know that something failed.
function suite(mod, rec) {
  for (const [name, spec, rung, effort, rule] of FIXTURES) {
    let got;
    try { got = mod.routeUnit(basisOf(spec)); } catch (error) { rec('fixtures', false, `${name}: threw ${error.message}`); continue; }
    rec('fixtures', got.rung === rung && got.effort === effort && got.rule === rule, `${name}: want ${rung}/${effort}/${rule}, got ${got.rung}/${got.effort}/${got.rule}`);
  }

  const premiums = FIXTURES.filter((f) => f[2] === 'premium').length;
  const frontiers = FIXTURES.filter((f) => f[2] === 'frontier').length;
  rec('distribution', FIXTURES.length >= 25, `${FIXTURES.length} fixtures, need 25 or more`);
  rec('distribution', premiums >= 3 && frontiers === 1, `${premiums} premium and ${frontiers} frontier fixtures, need at least 3 and exactly 1`);

  let cases = 0;
  for (const basis of grid(mod)) {
    cases++;
    const got = mod.routeUnit(basis);
    const label = JSON.stringify(basis);
    const cap = basis.floor === 'frontier' ? 'strong' : basis.floor;
    if (got.effort === 'adaptive') rec('effort-ceiling', got.rung === 'frontier', `adaptive effort off the frontier rung for ${label}`);
    else rec('effort-ceiling', mod.EFFORTS.includes(got.effort), `effort ${got.effort} is above high for ${label}`);
    if (cap) rec('floors', mod.FLOOR_RANK[got.rung] >= mod.FLOOR_RANK[cap], `${got.rung} is below the ${cap} floor for ${label}`);
    if (basis.kind === 'breadth' || basis.kind === 'mechanical-read') rec('breadth', got.effort !== 'high' && got.rung !== 'premium' && got.rung !== 'frontier', `breadth routed to ${got.rung}/${got.effort} for ${label}`);
    rec('frontier-gate', got.rung !== 'frontier' || (basis.kind === 'peer' && basis.peerException), `frontier without a peer exception for ${label}`);
    if (got.rung === 'premium') rec('premium-effort', got.effort === 'high', `premium at ${got.effort} for ${label}`);
    for (const raised of raisesOf(mod, basis)) {
      const after = mod.routeUnit(raised);
      rec('monotonicity', mod.RUNG_RANK[after.rung] >= mod.RUNG_RANK[got.rung], `raising ${label} to ${JSON.stringify(raised)} lowered ${got.rung} to ${after.rung}`);
    }
  }
  rec('grid', cases > 10000, `grid ran ${cases} bases`);

  for (const [path, want] of SURFACE_CASES) rec('surface-patterns', mod.surfaceOfScope([path]) === want, `${path}: want ${want}, got ${mod.surfaceOfScope([path])}`);
  rec('surface-patterns', mod.surfaceOfScope([]) === 'none' && mod.surfaceOfScope(undefined) === 'none', 'an empty or missing Scope derives none');
  const mixed = ['scripts/lint-plugins.mjs', 'src/auth/login.ts', 'README.md'];
  rec('surface-patterns', mod.surfaceOfScope(mixed) === mod.surfaceOfScope([...mixed].reverse()) && mod.surfaceOfScope(mixed) === 'security', 'several surfaces resolve in grammar order, independent of path order');
  rec('surface-patterns', mod.SURFACE_PATTERNS.every((entry) => entry.pattern instanceof RegExp && mod.SURFACES.includes(entry.surface) && entry.surface !== 'none'), 'every pattern is a RegExp bound to a non-none surface');
  rec('surface-patterns', mod.SURFACES.slice(1).every((surface) => mod.SURFACE_PATTERNS.some((entry) => entry.surface === surface)), 'every non-none surface has a pattern');

  rec('min-kind', Object.keys(mod.AGENT_MIN_KIND).sort().join() === 'code-ops-suite:reviewer,privacy-opsec-suite:privacy-reviewer,rigor:tracer,rigor:verifier', 'AGENT_MIN_KIND names the four minimum-kind agents');
  for (const [agent, kind, want] of MIN_KIND_CASES) {
    const got = mod.applyMinKind(kind, agent);
    rec('min-kind', got.kind === want && got.raisedFrom === (want === kind ? null : kind), `${agent} declared ${kind}: want ${want}, got ${got.kind} (raisedFrom ${got.raisedFrom})`);
  }

  for (const bad of [{ kind: 'vibes' }, { ambiguity: 'extreme' }, { reversible: 'maybe' }, { attempt: 0 }, { attempt: 1.5 }, { surface: 'everywhere' }, { floor: 'premium' }]) {
    let threw = false;
    try { mod.routeUnit(basisOf({ kind: 'review', ambiguity: 'low', reversible: 'yes', ...bad })); } catch (error) { threw = error instanceof TypeError; }
    rec('validation', threw, `${JSON.stringify(bad)} must throw a TypeError`);
  }
}

// ---- real run ---------------------------------------------------------------------------
const { fails, check } = tally(withDetail);
const GROUPS = ['fixtures', 'distribution', 'effort-ceiling', 'floors', 'breadth', 'frontier-gate', 'premium-effort', 'monotonicity', 'grid', 'surface-patterns', 'min-kind', 'validation'];
const failed = Object.fromEntries(GROUPS.map((group) => [group, []]));
const seen = new Set();
suite(real, (group, ok, message) => { seen.add(group); if (!ok) failed[group].push(message); });
for (const group of GROUPS) check(`route-unit ${group}`, seen.has(group) && failed[group].length === 0, `${failed[group].length} failing, first: ${failed[group][0] ?? 'group never ran'}`);

// ---- the data the router reads ----------------------------------------------------------
check('TIER_ORDER keeps the four canonical rungs', TIER_ORDER.join() === 'light,mid,strong,frontier', TIER_ORDER.join());
check('the Claude alias map still has no premium alias', Object.keys(CLAUDE_ALIAS_TIER).join() === 'haiku,sonnet,opus,claude-sonnet-5-5');
const derivedCollapse = (provider) => (provider.models.premium === provider.models.strong ? 'strong' : provider.models.premium === provider.models.frontier ? 'frontier' : null);
check('every provider pins a premium model and states its collapse', Object.values(PROVIDER_TIERS).every((p) => typeof p.models.premium === 'string' && p.premiumCollapse === derivedCollapse(p)),
  Object.values(PROVIDER_TIERS).filter((p) => p.premiumCollapse !== derivedCollapse(p)).map((p) => p.id).join(','));
check('every premium id clears the strong rung', Object.values(PROVIDER_TIERS).every((p) => modelSupportsTier(p.models.premium, 'strong')));
check('Astra premium validates at strong without changing its frontier class', modelSupportsTier('gpt-6-astra', 'strong') && modelSupportsTier('gpt-6-astra', 'frontier') && modelClassOf('gpt-6-astra') === 'frontier');
check('Anthropic premium is Opus 5.5 behind the opus alias', PROVIDER_TIERS.anthropic.models.premium === 'claude-opus-5-5' && PROVIDER_TIERS.anthropic.dispatchAlias.premium === 'opus' && PROVIDER_TIERS.anthropic.dispatchAlias.strong === null);
check('OpenAI pins Luna light, Sol mid/strong/frontier, Astra premium', PROVIDER_TIERS.openai.models.light === 'gpt-6-luna' && PROVIDER_TIERS.openai.models.mid === 'gpt-6.1-sol' && PROVIDER_TIERS.openai.models.strong === 'gpt-6.1-sol' && PROVIDER_TIERS.openai.models.premium === 'gpt-6-astra' && PROVIDER_TIERS.openai.models.frontier === 'gpt-6.1-sol' && PROVIDER_TIERS.openai.premiumCollapse === null);
check('Copilot premium is Opus 5.5', PROVIDER_TIERS['github-copilot'].models.premium === 'claude-opus-5.5' && PROVIDER_TIERS['github-copilot'].premiumCollapse === null);
check('the retired Mistral light id is gone', PROVIDER_TIERS.mistral.models.light === 'mistral-small-2603');
check('premium ranks strong in the model index', modelRankOf('claude-opus-5-5') === 2 && modelRankOf('claude-sonnet-5-5') === 2);
check('the previous Sol id keeps its frontier class; the current shared id is ambiguous', modelClassOf('gpt-6-sol') === 'frontier' && modelClassOf('gpt-6.1-sol') === 'ambiguous' && modelRankOf('gpt-6.1-sol') === 3);
const bindingsFor = (rung) => Object.fromEntries(real.hostBindings(rung).map((b) => [b.host, b]));
check('premium binds Opus on Claude and Astra on Codex; Grok and OpenCode collapse',
  bindingsFor('premium').claude.detail.includes('model="opus"') && !bindingsFor('premium').claude.collapse
  && bindingsFor('premium').codex.detail.includes('gpt-6-astra') && !bindingsFor('premium').codex.collapse
  && ['grok', 'opencode'].every((host) => bindingsFor('premium')[host].collapse));
check('strong leaves the Claude model unset', bindingsFor('strong').claude.detail.startsWith('leave model unset'));
check('frontier binds fable on claude and inherits on opencode', bindingsFor('frontier').claude.detail.includes('model="fable"') && bindingsFor('frontier').opencode.detail.includes('inherits'));

// ---- the CLI ----------------------------------------------------------------------------
const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: ROOT });
const review = ['--kind', 'review', '--ambiguity', 'l', '--reversible', 'yes', '--scope', 'scripts/lint-plugins.mjs'];
const direct = run(SCRIPT, review);
const lines = direct.stdout.split('\n');
check('the CLI prints the paste-ready lines first', direct.status === 0 && lines[0] === 'Tier: premium' && lines[1] === 'Effort: high'
  && lines[2] === 'Route basis: review; surface=gate-script; ambiguity=low; reversible=yes', direct.stdout.slice(0, 200) + direct.stderr);
check('the CLI prints one binding line per host and marks each collapse', ['claude:', 'codex:', 'grok:', 'opencode:'].every((host, i) => lines[3 + i]?.startsWith(host))
  && !lines[4].includes('COLLAPSE') && lines[4].includes('gpt-6-astra') && lines[5].includes('COLLAPSE') && lines[6].includes('COLLAPSE') && !lines[3].includes('COLLAPSE'));
const viaCo = run(join(ROOT, 'scripts', 'co.mjs'), ['route', ...review]);
check('co route reaches the same script', viaCo.status === 0 && viaCo.stdout === direct.stdout, viaCo.stderr);
const asJson = run(SCRIPT, [...review, '--json']);
let parsed = null;
try { parsed = JSON.parse(asJson.stdout); } catch { /* reported below */ }
check('--json prints the routing result and the bindings', parsed?.rung === 'premium' && parsed.rule === '7a' && parsed.bindings?.length === 4, asJson.stdout.slice(0, 120));
const floored = run(SCRIPT, ['--kind', 'breadth', '--ambiguity', 'low', '--reversible', 'yes', '--agent', 'code-ops-suite:implementer']);
check('--agent raises the unit to the agent floor', floored.status === 0 && floored.stdout.startsWith('Tier: strong\n') && floored.stdout.includes('raised from light to the strong floor'), floored.stdout.slice(0, 120) + floored.stderr);
const vendored = run(join(ROOT, 'plugins', 'rigor', 'scripts', 'route-unit.mjs'), ['--kind', 'breadth', '--ambiguity', 'low', '--reversible', 'yes', '--agent', 'rigor:verifier']);
check('a vendored copy resolves its own plugin agent', vendored.status === 0 && vendored.stdout.startsWith('Tier: strong\n'), vendored.stdout.slice(0, 120) + vendored.stderr);
const swapped = run(SCRIPT, ['--kind', 'execution', '--ambiguity', 'l', '--reversible', 'yes', '--scope', 'src/auth/login.js', '--agent', 'code-ops-suite:reviewer']);
check('--agent raises a kind below the agent minimum and notes it', swapped.status === 0 && swapped.stdout.includes('Route basis: review; surface=security')
  && swapped.stdout.startsWith('Tier: premium\n') && swapped.stdout.includes('kind raised from execution to review'), swapped.stdout.slice(0, 200) + swapped.stderr);
const anchored = run(SCRIPT, [...review.slice(0, -1), 'scripts/lint-plugins.mjs:120-180']);
check('--scope strips a line anchor', anchored.status === 0 && anchored.stdout.startsWith('Tier: premium\n') && anchored.stdout.includes('surface=gate-script'), anchored.stdout.slice(0, 200) + anchored.stderr);
const peer = run(SCRIPT, ['--kind', 'peer', '--ambiguity', 'h', '--reversible', 'no', '--peer-exception']);
check('--peer-exception routes a peer to frontier with adaptive effort', peer.stdout.startsWith('Tier: frontier\nEffort: adaptive\n'), peer.stdout.slice(0, 80));
for (const [label, args] of [['an unknown kind', ['--kind', 'vibes', '--ambiguity', 'l', '--reversible', 'yes']], ['a missing flag', ['--kind', 'review']], ['an unknown agent', [...review, '--agent', 'rigor:ghost']], ['a bad attempt', [...review, '--attempt', 'two']]]) {
  const bad = run(SCRIPT, args);
  check(`${label} exits 2`, bad.status === 2 && bad.stdout === '', `status ${bad.status}: ${bad.stderr.slice(0, 120)}`);
}

// ---- mutants ----------------------------------------------------------------------------
// Each mutant breaks one rule in a temp copy of the script. A mutant that still passes means no
// fixture or property guards that rule, so the eval fails on it.
const MUTANTS = [
  ['drop the 7b irreversible trigger', "ambiguity === 'high' && reversible === 'no'", "ambiguity === 'high' && reversible === 'never'"],
  ['let review exceed the effort ceiling', "result('strong', 'high', '6'", "result('strong', 'xhigh', '6'"],
  ['ignore floors', 'if (FLOOR_RANK[rung] < FLOOR_RANK[floor]) {', 'if (false) {'],
  ['route breadth synthesis to high effort', "synthesis ? 'medium' : 'low'", "synthesis ? 'high' : 'low'"],
  ['skip the surface test in 7a', "&& surface !== 'none') {\n      return result('premium', 'high', '7a'", ") {\n      return result('premium', 'high', '7a'"],
  ['reach frontier without the exception', "kind === 'peer' && peerException) {", "kind === 'peer') {"],
  ['ignore the attempt count', 'if (attempt >= 2 &&', 'if (attempt >= 9 &&'],
  ['keep a line anchor on the path', ".replace(ANCHOR, '')", ''],
  ['match gate-script paths case-sensitively', 'lint-plugins\\.mjs$/i }', 'lint-plugins\\.mjs$/ }'],
  ['skip the agent minimum kind', 'KIND_RANK[kind] < KIND_RANK[min]', 'false'],
];
const source = readFileSync(SCRIPT, 'utf8').replaceAll('\r\n', '\n');
const work = mkdtempSync(join(tmpdir(), 'route-unit-eval-'));
try {
  for (const sibling of ['cli-lib.mjs', 'model-tiers.mjs']) copyFileSync(join(ROOT, 'scripts', sibling), join(work, sibling));
  for (const [index, [name, from, to]] of MUTANTS.entries()) {
    const found = source.split(from).length - 1;
    check(`mutant "${name}" matches the source exactly once`, found === 1, `${found} matches`);
    if (found !== 1) continue;
    const file = join(work, `mutant-${index}.mjs`);
    writeFileSync(file, source.replace(from, () => to));
    let broken = 0;
    try {
      const mod = await import(pathToFileURL(file).href);
      suite(mod, (_group, ok) => { if (!ok) broken++; });
    } catch { broken++; }
    check(`mutant "${name}" fails a case`, broken > 0, 'every case still passed');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} route-unit check(s) failed:\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log(`\nOK — route-unit: ${FIXTURES.length} fixtures, the input grid, ${SURFACE_CASES.length} surface paths, ${MUTANTS.length} mutants, and the CLI all pass.`);
