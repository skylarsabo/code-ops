#!/usr/bin/env node
// Zero-dependency invariant guard (SUPPLY-002). The suite ships dependency-free Node ESM:
// every import must be a node: builtin or a local relative path. A third-party bare import
// would introduce an npm dependency-confusion / transitive-CVE surface — fail CI if one appears.
//
//   node scripts/check-no-deps.mjs   (exit 0 = clean)

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

// Third-party (bare) specifiers imported by a source string. Exported so evals can test the matchers.
export function findThirdPartySpecs(text) {
  const out = [];
  for (const re of [IMPORT_RE, REQUIRE_RE, DYNIMPORT_RE]) {
    for (const m of text.matchAll(re)) if (isThirdParty(m[1])) out.push(m[1]);
  }
  return out;
}

function walk(dir, bad) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
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
  for (const d of ['scripts', 'evals', 'plugins']) walk(join(ROOT, d), bad);
  if (bad.length) {
    console.error('FAIL — third-party import(s) found (the suite must stay dependency-free):');
    for (const b of bad) console.error('  x ' + b);
    process.exit(1);
  }
  console.log('OK — zero-dependency invariant holds (only node: builtins and relative imports).');
}
