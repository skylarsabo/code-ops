#!/usr/bin/env node
// The deterministic no-loss check and findability count for a distill run (design "Agent state
// machine and host parity", section "Distill", paragraph "No-loss guarantee"). `co docs distill`
// reaches it.
//
//   node scripts/distill-check.mjs inventory   --hub <hub dir> --out <file.json> [--root <repo>] [--json]
//   node scripts/distill-check.mjs no-loss     --inventory <file.json> [--hub <hub dir>] [--root <repo>] [--json]
//   node scripts/distill-check.mjs findability --hub <hub dir> [--index <file or glob>]... [--root <repo>] [--json]
//   node scripts/distill-check.mjs state <verb> [<phase>] --state <file.json> [flags]   (see STATE below)
//
// WHY: a model review cannot prove that a distill run lost nothing. This script can. Phase 1 lists
// every file under the hub. Every phase that moves or archives files, and every maintain pass, asks
// where each listed path went.
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
// STATE records the vault-mode run (design "Distill", paragraph "Phases as states"). The state file
// holds the eight phases, each pending, running, checkpointed, or done, with its artifact paths and
// the input inventories, so a compaction or a handoff resumes from the last checkpointed phase. It
// holds no date, so one run of verbs yields the same bytes.
//   init        --hub <dir> --inventory <file>...      create the file; it refuses to overwrite one
//   show        [--json]                               print every phase and the next step
//   start N                                            pending -> running; phase N-1 must be done
//   checkpoint N --artifact <file>...                  running -> checkpointed; each artifact exists
//   done N      --review <note> [--require-findable]   checkpointed -> done, after the lead's review
//   reopen N                                           checkpointed -> running, when the review fails
//   plan N      --paths <file> [--size 25]             split a phase 3 or 7 worklist into batches
//   assign N    --batch <id> --worker <name>           a worker never takes the same batch twice
//   result N    --batch <id> --defects <n>             one defect in the 10% sample sends the batch to full review
//   review N    --batch <id>                           the lead read a full-review batch whole
// Any other transition exits 1. Phase 8 (install) is not built, so `start 8` exits 1. `done` of a
// phase that moves or archives files (2 and 5) runs no-loss over every inventory and refuses on a
// loss. It also runs findability and records the count, and `--require-findable` refuses on a
// nonzero count. `done` of a batched phase (3 and 7) refuses while a batch is unresolved.
//
// Read-only on the tree. The inventory and state verbs write only their own file. Exit: 0 = pass;
// 1 = loss, ambiguity, count mismatch, an unreachable note, or a refused transition; 2 = usage error
// or an unreadable input.

import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix as pathPosix, relative, resolve } from 'node:path';
import { die, parseOrDie } from './cli-lib.mjs';
import { pathMatchesGlob } from './context-index-lib.mjs';
import { extractCitations, forwardingErrors, forwardPath, maskCodeSpans, maskMarkdownFenceAndIndentBlocks, posix } from './record-lib.mjs';

