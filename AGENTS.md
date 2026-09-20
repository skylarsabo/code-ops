# Working on this repo

This is a plugin marketplace whose product is quality discipline. The rules below are
ordered by how little mechanical backstop they have. The rules at the top are the easiest
to break silently.

## Never (no gate will save you)

- **Never weaken a gate.** No fail-closed check turned fail-open, no removed validation,
  and no narrowed coverage, including the checks in `scripts/lint-plugins.mjs`,
  `evals/score.mjs`, and the workflows themselves. Never make a lint or eval pass by
  editing the check instead of the code.
- **Traceless publishing on ALL paths.** No AI or tool attribution trailers, emoji, or
  assistant-voice prose in commit messages or PR bodies, including direct commits that
  bypass the ship skill. Self-gate: `node scripts/scan-ai-tells.mjs <files...>` (or
  `--git <range>`). The code-ops-suite `enforce-traceless` hook (`PreToolUse`, or
  `tool.execute.before` on OpenCode) also blocks a flagged `git commit` or
  `gh pr create|merge` at the tool layer, scanning the command and each message, trailer,
  title, and body value it would publish. The CI step
  "Traceless publishing (PR commits, title, body)" is the fail-closed backstop.
- **Model review gates are opt-in, and rare.** The deterministic gate chain and the lead's
  own read of the final diff run on every change. `code-ops-suite:local-review-gate` (deep
  review plus the OpSec gate) runs only when the operator says so at the checkpoint or a
  brief names it, for changes that touch a high-risk surface (security, egress, data
  migrations, public contracts, gate scripts) or that the operator wants reviewed. When it
  runs, it binds the exact base and HEAD, both receipts land before push, and the verified
  `local-deep-review` and `local-opsec-gate` statuses are published. Any new commit or
  base movement voids them. Hosted Actions run deterministic checks only and are the
  required merge gate.
- **`evals/*/ANSWER_KEY.*` never enters the context handed to a skill under eval.**
- **The real-scale calibration channel is one-way** (see `evals/README.md`). Only the
  sanitized calibration note returns from a private-repo calibration run. Never quote
  that repo's internals here.

## Model roles

The user-wide contract owns general model behavior. This repository adds only these
deltas: `scripts/model-tiers.mjs` owns provider bindings and `AGENT_MODEL_FLOORS` owns
agent floors. A substantive run uses a frontier lead, delegates every independently briefable
unit, and launches at least two disjoint units in parallel when the graph permits. It then
selects each operative's role, model tier, and effort from the task. Strong is the normal
floor for judgment work; mechanical and breadth work may use their lower declared floors. A
task-based Run Contract records each selection rationale. One frontier peer is allowed only
for a bounded, explicitly justified architecture, refutation, mathematics, or synthesis
decision. The lead owns synthesis, reprioritization, final verdicts, and acceptance; it
records why any genuinely trivial or indivisible step stayed inline. Effort follows
ambiguity, never low for review and never highest for breadth.

Operative reports remain evidence, not acceptance. The lead reads the relevant diff,
checks the required gates, and issues verdicts at the highest tier present. Lead reports
state the outcome and evidence without repeating transcripts. Keep executive summaries to
roughly one page and put detail in the registers. The routing card, dispatch ledger, and
narration scan are advisories rather than enforcement gates.

## One contract, two filenames

`CLAUDE.md` and `AGENTS.md` are the same document. Hosts read different names: Claude Code
reads `CLAUDE.md`, Codex reads `AGENTS.md`, opencode reads `AGENTS.md` and falls back to
`CLAUDE.md` only when `AGENTS.md` is absent, and Grok Build reads both. Because this repo
ships both files, opencode never reads `CLAUDE.md` here, so anything living in only one
copy is invisible to whichever hosts read the other.

Skill ids here use the colon form, such as `code-ops-suite:repo-docs`. OpenCode calls the
same skills by hyphenated names, such as `code-ops-suite-repo-docs`.

Edit `CLAUDE.md`, then copy it over `AGENTS.md` in the same commit. Lint pins them
byte-identically and fails closed on a divergence.

## Writing standard

Every artifact this repo produces follows the house writing standard in
`code-ops-docs/40 Engineering/Techniques/writing-standard.md`, which is the single source
of truth for it: the sentence and paragraph caps, one term per concept, active voice, and
the code carve-outs for identifiers and quoted output. It binds calibration notes,
findings registers, commit messages, PR bodies, and skill prose alike. It stops at code
blocks, quoted tool output, and generated tables.

The core clause is pinned byte-identically across all four `CONVENTIONS.md` files by
`SHARED_PASSAGES` in `scripts/lint-plugins.mjs`, mirrored in `PINNED_TEXTS` in
`evals/lint-plugins/run.mjs`. Edit every copy in one commit, or lint fails closed on the
drifted file and the eval fails at its baseline case rather than where you would look.

## Code standard

Every code change follows the house code standard in
`code-ops-docs/40 Engineering/Techniques/code-standard.md`, which is the single source of
truth for it. Its core clause is pinned byte-identically across all four `CONVENTIONS.md`
files by `code-standard-core` in `SHARED_PASSAGES`, mirrored in `PINNED_TEXTS`. Edit every
copy in one commit.

## Session mechanisms that run under every change

