#!/usr/bin/env node
// Regression eval for the local SHA-bound deep-review and OpSec gate.

import { execFileSync } from 'node:child_process';
import { linkSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { samePhysicalFile } from '../../scripts/context-index-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'local-review-gate.mjs');
const GIT_CONFIG = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
const fails = [];

function check(name, condition, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 240)}` : ''}`);
}

function run(args, cwd) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 }), stderr: '' };
  } catch (error) {
    return { status: error.status ?? 1, stdout: String(error.stdout || ''), stderr: String(error.stderr || '') };
  }
}

function git(cwd, args) {
  return execFileSync('git', [...GIT_CONFIG, ...args], { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024 }).trim();
}

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'local-review-gate-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'eval@example.invalid']);
  git(root, ['config', 'user.name', 'Local Review Eval']);
  writeFileSync(join(root, '.gitignore'), 'run/\n');
  writeFileSync(join(root, 'one.txt'), 'base\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  git(root, ['switch', '-c', 'feature']);
  writeFileSync(join(root, 'one.txt'), 'feature\n');
  git(root, ['add', 'one.txt']);
  git(root, ['commit', '-m', 'feature']);
  return root;
}

function paths(root, suffix = '') {
  const folder = `run/review${suffix}`;
  mkdirSync(join(root, folder), { recursive: true });
  return {
    folder,
    plan: `${folder}/plan.json`,
    receipts: `${folder}/receipts.jsonl`,
    deep: `${folder}/deep.md`,
    opsec: `${folder}/opsec.md`,
  };
}

function prepare(root, p, base = 'main') {
  return run(['prepare', '--root', root, '--base', base, '--out', p.plan, '--receipts', p.receipts], root);
}

function record(root, p, gate, report, blocking = '0', confirmed = '0', verdict = 'PASS', reviewer = 'reviewer@strong-model') {
  return run(['record', '--root', root, '--plan', p.plan, '--gate', gate, '--verdict', verdict,
    '--report', report, '--reviewer', reviewer, '--tier', 'strong', '--effort', 'high',
    '--blocking', blocking, '--confirmed', confirmed], root);
}

