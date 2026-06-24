# Agentic Code-Ops Suite — Shared Conventions

A portable toolkit of operational prompts for running serious engineering work on **any codebase**, in any language, with a capable agentic coding agent (e.g. Claude Code / Opus 4.8). Bundled with the **code-ops-suite** plugin. Each skill in this plugin is invoked as a namespaced slash command (e.g. `/code-ops-suite:codebase-audit`) and runs an adaptive, multi-agent workflow to completion.

**Every skill in this suite assumes the conventions below; the skills reference this file by section instead of repeating it.** When a skill starts, it reads this file first. Where a skill overrides something here, it says so explicitly.

---

## 1 · Operating model — dynamic orchestration
Each prompt runs an **adaptive loop**: assess → plan units of work → fan out parallel sub-agents → collect structured results → decide to deepen / broaden / converge / escalate → repeat until done. The plan evolves as you learn; it isn't fixed up front.

- **Conflict-aware fan-out.** For anything that edits code: run agents in **parallel on disjoint file sets**, and **serialize** work that touches shared or newly-extracted files or has dependency edges. Read-only analysis parallelizes freely, but **self-throttle the fan-out into bounded waves** (a handful of agents at a time) even for read-only analysis — a broad whole-repo sweep that launches its entire fan-out at once will trip platform rate-limits and can lose the whole run; do not rely on the platform's concurrency cap as the limiter.
- **Model routing.** If your environment supports it, use the **stronger model** for planning, hard reasoning, design, and review, and a **faster model** for breadth sweeps and mechanical work. Verify all output regardless of which model produced it.
- **Reusable subagents.** Use any reusable agents your setup provides; otherwise spawn ephemeral specialists per unit of work.
- **Live task tracking.** Maintain an evolving task list so the developer can see the work graph and its state at any checkpoint.

## 2 · Tools (optional, by capability)
Use if connected; proceed without them if not. By capability: a **documentation/reference lookup** (confirm current, idiomatic library/framework usage), **version-control history** (understand why code is the way it is), and a **browser/UI automation tool** (for UI projects: render and exercise the UI to confirm behavior/appearance). The UI tool simply doesn't apply to non-UI projects. The **in-house default for the documentation/reference lookup** is `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (or the `code-ops-docs` `get-docs` MCP tool) — local-first and version-accurate (it reads the version installed in the project), with no third-party indexer or query egress; prefer it over coding an API from memory, and treat non-installed fetched docs as `UNVERIFIED`. See `current-docs`.

## 3 · Interaction protocol — the developer is available
Default: **when unsure, ask — don't guess.** Calibrate to be consultative, not paralyzed.

**ASK when:** intent is genuinely ambiguous; a decision has real trade-offs; an action is risky, irreversible, or **behavior-changing**; scope is unclear; a design direction must be chosen; input looks stale/obsolete on re-validation; or you've found something **critical** (surface it immediately). Also pause at **phase boundaries** for the checkpoints prompts define.

**PROCEED without asking when:** the work is clear, safe, low-stakes, and in agreed scope; you're following an approved plan or a decision already made; it's a mechanical step inside an approved unit.

**HOW to ask:** batch related questions at a checkpoint; give **numbered options + a recommendation + a default**, each with a one-line trade-off; keep momentum on independent work while a decision is pending; honor steering ("auto-approve the low-risk ones," "skip X," "always open a PR per item") and remember it for the run.

## 4 · Safety rails
- Work on a **branch**; commit **atomically** in reviewable chunks with messages stating what/why/how-verified and any item ID.
- **Never break the build.** For code-editing work, keep tests green at every step.
- **Behavior preservation is the default** for cleanup/refactor/fix/optimization work: changes are intentional, confirmed with the developer, pinned by tests, and documented. Never smuggle a silent behavior change.
- **Secrets/PII are radioactive** → redact to `<REDACTED:reason>` everywhere, including evidence. A discovered live secret is a **critical** finding — report its location and rotation steps, never reproduce the value.
- **Detect the shell/OS**; don't assume bash. Use cross-platform or shell-native commands accordingly.
- **Stay in-repo.** No exfiltration; don't reach into unrelated systems.
- **Never fabricate** paths, symbols, APIs, or facts — mark anything unconfirmed `UNVERIFIED` with what's needed to confirm.
- **Ask before destructive/irreversible actions:** data deletion/migrations, history rewrites, permission/access changes, dependency major-version bumps, anything touching auth or network egress.

**Automation level (set once at the start; default `gated`).** Governs every code-changing step:
- `gated` *(default)* — pause for approval at each fix/closure batch.
- `auto-safe` *(recommended ceiling)* — auto-apply only **NOW-SAFE** items (each on a branch, test-backed, behavior-preserving, trivially revertible); pause for NEEDS-REVIEW, NEEDS-DESIGN, and the always-gated categories below.
- `auto-all` — *not recommended.*
- **Always gated, regardless of level:** security/auth changes, secret handling, data migrations or destructive/irreversible operations, and public API/contract changes. **Never auto-merge** — even auto-applied fixes land as commits/PRs for review.

