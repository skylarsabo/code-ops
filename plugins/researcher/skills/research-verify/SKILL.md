---
description: "Use when a claim, recommendation, or draft research artifact needs adversarial fact-checking against sources and our code before anyone acts on it; produces a per-claim verdict report (SUPPORTED / PARTIAL / UNSUPPORTED) with tiered evidence. Review only — writes no code."
disable-model-invocation: true
---

# RESEARCH VERIFY — Prove-It-or-Don't Claim-Check

**Invoked as `/researcher:research-verify`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the research-integrity and egress model, operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** REVIEW · **Produces:** a verdict report — one verdict per claim, each tiered with its evidence — that **gates** the other researcher skills' output before hand-off.

Take a specific claim, recommendation, or a draft research artifact (a design brief, a `RESEARCH_FINDINGS.md` / `IDEAS_REGISTER.md` entry, or someone's "we should adopt X because Y") and try hard to **refute** it before anyone builds on it. This is the rigor "prove-it-or-don't" lens turned on research itself: a claim survives only if the evidence holds against *our* code and against primary sources, not against memory. Verification is read-only — every issue is handed off (`§11`), never fixed here.

## Phase 0 — Frame the claim(s) and the sources at hand  *(checkpoint)*
Restate each claim to verify as a single falsifiable sentence (split compound claims; "X is faster and safer" is two claims). For each, capture what's already asserted: its stated tier, its cited sources (code `file:line`, an installed-dependency doc, an external source), and what action it would unblock. Pin the commit SHA to verify against (`§12`). Inventory what evidence is already local versus what would need the web.

If the input is a draft artifact, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate <artifact>` now: any external claim without a manifest entry, or any cited web source missing from `EGRESS_MANIFEST.md`, is **undisclosed egress** — record it as a finding and treat the artifact as failing intake until resolved (`§A`).
> **CHECKPOINT:** present the claim list (one falsifiable sentence each), the source inventory, the SHA, and the result of the artifact validation. State plainly which claims you can verify **fully locally** and which would require **web egress** — and the exact hosts/why for each. **Confirm opt-in and scope for any network egress before Phase 2 touches it;** default to local-only if the developer doesn't approve. Proceed within the agreed scope.

## Phase 1 — Ground-check against our code
For every claim, ask the grounding question (`§A`): *does this actually hold for our code, given our constraints?* Read the relevant source, types, config, and tests; check version-control history for why the code is the way it is. Distinguish a claim that is true in general but **not for us** (different version, a wrapper we own, a guard already in place, a constraint that voids it) from one that holds here. A recommendation that is "already done" or "incompatible with our stack" fails this phase regardless of how well-sourced it is. Cite each check at `file:line` and tier it (`§7`). Mark anything with no codebase bearing `UNVERIFIED` rather than assuming.

## Phase 2 — Source-check  *(local-first; web only if approved at the Phase 0 checkpoint)*
Verify each remaining claim against its sources, not against recollection. For anything about a dependency's behavior or API, check the **installed** version via `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (or the `code-ops-docs` MCP) — the version we actually ship, not the latest blog post (`§2`, `§10`). Separate **primary** from **secondary** sources (the library's own installed docs/types, the spec, the code beat a tutorial or a forum answer) and **triangulate**: a claim earns CONFIRMED only against our code or a strong primary; PROBABLE needs ≥2 independent sources or one strong primary; a single weak/secondary lead is SPECULATIVE (`§7`). If a source-check needs the web, **compose the `deep-research` skill** for the fetch and record every request via `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record ...` (time · tool · host · url · why) before relying on it (`§A`). Flag stale, version-mismatched, circular (one source citing another), or unreachable sources.

## Phase 3 — Adversarial disconfirmation
Now actively try to break each surviving claim (`§A` disconfirmation): construct the counter-example, the edge/error case, the configuration where it fails, the benchmark that wasn't run. For "X is faster/safer/simpler," ask *measured or merely assumed?* — an unmeasured performance or security claim cannot exceed SPECULATIVE. Probe for the tempting-but-wrong: a plausible "fact" that no source actually supports, a number with no provenance, a capability asserted from memory. Check that the claim isn't already superseded. A claim that survives a genuine refutation attempt is far stronger than one merely restated.

## Phase 4 — Verdict per claim
Issue one verdict per claim, each with a tier (`§7`) and the evidence that decided it:
- **SUPPORTED** — holds for our code and against primary/triangulated sources; survived disconfirmation. Give the tier and the grounding (`file:line` / installed-doc / external+manifest entry).
- **PARTIAL** — true under conditions, or for the general case but not here, or supported only by weaker sources. State exactly the scope in which it holds and where it breaks.
- **UNSUPPORTED** — refuted, ungrounded, contradicted by our code, or asserted with no verifiable source (hallucinated). Give the disconfirming evidence; never present it as merely "unconfirmed" if it is actually contradicted.

For a draft artifact under review, also report the validation result, any **undisclosed egress** found in Phase 0, and which entries are clear to hand off versus which must be re-tiered or dropped (`OBSOLETE-AT <sha>`, `§12`). The verdict report is the **gate**: lead with the bottom line (clear / clear-with-changes / blocked), list UNSUPPORTED and undisclosed-egress items first, stamp each verdict `Verified-at: <sha>` (`§6`), and map every actionable issue to its hand-off target — corrections to the originating researcher skill (`research-spike` / `research-improve` / `research-ideate` / `library-eval`), code issues uncovered to `code-ops-suite:remediation` or `rigor:fix-verified`, and a measurement gap to `rigor:improve-measured` (`§11`). This skill proposes and gates; it never edits the artifact or the code.

## Done when
Every claim is restated as a falsifiable sentence, ground-checked against our code, source-checked against the installed version (not memory) with triangulation, and run through a real disconfirmation attempt; each carries a SUPPORTED / PARTIAL / UNSUPPORTED verdict with a tier and cited evidence; any draft artifact passed `research-manifest.mjs validate` and every external claim has both a citation and an `EGRESS_MANIFEST.md` entry (undisclosed egress flagged, `§A`); the egress checkpoint was honored before any network request; verdicts are stamped `Verified-at: <sha>`, the gate decision and hand-offs are explicit, and no code or source artifact was changed.
