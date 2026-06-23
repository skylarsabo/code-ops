# Guide: Harden Anonymity

You run a service whose whole reason to exist is that nobody can tell who used it — a tip line, a circumvention tool, an at-risk-user app routed over Tor. A single clearnet fallback, one logged IP, one stable identifier that survives "logout," and a real person is exposed. You need to find every such leak in *your own* code, fix it so it fails closed instead of failing open, and lock it shut so a future commit cannot quietly reopen it.

This guide is the **anonymity track journey** for that situation. It is a narrative walk through `/privacy-opsec-suite:full-sweep` — the suite's intra-plugin orchestrator — which runs the model, the audits, the hardening, and the docs/gate as one developer-in-the-loop pipeline. Every command name, mode, phase, artifact, and script below is taken from the real plugin source under [`plugins/privacy-opsec-suite/`](../../plugins/privacy-opsec-suite/).

> **The stance (the one sentence to remember):** this is *defensive* privacy engineering — protect your system's **own users'** anonymity and find/fix leaks in **your own** code; anonymous-by-default and **fail closed**. See [`plugins/privacy-opsec-suite/CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §0 and §A.

---

## Exec summary — the path, end to end

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

1. **The threat model comes first and frames everything.** `anonymity-threat-model` is the keystone artifact; every audit references it ([`anonymity-threat-model/SKILL.md`](../../plugins/privacy-opsec-suite/skills/anonymity-threat-model/SKILL.md)).
2. **Fail closed, never open.** On any proxy/route/circuit failure the system stops — it never falls back to clearnet or a less-anonymous path ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §A).
3. **The register is the single source of truth.** All six audits merge into one `LEAK_REGISTER.md` with stable IDs, and it stays fresh ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §6, §11).
4. **Every fix is pinned by a regression test that fails if the leak returns.** A hardening change without that test is not done ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md)).
5. **Anonymity-affecting changes are always gated.** Anything touching egress, logging, identifiers, fingerprint surface, or a default pauses for your approval at every automation level ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).

`full-sweep` is **manual-invoke** (`disable-model-invocation: true`) — you call it; the model will not auto-trigger it. It is the **intra-plugin** orchestrator: it sequences only this suite's skills. (The cross-plugin orchestrator that spans the breadth spine, the rigor verification layer, and this anonymity track is the code-ops-suite `everything` orchestrator — three plugins (`code-ops-suite`, `rigor`, `privacy-opsec-suite`), reach for it only when the work crosses plugin boundaries.) This guide runs `full-sweep` step by step so you can see and approve each checkpoint.

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
    FS->>Dev: Phase 0 — scope, track, adversaries (checkpoint)
    FS->>TM: Phase 1 — model
    TM-->>LR: ANONYMITY_THREAT_MODEL.md + concrete leaks
    TM->>Dev: worst paths, go/no-go (checkpoint)
    FS->>AU: Phase 2 — fan out (read-only)
    AU-->>LR: merged, ranked leaks
    AU->>Dev: clearnet/DNS/identifier exposure first (checkpoint)
    FS->>HD: Phase 3 — harden (writes code)
    HD-->>LR: fixes; each leak pinned by a regression test
    HD->>Dev: per-batch approval (always gated)
    FS->>DG: Phase 4 — docs & gate
    DG-->>Dev: reconciled SSOT + wired opsec-pr-gate
```

For where the anonymity track sits among the four plugins, see [`docs/handbook/06-privacy-opsec-primer.md`](../handbook/06-privacy-opsec-primer.md). For the full command reference, see [`docs/handbook/commands/privacy-opsec-suite.md`](../handbook/commands/privacy-opsec-suite.md).

---

## Before you start

- **Work on a branch.** The suite commits atomically in reviewable chunks and never breaks the build ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).
- **Set the automation level once.** Default is `gated` — pause for approval at each fix/closure batch. `auto-safe` is the recommended ceiling and only auto-applies NOW-SAFE items (and confirms opsec-tightening that *is* the fix first). Either way, **anything that changes the anonymity/opsec posture, an egress path, logging, identifiers, or a default is always gated regardless of level**, and nothing is ever auto-merged ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). See [`docs/techniques/choosing-an-automation-level.md`](../techniques/choosing-an-automation-level.md).
- **Know where artifacts land.** Run artifacts go in a dated folder under your repo's docs location, e.g. `docs/privacy/<date>/` ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). The standard filenames you will see: `ANONYMITY_THREAT_MODEL.md`, `LEAK_REGISTER.md`, `OPSEC_RUNBOOK.md`, `EXECUTIVE_SUMMARY.md`. The threat model, privacy promises, and opsec runbooks are SSOT — reconciled in place as code changes.
- **The suite never emits real user data.** Skills work from patterns and redacted samples; a discovered live secret is reported by location and rotation, never by value ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).

