# Working on this repo

This is a plugin marketplace whose product is quality discipline. The rules below are
ordered by how little mechanical backstop they have; the top ones break silently.

## Never (no gate will save you)

- **Never weaken a gate.** No fail-closed check turned fail-open, no removed validation,
  and no narrowed coverage, including the checks in `scripts/lint-plugins.mjs`,
  `evals/score.mjs`, and the workflows themselves. Never make a lint or eval pass by
  editing the check instead of the code.
- **Traceless publishing on ALL paths:** the `enforce-traceless` hook and the CI step
  "Traceless publishing (PR commits, title, body)" block AI attribution, emoji, and
  assistant voice (`plugins/code-ops-suite/hooks/enforce-traceless.mjs`; no off switch).
  The same hook, the tracked pre-commit and pre-push hooks, and that CI step also block a
  branch name that starts with an AI tool name (`claude/`, `codex/`) or ends in a generated
  token (`scripts/branch-name.mjs`). Name each branch for its topic, such as `eng/<topic>`.
  Self-gate: `node scripts/scan-ai-tells.mjs <files...>` (or `--git <range>`).
- **Model review gates are opt-in, and rare.** The deterministic gate chain and the lead's
  own read of the final diff run on every change. `code-ops-suite:local-review-gate` (deep
  review plus the OpSec gate) runs only when the operator says so at the checkpoint or a
  brief names it, for changes that touch a high-risk surface (security, egress, data
  migrations, public contracts, gate scripts) or that the operator wants reviewed. It binds
  the exact base and HEAD, both receipts land before push, and any new commit or base
  movement voids them. Hosted Actions run deterministic checks only and are the required
  merge gate.
- **`evals/*/ANSWER_KEY.*` never enters the context handed to a skill under eval.**
- **The real-scale calibration channel is one-way** (see `evals/README.md`). Only the
  sanitized calibration note returns from a private-repo calibration run. Never quote
  that repo's internals here.

## Model roles

`scripts/model-tiers.mjs` owns provider bindings; `AGENT_MODEL_FLOORS` owns floors (lint check 12).
Dispatch a suite agent, never a wide-surface type (dispatch guard; off: `CODE_OPS_DISPATCH_GUARD=off`).
The "Run contract" and "Dispatch guard hook" sections of
`code-ops-docs/35 Contracts and Data/CONTRACTS.md` state each rule and name the advisories.

## One contract, two filenames

`AGENTS.md` holds the only copy of this contract. `CLAUDE.md` is the single line `@AGENTS.md`
(lint check 20 fails closed otherwise). Edit `AGENTS.md` only. The per-host reading rules are
the comment on check 20 in `scripts/lint-plugins.mjs`.

Skill ids here use the colon form, such as `code-ops-suite:repo-docs`. OpenCode calls the
same skills by hyphenated names, such as `code-ops-suite-repo-docs`.

## Standards

Every artifact follows the house writing standard,
`code-ops-docs/40 Engineering/Techniques/writing-standard.md`, which binds calibration notes,
findings registers, commit messages, PR bodies, and skill prose. Every code change follows the
house code standard, `code-ops-docs/40 Engineering/Techniques/code-standard.md`.

Lint check 14 pins the core clause of each standard byte-identically across all four
`CONVENTIONS.md` files (`SHARED_PASSAGES` in `scripts/lint-plugins.mjs`, mirrored in
`PINNED_TEXTS` in `evals/lint-plugins/run.mjs`). Edit every copy in one commit.

## Session mechanisms

`code-ops-docs/50 Platform/INFRASTRUCTURE.md` lists the suite hooks, their off switches, and
the per-host coverage. `CONTRACTS.md` owns each hook contract and `MEASUREMENTS.md` its
measured effect. Use `scripts/co.mjs context skim|query` before loading large files or maps.

## Before declaring any change done

