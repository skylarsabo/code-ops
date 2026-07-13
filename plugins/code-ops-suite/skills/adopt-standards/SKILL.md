---
description: "Use when a repo's CLAUDE.md standards contract needs to be created, brought up to the house style, or re-verified against reality."
disable-model-invocation: true
---

# ADOPT STANDARDS — Bootstrap or Maintain the Repo's Standards Contract

**Invoked as `/code-ops-suite:adopt-standards`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section. For this DOCUMENT-mode skill the binding sections are §2 (tools/in-house docs lookup), §3 (interaction), §4 (safety rails), §12 (SSOT/registers), and §13 (doc standard) — read those five; the fan-out/fix machinery (§1, §5–§8, §11) does not apply here.
**Mode:** DOCUMENT · **Produces:** `CLAUDE.md` (written or updated in place), a drift report at a checkpoint when in MAINTAIN mode.

Keep a repo's standards contract (`CLAUDE.md`) **mechanically kept, not aspirational** — every command it states runs, every gate it claims exists really gates, every citation still points at real code. **Code and CI are ground truth; the contract serves the next operator (human or agent) who reads it cold and trusts it.**

## Phase 0 — Detect mode  *(checkpoint)*
Check for an existing `CLAUDE.md`. **BOOTSTRAP** if absent, or if present but failing a quick audit (commands that don't run, no real gate chain, citations that don't resolve). **MAINTAIN** if present and broadly sound. Confirm the mode with the developer before proceeding; state which and why.

## Phase 1 — BOOTSTRAP (no CLAUDE.md, or one failing the audit)
Audit the repo first, verifying everything rather than inferring it from filenames:
- **Real build/test/lint/gate commands** — run them read-only where safe, or cite the CI workflow `file:line` that defines them; never invent a command that "should" exist.
- **Architecture worth 3–5 lines** — the shape a senior engineer needs before touching the repo, not a restated file tree.
- **Non-obvious gotchas** — the things that bite a newcomer (a lint trap, a derived-artifact directory, an ordering requirement) — verified, not guessed.
- **Doc-lifecycle rules** — what's generated vs. hand-authored, what regenerates what, and any local-only/gitignored doc locations.
Then write `CLAUDE.md` in the house style (Phase 3).

## Phase 2 — MAINTAIN (existing CLAUDE.md)
Verify every claim against reality:
- Every command still exists and runs (or still resolves to the CI step it claims to mirror).
- The gate chain still mirrors CI step-for-step — no step added to CI and missing here, no step here that CI dropped.
- Every enforcement claim is truthful — a claimed gate actually gates (name the mechanism), or it is honestly marked aspirational.
- Every `line N` citation is still accurate — **sweep them mechanically** (grep the cited line and diff its content against what the sentence claims); do not eyeball this by skimming, stale line citations are exactly what a skim misses.
- Every cited path still exists.
Fix drift found; do not silently accept a claim that no longer holds. Report every drift item found (what was stale, what changed) — the report is a deliverable, not incidental output.

## Phase 3 — House style (the deliverable's required shape)
Write/update `CLAUDE.md` in this exact section order:
1. **`## Never (no gate will save you)`** first — only real, repo-specific rules that have no mechanical backstop. Never invent one to fill the section; if the repo has no such rules, say so or omit the section.
2. **`## Before declaring any change done`** — the exact verified command chain, mirroring CI step-for-step. Note explicitly, per convention, when a documented convention has **no enforcing gate** — an unmarked convention reads as enforced when it is not.
3. **Post-edit chores** (derived-artifact regeneration, version bumps, parity updates) if the repo has them.
4. **`## Invariants the gates will catch`** — what lint/CI mechanically enforces, so the reader knows what they can't get wrong without a tool catching it.
5. **Local-only/gitignored docs note**, if the repo has scratch or non-tracked doc locations that doc-alignment/staleness sweeps should skip.

**Cross-cutting rules (apply throughout):**
- **Every command written must be verified** — run it, or cite the CI/script `file:line` that defines it. Never invent one; if the repo has no build/test/lint infra for a category, state that honestly rather than filling the gap.
- **Enforcement claims are truthful** — gate-enforced claims name the gate; anything else is plainly marked aspirational.
- **No duplication of the user's global `~/.claude/CLAUDE.md` doctrine** — model roles, truthful reporting, token economy, context hygiene, and other cross-repo doctrine live there, not re-stated per repo.
- **Relative dates become absolute** ("verify by 2026-08-01", never "next month").
- **Terse imperative prose, copy-paste-ready commands, project-specific facts only** — no filler, no generic engineering advice a competent agent already knows.

## Done when
Every command in the produced/updated `CLAUDE.md` is verified against reality (run or CI-cited); the gate chain matches CI; every enforcement claim is truthful (gate named, or marked aspirational); no global-doctrine duplication; every `line N` citation checked and correct; drift found in MAINTAIN mode is listed in the report, never silently fixed without disclosure.
