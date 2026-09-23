---
description: "Use to assess and repair a repo's standards contract, vault, atlas, and doc drift, or with scope global to align the user-wide Claude or Codex contract."
---

# Conform: assess and repair every standardization surface

**Invoked as `/code-ops-suite:conform`.** First read §1, §2, §3, §4, §7, §12, §13, and §14 of the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`
bundled with this plugin: the operating model (`§1`), tools and in-house docs lookup (`§2`), the
interaction protocol (`§3`), the safety rails (`§4`), the evidence tiers (`§7`), the
single-source-of-truth conventions (`§12`) that decide where this run's artifacts land, the doc
standard (`§13`), and the writing standard (`§14`).
Leave the rest of that file unread.
**Scope:** repo (default) or global · **Mode:** ASSESS, then DOCUMENT · **Consumes:** the target repo plus whatever standardization
artifacts it already carries, or a `FLEET.json` naming several repos, which turns on fleet mode
below · **Produces:** `CONFORMANCE_REPORT.md`, plus the repairs the developer approves. In global
scope it produces the host-specific global contracts instead (see "Global scope" below).

One question drives this skill: is this repo on the code-ops standard at all, and how far out is
it? Nothing else answers that question. Each surface has its own skill and its own checker, so a
repo can pass one and fail three, and no one finds out until a run needs the missing artifact.

## Scope selection

- **Repo scope** (the default) runs Phases A to C below over one repo, or over a fleet. Surface 1 is repaired by the repo contract procedure in this skill.
- **Global scope** runs only the "Global scope" section below, over the user-wide contracts. Choose it when the user names it, or when the developer approves surface 5 during a repo run. A repo run never enters it without that approval.

## The doctrine

- **This skill composes, and never reimplements.** Delegate every repair to the skill that owns the surface. A repair written here would be a second implementation that drifts from the first. The two contract surfaces are the exception: this skill owns them, through the "Repo contract procedure" and "Global scope" sections below.
- **Checkers decide conformance, not readings.** A surface is conformant when its checker exits 0. A prose judgment that a vault looks fine is not a result.
- **Assess-only is a legitimate terminal mode.** Stopping after Phase A with the report in hand is a complete run. Answering how far out of conformance a repo sits has value even when nobody repairs it today.
- **The report re-runs every mechanical check at the end,** so the closing state is measured rather than inferred from what the repairs claimed.

## Phase A: the assessment, read-only  *(checkpoint)*

Take no write action in this phase. Walk the surfaces in the order of the table below, which is
their dependency order: the contract routes agents to the vault, the vault holds run artifacts,
and doc alignment reconciles what the first three surfaces reference.

| # | Surface | Mechanical check | Repair route |
| --- | --- | --- | --- |
| 1 | Repo standards contract | The contract pair exists, matches one accepted parity mode (byte-identical, or a pointer file naming the contract as required reading), and carries the routing section | The repo contract procedure below |
| 2 | Documentation hub | `<repo>-docs/` exists; vault and manifest checks exit 0; manifest-v2 collections also pass `records check` | `/code-ops-suite:vault` in the mode Phase B detects |
| 3 | Atlas | `<repo>-docs/98 System/Atlas/` exists (fallback `atlas/`), its manifest parses, and `node ${CLAUDE_PLUGIN_ROOT}/scripts/atlas-check.mjs check --atlas <atlas dir>` reports each section FRESH or STALE | `/code-ops-suite:atlas` |
| 4 | Doc alignment | Only when surfaces 1-3 surfaced drift signals: a contract, vault note, or repo doc referencing something the others contradict or no longer carry | `/code-ops-suite:doc-alignment` |
| 5 | Global contract *(optional, ask first)* | The user's global contracts (`~/.claude/CLAUDE.md`, `~/.claude/AGENTS.md`, `~/.codex/AGENTS.md`, `~/.grok/rules/code-ops-global.md`) match current marketplace doctrine, and `<marketplace>/scripts/sync-global.mjs --check` exits 0 | `/code-ops-suite:conform` in global scope |

Record each surface as CONFORMANT, DRIFTED, or ABSENT, with the checker output that decided it.
A surface whose checker could not run is UNKNOWN, never CONFORMANT, because a check that did not
execute proves nothing (`§7`).

Write those verdicts as the per-surface table row of the `CONFORMANCE_REPORT.md` grammar in
`${CLAUDE_PLUGIN_ROOT}/reference/artifact-grammars.md`, carrying the surface, the
verdict, the checker command, and the evidence pointer. `calibration-metrics.mjs` reads that
shape back, so a report written in prose instead makes this run's drift invisible to the trend
rather than merely awkward to read.

Surface 4 stays off unless the assessment produced a drift signal. Doc alignment is expensive,
and running it on a repo with no drift spends a full pass to learn what the first three checks
already reported.

Surface 5 is off by default and is never assessed without asking. The global file is user-scope,
so it governs every other repo on the machine, and a repo-scoped run has no mandate over it.

Write `CONFORMANCE_REPORT.md` to the vault's `80 Runs/YYYY-MM-DD slug/` when the repo carries a
vault, and to the repo's dated-docs convention when it does not (`§12`). A repo that fails
surface 2 has no vault to write into, so the report lands under the dated-docs convention and
says so.

> **CHECKPOINT:** present the per-surface verdicts worst-first, the repair route each one calls for, and the cost of each. Then ask whether to stop here or run Phase B, and which surfaces Phase B covers.

## Phase B: the repairs, one surface at a time

Run only the approved surfaces, in table order, and delegate each to its own skill (surface 1 runs the repo contract procedure below). Hand the
delegated skill the assessment it needs rather than making it re-derive the state: the parity
mode and vault path for surface 1, the vault mode and manifest version and collection verdicts
for surface 2, the STALE section list for surface 3, and the drift signals for surface 4.

**Checkpoint between surfaces.** Repairing the contract changes what the vault check reads, and
repairing the vault changes what doc alignment reconciles, so each surface starts from the state
the previous one left. Report what the last surface changed, then confirm the next.

Escalate rather than improvise. When a delegated skill stops at its own checkpoint with a
question, pass that question to the developer unchanged. This skill never answers it on their
behalf.

## Phase C: the proof

Re-run every mechanical check in the table, including the ones that already passed in Phase A.
Re-write `CONFORMANCE_REPORT.md` with the closing verdicts. The file keeps one row per surface,
updated in place, with the Phase A verdict noted in that row's evidence cell. Never write a
second row per surface, which the grammar counts as unparseable. A repair that reports success
but leaves its checker failing is a failed repair, and only the re-run distinguishes the two.
List anything still DRIFTED or ABSENT with the reason it was deferred.

## Fleet mode: many repos, one standard

Fleet mode turns on when the run is handed a `FLEET.json`, or when one sits at the invocation
root. `${CLAUDE_PLUGIN_ROOT}/reference/fleet-standard.md` defines the layout, the
manifest schema, and the consent rule. Everything above still holds. A fleet run is the per-repo
run performed member by member, under one report.

**Consent decides who is in.** The manifest names a repo, and the repo consents by carrying the
phrase `fleet member: yes` on a line of its own, in a `## Fleet` section of its own standards
contract. A repo that only discusses the phrase, fenced as an example or quoted inline in a
written refusal, has not consented. The parsing rules in
`${CLAUDE_PLUGIN_ROOT}/reference/fleet-standard.md` are the specification of that
format. Where a markdown renderer displays a contract differently, the specification governs
enrollment, and the divergence is a documentation issue rather than a checker bug. Three rules
follow, and none of them bends:

- A named repo that has not consented is reported as `named, not consenting` and is never operated on. That row is the evidence for skipping it. Announce the skip and move on.
- A consenting repo the manifest does not name is invisible to this run. A consent phrase is an offer, not an enrollment.
- **This skill never edits a member's consent.** Consent is per-repo and revocable by editing the contract, so a run that could write the phrase it then reads would have a formality instead of a rule. The `## Fleet` section stays out of scope for every repair below, including a doctrine propagation that rewrites the rest of the contract.

**Phase A, fleet.** Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/check-fleet.mjs <FLEET.json>` and
present its output as the per-member surface table. The checker already writes grammar-(d) rows,
one per member per surface, with the member's slug on the surface cell. The table therefore goes
into `CONFORMANCE_REPORT.md` as it stands, and the calibration snapshot ingests a fleet run with
no change. Do not re-run the per-repo checks by hand. The checker is what decides conformance
here, exactly as it does for one repo.

**Phase B, fleet.** Repair member by member, worst-first, with a checkpoint between members.
Delegate each member's repair the same way a single-repo repair is delegated: to the skill that
owns the surface, run inside that member, and handed the assessment rather than made to re-derive
it. Never repair two members in one step, because a member's own checker output is what proves
its repair landed.

**Doctrine propagation is the canonical use.** When a source of truth moves in this marketplace,
whether a new `Standard.md` body, a changed routing section, or a new contract clause, a fleet
run is how the change reaches the repos that agreed to receive it. Carry the new text to each
consenting member as an ordinary reviewed change in that member, then re-run the checker there.
List a member that ends the run still drifted with its reason, and never leave it quietly
conformant on paper.

**Phase C, fleet.** Re-run `check-fleet.mjs` over the whole manifest and re-write the report with
the closing rows. A non-zero exit names the members still failing. A zero exit with
`named, not consenting` rows present is a complete, successful run over a smaller fleet than the
manifest lists.

## Repo contract procedure: surface 1

This procedure repairs surface 1 in Phase B. Keep a repo's standards contract (`CLAUDE.md`)
**mechanically kept, not aspirational.** Every command it states runs. Every gate it claims
exists really gates. Every citation still points at real code. **Code and CI are ground truth.**
The contract serves the next operator, human or agent, who reads it cold and trusts it. In
MAINTAIN mode the procedure also produces a drift report at a checkpoint.

### Contract Phase 0: the mode  *(checkpoint)*

Check for an existing `CLAUDE.md`. Pick **BOOTSTRAP** when the file is absent, or present but
failing a quick audit: commands that do not run, no real gate chain, citations that do not
resolve. Pick **MAINTAIN** when the file is present and broadly sound. Confirm the mode with
the developer before proceeding, and state which mode and why.

### Contract Phase 1: BOOTSTRAP, for no contract or one that failed the audit

Dispatch an explorer operative to audit the repo first, verifying everything rather than
inferring it from filenames:
- **Real build, test, lint, and gate commands.** Run them read-only where safe, or cite the CI workflow `file:line` that defines them. Never invent a command that "should" exist.
- **Architecture worth 3-5 lines.** Capture the shape a senior engineer needs before touching the repo, not a restated file tree.
- **Non-obvious gotchas.** Capture the things that bite a newcomer: a lint trap, a derived-artifact directory, an ordering requirement. Verify each one rather than guessing.
- **Doc-lifecycle rules.** Capture what is generated against what is hand-authored, what regenerates what, and any local-only or gitignored doc locations.

Then write `CLAUDE.md` in the house style of Contract Phase 3.

### Contract Phase 2: MAINTAIN, for an existing contract

Verify every claim against reality:
- Every command still exists and runs, or still resolves to the CI step it claims to mirror.
- The gate chain still mirrors CI step for step. No step was added to CI and left out here, and no step here was dropped from CI.
- Every enforcement claim is truthful. A claimed gate actually gates and names its mechanism, or it is honestly marked aspirational.
- Every `line N` citation is still accurate. **Sweep the citations mechanically:** grep the cited line and diff its content against what the sentence claims. Do not eyeball this by skimming, because stale line citations are exactly what a skim misses.
- Every cited path still exists.

Fix the drift you find. Never silently accept a claim that no longer holds. Report every drift
item found, naming what was stale and what changed. The report is a deliverable, not incidental
output.

### Contract Phase 3: the house style, the deliverable's required shape

Write or update `CLAUDE.md` in this exact section order:
1. **`## Never (no gate will save you)`** comes first. It carries only real, repo-specific rules that have no mechanical backstop. Never invent one to fill the section. When the repo has no such rules, say so or omit the section.
2. **`## Before declaring any change done`** carries the exact verified command chain, mirroring CI step for step. Per convention, note explicitly when a documented convention has **no enforcing gate**, because an unmarked convention reads as enforced when it is not.
3. **Post-edit chores** (derived-artifact regeneration, version bumps, parity updates) follow, when the repo has them.
4. **`## Invariants the gates will catch`** names what lint and CI mechanically enforce, so the reader knows what they cannot get wrong without a tool catching it.
5. **A local-only or gitignored docs note** follows, when the repo has scratch or non-tracked doc locations that doc-alignment and staleness sweeps should skip.
6. **A documentation section** follows, when the repo carries a `<repo>-docs/` Obsidian vault or adopts one in this run. Route the reader to that vault's `Standard.md` routing table for where new design notes, decisions, and run artifacts go, rather than restating the layout here. The vault standard is `${CLAUDE_PLUGIN_ROOT}/reference/vault-standard.md`, and `/code-ops-suite:vault` scaffolds, migrates, and checks one.

