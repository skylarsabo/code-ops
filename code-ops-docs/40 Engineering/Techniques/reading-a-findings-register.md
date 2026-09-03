# Reading and acting on a findings register

This page teaches you to read one register entry, prioritize across the whole file, and
route each finding to the right next action. Read it when an audit or review hands you a
`FINDINGS_REGISTER.md` and you have to decide what to do first. The one command it turns
on is `node scripts/revalidate-register.mjs <register.md> --root <repo>`.

A `FINDINGS_REGISTER.md` is the authoritative backlog an audit or review produces. It is the
single source of truth for what is wrong and what to do about it. Audit skills write it:
`code-ops-suite:codebase-audit`, `code-ops-suite:security-privacy-audit`, and the `rigor`
hunts (`bug-hunt`, `quality-scan`, `ground-truth`, `regression-hunt`, `safety-net`,
`test-suite-audit`, `rigor-sweep`). Remediation skills consume it: `code-ops-suite:remediation`
and `rigor:fix-verified`. Two skills sit outside the pattern. `pr-review` produces a
prioritized review and verdict as PR comments or as `REVIEW.md`, which is not a register.
`ship` consumes an intent, not the register.

## Exec summary (stop here if you only need the gist)

1. **Read the entry, not the headline.** Every finding carries a fixed schema (`CONVENTIONS §7`). Four fields decide whether to act *now*: **Tier** (is it real?), **Severity** (how bad?), **Track** (is it safe to apply unattended?), and **Verified-at** (was it confirmed against the code you are looking at?).
2. **Trust only what the Tier earns.** `CONFIRMED` was reproduced. `PROBABLE` rests on static evidence. `SPECULATIVE` is one lead. Only `CONFIRMED` items drive an automated fix.
3. **Prioritize by `impact × reach ÷ effort` (weighted by confidence), with severity as a floor** (`CONVENTIONS §8`). A `critical` item never sorts below a `low` one, whatever the arithmetic says.
4. **Route by Track.** `NOW-SAFE` means apply it, per your automation level. `NEEDS-REVIEW` means bring it to the developer with the recommendation. `NEEDS-DESIGN` means treat it as a proposal and decide direction first.
5. **Revalidate before you act.** A register can re-list items already fixed. Run `revalidate-register.mjs` and re-read any survivor. Never act on a stale entry.

---

## Reading a long register without reading all of it

A register outgrows one read long before it stops being useful. Two moves keep the read narrow.

