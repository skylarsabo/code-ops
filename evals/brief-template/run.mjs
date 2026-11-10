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
//   - --anchors appends a quoted Anchors block of current skim outlines, keeps a :line target, caps
//     the block, marks a missing path (not found), and combines with --continue;
//   - an unreadable report, a bare --continue, and a repeated --continue exit 2 with no template;
//   - --check runs the guard's brief rules (reviewBrief) before a dispatch: a complete routed brief
//     is ok; a wrong surface=, a missing or valueless field, premium with no trigger, an execution
//     brief with no Anchors, and --model sonnet on a strong-floor agent are denied with the guard's
//     text; stdin, --json, the unchecked line, and exit codes 0, 1, and 2 hold; a plugin copy
//     without hooks/brief-rules.mjs exits 2 and still prints the template; and the real hook and
//     --check print identical denial and advisory texts for one brief (the parity case);
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
const run = (args, { entry = script, env = {}, input } = {}) => spawnSync('node', [entry, ...args], { encoding: 'utf8', cwd: root, env: { ...process.env, ...env }, input });
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

// --anchors: a quoted outline per path from the file as it is now, the lead's :line target kept,
// an unreadable path marked, the rest of the brief unchanged.
const doc = report('anchor-doc.md', '# Alpha\n\ntext\n\n## Beta\n\nmore\n');
const anchored = run([AGENT, '--anchors', `${doc}:5`, join(work, 'gone.md')]);
const anchorAt = lines(anchored).indexOf('Anchors:');
expect(anchored.status === 0 && anchorAt >= 0 && lines(plain).every((l) => lines(anchored).includes(l)), `--anchors must keep every plain line and add an Anchors block, got ${JSON.stringify(anchored.stdout)}`);
expect(has(anchored, `> ${doc} (target :5)`) && lines(anchored).some((l) => /^>\s+1: h1 Alpha/.test(l)) && lines(anchored).some((l) => /^>\s+5: h2 Beta/.test(l)), 'an anchor must carry its target and the current outline with line numbers');
expect(has(anchored, `> ${join(work, 'gone.md')} (not found)`), 'an unreadable anchor must read (not found)');
expect(lines(anchored).slice(anchorAt + 1).filter(Boolean).every((l) => l.startsWith('> ')), 'every Anchors line must be quoted, so an outline never passes for a brief field');
expect(lines(plain).filter(Boolean).join('\n') === lines(anchored).slice(0, anchorAt).join('\n'), 'the Anchors block must follow the unchanged template');
// The outline is read at brief time, not cached: an edit shows up on the next run.
writeFileSync(doc, '# Alpha\n\n## Gamma\n');
expect(lines(run([AGENT, '--anchors', doc])).some((l) => /^>\s+3: h2 Gamma/.test(l)), 'the outline must come from the current file');
// The cap: a long outline stays near 2,500 characters and says what it dropped.
const longDoc = report('anchor-long.md', Array.from({ length: 80 }, (_, i) => `## Section ${i} ${'z'.repeat(60)}\n`).join('\n'));
const capped = run([AGENT, '--anchors', longDoc]);
const anchorText = lines(capped).slice(lines(capped).indexOf('Anchors:')).join('\n');
expect(capped.status === 0 && anchorText.length <= 2800 && /\(elided \d+ lines, \d+ chars\)/.test(anchorText), `a long outline must be capped with an elision note, got ${anchorText.length} characters`);
// With --continue the continuation blocks stay and Anchors comes last; flag order does not matter.
const both = run([AGENT, '--anchors', doc, '--continue', fullPath]);
expect(fullCheckpointHolds(both, fullPath) && lines(both).indexOf('Anchors:') > lines(both).indexOf('Dirty paths:'), `--anchors with --continue must keep the checkpoint blocks, got ${JSON.stringify(both.stdout)}`);
expect(run(['--continue', fullPath, AGENT, '--anchors', doc]).stdout === both.stdout, 'flag order must not change the brief');
for (const args of [[AGENT, '--anchors'], [AGENT, '--anchors', '--continue', fullPath]]) {
  const r = run(args);
  expect(r.status === 2 && r.stdout === '' && /usage:/.test(r.stderr), `an empty --anchors must exit 2 with usage, got ${r.status}/${JSON.stringify(r.stderr)}`);
}
// The anchor list ends at an agent type, so the type may follow it; a flag-shaped argument also ends it.
const typeLast = run(['--anchors', doc, AGENT]);
expect(typeLast.status === 0 && carriesEveryLabel(typeLast) && has(typeLast, `> ${doc}`) && lines(typeLast).filter((l) => l.startsWith('> ')).every((l) => !l.includes(AGENT)), `--anchors <path> <plugin>:<agent> must read the type as the agent, got ${typeLast.status}/${typeLast.stderr}`);
// A path that exists but cannot be outlined reports skim's reason, not (not found).
const dirAnchor = run([AGENT, '--anchors', work]);
expect(has(dirAnchor, `> ${work} (cannot read ${work}: EISDIR)`), `an unreadable existing anchor must carry skim's reason, got ${JSON.stringify(dirAnchor.stdout.slice(-200))}`);
expect(anchorText.length <= 2650, `the quote heads must count toward the anchors budget, got ${anchorText.length} characters`);

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

