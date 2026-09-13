# Plugins and skills

Charter: canonical plugin packages and marketplace registration. Excludes generated host projections and repository gates.

The four packages under `plugins/` are the sole authored runtime surface. Each skill reads its plugin `CONVENTIONS.md`; shared doctrine stays there rather than being duplicated into skills. Structural lint makes that boundary mechanical through section references, copied-prose limits, model floors, handbook parity, and plugin version checks.

Provider parity is behavioral rather than byte-identical. The provider-parity audit now inventories Claude, Codex, installed Grok, and OpenCode across contracts, agents, skills, scripts, hooks, settings, renderers, and runtime evidence. It distinguishes deterministic adapter proof from a live external model turn and records each host API gap instead of treating an absent callback as implemented.

`code-ops-suite` is the integration package. It owns repository scripts, hooks, the documentation MCP surface, the bounded run-contract/context compiler, the long-horizon runtime, and the `repo-docs` orchestrator. Its local-review gate composes rigor and privacy judgment before a pull request while leaving hosted CI deterministic. The other packages divide review depth, privacy posture, and research discovery. Cross-plugin orchestration is deliberately narrow: `everything` and `local-review-gate` are cross-suite entry points, while per-plugin sweeps stay within their package. Every new substantive run uses Run Contract v4; versions 1 through 3 remain readable for replay only.

Vendoring is closed in both directions. Every declared runtime copy must match its root source, and every plugin-local `.mjs` copy must be declared. References from skills, agents, READMEs, and plugin metadata must resolve to a bundled canonical helper. That prevents an unused-looking stale helper or a newly referenced missing helper from escaping the normal forward manifest walk. A façade reference resolves through the `co.mjs` verb table to the script it runs, so it carries the same requirement as the direct path, and a verb the table does not carry fails closed.

Context receipts preserve NUL-delimited Git rename and copy destinations, including non-ASCII paths. Root aliases are canonicalized before symlink containment is judged, hidden index flags block snapshot identity, and one shared helper validates regular stage-0 files without linked components. Atlas freshness output is parsed as a contract for bounded excerpts, and bundle byte counts describe the final serialized payload rather than a pre-update estimate.

Atlas default stamps are content-addressed independently of branch topology. The optional digest frames its algorithm version, exact scope declarations, raw staged index, and raw tracked worktree delta. This preserves reusable judgment after squash while refusing ambiguous index flags and any digest mismatch.

Plugin changes have three coupled outputs: the canonical package, host projections, and marketplace metadata. A new runtime script must enter the vendored manifest when skills reference it. A new skill also changes the plugin README, root count, handbook command reference, and router. Do not patch a generated host copy to solve a canonical-package defect.

The 34-skill code-ops package now carries `local-review-gate`. Its exact-SHA plan, two independent reviewer receipts, remote-ref verification, and optional commit-status publication form the pre-PR judgment boundary. It rejects ambiguous Git index flags before worktree inspection. Run Contract v4 inherits minimized capability evidence and rejects linked or non-regular stable-prefix sources while enforcing the lead-and-operatives work graph. One judgment matrix drives local weekly trend and explicit floor calibration. Worker units omit answer-key paths and record whether execution was available. Judgment plans, findings, and receipts reject linked components, and scoring rejects physical authority aliases before writing.

Shipped GitHub workflow examples are governed dependency surfaces, not illustrative exceptions. They use the same reviewed immutable action pins as the repository workflows, and a plugin patch release carries any example-only dependency refresh through marketplace parity and both host projections.

The documentation skills now share one v4 authority model. `vault` owns genesis and incremental admission, migration, and conformance. `repo-docs` owns bounded extraction, `doc-alignment` reconciles current authority, and `atlas` cites preserved evidence by record ID. The code-ops-suite vendors one records engine so every host executes the same identity, batch, and history rules.

The shared boundary rejects symlinked or drive-qualified paths before reads and writes. Canonical stage-0 blobs own content identity and native metadata. Git's content-aware comparison separates checkout transformations from real edits. Native authority is re-derived from exact path history and its batch-introduction commit. A clone-wide collection lock binds token plus directory identity across sibling worktrees. Cleanup failures preserve ordinary durable success, while ownership loss produces a do-not-retry outcome.

The records engine treats Git process launches as a bounded resource. It batches HEAD-tree comparisons, historical blob hashing, receipt-source validation, and reachable-object recovery. A historical blob above the 32 MiB batch ceiling uses an individual read under Git's 64 MiB process bound; current governed blobs retain the 32 MiB policy. Command-local caches reuse repository format, completeness, and manifest history without carrying state into another operation. Per-path `--follow` queries remain separate because they own rename-lineage evidence.

