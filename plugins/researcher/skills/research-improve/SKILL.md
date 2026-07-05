---
description: "Use when you want grounded, external-best-practice improvements proposed for our existing code (not a generic checklist); gathers library capabilities and known pitfalls, verifies each against our tree, and produces a tiered, cited findings register. Writes no code — proposes and hands off."
disable-model-invocation: true
---

# RESEARCH IMPROVE — Ground Our Code, Gather the Outside, Propose Verified Improvements

**Invoked as `/researcher:research-improve`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the research integrity & egress model, operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** DISCOVERY · **Produces:** `RESEARCH_FINDINGS.md` (`RSCH-NNN`, tiered + cited, each with a smallest slice and a hand-off target), `EGRESS_MANIFEST.md` if any web research was approved, `EXECUTIVE_SUMMARY.md`.

Take a slice of *our* code and ask the outside world how it is done well: the capabilities of the libraries we already depend on, established patterns, and the known pitfalls of our approach — then propose concrete improvements that demonstrably apply **here**. Local-first; web egress is opt-in and disclosed (`§A`). Every claim is cited and tiered (`§7`); a candidate that does not survive disconfirmation is dropped, not shipped. This skill **proposes and hands off** — it never edits source (`§A`, `§11`).

## Phase 0 — Scope, targets & egress permission  *(checkpoint)*
Pin the **target**: the modules, subsystem, or concern to improve (correctness, robustness, idiomatic use of a dependency, maintainability, a non-measured quality gap) and the **constraints** that bound any proposal — runtime/version floors, the stack, the suite's privacy/egress posture, appetite (quick wins vs. larger reworks). Inventory the **local sources** first: the codebase, version-control history (why the code is the way it is), the **installed** dependency docs via `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (`§2`), and anything the developer hands you (pasted text, file paths, URLs). Decide whether external/web research is even needed.
> **CHECKPOINT (egress gate — `§A`, `§3`):** present the target, constraints, and the local-vs-external plan. **Default to local-only.** If web research would add value, state *why*, *which hosts/queries*, and *what for*, and get **explicit opt-in** before any request leaves the machine. No network egress happens before this is granted. If declined, proceed local-only.

## Phase 1 — Ground (map the relevant code + constraints)
Build the local picture **before** reaching out, so every later candidate has somewhere to land. Map the target's structure, the seams where a change would apply, and the **current approach** (which library APIs we use and how, the idioms, the workarounds). Read git history for intent and prior attempts. Confirm exact installed dependency versions — improvements must fit the version we actually run, not the latest. Note the existing tests and what they pin, the blast radius of each seam, and the constraints that would veto a change. Record the commit SHA you are researching against (`§12`). Anything you cannot ground in our code stays `UNVERIFIED` (`§A`).

## Phase 2 — Gather (local-first; web only if opted in)
Collect external knowledge against the grounded picture, cheapest-and-most-local first.
- **Installed-dependency capabilities (default, zero query egress):** use `lib-docs.mjs` (or `code-ops-docs` `get-docs` when `code-ops-suite` is installed) to learn what our deps *already* offer that we hand-roll or misuse — the primary source is the library's own installed docs/types (`§2`, `§7`).
- **Patterns & pitfalls in the wild:** established patterns for this concern, and the documented failure modes of our current approach.
- **Opt-in web (only if granted in Phase 0):** compose the `deep-research` skill (fan-out search → fetch → adversarial verify) for best-practice sources, changelogs, and issue threads. **Record every external request** with `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record ...` (time · tool · host · url · why) **as it happens** (`§A`, `§12`). Triangulate — prefer a primary source over a secondary, two independent secondaries beat one (`§7`). Redact any secret/PII to `<REDACTED:reason>` (`§4`). Surface the running manifest at the next checkpoint.

## Phase 3 — Verify & disconfirm each candidate  *(checkpoint)*
Run every improvement candidate through the disconfirmation pass (`§A`, `§10`) — assertion is not evidence:
- **Does it apply *here*?** Map it to a real seam (`file:line`) under our constraints and installed versions, or drop it as generic.
- **Already done?** Re-check the current tree — much "best practice" is already in place; cite the line that satisfies it instead of proposing it.
- **Compatible?** Not vetoed by our stack, version floors, or the privacy/egress posture (a proposal that adds a new outbound path is itself an egress concern — flag it, never assume it).
- **Worth it?** Concrete value vs. effort and blast radius; a measured-perf claim is out of scope here — hand that to `rigor:improve-measured` rather than asserting a speedup.
Adversarially gate the survivors with the `research-verify` skill: tier each (CONFIRMED / PROBABLE / SPECULATIVE — when unsure, the lower tier), and ensure no external claim lacks a manifest entry. Re-confirm each survivor still holds against the current SHA (`§12`).
> **CHECKPOINT:** present the surviving candidates with their tiers and the manifest of anything that egressed; the developer confirms which graduate to the register. Drop the rest with a one-line reason.

## Phase 4 — Register findings (`§6` schema, tiered, cited, hand-off)
Write each survivor to `RESEARCH_FINDINGS.md` as an `RSCH-NNN` entry per the finding schema (`§6`): **ID · Title · Lens · Tier · Claim · Sources** (code `file:line` | installed-doc | external+manifest entry) **· Verified-at (sha) · Grounding** (how it applies to our code) **· Disconfirmation** (what you ruled out) **· Value/Impact · Smallest slice · Recommendation · Hands-off-to · Effort · Risks**. Assign the track (`§6`: NOW-SAFE / NEEDS-REVIEW / NEEDS-DESIGN). Rank by value × reach ÷ effort, weighted by tier and grounding strength (`§8`); SPECULATIVE ranks below any PROBABLE/CONFIRMED item. Each entry names a concrete hand-off target (`§11`) — improvements → `code-ops-suite:remediation` or `rigor:fix-verified`; broad behavior-preserving measured wins → `rigor:improve-measured`; an architectural rework → `NEEDS-DESIGN` for an `adr`. A finding is done when its implementer can act without re-researching (`§11`). The researcher never makes the change itself.

## Validate & publish
Before publishing, re-validate the register against the current tree with `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs RESEARCH_FINDINGS.md --root .` (triage FRESH / MOVED / DRIFTED / GONE / AMBIGUOUS / NO-REF; re-tier or mark `OBSOLETE-AT <sha>` anything stale — `§12`). Then run `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate RESEARCH_FINDINGS.md` — it **fails closed** if any external claim cites a source absent from `EGRESS_MANIFEST.md` (`§A`). Both must pass before the artifact is presented. Write deliverables to a dated folder under the repo's docs location (`§12`). `EXECUTIVE_SUMMARY.md` leads with the top-ranked improvement.

## Done when
The target and constraints are scoped and the egress gate was honored (local-only unless explicitly opted in); the relevant code is mapped and every claim is grounded in our tree at a recorded SHA; external knowledge was gathered local-first and any web egress was recorded in `EGRESS_MANIFEST.md` as it happened; every candidate survived disconfirmation, is tiered and cited (`§7`), maps to a real seam, and carries a smallest slice plus a concrete hand-off (`§11`); the register is deduped, ranked (`§8`), stamped `Verified-at: <sha>`, and passes both `revalidate-register.mjs` and `research-manifest.mjs validate`; no code was changed; a final self-audit removed generic filler and unverified capabilities. Present `EXECUTIVE_SUMMARY.md` first, highest-value grounded improvement at the top, then the register path.
