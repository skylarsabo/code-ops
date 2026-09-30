#!/usr/bin/env node
// Regression eval for scripts/burndown.mjs, the read-only convergence counter (finish line F4).
// Synthetic programs in a temp dir cover the one-line report: under the cap, over the cap, growing
// against the predecessor handoff, the missing `Blocks: F<n>` count, a grammar 2 ledger as the
// source of the active set, the newest run folder winning by number, the --json shape, the usage
// errors, and a run that changes no file (content and mtime).
//
//   node evals/burndown/run.mjs   (exit 0 = all assertions pass)

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally } from '../harness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(REPO, 'scripts', 'burndown.mjs');

const { fails, check } = tally();
const tmp = mkdtempSync(join(tmpdir(), 'burndown-'));
const runs = join(tmp, '80 Runs');
const cli = (...args) => spawnSync(process.execPath, [script, '--root', tmp, ...args], { encoding: 'utf8' });

const item = (n, blocks = 'F1') => `OI-${n} fixture item ${n} · Owner: agent · Done when: it lands${blocks ? ` · Blocks: ${blocks}` : ''}`;
const FINISH = ['## Finish line', '', '- F1 the first finish line item', '- F2 the second finish line item', ''];

// One program: a ledger, optional BACKLOG.md and archive, and run folders `ho<n>` (oldest first).
function program(slug, { grammar = 1, finish = true, open = [], closed = [], backlog = [], archived = [], hops = [] } = {}) {
  const dir = join(runs, 'programs', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'PROGRAM.md'), ['# PROGRAM: fixture', '', ...(grammar === 2 ? ['Grammar: 2', ''] : []),
    '## Program goal', '', 'Converge.', '', '## Request history', '', '- 2026-09-30: converge.', '', '## Decisions ledger', '',
    ...(grammar === 2 ? ['## Open items', '', ...open.map((l) => `- ${l}`), ''] : []),
    '## Closed items', '', ...closed.map((l) => `- ${l}`), '', ...(finish ? FINISH : [])].join('\n'));
  if (backlog.length) writeFileSync(join(dir, 'BACKLOG.md'), `# Backlog\n\n${backlog.map((l) => `- ${l}`).join('\n')}\n`);
  if (archived.length) writeFileSync(join(dir, 'PROGRAM.archive.md'), `# Archive\n\n## Closed items\n\n${archived.map((l) => `- ${l}`).join('\n')}\n`);
  for (const hop of hops) {
    const run = join(runs, `2026-09-30-${slug}-ho${hop.n}`);
    mkdirSync(run, { recursive: true });
    if (hop.tasks) writeFileSync(join(run, 'TASKS.md'), `# Tasks\n\n${hop.tasks.join('\n')}\n`);
    if (hop.handoffOpen) writeFileSync(join(run, 'HANDOFF.md'), ['# HANDOFF: fixture', '', '## Open items', '', ...hop.handoffOpen.map((l) => `- ${l}`), ''].join('\n'));
    if (hop.predecessor) writeFileSync(join(run, 'SESSION.json'), JSON.stringify({ v: 1, predecessor: hop.predecessor }));
  }
  return dir;
}
const tasks = (n, blocks = 'F1') => Array.from({ length: n }, (_, i) => `- [ ] ${item(i + 1, blocks)}`);
const lineOf = (r) => r.stdout.trim();

