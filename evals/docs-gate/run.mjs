#!/usr/bin/env node
// Docs gate regression eval (scripts/docs-gate.mjs, `co docs gate`).
//
// Each case builds on a fixture repository: a manifest v2 hub that conforms to the docs manifest and
// the vault standard, so any violation a case sees is the one the case put there. The cases pin:
//   - the step order the gate prints, with steps 4, 6, and 7 named as not run;
//   - a v2 repository passing, and a repository with no manifest exiting 0 with a skip line;
//   - the ratchet: no baseline fails and names --baseline-init, init writes sorted lines, a
//     baselined violation passes, a new violation fails, a second init refuses (the baseline never
//     grows), a fixed line is removed at the next run, and --check never writes;
//   - a tracked grammar 2 ledger failing check 11 blocks, and an untracked ledger with a promoted
//     id only warns UNLANDED;
//   - `co docs gate` reaching the same script, and integrate-branch reading the manifest version.
//
// The stub guard: the suite runs against the real gate and then against two stub gates, one that
// always exits 0 and one that always exits 1. A case that passes both stubs asserts nothing, so it
// fails this eval.
//
//   node evals/docs-gate/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally, withDetail } from '../harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(ROOT, 'scripts');
const GATE = join(SCRIPTS, 'docs-gate.mjs');
const HUB = 'project-docs';
const BASELINE = join(HUB, '98 System', 'GATE_BASELINE.jsonl');
const work = mkdtempSync(join(tmpdir(), 'coh-docs-gate-'));
const { fails, check } = tally(withDetail);

const node = (args, cwd) => {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};
const git = (repo, ...args) => {
  const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', ...args], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
};
const put = (repo, rel, text) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};
const note = (title) => `---\ntype: note\nstatus: current\nupdated: 2026-09-29\n---\n\n# ${title}\n`;

// A manifest v2 hub that passes the docs manifest and the vault standard.
function buildRepo(name) {
  const repo = join(work, name);
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '--quiet', '-b', 'main');
  put(repo, '.gitignore', `${HUB}/80 Runs/\n`);
  put(repo, 'src/main.txt', 'source\n');
  put(repo, `${HUB}/Standard.md`, '---\ntype: standard\nstatus: current\nupdated: 2026-09-29\nstandard-version: 4\n---\n\n# Standard\n');
  put(repo, `${HUB}/00 Home.md`, note('Home'));
  put(repo, `${HUB}/README.md`, '# Fixture hub\n');
  for (const dir of ['00 Inbox', '90 Templates', '95 Attachments', '99 Archive']) put(repo, `${HUB}/${dir}/.gitkeep`, '');
  const required = ['architecture', 'contracts', 'data-model', 'engineering-standards', 'api-reference', 'ci-delivery', 'infrastructure', 'observability', 'design-system', 'guides', 'atlas'];
  for (const id of required) put(repo, `${HUB}/40 Engineering/${id}.md`, note(id));
  put(repo, `${HUB}/98 System/DOCS_MANIFEST.json`, `${JSON.stringify({
    version: 2, hub: HUB, runs: { tracking: 'ignored' }, recordCollections: [], legacyPaths: [],
    domains: required.map((id) => ({ id, path: `40 Engineering/${id}.md`, status: 'current', sources: ['src/**'], sourceDigest: '', contentDigest: '' })),
  }, null, 2)}\n`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'seed');
  const sync = node([join(SCRIPTS, 'docs-manifest.mjs'), 'sync', '--root', repo], repo);
  if (sync.status !== 0) throw new Error(`fixture manifest sync failed: ${sync.out}${sync.err}`);
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'stamp');
  return repo;
}

const GOOD = '- DEC-1 2026-09-29 Keep one ledger · Hop: 0 · Disposition: local';
const bad = (n) => `- DEC-${n} 2026-09-29 Decision ${n} · Hop: 0`;
const ledgerText = (decisions) => `# PROGRAM: alpha\n\nGrammar: 2\n\n## Program goal\n\nFixture program.\n\n## Decisions ledger\n\n${decisions.join('\n')}\n`;
const HANDOFF = '# HANDOFF: alpha\n\n## Program\n\nProgram: runs/programs/alpha/PROGRAM.md\nPredecessor: none\nSession: Alpha HO 1\nHop: 1\n';

