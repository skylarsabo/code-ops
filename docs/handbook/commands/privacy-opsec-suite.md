# privacy-opsec-suite — Command Reference

The **privacy-opsec-suite** is the anonymity track of the code-ops marketplace: adaptive, multi-agent workflows for building, auditing, and operating privacy-respecting, anonymity-preserving software. Its stance is *defensive privacy engineering* — protect your system's own users' anonymity and find and fix leaks in your own code, never attack or deanonymize third parties. Every skill operates inside one non-negotiable envelope: the anonymity & OpSec model in [`CONVENTIONS.md`](../../../plugins/privacy-opsec-suite/CONVENTIONS.md) §A — anonymous/private by default, **fail closed** (never fall back to clearnet), no new egress/log/identifier/fingerprint/dependency without scrutiny, minimize metadata, never weaken a guarantee silently. The suite chains its skills around a single live backlog: a keystone threat model frames six parallel leak audits, those audits write stable-ID findings into `LEAK_REGISTER.md`, `opsec-hardening` fixes them with regression tests, and `opsec-pr-gate` blocks regressions from coming back.

Each command is a namespaced slash command (`/privacy-opsec-suite:<skill>`), manual-invoke only (deliberate operations). Every skill reads `CONVENTIONS.md` first and references it by section: §A (the model), §5 (modes), §6 (the leak/finding schema), §9 (the quality lenses), §10 (the implementation loop), §11 (registers as SSOT with `Verified-at` freshness).

This page documents all 14 skills. If you are new, read the suite intro above, then jump to the audit you need. If you already run Claude Code fluently, the per-command **Prerequisites & hand-offs** and the sibling disambiguations are where the load-bearing detail lives.

## Quick index

