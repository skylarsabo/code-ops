# Changelog — code-ops-suite

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.


## 1.91.1
- The context-size reader returns unknown when a compaction marker (a Claude `compact_boundary` row or a Codex `compacted` row) is newer than the last usage record. The handoff-card nudge no longer reports the pre-compaction size on the first prompt after `/compact`, and the dispatch guard no longer gates on it. The first post-compaction usage record is read as before and re-arms the handoff band.

## 1.91.0
- **TODO** — describe the change.

## 1.91.0
- The session model leads. A run contract records the lead model, tier, and effort; a lead below strong prints a warning, and every operative floor still holds. Convention §1 and the routing card follow the same rule.
- The suite ships `mech` for exact edits and gate runs, and `mech-review` for checking a mechanical diff against its spec, both at the sonnet floor. Every agent carries a `## Contract` section with the brief fields it requires, its edit class, its verdict tokens, and a return example that lint checks.
- Each skill reads only the CONVENTIONS sections it cites, plus the writing standard. Exploring skills consult the atlas and the symbol index first, and the index skips vendored script copies.
- The context ceiling defaults to 200,000 tokens on Grok and 300,000 elsewhere. The round stop keys on the Grok child session. `modelClassOf` places `gpt-6-sol` as frontier. The OpenCode chooser lets a specialist row set a tier only when no ladder row binds the model.
- `co handoff draft` summarizes dirty paths by directory and lists at most 20 hand-authored paths.
- CI type-checks opted-in scripts with TypeScript 7.0.2 under `strict`. The code standard names TypeScript 7 as the TypeScript floor.

## 1.90.0
- The OpenCode distribution ships a model ladder for a metered GitHub provider, with a starter profile and per-model prices. The lifecycle chooser ranks candidates by measured cost first, then by priced workload cost, then by name pattern. The cost report prices cache writes.
- `co handoff draft` writes a handoff note with the mechanical facts filled and `[FILL: ...]` placeholders for judgment. `co handoff resume` runs the redaction scan, register revalidation, runtime status, and handoff check in order. The handoff skill is smaller, opens with the assess step, and adopts a `TASKS.md` convention. The handoff check rejects a note that still carries an unfilled placeholder.
- The dispatch guard reads Grok hook payloads, including camelCase fields and the `spawn_subagent` tool.
- `lib-docs` resolves installed versions for npm, pnpm, yarn, Python, Rust, Go, and .NET from the lockfile first. A miss exits 3 and lists the searched paths.
- The code standard adds a strictness floor that a repository adopts and never lowers, per language. The overbuild scan adds advisory tells for new suppressions, placeholder comments, and emoji in code, and reports net lines. Benchmarks report the median absolute deviation. Convention §11 requires a current-docs lookup before code that depends on a library.

## 1.89.0
- The dispatch guard gates the lead's own dispatch past a context ceiling. At 300,000 tokens of resident context, a new `Agent`, `Task`, or `Workflow` dispatch is denied until `/code-ops-suite:handoff assess` runs. The assessment unlocks dispatch until the next 150,000-token band. `CODE_OPS_CONTEXT_CEILING` takes `off` to disable the gate or an integer of at least 150,000 to move it. A host without a skill tool records the assessment with `dispatch-guard.mjs assessed --session <id> --band <n>`. OpenCode records it from the `skill` tool or the typed handoff command. A 10-day audit found lead turns above 300,000 tokens spending 2.68 billion of 3.69 billion lead input tokens.
- The dispatch guard denies a `general-purpose`, `claude`, `fork`, or unnamed agent type unless the brief carries a `Wide-surface reason:` line. A `Workflow` script whose `agent(` call names no `agentType` is denied the same way. General-purpose operatives carried 29% of the audit's input tokens.
- The unregistered round stop moves from three times to twice the round budget on every host. Reviewers averaged about 90 rounds, under the old 120-round stop.
- `CODE_OPS_DISPATCH_GUARD=warn` turns each deny into an advisory, except a deny for a malformed or unavailable controller binding.
- The handoff nudge adds that new dispatches stay gated once context reaches the ceiling.
- Each agent definition carries a `Report cap: at most N words` line: 600 for `reviewer` and `implementer`, 400 for `explorer`. Lint check 25 fails an agent with no cap or a cap outside 100 to 800 words.
- Run Contract version 4 accepts an optional `orchestration.singleUnitReason` of at most 20 words, which lowers `minOperatives` and `minParallel` to 1. Without it the two-operative floor holds.
- `check-handoff.mjs` prints `same-tree: Verified-at matches HEAD on a clean tree` when the handoff's sha is HEAD and only the handoff file is dirty. A same-tree resume accepts FRESH anchors without re-reading each file. Register revalidation still runs.
- The dispatch brief template gains `Report cap` and `Wide-surface reason` lines. `MEASUREMENTS.md` pre-registers the ceiling gate and wide-type deny against the audit baseline and records the startup-context split with its operator levers.

## 1.88.0
- The session routing card stays a short route list. `full-sweep` reads only the convention sections its opening paragraph names.
- On Grok Build, headless Grok, and the ACP agent, the handoff nudge is a PostToolUse note read from `updates.jsonl`. UserPromptSubmit stdout stays discarded. The session receipt records `handoffCard` from its switch. The handoff skill reads four convention sections instead of the whole file.
- The default ladder now pins Claude Opus 5.5 at strong, GPT-6 Luna at light, GPT-6 Sol at frontier, and Grok 4.7 on every xAI rung. Previous pins and the reseller spellings still satisfy the same floors. Grok Build 0.1 is a light specialist, not a default rung.
- OpenCode ships `plugins/code-ops-lifecycle.js` and `code-ops/cost-report.mjs`. The system cards stay byte-identical across model calls. Handoff, routing, and dispatch notes ride on the next tool result or user turn. The cost ledger is checked with `cost-report.mjs --check`.
- The model-floor gate resolves a tier clone to its base agent and a reseller model by bare id. A model the verified table does not name still fails closed.
- On Grok, where hook stdout is ignored, the lead assesses continue, compact, or hand off at 150,000 tokens and again before 200,000, because Grok 4.7 bills double above that line.

## 1.87.0
- Assess whether to continue, compact, or hand off using task state and observed host capabilities.
- Replace token-band restart instructions with assessment reminders while preserving marker, rearm, and pickup behavior.
- Preserve durable state before transitions, distinguish recommendations from execution, and cover version 3 and 4 runtime recovery.

## 1.86.0
- Bind explicit worker budgets to known agent identities and expose sanitized control receipts while preserving unbound host fallbacks.
- Add task-based routing decisions with role floors, bounded frontier exceptions, selective worker context, and separate cache-charge reporting.

## 1.85.1
- `record-lib.mjs` now parses both path fields in a Git copy record (`C<score>`), matching rename handling. Earlier releases read only the source path. The copy then looked like a source modification. `git log --follow` detects copies. Adding a file at least 50% similar to an adopted immutable record therefore changed its history profile. `records.mjs check` then reported `adoption review history drift`, which repository-side changes could not clear.
- Adoption history profiles ignore copy records. A copy is a plain add of its destination, which the exact-path pass already reports, and it never joins the lineage of its source.
- Reviews from releases through 1.85.0 can store the old reading. This mostly affects empty files, which Git reports as `C100` copy chains. `records.mjs check` accepts such a review only when it equals the old reading exactly. The bound includes only copies in commits reachable from the review's `sourceHead`. A later copy cannot drift the source. Other mismatches still fail, and `adoptionHistory` is exported so both readings share one history pass.

## 1.85.0
- The `SessionStart` routing card ends a fresh session with one line naming the newest pending handoff: the file, the date it was written, and the direction to resume from it, verify its claims, and open the reply with a five-heading recap. Discovery reads two bounded directory levels under each `<repo>-docs/80 Runs/` and the repository's own `80 Runs/`, treats a run folder holding `HANDOFF.consumed` as already picked up, and ignores anything older than 14 days. `CODE_OPS_HANDOFF_PICKUP=off` drops the line and leaves the rest of the card.
- `check-handoff.mjs` requires three more headings — Scope and constraints, Work completed, and Key findings — so the first six sections answer what an operator asks a resumed session. "Goal and state of play" must carry a non-empty `Request:` line holding the operator's original request verbatim, and every Key findings bullet must carry a `CONFIRMED`, `PROBABLE`, or `SPECULATIVE` label. The size cap is 8 KB.
- `check-handoff.mjs --consume` writes `HANDOFF.consumed`, one ISO timestamp line, beside the file and only after every check passes, which retires that handoff from the routing card's pickup line. A write failure is reported rather than swallowed.
- The `handoff` skill writes the sections in resume order, ends the write with a resume line, and directs a resumed session to recap under five headings before other work.
- The handoff card escalates with the band. Band 1 advises a handoff at the next workstream boundary; band 2 and higher asks for the handoff in this session and for no new workstream, because a session at that band already declined the first boundary.
- `hooks/dispatch-guard.mjs` runs at `PreToolUse` and binds the brief's Round budget. Inside a subagent it counts that subagent's tool calls in one append-only file per agent, warns at the budget and every further 20 rounds, and denies further calls at three times it. On the lead's own dispatch it only advises, on a `model` override, a wide-surface or context-inheriting agent type, and a brief naming no Round budget. `CODE_OPS_DISPATCH_GUARD` takes `off` to disable it or `warn` to lift only the hard stop, and `CODE_OPS_ROUND_BUDGET` overrides the 40-round default. It fails open on every other path and never denies a main-thread call.
- Session receipts record two more arms, `handoffPickup` and `dispatchGuard`, each read from its own switch the way the existing arms are. A guard set to `warn` records the arm on, because only the hard stop is lifted.

## 1.84.0
- Every session receipt records the handoff card as an arm, read from `CODE_OPS_HANDOFF_CARD` the way the digest, ladder, and index arms are read. Grok rows record it off, matching the hook's own host coverage.
- A receipt also carries `handoff`: the highest band the session's marker file reached, and whether the transcript shows the operator running `/code-ops-suite:handoff` after the first prompt. A first-prompt command is a resume, and a quoted marker is not a run, so neither counts. Only the two values are stored, never transcript text, and any failure leaves band 0 with the hook still exiting 0.
- The handoff marker keeps a `peak` field, so a re-arm after a compaction lowers the live band without hiding that the session was nudged. `handoffMarkerPath` and `handoffPeakBand` in `transcript-lib.mjs` are the one definition both hooks read.
- `context-audit.mjs receipts --by-arm` groups by the handoff arm too and reports, per arm, how many sessions were nudged and how many of those handed off, which is the ratio the pre-registered decision rule reads. A row written before these fields existed still aggregates and counts in neither figure.

## 1.83.1
- The Codex render states that a role holding an edit tool edits only inside its brief's Scope. It told the `implementer` that it may write only report and repro files, which contradicted the agent's own definition.
- The changelog no longer carries two leftover placeholder bullets from the version bump script, so `integrate-branch.mjs` stops reporting a pending changelog item on a clean tree.

## 1.83.0
- The `implementer` agent ships for build, fix, and refactor units, with tools `Read, Edit, Write, Bash, Grep, Glob` and an `opus` floor in `AGENT_MODEL_FLOORS`. A transcript audit on 2026-09-18 measured general-purpose operatives starting each turn near 57,000 tokens against 18,000 to 24,000 for restricted-tool agents, and those operatives carried 787 million of one day's tokens.
- The conventions, the routing card, and `subagent-trade-offs.md` state that a dispatch costs resident context multiplied by turn count. They route build work to the `implementer`, keep breadth agents at their declared tier, and require a round budget in each brief.
- The dispatch brief template gains a Round budget field, 40 tool rounds unless stated. An operative past its budget checkpoints to its Report path and returns, and the lead continues the unit in a fresh operative.
- The handoff card nudges at 150,000 tokens of resident context and every further 150,000-token band, down from 200,000, because 71% of lead input-side tokens were spent above 200,000. `MEASUREMENTS.md` records the amendment, and the value stays SPECULATIVE.
- `context-audit.mjs` reports context shape per thread, spend by context band, cache rewrites, and subagents by agent type, and `--all` merges every project under the host transcript root.

## 1.82.0
- The OpenCode Zen free ladder binds every operative rung to `muse-spark-1.3-contributor-free`: light, mid, and strong share one model, so no operative dispatch routes below its floor. The lead stays unset and inherits the session model. The rendered `opencode-dist/opencode.json` binds every agent to that model with no top-level `model`. The routing table names the flat operatives beside the flat xAI row.
- The `opencode` provider pin is verified against the host `opencode models` list on 2026-09-17.

## 1.81.0
- `check-handoff.mjs` resolves every `path:line · Anchor:` pointer against the working tree through the resolver it now shares with the register gate in `citation-lib.mjs`, and prints one status per pointer. GONE, DRIFTED, and AMBIGUOUS fail closed. MOVED warns, or fails under `--strict-anchors`. A `Verified-at` sha that is not HEAD is an advisory, and `--root` makes the check independent of the working directory.
- `revalidate-register.mjs` reads the Severity field value alone, so a composite line such as `Severity: medium · Confidence: high` no longer reads as load-bearing and deflated at once. The anchor grammar accepts a doubled-backtick span, so an anchor copied from a line that contains a backtick parses. A backslash is still not an escape.
- The artifact grammar reserves the `LEAD-` prefix for lead-authored findings, and the `full-sweep` merge step says so, because nothing mints ids at merge time and a lead-filed finding collided with a slice id.
- A context snapshot under the `exclude` or `allowlist` untracked policy derives its identity from the files the policy admits, so a new untracked file no longer moves the snapshot id. The receipt still records how many untracked files the tree carries. The default `metadata` policy is unchanged.
- `run-runtime.mjs` requires `context.snapshot`, `context.bundleDir`, and the dispatch ledger to sit on repository-ignored paths, as the capability descriptor and receipt chain already did, and `init` prints an advisory when the contract itself is visible to Git.
- `run-contract.mjs` reports only an identifier mismatch as context snapshot drift. Generator drift, atlas drift, an unsupported untracked entry, a symlink escape, and a git timeout keep their own message and say that a new receipt will not clear them.
- A version 2 or newer contract accepts the optional `context.maxScopeShare`, a number above 0 and at most 1 that raises the 0.25 share of the repository index one unit may hold. The recursive-glob and risky-prefix triggers ignore it, and an oversized bundle still refuses rather than truncating.
- A version 4 contract refuses a refutation panel with an even number of seats, or one that repeats a lens across seats. A single refutation unit on a target is not a panel.
- `atlas-check.mjs` preserves a manifest's own indent and end-of-line on every rewrite, and the atlas skill, the atlas reference, and the calibration protocol tell a run to ignore or relocate the atlas folder on a target whose formatter scans JSON.
- `atlas-check.mjs check` prints an advisory for a sentence that compares two code sites while citing fewer than two of them and counts it in the summary line. No exit code changes. The atlas skill and reference require a comparison to cite both sites so the pair registers as two claims.

