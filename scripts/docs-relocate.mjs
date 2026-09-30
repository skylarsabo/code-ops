#!/usr/bin/env node
// Relocate a legacy documentation tree into the vault (design "Program state handoffs and
// coordination", workstream W3). `co docs relocate` reaches it.
//
//   node scripts/docs-relocate.mjs plan    [--root <repo>] [--run <run dir>] [--legacy <root>]...
//   node scripts/docs-relocate.mjs apply   --plan <json> [--root <repo>] [--wave <legacy root>] [--at <iso>]
//   node scripts/docs-relocate.mjs forward [--root <repo>] [--base <ref>] [--plan <json>]
//
// WHY: a repository that adopts the vault still holds a legacy tree, and the tree cannot leave in
// one unreviewed move. Plan classifies every file so an operator reviews the routing. Apply moves
// one legacy root per wave, keeps every record chain intact, and forwards every old path. Forward
// repairs a branch that predates a wave.
//
// PLAN. A legacy root is a record collection root or a `legacyPaths` entry outside the hub, or a
// path named with --legacy. Each tracked file under a root becomes one row {source, target, kind,
// reason}. A collection moves whole to one target root, so every record keeps its relative path.
//   collection-rulings   20 Decisions/Records/<collection id>
//   collection-audit     99 Archive/Audit (a collection whose id or root names "audit")
//   live-register        99 Archive/Audit, flagged for promotion: an open program names it
//   domain-reference     the target folder of the manifest domain whose sources match the file
//   spec-current         10 Design/Specs (status current, or no status)
//   spec-archived        99 Archive/Specs (status superseded, archived, and the like)
//   machine-manifest     35 Contracts and Data/Manifests (data files)
//   attachment           95 Attachments (any other file)
//   legacy-pointer       a generated pointer or tombstone stub: apply git rm's it and forwards its
//                        path to the manifest target, because the canonical file already exists
// The plan also sorts every reference to a moved path as a runtime read (code opens the path) or
// prose. RELOCATION_PLAN.md and RELOCATION_PLAN.json land in the run folder, which defaults to
// `<hub>/80 Runs/<date> relocation-plan`. The JSON records the base HEAD.
//
// APPLY runs one wave, so one commit. It refuses a dirty tree, a base older than the plan, a plan
// that no longer matches the tracked files, and a reference it cannot map. Then it
//   1. moves the files with git mv;
//   2. sets the collection root in the manifest, and sets the legacy root to `removed`;
//   3. appends one relocate-root event per moved collection (`records.mjs relocate-root`);
//   4. adds the moves to `<hub>/98 System/FORWARDING.json`;
//   5. rewrites every reference in tracked, non-history files;
//   6. renders each moved collection's index, refreshes the register only where one already exists,
//      and re-stamps the manifest digests;
//   7. runs the docs gate.
// Apply never rewrites history: record bytes, `80 Runs`, `99 Archive`, `98 System/Records`, every
// PROGRAM.md, PROGRAM.archive.md, and HANDOFF.md. It never commits. It prints a commit message.
//
// deferred(one link form, a link parser): apply rewrites root-anchored paths only. A relative link
// such as `../audit/x.md` keeps its text, and the gate flags it if it still names a forwarded path.
// deferred(no dry run of a wave, a scratch worktree run): apply always changes the working tree.
//
// FORWARD runs on a branch that predates a wave. It moves each tracked file that sits under a
// forwarded path or a `removed` legacy root, routes it through FORWARDING.json and then through the plan, and rewrites the
// references in the files the branch changed since --base. A file with no route stops the step,
// names the file, and exits 1 before anything moves.
//
// Exit: 0 = done; 1 = refused, failed, or a missing route; 2 = usage error.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { die, parseOrDie } from './cli-lib.mjs';
import { pathMatchesGlob } from './context-index-lib.mjs';
import { forwardingErrors, forwardPath, safePath } from './record-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = [
  'usage: docs-relocate.mjs plan    [--root <repo>] [--run <run dir>] [--legacy <root>]...',
  '       docs-relocate.mjs apply   --plan <json> [--root <repo>] [--wave <legacy root>] [--at <iso>]',
  '       docs-relocate.mjs forward [--root <repo>] [--base <ref>] [--plan <json>]',
];
const MANIFEST_TAIL = '/98 System/DOCS_MANIFEST.json';
const PLAN_VERSION = 1;
const MAX_TEXT_BYTES = 2_000_000;
const DATA_EXT = /\.(?:json|jsonl|ya?ml|toml|csv)$/i;
const MARKDOWN_EXT = /\.md$/i;
const CODE_EXT = /\.(?:mjs|cjs|js|jsx|ts|tsx|py|sh|bash|ps1|psm1|rb|go|rs|java|cs|ya?ml|json|toml)$/i;
const CURRENT_STATUSES = new Set(['current', 'active', 'draft', 'accepted', 'proposed', 'open', 'in-progress']);
const ARCHIVED_STATUSES = new Set(['superseded', 'archived', 'historical', 'done', 'promoted', 'closed', 'rejected', 'obsolete', 'stale']);
const REGISTER_NAME = /(?:register|findings|backlog|tracker|triage)/i;
const HISTORY_FILE = /(?:^|\/)(?:PROGRAM|PROGRAM\.archive|HANDOFF)\.md$/;
const CLOSED_PROGRAM = /^[-*\t ]*Status:[^\S\r\n]*(?:merged into .+?|closed)\s*$/m;

