#!/usr/bin/env node
// Regression eval for evals/bench/bench.mjs.
//
//   node evals/bench/run.mjs   (exit 0 = pass)
//
// Builds small synthetic benches under the OS temp directory. A valid bench must check clean,
// and each mutant bench must fail `check` with the named problem. The tracked bench must also
// check clean. Build step 4 extends this eval to the scorer, the statistic, the verdict rule,
// and the transcript audit.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally, withDetail } from '../harness.mjs';
import { SKILLS, checkBench, treeDigest } from './bench.mjs';
import { cases as sandboxCases } from './cases/sandbox.cases.mjs';
import { cases as runnerCases } from './cases/runner.cases.mjs';
import { cases as scoreCases } from './cases/score.cases.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { fails, check } = tally(withDetail);

// The toy target. Lines 2 and 3 sit inside clamp; line 15 sits inside first.
const LIB = [
  'export function clamp(n, lo, hi) {',
  '  if (n < lo) return lo',
  '  if (n > hi) return hi',
  '  return n',
  '}',
  '',
  'export function sum(xs) {',
  '  let total = 0',
  '  for (let i = 0; i < xs.length; i++) total += xs[i]',
  '  return total',
  '}',
  '',
  '// The first element, or undefined for an empty list.',
  'export function first(xs) {',
  '  return xs[0]',
  '}',
  '',
].join('\n');

const VISIBLE = `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sum } from '../src/lib.js'
test('sum adds', () => assert.equal(sum([1, 2, 3]), 6))
`;
const testFile = (imports, body) => `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ${imports} } from '../src/lib.js'
test('hidden', () => { ${body} })
`;
const ORACLES = {
  'clamp.test.js': testFile('clamp, first', 'assert.equal(clamp(-1, 0, 5), 0); assert.equal(clamp(5, 0, 5), 5); assert.equal(clamp(9, 0, 5), 5)'),
  'first.test.js': testFile('clamp, first', 'assert.equal(first([7, 8]), 7)'),
  'last.test.js': testFile('last', 'assert.equal(last([7, 8]), 8)'),
};

// A review change adds last(); a reference change adds it for a ship task.
const LAST = '\nexport function last(xs) {\n  return xs[xs.length - 1]\n}\n';
const addLast = (id, kind) => ({ id, kind, message: kind === 'review' ? 'Add last helper' : null, edits: [{ file: 'src/lib.js', find: '  return xs[0]\n}\n', replace: `  return xs[0]\n}\n${LAST}` }] });

const seed = (id, kind, cls, find, replace, oracleFile, extra = {}) =>
  ({ id, kind, class: cls, base: null, file: 'src/lib.js', find, replace, oracle: oracleFile, symptom: null, ...extra });
const SEEDS = {
  firstOff: seed('first-off', 'defect', 'off-by-one', '  return xs[0]', '  return xs[1]', 'first.test.js'),
  clampVar: seed('clamp-var', 'defect', 'wrong-variable', '  if (n < lo) return lo', '  if (n < lo) return hi', 'clamp.test.js'),
  clampEq: seed('clamp-eq', 'decoy', 'off-by-one', '  if (n > hi) return hi', '  if (n >= hi) return hi', 'clamp.test.js'),
  lastOff: seed('last-off', 'defect', 'off-by-one', 'xs[xs.length - 1]', 'xs[xs.length - 2]', 'last.test.js', { base: 'add-last' }),
};
const SKILL_ROWS = SKILLS.map((id) => ({ id, metric: 'keyed-f05', minDelta: 0.1, tasks: 3 }));
const task = (id, seeds, extra = {}) =>
  ({ id, skill: 'rigor:bug-hunt', target: 'toy', statement: 'Find the defects.', seeds, change: null, acceptance: null, ...extra });

const temps = [];

