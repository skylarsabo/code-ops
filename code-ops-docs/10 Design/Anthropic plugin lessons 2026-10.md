---
type: design
status: draft
updated: 2026-10-15
tags:
  - design
  - review
  - evals
  - parity
---

# Anthropic plugin lessons

This plan carries four techniques from Anthropic's official plugins into the suite. The source comparison and the grounding facts are in the run folder `code-ops-docs/80 Runs/2026-10-15-anthropic-compare/` (`SYNTHESIS.md`, `GROUNDING.md`). A judge panel produced three independent plans (risk-first, value-first, parity-first), and a claim-checker refuted the claims of each one. This plan merges the plans that survived and drops the claims that were refuted. The refuter of the value-first plan returned no structured output, so that plan was checked only by the lead.

## Correction to the comparison

The comparison ranked `allowed-tools` as the largest gap. That is wrong. The Claude Code skills reference says `allowed-tools` grants permission for the listed tools and "does not restrict which tools are available" (code.claude.com/docs/en/skills, checked 2026-10-15). If we add it to a read-only skill, the skill gets more permission, not less. The key that restricts is `disallowed-tools`, which removes tools while the skill is active. Phase 5 uses it, and only where it can hold.

## Order and dependencies

Two chains are independent and can run in parallel. Each phase is one atomic PR.

- Chain A (review quality): P1, then P2, then P3.
- Chain B (frontmatter): P4, then P5.
- P6 (trigger measurement) waits for `eng/bench-runner` to merge and for bench pilot P-1 to finish.
- P7 is a decision note only.

## Every phase

- Run the gate chain in AGENTS.md. Regenerate the derived dists with `node scripts/build-codex-marketplace.mjs` and `node scripts/build-opencode-dist.mjs`. The `--check` form alone fails when a phase edits an agent or skill.
- A phase that edits `plugins/<name>/` goes through `integrate-branch.mjs --bump <plugin>:<level> --changelog <plugin>=<file>`. It bumps `.claude-plugin/marketplace.json`, stamps the atlas, and syncs the docs manifest.
- A phase that edits only root `scripts/` or `evals/` and touches no `RUNTIME_SCRIPTS` entry needs no plugin bump.
- Each new `evals/<name>/run.mjs` gets a literal step in `.github/workflows/validate.yml`. Lint check 18 (`scripts/lint-plugins.mjs:1159-1175`) fails closed otherwise.

## P1. False-positive classes in refuter briefs

Goal: reviewers and refuters drop the false-positive classes that the official security plugins name.

- Add one new bullet to each static reviewer and refuter: `plugins/code-ops-suite/agents/reviewer.md`, `plugins/researcher/agents/claim-checker.md`, and `plugins/rigor/agents/tracer.md`. The tracer is a refuter too (Refutation mode, `tracer.md:24`). The bullet names these classes:
  - The defect predates the change under review (diff reviews only). Report it apart as pre-existing, never as a blocker.
  - A security finding crosses no privilege or trust boundary. This class applies to security findings only, because a correctness bug needs no boundary.
  - The harm needs production use, but the code is throwaway: a test, a fixture, an example, or a one-off script.
  - The case is handled elsewhere, or intentional.
  Each class needs a cited line that shows it applies.
- `plugins/rigor/agents/verifier.md` gets no bullet. Its proof is an executed repro, and a class must not override an observed failure.
- Do not touch any pinned span (lint check 14) or the `model:` line.
- Bumps: code-ops-suite, rigor, and researcher, all patch.
- Done when: the gates pass, the three agents name the classes, the verifier is unchanged,, and the pinned spans are unchanged.

## P2. Refutation tally script

Goal: a script, not a model, decides whether a finding survives refutation.

