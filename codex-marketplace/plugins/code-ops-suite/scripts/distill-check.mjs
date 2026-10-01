#!/usr/bin/env node
// The deterministic no-loss check and findability count for a distill run (design "Agent state
// machine and host parity", section "Distill", paragraph "No-loss guarantee"). `co docs distill`
// reaches it.
//
//   node scripts/distill-check.mjs inventory   --hub <hub dir> --out <file.json> [--root <repo>] [--json]
//   node scripts/distill-check.mjs no-loss     --inventory <file.json> [--hub <hub dir>] [--root <repo>] [--json]
//   node scripts/distill-check.mjs findability --hub <hub dir> [--index <file or glob>]... [--root <repo>] [--json]
//
// WHY: a model review cannot prove that a distill run lost nothing. This script can. Phase 1 lists
// every file under the hub. Phase 8 and every maintain pass ask where each listed path went.
//
// INVENTORY lists every file path under the hub, repo-relative with forward slashes, sorted by code
// unit, each with its byte size. It holds no date, so one tree always yields the same bytes. The
// output file is the only thing this script writes, and the listing leaves that file out.
//
// NO-LOSS gives each inventory path its states. A path has
//   in-place   a file at that path;
//   moved      a `<hub>/98 System/FORWARDING.json` chain (record-lib forwardPath) that ends at a file
//              that exists. The path may still exist, and then it also has `in-place`, which fails;
//   archived   no file at that path, and a link that names it from an archive note.
// ARCHIVE LINK RULE. An archive note is a Markdown file under `<hub>/99 Archive/`. A link names a
// path when a Markdown link or a wikilink in a note resolves to it. The link may dangle, because the
// bytes left. A link from any other file proves nothing, since a live note may cite a file it never
// archived. A link to a file that still exists is only a link, so `archived` needs the path absent.
// Each path must have exactly one state. No state is a loss. Two states are ambiguous. Both fail.
// The count of inputs must equal the count of accounted paths, and the inventory's own `count`
// must equal its list.
//
// FINDABILITY counts the `.md` files under the hub, outside `<hub>/80 Runs`, that no index reaches
// by links. Links followed are Markdown links and wikilinks, through any reachable note. Code spans
// and fenced blocks hold no links. DEFAULT INDEX ROOTS are the hub's entry and generated surfaces
// named in the vault standard: `00 Home.md`, `README.md`, `10 Design/INDEX.md`,
// `20 Decisions/REGISTER.md`, `98 System/TRIAGE.md`, and the generated record indexes
// `98 System/Records/*.md`. A default root that does not exist is skipped, and a hub with none
// fails closed. `--index` replaces the defaults: a repo-relative file, a glob, or a folder, and a
// spec that matches no note fails closed.
//
// deferred(a bare wikilink to an absent note names no archive path, the file name alone is
// ambiguous, so write the path or a Markdown link in the archive note).
// deferred(a bare wikilink that matches two notes reaches both, Obsidian picks one; the broken-link
// gate flags the ambiguity).
//
// Read-only on the tree. Exit: 0 = pass; 1 = loss, ambiguity, count mismatch, or an unreachable
// note; 2 = usage error or an unreadable input.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix as pathPosix, relative, resolve } from 'node:path';
import { die, parseOrDie } from './cli-lib.mjs';
import { pathMatchesGlob } from './context-index-lib.mjs';
import { extractCitations, forwardingErrors, forwardPath, maskCodeSpans, maskMarkdownFenceAndIndentBlocks, posix } from './record-lib.mjs';

const USAGE = [
  'usage: distill-check.mjs inventory   --hub <hub dir> --out <file.json> [--root <repo>] [--json]',
  '       distill-check.mjs no-loss     --inventory <file.json> [--hub <hub dir>] [--root <repo>] [--json]',
  '       distill-check.mjs findability --hub <hub dir> [--index <file or glob>]... [--root <repo>] [--json]',
];
const INVENTORY_VERSION = 1;
const RUNS_FOLDER = '80 Runs';
const ARCHIVE_FOLDER = '99 Archive';
const FORWARDING_PATH = '98 System/FORWARDING.json';
const DEFAULT_INDEXES = ['00 Home.md', 'README.md', '10 Design/INDEX.md', '20 Decisions/REGISTER.md', '98 System/TRIAGE.md', '98 System/Records/*.md'];
const MARKDOWN_EXT = /\.md$/i;
const EXTERNAL_LINK = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const ESCAPES_ROOT = /^\.\.(?:[\\/]|$)/;
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---- paths and files ----

