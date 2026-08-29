#!/usr/bin/env node
// AI-trace scanner regression eval — asserts scan-ai-tells flags a dirty PR body
// across categories, fails closed, and stays silent on a clean one with decoys
// (a lone em-dash, a real "Note:", a UUID).
//
//   node evals/ai-tells/run.mjs   (exit 0 = pass)

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scanner = resolve(here, '..', '..', 'scripts', 'scan-ai-tells.mjs');
const dirty = join(here, 'dirty.md');
const clean = join(here, 'clean.md');
const codex = join(here, 'codex.md');
const baselineEdited = join(here, 'baseline-edited.md');
const emojiEdge = join(here, 'emoji-edge.md');
const textPictographs = join(here, 'text-pictographs.md');
const run = (args) => spawnSync('node', [scanner, ...args], { encoding: 'utf8' });

const historyRepo = mkdtempSync(join(tmpdir(), 'code-ops-ai-tells-'));
process.on('exit', () => rmSync(historyRepo, { recursive: true, force: true }));
const historyTarget = join(historyRepo, 'message.md');
const copiedTarget = join(historyRepo, 'copied-current.md');
const inheritedText = 'The established style uses one — two — three — four — five separators.\n';
execFileSync('git', ['init', '-q'], { cwd: historyRepo });
writeFileSync(historyTarget, inheritedText);
execFileSync('git', ['add', 'message.md'], { cwd: historyRepo });
execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
  'commit', '-qm', 'baseline'], { cwd: historyRepo });
const baselineRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: historyRepo, encoding: 'utf8' }).trim();
const unrelatedRevision = execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
  'commit-tree', `${baselineRevision}^{tree}`], { cwd: historyRepo, encoding: 'utf8', input: 'unrelated baseline\n' }).trim();
writeFileSync(historyTarget, `${inheritedText}\nThe implementation now follows the approved topology.\n`);
copyFileSync(historyTarget, copiedTarget);

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
const historicalBaseline = run([historyTarget, '--emdash-baseline-rev', baselineRevision]);
expect(historicalBaseline.status === 0,
  `a Git-derived pre-edit baseline should subtract inherited em-dashes, got ${historicalBaseline.status}`);
const unrelatedBaseline = run([historyTarget, '--emdash-baseline-rev', unrelatedRevision]);
expect(unrelatedBaseline.status === 2
  && unrelatedBaseline.stderr === 'x --emdash-baseline-rev must resolve to an ancestor of HEAD\n',
  'an unrelated commit with identical target bytes must not become a synthesized baseline');
const sameFileBaseline = run([historyTarget, '--emdash-baseline-file', historyTarget]);
expect(sameFileBaseline.status === 2
  && sameFileBaseline.stderr === 'x unknown argument: --emdash-baseline-file\n',
  'the removed arbitrary-file baseline must reject the current target itself');
const copiedFileBaseline = run([historyTarget, '--emdash-baseline-file', copiedTarget]);
expect(copiedFileBaseline.status === 2
  && copiedFileBaseline.stderr === 'x unknown argument: --emdash-baseline-file\n',
  'the removed arbitrary-file baseline must reject an identical copied target');
writeFileSync(historyTarget, `${inheritedText}\nNew separators — six — seven — eight.\n`);
expect(run([historyTarget, '--emdash-baseline-rev', baselineRevision]).status === 1,
  'net growth of three em-dashes should still fail against a historical baseline');
writeFileSync(historyTarget, `${inheritedText}\nGenerated with Codex.\n`);
const hardTellWithBaseline = run([historyTarget, '--emdash-baseline-rev', baselineRevision]);
expect(hardTellWithBaseline.status === 1
  && /TRAILER/.test(hardTellWithBaseline.stdout || '')
  && /TOOL/.test(hardTellWithBaseline.stdout || ''),
  'a valid historical baseline must not suppress hard tells in the current target');
expect(run([historyTarget, clean, '--emdash-baseline-rev', baselineRevision]).status === 2,
  'a historical em-dash baseline should reject multiple current targets');
const gitBaseline = run([historyTarget, '--git', 'HEAD', '--emdash-baseline-rev', baselineRevision]);
expect(gitBaseline.status === 2,
  'a historical em-dash baseline should remain incompatible with --git when one file target is also present');
expect(gitBaseline.stderr === 'x --emdash-baseline-rev requires exactly one file target and cannot be combined with --git\n',
  `--git incompatibility should report the exact usage error, got ${JSON.stringify(gitBaseline.stderr)}`);
const missingBaselineValue = run([historyTarget, '--emdash-baseline-rev']);
expect(missingBaselineValue.status === 2,
  'a missing historical baseline argument should fail closed');
expect(missingBaselineValue.stderr === 'x --emdash-baseline-rev needs a revision\n',
  `missing baseline value should report the exact usage error, got ${JSON.stringify(missingBaselineValue.stderr)}`);
const optionBaselineValue = run([historyTarget, '--emdash-baseline-rev', '--report-only']);
expect(optionBaselineValue.status === 2,
  'an option-like historical baseline argument should fail closed');
expect(optionBaselineValue.stderr === 'x --emdash-baseline-rev needs a revision\n',
  `option-like baseline value should report the exact usage error, got ${JSON.stringify(optionBaselineValue.stderr)}`);
execFileSync('git', ['rm', '--cached', '-fq', '--', 'message.md'], { cwd: historyRepo });
const untrackedBaseline = run([historyTarget, '--emdash-baseline-rev', baselineRevision]);
expect(untrackedBaseline.status === 2
  && untrackedBaseline.stderr === 'x --emdash-baseline-rev requires a tracked target in a Git repository\n',
  'a historical path recreated as an untracked file must not qualify for a baseline');

if (fails.length) {
  console.error('FAIL — ai-tells eval:');
  for (const f of fails) console.error('  x ' + f);
  console.error('\n--- dirty output ---\n' + out);
  console.error('\n--- clean output ---\n' + ((c.stdout || '') + (c.stderr || '')));
  process.exit(1);
}
console.log('PASS — ai-tells eval: dirty flagged across categories + fails closed; clean (with decoys) stays silent.');
