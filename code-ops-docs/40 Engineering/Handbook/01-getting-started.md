# Getting Started

This page takes you from "nothing installed" to running your first code-ops workflow and reading the result. It is written for an engineer with no prior Claude Code or Codex fluency. Start at the top, and read [For fluent users](#for-fluent-users-set-the-automation-level-once) last if you already live in the harness.

> **One-page orientation.** Code-ops is a marketplace of four installable plugins. Add the marketplace once, install `code-ops-suite` for general engineering breadth, then add `rigor`, `privacy-opsec-suite`, or `researcher` only when a project needs them. In Claude Code, run a namespaced slash command such as `/code-ops-suite:codebase-audit`. In Codex, name `code-ops-suite:codebase-audit` in your request. Each workflow opens with a short scoping **checkpoint**, which asks you a question with numbered options, a recommendation, and a default. It then runs and checks back in at the decisions that matter. Output artifacts (registers, summaries, generated docs) land in a dated run folder, under the repo's docs location or under the vault's `80 Runs/`. You stay in the loop the whole way, and nothing in a high-risk category changes without your explicit approval.

---

## 1 · The four plugins, and which to install

Code-ops is one marketplace (`code-ops`) that publishes four plugins. You install only what a project needs.

| Plugin | What it is | Install it when |
| --- | --- | --- |
| `code-ops-suite` | The spine: general engineering for any repo, covering audit, remediation, feature discovery and build, performance, tests, dependencies, PR review, normalization, doc generators, the orchestrators, and suite self-audit. (34 skills) | Always. This is the baseline for any project. |
| `rigor` | The verification layer: prove it or do not report it. Find real bugs (with runnable repros), validate the test suite, lock behavior with safety nets, fix at root cause with a regression guard. (11 skills) | When you want **proven** defects and enforced consistency rather than a long list. It is the highest-signal option. |
| `privacy-opsec-suite` | The anonymity track: anonymity threat model, Tor and proxy egress and leak audits, metadata minimization, fingerprinting resistance, opsec hardening, authorship hygiene. (14 skills) | Only on projects with anonymity or opsec requirements (anonymous sessions, Tor or onion routing, strong metadata minimization). |
| `researcher` | The proposal layer: code-grounded research, local-first with disclosed, fail-closed egress. It proposes registers and design briefs and hands implementation to the other three. It never edits code. (7 skills) | When you want grounded improvement proposals, design spikes, or library evaluations before building. |

Rule of thumb (from the top-level [`README.md`](../../../README.md)): **`code-ops-suite` for breadth, `rigor` for proof, `privacy-opsec-suite` for the anonymity specialization.** The plugins compose. See [Recommended order](#4--recommended-order-composing-the-plugins).

## 2 · Install the marketplace

### Claude Code

You need a recent build of Claude Code, because plugins and skills are current features. Check and update first:

```bash
claude --version
claude update
```

Then pick one install path. The first three are mirrored from the top-level [`README.md`](../../../README.md), so use whichever fits.

**A) Local, and fastest to try now.** Clone or unzip this repository somewhere, then run these inside Claude Code from any repo:

```text
/plugin marketplace add /absolute/path/to/code-ops
/plugin install code-ops-suite@code-ops
/plugin install rigor@code-ops                    # verification-first bug/quality suite
/plugin install privacy-opsec-suite@code-ops      # optional, anonymity/opsec projects
/plugin install researcher@code-ops               # optional, code-grounded research
```

On Windows a path like `C:\Users\you\code-ops` works too. The equivalent non-interactive terminal form is `claude plugin marketplace add …` and `claude plugin install …@code-ops`.

**B) GitHub, and shareable with your team.** Push this repository to GitHub, then run:

```text
/plugin marketplace add your-org/code-ops
/plugin install code-ops-suite@code-ops
```

Any git host works, for example `/plugin marketplace add https://gitlab.com/your-org/code-ops.git`.

**C) Auto-require for a repo or team.** Add the marketplace to the project's `.claude/settings.json` so teammates are prompted to install when they trust the folder. See the top-level [`README.md`](../../../README.md) for the exact `extraKnownMarketplaces` and `enabledPlugins` block.

Install only `code-ops-suite` to begin. Add the other three as a project's needs emerge, because they are independent installs.

### Codex

