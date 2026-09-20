# Host render layer

Charter: generated marketplace projections for Codex and opencode. Excludes canonical plugin semantics and hook mechanics.

Canonical packages render deterministically into `codex-marketplace/`, `.agents/`, and `opencode-dist/`. Both renderers compare expected output in `--check` mode, so generated trees are projections, not edit targets. The pre-commit hook regenerates eligible output, but CI checks drift on both supported operating-system legs.

The Codex projection translates host-specific metadata, skill frontmatter, agent material, and root tokens. The opencode projection translates names into a flat, plugin-prefixed namespace and turns agent tool declarations into permissions. Both projections intentionally retain runtime scripts as copies rather than prose-transformed code, and the Codex renderer rewrites only host-local storage defaults rather than prose-transformed code.

Both projections also carry each plugin's vendored `reference/` specs, Codex at `plugins/<plugin>/reference/` and OpenCode at `code-ops/<plugin>/reference/`. Unlike scripts, which render through `portableRuntimeText` at `scripts/build-codex-marketplace.mjs:513`, the specs take the skill-text transform at `scripts/build-codex-marketplace.mjs:515`, so the Claude plugin-root token becomes `<plugin-root>`. The OpenCode renderer deliberately skips its conventions transform there, because that transform rewrites paragraphs only `CONVENTIONS.md` holds. Renderer validation rejects a rendered spec that retains the plugin-root token, and the OpenCode check also rejects a bare Claude skill reference. Generated READMEs, compatibility pages, and the model-tier page say rebuilds run in the code-ops repository, and lint's shipped-reference scan reads both projections.

Renderer registries are load-bearing. A plugin membership or version mismatch fails before output is written. Host compatibility is asserted by structure and regression tests, not by a live host installation. When a canonical script is vendored, it flows through vendored synchronization before either host renderer. Rendered record tooling preserves canonical stage-0 blob identity, content-aware worktree comparison, literal history paths, linked-path containment, and provenance-safe locator refresh across hosts. Its bounded Git batches and command-local caches are copied byte-identically. Repair the canonical source and regenerate; never patch a projection.

The rendered vault workflow includes genesis and incremental review-plan handoffs. Host projections carry inventory v3 authority batches, identity-bound clone-wide locking, exact-once coverage, predecessor-state proof, and isolated recovery guidance from the canonical plugin. Rendered record engines use the reviewed current path admission and exact-history proof. Both host trees also carry the shared traceless scanner's topology-safe emoji rule, Git-derived single-file dash baseline, and `--command` mode, which the Codex hook copy and the OpenCode traceless plugin both invoke.

Both host projections carry the runtime helpers inherited by Run Contract v4, shared acceptance parser, worker-brief compiler, bounded context view, portable-path, linked-component, regular-index, and hidden-index guards, local review publisher, judgment planner/scorer, and `local-review-gate` skill from canonical source. Renderer checks prove those scripts and skill instructions remain current; neither host projection owns an alternate review or runtime policy. Per-provider configurations keep cost-disciplined tier ladders, and the default free OpenCode provider binds light, mid, and strong to one model so no operative routes below the strong floor. An explicitly selected premium frontier specialist remains available for one bounded unit.

Generated agent-floor records make the lead and operative tiers machine-readable in both projections. The Codex projection strips agent tool declarations, so each role contract header states the role's write capability from the canonical tools list, and the compatibility page lists every bundled hook command with its purpose. Host adapters normalize their own payload and result shapes, while the canonical policy still requires the highest-tier lead to synthesize, challenge, redirect, and accept operative evidence selected by task and declared role floor.

The Codex projection carries the session receipt and follows child rollouts through
`parent_thread_id`. It also projects the compact-resume routing card because plain
`PreCompact` stdout cannot alter the summary. The OpenCode projection ports traceless/model
floors, digest, index, routing, native compaction, and MCP behavior. Its current plugin API has
no typed ladder-card or transcript-receipt callback, and no per-subagent identity for the
dispatch guard. Its routing card is baked at build time, so the pending-handoff line cannot
reach it. The compatibility record names every gap instead of claiming parity.

The current projections include task-based contract routing, selective bounded worker views, separate cache cost components, and focused implementer verification guidance. Claude and Codex project explicit dispatch registration and receipts; OpenCode still has no dispatch-guard equivalent.
