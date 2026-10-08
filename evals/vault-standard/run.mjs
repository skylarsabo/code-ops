#!/usr/bin/env node
// Vault-conformance regression eval — pins check-vault-standard.mjs against a fixture pair.
// `conformant/` must exit 0 (with the expected `80 Runs` warning) and `violating/` must exit 1
// with at least one message per rule. The violating fixture also carries the two fail-open cases
// found in review: a status borrowed from a note type named in the same profile sentence, and a
// bare-stem `README.md` sitting in a folder other than the vault root.
//
// Cases that need a vault differing from the conformant fixture in exactly one way are
// synthesized in a temp dir at the bottom of this file, rather than committed as a tree apiece.
//
//   node evals/vault-standard/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// VAULT_CHECKER points the eval at another copy of the checker, so a new case can be shown to fail
// against the previous script.
const checker = process.env.VAULT_CHECKER ?? resolve(here, '..', '..', 'scripts', 'check-vault-standard.mjs');

const { fails, expect } = tally();
const run = (dir, ...flags) => {
  const r = spawnSync('node', [checker, dir, ...flags], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

// ---- the conformant fixture --------------------------------------------------------
const ok = run(join(here, 'conformant'));
expect(ok.status === 0, `conformant fixture should exit 0, got ${ok.status}:\n${ok.out}`);
expect(/\(vault\) OK/.test(ok.out), `conformant fixture should print the OK line, got:\n${ok.out}`);
expect(/WARN.*80 Runs/.test(ok.out), `absent '80 Runs/' should warn, never fail, got:\n${ok.out}`);
// The exemptions must hold: a template, an UPPER_SNAKE artifact, and the vault-root README carry
// no conformant note frontmatter and must not be reported.
expect(!/90 Templates|SSOT_MAP|VIOLATION\s+README\.md/.test(ok.out),
  `templates, UPPER_SNAKE artifacts, and the root README must stay exempt, got:\n${ok.out}`);
// The narrow profile-status capture must still admit a status declared in ordinary prose.
expect(!/recorded/.test(ok.out), `the declared profile status 'recorded' should be accepted, got:\n${ok.out}`);

// ---- the violating fixture: one assertion per rule ---------------------------------
const bad = run(join(here, 'violating'));
expect(bad.status === 1, `violating fixture should exit 1, got ${bad.status}:\n${bad.out}`);
const has = (re, label) => expect(re.test(bad.out), `violating fixture should report ${label}, got:\n${bad.out}`);

has(/standard-version/, 'rule 1 — Standard.md without `standard-version`');
has(/'00 Home\.md' is missing from the vault root/, 'rule 2 — a vault with no content map');
has(/'README\.md' is missing from the vault root/, 'rule 2 — a vault with no git-host entry point');
has(/machinery folder '99 Archive\/' is missing/, 'rule 3 — a missing machinery folder');
has(/folder 'Design\/' has no two-digit numeric prefix/,
  'rule 4 — an un-numbered top-level folder, the signature of a half-finished migration');
has(/'85 Bogus\/' sits in the reserved machinery band/, 'rule 5 — a domain folder in the 80-99 band');
has(/'05 Scratch\/' is numbered below 10/, 'rule 6 — a numbered folder below 10 that is not `00 Inbox`');
has(/no domain folder in the 10-79 band/, 'rule 7 — no domain folder');
has(/Missing fields\.md: frontmatter has no `status`/, 'rule 8 — a note missing `status`');
has(/Borrowed status\.md: status 'literature' is not one of/, 'rule 9 — a status outside the vocabulary');
has(/Missing fields\.md: updated 'yesterday' is not a YYYY-MM-DD date/, 'rule 10 — a malformed `updated`');

// The two review reproductions, pinned so neither can regress to fail-open. The borrowed status
// doubles as the rule 9 assertion above: only the token after 'profile status' declares one.
has(/00 Inbox\/README\.md: no YAML frontmatter block/,
  'a bare-stem README outside the vault root (neither exemption arm admits an unlisted bare stem)');

// ---- fail-closed on an unreadable vault --------------------------------------------
const empty = mkdtempSync(join(tmpdir(), 'vault-eval-'));
const bare = run(empty);
expect(bare.status === 1 && /Standard\.md is missing/.test(bare.out),
  `a vault with no Standard.md must fail closed, got ${bare.status}:\n${bare.out}`);
mkdirSync(join(empty, '10 Design'), { recursive: true });
writeFileSync(join(empty, 'Standard.md'), '# no frontmatter at all\n');
const nofm = run(empty);
expect(nofm.status === 1 && /Standard\.md has no YAML frontmatter block/.test(nofm.out),
  `a Standard.md with no frontmatter must fail closed, got ${nofm.status}:\n${nofm.out}`);
const usage = spawnSync('node', [checker], { encoding: 'utf8' });
expect(usage.status === 2, `no argument should exit 2 (usage), got ${usage.status}`);

// ---- synthesized single-variable vaults ---------------------------------------------
// Each case is a conformant vault with exactly one thing changed, so a failure names its cause.
let seq = 0;
const scaffold = (files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), `vault-case-${seq++}-`));
  for (const f of ['00 Inbox', '10 Design', '90 Templates', '95 Attachments', '98 System', '99 Archive'])
    mkdirSync(join(dir, f), { recursive: true });
  const tree = {
    'Standard.md': '---\ntype: standard\nstatus: current\nupdated: 2026-08-18\nstandard-version: 3\n---\n\n# Standard (synthesized fixture)\n',
    '00 Home.md': '---\ntype: home\nstatus: current\nupdated: 2026-08-18\n---\n\n# Home\n',
    'README.md': '# Readme — the git host entry point, deliberately without frontmatter\n',
    '10 Design/A note.md': '---\ntype: design\nstatus: draft\nupdated: 2026-08-18\n---\n\n# A note\n',
    ...files,
  };
  for (const [p, body] of Object.entries(tree)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
};

// Baseline: the synthesized vault is itself conformant, so any case below that fails does so
// for the one variable it changed and not for a defect in this helper.
const base = run(scaffold());
expect(base.status === 0, `the synthesized baseline vault should exit 0, got ${base.status}:\n${base.out}`);

