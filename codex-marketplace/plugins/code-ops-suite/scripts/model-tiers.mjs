// Data-only map of the suite's provider-agnostic model tiers.
//
// WHY: code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md states the routing rule in provider-agnostic
// terms (frontier > strong > mid), but the gate that enforced it hardcoded Anthropic's
// alias ladder. A reader on another host could not tell which of their models satisfied a
// floor. This module is the single source of truth for both readings, so the doctrine and
// the gate cannot describe different ladders.
//
// Two consumers:
//   - scripts/lint-plugins.mjs        — resolves agent frontmatter aliases to a rank and
//     compares against AGENT_MODEL_FLOORS. Ordering is unchanged from the hardcoded
//     { haiku: 0, sonnet: 1, opus: 2 } scale it replaced.
//   - scripts/build-opencode-dist.mjs — renders the per-provider binding table that ships
//     with the opencode distribution.
//
// Adding a provider means adding one PROVIDER_TIERS entry. Agent frontmatter keeps using
// Anthropic aliases, because Codex reads that field directly; the canonical rung is
// what travels to other hosts.

// The canonical capability rungs, weakest first. `light` names the rung the doctrine
// describes but never named — the mechanical, execution-only tier below `mid`.
export const TIER_ORDER = ['light', 'mid', 'strong', 'frontier'];

export const TIER_RANK = Object.fromEntries(TIER_ORDER.map((tier, index) => [tier, index]));

// Agent frontmatter vocabulary (Anthropic aliases) resolved to canonical rungs. This is
// the only alias set `model:` may carry in plugins/*/agents/*.md.
export const CLAUDE_ALIAS_TIER = {
  haiku: 'light',
  sonnet: 'mid',
  opus: 'strong',
};

// Which concrete model serves each rung, per provider. A provider whose lineup has no
// distinct model for a rung repeats the nearest one above it; that collapse is deliberate
// and documented rather than hidden behind an invented tier.
//
// Every `models` id below is a real id in the models.dev registry that opencode itself
// resolves against, verified at the date in REGISTRY_VERIFIED_AT. They are pinned, not
// fetched, so the renderer and the gate stay offline and deterministic. Re-verify them with
// `node scripts/check-model-registry.mjs --fetch`, which is opt-in for exactly that reason.
//
// Adding a provider is one entry here plus one PROVIDER_SLUG_PATTERNS line. Nothing else in
// the suite hardcodes a model name.
export const REGISTRY_VERIFIED_AT = '2026-09-22';

