# Researcher Suite — Shared Conventions

A toolkit of operational workflows for **code-grounded research**: investigate, gather external knowledge, and propose improvements, designs, and new ideas with the discipline the rest of the suite applies to code. Bundled with the **researcher** plugin; each skill is a namespaced slash command (e.g. `researcher:research-spike`) and reads this file first, referencing it by section instead of repeating it. Read-once: if this file is already live in the current context (not evicted or compacted away), do not re-read it — a skill invoked by an orchestrator that already loaded it inherits the in-context copy; after eviction, re-read as usual.

The researcher **proposes; it does not mutate.** It hands implementation to `code-ops-suite` / `rigor` (the implementation map is `§11`). It is honest about what leaves the machine (`§A`).

## A · Research integrity & egress model (central, non-negotiable)
Every skill operates inside this envelope. When in doubt, the most local, most cited, most disconfirmed option wins.
- **Cited + tiered, always.** Every claim names a source — code `file:line`, an installed-dependency doc (via `lib-docs`, `§2`), or an external source with a retrieval record. Tier each: **CONFIRMED** (verified against our code or a primary source) · **PROBABLE** (≥2 independent sources, or one strong primary) · **SPECULATIVE** (a single weak/secondary lead). Never present SPECULATIVE as fact; when unsure, pick the lower tier.
- **Grounding rule.** A codebase present → ground every claim and proposal in it ("does this hold for *our* code, given our constraints?"). Only materials given → ground in those. Mark anything not grounded `UNVERIFIED`.
- **Disconfirmation pass** on every proposal before reporting it: already done here? incompatible with our stack/constraints? superseded? measured, or merely assumed? **Intent annotation:** before reporting, read the cited line's immediate neighbors and any referenced ticket/finding id for an explicit by-design / accepted-deferred / KNOWN annotation, or a docstring/comment that matches the observed behavior — if the intent is documented at the line, it is not a defect; downgrade to informational. **Locate-the-handler:** a finding whose severity rests on "nothing else handles / guards / catches this" must actively LOCATE the would-be handler — the caller, wrapper, middleware, second gate, sole-caller invariant, or a separate CI/test enforcement — and report that search; never assert the absence of a handler without looking for it. Drop what doesn't survive.
- **Local-first, disclosed egress.** Default sources are local: the codebase, version-control history, installed-dependency docs, and materials the developer hands you (pasted text, file paths, URLs explicitly provided). **Web/external retrieval is explicit opt-in per run.** Every external request is appended to `EGRESS_MANIFEST.md` via `<plugin-root>/scripts/research-manifest.mjs` (time · tool · host · url · why) and surfaced at the checkpoint. **Never silently egress;** a published artifact must not cite a web source that is not in the manifest (the script enforces this fail-closed). Honor the privacy-opsec model: no new egress path without scrutiny.
- **Propose, don't mutate.** Output is registers/briefs with citations and concrete, trade-off-aware recommendations; novelty is labeled and feasibility-checked. Code changes are handed off (`§11`).

## 1 · Operating model — dynamic orchestration
Adaptive loop: assess → plan units → fan out parallel sub-agents → collect structured results → deepen / broaden / converge → repeat until the "Done when" criteria are met. Read-only gathering parallelizes freely, but **self-throttle the fan-out into bounded waves** (a handful of agents at a time) — a broad whole-repo sweep that launches its entire fan-out at once will trip platform rate-limits and can lose the whole run; do not rely on the platform's concurrency cap as the limiter. Use a **stronger model** for synthesis, judgment, and verification; a **faster model** for breadth gathering. Keep a live task list. Use bundled/reusable subagents.
- **Inline the grounding baseline.** When you fan out gatherers / claim-checkers / sub-agents, inject the ground-truth grounding baseline into each prompt — the exact tier definitions, grounding rule, and egress constraints in force (`§A`/`§10`), and which checks are blocking vs informational — rather than a pointer to the baseline; the inlined facts are what stop a claim-checker re-flagging something the grounding rule already settles.
- **Skim huge files, then deepen.** For a very large file, skim first (structure, exports/signatures, the risky regions) and deepen on what matters, rather than reading it end-to-end.
- **Audit the skipped-set at synthesis.** When you aggregate slices, take the union of every slice's skipped/traced note — a high-risk area that no slice covered is itself a finding (a coverage gap), not silence.

