#!/usr/bin/env node
// Skill write-class regression eval: the classifier rules in scripts/skill-write-class.mjs and a
// `--check` run on the real plugin tree.
//
//   node evals/skill-write-class/run.mjs   (exit 0 = pass)
//
// The rule cases are pure strings. The tree cases run the real CLI, so a SKILL.md whose
// `disallowed-tools` key drifts from its class fails here and in CI.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLASS_LINES, OVERRIDES, classify, declaredTools, expectedTools, listSkills, mismatch,
} from '../../scripts/skill-write-class.mjs';
import { tally } from '../harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { fails, check } = tally();
const cls = (text, slug = 'fixture') => classify(slug, text).cls;

// ---- 1. the rules ------------------------------------------------------------------------
check('no read-only declaration is source', cls('Use to fix the bug. Edits files.') === 'source');
check('an empty body is source', cls('') === 'source');
check('read-only with no write target is none', cls('AUDIT, read-only. Run the script and report in chat.') === 'none');
check('read-only with a named report file is artifact', cls('Review only. Produces REVIEW.md.') === 'artifact');
check('read-only with a run folder is artifact', cls('Read-only. Files go to the run folder.') === 'artifact');
check('read-only with a register is artifact', cls('Writes no code. Ranks a register.') === 'artifact');
check('a fixed reference file is not a write target', cls('Read-only. See CONVENTIONS.md and AGENTS.md.') === 'none');
check('read-only plus an implementer dispatch is source', cls('Review only. Dispatch the implementer to apply it. REVIEW.md.') === 'source');
check('read-only plus safe fixes is source', cls('Read-only audit that applies only safe fixes.') === 'source');
check('read-only plus a doc reconcile is source', cls('Writes no code. Reconciles the docs into one source of truth.') === 'source');
check('handing off to an implementer stays artifact', cls('Writes no code. It hands off to an implementer. Writes BRIEF.md.') === 'artifact');
check('the text wraps across lines', cls('Review\nonly. Produces\nREVIEW.md.') === 'artifact');

// ---- 2. overrides win over every rule ----------------------------------------------------
OVERRIDES['fixture-override'] = { cls: 'none', why: 'fixture' };
check('an override beats a source signal', cls('Edits files. No read-only text.', 'fixture-override') === 'none');
check('an override reports its reason', classify('fixture-override', '').why.startsWith('override:'));
delete OVERRIDES['fixture-override'];
check('removing the override restores the rules', cls('Edits files.', 'fixture-override') === 'source');
check('every shipped override names a class and a reason', Object.values(OVERRIDES)
  .every((o) => Object.hasOwn(CLASS_LINES, o.cls) && typeof o.why === 'string' && o.why.trim().length > 0));

// ---- 3. the declared key -----------------------------------------------------------------
const skill = (fmLine) => `---\ndescription: "x"\n${fmLine}\n---\n\nbody\n`;
check('declaredTools reads the key', declaredTools(skill('disallowed-tools: Edit, NotebookEdit')).join() === 'Edit,NotebookEdit');
check('declaredTools is null without the key', declaredTools('---\ndescription: "x"\n---\n') === null);
check('declaredTools ignores a body line', declaredTools('---\ndescription: "x"\n---\n\ndisallowed-tools: Edit\n') === null);
check('source expects no key', expectedTools('source') === null && !mismatch('source', null));
check('source with a key mismatches', mismatch('source', ['Edit']));
check('artifact expects Edit and NotebookEdit', !mismatch('artifact', ['NotebookEdit', 'Edit']));
check('artifact missing the key mismatches', mismatch('artifact', null));
check('artifact declaring Write too mismatches', mismatch('artifact', ['Edit', 'NotebookEdit', 'Write']));
check('none expects Edit, Write, and NotebookEdit', !mismatch('none', ['Write', 'Edit', 'NotebookEdit']));
check('none with a short list mismatches', mismatch('none', ['Edit', 'NotebookEdit']));

// ---- 4. the real tree --------------------------------------------------------------------
check('the tree lists skills in every plugin', new Set(listSkills(ROOT).map((s) => s.plugin)).size >= 4);
const run = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'skill-write-class.mjs'), '--check'], { encoding: 'utf8' });
check('--check passes on the real tree', run.status === 0, `${run.stderr}${run.stdout}`.trim().slice(0, 300));
const usage = spawnSync(process.execPath, [resolve(ROOT, 'scripts', 'skill-write-class.mjs'), '--nope'], { encoding: 'utf8' });
check('an unknown flag exits 2', usage.status === 2);

if (fails.length) { console.error(`\nskill-write-class eval: ${fails.length} failure(s)`); process.exit(1); }
console.log('\nskill-write-class eval: PASS');
