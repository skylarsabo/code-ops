# Guide: Audit a Risky Subsystem

You inherited the payments module. It has 4,000 lines, three contributors who have all left, a test suite that is green but that nobody trusts, and a production incident from last quarter that "was fixed" but nobody can explain. You need to know what is actually broken before you change anything — and you need a fix that provably stays fixed.

This guide is the **rigor journey** for that situation. It is a narrative walk through six `rigor` commands, in order, on one subsystem. Every command name, mode, phase, and produced artifact below is taken from the real plugin source under `plugins/rigor/`.

> **The rigor contract (the one sentence to remember):** *prove it or don't report it; measure it or don't claim it; close it so it can't come back.* See [`plugins/rigor/CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §0.

---

## Exec summary — the path, end to end

You can stop reading after this section and still run the journey correctly.

```
/rigor:ground-truth        → run the real toolchain; capture facts + a blind-spot map
/rigor:test-suite-audit    → is the "green" suite actually catching faults?
/rigor:bug-hunt (deep)     → one subsystem, prove each bug
   + /rigor:quality-scan   → high-signal, defect-causing quality issues
review FINDINGS_REGISTER.md → CONFIRMED-led; you triage and bless
/rigor:safety-net          → pin current behavior before you touch it
/rigor:fix-verified        → fix at root cause; failing→passing test + guard + sibling sweep
```

Five rules carry the whole journey:

1. **Ground truth before opinion.** Run the toolchain first; treat its output as fact ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §C).
2. **Go deep, not wide.** Point `bug-hunt` at *one* subsystem — hunting a whole repo at once produces blind spots ([`bug-hunt/SKILL.md`](../../plugins/rigor/skills/bug-hunt/SKILL.md) Phase 0).
3. **Only CONFIRMED drives a fix.** Every finding carries a tier; inflating one is the cardinal sin ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §A).
4. **Pin behavior before changing it.** `safety-net` makes "behavior-preserving" provable in low-coverage code ([`safety-net/SKILL.md`](../../plugins/rigor/skills/safety-net/SKILL.md)).
5. **A fix without a failing-then-passing test is not done.** And it must not break any prior proof ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §8, §H).

All commands here are **manual-invoke** (`disable-model-invocation: true`) — you call them; the model will not auto-trigger them. The orchestrator `/rigor:rigor-sweep` runs this same sequence end-to-end if you would rather drive it as one pass; this guide does it step by step so you can see and approve each checkpoint.

```mermaid
sequenceDiagram
    actor Dev as You
    participant GT as ground-truth
    participant TSA as test-suite-audit
    participant BH as bug-hunt + quality-scan
    participant FR as FINDINGS_REGISTER.md
    participant SN as safety-net
    participant FV as fix-verified

    Dev->>GT: /rigor:ground-truth
    GT-->>FR: facts + blind-spot map (GROUND_TRUTH.md)
    Dev->>TSA: /rigor:test-suite-audit
    TSA-->>FR: trust map (TEST_SUITE_REPORT.md)
    Dev->>BH: /rigor:bug-hunt (deep) + /rigor:quality-scan
    BH-->>FR: tiered, proven findings
    Dev->>FR: read, triage, bless CONFIRMED items
    Dev->>SN: /rigor:safety-net (pin targets)
    SN-->>FR: characterization tests + suspicious behaviors
    Dev->>FV: /rigor:fix-verified (blessed CONFIRMED only)
    FV-->>FR: closed-with-proof; regression guard green
```

For the wider mental model of where `rigor` sits among the four plugins, see [`docs/handbook/02-mental-model.md`](../handbook/02-mental-model.md). For the orchestrators, see [`docs/handbook/03-orchestrators.md`](../handbook/03-orchestrators.md).

---

## Before you start