const withManifest = (dir, domains) => {
  writeFileSync(join(dir, '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify({
    version: 1,
    hub: basename(dir),
    domains,
  }, null, 2)}\n`);
  return dir;
};

// A manifest domain cannot convert a working-note band into a blanket exemption. Extra domains
// are valid registry entries, so this must be enforced at the frontmatter-exemption boundary.
const maliciousDomain = run(withManifest(scaffold({
  '10 Design/Unfronted note.md': '# Ordinary working note\n',
}), [{ id: 'design-notes', path: '10 Design', status: 'current' }]));
expect(maliciousDomain.status === 1 && /10 Design\/Unfronted note\.md: no YAML frontmatter block/.test(maliciousDomain.out),
  `a manifest domain targeting a working-note band must not exempt its notes, got ${maliciousDomain.status}:\n${maliciousDomain.out}`);

// Published reference targets deliberately retain their reader-facing Markdown shape. Pin file
// and directory targets, plus the not-applicable status used by repositories with no UI system.
const publishedTargets = run(withManifest(scaffold({
  '20 Decisions/ADRs/0001-record.md': '# Published decision\n',
  '30 Architecture/ARCHITECTURE.md': '# Architecture reference\n',
  '40 Engineering/Handbook/commands.md': '# Handbook reference\n',
  '60 Experience/DESIGN_SYSTEM.md': '# No product UI\n',
  '98 System/Atlas/module.md': '# Atlas reference\n',
}), [
  { id: 'decisions', path: '20 Decisions/ADRs', status: 'current' },
  { id: 'architecture', path: '30 Architecture/ARCHITECTURE.md', status: 'current' },
  { id: 'handbook', path: '40 Engineering/Handbook', status: 'current' },
  { id: 'design-system', path: '60 Experience/DESIGN_SYSTEM.md', status: 'not-applicable' },
  { id: 'atlas', path: '98 System/Atlas', status: 'current' },
]));
expect(publishedTargets.status === 0,
  `current and not-applicable published manifest targets must remain exempt, got ${publishedTargets.status}:\n${publishedTargets.out}`);

const recordManifest = (standardVersion, manifestVersion = 2, extra = {}, files = {}, standardBody = '') => {
  const dir = scaffold({
    'Standard.md': `---\ntype: standard\nstatus: current\nupdated: 2026-08-18\nstandard-version: ${standardVersion}\n---\n\n# Standard\n${standardBody}`,
    '98 System/Records/audit.md': '# Generated record index without note frontmatter\n',
    ...files,
  });
  writeFileSync(join(dir, '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify({
    version: manifestVersion,
    hub: basename(dir),
    runs: { tracking: 'ignored' },
    legacyPaths: [],
    domains: [],
    recordCollections: [{
      id: 'audit-records', collectionUuid: '00000000-0000-4000-8000-000000000001', identityVersion: 1,
      root: 'docs/audit', inventory: '98 System/Records/audit.json', citations: '98 System/Records/audit-citations.json',
      curationLedger: '98 System/Records/audit-curation.jsonl', index: '98 System/Records/audit.md',
      scopes: [{ pattern: '**/*.md', kind: 'record', policy: 'append-only' }],
    }],
    ...extra,
  }, null, 2)}\n`);
  return dir;
};
const generatedRecordIndex = run(recordManifest(4));
expect(generatedRecordIndex.status === 0 && !/Records\/audit\.md/.test(generatedRecordIndex.out),
  `a manifest-v2 generated record index must be exempt by exact path, got ${generatedRecordIndex.status}:\n${generatedRecordIndex.out}`);
const generatedRecordSibling = recordManifest(4);
writeFileSync(join(generatedRecordSibling, '98 System', 'Records', 'ordinary.md'), '# Ordinary malformed note\n');
const generatedRecordSiblingResult = run(generatedRecordSibling);
expect(generatedRecordSiblingResult.status === 1 && /Records\/ordinary\.md: no YAML frontmatter block/.test(generatedRecordSiblingResult.out),
  `a generated-record exemption must not exempt an ordinary sibling note, got ${generatedRecordSiblingResult.status}:\n${generatedRecordSiblingResult.out}`);
// Record bytes a relocation moved into the hub are immutable, so a collection root inside the hub
// exempts its files from the frontmatter rule. It exempts nothing else: a sibling folder, a hostile
// root naming the hub itself, and a root that climbs out of it all keep the rule.
const insideHub = (root, files) => {
  const dir = recordManifest(4, 2, {}, files);
  const manifestFile = join(dir, '98 System', 'DOCS_MANIFEST.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.recordCollections[0].root = root(basename(dir));
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return run(dir);
};
const recordBytes = { '50 Records/audit/0001.md': '# A record with no note frontmatter\n' };
const recordRootExempt = insideHub((hub) => `${hub}/50 Records/audit`, recordBytes);
expect(recordRootExempt.status === 0 && !/50 Records/.test(recordRootExempt.out),
  `record files under a collection root inside the hub must be exempt from the frontmatter rule, got ${recordRootExempt.status}:\n${recordRootExempt.out}`);
const recordRootSibling = insideHub((hub) => `${hub}/50 Records/audit`, { ...recordBytes, '50 Records/other/Note.md': '# Ordinary note, no frontmatter\n' });
expect(recordRootSibling.status === 1 && /50 Records\/other\/Note\.md: no YAML frontmatter block/.test(recordRootSibling.out)
  && !/50 Records\/audit\/0001/.test(recordRootSibling.out),
  `a note outside every collection root must still fail without frontmatter, got ${recordRootSibling.status}:\n${recordRootSibling.out}`);
for (const [label, root] of [['the hub itself', (hub) => hub], ['a root that climbs out of the hub', (hub) => `${hub}/../${hub}`]]) {
  const hostile = insideHub(root, { '10 Design/Unfronted note.md': '# Ordinary working note\n' });
  expect(hostile.status === 1 && /10 Design\/Unfronted note\.md: no YAML frontmatter block/.test(hostile.out),
    `a collection root naming ${label} must not exempt hub notes, got ${hostile.status}:\n${hostile.out}`);
}
const incompatibleRecordManifest = run(recordManifest(3));
expect(incompatibleRecordManifest.status === 1 && /standard-version: 4/.test(incompatibleRecordManifest.out),
  `manifest v2 must require vault standard v4, got ${incompatibleRecordManifest.status}:\n${incompatibleRecordManifest.out}`);

// Manifest v3 (vault standard v5) is readable, keeps the generated-index exemption, and takes
// its draft statuses from `drafts.statuses`. A v2 manifest still reads them from the prose.
// `drafts.statuses` is the whole vocabulary under v3, so the fixture lists the base statuses too.
const BASE_STATUSES = ['draft', 'current', 'accepted', 'superseded'];
const V3 = { runs: { tracking: 'closeout', retain: [] }, drafts: { maxAgeDays: 21, statuses: [...BASE_STATUSES, 'recorded'] }, state: {} };
// A v3 vault must carry its generated surfaces, so a case renders before it checks.
const renderRun = (dir) => { run(dir, '--render'); return run(dir); };
const recordedNote = { '10 Design/Recorded.md': '---\ntype: design\nstatus: recorded\nupdated: 2026-08-18\n---\n\n# Recorded\n' };
const legacyNote = { '10 Design/Legacy.md': '---\ntype: design\nstatus: legacy\nupdated: 2026-08-18\n---\n\n# Legacy\n' };
const proseStatus = '\nThis profile adds the profile status `legacy`.\n';
const v3Valid = renderRun(recordManifest(5, 3, V3, recordedNote));
expect(v3Valid.status === 0 && !/Records\/audit\.md/.test(v3Valid.out),
  `a manifest-v3 vault under standard v5 must pass with drafts.statuses applied, got ${v3Valid.status}:\n${v3Valid.out}`);
const v3OldStandard = run(recordManifest(4, 3, V3));
expect(v3OldStandard.status === 1 && /standard-version: 5/.test(v3OldStandard.out),
  `manifest v3 must require vault standard v5, got ${v3OldStandard.status}:\n${v3OldStandard.out}`);
const v3IgnoresProse = run(recordManifest(5, 3, V3, legacyNote, proseStatus));
expect(v3IgnoresProse.status === 1 && /Legacy\.md/.test(v3IgnoresProse.out),
  `under manifest v3 a prose-only profile status must not be accepted, got ${v3IgnoresProse.status}:\n${v3IgnoresProse.out}`);
const v3BadStatuses = run(recordManifest(5, 3, { ...V3, drafts: { maxAgeDays: 21, statuses: [] } }));
expect(v3BadStatuses.status === 1 && /drafts\.statuses/.test(v3BadStatuses.out),
  `manifest v3 without valid drafts.statuses must fail closed, got ${v3BadStatuses.status}:\n${v3BadStatuses.out}`);
// The slug rule is shared with docs-manifest.mjs (evals/docs-manifest/run.mjs pins the same three
// slugs there): a digit-led slug is valid, a trailing or doubled hyphen is not.
const digitNote = { '10 Design/Lives.md': '---\ntype: design\nstatus: 9-lives\nupdated: 2026-08-18\n---\n\n# Lives\n' };
const v3DigitSlug = renderRun(recordManifest(5, 3, { ...V3, drafts: { maxAgeDays: 21, statuses: [...BASE_STATUSES, '9-lives'] } }, digitNote));
expect(v3DigitSlug.status === 0,
  `a digit-led drafts.statuses slug must be accepted like docs-manifest.mjs, got ${v3DigitSlug.status}:\n${v3DigitSlug.out}`);
for (const badSlug of ['a-', 'a--b']) {
  const badSlugResult = run(recordManifest(5, 3, { ...V3, drafts: { maxAgeDays: 21, statuses: [badSlug] } }));
  expect(badSlugResult.status === 1 && /drafts\.statuses/.test(badSlugResult.out),
    `drafts.statuses slug ${badSlug} must be rejected like docs-manifest.mjs, got ${badSlugResult.status}:\n${badSlugResult.out}`);
}
const v2Prose = run(recordManifest(5, 2, {}, legacyNote, proseStatus));
expect(v2Prose.status === 0, `manifest v2 must still read profile statuses from the prose, got ${v2Prose.status}:\n${v2Prose.out}`);
const v2IgnoresDrafts = run(recordManifest(5, 2, {}, recordedNote));
expect(v2IgnoresDrafts.status === 1 && /Recorded\.md/.test(v2IgnoresDrafts.out),
  `manifest v2 must not gain statuses it did not declare, got ${v2IgnoresDrafts.status}:\n${v2IgnoresDrafts.out}`);

// ---- manifest v3 draft rules (W4) ----------------------------------------------------------
// Every case is a v3 vault that differs from a rendered, passing one in exactly one way.
const gitIn = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
const readdirNames = (dir) => readdirSync(dir);
const today = new Date().toISOString().slice(0, 10);
const OLD = '2020-01-01';
const note = (status, updated, { type = 'design', extra = '', body = '' } = {}) =>
  `---\ntype: ${type}\nstatus: ${status}\nupdated: ${updated}\n${extra}---\n\n${body}# Note\n`;
