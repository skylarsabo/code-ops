#!/usr/bin/env node
// Regression eval for scripts/churn.mjs, the report-only circling signal (P4-U1-Dir).
//
// A scratch git repository holds one of each signal, so every count below is a number the fixture
// was built to produce, not a number read off the tool: two re-fixes inside a chain plus a revert's
// own re-fix, one revert, one fix-of-fix chain in one PR (two fixes and a restamp after the opening
// commit), a PR that opens with a fix, a merge with no PR subject, a late edit outside the seven-day
// rule, derived-file edits that must not count, a repeated `Next:` line, and a reopened task id.
// Run folders sit in a temp dir beside the repository, as the gitignored run folders sit beside the
// real one.
//
// MUTATION CONTROL. For each detector the eval writes a copy of churn.mjs with that one detector cut,
// runs the copy on the same fixture, and requires the report to differ from the full run in exactly
// that signal. A detector that cannot be cut, or a cut that moves a second signal, fails the eval.
//
//   node evals/churn/run.mjs   (exit 0 = all assertions pass)

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deepStrictEqual } from 'node:assert';
import { tally } from '../harness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(REPO, 'scripts');
const { fails, check } = tally();
const tmp = mkdtempSync(join(tmpdir(), 'churn-'));
const repo = join(tmp, 'repo');
const runs = join(tmp, '80 Runs');
mkdirSync(repo);
writeFileSync(join(tmp, 'gitconfig'), '');

