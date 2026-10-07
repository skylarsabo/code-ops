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
// Pure helpers except `readFragments`, which reads one directory.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
