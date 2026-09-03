# Harden anonymity

This guide walks `/privacy-opsec-suite:full-sweep` end to end over one service whose users
must stay unidentifiable. Read it when you need every anonymity leak in your own code
found, fixed so it fails closed, and locked shut against a future commit. Every command,
mode, phase, artifact, and script below comes from the plugin source under
[`plugins/privacy-opsec-suite/`](../../plugins/privacy-opsec-suite/).

You run a service whose whole reason to exist is that nobody can tell who used it: a tip line, a
circumvention tool, or an at-risk-user app routed over Tor. A single clearnet fallback, one logged
IP, or one stable identifier that survives logout exposes a real person.

> **The stance, in one sentence:** this is defensive privacy engineering, so protect your system's own users' anonymity, find and fix leaks in your own code, and stay anonymous by default and fail closed. See [`plugins/privacy-opsec-suite/CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §0 and §A.

---

## The path, end to end

You can stop reading after this section and still run the journey correctly.

```
/privacy-opsec-suite:full-sweep
  Phase 0  Scope the run            → track, adversaries, automation level (checkpoint)
  Phase 1  anonymity-threat-model   → ANONYMITY_THREAT_MODEL.md (keystone; go/no-go)
  Phase 2  six parallel audits      → merged LEAK_REGISTER.md (ranked leaks; checkpoint)
             anon-session-audit · tor-egress-audit · metadata-leak-audit
             fingerprint-resistance · traffic-analysis-resistance · supply-chain-trust
  Phase 3  opsec-hardening          → fail-closed fixes, each pinned by a regression test
  Phase 4  privacy-doc-alignment    → reconciled docs + SSOT; wire opsec-pr-gate into CI
```

Five rules carry the whole journey:

1. **The threat model comes first and frames everything.** `anonymity-threat-model` is the keystone artifact, and every audit references it ([`anonymity-threat-model/SKILL.md`](../../plugins/privacy-opsec-suite/skills/anonymity-threat-model/SKILL.md)).
2. **Fail closed, never open.** On any proxy, route, or circuit failure the system stops. It never falls back to clearnet or a less-anonymous path ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §A).
3. **The register is the single source of truth.** All six audits merge into one `LEAK_REGISTER.md` with stable IDs, and it stays fresh ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §6, §11).
4. **Every fix is pinned by a regression test that fails if the leak returns.** A hardening change without that test is not done ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md)).
5. **Anonymity-affecting changes are always gated.** Anything touching egress, logging, identifiers, fingerprint surface, or a default pauses for your approval at every automation level ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).

You can call `full-sweep` directly, or the model can route to it per the standard-operating-mode
routing card. The checkpoints below apply either way. It is the intra-plugin orchestrator, so it
sequences only this suite's skills. The cross-plugin orchestrator that spans the spine, the rigor
verification layer, and this anonymity track is the code-ops-suite `everything` orchestrator, which
requires all three plugins. Reach for it only when the work crosses plugin boundaries. This guide
runs `full-sweep` step by step so you can see and approve each checkpoint.

```mermaid
sequenceDiagram
    actor Dev as You
    participant FS as full-sweep
    participant TM as anonymity-threat-model
    participant AU as six parallel audits
    participant LR as LEAK_REGISTER.md
    participant HD as opsec-hardening
    participant DG as privacy-doc-alignment + opsec-pr-gate

    Dev->>FS: /privacy-opsec-suite:full-sweep
    FS->>Dev: Phase 0, scope, track, adversaries (checkpoint)
    FS->>TM: Phase 1, model
    TM-->>LR: ANONYMITY_THREAT_MODEL.md + concrete leaks
    TM->>Dev: worst paths, go/no-go (checkpoint)
    FS->>AU: Phase 2, bounded waves (read-only)
    AU-->>LR: merged, ranked leaks
    AU->>Dev: clearnet/DNS/identifier exposure first (checkpoint)
    FS->>HD: Phase 3, harden (writes code)
    HD-->>LR: fixes; each leak pinned by a regression test
    HD->>Dev: per-batch approval (always gated)
    FS->>DG: Phase 4, docs and gate
    DG-->>Dev: reconciled SSOT + wired opsec-pr-gate
```

For where the anonymity track sits among the four plugins, see
[`code-ops-docs/40 Engineering/Handbook/06-privacy-opsec-primer.md`](../40 Engineering/Handbook/06-privacy-opsec-primer.md).
For the full command reference, see
[`code-ops-docs/40 Engineering/Handbook/commands/privacy-opsec-suite.md`](../40 Engineering/Handbook/commands/privacy-opsec-suite.md).

---

## Before you start

- **Work on a branch.** The suite commits atomically in reviewable chunks and never breaks the build ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).
- **Set the automation level once.** The default is `gated`, which pauses for approval at each fix or closure batch. `auto-safe` is the recommended ceiling and auto-applies only NOW-SAFE items, confirming first any opsec tightening that is itself the fix. Either way, anything that changes the anonymity or opsec posture, an egress path, logging, identifiers, or a default is always gated regardless of level, and nothing is ever auto-merged ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). See [`code-ops-docs/40 Engineering/Techniques/choosing-an-automation-level.md`](../40 Engineering/Techniques/choosing-an-automation-level.md).
- **Know where artifacts land.** Run artifacts go in a dated folder under your repository's docs location, for example `docs/privacy/<date>/` ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). The standard filenames are `ANONYMITY_THREAT_MODEL.md`, `LEAK_REGISTER.md`, `OPSEC_RUNBOOK.md`, and `EXECUTIVE_SUMMARY.md`. The threat model, privacy promises, and opsec runbooks are the single source of truth, reconciled in place as code changes.
- **The suite never emits real user data.** Skills work from patterns and redacted samples. A discovered live secret is reported by location and rotation, never by value ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).
- **Know the reading tools.** The audits read a lot of code, so read structure before body. `co context skim <file>` returns an outline and `co context skim <file> --range A,B` returns a range. `co context map` and `co context graph` render the repository map and the import graph. All three resolve inside `privacy-opsec-suite`. `co scan redaction <files>` is the mechanical check that a produced artifact carries no live value.

---

## Phase 0 · Scoping the run (checkpoint)

`full-sweep` opens by detecting your stack and repository size, then confirms three things with you
([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 0):

- **Track.** `audit-only` reads and documents without changing code. `full` runs audit, then harden, then docs and gate. A custom subset is also possible. For this journey pick `full`, because you want the leaks found and fixed.
- **The adversaries to emphasize.** The model assumes a standing cast ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §A): a passive network observer including a global passive adversary correlating traffic, an active network attacker, a malicious or compromised operator or insider, the hosting and infrastructure provider, legal coercion and subpoena, a compromised dependency or build, a malicious peer, and an adversary correlating activity across sessions and over time. For a Tor-routed tip line, emphasize the passive network observer and the legal-coercion adversary.
- **Scope, pull-request preference, and whether code-changing phases are pre-approved or gated each time.**

It opens a master todo and a running `EXECUTIVE_SUMMARY.md` across phases. One standing instruction
from the skill: it surfaces any suspected deanonymization or leak to you immediately, in any phase.
It does not wait for a checkpoint to deliver bad news.

> **Incident path, which is separate.** If a leak is suspected rather than sought, meaning you think a user was already exposed, do not start here. Start with `/privacy-opsec-suite:leak-incident-response` and feed its output into the same `LEAK_REGISTER.md`. See [Respond to a suspected leak](respond-to-a-suspected-leak.md).

---

## Phase 1 · `anonymity-threat-model`, the keystone

**Mode:** AUDIT and DOCUMENT. **Produces:** `ANONYMITY_THREAT_MODEL.md`, and it feeds concrete
leaks into `LEAK_REGISTER.md`. The model is a durable, reusable artifact.

This runs first because everything downstream references it
([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 1). The
six audits are not a blind checklist. Each one is aimed by the paths this model surfaces.

- **Phase 0 · Inventory assets, adversaries, and goals (checkpoint).** It enumerates the assets that identify or link a user: real IP and location, account or session identifiers, behavioral patterns, device characteristics, metadata, and anything correlatable across sessions or time. It lays out the adversaries (§A) and trust boundaries, and it states the system's anonymity goals of unlinkability, unobservability, deniability, and data minimization ([`anonymity-threat-model/SKILL.md`](../../plugins/privacy-opsec-suite/skills/anonymity-threat-model/SKILL.md) Phase 0).
- **Phase 1 · Map deanonymization paths.** For each adversary and asset pair it works out how the adversary could observe, link, or deanonymize, at the network, session, application, metadata, dependency, and operator or legal layers. It marks where anonymity depends on a control, meaning proxy routing, isolation, minimization, or fail-closed, and what happens when that control fails. It rates residual risk per path and cross-checks every stated promise against whether the system actually keeps it.

> **Checkpoint, go or no-go.** It presents the worst deanonymization paths first ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 1). For the tip line, suppose the worst path is this: on Tor circuit failure the HTTP client retries directly, so the user's real IP reaches the destination. That single path frames the entire `tor-egress-audit` to come. You confirm the model and approve proceeding.

The model is the keystone because a leak found by an audit means little until you can name which
adversary exploits it and what user property it exposes. The model supplies that frame, and the
register schema below makes every audit fill it in.

---

## Phase 2 · Six parallel audits into one `LEAK_REGISTER.md`

**Mode:** AUDIT, read-only, with no code changes. `full-sweep` parallelizes independent audits in
bounded waves, then merges everything into `LEAK_REGISTER.md` (schema §6)
([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 2).
Read-only analysis uses the available concurrency without exceeding the orchestrator's wave limit
([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §1), and every wave converges
on one register.

Each audit owns a non-overlapping lens. Knowing the boundaries tells you which audit a leak belongs
to:

| Audit | Owns | Leak-class (§6) |
| --- | --- | --- |
| [`anon-session-audit`](../../plugins/privacy-opsec-suite/skills/anon-session-audit/SKILL.md) | Are sessions truly unlinkable: identifiers, lifecycle, hidden persistent IDs, cross-session correlation | `linkability` / `identification` |
| [`tor-egress-audit`](../../plugins/privacy-opsec-suite/skills/tor-egress-audit/SKILL.md) | No traffic leaks the user: proxy enforcement, fail-closed, DNS/WebRTC/IPv6 leaks, stream isolation, onion-service hygiene | `egress` / `observability` |
| [`metadata-leak-audit`](../../plugins/privacy-opsec-suite/skills/metadata-leak-audit/SKILL.md) | At-rest and in-band metadata: PII in logs, telemetry, errors, embedded file metadata, headers, retention | `metadata` / `observability` |
| [`fingerprint-resistance`](../../plugins/privacy-opsec-suite/skills/fingerprint-resistance/SKILL.md) | Identity-fingerprint distinctiveness: header, TLS, JA3, behavioral uniqueness, homogenization | `identification` / `correlation` |
| [`traffic-analysis-resistance`](../../plugins/privacy-opsec-suite/skills/traffic-analysis-resistance/SKILL.md) | Traffic-shape correlation: timing, size, volume side channels, padding, batching | `observability` / `correlation` |
| [`supply-chain-trust`](../../plugins/privacy-opsec-suite/skills/supply-chain-trust/SKILL.md) | Dependencies that do not betray anonymity: telemetry, phone-home, egress, CVEs, build integrity | `egress` / `secret` |

Four load-bearing details from the audit sources:

- **`tor-egress-audit` catches the worst path.** It enumerates every outbound path and classifies each as anonymized, intentionally clear, or a leak. It then verifies that routing actually holds: proxy enforcement with no client or library bypass, fail-closed on every error and retry path, DNS resolved through the proxy with SOCKS5h or remote DNS rather than the system resolver, stream and connection isolation, onion-service hygiene, and leak vectors such as WebRTC and STUN, IPv6 when the proxy is IPv4-only, NTP, captive-portal checks, `Referer`, and redirect chains. Any clearnet or DNS leak is reported critical. WebRTC is in scope as a leak vector but is not named in the skill's critical-severity declaration ([`tor-egress-audit/SKILL.md`](../../plugins/privacy-opsec-suite/skills/tor-egress-audit/SKILL.md)).
- **Control coverage is multi-boundary.** For any anonymity control, meaning proxy enforcement, fail-closed, isolation, redaction, or a feature gate, the audits enumerate every entry point and runtime that can reach the protected action and verify the control at each. A control enforced at one boundary but not enumerated at the others is a leak, not a pass ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §9).
- **`traffic-analysis-resistance` is honest about limits.** Full protection against a global passive adversary is generally out of scope. The skill reduces correlatability rather than eliminating it, and it says so in its summary ([`traffic-analysis-resistance/SKILL.md`](../../plugins/privacy-opsec-suite/skills/traffic-analysis-resistance/SKILL.md)).
- **`supply-chain-trust` treats telemetry as an anonymity finding** rather than bloat. A dependency that phones home opens an egress path and is registered as one ([`supply-chain-trust/SKILL.md`](../../plugins/privacy-opsec-suite/skills/supply-chain-trust/SKILL.md)).

Enumerating every outbound path is the most context-expensive move in this phase. Read a large
network module with `co context skim <file>` first, then read only the range the outline names, and
use `co context graph` to see what reaches the client. Where `code-ops-suite` is also installed,
`co context query callers <symbol>` and `co context query blast <symbol>` return `file:line` anchors
for every call site instead of a grep dump. The symbol index refreshes after an edit through the
`CODE_OPS_INDEX` PostToolUse hook, which is on by default and switches off with `off`, `0`, or
`false` in the `env` block of a `.claude/settings.json`. The output digest compresses long command
output the same way under `CODE_OPS_DIGEST`. See
[Contracts](../35 Contracts and Data/CONTRACTS.md) for both contracts and
[Infrastructure](../50 Platform/INFRASTRUCTURE.md) for both switches.

### A synthetic `LEAK_REGISTER.md` snippet

All six audits write into one register. It is a live backlog and single source of truth with stable
IDs that persist across the whole lifecycle, from `EGRESS-003` to the register to the commit
([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §6 and §11). The full schema
is §6. Here is a synthetic snippet for the tip-line audit, with evidence redacted as the safety
rails require (§4):

```markdown
# LEAK_REGISTER.md   (Verified-at: c2b37e9)

## critical  (deanonymization / secret; fix first)

### EGRESS-003 · HTTP client falls back to clearnet on Tor circuit failure
- Lens:           Egress & routing
- Adversary:      passive network observer; legal/coercion
- Leak-class:     egress
- Severity:       critical      · Confidence: high · Tier: CONFIRMED
- Location:       net/client.ts:142  (retry path bypasses the SOCKS proxy)
- Verified-at:    c2b37e9
- Evidence:       on circuit error the retry constructs a direct agent (no proxy);
                  request reaches the destination over the host's real route
- Scenario:       circuit drops → retry connects directly → user's real IP + DNS
                  reach the destination; one failure deanonymizes the user
- Disconfirmation: not gated upstream (traced); no env flag disables the fallback;
                  not intentional (contradicts the threat model's fail-closed promise)
- Impact:         every user on any transient circuit failure; highest blast radius
- Remediation:    remove the direct-agent fallback; on proxy failure, fail closed
                  (abort the request, surface an error)
- Track:          NEEDS-REVIEW   (intentionally tightens behavior; confirm)
- Effort:         S   · Risk-if-fixed: low

### DNS-001 · Hostname resolved via system resolver before proxying
- Lens:           Egress & routing
- Adversary:      passive network observer (ISP)
- Leak-class:     egress
- Severity:       critical      · Confidence: high · Tier: CONFIRMED
- Location:       net/resolve.ts:31  (getaddrinfo before the SOCKS connect)
- Verified-at:    c2b37e9
- Evidence:       local getaddrinfo() runs prior to the proxied connect
- Scenario:       the ISP sees the DNS query even when the connection is proxied,
                  a clearnet DNS leak that links the user to the destination
- Disconfirmation: SOCKS5h (remote DNS) is available in the library but not used here
- Remediation:    resolve through the proxy (SOCKS5h / remote DNS); remove the
                  local lookup; pin with a test asserting no system-resolver call
- Track:          NOW-SAFE
- Effort:         S   · Risk-if-fixed: low

## high

### LINK-005 · Session token survives "logout" in localStorage
- Lens:           Anonymity & linkability
- Adversary:      cross-session correlator; malicious operator
- Leak-class:     linkability
- Severity:       high         · Confidence: high · Tier: CONFIRMED
- Location:       web/session.ts:88  (logout clears the cookie, not localStorage)
- Verified-at:    c2b37e9
- Scenario:       a returning "anonymous" user is silently re-associated with the
                  prior session; breaks unlinkability across sessions
- Disconfirmation: not cleared by any other teardown path (enumerated all of them)
- Remediation:    clear all session state on logout; add a test asserting storage is empty
- Track:          NOW-SAFE
- Effort:         S   · Risk-if-fixed: low

### META-002 · Real client IP written to the request access log
- Lens:           Metadata minimization
- Adversary:      malicious operator/insider; legal/coercion
- Leak-class:     metadata
- Severity:       high         · Confidence: high · Tier: CONFIRMED
- Location:       server/log.ts:54
- Scenario:       what is not collected cannot leak or be compelled; a logged IP is
                  exactly the record a subpoena reaches
- Remediation:    drop the IP field / route through a redacting logger
- Track:          NEEDS-REVIEW   (changes logging; always gated, §4)

## PROBABLE  (reproduce before fixing)

### FP-009 · TLS (JA3) fingerprint distinguishes this client
- Tier:           PROBABLE  (two static evidence lines: a non-standard cipher order
                  in tls/config.ts:19 + a unique ALPN set; no live JA3 capture yet)
- Lens:           Identification & fingerprinting
- Remediation:    homogenize the TLS profile toward the Tor Browser baseline
- Track:          NEEDS-DESIGN

## SPECULATIVE  (a lead worth a look)

### TA-004 · Response-size oracle may reveal which document was fetched
- Tier:           SPECULATIVE
- Lens:           Observability & traffic analysis
- Note:           honest limit: padding reduces, does not eliminate, vs a global
                  passive adversary; candidate for traffic-analysis-resistance mitigation
```

### How to read it

- **Tiers gate action.** Every finding carries a tier of CONFIRMED, PROBABLE, or SPECULATIVE ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §6). State confidence honestly and mark unconfirmed items `UNVERIFIED` (§8). See [`code-ops-docs/40 Engineering/Handbook/05-evidence-and-tiers.md`](../40 Engineering/Handbook/05-evidence-and-tiers.md).
- **An anonymity regression is never low.** Severity is ranked by severity times exploitability, and critical means a real deanonymization, linkability, or secret leak ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §7). Read critical first, so `EGRESS-003` leads, because one circuit failure exposes every user.
- **Tracks tell you how to act.** NOW-SAFE means local and low-risk, which is the auto-safe lane. NEEDS-REVIEW means behavior-changing, contract-changing, or risky, so it needs your eyes. NEEDS-DESIGN means architectural, like the JA3 homogenization, and it gets a proposal with options rather than a silent fix ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §6). `EGRESS-003` is NEEDS-REVIEW because its fix intentionally tightens behavior by removing a fallback, not because it is risky to leave broken.
- **The register stays fresh.** Each entry stamps the `Verified-at` sha its finding last reproduced on. Before a leak crosses a phase boundary or reaches `opsec-hardening`, it is re-confirmed against the current tree ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). The canonical mechanical pre-filter:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs LEAK_REGISTER.md --root .
```

It reports each item as `FRESH`, `MOVED`, `DRIFTED`, `GONE`, `AMBIGUOUS`, or `NO-REF`. `DRIFTED`
means the cited line no longer contains the leak's delimited `Anchor:` substring, so the citation is
stale or invented. `AMBIGUOUS` means the literal path is gone but more than one file matches its
name, or a reference escapes the root, so verify it by hand. Anything not `FRESH` is re-triaged and
never silently re-shown ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11).
See
[`code-ops-docs/40 Engineering/Handbook/04-registers-and-freshness.md`](../40 Engineering/Handbook/04-registers-and-freshness.md)
and
[`code-ops-docs/40 Engineering/Techniques/reading-a-findings-register.md`](../40 Engineering/Techniques/reading-a-findings-register.md).

> **Checkpoint, decide what to fix.** `full-sweep` presents the ranked leaks led by any clearnet, DNS, or identifier exposure ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 2). You bless `EGRESS-003`, `DNS-001`, `LINK-005`, and `META-002` for hardening. `FP-009` stays PROBABLE until reproduced, and `TA-004` routes to a `traffic-analysis-resistance` mitigation rather than a fix.

