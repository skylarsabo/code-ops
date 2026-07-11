# Code-Ops — Claude Code + Codex plugin marketplace

One repository, four installable plugins of adaptive, multi-agent engineering workflows. Claude Code uses the canonical source packages; Codex uses a tracked native render generated from that same source. Add the marketplace once on your host, then install whichever plugin a project needs.

- **`code-ops-suite`** — general engineering for any codebase: audit, security/privacy threat assessment, remediation, feature discovery & build, performance, tests, dependencies, PR review, doc alignment, onboarding, code normalization, PR-splitting, ship, debug, current-docs, plus architecture & API/data-model/ADR/ops doc generation, and run handoff/resume. (24 skills)
- **`privacy-opsec-suite`** — privacy/anonymity & OpSec specialization: anonymity threat model, anonymous sessions, Tor/proxy egress + leak prevention, metadata minimization, fingerprinting & traffic-analysis resistance, supply-chain trust, opsec hardening, leak incident response, opsec PR gate, authorship hygiene. (14 skills)
- **`rigor`** — verification-first quality: find real bugs (proven with repros), validate the test suite (flaky + mutation testing), lock behavior with characterization safety nets, fix at root cause with a regression guard, close inconsistencies with enforcement, ship measured improvements. Prove-it-or-don't-report-it. (11 skills)
- **`researcher`** — code-grounded research: ground in the codebase (or given materials), gather external knowledge, and propose improvements, design briefs (spikes), library evaluations, ideas, and an ecosystem watch. Every claim cited and tiered; local-first with disclosed, fail-closed egress; it proposes and hands implementation to the other suites. (7 skills)

**Which to use:** install `code-ops-suite` on any project for breadth. Add `privacy-opsec-suite` when the project has anonymity/opsec requirements (anonymous sessions, Tor/onion routing, strong metadata minimization). Reach for `rigor` when you want **proven** bugs and enforced consistency rather than a long list — it's the highest-signal, highest-rigor option. They compose: a broad `code-ops-suite:codebase-audit` for the map, then `rigor:bug-hunt` to prove the real defects, then `privacy-opsec-suite:tor-egress-audit` for the anonymity-specific pass.

Each plugin reads its bundled `CONVENTIONS.md` first (shared operating model, developer-in-the-loop interaction protocol, safety rails, schemas, quality lenses). Skills are **manual-invoke** on both hosts: Claude Code uses its manual-invocation flag; the generated Codex skills set `policy.allow_implicit_invocation: false`.

**New here?** Start with the handbook in [`docs/handbook/`](docs/handbook/) — the guide to learning and using the suite.

---

## Install

### Claude Code

A recent build of Claude Code is required. Check and update:

```bash
claude --version
claude update
```

**Local (fastest):** inside Claude Code, from any repo:

```text
/plugin marketplace add /absolute/path/to/code-ops
/plugin install code-ops-suite@code-ops
/plugin install privacy-opsec-suite@code-ops      # optional
/plugin install rigor@code-ops                    # verification-first bug/quality suite
/plugin install researcher@code-ops               # code-grounded research
```
On Windows, a path like `C:\Users\you\code-ops` works too.
Equivalent from the terminal (non-interactive):
```bash
claude plugin marketplace add /absolute/path/to/code-ops
claude plugin install code-ops-suite@code-ops
claude plugin install privacy-opsec-suite@code-ops
claude plugin install rigor@code-ops
claude plugin install researcher@code-ops
```

**GitHub (share with a team):**

```text
/plugin marketplace add skylarsabo/code-ops
/plugin install code-ops-suite@code-ops
/plugin install privacy-opsec-suite@code-ops
/plugin install rigor@code-ops
/plugin install researcher@code-ops
```
Any git host works too: `/plugin marketplace add https://gitlab.com/your-org/code-ops.git`

**Auto-require for a repo / team:** add to the project's `.claude/settings.json` so teammates are prompted to install when they trust the folder:

```json
{
  "extraKnownMarketplaces": {
    "code-ops": {
      "source": { "source": "github", "repo": "your-org/code-ops" }
    }
  },
  "enabledPlugins": {
    "code-ops-suite@code-ops": true,
    "privacy-opsec-suite@code-ops": true,
    "rigor@code-ops": true,
    "researcher@code-ops": true
  }
}
```

### Codex

Codex reads the repository-root `.agents/plugins/marketplace.json`, which points to the generated native packages under `codex-marketplace/`.

```bash
codex --version
codex plugin marketplace add .
codex plugin list --marketplace code-ops --available --json
codex plugin add code-ops-suite@code-ops
codex plugin add rigor@code-ops
codex plugin add privacy-opsec-suite@code-ops
codex plugin add researcher@code-ops
```

For a shared GitHub install, replace `.` with `skylarsabo/code-ops --ref main`. In the desktop app, restart after changing a local marketplace so it reloads the rendered package.

`code-ops-suite` also bundles its traceless-publishing hook. Codex requires an explicit hook review/trust step before plugin hooks run; inspect it with `/hooks`. The repository CI gate remains the fail-closed backstop.

## Use
In Claude Code, invoke a workflow as a namespaced slash command:

```text
/code-ops-suite:codebase-audit
/code-ops-suite:pr-review for the current branch
/privacy-opsec-suite:anonymity-threat-model
/privacy-opsec-suite:tor-egress-audit
```

In Codex, name the same workflow in your request — for example, `Use code-ops-suite:codebase-audit on this repo.` The generated policy keeps these workflows deliberate rather than implicitly invoked. Most workflows open with a short scoping checkpoint, then run an adaptive multi-agent loop and check in with you on the decisions that matter.

## Verify & maintain
```bash
claude plugin validate .                                   # marketplace.json
claude plugin validate ./plugins/code-ops-suite            # a plugin + its skill/agent frontmatter
claude plugin validate ./plugins/privacy-opsec-suite
claude plugin validate ./plugins/rigor
```
For Codex, also run:

```bash
node scripts/build-codex-marketplace.mjs
node scripts/build-codex-marketplace.mjs --check
codex plugin marketplace add .
codex plugin list --marketplace code-ops --available --json
```

After editing a source plugin, **bump its `version`** in `plugins/<name>/.claude-plugin/plugin.json`, update the matching entry in `.claude-plugin/marketplace.json` (the two must agree — `scripts/lint-plugins.mjs` enforces it), and add a `CHANGELOG.md` entry. Then regenerate `codex-marketplace/`; never hand-edit its output. Claude users refresh with `/plugin marketplace update`.

### Automatic commit-time sync

Install the repository hook once per checkout:

```bash
node scripts/install-git-hooks.mjs
```

Before each relevant commit it regenerates the Codex marketplace and stages only `.agents/plugins/marketplace.json` plus `codex-marketplace/`; authored Claude source is never auto-staged. It refuses to proceed if a renderer input is unstaged or untracked, preventing output for source that is absent from the commit. The CI drift gate remains mandatory, so a clone where hooks are not installed (or a commit made with `--no-verify`) cannot merge stale derived artifacts.

