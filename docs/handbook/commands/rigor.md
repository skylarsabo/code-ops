# rigor — Command Reference

The `rigor` plugin is the verification layer of the code-ops marketplace: **prove it or don't report it; measure it or don't claim it; close it so it stays closed.** Where `code-ops-suite` favors breadth, `rigor` trades some breadth and speed for signal and proof. Every finding carries an evidence tier (`CONFIRMED` reproduced / `PROBABLE` two independent static lines / `SPECULATIVE` a lead), survives a mandatory disconfirmation pass, and reconciles against the deterministic toolchain treated as ground truth. CONFIRMED bugs ship a runnable repro; fixes ship a regression test that fails before and passes after; improvements show a before/after measurement; inconsistencies get one canonical form plus a mechanical enforcement. The shared methodology lives in [`plugins/rigor/CONVENTIONS.md`](../../../plugins/rigor/CONVENTIONS.md) and is read first by every skill; the suite overview is in [`plugins/rigor/README.md`](../../../plugins/rigor/README.md).

This plugin ships **11 skills**, all manual-invoke (`disable-model-invocation: true`) and namespaced `/rigor:<name>`. New to the handbook, read the orientation lines under each entry; if you are already fluent in Claude Code, the **How it works** and **Prerequisites & hand-offs** lines carry the phase counts, produced artifacts, and the wiring between skills.

## Index

