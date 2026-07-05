# Rigor Suite — Shared Conventions (verification-first, v2)

A toolkit for **finding real bugs, closing inconsistencies, and making measured improvements** with a capable agentic coding agent (e.g. Claude Code / Opus 4.8). Bundled with the **rigor** plugin; each skill is a namespaced slash command (e.g. `/rigor:bug-hunt`) and reads this file first, referencing it by section instead of repeating it.

This suite trades breadth-and-speed for **signal and proof**. It finds fewer things than a fire-hose audit — but the things it reports are real, the things it fixes stay fixed, and the tests that prove them are themselves verified.

## 0 · The core principle
**Prove it or don't report it. Measure it or don't claim it. Close it so it stays closed.**
Every finding is backed by a concrete proof artifact (a failing test, a runnable reproduction, an executed trace/query, a counterexample). Every improvement is backed by a before/after measurement. Every inconsistency is closed by a chosen canonical form *plus* a mechanical enforcement. A confident guess is worse than silence.

## A · Evidence tiers — every finding carries one; never inflate
- **CONFIRMED** — reproduced. A failing test, runnable repro, or executed trace demonstrates it on the current code. *Only CONFIRMED items may drive an automated fix.*
- **PROBABLE** — strong static evidence (data-flow, contract, or type analysis), not executed. **Requires at least two independent lines of evidence** (e.g. a data-flow path *and* a contradicting contract, or two distinct call sites). Needs a repro or human confirmation before fixing.
- **SPECULATIVE** — a single weak signal or a lead worth a look; explicitly low-confidence. Never presented as fact, never auto-fixed.
Labeling a guess CONFIRMED is the cardinal sin. When unsure between tiers, pick the lower one.

## B · The disconfirmation pass — mandatory before any finding is reported
For every candidate, actively try to **kill it** before believing it: Is the triggering path actually *reachable*, and under what preconditions? Is it already handled elsewhere (caller, wrapper, middleware, framework, type system)? Is it intentional? Does an existing test already cover it? Is the `file:line` exactly right on the current code? **Intent annotation:** read the cited line's immediate neighbors and any referenced ticket/finding id for an explicit by-design / accepted-deferred / KNOWN annotation, or a docstring/comment that matches the observed behavior — if the intent is documented at the line, it is not a defect; downgrade to informational. **Locate the handler:** a finding whose severity rests on "nothing else handles / guards / catches this" must actively LOCATE the would-be handler — the caller, wrapper, middleware, second gate, sole-caller invariant, or a separate CI/test enforcement — and report that search; never assert the absence of a handler without looking for it. Only survivors are reported; record what you ruled out. This is the primary defense against false positives.

## C · Ground truth first
Before model reasoning, run and harvest the **deterministic toolchain** and treat its output as fact: build/typecheck, linters, the existing test suite + coverage, and any available static analyzer / SAST. Reconcile every model finding against these — *agree, contradict, or extend*. Never re-flag what a tool already enforces. Never contradict a green tool without a repro that proves it wrong.

## D · Reachability & impact
Rank by **demonstrated blast radius**, not theoretical severity. Downgrade issues on dead/unreachable paths. A CONFIRMED crash on a hot path outranks a PROBABLE edge case behind three feature flags. State the reach of each finding.

## E · Evidence standard
Every finding cites `file:line` **and** its proof artifact (the test name, repro steps, trace, or measured number). No invented locations — if you can't point to it on the current code, you haven't found it. Anything unexecuted is PROBABLE or SPECULATIVE, never CONFIRMED. Every finding also carries an **Anchor** — a short **verbatim** substring *copied* from the cited line (not paraphrased); if it isn't literally present at `file:line` on the current tree, the citation is invented and the finding is rejected. `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>` checks it mechanically (a cited line that no longer contains its anchor is **`DRIFTED`**), making "no invented locations" a deterministic gate rather than a promise.

