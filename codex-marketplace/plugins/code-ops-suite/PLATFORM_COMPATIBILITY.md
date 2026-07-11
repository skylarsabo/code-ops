# Platform compatibility

This Codex package is generated from the repository’s canonical Claude package. Rebuild it with `node scripts/build-codex-marketplace.mjs`; CI uses `--check` to prevent drift.

## Deliberate host transforms

- Claude skill headers use `disable-model-invocation: true`; Codex requires a skill `name`. This render removes the Claude-only field and writes `skills/<skill>/agents/openai.yaml` with `policy.allow_implicit_invocation: false` to keep manual invocation.
- `${CLAUDE_PLUGIN_ROOT}` becomes `<plugin-root>` in instructional prose. Codex resolves bundled runtime paths from the installed plugin root.
- Claude slash-command spelling becomes the Codex named-workflow spelling, for example `code-ops-suite:codebase-audit`.
- Claude agent `tools` and `model` frontmatter is removed. The root `agents/` files remain role-briefing templates for collaboration subagents.
- Claude GitHub Action examples are omitted because they are not Codex runtime configuration.
- The `PreToolUse` traceless-publishing hook is retained as `hooks/hooks.json`. Codex skips plugin hooks until the user reviews and trusts the hook definition.
- The `code-ops-docs` MCP declaration is translated from Claude’s inline manifest entry to Codex `.mcp.json` with a plugin-root-relative script path.

The generated package must continue to pass the Codex plugin validator and marketplace install smoke test.