const USAGE = [
  'usage: distill-check.mjs inventory   --hub <hub dir> --out <file.json> [--root <repo>] [--json]',
  '       distill-check.mjs no-loss     --inventory <file.json> [--hub <hub dir>] [--root <repo>] [--json]',
  '       distill-check.mjs findability --hub <hub dir> [--index <file or glob>]... [--root <repo>] [--json]',
  '       distill-check.mjs state <init|show|start|checkpoint|done|reopen|plan|assign|result|review> [phase] --state <file.json> [flags]',
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

function noLossReport(root, inventory, hub) {
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
  return { ok, hub, inputs, accounted, counts, lost, ambiguous, problems };
}

function commandNoLoss(flags) {
  const root = resolve(flags.root);
  const inventory = readInventory(flags.inventory);
  const hub = hubPath(root, flags.hub ?? inventory.hub);
  const report = noLossReport(root, inventory, hub);
  const { ok, inputs, accounted, counts, lost, ambiguous, problems } = report;
  if (flags.json) console.log(JSON.stringify(report));
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

// The findability result, or { error } when no index root or --index spec matches a note.
function findabilityReport(root, hub, index) {
  const notes = listFiles(root, hub, { skipFolder: `${hub}/${RUNS_FOLDER}` }).map((file) => file.path).filter((path) => MARKDOWN_EXT.test(path));
  const known = new Set(notes);
  const wikiIndex = new Map();
  for (const path of notes) {
    const key = pathPosix.basename(path).toLowerCase();
    wikiIndex.set(key, [...(wikiIndex.get(key) ?? []), path]);
  }

  const specs = index.length ? index.map((spec) => repoPath(root, spec)) : DEFAULT_INDEXES.map((spec) => `${hub}/${spec}`);
  const seeds = new Set();
  for (const spec of specs) {
    const matched = notes.filter((path) => pathMatchesGlob(spec, path));
    if (!matched.length && index.length) return { error: `--index ${spec} matches no Markdown note under ${hub} outside ${RUNS_FOLDER}` };
    for (const path of matched) seeds.add(path);
  }
  if (!seeds.size) return { error: `no index root exists under ${hub}; pass --index` };

  const reached = new Set(seeds); const queue = [...seeds];
  while (queue.length) {
    const path = queue.pop();
    for (const target of linksIn(readNote(root, path), path, hub, wikiIndex)) {
      if (known.has(target) && !reached.has(target)) { reached.add(target); queue.push(target); }
    }
  }
  const unreachable = notes.filter((path) => !reached.has(path));
  return { ok: unreachable.length === 0, hub, notes: notes.length, indexRoots: [...seeds].sort(byCodeUnit), reachable: reached.size, unreachable: unreachable.length, unreachablePaths: unreachable };
}

function commandFindability(flags) {
  const root = resolve(flags.root);
  const hub = hubPath(root, flags.hub);
  const result = findabilityReport(root, hub, flags.index);
  if (result.error) die(result.error, 2);
  const unreachable = result.unreachablePaths;

  if (flags.json) console.log(JSON.stringify(result));
  else {
    console.log(`distill findability: ${result.notes} note(s) outside ${RUNS_FOLDER}, ${result.reachable} reachable from ${result.indexRoots.length} index root(s), ${result.unreachable} unreachable`);
    for (const path of unreachable) console.log(`UNREACHABLE ${path}`);
    console.log(result.ok ? 'ok every note is reachable' : `x ${result.unreachable} note(s) no index reaches`);
  }
  return result.ok ? 0 : 1;
}

// ---- state ----

const PHASES = ['inventory', 'relocate', 'classify', 'chain', 'drafts', 'ledgers', 'synthesis', 'install'];
const STATUSES = ['pending', 'running', 'checkpointed', 'done'];
const STATE_VERSION = 1;
const NOT_BUILT = new Set([8]); // deferred(phase 8 ships in the install PR, which empties this set)
const MOVING = new Set([2, 5]); // relocate and drafts move or archive files, so their end runs the checks
const BATCHED = new Set([3, 7]); // classify and synthesis fan out in batches
const BATCH_SIZE = 25;
const SAMPLE_RATE = 0.1;
const STATE_VERBS = ['init', 'show', 'start', 'checkpoint', 'done', 'reopen', 'plan', 'assign', 'result', 'review'];
const NEXT_ACTION = { pending: 'start', running: 'checkpoint', checkpointed: 'done' };

const refuse = (message) => die(message, 1);

function phaseArg(value) {
  const phase = Number(value);
  return Number.isInteger(phase) && phase >= 1 && phase <= PHASES.length ? phase : die(`a phase is a number from 1 to ${PHASES.length}`, 2);
}

function readState(file) {
  let doc;
  try { doc = JSON.parse(readFileSync(resolve(file), 'utf8')); } catch (error) { die(`cannot read state ${file}: ${error.message}`, 2); }
  const ok = doc && doc.version === STATE_VERSION && typeof doc.hub === 'string' && Array.isArray(doc.inventories) && Array.isArray(doc.phases)
    && doc.phases.length === PHASES.length && doc.phases.every((p, i) => p && p.phase === i + 1 && p.name === PHASES[i] && STATUSES.includes(p.status) && Array.isArray(p.artifacts)
      && (BATCHED.has(i + 1) === Array.isArray(p.batches)));
  return ok ? doc : die(`${file} is not a version ${STATE_VERSION} distill state`, 2);
}

const writeState = (file, doc) => writeFileSync(resolve(file), `${JSON.stringify(doc, null, 2)}\n`);

// The step that resumes the run: the first phase that is not done.
function nextStep(doc) {
  const phase = doc.phases.find((p) => p.status !== 'done');
  if (!phase) return null;
  if (NOT_BUILT.has(phase.phase)) return { phase: phase.phase, action: 'stop', note: `phase ${phase.phase} (${phase.name}) is not built` };
  return { phase: phase.phase, action: NEXT_ACTION[phase.status] };
}

const batchCounts = (batches) => batches.reduce((out, b) => ({ ...out, [b.status]: (out[b.status] ?? 0) + 1 }), {});

function stateShow(flags, doc) {
  const next = nextStep(doc);
  const last = [...doc.phases].reverse().find((p) => p.status === 'checkpointed' || p.status === 'done');
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, hub: doc.hub, inventories: doc.inventories, lastCheckpoint: last ? { phase: last.phase, status: last.status } : null, next, phases: doc.phases }));
    return 0;
  }
  console.log(`distill state: hub ${doc.hub}, ${doc.inventories.length} inventory file(s)`);
  for (const p of doc.phases) {
    const batches = p.batches?.length ? `, batches ${JSON.stringify(batchCounts(p.batches))}` : '';
    console.log(`  ${p.phase} ${p.name.padEnd(9)} ${p.status.padEnd(12)} ${p.artifacts.length} artifact(s)${batches}`);
  }
  console.log(next ? `next: ${next.action} ${next.phase}${next.note ? ` (${next.note})` : ''}` : 'next: none, every phase is done');
  return 0;
}

