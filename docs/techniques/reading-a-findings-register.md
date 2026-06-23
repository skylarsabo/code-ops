# Technique — Reading and Acting on a `FINDINGS_REGISTER.md`

A `FINDINGS_REGISTER.md` is the authoritative backlog an audit or review produces — the single source of truth (SSOT) for what is wrong and what to do about it. Audit skills write it (`code-ops-suite:codebase-audit`, `code-ops-suite:security-privacy-audit`, and the `rigor` hunts — `bug-hunt`, `quality-scan`, `ground-truth`, `regression-hunt`, `safety-net`, `test-suite-audit`, `rigor-sweep`); remediation skills (`code-ops-suite:remediation`, `rigor:fix-verified`) consume it. (`pr-review` produces a prioritized review + verdict as PR comments, or `REVIEW.md` — not a register; `ship` consumes an intent, not the register.) This technique shows you how to read one entry, prioritize across the whole file, and route each finding to the right next action.

## Exec summary (stop here if you only need the gist)

1. **Read the entry, not the headline.** Every finding carries a fixed schema (`CONVENTIONS §7`). The four fields that decide whether to act *now* are **Tier** (is it real?), **Severity** (how bad?), **Track** (is it safe to apply unattended?), and **Verified-at** (was it confirmed against the code you're looking at?).
2. **Trust only what the Tier earns.** `CONFIRMED` was reproduced; `PROBABLE` rests on static evidence; `SPECULATIVE` is one lead. Only `CONFIRMED` items drive an automated fix.
3. **Prioritize by `impact × reach ÷ effort` (weighted by confidence), with severity as a floor** (`CONVENTIONS §8`). A `critical` item never sorts below a `low` one, whatever the arithmetic says.
4. **Route by Track.** `NOW-SAFE` → apply (per your automation level). `NEEDS-REVIEW` → bring to the developer with the recommendation. `NEEDS-DESIGN` → treat as a proposal, decide direction first.
5. **Revalidate before you act.** A register can re-list items already fixed. Run `revalidate-register.mjs` and re-read any survivor; never act on a stale entry.

---

## The schema, field by field

The canonical finding schema (`plugins/code-ops-suite/CONVENTIONS.md:60-66`) is:

```
ID · Title · Lens · Scope · Severity · Confidence · Tier (CONFIRMED|PROBABLE|SPECULATIVE) ·
Location (file:line) · Verified-at (sha the item was last confirmed on) · Evidence (redacted) ·
Disconfirmation (what you ruled out) · Impact · Recommendation ·
Track (NOW-SAFE|NEEDS-REVIEW|NEEDS-DESIGN) · Effort · Risk-if-fixed
```

Here is a synthetic entry that exercises every field, annotated. (It is illustrative; it does not describe real code in this repo.)

```markdown
### SEC-042 · IDOR: order lookup trusts client-supplied `accountId`            ← ID · Title
- **Lens:** security · **Scope:** orders API · **Severity:** high · **Confidence:** high
                                              ↑ floor for ranking   ↑ how sure you are of the claim
- **Tier:** CONFIRMED                          ← evidence strength: reproduced with a runnable repro
- **Location:** `src/api/orders.ts:88` (handler reads `req.query.accountId` and
  joins straight to `orders`), reached via route `src/router.ts:31`     ← every claim cites file:line
- **Verified-at:** c2b37e9                      ← the sha this was last confirmed against
- **Evidence:** `GET /orders?accountId=<OTHER_ACCT>` returned another tenant's
  order rows; auth middleware authenticates the *session* but never checks that
  `accountId` belongs to it. Secret/PII in the trace redacted to <REDACTED:pii>.  ← minimal, redacted
- **Disconfirmation:** ruled out a downstream row-level filter (none in the query
  builder `src/db/orders.ts:12`); ruled out a gateway-level tenant check (gateway
  config `infra/gateway.yaml:44` scopes by host, not account); reachable from the
  public router, not internal-only.                              ← what was checked and rejected
- **Impact:** any authenticated user reads any tenant's orders (cross-tenant data
  exposure). Reach: every order-detail and order-list endpoint on this handler.
- **Recommendation:** derive `accountId` from the authenticated session, not the
  query string; add an ownership assertion before the join. Add a regression test
  asserting a 403 on a mismatched `accountId`.            ← concrete, never "consider maybe"
- **Track:** NEEDS-REVIEW *(always-gated: authz change)* · **Effort:** S · **Risk-if-fixed:** low
       ↑ how to route it          ↑ never auto-applied      ↑ size   ↑ blast radius of the fix itself
```

What each field is *for*:

| Field | What it answers | How you use it |
|---|---|---|
| **ID** | Stable handle (`SEC-042`, `PERF-007`, `BUG-001`) | Traceable across discovery → register → commit/PR → log (`§12`). Cite it in commit messages. |
| **Title** | One-line "what" | Scan target; the rest of the entry is the proof. |
| **Lens** | Which quality lens found it (`§10`) | Group/skim by concern (security, performance, correctness, …). |
| **Scope** | The subsystem/area | Batch fixes that touch the same files; respect conflict-aware fan-out (`§1`). |
| **Severity** | Worst-case blast: `critical` / `high` / `medium` / `low` / `nit` (`§8`) | The **floor** for ranking. `critical` = data loss/leak, security breach, corruption. |
| **Confidence** | How sure the author is of the *claim* | Down-weights the priority score when low. Distinct from Tier. |
| **Tier** | Strength of *evidence*: `CONFIRMED` / `PROBABLE` / `SPECULATIVE` | Gates automation: only `CONFIRMED` drives an automated fix (`§7`). |
| **Location** | `file:line` + how it's reached | Where to look; also what `revalidate-register.mjs` re-checks. |
| **Verified-at** | The sha the item was last confirmed on | If it ≠ current HEAD, re-confirm before acting (`§12`). |
| **Evidence** | Minimal, redacted proof or precise description | Lets you confirm the finding yourself. Secrets/PII → `<REDACTED:reason>` (`§4`). |
| **Disconfirmation** | What was ruled out (reachable? already handled? intentional? already tested?) | Tells you the finding survived a falsification pass — see [the disconfirmation pass](disconfirmation-pass.md). |
| **Impact** | Concrete consequence + reach | Feeds the `× reach` term of the priority score. |
| **Recommendation** | The concrete fix | Your starting point; never vague. |
| **Track** | `NOW-SAFE` / `NEEDS-REVIEW` / `NEEDS-DESIGN` (`§6`) | The routing decision. See below. |
| **Effort** | Size of the fix | The `÷ effort` term of the priority score. |
| **Risk-if-fixed** | Blast radius of *the change itself* | A low-value, high-risk fix may be deferred even if cheap. |

> Some fields are commonly inlined or abbreviated in real registers (see `docs/code-ops-run/2026-06-22/FINDINGS_REGISTER.md` for live examples where `Proof`, `Root cause`, `Siblings`, and `Fix` stand in for `Evidence`/`Recommendation`). The schema is the contract; the layout flexes. If a field is genuinely unknown, expect it marked `UNVERIFIED` with what would confirm it (`§9`).

---

## How to read the Tier (trust calibration)

Tier is the honesty dial. The definitions (`CONVENTIONS §7`) are precise:

- **CONFIRMED** — reproduced: a failing test, a runnable repro, or an executed trace. Act on it.
- **PROBABLE** — backed by **≥2 independent lines of static evidence**. Worth doing; confirm before an automated fix.
- **SPECULATIVE** — a **single lead**. Investigate; do not fix blind.

Two rules follow directly:

1. **Only `CONFIRMED` items drive an automated fix.** When a fixer or orchestrator applies changes unattended, it acts on `CONFIRMED` only; everything else routes to a human first.
2. **When unsure between tiers, the author picks the lower one.** So a `PROBABLE` is genuinely "we have static signal but didn't reproduce it" — your job on read is to reproduce it or down-tier it, not to assume it's true.

The **Disconfirmation** field is your shortcut to trust: it records the falsification pass the author already ran (is the code reachable? is it already handled by a caller/wrapper/framework/type? is it intentional? is it already tested?). A finding with a thin or empty disconfirmation deserves more skepticism than its tier suggests.

---

## How to prioritize the whole file

A good register **leads with a ranked "top N highest-value"** (`codebase-audit` produces exactly this). When you need to re-rank yourself, use the suite's rule (`CONVENTIONS §8`):

> **Rank by `impact × reach ÷ effort`, weighted by confidence — with severity as a floor.**

In practice:

1. **Apply the severity floor first.** Every `critical` outranks every `high`, which outranks every `medium`, and so on. `critical` items (data loss/leak, security breach, corruption) are surfaced immediately and never buried under a cheap-but-trivial win. In the live example register, `SEC-003` (an RCE in a shipped plugin) sits at the top for exactly this reason.
2. **Within a severity band, score `impact × reach ÷ effort`.** A `high` that hits every endpoint and takes an hour beats a `high` that hits one rarely-used path and takes a week.
3. **Weight by confidence and tier.** A `PROBABLE` with `low` confidence drops below a `CONFIRMED` of equal nominal score — you'd spend effort confirming it before you could even act.
4. **Sanity-check `Risk-if-fixed`.** A cheap fix with high blast radius (touches a public contract, a migration, an auth path) is not actually cheap — it carries review and rollout cost. Defer or escalate it rather than treating it as a quick win.

---

## What to do with each Track

Track (`CONVENTIONS §6`) is the routing decision. It interacts with your **automation level** (`§4`, default `gated`).

- **NOW-SAFE** — self-contained, local, small, behavior-preserving (or an unambiguous bug with an obvious fix), no contract/API/schema change, test-covered or quickly testable, trivially revertible.
  → **Apply it.** Under `auto-safe`, these can be applied unattended (each on a branch, test-backed, revertible). Under `gated` (default), they still pause for batch approval. Run the implementation loop (`§11`): re-validate, plan, implement, test, verify, self-review, commit referencing the ID, close the loop.

- **NEEDS-REVIEW** — real and probably worth doing, but behavior-changing, contract/API/schema-touching, non-trivial, or risky.
  → **Bring it to the developer with the concrete recommendation.** Never apply unilaterally, even under `auto-safe`. Present numbered options + a recommendation + a default, each with a one-line trade-off (`§3`).

- **NEEDS-DESIGN** — architectural or cross-cutting.
  → **Treat it as a proposal.** Decide direction first: document the options and trade-offs, pick an approach with the developer, *then* it may become one or more NOW-SAFE/NEEDS-REVIEW implementation items.

**Always gated regardless of Track or automation level** (`§4`): security/auth changes, secret handling, data migrations or destructive/irreversible operations, and public API/contract changes. An entry tagged `*(always-gated: …)*` (as `SEC-042` above) is a hard stop for a human — never auto-applied, never auto-merged.

---

## Before you act: revalidate

A register is a *live* backlog, and the proven failure mode is a register that re-lists items already fixed in code (`§12`). Two guards:

1. **Check `Verified-at` against current HEAD.** If they differ, the finding was confirmed on a different tree — re-confirm it still reproduces before acting.
2. **Run the mechanical freshness check:**

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register.md> --root <repo>
   ```

   It re-greps each cited `file:line` against the current tree and reports one status per item:

   | Status | Meaning | What to do |
   |---|---|---|
   | `FRESH` | Every cited `file:line` still exists and is in range | Re-read the location to confirm the defect survives — `FRESH` is a floor (the path exists), not proof the bug is still there. |
   | `MOVED` | File exists but the cited line is out of range | Re-locate and re-tier. |
   | `GONE` | A cited file no longer exists | Likely resolved/moved — verify, then mark `OBSOLETE-AT <sha>` if fixed. |
   | `AMBIGUOUS` | Path gone but >1 file matches by name, or a ref escapes root | Verify by hand. |
   | `NO-REF` | The item cites no `file:line` | Can't be auto-checked — verify by hand. |

   It exits non-zero if any item is `MOVED`/`GONE`/`AMBIGUOUS`/`NO-REF` (re-triage needed), unless `--report-only`. A `Verified-at` sha that differs from HEAD is reported as a **non-gating advisory** — a nudge to re-confirm, not a failure. A non-`FRESH` item is **re-triaged, never silently re-shown**.

Resolved findings are not deleted — they're stamped `OBSOLETE-AT <sha>` so the history stays auditable (see the `RESOLUTION` note at the top of `docs/code-ops-run/2026-06-22/FINDINGS_REGISTER.md`).

---

## See also

- [The disconfirmation pass](disconfirmation-pass.md) — the falsification discipline behind the `Disconfirmation` field and the tiers.
- [Choosing an automation level](choosing-an-automation-level.md) — how `gated` / `auto-safe` / `auto-all` change what you do with each Track.
- [Registers and freshness](../handbook/04-registers-and-freshness.md) — the full register schema, tracks, `Verified-at`, and `revalidate-register.mjs`.
- [Evidence and tiers](../handbook/05-evidence-and-tiers.md) — `CONFIRMED` / `PROBABLE` / `SPECULATIVE` as lived practice.

*Verified-at: c2b37e9*