**Model & audits (AUDIT / DISCOVERY)**
- [`anonymity-threat-model`](#privacy-opsec-suiteanonymity-threat-model) — keystone: map how a user could be deanonymized
- [`anon-session-audit`](#privacy-opsec-suiteanon-session-audit) — are sessions truly unlinkable
- [`tor-egress-audit`](#privacy-opsec-suitetor-egress-audit) — no traffic escapes the proxy/Tor
- [`metadata-leak-audit`](#privacy-opsec-suitemetadata-leak-audit) — minimize what leaks at rest / in-band
- [`fingerprint-resistance`](#privacy-opsec-suitefingerprint-resistance) — make users indistinguishable
- [`traffic-analysis-resistance`](#privacy-opsec-suitetraffic-analysis-resistance) — reduce observable timing/size/volume signatures
- [`supply-chain-trust`](#privacy-opsec-suitesupply-chain-trust) — dependencies that don't betray anonymity

**Build / respond (IMPLEMENT / DISCOVERY / REVIEW)**
- [`opsec-hardening`](#privacy-opsec-suiteopsec-hardening) — implement the leak fixes safely, each pinned by a regression test
- [`privacy-feature-design`](#privacy-opsec-suiteprivacy-feature-design) — find and spec high-value privacy/trust features
- [`leak-incident-response`](#privacy-opsec-suiteleak-incident-response) — triage, contain, scope, and plan a suspected leak
- [`authorship-hygiene`](#privacy-opsec-suiteauthorship-hygiene) — remove AI/tooling trace before publishing

**Docs / gate (DOCUMENT / REVIEW)**
- [`privacy-doc-alignment`](#privacy-opsec-suiteprivacy-doc-alignment) — reconcile privacy promises against code; establish the SSOT
- [`opsec-pr-gate`](#privacy-opsec-suiteopsec-pr-gate) — pre-merge gate that blocks anonymity regressions

**Orchestrator**
- [`full-sweep`](#privacy-opsec-suitefull-sweep) — run the whole suite end-to-end as one checkpointed pipeline

---

## Model & audits

### `/privacy-opsec-suite:anonymity-threat-model`
**Mode:** AUDIT / DOCUMENT

**How it works.** Two phases. Phase 0 (checkpoint) inventories the assets that identify or link a user — real IP/location, account or session identifiers, behavioral patterns, device characteristics, metadata, anything correlatable across sessions or time — lays out the adversaries and trust boundaries (`CONVENTIONS §A`), and states the system's anonymity goals (unlinkability, unobservability, deniability, minimization); it pauses to confirm scope and which adversaries to emphasize. Phase 1 maps deanonymization paths for each adversary × asset across the network, session, application, metadata, dependency, and operator/legal layers, marking where anonymity depends on a control (proxy routing, isolation, minimization, fail-closed) and what happens if that control fails, then rates residual risk and cross-checks every stated promise against reality. It produces the durable, reusable artifact `ANONYMITY_THREAT_MODEL.md` and routes concrete, fixable issues into `LEAK_REGISTER.md` (schema `§6`).

**Why it's useful.** It is the keystone of the suite. Every other audit and the orchestrator references it for scope, adversary emphasis, and which controls anonymity depends on — without it, the audits have no shared frame and the register has no priorities.

**When to use it.** Run it first, before any of the leak audits, on any project with anonymity or opsec needs; re-run when the architecture, threat surface, or adversary set changes. Do not reach for it to find a specific leak class — that is what the focused audits do. Disambiguation: this is the *map* (every adversary × asset, residual-risk paths, a reusable document); `metadata-leak-audit` is one *focused sweep* (PII/identifiers in logs, telemetry, embedded file metadata, headers, retention) that writes findings but no reusable model.

**Prerequisites & hand-offs.** Requires the privacy-opsec-suite plugin installed; no register input. Produces `ANONYMITY_THREAT_MODEL.md` and seeds `LEAK_REGISTER.md`, which then frames `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`, `traffic-analysis-resistance`, and `supply-chain-trust`.

### `/privacy-opsec-suite:anon-session-audit`
**Mode:** AUDIT

**How it works.** Phase 0 (checkpoint) traces how identity and sessions work — session identifiers, cookies/tokens, the account model (account-less? guest? ephemeral?), lifecycle (create/resume/expire/logout), and where session state lives client- and server-side — and confirms scope. Phase 1 hunts linkability: cross-request and cross-session linkability (reused tokens, stable identifiers, account binding); hidden persistent identifiers (device IDs, `localStorage`/IndexedDB, `ETag`/cache-as-supercookie, HSTS/TLS-session-resumption tracking, canvas/storage fallbacks); session integrity (fixation, low-entropy tokens, missing rotation, cookie flags/scope); lifecycle (does logout fully clear state, expiry enforced server-side); and defaults (is anonymous the default, no silent persistent identity). Findings land in `LEAK_REGISTER.md` with leak-class `linkability`/`identification`, plus a short posture summary.

**Why it's useful.** Sessions are where "anonymous" users quietly become linkable. This skill is the dedicated owner of session identity and linkability, catching the supercookies and resumption tricks that re-associate a returning user.

**When to use it.** When you need to prove sessions are unlinkable and no hidden persistent ID survives logout. It owns linkability and session identity — not network egress (use `tor-egress-audit`) and not file metadata (use `metadata-leak-audit`). Reach for `fingerprint-resistance` instead when the re-linking vector is a header/TLS/behavioral fingerprint rather than a stored identifier.

**Prerequisites & hand-offs.** Plugin installed; works best after `anonymity-threat-model` has framed the assets and adversaries. Writes findings into `LEAK_REGISTER.md` for `opsec-hardening` to fix.

### `/privacy-opsec-suite:tor-egress-audit`
**Mode:** AUDIT

**How it works.** Phase 0 (checkpoint) enumerates *all* outbound network behavior — HTTP clients, raw sockets, DNS, telemetry/analytics, third-party SDKs/CDNs/fonts, webhooks, update/connectivity checks — and records the intended routing for each (which must go over Tor/SOCKS/proxy, which is intentionally direct), then confirms the routing policy. Phase 1 verifies the routing actually holds: proxy enforcement (any client/library that bypasses the SOCKS/Tor proxy via direct connects, hardcoded hosts, ignored proxy settings, background tasks, native code); **fail-closed** behavior on proxy/circuit failure, checking error and retry paths specifically; DNS leaks (lookups resolved through the proxy, never the system resolver; hunting direct `getaddrinfo`/local-resolver calls); stream/connection isolation (per-action SOCKS auth isolation); onion-service hygiene if served (v3 config, real IP never bound or leaked, no mixed clearnet+onion resources, descriptor/header/error-page hygiene); leak vectors (WebRTC/STUN, IPv6 when the proxy is IPv4-only, NTP, captive-portal checks, prefetch/preconnect, `Referer`, redirect chains, OS telemetry); and header/TLS uniformity. It produces an **egress map** classifying every path as anonymized / intentionally-clear / leak, findings in `LEAK_REGISTER.md` (leak-class `egress`/`observability`), and a summary led by any clearnet/DNS/WebRTC leak. Any clearnet or DNS leak is surfaced as **critical**.

**Why it's useful.** A single bypassed connection or DNS lookup deanonymizes the user outright. This skill is the owner of network egress and routing, and it applies the multi-boundary control-coverage rule (`§9`): a proxy enforced at one entry point but not enumerated at every entry point is a leak, not a pass.

**When to use it.** Whenever the product routes any traffic over Tor/SOCKS/a proxy, runs an onion service, or claims fail-closed networking. It owns network egress and routing — not session identifiers (use `anon-session-audit`) and not at-rest file metadata (use `metadata-leak-audit`).

**Prerequisites & hand-offs.** Plugin installed; framed by `anonymity-threat-model`. Read-only network/proxy/DNS/header inspection tools are used if connected and skipped otherwise. Feeds `egress`-class findings to `opsec-hardening`.

### `/privacy-opsec-suite:metadata-leak-audit`
**Mode:** AUDIT

**How it works.** Phase 0 (checkpoint) inventories everywhere metadata is produced, stored, served, or logged — logging, telemetry/analytics, error/crash reporting, generated/served files, response headers, caches/CDN, backups — and confirms scope. Phase 1 hunts and minimizes across four surfaces: logs/telemetry/errors (PII, IPs, identifiers, tokens, precise timestamps, verbose stack traces shipped off-box); embedded file metadata (EXIF, document author/timestamps, build metadata, source maps, debug symbols, file paths, usernames baked into artifacts); headers (`Server`, `X-Powered-By`, `Date` drift, `ETag`, `Set-Cookie`, framework banners); and side channels plus retention (response size/timing differences revealing content or state, cache/CDN per-user leakage, logs/backups kept too long, "anonymized" data that re-identifies). The throughline is *strip or minimize* — what isn't emitted can't leak or be compelled. Findings go to `LEAK_REGISTER.md` (leak-class `metadata`/`observability`).

**Why it's useful.** Metadata is the quiet leak: EXIF GPS in an uploaded photo, a username in a stack trace, an IP in a log line. This skill owns the at-rest and in-band metadata surface and turns it into concrete stripping recommendations ranked by impact.

**When to use it.** When you need to know what PII/identifiers leak through logs, telemetry, errors, headers, or embedded file metadata, and what your retention exposes. It owns at-rest/in-band metadata — *not* timing/size side channels, which belong to `traffic-analysis-resistance`. Disambiguation from the keystone: `anonymity-threat-model` is the full reusable map of every adversary × asset; `metadata-leak-audit` is the single focused sweep of the metadata surface that writes findings into the register.

**Prerequisites & hand-offs.** Plugin installed; framed by `anonymity-threat-model`. Feeds `metadata`-class findings to `opsec-hardening` (EXIF/header/log stripping).

### `/privacy-opsec-suite:fingerprint-resistance`
**Mode:** AUDIT

**How it works.** Phase 0 (checkpoint) identifies what could distinguish or re-link one anonymous session from another, on both client and server sides, and confirms scope. Phase 1 enumerates and recommends homogenization across: network/transport (header set, ordering, and uniqueness; TLS/JA3 fingerprint; SNI; protocol quirks); client surface where applicable (canvas/WebGL/audio fingerprints, fonts, screen/devicePixelRatio, timezone, language, plugins, per-user feature flags or config that leak); behavioral patterns (timing, interaction cadence, request ordering); re-association vectors that re-link a returning anonymous user; and server-side distinguishing responses per client. The recommendation is always homogenization — make every user look like everyone else with uniform defaults — not per-user uniqueness. Findings land in `LEAK_REGISTER.md` (leak-class `identification`/`correlation`).

**Why it's useful.** Even with no stored identifier, a distinctive header order, JA3 fingerprint, or canvas hash re-links "anonymous" sessions. This skill owns identity-fingerprint distinctiveness and pushes toward a uniform crowd.

**When to use it.** When the re-linking risk is a fingerprint — header/TLS/JA3/behavioral uniqueness — rather than a stored ID. It owns identity-fingerprint distinctiveness; it is *not* about traffic timing/size (use `traffic-analysis-resistance`) and *not* about stored session identifiers (use `anon-session-audit`, which it cross-references for re-association).

**Prerequisites & hand-offs.** Plugin installed; framed by `anonymity-threat-model`. A browser/UI tool is used for client-side surface if connected. Feeds homogenization findings to `opsec-hardening`.

### `/privacy-opsec-suite:traffic-analysis-resistance`
**Mode:** AUDIT

**How it works.** Phase 0 (checkpoint) describes what an on-path or endpoint observer can see — request/response sizes, timing, volume, cadence — and confirms scope and the threat (on-path observer vs. endpoint). Phase 1 finds correlatable signatures: size signatures (distinctive request/response sizes revealing the action/content, payload-size oracles, CRIME/BREACH-style compression side channels); timing (patterns correlating input↔output, or end-to-end timing that links a user's clearnet entry to anonymized activity); volume/cadence acting as a signature; and mitigation options (padding, batching, constant-rate behavior, cover traffic, response-time normalization for sensitive operations). Findings go to `LEAK_REGISTER.md` (leak-class `observability`/`correlation`), with an honest statement of residual risk. The skill sets expectations up front: full protection against a global passive adversary is generally out of scope — it reduces, not eliminates, correlatability.

**Why it's useful.** Traffic shape leaks even when content is encrypted and routed over Tor. This skill owns traffic-shape correlation and proposes the padding/batching/normalization defaults that blunt it, while being candid about what cannot be fixed.

**When to use it.** When you need to reduce observable timing/size/volume side channels or consider padding/batching defaults. It owns traffic-shape correlation — *not* header/TLS fingerprints (use `fingerprint-resistance`). Do not expect it to defeat a global passive adversary; it will tell you so.

**Prerequisites & hand-offs.** Plugin installed; framed by `anonymity-threat-model`. Feeds `observability`/`correlation` findings to `opsec-hardening`.

### `/privacy-opsec-suite:supply-chain-trust`
**Mode:** AUDIT (+ safe fixes with confirmation)

**How it works.** Phase 0 (checkpoint) catalogues direct and transitive dependencies, their network behavior, known CVEs by severity, and build/lockfile integrity, then confirms scope with telemetry/egress and CVE flags highlighted. Phase 1 assesses trust under the model: egress/telemetry (does any dependency phone home, send analytics, make third-party calls, add an egress path or fingerprint vector — each treated as an anonymity finding, not just bloat); vulnerabilities (CVEs by severity, abandoned/unmaintained packages); integrity (lockfile integrity, reproducible builds, postinstall/build scripts that could exfiltrate, secrets pulled in via deps); and provenance (typosquat/lookalike risk, preferring minimal, audited, offline-capable dependencies). It writes `LEAK_REGISTER.md` entries for egress/telemetry deps (leak-class `egress`/`secret`) and CVEs, and produces a report of what to remove/replace/pin/disable, applying safe removals or pins only with confirmation.

**Why it's useful.** A dependency that phones home betrays anonymity regardless of how clean your own code is. This skill vets the supply chain through an anonymity-hostile lens, so a telemetry-laden package is a finding rather than an accepted default.

**When to use it.** When you need to vet dependencies for telemetry/phone-home/egress, CVEs, and build/lockfile integrity. Unlike the read-only audits, it can apply safe fixes (removals, pins) — but only with confirmation and with the build/tests staying green.

**Prerequisites & hand-offs.** Plugin installed; framed by `anonymity-threat-model`. The documentation/reference lookup defaults to the local-first, no-egress `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (or the `code-ops-docs` `get-docs` MCP tool when code-ops-suite is installed) — a doc lookup must not itself leak what you are building. A dependency bot is recommended as a deterministic CVE backstop. Feeds findings to `opsec-hardening`.

---

## Build / respond

### `/privacy-opsec-suite:opsec-hardening`
**Mode:** IMPLEMENT

**How it works.** Phase 0 (checkpoint) reads `LEAK_REGISTER.md` and **re-validates first** (`CONVENTIONS §11`): it runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs LEAK_REGISTER.md --root .`, triages the FRESH/MOVED/DRIFTED/GONE/AMBIGUOUS/NO-REF report, and confirms each surviving leak still reproduces (dropping or `OBSOLETE-AT <sha>`-marking anything already fixed); it then builds a dependency/conflict graph and sequences by severity (deanonymization and secret leaks first), pausing to present the re-validation results, the order/batching, and the PR preference, and getting a direction on NEEDS-DESIGN items. Phase 1 implements via the implementation loop (`§10`): common hardening includes enforcing proxy/Tor routing and fail-closed, routing DNS through the proxy and closing WebRTC/IPv6 leaks, enforcing stream isolation, stripping metadata, redacting or removing sensitive logging and default-denying telemetry, removing/replacing fingerprint vectors, tightening cookie/session lifecycle, and default-denying egress. Several of these intentionally tighten behavior — that is the point, and each is confirmed with the developer and pinned. For every fix it adds a **regression test that fails if the leak returns** (asserts no clearnet connect on proxy failure, no PII in a log line, EXIF stripped). It produces atomic PRs/branches, an `IMPLEMENTATION_LOG.md`, an updated register, and updated opsec docs.

**Why it's useful.** It is the only IMPLEMENT-mode skill in the suite — the one that turns a leak backlog into shut-and-locked fixes. The regression-test-per-leak discipline means a closed leak stays closed.

**When to use it.** After the audits (or `leak-incident-response`) have populated `LEAK_REGISTER.md` and you want the leaks fixed safely. Do not run it without a register — it consumes one as input. Because it changes the anonymity/opsec posture, its work is always gated (`§4`); never auto-merge.

**Prerequisites & hand-offs.** Requires a populated `LEAK_REGISTER.md` (from the audits, `full-sweep` Phase 2, or `leak-incident-response`). Default automation level is `gated`; the always-gated categories (egress, logging, identifiers, defaults, secrets, migrations, public contracts) hold regardless. Its closed leaks are then guarded by `opsec-pr-gate`.

### `/privacy-opsec-suite:privacy-feature-design`
**Mode:** DISCOVERY

**How it works.** Phase 0 (checkpoint) maps the current feature set, the anonymity/opsec model, latent capabilities, and intent signals (TODOs, stubs, disabled flags), then confirms direction, target users, scope, and appetite. Phase 1 finds code-grounded privacy/trust capabilities that deepen the moat — data export/portability, local-first/self-host, end-to-end or zero-knowledge options, ephemeral/anonymous modes, metadata-minimization toggles, user-controlled audit logs, "what we know about you" transparency, granular anonymity controls, a Tor-only mode, panic/wipe — and **gates every idea against the anonymity model (`§A`)**: it must strengthen or be neutral; anything that would erode anonymity is flagged for a developer decision, never silently proposed. Each idea gets its smallest valuable slice. Phase 2 (checkpoint) ranks by impact × reach ÷ effort weighted by confidence, tags quick wins and big bets, and after the developer picks, writes a mini-spec per chosen feature including its anonymity impact and threat-model fit. It produces `PRIVACY_FEATURE_OPPORTUNITIES.md` (a ranked register), the chosen mini-specs, a roadmap, and an `EXECUTIVE_SUMMARY.md`. No code changes.

**Why it's useful.** It turns anonymity from a constraint into a product moat, surfacing trust-building features that are grounded in what the code can already do and proven safe against the model before anyone builds them.

**When to use it.** When you want high-value privacy/trust features found and specified. It is discovery and specification only — it never writes code. Hand the chosen mini-specs to an implementer; within this suite that means feeding the spec to `opsec-hardening` for any anonymity-tightening work, or to the code-ops-suite for general feature build.

**Prerequisites & hand-offs.** Plugin installed; benefits from an existing `ANONYMITY_THREAT_MODEL.md` for the gating step. Produces ranked specs that hand off to an implementing skill.

### `/privacy-opsec-suite:leak-incident-response`
**Mode:** REVIEW (analysis + a proposed containment change; no destructive action)

**How it works.** Phase 0 (checkpoint) captures the suspected leak, the affected area, and the timeline **without making it worse** — it does not add PII logging to investigate, and works from redacted evidence — then confirms scope and surfaces anything clearly critical immediately. Phase 1 runs triage → contain → scope → plan: triage (is it a real leak, confirmed with redacted `file:line` evidence, false positives ruled out); contain (the smallest immediate change that stops it — fail-closed, disable the leaking path, block the egress — proposed for the developer to apply); blast radius (what was exposed, who could be deanonymized or linked, over what window, observable by which adversary); root cause (the underlying defect); remediation plan (the durable fix plus a regression test that locks the leak shut); and communication (what to disclose, stated factually, without over-collecting). It writes an incident report into `OPSEC_RUNBOOK.md` and a tracked entry in `LEAK_REGISTER.md`, plus the proposed containment change.

**Why it's useful.** When a leak is suspected, the worst move is a panicked investigation that adds logging and widens the exposure. This skill gives a disciplined, redaction-first containment path and feeds the durable fix into the same backlog the rest of the suite uses.

**When to use it.** When an anonymity/privacy leak or correlation vector is *suspected* rather than being systematically sought. (The audits are for proactively hunting; this is the reactive path.) It proposes a containment change but applies nothing destructive — the durable fix goes through `opsec-hardening` with the developer's go-ahead.

**Prerequisites & hand-offs.** Plugin installed. Feeds its tracked entry into `LEAK_REGISTER.md` and its report into `OPSEC_RUNBOOK.md`; the remediation is then carried out by `opsec-hardening`. In `full-sweep`, this is the separate incident entry point.

### `/privacy-opsec-suite:authorship-hygiene`
**Mode:** REVIEW (audit) + IMPLEMENT (scrub)

**How it works.** Treating tooling/AI trace in version control as a metadata leak (`§A`), it cleans three surfaces across a named commit range, PR body, and/or working diff. **L1 — Metadata** (mechanical, near-zero risk): strip `Co-Authored-By:` tool trailers, "Generated with/by <tool>" markers, AI markers in branch names, and bot author/committer identities, setting author/committer to the human's git identity; the mechanical floor is `node ${CLAUDE_PLUGIN_ROOT}/scripts/scan-ai-tells.mjs <commit-range-or-pr-body-file>`, which flags trailers, tool markers, emoji, em-dash density, assistant-prose tells, and `## Test plan` boilerplate. **L2 — Prose voice**: learn the author's style from history (tense, length, capitalization, conventional-commits or not, emoji, bullets vs. prose, section habits) and rewrite commit messages and PR descriptions to match, killing tells the scanner can't judge (over-explanation, hedging, "Notably/Importantly/Here's what", em-dash overuse). **L3 — Code idiom blend-in** (behavior-preserving): run the repo's formatter and linter first, then rectify semantically-equivalent-but-divergent forms in each changed hunk to match its neighbors, never swapping genuinely-different behavior and surfacing anything risky rather than applying it. A **fail-closed gate** ends the run: `scan-ai-tells.mjs` must exit 0 over the commit range and PR bodies before anything is published; if it can't be cleaned, it stops and surfaces the trace.

**Why it's useful.** Published commit metadata, message/PR prose, and code idiom are a fingerprint surface; published work should reflect the author, not the tool. This is the suite's enforcement of the §A no-tooling-trace non-negotiable, with a deterministic scanner as the floor.

**When to use it.** Before publishing a commit, PR, or branch that must carry no AI/tooling trace. Disambiguation on the code surface: L3 only makes *this diff* indistinguishable from its neighbors — it delegates repo-wide one-style normalization to `code-ops-suite:normalize` and divergent implementations of one concept to `rigor:consistency-closure`. Do not use it to fix behavior; it is behavior-preserving and surfaces anything risky.

**Prerequisites & hand-offs.** Plugin installed; the bundled `scan-ai-tells.mjs` is the fail-closed gate. Version-control history is read to learn the author's voice. Typically the final step before pushing the work produced by `opsec-hardening` or any other implementer.

---

## Docs / gate

### `/privacy-opsec-suite:privacy-doc-alignment`
**Mode:** DOCUMENT

**How it works.** Phase 0 (checkpoint) inventories the privacy/opsec docs (privacy policy, threat model, opsec runbooks, contributor rules) with each one's purpose, maps code reality, and maps the intended SSOT (which doc is authoritative per topic, flagging no-owner and duplicate authorities), then confirms which docs are authoritative vs. aspirational. Phase 1 verifies every privacy claim against the code, classifies drift (stale / wrong / contradictory / orphaned / missing / duplicate-SSOT), and makes its **top priority any privacy promise the code does not actually keep** — an unkept promise is worse than none, so it flags it loudly as a finding rather than quietly softening the doc. It auto-fixes unambiguous factual drift, brings stale-vs-aspirational and structural changes to the developer, and establishes one authoritative threat model, privacy policy, and opsec runbook plus an index and a clear "rules contributors must not break" doc. It produces reconciled docs, `DRIFT_REPORT.md`, `SSOT_MAP.md`, and `OPEN_QUESTIONS.md`. It edits documentation only — any code issue is logged as a finding, not changed.

**Why it's useful.** A privacy promise the code doesn't keep is a liability and a broken trust contract. This skill makes the docs match reality, surfaces unkept promises loudly, and gives each topic a single authoritative source so the threat model, privacy policy, and runbooks stay the SSOT as code changes.

**When to use it.** When privacy promises, the threat model, or opsec runbooks have drifted from code and you want them reconciled. It is DOCUMENT-mode: it never changes code (it logs code issues as findings for `opsec-hardening`).

**Prerequisites & hand-offs.** Plugin installed; most valuable after hardening, so the docs reflect the fixed code. Any code-level finding it logs hands off to `opsec-hardening`; its reconciled threat model and runbooks remain the SSOT the rest of the suite reads.

### `/privacy-opsec-suite:opsec-pr-gate`
**Mode:** REVIEW (name the PR/branch/diff)

**How it works.** Phase 0 pulls the PR/diff and its intent (description, linked issue/leak ID/spec) and the surrounding code, fanning out to the `privacy-reviewer` subagent for large PRs and synthesizing. Phase 1 reviews against the lenses (`§9`) and treats these as **BLOCKING** regressions: a new egress path or a fallback that bypasses the proxy / breaks fail-closed; a new log line touching PII/identifiers/IPs or added telemetry; a new identifier, cookie, or fingerprint vector, or anything increasing cross-session linkability; a new correlation surface (timing/size/volume) or metadata leak; a new third-party dependency that phones home or opens egress; and any weakened default (less-anonymous by default, opt-in privacy). It also verifies fail-closed still holds, metadata stays minimized, and stream isolation isn't undone. The output is prioritized comments at `file:line` (Blocking / Should-fix / Nit) plus a verdict (approve / approve-with-nits / request-changes) and a 2–3 line risk read — posted as PR comments if a VCS tool is connected, else `REVIEW.md`. It does not approve anything that weakens anonymity.

**Why it's useful.** It is the standing guard that keeps closed leaks closed and stops new anonymity regressions before they merge — the enforcement endpoint of the whole chain.

**When to use it.** On every PR (wire it into CI), and especially as the gate after `opsec-hardening` lands fixes. It is review-only by default. Disambiguation among the three review gates: `code-ops-suite:pr-review` is general engineering review (correctness, design, tests, maintainability); `rigor:deep-review` is the high-signal, evidence-tiered verification review (prove-it-or-don't, disconfirmation); `privacy-opsec-suite:opsec-pr-gate` is the anonymity counterpart — it blocks specifically on egress/logging/identifier/fingerprint/correlation/weakened-default regressions and nothing else is its job. Run all three for a change that is both risky and anonymity-sensitive.

**Prerequisites & hand-offs.** Plugin installed. For CI, wire it with `anthropics/claude-code-action@v1` using the canonical setup in [`examples/github-opsec-gate.yml`](../../../plugins/privacy-opsec-suite/examples/github-opsec-gate.yml) (`/install-github-app`, then paste the criteria). A VCS tool is used to post inline comments if connected. It is the last link after the audits → `LEAK_REGISTER.md` → `opsec-hardening` chain.

---

## Orchestrator

### `/privacy-opsec-suite:full-sweep`
**Mode:** orchestrator

**How it works.** It runs the other skills in sequence as one developer-in-the-loop pipeline, carrying `LEAK_REGISTER.md` forward, keeping a master plan, and checkpointing at every phase boundary. Phase 0 (checkpoint) detects the stack and repo size and confirms the track — `audit-only` (read + document, no code changes), `full` (audit → harden → docs/gate), or a custom subset — along with scope, the adversaries to emphasize, PR preference, and whether code-changing phases are pre-approved or gated each time; it opens a master todo and a running `EXECUTIVE_SUMMARY.md`. Phase 1 runs **anonymity-threat-model** (checkpoint: worst paths, go/no-go). Phase 2 runs the audits in parallel where independent — **anon-session-audit**, **tor-egress-audit**, **metadata-leak-audit**, **fingerprint-resistance**, **traffic-analysis-resistance**, **supply-chain-trust** — merging everything into `LEAK_REGISTER.md` (checkpoint: ranked leaks, decide what to fix). Phase 3 runs **opsec-hardening** against the register, each fix pinned with a regression test, with a checkpoint per batch and intentional behavior-tightening confirmed. Phase 4 runs **privacy-doc-alignment** to reconcile promises/threat-model/runbooks and surface unkept promises, then wires **opsec-pr-gate** into review. A separate incident path starts with **leak-incident-response** when a leak is suspected rather than sought, feeding its output into the same register.

**Why it's useful.** It is the one-command way to take a project from no model to a reconciled, gated, hardened anonymity posture, with the developer in the loop at every boundary and a single `EXECUTIVE_SUMMARY.md` tying findings, fixes, and residual risk together.

**When to use it.** When you want the whole privacy-opsec-suite run end-to-end on a project with anonymity/opsec needs. Disambiguation: `full-sweep` is the **intra-plugin** orchestrator — it sequences only this suite's skills. The cross-plugin orchestrator that spans the breadth spine, the rigor verification layer, the researcher proposal layer, and this anonymity track is the code-ops-suite **everything** orchestrator; reach for `everything` when the work crosses plugin boundaries, and for `full-sweep` when it is anonymity work alone. Choose `audit-only` to find leaks without changing code, `full` to find and fix them.

**Prerequisites & hand-offs.** Requires the privacy-opsec-suite plugin installed. The `full` track's hardening phase changes code and is always gated (`§4`); never auto-merge. Produces `ANONYMITY_THREAT_MODEL.md`, a merged `LEAK_REGISTER.md`, hardening PRs with regression tests, reconciled docs, a wired `opsec-pr-gate`, and the master `EXECUTIVE_SUMMARY.md`.

---

*Verified-at: a181b36*