const routingFor = (hub) => ({
  'collection-rulings': `${hub}/20 Decisions/Records`,
  'collection-audit': `${hub}/99 Archive/Audit`,
  'live-register': `${hub}/99 Archive/Audit`,
  'spec-current': `${hub}/10 Design/Specs`,
  'spec-archived': `${hub}/99 Archive/Specs`,
  'machine-manifest': `${hub}/35 Contracts and Data/Manifests`,
  attachment: `${hub}/95 Attachments`,
});

// ---- shared with the docs gate ----

// History keeps its old paths: record bytes, run scratch, archives, ledgers, and the files that
// hold the path map itself. `collectionRoots` are the manifest's current record roots.
export function isHistory(path, hub, collectionRoots) {
  const system = `${hub}/98 System/`;
  return HISTORY_FILE.test(path)
    || /(?:^|\/)80 Runs\//.test(path)
    || path.startsWith(`${hub}/99 Archive/`)
    || path.startsWith(`${system}Records/`)
    || path === `${system}FORWARDING.json` || path === `${system}DOCS_MANIFEST.json` || path === `${system}GATE_BASELINE.jsonl`
    || collectionRoots.some((root) => path.startsWith(`${root}/`));
}

// The text of a regular file that is safe to search and rewrite, or null. A symlink, a large file,
// a binary file, and a file that does not round-trip through UTF-8 all read as null.
export function readText(root, path) {
  const file = join(root, path);
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > MAX_TEXT_BYTES) return null;
    const bytes = readFileSync(file);
    if (bytes.subarray(0, 8000).includes(0)) return null;
    const text = bytes.toString('utf8');
    return Buffer.from(text, 'utf8').equals(bytes) ? text : null;
  } catch { return null; }
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every reference in `text` to a path under one of `roots`: {index, path}. A root matches at a path
// boundary only, so `docs/audit` never matches `docs/auditors` or `src/docs/audit`. The path runs
// on through the sub-path that follows the root.
export function findRefs(text, roots) {
  if (!roots.length) return [];
  const alternation = [...roots].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
  const pattern = new RegExp(`(?<![\\w.-])(?<![\\w-]/)(?:${alternation})(?![\\w-])(?!\\.\\w)(?:/[^\\s"'\`<>()\\[\\]{}|,;*?\\\\]*)?`, 'g');
  const bare = (path) => [...roots].filter((r) => path === r || path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
  return [...text.matchAll(pattern)].map((m) => ({ index: m.index, path: m[0].replace(/[.:!]+$/, '') }))
    // A one-word root such as `specs` is a reference only with a sub-path, or the word is prose.
    .filter(({ path }) => { const root = bare(path); return !root || path !== root || root.includes('/') || root.includes('.'); });
}

// ---- repository access ----

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
function gitOut(root, args) {
  const r = run('git', args, root);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.err.trim() || `exit ${r.status}`}`);
  return r.out;
}
const gitOk = (root, args) => run('git', args, root).status === 0;
const listTracked = (root) => gitOut(root, ['ls-files', '-z']).split('\0').filter(Boolean);
const nodeScript = (root, script, args) => run(process.execPath, [join(HERE, script), ...args, '--root', root], root);

function loadContext(root) {
  let tracked;
  try { tracked = listTracked(root); } catch { die(`${root} is not a git repository`, 2); }
  const manifests = tracked.filter((path) => path.endsWith(MANIFEST_TAIL));
  if (manifests.length !== 1) die(manifests.length ? `multiple documentation manifests found: ${manifests.join(', ')}` : `no tracked <hub>${MANIFEST_TAIL} in ${root}`, 2);
  const manifestRel = manifests[0];
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(root, manifestRel), 'utf8')); } catch (error) { die(`cannot parse ${manifestRel}: ${error.message}`, 2); }
  return { root, hub: manifestRel.slice(0, -MANIFEST_TAIL.length), manifestRel, manifest, tracked };
}
const collectionsOf = (ctx) => (Array.isArray(ctx.manifest.recordCollections) ? ctx.manifest.recordCollections : []).filter((c) => c && typeof c.root === 'string');
const collectionRoots = (ctx) => collectionsOf(ctx).map((c) => c.root);
const today = () => new Date().toISOString().slice(0, 10);
const writeLf = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const under = (path, root) => path === root || path.startsWith(`${root}/`);

// ---- plan ----

function frontmatterStatus(text) {
  const block = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
  const status = block && /^status:[ \t]*["']?([^"'\r\n]+?)["']?[ \t]*$/m.exec(block)?.[1];
  return status ? status.toLowerCase() : null;
}

// The legacy roots: --legacy paths when given, else every record collection root and every
// non-removed legacyPaths entry that sits outside the hub and still holds tracked files.
function deriveRoots(ctx, explicit) {
  const collections = collectionsOf(ctx);
  const entries = Array.isArray(ctx.manifest.legacyPaths) ? ctx.manifest.legacyPaths : [];
  const names = explicit.length
    ? explicit.map((name) => name.replace(/\\/g, '/').replace(/\/+$/, ''))
    : [...collections.map((c) => c.root), ...entries.filter((e) => e && e.disposition !== 'removed').map((e) => e.path)]
      .filter((path) => typeof path === 'string' && !path.startsWith(`${ctx.hub}/`));
  const roots = [];
  for (const root of [...new Set(names)].sort()) {
    if (!safePath(root)) die(`legacy root ${root} is not a safe repository-relative path`, 2);
    const files = ctx.tracked.filter((path) => under(path, root)).sort();
    if (!files.length) {
      if (explicit.length) die(`no tracked files under legacy root ${root}`, 2);
      continue;
    }
    const collection = collections.find((c) => c.root === root) ?? null;
    const clash = collections.find((c) => c !== collection && (under(c.root, root) || under(root, c.root)));
    if (clash) die(`legacy root ${root} overlaps record collection ${clash.id} at ${clash.root}; name the collection root`, 2);
    const nested = roots.find((r) => under(root, r.root) || under(r.root, root));
    if (nested) die(`legacy root ${root} overlaps legacy root ${nested.root}`, 2);
    roots.push({ root, collection, files });
  }
  return roots;
}

function openProgramText(ctx) {
  return ctx.tracked.filter((path) => /(?:^|\/)PROGRAM\.md$/.test(path)).map((path) => readText(ctx.root, path) ?? '')
    .filter((text) => !CLOSED_PROGRAM.test(text)).join('\n');
}

// One file's row fields for a tree root. `routing` maps a kind to its target folder, `rel` is the
// path below the legacy root, and `runtime` says code opens the file.
function routeTreeFile({ ctx, file, rel, text, routing, programs, runtime }) {
  const domains = Array.isArray(ctx.manifest.domains) ? ctx.manifest.domains : [];
  const at = (kind, folder, reason, extra = {}) => ({ kind, target: `${folder}/${rel}`, reason, ...extra });
  const runtimeRead = runtime ? { runtimeRead: true } : {};
  if (!MARKDOWN_EXT.test(file)) {
    return DATA_EXT.test(file)
      ? at('machine-manifest', routing['machine-manifest'], 'A data file that code or tooling may read.', runtimeRead)
      : at('attachment', routing.attachment, 'Not Markdown and not a data file.', runtimeRead);
  }
  if (REGISTER_NAME.test(basename(file)) && programs.includes(file)) {
    return at('live-register', routing['live-register'], 'An open program names this register as scope. Promote it.', { promote: true, ...runtimeRead });
  }
  const owners = domains.filter((d) => Array.isArray(d.sources) && d.sources.some((p) => typeof p === 'string' && pathMatchesGlob(p, file)));
  if (owners.length) {
    const path = owners[0].path;
    const folder = MARKDOWN_EXT.test(path) ? dirname(path) : path;
    return at('domain-reference', folder === '.' ? ctx.hub : `${ctx.hub}/${folder}`, `Manifest domain ${owners.map((d) => d.id).join(', ')} owns this file through its sources.`, runtimeRead);
  }
  const status = frontmatterStatus(text ?? '');
  if (status && ARCHIVED_STATUSES.has(status)) return at('spec-archived', routing['spec-archived'], `Status ${status}, so history.`, runtimeRead);
  const why = status && CURRENT_STATUSES.has(status) ? `Status ${status}.` : status ? `Unknown status ${status}; treated as current.` : 'No status frontmatter; treated as current.';
  return at('spec-current', routing['spec-current'], why, runtimeRead);
}

function buildRows(ctx, roots, routing) {
  const programs = openProgramText(ctx);
  const stubs = (Array.isArray(ctx.manifest.legacyPaths) ? ctx.manifest.legacyPaths : [])
    .filter((entry) => ['pointer', 'tombstone'].includes(entry?.disposition) && typeof entry.path === 'string' && typeof entry.target === 'string');
  const rows = []; const outRoots = [];
  const claimed = new Set(collectionRoots(ctx));
  const runtimeFiles = new Set(scanRefs(ctx, roots.map((r) => r.root), null).filter((ref) => ref.kind === 'runtime').map((ref) => ref.path.replace(/\/$/, '')));
  // Tree rows come first so a collection can step aside from a folder a loose file already routes to.
  // A loose file inside a collection root is an unadmitted record and fails the collection's check.
  const treeRows = new Map();
  for (const { root, collection, files } of roots) {
    if (collection) continue;
    treeRows.set(root, files.map((file) => {
      const stub = stubs.find((entry) => entry.path === file);
      if (stub) return { source: file, target: stub.target, kind: 'legacy-pointer', remove: true, reason: 'A generated pointer stub. Apply removes it and forwards its path to the manifest target.' };
      const rel = file === root ? basename(file) : file.slice(root.length + 1);
      const text = MARKDOWN_EXT.test(file) ? readText(ctx.root, file) : null;
      return { source: file, ...routeTreeFile({ ctx, file, rel, text, routing, programs, runtime: runtimeFiles.has(file) }) };
    }));
  }
  const looseTargets = [...treeRows.values()].flat().filter((row) => !row.remove).map((row) => row.target);
  for (const { root, collection, files } of roots) {
    if (collection) {
      const audit = /audit/i.test(`${collection.id} ${collection.root}`);
      const kind = audit ? 'collection-audit' : 'collection-rulings';
      let target = audit ? routing[kind] : `${routing[kind]}/${collection.id}`;
      if (audit && ([...claimed].some((c) => c !== root && (under(c, target) || under(target, c))) || looseTargets.some((t) => under(t, target)))) target = `${routing[kind]}/${basename(root)}`;
      claimed.add(target);
      outRoots.push({ root, kind: 'collection', collection: collection.id, target, files: files.length });
      const reason = audit ? 'Audit record collection, whole. Its summary records surface in the register.' : 'Record collection of rulings, whole. Its decision, amendment, and summary records surface in the register.';
      for (const file of files) rows.push({ source: file, target: `${target}${file.slice(root.length)}`, kind, reason });
      continue;
    }
    outRoots.push({ root, kind: 'tree', collection: null, target: null, files: files.length });
    rows.push(...treeRows.get(root));
  }
  return { rows, outRoots };
}

// Everything the plan cannot execute: a target that exists, a target two rows share, a target
// that leaves the hub, or a loose file aimed into a record collection.
function findConflicts(ctx, rows, outRoots) {
  const conflicts = []; const seen = new Map();
  const tracked = new Set(ctx.tracked);
  for (const row of rows) {
    if (row.remove) continue; // A stub's target is the canonical file, which already exists.
    if (!row.target.startsWith(`${ctx.hub}/`) || !safePath(row.target)) conflicts.push(`${row.source}: target ${row.target} is not a safe path inside ${ctx.hub}`);
    if (tracked.has(row.target) || existsSync(join(ctx.root, row.target))) conflicts.push(`${row.source}: target ${row.target} already exists`);
    const key = row.target.toLowerCase();
    if (seen.has(key)) conflicts.push(`${row.source}: target ${row.target} is also the target of ${seen.get(key)}`);
    seen.set(key, row.source);
  }
  // A loose file under a record collection root is an unadmitted record, which breaks the chain check.
  const folders = [...collectionRoots(ctx), ...outRoots.filter((r) => r.target).map((r) => r.target)];
  for (const row of rows.filter((candidate) => !candidate.remove && !candidate.kind.startsWith('collection-'))) {
    const inside = folders.find((folder) => under(row.target, folder));
    if (inside) conflicts.push(`${row.source}: target ${row.target} sits inside record collection root ${inside}; reroute it outside the collection`);
  }
  for (const entry of outRoots.filter((r) => r.target)) {
    const clash = collectionsOf(ctx).find((c) => c.root !== entry.root && (under(c.root, entry.target) || under(entry.target, c.root)));
    if (clash) conflicts.push(`${entry.root}: target root ${entry.target} overlaps record collection ${clash.id}`);
  }
  return conflicts;
}

// The path map a wave applies: exact rows, whole-collection swaps, and directory swaps.
function pathModel(rows, outRoots) {
  return { rows, rowMap: new Map(rows.map((row) => [row.source, row.target])), roots: outRoots };
}
function mapPath(path, model) {
  const slash = path.endsWith('/');
  const bare = slash ? path.slice(0, -1) : path;
  if (model.resolve) {
    const to = model.resolve(bare);
    return to === null ? null : `${to}${slash ? '/' : ''}`;
  }
  let out = model.rowMap.get(bare) ?? null;
  if (out === null) {
    const collectionRoot = model.roots.find((r) => r.target && under(bare, r.root));
    if (collectionRoot) out = `${collectionRoot.target}${bare.slice(collectionRoot.root.length)}`;
    else {
      const below = model.rows.filter((row) => row.source.startsWith(`${bare}/`));
      const folders = new Set(below.map((row) => {
        const rel = row.source.slice(bare.length);
        return row.target.endsWith(rel) ? row.target.slice(0, row.target.length - rel.length) : null;
      }));
      if (below.length && folders.size === 1 && !folders.has(null)) out = [...folders][0];
    }
  }
  return out === null ? null : `${out}${slash ? '/' : ''}`;
}

const isComment = (line) => /^\s*(?:\/\/|#|\*|\/\*|<!--|--)/.test(line);
const refKind = (file, line) => (CODE_EXT.test(file) && !isComment(line) ? 'runtime' : 'prose');

// Every reference to a path under `rootNames` in the tracked, non-history text files.
function scanRefs(ctx, rootNames, model) {
  const refs = []; const roots = collectionRoots(ctx);
  for (const file of ctx.tracked) {
    if (isHistory(file, ctx.hub, roots)) continue;
    const text = readText(ctx.root, file);
    if (text === null) continue;
    const lines = text.split('\n');
    for (const hit of findRefs(text, rootNames)) {
      const line = text.slice(0, hit.index).split('\n').length;
      refs.push({ file, line, path: hit.path, to: model ? mapPath(hit.path, model) : null, kind: refKind(file, lines[line - 1] ?? '') });
    }
  }
  return refs;
}

const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function renderPlanMarkdown(plan) {
  const out = [
    '# Relocation plan', '',
    `Base ${plan.base}. Hub ${plan.hub}. Manifest version ${plan.manifestVersion}. ${plan.rows.length} file(s) in ${plan.roots.length} legacy root(s), one wave each.`, '',
    'Review the runtime reads first. Edit a `target` in the JSON to reroute a file, then run apply.', '',
    '## Waves', '', '| Legacy root | Kind | Files | Target root |', '| --- | --- | --- | --- |',
    ...plan.roots.map((r) => `| ${cell(r.root)} | ${r.kind}${r.collection ? ` (${cell(r.collection)})` : ''} | ${r.files} | ${cell(r.target ?? 'per file')} |`), '',
  ];
  if (plan.conflicts.length) out.push('## Conflicts (apply refuses)', '', ...plan.conflicts.map((c) => `- ${c}`), '');
  const list = (title, refs) => out.push(`## ${title} (${refs.length})`, '', ...(refs.length ? refs.map((r) => `- ${r.file}:${r.line} ${r.path} -> ${r.to ?? 'UNRESOLVED'}`) : ['None.']), '');
  list('Runtime reads', plan.references.runtime);
  list('Prose references', plan.references.prose);
  if (plan.references.unresolved.length) out.push('## Unresolved references (apply refuses)', '', ...plan.references.unresolved.map((r) => `- ${r.file}:${r.line} ${r.path}`), '');
  out.push('## Rows', '', '| Source | Target | Kind | Reason |', '| --- | --- | --- | --- |',
    ...plan.rows.map((r) => `| ${cell(r.source)} | ${cell(r.target)} | ${r.kind}${r.promote ? ' (promote)' : ''}${r.runtimeRead ? ' (runtime read)' : ''}${r.remove ? ' (remove stub)' : ''} | ${cell(r.reason)} |`), '');
  return out.join('\n');
}