**Cross-cutting rules, applied throughout:**
- **Verify every command written.** Run it, or cite the CI or script `file:line` that defines it. Never invent one. When the repo has no build, test, or lint infrastructure for a category, state that honestly rather than filling the gap.
- **Keep enforcement claims truthful.** A gate-enforced claim names its gate. Anything else is plainly marked aspirational.
- **Do not duplicate user-wide doctrine.** Claude reads the global pair under `~/.claude/`;
  Codex reads `~/.codex/AGENTS.md`. Model roles, truthful reporting, token economy, context
  hygiene, and other cross-repo rules stay global. Repository contracts contain only facts,
  commands, gates, and local exceptions.
- **Keep `CLAUDE.md` and `AGENTS.md` in one of two accepted parity modes:** a byte-identical pair, or a pointer pair where one file is the substantive contract and the other is a short file naming it as required reading. Prefer the import form of the pointer pair: `AGENTS.md` holds the contract and `CLAUDE.md` is exactly the line `@AGENTS.md`, which Claude Code expands on load. Grok Build loads both names, so a byte-identical pair puts the contract in its context twice, and the import line does not. Pick one mode and keep it. A pair that has silently drifted into two different contracts is the failure both modes exist to prevent, because each host reads only one of the two names.
- **Make relative dates absolute.** Write "verify by 2026-08-01", never "next month".
- **Keep the prose terse and imperative, the commands copy-paste-ready, and the facts project-specific.** No filler, and no generic engineering advice a competent agent already knows.

