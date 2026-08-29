# Runtime toolchain

Charter: repository-wide runtime selection. Excludes workflow scheduling, action dependency review, and package-specific host requirements.

`.node-version` is the single Node runtime authority for local verification and GitHub Actions. It selects the supported Node 24 LTS line without duplicating a patch number across workflows. Every `actions/setup-node` step consumes this file, while `.github/actions-lock.json` governs the setup action implementation separately.

The marketplace remains dependency-free: scripts use only `node:` built-ins and relative imports. Runtime upgrades therefore change the interpreter contract, not a package graph. Validate both operating-system legs, the full deterministic eval suite, generated host projections, and the no-dependencies gate before treating a runtime change as supported.