// --check: the guard's own brief rules, run on a brief before the dispatch.
const suite = join(root, 'plugins', 'code-ops-suite');
const hookPath = join(suite, 'hooks', 'dispatch-guard.mjs');
const BRIEF = [
  'Scope: scripts/brief-template.mjs; evals/brief-template/run.mjs',
  'Objective: add the check.',
  'Round budget: 60',
  'Report cap: 500 words',
  'Report path: r.md',
  'Expected return: files changed.',
  'Unit: U-check',
  'Tier: strong',
  'Effort: high',
  'Route basis: judgment; surface=none; ambiguity=medium; reversible=yes',
].join('\n');
const without = (label) => BRIEF.split('\n').filter((l) => !l.startsWith(`${label}:`)).join('\n');
const swap = (label, line) => BRIEF.split('\n').map((l) => (l.startsWith(`${label}:`) ? line : l)).join('\n');
const checked = (brief, flags = ['--effort', 'high'], options = {}) => run([AGENT, '--check', report('brief.md', brief), ...flags], options);
const verdict = (r) => lines(r).filter(Boolean).at(-1);
const denies = (r) => lines(r).filter((l) => l.startsWith('deny: '));

const good = checked(BRIEF);
expect(good.status === 0 && verdict(good) === 'ok' && denies(good).length === 0 && good.stdout.indexOf('\nok') > good.stdout.indexOf('not checked here:'),
  `a complete routed brief must exit 0 and end with ok, got ${good.status}/${JSON.stringify(good.stdout)}`);
const unchecked = lines(good).find((l) => l.startsWith('not checked here:')) ?? '';
expect(/frontier cap/.test(unchecked) && /trigger 7c/.test(unchecked) && /redispatch note/.test(unchecked) && /context ceiling/.test(unchecked) && /--model/.test(unchecked) && !/--effort/.test(unchecked),
  `the unchecked line must name the ledger and live-call checks and drop --effort once it is given, got ${JSON.stringify(unchecked)}`);
expect(lines(good).filter((l) => l.startsWith('not checked here:')).length === 1, 'the unchecked line must print once');
expect(!/--model|--effort/.test(lines(checked(BRIEF, ['--effort', 'high', '--model', 'opus'])).find((l) => l.startsWith('not checked here:')) ?? ''), 'giving --model and --effort must drop both from the unchecked line');

const wrongSurface = checked(swap('Scope', 'Scope: plugins/code-ops-suite/hooks/dispatch-guard.mjs and evals/dispatch-guard/.'));
expect(wrongSurface.status === 1 && /^deny: Route basis says surface=none but the Scope paths derive surface=gate-script; correct the line or the Scope\. A Route override line does not clear a surface mismatch\. Check a brief first with `.*brief code-ops-suite:implementer --check <file>`\.$/m.test(wrongSurface.stdout) && verdict(wrongSurface) === 'denied (1)',
  `a wrong surface= must be denied with the guard's text, got ${wrongSurface.status}/${JSON.stringify(wrongSurface.stdout)}`);
