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
  { name: 'preflight.mjs', plugins: ['code-ops-suite', 'rigor'] },
  { name: 'repo-map.mjs', plugins: ['code-ops-suite', 'rigor'] },
];
