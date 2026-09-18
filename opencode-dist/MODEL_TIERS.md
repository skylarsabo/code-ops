# Model tiers

Generated in the code-ops repository by `scripts/build-opencode-dist.mjs`. Do not edit.

The suite routes operative work by capability tier, not by model name. The ladder is
provider-agnostic — `frontier > strong > mid > light` — so any host can tell which of its
models satisfies an agent’s floor. That is what makes the orchestration doctrine portable:
the briefs, the fan-out rules, and the verification bar are identical everywhere, and only
this table changes between providers.

Model ids are pinned, verified against the models.dev registry on 2026-09-13, except a
provider marked as verified against its host CLI, whose ids come from `opencode models` on the date its
entry records. Re-verify with `node scripts/check-model-registry.mjs --fetch` in the code-ops repository.

## Tier bindings

| Provider | `light` | `mid` | `strong` | `frontier` |
| --- | --- | --- | --- | --- |
| Anthropic (Claude) | `anthropic/claude-haiku-4-5-20251001` | `anthropic/claude-sonnet-5` | `anthropic/claude-opus-5` | `anthropic/claude-fable-5-1` |
| xAI (Grok) | `xai/grok-4.6` | `xai/grok-4.6` | `xai/grok-4.6` | `xai/grok-4.6` |
| OpenAI (GPT) | `openai/gpt-5.6-luna` | `openai/gpt-5.1` | `openai/gpt-5.6-terra` | `openai/gpt-5.6-sol` |
| Google (Gemini) | `google/gemini-3.1-flash-lite` | `google/gemini-3.6-flash` | `google/gemini-3.1-pro-preview` | `google/gemini-3.1-pro-preview` |
| Z.AI (GLM) | `zai/glm-5` | `zai/glm-5.1` | `zai/glm-5.2` | `zai/glm-5.2` |
| Moonshot AI (Kimi) | `moonshotai/kimi-k2.6` | `moonshotai/kimi-k2.7-code` | `moonshotai/kimi-k3` | `moonshotai/kimi-k3` |
| DeepSeek | `deepseek/deepseek-v4-flash` | `deepseek/deepseek-v4-flash` | `deepseek/deepseek-v4-pro` | `deepseek/deepseek-v4-pro` |
| Mistral | `mistral/magistral-small` | `mistral/mistral-medium-latest` | `mistral/magistral-medium-latest` | `mistral/magistral-medium-latest` |
| OpenCode Zen (free tier) | `opencode/muse-spark-1.3-contributor-free` | `opencode/muse-spark-1.3-contributor-free` | `opencode/muse-spark-1.3-contributor-free` | session model (lead unset) |

Where a provider repeats a model across two rungs, its lineup has no distinct model for
the lower one. The collapse is recorded rather than papered over with an invented tier.

## Provider notes

- **Anthropic (Claude)** — The reference ladder — the one agent frontmatter aliases resolve against. `frontier` binds to Fable 5.1 and remains lead-only; no bundled agent declares it as a floor.
- **xAI (Grok)** — Every rung binds to `grok-4.6` by deliberate choice, not because the lineup lacks cheaper models — `grok-4.3` is available at $1.25/$2.50 per 1M against grok-4.6’s $2/$6. Running one model throughout removes tier-routing as a variable and never routes work below its floor. Grok 4.6 takes the same low/medium/high/xhigh reasoning-effort dial the suite routes by ambiguity, so effort remains the live dial.
- **OpenAI (GPT)** — The strong/frontier split follows this repo’s own calibration evidence rather than price alone: runs R-007 and R-008 recorded `gpt-5-6-sol-xhigh` leading `gpt-5-6-terra-xhigh` operatives, so sol is the lead tier and terra the operative tier.
- **Google (Gemini)** — The only Pro-class id in the registry carries a `-preview` suffix, so `strong` and `frontier` share it. Re-pin once a stable Pro id ships.
- **Z.AI (GLM)** — A tight lineup: the top model serves both `strong` and `frontier`.
- **Moonshot AI (Kimi)** — `kimi-k2.6` is the general agent-loop light rung, `kimi-k2.7-code` is the coding-specialized mid rung, and `kimi-k3` serves both top rungs.
- **DeepSeek** — A two-model lineup, so each of its models covers two rungs. The cheapest ladder here by a wide margin.
- **Mistral** — Only the `magistral` line reasons, so the ladder is built from it wherever a rung needs reasoning.
- **OpenCode Zen (free tier)** — Zero account cost with a single operative model. Light, mid, and strong all bind to `muse-spark-1.3-contributor-free`, so no operative dispatch routes below its floor and tier-routing is not a variable on this provider. No free model holds a cited frontier result, so the lead stays unset and inherits the session model. Free-tier rate limits appear as 429s under a wide fan-out; shrink the wave before blaming the ladder.

## Premium specialists

Specialists are explicit bounded alternatives. They never replace a ready-made config’s
default lead or operative binding:

- `openai/gpt-6-astra` — `frontier` for difficult architecture, independent refutation, cross-domain synthesis. Use one bounded peer when the decision justifies Astra’s premium over the default Sol frontier. Keep ordinary judgment on the strong tier and final acceptance with the highest-tier lead.

## Ready-made configs

One config per provider ships under `configs/`, each binding every agent to its tier:

- `configs/opencode.anthropic.json`
- `configs/opencode.xai.json`
- `configs/opencode.openai.json`
- `configs/opencode.google.json`
- `configs/opencode.zai.json`
- `configs/opencode.moonshotai.json`
- `configs/opencode.deepseek.json`
- `configs/opencode.mistral.json`
- `configs/opencode.opencode.json`

`opencode.json` at the root is a copy of the `opencode` one, which costs nothing and leaves the lead
unset so it inherits the session model. Merge whichever you want into your own config rather
than overwriting a config you already have, and keep your own copy out of a refresh.

## Run contracts

`run-contract.mjs` requires a `frontier` lead in every version 4 `RUN_CONTRACT.json`.
The `opencode` ladder leaves the lead unset and binds no frontier model. Its contracts need a session model that another provider binds to `frontier`.

A `calibration` block is the only exception. It serves calibration arms (b) and (c) on the
assess-only track, and it admits a `strong` lead such as `muse-spark-1.3-contributor-free`. The validator rejects
the block when the lead model also serves the `frontier` rung, because that arm cannot
measure a strong-versus-frontier gap. That rules out a strong lead from: xAI (Grok), Google (Gemini), Z.AI (GLM), Moonshot AI (Kimi), DeepSeek, Mistral.

Contracts take bare model ids. Write `muse-spark-1.3-contributor-free`, not `opencode/muse-spark-1.3-contributor-free`. The
provider-prefixed form in the table above and in `opencode.json` fails the tier check.

## Agent floors

Each bundled agent states its required tier in its own file. For reference:

| Agent | Required tier |
| --- | --- |
| `code-ops-suite-explorer` | `light` |
| `code-ops-suite-implementer` | `strong` |
| `code-ops-suite-reviewer` | `strong` |
| `privacy-opsec-suite-explorer` | `light` |
| `privacy-opsec-suite-privacy-reviewer` | `strong` |
| `rigor-tracer` | `strong` |
| `rigor-verifier` | `strong` |
| `researcher-claim-checker` | `mid` |
| `researcher-gatherer` | `light` |

Reasoning effort is a separate dial and routes by ambiguity, not by tier: low for
mechanical work, medium for implementation and verification execution, high for review.
The major providers expose the same low/medium/high/xhigh scale, so the effort doctrine
transfers unchanged alongside the tier table.
