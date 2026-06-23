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
const bad = [];
const IMPORT_RE = /(?:^|\n)\s*(?:import\b[^;\n]*?from|export\b[^;\n]*?from|import)\s*['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(mjs|cjs|js)$/.test(e.name)) {
      const t = readFileSync(p, 'utf8');
      for (const re of [IMPORT_RE, REQUIRE_RE]) {
        for (const m of t.matchAll(re)) {
          const spec = m[1];
          if (!spec.startsWith('node:') && !spec.startsWith('.') && !spec.startsWith('/')) bad.push(`${p.slice(ROOT.length + 1)} -> ${spec}`);
        }
      }
    }
  }
}

for (const d of ['scripts', 'evals', 'plugins']) walk(join(ROOT, d));

if (bad.length) {
  console.error('FAIL — third-party import(s) found (the suite must stay dependency-free):');
  for (const b of bad) console.error('  x ' + b);
  process.exit(1);
}
console.log('OK — zero-dependency invariant holds (only node: builtins and relative imports).');
