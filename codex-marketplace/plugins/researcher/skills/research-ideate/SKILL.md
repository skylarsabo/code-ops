---
name: research-ideate
description: "Use when you want net-new, honestly-novel feature or direction ideas grounded in our code plus its domain and opt-in external trends; writes no code. For ideas mined from the codebase alone, use code-ops-suite:feature-discovery."
---

# RESEARCH IDEATE — Net-New Directions, Grounded & Feasibility-Checked

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `researcher:research-ideate`.** First read the bundled `<plugin-root>/CONVENTIONS.md` — the research-integrity & egress model (`§A`), protocol, rails, schemas, tiers, and lenses, referenced by section.
**Mode:** DISCOVERY · **Produces:** `IDEAS_REGISTER.md` (`IDEA-NNN`), `EGRESS_MANIFEST.md` (if any web egress), `EXECUTIVE_SUMMARY.md`.

The outside view — prior art, adjacent products, ecosystem trends, capabilities our dependencies already ship — turned into net-new ideas that fit our code (`code-ops-suite:feature-discovery` mines the codebase alone; this skill looks beyond the repo). Every idea cited + tiered (`§7`), grounded (`§A`), feasibility-checked, smallest-sliced. **Proposes and hands off (`§11`); writes no code (`§4`).**

## Phase 0 — Product read, direction & egress permission  *(checkpoint)*
Local only. Detect the stack and read the product: current feature set, main flows, target users, intent signals (docs, README, architecture, TODOs/flags/stubs, VCS history). Frame the ideation: which domain, which user, which appetite (quick wins vs. big bets), and what "net-new" means *for this product*.
> **CHECKPOINT — direction + egress decision.** Present the product read, candidate idea spaces, and appetite; state the **egress decision explicitly** — Phase 2 stays fully local (`lib-docs`, provided materials) unless web reach for adjacent products and trends is opted in and bounded (which questions, which hosts). No network call before this approval (`§3`).

## Phase 1 — Ground: capabilities, latent assets, constraints
Local only; cite everything `file:line`. The floor ideas must clear: **current capabilities** (so an idea is genuinely new, not a re-skin) · **latent assets** (data collected, services/libraries present, infrastructure already paid for — the highest-leverage ideas exploit an asset we own; surface first) · **constraints** (stack, the architecture's grain, performance/scale, and the **privacy/egress posture** — an idea that weakens data-handling or adds an outbound path is flagged, never silently proposed). Note directions VCS history shows were tried and abandoned.

## Phase 2 — Gather inspiration  *(local first; web only if opted in at Phase 0)*
- **Dependency capabilities** — what installed libraries already offer that we don't use: `<plugin-root>/scripts/lib-docs.mjs` (or the `code-ops-docs` MCP when `code-ops-suite` is installed) — reads the **installed** version, zero query egress (`§2`).
- **Prior art in provided materials** — pasted text, file paths, URLs the developer explicitly handed you (local inputs, not egress).
- **Adjacent products & trends (web — opt-in)** — *only if approved at Phase 0:* compose the `deep-research` skill (fan-out search → fetch → adversarial verify). **Each external request is a checkpoint (`§3`).** Record every request as you go: `node <plugin-root>/scripts/research-manifest.mjs record --tool <tool> --host <host> --url <url> --why "<reason>"`.
> **CHECKPOINT — surface the manifest** before leaving this phase (`§A`); confirm scope was honored and nothing left the machine unrecorded. If no web was used, state the run stayed fully local.

Lenses to mine (net-new, not parity-only): **latent-asset exploitation** · **workflow completion / new flow** · **automation & power-user** · **new surface or integration** · **category differentiation** · **trust/transparency/control as a feature** · **accessibility as reach** · **monetizable or platform direction**. Apply the honest-novelty lens (`§10`) throughout: tag what's genuinely new vs. trend-following.

## Phase 3 — Feasibility & disconfirmation  *(compose `research-verify`)*
Disconfirmation pass (`§A`) on **every** candidate before it earns an ID; drop what doesn't survive: **new here?** (cross-check Phase 1 — already shipped, or a near-duplicate?) · **feasible here?** (fits our stack and grain, or assumes infrastructure we lack? blast radius, migration cost) · **worth it?** (value × reach vs. effort, or a shiny trend with thin grounding?) · **egress/privacy-safe?** (an idea adding an outbound path or new data collection is flagged for a developer decision, never assumed acceptable). For each survivor, **compose `research-verify`** to adversarially confirm the external claims behind it and set the honest tier: a single weak secondary lead is `SPECULATIVE` (`§7`); ungrounded claims are `UNVERIFIED` and rank below anything `PROBABLE`/`CONFIRMED` (`§8`).

## Phase 4 — Register ideas  *(checkpoint)*
Write each survivor to `IDEAS_REGISTER.md` per the finding/idea schema (`§6`, stable `IDEA-NNN`, all fields, `Verified-at: <sha>`-stamped), the **disconfirmation** field including near-duplicates ruled out, the **smallest slice** the cheapest version that proves the idea. Rank by **value × reach ÷ effort**, weighted by tier and grounding (`§8`); tag quick wins vs. big bets; lead with a ranked top-N. Hand-off map (`§11`): actionable ideas → `code-ops-suite:feature-discovery` (spec into the backlog) or `code-ops-suite:feature-implementation` (build a well-scoped slice); a direction with real architectural trade-offs → `code-ops-suite:adr`.
> **CHECKPOINT.** Present the ranked register top-first; confirm which ideas are handed off, and to which skill. Surface the final egress manifest one last time.

## Deliverables
Dated discovery folder: `IDEAS_REGISTER.md`, `EGRESS_MANIFEST.md` if any web egress, `EXECUTIVE_SUMMARY.md` (top directions, single highest-value idea, decisions needed, the run's local-vs-web egress posture).

## Done when
Phase 0 direction + egress decisions confirmed; grounding established and every idea tested against it; **no un-opted-in or unrecorded egress** — every external request manifested and no web citation absent from the manifest, verified by `node <plugin-root>/scripts/research-manifest.mjs validate IDEAS_REGISTER.md` (`§A`); every idea disconfirmed (new here, feasible here, worth it), claim-checked via `research-verify`, cited and honestly tiered (`§7`), with a smallest slice and hand-off target (`§11`); register deduped, scored, ranked, each entry re-confirmed against the current tree and stamped `Verified-at: <sha>` (pre-filtered with `node <plugin-root>/scripts/revalidate-register.mjs IDEAS_REGISTER.md --root <repo>`, `§12`); both checkpoints done; no code changed; a final self-audit for cargo-cult filler and unverified capabilities. Present `EXECUTIVE_SUMMARY.md` first, highest-value idea at the top.
