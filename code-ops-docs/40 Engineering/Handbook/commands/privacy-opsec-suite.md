# `privacy-opsec-suite` command reference

This page is the complete command reference for the `privacy-opsec-suite` plugin.
It carries one entry per command: how it works, why it is useful, when to reach for it, and what it hands off.
Read it when you are picking an anonymity command or wiring one into a larger run.

The `privacy-opsec-suite` is the anonymity track of the code-ops marketplace. It ships
adaptive, multi-agent workflows for building, auditing, and operating privacy-respecting,
anonymity-preserving software. Its stance is defensive privacy engineering. It protects your
own system's users and finds and fixes leaks in your own code. It never attacks or
deanonymizes a third party.

Every skill operates inside one non-negotiable envelope, the anonymity and OpSec model in
[`CONVENTIONS.md`](../../../../plugins/privacy-opsec-suite/CONVENTIONS.md) §A:

- anonymous and private by default
- fail closed, never falling back to clearnet
- no new egress, log, identifier, fingerprint, or dependency without scrutiny
- minimize metadata
- never weaken a guarantee silently

The suite chains its skills around a single live backlog. A keystone threat model frames six
parallel leak audits. Those audits write stable-ID findings into `LEAK_REGISTER.md`.
`opsec-hardening` fixes them with regression tests. `opsec-pr-gate` blocks the regressions
from coming back.

Each command is a namespaced slash command, `/privacy-opsec-suite:<skill>`. Invoke a skill by
name, or let the model route to it under the standard-operating-mode routing card.
Anonymity-affecting phases stay gated at every automation level. Every skill reads
`CONVENTIONS.md` first and references it by section: §A for the model, §5 for the modes, §6
for the leak and finding schema, §9 for the quality lenses, §10 for the implementation loop,
and §11 for registers as the single source of truth with `Verified-at` freshness.

This page documents all 14 skills. If you are new, read the intro above, then jump to the
audit you need. If you already run the suite fluently, the per-command **Prerequisites and
hand-offs** lines and the sibling disambiguations carry the load-bearing detail.

## Shared run mechanisms