try {
  // ---- under the cap: no flag, a zero missing count ----
  program('under', { hops: [{ n: 1, tasks: tasks(3) }], closed: ['OI-90 done · closed by PR 1'], backlog: ['OI-91 later'] });
  const under = cli('--program', 'under');
  check('under cap: one exact line and exit 0', under.status === 0 && lineOf(under) === 'active 3/12, backlog 1, closed 1, missing Blocks 0');

  // ---- over the cap: 13 active ----
  program('over', { hops: [{ n: 1, tasks: tasks(13) }] });
  const over = cli('--program', 'over');
  check('over cap: 13 active prints OVER CAP and still exits 0', over.status === 0 && lineOf(over) === 'active 13/12, backlog 0, closed 0, missing Blocks 0 OVER CAP');
  program('at-cap', { hops: [{ n: 1, tasks: tasks(12) }] });
  check('over cap: exactly 12 active is not flagged', !/OVER CAP/.test(lineOf(cli('--program', 'at-cap'))));

  // ---- growing: active against the predecessor handoff open count ----
  const prior = [item(1), item(2)];
  program('grow', { hops: [{ n: 1, handoffOpen: prior }, { n: 2, tasks: tasks(3), predecessor: '80 Runs/2026-09-30-grow-ho1/HANDOFF.md' }] });
  check('growing: 3 active against a predecessor with 2 prints GROWING', lineOf(cli('--program', 'grow')).endsWith(' GROWING'));
  program('flat', { hops: [{ n: 1, handoffOpen: prior }, { n: 2, tasks: tasks(2), predecessor: '80 Runs/2026-09-30-flat-ho1/HANDOFF.md' }] });
  check('growing: 2 active against a predecessor with 2 is not flagged', !/GROWING/.test(lineOf(cli('--program', 'flat'))));
  program('first', { hops: [{ n: 1, tasks: tasks(5) }] });
  check('growing: a run with no predecessor is not flagged', !/GROWING/.test(lineOf(cli('--program', 'first'))));

  // ---- missing Blocks: counted with a Finish line, absent without one ----
  program('blocks', { hops: [{ n: 1, tasks: [`- [ ] ${item(1, 'F1')}`, `- [ ] ${item(2, null)}`, `- [ ] ${item(3, null)}`, `- [x] ${item(4, null)}`] }] });
  check('missing Blocks: two unblocked active items count, a checked one does not', lineOf(cli('--program', 'blocks')) === 'active 3/12, backlog 0, closed 0, missing Blocks 2');
  program('no-finish', { finish: false, hops: [{ n: 1, tasks: tasks(2, null) }] });
  const noFinish = cli('--program', 'no-finish');
  check('missing Blocks: no Finish line omits the count', lineOf(noFinish) === 'active 2/12, backlog 0, closed 0');

  // ---- grammar 2: the ledger's Open items are the active set ----
  program('g2', {
    grammar: 2, open: [item(1), item(2), item(3), item(4, null)], closed: ['OI-90 done'], archived: ['OI-91 older', 'OI-92 oldest'], backlog: ['OI-95 a', 'OI-96 b'],
    hops: [{ n: 1, tasks: tasks(1) }],
  });
  const g2 = cli('--program', 'g2', '--json');
  const g2Json = JSON.parse(g2.stdout || '{}');
  check('grammar 2: the ledger Open items, not TASKS.md, give the active count', g2Json.source === 'ledger' && g2Json.active === 4);
  check('grammar 2: closed counts the ledger and its archive, backlog counts BACKLOG.md', g2Json.closed === 3 && g2Json.backlog === 2);
  check('grammar 2: the ledger open item without Blocks is counted', g2Json.missingBlocks === 1);

  // ---- the newest run folder wins by hop number, not by string order ----
  program('order', { hops: [{ n: 9, tasks: tasks(1) }, { n: 10, tasks: tasks(2) }] });
  check('newest run: ho10 wins over ho9', lineOf(cli('--program', 'order')).startsWith('active 2/12'));
  check('default program: the newest run folder names it', lineOf(cli()) !== '' && JSON.parse(cli('--json').stdout || '{}').program !== undefined);
  check('--run pins the run folder', lineOf(cli('--program', 'order', '--run', '80 Runs/2026-09-30-order-ho9')).startsWith('active 1/12'));

  // ---- --json shape ----
  const json = JSON.parse(cli('--program', 'grow', '--json').stdout || '{}');
  const KEYS = ['program', 'ledger', 'run', 'source', 'active', 'cap', 'backlog', 'closed', 'predecessor', 'finishLine', 'missingBlocks', 'overCap', 'growing'];
  check('--json: the same fields as the line, with stable keys', Object.keys(json).join() === KEYS.join()
    && json.active === 3 && json.cap === 12 && json.predecessor === 2 && json.growing === true && json.overCap === false && json.finishLine === true && json.source === 'tasks');
  check('--json: paths are root-relative with forward slashes', json.ledger === '80 Runs/programs/grow/PROGRAM.md' && json.run === '80 Runs/2026-09-30-grow-ho2');

  // ---- usage errors exit 2; nothing else does ----
  check('usage: an unknown program exits 2', cli('--program', 'nope').status === 2);
  check('usage: an unknown flag exits 2', cli('--bogus').status === 2);
  check('usage: a --run that is not a directory exits 2', cli('--program', 'under', '--run', 'missing').status === 2);

  // ---- the library export ----
  const lib = await import(pathToFileURL(script).href);
  const direct = lib.burndown({ program: 'over', root: tmp });
  check('library: burndown() returns the fields and formatLine() the line', direct.active === 13 && direct.overCap === true && lib.formatLine(direct).includes('OVER CAP'));

  // ---- read-only: no file changes content or mtime, and none appears ----
  const snapshot = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => {
    const file = join(e.parentPath ?? e.path, e.name);
    return `${file}|${statSync(file).mtimeMs}|${readFileSync(file, 'utf8').length}`;
  }).sort().join('\n');
  const before = snapshot(tmp);
  for (const args of [['--program', 'g2'], ['--program', 'grow', '--json'], []]) cli(...args);
  check('read-only: no file changed or appeared', snapshot(tmp) === before);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} burndown check(s) failed:\n  - ${fails.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nburndown: all assertions pass');