const missingField = checked(without('Report path'));
expect(missingField.status === 1 && /^deny: The code-ops-suite:implementer Contract requires these brief fields, missing: Report path; add each as a "Label:" line or a heading\..* prints the full template; check a brief first with `.* --check <file>`\.$/m.test(missingField.stdout),
  `a missing field must be denied with the guard's text, got ${JSON.stringify(missingField.stdout)}`);
const noValue = checked(swap('Report path', 'Report path:'));
expect(noValue.status === 1 && /^deny: .*missing: Report path; Report path has a label but no value on its line or below it;/m.test(noValue.stdout),
  `a label with no value must be denied, got ${JSON.stringify(noValue.stdout)}`);
const premium = checked(swap('Tier', 'Tier: premium'));
expect(premium.status === 1 && denies(premium).some((l) => /Tier: premium is above the routed .*premium needs a trigger/.test(l)),
  `Tier: premium with no trigger must be denied, got ${JSON.stringify(premium.stdout)}`);
const EXECUTION = 'Route basis: execution; surface=none; ambiguity=low; reversible=yes';
const noAnchors = checked(swap('Route basis', EXECUTION));
expect(noAnchors.status === 1 && denies(noAnchors).some((l) => /^deny: Anchors required: this execution brief for code-ops-suite:implementer has no Anchors block\./.test(l)),
  `an execution brief without Anchors must be denied, got ${JSON.stringify(noAnchors.stdout)}`);
expect(checked(`${swap('Route basis', EXECUTION)}\nAnchors:\n> scripts/brief-template.mjs:150-270`).status === 0, 'the same brief with Anchors must pass');
const sonnet = checked(BRIEF, ['--effort', 'high', '--model', 'sonnet']);
expect(sonnet.status === 1 && denies(sonnet).some((l) => /"sonnet" runs code-ops-suite:implementer at mid, below its strong floor/.test(l)),
  `--model sonnet on a strong-floor agent must be denied, got ${JSON.stringify(sonnet.stdout)}`);
const overHigh = checked(swap('Effort', 'Effort: xhigh'), ['--effort', 'high']);
expect(overHigh.status === 1 && denies(overHigh).some((l) => /Effort: xhigh is above high/.test(l)), 'an Effort above high must be denied');
const unsaid = checked(BRIEF, []);
expect(unsaid.status === 1 && denies(unsaid).some((l) => /Effort: high is above the medium that code-ops-suite:implementer runs at/.test(l)) && /--effort/.test(unsaid.stdout),
  `with no --effort the brief Effort is held to the frontmatter effort and the line names --effort, got ${JSON.stringify(unsaid.stdout)}`);
const noted = checked(swap('Effort', 'Effort: medium'));
expect(noted.status === 0 && lines(noted).some((l) => /^note: Effort: medium is below the high that the Agent call passes\./.test(l)) && verdict(noted) === 'ok',
  `an advisory must print as note: and leave the exit at 0, got ${JSON.stringify(noted.stdout)}`);

// stdin, an unreadable brief, and --json.
const piped = run([AGENT, '--check', '-', '--effort', 'high'], { input: BRIEF });
expect(piped.status === 0 && piped.stdout === good.stdout, `--check - must read the brief from stdin, got ${piped.status}/${JSON.stringify(piped.stdout)}`);
const pipedDenied = run([AGENT, '--check', '-', '--effort', 'high'], { input: without('Unit') });
expect(pipedDenied.status === 1 && /missing: Unit;/.test(pipedDenied.stdout), 'a denied brief on stdin must exit 1');
const asJson = JSON.parse(checked(without('Report path'), ['--effort', 'high', '--json']).stdout);
expect(Object.keys(asJson).join() === 'denials,advisories,unchecked' && asJson.denials.length === 1 && Array.isArray(asJson.advisories) && asJson.unchecked.some((u) => /frontier cap/.test(u)),
  `--json must print denials, advisories, and unchecked, got ${JSON.stringify(asJson)}`);
