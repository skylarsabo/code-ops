---
description: "Use when you want to audit the marketplace's own prose for provider-specific assumptions such as harness mechanics, tool names, and hook semantics that would mislead a reader on a different host. The mechanical render layer is already covered by build-codex-marketplace.mjs --check, so this skill covers prose only."
---

# Provider parity audit: prose free of host-specific assumptions

**Invoked as `/code-ops-suite:provider-parity-audit`.** First read the
`${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin, and especially the finding and
fix tracks (`§6`) and the finding schema (`§7`) this skill's findings use.
**Mode:** ASSESS · **Consumes:** every plugin's `skills/*/SKILL.md`, `CONVENTIONS.md`, and
`docs/` · **Produces:** `FINDINGS_REGISTER.md`.

The Codex render is already reconciled mechanically by
`node scripts/build-codex-marketplace.mjs --check`. This skill hunts what that check cannot see:
**prose** written as if only one host exists.

## Phase 0: the inventory

Dispatch an `explorer` operative to sweep `plugins/*/skills/*/SKILL.md`, every plugin's
`CONVENTIONS.md`, and `docs/` for provider-coupled language:
- Named harness mechanics, such as hook types and the `PreToolUse` or `SessionStart` names.
- Tool names, such as `Read`, `Grep`, `Glob`, and `Bash` used as literal tool identifiers rather than generic capabilities.
- Host-specific invocation phrasing, such as each host's manual-only frontmatter flag, whose name differs between the Claude and Codex renders.

Return every hit as a `file:line` list, never as a rewritten file.

## Phase 1: the classification

Classify each hit one of three ways:
- **Reconciled in the derived render.** The Codex renderer already produces the host-correct form (`build-codex-marketplace.mjs`), and the Claude-side prose is correct as Claude-side prose. This is not a finding.
- **Needs generic rewording.** The prose asserts a Claude-specific mechanic as if universal, where a host-neutral phrasing would serve equally well and read correctly on both hosts.
- **Intentionally provider-specific.** The prose is deliberately Claude-only, for example a Claude Code hook feature with no Codex equivalent, and documents why inline. Leave it as it stands and record the rationale.

## Phase 2: the findings

Write every needs-generic-rewording hit into `FINDINGS_REGISTER.md` in the finding schema (`§7`).
Track it `NOW-SAFE` when the rewording is purely lexical and behavior-inert, and `NEEDS-REVIEW`
when it changes what a reader would understand the mechanic to be. Note the
intentionally-provider-specific items in the register too, tagged as accepted-as-is with the
cited rationale, so a later pass does not re-flag them.

## Done when

- Every hit from Phase 0 has a classification.
- `FINDINGS_REGISTER.md` passes `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` clean.
- The register is presented with the needs-rewording items first.
