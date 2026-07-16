#!/usr/bin/env node
// Regression eval for scripts/preflight.mjs — pins the phase-0 preflight contract:
// blank/missing flag values and unknown flags fail closed, a genuinely missing --need
// tool fails with an explicit 'not resolvable' message, a normal run inside a git work
// tree passes with 'preflight OK', an --artifact-dir that collides with an existing
// file fails with 'not writable', and (win32 only) a .cmd shim on PATH still resolves
// via the where.exe fallback.
//
//   node evals/preflight/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, delimiter, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'preflight.mjs');

const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };

// Spawn the real script directly (never a shell string); capture status via the thrown
// error's .status on non-zero exit, per execFileSync semantics.
const run = (args, opts = {}) => {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000, cwd: REPO, ...opts });
    return { status: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

const work = mkdtempSync(join(tmpdir(), 'coh-preflight-'));
try {
  // a. blank --need value -> exit 1 (fails during arg parsing, before any git context matters)
  const a = run(['--need', '']);
  check('a. --need "" exits 1', a.status === 1);

  // b. whitespace-only --artifact-dir value -> exit 1
  const b = run(['--artifact-dir', '  ']);
  check('b. --artifact-dir "  " exits 1', b.status === 1);

  // c. unknown flag -> exit 1. Run inside a real git work tree with git/node on PATH so a
  // pass here can only mean the unknown flag was rejected, not that some unrelated check failed.
  const c = run(['--bogus-flag']);
  check('c. --bogus-flag exits 1', c.status === 1);

  // d. --need <tool not on PATH> -> exit 1, stderr mentions 'not resolvable'
  const d = run(['--need', 'definitely-not-a-real-tool-9x7']);
  check('d. missing --need tool exits 1', d.status === 1);
  check("d. stderr mentions 'not resolvable'", d.stderr.includes('not resolvable'));

  // e. plain run in a real git work tree -> exit 0, stdout has 'preflight OK'
  const e = run([]);
  check('e. plain run exits 0', e.status === 0);
  check("e. stdout has 'preflight OK'", e.stdout.includes('preflight OK'));

  // f. --artifact-dir nested under an existing FILE. mkdirSync(..., {recursive:true}) fails
  // cross-platform (ENOTDIR-equivalent) when a path segment is a regular file, not a directory.
  const fileX = join(work, 'blocking-file');
  writeFileSync(fileX, 'x');
  const f = run(['--artifact-dir', join(fileX, 'sub')]);
  check('f. artifact-dir nested under a file exits 1', f.status === 1);
  check("f. stderr mentions 'not writable'", f.stderr.includes('not writable'));

  // g. WIN32-ONLY — a .cmd shim on PATH must still resolve via the where.exe fallback
  // (node refuses to spawn .cmd/.bat shims directly without a shell; see preflight.mjs `has()`).
  if (process.platform === 'win32') {
    const toolDir = mkdtempSync(join(tmpdir(), 'coh-preflight-tool-'));
    writeFileSync(join(toolDir, 'fake-tool.cmd'), '@echo off\nexit /b 0\n');
    const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH';
    const env = { ...process.env, [pathKey]: `${toolDir}${delimiter}${process.env[pathKey] ?? ''}` };
    const g = run(['--need', 'fake-tool'], { env });
    check('g. win32 .cmd shim resolves via where.exe fallback', g.status === 0);
    rmSync(toolDir, { recursive: true, force: true });
  } else {
    console.log('SKIP g. win32-only .cmd shim case (not running on win32)');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} preflight regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all preflight regression checks passed.');
