---
description: "Use when a commit, PR, or branch must carry no AI/tooling trace: strip attribution metadata, match your prose voice, and blend code idioms into the surrounding codebase before publishing."
disable-model-invocation: true
---

# AUTHORSHIP HYGIENE — Make the Work Read as Yours, Not Your Tools'

**Invoked as `/privacy-opsec-suite:authorship-hygiene`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — the anonymity & OpSec model (`§A`, including the tooling-trace non-negotiable), interaction protocol, safety rails, and lenses this skill follows.
**Mode:** REVIEW (audit) + IMPLEMENT (scrub). **Scope:** a commit range, a PR body, and/or the working diff you name. **Stance:** tooling/AI trace in VCS is a metadata leak (`§A`) — published work reflects the author, not the tool. Fail closed: nothing ships until the trace is gone.

Three surfaces a trace hides on; clean all in scope.

## L1 — Metadata (mechanical, near-zero risk)
Strip attribution + tool markers: `Co-Authored-By:` tool trailers, "Generated with/by <tool>", AI markers in branch names, bot author/committer identities; set author/committer to the human's git identity. The mechanical floor is `node ${CLAUDE_PLUGIN_ROOT}/scripts/scan-ai-tells.mjs <commit-range-or-pr-body-file>` — it flags trailers, tool markers, emoji, em-dash density, assistant-prose tells, and the `## Test plan` boilerplate.

## L2 — Prose voice (commit messages + PR descriptions)
Learn the author's style from history (`git log`, recent PRs): tense, length, capitalization, conventional-commits or not, emoji use, bullets-vs-prose, whether they use `## Summary`/`## Test plan` sections. Rewrite the messages/descriptions to match, and kill the tells the scanner can't judge — over-explanation, hedging, "Notably/Importantly/Here's what", em-dash overuse, emoji, and template boilerplate the author doesn't use. Keep the facts; change the voice.

## L3 — Code idiom & style blend-in (behavior-preserving)
Run the repo's own **formatter + linter first** (mechanical style is their job). Then the judgment they can't do: for each changed hunk, compare its idioms to the surrounding file/codebase and rectify **semantically-equivalent-but-divergent** forms to match — bracket-vs-dot access, `d['k']` vs `d.get('k')` only when null-handling is identical, quote/f-string style, type-annotation density, over-defensive scaffolding when neighbors are terser.
- **Never swap genuinely-different behavior** (index vs string-key access are different operations — leave them).
- Behavior-preserving only: the suite stays green; anything that could change behavior is **surfaced, not applied**.
- **Delegate, don't duplicate:** repo-wide one-style → `code-ops-suite:normalize`; divergent implementations of one concept → `rigor:consistency-closure`. L3 only makes *this diff* indistinguishable from its neighbors.

## Fail-closed gate
Before anything is published, `scan-ai-tells.mjs` must exit 0 over the commit range + PR bodies. If it can't be cleaned, stop and surface it — never publish a known trace.

## Done when
Every in-scope surface is clean: `scan-ai-tells. Any run artifacts being published also pass `node ${CLAUDE_PLUGIN_ROOT}/scripts/scan-redaction.mjs` (no fail-closed secret hits).mjs` exits 0; commit/PR prose matches the author's voice with no assistant tells; changed-code idioms match their neighbors (behavior-preserving, suite green) with anything risky surfaced; author/committer identity is the human's. Report what was scrubbed per surface and anything left for a human decision.