## 1.80.0
- `dispatch-ledger.mjs add` accepts `--contract <path> --unit <D-NNN>`. The row takes the contract unit id instead of the next serial id, and its role, model, brief, and artifact must match the unit. Under a version 4 contract, `add` requires `--actor-id`, refuses an actor already bound to another unit, and binds the journal to the contract run. A bound ledger refuses an unbound `add`, and a bound `update --status redispatched` requires an actor.
- `run-contract.mjs reconcile` accepts `--in-flight`. It rejects the version 4 journal violations that are permanent once they occur, and admits planned units that have not reported. `run-runtime.mjs` checkpoint, replan, resume, and verify use it instead of `--strict`, so a multi-wave run can bind a mid-run contract revision. Finalization stays strict.
- Version 4 in-flight and final reconciliation reject a journal add that is not bound to the contract run.
- A replan that skips a revision names the bound and required revisions, and states that bundles pin the contract revision.
- `CONVENTIONS.md` directs version 4 dispatch through `add --contract --unit`.
- The bundled `reference/artifact-grammars.md` states that a version 4 contract-bound `add` records `runId` in the dispatch journal, and that replay rejects a journal mixing bound and unbound adds.
- The vendored `revalidate-register.mjs` reads a register citation whose path carries spaces in unquoted prose, a Location field, a markdown link target, bold, or quotes. The longest space-joined extension that names a real in-root file wins over a shorter tail, so a same-named file elsewhere no longer captures the citation. Escaping, traversal, and dot-segment forms still read AMBIGUOUS.

## 1.79.0
- New `hooks/handoff-card.mjs` runs at `UserPromptSubmit` and is on by default, off with `CODE_OPS_HANDOFF_CARD`. It reads only the transcript tail. When resident context crosses a 200,000-token band, it suggests a handoff once per band and re-arms after compaction. Claude and Codex run it, Grok ignores its output, and OpenCode has no equivalent event. The threshold is pre-registered in `MEASUREMENTS.md` as uncalibrated.
- The `handoff` skill adds three sections. Open items carry an owner and a done-when check, Authority records grants that do not carry into the resumed session, and Carried context points at files that hold conversation-only analysis. A handoff no longer restates git history, and it stays under a 6 KB cap. Resume asks the operator to re-grant authority before publishing.
- New `check-handoff.mjs`, reachable as `co.mjs check handoff`, fails a handoff with a missing section, an item without an owner or done-when check, an imperative item, or a size over the cap.
- `provider-parity-audit` accepts `--since <sha>` to scope a follow-up audit to changed surfaces and their projections, and it carries forward unchanged host profiles.
- The vendored `revalidate-register.mjs` reads a backslash traversal, a backslash drive letter, a traversal before a dot-led or dash-led segment, an in-root symlink to an outside target, and an escaping prefix longer than its scan window as AMBIGUOUS instead of FRESH.

## 1.78.0
- The plugin now bundles six execution specs under `reference/`: artifact grammars, the atlas technique, the calibration protocol, the fleet standard, the subagent trade-offs routing table, and the vault standard. They are byte-identical copies of the hub pages, and both host packages carry them.
- Skills that fill or check those specs read the bundled copy. Other hub pages are linked as documents in the code-ops repository, and target-repository atlas and ADR paths name the `<repo>-docs/` hub.
- `check-vault-standard.mjs` points a stale `Standard.md` at the bundled vault standard. `atlas-check.mjs`, `calibration-metrics.mjs`, `estimate-run-cost.mjs`, `run-proof.mjs`, and `skim.mjs` print plugin-relative paths instead of repository-root commands.
- `provider-parity-audit` declares that it runs in the code-ops repository. `local-review-gate` Track B documents `--matrix` for a matrix tracked in another repository.
- Lint check 24 fails when shipped text names a path that resolves only inside a code-ops checkout, or when a bundled reference drifts from its hub page.

## 1.77.5
- The vendored `revalidate-register.mjs` now reads a citation whose first segment starts with a dot, such as `.github/workflows/validate.yml:1`, as the whole path instead of dropping the dot and reporting AMBIGUOUS.

## 1.77.4
- `run-contract.mjs` now rejects a calibration block whose lead model serves both the strong and frontier rungs, because such an arm runs the frontier model and cannot measure a strong-versus-frontier gap. The error names the model.
- The generated tier page now states that version 4 run contracts require a frontier lead, that a calibration block is the only exception, and that contracts take bare model ids.
- The calibration protocol states that a point release keeps its family class name in the `config:` line while it serves the same rung.

## 1.77.3
- The pinned report-persistence passage now states that a brief's report path governs over any default reporting instruction in an agent definition.
- The `reviewer` and `explorer` bodies name the shell, search, and file-read tools by capability instead of by host tool name.
- The generated role contract header states each role's write capability, derived from the canonical tools list, and the generated compatibility page and README list every bundled hook command with its purpose.
- The `transcript-lib.mjs` and `context-audit.mjs` comments name each host's transcript directory, so the projected copies no longer point at a wrong path.

## 1.77.2
- The repository contract now names the hook event and skill-id form each host uses, and the infrastructure page gives store paths under the host home.
- The `provider-parity-audit` skill drops the repository-root `grok plugin validate` probe, which found no manifest and checked nothing. The per-plugin validations remain.

## 1.77.1
- The `enforce-traceless` hook now blocks an attribution trailer passed as a second `-m` value, a `--message=` or `--trailer` value, or an inline `gh pr create --body`. It runs the vendored `scan-ai-tells.mjs` in its new `--command` mode, which scans the raw command plus each message, trailer, title, body, and field value that `git commit`, `gh pr create|edit|merge`, or `gh api` would publish, each on its own line. Heredoc detection is unchanged, and a trailer phrase outside a published argument still passes.
- The hook header now names its real fail-closed backstop: the new `Traceless publishing (PR commits, title, body)` CI step, which scans every pull request's commits, title, and body.

## 1.77.0
- Version 4 contracts accept an optional `calibration` block for arms (b) and (c) that requires a strong lead, read-mode units, and artifacts outside every scope. Under a valid block, units may run at the lead tier but never above it.

## 1.76.0
- New pinned `CONVENTIONS.md` §15, Code standard. It carries the house code standard's core clause: design every change first, write the smallest correct solution, abstract only on evidence, measure before micro-optimizing, comment reasons, verify in proportion to risk, and never repeat an unchanged check.

## 1.75.0
- An operative with a write tool now writes its report to the path its brief names and returns only a pointer, so the lead no longer re-emits report bodies; a read-only operative still returns its report inline for the lead to persist. `dispatch-ledger.mjs update --status reported` gains `--report` and `--sections`, which refuse a missing, empty, or section-less report file and leave the row and journal unchanged.

## 1.74.1
- `revalidate-register` now reads citations with bracketed route segments such as `[id]` and `[...slug]` and route groups such as `(auth)` as the full path, instead of reporting an in-repo file as escaping root. A register item citation inside backticks may also carry spaces in its path. Refutation receipts now read their cited path and line correctly, so a valid REFUTED receipt passes and a traversal citation still fails confinement.

## 1.74.0
- Substantive runs now use an enforced frontier-lead and strong-operative graph. Version 4 run contracts require multiple operatives, a real parallel wave, lower-tier operative routing, explicit independent-validation relationships, and nonempty operative artifacts before finalization.
- Security campaigns declare distinct exploit families and terminal hypothesis states. The new attack-chain compiler bans history and advisory shortcuts, requires direct implementation evidence and realistic privilege-to-impact closure, traces reverse collisions to terminal nodes, and ranks open chains for independent validation.
- Hook payload adapters accept Claude and Codex command, edit, and session shapes. Codex projections preserve machine-readable agent floors and host-native settings and storage prose, while OpenCode projections translate portable skill references and expose only capabilities backed by its runtime API.
- Provider-parity repairs stop claiming ignored passive-hook output, restore Codex child-rollout accounting, parse Grok usage updates, preserve cross-host standards paths during rendering, and keep read-only operatives within their declared tools. Regression coverage now includes every `co.mjs` domain and the digest hook's context overhead.
- `provider-parity-audit` now covers Claude, Codex, installed Grok, and OpenCode across hooks,
  agents, skills, scripts, settings, manifests, both renderers, generated distributions, and
  documented API gaps. It separates output-shape probes from live external-turn evidence.

## 1.73.0
- Orchestrated runs gain partial acceptance, bounded runtime status, per-unit token envelopes, and attributed model and reasoning-token observations. These controls preserve continuity across compaction and make overruns visible without expanding worker context.
- Context bundles can compile verified unit views, and `worker-brief.mjs` builds deterministic two-part briefs with separate invariant, unit, and total byte limits. It fails instead of truncating, rejects portable path aliases that could overwrite an input, and verifies both source and output hashes before reuse.
- Context auditing normalizes Claude and Codex usage into provider-neutral categories. The cost estimator binds each runtime receipt chain to its finalized contract and can apply a dated operator-supplied price snapshot. It reports only an attributed observed subtotal, never a provider-invoice total, and refuses unrelated model history.
- The Anthropic frontier binding advances to Fable 5.1. Interaction doctrine now favors safe action over unnecessary clarification, while preserving checkpoints for consequential decisions and new authority.
- Global-standard adoption now maintains Claude's byte-identical global pair and Codex's host-specific `AGENTS.md` as separate contracts. It consolidates repeated prose while preserving rule meaning, preventing future refreshes from recreating cross-host drift.

## 1.72.1
- Astra is an explicit premium frontier specialist for bounded architecture, refutation, and cross-domain synthesis. Sol remains the ready-made OpenAI lead, so ordinary runs do not inherit Astra's 2.5-times token price. Shared model capability and rank helpers admit the specialist without misclassifying repeated-rung models during acceptance.
- The Codex renderer caps its projected `SessionEnd` timeout at the desktop host's three-second ceiling while preserving the canonical Claude timeout. A renderer regression pins the host-specific transform.
- Hook documentation distinguishes the intentional traceless-publishing block from the six fail-open hooks and corrects the storage-variable taxonomy.
- The Moonshot light tier advances from the retired `kimi-k2.5` registry id to `kimi-k2.6`; every non-CLI provider pin resolves in the 2026-09-13 models.dev snapshot.

## 1.72.0
- `digest.mjs` passes a short output through raw: an output of at most `--passthrough-below` bytes (default 1536), or one the digest cannot make smaller than the raw bytes, is printed on its own streams with no trailer, no raw file, and no receipt row. `--passthrough-below 0` turns pass-through off and `--json` never passes through. The session measurement of 2026-09-03 found 77 of 84 receipted commands paid more in trailer than they saved, which is what this closes. The digest hook's context line and `evals/digest` pin the new contract.

## 1.71.0
- The plugin README and all 34 skill pages move onto the house writing standard: no em-dashes and no semicolons in prose, one instruction per sentence, active voice, noun-phrase headings, and Done-when sections written as vertical lists rather than semicolon chains. The pinned always-gated clause in `everything` stays byte-identical.
- The pages that touch the context-economy mechanisms now name them and their off switches. The README gains the `co.mjs` entrypoint and `cli-lib.mjs`, `skim.mjs`, the PreCompact preservation hook, and the session receipts with `context-audit.mjs receipts --by-arm` and `--purge-before`. `full-sweep` names `skim.mjs` and `context-query.mjs` at Phase 0, `run-cost-audit` reads the receipt ledger by arm, and `codebase-audit`, `pr-review`, `normalize`, and `ship` name `co.mjs scan overbuild` as the mechanical floor under the size-and-boundary lens.
- The README's code-economy bullet reaches the scan domain through `co.mjs scan overbuild` and `co.mjs scan deferrals` instead of the direct script paths.
- `calibration-run` names the two `lesson:` line shapes as the parser's literal grammar, and writes the handover config line as a class template rather than two model names.
## 1.70.0
- `CONVENTIONS.md`, both agent definitions, and the pinned doctrine sentences rewritten to the house writing standard: no em-dashes and no semicolons in prose, one instruction per sentence, and headings as noun phrases. Meaning is unchanged, and every pinned sentence moved in the linter table, the eval mirror, and every listed copy in one commit. `CONVENTIONS.md` §1 and §2 now name the session mechanisms that are on by default and their off switches, and the stale "opt-in" note on the `index-refresh.mjs` hook in `context-query.mjs` is corrected.
## 1.69.0
- `model-tiers.mjs` gains the `opencode` provider: the OpenCode Zen free ladder (`ling-3.0-flash-fin-free` light, `nemotron-3.5-lightning-free` mid, `mimo-v2.5-free` strong) with the lead unset, and it becomes `DEFAULT_PROVIDER`, so the rendered `opencode-dist/opencode.json` binds every agent to a free model that clears its floor and carries no top-level `model`. The lead inherits the session model and a fresh install costs nothing.
- A provider may leave `frontier` null (`leadInherits`) and declare `registry: 'cli'` with a `verifiedAt` date. The renderer then omits the top-level `model`, MODEL_TIERS.md says the lead is unset, `check-model-registry.mjs` skips the models.dev fetch for that provider, and `evals/opencode-dist` pins the unset lead and the publish-command ask rules on the default config.

## 1.68.0
- `scan-overbuild.mjs` writes its tree-grep patterns with POSIX classes, because `git grep -E` on macOS runs the system regex, which has no `\s`, `\w`, or `\b`, so the single-implementor and duplicate-helper tells matched nothing there. The first macOS host-eval run found it.

## 1.67.0
- `symbol-lib.mjs` is now the single source of the definition rules and the import extraction for all four readers. `repo-map.mjs` takes its definition table from `CODE` and keeps only the Markdown heading row, and `import-graph.mjs` takes both the extraction and the resolution from `imports()` and walks exactly the extensions `IMPORT_EXTS` names. Map and graph output over this repository is byte-identical to the copies it replaces.
- `imports()` covers JavaScript, Python, Go, and Rust, and its edge carries `relative` and `dynamic` beside `spec`, `target`, and `names`. So the graph still separates an unresolved path in the tree from a package name, and still notes a non-literal `import(...)` rather than dropping it, while the index sees the same edges.
- `evals/context-query` gains a Go file and a Rust file whose relative edges `blast` must resolve, pinning the shared extraction from the index side.

