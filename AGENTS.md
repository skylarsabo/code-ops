# Working on this repo

This is a plugin marketplace whose product is quality discipline. The rules below are
ordered by how little mechanical backstop they have — the top ones are the easiest to
break silently.

## Never (no gate will save you)

- **Never weaken a gate.** No fail-closed check turned fail-open, no removed validation,
  no narrowed coverage — including the checks in `scripts/lint-plugins.mjs`,
  `evals/score.mjs`, and the workflows themselves. Never make a lint or eval pass by
  editing the check instead of the code.
- **Traceless publishing on ALL paths.** No AI/tool attribution trailers, emoji, or
  assistant-voice prose in commit messages or PR bodies — including direct commits that
  bypass the ship skill. Self-gate: `node scripts/scan-ai-tells.mjs <files...>` (or
  `--git <range>`). The code-ops-suite `PreToolUse` hook (`enforce-traceless`) also
  blocks a flagged `git commit` / `gh pr create|merge` at the tool layer; CI stays the
  fail-closed backstop.
- **Judgment happens locally before the PR exists.** Commit the final diff, run
  `code-ops-suite:local-review-gate` against the exact base and HEAD, and require both
  SHA-bound receipts before push. Push the branch without a PR, publish the verified
  `local-deep-review` and `local-opsec-gate` commit statuses, then open the PR. Hosted
  Actions run deterministic checks only; any new commit or base movement voids the review.
- **`evals/*/ANSWER_KEY.*` never enters the context handed to a skill under eval.**
- **The real-scale calibration channel is one-way** (see `evals/README.md`): only the
  sanitized calibration note returns from a private-repo calibration run; never quote
  that repo's internals here.

## Model roles

The global Model-roles doctrine applies: the lead plans, delegates, and reviews;
operatives implement and escalate rather than guess. Routing is quality-first, not
price-first: every judgment-bearing dispatch runs at the strong tier (Opus-class)
whatever tier the lead is on, because a shallow or failed operative report costs a
redispatch round-trip plus the lead's attention, and that exceeds the strong tier's
price premium. Only mechanical, low-ambiguity work — mech-class transcription,
breadth scans — drops a tier, and never below an agent's lint-enforced floor. Effort
is unchanged: it routes by ambiguity, never low on review, never xhigh on breadth.
Repo-specific deltas: the lead reviews diff + gates itself before reporting done — operative
self-reports are not acceptance — and rigor/verification judgments (verdicts,
CONFIRMED labels, acceptance) are issued by the highest-tier model present, never
down-tiered. `mech` and `mech-review` are user-level agents defined outside this
repo.

The lead's reports are compact syntheses — outcome first, evidence pointers, no
restatement of operative transcripts. Run artifacts (`EXECUTIVE_SUMMARY.md` etc.)
cap at roughly one page, with detail living in the registers.

These live-session behavioral rules — the lead reviewing diffs and gates itself,
operative self-reports not being acceptance — are intentionally outside the mechanical
gate layer: the routing card, dispatch ledger, and narration scan are advisories that
surface drift, not gates that prevent it.

## One contract, two filenames

`CLAUDE.md` and `AGENTS.md` are the same document. Hosts read different names: Claude Code
reads `CLAUDE.md`, Codex reads `AGENTS.md`, opencode reads `AGENTS.md` and falls back to
`CLAUDE.md` only when `AGENTS.md` is absent, and Grok Build reads both. Because this repo
ships both files, opencode never reads `CLAUDE.md` here — so anything living in only one
copy is invisible to whichever hosts read the other.

Edit `CLAUDE.md`, then copy it over `AGENTS.md` in the same commit. Lint pins them
byte-identically and fails closed on a divergence.

## Writing standard

Every artifact this repo produces follows the house writing standard in
`code-ops-docs/40 Engineering/Techniques/writing-standard.md`, which is the single source of truth for it: the
sentence and paragraph caps, one term per concept, active voice, and the code carve-outs
for identifiers and quoted output. It binds calibration notes, findings registers, commit
messages, PR bodies, and skill prose alike. It stops at code blocks, quoted tool output,
and generated tables.

