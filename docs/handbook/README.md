# The code-ops Handbook

The **code-ops** marketplace is four Claude Code plugins that share one backbone. Each workflow is a namespaced skill you invoke as `/<plugin>:<name>`; they run a dynamic, conflict-aware multi-agent loop, ground every finding at `file:line`, and check in with you at the decisions that matter. This handbook is the hub: it tells you which of the four plugins owns the job in front of you, routes the most common tasks to a specific command, and links every chapter that goes deeper. Read the four bullets below, scan the router, then follow the map.

## The 4-plugin mental model

- **code-ops-suite = the SPINE.** Broad-breadth engineering for any repo (audit, remediation, feature discovery/build, performance, tests, dependencies, PR review, normalization, pr-split) PLUS all reference-doc generators (architecture, api-docs, data-model, adr, ops-docs, onboarding) PLUS the orchestrators (full-sweep, everything, ship, debug). Start here when the task is ordinary engineering.
- **rigor = the VERIFICATION layer.** Prove-it-or-don't. Evidence tiers (CONFIRMED / PROBABLE / SPECULATIVE), a disconfirmation pass, ground-truth-first, runnable repros, a regression guard, and closure-with-enforcement. The high-signal counterpart to code-ops breadth (`rigor:bug-hunt` vs `codebase-audit`; `rigor:deep-review` vs `pr-review`). Reach for it when you want *proven* findings, not a long list.
- **privacy-opsec-suite = the ANONYMITY TRACK.** Only for projects with anonymity/opsec needs. The keystone `anonymity-threat-model` frames six parallel leak audits, which feed `LEAK_REGISTER.md`, which drives `opsec-hardening` (fail-closed), guarded by `opsec-pr-gate` and `authorship-hygiene`. Defensive privacy engineering: protect your own users, anonymous-by-default.
- **researcher = the PROPOSAL layer.** Code-grounded research, local-first with disclosed, fail-closed egress. It proposes (registers and design briefs) and HANDS OFF to the other three. It never edits code.

A shared backbone runs through all four: developer-in-the-loop, evidence at `file:line`, behavior-preservation, registers as the single source of truth (stamped Verified-at `<sha>`, kept fresh by `revalidate-register.mjs`), and the gated / auto-safe / auto-all automation ladder with always-gated categories (security/auth, secrets, data migrations, public contracts, destructive ops).

## Task → command router (condensed)

The twelve most common starts. Each command is a skill: invoke it as `/<plugin>:<name>`. For the full table covering all 55 commands, see [commands/README.md](commands/README.md).

| I want to… | Command |
| --- | --- |
| Survey the whole codebase and get a ranked backlog | `code-ops-suite:codebase-audit` |
| Find *proven* bugs in one risky subsystem (not a long list) | `rigor:ground-truth` then `rigor:bug-hunt` |
| Fix items from the findings backlog, safely with tests | `code-ops-suite:remediation` |
| Fix one confirmed bug at root cause, with a regression guard | `rigor:fix-verified` |
| Review a PR before merge | `code-ops-suite:pr-review` (or `rigor:deep-review` at the verification bar) |
| Implement one change end-to-end at full rigor | `code-ops-suite:ship` |
| Drive a bug from symptom to a proven root-cause fix | `code-ops-suite:debug` |
| Discover and specify high-value features | `code-ops-suite:feature-discovery` |
| Generate a code-grounded architecture or API reference | `code-ops-suite:architecture` / `code-ops-suite:api-docs` |
| Map how a user could be deanonymized | `privacy-opsec-suite:anonymity-threat-model` |
| Bring in external best practices, grounded in your code | `researcher:research-improve` |
| Run the most thorough cross-plugin pass | `code-ops-suite:everything` |

## Map of this handbook

The first slice, all under `docs/` and tracked in the repo.

**Handbook (orientation and reference)**
- [01-getting-started.md](01-getting-started.md) — install, first run, and how to read a checkpoint.
- [02-mental-model.md](02-mental-model.md) — the 4-plugin model and how the plugins compose; a C4 diagram and the glossary.
- [03-orchestrators.md](03-orchestrators.md) — `full-sweep`, `everything`, `ship`, `debug`, `rigor-sweep`, `research-sweep`, and the privacy `full-sweep`: when to use which, their phases, and relative cost.
- [04-registers-and-freshness.md](04-registers-and-freshness.md) — the FINDINGS / CONSISTENCY / LEAK / RESEARCH_FINDINGS / IDEAS / EGRESS_MANIFEST register schemas, the NOW-SAFE / NEEDS-REVIEW / NEEDS-DESIGN tracks, Verified-at stamps, `revalidate-register.mjs`, OBSOLETE-AT, and recovery.
- [05-evidence-and-tiers.md](05-evidence-and-tiers.md) — CONFIRMED / PROBABLE / SPECULATIVE and the disconfirmation pass as lived practice.

**Command reference**
- [commands/README.md](commands/README.md) — the command-reference index and the full task → command router covering all 55 commands.
- [commands/code-ops-suite.md](commands/code-ops-suite.md) — the 23 code-ops-suite commands.
- [commands/rigor.md](commands/rigor.md) — the 11 rigor commands.
- [commands/privacy-opsec-suite.md](commands/privacy-opsec-suite.md) — the 14 privacy-opsec-suite commands.
- [commands/researcher.md](commands/researcher.md) — the 7 researcher commands.

**Guides (end-to-end journeys)**
- [../guides/audit-a-risky-subsystem.md](../guides/audit-a-risky-subsystem.md) — the rigor journey: ground-truth → test-suite-audit → bug-hunt + quality-scan → safety-net → fix-verified.
- [../guides/ship-a-verified-fix.md](../guides/ship-a-verified-fix.md) — `code-ops-suite:ship` across rigor, the privacy gate, and a traceless PR.
- [../guides/the-everything-pass.md](../guides/the-everything-pass.md) — the `everything` orchestrator end-to-end, checkpoint by checkpoint.

**Techniques (focused how-tos)**
- [../techniques/reading-a-findings-register.md](../techniques/reading-a-findings-register.md) — how to read and act on a findings register.
- [../techniques/disconfirmation-pass.md](../techniques/disconfirmation-pass.md) — running the disconfirmation pass that kills false positives.
- [../techniques/choosing-an-automation-level.md](../techniques/choosing-an-automation-level.md) — picking gated vs auto-safe vs auto-all, and the always-gated categories.

## Coming next

These chapters are planned for a later slice and are not yet written:

- Privacy-opsec primer — orientation to the anonymity track for newcomers.
- Researcher-egress walkthrough — the disclosed, fail-closed egress flow end-to-end.
- CI / automation chapter — wiring the PR gates and scheduled skills.
- Cost / scoping chapter — how to scope a run and reason about token cost.
- Recovery / troubleshooting chapter — what to do when a run stalls or a register goes stale.
- The remaining guides (5) and techniques (4).

*Verified-at: c2b37e9*
