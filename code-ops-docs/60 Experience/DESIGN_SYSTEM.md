---
type: reference
status: current
updated: 2026-09-03
---

# Design System

## Status

**Not applicable to a product interface.** Code-ops ships agent plugins, command-line scripts, Markdown documentation, and generated marketplace metadata. It does not ship a browser, mobile, desktop, or component-library user interface.

That conclusion is grounded in the current repository layout and delivery path: canonical packages render to host plugin directories, while the dependency guard permits only Node built-ins. Evidence: `AGENTS.md:94-101`, `scripts/build-opencode-dist.mjs:475-489`, and `scripts/check-no-deps.mjs:24-28`.

## Interaction surfaces

The human-facing surfaces are:

- Markdown skill, agent, handbook, and run artifacts.
- Node command-line tools with explicit usage errors and exit codes, reached either directly or through the `co <domain> <verb>` entrypoint.
- Hook output that reaches an agent rather than a person: a routing card at session start, a code-economy card at subagent start, and a digested tool result.
- GitHub pull-request and workflow status surfaces.
- Generated host manifests and slash-command metadata.

The context tools use explicit subcommands and strict flag parsing. Evidence: `scripts/context-snapshot.mjs:25-47` and `scripts/context-bundle.mjs:25-39`.

One command-line convention is load-bearing for the agent surfaces: a tool answers with `file:line` anchors and bounded outlines instead of file bodies, so a reader or an agent asks for a range next. `skim.mjs` prints a header and an outline, `context-query.mjs` prints anchors and edge lists, and `digest.mjs` prints kept lines with a recovery hint for every elided region. The [contracts reference](../35%20Contracts%20and%20Data/CONTRACTS.md) owns each output format. Evidence: `scripts/skim.mjs:11-20`, `scripts/context-query.mjs:8-21`, and `scripts/digest-lib.mjs:102-108`.

## Textual design standard

The house writing standard is the design system for documentation and agent interaction. It requires active, concise prose, one stable term per concept, and code citations for factual claims. Evidence: `code-ops-docs/40 Engineering/Techniques/writing-standard.md:1-105`.

Generated host artifacts retain canonical package content while transforming host-specific syntax. Evidence: `AGENTS.md:94-101` and `scripts/build-opencode-dist.mjs:475-489`.

## Future trigger

Create a visual design-system record only when this repository adds a shipped visual interface or component library. That record must define supported surfaces, tokens, accessibility requirements, states, and verification evidence. Until then, do not invent visual tokens for a non-existent product UI.
