---
description: "Use when you want net-new, honestly-novel feature or direction ideas grounded in our code plus its domain and opt-in external trends, with feasibility and a smallest slice; produces a ranked ideas register and writes no code."
disable-model-invocation: true
---

# RESEARCH IDEATE — Net-New Directions, Grounded & Feasibility-Checked

**Invoked as `/researcher:research-ideate`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the research-integrity and egress model, operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** DISCOVERY · **Produces:** `IDEAS_REGISTER.md` (`IDEA-NNN`), `EGRESS_MANIFEST.md` (if any web egress), `EXECUTIVE_SUMMARY.md`.

Bring **external knowledge** — prior art, adjacent products, ecosystem trends, the capabilities our own dependencies already ship — and turn it into **net-new feature and direction ideas that fit our code**. The edge here is the outside view: this is the discovery skill that looks beyond the repo. Where `code-ops-suite:feature-discovery` mines the codebase alone for latent opportunity, this one asks "what is the world doing that we could do *here*, given our constraints?" — and answers with honest novelty, not cargo-cult. Every idea is cited and tiered (`§7`), grounded in our code (`§A`), feasibility-checked, and given a smallest slice. **It proposes and hands off (`§11`); it writes no code (`§4`).**

## Phase 0 — Product read, direction & egress permission  *(checkpoint)*
Local only. Detect the stack and read the product: current feature set, main user flows, target users, and intent signals (docs, README, architecture, TODOs/flags/stubs, and VCS history if available — what the product is *trying* to become). Frame the ideation: which domain, which user, which appetite (quick wins that extend an existing flow vs. big-bet new directions), and what "net-new" means *for this product* so we do not re-propose what already exists. Decide whether external trend-gathering is wanted at all (Phase 2 web is optional — local prior art alone is often enough).
> **CHECKPOINT — direction + egress decision.** Present your read of *what the product is, who it's for, where it's headed*, the candidate idea spaces, and the appetite. Then state the **egress decision explicitly:** "Phase 2 can stay fully local (installed-dependency docs via `lib-docs`, materials you provide), or — only with your opt-in — reach the web for adjacent products and ecosystem trends." Confirm direction, scope, and whether web egress is approved and bounded (which questions, which hosts). No network call happens before this approval (`§3`).

## Phase 1 — Ground: capabilities, latent assets, constraints
Local only; cite everything `file:line`. Establish the floor the ideas must clear:
- **Current capabilities** — what the product already does (so a new idea is genuinely new, not a re-skin).
- **Latent assets** — data already collected, services/libraries already present, infrastructure already paid for. The highest-leverage net-new features are often the ones that exploit an asset we already own; surface these first.
- **Constraints** — the stack, the architecture's grain, performance/scale realities, and the suite's **privacy/egress posture** (an idea that would weaken data-handling or add an outbound path is flagged, not silently proposed). Note where VCS history shows a direction was tried and abandoned.
Record this as the grounding context every idea will be tested against in Phases 3–4.

## Phase 2 — Gather inspiration (local first; web only if opted in at Phase 0)
Fan out across inspiration lenses, **local sources first:**
- **Dependency capabilities** — what our installed libraries already offer that we are not using yet. Default lookup is `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (or the `code-ops-docs` MCP when `code-ops-suite` is installed) — reads the **installed** version, zero query egress (`§2`). A feature we can build by turning on capability we already ship is the cheapest net-new there is.
- **Prior art in materials provided** — pasted text, file paths, and URLs the developer explicitly handed you (these are local inputs, not egress).
- **Adjacent products & ecosystem trends (web — opt-in)** — *only if approved at Phase 0:* compose the `deep-research` skill (fan-out search → fetch → adversarial verify) to find how the wild solves this, what category peers ship, and what direction the ecosystem is moving. **Before each external request, this is a checkpoint (`§3`).** Record every request in the manifest as you go:
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record --tool <tool> --host <host> --url <url> --why "<reason>"`.
> **CHECKPOINT — surface the manifest.** Before leaving this phase, show the developer the egress manifest so far (`§A`); confirm scope was honored and nothing left the machine unrecorded. If no web was used, state that the run stayed fully local.
Lenses to mine for net-new (not parity-only): **latent-asset exploitation**, **workflow completion / new flow**, **automation & power-user**, **new surface or integration**, **category differentiation**, **trust/transparency/control as a feature**, **accessibility as reach**, **monetizable or platform direction**. Apply the honest-novelty lens (`§10`) throughout: tag each candidate with what's genuinely new versus what merely follows a trend.

