#!/usr/bin/env node
// Import graph generator for orchestrated runs.
// WHY: blast-radius questions ("what breaks if I touch file X?") make operatives
// re-derive the import graph by search every time. This walks the tree ONCE (git
// ls-files, so .gitignore is respected), extracts import/require edges with
// coarse-but-honest regexes (a graph, not a bundler/resolver), and emits both
// directions (imports + imported-by) so a brief can hand over blast radius
// directly. Unresolved relative specifiers and dynamic/non-literal imports are
// always noted, never dropped. Reverse edges are computed in-memory from the
// forward edges after the walk — no recursive graph traversal, so an a<->b
// cycle is just two ordinary edges and can never hang the generator.
//   node scripts/import-graph.mjs [--root <dir>] [--out <file>] [--max-file-kb <N>] [--focus <path>]
// Exit 0 = graph written; 1 = bad invocation, unwritable --out, or not a git work tree.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, extname, dirname, relative, sep } from 'node:path';

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

const JS_EXTS = new Set(['.js', '.mjs', '.ts', '.jsx', '.tsx']);
const RESOLVE_EXTS = ['.js', '.mjs', '.ts', '.jsx', '.tsx', '.json'];
const SUPPORTED_EXTS = new Set([...JS_EXTS, '.py', '.go', '.rs']);

// Coarse-but-honest extraction regexes — whole-file text (not per-line), so a
// multi-line `import {\n  a,\n} from 'x'` is still caught (the char classes below
// aren't newline-excluding).
const JS_STATIC = /\bimport\s+(?:[^'"();]*?from\s+)?['"]([^'"]+)['"]/g;
const JS_EXPORT_FROM = /\bexport\b[^'"();]*?\bfrom\s+['"]([^'"]+)['"]/g;
const JS_REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const JS_DYNIMPORT_CALL = /\bimport\s*\(\s*([\s\S]*?)\s*\)/g;
const JS_DYNIMPORT_LITERAL = /^['"]([^'"]+)['"]$/;
const PY_FROM = /^\s*from\s+(\.{0,2}[\w.]*)\s+import\b/gm;
const PY_IMPORT = /^\s*import\s+([\w.]+)/gm;
const GO_IMPORT_BLOCK = /^\s*import\s*\(([\s\S]*?)^\s*\)/gm;
const GO_IMPORT_SINGLE = /^\s*import\s+"([^"]+)"/gm;
const GO_QUOTED = /"([^"]+)"/g;
const RUST_MOD = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm;
const RUST_USE = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:{}*,\s]+?);/gm;

// Extracts {specs: [{raw, relative}], dynamicSkipped} for one file's text. `relative`
// marks specifiers this generator will attempt to resolve to a repo file; everything
// else is a bare specifier (package, node: builtin, unresolvable Go/Rust use-path) —
// counted in the footer, never turned into an edge.
function extractSpecs(ext, text) {
  const specs = [];
  let dynamicSkipped = 0;
  if (JS_EXTS.has(ext)) {
    for (const re of [JS_STATIC, JS_EXPORT_FROM, JS_REQUIRE]) {
      for (const m of text.matchAll(re)) specs.push({ raw: m[1], relative: m[1].startsWith('.') });
    }
    for (const m of text.matchAll(JS_DYNIMPORT_CALL)) {
      const arg = m[1].trim();
      const lit = JS_DYNIMPORT_LITERAL.exec(arg);
      if (lit) specs.push({ raw: lit[1], relative: lit[1].startsWith('.') });
      else dynamicSkipped++;
    }
  } else if (ext === '.py') {
    for (const m of text.matchAll(PY_FROM)) if (m[1]) specs.push({ raw: m[1], relative: m[1].startsWith('.') });
    for (const m of text.matchAll(PY_IMPORT)) specs.push({ raw: m[1], relative: false });
  } else if (ext === '.go') {
    for (const m of text.matchAll(GO_IMPORT_BLOCK)) for (const q of m[1].matchAll(GO_QUOTED)) specs.push({ raw: q[1], relative: false });
    for (const m of text.matchAll(GO_IMPORT_SINGLE)) specs.push({ raw: m[1], relative: false });
  } else if (ext === '.rs') {
    // mod decls name a sibling source file — the one Rust form worth resolving here.
    for (const m of text.matchAll(RUST_MOD)) specs.push({ raw: m[1], relative: true, rustMod: true });
    // `use` paths need crate-root knowledge (src/lib.rs vs src/main.rs) to resolve
    // honestly; counted as bare rather than guessed.
    for (const m of text.matchAll(RUST_USE)) specs.push({ raw: m[1].replace(/\s+/g, ''), relative: false });
  }
  return { specs, dynamicSkipped };
}

// Resolves a relative specifier from `fromFile` (repo-relative, posix) to a repo-relative
// path, or null if nothing on disk matches. JS tries the specifier as-is, with each
// resolvable extension appended, and as an index file under it. Python follows leading-dot
// depth (one dot = current package) then tries `<path>.py` / `<path>/__init__.py`. Rust
// `mod x;` tries `x.rs` / `x/mod.rs` next to the declaring file.
function resolveRelative(ext, fromFile, raw, rustMod) {
  const fromDir = dirname(join(root, fromFile));
  const toRepoRel = (abs) => relative(root, abs).split(sep).join('/');
  if (ext === '.py') {
    const dots = /^\.+/.exec(raw)[0].length;
    const rest = raw.slice(dots);
    let dir = fromDir;
    for (let i = 1; i < dots; i++) dir = dirname(dir);
    if (!rest) {
      const init = join(dir, '__init__.py');
      return existsSync(init) ? toRepoRel(init) : null;
    }
    const relPath = rest.replace(/\./g, sep);
    for (const c of [join(dir, relPath + '.py'), join(dir, relPath, '__init__.py')]) {
      if (existsSync(c)) return toRepoRel(c);
    }
    return null;
  }
  if (ext === '.rs' && rustMod) {
    for (const c of [join(fromDir, raw + '.rs'), join(fromDir, raw, 'mod.rs')]) {
      if (existsSync(c)) return toRepoRel(c);
    }
    return null;
  }
  // JS/TS family.
  const target = join(fromDir, raw);
  const candidates = [];
  if (RESOLVE_EXTS.some((e) => target.endsWith(e))) candidates.push(target);
  for (const e of RESOLVE_EXTS) candidates.push(target + e);
  for (const e of RESOLVE_EXTS) candidates.push(join(target, 'index' + e));
  for (const c of candidates) if (existsSync(c)) return toRepoRel(c);
  return null;
}

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

  const { specs, dynamicSkipped } = extractSpecs(ext, text);
  const entry = { resolved: new Set(), unresolved: new Set(), dynamicSkipped, bare: new Set() };
  dynamicSkippedTotal += dynamicSkipped;
  for (const s of specs) {
    if (!s.relative) { entry.bare.add(s.raw); continue; }
    const resolvedPath = resolveRelative(ext, f, s.raw, s.rustMod);
    if (resolvedPath) entry.resolved.add(resolvedPath);
    else entry.unresolved.add(s.raw);
  }
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