const pad = (n) => String(n).padStart(2, '0');
const at = (day, hour = 12) => `2026-03-${pad(day)}T${pad(hour)}:00:00+0000`;
const baseEnv = {
  ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(tmp, 'gitconfig'),
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
const git = (when, ...args) => {
  const env = { ...baseEnv, ...(when ? { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } : {}) };
  const r = spawnSync('git', args, { cwd: repo, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const numbered = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const put = (name, lines) => writeFileSync(join(repo, name), `${lines.join('\n')}\n`);
const line3 = (text) => { const l = numbered('a', 10); l[2] = text; put('a.txt', l); };
const commit = (when, subject) => { git(null, 'add', '-A'); git(when, 'commit', '-m', subject); };
// A PR: a branch off main, its commits, and a no-fast-forward merge with GitHub's subject.
const pr = (number, when, steps) => {
  git(null, 'checkout', '-q', '-b', `feat${number}`);
  for (const step of steps) step();
  git(null, 'checkout', '-q', 'main');
  git(when, 'merge', '--no-ff', '-m', `Merge pull request #${number} from fixture/feat${number}`, `feat${number}`);
};

function buildRepo() {
  git(null, 'init', '-q', '-b', 'main');
  git(null, 'config', 'core.autocrlf', 'false');
  // Before the window: a base every later edit builds on.
  put('a.txt', numbered('a', 10)); put('r.txt', numbered('r', 3)); put('CHANGELOG.md', ['# Log']);
  commit(`2026-02-01T12:00:00+0000`, 'Add fixture files');
  line3('three'); commit(at(2), 'Tune line three');
  line3('three again'); commit(at(3), 'Rework line three');
  const r = numbered('r', 3); r[0] = 'tuned'; put('r.txt', r); commit(at(4, 12), 'Tune r');
  git(at(4, 13), 'revert', '--no-edit', 'HEAD');
  put('CHANGELOG.md', ['# Log', 'one']); commit(at(5), 'Note changes');
  put('CHANGELOG.md', ['# Log', 'two']); commit(at(6), 'Note changes again');
  line3('three late'); commit(at(20), 'Rework line three late');
  pr(7, at(24), [
    () => { put('f7.txt', ['x1', 'x2', 'x3']); commit(at(21), 'Add feature'); },
    () => { put('f7.txt', ['y1', 'x2', 'x3']); commit(at(21, 13), 'Fix typo in feature'); },
    () => { put('f7.txt', ['z1', 'x2', 'x3']); commit(at(21, 14), 'Fix typo again'); },
    () => { put('CHANGELOG.md', ['# Log', 'three']); commit(at(21, 15), 'Restamp atlas sections'); },
  ]);
  pr(8, at(25), [() => { put('f8.txt', ['p1']); commit(at(25, 9), 'Add other feature'); }]);
  pr(9, at(26), [
    () => { put('f9.txt', ['q1']); commit(at(26, 8), 'Fix review findings in the loader'); },
    () => { put('f9.txt', ['q1', 'q2']); commit(at(26, 9), 'Extend loader'); },
  ]);
  git(null, 'checkout', '-q', '-b', 'side');
  put('side.txt', ['s1']); commit(at(27, 8), 'Add side');
  git(null, 'checkout', '-q', 'main');
  git(at(27, 9), 'merge', '--no-ff', '-m', "Merge branch 'side'", 'side');
}

function buildRuns() {
  const folder = (name, files) => {
    mkdirSync(join(runs, name), { recursive: true });
    for (const [file, lines] of Object.entries(files)) writeFileSync(join(runs, name, file), `${lines.join('\n')}\n`);
  };
  folder('2026-03-01-prog-ho1', {
    'RUN_LOG.md': ['# Run log', 'Next: run the gate 3 times', '- Next: ship the thing', 'plain line', 'Next:   Run the Gate 7 times'],
    'TASKS.md': ['- [x] T-1 done thing', '- [ ] T-2 open thing', '- [ ] T-3 other thing'],
  });
  folder('2026-03-02-prog-ho2', {
    'RUN_LOG.md': ['Next: run the gate 5 times', 'Next: a different thing'],
    'TASKS.md': ['- [ ] T-1 reopened thing', '- [x] T-2 now done', '- [x] T-3 done', '- [x] T-4 shared id'],
  });
  folder('2026-03-03-other-ho1', { 'TASKS.md': ['- [ ] T-4 other program'] });
  folder('scratch', {});
  folder('2026-04-15-prog-ho3', { 'RUN_LOG.md': ['Next: x', 'Next: x'], 'TASKS.md': ['- [ ] T-9 after the window'] });
}

const ARGS = ['HEAD', '--since', '2026-03-01', '--until', '2026-03-31'];
const cli = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: tmp });
const report = (script = join(SCRIPTS, 'churn.mjs')) => {
  const r = cli(script, ...ARGS, '--repo', repo, '--runs', runs, '--json');
  return r.status === 0 ? JSON.parse(r.stdout) : { failed: r.stderr };
};

// The cuts. Each detector is one line in churn.mjs; the cut replaces that line, and `patch` is the
// change in the report that cut must cause.
const CUTS = [
  { name: 'isRevert', cut: 'const isRevert = () => false;', patch: (r) => { r.reverts.count = 0; r.reverts.commits = []; } },
  { name: 'isRestamp', cut: 'const isRestamp = () => false;', patch: (r) => { r.fixOfFix.commits = 2; r.fixOfFix.max = 2; r.fixOfFix.restamp = { commits: 0, prs: 0 }; r.fixOfFix.top[0].fixCommits = 2; } },
  { name: 'isFixSubject', cut: 'const isFixSubject = () => false;', patch: (r) => { r.fixOfFix.commits = 1; r.fixOfFix.max = 1; r.fixOfFix.review = { commits: 0, prs: 0, anyPositionPrs: 0 }; r.fixOfFix.top[0].fixCommits = 1; } },
  { name: 'overlaps', cut: 'const overlaps = () => false;', patch: (r) => { r.refix.refixed = 0; r.refix.rate = 0; } },
  { name: 'nextKey', cut: 'const nextKey = (line) => line;', patch: (r) => { r.runs.repeatedNext = 0; } },
  { name: 'isReopened', cut: 'const isReopened = () => false;', patch: (r) => { r.runs.reopened = 0; } },
];

try {
  buildRepo();
  buildRuns();
  const headBefore = git(null, 'rev-parse', 'HEAD');
  const full = report();

  // ---- every signal, counted once ----
  check('the full run reads the fixture', !full.failed);
  check('window: 19 commits, 15 non-merge and 4 merge, bounded by the dates', full.commits?.total === 19 && full.commits.nonMerge === 15 && full.commits.merge === 4 && full.since === '2026-03-01' && full.until === '2026-03-31');
  check('re-fix: 4 of 12 eligible commits (the rework, the revert, and two fixes in the chain); derived edits, the late edit, and pure insertions do not count',
    full.refix?.eligible === 12 && full.refix.refixed === 4 && full.refix.rate === 33.3);
  check('revert: exactly one, by its body line', full.reverts?.count === 1 && full.reverts.of === 19 && full.reverts.commits.length === 1);
  const f = full.fixOfFix;
  check('fix-of-fix: 3 PRs, one with follow-ups, 3 commits, median 0, max 3', f?.prs === 3 && f.prsWithFollowUps === 1 && f.commits === 3 && f.median === 0 && f.max === 3);
  check('fix-of-fix split: 1 restamp in 1 PR, 2 review fixes in 1 PR, the opening Fix commit counted only in any-position (2 PRs)',
    f?.restamp.commits === 1 && f.restamp.prs === 1 && f.review.commits === 2 && f.review.prs === 1 && f.review.anyPositionPrs === 2);
  check('fix-of-fix: the merge with no PR subject is skipped and counted once', f?.unmatchedMerges === 1);
  check('fix-of-fix: the top PR is 7 with 3 of 4 commits', f?.top.length === 1 && f.top[0].pr === 7 && f.top[0].fixCommits === 3 && f.top[0].commits === 4);
  const u = full.runs;
  check('run logs: 5 Next lines in 2 files, one repeat (case, digits, and spacing folded); the same line in another file and in a folder after the window do not count',
    u?.nextLines === 5 && u.withNext === 2 && u.runLogs === 2 && u.repeatedNext === 1 && u.folders === 4);
  check('task ids: 4 ids, all seen both ways, one reopened in its own program', u?.ids === 4 && u.bothStates === 4 && u.reopened === 1);

  // ---- mutation control: cutting one detector loses exactly that signal ----
  const source = readFileSync(join(SCRIPTS, 'churn.mjs'), 'utf8');
  mkdirSync(join(tmp, 'cut'));
  copyFileSync(join(SCRIPTS, 'cli-lib.mjs'), join(tmp, 'cut', 'cli-lib.mjs'));
  for (const { name, cut, patch } of CUTS) {
    const pattern = new RegExp(`^const ${name} = .*$`, 'gm');
    const cutSource = source.replace(pattern, cut);
    const found = source.match(pattern)?.length ?? 0;
    const target = join(tmp, 'cut', `churn-${name}.mjs`);
    writeFileSync(target, cutSource);
    const expected = structuredClone(full);
    patch(expected);
    let same = false;
    try { deepStrictEqual(report(target), expected); same = true; } catch { same = false; }
    check(`mutation control: cutting ${name} loses exactly its signal`, found === 1 && cutSource !== source && same);
  }

  // ---- shape and edges ----
  const text = cli(join(SCRIPTS, 'churn.mjs'), ...ARGS, '--repo', repo, '--runs', runs);
  check('text report: exit 0 and the headline lines', text.status === 0 && /re-fix 4 of 12 commits \(33\.3 percent\)/.test(text.stdout) && /fix-of-fix 3 commits in 1 of 3 PRs/.test(text.stdout) && /reverts 1 of 19/.test(text.stdout));
  const range = cli(join(SCRIPTS, 'churn.mjs'), `${git(null, 'rev-list', '--max-parents=0', 'HEAD')}..HEAD`, '--repo', repo, '--json');
  const ranged = JSON.parse(range.stdout);
  check('a range with no dates takes every commit in it and omits the run folders', ranged.commits.total === 19 && ranged.refix.refixed === 4 && ranged.runs === null);
  const empty = cli(join(SCRIPTS, 'churn.mjs'), 'HEAD', '--since', '2030-01-01', '--repo', repo, '--runs', runs, '--json');
  const none = JSON.parse(empty.stdout);
  check('an empty window reports zeros, never NaN', empty.status === 0 && none.commits.total === 0 && none.refix.rate === 0 && none.fixOfFix.max === 0 && none.fixOfFix.median === 0);
  for (const [label, args] of [['an unknown flag', ['--bogus']], ['a bad date', ['--since', 'nonsense']], ['a missing run folder', ['--runs', join(tmp, 'absent')]], ['an option as the revision', ['--output=x']], ['an unreadable revision', ['no-such-rev']]]) {
    const r = cli(join(SCRIPTS, 'churn.mjs'), ...args, '--repo', repo);
    check(`usage error: ${label} exits 2`, r.status === 2);
  }
  check('read-only: HEAD and the work tree are unchanged', git(null, 'rev-parse', 'HEAD') === headBefore && git(null, 'status', '--porcelain') === '');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} churn check(s) failed:\n  - ${fails.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nchurn: all assertions pass');
