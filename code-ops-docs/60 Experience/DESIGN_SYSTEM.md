---
type: reference
status: current
updated: 2026-08-24
---

# Design System

## Status

**Not applicable to a product interface.** Code-ops ships agent plugins, command-line scripts, Markdown documentation, and generated marketplace metadata. It does not ship a browser, mobile, desktop, or component-library user interface.

This conclusion is grounded in the current repository layout and delivery path: canonical packages render to host plugin directories, while the dependency guard permits only Node built-ins. Evidence: `AGENTS.md:108-117`, `scripts/build-opencode-dist.mjs:475-489`, and `scripts/check-no-deps.mjs:24-28`.

## Interaction surfaces

The human-facing surfaces are:

- Markdown skill, agent, handbook, and run artifacts.
- Node command-line tools with explicit usage errors and exit codes.
- GitHub pull-request and workflow status surfaces.
- Generated host manifests and slash-command metadata.

The context tools use explicit subcommands and strict flag parsing. Evidence: `scripts/context-snapshot.mjs:25-47` and `scripts/context-bundle.mjs:25-39`.

## Textual design standard

The house writing standard is the design system for documentation and agent interaction. It requires active, concise prose, one stable term per concept, and code citations for factual claims. Evidence: `code-ops-docs/40 Engineering/Techniques/writing-standard.md:1-105`.

Generated host artifacts retain canonical package content while transforming host-specific syntax. Evidence: `AGENTS.md:108-117` and `scripts/build-opencode-dist.mjs:475-489`.

## Future trigger

Create a visual design-system record only when this repository adds a shipped visual interface or component library. That record must define supported surfaces, tokens, accessibility requirements, states, and verification evidence. Until then, do not invent visual tokens for a non-existent product UI.
