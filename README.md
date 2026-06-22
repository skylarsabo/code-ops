# Code-Ops — Claude Code plugin marketplace

One marketplace, three installable plugins of adaptive, multi-agent engineering workflows. Add the marketplace once, then install whichever plugin a project needs.

- **`code-ops-suite`** — general engineering for any codebase: audit, security/privacy threat assessment, remediation, feature discovery & build, performance, tests, dependencies, PR review, doc alignment, onboarding, code normalization. (14 skills)
- **`privacy-opsec-suite`** — privacy/anonymity & OpSec specialization: anonymity threat model, anonymous sessions, Tor/proxy egress + leak prevention, metadata minimization, fingerprinting & traffic-analysis resistance, supply-chain trust, opsec hardening, leak incident response, opsec PR gate. (13 skills)
- **`rigor`** — verification-first quality: find real bugs (proven with repros), validate the test suite (flaky + mutation testing), lock behavior with characterization safety nets, fix at root cause with a regression guard, close inconsistencies with enforcement, ship measured improvements. Prove-it-or-don't-report-it. (11 skills)

**Which to use:** install `code-ops-suite` on any project for breadth. Add `privacy-opsec-suite` when the project has anonymity/opsec requirements (anonymous sessions, Tor/onion routing, strong metadata minimization). Reach for `rigor` when you want **proven** bugs and enforced consistency rather than a long list — it's the highest-signal, highest-rigor option. They compose: a broad `code-ops-suite:codebase-audit` for the map, then `rigor:bug-hunt` to prove the real defects, then `privacy-opsec-suite:tor-egress-audit` for the anonymity-specific pass.

Each plugin reads its bundled `CONVENTIONS.md` first (shared operating model, developer-in-the-loop interaction protocol, safety rails, schemas, quality lenses). Skills are **manual-invoke** (they run only when you call them, never automatically).

---

## Prerequisites
A recent build of Claude Code (plugins/skills are current features). Check and update:
```bash
claude --version
claude update
```

## Install — pick one path

### A) Local (fastest — try it now)
Unzip this folder somewhere, then inside Claude Code (run from any repo):
```text
/plugin marketplace add /absolute/path/to/code-ops-plugins
/plugin install code-ops-suite@code-ops
/plugin install privacy-opsec-suite@code-ops      # optional
/plugin install rigor@code-ops                    # verification-first bug/quality suite
```
On Windows, a path like `C:\Users\you\code-ops-plugins` works too.
Equivalent from the terminal (non-interactive):
```bash
claude plugin marketplace add /absolute/path/to/code-ops-plugins
claude plugin install code-ops-suite@code-ops
claude plugin install privacy-opsec-suite@code-ops
```

### B) GitHub (shareable with your team)
Push the `code-ops-plugins` folder to a GitHub repo, then:
```text
/plugin marketplace add your-org/code-ops-plugins
/plugin install code-ops-suite@code-ops
/plugin install privacy-opsec-suite@code-ops
```
Any git host works too: `/plugin marketplace add https://gitlab.com/your-org/code-ops-plugins.git`

### C) Auto-require for a repo / team
Add to the project's `.claude/settings.json` so teammates are prompted to install when they trust the folder:
```json
{
  "extraKnownMarketplaces": {
    "code-ops": {
      "source": { "source": "github", "repo": "your-org/code-ops-plugins" }
    }
  },
  "enabledPlugins": {
    "code-ops-suite@code-ops": true,
    "privacy-opsec-suite@code-ops": true
  }
}
```

## Use
Invoke a workflow as a namespaced slash command:
```text
/code-ops-suite:codebase-audit
/code-ops-suite:pr-review for the current branch
/privacy-opsec-suite:anonymity-threat-model
/privacy-opsec-suite:tor-egress-audit
```
Run `/plugin` to browse installed plugins and their skills. Most workflows open with a short scoping checkpoint, then run an adaptive multi-agent loop and check in with you on the decisions that matter.

## Verify & maintain
```bash
claude plugin validate .                                   # marketplace.json
claude plugin validate ./plugins/code-ops-suite            # a plugin + its skill/agent frontmatter
claude plugin validate ./plugins/privacy-opsec-suite
claude plugin validate ./plugins/rigor
```
After editing a plugin, **bump its `version`** in `plugins/<name>/.claude-plugin/plugin.json`, update the matching entry in `.claude-plugin/marketplace.json` (the two must agree — `scripts/lint-plugins.mjs` enforces it), and add a `CHANGELOG.md` entry. Users refresh with `/plugin marketplace update`.