## 1.66.0
- The `scan` domain moves onto `cli-lib.mjs`: `scan-ai-tells.mjs`, `scan-narration.mjs`, `scan-redaction.mjs`, `scan-injection-tells.mjs`, `check-autofix-scope.mjs`, `scan-overbuild.mjs`, and `harvest-deferrals.mjs` drop their hand-rolled argv loops for `parseFlags` and `parseOrDie`. Every flag, positional, exit code, and message stays as it was, and the seven regression evals pass untouched.
- `parseFlags` gains three opt-in rule keys: `many` for a repeatable flag, `raw` for a flag whose own check must see a smuggled option, and `missing` for the wording a caller already pins.
- `debug`, `handoff`, `pr-split`, `run-cost-audit`, and `ship` invoke these scripts as `co.mjs scan <verb>` instead of by path. The direct paths still work.
- `lint-plugins.mjs` resolves a façade reference through co.mjs's verb table, so `co.mjs scan <verb>` carries the same bundling requirement as the direct path, and a verb the table does not carry fails closed.

## 1.65.0
- The output digest, the index refresh, and the ladder card are on by default. Each hook runs unless its switch (`CODE_OPS_DIGEST`, `CODE_OPS_INDEX`, `CODE_OPS_LADDER_CARD`) holds `off`, `0`, or `false`, which a user or a repository sets in the `env` block of a `.claude/settings.json`. The session receipt records each arm as on unless its switch said off, and the measurement page's control is a run with the switches off.
- The SessionStart card carries three more lines from the current-model prompting guide: say what you are about to do and close with a recap that stands on its own, only you see a command's output, and the context-economy rules in one line.
- The workflow gains a macOS job that runs the host-facing evals on the weekly schedule and on demand, never per pull request, because the operator works on Windows and macOS and macOS minutes cost ten Linux minutes.

## 1.64.0
- `context-audit.mjs receipts --purge-before <ISO date>` is the receipt ledger's retention: it rewrites the ledger keeping rows at or after the date, through a scratch file renamed over the original, and reports the count removed. Nothing purges on its own.
- The digest rewrite contract says how to mirror a read-only allow rule for the wrapped form: pin the script name and the family with a wildcard, never a bare `node` rule.

## 1.63.0
- Atlas freshness reaches claim granularity. A claim is a `path:line` citation in a section's prose. `scripts/atlas-check.mjs stamp` records one per citation in `MANIFEST.json` as `{ file, line, anchor }`, with the anchor copied verbatim from the cited line: trimmed, backtick-free, at most 80 characters, and replaced by the `<REDACTED-LINE>` sentinel on a credential-shaped line.
- `atlas-check.mjs check` prints each section's claim report beneath its freshness verdict, classified by `revalidate-register.mjs` over one temporary register the check deletes when it ends. Two freshness mechanisms become one: the atlas and a findings register cannot disagree about what a drifted citation is. A section citing nothing reports `claims: none`.
- `--claims-gate` exits 1 on any claim the classifier did not call FRESH, an unclassifiable one included. It is separate from `--gate`, and the digest verdict keeps its existing meaning. A malformed claim fails the manifest closed.
- `atlas-check.mjs scope <slug> --suggest` prints the depth-1 importers of a section's scope, read from `context-query.mjs blast --json`, as a pathspec list for `add --scope`. It writes nothing and exits 1 when no symbol index exists.
- `scripts/judgment-evals.mjs` gains `--mode register`. A matrix fixture declares `arms`, a list of model tiers, and the planner compiles one unit per tier against the same skill and answer key, naming the tier in the id the score receipt is keyed by. `evals/judgment-matrix.json` declares the arm on `bug-garden`. Trend and floor expansions are unchanged.
## 1.62.0
- `context-query.mjs refresh --provider ctags|codegraph|none` adds two optional fidelity providers, detected at use and treated as data. With `ctags` an installed Universal Ctags runs over the files about to be parsed and its definitions merge into a file only on a line the line rules left free, each marked `source` and mapped onto the index's own kinds. `codegraph` is detected and reported, not ingested. A provider that is absent prints one line and the line rules stand alone, so a refresh never fails for a missing tool. The index records the providers its definitions came from and `status` prints them.
- `preflight.mjs` prints `ctags` and `codegraph` as present or absent beside its other capability lines. Neither absence can fail a preflight.
- `scripts/context-query-mcp.mjs` is the `code-ops-query` MCP server: a newline-delimited JSON-RPC 2.0 stdio server offering `context_query` and `context_refresh`, so a host with no shell reaches the same index. Every bad request answers with a JSON-RPC error rather than a process exit.
- The Codex renderer derives `.mcp.json` from the canonical manifest instead of a hand-kept list, and its check fails when a declared server or its bundled script is missing.
- `evals/context-query-mcp` pins the server end to end; `evals/context-query` gains the provider contract.

## 1.61.0
- `hooks/session-receipt.mjs` records `arms` (which of `CODE_OPS_DIGEST`, `CODE_OPS_LADDER_CARD`, and `CODE_OPS_INDEX` the session ran under) and `contextAtEnd` (the tokens the last assistant message carried in) on every row. `context-audit.mjs receipts --by-arm` groups rows by that record and prints per-session means, so an arm reads against its control. The measurement page pre-registers the schedule and the decision rules.

## 1.60.0
- `scripts/context-query.mjs` is the query-able symbol index: `find`, `callers`, `callees`, `blast`, and `explore` answer with `file:line` anchors, one-line signatures, and edge lists over a home-directory index keyed by content sha, never a verbatim dump. A call resolves same-file, then through an imported name (aliases included), then tree-wide as ambiguous, else unresolved, and the ceiling is printed on every edge result. A result touching a file changed since the build carries a stale banner. `explore` stops at `--budget` with `BUDGET_EXCEEDED` and appends bodies only under `--with-source`.
- `scripts/symbol-lib.mjs` holds the definition rules, definition spans, call sites, and import edges. `skim.mjs` now imports its rules from it, so the outline and the index agree.
- `hooks/index-refresh.mjs` is a third opt-in hook, at `PostToolUse` on Edit, Write, MultiEdit, and NotebookEdit: with `CODE_OPS_INDEX` on it re-indexes the edited file with a five-second budget and prints nothing.
- `co context query <command>` reaches the tool; `evals/context-query` pins the contract end to end.

## 1.59.0
- `scripts/scan-overbuild.mjs --git <range>` is the mechanical floor under the ladder: eight deterministic tells on a diff (a burst of small new files, a one-implementor interface, a pass-through function, an unrecorded dependency, an oversized test file, an unread root config key, a duplicate export, and commented-out code), advisory except the unrecorded dependency, which exits 1. `--exclude <prefix>` drops derived copies, and a byte-identical vendored copy never counts as a duplicate. `evals/overbuild-garden` scores it at a 0.9 recall bar with zero decoys over legitimate extractions and proves the eval can fail.
- `scripts/harvest-deferrals.mjs` collects `deferred(<ceiling>, <upgrade path>)` markers from comments into `DEFERRALS_REGISTER.md`, in the grammar `revalidate-register.mjs` re-greps, with ids that survive a line move. `--check` reports drift. `evals/deferral-harvest` pins the shape, the decoys, and the ids.
- `hooks/ladder-card.mjs` is a second opt-in hook, at `SubagentStart`: with `CODE_OPS_LADDER_CARD` on it hands an implementer-class subagent the ladder as a ten-line card and stays silent for every read-only type. The host field it reads was verified against the installed bundle. It is an experiment arm decided in Phase 6.
- `co scan overbuild` and `co scan deferrals` reach the two scripts.

## 1.58.0
- The implementation loop carries the code-economy ladder: the objective is ordered (correctness and the safety floor, module boundaries, measured performance, readability, then size), and a change climbs six rungs before new code is written. Both sentences are pinned byte-identically across the code-ops-suite, rigor, and privacy-opsec-suite conventions. A deliberate simplification is marked `deferred(<ceiling>, <upgrade path>)`.
- `pr-review` and the quality lenses gain a size-and-boundary lens, `normalize` rule F extracts only on the ladder's evidence, and the dispatch brief template carries a `Size discipline:` line for implementer briefs.

## 1.57.1
- `hooks/digest-rewrite.mjs` drops `gh api` from the allowlist, because an API answer is read by a parser and a digest of it is the wrong tool. One boolean now decides both the `--no-store` flag and the context line, so a command carrying a literal `--no-store` argument with the store on keeps its recovery hint.
- `scripts/digest.mjs` and the contracts, data-model, and infrastructure pages state that `--no-store` or `CODE_OPS_DIGEST_STORE=off` outranks `--store` and `$CODE_OPS_DIGEST_DIR`.

## 1.57.0
- `hooks/digest-rewrite.mjs` is a second `PreToolUse` Bash stage that rewrites an allowlisted simple command into a `digest.mjs` run through `updatedInput`, so tool output enters the context compressed and receipted. It is opt-in and off everywhere: without `CODE_OPS_DIGEST` set to `1`, `on`, or `true` it exits 0 before reading the payload. A repository turns it on through the `env` block of its `.claude/settings.json`.
- The rewrite is narrow by contract. One optional leading `cd <dir> &&` becomes `--cwd <dir>`; anything else carrying a pipe, list, redirect, expansion, subshell, or heredoc passes through, as does a token outside the bare or plain double-quoted forms, a command word outside the family allowlist, a `gh` call asking for structured output, a command already wrapped in the digest, and any command over 2000 characters. The hook returns no permission decision, because the installed host re-runs its whole permission evaluation against the rewritten command.
- `scripts/digest.mjs` takes `--cwd <dir>`, which becomes the working directory for the spawn, the Windows shim lookup, the in-repository frame test, the default store slug, and the receipt row. A `--cwd` naming no directory exits 2.
- `evals/digest-hook/run.mjs` pins the switch, the rewrite shape, the pass-through set, the absent permission decision, and `--cwd` end to end, and proves the pipe refusal can fail by removing it from both guards.

## 1.56.0
- `scripts/digest.mjs` runs a command, writes the raw output to a local receipt store, and prints a shape-keyed compression of it: unified diffs, compiler and linter diagnostics, test-runner output, stack traces, log streams, tables, file listings, and JSON each get their own detector and stages, and an unrecognized shape passes through under a line cap. The child's exit code always becomes the digest's exit code, every elided region prints the `sed -n 'A,Bp'` that recovers it, and the trailer names the exit code, the shape, the before-and-after line counts, and the raw file's sha256.
- The compression is loss-bounded by contract, not by intent. `digest-lib.mjs` computes the must-keep line set before any stage runs, and no stage may drop or rewrite a line in it: every error, failure, or refusal line, the final line, failing test names and the summary, diff and hunk headers, and one line per file that had a diagnostic. `evals/digest/run.mjs` proves retention and reduction together over an eleven-file corpus, and proves the contract can fail by applying the tail cap alone.
- `co context digest -- <cmd>` reaches the same script through the entrypoint façade.

## 1.55.0
- `scripts/skim.mjs` prints a file's outline — Markdown headings with flat section spans, code definitions with import and export rows, top-level JSON keys with array lengths, JSONL record keys, and a marker preview for unstructured text — so an operative reads `--range A,B` instead of the whole file. Outline mode prints names and headings, never bodies; an outline past `--max` ends with a `+N more` line. `co context skim` reaches it.
- The "Skim huge files, then deepen" convention now names the tool that does it.

## 1.54.0
- The model review gates are opt-in. `ship` asks at its first checkpoint whether to run them, recommends yes only for a high-risk surface or a delegated review, and otherwise ships on the deterministic chain and the lead's own diff read. `local-review-gate` opens with a checkpoint and never starts from another skill's judgment. `pr-split` follows the same rule per branch. The conventions carry the rule as a safety rail.

## 1.53.0
- `scripts/co.mjs` is one entrypoint over the canonical scripts: `co <domain> <verb> [args...]` resolves the verb to a sibling script through a static table, rewrites `process.argv`, and imports it, so the wrapped script's exit code and output are its own. `co --help` lists every domain and verb; an unknown domain, an unknown verb, or a verb whose script this plugin does not vendor exits 2.
- `scripts/cli-lib.mjs` collects the flag parser, usage and exit helpers, git wrapper, and file walker that the canonical scripts had rewritten one per file. No script migrates onto it in this release; it ships beside `co.mjs` so the first domain migration is a one-file diff.

## 1.52.0
- Doctrine aligned with the current frontier-model prompting guidance: operatives batch independent tool calls in one round, the lead dispatches in the background and continues independent work, every plugin's conventions carry a finish-the-turn check, the implementation loop keeps changes and committed tests to what the task asks, edits are surgical, and a sourcing brief never runs at low effort. Effort level names are declared non-portable across model generations.
- A `PreCompact` hook prints the six-item preservation instruction, which the host reads as the compaction's custom instructions, and tells the summary to leave redaction markers as they stand. `handoff` keeps the developer's constraints and open promises in their exact words.
- `session-receipt.mjs` honors `CODE_OPS_RECEIPTS=off`. The context-audit eval now proves `receipts --all` against a second directory, pins the order of the largest results, and covers the off switch. Data-model and observability citations corrected.
- The narration scanner reports mannered prose as an advisory, and the writing standard gains its definition and a formatting rule.

## 1.51.0
- `context-audit.mjs` reads the host's local session transcripts and reports exact token usage by class (input, cache read, cache creation, output, thinking), deduplicated by message id, with main and subagent threads apart. It also reports context characters by tool, Bash output by command family, repeat reads, and the largest results. Output is sanitized by default; `--raw` keeps truncated commands and paths for local inspection.
- A `SessionEnd` hook appends one receipt row per session to `~/.claude/code-ops/session-receipts.jsonl` (or `$CODE_OPS_RECEIPTS`): tokens by class, tool calls, model mix, and wall time. It prints nothing to the model, sends nothing off the machine, and fails open. `context-audit.mjs receipts` summarizes the ledger.
- `transcript-lib.mjs` is the shared parser behind both, vendored with the plugin.