---

## Phase 0 — Scope the run *(checkpoint)*

`full-sweep` opens by detecting your stack and repo size, then confirms with you ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 0):

- **Track:** `audit-only` (read + document, no code changes), `full` (audit → harden → docs/gate), or a custom subset. For this journey you pick **`full`** — you want the leaks found *and* fixed.
- **The adversaries to emphasize.** The model assumes a standing cast ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §A): a passive network observer (including a global passive adversary correlating traffic), an active network attacker, a malicious or compromised operator/insider, the hosting/infrastructure provider, legal/coercion/subpoena, a compromised dependency or build, a malicious peer, and an adversary correlating activity **across sessions and over time**. For a Tor-routed tip line you tell it to emphasize the passive network observer and the legal/coercion adversary.
- **Scope, PR preference, and whether code-changing phases are pre-approved or gated each time.**

It opens a master todo and a running `EXECUTIVE_SUMMARY.md` across phases. One standing instruction from the skill: it will **surface any suspected deanonymization or leak to you immediately, in any phase** — it does not wait for a checkpoint to tell you the bad news.

> **Incident path (separate).** If a leak is *suspected* rather than sought — you think a user was already exposed — do not start here. Start with `/privacy-opsec-suite:leak-incident-response` (triage → contain → scope → plan) and feed its output into the same `LEAK_REGISTER.md` ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md), "Incident path").

---

## Phase 1 — `anonymity-threat-model`: the keystone

**Mode:** AUDIT / DOCUMENT. **Produces:** `ANONYMITY_THREAT_MODEL.md`; feeds concrete leaks into `LEAK_REGISTER.md`. A durable, reusable artifact.

This runs first because **everything downstream references it** ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 1). The six audits are not a blind checklist — each one is aimed by the paths this model surfaces.

- **Phase 0 — Inventory assets, adversaries & goals (checkpoint).** It enumerates the **assets that identify or link a user**: real IP/location, account or session identifiers, behavioral patterns, device characteristics, metadata, and anything correlatable across sessions/time. It lays out the adversaries (§A) and trust boundaries, and states the system's **anonymity goals** — *unlinkability*, *unobservability*, *deniability*, *data minimization* ([`anonymity-threat-model/SKILL.md`](../../plugins/privacy-opsec-suite/skills/anonymity-threat-model/SKILL.md) Phase 0).
- **Phase 1 — Map deanonymization paths.** For each adversary × asset it works out how the adversary could **observe, link, or deanonymize** — at the network, session, application, metadata, dependency, and operator/legal layers. Crucially, it marks **where anonymity depends on a control** (proxy routing, isolation, minimization, fail-closed) and **what happens if that control fails**. It rates residual risk per path and cross-checks every stated promise against whether the system actually keeps it.

> **CHECKPOINT — go/no-go.** It presents the worst deanonymization paths first ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 1). For the tip line, suppose the worst path is: *"On Tor circuit failure the HTTP client retries directly → the user's real IP reaches the destination."* That single path frames the entire `tor-egress-audit` to come. You confirm the model and approve proceeding.

The reason this is the keystone: a leak found by an audit means little until you can name *which adversary exploits it and what user property it exposes*. The model supplies that frame, and the register's schema (next) makes every audit fill it in.

---

