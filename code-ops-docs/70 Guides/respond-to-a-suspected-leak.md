# Respond to a suspected leak

This guide walks the reactive incident path: `/privacy-opsec-suite:leak-incident-response`
and then `/privacy-opsec-suite:opsec-hardening`, in order, over one suspected leak. Read it
when a leak may already be in the wild and you must not make it worse while you find out.
Every command, mode, phase, and artifact below comes from the plugin source under
[`plugins/privacy-opsec-suite/`](../../plugins/privacy-opsec-suite/).

A user reports that the "anonymous" feedback widget seems to expose who submitted what. Or an error
tracker shows a stack trace with a real client IP in it. Or someone notices that on a flaky network
the app still loaded, which should have been impossible if the proxy had truly failed closed. You do
not yet know whether any of these is real.

> **The incident contract, in one sentence:** contain it without making it worse, confirm from redacted evidence, never reproduce the live secret, and lock the leak shut with a regression test before you call it closed. See [`plugins/privacy-opsec-suite/CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §A.

---

## The path, end to end

You can stop reading after this section and still run the journey correctly.

```
/privacy-opsec-suite:leak-incident-response   (Mode: REVIEW, proposes, never destroys)
  Phase 0  establish what's suspected           → checkpoint: confirm scope
  Phase 1  triage → contain → scope → plan
             triage      : real leak? confirm with redacted file:line evidence
             contain     : smallest change that stops it (fail-closed), proposed
             blast radius : who could be deanonymized/linked, over what window, by whom
             root cause  : the underlying defect (proxy bypass, unredacted log, metadata)
             remediation : durable fix + a regression test that locks the leak shut
  Deliverables → incident report into OPSEC_RUNBOOK.md + a tracked entry in LEAK_REGISTER.md
                 + a proposed containment change (apply only with confirmation)

review LEAK_REGISTER.md → the incident entry is now a tracked, stable-ID leak

/privacy-opsec-suite:opsec-hardening           (Mode: IMPLEMENT, consumes the register)
  Phase 0  re-validate the register, sequence    → checkpoint
  Phase 1  implement the durable fix + regression test that fails if the leak returns
  Deliverables → fixes (atomic PRs), IMPLEMENTATION_LOG.md, updated register + opsec docs
```

Five rules carry the whole journey:

1. **The incident path is the reactive lane.** The audits hunt for leaks proactively. `leak-incident-response` is for a leak that is suspected and already in the wild ([`commands/privacy-opsec-suite.md`](../40 Engineering/Handbook/commands/privacy-opsec-suite.md#privacy-opsec-suiteleak-incident-response)).
2. **Do not make it worse to investigate.** Never add PII logging to chase the bug. Work from redacted evidence ([`leak-incident-response/SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) Phase 0).
3. **Never reproduce a live secret, IP, or user identifier** anywhere, including the incident report. Secrets and PII are radioactive, so redact to `<REDACTED:reason>` ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). See [`code-ops-docs/40 Engineering/Techniques/redaction-discipline.md`](../40 Engineering/Techniques/redaction-discipline.md).
4. **Contain small, fix durable.** Phase 1 proposes the smallest change that stops the bleeding. The durable fix and its regression test ship later through `opsec-hardening` with your approval ([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) "Done when").
5. **A leak is not closed until a regression test locks it shut.** The fix is incomplete without a test that fails if the leak returns ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) Phase 1).

Both commands can be called directly, or the model can route to them per the
standard-operating-mode routing card. `leak-incident-response` runs in REVIEW mode, so it analyzes
and proposes and makes no destructive change. `opsec-hardening` runs in IMPLEMENT mode and is the
only step here that ships code. Because it changes the anonymity and opsec posture, it is always
gated at every automation level ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).

```mermaid
sequenceDiagram
    actor Dev as You (privacy team)
    participant LIR as leak-incident-response
    participant RUN as OPSEC_RUNBOOK.md
    participant REG as LEAK_REGISTER.md
    participant OH as opsec-hardening

    Dev->>LIR: /privacy-opsec-suite:leak-incident-response
    Note over LIR: Phase 0, what is suspected (checkpoint)<br/>redacted evidence only
    LIR-->>Dev: triage · proposed containment · blast radius · root cause · plan
    LIR-->>RUN: incident report (timeline, blast radius, root cause)
    LIR-->>REG: tracked leak entry (stable ID, Verified-at)
    Dev->>REG: read the incident entry, bless the durable fix
    Dev->>OH: /privacy-opsec-suite:opsec-hardening
    Note over OH: Phase 0, re-validate register (checkpoint)
    OH-->>REG: durable fix + regression test; entry closed
    OH-->>RUN: updated opsec docs (IMPLEMENTATION_LOG.md)
```

