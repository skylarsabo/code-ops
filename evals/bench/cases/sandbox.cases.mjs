// Cases for evals/bench/lib/sandbox.mjs and evals/bench/lib/audit.mjs. No model, no network.
// Each property is a predicate over an output. The real output must pass it and a mutant output must
// fail it, so a predicate that cannot fail shows up here.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditUnit } from '../lib/audit.mjs';
import { afterRun, deriveKey, materialize, newCanary, stableJson } from '../lib/sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = join(HERE, '..');
const REAL_TARGET = join(BENCH, 'targets', 'hyparquet');

const native = (dir, rel) => join(dir, ...rel.split('/'));
const lines = (dest, rel) => readFileSync(native(dest, rel), 'utf8').split('\n');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function writeTree(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(native(dir, rel)), { recursive: true });
    writeFileSync(native(dir, rel), text);
  }
}

/** Run git read-only in a sandbox (no config, no identity needed). */
function gitOut(dest, args) {
  return execFileSync('git', args, { cwd: dest, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
}

/** Every file under dir, POSIX relative, skipping .git. */
function walk(dir, rel = '') {
  const out = [];
  for (const ent of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.name === '.git') continue;
    if (ent.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out;
}

const A_JS = [
  'export function clamp(n, max) {',
  '  if (n < 0) return 0',
  '  if (n > max) return max',
  '  return n',
  '}',
  '',
  'export function pad(items) {',
  '  const out = []',
  '  for (const x of items) out.push(x)',
  '  return out',
  '}',
  '',
].join('\n');

const TINY = {
  'package.json': '{ "type": "module" }\n',
  LICENSE: 'MIT\n',
  'PROVENANCE.md': 'Upstream: https://github.com/example/tinyproj\n',
  'src/a.js': A_JS,
  'test/a.test.js': [
    "import test from 'node:test'",
    "import assert from 'node:assert'",
    "import { clamp, pad } from '../src/a.js'",
    "test('clamp floor', () => assert.equal(clamp(-1, 3), 0))",
    "test('pad length', () => assert.equal(pad([1, 2]).length, 2))",
    '',
  ].join('\n'),
  'ANSWER_KEY.oracles/o-clamp.test.js': [
    "import test from 'node:test'",
    "import assert from 'node:assert'",
    "import { clamp } from '../src/a.js'",
    "test('clamp ceiling', () => assert.equal(clamp(5, 3), 3))",
    '',
  ].join('\n'),
  'ANSWER_KEY.oracles/o-pad.test.js': [
    "import test from 'node:test'",
    "import assert from 'node:assert'",
    "import { pad } from '../src/a.js'",
    "test('pad copies', () => assert.deepEqual(pad([1]), [1]))",
    '',
  ].join('\n'),
  'ANSWER_KEY.oracles/o-new.test.js': [
    "import test from 'node:test'",
    "import assert from 'node:assert'",
    "import * as a from '../src/a.js'",
    "test('extra exists', () => assert.equal(typeof a.extra, 'function'))",
    '',
  ].join('\n'),
};

const B_JS = 'export function head(list, n) {\n  if (n <= 0) return []\n  return list.slice(0, n)\n}\n';

const SEEDS = [
  { id: 'bh-guard', kind: 'defect', class: 'missing-guard', base: null, file: 'src/a.js', find: '  if (n > max) return max\n', replace: '', oracle: 'o-clamp.test.js', symptom: null },
  { id: 'bh-order', kind: 'decoy', class: 'wrong-order', base: null, file: 'src/a.js', find: 'out.push(x)', replace: '\n    out.unshift(x)', oracle: 'o-pad.test.js', symptom: null },
  { id: 'dr-guard', kind: 'defect', class: 'missing-guard', base: 'dr-x', file: 'src/b.js', find: '  if (n <= 0) return []\n', replace: '', oracle: 'o-head.test.js', symptom: null },
];
const CHANGES = [
  { id: 'dr-x', kind: 'review', message: 'Add head helper for list prefixes', edits: [{ file: 'src/b.js', find: null, replace: B_JS }] },
  { id: 'sh-ref', kind: 'reference', message: 'unused', edits: [{ file: 'src/a.js', find: 'export function pad', replace: 'export const extra = () => 1\n\nexport function pad' }] },
];
const TASKS = {
  bh: { id: 'bh-t', skill: 'rigor:bug-hunt', seeds: ['bh-guard', 'bh-order'], change: null, acceptance: null },
  db: { id: 'db-t', skill: 'code-ops-suite:debug', seeds: ['bh-guard'], change: null, acceptance: null },
  dr: { id: 'dr-t', skill: 'rigor:deep-review', seeds: ['dr-guard'], change: 'dr-x', acceptance: null },
  clean: { id: 'dr-c', skill: 'rigor:deep-review', seeds: [], change: 'dr-x', acceptance: null },
  sh: { id: 'sh-t', skill: 'code-ops-suite:ship', seeds: [], change: 'sh-ref', acceptance: ['o-pad.test.js', 'o-new.test.js'] },
};

export async function cases(check) {
  const temps = [];
  const fresh = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); temps.push(d); return d; };
  // dest must not exist-with-content, but mkdtemp gives an empty directory, which materialize accepts.
  const build = (target, task, changes = CHANGES, seeds = SEEDS) => materialize({ task, seeds, changes, targetDir: target, dest: fresh('bench-sbx-') });
  const mutantPair = (name, real, mutant, detail = '') => {
    check(name, real, detail);
    check(`${name} (mutant fails)`, !mutant, detail);
  };

  try {
    const tiny = fresh('bench-tiny-');
    writeTree(tiny, TINY);
    const key = (task, canary = 'c'.repeat(32)) => deriveKey({ task, seeds: SEEDS, changes: CHANGES, targetDir: tiny, canary });

    // stableJson and byte identity
    const k1 = stableJson(key(TASKS.bh));
    const k2 = stableJson(key(TASKS.bh));
    const shuffled = JSON.stringify({ b: 1, a: [{ d: 1, c: 2 }] });
    mutantPair('stableJson: key order does not change the bytes',
      stableJson({ b: 1, a: [{ d: 1, c: 2 }] }) === stableJson({ a: [{ c: 2, d: 1 }], b: 1 }),
      shuffled === JSON.stringify({ a: [{ c: 2, d: 1 }], b: 1 }));
    mutantPair('deriveKey: two calls give identical bytes, ending in a newline', k1 === k2 && k1.endsWith('}\n'), k1 === stableJson(key(TASKS.bh, 'd'.repeat(32))));
    check('newCanary: 32 hex, new each call', /^[0-9a-f]{32}$/.test(newCanary()) && newCanary() !== newCanary());

    // deleted-guard seed's line and anchor; multi-line replace with a leading blank line
    const bh = key(TASKS.bh);
    const guard = bh.entries.find((e) => e.id === 'bh-guard');
    const order = bh.entries.find((e) => e.id === 'bh-order');
    mutantPair('deleted-guard seed: line is the line that followed the deleted text',
      guard.line === 3 && guard.anchor === 'return n' && guard.kind === 'defect',
      guard.line === 4);
    mutantPair('replace starting with a newline: line and anchor name the first non-blank line',
      order.line === 9 && order.anchor === 'out.unshift(x)' && bh.entries.length === 2,
      order.line === 8, JSON.stringify(order));
    check('key: fields and clean flag', bh.lineTolerance === 3 && bh.task === 'bh-t' && bh.skill === 'rigor:bug-hunt' && bh.cleanChange === false && bh.oracles.length === 0 && bh.canary === 'c'.repeat(32));
    check('key: debug lists the seed oracles, ship the acceptance oracles',
      JSON.stringify(key(TASKS.db).oracles) === '["o-clamp.test.js"]' && JSON.stringify(key(TASKS.sh).oracles) === '["o-new.test.js","o-pad.test.js"]');
    check('key: a deep-review task with no defect seed is a clean change', key(TASKS.clean).cleanChange === true && key(TASKS.dr).cleanChange === false);

    // sandboxes
    const sbBh = build(tiny, TASKS.bh);
    const sbBh2 = build(tiny, TASKS.bh);
    const sbDr = build(tiny, TASKS.dr);
    const sbSh = build(tiny, TASKS.sh);
    const sbDrOther = build(tiny, TASKS.dr, [{ ...CHANGES[0], message: 'A different message' }, CHANGES[1]]);
    const sbDb = build(tiny, TASKS.db);

    const bhLine = (e, sb) => lines(sb.dest, e.file)[e.line - 1]?.trim() === e.anchor;
    check('sandbox: tiny key lines point at the anchor text', bh.entries.every((e) => bhLine(e, sbBh)));
    const drKey = key(TASKS.dr);
    mutantPair('sandbox: deep-review seed line is correct in the second commit tree',
      drKey.entries.every((e) => bhLine(e, sbDr)) && drKey.entries[0].line === 2 && drKey.entries[0].anchor === 'return list.slice(0, n)',
      bhLine({ ...drKey.entries[0], line: 3 }, sbDr), JSON.stringify(drKey.entries));

    const subjects = (sb) => gitOut(sb.dest, ['log', '--format=%s']).trim().split('\n');
    mutantPair('deep-review: two commits, the second with the change message verbatim',
      sbDr.commits === 2 && JSON.stringify(subjects(sbDr)) === JSON.stringify(['Add head helper for list prefixes', 'Initial import']),
      JSON.stringify(subjects(sbSh)) === JSON.stringify(['Add head helper for list prefixes', 'Initial import']));
    check('deep-review: commit one is pristine, the seed sits only in commit two',
      !gitOut(sbDr.dest, ['show', 'HEAD~1:src/a.js']).includes('slice') && !existsSyncAt(sbDr, 'HEAD~1', 'src/b.js')
      && gitOut(sbDr.dest, ['show', 'HEAD:src/b.js']) === B_JS.replace('  if (n <= 0) return []\n', ''));
    mutantPair('ship: one pristine commit', sbSh.commits === 1 && !gitOut(sbSh.dest, ['show', 'HEAD:src/a.js']).includes('extra') && gitOut(sbSh.dest, ['show', 'HEAD:src/a.js']) === A_JS,
      sbBh.commits === 2 || gitOut(sbBh.dest, ['show', 'HEAD:src/a.js']) === A_JS);
    check('bug-hunt and debug: one commit named Initial import', sbBh.commits === 1 && subjects(sbBh)[0] === 'Initial import' && sbDb.commits === 1);
    check('fixed identity and date', gitOut(sbBh.dest, ['log', '-1', '--format=%an <%ae> %aI|%cn <%ce> %cI']).trim()
      === 'Bench <bench@example.invalid> 2026-01-01T00:00:00Z|Bench <bench@example.invalid> 2026-01-01T00:00:00Z'
      && gitOut(sbBh.dest, ['branch', '--show-current']).trim() === 'main');
    mutantPair('deterministic HEAD sha: same task, same sha', sbBh.head === sbBh2.head && /^[0-9a-f]{40}$/.test(sbBh.head), sbDr.head === sbDrOther.head);

    // no answer-key material in a sandbox
    const clean = (sb, banned = []) => {
      const files = walk(sb.dest);
      const tracked = gitOut(sb.dest, ['ls-files']).split('\n').filter(Boolean);
      const text = [...files.filter((f) => /\.(js|json|md)$/.test(f)).map((f) => readFileSync(native(sb.dest, f), 'utf8')), gitOut(sb.dest, ['log', '--format=%B'])].join('\n');
      return !files.some((f) => f.split('/').some((s) => s.startsWith('ANSWER_KEY.') || s === 'oracle' || s === 'PROVENANCE.md'))
        && !tracked.some((f) => f.includes('ANSWER_KEY')) && !banned.some((b) => text.includes(b)) && files.includes('LICENSE');
    };
    const ids = [...SEEDS.map((s) => s.id), ...CHANGES.map((c) => c.id), ...Object.values(TASKS).map((t) => t.id)];
    const leaky = build(tiny, TASKS.bh);
    mkdirSync(join(leaky.dest, 'ANSWER_KEY.seeds'));
    writeFileSync(join(leaky.dest, 'ANSWER_KEY.seeds', 'x.json'), '[]');
    mutantPair('sandbox: no answer-key path, oracle, PROVENANCE.md, or id; LICENSE kept',
      [sbBh, sbDr, sbSh, sbDb].every((sb) => clean(sb, ids)), clean(leaky, ids));

    // afterRun: oracles and the visible suite
    const keyDb = key(TASKS.db);
    const afterDb = await afterRun({ task: TASKS.db, derivedKey: keyDb, targetDir: tiny, dest: sbDb.dest });
    const sbPristine = build(tiny, TASKS.sh);
    const afterPristine = await afterRun({ task: TASKS.db, derivedKey: keyDb, targetDir: tiny, dest: sbPristine.dest });
    mutantPair('afterRun: a defect seed fails its oracle, an unseeded tree passes it',
      afterDb.oracles['o-clamp.test.js'] === false && afterDb.visibleFailures === 0 && afterDb.headCommits === 1, afterPristine.oracles['o-clamp.test.js'] === false, JSON.stringify(afterDb));
    check('afterRun: oracle files enter dest only after the run', !existsSyncAt(sbDb, 'HEAD', 'oracle/o-clamp.test.js') && existsSync(join(sbDb.dest, 'oracle', 'o-clamp.test.js')));
    const afterSh = await afterRun({ task: TASKS.sh, derivedKey: key(TASKS.sh), targetDir: tiny, dest: sbSh.dest });
    check('afterRun: ship acceptance reports each oracle', afterSh.oracles['o-pad.test.js'] === true && afterSh.oracles['o-new.test.js'] === false && afterSh.headCommits === 1, JSON.stringify(afterSh));
    writeFileSync(join(sbBh.dest, 'test', 'broken.test.js'), [
      "import test from 'node:test'",
      "import assert from 'node:assert'",
      "test('one', () => assert.equal(1, 2))",
      "test('two', () => assert.equal(1, 3))",
      '',
    ].join('\n'));
    const afterBh = await afterRun({ task: TASKS.bh, derivedKey: bh, targetDir: tiny, dest: sbBh.dest });
    mutantPair('afterRun: visibleFailures counts failing visible tests', afterBh.visibleFailures === 2 && Object.keys(afterBh.oracles).length === 0, afterPristine.visibleFailures === 2, JSON.stringify(afterBh));

    // the real target: every task, key bytes, lines, and anchors in the materialized tree
    const matrix = readJson(join(BENCH, 'bench-matrix.json'));
    const realSeeds = readdirSync(join(REAL_TARGET, 'ANSWER_KEY.seeds')).flatMap((f) => readJson(join(REAL_TARGET, 'ANSWER_KEY.seeds', f)));
    const realChanges = readdirSync(join(REAL_TARGET, 'ANSWER_KEY.changes')).map((f) => readJson(join(REAL_TARGET, 'ANSWER_KEY.changes', f)));
    const canary = newCanary();
    const wrong = [];
    const shifted = [];
    const identical = [];
    const dirty = [];
    const counts = [];
    const realIds = [...realSeeds.map((s) => s.id), ...realChanges.map((c) => c.id), ...matrix.tasks.map((t) => t.id)];
    const realBuilds = new Map();
    for (const task of matrix.tasks) {
      const args = { task, seeds: realSeeds, changes: realChanges, targetDir: REAL_TARGET, canary };
      const derived = deriveKey(args);
      identical.push(stableJson(derived) === stableJson(deriveKey(args)));
      counts.push(derived.entries.length === task.seeds.length);
      const sb = materialize({ ...args, dest: fresh('bench-real-') });
      realBuilds.set(task.id, sb);
      for (const e of derived.entries) {
        if (lines(sb.dest, e.file)[e.line - 1]?.trim() !== e.anchor || e.anchor === '') wrong.push(`${task.id}:${e.id}@${e.line}`);
        shifted.push(lines(sb.dest, e.file)[e.line]?.trim() === e.anchor);
      }
      if (!clean(sb, realIds.filter((id) => !/^(bh|ca|dr|db|sh)-\d$/.test(id)))) dirty.push(task.id);
    }
    mutantPair('real tasks: every key line holds its anchor in the materialized tree', wrong.length === 0 && matrix.tasks.length === 12, shifted.every(Boolean), wrong.join(' '));
    check('real tasks: key bytes are identical across calls', identical.every(Boolean));
    check('real tasks: one key entry per seed', counts.every(Boolean));
    check('real tasks: sandboxes hold no answer-key path, seed id, or change id', dirty.length === 0, dirty.join(' '));
    const db1 = matrix.tasks.find((t) => t.id === 'db-1');
    const again = materialize({ task: db1, seeds: realSeeds, changes: realChanges, targetDir: REAL_TARGET, dest: fresh('bench-real-') });
    check('real tasks: same task, same HEAD sha', again.head === realBuilds.get('db-1').head);
    const reviewTask = matrix.tasks.find((t) => t.skill === 'rigor:deep-review');
    const reviewChange = realChanges.find((c) => c.id === reviewTask.change);
    check('real tasks: deep-review commit two uses the change message', gitOut(realBuilds.get(reviewTask.id).dest, ['log', '-1', '--format=%s']).trim() === reviewChange.message && realBuilds.get(reviewTask.id).commits === 2);

    auditCases(check, mutantPair);
  } finally {
    for (const d of temps) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  }
}

/** True when `rev:path` exists in the sandbox's repository. */
function existsSyncAt(sb, rev, path) {
  try { gitOut(sb.dest, ['cat-file', '-e', `${rev}:${path}`]); return true; } catch { return false; }
}

function auditCases(check, mutantPair) {
  const root = 'C:\\Users\\sample\\Documents\\Repos\\code-ops';
  const runFolder = 'D:\\runs\\bench-1';
  const plugin = 'C:\\Users\\sample\\AppData\\Local\\Temp\\bench-plugin-1\\plugin-copy';
  const canary = 'abcdef0123456789abcdef0123456789';
  const base = { repoRoot: root, runFolder, canary, upstream: ['hyparquet', 'https://github.com/hyparam/hyparquet'], allowedPaths: [plugin, 'C:\\Users\\sample\\AppData\\Local\\Temp\\bench-sbx-1'] };
  const tool = (name, input) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }, { type: 'tool_use', id: 't1', name, input }] } });
  const result = (text) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] } });
  const run = (...texts) => auditUnit({ ...base, transcriptTexts: [texts.join('\n')], findingsText: '[]' });
  const rules = (a) => a.triggers.map((t) => t.rule);

  const repoForms = [
    ['backslash', tool('Read', { file_path: `${root}\\src\\filter.js` })],
    ['forward slash', tool('Read', { file_path: 'C:/Users/sample/Documents/Repos/code-ops/src/filter.js' })],
    ['upper-case', tool('Bash', { command: 'cat C:/USERS/SAMPLE/DOCUMENTS/REPOS/CODE-OPS/README.md' })],
    ['mixed slashes and case', tool('Bash', { command: 'type c:\\Users/sample\\documents/Repos\\Code-Ops\\x' })],
    ['doubled backslashes', tool('Bash', { command: 'dir C:\\\\Users\\\\sample\\\\Documents\\\\Repos\\\\code-ops' })],
    ['MSYS form', tool('Bash', { command: 'ls /c/Users/sample/Documents/Repos/code-ops/evals' })],
    ['run folder', tool('Glob', { path: 'd:/RUNS/Bench-1/units', pattern: '*.json' })],
    ['root alone', tool('Bash', { command: `cd "${root}"` })],
  ];
  for (const [name, line] of repoForms) {
    const a = run(line);
    check(`audit repo-path: ${name}`, a.void && rules(a).includes('repo-path'), JSON.stringify(a.triggers));
  }
  const naive = (text) => text.includes(root) || text.includes(runFolder);
  mutantPair('audit repo-path: all eight forms void', repoForms.every(([, l]) => run(l).void), repoForms.every(([, l]) => naive(l)));

  const quiet = [
    ['plugin-copy path', tool('Read', { file_path: `${plugin}\\skills\\ship\\SKILL.md` })],
    ['plugin-copy path, forward slashes and other case', tool('Bash', { command: 'cat c:/users/sample/appdata/local/temp/BENCH-PLUGIN-1/plugin-copy/skills/x.md' })],
    ['sandbox path', tool('Bash', { command: 'cd C:/Users/sample/AppData/Local/Temp/bench-sbx-1 && node --test' })],
    ['sibling directory with the root as a prefix', tool('Read', { file_path: `${root}-plugin\\skills\\x.md` })],
    ['repo path only in a tool result', result(`opened ${root}\\src`)],
    ['no paths', tool('Bash', { command: 'node --test test/' })],
  ];
  for (const [name, line] of quiet) {
    const a = run(line);
    check(`audit allows: ${name}`, !a.void && a.triggers.length === 0, JSON.stringify(a.triggers));
  }
  const nested = auditUnit({ ...base, allowedPaths: [`${root}\\.tmp\\plugin`], transcriptTexts: [[tool('Read', { file_path: `${root}\\.tmp\\plugin\\a.md` }), tool('Read', { file_path: `${root}\\src\\a.js` })].join('\n')] });
  check('audit repo-path: an allowed path inside the root is skipped, the rest of the root is not', nested.triggers.length === 1 && nested.triggers[0].where === 'transcript[0]' && nested.triggers[0].excerpt.includes('src/a.js'), JSON.stringify(nested.triggers));

  const keyed = [
    ['ANSWER_KEY in a tool input', run(tool('Bash', { command: 'ls targets/hyparquet/ANSWER_KEY.seeds' }))],
    ['ANSWER_KEY in a tool result', run(result('ANSWER_KEY.oracles/x.test.js'))],
    ['canary in a transcript', run(result(`secret ${canary}`))],
    ['canary in upper case', run(result(`secret ${canary.toUpperCase()}`))],
    ['ANSWER_KEY in the findings', auditUnit({ ...base, transcriptTexts: [], findingsText: 'see ANSWER_KEY.json' })],
    ['canary in the findings', auditUnit({ ...base, transcriptTexts: ['{}'], findingsText: `[{"summary":"${canary}"}]` })],
  ];
  for (const [name, a] of keyed) check(`audit answer-key: ${name}`, a.void && rules(a).includes('answer-key'), JSON.stringify(a.triggers));
  check('audit answer-key: the findings trigger names findings', keyed[4][1].triggers[0].where === 'findings' && keyed[5][1].triggers[0].where === 'findings');
  const masked = [run(result(`secret ${canary} and more ${'x'.repeat(300)}`)), keyed[5][1], run(tool('Bash', { command: `curl https://github.com/hyparam/hyparquet/${canary}` }))];
  mutantPair('audit excerpts: at most 120 characters, canary masked',
    masked.every((a) => a.void && a.triggers.every((t) => t.excerpt.length <= 120 && !t.excerpt.toLowerCase().includes(canary)))
      && masked[0].triggers[0].excerpt.includes('<canary>'),
    masked.every((a) => a.triggers.every((t) => t.excerpt.includes(canary))), JSON.stringify(masked.map((a) => a.triggers)));

  const nets = [
    ['curl', 'curl -sL https://github.com/hyparam/hyparquet/archive/main.tar.gz'],
    ['git clone', 'git clone https://github.com/hyparam/hyparquet.git /tmp/x'],
    ['git fetch', 'git fetch https://github.com/hyparam/hyparquet'],
    ['npm view', 'npm view hyparquet version'],
    ['npm install', 'npm install hyparquet'],
    ['npx', 'npx hyparquet-cli --help'],
    ['wget', 'wget https://raw.githubusercontent.com/hyparam/hyparquet/master/src/read.js'],
    ['Invoke-WebRequest', 'Invoke-WebRequest -Uri https://github.com/hyparam/hyparquet'],
    ['iwr', 'iwr https://github.com/HYPARAM/Hyparquet'],
    ['chained after a harmless command', 'cd work && NODE_ENV=x npm install hyparquet; echo done'],
  ];
  for (const [name, command] of nets) {
    const a = run(tool('Bash', { command }));
    check(`audit upstream-fetch: ${name}`, a.void && rules(a).includes('upstream-fetch'), JSON.stringify(a.triggers));
  }
  const web = run(tool('WebFetch', { url: 'https://github.com/hyparam/hyparquet', prompt: 'summarize' }));
  check('audit upstream-fetch: a web tool input', web.void && rules(web).includes('upstream-fetch'));
  const outside = [
    ['grep for the name', tool('Bash', { command: 'grep -rn hyparquet src/' })],
    ['name in a file edit', tool('Edit', { file_path: 'package.json', old_string: 'hyparquet', new_string: 'x' })],
    ['name in a sandbox path next to an unrelated fetch', tool('Bash', { command: 'cd /tmp/hyparquet-sandbox && curl https://example.com/data.json' })],
    ['network command without the name', tool('Bash', { command: 'curl -sL https://example.com' })],
    ['name in a tool result', result('npm view hyparquet version')],
  ];
  for (const [name, line] of outside) {
    const a = run(line);
    check(`audit allows: ${name}`, !a.void, JSON.stringify(a.triggers));
  }
  const loose = (text) => /hyparquet/i.test(text);
  mutantPair('audit upstream-fetch: the name alone does not void', outside.every(([, l]) => !run(l).void), outside.every(([, l]) => !loose(l)));

  const combined = run(tool('Read', { file_path: `${root}\\a.js` }), result(`${canary}`));
  check('audit: several triggers are all listed, void is true', combined.void && rules(combined).includes('repo-path') && rules(combined).includes('answer-key'));
  check('audit: a clean unit does not void', !auditUnit({ ...base, transcriptTexts: [run(quiet[0][1]).void ? '' : quiet[0][1]], findingsText: '[]' }).void);
  check('audit: lines that are not JSON count as tool input', auditUnit({ ...base, transcriptTexts: [`plain text ${root}\\x`], findingsText: '' }).void);
}
