#!/usr/bin/env node
// Register-staleness regression eval — pins the one behavior the field lost
// (a register re-listing already-fixed items). Asserts revalidate-register.mjs
// classifies a seeded mixed-freshness register correctly and fails closed. It exercises
// scripts/citation-lib.mjs through that script, which is the shared citation resolver
// (evals/handoff-check/run.mjs exercises the same library through check-handoff.mjs).
//
//   node evals/register-staleness/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const checker = resolve(here, '..', '..', 'scripts', 'revalidate-register.mjs');
const register = join(here, 'FINDINGS_REGISTER.seed.md');
const repo = join(here, 'repo');

const { fails, expect } = tally();

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

// ---- IMP-02: a CONFIRMED proof must resolve to a receipt or a kept file --------------------
// A backticked command is not evidence that it ran; a missing Proof, a receipt absent from
// RUN_RECEIPTS.md, a receipt whose recorded exit code contradicts the claim, and a register that
// cites itself all fail. A recorded receipt and an in-tree repro file pass.
const pdir = mkdtempSync(join(tmpdir(), 'reg-proof-'));
writeFileSync(join(pdir, 'code.mjs'), 'line one\nauth token check\n');
writeFileSync(join(pdir, 'RUN_RECEIPTS.md'), [
  '| id | when | head | exit | sha256 | command |', '| --- | --- | --- | --- | --- | --- |',
  `| RCPT-001 | 2026-09-23T00:00:00Z | abc1234 | 1 | ${'a'.repeat(64)} | node code.mjs |`, '',
].join('\n'));
const pitem = (id, proof) => [`${id} · confirmed item`, 'Tier: CONFIRMED', 'Severity: medium', 'Location: code.mjs:2', 'Anchor: `auth token`',
  'Verified-at: HEAD', 'Disconfirmation: x', 'Refutation: exempt', 'Track: NOW-SAFE', ...(proof === null ? [] : [`Proof: ${proof}`]), ''];
writeFileSync(join(pdir, 'preg.md'), ['# proof fixture', '',
  ...pitem('PBUG-001', '`echo it fails`'),
  ...pitem('PBUG-002', null),
  ...pitem('PBUG-003', 'RCPT-001 (exit 1)'),
  ...pitem('PBUG-004', 'RCPT-001 exit 0'),
  ...pitem('PBUG-005', 'RCPT-009'),
  ...pitem('PBUG-006', '`preg.md`'),
  ...pitem('PBUG-007', 'repro at code.mjs:2'),
].join('\n'));
const pr = spawnSync('node', [checker, join(pdir, 'preg.md'), '--root', pdir, '--strict', '--profile', 'finding-rigor', '--report-only'], { encoding: 'utf8' });
const pout = (pr.stdout || '') + (pr.stderr || '');
const pline = (id) => pout.split('\n').find((l) => l.includes(id)) || '';
expect(pline('PBUG-001').includes('resolvable Proof'), `an unexecuted backticked command must not prove CONFIRMED, got: ${pline('PBUG-001')}`);
expect(pline('PBUG-002').includes('no Proof line'), `a CONFIRMED item with no Proof must fail, got: ${pline('PBUG-002')}`);
expect(/ok /.test(pline('PBUG-003')), `a recorded receipt with a matching exit code should pass, got: ${pline('PBUG-003')}`);
expect(pline('PBUG-004').includes('recorded exit 1'), `a receipt whose exit code contradicts the claim must fail, got: ${pline('PBUG-004')}`);
expect(pline('PBUG-005').includes('not in RUN_RECEIPTS.md'), `a receipt absent from the ledger must fail, got: ${pline('PBUG-005')}`);
expect(pline('PBUG-006').includes('resolvable Proof'), `a register citing itself is not a proof, got: ${pline('PBUG-006')}`);
expect(/ok /.test(pline('PBUG-007')), `an in-tree repro file should pass, got: ${pline('PBUG-007')}`);
writeFileSync(join(pdir, 'nreg.md'), ['# no-ledger fixture', '', ...pitem('NBUG-001', 'RCPT-001')].join('\n'));
const np = spawnSync('node', [checker, join(pdir, 'nreg.md'), '--root', pdir, '--strict', '--profile', 'finding-rigor', '--receipts', join(pdir, 'absent.md')], { encoding: 'utf8' });
expect(np.status === 1 && ((np.stdout || '') + np.stderr).includes('no RUN_RECEIPTS.md'), `a receipt proof with no ledger must fail closed, got ${np.status}`);

