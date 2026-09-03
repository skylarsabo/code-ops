---
name: adopt-standards
description: "Use when a repo's CLAUDE.md standards contract needs to be created, brought up to the house style, or re-verified against reality."
---

# Adopt standards: bootstrap or maintain the repo's standards contract

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:adopt-standards`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory
for it if needed. It defines the operating model, interaction protocol, safety rails, schemas,
and quality lenses this skill references by section. For this DOCUMENT-mode skill the binding
sections are §2 (tools and in-house docs lookup), §3 (interaction), §4 (safety rails), §12
(SSOT and registers), and §13 (doc standard). Read those five. The fan-out and fix machinery
(§1, §5 to §8, §11) does not apply here.
**Mode:** DOCUMENT · **Produces:** `AGENTS.md`, written or updated in place, plus a drift report
at a checkpoint when the run is in MAINTAIN mode.

Keep a repo's standards contract (`AGENTS.md`) **mechanically kept, not aspirational.** Every
command it states runs. Every gate it claims exists really gates. Every citation still points
at real code. **Code and CI are ground truth.** The contract serves the next operator, human or
agent, who reads it cold and trusts it.

## Phase 0: the mode  *(checkpoint)*

Check for an existing `AGENTS.md`. Pick **BOOTSTRAP** when the file is absent, or present but
failing a quick audit: commands that do not run, no real gate chain, citations that do not
resolve. Pick **MAINTAIN** when the file is present and broadly sound. Confirm the mode with
the developer before proceeding, and state which mode and why.

## Phase 1: BOOTSTRAP, for no contract or one that failed the audit

Dispatch an `explorer` operative to audit the repo first, verifying everything rather than
inferring it from filenames:
- **Real build, test, lint, and gate commands.** Run them read-only where safe, or cite the CI workflow `file:line` that defines them. Never invent a command that "should" exist.
- **Architecture worth 3-5 lines.** Capture the shape a senior engineer needs before touching the repo, not a restated file tree.
- **Non-obvious gotchas.** Capture the things that bite a newcomer: a lint trap, a derived-artifact directory, an ordering requirement. Verify each one rather than guessing.
- **Doc-lifecycle rules.** Capture what is generated against what is hand-authored, what regenerates what, and any local-only or gitignored doc locations.

Then write `AGENTS.md` in the house style of Phase 3.

## Phase 2: MAINTAIN, for an existing contract

Verify every claim against reality:
- Every command still exists and runs, or still resolves to the CI step it claims to mirror.
- The gate chain still mirrors CI step for step. No step was added to CI and left out here, and no step here was dropped from CI.
- Every enforcement claim is truthful. A claimed gate actually gates and names its mechanism, or it is honestly marked aspirational.
- Every `line N` citation is still accurate. **Sweep the citations mechanically:** grep the cited line and diff its content against what the sentence claims. Do not eyeball this by skimming, because stale line citations are exactly what a skim misses.
- Every cited path still exists.

Fix the drift you find. Never silently accept a claim that no longer holds. Report every drift
item found, naming what was stale and what changed. The report is a deliverable, not incidental
output.

## Phase 3: the house style, the deliverable's required shape

Write or update `AGENTS.md` in this exact section order:
1. **`## Never (no gate will save you)`** comes first. It carries only real, repo-specific rules that have no mechanical backstop. Never invent one to fill the section. When the repo has no such rules, say so or omit the section.
2. **`## Before declaring any change done`** carries the exact verified command chain, mirroring CI step for step. Per convention, note explicitly when a documented convention has **no enforcing gate**, because an unmarked convention reads as enforced when it is not.
3. **Post-edit chores** (derived-artifact regeneration, version bumps, parity updates) follow, when the repo has them.
4. **`## Invariants the gates will catch`** names what lint and CI mechanically enforce, so the reader knows what they cannot get wrong without a tool catching it.
5. **A local-only or gitignored docs note** follows, when the repo has scratch or non-tracked doc locations that doc-alignment and staleness sweeps should skip.
6. **A documentation section** follows, when the repo carries a `<repo>-docs/` Obsidian vault or adopts one in this run. Route the reader to that vault's `Standard.md` routing table for where new design notes, decisions, and run artifacts go, rather than restating the layout here. The vault standard is `code-ops-docs/40 Engineering/Techniques/vault-standard.md`, and `code-ops-suite:vault` scaffolds, migrates, and checks one.

**Cross-cutting rules, applied throughout:**
- **Verify every command written.** Run it, or cite the CI or script `file:line` that defines it. Never invent one. When the repo has no build, test, or lint infrastructure for a category, state that honestly rather than filling the gap.
- **Keep enforcement claims truthful.** A gate-enforced claim names its gate. Anything else is plainly marked aspirational.
- **Do not duplicate the user's global `~/.claude/AGENTS.md` doctrine.** Model roles, truthful reporting, token economy, context hygiene, and other cross-repo doctrine live there, and are not restated per repo.
- **Keep `AGENTS.md` and `AGENTS.md` in one of two accepted parity modes:** a byte-identical pair, or a pointer pair where one file is the substantive contract and the other is a short file naming it as required reading. Pick one mode and keep it. A pair that has silently drifted into two different contracts is the failure both modes exist to prevent, because each host reads only one of the two names.
- **Make relative dates absolute.** Write "verify by 2026-08-01", never "next month".
- **Keep the prose terse and imperative, the commands copy-paste-ready, and the facts project-specific.** No filler, and no generic engineering advice a competent agent already knows.

## Done when

- Every command in the produced or updated `AGENTS.md` is verified against reality, either run or CI-cited.
- The gate chain matches CI.
- Every enforcement claim is truthful, with its gate named or an aspirational marking.
- No global doctrine is duplicated.
- Every `line N` citation was checked and is correct.
- Drift found in MAINTAIN mode is listed in the report, never silently fixed without disclosure.