export const PROVIDER_TIERS = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    aliases: { light: 'haiku', mid: 'sonnet', strong: 'opus', frontier: 'fable' },
    models: {
      light: 'claude-haiku-4-5-20251001',
      mid: 'claude-sonnet-5',
      strong: 'claude-opus-5-5',
      frontier: 'claude-fable-5-1',
    },
    notes: 'The reference ladder — the one agent frontmatter aliases resolve against. `strong` binds to Claude Opus 5.5 ($4/$20 per million tokens, cache reads $0.20) and `frontier` stays Fable 5.1, lead-only. No bundled agent declares frontier as a floor.',
  },
  xai: {
    id: 'xai',
    label: 'xAI (Grok)',
    models: { light: 'grok-4.7', mid: 'grok-4.7', strong: 'grok-4.7', frontier: 'grok-4.7' },
    notes:
      'Every rung binds to `grok-4.7` by deliberate choice. It replaces `grok-4.6` at the same $2/$6 list price and keeps the low/medium/high/xhigh effort dial, so effort stays the live dial and no rung routes below the floor. Input, output, and cache reads double above 200,000 tokens, which is why the handoff assessment sits at 150,000. `grok-build-0.1` is the fast coding specialist, not a default rung.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (GPT)',
    models: {
      light: 'gpt-6-luna',
      mid: 'gpt-5.1',
      strong: 'gpt-5.6-terra',
      frontier: 'gpt-6-sol',
    },
    notes:
      'Luna and Sol are the GPT-6 successors of the 5.6 pins, at half the promotional token price ($0.10/$0.50 and $2/$10). Terra stays the operative strong model because no GPT-6 Terra shipped. Sol remains the default frontier from runs R-007 and R-008, and its token price now sits below Terra, so the large lead context is the cheaper model.',
  },
  google: {
    id: 'google',
    label: 'Google (Gemini)',
    models: {
      light: 'gemini-3.1-flash-lite',
      mid: 'gemini-3.6-flash',
      strong: 'gemini-3.1-pro-preview',
      frontier: 'gemini-3.1-pro-preview',
    },
    notes: 'The only Pro-class id in the registry carries a `-preview` suffix, so `strong` and `frontier` share it. Re-pin once a stable Pro id ships.',
  },
  zai: {
    id: 'zai',
    label: 'Z.AI (GLM)',
    models: { light: 'glm-5', mid: 'glm-5.1', strong: 'glm-5.2', frontier: 'glm-5.2' },
    notes: 'A tight lineup: the top model serves both `strong` and `frontier`.',
  },
  moonshotai: {
    id: 'moonshotai',
    label: 'Moonshot AI (Kimi)',
    models: { light: 'kimi-k2.6', mid: 'kimi-k2.7-code', strong: 'kimi-k3', frontier: 'kimi-k3' },
    notes: '`kimi-k2.6` is the general agent-loop light rung, `kimi-k2.7-code` is the coding-specialized mid rung, and `kimi-k3` serves both top rungs.',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    models: {
      light: 'deepseek-v4-flash',
      mid: 'deepseek-v4-flash',
      strong: 'deepseek-v4-pro',
      frontier: 'deepseek-v4-pro',
    },
    notes: 'A two-model lineup, so each of its models covers two rungs. The cheapest ladder here by a wide margin.',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    models: {
      light: 'magistral-small',
      mid: 'mistral-medium-latest',
      strong: 'magistral-medium-latest',
      frontier: 'magistral-medium-latest',
    },
    notes: 'Only the `magistral` line reasons, so the ladder is built from it wherever a rung needs reasoning.',
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode Zen (free tier)',
    // Ids come from `opencode models`, the host's own list, because models.dev does not carry
    // the Zen catalogue. `registry: 'cli'` tells the checker to verify them there, and
    // `frontier: null` leaves the lead unset so it inherits the operator's session model.
    registry: 'cli',
    verifiedAt: '2026-09-17',
    models: {
      light: 'muse-spark-1.3-contributor-free',
      mid: 'muse-spark-1.3-contributor-free',
      strong: 'muse-spark-1.3-contributor-free',
      frontier: null,
    },
    notes: 'Zero account cost with a single operative model. Light, mid, and strong all bind to `muse-spark-1.3-contributor-free`, so no operative dispatch routes below its floor and tier-routing is not a variable on this provider. No free model holds a cited frontier result, so the lead stays unset and inherits the session model. Free-tier rate limits appear as 429s under a wide fan-out; shrink the wave before blaming the ladder.',
  },
  'github-copilot': {
    id: 'github-copilot',
    label: 'GitHub Copilot (AI Credits)',
    verifiedAt: '2026-09-23',
    models: { light: 'gpt-6-luna', mid: 'gemini-3.8-flash', strong: 'gpt-6-sol', frontier: 'gpt-6-sol' },
    notes: 'Copilot bills GitHub AI Credits (1 credit = $0.01) from input, cached, cache-write, and output tokens. Each rung binds the lowest-cost verified model that meets it. Sol serves both top rungs because it is the calibrated frontier on the OpenAI ladder and costs less than Opus 5.5 or Grok 4.7 on a standard operative workload. PROVIDER_PRICES carries the per-million rates the live chooser and the cost report read.',
  },
};

// Explicit alternatives do not replace a provider's cost-disciplined default ladder.
// A run selects one explicitly for a bounded specialist unit, and the contract records
// that choice. This keeps a generated provider config from spending the premium on every
// lead turn while still letting the capability and acceptance gates recognize the model.
export const PROVIDER_SPECIALISTS = {
  openai: [
    {
      name: 'astra',
      model: 'gpt-6-astra',
      tier: 'frontier',
      uses: ['difficult architecture', 'independent refutation', 'cross-domain synthesis'],
      verifiedAt: '2026-09-22',
      notes: 'Use one bounded peer when the decision justifies Astra’s premium over the default Sol frontier. Sol is $2/$10 and Astra is $10/$50, verified 2026-09-22. Keep ordinary judgment on the strong tier and final acceptance with the highest-tier lead.',
    },
  ],
  xai: [
    {
      name: 'build',
      model: 'grok-build-0.1',
      tier: 'light',
      uses: ['mechanical breadth', 'high-volume file and log triage'],
      verifiedAt: '2026-09-22',
      notes: 'Fast coding model at $1/$2 per million tokens, with no effort dial and a 256k window. The live OpenCode chooser may bind a light agent to it when the host lists it. It is not the default light pin, and it never satisfies a mid, strong, or frontier floor.',
    },
  ],
  'github-copilot': [
    {
      name: 'opus',
      model: 'claude-opus-5.5',
      tier: 'strong',
      uses: ['quality-first judgment', 'review'],
      verifiedAt: '2026-09-23',
      notes: 'Opus 5.5 at $4/$20 per million tokens, cache reads $0.20 and cache writes $5. Select it for a unit where review quality outweighs the premium over Sol.',
    },
    {
      name: 'grok',
      model: 'grok-4.7',
      tier: 'strong',
      uses: ['short high-output units'],
      verifiedAt: '2026-09-23',
      notes: 'Grok 4.7 at $2/$6 per million tokens, but cached input costs $0.50, 2.5 times Sol and Opus 5.5, and every rate doubles above 200,000 tokens. It suits short units with a large output, not a long lead.',
    },
    {
      name: 'haiku',
      model: 'claude-haiku-4.5',
      tier: 'light',
      uses: ['mechanical breadth'],
      verifiedAt: '2026-09-23',
      notes: 'Haiku 4.5 at $1/$5 per million tokens. A light alternative to Luna when the unit needs a Claude model.',
    },
    {
      name: 'mai-code',
      model: 'mai-code-1.1-flash',
      tier: 'light',
      uses: ['mechanical breadth', 'high-volume file and log triage'],
      verifiedAt: '2026-09-23',
      notes: 'MAI Code 1.1 Flash at $0.20/$1.20 per million tokens. It never satisfies a mid, strong, or frontier floor.',
    },
  ],
};

