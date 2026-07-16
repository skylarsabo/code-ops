#!/usr/bin/env node
// Zero-dependency invariant guard (SUPPLY-002). The suite ships dependency-free Node ESM:
// every import must be a node: builtin or a local relative path. A third-party bare import
// would introduce an npm dependency-confusion / transitive-CVE surface — fail CI if one appears.
//
// WHY: a single accidental npm-style import reintroduces the whole supply-chain surface
// (dependency confusion, transitive CVEs) the suite exists to avoid; this is the mechanical
// backstop CI runs on every push, not a one-time audit.
//
//   node scripts/check-no-deps.mjs
//
// Exit: 0 = clean (only node: builtins and relative imports found), 1 = a third-party
// import was found.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The gap between `import` and `from` is bounded by `;`, NOT by a newline, so a multi-symbol
// import written across several lines is still caught. Covers static import/export-from, the
// bare side-effect import form, require(), and dynamic import().
export const IMPORT_RE = /(?:^|\n)\s*(?:import\b[^;]*?from|export\b[^;]*?from|import)\s*['"]([^'"]+)['"]/g;
export const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
export const DYNIMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const isThirdParty = (spec) => !spec.startsWith('node:') && !spec.startsWith('.') && !spec.startsWith('/');

// SCR-010: drop // and /* */ comments before matching, so an import written inside a comment is not
// a false positive. String-aware — a '/*' or '//' inside a string is NOT a comment — so the strip can
// never swallow real code (no fail-open). String contents are kept, so an import inside a string still
// matches (the gate stays fail-closed on that rarer case).
function stripComments(src) {
  let out = '', i = 0, q = null;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += (c2 ?? ''); i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

// Third-party (bare) specifiers imported by a source string. Exported so evals can test the matchers.
export function findThirdPartySpecs(text) {
  const out = [];
  const code = stripComments(text);
  for (const re of [IMPORT_RE, REQUIRE_RE, DYNIMPORT_RE]) {
    for (const m of code.matchAll(re)) if (isThirdParty(m[1])) out.push(m[1]);
  }
  return out;
}

function walk(dir, bad) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'docs') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, bad);
    else if (/\.(mjs|cjs|js)$/.test(e.name)) {
      for (const spec of findThirdPartySpecs(readFileSync(p, 'utf8'))) bad.push(`${p.slice(ROOT.length + 1)} -> ${spec}`);
    }
  }
}

// Run the gate only when invoked directly — kept importable so evals can unit-test the matchers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bad = [];
  walk(ROOT, bad); // SCR-018: scan the whole repo (node_modules/.git/docs skipped) so a new top-level code dir or root-level file is covered, matching the "any import" guarantee
  if (bad.length) {
    console.error('FAIL — third-party import(s) found (the suite must stay dependency-free):');
    for (const b of bad) console.error('  x ' + b);
    process.exit(1);
  }
  console.log('OK — zero-dependency invariant holds (only node: builtins and relative imports).');
}
