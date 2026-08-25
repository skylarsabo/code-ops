# Host render layer

Charter: generated marketplace projections for Codex and opencode. Excludes canonical plugin semantics and hook mechanics.

Canonical packages render deterministically into `codex-marketplace/`, `.agents/`, and `opencode-dist/`. Both renderers compare expected output in `--check` mode, so generated trees are projections, not edit targets. The pre-commit hook regenerates eligible output, but CI checks drift on both supported operating-system legs.

The Codex projection translates host-specific metadata, skill frontmatter, agent material, and root tokens. The opencode projection translates names into a flat, plugin-prefixed namespace and turns agent tool declarations into permissions. Both projections intentionally retain runtime scripts as byte-identical copies rather than prose-transformed code.

Renderer registries are load-bearing. A plugin membership or version mismatch fails before output is written. Host compatibility is asserted by structure and regression tests, not by a live host installation. When a canonical script is vendored, it flows through vendored synchronization before either host renderer. Rendered record tooling preserves Git-index blob identity, literal history paths, linked-path containment, and provenance-safe locator refresh across hosts. Repair the canonical source and regenerate; never patch a projection.