// Per-million-token USD prices for a provider whose bill is token-priced, so the live
// OpenCode chooser can rank models by cost and the cost report can price a flat-rate row
// offline. `cacheWrite` is present only where the provider lists it; without it a cache
// write bills at `input`. `longContext` rates apply to a request above `above` tokens.
// Prices are pinned with their source, not fetched, for the same reason model ids are.
const COPILOT_PRICING = 'https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing';
const copilot = (rates) => ({ ...rates, verifiedAt: '2026-09-23', source: COPILOT_PRICING });
export const PROVIDER_PRICES = {
  'github-copilot': {
    'grok-4.7': copilot({ input: 2, cached: 0.5, output: 6, longContext: { above: 200_000, input: 4, cached: 1, output: 12 } }),
    'gpt-6-sol': copilot({ input: 2, cached: 0.2, cacheWrite: 2.5, output: 10, longContext: { above: 272_000, input: 4, cached: 0.4, cacheWrite: 5, output: 15 } }),
    'gpt-6-luna': copilot({ input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5, longContext: { above: 272_000, input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 0.75 } }),
    // Promotional price through 2026-12-31.
    'gemini-3.8-flash': copilot({ input: 0.75, cached: 0.075, output: 3.75 }),
    'mai-code-1.1-flash': copilot({ input: 0.2, cached: 0.02, output: 1.2 }),
    'claude-haiku-4.5': copilot({ input: 1, cached: 0.1, cacheWrite: 1.25, output: 5 }),
    'claude-opus-5.5': copilot({ input: 4, cached: 0.2, cacheWrite: 5, output: 20 }),
  },
};

// Hosts keep binding the previous pin, or a reseller spelling of a current one, after the
// default moved. Ready-made configs ignore this map. `modelClassOf` still sees it, so a
// historical stamp keeps the rung it had. A spelling alias takes the tier of the model it
// names and never creates a rung.
export const ACCEPTED_MODELS = {
  'claude-opus-5': ['strong'],
  'gpt-5.6-luna': ['light'],
  'gpt-5.6-sol': ['frontier'],
  'grok-4.6': ['light', 'mid', 'strong', 'frontier'],
  'claude-haiku-4-5': ['light'],
  'claude-haiku-4.5': ['light'],
  'claude-opus-5.5': ['strong'],
  'claude-fable-5.1': ['frontier'],
};

export function modelSupportsTier(modelId, tier) {
  if (typeof modelId !== 'string' || !TIER_ORDER.includes(tier)) return false;
  return Object.values(PROVIDER_TIERS).some((provider) => provider.models[tier] === modelId)
    || Object.values(PROVIDER_SPECIALISTS).flat().some((entry) => entry.model === modelId && entry.tier === tier)
    || (ACCEPTED_MODELS[modelId]?.includes(tier) ?? false);
}

// A provider whose `frontier` is null renders no top-level `model`, so the lead inherits the
// session model. Every other rung must still name a model.
export const leadInherits = (provider) => provider.models.frontier === null;

// The provider the tracked example config binds to: the free ladder, so a fresh install costs
// nothing and keeps the tier routing. Not the reference ladder, which is always `anthropic`,
// because agent frontmatter aliases resolve against it. Every other provider's config ships
// beside it under `configs/`.
export const DEFAULT_PROVIDER = 'opencode';

