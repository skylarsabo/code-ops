#!/usr/bin/env node
// Import graph generator for orchestrated runs.
// WHY: blast-radius questions ("what breaks if I touch file X?") make operatives
// re-derive the import graph by search every time. This walks the tree ONCE (git
// ls-files, so .gitignore is respected), reads import edges through symbol-lib.mjs
// (a graph, not a bundler/resolver), and emits both directions (imports +
// imported-by) so a brief can hand over blast radius directly. Unresolved relative
// specifiers and dynamic/non-literal imports are always noted, never dropped.
// Reverse edges are computed in-memory from the forward edges after the walk — no
// recursive graph traversal, so an a<->b cycle is just two ordinary edges and can
// never hang the generator.
//   node scripts/import-graph.mjs [--root <dir>] [--out <file>] [--max-file-kb <N>] [--focus <path>]
// Exit 0 = graph written; 1 = bad invocation, unwritable --out, or not a git work tree.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, extname, relative, sep } from 'node:path';
import { IMPORT_EXTS, imports as importEdges } from './symbol-lib.mjs';

const argv = process.argv.slice(2);
let root = '.', out = null, maxKb = 512, focus = null;
for (let i = 0; i < argv.length; i++) {
  const need = (f) => {
    const v = argv[++i];
    if (v === undefined || v.trim() === '' || v.startsWith('--')) { console.error(`  x ${f} needs a value`); process.exit(1); }
    return v;
  };
  if (argv[i] === '--root') root = need('--root');
  else if (argv[i] === '--out') out = need('--out');
  else if (argv[i] === '--focus') focus = need('--focus');
  else if (argv[i] === '--max-file-kb') {
    maxKb = Number(need('--max-file-kb'));
    if (!Number.isFinite(maxKb) || maxKb < 0) { console.error('  x --max-file-kb needs a non-negative number'); process.exit(1); }
  }
  else { console.error(`  x unknown flag: ${argv[i]}`); process.exit(1); }
}
root = resolve(root);
out = out ? resolve(out) : join(root, 'IMPORT_GRAPH.md');

// The extraction and the resolution rules live in symbol-lib.mjs, shared with the map, the
// outline, and the symbol index. This file walks the tree and classifies what the library
// returns: an edge with a target, an unresolved relative specifier, a bare specifier (package,
// node: builtin, or a Rust use-path), or a non-literal dynamic import. Only a target becomes an
// edge; the other three are counted in the footer and named in the file's block.
const SUPPORTED_EXTS = new Set(IMPORT_EXTS);
const existsInRoot = (repoPath) => existsSync(join(root, repoPath));

let files;
try {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: root, timeout: 10000, maxBuffer: 64 * 1024 * 1024 })
    .toString().split('\0').filter(Boolean);
} catch {
  console.error('  x not a git work tree (import-graph requires git ls-files)');
  process.exit(1);
}

const imports = new Map();     // file -> { resolved: Set<file>, unresolved: Set<raw>, dynamicSkipped: number, bare: Set<raw> }
const importedBy = new Map();  // file -> Set<file>
let scanned = 0, skippedBig = 0, skippedBin = 0, unreadable = 0;
let edgeCount = 0, unresolvedCount = 0, dynamicSkippedTotal = 0, bareCount = 0;
const skipLines = [];

for (const f of files.sort()) {
  const ext = extname(f).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) continue; // out of scope for this generator entirely — never noted
  let buf;
  try { buf = readFileSync(join(root, f)); } catch { skipLines.push(`${f} (unreadable)`); unreadable++; continue; }
  if (buf.length > maxKb * 1024) { skipLines.push(`${f} (skipped: >${maxKb} KB)`); skippedBig++; continue; }
  if (buf.subarray(0, 8000).includes(0)) { skipLines.push(`${f} (binary)`); skippedBin++; continue; }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  scanned++;

  const entry = { resolved: new Set(), unresolved: new Set(), dynamicSkipped: 0, bare: new Set() };
  for (const e of importEdges(text, ext, f, existsInRoot)) {
    if (e.dynamic) { entry.dynamicSkipped++; continue; }
    if (e.target) entry.resolved.add(e.target);
    else if (e.relative) entry.unresolved.add(e.spec);
    else entry.bare.add(e.spec);
  }
  dynamicSkippedTotal += entry.dynamicSkipped;
  if (entry.resolved.size || entry.unresolved.size || entry.dynamicSkipped || entry.bare.size) imports.set(f, entry);
  bareCount += entry.bare.size;
  unresolvedCount += entry.unresolved.size;
  edgeCount += entry.resolved.size;
  for (const dep of entry.resolved) {
    if (!importedBy.has(dep)) importedBy.set(dep, new Set());
    importedBy.get(dep).add(f);
  }
}

// Union of files whose graph entry (imports or imported-by) touches --focus.
let focusFiles = null;
if (focus !== null) {
  const focusRel = relative(root, resolve(root, focus)).split(sep).join('/');
  const all = new Set([...imports.keys(), ...importedBy.keys()]);
  focusFiles = [...all].filter((f) => f === focusRel || f.startsWith(focusRel + '/')).sort();
}

const lines = [];
try {
  const sha = execFileSync('git', ['log', '-1', '--format=%H'], { cwd: root, timeout: 10000 }).toString().trim();
  lines.push(`# IMPORT_GRAPH — generated at ${sha}${focus !== null ? ` (focused on ${focus})` : ''}`, '');
} catch {
  lines.push(`# IMPORT_GRAPH — generated (no HEAD sha available)${focus !== null ? ` (focused on ${focus})` : ''}`, '');
}
lines.push(...skipLines);
if (skipLines.length) lines.push('');

const bodyFiles = focusFiles ?? [...new Set([...imports.keys(), ...importedBy.keys()])].sort();
for (const f of bodyFiles) {
  const entry = imports.get(f);
  const rev = importedBy.get(f);
  if (!entry && !rev) continue;
  lines.push(f);
  if (entry?.resolved.size) { lines.push('  imports:'); for (const d of [...entry.resolved].sort()) lines.push(`    ${d}`); }
  if (entry?.unresolved.size) { lines.push('  unresolved:'); for (const u of [...entry.unresolved].sort()) lines.push(`    ${u}`); }
  if (entry?.bare.size) { lines.push('  bare:'); for (const b of [...entry.bare].sort()) lines.push(`    ${b}`); }
  if (entry?.dynamicSkipped) lines.push(`  dynamic import skipped (${entry.dynamicSkipped})`);
  if (rev?.size) { lines.push('  imported-by:'); for (const r of [...rev].sort()) lines.push(`    ${r}`); }
}

lines.push('', `— ${files.length} files: ${scanned} scanned, ${skippedBig} skipped (size), ${skippedBin} binary, ${unreadable} unreadable, `
  + `${edgeCount} edges, ${unresolvedCount} unresolved, ${dynamicSkippedTotal} dynamic-skipped, ${bareCount} bare specifiers.`);

try { writeFileSync(out, lines.join('\n') + '\n'); } catch (e) {
  console.error(`  x cannot write ${out}: ${e.message}`);
  process.exit(1);
}
console.log(`import graph written: ${out} (${files.length} files)`);
