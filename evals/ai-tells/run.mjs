#!/usr/bin/env node
// AI-trace scanner regression eval — asserts scan-ai-tells flags a dirty PR body
// across categories, fails closed, and stays silent on a clean one with decoys
// (a lone em-dash, a real "Note:", a UUID).
//
//   node evals/ai-tells/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { dirname, resolve, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scanner = resolve(here, '..', '..', 'scripts', 'scan-ai-tells.mjs');
const dirty = join(here, 'dirty.md');
const clean = join(here, 'clean.md');
const codex = join(here, 'codex.md');
const baseline = join(here, 'baseline.md');
const baselineEdited = join(here, 'baseline-edited.md');
const baselineEditedAlias = `${here}${sep}.${sep}baseline-edited.md`;
const baselineGrowth = join(here, 'baseline-growth.md');
const emojiEdge = join(here, 'emoji-edge.md');
const textPictographs = join(here, 'text-pictographs.md');
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

// Layout glyphs are not emoji, and inherited punctuation does not become a new tell.
expect(!((c.stdout || '') + (c.stderr || '')).includes('EMOJI'), 'clean topology glyphs should not flag as emoji');
const edge = run([emojiEdge]);
expect(edge.status === 1 && /EMOJI/.test(edge.stdout || ''), 'keycap emoji should remain a blocking emoji finding');
const pictographs = run([textPictographs]);
expect(pictographs.status === 1 && /EMOJI/.test(pictographs.stdout || ''),
  'bare text-presentation pictographs should remain blocking emoji findings');
expect(run([baselineEdited]).status === 1, 'baseline-edited.md should retain the default absolute em-dash gate');
expect(run([baselineEdited, '--emdash-baseline-file', baseline]).status === 0,
  'a verified pre-edit baseline should subtract inherited em-dashes');
expect(run([baselineGrowth, '--emdash-baseline-file', baseline]).status === 1,
  'net growth of three em-dashes should still fail against a baseline');
const hardTellWithBaseline = run([codex, '--emdash-baseline-file', baseline]);
expect(hardTellWithBaseline.status === 1
  && /TRAILER/.test(hardTellWithBaseline.stdout || '')
  && /TOOL/.test(hardTellWithBaseline.stdout || ''),
  'a valid em-dash baseline must not suppress hard tells in the current target');
const sameFileBaseline = run([baselineEdited, '--emdash-baseline-file', baselineEditedAlias]);
expect(sameFileBaseline.status === 2,
  'an em-dash baseline resolving to the current target should fail closed');
expect(sameFileBaseline.stderr === 'x --emdash-baseline-file must resolve to a different file than the scan target\n',
  `same-file baseline should report the exact usage error, got ${JSON.stringify(sameFileBaseline.stderr)}`);
expect(run([baselineEdited, clean, '--emdash-baseline-file', baseline]).status === 2,
  'an em-dash baseline should reject multiple current targets');
const gitBaseline = run([baselineEdited, '--git', 'HEAD', '--emdash-baseline-file', baseline]);
expect(gitBaseline.status === 2,
  'an em-dash baseline should remain incompatible with --git when one file target is also present');
expect(gitBaseline.stderr === 'x --emdash-baseline-file requires exactly one file target and cannot be combined with --git\n',
  `--git incompatibility should report the exact usage error, got ${JSON.stringify(gitBaseline.stderr)}`);
expect(run([baselineEdited, '--emdash-baseline-file', join(here, 'missing.md')]).status === 2,
  'a missing em-dash baseline should fail closed');
const missingBaselineValue = run([baselineEdited, '--emdash-baseline-file']);
expect(missingBaselineValue.status === 2,
  'a missing em-dash baseline argument should fail closed');
expect(missingBaselineValue.stderr === 'x --emdash-baseline-file needs a file path\n',
  `missing baseline value should report the exact usage error, got ${JSON.stringify(missingBaselineValue.stderr)}`);
const optionBaselineValue = run([baselineEdited, '--emdash-baseline-file', '--report-only']);
expect(optionBaselineValue.status === 2,
  'an option-like em-dash baseline argument should fail closed');
expect(optionBaselineValue.stderr === 'x --emdash-baseline-file needs a file path\n',
  `option-like baseline value should report the exact usage error, got ${JSON.stringify(optionBaselineValue.stderr)}`);

if (fails.length) {
  console.error('FAIL — ai-tells eval:');
  for (const f of fails) console.error('  x ' + f);
  console.error('\n--- dirty output ---\n' + out);
  console.error('\n--- clean output ---\n' + ((c.stdout || '') + (c.stderr || '')));
  process.exit(1);
}
console.log('PASS — ai-tells eval: dirty flagged across categories + fails closed; clean (with decoys) stays silent.');
