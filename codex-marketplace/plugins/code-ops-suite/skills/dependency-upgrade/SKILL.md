---
name: dependency-upgrade
description: "Use when dependencies are outdated or have known CVEs and you want safe, staged upgrades verified at each step; never bulk-bumps."
---

# DEPENDENCY UPGRADE — Safe Supply-Chain Maintenance

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:dependency-upgrade`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Produces:** verified upgrade PRs, `DEPENDENCY_REPORT.md`, an updated lockfile.

Bring dependencies current **safely** — patch CVEs, upgrade outdated packages, migrate majors carefully, deduplicate, remove unused — each change isolated, changelog-checked, and verified. **Never bulk-bump.**

## Phase 0 — Inventory & plan  *(checkpoint)*
Catalogue direct vs. transitive deps; current vs. latest; deprecated/EOL; duplicates/multiple versions; **known CVEs with severity**; unused deps; licenses; pinning/lockfile state. Ingest any audit deps findings. Prioritize: (1) security CVEs by severity, (2) deprecated/EOL, (3) outdated **majors** with real value, (4) routine minors/patches, (5) dedup + removal.
> **CHECKPOINT:** present the inventory (CVEs and majors highlighted), the prioritized plan, and any license/telemetry flags; confirm scope and **approve/defer the majors**.

## Phase 1 — Upgrade (parallel where independent, serial where coupled)
Each upgrade gets its own branch/PR. Method: read the changelog/release notes/migration guide (use the docs-lookup/VCS tools if available) → for **majors, get the developer's go-ahead first** and plan the migration → apply the bump + required code changes → run the **full suite + build + typecheck/lint** → for UI-affecting libs, exercise affected screens (UI tool) → extra verification for majors (the features that use it still work) → commit/PR with the version delta, breaking changes handled, and CVE refs. If it can't be made green within reasonable effort, **stop and report** — don't force it. **Flag any new/upgraded dependency that adds telemetry, phones home, or changes the egress/trust surface** — that's a developer decision (`CONVENTIONS §4`). For dedup/cleanup: collapse duplicate versions and remove confirmed-unused deps (with OK), verifying nothing breaks.

## Deliverables
One verified branch/PR per item or cohesive group; **`DEPENDENCY_REPORT.md`** (upgrades + version deltas, **CVEs closed** with IDs/severity backed by the post-upgrade re-scan output, majors migrated + how, deps deduped/removed, deferred items with reason/risk, any telemetry/egress/license flags); a clean, authoritative **lockfile**.

## Done when
Security CVEs closed — evidenced by a **fresh advisory re-scan against the final lockfile** (the ecosystem's live audit tool: `npm audit` / `pip-audit` / `cargo audit` / equivalent) showing no remaining high/critical advisories except those explicitly accepted or deferred with rationale in the report, never inferred from the version bumps alone; approved upgrades applied and individually verified (build/tests green); no upgrade introduced a telemetry/egress regression; deferred items logged with risk; lockfile clean; report complete. Present the report, CVEs closed and majors handled first.
