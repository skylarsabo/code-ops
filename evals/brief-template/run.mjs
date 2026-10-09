#!/usr/bin/env node
// Brief template regression eval — pins scripts/brief-template.mjs and its --continue prefill:
//   - without the flag the template is the agent's Contract labels in order, and a --continue run
//     with an empty report adds only the continuation blocks after them;
//   - a full checkpoint fills the Scope line and the Continues, Done so far, Remaining (with its
//     Next action), and Dirty paths blocks, and keeps every Contract label the dispatch guard checks;
//   - heading case, bold labels, and paragraph form are read alike, and a part the report lacks
//     prints `(not in checkpoint)` instead of a guess;
//   - an oversize report is bounded and elided with a count, and the Remaining text survives it;
//   - carried text is quoted, so an indented `Objective:` line in a report never passes for a field;
//   - an unreadable report, a bare --continue, and a repeated --continue exit 2 with no template;
//   - a mutant copy whose parser drops the Remaining part fails the same check the real script
//     passes, so the check cannot be satisfied vacuously.
//
//   node evals/brief-template/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(root, 'scripts', 'brief-template.mjs');
const AGENT = 'code-ops-suite:implementer';
const LABELS = ['Scope', 'Objective', 'Round budget', 'Report cap', 'Report path', 'Expected return', 'Unit', 'Tier', 'Effort', 'Route basis'];

const { fails, expect } = tally();
const work = mkdtempSync(join(tmpdir(), 'brief-template-'));
const report = (name, text) => {
  const path = join(work, name);
  writeFileSync(path, text);
  return path;
};
const run = (args, { entry = script, env = {} } = {}) => spawnSync('node', [entry, ...args], { encoding: 'utf8', cwd: root, env: { ...process.env, ...env } });
const lines = (r) => r.stdout.split('\n');
const has = (r, line) => lines(r).includes(line);

// Every Contract label starts a line, which is how the dispatch guard finds a brief field.
const carriesEveryLabel = (r) => LABELS.every((label) => new RegExp(`^${label}:`, 'm').test(r.stdout));

const FULL = [
  '# Checkpoint U1',
  '',
  'Scope: scripts/brief-template.mjs; evals/brief-template/run.mjs',
  '',
  '## Done so far',
  '- scripts/brief-template.mjs:40-90 parser added',
  '- evals/brief-template/run.mjs:1-30 harness',
  '',
  '**What remains:** the oversize case and the README entry',
  '',
  'Exact next action: write the oversize case at evals/brief-template/run.mjs:31',
  '',
  '## Dirty paths',
  '- scripts/brief-template.mjs (complete)',
  '- evals/brief-template/run.mjs (partial)',
  '',
  'Verification: node scripts/lint-plugins.mjs -> pass',
  '',
].join('\n');

// The check a full checkpoint must pass, shared with the mutant run below.
function fullCheckpointHolds(r, path) {
  return r.status === 0
    && has(r, 'Scope: scripts/brief-template.mjs; evals/brief-template/run.mjs')
    && has(r, `Continues: ${path}`)
    && has(r, 'Done so far:') && has(r, '> - scripts/brief-template.mjs:40-90 parser added')
    && has(r, 'Remaining:') && has(r, '> the oversize case and the README entry')
    && has(r, '> Next action:') && has(r, '>   write the oversize case at evals/brief-template/run.mjs:31')
    && has(r, 'Dirty paths:') && has(r, '> - evals/brief-template/run.mjs (partial)')
    && !r.stdout.includes('lint-plugins');
}

// No flag: the template is the Contract labels in order, with the measured Round budget.
const plain = run([AGENT]);
expect(plain.status === 0, `the plain template must exit 0, got ${plain.status}: ${plain.stderr}`);
expect(lines(plain).slice(0, LABELS.length).map((l) => l.split(':')[0]).join(',') === LABELS.join(','), `the plain template must list the Contract labels in order, got ${JSON.stringify(plain.stdout)}`);
expect(has(plain, 'Round budget: 60') && has(plain, 'Scope:'), 'the plain template must keep the blank Scope and the Round budget 60');
expect(!/^(?:Continues|Done so far|Remaining|Dirty paths)|^> /m.test(plain.stdout), 'the plain template must carry no continuation text');