**Bundled scripts:**
- `scripts/lint-plugins.mjs` — structural linter (the CI gate in `.github/workflows/validate.yml`): manifest field presence + marketplace/version parity + no duplicate or unregistered plugins, README skill-count and word-boundary mention parity, required `SKILL.md` fields, frontmatter YAML-safety (incl. BOM), orchestrator skill-reference resolution (intra-plugin scoped + qualified `plugin:skill` + single-word, derived from skill bodies), runtime-script parity, a verbatim-CONVENTIONS duplication guard, `§<id>` section-reference integrity against each plugin's CONVENTIONS headings, subagent-name integrity ("the X subagent" prose must name a bundled agent), a frontmatter angle-bracket injection guard (frontmatter is injected verbatim into the system prompt at discovery), agent model-tier floors (downgrading the verification core requires a visible floor-table edit), producer register self-check wiring, and the SHARED_PASSAGES doctrine-core drift gate (intentional duplication is pinned byte-identically). Run `node scripts/lint-plugins.mjs`.
- `scripts/check-no-deps.mjs` — CI guard that fails if any third-party import appears, locking the dependency-free invariant.
- `scripts/build-codex-marketplace.mjs` — deterministic renderer + self-validation for the Codex marketplace. It derives `.agents/plugins/marketplace.json` and the tracked `codex-marketplace/` payload from the Claude source; `--check` fails on drift.
- `scripts/install-git-hooks.mjs` — opt-in installer for the tracked pre-commit hook; it synchronizes and stages only Codex-derived artifacts before a commit.
- `evals/` — the eval harness. Ten automated regression evals run in `.github/workflows/validate.yml` (register-staleness, ai-tells, lib-docs engine, MCP smoke, Codex marketplace, researcher egress-manifest, script-guards, proof-receipts, autofix-scope, redaction-scan) plus a zero-dependency guard and a fixture-drift guard; see `evals/README.md` for these and the judgment-eval approach.
- `scripts/revalidate-register.mjs` — register freshness checker, also copied into each plugin so skills invoke it via `${CLAUDE_PLUGIN_ROOT}/scripts/`. Re-greps each register item's `file:line` against the current tree (FRESH / MOVED / DRIFTED / GONE / AMBIGUOUS / NO-REF — `DRIFTED` when the line no longer carries the item's verbatim `Anchor`) so stale findings are re-triaged before they're acted on: `node scripts/revalidate-register.mjs <register.md> --root <repo>`.
- `scripts/check-autofix-scope.mjs` — auto-apply diff gate: denies always-gated paths, oversize diffs, and export-touching lines before an agent may auto-apply a fix; fail-closed with no flags. `scripts/run-proof.mjs` — execution-receipt ledger (record/replay) so a claimed test result is replayable, not narrated. `scripts/check-proof-integrity.mjs` — add-only pins for proof tests (a weakened proof is a loud PROOF-AMENDED, never silent). `scripts/scan-redaction.mjs` — fail-closed secret shapes over the suite's own output artifacts. `scripts/scan-injection-tells.mjs` — prompt-injection tells in agent-ingested content (report-only floor, opt-in fail-on).
- `scripts/lib-docs.mjs` — in-house, local-first "current docs" engine (a Context7 alternative): resolves a library's **installed** version and returns its README + type exports with zero network by default (opt-in `--fetch` fallback to the library's own source). Bundled into each plugin, and also exposed as the `code-ops-docs` MCP server (`scripts/lib-docs-mcp.mjs`, declared in `code-ops-suite`'s manifest).

**AI PR gates (optional, Claude-specific):** `.github/workflows/deep-review.yml` (rigor verification-first review) and `opsec-gate.yml` (privacy-opsec gate) run on PRs. They need a Claude credential — a Pro/Max subscription token (`CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token`) **or** an `ANTHROPIC_API_KEY` repo secret — and skip cleanly when neither is set (e.g. fork PRs). Actions are SHA-pinned.

## Optional: always-on conventions
Each plugin ships its own `CONVENTIONS.md` (its operating model, interaction protocol, safety rails, schemas, and lenses), and every skill reads its plugin's file first. To make those principles apply in *every* session — not just inside a skill — add a line to the project's `CLAUDE.md` (Claude Code) or `AGENTS.md` (Codex):
> This repo follows the conventions of the installed code-ops plugins: developer-in-the-loop (ask when unsure), behavior-preserving changes by default, evidence (`file:line`) on every finding, secrets/PII redacted, and — when using `rigor` — prove-it-or-don't (evidence tiers, a disconfirmation pass, fixes shipped with a failing-then-passing regression test).

## Recommended order
The three plugins compose into one flow; run as much or as little as a task needs:
1. **`code-ops-suite:full-sweep`** (or `:codebase-audit`) — broad map of the codebase and a first findings pass.
2. **`rigor:rigor-sweep`** (start `assess-only`) — establish ground truth, validate the test suite, then **prove** the real bugs, lock behavior with safety nets, and fix at root cause with a regression guard. This is the high-signal core.
3. **`privacy-opsec-suite:full-sweep`** — only on projects with anonymity/opsec requirements: the threat model, Tor/egress + leak audits, and hardening.
4. Wire the matching PR gate(s) into CI: `rigor:deep-review` and/or `privacy-opsec-suite:opsec-pr-gate`.
Rule of thumb: `code-ops-suite` for breadth, **`rigor` for proof**, `privacy-opsec-suite` for the anonymity specialization.

**Run all of it in one command:** `/code-ops-suite:everything` in Claude Code, or `code-ops-suite:everything` named in Codex, orchestrates every phase across all three plugins end-to-end (map → ground-truth + test-trust → prove → leak audits → safety net → consolidated review → remediate → close inconsistencies → improve → normalize → final report). It's the most thorough and most token-expensive option, runs phased with checkpoints (not a blind firehose), and takes a **remediation automation level** at Phase 0 — `gated` (default), `auto-safe` (auto-apply only CONFIRMED + NOW-SAFE fixes, each test-backed and on a branch), or `auto-all` (not recommended) — with security/auth, secrets, data migrations, public contracts, and destructive/irreversible changes **always gated** and nothing ever auto-merged. Requires all three plugins installed.

## Optional: CI / automation
- Per-PR review/gate: run `/install-github-app` (generates a correct workflow + sets `ANTHROPIC_API_KEY`), then paste the criteria from each plugin's `examples/*.yml` (`rigor`'s `github-deep-review.yml`, `privacy-opsec-suite`'s `github-opsec-gate.yml`, `code-ops-suite`'s `github-pr-review.yml`).
- Recurring scans (dependencies, security, egress/metadata, a periodic `rigor` bug sweep): schedule with Routines (`/schedule`).
- Let deterministic tools (formatter/linter + pre-commit, dependency bot, SAST, mutation/coverage gates) handle the mechanical checks; reserve the skills for judgment-heavy work.

