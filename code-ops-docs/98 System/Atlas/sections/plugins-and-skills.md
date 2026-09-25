# Plugins and skills

Charter: canonical plugin packages and marketplace registration. Excludes generated host projections and repository gates.

The four packages under `plugins/` are the sole authored runtime surface. Each skill reads only the cited sections of its plugin `CONVENTIONS.md` plus the writing standard, and lint check 28 requires the sentence "Leave the rest of that file unread." wherever a skill names the file, and exploring skills consult the atlas and symbol index first; shared doctrine stays there rather than being duplicated into skills. Structural lint makes that boundary mechanical through section references, copied-prose limits, a 160-character skill description cap, model floors, handbook parity, and plugin version checks.

Provider parity is behavioral rather than byte-identical. The provider-parity audit now inventories Claude, Codex, installed Grok, and OpenCode across contracts, agents, skills, scripts, hooks, settings, renderers, and runtime evidence. It distinguishes deterministic adapter proof from a live external model turn and records each host API gap instead of treating an absent callback as implemented. A `--since <sha>` run narrows that inventory to changed surfaces and their projections, and carries forward a host profile only while that host's version and renderer are unchanged.

`code-ops-suite` is the integration package. It owns repository scripts, hooks, the documentation MCP surface, the bounded run-contract/context compiler, the long-horizon runtime, and the `repo-docs` orchestrator. Its local-review gate composes rigor and privacy judgment before a pull request while leaving hosted CI deterministic. The other packages divide review depth, privacy posture, and research discovery. Cross-plugin orchestration is deliberately narrow: `everything` and `local-review-gate` are cross-suite entry points, and `everything` selects plugins with `plugins: suite,rigor,privacy`. The intra-plugin orchestrators, `research-sweep` and `conform`, stay within their package. Every new substantive run uses Run Contract v4; versions 1 through 3 remain readable for replay only.

Vendoring is closed in both directions. Every declared runtime copy must match its root source, and every plugin-local `.mjs` copy must be declared. References from skills, agents, READMEs, and plugin metadata must resolve to a bundled canonical helper. That prevents an unused-looking stale helper or a newly referenced missing helper from escaping the normal forward manifest walk. A façade reference resolves through the `co.mjs` verb table to the script it runs, so it carries the same requirement as the direct path, and a verb the table does not carry fails closed.

Execution specs vendor the same way. Six hub technique pages ship byte-identical under `plugins/<plugin>/reference/`, declared per plugin in the vendored manifest. `code-ops-suite`, `rigor`, and `privacy-opsec-suite` each carry `artifact-grammars.md`, and only `code-ops-suite` carries the other five. The hub page stays the source; an edited copy or an undeclared reference file fails lint.

Shipped text must resolve in an installed plugin. Skills, conventions, READMEs, hooks, and printed script messages cite a bundled `${CLAUDE_PLUGIN_ROOT}/reference/` spec, a `<repo>-docs/` path in the target repository, or a link marked as living in the code-ops repository. Lint rejects an unmarked hub path, repository-root command, or repository-root citation, and a plugin-root path to a file the plugin does not ship. A marker covers only its own Markdown block. A skill whose whole subject is this repository opts out through a `**Runs in:** the code-ops repository` Mode line, which `provider-parity-audit` carries.

Context receipts preserve NUL-delimited Git rename and copy destinations, including non-ASCII paths. Root aliases are canonicalized before symlink containment is judged, hidden index flags block snapshot identity, and one shared helper validates regular stage-0 files without linked components. Atlas freshness output is parsed as a contract for bounded excerpts, and bundle byte counts describe the final serialized payload rather than a pre-update estimate.

Atlas default stamps are content-addressed independently of branch topology. The optional digest frames its algorithm version, exact scope declarations, raw staged index, and raw tracked worktree delta. This preserves reusable judgment after squash while refusing ambiguous index flags and any digest mismatch.

Plugin changes have three coupled outputs: the canonical package, host projections, and marketplace metadata. A new runtime script must enter the vendored manifest when skills reference it. A new skill also changes the plugin README, root count, handbook command reference, and router. Do not patch a generated host copy to solve a canonical-package defect.

