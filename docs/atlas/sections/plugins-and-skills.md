# Plugins and skills

Charter: the four plugins under `plugins/` and the marketplace root `.claude-plugin/marketplace.json` — design rationale, division of responsibility, and the invariants a plugin edit must respect. Leaves out the gate scripts that enforce those invariants (see gate-scripts) and the derived Codex render (see codex-render).

## Why it is shaped this way

Each plugin carries exactly one `CONVENTIONS.md` that every skill reads first and cites by `§` section. Skills are forbidden from restating it — the design fights prompt drift, not byte count: a skill restating a section drifts silently when the section is edited, so lint bans any 40+ contiguous-word verbatim copy while requiring the literal `CONVENTIONS.md` reference. The "read-once" clause (skip re-reading if already in context) is a token-economy decision pinned identically across all four CONVENTIONS files; it is doctrine, not an optimization the model may improvise.

Nearly every doctrine rule terminates in a script invocation (anchors → `revalidate-register.mjs`, proofs → `run-proof.mjs`/`check-proof-integrity.mjs`, autofix → `check-autofix-scope.mjs`, redaction → `scan-redaction.mjs`) because prose alone had a measured quality ceiling — the mechanical gate is the enforcement, the prose is the explanation.

SKILL.md frontmatter is treated as a prompt-injection surface: values are injected verbatim into the system prompt at discovery time, before any body is read, and quoting does not help — hence the hard ban on `<`/`>` in frontmatter values and the unquoted-colon rules.

## Division of responsibility (the non-obvious parts)

- **code-ops-suite is the privileged host plugin**, invisible from the names: it alone ships hooks (`enforce-traceless` fail-closed, `routing-card` deliberately fail-open — do not "harden" it) and the `code-ops-docs` MCP server. The other three reference that MCP conditionally, with vendored `lib-docs.mjs` as the standalone fallback.
- **rigor vs code-ops-suite is depth vs breadth**, stated as an explicit trade in rigor's CONVENTIONS ("finds fewer things than a fire-hose audit"); code-ops borrows rigor's tier machinery and labels the borrow. Only rigor carries the proof-integrity machinery.
- **researcher is architecturally non-mutating** — a hard boundary, not a style; its CONVENTIONS route every proposal class to an implementer in the other plugins. It is the only plugin with an egress model (`research-manifest.mjs`). Its `deep-research` reference is NOT a dangling skill: it names an external skill and is deliberately allowlisted in lint.
- **privacy-opsec-suite inverts the behavior-preservation default**: opsec hardening that intentionally tightens behavior (fail-closed, stripping a leaking field) is the point, carved out explicitly in its CONVENTIONS. It is also the doctrinal home of the traceless-publishing rule the repo applies to itself.
- **`everything` is the sole cross-plugin orchestrator** and requires three plugins (researcher is absent from its phases). The two `full-sweep` skills are intra-plugin orchestrators: lint forbids either from referencing the other plugin's skills.
- Each plugin ships one read-only investigator and one adversary, and the lint-enforced model floors encode doctrine: investigators floor at haiku **except rigor's `tracer` (opus)**, because it doubles as a refutation panelist; adversaries floor at opus (researcher's `claim-checker` at sonnet). A downgrade is meant to be a visible diff — never lower a floor to save tokens.

## Invariants and gotchas

- Version parity is a three-way lockstep — `plugin.json` version, `marketplace.json` entry, CHANGELOG entry — but only the first two are checked by structural lint; the changelog leg is enforced by the separate PR-scoped `check-plugin-bump.mjs`. `bump-plugin-version.mjs` updates all three at once.
- `.claude-plugin/marketplace.json` is the discovery root: every per-plugin lint check iterates the marketplace list, not the filesystem, so an unregistered plugin dir is invisible to everything except the explicit unregistered-dir check.
- The byte-identical duplicated doctrine passages (SHARED_PASSAGES, ~19 CONVENTIONS spans + 4 agent spans) are deliberate and pinned; coverage is uneven **by design** (several pins exclude researcher; some cover only code-ops + rigor). The pin list is the spec — never dedupe, never "fix" the asymmetry by adding copies. One pin (`always-gated-core`) *requires* a CONVENTIONS span to be duplicated into `skills/everything/SKILL.md`; it stays under 40 words so it coexists with the copy-paste ban.
- Mentioning `${CLAUDE_PLUGIN_ROOT}/scripts/X.mjs` in any SKILL.md **or CONVENTIONS.md** silently creates a vendoring obligation (the derived parity check), independent of the vendored manifest.
- Adding/renaming a skill ripples into four docs surfaces (plugin README list + count, root README count, handbook page heading, router table + `**N commands**` bullet) — see docs-doctrine.
- Underscore/dot-prefixed dirs under `skills/` are exempt from all skill checks (helper/asset dirs).
- marketplace.json and plugin.json `description` fields may diverge and do — parity is name + version only.