## Global scope: the user-wide contracts

**Produces:** the host-specific global contracts at
`~/.claude/CLAUDE.md`, `~/.claude/AGENTS.md`, and `~/.codex/AGENTS.md`, plus the Grok rule
`~/.grok/rules/code-ops-global.md`, and a drift report at the pre-write checkpoint. Their
sources live in the marketplace checkout's `global-contracts/`, and
`<marketplace>/scripts/sync-global.mjs` installs them. `global-contracts/AGENTS.md` feeds the
Claude pair and the Grok rule. `global-contracts/AGENTS.codex.md` feeds Codex. The Claude pair
is byte-identical. The Codex contract may differ by explicit host behavior. Phases A to C above
do not run in this scope.

The repo contract procedure keeps one repo's `CLAUDE.md` truthful.
**This scope keeps the other half of the split honest.** The global file carries cross-repo
doctrine only, and that doctrine drifts every time the marketplace's SSOT pages move. The
marketplace is ground truth. The global file is a cache of it, and a stale cache silently
mis-routes every session in every repo.

### Global Phase 0: the mode and the marketplace HEAD  *(checkpoint)*

Resolve every global target path and the marketplace checkout they cache. The marketplace is
the code-ops repo. Take its path from an existing contract's SSOT pointer, or ask, and call that
checkout root `<marketplace>`. Pick
**BOOTSTRAP** when no host contract exists or none carries suite doctrine. Pick **MAINTAIN**
otherwise. State the mode, all resolved paths, and the marketplace HEAD before going on.

### Global Phase 1: the current-doctrine baseline

Read the SSOT pages themselves. Never restate doctrine from memory or from the global file
under audit. The load-bearing sources, each under the `<marketplace>` checkout Phase 0 resolved:
- `<marketplace>/code-ops-docs/40 Engineering/Handbook/11-standard-operating-mode.md`: the task-type routing table, the tier and effort rule, and the declared exception. This page is the SSOT for all three.
- `<marketplace>/code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md` and the `AGENT_MODEL_FLOORS` map in `<marketplace>/scripts/lint-plugins.mjs`: the lint-enforced floors no tier rule may contradict.
- `<marketplace>/code-ops-docs/40 Engineering/Techniques/writing-standard.md` and each plugin's `CONVENTIONS.md` §7 and §9: the artifact schemas, the evidence bar, and the tier vocabulary the global reporting standard names.
- The traceless-publishing mechanisms behind the version-control rules: name the script or hook that actually checks, not the intention.

