---
name: provider-parity-audit
description: "Use when you want to audit the marketplace's own prose for provider-specific assumptions (harness mechanics, tool names, hook semantics) that would mislead a reader on a different host. The mechanical render layer is already covered by build-codex-marketplace.mjs --check; this skill covers prose only."
---

# PROVIDER PARITY AUDIT — Prose Free of Host-Specific Assumptions

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:provider-parity-audit`.** First read the `<plugin-root>/CONVENTIONS.md` bundled with this plugin — the finding/fix tracks (`§6`) and finding schema (`§7`) this skill's findings use.
**Mode:** ASSESS · **Consumes:** every plugin's `skills/*/SKILL.md`, `CONVENTIONS.md`, and `docs/` · **Produces:** `FINDINGS_REGISTER.md`.

The Codex render is already reconciled mechanically (`node scripts/build-codex-marketplace.mjs --check`) — this skill hunts what that check cannot see: **prose** written as if only one host exists.

## Phase 0 — Inventory
Dispatch an `explorer` operative to sweep `plugins/*/skills/*/SKILL.md`, every plugin's `CONVENTIONS.md`, and `docs/` for provider-coupled language: named harness mechanics (hook types, `PreToolUse`/`SessionStart` names), tool names (`Read`/`Grep`/`Glob`/`Bash` as literal tool identifiers vs. generic capabilities), and host-specific invocation phrasing (`disable-model-invocation` vs. Codex's `allow_implicit_invocation`). Return every hit as a `file:line` list, not a rewritten file.

## Phase 1 — Classify
For each hit, classify one of three ways:
- **Reconciled in the derived render** — the Codex renderer already produces the host-correct form (`build-codex-marketplace.mjs`); the Claude-side prose is correct as Claude-side prose. No finding.
- **Needs generic rewording** — the prose asserts a Claude-specific mechanic as if universal, where a host-neutral phrasing would serve equally well and reads correctly on both hosts.
- **Intentionally provider-specific** — the prose is deliberately Claude-only (e.g. a Codex hook feature with no Codex equivalent) and documents why inline; leave as-is but record the rationale.

## Phase 2 — Findings
Write every "needs generic rewording" hit into `FINDINGS_REGISTER.md` in the finding schema (`§7`), tracked `NOW-SAFE` if the reword is purely lexical and behavior-inert, `NEEDS-REVIEW` if it changes what a reader would understand the mechanic to be. Note "intentionally provider-specific" items in the register too, tagged as accepted-as-is with the cited rationale, so a later pass does not re-flag them.

## Done when
Every hit from Phase 0 has a classification; `FINDINGS_REGISTER.md` passes `node <plugin-root>/scripts/revalidate-register.mjs FINDINGS_REGISTER.md --root .` clean. Present the register, needs-rewording items first.
