# The code-ops Handbook

The **code-ops** marketplace is four Claude Code and Codex plugins that share one backbone. Claude Code invokes a workflow as `/<plugin>:<name>`. In Codex, name the same workflow as `<plugin>:<name>` in your request. Each workflow runs a dynamic, conflict-aware multi-agent loop, grounds every finding at `file:line`, and checks in with you at the decisions that matter.

This page is the front door. It names the plugin that owns the job in front of you, routes the most common tasks to one command, and links every chapter that goes deeper. Read the four bullets below, scan the router, then follow the map.

## The four-plugin mental model

- **code-ops-suite is the spine.** Broad-breadth engineering for any repo (audit, remediation, feature discovery and build, performance, tests, dependencies, PR review, normalization, pr-split) plus all reference-doc generators (architecture, api-docs, data-model, adr, ops-docs, onboarding) plus the orchestrators (full-sweep, everything, ship, debug). Start here when the task is ordinary engineering.
- **rigor is the verification layer.** Prove it or do not report it. Evidence tiers (CONFIRMED, PROBABLE, SPECULATIVE), a disconfirmation pass, ground truth first, runnable repros, a regression guard, and closure with enforcement. It is the high-signal counterpart to code-ops breadth (`rigor:bug-hunt` against `codebase-audit`, `rigor:deep-review` against `pr-review`). Reach for it when you want proven findings rather than a long list.
- **privacy-opsec-suite is the anonymity track.** Install it only for projects with anonymity or opsec needs. The keystone `anonymity-threat-model` frames six parallel leak audits, which feed `LEAK_REGISTER.md`, which drives `opsec-hardening` (fail-closed), guarded by `opsec-pr-gate` and `authorship-hygiene`. Its stance is defensive privacy engineering: protect your own users, anonymous by default.
- **researcher is the proposal layer.** Code-grounded research, local-first with disclosed, fail-closed egress. It proposes registers and design briefs, then hands off to the other three. It never edits code.

A shared backbone runs through all four: developer-in-the-loop, evidence at `file:line`, behavior preservation, registers as the single source of truth (stamped Verified-at `<sha>`, kept fresh by `revalidate-register.mjs`), and the gated, auto-safe, and auto-all automation ladder with always-gated categories (security and auth, secrets, data migrations, public contracts, destructive operations).

## Task to command router

The twelve most common starts. Each command is a skill: invoke it as `/<plugin>:<name>`. For the full table covering all 66 commands, see [commands/README.md](commands/README.md). A CI parity check (`lint-plugins.mjs`) keeps that reference in lockstep with the plugin manifests, so no command can quietly drop out of the table.

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

### Context and code economy

These mechanisms compress the run rather than the codebase. Each is a script the plugin bundles, reached through the `co` entrypoint, where `co` stands for `node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs`. Chapter [12-context-and-code-economy.md](12-context-and-code-economy.md) explains the whole set, [../../50 Platform/INFRASTRUCTURE.md](../../50 Platform/INFRASTRUCTURE.md) carries the switches, and [../../55 Operations/MEASUREMENTS.md](../../55 Operations/MEASUREMENTS.md) carries the numbers.

| I want to… | Command |
| --- | --- |
| Read a large file without pulling all of it into context | `co context skim <file>`, then `co context skim <file> --range A,B` |
| Answer a structural question about a symbol | `co context query find <symbol>` (also `callers`, `callees`, `blast`) |
| Compress a command's output before it enters the context | `co context digest -- <command>` |
| Check a diff for over-building | `co scan overbuild --git <range>` |
| List the deliberate simplifications a codebase has recorded | `co scan deferrals` |
| Read what a session cost, by arm | `co context audit receipts --by-arm` |
| Check that the atlas prose still cites live code | `co atlas check --atlas <dir> --claims-gate` |

The output digest, the symbol-index refresh, and the ladder card run as hooks and are on by default. Each stops when its switch (`CODE_OPS_DIGEST`, `CODE_OPS_INDEX`, `CODE_OPS_LADDER_CARD`) holds `off`, `0`, or `false` in the `env` block of a `.claude/settings.json`. The session receipt obeys `CODE_OPS_RECEIPTS` the same way.

## Map of this handbook

Every page below sits under `code-ops-docs/` and is tracked in the repo.