## F · Trust the test suite only as far as it's proven  *(new in v2)*
A green suite is **not** proof until its fault-catching power on the relevant code is established — your repro and regression tests are only as strong as the suite's ability to detect faults. Therefore, for code you rely on as a proof or intend to change:
- **Detect flaky/nondeterministic tests** (repeat runs); quarantine and investigate them — a flaky green is not a green.
- **Judge assertion strength** — a test that executes code but asserts little gives coverage without verification.
- **Mutation-check** — inject representative faults and confirm the tests *kill* them; surviving mutants mark exactly where "passing" tests guard nothing. High coverage with a low kill rate is the danger zone.
A regression test that still passes against a deliberately broken implementation protects nothing — fix the test before trusting it.

## G · Root cause over symptom  *(new in v2)*
Trace every CONFIRMED bug to its **root cause** and fix at the correct layer, not the nearest symptom. Then **sweep the codebase for siblings** — other instances of the same root cause or anti-pattern — and register them. Fix the *class*, not just the instance, and prefer an enforcement that covers the whole class.

## H · Regression guard  *(new in v2)*
Maintain a growing **proof set**: every repro, characterization, and regression test produced during the run. After each change, re-run the full proof set **plus** the suite; a change that breaks any prior proof or a previously-green test is rejected and reworked. **Never delete or weaken a proof to make a change pass.** Nondeterministic results are quarantined and investigated, not ignored.

## I · Independent refutation — kill load-bearing findings with a fresh adversary  *(new in v2)*
The disconfirmation pass (`§B`) is run by the finder, so it catches the guard *in the same function* and misses the one the finder already reasoned past — a clamp/normalize in another file, a cap in the caller, a second gate at a different boundary, a dominating type/invariant. So a finding that will **drive a fix** or **block a change** — and whose confidence rests on static reachability reasoning rather than an executed repro — is handed to an **independent adversary that did not find it** (a `tracer` or `reviewer` in *refutation mode*): its sole task is to **kill** the finding by locating that dominating guard/handler in a different function, file, or boundary, defaulting to REFUTED when it finds one and citing its `file:line`. For a high-severity finding spawn a small **odd panel (default 3)**; **majority-REFUTED → the finding drops, or downgrades to SPECULATIVE with the cited guard.** A CONFIRMED item already backed by an **executed repro** (`§A`) needs no panel — the repro is the proof, and refutation cannot overturn a demonstrated failure; the panel is for the static, false-positive-prone PROBABLE findings and for high-severity claims whose severity rests on "nothing else guards this." Only survivors are reported CONFIRMED/blocking or fixed. This is the adversarial complement to `§B`: self-disconfirmation is necessary, an independent kill attempt is what makes a high-severity static finding trustworthy.

## 1 · Operating model — dynamic orchestration
Adaptive loop: assess → plan units → fan out parallel sub-agents → collect structured results → deepen / converge / escalate → repeat until the "Done when" criteria are met. Read-only analysis parallelizes freely, but **self-throttle the fan-out into bounded waves** (a handful of agents at a time) — a broad whole-repo sweep that launches its entire fan-out at once will trip platform rate-limits and can lose the whole run; do not rely on the platform's concurrency cap as the limiter. Code edits are **conflict-aware** (parallel on disjoint files, serial on shared/dependent ones). Use a **stronger model** for invariant reasoning, bug hunting, root-cause analysis, and review; a **faster model** for breadth sweeps and mechanical migration. Keep a live task list. Use the bundled subagents: a read-only `tracer` for investigation, and a `verifier` that *executes* repros/mutations/benchmarks to confirm or kill candidates.
- **Inline the enforced ruleset.** When you fan out reviewers / sub-agents, inject the ground-truth tool-enforced ruleset into each prompt — the exact lint/type rules in force and which are warnings vs errors — rather than a pointer to `GROUND_TRUTH.md`; the inlined facts are what stop a reviewer re-flagging a rule a tool already enforces.
- **Skim huge files, then deepen.** For a very large file, skim first (structure, exports/signatures, the risky regions) and deepen on what matters, rather than reading it end-to-end.
- **Audit the skipped-set at synthesis.** When you aggregate slices, take the union of every slice's skipped/traced note — a high-risk area that no slice covered is itself a finding (a coverage gap), not silence.

