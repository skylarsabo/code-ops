# Getting Started

This page takes you from "nothing installed" to running your first code-ops workflow and reading the result. Start at the top; the first sections need no prior Claude Code or Codex fluency. The closing [For fluent users](#for-fluent-users-set-the-automation-level-once) section adds depth for engineers already comfortable with the harness.

> **One-page orientation.** Code-ops is a marketplace of four installable plugins. Add the marketplace once, install `code-ops-suite` for general engineering breadth, then add `rigor`, `privacy-opsec-suite`, or `researcher` only when a project needs them. In Claude Code, run a namespaced slash command such as `/code-ops-suite:codebase-audit`; in Codex, name `code-ops-suite:codebase-audit` in your request. Each workflow opens with a short scoping **checkpoint** — it asks you a question with numbered options, a recommendation, and a default — then runs and checks back in at the decisions that matter. Output artifacts (registers, summaries, generated docs) land in a dated run folder under `docs/`. You stay in the loop the whole way; nothing in a high-risk category changes without your explicit approval.

---

## 1 · The four plugins, and which to install

Code-ops is one marketplace (`code-ops`) that publishes four plugins. You install only what a project needs.

| Plugin | What it is | Install it when |
| --- | --- | --- |
| `code-ops-suite` | The spine: general engineering for any repo — audit, remediation, feature discovery/build, performance, tests, dependencies, PR review, normalization, doc generators, and the orchestrators. (25 skills) | Always. This is the baseline for any project. |
| `rigor` | The verification layer: prove-it-or-don't. Find real bugs (with runnable repros), validate the test suite, lock behavior with safety nets, fix at root cause with a regression guard. (11 skills) | When you want **proven** defects and enforced consistency rather than a long list — the highest-signal option. |
| `privacy-opsec-suite` | The anonymity track: anonymity threat model, Tor/proxy egress and leak audits, metadata minimization, fingerprinting resistance, opsec hardening, authorship hygiene. (14 skills) | Only on projects with anonymity/opsec requirements (anonymous sessions, Tor/onion routing, strong metadata minimization). |
| `researcher` | The proposal layer: code-grounded research, local-first with disclosed, fail-closed egress. It proposes (registers + design briefs) and hands implementation to the other three. It never edits code. (7 skills) | When you want grounded improvement proposals, design spikes, or library evaluations before building. |

Rule of thumb (from the top-level [`README.md`](../../README.md)): **`code-ops-suite` for breadth, `rigor` for proof, `privacy-opsec-suite` for the anonymity specialization.** The plugins compose — see [Recommended order](#4--recommended-order-composing-the-plugins).

## 2 · Install the marketplace

### Claude Code

You need a recent build of Claude Code, since plugins and skills are current features. Check and update first:

```bash
claude --version
claude update
```

Then pick one install path. (The first three are mirrored from the top-level [`README.md`](../../README.md); use whichever fits.)

**A) Local — fastest, try it now.** Clone or unzip this repository somewhere, then inside Claude Code (run from any repo):

```text
/plugin marketplace add /absolute/path/to/code-ops
/plugin install code-ops-suite@code-ops
/plugin install rigor@code-ops                    # verification-first bug/quality suite
/plugin install privacy-opsec-suite@code-ops      # optional — anonymity/opsec projects
/plugin install researcher@code-ops               # optional — code-grounded research
```

On Windows a path like `C:\Users\you\code-ops` works too. The equivalent non-interactive terminal form is `claude plugin marketplace add …` and `claude plugin install …@code-ops`.

**B) GitHub — shareable with your team.** Push this repository to GitHub, then:

```text
/plugin marketplace add your-org/code-ops
/plugin install code-ops-suite@code-ops
```

Any git host works: `/plugin marketplace add https://gitlab.com/your-org/code-ops.git`.

**C) Auto-require for a repo / team.** Add to the project's `.claude/settings.json` so teammates are prompted to install when they trust the folder. See the top-level [`README.md`](../../README.md) for the exact `extraKnownMarketplaces` + `enabledPlugins` block.

