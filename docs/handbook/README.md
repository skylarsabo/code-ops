# The code-ops Handbook

The **code-ops** marketplace is four Claude Code and Codex plugins that share one backbone. Claude Code invokes a workflow as `/<plugin>:<name>`; in Codex, name the same workflow as `<plugin>:<name>` in your request. They run a dynamic, conflict-aware multi-agent loop, ground every finding at `file:line`, and check in with you at the decisions that matter. This handbook is the hub: it tells you which of the four plugins owns the job in front of you, routes the most common tasks to a specific command, and links every chapter that goes deeper. Read the four bullets below, scan the router, then follow the map.

## The 4-plugin mental model

- **code-ops-suite = the SPINE.** Broad-breadth engineering for any repo (audit, remediation, feature discovery/build, performance, tests, dependencies, PR review, normalization, pr-split) PLUS all reference-doc generators (architecture, api-docs, data-model, adr, ops-docs, onboarding) PLUS the orchestrators (full-sweep, everything, ship, debug). Start here when the task is ordinary engineering.
- **rigor = the VERIFICATION layer.** Prove-it-or-don't. Evidence tiers (CONFIRMED / PROBABLE / SPECULATIVE), a disconfirmation pass, ground-truth-first, runnable repros, a regression guard, and closure-with-enforcement. The high-signal counterpart to code-ops breadth (`rigor:bug-hunt` vs `codebase-audit`; `rigor:deep-review` vs `pr-review`). Reach for it when you want *proven* findings, not a long list.
- **privacy-opsec-suite = the ANONYMITY TRACK.** Only for projects with anonymity/opsec needs. The keystone `anonymity-threat-model` frames six parallel leak audits, which feed `LEAK_REGISTER.md`, which drives `opsec-hardening` (fail-closed), guarded by `opsec-pr-gate` and `authorship-hygiene`. Defensive privacy engineering: protect your own users, anonymous-by-default.
- **researcher = the PROPOSAL layer.** Code-grounded research, local-first with disclosed, fail-closed egress. It proposes (registers and design briefs) and HANDS OFF to the other three. It never edits code.

A shared backbone runs through all four: developer-in-the-loop, evidence at `file:line`, behavior-preservation, registers as the single source of truth (stamped Verified-at `<sha>`, kept fresh by `revalidate-register.mjs`), and the gated / auto-safe / auto-all automation ladder with always-gated categories (security/auth, secrets, data migrations, public contracts, destructive ops).

## Task → command router (condensed)

The twelve most common starts. Each command is a skill: invoke it as `/<plugin>:<name>`. For the full table covering all 61 commands, see [commands/README.md](commands/README.md). A CI parity check (`lint-plugins.mjs`) keeps that reference in lockstep with the plugin manifests, so no command can quietly drop out of the table.

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
- [06-privacy-opsec-primer.md](06-privacy-opsec-primer.md) — orientation to the anonymity track: when a repo needs it, and why anonymity is a stronger property than privacy.
- [07-researcher-egress.md](07-researcher-egress.md) — the disclosed, fail-closed egress model end-to-end: every outbound request as a first-class, disclosed event.
- [08-ci-and-automation.md](08-ci-and-automation.md) — wiring the per-PR gates and recurring skills: what each gate blocks, and the one credential and permission they need.
- [09-cost-and-scoping.md](09-cost-and-scoping.md) — cost as a control you hold: choosing the orchestrator, scope, track, and check-in cadence to fit a budget.
- [10-recovery-and-troubleshooting.md](10-recovery-and-troubleshooting.md) — what to do when a run stalls or a register goes stale: re-ground against current code, then continue.
- [11-standard-operating-mode.md](11-standard-operating-mode.md) — the SSOT for default routing: the task-type → command table and the tier/effort delegation rule.

**Command reference**
- [commands/README.md](commands/README.md) — the command-reference index and the full task → command router covering all 61 commands.
- [commands/code-ops-suite.md](commands/code-ops-suite.md) — the 29 code-ops-suite commands.
- [commands/rigor.md](commands/rigor.md) — the 11 rigor commands.
- [commands/privacy-opsec-suite.md](commands/privacy-opsec-suite.md) — the 14 privacy-opsec-suite commands.
- [commands/researcher.md](commands/researcher.md) — the 7 researcher commands.

