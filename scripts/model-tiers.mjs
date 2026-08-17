// Data-only map of the suite's provider-agnostic model tiers.
//
// WHY: docs/techniques/subagent-trade-offs.md states the routing rule in provider-agnostic
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
// Anthropic aliases, because Claude Code reads that field directly; the canonical rung is
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
export const REGISTRY_VERIFIED_AT = '2026-08-13';

export const PROVIDER_TIERS = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    aliases: { light: 'haiku', mid: 'sonnet', strong: 'opus', frontier: 'fable' },
    models: {
      light: 'claude-haiku-4-5-20251001',
      mid: 'claude-sonnet-5',
      strong: 'claude-opus-5',
      frontier: 'claude-fable-5',
    },
    notes: 'The reference ladder — the one agent frontmatter aliases resolve against. `frontier` is a lead-only tier; no bundled agent declares it as a floor.',
  },
  xai: {
    id: 'xai',
    label: 'xAI (Grok)',
    models: { light: 'grok-4.6', mid: 'grok-4.6', strong: 'grok-4.6', frontier: 'grok-4.6' },
    notes:
      'Every rung binds to `grok-4.6` by deliberate choice, not because the lineup lacks cheaper models — `grok-4.3` is available at $1.25/$2.50 per 1M against grok-4.6’s $2/$6. Running one model throughout removes tier-routing as a variable and never routes work below its floor. Grok 4.6 takes the same low/medium/high/xhigh reasoning-effort dial the suite routes by ambiguity, so effort remains the live dial.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (GPT)',
    models: {
      light: 'gpt-5.6-luna',
      mid: 'gpt-5.1',
      strong: 'gpt-5.6-terra',
      frontier: 'gpt-5.6-sol',
    },
    notes:
      'The strong/frontier split follows this repo’s own calibration evidence rather than price alone: runs R-007 and R-008 recorded `gpt-5-6-sol-xhigh` leading `gpt-5-6-terra-xhigh` operatives, so sol is the lead tier and terra the operative tier.',
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
    models: { light: 'kimi-k2.5', mid: 'kimi-k2.7-code', strong: 'kimi-k3', frontier: 'kimi-k3' },
    notes: '`kimi-k2.7-code` is the coding-specialized mid rung; `kimi-k3` serves both top rungs.',
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
};

// The provider the tracked example config binds to. Not the reference ladder — that is
// always `anthropic`, because agent frontmatter aliases resolve against it.
export const DEFAULT_PROVIDER = 'xai';

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

// The rank an agent frontmatter alias resolves to, or undefined when the alias is unknown.
export function rankOfAlias(alias) {
  const tier = CLAUDE_ALIAS_TIER[alias];
  return tier === undefined ? undefined : TIER_RANK[tier];
}