- New script `scripts/refutation-tally.mjs`, Node builtins only. Input: JSON votes for one finding, one vote per lens (reachability, impact, defenses). Each vote uses the existing vocabulary, SURVIVED or REFUTED (`reviewer.md:37`, `tracer.md:38`). Rules:
  - A missing or malformed vote counts as REFUTED.
  - A finding survives on 2 of 3 SURVIVED votes. Otherwise it drops, or falls to SPECULATIVE when the skill keeps unproven items.
  - A CONFIRMED input passes through unchanged and is marked as a bypass. CONFIRMED comes only from an executed repro (`rigor:verifier`, `run-proof.mjs` receipt), so a panel never grants or removes it.
  - For any other input, the cap is PROBABLE on 3 of 3 SURVIVED votes and SPECULATIVE on 2 of 3. The output tier is the lower of the input tier and the cap, so survival never raises a tier.
  - Severity can only go down. The output severity is the lower median of the severities in the SURVIVED votes.
  - Findings with the same file, line, and class merge before the tally.
- Register the script in `scripts/SCRIPT_DOMAINS.json` (lint check 6).
- New eval `evals/refutation-tally/run.mjs` with fixtures for each rule above, plus one that a panel cannot produce CONFIRMED. Add it to `validate.yml`.
- No plugin bump. The script is not vendored yet.
- Done when: the eval passes in CI.

## P3. Wire the tally into audit and review

Goal: replace the prose tallies with the script.

- Call the script from the synthesis step in `plugins/code-ops-suite/skills/codebase-audit/SKILL.md` (`:41-44`, "majority-refuted") and from the refutation step in `plugins/rigor/skills/deep-review/SKILL.md` (`:72-76`). Use `${CLAUDE_PLUGIN_ROOT}/scripts/refutation-tally.mjs` (the Grok compat eval checks this form).
- Each lens gets its own refuter dispatch. The tally runs only on findings that have no cheap repro. A finding with a repro goes to `rigor:verifier`, as it does now.
- Add the script to `RUNTIME_SCRIPTS` for code-ops-suite and rigor (`scripts/vendored-manifest.mjs`). Re-copy it with the pre-commit sync (lint check 6).
- Keep each skill edit under the 40-word copy limit (lint check 7).
- Later candidates: the `plugins/code-ops-suite/skills/security-privacy-audit/SKILL.md` validator and `plugins/researcher/skills/research-verify/SKILL.md`. Each is a separate follow-up after P3 shows a measured effect.
- Bumps: code-ops-suite and rigor, minor.
- Done when: the gates pass, the vendored copies are byte-identical, the Codex output has no leaked plugin-root token (`evals/codex-marketplace/run.mjs:39`), and one bug-garden or trap-garden fixture run shows the tally drops a planted false positive.

## P4. Fail-closed frontmatter key allow-list

Goal: no SKILL.md key reaches a host by accident.

- New lint check 33 in `scripts/lint-plugins.mjs`, beside the frontmatter checks at `:268-311`. It fails when a SKILL.md key is outside an allow-list. Start with the keys used today (`description`) plus the keys that P5 adds. Add the check to the header list (`:10-114`) and to the fixtures in `evals/lint-plugins/run.mjs`.
- Replace the Codex deny-list at `scripts/build-codex-marketplace.mjs:211` with a per-host emit list. Codex keeps only `description` and tool-neutral keys. The lint allow-list and the Codex emit list are separate lists. The OpenCode build already emits only `name` and `description` (`scripts/build-opencode-dist.mjs:175-195`). Make the filter key-aware so a multi-line value does not lose its continuation lines.
- Add an assertion to `evals/codex-marketplace/run.mjs` that no Claude-only key reaches the Codex output.
- No plugin bump (root scripts and evals only).
- Done when: lint passes on all 60 skills, a fixture with an unknown key fails, and the Codex eval rejects a Claude-only key.

## P5. `disallowed-tools` where it can hold

Goal: enforce read-only on Claude for the skills that write nothing.

- First classify every skill with a script, not a prose grep. The question: does the skill write any file (run artifacts in `code-ops-docs/80 Runs/`, registers, docs)? `disallowed-tools` cannot scope a write to one folder, so a skill that writes any artifact keeps Write.
- For a skill that writes nothing, set `disallowed-tools: Edit, NotebookEdit` (and Write where the skill writes no file). Bash stays, because the skills run read-only probes. Record this residual in the skill's CHANGELOG entry.
- A skill that writes artifacts only gets `Edit` and `NotebookEdit` removed. That protects source files and still allows a new artifact.
- `disallowed-tools` is outside the portable subset (claude.ai and the Skills API accept only `name`, `description`, `license`, `compatibility`, `metadata`, and `allowed-tools`). P4's emit lists strip it from Codex and OpenCode. Document that plugin skills target Claude Code, not claude.ai.
- Pilot on one skill (`plugins/researcher/skills/research-verify/SKILL.md`) with a local probe: invoke the skill and confirm Edit is not available. Then roll out in one PR per plugin.
- Bumps: one minor bump per plugin.
- Done when: the classifier output matches the declared set, and the pilot probe is recorded in the run folder.