// ---- IMP-03: --min-items and the consistency profile ---------------------------------------
// A citation-less or empty register cannot pass a producer's Done-when; an Enforcement that names
// no existing file fails the consistency profile.
writeFileSync(join(pdir, 'lint-rule.mjs'), '// enforcement\n');
const cons = (id, enforcement) => [`${id} · error envelope`, 'Concept: HTTP error shape', 'Canonical: code.mjs:2',
  'Sites: code.mjs:2', 'Anchor: `auth token`', `Enforcement: ${enforcement}`, 'Verified-at: HEAD', ''];
writeFileSync(join(pdir, 'cons-ok.md'), ['# consistency', '', ...cons('CONS-001', '`lint-rule.mjs`')].join('\n'));
writeFileSync(join(pdir, 'cons-bad.md'), ['# consistency', '', ...cons('CONS-002', 'a reviewer will remember')].join('\n'));
writeFileSync(join(pdir, 'cons-bare.md'), '# consistency\n\nCONS-003 · error envelope\nConcept: HTTP error shape\n');
writeFileSync(join(pdir, 'cons-empty.md'), '# consistency\n\nNothing was closed.\n');
const consRun = (name) => {
  const c = spawnSync('node', [checker, join(pdir, name), '--root', pdir, '--strict', '--profile', 'consistency', '--min-items', '1'], { encoding: 'utf8' });
  return { status: c.status, out: (c.stdout || '') + (c.stderr || '') };
};
const cOk = consRun('cons-ok.md');
expect(cOk.status === 0, `a complete anchored consistency item should pass, got ${cOk.status}: ${cOk.out}`);
const cBad = consRun('cons-bad.md');
expect(cBad.status === 1 && cBad.out.includes('Enforcement cites no existing file'), `an enforcement naming no file must fail, got ${cBad.status}`);
const cBare = consRun('cons-bare.md');
expect(cBare.status === 1 && cBare.out.includes('TOO-FEW'), `a citation-less register must fail --min-items, got ${cBare.status}`);
const cEmpty = consRun('cons-empty.md');
expect(cEmpty.status === 1 && cEmpty.out.includes('TOO-FEW'), `an empty register must fail --min-items, got ${cEmpty.status}`);
const badMin = spawnSync('node', [checker, join(pdir, 'cons-ok.md'), '--min-items', '0'], { encoding: 'utf8' });
expect(badMin.status === 2, `--min-items 0 is a usage error, got ${badMin.status}`);

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

