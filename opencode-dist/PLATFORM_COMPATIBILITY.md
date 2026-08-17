# Platform compatibility

This opencode package is generated from the repository’s canonical Claude package.
Rebuild it with `node scripts/build-opencode-dist.mjs`; CI uses `--check` to prevent drift.

## Deliberate host transforms

- **Names are plugin-prefixed.** opencode discovers skills and agents into one flat
  namespace and its name grammar (`^[a-z0-9]+(-[a-z0-9]+)*$`) has no colon, so
  `code-ops-suite:ship` renders as `code-ops-suite-ship`. Without the prefix the two
  `full-sweep` skills and the two `explorer` agents would collide on install.
- **Skills and commands are both generated.** A skill is model-invocable through
  opencode's `skill` tool; a command is the user-facing slash entry point that names it.
  Claude Code collapses both into one surface, opencode does not.
- **`${CLAUDE_PLUGIN_ROOT}` becomes `<plugin-root>`,** resolved as
  `code-ops/<plugin>/` inside the opencode config directory. opencode has no
  plugin-root token because it has no plugin bundle for skills.
- **Agent `tools:` becomes `permission:`.** A Claude allowlist without `Write`/`Edit`
  renders `edit: deny`, and one without `Bash` renders `bash: deny`, so read-only
  operatives stay read-only. `webfetch` is denied for every agent, matching the suite’s
  local-first egress stance.
- **Agent `model:` becomes a stated capability tier.** opencode resolves models per
  provider, so a hardcoded Anthropic alias would not bind. Each agent states its
  required tier and `MODEL_TIERS.md` gives the per-provider model for it. The
  lint-enforced floor lives in the source repository; this host carries the tier as
  documentation, not as a gate.
- **The traceless hook is ported, not copied.** Claude’s `PreToolUse` hook is a
  stdin/exit-code contract; the opencode plugin subscribes to `tool.execute.before` and
  throws to block. Same policy, same fail-open-on-infrastructure-error stance.
- **The `code-ops-docs` MCP server is not bundled.** opencode configures MCP servers in
  `opencode.json` rather than per plugin; add it there if you want it.
- **Claude GitHub Action examples are omitted** because they are not opencode runtime
  configuration.
