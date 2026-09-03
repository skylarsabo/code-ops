# Code-Ops, an engineering plugin marketplace

One repository ships four plugins of adaptive, multi-agent engineering workflows. Claude Code and Grok Build read the canonical packages under `plugins/`. Codex and opencode each read a tracked render of that same source.

Installing `code-ops-suite` gives three things with no further configuration:

- **Quality discipline.** Skills and their subagents run audit, proof, review, and ship as checkpointed workflows.
- **Measured token cost.** Every session appends one local receipt, and three switches cut the context a run carries.
- **Governed documentation.** The docs vault and the per-repo atlas give a repository one documentation hub.

Add the marketplace once, then install the plugins a project needs:

```text
/plugin marketplace add skylarsabo/code-ops
```

New here? Start with the handbook in [`code-ops-docs/40 Engineering/Handbook/`](code-ops-docs/40 Engineering/Handbook/).

---

## Install

### Claude Code

Claude Code needs a recent build. Check the version, then update:

```bash
claude --version
claude update
```

Add a local checkout as the marketplace, then install each plugin:

```text
/plugin marketplace add /absolute/path/to/code-ops
/plugin install code-ops-suite@code-ops
/plugin install privacy-opsec-suite@code-ops
/plugin install rigor@code-ops
/plugin install researcher@code-ops
```

A Windows path such as `C:\Users\you\code-ops` works too. Run the same steps from a terminal without the interface:

```bash
claude plugin marketplace add /absolute/path/to/code-ops
claude plugin install code-ops-suite@code-ops
claude plugin install privacy-opsec-suite@code-ops
claude plugin install rigor@code-ops
claude plugin install researcher@code-ops
```

To share the marketplace with a team, add it from GitHub instead of a path:

```text
/plugin marketplace add skylarsabo/code-ops
```

Any git host works: `/plugin marketplace add https://gitlab.com/your-org/code-ops.git`

To prompt teammates when they trust the folder, add the marketplace and the plugins to the project's `.claude/settings.json`:

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

Codex reads `.agents/plugins/marketplace.json` at the repository root. That file points at the generated native packages under `codex-marketplace/`.

```bash
codex --version
codex plugin marketplace add .
codex plugin list --marketplace code-ops --available --json
codex plugin add code-ops-suite@code-ops
codex plugin add rigor@code-ops
codex plugin add privacy-opsec-suite@code-ops
codex plugin add researcher@code-ops
```

For a shared GitHub install, replace `.` with `skylarsabo/code-ops --ref main`. After you change a local marketplace in the desktop app, restart it so the rendered package reloads.

`code-ops-suite` bundles its traceless-publishing hook. Codex requires an explicit hook review before a plugin hook runs. Inspect the hook with `/hooks`. The repository CI gate stays the fail-closed backstop.

### Grok Build

Grok Build reads the Claude plugin format natively, so it needs no separate render. Its manifest resolver accepts `.claude-plugin/plugin.json`. Its plugin discovery walks `~/.claude/plugins/`, and its agent discovery walks `.claude/agents/`. Its hook adapter exports `CLAUDE_PLUGIN_ROOT` beside `GROK_PLUGIN_ROOT`.

When the marketplace is already added for Claude Code, Grok Build picks it up with no extra step. Otherwise add it:

```bash
grok plugin marketplace add skylarsabo/code-ops
grok plugin install code-ops-suite
```

Check what it discovered. Plugins, skills, agents, hooks, and the MCP server all appear:

```bash
grok inspect
```

Grok Build namespaces a plugin agent as `<plugin>:<agent>`, so the two `explorer` agents coexist without the flattening opencode needs. Set the model in `~/.grok/config.toml` under `[models] default`. On Windows that file is `%USERPROFILE%\.grok\config.toml`. Recent builds already default to `grok-4.6`.

One gap is worth knowing. Grok Build does not parse an agent's `model:` frontmatter, so an agent inherits the session model rather than its declared tier. The floors still travel, in three parts. Phase 0 of `scripts/preflight.mjs` prints the bundled agents' declared floors, so every run surfaces them on any host. The lead then routes each dispatch at or above its floor by hand. `run-cost-audit` measures the result, and a below-floor dispatch lands as a `tier-routing` FAIL in `RUN_CONFORMANCE.md`. Picking a session model that meets the strongest floor you will dispatch satisfies all three at once. See `code-ops-docs/40 Engineering/Techniques/subagent-trade-offs.md`.

### opencode

opencode discovers skills, agents, and commands from flat directories under its config root. Copy the distribution in rather than adding a marketplace:

```bash
node scripts/build-opencode-dist.mjs
cp -R opencode-dist/. ~/.config/opencode/        # or .opencode/ for one project
```