## 1.50.0
- Run Contract v3 adds an explicit host-capability policy, a bounded ordered stable prefix, and a runtime receipt location while preserving v1 and v2 compatibility.
- Long-horizon runs can initialize, checkpoint, replan, resume, verify, and measure one hash-chained runtime record without duplicating dispatch, acceptance, Atlas, snapshot, or handoff authority.
- Cache acceleration remains host-owned. Code Ops emits exact cache-ready prefix bytes, records managed or unavailable fallbacks, and aggregates normalized provider cache token telemetry when the host exposes it.
- Runtime receipts and default metrics retain only the capability-descriptor digest, states, and policy outcomes. Capability initialization refuses Git-visible or linked outputs before writing raw provenance. Stable prefixes reject linked or non-regular index entries, and context snapshots reject hidden Git-index state.
- `local-review-gate` moves deep review and OpSec judgment before PR creation. Exact base, HEAD, binary diff, report, reviewer, and receipt identities bind optional GitHub commit statuses to the reviewed SHA.
- One tracked judgment matrix now plans provider-neutral local trend and model-floor runs. Deterministic scoring writes a digest-bound receipt; hosted Actions no longer spend model time on review or calibration.
- Local review and judgment planning reject hidden Git index flags before reading worktree state. Ignored authority outputs cannot portably alias tracked Git paths. Judgment authority paths also reject linked components and physical output aliases, with lossless device and inode comparison on Windows. Runtime authority paths reject portable and physical aliases, while receipt replay accepts only exact SHA-1 or SHA-256 object IDs.

## 1.49.1
- The shipped pull-request workflow example now pins checkout and the Claude Code action to reviewed immutable commits.

## 1.49.0
- Record history profiling batches HEAD tree lookups and historical blob hashing. Receipt-source checks and reachable-blob recovery use bounded batch reads; historical blobs above the 32 MiB batch ceiling fall back to individual reads under Git's existing 64 MiB process bound. The 32 MiB current-record policy is unchanged.
- Per-command caches reuse repository completeness, manifest history, and object format without crossing operation boundaries. Every authority check remains fail-closed.
- At 213 cases, the Windows record eval fell from 1,031.356 to 659.283 seconds (36.1%). The 200-record profile fell from 42.553 to a median 8.634 seconds.
- Windows CI now allows 20 minutes because this release expands the record contract from 165 to 227 platform-applicable cases. The timeout preserves the complete workload and bounded hosted-runner headroom; the 213-case measurement above is optimization evidence, not the final suite runtime.
- The traceless scanner excludes box-drawing glyphs and non-pictographic topology arrows while still blocking bare BMP and supplemental pictographs, default emoji, flags, variation-selector emoji, and keycaps. `--emdash-baseline-rev` measures net dash-count growth against the same tracked path at an ancestor commit. Arbitrary baseline files are rejected, and hard tells still scan the complete current text.
- Authority verification re-derives native exact-path history, batch-introduction commits, introduction-state manifests, and complete predecessor bindings. Reachable adoption sources must contain the reviewed candidates, the bound manifest, and the complete candidate history profiles. Operational classification parses the canonical Git-index manifest, so checkout filters cannot substitute worktree-only policy. Native writes reject visible worktree drift and staged manifest movement during the transaction. A fresh v3 collection cannot claim a v2 migration.
- Every generated-authority writer uses shared post-write semantic verification and restores the prior generated state on failure. The manifest index snapshot is checked at both transaction boundaries, including when history is shallow. Stale-lock recovery binds directory identity and preserves a replacement lease. Ordinary cleanup failures retain durable success, while lost ownership exits 3 with an explicit do-not-retry result.
- Genesis review slots require receipt version 1. Incremental authority batches require their embedded receipt version 2, so a receipt cannot select its own authority schema.
- Adopted collections now accept committed immutable paths through reviewed incremental admission.
- Inventory v3 records exact-once authority membership in one hash-chained history. Curation status stays in its separate ledger.
- Empty incremental deltas are write-free no-ops unless `--require-delta` requests strict intake.
- The first non-empty v2 mutation records a receipted migration without changing existing authority objects.
- Authority batches reject record or artifact provenance that contradicts the admission type. Native objects bind a reachable pre-admission tree that proves their paths were absent. V2 migration alone preserves provenance-less legacy artifacts.
- Every authority writer uses one clone-wide collection lock, optimistic bindings, and atomic rollback.
- Vault guidance directs scheduled recovery to unique branches in isolated worktrees and freezes adopted archive paths in place.

## 1.48.3
- Record-prefix checks now mask fenced examples and unambiguous top-level indented blocks while leaving inline, list, and ambiguous indented IDs visible. Citation extraction retains its broader indented-block exclusion. Blockquote- and list-scoped fences stop at their container boundary, invalid backtick info strings remain prose, and genuinely unterminated top-level fences fail before any citation path can hide later references.

## 1.48.2
- Record conformance now hashes canonical stage-0 Git blobs and separately checks semantic index-to-worktree divergence. Batched, binary-safe Git snapshots preserve immutable authority across `autocrlf`, mixed historical line endings, and clean/smudge filters without hiding staged or unstaged changes. Individual collection blobs over 32 MiB fail closed before content loading.
- Native append, citation verification, curation ledgers, legacy pointers, and adoption-review manifest bindings use the same Git boundary. Review-plan errors and guidance now state that receipt paths must be repository-relative and ignored.

## 1.48.1
- Atlas checks reuse tracked paths already present in each scoped digest and cache repeated immutable revision pins. The normal seven-section check launches 11 fewer Git subprocesses without changing digest bytes, liveness rules, or fail-closed behavior. Optional `check --stats` output makes the process budget executable.

## 1.48.0
- Record adoption now anchors identity to the reviewed current exact-path admission. Delete-and-readd and rename-back histories adopt the surviving path incarnation.
- History profiling follows promotion lineages and first-parent merge diffs. Per-path queries own rename evidence, while bounded exact-path batches add non-rename events. Path, event, batch-count, and process-argument ceilings keep the work bounded.
- Scope classification v2 adds stable scope IDs, glob arrays, and exact tracked-path arrays. Exact paths outrank broad globs. Version 1 keeps exact-one semantics.
- Adoption separates partition validity from history readiness. Historically revised immutable candidates require a current digest-bound review plan. Inventory v2 preserves the receipt, exact-path introduction commit, and citation baseline commit.
- `classify` returns `{ classificationStatus, adoptionReadiness, rows }`. Invalid classification takes precedence over unavailable history. Callers do not need to infer status from row details.
- Post-adoption checks apply one rewrite-tolerant rule. They verify original-candidate coverage, current bytes, classification, risk consistency, rationale coverage, and non-increasing risk counts.
- Native append accepts only new record and immutable-artifact paths without reachable history. Existing paths route through reviewed adoption.
- Incomplete history warns during ordinary checks and fails strict verification as infrastructure. `sourceHead` cannot select weaker verification.
- Regressions cover promotion, path reuse, long Windows arguments, refusal atomicity, receipt tampering, inventory monotonicity, migration, and content-preserving history rewrites.

## 1.47.1
- Record commands canonicalize an aliased repository root once at entry while retaining physical containment checks for every descendant write. Cross-platform regressions prove ambient junctions or symlinks work and linked output paths still fail before mutation.
- The record-collection eval now reports executed and expected case counts on success and unexpected aborts, initializes fixtures inside the failure boundary, and safely reports non-Error throws.
- Documentation citation checks now validate recognized commit fields as complete, object-format-aware commit IDs with durable `HEAD` ancestry. Shallow history is an infrastructure failure, fenced examples and third-party pins stay outside the grammar, and the original line-citation coverage remains intact.
- Legacy authored-document stamps were semantically reviewed against a durable base. Four stale claims were corrected, and the documentation-hub ADR now cites its reachable merge commit.

## 1.47.0
- **Vault standard v4 preserves immutable evidence without preserving a second documentation authority.** Manifest-v2 record collections assign permanent Git-index-derived IDs, freeze adopted bytes, capture citation state and mutable-target digests, and expose semantic indexes from the authored hub. The records engine fails closed on incomplete classification, shallow adoption, immutable drift, broken curation chains, and lost complete-history evidence.
- **Documentation extraction stays bounded as evidence collections grow.** One exact repository map still serves the run, while affected collections contribute only their generated inventory and index. Record bodies are fetched by ID when a domain needs them, and unchanged collections create no dispatch.
- **Migration is explicit and recoverable.** Adoption happens before authored moves, corrections append full curation state, legacy pointers require mechanical evidence, tombstones require explicit adoption, and Git object IDs remain regenerable locators beneath authoritative SHA-256 digests.

## 1.46.0
- **Atlas freshness now survives squash merges and branch deletion.** Default stamps add a versioned `verifiedDigest` over exact scope declarations, the raw staged index, and the raw index-to-worktree delta. A matching digest is the only FRESH result for digest-backed sections; `verifiedAt` remains diagnostic, and legacy sections retain commit-diff behavior until refreshed.
- Default stamps require scoped changes to be staged and refuse unstaged, unmerged, assume-unchanged, skip-worktree, or submodule checkout ambiguity. Scoped diffs override `diff.ignoreSubmodules`, so local configuration cannot hide a changed gitlink. Regressions cover hidden staged divergence, explicit historical stamps, exact scope binding, pruned feature history, and clean post-commit reuse.

## 1.45.0
- **Repository docs now have one physical and mechanical authority.** `code-ops-docs/` contains the handbook, techniques, ADRs, guides, atlas, architecture, contracts, data model, engineering standards, CI, infrastructure, observability, and the explicit design-system verdict. `DOCS_MANIFEST.json` maps every domain to its source evidence and fails on stale digests or legacy authored Markdown.
- **Runs reuse exact repository context.** A content-addressed snapshot caches the repo map, import graph, and atlas freshness once. Unit bundles add direct blast radius and fail explicitly on broad or over-budget context. Version 2 run contracts bind every bundle to the repository state.
- `repo-docs` plans extraction from the changed-source intersection, so unchanged documentation domains receive no dispatch. New regression gates run on Linux and Windows.
- Repository-local Markdown links now fail CI when their exact-case target is absent, keeping the consolidated hub portable across Linux and Windows.
- Review hardening closes fail-open dependency, citation, manifest-plan, empty-scope, and version-2 cost-history cases. Reverse vendored-script parity now rejects undeclared plugin copies and missing helpers referenced from every plugin-owned runtime surface.
- Context receipts preserve Unicode rename/copy paths, canonicalize aliased symlink roots, parse live Atlas freshness output, and report exact serialized bytes. Documentation gates reject vacuous source globs, prevent working-note exemption by manifest extension, and validate Obsidian wikilinks alongside Markdown links.

## 1.44.0
- **Run contracts join intent, execution, and acceptance.** The new `run-contract.mjs` validates a versioned objective, quality vector, budgeted work graph, routing, dependencies, and disjoint writes before fan-out. It reconciles planned units with the dispatch ledger, records owner-qualified acceptance attempts, and writes a successful result only after every blocking criterion and planned dispatch passes.
- **Cost history now has a completion boundary.** `estimate-run-cost.mjs` excludes contract-backed runs until a matching successful result exists, while preserving legacy ledger history. Active or failed contract runs are named separately instead of contaminating the next estimate.
- `full-sweep` compiles substantive Phase 0 plans and reconciles them at wave boundaries. New regression coverage pins the contract compiler, lifecycle filtering, and Linux/Windows execution.

## 1.43.6
- **`run-proof.mjs` spawns npm-style `.cmd`/`.bat` shims on Windows** — `record` and `verify` could not run `npm` on win32: a bare name did not resolve and `npm.cmd` throws EINVAL under Node's shim hardening, so a passing gate chain left no receipt. Both paths now resolve the executable (bare names via a PATH-only `where` lookup, so the repo under audit cannot plant a hijacking shim) and, when it is a shim, rewrite the spawn to `cmd.exe /d /s /c` with quoted, caret-escaped arguments and `windowsVerbatimArguments`. Receipts still record the original tokens, replay screening is unchanged, a relative shim path is made absolute (so `NoDefaultCurrentDirectoryInExePath` cannot break it), and a path-qualified missing shim still exits 127 with no receipt. The proof-receipts eval gains win32 shim checks and now runs in the Windows CI job.

## 1.43.5
- **Consent is one rule in every context — the list-context indent-cap lift is removed** — 1.43.4 lifted the consent line's three-space cap inside an open list, which reopened the hole 1.43.3 had closed: a four-space example under a bullet enrolled a repo that had declined in writing. Enrollment authorizes fleet mode to write to a member, so a false consent costs more than the false decline the lift fixed. The cap is now three spaces everywhere. Inside a list, indentation beyond the item's boundary is presentation or code, never enrollment, and the author rule — write consent flush and undecorated — carries the case. Recorded as an amendment on `code-ops-docs/40 Engineering/Techniques/fleet-standard.md` and on decision D-003.
- **A fence opener closes an open list** — the list flag was never cleared by a fence line, so list context survived past the point the rule set's own close condition ended it, and an indented fence marker below the block opened a fence that never closed. A consenting repo below it reported as a deliberate decline.
- `evals/fleet-standard/` flips the three open-list shapes to declines, adds the reported in-list enrollment reproduction as a fourth, and pins the fence-closes-a-list case that the previous eval could not distinguish.

## 1.43.4
- **The documented parsing rules are now the specification of the consent format** — `code-ops-docs/40 Engineering/Techniques/fleet-standard.md` gains "The parsing rules are the specification": the checker implements the spec, a renderer that displays a contract differently does not govern enrollment, and an uncovered edge case is closed by amending the page and the checker together rather than by matching a renderer. Author-facing guidance is two rules that make the edge cases irrelevant: write consent as a flush undecorated line, and show the phrase in an example only inside a flush fenced block. Recorded as decision D-003.
- **A fence closes only at the quote depth that opened it** — the blockquote prefix was stripped on every line including inside an open fence, so `> ``` ` inside an open bare fence ended the block and the decline below it read as consent. That is the fail-open direction. The reader now records the opening fence's quote depth and tests closers at that depth only.
- **An open list no longer suppresses a genuine consent** — a four-space line inside a list is list content, not code, but the consent matcher kept its three-space cap and refused a line the reader had already called markup. A consenting repo was reported as a deliberate decline. The cap now lifts exactly where the reader has ruled the indent is list content, and nowhere else.
- `evals/fleet-standard/` gains the mirror nesting of the blockquoted-fence cases in five forms, the consent-after-a-closed-blockquoted-fence case, three open-list consent shapes, and the mutation partner proving the lifted cap belongs to list context alone.

## 1.43.3
- **One reader decides what is code, so no markdown shape can enroll a repo by accident** — `check-fleet.mjs` recognized fenced blocks and nothing else, so two ordinary ways of showing the phrase still read as consent. A four-space or tab-indented example enrolled the repo, because the consent pattern's tolerated prefix swallowed the indent. A fence written inside a blockquote never opened a block at all, while the consent pattern did tolerate a `>` marker, so the two disagreed about leading decoration in the fail-open direction. The line stream now strips a blockquote prefix before any leaf test, recognizes indented code blocks where CommonMark starts one, and lets an open indented block win over a fence marker inside it. The full rule set is stated once in `markdownLines` and mirrored in `code-ops-docs/40 Engineering/Techniques/fleet-standard.md`.
- **The consent line's tolerated decoration stops exactly where code begins** — one bullet or blockquote marker and up to three spaces still count, four do not, so the matcher and the reader cannot disagree again.
- **A pointer names its twin in its first paragraph, not in its first three lines** — a legitimate pointer whose naming sentence sat on the fourth line was reported DRIFTED, and the failure text described nothing the author had done. The window is now the opening run of body lines, which leaves the buried-mention case DRIFTED as before.
- **The pointer's heading rule says what it enforces** — a `###` subheading under `## Fleet` is a section of the pointer's own and is refused; the comment and the standard now say so rather than implying depth is allowed.
- `evals/fleet-standard/` gains the blockquoted-fence and indented-code shapes, the indented-block-over-fence precedence case, the decorated-consent forms that must still enroll, and both pointer cases.

