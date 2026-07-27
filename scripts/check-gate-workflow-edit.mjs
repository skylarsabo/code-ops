#!/usr/bin/env node
// Gate-workflow-edit advisory.
//
//   node scripts/check-gate-workflow-edit.mjs [--base <ref>]
//
// WHY: CLAUDE.md notes a PR-gate workflow only takes effect once merged to main — a PR
// that edits deep-review.yml or opsec-gate.yml is not reviewed by its own edit. This
// script flags that condition loudly so a contributor knows to verify the change on a
// follow-up PR that does not touch the workflows. It is advisory only: it never fails
// the run, because the underlying risk (an unreviewed gate edit) is a human-process
// concern, not a mechanical defect to gate on.
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
  console.log('This PR is NOT reviewed by its own edited gate — PR-gate workflows only take');
  console.log('effect once merged to main. Verify this change on a follow-up PR that does not');
  console.log('touch the workflow files.');
} else {
  console.log('OK — no gate workflow (deep-review.yml, opsec-gate.yml) touched in this diff.');
}
process.exit(0);
