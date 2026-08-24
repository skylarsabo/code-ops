// Data-only manifest of runtime scripts vendored (byte-identical copies) into plugin
// scripts/ dirs, because skills invoke them via ${CLAUDE_PLUGIN_ROOT}/scripts/.
//
// Single source of truth for two consumers:
//   - scripts/lint-plugins.mjs   — fails CI when a vendored copy drifts from the canonical
//     scripts/<name>, or a plugin that must carry a script is missing it.
//   - scripts/sync-vendored.mjs — copies the canonical scripts/<name> over each listed
//     plugins/<plugin>/scripts/<name> (and is what the pre-commit hook runs).
//
// Add/remove a vendored script or change which plugins bundle it here; both consumers
// pick it up automatically.

export const RUNTIME_SCRIPTS = [
  { name: 'revalidate-register.mjs', plugins: ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'] },
  { name: 'scan-ai-tells.mjs', plugins: ['privacy-opsec-suite', 'code-ops-suite'] },
  { name: 'lib-docs.mjs', plugins: ['code-ops-suite', 'privacy-opsec-suite', 'rigor', 'researcher'] },
  { name: 'lib-docs-mcp.mjs', plugins: ['code-ops-suite'] },
  { name: 'research-manifest.mjs', plugins: ['researcher'] },
  { name: 'check-autofix-scope.mjs', plugins: ['code-ops-suite', 'rigor', 'privacy-opsec-suite'] },
  { name: 'run-proof.mjs', plugins: ['code-ops-suite', 'rigor'] },
  { name: 'check-proof-integrity.mjs', plugins: ['rigor'] },
  { name: 'scan-redaction.mjs', plugins: ['code-ops-suite', 'privacy-opsec-suite'] },
  { name: 'scan-injection-tells.mjs', plugins: ['privacy-opsec-suite', 'researcher'] },
  { name: 'preflight.mjs', plugins: ['code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'] },
  { name: 'repo-map.mjs', plugins: ['code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'] },
  { name: 'import-graph.mjs', plugins: ['code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'] },
  { name: 'calibration-metrics.mjs', plugins: ['code-ops-suite'] },
  { name: 'dispatch-ledger.mjs', plugins: ['code-ops-suite'] },
  { name: 'estimate-run-cost.mjs', plugins: ['code-ops-suite'] },
  { name: 'run-contract.mjs', plugins: ['code-ops-suite'] },
  { name: 'context-snapshot.mjs', plugins: ['code-ops-suite'] },
  { name: 'context-bundle.mjs', plugins: ['code-ops-suite'] },
  { name: 'context-index-lib.mjs', plugins: ['code-ops-suite'] },
  { name: 'docs-manifest.mjs', plugins: ['code-ops-suite'] },
  { name: 'docs-extract.mjs', plugins: ['code-ops-suite'] },
  { name: 'records.mjs', plugins: ['code-ops-suite'] },
  { name: 'record-lib.mjs', plugins: ['code-ops-suite'] },
  // Imported by the three above for the model-class resolver; it ships as their dependency,
  // not because a skill invokes it directly.
  { name: 'model-tiers.mjs', plugins: ['code-ops-suite'] },
  // Imported by the same three for grammar (a) — the DISPATCH_LEDGER.md row shape — so the
  // writer and the two readers cannot drift apart. A dependency, not a skill entry point.
  { name: 'ledger-grammar.mjs', plugins: ['code-ops-suite'] },
  { name: 'scan-narration.mjs', plugins: ['code-ops-suite'] },
  { name: 'atlas-check.mjs', plugins: ['code-ops-suite'] },
  { name: 'check-vault-standard.mjs', plugins: ['code-ops-suite'] },
  // check-fleet.mjs spawns check-vault-standard.mjs as a SIBLING, so the two must ship into
  // the same plugin scripts/ dir or the fleet run's vault surface is UNKNOWN everywhere.
  { name: 'check-fleet.mjs', plugins: ['code-ops-suite'] },
];
