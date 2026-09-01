# Host render layer

Charter: generated marketplace projections for Codex and opencode. Excludes canonical plugin semantics and hook mechanics.

Canonical packages render deterministically into `codex-marketplace/`, `.agents/`, and `opencode-dist/`. Both renderers compare expected output in `--check` mode, so generated trees are projections, not edit targets. The pre-commit hook regenerates eligible output, but CI checks drift on both supported operating-system legs.

The Codex projection translates host-specific metadata, skill frontmatter, agent material, and root tokens. The opencode projection translates names into a flat, plugin-prefixed namespace and turns agent tool declarations into permissions. Both projections intentionally retain runtime scripts as byte-identical copies rather than prose-transformed code.

Renderer registries are load-bearing. A plugin membership or version mismatch fails before output is written. Host compatibility is asserted by structure and regression tests, not by a live host installation. When a canonical script is vendored, it flows through vendored synchronization before either host renderer. Rendered record tooling preserves canonical stage-0 blob identity, content-aware worktree comparison, literal history paths, linked-path containment, and provenance-safe locator refresh across hosts. Its bounded Git batches and command-local caches are copied byte-identically. Repair the canonical source and regenerate; never patch a projection.

The rendered vault workflow includes genesis and incremental review-plan handoffs. Host projections carry inventory v3 authority batches, identity-bound clone-wide locking, exact-once coverage, predecessor-state proof, and isolated recovery guidance from the canonical plugin. Rendered record engines use the reviewed current path admission and exact-history proof. Both host trees also carry the shared traceless scanner's topology-safe emoji rule and Git-derived single-file dash baseline.

Both host projections now carry the Run Contract v3 runtime helpers, shared portable-path and hidden-index guards, local review publisher, judgment planner/scorer, and `local-review-gate` skill from canonical source. Renderer checks prove those scripts and skill instructions remain current; neither host projection owns an alternate review or runtime policy.
