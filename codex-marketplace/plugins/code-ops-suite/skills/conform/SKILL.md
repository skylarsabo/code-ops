---
name: conform
description: "Use when you want to know whether a repo is on the code-ops standard at all, how far out of conformance it is, and then have it brought back. It assesses the standards contract, the docs vault, the atlas, and doc drift in one pass, then repairs under checkpoint."
---

# Conform: assess and repair every standardization surface

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:conform`.** First read the `<plugin-root>/CONVENTIONS.md`
bundled with this plugin: the operating model (`§1`), the interaction protocol (`§3`), the safety
rails (`§4`), the evidence tiers (`§7`), the single-source-of-truth conventions (`§12`) that
decide where this run's artifacts land, and the doc standard (`§13`).
**Mode:** ASSESS, then DOCUMENT · **Consumes:** the target repo plus whatever standardization
artifacts it already carries, or a `FLEET.json` naming several repos, which turns on fleet mode
below · **Produces:** `CONFORMANCE_REPORT.md`, plus the repairs the developer approves.

One question drives this skill: is this repo on the code-ops standard at all, and how far out is
it? Nothing else answers that question. Each surface has its own skill and its own checker, so a
repo can pass one and fail three, and no one finds out until a run needs the missing artifact.

## The doctrine

- **This skill composes, and never reimplements.** Delegate every repair to the skill that owns the surface. A repair written here would be a second implementation that drifts from the first.
- **Checkers decide conformance, not readings.** A surface is conformant when its checker exits 0. A prose judgment that a vault looks fine is not a result.
- **Assess-only is a legitimate terminal mode.** Stopping after Phase A with the report in hand is a complete run. Answering how far out of conformance a repo sits has value even when nobody repairs it today.
- **The report re-runs every mechanical check at the end,** so the closing state is measured rather than inferred from what the repairs claimed.

## Phase A: the assessment, read-only  *(checkpoint)*

Take no write action in this phase. Walk the surfaces in the order of the table below, which is
their dependency order: the contract routes agents to the vault, the vault holds run artifacts,
and doc alignment reconciles what the first three surfaces reference.

| # | Surface | Mechanical check | Repair route |
| --- | --- | --- | --- |
| 1 | Repo standards contract | The contract pair exists, matches one accepted parity mode (byte-identical, or a pointer file naming the contract as required reading), and carries the routing section | `code-ops-suite:adopt-standards` |
| 2 | Documentation hub | `<repo>-docs/` exists; vault and manifest checks exit 0; manifest-v2 collections also pass `records check` | `code-ops-suite:vault` in the mode Phase B detects |
| 3 | Atlas | `code-ops-docs/98 System/Atlas/` exists (fallback `atlas/`), its manifest parses, and `node <plugin-root>/scripts/atlas-check.mjs check --atlas <atlas dir>` reports each section FRESH or STALE | `code-ops-suite:atlas` |
| 4 | Doc alignment | Only when surfaces 1-3 surfaced drift signals: a contract, vault note, or repo doc referencing something the others contradict or no longer carry | `code-ops-suite:doc-alignment` |
| 5 | Global contract *(optional, ask first)* | The user's global `~/.claude/AGENTS.md` carries a marketplace stamp current with this checkout | `code-ops-suite:adopt-global-standards` |

Record each surface as CONFORMANT, DRIFTED, or ABSENT, with the checker output that decided it.
A surface whose checker could not run is UNKNOWN, never CONFORMANT, because a check that did not
execute proves nothing (`§7`).

Write those verdicts as the per-surface table row of the `CONFORMANCE_REPORT.md` grammar in
`code-ops-docs/40 Engineering/Techniques/artifact-grammars.md`, carrying the surface, the
verdict, the checker command, and the evidence pointer. `calibration-metrics.mjs` reads that
shape back, so a report written in prose instead makes this run's drift invisible to the trend
rather than merely awkward to read.

Surface 4 stays off unless the assessment produced a drift signal. Doc alignment is expensive,
and running it on a repo with no drift spends a full pass to learn what the first three checks
already reported.

Surface 5 is off by default and is never assessed without asking. The global file is user-scope,
so it governs every other repo on the machine, and a repo-scoped run has no mandate over it.

Write `CONFORMANCE_REPORT.md` to the vault's `80 Runs/YYYY-MM-DD slug/` when the repo carries a
vault, and to the repo's dated-docs convention when it does not (`§12`). A repo that fails
surface 2 has no vault to write into, so the report lands under the dated-docs convention and
says so.

> **CHECKPOINT:** present the per-surface verdicts worst-first, the repair route each one calls for, and the cost of each. Then ask whether to stop here or run Phase B, and which surfaces Phase B covers.

## Phase B: the repairs, one surface at a time

Run only the approved surfaces, in table order, and delegate each to its own skill. Hand the
delegated skill the assessment it needs rather than making it re-derive the state: the parity
mode and vault path for surface 1, the vault mode and manifest version and collection verdicts
for surface 2, the STALE section list for surface 3, and the drift signals for surface 4.

**Checkpoint between surfaces.** Repairing the contract changes what the vault check reads, and
repairing the vault changes what doc alignment reconciles, so each surface starts from the state
the previous one left. Report what the last surface changed, then confirm the next.

Escalate rather than improvise. When a delegated skill stops at its own checkpoint with a
question, pass that question to the developer unchanged. This skill never answers it on their
behalf.

## Phase C: the proof

Re-run every mechanical check in the table, including the ones that already passed in Phase A.
Re-write `CONFORMANCE_REPORT.md` with the closing verdicts. The file keeps one row per surface,
updated in place, with the Phase A verdict noted in that row's evidence cell. Never write a
second row per surface, which the grammar counts as unparseable. A repair that reports success
but leaves its checker failing is a failed repair, and only the re-run distinguishes the two.
List anything still DRIFTED or ABSENT with the reason it was deferred.

## Fleet mode: many repos, one standard

Fleet mode turns on when the run is handed a `FLEET.json`, or when one sits at the invocation
root. `code-ops-docs/40 Engineering/Techniques/fleet-standard.md` defines the layout, the
manifest schema, and the consent rule. Everything above still holds. A fleet run is the per-repo
run performed member by member, under one report.

**Consent decides who is in.** The manifest names a repo, and the repo consents by carrying the
phrase `fleet member: yes` on a line of its own, in a `## Fleet` section of its own standards
contract. A repo that only discusses the phrase, fenced as an example or quoted inline in a
written refusal, has not consented. The parsing rules in
`code-ops-docs/40 Engineering/Techniques/fleet-standard.md` are the specification of that
format. Where a markdown renderer displays a contract differently, the specification governs
enrollment, and the divergence is a documentation issue rather than a checker bug. Three rules
follow, and none of them bends:

- A named repo that has not consented is reported as `named, not consenting` and is never operated on. That row is the evidence for skipping it. Announce the skip and move on.
- A consenting repo the manifest does not name is invisible to this run. A consent phrase is an offer, not an enrollment.
- **This skill never edits a member's consent.** Consent is per-repo and revocable by editing the contract, so a run that could write the phrase it then reads would have a formality instead of a rule. The `## Fleet` section stays out of scope for every repair below, including a doctrine propagation that rewrites the rest of the contract.

**Phase A, fleet.** Run `node <plugin-root>/scripts/check-fleet.mjs <FLEET.json>` and
present its output as the per-member surface table. The checker already writes grammar-(d) rows,
one per member per surface, with the member's slug on the surface cell. The table therefore goes
into `CONFORMANCE_REPORT.md` as it stands, and the calibration snapshot ingests a fleet run with
no change. Do not re-run the per-repo checks by hand. The checker is what decides conformance
here, exactly as it does for one repo.

**Phase B, fleet.** Repair member by member, worst-first, with a checkpoint between members.
Delegate each member's repair the same way a single-repo repair is delegated: to the skill that
owns the surface, run inside that member, and handed the assessment rather than made to re-derive
it. Never repair two members in one step, because a member's own checker output is what proves
its repair landed.

**Doctrine propagation is the canonical use.** When a source of truth moves in this marketplace,
whether a new `Standard.md` body, a changed routing section, or a new contract clause, a fleet
run is how the change reaches the repos that agreed to receive it. Carry the new text to each
consenting member as an ordinary reviewed change in that member, then re-run the checker there.
List a member that ends the run still drifted with its reason, and never leave it quietly
conformant on paper.

**Phase C, fleet.** Re-run `check-fleet.mjs` over the whole manifest and re-write the report with
the closing rows. A non-zero exit names the members still failing. A zero exit with
`named, not consenting` rows present is a complete, successful run over a smaller fleet than the
manifest lists.

## Done when

- Every surface carries a verdict backed by named checker output, never a reading.
- The report names its own location and why that location was chosen.
- No surface was repaired outside the developer's approval, and no surface was assessed at user scope without asking.
- Each repair was delegated to the skill that owns it.
- Every mechanical check was re-run after the repairs, and its closing output recorded.
- Anything left unrepaired is listed with its reason.
- In fleet mode, additionally: every named member carries a consent row, no member was operated on without one reading CONFORMANT, no member's consent section was edited, and the closing report re-runs the fleet checker over the whole manifest.
