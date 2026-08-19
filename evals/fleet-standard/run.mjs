#!/usr/bin/env node
// Fleet-conformance regression eval — pins scripts/check-fleet.mjs against the committed
// two-member fixture under `fleet/` plus cases synthesized in temp dirs.
//
// The committed fixture is the pass case, and it is committed rather than synthesized because
// it is also the worked example the standard describes: `alpha` consents with a byte-identical
// contract pair and carries a conformant vault, `beta` consents with a pointer pair and carries
// no vault at all. Everything that needs a member differing in exactly one way is synthesized
// below, so a failure names its cause instead of pointing at a shared tree.
//
// Covered: the pass case exits 0; a named, not consenting member leaves one row and does NOT
// fail the run, and gets no further rows; a consenting member with a broken vault exits 1; every
// malformed-manifest shape exits 1 before any member is checked; an unresolvable member path is
// UNKNOWN rather than skipped; the consent phrase counts only inside a `## Fleet` section, only
// on a line of its own (so a fenced example and an inline quotation in a written refusal both
// fail to enroll), tolerating bullet/blockquote/indent decoration, matched case-insensitively,
// under a closed-ATX heading as well as an open one; two pointers naming each other are DRIFTED
// rather than a parity mode; a missing vault is ABSENT and not a failure; a slug collision is a
// manifest error; and every emitted row parses under grammar (d).
//
//   node evals/fleet-standard/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checker = resolve(here, '..', '..', 'scripts', 'check-fleet.mjs');
const fixture = join(here, 'fleet');

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };
const run = (manifest) => {
  const r = spawnSync(process.execPath, [checker, manifest], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

// Grammar (d) of docs/techniques/artifact-grammars.md, copied here on purpose: this eval's job
// is to prove check-fleet.mjs emits that shape, so importing the producer's own idea of the
// shape would prove nothing. calibration-metrics.mjs holds the consuming copy.
const ROW_RE = /^\|\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*\|\s*([A-Za-z]+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/;
const VERDICTS = new Set(['CONFORMANT', 'DRIFTED', 'ABSENT', 'UNKNOWN']);

// Parse the surface rows out of a run's output, asserting each one is well-formed. Returns a
// surface -> verdict map. A malformed row is reported here rather than silently dropped, which
// is the same discipline the consuming parser applies.
function surfaces(label, out) {
  const map = new Map();
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line.startsWith('|')) continue;
    if (/^\|\s*surface\s*\|/i.test(line)) continue;
    if (/^\|(\s*:?-+:?\s*\|)+$/.test(line)) continue;
    const m = ROW_RE.exec(line);
    if (!m) { fails.push(`${label}: row does not parse under grammar (d): ${line}`); continue; }
    if (!VERDICTS.has(m[2].toUpperCase())) { fails.push(`${label}: verdict '${m[2]}' is outside grammar (d)'s four: ${line}`); continue; }
    if (map.has(m[1])) { fails.push(`${label}: surface '${m[1]}' repeats — grammar (d) counts a duplicate surface cell as unparseable`); continue; }
    map.set(m[1], m[2].toUpperCase());
  }
  return map;
}

// ---- 1. the committed pass fixture -------------------------------------------------
const ok = run(join(fixture, 'FLEET.json'));
expect(ok.status === 0, `the two-member consenting fixture should exit 0, got ${ok.status}:\n${ok.out}`);
expect(/\(fleet\) OK/.test(ok.out), `the pass fixture should print the OK line, got:\n${ok.out}`);
{
  const s = surfaces('pass fixture', ok.out);
  expect(s.get('alpha-consent') === 'CONFORMANT', `alpha should consent, got ${s.get('alpha-consent')}`);
  expect(s.get('alpha-contract') === 'CONFORMANT', `alpha's byte-identical pair should be conformant, got ${s.get('alpha-contract')}`);
  expect(s.get('alpha-vault') === 'CONFORMANT', `alpha's vault should be conformant, got ${s.get('alpha-vault')}`);
  // beta spells the phrase in capitals, so a case-sensitive regression fails here.
  expect(s.get('beta-consent') === 'CONFORMANT', `the consent phrase must match case-insensitively, got ${s.get('beta-consent')}`);
  expect(s.get('beta-contract') === 'CONFORMANT', `beta's pointer pair should be conformant, got ${s.get('beta-contract')}`);
  // Vault adoption is voluntary (decision D-002), so an absent vault is reported, not failed.
  expect(s.get('beta-vault') === 'ABSENT', `beta carries no vault, so the surface is ABSENT, got ${s.get('beta-vault')}`);
  expect(/parity mode: pointer pair/.test(ok.out), `the pointer mode should be named in the evidence cell, got:\n${ok.out}`);
}

// ---- temp-workspace scaffolding ----------------------------------------------------
let seq = 0;
const CONSENT = '## Fleet\n\nfleet member: yes\n\nEnrolled in the fixture fleet.\n';
// One temp workspace per case, holding whatever member repos the case needs plus its manifest.
function workspace(members, manifest) {
  const dir = mkdtempSync(join(tmpdir(), `fleet-eval-${seq++}-`));
  for (const [rel, contents] of Object.entries(members)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  const mpath = join(dir, 'FLEET.json');
  writeFileSync(mpath, typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2));
  return { dir, mpath };
}
const contract = (body) => `# fixture repo\n\n${body}`;
const member = (path, extra = {}) => ({ path, profile: 'product', roles: [], ...extra });

// ---- 2. a named, not consenting member ---------------------------------------------
// The row is present, the run still exits 0 on the strength of the other member, and the
// non-consenting repo gets NO further rows: the remaining surfaces describe a repo this run
// has no mandate over.
{
  const ws = workspace({
    'silent/CLAUDE.md': contract('This repo was named and never consented.\n'),
    'silent/AGENTS.md': contract('This repo was named and never consented.\n'),
  }, { version: 1, members: [member('silent'), member(join(fixture, 'alpha').replaceAll('\\', '/'))] });
  const r = run(ws.mpath);
  expect(r.status === 0, `a named, not consenting member must not fail the run, got ${r.status}:\n${r.out}`);
  const s = surfaces('not-consenting', r.out);
  expect(s.get('silent-consent') === 'ABSENT', `the non-consenting member's consent surface should be ABSENT, got ${s.get('silent-consent')}`);
  expect(/named, not consenting/.test(r.out), `the row should say 'named, not consenting', got:\n${r.out}`);
  expect(!s.has('silent-contract') && !s.has('silent-vault'),
    `a non-consenting member must get no surface rows past consent, got: ${[...s.keys()].join(', ')}`);
}

// ---- 3. the consent phrase outside a `## Fleet` section ------------------------------
// A contract that merely discusses the rule must not enroll itself. This repo's own contract
// is exactly that case, so a fail-open match here would enroll the marketplace by accident.
{
  const body = contract('## Doctrine\n\nA member consents by writing `fleet member: yes` in a Fleet section.\n');
  const ws = workspace({ 'prose/CLAUDE.md': body, 'prose/AGENTS.md': body },
    { version: 1, members: [member('prose')] });
  const r = run(ws.mpath);
  const s = surfaces('phrase-in-prose', r.out);
  expect(s.get('prose-consent') === 'ABSENT',
    `the phrase outside a '## Fleet' section must not enroll the repo, got ${s.get('prose-consent')}:\n${r.out}`);
  expect(r.status === 0, `a repo that never consented should not fail the run, got ${r.status}:\n${r.out}`);
}

// ---- 3b. the phrase INSIDE a `## Fleet` section but inside a code fence ---------------
// Documenting the rule is not consenting to it. Case 3 above only exercises the
// out-of-section path; this one and 3c exercise the in-section path, which is where a
// substring match over the whole section fails open.
{
  const body = contract('## Fleet\n\nNot a member. Joining would mean adding:\n\n```\nfleet member: yes\n```\n');
  const ws = workspace({ 'fenced/CLAUDE.md': body, 'fenced/AGENTS.md': body },
    { version: 1, members: [member('fenced')] });
  const r = run(ws.mpath);
  expect(surfaces('phrase-in-fence', r.out).get('fenced-consent') === 'ABSENT',
    `a fenced example of the phrase must not enroll the repo, got:\n${r.out}`);
  expect(r.status === 0, `a repo that never consented should not fail the run, got ${r.status}:\n${r.out}`);
}

// ---- 3c. an explicit refusal that quotes the phrase inline ---------------------------
{
  const body = contract('## Fleet\n\nWe are not a member. That would require `fleet member: yes` here.\n');
  const ws = workspace({ 'refuse/CLAUDE.md': body, 'refuse/AGENTS.md': body },
    { version: 1, members: [member('refuse')] });
  const r = run(ws.mpath);
  expect(surfaces('explicit-refusal', r.out).get('refuse-consent') === 'ABSENT',
    `an explicit refusal quoting the phrase must not enroll the repo, got:\n${r.out}`);
  expect(r.status === 0, `a repo that never consented should not fail the run, got ${r.status}:\n${r.out}`);
}

// ---- 3d. the consent line survives ordinary markdown decoration -----------------------
// The fix requires the phrase on its own line; a list bullet or blockquote marker in front
// of it is still its own line, and rejecting those would break a legitimate consent.
for (const [label, prefix] of [['bullet', '- '], ['blockquote', '> '], ['indented', '  ']]) {
  const body = contract(`## Fleet\n\n${prefix}fleet member: yes\n`);
  const ws = workspace({ [`${label}/CLAUDE.md`]: body, [`${label}/AGENTS.md`]: body },
    { version: 1, members: [member(label)] });
  const r = run(ws.mpath);
  expect(surfaces(`decorated-consent-${label}`, r.out).get(`${label}-consent`) === 'CONFORMANT',
    `the ${label}-decorated consent line must still enroll the repo, got:\n${r.out}`);
}

// ---- 3f. fence stripping must not swallow a real consent line after the fence ----------
// The mirror of 3b, and the direction that would fail silently: a section that shows a fenced
// counter-example and THEN consents is still consenting. An over-broad stripper reads this as
// a decline, which no operator would think to check.
{
  const body = contract('## Fleet\n\nAn example of what not to write:\n\n```\nfleet member: no\n```\n\nfleet member: yes\n');
  const ws = workspace({ 'after/CLAUDE.md': body, 'after/AGENTS.md': body },
    { version: 1, members: [member('after')] });
  const r = run(ws.mpath);
  expect(surfaces('consent-after-fence', r.out).get('after-consent') === 'CONFORMANT',
    `a consent line after a closed fence must still enroll the repo, got:\n${r.out}`);
}

// ---- 3e. a closed-ATX `## Fleet ##` heading still opens the section --------------------
// This fails in the safe direction, but it makes a genuinely enrolled repo invisible and the
// only operator signal is a row that reads like a deliberate decline.
{
  const body = contract('## Fleet ##\n\nfleet member: yes\n');
  const ws = workspace({ 'closed/CLAUDE.md': body, 'closed/AGENTS.md': body },
    { version: 1, members: [member('closed')] });
  const r = run(ws.mpath);
  expect(surfaces('closed-atx-heading', r.out).get('closed-consent') === 'CONFORMANT',
    `a closed-ATX '## Fleet ##' heading must open the consent section, got:\n${r.out}`);
}

// ---- 4. a consenting member with a broken vault --------------------------------------
{
  const ws = workspace({
    'gamma/CLAUDE.md': contract(CONSENT),
    'gamma/AGENTS.md': contract(CONSENT),
    // A vault directory with no Standard.md: the vault checker's own fail-closed case.
    'gamma/gamma-docs/00 Home.md': '---\ntype: home\nstatus: current\nupdated: 2026-08-18\n---\n',
  }, { version: 1, members: [member('gamma')] });
  const r = run(ws.mpath);
  expect(r.status === 1, `a consenting member with a broken vault must exit 1, got ${r.status}:\n${r.out}`);
  const s = surfaces('broken-vault', r.out);
  expect(s.get('gamma-vault') === 'DRIFTED', `the broken vault should be DRIFTED, got ${s.get('gamma-vault')}`);
  expect(/Standard\.md is missing/.test(r.out), `the vault checker's own message should reach the evidence cell, got:\n${r.out}`);
}

// ---- 5. a consenting member whose contract pair has drifted --------------------------
// Consent was read from a contract the other host never sees, so this is a failure and not a
// reported state. The shorter file is long enough to be substantive and names nothing.
{
  const long = contract(`${CONSENT}\n${'Substantive contract prose.\n'.repeat(30)}`);
  const ws = workspace({
    'delta/CLAUDE.md': long,
    'delta/AGENTS.md': contract('A second, divergent contract that points at nothing.\n'),
  }, { version: 1, members: [member('delta')] });
  const r = run(ws.mpath);
  expect(r.status === 1, `a drifted contract pair on a consenting member must exit 1, got ${r.status}:\n${r.out}`);
  expect(surfaces('drifted-contract', r.out).get('delta-contract') === 'DRIFTED',
    `the drifted pair should be DRIFTED, got:\n${r.out}`);
}

// ---- 5b. a circular pointer pair is DRIFTED, not a parity mode -----------------------
// The degenerate case of the pointer mode: both files are pointers naming each other, so
// EVERY host reads a stub and no file is the substantive contract. Strictly worse than the
// drift case 5 catches, and it is the only state the pointer branch let through.
{
  const ws = workspace({
    'circ/CLAUDE.md': contract('## Fleet\n\nfleet member: yes\n\nSee AGENTS.md — it is the canonical contract and required reading.\n'),
    'circ/AGENTS.md': contract('See CLAUDE.md — it is the canonical contract and required reading.\n'),
  }, { version: 1, members: [member('circ')] });
  const r = run(ws.mpath);
  expect(r.status === 1, `a circular pointer pair on a consenting member must exit 1, got ${r.status}:\n${r.out}`);
  expect(surfaces('circular-pointers', r.out).get('circ-contract') === 'DRIFTED',
    `two pointers naming each other leave no substantive contract, so the pair is DRIFTED, got:\n${r.out}`);
}

// ---- 6. an incomplete contract pair on a consenting member ---------------------------
{
  const ws = workspace({ 'eps/CLAUDE.md': contract(CONSENT) }, { version: 1, members: [member('eps')] });
  const r = run(ws.mpath);
  expect(r.status === 1, `a half-present contract pair on a consenting member must exit 1, got ${r.status}:\n${r.out}`);
  expect(surfaces('half-pair', r.out).get('eps-contract') === 'ABSENT',
    `a missing half of the pair should read ABSENT, got:\n${r.out}`);
}

// ---- 7. an unresolvable member path is UNKNOWN, never skipped ------------------------
{
  const ws = workspace({ 'keep/CLAUDE.md': contract(CONSENT) }, { version: 1, members: [member('nowhere')] });
  const r = run(ws.mpath);
  expect(r.status === 1, `an unresolvable member must fail closed, got ${r.status}:\n${r.out}`);
  expect(surfaces('missing-member', r.out).get('nowhere-consent') === 'UNKNOWN',
    `an unresolvable member should be UNKNOWN, never CONFORMANT or skipped, got:\n${r.out}`);
}

// ---- 8. malformed manifests, one assertion per shape ---------------------------------
const badManifests = [
  ['not JSON at all', '{ this is not json', /not valid JSON/],
  ['a JSON null', 'null', /not a JSON object/],
  ['a top-level array', '[]', /not a JSON object/],
  ['an unknown version', { version: 2, members: [member('x')] }, /`version` is 2/],
  ['members not an array', { version: 1, members: {} }, /`members` is not an array/],
  ['an empty members array', { version: 1, members: [] }, /`members` is empty/],
  ['a member that is not an object', { version: 1, members: ['x'] }, /members\[0\] is not an object/],
  ['a member with no path', { version: 1, members: [{ profile: 'product', roles: [] }] }, /no non-empty `path`/],
  ['a member with no profile', { version: 1, members: [{ path: 'x', roles: [] }] }, /no non-empty `profile`/],
  ['roles that are not strings', { version: 1, members: [{ path: 'x', profile: 'p', roles: [1] }] }, /`roles` is not an array of strings/],
  ['an unknown member key', { version: 1, members: [{ path: 'x', profile: 'p', roles: [], mode: 'auto' }] }, /unknown key `mode`/],
  ['two members that slug alike', { version: 1, members: [member('a/shared'), member('b/shared')] }, /both slug to 'shared'/],
  ['a repeated member path', { version: 1, members: [member('x'), member('x')] }, /repeats the path/],
];
for (const [label, manifest, re] of badManifests) {
  const ws = workspace({}, manifest);
  const r = run(ws.mpath);
  expect(r.status === 1, `${label} should exit 1, got ${r.status}:\n${r.out}`);
  expect(re.test(r.out), `${label} should report ${re}, got:\n${r.out}`);
  expect(/No member was checked/.test(r.out), `${label} should abort before checking any member, got:\n${r.out}`);
  expect(!/^\|/m.test(r.out), `${label} should emit no surface rows, got:\n${r.out}`);
}

// ---- 9. usage errors ------------------------------------------------------------------
expect(spawnSync(process.execPath, [checker], { encoding: 'utf8' }).status === 2, 'no argument should exit 2 (usage)');
expect(spawnSync(process.execPath, [checker, 'a', 'b'], { encoding: 'utf8' }).status === 2, 'two arguments should exit 2 (usage)');
expect(spawnSync(process.execPath, [checker, '--help'], { encoding: 'utf8' }).status === 2, 'a flag should exit 2 (usage)');
{
  const ws = workspace({}, { version: 1, members: [member('x')] });
  const r = spawnSync(process.execPath, [checker, join(ws.dir, 'NOPE.json')], { encoding: 'utf8' });
  expect(r.status === 2, `a manifest path that is not a file should exit 2, got ${r.status}`);
}

// ---- 10. a relative manifest resolves members against its own directory ---------------
// Copying the committed fixture elsewhere and checking it from a third directory proves member
// paths bind to the manifest, not to the process working directory.
{
  const dir = mkdtempSync(join(tmpdir(), 'fleet-eval-rel-'));
  cpSync(fixture, join(dir, 'ws'), { recursive: true });
  const r = spawnSync(process.execPath, [checker, join(dir, 'ws', 'FLEET.json')], { encoding: 'utf8', cwd: tmpdir() });
  expect(r.status === 0, `a relocated fixture should still pass from another cwd, got ${r.status}:\n${(r.stdout || '') + (r.stderr || '')}`);
}

// ---- report ---------------------------------------------------------------------------
if (fails.length) {
  for (const f of fails) console.error(`x ${f}`);
  console.error(`\n${fails.length} fleet-standard eval failure(s).`);
  process.exit(1);
}
console.log('fleet-standard eval: all cases pass.');
