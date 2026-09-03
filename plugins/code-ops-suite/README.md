# code-ops-suite

Adaptive, multi-agent engineering workflows for **any codebase**, authored here as the canonical Claude Code package and rendered into a native Codex package. In Claude Code invoke a workflow as `/code-ops-suite:<name>`; in Codex name `code-ops-suite:<name>` in your request. They run a dynamic, conflict-aware multi-agent loop and check in with you at the decisions that matter. Shared rules live once in `CONVENTIONS.md`, which every skill reads first.

New to the suite? See the handbook at `code-ops-docs/40 Engineering/Handbook/` (from the repo root) to learn to use it.

## Skills

Invoke with `/code-ops-suite:<name>` in Claude Code or `code-ops-suite:<name>` in Codex, or let the model route to a skill per the standard-operating-mode routing card. Side-effect-bearing phases keep their checkpoints and nothing ever auto-merges.

**Assess**
- `codebase-audit` — broad multi-lens review of the whole codebase; applies safe fixes, writes a ranked findings backlog (`FINDINGS_REGISTER.md`).
- `security-privacy-audit` — adversarial STRIDE + LINDDUN threat assessment; attack surface and deanonymization focus (`THREAT_MODEL.md`, findings).

**Build** (writes code)
- `remediation` — implements the findings backlog (NEEDS-REVIEW / NEEDS-DESIGN) safely, with tests.
- `feature-discovery` — finds + specifies high-value, grounded features (register, specs, roadmap).
- `feature-implementation` — builds specified features, smallest valuable slice first, behind flags.

**Deep-dives** (writes code)
- `performance` — measure → optimize what's proven hot → prove it with before/after numbers.
- `test-hardening` — meaningful, deterministic coverage on critical paths; characterization + regression tests.
- `dependency-upgrade` — safe, staged upgrades + CVE remediation; never bulk-bumps.

**Gate / consistency**
- `pr-review` — rigorous pre-merge review of one PR/diff against all lenses; prioritized comments + verdict.
- `local-review-gate` — runs deep review and OpSec judgment locally against the final committed diff, records SHA-bound receipts, and publishes optional commit statuses before a PR exists; also plans and scores local judgment evals.
- `normalize` — one consistent professional style repo-wide; removes the artifacts of hasty/generated code; behavior-preserving.
- `pr-split` — carve an existing big branch into a clean stack of small, independently-green PRs, scrubbed of AI/tooling trace (composes `privacy-opsec-suite:authorship-hygiene`, fail-closed); never auto-merges.

**Docs / knowledge**
- `adopt-standards` — bootstrap or maintain a repo's `CLAUDE.md` standards contract so it's mechanically kept, not aspirational.
- `adopt-global-standards` — the cross-repo counterpart: re-verify the user's global `~/.claude/CLAUDE.md` against the marketplace's SSOT pages, classify every divergence (contradicts / stale / missing / repo-local), and rewrite it under checkpoint.
- `doc-alignment` — reconcile doc drift against code; establish a clean single source of truth.
- `repo-docs` — extract and refresh only affected documentation domains from one manifest-owned repository documentation hub.
- `onboarding` — generate a verified, code-grounded orientation guide with an architecture diagram.
- `current-docs` — current, version-accurate docs for a library from the version installed in this project (local-first, no third-party) — the in-house Context7 alternative. Also shipped as the `code-ops-docs` MCP server (`resolve-library` / `get-docs`) and wired as the `CONVENTIONS §2` documentation-lookup default suite-wide.
- `atlas` — build, refresh, or consolidate the repo's atlas (`code-ops-docs/98 System/Atlas/`): a durable cache of judgment about the codebase — rationale, cross-file flows, invariants, gotchas — with per-section freshness decided mechanically against the diff since each section's stamp.
- `vault` — scaffold, migrate, or check the repo's `<repo>-docs/` Obsidian vault against the one layout standard: numbered folders, a versioned self-contained `Standard.md`, and note frontmatter, with conformance decided fail-closed by `check-vault-standard.mjs`.
- `handoff` — capture a long run's true state (decisions, dead ends, in-flight boundaries, anchored pointers, register paths) as a verifiable `HANDOFF.md` before a context limit or session end — or resume from one, re-verifying every claim against the tree first.

**Meta / suite self-audit**
- `calibration-run` — standardized real-scale calibration of the suite against a target repo, isolated and assess-only, ending in a validated sanitized note appended to `evals/CALIBRATION_TABLE.md`. One-way channel: target internals never cross back.
- `run-cost-audit` — audits a completed run's cost discipline (dispatch counts, artifact sizes, tier/effort mix) against the suite's own bounded-wave and routing doctrine (`COST_AUDIT.md`).
- `provider-parity-audit` — audits the marketplace's own prose for provider-specific assumptions the mechanical Codex render can't catch; classifies and registers each hit.

