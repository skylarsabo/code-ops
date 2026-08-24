# Root contracts

Charter: the repo-root contract files (README.md, CLAUDE.md, AGENTS.md, LICENSE, .gitignore, .gitattributes) — who each speaks to and what a change must preserve; leaves out the docs tree (see docs-doctrine) and the lint layer that gates parts of these files (see gate-scripts).

## Roles and audiences

CLAUDE.md is the live operating contract for Claude sessions and is deliberately ordered by **absence of enforcement**, not importance — the top "Never" rules have no mechanical backstop and that unenforceability is the point (the routing card, ledger, and narration scan are stated to be advisories, not gates); a session should spend its attention at the top, because the bottom sections self-correct via lint. It is also a *delta* on the user's global doctrine: `mech`/`mech-review` are user-level agents defined outside the repo, so dangling agent names in it are intentional.

AGENTS.md is the hand-maintained Codex twin of CLAUDE.md — **nothing regenerates it** (the renderer's outputs are only `.agents/plugins/marketplace.json` and `codex-marketplace/`), so every CLAUDE.md process edit must be mirrored by hand, and the `.claude-plugin/` directory name must be left un-Codex-ified (it is a host path, not prose). It has rotted before (a botched `.Codex-plugin` substitution, a stale gate chain) and the 2026-07-30 re-sync left it **byte-identical** to CLAUDE.md — evidence it carries no genuine Codex-specific content, so hand-maintaining two identical twins invites the same re-drift; the open structural options are generating it (e.g. pre-commit sync) or a real Codex-native rewrite.

README.md speaks only to monorepo browsers (ADR 0001: single-plugin installs never deliver it), so install-facing content is deliberately duplicated into each plugin README rather than centralized here.

## What is gated vs what drifts

Exactly one root-README fact is lint-gated: the `(N skills)` count, and only when it sits **on the same physical line** as the backticked plugin name — reflowing that bullet silently downgrades the check, and a *missing* count merely warns. Everything else is free prose and drifts (the "What's inside" tree, script descriptions, and eval counts are the known high-drift zone — the tree already disagreed with the gated count at the time of writing). Skill-mention parity is a per-plugin README check; do not expect the root README to catch a missing skill.

## Ignore rules and attributes

The three gitignored docs paths (`docs/specs/`, `docs/superpowers/`, `docs/code-ops-run/`) are a publication boundary ratified by ADR 0001, not convenience — sweeps must exclude them and durable knowledge must never live only there. `.in_use/` is ignored because this repo is routinely installed from itself, so runtime markers appear in the source tree. **`.claude/` is untracked but NOT gitignored** and can contain worktrees and local state — this is the concrete `git add -A` hazard behind the stage-by-explicit-path rule; whether leaving it unignored is intentional is unresolved.

`.gitattributes` is one line (`* text=auto eol=lf`) and is load-bearing far beyond diff hygiene: the vendored-script byte-parity gate and the byte-identical SHARED_PASSAGES pins are only tractable on Windows checkouts because of forced LF (the Codex renderer additionally normalizes CRLF defensively). Do not remove or scope it down.

LICENSE is inert MIT; no gate reads it.
