#!/usr/bin/env node
// Local, SHA-bound judgment gate for pre-PR deep review and OpSec review.
// Model judgment happens in the local host. This script supplies the deterministic
// boundary: exact diff planning, report and reviewer receipts, replay, and commit statuses.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  assertNoAmbiguousIndexFlags,
  assertNoSymlinkComponents,
  assertNoTrackedPortableAlias,
  atomicWrite,
  canonical,
  checkedPath,
  digestJson,
  git,
  gitPaths,
  gitText,
  portableKey,
  readJson,
  repoRelative,
  safeRelative,
  samePhysicalFile,
  sha256,
} from './context-index-lib.mjs';

const PLAN_VERSION = 1;
const RECEIPT_VERSION = 1;
const GATES = ['local-deep-review', 'local-opsec-gate'];
const VERDICTS = ['PASS', 'FAIL'];
const TIERS = ['strong', 'frontier'];
const EFFORTS = ['high', 'xhigh', 'max', 'ultra'];
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }

function usage() {
  die('usage: local-review-gate.mjs prepare --root <repo> --base <ref> --out <ignored-path> --receipts <ignored-path>\n'
    + '       local-review-gate.mjs record --root <repo> --plan <path> --gate local-deep-review|local-opsec-gate --verdict PASS|FAIL --report <ignored-path> --reviewer <role@model> --tier strong|frontier --effort high|xhigh|max|ultra --blocking <n> --confirmed <n>\n'
    + '       local-review-gate.mjs check --root <repo> --plan <path> [--json]\n'
    + '       local-review-gate.mjs verify-remote --root <repo> --plan <path>\n'
    + '       local-review-gate.mjs publish --root <repo> --plan <path> [--repo owner/name] [--dry-run]', 2);
}

function flags(args, known, booleans = new Set()) {
  const out = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!known.has(key) || out[key] !== undefined) usage();
    if (booleans.has(key)) { out[key] = true; continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) usage();
    out[key] = value;
  }
  return out;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonical(actual) !== canonical(expected)) throw new Error(`${label} has unexpected or missing fields`);
}

function integer(value, label) {
  if (!/^(?:0|[1-9]\d*)$/.test(String(value))) throw new Error(`${label} must be a nonnegative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range`);
  return parsed;
}

function repositoryRoot(value) {
  return realpathSync.native(resolve(value));
}

function cleanWorktree(root) {
  assertNoAmbiguousIndexFlags(root);
  return git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).length === 0;
}

function currentBranch(root, baseRef = null) {
  const branch = gitText(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!branch || branch === 'main' || branch === 'master') throw new Error('local review requires a non-default feature branch');
  if (baseRef) {
    let symbolic;
    try { symbolic = gitText(root, ['rev-parse', '--symbolic-full-name', baseRef]); }
    catch { throw new Error('base ref must be a named local or remote branch'); }
    if (!symbolic.startsWith('refs/heads/') && !symbolic.startsWith('refs/remotes/')) throw new Error('base ref must be a named local or remote branch');
    const baseBranch = symbolic.startsWith('refs/heads/')
      ? symbolic.slice('refs/heads/'.length)
      : symbolic.slice('refs/remotes/'.length).split('/').slice(1).join('/');
    if (!baseBranch || portableKey(branch) === portableKey(baseBranch)) throw new Error('local review cannot run on its target base branch');
  }
  return branch;
}

function ignoredPath(root, value, label, mustExist = false) {
  if (!safeRelative(value)) throw new Error(`${label} must be a repository-relative portable path`);
  const absolute = checkedPath(root, value);
  assertNoSymlinkComponents(root, absolute, label);
  assertNoTrackedPortableAlias(root, value, label);
  if (mustExist && (!existsSync(absolute) || !statSync(absolute).isFile())) throw new Error(`${label} must name an existing file`);
  try { git(root, ['check-ignore', '-q', '--no-index', '--', value]); }
  catch { throw new Error(`${label} must be ignored by Git`); }
  return { relative: value, absolute };
}

function resolveCommit(root, ref, label) {
  let sha;
  try { sha = gitText(root, ['rev-parse', '--verify', `${ref}^{commit}`]); }
  catch { throw new Error(`${label} does not resolve to a commit: ${ref}`); }
  if (!SHA.test(sha)) throw new Error(`${label} resolved to an invalid object id`);
  return sha;
}

function assertAncestor(root, ancestor, descendant) {
  try { git(root, ['merge-base', '--is-ancestor', ancestor, descendant]); }
  catch { throw new Error('base commit is not an ancestor of HEAD; update the branch before review'); }
}