Use the repository-root Codex marketplace, which points at the generated native packages:

```bash
codex plugin marketplace add .
codex plugin list --marketplace code-ops --available --json
codex plugin add code-ops-suite@code-ops
```

Install `rigor`, `privacy-opsec-suite`, and `researcher` with the same `codex plugin add <name>@code-ops` form as needed. For GitHub, use `codex plugin marketplace add skylarsabo/code-ops --ref main`. The renderer emits `allow_implicit_invocation: true` for each skill, mirroring Claude's model-invocable skills, so Codex may invoke a workflow implicitly. Naming it explicitly remains the most reliable route.

> **A note on the cross-plugin orchestrators.** A few `code-ops-suite` skills require the others to be installed. `everything` needs `rigor` *and* `privacy-opsec-suite`. `ship` and `debug` need `rigor`. The skill states its requirement when you invoke it. If you installed only `code-ops-suite`, the single-plugin workflows (`codebase-audit`, `pr-review`, the doc generators, `full-sweep`, and the rest) all work on their own.

### Partial installs

The four plugins install independently, so most people run a subset. This section says which routes each subset supports. The [command router](commands/README.md#the-task--command-router) marks the same fact per row: **Requires `<plugin>`** for a route that does not run without it, and **Optional: `<plugin>`** for a route that runs and skips the cross-plugin step.

| Installed | What you get | What you do not get |
| --- | --- | --- |
| `code-ops-suite` alone | Every breadth route: `codebase-audit`, `remediation`, `pr-review`, `feature-discovery`, `feature-implementation`, `normalize`, `pr-split`, `dependency-upgrade`, `conform`, `atlas`, `vault`, the doc generators, and `full-sweep`. | `ship`, `debug`, and `everything`. `performance` and `test-hardening` lose their ground-truth baseline step. |
| `code-ops-suite` + `rigor` | The above plus `ship`, `debug`, the whole verification layer, and `rigor-sweep`. `ship` and `debug` fall back to the bundled `scan-ai-tells.mjs` for the traceless gate. | `everything`, and every anonymity route. |
| `code-ops-suite` + `rigor` + `privacy-opsec-suite` | `everything`, the anonymity track, and the anonymity PR gate. | The research routes. |
| `rigor` alone | The proof journey end to end: `ground-truth`, `test-suite-audit`, `bug-hunt`, `quality-scan`, `safety-net`, `fix-verified`, `deep-review`, `rigor-sweep`. | The build and doc routes it hands off to. |
| `privacy-opsec-suite` alone | The whole anonymity track: the threat model, the six leak audits, `opsec-hardening`, `opsec-pr-gate`, `authorship-hygiene`, and its own `full-sweep`. | The build hand-offs (`feature-implementation`, `normalize`). |
| `researcher` alone | Every research route: `research-spike`, `research-improve`, `research-ideate`, `library-eval`, `research-verify`, `ecosystem-watch`, `research-sweep`. It requires nothing beyond itself. | The implementation hand-offs. The proposals are written, and nothing picks them up. |

Two behaviors govern a missing plugin, and neither is silent:

- **A hard prerequisite stops the run.** `everything`, `ship`, and `debug` declare their prerequisite in the skill itself and confirm availability before any fan-out.
- **A conditional step names its fallback.** `ship`, `debug`, and `pr-split` run `privacy-opsec-suite:authorship-hygiene` when it is installed, and run the bundled `scan-ai-tells.mjs` directly when it is not, so the traceless gate never disappears. `remediation` routes to `codebase-audit` or `rigor:bug-hunt` for a missing register, whichever is installed.

A hand-off is different from an invocation. Most cross-plugin edges are hand-offs: the skill finishes its own work, writes its register, and names the command to run next. If that command's plugin is absent, the artifact is still complete. The route simply ends there, and you install the plugin or carry the work forward yourself. The full edge list is in [skill-composition.md](../Techniques/skill-composition.md).

## 3 · Invoke a workflow

Every workflow is a **skill**. In Claude Code, invoke it as a namespaced slash command:

```text
/code-ops-suite:<skill>
```

For example:

```text
/code-ops-suite:codebase-audit
/code-ops-suite:pr-review for the current branch
/rigor:bug-hunt
/privacy-opsec-suite:anonymity-threat-model
```

You can append natural-language scope after the command, such as `… for the current branch` or `… focus on the auth module`. Run `/plugin` to browse installed Claude Code plugins and their skills.

In Codex, name the same workflow in the request instead: `Use rigor:bug-hunt on the auth module.` On both hosts, you invoke a skill by slash command, or the model routes to it per the standard-operating-mode routing card and each skill's own "Use when" description. Side-effect-bearing phases keep their developer-in-the-loop checkpoints, and nothing ever auto-merges.

## 4 · Recommended order (composing the plugins)

The plugins compose into one flow. Run as much or as little as a task needs. From the top-level [`README.md`](../../../README.md):

1. **`code-ops-suite:full-sweep`** (or `:codebase-audit`) for a broad map of the codebase and a first findings pass.
2. **`rigor:rigor-sweep`** (start `assess-only`) to establish ground truth, validate the test suite, then **prove** the real bugs, lock behavior with safety nets, and fix at root cause with a regression guard. This sequence is the high-signal core.
3. **`privacy-opsec-suite:full-sweep`**, only on projects with anonymity or opsec requirements: the threat model, the Tor, egress, and leak audits, and hardening.
4. Wire the matching PR gates into CI: `rigor:deep-review` and `privacy-opsec-suite:opsec-pr-gate`.

To run all of it in one command, `code-ops-suite:everything` orchestrates every phase across the plugins end to end. It is the most thorough and most token-expensive option. It runs phased with checkpoints rather than as a blind firehose, and it requires the three engineering plugins (code-ops-suite, rigor, and privacy-opsec-suite) installed. See [03-orchestrators.md](03-orchestrators.md) for when to reach for which orchestrator.

## 5 · What a checkpoint looks like, and how to respond

Code-ops is **developer-in-the-loop**: you are available, so the workflow consults you instead of guessing. Most workflows open with a short scoping checkpoint, then pause again at phase boundaries and on any decision that has real trade-offs.

The interaction protocol (`code-ops-suite/CONVENTIONS.md` §3) is precise about the form a checkpoint takes. When the skill asks, it gives you:

- **numbered options**,
- **a recommendation**, and
- **a default**,

with a one-line trade-off per option. Concretely, `codebase-audit`'s Phase 0 checkpoint presents the module inventory, the build and test baseline, and the orchestration plan. It then asks you to confirm scope, which areas to include, skip, or prioritize, and any off-limits paths, before it proceeds.

How to respond:

- **Pick a number, or steer in plain language.** "Option 2", "skip the vendored code", "auto-approve the low-risk ones", and "always open a PR per item" all work. The skill honors the steering and remembers it for the rest of the run.
- **Accept the default** by letting it proceed. The recommended option is the safe path when you are unsure.
- The skill keeps momentum on independent, in-scope work while a decision is pending, and batches related questions into one checkpoint rather than asking per item.

The principle behind the protocol: the skill **asks** when intent is ambiguous, a choice has trade-offs, an action is risky or behavior-changing, or it finds something critical, which it surfaces immediately. It **proceeds** when the work is clear, safe, low-stakes, and already in agreed scope. See [05-evidence-and-tiers.md](05-evidence-and-tiers.md) for how findings are graded, and the [For fluent users](#for-fluent-users-set-the-automation-level-once) section below (and `code-ops-suite/CONVENTIONS.md` §4) for tuning how often it pauses.

## 6 · Where the artifacts land

Workflows write their output as files, so the results outlive the session and diff in version control. Per `code-ops-suite/CONVENTIONS.md` §12:

- **Run artifacts** go in a **dated folder under the repo's docs location**, `docs/<area>/<date>/`, or the repo root if the project has no docs convention. In a repo that carries a `<repo>-docs/` Obsidian vault ([vault standard](../Techniques/vault-standard.md)), they go to the vault's `80 Runs/YYYY-MM-DD slug/` instead, keeping the same filenames. The skill detects and matches your repo's existing docs structure rather than imposing a new one.
- **Authoritative reference docs** (architecture, API, data-model docs, ADRs) live in the repo's existing docs or SSOT location and are reconciled in place.

The standard filenames a workflow produces are named in the skill itself. For example, `codebase-audit` writes these files under its dated audit folder:

- `FINDINGS_REGISTER.md`, the ranked, authoritative findings backlog and the single source of truth (see [04-registers-and-freshness.md](04-registers-and-freshness.md)),
- `REMEDIATION_LOG.md`, the safe fixes it applied, with what, why, files, commit, and verification,
- `FEATURE_OPPORTUNITIES.md`, opportunities noticed in passing,
- `EXECUTIVE_SUMMARY.md`, presented first, covering coverage, baseline against after, counts by severity and lens, and the highest-value next actions.

A register is not a one-shot report. It is a live backlog with stable IDs (`PERF-007`, `SEC-003`, `FEAT-012`) that downstream skills update as items ship, and that is re-validated for freshness before anyone acts on it.

## 7 · What runs without you asking

Installing `code-ops-suite` also installs hooks that compress the run itself. Three of them are on by default, and each stops when its switch holds `off`, `0`, or `false` in the `env` block of a `.claude/settings.json`:

- **The output digest** (`CODE_OPS_DIGEST`) rewrites an allowlisted shell command into a `digest.mjs` run, so a long result enters the context compressed with a receipt naming the raw file.
- **The symbol-index refresh** (`CODE_OPS_INDEX`) re-indexes a file you just edited, so `co context query` keeps answering from current code.
- **The ladder card** (`CODE_OPS_LADDER_CARD`) hands an implementer-class subagent the code-economy ladder and stays silent for read-only subagents.

Two more hooks need no switch to be useful. A `SessionEnd` receipt appends one row per session to `~/.claude/code-ops/session-receipts.jsonl`, prints nothing to the model, and sends nothing off the machine. Set `CODE_OPS_RECEIPTS=off` to stop it, or point it at another path. A `PreCompact` hook prints the preservation instruction the host reads as the compaction's custom instructions, so a long run survives compaction with its constraints intact.

Read [12-context-and-code-economy.md](12-context-and-code-economy.md) for what each mechanism does, [../../50 Platform/INFRASTRUCTURE.md](../../50 Platform/INFRASTRUCTURE.md) for the full switch list, and [../../55 Operations/MEASUREMENTS.md](../../55 Operations/MEASUREMENTS.md) for what they measure.

---

## For fluent users: set the automation level once

If you already live in Claude Code or Codex, two things are worth internalizing up front.

**Set the automation level at the start of a run.** An automation level you set once governs every code-changing step, and it defaults to `gated` (`code-ops-suite/CONVENTIONS.md` §4). The ladder:

- **`gated`** *(default)*: pause for approval at each fix or closure batch.
- **`auto-safe`** *(recommended ceiling)*: auto-apply only **NOW-SAFE** items, each on a branch, test-backed, behavior-preserving, and trivially revertible. It still pauses for NEEDS-REVIEW, NEEDS-DESIGN, and the always-gated categories.
- **`auto-all`**: not recommended.

The orchestrators take the level as an explicit Phase 0 input. `everything`, for instance, opens with a "Scope, automation level and preflight" checkpoint where you choose the level. There, `auto-safe` means auto-applying **CONFIRMED + NOW-SAFE** fixes, each carrying a failing-then-passing regression test that passes the regression guard, which is the tier gate from `rigor` layered on top of the code-ops ladder. You can also set a **check-in level**, either normal (per phase) or minimal (only at the consolidated review plus always-gated items).

**Nothing in an always-gated category proceeds without your approval, whatever the level.** Even at `auto-all`, these always stop for you:

- security and auth changes,
- secret handling,
- data migrations and destructive or irreversible operations,
- public API and contract changes.

And nothing is **ever auto-merged**: even auto-applied fixes land as commits or PRs for your review. So the practical move is to raise the level for breadth and mechanical work, trusting that the categories where a mistake is expensive remain gated by construction.

For a fuller treatment of choosing and steering the level mid-run, see `code-ops-suite/CONVENTIONS.md` §4. For the evidence tiers (`CONFIRMED`, `PROBABLE`, `SPECULATIVE`) that decide which items are even eligible for an automated fix, see [05-evidence-and-tiers.md](05-evidence-and-tiers.md).

---

**Next:** [02-mental-model.md](02-mental-model.md) for the four-plugin model and how the pieces compose. Or jump to the [command reference](commands/README.md) for the full task-to-command router.

*Verified-at: b0ffede*