For where `privacy-opsec-suite` sits among the four plugins, see
[`code-ops-docs/40 Engineering/Handbook/02-mental-model.md`](../40 Engineering/Handbook/02-mental-model.md).
For the model the whole suite enforces, see the primer
[`code-ops-docs/40 Engineering/Handbook/06-privacy-opsec-primer.md`](../40 Engineering/Handbook/06-privacy-opsec-primer.md).
The proactive counterpart, meaning hunting leaks before an incident, is
[Harden anonymity](harden-anonymity.md) on the privacy side and
[Audit a risky subsystem](audit-a-risky-subsystem.md) on the rigor side.

---

## Before you start

- **Work on a branch.** The suite commits atomically in reviewable chunks, never breaks the build, and keeps tests green ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).
- **Set the automation level once.** The default is `gated`, and for an incident that is the right setting. Every change here touches the anonymity and opsec posture, and anything that changes the posture, an egress path, logging, identifiers, or a default is always gated regardless of level ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). There is no auto-fix lane for a leak. See [`code-ops-docs/40 Engineering/Techniques/choosing-an-automation-level.md`](../40 Engineering/Techniques/choosing-an-automation-level.md).
- **Know the radioactive rule before you touch anything.** Live secrets, real client IPs, user identifiers, and session tokens are radioactive. Redact them to `<REDACTED:reason>` everywhere. A discovered live secret is a critical finding reported by location and rotation, never by value ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). This rule governs your terminal, the incident report, the register, the commit message, and any message you send a teammate. `co scan redaction <files>` is the mechanical check before an artifact leaves your machine, and [`code-ops-docs/40 Engineering/Techniques/redaction-discipline.md`](../40 Engineering/Techniques/redaction-discipline.md) is the deep read.
- **Know where artifacts land.** Run artifacts go in a dated folder under your repository's docs location, for example `docs/privacy/<date>/` ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). On this two-command journey you touch `OPSEC_RUNBOOK.md` for the incident report and `LEAK_REGISTER.md` for the tracked leak. `opsec-hardening` adds `IMPLEMENTATION_LOG.md`.

---

## Step 1 · `/privacy-opsec-suite:leak-incident-response`

**Mode:** REVIEW, meaning analysis plus a proposed containment change and no destructive action.
**Produces:** an incident report into `OPSEC_RUNBOOK.md`, a tracked entry in `LEAK_REGISTER.md`, and
a proposed containment change you apply only with confirmation
([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) header).

The skill reads the bundled `CONVENTIONS.md` first, because it is built on the same anonymity and
opsec model (§A), interaction protocol (§3), safety rails (§4), and leak schema (§6) as every other
skill in the suite. Then it runs two phases.

### Phase 0 · Establishing what is suspected (checkpoint)

You give it the suspicion in your own words: the anonymous feedback widget may be tying submissions
back to users. The skill captures the suspected leak, the affected area, and the timeline, and it
does so without making anything worse. The instruction is explicit: do not add PII logging to
investigate. You investigate from redacted evidence rather than by instrumenting the live path with
more identifiers.

Tracing a submission path under time pressure is where a run wastes the most context. Read the
handler with `co context skim <file>` first, then read only the range the outline names.
`co context graph` shows what reaches the store. Where `code-ops-suite` is installed,
`co context query callers <symbol>` returns every call site as a `file:line` anchor instead of a
grep dump, and its index refreshes after an edit through the `CODE_OPS_INDEX` PostToolUse hook,
which is on by default and switches off with `off`, `0`, or `false` in the `env` block of a
`.claude/settings.json`. The output digest compresses long command output the same way under
`CODE_OPS_DIGEST`, and it writes the raw text to a local file rather than into the transcript, which
matters when the output could carry a live value. See
[Contracts](../35 Contracts and Data/CONTRACTS.md) for the contracts and
[Infrastructure](../50 Platform/INFRASTRUCTURE.md) for the switches.