---

## Phase 3 · `opsec-hardening`, fail closed with every leak pinned by a test

**Mode:** IMPLEMENT, which writes code and requires approval. **Consumes:** `LEAK_REGISTER.md`.
**Produces:** fixes as branches or pull requests, `IMPLEMENTATION_LOG.md`, an updated register, and
updated opsec docs
([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md)).

- **Phase 0 · Plan from the leak backlog (checkpoint).** It re-validates first with `revalidate-register.mjs`, shown above, confirms each surviving leak still reproduces, and drops or marks `OBSOLETE-AT <sha>` anything already fixed. It then builds a dependency and conflict graph and sequences by severity, so deanonymization and secret leaks go first ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) Phase 0). `EGRESS-003` and `DNS-001` lead.
- **Phase 1 · Implement.** The common hardening moves from the skill follow. Several intentionally tighten behavior, which is the point, and the skill confirms those with you and pins them with tests:
  - enforce proxy and Tor routing and fail closed on failure with no clearnet fallback, which is the `EGRESS-003` fix
  - route DNS through the proxy, remove system-resolver paths, and close WebRTC and IPv6 leaks, which is the `DNS-001` fix
  - enforce stream and connection isolation
  - strip metadata from EXIF, documents, builds, source maps, and headers
  - remove sensitive logging or route it through a redacting logger, and default-deny telemetry and third-party calls, which is the `META-002` fix
  - remove or replace fingerprint vectors and homogenize headers and defaults
  - tighten the cookie and session lifecycle so logout fully clears state, which is the `LINK-005` fix
  - default-deny egress

