# researcher

Adaptive, multi-agent workflows for **code-grounded research** — authored here as the canonical Claude Code package and rendered into a native Codex package. Invoke `/researcher:<name>` in Claude Code or name `researcher:<name>` in Codex. The workflows ground external knowledge in *your own* code (or the materials you hand them), gather prior art and library capabilities, and **propose** improvements, design directions, library calls, and net-new ideas — then hand implementation to the other suites. They **research and propose; they never edit source.** And they are honest about what leaves the machine: every external request is disclosed, recorded, and confirmed first (`CONVENTIONS.md`, §A).

**Stance:** local-first, cited, disconfirmed. The most local, most cited, most disconfirmed answer wins. Every claim names a source and a confidence tier; web retrieval is opt-in per run and never silent.

It complements the rest of the marketplace rather than overlapping it: where `code-ops-suite:feature-discovery` mines opportunities from your code, the researcher's edge is bringing in **external** knowledge (best practices, library capabilities, prior art, pitfalls) and grounding it in your code; where `deep-research` is generic web research, the researcher composes it for the opt-in web leg but keeps the work code-grounded; where `lib-docs` / `current-docs` give zero-egress dependency docs, the researcher uses them as a primary grounding source.

New to the suite? See the handbook at `docs/handbook/` (from the repo root) to learn to use it.

## Skills

