---
description: "Use when dependencies are outdated or carry known CVEs and you want safe, staged upgrades verified at each step. It never bulk-bumps."
---

# DEPENDENCY UPGRADE: Safe Supply-Chain Maintenance

**Invoked as `/code-ops-suite:dependency-upgrade`.** First read the
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section.
**Mode:** IMPLEMENT · **Produces:** verified upgrade PRs, `DEPENDENCY_REPORT.md`, and an updated
lockfile.

Bring dependencies current **safely**. Patch CVEs, upgrade outdated packages, migrate majors
carefully, deduplicate, and remove unused packages. Isolate each change, check it against the
changelog, and verify it. **Never bulk-bump.**

## Phase 0: the inventory and the plan  *(checkpoint)*

Catalogue direct against transitive dependencies, current against latest versions, deprecated
and end-of-life packages, duplicates and multiple versions, **known CVEs with severity**, unused
dependencies, licenses, and the pinning and lockfile state. Ingest any dependency findings from
an earlier audit. Prioritize in this order:
1. Security CVEs, by severity.
2. Deprecated and end-of-life packages.
3. Outdated **majors** with real value.
4. Routine minors and patches.
5. Deduplication and removal.

> **CHECKPOINT:** present the inventory with CVEs and majors highlighted, the prioritized plan, and any license or telemetry flags. Confirm the scope, and **approve or defer the majors**.

## Phase 1: the upgrades, parallel where independent and serial where coupled

Dispatch an ephemeral implementation operative per upgrade, with conflict-aware fan-out
(`CONVENTIONS §1`). Give each one its own branch and PR. The method per upgrade:
1. Read the changelog, release notes, and migration guide, using the docs-lookup and version-control tools when available.
2. For a **major**, get the developer's approval first, then plan the migration.
3. Apply the bump plus the required code changes.
4. Run the **full suite, the build, and typecheck or lint**.
5. For a UI-affecting library, exercise the affected screens with the UI tool.
6. For a major, verify further that the features using it still work.
7. Commit and open a PR carrying the version delta, the breaking changes handled, and the CVE references.

When an upgrade cannot be made green within reasonable effort, **stop and report it.** Do not
force it. **Flag any new or upgraded dependency that adds telemetry, phones home, or changes the
egress or trust surface.** That flag is a developer decision (`CONVENTIONS §4`). For deduplication
and cleanup, collapse duplicate versions and remove confirmed-unused dependencies, with approval,
verifying that nothing breaks.

## Deliverables

One verified branch and PR per item or cohesive group. **`DEPENDENCY_REPORT.md`** carries the
upgrades with their version deltas, the **CVEs closed** with IDs and severity backed by the
post-upgrade re-scan output, the majors migrated and how, the dependencies deduplicated or
removed, the deferred items with their reason and risk, and any telemetry, egress, or license
flags. The run also leaves a clean, authoritative **lockfile**.

## Done when

- Security CVEs are closed, evidenced by a **fresh advisory re-scan against the final lockfile** using the ecosystem's live audit tool (`npm audit`, `pip-audit`, `cargo audit`, or the equivalent), showing no remaining high or critical advisories except those explicitly accepted or deferred with rationale in the report. Never infer closure from the version bumps alone.
- Approved upgrades are applied and individually verified, with build and tests green.
- No upgrade introduced a telemetry or egress regression.
- Deferred items are logged with their risk, the lockfile is clean, and the report is complete.
- The report is presented with the CVEs closed and the majors handled first.