Foundation and discovery (AUDIT / IMPLEMENT-tests):
- [`/rigor:ground-truth`](#rigorground-truth) — run the toolchain; capture the factual baseline + coverage/blind-spot map. Run first.
- [`/rigor:test-suite-audit`](#rigortest-suite-audit) — validate the tests the proofs rest on (flaky, assertion strength, mutation kill-rate).
- [`/rigor:safety-net`](#rigorsafety-net) — characterization tests that pin current behavior before a change.
- [`/rigor:bug-hunt`](#rigorbug-hunt) — derive invariants, trace flow, prove each candidate, then root-cause + sibling sweep. The flagship.
- [`/rigor:regression-hunt`](#rigorregression-hunt) — bisect a bug to its origin commit; hunt regressions in recent changes.
- [`/rigor:quality-scan`](#rigorquality-scan) — high-signal, defect-causing quality issues with evidence and tier. No cosmetics.

Closure, improvement, fix, review (IMPLEMENT / REVIEW):
- [`/rigor:consistency-closure`](#rigorconsistency-closure) — one canonical form, every site migrated, an enforcement added.
- [`/rigor:improve-measured`](#rigorimprove-measured) — behavior-preserving improvements with a baseline → result → delta.
- [`/rigor:fix-verified`](#rigorfix-verified) — fix CONFIRMED bugs at root cause with a failing→passing regression test and a guard.
- [`/rigor:deep-review`](#rigordeep-review) — review a PR/diff at the verification bar; block only on CONFIRMED defects/regressions.

Orchestrator:
- [`/rigor:rigor-sweep`](#rigorrigor-sweep) — the whole suite end-to-end as a checkpointed pipeline.

---

## Foundation and discovery

### `/rigor:ground-truth`
**Mode:** AUDIT

**How it works.** Two phases. Phase 0 detects the toolchain (build/typecheck, linters, test runner + coverage, benchmark harness, mutation tool, static analyzer/SAST) and notes what is missing — checkpointing if ambiguous. Phase 1 runs each tool and harvests its output as fact per `CONVENTIONS §C`: compile/type errors and test failures/flakes are CONFIRMED, a coverage map of exercised-vs-not is built, and a blind-spot list of low-coverage paths is produced. It writes `GROUND_TRUTH.md` (tool results, coverage map, blind-spot list, and which lint/analyzer rules are already enforced) and seeds unambiguous CONFIRMED items into `FINDINGS_REGISTER.md` with proof.

**Why it's useful.** It establishes the deterministic baseline every other rigor skill reconciles against, so later analysis never re-flags what a tool already enforces and never contradicts a green tool without a repro. It also names where coverage is thin, which is exactly where hunting must be most careful.

**When to use it.** Run it first, before any other rigor skill. Reach for it whenever you start a verification session on an unfamiliar repo or branch. Do NOT use it to find bugs by reasoning — it only runs and records the toolchain; reasoning-based discovery is `bug-hunt` and `quality-scan`.

**Prerequisites & hand-offs.** No prior register needed. Produces `GROUND_TRUTH.md`. Hands the blind-spot list to `safety-net` and the suite-trustworthiness question to `test-suite-audit`; its `GROUND_TRUTH.md` is read by `test-suite-audit`, `bug-hunt`, `quality-scan`, and `improve-measured`.

---

### `/rigor:test-suite-audit`
**Mode:** AUDIT

**How it works.** Three phases. Phase 0 scopes (whole suite, or the modules you rely on as proofs / intend to change) and reads the `GROUND_TRUTH.md` coverage map — a checkpoint. Phase 1 establishes what "green" is worth: it runs the suite several times to flag flaky/nondeterministic tests (quarantine list — a flaky green is not a green), judges assertion strength (tests that execute but assert little), and mutation-tests relied-upon code by injecting representative faults (or running a mutation tool) to confirm the suite kills them, cross-referencing coverage so the danger zone of high coverage + low kill rate is named. Phase 2 hardens the gaps by proposing and (for NOW-SAFE additions) writing targeted tests, then re-running to confirm the kill rate improves. Produces `TEST_SUITE_REPORT.md` with a trust map; genuinely broken behavior is surfaced into `FINDINGS_REGISTER.md`.

**Why it's useful.** Proofs are only as strong as the suite under them (`CONVENTIONS §F`). This skill tells you where a green suite actually detects faults versus where it guards nothing, so downstream repro and regression tests rest on tests that really catch faults.

**When to use it.** Run it right after `ground-truth` and before you rely on or change any code. Use it when you need to trust existing tests as a proof. Do NOT use it to add behavior-pinning coverage on untested code about to be refactored — that is `safety-net`; this skill validates and hardens what already exists.

**Prerequisites & hand-offs.** Reads `GROUND_TRUTH.md` (run `ground-truth` first). Produces `TEST_SUITE_REPORT.md` + a trust map and adds hardening tests; the trust map informs how much weight `bug-hunt`, `fix-verified`, and `deep-review` can place on "green".

---

### `/rigor:safety-net`
**Mode:** IMPLEMENT (adds tests only; changes no production code)

**How it works.** Two phases. Phase 0 picks targets — the blind spots from `GROUND_TRUTH.md`, code queued for a fix/refactor/improvement, and high-risk modules — and confirms scope (checkpoint). Phase 1 writes characterization tests that capture current observable behavior (including current quirks — these pin behavior, not correctness), runs them green against current code, and exercises real edge/error inputs so the net is tight. Behavior that looks wrong is not fixed here; it is recorded in `FINDINGS_REGISTER.md` as a candidate for `bug-hunt`/`fix-verified`. The tests are committed and tagged so the regression guard (`§H`) can find them.

**Why it's useful.** It makes "behavior-preserving" provable. By locking current behavior before anything is touched, refactors and fixes in low-coverage areas can be shown not to change observable behavior — giving the regression guard something concrete to protect.

**When to use it.** Before refactoring or fixing low-coverage code, especially the blind spots `ground-truth` flagged. Do NOT use it to assess whether existing tests catch faults (that is `test-suite-audit`), and do NOT fix bugs inside it — log them and hand off.

**Prerequisites & hand-offs.** Best run after `ground-truth` (for the blind-spot list). Produces a tagged characterization test suite and suspicious-behavior findings in `FINDINGS_REGISTER.md`. Its characterization tests join the proof set that `fix-verified`, `improve-measured`, and `regression-hunt` re-run; `improve-measured` expects a safety net to exist (or runs it first).

---

### `/rigor:bug-hunt`
**Mode:** AUDIT (reads + executes repros; no source fixes)

**How it works.** The flagship, in five phases. Phase 0 scopes one component/subsystem (go deep, not wide) and reads `GROUND_TRUTH.md` to avoid re-deriving facts — if it's absent, it runs `ground-truth` first (recommended) or harvests the `§C` toolchain baseline for the scoped area itself, never reasoning ahead of the toolchain. Phase 1 derives intent — the invariants, contracts, and assumptions the code must uphold. Phase 2 hunts: it traces control and data flow end-to-end and probes the correctness lenses (`§7` — boundaries, null/empty, ordering, concurrency/races/TOCTOU, error paths, state-machine/contract violations, resource lifecycle, integer/precision, time, encoding), generating adversarial inputs and using an oracle where exact correctness is hard. Phase 3 — the differentiator — proves each candidate with a failing test/repro (CONFIRMED, repro saved) or tiers it PROBABLE/SPECULATIVE, then runs the disconfirmation pass (`§B`) and drops what dies. Phase 4 traces every CONFIRMED bug to its root cause and sweeps the codebase for siblings (`§G`). Produces tiered entries in `FINDINGS_REGISTER.md` (schema `§6`) with repro tests committed and a CONFIRMED-led summary.

**Why it's useful.** It returns real, proven bugs with runnable repros and the whole class surfaced — not a list of guesses you then have to triage. The disconfirmation pass is the primary defense against false positives.

**When to use it.** When you want bugs found and proven on your riskiest subsystem, one subsystem at a time. **bug-hunt vs codebase-audit:** reach for `rigor:bug-hunt` when you want a deep, proven, disconfirmed account of one subsystem (fewer findings, each CONFIRMED with a repro); reach for `code-ops-suite`'s breadth audit when you want wide coverage across a whole repo and are willing to triage asserted findings yourself. Do NOT point `bug-hunt` at an entire large repo at once — that produces blind spots.

**Prerequisites & hand-offs.** Reads `GROUND_TRUTH.md` (run `ground-truth` first). Produces CONFIRMED/PROBABLE/SPECULATIVE findings + saved repros in `FINDINGS_REGISTER.md` that `fix-verified` consumes; pair with `regression-hunt` to bisect a confirmed bug to its origin commit.

---

### `/rigor:regression-hunt`
**Mode:** AUDIT (uses VCS history + executes repros)

**How it works.** Two phases. Phase 0 scopes the target — a known behavior change/bug to bisect to its origin, or "regressions introduced in the last N commits / since release X" — confirming the time range and what "correct" looked like before (checkpoint). Phase 1 locates and confirms: for a known bug it writes a detecting test and walks VCS history (bisect) to the introducing commit, reporting the commit, the change, and why it caused the regression; for a recent-changes sweep it derives what recent commits altered and runs the accumulated proof set / characterization tests across them, looking for behavior and performance regressions and checking changed areas against the lenses; it also flags related areas the offending change touched or shares a root cause with. Produces `REGRESSION_REPORT.md` (offending commits, repro, blast radius, related areas) and CONFIRMED findings into `FINDINGS_REGISTER.md`; if recent changes are clean, it says so with the evidence.

**Why it's useful.** It pinpoints when and why something broke and surfaces siblings that may carry the same regression — the bisect plus repro is the proof, so the finding is CONFIRMED, not asserted.

**When to use it.** When something used to work and you need the introducing commit, or after a release to sweep recent changes. Best paired with `bug-hunt` (to bisect a confirmed bug). Do NOT use it for first-discovery of bugs with no known prior-good state — that is `bug-hunt`.

**Prerequisites & hand-offs.** Needs VCS history; benefits from an existing proof set / characterization tests (from `safety-net`) to run across the range. Produces `REGRESSION_REPORT.md` + CONFIRMED findings for `fix-verified`.

---

### `/rigor:quality-scan`
**Mode:** AUDIT (reads + light execution)

**How it works.** Two phases. Phase 0 picks the area and reads `GROUND_TRUTH.md` so it skips what the linter/type-checker already enforces (checkpoint) — if it's absent, it runs `ground-truth` first or harvests the `§C` toolchain baseline itself before scanning. Phase 1 hunts the defect-causing maintainability lenses (`§7`) that actually bite: complexity hotspots (with a concrete metric, not a vibe), error-handling gaps (swallowed/re-thrown errors, missing cleanup/rollback, partial-failure paths), resource leaks (unclosed handles/connections/subscriptions, leaked timers/listeners), type-safety holes (unsafe casts, escape hatches, unchecked nullability at boundaries), fragile coupling (hidden temporal coupling, shared mutable state), and dead/duplicated code that hides intent. Each item carries `file:line`, reachability/impact (`§D`), a tier (`§A`), and the disconfirmation pass (`§B`); low-confidence noise is suppressed or marked SPECULATIVE. Produces `FINDINGS_REGISTER.md` entries ranked by demonstrated impact, each naming how it could be enforced once fixed.

**Why it's useful.** It surfaces issues that cause defects or real maintenance pain — with evidence and tiers — while excluding cosmetic style, which is the formatter's job. You get a short, high-signal list, not padding.

**When to use it.** When you want defect-causing quality problems (not deep logic bugs) found with evidence. It complements `bug-hunt` in a discovery phase. Do NOT use it for cosmetic/style cleanup (out of scope), for deep correctness bugs needing a derived-invariant trace (`bug-hunt`), or for closing divergent implementations of one concept (`consistency-closure`).

**Prerequisites & hand-offs.** Reads `GROUND_TRUTH.md` (run `ground-truth` first). Produces tiered `FINDINGS_REGISTER.md` entries that feed `fix-verified` (for defects) and may seed `consistency-closure` (for divergence).

---

## Closure, improvement, fix, and review

### `/rigor:consistency-closure`
**Mode:** IMPLEMENT (closure changes confirmed with you)

**How it works.** Follows the closure protocol `§9` in four phases. Phase 0 scopes the concept space (e.g. error handling, data access, validation, naming of one idea, API response shape) — checkpoint. Phase 1 inventories the variants: divergent implementations of the same concept, drifted duplication, inconsistent return/error/null conventions, contract drift across call sites, inconsistent naming — grouped by concept, each variant shown with `file:line`. Phase 2 proposes one canonical form per group with rationale, and the developer approves before any migration (an explicit checkpoint — a real decision). Phase 3 migrates every other site behavior-preservingly and conflict-aware, each tested and committed, then adds a mechanical enforcement (lint rule, codemod/CI check, shared type, or test) so the divergence cannot recur unnoticed, verifying nothing regressed via the regression guard `§H`. Produces `CONSISTENCY_REGISTER.md` (concept → canonical form → sites migrated → enforcement), the diffs, and the enforcement config.

**Why it's useful.** "Closed" means the divergence is mechanically prevented from returning — not "fixed once". You get one canonical form, every site converged, and a guard that keeps it that way.

**When to use it.** When the same concept is implemented divergently and you want it closed for good. **rigor:consistency-closure vs code-ops-suite:normalize:** reach for `consistency-closure` to pick one canonical form for a specific concept, migrate every site, and add an enforcement at the verification bar; reach for `code-ops-suite:normalize` for whole-repo style normalization. Do NOT use it to choose a canonical form without then adding the enforcement — the enforcement is the point.

**Prerequisites & hand-offs.** May be seeded by divergence findings from `quality-scan` or `bug-hunt`. Produces `CONSISTENCY_REGISTER.md` + the enforcement; its migrations are protected by the regression guard alongside the rest of the proof set.

---

### `/rigor:improve-measured`
**Mode:** IMPLEMENT (via the fix–prove–guard loop `§8`)

**How it works.** Three phases under the rule *if you can't measure the "before", you can't claim the "after"*. Phase 0 scopes and defines "better" (runtime/latency, allocations/queries, complexity, bundle/footprint, removable code/deps, or API ergonomics), reads `GROUND_TRUTH.md`, and confirms a `safety-net` exists for the target (or runs it first) so behavior-preservation is provable — checkpoint. Phase 1 baselines each candidate with a concrete measurement (a benchmark number, complexity score, allocation/query/IO count, bundle size, or the exact dead code/dependency to remove), rejecting speculative "feels cleaner" changes. Phase 2 applies each change behavior-preservingly (keeping the full suite + proof set green), re-measures, and records before → after → delta, rolling back any change whose delta doesn't justify it (checkpoint per behavior-adjacent or public-contract change). Produces `IMPROVEMENTS_LOG.md` with each change's baseline → result → delta and proof.

**Why it's useful.** It ships only improvements with a measured win and preserved behavior — no speculative refactors. Every claim is backed by a before/after number.

**When to use it.** When you want measured, behavior-preserving improvements with deltas. **rigor:improve-measured vs code-ops-suite:performance:** reach for `improve-measured` for measured, behavior-preserving improvement across any axis (complexity, allocations, removable deps, ergonomics) at the verification bar; reach for `code-ops-suite:performance` for profiling-led hot-path optimization specifically. Do NOT use it for changes you cannot measure, or for fixing bugs (that is `fix-verified`).

**Prerequisites & hand-offs.** Reads `GROUND_TRUTH.md`; expects a `safety-net` for the target (or runs it). Produces `IMPROVEMENTS_LOG.md` + diffs/PRs; its changes are held green by the regression guard.

---

### `/rigor:fix-verified`
**Mode:** IMPLEMENT

**How it works.** Two phases consuming `FINDINGS_REGISTER.md` — if the register is absent, it stops and routes to `bug-hunt` to produce one rather than synthesizing a register from memory. Phase 0 re-validates and sequences: it runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` as a fast staleness pre-filter (`§10`), then for each CONFIRMED finding confirms the repro still fails on current code (dropping or re-tiering what no longer reproduces), builds a dependency/conflict graph, sequences by demonstrated impact, and gets a direction first for NEEDS-DESIGN items — checkpoint. Phase 1 runs the fix–prove–guard loop (`§8`) per item: confirm the failing repro → trace to root cause (`§G`) and make the minimal correct fix at the right layer → repro passes and the full suite is green → regression guard (`§H`, re-run the entire accumulated proof set, never weakening a proof to pass) → behavior-preservation check → sweep for siblings → add an enforcement (kept regression test + a type/lint/assertion) → self-review → commit atomically referencing the finding ID + proof → update the register, conflict-aware across items; if fixes start cascading (3+ guard-rejected or spawning new CONFIRMED findings), the cascade circuit-breaker (`§H`) stops the loop and escalates the cluster as NEEDS-DESIGN. Produces atomic PRs each carrying its failing→passing repro, `IMPLEMENTATION_LOG.md`, and the updated register.

**Why it's useful.** It fixes the cause, not the symptom, proves the fix with a test that failed before and passes now, sweeps the whole class, and guards against recurrence — so fixes stay fixed.

**When to use it.** When CONFIRMED bugs exist and you want them fixed with proof. It fixes CONFIRMED items only; a PROBABLE item must be reproduced (promoted to CONFIRMED) first. Do NOT use it to discover bugs (that is `bug-hunt`) or to make non-bug improvements (`improve-measured`/`consistency-closure`).

**Prerequisites & hand-offs.** Consumes a `FINDINGS_REGISTER.md` of CONFIRMED items (from `bug-hunt`/`regression-hunt`/`quality-scan`); benefits from a `safety-net` and `test-suite-audit` so behavior-preservation and the proof set are trustworthy. Produces fixes (PRs) + `IMPLEMENTATION_LOG.md` + an updated register. Always-gated categories (security/auth, secrets, data migrations, destructive ops, public contracts) pause regardless of automation level (`§4`).

---

### `/rigor:deep-review`
**Mode:** REVIEW (no changes unless asked)

**How it works.** Two phases plus an output step. Phase 0 understands the change — pulls the diff and its intent and the surrounding code, runs the `GROUND_TRUTH` tooling on the branch (typecheck, lint, tests) so the review starts from facts, and fans out to the tracer/verifier subagents for large diffs; changed exported symbols and shared contracts get their dependents traced so ranking reflects demonstrated reach (`§D`), not diff size. Phase 1 reviews against the correctness, failure-handling, consistency, and defect-causing-maintainability lenses (`§7`): each concern is reproduced (a failing test or trace) where feasible → CONFIRMED, otherwise tiered PROBABLE/SPECULATIVE; the disconfirmation pass (`§B`) runs on every concern; it checks the change does not introduce an inconsistency, regress an existing enforcement or prior proof (`§H`), or land behavior without a test, with a quick bisect/history check if it looks like it reverts a past fix. Output is `file:line` comments grouped Blocking (CONFIRMED defect/regression) · Should-fix (PROBABLE/quality) · Nit, plus a verdict (approve / approve-with-nits / request-changes) and a short risk read — as PR comments if a VCS tool is connected, else `REVIEW.md`. No tier inflation: it does not block on a SPECULATIVE nor wave through a CONFIRMED defect.

**Why it's useful.** It reviews a change at the verification bar, so a blocking comment means a reproduced defect — calibrated, not opinion.

**When to use it.** When you want a PR/diff reviewed with reproduced, tiered concerns. **rigor:deep-review vs code-ops-suite:pr-review vs privacy-opsec-suite:opsec-pr-gate:** `rigor:deep-review` is the high-rigor counterpart that reproduces and tiers concerns and blocks only on CONFIRMED defects/regressions; `code-ops-suite:pr-review` is the broad-coverage PR review; `privacy-opsec-suite:opsec-pr-gate` is the anonymity/leak gate for projects with opsec needs. Use `deep-review` when proof-grade review of correctness and regressions is what you want. Do NOT use it to apply fixes — it produces a review; switch to `fix-verified` to act on CONFIRMED items.

**Prerequisites & hand-offs.** Runs the `ground-truth` tooling itself on the branch; a connected VCS tool lets it post PR comments. Wire it into CI on every PR with `anthropics/claude-code-action@v1` — see [`plugins/rigor/examples/github-deep-review.yml`](../../../plugins/rigor/examples/github-deep-review.yml). Hands CONFIRMED defects to `fix-verified`.

---

## Orchestrator

### `/rigor:rigor-sweep`
**Mode:** orchestrator

**How it works.** It orchestrates the other rigor skills in sequence as one developer-in-the-loop pipeline — it does not replace them — carrying the registers and a growing proof set forward, keeping a master plan and a coverage map, and checking in at every phase boundary. Phase 0 scopes the run: detect stack/size, confirm track (`assess-only` = facts + proven findings, no code changes · `full` = also fix/close/improve · or a custom subset) and scope, open a master todo, a running `EXECUTIVE_SUMMARY.md`, and a coverage map, and surface any CONFIRMED critical finding immediately. Phase 1 runs `ground-truth`. Phase 2 runs `test-suite-audit`. Phase 3 finds read-only with proofs via `bug-hunt` (deep, per subsystem) and `quality-scan` (using `regression-hunt` to bisect any confirmed regression), then checkpoints on the CONFIRMED-led register. Phase 4 runs `safety-net` on blind spots and anything queued for change. Phase 5 runs `fix-verified` on CONFIRMED bugs (writes code — requires approval, checkpoint per batch). Phase 6 runs `consistency-closure`. Phase 7 optionally runs `improve-measured`. The master `EXECUTIVE_SUMMARY.md` separates CONFIRMED from PROBABLE/SPECULATIVE and states coverage.

**Why it's useful.** It runs the whole verification suite end-to-end as a checkpointed pipeline with the proof set and registers carried forward, so nothing code-changing happens without approval and the trustworthiness of the suite is established before fixes lean on it.

**When to use it.** When you want the entire rigor suite on a repo or subsystem; start with `assess-only` to get proven findings before changing anything, then re-run `full`. **full-sweep (intra-plugin) vs everything (cross-plugin):** `rigor:rigor-sweep` is the intra-plugin orchestrator that runs only rigor's own skills end-to-end, the same way each suite has its own `full-sweep`-style orchestrator; the cross-plugin `everything` orchestrator (in `code-ops-suite`) composes across plugins. Reach for `rigor-sweep` when the work is purely verification-first; reach for the cross-plugin orchestrator when you want breadth, rigor, and the other layers composed in one pass. Do NOT use it as a substitute for pointing `bug-hunt` at one subsystem when that is all you need.

**Prerequisites & hand-offs.** Drives all ten other rigor skills in order; needs whatever each phase needs (VCS history for `regression-hunt`, a connected VCS tool only if you later review). Produces every per-skill artifact plus the master `EXECUTIVE_SUMMARY.md`. The automation level (`gated` default / `auto-safe` / `auto-all`) set at the start governs every code-changing step, with always-gated categories per `§4`.

---

*Verified-at: c2b37e9*