## 1.43.2
- **One fence state machine decides what is code, so a fenced example can no longer enroll a repo** — `check-fleet.mjs` stripped fences with a regex that ended at the first line break, so it removed an opening fence and at most one line after it. A `## Fleet` section that showed the phrase on the second line of a block, after a blank line, inside a `~~~` block, or inside a block left unterminated kept the phrase in the text and read as consent. The checker now walks the contract once and tracks fence state per CommonMark: three or more backticks or tildes open a block, only a fence of the same character and at least the same length closes one, and an unterminated fence suppresses to the end of the file.
- **The section scanner and the consent matcher share that state** — heading detection was fence-blind while the consent test was not, so a contract quoting the `## Fleet` heading it must write closed its own section at the quotation and a genuinely enrolled repo was reported as a deliberate decline. Both now read the same line stream, and a real consent line after a closed fence still counts.
- **A short contract that mentions its twin is not a pointer** — the pointer test was a line cap plus two substring matches, so a short substantive contract opening by naming the other file was reported DRIFTED. A pointer must also name that file in its first body lines rather than in passing, and carry no sections of its own beyond `## Fleet`.
- `evals/fleet-standard/` gains the fence shapes that previously failed open, the fenced-heading case, and both pointer false positives. The earlier fenced case passed only because its phrase sat on the one line the broken stripper removed.

## 1.43.1
- **Consent is the phrase on a line of its own, so documenting the rule no longer enrolls a repo** — `check-fleet.mjs` substring-matched `fleet member: yes` across the whole `## Fleet` section, so a contract that showed the phrase in a fenced example, or quoted it inline while declining in writing, was read as consenting. That inverted the load-bearing rule in the direction that matters: consent is what authorizes fleet mode to write to a member, so the fail-open case authorized edits to a repo that said no. The phrase must now be the whole line, fenced blocks are stripped first, and bullet, blockquote, and indent decoration still count. `evals/fleet-standard/` pins both refusal shapes and the decorated forms.
- **Two pointers naming each other are DRIFTED, not a parity mode** — the pointer branch only asked whether the shorter contract file pointed at the other, so a pair where both files were stubs pointing at each other passed conformant. That is the degenerate case the surface exists to catch: no file is the substantive contract and every host reads a stub.
- **A closed-ATX `## Fleet ##` heading opens the consent section** — trailing hashes left the heading unmatched, so a genuinely enrolled repo was reported as a deliberate decline. It failed safe but told the operator the opposite of the truth.

## 1.43.0
- **`conform` gains a fleet mode, and membership is two-sided** — every skill in the suite operated on one repo, so standardizing several meant visiting each and holding the comparison in your head. A `FLEET.json` manifest now names the members, and each named repo consents by carrying `fleet member: yes` in a `## Fleet` section of its own standards contract. A named repo that has not consented is reported and never touched, a consenting repo the manifest does not name is invisible, and a fleet run never edits a member's consent — a run that could write the phrase it then reads would have a formality rather than a rule. Doctrine propagation is the mode's canonical use: when a source of truth moves here, the fleet run carries it to the repos that agreed to receive it.
- **`check-fleet.mjs` reports the fleet in one table** — it validates the manifest, resolves each member, reads consent, and runs the per-repo checks that exist locally, emitting one `CONFORMANCE_REPORT.md` grammar-(d) row per member per surface, so `calibration-metrics.mjs` ingests a fleet run unchanged. Fail-closed throughout: an unresolvable member, an unreadable contract, or a vault check that could not run reports UNKNOWN and fails the run for a consenting member. A missing vault stays ABSENT and does not fail, because vault adoption is voluntary. The new standard is `code-ops-docs/40 Engineering/Techniques/fleet-standard.md`, pinned by `evals/fleet-standard/`.

## 1.42.8
- **The JSON caveat is eval-pinned and the 1.42.7 entry says what its diff did** — the machine-caveat correction had no coverage (only the prose clause was pinned), and the prior entry claimed a full cause set the compact machine string deliberately does not carry.

## 1.42.7
- **The machine caveat matches the prose** — the JSON caveat still said "recorded no dispatches", the diagnosis the prose correction removed. Both now state the observation rather than a single diagnosis, and the eval regex pins the full prose clause instead of stopping before it.

## 1.42.6
- **Estimator caveats say only what the walk knows** — the depth-cap caveat asserted a ledger exists in a directory the walk never entered, and the empty-ledger caveat diagnosed every zero-row ledger as an aborted run when unreadable rows produce the same zero. Both now state the possibility and the full cause set.

## 1.42.5
- **An aborted run no longer rewrites the estimate** — `estimate-run-cost.mjs` counted a run folder whose `DISPATCH_LEDGER.md` has no parseable rows as a comparable run that cost 0 dispatches. `dispatch-ledger.mjs phase` writes exactly that ledger for a run that opens a phase and dies, so one aborted run pulled the range's minimum to 0, dragged the median down, and — the serious part — satisfied the `n >= 3` guard with a run that proved nothing, suppressing the guess caveat at a true n of 2. Zero-row runs are now excluded from the range and named in a caveat of their own, and the guess caveat fires on the count of runs that yielded rows.
- **The walk says what it dropped** — a `DISPATCH_LEDGER.md` deeper than the bounded walk's three levels was skipped in silence, under a message asserting none existed under the tree. The unsearched directories are now listed, and the not-found line is qualified by the depth it searched.
- **Grammar (a) has one source** — the `DISPATCH_LEDGER.md` row shape had three character-identical copies, and an edit to one would have left the others quietly undercounting dispatches rather than failing. A data-only `scripts/ledger-grammar.mjs` now holds the row pattern, the status set, and the table header; the writer and both readers import it.
- **`--repo-size Infinity` is rejected** — the validator accepted it and echoed it back as a recorded size.

## 1.42.4
- **Cost machinery turns predictive** — the ledger's `role@model` stamp is now machine-parsed on both halves: `dispatch-ledger.mjs check` and `calibration-metrics.mjs` each report a per-model mix and a per-model-*class* mix, resolving stamped ids to canonical rungs through the ladder SSOT so a mix stays comparable after a provider moves its lineup. An id serving several rungs reads `ambiguous` and an id in no pinned ladder reads `unclassified`, rather than being placed by the shape of its name; a bare pre-stamp cell still parses and reads `unstamped`. On top of that parse, a new `scripts/estimate-run-cost.mjs` reads *prior* runs' ledgers **before** a run and prints a dispatch-count range plus its class mix, so Phase 0 scoping has a number instead of only a judgment. It does no token-price math (prices drift), calls an estimate from fewer than three comparable runs a guess in a caveat block, and never fails a run — no history exits 0 with "no prior runs, no estimate".

## 1.42.3
- **Tier-floor carrier for hosts that ignore agent frontmatter** — `scripts/preflight.mjs` now prints every bundled agent’s declared tier floor at Phase 0, so the floors are visible on any host. A new `CONVENTIONS.md` bullet makes the lead route each dispatch at or above its floor by hand where the host ignores `model:` frontmatter, and `run-cost-audit` records a below-floor dispatch as a `tier-routing` FAIL.

## 1.42.2
- **Phase C re-writes the conformance report in place** — the skill said to record closing output "beside the opening verdict", which a producer could read as a second row per surface. Under the grammar's first-row-wins rule that shape would pin the drift rate to the pre-repair verdicts. Phase C now states the single-row rewrite: one row per surface, updated in place, the opening verdict noted in the evidence cell.

## 1.42.1
- **Table parsers reject duplicates and lowercase `n/a` coherently** — in the two conformance grammars a repeated key silently disagreed with the verdict counts (last write won the map, every row fed the totals), and `n/a` in lowercase was the one enum value the row regex refused while `pass` and `fail` sailed through. A duplicate key now counts as unparseable and the first row wins, so the per-key map and the counts always agree, and the result cell is case-insensitive for all three values.

## 1.42.0
- **Conformance is measured, not read** — `conform` recorded its per-surface verdicts as prose, so a repo's standardization drift was a one-off reading that no later run could compare against. Phase A's `CONFORMANCE_REPORT.md` now follows a published table grammar — surface, verdict, checker command, evidence pointer — and `calibration-metrics.mjs` parses it into per-surface verdict counts and a drift rate, under the same zero-parse-is-shape-drift rule the older grammars carry. An `UNKNOWN` surface is reported as unmeasured rather than folded into the drift rate silently.
- **`run-cost-audit` scores orchestration discipline** — the audit priced a run's dispatches but never said whether the run followed the routing doctrine it was priced against. A new phase writes `RUN_CONFORMANCE.md` in its own table grammar, scoring five mechanically checkable rules: every dispatched agent has a ledger row, no row is left dangling, tier routing matches the doctrine and the lint-enforced floors, effort routing avoids low on review and xhigh on breadth, and dated artifacts land in the vault's runs folder when the repo carries a vault. `N/A` is a distinct result from `PASS`, because a rule the run could not violate is not a rule it obeyed. The file gates nothing; it makes discipline a trend.

## 1.41.1
- **The standardization preflight moved inside phase 0 of `everything`** — it shipped as a separate phase 0.5, so it ran after phase 0 had already opened the master registers and closed its checkpoint, while its own body told the run to offer repairs at that closed checkpoint. The instruction could not be followed, and the artifacts it reports on already existed by the time it ran. The `conform` call now sits in phase 0 ahead of the register-opening block and ahead of the checkpoint, written as a qualified reference so the composition map derives the edge, and the repairs are offered at the checkpoint that follows it.

## 1.41.0
- **New `conform` skill — one command for every standardization surface** — the standards contract, the docs vault, and the atlas each had a skill and a checker, and nothing asked whether a repo carried any of them. A repo could pass one surface and fail three, and that only surfaced when a later run needed the artifact that was missing. `conform` assesses all of them read-only in dependency order, records each as CONFORMANT, DRIFTED, ABSENT, or UNKNOWN with the checker output that decided it, and writes `CONFORMANCE_REPORT.md`. Repair is a second phase, delegated surface by surface to the skill that owns it, with a checkpoint between each because repairing one surface changes what the next one reads. Doc alignment runs only against a drift signal, never unconditionally. The global user-scope contract is off unless the developer asks for it. Assess-only is a complete run, and every mechanical check is re-run at the end so the closing state is measured rather than claimed.
- **`everything` opens with a standardization preflight** — a new phase 0.5 runs `conform` assess-only, so the run knows where its own artifacts belong before it produces any, and offers the repairs once at the phase 0 checkpoint.

## 1.40.1
- **The vault checker no longer passes the vaults it was written for** — a profile status was read by scavenging every backticked token on any line naming `profile status`, so a sentence that also listed note types declared all of them as statuses, and a vault extending the vocabulary passed with any of them on a note. Only the token immediately following the phrase counts now. The UPPER_SNAKE artifact exemption also required no underscore, so a `README.md` in any domain folder skipped every frontmatter rule; the pattern now requires one, leaving the vault-root `README.md` as the single deliberate exemption. A numbered top-level folder below `10` that is not `00 Inbox/` is rejected instead of being invisible to every layout rule.
- **The `vault` skill's host-parity paragraph reads correctly on every host** — it named the two contract files and their hosts one by one, which the per-host renderers rewrote into a paragraph that contradicted itself. It now describes the standards-contract pair without naming its members, so the meaning survives the rendering.

## 1.40.0
- **New `vault` skill and a fail-closed vault checker** — the Obsidian vault standard (`code-ops-docs/40 Engineering/Techniques/vault-standard.md`) was enforced by convention alone, so a vault could drift from it and nothing said so. `check-vault-standard.mjs` now decides conformance mechanically: `Standard.md` present and carrying `standard-version`, the machinery folders present, no domain folder numbered into the reserved 80-99 band, at least one domain folder, and `type` / `status` / `updated` on every note. A profile status is honored when the vault's own `Standard.md` declares it in prose, so a profile extends the checker without editing it. The `vault` skill scaffolds, migrates, and checks against that standard, and carries the boundary rule that keeps the atlas and tracked reference docs out of the vault.
- **Run artifacts route to the vault when a repo has one** — `CONVENTIONS §12` now names `80 Runs/YYYY-MM-DD slug/` as the destination in a repo carrying a `<repo>-docs/` vault, filenames unchanged, instead of a second dated tree under `docs/<area>/<date>/`.
- **`adopt-standards` knows about vaults and pointer contracts** — the generated contract gains a documentation section routing to the vault's `Standard.md`, and the skill now states the two accepted `CLAUDE.md` / `AGENTS.md` conformance modes: a byte-identical pair, or a pointer pair naming the contract as required reading.

## 1.39.0
- **The calibration config line can record a split lead** — a lead that changes hands mid-run records every lead class in order, plus-separated (`config: lead fable-5+opus-5; operatives opus-5`), instead of omitting the field (lesson L-025, surfaced by R-005). Both grammars extend in lockstep: the note gate's shapes and the graph's ingest grammar plus the run-doc validator, where `config.lead` stays one ordered string checked against its own pattern and an array lead is refused. Only the lead may split; `operatives` stays a single class, and an orchestration-experiment arm still requires a single-lead config. Cross-model attribution splits the lead, so every class that held the session attributes to its provider. `calibration-run` records the handover at Phase 0 and carries it into the Phase 3 note.

## 1.38.0
- **A calibration run now records its harness, not only its model** — the note carries a `host:` line beside `config:`. A lesson can be one model's habit or one harness's mechanics, and the two fail differently; recording only the model left them indistinguishable. `query cross-model` reads both axes and treats either one crossing as a suite defect.
- **Prior fixes are now confirmed, not assumed** — Phase 1 opens the `query unverified` worklist and Phase 4 closes it with a `verified-in` edge for every lesson the run was in a position to observe. Only that edge shows a fix held in the field; the store had 23 shipped fixes behind 3 confirmations, so the loop was measuring its own output rather than its effect.