function diffState(root, baseRef) {
  const baseSha = resolveCommit(root, baseRef, 'base ref');
  const headSha = resolveCommit(root, 'HEAD', 'HEAD');
  assertAncestor(root, baseSha, headSha);
  const range = `${baseSha}...${headSha}`;
  const diff = git(root, ['diff', '--binary', '--full-index', '--no-ext-diff', range, '--']);
  const changedPaths = gitPaths(root, ['diff', '--name-only', '-z', '--no-ext-diff', range, '--']).sort();
  if (changedPaths.length === 0) throw new Error('review diff is empty');
  return { baseSha, headSha, diffSha256: sha256(diff), changedPaths };
}

function planSha256(plan) {
  const { planSha256: omitted, ...body } = plan;
  return digestJson(body);
}

function validatePlanShape(plan) {
  exactKeys(plan, ['version', 'branch', 'baseRef', 'baseSha', 'headSha', 'diffSha256', 'changedPaths', 'receiptsPath', 'gates', 'createdAt', 'planSha256'], 'review plan');
  if (plan.version !== PLAN_VERSION || typeof plan.branch !== 'string' || !plan.branch
    || typeof plan.baseRef !== 'string' || !plan.baseRef || !SHA.test(plan.baseSha || '')
    || !SHA.test(plan.headSha || '') || !DIGEST.test(plan.diffSha256 || '')
    || !Array.isArray(plan.changedPaths) || plan.changedPaths.length === 0
    || plan.changedPaths.some((path) => !safeRelative(path))
    || canonical([...plan.changedPaths].sort()) !== canonical(plan.changedPaths)
    || new Set(plan.changedPaths.map((path) => path.normalize('NFC').toLowerCase())).size !== plan.changedPaths.length
    || !safeRelative(plan.receiptsPath) || canonical(plan.gates) !== canonical(GATES)
    || Number.isNaN(Date.parse(plan.createdAt || '')) || !DIGEST.test(plan.planSha256 || '')) {
    throw new Error('review plan is malformed');
  }
  if (planSha256(plan) !== plan.planSha256) throw new Error('review plan digest mismatch');
}

function loadCurrentPlan(root, argument) {
  if (!cleanWorktree(root)) throw new Error('tracked or untracked worktree changes invalidate local review');
  const path = ignoredPath(root, argument, 'plan path', true);
  const plan = readJson(path.absolute);
  validatePlanShape(plan);
  if (currentBranch(root, plan.baseRef) !== plan.branch) throw new Error('review branch changed');
  const state = diffState(root, plan.baseRef);
  if (state.baseSha !== plan.baseSha) throw new Error('base ref advanced; update the branch and prepare a new review');
  if (state.headSha !== plan.headSha || state.diffSha256 !== plan.diffSha256
    || canonical(state.changedPaths) !== canonical(plan.changedPaths)) {
    throw new Error('reviewed head or diff changed; prepare a new review');
  }
  const receipts = ignoredPath(root, plan.receiptsPath, 'receipt chain path');
  return { plan, path, receipts };
}

function receiptSha256(receipt) {
  const { receiptSha256: omitted, ...body } = receipt;
  return digestJson(body);
}

function validateReceiptShape(receipt) {
  exactKeys(receipt, ['version', 'sequence', 'gate', 'verdict', 'recordedAt', 'reviewer', 'tier', 'effort', 'planSha256', 'report', 'blockingFindings', 'confirmedFindings', 'previousReceiptSha256', 'receiptSha256'], 'review receipt');
  exactKeys(receipt.report, ['path', 'sha256', 'bytes'], 'review receipt report');
  if (receipt.version !== RECEIPT_VERSION || !Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1
    || !GATES.includes(receipt.gate) || !VERDICTS.includes(receipt.verdict)
    || Number.isNaN(Date.parse(receipt.recordedAt || ''))
    || typeof receipt.reviewer !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(receipt.reviewer)
    || !TIERS.includes(receipt.tier) || !EFFORTS.includes(receipt.effort)
    || !DIGEST.test(receipt.planSha256 || '') || !safeRelative(receipt.report.path)
    || !DIGEST.test(receipt.report.sha256 || '') || !Number.isSafeInteger(receipt.report.bytes)
    || receipt.report.bytes < 1 || receipt.report.bytes > MAX_REPORT_BYTES
    || !Number.isSafeInteger(receipt.blockingFindings) || receipt.blockingFindings < 0
    || !Number.isSafeInteger(receipt.confirmedFindings) || receipt.confirmedFindings < 0
    || !(receipt.previousReceiptSha256 === null || DIGEST.test(receipt.previousReceiptSha256))
    || !DIGEST.test(receipt.receiptSha256 || '')) {
    throw new Error('review receipt is malformed');
  }
  if ((receipt.verdict === 'PASS') !== (receipt.blockingFindings === 0)) {
    throw new Error('PASS requires zero blocking findings and FAIL requires at least one');
  }
  if (receipt.blockingFindings > receipt.confirmedFindings) throw new Error('blocking findings cannot exceed confirmed findings');
  if (receiptSha256(receipt) !== receipt.receiptSha256) throw new Error('review receipt digest mismatch');
}

