---
name: code-ops-suite-adopt-global-standards
description: "Use when the user's global ~/.claude/AGENTS.md needs to be created, brought up to the suite's current doctrine, or re-verified after the marketplace's standards moved."
---

# ADOPT GLOBAL STANDARDS — Keep the Cross-Repo Contract Current

**opencode path rule:** Resolve `<plugin-root>` as `code-ops/code-ops-suite/` inside your opencode config directory (the directory holding this plugin's `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoked as `/code-ops-suite-adopt-global-standards`, or by the model through the `skill` tool as `code-ops-suite-adopt-global-standards`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section. For this DOCUMENT-mode skill the binding sections are §2 (tools/in-house docs lookup), §3 (interaction), §4 (safety rails), §12 (SSOT/registers), §13 (doc standard), and §14 (writing standard) — read those six; the fan-out/fix machinery (§1, §5–§8, §11) does not apply here.
**Mode:** DOCUMENT · **Produces:** the user's global `~/.claude/AGENTS.md` (written or updated in place), plus a drift report at the pre-write checkpoint.

The repo-level counterpart is `adopt-standards`, which keeps one repo's `AGENTS.md` truthful. **This skill keeps the other half of that split honest: the global file carries cross-repo doctrine only, and that doctrine drifts every time the marketplace's SSOT pages move.** The marketplace is ground truth; the global file is a cache of it, and a stale cache silently mis-routes every session in every repo.

## Phase 0 — Locate both sides, detect mode  *(checkpoint)*
Resolve the global contract at `~/.claude/AGENTS.md` and the marketplace checkout it caches (the code-ops repo; take its path from the global file's own SSOT pointer, or ask). **BOOTSTRAP** when no global file exists or it carries no suite doctrine. **MAINTAIN** otherwise. State the mode, both resolved paths, and the marketplace HEAD you are verifying against, before going on.

## Phase 1 — Build the current-doctrine baseline
Read the SSOT pages themselves; never restate doctrine from memory or from the global file being audited. The load-bearing sources:
- `code-ops-docs/40 Engineering/Handbook/11-standard-operating-mode.md` — the task-type routing table, the tier and effort rule, the declared exception. This page is the SSOT for all three.
- `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md` and the `AGENT_MODEL_FLOORS` map in `scripts/lint-plugins.mjs` — the lint-enforced floors no tier rule may contradict.
- `code-ops-docs/40 Engineering/Techniques/writing-standard.md` and each plugin's `CONVENTIONS.md` §7/§9 — the artifact schemas, evidence bar, and tier vocabulary the global reporting standard names.
- The traceless-publishing mechanisms that back the version-control rules — name the script or hook that actually checks, not the intention.
Record each baseline claim with the `file:line` it came from; an unanchored baseline claim cannot be diffed in the next run.

## Phase 2 — Diff the global file against the baseline
Classify every divergence into exactly one bucket, and report all five:
- **CONTRADICTS** — the global file states a rule the SSOT now states differently. Highest severity: it is worse than silence, because sessions follow it. An inverted tier or routing rule lives here.
- **STALE** — accurate when written, overtaken since. Check the `Verified-at` stamp against the marketplace log for the SSOT paths; a missing stamp means every claim needs manual verification this run.
- **MISSING** — doctrine the SSOT carries that the global file never picked up.
- **REPO-LOCAL** — repo-specific facts that leaked upward into the global file. These do not belong there; hand them to `adopt-standards` for the repo that owns them.
- **LOCAL-DOCTRINE** — cross-repo rules the global file already carries that no SSOT page states. This is not drift and it is never pruned: the file is the only place the rule lives, and deleting it costs the user working doctrine to gain nothing. Keep each one, and list it as a candidate to promote into the marketplace so every repo inherits it instead of one machine holding it alone.
Verify each cited path and command still resolves. Sweep `line N` citations mechanically by diffing the cited line's content against what the sentence claims — do not eyeball them.

## Phase 3 — Checkpoint before writing  *(checkpoint)*
The global file governs every repo and every session, so it is never edited without approval. Present the classified drift and the exact proposed edit, then wait. Name every removal explicitly with the bucket that justifies it — a section the developer never sees named is a section they never agreed to lose. When the edit removes nothing, say that too. Per §4, take no action outside `~/.claude/AGENTS.md`: settings, hooks, permissions, and keybindings are out of scope even when the drift seems to call for them — say so and stop.

## Phase 4 — Write in the global house style
**The edit is additive by default.** Every existing section survives unless Phase 2 classified it CONTRADICTS or REPO-LOCAL. The file carries doctrine that holds across every repo, and it carries all of it — the four sections below are the floor, not the ceiling:
1. **Default operating mode** — the routing table copied from the SSOT verbatim, with the SSOT path named so the next reader can re-verify.
2. **Tier and effort rule** — reproduced faithfully, including which work drops a tier and which floor is lint-enforced.
3. **Cross-repo hard rules** — version-control hygiene, artifact-handling rules, and any router-neutralizing overrides, each naming the mechanism that enforces it or marked aspirational.
4. **Reporting standard** — the evidence bar and tier vocabulary, pointing at the CONVENTIONS sections rather than restating their schemas.

Everything the file already had that survived Phase 2 stays, in its own words. Rewrite an existing section only to fix what Phase 2 flagged, and say what changed.

**Cross-cutting rules (apply throughout):**
- **Nothing repo-specific.** A build command, a gate chain, a directory layout, or a project gotcha belongs in that repo's `AGENTS.md`. This is the mirror of the no-duplication rule `adopt-standards` applies from the repo side; between the two, each fact lives in exactly one place.
- **Promote, do not absorb.** LOCAL-DOCTRINE worth sharing is proposed to the marketplace against the SSOT page that should own it, so the doctrine reaches every repo through the suite. The global file keeps the rule either way; promotion is a hand-off, never a precondition for keeping it.
- **Every rule names its enforcement** — the script, hook, or CI gate that checks it, or an honest aspirational marking.
- **Relative dates become absolute.**
- **Terse imperative prose** at §14's caps, with no generic engineering advice a competent agent already knows.
- **Stamp the file** with the marketplace commit verified against, so the next run computes drift from the log instead of re-reading everything.

## Done when
The mode, both resolved paths, and the verified-against marketplace commit were stated; every baseline claim was read from the SSOT and anchored to `file:line`; every divergence is classified CONTRADICTS / STALE / MISSING / REPO-LOCAL / LOCAL-DOCTRINE and reported, never silently fixed; every removal was named with its bucket at the checkpoint and the developer approved the edit before any write; no section survived Phase 2 only to be dropped at the write; each LOCAL-DOCTRINE rule was kept and listed as a promotion candidate; the written file contains no repo-specific facts and no unenforced rule left unmarked; every citation and command in it resolves; and the file carries the marketplace commit stamp it was verified against.