## 2 · Tools (optional, by capability)
Use if connected; proceed without them otherwise. The **documentation lookup** default is `<plugin-root>/scripts/lib-docs.mjs` (or the `code-ops-docs` MCP `get-docs` when `code-ops-suite` is installed) — local-first, reads the **installed** version, no query egress. For **opt-in web** research, compose the `deep-research` skill (fan-out search → fetch → adversarial verify) and record every request in the egress manifest (`§A`). Version-control history (why the code is the way it is) and a browser/UI tool (for UI products) are used if available.

## 3 · Interaction protocol — the developer is available
Default: **when unsure, ask — don't guess.**
**ASK when:** the research direction or success criteria are ambiguous; **anything would cause network egress** (confirm opt-in and scope — high-stakes); a recommendation has real trade-offs; or a finding is high-impact. Pause at phase-boundary checkpoints, and always surface the egress manifest at them.
**PROCEED when:** the work is local, in agreed scope, or following an approved plan.
**HOW:** batch questions; numbered options + a recommendation + a default; keep momentum on independent local gathering while a decision is pending.
**HEADLESS / non-interactive runs:** when no operator is present to answer a checkpoint (an autonomous or scheduled run), do not block: auto-scope from the repo, proceed on the safe default — read-only/assess work continues; egress and the always-gated categories are deferred and reported, never silently applied — and surface every decision and critical finding in the final report instead of pausing.

## 4 · Safety rails
- **No source edits** — the researcher documents and proposes; it never changes code (`§11`). Any code issue it finds is handed off as a finding/idea.
- **Never silently egress** (`§A`); confirm opt-in, record every request, surface the manifest.
- **Secrets/PII are radioactive** → redact to `<REDACTED:reason>` everywhere, including evidence; a discovered live secret is a critical hand-off finding (location + rotation, never the value).
- **Never fabricate** a source, capability, or quote — mark anything unconfirmed `UNVERIFIED`. Detect shell/OS; stay in-repo for local work.

## 5 · Modes
Each skill declares one: **DISCOVERY** (gather + propose; produces a backlog/specs) · **REVIEW** (verify/evaluate; produces a verdict/recommendation) · **DOCUMENT** (produces a brief; no code). None edit source.

## 6 · Tracks & schemas
Tracks (for proposals handed off): **NOW-SAFE** (local, low-risk, well-grounded) · **NEEDS-REVIEW** (behavior-/contract-affecting or PROBABLE) · **NEEDS-DESIGN** (architectural → proposal with options).
**Research finding / idea schema:**
```
ID (RSCH-NNN | IDEA-NNN) · Title · Lens · Tier (CONFIRMED|PROBABLE|SPECULATIVE) ·
Claim · Sources (code file:line | installed-doc | external+manifest entry) ·
Anchor (for code sources: a verbatim ≤~40-char substring copied from the cited line, backtick- or quote-delimited) · Verified-at (sha) ·
Grounding (how it applies to our code) · Disconfirmation (what you ruled out) ·
Value/Impact · Smallest slice · Recommendation · Hands-off-to (skill) · Effort · Risks
```