/** Write a synthetic bench; edit(files, matrix) may change either before the digest is taken. */
function makeBench({ seeds = [], tasks = [], changes = [], edit = () => {}, after = () => {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'bench-eval-'));
  temps.push(root);
  const files = {
    'LICENSE': 'MIT\n',
    'PROVENANCE.md': 'Synthetic target.\n',
    'package.json': '{"type":"module"}\n',
    'src/lib.js': LIB,
    'test/visible.test.js': VISIBLE,
    'ANSWER_KEY.seeds/main.json': `${JSON.stringify(seeds, null, 2)}\n`,
    ...Object.fromEntries(Object.entries(ORACLES).map(([k, v]) => [`ANSWER_KEY.oracles/${k}`, v])),
    ...Object.fromEntries(changes.map((c) => [`ANSWER_KEY.changes/${c.id}.json`, JSON.stringify(c)])),
  };
  const matrix = {
    version: 1,
    skills: SKILL_ROWS.map((s) => ({ ...s })),
    targets: [{ name: 'toy', upstream: 'https://github.com/example/toy', commit: 'a'.repeat(40), license: 'MIT', treeDigest: '' }],
    tasks,
  };
  edit(files, matrix);
  const dir = join(root, 'targets', 'toy');
  for (const [rel, text] of Object.entries(files)) {
    const path = join(dir, ...rel.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  matrix.targets[0].treeDigest = treeDigest(dir);
  after(dir, matrix);
  writeFileSync(join(root, 'bench-matrix.json'), JSON.stringify(matrix));
  return root;
}

/** The bench must fail check with a problem that matches pattern. */
async function mustFail(name, pattern, spec, opts = {}) {
  const problems = await checkBench(makeBench(spec), opts);
  check(name, problems.some((p) => pattern.test(p)), problems.join(' | ') || 'no problem reported');
}

const REVIEW = addLast('add-last', 'review');
const REFERENCE = addLast('ref-last', 'reference');
const SHIP = task('ship-last', [], { skill: 'code-ops-suite:ship', change: 'ref-last', acceptance: 'last.test.js' });

try {
  const proved = [];
  const valid = await checkBench(makeBench({
    seeds: [SEEDS.firstOff, SEEDS.clampEq, { ...SEEDS.clampVar, symptom: 'clamp returns the upper bound for low input.' }, SEEDS.lastOff],
    changes: [REVIEW, REFERENCE],
    tasks: [
      task('hunt-1', ['first-off', 'clamp-eq']),
      task('debug-1', ['clamp-var'], { skill: 'code-ops-suite:debug' }),
      task('review-1', ['last-off'], { skill: 'rigor:deep-review', change: 'add-last' }),
      SHIP,
    ],
  }), { log: (line) => proved.push(line) });
  check('valid synthetic bench checks clean', valid.length === 0, valid.join(' | '));
  const count = (re) => proved.filter((l) => re.test(l)).length;
  check('valid bench proves every seed', count(/^seed .* proved$/) === 4, proved.join(' | '));
  check('valid bench proves every change', count(/^change .* proved$/) === 2, proved.join(' | '));
  check('valid bench proves the seeded tasks', count(/^task .* seed set proved$/) === 3, proved.join(' | '));
  check('valid bench proves the ship acceptance', count(/^task ship-last: acceptance proved$/) === 1, proved.join(' | '));

  const tracked = await checkBench(HERE);
  check('tracked bench checks clean', tracked.length === 0, tracked.join(' | '));

  // The digest excludes answer-key material and covers everything else.
  const a = makeBench({ seeds: [SEEDS.firstOff] });
  const b = makeBench({ seeds: [SEEDS.clampEq], changes: [REVIEW] });
  check('tree digest ignores answer-key files', treeDigest(join(a, 'targets', 'toy')) === treeDigest(join(b, 'targets', 'toy')));

  // A group run proves only that group's seeds.
  const grouped = [];
  const groupProblems = await checkBench(makeBench({
    seeds: [SEEDS.firstOff],
    edit: (f) => {
      f['ANSWER_KEY.seeds/other.json'] = JSON.stringify([{ ...SEEDS.clampEq, kind: 'defect' }]);
      f['ANSWER_KEY.seeds/half.json'] = '[{';
      f['ANSWER_KEY.changes/half.json'] = '{';
    },
  }), { group: 'main', log: (l) => grouped.push(l) });
  check('group run ignores other groups and their half-written files', groupProblems.length === 0 && grouped.some((l) => l === 'seed first-off: proved'), groupProblems.join(' | '));

  await mustFail('digest drift fails', /tree digest is/, {
    after: (dir) => writeFileSync(join(dir, 'src', 'lib.js'), `${LIB}// edit\n`),
  });
  await mustFail('missing provenance fails', /missing PROVENANCE\.md/, { edit: (f) => { delete f['PROVENANCE.md']; } });
  await mustFail('pristine visible failure fails', /visible suite fails on the pristine/, {
    edit: (f) => { f['test/visible.test.js'] = VISIBLE.replace('6))', '7))'); },
  });
  await mustFail('unknown matrix key fails', /unknown key "extra"/, { edit: (_f, m) => { m.extra = 1; } });
  await mustFail('missing skill fails', /must appear exactly once/, { edit: (_f, m) => { m.skills.pop(); } });
  await mustFail('too many tasks for a skill fails', /more than the 1 declared/, {
    seeds: [SEEDS.firstOff],
    tasks: [task('t-1', ['first-off']), task('t-2', ['first-off'])],
    edit: (_f, m) => { m.skills[0].tasks = 1; },
  });
  await mustFail('find that occurs twice fails', /occurs 2 times/, {
    seeds: [seed('twice', 'defect', 'inverted-guard', 'if (n ', 'if (!n ', 'clamp.test.js')],
  });
  await mustFail('tell word in replace fails', /tell word "todo"/, {
    seeds: [{ ...SEEDS.firstOff, replace: '  return xs[1] // todo' }],
  });
  await mustFail('seed in the visible tests fails', /outside test\//, {
    seeds: [{ ...seed('in-test', 'defect', 'off-by-one', '6))', '7))', 'first.test.js'), file: 'test/visible.test.js' }],
  });
  await mustFail('defect that passes its oracle fails', /defect seed passes its oracle/, {
    seeds: [{ ...SEEDS.clampEq, id: 'fake-defect', kind: 'defect' }],
  });
  await mustFail('decoy that fails its oracle fails', /decoy seed fails its oracle/, {
    seeds: [{ ...SEEDS.clampVar, id: 'fake-decoy', kind: 'decoy' }],
  });
  await mustFail('seed that breaks the visible suite fails', /visible suite fails with the seed/, {
    seeds: [seed('sum-sign', 'defect', 'wrong-variable', 'total += xs[i]', 'total -= xs[i]', 'first.test.js')],
  });
  await mustFail('oracle that fails on its base fails', /oracle fails on the seed's base/, {
    seeds: [SEEDS.firstOff],
    edit: (f) => { f['ANSWER_KEY.oracles/first.test.js'] = testFile('first', 'assert.equal(first([7, 8]), 8)'); },
  });
  await mustFail('missing oracle file fails', /does not exist/, { seeds: [{ ...SEEDS.firstOff, oracle: 'none.test.js' }] });
  await mustFail('seeds closer than the gap fail', /closer than 10 lines/, {
    seeds: [SEEDS.clampVar, SEEDS.clampEq],
    tasks: [task('near', ['clamp-var', 'clamp-eq'])],
  });
  await mustFail('unknown seed in a task fails', /unknown seeds ghost/, {
    seeds: [SEEDS.firstOff],
    tasks: [task('ghost-task', ['ghost'])],
  });
  await mustFail('unknown seed class fails', /class must be one of/, { seeds: [{ ...SEEDS.firstOff, class: 'typo' }] });
  await mustFail('change that breaks the visible suite fails', /visible suite fails with the change applied/, {
    changes: [{ id: 'break-sum', kind: 'review', message: 'Rework sum', edits: [{ file: 'src/lib.js', find: 'total += xs[i]', replace: 'total -= xs[i]' }] }],
  });
  await mustFail('change with a tell word fails', /tell word "hack"/, {
    changes: [{ ...REVIEW, edits: [{ ...REVIEW.edits[0], replace: `${REVIEW.edits[0].replace}// hack\n` }] }],
  });
  await mustFail('change id must match its file', /id must equal the file name/, {
    changes: [REVIEW],
    edit: (f) => { f['ANSWER_KEY.changes/add-last.json'] = JSON.stringify({ ...REVIEW, id: 'other' }); },
  });
  await mustFail('based seed outside the change fails', /must sit inside text that change add-last adds/, {
    seeds: [{ ...SEEDS.firstOff, base: 'add-last' }],
    changes: [REVIEW],
  });
  await mustFail('review seed with the wrong base fails', /must have base add-last/, {
    seeds: [SEEDS.firstOff],
    changes: [REVIEW],
    tasks: [task('review-x', ['first-off'], { skill: 'rigor:deep-review', change: 'add-last' })],
  });
  await mustFail('review task without a change fails', /task shape is wrong/, {
    seeds: [SEEDS.firstOff],
    tasks: [task('review-y', ['first-off'], { skill: 'rigor:deep-review' })],
  });
  await mustFail('debug task with two seeds fails', /exactly one defect seed with a symptom/, {
    seeds: [SEEDS.firstOff, SEEDS.clampVar],
    tasks: [task('debug-x', ['first-off', 'clamp-var'], { skill: 'code-ops-suite:debug' })],
  });
  await mustFail('ship acceptance that passes on pristine fails', /acceptance test passes on the pristine tree/, {
    changes: [REFERENCE],
    tasks: [{ ...SHIP, acceptance: 'first.test.js' }],
  });
  await mustFail('ship reference that misses acceptance fails', /acceptance test fails with the reference change/, {
    changes: [{ ...REFERENCE, edits: [{ ...REFERENCE.edits[0], replace: REFERENCE.edits[0].replace.replace('- 1]', '- 2]') }] }],
    tasks: [SHIP],
  });
  await mustFail('review change without a message fails', /review change needs a non-empty message/, {
    changes: [{ ...REVIEW, message: '' }],
  });
  await mustFail('ship task with a review change fails', /must be a reference change/, {
    changes: [{ ...REFERENCE, kind: 'review', message: 'Add last helper' }],
    tasks: [SHIP],
  });
  await scoreCases(check);
  await sandboxCases(check);
  await runnerCases(check);
} finally {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nbench eval: ${fails.length} failure(s)`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nbench eval: all checks pass');
