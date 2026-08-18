#!/usr/bin/env node
// Vault-conformance regression eval — pins check-vault-standard.mjs against a fixture pair.
// `conformant/` must exit 0 (with the expected `80 Runs` warning) and `violating/` must exit 1
// with at least one message per rule. The violating fixture also carries the two fail-open cases
// found in review: a status borrowed from a note type named in the same profile sentence, and a
// bare-stem `README.md` sitting in a folder other than the vault root.
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
has(/machinery folder '99 Archive\/' is missing/, 'rule 2 — a missing machinery folder');
has(/'85 Bogus\/' sits in the reserved machinery band/, 'rule 3 — a domain folder in the 80-99 band');
has(/no domain folder in the 10-79 band/, 'rule 4 — no domain folder');
has(/Missing fields\.md: frontmatter has no `status`/, 'rule 5 — a note missing `status`');
has(/Missing fields\.md: updated 'yesterday' is not a YYYY-MM-DD date/, 'rule 5 — a malformed `updated`');
has(/'05 Scratch\/' is numbered below 10/, 'the 00-09 band gap — a numbered folder that is not `00 Inbox`');

// The two review reproductions, pinned so neither can regress to fail-open.
has(/Borrowed status\.md: status 'literature' is not one of/,
  "a status borrowed from a note type named in the profile sentence (only the token after 'profile status' declares one)");
has(/00 Inbox\/README\.md: no YAML frontmatter block/,
  'a bare-stem README outside the vault root (the UPPER_SNAKE exemption requires an underscore)');

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

if (fails.length) {
  console.error('FAIL — vault-standard eval:');
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('PASS — vault-standard eval: the conformant fixture exits 0 with only the expected `80 Runs` warning and every exemption intact; the violating fixture reports all five rules plus the 00-09 band gap; and the two fail-open reproductions (a borrowed profile status, a non-root bare-stem README) now fail closed.');
