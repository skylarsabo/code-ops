---
name: research-improve
description: "Use when you want grounded, external-best-practice improvements proposed for our existing code (not a generic checklist). Writes no code — proposes and hands off."
---

# RESEARCH IMPROVE — Ground Our Code, Gather the Outside, Propose Verified Improvements

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `researcher:research-improve`.** First read the bundled `<plugin-root>/CONVENTIONS.md` — the research-integrity & egress model (`§A`), protocol, rails, schemas, tiers, and lenses, referenced by section.
**Mode:** DISCOVERY · **Produces:** `RESEARCH_FINDINGS.md` (`RSCH-NNN`), `EGRESS_MANIFEST.md` if any web research was approved, `EXECUTIVE_SUMMARY.md`.

Ask the outside world how a slice of *our* code is done well — capabilities of libraries we already depend on, established patterns, known pitfalls — and propose improvements that demonstrably apply **here**. Local-first; web egress opt-in and disclosed (`§A`). Every claim cited and tiered (`§7`); a candidate that fails disconfirmation is dropped. **Proposes and hands off — never edits source (`§A`, `§11`).**

## Phase 0 — Scope, targets & egress permission  *(checkpoint)*
Pin the **target** (modules, subsystem, or concern — correctness, robustness, idiomatic dependency use, maintainability, a non-measured quality gap) and the **constraints** (runtime/version floors, stack, privacy/egress posture, appetite). Inventory local sources first: the codebase, VCS history, **installed** dependency docs via `<plugin-root>/scripts/lib-docs.mjs` (`§2`), and anything the developer hands you. Decide whether web research is even needed.
> **CHECKPOINT (egress gate — `§A`, `§3`):** present target, constraints, and the local-vs-external plan. **Default to local-only.** If web research would add value, state *why*, *which hosts/queries*, *what for*, and get **explicit opt-in** before any request leaves the machine. If declined, proceed local-only.

## Phase 1 — Ground (map the relevant code + constraints)
Build the local picture **before** reaching out: the target's structure; the seams where a change would apply; the **current approach** (library APIs used and how, idioms, workarounds); git history for intent and prior attempts; exact installed dependency versions (improvements must fit the version we run, not the latest); existing tests and what they pin; blast radius per seam; the constraints that would veto a change. Record the commit SHA researched against (`§12`). Anything not grounded in our code stays `UNVERIFIED` (`§A`).

## Phase 2 — Gather  *(local-first; web only if opted in)*
Cheapest-and-most-local first:
- **Installed-dependency capabilities (default, zero query egress):** `lib-docs.mjs` (or `code-ops-docs` `get-docs` when `code-ops-suite` is installed) — what our deps *already* offer that we hand-roll or misuse; the primary source is the library's own installed docs/types (`§2`, `§7`).
- **Patterns & pitfalls in the wild:** established patterns for this concern; documented failure modes of our approach.
- **Opt-in web (only if granted in Phase 0):** compose the `deep-research` skill (fan-out search → fetch → adversarial verify). **Record every external request** with `node <plugin-root>/scripts/research-manifest.mjs record ...` (time · tool · host · url · why) **as it happens** (`§A`, `§12`). Triangulate — primary over secondary; two independent secondaries beat one (`§7`). Redact secrets/PII to `<REDACTED:reason>` (`§4`). Surface the running manifest at the next checkpoint.

## Phase 3 — Verify & disconfirm each candidate  *(checkpoint)*
Disconfirmation pass on every candidate (`§A`, `§10`) — assertion is not evidence: **applies here?** (map to a real seam `file:line` under our constraints and installed versions, or drop as generic) · **already done?** (re-check the tree; cite the satisfying line instead of proposing it) · **compatible?** (not vetoed by stack, version floors, or the privacy/egress posture — a proposal adding a new outbound path is itself an egress concern: flag it, never assume it) · **worth it?** (concrete value vs. effort and blast radius; a measured-perf claim is out of scope — hand it to `rigor:improve-measured`, never assert a speedup). Adversarially gate survivors with the `research-verify` skill: tier each (CONFIRMED / PROBABLE / SPECULATIVE — when unsure, the lower tier); no external claim without a manifest entry. Re-confirm survivors against the current SHA (`§12`).
> **CHECKPOINT:** present surviving candidates with tiers and the manifest of anything that egressed; the developer confirms which graduate to the register. Drop the rest with a one-line reason.

## Phase 4 — Register findings (`§6` schema, tiered, cited, hand-off)
Write each survivor to `RESEARCH_FINDINGS.md` as an `RSCH-NNN` entry per the finding schema (`§6`, all fields, `Verified-at: <sha>`-stamped). Assign the track (`§6`: NOW-SAFE / NEEDS-REVIEW / NEEDS-DESIGN). Rank by value × reach ÷ effort, weighted by tier and grounding (`§8`); SPECULATIVE ranks below any PROBABLE/CONFIRMED item. Hand-offs (`§11`): improvements → `code-ops-suite:remediation` or `rigor:fix-verified`; broad behavior-preserving measured wins → `rigor:improve-measured`; an architectural rework → NEEDS-DESIGN for an `adr`. A finding is done when its implementer can act without re-researching (`§11`); the researcher never makes the change itself.

## Validate & publish
Re-validate the register against the current tree: `node <plugin-root>/scripts/revalidate-register.mjs RESEARCH_FINDINGS.md --root .` (triage FRESH / MOVED / DRIFTED / GONE / AMBIGUOUS / NO-REF; re-tier or mark `OBSOLETE-AT <sha>` anything stale — `§12`). Then `node <plugin-root>/scripts/research-manifest.mjs validate RESEARCH_FINDINGS.md` — **fails closed** if any external claim cites a source absent from `EGRESS_MANIFEST.md` (`§A`). Both must pass before presenting. Write deliverables to a dated folder under the repo's docs location (`§12`); `EXECUTIVE_SUMMARY.md` leads with the top-ranked improvement.

## Done when
Target and constraints scoped and the egress gate honored (local-only unless explicitly opted in); the relevant code mapped, every claim grounded at a recorded SHA; external knowledge gathered local-first, any web egress recorded in `EGRESS_MANIFEST.md` as it happened; every candidate survived disconfirmation, is tiered and cited (`§7`), maps to a real seam, and carries a smallest slice plus a concrete hand-off (`§11`); the register deduped, ranked (`§8`), stamped `Verified-at: <sha>`, and passing both `revalidate-register.mjs` and `research-manifest.mjs validate`; no code changed; a final self-audit removed generic filler and unverified capabilities. Present `EXECUTIVE_SUMMARY.md` first, highest-value grounded improvement at the top, then the register path.