## 2 · Tools (optional, by capability)
Use if connected; proceed without them otherwise. A docs/reference lookup (verify library behavior — don't guess an API), version-control history (bisect to find when/why a bug entered), a test runner + benchmark harness (the heart of this suite), a mutation-testing tool if one exists for the stack, and any static analyzer/SAST. The **in-house default for the docs/reference lookup** is `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (or the `code-ops-docs` `get-docs` MCP tool when code-ops-suite is installed) — it reads the **installed** version's README + type signatures (local-first, no third-party), so verify an API against it rather than guessing; non-installed fetched docs are `UNVERIFIED` against the running version.

## 3 · Interaction protocol — the developer is available
Default: **when unsure, ask — don't guess.**
**ASK when:** intent or the intended invariant is ambiguous; choosing a canonical form for consistency closure (a real decision); a fix/improvement is behavior-adjacent or risky; a finding is high-impact; or input looks stale. Pause at phase-boundary checkpoints.
**PROCEED when:** the work is clear, safe, in scope, or following an approved plan — including writing repro/characterization tests and applying CONFIRMED, behavior-preserving fixes.
**HOW:** batch questions; numbered options + a recommendation + a default; keep momentum on independent work while a decision is pending.
**HEADLESS / NON-INTERACTIVE RUNS:** When no operator is present to answer a checkpoint (an autonomous or scheduled run), do not block: auto-scope from the repo, proceed on the safe default — read-only/assess work continues; code-changing work and the always-gated categories are deferred and reported, never silently applied — and surface every decision and critical finding in the final report instead of pausing.

## 4 · Safety rails
Work on a **branch**; commit atomically referencing the finding ID + its proof. **Never break the build**; keep the suite green. **Behavior preservation by default** — improvements, closures, and characterization must not change observable behavior unless that *is* the fix and you've confirmed it. Secrets/PII → redact (`<REDACTED:reason>`); a live secret is a CONFIRMED critical finding (location + rotation, never the value). Detect shell/OS; stay in-repo; never fabricate. Ask before destructive/irreversible actions.

**Automation level (set once at the start; default `gated`).** Governs every code-changing step:
- `gated` *(default)* — pause for approval at each fix/closure batch.
- `auto-safe` *(recommended ceiling)* — auto-apply only **CONFIRMED + NOW-SAFE** fixes (each on a branch, each carrying a failing→passing regression test, each passing the regression guard `§H`); pause for NEEDS-REVIEW, NEEDS-DESIGN, and the always-gated categories below.
- `auto-all` — *not recommended*; NEEDS-DESIGN is never auto-applied even here.
- **Always gated, regardless of level:** security/auth changes, secret handling, data migrations or destructive/irreversible operations, and public API/contract changes. **Never auto-merge.**

## 5 · Modes
Each skill declares one: **AUDIT** (read + may execute repros/mutations/measurements; no source fixes) · **IMPLEMENT** (ships code via the loop below) · **REVIEW** (produces a review; no changes unless asked).

## 6 · Tracks & finding schema
Tracks: **NOW-SAFE** (CONFIRMED, local, low-risk) · **NEEDS-REVIEW** (behavior-/contract-changing or PROBABLE) · **NEEDS-DESIGN** (architectural → proposal with options).
```
ID · Title · Lens · Tier (CONFIRMED|PROBABLE|SPECULATIVE) ·
Proof (test name / repro steps / trace / measurement) · Location (file:line) ·
Anchor (a verbatim substring copied from the cited line) ·
Verified-at (sha the proof last passed on) ·
Root-cause · Class/siblings (other sites of the same cause) ·
Reachability (preconditions) · Impact (demonstrated blast radius) ·
Disconfirmation (what you ruled out) · Refutation (independent: survived, or the guard that killed it) ·
Fix · Enforcement (how recurrence is prevented) ·
Track · Effort · Risk-if-fixed
```

## 7 · Quality lenses (defect-oriented, high-signal — not cosmetic)
- **Correctness & logic** *(primary — the deep bugs)*: off-by-one/boundary, null/empty/missing, ordering, concurrency / races / TOCTOU, error & exception paths, state-machine and contract/invariant violations, resource lifecycle/leaks, integer/precision, time/timezone, encoding/serialization round-trips. *Where exact correctness is hard to assert directly, verify against an **oracle**: a reference or prior version, the spec, a parallel implementation, property-based generators, or round-trip/metamorphic relations.*
- **Failure handling**: unhandled/swallowed errors, missing rollback/cleanup, partial-failure and retry/idempotency gaps.
- **Interface consistency**: divergent implementations of the *same concept*, drifted duplication, inconsistent return/error/null conventions, contract drift across call sites. **Claims-vs-enforcement** — a doc / comment / contract / JSDoc asserts X while the adjacent code / schema / migration / type enforces Y (a "pinned to match" comment that no longer matches, a stale doc contradicted by a migration, a dead error path the data layer can never raise). Cheap to hunt against the adjacent definition and high-yield.
- **Defect-causing maintainability**: complexity hotspots (with a metric), fragile coupling, type-safety holes, dead code that hides intent. *Cosmetic style is the formatter's job — out of scope.*
- **Measurable improvement**: benchmarked performance, complexity reduction, removable code/dependencies, API ergonomics with a concrete before/after.
- **Test integrity** *(v2)*: flaky/nondeterministic tests, weak assertions, low mutation kill-rate, and coverage blind spots.

## 8 · The fix–prove–guard loop (IMPLEMENT-mode, for CONFIRMED items)
reproduce (a test that **fails on current code**) → find the **root cause** (`§G`) and make the minimal correct fix at the right layer → that test now **passes** and the full suite is green → **regression guard** (`§H`): re-run the entire accumulated proof set, nothing prior breaks → behavior-preservation check → **sweep for siblings** (`§G`) and register/fix them → **add an enforcement** so the class can't recur (regression test kept, plus a type/lint/assertion) → self-review → commit atomically referencing the finding ID + proof → update the register. A fix without a failing-then-passing test, or that breaks a prior proof, is not done.

## 9 · Consistency-closure protocol
inventory every variant of a concept → choose **one canonical form** (with rationale; the developer approves) → migrate every other site (behavior-preserving, conflict-aware, each tested) → **add a mechanical enforcement** (lint rule, codemod check, shared type, or test) so the divergence **cannot recur unnoticed** → verify nothing else regressed (`§H`). "Closed" means it cannot recur unnoticed — not "fixed once".

## 10 · Shared artifacts & single source of truth
Registers are **live backlogs / SSOT** with **stable IDs** across the lifecycle (`BUG-007` → register → repro test → commit/PR → log). **Registers stay fresh:** before a finding is written, carried across a phase boundary, or consumed by `fix-verified`, re-confirm its proof still fails on the current tree (the regression guard `§H` already keeps the proof set green); drop/re-tier anything that no longer reproduces (`OBSOLETE-AT <sha>`) and stamp each entry `Verified-at: <sha>` (`§6`). A fast pre-filter before re-running proofs is **`node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>`** (FRESH / MOVED / GONE / NO-REF). Run artifacts go in a dated folder under the repo's docs location (e.g. `docs/rigor/<date>/`), or repo root if there's no docs convention. Standard filenames: `GROUND_TRUTH.md`, `TEST_SUITE_REPORT.md`, `FINDINGS_REGISTER.md`, `CONSISTENCY_REGISTER.md`, `IMPROVEMENTS_LOG.md`, `REGRESSION_REPORT.md`, `IMPLEMENTATION_LOG.md`, `EXECUTIVE_SUMMARY.md`. Characterization and regression tests live with the repo's tests, tagged so the regression guard can find them. Every summary separates **CONFIRMED** from PROBABLE/SPECULATIVE and states what was and wasn't examined.
