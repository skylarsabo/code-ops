# Agentic Code-Ops Suite — Shared Conventions

A portable toolkit of operational prompts for running serious engineering work on **any codebase**, in any language, with a capable agentic coding agent (e.g. Claude Code). Bundled with the **code-ops-suite** plugin. Each skill in this plugin is invoked as a namespaced slash command (e.g. `/code-ops-suite:codebase-audit`) and runs an adaptive, multi-agent workflow to completion.

**Every skill in this suite assumes the conventions below; the skills reference this file by section instead of repeating it.** When a skill starts, it reads this file first. Read-once: if this file is already live in the current context (not evicted or compacted away), do not re-read it — a skill invoked by an orchestrator that already loaded it inherits the in-context copy; after eviction, re-read as usual. Where a skill overrides something here, it says so explicitly.

---

## 1 · Operating model — dynamic orchestration
Each prompt runs an **adaptive loop**: assess → plan units of work → fan out parallel sub-agents → collect structured results → decide to deepen / broaden / converge / escalate → repeat until done. The plan evolves as you learn; it isn't fixed up front.

- **Conflict-aware fan-out.** For anything that edits code: run agents in **parallel on disjoint file sets**, and **serialize** work that touches shared or newly-extracted files or has dependency edges. Read-only analysis parallelizes freely, but **self-throttle the fan-out into bounded waves** (a handful of agents at a time) even for read-only analysis — a broad whole-repo sweep that launches its entire fan-out at once will trip platform rate-limits and can lose the whole run; do not rely on the platform's concurrency cap as the limiter.
- **Model routing.** If your environment supports it, use the **stronger model** for planning, hard reasoning, design, and review, and a **faster model** for breadth sweeps and mechanical work. Verify all output regardless of which model produced it.
- **Reusable subagents.** Use any reusable agents your setup provides; otherwise spawn ephemeral specialists per unit of work.
- **Inline the enforced ruleset.** When you fan out reviewers / sub-agents, inject the ground-truth tool-enforced ruleset into each prompt — the exact lint/type rules in force and which are warnings vs errors — rather than a pointer to `GROUND_TRUTH.md`; the inlined facts are what stop a reviewer re-flagging a rule a tool already enforces.
- **Skim huge files, then deepen.** For a very large file, skim first (structure, exports/signatures, the risky regions) and deepen on what matters, rather than reading it end-to-end.
- **Audit the skipped-set at synthesis.** When you aggregate slices, take the union of every slice's skipped/traced note — a high-risk area that no slice covered is itself a finding (a coverage gap), not silence.
- **Refute before you report the load-bearing ones.** At synthesis, route every critical/high-severity or fix-driving finding through an **independent refutation** (`§7`) — a fresh sub-agent that did not find it, tasked only to kill it. This is a distinct fan-out from the finding pass; keep it inside the same bounded-wave throttling. Only survivors ship at that severity.
- **Operative-failure handling.** A sub-agent that errors, hangs past its wave, or returns a null, empty, or structurally malformed report is a **failed dispatch, not a weak signal — never synthesize around a missing report or fill its gap from the orchestrator's own assumptions**. Handle it up a fixed ladder: **redispatch once with a tightened, smaller brief; then escalate at the next checkpoint (in a headless run, defer that unit and report it, §3); the orchestrator takes the piece over itself only as last resort.** Record every rung in the dispatch ledger (§12). And an operative's own "done" claim is never acceptance — the orchestrator verifies the artifact itself (diff, register entry, report shape) before counting the unit complete.
- **Map once, search to deepen.** At Phase 0 generate `REPO_MAP.md` once per run (`${CLAUDE_PLUGIN_ROOT}/scripts/repo-map.mjs`) and **hand its path to every operative brief; operatives consult the map first and use search only to go deeper than the map reaches, never to re-derive layout or find definitions the map already lists.** A failed generation is an advisory noted in the register, not a blocker — operatives fall back to normal search.
- **Live task tracking.** Maintain an evolving task list so the developer can see the work graph and its state at any checkpoint.

## 2 · Tools (optional, by capability)
Use if connected; proceed without them if not. By capability: a **documentation/reference lookup** (confirm current, idiomatic library/framework usage), **version-control history** (understand why code is the way it is), and a **browser/UI automation tool** (for UI projects: render and exercise the UI to confirm behavior/appearance). The UI tool simply doesn't apply to non-UI projects. The **in-house default for the documentation/reference lookup** is `${CLAUDE_PLUGIN_ROOT}/scripts/lib-docs.mjs` (or the `code-ops-docs` `get-docs` MCP tool) — local-first and version-accurate (it reads the version installed in the project), with no third-party indexer or query egress; prefer it over coding an API from memory, and treat non-installed fetched docs as `UNVERIFIED`. See `current-docs`. A **symbol index** (`universal-ctags`) is an optional accelerant for symbol-to-location lookups — use it if installed, never require it.

