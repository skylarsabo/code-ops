# Audit a risky subsystem

This guide walks six `rigor` commands, in order, over one inherited subsystem you do not
trust. Read it when you must know what is actually broken before you change anything, and
you need a fix that provably stays fixed. Every command, mode, phase, and artifact below
comes from the plugin source under `plugins/rigor/`.

You inherited the payments module. It has 4,000 lines, three contributors who have all left, a
test suite that is green but that nobody trusts, and a production incident from last quarter that
"was fixed" but nobody can explain.

> **The rigor contract, in one sentence:** prove it or do not report it, measure it or do not claim it, close it so it cannot come back. See [`plugins/rigor/CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §0.

---

## The path, end to end

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

1. **Ground truth before opinion.** Run the toolchain first and treat its output as fact ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §C).
2. **Go deep, not wide.** Point `bug-hunt` at one subsystem, because hunting a whole repo at once produces blind spots ([`bug-hunt/SKILL.md`](../../plugins/rigor/skills/bug-hunt/SKILL.md) Phase 0).
3. **Only CONFIRMED drives a fix.** Every finding carries a tier, and inflating one is the cardinal sin ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §A).
4. **Pin behavior before changing it.** `safety-net` makes behavior preservation provable in low-coverage code ([`safety-net/SKILL.md`](../../plugins/rigor/skills/safety-net/SKILL.md)).
5. **A fix without a failing-then-passing test is not done.** It must also break no prior proof ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §8, §H).

You can call any command here directly, or the model can route to it per the standard-operating-mode
routing card. Every checkpoint below applies either way. The orchestrator `/rigor:rigor-sweep` runs
this same sequence end to end if you would rather drive it as one pass. This guide does it step by
step so you can see and approve each checkpoint.

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

For the wider mental model of where `rigor` sits among the four plugins, see
[`code-ops-docs/40 Engineering/Handbook/02-mental-model.md`](../40 Engineering/Handbook/02-mental-model.md).
For the orchestrators, see
[`code-ops-docs/40 Engineering/Handbook/03-orchestrators.md`](../40 Engineering/Handbook/03-orchestrators.md).

---

## Before you start

- **Work on a branch.** `rigor` commits atomically, references finding IDs, and never breaks the build ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §4).
- **Set the automation level once.** The default is `gated`, which pauses for approval at each fix batch. For an audit you triage by hand, so `gated` is correct. `auto-safe` is the recommended ceiling and auto-applies only CONFIRMED and NOW-SAFE fixes. Security and auth, secrets, data migrations, destructive operations, and public-contract changes are always gated regardless of level. See [`code-ops-docs/40 Engineering/Techniques/choosing-an-automation-level.md`](../40 Engineering/Techniques/choosing-an-automation-level.md) and [`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §4.
- **Know where artifacts land.** Run artifacts go in a dated folder under your repository's docs location, for example `docs/rigor/<date>/`, or the repository root when there is no docs convention ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §10). The standard filenames on this six-command journey are `GROUND_TRUTH.md`, `TEST_SUITE_REPORT.md`, `FINDINGS_REGISTER.md`, `IMPLEMENTATION_LOG.md`, and `EXECUTIVE_SUMMARY.md`. The branch commands under "Where the journey can branch" add `CONSISTENCY_REGISTER.md`, `IMPROVEMENTS_LOG.md`, and `REGRESSION_REPORT.md`, for eight standard filenames in all.
- **Read the atlas before the code.** If the repository keeps an atlas, its sections are a durable cache of judgment about this codebase. Trust a section that `atlas-check.mjs` reports FRESH, and treat a STALE section as a lead rather than a fact. See [`code-ops-docs/40 Engineering/Techniques/atlas.md`](../40 Engineering/Techniques/atlas.md).

---

## Step 1 · `/rigor:ground-truth`, facts before opinion

**Mode:** AUDIT, which runs tooling and edits no source. **Produces:** `GROUND_TRUTH.md` plus
CONFIRMED items seeded into `FINDINGS_REGISTER.md`.

This runs first because everything downstream reconciles against it. The skill detects your
toolchain (Phase 0), then runs and harvests it as fact (Phase 1):

- **build and typecheck** confirm compile and type errors on the spot.
- **linters** yield real findings, because the skill skips pure-cosmetic rules.
- **test suite and coverage** yield failures and flakes as CONFIRMED, plus a coverage map of what is exercised.
- **static analyzer or SAST** yields issues queued to reconcile later.

Toolchain runs are the noisiest output in the journey. The output digest rewrites long Bash output
into a summary plus a receipt naming the raw file on disk, so a truncated result stays a pointer
rather than a loss. The digest is on by default and switches off with `off`, `0`, or `false` for
`CODE_OPS_DIGEST` in the `env` block of a `.claude/settings.json`. Its contract is in
[Contracts](../35 Contracts and Data/CONTRACTS.md) and its switch is in
[Infrastructure](../50 Platform/INFRASTRUCTURE.md).

The deliverable that matters most for a risky subsystem is the blind-spot list, meaning the modules
and paths with little or no coverage. That list is where later hunting must be most careful, and it
is exactly what `safety-net` will pin before any change.

**What it asks you:** only a checkpoint when the toolchain is ambiguous, for example two test
runners or an unclear build entry point. Otherwise it just runs.

**What you read after:** `GROUND_TRUTH.md`. Two things matter. Which lint and analyzer rules are
already enforced, so later skills do not re-flag them (§C). And the blind-spot list. For the
payments module, suppose coverage comes back at 22% on `payments/refund.ts` and 0% on
`payments/webhook.ts`. Those are your two blind spots.

---

## Step 2 · `/rigor:test-suite-audit`, is "green" worth anything?

**Mode:** AUDIT, which executes the suite repeatedly plus mutation checks and adds hardening tests
only. **Produces:** `TEST_SUITE_REPORT.md` plus a trust map.

Most audits skip this move. Your proofs, meaning repros and regression tests, are only as strong as
the suite's ability to detect faults ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §F). A
green suite is not proof until that fault-catching power is established. So before hunting, this
skill asks what "green" is actually worth here.

Phase 1 establishes that three ways:

- **Flaky or nondeterministic tests.** Run the target tests several times and quarantine unstable results. A flaky green is not a green.
- **Assertion strength.** Find tests that execute code but assert little, meaning coverage without verification.
- **Mutation testing.** Inject representative faults into the relied-upon code and confirm the suite kills them. Surviving mutants mark where passing tests guard nothing. The danger zone is high coverage with a low kill rate.

Phase 2 hardens the gaps. It proposes, and for NOW-SAFE additions writes, targeted tests that kill
the surviving mutants, then re-runs to confirm the kill rate improves.

**What you read after:** `TEST_SUITE_REPORT.md` and its trust map, which says where green is real.
Suppose `payments/charge.ts` shows 95% coverage but a 40% mutation kill rate. That combination is a
louder warning than the 0%-coverage webhook, because the tests there are misleading you. You now
know not to trust any "it is already tested" claim about `charge.ts` until those mutants die.

**Scope checkpoint:** Phase 0 lets you target the whole suite or focus on the modules you intend to
change. For this journey, focus on the payments subsystem.

---

## Step 3 · `/rigor:bug-hunt` (deep, one subsystem) with `/rigor:quality-scan`

These run together over the same scoped subsystem. `bug-hunt` is the flagship, because it finds and
proves real bugs. `quality-scan` finds the quality issues that are not yet bugs but cause them.
Both run in AUDIT mode and write into the same `FINDINGS_REGISTER.md`.

### `/rigor:bug-hunt`, prove the bug then find its whole class

**Mode:** AUDIT, which reads and executes repros but applies no source fixes. **Produces:** tiered
findings with proof, and saved repro tests.

The phases, in order:

- **Phase 0 · Scope (checkpoint).** Pick one component or subsystem. The skill is explicit: go deep, not wide, because hunting a whole large repository at once produces blind spots. Point it at `payments/`, not the repository. It reads `GROUND_TRUTH.md` so it does not re-derive facts or re-flag tool findings.
- **Phase 1 · Derive intent.** Extract the invariants, contracts, and assumptions the code must uphold, from types, docs, tests, and call sites. Bugs are violations of these. For payments: a refund never exceeds the captured amount, and a webhook is processed at most once.
- **Phase 2 · Hunt.** Trace control and data flow end to end and probe the correctness lenses (§7): boundaries, null and empty, ordering, concurrency and races, error paths, state-machine and contract violations, resource lifecycle, integer and precision, time, and encoding. It generates adversarial inputs. Where exact correctness is hard to assert, it uses an oracle: a reference or prior version, the spec, a parallel implementation, property generators, or round-trip relations.
- **Phase 3 · Prove, then disconfirm.** Each candidate gets a failing test or repro on current code, which makes it CONFIRMED with the repro saved. A candidate that cannot be executed is tiered PROBABLE, needing two independent evidence lines, or SPECULATIVE. Then the mandatory disconfirmation pass (§B) tries to kill each finding, asking whether it is reachable, handled elsewhere, intentional, or already tested, and drops what dies. See [`code-ops-docs/40 Engineering/Techniques/disconfirmation-pass.md`](../40 Engineering/Techniques/disconfirmation-pass.md).
- **Phase 4 · Root cause and sibling sweep (§G).** For each CONFIRMED bug, trace to the root cause rather than the symptom, then search the codebase for siblings, meaning other sites with the same cause. The goal is to surface the whole class.

Phases 1 and 2 read the most code, so read structure before body. `co context skim <file>` returns
an outline, and `co context skim <file> --range A,B` returns only the lines the outline named.
`co context query find|callers|callees|blast <symbol>` answers with `file:line` anchors instead of
a map dump, which is what makes a sibling sweep cheap. The symbol index refreshes after an edit
through the `CODE_OPS_INDEX` PostToolUse hook, on by default and switched off with `off`, `0`, or
`false`. A host that speaks MCP can reach the same index through the `code-ops-query` server.

### `/rigor:quality-scan`, real issues at high signal

**Mode:** AUDIT, which reads and executes lightly. **Produces:** tiered findings plus a summary.

It targets the maintainability lenses that actually bite: complexity hotspots with a concrete
metric, error-handling gaps, resource leaks, type-safety holes, fragile coupling, and dead or
duplicated code that hides intent. Each item gets a `file:line`, reachability and impact, a tier,
and the disconfirmation pass. Cosmetic style is out of scope, because that is the formatter's job.

The size-and-boundary lens sits alongside those. It asks whether a unit earned its own file, its
own abstraction, or its own dependency. `co scan overbuild --git <range>` is the mechanical floor
under that lens, advisory except for an unrecorded dependency, and `co scan deferrals` harvests
every `deferred(<ceiling>, <upgrade path>)` marker into a register. Both verbs resolve only inside
`code-ops-suite`, which bundles `scan-overbuild.mjs` and `harvest-deferrals.mjs`.

---

## Step 4 · Reading the consolidated `FINDINGS_REGISTER.md`

Both AUDIT skills above write into one register. It is a live backlog and single source of truth
with stable IDs that persist across the whole lifecycle, from `BUG-007` to the register to the
repro test to the commit ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §10). The full
schema is §6. Here is a synthetic snippet for the payments audit so you can see the shape:

```markdown
# FINDINGS_REGISTER.md   (Verified-at: c2b37e9)

## CONFIRMED  (these may drive a fix)

### BUG-007 · Refund can exceed captured amount
- Lens:          Correctness & logic (boundary)
- Tier:          CONFIRMED
- Proof:         test `refund.exceeds-capture.spec.ts` fails on current code (asserts
                 refund of 150 against a 100 capture is rejected; currently succeeds)
- Location:      payments/refund.ts:84
- Verified-at:   c2b37e9
- Root-cause:    comparison uses `>` against `requested` not `remaining` captured amount
- Class/siblings: payments/refund.ts:84; payments/partial-refund.ts:51 (same compare bug)
- Reachability:  reachable via POST /refunds with any over-amount; no guard upstream
- Impact:        CONFIRMED money-loss path on a hot endpoint (highest blast radius)
- Disconfirmation: not handled by middleware (checked); no existing test covers it;
                 not intentional (contradicts docs/refunds.md)
- Fix:           clamp/validate against remaining captured amount at refund.ts:84
- Enforcement:   kept regression test + invariant assertion `refund <= remaining`
- Track:         NOW-SAFE
- Effort:        S   · Risk-if-fixed: low

### BUG-011 · Webhook handler processes duplicate events
- Lens:          Correctness & logic (idempotency / state machine)
- Tier:          CONFIRMED
- Proof:         test `webhook.duplicate.spec.ts` fails now (same event id applied twice)
- Location:      payments/webhook.ts:130
- Verified-at:   c2b37e9
- Root-cause:    no idempotency key check before applying state transition
- Class/siblings: payments/webhook.ts:130 (none found elsewhere, sweep clean)
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

- **Tiers gate action.** Only CONFIRMED items may drive an automated fix ([`CONVENTIONS.md`](../../plugins/rigor/CONVENTIONS.md) §A). A PROBABLE item must be reproduced, and so promoted to CONFIRMED, before it is fixed. SPECULATIVE is a lead and is never auto-fixed.
- **Tracks tell you how to act.** NOW-SAFE means CONFIRMED, local, and low-risk, which is the auto-safe lane. NEEDS-REVIEW means behavior-changing, contract-changing, or PROBABLE, so it needs your eyes. NEEDS-DESIGN means architectural, and it is never auto-applied even at `auto-all` (§6, §4).
- **Read CONFIRMED first, ranked by demonstrated blast radius** rather than theoretical severity (§D). `BUG-007` is a money-loss path on a hot endpoint, so it outranks the PROBABLE precision lead.
- **Check `Verified-at`.** Every entry stamps the sha its proof last passed on. A long register is worth skimming with `co context skim FINDINGS_REGISTER.md` before you read any entry in full. Before acting on the register later, re-confirm freshness with the mechanical pre-filter:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .
```