const jsonGood = checked(BRIEF, ['--effort', 'high', '--json']);
expect(jsonGood.status === 0 && JSON.parse(jsonGood.stdout).denials.length === 0 && checked(without('Report path'), ['--effort', 'high', '--json']).status === 1, '--json must keep the exit codes');

// Parity: the real hook and --check read one brief with one rule path, so every prompt-level denial and
// advisory text is identical, in order. The hook runs against an empty ledger in a fake home.
const parityHome = mkdtempSync(join(tmpdir(), 'brief-check-home-'));
const hookReason = (brief) => {
  const env = { ...process.env, HOME: parityHome, USERPROFILE: parityHome, CLAUDE_PLUGIN_ROOT: suite, CODE_OPS_RECEIPTS: 'off' };
  for (const name of ['CODE_OPS_DISPATCH_GUARD', 'CODE_OPS_CONTEXT_CEILING', 'GROK_PLUGIN_ROOT', 'CODE_OPS_ROUND_BUDGET']) delete env[name];
  const input = JSON.stringify({
    hook_event_name: 'PreToolUse', session_id: 'brief-check', cwd: parityHome, tool_name: 'Agent',
    tool_input: { prompt: brief, subagent_type: AGENT, effort: 'high' },
  });
  const out = spawnSync('node', [hookPath], { input, encoding: 'utf8', env });
  const body = out.stdout ? JSON.parse(out.stdout).hookSpecificOutput : {};
  return body.permissionDecisionReason ?? body.additionalContext ?? '';
};
const mixed = swap('Effort', 'Effort: low').split('\n').filter((l) => !l.startsWith('Report cap:')).join('\n')
  .replace('Scope: scripts/brief-template.mjs; evals/brief-template/run.mjs', 'Scope: plugins/code-ops-suite/hooks/dispatch-guard.mjs');
const mixedJson = JSON.parse(checked(mixed, ['--effort', 'high', '--json']).stdout);
const expectedProse = `Dispatch guard: ${[...mixedJson.denials, ...mixedJson.advisories].join(' ')}`;
const actualReason = hookReason(mixed);
expect(mixedJson.denials.length >= 2 && mixedJson.advisories.length >= 1 && actualReason.endsWith(expectedProse),
  `the hook and --check must print the same denial and advisory texts in the same order, got ${JSON.stringify(actualReason)} vs ${JSON.stringify(expectedProse)}`);
expect(hookReason(BRIEF) === '' && JSON.parse(jsonGood.stdout).advisories.length === 0, 'a brief --check passes clean must also pass the hook with no output');
// D-025 parity: a repeated routed field is denied with one text by both paths, and a finding-4 brief (Words: lines under an empty
// label) passes both with no output.
const repeated = BRIEF.replace('Tier: strong', '## Tier\nfrontier\n\nTier: premium');
const repeatedJson = JSON.parse(checked(repeated, ['--effort', 'high', '--json']).stdout);
expect(repeatedJson.denials.some((d) => /^The brief has Tier more than once; each of Unit, Tier, Effort, and Route basis must appear exactly once/.test(d))
  && hookReason(repeated).endsWith(`Dispatch guard: ${[...repeatedJson.denials, ...repeatedJson.advisories].join(' ')}`),
  `the hook and --check must print the same repeated-field denial, got ${JSON.stringify(repeatedJson.denials)} vs ${JSON.stringify(hookReason(repeated))}`);
