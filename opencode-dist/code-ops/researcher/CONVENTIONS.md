# Researcher suite: shared conventions

A toolkit of operational workflows runs **code-grounded research**: investigate, gather external knowledge, and propose improvements, designs, and new ideas with the discipline the rest of the suite applies to code. It ships with the **researcher** plugin. Each skill is a namespaced slash command, for example `/researcher-research-spike`, and reads this file first, referencing it by section instead of repeating it. Read-once: if this file is already live in the current context (not evicted or compacted away), do not re-read it. A skill invoked by an orchestrator that already loaded it inherits the in-context copy. After eviction, re-read as usual.

The researcher **proposes and does not mutate.** It hands implementation to `code-ops-suite` or `rigor`, and the implementation map is `§11`. It is honest about what leaves the machine (`§A`).

## A · Research integrity and egress model (central, non-negotiable)
Every skill operates inside this envelope. When in doubt, the most local, most cited, most disconfirmed option wins.
- **Cited and tiered, always.** Every claim names a source: code `file:line`, an installed-dependency doc (through `lib-docs`, `§2`), or an external source with a retrieval record. Tier each one. **CONFIRMED** means verified against our code or a primary source. **PROBABLE** means two or more independent sources, or one strong primary. **SPECULATIVE** means a single weak or secondary lead. Never present SPECULATIVE as fact, and when unsure, pick the lower tier.
- **Grounding rule.** Where a codebase is present, ground every claim and proposal in it, asking whether it holds for *our* code given our constraints. Where only materials are given, ground in those. Mark anything not grounded `UNVERIFIED`.
- **Disconfirmation pass** on every proposal before reporting it. Is it already done here? Is it incompatible with our stack or constraints? Is it superseded? Is it measured, or merely assumed? **Intent annotation:** before reporting, read the cited line's immediate neighbors and any referenced ticket/finding id for an explicit by-design / accepted-deferred / KNOWN annotation, or a docstring/comment that matches the observed behavior. If the intent is documented at the line, it is not a defect, so downgrade it to informational. **Locate-the-handler:** a finding whose severity rests on "nothing else handles, guards, or catches this" must actively LOCATE the would-be handler (the caller, wrapper, middleware, second gate, sole-caller invariant, or a separate CI/test enforcement), and report that search. Never assert the absence of a handler without looking for it. Drop what does not survive.
- **Local-first, disclosed egress.** Default sources are local: the codebase, version-control history, installed-dependency docs, and materials the developer hands you (pasted text, file paths, URLs explicitly provided). **Web and external retrieval is explicit opt-in per run.** Every external request is appended to `EGRESS_MANIFEST.md` through `<plugin-root>/scripts/research-manifest.mjs`, recording time, tool, host, url, and why, and it is surfaced at the checkpoint. **Never silently egress.** A published artifact must not cite a web source that is not in the manifest, and the script enforces that fail-closed. Honor the privacy-opsec model: no new egress path without scrutiny.
- **Propose, do not mutate.** Output is registers and briefs with citations and concrete, trade-off-aware recommendations. Novelty is labeled and feasibility-checked. Code changes are handed off (`§11`).

## 1 · Operating model: dynamic orchestration
The adaptive loop runs: assess, plan units, fan out parallel sub-agents, collect structured results, deepen or broaden or converge, then repeat until the "Done when" criteria are met. Read-only gathering parallelizes freely, but **self-throttle the fan-out into bounded waves** (a handful of agents at a time). A broad whole-repo sweep that launches its entire fan-out at once will trip platform rate-limits and can lose the whole run. Do not rely on the platform's concurrency cap as the limiter. Use a **stronger model** for synthesis, verification, and every judgment-bearing dispatch. Use a **faster model** only for mechanical breadth gathering, because a shallow or failed report costs a redispatch plus the orchestrator's attention, which outweighs the stronger model's premium. Verify all output regardless of which model produced it. Keep a live task list. Use bundled or reusable subagents.
- **Inline the grounding baseline.** When you fan out gatherers, claim-checkers, or sub-agents, inject the ground-truth grounding baseline into each prompt: the exact tier definitions, grounding rule, and egress constraints in force (`§A` and `§10`), and which checks are blocking rather than informational. Do not hand over a pointer to the baseline instead. The inlined facts are what stop a claim-checker re-flagging something the grounding rule already settles.
- **Skim huge files, then deepen.** For a very large file, skim first (structure, exports/signatures, the risky regions) and deepen on what matters, rather than reading it end-to-end. `<plugin-root>/scripts/skim.mjs <file>` prints the outline with line ranges, so read a range rather than the file.
- **Audit the skipped-set at synthesis.** When you aggregate slices, take the union of every slice's skipped/traced note. A high-risk area that no slice covered is itself a finding (a coverage gap), not silence.
- **Tier floors travel with the run.** Phase 0's preflight (`<plugin-root>/scripts/preflight.mjs`) prints the bundled agents' declared tier floors, because agent `model:` frontmatter is a mechanical carrier only where the host parses it. On a host that ignores agent `model:` frontmatter the lead acknowledges that printed floor table and routes every dispatch at or above its floor by hand. A below-floor dispatch is a doctrine violation that `run-cost-audit` records as a `tier-routing` FAIL.
- **Persist reports as they land.** Every operative report is written to the run's artifact folder in the turn it arrives, before any other work. A report that exists only in the conversation is one blocked turn away from being lost.
- **Operative-failure handling.** A sub-agent that errors, hangs past its wave, or returns a null, empty, or structurally malformed report is a **failed dispatch, not a weak signal. Never synthesize around a missing report or fill its gap from the orchestrator's own assumptions**. Handle it up a fixed ladder: **redispatch once with a tightened, smaller brief. Then escalate at the next checkpoint** (in a headless run, defer that unit and report it, §3). The orchestrator takes the piece over itself only as last resort. An operative's own "done" claim is never acceptance, so the orchestrator verifies the artifact itself (register entry, brief shape) before counting the unit complete. A brief that never reached its operative is indistinguishable in the dispatch record from a completed dispatch until the report is read. Gate every report on shape (expected sections present, non-empty, evidence attached) before its unit counts as covered.
- **Finish the turn's work.** Before ending a turn, read the last paragraph: if it is a plan, an unasked question, or a promise of work not yet done, do that work now.