The traceless scanner is one canonical script shared by the code-ops and privacy packages. Unicode emoji properties keep topology glyphs out of findings. A single-file dash baseline comes only from the same tracked path at an ancestor commit; arbitrary files cannot manufacture an allowance. It subtracts inherited density only, while every attribution, tool, phrase, boilerplate, and emoji rule still scans the complete edited text.

Vault migration must make irreversible judgment durable. The skill plans genesis or incremental admission to a repository-relative ignored receipt. Risky candidates require explicit dispositions. Protected repository review authenticates the unkeyed checksum. Scheduled recovery uses a unique branch in an isolated per-run worktree and never switches the shared checkout.

The canonical package registers six hook commands across five events. `session-receipt.mjs`
runs at `SessionEnd`, prints nothing to the model, and appends one normalized local row on
Claude, Codex, and installed Grok 1.0.13. Claude reads nested subagent transcripts, Codex
follows peer rollout `parent_thread_id` links, and Grok reads cumulative `updates.jsonl`
snapshots with its unavailable ladder arm false. OpenCode has no transcript callback.

There is no `PreCompact` command because Claude and Codex ignore plain stdout from that event.
Their `SessionStart source=compact` path supplies a post-compaction durable-state restore
instruction. Grok ignores passive routing and ladder stdout, so paired instruction files carry
that doctrine. OpenCode uses its native compaction port.

`local-review-gate` is opt-in. `ship` and `pr-split` run the deterministic chain and the lead's diff read on every change and start the model gates only on an operator yes recorded at the checkpoint; the conventions carry the rule as a safety rail.

`digest-rewrite.mjs` is on by default and off per user or repository. It runs as a second
`PreToolUse` stage behind the traceless gate and rewrites an allowlisted simple command through
`updatedInput`, returning no permission decision. Claude, Codex, and installed Grok 1.0.13
accept the projected shape. An on/off comparison is descriptive until a pre-registered matched
control holds host, version, model, work, and stopping rule fixed.

The implementation loops in the code-ops-suite, rigor, and privacy-opsec-suite conventions carry the code-economy ladder: an ordered objective with size last, and six rungs a change climbs before new code is written. Both sentences are pinned through `SHARED_PASSAGES`. A size-and-boundary lens joins the quality lenses and `pr-review`, `normalize` rule F extracts only on the ladder's evidence, and a deliberate simplification is marked `deferred(<ceiling>, <upgrade path>)` for a later harvest.

The ladder has a mechanical floor. `scan-overbuild.mjs` reports eight over-build tells on a git range and blocks only on a package entry with no decision record; `evals/overbuild-garden` scores it against planted over-builds and decoy extractions. `harvest-deferrals.mjs` turns `deferred(...)` markers into a register with stable ids. `ladder-card.mjs` is on by default for Claude and Codex implementer operatives. Grok and OpenCode rely on their instruction files because neither exposes a usable ladder-card callback.

The index is query-able. `context-query.mjs` answers find, callers, callees, blast, and explore with anchors and edge lists over a home-directory index, prints its ceiling on every edge result, and carries a stale banner for a file changed since the build. `symbol-lib.mjs` is the single source for definitions, spans, call sites, and import edges across the map, graph, skim, and query readers. The index-refresh hook is on by default, with an explicit environment switch.

Run contracts can bind explicit per-unit token budgets and a bounded premium frontier specialist without promoting that model into ordinary fan-out. Acceptance parsing is shared with runtime status, so partial acceptance survives checkpoints while finalization retains the blocking verdict. Worker briefs and context views are complete, byte-bounded artifacts with receipts; overflow fails without truncating or replacing prior output.

The attack-chain graph turns security exploration into a receipted work graph. Parallel units must cover distinct exploit families, hypothesis launches remain immutable, direct implementation-layer inspection is hypothesis-bound, and independent validators cannot reuse the discovering actor or receipt. Final mode accepts only a realistic entry-to-impact chain with structured success evidence; in-progress mode ranks exact blocked-terminal to reachable-open-entry resumptions without declaring success.

Measurement instruments the loop. Each supported-host receipt records the mechanisms that can
run there and the context resident at session end. `context-audit.mjs receipts --by-arm` groups
that evidence, but causal token or workflow claims remain pending until a pre-registered matched
control is complete.
