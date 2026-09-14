# The house code standard

Every change this marketplace makes to code is read later by a reviewer, a maintainer, or a
model with no context. This page states what that code must look like. It is the index of the
code standard, not a second copy of it. Where a convention, a skill, or a scanner already owns
a rule, this page states the rule in one line and points at the owner.

The [house writing standard](writing-standard.md) binds the prose inside code comments. This
page binds the code itself.

## Exec summary (stop here if that is all you need)

- Design every change before you write it, at a size proportionate to the change.
- Write the least code that is correct and readable. Architecture decides how little.
- Add modularity on evidence, never in advance.
- Design for efficiency. Optimize only after a measurement.
- Follow the language's official style and the repository's configured toolchain.
- Use current stable releases and idioms, verified against documentation.
- Comment the reason, the contract, or the invariant. Never narrate the code.
- Ship no slop: no placeholders, dead code, near-duplicates, or tangled control flow.

## Precedence

When two rules conflict, the ordered objective decides. Correctness and the safety floor come
first, then module boundaries, then measured hot-path performance, then readability, then size.
The implementation loop in
[code-ops-suite `CONVENTIONS.md` §11](../../../plugins/code-ops-suite/CONVENTIONS.md) owns that
order.

An explicit repository convention outranks a default on this page. It never outranks the
safety floor or a gate.

## The rules

### 1. Design before implementation

