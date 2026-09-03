---
description: "Use when a task, feature, or plan needs a code-grounded design brief before anyone builds it. Writes no code."
---

# Research spike: a code-grounded design brief

**Invoked as `/researcher:research-spike`.** First read the bundled
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. It carries the research-integrity and egress model
(`§A`), the protocol, the rails, the schemas, the tiers, and the lenses, referenced by
section.

- **Mode:** DISCOVERY.
- **Produces:** a cited design brief on the `§13` standard, with a recommendation, the
  smallest valuable slice, the trade-offs, and the open questions, plus `EGRESS_MANIFEST.md`.

Research the credible approaches and the prior art for a task, feature, or plan. Ground them
in our code and our constraints, verify the load-bearing claims, and write a brief a senior
engineer can implement without re-researching. Local sources come first, and web egress is
opt-in at a checkpoint (`§A`). The skill proposes and hands off. It never edits source
(`§11`).

## Phase 0. Scope the question and set direction  *(checkpoint)*

Restate the problem in one sentence. Read what the developer handed you, meaning the task or
plan, the pasted text, the file paths, and the URLs. Identify the decision the brief must
enable, the constraints that bound it, meaning the stack, the performance budgets, and the
suite's privacy and egress posture, and the candidate directions. Draft the success criteria
and a disconfirmation list of what would make a tempting option wrong here.

> **CHECKPOINT:** present the restated question, the success criteria, the constraints, and
> the directions. Confirm whether web egress is permitted for this run, and if so, its scope
> and which hosts (`§3`). The default is local-only. Proceed within the agreed scope.

## Phase 1. Ground in our code  *(local, no egress)*

Dispatch gatherers, in parallel over disjoint sub-questions, to judge the options against
reality rather than a generic template. Detect the stack. Map the modules, data, and
integration points the change would touch. Check version-control history for why the code is
the way it is, and for prior attempts. Find the latent capabilities an option could lean on,
meaning services, libraries, and data, and find the hard edges, meaning contracts,
invariants, and blast radius. Each grounding observation cites `file:line` and is tiered
(`§7`, and the `§10` grounding lens).

## Phase 2. Gather the options and the prior art  *(local first, web only if approved)*

Enumerate the credible approaches, including building it ourselves and using a capability we
already have, and how each one is solved in the wild (the `§10` prior-art lens).

- **Local first.** Dispatch gatherers, in parallel over the candidate approaches, over the
  installed-dependency capabilities and APIs through
  `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs`, or through the `code-ops-docs` MCP server's
  `get-docs` tool when `code-ops-suite` is installed. Read the installed version, with no
  query egress (`§2`). Triangulate against the library's own types and against our usage.
- **Web, only if approved in Phase 0.** Compose the `deep-research` skill, which fans out to
  search, fetches, and verifies adversarially. Record every external request before it
  leaves the machine with
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record --tool <tool> --host <host> --url <url> --why <reason>`,
  so `EGRESS_MANIFEST.md` stays complete (`§A`). Never egress silently. If a lead needs a
  host outside the approved scope, pause and ask (`§3`).

Capture each option on the finding and idea schema (`§6`): the claim, the sources, the
grounding, the value, the smallest slice, the effort, and the risks. Disconfirm as you go.
Is it already done here? Is it incompatible with our constraints? Is it superseded? Is it
assumed rather than measured? Drop what does not survive (`§A`).

## Phase 3. Verify the load-bearing claims and disconfirm

Identify the claims the recommendation rests on, meaning the facts that would make the brief
wrong if they were wrong. Dispatch a claim-checker per load-bearing claim, in parallel, to
check each one adversarially against its sources and against our code, to tier the verdict
(`§7`), and to flag anything unsupported or contradicted. Triangulate primary over
secondary: the installed documentation and types, the specification, and our code all beat a
blog post, and two independent secondary sources beat one. Re-run the disconfirmation
against the front-runner, asking what would make this the wrong call for us. Re-tier or drop
what no longer holds, and stamp each survivor `Verified-at: <sha>` (`§12`).

## Phase 4. Synthesize the brief and recommend  *(checkpoint)*

Write the brief on the `§13` standard. Lead with a summary of at most one paragraph, giving
the recommendation and the reason. Then give the options with honest trade-offs, scored by
value multiplied by reach, divided by effort, and weighted by tier and grounding (`§8`).
Then give the grounded fit, naming which modules and contracts each option touches, the
smallest valuable slice that proves the approach, the risks including any effect on the
egress and privacy posture, and the open questions. Add a Mermaid diagram where it clarifies.
Every sentence is cited and tiered (`§7`), and nothing cites a web source absent from the
manifest.

> **CHECKPOINT:** before publishing, validate with
> `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate <brief>`, which fails
> closed, so an un-manifested external citation blocks publication (`§A`). Pre-filter any
> carried register with
> `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>`
> (`§12`). Present the recommendation and the surfaced `EGRESS_MANIFEST.md` for sign-off.

## Hand-off

The brief is the terminal output, not a diff (`§11`). Map it to an implementer. The build
goes to `code-ops-suite:feature-implementation` or `code-ops-suite:ship`. A step-by-step
plan, when one is needed first, goes to a writing-plans step. An architectural decision worth
recording goes to `code-ops-suite:adr`. The skill is done only when that implementer can act
without re-researching (`§11`).

## Done when

The question is restated with confirmed success criteria. Both checkpoints are done, and the
egress decision is explicit and honored. Every option is grounded in our code and
disconfirmed, and the load-bearing claims are verified through research-verify and stamped
`Verified-at: <sha>`. The brief meets `§13`, meaning summary first, trade-offs, grounded fit,
smallest slice, and open questions. It cites and tiers every claim (`§7`) and is
freshness-stamped with the commit SHA. `EGRESS_MANIFEST.md` is complete and the brief passes
`research-manifest.mjs validate`. The hand-off target is named (`§11`), no source changed,
and a final self-audit cleared the generic filler and the unverified capabilities. Present
the recommendation and the brief path first, with the manifest beside them.