function replayReceiptText(root, current, text) {
  if (Buffer.byteLength(text) > MAX_RECEIPT_BYTES) throw new Error('review receipt chain exceeds size limit');
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) !== '') throw new Error('review receipt chain must end with a newline');
  lines.pop();
  if (!lines.length || lines.some((line) => !line.trim())) throw new Error('review receipt chain contains an empty entry');
  const events = [];
  const seen = new Set();
  const reviewers = new Set();
  const reportFiles = [];
  let previous = null;
  for (let index = 0; index < lines.length; index++) {
    let receipt;
    try { receipt = JSON.parse(lines[index]); }
    catch { throw new Error(`review receipt ${index + 1} is not valid JSON`); }
    validateReceiptShape(receipt);
    if (receipt.sequence !== index + 1 || receipt.previousReceiptSha256 !== previous) throw new Error('review receipt chain sequence or predecessor mismatch');
    if (receipt.planSha256 !== current.plan.planSha256) throw new Error('review receipt targets a different plan');
    if (seen.has(receipt.gate)) throw new Error(`duplicate review receipt for ${receipt.gate}`);
    const reviewerKey = portableKey(receipt.reviewer);
    if (reviewers.has(reviewerKey)) throw new Error('local review gates require independent reviewer identities');
    const report = ignoredPath(root, receipt.report.path, 'review report', true);
    if (reportFiles.some((path) => samePhysicalFile(path, report.absolute))) throw new Error('local review gates require distinct physical report files');
    const bytes = readFileSync(report.absolute);
    if (bytes.length !== receipt.report.bytes || sha256(bytes) !== receipt.report.sha256) throw new Error(`review report drift: ${receipt.report.path}`);
    seen.add(receipt.gate);
    reviewers.add(reviewerKey);
    reportFiles.push(report.absolute);
    previous = receipt.receiptSha256;
    events.push(receipt);
  }
  return { events, chainSha256: sha256(Buffer.from(text)) };
}

function replayReceipts(root, current) {
  if (!existsSync(current.receipts.absolute)) throw new Error('review receipt chain does not exist');
  if (!statSync(current.receipts.absolute).isFile()) throw new Error('review receipt chain path is not a file');
  return replayReceiptText(root, current, readFileSync(current.receipts.absolute, 'utf8'));
}

function checkGate(root, planArgument) {
  const current = loadCurrentPlan(root, planArgument);
  const replayed = replayReceipts(root, current);
  for (const gate of GATES) {
    const receipt = replayed.events.find((entry) => entry.gate === gate);
    if (!receipt) throw new Error(`missing review receipt for ${gate}`);
    if (receipt.verdict !== 'PASS') throw new Error(`${gate} did not pass`);
  }
  if (replayed.events.length !== GATES.length) throw new Error('review receipt coverage is not exact');
  return { current, replayed };
}

