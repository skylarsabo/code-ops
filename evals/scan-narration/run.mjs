#!/usr/bin/env node
// Run-artifact narration scanner regression eval — asserts scan-narration.mjs stays quiet on
// a compact summary, flags an over-length report at both the advisory and hard bounds, fails
// closed on process-narration, reports table-restatement and filler as advisories only, and
// never trips PROCESS-NARRATION on the "I/O throughput" false-positive guard case.
//
//   node evals/scan-narration/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scanner = resolve(here, '..', '..', 'scripts', 'scan-narration.mjs');
const clean = join(here, 'clean.md');
const processNarration = join(here, 'process-narration.md');
const filler = join(here, 'filler.md');
const ioThroughput = join(here, 'io-throughput.md');
const tableRestatement = join(here, 'EXECUTIVE_SUMMARY_TABLE.md');
const advisory61 = join(here, 'advisory-61.md');
const hard121 = join(here, 'hard-121.md');
const run = (args) => spawnSync('node', [scanner, ...args], { encoding: 'utf8' });

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };

// Clean compact summary: no hits, exit 0.
const c = run([clean]);
expect(c.status === 0, `clean.md should exit 0, got ${c.status}`);
expect(/clean/.test(c.stdout || ''), 'clean.md should report clean');

// Advisory-only length (61+ non-blank lines): reported, but exit 0.
const a61 = run([advisory61]);
expect(a61.status === 0, `advisory-61.md should exit 0 (advisory only), got ${a61.status}`);
expect(/LENGTH/.test(a61.stdout || ''), 'advisory-61.md should flag LENGTH');

// Hard length (121+ non-blank lines): exit 1.
const h121 = run([hard121]);
expect(h121.status === 1, `hard-121.md should exit 1 (hard bound), got ${h121.status}`);
expect(/LENGTH/.test(h121.stdout || ''), 'hard-121.md should flag LENGTH');

// Process-narration: hard violation, exit 1 (fail-closed) even without --report-only.
const pn = run([processNarration]);
expect(pn.status === 1, `process-narration.md should exit 1 (fail closed), got ${pn.status}`);
expect(/PROCESS-NARRATION/.test(pn.stdout || ''), 'process-narration.md should flag PROCESS-NARRATION');

// Table-restatement inside an EXECUTIVE_SUMMARY-shaped file: advisory only, exit 0.
const tr = run([tableRestatement]);
expect(tr.status === 0, `EXECUTIVE_SUMMARY_TABLE.md should exit 0 (advisory only), got ${tr.status}`);
expect(/RESTATEMENT/.test(tr.stdout || ''), 'EXECUTIVE_SUMMARY_TABLE.md should flag RESTATEMENT');

// Filler: advisory only, exit 0.
const f = run([filler]);
expect(f.status === 0, `filler.md should exit 0 (advisory only), got ${f.status}`);
expect(/FILLER/.test(f.stdout || ''), 'filler.md should flag FILLER');

// False-positive guard: "I/O throughput" must never trip PROCESS-NARRATION (or any category).
const io = run([ioThroughput]);
expect(io.status === 0, `io-throughput.md should exit 0, got ${io.status}`);
expect(!/PROCESS-NARRATION/.test(io.stdout || ''), 'io-throughput.md must not flag PROCESS-NARRATION (I/O false-positive guard)');
expect(/clean/.test(io.stdout || ''), 'io-throughput.md should report clean');

// Usage/config errors still fail closed at exit 2.
const missing = run([join(here, 'does-not-exist.md')]);
expect(missing.status === 2, `missing file should exit 2, got ${missing.status}`);
const unknownFlag = run([clean, '--bogus']);
expect(unknownFlag.status === 2, `unknown flag should exit 2, got ${unknownFlag.status}`);

if (fails.length) {
  console.error('FAIL — scan-narration eval:');
  for (const fmsg of fails) console.error('  x ' + fmsg);
  console.error('\n--- process-narration output ---\n' + ((pn.stdout || '') + (pn.stderr || '')));
  console.error('\n--- clean output ---\n' + ((c.stdout || '') + (c.stderr || '')));
  process.exit(1);
}
console.log('PASS — scan-narration eval: length bounds, narration/filler/restatement categories, exit discipline, and the I/O false-positive guard all hold.');