// ---- a REFUTED receipt is checked against its own file:line + anchor ----------------
// The receipt citation must be read with its capture groups: a valid killing-guard citation passes,
// a wrong anchor fails, and a traversal citation fails confinement even when a same-named file
// exists in the repo (the SEC-004 prefix restore applies to receipts as it does to item refs).
writeFileSync(join(sdir, 'x.ts'), 'auth token check\n');
writeFileSync(join(sdir, 'qreg.md'), [
  '# refuted-receipt fixture', '',
  'QBUG-301 · high item, refuted by its panel', 'Tier: SPECULATIVE', 'Severity: high', 'Location: code.mjs:2', 'Anchor: `auth token`',
  'Verified-at: HEAD', 'Disconfirmation: callers checked', 'Refutation: independent — refuted', 'Track: NEEDS-REVIEW', 'Proof: `node code.mjs`', '',
].join('\n'));
const receipt = (name, cite, anchor) => {
  writeFileSync(join(sdir, name), `# Refutation log\n\nQBUG-301 · r1 · REFUTED · reviewerB · killed by the guard at ${cite} Anchor: \`${anchor}\`\n`);
  const q = spawnSync('node', [checker, join(sdir, 'qreg.md'), '--root', sdir, '--strict', '--profile', 'finding-rigor', '--refutation-log', join(sdir, name)], { encoding: 'utf8' });
  return { status: q.status, out: (q.stdout || '') + (q.stderr || '') };
};
const qGood = receipt('qlog-good.md', 'code.mjs:2', 'auth token');
expect(qGood.status === 0, `a REFUTED receipt with an in-repo file:line and matching anchor should pass, got ${qGood.status}: ${qGood.out.split('\n').find((l) => l.includes('QBUG-301')) || qGood.out}`);
const qWrong = receipt('qlog-wrong.md', 'code.mjs:2', 'no such guard');
expect(qWrong.status === 1 && qWrong.out.includes('re-greppable'), `a REFUTED receipt whose anchor is not on the cited line should fail, got ${qWrong.status}`);
const qEsc = receipt('qlog-escape.md', '../x.ts:1', 'auth token');
expect(qEsc.status === 1 && qEsc.out.includes('re-greppable'), `a REFUTED receipt citing ../x.ts:1 should fail confinement, got ${qEsc.status}`);

// ---- L-058: the Severity FIELD value decides the strict legs, not the rest of the line --------
// A composite line (`Severity: medium · Confidence: high · Risk if fixed: low`) used to read as
// load-bearing AND deflated at once, because each leg scanned the whole line. CMP-001 is a medium
// finding on a sensitive lens: it owes no panel receipt. CMP-002 is a high one whose line also
// carries the words medium and low: it stays load-bearing and is not treated as deflated.
writeFileSync(join(sdir, 'clog.md'), '# Refutation log\n\nCMP-002 · r1 · SURVIVED · reviewerA · searched: caller chain + middleware\n');
writeFileSync(join(sdir, 'creg.md'), [
  '# composite-severity fixture', '',
  'CMP-001 · composite severity line, sub-high', 'Tier: PROBABLE', '- Severity: medium · Confidence: high · Risk if fixed: low',
  'Lens: security', 'Location: code.mjs:2', 'Anchor: `auth token`', 'Verified-at: HEAD',
  'Disconfirmation: callers checked', 'Refutation: independent — survived', 'Track: NEEDS-REVIEW',
  'Proof: `node code.mjs`', 'Panel-exempt: medium-severity note on a read-only path', '',
  'CMP-002 · composite severity line, load-bearing', 'Tier: PROBABLE', '- Severity: high · Confidence: medium · Risk if fixed: low',
  'Lens: security', 'Location: code.mjs:2', 'Anchor: `auth token`', 'Verified-at: HEAD',
  'Disconfirmation: callers checked', 'Refutation: independent — survived', 'Track: NEEDS-REVIEW',
  'Proof: `node code.mjs`', '',
].join('\n'));
const cmp = spawnSync('node', [checker, join(sdir, 'creg.md'), '--root', sdir, '--strict', '--profile', 'finding-rigor', '--refutation-log', join(sdir, 'clog.md')], { encoding: 'utf8' });
const cmpOut = (cmp.stdout || '') + (cmp.stderr || '');
const cmpLine = (id) => cmpOut.split('\n').find((l) => l.includes(id)) || '';
expect(!cmpLine('CMP-001').includes('refutation-log'), `a medium finding on a composite line owes no panel receipt, got: ${cmpLine('CMP-001')}`);
expect(!cmpLine('CMP-002').includes('Panel-exempt'), `a high finding on a composite line is not deflated, got: ${cmpLine('CMP-002')}`);
expect(cmp.status === 0, `the composite-severity fixture should pass strict, got exit ${cmp.status}: ${cmpOut}`);