> **Checkpoint.** It presents what it understands to be suspected and the investigation plan, and it asks you to confirm scope. Anything clearly critical, such as a live API token spotted in a log, is surfaced now rather than held for the end of the phase ([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) Phase 0). That is the §3 protocol, under which a likely deanonymization vector is surfaced immediately.

You confirm the scope as the feedback widget's submission path and its server-side handler, over a
window running since the widget shipped two weeks ago.

### Phase 1 · Triage, contain, scope, plan

This single phase moves through five moves in order. Root cause sits inside it as a sub-stage of the
plan rather than as a separate named stage. Each move maps to a line in the real SKILL.

**Triage, meaning is it a real leak.** It confirms or refutes with redacted `file:line` evidence and
rules out false positives. This is the disconfirmation discipline the whole suite shares, because a
suspicion is not a finding until it is grounded. Suppose it traces the submission handler and finds
the widget attaches the logged-in user's account id to the "anonymous" submission record. That is a
real linkability leak, confirmed at `feedback/submit.ts:48`, not a false alarm.

> **Redaction in practice.** When it shows you the evidence, it does not paste a real account id or the submitter's identity. It shows the shape of the leak: the field name, the `file:line`, and a redacted sample such as `record.userId = <REDACTED:account-id>`. The skill never emits real identifiers, IPs, or user data during analysis, because it works from patterns and redacted samples ([`README.md`](../../plugins/privacy-opsec-suite/README.md) Notes, [`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). Had the suspicion been a leaked secret, you would get the location and a rotation instruction, never the secret value.

**Contain, meaning the smallest immediate change that stops it.** Containment fails closed, disables
the leaking path, or blocks the egress. For the widget, the smallest containment might be to stop
persisting the `userId` field on the anonymous record, or to feature-flag the widget off. The skill
proposes it for you to apply and never applies it destructively. Containment buys time for the
durable fix.

**Blast radius, meaning scope what was exposed.** It asks the four questions that define the damage:
what was exposed, who could be deanonymized or linked, over what time window, and observable by
which adversary. §A names the adversaries, including the malicious operator or insider, the hosting
provider, and a cross-session correlator. For the widget: every anonymous submission since the
widget shipped carried an account id, so anyone with read access to the feedback store could link
each submission back to its author. That is the blast radius, stated without naming a single real
user.

**Root cause, meaning the underlying defect rather than the symptom.** It traces past the symptom to
the real defect. The SKILL names the usual suspects: a fallback that bypassed the proxy, an
unredacted log, a metadata field, or a correlation vector. For the widget the root cause is a
correlation vector, because the submission record reuses the authenticated request's user context
instead of issuing an unlinkable submission. For the "app still loaded on a flaky network"
suspicion, the root cause would instead be a fallback that bypassed the proxy, meaning a fail-closed
violation.

**Remediation plan, meaning the durable fix plus a regression test that locks the leak shut.** It
defines the durable fix and the test that pins it. The SKILL is explicit that the plan includes a
regression test that locks the leak shut, which is the same discipline `opsec-hardening` executes.
The plan also covers communication: what to disclose, stated factually, without over-collecting to
investigate. Do not start logging more to write a better post-mortem.

### Deliverables of Step 1

Three things, none of them destructive:

1. An incident report into `OPSEC_RUNBOOK.md`, covering timeline, what leaked, blast radius, root cause, the durable fix, and the regression test ([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) Deliverables).
2. A tracked entry in `LEAK_REGISTER.md`, so the incident becomes a first-class leak with a stable ID that flows into the same backlog the audits feed and `opsec-hardening` consumes ([`README.md`](../../plugins/privacy-opsec-suite/README.md) "How they chain").
3. The proposed containment change, applied only with your confirmation.

**Done when** (Step 1): the leak is confirmed and scoped, containment is proposed, root cause is
identified, a remediation and regression test are defined, and the report is written. The durable
fix is not applied here, because it goes through the hardening loop with your approval
([`SKILL.md`](../../plugins/privacy-opsec-suite/skills/leak-incident-response/SKILL.md) "Done when").

---

## Step 2 · Reading the `LEAK_REGISTER.md` entry

