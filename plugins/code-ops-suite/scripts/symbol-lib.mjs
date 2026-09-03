// Dependency-free symbol primitives shared by repo-map.mjs, import-graph.mjs, skim.mjs, and
// context-query.mjs: the per-language definition rules, definition spans, call sites, and import
// edges for one file's text. This file is the single source of all four.
//
// Coarse by design, and the ceiling is part of the contract: every rule is a line regex, not a
// parse. A definition is a line that starts a function, class, or const; its span ends where
// braces balance (JavaScript family) or indentation returns (Python), else at the next
// definition. A call is an identifier followed by `(` outside a comment line. No dynamic
// dispatch, no type resolution, no string-built names. Consumers say so in their output.

import { posix } from 'node:path';

const JS_DEFS = [
  [/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'fn'],
  [/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/, 'const'],
];
const JS = { defs: JS_DEFS, imports: /^\s*(?:import[\s({]|(?:const|let|var)\s+.*\brequire\()/, exports: /^\s*(?:export\b|module\.exports\b)/, scope: 'braces' };
export const CODE = {
  '.js': JS, '.mjs': JS, '.cjs': JS, '.jsx': JS, '.ts': JS, '.tsx': JS,
  '.py': { defs: [[/^(?:async\s+)?def\s+(\w+)/, 'def'], [/^class\s+(\w+)/, 'class']], imports: /^\s*(?:import|from)\s/, exports: null, scope: 'indent' },
  '.go': { defs: [[/^func\s+(?:\([^)]*\)\s*)?(\w+)/, 'func'], [/^type\s+(\w+)/, 'type']], imports: /^\s*import[\s(]/, exports: null, scope: 'braces' },
  '.rs': {
    defs: [
      [/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/, 'fn'],
      [/^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+(\w+)/, 'type'],
      [/^impl(?:<[^>]*>)?\s+([\w:]+)/, 'impl'],
    ],
    imports: /^\s*(?:pub\s+)?use\s/, exports: null, scope: 'braces',
  },
  '.java': { defs: [[/^\s{0,4}(?:public|protected|private)?\s*(?:abstract\s+|static\s+|final\s+|sealed\s+)*(?:class|interface|record|enum)\s+(\w+)/, 'type']], imports: /^\s*import\s/, exports: null, scope: 'braces' },
  '.cs': { defs: [[/^\s{0,4}(?:public|internal|protected|private)?\s*(?:abstract\s+|static\s+|sealed\s+|partial\s+)*(?:class|interface|record|struct|enum)\s+(\w+)/, 'type']], imports: /^\s*using\s+[A-Za-z_]/, exports: null, scope: 'braces' },
};

export const isCodeExt = (ext) => Object.hasOwn(CODE, ext);

const COMMENT_LINE = /^\s*(?:\/\/|#|\*|\/\*)/;
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'new', 'typeof', 'await', 'async', 'import', 'export',
  'delete', 'void', 'throw', 'yield', 'else', 'do', 'try', 'with', 'class', 'super', 'elif', 'def', 'lambda', 'not', 'and', 'or', 'in', 'is',
  'print', 'require', 'match', 'fn', 'func', 'let', 'const', 'var', 'go', 'defer', 'select', 'case', 'loop', 'unsafe']);
const BARE_CALL = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g;
const MEMBER_CALL = /\.([A-Za-z_$][\w$]*)\s*\(/g;

// Definitions with spans: [{ name, kind, line, end, sig }], 1-based and inclusive.
export function definitions(text, ext) {
  const rules = CODE[ext];
  if (!rules) return [];
  const lines = text.split('\n');
  const defs = [];
  for (let i = 0; i < lines.length; i++) {
    for (const [re, kind] of rules.defs) {
      const m = re.exec(lines[i]);
      if (m) { defs.push({ name: m[1], kind, line: i + 1, end: i + 1, sig: lines[i].trim().slice(0, 120) }); break; }
    }
  }
  for (let d = 0; d < defs.length; d++) {
    const start = defs[d].line - 1;
    const limit = d + 1 < defs.length ? defs[d + 1].line - 2 : lines.length - 1;
    defs[d].end = spanEnd(lines, start, limit, rules.scope) + 1;
  }
  return defs;
}

// Where a definition's body ends: braces balance for the brace languages, the first later line
// at the same or a lesser indent for Python, and never past the next definition.
function spanEnd(lines, start, limit, scope) {
  if (scope === 'indent') {
    const indent = lines[start].search(/\S/);
    for (let i = start + 1; i <= limit; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      if (line.search(/\S/) <= indent) return i - 1;
    }
    return limit;
  }
  let depth = 0;
  let opened = false;
  for (let i = start; i <= limit; i++) {
    for (const ch of stripStringsAndComments(lines[i])) {
      if (ch === '{') { depth++; opened = true; } else if (ch === '}') depth--;
    }
    if (opened && depth <= 0) return i;
    if (!opened && i > start && /^\S/.test(lines[i])) return i - 1;
  }
  return limit;
}

// Removes string literals and a trailing line comment, so a brace inside them does not count.
function stripStringsAndComments(line) {
  return line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$|#.*$/, '');
}

// Call sites: [{ name, line, member, from }] where `from` is the name of the enclosing
// definition, or null at top level.
export function calls(text, ext, defs = definitions(text, ext)) {
  const rules = CODE[ext];
  if (!rules) return [];
  const lines = text.split('\n');
  const out = [];
  let d = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (COMMENT_LINE.test(line)) continue;
    while (d < defs.length && defs[d].end < i + 1) d++;
    const from = defs.find((x, k) => k >= d && x.line <= i + 1 && x.end >= i + 1) ?? null;
    const own = defs.find((x) => x.line === i + 1);
    const seen = new Set();
    const clean = stripStringsAndComments(line);
    for (const m of clean.matchAll(BARE_CALL)) {
      const name = m[1];
      if (KEYWORDS.has(name) || (own && own.name === name) || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, line: i + 1, member: false, from: from ? from.name : null });
    }
    for (const m of clean.matchAll(MEMBER_CALL)) {
      const name = m[1];
      if (seen.has(`.${name}`)) continue;
      seen.add(`.${name}`);
      out.push({ name, line: i + 1, member: true, from: from ? from.name : null });
    }
  }
  return out;
}

// Extraction runs over the whole file text, not per line, so a multi-line `import {\n a,\n}
// from 'x'` is still caught. Every character class below admits a newline on purpose.
const JS_STATIC = /\bimport\s+([^'"();]*?)\s*from\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
const JS_EXPORT_FROM = /\bexport\b[^'"();]*?\bfrom\s+['"]([^'"]+)['"]/g;
const JS_REQUIRE = /(?:(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*)?require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const JS_DYNAMIC = /\bimport\s*\(\s*([\s\S]*?)\s*\)/g;
const JS_DYNAMIC_LITERAL = /^['"]([^'"]+)['"]$/;
const PY_FROM = /^\s*from\s+(\.{0,2}[\w.]*)\s+import\s+([^\n#]+)/gm;
const PY_IMPORT = /^\s*import\s+([\w.]+)/gm;
const GO_BLOCK = /^\s*import\s*\(([\s\S]*?)^\s*\)/gm;
const GO_SINGLE = /^\s*import\s+"([^"]+)"/gm;
const GO_QUOTED = /"([^"]+)"/g;
const RUST_MOD = /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm;
const RUST_USE = /^\s*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:{}*,\s]+?);/gm;
const JS_FAMILY = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];
const RESOLVE_EXTS = [...JS_FAMILY, '.json'];

