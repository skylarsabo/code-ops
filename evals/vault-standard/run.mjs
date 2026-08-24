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
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checker = resolve(here, '..', '..', 'scripts', 'check-vault-standard.mjs');

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };
const run = (dir) => {
  const r = spawnSync('node', [checker, dir], { encoding: 'utf8' });
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

if (fails.length) {
  console.error('FAIL — vault-standard eval:');
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('PASS — vault-standard eval: the conformant fixture exits 0 with only the expected `80 Runs` warning and every exemption intact; the violating fixture reports all ten rules; the two earlier fail-open reproductions (a borrowed profile status, a non-root bare-stem README) still fail closed; and the synthesized cases pin the nine canonical run artifacts as exempt, a below-floor `standard-version` as a failure, and quoted YAML scalars as valid.');