It reports each item as `FRESH`, `MOVED`, `DRIFTED`, `GONE`, or `NO-REF`, with `AMBIGUOUS` for name
collisions. `DRIFTED` fires when a cited line no longer contains the finding's delimited `Anchor:`
substring. A non-gating advisory fires when an item's `Verified-at` sha differs from current HEAD.
Anything not `FRESH` needs re-triage before you act on it. See
[`code-ops-docs/40 Engineering/Handbook/04-registers-and-freshness.md`](../40 Engineering/Handbook/04-registers-and-freshness.md),
the deeper read in
[`code-ops-docs/40 Engineering/Techniques/reading-a-findings-register.md`](../40 Engineering/Techniques/reading-a-findings-register.md),
and, for what each tier means in practice,
[`code-ops-docs/40 Engineering/Handbook/05-evidence-and-tiers.md`](../40 Engineering/Handbook/05-evidence-and-tiers.md).

**Your job at this checkpoint:** bless the CONFIRMED items you want fixed. You decide `BUG-007` and
`BUG-011` go forward, `BUG-014` stays PROBABLE until reproduced, and `Q-003` routes to
`/rigor:consistency-closure` later rather than to a fix.

---

## Step 5 · `/rigor:safety-net`, pin behavior before you touch it

**Mode:** IMPLEMENT, which adds tests only and changes no production code. **Produces:** a
characterization test suite plus suspicious-behavior findings.

