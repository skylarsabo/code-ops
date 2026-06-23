#!/usr/bin/env node
// research-manifest eval — pins the researcher plugin's egress-disclosure gate:
// a recorded request validates clean; an artifact citing an UNRECORDED web source fails
// closed; a local-only artifact (no web citations) passes.
//
//   node evals/research-manifest/run.mjs   (exit 0 = pass)

import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tool = resolve(here, '..', '..', 'scripts', 'research-manifest.mjs');
const dir = mkdtempSync(join(tmpdir(), 'research-manifest-'));
const manifest = join(dir, 'EGRESS_MANIFEST.md');
const run = (args) => spawnSync('node', [tool, ...args], { encoding: 'utf8' });

const fails = [];
const expect = (c, m) => { if (!c) fails.push(m); };

// record an external request
const rec = run(['record', '--tool', 'deep-research', '--url', 'https://example.com/guide', '--why', 'researching X', '--manifest', manifest]);
expect(rec.status === 0, `record should exit 0, got ${rec.status}`);
expect(existsSync(manifest) && /example\.com/.test(readFileSync(manifest, 'utf8')), 'manifest records the host');

// artifact citing the DISCLOSED source → pass
const ok = join(dir, 'brief-ok.md');
writeFileSync(ok, 'Per https://example.com/guide the pattern is sound. Also see src/lib.js:10.');
expect(run(['validate', ok, '--manifest', manifest]).status === 0, 'disclosed citation should pass');

// artifact citing an UNDISCLOSED source → fail closed
const bad = join(dir, 'brief-bad.md');
writeFileSync(bad, 'According to https://evil.test/leak this is true.');
expect(run(['validate', bad, '--manifest', manifest]).status === 1, 'undisclosed citation should fail closed (exit 1)');
expect(run(['validate', bad, '--manifest', manifest, '--report-only']).status === 0, '--report-only should not gate');

// local-only artifact (no web citations) → pass even with no manifest
const local = join(dir, 'brief-local.md');
writeFileSync(local, 'Grounded entirely in src/auth.js:5 and the installed deps.');
expect(run(['validate', local, '--manifest', join(dir, 'nope.md')]).status === 0, 'local-only artifact passes (no egress to disclose)');

if (fails.length) {
  console.error('FAIL — research-manifest eval:');
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('PASS — research-manifest eval: record + disclosed pass, undisclosed fails closed, local-only passes.');
