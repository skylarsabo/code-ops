---
description: "Use when you want high-value privacy and trust features found and specified, each gated against the anonymity model. Discovery and specification only."
---

# Privacy feature design: high-value, trust-building features

**Invoked as `/privacy-opsec-suite:privacy-feature-design`.** First read the bundled
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** DISCOVERY.
- **Produces:** a ranked `PRIVACY_FEATURE_OPPORTUNITIES.md`, mini-specifications, a roadmap,
  and a summary.
- **Limit:** discovery and specification only, with no implementation.

## Phase 0. Understand the product and its anonymity model  *(checkpoint)*

Dispatch the explorer subagent to map the current feature set, the anonymity and opsec
model, the latent capabilities, and the intent signals, meaning TODOs, stubs, and disabled
flags.

> **CHECKPOINT:** confirm the direction, the target users, what is in and out of scope, and
> the appetite.

## Phase 1. Find features that deepen trust and control

Grounded in the code, look for privacy and trust capabilities that strengthen the product's
position:

- data export and portability
- local-first operation or self-hosting
- end-to-end or zero-knowledge options
- ephemeral or anonymous modes
- metadata-minimization toggles
- user-controlled audit logs
- a transparency view of what the system knows about a user
- granular anonymity controls
- a Tor-only mode
- a panic or wipe control

Gate every idea against the anonymity model (`§A`). An idea must strengthen anonymity or be
neutral to it. Anything that would erode anonymity is flagged for a developer decision, and
never silently proposed. Define each idea's smallest valuable slice.

## Phase 2. Prioritize, then specify  *(checkpoint)*

Rank each idea by value multiplied by reach, divided by effort, and weighted by confidence.
Tag the quick wins and the big bets.

> **CHECKPOINT:** present the ranked opportunities. The developer picks which ones get a
> specification. Then write a mini-specification per chosen feature, including its anonymity
> impact and its fit with the threat model.

## Deliverables

`PRIVACY_FEATURE_OPPORTUNITIES.md` as a ranked register, the chosen mini-specifications, a
roadmap, and an `EXECUTIVE_SUMMARY.md`.

## Done when

The opportunities are grounded, gated against the model, and ranked. Both checkpoints are
done, mini-specifications exist for the chosen set, and no code changed.
