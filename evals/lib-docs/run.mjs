#!/usr/bin/env node
// lib-docs engine eval — builds a throwaway node_modules fixture in a temp dir
// (node_modules is gitignored, so we synthesize it) and asserts the engine resolves
// the INSTALLED version, returns the topic-matched README section + extracted type
// exports, and stays local-only (--no-fetch, zero network).
//
//   node evals/lib-docs/run.mjs   (exit 0 = pass)

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const engine = resolve(here, '..', '..', 'scripts', 'lib-docs.mjs');

const root = mkdtempSync(join(tmpdir(), 'lib-docs-'));
const pkg = join(root, 'node_modules', 'acme-widgets');
mkdirSync(pkg, { recursive: true });
writeFileSync(join(pkg, 'package.json'), JSON.stringify({
  name: 'acme-widgets', version: '2.3.1',
  description: 'Widgets for the Acme platform.',
  homepage: 'https://acme.example/widgets', types: 'index.d.ts',
}, null, 2));
writeFileSync(join(pkg, 'README.md'), [
  '# acme-widgets', '',
  'Widgets for the Acme platform — a small toolkit for building and rendering widgets.', '',
  '## Install', '', '    npm install acme-widgets', '',
  '## Usage', '',
  "    import { makeWidget } from 'acme-widgets';",
  "    const w = makeWidget({ size: 'lg', label: 'Hello' });",
  '    console.log(w.render());', '',
  '## API', '',
  'makeWidget(options) returns a Widget. See the bundled type declarations for the full surface.', '',
].join('\n'));
writeFileSync(join(pkg, 'index.d.ts'), [
  "export interface WidgetOptions { size: 'sm' | 'md' | 'lg'; label?: string; }",
  'export interface Widget { id: string; render(): string; }',
  'export declare function makeWidget(opts: WidgetOptions): Widget;',
].join('\n'));

const fails = [];
const expect = (c, m) => { if (!c) fails.push(m); };
const run = (args) => spawnSync('node', [engine, ...args], { encoding: 'utf8' });

const r = run(['acme-widgets', 'usage', '--root', root, '--no-fetch']);
const out = r.stdout || '';
expect(r.status === 0, `exit 0, got ${r.status}`);
expect(out.includes('2.3.1'), 'resolves the installed version 2.3.1');
expect(out.includes('source: local'), 'reports local source (no fetch)');
expect(out.includes('makeWidget'), 'extracts the exported type signature');
expect(/##\s*Usage/i.test(out) && out.includes('makeWidget({'), 'returns the Usage section for the topic');

const r2 = run(['no-such-lib-xyz', '--root', root, '--no-fetch']);
expect(/not installed/.test(r2.stdout || ''), 'reports not-installed for a missing lib under --no-fetch (zero network)');

rmSync(root, { recursive: true, force: true });
if (fails.length) {
  console.error('FAIL — lib-docs eval:');
  for (const f of fails) console.error('  x ' + f);
  console.error('\n--- output ---\n' + out);
  process.exit(1);
}
console.log('PASS — lib-docs eval: resolves installed version + topic README + type exports, local-only.');
