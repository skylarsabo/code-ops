---
name: adopt-global-standards
description: "Use when the user's Claude or Codex global standards contract needs to be created, aligned to current doctrine, or re-verified after the marketplace moves."
---

# Adopt global standards: keep the cross-repo contract current

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:adopt-global-standards`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory
for it if needed. It defines the operating model, interaction protocol, safety rails, schemas,
and quality lenses this skill references by section. For this DOCUMENT-mode skill the binding
sections are §2 (tools and in-house docs lookup), §3 (interaction), §4 (safety rails), §12
(SSOT and registers), §13 (doc standard), and §14 (writing standard). Read those six. The
fan-out and fix machinery (§1, §5 to §8, §11) does not apply here. Leave the rest of that file unread.
**Mode:** DOCUMENT · **Produces:** the host-specific global contracts at
`~/.claude/CLAUDE.md`, `~/.claude/AGENTS.md`, and `~/.codex/AGENTS.md`, written or updated
in place, plus a drift report at the pre-write checkpoint. The Claude pair is byte-identical.
The Codex contract may differ by explicit host behavior.

The repo-level counterpart is `adopt-standards`, which keeps one repo's `CLAUDE.md` truthful.
**This skill keeps the other half of the split honest.** The global file carries cross-repo
doctrine only, and that doctrine drifts every time the marketplace's SSOT pages move. The
marketplace is ground truth. The global file is a cache of it, and a stale cache silently
mis-routes every session in every repo.

## Phase 0: the mode and the marketplace HEAD  *(checkpoint)*

Resolve all three global paths and the marketplace checkout they cache. The marketplace is
the code-ops repo. Take its path from an existing contract's SSOT pointer, or ask, and call that
checkout root `<marketplace>`. Pick
**BOOTSTRAP** when no host contract exists or none carries suite doctrine. Pick **MAINTAIN**
otherwise. State the mode, all resolved paths, and the marketplace HEAD before going on.

## Phase 1: the current-doctrine baseline

Read the SSOT pages themselves. Never restate doctrine from memory or from the global file
under audit. The load-bearing sources, each under the `<marketplace>` checkout Phase 0 resolved:
- `<marketplace>/code-ops-docs/40 Engineering/Handbook/11-standard-operating-mode.md`: the task-type routing table, the tier and effort rule, and the declared exception. This page is the SSOT for all three.
- `<marketplace>/code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md` and the `AGENT_MODEL_FLOORS` map in `<marketplace>/scripts/lint-plugins.mjs`: the lint-enforced floors no tier rule may contradict.
- `<marketplace>/code-ops-docs/40 Engineering/Techniques/writing-standard.md` and each plugin's `CONVENTIONS.md` §7 and §9: the artifact schemas, the evidence bar, and the tier vocabulary the global reporting standard names.
- The traceless-publishing mechanisms behind the version-control rules: name the script or hook that actually checks, not the intention.

Record each baseline claim with the `file:line` it came from. An unanchored baseline claim
cannot be diffed in the next run.

## Phase 2: the drift classification

Classify every divergence into exactly one bucket, and report all five:
- **CONTRADICTS:** the global file states a rule the SSOT now states differently. This is the highest severity, because it is worse than silence: sessions follow it. An inverted tier or routing rule belongs here.
- **STALE:** accurate when written, overtaken since. Check the `Verified-at` stamp against the marketplace log for the SSOT paths. A missing stamp means every claim needs manual verification this run.
- **MISSING:** doctrine the SSOT carries that the global file never picked up.
- **REPO-LOCAL:** repo-specific facts that leaked upward into the global file. Those facts do not belong there. Hand each one to `adopt-standards` for the repo that owns it.
- **LOCAL-DOCTRINE:** cross-repo rules the global file already carries that no SSOT page states. Such a rule is not drift and is never pruned, because the file is the only place the rule lives, and deleting it costs the user working doctrine to gain nothing. Keep each one. List it as a candidate to promote into the marketplace, so every repo inherits it instead of one machine holding it alone.

Verify that each cited path and command still resolves. Sweep `line N` citations mechanically
by diffing the cited line's content against what the sentence claims. Do not eyeball them.

## Phase 3: the pre-write checkpoint  *(checkpoint)*

The global files govern every repo and every session, so never edit them without approval.
Present the classified drift and the exact proposed edit, then wait. Name every removal
explicitly with the bucket that justifies it. A section the developer never sees named is a
section they never agreed to lose. When the edit removes nothing, say that too. Per §4, take no
action outside the three named global contract paths. Settings, hooks, permissions, and
keybindings stay out of scope even when the drift seems to call for them. Say so and stop.

## Phase 4: write stable shared doctrine and small host deltas

Preserve every surviving rule's meaning, not its old prose. Consolidate repeated rules and
replace detail with an SSOT pointer when the session can resolve it. Do not copy a routing
table, schema, price, context limit, or transient model capability into every prompt. Keep
the stable provider-neutral core small: task ownership, authority, routing policy, evidence,
verification, context continuity, and publishing safety.

Add only behavior that the active host needs. The Claude pair may name Fable behavior such
as adaptive effort, append-only thinking blocks, and stable-prefix use. The Codex contract
may name Astra behavior such as action bias, explicit delegation, concise output, and
proportionate testing. Keep provider API mechanics in runtime adapters and documentation,
not in prompt doctrine. Never require the Claude and Codex global contracts to be identical.

**Cross-cutting rules, applied throughout:**
- **Nothing repo-specific.** A build command, a gate chain, a directory layout, or a project gotcha belongs in that repo's `CLAUDE.md`. That rule mirrors the no-duplication rule `adopt-standards` applies from the repo side. Between the two, each fact lives in exactly one place.
- **Promote, do not absorb.** Propose LOCAL-DOCTRINE worth sharing to the marketplace, against the SSOT page that should own it. Preserve its meaning in the global contract until promotion; consolidation may replace repeated prose with one canonical statement.
- **Every rule names its enforcement:** the script, hook, or CI gate that checks it, or an honest aspirational marking.
- **Relative dates become absolute.**
- **Terse imperative prose** at §14's caps, with no generic engineering advice a competent agent already knows.
- **Stamp or report the verification revision.** Put the marketplace commit in the file only when the operator wants revision text loaded in every session. Otherwise record it in the run report.

## Done when

- The mode, all global paths, and the verified-against marketplace commit were stated.
- Every baseline claim was read from the SSOT and anchored to `file:line`.
- Every divergence is classified CONTRADICTS, STALE, MISSING, REPO-LOCAL, or LOCAL-DOCTRINE and reported, never silently fixed.
- Every removal was named with its bucket at the checkpoint, and the developer approved the edit before any write.
- No surviving rule lost its meaning during consolidation.
- Each LOCAL-DOCTRINE rule was kept and listed as a promotion candidate.
- The written files contain no repo-specific facts and no unenforced rule left unmarked.
- The Claude pair is byte-identical, and the Codex contract contains only deliberate host deltas.
- Every citation and command in the written file resolves.
- The run reports the marketplace commit, and any requested in-file stamp matches it.
