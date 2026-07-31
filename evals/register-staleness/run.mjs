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
// A still-open carried-forward item whose PROSE mentions closure words must not trip UNTERMED.
writeFileSync(join(sdir, 'upd-prose.md'), 'CBUG-001 · one\nLocation: code.mjs:2\nTrack: NOW-SAFE\nNotes: not yet resolved; the deferred discussion continues; uses a closed-loop check\n');
const cp = spawnSync('node', [checker, join(sdir, 'upd-prose.md'), '--root', sdir, '--consumed', join(sdir, 'pre.md')], { encoding: 'utf8' });
expect(cp.status === 0, `open item with closure words in prose should pass consumed gate, got exit ${cp.status}: ${((cp.stdout || '') + cp.stderr).split('\n').find((l) => l.includes('CBUG')) || ''}`);
// A `<REDACTED-LINE>` anchor is line-existence-only, never DRIFTED, with an explicit advisory.
writeFileSync(join(sdir, 'redacted.md'), 'RBUG-001 · secret line\nLocation: code.mjs:2\nAnchor: `<REDACTED-LINE>`\n');
const rd = spawnSync('node', [checker, join(sdir, 'redacted.md'), '--root', sdir, '--report-only'], { encoding: 'utf8' });
const rline = ((rd.stdout || '') + rd.stderr).split('\n').find((l) => l.includes('RBUG-001')) || '';
expect(/FRESH/.test(rline) && rline.includes('redacted anchor'), `redacted anchor should be FRESH + advisory, got: ${rline}`);

// ---- entry-boundary discipline: lettered IDs, prose citations, covered negatives ----
// A reviewer-round-lettered ID heads an item; an ID cited mid-line in another item's evidence
// is a reference (unanchored, it split the block and invented items out of domain tags); a
// `NO-FINDINGS:` covered negative is body text, never an item or a malformed one.
writeFileSync(join(sdir, 'boundaries.md'), [
  '# boundary fixture', '',
  'ABUG-A12 · lettered id', 'Location: code.mjs:2', 'Evidence: duplicate of ABUG-003, tracked as INC-2024 at the time.', '',
  'NO-FINDINGS: config slice — swept clean, nothing to report.', '',
  'ABUG-A13 · lettered id two', 'Location: code.mjs:2', '',
].join('\n'));
const bd = spawnSync('node', [checker, join(sdir, 'boundaries.md'), '--root', sdir], { encoding: 'utf8' });
const bout = (bd.stdout || '') + (bd.stderr || '');
expect(bd.status === 0, `boundary fixture should exit 0 (both items FRESH), got ${bd.status}: ${bout}`);
expect(/\b2 item\(s\)/.test(bout), `boundary fixture should report exactly 2 items, got: ${bout}`);
expect(/FRESH\s+ABUG-A12\b/.test(bout) && /FRESH\s+ABUG-A13\b/.test(bout), `both lettered IDs should be items, got: ${bout}`);
expect(!/ABUG-003|INC-2024|NO-FINDINGS/.test(bout), `prose citations and covered negatives must not become items, got: ${bout}`);

// ---- refutation receipts are keyed at line start, never in mid-line prose ----------
// A receipt is an ID at the start of its line (artifact-grammars §(c)); a round note that cites
// findings mid-sentence is prose. Matched mid-line, the note below attached itself to RBUG-101 as
// a second, REFUTED verdict with no re-greppable killing guard — failing a high item whose real
// panel line says SURVIVED.
writeFileSync(join(sdir, 'rreg.md'), [
  '# refutation fixture', '',
  'RBUG-101 · high item, paneled', 'Tier: PROBABLE', 'Severity: high', 'Location: code.mjs:2', 'Anchor: `auth token`',
  'Verified-at: HEAD', 'Disconfirmation: callers checked', 'Refutation: independent — survived', 'Track: NEEDS-REVIEW', 'Proof: `node code.mjs`', '',
].join('\n'));
writeFileSync(join(sdir, 'rlog.md'), [
  '# Refutation log', '',
  'RBUG-101 · r1 · SURVIVED · reviewerA · searched: caller chain + middleware', '',
  'Round note: the panel read RBUG-101 as REFUTED in an earlier round, before the guard landed.', '',
].join('\n'));
const rf = spawnSync('node', [checker, join(sdir, 'rreg.md'), '--root', sdir, '--strict', '--profile', 'finding-rigor', '--refutation-log', join(sdir, 'rlog.md')], { encoding: 'utf8' });
const rfout = (rf.stdout || '') + (rf.stderr || '');
expect(rf.status === 0, `a mid-line prose citation must not become a receipt (exit ${rf.status}): ${rfout.split('\n').find((l) => l.includes('RBUG-101')) || rfout}`);
// Ignoring prose is not ignoring the panel: a log carrying ONLY such prose leaves the high item
// with no receipt at all, and strict mode still fails closed on it.
writeFileSync(join(sdir, 'prose-only-log.md'), '# Refutation log\n\nRound note: RBUG-101 was discussed but never paneled.\n');
const rfProse = spawnSync('node', [checker, join(sdir, 'rreg.md'), '--root', sdir, '--strict', '--profile', 'finding-rigor', '--refutation-log', join(sdir, 'prose-only-log.md')], { encoding: 'utf8' });
expect(rfProse.status === 1 && ((rfProse.stdout || '') + rfProse.stderr).includes('no refutation-log line'),
  `a prose-only log leaves the high item unreceipted and must fail closed, got ${rfProse.status}`);

if (fails.length) {
  console.error('FAIL — register-staleness eval:');
  for (const f of fails) console.error('  x ' + f);
  console.error('\n--- checker output ---\n' + out);
  process.exit(1);
}
console.log('PASS — register-staleness eval: FRESH/MOVED/DRIFTED/GONE/NO-REF classified correctly (incl. the verbatim-anchor gate + the unparseable-anchor advisory); stale register fails closed; strict schema/proof/Panel-exempt gate, consumed-mode terminal states, and the redacted-anchor carve-out all hold; refutation receipts are keyed at line start, so prose citing a finding is never a verdict.');