## P6. Skill trigger measurement

Goal: measure whether the right skill fires for a query and its siblings stay quiet.

Prerequisites: `eng/bench-runner` is merged, and bench pilot P-1 (does `--bare` drop plugin agents, `evals/bench/bench.mjs:32-33`) has a recorded result.

- Export `spawnUnit` and `unitEnv` from `evals/bench/lib/runner.mjs` (`:185`, `:205`). Fix the `.cmd` shim spawn on win32 (`:208`), after checking what `claudeBin` returns (`:103-107`). Keep the `unitEnv` match case-insensitive and keep the bare-prefix match (`:189`), because win32 env keys are case-insensitive and `CLAUDECODE` has no underscore. Narrowing it would weaken isolation.
- New harness, split as bench is split:
  - `evals/trigger/trigger.mjs` is the local, model-in-the-loop runner. It is never a merge gate.
  - `evals/trigger/run.mjs` is the deterministic CI eval of the harness logic (query-set parsing, stream-json trigger detection on recorded transcripts, scoring). It goes in `validate.yml`.
- Detection: read the stream-json, stop at the first `Skill` tool_use, and record the skill id. Stopping early keeps a non-trigger query from costing a full turn. Load all four plugins with one `--plugin-dir` each, so siblings compete. Use the installed skill, not a synthetic command file as skill-creator does.
- Method, taken from skill-creator:
  - About 20 queries per skill, half near-miss negatives drawn from sibling skills.
  - 3 runs per query.
  - A stratified held-out split. Optimize descriptions against the train half, and judge them on the test half only.
  - Each unit is capped with `--max-budget-usd`.
- Pilot: measure the cost of one 60-session evaluation before any loop. Report the cost per skill.
- Output: a trigger table per skill (hit rate, false fires by sibling) in the run folder. Description edits go through the normal skill PR path, with the 160-char lint cap.
- Done when: the CI eval passes, and the pilot table for one plugin is recorded with its cost.

## P7. `claude plugin eval` stays a cross-check

Decision note only. Add a section to [Beat the bare model benchmark 2026-10](Beat%20the%20bare%20model%20benchmark%202026-10.md). Its with/without ablation duplicates the bench skill and control arms, and its LLM judges are advisory. It may run locally to cross-check a bench result. It never enters CI.

## Dropped

- Narrowing the dispatch-guard matcher. The guard counts subagent rounds on every tool (`dispatch-guard.mjs:759`, `:1563`). A matcher would break the round budget. The only open lever is per-call spawn cost. Measure it before any change.
- Adding `allowed-tools` to restrict skills. It grants tools and does not restrict them (see the correction).
- Claude-only components (workflows, monitors, function hooks, `userConfig`, `${CLAUDE_PLUGIN_DATA}`), until a parity design exists for each.
- Porting official Python or TypeScript code. The zero-dependency rule bars it, so we take the techniques only.

## Decisions

- P5: a skill that writes run artifacts keeps Write and loses Edit and NotebookEdit. Moving the writes into a dispatched operative gives no real protection, because that operative also needs Write, and it adds one subagent context to every artifact write. The residual risk is that Write can overwrite an existing source file. A later path-scoped check (a PreToolUse rule that allows Write only under `80 Runs/` for these skills) closes it, as a follow-up after P5.
- P6: the harness reports the trigger table, and the lead edits descriptions by hand through the normal skill PR. An automatic optimizer overfits about 20 queries per skill, tunes one skill while its siblings compete for the same queries, and costs up to 300 sessions per loop. After the pilot cost is known, the harness may propose candidate descriptions, but it never applies them.
