---
name: normalize
description: "Use when a codebase has inconsistent style or the artifacts of hasty or generated code, and you want one professional, behavior-preserving standard. To close divergent implementations of a concept, see rigor:consistency-closure."
---

# CODE NORMALIZATION: One Consistent, Professional, Hand-Crafted Codebase

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:normalize`.** First read the `<plugin-root>/CONVENTIONS.md`
bundled with this plugin. Search the plugin directory for it if needed. It defines the operating
model, interaction protocol, safety rails, schemas, and quality lenses this skill references by
section.
**Mode:** IMPLEMENT, behavior-preserving · **Produces:** the normalized codebase,
`STYLE_GUIDE.md`, an enforced linter and formatter config, and `NORMALIZATION_LOG.md`.
Behavior-changing issues go to a separate list.

Bring the project to a state where it reads as the consistent work of **one experienced team**
and holds up under close, line-by-line review. That means one coherent style everywhere,
recurring operations done the same way across every file, dead code gone, complex shared logic
extracted into clean modules, and none of the artifacts that mark hastily-written or generated
code. Clean code survives scrutiny because it genuinely is clean, so optimize for the substance.
**Behavior preservation is absolute** (`CONVENTIONS §4`, `§11`): tests stay green at every step,
and where coverage is thin, write characterization tests first.

**Consistency outranks preference.** Establish one house standard and apply it everywhere. Derive
it from the codebase's dominant sound patterns. Pick a canonical form only where the repo
disagrees with itself. **Do not weaken safety-critical paths** in security, auth, crypto, or
privacy in the name of cleanup.

## Phase 0: the standard and the baseline  *(required checkpoint)*

Detect the existing tooling (Prettier, ESLint, Black, Ruff, gofmt, rustfmt, clang-format, and the
like) and honor or extend it. **Derive the house style** from the dominant patterns in naming,
file and module organization, import ordering, error handling, logging, validation, public API
and response shapes, async and concurrency, type usage, comment philosophy, and tests. Inventory
the tells listed below, the inconsistencies, and the modularization opportunities. Capture the
baseline for tests, build, lint, and coverage.

> **CHECKPOINT, ratify with me:** the proposed house style, because I must bless the canonical conventions, plus the catalog of tells and inconsistencies and the modularization plan. Capture the agreed standard in **`STYLE_GUIDE.md`** as the single source of truth for the pass.

## The tells to hunt and remove

- **Narration comments** restating code, such as `// increment counter` over `counter++`. Keep only the non-obvious reason.
- **Tutorial or explanatory voice**, such as "Now we", "Here we handle", "Let's", and "As you can see".
- **Placeholder and disclaimer comments**, such as "TODO: implement", "In a real implementation", "simplified version", and "for production, consider".
- **Emoji** anywhere: comments, logs, identifiers, docs, and commit messages.
- **Inflated prose**, such as "robust", "comprehensive", "seamless", "powerful", "leverage" or "utilize" for "use", "simply", "just", "it's worth noting", and "in order to" for "to".
- **Debug residue**: stray `console.log`, `print`, `println!`, or `dbg!` calls with descriptive strings.
- **Generic and placeholder names**, such as `data`, `result`, `temp`, `item`, `handleData`, `doStuff`, and `utils` or `helpers` junk drawers.
- **Over-defensive ceremony**: impossible-case null checks, and catch-everything blocks with generic re-throws.
- **Over-engineered indirection**: factories, managers, wrappers, and single-implementation interfaces that add layers without value.
- **Section-divider mega-functions** chopped up by banner comments. Extract them instead.
- **Commented-out code and example-usage blocks.** Delete them, because the history holds the past.
- **Inconsistent terminology**: the same concept called different names across files.

## Phase 1: the normalization

Dispatch ephemeral implementation operatives per area, with conflict-aware fan-out
(`CONVENTIONS §1`). Cover these nine areas:
- **A. Style and formatting uniformity** through the single config: quoting, terminators, indentation, trailing commas, line length, import ordering, and layout.
- **B. Naming standardization**: consistent casing per kind, meaningful names, and one canonical term per concept.
- **C. Comment and doc hygiene**: strip the tells, keep terse reason-comments, and standardize doc-comment usage to one rule.
- **D. Dead code and cruft removal**: unused imports, variables, functions, exports, and files, plus unreachable code. **Verify before deleting** anything possibly used dynamically, through config, through reflection, or by the build. When in doubt, ask.
- **E. Standardization of recurring operations**: one canonical pattern for error handling, logging with no stray prints or emoji or sensitive data, validation, API shapes, data access, config access, async and concurrency, types, module exports, and constants.
- **F. Modularization**: extract duplicated complex logic into one well-named shared module, break up oversized functions and files, and clean the boundaries. Right-size it, and do not abstract trivial one-offs. Confirm structural extractions first. Extract only on the ladder's evidence (`§11`): a second caller, a unit that needs its own test, or a file past the repository's own size norm.
- **G. Method clarity**: single responsibility, early returns over deep nesting, and no obscuring cleverness.
- **H. README and docs** rewritten to a concise professional voice.
- **I. Version-control history**: emoji and AI-voiced commit messages are a tell, so adopt a convention going forward. Rewriting existing history is destructive, so it is the developer's decision and never unilateral.

Run each change through the implementation loop (`§11`), committing in **reviewable logical
chunks**. A single reformat-everything commit is its own red flag.

The mechanical floor under area F is
`node <plugin-root>/scripts/co.mjs scan overbuild --git <range>`, which reports the
over-build tells on the pass's own diff and blocks only on an unrecorded dependency. Record a
deliberate simplification with a `deferred(<ceiling>, <upgrade path>)` marker, and collect the
markers with `node <plugin-root>/scripts/co.mjs scan deferrals` so the register carries
them forward.

Keep tier honesty at the point of use. A reported issue you did not execute a repro for is
PROBABLE at most, never CONFIRMED (`§7`). When unsure between two tiers, pick the lower.

## Deliverables

- The normalized codebase, behavior-preserving, with tests green.
- **`STYLE_GUIDE.md`**: the ratified standard, the source of truth for future code.
- **An updated linter and formatter config**, plus a recommended pre-commit or CI gate, so consistency is machine-enforced.
- **`NORMALIZATION_LOG.md`**: what was standardized, which tells were removed, what dead code was deleted, and which modules were extracted.
- A professionalized README and docs.
- **A separate list of behavior-changing issues** found and not fixed here.

## Done when

- One consistent style is applied repo-wide and the recurring operations are standardized, so nothing sticks out between files.
- Every tell is cleared, dead code is gone, shared complexity is extracted, and oversized functions and files are broken up.
- **Behavior is unchanged with tests green, and no safety-critical path was weakened.**
- The standard is documented and enforced by config or hooks.
- A **final hostile-reviewer pass** read the result as a skeptical engineer hunting for anything that betrays inconsistency or careless generation, and fixed what stood out.
- `NORMALIZATION_LOG.md` and `STYLE_GUIDE.md` are presented, noting the items awaiting a decision, such as a history rewrite or a behavior-changing find.