## 1.37.0
- **New `adopt-global-standards` skill** — the cross-repo counterpart to `adopt-standards`. The global `~/.claude/CLAUDE.md` is a cache of this marketplace's doctrine, and nothing re-verified it: when the SSOT pages moved, the cache kept routing every session in every repo by the superseded rule. The skill reads the SSOT pages themselves, anchors each baseline claim to `file:line`, and classifies every divergence as CONTRADICTS, STALE, MISSING, or REPO-LOCAL. A contradicted rule ranks above a missing one because sessions follow it. A fifth bucket, LOCAL-DOCTRINE, covers cross-repo rules the global file already carries that no SSOT page states: the write is additive by default, so those survive untouched and are listed as candidates to promote into the marketplace instead of being pruned to fit the template. Every removal is named with its bucket at the checkpoint. Writes only after that checkpoint, never touches settings or hooks, and stamps the marketplace commit it verified against so the next run computes drift from the log.

## 1.36.0
- **Recording a calibration run is now five steps, not four** — the new final step syncs `evals/calibration-graph/run.mjs`. That eval runs against the real store and hardcodes its answers, so every ingest changes two files. Two consecutive ingests missed the step, which passes every local gate and fails only in CI. Both the protocol doc and the `calibration-run` skill now name the step, and the skill's `Done when` requires the eval to pass.

## 1.35.0
- **New `CONVENTIONS.md` §14, Writing standard** — every skill writes to one house standard. The section pins one term per concept, active voice, and one instruction per sentence. It caps instructions at 20 words and explanation at 25. Clarity outranks conformance, so a writer who breaks a rule states why. Full rules live in `code-ops-docs/40 Engineering/Techniques/writing-standard.md`.

## 1.34.0
- **New optional `config:` Machine-block line** — `config: lead <model-class>; operatives <model-class>`, parsed identically by `calibration-metrics.mjs --validate-note` and `calibration-graph.mjs ingest`. It records the orchestration a calibration run was driven under, which is what makes one run's numbers comparable to another's rather than merely sequential. Optional like `atlas:`: a note without it validates and ingests exactly as before, so the runs recorded before the tier experiment stay valid.
- **The run-document schema gains an optional `config` object** (`{lead, operatives}`, both kebab model-class slugs), fail-closed on a malformed shape. A run that did not record its orchestration omits the field entirely rather than defaulting one — a guessed lead class would silently mis-group a comparison. `query trend` prints a config tail only for the runs that carry one; the rendered table is unchanged.
- **`calibration-run` confirms the orchestration configuration at the Phase 0 checkpoint** and pins the operative tier in every dispatch brief, since a run that re-tiers mid-flight is not comparable to any other.
- **A three-run orchestration-configuration experiment is pre-registered** in the calibration protocol as a baseline gap analysis: a quality baseline, a candidate read against it on fixed axes, and a cost-floor reference. Gaps feed the existing `instrument`/`suite`/`protocol` lesson classes and the remediation loop.

## 1.33.0
- **Model routing is quality-first** (`CONVENTIONS.md` §1, `hooks/routing-card.mjs`): every judgment-bearing sub-agent dispatch runs on the stronger model whatever tier the orchestrator itself is on; only mechanical breadth sweeps and transcription-style work drop a tier. A shallow or failed report costs a redispatch plus the orchestrator's attention, which outweighs the stronger model's price premium.
- **`run-cost-audit` prices under-tiering as a cost, not a saving**: a judgment-bearing dispatch routed below the strong tier is now a finding, reported with the redispatches and discarded reports it caused.

## 1.32.0
- **Tier discipline is enforced at the operative boundary** (`CONVENTIONS.md` §7, `agents/reviewer.md`): an operative may label a finding CONFIRMED only when an executed repro or trace sits in its own transcript; a statically-argued finding caps at PROBABLE and only the lead promotes it. Calibration run R-004 saw six findings arrive labelled CONFIRMED on static reasoning alone, which made the confirmed ratio measure labelling discipline rather than evidence depth.
- **Operative reports are persisted in the turn they land** (`CONVENTIONS.md` §1): the report goes to the run's artifact folder before any other work, because a report that lives only in the conversation is one blocked turn from being lost.
- **Report shape is gated before a unit counts as covered** (`CONVENTIONS.md` §1): a brief that never reached its operative looks exactly like a completed dispatch in the dispatch record until someone reads the report.
- **Refutation panels are staffed by distinct lenses** (`CONVENTIONS.md` §7): an odd panel of identical skeptics can repeat one reader's misread and confirm the wrong answer by majority; correctness, configuration-reading, and reachability are separate seats.

## 1.31.0
- **Failed rate and redispatch rate are no longer mutually exclusive per unit.** A ledger row carries one status cell, so a unit that failed and was then retried read as `redispatched` alone and the pair understated recovery. `calibration-metrics.mjs` now derives both rates from the ledger's write journal when one sits beside it: a unit counts toward the failed rate if it EVER entered `failed` and toward the redispatch rate if it was EVER redispatched, independently. The row grammar is unchanged.
- **The basis is always stated, and a degraded rate is never silent.** The report carries a `rate basis:` line — `journal-derived`, or `snapshot-only` for a pre-journal artifact folder. A journal that is present but carries an unreadable or malformed line is rejected WHOLE (never partly used), its violations printed as `!! JOURNAL`, with the fallback named on the basis line. The dangling rate and the `by status` breakdown still report final status, by definition.
- `--json` gains `ledger.journal { present, derived, violations }` plus `ledger.everFailed` / `ledger.everRedispatched` — the numbers the two rate lines print.

## 1.30.1
- **Four register/refutation grammar fixes, each pinned by a regression case.** A per-entry length budget now terminates its entry at the next entry head, a covered-negative `NO-FINDINGS:` line, or a non-entry heading, so a trailing block is no longer charged to the entry above it; refutation receipts are keyed by an ID at the START of the line, so prose citing a finding is neither an unparseable receipt nor a second verdict; the themed-sibling-report warning walks the artifact folder recursively (bounded by depth, skipping dot-directories and `node_modules`) so per-slice reports in subdirectories are seen; and `calibration-metrics.mjs` no longer reads its own report back as a sibling register.
- **The sanitized-note template prescribes a severity mix the note gate accepts.** The prose half now reads `severity mix c/h/m/l/n as <N/N/N/N/N>` — a bare `0/6/22/9/10` is five slash-separated segments and the path scrub read it as a unix path, so a note written exactly to template failed closed. The scrub itself is unchanged and no less strict.

## 1.30.0
- **`dispatch-ledger.mjs` now journals its own writes**, so a phantom row is mechanically detectable. `add`, `update`, and `phase` append a JSONL entry to `<ledger>.journal.jsonl` before writing the ledger, and `check` replays that journal against the rows: a row with no journaled `add` is reported as `!! PHANTOM` and fails closed without `--strict` — a row minted by a direct or batch artifact edit (often straight at `reported`) was previously indistinguishable from a real dispatch in a finished artifact. A hand-edited status cell (`!! OUT-OF-BAND`), a journaled row deleted from the ledger (`!! MISSING-ROW`), and an unreadable journal line all fail closed too.
- **Pre-journal ledgers keep working.** A journal is created only by the command that creates the ledger; `update` never mints one. An existing ledger with no journal stays unjournaled and `check` reports it as an advisory (exit 0), promoted to a failure under `--strict`. The journal entry is written before the ledger so a crash between the two surfaces as a missing row, never as a phantom.
- The `check` summary keeps its existing sentence and gains a `journal: verified|absent|N violation(s)` tail.

## 1.29.0
- **A calibration run now measures the target's atlas.** `calibration-run`'s baseline sweep opens with an `atlas-check.mjs check` (or an `init` when the target keeps none), hands each section's FRESH/STALE state into the sweep briefs, and refreshes the stale sections in the session that has the context. Four counts come back: sections held, consumed FRESH, refreshed, and falsified.
- **New optional `atlas:` Machine-block line** — `atlas: sections N; fresh N; refreshed N; falsified N`, parsed identically by `calibration-metrics.mjs --validate-note` and `calibration-graph.mjs ingest`. A note without the line validates and ingests exactly as before, so the runs recorded before the atlas leg stay valid; a present line must carry all four counts.
- **The run-document schema gains an optional `atlas` object**, bounded fail-closed like every sibling count group: no negative count, `fresh + refreshed` may not exceed `sections`, and neither may `falsified`. `query trend` prints an atlas tail only for the runs that carry one; the rendered table is unchanged.
- **A falsified section is a lesson, not a staleness report** — the calibration protocol routes it to the existing `instrument`/`protocol` lesson classes, since it means a run was handed a false premise.

## 1.28.0
- **New `atlas` skill.** Maintains a per-repo knowledge cache of judgment-only sections, each carrying scope globs and a verified-at stamp recorded in a machine-readable manifest rather than in prose.
- **New vendored `atlas-check.mjs`** with `init`, `add`, `check`, `stamp`, and `inbox` modes. `add` registers a section (repeatable `--scope`) with a stub file and an `unverified` pin, so a new section is `STALE` until someone stamps it. Staleness is computed by git pathspec diff since each section's stamp, against the working tree — an uncommitted edit to a scoped tracked file counts. A stamp must be an immutable object name (lowercase hex, 7-40 chars, or the `unverified` placeholder): a moving ref such as `HEAD` or a branch name is a fail-closed schema violation, since it would re-resolve on every run and never go stale. That shape rule is backed by a resolution-time rule, since a branch or tag *named* like a sha would otherwise pass it and still move: a value claimed to be a pin must resolve to a full sha that extends it, in `check` and in `stamp --at` alike. An unresolvable stamp reports fail-safe `STALE`; a malformed manifest is fail-closed; the coverage sweep flags unmapped top-level paths as advisories.
- **`ship`'s closing phase refreshes the sections the change made stale**, while the diff rationale is still in-session.
- **`CONVENTIONS.md` gains the stamp-trust rule** — a FRESH section is consumed without re-verification, a STALE one is treated as a lead.

## 1.27.0
- **Calibration runs are recorded as a knowledge graph.** The calibration store under `evals/calibration/` holds one document per run, lesson nodes carrying stable IDs, and edges linking each lesson to the fixes, enforcements, and verifying runs that answer it — so a lesson's fate is queryable instead of buried in prose.
- **`evals/CALIBRATION_TABLE.md` is now a derived view.** The new root-level `scripts/calibration-graph.mjs` renders the table from the store and drift-checks it (`render --check`) alongside `validate` for store integrity.
- **`calibration-metrics.mjs` gains a `--json` emit mode** and fails closed when a sanitized note is missing or malforms its Machine block. Its `paneled:` shape accepts `of unknown eligible`, matching the ingest side that maps an unmeasured denominator to null.
- **`calibration-run`'s closing phase switches from hand-appending a table row** to validate, ingest, render, and graph-validate.

## 1.26.0
- **Item-ID grammar widened and anchored.** An item ID may now carry an optional uppercase round letter between the hyphen and the serial, and is matched only at entry-heading position — line start, after optional heading markers or a table-row pipe — so IDs mentioned inside prose no longer open spurious entries.
- **Per-entry register budget in `calibration-metrics.mjs`.** A `FINDINGS_REGISTER.md`-shaped artifact is measured per entry (advisory 10 / hard 20 non-blank lines, preamble 15/30) with the flat 60/120 file cap as fallback.
- **Sibling-report warning.** `calibration-metrics.mjs` warns when register-shaped entries sit in a non-artifact sibling file, naming the file.
- **Covered negatives replace the zero-parse warning.** A present artifact whose `NO-FINDINGS` lines account for its content is reported as covered negatives rather than warned about as an unparsed artifact.
- **`dispatch-ledger.mjs phase` subcommand.** Writes `> phase: <title> · lead@<model>` markers so the lead model per phase is reconstructable; `check` is fail-closed on a malformed marker.
- `code-ops-docs/40 Engineering/Techniques/calibration-protocol.md` restates the CONFIRMED-ratio rule: an assess-only run caps remediation, not reproduction.
- **`CONVENTIONS.md` dispatch-ledger passage synced** to the stamped `role@model` row form and extended with the write-at-dispatch atomicity clause; the passage is now pinned byte-identically across plugins by `SHARED_PASSAGES` in `scripts/lint-plugins.mjs`.
- **Vendored `revalidate-register.mjs` re-synced** from the canonical `scripts/revalidate-register.mjs` for the widened, heading-anchored item-ID grammar.

## 1.25.0
- **Dispatch-ledger rows are stamped `role@model`.** `dispatch-ledger.mjs add` now requires `--model <resolved-model-id>` and writes it into the role cell, so a run's actual tier mix is reconstructable after the fact and a silent mid-run tier substitution is visible instead of invisible; `check` flags an unstamped row as an advisory (a hard failure under `--strict`). Legacy unstamped rows still parse.
- **Register per-entry length budget.** `scan-narration.mjs` now checks a `FINDINGS_REGISTER.md`-shaped artifact per-entry (advisory 10 / hard 20 non-blank lines, preamble 15/30) instead of against the flat file-level cap — real-scale calibration evidence showed the flat cap wrongly penalized a legitimate many-entry register whose individual entries were tight.
- **`scan-redaction.mjs` gains directory support.**
- **`calibration-metrics.mjs`** warns when a present, non-empty artifact parses to zero items (naming the artifact and pointing at the new `code-ops-docs/40 Engineering/Techniques/artifact-grammars.md`), and adds a tier-mix line to the dispatch-ledger summary parsed from the `role@model` stamp (unstamped rows counted separately).
- **New `code-ops-docs/40 Engineering/Techniques/artifact-grammars.md`** — the SSOT for the three parse grammars (`DISPATCH_LEDGER.md`, `FINDINGS_REGISTER.md`, `REFUTATION_LOG.md`) consumed by `calibration-metrics.mjs` and `revalidate-register.mjs`; handbook technique count 10 → 11. `calibration-protocol.md` now notes CONFIRMED-ratio comparisons are within-track only and links the grammars doc.
- `CONVENTIONS.md` §12's dispatch-ledger example updated to the stamped row form; a sentence on the register per-entry budget added alongside it.

## 1.24.0
- **Skills are model-invocable.** Removed `disable-model-invocation: true` from all skill frontmatter; the harness routes slash input through the Skill tool, and the flag made every skill uninvocable there and blocked scheduled-task invocation. Routing discipline now lives in each skill's "Use when" description, the session routing card, and each skill's own checkpoints — no auto-merge, ever.

