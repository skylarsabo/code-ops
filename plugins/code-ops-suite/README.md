# code-ops-suite

Adaptive, multi-agent engineering workflows for **any codebase**. This repository authors the
canonical Claude Code package and renders a native Codex package from it. In Claude Code,
invoke a workflow as `/code-ops-suite:<name>`. In Codex, name `code-ops-suite:<name>` in your
request. Each workflow runs a dynamic, conflict-aware multi-agent loop and checks in with you
at the decisions that matter. Shared rules live once in `CONVENTIONS.md`, which every skill
reads first.

New to the suite? Read the handbook at `code-ops-docs/40 Engineering/Handbook/` (from the repo
root).

## Skills

Invoke a skill with `/code-ops-suite:<name>` in Claude Code or `code-ops-suite:<name>` in
Codex. You can also let the model route to a skill through the standard-operating-mode routing
card. Side-effect-bearing phases keep their checkpoints, and nothing ever auto-merges.

**Assess**
- `codebase-audit`: broad multi-lens review of the whole codebase. It applies safe fixes and writes a ranked findings backlog (`FINDINGS_REGISTER.md`).
- `security-privacy-audit`: adversarial STRIDE and LINDDUN threat assessment, focused on attack surface and deanonymization (`THREAT_MODEL.md`, findings).

**Build** (writes code)
- `remediation`: implements the findings backlog (NEEDS-REVIEW and NEEDS-DESIGN) safely, with tests.
- `feature-discovery`: finds and specifies high-value, grounded features (register, specs, roadmap).
- `feature-implementation`: builds specified features, smallest valuable slice first, behind flags.

**Deep-dives** (writes code)
- `performance`: measure, optimize what is proven hot, then prove the gain with before-and-after numbers.
- `test-hardening`: meaningful, deterministic coverage on critical paths, through characterization and regression tests.
- `dependency-upgrade`: safe, staged upgrades and CVE remediation. It never bulk-bumps.
- `normalize`: one consistent professional style repo-wide, behavior-preserving, with the artifacts of hasty or generated code removed.

**Gate**
- `pr-review`: rigorous pre-merge review of one PR or diff against all lenses, ending in prioritized comments and a verdict.
- `local-review-gate`: runs deep review and OpSec judgment locally against the final committed diff, records SHA-bound receipts, and publishes optional commit statuses before a PR exists. It also plans and scores local judgment evals.
- `pr-split`: carves an existing big branch into a clean stack of small, independently-green PRs, scrubbed of AI and tooling trace (composes `privacy-opsec-suite:authorship-hygiene`, fail-closed). It never auto-merges.

**Docs and knowledge**
- `adopt-standards`: bootstraps or maintains a repo's `CLAUDE.md` standards contract, so the contract is mechanically kept rather than aspirational.
- `adopt-global-standards`: the cross-repo counterpart. It re-verifies the user's global `~/.claude/CLAUDE.md` against the marketplace's SSOT pages, classifies every divergence, and rewrites the file under checkpoint.
- `doc-alignment`: reconciles doc drift against code and establishes a clean single source of truth.
- `repo-docs`: extracts and refreshes only the affected documentation domains from one manifest-owned documentation hub.
- `onboarding`: generates a verified, code-grounded orientation guide with an architecture diagram.
- `current-docs`: current, version-accurate docs for a library, read from the version installed in this project. It is local-first with no third-party indexer. The same capability ships as the `code-ops-docs` MCP server (`resolve-library` and `get-docs`) and is the `CONVENTIONS §2` documentation-lookup default suite-wide.
- `atlas`: builds, refreshes, or consolidates the repo's atlas (`code-ops-docs/98 System/Atlas/`), a durable cache of judgment about the codebase. Per-section freshness is decided mechanically against the diff since each section's stamp.
- `vault`: scaffolds, migrates, or checks the repo's `<repo>-docs/` Obsidian vault against the one layout standard. `check-vault-standard.mjs` decides conformance fail-closed.
- `handoff`: captures a long run's true state as a verifiable `HANDOFF.md` before a context limit or session end, or resumes from one after re-verifying every claim against the tree.