The incident is now a tracked leak. It shares the schema every leak in the suite uses (§6), meaning
the same shape an audit would produce, so `opsec-hardening` does not need to tell whether it came
from an incident or a sweep. Here is a synthetic entry for the widget leak, in which every redacted
field uses `<REDACTED:reason>` and not a single real value:

```markdown
# LEAK_REGISTER.md   (Verified-at: c2b37e9)

## NEEDS-REVIEW  (behavior-/contract-changing → bring to the developer)

### LEAK-021 · Anonymous feedback record carries the submitter's account id
- Lens:          Anonymity & linkability (primary)
- Adversary:     malicious operator/insider; anyone with read access to the feedback store
- Leak-class:    linkability
- Severity:      critical          (a real deanonymization; never "low", §7)
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
- Containment:   applied; userId no longer persisted (durable fix pending)
```

### How to read it before handing off

- **Severity for an anonymity regression is never low (§7).** A real deanonymization or linkability leak is critical. Rank by severity times exploitability.
- **The track tells you how it ships.** This entry is NEEDS-REVIEW because it changes the submission contract, so it needs your eyes. Even a NOW-SAFE leak would still be gated here, because anything touching the anonymity or opsec posture is always gated regardless of automation level ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).
- **Check `Verified-at` before you act.** Registers are the single source of truth and must stay fresh ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). Before `opsec-hardening` consumes the entry, it re-confirms the leak still reproduces against the current tree. The mechanical pre-filter:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs LEAK_REGISTER.md --root .
```

It reports each item as `FRESH`, `MOVED`, `DRIFTED`, `GONE`, `AMBIGUOUS`, or `NO-REF`. Anything not
`FRESH` is re-triaged and never silently re-shown
([`revalidate-register.mjs`](../../plugins/privacy-opsec-suite/scripts/revalidate-register.mjs)
statuses, compare
[`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). For the register lifecycle
and freshness, see
[`code-ops-docs/40 Engineering/Handbook/04-registers-and-freshness.md`](../40 Engineering/Handbook/04-registers-and-freshness.md).
For reading findings by tier and track, see
[`code-ops-docs/40 Engineering/Handbook/05-evidence-and-tiers.md`](../40 Engineering/Handbook/05-evidence-and-tiers.md).

**Your job at this checkpoint:** bless the durable fix. Containment stopped the bleeding, and now
you authorize `opsec-hardening` to ship the real fix and the test that locks it shut.

---

## Step 3 · `/privacy-opsec-suite:opsec-hardening`, shipping the durable fix

**Mode:** IMPLEMENT. **Consumes:** `LEAK_REGISTER.md`. **Produces:** fixes as branches or pull
requests, `IMPLEMENTATION_LOG.md`, an updated register, and updated opsec docs
([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md)
header). This is the same loop the audit path uses to fix what the sweeps found. The incident simply
fed one urgent item into the front of the backlog.

### Phase 0 · Plan from the leak backlog (checkpoint)

It reads `LEAK_REGISTER.md` and re-validates first. It runs `revalidate-register.mjs`, shown above,
triages the report, then confirms each surviving leak still reproduces, dropping or marking
`OBSOLETE-AT <sha>` anything already fixed. If your containment already removed the symptom, expect
it to re-confirm that the root cause is still present before treating the durable fix as live. It
then sequences by severity, so deanonymization and secret leaks go first and `LEAK-021`, a critical
linkability leak, goes to the front.

> **Checkpoint.** It presents the re-validation results, the order and batching, and its pull-request preference. `LEAK-021` is NEEDS-REVIEW, so any change requires your approval ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4, §6). Were it NEEDS-DESIGN, the checkpoint would also ask for a direction before proceeding ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) Phase 0).

### Phase 1 · Implementing the durable fix with a regression test

It runs the implementation loop (`CONVENTIONS.md` §10). Several common hardening moves intentionally
tighten behavior, which is the point, and those are confirmed with you and pinned with tests. The
SKILL's menu of common hardening covers the defect classes an incident surfaces:

- enforce proxy and Tor routing and fail closed on failure with no clearnet fallback, which fixes the "app still loaded on a flaky network" suspicion
- route DNS through the proxy and close WebRTC and IPv6 leaks
- strip metadata from EXIF, documents, builds, source maps, and headers
- remove sensitive logging or route it through a redacting logger, which fixes an unredacted-IP-in-a-stack-trace incident
- tighten the cookie and session lifecycle, and default-deny egress