## Phase 2 — the six parallel audits → one `LEAK_REGISTER.md`

**Mode:** AUDIT (read-only — no code changes). `full-sweep` runs the audits in parallel where they are independent, then merges everything into `LEAK_REGISTER.md` (schema §6) ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 2). Read-only analysis parallelizes freely ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §1), so all six fan out at once and converge on one register.

Each audit owns a non-overlapping lens. Knowing the boundaries tells you which audit a leak belongs to:

| Audit | Owns | Leak-class (§6) |
| --- | --- | --- |
| [`anon-session-audit`](../../plugins/privacy-opsec-suite/skills/anon-session-audit/SKILL.md) | Are sessions truly unlinkable — identifiers, lifecycle, hidden persistent IDs, cross-session correlation | `linkability` / `identification` |
| [`tor-egress-audit`](../../plugins/privacy-opsec-suite/skills/tor-egress-audit/SKILL.md) | No traffic leaks the user — proxy enforcement, **fail-closed**, DNS/WebRTC/IPv6 leaks, stream isolation, onion-service hygiene | `egress` / `observability` |
| [`metadata-leak-audit`](../../plugins/privacy-opsec-suite/skills/metadata-leak-audit/SKILL.md) | At-rest/in-band metadata — PII in logs/telemetry/errors, embedded file metadata, headers, retention | `metadata` / `observability` |
| [`fingerprint-resistance`](../../plugins/privacy-opsec-suite/skills/fingerprint-resistance/SKILL.md) | Identity-fingerprint distinctiveness — header/TLS/JA3/behavioral uniqueness; homogenization | `identification` / `correlation` |
| [`traffic-analysis-resistance`](../../plugins/privacy-opsec-suite/skills/traffic-analysis-resistance/SKILL.md) | Traffic-shape correlation — timing/size/volume side channels; padding/batching | `observability` / `correlation` |
| [`supply-chain-trust`](../../plugins/privacy-opsec-suite/skills/supply-chain-trust/SKILL.md) | Dependencies that don't betray anonymity — telemetry/phone-home/egress, CVEs, build integrity | `egress` / `secret` |

A few load-bearing details from the audit sources:

- **`tor-egress-audit` is the one that catches the worst path.** It enumerates *every* outbound path and classifies each as *anonymized / intentionally-clear / leak*, then verifies routing actually holds: proxy enforcement (no client/library bypass), **fail-closed on every error and retry path**, DNS resolved *through* the proxy (SOCKS5h / remote DNS, never the system resolver), stream/connection isolation, onion-service hygiene, and leak vectors (WebRTC/STUN, IPv6 when the proxy is IPv4-only, NTP, captive-portal checks, `Referer`, redirect chains). Any clearnet/DNS leak is reported **critical**; WebRTC is in scope as a leak vector but is not named in the skill's critical-severity declaration ([`tor-egress-audit/SKILL.md`](../../plugins/privacy-opsec-suite/skills/tor-egress-audit/SKILL.md)).
- **Control coverage is multi-boundary.** For any anonymity control — proxy enforcement, fail-closed, isolation, redaction, a feature gate — the audits enumerate **every** entry point and runtime that can reach the protected action and verify it at each. *Enforced at one boundary but not enumerated is a leak, not a pass* ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §9).
- **`traffic-analysis-resistance` is honest about limits.** Full protection against a global passive adversary is generally out of scope; it *reduces*, not eliminates, correlatability, and says so in its summary ([`traffic-analysis-resistance/SKILL.md`](../../plugins/privacy-opsec-suite/skills/traffic-analysis-resistance/SKILL.md)).
- **`supply-chain-trust` treats telemetry as an anonymity finding,** not just bloat — a dependency that phones home opens an egress path and is registered as such ([`supply-chain-trust/SKILL.md`](../../plugins/privacy-opsec-suite/skills/supply-chain-trust/SKILL.md)).

### A synthetic `LEAK_REGISTER.md` snippet

