---
description: "Use when a task, feature, or plan needs a code-grounded design brief before anyone builds it; researches prior art and approach options, then produces a cited brief with a recommendation. Writes no code."
disable-model-invocation: true
---

# RESEARCH SPIKE — Code-Grounded Design Brief for a Task or Plan

**Invoked as `/researcher:research-spike`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the research-integrity & egress model, operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** DISCOVERY · **Produces:** a cited **design brief** (per `§13`) with a recommendation, the smallest valuable slice, trade-offs, and open questions, plus `EGRESS_MANIFEST.md`.

Given a task, feature, or plan, research the credible approaches and prior art, ground them in *our* code and constraints, verify the load-bearing claims, and write a brief a senior engineer can implement without re-researching. Local sources first; web egress is opt-in and confirmed at a checkpoint (`§A`). This skill **proposes and hands off** — it never edits source (`§11`).

## Phase 0 — Scope the question & set direction  *(checkpoint)*
Restate the problem in one sentence and pin down what a good answer looks like *before* gathering anything. Read what the developer handed you (the task/plan, pasted text, file paths, URLs). Identify the **decision** the brief must enable (build it this way vs. that way; adopt vs. defer), the constraints that already bound the choice (stack, performance budgets, the suite's privacy/egress posture), and the candidate directions worth investigating. Draft success criteria and a disconfirmation list — what would make a tempting option wrong here.
> **CHECKPOINT:** present the restated question, the success criteria (what the brief must answer to be actionable), the constraints, and the directions you'll explore. **Confirm whether web egress is permitted for this run** — and if so, the scope and which hosts (`§3`). Default is local-only. Proceed within the agreed scope.

## Phase 1 — Ground in our code  *(local, no egress)*
Establish what *our* code already constrains and what it already does, so options are judged against reality, not a generic template. Detect the stack; map the modules, data, and integration points the change would touch; check version-control history for why the relevant code is the way it is and whether a prior attempt exists. Find the latent capabilities (services/libraries/data already present that an option could lean on) and the hard edges (contracts, invariants, blast radius). Each grounding observation cites code `file:line` and is tiered (`§7`); this is the bar every later option is measured against (`§10` grounding lens).

## Phase 2 — Gather options & prior art  *(local first; web only if approved)*
Enumerate the credible approaches — including **build it ourselves** and **use a capability we already have** — and how each is solved in the wild (`§10` prior-art lens).
- **Local first:** read installed-dependency capabilities and APIs with `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (the `code-ops-docs` `get-docs` MCP when `code-ops-suite` is installed) — this reads the *installed* version with no query egress (`§2`). Triangulate against the library's own types and our usage of it.
- **Web (only if approved in Phase 0):** compose the `deep-research` skill for fan-out search → fetch → adversarial verification. **Record every external request** before it leaves the machine via `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record --tool <tool> --host <host> --url <url> --why <reason>` so `EGRESS_MANIFEST.md` stays complete (`§A`). Never silently egress; if a promising lead needs a host outside the approved scope, pause and ask (`§3`).

Each option is captured with the finding/idea schema (`§6`): claim, sources, grounding to our code, value, smallest slice, effort, risks. Run the disconfirmation pass as you go — already done here, incompatible with our constraints, superseded, or merely assumed rather than measured? Drop what doesn't survive (`§A`).

## Phase 3 — Verify the load-bearing claims & disconfirm
Identify the few claims the recommendation actually rests on (the "if this is wrong, the brief is wrong" facts) and harden them. Compose **research-verify** to adversarially check each against its sources *and* our code, tier the verdict (`§7`), and flag anything unsupported or contradicted. Triangulate primary over secondary (the installed docs/types, the spec, our code beat a blog post; two independent secondaries beat one). Re-run disconfirmation specifically against the front-runner: what would make this the wrong call for us? Re-tier or drop anything that no longer holds, and stamp survivors `Verified-at: <sha>` (`§12`).

## Phase 4 — Synthesize the brief & recommend  *(checkpoint)*
Write the design brief to the suite's documentation standard (`§13`): lead with a ≤1-paragraph summary stating the recommendation and why; then the options with honest trade-offs scored by value × reach ÷ effort weighted by tier and grounding (`§8`); the grounded fit to our code (which modules/contracts each touches); the **smallest valuable slice** that proves the approach; the risks (including any effect on the egress/privacy posture); and the open questions a decision still needs. Use a Mermaid diagram where it clarifies the chosen design. Every sentence is cited and tiered (`§7`); nothing cites a web source absent from the manifest.
> **CHECKPOINT:** before publishing, validate the artifact with `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate <brief>` (fail-closed: an un-manifested external citation blocks publication, `§A`) and pre-filter any carried register with `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>` (`§12`). Present the recommendation and the surfaced `EGRESS_MANIFEST.md` for sign-off.

## Hand-off
The brief is the terminal output, not a diff (`§11`). Map it to its implementer: the build → `code-ops-suite:feature-implementation` or `code-ops-suite:ship`; a writing-plans step when the work needs a step-by-step plan first; an architectural decision worth recording → `code-ops-suite:adr`. The brief is "done" only when that implementer can act on it without re-researching (`§11`).

## Done when
The question is restated with confirmed success criteria; both checkpoints are done and the egress decision is explicit and honored; every option is grounded in our code, disconfirmed, and the load-bearing claims are verified via research-verify and stamped `Verified-at: <sha>`; the brief meets `§13` (summary-first, trade-offs, grounded fit, smallest slice, open questions), cites and tiers every claim (`§7`), and is freshness-stamped with the commit SHA; `EGRESS_MANIFEST.md` is complete and the brief passes `research-manifest.mjs validate`; the hand-off target is named (`§11`); no source was changed; and a final self-audit clears generic filler and unverified capabilities. Present the recommendation and the brief path first, the manifest beside it.
