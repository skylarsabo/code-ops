// Shared lookups for two hook behaviours that guard the documentation hub's history.
//
//   legacyDenial  PreToolUse, hooks/dispatch-guard.mjs behaviour 6: names the denial for an edit
//                 whose target lies under a `removed` legacy path of the manifest.
//   readNotices   PostToolUse, hooks/handoff-card.mjs: names the current rule for a Read, Grep,
//                 or shell command that opens a record whose status is not `in-force`.
//
// Both run on the most frequent tool events, so this file imports only node:fs and node:path,
// spawns nothing, reads at most MAX_BYTES per file, and returns null or [] on any error (fail
// open). Callers pre-filter on the tool name before they import it. The hub is the one top-level
// directory that holds `98 System/DOCS_MANIFEST.json`; a repository whose hub is nested deeper,
// or that has two, gets no result. The tracked-file lookup in promotion-lib.mjs `hubOf` would
// find it, at the cost of a git spawn.
// deferred(top-level hub only; walk one level deeper if an adopting repository nests its hub)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 256 * 1024;
const MAX_NOTICES = 3;
const MAX_HOPS = 8;
const SYSTEM = '98 System';
const FOLD = process.platform === 'win32' || process.platform === 'darwin';
const KEYS = ['file_path', 'filePath', 'notebook_path', 'path', 'target_file', 'absolute_path', 'file'];
const PATCH_KEYS = ['patch', 'input', 'patchText', 'command'];
const PATCH_TARGET = /^\*\*\* (?:(?:Add|Update) File|Move to): (.+)$/gm;
// A record that states a rule. Evidence, reports, and summaries are `historical` by default and
// carry no rule to warn about.
const RULE_KINDS = new Set(['decision', 'amendment']);
const STALE = /"status":\s*"(?:amended|superseded|historical)"/;

const posix = (value) => String(value).replace(/\\/g, '/');
const fold = (value) => (FOLD ? value.toLowerCase() : value);
const clean = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);
const under = (path, base) => {
  const a = fold(path);
  const b = fold(posix(base)).replace(/\/+$/, '');
  return b !== '' && (a === b || a.startsWith(`${b}/`));
};

function readBounded(path) {
  try { return statSync(path).size > MAX_BYTES ? null : readFileSync(path, 'utf8'); } catch { return null; }
}

function repoRoot(cwd) {
  let dir = resolve(typeof cwd === 'string' && cwd ? cwd : process.cwd());
  for (let hop = 0; hop < 16; hop++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

// The one top-level directory that holds the documentation manifest, or null for none or several.
function hubOf(root) {
  let hubs = [];
  try {
    hubs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name[0] !== '.' && entry.name !== 'node_modules'
        && existsSync(join(root, entry.name, SYSTEM, 'DOCS_MANIFEST.json')))
      .map((entry) => entry.name);
  } catch { return null; }
  return hubs.length === 1 ? hubs[0] : null;
}

// A tool-supplied path as a repository-relative posix path, or null when it lies outside.
function repoRel(root, cwd, file) {
  if (typeof file !== 'string' || !file.trim() || file.length > 4096) return null;
  const rel = posix(relative(root, resolve(typeof cwd === 'string' && cwd ? cwd : root, file.trim())));
  return rel && rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel) && !/^[A-Za-z]:/.test(rel) ? rel : null;
}

const inputOf = (input) => (input && typeof input === 'object' ? input : {});
const firstString = (input, keys) => keys.map((key) => input[key]).find((value) => typeof value === 'string' && value.trim());

// The file paths an edit tool call names. A patch body names its own targets.
function editTargets(input) {
  const direct = firstString(input, KEYS);
  if (direct) return [direct];
  const patch = firstString(input, PATCH_KEYS);
  if (typeof patch !== 'string') return [];
  return [...patch.slice(0, MAX_TEXT).matchAll(PATCH_TARGET)].map((match) => match[1].trim());
}

// The text a read-side tool call names: a path for Read and Grep, a command for a shell tool.
const commandOf = (input) => {
  const value = input.command ?? input.cmd;
  return Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
};

function forwardsOf(root, hub) {
  const text = readBounded(join(root, hub, SYSTEM, 'FORWARDING.json'));
  if (!text) return [];
  try {
    const document = JSON.parse(text);
    return document?.version === 1 && Array.isArray(document.forwards)
      ? document.forwards.filter((entry) => typeof entry?.from === 'string' && typeof entry.to === 'string' && entry.from) : [];
  } catch { return []; }
}

