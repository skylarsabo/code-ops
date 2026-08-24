# Root contracts

Charter: repository-root instructions, discovery metadata, ignore policy, and top-level orientation. Excludes canonical plugin doctrine and hub records.

`CLAUDE.md` and `AGENTS.md` are byte-identical host contracts. They put unenforced safety rules first, then describe model routing, acceptance ownership, generated-output boundaries, documentation authority, and required gates. A change to either contract must update the other in the same commit.

The root README is an orientation surface for the whole marketplace. Plugin READMEs remain installation surfaces because a single-plugin install does not include the repository README. Root counts and plugin command counts are mechanically coupled to skill directories and handbook routing.

Ignore policy separates working scratch from durable evidence. Run scratch is local. The documentation hub is tracked. `.gitattributes` forces LF so byte-identical doctrine and vendored scripts remain verifiable across Windows and Unix checkouts. Stage explicit paths because local host state can exist outside ignored directories.

The tracked `.claude/settings.json` supplies repository-local host permissions. Its local companion stays outside source control. Treat the pair as session configuration, not a replacement for the root contracts.

Root policy is not a substitute for executable checks. The contract states what must remain true; scripts, evals, renderer drift checks, and CI establish the proof.
