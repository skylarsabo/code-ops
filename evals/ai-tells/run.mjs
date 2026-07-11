#!/usr/bin/env node
// AI-trace scanner regression eval — asserts scan-ai-tells flags a dirty PR body
// across categories, fails closed, and stays silent on a clean one with decoys
// (a lone em-dash, a real "Note:", a UUID).
//
//   node evals/ai-tells/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scanner = resolve(here, '..', '..', 'scripts', 'scan-ai-tells.mjs');
const dirty = join(here, 'dirty.md');
const clean = join(here, 'clean.md');
const codex = join(here, 'codex.md');
const run = (args) => spawnSync('node', [scanner, ...args], { encoding: 'utf8' });

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };

// Dirty: report-only to read categories, then gated to confirm fail-closed.
const d = run([dirty, '--report-only']);
const out = (d.stdout || '') + (d.stderr || '');
for (const cat of ['TRAILER', 'TOOL', 'EMOJI', 'EMDASH', 'PHRASE', 'BOILERPLATE']) {
  expect(out.includes(cat), `dirty.md should flag ${cat}, did not`);
}
expect(run([dirty]).status === 1, 'dirty.md should exit 1 (fail closed)');

// Codex/OpenAI must be treated as tooling trace too; this is the dual-host regression.
const cx = run([codex, '--report-only']);
const codexOut = (cx.stdout || '') + (cx.stderr || '');
expect(codexOut.includes('TRAILER'), 'codex.md should flag a Codex/OpenAI trailer');
expect(codexOut.includes('TOOL'), 'codex.md should flag a Codex tool marker');
expect(run([codex]).status === 1, 'codex.md should exit 1 (fail closed)');

// Clean (with decoys): no hits, exit 0.
const c = run([clean]);
expect(c.status === 0, `clean.md should exit 0, got ${c.status}`);
expect(/clean/.test(c.stdout || ''), 'clean.md should report clean');

if (fails.length) {
  console.error('FAIL — ai-tells eval:');
  for (const f of fails) console.error('  x ' + f);
  console.error('\n--- dirty output ---\n' + out);
  console.error('\n--- clean output ---\n' + ((c.stdout || '') + (c.stderr || '')));
  process.exit(1);
}
console.log('PASS — ai-tells eval: dirty flagged across categories + fails closed; clean (with decoys) stays silent.');