**Guides (end-to-end journeys)**
- [../guides/audit-a-risky-subsystem.md](../guides/audit-a-risky-subsystem.md) — the rigor journey: ground-truth → test-suite-audit → bug-hunt + quality-scan → safety-net → fix-verified.
- [../guides/ship-a-verified-fix.md](../guides/ship-a-verified-fix.md) — `code-ops-suite:ship` across rigor, the privacy gate, and a traceless PR.
- [../guides/the-everything-pass.md](../guides/the-everything-pass.md) — the `everything` orchestrator end-to-end, checkpoint by checkpoint.
- [../guides/debug-symptom-to-root-cause.md](../guides/debug-symptom-to-root-cause.md) — driving `code-ops-suite:debug` from a live symptom to a proven root-cause fix: reproduce first, fix at the cause, lock it behind a regression test.
- [../guides/harden-anonymity.md](../guides/harden-anonymity.md) — the anonymity-track journey through `privacy-opsec-suite:full-sweep`: model, audits, hardening, and docs/gate as one fail-closed pipeline.
- [../guides/respond-to-a-suspected-leak.md](../guides/respond-to-a-suspected-leak.md) — the incident journey: `leak-incident-response` then `opsec-hardening`, confirming from redacted evidence and locking the leak shut.
- [../guides/research-a-library-choice.md](../guides/research-a-library-choice.md) — an A-vs-B-vs-build decision via `researcher:library-eval` → `research-verify` → `code-ops-suite:adr`, proven before anyone writes code.
- [../guides/wire-ci-gates.md](../guides/wire-ci-gates.md) — the hands-on companion to chapter 08: standing up the three per-PR review gates and recurring researcher runs on a repo.

**Techniques (focused how-tos)**
- [../techniques/reading-a-findings-register.md](../techniques/reading-a-findings-register.md) — how to read and act on a findings register.
- [../techniques/disconfirmation-pass.md](../techniques/disconfirmation-pass.md) — running the disconfirmation pass that kills false positives.
- [../techniques/choosing-an-automation-level.md](../techniques/choosing-an-automation-level.md) — picking gated vs auto-safe vs auto-all, and the always-gated categories.
- [../techniques/register-carry-forward.md](../techniques/register-carry-forward.md) — the narrow move at a phase boundary: re-grounding a register so a fixed item is never re-listed, re-ranked, and worked twice.
- [../techniques/subagent-trade-offs.md](../techniques/subagent-trade-offs.md) — which subagents exist, when a skill fans out to them, and the context-isolation trade-offs you buy when it does.
- [../techniques/applying-quality-lenses.md](../techniques/applying-quality-lenses.md) — treating the ten quality lenses as a decision aid: choosing which apply to your stack and how to weight them.
- [../techniques/redaction-discipline.md](../techniques/redaction-discipline.md) — the mechanical rule for secrets and PII: redact to `<REDACTED:reason>` everywhere, never reproduce a live secret or real identifier.
- [../techniques/dispatch-brief-template.md](../techniques/dispatch-brief-template.md) — the six-section fill-in skeleton for briefing a subagent, plus per-agent-kind notes and a worked example.
- [../techniques/skill-composition.md](../techniques/skill-composition.md) — the cross-skill invocation map: every skill that invokes another skill mid-run, when, and what artifact it passes.
- [../techniques/calibration-protocol.md](../techniques/calibration-protocol.md) — the one-way channel rule, run design, metric table, and sanitized-note template `calibration-run` follows.
- [../techniques/artifact-grammars.md](../techniques/artifact-grammars.md) — the SSOT for the three parse grammars (`DISPATCH_LEDGER.md`, `FINDINGS_REGISTER.md`, `REFUTATION_LOG.md`) that `calibration-metrics.mjs` and `revalidate-register.mjs` consume; a zero-parse on a non-empty file means shape drift, not absence.
- [../techniques/calibration-graph.md](../techniques/calibration-graph.md) — the SSOT for the calibration store's shape: runs and lessons as nodes, the fixes/enforcements/verifying runs that close a lesson as edges, and `evals/CALIBRATION_TABLE.md` demoted to a rendered view of it.
- [../techniques/atlas.md](../techniques/atlas.md) — the SSOT for the per-repo atlas: judgment banked as durable sections, each stamped with a `verifiedAt` commit and checked FRESH or STALE mechanically, so a fresh section is consumed without re-verification and a stale one is a lead, not a fact.
- [../techniques/writing-standard.md](../techniques/writing-standard.md) — the house writing standard every artifact is written to: one term per concept, active voice, one instruction per sentence, and the word caps, with clarity outranking conformance.
- [../techniques/context-hygiene.md](../techniques/context-hygiene.md) — keeping a run's spend linear and letting it survive compaction: durable state on disk, deliberate compaction at phase boundaries, the subagent prompt cache, and rebuilding from artifacts instead of summaries.
- [../techniques/shell-discipline.md](../techniques/shell-discipline.md) — the two quiet shell failures: a hook-gated command chained into a compound call loses every operation in it, and a broad `git add` stages local state the repo was never meant to carry.
- [../techniques/vault-standard.md](../techniques/vault-standard.md) — the SSOT for the per-repo Obsidian vault: the numbered folder layout, the product and research profiles, where suite artifacts land, and the promotion rule that keeps the vault and the tracked repo docs from drifting into copies.

## The handbook is complete

This is the full handbook: eleven chapters, the command reference, eight guides, and seventeen techniques — all under `docs/` and tracked in the repo. Every link above resolves to a written page; nothing is deferred.

*Verified-at: 7c104c2*