function withLock(path, operation) {
  const lock = `${path}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  try { mkdirSync(lock); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('review receipt mutation lock exists');
    throw error;
  }
  try {
    writeFileSync(resolve(lock, 'owner.json'), `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`);
    return operation();
  } finally { rmSync(lock, { recursive: true, force: true }); }
}

function gh(root, args, input) {
  return execFileSync('gh', args, { cwd: root, encoding: 'utf8', input, timeout: 30000, maxBuffer: 8 * 1024 * 1024 }).trim();
}

function repositoryName(root, explicit) {
  const value = explicit || gh(root, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error('repository must be owner/name');
  return value;
}

function repositoryFromRemote(root, remote) {
  const url = gitText(root, ['remote', 'get-url', remote]);
  const match = url.match(/^(?:https?:\/\/|ssh:\/\/git@)([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?$/)
    || url.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`cannot derive a GitHub repository from remote ${remote}`);
  const host = match[1].toLowerCase();
  const repository = `${match[2]}/${match[3]}`;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('remote repository must be owner/name');
  return { host, repository };
}

function boundRepository(root, remote, explicit) {
  const binding = repositoryFromRemote(root, remote);
  if (explicit && portableKey(explicit) !== portableKey(binding.repository)) {
    throw new Error(`--repo must match the verified remote repository ${binding.repository}`);
  }
  return binding;
}

function remoteBranch(root, plan) {
  let symbolic;
  try { symbolic = gitText(root, ['rev-parse', '--symbolic-full-name', plan.baseRef]); }
  catch { throw new Error('review base must remain a named remote-tracking branch before publication'); }
  const prefix = 'refs/remotes/';
  if (!symbolic.startsWith(prefix)) throw new Error('status publication requires a remote-tracking base such as origin/main');
  const value = symbolic.slice(prefix.length);
  const separator = value.indexOf('/');
  if (separator < 1 || separator === value.length - 1) throw new Error('review base remote branch is malformed');
  return { remote: value.slice(0, separator), branch: value.slice(separator + 1) };
}

function remoteRefSha(root, remote, ref) {
  let output;
  try { output = gitText(root, ['ls-remote', '--exit-code', remote, ref]); }
  catch { throw new Error(`remote ref is unavailable: ${remote}/${ref}`); }
  const rows = output.split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/));
  if (rows.length !== 1 || rows[0][1] !== ref || !SHA.test(rows[0][0] || '')) throw new Error(`remote ref response is invalid: ${remote}/${ref}`);
  return rows[0][0];
}

function verifyRemoteState(root, plan) {
  const target = remoteBranch(root, plan);
  const baseRef = `refs/heads/${target.branch}`;
  const headRef = `refs/heads/${plan.branch}`;
  if (remoteRefSha(root, target.remote, baseRef) !== plan.baseSha) {
    throw new Error('remote base advanced; update the branch and prepare a new review');
  }
  if (remoteRefSha(root, target.remote, headRef) !== plan.headSha) {
    throw new Error('reviewed HEAD is not the exact feature-branch tip on the remote');
  }
  return { remote: target.remote, baseBranch: target.branch, featureBranch: plan.branch };
}

function statusPayload(host, repo, headSha, receipt) {
  return {
    state: 'success',
    target_url: `https://${host}/${repo}/commit/${headSha}`,
    description: `Local receipt ${receipt.receiptSha256.slice(0, 12)} verified`,
    context: receipt.gate,
  };
}