const roots = [];
try {
  const root = repo(); roots.push(root);
  const p = paths(root);
  const made = prepare(root, p);
  check('prepare binds a clean committed feature diff', made.status === 0, made.stderr);
  const plan = JSON.parse(readFileSync(join(root, p.plan), 'utf8'));
  check('plan carries sorted paths and distinct base/head/diff digests', plan.changedPaths.join(',') === 'one.txt'
    && plan.baseSha !== plan.headSha && /^[0-9a-f]{64}$/.test(plan.diffSha256) && /^[0-9a-f]{64}$/.test(plan.planSha256));

  writeFileSync(join(root, p.deep), '# Local deep review\n\nPASS: no confirmed blockers.\n');
  writeFileSync(join(root, p.opsec), '# Local OpSec review\n\nPASS: no privacy regressions.\n');
  const deepIdentity = statSync(join(root, p.deep), { bigint: true });
  const opsecIdentity = statSync(join(root, p.opsec), { bigint: true });
  check('compares distinct report identities without integer precision loss',
    typeof deepIdentity.dev === 'bigint' && typeof deepIdentity.ino === 'bigint'
    && typeof opsecIdentity.dev === 'bigint' && typeof opsecIdentity.ino === 'bigint'
    && !samePhysicalFile(join(root, p.deep), join(root, p.opsec)));
  const deep = record(root, p, 'local-deep-review', p.deep, '0', '0', 'PASS', 'deep-reviewer@strong-model');
  const opsec = record(root, p, 'local-opsec-gate', p.opsec, '0', '0', 'PASS', 'opsec-reviewer@strong-model');
  check('records both strong high-effort review reports', deep.status === 0 && opsec.status === 0, `${deep.stderr}\n${opsec.stderr}`);
  const valid = run(['check', '--root', root, '--plan', p.plan, '--json'], root);
  const summary = valid.status === 0 ? JSON.parse(valid.stdout) : null;
  check('replays exact PASS coverage and report bindings', valid.status === 0 && Object.keys(summary.gates).sort().join(',') === 'local-deep-review,local-opsec-gate', valid.stderr);

  const dry = run(['publish', '--root', root, '--plan', p.plan, '--repo', 'owner/repo', '--dry-run'], root);
  const published = dry.status === 0 ? JSON.parse(dry.stdout) : null;
  check('dry-run publishes only exact SHA-bound success contexts', dry.status === 0
    && published.headSha === plan.headSha
    && published.statuses.map((entry) => entry.context).sort().join(',') === 'local-deep-review,local-opsec-gate'
    && published.statuses.every((entry) => entry.state === 'success' && entry.target_url.endsWith(plan.headSha)), dry.stderr);

  git(root, ['update-index', '--skip-worktree', 'one.txt']);
  writeFileSync(join(root, 'one.txt'), 'hidden skip-worktree drift\n');
  const skippedPrepare = prepare(root, paths(root, '-hidden-skip'));
  const skippedRecord = record(root, p, 'local-deep-review', p.deep);
  const skippedCheck = run(['check', '--root', root, '--plan', p.plan], root);
  check('skip-worktree state blocks prepare', skippedPrepare.status !== 0 && skippedPrepare.stderr.includes('ambiguous Git index'), skippedPrepare.stderr);
  check('skip-worktree state blocks record', skippedRecord.status !== 0 && skippedRecord.stderr.includes('ambiguous Git index'), skippedRecord.stderr);
  check('skip-worktree state blocks check', skippedCheck.status !== 0 && skippedCheck.stderr.includes('ambiguous Git index'), skippedCheck.stderr);
  git(root, ['update-index', '--no-skip-worktree', 'one.txt']);
  git(root, ['checkout', '--', 'one.txt']);

  git(root, ['update-index', '--assume-unchanged', 'one.txt']);
  writeFileSync(join(root, 'one.txt'), 'hidden assume-unchanged drift\n');
  const assumedPrepare = prepare(root, paths(root, '-hidden-assume'));
  const assumedCheck = run(['check', '--root', root, '--plan', p.plan], root);
  check('assume-unchanged state blocks prepare', assumedPrepare.status !== 0 && assumedPrepare.stderr.includes('ambiguous Git index'), assumedPrepare.stderr);
  check('assume-unchanged state blocks check', assumedCheck.status !== 0 && assumedCheck.stderr.includes('ambiguous Git index'), assumedCheck.stderr);
  git(root, ['update-index', '--no-assume-unchanged', 'one.txt']);
  git(root, ['checkout', '--', 'one.txt']);

  const duplicate = record(root, p, 'local-deep-review', p.deep);
  check('rejects duplicate gate coverage', duplicate.status !== 0 && duplicate.stderr.includes('already exists'), duplicate.stderr);

  const originalReport = readFileSync(join(root, p.deep));
  writeFileSync(join(root, p.deep), '# changed after review\n');
  const reportDrift = run(['check', '--root', root, '--plan', p.plan], root);
  check('rejects report drift', reportDrift.status !== 0 && reportDrift.stderr.includes('report drift'), reportDrift.stderr);
  writeFileSync(join(root, p.deep), originalReport);

  const originalReceipts = readFileSync(join(root, p.receipts), 'utf8');
  const forged = originalReceipts.replace('"sequence":2', '"sequence":3');
  writeFileSync(join(root, p.receipts), forged);
  const chainDrift = run(['check', '--root', root, '--plan', p.plan], root);
  check('rejects forged receipt-chain content', chainDrift.status !== 0 && /digest|sequence/.test(chainDrift.stderr), chainDrift.stderr);
  writeFileSync(join(root, p.receipts), originalReceipts);

  writeFileSync(join(root, 'dirty.txt'), 'uncommitted\n');
  const dirty = run(['check', '--root', root, '--plan', p.plan], root);
  check('rejects dirty tracked or untracked state', dirty.status !== 0 && dirty.stderr.includes('worktree changes'), dirty.stderr);
  rmSync(join(root, 'dirty.txt'));

  writeFileSync(join(root, 'two.txt'), 'next\n');
  git(root, ['add', 'two.txt']); git(root, ['commit', '-m', 'next']);
  const headDrift = run(['check', '--root', root, '--plan', p.plan], root);
  check('rejects a new HEAD commit', headDrift.status !== 0 && headDrift.stderr.includes('changed'), headDrift.stderr);

  const root2 = repo(); roots.push(root2);
  const p2 = paths(root2, '-blocking');
  const portableAlias = run(['prepare', '--root', root2, '--base', 'main', '--out', 'run/alias/Plan.json', '--receipts', 'run/alias/plan.json'], root2);
  check('refuses case-folded plan and receipt aliases', portableAlias.status !== 0 && portableAlias.stderr.includes('differ portably'), portableAlias.stderr);
  const expressionBase = run(['prepare', '--root', root2, '--base', 'HEAD~1', '--out', 'run/expression/plan.json', '--receipts', 'run/expression/receipts.jsonl'], root2);
  check('refuses revision expressions as review bases', expressionBase.status !== 0 && expressionBase.stderr.includes('named local or remote branch'), expressionBase.stderr);
  const wrongOutput = run(['prepare', '--root', root2, '--base', 'main', '--out', 'plan.json', '--receipts', p2.receipts], root2);
  check('refuses generated authority outside ignored run space', wrongOutput.status !== 0 && wrongOutput.stderr.includes('ignored by Git') && !readFileSync(join(root2, '.gitignore'), 'utf8').includes('plan.json'), wrongOutput.stderr);
  check('refused prepare leaves no plan output', !(() => { try { readFileSync(join(root2, 'plan.json')); return true; } catch { return false; } })());
  check('second prepare succeeds', prepare(root2, p2).status === 0);
  writeFileSync(join(root2, p2.deep), '# Review\n');
  const falsePass = record(root2, p2, 'local-deep-review', p2.deep, '1', '1', 'PASS');
  check('PASS cannot carry blocking findings', falsePass.status !== 0 && falsePass.stderr.includes('PASS requires zero'), falsePass.stderr);
  check('rejected record leaves no receipt chain', !(() => { try { readFileSync(join(root2, p2.receipts)); return true; } catch { return false; } })());
  check('first independent-review receipt records', record(root2, p2, 'local-deep-review', p2.deep, '0', '0', 'PASS', 'same-reviewer@strong-model').status === 0);
  writeFileSync(join(root2, p2.opsec), '# OpSec review\n');
  const beforeAlias = readFileSync(join(root2, p2.receipts), 'utf8');
  const aliasPath = `${p2.folder}/receipt-alias.md`;
  linkSync(join(root2, p2.receipts), join(root2, aliasPath));
  const physicalAlias = record(root2, p2, 'local-opsec-gate', aliasPath, '0', '0', 'PASS', 'opsec-reviewer@strong-model');
  check('refuses hard-link aliases without mutating the receipt chain', physicalAlias.status !== 0
    && physicalAlias.stderr.includes('same physical file') && readFileSync(join(root2, p2.receipts), 'utf8') === beforeAlias, physicalAlias.stderr);
  rmSync(join(root2, aliasPath));
  const reportAliasPath = `${p2.folder}/deep-report-alias.md`;
  linkSync(join(root2, p2.deep), join(root2, reportAliasPath));
  check('recognizes hard-linked report identities', samePhysicalFile(join(root2, p2.deep), join(root2, reportAliasPath)));
  const duplicateReport = record(root2, p2, 'local-opsec-gate', reportAliasPath, '0', '0', 'PASS', 'opsec-reviewer@strong-model');
  check('requires distinct physical reports across gates', duplicateReport.status !== 0
    && duplicateReport.stderr.includes('distinct physical report files') && readFileSync(join(root2, p2.receipts), 'utf8') === beforeAlias, duplicateReport.stderr);
  rmSync(join(root2, reportAliasPath));
  const sameReviewer = record(root2, p2, 'local-opsec-gate', p2.opsec, '0', '0', 'PASS', 'same-reviewer@strong-model');
  check('requires distinct reviewer identities across gates', sameReviewer.status !== 0
    && sameReviewer.stderr.includes('independent reviewer identities') && readFileSync(join(root2, p2.receipts), 'utf8') === beforeAlias, sameReviewer.stderr);

  const root3 = repo(); roots.push(root3);
  const p3 = paths(root3, '-base');
  check('base-advance fixture prepares', prepare(root3, p3).status === 0);
  git(root3, ['switch', 'main']);
  writeFileSync(join(root3, 'base-two.txt'), 'advanced\n');
  git(root3, ['add', 'base-two.txt']); git(root3, ['commit', '-m', 'advance base']);
  git(root3, ['switch', 'feature']);
  const baseDrift = run(['check', '--root', root3, '--plan', p3.plan], root3);
  check('base advancement invalidates the plan', baseDrift.status !== 0 && /update the branch|base ref advanced/.test(baseDrift.stderr), baseDrift.stderr);

  const remote = mkdtempSync(join(tmpdir(), 'local-review-remote-')); roots.push(remote);
  git(remote, ['init', '--bare']);
  const root4 = repo(); roots.push(root4);
  git(root4, ['remote', 'add', 'origin', remote]);
  git(root4, ['push', 'origin', 'main', 'feature']);
  git(root4, ['fetch', 'origin']);
  const p4 = paths(root4, '-remote');
  check('remote fixture prepares against its tracking branch', prepare(root4, p4, 'origin/main').status === 0);
  writeFileSync(join(root4, p4.deep), '# Deep review\n');
  writeFileSync(join(root4, p4.opsec), '# OpSec review\n');
  check('remote fixture records independent reviews',
    record(root4, p4, 'local-deep-review', p4.deep, '0', '0', 'PASS', 'deep-reviewer@strong-model').status === 0
    && record(root4, p4, 'local-opsec-gate', p4.opsec, '0', '0', 'PASS', 'opsec-reviewer@strong-model').status === 0);
  const remoteCurrent = run(['verify-remote', '--root', root4, '--plan', p4.plan], root4);
  check('remote verification binds both branch tips before status publication', remoteCurrent.status === 0, remoteCurrent.stderr);
  const actor = mkdtempSync(join(tmpdir(), 'local-review-actor-')); roots.push(actor);
  git(actor, ['clone', remote, '.']);
  git(actor, ['config', 'user.email', 'eval@example.invalid']); git(actor, ['config', 'user.name', 'Remote Actor']);
  git(actor, ['switch', 'main']);
  writeFileSync(join(actor, 'remote-advance.txt'), 'advanced remotely\n');
  git(actor, ['add', 'remote-advance.txt']); git(actor, ['commit', '-m', 'advance remote base']); git(actor, ['push', 'origin', 'main']);
  const remoteDrift = run(['verify-remote', '--root', root4, '--plan', p4.plan], root4);
  check('remote base advancement invalidates publication without a fetch', remoteDrift.status !== 0 && remoteDrift.stderr.includes('remote base advanced'), remoteDrift.stderr);
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} local-review-gate eval failure(s):`);
  for (const failure of fails) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nlocal-review-gate eval: PASS');