Install only `code-ops-suite` to begin. Add the other three as a project's needs emerge — they're independent installs.

### Codex

Use the repository-root Codex marketplace, which points at the generated native packages:

```bash
codex plugin marketplace add .
codex plugin list --marketplace code-ops --available --json
codex plugin add code-ops-suite@code-ops
```

Install `rigor`, `privacy-opsec-suite`, and `researcher` with the same `codex plugin add <name>@code-ops` form as needed. For GitHub, use `codex plugin marketplace add skylarsabo/code-ops --ref main`. The renderer preserves the manual-only workflow policy, so name the workflow explicitly rather than expecting it to run automatically.

> **A note on the cross-plugin orchestrators.** A few `code-ops-suite` skills require the others to be installed: `everything` needs `rigor` *and* `privacy-opsec-suite`; `ship` and `debug` need `rigor`. The skill states its requirement when you invoke it. If you only installed `code-ops-suite`, the single-plugin workflows (`codebase-audit`, `pr-review`, the doc generators, `full-sweep`, …) all work on their own.

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

You can append natural-language scope after the command (`… for the current branch`, `… focus on the auth module`). Run `/plugin` to browse installed Claude Code plugins and their skills.

In Codex, name the same workflow in the request instead: `Use rigor:bug-hunt on the auth module.` All skills are **manual-invoke** on both hosts: they run only when you explicitly name the workflow, never automatically. They're deliberate operations — an audit or a threat model shouldn't fire on its own.

## 4 · Recommended order (composing the plugins)

The plugins compose into one flow; run as much or as little as a task needs. From the top-level [`README.md`](../../README.md):

1. **`code-ops-suite:full-sweep`** (or `:codebase-audit`) — a broad map of the codebase and a first findings pass.
2. **`rigor:rigor-sweep`** (start `assess-only`) — establish ground truth, validate the test suite, then **prove** the real bugs, lock behavior with safety nets, and fix at root cause with a regression guard. This is the high-signal core.
3. **`privacy-opsec-suite:full-sweep`** — only on projects with anonymity/opsec requirements: the threat model, Tor/egress + leak audits, and hardening.
4. Wire the matching PR gate(s) into CI: `rigor:deep-review` and/or `privacy-opsec-suite:opsec-pr-gate`.

To run all of it in one command, `code-ops-suite:everything` orchestrates every phase across the plugins end-to-end. It's the most thorough and most token-expensive option, runs phased with checkpoints (not a blind firehose), and requires the three engineering plugins (code-ops-suite, rigor, and privacy-opsec-suite) installed. See [03-orchestrators.md](03-orchestrators.md) for when to reach for which orchestrator.

## 5 · What a checkpoint looks like, and how to respond

Code-ops is **developer-in-the-loop**: you are available, and the workflow consults you instead of guessing. Most workflows open with a short scoping checkpoint, then pause again at phase boundaries and on any decision that has real trade-offs.

The interaction protocol (`code-ops-suite/CONVENTIONS.md` §3) is precise about the form a checkpoint takes. When the skill asks, it gives you:

- **numbered options**,
- **a recommendation**, and
- **a default**,

with a one-line trade-off per option. Concretely, `codebase-audit`'s Phase 0 checkpoint presents the module inventory, the build/test baseline, and the orchestration plan, then asks you to confirm scope — which areas to include, skip, or prioritize, and any off-limits paths — before it proceeds.

How to respond:

- **Pick a number, or just steer in plain language.** "Option 2", "skip the vendored code", "auto-approve the low-risk ones", "always open a PR per item" all work. The skill honors the steering and remembers it for the rest of the run.
- **Accept the default** by letting it proceed — the recommended option is the safe path when you're unsure.
- The skill keeps momentum on independent, in-scope work while a decision is pending, and batches related questions into one checkpoint rather than nagging you per item.