---

## What's inside
```
code-ops/
├── .agents/plugins/marketplace.json      # Codex catalog (generated)
├── .claude-plugin/
│   └── marketplace.json                  # Claude Code catalog → four plugins
├── codex-marketplace/                    # generated native Codex packages
│   └── plugins/<name>/.codex-plugin/
│       └── plugin.json
└── plugins/
    ├── code-ops-suite/
    │   ├── .claude-plugin/plugin.json
    │   ├── CONVENTIONS.md                # shared backbone
    │   ├── skills/                       # 24 workflows (incl. architecture/API/data-model/ADR/ops doc generators + current-docs + handoff + orchestrators)
    │   ├── agents/                       # explorer + reviewer subagents
    │   ├── examples/                     # Claude GitHub Actions workflow
    │   └── README.md
    ├── privacy-opsec-suite/
        ├── .claude-plugin/plugin.json
        ├── CONVENTIONS.md                # backbone + the anonymity/opsec model (§A)
        ├── skills/                       # 14 privacy/opsec workflows (incl. authorship-hygiene + full-sweep)
        ├── agents/                       # leak-aware explorer + privacy-reviewer
        ├── examples/                     # Claude GitHub Actions workflow
        └── README.md
    ├── rigor/
        ├── .claude-plugin/plugin.json
        ├── CONVENTIONS.md                # the verification-first methodology (v2)
        ├── skills/                       # 11 bug/quality workflows
        ├── agents/                       # tracer (read-only) + verifier (runs repros/mutations)
        ├── examples/                     # Claude GitHub Actions workflow
        └── README.md
    └── researcher/
        ├── .claude-plugin/plugin.json
        ├── CONVENTIONS.md                # research integrity + the egress model (§A)
        ├── skills/                       # 7 code-grounded research workflows
        ├── agents/                       # gatherer + claim-checker subagents
        ├── scripts/                      # bundled research-manifest.mjs + lib-docs + revalidate-register + scan-injection-tells
        └── README.md
```
See each plugin's `README.md` for its full skill list, the loops/automation guidance, and how its skills chain together.