Every change starts with a design, and the step is never skipped. The size of the design follows
the size of the change. The procedure is in
[Design before implementation, by change size](#design-before-implementation-by-change-size).
The plan step of the implementation loop (§11) and the Phase 0 checkpoints of `ship` and
`feature-implementation` carry this rule inside the suite.

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

Keep boundaries unchanged unless the task is a boundary change. The size-and-boundary lens in
[§10](../../../plugins/code-ops-suite/CONVENTIONS.md) owns the review of this rule.

### 4. Efficient by design, optimized by measurement

Design for efficiency from the start. Pick the data structure and algorithm that fit the access
pattern. Do no needless work, I/O, or allocation on a hot path. Profile before you
micro-optimize, and keep an optimization only when a benchmark shows the win. Never trade
readability for an unmeasured win. Never trade algorithmic complexity for brevity on a measured
hot path. The `performance` skill owns the profiling procedure.

### 5. Language standards and the repository toolchain

Follow the language's official style guide and idioms. Run the formatter, linter, and type
checker the repository configures, and leave them green. When the repository states an explicit
convention, that convention wins over the language default. When the repository configures no
tool for a question, match the dominant sound pattern in the surrounding code.

### 6. Current, stable practice

Write to the versions the repository pins, using the idioms those versions recommend. Verify an
API against the installed version or its primary documentation, never memory (`current-docs`).
When you choose a new version, choose the current stable release. Upgrade deliberately, one
staged step at a time (`dependency-upgrade`). Never adopt a pre-release by default. Never add a
dependency without a decision record.

### 7. Comments carry reasons

Comment the non-obvious reason, contract, or invariant. Never narrate what the code already
says. Match the comment density of the surrounding code. Correct or delete a comment the code
has made false, because a stale comment is a claims-vs-enforcement defect under the
documentation accuracy lens (§10).

### 8. No slop, no spaghetti

Ship none of these:

- **Placeholder and disclaimer comments**, such as "TODO: implement" or "in a real implementation".
- **Dead code** and commented-out code.
- **Speculative abstractions** built for a caller that does not exist.
- **Near-duplicates** of logic that already exists in the tree.
- **Tangled control flow**: deep nesting where an early return reads flatter, or a flag that switches one function between two jobs.
- **Mega-functions** divided by banner comments.
- **Debug residue**, emoji, and generic names such as `data`, `temp`, or `utils`.

A `deferred(<ceiling>, <upgrade path>)` marker is not a placeholder. It names a limit and a way
past it, and the harvest carries it forward. The [`normalize` tell
list](../../../plugins/code-ops-suite/skills/normalize/SKILL.md) owns the full catalog and the
removal procedure.

## What backs each rule

A rule is mechanically backed when a script reports a violation without a reader. Every other
rule is held by review: the lead's read of the final diff, which runs on every change, plus the
quality lenses a skill applies.

| Rule | Mechanical backstop | Held by review |
| --- | --- | --- |
| 1. Design first | None. | A design exists at the right size. `ship` and `feature-implementation` checkpoint it at Phase 0. |
| 2. Less code | `scan-overbuild.mjs` NEW-FILE-RATIO, TEST-BLOAT, and UNREAD-CONFIG, advisory. `harvest-deferrals.mjs` collects the markers. | Whether the architecture minimized the code. |
| 3. Earned modularity | `scan-overbuild.mjs` SINGLE-IMPLEMENTOR, PASS-THROUGH, and DUPLICATE-HELPER, advisory. | Cohesion and dependency direction. `import-graph.mjs` maps edges as evidence and gates nothing. |
| 4. Efficiency | None that gates. In this repository, `benchmark-command.mjs` produces wall-time evidence. | The performance and efficiency lenses, `performance`, and `rigor:improve-measured`. |
| 5. Language standards | The formatter, linter, and type checker the repository runs in CI. In this repository, `lint-plugins.mjs`. | Idiom and convention fit where no tool reaches. |
| 6. Current practice | `scan-overbuild.mjs` NEW-DEPENDENCY, blocking. In this repository, also `check-no-deps.mjs` and `check-action-pins.mjs`. | Version currency, idiom currency, and pre-release adoption. |
| 7. Comments | `scan-overbuild.mjs` COMMENTED-CODE, advisory. | Narration, density, and stale comments. |
| 8. No slop | `scan-overbuild.mjs` COMMENTED-CODE and DUPLICATE-HELPER, advisory. | Every other tell in the `normalize` list. |

Only NEW-DEPENDENCY blocks. Every other scanner tell is a lead for review, and a clean scan is not
proof of a right-sized change. The [scanner header](../../../scripts/scan-overbuild.mjs) states its
ceiling: line-shaped heuristics for JavaScript, TypeScript, and Python, not a parse.

## Design before implementation, by change size

Size the change first, then write the design that size requires. Write it before the first edit.

| Change size | Design | Where it lives |
| --- | --- | --- |
| One-line or local fix | One sentence: what changes, why, and what stays unchanged. | The commit message body or the run log. |
| Bounded change inside one module | The owning module, the ladder result, any interface change, the tests that prove it, and the blast radius. | The PR body or the run plan. |
| Feature or boundary change | Boundaries, data flow, interfaces, failure modes, and any dependency decision. | A design note in the hub's `10 Design/` folder, plus a decision record for each locked choice. |

A one-sentence design reads like this: "Return an empty result from `parseRange` on an empty
diff, because the scanner crashed on it. The output format stays unchanged."

Follow these steps:

1. Size the change. When unsure between two sizes, pick the larger.
2. Climb the ladder. Its answer is part of the design, and it can remove the change entirely.
3. Write the design at that size.
4. For a feature or boundary change, confirm the design at a checkpoint before you build.
5. Implement to the design. When the code proves the design wrong, revise the design first.

## What this standard does not adopt

Reject these deliberately, and do not let a reviewer reintroduce them.

- **A per-language style guide.** The language's official guide and the repository's configured tools own style. A copy here would drift from both.
- **Line-count or function-length quotas.** Size is the last objective, and the repository's own size norm is the evidence (§11).
- **Doc comments on every symbol.** Document a public contract where the language convention expects one. Everything else follows rule 7.

## Where it applies

The standard binds every code change a skill, an operative, or the lead makes. It applies in this
repository and in every target repository. Tests, scripts, hooks, and configuration are code.
Generated and vendored files follow their generator or their canonical source, not this page.

## Related

- [The house writing standard](writing-standard.md): the prose rules for comments, commit messages, and PR bodies.
- [Applying the quality lenses](applying-quality-lenses.md): which lenses apply to a stack and how to weight them.
- [code-ops-suite `CONVENTIONS.md`](../../../plugins/code-ops-suite/CONVENTIONS.md): §10 quality lenses and §11 the implementation loop and the code-economy ladder.
- [The `normalize` skill](../../../plugins/code-ops-suite/skills/normalize/SKILL.md): the tell list for hasty or generated code.
