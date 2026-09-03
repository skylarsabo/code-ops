# `rigor` command reference

This page is the complete command reference for the `rigor` plugin.
It carries one entry per command: how it works, why it is useful, when to reach for it, and what it hands off.
Read it when you are picking a verification command or wiring one into a larger run.

The `rigor` plugin is the verification layer of the code-ops marketplace. Its rule is short.
Prove it or do not report it. Measure it or do not claim it. Close it so it stays closed.
Where `code-ops-suite` favors breadth, `rigor` trades some breadth and speed for signal and
proof.

Every finding carries an evidence tier: CONFIRMED for a reproduced finding, PROBABLE for two
independent static lines, and SPECULATIVE for a lead. Every finding survives a mandatory
disconfirmation pass. Every finding reconciles against the deterministic toolchain, which is
treated as ground truth. The rest follows from those three rules:

- a CONFIRMED bug ships a runnable reproduction
- a fix ships a regression test that fails before and passes after
- an improvement shows a before-and-after measurement
- an inconsistency gets one canonical form plus a mechanical enforcement

The shared methodology lives in
[`plugins/rigor/CONVENTIONS.md`](../../../../plugins/rigor/CONVENTIONS.md), and every skill
reads it first. The suite overview is in
[`plugins/rigor/README.md`](../../../../plugins/rigor/README.md).

This plugin ships **11 skills**, namespaced `/rigor:<name>`. Invoke a skill by slash command,
or let the model route to it under the standard-operating-mode routing card.
Side-effect-bearing phases keep their checkpoints, and nothing ever auto-merges. If you are
new to the handbook, read the orientation lines under each entry. If you already run the
suite fluently, the **How it works** and **Prerequisites and hand-offs** lines carry the
phase counts, the produced artifacts, and the wiring between skills.

## Shared run mechanisms

