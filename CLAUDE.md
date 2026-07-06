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
  bypass the ship skill. Self-gate: `node scripts/scan-ai-tells.mjs <file-or--git-range>`.
- **PR-gate workflows only take effect once merged to main.** A PR that edits
  `.github/workflows/deep-review.yml` or `opsec-gate.yml` is not reviewed by its own
  edit; verify gate changes on a follow-up PR that does not touch the workflows.
- **`evals/*/ANSWER_KEY.*` never enters the context handed to a skill under eval.**
- **The real-scale calibration channel is one-way** (see `evals/README.md`): only the
  sanitized calibration note returns from a private-repo calibration run; never quote
  that repo's internals here.

## Before declaring any change done

Run `node scripts/lint-plugins.mjs && node scripts/check-no-deps.mjs` (the deterministic
CI gate in `.github/workflows/validate.yml`). Fix what they flag. If you touched a
fixture under `evals/*/repo`, also run `node evals/score.mjs <its ANSWER_KEY.json> --check`.

## After editing anything under `plugins/<name>/`

Bump `version` in `plugins/<name>/.claude-plugin/plugin.json`, update the matching
`.claude-plugin/marketplace.json` entry (lint enforces parity), and add a
`plugins/<name>/CHANGELOG.md` entry. Scripts under `plugins/*/scripts/` are vendored
byte-identical copies of `scripts/` — edit the canonical root file and re-copy; lint
enforces parity.

## Invariants the linter will catch (fix, don't fight)

Zero third-party dependencies (`node:` builtins only). Skills reference their plugin's
`CONVENTIONS.md` by section and never copy 40+ words from it. Every skill has a
`## Done when` and a handbook entry. `§<id>` citations and "the X subagent" prose must
resolve. No `<`/`>` in SKILL.md frontmatter values.