// The whole suite against one gate script. Cases run in order and share one fixture.
function suite(gate, tag) {
  const results = [];
  const test = (name, ok) => results.push({ name, ok: Boolean(ok) });
  const repo = buildRepo(`${tag}-repo`);
  const gateRun = (args = [], root = repo) => node([gate, '--root', root, ...args], root);
  const baselineText = () => (existsSync(join(repo, BASELINE)) ? readFileSync(join(repo, BASELINE), 'utf8') : null);
  const baselineLines = () => (baselineText() ?? '').split('\n').filter(Boolean);
  const setLedger = (decisions) => put(repo, 'runs/programs/alpha/PROGRAM.md', ledgerText(decisions));

  let r = gateRun();
  test('a v2 repository passes', r.status === 0 && /docs gate: PASS/.test(r.out));
  const steps = [...r.out.matchAll(/^ {2}(\d) (.+)$/gm)];
  test('step order: 1 to 8 in order', steps.map((m) => m[1]).join('') === '12345678');
  test('steps 4, 6, and 7 are named as not run', /^ {2}4 .*not implemented/m.test(r.out) && /^ {2}6 .*skipped/m.test(r.out) && /^ {2}7 .*skipped/m.test(r.out));

  const bare = join(work, `${tag}-bare`);
  mkdirSync(bare, { recursive: true });
  git(bare, 'init', '--quiet', '-b', 'main');
  put(bare, 'file.txt', 'x\n');
  r = gateRun([], bare);
  test('a repository with no manifest exits 0 with a skip line', r.status === 0 && /docs gate: skipped/.test(r.out));

  put(repo, 'runs/programs/alpha/HANDOFF.md', HANDOFF);
  setLedger([GOOD]);
  git(repo, 'add', 'runs');
  r = gateRun();
  test('a tracked conformant ledger passes and is counted', r.status === 0 && /8 ledger checks 11-18 \(1 tracked program/.test(r.out));

  setLedger([bad(1), bad(3)]);
  r = gateRun();
  test('a tracked ledger failing check 11 blocks', r.status === 1 && /step 8: alpha: check 11: .*DEC-1/.test(r.err));
  test('a run with no baseline writes none and names --baseline-init', baselineText() === null && /--baseline-init/.test(r.out));

  r = gateRun(['--baseline-init', '--check']);
  test('--baseline-init with --check is a usage error', r.status === 2 && baselineText() === null);

  r = gateRun(['--baseline-init']);
  const lines = baselineLines();
  const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } });
  test('--baseline-init writes one JSON line per violation', r.status === 0 && lines.length === 2 && parsed.every((p) => p && p.step === 8 && /check 11/.test(p.key)));
  test('baseline lines are sorted and hold only step and key', lines.length === 2 && lines.join('\n') === [...lines].sort().join('\n') && parsed.every((p) => Object.keys(p).join() === 'step,key'));
  const seeded = baselineText();

  r = gateRun();
  test('a baselined violation passes and leaves the baseline alone', r.status === 0 && baselineText() === seeded);

  setLedger([bad(1), bad(2), bad(3)]);
  r = gateRun();
  test('a new violation fails and the baseline does not grow', r.status === 1 && /DEC-2/.test(r.err) && baselineText() === seeded);
  r = gateRun(['--baseline-init']);
  test('--baseline-init refuses when the baseline exists', r.status === 2 && baselineText() === seeded);

  setLedger([GOOD, bad(3)]);
  r = gateRun(['--check']);
  test('--check fails on a baseline line that is no longer live and writes nothing', r.status === 1 && /no longer live/.test(r.err) && baselineText() === seeded);
  r = gateRun();
  test('the next run removes the fixed line and keeps the live one', r.status === 0 && baselineLines().length === 1 && /DEC-3/.test(baselineText()));
  const shrunk = baselineText();
  r = gateRun(['--check']);
  test('--check passes on a shrunk baseline and writes nothing', r.status === 0 && baselineText() === shrunk);

  setLedger([GOOD]);
  r = gateRun();
  test('the last fixed line leaves the baseline empty', r.status === 0 && baselineText() === '');
  setLedger([bad(4)]);
  r = gateRun();
  test('a violation after the baseline emptied still fails', r.status === 1 && baselineText() === '');

  setLedger([GOOD]);
  put(repo, `${HUB}/80 Runs/programs/beta/PROGRAM.md`, ledgerText([bad(2), '- DEC-1 2026-09-29 Promote me · Hop: 0 · Disposition: promoted:rec-missing']));
  put(repo, `${HUB}/80 Runs/programs/gamma/PROGRAM.md`, ledgerText(['- DEC-1 2026-09-29 Staged · Hop: 0 · Disposition: promoted:rec-staged']));
  put(repo, `${HUB}/98 System/Records/intake.jsonl`, `${JSON.stringify({ type: 'record', recordId: 'rec-staged' })}\n`);
  r = gateRun();
  test('an untracked ledger with a promoted id only warns UNLANDED', r.status === 0
    && /warning: UNLANDED beta DEC-1 promoted:rec-missing/.test(r.out) && /warning: UNLANDED gamma DEC-1 promoted:rec-staged .*staged/.test(r.out));
  test('an untracked ledger gets no check but 14', r.status === 0 && /UNLANDED beta/.test(r.out) && !/check 11/.test(r.out + r.err) && !/step 8/.test(r.err));
  return results;
}

const passStub = join(work, 'stub-pass.mjs');
const failStub = join(work, 'stub-fail.mjs');
writeFileSync(passStub, 'process.exit(0);\n');
writeFileSync(failStub, 'process.exit(1);\n');

try {
  const real = suite(GATE, 'real');
  const pass = suite(passStub, 'pass');
  const fail = suite(failStub, 'fail');
  real.forEach((c, i) => {
    check(c.name, c.ok);
    check(`${c.name} (fails against a stub gate)`, pass[i].name === c.name && !(pass[i].ok && fail[i].ok), 'passes both the always-pass and the always-fail stub');
  });

  const facade = node([join(SCRIPTS, 'co.mjs'), 'docs', 'gate', '--root', join(work, 'real-repo')], ROOT);
  check('co docs gate reaches the gate', facade.status === 0 && /docs gate: PASS|docs gate: skipped/.test(facade.out) && /^ {2}1 docs-manifest check/m.test(facade.out), facade.out + facade.err);

  const integrate = await import(pathToFileURL(join(SCRIPTS, 'integrate-branch.mjs')).href);
  check('integrate-branch reads this repository manifest as v2, so the docs gate step skips', integrate.manifestVersion(ROOT) === 2);
  check('integrate-branch reads a v2 fixture manifest as 2', integrate.manifestVersion(join(work, 'real-repo')) === 2);
  check('integrate-branch reads no manifest as null', integrate.manifestVersion(join(work, 'real-bare')) === null);
} catch (error) {
  check('eval ran to completion', false, error.stack);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} docs gate check(s) failed:`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('\nOK: docs gate regression eval passed.');