An anonymity run reads a lot of code, so it uses the suite's shared context mechanisms. Read a
file's outline with `co context skim <file>`, then request a line range. Ask the symbol index
a structural question with `co context query find|callers|callees|blast <symbol>`, which
answers in `file:line` anchors. Long Bash output arrives digested, with a receipt naming the
raw file, and the digest never leaves the machine. The scanners this suite leans on are
reached the same way: `co scan ai-tells`, `co scan redaction`, and `co scan injection`. Each
mechanism is on by default and turns off from the `env` block of a `.claude/settings.json`.
The behavior contracts are in
[the contracts page](../../../35 Contracts and Data/CONTRACTS.md), and the switches are in
[the infrastructure page](../../../50 Platform/INFRASTRUCTURE.md). The
[code-ops-suite page](code-ops-suite.md#bundled-scripts-and-hooks) lists the commands.

## Index

Model and audits (AUDIT and DISCOVERY):

- [`anonymity-threat-model`](#privacy-opsec-suiteanonymity-threat-model): the keystone, mapping how a user could be deanonymized.
- [`anon-session-audit`](#privacy-opsec-suiteanon-session-audit): are sessions truly unlinkable.
- [`tor-egress-audit`](#privacy-opsec-suitetor-egress-audit): no traffic escapes the proxy or Tor.
- [`metadata-leak-audit`](#privacy-opsec-suitemetadata-leak-audit): minimize what leaks at rest and in band.
- [`fingerprint-resistance`](#privacy-opsec-suitefingerprint-resistance): make users indistinguishable.
- [`traffic-analysis-resistance`](#privacy-opsec-suitetraffic-analysis-resistance): reduce observable timing, size, and volume signatures.
- [`supply-chain-trust`](#privacy-opsec-suitesupply-chain-trust): dependencies that do not betray anonymity.

Build and respond (IMPLEMENT, DISCOVERY, and REVIEW):

- [`opsec-hardening`](#privacy-opsec-suiteopsec-hardening): implement the leak fixes safely, each pinned by a regression test.
- [`privacy-feature-design`](#privacy-opsec-suiteprivacy-feature-design): find and spec high-value privacy and trust features.
- [`leak-incident-response`](#privacy-opsec-suiteleak-incident-response): triage, contain, scope, and plan a suspected leak.
- [`authorship-hygiene`](#privacy-opsec-suiteauthorship-hygiene): remove AI and tooling trace before publishing.

Docs and gate (DOCUMENT and REVIEW):

- [`privacy-doc-alignment`](#privacy-opsec-suiteprivacy-doc-alignment): reconcile privacy promises against code and establish the single source of truth.
- [`opsec-pr-gate`](#privacy-opsec-suiteopsec-pr-gate): the pre-merge gate that blocks anonymity regressions.

Orchestrator:

- [`full-sweep`](#privacy-opsec-suitefull-sweep): run the whole suite end to end as one checkpointed pipeline.

---

## Model and audits

### `/privacy-opsec-suite:anonymity-threat-model`
**Mode:** AUDIT and DOCUMENT

**How it works.** Two phases:

- **Phase 0** (checkpoint) inventories the assets that identify or link a user: real IP and location, account or session identifiers, behavioral patterns, device characteristics, metadata, and anything correlatable across sessions or time. It lays out the adversaries and trust boundaries (`CONVENTIONS §A`) and states the system's anonymity goals of unlinkability, unobservability, deniability, and minimization. It pauses to confirm scope and which adversaries to emphasize.
- **Phase 1** maps deanonymization paths for each adversary against each asset, across the network, session, application, metadata, dependency, and operator and legal layers. It marks where anonymity depends on a control such as proxy routing, isolation, minimization, or fail-closed behavior, and states what happens if that control fails. It then rates residual risk and cross-checks every stated promise against reality.

**Produces** the durable, reusable artifact `ANONYMITY_THREAT_MODEL.md`, and routes concrete,
fixable issues into `LEAK_REGISTER.md` on schema `§6`.

**Why it's useful.** It is the keystone of the suite. Every other audit and the orchestrator
reads it for scope, adversary emphasis, and which controls anonymity depends on. Without it
the audits have no shared frame and the register has no priorities.

**When to use it.** Run it first, before any of the leak audits, on any project with anonymity
or opsec needs. Re-run it when the architecture, the threat surface, or the adversary set
changes. Do not reach for it to find a specific leak class, which is what the focused audits
do. This skill is the map, covering every adversary against every asset with residual-risk
paths and a reusable document. `metadata-leak-audit` is one focused sweep of PII and
identifiers in logs, telemetry, embedded file metadata, headers, and retention, and it writes
findings but no reusable model.

**Prerequisites and hand-offs.** It requires the plugin installed and no register input. It
produces `ANONYMITY_THREAT_MODEL.md` and seeds `LEAK_REGISTER.md`, which then frames
`anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`,
`traffic-analysis-resistance`, and `supply-chain-trust`.

### `/privacy-opsec-suite:anon-session-audit`
**Mode:** AUDIT

**How it works.** Two phases. Phase 0 (checkpoint) traces how identity and sessions work and
confirms scope. It covers the session identifiers, the cookies and tokens, the account model
(account-less, guest, or ephemeral), the lifecycle of create, resume, expire, and logout, and
where session state lives on the client and the server.

Phase 1 hunts linkability across five surfaces:

- cross-request and cross-session linkability, from reused tokens, stable identifiers, and account binding
- hidden persistent identifiers, such as device IDs, `localStorage` and IndexedDB, `ETag` and cache used as a supercookie, HSTS and TLS-session-resumption tracking, and canvas or storage fallbacks
- session integrity, covering fixation, low-entropy tokens, missing rotation, and cookie flags and scope
- lifecycle, meaning whether logout fully clears state and whether expiry is enforced server-side
- defaults, meaning whether anonymous is the default with no silent persistent identity

**Produces** findings in `LEAK_REGISTER.md` with leak-class `linkability` or `identification`,
plus a short posture summary.

**Why it's useful.** Sessions are where anonymous users quietly become linkable. This skill is
the dedicated owner of session identity and linkability, and it catches the supercookies and
resumption tricks that re-associate a returning user.

**When to use it.** Use it when you need to prove sessions are unlinkable and that no hidden
persistent identifier survives logout. It owns linkability and session identity. Network
egress belongs to `tor-egress-audit`, and file metadata belongs to `metadata-leak-audit`.
Reach for `fingerprint-resistance` instead when the re-linking vector is a header, TLS, or
behavioral fingerprint rather than a stored identifier.

**Prerequisites and hand-offs.** It requires the plugin installed, and works best after
`anonymity-threat-model` has framed the assets and adversaries. It writes findings into
`LEAK_REGISTER.md` for `opsec-hardening` to fix.

### `/privacy-opsec-suite:tor-egress-audit`
**Mode:** AUDIT

**How it works.** Two phases. Phase 0 (checkpoint) enumerates all outbound network behavior and
confirms the routing policy. It covers HTTP clients, raw sockets, DNS, telemetry and analytics,
third-party SDKs, CDNs and fonts, webhooks, and update and connectivity checks. It records the
intended routing for each path, meaning which must go over Tor, SOCKS, or a proxy, and which is
intentionally direct.

Phase 1 verifies the routing actually holds, across seven checks:

- proxy enforcement, catching any client or library that bypasses the proxy through direct connects, hardcoded hosts, ignored proxy settings, background tasks, or native code
- fail-closed behavior on proxy or circuit failure, checking the error and retry paths specifically
- DNS leaks, requiring lookups through the proxy and never the system resolver, and hunting direct `getaddrinfo` and local-resolver calls
- stream and connection isolation, through per-action SOCKS authentication
- onion-service hygiene where one is served, covering v3 configuration, the real IP never bound or leaked, no mixed clearnet and onion resources, and descriptor, header, and error-page hygiene
- leak vectors, such as WebRTC and STUN, IPv6 against an IPv4-only proxy, NTP, captive-portal checks, prefetch and preconnect, `Referer`, redirect chains, and OS telemetry
- header and TLS uniformity

**Produces** an egress map classifying every path as anonymized, intentionally clear, or a
leak. Findings go to `LEAK_REGISTER.md` with leak-class `egress` or `observability`, and the
summary leads with any clearnet, DNS, or WebRTC leak. Any clearnet or DNS leak is surfaced as
critical.

**Why it's useful.** A single bypassed connection or DNS lookup deanonymizes the user
outright. This skill is the owner of network egress and routing, and it applies the
multi-boundary control-coverage rule (`§9`). A proxy enforced at one entry point but not
enumerated at every entry point is a leak, not a pass.

**When to use it.** Use it whenever the product routes any traffic over Tor, SOCKS, or a
proxy, runs an onion service, or claims fail-closed networking. It owns network egress and
routing. Session identifiers belong to `anon-session-audit`, and at-rest file metadata belongs
to `metadata-leak-audit`.

**Prerequisites and hand-offs.** It requires the plugin installed, and is framed by
`anonymity-threat-model`. Read-only network, proxy, DNS, and header inspection tools are used
when connected, and skipped otherwise. It feeds `egress`-class findings to `opsec-hardening`.

### `/privacy-opsec-suite:metadata-leak-audit`
**Mode:** AUDIT

**How it works.** Two phases. Phase 0 (checkpoint) inventories everywhere metadata is produced,
stored, served, or logged, and confirms scope. It covers logging, telemetry and analytics,
error and crash reporting, generated and served files, response headers, caches and CDN, and
backups.

Phase 1 hunts and minimizes across four surfaces:

- logs, telemetry, and errors, covering PII, IPs, identifiers, tokens, precise timestamps, and verbose stack traces shipped off-box
- embedded file metadata, covering EXIF, document author and timestamps, build metadata, source maps, debug symbols, file paths, and usernames baked into artifacts
- headers, covering `Server`, `X-Powered-By`, `Date` drift, `ETag`, `Set-Cookie`, and framework banners
- side channels and retention, covering response size and timing differences that reveal content or state, cache and CDN per-user leakage, logs and backups kept too long, and anonymized data that re-identifies

The throughline is strip or minimize, because what is not emitted cannot leak or be compelled.

**Produces** findings in `LEAK_REGISTER.md` with leak-class `metadata` or `observability`.

**Why it's useful.** Metadata is the quiet leak: EXIF GPS in an uploaded photo, a username in
a stack trace, an IP in a log line. This skill owns the at-rest and in-band metadata surface
and turns it into concrete stripping recommendations ranked by impact.

**When to use it.** Use it when you need to know what PII and identifiers leak through logs,
telemetry, errors, headers, or embedded file metadata, and what your retention exposes. It
owns at-rest and in-band metadata. Timing and size side channels belong to
`traffic-analysis-resistance`. Against the keystone, `anonymity-threat-model` is the full
reusable map of every adversary against every asset, while `metadata-leak-audit` is the single
focused sweep of the metadata surface that writes findings into the register.

**Prerequisites and hand-offs.** It requires the plugin installed, and is framed by
`anonymity-threat-model`. It feeds `metadata`-class findings to `opsec-hardening`, covering
EXIF, header, and log stripping.

### `/privacy-opsec-suite:fingerprint-resistance`
**Mode:** AUDIT

**How it works.** Two phases. Phase 0 (checkpoint) identifies what could distinguish or re-link
one anonymous session from another, on both the client and the server side, and confirms scope.

Phase 1 enumerates and recommends homogenization across five surfaces:

- network and transport, covering the header set, ordering, and uniqueness, the TLS or JA3 fingerprint, SNI, and protocol quirks
- the client surface where applicable, covering canvas, WebGL, and audio fingerprints, fonts, screen and device pixel ratio, timezone, language, plugins, and per-user feature flags or config that leak
- behavioral patterns, covering timing, interaction cadence, and request ordering
- re-association vectors that re-link a returning anonymous user
- server-side responses that differ per client

The recommendation is always homogenization, meaning uniform defaults that make every user
look like everyone else, and never per-user uniqueness.

**Produces** findings in `LEAK_REGISTER.md` with leak-class `identification` or `correlation`.

**Why it's useful.** Even with no stored identifier, a distinctive header order, JA3
fingerprint, or canvas hash re-links anonymous sessions. This skill owns identity-fingerprint
distinctiveness and pushes toward a uniform crowd.

**When to use it.** Use it when the re-linking risk is a fingerprint, meaning header, TLS,
JA3, or behavioral uniqueness, rather than a stored identifier. It owns identity-fingerprint
distinctiveness. Traffic timing and size belong to `traffic-analysis-resistance`. Stored
session identifiers belong to `anon-session-audit`, which this skill cross-references for
re-association.

**Prerequisites and hand-offs.** It requires the plugin installed, and is framed by
`anonymity-threat-model`. A browser or UI tool is used for the client-side surface when
connected. It feeds homogenization findings to `opsec-hardening`.

### `/privacy-opsec-suite:traffic-analysis-resistance`
**Mode:** AUDIT

**How it works.** Two phases. Phase 0 (checkpoint) describes what an on-path or endpoint
observer can see, meaning request and response sizes, timing, volume, and cadence. It confirms
scope and the threat, distinguishing an on-path observer from an endpoint.

Phase 1 finds correlatable signatures across four classes:

- size signatures, meaning distinctive request or response sizes that reveal the action or content, payload-size oracles, and compression side channels of the CRIME and BREACH kind
- timing, meaning patterns correlating input to output, or end-to-end timing that links a user's clearnet entry to anonymized activity
- volume and cadence acting as a signature
- mitigation options, such as padding, batching, constant-rate behavior, cover traffic, and response-time normalization for sensitive operations

**Produces** findings in `LEAK_REGISTER.md` with leak-class `observability` or `correlation`,
each carrying an honest statement of residual risk. The skill sets expectations up front. Full
protection against a global passive adversary is generally out of scope, because it reduces
correlatability rather than eliminating it.

**Why it's useful.** Traffic shape leaks even when content is encrypted and routed over Tor.
This skill owns traffic-shape correlation and proposes the padding, batching, and
normalization defaults that blunt it, while being candid about what cannot be fixed.

**When to use it.** Use it when you need to reduce observable timing, size, or volume side
channels, or when you are considering padding and batching defaults. It owns traffic-shape
correlation. Header and TLS fingerprints belong to `fingerprint-resistance`. Do not expect it
to defeat a global passive adversary, and it will say so.

**Prerequisites and hand-offs.** It requires the plugin installed, and is framed by
`anonymity-threat-model`. It feeds `observability` and `correlation` findings to
`opsec-hardening`.

### `/privacy-opsec-suite:supply-chain-trust`
**Mode:** AUDIT, plus safe fixes with confirmation

**How it works.** Two phases. Phase 0 (checkpoint) catalogues direct and transitive
dependencies, their network behavior, known CVEs by severity, and build and lockfile integrity.
It then confirms scope with the telemetry, egress, and CVE flags highlighted.

Phase 1 assesses trust under the model, across five lenses:

- egress and telemetry, asking whether any dependency phones home, sends analytics, makes third-party calls, or adds an egress path or fingerprint vector, each treated as an anonymity finding rather than bloat
- vulnerabilities, covering CVEs by severity and abandoned or unmaintained packages
- integrity, covering lockfile integrity, reproducible builds, postinstall and build scripts that could exfiltrate, and secrets pulled in through dependencies
- provenance, covering typosquat and lookalike risk, and preferring minimal, audited, offline-capable dependencies
- agent-ingested content, described below

Agent-ingested content is the prompt-injection surface. Anything an agent will read from a
dependency is untrusted input and never instructions. That includes a vendored skill or
plugin, an MCP server's tool descriptions, rules files, and READMEs surfaced by doc lookups.
Run `co scan injection <payload paths>` over every payload before it is read raw, as the
mechanical floor. Scanner hits are triage input, never auto-findings, and every hit is
dispositioned. The full payload is then still audited for injection directives, hidden
zero-width and HTML-comment payloads, exfiltration prompts, and credential-path references,
with the flagged regions read first. A working injection-to-egress chain is a critical
`egress` or `secret` leak that blocks adoption.

**Produces** `LEAK_REGISTER.md` entries for egress and telemetry dependencies with leak-class
`egress` or `secret`, plus CVE entries, and a report of what to remove, replace, pin, or
disable. It applies safe removals or pins only with confirmation.

**Why it's useful.** A dependency that phones home betrays anonymity regardless of how clean
your own code is. This skill vets the supply chain through an anonymity-hostile lens, so a
telemetry-laden package becomes a finding rather than an accepted default.

**When to use it.** Use it when you need to vet dependencies for telemetry, phone-home
behavior, egress, CVEs, build and lockfile integrity, or the prompt-injection risk of content
an agent will ingest, meaning skills, plugins, MCP servers, and dependency docs. Unlike the
read-only audits it can apply safe fixes such as removals and pins, but only with confirmation
and only with the build and tests staying green.

**Prerequisites and hand-offs.** It requires the plugin installed, and is framed by
`anonymity-threat-model`. The documentation lookup defaults to the local-first, no-egress
`lib-docs.mjs`, or the `code-ops-docs` `get-docs` MCP tool when `code-ops-suite` is installed,
because a doc lookup must not itself leak what you are building. A dependency bot is
recommended as a deterministic CVE backstop. It feeds findings to `opsec-hardening`.

---

## Build and respond

### `/privacy-opsec-suite:opsec-hardening`
**Mode:** IMPLEMENT

**How it works.** Two phases:

- **Phase 0** (checkpoint) reads `LEAK_REGISTER.md` and re-validates first (`CONVENTIONS §11`). It runs `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs LEAK_REGISTER.md --root .`, triages the FRESH, MOVED, DRIFTED, GONE, AMBIGUOUS, and NO-REF report, and confirms each surviving leak still reproduces. Anything already fixed is dropped or marked `OBSOLETE-AT <sha>`. It then builds a dependency and conflict graph and sequences by severity, putting deanonymization and secret leaks first. It pauses to present the re-validation results, the order and batching, and the PR preference, and it gets a direction on NEEDS-DESIGN items.
- **Phase 1** implements through the implementation loop (`§10`). Common hardening enforces proxy and Tor routing and fail-closed behavior, routes DNS through the proxy and closes WebRTC and IPv6 leaks, enforces stream isolation, strips metadata, redacts or removes sensitive logging and default-denies telemetry, removes or replaces fingerprint vectors, tightens the cookie and session lifecycle, and default-denies egress. Several of those intentionally tighten behavior, which is the point, and each is confirmed with the developer and pinned.

For every fix it adds a regression test that fails if the leak returns. Examples are asserting
no clearnet connect on proxy failure, no PII in a log line, and EXIF stripped.

**Produces** atomic PRs or branches, an `IMPLEMENTATION_LOG.md`, an updated register, and
updated opsec docs. The register must pass `revalidate-register.mjs --consumed <pre-run copy>`.
No consumed leak vanishes or closes without a pinned terminal form: closed-with-proof,
deferred-with-reason, or OBSOLETE-AT.

**Why it's useful.** It is the dedicated hardening implementation skill, the one that turns a
leak backlog into shut-and-locked fixes. The regression-test-per-leak discipline means a
closed leak stays closed.

**When to use it.** Use it after the audits, or `leak-incident-response`, have populated
`LEAK_REGISTER.md` and you want the leaks fixed safely. Do not run it without a register,
because it consumes one as input. Because it changes the anonymity and opsec posture, its work
is always gated (`§4`). Never auto-merge.

**Prerequisites and hand-offs.** It requires a populated `LEAK_REGISTER.md` from the audits,
from `full-sweep` Phase 2, or from `leak-incident-response`. The default automation level is
`gated`, and the always-gated categories hold regardless: egress, logging, identifiers,
defaults, secrets, migrations, and public contracts. Its closed leaks are then guarded by
`opsec-pr-gate`.

### `/privacy-opsec-suite:privacy-feature-design`
**Mode:** DISCOVERY

**How it works.** Three phases:

- **Phase 0** (checkpoint) maps the current feature set, the anonymity and opsec model, latent capabilities, and intent signals such as TODOs, stubs, and disabled flags. It then confirms direction, target users, scope, and appetite.
- **Phase 1** finds code-grounded privacy and trust capabilities that deepen the moat: data export and portability, local-first or self-host, end-to-end or zero-knowledge options, ephemeral and anonymous modes, metadata-minimization toggles, user-controlled audit logs, "what we know about you" transparency, granular anonymity controls, a Tor-only mode, and panic or wipe. It gates every idea against the anonymity model (`§A`), where an idea must strengthen anonymity or be neutral. Anything that would erode anonymity is flagged for a developer decision and never silently proposed. Each idea gets its smallest valuable slice.
- **Phase 2** (checkpoint) ranks by impact times reach divided by effort, weighted by confidence, and tags quick wins and big bets. After the developer picks, it writes a mini-spec per chosen feature, including its anonymity impact and threat-model fit.

**Produces** `PRIVACY_FEATURE_OPPORTUNITIES.md` as a ranked register, the chosen mini-specs, a
roadmap, and an `EXECUTIVE_SUMMARY.md`. It changes no code.

**Why it's useful.** It turns anonymity from a constraint into a product moat. It surfaces
trust-building features grounded in what the code can already do, proven safe against the
model before anyone builds them.

**When to use it.** Use it when you want high-value privacy and trust features found and
specified. It is discovery and specification only, and it never writes code. Hand the chosen
mini-specs to an implementer. Inside this suite that means feeding the spec to
`opsec-hardening` for anonymity-tightening work, and outside it means the code-ops-suite for a
general feature build.

**Prerequisites and hand-offs.** It requires the plugin installed, and benefits from an
existing `ANONYMITY_THREAT_MODEL.md` for the gating step. It produces ranked specs that hand
off to an implementing skill.

### `/privacy-opsec-suite:leak-incident-response`
**Mode:** REVIEW (analysis plus a proposed containment change, no destructive action)

**How it works.** Two phases:

- **Phase 0** (checkpoint) captures the suspected leak, the affected area, and the timeline without making it worse. It does not add PII logging to investigate, and it works from redacted evidence. It then confirms scope and surfaces anything clearly critical immediately.
- **Phase 1** runs triage, containment, scoping, and planning. Triage asks whether it is a real leak, confirmed with redacted `file:line` evidence and false positives ruled out. Containment proposes the smallest immediate change that stops it, meaning fail closed, disable the leaking path, or block the egress, for the developer to apply. Blast radius states what was exposed, who could be deanonymized or linked, over what window, and observable by which adversary. Root cause names the underlying defect. The remediation plan gives the durable fix plus a regression test that locks the leak shut. Communication states what to disclose, factually, without over-collecting.

**Produces** an incident report in `OPSEC_RUNBOOK.md`, a tracked entry in `LEAK_REGISTER.md`,
and the proposed containment change.

**Why it's useful.** When a leak is suspected, the worst move is a panicked investigation that
adds logging and widens the exposure. This skill gives a disciplined, redaction-first
containment path, and it feeds the durable fix into the same backlog the rest of the suite
uses.

**When to use it.** Use it when an anonymity or privacy leak or correlation vector is
suspected rather than being systematically sought. The audits are the proactive path, and this
is the reactive one. It proposes a containment change but applies nothing destructive. The
durable fix goes through `opsec-hardening` with the developer's go-ahead.

**Prerequisites and hand-offs.** It requires the plugin installed. It feeds its tracked entry
into `LEAK_REGISTER.md` and its report into `OPSEC_RUNBOOK.md`, and `opsec-hardening` then
carries out the remediation. In `full-sweep` this is the separate incident entry point.

### `/privacy-opsec-suite:authorship-hygiene`
**Mode:** REVIEW (audit) and IMPLEMENT (scrub)

**How it works.** It treats tooling and AI trace in version control as a metadata leak (`§A`),
and it cleans three surfaces across a named commit range, a PR body, and a working diff:

- **L1, metadata** (mechanical, near-zero risk). It strips `Co-Authored-By:` tool trailers, "Generated with" or "Generated by" tool markers, AI markers in branch names, and bot author and committer identities, and it sets author and committer to the human's git identity. The mechanical floor is `co scan ai-tells <commit-range-or-pr-body-file>`, which flags trailers, tool markers, emoji, em-dash density, assistant-prose tells, and `## Test plan` boilerplate.
- **L2, prose voice.** It learns the author's style from history, covering tense, length, capitalization, whether they use conventional commits, emoji, bullets against prose, and section habits. It then rewrites commit messages and descriptions to match, killing the tells the scanner cannot judge, such as over-explanation, hedging, and "Notably" or "Here's what" openers.
- **L3, code idiom blend-in** (behavior-preserving). It runs the repo's formatter and linter first, then rectifies semantically equivalent but divergent forms in each changed hunk to match its neighbors. It never swaps genuinely different behavior, and it surfaces anything risky rather than applying it.

An intentional scan of one edited tracked artifact may add
`--emdash-baseline-rev <pre-edit-revision>`. That revision must be an ancestor of `HEAD`, and
the scanner reads the same target's blob from that commit. Arbitrary baseline files are not
accepted. The option requires exactly one file target, cannot combine with `--git`, and never
suppresses another check.

A fail-closed gate ends the run. `co scan ai-tells` must exit 0 over the commit range and the
PR bodies before anything is published. Any run artifacts being published must also pass
`co scan redaction` with no fail-closed secret hits. If the trace cannot be cleaned, the run
stops and surfaces it.

**Why it's useful.** Published commit metadata, message and PR prose, and code idiom are a
fingerprint surface, and published work should reflect the author rather than the tool. This
is the suite's enforcement of the §A no-tooling-trace rule, with a deterministic scanner as
the floor.

**When to use it.** Run it before publishing a commit, PR, or branch that must carry no AI or
tooling trace. On the code surface, L3 only makes this diff indistinguishable from its
neighbors. It delegates repo-wide one-style normalization to `code-ops-suite:normalize`, and
divergent implementations of one concept to `rigor:consistency-closure`. Do not use it to fix
behavior, because it is behavior-preserving and surfaces anything risky.

**Prerequisites and hand-offs.** It requires the plugin installed, and the bundled
`co scan ai-tells` is the fail-closed gate. Version-control history is read to learn the
author's voice. It is typically the final step before pushing the work produced by
`opsec-hardening` or any other implementer.

---

## Docs and gate

### `/privacy-opsec-suite:privacy-doc-alignment`
**Mode:** DOCUMENT

**How it works.** Two phases:

- **Phase 0** (checkpoint) inventories the privacy and opsec docs with each one's purpose, covering the privacy policy, threat model, opsec runbooks, and contributor rules. It maps code reality, and maps the intended single source of truth, meaning which doc is authoritative per topic, flagging no-owner and duplicate authorities. It then confirms which docs are authoritative and which are aspirational.
- **Phase 1** verifies every privacy claim against the code and classifies each drift as stale, wrong, contradictory, orphaned, missing, or duplicate-SSOT. Its top priority is any privacy promise the code does not actually keep. An unkept promise is worse than none, so it flags the promise loudly as a finding rather than quietly softening the doc. It auto-fixes unambiguous factual drift, brings stale-against-aspirational and structural changes to the developer, and establishes one authoritative threat model, privacy policy, and opsec runbook, plus an index and a clear "rules contributors must not break" doc.

**Produces** reconciled docs, `DRIFT_REPORT.md`, `SSOT_MAP.md`, and `OPEN_QUESTIONS.md`. It
edits documentation only, and logs any code issue as a finding.

**Why it's useful.** A privacy promise the code does not keep is a liability and a broken trust
contract. This skill makes the docs match reality, surfaces unkept promises loudly, and gives
each topic a single authoritative source, so the threat model, privacy policy, and runbooks
stay the single source of truth as the code changes.

**When to use it.** Use it when privacy promises, the threat model, or the opsec runbooks have
drifted from code and you want them reconciled. It is DOCUMENT mode and never changes code,
because it logs code issues as findings for `opsec-hardening`.

**Prerequisites and hand-offs.** It requires the plugin installed, and is most valuable after
hardening, so the docs reflect the fixed code. Any code-level finding it logs hands off to
`opsec-hardening`. Its reconciled threat model and runbooks remain the single source of truth
the rest of the suite reads.

### `/privacy-opsec-suite:opsec-pr-gate`
**Mode:** REVIEW (name the PR, branch, or diff)

**How it works.** Two phases. Phase 0 pulls the PR or diff, its intent (description, linked
issue, leak ID, or spec), and the surrounding code. It fans out to the `privacy-reviewer`
subagent for large PRs and synthesizes one review.

Phase 1 reviews against the lenses (`§9`) and treats six changes as blocking regressions:

- a new egress path, or a fallback that bypasses the proxy or breaks fail-closed behavior
- a new log line touching PII, identifiers, or IPs, or added telemetry
- a new identifier, cookie, or fingerprint vector, or anything increasing cross-session linkability
- a new correlation surface of timing, size, or volume, or a metadata leak
- a new third-party dependency that phones home or opens egress
- any weakened default, meaning less anonymous by default or opt-in privacy

It also verifies that fail-closed behavior still holds, that metadata stays minimized, and that
stream isolation is not undone.

**Produces** prioritized comments at `file:line`, grouped Blocking, Should-fix, and Nit, plus
a verdict of approve, approve-with-nits, or request-changes, and a short risk read. Comments
post to the PR when a version-control tool is connected, and otherwise land in `REVIEW.md`. It
does not approve anything that weakens anonymity.

**Why it's useful.** It is the standing guard that keeps closed leaks closed and stops new
anonymity regressions before they merge. It is the enforcement endpoint of the whole chain.

**When to use it.** Run it on every PR by wiring it into CI, and especially as the gate after
`opsec-hardening` lands fixes. It is review-only by default. Among the three review gates,
`code-ops-suite:pr-review` is the general engineering review of correctness, design, tests,
and maintainability. `rigor:deep-review` is the high-signal, evidence-tiered verification
review. `privacy-opsec-suite:opsec-pr-gate` is the anonymity counterpart, blocking
specifically on egress, logging, identifier, fingerprint, correlation, and weakened-default
regressions, and nothing else is its job. Run all three for a change that is both risky and
anonymity-sensitive.

**Prerequisites and hand-offs.** It requires the plugin installed. For CI, use the reviewed
immutable action pin in
[`examples/github-opsec-gate.yml`](../../../../plugins/privacy-opsec-suite/examples/github-opsec-gate.yml).
A version-control tool is used to post inline comments when connected. It is the last link
after the chain of audits, `LEAK_REGISTER.md`, and `opsec-hardening`.

---

## Orchestrator

### `/privacy-opsec-suite:full-sweep`
**Mode:** orchestrator

**How it works.** It runs the other skills in sequence as one developer-in-the-loop pipeline.
It carries `LEAK_REGISTER.md` forward, keeps a master plan, and checkpoints at every phase
boundary:

- **Phase 0** (checkpoint) detects the stack and repo size and confirms the track: `audit-only` to read and document with no code changes, `full` to audit, then harden, then reconcile docs and wire the gate, or a custom subset. It also confirms scope, the adversaries to emphasize, the PR preference, and whether code-changing phases are pre-approved or gated each time. It opens a master todo and a running `EXECUTIVE_SUMMARY.md`.
- **Phase 1** runs `anonymity-threat-model`, checkpointing on the worst paths and a go or no-go.
- **Phase 2** runs the audits in parallel where they are independent: `anon-session-audit`, `tor-egress-audit`, `metadata-leak-audit`, `fingerprint-resistance`, `traffic-analysis-resistance`, and `supply-chain-trust`. Everything merges into `LEAK_REGISTER.md`, and the checkpoint presents the ranked leaks so you decide what to fix.
- **Phase 3** runs `opsec-hardening` against the register, each fix pinned with a regression test, with a checkpoint per batch and intentional behavior-tightening confirmed.
- **Phase 4** runs `privacy-doc-alignment` to reconcile the promises, threat model, and runbooks and surface unkept promises, then wires `opsec-pr-gate` into review.

A separate incident path starts with `leak-incident-response`, when a leak is suspected rather
than sought, and feeds its output into the same register.

**Why it's useful.** It is the one-command way to take a project from no model to a
reconciled, gated, hardened anonymity posture. The developer stays in the loop at every
boundary, and one `EXECUTIVE_SUMMARY.md` ties findings, fixes, and residual risk together.

**When to use it.** Use it when you want the whole privacy-opsec-suite run end to end on a
project with anonymity or opsec needs. This `full-sweep` is the intra-plugin orchestrator and
sequences only this suite's skills. The cross-plugin orchestrator is
`code-ops-suite:everything`, which spans the breadth spine, the rigor verification layer, and
this anonymity track, and requires those three plugins installed. Reach for `everything` when
the work crosses plugin boundaries, and for `full-sweep` when it is anonymity work alone.
Choose `audit-only` to find leaks without changing code, and `full` to find and fix them.

**Prerequisites and hand-offs.** It requires the privacy-opsec-suite plugin installed. The
`full` track's hardening phase changes code and is always gated (`§4`). Never auto-merge. It
produces `ANONYMITY_THREAT_MODEL.md`, a merged `LEAK_REGISTER.md`, hardening PRs with
regression tests, reconciled docs, a wired `opsec-pr-gate`, and the master
`EXECUTIVE_SUMMARY.md`.

---

*Verified-at: b0ffede*