Two of your blessed fixes touch low-coverage code: `BUG-011` in the 0%-coverage webhook, and
`charge.ts` with its 40% kill rate. Before changing any of it, you make behavior preservation
provable.

- **Phase 0 · Pick targets (checkpoint).** The blind spots from `GROUND_TRUTH.md`, code queued for a fix or refactor, and high-risk modules. Confirm scope, here `payments/webhook.ts` and `payments/charge.ts`.
- **Phase 1 · Characterize.** Write characterization tests that capture current observable behavior, quirks included, because these pin behavior rather than correctness. Run them green against current code. The skill exercises real edge and error inputs so the net is tight. If it finds behavior that looks wrong, it does not fix it here. It records a candidate finding for `bug-hunt` or `fix-verified`.

The output gives the regression guard (§H) something concrete to protect, and it tells you which
targets are now safe to change. The characterization tests are committed and tagged so the guard
can find them.

---

## Step 6 · `/rigor:fix-verified`, fix the cause, prove it, guard the class

**Mode:** IMPLEMENT. **Consumes:** `FINDINGS_REGISTER.md`. **Produces:** fixes as pull requests,
each with a before-and-after repro, plus `IMPLEMENTATION_LOG.md` and an updated register. It fixes
CONFIRMED items only. A PROBABLE item must be reproduced, and so promoted, before it is fixed.

