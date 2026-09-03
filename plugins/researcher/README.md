# researcher

Adaptive, multi-agent workflows for code-grounded research. This repository authors the
package for Claude Code and renders it into a native Codex package. Invoke
`/researcher:<name>` in Claude Code, or name `researcher:<name>` in Codex.

The workflows ground external knowledge in your own code, or in the materials you hand them.
They gather prior art and library capabilities, then propose improvements, design
directions, library choices, and net-new ideas, and hand implementation to the other suites.
They research and propose. They never edit source. Every external request is disclosed,
recorded, and confirmed first (`CONVENTIONS.md`, section A).

**Stance:** local-first, cited, disconfirmed. The most local, most cited, most disconfirmed
answer wins. Every claim names a source and a confidence tier. Web retrieval is opt-in per
run and never silent.

The plugin complements the rest of the marketplace rather than overlapping it.
`code-ops-suite:feature-discovery` mines opportunities from your code, while the researcher
brings in external knowledge and grounds it in your code. `deep-research` is generic web
research, and the researcher composes it for the opt-in web leg while keeping the work
code-grounded. `lib-docs` and `current-docs` give zero-egress dependency documentation, and
the researcher uses them as a primary grounding source.

New to the suite? Read the handbook at `code-ops-docs/40 Engineering/Handbook/` from the
repository root.

## Skills

Invoke a skill with `/researcher:<name>` in Claude Code, or name `researcher:<name>` in
Codex. The model can also route to one through the standard-operating-mode routing card. The
egress checkpoints still gate every run.

**Discover and propose.** These run in DISCOVERY mode and produce registers and briefs,
never code:

- `research-spike`. Given a task or a plan, gather the prior art and the approach options
  with their trade-offs into a cited design brief and a recommendation. It feeds
  `code-ops-suite:feature-implementation`, `code-ops-suite:ship`, and `code-ops-suite:adr`.
- `research-improve`. Ground in your code, then gather external best practices and known
  pitfalls into grounded, ranked improvements in `RESEARCH_FINDINGS.md`. It feeds
  `code-ops-suite:remediation` and `rigor:fix-verified`.
- `research-ideate`. Turn your code, its domain, and opt-in trends into net-new feature and
  direction ideas, each with a feasibility read and a smallest valuable slice, in
  `IDEAS_REGISTER.md`. It feeds `code-ops-suite:feature-discovery` and
  `code-ops-suite:feature-implementation`.
- `ecosystem-watch`. Report what changed in your stack that you should act on: dependency
  updates, CVEs, deprecations, and newly available capabilities. It is schedulable, and it
  composes `code-ops-suite:dependency-upgrade` and `privacy-opsec-suite:supply-chain-trust`.

**Verify and evaluate.** These run in REVIEW mode and produce a verdict, never code:

- `research-verify`. An adversarial claim check. It verifies a claim or a proposed approach
  against the sources and against your code, tiers the verdict, and flags anything
  unsupported or hallucinated. It gates the other skills' output.
- `library-eval`. Answers whether to adopt a library. It compares A against B against
  building it, grounded in your code and the sources, with fit and migration cost, and ends
  in a recommendation. It feeds `code-ops-suite:adr`.

**Orchestrator**

- `research-sweep`. Run the suite end to end as one developer-in-the-loop pipeline, from
  grounding to gathering to verifying to proposing. It surfaces the egress manifest at every
  checkpoint and pauses at each phase boundary.

## Local-first and disclosed egress

Section A of `CONVENTIONS.md` carries the central, non-negotiable constraint every skill
enforces:

- **The default sources are local.** They are the codebase, version-control history,
  installed-dependency documentation through `lib-docs` or the `code-ops-docs` MCP server,
  and the materials you hand the skill. No query leaves the machine for any of them.
- **Web and external retrieval is explicit opt-in per run.** A checkpoint always precedes
  any network egress, and the developer confirms the scope before a single request goes out.
- **Every external request is recorded** in `EGRESS_MANIFEST.md` through
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record ...`, which stores the
  time, the tool, the host, the URL, and the reason.
- **The manifest is a fail-closed gate.**
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate <artifact>` runs before
  publication and enforces that every external claim has both a manifest entry and a
  citation. An un-manifested web citation, or an egress with no entry, fails the check.
- **Every claim is cited and tiered.** Each one names a code `file:line`, an
  installed-dependency document, or an external source with a retrieval record, and carries
  a tier of CONFIRMED, PROBABLE, or SPECULATIVE (`CONVENTIONS.md` section 7). A claim with
  no source is not reported.

## Conventions

