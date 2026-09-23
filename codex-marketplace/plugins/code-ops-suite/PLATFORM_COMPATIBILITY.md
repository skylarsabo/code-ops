# Platform compatibility

This Codex package is generated from the canonical Claude package in the code-ops repository (https://github.com/skylarsabo/code-ops). Rebuild it there with `node scripts/build-codex-marketplace.mjs`; CI uses `--check` to prevent drift.

## Deliberate host transforms

- Claude skills are model-invocable (the harness routes slash input through the Skill tool, so there is no manual-only mode); Codex requires a skill `name`. This render strips any legacy `disable-model-invocation` field the source may still carry and writes `skills/<skill>/agents/openai.yaml` with `policy.allow_implicit_invocation: true` to mirror that policy.
- `${CLAUDE_PLUGIN_ROOT}` becomes `<plugin-root>` in instructional prose. Codex resolves bundled runtime paths from the installed plugin root.
- Claude slash-command spelling becomes the Codex named-workflow spelling, for example `code-ops-suite:codebase-audit`.
- Claude agent `tools` and `model` frontmatter is removed because Codex does not use it for these role briefs. `agents/model-floors.json` preserves each source alias and canonical minimum tier for runtime routing checks.
- Claude GitHub Action examples are omitted because they are not Codex runtime configuration.
- `hooks/hooks.json` retains 10 hook commands on 7 events. Codex skips plugin hooks until the user reviews and trusts the hook definition.
  - `PreToolUse` `enforce-traceless.mjs`: blocks a commit or pull-request command whose published text carries attribution traces.
  - `PreToolUse` `digest-rewrite.mjs`: routes a simple shell command through the output digest so long output arrives compressed.
  - `PreToolUse` `dispatch-guard.mjs`: holds a subagent to its brief’s round budget, denies a wide-surface dispatch that names no reason, denies a suite-agent dispatch whose brief lacks a field the agent’s contract requires, gates new dispatches past the context ceiling until a handoff assessment, and flags a dispatch that overrides a declared tier.
  - `PostToolUse` `index-refresh.mjs`: re-indexes a file right after a tool edits it, so context queries read the live tree.
  - `PostToolUse` `handoff-card.mjs`: prompts the lead to assess continue, compact, or handoff at a safe boundary when resident context crosses each 150,000-token band.
  - `UserPromptSubmit` `handoff-card.mjs`: prompts the lead to assess continue, compact, or handoff at a safe boundary when resident context crosses each 150,000-token band.
  - `SessionStart` `routing-card.mjs`: prints the routing card at session start, a restore instruction after compaction, and the newest pending handoff on a fresh session.
  - `SessionEnd` `session-receipt.mjs`: appends a local session receipt row with token usage, tool calls, and model mix.
  - `SubagentStart` `ladder-card.mjs`: hands an implementer subagent the code-economy ladder card.
  - `SubagentStop` `subagent-report.mjs`: notes, without blocking, a subagent report whose first line lacks a declared verdict or that exceeds its word cap.
- The Codex render caps every `SessionEnd` command timeout at 3 seconds, which matches the desktop host ceiling. The canonical Claude hook timeout is unchanged.
- The render moves each MCP declaration from Claude’s inline manifest entry to Codex `.mcp.json` with a plugin-root-relative script path: `code-ops-docs`, `code-ops-query`.

The generated package must continue to pass the Codex plugin validator and marketplace install smoke test.
