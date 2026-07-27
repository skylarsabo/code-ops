#!/usr/bin/env node
// Regression eval for scripts/dispatch-ledger.mjs — pins the DISPATCH_LEDGER.md
// mechanization: `add` creates the header + a sequential D-NNN row (dispatched) and
// rejects a brief over 10 words, `update` allows dispatched/redispatched -> any
// outcome and failed -> redispatched but rejects an unknown id or a change out of
// the terminal `reported` state, and `check` validates row shape/id ordering/status
// values (fail-closed), reports dangling `dispatched` rows as an advisory (exit 0)
// unless --strict promotes them to a failure.
//
//   node evals/dispatch-ledger/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'dispatch-ledger.mjs');

const fails = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) fails.push(detail ? `${name} — ${String(detail).slice(0, 200)}` : name);
};

// Spawn the real script directly (never a shell string); capture status via the
// thrown error's .status on non-zero exit, per execFileSync semantics.
const run = (args) => {
  try {
    const outp = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 10000 });
    return { status: 0, stdout: outp, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

const cleanupDirs = [];
try {
  const dir = mkdtempSync(join(tmpdir(), 'coh-dispatchledger-'));
  cleanupDirs.push(dir);
  const ledger = join(dir, 'DISPATCH_LEDGER.md');

  // a. add creates the header + first row (D-001, dispatched).
  const a = run(['add', '--ledger', ledger, '--role', 'explorer', '--brief', 'map the auth module', '--artifact', 'AUTH_MAP.md']);
  check('a. add exits 0', a.status === 0, a.stderr);
  const textA = readFileSync(ledger, 'utf8');
  check('a. ledger has the header row', textA.includes('| id | role | brief | expected artifact | status |'), textA);
  check('a. first row is D-001 dispatched', /\|\s*D-001\s*\|\s*explorer\s*\|\s*map the auth module\s*\|\s*AUTH_MAP\.md\s*\|\s*dispatched\s*\|/.test(textA), textA);

  // b. sequential ids: a second add appends D-002.
  const b = run(['add', '--ledger', ledger, '--role', 'mech', '--brief', 'rename the config field', '--artifact', 'diff']);
  check('b. second add exits 0', b.status === 0, b.stderr);
  const textB = readFileSync(ledger, 'utf8');
  check('b. second row is D-002', /\|\s*D-002\s*\|\s*mech\s*\|/.test(textB), textB);

  // c. over-10-word brief is rejected (exit 1), and no row is appended.
  const c = run(['add', '--ledger', ledger, '--role', 'reviewer', '--brief', 'one two three four five six seven eight nine ten eleven', '--artifact', 'x']);
  check('c. over-10-word brief exits 1', c.status === 1, c.stderr);
  const textC = readFileSync(ledger, 'utf8');
  check('c. no D-003 row was appended', !textC.includes('D-003'), textC);

  // d. update: valid transition dispatched -> reported.
  const d = run(['update', '--ledger', ledger, '--id', 'D-001', '--status', 'reported']);
  check('d. valid transition exits 0', d.status === 0, d.stderr);
  const textD = readFileSync(ledger, 'utf8');
  check('d. D-001 row now reported', /\|\s*D-001\s*\|[^\n]*\|\s*reported\s*\|/.test(textD), textD);

  // e. update: reported is terminal — a further change is rejected.
  const e = run(['update', '--ledger', ledger, '--id', 'D-001', '--status', 'failed']);
  check('e. change out of reported exits 1', e.status === 1, e.stderr);
  check('e. rejection mentions terminal', /terminal/.test(e.stderr), e.stderr);

  // f. update: dispatched -> failed -> redispatched is allowed.
  const f1 = run(['update', '--ledger', ledger, '--id', 'D-002', '--status', 'failed']);
  check('f. dispatched -> failed exits 0', f1.status === 0, f1.stderr);
  const f2 = run(['update', '--ledger', ledger, '--id', 'D-002', '--status', 'redispatched']);
  check('f. failed -> redispatched exits 0', f2.status === 0, f2.stderr);
  const f3 = run(['update', '--ledger', ledger, '--id', 'D-002', '--status', 'failed']);
  check('f. redispatched -> failed exits 0 (outcome reachable again)', f3.status === 0, f3.stderr);

  // g. update: unknown id is rejected.
  const g = run(['update', '--ledger', ledger, '--id', 'D-999', '--status', 'reported']);
  check('g. unknown id exits 1', g.status === 1, g.stderr);

  // h. check passes on a clean ledger (D-001 reported, D-002 failed — no dangling rows).
  const h = run(['check', '--ledger', ledger]);
  check('h. check exits 0 on a clean ledger', h.status === 0, h.stdout + h.stderr);
  check('h. check reports zero dangling dispatches', /0 dangling dispatch\(es\)/.test(h.stdout), h.stdout);

  // i. check flags a dangling `dispatched` row as an advisory (exit 0, not blocking).
  const ledgerDangling = join(dir, 'DANGLING_LEDGER.md');
  const di = run(['add', '--ledger', ledgerDangling, '--role', 'tracer', '--brief', 'trace the race condition', '--artifact', 'TRACE.md']);
  check('i. seed add exits 0', di.status === 0, di.stderr);
  const iResult = run(['check', '--ledger', ledgerDangling]);
  check('i. check on a dangling dispatched row still exits 0', iResult.status === 0, iResult.stdout + iResult.stderr);
  check('i. dangling row is reported as an advisory', /advisory: D-001 still 'dispatched'/.test(iResult.stdout), iResult.stdout);

  // j. --strict promotes the same dangling row to a failure (exit 1).
  const j = run(['check', '--ledger', ledgerDangling, '--strict']);
  check('j. --strict on a dangling row exits 1', j.status === 1, j.stdout + j.stderr);

  // k. a malformed row (wrong column count) fails check regardless of --strict.
  const malformed = join(dir, 'MALFORMED_LEDGER.md');
  writeFileSync(malformed, [
    '| id | role | brief | expected artifact | status |',
    '| --- | --- | --- | --- | --- |',
    '| D-001 | explorer | too few columns | dispatched |',
  ].join('\n') + '\n');
  const k = run(['check', '--ledger', malformed]);
  check('k. malformed row exits 1', k.status === 1, k.stdout + k.stderr);
  check('k. malformed row is reported', /MALFORMED/.test(k.stdout), k.stdout);
} finally {
  for (const d of cleanupDirs) rmSync(d, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} dispatch-ledger regression check(s) failed:`);
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('\nOK — all dispatch-ledger regression checks passed.');