`CONVENTIONS.md`, bundled at the plugin root, is the shared backbone. It carries the
research-integrity and egress model (`§A`), the orchestration model and interaction
protocol, the safety rails, the modes, the proposal tracks and schemas, the evidence-tier
and citation discipline, the severity taxonomy, the quality lenses, the hand-off map, and
the register conventions. Each skill references it by section instead of repeating it.

To apply the conventions always, add a pointer in your repository's `CLAUDE.md` to this
plugin's `CONVENTIONS.md`:

> Research in this repository follows the researcher plugin's `CONVENTIONS.md`. Claims are
> cited, by `file:line`, by installed document, or by a manifested external source, and
> tiered. They are grounded in our code and put through a disconfirmation pass. The run is
> local-first with disclosed, fail-closed egress. The researcher proposes rather than
> mutates, and hands off to the implementation suites.

## How the skills chain

The registers are live backlogs and the single source of truth, with stable IDs such as
`RSCH-007` for a finding and `IDEA-012` for an idea. Each skill's hand-off targets are named
in its bullet under Skills above, and `research-verify` gates every skill's output before it
is published or handed off.

`research-sweep` strings the skills together end to end. Before a finding is carried across a
phase boundary or handed off, it is re-confirmed against the current tree. The mechanical
pre-filter is
`node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>`, which
drops or re-tiers anything that no longer holds and stamps each entry with the commit SHA it
was verified against (`CONVENTIONS.md` section 12). The researcher's terminal output is
always a register or a brief, never a diff, and it is concrete enough for the named
implementer to act without re-researching (`CONVENTIONS.md` section 11).

## Loops and automation

- **In-session loop.** Drive a skill to its "Done when" criteria with the built-in `/loop`.
- **Recurring watch.** `ecosystem-watch` is built to be scheduled. Put it on a routine with
  `/schedule` to keep up with dependency updates, CVEs, deprecations, and newly available
  capabilities, and let it open hand-offs into `code-ops-suite:dependency-upgrade` and
  `privacy-opsec-suite:supply-chain-trust`.
- **Guard the egress posture on every pull request.** Any change to the egress surface is
  blocking, whether it is a new outbound path, a weakened disclosure, or an un-manifested
  source. Wire `privacy-opsec-suite:opsec-pr-gate` into CI with the Claude Code action
  pinned to a reviewed commit, through `/install-github-app` and the pasted criteria.
- **Deterministic backstops.** The round trip from `research-manifest.mjs record` to
  `research-manifest.mjs validate` is fail-closed and runs cheaply in CI. An egress with no
  manifest entry, or an un-cited external claim, fails the build. Reserve the
  judgment-heavy skills for the work that needs a model.

## Subagents

- `gatherer`. Read-only, at the light tier. It gathers evidence on one scoped sub-question
  from the codebase, version-control history, and installed-dependency documentation. It
  never edits and never reaches the network.
- `claim-checker`. Read-only, at the mid tier. It tries to refute one claim against the
  actual code and the cited sources, then returns a tiered verdict.

## Context economy

Every operative brief in this plugin reads files, and a large file read whole is the single
largest avoidable cost in a run. Two bundled scripts cut it:

- `node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs context skim <file>` prints a file's outline,
  meaning its imports, symbols, and line counts, so a brief can then read one range instead
  of the whole file.
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/co.mjs <domain> <verb>` is the one entrypoint over
  every bundled script. `research manifest`, `register revalidate`, `run preflight`,
  `docs lib`, and `context map` all reach a bundled script this way, and the direct paths
  still work.

The suite ships further context mechanisms, on by default, in `code-ops-suite`: a
`PreToolUse` output digest, a `SubagentStart` ladder card, and a symbol index refreshed by a
`PostToolUse` hook. Each is turned off with `off`, `0`, or `false` in the `env` block of a
`.claude/settings.json`. `code-ops-docs/50 Platform/INFRASTRUCTURE.md` owns those switches,
and `code-ops-docs/55 Operations/MEASUREMENTS.md` owns what they measure.

## Notes

- The skills work on any stack. They detect the tooling themselves and ground in the
  repository's existing conventions rather than imposing new ones.
- Optional tools, meaning a documentation-lookup MCP server, version-control history, a
  browser or UI tool, and the opt-in `deep-research` web leg, are used when connected and
  skipped otherwise.
- Secrets, personal data, and real identifiers are redacted everywhere, including in
  evidence. A discovered live secret becomes a critical hand-off finding, naming its
  location and the rotation needed, never the value.
- The plugin pairs with `code-ops-suite` for broad engineering and implementation, with
  `rigor` for proof and verification, and with `privacy-opsec-suite` for the anonymity and
  opsec specialization, which also guards this plugin's egress posture. The researcher
  proposes, and those plugins build.
