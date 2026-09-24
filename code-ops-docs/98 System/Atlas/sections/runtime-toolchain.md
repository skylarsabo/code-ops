# Runtime toolchain

Charter: repository-wide runtime selection. Excludes workflow scheduling, action dependency review, and package-specific host requirements.

`.node-version` is the single Node runtime authority for local verification and GitHub Actions. It selects the supported Node 24 LTS line without duplicating a patch number across workflows. Every `actions/setup-node` step consumes this file, while `.github/actions-lock.json` governs the setup action implementation separately.

The marketplace remains dependency-free: scripts use only `node:` built-ins and relative imports. Runtime upgrades therefore change the interpreter contract, not a package graph. Validate both operating-system legs, the full deterministic eval suite, generated host projections, and the no-dependencies gate before treating a runtime change as supported.

`tsconfig.json` is the root type-check configuration. It covers `scripts/` and the suite hooks, emits nothing, and leaves `checkJs` off, so only files that opt in with `// @ts-check` are checked. It also sets `noUncheckedIndexedAccess`, so an index read is typed as possibly undefined. The checked libs meet it with guards, `entries()` loops, and destructuring rather than non-null assertions. `digest-lib.mjs` opts in, and `record-lib.mjs` stays un-opted. CI installs the pinned TypeScript outside the tree, so the configuration adds no dependency.
