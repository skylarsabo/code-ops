# Gate scripts and hooks

Charter: the gate/lint layer under `scripts/` and `.githooks/` — the failure postures, cross-file couplings, and looks-wrong-but-load-bearing code a gate edit must respect. Leaves out the plugin doctrine the gates enforce (see plugins-and-skills) and the evals that pin gate text (see evals-and-calibration).

## The three failure postures (deliberate, per-gate)

- **Fail-closed is the default.** Scanners share one exit contract: config/usage errors (exit 2) beat hit-findings (exit 1), so a broken invocation can never masquerade as "merely dirty". A malformed gate config fails closed rather than silently disabling the check; unknown flags exit 2 rather than being treated as filenames.
- **Fail-open exists in exactly two documented places**: `check-plugin-bump.mjs` and `check-gate-workflow-edit.mjs`, both only when the base ref does not resolve (push events). Both annotate the exception in-file.
- **Atlas staleness is a third posture, fail-SAFE**: ambiguity resolves to STALE (cheap re-derivation), while a malformed manifest is still fail-closed. Coverage gaps stay advisory even under `--gate`.

Advisory-vs-gate is decided by whether the risk is mechanical or human-process: an unreviewed gate-workflow edit and a dangling dispatch row are advisories (blocking them would punish legitimate process); malformed ledgers and schema violations gate. Lint's check 16 (scripts unreferenced by evals) is informational and must never affect the exit code. `check-autofix-scope.mjs` is one-directional on purpose: DENY reclassifies, PASS never promotes.

Every gate's rationale lives in its `// WHY:` header — that convention is the durable rationale store; read it before changing a gate's behavior.

## Couplings a gate edit must respect

- **Doctrine text is a 4-way edit**: SHARED_PASSAGES/AGENT_SHARED_PASSAGES in `lint-plugins.mjs` pin byte-identical spans across CONVENTIONS/agent files, and `evals/lint-plugins/run.mjs` transcribes the same spans verbatim as PINNED_TEXTS/ALWAYS_GATED_TEXT. Changing a pinned sentence means editing every doctrine copy + the linter array + the eval constants in one commit; forgetting the eval is a CI-only failure (recorded lesson).
- **AGENT_MODEL_FLOORS is exhaustive**: a new agent with no floor entry fails lint, and the `(model: ...)` annotations in `docs/techniques/subagent-trade-offs.md` must match agent frontmatter.
- **Vendored parity has two enforcement paths with different coverage**: the manifest-driven path (`vendored-manifest.mjs` → `sync-vendored.mjs` → pre-commit hook) and a derived check that enforces byte parity for any `${CLAUDE_PLUGIN_ROOT}/scripts/X` referenced in SKILL.md/CONVENTIONS even when absent from the manifest. The general trap: a script that is vendored and reference-checked but missing from RUNTIME_SCRIPTS will pass the pre-commit hook on a canonical edit and then fail CI on drift (`atlas-check.mjs` shipped that way and was later registered) — when adding a vendored script, register it in the manifest in the same commit; never weaken the derived check.
- Every `evals/<name>/run.mjs` must appear as the literal string `node evals/<name>/run.mjs` in `validate.yml`.
- A canonical `scripts/` edit that is vendored propagates through **two** derived stages: sync-vendored, then build-codex-marketplace (the codex tree contains copies of the vendored copies).
- `calibration-graph.mjs` is root-only, never vendored, and never reads a target repo — it is the repo side of the one-way calibration channel; its derived fields (ratios, recurrence) are computed, never stored, so the store and the render cannot disagree.

## Looks wrong, is load-bearing

- Check 19's auto-merge denylist tokens are built by string concatenation (`'gh' + ' pr ' + 'merge'`) because the scanner scans its own file; the doc-comment prose likewise avoids the literals. Same class: `scan-ai-tells.mjs` must never contain its own tell patterns as literals. Do not "clean up".
- `check-doc-citations.mjs` skips fenced code blocks — required, because one technique doc ships deliberately fictional example citations in a fence.
- `check-plugin-bump.mjs` excludes `codex-marketplace/plugins/**` despite the matching shape (derived tree ≠ plugin source), and requires the changelog diff to add a non-blank line — presence is not enough.
- Gate scripts guard their entrypoints (`invoked-directly` checks) so evals can import their matchers; removing the guard breaks the eval harness.
- `scan-ai-tells.mjs` rejects `--git` range tokens starting with `-` (option smuggling) and uses `execFileSync` with no shell — both load-bearing.

## The pre-commit hook (`.githooks/pre-commit`)

Ordering is load-bearing: vendored sync runs first (only when manifest-listed canonicals are staged) because it stages content under `plugins/` that the Codex regeneration must pick up. The hook then refuses to proceed if any renderer input is unstaged-modified or untracked — rendering reads the working tree while a commit records the index, so dirty inputs could stage output for source absent from the commit. Its only `git add -A` is path-scoped to derived output; it never stages authored source. Hooks shorten the feedback loop; CI is always the fail-closed backstop for clones without hooks (`enforce-traceless` even fails open on scanner infra errors for exactly this reason).
