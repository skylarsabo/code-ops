---
description: "Use when a task, feature, or plan needs a code-grounded design brief before anyone builds it. Writes no code."
disable-model-invocation: true
---

# RESEARCH SPIKE — Code-Grounded Design Brief for a Task or Plan

**Invoked as `/researcher:research-spike`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — the research-integrity & egress model (`§A`), protocol, rails, schemas, tiers, and lenses, referenced by section.
**Mode:** DISCOVERY · **Produces:** a cited **design brief** (per `§13`) with a recommendation, the smallest valuable slice, trade-offs, and open questions, plus `EGRESS_MANIFEST.md`.

Research the credible approaches and prior art for a task/feature/plan, ground them in *our* code and constraints, verify the load-bearing claims, and write a brief a senior engineer can implement without re-researching. Local sources first; web egress is opt-in at a checkpoint (`§A`). **Proposes and hands off — never edits source (`§11`).**

## Phase 0 — Scope the question & set direction  *(checkpoint)*
Restate the problem in one sentence; read what the developer handed you (task/plan, pasted text, file paths, URLs). Identify the **decision** the brief must enable, the constraints that bound it (stack, performance budgets, the suite's privacy/egress posture), and the candidate directions. Draft success criteria and a disconfirmation list — what would make a tempting option wrong here.
> **CHECKPOINT:** present the restated question, success criteria, constraints, and directions. **Confirm whether web egress is permitted for this run** — and if so, the scope and which hosts (`§3`). Default is local-only. Proceed within the agreed scope.

## Phase 1 — Ground in our code  *(local, no egress)*
Judge options against reality, not a generic template: detect the stack; map the modules, data, and integration points the change would touch; check VCS history for why the code is the way it is and prior attempts. Find latent capabilities (services/libraries/data an option could lean on) and hard edges (contracts, invariants, blast radius). Each grounding observation cites `file:line` and is tiered (`§7`, `§10` grounding lens).

## Phase 2 — Gather options & prior art  *(local first; web only if approved)*
Enumerate the credible approaches — including **build it ourselves** and **use a capability we already have** — and how each is solved in the wild (`§10` prior-art lens).
- **Local first:** installed-dependency capabilities/APIs via `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (or the `code-ops-docs` `get-docs` MCP when `code-ops-suite` is installed) — the *installed* version, no query egress (`§2`). Triangulate against the library's own types and our usage.
- **Web (only if approved in Phase 0):** compose the `deep-research` skill (fan-out search → fetch → adversarial verify). **Record every external request** before it leaves the machine via `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record --tool <tool> --host <host> --url <url> --why <reason>` so `EGRESS_MANIFEST.md` stays complete (`§A`). Never silently egress; a lead needing a host outside the approved scope → pause and ask (`§3`).

Capture each option per the finding/idea schema (`§6`): claim, sources, grounding, value, smallest slice, effort, risks. Disconfirm as you go — already done here, incompatible with our constraints, superseded, or assumed rather than measured? Drop what doesn't survive (`§A`).

## Phase 3 — Verify the load-bearing claims & disconfirm
Identify the claims the recommendation rests on (the "if this is wrong, the brief is wrong" facts). Compose **research-verify** to adversarially check each against its sources *and* our code, tier the verdict (`§7`), and flag anything unsupported or contradicted. Triangulate primary over secondary (installed docs/types, the spec, our code beat a blog post; two independent secondaries beat one). Re-run disconfirmation against the front-runner: what would make this the wrong call for us? Re-tier or drop what no longer holds; stamp survivors `Verified-at: <sha>` (`§12`).

## Phase 4 — Synthesize the brief & recommend  *(checkpoint)*
Write the brief per `§13`: lead with a ≤1-paragraph summary (the recommendation + why); then the options with honest trade-offs scored by value × reach ÷ effort weighted by tier and grounding (`§8`); the grounded fit (which modules/contracts each touches); the **smallest valuable slice** that proves the approach; the risks (including any effect on the egress/privacy posture); and the open questions. A Mermaid diagram where it clarifies. Every sentence cited and tiered (`§7`); nothing cites a web source absent from the manifest.
> **CHECKPOINT:** before publishing, validate with `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate <brief>` (fail-closed: an un-manifested external citation blocks publication, `§A`) and pre-filter any carried register with `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>` (`§12`). Present the recommendation and the surfaced `EGRESS_MANIFEST.md` for sign-off.

## Hand-off
The brief is the terminal output, not a diff (`§11`). Map it: the build → `code-ops-suite:feature-implementation` or `code-ops-suite:ship`; a writing-plans step when a step-by-step plan is needed first; an architectural decision worth recording → `code-ops-suite:adr`. Done only when that implementer can act without re-researching (`§11`).

## Done when
The question is restated with confirmed success criteria; both checkpoints done and the egress decision explicit and honored; every option grounded in our code and disconfirmed, the load-bearing claims verified via research-verify and stamped `Verified-at: <sha>`; the brief meets `§13` (summary-first, trade-offs, grounded fit, smallest slice, open questions), cites and tiers every claim (`§7`), and is freshness-stamped with the commit SHA; `EGRESS_MANIFEST.md` complete and the brief passes `research-manifest.mjs validate`; the hand-off target named (`§11`); no source changed; a final self-audit cleared generic filler and unverified capabilities. Present the recommendation and the brief path first, the manifest beside it.
