#!/usr/bin/env node
// Proof-receipts regression eval — pins the two anti-cheat guards: run-proof.mjs (fabricated
// tool output: a receipt row per real run, replayed fail-closed on exit codes, with the
// ledger itself treated as an injection surface) and check-proof-integrity.mjs (add-only
// proof tests: hash pins that only an explicit, loudly-reported PROOF-AMENDED line may move).
// All fixtures are throwaway dirs under mkdtempSync — nothing in the repo is touched.
//
//   node evals/proof-receipts/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runProof = resolve(here, '..', '..', 'scripts', 'run-proof.mjs');
const proofIntegrity = resolve(here, '..', '..', 'scripts', 'check-proof-integrity.mjs');
const run = (args, cwd) => spawnSync('node', args, { cwd, encoding: 'utf8' });

const fails = [];
let count = 0;
function check(name, cond, detail) {
  count++;
  if (cond) { console.log('ok ' + name); return; }
  fails.push(name + (detail ? ` — ${String(detail).slice(0, 200)}` : ''));
  console.log('FAIL ' + name + (detail ? ` — ${String(detail).slice(0, 200)}` : ''));
}

const dirA = mkdtempSync(join(tmpdir(), 'run-proof-'));
const dirB = mkdtempSync(join(tmpdir(), 'proof-integrity-'));
let crashed = null;
try {
  // ---------------------------------------------------------------- run-proof
  const ledger = join(dirA, 'RUN_RECEIPTS.md');

  // (a) record: exit-code pass-through, teed output, well-formed appended rows.
  const r1 = run([runProof, 'record', '--receipts', ledger, '--', 'node', '-e', "console.log('tee-check')"], dirA);
  check('record passes through exit 0', r1.status === 0, `status ${r1.status}: ${r1.stderr}`);
  check('record tees the command stdout through', (r1.stdout || '').includes('tee-check'), r1.stdout);
  const r2 = run([runProof, 'record', '--receipts', ledger, '--', 'node', '-e', 'process.exit(1)'], dirA);
  check('record passes through exit 1', r2.status === 1, `status ${r2.status}`);
  const text = readFileSync(ledger, 'utf8');
  check('ledger created with the # Run receipts header', text.startsWith('# Run receipts'), text.split('\n')[0]);
  const rows = text.split('\n').filter((l) => l.startsWith('| RCPT-'));
  check('two receipt rows appended', rows.length === 2, `${rows.length} row(s)`);
  const ROW_RE = /^\| RCPT-\d{3,} \| \d{4}-\d{2}-\d{2}T[\d:.]+Z \| \S+ \| (-?\d+) \| [0-9a-f]{64} \| .+ \|$/;
  check('row 1 is well-formed (id/timestamp/head/exit/sha256/command)', ROW_RE.test(rows[0] || ''), rows[0]);
  check('row 2 records the failing exit code', ((rows[1] || '').match(ROW_RE) || [])[1] === '1', rows[1]);

  // Receipt 3 probes a file that exists NOW — its truthful exit code is 0 today.
  const flag = join(dirA, 'flag.txt');
  writeFileSync(flag, 'present\n');
  const probe = `process.exit(require('node:fs').existsSync('${flag.replace(/\\/g, '/')}')?0:1)`;
  const r3 = run([runProof, 'record', '--receipts', ledger, '--', 'node', '-e', probe], dirA);
  check('record captures the probe at exit 0', r3.status === 0, `status ${r3.status}: ${r3.stderr}`);

  // (b) verify passes on an honest ledger and prints each command before running it.
  const v1 = run([runProof, 'verify', ledger, '--root', dirA]);
  check('verify passes an honest ledger', v1.status === 0, (v1.stdout || '') + (v1.stderr || ''));
  check('verify prints each command before running it', ((v1.stdout || '').match(/\$ node /g) || []).length === 3, v1.stdout);

  // (c) fail closed when a recorded run no longer reproduces (exit code drifted 0 → 1).
  unlinkSync(flag);
  const v2 = run([runProof, 'verify', ledger, '--root', dirA]);
  check('verify fails closed when a receipt now exits differently', v2.status === 1, `status ${v2.status}`);
  check('the drifted receipt is reported as MISMATCH', /MISMATCH\s+RCPT-003/.test(v2.stdout || ''), v2.stdout);
  const v3 = run([runProof, 'verify', ledger, '--only', 'RCPT-001', '--root', dirA]);
  check('verify --only replays just the named receipt', v3.status === 0 && !/RCPT-003/.test(v3.stdout || ''), (v3.stdout || '') + (v3.stderr || ''));

  // (d) the ledger is an injection surface: refuse traversal and shell metacharacters.
  const badLedger = join(dirA, 'BAD_RECEIPTS.md');
  const zeros = '0'.repeat(64);
  writeFileSync(badLedger, [
    '# Run receipts', '',
    '| id | recorded (UTC) | head | exit | sha256(output) | command |',
    '| --- | --- | --- | --- | --- | --- |',
    `| RCPT-001 | 2026-07-06T00:00:00.000Z | unknown | 0 | ${zeros} | node ../evil.mjs |`,
    `| RCPT-002 | 2026-07-06T00:00:00.000Z | unknown | 0 | ${zeros} | node -e whatever;rm |`,
  ].join('\n') + '\n');
  const v4 = run([runProof, 'verify', badLedger, '--root', dirA]);
  check('verify refuses .. traversal and shell metacharacters (fail closed)', v4.status === 1, `status ${v4.status}`);
  check('both hostile rows are reported REFUSED, not executed', ((v4.stdout || '').match(/REFUSED/g) || []).length === 2 && !/\$ node/.test(v4.stdout || ''), v4.stdout);
  const v5 = run([runProof, 'verify', badLedger, '--root', dirA, '--report-only']);
  check('--report-only downgrades refusals to skip+warn (exit 0)', v5.status === 0 && /REFUSED/.test(v5.stdout || ''), `status ${v5.status}`);

  // ---------------------------------------------------------------- check-proof-integrity
  writeFileSync(join(dirB, 'a.txt'), 'alpha\n');
  writeFileSync(join(dirB, 'b.txt'), 'beta\n');
  const manifest = join(dirB, 'PROOF_MANIFEST.md');

  // (e) pin, verify, tamper, amend, delete.
  const p1 = run([proofIntegrity, 'record', manifest, 'FIND-001', 'a.txt', 'b.txt'], dirB);
  check('proof-integrity record pins both files', p1.status === 0, (p1.stdout || '') + (p1.stderr || ''));
  const p2 = run([proofIntegrity, 'verify', manifest, '--root', dirB]);
  check('proof-integrity verify passes on untouched files', p2.status === 0, (p2.stdout || '') + (p2.stderr || ''));
  writeFileSync(join(dirB, 'a.txt'), 'alpha, but the assertion is inverted now\n');
  const p3 = run([proofIntegrity, 'verify', manifest, '--root', dirB]);
  check('proof-integrity fails closed on a tampered file', p3.status === 1, `status ${p3.status}`);
  check('the tampered pin is reported TAMPERED', /TAMPERED\s+FIND-001/.test(p3.stdout || ''), p3.stdout);
  const newSha = createHash('sha256').update(readFileSync(join(dirB, 'a.txt'))).digest('hex');
  appendFileSync(manifest, `PROOF-AMENDED: FIND-001 ${newSha} fixture legitimately extended to cover the regression\n`);
  const p4 = run([proofIntegrity, 'verify', manifest, '--root', dirB]);
  check('a PROOF-AMENDED re-pin passes', p4.status === 0, (p4.stdout || '') + (p4.stderr || ''));
  check('the amendment is printed loudly even though it passes', /!! AMENDED/.test(p4.stdout || ''), p4.stdout);
  unlinkSync(join(dirB, 'b.txt'));
  const p5 = run([proofIntegrity, 'verify', manifest, '--root', dirB]);
  check('a missing pinned file fails closed (amendment cannot excuse absence)', p5.status === 1, `status ${p5.status}`);
  check('the missing pin is reported MISSING', /MISSING\s+FIND-001/.test(p5.stdout || ''), p5.stdout);
} catch (e) {
  crashed = e;
} finally {
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
}

if (crashed) {
  console.error('\nFAIL — proof-receipts eval crashed: ' + (crashed.stack || crashed));
  process.exit(1);
}
if (fails.length) {
  console.error(`\nFAIL — proof-receipts eval: ${fails.length}/${count} check(s) failing:`);
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log(`\nPASS — proof-receipts eval: ${count} checks — record tees + appends + passes exit codes through; verify replays fail-closed and refuses traversal/metacharacters; proof pins fail closed on tamper/deletion and only move via a loud PROOF-AMENDED.`);