**The non-negotiable rule: for every fix, add a regression test that fails if the leak returns**
([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md)
Phase 1). For the blessed items that means four tests:

- `EGRESS-003` gets a test asserting no clearnet connect occurs on proxy failure, because the request aborts instead.
- `DNS-001` gets a test asserting no system-resolver call is made, because resolution goes through the proxy.
- `LINK-005` gets a test asserting session storage is empty after logout.
- `META-002` gets a test asserting no IP appears in the emitted log line.

This is behavior tightening by design. The suite's default is behavior preservation except for
opsec hardening that intentionally tightens behavior, such as failing closed, stripping a leaking
field, or enforcing isolation. Those changes are the point, confirmed with you and pinned with
tests ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).

> **Checkpoint per batch, always gated.** Every item here touches egress, logging, identifiers, or a default, which are the always-gated categories, so each batch pauses for your approval regardless of automation level and nothing is auto-merged ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). You approve the fail-closed change for `EGRESS-003`, confirming you want requests to abort on circuit failure rather than fall through.

**Done when** leaks are fixed or deferred with a reason, fail-closed and isolation are verified on
the actual implementation, tests are green, the regression tests lock the leaks shut, and a final
integration pass shows the fixes themselves introduced no new egress, log line, or identifier
([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md),
"Done when").

