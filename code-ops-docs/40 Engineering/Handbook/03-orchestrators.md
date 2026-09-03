# Orchestrators: When to Use Which

> **Orientation (stop here if you only need the gist).** An *orchestrator* is a skill that runs other skills in a sensible order as one developer-in-the-loop pipeline. It does not replace the individual skills. It sequences them, carries the shared registers forward, keeps a master plan, and pauses at every phase boundary so you can steer. There are seven, across the four plugins:
>
> | If you want to… | Run this orchestrator | Plugin |
> | --- | --- | --- |
> | Implement one change end-to-end, proven and shipped clean | [`/code-ops-suite:ship`](#ship-code-ops-suite) | code-ops-suite |
> | Take a bug symptom to a proven root-cause fix | [`/code-ops-suite:debug`](#debug-code-ops-suite) | code-ops-suite |
> | Run the whole engineering suite on one repo | [`/code-ops-suite:full-sweep`](#full-sweep-code-ops-suite) | code-ops-suite |
> | Run the whole verification suite on one repo | [`/rigor:rigor-sweep`](#rigor-sweep-rigor) | rigor |
> | Run the whole anonymity and opsec suite on one repo | [`/privacy-opsec-suite:full-sweep`](#full-sweep-privacy-opsec-suite) | privacy-opsec-suite |
> | Run code-grounded research end-to-end (proposes, never edits) | [`/researcher:research-sweep`](#research-sweep-researcher) | researcher |
> | The most exhaustive cross-plugin pass there is | [`/code-ops-suite:everything`](#everything-code-ops-suite) | code-ops-suite |
>
> Every orchestrator is **checkpointed**. You set scope, track, and automation level at Phase 0, then approve or redirect at each phase boundary. None of them auto-merge. Pick the narrowest one that covers your goal, and see the [decision table](#decision-table-for-x-run-y) and [relative cost](#relative-cost-and-depth) at the end.

For the four-plugin mental model these orchestrators sit inside, see [02-mental-model.md](02-mental-model.md). For the registers they carry forward (`FINDINGS_REGISTER.md`, `LEAK_REGISTER.md`, `IDEAS_REGISTER.md`) and the freshness rules they obey, see [04-registers-and-freshness.md](04-registers-and-freshness.md). For evidence tiers (CONFIRMED, PROBABLE, SPECULATIVE) and the disconfirmation pass every find-phase applies, see [05-evidence-and-tiers.md](05-evidence-and-tiers.md). Each constituent skill is cataloged in [commands/README.md](commands/README.md).

---

## The shared shape

Every orchestrator here follows the same backbone, so once you have read one you can read the rest quickly:

- **Phase 0 is always a scoping checkpoint.** It detects the stack and size, confirms the *track* (assess-only or audit-only, full, or a custom subset of phases), and sets the **automation level**. The canonical ladder is defined in `code-ops-suite/CONVENTIONS.md §4`: `gated` *(default, pausing for approval at each batch)*, `auto-safe` *(auto-applying only NOW-SAFE items, each on a branch, test-backed, behavior-preserving, trivially revertible)*, or `auto-all` *(not recommended)*. Some categories are **always gated regardless of level**: security and auth changes, secret handling, data migrations or destructive operations, public API and contract changes, and anything irreversible.
- **Registers are the single source of truth and are kept fresh.** Before any phase consumes a finding, the orchestrator re-validates it against current HEAD. A finding fixed earlier in the run is stamped `OBSOLETE-AT <sha>` and never re-shown. See [04-registers-and-freshness.md](04-registers-and-freshness.md).
- **A running `EXECUTIVE_SUMMARY.md` spans the phases** and separates CONFIRMED from PROBABLE and SPECULATIVE at the end.
- **Developer-in-the-loop, never auto-merge.** Work happens on a branch, and even fully-automatic fixes land as commits or PRs for review.
- **The fix phase has a cascade circuit-breaker.** Whichever fix skill an orchestrator chains (`remediation`, `fix-verified`, `opsec-hardening`) carries the same guard. If three or more fixes in a run are rejected by the regression guard or spawn new CONFIRMED findings, the fix loop stops and the cluster is reclassified **NEEDS-DESIGN** at a checkpoint rather than patched further (`code-ops-suite/CONVENTIONS.md §11`, `rigor/CONVENTIONS.md §H`). A cascade is an architectural signal, not a bug collection.
- **Every write-phase climbs the code-economy ladder.** The implementation loop orders the objective (correctness and the safety floor, module boundaries, measured performance, readability, then size) and makes a change climb six rungs before new code is written. A deliberate simplification is marked `deferred(<ceiling>, <upgrade path>)`, and `co scan overbuild --git <range>` is the mechanical floor at the review boundary, advisory except on an unrecorded dependency.

The differences are *which* skills get chained, in *what* order, and *what prerequisites* must be installed.

### What runs underneath every orchestrator

Four bundled hooks compress the run itself, independent of which orchestrator you pick. The output digest (`CODE_OPS_DIGEST`), the symbol-index refresh (`CODE_OPS_INDEX`), and the ladder card (`CODE_OPS_LADDER_CARD`) are on by default, and each stops when its switch holds `off`, `0`, or `false` in the `env` block of a `.claude/settings.json`. A `SessionEnd` receipt records what the session cost and obeys `CODE_OPS_RECEIPTS` the same way. Read [12-context-and-code-economy.md](12-context-and-code-economy.md) for the mechanisms, [../../50 Platform/INFRASTRUCTURE.md](../../50 Platform/INFRASTRUCTURE.md) for the switch list, and [../../55 Operations/MEASUREMENTS.md](../../55 Operations/MEASUREMENTS.md) for the numbers.

---

## `full-sweep` (code-ops-suite)

**Invoked as `/code-ops-suite:full-sweep`.** One line: it chains the breadth-engineering suite (assess, safety-net, fix, polish, document) into one guided pipeline on a single codebase. It is the **intra-plugin** orchestrator for the spine. For the cross-plugin superset use [`everything`](#everything-code-ops-suite).

**Prerequisites:** `code-ops-suite` only.

**Phases** (from the skill):

| Phase | Skill(s) chained | Checkpoint |
| --- | --- | --- |
| 0, Scope the run | (sets track, scope, automation level, and opens `EXECUTIVE_SUMMARY.md`) | yes |
| 1, Ground truth | `doc-alignment` (skip if docs are known-current) | yes (drift summary, go or no-go) |
| 2, Assess (read-only) | `codebase-audit`, then `security-privacy-audit`, writing `FINDINGS_REGISTER.md` | yes (review ranked, CONFIRMED-led findings) |
| 3, Safety net | `test-hardening` on critical and risky paths | yes (coverage on targets, go or no-go) |
| 4, Fix (writes code) | `remediation` against the register, per automation level | per fix batch |
| 5, Deep-dives (optional) | `performance` and `dependency-upgrade` | as scoped |
| 6, Consistency | `normalize` (behavior-preserving) | yes (normalization log) |
| 7, Document | `doc-alignment` then the generators: `architecture`, `data-model`, `api-docs`, `ops-docs`, `adr`, `onboarding` | none |
| 8, Ship (optional) | `pr-split` (scrubs AI and tooling trace), opens PRs, never auto-merges | none |

A **separate feature track** exists for building rather than hardening: `feature-discovery`, then `feature-implementation`, then `pr-review`, shipped with `pr-split`. Drive it with `/code-ops-suite:full-sweep feature`.

**Track:** `assess-only` (read and document, no code changes), `full` (the whole chain), or a custom subset.

---

## `rigor-sweep` (rigor)

**Invoked as `/rigor:rigor-sweep`.** One line: it chains the whole verification suite (ground-truth, test-trust, prove, safety-net, fix, close, improve) under rigor's verification-first methodology, which is evidence tiers, the disconfirmation pass, ground truth first, root cause over symptom, and the regression guard. It is the **intra-plugin** orchestrator for the verification layer, and the high-signal counterpart to `full-sweep`.

**Prerequisites:** `rigor` only.

**Phases** (from the skill):

| Phase | Skill chained | Checkpoint |
| --- | --- | --- |
| 0, Scope the run | (sets track and scope, opens `EXECUTIVE_SUMMARY.md` and the coverage map) | yes |
| 1, Ground truth | `ground-truth` (deterministic toolchain, giving a factual baseline and blind-spot map) | none |
| 2, Trust the tests | `test-suite-audit` (flaky, assertion, and mutation check) | none |
| 3, Find (read-only, with proofs) | `bug-hunt` (deep, per subsystem, root cause plus sibling sweep) with `quality-scan`, and `regression-hunt` to bisect | yes (review CONFIRMED-led register) |
| 4, Safety net | `safety-net` on blind spots and anything queued for change | none |
| 5, Fix (writes code) | `fix-verified` on CONFIRMED bugs (failing-to-passing test, root cause, sibling sweep, guard, enforcement) | per batch |
| 6, Close inconsistencies | `consistency-closure` (canonical form, migrate, enforce) | none |
| 7, Improve (optional) | `improve-measured` (only changes with a before-and-after metric ship) | none |

**Track:** start `assess-only` (facts and proven findings, no code changes), `full` (also fix, close, improve), or a custom subset.

---

## `ship` (code-ops-suite)

**Invoked as `/code-ops-suite:ship`.** One line: implement **one** change, a feature or a one-off, end to end at full rigor, design-checked, proven with tests, privacy-gated, and shipped as a clean traceless PR. Mode is IMPLEMENT. It consumes an intent (ticket, request, or spec) and produces the change.

**Prerequisites: requires `rigor`** for the safety-net, proof, and regression-guard phases. The privacy phase runs only if `privacy-opsec-suite` is installed *and* the change touches a privacy surface. The traceless finish uses `code-ops-suite:pr-split` with `privacy-opsec-suite:authorship-hygiene`. If `privacy-opsec-suite` is absent, `ship` falls back to the bundled `scan-ai-tells.mjs` as the gate.

**Phases** (from the skill, scaled to the change: a one-off is a light pass, and a feature gets the full treatment):

| Phase | What it does | Checkpoint |
| --- | --- | --- |
| 0, Scope and design-check | `/rigor:ground-truth` baseline, size the change, for a feature confirm the approach, set automation level, and ask whether to run the opt-in model review gates | yes |
| 1, Safety net | `/rigor:safety-net` if the change touches thin-coverage code | none |
| 2, Implement | the implementation loop (`CONVENTIONS §11`): smallest correct change, matching conventions, climbing the code-economy ladder | none |
| 3, Prove | tests that fail before and pass after, full suite green, and the regression guard (`rigor §H`) | none |
| 4, Privacy gate (if applicable) | the `privacy-opsec-suite` gate: no new leak, egress, identifier, or fingerprint, and fail-closed preserved | none |
| 5, Finish traceless | `pr-split` for a stack, else a single PR scrubbed by `authorship-hygiene`, with `scan-ai-tells` passing fail-closed before push, and never auto-merge | none |

The model review gates are opt-in and rare. `ship` recommends them only for a high-risk surface (security, egress, data migrations, public contracts, gate scripts) or when you ask for a delegated review. Otherwise it ships on the deterministic gate chain plus your own read of the final diff.

---

## `debug` (code-ops-suite)

**Invoked as `/code-ops-suite:debug`.** One line: drive a bug **symptom** from reproduction to a root-cause fix at full rigor, which means reproduce, isolate, confirm the cause, then fix with a regression proof and ship traceless. Mode is IMPLEMENT. It consumes a symptom (error, stack trace, wrong behavior) and produces a root-cause fix with a failing-to-passing regression test.

**Prerequisites: requires `rigor`** for the reliable reproduction, the trace, `regression-hunt`, and the `fix-verified` loop. The privacy phase runs only if `privacy-opsec-suite` is installed and the fix touches a privacy surface.

**Phases** (from the skill):

| Phase | What it does | Checkpoint |
| --- | --- | --- |
| 0, Reproduce | capture the symptom, take a `/rigor:ground-truth` baseline, and build a reliable reproduction. If it cannot be reproduced, stop and report what is needed, and never guess | yes |
| 1, Isolate | trace the control and data path, derive invariants, narrow to the smallest triggering path, and run `/rigor:regression-hunt` to bisect if it is a regression | none |
| 2, Root-cause | identify the real cause at the correct layer, cited `file:line`, with a disconfirmation pass | yes (confirm before changing code) |
| 3, Fix with proof | the `rigor:fix-verified` loop: repro passes, suite green, regression guard holds, siblings swept, enforcement added | none |
| 4, Privacy gate (if applicable) | the `privacy-opsec-suite` leak gate, with fail-closed preserved | none |
| 5, Finish traceless | a clean PR scrubbed by `authorship-hygiene` (or `pr-split` if multi-part), `scan-ai-tells` fail-closed before push, and never auto-merge | none |

> `ship` and `debug` differ only in their *consumed input* and their first three phases. `ship` takes an *intent* and builds it. `debug` takes a *symptom* and chases its root cause. Both share the proof, privacy-gate, and traceless-finish tail, and both **require rigor**.

---

## `full-sweep` (privacy-opsec-suite)

**Invoked as `/privacy-opsec-suite:full-sweep`.** One line: it chains the whole anonymity and opsec track (threat-model, six parallel leak audits, harden, docs and gate) into one guided pipeline, with a defensive stance that protects the system's own users and fixes leaks in your own code. This pipeline is the **anonymity track**, relevant only for projects with anonymity or opsec needs.

**Prerequisites:** `privacy-opsec-suite` only.

**Phases** (from the skill):

| Phase | Skill(s) chained | Checkpoint |
| --- | --- | --- |
| 0, Scope the run | (sets track, adversaries to emphasize, PR preference, and opens `EXECUTIVE_SUMMARY.md`) | yes |
| 1, Model | `anonymity-threat-model` (adversaries, identifying and linking assets, deanonymization paths), the keystone everything references | yes (worst paths, go or no-go) |
| 2, Audit (read-only) | the six audits, parallelizing the independent ones: `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`, `traffic-analysis-resistance`, `supply-chain-trust`, writing `LEAK_REGISTER.md` | yes (ranked leaks, decide what to fix) |
| 3, Harden (writes code) | `opsec-hardening` against the register: enforce proxy routing and fail-closed, close DNS, WebRTC, and IPv6 leaks, stream isolation, strip metadata, redact logging, each leak pinned with a regression test | per batch |
| 4, Docs and gate | `privacy-doc-alignment` (reconcile promises, threat model, and runbooks into the SSOT), then wire `opsec-pr-gate` into review | none |

A **separate incident path** exists when a leak is *suspected* rather than sought. Start with `leak-incident-response` (triage, contain, scope, plan) and feed its output into the same `LEAK_REGISTER.md`.

**Track:** `audit-only` (read and document, no code changes), `full` (audit, harden, docs and gate), or a custom subset.

---

## `research-sweep` (researcher)

**Invoked as `/researcher:research-sweep`.** One line: run code-grounded research end to end (ground, gather, verify, propose), local-first with opt-in, disclosed web egress, producing the consolidated registers plus an executive summary. This pipeline is the **proposal layer**: it researches and proposes registers and design briefs, then **hands off** to the other three plugins. It never edits code.

**Prerequisites: nothing beyond the `researcher` plugin.** It composes `code-ops-suite`, `rigor`, and `privacy-opsec-suite` skills only when installed, and only as **hand-off targets** for proposals rather than as build steps. The documentation lookup is local-first. Web research is opt-in and runs only through the composed deep-research skill behind a checkpoint.

**Phases** (from the skill):

| Phase | What it does | Checkpoint |
| --- | --- | --- |
| 0, Scope and egress permission | choose modes and order, set scope and hand-off targets, **decide egress** (local-first by default, web off unless granted here), and initialize `EGRESS_MANIFEST.md` | yes, and a hard CHECKPOINT before any network egress |
| 1, Ground in our code (zero egress) | map architecture, constraints, and in-repo prior art, verify facts against installed-version docs, and pull VCS history for *why* | yes (the grounded picture and open questions) |
| 2, Gather | run selected discovery skills read-only: `research-improve`, `research-ideate`, `library-eval`, `research-spike`, `ecosystem-watch`, writing `RESEARCH_FINDINGS.md` and `IDEAS_REGISTER.md`, with every external request recorded | yes (raw registers **and the manifest**) |
| 3, Verify | `research-verify` over every load-bearing claim, adversarially, re-tiering on the evidence and dropping the unsupported | yes (verified, re-tiered registers) |
| 4, Propose and hand off | rank by value times reach divided by effort, and map each item to its implementer skill (remediation, fix-verified, feature-*, adr, improve-measured, dependency-upgrade, supply-chain-trust) | yes (hand-off-ready registers and briefs) |
| 5, Consolidate | one `EXECUTIVE_SUMMARY.md`, a final self-audit, and `research-manifest.mjs validate` fail-closed on each published artifact | final (validate before publish) |

> The fail-closed egress discipline is the distinctive part. No web request happens before you approve it at Phase 0, every request is logged in `EGRESS_MANIFEST.md`, and `research-manifest.mjs validate` blocks any artifact that cites an un-manifested source, exiting non-zero.

---

## `everything` (code-ops-suite)

**Invoked as `/code-ops-suite:everything`.** One line: the most exhaustive end-to-end pass there is (map, ground-truth, prove, leak-audit, safety-net, fix, close, improve, document), deduplicated across all three engineering plugins, carrying every register and a growing **proof set** forward. It is the **cross-plugin superset**. It does not replace the individual skills or the intra-plugin sweeps, and it sequences all of them in the right order.

**Prerequisites: requires `code-ops-suite`, `rigor`, AND `privacy-opsec-suite` all installed.** It is the only orchestrator that needs all three. The privacy phases (Phase 4) run only if the project has anonymity or opsec requirements and you keep them in scope at Phase 0.

**Phases** (from the skill):

| Phase | Skill(s) chained | Plugin | Checkpoint |
| --- | --- | --- | --- |
| 0, Scope, automation level, and preflight | confirm all three plugins, set scope, privacy track, automation level, and check-in level, and open the master registers and proof set | none | yes |
| 1, Map | `doc-alignment`, `codebase-audit`, `security-privacy-audit` | code-ops-suite | none |
| 2, Ground truth and test trust | `ground-truth`, `test-suite-audit` | rigor | none |
| 3, Prove | `bug-hunt` (deep, per subsystem) with `quality-scan`, and `regression-hunt` to bisect | rigor | none |
| 4, Anonymity and leak audits (if in scope) | `anonymity-threat-model`, then `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`, `traffic-analysis-resistance`, `supply-chain-trust`, writing `LEAK_REGISTER.md` | privacy-opsec-suite | none |
| 5, Safety net | `safety-net` (characterization tests on blind spots and queued changes) | rigor | none |
| 6, Consolidated review | re-validate every register against HEAD, and present one prioritized, CONFIRMED-led picture and plan | none | **yes, the main go or no-go** |
| 7, Remediate | `fix-verified`, `remediation`, and `opsec-hardening`, per automation level | rigor, code-ops, privacy | per batch |
| 8, Close inconsistencies | `consistency-closure` | rigor | none |
| 9, Improve | `improve-measured`, `performance`, and `dependency-upgrade` (measured deltas only) | rigor, code-ops | none |
| 10, Normalize and document | `normalize`, `doc-alignment`, and the generators (`architecture`, `data-model`, `api-docs`, `ops-docs`, `adr`, `onboarding`) | code-ops-suite | none |
| 11, Final verification, report, and ship | full suite and proof set green, master `EXECUTIVE_SUMMARY.md`, note the PR gates (`rigor:deep-review`, `privacy-opsec-suite:opsec-pr-gate`), `pr-split` (running `authorship-hygiene` fail-closed) if shipping, and never auto-merge | none | none |

**Check-in level** is set at Phase 0, either *normal* (per phase) or *minimal* (only at the consolidated review plus always-gated items).

### The `everything` phase flow

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant CO as code-ops-suite
    participant RG as rigor
    participant PO as privacy-opsec-suite

    Dev->>CO: Phase 0, scope, automation level, preflight (checkpoint)
    CO-->>Dev: scope + plugins confirmed
    CO->>CO: Phase 1, Map (doc-alignment, codebase-audit, security-privacy-audit)
    CO->>RG: Phase 2, Ground truth & test trust (ground-truth, test-suite-audit)
    RG->>RG: Phase 3, Prove (bug-hunt + quality-scan, regression-hunt)
    opt privacy in scope
        RG->>PO: Phase 4, Anonymity & leak audits (threat-model + 6 audits)
        PO-->>RG: LEAK_REGISTER.md
    end
    RG->>RG: Phase 5, Safety net (characterization tests)
    RG-->>Dev: Phase 6, Consolidated review (the main go/no-go)
    Dev-->>RG: approve remediation plan + automation level
    RG->>CO: Phase 7, Remediate (fix-verified + remediation + opsec-hardening)
    RG->>RG: Phase 8, Close inconsistencies (consistency-closure)
    RG->>CO: Phase 9, Improve (improve-measured + performance + dependency-upgrade)
    CO->>CO: Phase 10, Normalize & document (normalize + generators)
    CO-->>Dev: Phase 11, Final verification, report; pr-split + authorship-hygiene (never auto-merge)
```

---

## Decision table: "for X, run Y"

| Your situation | Run | Why |
| --- | --- | --- |
| One ticket or spec to implement, proven and shipped | `/code-ops-suite:ship` | scoped IMPLEMENT pass, needs `rigor` |
| A bug symptom to chase to its root cause | `/code-ops-suite:debug` | reproduce, isolate, root-cause, fix, needs `rigor` |
| Harden one whole repo (breadth, not depth-proofs) | `/code-ops-suite:full-sweep` | assess, safety-net, fix, polish, document |
| Build a feature with discovery and review | `/code-ops-suite:full-sweep feature` | the feature track of full-sweep |
| Prove the state of a repo with high signal | `/rigor:rigor-sweep` | verification-first, with tiers, disconfirmation, and the regression guard |
| Audit or harden an anonymity-sensitive or opsec-sensitive repo | `/privacy-opsec-suite:full-sweep` | threat-model, leak audits, harden, gate |
| A leak is *suspected* right now | `privacy-opsec-suite:leak-incident-response` | triage, contain, scope, plan, feeding the leak register |
| Decide what to do or what to adopt, with no code yet | `/researcher:research-sweep` | proposes registers and briefs, hands off, never edits |
| The deepest possible end-to-end pass on a critical repo | `/code-ops-suite:everything` | cross-plugin superset, needs all three engineering plugins |

When two fit, prefer the **narrowest**: a single skill over an intra-plugin sweep, and an intra-plugin sweep over `everything`.

---

## Relative cost and depth

Cost is expressed only in relative terms, with no token numbers, because actual cost scales with repo size, scope, and the check-in level set at Phase 0.

```
everything  >  full-sweep  ≈  rigor-sweep  ≈  privacy full-sweep  ≈  research-sweep  >  ship / debug  >  a single skill
(all 3 plugins)        (one plugin, whole suite)                                    (one scoped change)   (one task)
```

- **`everything` is the most thorough and most token-expensive option**, deliberately so. It runs the supersets of all three engineering plugins, deduplicated, with a single consolidated go or no-go review. Reach for it only on a critical repo, and narrow scope at Phase 0 to the riskiest subsystems first on a large one.
- **The four whole-suite sweeps** (`full-sweep` twice, `rigor-sweep`, `research-sweep`) sit a tier below, because each runs one plugin's full chain end to end. They are roughly comparable to one another in shape. The actual cost depends on track, where assess-only or audit-only is far cheaper than full, and on repo size.
- **`ship` and `debug`** are scoped to a *single* change or symptom, so they are much cheaper than a sweep even though each phase is run at full rigor.
- **A single skill** (for example `codebase-audit`, `bug-hunt`, or `tor-egress-audit`) is the cheapest unit. The orchestrators exist to chain these when one is not enough.

Every level above a single skill is checkpointed, so you can dial depth and check-in frequency down at Phase 0 and stop at any boundary. Cost is a control you hold, not a fixed price.

Two tools make the control concrete. `co run cost --runs <dir>` estimates a run before you start it, reading the dispatch ledgers of prior runs and printing dispatch counts rather than a price. `co context audit receipts --by-arm` reports what past sessions actually cost, grouped by which context mechanisms were on. The recorded numbers live in [../../55 Operations/MEASUREMENTS.md](../../55 Operations/MEASUREMENTS.md), and [09-cost-and-scoping.md](09-cost-and-scoping.md) turns them into scoping decisions.

---

*Verified-at: b0ffede*