The 34-skill code-ops package now carries `local-review-gate`. Its exact-SHA plan, two independent reviewer receipts, remote-ref verification, and optional commit-status publication form the pre-PR judgment boundary. It rejects ambiguous Git index flags before worktree inspection. Run Contract v4 inherits minimized capability evidence and rejects linked or non-regular stable-prefix sources while enforcing the lead-and-operatives work graph. One judgment matrix drives local weekly trend and explicit floor calibration. Worker units omit answer-key paths and record whether execution was available. Judgment plans, findings, and receipts reject linked components, and scoring rejects physical authority aliases before writing.

Shipped GitHub workflow examples are governed dependency surfaces, not illustrative exceptions. They use the same reviewed immutable action pins as the repository workflows, and a plugin patch release carries any example-only dependency refresh through marketplace parity and both host projections.

The documentation skills now share one v4 authority model. `vault` owns genesis and incremental admission, migration, and conformance. `repo-docs` owns bounded extraction, `doc-alignment` reconciles current authority, and `atlas` cites preserved evidence by record ID. The code-ops-suite vendors one records engine so every host executes the same identity, batch, and history rules.

The shared boundary rejects symlinked or drive-qualified paths before reads and writes. Canonical stage-0 blobs own content identity and native metadata. Git's content-aware comparison separates checkout transformations from real edits. Native authority is re-derived from exact path history and its batch-introduction commit. A clone-wide collection lock binds token plus directory identity across sibling worktrees. Cleanup failures preserve ordinary durable success, while ownership loss produces a do-not-retry outcome.

The records engine treats Git process launches as a bounded resource. It batches HEAD-tree comparisons, historical blob hashing, receipt-source validation, and reachable-object recovery. A historical blob above the 32 MiB batch ceiling uses an individual read under Git's 64 MiB process bound; current governed blobs retain the 32 MiB policy. Command-local caches reuse repository format, completeness, and manifest history without carrying state into another operation. Per-path `--follow` queries remain separate because they own rename-lineage evidence.

The traceless scanner is one canonical script shared by the code-ops and privacy packages. Unicode emoji properties keep topology glyphs out of findings. A single-file dash baseline comes only from the same tracked path at an ancestor commit; arbitrary files cannot manufacture an allowance. It subtracts inherited density only, while every attribution, tool, phrase, boilerplate, and emoji rule still scans the complete edited text. Its `--command` mode lets the `enforce-traceless` hook scan the raw command and, one per line, every message, trailer, title, body, and field value a `git commit` or `gh` publishing command would publish. A trailer inside a second `-m`, a `--trailer`, or an inline `--body` therefore reaches the line-anchored rule without widening it.

Vault migration must make irreversible judgment durable. The skill plans genesis or incremental admission to a repository-relative ignored receipt. Risky candidates require explicit dispositions. Protected repository review authenticates the unkeyed checksum. Scheduled recovery uses a unique branch in an isolated per-run worktree and never switches the shared checkout.