## 1.23.0
- **Three new suite self-audit skills.** `calibration-run` (Mode: ASSESS) standardizes a real-scale calibration run against a target repo — isolated preflight, an `assess-only` baseline sweep dispatched per `full-sweep`/`rigor:rigor-sweep`'s own phases, metric extraction, and a fail-closed sanitized-note validation before a row is appended to the new `evals/CALIBRATION_TABLE.md` — enforcing the one-way channel rule from `evals/README.md` mechanically instead of by convention. `run-cost-audit` (Mode: ASSESS) audits a completed run's dispatch counts, artifact sizes, and tier/effort mix against the bounded-wave (`§1`) and length-discipline (`§12`) doctrine, producing an evidence-cited `COST_AUDIT.md`. `provider-parity-audit` (Mode: ASSESS) inventories provider-coupled prose across every plugin's skills/CONVENTIONS/docs and classifies each hit (reconciled-in-render / needs-rewording / intentionally provider-specific) into `FINDINGS_REGISTER.md` — the prose counterpart to `build-codex-marketplace.mjs --check`'s mechanical render parity. New `code-ops-docs/40 Engineering/Techniques/calibration-protocol.md` documents the channel rule, run design, metric table, and sanitized-note template.
- **Phase-0 executor naming extended to the remaining DOCUMENT/AUDIT/IMPLEMENT skills** — `adopt-standards`, `adr`, `api-docs`, `data-model`, `dependency-upgrade`, `doc-alignment`, `feature-discovery`, `feature-implementation`, `normalize`, `onboarding`, `ops-docs`, `performance`, `remediation`, `security-privacy-audit`, and `test-hardening` now name the `explorer` (mapping phases) or an ephemeral implementation operative (fix/build phases) dispatch explicitly, completing the pattern started in 1.22.1 for `architecture` and `codebase-audit`.
- Skill count 25 → 28; handbook, root README, and plugin README counts updated to match.

## 1.22.1
- **`architecture` and `codebase-audit` Phase 0 name an `explorer` dispatch** for stack detection/inventory, handing its summary onward — matching the executor-naming already used in the orchestrators' Phase 0.

## 1.22.0
- **`CONVENTIONS.md` §1 gains a reasoning-effort routing rule** — effort follows ambiguity the same way tier does (low for mechanical/breadth, medium for execution/scoped implementation and flow tracing, high for review and the lead, xhigh reserved for disputed verdicts and critical CONFIRMED calls), cross-referencing `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md` for the full table instead of duplicating it.
- **Privacy leak gate made an explicit invocation** in `ship` and `debug` Phase 4 — names `/privacy-opsec-suite:metadata-leak-audit` scoped to the change's/fix's diff and routes its findings into `FINDINGS_REGISTER.md`, replacing the prior prose-only mention.
- **`researcher` wired into `ship`** — Phase 2 routes new-dependency and library-choice decisions through `/researcher:library-eval` and pre-commitment claim verification through `/researcher:research-verify`.
- **`explorer` and `reviewer` doctrine clauses pinned against drift** (`SHARED_PASSAGES` extended to `plugins/*/agents/*.md` in `scripts/lint-plugins.mjs`) — escalate-don't-guess, secret redaction, and dense/evidence-cited-report wording normalized across all eight operative agent files and gated so a partial edit fails lint.
- **Phase-0 explorer dispatch named explicitly** in `ship`, `debug`, and `full-sweep` — the stack/conventions detection step now names the operative that runs it (an explorer, handing its summary plus `REPO_MAP.md` forward) instead of leaving the lead to do it inline.
- **`everything` gains its own Phase-0 preflight/repo-map wiring** — it does not delegate to `full-sweep`, so it now runs `preflight.mjs` and `repo-map.mjs` directly, matching the other orchestrators.
- **`debug` gains a scale-down line** matching `ship`'s, plus permission to fold the Phase-2 root-cause checkpoint into the Phase-3 fix report for a trivially-scoped, one-file, obvious-root-cause fix; anything broader still stops for the checkpoint.
- **`CONVENTIONS.md` §7 gains a triage cap** — a phase surfacing more than 5 critical/high findings eligible for a panel checkpoints with the developer on scope before paneling all of them.
- **`CONVENTIONS.md` §12 generalizes the length discipline** — `EXECUTIVE_SUMMARY.md` and other run summaries cap at roughly one page of top findings, with full detail left to the register.
- **New `import-graph.mjs` vendored in** (`scripts/vendored-manifest.mjs`), alongside `preflight.mjs` and `repo-map.mjs`.
- **New `SessionStart` hook (`hooks/routing-card.mjs`)** — prints a hard-capped, 10-line routing card at session start pointing task types at the right skill/orchestrator and naming the standard-operating-mode docs, so the lead defaults into delegating instead of working inline.

## 1.21.0
- **`revalidate-register.mjs` hardened** — its git call now runs under a child-process timeout, blank/whitespace flag values are rejected, and unknown flags exit 2 instead of being silently treated as filenames.
- **`preflight.mjs` rejects unknown flags** (exit 1) instead of ignoring them.
- **`scan-ai-tells.mjs` and `scan-redaction.mjs` hardened** — missing-file/config errors now exit 2 even when hits are also present (previously masked to exit 1), their git calls run under a timeout, and unknown flags are rejected.
- **`run-proof.mjs` and `check-autofix-scope.mjs` reject blank/whitespace flag values** and document their exit contract in a header comment; `run-proof`'s proof-command execution stays deliberately unbounded.
- **`lib-docs.mjs` documents its exit contract** in a header comment and rejects blank/whitespace flag values.
- **`pr-split` now points to the stacked-PR merge procedure** in `code-ops-docs/40 Engineering/Handbook/10-recovery-and-troubleshooting.md` §6.

## 1.20.0
- **New `scripts/repo-map.mjs` generator** — produces a per-repo inventory (`git ls-files -z`) with per-language top-level definition extraction at exact line numbers, announced truncation/binary/unreadable-file handling, and a HEAD-sha freshness stamp; vendored byte-identically into this plugin's `scripts/`.
- **`Map once, search to deepen`** doctrine bullet added to `CONVENTIONS.md` (SHARED_PASSAGES-pinned, id `map-once`) — Phase 0 generates `REPO_MAP.md` once per run and every operative brief gets its path, consulting it before search.
- **`universal-ctags` optional-tool mention** added to `CONVENTIONS.md` §2 — an optional accelerant for symbol-to-location lookups, used if installed, never required.
- **Phase-0 repo-map wiring** — `ship`, `debug`, and `full-sweep` run `repo-map.mjs` after `preflight.mjs` passes and hand the resulting `REPO_MAP.md` path to every operative brief; a failed generation is a noted advisory, not a blocker.
- **`repo-map.mjs` and `preflight.mjs` reject empty or whitespace-only flag values at parse** — previously `--max-file-kb ""` produced an all-skipped map with exit 0, and `--artifact-dir ""` silently skipped the writability probe.
- **`preflight.mjs`'s tool probe falls back to a `where` PATH lookup on Windows** so `.cmd`/`.bat` shims (npm-style tools) resolve without a shell.
- **`REPO_MAP.md` added to the Standard filenames artifact list.**

## 1.19.0
- **Operative-failure ladder** added to `CONVENTIONS.md` (SHARED_PASSAGES-pinned): a dispatched operative that cannot complete its brief escalates through an ordered ladder (retry with a narrower brief, hand back a specific open question, or take the piece over) instead of guessing or silently dropping the task.
- **`DISPATCH_LEDGER.md` convention** — dispatched work is logged so a stalled or dropped operative is visible instead of silently vanishing; `revalidate-register.mjs` gains an advisory `--dispatch-ledger` flag that cross-checks the ledger against the register.
- **Report-ingestion gates** added to `ship`, `debug`, and `full-sweep` — an operative report is validated against its expected shape before being folded into the run, so a malformed or partial report cannot silently pass through as complete.
- **New `scripts/preflight.mjs`** — a Phase-0 gate wired into `ship`, `debug`, and `full-sweep` that checks environment/toolchain preconditions before a skill starts work.

## 1.18.0
- **New skill `adopt-standards`** (Mode: DOCUMENT) — bootstraps or maintains a repo's `CLAUDE.md` standards contract so it stays mechanically kept, not aspirational. **BOOTSTRAP** mode (no `CLAUDE.md`, or one failing a quick audit) audits real build/test/lint/gate commands (run read-only or CI-cited), architecture, gotchas, and doc-lifecycle rules, then writes the contract in house style. **MAINTAIN** mode re-verifies every claim — commands still run, the gate chain still mirrors CI, enforcement claims are truthful, `line N` citations are swept mechanically (not eyeballed), cited paths still exist — fixing drift and reporting what was stale. House style: `## Never (no gate will save you)` first, `## Before declaring any change done` (verified command chain), post-edit chores, `## Invariants the gates will catch`, and a local-only-docs note, with no duplication of the user's global `~/.claude/CLAUDE.md` doctrine.

## 1.17.2
- **Agent doctrine hardening.** `explorer` and `reviewer` now state explicitly that an ambiguous brief, or work outside their scope (edits, execution, a judgment call only the orchestrator can make), goes back to the orchestrator as an open question instead of being guessed at. `explorer`'s evidence-citation rule now points at the plugin's `CONVENTIONS.md` (§9, Evidence standard) for the anchor format; `reviewer`'s report rule states reports return dense and evidence-cited, never raw file dumps.

## 1.17.1
- **Codex distribution.** The repository now renders a tracked native Codex package from this canonical source, with a `.codex-plugin` manifest, marketplace metadata, named skills, explicit manual-invocation policy, bundled MCP server, and the traceless-publishing hook subject to Codex hook trust. `node scripts/build-codex-marketplace.mjs --check` fails on render drift.
- **Traceless scanner recognizes Codex/OpenAI attribution.** The bundled `scan-ai-tells.mjs` now rejects Codex/OpenAI trailers, generation claims, and `Codex CLI` tool markers in the same fail-closed gate used for Claude and other assistants.

## 1.17.0
- **New `PreToolUse` hook `enforce-traceless`.** Blocks a `git commit` / `gh pr create|merge` Bash call at the tool layer when the command text carries an AI/tool tell, running the bundled `scan-ai-tells.mjs` against the full command string before the call proceeds; a hit exits 2 with the scanner's report, otherwise exits 0. Fails open on scanner infra errors (missing/unspawnable scanner) so the hook never blocks a commit for its own reasons; CI (`scan-ai-tells.mjs --git <range>`) remains the fail-closed backstop.

## 1.16.0
- **Token economy (measured, gate-preserving).** Read-once clause for CONVENTIONS (an orchestrator-loaded copy is inherited, not re-read — an `everything` pass instructed ~35 reads of ~15K unique tokens); pre-filter-first register reads (run the checker, then read only non-FRESH entries, wholesale only for synthesis); refutation-panel economy (a SURVIVED verdict whose receipts still pass `--strict --refutation-log` is not re-paneled; panelists get the finding block + cited region inline, never the full register); `everything` no longer preloads sibling skill files (invocation re-injects them). All new doctrine cores pinned in SHARED_PASSAGES.
- **DOCUMENT-mode generators read scoped sections** — `architecture`/`api-docs`/`data-model`/`ops-docs`/`onboarding` read the four sections that bind DOCUMENT mode instead of the full file (the fan-out/fix machinery cannot apply to them). `adr` and `doc-alignment` keep full reads (they log tiered findings).
- **Frontmatter descriptions trimmed** across the marketplace (~26%; every Use-when trigger and sibling disambiguator kept verbatim; all skills are manual-invoke so routing is unaffected).
- **CI: both PR gates cancel superseded runs** (a newer push stops paying for reviews of dead commits) and deep-review skips generated-data-only diffs (in-job check, never paths-ignore — required-check semantics preserved; validate.yml drift-checks those files; opsec-gate still reviews every PR).

## 1.15.1
- **Tier-honesty line moved in-phase** in `doc-alignment` and `normalize` — the post-hardening floor snapshot (evals/FLOOR_TABLE.md) measured that the rule suppresses weak-model tier inflation when embedded at the finding-emitting step (the bug-hunt pattern, 0 inflation) but not as a trailing line (4-9 remained). Placement beats presence; pre-registered iteration, nothing else changed.

## 1.15.0
- **CONVENTIONS restructured for clause visibility.** The dense tier-honesty, independent-refutation, and anchor paragraphs in `§7`/`§9` are now one clause per line (numbered), so an executing model weighs every clause of the conjunctions instead of skimming a 200-word sentence; the refutation protocol carries the identical numbered structure as rigor `§I`. Section headings and every pinned doctrine core are byte-unchanged.
- **New lint check #14: SHARED_PASSAGES drift gate.** The deliberately-duplicated doctrine cores (fan-out throttle, disconfirmation protocols, headless contract, circuit-breaker, non-secret-anchor rule, terminal forms, the always-gated list) are pinned byte-identically across every file that carries them — a partial rollout of a doctrine change now fails CI instead of silently diverging. Caught and fixed one live drift on landing: `everything`'s always-gated copy had drifted from the pinned byte-form (a separate "anything irreversible" clause instead of "destructive/irreversible operations", and no never-auto-merge rider).
- **Tier honesty inlined at point of use** in `doc-alignment` and `normalize` — the baseline model-floor calibration (see `evals/FLOOR_TABLE.md`) measured weak-model tier inflation concentrating in exactly the skills that carried the rule only by CONVENTIONS pointer.
- **`evals/FLOOR_TABLE.md`** — the committed baseline of the pre-registered model-floor calibration: strong tier emitted zero inflated CONFIRMED across 42 read-only cells; the weak tier emitted 62 in control and 27 with skills, splitting on whether the skill inlines tier discipline.

