# Platform compatibility

This opencode package is generated from the canonical Claude package in the code-ops repository.
Rebuild it there with `node scripts/build-opencode-dist.mjs`; CI uses `--check` to prevent drift.

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
- **Agent `model:` becomes a portable capability-floor gate.** Each agent states its
  required tier, every ready-made provider config binds it to that tier, and the
  `chat.params` plugin hook blocks a known below-floor or unclassified binding before
  the provider request. `MODEL_TIERS.md` is the verified allowlist for that check.
- **The traceless hook is ported, not copied.** Claude’s `PreToolUse` hook is a
  stdin/exit-code contract; the opencode plugin subscribes to `tool.execute.before` and
  throws to block. Same policy, same fail-open-on-infrastructure-error stance.
- **Digest rewrite and index refresh are ported.** OpenCode exposes mutable
  `tool.execute.before` arguments and typed `file.edited` events. The adapters call the
  canonical bundled digest and context-query scripts and preserve their off switches.
- **Routing guidance and pre-compaction preservation are ported.** OpenCode exposes
  `experimental.chat.system.transform` and
  `experimental.session.compacting`, so the generated runtime plugin appends the
  canonical preservation instruction to the compaction prompt.
- **The typed subagent-start callback, transcript path, and pre-tool `agent_id` are
  intentionally unavailable here.** `plugins/code-ops-lifecycle.js` covers those outcomes
  on the events OpenCode does expose: a stable system prefix, the ladder on the implementer,
  handoff and dispatch notes on the next tool result or user turn, a pending-handoff line
  on the first lead system transform, and a cost ledger at session idle.
- **The `code-ops-docs` and `code-ops-query` MCP servers are auto-configured.** The plugin
  derives their absolute local commands from its own module URL and adds typed local MCP
  entries without overwriting operator-defined entries.
- **Claude GitHub Action examples are omitted** because they are not opencode runtime
  configuration.
