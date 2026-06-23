# Orchestrators — When to Use Which

> **Orientation (stop here if you only need the gist).** An *orchestrator* is a skill that runs other skills in a sensible order as one developer-in-the-loop pipeline. It does not replace the individual skills — it sequences them, carries the shared registers forward, keeps a master plan, and pauses at every phase boundary so you can steer. There are seven, across the four plugins:
>
> | If you want to… | Run this orchestrator | Plugin |
> | --- | --- | --- |
> | Implement one change end-to-end, proven and shipped clean | [`/code-ops-suite:ship`](#ship-code-ops-suite) | code-ops-suite |
> | Take a bug symptom to a proven root-cause fix | [`/code-ops-suite:debug`](#debug-code-ops-suite) | code-ops-suite |
> | Run the whole engineering suite on one repo | [`/code-ops-suite:full-sweep`](#full-sweep-code-ops-suite) | code-ops-suite |
> | Run the whole verification suite on one repo | [`/rigor:rigor-sweep`](#rigor-sweep-rigor) | rigor |
> | Run the whole anonymity/opsec suite on one repo | [`/privacy-opsec-suite:full-sweep`](#full-sweep-privacy-opsec-suite) | privacy-opsec-suite |
> | Run code-grounded research end-to-end (proposes, never edits) | [`/researcher:research-sweep`](#research-sweep-researcher) | researcher |
> | The most exhaustive cross-plugin pass there is | [`/code-ops-suite:everything`](#everything-code-ops-suite) | code-ops-suite |
>
> Every orchestrator is **checkpointed**: you set scope, track, and automation level at Phase 0, then approve (or redirect) at each phase boundary. None of them auto-merge. Pick the narrowest one that covers your goal — see the [decision table](#decision-table-for-x-run-y) and [relative cost](#relative-cost-and-depth) at the end.

For the four-plugin mental model these orchestrators sit inside, see [02-mental-model.md](02-mental-model.md). For the registers they carry forward (`FINDINGS_REGISTER.md`, `LEAK_REGISTER.md`, `IDEAS_REGISTER.md`) and the freshness rules they obey, see [04-registers-and-freshness.md](04-registers-and-freshness.md). For evidence tiers (CONFIRMED / PROBABLE / SPECULATIVE) and the disconfirmation pass every find-phase applies, see [05-evidence-and-tiers.md](05-evidence-and-tiers.md). Each constituent skill is cataloged in [commands/README.md](commands/README.md).

---

## The shared shape

Every orchestrator here follows the same backbone, so once you have read one you can read the rest quickly:

- **Phase 0 is always a scoping checkpoint.** It detects the stack and size, confirms the *track* (assess/audit-only vs. full vs. a custom subset of phases), and sets the **automation level** — the canonical ladder defined in `code-ops-suite/CONVENTIONS.md §4`: `gated` *(default — pause for approval at each batch)*, `auto-safe` *(auto-apply only NOW-SAFE items — each on a branch, test-backed, behavior-preserving, trivially revertible)*, or `auto-all` *(not recommended)*. Some categories are **always gated regardless of level**: security/auth changes, secret handling, data migrations or destructive operations, public API/contract changes, and anything irreversible.
- **Registers are the single source of truth and are kept fresh.** Before any phase consumes a finding, the orchestrator re-validates it against current HEAD; a finding fixed earlier in the run is stamped `OBSOLETE-AT <sha>` and never re-shown. See [04-registers-and-freshness.md](04-registers-and-freshness.md).
- **A running `EXECUTIVE_SUMMARY.md` spans the phases** and separates CONFIRMED from PROBABLE/SPECULATIVE at the end.
- **Developer-in-the-loop, never auto-merge.** Work happens on a branch; even fully-automatic fixes land as commits/PRs for review.

The differences are *which* skills get chained, in *what* order, and *what prerequisites* must be installed.

---

## `full-sweep` (code-ops-suite)

**Invoked as `/code-ops-suite:full-sweep`.** One line: it chains the breadth-engineering suite — assess → safety-net → fix → polish → document — into one guided pipeline on a single codebase. It is the **intra-plugin** orchestrator for the spine; for the cross-plugin superset use [`everything`](#everything-code-ops-suite).

**Prerequisites:** `code-ops-suite` only.

**Phases** (from the skill):

| Phase | Skill(s) chained | Checkpoint |
| --- | --- | --- |
| 0 — Scope the run | (sets track, scope, automation level; opens `EXECUTIVE_SUMMARY.md`) | yes |
| 1 — Ground truth | `doc-alignment` (skip if docs are known-current) | yes (drift summary, go/no-go) |
| 2 — Assess (read-only) | `codebase-audit` → `security-privacy-audit` → `FINDINGS_REGISTER.md` | yes (review ranked, CONFIRMED-led findings) |
| 3 — Safety net | `test-hardening` on critical/risky paths | yes (coverage on targets, go/no-go) |
| 4 — Fix (writes code) | `remediation` against the register, per automation level | per fix batch |
| 5 — Deep-dives (optional) | `performance` and/or `dependency-upgrade` | as scoped |
| 6 — Consistency | `normalize` (behavior-preserving) | yes (normalization log) |
| 7 — Document | `doc-alignment` then the generators: `architecture` · `data-model` · `api-docs` · `ops-docs` · `adr` · `onboarding` | — |
| 8 — Ship (optional) | `pr-split` (scrubs AI/tooling trace), opens PRs, never auto-merges | — |

A **separate feature track** exists for building rather than hardening: `feature-discovery` → `feature-implementation` → `pr-review`, shipped with `pr-split`. Drive it with `/code-ops-suite:full-sweep feature`.

**Track:** `assess-only` (read + document, no code changes) · `full` (the whole chain) · or a custom subset.

---

## `rigor-sweep` (rigor)

**Invoked as `/rigor:rigor-sweep`.** One line: it chains the whole verification suite — ground-truth → test-trust → prove → safety-net → fix → close → improve — under rigor's verification-first methodology (evidence tiers, the disconfirmation pass, ground-truth-first, root-cause-over-symptom, the regression guard). It is the **intra-plugin** orchestrator for the verification layer, and the high-signal counterpart to `full-sweep`.

**Prerequisites:** `rigor` only.

**Phases** (from the skill):

| Phase | Skill chained | Checkpoint |
| --- | --- | --- |
| 0 — Scope the run | (sets track + scope; opens `EXECUTIVE_SUMMARY.md` + coverage map) | yes |
| 1 — Ground truth | `ground-truth` (deterministic toolchain → factual baseline + blind-spot map) | — |
| 2 — Trust the tests | `test-suite-audit` (flaky/assertion/mutation check) | — |
| 3 — Find (read-only, with proofs) | `bug-hunt` (deep, per subsystem; root cause + sibling sweep) + `quality-scan`; `regression-hunt` to bisect | yes (review CONFIRMED-led register) |
| 4 — Safety net | `safety-net` on blind spots and anything queued for change | — |
| 5 — Fix (writes code) | `fix-verified` on CONFIRMED bugs (failing→passing test, root cause, sibling sweep, guard, enforcement) | per batch |
| 6 — Close inconsistencies | `consistency-closure` (canonical form → migrate → enforce) | — |
| 7 — Improve (optional) | `improve-measured` (only changes with a before/after metric ship) | — |

**Track:** start `assess-only` (facts + proven findings, no code changes) · `full` (also fix/close/improve) · or a custom subset.

---

## `ship` (code-ops-suite)

**Invoked as `/code-ops-suite:ship`.** One line: implement **one** change — a feature or a one-off — end-to-end at full rigor: design-checked, proven with tests, privacy-gated, and shipped as a clean traceless PR. Mode is IMPLEMENT; it consumes an intent (ticket, request, or spec) and produces the change.

**Prerequisites: requires `rigor`** (for the safety-net, proof, and regression-guard phases). The privacy phase runs only if `privacy-opsec-suite` is installed *and* the change touches a privacy surface. The traceless finish uses `code-ops-suite:pr-split` + `privacy-opsec-suite:authorship-hygiene`; if `privacy-opsec-suite` is absent, `ship` falls back to the bundled `scan-ai-tells.mjs` as the gate.

**Phases** (from the skill — scaled to the change; a one-off is a light pass, a feature gets the full treatment):

| Phase | What it does | Checkpoint |
| --- | --- | --- |
| 0 — Scope & design-check | `/rigor:ground-truth` baseline; size the change; for a feature confirm the approach; set automation level | yes |
| 1 — Safety net | `/rigor:safety-net` if the change touches thin-coverage code | — |
| 2 — Implement | the implementation loop (`CONVENTIONS §11`): smallest correct change, matching conventions | — |
| 3 — Prove | tests that fail before / pass after; full suite green; the regression guard (`rigor §H`) | — |
| 4 — Privacy gate (if applicable) | the `privacy-opsec-suite` gate: no new leak/egress/identifier/fingerprint, fail-closed preserved | — |
| 5 — Finish traceless | `pr-split` for a stack, else a single PR scrubbed by `authorship-hygiene`; `scan-ai-tells` passes fail-closed before push; never auto-merge | — |

---

## `debug` (code-ops-suite)

**Invoked as `/code-ops-suite:debug`.** One line: drive a bug **symptom** from reproduction to a root-cause fix at full rigor — reproduce, isolate, confirm the cause, then fix with a regression proof and ship traceless. Mode is IMPLEMENT; it consumes a symptom (error, stack trace, wrong behavior) and produces a root-cause fix with a failing→passing regression test.

**Prerequisites: requires `rigor`** (for the reliable reproduction, the trace, `regression-hunt`, and the `fix-verified` loop). The privacy phase runs only if `privacy-opsec-suite` is installed and the fix touches a privacy surface.

**Phases** (from the skill):

| Phase | What it does | Checkpoint |
| --- | --- | --- |
| 0 — Reproduce | capture the symptom; `/rigor:ground-truth` baseline; build a reliable reproduction. If it can't be reproduced, stop and report what's needed — never guess | yes |
| 1 — Isolate | trace the control/data path; derive invariants; narrow to the smallest triggering path; `/rigor:regression-hunt` to bisect if it's a regression | — |
| 2 — Root-cause | identify the real cause at the correct layer, cited `file:line`, with a disconfirmation pass | yes (confirm before changing code) |
| 3 — Fix with proof | the `rigor:fix-verified` loop: repro passes, suite green, regression guard holds, sweep siblings, add enforcement | — |
| 4 — Privacy gate (if applicable) | the `privacy-opsec-suite` leak gate; fail-closed preserved | — |
| 5 — Finish traceless | clean PR scrubbed by `authorship-hygiene` (or `pr-split` if multi-part); `scan-ai-tells` fail-closed before push; never auto-merge | — |

> `ship` and `debug` differ only in their *consumed input* and their first three phases: `ship` takes an *intent* and builds it; `debug` takes a *symptom* and chases its root cause. Both share the proof → privacy-gate → traceless-finish tail, and both **require rigor**.

---

## `full-sweep` (privacy-opsec-suite)

**Invoked as `/privacy-opsec-suite:full-sweep`.** One line: it chains the whole anonymity/opsec track — threat-model → six parallel leak audits → harden → docs/gate — into one guided pipeline, with a defensive stance (protect the system's own users; find and fix leaks in your own code). This is the **anonymity track**, relevant only for projects with anonymity/opsec needs.

**Prerequisites:** `privacy-opsec-suite` only.

**Phases** (from the skill):

| Phase | Skill(s) chained | Checkpoint |
| --- | --- | --- |
| 0 — Scope the run | (sets track, adversaries to emphasize, PR preference; opens `EXECUTIVE_SUMMARY.md`) | yes |
| 1 — Model | `anonymity-threat-model` (adversaries, identifying/linking assets, deanonymization paths) — the keystone everything references | yes (worst paths, go/no-go) |
| 2 — Audit (read-only) | the six audits, parallelizing the independent ones: `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`, `traffic-analysis-resistance`, `supply-chain-trust` → `LEAK_REGISTER.md` | yes (ranked leaks; decide what to fix) |
| 3 — Harden (writes code) | `opsec-hardening` against the register: enforce proxy routing + fail-closed, close DNS/WebRTC/IPv6 leaks, stream isolation, strip metadata, redact logging — each leak pinned with a regression test | per batch |
| 4 — Docs & gate | `privacy-doc-alignment` (reconcile promises/threat-model/runbooks; SSOT), then wire `opsec-pr-gate` into review | — |

A **separate incident path** exists when a leak is *suspected* rather than sought: start with `leak-incident-response` (triage → contain → scope → plan) and feed its output into the same `LEAK_REGISTER.md`.

**Track:** `audit-only` (read + document, no code changes) · `full` (audit → harden → docs/gate) · or a custom subset.

---

## `research-sweep` (researcher)

**Invoked as `/researcher:research-sweep`.** One line: run code-grounded research end-to-end — ground → gather → verify → propose — local-first with opt-in, disclosed web egress; it produces the consolidated registers plus an executive summary. This is the **proposal layer**: it researches and proposes (registers + design briefs) and **hands off** to the other three plugins. It never edits code.

**Prerequisites: nothing beyond the `researcher` plugin.** It composes `code-ops-suite` / `rigor` / `privacy-opsec-suite` skills only when installed, and only as **hand-off targets** for proposals (not as build steps). The documentation lookup is local-first; web research is opt-in and runs only through the composed deep-research skill behind a checkpoint.

**Phases** (from the skill):

| Phase | What it does | Checkpoint |
| --- | --- | --- |
| 0 — Scope & egress permission | choose modes and order; set scope and hand-off targets; **decide egress** (local-first by default; web off unless granted here); initialize `EGRESS_MANIFEST.md` | yes — and a hard CHECKPOINT before any network egress |
| 1 — Ground in our code (zero egress) | map architecture, constraints, and in-repo prior art; verify facts against installed-version docs; pull VCS history for *why* | yes (the grounded picture + open questions) |
| 2 — Gather | run selected discovery skills read-only: `research-improve`, `research-ideate`, `library-eval`, `research-spike`, `ecosystem-watch` → `RESEARCH_FINDINGS.md` + `IDEAS_REGISTER.md`; every external request recorded | yes (raw registers **+ the manifest**) |
| 3 — Verify | `research-verify` over every load-bearing claim, adversarially; re-tier on the evidence; drop the unsupported | yes (verified, re-tiered registers) |
| 4 — Propose & hand off | rank by value × reach ÷ effort; map each item to its implementer skill (remediation / fix-verified / feature-* / adr / improve-measured / dependency-upgrade / supply-chain-trust) | yes (hand-off-ready registers + briefs) |
| 5 — Consolidate | one `EXECUTIVE_SUMMARY.md`; final self-audit; `research-manifest.mjs validate` fail-closed on each published artifact | final (validate before publish) |

> The fail-closed egress discipline is the distinctive part: no web request happens before you approve it at Phase 0, every request is logged in `EGRESS_MANIFEST.md`, and `research-manifest.mjs validate` blocks (non-zero exit) any artifact that cites an un-manifested source.

---

## `everything` (code-ops-suite)

**Invoked as `/code-ops-suite:everything`.** One line: the most exhaustive end-to-end pass there is — map → ground-truth → prove → leak-audit → safety-net → fix → close → improve → document — deduplicated across all three engineering plugins, carrying every register and a growing **proof set** forward. It is the **cross-plugin superset**: it does not replace the individual skills or the intra-plugin sweeps, it sequences all of them in the right order.

**Prerequisites: requires `code-ops-suite`, `rigor`, AND `privacy-opsec-suite` all installed** — it is the only orchestrator that needs all three. The privacy phases (Phase 4) run only if the project has anonymity/opsec requirements and you keep them in scope at Phase 0.

**Phases** (from the skill):

| Phase | Skill(s) chained | Plugin | Checkpoint |
| --- | --- | --- | --- |
| 0 — Scope, automation level & preflight | confirm all three plugins; set scope, privacy track, automation level, check-in level; open the master registers + proof set | — | yes |
| 1 — Map | `doc-alignment` → `codebase-audit` → `security-privacy-audit` | code-ops-suite | — |
| 2 — Ground truth & test trust | `ground-truth` → `test-suite-audit` | rigor | — |
| 3 — Prove | `bug-hunt` (deep, per subsystem) + `quality-scan`; `regression-hunt` to bisect | rigor | — |
| 4 — Anonymity & leak audits (if in scope) | `anonymity-threat-model` → `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`, `traffic-analysis-resistance`, `supply-chain-trust` → `LEAK_REGISTER.md` | privacy-opsec-suite | — |
| 5 — Safety net | `safety-net` (characterization tests on blind spots + queued changes) | rigor | — |
| 6 — Consolidated review | re-validate every register vs. HEAD; present one prioritized, CONFIRMED-led picture + plan | — | **yes — the main go/no-go** |
| 7 — Remediate | `fix-verified` + `remediation` + `opsec-hardening`, per automation level | rigor / code-ops / privacy | per batch |
| 8 — Close inconsistencies | `consistency-closure` | rigor | — |
| 9 — Improve | `improve-measured` + `performance` + `dependency-upgrade` (measured deltas only) | rigor / code-ops | — |
| 10 — Normalize & document | `normalize` + `doc-alignment` + the generators (`architecture` · `data-model` · `api-docs` · `ops-docs` · `adr` · `onboarding`) | code-ops-suite | — |
| 11 — Final verification, report & ship | full suite + proof set green; master `EXECUTIVE_SUMMARY.md`; note PR gates (`rigor:deep-review`, `privacy-opsec-suite:opsec-pr-gate`); `pr-split` (runs `authorship-hygiene` fail-closed) if shipping; never auto-merge | — | — |

**Check-in level** is set at Phase 0: *normal* (per phase) or *minimal* (only at the consolidated review + always-gated items).

### The `everything` phase flow

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer
    participant CO as code-ops-suite
    participant RG as rigor
    participant PO as privacy-opsec-suite

    Dev->>CO: Phase 0 — scope, automation level, preflight (checkpoint)
    CO-->>Dev: scope + plugins confirmed
    CO->>CO: Phase 1 — Map (doc-alignment, codebase-audit, security-privacy-audit)
    CO->>RG: Phase 2 — Ground truth & test trust (ground-truth, test-suite-audit)
    RG->>RG: Phase 3 — Prove (bug-hunt + quality-scan, regression-hunt)
    opt privacy in scope
        RG->>PO: Phase 4 — Anonymity & leak audits (threat-model + 6 audits)
        PO-->>RG: LEAK_REGISTER.md
    end
    RG->>RG: Phase 5 — Safety net (characterization tests)
    RG-->>Dev: Phase 6 — Consolidated review (the main go/no-go)
    Dev-->>RG: approve remediation plan + automation level
    RG->>CO: Phase 7 — Remediate (fix-verified + remediation + opsec-hardening)
    RG->>RG: Phase 8 — Close inconsistencies (consistency-closure)
    RG->>CO: Phase 9 — Improve (improve-measured + performance + dependency-upgrade)
    CO->>CO: Phase 10 — Normalize & document (normalize + generators)
    CO-->>Dev: Phase 11 — Final verification, report; pr-split + authorship-hygiene (never auto-merge)
```

---

## Decision table: "for X, run Y"

| Your situation | Run | Why |
| --- | --- | --- |
| One ticket/spec to implement, proven and shipped | `/code-ops-suite:ship` | scoped IMPLEMENT pass; needs `rigor` |
| A bug symptom to chase to its root cause | `/code-ops-suite:debug` | reproduce → isolate → root-cause → fix; needs `rigor` |
| Harden one whole repo (breadth, not depth-proofs) | `/code-ops-suite:full-sweep` | assess → safety-net → fix → polish → document |
| Build a feature with discovery + review | `/code-ops-suite:full-sweep feature` | the feature track of full-sweep |
| Prove the state of a repo with high signal | `/rigor:rigor-sweep` | verification-first; tiers + disconfirmation + regression guard |
| Audit/harden an anonymity- or opsec-sensitive repo | `/privacy-opsec-suite:full-sweep` | threat-model → leak audits → harden → gate |
| A leak is *suspected* right now | `privacy-opsec-suite:leak-incident-response` | triage → contain → scope → plan (feeds the leak register) |
| Decide what to do / what to adopt, no code yet | `/researcher:research-sweep` | proposes registers + briefs, hands off; never edits |
| The deepest possible end-to-end pass on a critical repo | `/code-ops-suite:everything` | cross-plugin superset; needs all three engineering plugins |

When two fit, prefer the **narrowest**: a single skill over an intra-plugin sweep, an intra-plugin sweep over `everything`.

---

## Relative cost and depth

Cost is expressed only in relative terms — no token numbers, because actual cost scales with repo size, scope, and check-in level set at Phase 0.

```
everything  >  full-sweep  ≈  rigor-sweep  ≈  privacy full-sweep  ≈  research-sweep  >  ship / debug  >  a single skill
(all 3 plugins)        (one plugin, whole suite)                                    (one scoped change)   (one task)
```

- **`everything` is the most thorough and most token-expensive option** — deliberately so. It runs the supersets of all three engineering plugins, deduplicated, with a single consolidated go/no-go review. Reach for it only on a critical repo, and narrow scope at Phase 0 (riskiest subsystems first) on a large one.
- **The four whole-suite sweeps** (`full-sweep` ×2, `rigor-sweep`, `research-sweep`) sit a tier below: each runs one plugin's full chain end-to-end. They are roughly comparable to one another in shape; the actual cost depends on track (assess/audit-only is far cheaper than full) and repo size.
- **`ship` and `debug`** are scoped to a *single* change or symptom, so they are much cheaper than a sweep even though each phase is run at full rigor.
- **A single skill** (e.g. `codebase-audit`, `bug-hunt`, `tor-egress-audit`) is the cheapest unit; the orchestrators exist to chain these when one is not enough.

Every level above a single skill is checkpointed, so you can dial depth and check-in frequency down at Phase 0 and stop at any boundary — cost is a control you hold, not a fixed price.

---

*Verified-at: c2b37e9*
