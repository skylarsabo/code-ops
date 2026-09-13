#!/usr/bin/env node
// Deterministic file compilation; byte receipts measure payloads, not host cache hits.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, digestJson, samePathTarget, sha256 } from './context-index-lib.mjs';

const compilerSha256 = sha256(readFileSync(fileURLToPath(import.meta.url)));
function compile(sources, limits) {
  const records = [];
  function section(kind) {
    return sources.filter((source) => source.kind === kind).map((source, index) => {
      const raw = readFileSync(source.path);
      new TextDecoder('utf-8', { fatal: true }).decode(raw);
      records.push({ kind, path: source.path, bytes: raw.length, sha256: sha256(raw) });
      return Buffer.concat([Buffer.from(`\n## ${kind === 'invariant' ? 'Invariant' : 'Unit'} ${index + 1}\n`), raw, Buffer.from('\n')]);
    });
  }
  const prefix = Buffer.concat(section('invariant'));
  const unit = Buffer.concat(section('unit'));
  const prompt = Buffer.concat([prefix, unit]);
  const bytes = { prefix: prefix.length, unit: unit.length, total: prompt.length };
  for (const key of ['prefix', 'unit', 'total']) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new Error(`invalid ${key} byte budget`);
    if (bytes[key] > limits[key]) throw new Error(`${key} byte budget exceeded: ${bytes[key]} > ${limits[key]}; checkpoint or replan; no truncation`);
  }
  const receipt = {
    version: 1, format: 'worker-brief', compilerSha256, limits, bytes,
    prefixSha256: sha256(prefix), unitSha256: sha256(unit), promptSha256: sha256(prompt), sources: records,
  };
  receipt.receiptId = digestJson(receipt);
  return { prompt, receipt };
}
function parse(args) {
  const sources = [];
  const flags = {};
  const allowed = new Set(['--invariant', '--unit-file', '--max-prefix-bytes', '--max-unit-bytes', '--max-bytes', '--out', '--receipt']);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    const value = args[++index];
    if (!allowed.has(key) || !value || value.startsWith('--')) throw new Error('unknown flag or missing value');
    if (key === '--invariant' || key === '--unit-file') sources.push({ kind: key === '--invariant' ? 'invariant' : 'unit', path: resolve(value) });
    else {
      if (flags[key] !== undefined) throw new Error(`duplicate flag ${key}`);
      flags[key] = value;
    }
  }
  return { sources, flags };
}
try {
  const command = process.argv[2];
  const { sources, flags } = parse(process.argv.slice(3));
  if (!flags['--out'] || !flags['--receipt']) throw new Error('out and receipt paths are required');
  const out = resolve(flags['--out']);
  const receiptPath = resolve(flags['--receipt']);
  if (samePathTarget(out, receiptPath)) throw new Error('out and receipt must differ');
  if (command === 'build') {
    if (!sources.some((source) => source.kind === 'invariant') || !sources.some((source) => source.kind === 'unit')) throw new Error('at least one invariant and unit file are required');
    if (sources.some((source) => samePathTarget(source.path, out) || samePathTarget(source.path, receiptPath))) throw new Error('outputs must not overwrite sources');
    const budgetFlags = ['--max-prefix-bytes', '--max-unit-bytes', '--max-bytes'];
    if (budgetFlags.some((key) => !/^[1-9][0-9]*$/.test(flags[key] || ''))) throw new Error('explicit positive integer byte budgets are required');
    const limits = Object.fromEntries(['prefix', 'unit', 'total'].map((key, index) => [key, Number(flags[budgetFlags[index]])]));
    const result = compile(sources, limits);
    // Receipt is the final publication marker. Verification detects interrupted pairs.
    atomicWrite(out, result.prompt);
    atomicWrite(receiptPath, `${JSON.stringify(result.receipt, null, 2)}\n`);
    console.log(`ok worker brief ${result.receipt.receiptId} ${result.receipt.bytes.total} bytes`);
  } else if (command === 'verify') {
    if (sources.length || Object.keys(flags).some((key) => !['--out', '--receipt'].includes(key))) throw new Error('verify accepts only out and receipt');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (receipt.version !== 1 || receipt.format !== 'worker-brief' || receipt.compilerSha256 !== compilerSha256
      || !Array.isArray(receipt.sources) || !receipt.sources.some((source) => source.kind === 'invariant') || !receipt.sources.some((source) => source.kind === 'unit')
      || receipt.sources.some((source) => !['invariant', 'unit'].includes(source.kind) || typeof source.path !== 'string' || source.path !== resolve(source.path))) throw new Error('invalid receipt or compiler drift');
    const result = compile(receipt.sources, receipt.limits);
    if (digestJson(receipt) !== digestJson(result.receipt) || !readFileSync(out).equals(result.prompt)) throw new Error('brief or source drift; rebuild before dispatch');
    console.log(`ok worker brief ${receipt.receiptId}`);
  } else throw new Error('usage: worker-brief.mjs build --invariant <file> [--invariant <file> ...] --unit-file <file> [--unit-file <file> ...] --max-prefix-bytes <integer> --max-unit-bytes <integer> --max-bytes <integer> --out <file> --receipt <file>\n       worker-brief.mjs verify --out <file> --receipt <file>');
} catch (error) { console.error(`x ${error.message}`); process.exitCode = 1; }