Pre-filter first. At a phase boundary, run the freshness checker *before* any wholesale
register read, then read in full only the entries it did not call FRESH. The checker is
described under [Revalidation before you act](#revalidation-before-you-act).

Then skim what remains. `node scripts/skim.mjs <register.md>` prints the outline with line
ranges, so you read `--range A,B` for the entries you care about rather than the whole file.

## The schema, field by field

The canonical finding schema (`plugins/code-ops-suite/CONVENTIONS.md:78-82`) is:

```
ID · Title · Lens · Scope · Severity · Confidence · Tier (CONFIRMED|PROBABLE|SPECULATIVE) ·
Location (file:line) · Anchor (a verbatim ≤~40-char substring copied from the cited line, backtick- or quote-delimited) ·
Verified-at (sha the item was last confirmed on) · Evidence (redacted) ·
Disconfirmation (what you ruled out) · Refutation (independent: survived, or the guard that killed it) ·
Impact · Recommendation · Track (NOW-SAFE|NEEDS-REVIEW|NEEDS-DESIGN) · Effort · Risk-if-fixed
```

Here is a synthetic entry that exercises every field, annotated. It is illustrative and
describes no real code in this repository.

```markdown
### SEC-042 · IDOR: order lookup trusts client-supplied `accountId`            ← ID · Title
- **Lens:** security · **Scope:** orders API · **Severity:** high · **Confidence:** high
                                              ↑ floor for ranking   ↑ how sure you are of the claim
- **Tier:** CONFIRMED                          ← evidence strength: reproduced with a runnable repro
- **Location:** `src/api/orders.ts:88` (handler reads `req.query.accountId` and
  joins straight to `orders`), reached via route `src/router.ts:31`     ← every claim cites file:line
- **Anchor:** `req.query.accountId`             ← verbatim substring copied from the cited line, backtick-
  delimited so `revalidate-register.mjs` can parse it (undelimited = the DRIFTED check is skipped)
- **Verified-at:** c2b37e9                      ← the sha this was last confirmed against
- **Evidence:** `GET /orders?accountId=<OTHER_ACCT>` returned another tenant's
  order rows; auth middleware authenticates the *session* but never checks that
  `accountId` belongs to it. Secret/PII in the trace redacted to <REDACTED:pii>.  ← minimal, redacted
- **Disconfirmation:** ruled out a downstream row-level filter (none in the query
  builder `src/db/orders.ts:12`); ruled out a gateway-level tenant check (gateway
  config `infra/gateway.yaml:44` scopes by host, not account); reachable from the
  public router, not internal-only.                              ← what was checked and rejected
- **Refutation:** survived — an independent refuter hunted for a dominating tenant
  guard in the caller, middleware, and gateway and found none    ← an independent kill attempt, not self-review
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
| **Anchor** | A verbatim ≤~40-char substring copied from the cited line: backtick- or quote-delimited, e.g. `req.query.accountId` | Makes the citation mechanically checkable: `revalidate-register.mjs` flags a cited line that no longer contains it as `DRIFTED`. An undelimited anchor is unparseable and forfeits that check. |
| **Verified-at** | The sha the item was last confirmed on | If it ≠ current HEAD, re-confirm before acting (`§12`). |
| **Evidence** | Minimal, redacted proof or precise description | Lets you confirm the finding yourself. Secrets/PII → `<REDACTED:reason>` (`§4`). |
| **Disconfirmation** | What was ruled out (reachable? already handled? intentional? already tested?) | Tells you the finding survived a falsification pass: see [the disconfirmation pass](disconfirmation-pass.md). |
| **Refutation** | Whether an *independent* adversary tried to kill the finding (`§7`) | Load-bearing findings only: `survived` earns the severity; a cited guard means it was downgraded or dropped. |
| **Impact** | Concrete consequence + reach | Feeds the `× reach` term of the priority score. |
| **Recommendation** | The concrete fix | Your starting point; never vague. |
| **Track** | `NOW-SAFE` / `NEEDS-REVIEW` / `NEEDS-DESIGN` (`§6`) | The routing decision. See below. |
| **Effort** | Size of the fix | The `÷ effort` term of the priority score. |
| **Risk-if-fixed** | Blast radius of *the change itself* | A low-value, high-risk fix may be deferred even if cheap. |

> Some fields are commonly inlined or abbreviated in registers. `Proof`, `Root cause`, `Siblings`, and `Fix` can stand in for `Evidence` and `Recommendation`. The schema is the contract and the layout flexes. If a field is genuinely unknown, mark it `UNVERIFIED` with what would confirm it (`§9`).

---

## Tier and trust calibration

Tier is the honesty setting. The definitions (`CONVENTIONS §7`) are precise:

- **CONFIRMED:** reproduced through a failing test, a runnable repro, or an executed trace. Act on it.
- **PROBABLE:** backed by **two or more independent lines of static evidence**. Worth doing, but confirm before an automated fix.
- **SPECULATIVE:** a **single lead**. Investigate, and do not fix blind.

Two rules follow directly:

1. **Only `CONFIRMED` items drive an automated fix.** When a fixer or orchestrator applies changes unattended, it acts on `CONFIRMED` only. Everything else routes to a human first.
2. **When unsure between tiers, the author picks the lower one.** So a `PROBABLE` genuinely means "we have static signal but did not reproduce it." Your job on read is to reproduce it or down-tier it, never to assume it is true.

An operative labels a finding CONFIRMED only when an executed repro or trace appears in its
own transcript. A finding argued from static reading caps at PROBABLE, and the lead promotes
it on executed evidence.

The **Disconfirmation** field is your shortcut to trust. It records the falsification pass
the author already ran: is the code reachable, is it already handled by a caller, wrapper,
framework, or type, is it intentional, and is it already tested? A finding with a thin or
empty disconfirmation deserves more skepticism than its tier suggests.

The **Refutation** field records an independent kill attempt, and it carries receipts. A
critical or high finding that no executed repro proves needs at least one line in
`REFUTATION_LOG.md` keyed by its ID, and a critical finding needs an odd panel of three or
more. `node scripts/revalidate-register.mjs <register.md> --strict --profile finding
--refutation-log <REFUTATION_LOG.md>` validates presence, panel size, tally consistency, and
every REFUTED verdict's guard anchor.

---

## Prioritization across the whole file

A good register **leads with a ranked "top N highest-value"**, which is exactly what
`codebase-audit` produces. When you need to re-rank yourself, use the suite's rule
(`CONVENTIONS §8`):

> **Rank by `impact × reach ÷ effort`, weighted by confidence — with severity as a floor.**

In practice:

1. **Apply the severity floor first.** Every `critical` outranks every `high`, which outranks every `medium`, and so on. A `critical` item (data loss, a leak, a security breach, corruption) is surfaced immediately and never buried under a cheap but trivial win.
2. **Within a severity band, score `impact × reach ÷ effort`.** A `high` that hits every endpoint and takes an hour beats a `high` that hits one rarely used path and takes a week.
3. **Weight by confidence and tier.** A `PROBABLE` with `low` confidence drops below a `CONFIRMED` of equal nominal score, because you would spend effort confirming it before you could act at all.
4. **Sanity-check `Risk-if-fixed`.** A cheap fix with a high blast radius is not actually cheap, because it carries review and rollout cost. A public contract, a migration, or an auth path is such a case. Defer or escalate it rather than treating it as a quick win.

---

## Routing by Track

Track (`CONVENTIONS §6`) is the routing decision. It interacts with your **automation
level** (`§4`, default `gated`).

- **NOW-SAFE:** self-contained, local, small, and behavior-preserving, or an unambiguous bug with an obvious fix. It changes no contract, API, or schema. It is test-covered or quickly testable, and trivially revertible.
  → **Apply it.** Under `auto-safe` these can be applied unattended, each on a branch, test-backed, and revertible. Under `gated`, the default, they still pause for batch approval. Run the implementation loop (`§11`): re-validate, plan, implement, test, verify, self-review, commit referencing the ID, and close the loop.

- **NEEDS-REVIEW:** real and probably worth doing, but behavior-changing, contract-touching, non-trivial, or risky.
  → **Bring it to the developer with the concrete recommendation.** Never apply it unilaterally, even under `auto-safe`. Present numbered options, a recommendation, and a default, each with a one-line trade-off (`§3`).

- **NEEDS-DESIGN:** architectural or cross-cutting.
  → **Treat it as a proposal.** Decide direction first. Document the options and trade-offs, pick an approach with the developer, and only then split it into NOW-SAFE or NEEDS-REVIEW implementation items.

**Always gated, whatever the Track or automation level** (`§4`): security and auth changes,
secret handling, data migrations, destructive or irreversible operations, and public API or
contract changes. An entry tagged `*(always-gated: …)*`, as `SEC-042` is above, is a hard
stop for a human. It is never auto-applied and never auto-merged.

An item under `auto-safe` also passes
`node scripts/check-autofix-scope.mjs --interactive --level auto-safe` over its own diff
before it applies. A DENY mechanically reclassifies the item NEEDS-REVIEW, and a PASS never
by itself makes an item NOW-SAFE. With no operator present the gate denies everything.

---

## Revalidation before you act

A register is a *live* backlog, and the proven failure mode is a register that re-lists
items already fixed in code (`§12`). Two guards apply:

1. **Check `Verified-at` against current HEAD.** If they differ, the finding was confirmed on a different tree. Re-confirm that it still reproduces before acting.
2. **Run the mechanical freshness check:**

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register.md> --root <repo>
   ```

   It re-greps each cited `file:line` against the current tree. When an item carries a delimited `Anchor:`, it also re-checks that the anchor still sits on the cited line. It reports one status per item:

   | Status | Meaning | What to do |
   |---|---|---|
   | `FRESH` | Every cited `file:line` still exists and is in range | Re-read the location to confirm the defect survives: `FRESH` is a floor (the path exists), not proof the bug is still there. |
   | `MOVED` | File exists but the cited line is out of range | Re-locate and re-tier. |
   | `DRIFTED` | A cited line still exists but no longer contains the item's `Anchor:` substring | The citation drifted off the code it named (stale or hallucinated): re-locate it on the current tree and re-tier, or drop it. |
   | `GONE` | A cited file no longer exists | Likely resolved/moved: verify, then mark `OBSOLETE-AT <sha>` if fixed. |
   | `AMBIGUOUS` | Path gone but >1 file matches by name, or a ref escapes root | Verify by hand. |
   | `NO-REF` | The item cites no `file:line` | Can't be auto-checked: verify by hand. |

   It exits non-zero if any item is `MOVED`, `DRIFTED`, `GONE`, `AMBIGUOUS`, or `NO-REF`, which all need re-triage, unless you pass `--report-only`. Two advisories are non-gating. A `Verified-at` sha that differs from HEAD is a nudge to re-confirm, not a failure. So is an `Anchor:` whose value is not backtick- or quote-delimited, which is unparseable, so its `DRIFTED` check is skipped. A non-`FRESH` item is **re-triaged, never silently re-shown**.

Resolved findings are not deleted. Stamp them `OBSOLETE-AT <sha>` so the history stays
auditable.

---

## See also

- [The disconfirmation pass](disconfirmation-pass.md): the falsification discipline behind the `Disconfirmation` field and the tiers.
- [Choosing an automation level](choosing-an-automation-level.md): how `gated`, `auto-safe`, and `auto-all` change what you do with each Track.
- [Carrying a register across a phase boundary](register-carry-forward.md): the narrow move when one phase hands a register to the next.
- [Registers and freshness](../Handbook/04-registers-and-freshness.md): the full register schema, tracks, `Verified-at`, and `revalidate-register.mjs`.
- [Evidence and tiers](../Handbook/05-evidence-and-tiers.md): `CONFIRMED`, `PROBABLE`, and `SPECULATIVE` as lived practice.

*Verified-at: b0ffede*