All six audits write into one register. It is a **live backlog and single source of truth** with stable IDs that persist across the whole lifecycle (`EGRESS-003` → register → commit/PR → log), per [`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §6 and §11. The full schema is §6. Here is a synthetic snippet for the tip-line audit so you can see the shape (evidence redacted, as the safety rails require — §4):

```markdown
# LEAK_REGISTER.md   (Verified-at: c2b37e9)

## critical  (deanonymization / secret — fix first)

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
- Impact:         every user on any transient circuit failure — highest blast radius
- Remediation:    remove the direct-agent fallback; on proxy failure, fail closed
                  (abort the request, surface an error)
- Track:          NEEDS-REVIEW   (intentionally tightens behavior — confirm)
- Effort:         S   · Risk-if-fixed: low

### DNS-001 · Hostname resolved via system resolver before proxying
- Lens:           Egress & routing
- Adversary:      passive network observer (ISP)
- Leak-class:     egress
- Severity:       critical      · Confidence: high · Tier: CONFIRMED
- Location:       net/resolve.ts:31  (getaddrinfo before the SOCKS connect)
- Verified-at:    c2b37e9
- Evidence:       local getaddrinfo() runs prior to the proxied connect
- Scenario:       the ISP sees the DNS query even when the connection is proxied —
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
                  prior session — breaks unlinkability across sessions
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
- Scenario:       what isn't collected can't leak or be compelled — a logged IP is
                  exactly the record a subpoena reaches
- Remediation:    drop the IP field / route through a redacting logger
- Track:          NEEDS-REVIEW   (changes logging — always gated, §4)

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
- Note:           honest limit — padding reduces, does not eliminate, vs a global
                  passive adversary; candidate for traffic-analysis-resistance mitigation
```

### How to read it

- **Tiers gate action.** Every finding carries a tier — **CONFIRMED** / **PROBABLE** / **SPECULATIVE** ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §6). State confidence honestly; mark unconfirmed items `UNVERIFIED` (§8). See [`docs/handbook/05-evidence-and-tiers.md`](../handbook/05-evidence-and-tiers.md).
- **An anonymity regression is never "low."** Severity is ranked by severity × exploitability, and **critical** means a real deanonymization, linkability, or secret leak ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §7). Read critical first: `EGRESS-003` (one circuit failure exposes every user) leads.
- **Tracks tell you *how* to act.** **NOW-SAFE** (local, low-risk) is the auto-safe lane; **NEEDS-REVIEW** (behavior-/contract-changing or risky) needs your eyes; **NEEDS-DESIGN** (architectural — like the JA3 homogenization) gets a proposal with options, never a silent fix ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §6). Note `EGRESS-003` is NEEDS-REVIEW *because* its fix intentionally tightens behavior (removing a fallback), not because it is risky to leave broken.
- **The register stays fresh.** Each entry stamps the `Verified-at` sha its finding last reproduced on. Before a leak is carried across a phase boundary or consumed by `opsec-hardening`, it is re-confirmed against the current tree ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). The canonical mechanical pre-filter:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs LEAK_REGISTER.md --root .
```

It reports each item as `FRESH` / `MOVED` / `GONE` / `AMBIGUOUS` / `NO-REF` (`AMBIGUOUS`: the literal path is gone but more than one file matches its name, or a ref escapes root — verify by hand); anything not `FRESH` is re-triaged, never silently re-shown ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §11). See [`docs/handbook/04-registers-and-freshness.md`](../handbook/04-registers-and-freshness.md) and [`docs/techniques/reading-a-findings-register.md`](../techniques/reading-a-findings-register.md).

> **CHECKPOINT — decide what to fix.** `full-sweep` presents the ranked leaks led by any clearnet/DNS/identifier exposure ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 2). You bless `EGRESS-003`, `DNS-001`, `LINK-005`, and `META-002` for hardening; `FP-009` stays PROBABLE until reproduced; `TA-004` is routed to a `traffic-analysis-resistance` mitigation, not a fix.

---

## Phase 3 — `opsec-hardening`: fail-closed, each leak pinned by a test

