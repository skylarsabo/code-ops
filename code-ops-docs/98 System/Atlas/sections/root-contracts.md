# Root contracts

Charter: repository-root instructions, discovery metadata, ignore policy, and top-level orientation. Excludes canonical plugin doctrine and hub records.

`AGENTS.md` holds the only copy of the host contract, and `CLAUDE.md` is the single import line `@AGENTS.md`. Lint fails closed on any other `CLAUDE.md` content and on a missing or empty `AGENTS.md`. The contract puts unenforced safety rules first, then describes repository routing deltas, generated-output boundaries, documentation authority, and required gates. The traceless rule names the `Traceless publishing (PR commits, title, body)` CI step as its fail-closed backstop and says the tool hook scans published argument values. The contract names each host's traceless hook event and skill-id form, and it points to `INFRASTRUCTURE.md` for the per-host hook table. The writing-standard and code-standard sections each name their hub technique page as the single source and the pin lists that hold the four conventions copies byte-identical.

The routing contract defers general model behavior to the user-wide contract and adds only repository deltas. It names the tier and floor owners, forbids wide-surface dispatch types, and points to `CONTRACTS.md` for the Run Contract and dispatch-guard rules and for the split between enforcement and advisories. The session-mechanisms section points to `INFRASTRUCTURE.md`, `CONTRACTS.md`, and `MEASUREMENTS.md` and keeps inline only the Grok assessment rule, which has no gate on that host. For substantive changes, `code-ops-suite:mech` runs the gate chain and returns only the verdict and a failing excerpt.

The root contract keeps model review gates opt-in and rare. The deterministic chain and the lead's diff read apply to every change. Exact-SHA deep-review and OpSec receipts apply only when the operator requests them or the brief names a high-risk surface. Hosted Actions retain deterministic checks, and any new commit or updated base invalidates an existing local-review boundary.

The user-wide contracts have their source in `global-contracts/`: `AGENTS.md` for Claude Code and Grok Build, `AGENTS.codex.md` for Codex. `scripts/sync-global.mjs` installs them in each host home and refreshes the installed plugin caches. It refuses to overwrite a contract it did not write unless the operator passes `--force` or `--capture`. The repository contract makes that script the post-merge step.

The documentation clause names the hub as the sole authored authority and the manifest as its registry. It routes verification of each record collection to the shared records engine.

The root README is an orientation surface for the whole marketplace. Plugin READMEs remain installation surfaces because a single-plugin install does not include the repository README. Root counts and plugin command counts are mechanically coupled to skill directories and handbook routing. The code-ops-suite plugin exposes 30 skills, including the local review boundary and long-horizon runtime support, and the marketplace ships 59 across its four plugins.

Ignore policy separates working scratch from durable evidence. Run scratch is local. The documentation hub is tracked. `docs/specs/`, `docs/superpowers/`, `docs/code-ops-run/`, and `tmp/` remain ignored scratch paths; they are compatibility boundaries or local drafts, not alternate authoritative documentation. `.gitattributes` forces LF so byte-identical doctrine and vendored scripts remain verifiable across Windows and Unix checkouts. Stage explicit paths because local host state can exist outside ignored directories.

The tracked `.claude/settings.json` supplies repository-local host permissions. Its local companion stays outside source control. Treat the pair as session configuration, not a replacement for the root contracts.

Root policy is not a substitute for executable checks. The contract states what must remain true; scripts, evals, renderer drift checks, and CI establish the proof.