function stateInit(flags, root) {
  if (existsSync(resolve(flags.state))) return refuse(`${flags.state} exists; one run has one state file`);
  if (!flags.hub || !flags.inventory.length) die('state init needs --hub and at least one --inventory', 2);
  const hub = hubPath(root, flags.hub);
  const inventories = [...new Set(flags.inventory.map((spec) => repoPath(root, spec)))].sort(byCodeUnit);
  const phases = PHASES.map((name, index) => ({ phase: index + 1, name, status: 'pending', artifacts: [], review: null, checks: null, ...(BATCHED.has(index + 1) ? { batches: [] } : {}) }));
  mkdirSync(dirname(resolve(flags.state)), { recursive: true });
  writeState(flags.state, { version: STATE_VERSION, hub, inventories, phases });
  console.log(flags.json ? JSON.stringify({ ok: true, hub, inventories }) : `distill state: created ${flags.state}, ${PHASES.length} phase(s) pending`);
  return 0;
}

function startPhase(doc, n) {
  const phase = doc.phases[n - 1];
  if (NOT_BUILT.has(n)) refuse(`phase ${n} (${phase.name}) is not built; vault mode stops after phase 7`);
  if (phase.status !== 'pending') refuse(`phase ${n} is ${phase.status}, not pending`);
  if (n > 1 && doc.phases[n - 2].status !== 'done') refuse(`phase ${n} needs phase ${n - 1} done, and it is ${doc.phases[n - 2].status}`);
  phase.status = 'running';
}

function checkpointPhase(doc, root, n, flags) {
  const phase = doc.phases[n - 1];
  if (phase.status !== 'running') refuse(`phase ${n} is ${phase.status}; only a running phase checkpoints`);
  if (!flags.artifact.length) die('checkpoint needs at least one --artifact', 2);
  const artifacts = [...new Set(flags.artifact.map((spec) => repoPath(root, spec)))].sort(byCodeUnit);
  const present = fileProbe(root);
  for (const path of artifacts) if (!present(path)) refuse(`artifact ${path} is not a file`);
  if (n === 1) for (const path of doc.inventories) if (!present(path)) refuse(`phase 1 needs the inventory ${path}; run inventory first`);
  phase.artifacts = artifacts;
  phase.status = 'checkpointed';
}

