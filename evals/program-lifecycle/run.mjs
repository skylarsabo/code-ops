#!/usr/bin/env node
// Regression eval for scripts/program-lifecycle.mjs (`co decide promote`, `co program close`). On
// scratch git repositories it asserts that promote writes the record body and its intake line,
// sets the ledger disposition to the printed record id, and renders the register; that it refuses a
// grammar-1 ledger, an unknown DEC, and a DEC already promoted or dropped, and that a records
// refusal leaves the ledger, the intake, and the index as they were. It also asserts that close writes
// CLOSEOUT.md, `Status: closed`, and the INDEX.md line, and that it refuses, naming the ids, on a
// pending decision, an open item not forwarded to an operator, an unconsumed handoff, and a
// promoted id not sealed on the base branch.
// The close cases read each promoted id's seal state through scripts/promotion-lib.mjs.
// Every fixture lives in an OS temp dir, so nothing writes under the repository.
//
//   node evals/program-lifecycle/run.mjs   (exit 0 = all assertions pass)

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const co = join(REPO, 'scripts', 'co.mjs');
const records = join(REPO, 'scripts', 'records.mjs');
const { fails, check } = tally();
const tmp = mkdtempSync(join(tmpdir(), 'program-lifecycle-'));

const git = (cwd, ...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=eval', '-c', 'user.email=eval@example.com', ...args],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const run = (cwd, ...args) => {
  const r = spawnSync(process.execPath, [co, ...args, '--root', cwd], { cwd, encoding: 'utf8' });
  return { status: r.status, all: `${r.stdout}${r.stderr}` };
};
const put = (repo, path, text) => { const f = join(repo, path); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, text); };
const read = (repo, path) => (existsSync(join(repo, path)) ? readFileSync(join(repo, path), 'utf8') : '');
const LEDGER = 'hub/80 Runs/programs/demo/PROGRAM.md';
const CLOSEOUT = 'hub/80 Runs/programs/demo/CLOSEOUT.md';
const INDEX = 'hub/80 Runs/INDEX.md';
const REGISTER = 'hub/20 Decisions/REGISTER.md';
const STATE = 'hub/98 System/Records/state.json';

const ledger = ({ grammar = 2, open = [], decisions = [], closed = [] } = {}) => [
  '# PROGRAM: demo', '', ...(grammar === 2 ? ['Grammar: 2', ''] : []), '## Program goal', '', 'Ship the demo program.', '',
  '## Request history', '', '- 2026-09-29 first request', '', '## Scope documents', '', '## Open items', '', ...open, '',
  '## Decisions ledger', '', ...decisions, '', '## Closed items', '', ...closed, '',
].join('\n');
const dec = (n, disposition, hop = 2) => `- DEC-${n} 2026-09-29 Records use one file each · Rejected: one file with anchors · Hop: ${hop} · Disposition: ${disposition}`;

// A git repository with a v3 manifest and an adopted `decisions` collection, on main.
function recordsRepo(name) {
  const repo = join(tmp, name);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  put(repo, 'hub/Standard.md', '---\nstandard-version: 5\n---\n# Standard\n');
  put(repo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify({
    version: 3, hub: 'hub', runs: { tracking: 'ignored', retain: 5 }, domains: [{ id: 'decisions' }], legacyPaths: [],
    recordCollections: [{
      collectionUuid: '33333333-3333-4333-8333-333333333333', id: 'decisions', identityVersion: 1, root: 'decisions',
      inventory: '98 System/Records/inventory.json', citations: '98 System/Records/citations.json',
      curationLedger: '98 System/Records/curation.jsonl', index: '98 System/Records/index.md',
      scopes: [{ pattern: '*.md', kind: 'record', policy: 'append-only' }],
    }],
  }, null, 2)}\n`);
  put(repo, 'decisions/seed.md', '# Seed\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  appendFileSync(join(repo, '.git', 'info', 'exclude'), 'adoption-review.json\nhub/80 Runs/\n');
  const step = (...args) => execFileSync(process.execPath, [records, ...args, '--root', repo, '--collection', 'decisions'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  step('plan-adoption', '--out', 'adoption-review.json');
  step('adopt', '--review', 'adoption-review.json');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'adopt');
  return repo;
}

// A git repository whose main holds the register and a state.json listing REC-SEALED.
function baseRepo(name, { sealed = true } = {}) {
  const repo = join(tmp, name);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  put(repo, 'hub/98 System/DOCS_MANIFEST.json', '{"version":3,"hub":"hub"}\n');
  put(repo, REGISTER, '# Decision register\n\n| Id | Decides |\n| --- | --- |\n| REC-SEALED | Records use one file each |\n');
  put(repo, STATE, `${JSON.stringify({ version: 1, records: [{ id: 'REC-SEALED', status: 'in-force', pendingSeal: sealed ? null : 'INT-0' }] })}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  appendFileSync(join(repo, '.git', 'info', 'exclude'), 'hub/80 Runs/\n');
  return repo;
}