const v3Vault = (files = {}, drafts = V3.drafts) => recordManifest(5, 3, { ...V3, drafts }, files);
const sees = (r, re) => re.test(r.out);
const v3Base = renderRun(v3Vault());
expect(v3Base.status === 0, `a rendered v3 baseline vault must pass, got ${v3Base.status}:\n${v3Base.out}`);

// Rule 11: drafts.statuses replaces the vocabulary. `current` is a base status, so omitting it
// from the manifest makes the Home note illegal, which the old add-only behavior would let through.
const noCurrent = renderRun(v3Vault({}, { maxAgeDays: 21, statuses: ['draft', 'recorded'] }));
expect(noCurrent.status === 1 && sees(noCurrent, /00 Home\.md: status 'current' is not one of draft, recorded/),
  `v3 drafts.statuses must replace the built-in statuses, got ${noCurrent.status}:\n${noCurrent.out}`);
const badAge = run(v3Vault({}, { maxAgeDays: 0, statuses: BASE_STATUSES }));
expect(badAge.status === 1 && sees(badAge, /drafts\.maxAgeDays/), `v3 needs a valid drafts.maxAgeDays, got ${badAge.status}:\n${badAge.out}`);

// Rule 12: superseded needs a superseded-by link that resolves.
const successor = { '10 Design/Successor.md': note('current', today) };
const supersededCase = (extra, files = successor) => renderRun(v3Vault({ '10 Design/Old.md': note('superseded', today, { extra }), ...files }));
const supOk = supersededCase('superseded-by: "[[Successor]]"\n');
expect(supOk.status === 0, `superseded with a resolving wikilink must pass, got ${supOk.status}:\n${supOk.out}`);
const supAlias = supersededCase('superseded-by: "[[Successor#heading|the successor]]"\n');
expect(supAlias.status === 0, `a wikilink with a heading and alias must resolve, got ${supAlias.status}:\n${supAlias.out}`);
const supPath = supersededCase('superseded-by: 10 Design/Successor.md\n');
expect(supPath.status === 0, `a vault-relative path must resolve, got ${supPath.status}:\n${supPath.out}`);
for (const [label, extra] of [['no superseded-by', ''], ['a dangling link', 'superseded-by: "[[Nowhere]]"\n'], ['an empty value', 'superseded-by:\n'], ['a link to itself', 'superseded-by: "[[Old]]"\n']]) {
  const r = supersededCase(extra);
  expect(r.status === 1 && sees(r, /Old\.md: status superseded needs a `superseded-by`/),
    `superseded with ${label} must fail, got ${r.status}:\n${r.out}`);
}

// Rule 13: a draft that says it was promoted or superseded must say so in its status.
const marked = (line, status = 'draft', filler = 0) => renderRun(v3Vault({
  '10 Design/Marked.md': note(status, today, { body: `${'filler\n'.repeat(filler)}${line}\n\n` }),
}));
const promoted = marked('PROMOTED to 20 Decisions/ADRs/0007.md');
expect(promoted.status === 1 && sees(promoted, /Marked\.md: a draft carries a PROMOTED or SUPERSEDED marker/),
  `a draft marked PROMOTED must fail, got ${promoted.status}:\n${promoted.out}`);
const supMarker = marked('SUPERSEDED by another note');
expect(supMarker.status === 1 && sees(supMarker, /Marked\.md: a draft carries a PROMOTED or SUPERSEDED marker/),
  `a draft marked SUPERSEDED must fail, got ${supMarker.status}:\n${supMarker.out}`);