// No-loss over every inventory, and the findability count. A loss stops the phase.
function endOfPhaseChecks(root, doc, requireFindable) {
  const total = { inputs: 0, accounted: 0, 'in-place': 0, moved: 0, archived: 0 };
  const problems = [];
  for (const path of doc.inventories) {
    const report = noLossReport(root, readInventory(join(root, path)), doc.hub);
    total.inputs += report.inputs; total.accounted += report.accounted;
    for (const state of ['in-place', 'moved', 'archived']) total[state] += report.counts[state];
    for (const item of report.lost) problems.push(`LOSS ${item}`);
    for (const item of report.ambiguous) problems.push(`AMBIGUOUS ${item.path} (${item.states.join(', ')})`);
    for (const item of report.problems) problems.push(`MISMATCH ${item}`);
  }
  if (problems.length) {
    for (const line of problems.slice(0, 50)) console.error(line);
    refuse(`no-loss fails: ${problems.length} problem(s)${problems.length > 50 ? ', first 50 shown' : ''}`);
  }
  const found = findabilityReport(root, doc.hub, []);
  const findability = found.error ? { error: found.error } : { notes: found.notes, unreachable: found.unreachable };
  if (requireFindable && (found.error || found.unreachable > 0)) {
    for (const path of found.unreachablePaths ?? []) console.error(`UNREACHABLE ${path}`);
    refuse(`findability fails: ${found.error ?? `${found.unreachable} unreachable note(s)`}`);
  }
  return { noLoss: total, findability };
}

function donePhase(doc, root, n, flags) {
  const phase = doc.phases[n - 1];
  if (phase.status !== 'checkpointed') refuse(`phase ${n} is ${phase.status}; only a checkpointed phase is done`);
  const review = (flags.review ?? '').trim();
  if (!review) die('done needs --review, the lead note on what was read', 2);
  if (BATCHED.has(n)) {
    const open = phase.batches.filter((b) => b.status !== 'clean' && b.status !== 'reviewed');
    if (!phase.batches.length) refuse(`phase ${n} has no batches; plan them before it is done`);
    if (open.length) refuse(`phase ${n} has ${open.length} unresolved batch(es): ${open.map((b) => `${b.id} ${b.status}`).join(', ')}`);
  }
  if (MOVING.has(n)) phase.checks = endOfPhaseChecks(root, doc, flags['require-findable']);
  phase.review = review;
  phase.status = 'done';
}

function reopenPhase(doc, n) {
  const phase = doc.phases[n - 1];
  if (phase.status !== 'checkpointed') refuse(`phase ${n} is ${phase.status}; only a checkpointed phase reopens`);
  phase.status = 'running'; phase.review = null;
}

// Every tenth path, spread across the batch, and at least one.
const sampleOf = (paths) => {
  const count = Math.max(1, Math.ceil(paths.length * SAMPLE_RATE));
  return Array.from({ length: count }, (_, i) => paths[Math.floor((i * paths.length) / count)]);
};

function batchedPhase(doc, n) {
  const phase = doc.phases[n - 1];
  if (!BATCHED.has(n)) refuse(`phase ${n} (${phase.name}) takes no batches; classify (3) and synthesis (7) do`);
  if (phase.status !== 'running') refuse(`phase ${n} is ${phase.status}, not running`);
  return phase;
}

function batchOf(phase, flags) {
  if (!flags.batch) die('this verb needs --batch', 2);
  return phase.batches.find((b) => b.id === flags.batch) ?? refuse(`no batch ${flags.batch}`);
}

function planBatches(doc, root, n, flags) {
  const phase = batchedPhase(doc, n);
  if (phase.batches.length) refuse(`phase ${n} already has batches; a plan is made once`);
  if (!flags.paths) die('plan needs --paths, a file with one repo-relative path per line', 2);
  const size = flags.size === undefined ? BATCH_SIZE : Number(flags.size);
  if (!Number.isInteger(size) || size < 1) die('--size is a whole number of at least 1', 2);
  let text;
  try { text = readFileSync(resolve(flags.paths), 'utf8'); } catch (error) { die(`cannot read ${flags.paths}: ${error.message}`, 2); }
  const paths = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => repoPath(root, line));
  if (!paths.length) die(`${flags.paths} lists no path`, 2);
  if (new Set(paths).size !== paths.length) refuse(`${flags.paths} lists a path twice`);
  const present = fileProbe(root);
  for (const path of paths) if (!present(path)) refuse(`${path} is not a file`);
  paths.sort(byCodeUnit);
  for (let at = 0; at < paths.length; at += size) {
    const chunk = paths.slice(at, at + size);
    phase.batches.push({ id: `B${String(phase.batches.length + 1).padStart(2, '0')}`, paths: chunk, sample: sampleOf(chunk), workers: [], status: 'planned', defects: null });
  }
}