// Calibration runs record their orchestration as free-form kebab model-class slugs
// (`opus-5`, `gpt-5-6-sol-xhigh`). Attributing those to a provider is what lets the
// calibration graph ask the question that matters for improving every model at once: did
// this lesson recur under more than one provider?
//
// Prefix patterns rather than a slug allowlist, because the slug set grows every run and a
// stale allowlist would silently report "unattributed" for a provider already in the store.
// A slug matching nothing stays unattributed — never guessed, because a wrong attribution
// would merge two providers' evidence and invent corroboration that does not exist.
const PROVIDER_SLUG_PATTERNS = [
  ['anthropic', /^(claude|opus|sonnet|haiku|fable)\b/],
  ['xai', /^grok\b/],
  ['opencode', /^(ling|mimo|nemotron|muse)\b/],
  ['github-copilot', /^(github-copilot|copilot|mai)\b/],
  ['openai', /^(gpt|codex|o[0-9])\b/],
  ['google', /^gemini\b/],
  ['zai', /^glm\b/],
  ['moonshotai', /^kimi\b/],
  ['deepseek', /^deepseek\b/],
  ['mistral', /^(mistral|magistral)\b/],
  ['meta', /^llama\b/],
  ['alibaba', /^qwen\b/],
];

// The provider a calibration `config.lead` / `config.operatives` slug belongs to, or null
// when nothing matches. Note that a provider may be attributable here without appearing in
// PROVIDER_TIERS: identity is knowable from the slug, but a tier ladder is only recorded
// for providers whose model lineup has been verified.
export function providerOfConfigSlug(slug) {
  if (typeof slug !== 'string') return null;
  for (const [provider, pattern] of PROVIDER_SLUG_PATTERNS) {
    if (pattern.test(slug)) return provider;
  }
  return null;
}

// Reverse index of PROVIDER_TIERS: a concrete model id -> the set of canonical rungs it
// serves. Built from the table above so the ladder and the classifier can never describe
// different tiers.
const RUNGS_BY_MODEL_ID = (() => {
  const index = new Map();
  for (const provider of Object.values(PROVIDER_TIERS)) {
    for (const [tier, id] of Object.entries(provider.models)) {
      if (!index.has(id)) index.set(id, new Set());
      index.get(id).add(tier);
    }
  }
  for (const specialists of Object.values(PROVIDER_SPECIALISTS)) {
    for (const specialist of specialists) {
      if (!index.has(specialist.model)) index.set(specialist.model, new Set());
      index.get(specialist.model).add(specialist.tier);
    }
  }
  for (const [id, tiers] of Object.entries(ACCEPTED_MODELS)) {
    if (!index.has(id)) index.set(id, new Set());
    for (const tier of tiers) index.get(id).add(tier);
  }
  return index;
})();

// The classes a dispatch's model half can resolve to, in report order. The four canonical
// rungs, then the two honest non-answers.
export const MODEL_CLASS_ORDER = [...TIER_ORDER, 'ambiguous', 'unclassified'];

// The canonical rung a stamped model id belongs to.
//
// Three answers, and the last two are deliberate refusals rather than guesses:
//   - a rung name, when the id serves exactly one rung in PROVIDER_TIERS;
//   - `ambiguous`, when the id serves several rungs — a single-model ladder (xai) or a
//     lineup that collapses two rungs onto one id (google, zai) carries no tier signal at
//     all, and naming one of its rungs would invent a distinction the provider does not make;
//   - `unclassified`, when the id is in no ladder. A model this repo has not pinned cannot
//     be placed on the ladder by shape, and a wrong placement would read as a routing
//     verdict — the same reason providerOfConfigSlug leaves an unmatched slug unattributed.
export function modelClassOf(modelId) {
  if (typeof modelId !== 'string') return 'unclassified';
  const rungs = RUNGS_BY_MODEL_ID.get(modelId.trim());
  if (!rungs) return 'unclassified';
  return rungs.size === 1 ? [...rungs][0] : 'ambiguous';
}

// Authorization needs the highest rung a model can serve. Reporting keeps returning
// `ambiguous` for collapsed ladders, because one id still carries no unique class signal.
export function modelRankOf(modelId) {
  if (typeof modelId !== 'string') return undefined;
  const rungs = RUNGS_BY_MODEL_ID.get(modelId.trim());
  if (!rungs?.size) return undefined;
  return Math.max(...[...rungs].map((tier) => TIER_RANK[tier]));
}

// The rank an agent frontmatter alias resolves to, or undefined when the alias is unknown.
export function rankOfAlias(alias) {
  const tier = CLAUDE_ALIAS_TIER[alias];
  return tier === undefined ? undefined : TIER_RANK[tier];
}
