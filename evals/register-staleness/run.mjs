#!/usr/bin/env node
// Register-staleness regression eval — pins the one behavior the field lost
// (a register re-listing already-fixed items). Asserts revalidate-register.mjs
// classifies a seeded mixed-freshness register correctly and fails closed.
//
//   node evals/register-staleness/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

// ---- strict-mode schema gate (weak-model floor) -----------------------------------
const sdir = mkdtempSync(join(tmpdir(), 'reg-strict-'));
writeFileSync(join(sdir, 'code.mjs'), 'line one\nauth token check\n');
// Complete item passes strict finding-rigor; incomplete + unproven-CONFIRMED + deflated-sensitive fail.
writeFileSync(join(sdir, 'sreg.md'), [
  '# strict fixture', '',
  'SBUG-001 · complete', 'Tier: PROBABLE', 'Severity: high', 'Location: code.mjs:2', 'Anchor: `auth token`',
  'Verified-at: HEAD', 'Disconfirmation: callers checked', 'Refutation: independent — survived', 'Track: NEEDS-REVIEW', 'Proof: `node code.mjs`', '',
  'SBUG-002 · missing fields', 'Tier: PROBABLE', 'Location: code.mjs:2', 'Anchor: `auth token`', '',
  'SBUG-003 · fake confirmed', 'Tier: CONFIRMED', 'Severity: high', 'Location: code.mjs:2', 'Anchor: `auth token`',
  'Verified-at: HEAD', 'Disconfirmation: x', 'Refutation: exempt', 'Track: NOW-SAFE', 'Proof: it clearly fails', '',
  'SBUG-004 · deflated sensitive', 'Tier: PROBABLE', 'Severity: low', 'Lens: security', 'Location: code.mjs:2', 'Anchor: `auth token`',
  'Verified-at: HEAD', 'Disconfirmation: x', 'Refutation: exempt', 'Track: NEEDS-REVIEW', 'Proof: `node code.mjs`', '',
].join('\n'));
const sr = spawnSync('node', [checker, join(sdir, 'sreg.md'), '--root', sdir, '--strict', '--profile', 'finding-rigor', '--report-only'], { encoding: 'utf8' });
const sout = (sr.stdout || '') + (sr.stderr || '');
const sline = (id) => sout.split('\n').find((l) => l.includes(id)) || '';
expect(/ok /.test(sline('SBUG-001')), `SBUG-001 (complete) should pass strict, got: ${sline('SBUG-001')}`);
expect(sline('SBUG-002').includes('missing field'), `SBUG-002 should fail on missing fields, got: ${sline('SBUG-002')}`);
expect(sline('SBUG-003').includes('resolvable Proof'), `SBUG-003 (CONFIRMED, unresolvable proof) should fail, got: ${sline('SBUG-003')}`);
expect(sline('SBUG-004').includes('Panel-exempt'), `SBUG-004 (sensitive path, sub-high, no exemption) should fail, got: ${sline('SBUG-004')}`);
const sgated = spawnSync('node', [checker, join(sdir, 'sreg.md'), '--root', sdir, '--strict', '--profile', 'finding-rigor'], { encoding: 'utf8' });
expect(sgated.status === 1, `strict violations should exit 1, got ${sgated.status}`);
// A mangled register (schema labels, zero IDs) fails under strict instead of exiting 0.
writeFileSync(join(sdir, 'mangled.md'), 'Tier: CONFIRMED\nLocation: code.mjs:2\n(no ids anywhere)\n');
const mg = spawnSync('node', [checker, join(sdir, 'mangled.md'), '--root', sdir, '--strict', '--profile', 'finding'], { encoding: 'utf8' });
expect(mg.status === 1, `mangled register should fail closed under strict, got ${mg.status}`);

// ---- --consumed terminal-state gate ------------------------------------------------
writeFileSync(join(sdir, 'pre.md'), 'CBUG-001 · one\nLocation: code.mjs:2\nTrack: NOW-SAFE\n');
writeFileSync(join(sdir, 'upd-vanished.md'), '# after run\nall clean\n');
const cv = spawnSync('node', [checker, join(sdir, 'upd-vanished.md'), '--root', sdir, '--consumed', join(sdir, 'pre.md')], { encoding: 'utf8' });
expect(cv.status === 1 && ((cv.stdout || '') + cv.stderr).includes('VANISHED'), `vanished consumed item should fail with VANISHED, got exit ${cv.status}`);
writeFileSync(join(sdir, 'upd-untermed.md'), 'CBUG-001 · one — closed\nStatus: closed after fix\nLocation: code.mjs:2\n');
const cu = spawnSync('node', [checker, join(sdir, 'upd-untermed.md'), '--root', sdir, '--consumed', join(sdir, 'pre.md')], { encoding: 'utf8' });
expect(cu.status === 1 && ((cu.stdout || '') + cu.stderr).includes('UNTERMED'), `untokened closure should fail with UNTERMED, got exit ${cu.status}`);
writeFileSync(join(sdir, 'upd-ok.md'), 'CBUG-001 · one — closed-with-proof PR#12\nLocation: code.mjs:2\n');
const co = spawnSync('node', [checker, join(sdir, 'upd-ok.md'), '--root', sdir, '--consumed', join(sdir, 'pre.md')], { encoding: 'utf8' });
expect(co.status === 0, `pinned terminal form should pass, got exit ${co.status}`);
// A `<REDACTED-LINE>` anchor is line-existence-only, never DRIFTED, with an explicit advisory.
writeFileSync(join(sdir, 'redacted.md'), 'RBUG-001 · secret line\nLocation: code.mjs:2\nAnchor: `<REDACTED-LINE>`\n');
const rd = spawnSync('node', [checker, join(sdir, 'redacted.md'), '--root', sdir, '--report-only'], { encoding: 'utf8' });
const rline = ((rd.stdout || '') + rd.stderr).split('\n').find((l) => l.includes('RBUG-001')) || '';
expect(/FRESH/.test(rline) && rline.includes('redacted anchor'), `redacted anchor should be FRESH + advisory, got: ${rline}`);

if (fails.length) {
  console.error('FAIL — register-staleness eval:');
  for (const f of fails) console.error('  x ' + f);
  console.error('\n--- checker output ---\n' + out);
  process.exit(1);
}
console.log('PASS — register-staleness eval: FRESH/MOVED/DRIFTED/GONE/NO-REF classified correctly (incl. the verbatim-anchor gate + the unparseable-anchor advisory); stale register fails closed; strict schema/proof/Panel-exempt gate, consumed-mode terminal states, and the redacted-anchor carve-out all hold.');