A verification run reads a lot of code and runs a lot of noisy commands, so it uses the
suite's shared context mechanisms. Read a file's outline with `co context skim <file>`, then
request a line range. Ask the symbol index a structural question with
`co context query find|callers|callees|blast <symbol>`, which answers in `file:line` anchors.
A long test or build run arrives digested, with a receipt naming the raw output file, so a
truncated result is a pointer rather than a loss. Each mechanism is on by default and turns
off from the `env` block of a `.claude/settings.json`. The behavior contracts are in
[the contracts page](../../../35 Contracts and Data/CONTRACTS.md), and the switches are in
[the infrastructure page](../../../50 Platform/INFRASTRUCTURE.md). The
[code-ops-suite page](code-ops-suite.md#bundled-scripts-and-hooks) lists the commands.

## Index

Foundation and discovery (AUDIT and IMPLEMENT-tests):

- [`/rigor:ground-truth`](#rigorground-truth): run the toolchain, capture the factual baseline and the coverage and blind-spot map. Run it first.
- [`/rigor:test-suite-audit`](#rigortest-suite-audit): validate the tests the proofs rest on (flakiness, assertion strength, mutation kill rate).
- [`/rigor:safety-net`](#rigorsafety-net): characterization tests that pin current behavior before a change.
- [`/rigor:bug-hunt`](#rigorbug-hunt): derive invariants, trace flow, prove each candidate, then root-cause and sweep for siblings. The flagship.
- [`/rigor:regression-hunt`](#rigorregression-hunt): bisect a bug to its origin commit, then hunt regressions in recent changes.
- [`/rigor:quality-scan`](#rigorquality-scan): high-signal, defect-causing quality issues with evidence and a tier. No cosmetics.

Closure, improvement, fix, and review (IMPLEMENT and REVIEW):

- [`/rigor:consistency-closure`](#rigorconsistency-closure): one canonical form, every site migrated, an enforcement added.
- [`/rigor:improve-measured`](#rigorimprove-measured): behavior-preserving improvements with a baseline, a result, and a delta.
- [`/rigor:fix-verified`](#rigorfix-verified): fix CONFIRMED bugs at root cause with a failing-to-passing regression test and a guard.
- [`/rigor:deep-review`](#rigordeep-review): review a PR or diff at the verification bar, blocking only on CONFIRMED defects and regressions.

Orchestrator:

- [`/rigor:rigor-sweep`](#rigorrigor-sweep): the whole suite end to end as a checkpointed pipeline.

---

## Foundation and discovery

### `/rigor:ground-truth`
**Mode:** AUDIT

**How it works.** Two phases:

- **Phase 0** detects the toolchain and notes what is missing: build and typecheck, linters, the test runner and coverage, the benchmark harness, the mutation tool, and the static analyzer. It checkpoints when the detection is ambiguous.
- **Phase 1** runs each tool and harvests its output as fact per `CONVENTIONS §C`. Compile and type errors, test failures, and flakes are CONFIRMED. It builds a coverage map of what is exercised and what is not, then produces a blind-spot list of low-coverage paths.

**Produces** `GROUND_TRUTH.md`, carrying the tool results, the coverage map, the blind-spot
list, and which lint and analyzer rules are already enforced. It also seeds unambiguous
CONFIRMED items into `FINDINGS_REGISTER.md` with proof.

**Why it's useful.** It establishes the deterministic baseline every other rigor skill
reconciles against. Later analysis never re-flags what a tool already enforces, and never
contradicts a green tool without a reproduction. It also names where coverage is thin, which
is exactly where hunting must be most careful.

**When to use it.** Run it first, before any other rigor skill. Reach for it whenever you
start a verification session on an unfamiliar repo or branch. Do not use it to find bugs by
reasoning, because it only runs and records the toolchain. Reasoning-based discovery is
`bug-hunt` and `quality-scan`.

**Prerequisites and hand-offs.** It needs no prior register. It hands the blind-spot list to
`safety-net` and the suite-trustworthiness question to `test-suite-audit`. Its
`GROUND_TRUTH.md` is read by `test-suite-audit`, `bug-hunt`, `quality-scan`, and
`improve-measured`.

---

### `/rigor:test-suite-audit`
**Mode:** AUDIT

**How it works.** Three phases:

- **Phase 0** scopes the run and reads the `GROUND_TRUTH.md` coverage map, at a checkpoint. The scope is the whole suite, or the modules you rely on as proofs, or the modules you intend to change.
- **Phase 1** establishes what "green" is worth. It runs the suite several times to flag flaky and nondeterministic tests, because a flaky green is not a green. It judges assertion strength, catching tests that execute much and assert little. It mutation-tests relied-upon code by injecting representative faults, or by running a mutation tool, to confirm the suite kills them. It cross-references coverage so the danger zone of high coverage and low kill rate is named.
- **Phase 2** hardens the gaps. It proposes targeted tests, writes the NOW-SAFE additions, and re-runs to confirm the kill rate improves.

**Produces** `TEST_SUITE_REPORT.md` with a trust map. Genuinely broken behavior surfaces into
`FINDINGS_REGISTER.md`.

**Why it's useful.** Proofs are only as strong as the suite under them (`CONVENTIONS §F`).
This skill tells you where a green suite detects faults and where it guards nothing, so
downstream reproductions and regression tests rest on tests that really catch faults.

**When to use it.** Run it right after `ground-truth`, before you rely on or change any code.
Use it when you need to trust existing tests as a proof. Do not use it to add
behavior-pinning coverage on untested code about to be refactored, which is `safety-net`.
This skill validates and hardens what already exists.

**Prerequisites and hand-offs.** It reads `GROUND_TRUTH.md`, so run `ground-truth` first. It
produces `TEST_SUITE_REPORT.md` and a trust map, and it adds hardening tests. The trust map
tells `bug-hunt`, `fix-verified`, and `deep-review` how much weight to place on "green".

---

### `/rigor:safety-net`
**Mode:** IMPLEMENT (adds tests only, changes no production code)

**How it works.** Two phases:

- **Phase 0** picks targets and confirms scope at a checkpoint. The targets are the blind spots from `GROUND_TRUTH.md`, the code queued for a fix, refactor, or improvement, and the high-risk modules.
- **Phase 1** writes characterization tests that capture current observable behavior, including current quirks, because these tests pin behavior rather than correctness. It runs them green against current code and exercises real edge and error inputs so the net is tight.

Behavior that looks wrong is not fixed here. It is recorded in `FINDINGS_REGISTER.md` as a
candidate for `bug-hunt` or `fix-verified`. The tests are committed and tagged so the
regression guard (`§H`) can find them. Each kept characterization test is pinned in
`PROOF_MANIFEST.md` through `check-proof-integrity.mjs record`, so a later fix batch
mechanically detects a weakened or deleted proof.

**Why it's useful.** It makes "behavior-preserving" provable. Locking current behavior before
anything is touched lets a refactor or a fix in a low-coverage area show that observable
behavior did not change. That gives the regression guard something concrete to protect.

**When to use it.** Run it before refactoring or fixing low-coverage code, especially the
blind spots `ground-truth` flagged. Do not use it to assess whether existing tests catch
faults, which is `test-suite-audit`. Do not fix bugs inside it. Log them and hand off.

**Prerequisites and hand-offs.** It runs best after `ground-truth`, for the blind-spot list.
It produces a tagged characterization test suite and suspicious-behavior findings in
`FINDINGS_REGISTER.md`. Its characterization tests join the proof set that `fix-verified`,
`improve-measured`, and `regression-hunt` re-run. `improve-measured` expects a safety net to
exist, and runs it first when one does not.

---

### `/rigor:bug-hunt`
**Mode:** AUDIT (reads and executes reproductions, no source fixes)

**How it works.** The flagship, in five phases:

- **Phase 0** scopes one component or subsystem, going deep rather than wide, and reads `GROUND_TRUTH.md` to avoid re-deriving facts. When that file is absent, it runs `ground-truth` first, which is the recommendation, or harvests the `§C` toolchain baseline for the scoped area itself. It never reasons ahead of the toolchain.
- **Phase 1** derives intent: the invariants, contracts, and assumptions the code must uphold.
- **Phase 2** hunts. It traces control and data flow end to end and probes the correctness lenses (`§7`): boundaries, null and empty, ordering, concurrency and races, error paths, state-machine and contract violations, resource lifecycle, integer and precision, time, and encoding. It generates adversarial inputs and uses an oracle where exact correctness is hard.
- **Phase 3** is the differentiator. It proves each candidate with a failing test or reproduction, which makes it CONFIRMED with the reproduction saved, or tiers it PROBABLE or SPECULATIVE. It then runs the disconfirmation pass (`§B`) and drops what dies. Every surviving fix-driving or blocking finding not already backed by a reproduction goes to an independent refutation (`§I`), where a fresh `tracer` that did not find it tries to kill it. A majority-REFUTED finding is dropped or downgraded to SPECULATIVE. Every reported finding is stamped with a verbatim **Anchor** (`§E`).
- **Phase 4** traces every CONFIRMED bug to its root cause and sweeps the codebase for siblings (`§G`).

**Produces** tiered entries in `FINDINGS_REGISTER.md` on schema `§6`, with reproduction tests
committed and a CONFIRMED-led summary. The run is not done until the finished register passes
`revalidate-register.mjs` clean. A non-FRESH citation is re-located against the real tree or
dropped.

**Why it's useful.** It returns real, proven bugs with runnable reproductions and the whole
class surfaced. It does not return a list of guesses you then have to triage. The
disconfirmation pass is the primary defense against false positives.

**When to use it.** Use it when you want bugs found and proven on your riskiest subsystem,
one subsystem at a time. Compared with `code-ops-suite:codebase-audit`, reach for
`rigor:bug-hunt` when you want a deep, proven, disconfirmed account of one subsystem, with
fewer findings and each CONFIRMED with a reproduction. Reach for the breadth audit when you
want wide coverage across a whole repo and will triage asserted findings yourself. Do not
point `bug-hunt` at an entire large repo at once, because that produces blind spots.

**Prerequisites and hand-offs.** It reads `GROUND_TRUTH.md`, so run `ground-truth` first. It
produces CONFIRMED, PROBABLE, and SPECULATIVE findings with saved reproductions in
`FINDINGS_REGISTER.md`, which `fix-verified` consumes. Pair it with `regression-hunt` to
bisect a confirmed bug to its origin commit.

---

### `/rigor:regression-hunt`
**Mode:** AUDIT (uses version-control history and executes reproductions)

**How it works.** Two phases:

- **Phase 0** scopes the target at a checkpoint. The target is a known behavior change to bisect to its origin, or the regressions introduced in the last N commits or since release X. It confirms the time range and what "correct" looked like before.
- **Phase 1** locates and confirms. For a known bug it writes a detecting test and bisects version-control history to the introducing commit, reporting the commit, the change, and why it caused the regression. For a recent-changes sweep it derives what recent commits altered, then runs the accumulated proof set and the characterization tests across them, looking for behavior and performance regressions and checking changed areas against the lenses. It also flags related areas the offending change touched or shares a root cause with.

**Produces** `REGRESSION_REPORT.md`, carrying the offending commits, the reproduction, the
blast radius, and the related areas. CONFIRMED findings go into `FINDINGS_REGISTER.md`. When
recent changes are clean, it says so with the evidence.

**Why it's useful.** It pinpoints when and why something broke, and it surfaces siblings that
may carry the same regression. The bisect plus the reproduction is the proof, so the finding
is CONFIRMED rather than asserted.

**When to use it.** Use it when something used to work and you need the introducing commit,
or after a release to sweep recent changes. It pairs best with `bug-hunt`, to bisect a
confirmed bug. Do not use it for first discovery of bugs with no known prior-good state,
which is `bug-hunt`.

**Prerequisites and hand-offs.** It needs version-control history. It benefits from an
existing proof set or characterization tests from `safety-net`, to run across the range. It
produces `REGRESSION_REPORT.md` and CONFIRMED findings for `fix-verified`.

---

### `/rigor:quality-scan`
**Mode:** AUDIT (reads, with light execution)

**How it works.** Two phases:

- **Phase 0** picks the area and reads `GROUND_TRUTH.md` at a checkpoint, so the scan skips what the linter and the type-checker already enforce. When that file is absent, it runs `ground-truth` first, or harvests the `§C` toolchain baseline itself before scanning.
- **Phase 1** hunts the defect-causing maintainability lenses (`§7`) that actually bite: complexity hotspots with a concrete metric, error-handling gaps such as swallowed errors and missing rollback, resource leaks such as unclosed handles and leaked timers, type-safety holes such as unsafe casts and unchecked nullability at boundaries, fragile coupling such as hidden temporal coupling and shared mutable state, and dead or duplicated code that hides intent.

Each item carries `file:line`, reachability and impact (`§D`), a tier (`§A`), and the
disconfirmation pass (`§B`). Low-confidence noise is suppressed or marked SPECULATIVE.

**Produces** `FINDINGS_REGISTER.md` entries ranked by demonstrated impact, each naming how it
could be enforced once fixed. The finished register must pass `revalidate-register.mjs` clean
before the run is done.

**Why it's useful.** It surfaces issues that cause defects or real maintenance pain, with
evidence and tiers, and it excludes cosmetic style, which is the formatter's job. You get a
short, high-signal list rather than padding.

**When to use it.** Use it when you want defect-causing quality problems, rather than deep
logic bugs, found with evidence. It complements `bug-hunt` in a discovery phase. Do not use
it for cosmetic cleanup, which is out of scope. Do not use it for deep correctness bugs that
need a derived-invariant trace, which is `bug-hunt`. Do not use it for closing divergent
implementations of one concept, which is `consistency-closure`.

**Prerequisites and hand-offs.** It reads `GROUND_TRUTH.md`, so run `ground-truth` first. It
produces tiered `FINDINGS_REGISTER.md` entries that feed `fix-verified` for defects, and that
may seed `consistency-closure` for divergence.

---

## Closure, improvement, fix, and review

### `/rigor:consistency-closure`
**Mode:** IMPLEMENT (closure changes are confirmed with you)

**How it works.** It follows the closure protocol `§9` in four phases:

- **Phase 0** scopes the concept space at a checkpoint. Examples are error handling, data access, validation, the naming of one idea, and API response shape.
- **Phase 1** inventories the variants, grouped by concept, each variant shown with `file:line`: divergent implementations of the same concept, drifted duplication, inconsistent return, error, and null conventions, contract drift across call sites, and inconsistent naming.
- **Phase 2** proposes one canonical form per group with a rationale. The developer approves before any migration, at an explicit checkpoint that is a real decision.
- **Phase 3** migrates every other site behavior-preservingly and conflict-aware, each site tested and committed. It then adds a mechanical enforcement (a lint rule, a codemod or CI check, a shared type, or a test) so the divergence cannot recur unnoticed, verifying nothing regressed through the regression guard `§H`.

**Produces** `CONSISTENCY_REGISTER.md` mapping concept to canonical form to sites migrated to
enforcement, plus the diffs and the enforcement config. The finished register must pass
`revalidate-register.mjs` clean before the run is done.

**Why it's useful.** "Closed" means the divergence is mechanically prevented from returning,
not fixed once. You get one canonical form, every site converged, and a guard that keeps it
that way.

**When to use it.** Use it when the same concept is implemented divergently and you want it
closed for good. Compared with `code-ops-suite:normalize`, reach for `consistency-closure` to
pick one canonical form for a specific concept, migrate every site, and add an enforcement at
the verification bar. Reach for `normalize` for whole-repo style normalization. Do not use it
to choose a canonical form without then adding the enforcement, because the enforcement is
the point.

**Prerequisites and hand-offs.** It may be seeded by divergence findings from `quality-scan`
or `bug-hunt`. It produces `CONSISTENCY_REGISTER.md` and the enforcement. Its migrations are
protected by the regression guard alongside the rest of the proof set.

---

### `/rigor:improve-measured`
**Mode:** IMPLEMENT (through the fix-prove-guard loop `§8`)

**How it works.** Three phases, under the rule that an unmeasured "before" cannot support a
claimed "after":

- **Phase 0** scopes the run and defines "better": runtime and latency, allocations or queries, complexity, bundle or footprint, removable code or dependencies, or API ergonomics. It reads `GROUND_TRUTH.md` and confirms a `safety-net` exists for the target, running it first when one does not, so behavior preservation is provable. This is a checkpoint.
- **Phase 1** baselines each candidate with a concrete measurement: a benchmark number, a complexity score, an allocation, query, or IO count, a bundle size, or the exact dead code or dependency to remove. It rejects speculative "feels cleaner" changes.
- **Phase 2** applies each change behavior-preservingly, keeping the full suite and the proof set green, then re-measures and records before, after, and delta. It rolls back any change whose delta does not justify it. Each behavior-adjacent or public-contract change is its own checkpoint.

**Produces** `IMPROVEMENTS_LOG.md`, with each change's baseline, result, delta, and proof.

**Why it's useful.** It ships only improvements with a measured win and preserved behavior,
never a speculative refactor. Every claim is backed by a before-and-after number.

**When to use it.** Use it when you want measured, behavior-preserving improvements with
deltas. Compared with `code-ops-suite:performance`, reach for `improve-measured` for measured,
behavior-preserving improvement across any axis at the verification bar, including complexity,
allocations, removable dependencies, and ergonomics. Reach for `performance` for
profiling-led hot-path optimization specifically. Do not use it for changes you cannot
measure, or for fixing bugs, which is `fix-verified`.

**Prerequisites and hand-offs.** It reads `GROUND_TRUTH.md` and expects a `safety-net` for the
target, running it when one is missing. It produces `IMPROVEMENTS_LOG.md` plus diffs and PRs.
Its changes are held green by the regression guard.

---

### `/rigor:fix-verified`
**Mode:** IMPLEMENT

**How it works.** Two phases, consuming `FINDINGS_REGISTER.md`. When the register is absent,
it stops and routes to `bug-hunt` to produce one, rather than synthesizing a register from
memory:

- **Phase 0** re-validates and sequences, at a checkpoint. It runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` as a fast staleness pre-filter (`§10`). For each CONFIRMED finding it confirms the reproduction still fails on current code, dropping or re-tiering what no longer reproduces. It replays any `RUN_RECEIPTS.md` with `run-proof.mjs verify` and checks `PROOF_MANIFEST.md` pins with `check-proof-integrity.mjs verify`. An exit-code mismatch or a tampered pinned proof drops or re-tiers the item before any fix. It then builds a dependency and conflict graph, sequences by demonstrated impact, and gets a direction first for NEEDS-DESIGN items.
- **Phase 1** runs the fix-prove-guard loop (`§8`) per item, conflict-aware across items. It confirms the failing reproduction, traces to root cause (`§G`), and makes the minimal correct fix at the right layer. The reproduction then passes and the full suite is green. The regression guard (`§H`) re-runs the entire accumulated proof set, never weakening a proof to pass. It runs the behavior-preservation check, sweeps for siblings, and adds an enforcement, meaning a kept regression test plus a type, lint, or assertion. It self-reviews, commits atomically referencing the finding ID and the proof, and updates the register.

If fixes start cascading, meaning three or more are guard-rejected or spawn new CONFIRMED
findings, the cascade circuit-breaker (`§H`) stops the loop and escalates the cluster as
NEEDS-DESIGN.

**Produces** atomic PRs, each carrying its failing-to-passing reproduction, plus
`IMPLEMENTATION_LOG.md` and the updated register. The register must pass
`revalidate-register.mjs --consumed <pre-run copy>`. No consumed item vanishes or closes
without a pinned terminal form: closed-with-proof, deferred-with-reason, or OBSOLETE-AT.

**Why it's useful.** It fixes the cause rather than the symptom. It proves the fix with a test
that failed before and passes now, sweeps the whole class, and guards against recurrence, so
fixes stay fixed.

**When to use it.** Use it when CONFIRMED bugs exist and you want them fixed with proof. It
fixes CONFIRMED items only. A PROBABLE item must be reproduced, and so promoted to CONFIRMED,
first. Do not use it to discover bugs, which is `bug-hunt`. Do not use it to make non-bug
improvements, which are `improve-measured` and `consistency-closure`.

**Prerequisites and hand-offs.** It consumes a `FINDINGS_REGISTER.md` of CONFIRMED items from
`bug-hunt`, `regression-hunt`, or `quality-scan`. It benefits from a `safety-net` and a
`test-suite-audit`, so behavior preservation and the proof set are trustworthy. It produces
fixes as PRs, `IMPLEMENTATION_LOG.md`, and an updated register. The always-gated categories
pause regardless of automation level (`§4`): security and auth, secrets, data migrations,
destructive operations, and public contracts.

---

### `/rigor:deep-review`
**Mode:** REVIEW (no changes unless asked)

**How it works.** Two phases plus an output step:

- **Phase 0** understands the change. It pulls the diff, its intent, and the surrounding code. It runs the `GROUND_TRUTH` tooling on the branch (typecheck, lint, tests) so the review starts from facts, and it fans out to the tracer and verifier subagents for large diffs. Changed exported symbols and shared contracts get their dependents traced, so ranking reflects demonstrated reach (`§D`) rather than diff size.
- **Phase 1** reviews against the correctness, failure-handling, consistency, and defect-causing-maintainability lenses (`§7`). Each concern is reproduced with a failing test or a trace where feasible, which makes it CONFIRMED, and otherwise tiered PROBABLE or SPECULATIVE. The disconfirmation pass (`§B`) runs on every concern. It checks that the change does not introduce an inconsistency, regress an existing enforcement or prior proof (`§H`), or land behavior without a test. It runs a quick bisect or history check when the change looks like it reverts a past fix.

**Produces** `file:line` comments grouped Blocking (a CONFIRMED defect or regression),
Should-fix (PROBABLE or quality), and Nit. It adds a verdict of approve, approve-with-nits, or
request-changes, plus a short risk read. Comments post to the PR when a version-control tool
is connected, and otherwise land in `REVIEW.md`. There is no tier inflation: it does not block
on a SPECULATIVE, and it does not wave through a CONFIRMED defect.

**Why it's useful.** It reviews a change at the verification bar, so a blocking comment means
a reproduced defect. The result is calibrated rather than opinion.

**When to use it.** Use it when you want a PR or diff reviewed with reproduced, tiered
concerns. Among the three review gates, `rigor:deep-review` is the high-rigor counterpart that
reproduces and tiers concerns and blocks only on CONFIRMED defects and regressions.
`code-ops-suite:pr-review` is the broad-coverage PR review.
`privacy-opsec-suite:opsec-pr-gate` is the anonymity and leak gate for projects with opsec
needs. Use `deep-review` when proof-grade review of correctness and regressions is what you
want. Do not use it to apply fixes, because it produces a review. Switch to `fix-verified` to
act on CONFIRMED items.

**Prerequisites and hand-offs.** It runs the `ground-truth` tooling itself on the branch. A
connected version-control tool lets it post PR comments. Wire it into CI on every PR with the
reviewed immutable action pin in
[`plugins/rigor/examples/github-deep-review.yml`](../../../../plugins/rigor/examples/github-deep-review.yml).
It hands CONFIRMED defects to `fix-verified`.

---

## Orchestrator

### `/rigor:rigor-sweep`
**Mode:** orchestrator

**How it works.** It orchestrates the other rigor skills in sequence as one
developer-in-the-loop pipeline, and it does not replace them. It carries the registers and a
growing proof set forward, keeps a master plan and a coverage map, and checks in at every
phase boundary:

- **Phase 0** scopes the run. It detects stack and size, confirms the track and the scope, opens a master todo, a running `EXECUTIVE_SUMMARY.md`, and a coverage map, and surfaces any CONFIRMED critical finding immediately. The tracks are `assess-only` for facts and proven findings with no code changes, `full` to also fix, close, and improve, or a custom subset.
- **Phase 1** runs `ground-truth`.
- **Phase 2** runs `test-suite-audit`.
- **Phase 3** finds read-only with proofs through `bug-hunt`, going deep per subsystem, and `quality-scan`, using `regression-hunt` to bisect any confirmed regression. It then checkpoints on the CONFIRMED-led register.
- **Phase 4** runs `safety-net` on blind spots and on anything queued for change.
- **Phase 5** runs `fix-verified` on CONFIRMED bugs. This phase writes code, requires approval, and checkpoints per batch.
- **Phase 6** runs `consistency-closure`.
- **Phase 7** optionally runs `improve-measured`.

The master `EXECUTIVE_SUMMARY.md` separates CONFIRMED from PROBABLE and SPECULATIVE, and
states coverage.

**Why it's useful.** It runs the whole verification suite end to end as a checkpointed
pipeline, with the proof set and the registers carried forward. Nothing code-changing happens
without approval, and the trustworthiness of the suite is established before fixes lean on it.

**When to use it.** Use it when you want the entire rigor suite on a repo or subsystem. Start
with `assess-only` to get proven findings before changing anything, then re-run `full`.
`rigor:rigor-sweep` is the intra-plugin orchestrator that runs only rigor's own skills end to
end, the same way each suite has its own orchestrator. The cross-plugin `everything`
orchestrator in `code-ops-suite` composes across plugins. Reach for `rigor-sweep` when the
work is purely verification-first, and for `everything` when you want breadth, rigor, and the
other layers composed in one pass. Do not use it as a substitute for pointing `bug-hunt` at
one subsystem when that is all you need.

**Prerequisites and hand-offs.** It drives all ten other rigor skills in order, and needs
whatever each phase needs. `regression-hunt` needs version-control history, and a connected
version-control tool matters only if you later review. It produces every per-skill artifact
plus the master `EXECUTIVE_SUMMARY.md`. The automation level set at the start governs every
code-changing step, with the always-gated categories per `§4`. The levels are `gated` by
default, then `auto-safe`, then `auto-all`.

---

*Verified-at: b0ffede*