// The repo-relative forward-slash path for a flag value, which is relative to `root` or absolute
// and may hold glob characters. A value outside the root exits 2.
function repoPath(root, value) {
  const rel = relative(root, resolve(root, value));
  if (rel === '' || ESCAPES_ROOT.test(rel)) die(`${value} is not a path below the repository root ${root}`, 2);
  return posix(rel);
}

function hubPath(root, value) {
  const hub = repoPath(root, value);
  try { if (statSync(join(root, hub)).isDirectory()) return hub; } catch { /* reported below */ }
  return die(`hub ${hub} is not a directory in ${root}`, 2);
}

// Every file below `base`, sorted by path. A symlink is a file and is never followed. An unreadable
// folder stops the run, because a silent skip would hide a loss.
function listFiles(root, base, { skipFolder = null, skipFile = null } = {}) {
  const out = []; const stack = [base];
  while (stack.length) {
    const folder = stack.pop();
    let entries;
    try { entries = readdirSync(join(root, folder), { withFileTypes: true }); } catch (error) { die(`cannot read ${folder}: ${error.message}`, 2); }
    for (const entry of entries) {
      const path = posix(`${folder}/${entry.name}`);
      if (entry.isDirectory()) { if (path !== skipFolder) stack.push(path); } else if (path !== skipFile) out.push({ path, size: lstatSync(join(root, path)).size });
    }
  }
  return out.sort((a, b) => byCodeUnit(a.path, b.path));
}

// A file-exists probe that matches case exactly on every segment, so a case-insensitive filesystem
// cannot make a moved path look present. It lists each folder once.
function fileProbe(root) {
  const folders = new Map();
  const names = (folder) => {
    if (!folders.has(folder)) {
      const entries = new Map();
      try { for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) entries.set(entry.name.normalize('NFC'), entry.isDirectory()); } catch { /* an absent folder lists nothing */ }
      folders.set(folder, entries);
    }
    return folders.get(folder);
  };
  return (path) => {
    const segments = path.split('/'); let folder = '.';
    for (const [index, segment] of segments.entries()) {
      const isFolder = names(folder).get(segment);
      if (isFolder === undefined) return false;
      if (index === segments.length - 1) return !isFolder;
      if (!isFolder) return false;
      folder = folder === '.' ? segment : `${folder}/${segment}`;
    }
    return false;
  };
}

function loadForwarding(root, hub) {
  const path = `${hub}/${FORWARDING_PATH}`;
  const file = join(root, path);
  if (!existsSync(file)) return { version: 1, forwards: [] };
  let document;
  try { document = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { die(`cannot parse ${path}: ${error.message}`, 2); }
  const problems = forwardingErrors(document);
  if (problems.length) die(`${path} is invalid: ${problems.join('; ')}`, 2);
  return document;
}

// ---- links ----

// The repo-relative path a Markdown link names, or null for an external link, a bare fragment, or
// a link that leaves the repository.
function markdownTarget(raw, source, hub) {
  if (EXTERNAL_LINK.test(raw)) return null;
  const bare = raw.split('#', 1)[0].split('?', 1)[0];
  if (!bare) return null;
  let decoded;
  try { decoded = decodeURIComponent(bare); } catch { return null; }
  const out = pathPosix.normalize(decoded.startsWith('/') ? `${hub}${decoded}` : `${pathPosix.dirname(source)}/${decoded}`);
  return ESCAPES_ROOT.test(out) ? null : out.normalize('NFC');
}

// The paths a wikilink names. A name with a slash is a hub path. A bare name matches every note
// with that file name, as the broken-link gate does.
function wikilinkTargets(raw, hub, wikiIndex) {
  const note = raw.split('|', 1)[0].split('#', 1)[0].trim();
  if (!note) return [];
  const name = MARKDOWN_EXT.test(note) ? note : `${note}.md`;
  return name.includes('/') ? [pathPosix.normalize(`${hub}/${name}`).normalize('NFC')] : (wikiIndex.get(name.toLowerCase()) ?? []);
}

function linksIn(text, source, hub, wikiIndex) {
  const targets = extractCitations(text, source).map((citation) => markdownTarget(citation.rawTarget, source, hub));
  const masked = maskCodeSpans(maskMarkdownFenceAndIndentBlocks(text, source).maskedText);
  for (const match of masked.matchAll(/\[\[([^\]\n]+)\]\]/g)) targets.push(...wikilinkTargets(match[1], hub, wikiIndex));
  return targets.filter((target) => target !== null);
}