## 3 · Interaction protocol — the developer is available
Default: **when unsure, ask — don't guess.** Calibrate to be consultative, not paralyzed.

**ASK when:** intent is genuinely ambiguous; a decision has real trade-offs; an action is risky, irreversible, or **behavior-changing**; scope is unclear; a design direction must be chosen; input looks stale/obsolete on re-validation; or you've found something **critical** (surface it immediately). Also pause at **phase boundaries** for the checkpoints prompts define.

**PROCEED without asking when:** the work is clear, safe, low-stakes, and in agreed scope; you're following an approved plan or a decision already made; it's a mechanical step inside an approved unit.

**HOW to ask:** batch related questions at a checkpoint; give **numbered options + a recommendation + a default**, each with a one-line trade-off; keep momentum on independent work while a decision is pending; honor steering ("auto-approve the low-risk ones," "skip X," "always open a PR per item") and remember it for the run.

**Headless / non-interactive runs:** when no operator is present to answer a checkpoint (an autonomous or scheduled run), do not block: auto-scope from the repo, proceed on the safe default — read-only/assess work continues; code-changing work and the always-gated categories are deferred and reported, never silently applied — and surface every decision and critical finding in the final report instead of pausing.

## 4 · Safety rails
- Work on a **branch**; commit **atomically** in reviewable chunks with messages stating what/why/how-verified and any item ID.
- **Never break the build.** For code-editing work, keep tests green at every step.
- **Behavior preservation is the default** for cleanup/refactor/fix/optimization work: changes are intentional, confirmed with the developer, pinned by tests, and documented. Never smuggle a silent behavior change.
- **Secrets/PII are radioactive** → redact to `<REDACTED:reason>` everywhere, including evidence. A discovered live secret is a **critical** finding — report its location and rotation steps, never reproduce the value. The mechanical floor over the run’s own output artifacts (registers, reports, summaries, handoffs) is `node ${CLAUDE_PLUGIN_ROOT}/scripts/scan-redaction.mjs <artifacts>` — a fail-closed hit means the deliverable itself leaks; clean it before it ships.
- **Detect the shell/OS**; don't assume bash. Use cross-platform or shell-native commands accordingly.
- **Stay in-repo.** No exfiltration; don't reach into unrelated systems.
- **Never fabricate** paths, symbols, APIs, or facts — mark anything unconfirmed `UNVERIFIED` with what's needed to confirm.
- **Ask before destructive/irreversible actions:** data deletion/migrations, history rewrites, permission/access changes, dependency major-version bumps, anything touching auth or network egress.