const lateMarker = marked('PROMOTED far below the header window', 'draft', 30);
expect(lateMarker.status === 0, `a marker past line 30 is outside the rule, got ${lateMarker.status}:\n${lateMarker.out}`);
const currentMarker = marked('PROMOTED is fine outside a draft', 'current');
expect(currentMarker.status === 0, `only a draft is barred from carrying the marker, got ${currentMarker.status}:\n${currentMarker.out}`);
const lowerMarker = marked('this promoted idea is prose, not a marker');
expect(lowerMarker.status === 0, `a lowercase word is not a marker, got ${lowerMarker.status}:\n${lowerMarker.out}`);

// Rule 14: triage and INDEX are generated, and check mode fails when they are stale or absent.
// A missing surface reads as empty, so a checker without rendering fails the case instead of crashing the eval.
const readNote = (dir, path) => { try { return readFileSync(join(dir, path), 'utf8'); } catch { return ''; } };
const triageOf = (dir) => readNote(dir, '98 System/TRIAGE.md');
const staleDraft = (extra = '') => ({ '10 Design/Stale.md': note('draft', OLD, { extra }) });
const unrendered = run(v3Vault());
expect(unrendered.status === 1 && sees(unrendered, /INDEX\.md is missing/) && sees(unrendered, /TRIAGE\.md is missing/),
  `a v3 vault with no generated surfaces must fail, got ${unrendered.status}:\n${unrendered.out}`);
const triaged = v3Vault(staleDraft());
const triagedRun = renderRun(triaged);
expect(triagedRun.status === 0, `triage is a queue, not a failure, got ${triagedRun.status}:\n${triagedRun.out}`);
expect(triageOf(triaged).includes(`- 10 Design/Stale.md | stale-draft | ${today}\n`),
  `an old draft with no next: line must enter triage today, got:\n${triageOf(triaged)}`);
const nextedFrontmatter = v3Vault(staleDraft('next: promote or delete\n'));
renderRun(nextedFrontmatter);
expect(!/Stale\.md/.test(triageOf(nextedFrontmatter)), 'an old draft with a next: frontmatter line must stay out of triage');
const nextedBody = v3Vault({ '10 Design/Stale.md': note('draft', OLD, { body: 'next: write the ADR\n\n' }) });
renderRun(nextedBody);
expect(!/Stale\.md/.test(triageOf(nextedBody)), 'an old draft with a next: body line must stay out of triage');
const freshDraft = v3Vault({ '10 Design/Fresh.md': note('draft', today) });
renderRun(freshDraft);
expect(!/Fresh\.md/.test(triageOf(freshDraft)), 'a draft inside maxAgeDays must stay out of triage');
const oldCurrent = v3Vault({ '10 Design/Settled.md': note('current', OLD) });
renderRun(oldCurrent);
expect(!/Settled\.md/.test(triageOf(oldCurrent)), 'an old note that is not a draft must stay out of triage');
// An item keeps the date it first entered, and check mode compares the set of items, not the day.
const keepDate = v3Vault(staleDraft());
writeFileSync(join(keepDate, '98 System', 'TRIAGE.md'), '---\ntype: triage\n---\n- 10 Design/Stale.md | stale-draft | 2026-01-02\n- 10 Design/Stale.md | stale-draft | 2026-03-04\n');
const keepRender = run(keepDate, '--render');
expect(keepRender.status === 0 && triageOf(keepDate).includes('- 10 Design/Stale.md | stale-draft | 2026-01-02\n') && !triageOf(keepDate).includes('2026-03-04'),
  `a listed item must keep its earliest date on render, got:\n${triageOf(keepDate)}`);
expect(run(keepDate).status === 0, 'a triage file that keeps its dates must pass check mode');
// A cause that clears leaves a stale queue until the next render.
writeFileSync(join(keepDate, '10 Design', 'Stale.md'), note('draft', OLD, { extra: 'next: decide\n' }));
const clearedStale = run(keepDate);
expect(clearedStale.status === 1 && sees(clearedStale, /TRIAGE\.md is stale/), `a cleared triage item must leave TRIAGE stale, got ${clearedStale.status}:\n${clearedStale.out}`);
run(keepDate, '--render');
expect(!/Stale\.md/.test(triageOf(keepDate)) && run(keepDate).status === 0, 'render must drop a cleared item and restore a passing check');
// A hand-written surface cannot hide content behind the exemption.
const handEdited = v3Vault(staleDraft());
renderRun(handEdited);
writeFileSync(join(handEdited, '98 System', 'TRIAGE.md'), `${triageOf(handEdited)}\nsmuggled line\n`);
const handEditedRun = run(handEdited);
expect(handEditedRun.status === 1 && sees(handEditedRun, /TRIAGE\.md is stale/), `an edited TRIAGE must fail, got ${handEditedRun.status}:\n${handEditedRun.out}`);
// Synthesis pages need sources or a recent update.
const synthesis = (name, updated, extra = '') => ({ [`10 Design/${name}.md`]: note('current', updated, { type: 'synthesis', extra }) });
const synthTriage = v3Vault({ ...synthesis('Unsourced', OLD), ...synthesis('Fresh synthesis', today), ...synthesis('Sourced', OLD, 'sources: scripts/**\n') });
renderRun(synthTriage);
expect(triageOf(synthTriage).includes('- 10 Design/Unsourced.md | unsourced-synthesis |') && !/Fresh synthesis|Sourced\.md/.test(triageOf(synthTriage)),
  `only an old synthesis with no sources enters triage, got:\n${triageOf(synthTriage)}`);
// A file archived whole keeps its draft status and no-edit bytes, so it is no live draft and never enters triage.
// The live twin under 10 Design still does, so the exclusion is the folder and not the rule.
const archivedTriage = v3Vault({
  '99 Archive/Old draft.md': note('draft', OLD),
  '99 Archive/Specs/Old synthesis.md': note('current', OLD, { type: 'synthesis' }),
  ...staleDraft(),
});
const archivedRun = renderRun(archivedTriage);
expect(archivedRun.status === 0 && triageOf(archivedTriage).includes('- 10 Design/Stale.md | stale-draft |')
  && !/99 Archive/.test(triageOf(archivedTriage)),
  `a stale draft or unsourced synthesis under 99 Archive must stay out of triage while a live one is listed, got ${archivedRun.status}:\n${archivedRun.out}\n${triageOf(archivedTriage)}`);
