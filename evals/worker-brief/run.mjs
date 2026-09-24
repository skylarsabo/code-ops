#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally, withDetail } from '../harness.mjs';

const script = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/worker-brief.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'co-worker-brief-'));
const { fails: failures, check } = tally(withDetail);
const run = (args) => { try { return { status: 0, out: execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (error) { return { status: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` }; } };
try {
  const invariant = join(scratch, 'doctrine.md'); const unit = join(scratch, 'unit.md');
  const out = join(scratch, 'brief.md'); const receiptPath = join(scratch, 'receipt.json');
  writeFileSync(invariant, 'Invariant café\n'); writeFileSync(unit, 'Inspect src/a.js\n');
  const build = ['build', '--unit-file', unit, '--invariant', invariant, '--max-prefix-bytes', '1000', '--max-unit-bytes', '1000', '--max-bytes', '2000', '--out', out, '--receipt', receiptPath];
  let result = run(build); const prompt = readFileSync(out); const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  check('invariants precede unit even when flags are reversed', result.status === 0 && prompt.toString().indexOf('Invariant café') < prompt.toString().indexOf('Inspect src/a.js'), result.out);
  check('receipt counts UTF-8 bytes including framing', receipt.bytes.total === prompt.length && receipt.bytes.prefix + receipt.bytes.unit === prompt.length);
  result = run(build);
  check('compilation and receipt are byte deterministic', result.status === 0 && readFileSync(out).equals(prompt) && JSON.stringify(JSON.parse(readFileSync(receiptPath, 'utf8'))) === JSON.stringify(receipt), result.out);
  result = run(['verify', '--out', out, '--receipt', receiptPath]); check('receipt verifies with current sources', result.status === 0, result.out);
  writeFileSync(unit, 'Inspect src/b.js\n'); result = run(build); const next = JSON.parse(readFileSync(receiptPath, 'utf8'));
  check('unit changes keep identical invariant prefix', result.status === 0 && next.prefixSha256 === receipt.prefixSha256 && next.promptSha256 !== receipt.promptSha256, result.out);
  writeFileSync(unit, 'Drift\n'); result = run(['verify', '--out', out, '--receipt', receiptPath]); check('source drift fails verification', result.status === 1 && /drift/.test(result.out), result.out);
  writeFileSync(unit, 'Inspect src/b.js\n'); const saved = readFileSync(out); writeFileSync(out, 'tampered');
  result = run(['verify', '--out', out, '--receipt', receiptPath]); check('prompt drift fails verification', result.status === 1 && /drift/.test(result.out), result.out); writeFileSync(out, saved);
  for (const flag of ['--max-prefix-bytes', '--max-unit-bytes', '--max-bytes']) {
    const overflow = build.slice(); overflow[overflow.indexOf(flag) + 1] = '1'; result = run(overflow);
    check(`${flag} overflow preserves complete prior output`, result.status === 1 && /budget exceeded/.test(result.out) && readFileSync(out).equals(saved), result.out);
  }
  const colliding = build.slice(); colliding[colliding.indexOf('--out') + 1] = invariant; result = run(colliding);
  check('source overwrite is rejected', result.status === 1 && /overwrite sources/.test(result.out), result.out);
  const invariantBytes = readFileSync(invariant);
  const caseColliding = build.slice(); caseColliding[caseColliding.indexOf('--out') + 1] = invariant.toUpperCase(); result = run(caseColliding);
  check('portable case alias cannot overwrite a source', result.status === 1 && /overwrite sources/.test(result.out)
    && readFileSync(invariant).equals(invariantBytes), result.out);
  const receiptCollision = build.slice(); receiptCollision[receiptCollision.indexOf('--receipt') + 1] = out.toUpperCase(); result = run(receiptCollision);
  check('portable case alias keeps prompt and receipt distinct', result.status === 1 && /out and receipt must differ/.test(result.out), result.out);
  const invalidBudget = build.slice(); invalidBudget[invalidBudget.indexOf('--max-bytes') + 1] = '9007199254740992'; result = run(invalidBudget);
  check('unsafe byte budget fails', result.status === 1 && /invalid total byte budget/.test(result.out), result.out);
  writeFileSync(unit, Buffer.from([0xff])); result = run(build); check('invalid UTF-8 fails instead of replacement', result.status === 1 && readFileSync(out).equals(saved), result.out);
} finally { rmSync(scratch, { recursive: true, force: true }); }
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('\nworker-brief eval passed');
