#!/usr/bin/env node
// Regression eval for scripts/handoff-state.mjs (`co handoff draft|resume`). On a scratch git
// repository with a fixture run folder, it asserts that draft fills the mechanical facts and that
// its unfilled skeleton FAILS check-handoff.mjs; that resume passes, writes HANDOFF.consumed, and
// prints operator-owned items first on a good handoff; and that resume refuses to consume once an
// anchor drifted.
//
//   node evals/handoff-state/run.mjs   (exit 0 = all assertions pass)

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const co = join(REPO, 'scripts', 'co.mjs');
const checker = join(REPO, 'scripts', 'check-handoff.mjs');

const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };
const tmp = mkdtempSync(join(tmpdir(), 'handoff-state-'));
const node = (args) => spawnSync(process.execPath, args, { cwd: tmp, encoding: 'utf8' });
const gitIn = (...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args], { cwd: tmp, stdio: 'ignore' });

try {
  writeFileSync(join(tmp, 'src.txt'), 'alpha line\nbeta line\n');
  gitIn('init', '-q');
  gitIn('add', 'src.txt');
  gitIn('commit', '-q', '-m', 'base');
  const base = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();
  writeFileSync(join(tmp, 'src.txt'), 'alpha line\nbeta line\ngamma line\n');
  gitIn('commit', '-qam', 'second');
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: tmp, encoding: 'utf8' }).trim();

  const run = join(tmp, 'runs', 'r1');
  mkdirSync(run, { recursive: true });
  const operatorItem = '- [ ] OI-2 Merge decision: awaiting answer · Owner: operator · Done when: operator replies yes or no · Pointer: src.txt';
  const agentItem = '- [ ] OI-1 Beta rewrite: not started · Owner: agent · Done when: src.txt line 2 reads beta v2 · Pointer: src.txt:2';
  writeFileSync(join(run, 'TASKS.md'), `# Tasks\n\n${agentItem}\n- [x] Alpha audit: done · Owner: agent · Done when: audit noted · Pointer: src.txt:1\n${operatorItem}\n`);
  writeFileSync(join(run, 'FINDINGS_REGISTER.md'), '# Findings\n\n### FND-001 alpha is present\n- Location: src.txt:1 · Anchor: `alpha line`\n');

  // ---- draft ----
  const d = node([co, 'handoff', 'draft', '--run', 'runs/r1', '--base', base]);
  const skeleton = d.stdout;
  check('draft exits 0', d.status === 0);
  check('draft stamps Verified-at with HEAD', skeleton.includes(`Verified-at: ${head}`));
  check('draft records the base..HEAD range', skeleton.includes(`${base}..${head}, 1 commit(s)`));
  check('draft lists the dirty run folder', /- Dirty: `\?\? runs\/`/.test(skeleton));
  check('draft maps unchecked TASKS.md lines verbatim', skeleton.includes(agentItem) && skeleton.includes(operatorItem));
  check('draft omits checked TASKS.md lines', !skeleton.includes('Alpha audit'));
  check('draft stamps each artifact', skeleton.includes(`\`runs/r1/FINDINGS_REGISTER.md\` · Verified-at: ${head}`));

  const handoff = join(run, 'HANDOFF.md');
  writeFileSync(handoff, skeleton);
  const unfilled = node([checker, handoff, '--root', tmp]);
  check('unfilled skeleton fails check-handoff', unfilled.status === 1);
  check('unfilled skeleton fails on the empty Request line', unfilled.stderr.includes('no non-empty "Request:" line'));
  check('unfilled skeleton fails on the unlabelled finding', unfilled.stderr.includes('Key findings entry carries no confidence label'));

  // ---- resume on a good handoff ----
  // The writer adds the Program section and keeps the durable ledger beside the run folders,
  // because the draft carries no program lineage of its own.
  const programDir = join(tmp, 'runs', 'programs', 'p1');
  mkdirSync(programDir, { recursive: true });
  writeFileSync(join(programDir, 'PROGRAM.md'), ['# PROGRAM: p1', '', '## Program goal', '', 'Keep alpha and rewrite beta.', '',
    '## Request history', '', '- 2026-09-23: keep alpha and rewrite beta.', '', '## Scope documents', '',
    '- `src.txt` · Status: current · Role: the file under change', '', '## Decisions ledger', '', '- 2026-09-23: alpha stays.', '',
    '## Closed items', '', '- OI-0 alpha audit: closed-with-proof in the fixture', ''].join('\n'));
  const filled = skeleton
    .replace(/^(Verified-at:[^\n]*\n)/m, '$1\n## Program\n\nProgram: runs/programs/p1/PROGRAM.md\nPredecessor: none\n')
    .replace(/^Request:\n\[FILL:[^\n]*\]/m, 'Request: keep alpha and rewrite beta.')
    .replace(/^- \[FILL: one line per finding[^\n]*$/m, '- CONFIRMED: alpha is on line 1. Pointer: runs/r1/FINDINGS_REGISTER.md')
    .replace(/^\[FILL: the done-against[^\n]*$/m, '- Alpha kept. Pointer: src.txt:1 · Anchor: `alpha line`')
    .replace(/^\[FILL:[^\n]*\]$/gm, 'Recorded in the fixture.');
  writeFileSync(handoff, filled);
  const good = node([co, 'handoff', 'resume', handoff, '--root', tmp]);
  check('resume passes on a good handoff', good.status === 0);
  check('resume revalidates the named register', /ok register `?runs\/r1\/FINDINGS_REGISTER\.md/.test(good.stdout));
  check('resume counts anchors by status', good.stdout.includes('anchors: FRESH 1'));
  check('resume writes HANDOFF.consumed', existsSync(join(run, 'HANDOFF.consumed')));
  const blocked = good.stdout.indexOf('Blocked on operator:');
  check('operator items print first', blocked >= 0 && blocked < good.stdout.indexOf(operatorItem)
    && good.stdout.indexOf(operatorItem) < good.stdout.indexOf('Agent-owned:')
    && good.stdout.indexOf('Agent-owned:') < good.stdout.indexOf(agentItem));

  // ---- resume refuses to consume a drifted anchor ----
  rmSync(join(run, 'HANDOFF.consumed'));
  writeFileSync(join(tmp, 'src.txt'), 'omega line\nbeta line\ngamma line\n');
  const drifted = node([co, 'handoff', 'resume', handoff, '--root', tmp]);
  check('resume fails on a drifted anchor', drifted.status === 1);
  check('resume names the drifted pointer', /DRIFTED src\.txt:1/.test(drifted.stdout));
  check('resume does not write HANDOFF.consumed on failure', !existsSync(join(run, 'HANDOFF.consumed')));
  check('resume reports it did not consume', drifted.stdout.includes('not consumed'));

  // ---- draft on a large dirty tree stays under the 8 KB handoff cap ----
  // 190 tracked files with long names, 150 of them derived (host dists and vendored scripts);
  // the earlier src.txt edit and the untracked runs/ folder bring the non-derived count to 42.
  const dirs = { 'opencode-dist/skills': 60, '.agents/plugins': 30, 'plugins/code-ops-suite/scripts': 60, 'scripts': 25, 'evals/case': 15 };
  const tracked = [];
  for (const [dir, n] of Object.entries(dirs)) {
    mkdirSync(join(tmp, dir), { recursive: true });
    for (let i = 0; i < n; i++) {
      const path = `${dir}/a-deliberately-long-file-name-for-the-cap-${String(i).padStart(3, '0')}.mjs`;
      writeFileSync(join(tmp, path), 'one\n');
      tracked.push(path);
    }
  }
  gitIn('add', '--', ...Object.keys(dirs));
  gitIn('commit', '-q', '-m', 'wide');
  for (const path of tracked) writeFileSync(join(tmp, path), 'two\n');
  const wide = node([co, 'handoff', 'draft', '--run', 'runs/r1']);
  const bytes = Buffer.byteLength(wide.stdout);
  check(`large dirty draft exits 0 and stays under 8 KB (${bytes} B)`, wide.status === 0 && bytes < 8 * 1024);
  check('large dirty draft counts paths per top-level directory',
    wide.stdout.includes('`.agents/` 30') && wide.stdout.includes('`opencode-dist/` 60') && wide.stdout.includes('`plugins/` 60') && wide.stdout.includes('`scripts/` 25'));
  check('large dirty draft omits derived paths', !/- Dirty: `[^`]*(opencode-dist|\.agents|plugins\/code-ops-suite\/scripts)\//.test(wide.stdout)
    && wide.stdout.includes('Derived dirty paths not listed: 150'));
  const listedLines = wide.stdout.split('\n').filter((l) => l.startsWith('- Dirty: `'));
  check('large dirty draft lists at most 20 paths and a +N more line',
    listedLines.length === 20 && wide.stdout.includes('- +22 more non-derived dirty path(s)'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fails.length) { console.error(`\n${fails.length} assertion(s) failed`); process.exit(1); }
console.log('\nhandoff-state eval: all assertions pass');
