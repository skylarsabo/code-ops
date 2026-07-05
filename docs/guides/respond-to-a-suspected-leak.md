# Guide: Respond to a Suspected Leak

A user reports that the "anonymous" feedback widget seems to expose who submitted what. Or an error tracker shows a stack trace with a real client IP in it. Or someone notices that on a flaky network the app still loaded — which should have been impossible if the proxy had truly failed closed. You do not yet know whether any of these is real. You have a *suspicion*, a production system in motion, and an obligation not to make it worse while you find out.

This guide is the **incident journey** for that situation — the reactive path, not the proactive one. It is a narrative walk through `/privacy-opsec-suite:leak-incident-response` and then `/privacy-opsec-suite:opsec-hardening`, in order, on one suspected leak. Every command name, mode, phase, and produced artifact below is taken from the real plugin source under [`plugins/privacy-opsec-suite/`](../../plugins/privacy-opsec-suite/).

> **The incident contract (the one sentence to remember):** *contain it without making it worse — confirm from redacted evidence, never reproduce the live secret, and lock the leak shut with a regression test before you call it closed.* See [`plugins/privacy-opsec-suite/CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §A.

---

## Exec summary — the path, end to end

You can stop reading after this section and still run the journey correctly.

```
/privacy-opsec-suite:leak-incident-response   (Mode: REVIEW — proposes, never destroys)
  Phase 0  establish what's suspected           → checkpoint: confirm scope
  Phase 1  triage → contain → scope → plan
             triage      : real leak? confirm with redacted file:line evidence
             contain     : smallest change that stops it (fail-closed) — proposed
             blast radius : who could be deanonymized/linked, over what window, by whom
             root cause  : the underlying defect (proxy bypass, unredacted log, metadata)
             remediation : durable fix + a regression test that locks the leak shut
  Deliverables → incident report into OPSEC_RUNBOOK.md + a tracked entry in LEAK_REGISTER.md
                 + a proposed containment change (apply only with confirmation)

review LEAK_REGISTER.md → the incident entry is now a tracked, stable-ID leak

/privacy-opsec-suite:opsec-hardening           (Mode: IMPLEMENT — consumes the register)
  Phase 0  re-validate the register, sequence    → checkpoint
  Phase 1  implement the durable fix + regression test that fails if the leak returns
  Deliverables → fixes (atomic PRs), IMPLEMENTATION_LOG.md, updated register + opsec docs
```

Five rules carry the whole journey:

1. **The incident path is the reactive lane.** The audits hunt for leaks proactively; `leak-incident-response` is for a leak that is *suspected* and already in the wild ([`commands/privacy-opsec-suite.md`](../handbook/commands/privacy-opsec-suite.md#privacy-opsec-suiteleak-incident-response)).
2. **Do not make it worse to investigate.** Never add PII logging to chase the bug; work from redacted evidence ([`leak-incident-response/SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) Phase 0).
3. **Never reproduce a live secret, IP, or user identifier** — anywhere, including the incident report. Secrets and PII are radioactive; redact to `<REDACTED:reason>` ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). See [`docs/techniques/redaction-discipline.md`](../techniques/redaction-discipline.md).
4. **Contain small, fix durable.** Phase 1 proposes the *smallest* change that stops the bleeding; the durable fix and its regression test ship later through `opsec-hardening` with your go-ahead ([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) "Done when").
5. **A leak is not closed until a regression test locks it shut.** The fix is incomplete without a test that fails if the leak returns ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) Phase 1).

Both commands are **manual-invoke** (`disable-model-invocation: true`) — you call them; the model will not auto-trigger them. `leak-incident-response` runs in **REVIEW** mode (it analyzes and proposes; it makes no destructive change). `opsec-hardening` runs in **IMPLEMENT** mode and is the only step here that ships code — and because it changes the anonymity/opsec posture, it is **always gated** at every automation level ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).