## 1.14.0
- **Weak-model gate batch.** `revalidate-register.mjs` gains an opt-in `--strict --profile <type>` schema gate (mandatory per-item fields; a mangled zero-ID register fails instead of silently vacating the anchor gate), a `--consumed <pre-run>` terminal-state mode (a consumed item never vanishes and closures use `closed-with-proof` / `deferred-with-reason` / `OBSOLETE-AT`), a Panel-exempt severity floor (a sensitive-path finding below high needs an explicit exemption — deflation cannot dodge the refutation panel), refutation receipts (`--refutation-log` validates panel size, tally, and that every REFUTED verdict's guard anchor still greps), and a `<REDACTED-LINE>` anchor carve-out so the anchor rule never forces a secret into a register.
- **New `check-autofix-scope.mjs`** — the auto-apply diff gate: denies always-gated paths (auth/migrations/lockfiles/workflows/schemas), oversize diffs, and export-touching lines before an agent may auto-apply a NOW-SAFE item; fail-closed by default (no flags = deny everything), wired into the §4 auto-safe lane.
- **New `run-proof.mjs`** (execution receipts: a claimed test result with no replayable receipt is narration, not proof) and **`scan-redaction.mjs`** (fail-closed secret shapes over the run's own output artifacts — the §4 radioactive rule gains a mechanical floor; matched secrets are masked in the scanner's own output).
- **Producer/consumer self-checks wired:** `codebase-audit` gates its Done-when on a clean revalidate pass of the finished register; `remediation` and `feature-implementation` gate theirs on `--consumed`; `handoff` scans itself before handover. Guarded by lint check #13 so the wiring cannot silently regress.
- **Evals:** register-staleness extended (strict/consumed/redacted-anchor cases); new `proof-receipts`, `autofix-scope`, and `redaction-scan` regression evals wired into validate.yml.

## 1.13.1
- **Doctrine line untethered from a model name.** CONVENTIONS line 3 now targets "a capable agentic coding agent (e.g. Claude Code)" — the Opus 4.8 example pinned the suite to a model generation; capability is the contract, and the model floor is measured (see the model-floor calibration workflow) rather than named.

## 1.13.0
- **New skill `handoff`** (Mode: DOCUMENT) — session continuity for long runs. **Write** captures the run's true state as a verifiable `HANDOFF.md` before a context limit / session end / operator change: goal and state of play, every register path stamped `Verified-at: <sha>`, decisions with their rejected alternatives, traps & dead ends (the most valuable and least recoverable session state), and in-flight boundaries with anchored `file:line` pointers. The rule is *state, not instructions*. **Resume** treats every claim as context to verify, not fact to trust — `revalidate-register.mjs` on every named register, anchors checked, contradictions surfaced at a checkpoint. Registers carried findings across phases; nothing carried decisions and dead-ends across sessions until now.
- **Lint check #11: frontmatter angle-bracket injection guard.** `lint-plugins.mjs` now fails any SKILL.md whose frontmatter value contains `<` or `>` — frontmatter is injected verbatim into the system prompt at discovery (before the body is read), so angle-bracketed markup there is a prompt-injection surface no body-level guard sees. Complements the supply-chain-trust agent-ingested-content lens with a mechanical floor for this repo's own skills.

## 1.12.0
- **Anchor delimiter promoted from script comment to spec (`§7` schema, `§9`).** `revalidate-register.mjs` can only parse an `Anchor:` value that is backtick- or quote-delimited; that requirement lived solely in a script comment, so an executing model following CONVENTIONS could emit an undelimited anchor and silently lose the `DRIFTED` gate — the item fell open to plain line-existence checking. The schema and `§9` now state the syntax with a micro-example (`` Anchor: `req.query.accountId` ``); `reviewer` carries it inline.
- **`revalidate-register` warns on an unparseable anchor.** An `Anchor:` label whose value has no delimiter now earns a per-item advisory (`unparseable, DRIFTED check skipped`) instead of being silently ignored. Non-gating; anchor-less registers are checked exactly as before.
- **Eval:** `register-staleness` gains an undelimited-anchor case pinning the new advisory (FRESH status + explicit warning, never a silent skip).

## 1.11.0
- **Cascade circuit-breaker (`§11`).** Three or more fixes in a single run failing verification or spawning new confirmed findings now stop the implementation loop — a cascading cluster is evidence of an architectural problem, not a bug collection. The cluster reclassifies as NEEDS-DESIGN with the cascade chain recorded and options presented at a checkpoint (deferred and reported in headless runs). Wired into `remediation` and `debug`; mirrored in rigor `§H`.
- **`pr-review` scales the review to reach, not diff size.** Phase 0 now traces the change's reach — the dependents and call sites of changed exported symbols, shared types/schemas, and API/DB contracts — and scales reviewer fan-out and depth to it; a small diff in a shared contract is a large review.
- **`dependency-upgrade` closes CVEs on evidence.** "Done when" now requires a fresh advisory re-scan against the final lockfile (the ecosystem's live audit tool) showing no remaining high/critical advisories except those explicitly accepted or deferred with rationale — never inferred from the version bumps alone. `DEPENDENCY_REPORT.md` backs its CVEs-closed list with the re-scan output.
- **`adr` gains a three-prong admission gate (both modes).** A decision earns an ADR only when it is hard to reverse, surprising without context, and the result of a real trade-off; a candidate failing any prong is routed to a named destination (a code comment, the repo's existing docs surface, or a CHANGELOG line) instead of being written up — bounding Backfill mode inside the orchestrators' document phases. Handbook and `code-ops-docs/20 Decisions/ADRs` index updated to match.
- **`remediation` states its cold path.** A missing `FINDINGS_REGISTER.md` stops the run and routes to `codebase-audit` / `rigor:bug-hunt` — never synthesize a register from memory.
- **Evals: pre-registered measurement protocol.** `evals/README.md` now requires every model-in-the-loop measurement to pre-register (before the first scored run) its hypothesis, matched arms, n + stopping rule, metric with a minimum practically-significant delta, and an instrument (saturation) check; reports separate observed-delta-vs-noise from practical significance and end with a validity-threats list. Kills the confounded-arms class of calibration error at design time.

## 1.10.0
- **Independent refutation of load-bearing findings (`§1`, `§7`).** A critical/high-severity or fix-driving finding is no longer reported on the strength of the agent that found it. Before it ships at that severity it is handed to an *independent* sub-agent (a `reviewer`/`tracer` in a new **refutation mode**) that did **not** find it, whose sole job is to kill it by locating a dominating guard/handler in a **different function, file, or boundary** — majority-REFUTED drops the finding or downgrades it to SPECULATIVE with the cited guard. This is the adversarial complement to the (self-run) disconfirmation pass, aimed at the cross-function false-positive class self-review structurally misses; an item already proven by an executed repro skips the panel. Scoped to load-bearing findings, so nits are unaffected.
- **Verbatim-anchor citation gate (`§7` schema, `§9`).** Every finding now carries an `Anchor` — a verbatim substring copied from the cited line — so a citation is mechanically checkable. `revalidate-register.mjs` classifies a citation whose cited line no longer contains its anchor as **`DRIFTED`** (fail-closed), alongside FRESH/MOVED/GONE, turning "never fabricate a location" into a deterministic gate that catches a hallucinated or stale citation before it is acted on. Backward-compatible: anchor-less registers are checked exactly as before.
- **Agents made self-contained.** `reviewer` and `explorer` now carry their load-bearing discipline (verbatim anchor, disconfirmation, locate-the-handler) **inline** rather than by a pointer to `CONVENTIONS.md` a spawned subagent cannot always read; `reviewer` gains an explicit refutation mode. Wired into `pr-review` and `codebase-audit`.
- **Eval:** `register-staleness` extended to cover the anchor gate (a FRESH-with-anchor and a `DRIFTED` case), keeping the new mechanical gate under a deterministic CI guard.

## 1.9.0
- **CONVENTIONS hardened from a real-scale (~140k-LOC) calibration of the suite.** The disconfirmation pass (`§7`) gains two false-positive killers — read the cited line's by-design / accepted-deferred annotation, and *locate* the would-be handler before claiming a "nothing else handles this" gap. The operating model (`§1`) self-throttles the fan-out into **bounded waves**, injects the tool-enforced ruleset **inline** into reviewer prompts, **skims-then-deepens** very large files, and **audits the union of slice skipped-sets** at synthesis. A `claims-vs-enforcement` consistency sub-lens (`§10`) and a **headless / non-interactive contract** (`§3`) round it out.
- **Bundled runtime-script hardening (security + correctness).** `lib-docs` rejects a package `types` value that escapes the package dir and an IPv4-mapped-IPv6 SSRF, and caps an oversized streamed fetch chunk. `revalidate-register` classifies an escaping `Location:` citation `AMBIGUOUS` instead of silently re-rooting it `FRESH`. `lib-docs-mcp` returns `-32600` for a malformed method. `lint-plugins` gains empty-description, orphan-bundled-script, and handbook command-reference parity checks; `check-no-deps` now catches multiline and dynamic `import()` bare imports.
- **New: the suite handbook** under `code-ops-docs/40 Engineering/Handbook/` — the 4-plugin mental model, the orchestrators, registers/tiers, a per-command reference for all 55 commands, plus guides and techniques — kept honest by the command-reference parity gate and a fixture-drift CI guard over every eval answer key.

## 1.8.0
- **Runtime-script hardening (security + correctness).** `lib-docs` is now **local-only by default** (`noFetch=true`; opt in to the library-source fallback with `--fetch` / `noFetch:false`), rejects library names that could escape `node_modules` (CLI + MCP), and restricts the fetch fallback to https public hosts (no loopback/private). `revalidate-register` fixes an off-by-one EOF check, stops parsing standards tokens (RFC/CVE/ISO) and version/host strings as references, resolves bare-filename refs (new `AMBIGUOUS` status), and confines reference paths to the repo root. The `code-ops-docs` MCP wrapper validates its required `library` argument.
- **`scan-ai-tells.mjs` now bundled in code-ops-suite** so the `ship` / `pr-split` / `debug` traceless-PR gate has a mechanical floor even when `privacy-opsec-suite` is not installed.
- **Linter (`lint-plugins`) strengthened:** intra-plugin orchestrators validate against their own plugin, qualified `plugin:skill` references must resolve, single-word skill tokens are checked, and it now catches duplicate marketplace entries, unregistered plugin dirs, missing manifest fields, BOM-prefixed frontmatter, and unbundled script references — plus a new `check-no-deps` CI guard for the zero-dependency invariant and SHA-pinned CI actions.
- **Docs reconciled** (install blocks, eval inventory, §-citations).

## 1.7.1
- **Orchestrators refreshed for the 1.4–1.7 additions.** `full-sweep` and `everything` now wire today's capabilities through every phase: they **generate the reference docs** (`architecture` / `data-model` / `api-docs` / `ops-docs` / `adr`) in their document phase; reference the **automation-level ladder** (`§4`), **evidence tiers + disconfirmation** (`§7`), and the **multi-boundary control-coverage** lens (`§10`) in assess/prove; keep carried registers **fresh** (`§12` — re-validate before consuming, mark obsolete); verify library facts via the **in-house docs lookup** (`§2`); and ship results as a **traceless stacked PR** (`pr-split` → `authorship-hygiene`). The fixed `code-normalization` → `normalize` reference is retained. No change to the individual skills.

## 1.7.0
- **New documentation generators: `architecture`, `api-docs`, `data-model`, `adr`, `ops-docs`** (Mode: DOCUMENT) — produce deep, diagram-rich (Mermaid C4 / sequence / ER), code-grounded docs aimed at senior engineers, governed by a new `CONVENTIONS §13` documentation quality standard (layered exec-summary-first structure, diagrams as first-class, every claim cited + verified, freshness-stamped). They **generate** docs; `doc-alignment` maintains them; `onboarding` stays the newcomer path.

## 1.6.0
- **New skill `current-docs` + bundled `lib-docs.mjs` + a `code-ops-docs` MCP server** — an in-house, local-first alternative to Context7. Resolves a library's **installed** version and returns its real README + exported type signatures with zero network (fetch fallback only); no third-party indexer, no query egress. Wired as the default for the `CONVENTIONS §2` documentation-lookup capability across all three plugins, so every skill verifies APIs against the installed version instead of memory. The MCP server (`resolve-library` / `get-docs`) auto-registers when the plugin is enabled.

## 1.5.0
- **New orchestrators `ship` + `debug`** — task-scoped cross-plugin pipelines that compose the conventions end-to-end. `ship` drives one change (feature or one-off) through design-check → safety-net → implement → prove → privacy-gate → traceless PR. `debug` drives a symptom through reproduce → isolate → root-cause (checkpoint) → `fix-verified` → traceless PR. Both require `rigor`; the privacy phase runs when `privacy-opsec-suite` is installed and the change touches a privacy surface.

## 1.4.0
- **New skill `pr-split`** — carves an existing big branch into a clean stack of small, **independently-green** PRs (dependency/concern/atomicity grouping, green-at-every-step), then composes `privacy-opsec-suite:authorship-hygiene` fail-closed before pushing so the commits/PRs carry no AI/tooling trace. Never auto-merges.

## 1.3.0
- **Register freshness (fixes the proven field failure):** CONVENTIONS SSOT (§12) now mandates re-validating a finding against the current tree before it is written, carried across a phase boundary, or consumed; added a `Verified-at: <sha>` field to the Finding/Idea schemas (§7) and bundled `scripts/revalidate-register.mjs` (reports FRESH/MOVED/GONE/NO-REF). `codebase-audit` + `feature-discovery` stamp it; `remediation` runs it at Phase 0.
- **Evidence tiers + disconfirmation** added to the §7 Finding schema (CONFIRMED/PROBABLE/SPECULATIVE + a disconfirmation pass; only CONFIRMED drives an auto-fix) — borrowed from `rigor`.
- **Automation-level ladder** (`gated`/`auto-safe`/`auto-all` + always-gated categories, never auto-merge) promoted into CONVENTIONS §4.
- **Multi-boundary control-coverage** rule added to the Security lens (§10).
- Standardized the audit→discovery handoff on `FEATURE_OPPORTUNITIES.md` (dropped `FEATURE_IDEAS.md`).
- **Descriptions** rewritten to lead with `Use when…` triggers + scope/ownership clauses (orchestrator scope; cross-skill overlap disambiguation, e.g. performance↔improve-measured, pr-review↔deep-review↔opsec-pr-gate, normalize↔consistency-closure).

## 1.2.1
- **Fix:** `full-sweep` Phase 6 referenced a non-existent `code-normalization`
  skill; corrected to `normalize` (the real skill slug / `/code-ops-suite:normalize`).
- **Docs:** the README now lists the `full-sweep` and `everything` orchestrators
  (previously absent from the Skills section); the root README skill count is
  corrected to 14.
- **Packaging:** added an MIT `LICENSE` and a `license` field to the manifest.
- **Tooling:** the marketplace now ships `scripts/lint-plugins.mjs` (structural
  linter) wired into CI, which catches this class of doc/reference drift.

## 1.2.0
- General-engineering suite: `codebase-audit`, `security-privacy-audit`,
  `remediation`, `feature-discovery`, `feature-implementation`, `performance`,
  `test-hardening`, `dependency-upgrade`, `pr-review`, `normalize`,
  `doc-alignment`, `onboarding`, plus the `full-sweep` and `everything`
  orchestrators. `explorer` + `reviewer` subagents; shared `CONVENTIONS.md`.