The principle behind it: the skill **asks** when intent is ambiguous, a choice has trade-offs, an action is risky or behavior-changing, or it finds something critical (which it surfaces immediately); it **proceeds** when the work is clear, safe, low-stakes, and already in agreed scope. See [05-evidence-and-tiers.md](05-evidence-and-tiers.md) for how findings are graded, and the [For fluent users](#for-fluent-users-set-the-automation-level-once) section below (and `code-ops-suite/CONVENTIONS.md` §4) for tuning how often it pauses.

## 6 · Where the artifacts land

Workflows write their output as files so the results outlive the session and diff in version control. Per `code-ops-suite/CONVENTIONS.md` §12:

- **Run artifacts** go in a **dated folder under the repo's docs location** — `docs/<area>/<date>/` — or the repo root if the project has no docs convention. The skill detects and matches your repo's existing docs structure rather than imposing a new one.
- **Authoritative reference docs** (architecture, API, data-model docs, ADRs) live in the repo's existing docs/SSOT location and are reconciled in place.

The standard filenames a workflow produces are named in the skill itself. For example, `codebase-audit` writes, under its dated audit folder:

- `FINDINGS_REGISTER.md` — the ranked, authoritative findings backlog (the single source of truth; see [04-registers-and-freshness.md](04-registers-and-freshness.md)),
- `REMEDIATION_LOG.md` — the safe fixes it applied (what / why / files / commit / verification),
- `FEATURE_OPPORTUNITIES.md` — opportunities noticed in passing,
- `EXECUTIVE_SUMMARY.md` — coverage, baseline-to-after, counts by severity and lens, and the highest-value next actions, presented first.

A register isn't a one-shot report — it's a live backlog with stable IDs (`PERF-007`, `SEC-003`, `FEAT-012`) that downstream skills update as items ship, and that gets re-validated for freshness before anyone acts on it.

---

## For fluent users: set the automation level once

If you already live in Claude Code or Codex, two things are worth internalizing up front.

**Set the automation level at the start of a run.** Every code-changing step is governed by an automation level you set once, defaulting to `gated` (`code-ops-suite/CONVENTIONS.md` §4). The ladder:

- **`gated`** *(default)* — pause for approval at each fix/closure batch.
- **`auto-safe`** *(recommended ceiling)* — auto-apply only **NOW-SAFE** items: each on a branch, test-backed, behavior-preserving, and trivially revertible. It still pauses for NEEDS-REVIEW, NEEDS-DESIGN, and the always-gated categories.
- **`auto-all`** — *not recommended.*

The orchestrators take this as an explicit Phase 0 input. `everything`, for instance, opens with a "Scope, automation level & preflight" checkpoint where you choose the level (and `auto-safe` there means auto-applying **CONFIRMED + NOW-SAFE** fixes, each carrying a failing-then-passing regression test that passes the regression guard — the tier gate from `rigor` layered on top of the code-ops ladder). You can also set a **check-in level** — normal (per phase) or minimal (only at the consolidated review plus always-gated items).

**Nothing in an always-gated category proceeds without your approval — regardless of level.** Even at `auto-all`, these always stop for you:

- security / auth changes,
- secret handling,
- data migrations and destructive or irreversible operations,
- public API / contract changes.

And nothing is **ever auto-merged**: even auto-applied fixes land as commits or PRs for your review. So the practical move is to raise the level for breadth and mechanical work, trusting that the categories where a mistake is expensive remain gated by construction.

For a fuller treatment of choosing and steering the level mid-run, see `code-ops-suite/CONVENTIONS.md` §4. For the evidence tiers (`CONFIRMED` / `PROBABLE` / `SPECULATIVE`) that decide which items are even eligible for an automated fix, see [05-evidence-and-tiers.md](05-evidence-and-tiers.md).

---

**Next:** [02-mental-model.md](02-mental-model.md) — the four-plugin model and how the pieces compose. Or jump to the [command reference](commands/README.md) for the full task-to-command router.

*Verified-at: c2b37e9*