For the widget, the durable fix is to issue an unlinkable submission, never attaching the
authenticated request's user context to the anonymous record. It lands at the right layer,
`feedback/submit.ts:48`, rather than as a patch that scrubs the field after the fact.

Then the rule that closes the incident: for every fix, add a regression test that fails if the leak
returns. The SKILL gives the pattern directly, asserting no clearnet connect on proxy failure, no
PII in a log line, and EXIF stripped. Here, the test asserts that a persisted feedback record
contains no user identifier. That test failed against the leaking code and passes after the fix. If
anyone ever reattaches user context, it fails again.

### Deliverables of Step 3

- **Fixes** as atomic pull requests, tests green, each referencing the leak ID.
- **An updated `LEAK_REGISTER.md`,** with `LEAK-021` marked done.
- **`IMPLEMENTATION_LOG.md`,** recording what changed, the behavior change and the decision behind it, and the verification.
- **Updated opsec docs,** so the incident report in `OPSEC_RUNBOOK.md` now reflects a closed incident.

**Done when** (Step 3): leaks are fixed or deferred with a reason, fail-closed and isolation are
verified on the actual implementation, tests are green, regression tests lock the leaks shut, and a
final integration pass shows no new egress, log line, or identifier was introduced while fixing
([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md)
"Done when").

The closed leak is then guarded going forward by `opsec-pr-gate`, which blocks any future change
that re-adds egress, logging, identifiers, fingerprint surface, correlation, or weakened defaults,
so the class cannot silently return through a later pull request
([`README.md`](../../plugins/privacy-opsec-suite/README.md) Skills,
[`commands/privacy-opsec-suite.md`](../40 Engineering/Handbook/commands/privacy-opsec-suite.md#privacy-opsec-suiteopsec-hardening)).
For wiring that gate into CI, see [Wire CI gates](wire-ci-gates.md).

---

## The shape of a closed incident

Four artifacts, none of which contains a live secret or a real identifier:

1. A proposed containment change that stopped the bleed, because the widget stopped persisting the user id, applied only with your confirmation.
2. An incident report in `OPSEC_RUNBOOK.md` and a tracked, stable-ID entry in `LEAK_REGISTER.md`, both stating the blast radius factually from redacted evidence.
3. A durable fix at the root cause, meaning an unlinkable submission, shipped through `opsec-hardening` with your explicit, always-gated approval.
4. A regression test that locks the leak shut, failing before and passing after, plus the `opsec-pr-gate` backstop so the class cannot return.

A containment with no durable fix is an open incident. A fix with no regression test is not closed
([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md)
"Done when").

---

## Differences from the audit path

- **Trigger.** The audits hunt for leaks proactively, framed by `anonymity-threat-model`. `leak-incident-response` is the reactive entry point, used when a leak is already suspected in the wild ([`commands/privacy-opsec-suite.md`](../40 Engineering/Handbook/commands/privacy-opsec-suite.md#privacy-opsec-suiteleak-incident-response)).
- **Shared destination.** Both paths converge on `LEAK_REGISTER.md` and both hand off to `opsec-hardening`. The incident jumps the queue ([`README.md`](../../plugins/privacy-opsec-suite/README.md) "How they chain").
- **Driving it as one pass.** In `full-sweep`, the incident path is the separate incident entry point. The orchestrator otherwise runs model, audits, harden, then docs and gate. See [Harden anonymity](harden-anonymity.md).

For the full command reference, see
[`code-ops-docs/40 Engineering/Handbook/commands/privacy-opsec-suite.md`](../40 Engineering/Handbook/commands/privacy-opsec-suite.md).
For the model the whole suite enforces, see the primer
[`code-ops-docs/40 Engineering/Handbook/06-privacy-opsec-primer.md`](../40 Engineering/Handbook/06-privacy-opsec-primer.md).
For the redaction discipline that governs every step above, see
[`code-ops-docs/40 Engineering/Techniques/redaction-discipline.md`](../40 Engineering/Techniques/redaction-discipline.md).

---

*Verified-at: b0ffede*