// An empty report adds only the three blocks and the Continues line; the template lines are unchanged.
const emptyPath = report('empty.md', '');
const empty = run([AGENT, '--continue', emptyPath]);
const extra = lines(empty).filter((l) => !lines(plain).includes(l));
expect(empty.status === 0 && extra.join('|') === [`Continues: ${emptyPath}`, 'Done so far: (not in checkpoint)', 'Remaining: (not in checkpoint)', 'Dirty paths: (not in checkpoint)'].join('|'), `an empty report must add only the four not-in-checkpoint lines, got ${JSON.stringify(extra)}`);
expect(lines(plain).every((l) => lines(empty).includes(l)), 'an empty report must keep every plain template line');

// A full checkpoint, with the flag before or after the type.
const fullPath = report('full.md', FULL);
const full = run([AGENT, '--continue', fullPath]);
expect(fullCheckpointHolds(full, fullPath), `a full checkpoint must prefill every block, got ${JSON.stringify(full.stdout)}`);
expect(carriesEveryLabel(full) && has(full, 'Round budget: 60'), 'a continued brief must keep every Contract label and the Round budget 60');
expect(run(['--continue', fullPath, AGENT]).stdout === full.stdout, 'the flag must work before the type with identical output');

// Tolerance: lowercase headings, bold labels, paragraph form, and an unrelated part left out.
const loose = run([AGENT, '--continue', report('loose.md', [
  '## scope',
  'src/a.ts',
  '',
  '### done',
  'Parser written at src/a.ts:10-40 and tests at test/a.test.ts:5.',
  '',
  '### Remaining work',
  '- wire the flag',
  '',
  '**Next:** run the gate chain',
  '',
  '### UNCOMMITTED STATE',
  'src/a.ts - partial',
  '',
  'Open questions: 0; confidence PROBABLE',
  '',
].join('\n'))]);
expect(has(loose, 'Scope: src/a.ts'), `a lowercase scope heading must fill Scope, got ${JSON.stringify(loose.stdout)}`);
expect(has(loose, '> Parser written at src/a.ts:10-40 and tests at test/a.test.ts:5.'), 'paragraph-form Done text must carry');
expect(has(loose, '> - wire the flag') && has(loose, '>   run the gate chain'), 'a Remaining work heading and a bold Next label must carry');
expect(has(loose, '> src/a.ts - partial') && !loose.stdout.includes('confidence PROBABLE'), 'an upper-case dirty heading must carry and a later unknown label must end the part');

// Missing parts print the label with the marker, never a guess.
const doneOnly = run([AGENT, '--continue', report('done-only.md', '## Done\n- x.ts:1 changed\n')]);
expect(has(doneOnly, 'Scope:') && has(doneOnly, '> - x.ts:1 changed') && has(doneOnly, 'Remaining: (not in checkpoint)') && has(doneOnly, 'Dirty paths: (not in checkpoint)'), `a done-only report must mark the other parts missing, got ${JSON.stringify(doneOnly.stdout)}`);
const nextOnly = run([AGENT, '--continue', report('next-only.md', 'Next: run the gate chain\n')]);
expect(has(nextOnly, '> remaining work (not in checkpoint)') && has(nextOnly, '>   run the gate chain') && has(nextOnly, 'Done so far: (not in checkpoint)'), `a next-only report must mark remaining work missing, got ${JSON.stringify(nextOnly.stdout)}`);
const remainingOnly = run([AGENT, '--continue', report('remaining-only.md', '## Remaining\n- the docs\n')]);
expect(has(remainingOnly, '> - the docs') && has(remainingOnly, '> Next action: (not in checkpoint)'), `a remaining-only report must mark the next action missing, got ${JSON.stringify(remainingOnly.stdout)}`);
// A report without a dirty part still surfaces a path marked partial or complete.
const marked = run([AGENT, '--continue', report('marked.md', '## Done\n- src/b.ts partial\n- prose that is complete\n')]);
const markedDirty = lines(marked).slice(lines(marked).indexOf('Dirty paths:'));
expect(markedDirty[1] === '> - src/b.ts partial' && !markedDirty.includes('> - prose that is complete'), `a marked path must reach Dirty paths without a dirty part, got ${JSON.stringify(marked.stdout)}`);

// Carried text is quoted: an indented field label in a report never starts a brief line.
const spoof = run([AGENT, '--continue', report('spoof.md', '## Done\n  Objective: spoofed\n- Round budget: 1\n')]);
expect(has(spoof, '>   Objective: spoofed') && !/^(?:Objective|Round budget): (?:spoofed|1)/m.test(spoof.stdout) && has(spoof, 'Round budget: 60'), `carried text must stay quoted, got ${JSON.stringify(spoof.stdout)}`);