const archiveNameOnly = v3Vault({ '10 Design/99 Archive/Nested.md': note('draft', OLD) });
renderRun(archiveNameOnly);
expect(/Nested\.md \| stale-draft/.test(triageOf(archiveNameOnly)), 'only the hub-level 99 Archive folder is exempt from triage; a folder of that name below another folder is not');
// INDEX: grouped by status in manifest order, each note with its date and next line.
const indexed = v3Vault({
  '10 Design/Alpha.md': note('draft', today, { extra: 'next: ship it\n' }),
  '10 Design/Beta.md': note('current', '2026-08-01'),
  '10 Design/Sub/Gamma.md': note('draft', today),
});
renderRun(indexed);
const indexText = readNote(indexed, '10 Design/INDEX.md');
expect(/## draft\n\n- \[\[10 Design\/A note\]\][^\n]*\n- \[\[10 Design\/Alpha\]\] · updated \d{4}-\d{2}-\d{2} · next: ship it\n- \[\[10 Design\/Sub\/Gamma\]\] · updated \d{4}-\d{2}-\d{2} · next: \(none\)\n\n## current\n\n- \[\[10 Design\/Beta\]\] · updated 2026-08-01 · next: \(none\)/.test(indexText)
  && !/INDEX\]\]/.test(indexText), `INDEX must group by status with updated and next:, got:\n${indexText}`);
writeFileSync(join(indexed, '10 Design', 'Beta.md'), note('current', '2026-08-02'));
const indexStale = run(indexed);
expect(indexStale.status === 1 && sees(indexStale, /INDEX\.md is stale/), `an INDEX out of date with its notes must fail, got ${indexStale.status}:\n${indexStale.out}`);
// CRLF checkouts must not read as stale.
const crlf = v3Vault(staleDraft());
renderRun(crlf);
writeFileSync(join(crlf, '98 System', 'TRIAGE.md'), triageOf(crlf).replace(/\n/g, '\r\n'));
writeFileSync(join(crlf, '10 Design', 'INDEX.md'), readNote(crlf, '10 Design/INDEX.md').replace(/\n/g, '\r\n'));
expect(run(crlf).status === 0, 'generated surfaces checked out with CRLF must still pass');