**Handbook (orientation and reference)**
- [01-getting-started.md](01-getting-started.md): install, first run, and how to read a checkpoint.
- [02-mental-model.md](02-mental-model.md): the four-plugin model and how the plugins compose, with a C4 diagram and the glossary.
- [03-orchestrators.md](03-orchestrators.md). It covers `full-sweep`, `everything`, `ship`, `debug`, `rigor-sweep`, `research-sweep`, and the privacy `full-sweep`, with when to use which, their phases, and relative cost.
- [04-registers-and-freshness.md](04-registers-and-freshness.md): the FINDINGS, CONSISTENCY, LEAK, RESEARCH_FINDINGS, IDEAS, DEFERRALS, and EGRESS_MANIFEST schemas, the NOW-SAFE, NEEDS-REVIEW, and NEEDS-DESIGN tracks, Verified-at stamps, `revalidate-register.mjs`, OBSOLETE-AT, and recovery.
- [05-evidence-and-tiers.md](05-evidence-and-tiers.md): CONFIRMED, PROBABLE, and SPECULATIVE, plus the disconfirmation pass as lived practice.
- [06-privacy-opsec-primer.md](06-privacy-opsec-primer.md): orientation to the anonymity track, covering when a repo needs it and why anonymity is a stronger property than privacy.
- [07-researcher-egress.md](07-researcher-egress.md): the disclosed, fail-closed egress model end to end, which treats every outbound request as a first-class, disclosed event.
- [08-ci-and-automation.md](08-ci-and-automation.md): wiring the per-PR gates and recurring skills, with what each gate blocks and the one credential and permission they need.
- [09-cost-and-scoping.md](09-cost-and-scoping.md): cost as a control you hold, and how to choose the orchestrator, scope, track, and check-in cadence to fit a budget.
- [10-recovery-and-troubleshooting.md](10-recovery-and-troubleshooting.md): what to do when a run stalls or a register goes stale, which is to re-ground against current code and then continue.
- [11-standard-operating-mode.md](11-standard-operating-mode.md): the SSOT for default routing, holding the task-type to command table and the tier and effort delegation rule.
- [12-context-and-code-economy.md](12-context-and-code-economy.md): the skim, digest, symbol index, ladder, and receipt mechanisms, with what each one does, its default state, and its off switch.

**Command reference**
- [commands/README.md](commands/README.md): the command-reference index and the full task to command router covering all 66 commands.
- [commands/code-ops-suite.md](commands/code-ops-suite.md): the 34 code-ops-suite commands.
- [commands/rigor.md](commands/rigor.md): the 11 rigor commands.
- [commands/privacy-opsec-suite.md](commands/privacy-opsec-suite.md): the 14 privacy-opsec-suite commands.
- [commands/researcher.md](commands/researcher.md): the 7 researcher commands.

### Guides (end-to-end journeys)

- [../../70 Guides/audit-a-risky-subsystem.md](../../70 Guides/audit-a-risky-subsystem.md): the rigor journey: ground-truth, test-suite-audit, bug-hunt with quality-scan, safety-net, then fix-verified.
- [../../70 Guides/ship-a-verified-fix.md](../../70 Guides/ship-a-verified-fix.md): `code-ops-suite:ship` across rigor, the privacy gate, and a traceless PR.
- [../../70 Guides/the-everything-pass.md](../../70 Guides/the-everything-pass.md): the `everything` orchestrator end to end, checkpoint by checkpoint.
- [../../70 Guides/debug-symptom-to-root-cause.md](../../70 Guides/debug-symptom-to-root-cause.md): driving `code-ops-suite:debug` from a live symptom to a proven root-cause fix: reproduce first, fix at the cause, lock it behind a regression test.
- [../../70 Guides/harden-anonymity.md](../../70 Guides/harden-anonymity.md): the anonymity-track journey through `privacy-opsec-suite:full-sweep`: model, audits, hardening, and docs and gate as one fail-closed pipeline.
- [../../70 Guides/respond-to-a-suspected-leak.md](../../70 Guides/respond-to-a-suspected-leak.md): the incident journey: `leak-incident-response` then `opsec-hardening`, confirming from redacted evidence and locking the leak shut.
- [../../70 Guides/research-a-library-choice.md](../../70 Guides/research-a-library-choice.md): an A-against-B-against-build decision via `researcher:library-eval`, then `research-verify`, then `code-ops-suite:adr`, proven before anyone writes code.
- [../../70 Guides/wire-ci-gates.md](../../70 Guides/wire-ci-gates.md): the hands-on companion to chapter 08: standing up the three per-PR review gates and recurring researcher runs on a repo.
- [../../70 Guides/ci-portability.md](../../70 Guides/ci-portability.md): running the gates off GitHub: the mechanical validate chain translated to GitLab CI and CircleCI, with the agent-review gates marked as host-specific extension points.