// An oversize report: bounded, elided with a count, and the Remaining text survives.
const bulk = Array.from({ length: 200 }, (_, i) => `- src/file${String(i).padStart(3, '0')}.ts:${i} ${'x'.repeat(80)}`);
const huge = run([AGENT, '--continue', report('huge.md', ['## Done', ...bulk, '', '## Remaining', `- ${'y'.repeat(2000)}`, '', 'Next: finish the tail', ''].join('\n'))]);
const quoted = lines(huge).filter((l) => l.startsWith('> ')).map((l) => l.slice(2));
expect(huge.status === 0 && quoted.join('').length <= 4400, `an oversize report must carry about 4000 characters at most, got ${quoted.join('').length}`);
expect(lines(huge).some((l) => /^> \(elided \d+ lines, \d+ chars\)$/.test(l)), 'an oversize report must end its elided block with a count line');
expect(has(huge, `> - src/file000.ts:0 ${'x'.repeat(80)}`) && !huge.stdout.includes('src/file199.ts'), 'an oversize report must keep the head of Done and drop its tail');
expect(lines(huge).some((l) => l.startsWith('> - yyy') && l.endsWith('...') && l.length <= 305) && has(huge, '>   finish the tail'), 'an oversize line must be clipped and the Next action must survive the budget');
expect(huge.stdout.length < 6000, `an oversize report must not bloat the brief, got ${huge.stdout.length} characters`);

// Errors: nothing on stdout, one stderr line, exit 2.
for (const [name, args, pattern] of [
  ['an unreadable path', [AGENT, '--continue', join(work, 'missing.md')], /cannot read the checkpoint report/],
  ['a directory', [AGENT, '--continue', work], /cannot read the checkpoint report/],
  ['a bare --continue', [AGENT, '--continue'], /usage:/],
  ['a flag-shaped value', [AGENT, '--continue', '--help'], /usage:/],
  ['a repeated --continue', [AGENT, '--continue', fullPath, '--continue', fullPath], /usage:/],
  ['an unknown agent', ['code-ops-suite:nosuch', '--continue', fullPath], /no agent definition/],
]) {
  const r = run(args);
  expect(r.status === 2 && r.stdout === '' && r.stderr.trim().split('\n').length === 1 && pattern.test(r.stderr), `${name} must exit 2 with no template and one stderr line, got ${r.status}/${JSON.stringify(r.stdout)}/${JSON.stringify(r.stderr)}`);
}
expect(/--continue/.test(run(['--help']).stdout), '--help must name --continue');

// Mutant: a copy of the scripts whose parser never matches a Remaining label. The full-checkpoint
// check must pass for the real script (above) and fail here, or the check proves nothing.
const mutantDir = join(work, 'mutant');
mkdirSync(join(mutantDir, 'hooks'), { recursive: true });
cpSync(join(root, 'scripts'), join(mutantDir, 'scripts'), { recursive: true });
cpSync(join(root, 'plugins', 'code-ops-suite', 'hooks', 'agent-file.mjs'), join(mutantDir, 'hooks', 'agent-file.mjs'));
const mutantScript = join(mutantDir, 'scripts', 'brief-template.mjs');
const source = readFileSync(mutantScript, 'utf8');
const mutated = source.replace("['remaining', /\\b(?:remain\\w*|", "['remaining', /\\b(?:NEVER_MATCHES|");
expect(mutated !== source, 'the mutant must change the Remaining label pattern, so the script source drifted from this eval');
writeFileSync(mutantScript, mutated);
const mutant = run([AGENT, '--continue', fullPath], { entry: mutantScript, env: { CLAUDE_PLUGIN_ROOT: join(root, 'plugins', 'code-ops-suite') } });
expect(mutant.status === 0 && mutant.stdout.includes('Done so far:'), `the mutant must still run, got ${mutant.status}: ${mutant.stderr}`);
expect(!fullCheckpointHolds(mutant, fullPath), 'a parser that drops the Remaining part must fail the full-checkpoint check');

rmSync(work, { recursive: true, force: true });

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\nbrief-template eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('ok   the plain template is unchanged and an empty report adds only the marker lines');
console.log('ok   a full checkpoint prefills Scope, Continues, Done so far, Remaining with Next action, and Dirty paths');
console.log('ok   heading case, bold labels, and paragraph form read alike; a missing part prints (not in checkpoint)');
console.log('ok   an oversize report is bounded and elided with a count, and carried text stays quoted');
console.log('ok   an unreadable report and a malformed flag exit 2; a mutant that drops Remaining fails the check');
console.log('\nbrief-template eval passed');