function assignBatch(doc, n, flags) {
  const batch = batchOf(batchedPhase(doc, n), flags);
  if (!flags.worker) die('assign needs --worker', 2);
  if (batch.status !== 'planned' && batch.status !== 'full-review') refuse(`batch ${batch.id} is ${batch.status}; only a planned or full-review batch takes a worker`);
  if (batch.workers.includes(flags.worker)) refuse(`worker ${flags.worker} already classified batch ${batch.id}; a worker never classifies its own batch twice`);
  batch.workers.push(flags.worker);
  batch.status = 'assigned';
}

function resultBatch(doc, n, flags) {
  const batch = batchOf(batchedPhase(doc, n), flags);
  const defects = Number(flags.defects);
  if (flags.defects === undefined || !Number.isInteger(defects) || defects < 0) die('result needs --defects, the count of defects in the sample', 2);
  if (batch.status !== 'assigned') refuse(`batch ${batch.id} is ${batch.status}; only an assigned batch takes a sample result`);
  batch.defects = defects;
  batch.status = defects === 0 ? 'clean' : 'full-review';
}

function reviewBatch(doc, n, flags) {
  const batch = batchOf(batchedPhase(doc, n), flags);
  if (batch.status !== 'full-review') refuse(`batch ${batch.id} is ${batch.status}; only a full-review batch is read whole`);
  batch.status = 'reviewed';
}

function commandState(flags, positional) {
  const [verb, phaseText, ...extra] = positional;
  const phaseless = verb === 'init' || verb === 'show';
  if (!STATE_VERBS.includes(verb) || extra.length || phaseless === (phaseText !== undefined)) die(`usage: state <${STATE_VERBS.join('|')}> [phase] --state <file.json> [flags]`, 2);
  const root = resolve(flags.root);
  if (verb === 'init') return stateInit(flags, root);
  const doc = readState(flags.state);
  if (verb === 'show') return stateShow(flags, doc);
  const n = phaseArg(phaseText);
  if (verb === 'start') startPhase(doc, n);
  else if (verb === 'checkpoint') checkpointPhase(doc, root, n, flags);
  else if (verb === 'done') donePhase(doc, root, n, flags);
  else if (verb === 'reopen') reopenPhase(doc, n);
  else if (verb === 'plan') planBatches(doc, root, n, flags);
  else if (verb === 'assign') assignBatch(doc, n, flags);
  else if (verb === 'result') resultBatch(doc, n, flags);
  else reviewBatch(doc, n, flags);
  writeState(flags.state, doc);
  const phase = doc.phases[n - 1];
  console.log(flags.json ? JSON.stringify({ ok: true, verb, phase: n, name: phase.name, status: phase.status, next: nextStep(doc) }) : `distill state: ${verb} ${n} ${phase.name} -> ${phase.status}`);
  return 0;
}

// ---- entry ----

const [sub, ...rest] = process.argv.slice(2);
const common = { root: { value: true, default: '.' }, json: { value: false } };
const specs = {
  inventory: { ...common, hub: { value: true, required: true }, out: { value: true, required: true } },
  'no-loss': { ...common, inventory: { value: true, required: true }, hub: { value: true } },
  findability: { ...common, hub: { value: true, required: true }, index: { value: true, many: true } },
  state: {
    ...common, state: { value: true, required: true }, hub: { value: true }, inventory: { value: true, many: true }, artifact: { value: true, many: true },
    review: { value: true }, 'require-findable': { value: false }, paths: { value: true }, size: { value: true }, batch: { value: true }, worker: { value: true }, defects: { value: true },
  },
};
if (sub === '--help' || sub === '-h') { console.log(USAGE.join('\n')); process.exit(0); }
if (!Object.hasOwn(specs, sub ?? '')) { for (const line of USAGE) console.error(line); process.exit(2); }
const { flags, positional } = parseOrDie(rest, specs[sub], USAGE.join('\n'));
// The exit code is set, not forced, so a piped report is never cut short.
if (sub === 'inventory') commandInventory(flags);
else if (sub === 'state') process.exitCode = commandState(flags, positional);
else process.exitCode = sub === 'no-loss' ? commandNoLoss(flags) : commandFindability(flags);
