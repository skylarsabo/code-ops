// One declared map of the repository layout, as repo-relative POSIX paths.
//
// A check or a script that needs a documentation directory, a plugin's CONVENTIONS.md, or a
// directory a check must skip reads it here instead of spelling the path out. A layout move then
// changes this file and nothing else.
//
// Readers:
//   - scripts/lint-plugins.mjs       the handbook and Techniques paths of checks 8, 12, 17, 21, 22, and 27
//   - scripts/doctrine-passages.mjs  the CONVENTIONS.md path of each plugin
//   - scripts/check-duplication.mjs  the documentation root, its skipped scratch, and the plugin list
//
// Data and pure path helpers only, with node: builtins at most, so a fixture can copy it beside
// lint-plugins.mjs.

import { join } from 'node:path';

export const PLUGINS_DIR = 'plugins';
export const PLUGIN_NAMES = ['code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher'];

// The documentation hub, the only authored documentation tree.
export const DOCS_ROOT = 'code-ops-docs';

// Named directories and files under the repository root.
export const LAYOUT = {
  docsRoot: DOCS_ROOT,
  handbookReadme: `${DOCS_ROOT}/40 Engineering/Handbook/README.md`,
  handbookCommands: `${DOCS_ROOT}/40 Engineering/Handbook/commands`,
  techniques: `${DOCS_ROOT}/40 Engineering/Techniques`,
  skillComposition: `${DOCS_ROOT}/40 Engineering/Techniques/skill-composition.md`,
  subagentTradeOffs: `${DOCS_ROOT}/40 Engineering/Techniques/subagent-trade-offs.md`,
};

// Documentation directories a content scan skips: run scratch the hub gitignores, and the archive.
export const DOCS_SCAN_SKIP = [`${DOCS_ROOT}/80 Runs`, `${DOCS_ROOT}/99 Archive`];

// Absolute path of a LAYOUT entry under `root`.
export function layoutPath(key, root) {
  const rel = LAYOUT[key];
  if (rel === undefined) throw new Error(`layout-manifest: unknown layout key "${key}"`);
  return join(root, ...rel.split('/'));
}

// Repo-relative path of a plugin's CONVENTIONS.md.
export const conventionsRel = (plugin) => `${PLUGINS_DIR}/${plugin}/CONVENTIONS.md`;