**Suite self-audit**
- `calibration-run`: standardized real-scale calibration of the suite against a target repo, isolated and assess-only. It ends in a validated sanitized note appended to `evals/CALIBRATION_TABLE.md`. The channel is one-way, so target internals never cross back.
- `run-cost-audit`: audits a completed run's cost discipline (dispatch counts, artifact sizes, tier and effort mix) against the suite's own bounded-wave and routing doctrine (`COST_AUDIT.md`).
- `provider-parity-audit`: audits the marketplace's own prose for provider-specific assumptions the mechanical Codex render cannot catch, then classifies and registers each hit.

**Documentation generation** (Mode: DOCUMENT, code-grounded and Mermaid-diagram docs per `CONVENTIONS §13`)
- `architecture`: deep architecture reference. It covers C4 structure (context, container, component), critical-path sequence flows, cross-cutting concerns, and key decisions.
- `api-docs`: accurate API or interface reference for HTTP, GraphQL, and RPC endpoints or a library's exports. It carries signatures, request and response shapes, auth, errors, and real examples, all taken from the code and types.
- `data-model`: data-model reference. It carries an ER diagram plus per-entity fields, relationships, constraints, the invariants the code relies on, and schema evolution.
- `adr`: Architecture Decision Records. It backfills the load-bearing past decisions or authors a new one (context, options, decision, consequences), grounded in code.
- `ops-docs`: the operator's runbook. It covers deploy and rollback, the configuration reference, incident runbooks, and health and observability.

**Orchestrators**
- `full-sweep`: runs the whole suite end-to-end as one developer-in-the-loop pipeline, pausing at each phase boundary. Intra-plugin.
- `everything`: the cross-plugin superset. It orchestrates every phase across all three plugins and requires `rigor` and `privacy-opsec-suite` installed. It is the most thorough and most token-expensive option.
- `ship`: implements one change (feature or one-off) end-to-end at full rigor, from design-check to a traceless PR. It requires `rigor` and the local review dependencies.
- `conform`: assesses every standardization surface of a repo in one read-only pass, writes `CONFORMANCE_REPORT.md`, then repairs surface by surface under checkpoint by delegating to the skill that owns each one.
- `debug`: drives a bug from symptom to a proven root-cause fix, ending in a traceless PR. It requires `rigor`.

## Subagents

The skills fan work out to two bundled subagents, and spawn ephemeral ones as needed:
- `explorer`: read-only, fast tier, for parallel codebase investigation (structure, call-sites, flow). It never edits.
- `reviewer`: strong tier, for parallel review of diffs and file-groups. It returns prioritized findings and never edits.

Subagents are not free, because each one isolates context from the main agent. The skills use
them where isolation genuinely helps, such as parallel exploration and sandboxed review, rather
than reflexively.

## Conventions

`CONVENTIONS.md` (bundled at the plugin root) is the shared backbone. It carries the
orchestration model, the developer-in-the-loop interaction protocol, the safety rails (branch,
tests-green, redact secrets, never fabricate), the modes, the finding and fix tracks, the
schemas, the severity taxonomy, the quality-lens definitions, the implementation loop, and the
single-source-of-truth conventions. Each skill references it by section.

To apply the conventions always, not only inside a skill, add a pointer in your repo's
`CLAUDE.md`:
> This repo follows the conventions in the code-ops-suite plugin (`CONVENTIONS.md`): developer-in-the-loop, behavior-preserving changes, evidence (`file:line`) on every finding, secrets and PII redacted, and the quality lenses defined there.

## Loops and automation

Each mechanism below is on unless its named switch says otherwise. Set a switch to `off`, `0`,
or `false` in the `env` block of a `.claude/settings.json`, at the user or the repository
level. `code-ops-docs/50 Platform/INFRASTRUCTURE.md` owns the full switch list.