Run `node scripts/lint-plugins.mjs && node scripts/check-no-deps.mjs && node scripts/build-codex-marketplace.mjs --check && node scripts/build-opencode-dist.mjs --check && node scripts/render-global-contracts.mjs --check`, the first structural steps of the CI gate in `.github/workflows/validate.yml`. CI runs the regression evals (validate.yml); mirror the step you touched. If you touched a fixture under `evals/*/repo`, run `node evals/score.mjs <its ANSWER_KEY.json> --check`. The `register-staleness` eval has no answer key, so run `node evals/register-staleness/run.mjs`.

For substantive changes, `code-ops-suite:mech` runs the gate chain and returns
only the verdict plus a failing excerpt. The lead owns acceptance and repeats a gate only
to settle a disputed result.

## After editing anything under `plugins/<name>/`

Bump `version` in `plugins/<name>/.claude-plugin/plugin.json`, update the matching
`.claude-plugin/marketplace.json` entry (lint check 1 enforces parity), and add a
`plugins/<name>/CHANGELOG.md` entry. Then regenerate the host distributions with
`node scripts/build-codex-marketplace.mjs` and `node scripts/build-opencode-dist.mjs`. Their
files, `.agents/plugins/marketplace.json`, and `opencode-dist/` are derived, never
hand-edited. Scripts under `plugins/*/scripts/` are vendored byte-identical copies of
`scripts/`, so edit the canonical root file and re-copy (lint check 6; the pre-commit hook re-copies).

Install `node scripts/install-git-hooks.mjs` once per checkout. Its pre-commit hook
regenerates only derived host paths and refuses dirty renderer inputs. When it changes staged
derived bytes, it runs the atlas gate and `docs-manifest.mjs check` and aborts with the fix
commands on failure. CI rejects derived drift when the hook is absent or bypassed. Write each CHANGELOG entry first and pass it as
`integrate-branch.mjs --changelog <plugin>=<file>` so no authored edit follows the stamp and
the manifest sync.

`node scripts/integrate-branch.mjs [--base <ref>] [--bump <plugin>:<major|minor|patch>]...`
runs the bump, the two regenerations, the manifest sync, and the applicable CI gates in one
pass (steps in its file header). A helper supplies only the judgment call: which bump, and
whether a stale atlas section still holds.

Edit the global contract only in `global-contracts/AGENTS.source.md`, then run
`node scripts/render-global-contracts.mjs`; the three `AGENTS.<host>.md` files are derived.
After a merge to main, run `node scripts/sync-global.mjs` to refresh this machine's global
contracts and plugin caches.

Adding or removing a skill: lint checks 2, 8, and 15 name each list and count to update.

## Invariants the lint gates will catch (fix, do not fight)

Zero third-party dependencies, so `node:` builtins only (`check-no-deps.mjs`; CI). Skills
reference their plugin's `CONVENTIONS.md` by section and never copy 40 or more words from it.
Every skill has a `## Done when` (lint check 3) and a handbook entry (lint check 8). `§<id>` citations
and "the X subagent" prose must resolve (lint checks 9 and 10). No `<` or `>` in SKILL.md
frontmatter values (lint check 11). Never dedupe the doctrine sentences duplicated across
`CONVENTIONS.md` files (`SHARED_PASSAGES`) or delete the pin. Agent frontmatter `model:` tiers
have floors (lint check 12; `AGENT_MODEL_FLOORS`, in sync with
`code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md`); do not downgrade them to
save tokens.

## The documentation hub

`code-ops-docs/` is the only authored documentation hub and Obsidian vault; follow
`code-ops-docs/Standard.md`. `code-ops-docs/98 System/DOCS_MANIFEST.json` is the sole topic
and source registry: run `node scripts/docs-manifest.mjs check` before trusting it, and
`node scripts/records.mjs check --collection <id>` for each record collection. CI runs both.
`docs-manifest.mjs sync` stamps only drifted domains; `--base <ref>` limits it further and
`--all` restamps every domain (`integrate-branch.mjs` passes `--base`).
`code-ops-docs/80 Runs/` is gitignored run scratch (ADR 0001 treatment).