The core clause is pinned byte-identically across all four `CONVENTIONS.md` files via
`SHARED_PASSAGES` in `scripts/lint-plugins.mjs`, mirrored in `PINNED_TEXTS` in
`evals/lint-plugins/run.mjs`. Edit every copy in one commit, or lint fails closed on the
drifted file and the eval fails at its baseline case rather than where you would look.

## Before declaring any change done

Run `node scripts/lint-plugins.mjs && node scripts/check-no-deps.mjs && node scripts/build-codex-marketplace.mjs --check && node scripts/build-opencode-dist.mjs --check` — the first structural steps of the CI gate in `.github/workflows/validate.yml`; that workflow also runs the regression evals under `evals/`, so mirror the step covering what you touched. If you touched a fixture under `evals/*/repo`, run `node evals/score.mjs <its ANSWER_KEY.json>
--check`; `register-staleness` has no answer key — run `node evals/register-staleness/run.mjs`.

The gate chain is run by a verifier/mech operative that returns only the verdict plus
the failing excerpt; the lead reads the result and re-runs a gate itself only to settle
a disputed outcome.

## After editing anything under `plugins/<name>/`

Bump `version` in `plugins/<name>/.claude-plugin/plugin.json`, update the matching
`.claude-plugin/marketplace.json` entry (lint enforces parity), and add a
`plugins/<name>/CHANGELOG.md` entry. Then regenerate the host distributions with
`node scripts/build-codex-marketplace.mjs` and `node scripts/build-opencode-dist.mjs`; their
files, `.agents/plugins/marketplace.json`, and `opencode-dist/` are derived artifacts, never
hand-edited. Scripts under `plugins/*/scripts/` are vendored
byte-identical copies of `scripts/` — edit the canonical root file and re-copy; lint
enforces parity.

Install `node scripts/install-git-hooks.mjs` once per checkout. Its tracked pre-commit hook
regenerates and stages only the derived Codex and opencode paths, while refusing unstaged or
untracked renderer inputs; CI still rejects drift when hooks are absent or bypassed.

Adding or removing a skill also requires updating the plugin README's skill list and
`(N skills)` count, the matching count in root `README.md`, and handbook entries in both
`code-ops-docs/40 Engineering/Handbook/commands/<plugin>.md` and the router table in
`code-ops-docs/40 Engineering/Handbook/commands/README.md` — lint enforces all four.

## Invariants the lint gates will catch (fix, don't fight)

Zero third-party dependencies (`node:` builtins only — `check-no-deps.mjs`). Skills
reference their plugin's `CONVENTIONS.md` by section and never copy 40+ words from it.
Every skill has a `## Done when` and a handbook entry. `§<id>` citations and "the X
subagent" prose must resolve. No `<`/`>` in SKILL.md frontmatter values. Some doctrine
sentences are duplicated byte-identically across `CONVENTIONS.md` files on purpose
(`SHARED_PASSAGES` in `lint-plugins.mjs`) — edit every listed copy in the same commit;
never dedupe them or delete the pin. Agent frontmatter `model:` tiers have lint-enforced
floors (`AGENT_MODEL_FLOORS`, kept in sync with `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md`)
— don't downgrade them to save tokens.

## The documentation hub

`code-ops-docs/` is the only authored documentation hub and the Obsidian vault for this
repository. Follow `code-ops-docs/Standard.md`; the shared layout SSOT is
`code-ops-docs/40 Engineering/Techniques/vault-standard.md`. The sole topic and source
registry is `code-ops-docs/98 System/DOCS_MANIFEST.json`. Run
`node scripts/docs-manifest.mjs check` before trusting it and use
`code-ops-suite:repo-docs` for delta-based extraction. Code, schemas, workflows, plugin
manifests, and skills remain executable evidence, not competing documentation trees.
Manifest-v2 record collections may preserve immutable evidence at permanent historical
paths; their inventory, citations, curation, and semantic index remain hub-governed. Run
`node scripts/records.mjs check --collection <id>` for each registered collection.
`code-ops-docs/80 Runs/` is gitignored run scratch (ADR 0001 treatment).
