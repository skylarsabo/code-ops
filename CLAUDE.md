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
- **PR-gate workflows only take effect once merged to main.** A PR that edits
  `.github/workflows/deep-review.yml` or `opsec-gate.yml` is not reviewed by its own
  edit; verify gate changes on a follow-up PR that does not touch the workflows.
- **`evals/*/ANSWER_KEY.*` never enters the context handed to a skill under eval.**
- **The real-scale calibration channel is one-way** (see `evals/README.md`): only the
  sanitized calibration note returns from a private-repo calibration run; never quote
  that repo's internals here.

## Model roles

Whichever model leads the session (the highest tier present — Fable 5, Opus, etc.)
plans, delegates, and reviews; it does not do the work inline. Dispatch Sonnet 5
operatives (Agent tool, `model: "sonnet"`) for exploration, implementation, and
verification, each with a precise self-contained brief. Operatives escalate questions
or work they cannot do back to the lead instead of guessing; the lead answers,
re-plans, or takes the piece over itself as last resort. The lead reviews finished
work itself (diff + gates) before reporting done — operative self-reports are not
acceptance.

## Before declaring any change done

Run `node scripts/lint-plugins.mjs && node scripts/check-no-deps.mjs && node scripts/build-codex-marketplace.mjs --check` — the first structural steps of the CI gate in `.github/workflows/validate.yml`; that workflow also runs the regression evals under `evals/`, so mirror the step covering what you touched. If you touched a fixture under `evals/*/repo`, run `node evals/score.mjs <its ANSWER_KEY.json>
--check`; `register-staleness` has no answer key — run `node evals/register-staleness/run.mjs`.

## After editing anything under `plugins/<name>/`

Bump `version` in `plugins/<name>/.claude-plugin/plugin.json`, update the matching
`.claude-plugin/marketplace.json` entry (lint enforces parity), and add a
`plugins/<name>/CHANGELOG.md` entry. Then regenerate `codex-marketplace/` with
`node scripts/build-codex-marketplace.mjs`; its files and `.agents/plugins/marketplace.json`
are derived artifacts, never hand-edited. Scripts under `plugins/*/scripts/` are vendored
byte-identical copies of `scripts/` — edit the canonical root file and re-copy; lint
enforces parity.

Install `node scripts/install-git-hooks.mjs` once per checkout. Its tracked pre-commit hook
regenerates and stages only the derived Codex marketplace paths, while refusing unstaged or
untracked renderer inputs; CI still rejects drift when hooks are absent or bypassed.

Adding or removing a skill also requires updating the plugin README's skill list and
`(N skills)` count, the matching count in root `README.md`, and handbook entries in both
`docs/handbook/commands/<plugin>.md` and the router table in
`docs/handbook/commands/README.md` — lint enforces all four.

## Invariants the lint gates will catch (fix, don't fight)

Zero third-party dependencies (`node:` builtins only — `check-no-deps.mjs`). Skills
reference their plugin's `CONVENTIONS.md` by section and never copy 40+ words from it.
Every skill has a `## Done when` and a handbook entry. `§<id>` citations and "the X
subagent" prose must resolve. No `<`/`>` in SKILL.md frontmatter values. Some doctrine
sentences are duplicated byte-identically across `CONVENTIONS.md` files on purpose
(`SHARED_PASSAGES` in `lint-plugins.mjs`) — edit every listed copy in the same commit;
never dedupe them or delete the pin. Agent frontmatter `model:` tiers have lint-enforced
floors (`AGENT_MODEL_FLOORS`, kept in sync with `docs/techniques/subagent-trade-offs.md`)
— don't downgrade them to save tokens.

## Local-only docs

`docs/specs/`, `docs/superpowers/`, and `docs/code-ops-run/` are gitignored scratch
(ADR 0001) — exclude them from doc-alignment and staleness sweeps.