const command = process.argv[2];
if (command === 'prepare') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--base', '--out', '--receipts']));
  if (!f['--root'] || !f['--base'] || !f['--out'] || !f['--receipts']) usage();
  try {
    const root = repositoryRoot(f['--root']);
    if (!cleanWorktree(root)) throw new Error('commit all tracked and untracked changes before preparing review');
    const branch = currentBranch(root, f['--base']);
    const out = ignoredPath(root, f['--out'], 'plan output');
    const receipts = ignoredPath(root, f['--receipts'], 'receipt chain path');
    if (portableKey(out.relative) === portableKey(receipts.relative)) throw new Error('plan and receipt chain paths must differ portably');
    if (existsSync(receipts.absolute)) throw new Error('receipt chain already exists; use a new review path');
    const state = diffState(root, f['--base']);
    const plan = {
      version: PLAN_VERSION,
      branch,
      baseRef: f['--base'],
      ...state,
      receiptsPath: receipts.relative,
      gates: GATES,
      createdAt: new Date().toISOString(),
      planSha256: null,
    };
    plan.planSha256 = planSha256(plan);
    validatePlanShape(plan);
    atomicWrite(out.absolute, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`ok local review plan ${plan.planSha256} for ${plan.headSha}`);
  } catch (error) { die(error.message); }
} else if (command === 'record') {
  const known = new Set(['--root', '--plan', '--gate', '--verdict', '--report', '--reviewer', '--tier', '--effort', '--blocking', '--confirmed']);
  const f = flags(process.argv.slice(3), known);
  if ([...known].some((key) => f[key] === undefined)) usage();
  try {
    const root = repositoryRoot(f['--root']);
    const current = loadCurrentPlan(root, f['--plan']);
    if (!GATES.includes(f['--gate']) || !VERDICTS.includes(f['--verdict']) || !TIERS.includes(f['--tier']) || !EFFORTS.includes(f['--effort'])) {
      throw new Error('review gate, verdict, tier, or effort is invalid');
    }
    const report = ignoredPath(root, f['--report'], 'review report', true);
    if ([current.path.relative, current.receipts.relative].some((path) => portableKey(path) === portableKey(report.relative))) {
      throw new Error('review report must not alias the plan or receipt chain');
    }
    if ([current.path.absolute, current.receipts.absolute].some((path) => samePhysicalFile(path, report.absolute))) {
      throw new Error('review report must not be the same physical file as the plan or receipt chain');
    }
    const blockingFindings = integer(f['--blocking'], 'blocking findings');
    const confirmedFindings = integer(f['--confirmed'], 'confirmed findings');
    const event = withLock(current.receipts.absolute, () => {
      let prior = [];
      if (existsSync(current.receipts.absolute)) prior = replayReceipts(root, current).events;
      if (prior.some((entry) => entry.gate === f['--gate'])) throw new Error(`review receipt already exists for ${f['--gate']}`);
      if (prior.some((entry) => portableKey(entry.report.path) === portableKey(report.relative))) throw new Error('each review gate requires a distinct report path');
      const reportBytes = readFileSync(report.absolute);
      if (!reportBytes.length || reportBytes.length > MAX_REPORT_BYTES) throw new Error('review report is empty or exceeds size limit');
      const receipt = {
        version: RECEIPT_VERSION,
        sequence: prior.length + 1,
        gate: f['--gate'],
        verdict: f['--verdict'],
        recordedAt: new Date().toISOString(),
        reviewer: f['--reviewer'],
        tier: f['--tier'],
        effort: f['--effort'],
        planSha256: current.plan.planSha256,
        report: { path: report.relative, sha256: sha256(reportBytes), bytes: reportBytes.length },
        blockingFindings,
        confirmedFindings,
        previousReceiptSha256: prior.at(-1)?.receiptSha256 || null,
        receiptSha256: null,
      };
      receipt.receiptSha256 = receiptSha256(receipt);
      validateReceiptShape(receipt);
      const before = existsSync(current.receipts.absolute) ? readFileSync(current.receipts.absolute, 'utf8') : '';
      const after = `${before}${JSON.stringify(receipt)}\n`;
      if (Buffer.byteLength(after) > MAX_RECEIPT_BYTES) throw new Error('review receipt chain exceeds size limit');
      replayReceiptText(root, current, after);
      atomicWrite(current.receipts.absolute, after);
      return receipt;
    });
    console.log(`ok ${event.gate} ${event.verdict} ${event.receiptSha256}`);
  } catch (error) { die(error.message); }
} else if (command === 'check') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--plan', '--json']), new Set(['--json']));
  if (!f['--root'] || !f['--plan']) usage();
  try {
    const result = checkGate(repositoryRoot(f['--root']), f['--plan']);
    const summary = {
      planSha256: result.current.plan.planSha256,
      headSha: result.current.plan.headSha,
      chainSha256: result.replayed.chainSha256,
      gates: Object.fromEntries(result.replayed.events.map((entry) => [entry.gate, entry.receiptSha256])),
    };
    if (f['--json']) process.stdout.write(`${JSON.stringify(summary)}\n`);
    else console.log(`ok local review ${summary.headSha} plan ${summary.planSha256} chain ${summary.chainSha256}`);
  } catch (error) { die(error.message); }
} else if (command === 'verify-remote') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--plan']));
  if (!f['--root'] || !f['--plan']) usage();
  try {
    const root = repositoryRoot(f['--root']);
    const result = checkGate(root, f['--plan']);
    const remote = verifyRemoteState(root, result.current.plan);
    console.log(`ok remote review state ${remote.remote}/${remote.baseBranch} ${remote.featureBranch} ${result.current.plan.headSha}`);
  } catch (error) { die(error.message); }
} else if (command === 'publish') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--plan', '--repo', '--dry-run']), new Set(['--dry-run']));
  if (!f['--root'] || !f['--plan']) usage();
  try {
    const root = repositoryRoot(f['--root']);
    const result = checkGate(root, f['--plan']);
    if (f['--dry-run']) {
      const repo = repositoryName(root, f['--repo']);
      const payloads = result.replayed.events.map((receipt) => statusPayload('github.com', repo, result.current.plan.headSha, receipt));
      process.stdout.write(`${JSON.stringify({ repository: repo, headSha: result.current.plan.headSha, remoteVerification: 'required-before-publish', statuses: payloads })}\n`);
    } else {
      const remote = verifyRemoteState(root, result.current.plan);
      const binding = boundRepository(root, remote.remote, f['--repo']);
      const payloads = result.replayed.events.map((receipt) => statusPayload(binding.host, binding.repository, result.current.plan.headSha, receipt));
      for (const payload of payloads) gh(root, ['api', '--hostname', binding.host, '--method', 'POST', `repos/${binding.repository}/statuses/${result.current.plan.headSha}`, '--input', '-'], `${JSON.stringify(payload)}\n`);
      console.log(`ok published ${payloads.length} local review statuses for ${result.current.plan.headSha}`);
    }
  } catch (error) { die(error.message); }
} else usage();