const CLOSABLE = ledger({
  open: ['- [ ] OI-5 Confirm the rollout · Owner: operator · Done when: operator replies · Pointer: `a.md:1` · Anchor: `x` · Forwarded-to: next/OI-1'],
  decisions: [dec(1, 'promoted:REC-SEALED'), dec(2, 'local'), dec(3, 'dropped')],
  closed: ['- [x] OI-1 Ship it · Owner: agent · Done when: shipped · Pointer: `b.md:2` · Anchor: `y`'],
});

try {
  // ---- promote ----
  const p = recordsRepo('promote');
  put(p, LEDGER, ledger({ decisions: [dec(1, 'pending'), dec(2, 'local'), dec(3, 'dropped'), dec(4, 'promoted:REC-OLD')] }));
  const before = read(p, LEDGER);

  let r = run(p, 'decide', 'promote', 'DEC-1', '--program', 'demo');
  const after = read(p, LEDGER);
  const recordId = /Disposition: promoted:(REC-[A-Z2-7]{26})/.exec(after)?.[1];
  const intake = read(p, 'hub/98 System/Records/intake.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const body = read(p, 'hub/98 System/Records/intake/decisions/demo-dec-1.md');
  check('promote exits 0 and prints the record id', r.status === 0 && Boolean(recordId) && r.all.includes(recordId), r.all);
  check('promote sets the ledger disposition and leaves the other lines', after.split('\n').filter((l) => !l.startsWith('- DEC-1')).join('\n')
    === before.split('\n').filter((l) => !l.startsWith('- DEC-1')).join('\n') && /^- DEC-1 .*Hop: 2 · Disposition: promoted:REC-/m.test(after), after);
  check('promote writes one record intake line naming the record id', intake.length === 1 && intake[0].type === 'record'
    && intake[0].recordId === recordId && intake[0].intakePath.endsWith('/decisions/demo-dec-1.md'), JSON.stringify(intake));
  check('promote writes a decision body with decides, topic, key, and source', /^kind: decision$/m.test(body) && /^decides: "Records use one file each"$/m.test(body)
    && /^topic: "demo"$/m.test(body) && /^key: decisions\/demo-dec-1$/m.test(body) && /^source: "program demo hop 2, DEC-1"$/m.test(body), body);
  check('promote stages the body in git', git(p, 'diff', '--cached', '--name-only').includes('demo-dec-1.md'));
  const register = read(p, REGISTER);
  const state = JSON.parse(read(p, STATE) || '{"records":[]}');
  check('promote renders the register and state with the pending record', register.includes('Records use one file each') && register.includes('pending seal')
    && state.records.some((x) => x.kind === 'decision' && x.pendingSeal), register);

  r = run(p, 'decide', 'promote', 'DEC-2', '--program', 'demo', '--topic', 'records', '--key', 'decisions/local-rule');
  check('promote takes a local decision and honors --topic and --key', r.status === 0 && /^- DEC-2 .*Disposition: promoted:REC-/m.test(read(p, LEDGER))
    && /^key: decisions\/local-rule$/m.test(read(p, 'hub/98 System/Records/intake/decisions/demo-dec-2.md')), r.all);

  const settled = read(p, LEDGER);
  const intakeBefore = read(p, 'hub/98 System/Records/intake.jsonl');
  const refuse = (name, args, expected, ledgerText = settled) => {
    const out = run(p, ...args);
    check(name, out.status === 1 && out.all.includes(expected) && read(p, LEDGER) === ledgerText
      && read(p, 'hub/98 System/Records/intake.jsonl') === intakeBefore && !git(p, 'diff', '--cached', '--name-only').includes('demo-dec-5')
      && !existsSync(join(p, 'hub/98 System/Records/intake/decisions/demo-dec-5.md')), out.all);
  };
  refuse('promote refuses a decision already promoted', ['decide', 'promote', 'DEC-1', '--program', 'demo'], 'only pending or local promote');
  refuse('promote refuses a dropped decision', ['decide', 'promote', 'DEC-3', '--program', 'demo'], 'only pending or local promote');
  refuse('promote refuses an unknown decision', ['decide', 'promote', 'DEC-99', '--program', 'demo'], 'no such entry');
  put(p, LEDGER, ledger({ grammar: 1, decisions: [dec(1, 'pending')] }));
  const grammar1 = read(p, LEDGER);
  refuse('promote refuses a ledger with no Grammar: 2 line', ['decide', 'promote', 'DEC-1', '--program', 'demo'], 'Grammar: 2', grammar1);
  put(p, LEDGER, ledger({ decisions: [dec(5, 'pending')] }));
  const bad = read(p, LEDGER);
  refuse('promote refuses when records intake refuses, and leaves no staged or written body', ['decide', 'promote', 'DEC-5', '--program', 'demo', '--key', 'nodomain/rule'],
    'promote DEC-5 failed at records intake', bad);

  // ---- close ----
  const c = baseRepo('close');
  put(c, LEDGER, CLOSABLE);
  put(c, INDEX, '# Runs index\n\n- [other](programs/other/PROGRAM.md) · closed 2026-09-01\n- [demo](programs/demo/PROGRAM.md) · open\n');
  put(c, 'hub/80 Runs/2026-09-28-demo/HANDOFF.md', '# Handoff\n\n## Program\n\nProgram: hub/80 Runs/programs/demo/PROGRAM.md\n');
  put(c, 'hub/80 Runs/2026-09-28-demo/HANDOFF.consumed', '2026-09-28T00:00:00Z\n');
  put(c, 'hub/80 Runs/2026-09-28-other/HANDOFF.md', '# Handoff\n\n## Program\n\nProgram: hub/80 Runs/programs/other/PROGRAM.md\n');
  r = run(c, 'program', 'close', 'demo');
  const closeout = read(c, CLOSEOUT);
  const closed = read(c, LEDGER);
  const index = read(c, INDEX);
  check('close exits 0 and writes CLOSEOUT.md', r.status === 0 && existsSync(join(c, CLOSEOUT)), r.all);
  check('close writes CLOSEOUT.md with goal, outcome, range, counts', closeout.includes('Ship the demo program.') && closeout.includes('## Outcome')
    && closeout.includes('## Revision range') && closeout.includes('- Closed items: 1') && closeout.includes('- Local decisions: 1'), closeout);
  check('close links each promoted decision to its register line', /- DEC-1: REC-SEALED at \[REGISTER\.md\]\([^)]*20%20Decisions\/REGISTER\.md#L5\)/.test(closeout), closeout);
  check('close adds Status: closed under the goal heading', /## Program goal\n\nStatus: closed\n\nShip the demo program\./.test(closed), closed);
  check('close updates the index line in place and keeps the others', index.includes('[other](programs/other/PROGRAM.md)') && index.split('\n').filter((l) => l.includes('programs/demo/')).length === 1
    && index.includes('programs/demo/CLOSEOUT.md') && !index.includes('· open'), index);
  r = run(c, 'program', 'close', 'demo');
  check('close refuses a program already closed', r.status === 1 && r.all.includes('already "Status: closed"'), r.all);

  const c2 = baseRepo('close-new-index');
  put(c2, LEDGER, CLOSABLE);
  r = run(c2, 'program', 'close', 'demo');
  check('close creates INDEX.md with a line when none exists', r.status === 0 && /^# Runs index/.test(read(c2, INDEX)) && read(c2, INDEX).includes('programs/demo/CLOSEOUT.md'), r.all);

  const refuseClose = (name, repo, text, expected, notExpected = []) => {
    put(repo, LEDGER, text);
    const out = run(repo, 'program', 'close', 'demo');
    check(name, out.status === 1 && expected.every((e) => out.all.includes(e)) && notExpected.every((n) => !out.all.includes(n))
      && !existsSync(join(repo, CLOSEOUT)) && !/Status: closed/.test(read(repo, LEDGER)), out.all);
  };
  const r1 = baseRepo('close-pending');
  refuseClose('close refuses a pending decision and names its id', r1, ledger({ decisions: [dec(1, 'promoted:REC-SEALED'), dec(7, 'pending')] }), ['pending decision', 'DEC-7'], ['DEC-1,']);
  const r2 = baseRepo('close-open');
  refuseClose('close refuses open items not forwarded to an operator and names them', r2, ledger({
    open: ['- [ ] OI-7 Loose end · Owner: operator · Done when: x · Pointer: `a.md:1` · Anchor: `x`',
      '- [ ] OI-8 Agent work · Owner: agent · Done when: x · Pointer: `a.md:1` · Anchor: `x` · Forwarded-to: next/OI-1',
      '- [ ] OI-9 Handed over · Owner: operator · Done when: x · Pointer: `a.md:1` · Anchor: `x` · Forwarded-to: next/OI-2'],
    decisions: [dec(1, 'promoted:REC-SEALED')],
  }), ['OI-7', 'OI-8'], ['OI-9']);
  const r3 = baseRepo('close-handoff');
  put(r3, 'hub/80 Runs/2026-09-28-demo/HANDOFF.md', '# Handoff\n\n## Program\n\nProgram: hub/80 Runs/programs/demo/PROGRAM.md\n');
  put(r3, 'hub/80 Runs/2026-09-27-demo/HANDOFF.md', '# Handoff\n\n## Program\n\nProgram: hub/80 Runs/programs/demo/PROGRAM.md\n');
  put(r3, 'hub/80 Runs/2026-09-27-demo/HANDOFF.consumed', '2026-09-27T00:00:00Z\n');
  refuseClose('close refuses an unconsumed handoff and names it', r3, CLOSABLE, ['unconsumed handoff', '2026-09-28-demo/HANDOFF.md'], ['2026-09-27-demo']);
  const r4 = baseRepo('close-unsealed', { sealed: false });
  git(r4, 'checkout', '-q', '-b', 'feat');
  put(r4, STATE, `${JSON.stringify({ version: 1, records: [{ id: 'REC-SEALED', status: 'in-force', pendingSeal: null }] })}\n`);
  git(r4, 'commit', '-qam', 'seal on the branch only');
  refuseClose('close refuses a promoted id sealed only off the base branch', r4, CLOSABLE, ['not sealed on main', 'DEC-1 (REC-SEALED)']);
  const r5 = baseRepo('close-unknown');
  refuseClose('close refuses a promoted id the base does not know', r5, ledger({ decisions: [dec(1, 'promoted:REC-MISSING')] }), ['not sealed on main', 'REC-MISSING']);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} program-lifecycle case(s) failed`);
  process.exit(1);
}
console.log('\nprogram-lifecycle: all cases passed');