// Rule 15: `sources:` staleness, digest recorded in the page's own `sourceDigest:` frontmatter.
// The vault sits inside a git repository because the digest hashes the repository's file list.
const repoVault = (files) => {
  const dir = v3Vault(files);
  const root = mkdtempSync(join(tmpdir(), 'vault-repo-'));
  const moved = join(root, basename(dir));
  renameSync(dir, moved);
  gitIn(root, ['init', '-q']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.txt'), 'one\n');
  writeFileSync(join(root, 'src', 'b.txt'), 'two\n');
  writeFileSync(join(root, 'other.txt'), 'unrelated\n');
  return { root, vault: moved };
};
const sourced = (extra) => ({ '10 Design/Synth.md': note('current', today, { type: 'synthesis', extra }) });
const digestOf = (vaultDir) => /^sourceDigest: ([0-9a-f]{64})$/m.exec(readNote(vaultDir, '10 Design/Synth.md'))?.[1];
const src = repoVault(sourced('sources: src/**\n'));
run(src.vault, '--render');
const noDigest = run(src.vault);
expect(noDigest.status === 1 && sees(noDigest, /Synth\.md: declares sources but no `sourceDigest:`/), `sources with no recorded digest must fail, got ${noDigest.status}:\n${noDigest.out}`);
const stamped = run(src.vault, '--stamp', '10 Design/Synth.md');
expect(stamped.status === 0 && digestOf(src.vault), `--stamp must record a digest, got ${stamped.status}:\n${stamped.out}`);
expect(run(src.vault).status === 0, 'a stamped page must pass check mode');
const firstDigest = digestOf(src.vault);
writeFileSync(join(src.root, 'other.txt'), 'changed but unmatched\n');
expect(run(src.vault).status === 0, 'a change outside the globs must not stale the page');
writeFileSync(join(src.root, 'src', 'a.txt'), 'one, edited\n');
const changed = run(src.vault);
expect(changed.status === 1 && sees(changed, /Synth\.md: a source changed after its recorded sourceDigest/), `a changed source must stale the page, got ${changed.status}:\n${changed.out}`);
run(src.vault, '--stamp', '10 Design/Synth.md');
expect(run(src.vault).status === 0 && digestOf(src.vault) !== firstDigest, 're-stamping after a source change must pass with a new digest');
writeFileSync(join(src.root, 'src', 'c.txt'), 'a new matching file\n');
expect(run(src.vault).status === 1, 'a new file matching the globs must stale the page');
// Flow, comma, and block list spellings all read the same patterns.
for (const [label, extra] of [['flow list', 'sources: [src/a.txt, src/b.txt]\n'], ['comma list', 'sources: src/a.txt, src/b.txt\n'], ['block list', 'sources:\n  - src/a.txt\n  - src/b.txt\n']]) {
  const repo = repoVault(sourced(extra));
  run(repo.vault, '--render');
  const stampedList = run(repo.vault, '--stamp', '10 Design/Synth.md');
  const passes = run(repo.vault).status === 0;
  writeFileSync(join(repo.root, 'src', 'b.txt'), 'two, edited\n');
  const after = run(repo.vault);
  expect(stampedList.status === 0 && passes && after.status === 1 && sees(after, /a source changed/), `${label} sources must stamp, pass, then stale on a change, got ${stampedList.out}${after.out}`);
}
const wrongDigest = repoVault(sourced(`sources: src/**\nsourceDigest: ${'0'.repeat(64)}\n`));
run(wrongDigest.vault, '--render');
expect(run(wrongDigest.vault).status === 1, 'a wrong recorded digest must fail');
const vacuous = repoVault(sourced('sources: nowhere/**\n'));
run(vacuous.vault, '--render');
const vacuousRun = run(vacuous.vault);
expect(vacuousRun.status === 1 && sees(vacuousRun, /match no repository files/), `sources that match nothing must fail, got ${vacuousRun.status}:\n${vacuousRun.out}`);
const selfRef = repoVault(sourced('sources: "**/Synth.md"\n'));
run(selfRef.vault, '--render');
const selfRefStamp = run(selfRef.vault, '--stamp', '10 Design/Synth.md');
expect(selfRefStamp.status === 1 && sees(selfRefStamp, /match no repository files/), `a page must not hash itself, got ${selfRefStamp.status}:\n${selfRefStamp.out}`);
const noGitSources = renderRun(v3Vault(sourced('sources: src/**\nsourceDigest: abc\n')));
expect(noGitSources.status === 1 && sees(noGitSources, /Synth\.md: cannot compute the sources digest|match no repository files/), `sources outside a git work tree must fail closed, got ${noGitSources.status}:\n${noGitSources.out}`);
// --stamp refuses a page with no sources, and the flag grammar is closed.
const stampNone = run(repoVault({}).vault, '--stamp', '10 Design/A note.md');
expect(stampNone.status === 1, `--stamp on a page with no sources must fail, got ${stampNone.status}`);
expect(run(scaffold(), '--render', '--stamp', 'x').status === 2, '--render with --stamp must be a usage error');
expect(run(scaffold(), '--stamp').status === 2, '--stamp with no page must be a usage error');
expect(run(scaffold(), '--bogus').status === 2, 'an unknown flag must be a usage error');

// Guarantee 1: a vault whose manifest is not v3 sees none of these rules, and --render is a no-op.
const dormant = {
  '10 Design/Sup.md': note('superseded', today),
  '10 Design/Drafty.md': note('draft', OLD, { body: 'PROMOTED long ago\n' }),
  '10 Design/Synth.md': note('current', OLD, { type: 'synthesis', extra: 'sources: src/**\n' }),
  '10 Design/Orphan.md': note('current', OLD, { type: 'synthesis' }),
};
for (const [label, dir] of [['v2 manifest', recordManifest(5, 2, {}, dormant)], ['no manifest', scaffold(dormant)]]) {
  const r = run(dir);
  expect(r.status === 0, `a ${label} vault must not gain the draft rules, got ${r.status}:\n${r.out}`);
  const rendered = run(dir, '--render');
  expect(rendered.status === 0 && sees(rendered, /render skipped/), `--render on a ${label} vault must be a no-op, got ${rendered.status}:\n${rendered.out}`);
  expect(!readdirNames(join(dir, '98 System')).includes('TRIAGE.md') && !readdirNames(join(dir, '10 Design')).includes('INDEX.md'), `--render on a ${label} vault must write nothing`);
  const stampV2 = run(dir, '--stamp', '10 Design/Synth.md');
  expect(stampV2.status === 1, `--stamp on a ${label} vault must fail, got ${stampV2.status}`);
}

// Canonical run artifacts carry no frontmatter by design. All nine of the artifact table in
// code-ops-docs/40 Engineering/Techniques/vault-standard.md must pass, `HANDOFF.md` included — its bare all-caps stem
// has no underscore, so the shape rule alone rejected it and broke every orchestrated handoff.
const CANONICAL = ['FINDINGS_REGISTER.md', 'LEAK_REGISTER.md', 'EXECUTIVE_SUMMARY.md',
  'DISPATCH_LEDGER.md', 'REPO_MAP.md', 'REFUTATION_LOG.md', 'RUN_RECEIPTS.md', 'HANDOFF.md',
  'EGRESS_MANIFEST.md'];
const artifacts = Object.fromEntries(
  CANONICAL.map((n) => [`80 Runs/2026-08-18 a run/${n}`, `# ${n}\n\nNo frontmatter, by design.\n`]));
const canon = run(scaffold(artifacts));
expect(canon.status === 0,
  `every canonical run artifact must be exempt from the note rules, got ${canon.status}:\n${canon.out}`);
expect(!/HANDOFF/.test(canon.out), `HANDOFF.md must not be reported, got:\n${canon.out}`);

// A `standard-version` below the pinned floor is a stale conformance copy. Presence alone proved
// nothing, so the number is compared.
const stale = run(scaffold({
  'Standard.md': '---\ntype: standard\nstatus: current\nupdated: 2026-08-18\nstandard-version: 1\n---\n\n# Standard (stale)\n',
}));
expect(stale.status === 1 && /below the current standard-version 3/.test(stale.out),
  `a standard-version below the floor must fail, got ${stale.status}:\n${stale.out}`);

// YAML writes the same scalar bare, single-quoted, or double-quoted. Rejecting two of the three
// spellings is a false violation, and a fail-closed gate that cries wolf gets bypassed.
const quoted = run(scaffold({
  '10 Design/A note.md': '---\ntype: "design"\nstatus: \'draft\'\nupdated: "2026-08-18"\n---\n\n# A note\n',
}));
expect(quoted.status === 0,
  `quoted YAML scalars must validate like bare ones, got ${quoted.status}:\n${quoted.out}`);

// A note git ignores is local scratch that CI never sees, so the walk skips it; ruling on it made
// a local run fail where CI passed. The skip must never narrow tracked coverage: the same notes,
// force-added so an ignore pattern still matches them, fail, and outside a git repo they fail too.
const scratch = {
  '.gitignore': 'scratch/\nLocal note.md\n',
  '10 Design/scratch/Unfronted.md': '# ignored directory scratch\n',
  '10 Design/Local note.md': '# ignored file scratch\n',
};
const noGit = run(scaffold(scratch));
expect(noGit.status === 1 && /Unfronted\.md/.test(noGit.out) && /Local note\.md/.test(noGit.out),
  `outside a git repo every note must still be checked, got ${noGit.status}:\n${noGit.out}`);
const ignoredVault = scaffold(scratch);
gitIn(ignoredVault, ['init', '-q']);
const skipped = run(ignoredVault);
expect(skipped.status === 0, `git-ignored notes must be skipped, got ${skipped.status}:\n${skipped.out}`);
gitIn(ignoredVault, ['add', '-f', '--', '10 Design/scratch/Unfronted.md', '10 Design/Local note.md']);
const tracked = run(ignoredVault);
expect(tracked.status === 1 && /Unfronted\.md: no YAML frontmatter block/.test(tracked.out)
  && /Local note\.md: no YAML frontmatter block/.test(tracked.out),
  `a tracked note matching an ignore pattern must still fail, got ${tracked.status}:\n${tracked.out}`);

// ---- the runs index (`--render` writes 80 Runs/INDEX.md) --------------------------------------
// `--now` fixes the day so tier edges are exact: age 30 is active, 31 is distill-ready, 180 is
// distill-ready, 181 is archive (code-ops-docs/55 Operations/RUN_RETENTION.md).
const NOW = '2026-10-07';
const dayAgo = (days, rest) => `${new Date(Date.UTC(2026, 9, 7) - days * 86_400_000).toISOString().slice(0, 10)}${rest}`;
const runsIndexOf = (dir) => readNote(dir, '80 Runs/INDEX.md');
const rowFor = (text, name) => text.split('\n').find((line) => line.startsWith(`| ${name} |`)) ?? '';
const renderNow = (dir, now = NOW) => run(dir, '--render', '--now', now);
const emptyRun = (dir, name) => mkdirSync(join(dir, '80 Runs', name), { recursive: true });

const logged = dayAgo(0, ' logged run');
const edge30 = dayAgo(30, ' edge');
const edge31 = dayAgo(31, ' edge');
const edge180 = dayAgo(180, ' edge');
const edge181 = dayAgo(181, ' edge');
const runsVault = v3Vault({
  [`80 Runs/${logged}/RUN_LOG.md`]: '# Log\nStatus: early\n- Verdict: **merged** | with pipe\n',
  [`80 Runs/${logged}/TASKS.md`]: '- [x] one\n- [ ] two\n',
  [`80 Runs/${logged}/reports/D-1.txt`]: 'report\n',
  [`80 Runs/${logged}/SESSION.json`]: '{"retention":"working"}\n',
  [`80 Runs/${edge30}/SESSION.json`]: '{"retention":"bogus"}\n',
  [`80 Runs/${edge30}/TASKS.md`]: '- [x] a\n- [ ] b\n  - [X] nested\nStatus text mid-line, Status: not at line start\n',
  '80 Runs/.hidden/RUN_LOG.md': 'Status: tool state\n',
  '80 Runs/notes.txt': 'a plain file is not a run\n',
});
for (const name of [edge31, edge180, edge181]) emptyRun(runsVault, name);
const rendered = renderNow(runsVault);
const runsIndex = runsIndexOf(runsVault);
expect(rendered.status === 0 && sees(rendered, /80 Runs\/INDEX\.md/), `--render must write the runs index when 80 Runs exists, got ${rendered.status}:\n${rendered.out}`);
expect(runsIndex.includes('generated: true') && runsIndex.includes('<!-- Generated by check-vault-standard.mjs --render. Do not edit. -->')
  && runsIndex.includes(`counted to ${NOW} (UTC)`), `the runs index must carry the generated marker and the --now date, got:\n${runsIndex}`);
// The Retention column shows the class SESSION.json records, and `-` for a missing or unknown class.
// A Verdict line wins over the TASKS.md count, the last such line in a file wins, `|` is escaped, and each link exists.
expect(rowFor(runsIndex, logged) === `| ${logged} | active | 0 | working | **merged** \\| with pipe | [RUN_LOG](${logged.replace(/ /g, '%20')}/RUN_LOG.md) [TASKS](${logged.replace(/ /g, '%20')}/TASKS.md) [reports/](${logged.replace(/ /g, '%20')}/reports) |`,
  `a run with a log, tasks, and reports must show its verdict and three links, got:\n${rowFor(runsIndex, logged)}`);
// With no Verdict or Status line at line start, the checkbox count stands (nested boxes count) and only TASKS links.
expect(rowFor(runsIndex, edge30) === `| ${edge30} | active | 30 | - | 2/3 tasks done | [TASKS](${edge30.replace(/ /g, '%20')}/TASKS.md) |`,
  `age 30 must be active with a checkbox count and one link, got:\n${rowFor(runsIndex, edge30)}`);
// A run with no artifact shows `-` for status and links, and the tier follows the age on both sides of each edge.
for (const [name, age, tier] of [[edge31, 31, 'distill-ready'], [edge180, 180, 'distill-ready'], [edge181, 181, 'archive']])
  expect(rowFor(runsIndex, name) === `| ${name} | ${tier} | ${age} | - | - | - |`, `age ${age} must be ${tier} with no status or links, got:\n${rowFor(runsIndex, name)}`);
expect(!/\.hidden|notes\.txt|tool state/.test(runsIndex), `a dot folder and a plain file must stay out of the runs index, got:\n${runsIndex}`);
const orderOf = [logged, edge30, edge31, edge180, edge181].map((name) => runsIndex.indexOf(`| ${name} |`));
expect(orderOf.every((at, i) => at > 0 && (i === 0 || at > orderOf[i - 1])), `runs must list newest first, got positions ${orderOf}`);
// Deterministic: the same input and day give the same bytes, even over an earlier index in the folder.
renderNow(runsVault);
expect(runsIndexOf(runsVault) === runsIndex, 'rendering twice with the same --now must give identical bytes');
// Undated names, including an impossible date, age from the folder mtime.
const undated = v3Vault({ '80 Runs/legacy (old)/RUN_LOG.md': 'Status: kept\n', '80 Runs/2026-02-30 bad date/RUN_LOG.md': 'plain\n' });
for (const name of ['legacy (old)', '2026-02-30 bad date']) {
  const day = Math.floor(statSync(join(undated, '80 Runs', name)).mtimeMs / 86_400_000);
  renderNow(undated, new Date((day + 40) * 86_400_000).toISOString().slice(0, 10));
  expect(rowFor(runsIndexOf(undated), name).startsWith(`| ${name} | distill-ready | 40 |`),
    `${name} has no valid date prefix and must age from its mtime, got:\n${rowFor(runsIndexOf(undated), name)}`);
}
expect(rowFor(runsIndexOf(undated), 'legacy (old)').includes('(legacy%20%28old%29/RUN_LOG.md)'), 'a link must percent-encode spaces and parentheses');
// An empty 80 Runs lists nothing, and an absent one writes nothing.
const emptyRuns = v3Vault();
emptyRun(emptyRuns, '.keep');
renderNow(emptyRuns);
expect(runsIndexOf(emptyRuns).includes('No run folders.'), `an 80 Runs with no run folder must say so, got:\n${runsIndexOf(emptyRuns)}`);
const noRuns = v3Vault();
const noRunsRender = renderNow(noRuns);
expect(noRunsRender.status === 0 && !readdirNames(noRuns).includes('80 Runs') && !/80 Runs/.test(noRunsRender.out),
  `--render with no 80 Runs must write no runs index and create no folder, got ${noRunsRender.status}:\n${noRunsRender.out}`);
// Check mode accepts the generated page and skips its staleness (ages move daily). The exemption
// covers that page only: a page without the marker is an ordinary note. RUN_LOG.md is the one
// run artifact the note rules already exempt, so the vault carries no other note in 80 Runs.
const handIndex = v3Vault({ '80 Runs/2026-10-07 x/RUN_LOG.md': 'x\n' });
const handFirst = renderNow(handIndex);
expect(handFirst.status === 0 && run(handIndex).status === 0, `a rendered runs index must pass check mode, got:\n${run(handIndex).out}`);
renderNow(handIndex, '2027-01-01');
expect(runsIndexOf(handIndex).includes('counted to 2027-01-01') && run(handIndex).status === 0, 'an index rendered for another day must not read as stale');
writeFileSync(join(handIndex, '80 Runs', 'INDEX.md'), '# Written by hand\n');
const handIndexRun = run(handIndex);
expect(handIndexRun.status === 1 && sees(handIndexRun, /80 Runs\/INDEX\.md: no YAML frontmatter block/),
  `a hand-written 80 Runs/INDEX.md must not hide behind the generated exemption, got ${handIndexRun.status}:\n${handIndexRun.out}`);
// A vault that is not manifest v3 gets no index, and `--now` belongs to --render alone.
const v2Runs = recordManifest(5, 2, {}, { '80 Runs/2026-10-07 x/RUN_LOG.md': 'x\n' });
const v2RunsRender = renderNow(v2Runs);
expect(v2RunsRender.status === 0 && sees(v2RunsRender, /render skipped/) && runsIndexOf(v2Runs) === '', 'a v2 vault must get no runs index');
for (const [label, flags] of [['--now without --render', ['--now', NOW]], ['an impossible date', ['--render', '--now', '2026-02-30']],
  ['a malformed date', ['--render', '--now', 'today']], ['no value', ['--render', '--now']], ['a repeated flag', ['--render', '--now', NOW, '--now', NOW]]])
  expect(run(v3Vault(), ...flags).status === 2, `${label} must be a usage error`);

// ---- rule 16: the decision register (opt in by writing `20 Decisions/REGISTER.md`) -----------------
// One passing register covers the five id families, and every failing case changes one row or one
// note. A vault with no register is silent, so rule 16 never fails a vault that did not opt in.
const REG_HEAD = '---\ntype: decision-register\nstatus: current\nupdated: 2026-10-07\n---\n\n# Decision register\n\n| ID | Date | Decision | Status | Source |\n| --- | --- | --- | --- | --- |\n';
const LEDGER = '`80 Runs/programs/demo/PROGRAM.md`';
const regRow = (id, { date = '2026-09-01', status = 'in-force', source = LEDGER } = {}) => `| ${id} | ${date} | A decision. | ${status} | ${source} |`;
const GOOD_ROWS = [
  regRow('D-001', { source: '[[D-001 adopt]]' }),
  regRow('ADR-0001', { source: '[[0001-first]]' }),
  regRow('DEC-1', { source: `\`80 Runs/2026-09-01-demo/\`, ${LEDGER}` }),
  regRow('EVO-1'),
  regRow('RBS-1'),
];
const registerVault = (rows, files = {}) => scaffold({
  '20 Decisions/REGISTER.md': `${REG_HEAD}${rows.join('\n')}\n`,
  '20 Decisions/D-001 adopt.md': note('current', today, { type: 'decision' }),
  '20 Decisions/ADRs/0001-first.md': note('current', today, { type: 'decision' }),
  ...files,
});
const withRow = (id, row) => GOOD_ROWS.map((r) => (r.startsWith(`| ${id} `) ? row : r));
const registerFails = (label, vault, re) => {
  const r = run(vault);
  expect(r.status === 1 && re.test(r.out), `${label}, got ${r.status}:\n${r.out}`);
};

const regOk = run(registerVault(GOOD_ROWS, { '10 Design/A note.md': note('draft', today, { body: 'The ruling is DEC-1.\n' }) }));
expect(regOk.status === 0 && !/REGISTER/.test(regOk.out), `a register with all five id families must pass, got ${regOk.status}:\n${regOk.out}`);
const regAbsent = run(scaffold({
  '20 Decisions/D-001 adopt.md': note('current', today, { type: 'decision' }),
  '10 Design/A note.md': note('draft', today, { body: 'The ruling is DEC-9.\n' }),
}));
expect(regAbsent.status === 0, `a vault with no REGISTER.md must pass, got ${regAbsent.status}:\n${regAbsent.out}`);

registerFails('a duplicate id must fail', registerVault([...GOOD_ROWS, GOOD_ROWS[2]]), /row DEC-1: the id appears twice/);
registerFails('a DEC cited with no row must fail',
  registerVault(GOOD_ROWS, { '10 Design/A note.md': note('draft', today, { body: 'The ruling is DEC-99.\n' }) }),
  /A note\.md: cites DEC-99, which has no row/);
registerFails('a decision note with no row must fail',
  registerVault(GOOD_ROWS, { '20 Decisions/D-002 second.md': note('current', today, { type: 'decision' }) }),
  /D-002 second\.md: decision D-002 has no row/);
registerFails('an ADR with no row must fail',
  registerVault(GOOD_ROWS, { '20 Decisions/ADRs/0002-second.md': note('current', today, { type: 'decision' }) }),
  /0002-second\.md: decision ADR-0002 has no row/);
registerFails('a wiki link to no note must fail', registerVault(withRow('D-001', regRow('D-001', { source: '[[No such note]]' }))),
  /row D-001: link target 'No such note' does not resolve/);
registerFails('a Markdown link to no file must fail', registerVault(withRow('D-001', regRow('D-001', { source: '[note](missing.md)' }))),
  /row D-001: link target 'missing\.md' does not resolve/);
registerFails('a Markdown link into 80 Runs must fail',
  registerVault(withRow('EVO-1', regRow('EVO-1', { source: `[log](../80%20Runs/2026-09-01-demo/RUN_LOG.md), ${LEDGER}` }))),
  /row EVO-1: a link into 80 Runs\/ resolves on one machine only/);
registerFails('a wiki link into 80 Runs must fail',
  registerVault(withRow('EVO-1', regRow('EVO-1', { source: `[[80 Runs/2026-09-01-demo/RUN_LOG]], ${LEDGER}` }))),
  /row EVO-1: a link into 80 Runs\/ resolves on one machine only/);
registerFails('a DEC row with no program ledger must fail',
  registerVault(withRow('DEC-1', regRow('DEC-1', { source: '`80 Runs/2026-09-01-demo/`' }))),
  /row DEC-1: a DEC, EVO, or RBS row must cite its program ledger/);
registerFails('an EVO row with no program ledger must fail',
  registerVault(withRow('EVO-1', regRow('EVO-1', { source: '[[D-001 adopt]]' }))),
  /row EVO-1: a DEC, EVO, or RBS row must cite its program ledger/);
registerFails('a source cell that cites nothing must fail', registerVault(withRow('D-001', regRow('D-001', { source: 'memory' }))),
  /row D-001: the Source cell cites no run folder/);
registerFails('a malformed run path must fail',
  registerVault(withRow('DEC-1', regRow('DEC-1', { source: `\`80 Runs/../elsewhere/\`, ${LEDGER}` }))),
  /row DEC-1: source path `80 Runs\/\.\.\/elsewhere\/` is malformed/);
registerFails('a status outside the closed set must fail', registerVault(withRow('DEC-1', regRow('DEC-1', { status: 'maybe', source: LEDGER }))),
  /row DEC-1: status 'maybe' is not one of/);
registerFails('a malformed date must fail', registerVault(withRow('DEC-1', regRow('DEC-1', { date: '2026/09/01' }))),
  /row DEC-1: date '2026\/09\/01' is not a YYYY-MM-DD date/);
registerFails('an id outside the five families must fail', registerVault([...GOOD_ROWS, regRow('DEX-4')]),
  /row DEX-4: the id must look like/);
registerFails('a row with the wrong cell count must fail', registerVault([...GOOD_ROWS, '| DEC-2 | 2026-09-01 | Short row. |']),
  /row DEC-2 has 3 cells, not the 5/);

if (fails.length) {
  console.error('FAIL — vault-standard eval:');
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('PASS — vault-standard eval: the conformant fixture exits 0 with only the expected `80 Runs` warning and every exemption intact; the violating fixture reports all ten rules; the two earlier fail-open reproductions (a borrowed profile status, a non-root bare-stem README) still fail closed; and the synthesized cases pin the nine canonical run artifacts as exempt, a below-floor `standard-version` as a failure, and quoted YAML scalars as valid; and the manifest-v3 draft rules (statuses, superseded-by, promotion markers, generated INDEX and TRIAGE, sources digests) hold under v3 and stay dormant under v2; and the decision register (rule 16) passes with all five id families, stays silent when absent, and fails a duplicate id, an uncovered DEC citation, a decision note or ADR with no row, an unresolved link, a link into `80 Runs/`, a ledger-less DEC, EVO, or RBS row, a malformed run path, a bad status, a bad date, an unknown id family, and a short row.');
