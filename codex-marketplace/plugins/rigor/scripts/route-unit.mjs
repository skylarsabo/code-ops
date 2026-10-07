#!/usr/bin/env node
// Route one unit of work to a model rung and an effort: `co route`.
//
// WHY: the lead picks a tier and an effort for every dispatch, and without a table the pick
// drifts toward the cheapest rung that sounds plausible. This script holds the rubric from
// DESIGN_TIER_ROUTING.md as one pure function, so the lead, the evals, and (in a later slice)
// the dispatch guard read the same rule. It changes no dispatch behavior: it prints a
// recommendation and the brief line that records it.
//
//   node scripts/route-unit.mjs --kind <k> --ambiguity <l|m|h> --reversible <yes|no>
//     [--scope <path>]... [--attempt <n>] [--agent <plugin:agent>] [--peer-exception]
//     [--synthesis] [--json]
//
// Kinds: breadth, mechanical-read, mechanical-edit, gate-run, execution, judgment, review,
// refutation, peer. Output is the paste-ready `Tier:`, `Effort:`, and `Route basis:` lines,
// then one binding line per host with each collapse marked.
//
// Exit: 0 = routed; 2 = usage error.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseOrDie } from './cli-lib.mjs';
import { CLAUDE_ALIAS_TIER, PROVIDER_TIERS, TIER_ORDER } from './model-tiers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const KINDS = ['breadth', 'mechanical-read', 'mechanical-edit', 'gate-run', 'execution', 'judgment', 'review', 'refutation', 'peer'];
export const AMBIGUITIES = ['low', 'medium', 'high'];
export const SURFACES = ['none', 'security', 'egress', 'migration', 'public-contract', 'gate-script'];
// Dispatch rungs, weakest first. `premium` sits between strong and frontier for routing, but it
// ranks strong for floors (see FLOOR_RANK), so it clears only strong floors.
export const RUNGS = ['light', 'mid', 'strong', 'premium', 'frontier'];
export const RUNG_RANK = Object.fromEntries(RUNGS.map((rung, index) => [rung, index]));
export const FLOOR_RANK = { light: 0, mid: 1, strong: 2, premium: 2, frontier: 3 };
export const EFFORTS = ['low', 'medium', 'high'];

// The surfaces a unit's Scope can touch that make a wrong answer expensive. The list is
// deliberately narrow: it names the gate scripts and the auth, egress, migration, and public
// contract paths, not all of `hooks/` or `scripts/`, so premium stays a trigger and never turns
// into a default. A path is matched after backslashes become slashes, a leading `./` drops, and a
// trailing line anchor (`:120-180`, `#L120-L180`) drops. The patterns ignore case and accept either separator.
export const SURFACE_PATTERNS = [
  { surface: 'security', pattern: /(?:^|\/)(?:auth|oauth|authn|authz|credentials?|secrets?)(?:[/._-]|$)/i },
  { surface: 'egress', pattern: /(?:^|\/)egress(?:[/._-]|$)/i },
  { surface: 'migration', pattern: /(?:^|\/)migrat(?:e|ions?)(?:[/._-]|$)/i },
  {
    surface: 'public-contract',
    pattern: /(?:^|[/\\])(?:code-ops-docs[/\\]35 Contracts and Data[/\\]CONTRACTS\.md|\.claude-plugin[/\\](?:plugin|marketplace)\.json)$/i,
  },
  { surface: 'gate-script', pattern: /(?:^|[/\\])scripts[/\\]lint-plugins\.mjs$/i },
  { surface: 'gate-script', pattern: /(?:^|[/\\])scripts[/\\](?:doctrine-passages|layout-manifest|check-duplication)\.mjs$/i },
  { surface: 'gate-script', pattern: /(?:^|[/\\])evals[/\\]score\.mjs$/i },
  { surface: 'gate-script', pattern: /(?:^|[/\\])\.github[/\\]workflows[/\\]/i },
  { surface: 'gate-script', pattern: /(?:^|[/\\])plugins[/\\]code-ops-suite[/\\]hooks[/\\]dispatch-guard\.mjs$/i },
];