## 5 · Modes
Each prompt declares its mode:
- **AUDIT** — read-only + document; may apply only NOW-SAFE fixes, and only with confirmation if the prompt says so.
- **DISCOVERY** — read-only; produces a backlog/specs.
- **IMPLEMENT** — ships code via the implementation loop (§11).
- **REVIEW** — produces a review; makes no changes unless asked.
- **DOCUMENT** — edits documentation only; never changes code (log any code issue as a finding instead).

## 6 · Finding / fix tracks
Classify every actionable item:
- **NOW-SAFE** — self-contained, local, small, **behavior-preserving** (or existing behavior is unambiguously a bug with an obvious fix), no contract/API/schema change, test-covered or quickly testable, trivially revertible → safe to apply (per the prompt's mode).
- **NEEDS-REVIEW** — real and probably worth doing, but behavior-changing, contract/API/schema-touching, non-trivial, or risky → document with a concrete recommendation and bring to the developer; don't apply unilaterally.
- **NEEDS-DESIGN** — architectural or cross-cutting → document as a proposal with options and trade-offs and a recommendation.

## 7 · Schemas
**Finding** (audit / review / security):
```
ID · Title · Lens · Scope · Severity · Confidence · Tier (CONFIRMED|PROBABLE|SPECULATIVE) ·
Location (file:line) · Verified-at (sha the item was last confirmed on) · Evidence (redacted) ·
Disconfirmation (what you ruled out) · Impact · Recommendation ·
Track (NOW-SAFE|NEEDS-REVIEW|NEEDS-DESIGN) · Effort · Risk-if-fixed
```
**Idea** (discovery):
```
ID (FEAT-NNN) · Title · Lens · Area · Evidence (file:line/flow) · Verified-at (sha) · Problem/Opportunity ·
Proposed feature · Value · Smallest slice · Builds-on · Effort · Confidence · Deps/Risks
```

**Tier honesty & disconfirmation (borrowed from `rigor`).** `CONFIRMED` = reproduced (a failing test / runnable repro / executed trace); `PROBABLE` = ≥2 independent static-evidence lines; `SPECULATIVE` = a single lead. Before reporting, run a disconfirmation pass — reachable? already handled (caller/wrapper/framework/type)? intentional? already tested? **Intent annotation:** before reporting, read the cited line's immediate neighbors and any referenced ticket/finding id for an explicit by-design / accepted-deferred / KNOWN annotation, or a docstring/comment that matches the observed behavior — if the intent is documented at the line, it is not a defect; downgrade to informational. **Locate-the-handler:** a finding whose severity rests on "nothing else handles / guards / catches this" must actively LOCATE the would-be handler — the caller, wrapper, middleware, second gate, sole-caller invariant, or a separate CI/test enforcement — and report that search; never assert the absence of a handler without looking for it. And **never re-flag what a deterministic tool already enforces**. Only **CONFIRMED** items drive an automated fix; when unsure between tiers, pick the lower.

## 8 · Severity & priority
Severity: **critical** (data loss/leak, security breach, corruption) · **high** · **medium** · **low** · **nit**. Rank by impact × reach ÷ effort (weighted by confidence), with severity as a floor. Lead deliverables with a ranked "top N."

## 9 · Evidence standard
Every finding cites `file:line`, gives minimal redacted evidence (or a precise description), states concrete impact, and ends with a concrete recommendation — never "consider maybe." State confidence honestly; mark unconfirmed items `UNVERIFIED`.

## 10 · Quality lenses (shared definitions)
Prompts reference these by name. Apply the ones relevant to the task and the project.
- **Modularity & architecture** — coupling/cohesion, dependency direction, leaky abstractions, circular deps, duplication, dead code, unclear boundaries, config sprawl.
- **Performance** — algorithmic complexity, N+1/over-fetching, blocking-on-async, missing/incorrect caching, allocations & leaks; for UIs: bundle size, render thrash, asset weight.
- **Efficiency / resource use** — redundant work, chatty I/O, hot-path logging, unpooled/unclosed resources, slow/redundant CI.
- **Correctness & intricate bugs** — races/TOCTOU, off-by-one/overflow/rounding, timezone/locale, null/coercion traps, swallowed errors, missing rollback/cleanup, non-idempotent retries, illegal states, contract/serialization mismatches.
- **Security** — injection (SQL/NoSQL/command/template), XSS/SSRF/CSRF, IDOR, authn/authz, session/cookies, crypto, secrets handling, input validation/output encoding, security headers, rate limiting. **Control coverage (multi-boundary):** for any control/gate/invariant (authz, feature flag, validation, rate limit, redaction), enumerate **every** entry point and runtime that can reach the protected action and verify the control at each — *verified at one boundary but not enumerated is a finding, not a pass.*
- **Privacy & data handling** *(scaled to how much personal/sensitive data the system handles)* — data minimization, PII in logs/telemetry/errors, third-party data egress, identifiers/correlation/fingerprinting surface, metadata leakage, retention/deletion, anonymization quality, private-by-default posture.
- **UI/UX, styling & accessibility** *(if the project has a UI)* — design tokens vs. hardcoded values, theme parity, component reuse, state coverage (loading/empty/error/success), responsiveness, a11y (contrast, focus, keyboard, ARIA, reduced-motion), consistent copy.
- **Testing & reliability** — coverage on critical/risky paths, flaky or assertion-free tests, missing edge/error tests, observability gaps.
- **Documentation accuracy** — docs vs. code, stale/contradictory content, dead setup steps, diagrams vs. reality. **Claims-vs-enforcement** — a doc / comment / contract / JSDoc asserts X while the adjacent code / schema / migration / type enforces Y (a "pinned to match" comment that no longer matches, a stale doc contradicted by a migration, a dead error path the data layer can never raise). Cheap to hunt against the adjacent definition and high-yield.
- **Dependencies & supply chain** — outdated/deprecated/duplicate deps, known CVEs, license concerns, unused deps, risky floating versions.

## 11 · The implementation loop (shared, for IMPLEMENT-mode work)
For each unit of work:
1. **Re-validate / understand** — confirm the item still applies against current code; understand root cause / full intent.
2. **Plan** — approach, files, tests, blast radius, risk; keep it the smallest correct change.
3. **Confirm if unsure** — behavior/contract/data-handling changes, ambiguous scope, multiple viable approaches, design direction → ask (§3).
4. **Implement** — match existing conventions; uphold the relevant lenses (§10); don't trade one issue for a new one.
5. **Test** — add/adjust tests that fail before and pass after; cover edge/error paths.
6. **Verify** — build/lint/typecheck/tests green; for UI, render and exercise it.
7. **Self-review** against the lenses; fix before committing.
8. **Commit** atomically, referencing the item ID; open/update a PR per the developer's preference.
9. **Close the loop** — update the backlog status and update any documentation the change affects (don't create doc drift).

## 12 · Shared artifacts & single source of truth
- **Registers are live backlogs / SSOT** — discovery and audit prompts write them; implementation prompts update them as items ship.
- **Stable IDs across the lifecycle** (`PERF-007`, `SEC-003`, `FEAT-012`, …) so an item is traceable discovery → register → commit/PR → log.
- **Registers stay fresh — re-validate before you write, carry forward, or act.** Before a finding is written, re-presented across a phase boundary, or consumed by an implementation skill, re-confirm it still reproduces against the current tree; drop or re-tier anything that no longer does (mark it `OBSOLETE-AT <sha>`). Stamp every entry with `Verified-at: <sha>` (`§7`). The canonical mechanical check is **`node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>`** (reports FRESH / MOVED / GONE / NO-REF); a non-FRESH item is re-triaged, never silently re-shown. This is the guard for the real failure mode — a register re-listing items already fixed in code.
- **Run artifacts** go in a dated folder under the repo's docs location (e.g. `docs/<area>/<date>/`), or repo root if there's no docs convention. **Authoritative reference docs** live in the repo's existing docs/SSOT location and are reconciled in place.
- **Detect and match the repo's existing docs structure and conventions** — never impose a new structure without asking.
- **Standard filenames** prompts produce: `FINDINGS_REGISTER.md`, `FEATURE_OPPORTUNITIES.md` + feature specs, `EXECUTIVE_SUMMARY.md`, and per-prompt logs/reports named in each prompt.

## 13 · Documentation quality standard (for generated docs)
The **DOCUMENT-mode generators** (`architecture`, `api-docs`, `data-model`, `adr`, `ops-docs`, `onboarding`) follow this house style so the output is beautiful, deep, and trustworthy — not a skeleton. `doc-alignment` keeps these docs true afterward.
- **Altitude — write for a senior engineer new to *this* system.** Explain the **why and how** — trade-offs, invariants, failure modes, non-obvious constraints — never a flat "A → B". No filler; every sentence earns its place.
- **Layered.** Open with a **≤1-page exec summary** (what it is, the 3–5 things that actually matter, one orienting diagram) so a reader can stop there and be oriented; then progressive deep-dives.
- **Diagrams are first-class — Mermaid, the right tool per job.** **C4** (`C4Context`/`C4Container`/`C4Component`, or a flowchart) for structure; **sequence** for runtime flows; **erDiagram** for data; **stateDiagram** for lifecycles; **flowchart** for logic. Conventions: a legend, consistent shapes + role colors, real component names, ≤~15 nodes per diagram (split a bigger one). Use fenced `mermaid` code blocks so they render on GitHub/IDEs and diff in PRs.
- **Code-grounded & verified.** Every component, flow, field, endpoint, and decision traces to real code — cite `file:line`/symbol. **Never invent** a component or flow; mark anything inferred `UNVERIFIED`. After writing, re-confirm the cited paths still exist (`§12` freshness); use the in-house docs lookup (`§2`) for dependency facts.
- **House style.** Consistent headings + a short glossary for domain terms; present tense, active voice; define each acronym once; reference matter in tables; call out invariants/gotchas/"why" explicitly. American spelling, no emoji.
- **Self-scoping.** Each generator detects whether it applies (e.g. `api-docs` only with a real API surface) and states what it covered and what it did not.
- **Freshness stamp.** Each generated doc records the commit SHA it was generated against, so drift is detectable and `doc-alignment` can reconcile it.
