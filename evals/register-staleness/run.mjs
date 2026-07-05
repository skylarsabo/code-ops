#!/usr/bin/env node
// Register-staleness regression eval — pins the one behavior the field lost
// (a register re-listing already-fixed items). Asserts revalidate-register.mjs
// classifies a seeded mixed-freshness register correctly and fails closed.
//
//   node evals/register-staleness/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checker = resolve(here, '..', '..', 'scripts', 'revalidate-register.mjs');
const register = join(here, 'FINDINGS_REGISTER.seed.md');
const repo = join(here, 'repo');

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };

// Report-only run: capture the classification of each item.
const r = spawnSync('node', [checker, register, '--root', repo, '--report-only'], { encoding: 'utf8' });
const out = (r.stdout || '') + (r.stderr || '');
const statusOf = (id) => (out.match(new RegExp(`(FRESH|MOVED|DRIFTED|GONE|NO-REF)\\s+${id}\\b`)) || [])[1] || '(none)';

expect(statusOf('BUG-001') === 'FRESH', `BUG-001 should be FRESH, got ${statusOf('BUG-001')}`);
expect(statusOf('BUG-002') === 'MOVED', `BUG-002 should be MOVED, got ${statusOf('BUG-002')}`);
expect(statusOf('BUG-003') === 'GONE', `BUG-003 should be GONE, got ${statusOf('BUG-003')}`);
expect(statusOf('BUG-004') === 'NO-REF', `BUG-004 should be NO-REF, got ${statusOf('BUG-004')}`);
// New: the verbatim-anchor citation gate (CONVENTIONS §9/§E). An anchored item whose cited line
// still carries its anchor is FRESH; one whose line exists but no longer contains the anchor is DRIFTED.
expect(statusOf('BUG-005') === 'FRESH', `BUG-005 (anchor present) should be FRESH, got ${statusOf('BUG-005')}`);
expect(statusOf('BUG-006') === 'DRIFTED', `BUG-006 (anchor drifted off the line) should be DRIFTED, got ${statusOf('BUG-006')}`);
// An `Anchor:` label whose value has no backtick/quote delimiter is unparseable: the item must NOT
// silently degrade to line-existence checking — it stays FRESH but carries an explicit advisory.
const bug7 = out.split('\n').find((l) => l.includes('BUG-007')) || '';
expect(statusOf('BUG-007') === 'FRESH', `BUG-007 (undelimited anchor) should be FRESH, got ${statusOf('BUG-007')}`);
expect(bug7.includes('unparseable'), `BUG-007 should carry the unparseable-anchor advisory, got: ${bug7 || '(no report line)'}`);

// Without --report-only, a stale register must fail closed (non-zero exit).
const gated = spawnSync('node', [checker, register, '--root', repo], { encoding: 'utf8' });
expect(gated.status === 1, `stale register should exit 1 (fail closed), got ${gated.status}`);

if (fails.length) {
  console.error('FAIL — register-staleness eval:');
  for (const f of fails) console.error('  x ' + f);
  console.error('\n--- checker output ---\n' + out);
  process.exit(1);
}
console.log('PASS — register-staleness eval: FRESH/MOVED/DRIFTED/GONE/NO-REF classified correctly (incl. the verbatim-anchor gate + the unparseable-anchor advisory); stale register fails closed.');