const ANCHOR = /(?:#L\d+(?:-L?\d+)?|:\d+(?:[-:]\d+)?)$/i;
const normalizePath = (path) => String(path).replaceAll('\\', '/').replace(/^\.\//, '').replace(ANCHOR, '');

// The lowest kind each agent routes as. A brief that declares a lower kind is raised to this one
// before routing, so a reviewer dispatched as "execution" still routes as a review. Agents not
// listed have no minimum. Kinds rank along the chain below; a peer ranks with judgment.
export const AGENT_MIN_KIND = {
  'code-ops-suite:reviewer': 'review',
  'privacy-opsec-suite:privacy-reviewer': 'review',
  'rigor:verifier': 'refutation',
  'rigor:tracer': 'judgment',
};
const KIND_CHAIN = ['breadth', 'mechanical-read', 'mechanical-edit', 'gate-run', 'execution', 'judgment', 'review', 'refutation'];
const KIND_RANK = { ...Object.fromEntries(KIND_CHAIN.map((kind, index) => [kind, index])), peer: KIND_CHAIN.indexOf('judgment') };

// `{ kind, raisedFrom }`: the kind to route and the declared kind it replaced, or null. An unknown
// kind is left alone, so validation reports it.
export function applyMinKind(kind, agent) {
  const key = String(agent ?? '').trim().toLowerCase();
  const min = Object.hasOwn(AGENT_MIN_KIND, key) ? AGENT_MIN_KIND[key] : null;
  if (min && Object.hasOwn(KIND_RANK, kind) && KIND_RANK[kind] < KIND_RANK[min]) return { kind: min, raisedFrom: kind };
  return { kind, raisedFrom: null };
}

// The one surface a Scope derives, or `none`. Several surfaces resolve in SURFACES order, so the
// answer does not depend on the order the paths were listed.
export function surfaceOfScope(paths) {
  const found = new Set();
  for (const raw of paths ?? []) {
    const path = normalizePath(raw);
    for (const { surface, pattern } of SURFACE_PATTERNS) if (pattern.test(path)) found.add(surface);
  }
  return SURFACES.find((surface) => found.has(surface)) ?? 'none';
}

// Kinds whose rung is `strong` before a premium trigger applies (rows 3 to 6). A trigger never
// lifts breadth or a mechanical unit: premium at high effort on a read-only sweep is the spend
// the rubric exists to prevent.
const STRONG_KINDS = new Set(['execution', 'judgment', 'review', 'refutation']);

const result = (rung, effort, rule, why, notes = []) => ({ rung, effort, rule, why, notes });

function validate(basis) {
  if (basis === null || typeof basis !== 'object') throw new TypeError('route basis must be an object');
  if (!KINDS.includes(basis.kind)) throw new TypeError(`kind must be one of ${KINDS.join(', ')}`);
  if (!AMBIGUITIES.includes(basis.ambiguity)) throw new TypeError(`ambiguity must be one of ${AMBIGUITIES.join(', ')}`);
  if (!['yes', 'no'].includes(basis.reversible)) throw new TypeError('reversible must be yes or no');
  if (basis.surface !== undefined && !SURFACES.includes(basis.surface)) throw new TypeError(`surface must be one of ${SURFACES.join(', ')}`);
  if (basis.attempt !== undefined && !(Number.isInteger(basis.attempt) && basis.attempt >= 1)) throw new TypeError('attempt must be an integer of 1 or more');
  if (basis.floor !== undefined && basis.floor !== null && !TIER_ORDER.includes(basis.floor)) throw new TypeError(`floor must be one of ${TIER_ORDER.join(', ')}`);
}

// The unit's rung and effort before any floor applies.
function route(basis, attempt) {
  const { kind, ambiguity, reversible, surface = 'none', synthesis = false, peerException = false } = basis;
  // Row 8. A peer takes the frontier rung only with the Run Contract exception, and it outranks
  // every premium trigger because frontier is the higher rung. Without the exception a peer
  // routes as judgment, so the flag is the only way to reach frontier.
  if (kind === 'peer' && peerException) {
    return result('frontier', 'adaptive', '8', 'bounded peer with a Run Contract peerException (Fable; no effort sent)');
  }
  const effective = kind === 'peer' ? 'judgment' : kind;
  const notes = kind === 'peer' ? ['peer without peerException routes as judgment; frontier needs the Run Contract exception'] : [];

  if (STRONG_KINDS.has(effective)) {
    if ((effective === 'review' || effective === 'refutation') && surface !== 'none') {
      return result('premium', 'high', '7a', `${effective} on a ${surface} surface`, notes);
    }
    if (ambiguity === 'high' && reversible === 'no') {
      return result('premium', 'high', '7b', 'ambiguity high and not reversible', notes);
    }
    // A strong attempt that failed earns one premium attempt. The prior rung is what this basis
    // routes to at attempt 1, so a unit that was already premium or lower never re-triggers.
    if (attempt >= 2 && route(basis, 1).rung === 'strong') {
      return result('premium', 'high', '7c', `attempt ${attempt} after a failed strong attempt`, notes);
    }
    if (effective === 'judgment' && ambiguity === 'high' && surface === 'public-contract') {
      return result('premium', 'high', '7d', 'judgment at high ambiguity on a public-contract surface', notes);
    }
  }

  if (effective === 'breadth' || effective === 'mechanical-read') {
    return result('light', synthesis ? 'medium' : 'low', '1', 'breadth or mechanical read', notes);
  }
  if (effective === 'mechanical-edit' || effective === 'gate-run') return result('mid', 'low', '2', 'mechanical edit or gate run', notes);
  if (effective === 'execution') return result('strong', 'medium', '3', 'execution to a fixed spec', notes);
  if (effective === 'judgment') {
    return ambiguity === 'high'
      ? result('strong', 'high', '5', 'judgment at high ambiguity', notes)
      : result('strong', 'medium', '4', 'judgment at low or medium ambiguity', notes);
  }
  return result('strong', 'high', '6', 'review or refutation', notes);
}

// Basis: { kind, ambiguity, reversible, surface?, attempt?, floor?, peerException?, synthesis? }.
// Returns { rung, effort, rule, why, notes, basisLine }. Pure: no file, env, or clock reads.
export function routeUnit(basis) {
  validate(basis);
  const attempt = basis.attempt ?? 1;
  const surface = basis.surface ?? 'none';
  const routed = route({ ...basis, surface }, attempt);
  // Floors only raise. A floor never lifts a unit to premium or frontier, which carry their own
  // triggers, so a frontier floor is capped at strong and noted.
  const notes = [...routed.notes];
  let { rung } = routed;
  if (basis.floor) {
    const floor = basis.floor === 'frontier' ? 'strong' : basis.floor;
    if (basis.floor === 'frontier') notes.push('a frontier floor is capped at strong; frontier needs a peerException');
    if (FLOOR_RANK[rung] < FLOOR_RANK[floor]) {
      notes.push(`raised from ${rung} to the ${floor} floor`);
      rung = floor;
    }
  }
  return {
    rung,
    effort: routed.effort,
    rule: routed.rule,
    why: routed.why,
    notes,
    basisLine: `${basis.kind}; surface=${surface}; ambiguity=${basis.ambiguity}; reversible=${basis.reversible}`,
  };
}

// The rung whose model `rung` repeats on this provider, or null when the lineup binds a distinct
// model. Premium reads the explicit `premiumCollapse` the data records.
function collapseOf(provider, rung) {
  if (rung === 'premium') return provider.premiumCollapse ?? null;
  const model = provider.models[rung];
  if (model === null || model === undefined) return null;
  const lower = TIER_ORDER.slice(0, TIER_ORDER.indexOf(rung)).filter((tier) => provider.models[tier] === model);
  return lower.at(-1) ?? null;
}

// One binding per host for a routed rung. Each entry names the model a dispatch passes, and
// `collapse` carries the rung it shares a model with, so a reader sees where the rung is not a
// variable. Hosts are claude, codex, grok, and opencode, mapped to provider ladders.
export function hostBindings(rung) {
  const hostProvider = { claude: 'anthropic', codex: 'openai', grok: 'xai', opencode: 'opencode' };
  return Object.entries(hostProvider).map(([host, providerId]) => {
    const provider = PROVIDER_TIERS[providerId];
    const model = provider.models[rung];
    const collapse = collapseOf(provider, rung);
    let detail;
    if (host === 'claude') {
      const alias = provider.dispatchAlias[rung];
      detail = alias === null
        ? `leave model unset; the frontmatter pin ${model} applies`
        : `model="${alias}" (${model})`;
    } else if (host === 'opencode') {
      detail = model === null
        ? 'lead model inherits the session model'
        : `Tier: ${rung}; ${rung === 'premium' ? '<agent>-premium clone, ' : ''}${model}`;
    } else if (host === 'grok') {
      detail = `${model}; every rung is one model, so effort is the live dial; strip model when subagent_model_inheritance is on`;
    } else {
      detail = `${model}; set model and reasoning_effort from the brief with fork_turns none`;
    }
    return { host, provider: providerId, model, detail, collapse };
  });
}

const bindingLine = ({ host, detail, collapse }, rung) =>
  `${host}: ${detail}${collapse ? ` [COLLAPSE: ${rung} shares its model with ${collapse}${rung === 'premium' ? '; no distinct premium model' : ''}]` : ''}`;

// The frontmatter `model:` of a bundled agent, as the rung the agent declares. The root checkout
// holds every plugin under plugins/; a vendored copy holds only its own plugin's agents.
function agentFloor(spec) {
  const [plugin, agent] = String(spec).split(':');
  if (!plugin || !agent) throw new TypeError('--agent needs <plugin>:<agent>');
  const candidates = [join(HERE, '..', 'plugins', plugin, 'agents', `${agent}.md`)];
  const manifest = join(HERE, '..', '.claude-plugin', 'plugin.json');
  if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === plugin) candidates.push(join(HERE, '..', 'agents', `${agent}.md`));
  const file = candidates.find((candidate) => existsSync(candidate));
  if (!file) throw new TypeError(`no agent file for ${spec}`);
  const model = readFileSync(file, 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1].match(/^model:[ \t]*(\S+)/m)?.[1];
  const tier = CLAUDE_ALIAS_TIER[model];
  if (!tier) throw new TypeError(`${spec} declares no known model tier`);
  return tier;
}

const USAGE = 'usage: co route --kind <k> --ambiguity <l|m|h> --reversible <yes|no> [--scope <path>]... [--attempt <n>] [--agent <plugin:agent>] [--peer-exception] [--synthesis] [--json]';

const SHORT_AMBIGUITY = { l: 'low', m: 'medium', h: 'high' };

function cli(argv) {
  const { flags } = parseOrDie(argv, {
    kind: { value: true, required: true },
    ambiguity: { value: true, required: true },
    reversible: { value: true, required: true },
    scope: { value: true, many: true },
    attempt: { value: true, default: '1' },
    agent: { value: true },
    'peer-exception': {},
    synthesis: {},
    json: {},
  }, USAGE);
  try {
    const attempt = Number(flags.attempt);
    const { kind, raisedFrom } = flags.agent ? applyMinKind(flags.kind, flags.agent) : { kind: flags.kind, raisedFrom: null };
    const basis = {
      kind,
      ambiguity: SHORT_AMBIGUITY[flags.ambiguity] ?? flags.ambiguity,
      reversible: flags.reversible,
      surface: surfaceOfScope(flags.scope),
      attempt,
      floor: flags.agent ? agentFloor(flags.agent) : null,
      peerException: flags['peer-exception'] === true,
      synthesis: flags.synthesis === true,
    };
    const routed = routeUnit(basis);
    if (raisedFrom) routed.notes.push(`kind raised from ${raisedFrom} to ${kind}: ${flags.agent} routes as at least ${kind}`);
    const bindings = hostBindings(routed.rung);
    if (flags.json) {
      console.log(JSON.stringify({ ...routed, bindings }, null, 2));
      return 0;
    }
    console.log(`Tier: ${routed.rung}`);
    console.log(`Effort: ${routed.effort}`);
    console.log(`Route basis: ${routed.basisLine}`);
    for (const binding of bindings) console.log(bindingLine(binding, routed.rung));
    console.log(`Rule: ${routed.rule} (${routed.why})`);
    for (const note of routed.notes) console.log(`Note: ${note}`);
    return 0;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    console.error(`x ${error.message}`);
    console.error(USAGE);
    return 2;
  }
}

const isMain = () => process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain()) process.exitCode = cli(process.argv.slice(2));