Record each baseline claim with the `file:line` it came from. An unanchored baseline claim
cannot be diffed in the next run.

### Global Phase 2: the drift classification

Classify every divergence into exactly one bucket, and report all five:
- **CONTRADICTS:** the global file states a rule the SSOT now states differently. This is the highest severity, because it is worse than silence: sessions follow it. An inverted tier or routing rule belongs here.
- **STALE:** accurate when written, overtaken since. Check the `Verified-at` stamp against the marketplace log for the SSOT paths. A missing stamp means every claim needs manual verification this run.
- **MISSING:** doctrine the SSOT carries that the global file never picked up.
- **REPO-LOCAL:** repo-specific facts that leaked upward into the global file. Those facts do not belong there. Hand each one to a repo-scope run of this skill in the repo that owns it.
- **LOCAL-DOCTRINE:** cross-repo rules the global file already carries that no SSOT page states. Such a rule is not drift and is never pruned, because the file is the only place the rule lives, and deleting it costs the user working doctrine to gain nothing. Keep each one. List it as a candidate to promote into the marketplace, so every repo inherits it instead of one machine holding it alone.

Verify that each cited path and command still resolves. Sweep `line N` citations mechanically
by diffing the cited line's content against what the sentence claims. Do not eyeball them.

### Global Phase 3: the pre-write checkpoint  *(checkpoint)*

The global files govern every repo and every session, so never edit them without approval.
Present the classified drift and the exact proposed edit, then wait. Name every removal
explicitly with the bucket that justifies it. A section the developer never sees named is a
section they never agreed to lose. When the edit removes nothing, say that too. Per §4, take no
action outside the two `global-contracts/` sources and the targets `sync-global.mjs` installs. Settings, hooks, permissions, and
keybindings stay out of scope even when the drift seems to call for them. Say so and stop.

### Global Phase 4: write stable shared doctrine and small host deltas

Write through the marketplace, never in place. Edit `<marketplace>/global-contracts/`, then
run `node <marketplace>/scripts/sync-global.mjs --only contracts` to install the result. When a
home file holds approved edits the sources lack, run the script with `--capture` first, so the
sources start from what the machine runs. The script refuses a target it did not write. Pass
`--force` only when the checkpoint approved discarding that file's edits. It keeps a dated
backup either way.

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
- **Nothing repo-specific.** A build command, a gate chain, a directory layout, or a project gotcha belongs in that repo's `CLAUDE.md`. That rule mirrors the no-duplication rule the repo contract procedure applies from the repo side. Between the two, each fact lives in exactly one place.
- **Promote, do not absorb.** Propose LOCAL-DOCTRINE worth sharing to the marketplace, against the SSOT page that should own it. Preserve its meaning in the global contract until promotion; consolidation may replace repeated prose with one canonical statement.
- **Every rule names its enforcement:** the script, hook, or CI gate that checks it, or an honest aspirational marking.
- **Relative dates become absolute.**
- **Terse imperative prose** at §14's caps, with no generic engineering advice a competent agent already knows.
- **Stamp or report the verification revision.** Put the marketplace commit in the file only when the operator wants revision text loaded in every session. Otherwise record it in the run report.

## Done when

- Every surface carries a verdict backed by named checker output, never a reading.
- The report names its own location and why that location was chosen.
- No surface was repaired outside the developer's approval, and no surface was assessed at user scope without asking.
- Each repair was delegated to the skill that owns it, except surface 1, which ran the repo contract procedure here.
- Every mechanical check was re-run after the repairs, and its closing output recorded.
- Anything left unrepaired is listed with its reason.
- In fleet mode, additionally: every named member carries a consent row, no member was operated on without one reading CONFORMANT, no member's consent section was edited, and the closing report re-runs the fleet checker over the whole manifest.
- In the repo contract procedure: every command in the produced or updated `CLAUDE.md` is verified against reality, either run or CI-cited; the gate chain matches CI; every enforcement claim is truthful, with its gate named or an aspirational marking; no global doctrine is duplicated; every `line N` citation was checked and is correct; and drift found in MAINTAIN mode is listed in the report, never silently fixed without disclosure.
- In global scope, instead of the bullets above:
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