opencode has one flat namespace and no colon in its name grammar, so every name carries a plugin prefix. `/code-ops-suite:ship` becomes `/code-ops-suite-ship`. Each skill is also model-invocable through opencode's `skill` tool under the same name.

`opencode-dist/opencode.json` binds every agent to a model meeting its capability tier, rendered against `xai/grok-4.6`. A ready-made config for each supported provider ships under `opencode-dist/configs/`, covering Anthropic, xAI, OpenAI, Google, Z.AI, Moonshot, DeepSeek, and Mistral. Moving the suite between providers is a config swap, not a rewrite. Merge one into your own config rather than overwriting it. The full tier table lives in `opencode-dist/MODEL_TIERS.md`.

The traceless-publishing gate ships as `opencode-dist/plugins/code-ops-traceless.js`, ported from the Claude hook to opencode's `tool.execute.before` hook. It resolves its scanner through the distribution layout, so keep the directories together. The repository CI gate stays the fail-closed backstop.

## Use

In Claude Code, invoke a workflow as a namespaced slash command:

```text
/code-ops-suite:codebase-audit
/code-ops-suite:pr-review for the current branch
/privacy-opsec-suite:anonymity-threat-model
/privacy-opsec-suite:tor-egress-audit
```

In Codex, name the same workflow in your request, for example `Use code-ops-suite:codebase-audit on this repo.` The generated policy sets `allow_implicit_invocation: true` for each skill, mirroring how Claude skills are model-invocable. Codex may therefore route a matching request to a skill implicitly. Most workflows open with a short scoping checkpoint. They then run an adaptive multi-agent loop and check in with you on the decisions that matter.

Each plugin reads its bundled `CONVENTIONS.md` first, which holds the shared operating model, the interaction protocol, the safety rails, the schemas, and the quality lenses. Side-effect-bearing phases keep their checkpoints, and nothing ever auto-merges.

### Order of a full pass

The three general plugins compose into one flow. Run as much or as little of it as a task needs:

1. `code-ops-suite:full-sweep`, or `code-ops-suite:codebase-audit` alone, maps the codebase and takes a first findings pass.
2. `rigor:rigor-sweep`, started `assess-only`, establishes ground truth, validates the test suite, and proves the real bugs.
3. `privacy-opsec-suite:full-sweep` runs only on a project with anonymity or opsec requirements.
4. `code-ops-suite:local-review-gate` runs on the final committed diff before the PR opens.

To run every phase in one command, invoke `/code-ops-suite:everything`. It orchestrates all three plugins end to end, from the map through ground truth, proof, leak audits, safety nets, review, remediation, and the final report. It is the most thorough and most token-expensive option, and it runs phased with checkpoints. Phase 0 takes a remediation automation level. `gated` is the default, `auto-safe` applies only CONFIRMED and NOW-SAFE fixes on a branch, and `auto-all` is not recommended. Security, secrets, data migrations, public contracts, and destructive changes stay gated at every level. Nothing ever auto-merges. All three plugins must be installed.

### Conventions in every session

Every skill reads its plugin's `CONVENTIONS.md` first. To apply those principles outside a skill too, add a line to the project's `CLAUDE.md` or `AGENTS.md`:

> This repo follows the conventions of the installed code-ops plugins: developer-in-the-loop (ask when unsure), behavior-preserving changes by default, evidence (`file:line`) on every finding, secrets and PII redacted, and, when using `rigor`, prove it or do not report it (evidence tiers, a disconfirmation pass, fixes shipped with a failing-then-passing regression test).

### Context and cost switches

Four mechanisms measure or shrink the context a run consumes. Session receipts run with no configuration. The other three stay inert until a repository sets its switch to `1`, `on`, or `true` in the `env` block of `.claude/settings.json`:

- **Session receipts.** `hooks/session-receipt.mjs` appends one row per session to a home-directory ledger, and `CODE_OPS_RECEIPTS=off` disables it.
- **Output digest.** `hooks/digest-rewrite.mjs` rewrites an allowlisted simple Bash command into a `scripts/digest.mjs` run, so its output arrives compressed and receipted. Its switch is `CODE_OPS_DIGEST`.
- **Symbol index.** `scripts/context-query.mjs` answers a structural question with `file:line` anchors instead of a dump, and `hooks/index-refresh.mjs` re-indexes each edited file. The hook's switch is `CODE_OPS_INDEX`.
- **Ladder card.** `hooks/ladder-card.mjs` hands an implementer subagent the code-economy ladder as a ten-line card. Its switch is `CODE_OPS_LADDER_CARD`.

Read the receipt ledger with `node scripts/context-audit.mjs receipts`.

## Verify and maintain

Validate the marketplace and each plugin:

```bash
claude plugin validate .                                   # marketplace.json
claude plugin validate ./plugins/code-ops-suite            # a plugin and its skill/agent frontmatter
claude plugin validate ./plugins/privacy-opsec-suite
claude plugin validate ./plugins/rigor
claude plugin validate ./plugins/researcher
```

Run the structural gate chain before you call a change done:

```bash
node scripts/lint-plugins.mjs
node scripts/check-no-deps.mjs
node scripts/build-codex-marketplace.mjs --check
node scripts/build-opencode-dist.mjs --check
```

Regenerate the host distributions and re-add the rendered marketplace:

```bash
node scripts/build-codex-marketplace.mjs
node scripts/build-opencode-dist.mjs
codex plugin marketplace add .
codex plugin list --marketplace code-ops --available --json
```

After you edit a source plugin, bump its `version` in `plugins/<name>/.claude-plugin/plugin.json`. Update the matching entry in `.claude-plugin/marketplace.json`, which `scripts/lint-plugins.mjs` holds to parity. Add a `CHANGELOG.md` entry. Then regenerate `codex-marketplace/` and `opencode-dist/`, and never hand-edit either output. Claude users refresh with `/plugin marketplace update`.

### Commit-time sync

Install the repository hook once per checkout:

```bash
node scripts/install-git-hooks.mjs
```

Before each relevant commit the hook regenerates both host distributions. It stages only `.agents/plugins/marketplace.json`, `codex-marketplace/`, and `opencode-dist/`, and it never stages authored Claude source. It refuses to proceed when a renderer input is unstaged or untracked, so no output ships for source that is absent from the commit. The CI drift gate stays mandatory, so a clone without the hook cannot merge stale derived artifacts. A commit made with `--no-verify` cannot either.

### Local review before a PR

`code-ops-suite:local-review-gate` runs rigor's deep review and the privacy OpSec gate on the operator's host. It binds both reports to the exact base SHA, HEAD SHA, and binary diff. It can then publish the `local-deep-review` and `local-opsec-gate` commit statuses once the branch is pushed. GitHub Actions runs deterministic validation only. Provider-specific workflow examples remain available for a repository that prefers hosted model review.

Before opening a PR, take four steps:

1. Run `code-ops-suite:local-review-gate` on the final committed diff.
2. Push the reviewed branch.
3. Publish its SHA-bound commit statuses.
4. Open the PR.

Put a recurring scan on a schedule with Routines (`/schedule`), covering dependencies, security, egress and metadata, and a periodic `rigor` bug sweep. Let deterministic tools handle the mechanical checks, and reserve the skills for judgment-heavy work.

### Bundled scripts

- **`lint-plugins.mjs`** is the structural linter and the CI gate in `.github/workflows/validate.yml`. It checks manifest fields, marketplace and version parity, duplicate or unregistered plugins, README skill counts and mention parity, required `SKILL.md` fields, frontmatter YAML safety, orchestrator skill references, runtime-script parity, verbatim CONVENTIONS duplication, `§<id>` section references, subagent-name integrity, a frontmatter angle-bracket injection guard, agent model-tier floors, producer register wiring, and the SHARED_PASSAGES doctrine-core drift gate.
- **`check-no-deps.mjs`** fails when any third-party import appears, which locks the dependency-free invariant.
- **`build-codex-marketplace.mjs`** is the deterministic renderer for the Codex distribution. It derives `.agents/plugins/marketplace.json` and the tracked `codex-marketplace/` payload from the Claude source, and `--check` fails on drift.
- **`build-opencode-dist.mjs`** is the deterministic renderer for `opencode-dist/`. It plugin-prefixes every name because opencode uses flat directories and no colon, and `--check` fails on drift.
- **`model-tiers.mjs`** declares the provider-agnostic tier ladder (`frontier > strong > mid > light`) and its bindings for eight providers. The lint gate and the opencode renderer both read it, so the doctrine and the gate cannot disagree. Adding a provider is one entry.
- **`ledger-grammar.mjs`** declares the `DISPATCH_LEDGER.md` row shape, status set, and table header once. The writer and three readers import it, so a shape change cannot leave one tool parsing the old form.
- **`run-contract.mjs`** compiles a run's objective, quality criteria, bounded work graph, routing, and scopes before fan-out. It reconciles planned work with the dispatch ledger and finalizes only after owner-qualified acceptance.
- **`check-model-registry.mjs`** re-verifies every pinned model id against the models.dev registry. Network access is opt-in through `--fetch` and stays outside CI, so a registry outage cannot fail the build.
- **`install-git-hooks.mjs`** installs the tracked pre-commit hook that synchronizes and stages only host-derived artifacts.
- **`revalidate-register.mjs`** re-greps each register item's `file:line` against the current tree and reports FRESH, MOVED, DRIFTED, GONE, AMBIGUOUS, or NO-REF. A `DRIFTED` verdict means the line no longer carries the item's verbatim anchor, so stale findings get re-triaged before anyone acts on them. Each plugin carries a copy for `${CLAUDE_PLUGIN_ROOT}/scripts/`.
- **`check-autofix-scope.mjs`** is the auto-apply diff gate. It denies always-gated paths, oversize diffs, and export-touching lines before an agent may auto-apply a fix, and it is fail-closed with no flags.
- **`run-proof.mjs`** is the execution-receipt ledger that records and replays a run, so a claimed test result is replayable rather than narrated. `check-proof-integrity.mjs` holds add-only pins on proof tests, so a weakened proof reports a loud PROOF-AMENDED.
- **`scan-redaction.mjs`** matches fail-closed secret shapes over the suite's own output artifacts. `scan-injection-tells.mjs` reports prompt-injection tells in agent-ingested content, as a report-only floor with an opt-in fail.
- **`lib-docs.mjs`** is the local-first current-docs engine. It resolves a library's installed version and returns its README and type exports with no network by default. `--fetch` adds a fallback to the library's own source. It ships in each plugin and as the `code-ops-docs` MCP server (`lib-docs-mcp.mjs`).
- **`evals/`** is the eval harness. `.github/workflows/validate.yml` runs every automated regression eval plus the zero-dependency and fixture-drift guards, and `evals/README.md` owns the inventory and the judgment-eval approach.

