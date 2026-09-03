// Dependency-free symbol primitives shared by skim.mjs and context-query.mjs: the per-language
// definition rules, definition spans, call sites, and import edges for one file's text.
//
// Coarse by design, and the ceiling is part of the contract: every rule is a line regex, not a
// parse. A definition is a line that starts a function, class, or const; its span ends where
// braces balance (JavaScript family) or indentation returns (Python), else at the next
// definition. A call is an identifier followed by `(` outside a comment line. No dynamic
// dispatch, no type resolution, no string-built names. Consumers say so in their output.

import { posix } from 'node:path';

// The definition regexes of scripts/repo-map.mjs, kept in step with it: repo-map walks the
// tree at import time, so it cannot be imported for its table alone.
// deferred(repo-map.mjs and import-graph.mjs keep their own copies of these rules, migrate both onto this library once evals/context-query covers every language they support)
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

const JS_STATIC = /\bimport\s+([^'"();]*?)\s*from\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
const JS_REQUIRE = /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const PY_FROM = /^\s*from\s+(\.{0,2}[\w.]*)\s+import\s+([^\n#]+)/gm;
const RESOLVE_EXTS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];

const names = (clause) => {
  if (!clause) return [];
  const inner = clause.includes('{') ? clause.slice(clause.indexOf('{') + 1, clause.indexOf('}')) : clause;
  // `a as b` binds b locally to the exported a; a bare `a` binds a to a.
  return inner.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = /^([\w$*]+)(?:\s+as\s+([\w$]+))?$/.exec(s);
    return m ? { local: m[2] ?? m[1], imported: m[1] } : null;
  }).filter(Boolean);
};

// Import edges for one file: [{ spec, target, names: [{ local, imported }] }], where target is
// a repository path when the specifier is relative and resolves against `exists`, else null.
export function imports(text, ext, file, exists) {
  const out = [];
  const resolveJs = (spec) => {
    if (!spec.startsWith('.')) return null;
    const base = posix.normalize(posix.join(posix.dirname(file), spec));
    const candidates = [base, ...RESOLVE_EXTS.map((e) => base + e), ...RESOLVE_EXTS.map((e) => posix.join(base, `index${e}`))];
    return candidates.find((c) => exists(c)) ?? null;
  };
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) {
    for (const m of text.matchAll(JS_STATIC)) {
      const spec = m[2] ?? m[3];
      out.push({ spec, target: resolveJs(spec), names: names(m[1]) });
    }
    for (const m of text.matchAll(JS_REQUIRE)) out.push({ spec: m[2], target: resolveJs(m[2]), names: names(m[1]) });
  } else if (ext === '.py') {
    for (const m of text.matchAll(PY_FROM)) {
      const mod = m[1];
      let target = null;
      if (mod.startsWith('.')) {
        const up = mod.match(/^\.+/)[0].length - 1;
        let dir = posix.dirname(file);
        for (let i = 0; i < up; i++) dir = posix.dirname(dir);
        const rel = mod.slice(up + 1).split('.').filter(Boolean).join('/');
        const base = rel ? posix.join(dir, rel) : dir;
        target = [`${base}.py`, posix.join(base, '__init__.py')].find((c) => exists(c)) ?? null;
      } else {
        const base = mod.split('.').join('/');
        target = [`${base}.py`, posix.join(base, '__init__.py')].find((c) => exists(c)) ?? null;
      }
      out.push({ spec: mod, target, names: names(m[2].replace(/[()]/g, '')) });
    }
  }
  return out;
}
