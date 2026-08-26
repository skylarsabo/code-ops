#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = resolve(repo, 'scripts', 'benchmark-command.mjs');
const failures = [];
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`);
  if (!pass) failures.push(`${name}: ${detail}`);
};
const run = (args) => {
  try {
    return { status: 0, out: execFileSync(process.execPath, [script, ...args], { cwd: repo, encoding: 'utf8' }) };
  } catch (error) {
    return { status: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
};

const measured = run([
  '--runs', '3', '--warmup', '1', '--timeout-ms', '5000', '--json', '--',
  process.execPath, '-e', 'process.exit(0)',
]);
let report;
try { report = JSON.parse(measured.out); } catch { report = null; }
check('a. JSON report records the full measurement protocol',
  measured.status === 0
    && report?.version === 1
    && report?.protocol?.runs === 3
    && report?.protocol?.warmup === 1
    && report?.protocol?.timeoutMs === 5000,
  measured.out);
const orderedSamples = [...(report?.samplesMs || [])].sort((left, right) => left - right);
const expectedSummary = orderedSamples.length === 3 ? {
  minMs: orderedSamples[0],
  medianMs: orderedSamples[1],
  p95Ms: orderedSamples[2],
  maxMs: orderedSamples[2],
} : null;
check('b. JSON report includes every sample and ordered summary metrics',
  report?.samplesMs?.length === 3
    && report.samplesMs.every((sample) => sample > 0)
    && JSON.stringify(report.summary) === JSON.stringify(expectedSummary),
  measured.out);
check('c. environment fingerprint identifies the runtime',
  report?.environment?.node === process.version
    && report?.environment?.platform === process.platform
    && Number.isInteger(report?.environment?.logicalCpuCount)
    && report?.workingDirectory === 'current'
    && !measured.out.includes(repo),
  measured.out);

const failed = run(['--runs', '1', '--warmup', '0', '--', process.execPath, '-e', 'process.exit(7)']);
check('d. a failing measured command fails the benchmark', failed.status === 1 && /sample 1 failed/.test(failed.out), failed.out);
const malformed = run(['--runs', '0', '--', process.execPath, '-e', 'process.exit(0)']);
check('e. invalid protocols are rejected before execution', malformed.status === 2 && /--runs is out of range/.test(malformed.out), malformed.out);
const missingSeparator = run([process.execPath, '-e', 'process.exit(0)']);
check('f. the command boundary is explicit', missingSeparator.status === 2 && /usage:/.test(missingSeparator.out), missingSeparator.out);
const unbounded = run(['--runs', '101', '--', process.execPath, '-e', 'process.exit(0)']);
check('g. repeat counts are bounded', unbounded.status === 2 && /--runs is out of range/.test(unbounded.out), unbounded.out);
const missingExecutable = run(['--runs', '1', '--warmup', '0', '--', 'code-ops-missing-executable']);
check('h. shell aliases and Windows shims receive an actionable refusal',
  missingExecutable.status === 1 && /pass an executable, not a shell alias or Windows \.cmd\/\.bat shim/.test(missingExecutable.out),
  missingExecutable.out);

if (failures.length) {
  console.error(`\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nbenchmark-command eval passed');
