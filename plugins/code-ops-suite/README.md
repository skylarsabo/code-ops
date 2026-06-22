# code-ops-suite

Adaptive, multi-agent engineering workflows for **any codebase**, packaged as a Claude Code plugin. Each workflow is a namespaced skill you invoke as `/code-ops-suite:<name>`; they run a dynamic, conflict-aware multi-agent loop and check in with you at the decisions that matter. Shared rules live once in `CONVENTIONS.md`, which every skill reads first.

## Skills

Invoke with `/code-ops-suite:<name>`. All are manual-invoke (they won't auto-fire) since they're deliberate operations.

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
- `normalize` — one consistent professional style repo-wide; removes the artifacts of hasty/generated code; behavior-preserving.
- `pr-split` — carve an existing big branch into a clean stack of small, independently-green PRs, scrubbed of AI/tooling trace (composes `privacy-opsec-suite:authorship-hygiene`, fail-closed); never auto-merges.

**Docs / knowledge**
- `doc-alignment` — reconcile doc drift against code; establish a clean single source of truth.
- `onboarding` — generate a verified, code-grounded orientation guide with an architecture diagram.

**Orchestrators**
- `full-sweep` — run the whole suite end-to-end as one developer-in-the-loop pipeline (ground truth → assess → safety-net → fix → deep-dives → consistency → capture), pausing at each phase boundary. Intra-plugin.
- `everything` — the cross-plugin superset: orchestrates every phase across all three plugins (map → prove → leak-audit → safety-net → remediate → close → improve → normalize). Requires `rigor` and `privacy-opsec-suite` installed; the most thorough and most token-expensive option.

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
- **In-session loop:** run a skill repeatedly toward its "Done when" criteria with the built-in `/loop`.
- **On every PR:** wire `pr-review` into CI with the official `anthropics/claude-code-action@v1`. See `examples/github-pr-review.yml` — but the canonical setup is to run `/install-github-app`, which generates a correct workflow; then paste the review criteria in.
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
