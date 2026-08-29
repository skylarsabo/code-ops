#!/usr/bin/env node
// Gate-workflow-edit advisory.
//
//   node scripts/check-gate-workflow-edit.mjs [--base <ref>]
//
// WHY: a same-repository pull_request uses the merge ref and can execute edits to these
// gates. Fork requests can skip without credentials. pull_request_target and schedule
// use the default branch, while push uses the pushed ref. This advisory tells reviewers
// to confirm which event and ref ran instead of inferring coverage from a green check.
//
// FAIL-OPEN: if <base> does not resolve as a git ref (e.g. a push event with no PR base
// to diff against), this prints a skip note and exits 0. Every path in this script exits
// 0 — it never fails the run.
//
// Exit: always 0.

import { execFileSync } from 'node:child_process';

const GATE_WORKFLOWS = ['.github/workflows/deep-review.yml', '.github/workflows/opsec-gate.yml'];

const argv = process.argv.slice(2);
let base = 'origin/main';
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--base') { base = argv[++i]; }
}

let changedPaths;
try {
  const out = execFileSync('git', ['diff', '--name-only', '-z', `${base}...HEAD`, '--'], { encoding: 'utf8' });
  changedPaths = out.split('\0').filter(Boolean);
} catch (e) {
  console.log(`OK — base ref '${base}' did not resolve (${String(e.message).split('\n')[0]}) — skipping gate-workflow-edit check.`);
  process.exit(0);
}

const touched = GATE_WORKFLOWS.filter((w) => changedPaths.includes(w));
if (touched.length > 0) {
  console.log('!!! GATE WORKFLOW EDITED !!!');
  console.log(`This PR touches: ${touched.join(', ')}`);
  console.log('A same-repository pull_request uses the merge ref, so this run can exercise');
  console.log('the edited gate. Confirm that the review step executed instead of skipping.');
  console.log('Fork pull requests can lack credentials. pull_request_target and schedule use');
  console.log('the default branch; push uses the pushed ref. Prove each actual event and ref.');
} else {
  console.log('OK — no gate workflow (deep-review.yml, opsec-gate.yml) touched in this diff.');
}
process.exit(0);