Invoke with `/researcher:<name>` in Claude Code or `researcher:<name>` in Codex. All are manual-invoke (deliberate operations — they won't auto-fire).

**Discover & propose** (Mode: DISCOVERY — produces registers and briefs, never code)
- `research-spike` — given a task or plan, gather prior art and approach options with trade-offs into a cited **design brief** + recommendation. Feeds `code-ops-suite:feature-implementation` / `code-ops-suite:ship` / `code-ops-suite:adr`.
- `research-improve` — ground in your code, then gather external best practices and known pitfalls into grounded, ranked improvements (`RESEARCH_FINDINGS.md`). Feeds `code-ops-suite:remediation` / `rigor:fix-verified`.
- `research-ideate` — code + domain + (opt-in) trends into net-new feature and direction ideas with feasibility and a smallest valuable slice (`IDEAS_REGISTER.md`). Feeds `code-ops-suite:feature-discovery` / `code-ops-suite:feature-implementation`.
- `ecosystem-watch` — what changed in *your* stack to act on: dependency updates, CVEs, deprecations, newly-available capabilities; schedulable. Composes `code-ops-suite:dependency-upgrade` / `privacy-opsec-suite:supply-chain-trust`.

**Verify & evaluate** (Mode: REVIEW — produces a verdict, never code)
- `research-verify` — adversarial claim-check: verify a claim or proposed approach against sources **and** your code, tier the verdict, and flag anything unsupported or hallucinated. Gates the other skills' output.
- `library-eval` — "adopt X?" — A-vs-B-vs-build, grounded in your code and the sources, with fit and migration cost into a recommendation. Feeds `code-ops-suite:adr`.

**Orchestrator**
- `research-sweep` — run the suite end-to-end as one developer-in-the-loop pipeline (ground → gather → verify → propose), surfacing the egress manifest at every checkpoint and pausing at each phase boundary.

## Local-first & disclosed egress

The central, non-negotiable constraint every skill enforces (`CONVENTIONS.md`, §A):

- **Default sources are local** — the codebase, version-control history, installed-dependency docs (via `lib-docs`, or the `code-ops-docs` MCP when `code-ops-suite` is installed), and the materials you hand it (pasted text, file paths, URLs you explicitly provide). No query leaves the machine for any of these.
- **Web / external retrieval is explicit opt-in per run.** There is always a checkpoint before any network egress; the developer confirms scope before a single request goes out. Never silently egress.
- **Every external request is recorded** in `EGRESS_MANIFEST.md` via `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs record ...` (time · tool · host · url · why) and surfaced at the checkpoint.
- **The manifest is a fail-closed gate.** Before an artifact is published, `node ${CLAUDE_PLUGIN_ROOT}/scripts/research-manifest.mjs validate <artifact>` enforces that every external claim has a manifest entry and a citation — a published artifact may **not** cite a web source that is not in the manifest, and an egress without a manifest entry fails the check.
- **Cited + tiered, always.** Every claim names a source (code `file:line`, an installed-dependency doc, or an external source with a retrieval record) and a tier — CONFIRMED / PROBABLE / SPECULATIVE (`CONVENTIONS.md` §7). A claim with no source is not reported.

## Conventions

`CONVENTIONS.md` (bundled at the plugin root) is the shared backbone: the research-integrity & egress model (§A), the dynamic orchestration model, the developer-in-the-loop interaction protocol, the safety rails (no source edits, never silently egress, redact secrets/PII, never fabricate), the modes (DISCOVERY / REVIEW / DOCUMENT — none edit source), the proposal tracks and finding/idea schema, the evidence-tier and citation discipline, the severity taxonomy, the research-centric quality lenses, the hand-off map, and the single-source-of-truth / register conventions. Each skill references it by section instead of repeating it.

For always-on application, add a pointer in your repo's `CLAUDE.md` to this plugin's `CONVENTIONS.md`:
> Research in this repo follows the researcher plugin's `CONVENTIONS.md`: claims cited (`file:line` / installed-doc / manifested external) and tiered, grounded in our code with a disconfirmation pass, local-first with disclosed fail-closed egress, and propose-don't-mutate (hand off to the implementation suites).

## How they chain

Registers are live backlogs / single source of truth with stable IDs (`RSCH-007` for findings, `IDEA-012` for ideas):
- `research-improve` → `RESEARCH_FINDINGS.md` → `code-ops-suite:remediation` / `rigor:fix-verified`
- `research-ideate` → `IDEAS_REGISTER.md` → `code-ops-suite:feature-discovery` / `code-ops-suite:feature-implementation`
- `research-spike` → a cited design brief → `code-ops-suite:feature-implementation` / `code-ops-suite:ship` / `code-ops-suite:adr`
- `library-eval` → recommendation → `code-ops-suite:adr`
- `ecosystem-watch` → registers → `code-ops-suite:dependency-upgrade` / `privacy-opsec-suite:supply-chain-trust`
- `research-verify` gates the others' output before it's published or handed off

`research-sweep` strings these together end-to-end. Before a finding is carried across a phase boundary or handed off, it is re-confirmed against the current tree; the mechanical pre-filter is `node ${CLAUDE_PLUGIN_ROOT}/scripts/revalidate-register.mjs <register> --root <repo>`, which drops or re-tiers anything that no longer holds and stamps each entry with the commit SHA it was verified against (`CONVENTIONS.md` §12). The researcher's terminal output is always a register or brief — never a diff — concrete enough for the named implementer to act without re-researching (`CONVENTIONS.md` §11).

## Loops & automation

- **In-session loop:** drive a skill to its "Done when" criteria with the built-in `/loop`.
- **Recurring watch:** `ecosystem-watch` is built to schedule — put it on a Routine (`/schedule`) to keep up with dependency updates, CVEs, deprecations, and newly-available capabilities, and let it open hand-offs into `code-ops-suite:dependency-upgrade` / `privacy-opsec-suite:supply-chain-trust`.
- **Guard the egress posture on every PR:** any change to the egress surface (a new outbound path, a weakened disclosure, an un-manifested source) is blocking. Wire `privacy-opsec-suite:opsec-pr-gate` into CI with `anthropics/claude-code-action@v1` to gate it (canonical setup: `/install-github-app`, then paste the criteria).
- **Deterministic backstops:** the `research-manifest.mjs` record → validate round-trip is fail-closed and runs cheaply in CI — an egress without a manifest entry, or an un-cited external claim, fails the build. Reserve the judgment-heavy skills (spike, verify, ideate, library-eval) for the work that needs a model.

## Notes

- Works on any stack; skills self-detect tooling and ground in the repo's existing conventions rather than imposing new ones.
- Optional tools (a docs-lookup MCP, version-control history, a browser/UI tool, the opt-in `deep-research` web leg) are used if connected and skipped otherwise.
- Secrets, PII, and real identifiers are radioactive — redacted everywhere, including in evidence; a discovered live secret becomes a critical hand-off finding (location + rotation, never the value).
- Pairs with `code-ops-suite` (broad engineering and implementation), `rigor` (proof and verification), and `privacy-opsec-suite` (the anonymity/opsec specialization that also guards this plugin's egress posture). The researcher proposes; those plugins build.
