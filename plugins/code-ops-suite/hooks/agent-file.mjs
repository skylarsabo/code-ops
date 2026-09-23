// Shared by dispatch-guard.mjs and subagent-report.mjs, so both hooks resolve a suite agent's
// definition file the same way. Not a hook: hooks.json registers no command for it. Every host
// render that ships those two hooks copies the whole hooks/ tree, so this sibling import holds.

import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Plugins whose agents carry a `## Contract` the hooks read.
export const SUITE_PLUGINS = new Set(['code-ops-suite', 'rigor', 'privacy-opsec-suite', 'researcher']);

// The agent definition file for a `<plugin>:<agent>` type in one of the suite plugins, or null.
// The repo keeps sibling plugins at `plugins/<plugin>/`; the installed cache keeps them at
// `<marketplace>/<plugin>/<version>/`, where the highest all-numeric version directory wins.
export function agentFile(subagentType) {
  const match = /^([a-z-]+):([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(String(subagentType ?? '').trim());
  if (!match || !SUITE_PLUGINS.has(match[1])) return null;
  const [, plugin, leaf] = match;
  const base = process.env.CLAUDE_PLUGIN_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
  const roots = [join(dirname(base), plugin)];
  if (basename(dirname(base)) === plugin) roots.push(base);
  try {
    const versions = readdirSync(join(dirname(dirname(base)), plugin))
      .filter((name) => /^\d+(\.\d+)*$/.test(name))
      .map((name) => ({ name, parts: name.split('.').map(Number) }))
      .sort((a, b) => {
        for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
          const diff = (b.parts[i] ?? 0) - (a.parts[i] ?? 0);
          if (diff) return diff;
        }
        return 0;
      });
    if (versions.length) roots.push(join(dirname(dirname(base)), plugin, versions[0].name));
  } catch { /* no cache layout */ }
  for (const root of roots) {
    const path = join(root, 'agents', `${leaf}.md`);
    if (existsSync(path)) return path;
  }
  return null;
}
