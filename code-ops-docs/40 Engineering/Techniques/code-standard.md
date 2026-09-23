# The house code standard

Every change this marketplace makes to code is read later by a reviewer, a maintainer, or a
model with no context. This page states what that code must look like. It is the index of the
code standard, not a second copy. Where a convention, a skill, or a scanner already owns a rule,
this page states the rule in one line and points at the owner. The
[house writing standard](writing-standard.md) binds the prose inside comments.

## Precedence

When two rules conflict, the ordered objective decides: correctness and the safety floor, then
module boundaries, then measured hot-path performance, then readability, then size. The
implementation loop in [code-ops-suite `CONVENTIONS.md` §11](../../../plugins/code-ops-suite/CONVENTIONS.md)
owns that order. An explicit repository convention outranks a default on this page. It never
outranks the safety floor or a gate.

## The rules

### 1. Design before implementation

Every change starts with a design, and the step is never skipped. The size of the design follows
the size of the change, as the [procedure below](#design-before-implementation-by-change-size)
sets out. The §11 plan step and the Phase 0 checkpoints of `ship` and `feature-implementation`
carry this rule inside the suite.

### 2. Less code wins

Choose the smallest solution that is correct and readable. Use architecture as the first lever,
because a design that removes a layer removes every line in it. Fewer lines decides only between
candidates that tie on the ordered objective. Climb the code-economy ladder (§11) before you
write. Mark a deliberate simplification with a `deferred(<ceiling>, <upgrade path>)` comment.

### 3. Modularity is earned

Give each module one purpose, a clear boundary, and dependencies that point one way. Add
structure only on evidence:

- **A new interface** needs a second implementor.
- **A new layer** must do work of its own, not forward calls.
- **A new file or wrapper** needs the ladder's extraction evidence: a second caller, a unit that needs its own test, or a file past the repository's size norm.

Keep boundaries unchanged unless the task is a boundary change. The size-and-boundary lens (§10)
owns the review of this rule.

### 4. Efficient by design, optimized by measurement

Pick the data structure and algorithm that fit the access pattern. Do no needless work, I/O, or
allocation on a hot path. Profile before you micro-optimize, and keep an optimization only when a
benchmark shows the win. Never trade readability for an unmeasured win, or algorithmic complexity
for brevity on a measured hot path. The `performance` skill owns the profiling procedure.

### 5. Language standards and the repository toolchain

Follow the language's official style guide and idioms. Run the formatter, linter, and type
checker the repository configures, and leave them green. An explicit repository convention wins
over the language default. Where no tool is configured, match the dominant sound pattern nearby.

Adopt the repository's existing strictness, and never lower it. New code meets the floor below
wherever the repository already enforces that check. Do not force a repository-wide config
change to reach it.

| Language | Strictness floor |
|---|---|
| TypeScript | TypeScript 7 with `strict: true` and `noUncheckedIndexedAccess` in `tsconfig.json`; no new `any`. JavaScript in this repository opts in per file with `// @ts-check` and JSDoc types. |
| Python | `pyright --strict` or `mypy --strict`. |
| Go | `go vet ./...` and `staticcheck ./...` clean. |
| Rust | `cargo clippy -- -D warnings`. |
| C# | `<Nullable>enable</Nullable>` and `<TreatWarningsAsErrors>true</TreatWarningsAsErrors>`. |
| Java | `javac -Xlint:all -Werror`. |
| Kotlin | `allWarningsAsErrors` in the Kotlin compiler options. |

Add no suppression comment (`@ts-expect-error`, `# type: ignore`, `noqa`, `eslint-disable`,
`nolint`, `#[allow]`, `#pragma warning disable`) without a reason on the same line.
`scan-overbuild.mjs` flags a bare one as `NEW-SUPPRESSION`.

### 6. Current, stable practice

Write to the versions the repository pins, with the idioms those versions recommend. Verify an API
against the installed version or primary documentation, never memory (`current-docs`). When you
choose a new version, choose the current stable release. Upgrade in staged steps
(`dependency-upgrade`). Never adopt a pre-release by default, or add a dependency without a
decision record.

### 7. Comments carry reasons

Comment the non-obvious reason, contract, or invariant. Never narrate what the code already says.
Match the comment density of the surrounding code. Correct or delete a comment the code has made
false, because a stale comment is a claims-vs-enforcement defect (§10 documentation accuracy).

### 8. No slop, no spaghetti

Ship none of these:

- **Placeholder and disclaimer comments**, such as "TODO: implement" or "in a real implementation".
- **Dead code** and commented-out code.
- **Speculative abstractions** built for a caller that does not exist.
- **Near-duplicates** of logic that already exists in the tree.
- **Tangled control flow**: deep nesting where an early return reads flatter, or a flag that switches one function between two jobs.
- **Mega-functions** divided by banner comments, debug residue, emoji, and generic names such as `data` or `utils`.

A `deferred(...)` marker is not a placeholder, because it names a limit and a way past it. The
[`normalize` tell list](../../../plugins/code-ops-suite/skills/normalize/SKILL.md) owns the full
catalog and the removal procedure.

### 9. Proportionate verification

Each test must catch a distinct failure on changed behavior or a critical path. Write no duplicate
case, no tautological test, and no test that mirrors the implementation. Size new tests like their
neighbors (§11 test step). Scale review depth to risk. The default is the deterministic gate chain
plus the lead's diff read, and model review gates run only on a high-risk surface, as the
[repository `CLAUDE.md`](../../../CLAUDE.md) states. Proportion never lowers the evidence bar: a
CONFIRMED finding still needs its one executed proof, and no required gate is skipped or weakened.

### 10. Never repeat work

Re-run a gate, test, or review only when its input changed or its result is disputed. The
repository `CLAUDE.md` holds the lead to the same rule. Reuse evidence that is still valid: a FRESH
[atlas](atlas.md) section, a receipt, a persisted report, or the symbol index. Give a finding one
fix-and-verify pass, and continue a review-fix-review loop only on new evidence. Batch related
edits so one gate run covers them. The §11 cascade circuit-breaker owns the stop after repeated
failed fixes.

Start each phase — fix, integrate, rework — with a fresh operative, briefed at the changed files
and the prior report path. Never send a finished operative new work. A resumed operative
re-reads its whole history every turn, and one measured run reached about 4.1 million
token-equivalents across fix, rework, and two integrations. This cap does not reach
dispatch-ledger recovery. Resuming a hung or failed unit within the same phase stays allowed
there.

## What backs each rule

A rule is mechanically backed when a script reports a violation without a reader. Review holds
every other rule: the lead's read of the final diff on every change, plus the lenses a skill applies.

| Rule | Mechanical backstop | Held by review |
| --- | --- | --- |
| 1. Design first | None. | A design exists at the right size. `ship` and `feature-implementation` checkpoint it at Phase 0. |
| 2. Less code | `scan-overbuild.mjs` NEW-FILE-RATIO and UNREAD-CONFIG, advisory. `harvest-deferrals.mjs` collects the markers. | Whether the architecture minimized the code. |
| 3. Earned modularity | `scan-overbuild.mjs` SINGLE-IMPLEMENTOR, PASS-THROUGH, and DUPLICATE-HELPER, advisory. | Cohesion and dependency direction. `import-graph.mjs` maps edges as evidence and gates nothing. |
| 4. Efficiency | None that gates. In this repository, `benchmark-command.mjs` produces wall-time evidence. | The performance and efficiency lenses, `performance`, and `rigor:improve-measured`. |
| 5. Language standards | The formatter, linter, and type checker the repository runs in CI. In this repository, `lint-plugins.mjs`. | Idiom and convention fit where no tool reaches. |
| 6. Current practice | `scan-overbuild.mjs` NEW-DEPENDENCY, blocking. In this repository, also `check-no-deps.mjs` and `check-action-pins.mjs`. | Version currency, idiom currency, and pre-release adoption. |
| 7. Comments | `scan-overbuild.mjs` COMMENTED-CODE, advisory. | Narration, density, and stale comments. |
| 8. No slop | `scan-overbuild.mjs` COMMENTED-CODE and DUPLICATE-HELPER, advisory. | Every other tell in the `normalize` list. |
| 9. Proportionate verification | `scan-overbuild.mjs` TEST-BLOAT, advisory. | Distinct, non-tautological tests, and review depth against risk. |
| 10. No repeated work | `atlas-check.mjs` reports section freshness. `local-review-gate` receipts bind an exact SHA, and a new commit voids them. | Whether a re-run had a changed input or a disputed result, and whether each phase started a fresh operative. |

Only NEW-DEPENDENCY blocks. Every other scanner tell is a lead for review, and a clean scan is not
proof of a right-sized change. The [scanner header](../../../scripts/scan-overbuild.mjs) states its
ceiling: line-shaped heuristics for JavaScript, TypeScript, and Python, not a parse.

## Design before implementation, by change size

Size the change first, then write the design that size requires, before the first edit.

| Change size | Design | Where it lives |
| --- | --- | --- |
| One-line or local fix | One sentence: what changes, why, and what stays unchanged. | The commit message body or the run log. |
| Bounded change inside one module | The owning module, the ladder result, any interface change, the tests that prove it, and the blast radius. | The PR body or the run plan. |
| Feature or boundary change | Boundaries, data flow, interfaces, failure modes, and any dependency decision. | A design note in the hub's `10 Design/` folder, plus a decision record per locked choice. Without a hub, the PR description or the change's decision record. |

A one-sentence design reads like this: "Return an empty result from `parseRange` on an empty diff,
because the scanner crashed on it. The output format stays unchanged."

1. Size the change. When unsure between two sizes, pick the larger.
2. Climb the ladder. Its answer is part of the design, and it can remove the change entirely.
3. Write the design at that size.
4. For a feature or boundary change, confirm the design at a checkpoint before you build.
5. Implement to the design. When the code proves the design wrong, revise the design first.

## What this standard does not adopt

- **A per-language style guide.** The official guide and the configured tools own style. A copy here would drift from both.
- **Line-count or function-length quotas.** Size is the last objective, and the repository's own size norm is the evidence (§11).
- **Doc comments on every symbol.** Document a public contract where the language convention expects one.

## Where it applies

The standard binds every code change a skill, an operative, or the lead makes, in this repository
and in every target repository. Tests, scripts, hooks, and configuration are code. Generated and
vendored files follow their generator or canonical source, not this page.
