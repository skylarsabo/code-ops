#!/usr/bin/env node
// Deferral harvest: collects every `deferred(<ceiling>, <upgrade path>)` marker from tracked
// text files into a register that revalidate-register.mjs re-greps, so a deliberate
// simplification (CONVENTIONS §11 "Size discipline") carries a route back.
//
//   node scripts/harvest-deferrals.mjs [--root <dir>] [--out <path>] [--check] [--json]
//
// A marker is any `deferred(<ceiling>, <upgrade>)` inside a comment line (`//`, `#`, `*`,
// `<!--`, `--`, or `;`; in Markdown and HTML only `<!--`, because a heading or a bold line
// starts the same way): the ceiling is the text before the first comma, the upgrade is the
// rest up to the closing parenthesis. The word deferred in prose, a call `deferred(x)` in code
// outside a comment, and the template itself with its `<angle>` placeholders are not markers.
//
// Register shape (one item per marker, in the finding-register grammar):
//   ### DEF-nnnnnn
//   - File: `path:line`
//   - Anchor: `<verbatim substring of that line>`
//   - Ceiling: <text>
//   - Upgrade: <text>
//   - Verified-at: <HEAD sha>
// The id is the first six digits of the decimal sha1 of `path + NUL + ceiling`, so it survives
// line moves and re-harvests and changes only when the marker moves file or changes ceiling.
//
// --check re-harvests and compares with the register on disk, ignoring Verified-at; it exits 1
// when they differ. Default --out is `<hub>/98 System/DEFERRALS_REGISTER.md` when exactly one
// `*-docs/98 System` hub exists under root, else `./DEFERRALS_REGISTER.md`.
//
// Exit: 0 written or in sync, 1 --check found drift, 2 on a usage error or a git failure.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const USAGE = 'usage: harvest-deferrals.mjs [--root <dir>] [--out <path>] [--check] [--json]';
let root = process.cwd();
let out = null;
let check = false;
let json = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
  else if (a === '--root') { root = argv[++i]; if (!root || root.startsWith('--')) die('--root needs a directory'); }
  else if (a === '--out') { out = argv[++i]; if (!out || out.startsWith('--')) die('--out needs a path'); }
  else if (a === '--check') check = true;
  else if (a === '--json') json = true;
  else die(`unknown argument: ${a}`);
}
root = resolve(root);
function die(msg) { console.error(`x ${msg}\n${USAGE}`); process.exit(2); }

function git(args) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
    console.error(`x git ${args[0]} failed: ${String(e.stderr ?? e.message).trim()}`);
    process.exit(2);
  }
}

const TEXT_RE = /\.(mjs|cjs|js|tsx?|jsx|py|rb|go|rs|java|kt|swift|cs|c|h|cpp|hpp|sh|ps1|md|markdown|txt|ya?ml|toml|json|css|scss|html?|sql)$/i;
const COMMENT_RE = /^\s*(?:\/\/|#|\*|\/\*|<!--|--|;)/;
const PROSE_COMMENT_RE = /^\s*<!--/;
const PROSE_RE = /\.(md|markdown|html?)$/i;
const MARKER_RE = /deferred\(([^,()]+),\s*([^()]*)\)/g;
const NAME = 'DEFERRALS_REGISTER.md';

const defaultOut = () => {
  const hubs = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.endsWith('-docs') && existsSync(join(root, d.name, '98 System')))
    .map((d) => join(root, d.name, '98 System', NAME));
  return hubs.length === 1 ? hubs[0] : join(root, NAME);
};
const target = resolve(root, out ?? defaultOut());
const targetRel = relative(root, target).replace(/\\/g, '/');

const head = git(['rev-parse', 'HEAD']).trim();
const files = git(['ls-files', '-z']).split('\0').filter((f) => f && TEXT_RE.test(f) && f !== targetRel);

const items = [];
for (const file of files) {
  let text;
  try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
  if (text.includes('\0')) continue;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!(PROSE_RE.test(file) ? PROSE_COMMENT_RE : COMMENT_RE).test(line) || !line.includes('deferred(')) continue;
    for (const m of line.matchAll(MARKER_RE)) {
      const ceiling = m[1].trim();
      const upgrade = m[2].trim();
      if (!ceiling || !upgrade || ceiling.startsWith('<')) continue;
      const digest = createHash('sha1').update(`${file}\0${ceiling}`).digest('hex');
      const id = `DEF-${String(parseInt(digest.slice(0, 12), 16) % 1000000).padStart(6, '0')}`;
      // The anchor is the marker text as written, which is a verbatim substring of the line.
      const anchor = m[0].replace(/`/g, '');
      items.push({ id, file, line: i + 1, anchor, ceiling, upgrade });
    }
  }
}
items.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

const render = (rows) => [
  '# Deferrals register',
  '',
  `Harvested by \`harvest-deferrals.mjs\` from every \`deferred(<ceiling>, <upgrade path>)\` marker in a comment. Do not edit by hand: re-run the harvest, and check it with \`revalidate-register.mjs\`.`,
  '',
  `${rows.length} deferral(s).`,
  '',
  ...rows.flatMap((it) => [
    `### ${it.id}`,
    `- File: \`${it.file}:${it.line}\``,
    `- Anchor: \`${it.anchor}\``,
    `- Ceiling: ${it.ceiling}`,
    `- Upgrade: ${it.upgrade}`,
    `- Verified-at: ${head}`,
    '',
  ]),
].join('\n');

const body = render(items);
if (json) {
  process.stdout.write(`${JSON.stringify({ head, register: targetRel, items }, null, 2)}\n`);
} else if (check) {
  const strip = (t) => t.replace(/^- Verified-at: .*$/gm, '').replace(/\r\n/g, '\n');
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (strip(current) === strip(body)) {
    console.log(`ok ${targetRel} is in sync (${items.length} deferral(s))`);
  } else {
    console.log(`x ${targetRel} is out of date: re-run harvest-deferrals.mjs (${items.length} deferral(s) in the tree)`);
    process.exit(1);
  }
} else {
  writeFileSync(target, body);
  console.log(`ok wrote ${targetRel} (${items.length} deferral(s), Verified-at ${head.slice(0, 7)})`);
}