function commandPlan(flags) {
  const ctx = loadContext(resolve(flags.root));
  const roots = deriveRoots(ctx, flags.legacy);
  if (!roots.length) die('no legacy root holds tracked files, so there is nothing to plan', 1);
  const routing = routingFor(ctx.hub);
  const { rows, outRoots } = buildRows(ctx, roots, routing);
  const model = pathModel(rows, outRoots);
  const refs = scanRefs(ctx, roots.map((r) => r.root), model);
  const plan = {
    version: PLAN_VERSION, date: today(), base: gitOut(ctx.root, ['rev-parse', 'HEAD']).trim(), hub: ctx.hub,
    manifestVersion: ctx.manifest.version ?? null, routing, roots: outRoots, rows,
    references: { runtime: refs.filter((r) => r.kind === 'runtime' && r.to), prose: refs.filter((r) => r.kind === 'prose' && r.to), unresolved: refs.filter((r) => !r.to) },
    conflicts: findConflicts(ctx, rows, outRoots),
  };
  const runDir = resolve(ctx.root, flags.run ?? `${ctx.hub}/80 Runs/${plan.date} relocation-plan`);
  writeLf(join(runDir, 'RELOCATION_PLAN.json'), `${JSON.stringify(plan, null, 2)}\n`);
  writeLf(join(runDir, 'RELOCATION_PLAN.md'), `${renderPlanMarkdown(plan)}\n`);
  console.log(`relocate plan: ${rows.length} file(s), ${roots.length} wave(s), ${plan.references.runtime.length} runtime read(s), ${plan.references.prose.length} prose reference(s), ${plan.references.unresolved.length} unresolved, ${plan.conflicts.length} conflict(s)`);
  console.log(`  ${join(runDir, 'RELOCATION_PLAN.md')}`);
  console.log(`  ${join(runDir, 'RELOCATION_PLAN.json')}`);
}