```mermaid
sequenceDiagram
    actor Dev as You (privacy team)
    participant LIR as leak-incident-response
    participant RUN as OPSEC_RUNBOOK.md
    participant REG as LEAK_REGISTER.md
    participant OH as opsec-hardening

    Dev->>LIR: /privacy-opsec-suite:leak-incident-response
    Note over LIR: Phase 0 — what's suspected (checkpoint)<br/>redacted evidence only
    LIR-->>Dev: triage · proposed containment · blast radius · root cause · plan
    LIR-->>RUN: incident report (timeline, blast radius, root cause)
    LIR-->>REG: tracked leak entry (stable ID, Verified-at)
    Dev->>REG: read the incident entry, bless the durable fix
    Dev->>OH: /privacy-opsec-suite:opsec-hardening
    Note over OH: Phase 0 — re-validate register (checkpoint)
    OH-->>REG: durable fix + regression test; entry closed
    OH-->>RUN: updated opsec docs (IMPLEMENTATION_LOG.md)
```

For where `privacy-opsec-suite` sits among the four plugins — the anonymity track — see [`docs/handbook/02-mental-model.md`](../handbook/02-mental-model.md). For the model the whole suite enforces, see the primer [`docs/handbook/06-privacy-opsec-primer.md`](../handbook/06-privacy-opsec-primer.md). The proactive counterpart to this guide — hunting leaks before an incident — is [`docs/guides/audit-a-risky-subsystem.md`](audit-a-risky-subsystem.md) for the rigor side; on the privacy side the audits (`tor-egress-audit`, `metadata-leak-audit`, …) are the equivalent.

---

## Before you start

- **Work on a branch.** The suite commits atomically in reviewable chunks, never breaks the build, and keeps tests green ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).
- **Set the automation level once.** Default is `gated`. For an incident this is the right setting: every change here touches the anonymity/opsec posture, and **anything that changes the posture, an egress path, logging, identifiers, or a default is always gated regardless of level** ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). There is no "auto-fix" lane for a leak. See [`docs/techniques/choosing-an-automation-level.md`](../techniques/choosing-an-automation-level.md).
- **Know the radioactive rule before you touch anything.** Secrets and PII — live secrets, real client IPs, user identifiers, session tokens — are **radioactive**: redact to `<REDACTED:reason>` everywhere, and a discovered live secret is a **critical** finding reported by *location + rotation, never the value* ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). This rule governs your terminal, the incident report, the register, the commit message, and any message you send a teammate. [`docs/techniques/redaction-discipline.md`](../techniques/redaction-discipline.md) is the deep read.
- **Know where artifacts land.** Run artifacts go in a dated folder under your repo's docs location, e.g. `docs/privacy/<date>/` ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). On this two-command journey you will touch two of the standard filenames: `OPSEC_RUNBOOK.md` (the incident report) and `LEAK_REGISTER.md` (the tracked leak); `opsec-hardening` adds `IMPLEMENTATION_LOG.md`.

---

## Step 1 — `/privacy-opsec-suite:leak-incident-response`

**Mode:** REVIEW — analysis plus a *proposed* containment change; no destructive action. **Produces:** an incident report into `OPSEC_RUNBOOK.md`, a tracked entry in `LEAK_REGISTER.md`, and a proposed containment change you apply only with confirmation ([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) header).

The skill reads the bundled `CONVENTIONS.md` first — it is built on the same anonymity & OpSec model (§A), interaction protocol (§3), safety rails (§4), and leak schema (§6) as every other skill in the suite. Then it runs two phases.

### Phase 0 — Establish what's suspected *(checkpoint)*

You give it the suspicion in your own words: *"the anonymous feedback widget may be tying submissions back to users."* The skill captures three things — **the suspected leak, the affected area, and the timeline** — and it does so **without making it worse**. The instruction is explicit: *do not add PII logging to investigate.* You investigate from redacted evidence, not by instrumenting the live path with more identifiers.

> **CHECKPOINT.** It presents what it understands to be suspected and the investigation plan, and asks you to confirm scope. Anything clearly critical — say, it immediately spots a live API token in a log — is surfaced *now*, not held for the end of the phase ([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) Phase 0). This is the §3 protocol: a likely deanonymization vector is surfaced immediately.

You confirm: scope is the feedback widget's submission path and its server-side handler; the window is "since the widget shipped two weeks ago."

### Phase 1 — Triage → contain → scope → plan

This single phase moves through five moves in order — root cause sits inside it as a sub-stage of the plan, not as a separate named stage in the heading. Each maps to a line in the real SKILL.