Eight plugin hook commands across six events provide traceless publishing, routing with
compaction restoration and pending-handoff pickup, output digests, index refresh, ladder
guidance, session receipts, a context-size handoff nudge, and a dispatch guard with explicit
host-agent budget bindings and a legacy fallback. The last six named mechanisms are on by default and have
documented environment switches. Use
`scripts/co.mjs context skim|query` before loading large files or maps. The switch names,
contracts, and measured effects live in `INFRASTRUCTURE.md`, `CONTRACTS.md`, and
`MEASUREMENTS.md` under `code-ops-docs/`.

Host coverage differs, and `INFRASTRUCTURE.md` holds the per-host table. Claude and Codex
register all eight commands. Grok prints nothing for the routing, ladder, and handoff cards.
Instruction files carry the routing and ladder guidance there, and the handoff nudge has no Grok
substitute. The dispatch guard counts a subagent's rounds only where the hook payload carries an
`agent_id`, so its round counter is inert on a host that omits that field, and its dispatch
advisories still run. OpenCode ports publishing, routing,
compaction, digest, and index as plugin events, and has no ladder card, session receipt,
handoff nudge, dispatch guard, or pending-handoff line.

## Before declaring any change done

Run `node scripts/lint-plugins.mjs && node scripts/check-no-deps.mjs && node scripts/build-codex-marketplace.mjs --check && node scripts/build-opencode-dist.mjs --check`, the first structural steps of the CI gate in `.github/workflows/validate.yml`. That workflow also runs the regression evals under `evals/`, so mirror the step covering what you touched. If you touched a fixture under `evals/*/repo`, run `node evals/score.mjs <its ANSWER_KEY.json>
--check`. The `register-staleness` eval has no answer key, so run `node evals/register-staleness/run.mjs`.

For substantive changes, a verifier or mechanical worker runs the gate chain and returns
only the verdict plus a failing excerpt. The lead owns acceptance and repeats a gate only
to settle a disputed result.

## After editing anything under `plugins/<name>/`

Bump `version` in `plugins/<name>/.claude-plugin/plugin.json`, update the matching
`.claude-plugin/marketplace.json` entry (lint enforces parity), and add a
`plugins/<name>/CHANGELOG.md` entry. Then regenerate the host distributions with
`node scripts/build-codex-marketplace.mjs` and `node scripts/build-opencode-dist.mjs`. Their
files, `.agents/plugins/marketplace.json`, and `opencode-dist/` are derived artifacts, never
hand-edited. Scripts under `plugins/*/scripts/` are vendored
byte-identical copies of `scripts/`, so edit the canonical root file and re-copy. Lint
enforces parity.

Install `node scripts/install-git-hooks.mjs` once per checkout. Its pre-commit hook
regenerates only derived host paths and refuses dirty renderer inputs. CI still rejects
drift when the hook is absent or bypassed.

`node scripts/integrate-branch.mjs [--base <ref>] [--bump <plugin>:<major|minor|patch>]...`
runs this section's mechanical steps — the version bump, the two regenerations, the
documentation-manifest sync, and the applicable CI gates — in one pass, so a helper only has
to supply the judgment call (which bump, whether a stale atlas section still holds).

Adding or removing a skill also requires updating the plugin README's skill list and
`(N skills)` count, the matching count in root `README.md`, and handbook entries in both
`code-ops-docs/40 Engineering/Handbook/commands/<plugin>.md` and the router table in
`code-ops-docs/40 Engineering/Handbook/commands/README.md`. Lint enforces all four.

## Invariants the lint gates will catch (fix, do not fight)

Zero third-party dependencies, so `node:` builtins only (`check-no-deps.mjs`). Skills
reference their plugin's `CONVENTIONS.md` by section and never copy 40 or more words from
it. Every skill has a `## Done when` and a handbook entry. `§<id>` citations and "the X
subagent" prose must resolve. No `<` or `>` in SKILL.md frontmatter values. Some doctrine
sentences are duplicated byte-identically across `CONVENTIONS.md` files on purpose
(`SHARED_PASSAGES` in `lint-plugins.mjs`), so edit every listed copy in the same commit.
Never dedupe them or delete the pin. Agent frontmatter `model:` tiers have lint-enforced
floors (`AGENT_MODEL_FLOORS`, kept in sync with `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md`),
so do not downgrade them to save tokens.

## The documentation hub

`code-ops-docs/` is the only authored documentation hub and the Obsidian vault for this
repository. Follow `code-ops-docs/Standard.md`. The shared layout SSOT is
`code-ops-docs/40 Engineering/Techniques/vault-standard.md`. The sole topic and source
registry is `code-ops-docs/98 System/DOCS_MANIFEST.json`. Run
`node scripts/docs-manifest.mjs check` before trusting it, and use
`code-ops-suite:repo-docs` for delta-based extraction. Code, schemas, workflows, plugin
manifests, and skills remain executable evidence, not competing documentation trees.
Manifest-v2 record collections may preserve immutable evidence at permanent historical
paths, and their inventory, citations, curation, and semantic index remain hub-governed. Run
`node scripts/records.mjs check --collection <id>` for each registered collection.
`code-ops-docs/80 Runs/` is gitignored run scratch (ADR 0001 treatment).
