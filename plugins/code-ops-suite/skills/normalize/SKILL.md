---
description: "Use when a codebase has inconsistent style or the artifacts of hasty/generated code and you want one professional, behavior-preserving standard with an enforced linter/formatter config. To close divergent implementations of a concept, see rigor:consistency-closure."
disable-model-invocation: true
---

# CODE NORMALIZATION — One Consistent, Professional, Hand-Crafted Codebase

**Invoked as `/code-ops-suite:normalize`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** IMPLEMENT (behavior-preserving) · **Produces:** the normalized codebase, `STYLE_GUIDE.md`, an enforced linter/formatter config, `NORMALIZATION_LOG.md`; behavior-changing issues → a separate list.

Bring the project to a state where it reads as the consistent work of **one experienced team** and holds up under close, line-by-line review: one coherent style everywhere, recurring operations done the same way across every file, dead code gone, complex shared logic extracted into clean modules, and none of the artifacts that mark hastily-written or generated code. The reason clean code survives scrutiny is that it genuinely *is* clean — optimize for that substance. **Behavior preservation is absolute** (`CONVENTIONS §4, §11`): tests green at every step; where coverage is thin, write characterization tests first.

**Consistency over preference:** establish ONE house standard and apply it everywhere — derive it from the codebase's dominant sound patterns; only where the repo disagrees with itself do you pick a canonical form. **Don't weaken safety-critical paths** (security/auth/crypto/privacy) in the name of cleanup.

## Phase 0 — Establish the standard & baseline  *(required checkpoint)*
Detect tooling (Prettier/ESLint, Black/Ruff, gofmt, rustfmt, clang-format, etc.) and honor/extend it. **Derive the house style** from dominant patterns: naming, file/module organization, import ordering, error-handling, logging, validation, public API/response shapes, async/concurrency, type usage, comment philosophy, tests. Inventory the **tells** (below), the **inconsistencies**, and the **modularization opportunities**. Baseline tests/build/lint/coverage.
> **CHECKPOINT — ratify with me:** the proposed house style (I must bless the canonical conventions), the catalog of tells/inconsistencies, and the modularization plan. Capture the agreed standard in **`STYLE_GUIDE.md`** as the single source of truth for the pass.

## The "tells" checklist — hunt and remove these
- **Narration comments** restating code (`// increment counter` over `counter++`). Keep only the non-obvious *why*.
- **Tutorial/explanatory voice** ("Now we…", "Here we handle…", "Let's…", "As you can see…").
- **Placeholder/disclaimer comments** ("TODO: implement", "In a real implementation…", "simplified version", "for production, consider…").
- **Emoji** anywhere — comments, logs, identifiers, docs, commit messages.
- **Inflated prose** — "robust/comprehensive/seamless/powerful", "leverage"/"utilize" (→ use), "simply"/"just", "it's worth noting", "in order to" (→ to).
- **Debug residue** — stray `console.log`/`print`/`println!`/`dbg!` with descriptive strings.
- **Generic/placeholder names** — `data`, `result`, `temp`, `item`, `handleData`, `doStuff`, `utils`/`helpers` junk drawers.
- **Over-defensive ceremony** — impossible-case null checks, try/catch-everything with generic re-throws.
- **Over-engineered indirection** — factories/managers/wrappers/single-impl interfaces adding layers without value.
- **Section-divider mega-functions** chopped by `// --- Validation ---` banners (extract them).
- **Commented-out code & "example usage" blocks** (delete; history holds the past).
- **Inconsistent terminology** — same concept called different names across files.

## Phase 1 — Normalize (fan out, conflict-aware)
- **A. Style/formatting uniformity** via the single config (quoting, terminators, indentation, trailing commas, line length, import ordering, layout).
- **B. Naming standardization** (consistent casing per kind; meaningful names; one canonical term per concept).
- **C. Comment & doc hygiene** (strip the tells; keep terse *why*-comments; standardize doc-comment usage to one rule).
- **D. Dead code & cruft removal** (unused imports/vars/functions/exports/files, unreachable code; **verify before deleting** anything possibly used dynamically/via config/reflection/build — else ask).
- **E. Standardize recurring operations** (one canonical pattern for: error handling, logging [no stray prints/emoji/sensitive data], validation, API shapes, data access, config access, async/concurrency, types, module exports, constants).
- **F. Modularization** — extract duplicated complex logic into one well-named shared module; break up oversized functions/files; clean boundaries; right-size (don't abstract trivial one-offs) — **structural extractions confirmed first**.
- **G. Method clarity** (single responsibility, early returns over deep nesting, no obscuring cleverness).
- **H. README/docs** rewritten to concise professional voice.
- **I. VCS history** — emoji/AI-voiced commit messages are a tell; adopt a convention going forward; rewriting existing history is destructive → developer's decision, not unilateral.

Run each change through the implementation loop (`§11`), committing in **reviewable logical chunks** (a giant reformat-everything commit is its own red flag).

## Deliverables
The normalized codebase (behavior-preserving, tests green); **`STYLE_GUIDE.md`** (the ratified standard, SSOT for future code); **updated linter/formatter config + a recommended pre-commit/CI gate** so consistency is machine-enforced; **`NORMALIZATION_LOG.md`** (what was standardized, tells removed, dead code deleted, modules extracted); professionalized README/docs; a **separate list of behavior-changing issues** found (not fixed here).

## Done when
One consistent style applied repo-wide and recurring operations standardized (nothing sticks out between files); every tell cleared; dead code gone, shared complexity extracted, oversized functions/files broken up; **behavior unchanged (tests green) and no safety-critical path weakened**; the standard documented and enforced by config/hooks. Then a **final hostile-reviewer pass** — read as a skeptical engineer hunting for anything that betrays inconsistency or careless generation, and fix what stands out. Present `NORMALIZATION_LOG.md` and `STYLE_GUIDE.md`, noting items (history rewrite, behavior-changing finds) awaiting a decision.
