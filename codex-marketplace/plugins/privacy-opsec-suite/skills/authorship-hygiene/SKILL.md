---
name: authorship-hygiene
description: "Use when a commit, PR, or branch must carry no AI or tooling trace before publishing."
---

# Authorship hygiene: work that reads as yours, not your tools'

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:authorship-hygiene`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. It defines the anonymity and OpSec model (`§A`),
including the tooling-trace non-negotiable, plus the interaction protocol, the safety rails,
and the lenses this skill follows.

- **Mode:** REVIEW to audit, then IMPLEMENT to scrub.
- **Scope:** a commit range, a pull request body, and the working diff you name.
- **Stance:** tooling and AI trace in version control is a metadata leak (`§A`). Published
  work reflects its author, not the tool. Fail closed: nothing ships until the trace is
  gone.

A trace hides on three surfaces. Clean every one of them that is in scope.

## L1. Metadata, mechanical and near-zero risk

Strip the attribution and tool markers: `Co-Authored-By:` tool trailers, generated-by lines
naming a tool, AI markers in a branch name, and bot author or committer identities. Set the
author and the committer to the human's git identity.

The mechanical floor is
`node <plugin-root>/scripts/co.mjs scan ai-tells <commit-range-or-pr-body-file>`. It
flags trailers, tool markers, emoji, em-dash density, assistant-prose tells, and the
`## Test plan` boilerplate.

When an operator intentionally scans one edited tracked artifact,
`--emdash-baseline-rev <pre-edit-revision>` measures dash-count growth against that target's
blob at an ancestor of `HEAD`. Arbitrary baseline files are not accepted. The option
requires exactly one file target and cannot be combined with `--git`. It never suppresses
the other checks.

## L2. Prose voice, in commit messages and pull request descriptions

Learn the author's style from history, meaning `git log` and recent pull requests: tense,
length, capitalization, whether they use conventional commits, whether they use emoji,
bullets against prose, and whether they use `## Summary` and `## Test plan` sections.
Rewrite the messages and descriptions to match.

Then kill the tells the scanner cannot judge: over-explanation, hedging, opener words such
as "Notably", "Importantly", and "Here's what", em-dash overuse, emoji, and template
boilerplate the author does not use. Keep the facts and change the voice.

## L3. Code idiom and blend-in, behavior-preserving

Run the repository's own formatter and linter first, because mechanical style is their job.
Then do the judgment they cannot. For each changed hunk, compare its idioms to the
surrounding file and codebase, and rectify the forms that are semantically equivalent but
divergent: bracket access against dot access, `d['k']` against `d.get('k')` only when the
null handling is identical, quote and f-string style, type-annotation density, and
over-defensive scaffolding where the neighbors are terser.

- **Never swap genuinely different behavior.** Index access and string-key access are
  different operations. Leave them alone.
- **Stay behavior-preserving.** The suite stays green. Anything that could change behavior
  is surfaced rather than applied.
- **Delegate rather than duplicate.** Send a repository-wide single style to
  `code-ops-suite:normalize`, and divergent implementations of one concept to
  `rigor:consistency-closure`. L3 only makes this diff indistinguishable from its neighbors.

## The fail-closed gate

Before anything is published, `scan-ai-tells.mjs` must exit 0 over the commit range and the
pull request bodies. If it cannot be cleaned, stop and surface it. Never publish a known
trace.

## Done when

Every in-scope surface is clean. `scan-ai-tells.mjs` exits 0. The commit and pull request
prose matches the author's voice with no assistant tells. The changed-code idioms match
their neighbors, behavior-preservingly and with the suite green, and anything risky is
surfaced. The author and committer identity is the human's. Any run artifact being published
also passes `node <plugin-root>/scripts/co.mjs scan redaction` with no fail-closed
secret hits. Report what was scrubbed per surface, and anything left for a human decision.
