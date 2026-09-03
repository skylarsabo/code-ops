#!/usr/bin/env node
// Query-able symbol index: pointers over payloads. Answers a structural question with
// `file:line` anchors, one-line signatures, and edge lists, so an operative reads the ranges
// it needs instead of a whole map or a verbatim dump that stays resident in the window.
//
//   node scripts/context-query.mjs <command> [args] [--root <dir>] [--json] [--no-stale-check]
//
//   refresh [paths...]        (re)index every tracked code file, or only the paths given;
//                             `--exclude <prefix>` (repeatable) drops derived copies and is
//                             remembered by the index for later refreshes;
//                             `--provider ctags|codegraph|none` (default none) adds an
//                             optional fidelity provider
//   status                    index age, size, and the files changed since it was built
//   find <symbol>             definitions named <symbol> (`--fuzzy` for substring matches)
//   callers <symbol>          call sites that resolve to <symbol>, with the enclosing definition
//   callees <symbol>          calls inside <symbol>'s body and where each resolves
//   blast <path>              files that import <path>, transitively to --depth (default 2),
//                             and the file's definitions with their caller counts
//   explore "<terms>"         definitions and lines matching every term, ranked, within
//                             --budget bytes (default 4000); `--with-source` appends the bodies
//                             of the top definitions until the budget is spent
//
// <symbol> is a name, or `path:name` to pin one definition. Every command auto-refreshes the
// index when it is missing; `refresh` is for keeping it current after edits, and the opt-in
// PostToolUse hook `index-refresh.mjs` calls it on every Edit and Write.
//
// Store: `$CODE_OPS_INDEX_DIR/index.json`, else `~/.claude/code-ops/index/<project slug>/`, a
// home-directory path so the index is never committed. One entry per tracked code file, keyed
// by content sha, so a refresh re-parses only what changed.
//
// Providers are data, never a requirement. Nothing is spawned unless `--provider` names one. An
// absent provider prints one line on stderr and the line rules stand alone, so a refresh never
// fails for a missing tool. A merged definition carries `source`, the index records the
// providers whose definitions it holds, and `status` prints them. No provider reaches a network.
// A merged definition can sit inside a rule definition's span, so an enclosing-name attribution
// may name the inner one; the anchors stay right, which is what a reader follows.
//
// Ceiling, printed on every edge result: definitions and calls come from line regexes in
// symbol-lib.mjs, and a call resolves to the definition of that name in the same file, else in
// a file the caller imports that name from, else to every definition of that name in the tree
// (marked ambiguous), else unresolved. No dynamic dispatch, no type resolution, no names built
// from strings. A result that touches a file changed since the index was built carries a
// stale banner, so the reader opens the live file.
//
// Exit: 0 on an answer (an empty one included), 1 when a symbol or path is unknown, 2 on a
// usage error or a git failure.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { calls, definitions, imports, isCodeExt } from './symbol-lib.mjs';

const USAGE = 'usage: context-query.mjs <refresh|status|find|callers|callees|blast|explore> [args] [--root <dir>] [--exclude <prefix>]... [--provider <ctags|codegraph|none>] [--json] [--fuzzy] [--depth <n>] [--budget <bytes>] [--with-source] [--no-stale-check]';
const INDEX_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;
const PROVIDERS = ['ctags', 'codegraph', 'none'];

const argv = process.argv.slice(2);
const o = { root: null, json: false, fuzzy: false, depth: 2, budget: 4000, withSource: false, staleCheck: true, excludes: [], provider: 'none' };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const value = (flag) => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) die(`${flag} needs a value`); return v; };
  if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
  else if (a === '--root') o.root = value(a);
  else if (a === '--exclude') o.excludes.push(value(a).replace(/\\/g, '/').replace(/\/+$/, '') + '/');
  else if (a === '--provider') { o.provider = value(a); if (!PROVIDERS.includes(o.provider)) die(`--provider takes one of ${PROVIDERS.join(', ')}`); }
  else if (a === '--json') o.json = true;
  else if (a === '--fuzzy') o.fuzzy = true;
  else if (a === '--with-source') o.withSource = true;
  else if (a === '--no-stale-check') o.staleCheck = false;
  else if (a === '--depth') { o.depth = Number(value(a)); if (!Number.isInteger(o.depth) || o.depth < 1) die('--depth needs a positive integer'); }
  else if (a === '--budget') { o.budget = Number(value(a)); if (!Number.isInteger(o.budget) || o.budget < 200) die('--budget needs an integer of at least 200'); }
  else if (a.startsWith('--')) die(`unknown flag: ${a}`);
  else positional.push(a);
}
const [command, ...args] = positional;
if (!command) die('a command is required');