The canonical package registers ten hook commands across seven events. `handoff-card.mjs` runs
at `UserPromptSubmit` on Claude and Codex, reads only the transcript tail, and asks the lead to
assess CONTINUE, COMPACT, or HANDOFF at each 150,000-token band; it does not execute a transition
or prove that the host displayed the advice (plugins/code-ops-suite/hooks/handoff-card.mjs:4,
plugins/code-ops-suite/hooks/handoff-card.mjs:120). Grok discards UserPromptSubmit stdout and
receives the same note as PostToolUse additionalContext. At or above the context ceiling, the
note on Claude and Codex adds that new dispatches are gated. OpenCode carries the note, the
round stop, the wide-type deny, and the ceiling gate in its lifecycle plugin. `routing-card.mjs` lists, but does not resume, up to 3 unconsumed pending handoffs by session
name on a fresh session, and treats that session as new work unless the operator resumes one
(plugins/code-ops-suite/hooks/routing-card.mjs:148). `dispatch-guard.mjs` runs at `PreToolUse` on every thread: inside a subagent it counts
attempted tool calls against an explicit host-agent binding or, when no binding exists, the
`Round budget:` line of the subagent's own brief, read once from its transcript and clamped to
120, else the environment/default budget. It stops the unbound counter at twice the budget, and
its warning and stop both ask for a checkpoint written to the brief's report path
(plugins/code-ops-suite/hooks/dispatch-guard.mjs:155, plugins/code-ops-suite/hooks/dispatch-guard.mjs:164). On the lead's
own dispatch (Claude's `Agent`, `Task`, or `Workflow`, or Grok's `spawn_subagent`) it denies a wide-surface or unnamed agent type whose brief has no `Wide-surface
reason:` line, denies a suite-agent dispatch whose brief lacks a field the target agent's
`## Contract` lists on its `Brief requires:` line, and denies new dispatches past the context
ceiling until a handoff assessment records the band (plugins/code-ops-suite/hooks/dispatch-guard.mjs:13, plugins/code-ops-suite/hooks/dispatch-guard.mjs:600).
`peer-guard.mjs` also runs at `PreToolUse`. It denies a `SendMessage` or desktop `send_message`
call to a peer session whose run folder holds `HANDOFF.md` or `HANDOFF.consumed`, and names the
live successor to resend to (plugins/code-ops-suite/hooks/peer-guard.mjs:17).
`session-receipt.mjs`
runs at `SessionEnd`, prints nothing to the model, and appends one normalized local row on
Claude, Codex, and installed Grok 1.0.13. Claude reads nested subagent transcripts, Codex
follows peer rollout `parent_thread_id` links, and Grok reads cumulative `updates.jsonl`
snapshots with its unavailable ladder arm false. OpenCode has no transcript callback. Each row
also counts skill invocations by id in `skills`. `subagent-report.mjs` runs at `SubagentStop`, and the
Codex projection registers it too. It checks a suite agent's final report against that agent's `Verdicts:` and
`Report cap:` lines. It only prints an operator note, never blocks, and stays silent under Grok.

There is no `PreCompact` command because Claude and Codex ignore plain stdout from that event.
Their `SessionStart source=compact` path supplies a post-compaction durable-state restore
instruction that names the session and its own run folder when a session record binds them
(plugins/code-ops-suite/hooks/routing-card.mjs:142). Grok ignores passive routing and ladder stdout, so paired instruction files carry
that doctrine. OpenCode uses its native compaction port.

`local-review-gate` is opt-in. `ship` and `pr-split` run the deterministic chain and the lead's diff read on every change and start the model gates only on an operator yes recorded at the checkpoint; the conventions carry the rule as a safety rail.

`digest-rewrite.mjs` is on by default and off per user or repository. It runs as a second
`PreToolUse` stage behind the traceless gate and rewrites an allowlisted simple command through
`updatedInput`, returning no permission decision. Claude, Codex, and installed Grok 1.0.13
accept the projected shape. An on/off comparison is descriptive until a pre-registered matched
control holds host, version, model, work, and stopping rule fixed.

The implementation loops in the code-ops-suite, rigor, and privacy-opsec-suite conventions carry the code-economy ladder: an ordered objective with size last, and six rungs a change climbs before new code is written. Both sentences are pinned through `SHARED_PASSAGES`. A size-and-boundary lens joins the quality lenses and `rigor:deep-review` at `bar: standard`, `normalize` rule F extracts only on the ladder's evidence, and a deliberate simplification is marked `deferred(<ceiling>, <upgrade path>)` for a later harvest.

The ladder has a mechanical floor. `scan-overbuild.mjs` reports eleven over-build tells on a git range and blocks only on a package entry with no decision record; `evals/overbuild-garden` scores it against planted over-builds and decoy extractions. `harvest-deferrals.mjs` turns `deferred(...)` markers into a register with stable ids. `ladder-card.mjs` is on by default for Claude and Codex implementer operatives. Grok and OpenCode rely on their instruction files because neither exposes a usable ladder-card callback.