## 7 · Evidence & citation discipline
The tiers + grounding + disconfirmation of `§A`, applied to every register entry and brief sentence. A claim with no source is not reported. An external claim with no manifest entry is not published (`§A`). Triangulate: prefer a primary source (the library's own installed docs/types, the spec, the code) over a secondary one; two independent secondaries beat one. A code citation also carries an **Anchor** — a verbatim ≤~40-char substring *copied* from the cited line, backtick- or quote-delimited so the checker can parse it, e.g. Anchor: `parseManifest(text)` (an undelimited value is invisible to `revalidate-register.mjs` and forfeits the DRIFTED check); a cited line that no longer contains its anchor is flagged **`DRIFTED`** — re-locate the claim on the current tree or drop it. For a secret-bearing line the Anchor MUST be a non-secret substring of that line (the variable name or keyword, never any part of the value); if no safe substring exists, use Anchor: `<REDACTED-LINE>`, which the checker treats as line-existence-only.

## 8 · Severity & priority
Rank proposals by **value × reach ÷ effort**, weighted by confidence (tier) and grounding strength; lead deliverables with a ranked "top N". An idea that can't be grounded is SPECULATIVE and ranks below any PROBABLE/CONFIRMED item.

## 9 · Evidence standard
Every finding/idea cites its sources, states how it applies to our code, gives concrete value and a smallest slice, and ends with a concrete recommendation and a hand-off target — never "consider maybe". State confidence honestly.

## 10 · Quality lenses (research-centric)
- **Grounding & applicability** *(primary)* — does the external knowledge actually apply to our code/constraints, or is it generic?
  - **Claims-vs-enforcement** — a doc / comment / contract / JSDoc asserts X while the adjacent code / schema / migration / type enforces Y (a "pinned to match" comment that no longer matches, a stale doc contradicted by a migration, a dead error path the data layer can never raise). Cheap to hunt against the adjacent definition and high-yield.
- **Prior art & alternatives** — how is this solved in the wild (OSS, the library's own capabilities, established patterns)? what are the credible alternatives?
- **Feasibility & cost** — effort, migration cost, blast radius, the smallest valuable slice.
- **Risk & trade-offs** — what does adopting this cost or endanger (including the suite's privacy/egress posture)?
- **Novelty (honest)** — is an idea genuinely new and valuable, or cargo-culted? labeled and feasibility-checked.
- **Source quality** — primary vs. secondary, currency, independence; verify against the installed version, not memory.

## 11 · The hand-off (researcher proposes; others implement)
The researcher's terminal output is a register/brief, not a diff. Map each actionable item to its implementer: improvements → `code-ops-suite:remediation` / `rigor:fix-verified`; features → `feature-discovery` / `feature-implementation` / `ship`; decisions → `adr`; measured perf → `rigor:improve-measured`; dependency/CVE actions → `dependency-upgrade` / `supply-chain-trust`. A brief is "done" when it is concrete enough for that implementer to act without re-researching.

## 12 · Shared artifacts & single source of truth
Registers are **live backlogs / SSOT** with **stable IDs** (`RSCH-007`, `IDEA-012`). **Registers stay fresh:** before a finding is written, carried across a phase boundary, or handed off, re-confirm it still holds against the current tree; drop/re-tier anything that no longer does (`OBSOLETE-AT <sha>`) and stamp each entry `Verified-at: <sha>` (`§6`). Pre-filter first, read narrow: at a phase boundary run the checker BEFORE any wholesale register read, then read only the non-FRESH/DRIFTED entries in full — the whole register is re-read only where a phase genuinely synthesizes across all findings. The mechanical pre-filter is `node <plugin-root>/scripts/revalidate-register.mjs <register> --root <repo>`. Every external request is recorded in `EGRESS_MANIFEST.md` and validated with `node <plugin-root>/scripts/research-manifest.mjs validate <artifact>` before publishing. Run artifacts go in a dated folder under the repo's docs location. Standard filenames: `RESEARCH_FINDINGS.md`, `IDEAS_REGISTER.md`, design briefs, `EGRESS_MANIFEST.md`, `EXECUTIVE_SUMMARY.md`.

## 13 · Documentation quality standard (for briefs)
A design brief is written for a senior engineer who will implement it: lead with a ≤1-paragraph summary (the recommendation + why), then the options with trade-offs, the grounded fit to our code, the smallest slice, and open questions. Diagrams (Mermaid) where they clarify. Every claim cited (`§7`); American spelling, present tense, no emoji. Freshness-stamped with the commit SHA it was researched against.