Where `code-ops-suite` is installed beside this plugin, its session mechanisms run under the same session: the Bash output digest, the symbol-index refresh, the operative ladder card, and the session receipt. Each is on by default and takes `off`, `0`, or `false` in the `env` block of a `.claude/settings.json`. None of them reaches a network, which keeps them inside the egress model above. The switch names and defaults live in `code-ops-docs/50 Platform/INFRASTRUCTURE.md`.

## 2 · Tools (optional, by capability)
Use these if connected, and proceed without them otherwise. The **documentation lookup** default is `<plugin-root>/scripts/lib-docs.mjs`, or the `code-ops-docs` MCP `get-docs` when `code-ops-suite` is installed. It is local-first, reads the **installed** version, and makes no query egress. For **opt-in web** research, compose the `deep-research` skill, which fans out search, then fetch, then adversarial verification, and record every request in the egress manifest (`§A`). Version-control history explains why the code is the way it is, and a browser or UI tool covers UI products. Use both if available.

## 3 · Interaction protocol: the developer is available
Default: **when unsure, ask rather than guess.**
**ASK when:** the research direction or success criteria are ambiguous, **anything would cause network egress** (confirm opt-in and scope, because it is high-stakes), a recommendation has real trade-offs, or a finding is high-impact. Pause at phase-boundary checkpoints, and always surface the egress manifest at them.
**PROCEED when:** the work is local, in agreed scope, or following an approved plan.
**HOW:** batch questions. Give numbered options plus a recommendation plus a default. Keep momentum on independent local gathering while a decision is pending.
**HEADLESS AND NON-INTERACTIVE RUNS:** when no operator is present to answer a checkpoint (an autonomous or scheduled run), do not block: auto-scope from the repo, proceed on the safe default. Read-only and assess work continues. Egress and the always-gated categories are deferred and reported, never silently applied. Surface every decision and critical finding in the final report instead of pausing.

## 4 · Safety rails
- **No source edits.** The researcher documents and proposes, and it never changes code (`§11`). Any code issue it finds is handed off as a finding or idea.
- **Never silently egress** (`§A`). Confirm opt-in, record every request, and surface the manifest.
- **Secrets and PII are radioactive.** Redact them to `<REDACTED:reason>` everywhere, including evidence. A discovered live secret is a critical hand-off finding, reported by location and rotation steps, never by value.
- **Never fabricate** a source, capability, or quote. Mark anything unconfirmed `UNVERIFIED`. Detect the shell and OS, and stay in-repo for local work.

## 5 · Modes
Each skill declares one mode: **DISCOVERY** gathers and proposes, producing a backlog or specs. **REVIEW** verifies or evaluates, producing a verdict or recommendation. **DOCUMENT** produces a brief and no code. None of them edits source.

## 6 · Tracks and schemas
Tracks for proposals handed off are **NOW-SAFE** (local, low-risk, well-grounded), **NEEDS-REVIEW** (behavior-affecting, contract-affecting, or PROBABLE), and **NEEDS-DESIGN** (architectural, so a proposal with options).
**Research finding and idea schema:**
```
ID (RSCH-NNN | IDEA-NNN) · Title · Lens · Tier (CONFIRMED|PROBABLE|SPECULATIVE) ·
Claim · Sources (code file:line | installed-doc | external+manifest entry) ·
Anchor (for code sources: a verbatim ≤~40-char substring copied from the cited line, backtick- or quote-delimited) · Verified-at (sha) ·
Grounding (how it applies to our code) · Disconfirmation (what you ruled out) ·
Value/Impact · Smallest slice · Recommendation · Hands-off-to (skill) · Effort · Risks
```