The index is query-able. `context-query.mjs` answers find, callers, callees, blast, and explore with anchors and edge lists over a home-directory index, prints its ceiling on every edge result, and carries a stale banner for a file changed since the build. `symbol-lib.mjs` is the single source for definitions, spans, call sites, and import edges across the map, graph, skim, and query readers. The index-refresh hook is on by default, with an explicit environment switch.

Run contracts can bind explicit per-unit token budgets and a bounded premium frontier specialist without promoting that model into ordinary fan-out. Acceptance parsing is shared with runtime status, so partial acceptance survives checkpoints while finalization retains the blocking verdict. Worker briefs and context views are complete, byte-bounded artifacts with receipts; overflow fails without truncating or replacing prior output.

The attack-chain graph turns security exploration into a receipted work graph. Parallel units must cover distinct exploit families, hypothesis launches remain immutable, direct implementation-layer inspection is hypothesis-bound, and independent validators cannot reuse the discovering actor or receipt. Final mode accepts only a realistic entry-to-impact chain with structured success evidence; in-progress mode ranks exact blocked-terminal to reachable-open-entry resumptions without declaring success.

Measurement instruments the loop. Each supported-host receipt records the mechanisms that can
run there, the context resident at session end, and reminder/invocation telemetry: the highest
handoff-card band and whether the operator invoked handoff. Neither field identifies a selected
lifecycle action or proves an outcome. The arm set also carries pending-handoff pickup and the
dispatch guard, each read from its own switch, and a guard set to `warn` records the arm on.
`context-audit.mjs receipts --by-arm` groups that evidence, but causal token or workflow claims
remain pending until a pre-registered matched control is complete.
Report persistence is pinned across all four conventions. A brief's report path governs over an agent definition's default reporting instruction. An operative with a write tool writes its report to that path and returns only a pointer, and a read-only operative returns its report inline for the lead to persist. Three of the eleven shipped agents hold a file-write tool. The sonnet-floor `mech` and `mech-review` agents take mechanical work and its review, and every agent carries a `## Contract` section that lint check 26 parses. The verifier writes its report to a named path and never edits the source under evaluation. The implementer edits only inside its brief's Scope and writes its report to the brief's path. A dispatch costs context times turns, so the code-ops-suite conventions bind build, fix, and refactor units to the shipped implementer rather than a general-purpose agent, and every brief names a round budget, 40 tool rounds by default. Every agent definition carries a `Report cap:` line that lint check 25 holds between 100 and 800 words. The hook enforces a registered budget only after explicit registration against a known host agent ID; otherwise it binds the brief's `Round budget:` line, then the legacy fallback. A missing, empty, or malformed report file fails the pinned shape gate exactly as a malformed inline report does.

New substantive version-4 runs route each unit by assigned task, role floor, and ambiguity; each records its rationale, while a frontier peer remains a bounded exception with lead-owned stopping and blocking criteria (plugins/code-ops-suite/CONVENTIONS.md:20). Lifecycle assessment preserves the same task's recorded authority limits, requires a durable checkpoint before compact or handoff, and treats unavailable host actions and unobserved telemetry as unavailable or `UNKNOWN`, never as completed work (plugins/code-ops-suite/skills/handoff/SKILL.md:71, plugins/code-ops-suite/skills/handoff/SKILL.md:169).
Each of the four conventions now ends with a pinned Code standard section holding one core clause. The section carries no hub path because the packages ship to repositories without this hub; the full rules and their backstops live in the hub's code-standard technique page.

Explicit dispatch registration uses hashed working-directory and agent keys, refuses replacement, and preserves legacy call counts. Bound workers receive a small checkpoint allowance without extending the legacy cap. Receipts expose attempted-call counts; unavailable provider usage and effective runtime budget remain UNKNOWN.

`conform` checks surface 3 with `atlas-check.mjs check --gate --claims-gate`. A STALE section, or a claim that is MOVED, DRIFTED, or GONE, makes the surface DRIFTED, never CONFORMANT. The suite's atlas trust rule matches: a FRESH section does not vouch for a claim reported DRIFTED or GONE.