**Documentation generation** (Mode: DOCUMENT — beautiful, code-grounded, Mermaid-diagram docs per `CONVENTIONS §13`)
- `architecture` — deep architecture reference: C4 structure (context → container → component), critical-path sequence flows, cross-cutting concerns, and key decisions.
- `api-docs` — accurate API/interface reference (HTTP/GraphQL/RPC endpoints or a library's exports): signatures, request/response shapes, auth, errors, real examples — from the code/types.
- `data-model` — data-model reference: an ER diagram + per-entity fields, relationships, constraints, and the invariants the code relies on, plus schema evolution.
- `adr` — Architecture Decision Records: backfill the load-bearing past decisions or author a new one (context / options / decision / consequences), code-grounded.
- `ops-docs` — the operator's runbook: deploy/rollback, configuration reference, incident runbooks (symptom → diagnosis → fix), and health/observability.

**Orchestrators**
- `full-sweep` — run the whole suite end-to-end as one developer-in-the-loop pipeline (ground truth → assess → safety-net → fix → deep-dives → consistency → capture), pausing at each phase boundary. Intra-plugin.
- `everything` — the cross-plugin superset: orchestrates every phase across all three plugins (map → prove → leak-audit → safety-net → remediate → close → improve → normalize). Requires `rigor` and `privacy-opsec-suite` installed; the most thorough and most token-expensive option.
- `ship` — implement one change (feature or one-off) end-to-end at full rigor: design-check → safety-net → implement → prove → local review gate → traceless PR. Requires `rigor` and local review dependencies.
- `conform` — assess every standardization surface of a repo in one read-only pass (standards contract, `<repo>-docs/` vault, `code-ops-docs/98 System/Atlas/`, doc drift, and opt-in the global contract), write `CONFORMANCE_REPORT.md`, then repair surface by surface under checkpoint by delegating to the skill that owns each one.
- `debug` — drive a bug from symptom to a proven root-cause fix: reproduce → isolate → confirm cause → `rigor:fix-verified` → traceless PR. Requires `rigor`.

## Subagents
The skills fan work out to two bundled subagents (and spawn ephemeral ones as needed):
- `explorer` — read-only, fast model; parallel codebase investigation (structure, call-sites, flow). Never edits.
- `reviewer` — strong model; parallel review of diffs/file-groups; returns prioritized findings. Never edits.

Subagents aren't free — they isolate context from the main agent — so the skills use them where isolation genuinely helps (parallel exploration, sandboxed review), not reflexively.

## Conventions
`CONVENTIONS.md` (bundled at the plugin root) is the shared backbone: the orchestration model, the developer-in-the-loop interaction protocol, safety rails (branch, tests-green, redact secrets, never fabricate), modes, finding/fix tracks, schemas, severity taxonomy, the quality-lens definitions, the implementation loop, and the single-source-of-truth conventions. Each skill references it by section.

For **always-on** application (not just inside a skill), add a pointer in your repo's `CLAUDE.md`, e.g.:
> This repo follows the conventions in the code-ops-suite plugin (`CONVENTIONS.md`): developer-in-the-loop, behavior-preserving changes, evidence (`file:line`) on every finding, secrets/PII redacted, and the quality lenses defined there.

## Loops & automation
- **Tool-layer traceless gate:** a bundled `PreToolUse` hook (`hooks/hooks.json` + `hooks/enforce-traceless.mjs`) scans a `git commit` / `gh pr create|merge` Bash call for AI/tool trace before it runs and blocks on a hit; CI stays the fail-closed backstop.
- **Opt-in output digest:** a second bundled `PreToolUse` hook (`hooks/digest-rewrite.mjs`) rewrites an allowlisted simple Bash command into a `scripts/digest.mjs` run, so its output arrives compressed with a receipt naming the raw file. It is off everywhere until a repository sets `CODE_OPS_DIGEST` to `1`, `on`, or `true` in the `env` block of its `.claude/settings.json`.
- **Session-start routing card:** a bundled `SessionStart` hook (`hooks/routing-card.mjs`) prints a hard-capped routing card mapping task types to the right skill/orchestrator so the lead defaults into standard operating mode from the first turn.
- **In-session loop:** run a skill repeatedly toward its "Done when" criteria with the built-in `/loop`.
- **Before every PR:** run `local-review-gate` against the final committed diff. Keep deterministic tests in hosted CI; publish the local SHA-bound statuses when branch protection requires them.
- **Recurring maintenance:** put `dependency-upgrade` and `security-privacy-audit` on a schedule with Routines (`/schedule`).
- **Let deterministic tools do deterministic work:** wire a formatter + linter into a pre-commit hook, a dependency bot for CVEs, SAST for the security baseline, and coverage gates in CI — and reserve the skills for the judgment-heavy work (audit, threat model, feature discovery, intricate-bug hunting).

## How they chain
Registers are live backlogs with stable IDs (`PERF-007` → register → commit/PR → log):
- `codebase-audit` / `security-privacy-audit` / deep-dives → `FINDINGS_REGISTER.md` → `remediation` → `pr-review`
- `feature-discovery` → specs → `feature-implementation` → `pr-review`
- every build skill keeps docs current; `doc-alignment` establishes the SSOT; `onboarding` sits inside it

## Notes
- Works on any stack; skills self-detect tooling and match the repo's existing conventions rather than imposing new ones.
- Optional tools (a docs-lookup MCP, version-control history, a browser/UI tool) are used if connected and skipped otherwise.
- The privacy/data-handling lens scales to how much sensitive data the system actually handles.
