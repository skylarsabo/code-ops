---
description: "Use when you want to know what changed in OUR stack that we should act on — dependency updates, CVEs, deprecations, newly-available capabilities — grounded in what we actually use. Schedulable; discovery only — writes no code."
disable-model-invocation: true
---

# ECOSYSTEM WATCH — What Changed In Our Stack

**Invoked as `/researcher:ecosystem-watch`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — the research-integrity & egress model (§A), protocol, rails, schemas, tiers, and lenses, referenced by section.
**Mode:** DISCOVERY · **Produces:** `ECOSYSTEM_WATCH.md` (tiered, cited register), `EGRESS_MANIFEST.md`, `EXECUTIVE_SUMMARY.md`. Every item is tiered + cited (§7), disconfirmed against our tree (§A), and handed off (§11); **never edits source**. Schedulable — each run diffs the prior register.

## Phase 0 — Inventory stack, scope, egress  *(checkpoint)*
Detect package manager(s)/manifests/lockfiles, runtime pins, container/base images, CI toolchain, platform SDKs. Read the prior `ECOSYSTEM_WATCH.md` if present — a diff, not a restart. Scope: dependency tiers (direct vs. transitive), change classes (security only vs. also deprecations + capabilities), freshness window.
> **CHECKPOINT:** present the detected stack, the scope, and an explicit **egress plan** (hosts/feeds + why). Get opt-in, or confirm a **local-only** run (lockfile + installed-doc grounding). No request leaves the machine before approval (§A, §3); the approved budget bounds Phase 2.

## Phase 1 — Ground what we actually run  *(local, no egress)*
Resolve **installed/locked versions** from the lockfile (not manifest ranges); confirm each dep is **in use** via imports (`file:line`) — an outdated package nothing imports is a removal candidate, not an upgrade. Read installed docs/types via `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (or the `code-ops-docs` MCP `get-docs` when `code-ops-suite` is installed) — zero query-egress (§2) — including each dep's own deprecation notices. Record runtime/base-image pins and EOL-relevant versions.

## Phase 2 — Gather changes  *(opt-in web; every request recorded)*
Only with the Phase 0 opt-in, inside the agreed hosts/budget. Compose the `deep-research` skill; per dependency gather **new releases**, **advisories/CVEs** (severity + affected ranges), **deprecations/EOL dates**, **newly-available capabilities** we work around. Prefer primary sources (§7, §10 source-quality). Record every external request as it happens — `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record --tool <tool> --host <host> --url <url> --why "<reason>"`; a published item must not cite a source absent from the manifest (validator fails closed, §A, §12). Redact secrets/PII to `<REDACTED:reason>` (§4). If more reach is needed than approved, **stop and return to a checkpoint** — never widen egress silently.

## Phase 3 — Triage & disconfirm  *(compose `research-verify`)*
Disconfirmation pass (§A) before any register entry: does the **affected version range** include what we run? do we **call the affected/deprecated API** (`file:line`, or drop)? already mitigated/pinned/flagged? is the CVE reachable for our usage, or theoretical? Compose `research-verify` to adversarially confirm high-impact/security-class claims against the source and our code, tiering the verdict — **CONFIRMED** (affected version + reachable usage, verified against our tree or a primary advisory) · **PROBABLE** · **SPECULATIVE** (§7). Discard ecosystem noise that doesn't touch us.

## Phase 4 — Register & hand off  *(checkpoint)*
Write survivors to `ECOSYSTEM_WATCH.md` per the finding schema (§6) — `RSCH-NNN`, all fields, sources (lockfile entry · installed-doc · external + manifest line), `Verified-at: <sha>`, grounding (the `file:line` we run). Rank by value × reach ÷ effort weighted by tier and grounding (§8), security first. Hand-off map (§11): CVEs and upgrades → `code-ops-suite:dependency-upgrade`; egress/telemetry/provenance/integrity concerns → `privacy-opsec-suite:supply-chain-trust`; adoptable capabilities → `feature-discovery` / `feature-implementation`; a forced architectural choice (e.g. EOL runtime migration) → `adr`. Before publishing, run `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs ECOSYSTEM_WATCH.md --root <repo>` and `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate ECOSYSTEM_WATCH.md` (fails closed on un-manifested external claims, §12).
> **CHECKPOINT:** present the ranked register (reachable CVEs first) and the egress manifest; the developer decides hand-off / schedule / accept-defer. The researcher never performs the upgrades.

## Recurring schedule
A scheduled run re-grounds (Phase 1), gathers only changes since the prior `Verified-at` sha within the standing opt-in and budget, and stamps dropped entries `OBSOLETE-AT <sha>` (§12). It still honors §A — pre-agreed egress scope, every request manifested; a run that would exceed scope stops at a checkpoint rather than widening egress unattended.

## Done when
Baseline = installed/locked versions + confirmed in-use deps; every gathered change triaged against our tree and registered or dropped with a reason; no claim un-cited, no external claim un-manifested (`research-manifest.mjs validate` passes); each entry tiered, stamped `Verified-at: <sha>`, mapped to an implementer (§11); register re-validated (`revalidate-register.mjs`), ranked security-first, deduped against the prior run; egress manifest surfaced, within budget; both checkpoints done; no code changed. Present `EXECUTIVE_SUMMARY.md` first, highest-severity reachable change at the top.
