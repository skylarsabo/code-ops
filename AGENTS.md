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

The user-wide contract owns general model behavior, and this repository adds only deltas.
`scripts/model-tiers.mjs` owns provider bindings and `AGENT_MODEL_FLOORS` owns agent floors.
Dispatch a suite agent, never a wide-surface type. The Run Contract validator and the
dispatch guard enforce the rest. The "Run contract" and "Dispatch guard hook" sections of
`code-ops-docs/35 Contracts and Data/CONTRACTS.md` state each rule and name the advisories.

## One contract, two filenames

`AGENTS.md` holds the only copy of this contract. `CLAUDE.md` is the single import line
`@AGENTS.md`, which Claude Code expands on load. Codex and opencode read `AGENTS.md`, and
opencode never falls back to `CLAUDE.md` while `AGENTS.md` exists. Grok Build lists both
files, so the import keeps Grok from loading the contract twice.

Edit `AGENTS.md` only. Lint fails closed unless `CLAUDE.md` is exactly the import line and
`AGENTS.md` is non-empty.

Skill ids here use the colon form, such as `code-ops-suite:repo-docs`. OpenCode calls the
same skills by hyphenated names, such as `code-ops-suite-repo-docs`.

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

`INFRASTRUCTURE.md` under `code-ops-docs/` lists the suite hooks, their off switches, and
the per-host coverage table. `CONTRACTS.md` owns each hook contract and `MEASUREMENTS.md` its
measured effect. Use `scripts/co.mjs context skim|query` before loading large files or maps.
On Grok the lead assesses CONTINUE, COMPACT, or HANDOFF at 150,000 tokens and again before
200,000, because Grok 4.7 bills double above that line.

## Before declaring any change done

Run `node scripts/lint-plugins.mjs && node scripts/check-no-deps.mjs && node scripts/build-codex-marketplace.mjs --check && node scripts/build-opencode-dist.mjs --check`, the first structural steps of the CI gate in `.github/workflows/validate.yml`. That workflow also runs the regression evals under `evals/`, so mirror the step covering what you touched. If you touched a fixture under `evals/*/repo`, run `node evals/score.mjs <its ANSWER_KEY.json>
--check`. The `register-staleness` eval has no answer key, so run `node evals/register-staleness/run.mjs`.

For substantive changes, `code-ops-suite:mech` runs the gate chain and returns
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

After a merge to main, run `node scripts/sync-global.mjs` to refresh this machine's global
contracts and plugin caches.

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

`code-ops-docs/` is the only authored documentation hub and Obsidian vault; follow
`code-ops-docs/Standard.md`. `code-ops-docs/98 System/DOCS_MANIFEST.json` is the sole topic
and source registry: run `node scripts/docs-manifest.mjs check` before trusting it, and
`node scripts/records.mjs check --collection <id>` for each record collection.
`code-ops-docs/80 Runs/` is gitignored run scratch (ADR 0001 treatment).