const readNote = (root, path) => readFileSync(join(root, path), 'utf8');

// ---- inventory ----

function commandInventory(flags) {
  const root = resolve(flags.root);
  const hub = hubPath(root, flags.hub);
  const out = resolve(flags.out);
  const outRel = relative(root, out);
  const outInside = !ESCAPES_ROOT.test(outRel) && !isAbsolute(outRel);
  const files = listFiles(root, hub, { skipFile: outInside ? posix(outRel) : null });
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const document = { version: INVENTORY_VERSION, hub, count: files.length, totalBytes, files };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`);
  if (flags.json) console.log(JSON.stringify({ ok: true, hub, count: files.length, totalBytes, out }));
  else console.log(`distill inventory: ${files.length} file(s), ${totalBytes} byte(s) under ${hub} -> ${out}`);
}

// ---- no-loss ----

function readInventory(file) {
  let document;
  try { document = JSON.parse(readFileSync(resolve(file), 'utf8')); } catch (error) { die(`cannot read inventory ${file}: ${error.message}`, 2); }
  const fileOk = (entry) => entry && typeof entry.path === 'string' && entry.path.length > 0 && !entry.path.startsWith('/') && !/^[A-Za-z]:|\\|(?:^|\/)\.\.(?:\/|$)/.test(entry.path)
    && Number.isInteger(entry.size) && entry.size >= 0;
  if (!document || document.version !== INVENTORY_VERSION || typeof document.hub !== 'string' || !Number.isInteger(document.count) || !Array.isArray(document.files) || !document.files.every(fileOk)) {
    die(`${file} is not a version ${INVENTORY_VERSION} distill inventory`, 2);
  }
  return document;
}

// Every path an archive note links to, resolved against the repository root.
function archiveLinks(root, hub, wikiIndex) {
  const named = new Set();
  const folder = `${hub}/${ARCHIVE_FOLDER}`;
  if (!existsSync(join(root, folder))) return named;
  const notes = listFiles(root, folder).filter((file) => MARKDOWN_EXT.test(file.path));
  for (const { path } of notes) for (const target of linksIn(readNote(root, path), path, hub, wikiIndex)) named.add(target);
  return named;
}

function commandNoLoss(flags) {
  const root = resolve(flags.root);
  const inventory = readInventory(flags.inventory);
  const hub = hubPath(root, flags.hub ?? inventory.hub);
  const present = fileProbe(root);
  const forwarding = loadForwarding(root, hub);
  let named = null; // The archive scan runs once, and only when a path needs it.
  const archiveNames = () => named ?? (named = archiveLinks(root, hub, new Map()));
  const forwardedTo = (path) => {
    try { return forwardPath(forwarding, path); } catch (error) { return die(`${hub}/${FORWARDING_PATH}: ${error.message}`, 2); }
  };

  const counts = { 'in-place': 0, moved: 0, archived: 0 };
  const lost = []; const ambiguous = []; const problems = [];
  const seen = new Set();
  for (const { path } of inventory.files) {
    if (seen.has(path)) { problems.push(`the inventory lists ${path} more than once`); continue; }
    seen.add(path);
    const here = present(path);
    const states = [];
    if (here) states.push('in-place');
    const moved = forwardedTo(path);
    if (moved !== null && present(moved)) states.push('moved');
    if (!here && archiveNames().has(path)) states.push('archived');
    if (states.length === 0) lost.push(path);
    else if (states.length > 1) ambiguous.push({ path, states });
    else counts[states[0]]++;
  }
  const inputs = inventory.files.length;
  const accounted = counts['in-place'] + counts.moved + counts.archived;
  if (inventory.count !== inputs) problems.push(`the inventory declares ${inventory.count} file(s) and lists ${inputs}`);
  if (inputs !== accounted) problems.push(`inputs ${inputs} differ from accounted ${accounted}`);
  const ok = !lost.length && !ambiguous.length && !problems.length;

  if (flags.json) console.log(JSON.stringify({ ok, hub, inputs, accounted, counts, lost, ambiguous, problems }));
  else {
    console.log(`distill no-loss: inputs ${inputs} ${inputs === accounted ? '=' : '!='} accounted ${accounted}`);
    for (const [state, count] of Object.entries(counts)) console.log(`  ${state}: ${count}`);
    console.log(`  lost: ${lost.length}`);
    console.log(`  ambiguous: ${ambiguous.length}`);
    for (const path of lost) console.log(`LOSS ${path}`);
    for (const { path, states } of ambiguous) console.log(`AMBIGUOUS ${path} (${states.join(', ')})`);
    for (const problem of problems) console.log(`MISMATCH ${problem}`);
    console.log(ok ? 'ok no path is lost' : `x ${lost.length} lost, ${ambiguous.length} ambiguous, ${problems.length} count problem(s)`);
  }
  return ok ? 0 : 1;
}

// ---- findability ----

function commandFindability(flags) {
  const root = resolve(flags.root);
  const hub = hubPath(root, flags.hub);
  const notes = listFiles(root, hub, { skipFolder: `${hub}/${RUNS_FOLDER}` }).map((file) => file.path).filter((path) => MARKDOWN_EXT.test(path));
  const known = new Set(notes);
  const wikiIndex = new Map();
  for (const path of notes) {
    const key = pathPosix.basename(path).toLowerCase();
    wikiIndex.set(key, [...(wikiIndex.get(key) ?? []), path]);
  }

  const specs = flags.index.length ? flags.index.map((spec) => repoPath(root, spec)) : DEFAULT_INDEXES.map((spec) => `${hub}/${spec}`);
  const seeds = new Set();
  for (const spec of specs) {
    const matched = notes.filter((path) => pathMatchesGlob(spec, path));
    if (!matched.length && flags.index.length) die(`--index ${spec} matches no Markdown note under ${hub} outside ${RUNS_FOLDER}`, 2);
    for (const path of matched) seeds.add(path);
  }
  if (!seeds.size) die(`no index root exists under ${hub}; pass --index`, 2);

  const reached = new Set(seeds); const queue = [...seeds];
  while (queue.length) {
    const path = queue.pop();
    for (const target of linksIn(readNote(root, path), path, hub, wikiIndex)) {
      if (known.has(target) && !reached.has(target)) { reached.add(target); queue.push(target); }
    }
  }
  const unreachable = notes.filter((path) => !reached.has(path));
  const result = { ok: unreachable.length === 0, hub, notes: notes.length, indexRoots: [...seeds].sort(byCodeUnit), reachable: reached.size, unreachable: unreachable.length, unreachablePaths: unreachable };

  if (flags.json) console.log(JSON.stringify(result));
  else {
    console.log(`distill findability: ${result.notes} note(s) outside ${RUNS_FOLDER}, ${result.reachable} reachable from ${seeds.size} index root(s), ${result.unreachable} unreachable`);
    for (const path of unreachable) console.log(`UNREACHABLE ${path}`);
    console.log(result.ok ? 'ok every note is reachable' : `x ${result.unreachable} note(s) no index reaches`);
  }
  return result.ok ? 0 : 1;
}

// ---- entry ----

const [sub, ...rest] = process.argv.slice(2);
const common = { root: { value: true, default: '.' }, json: { value: false } };
const specs = {
  inventory: { ...common, hub: { value: true, required: true }, out: { value: true, required: true } },
  'no-loss': { ...common, inventory: { value: true, required: true }, hub: { value: true } },
  findability: { ...common, hub: { value: true, required: true }, index: { value: true, many: true } },
};
if (sub === '--help' || sub === '-h') { console.log(USAGE.join('\n')); process.exit(0); }
if (!Object.hasOwn(specs, sub ?? '')) { for (const line of USAGE) console.error(line); process.exit(2); }
const { flags } = parseOrDie(rest, specs[sub], USAGE.join('\n'));
// The exit code is set, not forced, so a piped report is never cut short.
if (sub === 'inventory') commandInventory(flags);
else process.exitCode = sub === 'no-loss' ? commandNoLoss(flags) : commandFindability(flags);
