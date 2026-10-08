// Changelog fragments: the shared reader and renderer behind plugins/<name>/changelog.d/<slug>.md.
//
// WHY: two PRs that both edit the head of one plugin CHANGELOG.md collide on the same lines. A PR
// instead adds a NEW file under changelog.d/ (bullets only, no "## <version>" heading), so the
// merge is an add with no shared line. check-plugin-bump.mjs accepts either path.
//
// `assembleChangelog` is the single rule that folds fragments into the changelog text. The Codex
// builder renders through it, and the assemble step folds them into CHANGELOG.md with the same
// function, so the generated dist bytes are identical before and after fragments are assembled.
//
// Pure helpers except `readFragments` (reads one directory) and the assemble command at the end.
//
//   node scripts/changelog-fragments.mjs assemble [--plugin <name>] [--check]
//
// assemble folds every fragment of each plugin (or the one named) into its CHANGELOG.md, then deletes
// the folded fragments. Run it by hand on its own small PR when fragments pile up; no gate runs it,
// because folding on every PR would bring back the CHANGELOG head collision. --check writes nothing
// and exits 1 when any fragment is unassembled. Exit 2 is a usage error.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRAGMENT_DIR = 'changelog.d';

// A repo-relative POSIX path to a fragment: plugins/<name>/changelog.d/<slug>.md, one level deep.
export const FRAGMENT_PATH_RE = /^plugins\/([^/]+)\/changelog\.d\/[^/]+\.md$/;

// The fragment bodies of one plugin directory, sorted by file name (code-unit order, so the render
// never depends on the locale). A missing directory yields none.
export function readFragments(pluginDir) {
  const dir = join(pluginDir, FRAGMENT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort()
    .map((name) => ({ name, body: readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n') }));
}

// Returns `text` with every non-blank fragment body placed under the "## <version>" section: at the
// end of that section when it exists, else as a new section above the first existing one (the place
// bump-plugin-version.mjs puts its own). The text keeps its own line ending. With no non-blank
// fragment the text comes back unchanged, so an assembled changelog renders to itself.
export function assembleChangelog(text, bodies, version) {
  const entries = bodies.map((b) => b.trim()).filter(Boolean);
  if (entries.length === 0) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const added = entries.join('\n').split('\n');
  const isHeading = (line) => /^##\s/.test(line);
  const at = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (at === -1) {
    const section = [`## ${version}`, ...added, ''];
    const first = lines.findIndex(isHeading);
    if (first !== -1) lines.splice(first, 0, ...section);
    else {
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
      lines.push('', ...section);
    }
  } else {
    let end = lines.findIndex((line, i) => i > at && isHeading(line));
    if (end === -1) end = lines.length;
    let last = end - 1;
    while (last > at && lines[last].trim() === '') last--;
    lines.splice(last + 1, 0, ...added);
  }
  return lines.join(eol);
}

// Folds one plugin's fragments into its CHANGELOG.md with `assembleChangelog`, the rule the Codex
// builder renders through. CHANGELOG.md is written first and only the fragments read are deleted, so
// a failed write leaves every fragment in place. Returns the folded fragment names.
export function assemblePlugin(pluginDir) {
  const fragments = readFragments(pluginDir);
  if (fragments.length === 0) return [];
  const { version } = JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'));
  const changelogPath = join(pluginDir, 'CHANGELOG.md');
  const text = assembleChangelog(readFileSync(changelogPath, 'utf8'), fragments.map((f) => f.body), version);
  writeFileSync(changelogPath, text);
  for (const f of fragments) rmSync(join(pluginDir, FRAGMENT_DIR, f.name));
  return fragments.map((f) => f.name);
}

function main(args) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const check = args.includes('--check');
  const at = args.indexOf('--plugin');
  const only = at === -1 ? null : args[at + 1];
  const rest = args.filter((a, i) => a !== 'assemble' && a !== '--check' && a !== '--plugin' && i !== at + 1);
  if (args[0] !== 'assemble' || rest.length > 0 || (at !== -1 && (!only || only.startsWith('--')))) {
    console.error('usage: changelog-fragments.mjs assemble [--plugin <name>] [--check]');
    return 2;
  }
  const pluginsDir = join(root, 'plugins');
  const known = existsSync(pluginsDir) ? readdirSync(pluginsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
  if (only && !known.includes(only)) {
    console.error(`unknown plugin: ${only}`);
    return 2;
  }
  let pending = 0;
  for (const name of only ? [only] : known) {
    const dir = join(pluginsDir, name);
    const names = check ? readFragments(dir).map((f) => f.name) : assemblePlugin(dir);
    pending += names.length;
    if (names.length > 0) console.log(`${name}: ${check ? 'unassembled' : 'folded'} ${names.length} (${names.join(', ')})`);
  }
  if (pending === 0) console.log('no fragments');
  return check && pending > 0 ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