// ---- L-059: a doubled-backtick anchor carries a backtick of its own ---------------------------
// CommonMark's own escape for a code span containing a backtick. A backslash is NOT an escape
// here, so an anchor copied verbatim from a line carrying a backslash is unaffected.
writeFileSync(join(sdir, 'tick.mjs'), 'const label = `x` + y;\n');
writeFileSync(join(sdir, 'treg.md'), [
  '# doubled-backtick fixture', '',
  'TBUG-001 · anchor with an inner backtick', 'Location: tick.mjs:1', 'Anchor: ``const label = `x` + y;``', '',
  'TBUG-002 · doubled-backtick anchor that drifted', 'Location: tick.mjs:1', 'Anchor: ``no such `guard` here``', '',
  'TBUG-003 · ordinary single-backtick anchor', 'Location: tick.mjs:1', 'Anchor: `const label`', '',
].join('\n'));
const tk = spawnSync('node', [checker, join(sdir, 'treg.md'), '--root', sdir, '--report-only'], { encoding: 'utf8' });
const tkOut = (tk.stdout || '') + (tk.stderr || '');
const tkLine = (id) => tkOut.split('\n').find((l) => l.includes(id)) || '';
// Matched on the status column, because the unparseable-anchor advisory itself names DRIFTED.
expect(/FRESH\s+TBUG-001\b/.test(tkOut), `a doubled-backtick anchor matching its line should be FRESH, got: ${tkLine('TBUG-001')}`);
expect(!tkLine('TBUG-001').includes('unparseable'), `a doubled-backtick anchor must parse, got: ${tkLine('TBUG-001')}`);
expect(/DRIFTED\s+TBUG-002\b/.test(tkOut), `a doubled-backtick anchor absent from its line should be DRIFTED, got: ${tkLine('TBUG-002')}`);
expect(!tkLine('TBUG-002').includes('unparseable'), `the drifted doubled-backtick anchor must parse too, got: ${tkLine('TBUG-002')}`);
expect(/FRESH\s+TBUG-003\b/.test(tkOut), `a single-backtick anchor should still be FRESH, got: ${tkLine('TBUG-003')}`);

// ---- L-064: a LEAD- prefixed finding is an ordinary item ---------------------------------------
// The lead mints its own findings under the reserved LEAD- prefix so they cannot collide with a
// discovery slice's ids. The grammar already admits it: two or more uppercase prefix characters.
writeFileSync(join(sdir, 'lreg.md'), [
  '# lead-authored fixture', '',
  'LEAD-001 · lead-filed finding', 'Location: code.mjs:2', 'Anchor: `auth token`', '',
].join('\n'));
const ld = spawnSync('node', [checker, join(sdir, 'lreg.md'), '--root', sdir], { encoding: 'utf8' });
const ldOut = (ld.stdout || '') + (ld.stderr || '');
expect(ld.status === 0 && /FRESH\s+LEAD-001\b/.test(ldOut), `LEAD-001 should parse and revalidate like any other id, got exit ${ld.status}: ${ldOut}`);
expect(/\b1 item\(s\)/.test(ldOut), `the lead fixture should report exactly 1 item, got: ${ldOut}`);

if (fails.length) {
  console.error('FAIL — register-staleness eval:');
  for (const f of fails) console.error('  x ' + f);
  console.error('\n--- checker output ---\n' + out);
  process.exit(1);
}
console.log('PASS — register-staleness eval: FRESH/MOVED/DRIFTED/GONE/NO-REF classified correctly (incl. the verbatim-anchor gate + the unparseable-anchor advisory); stale register fails closed; strict schema/proof/Panel-exempt gate, consumed-mode terminal states, and the redacted-anchor carve-out all hold; refutation receipts are keyed at line start, so prose citing a finding is never a verdict; the strict legs read the Severity field value rather than the rest of a composite line; a doubled-backtick anchor carries an inner backtick; a LEAD- finding parses like any other id.');
