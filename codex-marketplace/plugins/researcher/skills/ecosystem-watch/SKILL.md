---
name: ecosystem-watch
description: "Use when you want to know what changed in OUR stack that we should act on: dependency updates, CVEs, deprecations, and newly available capabilities, grounded in what we actually use. Schedulable, discovery only, and writes no code."
---

# Ecosystem watch: what changed in our stack

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `researcher:ecosystem-watch`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It carries the research-integrity and egress model
(`§A`), the protocol, the rails, the schemas, the tiers, and the lenses, referenced by
section.

- **Mode:** DISCOVERY.
- **Produces:** `ECOSYSTEM_WATCH.md` as a tiered, cited register, plus `EGRESS_MANIFEST.md`
  and `EXECUTIVE_SUMMARY.md`.
- **Rules:** every item is tiered and cited (`§7`), disconfirmed against our tree (`§A`), and
  handed off (`§11`). The skill never edits source. It is schedulable, and each run diffs
  the prior register.

## Phase 0: inventory the stack, the scope, and the egress  *(checkpoint)*

Detect the package managers, manifests, and lockfiles, the runtime pins, the container and
base images, the CI toolchain, and the platform SDKs. Read the prior `ECOSYSTEM_WATCH.md`
when one exists, because a run is a diff rather than a restart. Set the scope: the dependency
tiers, meaning direct against transitive, the change classes, meaning security only against
also deprecations and capabilities, and the freshness window.

> **CHECKPOINT:** present the detected stack, the scope, and an explicit egress plan naming
> the hosts and feeds and the reason for each. Get opt-in, or confirm a local-only run
> grounded in the lockfile and the installed documentation. No request leaves the machine
> before approval (`§A`, `§3`), and the approved budget bounds Phase 2.

## Phase 1: ground what we actually run  *(local, no egress)*

Dispatch gatherers, in parallel over disjoint dependency groups, to resolve the installed
and locked versions from the lockfile rather than from the manifest ranges, and to confirm
that each dependency is in use through its imports at `file:line`. An outdated package that
nothing imports is a removal candidate, not an upgrade. Read the installed documentation and
types through `<plugin-root>/scripts/lib-docs.mjs`, or through the `code-ops-docs`
MCP server's `get-docs` tool when `code-ops-suite` is installed, which costs zero query
egress (`§2`). Include each dependency's own deprecation notices. Record the runtime and
base-image pins, and the versions relevant to an end-of-life date.

## Phase 2: gather the changes  *(opt-in web, every request recorded)*

Proceed only with the Phase 0 opt-in, and stay inside the agreed hosts and budget. Compose
the `deep-research` skill. Per dependency, gather the new releases, the advisories and CVEs
with their severity and affected ranges, the deprecations and end-of-life dates, and the
newly available capabilities we currently work around. Prefer primary sources (`§7`, and the
`§10` source-quality lens).

Record every external request as it happens with
`node <plugin-root>/scripts/research-manifest.mjs record --tool <tool> --host <host> --url <url> --why "<reason>"`.
A published item must not cite a source absent from the manifest, because the validator
fails closed (`§A`, `§12`). Redact secrets and personal data to `<REDACTED:reason>` (`§4`).
If you need more reach than was approved, stop and return to a checkpoint. Never widen
egress silently.

## Phase 3: triage and disconfirm  *(compose `research-verify`)*

Run the disconfirmation pass (`§A`) before any register entry:

- Does the affected version range include what we run?
- Do we call the affected or deprecated API, at a citable `file:line`? If not, drop it.
- Is it already mitigated, pinned, or flagged?
- Is the CVE reachable for our usage, or only theoretical?

Dispatch a claim-checker per high-impact or security-class candidate, in parallel, to
confirm it adversarially against the source and against our code, and to tier the verdict.
CONFIRMED means an affected version with reachable usage, verified against our tree or a
primary advisory. The other tiers are PROBABLE and SPECULATIVE (`§7`). Discard the ecosystem
noise that does not touch us.

## Phase 4: register and hand off  *(checkpoint)*

Write the survivors to `ECOSYSTEM_WATCH.md` on the finding schema (`§6`), with an
`RSCH-NNN`, all fields, the sources, meaning the lockfile entry, the installed document, or
the external source with its manifest line, a `Verified-at: <sha>` stamp, and the grounding,
meaning the `file:line` we run. Rank by value multiplied by reach, divided by effort, and
weighted by tier and grounding (`§8`), with security first.

Hand off per `§11`. CVEs and upgrades go to `code-ops-suite:dependency-upgrade`. Egress,
telemetry, provenance, and integrity concerns go to
`privacy-opsec-suite:supply-chain-trust`. Adoptable capabilities go to
`code-ops-suite:feature-discovery` or `code-ops-suite:feature-implementation`. A forced
architectural choice, such as migrating off an end-of-life runtime, goes to
`code-ops-suite:adr`.

Before publishing, run
`node <plugin-root>/scripts/revalidate-register.mjs ECOSYSTEM_WATCH.md --root <repo>`
and
`node <plugin-root>/scripts/research-manifest.mjs validate ECOSYSTEM_WATCH.md`, which
fails closed on an un-manifested external claim (`§12`).

> **CHECKPOINT:** present the ranked register, reachable CVEs first, and the egress manifest.
> The developer decides on the hand-off, the schedule, or accepting and deferring. The
> researcher never performs the upgrades.

## The recurring schedule

A scheduled run re-grounds through Phase 1, gathers only the changes since the prior
`Verified-at` SHA within the standing opt-in and budget, and stamps a dropped entry
`OBSOLETE-AT <sha>` (`§12`). It still honors `§A`: the egress scope is pre-agreed and every
request is manifested. A run that would exceed the scope stops at a checkpoint rather than
widening egress unattended.

## Done when

The baseline is the installed and locked versions plus the confirmed in-use dependencies.
Every gathered change is triaged against our tree, and each one is registered or dropped
with a reason. No claim is un-cited and no external claim is un-manifested, with
`research-manifest.mjs validate` passing. Each entry is tiered, stamped `Verified-at: <sha>`,
and mapped to an implementer (`§11`). The register is re-validated through
`revalidate-register.mjs`, ranked security first, and deduplicated against the prior run.
The egress manifest is surfaced and within budget, both checkpoints are done, and no code
changed. Present `EXECUTIVE_SUMMARY.md` first, with the highest-severity reachable change at
the top.