- **Work on a branch.** `rigor` commits atomically, references finding IDs, and never breaks the build ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §4).
- **Set the automation level once.** Default is `gated` — pause for approval at each fix batch. For an audit you are triaging by hand, `gated` is correct. `auto-safe` is the recommended ceiling and only ever auto-applies CONFIRMED + NOW-SAFE fixes; security/auth, secrets, data migrations, destructive ops, and public-contract changes are **always gated regardless of level**. See [`docs/techniques/choosing-an-automation-level.md`](../techniques/choosing-an-automation-level.md) and [`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §4.
- **Know where artifacts land.** Run artifacts go in a dated folder under your repo's docs location, e.g. `docs/rigor/<date>/`, or the repo root if there is no docs convention ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §10). The standard filenames you will see **on this six-command journey**: `GROUND_TRUTH.md`, `TEST_SUITE_REPORT.md`, `FINDINGS_REGISTER.md`, `IMPLEMENTATION_LOG.md`, `EXECUTIVE_SUMMARY.md`. The branch commands (see "Where the journey can branch") add three more from the full §10 set — `CONSISTENCY_REGISTER.md` (consistency-closure), `IMPROVEMENTS_LOG.md` (improve-measured), and `REGRESSION_REPORT.md` (regression-hunt) — for eight standard filenames in all.

---

## Step 1 — `/rigor:ground-truth`: facts before opinion

**Mode:** AUDIT (runs tooling; no source edits). **Produces:** `GROUND_TRUTH.md` + seeds CONFIRMED items into `FINDINGS_REGISTER.md`.

This runs first because everything downstream reconciles against it. The skill detects your toolchain (Phase 0), then runs and harvests it as fact (Phase 1):

- **build/typecheck** → compile and type errors are CONFIRMED on the spot.
- **linter(s)** → real findings (it skips pure-cosmetic rules).
- **test suite + coverage** → failures and flakes (CONFIRMED), plus a **coverage map** of what is exercised versus not.
- **static analyzer / SAST** → issues queued to reconcile later.

The deliverable you care about most for a risky subsystem is the **blind-spot list**: the modules and paths with little or no coverage. That list is exactly where later hunting must be most careful, and exactly what `safety-net` will pin before any change.

**What it asks you:** only a checkpoint if the toolchain is ambiguous (e.g. two test runners, an unclear build entry point). Otherwise it just runs.

**What you read after:** `GROUND_TRUTH.md`. Two things matter — which lint/analyzer rules are already enforced (so later skills do not re-flag them, per §C "never re-flag what a tool already enforces"), and the blind-spot list. For the payments module, suppose coverage comes back at 22% on `payments/refund.ts` and 0% on `payments/webhook.ts`. Those are your two blind spots.

---

## Step 2 — `/rigor:test-suite-audit`: is "green" worth anything?

**Mode:** AUDIT (executes the suite repeatedly + mutation checks; adds hardening tests only). **Produces:** `TEST_SUITE_REPORT.md` + a trust map.

Here is the move most audits skip. Your proofs — repros and regression tests — are only as strong as the suite's ability to detect faults ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §F). A green suite is **not** proof until that fault-catching power is established. So before hunting, this skill asks: *what is "green" actually worth here?*

Phase 1 establishes that three ways:

- **Flaky / nondeterministic:** run the target tests several times; unstable results go on a quarantine list. *A flaky green is not a green.*
- **Assertion strength:** find tests that execute code but assert little — coverage without verification.
- **Mutation testing:** inject representative faults into the relied-upon code and confirm the suite **kills** them. Surviving mutants mark exactly where passing tests guard nothing. The danger zone is named explicitly: **high coverage + low kill rate.**

Phase 2 hardens the gaps — it proposes, and for NOW-SAFE additions writes, targeted tests that kill the surviving mutants, then re-runs to confirm the kill rate improves.

**What you read after:** `TEST_SUITE_REPORT.md` and its **trust map** — which areas' green is real. Suppose `payments/charge.ts` shows 95% coverage but a 40% mutation kill rate. That high-coverage/low-kill combination is a louder warning than the 0%-coverage webhook: the tests there are *lying to you*. You now know not to trust any "it's already tested" claim about `charge.ts` until those mutants are killed.

**Scope checkpoint:** Phase 0 lets you target the whole suite or focus on the modules you intend to change. For this journey, focus on the payments subsystem.

---

## Step 3 — `/rigor:bug-hunt` (deep, one subsystem) + `/rigor:quality-scan`

These run together over the same scoped subsystem. `bug-hunt` is the flagship — it finds and **proves** real bugs. `quality-scan` finds the defect-causing quality issues that are not yet bugs but cause them. Both are AUDIT mode and write into the same `FINDINGS_REGISTER.md`.

### `/rigor:bug-hunt` — prove the bug, then find its whole class

**Mode:** AUDIT (reads + *executes* repros; no source fixes). **Produces:** tiered findings with proof; repro tests saved.

The phases, in order:

- **Phase 0 — Scope (checkpoint):** pick one component/subsystem. The skill is explicit: *go deep, not wide — hunting a whole large repo at once produces blind spots.* Point it at `payments/`, not the repo. It reads `GROUND_TRUTH.md` so it does not re-derive facts or re-flag tool findings.
- **Phase 1 — Derive intent:** extract the invariants, contracts, and assumptions the code must uphold — from types, docs, tests, and call sites. *Bugs are violations of these.* For payments: "a refund never exceeds the captured amount," "a webhook is processed at most once."
- **Phase 2 — Hunt:** trace control and data flow end-to-end and probe the correctness lenses (§7) — boundaries, null/empty, ordering, concurrency / races / TOCTOU, error paths, state-machine and contract violations, resource lifecycle, integer/precision, time, encoding. It generates adversarial inputs; where exact correctness is hard to assert, it uses an **oracle** (a reference/prior version, the spec, a parallel implementation, property generators, round-trip/metamorphic relations).
- **Phase 3 — Prove, then disconfirm (the differentiator):** each candidate gets a failing test/repro on current code → **CONFIRMED** (repro saved); if it cannot be executed it is tiered **PROBABLE** (needs two independent evidence lines) or **SPECULATIVE**. Then the mandatory **disconfirmation pass** (§B) tries to *kill* each finding — is it reachable? handled elsewhere? intentional? already tested? — and drops what dies. See [`docs/techniques/disconfirmation-pass.md`](../techniques/disconfirmation-pass.md).
- **Phase 4 — Root cause & sibling sweep (§G):** for each CONFIRMED bug, trace to the **root cause** (not the symptom) and **search the codebase for siblings** — other sites with the same cause. The goal is to surface the whole *class*.

### `/rigor:quality-scan` — real issues, high signal

**Mode:** AUDIT (reads + light execution). **Produces:** tiered findings; summary.

It targets the maintainability lenses that actually bite — **complexity hotspots** (with a concrete metric, not a vibe), **error-handling gaps**, **resource leaks**, **type-safety holes**, **fragile coupling**, **dead/duplicated code that hides intent**. Each item gets `file:line`, reachability/impact, a tier, and the disconfirmation pass. Cosmetic style is explicitly out of scope — that is the formatter's job. It will not pad the report.

---

## Step 4 — Read the consolidated `FINDINGS_REGISTER.md`

Both AUDIT skills above write into one register. It is a **live backlog and single source of truth** with stable IDs that persist across the whole lifecycle (`BUG-007` → register → repro test → commit/PR), per [`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §10. The full schema is §6. Here is a synthetic snippet for the payments audit so you can see the shape:

```markdown
# FINDINGS_REGISTER.md   (Verified-at: c2b37e9)

## CONFIRMED  (these may drive a fix)

### BUG-007 · Refund can exceed captured amount
- Lens:          Correctness & logic (boundary)
- Tier:          CONFIRMED
- Proof:         test `refund.exceeds-capture.spec.ts` — fails on current code (asserts
                 refund of 150 against a 100 capture is rejected; currently succeeds)
- Location:      payments/refund.ts:84
- Verified-at:   c2b37e9
- Root-cause:    comparison uses `>` against `requested` not `remaining` captured amount
- Class/siblings: payments/refund.ts:84; payments/partial-refund.ts:51 (same compare bug)
- Reachability:  reachable via POST /refunds with any over-amount; no guard upstream
- Impact:        CONFIRMED money-loss path on a hot endpoint — highest blast radius
- Disconfirmation: not handled by middleware (checked); no existing test covers it;
                 not intentional (contradicts docs/refunds.md)
- Fix:           clamp/validate against remaining captured amount at refund.ts:84
- Enforcement:   kept regression test + invariant assertion `refund <= remaining`
- Track:         NOW-SAFE
- Effort:        S   · Risk-if-fixed: low

### BUG-011 · Webhook handler processes duplicate events
- Lens:          Correctness & logic (idempotency / state machine)
- Tier:          CONFIRMED
- Proof:         test `webhook.duplicate.spec.ts` — fails now (same event id applied twice)
- Location:      payments/webhook.ts:130
- Verified-at:   c2b37e9
- Root-cause:    no idempotency key check before applying state transition
- Class/siblings: payments/webhook.ts:130 (none found elsewhere — sweep clean)
- Reachability:  provider retries deliver duplicates in normal operation
- Impact:        double-credit on retry; 0% prior test coverage (blind spot from §1)
- Disconfirmation: dedupe is NOT done at the queue layer (traced); not intentional
- Fix:           persist + check idempotency key before transition
- Enforcement:   regression test + unique constraint on (event_id)
- Track:         NEEDS-REVIEW   (touches state machine; behavior-adjacent)
- Effort:        M   · Risk-if-fixed: medium

## PROBABLE  (reproduce before fixing)

### BUG-014 · Possible precision loss summing line items
- Tier:          PROBABLE  (two static evidence lines: float arithmetic at total.ts:22
                 + a contract in docs requiring exact cents; no repro yet)
- Location:      payments/total.ts:22
- Disconfirmation: could not execute a failing case within the run; needs a repro
- Track:         NEEDS-REVIEW

## SPECULATIVE  (a lead worth a look)

### Q-003 · Refund service and capture service diverge on error shape
- Tier:          SPECULATIVE
- Lens:          Interface consistency
- Note:          candidate for /rigor:consistency-closure, not a fix yet
```

### How to read it

- **Tiers gate action.** Only **CONFIRMED** items may drive an automated fix ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §A). PROBABLE must be reproduced (promoted to CONFIRMED) before it is fixed. SPECULATIVE is a lead, never auto-fixed.
- **Tracks tell you *how* to act.** **NOW-SAFE** (CONFIRMED, local, low-risk) is the auto-safe lane. **NEEDS-REVIEW** (behavior-/contract-changing or PROBABLE) needs your eyes. **NEEDS-DESIGN** (architectural) is never auto-applied, even at `auto-all` (§6, §4).
- **Read CONFIRMED first, ranked by demonstrated blast radius**, not theoretical severity (§D). `BUG-007` (money loss on a hot path, NOW-SAFE) outranks the PROBABLE precision lead.
- **Check `Verified-at`.** Every entry stamps the sha its proof last passed on. Before acting on the register later, re-confirm freshness — there is a fast pre-filter:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .
```

It reports each item as `FRESH` / `MOVED` / `GONE` / `NO-REF` (with `AMBIGUOUS` for name collisions, plus a non-gating advisory when an item's `Verified-at` sha differs from current HEAD). Anything not `FRESH` needs re-triage before you act on it. See [`docs/handbook/04-registers-and-freshness.md`](../handbook/04-registers-and-freshness.md) and the deeper read in [`docs/techniques/reading-a-findings-register.md`](../techniques/reading-a-findings-register.md). For what each tier means in lived practice, [`docs/handbook/05-evidence-and-tiers.md`](../handbook/05-evidence-and-tiers.md).

**Your job at this checkpoint:** bless the CONFIRMED items you want fixed. You decide `BUG-007` and `BUG-011` go forward; `BUG-014` stays PROBABLE until reproduced; `Q-003` is routed to `/rigor:consistency-closure` later, not to a fix.

---

## Step 5 — `/rigor:safety-net`: pin behavior before you touch it

**Mode:** IMPLEMENT (adds tests only; changes no production code). **Produces:** a characterization test suite + suspicious-behavior findings.

Two of your blessed fixes touch low-coverage code (`BUG-011` in the 0%-coverage webhook; `charge.ts` had a 40% kill rate). Before changing any of it, you make "behavior-preserving" *provable*.

- **Phase 0 — Pick targets (checkpoint):** the blind spots from `GROUND_TRUTH.md`, code queued for a fix/refactor, and high-risk modules. Confirm scope — here, `payments/webhook.ts` and `payments/charge.ts`.
- **Phase 1 — Characterize:** write **characterization tests** that capture *current observable behavior* — including current quirks (these pin behavior, not correctness) — and run them **green against current code**. It exercises real edge/error inputs so the net is tight. Crucially: if it finds behavior that looks wrong, it does **not** fix it here — it records a candidate finding for `bug-hunt`/`fix-verified`.

The output gives the **regression guard** (§H) something concrete to protect, and tells you which targets are now safe to change. The characterization tests are committed and tagged so the guard can find them.

---

## Step 6 — `/rigor:fix-verified`: fix the cause, prove it, guard the class

**Mode:** IMPLEMENT. **Consumes:** `FINDINGS_REGISTER.md`. **Produces:** fixes (PRs) each with a before/after repro, `IMPLEMENTATION_LOG.md`, updated register. It fixes **CONFIRMED** items only; a PROBABLE item must be reproduced (promoted) before it is fixed.

- **Phase 0 — Re-validate & sequence (checkpoint):** it first runs the staleness pre-filter (`revalidate-register.mjs`, shown above), then for each CONFIRMED finding confirms its **repro still fails** on current code — dropping or re-tiering anything that no longer reproduces. It builds a conflict graph and sequences by demonstrated impact. NEEDS-DESIGN items get options presented first, not a silent fix.
- **Phase 1 — The fix–prove–guard loop (§8), per item:**
  1. Confirm the failing repro.
  2. Trace to **root cause** (§G) and make the minimal correct fix **at the right layer** — for `BUG-007`, fix the comparison at `refund.ts:84`, not a band-aid at the controller.
  3. The repro now **passes** and the full suite is green.
  4. **Regression guard (§H):** re-run the entire accumulated proof set — including the `safety-net` characterization tests. Nothing prior breaks. *Never weaken a proof to make a change pass.*
  5. Behavior-preservation check.
  6. **Sweep for siblings (§G):** `BUG-007`'s register entry already named a sibling at `partial-refund.ts:51` — fix it in the same class, or register it.
  7. **Add an enforcement** so the class cannot recur: the kept regression test plus a type/lint/assertion (the `refund <= remaining` invariant; the unique `(event_id)` constraint for `BUG-011`).
  8. Self-review, commit atomically referencing the finding ID + proof, update the register (closed-with-proof).

**The shape of a shipped fix**, in three artifacts:

1. A **failing → passing regression test** (`refund.exceeds-capture.spec.ts` failed on `c2b37e9`, passes after the fix).
2. A **regression guard** that re-ran the whole proof set — the safety-net characterization tests and every other repro — and stayed green.
3. A **sibling sweep** that fixed `partial-refund.ts:51` as part of the same class, plus an enforcement so neither site can silently regress.

A fix without a failing-then-passing test, or one that breaks a prior proof, **is not done** (§8, §H).

Because `BUG-011` is tracked **NEEDS-REVIEW** (it changes the webhook state machine) and touches a data path, it stays gated at every automation level — you review and approve it explicitly before it ships. `BUG-007`, tracked **NOW-SAFE**, is the one that could ride the `auto-safe` lane if you had chosen it.

---

## Where the journey can branch

- **Found a regression, not just a bug?** Use `/rigor:bug-hunt`'s sibling, `/rigor:regression-hunt`, to VCS-bisect a CONFIRMED bug to the commit that introduced it.
- **The SPECULATIVE interface-consistency lead (`Q-003`)?** Route it to `/rigor:consistency-closure` — pick one canonical form, migrate every site, add an enforcement so the divergence cannot recur.
- **Reviewing the resulting PR at the verification bar?** That is `/rigor:deep-review` — it blocks only on CONFIRMED defects/regressions.
- **Want it all driven as one pass?** `/rigor:rigor-sweep` runs ground-truth → test-suite-audit → bug-hunt + quality-scan → safety-net → (approval) fix-verified → consistency-closure → measured improvements.

To ship the fix as a verified, low-trace PR, continue with [`docs/guides/ship-a-verified-fix.md`](ship-a-verified-fix.md). For the full command reference, see [`docs/handbook/commands/rigor.md`](../handbook/commands/rigor.md).

---

*Verified-at: c2b37e9*
