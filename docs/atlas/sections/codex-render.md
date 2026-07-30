# Codex render layer

Charter: the fully derived Codex marketplace under `codex-marketplace/` and `.agents/` and the transform that produces it; leaves out the canonical plugin sources (see plugins-and-skills) and the pre-commit hook mechanics shared with vendoring (see gate-scripts).

## Why it exists and why it is never hand-edited

Claude and Codex need incompatible skill headers and path conventions from one source of truth; hand-editing the render would let the hosts drift silently. The renderer (`scripts/build-codex-marketplace.mjs`) is deterministic **so that `--check` can be a CI gate** — the pre-commit hook is convenience, CI on both OS legs is the fail-closed backstop, and `writeOutput` recursively deletes the output root first, so any hand edit is destroyed, not merged. `.agents/` is not a second authored tree: it holds exactly one generated file, the Codex catalog entrypoint — treat it as an output slot.

Critically, **nobody reviews this tree's contents**: both AI gate workflows skip review when the whole diff is render output, and `lint-plugins.mjs` does not know the tree exists (the generated READMEs escape every skill-count/handbook gate). Determinism is the only authority — any semantic mistake must be caught in the renderer, never patched in the output.

## What the transform loses or rewrites (the load-bearing losses)

- Agent frontmatter `tools:` and `model:` are stripped and replaced with a prose role-contract banner. **The lint-enforced model floors and tool restrictions have no effect on the Codex side** — "agents are constrained" is a Claude-only claim; on Codex the read-only guarantee survives only as prose.
- `${CLAUDE_PLUGIN_ROOT}` becomes the documentation placeholder `<plugin-root>` in prose (with a per-skill resolution instruction injected — that injection is what makes the token meaningful), but hooks get a different, narrower rewrite to the real runtime variable `${PLUGIN_ROOT}`.
- The global prose rewrite is blunt `replaceAll` (`CLAUDE.md`→`AGENTS.md`, `Claude Code`→`Codex`, slash prefixes stripped) — any deliberate mention of Claude Code in source prose is silently reinterpreted, and rendered prose can come out semi-incoherent ("slash command" text beside a de-slashed example). Write plugin prose with the render in mind.
- `plugins/*/scripts/` copies byte-identically with **no** transform, deliberately: a prose pass would break the lint-enforced vendored parity.
- Skill `name` is re-emitted from the directory slug, so **renaming a skill dir renames the Codex identity**.
- Per-plugin display metadata (brand color, category, capabilities, default prompt) and the full text of the generated README/PLATFORM_COMPATIBILITY files live **only inside the renderer's `PLUGINS` array and string templates** — they have no source under `plugins/`; editing them means editing the renderer.

## Invariants and gotchas

- Adding/removing a plugin requires editing the renderer's hardcoded `PLUGINS` registry — it throws on any mismatch with the canonical marketplace, and it re-checks plugin version parity as a thrown source error (distinct from the friendly "stale — rerun" drift exit). Exit contract: 0 ok, 1 drift, 2 usage, throw on invalid source.
- Self-validation runs before write or compare in both modes; the `${CLAUDE_PLUGIN_ROOT}` leak check covers SKILL.md/agents/CONVENTIONS only — scripts and hooks are intentionally out of scope.
- The pre-commit hook's exact regeneration command, staged paths, skip and refusal behavior are pinned by `evals/codex-marketplace/run.mjs` — changing the hook's shape must update that eval, deliberately.
- The renderer emits `allow_implicit_invocation: true` and the eval pins it (docs claiming a manual-only policy drifted once and were re-synced 2026-07-30). Note the invocation-policy prose lives outside this section's scope (root README, handbook), so the checker cannot re-stale this section when those lines change — verify policy claims against the renderer, not the docs.
- Determinism on Windows is engineered (CRLF normalized on read, sorted traversal) and the Windows CI leg exists to keep it — don't introduce unsorted `readdirSync` or raw reads.
- MCP is single-plugin (code-ops-suite); the branches are dead for the other three, and adding MCP elsewhere is a renderer-registry edit.
- The Codex-side shapes (`.codex-plugin/plugin.json`, `agents/openai.yaml`, install policies) are asserted, not validated against a live Codex runtime — CI proves determinism, not host compatibility. The CHANGELOG transform includes one brittle exact-string substitution that silently no-ops if the source sentence is reworded.