**Mode:** IMPLEMENT (writes code — requires approval). **Consumes:** `LEAK_REGISTER.md`. **Produces:** fixes (branches/PRs), `IMPLEMENTATION_LOG.md`, updated register + opsec docs ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md)).

- **Phase 0 — Plan from the leak backlog (checkpoint).** It re-validates first (`revalidate-register.mjs`, shown above), confirms each surviving leak still reproduces, drops/`OBSOLETE-AT <sha>` anything fixed, then builds a dependency/conflict graph and **sequences by severity — deanonymization and secret leaks first** ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) Phase 0). `EGRESS-003` and `DNS-001` go first.
- **Phase 1 — Implement.** Common hardening from the skill — **several intentionally tighten behavior, which is the point; the skill confirms those with you and pins them with tests**:
  - enforce proxy/Tor routing and **fail-closed** on failure (no clearnet fallback) — this is the `EGRESS-003` fix
  - route DNS through the proxy / remove system-resolver paths; close WebRTC/IPv6 leaks — the `DNS-001` fix
  - enforce stream/connection isolation
  - strip metadata (EXIF / document / build / source maps / headers)
  - remove sensitive logging or route it through a redacting logger; default-deny telemetry/third-party calls — the `META-002` fix
  - remove/replace fingerprint vectors; homogenize headers and defaults
  - tighten cookie/session lifecycle; ensure logout fully clears state — the `LINK-005` fix
  - default-deny egress

**The non-negotiable: for every fix, a regression test that fails if the leak returns** ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md) Phase 1). Concretely, for the blessed items:

- `EGRESS-003` → a test asserting **no clearnet connect occurs on proxy failure** (the request aborts instead).
- `DNS-001` → a test asserting **no system-resolver call** is made (resolution goes through the proxy).
- `LINK-005` → a test asserting **session storage is empty after logout**.
- `META-002` → a test asserting **no IP appears in the emitted log line**.

This is behavior-*tightening* by design — the suite's default is behavior preservation *except* opsec hardening that intentionally tightens behavior (fail-closed, stripping a leaking field, enforcing isolation); those changes are the point, confirmed with you and pinned with tests ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4).

> **CHECKPOINT per batch (always gated).** Every item here touches egress, logging, identifiers, or a default — the **always-gated** categories — so each batch pauses for your approval regardless of automation level, and nothing is auto-merged ([`CONVENTIONS.md`](../../plugins/privacy-opsec-suite/CONVENTIONS.md) §4). You approve the fail-closed change for `EGRESS-003`, confirming you *want* requests to abort on circuit failure rather than fall through.