function die(msg) { console.error(`x ${msg}\n${USAGE}`); process.exit(2); }

function git(root, gitArgs) {
  try { return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) {
    console.error(`x git ${gitArgs[0]} failed: ${String(e.stderr ?? e.message).trim()}`);
    process.exit(2);
  }
}

// Real paths on both sides: a Windows runner hands the hook a short-name temp path while git
// prints the long form, and a relative path between the two forms escapes the tree.
const real = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const root = real(resolve(o.root ?? git(process.cwd(), ['rev-parse', '--show-toplevel']).trim()));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const projectSlug = (p) => String(p).replace(/[^A-Za-z0-9]/g, '-');
const storeDir = process.env.CODE_OPS_INDEX_DIR ? resolve(process.env.CODE_OPS_INDEX_DIR) : join(homedir(), '.claude', 'code-ops', 'index', projectSlug(root));
const indexPath = join(storeDir, 'index.json');
const toPosix = (p) => p.replace(/\\/g, '/');

// ---------------------------------------------------------------- index build and refresh

function trackedCodeFiles(excludes) {
  return git(root, ['ls-files', '-z']).split('\0').filter((f) => f && isCodeExt(extname(f)) && !excludes.some((p) => f.startsWith(p)));
}

function indexFile(file, exists, provided = null) {
  const abs = join(root, file);
  let buf;
  try { buf = readFileSync(abs); } catch { return null; }
  if (buf.length > MAX_FILE_BYTES || buf.includes(0)) return { sha: sha256(buf), size: buf.length, skipped: buf.length > MAX_FILE_BYTES ? 'size' : 'binary', defs: [], calls: [], imports: [] };
  const text = buf.toString('utf8');
  const ext = extname(file);
  const defs = merge(definitions(text, ext), provided);
  return { sha: sha256(buf), size: buf.length, defs, calls: calls(text, ext, defs), imports: imports(text, ext, file, exists) };
}

// A provider definition joins the file only where the line rules found none at that line, so the
// rules stay authoritative and no line is claimed twice.
function merge(defs, provided) {
  if (!provided?.length) return defs;
  const taken = new Set(defs.map((d) => d.line));
  for (const d of provided) {
    if (taken.has(d.line)) continue;
    taken.add(d.line);
    defs.push(d);
  }
  return defs.sort((a, b) => a.line - b.line);
}

function loadIndex() {
  if (!existsSync(indexPath)) return null;
  try {
    const idx = JSON.parse(readFileSync(indexPath, 'utf8'));
    return idx.version === INDEX_VERSION && idx.root === root ? idx : null;
  } catch { return null; }
}

function saveIndex(idx) {
  mkdirSync(storeDir, { recursive: true });
  writeFileSync(indexPath, JSON.stringify(idx));
}

// ---------------------------------------------------------------- optional providers

// Universal Ctags kinds mapped onto the index's own kinds. An unmapped kind passes through as
// ctags spelled it, because dropping it would lose the fidelity the provider was asked for.
const CTAGS_KINDS = {
  function: 'fn', method: 'fn', procedure: 'fn', subroutine: 'fn', prototype: 'fn',
  class: 'class', struct: 'type', interface: 'type', enum: 'type', typedef: 'type', union: 'type', type: 'type',
  variable: 'const', constant: 'const', member: 'const', field: 'const', property: 'const',
};

function probe(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { return null; }
}

const note = (line) => process.stderr.write(`${line}\n`);