## Phase 3 — Feasibility & disconfirmation  *(compose `research-verify`)*
Run the disconfirmation pass (`§A`) on **every** candidate before it earns an ID; drop what does not survive:
- **Is it actually new *here*?** Cross-check against Phase 1 capabilities — already shipped, or a near-duplicate of something we have?
- **Is it feasible *here*?** Does it fit our stack and architecture's grain, or does it assume infrastructure we lack? What is the blast radius and migration cost?
- **Is it worth it?** Value × reach against effort — or is it a shiny trend with thin grounding?
- **Does it endanger the egress/privacy posture?** Any idea that adds an outbound path or new data collection is flagged for a developer decision, not assumed acceptable.
For each surviving candidate, **compose `research-verify`** to adversarially confirm the external claims behind it (does the prior-art source really say this? does it hold against our installed version and our code?) and to set the honest tier. An idea whose support is a single weak secondary lead is `SPECULATIVE` and stays labeled as such (`§7`); claims that cannot be grounded are marked `UNVERIFIED` and ranked below anything `PROBABLE`/`CONFIRMED` (`§8`).

## Phase 4 — Register ideas  *(checkpoint)*
Write each surviving idea to `IDEAS_REGISTER.md` using the finding/idea schema (`§6`) with a stable `IDEA-NNN`: Title · Lens · **Tier** · Claim · **Sources** (code `file:line` | installed-doc | external + its manifest entry) · Verified-at `<sha>` · **Grounding** (how it fits *our* code and constraints) · **Disconfirmation** (what you ruled out, including near-duplicates of existing features) · Value/Impact · **Smallest slice** · Recommendation · **Hands-off-to** · Effort · Risks. Rank by **value × reach ÷ effort**, weighted by tier and grounding strength (`§8`); tag quick wins vs. big bets; lead with a ranked top-N. Define the **smallest valuable slice** for each — the cheapest version that proves the idea before any larger build. Map the hand-off (`§11`): each actionable idea goes to `code-ops-suite:feature-discovery` (to spec it into the product backlog) or `code-ops-suite:feature-implementation` (to build a well-scoped slice); a direction with real architectural trade-offs is routed to `code-ops-suite:adr` for the decision record.
> **CHECKPOINT.** Present the ranked register top-first and confirm which ideas the developer wants handed off (and to which skill). Surface the final egress manifest one last time.

## Deliverables (dated discovery folder)
`IDEAS_REGISTER.md` (full ranked register, `IDEA-NNN`, tiered, cited, smallest slice + hand-off target per entry, quick wins/big bets tagged); `EGRESS_MANIFEST.md` if any web egress occurred; `EXECUTIVE_SUMMARY.md` (top net-new directions, the single highest-value idea to build next, decisions the developer must make, and the local-vs-web egress posture of the run).

## Done when
Direction and egress decisions confirmed at Phase 0; grounding established and every idea tested against it; inspiration gathered local-first with **no un-opted-in or unrecorded egress** — every external request appears in the manifest and the published register cites no web source absent from it, verified by `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate IDEAS_REGISTER.md` (`§A`); every idea disconfirmed (genuinely new here, feasible here, worth it), claim-checked via `research-verify`, cited and honestly tiered (`§7`), with a smallest slice and a hand-off target (`§11`); register deduped, scored, ranked, and each entry re-confirmed against the current tree and stamped `Verified-at: <sha>` (pre-filtered with `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs IDEAS_REGISTER.md --root <repo>`, `§12`); both checkpoints done; no code changed; a final self-audit for cargo-cult filler and unverified capabilities. Present `EXECUTIVE_SUMMARY.md` first, highest-value idea at the top.
