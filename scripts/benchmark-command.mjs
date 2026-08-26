#!/usr/bin/env node
// Runs one command repeatedly without a shell and reports portable wall-time evidence.
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

const LIMITS = { runs: 100, warmup: 20, timeoutMs: 15 * 60 * 1000 };

function die(message, code = 1) {
  console.error(`x ${message}`);
  process.exit(code);
}

function usage() {
  die('usage: benchmark-command.mjs [--runs <n>] [--warmup <n>] [--timeout-ms <n>] [--cwd <dir>] [--json] -- <executable> [args ...]', 2);
}

function boundedInteger(value, name, { allowZero = false, max }) {
  if (!/^\d+$/.test(value || '')) usage();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed < 1) || parsed > max) die(`${name} is out of range`, 2);
  return parsed;
}

function parse(argv) {
  const split = argv.indexOf('--');
  if (split < 0 || split === argv.length - 1) usage();
  const flags = argv.slice(0, split);
  const command = argv.slice(split + 1);
  const options = { runs: 7, warmup: 1, timeoutMs: 120000, cwd: process.cwd(), json: false };
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (flag === '--json') { options.json = true; continue; }
    const value = flags[++i];
    if (!value || value.startsWith('--')) usage();
    if (flag === '--runs') options.runs = boundedInteger(value, '--runs', { max: LIMITS.runs });
    else if (flag === '--warmup') options.warmup = boundedInteger(value, '--warmup', { allowZero: true, max: LIMITS.warmup });
    else if (flag === '--timeout-ms') options.timeoutMs = boundedInteger(value, '--timeout-ms', { max: LIMITS.timeoutMs });
    else if (flag === '--cwd') options.cwd = resolve(value);
    else usage();
  }
  return { ...options, command: command[0], args: command.slice(1) };
}

function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function round(value) {
  return Number(value.toFixed(3));
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    minMs: round(sorted[0]),
    medianMs: round(median),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted.at(-1)),
  };
}

function execute(command, args, options, phase, iteration) {
  const started = performance.now();
  try {
    execFileSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).trim();
    if (['ENOENT', 'EINVAL'].includes(error.code)) {
      die(`${phase} ${iteration} could not launch '${command}': pass an executable, not a shell alias or Windows .cmd/.bat shim`);
    }
    die(`${phase} ${iteration} failed${detail ? `: ${detail}` : ''}`);
  }
  return performance.now() - started;
}

const options = parse(process.argv.slice(2));
for (let i = 1; i <= options.warmup; i++) execute(options.command, options.args, options, 'warmup', i);
const samples = [];
for (let i = 1; i <= options.runs; i++) samples.push(execute(options.command, options.args, options, 'sample', i));

const report = {
  version: 1,
  command: [options.command, ...options.args],
  workingDirectory: options.cwd === process.cwd() ? 'current' : 'custom',
  protocol: { warmup: options.warmup, runs: options.runs, timeoutMs: options.timeoutMs },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    logicalCpuCount: cpus().length,
  },
  samplesMs: samples.map(round),
  summary: summarize(samples),
};

if (options.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`command: ${report.command.join(' ')}`);
  console.log(`protocol: ${report.protocol.warmup} warmup, ${report.protocol.runs} measured, ${report.protocol.timeoutMs} ms timeout`);
  console.log(`environment: Node ${report.environment.node} ${report.environment.platform}/${report.environment.arch}, ${report.environment.logicalCpuCount} logical CPUs`);
  console.log(`wall time: min ${report.summary.minMs} ms, median ${report.summary.medianMs} ms, p95 ${report.summary.p95Ms} ms, max ${report.summary.maxMs} ms`);
}