**Bundled scripts:**
- `scripts/lint-plugins.mjs` — structural linter (the CI gate in `.github/workflows/validate.yml`): manifest/version parity, README skill-count parity, required `SKILL.md` fields, frontmatter YAML-safety, orchestrator skill-reference resolution, runtime-script parity, and a verbatim-CONVENTIONS duplication guard. Run `node scripts/lint-plugins.mjs`.
- `evals/` — the eval harness. `evals/register-staleness/run.mjs` is an automated regression test (also in CI) that pins the register-freshness behavior; see `evals/README.md` for the judgment-eval approach.
- `scripts/revalidate-register.mjs` — register freshness checker, also copied into each plugin so skills invoke it via `${CLAUDE_PLUGIN_ROOT}/scripts/`. Re-greps each register item's `file:line` against the current tree (FRESH / MOVED / GONE / NO-REF) so stale findings are re-triaged before they're acted on: `node scripts/revalidate-register.mjs <register.md> --root <repo>`.

## Optional: always-on conventions
Each plugin ships its own `CONVENTIONS.md` (its operating model, interaction protocol, safety rails, schemas, and lenses), and every skill reads its plugin's file first via `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`. To make those principles apply in *every* session — not just inside a skill — add a line to the project's `CLAUDE.md`:
> This repo follows the conventions of the installed code-ops plugins: developer-in-the-loop (ask when unsure), behavior-preserving changes by default, evidence (`file:line`) on every finding, secrets/PII redacted, and — when using `rigor` — prove-it-or-don't (evidence tiers, a disconfirmation pass, fixes shipped with a failing-then-passing regression test).

## Recommended order
The three plugins compose into one flow; run as much or as little as a task needs:
1. **`code-ops-suite:full-sweep`** (or `:codebase-audit`) — broad map of the codebase and a first findings pass.
2. **`rigor:rigor-sweep`** (start `assess-only`) — establish ground truth, validate the test suite, then **prove** the real bugs, lock behavior with safety nets, and fix at root cause with a regression guard. This is the high-signal core.
3. **`privacy-opsec-suite:full-sweep`** — only on projects with anonymity/opsec requirements: the threat model, Tor/egress + leak audits, and hardening.
4. Wire the matching PR gate(s) into CI: `rigor:deep-review` and/or `privacy-opsec-suite:opsec-pr-gate`.
Rule of thumb: `code-ops-suite` for breadth, **`rigor` for proof**, `privacy-opsec-suite` for the anonymity specialization.

**Run all of it in one command:** `/code-ops-suite:everything` orchestrates every phase across all three plugins end-to-end (map → ground-truth + test-trust → prove → leak audits → safety net → consolidated review → remediate → close inconsistencies → improve → normalize → final report). It's the most thorough and most token-expensive option, runs phased with checkpoints (not a blind firehose), and takes a **remediation automation level** at Phase 0 — `gated` (default), `auto-safe` (auto-apply only CONFIRMED + NOW-SAFE fixes, each test-backed and on a branch), or `auto-all` (not recommended) — with security/auth, secrets, data migrations, public contracts, and destructive/irreversible changes **always gated** and nothing ever auto-merged. Requires all three plugins installed.

## Optional: CI / automation
- Per-PR review/gate: run `/install-github-app` (generates a correct workflow + sets `ANTHROPIC_API_KEY`), then paste the criteria from each plugin's `examples/*.yml` (`rigor`'s `github-deep-review.yml`, `privacy-opsec-suite`'s `github-opsec-gate.yml`, `code-ops-suite`'s `github-pr-review.yml`).
- Recurring scans (dependencies, security, egress/metadata, a periodic `rigor` bug sweep): schedule with Routines (`/schedule`).
- Let deterministic tools (formatter/linter + pre-commit, dependency bot, SAST, mutation/coverage gates) handle the mechanical checks; reserve the skills for judgment-heavy work.

---

## What's inside
```
code-ops-plugins/
├── .claude-plugin/
│   └── marketplace.json                 # catalog → three plugins
└── plugins/
    ├── code-ops-suite/
    │   ├── .claude-plugin/plugin.json
    │   ├── CONVENTIONS.md                # shared backbone
    │   ├── skills/                       # 14 workflows (incl. full-sweep + everything orchestrators)
    │   ├── agents/                       # explorer + reviewer subagents
    │   ├── examples/                     # PR-review GitHub Actions workflow
    │   └── README.md
    └── privacy-opsec-suite/
        ├── .claude-plugin/plugin.json
        ├── CONVENTIONS.md                # backbone + the anonymity/opsec model (§A)
        ├── skills/                       # 13 privacy/opsec workflows (incl. full-sweep orchestrator)
        ├── agents/                       # leak-aware explorer + privacy-reviewer
        ├── examples/                     # opsec PR-gate GitHub Actions workflow
        └── README.md
    └── rigor/
        ├── .claude-plugin/plugin.json
        ├── CONVENTIONS.md                # the verification-first methodology (v2)
        ├── skills/                       # 11 bug/quality workflows
        ├── agents/                       # tracer (read-only) + verifier (runs repros/mutations)
        ├── examples/                     # deep-review GitHub Actions workflow
        └── README.md
```
See each plugin's `README.md` for its full skill list, the loops/automation guidance, and how its skills chain together.