- **Phase 0 · Re-validate and sequence (checkpoint).** It first runs the staleness pre-filter shown above, then for each CONFIRMED finding confirms its repro still fails on current code, dropping or re-tiering anything that no longer reproduces. It builds a conflict graph and sequences by demonstrated impact. NEEDS-DESIGN items get options presented first, never a silent fix.
- **Phase 1 · The fix-prove-guard loop (§8), per item:**
  1. Confirm the failing repro.
  2. Trace to the root cause (§G) and make the minimal correct fix at the right layer. For `BUG-007`, fix the comparison at `refund.ts:84`, not a patch at the controller.
  3. Confirm the repro now passes and the full suite is green.
  4. Run the regression guard (§H), re-running the entire accumulated proof set including the `safety-net` characterization tests. Nothing prior breaks. Never weaken a proof to make a change pass.
  5. Run the behavior-preservation check.
  6. Sweep for siblings (§G). `BUG-007`'s register entry already named a sibling at `partial-refund.ts:51`, so fix it in the same class or register it.
  7. Add an enforcement so the class cannot recur: the kept regression test plus a type, lint rule, or assertion. Here that is the `refund <= remaining` invariant and the unique `(event_id)` constraint for `BUG-011`.
  8. Self-review, commit atomically referencing the finding ID and its proof, then update the register as closed-with-proof.

If the run's fixes start cascading, meaning three or more rejected by the regression guard or
spawning new CONFIRMED findings, the cascade circuit-breaker (§H) halts the loop and reclassifies
the cluster as NEEDS-DESIGN. A cascade this size is an architectural problem, not a bug collection,
so it goes to a checkpoint rather than the next patch.

**The shape of a shipped fix**, in three artifacts:

1. A failing-then-passing regression test. `refund.exceeds-capture.spec.ts` failed on the audited sha and passes after the fix.
2. A regression guard that re-ran the whole proof set, including the safety-net characterization tests, and stayed green.
3. A sibling sweep that fixed `partial-refund.ts:51` as part of the same class, plus an enforcement so neither site can silently regress.

A fix without a failing-then-passing test, or one that breaks a prior proof, is not done (§8, §H).

`BUG-011` is tracked NEEDS-REVIEW because it changes the webhook state machine and touches a data
path, so it stays gated at every automation level. You review and approve it explicitly before it
ships. `BUG-007`, tracked NOW-SAFE, is the one that could ride the `auto-safe` lane had you chosen
that level.

---

## Where the journey can branch

- **A regression rather than a bug.** Use `/rigor:regression-hunt` to bisect a CONFIRMED bug to the commit that introduced it.
- **The SPECULATIVE interface-consistency lead (`Q-003`).** Route it to `/rigor:consistency-closure`, which picks one canonical form, migrates every site, and adds an enforcement so the divergence cannot recur.
- **Reviewing the resulting pull request at the verification bar.** That is `/rigor:deep-review`, which blocks only on CONFIRMED defects and regressions.
- **Driving it all as one pass.** `/rigor:rigor-sweep` runs ground-truth, test-suite-audit, bug-hunt with quality-scan, safety-net, an approval, fix-verified, consistency-closure, and measured improvements.

To ship the fix as a verified, low-trace pull request, continue with
[`code-ops-docs/70 Guides/ship-a-verified-fix.md`](ship-a-verified-fix.md). For the full command
reference, see
[`code-ops-docs/40 Engineering/Handbook/commands/rigor.md`](../40 Engineering/Handbook/commands/rigor.md).
For what the context and code economy mechanisms cost and save, see
[Measurements](../55 Operations/MEASUREMENTS.md).

---

*Verified-at: b0ffede*