// The path after every FORWARDING.json hop, or null when no entry maps it.
function forwarded(path, forwards) {
  let current = path;
  const seen = new Set();
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const entry = forwards.find((candidate) => under(current, candidate.from));
    if (!entry || seen.has(entry.from)) break;
    seen.add(entry.from);
    current = `${posix(entry.to).replace(/\/+$/, '')}${current.slice(posix(entry.from).replace(/\/+$/, '').length)}`;
  }
  return current === path ? null : current;
}

// The denial text for an edit under a removed legacy path, or null when the call is allowed.
export function legacyDenial(cwd, input) {
  try {
    const files = editTargets(inputOf(input));
    if (!files.length) return null;
    const root = repoRoot(cwd);
    const hub = root && hubOf(root);
    if (!hub) return null;
    const text = readBounded(join(root, hub, SYSTEM, 'DOCS_MANIFEST.json'));
    // The manifest almost never lists a removed root, so the common case skips the parse.
    if (!text || !text.includes('"removed"')) return null;
    const manifest = JSON.parse(text);
    if (manifest?.version !== 3 || !Array.isArray(manifest.legacyPaths)) return null;
    const removed = manifest.legacyPaths.filter((entry) => entry?.disposition === 'removed' && typeof entry.path === 'string' && entry.path);
    if (!removed.length) return null;
    for (const file of files) {
      const rel = repoRel(root, cwd, file);
      const hit = rel && removed.find((entry) => under(rel, entry.path));
      if (!hit) continue;
      const moved = forwarded(rel, forwardsOf(root, hub));
      return `Legacy path guard: ${clean(rel)} is under ${clean(hit.path)}, a root the documentation manifest lists as removed. `
        + (moved ? `Write it at ${clean(moved)} instead.`
          : `${hub}/${SYSTEM}/FORWARDING.json maps no new location for it; read the current path from the documentation manifest.`);
    }
  } catch { /* fail open */ }
  return null;
}

// The replacing records: other records that share the decision key and still stand.
function replacements(records, record) {
  const ids = records
    .filter((other) => other !== record && typeof other?.id === 'string' && other.key && other.key === record.key
      && (other.status === 'in-force' || other.status === 'amended'))
    .map((other) => clean(other.id)).sort();
  return ids.length > MAX_NOTICES ? `${ids.slice(0, MAX_NOTICES).join(', ')} and ${ids.length - MAX_NOTICES} more` : ids.join(', ');
}

// One context line for each opened record that is not in force, at most MAX_NOTICES. `input` is
// a Read or Grep call's arguments, or a shell call's; a path it cannot extract earns nothing.
export function readNotices(cwd, input, shell) {
  try {
    const args = inputOf(input);
    const command = shell ? commandOf(args) : '';
    const target = shell ? null : firstString(args, KEYS);
    if (!command && !target) return [];
    const root = repoRoot(cwd);
    const hub = root && hubOf(root);
    if (!hub) return [];
    const text = readBounded(join(root, hub, SYSTEM, 'Records', 'state.json'));
    if (!text || !STALE.test(text)) return [];
    const records = JSON.parse(text)?.records;
    if (!Array.isArray(records)) return [];
    const opened = target ? repoRel(root, cwd, target) : null;
    const haystack = command ? fold(posix(command)) : null;
    const lines = [];
    for (const record of records) {
      if (lines.length >= MAX_NOTICES) break;
      if (!record || typeof record.path !== 'string' || !record.path || typeof record.status !== 'string'
        || record.status === 'in-force' || !RULE_KINDS.has(record.kind)) continue;
      const hit = haystack !== null ? haystack.includes(fold(posix(record.path))) : opened !== null && fold(opened) === fold(posix(record.path));
      if (!hit) continue;
      const by = replacements(records, record);
      lines.push(`History read notice: ${clean(record.id)} (${clean(record.path)}) is ${clean(record.status)}. `
        + (by ? `${record.status === 'amended' ? 'Amended by' : 'Replaced by'} ${by}. ` : 'No replacing record is listed. ')
        + `The current rules are in ${hub}/20 Decisions/REGISTER.md.`);
    }
    return lines;
  } catch { return []; }
}