**Done when** leaks are fixed or deferred-with-reason; **fail-closed and isolation are verified on the actual implementation**; tests are green; the regression tests lock the leaks shut; and a final integration pass shows no new egress/log/identifier was introduced by the fixes themselves ([`opsec-hardening/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-hardening/SKILL.md), "Done when").

---

## Phase 4 — `privacy-doc-alignment` + wiring `opsec-pr-gate`

The last phase makes the promises true and stops the next regression before it merges ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md) Phase 4).

### `privacy-doc-alignment` — promises that match reality

**Mode:** DOCUMENT (edits documentation only — logs any code issue as a finding, changes no code). **Produces:** reconciled docs, `DRIFT_REPORT.md`, `SSOT_MAP.md`, `OPEN_QUESTIONS.md` ([`privacy-doc-alignment/SKILL.md`](../../plugins/privacy-opsec-suite/skills/privacy-doc-alignment/SKILL.md)).

It inventories the privacy/opsec docs, maps **code reality**, and establishes the intended **SSOT** (one authoritative threat model, privacy policy, and opsec runbook per topic). Its **top priority** is any **privacy promise the code does not actually keep** — *an unkept promise is worse than none*, so it flags it loudly as a finding rather than quietly softening the doc. After Phase 3, the threat model's fail-closed promise is now true (you fixed `EGRESS-003`), so the doc and the code finally agree — and the skill establishes a clear **"rules contributors must not break"** doc: what not to log/collect/route to, and how defaults must stay.

### Wire `opsec-pr-gate` into review

**Mode:** REVIEW (review-only by default). It is a pre-merge gate that **blocks** any change adding egress, logging, identifiers, fingerprint surface, correlation, or weakened defaults ([`opsec-pr-gate/SKILL.md`](../../plugins/privacy-opsec-suite/skills/opsec-pr-gate/SKILL.md)). It treats these as **BLOCKING** regressions:

- a new **egress path** or a fallback that bypasses the proxy / breaks fail-closed
- a new **log line** touching PII/identifiers/IPs, or telemetry added
- a new **identifier, cookie, or fingerprint vector**, or anything increasing cross-session linkability
- a new **correlation surface** (timing/size/volume) or metadata leak
- a new **third-party dependency** that phones home or opens egress
- any **weakened default** (less-anonymous by default, opt-in privacy)

It also re-verifies fail-closed still holds, metadata stays minimized, and stream isolation is not undone. Its verdict is `approve` / `approve-with-nits` / `request-changes`, and it **never approves anything that weakens anonymity**.

To run it on every PR, wire it into CI. The suite ships an illustrative starting point at [`plugins/privacy-opsec-suite/examples/github-opsec-gate.yml`](../../plugins/privacy-opsec-suite/examples/github-opsec-gate.yml) using `anthropics/claude-code-action@v1`. The canonical path is to run `/install-github-app` inside Claude Code (it installs the GitHub App, sets the credential secret, and generates a working starter workflow), then either invoke `/privacy-opsec-suite:opsec-pr-gate for this pull request` directly if the plugin is available in CI, or paste the inlined BLOCKING criteria so the gate is self-contained. The example restricts the action to read-only tools (`--allowed-tools Read,Grep,Glob`) so the gate cannot itself change code.

> **Wire authorship-hygiene alongside the gate.** The §A non-negotiables include *no tooling/AI trace in published work* — commit metadata, message/PR prose, and code idiom are a fingerprint surface. Before pushing, `/privacy-opsec-suite:authorship-hygiene` scrubs that trace and **fails closed**: its bundled `scan-ai-tells.mjs` must exit 0 over the commit range and PR bodies before anything publishes ([`authorship-hygiene/SKILL.md`](../../plugins/privacy-opsec-suite/skills/authorship-hygiene/SKILL.md)). For an anonymity project, who *wrote* the code is itself metadata.

---

## Done when

`full-sweep` is done when every selected phase is complete, leaks are fixed or deferred-with-reason, **fail-closed and isolation are verified on the actual implementation**, regression tests lock the leaks shut, and the docs and threat model are reconciled; the master `EXECUTIVE_SUMMARY.md` ties findings, fixes, and residual risk together; and nothing code-changing happened without your approval ([`full-sweep/SKILL.md`](../../plugins/privacy-opsec-suite/skills/full-sweep/SKILL.md), "Done when"). It presents the summary and lists anything still awaiting a decision — for this run, the PROBABLE `FP-009` JA3 fingerprint (awaiting a live capture to promote it) and the NEEDS-DESIGN TLS homogenization.

---

## Keep it true over time

A one-shot sweep decays. The suite is built to keep the posture fresh ([`plugins/privacy-opsec-suite/README.md`](../../plugins/privacy-opsec-suite/README.md), "Loops & automation"):

- **On every PR:** `opsec-pr-gate` in CI (wired above) blocks the next regression before merge.
- **Recurring:** put `tor-egress-audit`, `metadata-leak-audit`, and `supply-chain-trust` on a schedule via Routines / `/schedule` — the three audits most likely to drift as code and dependencies change.
- **Deterministic backstops:** pre-commit secret scanning, a dependency bot for CVEs, and CI checks that fail on a clearnet connection or an unredacted-log pattern complement the judgment-heavy skills.

For the full anonymity-track orientation and where each skill fits, see [`docs/handbook/06-privacy-opsec-primer.md`](../handbook/06-privacy-opsec-primer.md). For every command in detail, see [`docs/handbook/commands/privacy-opsec-suite.md`](../handbook/commands/privacy-opsec-suite.md).

---

*Verified-at: c2b37e9*