## What is inside

Four plugins ship from one repository:

- **`code-ops-suite`** covers general engineering for any codebase: audit, security and privacy threat assessment, remediation, feature discovery and build, performance, tests, dependencies, PR review, local review gates, repo docs, standards adoption, onboarding, normalization, PR splitting, ship, debug, current docs, architecture and API and data-model and ADR and ops documentation, run handoff, the atlas, the docs vault, the conformance pass, and the suite's own calibration, cost, and parity audits. (34 skills)
- **`privacy-opsec-suite`** covers the privacy, anonymity, and OpSec specialization: the anonymity threat model, anonymous sessions, Tor and proxy egress with leak prevention, metadata minimization, fingerprint and traffic-analysis resistance, supply-chain trust, opsec hardening, leak incident response, the opsec PR gate, and authorship hygiene. (14 skills)
- **`rigor`** covers verification-first quality: find real bugs and prove each with a repro, validate the test suite with flaky and mutation testing, lock behavior with characterization safety nets, fix at root cause with a regression guard, close inconsistencies with enforcement, and ship measured improvements. Prove it or do not report it. (11 skills)
- **`researcher`** covers code-grounded research: ground in the codebase or the given materials, gather external knowledge, then propose improvements, design briefs, library evaluations, ideas, and an ecosystem watch. Every claim is cited and tiered, sourcing is local-first with disclosed fail-closed egress, and implementation hands off to the other suites. (7 skills)

Install `code-ops-suite` on any project for breadth. Add `privacy-opsec-suite` when the project has anonymity or opsec requirements, such as anonymous sessions, Tor routing, or strong metadata minimization. Reach for `rigor` when you want proven bugs and enforced consistency rather than a long list. The three compose: a broad `code-ops-suite:codebase-audit` for the map, then `rigor:bug-hunt` to prove the real defects, then `privacy-opsec-suite:tor-egress-audit` for the anonymity pass.

```
code-ops/
├── .agents/plugins/marketplace.json      # Codex catalog (generated)
├── .claude-plugin/marketplace.json       # Claude Code catalog → four plugins
├── codex-marketplace/                    # generated native Codex packages
│   └── plugins/<name>/.codex-plugin/plugin.json
├── opencode-dist/                        # generated opencode distribution
│   ├── skills/ agents/ commands/         # flat directories, plugin-prefixed names
│   ├── code-ops/<name>/scripts/          # bundled runtime scripts
│   ├── configs/                          # one ready-made config per provider
│   └── opencode.json                     # agent-to-model bindings
├── scripts/                              # canonical gate and runtime scripts
├── evals/                                # regression and judgment eval harness
├── code-ops-docs/                        # the documentation hub and Obsidian vault
└── plugins/
    ├── code-ops-suite/                   # 34 skills, explorer + reviewer, hooks/
    ├── privacy-opsec-suite/              # 14 skills, explorer + privacy-reviewer
    ├── rigor/                            # 11 skills, tracer + verifier
    └── researcher/                       # 7 skills, gatherer + claim-checker
```

Every plugin directory holds `.claude-plugin/plugin.json`, `CONVENTIONS.md`, `README.md`, `CHANGELOG.md`, `skills/`, `agents/`, and `scripts/`. Three of them also ship an `examples/` workflow, and only `code-ops-suite` ships `hooks/`.

See each plugin's `README.md` for its full skill list, its loops and automation guidance, and how its skills chain together.