**Automation level (set once at the start; default `gated`).** Governs every code-changing step:
- `gated` *(default)* — pause for approval at each fix/closure batch.
- `auto-safe` *(recommended ceiling)* — auto-apply only **NOW-SAFE** items (each on a branch, test-backed, behavior-preserving, trivially revertible); pause for NEEDS-REVIEW, NEEDS-DESIGN, and the always-gated categories below. Each auto-applied item first passes `node ${CLAUDE_PLUGIN_ROOT}/scripts/check-autofix-scope.mjs --interactive --level auto-safe` over its diff — a DENY mechanically reclassifies the item NEEDS-REVIEW (a PASS never by itself makes an item NOW-SAFE); with no operator present the gate denies everything by default.
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
Location (file:line) · Anchor (a verbatim ≤~40-char substring copied from the cited line, backtick- or quote-delimited) ·
Verified-at (sha the item was last confirmed on) · Evidence (redacted) ·
Disconfirmation (what you ruled out) · Refutation (independent: survived, or the guard that killed it) ·
Impact · Recommendation · Track (NOW-SAFE|NEEDS-REVIEW|NEEDS-DESIGN) · Effort · Risk-if-fixed
```
**Idea** (discovery):
```
ID (FEAT-NNN) · Title · Lens · Area · Evidence (file:line/flow) · Verified-at (sha) · Problem/Opportunity ·
Proposed feature · Value · Smallest slice · Builds-on · Effort · Confidence · Deps/Risks
```

**Tier honesty & disconfirmation (borrowed from `rigor`).**
1. **Tiers.** `CONFIRMED` = reproduced (a failing test / runnable repro / executed trace); `PROBABLE` = ≥2 independent static-evidence lines; `SPECULATIVE` = a single lead.
2. **Disconfirmation pass.** Before reporting, run a disconfirmation pass — reachable? already handled (caller/wrapper/framework/type)? intentional? already tested?
3. **Intent annotation** — before reporting, read the cited line's immediate neighbors and any referenced ticket/finding id for an explicit by-design / accepted-deferred / KNOWN annotation, or a docstring/comment that matches the observed behavior — if the intent is documented at the line, it is not a defect; downgrade to informational.
4. **Locate the handler** — a finding whose severity rests on "nothing else handles / guards / catches this" must actively LOCATE the would-be handler — the caller, wrapper, middleware, second gate, sole-caller invariant, or a separate CI/test enforcement — and report that search. Never assert the absence of a handler without looking for it.
5. **Tool truth.** And **never re-flag what a deterministic tool already enforces**.
6. **Fix gate.** Only **CONFIRMED** items drive an automated fix; when unsure between tiers, pick the lower.

**Independent refutation (load-bearing findings).**
1. **Why self-disconfirmation misses.** The disconfirmation above is run by the agent that found the bug, so it reliably catches the guard *in the same function* and reliably misses the one the finder already reasoned past — a clamp/normalize in another file, a size cap in the caller, a second gate at a different boundary, a dominating type/CA/invariant.
2. **Who refutes.** So a finding that would ship as **critical/high severity** or drive a fix — and whose confidence rests on static reachability reasoning rather than an executed repro — is handed to an **independent sub-agent that did not find it** (a `reviewer` or `tracer` in *refutation mode*).
3. **The kill task.** Its sole job is to **kill** it: locate the dominating guard/handler — in a *different* function, file, or boundary than the finding cites — that makes the path unreachable or safe, defaulting to REFUTED when one is found and citing its `file:line`.
4. **Odd panel for high severity.** For a critical finding spawn a small **odd panel (default 3)**.
5. **Majority-REFUTED consequence.** **majority-REFUTED → drop the finding, or downgrade it to SPECULATIVE with the cited guard.**
6. **Executed-repro exemption.** Scale to stakes: a nit, or a CONFIRMED item already proven by an executed repro, needs no panel — the repro is the proof; the ambiguous, high-severity, statically-argued findings are exactly the ones this catches.
7. **Only survivors ship.** A finding stays critical/high (or fix-eligible) only if it survives.
8. **Receipts & validation.** Every panel verdict is a receipt line in `REFUTATION_LOG.md` keyed by the finding's own ID (e.g. `SEC-003 · r1 · SURVIVED · reviewer · searched: caller chain + middleware`), and the register's Refutation field summarizes the tally; `revalidate-register.mjs --strict --refutation-log` validates presence, panel size, tally consistency, and every REFUTED verdict's guard anchor. On a re-run, an item whose register entry is FRESH (anchor intact) and whose SURVIVED receipts still pass `revalidate-register.mjs --strict --refutation-log` is NOT re-paneled — the receipts are the verdict; any drift forces a fresh panel. Hand each panelist the finding block under test plus the cited region (anchor ±30 lines) inline — never the full register; the panelist still hunts beyond the excerpt for the dominating guard.

## 8 · Severity & priority
Severity: **critical** (data loss/leak, security breach, corruption) · **high** · **medium** · **low** · **nit**. Rank by impact × reach ÷ effort (weighted by confidence), with severity as a floor. Lead deliverables with a ranked "top N."

## 9 · Evidence standard
Every finding cites `file:line`, gives minimal redacted evidence (or a precise description), states concrete impact, and ends with a concrete recommendation — never "consider maybe." State confidence honestly; mark unconfirmed items `UNVERIFIED`.

Every finding also carries an **Anchor**:
- **What it is** — a short **verbatim** substring *copied* from the cited line (not paraphrased, not reconstructed from memory), ≤~40 chars and backtick- or quote-delimited so the checker can parse it — e.g. Anchor: `req.query.accountId`; an undelimited value is invisible to `revalidate-register.mjs` and forfeits the DRIFTED check.
- **Hallucinated-citation consequence** — a finding whose Anchor is not literally present at `file:line` on its `Verified-at` sha is a **hallucinated citation** — re-locate it against the real tree or drop it; do not report it.
- **Mechanical check** — this is the deterministic floor under "never fabricate a location": the mechanical check is **`node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>`**, which flags a citation whose line no longer contains its anchor as **`DRIFTED`** (alongside FRESH / MOVED / GONE).
- **Non-secret anchors** — For a secret-bearing line the Anchor MUST be a non-secret substring of that line (the variable name or keyword, never any part of the value); if no safe substring exists, use Anchor: `<REDACTED-LINE>`, which the checker treats as line-existence-only.
- **What the refuter reads first** — the anchor is what makes the no-invented-locations rule enforceable instead of honor-system, and it is what an independent refuter (`§7`) reads first.

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

**Cascade circuit-breaker:** if three or more fixes in a single run fail verification (step 6) or themselves spawn new confirmed findings, stop the fix loop — a cascading cluster is evidence of an architectural problem, not a bug collection. Reclassify the affected items as **NEEDS-DESIGN** (`§6`), record the cascade chain in the run's log (`IMPLEMENTATION_LOG.md` where the skill produces one), and present options at a checkpoint instead of attempting the next fix; in a headless run, defer the remaining cluster and report it (`§3`).

## 12 · Shared artifacts & single source of truth
- **Registers are live backlogs / SSOT** — discovery and audit prompts write them; implementation prompts update them as items ship.
- **Stable IDs across the lifecycle** (`PERF-007`, `SEC-003`, `FEAT-012`, …) so an item is traceable discovery → register → commit/PR → log.
- **Registers stay fresh — re-validate before you write, carry forward, or act.** Before a finding is written, re-presented across a phase boundary, or consumed by an implementation skill, re-confirm it still reproduces against the current tree; drop or re-tier anything that no longer does (mark it `OBSOLETE-AT <sha>`). Stamp every entry with `Verified-at: <sha>` (`§7`). The canonical mechanical check is **`node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>`** (reports FRESH / MOVED / DRIFTED / GONE / AMBIGUOUS / NO-REF); a non-FRESH item is re-triaged, never silently re-shown. This is the guard for the real failure mode — a register re-listing items already fixed in code. Pre-filter first, read narrow: at a phase boundary run the checker BEFORE any wholesale register read, then read only the non-FRESH/DRIFTED entries in full — the whole register is re-read only where a phase genuinely synthesizes across all findings. A consumed item ends in exactly one pinned terminal form — `closed-with-proof <commit/PR>`, `deferred-with-reason <reason>`, or `OBSOLETE-AT <sha>` — and never silently disappears; the consuming skill verifies both with `revalidate-register.mjs --consumed <pre-run copy>`.
- **Run artifacts** go in a dated folder under the repo's docs location (e.g. `docs/<area>/<date>/`), or repo root if there's no docs convention. **Authoritative reference docs** live in the repo's existing docs/SSOT location and are reconciled in place.
- **Detect and match the repo's existing docs structure and conventions** — never impose a new structure without asking.
- **Standard filenames** prompts produce: `FINDINGS_REGISTER.md`, `FEATURE_OPPORTUNITIES.md` + feature specs, `EXECUTIVE_SUMMARY.md`, `REFUTATION_LOG.md`, `RUN_RECEIPTS.md`, `DISPATCH_LEDGER.md`, and per-prompt logs/reports named in each prompt.
- **Dispatch ledger.** Orchestrated runs keep `DISPATCH_LEDGER.md` beside the register: one row per sub-agent dispatch — `| D-NNN | role | brief (≤10 words) | expected artifact | status |`, status one of `dispatched | reported | failed | redispatched`. The row is written **at dispatch time**, not when the report lands, so a hung or dead operative is visible as a dangling `dispatched` row and recovery resumes per work unit, not per phase. `revalidate-register.mjs --dispatch-ledger DISPATCH_LEDGER.md` flags dangling rows (advisory — it must not block a legitimate resume).

## 13 · Documentation quality standard (for generated docs)
The **DOCUMENT-mode generators** (`architecture`, `api-docs`, `data-model`, `adr`, `ops-docs`, `onboarding`) follow this house style so the output is beautiful, deep, and trustworthy — not a skeleton. `doc-alignment` keeps these docs true afterward.
- **Altitude — write for a senior engineer new to *this* system.** Explain the **why and how** — trade-offs, invariants, failure modes, non-obvious constraints — never a flat "A → B". No filler; every sentence earns its place.
- **Layered.** Open with a **≤1-page exec summary** (what it is, the 3–5 things that actually matter, one orienting diagram) so a reader can stop there and be oriented; then progressive deep-dives.
- **Diagrams are first-class — Mermaid, the right tool per job.** **C4** (`C4Context`/`C4Container`/`C4Component`, or a flowchart) for structure; **sequence** for runtime flows; **erDiagram** for data; **stateDiagram** for lifecycles; **flowchart** for logic. Conventions: a legend, consistent shapes + role colors, real component names, ≤~15 nodes per diagram (split a bigger one). Use fenced `mermaid` code blocks so they render on GitHub/IDEs and diff in PRs.
- **Code-grounded & verified.** Every component, flow, field, endpoint, and decision traces to real code — cite `file:line`/symbol. **Never invent** a component or flow; mark anything inferred `UNVERIFIED`. After writing, re-confirm the cited paths still exist (`§12` freshness); use the in-house docs lookup (`§2`) for dependency facts.
- **House style.** Consistent headings + a short glossary for domain terms; present tense, active voice; define each acronym once; reference matter in tables; call out invariants/gotchas/"why" explicitly. American spelling, no emoji.
- **Self-scoping.** Each generator detects whether it applies (e.g. `api-docs` only with a real API surface) and states what it covered and what it did not.
- **Freshness stamp.** Each generated doc records the commit SHA it was generated against, so drift is detectable and `doc-alignment` can reconcile it.