**Triage — is it a real leak?** It confirms (or refutes) with redacted, `file:line` evidence and rules out false positives. This is the disconfirmation discipline the whole suite shares: a suspicion is not a finding until it is grounded. Suppose it traces the submission handler and finds the widget attaches the logged-in user's account id to the "anonymous" submission record. That is a real **linkability** leak — confirmed at `feedback/submit.ts:48` — not a false alarm.

> **Redaction in practice.** When it shows you the evidence, it does **not** paste a real account id or the submitter's identity. It shows the *shape* of the leak: the field name, the `file:line`, and a redacted sample like `record.userId = <REDACTED:account-id>`. The skill never emits real identifiers, IPs, or user data during analysis — it works from patterns and redacted samples ([`README.md`](../../plugins/privacy-opsec-suite/README.md) Notes; [`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). If the suspicion had been a leaked secret, you would get the location and a rotation instruction, never the secret value.

**Contain — the smallest immediate change that stops it.** Containment is the smallest change that stops the bleed: *fail-closed, disable the leaking path, block the egress.* For the widget, the smallest containment might be to stop persisting the `userId` field on the anonymous record (or to feature-flag the widget off) — proposed for you to apply, never applied destructively by the skill. Containment is a tourniquet, not the cure; it buys time for the durable fix.

**Blast radius — scope what was exposed.** It asks the four questions that define the damage: **what was exposed**, **who could be deanonymized or linked**, **over what time window**, and **observable by which adversary** (§A names them — the malicious operator/insider, the hosting provider, a cross-session correlator, and so on). For the widget: every "anonymous" submission since the widget shipped carried an account id; anyone with read access to the feedback store — operator, insider, or anyone who pulls a data export — could link each submission back to its author. That is the blast radius, stated without naming a single real user.

**Root cause — the underlying defect, not the symptom.** It traces past the symptom to the real defect. The SKILL names the usual suspects: *a fallback that bypassed the proxy, an unredacted log, a metadata field, a correlation vector.* For the widget the root cause is a correlation vector: the submission record reuses the authenticated request's user context instead of issuing an unlinkable submission. (For the "app still loaded on a flaky network" suspicion, the root cause would instead be a fallback that bypassed the proxy — a fail-closed violation.)

**Remediation plan — durable fix + a regression test that locks the leak shut.** It defines the durable fix *and* the test that pins it. The SKILL is explicit that the plan includes **a regression test that locks the leak shut** — the same discipline `opsec-hardening` will execute. The plan also covers **communication**: what to disclose, stated factually, **without over-collecting to investigate** (do not start logging more to write a better post-mortem).

### Deliverables of Step 1

Three things, none of them destructive:

1. An **incident report** into `OPSEC_RUNBOOK.md` — timeline, what leaked, blast radius, root cause, the durable fix, and the regression test ([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) Deliverables).
2. A **tracked entry in `LEAK_REGISTER.md`** — the incident becomes a first-class leak with a stable ID, so it flows into the same backlog the audits feed and `opsec-hardening` consumes ([`README.md`](../../plugins/privacy-opsec-suite/README.md) "How they chain": *leak-incident-response feeds urgent items into the same backlog*).
3. The **proposed containment change** — applied only with your confirmation.

**Done when** (Step 1): the leak is confirmed and scoped, containment is proposed, root cause is identified, and a remediation + regression test are defined; the report is written. The durable fix is *not* applied here — that goes through the hardening loop with your go-ahead ([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) "Done when").

---

## Step 2 — Read the `LEAK_REGISTER.md` entry

The incident is now a tracked leak. It shares the schema every leak in the suite uses (§6) — the same shape an audit would produce — so `opsec-hardening` cannot tell (and does not need to tell) whether it came from an incident or a sweep. Here is a synthetic entry for the widget leak so you can see the shape; **note that every redacted field uses `<REDACTED:reason>` and not a single real value**:

```markdown
# LEAK_REGISTER.md   (Verified-at: c2b37e9)

## NEEDS-REVIEW  (behavior-/contract-changing → bring to the developer)

### LEAK-021 · Anonymous feedback record carries the submitter's account id
- Lens:          Anonymity & linkability (primary)
- Adversary:     malicious operator/insider; anyone with read access to the feedback store
- Leak-class:    linkability
- Severity:      critical          (a real deanonymization — never "low", §7)
- Confidence:    high
- Tier:          CONFIRMED         (reproduced from redacted evidence at file:line)
- Location:      feedback/submit.ts:48
- Verified-at:   c2b37e9
- Evidence:      record.userId = <REDACTED:account-id>  (field persisted on the
                 "anonymous" submission; no real id reproduced)
- Scenario:      every anonymous submission is linkable to its author via the stored
                 userId; an operator export deanonymizes the entire feedback corpus
- Disconfirmation: not stripped downstream (traced submit→store); not intentional
                 (contradicts the "anonymous" promise); present since the widget shipped
- Impact:        all submissions in the last ~2 weeks; exposed to operator/insider/export
- Remediation:   issue an unlinkable submission; never attach request user context
- Regression:    test asserts a persisted feedback record contains no user identifier
- Track:         NEEDS-REVIEW      (changes the submission contract)
- Effort:        M   · Risk-if-fixed: medium
- Containment:   applied — userId no longer persisted (tourniquet; durable fix pending)
```

### How to read it before handing off

- **Severity for an anonymity regression is never "low" (§7).** A real deanonymization or linkability leak is `critical`. Rank by severity × exploitability.
- **The track tells you how it ships.** This entry is `NEEDS-REVIEW` because it changes the submission contract; it needs your eyes. Even a `NOW-SAFE` leak would still be gated here — *anything touching the anonymity/opsec posture is always gated regardless of automation level* ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).
- **Check `Verified-at` before you act.** Registers are the SSOT and must stay fresh ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). Before `opsec-hardening` consumes the entry, it re-confirms the leak still reproduces against the current tree. The mechanical pre-filter:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs LEAK_REGISTER.md --root .
```

It reports each item as `FRESH` / `MOVED` / `DRIFTED` / `GONE` / `AMBIGUOUS` / `NO-REF`; anything not `FRESH` is re-triaged, never silently re-shown ([`revalidate-register.mjs`](../../plugins/privacy-opsec-suite/scripts/revalidate-register.mjs) statuses; cf. [`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). For the register lifecycle and freshness, see [`docs/handbook/04-registers-and-freshness.md`](../handbook/04-registers-and-freshness.md); for reading findings by tier and track, [`docs/handbook/05-evidence-and-tiers.md`](../handbook/05-evidence-and-tiers.md).

**Your job at this checkpoint:** bless the durable fix. Containment stopped the bleeding; now you authorize `opsec-hardening` to ship the real fix and the test that locks it shut.

---

## Step 3 — `/privacy-opsec-suite:opsec-hardening`: ship the durable fix, locked shut

**Mode:** IMPLEMENT. **Consumes:** `LEAK_REGISTER.md`. **Produces:** fixes (branches/PRs), `IMPLEMENTATION_LOG.md`, an updated register, and updated opsec docs ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) header). This is the same loop the audit path uses to fix what the sweeps found — the incident simply fed one urgent item into the front of the backlog.

### Phase 0 — Plan from the leak backlog *(checkpoint)*

It reads `LEAK_REGISTER.md` and **re-validates first**: it runs `revalidate-register.mjs` (shown above) and triages the report, then confirms each surviving leak still reproduces — dropping or `OBSOLETE-AT <sha>`-ing anything already fixed. (If your containment tourniquet already removed the symptom, expect it to re-confirm that the *root cause* is still present before treating the durable fix as live.) It then sequences by severity — deanonymization and secret leaks first — so `LEAK-021`, a `critical` linkability leak, goes to the front.

> **CHECKPOINT.** It presents the re-validation results, the order/batching, and its PR preference. `LEAK-021` is `NEEDS-REVIEW`, so any changes require your go-ahead ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4/§6); were it `NEEDS-DESIGN`, the checkpoint would also solicit a direction before proceeding ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) Phase 0).

### Phase 1 — Implement the durable fix, with a regression test that fails if the leak returns

It runs the implementation loop (`CONVENTIONS.md` §10). Several common hardening moves **intentionally tighten behavior — which is the point** — and those are confirmed with you and pinned with tests. The SKILL's menu of common hardening covers exactly the defect classes an incident surfaces:

- enforce proxy/Tor routing and **fail-closed** on failure (no clearnet fallback) — the fix for the "app still loaded on a flaky network" suspicion;
- route DNS through the proxy; close WebRTC/IPv6 leaks;
- strip metadata (EXIF / document / build / source maps / headers);
- remove sensitive logging or route it through a redacting logger — the fix for an unredacted-IP-in-a-stack-trace incident;
- tighten cookie/session lifecycle; default-deny egress.

For the widget, the durable fix is to **issue an unlinkable submission** — never attach the authenticated request's user context to the anonymous record, fixed at the right layer (`feedback/submit.ts:48`), not a band-aid that scrubs the field after the fact.

Then the rule that closes the incident: **for every fix, add a regression test that fails if the leak returns.** The SKILL gives the pattern directly — *asserts no clearnet connect on proxy failure, no PII in a log line, EXIF stripped.* Here, the test asserts that a persisted feedback record contains **no user identifier**. That test failed against the leaking code and passes after the fix; if anyone ever reattaches user context, it fails again.

### Deliverables of Step 3

- **Fixes** as atomic PRs, tests green, each referencing the leak ID.
- An updated **`LEAK_REGISTER.md`** — `LEAK-021` marked done.
- **`IMPLEMENTATION_LOG.md`** — what changed, the behavior change and the decision behind it, and the verification.
- **Updated opsec docs** — the incident report in `OPSEC_RUNBOOK.md` now reflects a closed incident.

**Done when** (Step 3): leaks are fixed or deferred-with-reason; **fail-closed and isolation are verified on the actual implementation**; tests green; **regression tests lock the leaks shut**; and a final integration pass shows no new egress/log/identifier was introduced while fixing ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) "Done when").

The closed leak is then guarded going forward by `opsec-pr-gate`, which **blocks** any future change that re-adds egress, logging, identifiers, fingerprint surface, correlation, or weakened defaults — so the class cannot silently return through a later PR ([`README.md`](../../plugins/privacy-opsec-suite/README.md) Skills; [`commands/privacy-opsec-suite.md`](../handbook/commands/privacy-opsec-suite.md#privacy-opsec-suiteopsec-hardening)).

---

## The shape of a closed incident

In four artifacts, none of which contains a single live secret or real identifier:

1. A **proposed containment change** that stopped the bleed (the widget stopped persisting the user id) — a tourniquet, applied only with your confirmation.
2. An **incident report** in `OPSEC_RUNBOOK.md` and a **tracked, stable-ID entry** in `LEAK_REGISTER.md`, both stating the blast radius factually from redacted evidence.
3. A **durable fix at the root cause** (an unlinkable submission), shipped through `opsec-hardening` with your explicit, always-gated approval.
4. A **regression test that locks the leak shut** — failed before, passes after — plus the `opsec-pr-gate` backstop so the class cannot return.

A containment with no durable fix is an open incident; a fix with no regression test is not closed ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) "Done when").

---

## How this differs from the audit path

- **Trigger.** The audits (`tor-egress-audit`, `metadata-leak-audit`, `anon-session-audit`, …) *hunt* for leaks proactively, framed by `anonymity-threat-model`. `leak-incident-response` is the **reactive** entry point — a leak is already *suspected* in the wild ([`commands/privacy-opsec-suite.md`](../handbook/commands/privacy-opsec-suite.md#privacy-opsec-suiteleak-incident-response)).
- **Shared destination.** Both paths converge on `LEAK_REGISTER.md` and both hand off to `opsec-hardening`. The incident simply jumps the queue ([`README.md`](../../plugins/privacy-opsec-suite/README.md) "How they chain").
- **Driving it as one pass.** In `full-sweep`, the incident path is the separate incident entry point; the orchestrator otherwise runs model → audits → harden → docs/gate ([`commands/privacy-opsec-suite.md`](../handbook/commands/privacy-opsec-suite.md#privacy-opsec-suiteleak-incident-response)).

For the full command reference, see [`docs/handbook/commands/privacy-opsec-suite.md`](../handbook/commands/privacy-opsec-suite.md). For the model the whole suite enforces, the primer [`docs/handbook/06-privacy-opsec-primer.md`](../handbook/06-privacy-opsec-primer.md). For the redaction discipline that governs every step above, [`docs/techniques/redaction-discipline.md`](../techniques/redaction-discipline.md).

---

*Verified-at: a181b36*
