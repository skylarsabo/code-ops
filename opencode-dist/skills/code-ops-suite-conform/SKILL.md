---
name: code-ops-suite-conform
description: "Use when you want to know whether a repo is on the code-ops standard at all, how far out of conformance it is, and then have it brought back — the standards contract, the docs vault, the atlas, and doc drift, assessed in one pass and repaired under checkpoint."
---

# CONFORM — Assess and Repair Every Standardization Surface

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-conform`, or by the model through the `skill` tool as `code-ops-suite-conform`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — the operating model (`§1`), the interaction protocol (`§3`), the safety rails (`§4`), the evidence tiers (`§7`), the single-source-of-truth conventions (`§12`) that decide where this run's artifacts land, and the doc standard (`§13`).
**Mode:** ASSESS then DOCUMENT · **Consumes:** the target repo, plus whatever standardization artifacts it already carries · **Produces:** `CONFORMANCE_REPORT.md`, and the repairs the developer approves.

One question drives this skill: is this repo on the code-ops standard at all, and how far out is it? Nothing else answers it. Each surface has its own skill and its own checker, so a repo can pass one and fail three, and no one finds out until a run needs the missing artifact.

## Doctrine

- **This skill composes; it never reimplements.** Every repair is delegated to the skill that owns the surface. A repair written here would be a second implementation that drifts from the first.
- **Checkers decide conformance, not readings.** A surface is conformant when its checker exits 0. A prose judgment that a vault "looks fine" is not a result.
- **Assess-only is a legitimate terminal mode.** Stopping after Phase A with the report in hand is a complete run. Answering how far out of conformance a repo sits has value even when nobody repairs it today.
- **The report re-runs every mechanical check at the end**, so the closing state is measured rather than inferred from what the repairs claimed.

## Phase A — Assess (read-only)  *(checkpoint)*

Take no write action in this phase. Walk the surfaces in the order of the table below, which is their dependency order: the contract routes agents to the vault, the vault holds run artifacts, and doc alignment reconciles what the first three surfaces reference.

| # | Surface | Mechanical check | Repair route |
| --- | --- | --- | --- |
| 1 | Repo standards contract | The contract pair exists, matches one accepted parity mode (byte-identical, or a pointer file naming the contract as required reading), and carries the routing section | `/code-ops-suite-adopt-standards` |
| 2 | Docs vault | `<repo>-docs/` exists and `node <plugin-root>/scripts/check-vault-standard.mjs <vault dir>` exits 0 | `/code-ops-suite-vault` in the mode Phase B detects |
| 3 | Atlas | `docs/atlas/` exists (fallback `atlas/`), its manifest parses, and `node <plugin-root>/scripts/atlas-check.mjs check --atlas <atlas dir>` reports each section FRESH or STALE | `/code-ops-suite-atlas` |
| 4 | Doc alignment | Only when surfaces 1-3 surfaced drift signals: a contract, vault note, or repo doc referencing something the others contradict or no longer carry | `/code-ops-suite-doc-alignment` |
| 5 | Global contract *(optional, ask first)* | The user's global `~/.claude/AGENTS.md` carries a marketplace stamp current with this checkout | `/code-ops-suite-adopt-global-standards` |

Record each surface as CONFORMANT, DRIFTED, or ABSENT, with the checker output that decided it. A surface whose checker could not run is UNKNOWN, never CONFORMANT — a check that did not execute proves nothing (`§7`).

Write those verdicts as the per-surface table row of the `CONFORMANCE_REPORT.md` grammar in `docs/techniques/artifact-grammars.md` — surface, verdict, checker command, evidence pointer. `calibration-metrics.mjs` reads that shape back, so a report written in prose instead makes this run's drift invisible to the trend rather than merely awkward to read.

Surface 4 is off unless the assessment produced a drift signal. Doc alignment is expensive, and running it on a repo with no drift spends a full pass to learn what the first three checks already reported.

Surface 5 is off by default and is never assessed without asking. The global file is user-scope, so it governs every other repo on the machine, and a repo-scoped run has no mandate over it.

Write `CONFORMANCE_REPORT.md` to the vault's `80 Runs/YYYY-MM-DD slug/` when the repo carries a vault, and to the repo's dated-docs convention when it does not (`§12`). A repo that fails surface 2 has no vault to write into, so the report lands under the dated-docs convention and says so.

> **CHECKPOINT:** present the per-surface verdicts worst-first, the repair route each one calls for, and the cost of each. Then ask whether to stop here or run Phase B, and which surfaces Phase B covers.

## Phase B — Repair (one surface at a time)

Run only the approved surfaces, in table order, and delegate each to its own skill. Hand the delegated skill the assessment it needs rather than making it re-derive the state: the parity mode and vault path for surface 1, the detected mode for surface 2, the STALE section list for surface 3, the drift signals for surface 4.

**Checkpoint between surfaces.** Repairing the contract changes what the vault check reads, and repairing the vault changes what doc alignment reconciles, so each surface starts from the state the previous one left. Report what the last surface changed, then confirm the next.

Escalate rather than improvise. When a delegated skill stops at its own checkpoint with a question, that question comes to the developer unchanged; this skill never answers it on their behalf.

## Phase C — Prove it

Re-run every mechanical check in the table, including the ones that already passed in Phase A, and record the fresh output in `CONFORMANCE_REPORT.md` beside the opening verdict. A repair that reports success but leaves its checker failing is a failed repair, and only the re-run distinguishes the two. Anything still DRIFTED or ABSENT is listed with the reason it was deferred.

## Done when

Every surface carries a verdict backed by named checker output, never a reading; the report names its own location and why that location was chosen; no surface was repaired outside the developer's approval, and no surface was assessed at user scope without asking; each repair was delegated to the skill that owns it; every mechanical check was re-run after the repairs and its closing output recorded; and anything left unrepaired is listed with its reason.
