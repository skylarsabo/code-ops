# Changelog — code-ops-suite

All notable changes to this plugin are documented here. Versions track
`.claude-plugin/plugin.json` and the matching entry in the marketplace.

## 1.8.0
- **Runtime-script hardening (security + correctness).** `lib-docs` is now **local-only by default** (`noFetch=true`; opt in to the library-source fallback with `--fetch` / `noFetch:false`), rejects library names that could escape `node_modules` (CLI + MCP), and restricts the fetch fallback to https public hosts (no loopback/private). `revalidate-register` fixes an off-by-one EOF check, stops parsing standards tokens (RFC/CVE/ISO) and version/host strings as references, resolves bare-filename refs (new `AMBIGUOUS` status), and confines reference paths to the repo root. The `code-ops-docs` MCP wrapper validates its required `library` argument.
- **`scan-ai-tells.mjs` now bundled in code-ops-suite** so the `ship` / `pr-split` / `debug` traceless-PR gate has a mechanical floor even when `privacy-opsec-suite` is not installed.
- **Linter (`lint-plugins`) strengthened:** intra-plugin orchestrators validate against their own plugin, qualified `plugin:skill` references must resolve, single-word skill tokens are checked, and it now catches duplicate marketplace entries, unregistered plugin dirs, missing manifest fields, BOM-prefixed frontmatter, and unbundled script references — plus a new `check-no-deps` CI guard for the zero-dependency invariant and SHA-pinned CI actions.
- **Docs reconciled** (install blocks, eval inventory, §-citations).

## 1.7.1
- **Orchestrators refreshed for the 1.4–1.7 additions.** `full-sweep` and `everything` now wire today's capabilities through every phase: they **generate the reference docs** (`architecture` / `data-model` / `api-docs` / `ops-docs` / `adr`) in their document phase; reference the **automation-level ladder** (`§4`), **evidence tiers + disconfirmation** (`§7`), and the **multi-boundary control-coverage** lens (`§10`) in assess/prove; keep carried registers **fresh** (`§12` — re-validate before consuming, mark obsolete); verify library facts via the **in-house docs lookup** (`§2`); and ship results as a **traceless stacked PR** (`pr-split` → `authorship-hygiene`). The fixed `code-normalization` → `normalize` reference is retained. No change to the individual skills.

## 1.7.0
- **New documentation generators: `architecture`, `api-docs`, `data-model`, `adr`, `ops-docs`** (Mode: DOCUMENT) — produce deep, diagram-rich (Mermaid C4 / sequence / ER), code-grounded docs aimed at senior engineers, governed by a new `CONVENTIONS §13` documentation quality standard (layered exec-summary-first structure, diagrams as first-class, every claim cited + verified, freshness-stamped). They **generate** docs; `doc-alignment` maintains them; `onboarding` stays the newcomer path.

## 1.6.0
- **New skill `current-docs` + bundled `lib-docs.mjs` + a `code-ops-docs` MCP server** — an in-house, local-first alternative to Context7. Resolves a library's **installed** version and returns its real README + exported type signatures with zero network (fetch fallback only); no third-party indexer, no query egress. Wired as the default for the `CONVENTIONS §2` documentation-lookup capability across all three plugins, so every skill verifies APIs against the installed version instead of memory. The MCP server (`resolve-library` / `get-docs`) auto-registers when the plugin is enabled.

## 1.5.0
- **New orchestrators `ship` + `debug`** — task-scoped cross-plugin pipelines that compose the conventions end-to-end. `ship` drives one change (feature or one-off) through design-check → safety-net → implement → prove → privacy-gate → traceless PR. `debug` drives a symptom through reproduce → isolate → root-cause (checkpoint) → `fix-verified` → traceless PR. Both require `rigor`; the privacy phase runs when `privacy-opsec-suite` is installed and the change touches a privacy surface.

## 1.4.0
- **New skill `pr-split`** — carves an existing big branch into a clean stack of small, **independently-green** PRs (dependency/concern/atomicity grouping, green-at-every-step), then composes `privacy-opsec-suite:authorship-hygiene` fail-closed before pushing so the commits/PRs carry no AI/tooling trace. Never auto-merges.

## 1.3.0
- **Register freshness (fixes the proven field failure):** CONVENTIONS SSOT (§12) now mandates re-validating a finding against the current tree before it is written, carried across a phase boundary, or consumed; added a `Verified-at: <sha>` field to the Finding/Idea schemas (§7) and bundled `scripts/revalidate-register.mjs` (reports FRESH/MOVED/GONE/NO-REF). `codebase-audit` + `feature-discovery` stamp it; `remediation` runs it at Phase 0.
- **Evidence tiers + disconfirmation** added to the §7 Finding schema (CONFIRMED/PROBABLE/SPECULATIVE + a disconfirmation pass; only CONFIRMED drives an auto-fix) — borrowed from `rigor`.
- **Automation-level ladder** (`gated`/`auto-safe`/`auto-all` + always-gated categories, never auto-merge) promoted into CONVENTIONS §4.
- **Multi-boundary control-coverage** rule added to the Security lens (§10).
- Standardized the audit→discovery handoff on `FEATURE_OPPORTUNITIES.md` (dropped `FEATURE_IDEAS.md`).
- **Descriptions** rewritten to lead with `Use when…` triggers + scope/ownership clauses (orchestrator scope; cross-skill overlap disambiguation, e.g. performance↔improve-measured, pr-review↔deep-review↔opsec-pr-gate, normalize↔consistency-closure).

## 1.2.1
- **Fix:** `full-sweep` Phase 6 referenced a non-existent `code-normalization`
  skill; corrected to `normalize` (the real skill slug / `/code-ops-suite:normalize`).
- **Docs:** the README now lists the `full-sweep` and `everything` orchestrators
  (previously absent from the Skills section); the root README skill count is
  corrected to 14.
- **Packaging:** added an MIT `LICENSE` and a `license` field to the manifest.
- **Tooling:** the marketplace now ships `scripts/lint-plugins.mjs` (structural
  linter) wired into CI, which catches this class of doc/reference drift.

## 1.2.0
- General-engineering suite: `codebase-audit`, `security-privacy-audit`,
  `remediation`, `feature-discovery`, `feature-implementation`, `performance`,
  `test-hardening`, `dependency-upgrade`, `pr-review`, `normalize`,
  `doc-alignment`, `onboarding`, plus the `full-sweep` and `everything`
  orchestrators. `explorer` + `reviewer` subagents; shared `CONVENTIONS.md`.
