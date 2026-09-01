#!/usr/bin/env node
// Regression eval for scripts/run-runtime.mjs and scripts/runtime-lib.mjs, including
// the provider-neutral long-horizon runtime contract.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const RUNTIME = join(REPO, 'scripts', 'run-runtime.mjs');
const CAPABILITIES = join(REPO, 'scripts', 'host-capabilities.mjs');
const CONTRACT = join(REPO, 'scripts', 'run-contract.mjs');
const SNAPSHOT = join(REPO, 'scripts', 'context-snapshot.mjs');
const LEDGER = join(REPO, 'scripts', 'dispatch-ledger.mjs');
const failures = [];

function check(name, pass, detail = '') {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`);
  if (!pass) failures.push(`${name}: ${detail}`);
}

function run(script, args, cwd) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function receiptDigest(receipt) {
  const body = structuredClone(receipt);
  delete body.receiptSha256;
  return createHash('sha256').update(canonical(body)).digest('hex');
}

const outer = mkdtempSync(join(tmpdir(), 'code-ops-runtime-'));
const root = join(outer, 'repo');
const runDir = join(root, 'run');
const contractPath = join(runDir, 'RUN_CONTRACT.json');
const capabilityPath = join(runDir, 'HOST_CAPABILITIES.json');
const runtimePath = join(runDir, 'RUN_RUNTIME_RECEIPTS.jsonl');
const snapshotPath = join(runDir, 'CONTEXT_SNAPSHOT.json');
const ledgerPath = join(runDir, 'DISPATCH_LEDGER.md');

function writeContract(revision, head, snapshotId, overrides = {}) {
  const runtime = {
    capabilities: 'run/HOST_CAPABILITIES.json',
    receipts: 'run/RUN_RUNTIME_RECEIPTS.jsonl',
    stablePrefix: ['CLAUDE.md'],
    maxStablePrefixBytes: 8192,
    policy: {
      promptCaching: 'prefer',
      compaction: 'prefer',
      contextEditing: 'prefer',
      hostMemory: 'prefer',
      taskBudget: 'prefer',
    },
    ...(overrides.runtime || {}),
  };
  const contract = {
    version: 3,
    revision,
    runId: 'runtime-eval',
    head,
    objective: 'Pin durable long-horizon runtime behavior.',
    nonGoals: ['No provider API calls.'],
    lead: { model: 'gpt-5.6-sol', tier: 'frontier', effort: 'high' },
    quality: {
      dimensions: ['correctness'],
      criteria: [{ id: 'Q-001', dimension: 'correctness', description: 'Runtime checks pass.', oracle: 'command', proof: 'node eval', blocking: true, owner: 'tool' }],
    },
    budget: { maxDispatches: 1, maxParallel: 1, maxRetriesPerUnit: 1 },
    sharedContext: ['CLAUDE.md'],
    replanOn: ['scope-change', 'new-dependency', 'failed-dispatch', 'quality-gate-failure', 'context-drift', 'runtime-drift'],
    units: [{
      id: 'D-001', phase: 'map', wave: 1, lens: 'runtime', mode: 'read', role: 'gatherer', kind: 'judgment',
      model: 'gpt-5.6-terra', tier: 'strong', effort: 'medium', brief: 'map runtime state', scope: ['CLAUDE.md'],
      artifact: 'run/REPORT.md', dependsOn: [], qualityCriteria: ['Q-001'],
    }],
    context: {
      snapshot: 'CONTEXT_SNAPSHOT.json', snapshotId, bundleDir: 'bundles', untrackedPolicy: 'exclude',
      maxBundleBytes: 65536, maxAtlasExcerptBytes: 8192,
    },
    runtime,
  };
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  return contract;
}

try {
  mkdirSync(root);
  mkdirSync(runDir);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'runtime-eval@example.invalid']);
  git(root, ['config', 'user.name', 'Runtime Eval']);
  writeFileSync(join(root, '.gitignore'), 'run/\n');
  writeFileSync(join(root, 'CLAUDE.md'), '# Stable instructions\n\nKeep durable state on disk.\n');
  writeFileSync(join(root, 'source.txt'), 'one\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'fixture']);

  let r = run(CAPABILITIES, [
    'init', '--root', root, '--out', 'run/HOST_CAPABILITIES.json', '--host', 'codex-desktop',
    '--provider', 'openai', '--model', 'gpt-5.6-sol', '--source', 'operator',
    '--prompt-caching', 'managed-unobservable', '--compaction', 'managed-unobservable',
    '--context-editing', 'unsupported', '--host-memory', 'managed-unobservable', '--task-budget', 'unsupported',
  ], root);
  check('capability descriptor initializes', r.status === 0, r.out);
  r = run(CAPABILITIES, ['check', '--root', root, '--file', 'run/HOST_CAPABILITIES.json'], root);
  check('capability descriptor validates', r.status === 0 && /capabilities/.test(r.out), r.out);

  r = run(SNAPSHOT, ['prepare', '--root', root, '--out', snapshotPath, '--cache', join(runDir, 'cache'), '--untracked', 'exclude'], root);
  check('fixture snapshot prepares', r.status === 0, r.out);
  const firstSnapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  writeContract(1, git(root, ['rev-parse', 'HEAD']), firstSnapshot.snapshotId);

  r = run(CONTRACT, ['check', '--contract', contractPath, '--root', root], root);
  check('version 3 runtime contract validates', r.status === 0, r.out);

  const unignored = writeContract(1, git(root, ['rev-parse', 'HEAD']), firstSnapshot.snapshotId, { runtime: { receipts: 'RUNTIME.jsonl' } });
  r = run(CONTRACT, ['check', '--contract', contractPath, '--root', root], root);
  check('runtime state must use an ignored path', r.status === 1 && /repository-ignored/.test(r.out), r.out);
  writeContract(1, unignored.head, firstSnapshot.snapshotId);

  const tooSmall = writeContract(1, git(root, ['rev-parse', 'HEAD']), firstSnapshot.snapshotId, { runtime: { maxStablePrefixBytes: 1 } });
  r = run(CONTRACT, ['check', '--contract', contractPath, '--root', root], root);
  check('stable-prefix byte budget fails closed', r.status === 1 && /stable prefix exceeds/.test(r.out), r.out);
  writeContract(1, tooSmall.head, firstSnapshot.snapshotId);

  const capabilityBytes = readFileSync(capabilityPath);
  const unsupported = JSON.parse(capabilityBytes.toString('utf8'));
  unsupported.capabilities.promptCaching = 'unsupported';
  writeFileSync(capabilityPath, `${JSON.stringify(unsupported, null, 2)}\n`);
  const required = writeContract(1, git(root, ['rev-parse', 'HEAD']), firstSnapshot.snapshotId, {
    runtime: { policy: { promptCaching: 'require', compaction: 'prefer', contextEditing: 'prefer', hostMemory: 'prefer', taskBudget: 'prefer' } },
  });
  r = run(CONTRACT, ['check', '--contract', contractPath, '--root', root], root);
  check('required unavailable capability fails closed', r.status === 1 && /promptCaching/.test(r.out), r.out);
  writeFileSync(capabilityPath, capabilityBytes);
  writeContract(1, required.head, firstSnapshot.snapshotId);

  r = run(RUNTIME, ['init', '--root', root, '--contract', contractPath], root);
  check('runtime chain initializes', r.status === 0 && /sequence 1/.test(r.out), r.out);
  r = run(RUNTIME, ['prefix', '--root', root, '--contract', contractPath], root);
  check('stable prefix emits exact bounded payload', r.status === 0 && /Stable instructions/.test(r.out) && /CODE-OPS-STABLE-PREFIX 1/.test(r.out), r.out);

  writeFileSync(join(runDir, 'REPORT.md'), '# Report\n\nComplete.\n');
  r = run(LEDGER, ['add', '--ledger', ledgerPath, '--role', 'gatherer', '--brief', 'map runtime state', '--artifact', 'run/REPORT.md', '--model', 'gpt-5.6-terra'], root);
  check('fixture dispatch records', r.status === 0, r.out);
  r = run(LEDGER, ['update', '--ledger', ledgerPath, '--id', 'D-001', '--status', 'reported'], root);
  check('fixture dispatch reports', r.status === 0, r.out);
  r = run(RUNTIME, ['checkpoint', '--root', root, '--contract', contractPath, '--ledger', 'run/DISPATCH_LEDGER.md', '--artifact', 'run/REPORT.md'], root);
  check('clean checkpoint appends', r.status === 0 && /sequence 2/.test(r.out), r.out);
  r = run(RUNTIME, ['resume', '--root', root, '--contract', contractPath], root);
  check('resume revalidates and appends', r.status === 0 && /sequence 3/.test(r.out), r.out);
  r = run(RUNTIME, [
    'observe', '--root', root, '--contract', contractPath, '--observability', 'observed', '--cache-event', 'hit', '--cache-event', 'write', '--source', 'provider-usage',
    '--cache-read-input-tokens', '1200', '--cache-write-input-tokens', '400', '--input-tokens', '1600', '--output-tokens', '100',
  ], root);
  check('provider cache telemetry appends', r.status === 0 && /sequence 4/.test(r.out), r.out);
  r = run(RUNTIME, ['metrics', '--root', root, '--contract', contractPath, '--json'], root);
  const metrics = r.status === 0 ? JSON.parse(r.out) : null;
  check('metrics preserve combined cache events and totals', metrics?.promptCache?.cacheReadInputTokens === 1200
    && metrics?.promptCache?.cacheWriteInputTokens === 400 && metrics?.promptCache?.events?.hit === 1
    && metrics?.promptCache?.events?.write === 1 && metrics?.resumes === 1 && metrics?.checkpoints === 1, r.out);

  r = run(RUNTIME, [
    'observe', '--root', root, '--contract', contractPath, '--observability', 'unobservable', '--source', 'operator', '--input-tokens', '1',
  ], root);
  check('unobservable cache receipt rejects invented metrics', r.status === 1 && /cannot carry/.test(r.out), r.out);

  const reportBytes = readFileSync(join(runDir, 'REPORT.md'));
  writeFileSync(join(runDir, 'REPORT.md'), '# Report\n\nChanged.\n');
  r = run(RUNTIME, ['resume', '--root', root, '--contract', contractPath], root);
  check('resume refuses checkpoint artifact drift', r.status === 1 && /artifact drift/.test(r.out), r.out);
  writeFileSync(join(runDir, 'REPORT.md'), reportBytes);

  const goodChain = readFileSync(runtimePath, 'utf8');
  writeFileSync(runtimePath, goodChain.trimEnd());
  r = run(RUNTIME, ['verify', '--root', root, '--contract', contractPath], root);
  check('torn receipt tail fails closed', r.status === 1 && /torn tail/.test(r.out), r.out);
  writeFileSync(runtimePath, goodChain);

  const tampered = goodChain.trimEnd().split('\n').map((line) => JSON.parse(line));
  tampered.at(-1).observation.inputTokens = 1601;
  writeFileSync(runtimePath, `${tampered.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  r = run(RUNTIME, ['verify', '--root', root, '--contract', contractPath], root);
  check('tampered receipt body fails closed', r.status === 1 && /receipt digest/.test(r.out), r.out);

  const sequenceGap = goodChain.trimEnd().split('\n').map((line) => JSON.parse(line));
  sequenceGap.at(-1).sequence += 1;
  sequenceGap.at(-1).receiptSha256 = receiptDigest(sequenceGap.at(-1));
  writeFileSync(runtimePath, `${sequenceGap.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  r = run(RUNTIME, ['verify', '--root', root, '--contract', contractPath], root);
  check('receipt sequence gap fails closed', r.status === 1 && /sequence/.test(r.out), r.out);
  writeFileSync(runtimePath, goodChain);

  const changedCapabilities = JSON.parse(capabilityBytes.toString('utf8'));
  changedCapabilities.capabilities.promptCaching = 'managed-observable';
  writeFileSync(capabilityPath, `${JSON.stringify(changedCapabilities, null, 2)}\n`);
  r = run(RUNTIME, ['verify', '--root', root, '--contract', contractPath], root);
  check('capability drift requires replan', r.status === 1 && /runtime binding drift/.test(r.out), r.out);
  writeFileSync(capabilityPath, capabilityBytes);

  writeFileSync(join(root, 'source.txt'), 'two\n');
  git(root, ['add', 'source.txt']);
  git(root, ['commit', '-qm', 'advance fixture']);
  r = run(SNAPSHOT, ['prepare', '--root', root, '--out', snapshotPath, '--cache', join(runDir, 'cache'), '--untracked', 'exclude'], root);
  check('replanned snapshot prepares', r.status === 0, r.out);
  const secondSnapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  writeContract(2, git(root, ['rev-parse', 'HEAD']), secondSnapshot.snapshotId);
  r = run(RUNTIME, ['replan', '--root', root, '--contract', contractPath, '--ledger', 'run/DISPATCH_LEDGER.md', '--artifact', 'run/REPORT.md'], root);
  check('next contract revision appends a replan', r.status === 0 && /sequence 5/.test(r.out), r.out);
  r = run(RUNTIME, ['verify', '--root', root, '--contract', contractPath], root);
  check('replanned chain verifies', r.status === 0, r.out);

  const stableBytes = readFileSync(join(root, 'CLAUDE.md'));
  writeFileSync(join(root, 'CLAUDE.md'), `${stableBytes.toString('utf8')}drift\n`);
  r = run(RUNTIME, ['verify', '--root', root, '--contract', contractPath], root);
  check('stable-prefix or snapshot drift blocks resume', r.status === 1 && /drift/.test(r.out), r.out);
  writeFileSync(join(root, 'CLAUDE.md'), stableBytes);

  r = run(RUNTIME, ['checkpoint', '--root', root, '--contract', contractPath, '--ledger', 'run/DISPATCH_LEDGER.md', '--artifact', '../outside'], root);
  check('unsafe artifact path is rejected clearly', r.status === 1 && /repository-relative/.test(r.out), r.out);

  const outside = join(outer, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'outside\n');
  let linked = true;
  try { symlinkSync(outside, join(runDir, 'escape'), 'junction'); } catch { linked = false; }
  if (linked) {
    r = run(RUNTIME, ['checkpoint', '--root', root, '--contract', contractPath, '--ledger', 'run/DISPATCH_LEDGER.md', '--artifact', 'run/escape/secret.txt'], root);
    check('symlink escape artifact is rejected', r.status === 1 && /escapes root/.test(r.out), r.out);
  } else console.log('ok  symlink escape artifact is rejected (platform could not create fixture link)');
} finally {
  rmSync(outer, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('\nrun-runtime eval passed');