- **Tool-layer traceless gate:** a bundled `PreToolUse` hook (`hooks/hooks.json` plus `hooks/enforce-traceless.mjs`) scans a `git commit` or `gh pr create|merge` Bash call for AI and tool trace before it runs, and blocks on a hit. CI stays the fail-closed backstop.
- **Output digest, on by default:** a second bundled `PreToolUse` hook (`hooks/digest-rewrite.mjs`) rewrites an allowlisted simple Bash command into a `scripts/digest.mjs` run, so its output arrives compressed with a receipt naming the raw file. `CODE_OPS_DIGEST=off` turns it off, and `CODE_OPS_DIGEST_STORE=off` keeps the compression while writing no raw file.
- **File outline before file body:** `scripts/skim.mjs <file>` prints a file's headings, definitions, keys, and line numbers, and never a body. The next call reads `--range A,B` instead of the whole file.
- **Code-economy floor:** `scripts/co.mjs scan overbuild --git <range>` reports eight over-build tells on a diff and blocks only on an unrecorded dependency. `scripts/co.mjs scan deferrals` collects `deferred(<ceiling>, <upgrade path>)` markers into a register that `revalidate-register.mjs` re-greps. A `SubagentStart` hook (`hooks/ladder-card.mjs`, off with `CODE_OPS_LADDER_CARD=off`) hands implementer subagents the ladder as a ten-line card.
- **Query-able symbol index:** `scripts/context-query.mjs find|callers|callees|blast|explore` answers a structural question with `file:line` anchors and edge lists, rather than a map or a verbatim dump, over a home-directory index keyed by content sha. A `PostToolUse` hook (`hooks/index-refresh.mjs`, off with `CODE_OPS_INDEX=off`) re-indexes each edited file. `skim.mjs` shares the definition rules through `symbol-lib.mjs`. `refresh --provider ctags|codegraph` merges an installed provider's definitions when one is present, and says so when one is not. The `code-ops-query` MCP server (`scripts/context-query-mcp.mjs`) offers the same queries as the tools `context_query` and `context_refresh`, so a host with no shell reaches them.
- **One entrypoint over the scripts:** `scripts/co.mjs <domain> <verb> [args...]` resolves a verb to the canonical script beside it and passes the arguments through unchanged. `co --help` lists every domain and verb in one screen. The scan domain reaches the gates as `co scan ai-tells`, `co scan narration`, `co scan redaction`, `co scan overbuild`, and `co scan deferrals`. `scripts/cli-lib.mjs` is the shared flag parser under those scripts.
- **Session-start routing card:** a bundled `SessionStart` hook (`hooks/routing-card.mjs`) prints a hard-capped routing card mapping task types to the right skill or orchestrator, so the lead defaults into standard operating mode from the first turn.
- **Compaction preservation:** a bundled `PreCompact` hook (`hooks/precompact-preserve.mjs`) hands the host the six items a compaction summary must keep, so a compacted session resumes without redoing work or losing a stated constraint.
- **Session receipts:** a bundled `SessionEnd` hook (`hooks/session-receipt.mjs`) appends one row per session to a home-directory ledger, which never leaves the machine. Each row records which mechanisms were on. `scripts/context-audit.mjs receipts --by-arm` groups the rows by that arm so a measurement has a control, and `receipts --purge-before <ISO date>` is the retention command. `CODE_OPS_RECEIPTS=off` turns the receipts off, and any other value names the ledger path. `code-ops-docs/55 Operations/MEASUREMENTS.md` owns the measurement method.
- **In-session loop:** run a skill repeatedly toward its "Done when" criteria with the built-in `/loop`.
- **Before every PR:** run `local-review-gate` against the final committed diff when the operator opted in. Keep deterministic tests in hosted CI, and publish the local SHA-bound statuses when branch protection requires them.
- **Recurring maintenance:** put `dependency-upgrade` and `security-privacy-audit` on a schedule with Routines (`/schedule`).
- **Deterministic work goes to deterministic tools:** wire a formatter and a linter into a pre-commit hook, a dependency bot for CVEs, SAST for the security baseline, and coverage gates in CI. Reserve the skills for the judgment-heavy work: audit, threat model, feature discovery, and intricate-bug hunting.

## How the skills chain

Registers are live backlogs with stable IDs (`PERF-007` → register → commit or PR → log):
- `codebase-audit` / `security-privacy-audit` / deep-dives → `FINDINGS_REGISTER.md` → `remediation` → `pr-review`
- `feature-discovery` → specs → `feature-implementation` → `pr-review`
- every build skill keeps docs current, `doc-alignment` establishes the SSOT, and `onboarding` sits inside it

## Notes

- The suite works on any stack. Skills self-detect tooling and match the repo's existing conventions rather than imposing new ones.
- Optional tools (a docs-lookup MCP, version-control history, a browser or UI tool) are used when connected and skipped otherwise.
- The privacy and data-handling lens scales to how much sensitive data the system actually handles.