const finding4 = BRIEF.replace('Objective: add the check.', 'Objective:\nReview the guard: check X.');
const finding4Json = JSON.parse(checked(finding4, ['--effort', 'high', '--json']).stdout);
expect(finding4Json.denials.length === 0 && hookReason(finding4) === '', `a value under an empty label that holds Words: text must pass both --check and the hook, got ${JSON.stringify(finding4Json.denials)} vs ${JSON.stringify(hookReason(finding4))}`);
rmSync(parityHome, { recursive: true, force: true });

// Usage errors and a missing rules module exit 2; the template still prints without the module.
for (const [name, args] of [
  ['--check with no file', [AGENT, '--check']],
  ['--check with a flag-shaped file', [AGENT, '--check', '--json']],
  ['--check with --continue', [AGENT, '--check', fullPath, '--continue', fullPath]],
  ['--check with --anchors', [AGENT, '--check', fullPath, '--anchors', doc]],
  ['--model with no --check', [AGENT, '--model', 'sonnet']],
  ['--effort with no --check', [AGENT, '--effort', 'high']],
  ['--json with no --check', [AGENT, '--json']],
  ['--model with no alias', [AGENT, '--check', fullPath, '--model']],
]) {
  const r = run(args);
  expect(r.status === 2 && r.stdout === '' && /usage:/.test(r.stderr), `${name} must exit 2 with usage, got ${r.status}/${JSON.stringify(r.stdout)}/${JSON.stringify(r.stderr)}`);
}
const unreadable = run([AGENT, '--check', join(work, 'no-brief.md')]);
expect(unreadable.status === 2 && unreadable.stdout === '' && /cannot read the brief/.test(unreadable.stderr), `an unreadable brief must exit 2, got ${unreadable.status}/${JSON.stringify(unreadable.stderr)}`);
expect(run(['code-ops-suite:nosuch', '--check', fullPath]).status === 2, '--check on an unknown agent must exit 2');
expect(/--check/.test(run(['--help']).stdout), '--help must name --check');
// A plugin copy: scripts beside hooks/agent-file.mjs. Without brief-rules.mjs --check exits 2 and the template prints;
// with it beside the copy (the code-ops-suite layout) the same brief passes.
const copyDir = join(work, 'copy');
mkdirSync(join(copyDir, 'hooks'), { recursive: true });
cpSync(join(root, 'scripts'), join(copyDir, 'scripts'), { recursive: true });
cpSync(join(suite, 'hooks', 'agent-file.mjs'), join(copyDir, 'hooks', 'agent-file.mjs'));
const copyEnv = { CLAUDE_PLUGIN_ROOT: suite };
const copyScript = join(copyDir, 'scripts', 'brief-template.mjs');
const bareCheck = run([AGENT, '--check', report('copy-brief.md', BRIEF), '--effort', 'high'], { entry: copyScript, env: copyEnv });
expect(bareCheck.status === 2 && bareCheck.stdout === '' && /needs hooks\/brief-rules\.mjs/.test(bareCheck.stderr), `--check without the rules module must exit 2 with a message, got ${bareCheck.status}/${JSON.stringify(bareCheck.stderr)}`);
expect(run([AGENT], { entry: copyScript, env: copyEnv }).stdout === plain.stdout, 'the template must still print without the rules module');
cpSync(join(suite, 'hooks', 'brief-rules.mjs'), join(copyDir, 'hooks', 'brief-rules.mjs'));
const copyCheck = run([AGENT, '--check', report('copy-brief.md', BRIEF), '--effort', 'high'], { entry: copyScript, env: copyEnv });
expect(copyCheck.status === 0 && verdict(copyCheck) === 'ok', `--check must find hooks/brief-rules.mjs beside a plugin copy, got ${copyCheck.status}/${JSON.stringify(copyCheck.stderr)}`);

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
console.log('ok   --anchors appends a quoted current outline with the lead target, caps it, marks a missing path, and combines with --continue');
console.log('ok   --check denies with the guard\'s texts, prints the unchecked line, reads stdin and --json, exits 0, 1, and 2, and matches the real hook');
console.log('ok   an unreadable report and a malformed flag exit 2; a mutant that drops Remaining fails the check');
console.log('\nbrief-template eval passed');
