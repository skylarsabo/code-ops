# Root contracts

Charter: repository-root instructions, discovery metadata, ignore policy, and top-level orientation. Excludes canonical plugin doctrine and hub records.

`CLAUDE.md` and `AGENTS.md` are byte-identical host contracts. They put unenforced safety rules first, then describe model routing, acceptance ownership, generated-output boundaries, documentation authority, and required gates. A change to either contract must update the other in the same commit.

The root contract routes judgment locally before a pull request. A final committed diff needs exact-SHA deep-review and OpSec receipts before push; verified statuses publish only after the live remote refs match. Hosted Actions retain deterministic checks. Any new commit or updated base requires a new review boundary.

The documentation clause names the hub as the sole authored authority and the manifest as its registry. It also recognizes manifest-v2 record collections as immutable governed evidence, routing collection verification to the shared records engine instead of inviting direct edits at historical paths.

The root README is an orientation surface for the whole marketplace. Plugin READMEs remain installation surfaces because a single-plugin install does not include the repository README. Root counts and plugin command counts are mechanically coupled to skill directories and handbook routing. The current code-ops package exposes 34 skills, including the local review boundary and long-horizon runtime support.

Ignore policy separates working scratch from durable evidence. Run scratch is local. The documentation hub is tracked. `docs/specs/`, `docs/superpowers/`, and `docs/code-ops-run/` remain ignored legacy scratch paths; they are compatibility boundaries, not alternate authoritative documentation. `.gitattributes` forces LF so byte-identical doctrine and vendored scripts remain verifiable across Windows and Unix checkouts. Stage explicit paths because local host state can exist outside ignored directories.

The tracked `.claude/settings.json` supplies repository-local host permissions. Its local companion stays outside source control. Treat the pair as session configuration, not a replacement for the root contracts.

Root policy is not a substitute for executable checks. The contract states what must remain true; scripts, evals, renderer drift checks, and CI establish the proof.