// Universal Ctags over the given files, as a Map of file to definitions. `-L -` feeds the list on
// stdin, so a long list never meets a command-line limit, and `--output-format=json` with
// `--fields=+neK` yields one object per line carrying a line number, an end line where the parser
// knows one, and the long kind name. A tool that is absent, is a different ctags, or fails leaves
// the line rules alone.
function ctagsDefs(files) {
  const version = probe('ctags', ['--version']);
  if (!version) { note('provider ctags: not installed, line rules only'); return null; }
  if (!/Universal Ctags/i.test(version)) { note('provider ctags: not Universal Ctags, line rules only'); return null; }
  if (!files.length) return new Map();
  let out;
  try {
    out = execFileSync('ctags', ['--output-format=json', '--fields=+neK', '--sort=no', '-L', '-', '-f', '-'],
      { cwd: root, input: `${files.join('\n')}\n`, encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 26, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    note(`provider ctags: run failed (${String(e.message).split('\n')[0]}), line rules only`);
    return null;
  }
  const byFile = new Map();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    let tag;
    try { tag = JSON.parse(line); } catch { continue; }
    if (tag._type !== 'tag' || !tag.name || !tag.path || !Number.isInteger(tag.line)) continue;
    const file = toPosix(tag.path).replace(/^\.\//, '');
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push({
      name: tag.name,
      kind: CTAGS_KINDS[tag.kind] ?? tag.kind ?? 'sym',
      line: tag.line,
      end: Number.isInteger(tag.end) && tag.end >= tag.line ? tag.end : tag.line,
      sig: String(tag.pattern ?? '').replace(/^\/\^?/, '').replace(/\$?\/$/, '').trim().slice(0, 120),
      source: 'ctags',
    });
  }
  note(`provider ctags: ${version.split('\n')[0].trim()}`);
  return byFile;
}

// deferred(codegraph is detected but not ingested, because no installed copy was available to read a documented machine-readable export off its own help text, ingest its export once a copy proves one exists offline)
function codegraphDefs() {
  note(probe('codegraph', ['--version'])
    ? 'provider codegraph: detected, ingest not implemented'
    : 'provider codegraph: not installed, line rules only');
  return null;
}

function providerDefs(files) {
  if (o.provider === 'none') return null;
  if (o.provider === 'codegraph') return codegraphDefs();
  return ctagsDefs(files);
}

// The providers an index holds, read off the definitions themselves, so the field cannot claim a
// provider whose entries a later refresh replaced.
const providersIn = (files) => [...new Set(Object.values(files).flatMap((e) => e.defs.map((d) => d.source).filter(Boolean)))].sort();

// Re-index only files whose content sha changed, drop files no longer tracked, and return the
// counts. `only` limits the walk to named paths, for the edit hook.
function refresh(only = null) {
  const previous = loadIndex() ?? { version: INDEX_VERSION, root, files: {}, excludes: [] };
  const excludes = [...new Set([...(previous.excludes ?? []), ...o.excludes])];
  const tracked = trackedCodeFiles(excludes);
  const trackedSet = new Set(tracked);
  const exists = (p) => trackedSet.has(p);
  const files = { ...previous.files };
  let reused = 0; let parsed = 0; let dropped = 0;
  const targets = only ? only.map((p) => toPosix(relative(root, real(resolve(root, p))))).filter((p) => trackedSet.has(p)) : tracked;
  if (!only) for (const f of Object.keys(files)) if (!trackedSet.has(f)) { delete files[f]; dropped++; }
  const pending = [];
  for (const file of targets) {
    let buf;
    try { buf = readFileSync(join(root, file)); } catch { continue; }
    if (files[file]?.sha === sha256(buf)) { reused++; continue; }
    pending.push(file);
  }
  // The provider runs once over the files about to be parsed, never over the whole tree.
  const provided = providerDefs(pending);
  for (const file of pending) {
    const entry = indexFile(file, exists, provided?.get(file) ?? null);
    if (entry) { files[file] = entry; parsed++; }
  }
  const idx = { version: INDEX_VERSION, root, excludes, builtAt: new Date().toISOString(), head: git(root, ['rev-parse', 'HEAD']).trim(), providers: providersIn(files), files };
  saveIndex(idx);
  return { idx, reused, parsed, dropped };
}

function ensureIndex() {
  return loadIndex() ?? refresh().idx;
}

// ---------------------------------------------------------------- lookups

function byName(idx) {
  const map = new Map();
  for (const [file, entry] of Object.entries(idx.files)) {
    for (const def of entry.defs) {
      if (!map.has(def.name)) map.set(def.name, []);
      map.get(def.name).push({ file, ...def });
    }
  }
  return map;
}

// `path:name` pins a file; a bare name matches every definition of that name.
function findDefs(idx, symbol, fuzzy = false) {
  const names = byName(idx);
  const m = /^(.+?):([A-Za-z_$][\w$]*)$/.exec(symbol);
  if (m) {
    const path = toPosix(m[1]);
    const all = names.get(m[2]) ?? [];
    const exact = all.filter((d) => d.file === path);
    return exact.length ? exact : all.filter((d) => d.file.endsWith(`/${path}`));
  }
  if (!fuzzy) return names.get(symbol) ?? [];
  const needle = symbol.toLowerCase();
  return [...names.entries()].filter(([n]) => n.toLowerCase().includes(needle)).flatMap(([, defs]) => defs);
}

// Resolution order: same file, then a file the caller imports that name from, then every
// definition of that name in the tree (ambiguous), else unresolved.
function resolveCall(idx, names, file, call) {
  const entry = idx.files[file];
  const local = entry.defs.filter((d) => d.name === call.name);
  if (local.length) return { how: 'local', targets: local.map((d) => ({ file, ...d })) };
  for (const imp of entry.imports) {
    const bound = imp.target ? imp.names.find((n) => n.local === call.name) : null;
    if (bound) {
      const defs = (idx.files[imp.target]?.defs ?? []).filter((d) => d.name === bound.imported).map((d) => ({ file: imp.target, ...d }));
      if (defs.length) return { how: 'import', targets: defs };
    }
  }
  const global = names.get(call.name) ?? [];
  if (global.length === 1) return { how: 'global', targets: global };
  if (global.length > 1) return { how: 'ambiguous', targets: global };
  return { how: 'unresolved', targets: [] };
}

const sameDef = (a, b) => a.file === b.file && a.line === b.line;

function callersOf(idx, targets) {
  const names = byName(idx);
  const out = [];
  for (const [file, entry] of Object.entries(idx.files)) {
    const aliases = new Set(entry.imports.flatMap((imp) => imp.names.filter((n) => n.local !== n.imported).map((n) => n.local)));
    for (const call of entry.calls) {
      if (!targets.some((t) => t.name === call.name) && !aliases.has(call.name)) continue;
      const r = resolveCall(idx, names, file, call);
      if (r.targets.some((t) => targets.some((d) => sameDef(t, d)))) out.push({ file, line: call.line, from: call.from, member: call.member, how: r.how });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function calleesOf(idx, def) {
  const names = byName(idx);
  const entry = idx.files[def.file];
  return entry.calls.filter((c) => c.line >= def.line && c.line <= def.end).map((c) => ({ ...c, ...resolveCall(idx, names, def.file, c) }));
}

function importersOf(idx, path, depth) {
  const reverse = new Map();
  for (const [file, entry] of Object.entries(idx.files)) for (const imp of entry.imports) if (imp.target) { if (!reverse.has(imp.target)) reverse.set(imp.target, []); reverse.get(imp.target).push(file); }
  const seen = new Map([[path, 0]]);
  let frontier = [path];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const f of frontier) for (const importer of reverse.get(f) ?? []) if (!seen.has(importer)) { seen.set(importer, d); next.push(importer); }
    frontier = next;
  }
  seen.delete(path);
  return [...seen.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
}

// ---------------------------------------------------------------- staleness

function staleFiles(idx, files) {
  if (!o.staleCheck) return [];
  const out = [];
  for (const file of new Set(files)) {
    const entry = idx.files[file];
    let buf = null;
    try { buf = readFileSync(join(root, file)); } catch { out.push({ file, why: 'gone' }); continue; }
    if (!entry || sha256(buf) !== entry.sha) out.push({ file, why: 'changed' });
  }
  return out;
}

const lineText = (file, line) => { try { return (readFileSync(join(root, file), 'utf8').split('\n')[line - 1] ?? '').trim().slice(0, 100); } catch { return ''; } };

// ---------------------------------------------------------------- output

const CEILING = 'ceiling: line regexes, no dynamic dispatch, no type resolution; a call resolves same-file, then imported-name, then tree-wide (ambiguous), else unresolved';
const printer = (lines, data) => {
  if (o.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else console.log(lines.join('\n'));
};
const banner = (stale) => stale.map((s) => `!! stale: ${s.file} ${s.why === 'gone' ? 'is gone' : 'changed since the index was built'}; read the live file or run refresh`);
const anchor = (d) => `${d.file}:${d.line}-${d.end}  ${d.kind} ${d.name}  ${d.sig}`;

function needDefs(idx, symbol) {
  const defs = findDefs(idx, symbol, o.fuzzy);
  if (!defs.length) {
    printer([`no definition named ${symbol}${o.fuzzy ? '' : ' (try --fuzzy)'}`], { symbol, definitions: [] });
    process.exit(1);
  }
  return defs;
}

switch (command) {
  case 'refresh': {
    const r = refresh(args.length ? args : null);
    printer([`ok index ${indexPath}: ${Object.keys(r.idx.files).length} files, ${r.parsed} parsed, ${r.reused} unchanged, ${r.dropped} dropped${r.idx.excludes.length ? `, excluding ${r.idx.excludes.join(' ')}` : ''}${r.idx.providers.length ? `, providers ${r.idx.providers.join(' ')}` : ''}`],
      { index: indexPath, files: Object.keys(r.idx.files).length, parsed: r.parsed, reused: r.reused, dropped: r.dropped, excludes: r.idx.excludes, provider: o.provider, providers: r.idx.providers });
    break;
  }
  case 'status': {
    const idx = loadIndex();
    if (!idx) { printer([`no index at ${indexPath}; run refresh`], { index: indexPath, built: false }); process.exit(1); }
    const tracked = trackedCodeFiles(idx.excludes ?? []);
    const stale = o.staleCheck ? staleFiles(idx, tracked).concat(tracked.filter((f) => !idx.files[f]).map((f) => ({ file: f, why: 'new' }))) : [];
    const defs = Object.values(idx.files).reduce((n, e) => n + e.defs.length, 0);
    const edges = Object.values(idx.files).reduce((n, e) => n + e.calls.length, 0);
    const providers = idx.providers ?? providersIn(idx.files);
    printer([`index ${indexPath}`, `built ${idx.builtAt} at ${idx.head.slice(0, 7)}: ${Object.keys(idx.files).length} files, ${defs} definitions, ${edges} call sites`,
      `providers: ${providers.length ? providers.join(' ') : 'none (line rules only)'}`,
      ...(stale.length ? [`${stale.length} file(s) changed since; run refresh:`, ...stale.slice(0, 20).map((s) => `  ${s.file} (${s.why})`)] : ['current'])],
      { index: indexPath, builtAt: idx.builtAt, head: idx.head, files: Object.keys(idx.files).length, definitions: defs, calls: edges, providers, stale });
    break;
  }
  case 'find': {
    if (!args[0]) die('find needs a symbol');
    const idx = ensureIndex();
    const defs = needDefs(idx, args[0]);
    const stale = staleFiles(idx, defs.map((d) => d.file));
    printer([...banner(stale), ...defs.map(anchor)], { symbol: args[0], definitions: defs, stale });
    break;
  }
  case 'callers': {
    if (!args[0]) die('callers needs a symbol');
    const idx = ensureIndex();
    const defs = needDefs(idx, args[0]);
    const sites = callersOf(idx, defs);
    const stale = staleFiles(idx, [...defs.map((d) => d.file), ...sites.map((s) => s.file)]);
    printer([...banner(stale), ...defs.map((d) => `target ${anchor(d)}`), ...sites.map((s) => `${s.file}:${s.line}  in ${s.from ?? '(top level)'}  [${s.how}]  ${lineText(s.file, s.line)}`),
      `${sites.length} caller(s); ${CEILING}`], { symbol: args[0], definitions: defs, callers: sites, stale });
    break;
  }
  case 'callees': {
    if (!args[0]) die('callees needs a symbol');
    const idx = ensureIndex();
    const defs = needDefs(idx, args[0]);
    const rows = defs.flatMap((d) => calleesOf(idx, d).map((c) => ({ def: d, ...c })));
    const stale = staleFiles(idx, [...defs.map((d) => d.file), ...rows.flatMap((r) => r.targets.map((t) => t.file))]);
    printer([...banner(stale), ...defs.map((d) => `body ${anchor(d)}`),
      ...rows.map((r) => `${r.def.file}:${r.line}  ${r.member ? '.' : ''}${r.name}  [${r.how}]${r.targets.length ? '  ' + r.targets.map((t) => `${t.file}:${t.line}`).join(' | ') : ''}`),
      `${rows.length} call(s); ${CEILING}`], { symbol: args[0], definitions: defs, callees: rows, stale });
    break;
  }
  case 'blast': {
    if (!args[0]) die('blast needs a path');
    const idx = ensureIndex();
    const path = toPosix(relative(root, real(resolve(root, args[0]))));
    if (!idx.files[path]) { printer([`${path} is not an indexed code file`], { path, indexed: false }); process.exit(1); }
    const importers = importersOf(idx, path, o.depth);
    const defs = idx.files[path].defs.map((d) => ({ file: path, ...d }));
    const counts = defs.map((d) => ({ def: d, callers: callersOf(idx, [d]).length }));
    const stale = staleFiles(idx, [path, ...importers.map(([f]) => f)]);
    printer([...banner(stale), `${path}: ${importers.length} importer(s) within depth ${o.depth}`, ...importers.map(([f, d]) => `  ${'  '.repeat(d - 1)}${f}  (depth ${d})`),
      `${defs.length} definition(s):`, ...counts.map((c) => `  ${anchor(c.def)}  <- ${c.callers} caller(s)`), CEILING],
      { path, importers: importers.map(([file, depth]) => ({ file, depth })), definitions: counts.map((c) => ({ ...c.def, callers: c.callers })), stale });
    break;
  }
  case 'explore': {
    if (!args[0]) die('explore needs terms');
    const idx = ensureIndex();
    const terms = args.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];
    for (const [file, entry] of Object.entries(idx.files)) {
      for (const d of entry.defs) {
        const name = d.name.toLowerCase();
        const score = terms.reduce((s, t) => s + (name === t ? 10 : name.startsWith(t) ? 5 : name.includes(t) ? 2 : 0), 0);
        if (score) scored.push({ file, ...d, score });
      }
    }
    scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line);
    const lines = [];
    let used = 0;
    let truncated = false;
    const push = (line) => { if (used + line.length + 1 > o.budget) { truncated = true; return false; } lines.push(line); used += line.length + 1; return true; };
    for (const d of scored) if (!push(`${anchor(d)}  (score ${d.score})`)) break;
    if (!truncated) {
      for (const [file] of Object.entries(idx.files)) {
        let text;
        try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
        const rows = text.split('\n');
        for (let i = 0; i < rows.length; i++) {
          const low = rows[i].toLowerCase();
          if (terms.every((t) => low.includes(t)) && !push(`${file}:${i + 1}  ${rows[i].trim().slice(0, 100)}`)) break;
        }
        if (truncated) break;
      }
    }
    const source = [];
    if (o.withSource && !truncated) {
      for (const d of scored) {
        const body = (() => { try { return readFileSync(join(root, d.file), 'utf8').split('\n').slice(d.line - 1, d.end).join('\n'); } catch { return ''; } })();
        const block = `--- ${d.file}:${d.line}-${d.end}\n${body}`;
        if (used + block.length + 1 > o.budget) { truncated = true; break; }
        source.push(block); used += block.length + 1;
      }
    }
    const stale = staleFiles(idx, scored.slice(0, 20).map((d) => d.file));
    const tail = truncated ? [`!! BUDGET_EXCEEDED at ${o.budget} bytes; narrow the terms or read a range with skim.mjs --range`] : [];
    printer([...banner(stale), ...lines, ...source, ...tail], { terms, results: lines, source, truncated, budget: o.budget, stale });
    break;
  }
  default:
    die(`unknown command: ${command}`);
}