// ---- apply ----

function readPlan(file) {
  let plan;
  try { plan = JSON.parse(readFileSync(resolve(file), 'utf8')); } catch (error) { die(`cannot read plan ${file}: ${error.message}`, 2); }
  const rowOk = (r) => r && typeof r.source === 'string' && typeof r.target === 'string' && typeof r.kind === 'string';
  const rootOk = (r) => r && typeof r.root === 'string' && (r.kind === 'tree' || (r.kind === 'collection' && typeof r.target === 'string' && typeof r.collection === 'string'));
  if (!plan || plan.version !== PLAN_VERSION || typeof plan.base !== 'string' || typeof plan.hub !== 'string'
    || !Array.isArray(plan.rows) || !plan.rows.every(rowOk) || !Array.isArray(plan.roots) || !plan.roots.every(rootOk)) die(`${file} is not a version ${PLAN_VERSION} relocation plan`, 2);
  return plan;
}

function refuse(message) { die(`apply refused: ${message}`, 1); }

const gitMv = (root, from, to) => {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  gitOut(root, ['mv', from, to]);
};

// git mv leaves the emptied source folders behind, and a `removed` root that still exists on disk
// fails the docs gate. Remove the empty folders below `path`, then its empty parents. A folder that
// still holds a file stays, so an untracked leftover keeps failing the gate.
function pruneEmptyDirs(root, path) {
  const prune = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) if (entry.isDirectory()) prune(join(dir, entry.name));
    try { if (!readdirSync(dir).length) rmdirSync(dir); } catch { /* still in use */ }
  };
  prune(join(root, path));
  for (let parent = dirname(path); parent !== '.' && parent !== ''; parent = dirname(parent)) {
    try { if (readdirSync(join(root, parent)).length) break; rmdirSync(join(root, parent)); } catch { break; }
  }
}