### Techniques (focused how-tos)

**Techniques index**
- [../Techniques/reading-a-findings-register.md](../Techniques/reading-a-findings-register.md): how to read and act on a findings register.
- [../Techniques/disconfirmation-pass.md](../Techniques/disconfirmation-pass.md): running the disconfirmation pass that kills false positives.
- [../Techniques/choosing-an-automation-level.md](../Techniques/choosing-an-automation-level.md): picking gated against auto-safe against auto-all, and the always-gated categories.
- [../Techniques/register-carry-forward.md](../Techniques/register-carry-forward.md): the narrow move at a phase boundary: re-grounding a register so a fixed item is never re-listed, re-ranked, and worked twice.
- [../Techniques/subagent-trade-offs.md](../Techniques/subagent-trade-offs.md): which subagents exist, when a skill fans out to them, and the context-isolation trade-offs you buy when it does.
- [../Techniques/applying-quality-lenses.md](../Techniques/applying-quality-lenses.md): treating the quality lenses as a decision aid: choosing which apply to your stack and how to weight them.
- [../Techniques/redaction-discipline.md](../Techniques/redaction-discipline.md): the mechanical rule for secrets and PII: redact to `<REDACTED:reason>` everywhere, never reproduce a live secret or real identifier.
- [../Techniques/dispatch-brief-template.md](../Techniques/dispatch-brief-template.md): the six-section fill-in skeleton for briefing a subagent, plus per-agent-kind notes and a worked example.
- [../Techniques/skill-composition.md](../Techniques/skill-composition.md): the cross-skill invocation map: every skill that invokes another skill mid-run, when, and what artifact it passes.
- [../Techniques/calibration-protocol.md](../Techniques/calibration-protocol.md): the one-way channel rule, run design, metric table, and sanitized-note template `calibration-run` follows.
- [../Techniques/artifact-grammars.md](../Techniques/artifact-grammars.md): the SSOT for seven grammar sections covering eight run artifacts. A zero-parse on a non-empty file means shape drift, not absence.
- [../Techniques/calibration-graph.md](../Techniques/calibration-graph.md): the SSOT for the calibration store's shape: runs and lessons as nodes, the fixes, enforcements, and verifying runs that close a lesson as edges, and `evals/CALIBRATION_TABLE.md` demoted to a rendered view of it.
- [../Techniques/atlas.md](../Techniques/atlas.md): the SSOT for the per-repo atlas: judgment banked as durable sections with a squash-safe `verifiedDigest` and diagnostic `verifiedAt` stamp. A fresh section is consumed without re-verification. A stale section is a lead, not a fact.
- [../Techniques/writing-standard.md](../Techniques/writing-standard.md): the house writing standard every artifact is written to: one term per concept, active voice, one instruction per sentence, and the word caps, with clarity outranking conformance.
- [../Techniques/context-hygiene.md](../Techniques/context-hygiene.md): keeping a run's spend linear and letting it survive compaction: durable state on disk, deliberate compaction at phase boundaries, the subagent prompt cache, and rebuilding from artifacts instead of summaries.
- [../Techniques/shell-discipline.md](../Techniques/shell-discipline.md): the two quiet shell failures: a hook-gated command chained into a compound call loses every operation in it, and a broad `git add` stages local state the repo was never meant to carry.
- [../Techniques/vault-standard.md](../Techniques/vault-standard.md): the SSOT for the per-repo Obsidian vault: the numbered folder layout, the product and research profiles, where suite artifacts land, and the promotion rule that keeps the vault and the tracked repo docs from drifting into copies.
- [../Techniques/fleet-standard.md](../Techniques/fleet-standard.md): the SSOT for standardizing several repos together: the `FLEET.json` manifest, the two-sided consent rule that lets a named repo decline, and the `check-fleet.mjs` report that lands one conformance row per member per surface.

## The handbook is complete

This is the full handbook: twelve chapters, the command reference, nine guides, and eighteen techniques, all under `code-ops-docs/` and tracked in the repo. Every link above resolves to a written page. Nothing is deferred.

*Verified-at: b0ffede*