// The extensions imports() reads edges from. import-graph.mjs walks exactly these, so the
// generator's scope and the library's coverage cannot drift apart.
export const IMPORT_EXTS = [...JS_FAMILY, '.py', '.go', '.rs'];

const names = (clause) => {
  if (!clause) return [];
  const inner = clause.includes('{') ? clause.slice(clause.indexOf('{') + 1, clause.indexOf('}')) : clause;
  // `a as b` binds b locally to the exported a; a bare `a` binds a to a.
  return inner.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^([\w$*]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
    return m ? { local: m[2] ?? m[1], imported: m[1] } : null;
  }).filter(Boolean);
};

// Import edges for one file: [{ spec, target, names: [{ local, imported }], relative, dynamic }].
// `target` is a repository path when the specifier resolves against `exists`, else null.
// `relative` marks a specifier that names a place in this tree, so a caller can tell an
// unresolved relative path from a package name it was never going to resolve. `dynamic` marks a
// non-literal `import(...)` argument, whose `spec` is the argument text as written: the edge is
// listed rather than dropped, because a reader has to know the file loads something.
export function imports(text, ext, file, exists) {
  const out = [];
  const dir = posix.dirname(file);
  const first = (candidates) => candidates.find((c) => exists(c)) ?? null;
  const edge = (spec, target, edgeNames, relative, dynamic = false) => out.push({ spec, target, names: edgeNames, relative, dynamic });

  // A relative JavaScript specifier lands on itself when it already carries a resolvable
  // extension, then on the extension appended, then on an index file under it. A bare path is
  // never a candidate on its own, because a directory of that name is not a file.
  const resolveJs = (spec) => {
    if (!spec.startsWith('.')) return null;
    const base = posix.normalize(posix.join(dir, spec));
    const candidates = RESOLVE_EXTS.some((e) => base.endsWith(e)) ? [base] : [];
    for (const e of RESOLVE_EXTS) candidates.push(base + e);
    for (const e of RESOLVE_EXTS) candidates.push(posix.join(base, `index${e}`));
    return first(candidates);
  };
  // Leading-dot depth first (one dot is the current package), then `<path>.py` and the package
  // `__init__.py`. An absolute module resolves the same way, so a module inside the tree is an
  // edge, while a third-party one simply finds nothing.
  const resolvePy = (mod) => {
    if (!mod.startsWith('.')) {
      const path = mod.split('.').join('/');
      return first([`${path}.py`, posix.join(path, '__init__.py')]);
    }
    const dots = /^\.+/.exec(mod)[0].length;
    let base = dir;
    for (let i = 1; i < dots; i++) base = posix.dirname(base);
    const rest = mod.slice(dots).split('.').filter(Boolean).join('/');
    if (!rest) return first([posix.join(base, '__init__.py')]);
    const path = posix.join(base, rest);
    return first([`${path}.py`, posix.join(path, '__init__.py')]);
  };
  // A Go specifier names a package, and only a dot-relative one names a place in this tree. The
  // coarse rule maps it to the sibling file of that name. A package is a directory, so a
  // specifier that names one stays unresolved rather than guessing the file inside it.
  const resolveGo = (spec) => (spec.startsWith('.') ? first([`${posix.normalize(posix.join(dir, spec))}.go`]) : null);
  // `mod x;` names a sibling source file, the one Rust form worth resolving here. A `use` path
  // needs crate-root knowledge (src/lib.rs against src/main.rs), so it stays a bare specifier.
  const resolveRustMod = (name) => first([posix.join(dir, `${name}.rs`), posix.join(dir, name, 'mod.rs')]);

  if (JS_FAMILY.includes(ext)) {
    for (const m of text.matchAll(JS_STATIC)) {
      const spec = m[2] ?? m[3];
      edge(spec, resolveJs(spec), names(m[1]), spec.startsWith('.'));
    }
    // A re-export binds no local name, so it carries an edge and no names.
    for (const m of text.matchAll(JS_EXPORT_FROM)) edge(m[1], resolveJs(m[1]), [], m[1].startsWith('.'));
    for (const m of text.matchAll(JS_REQUIRE)) edge(m[2], resolveJs(m[2]), names(m[1]), m[2].startsWith('.'));
    for (const m of text.matchAll(JS_DYNAMIC)) {
      const arg = m[1].trim();
      const literal = JS_DYNAMIC_LITERAL.exec(arg);
      if (literal) edge(literal[1], resolveJs(literal[1]), [], literal[1].startsWith('.'));
      else edge(arg, null, [], false, true);
    }
  } else if (ext === '.py') {
    for (const m of text.matchAll(PY_FROM)) edge(m[1], resolvePy(m[1]), names(m[2].replace(/[()]/g, '')), m[1].startsWith('.'));
    for (const m of text.matchAll(PY_IMPORT)) edge(m[1], resolvePy(m[1]), [], false);
  } else if (ext === '.go') {
    for (const m of text.matchAll(GO_BLOCK)) for (const q of m[1].matchAll(GO_QUOTED)) edge(q[1], resolveGo(q[1]), [], q[1].startsWith('.'));
    for (const m of text.matchAll(GO_SINGLE)) edge(m[1], resolveGo(m[1]), [], m[1].startsWith('.'));
  } else if (ext === '.rs') {
    for (const m of text.matchAll(RUST_MOD)) edge(m[1], resolveRustMod(m[1]), [], true);
    for (const m of text.matchAll(RUST_USE)) edge(m[1].replace(/\s+/g, ''), null, [], false);
  }
  return out;
}