// Rewrites every mapped reference in `files`. A reference with no mapping stays as written.
function rewriteFiles(ctx, files, rootNames, model) {
  let rewritten = 0; let references = 0;
  for (const file of files) {
    const text = readText(ctx.root, file);
    if (text === null) continue;
    let out = text; let changed = 0;
    for (const hit of findRefs(text, rootNames).reverse()) {
      const to = mapPath(hit.path, model);
      if (to === null || to === hit.path) continue;
      out = `${out.slice(0, hit.index)}${to}${out.slice(hit.index + hit.path.length)}`;
      changed++;
    }
    if (changed) { writeFileSync(join(ctx.root, file), out); rewritten++; references += changed; }
  }
  return { rewritten, references };
}

function commandApply(flags) {
  const root = resolve(flags.root);
  const plan = readPlan(flags.plan);
  const ctx = loadContext(root);
  if (ctx.manifest.version !== 3) refuse(`the manifest is version ${ctx.manifest.version}; a removed legacy root needs version 3`);
  if (plan.hub !== ctx.hub) refuse(`the plan names hub ${plan.hub} and this repository uses ${ctx.hub}`);
  if (gitOut(root, ['status', '--porcelain']).trim()) refuse('the working tree is dirty; commit or stash first');
  if (!gitOk(root, ['cat-file', '-e', `${plan.base}^{commit}`]) || !gitOk(root, ['merge-base', '--is-ancestor', plan.base, 'HEAD'])) {
    refuse(`HEAD is older than the plan base ${plan.base.slice(0, 12)}, or unrelated to it; re-plan on the current base`);
  }
  const wave = flags.wave ?? (plan.roots.length === 1 ? plan.roots[0].root : null);
  if (!wave) refuse(`the plan holds ${plan.roots.length} waves; name one with --wave: ${plan.roots.map((r) => r.root).join(', ')}`);
  const waveRoot = plan.roots.find((r) => r.root === wave);
  if (!waveRoot) refuse(`${wave} is not a wave in the plan`);
  const rows = plan.rows.filter((row) => under(row.source, wave));
  const tracked = new Set(ctx.tracked);
  const planned = new Set(rows.map((row) => row.source));
  for (const file of ctx.tracked.filter((path) => under(path, wave))) if (!planned.has(file)) refuse(`the plan is stale: ${file} is tracked and not in the plan`);
  for (const row of rows) if (!tracked.has(row.source)) refuse(`the plan is stale: ${row.source} is not tracked`);
  if (!rows.length) refuse(`the plan holds no rows for ${wave}`);
  const conflicts = findConflicts(ctx, rows, [waveRoot]);
  if (conflicts.length) refuse(`conflicts:\n  ${conflicts.join('\n  ')}`);
  const collection = waveRoot.kind === 'collection' ? collectionsOf(ctx).find((c) => c.id === waveRoot.collection && c.root === wave) : null;
  if (waveRoot.kind === 'collection') {
    if (!collection) refuse(`the manifest has no record collection ${waveRoot.collection} at ${wave}`);
    if (!existsSync(join(HERE, 'records.mjs'))) refuse('records.mjs is not bundled beside docs-relocate.mjs, so the record chain cannot move');
    for (const row of rows) if (row.target !== `${waveRoot.target}${row.source.slice(wave.length)}`) refuse(`${row.source} must keep its path below the collection root, so its target must sit under ${waveRoot.target}`);
  }
  const model = pathModel(rows, [waveRoot]);
  const refsBefore = scanRefs(ctx, [wave], model).filter((ref) => !ref.to);
  if (refsBefore.length) refuse(`references the plan cannot map:\n  ${refsBefore.map((r) => `${r.file}:${r.line} ${r.path}`).join('\n  ')}`);

  const at = flags.at ?? new Date().toISOString();
  const step = (text) => console.log(`  ${text}`);
  console.log(`relocate apply: wave ${wave}, ${rows.length} file(s)`);
  try {
    // 1. Move.
    if (collection) gitMv(root, wave, waveRoot.target);
    else for (const row of rows) { if (row.remove) gitOut(root, ['rm', '-q', '--', row.source]); else gitMv(root, row.source, row.target); }
    pruneEmptyDirs(root, wave);
    step(`moved ${rows.filter((row) => !row.remove).length} file(s) with git mv, removed ${rows.filter((row) => row.remove).length} pointer stub(s)`);

    // 2. Manifest: the collection root, and the legacy root as removed.
    const manifestFile = join(root, ctx.manifestRel);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    if (collection) manifest.recordCollections.find((c) => c.id === collection.id).root = waveRoot.target;
    const entries = Array.isArray(manifest.legacyPaths) ? manifest.legacyPaths : [];
    const evidence = entries.find((e) => e && under(e.path, wave))?.requiredBy;
    manifest.legacyPaths = [...entries.filter((e) => !(e && under(e.path, wave))), {
      path: wave, disposition: 'removed',
      requiredBy: Array.isArray(evidence) && evidence.length ? evidence : [{ kind: 'external', ref: `docs relocate wave ${wave} planned at ${plan.base.slice(0, 12)}` }],
    }];
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    gitOut(root, ['add', '--', ctx.manifestRel]);
    step(`manifest: ${collection ? `collection ${collection.id} root is ${waveRoot.target}; ` : ''}${wave} is removed`);

    // 3. One relocate-root event for the moved collection.
    if (collection) {
      const r = nodeScript(root, 'records.mjs', ['relocate-root', '--collection', collection.id, '--from', wave, '--at', at]);
      if (r.status !== 0) throw new Error(`records relocate-root failed: ${(r.err || r.out).trim()}`);
      step(`appended a relocate-root event for ${collection.id}`);
    }

    // 4. FORWARDING.json.
    const forwardFile = join(root, ctx.hub, '98 System', 'FORWARDING.json');
    const document = existsSync(forwardFile) ? JSON.parse(readFileSync(forwardFile, 'utf8')) : { version: 1, forwards: [] };
    const movedAt = at.slice(0, 10);
    const moves = collection ? [{ from: wave, to: waveRoot.target, kind: rows[0].kind }] : rows.map((row) => ({ from: row.source, to: row.target, kind: row.kind }));
    document.forwards.push(...moves.map(({ from, to, kind }) => ({ from, to, movedAt, reason: `relocate ${kind}` })));
    const problems = forwardingErrors(document);
    if (problems.length) throw new Error(`FORWARDING.json would be invalid: ${problems.join('; ')}`);
    writeLf(forwardFile, `${JSON.stringify(document, null, 2)}\n`);
    step(`FORWARDING.json holds ${document.forwards.length} forward(s)`);

    // 5. References, in the tracked files as they stand after the move.
    const after = { ...ctx, tracked: listTracked(root) };
    const historyRoots = collectionRoots({ manifest });
    const files = after.tracked.filter((path) => !isHistory(path, ctx.hub, historyRoots));
    const result = rewriteFiles(after, files, [wave], model);
    step(`rewrote ${result.references} reference(s) in ${result.rewritten} file(s)`);

    // 6. Index, register, vault indexes, and manifest digests. The register is refreshed where the
    // repository already keeps one, never introduced by a wave.
    if (collection) {
      const registered = existsSync(join(root, ctx.hub, '20 Decisions', 'REGISTER.md'));
      for (const args of registered ? [['render'], ['render', '--register']] : [['render']]) {
        const r = nodeScript(root, 'records.mjs', [...args, '--collection', collection.id]);
        if (r.status !== 0) throw new Error(`records ${args.join(' ')} failed: ${(r.err || r.out).trim()}`);
      }
      step(`rendered the index${registered ? ' and the register' : ''} for ${collection.id}`);
    }
    if (existsSync(join(HERE, 'check-vault-standard.mjs'))) {
      // The gate reports any violation this leaves, so the exit status is not read here.
      run(process.execPath, [join(HERE, 'check-vault-standard.mjs'), join(root, ctx.hub), '--render'], root);
      step('rendered the generated vault surfaces');
    }
    const sync = nodeScript(root, 'docs-manifest.mjs', ['sync']);
    if (sync.status !== 0) throw new Error(`docs-manifest sync failed: ${(sync.err || sync.out).trim()}`);
    step('re-stamped the manifest digests');
    gitOut(root, ['add', '-A']);

    // 7. The docs gate.
    if (existsSync(join(HERE, 'docs-gate.mjs'))) {
      const gate = nodeScript(root, 'docs-gate.mjs', []);
      gitOut(root, ['add', '-A']);
      step(`docs gate: ${gate.status === 0 ? 'PASS' : 'FAIL'}`);
      if (gate.status !== 0) throw new Error(`the docs gate failed after the move:\n${gate.err.trim() || gate.out.trim()}`);
    } else step('docs gate: not bundled here, so it did not run');
  } catch (error) {
    console.error(`x ${error.message}`);
    console.error(`x wave ${wave} is staged and uncommitted; review it, or discard it with: git reset --hard HEAD (then git clean -fd for new files)`);
    process.exit(1);
  }
  const kinds = [...new Set(rows.map((row) => row.kind))].join(', ');
  console.log(`\nSuggested commit message for this wave:\n\nRelocate ${wave} into ${ctx.hub}\n\nMove ${rows.length} file(s) (${kinds}) with git mv so blame follows.${collection ? `\nAppend one relocate-root event for ${collection.id}.` : ''}\nForward every old path through FORWARDING.json, rewrite the references, and set ${wave} to removed in the manifest.`);
}