## 7 · Evidence and citation discipline
The tiers, grounding, and disconfirmation of `§A` apply to every register entry and every brief sentence. A claim with no source is not reported. An external claim with no manifest entry is not published (`§A`). Triangulate: prefer a primary source (the library's own installed docs and types, the spec, the code) over a secondary one, and two independent secondaries beat one. Convey a source in your own indirect speech. Quote at most one short marked phrase per source, never an unmarked passage. Recognizing a name is not knowing its current state. Verify a library, tool, or model name against the installed version or a primary source before reporting on it, and keep the name as the brief wrote it. A code citation also carries an **Anchor**, a verbatim substring of about 40 characters at most, *copied* from the cited line and backtick- or quote-delimited so the checker can parse it, for example Anchor: `parseManifest(text)`. An undelimited value is invisible to `revalidate-register.mjs` and forfeits the DRIFTED check. A cited line that no longer contains its anchor is flagged **`DRIFTED`**, so re-locate the claim on the current tree or drop it. For a secret-bearing line the Anchor MUST be a non-secret substring of that line (the variable name or keyword, never any part of the value). If no safe substring exists, use Anchor: `<REDACTED-LINE>`, which the checker treats as line-existence-only.

## 8 · Severity and priority
Rank proposals by **value times reach divided by effort**, weighted by confidence (tier) and grounding strength. Lead deliverables with a ranked "top N". An idea that cannot be grounded is SPECULATIVE and ranks below any PROBABLE or CONFIRMED item.

## 9 · Evidence standard
Every finding or idea cites its sources, states how it applies to our code, gives concrete value and a smallest slice, and ends with a concrete recommendation and a hand-off target, never "consider maybe". State confidence honestly.

## 10 · Quality lenses (research-centric)
- **Grounding and applicability** *(primary)*: does the external knowledge actually apply to our code and constraints, or is it generic?
  - **Claims-vs-enforcement** means a doc, comment, contract, or JSDoc asserts X while the adjacent code, schema, migration, or type enforces Y: a "pinned to match" comment that no longer matches, a stale doc contradicted by a migration, or a dead error path the data layer can never raise. It is cheap to hunt against the adjacent definition and high-yield.
- **Prior art and alternatives**: how is this solved in the wild, in open source, in the library's own capabilities, or in established patterns? What are the credible alternatives?
- **Feasibility and cost**: effort, migration cost, blast radius, and the smallest valuable slice.
- **Risk and trade-offs**: what does adopting this cost or endanger, including the suite's privacy and egress posture?
- **Novelty (honest)**: is an idea genuinely new and valuable, or cargo-culted? Label it and feasibility-check it.
- **Source quality**: primary against secondary, currency, and independence. Verify against the installed version, not memory.

## 11 · The hand-off (researcher proposes, others implement)
The researcher's terminal output is a register or brief, not a diff. Map each actionable item to its implementer. Improvements go to `code-ops-suite:remediation` or `rigor:fix-verified`. Features go to `feature-discovery`, `feature-implementation`, or `ship`. Decisions go to `adr`. Measured performance goes to `rigor:improve-measured`. Dependency and CVE actions go to `dependency-upgrade` or `supply-chain-trust`. A brief is "done" when it is concrete enough for that implementer to act without re-researching.

## 12 · Shared artifacts and single source of truth
Registers are **live backlogs and SSOT** with **stable IDs** such as `RSCH-007` and `IDEA-012`. **Registers stay fresh:** before a finding is written, carried across a phase boundary, or handed off, re-confirm it still holds against the current tree. Drop or re-tier anything that no longer does (`OBSOLETE-AT <sha>`), and stamp each entry `Verified-at: <sha>` (`§6`). Pre-filter first, read narrow: at a phase boundary run the checker BEFORE any wholesale register read, then read only the non-FRESH/DRIFTED entries in full. Read the whole register only where a phase genuinely synthesizes across all findings. The mechanical pre-filter is `node <plugin-root>/scripts/revalidate-register.mjs <register> --root <repo>`. Every external request is recorded in `EGRESS_MANIFEST.md` and validated with `node <plugin-root>/scripts/research-manifest.mjs validate <artifact>` before publishing. Run artifacts go in a dated folder under the repo's docs location. Standard filenames are `RESEARCH_FINDINGS.md`, `IDEAS_REGISTER.md`, design briefs, `EGRESS_MANIFEST.md`, and `EXECUTIVE_SUMMARY.md`.

## 13 · Documentation quality standard (for briefs)
A design brief is written for a senior engineer who will implement it. Lead with a summary of one paragraph at most, carrying the recommendation and why. Then give the options with trade-offs, the grounded fit to our code, the smallest slice, and the open questions. Add Mermaid diagrams where they clarify. Cite every claim (`§7`). Use American spelling, present tense, and no emoji. Stamp the brief with the commit SHA it was researched against.

## 14 · Writing standard
Write to the house writing standard: one term per concept, active voice, one instruction per sentence, 20 words for instructions and 25 for explanation. Identifiers, paths, commands, and quoted output count as one word and are never reworded to fit a limit.

Clarity outranks conformance. When a rule would obscure meaning, break it and say why.

Full reference: `code-ops-docs/40 Engineering/Techniques/writing-standard.md`.