---

## Phase 4 · `privacy-doc-alignment` and wiring `opsec-pr-gate`

The last phase makes the promises true and stops the next regression before it merges
([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 4).

### `privacy-doc-alignment`, promises that match reality

**Mode:** DOCUMENT, which edits documentation only, logs any code issue as a finding, and changes
no code. **Produces:** reconciled docs, `DRIFT_REPORT.md`, `SSOT_MAP.md`, and `OPEN_QUESTIONS.md`
([`privacy-doc-alignment/SKILL.md`](../../plugins/privacy-opsec-suite/skills/privacy-doc-alignment/SKILL.md)).

It inventories the privacy and opsec docs, maps code reality, and establishes the intended single
source of truth, meaning one authoritative threat model, privacy policy, and opsec runbook per
topic. Its top priority is any privacy promise the code does not actually keep, because an unkept
promise is worse than none. It flags such a promise loudly as a finding rather than quietly
softening the doc. After Phase 3 the threat model's fail-closed promise is true, because you fixed
`EGRESS-003`, so the doc and the code finally agree. The skill also establishes a clear
contributor-rules document: what not to log, collect, or route to, and how defaults must stay.

### Wiring `opsec-pr-gate` into review

**Mode:** REVIEW, review-only by default. It is a pre-merge gate that blocks any change adding
egress, logging, identifiers, fingerprint surface, correlation, or weakened defaults
([`opsec-pr-gate/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-pr-gate/SKILL.md)). It
treats six things as blocking regressions:

- a new egress path, or a fallback that bypasses the proxy or breaks fail-closed
- a new log line touching PII, identifiers, or IPs, or telemetry added
- a new identifier, cookie, or fingerprint vector, or anything increasing cross-session linkability
- a new correlation surface across timing, size, or volume, or a metadata leak
- a new third-party dependency that phones home or opens egress
- any weakened default, meaning less anonymous by default or opt-in privacy

It also re-verifies that fail-closed still holds, metadata stays minimized, and stream isolation is
not undone. Its verdict is `approve`, `approve-with-nits`, or `request-changes`, and it never
approves anything that weakens anonymity.

To run it on every pull request, wire it into CI. The suite ships an illustrative starting point at
[`plugins/privacy-opsec-suite/examples/github-opsec-gate.yml`](../../plugins/privacy-opsec-suite/examples/github-opsec-gate.yml).
The canonical path is to run `/install-github-app`, then apply the example's reviewed immutable
action pin and review criteria. The example restricts the action to read-only tools with
`--allowed-tools Read,Grep,Glob`, so the gate cannot itself change code. For how this repository
wires its own gates, and for the platform legs and their triggers, see
[Wire CI gates](wire-ci-gates.md).

> **Wire authorship-hygiene alongside the gate.** The §A non-negotiables include no tooling trace in published work, because commit metadata, message and pull-request prose, and code idiom are a fingerprint surface. Before pushing, `/privacy-opsec-suite:authorship-hygiene` scrubs that trace and fails closed. Its bundled scanner, reachable as `co scan ai-tells <range>`, must exit 0 over the commit range and the pull-request body before anything publishes ([`authorship-hygiene/SKILL.md`](../../plugins/privacy-opsec-suite/skills/authorship-hygiene/SKILL.md)). For an anonymity project, who wrote the code is itself metadata.

---

## Definition of done

`full-sweep` is done when every selected phase is complete, leaks are fixed or deferred with a
reason, fail-closed and isolation are verified on the actual implementation, regression tests lock
the leaks shut, and the docs and threat model are reconciled. The master `EXECUTIVE_SUMMARY.md` ties
findings, fixes, and residual risk together, and nothing code-changing happened without your
approval
([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md), "Done when").
It presents the summary and lists anything still awaiting a decision. For this run that is the
PROBABLE `FP-009` JA3 fingerprint, awaiting a live capture to promote it, and the NEEDS-DESIGN TLS
homogenization.

---

## Keeping the posture true over time

A one-shot sweep decays. The suite is built to keep the posture fresh
([`plugins/privacy-opsec-suite/README.md`](../../plugins/privacy-opsec-suite/README.md), "Loops &
automation"):

- **On every pull request:** `opsec-pr-gate` in CI, wired above, blocks the next regression before merge.
- **Recurring:** put `tor-egress-audit`, `metadata-leak-audit`, and `supply-chain-trust` on a schedule, because those three audits drift fastest as code and dependencies change.
- **Deterministic backstops:** pre-commit secret scanning, a dependency bot for CVEs, and CI checks that fail on a clearnet connection or an unredacted-log pattern complement the judgment-heavy skills.

For the full anonymity-track orientation and where each skill fits, see
[`code-ops-docs/40 Engineering/Handbook/06-privacy-opsec-primer.md`](../40 Engineering/Handbook/06-privacy-opsec-primer.md).
For every command in detail, see
[`code-ops-docs/40 Engineering/Handbook/commands/privacy-opsec-suite.md`](../40 Engineering/Handbook/commands/privacy-opsec-suite.md).

---

*Verified-at: b0ffede*