// ---- forward ----

function commandForward(flags) {
  const root = resolve(flags.root);
  const ctx = loadContext(root);
  const forwardFile = join(root, ctx.hub, '98 System', 'FORWARDING.json');
  if (!existsSync(forwardFile)) die(`no ${ctx.hub}/98 System/FORWARDING.json, so no wave has landed`, 2);
  let document;
  try { document = JSON.parse(readFileSync(forwardFile, 'utf8')); } catch (error) { die(`cannot parse FORWARDING.json: ${error.message}`, 2); }
  const problems = forwardingErrors(document);
  if (problems.length) die(`FORWARDING.json is invalid: ${problems.join('; ')}`, 2);
  if (!document.forwards.length) { console.log('relocate forward: FORWARDING.json holds no forwards'); return; }
  if (!gitOk(root, ['rev-parse', '--verify', '--quiet', `${flags.base}^{commit}`])) die(`--base ${flags.base} does not resolve to a commit`, 2);
  const mergeBase = gitOut(root, ['merge-base', flags.base, 'HEAD']).trim();
  const changed = new Set([...gitOut(root, ['diff', '--name-only', '-z', mergeBase]).split('\0'), ...gitOut(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0')].filter(Boolean));
  const plan = loadForwardPlan(ctx, flags.plan);
  const removedRoots = (Array.isArray(ctx.manifest.legacyPaths) ? ctx.manifest.legacyPaths : [])
    .filter((entry) => entry?.disposition === 'removed' && typeof entry.path === 'string').map((entry) => entry.path);
  const prefixes = [...new Set([...document.forwards.map((forward) => forward.from), ...removedRoots])];
  const stragglers = ctx.tracked.filter((path) => prefixes.some((from) => under(path, from)));

  // Route every straggler before any move, so a missing route leaves the tree as it was.
  const moves = []; const missing = [];
  const programs = plan ? openProgramText(ctx) : '';
  for (const file of stragglers) {
    let to = forwardPath(document, file);
    if (to === null && plan) to = routeByPlan(ctx, plan, file, programs);
    if (to === null) missing.push(file); else moves.push({ from: file, to });
  }
  if (missing.length) {
    for (const file of missing) console.error(`x no route for ${file}: FORWARDING.json has no entry and ${plan ? 'the plan has no root that holds it' : 'no plan was found (pass --plan)'}`);
    process.exit(1);
  }
  const taken = moves.map((move) => move.to).filter((to) => existsSync(join(root, to)));
  if (taken.length) die(`forward refused: ${taken[0]} already exists`, 1);
  for (const move of moves) gitMv(root, move.from, move.to);
  for (const move of moves) pruneEmptyDirs(root, dirname(move.from));
  const moved = new Map(moves.map((move) => [move.from, move.to]));
  const now = { ...ctx, tracked: listTracked(root) };
  const history = collectionRoots(ctx);
  const trackedNow = new Set(now.tracked);
  const files = [...new Set([...changed].map((path) => moved.get(path) ?? path).concat(moves.map((move) => move.to)))]
    .filter((path) => trackedNow.has(path) && !isHistory(path, ctx.hub, history));
  const model = forwardModel(document);
  const result = rewriteFiles(now, files, prefixes, model);
  console.log(`relocate forward: moved ${moves.length} file(s), rewrote ${result.references} reference(s) in ${result.rewritten} file(s)`);
  for (const move of moves) console.log(`  ${move.from} -> ${move.to}`);
}

// Forwarding as a path model: mapPath resolves a reference through the forwards, following chains.
const forwardModel = (document) => ({ resolve: (path) => forwardPath(document, path) });

function loadForwardPlan(ctx, file) {
  let path = file ? resolve(file) : null;
  if (!path) {
    const runs = join(ctx.root, ctx.hub, '80 Runs');
    try {
      const newest = readdirSync(runs, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(runs, e.name, 'RELOCATION_PLAN.json'))).map((e) => e.name).sort().at(-1);
      if (newest) path = join(runs, newest, 'RELOCATION_PLAN.json');
    } catch { /* no run folder */ }
  }
  return path && existsSync(path) ? readPlan(path) : null;
}

// The plan's route for a file that FORWARDING.json does not map: a collection root swaps its
// prefix, and a tree root classifies the file with the plan's routing table.
function routeByPlan(ctx, plan, file, programs) {
  const entry = plan.roots.find((r) => under(file, r.root));
  if (!entry) return null;
  if (entry.target) return `${entry.target}${file.slice(entry.root.length)}`;
  const rel = file === entry.root ? basename(file) : file.slice(entry.root.length + 1);
  const text = MARKDOWN_EXT.test(file) ? readText(ctx.root, file) : null;
  return routeTreeFile({ ctx, file, rel, text, routing: plan.routing, programs, runtime: false }).target;
}

// ---- entry ----

const isEntry = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isEntry) {
  const [sub, ...rest] = process.argv.slice(2);
  const spec = { root: { value: true, default: '.' } };
  const specs = {
    plan: { ...spec, run: { value: true }, legacy: { value: true, many: true } },
    apply: { ...spec, plan: { value: true, required: true }, wave: { value: true }, at: { value: true } },
    forward: { ...spec, base: { value: true, default: 'origin/main' }, plan: { value: true } },
  };
  if (sub === '--help' || sub === '-h') { console.log(USAGE.join('\n')); process.exit(0); }
  if (!Object.hasOwn(specs, sub ?? '')) { for (const line of USAGE) console.error(line); process.exit(2); }
  const { flags } = parseOrDie(rest, specs[sub], USAGE.join('\n'));
  if (sub === 'plan') commandPlan(flags);
  else if (sub === 'apply') commandApply(flags);
  else commandForward(flags);
}
