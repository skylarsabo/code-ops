#!/usr/bin/env node
// Synthetic-only regression coverage. The literal-bracket case is deliberately defensive.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  adoptionHistoryProfiles, citationAuthority, digestJson, extractCitations, historyPathBatches, indexSemantic,
  indexSnapshot, jsonl, recordId, resolvePrefix, sha256, targetsAt, writeAtomically,
} from '../../scripts/record-lib.mjs';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts', 'records.mjs');
const failures = [];
const UUID = '11111111-1111-4111-8111-111111111111';
const COLLECTION = ['--collection', 'evidence'];
const expectedCases = process.platform === 'win32' ? 227 : 230;
const GENERATED_NAMES = ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'];
let executedCases = 0;
let work;

function check(name, condition, detail = '') {
  executedCases += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) { failures.push(`${name}: ${detail}`); if (detail) console.log(detail); }
}
function run(args, cwd) {
  return runWithScript(SCRIPT, args, cwd);
}
function runWithScript(script, args, cwd, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env },
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status ?? 1, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
}
function runWithScriptCaptured(script, args, cwd, env = {}) {
  const child = spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env },
  });
  return {
    status: child.status ?? 1,
    output: `${child.stdout || ''}${child.stderr || ''}${child.error ? `\n${child.error.message}` : ''}`,
  };
}
function git(args, cwd, binary = false) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd, encoding: binary ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function configuredGit(args, cwd, binary = false) {
  return execFileSync('git', args, {
    cwd, encoding: binary ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function commit(repo, message) {
  git(['add', '-A'], repo);
  git(['-c', 'gc.auto=0', '-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', message], repo);
}
function squashCurrentTree(repo, message) {
  const tree = git(['rev-parse', 'HEAD^{tree}'], repo).trim();
  const head = git([
    '-c', 'user.email=eval@example.com', '-c', 'user.name=Eval',
    'commit-tree', tree, '-m', message,
  ], repo).trim();
  git(['reset', '--hard', head], repo);
}
function write(repo, path, text) {
  const target = join(repo, ...path.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, text);
}
function instrumentedRecordsScript(name, transform) {
  const directory = join(work, name); mkdirSync(directory, { recursive: true });
  const source = readFileSync(SCRIPT, 'utf8'); const instrumented = transform(source);
  if (instrumented === source) throw new Error(`instrumentation anchor was not found for ${name}`);
  const script = join(directory, 'records.mjs'); writeFileSync(script, instrumented);
  cpSync(join(ROOT, 'scripts', 'record-lib.mjs'), join(directory, 'record-lib.mjs'));
  return script;
}
function fixtureManifest() {
  return {
    version: 2, hub: 'hub', runs: { tracking: 'ignored' }, domains: [], legacyPaths: [],
    recordCollections: [{
      collectionUuid: UUID, id: 'evidence', identityVersion: 1, root: 'records',
      inventory: '98 System/Records/inventory.json', citations: '98 System/Records/citations.json',
      curationLedger: '98 System/Records/curation.jsonl', index: '98 System/Records/index.md',
      scopes: [
        { pattern: '*.md', kind: 'record', policy: 'append-only' },
        { pattern: 'mutable/**', kind: 'artifact', policy: 'mutable' },
        { pattern: 'frozen/**', kind: 'artifact', policy: 'frozen' },
        { pattern: 'exec/**', kind: 'executable', policy: 'frozen' },
        { pattern: 'literal[0].json', kind: 'artifact', policy: 'frozen' },
      ],
    }],
  };
}
function generated(repo, name) { return join(repo, 'hub', '98 System', 'Records', name); }
function generatedSnapshot(repo) {
  return new Map(GENERATED_NAMES.map((name) => [name, readFileSync(generated(repo, name))]));
}
function generatedMatches(repo, snapshot) {
  return GENERATED_NAMES.every((name) => snapshot.get(name).equals(readFileSync(generated(repo, name))));
}
function authorityRefDigest(refs) {
  return digestJson([...refs].sort((left, right) => {
    const leftKey = `${left.type}:${left.path}`; const rightKey = `${right.type}:${right.path}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  }));
}
function inventoryAuthorityRefs(inventory) {
  return [
    ...(inventory.entries || []).map((entry) => ({ type: 'record', path: entry.path, objectDigest: digestJson(entry) })),
    ...(inventory.artifacts || []).map((artifact) => ({ type: 'artifact', path: artifact.path, objectDigest: digestJson(artifact) })),
  ].sort((left, right) => {
    const leftKey = `${left.type}:${left.path}`; const rightKey = `${right.type}:${right.path}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}
function fixtureGeneratedBindings(inventory, citations, events) {
  const citationSemantics = {
    version: citations.version, collectionUuid: citations.collectionUuid,
    entries: (citations.entries || []).map(citationAuthority),
  };
  return {
    inventorySha256: digestJson(inventory), citationsSha256: digestJson(citationSemantics),
    curationLedgerSha256: sha256(Buffer.from(jsonl(events))),
    indexSha256: digestJson(indexSemantic(fixtureManifest().recordCollections[0], inventory, events)),
    authorityBatchHead: inventory.authorityBatches?.at(-1)?.batchDigest || null,
  };
}
function rehashAuthorityBatch(batch) {
  const { batchDigest: _batchDigest, ...authority } = batch;
  batch.batchDigest = digestJson(authority);
}
function rehashAuthorityChain(inventory) {
  const objects = new Map([
    ...(inventory.entries || []).map((entry) => [`record:${entry.path}`, digestJson(entry)]),
    ...(inventory.artifacts || []).map((artifact) => [`artifact:${artifact.path}`, digestJson(artifact)]),
  ]);
  let covered = []; let previousBatchDigest = null; let previousBatch = null;
  for (const batch of inventory.authorityBatches || []) {
    batch.previousBatchDigest = previousBatchDigest;
    if (batch.baseBindings) batch.baseBindings.authorityBatchHead = previousBatchDigest;
    batch.priorAuthorityDigest = authorityRefDigest(covered);
    for (const ref of batch.objects) ref.objectDigest = objects.get(`${ref.type}:${ref.path}`) || ref.objectDigest;
    covered = [...covered, ...batch.objects];
    batch.authorityDigest = authorityRefDigest(covered);
    if (['genesis-adoption', 'v2-migration'].includes(batch.type)) {
      batch.reviewReceiptDigest = inventory.adoptionReview?.receiptDigest || null;
    }
    if (batch.type === 'incremental-adoption' && batch.review) {
      batch.review.baseBindings = structuredClone(previousBatch?.type === 'v2-migration'
        && previousBatch.sourceHead === batch.sourceHead ? previousBatch.baseBindings : batch.baseBindings);
      delete batch.review.receiptDigest;
      batch.review.receiptDigest = digestJson(batch.review);
      batch.reviewReceiptDigest = batch.review.receiptDigest;
    }
    if (batch.type === 'genesis-adoption') {
      batch.sourceHead = inventory.adoptionReview?.sourceHead || batch.sourceHead;
      batch.manifestSha256 = inventory.adoptionReview?.manifestSha256 || batch.manifestSha256;
    }
    rehashAuthorityBatch(batch);
    previousBatchDigest = batch.batchDigest;
    previousBatch = batch;
  }
}
function moveAuthorityRef(inventory, fromBatch, toBatch, predicate) {
  const index = fromBatch.objects.findIndex(predicate);
  if (index < 0) throw new Error('authority forgery fixture could not find the requested object');
  toBatch.objects.push(fromBatch.objects.splice(index, 1)[0]);
  rehashAuthorityChain(inventory);
}
function restoreFromHead(repo, path) { write(repo, path, git(['show', `HEAD:${path}`], repo)); }

try {
  work = mkdtempSync(join(tmpdir(), 'code-ops-records-'));
  const repo = join(work, 'fixture');
  mkdirSync(repo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], repo);
  write(repo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(repo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(repo, 'records/mutable/result.json', '{"PRIMARY":{"summary":1},"A":[0]}\n');
  write(repo, 'records/mutable/stream.jsonl', '{"row":1}\n');
  write(repo, 'records/mutable/chart.png', 'synthetic-image-bytes');
  write(repo, 'records/frozen/stable.json', '{"stable":true}\n');
  write(repo, 'records/frozen/old.json', '{"historical":true}\n');
  write(repo, 'records/exec/probe.py', 'print("synthetic")\n');
  write(repo, 'records/literal[0].json', '{"literal":true}\n');
  write(repo, 'records/one.md', `# One

[literal](records/literal[0].json)
[compound](records/mutable/result.json["PRIMARY"]#summary)
[repeated](records/mutable/result.json["A"][0])
[range](records/frozen/stable.json:1-2)
[symbol](records/exec/probe.py::main)
[fragment](records/frozen/stable.json#stable)
[glob](records/mutable/*.json)
[dead](records/never-created.json)
[relative](./mutable/stream.jsonl#row)
![proof](records/mutable/chart.png)
[history](records/frozen/old.json)
[reference proof][artifact]
![reference image][chart-ref]
[shortcut]
[collapsed][]

\`[inline example](records/never-code.json)\`

~~~md
[fenced example](records/never-fence.json)
~~~

[artifact]: records/mutable/result.json
[chart-ref]: records/mutable/chart.png
[shortcut]: records/mutable/stream.jsonl
[collapsed]: records/frozen/stable.json
`);
  commit(repo, 'seed record and targets');
  unlinkSync(join(repo, 'records', 'frozen', 'old.json'));
  commit(repo, 'retire old target');

  let result = run(['classify', '--root', repo, ...COLLECTION], repo);
  check('Git-index classification is total', result.status === 0 && result.output.includes('append-only'), result.output);
  const rootCasingRepo = join(work, 'root-casing'); mkdirSync(rootCasingRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], rootCasingRepo);
  write(rootCasingRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  const rootCasingManifest = fixtureManifest();
  rootCasingManifest.recordCollections[0].root = 'RECORDS';
  write(rootCasingRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(rootCasingManifest, null, 2)}\n`);
  write(rootCasingRepo, 'records/one.md', '# Casing probe\n');
  commit(rootCasingRepo, 'seed mismatched root casing');
  result = run(['classify', '--root', rootCasingRepo, ...COLLECTION], rootCasingRepo);
  check('collection root casing must match the Git index', result.status === 1 && result.output.includes('root casing differs'), result.output);
  result = run(['classify', '--root', repo, ...COLLECTION, '--typo', 'ignored'], repo);
  check('unknown CLI options fail closed', result.status === 1 && result.output.includes('unknown option --typo'), result.output);
  result = run(['check', '--strict', '--root', repo, ...COLLECTION], repo);
  check('recognized options fail on the wrong command', result.status === 1 && result.output.includes('--strict is not valid for check'), result.output);
  result = run(['verify-history', '--root', repo, ...COLLECTION], repo);
  check('history verification requires explicit strict mode', result.status === 1 && result.output.includes('requires --strict'), result.output);

  const scopeV2Repo = join(work, 'scope-v2'); mkdirSync(scopeV2Repo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], scopeV2Repo);
  write(scopeV2Repo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  const scopeV2Manifest = fixtureManifest();
  scopeV2Manifest.recordCollections[0].classificationVersion = 2;
  scopeV2Manifest.recordCollections[0].scopes = [
    { id: 'jsonl-default', match: ['general/**', '**/*.jsonl'], paths: [], kind: 'artifact', policy: 'frozen' },
    { id: 'day-profile-live', match: [], paths: ['special/day_profile.jsonl'], kind: 'artifact', policy: 'mutable' },
  ];
  write(scopeV2Repo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(scopeV2Manifest, null, 2)}\n`);
  write(scopeV2Repo, 'records/general/frozen.jsonl', '{"frozen":true}\n');
  write(scopeV2Repo, 'records/special/day_profile.jsonl', '{"mutable":true}\n');
  commit(scopeV2Repo, 'seed scope v2 exception');
  result = run(['classify', '--root', scopeV2Repo, ...COLLECTION], scopeV2Repo);
  const firstScopeV2 = result.status === 0 ? JSON.parse(result.output) : null;
  const reversedScopeV2 = structuredClone(scopeV2Manifest);
  reversedScopeV2.recordCollections[0].scopes.reverse();
  for (const scope of reversedScopeV2.recordCollections[0].scopes) {
    scope.match.reverse();
    scope.paths.reverse();
  }
  writeFileSync(join(scopeV2Repo, 'hub', '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify(reversedScopeV2, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], scopeV2Repo);
  const reversedResult = run(['classify', '--root', scopeV2Repo, ...COLLECTION], scopeV2Repo);
  const secondScopeV2 = reversedResult.status === 0 ? JSON.parse(reversedResult.output) : null;
  const selectedScope = (value) => value?.rows?.find((row) => row.path.endsWith('day_profile.jsonl'));
  check('scope v2 exact paths outrank broad globs independent of order', result.status === 0 && reversedResult.status === 0
    && selectedScope(firstScopeV2)?.scopeId === 'day-profile-live'
    && selectedScope(firstScopeV2)?.resolution === 'exact-path'
    && firstScopeV2?.rows?.find((row) => row.path.endsWith('general/frozen.jsonl'))?.scopeId === 'jsonl-default'
    && JSON.stringify(selectedScope(firstScopeV2)) === JSON.stringify(selectedScope(secondScopeV2)), `${result.output}\n${reversedResult.output}`);
  const unmatchedScopeV2 = join(work, 'scope-v2-unmatched'); cpSync(scopeV2Repo, unmatchedScopeV2, { recursive: true });
  writeFileSync(join(unmatchedScopeV2, 'hub', '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify(scopeV2Manifest, null, 2)}\n`);
  write(unmatchedScopeV2, 'records/unclassified.txt', 'not governed\n');
  commit(unmatchedScopeV2, 'add unclassified collection path');
  result = run(['adopt', '--root', unmatchedScopeV2, ...COLLECTION], unmatchedScopeV2);
  check('scope v2 zero-match refuses adoption without generated files', result.status === 1
    && result.output.includes('invalid collection classification')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(unmatchedScopeV2, name))), result.output);
  const ambiguousScopeV2 = structuredClone(scopeV2Manifest);
  ambiguousScopeV2.recordCollections[0].scopes.push({
    id: 'jsonl-second-owner', match: ['general/**'], paths: [], kind: 'artifact', policy: 'frozen',
  });
  writeFileSync(join(scopeV2Repo, 'hub', '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify(ambiguousScopeV2, null, 2)}\n`);
  commit(scopeV2Repo, 'introduce ambiguous scope v2 policy');
  result = run(['adopt', '--root', scopeV2Repo, ...COLLECTION], scopeV2Repo);
  check('scope v2 glob ambiguity refuses adoption without generated files', result.status === 1
    && result.output.includes('invalid collection classification')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(scopeV2Repo, name))), result.output);

  const longPaths = Array.from({ length: 128 }, (_, index) => {
    const suffix = String(index).padStart(3, '0');
    return `records/${'a'.repeat(120)}/${'b'.repeat(120)}/record-${suffix}.md`;
  });
  const longPathBatches = historyPathBatches(longPaths);
  const batchesSpawn = longPathBatches.every((batch) => {
    try { execFileSync('git', ['--version', ...batch.map((path) => `:(literal)${path}`)], { stdio: 'ignore' }); return true; }
    catch (error) { return error.code !== 'ENAMETOOLONG'; }
  });
  check('exact-history batches stay within the Windows process argument budget', longPathBatches.length > 1
    && longPathBatches.flat().join('\0') === longPaths.join('\0') && batchesSpawn);

  const oversizedBlobRepo = join(work, 'oversized-index-blob'); mkdirSync(oversizedBlobRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], oversizedBlobRepo);
  writeFileSync(join(oversizedBlobRepo, 'large.bin'), Buffer.alloc((32 * 1024 * 1024) + 1, 97));
  git(['add', '--', 'large.bin'], oversizedBlobRepo);
  let oversizedBlobError = '';
  try { indexSnapshot(oversizedBlobRepo, ['large.bin']); } catch (error) { oversizedBlobError = error.message; }
  check('canonical Git snapshots reject one blob above the bounded memory limit',
    oversizedBlobError.includes('exceeds 33554432-byte limit') && oversizedBlobError.includes('large.bin'), oversizedBlobError);

  const historicalBlobRepo = join(work, 'oversized-history-blob'); mkdirSync(historicalBlobRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], historicalBlobRepo);
  const historicalPath = 'records/historical-large.md';
  const historicalBytes = Buffer.alloc((34 * 1024 * 1024), 98);
  const historicalDigest = sha256(historicalBytes);
  write(historicalBlobRepo, historicalPath, historicalBytes);
  commit(historicalBlobRepo, 'add large historical record');
  write(historicalBlobRepo, historicalPath, '# Current record\n');
  commit(historicalBlobRepo, 'settle historical record');
  const historicalRows = [{ path: historicalPath, kind: 'record', policy: 'append-only' }];
  let historicalProfile = null; let historicalProfileError = '';
  try {
    historicalProfile = adoptionHistoryProfiles(
      historicalBlobRepo, fixtureManifest().recordCollections[0], historicalRows,
    ).get(historicalPath);
  } catch (error) { historicalProfileError = error.message; }
  check('history profiling reads a pre-adoption blob above the batch limit individually',
    /^[0-9a-f]{64}$/.test(historicalProfile?.historyDigest || '') && !historicalProfileError, historicalProfileError);
  let historicalTarget = null; let historicalTargetError = '';
  try { historicalTarget = targetsAt(historicalBlobRepo, 'HEAD~1', [historicalPath]).get(historicalPath); }
  catch (error) { historicalTargetError = error.message; }
  check('historical target lookup reads a blob above the batch limit individually',
    historicalTarget?.targetSha256 === historicalDigest && !historicalTargetError, historicalTargetError);

  function batchProfile(fillerCount) {
    const batchRepo = join(work, `batch-profile-${fillerCount}`); mkdirSync(batchRepo, { recursive: true });
    git(['init', '--quiet', '-b', 'main'], batchRepo);
    write(batchRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
    write(batchRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
    write(batchRepo, 'other/p1.md', '# Shared predecessor\n');
    write(batchRepo, 'records/p2.md', '# Shared predecessor\n');
    commit(batchRepo, 'seed ambiguous rename predecessors');
    unlinkSync(join(batchRepo, 'other', 'p1.md'));
    unlinkSync(join(batchRepo, 'records', 'p2.md'));
    write(batchRepo, 'records/q.md', '# Shared predecessor\n');
    for (let index = 0; index < fillerCount; index += 1) {
      write(batchRepo, `records/filler-${String(index).padStart(3, '0')}.md`, `# Filler ${index}\n`);
    }
    commit(batchRepo, 'replace predecessors and add fillers');
    const classified = run(['classify', '--root', batchRepo, ...COLLECTION], batchRepo);
    const row = classified.status === 0
      ? JSON.parse(classified.output).rows.find((candidate) => candidate.path === 'records/q.md')
      : null;
    return { classified, row };
  }
  const smallBatchProfile = batchProfile(0);
  const largeBatchProfile = batchProfile(200);
  check('history profiles are invariant to unrelated batch membership', smallBatchProfile.classified.status === 0
    && largeBatchProfile.classified.status === 0
    && smallBatchProfile.row?.adoptionReadiness === largeBatchProfile.row?.adoptionReadiness
    && smallBatchProfile.row?.historyDigest === largeBatchProfile.row?.historyDigest
    && smallBatchProfile.row?.history?.contentTransitions === largeBatchProfile.row?.history?.contentTransitions
    && smallBatchProfile.row?.history?.priorIncarnations === largeBatchProfile.row?.history?.priorIncarnations,
  `${smallBatchProfile.classified.output}\n${largeBatchProfile.classified.output}`);

  result = run(['classify', '--root', scopeV2Repo, ...COLLECTION], scopeV2Repo);
  check('invalid classification is not mislabeled as unavailable history', result.status === 1
    && result.output.includes('"status": "classification-invalid"')
    && !result.output.includes('"status": "history-unavailable"'), result.output);
  const invalidShallowRepo = join(work, 'invalid-shallow-classification'); cpSync(scopeV2Repo, invalidShallowRepo, { recursive: true });
  writeFileSync(join(invalidShallowRepo, '.git', 'shallow'), `${git(['rev-parse', 'HEAD'], invalidShallowRepo).trim()}\n`);
  result = run(['classify', '--root', invalidShallowRepo, ...COLLECTION], invalidShallowRepo);
  check('invalid classification takes precedence over unavailable history', result.status === 1
    && result.output.includes('"status": "classification-invalid"')
    && !result.output.includes('"status": "history-unavailable"'), result.output);

  const promotedRepo = join(work, 'promoted-record'); mkdirSync(promotedRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], promotedRepo);
  write(promotedRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(promotedRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(promotedRepo, 'drafts/promoted.md', '# Promoted record\n');
  commit(promotedRepo, 'create draft');
  mkdirSync(join(promotedRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], promotedRepo);
  commit(promotedRepo, 'promote record');
  const promotionCommit = git(['rev-parse', 'HEAD'], promotedRepo).trim();
  result = run(['adopt', '--root', promotedRepo, ...COLLECTION], promotedRepo);
  const promotedInventory = result.status === 0 ? JSON.parse(readFileSync(generated(promotedRepo, 'inventory.json'), 'utf8')) : null;
  let promotedPathExists = false;
  try { git(['cat-file', '-e', `${promotionCommit}:records/promoted.md`], promotedRepo); promotedPathExists = true; } catch { /* asserted below */ }
  check('pre-adoption promotion resolves the exact current path introduction', result.status === 0
    && promotedInventory?.entries?.[0]?.introducedCommit === promotionCommit
    && promotedPathExists
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => existsSync(generated(promotedRepo, name))), result.output);
  const stableRewriteRepo = join(work, 'stable-history-rewrite'); cpSync(promotedRepo, stableRewriteRepo, { recursive: true });
  commit(stableRewriteRepo, 'adopt stable promoted record');
  squashCurrentTree(stableRewriteRepo, 'squashed stable adoption');
  result = run(['check', '--root', stableRewriteRepo, ...COLLECTION], stableRewriteRepo);
  // ADR 0004 permits content-preserving rewrite tolerance. Total-history replacement needs an external anchor.
  check('stable adoption authority survives a content-preserving squash', result.status === 0, result.output);

  const revisedPromotionRepo = join(work, 'revised-promotion'); mkdirSync(revisedPromotionRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], revisedPromotionRepo);
  write(revisedPromotionRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(revisedPromotionRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(revisedPromotionRepo, 'drafts/promoted.md', '# Draft evidence\n');
  commit(revisedPromotionRepo, 'create promoted draft');
  write(revisedPromotionRepo, 'drafts/promoted.md', '# Revised evidence\n');
  commit(revisedPromotionRepo, 'revise promoted draft');
  mkdirSync(join(revisedPromotionRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], revisedPromotionRepo);
  commit(revisedPromotionRepo, 'promote revised record');
  result = run(['adopt', '--root', revisedPromotionRepo, ...COLLECTION], revisedPromotionRepo);
  check('pre-promotion revisions require review after exact-path admission', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(revisedPromotionRepo, name))), result.output);

  const mergedPromotionRepo = join(work, 'merged-revised-promotion'); mkdirSync(mergedPromotionRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], mergedPromotionRepo);
  write(mergedPromotionRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(mergedPromotionRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(mergedPromotionRepo, 'seed collection policy');
  git(['checkout', '-q', '-b', 'draft-work'], mergedPromotionRepo);
  write(mergedPromotionRepo, 'drafts/promoted.md', '# Branch draft\n');
  commit(mergedPromotionRepo, 'create branch draft');
  write(mergedPromotionRepo, 'drafts/promoted.md', '# Branch revision\n');
  commit(mergedPromotionRepo, 'revise branch draft');
  mkdirSync(join(mergedPromotionRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], mergedPromotionRepo);
  commit(mergedPromotionRepo, 'promote branch record');
  git(['checkout', '-q', 'main'], mergedPromotionRepo);
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval',
    'merge', '--no-ff', '-m', 'merge promoted record', 'draft-work'], mergedPromotionRepo);
  result = run(['adopt', '--root', mergedPromotionRepo, ...COLLECTION], mergedPromotionRepo);
  check('merged pre-promotion revisions remain visible to adoption review', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(mergedPromotionRepo, name))), result.output);

  const mergedBaselineRepo = join(work, 'merged-record-baseline'); mkdirSync(mergedBaselineRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], mergedBaselineRepo);
  write(mergedBaselineRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(mergedBaselineRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  const baselineLines = Array.from({ length: 80 }, (_, index) => `line ${String(index + 1).padStart(2, '0')}`);
  write(mergedBaselineRepo, 'records/one.md', `${baselineLines.join('\n')}\n`);
  commit(mergedBaselineRepo, 'seed merge baseline');
  git(['checkout', '-q', '-b', 'side-edit'], mergedBaselineRepo);
  const sideLines = [...baselineLines]; sideLines[69] = 'line 70 side edit';
  write(mergedBaselineRepo, 'records/one.md', `${sideLines.join('\n')}\n`); commit(mergedBaselineRepo, 'edit record on side');
  git(['checkout', '-q', 'main'], mergedBaselineRepo);
  const mainLines = [...baselineLines]; mainLines[1] = 'line 02 main edit';
  write(mergedBaselineRepo, 'records/one.md', `${mainLines.join('\n')}\n`); commit(mergedBaselineRepo, 'edit record on main');
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval',
    'merge', '--no-ff', '-m', 'merge independent record edits', 'side-edit'], mergedBaselineRepo);
  const mergedBaselineCommit = git(['rev-parse', 'HEAD'], mergedBaselineRepo).trim();
  result = run(['classify', '--root', mergedBaselineRepo, ...COLLECTION], mergedBaselineRepo);
  const mergedClassification = result.status === 0 ? JSON.parse(result.output) : null;
  check('merge-produced record bytes classify as committed review-required history', result.status === 0
    && mergedClassification?.adoptionReadiness?.status === 'review-required'
    && mergedClassification?.rows?.[0]?.history?.baselineCommit === mergedBaselineCommit
    && mergedClassification?.rows?.[0]?.historyReason !== 'uncommitted-index-entry', result.output);
  writeFileSync(join(mergedBaselineRepo, '.git', 'info', 'exclude'), 'adoption-review.json\n');
  result = run(['plan-adoption', '--root', mergedBaselineRepo, ...COLLECTION, '--out', 'adoption-review.json'], mergedBaselineRepo);
  const mergedReview = result.status === 0 ? JSON.parse(readFileSync(join(mergedBaselineRepo, 'adoption-review.json'), 'utf8')) : null;
  if (mergedReview) {
    mergedReview.candidates[0].disposition = 'freeze-current';
    mergedReview.candidates[0].rationale = 'The merge result is the reviewed immutable baseline.';
    writeFileSync(join(mergedBaselineRepo, 'adoption-review.json'), `${JSON.stringify(mergedReview, null, 2)}\n`);
  }
  result = mergedReview
    ? run(['adopt', '--root', mergedBaselineRepo, ...COLLECTION, '--review', 'adoption-review.json'], mergedBaselineRepo)
    : result;
  if (result.status === 0) commit(mergedBaselineRepo, 'adopt merge baseline');
  const mergedBaselineCheck = result.status === 0 ? run(['check', '--root', mergedBaselineRepo, ...COLLECTION], mergedBaselineRepo) : result;
  check('reviewed merge-produced baseline adopts and verifies', result.status === 0 && mergedBaselineCheck.status === 0,
    `${result.output}\n${mergedBaselineCheck.output}`);

  const mergeAddRepo = join(work, 'merge-add-record'); mkdirSync(mergeAddRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], mergeAddRepo);
  write(mergeAddRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(mergeAddRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(mergeAddRepo, 'seed merge-add policy');
  git(['checkout', '-q', '-b', 'record-add'], mergeAddRepo);
  write(mergeAddRepo, 'records/one.md', '# Added on side branch\n'); commit(mergeAddRepo, 'add side record');
  const sideAdmission = git(['rev-parse', 'HEAD'], mergeAddRepo).trim();
  git(['checkout', '-q', 'main'], mergeAddRepo);
  write(mergeAddRepo, 'README.md', '# Mainline work\n'); commit(mergeAddRepo, 'advance mainline');
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval',
    'merge', '--no-ff', '-m', 'merge side record', 'record-add'], mergeAddRepo);
  result = run(['adopt', '--root', mergeAddRepo, ...COLLECTION], mergeAddRepo);
  const mergeAddInventory = result.status === 0 ? JSON.parse(readFileSync(generated(mergeAddRepo, 'inventory.json'), 'utf8')) : null;
  check('merge-generated duplicate add preserves one semantic admission', result.status === 0
    && mergeAddInventory?.entries?.[0]?.introducedCommit === sideAdmission
    && mergeAddInventory?.adoptionReview?.candidates?.[0]?.history?.priorIncarnations === 0, result.output);

  const reusedPromotionRepo = join(work, 'reused-promotion-source'); mkdirSync(reusedPromotionRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], reusedPromotionRepo);
  write(reusedPromotionRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(reusedPromotionRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(reusedPromotionRepo, 'drafts/promoted.md', '# First incarnation\n');
  commit(reusedPromotionRepo, 'create first source incarnation');
  git(['rm', 'drafts/promoted.md'], reusedPromotionRepo);
  commit(reusedPromotionRepo, 'delete first source incarnation');
  write(reusedPromotionRepo, 'drafts/promoted.md', '# Second incarnation\n');
  commit(reusedPromotionRepo, 'recreate source path');
  mkdirSync(join(reusedPromotionRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], reusedPromotionRepo);
  commit(reusedPromotionRepo, 'promote reused source path');
  result = run(['adopt', '--root', reusedPromotionRepo, ...COLLECTION], reusedPromotionRepo);
  check('reused promotion source paths require review before generated writes', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(reusedPromotionRepo, name))), result.output);

  const readdedRepo = join(work, 'readded-record'); mkdirSync(readdedRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], readdedRepo);
  write(readdedRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(readdedRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(readdedRepo, 'records/one.md', '# First record incarnation\n'); commit(readdedRepo, 'add first record incarnation');
  git(['rm', 'records/one.md'], readdedRepo); commit(readdedRepo, 'remove first record incarnation');
  write(readdedRepo, 'records/one.md', '# Reviewed replacement incarnation\n'); commit(readdedRepo, 'add replacement record incarnation');
  const readdedAdmission = git(['rev-parse', 'HEAD'], readdedRepo).trim();
  writeFileSync(join(readdedRepo, '.git', 'info', 'exclude'), 'adoption-review.json\n');
  result = run(['plan-adoption', '--root', readdedRepo, ...COLLECTION, '--out', 'adoption-review.json'], readdedRepo);
  const readdedReview = JSON.parse(readFileSync(join(readdedRepo, 'adoption-review.json'), 'utf8'));
  readdedReview.candidates[0].disposition = 'freeze-current';
  readdedReview.candidates[0].rationale = 'The replacement incarnation is the reviewed immutable baseline.';
  writeFileSync(join(readdedRepo, 'adoption-review.json'), `${JSON.stringify(readdedReview, null, 2)}\n`);
  result = run(['adopt', '--root', readdedRepo, ...COLLECTION, '--review', 'adoption-review.json'], readdedRepo);
  const readdedInventory = result.status === 0 ? JSON.parse(readFileSync(generated(readdedRepo, 'inventory.json'), 'utf8')) : null;
  if (result.status === 0) commit(readdedRepo, 'adopt reviewed replacement incarnation');
  const readdedCheck = result.status === 0 ? run(['check', '--root', readdedRepo, ...COLLECTION], readdedRepo) : result;
  const readdedStrict = result.status === 0 ? run(['verify-history', '--strict', '--root', readdedRepo, ...COLLECTION], readdedRepo) : result;
  check('reviewed delete and re-add adopts the current exact-path admission', result.status === 0
    && readdedInventory?.entries?.[0]?.introducedCommit === readdedAdmission
    && readdedCheck.status === 0 && readdedStrict.status === 0, `${result.output}${readdedCheck.output}${readdedStrict.output}`);

  const renameBackRepo = join(work, 'rename-back-record'); mkdirSync(renameBackRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], renameBackRepo);
  write(renameBackRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(renameBackRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(renameBackRepo, 'records/a.md', '# Rename-back record\n'); commit(renameBackRepo, 'add record at a');
  git(['mv', 'records/a.md', 'records/b.md'], renameBackRepo); commit(renameBackRepo, 'move record to b');
  git(['mv', 'records/b.md', 'records/a.md'], renameBackRepo); commit(renameBackRepo, 'move record back to a');
  const renameBackAdmission = git(['rev-parse', 'HEAD'], renameBackRepo).trim();
  result = run(['adopt', '--root', renameBackRepo, ...COLLECTION], renameBackRepo);
  const renameBackInventory = result.status === 0 ? JSON.parse(readFileSync(generated(renameBackRepo, 'inventory.json'), 'utf8')) : null;
  if (result.status === 0) commit(renameBackRepo, 'adopt rename-back record');
  const renameBackCheck = result.status === 0 ? run(['check', '--root', renameBackRepo, ...COLLECTION], renameBackRepo) : result;
  const renameBackStrict = result.status === 0 ? run(['verify-history', '--strict', '--root', renameBackRepo, ...COLLECTION], renameBackRepo) : result;
  check('rename-back adoption uses the surviving exact-path admission', result.status === 0
    && renameBackInventory?.entries?.[0]?.introducedCommit === renameBackAdmission
    && renameBackCheck.status === 0 && renameBackStrict.status === 0, `${result.output}${renameBackCheck.output}${renameBackStrict.output}`);

  const reusedIntermediateRepo = join(work, 'reused-intermediate-promotion'); mkdirSync(reusedIntermediateRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], reusedIntermediateRepo);
  write(reusedIntermediateRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(reusedIntermediateRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(reusedIntermediateRepo, 'drafts/promoted.md', '# Prior intermediate incarnation\n');
  commit(reusedIntermediateRepo, 'create intermediate path');
  git(['rm', 'drafts/promoted.md'], reusedIntermediateRepo);
  commit(reusedIntermediateRepo, 'delete intermediate path');
  write(reusedIntermediateRepo, 'raw/origin.md', '# Current origin\n');
  commit(reusedIntermediateRepo, 'create terminal origin');
  mkdirSync(join(reusedIntermediateRepo, 'drafts'), { recursive: true });
  git(['mv', 'raw/origin.md', 'drafts/promoted.md'], reusedIntermediateRepo);
  commit(reusedIntermediateRepo, 'move through reused intermediate path');
  mkdirSync(join(reusedIntermediateRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], reusedIntermediateRepo);
  commit(reusedIntermediateRepo, 'promote through intermediate path');
  result = run(['adopt', '--root', reusedIntermediateRepo, ...COLLECTION], reusedIntermediateRepo);
  check('multi-hop promotion preserves prior intermediate-path incarnations', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(reusedIntermediateRepo, name))), result.output);

  const postDepartureReuseRepo = join(work, 'post-departure-lineage-reuse'); mkdirSync(postDepartureReuseRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], postDepartureReuseRepo);
  write(postDepartureReuseRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(postDepartureReuseRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(postDepartureReuseRepo, 'raw/origin.md', '# Live origin\n');
  commit(postDepartureReuseRepo, 'create live origin');
  write(postDepartureReuseRepo, 'drafts/.keep', '');
  git(['mv', 'raw/origin.md', 'drafts/stage.md'], postDepartureReuseRepo);
  commit(postDepartureReuseRepo, 'move live evidence to staging');
  write(postDepartureReuseRepo, 'raw/origin.md', '# Unrelated reuse\n');
  commit(postDepartureReuseRepo, 'reuse departed origin path');
  git(['rm', 'raw/origin.md'], postDepartureReuseRepo);
  commit(postDepartureReuseRepo, 'delete reused origin path');
  git(['mv', 'drafts/stage.md', 'drafts/promoted.md'], postDepartureReuseRepo);
  commit(postDepartureReuseRepo, 'advance staged evidence');
  mkdirSync(join(postDepartureReuseRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], postDepartureReuseRepo);
  commit(postDepartureReuseRepo, 'promote evidence after origin reuse');
  result = run(['adopt', '--root', postDepartureReuseRepo, ...COLLECTION], postDepartureReuseRepo);
  check('post-departure reuse on any lineage segment requires review', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(postDepartureReuseRepo, name))), result.output);

  const stagedNativeRepo = join(work, 'staged-native-classification'); mkdirSync(stagedNativeRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], stagedNativeRepo);
  write(stagedNativeRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(stagedNativeRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(stagedNativeRepo, 'seed staged native policy');
  write(stagedNativeRepo, 'records/native.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Native record\n');
  git(['add', 'records/native.md'], stagedNativeRepo);
  result = run(['classify', '--root', stagedNativeRepo, ...COLLECTION], stagedNativeRepo);
  check('classification separates staged native partition validity from adoption readiness', result.status === 0
    && result.output.includes('"classificationStatus": "partition-valid"')
    && result.output.includes('"status": "pending-commit"')
    && result.output.includes('"adoptionReadiness": "pending-commit"'), result.output);

  const revisedRepo = join(work, 'revised-record'); mkdirSync(revisedRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], revisedRepo);
  write(revisedRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(revisedRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(revisedRepo, 'records/one.md', '# Draft evidence\n');
  commit(revisedRepo, 'add evidence');
  write(revisedRepo, 'records/one.md', '# Final evidence\n');
  commit(revisedRepo, 'revise evidence before freeze');
  writeFileSync(join(revisedRepo, '.git', 'info', 'exclude'), 'adoption-review.json\n');
  result = run(['classify', '--root', revisedRepo, ...COLLECTION], revisedRepo);
  check('classification reports historical immutable revision as review required', result.status === 0
    && result.output.includes('"adoptionReadiness": "review-required"')
    && result.output.includes('"historyDigest"'), result.output);
  result = run(['adopt', '--root', revisedRepo, ...COLLECTION], revisedRepo);
  check('review-required adoption refuses without creating generated files', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(revisedRepo, name))), result.output);
  result = run(['plan-adoption', '--root', revisedRepo, ...COLLECTION, '--out', 'adoption-review.json'], revisedRepo);
  const reviewPath = join(revisedRepo, 'adoption-review.json');
  const reviewPlan = result.status === 0 ? JSON.parse(readFileSync(reviewPath, 'utf8')) : null;
  if (reviewPlan?.candidates?.[0]) {
    reviewPlan.candidates[0].disposition = 'freeze-current';
    reviewPlan.candidates[0].rationale = 'The final reviewed bytes are the intended immutable baseline.';
    writeFileSync(reviewPath, `${JSON.stringify(reviewPlan, null, 2)}\n`);
  }
  const staleReviewRepo = join(work, 'stale-review'); cpSync(revisedRepo, staleReviewRepo, { recursive: true });
  write(staleReviewRepo, 'records/one.md', '# Changed after review\n');
  commit(staleReviewRepo, 'change after review');
  result = run(['adopt', '--root', staleReviewRepo, ...COLLECTION, '--review', 'adoption-review.json'], staleReviewRepo);
  check('history movement invalidates a review receipt before any generated write', result.status === 1
    && result.output.includes('adoption review is stale')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(staleReviewRepo, name))), result.output);
  result = run(['adopt', '--root', revisedRepo, ...COLLECTION, '--review', reviewPath], revisedRepo);
  check('absolute adoption-review inputs explain the repository-relative contract', result.status === 1
    && result.output.includes('repository-relative')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(revisedRepo, name))), result.output);
  result = run(['adopt', '--root', revisedRepo, ...COLLECTION, '--review', 'adoption-review.json'], revisedRepo);
  const reviewedInventory = result.status === 0 ? JSON.parse(readFileSync(generated(revisedRepo, 'inventory.json'), 'utf8')) : null;
  check('digest-bound review permits adoption and persists its receipt', result.status === 0
    && reviewedInventory?.version === 3
    && /^[0-9a-f]{64}$/.test(reviewedInventory?.adoptionReview?.receiptDigest || '')
    && reviewedInventory?.adoptionReview?.reviewed?.[0]?.disposition === 'freeze-current'
    && reviewedInventory?.authorityBatches?.[0]?.type === 'genesis-adoption'
    && reviewedInventory?.authorityBatches?.[0]?.reviewReceiptDigest === reviewedInventory?.adoptionReview?.receiptDigest,
  result.output);

  const rewrittenHistoryRepo = join(work, 'rewritten-reviewed-history'); cpSync(revisedRepo, rewrittenHistoryRepo, { recursive: true });
  commit(rewrittenHistoryRepo, 'adopt reviewed record');
  squashCurrentTree(rewrittenHistoryRepo, 'squashed reviewed adoption');
  result = run(['check', '--root', rewrittenHistoryRepo, ...COLLECTION], rewrittenHistoryRepo);
  // The receipt bytes survive this rewrite. The trust model does not claim to detect total-history replacement.
  check('content-preserving history rewrites retain reviewed adoption authority', result.status === 0, result.output);

  const absoluteReviewRepo = join(work, 'absolute-review-path'); cpSync(repo, absoluteReviewRepo, { recursive: true });
  const absoluteReviewPath = join(work, 'outside-review.json');
  result = run(['plan-adoption', '--root', absoluteReviewRepo, ...COLLECTION, '--out', absoluteReviewPath], absoluteReviewRepo);
  check('absolute adoption-review paths explain the repository-relative contract', result.status === 1
    && result.output.includes('repository-relative') && !existsSync(absoluteReviewPath), result.output);

  const autocrlfRepo = join(work, 'autocrlf-checkout'); mkdirSync(autocrlfRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], autocrlfRepo);
  configuredGit(['config', 'core.autocrlf', 'true'], autocrlfRepo);
  write(autocrlfRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  const autocrlfManifest = fixtureManifest();
  autocrlfManifest.recordCollections[0].scopes = [
    { pattern: '*.md', kind: 'record', policy: 'append-only' },
    { pattern: 'mutable/**', kind: 'artifact', policy: 'mutable' },
    { pattern: 'frozen/**', kind: 'artifact', policy: 'frozen' },
  ];
  write(autocrlfRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(autocrlfManifest, null, 2)}\n`);
  write(autocrlfRepo, 'records/lf.md', '# LF record\n\n[frozen](records/frozen/lf.json)\n[mutable](records/mutable/live.json)\n');
  write(autocrlfRepo, 'records/crlf.md', '# CRLF record\r\n');
  write(autocrlfRepo, 'records/frozen/lf.json', '{"lf":true}\n');
  write(autocrlfRepo, 'records/mutable/live.json', '{"live":true}\n');
  writeFileSync(join(autocrlfRepo, 'records', 'frozen', 'binary.bin'), Buffer.from([0, 10, 13, 255]));
  commit(autocrlfRepo, 'seed mixed record bytes');
  const checkoutPaths = git(['ls-files', '-z'], autocrlfRepo, true).toString('utf8').split('\0').filter(Boolean);
  for (const path of checkoutPaths) rmSync(join(autocrlfRepo, ...path.split('/')), { force: true });
  configuredGit(['checkout', '--', '.'], autocrlfRepo);
  const lfBlob = configuredGit(['show', ':records/lf.md'], autocrlfRepo, true);
  const lfWorktree = readFileSync(join(autocrlfRepo, 'records', 'lf.md'));
  const crlfBlob = configuredGit(['show', ':records/crlf.md'], autocrlfRepo, true);
  const crlfWorktree = readFileSync(join(autocrlfRepo, 'records', 'crlf.md'));
  const binaryBlob = configuredGit(['show', ':records/frozen/binary.bin'], autocrlfRepo, true);
  const binaryWorktree = readFileSync(join(autocrlfRepo, 'records', 'frozen', 'binary.bin'));
  check('autocrlf fixture separates checkout representation from mixed canonical blobs', !lfBlob.equals(lfWorktree)
    && lfWorktree.includes(Buffer.from('\r\n')) && crlfBlob.equals(crlfWorktree) && binaryBlob.equals(binaryWorktree));
  result = run(['adopt', '--root', autocrlfRepo, ...COLLECTION], autocrlfRepo);
  const autocrlfAdopt = result;
  if (result.status === 0) result = run(['check', '--root', autocrlfRepo, ...COLLECTION], autocrlfRepo);
  check('record conformance uses canonical Git bytes across autocrlf checkouts', autocrlfAdopt.status === 0
    && result.status === 0, `${autocrlfAdopt.output}\n${result.output}`);
  write(autocrlfRepo, 'records/lf.md', '# semantic edit\r\n');
  result = run(['check', '--root', autocrlfRepo, ...COLLECTION], autocrlfRepo);
  check('canonical record checks still reject semantic unstaged edits', result.status === 1
    && result.output.includes('immutable record drift'), result.output);
  configuredGit(['checkout', '--', 'records/lf.md'], autocrlfRepo);
  configuredGit(['add', '--', 'hub/98 System/Records'], autocrlfRepo);
  configuredGit(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'adopt mixed records'], autocrlfRepo);
  write(autocrlfRepo, 'records/native.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Native\n\n[target](records/mutable/live.json)\n');
  configuredGit(['add', '--', 'records/native.md'], autocrlfRepo);
  rmSync(join(autocrlfRepo, 'records', 'native.md'));
  configuredGit(['checkout', '--', 'records/native.md'], autocrlfRepo);
  result = run(['append', '--root', autocrlfRepo, ...COLLECTION, '--record', 'records/native.md'], autocrlfRepo);
  check('native append accepts checkout-only transformations and stages canonical bytes', result.status === 0
    && result.output.includes('records/native.md'), result.output);
  configuredGit(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'append native record'], autocrlfRepo);
  const autocrlfInventory = JSON.parse(readFileSync(generated(autocrlfRepo, 'inventory.json'), 'utf8'));
  result = run(['curate', '--root', autocrlfRepo, ...COLLECTION, '--record', autocrlfInventory.entries[0].id,
    '--at', '2026-01-01T00:00:00.000Z', '--state', '{"status":"reviewed"}'], autocrlfRepo);
  if (result.status === 0) {
    configuredGit(['add', '--', 'hub/98 System/Records/curation.jsonl', 'hub/98 System/Records/index.md'], autocrlfRepo);
    configuredGit(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'curate mixed record'], autocrlfRepo);
    rmSync(generated(autocrlfRepo, 'curation.jsonl'));
    configuredGit(['checkout', '--', 'hub/98 System/Records/curation.jsonl'], autocrlfRepo);
    result = run(['check', '--root', autocrlfRepo, ...COLLECTION], autocrlfRepo);
  }
  check('non-empty curation ledgers verify across checkout transformations', result.status === 0
    && readFileSync(generated(autocrlfRepo, 'curation.jsonl')).includes(Buffer.from('\r\n')), result.output);

  const filteredRepo = join(work, 'clean-filter-checkout'); cpSync(autocrlfRepo, filteredRepo, { recursive: true });
  configuredGit(['config', 'filter.twist.clean', 'tr b a'], filteredRepo);
  configuredGit(['config', 'filter.twist.smudge', 'tr a b'], filteredRepo);
  write(filteredRepo, '.gitattributes', 'records/filtered.md filter=twist\n');
  write(filteredRepo, 'records/filtered.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Filtered native record\n');
  configuredGit(['add', '--', '.gitattributes', 'records/filtered.md'], filteredRepo);
  rmSync(join(filteredRepo, 'records', 'filtered.md'));
  configuredGit(['checkout', '--', 'records/filtered.md'], filteredRepo);
  const filteredAppend = run(['append', '--root', filteredRepo, ...COLLECTION, '--record', 'records/filtered.md'], filteredRepo);
  if (filteredAppend.status === 0) {
    configuredGit(['add', '--', '.gitattributes', 'records/filtered.md', 'hub/98 System/Records'], filteredRepo);
    configuredGit(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'append filtered record'], filteredRepo);
    rmSync(join(filteredRepo, 'records', 'filtered.md'));
    configuredGit(['checkout', '--', 'records/filtered.md'], filteredRepo);
    result = run(['check', '--root', filteredRepo, ...COLLECTION], filteredRepo);
  } else result = filteredAppend;
  const filteredIndex = configuredGit(['show', ':records/filtered.md'], filteredRepo);
  const filteredWorktree = readFileSync(join(filteredRepo, 'records', 'filtered.md'), 'utf8');
  const filteredDirty = configuredGit(['diff', '--name-only', '--', 'records/filtered.md'], filteredRepo).trim();
  check('native metadata uses canonical index bytes across clean and smudge filters', filteredAppend.status === 0
    && result.status === 0 && filteredIndex.includes('recordSchema: 1')
    && filteredWorktree.includes('recordSchemb: 1') && filteredDirty === '', `${filteredAppend.output}\n${result.output}`);

  result = run(['adopt', '--root', repo, ...COLLECTION], repo);
  check('adoption writes all four baselines', result.status === 0
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => existsSync(generated(repo, name))), result.output);
  const ambientRootAlias = join(work, 'ambient-root-alias');
  symlinkSync(repo, ambientRootAlias, process.platform === 'win32' ? 'junction' : 'dir');
  result = run(['render', '--root', ambientRootAlias, ...COLLECTION], ambientRootAlias);
  check('ambient repository root aliases permit representative writes', result.status === 0, result.output);
  const linkedOutputRepo = join(work, 'linked-output');
  cpSync(repo, linkedOutputRepo, { recursive: true });
  const linkedOutput = join(linkedOutputRepo, 'hub', '98 System', 'Records');
  const linkedOutputTarget = join(work, 'linked-output-target');
  const preservedIndex = readFileSync(join(repo, 'hub', '98 System', 'Records', 'index.md'), 'utf8');
  rmSync(linkedOutput, { recursive: true, force: true });
  mkdirSync(linkedOutputTarget, { recursive: true });
  for (const name of ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md']) {
    writeFileSync(join(linkedOutputTarget, name), readFileSync(generated(repo, name)));
  }
  symlinkSync(linkedOutputTarget, linkedOutput, process.platform === 'win32' ? 'junction' : 'dir');
  result = run(['render', '--root', linkedOutputRepo, ...COLLECTION], linkedOutputRepo);
  check('intra-repository aliases still reject writes before mutation', result.status === 1
    && result.output.includes('path escapes repository through a link')
    && readFileSync(join(linkedOutputTarget, 'index.md'), 'utf8') === preservedIndex, result.output);

  const inventory = JSON.parse(readFileSync(generated(repo, 'inventory.json'), 'utf8'));
  const citations = JSON.parse(readFileSync(generated(repo, 'citations.json'), 'utf8')).entries;
  const firstId = inventory.entries[0].id;
  check('identity is deterministic and label-independent', firstId === recordId(UUID, 'records/one.md'), firstId);
  check('collection split changes the namespace', firstId !== recordId('22222222-2222-4222-8222-222222222222', 'records/one.md'));
  check('exact Git path casing is identity-bearing', firstId !== recordId(UUID, 'records/ONE.md'));
  let nonNfcRejected = false;
  try { recordId(UUID, 'records/cafe\u0301.md'); } catch { nonNfcRejected = true; }
  check('non-NFC paths are rejected', nonNfcRejected);
  let drivePathRejected = false;
  try { recordId(UUID, 'C:/Windows/System32/evidence.md'); } catch { drivePathRejected = true; }
  check('Windows drive-qualified record paths are rejected on every platform', drivePathRejected);
  check('eight-character prefixes resolve', resolvePrefix(firstId.slice(0, 12), [firstId]) === firstId);
  let ambiguousPrefix = false;
  try { resolvePrefix('REC-AAAAAAAA', ['REC-AAAAAAAAAAAAAAAAAAAAAAAAAA', 'REC-AAAAAAAABBBBBBBBBBBBBBBBBB']); } catch { ambiguousPrefix = true; }
  check('ambiguous short prefixes fail', ambiguousPrefix);
  check('an unmatched backtick does not suppress a live citation', extractCitations('unmatched ` then [proof](records/missing.json)').length === 1);
  check('a shorter fence cannot close a longer fence', extractCitations('````md\n[hidden](records/missing.json)\n```\n[still hidden](records/missing.json)\n````').length === 0);
  check('multiline code spans do not create citation debt', extractCitations('`code span\n[example](records/missing.json)\n`').length === 0);
  check('unequal backtick runs remain literal citation text', extractCitations('`` [proof](records/missing.json) ```').length === 1);
  check('escaped backticks remain literal citation text', extractCitations('\\` [proof](records/missing.json) \\`').length === 1);
  check('escaped link openers do not create citation debt', extractCitations('Literal: \\[proof](records/missing.json)').length === 0);
  check('indented code blocks do not create citation debt', extractCitations('    [proof](records/missing.json)').length === 0);
  check('citation extraction resumes when a blockquote fence container ends',
    extractCitations('> ```yaml\n> example: true\n[proof](records/missing.json)').length === 1);
  check('citation extraction resumes when a list fence container ends',
    extractCitations('- example\n  ```yaml\n  hidden: true\n\n[proof](records/missing.json)').length === 1);
  check('invalid backtick-fence info strings do not suppress citations',
    extractCitations('```yaml `invalid\n[proof](records/missing.json)').length === 1);
  let unterminatedCitationError = '';
  try {
    extractCitations('```yaml\nexample: true\n[proof](records/missing.json)', 'records/broken.md');
  } catch (error) {
    unterminatedCitationError = String(error);
  }
  check('citation extraction rejects an unterminated fence',
    unterminatedCitationError.includes('unterminated Markdown fence in records/broken.md:1'),
    unterminatedCitationError);
  const atomicDir = join(work, 'atomic-probe'); mkdirSync(join(atomicDir, 'not-a-file'), { recursive: true });
  writeFileSync(join(atomicDir, 'first.txt'), 'before');
  let atomicRejected = false;
  try { writeAtomically([[join(atomicDir, 'first.txt'), 'after'], [join(atomicDir, 'not-a-file'), 'invalid']]); } catch { atomicRejected = true; }
  check('atomic preflight preserves earlier files when a later destination is invalid', atomicRejected
    && readFileSync(join(atomicDir, 'first.txt'), 'utf8') === 'before');
  const atomicRealDir = join(work, 'atomic-real');
  const atomicAliasDir = join(work, 'atomic-alias');
  mkdirSync(atomicRealDir, { recursive: true });
  writeFileSync(join(atomicRealDir, 'evidence.md'), 'immutable evidence');
  let symlinkWriteRejected = false;
  try {
    symlinkSync(atomicRealDir, atomicAliasDir, process.platform === 'win32' ? 'junction' : 'dir');
    try { writeAtomically([[join(atomicAliasDir, 'evidence.md'), 'clobbered']]); }
    catch { symlinkWriteRejected = true; }
  } catch { symlinkWriteRejected = process.platform === 'win32'; }
  check('atomic writes reject symlinked parent directories before changing evidence', symlinkWriteRejected
    && readFileSync(join(atomicRealDir, 'evidence.md'), 'utf8') === 'immutable evidence');

  const ambiguousRepo = join(work, 'ambiguous-history'); mkdirSync(ambiguousRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], ambiguousRepo);
  git(['config', 'user.email', 'eval@example.com'], ambiguousRepo);
  git(['config', 'user.name', 'Eval'], ambiguousRepo);
  write(ambiguousRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(ambiguousRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(ambiguousRepo, 'base without target');
  git(['checkout', '-qb', 'left'], ambiguousRepo);
  write(ambiguousRepo, 'records/mutable/branch.json', '{"branch":"A"}\n'); commit(ambiguousRepo, 'target A');
  git(['checkout', '-q', 'main'], ambiguousRepo);
  git(['checkout', '-qb', 'right'], ambiguousRepo);
  write(ambiguousRepo, 'records/mutable/branch.json', '{"branch":"B"}\n'); commit(ambiguousRepo, 'target B');
  git(['checkout', '-q', 'main'], ambiguousRepo);
  git(['merge', '--no-ff', 'left', '-m', 'merge left'], ambiguousRepo);
  try { git(['merge', '--no-ff', 'right', '-m', 'merge right'], ambiguousRepo); } catch { /* resolve add/add as deletion */ }
  if (existsSync(join(ambiguousRepo, 'records', 'mutable', 'branch.json'))) unlinkSync(join(ambiguousRepo, 'records', 'mutable', 'branch.json'));
  git(['add', '-A'], ambiguousRepo);
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'merge right with target deleted'], ambiguousRepo);
  write(ambiguousRepo, 'records/one.md', '# Record\n\n[target](records/mutable/branch.json)\n'); commit(ambiguousRepo, 'add record after deletion');
  result = run(['adopt', '--root', ambiguousRepo, ...COLLECTION], ambiguousRepo);
  const ambiguousCitations = result.status === 0
    ? JSON.parse(readFileSync(generated(ambiguousRepo, 'citations.json'), 'utf8')).entries : [];
  check('divergent reachable history remains ambiguous instead of choosing a branch', result.status === 0
    && ambiguousCitations.some((item) => item.state === 'ambiguous' && item.historicalCandidates?.length === 2 && !item.target), result.output);

  const futureRepo = join(work, 'future-history'); mkdirSync(futureRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], futureRepo);
  write(futureRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(futureRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(futureRepo, 'records/one.md', '# Record\n\n[future](records/mutable/future.json)\n'); commit(futureRepo, 'record before target');
  write(futureRepo, 'records/mutable/future.json', '{"future":true}\n'); commit(futureRepo, 'future target');
  result = run(['adopt', '--root', futureRepo, ...COLLECTION], futureRepo);
  const futureCitations = result.status === 0 ? JSON.parse(readFileSync(generated(futureRepo, 'citations.json'), 'utf8')).entries : [];
  check('adoption never binds content created after record introduction', result.status === 0
    && futureCitations.some((item) => item.rawTarget.endsWith('future.json') && item.state === 'dead-at-adoption' && !item.target), result.output);
  check('defensive literal-bracket path resolves exact first', citations.some((item) => item.rawTarget === 'records/literal[0].json'
    && item.resolvedVia.join(',') === 'exact' && item.state === 'resolved-immutable'), JSON.stringify(citations));
  check('compound suffixes retain applied order', citations.some((item) => item.rawTarget.includes('["PRIMARY"]#summary')
    && item.resolvedVia.join(',') === 'accessor-stripped,fragment-stripped'), JSON.stringify(citations));
  check('repeated accessors resolve in order', citations.some((item) => item.rawTarget.includes('["A"][0]')
    && item.resolvedVia.join(',') === 'accessor-stripped,accessor-stripped'), JSON.stringify(citations));
  check('range, symbol, fragment, and relative forms resolve', ['range-stripped', 'symbol-stripped', 'fragment-stripped'].every((via) => citations.some((item) => item.resolvedVia.includes(via)))
    && citations.some((item) => item.rawTarget.startsWith('./') && item.state === 'resolved-mutable'), JSON.stringify(citations));
  check('glob and baseline-dead citations remain visible debt', citations.some((item) => item.state === 'glob')
    && citations.some((item) => item.state === 'dead-at-adoption'), JSON.stringify(citations));
  check('Markdown image destinations are inventoried and digest-pinned', citations.some((item) => item.rawTarget.endsWith('chart.png')
    && item.state === 'resolved-mutable' && /^[0-9a-f]{64}$/.test(item.target.targetSha256)), JSON.stringify(citations));
  check('reference links and images resolve at their use sites', citations.some((item) => item.rawTarget === 'records/mutable/result.json' && item.sourceLine === 14)
    && citations.some((item) => item.rawTarget === 'records/mutable/chart.png' && item.sourceLine === 15), JSON.stringify(citations));
  check('shortcut and collapsed references resolve', citations.some((item) => item.rawTarget === 'records/mutable/stream.jsonl')
    && citations.some((item) => item.rawTarget === 'records/frozen/stable.json'), JSON.stringify(citations));
  check('fenced and inline code examples are not citations', !citations.some((item) => item.rawTarget.includes('never-code') || item.rawTarget.includes('never-fence')), JSON.stringify(citations));
  check('deleted targets recover as digest-pinned redirects', citations.some((item) => item.rawTarget.endsWith('old.json')
    && item.state === 'redirected' && /^[0-9a-f]{64}$/.test(item.target.targetSha256)), JSON.stringify(citations));

  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('fresh adoption passes semantic and history checks', result.status === 0
    && inventory.artifacts.every((artifact) => artifact.provenance === 'adopted'), result.output);
  commit(repo, 'adopt records');

  const corruptPostWriteScript = instrumentedRecordsScript('generated-post-write-script', (source) => source.replace(
    /(    writeAtomically\(writes\);\r?\n    wrote = true;\r?\n)(    verify\(\);)/,
    `$1    if (process.env.CODE_OPS_EVAL_CORRUPT_WRITE === '1') writeFileSync(writes[0][0], '{"corrupt":true}\\n');\n$2`,
  ));
  const corruptGenesisRepo = join(work, 'genesis-post-write-rollback'); cpSync(repo, corruptGenesisRepo, { recursive: true });
  git(['reset', '--hard', '-q', 'HEAD^'], corruptGenesisRepo);
  result = runWithScript(corruptPostWriteScript, ['adopt', '--root', corruptGenesisRepo, ...COLLECTION],
    corruptGenesisRepo, { CODE_OPS_EVAL_CORRUPT_WRITE: '1' });
  check('genesis admission removes every generated file when post-write verification fails', result.status === 1
    && result.output.includes('invalid record inventory header')
    && GENERATED_NAMES.every((name) => !existsSync(generated(corruptGenesisRepo, name))), result.output);

  const forgedGenesisReviewRepo = join(work, 'forged-genesis-review-binding');
  cpSync(repo, forgedGenesisReviewRepo, { recursive: true });
  git(['reset', '--hard', '-q', 'HEAD^'], forgedGenesisReviewRepo);
  result = run(['adopt', '--root', forgedGenesisReviewRepo, ...COLLECTION], forgedGenesisReviewRepo);
  if (result.status === 0) {
    const forgedGenesisPath = generated(forgedGenesisReviewRepo, 'inventory.json');
    const forgedGenesis = JSON.parse(readFileSync(forgedGenesisPath, 'utf8'));
    forgedGenesis.authorityBatches[0].reviewReceiptDigest = null;
    rehashAuthorityBatch(forgedGenesis.authorityBatches[0]);
    writeFileSync(forgedGenesisPath, `${JSON.stringify(forgedGenesis, null, 2)}\n`);
    commit(forgedGenesisReviewRepo, 'commit forged genesis review binding');
  }
  const forgedGenesisCheck = result.status === 0
    ? run(['check', '--root', forgedGenesisReviewRepo, ...COLLECTION], forgedGenesisReviewRepo) : result;
  check('genesis authority must retain its adoption review receipt binding', result.status === 0
    && forgedGenesisCheck.status === 1
    && forgedGenesisCheck.output.includes('authority genesis review binding mismatch'),
  `${result.output}\n${forgedGenesisCheck.output}`);

  const forgedGenesisManifestRepo = join(work, 'forged-genesis-manifest-binding');
  cpSync(repo, forgedGenesisManifestRepo, { recursive: true });
  git(['reset', '--hard', '-q', 'HEAD^'], forgedGenesisManifestRepo);
  result = run(['adopt', '--root', forgedGenesisManifestRepo, ...COLLECTION], forgedGenesisManifestRepo);
  if (result.status === 0) {
    const forgedGenesisManifestPath = generated(forgedGenesisManifestRepo, 'inventory.json');
    const forgedGenesisManifest = JSON.parse(readFileSync(forgedGenesisManifestPath, 'utf8'));
    forgedGenesisManifest.adoptionReview.manifestSha256 = '0'.repeat(64);
    delete forgedGenesisManifest.adoptionReview.receiptDigest;
    forgedGenesisManifest.adoptionReview.receiptDigest = digestJson(forgedGenesisManifest.adoptionReview);
    const forgedGenesisManifestBatch = forgedGenesisManifest.authorityBatches[0];
    forgedGenesisManifestBatch.manifestSha256 = forgedGenesisManifest.adoptionReview.manifestSha256;
    forgedGenesisManifestBatch.reviewReceiptDigest = forgedGenesisManifest.adoptionReview.receiptDigest;
    rehashAuthorityBatch(forgedGenesisManifestBatch);
    writeFileSync(forgedGenesisManifestPath, `${JSON.stringify(forgedGenesisManifest, null, 2)}\n`);
    commit(forgedGenesisManifestRepo, 'commit forged genesis manifest binding');
  }
  const forgedGenesisManifestCheck = result.status === 0
    ? run(['check', '--root', forgedGenesisManifestRepo, ...COLLECTION], forgedGenesisManifestRepo) : result;
  check('genesis authority binds the manifest at its introduction commit', result.status === 0
    && forgedGenesisManifestCheck.status === 1
    && forgedGenesisManifestCheck.output.includes('authority batch manifest does not match its introduction state: sequence 1'),
  `${result.output}\n${forgedGenesisManifestCheck.output}`);

  const sourceCandidateRepo = join(work, 'genesis-source-candidate-binding'); mkdirSync(sourceCandidateRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], sourceCandidateRepo);
  write(sourceCandidateRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(sourceCandidateRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(sourceCandidateRepo, 'seed collection policy');
  const sourceBeforeCandidate = git(['rev-parse', 'HEAD'], sourceCandidateRepo).trim();
  write(sourceCandidateRepo, 'records/one.md', '# Source-bound record\n');
  commit(sourceCandidateRepo, 'add source-bound record');
  result = run(['adopt', '--root', sourceCandidateRepo, ...COLLECTION], sourceCandidateRepo);
  if (result.status === 0) {
    const sourceCandidateInventoryPath = generated(sourceCandidateRepo, 'inventory.json');
    const sourceCandidateInventory = JSON.parse(readFileSync(sourceCandidateInventoryPath, 'utf8'));
    sourceCandidateInventory.adoptionReview.sourceHead = sourceBeforeCandidate;
    delete sourceCandidateInventory.adoptionReview.receiptDigest;
    sourceCandidateInventory.adoptionReview.receiptDigest = digestJson(sourceCandidateInventory.adoptionReview);
    rehashAuthorityChain(sourceCandidateInventory);
    writeFileSync(sourceCandidateInventoryPath, `${JSON.stringify(sourceCandidateInventory, null, 2)}\n`);
    commit(sourceCandidateRepo, 'commit early source binding');
  }
  const sourceCandidateCheck = result.status === 0
    ? run(['check', '--root', sourceCandidateRepo, ...COLLECTION], sourceCandidateRepo) : result;
  check('genesis review source must contain every adopted candidate', result.status === 0
    && sourceCandidateCheck.status === 1
    && sourceCandidateCheck.output.includes('adoption review source does not contain its candidate'),
  `${result.output}\n${sourceCandidateCheck.output}`);

  const sourceManifestRepo = join(work, 'genesis-source-manifest-binding'); mkdirSync(sourceManifestRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], sourceManifestRepo);
  write(sourceManifestRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  const oldSourceManifest = fixtureManifest(); oldSourceManifest.recordCollections[0].id = 'evidence-old';
  write(sourceManifestRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(oldSourceManifest, null, 2)}\n`);
  write(sourceManifestRepo, 'records/one.md', '# Manifest-bound record\n');
  commit(sourceManifestRepo, 'seed prior collection label');
  const priorManifestHead = git(['rev-parse', 'HEAD'], sourceManifestRepo).trim();
  write(sourceManifestRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(sourceManifestRepo, 'rename collection label');
  result = run(['adopt', '--root', sourceManifestRepo, ...COLLECTION], sourceManifestRepo);
  if (result.status === 0) {
    const sourceManifestInventoryPath = generated(sourceManifestRepo, 'inventory.json');
    const sourceManifestInventory = JSON.parse(readFileSync(sourceManifestInventoryPath, 'utf8'));
    sourceManifestInventory.adoptionReview.sourceHead = priorManifestHead;
    delete sourceManifestInventory.adoptionReview.receiptDigest;
    sourceManifestInventory.adoptionReview.receiptDigest = digestJson(sourceManifestInventory.adoptionReview);
    rehashAuthorityChain(sourceManifestInventory);
    writeFileSync(sourceManifestInventoryPath, `${JSON.stringify(sourceManifestInventory, null, 2)}\n`);
    commit(sourceManifestRepo, 'commit prior-manifest source binding');
  }
  const sourceManifestCheck = result.status === 0
    ? run(['check', '--root', sourceManifestRepo, ...COLLECTION], sourceManifestRepo) : result;
  check('genesis review source must contain the adopted manifest', result.status === 0
    && sourceManifestCheck.status === 1
    && sourceManifestCheck.output.includes('adoption authority batch manifest does not match its source state'),
  `${result.output}\n${sourceManifestCheck.output}`);

  const forgedCandidateHistoryRepo = join(work, 'forged-genesis-candidate-history'); cpSync(repo, forgedCandidateHistoryRepo, { recursive: true });
  git(['reset', '--hard', '-q', 'HEAD^'], forgedCandidateHistoryRepo);
  result = run(['adopt', '--root', forgedCandidateHistoryRepo, ...COLLECTION], forgedCandidateHistoryRepo);
  if (result.status === 0) {
    const forgedCandidateHistoryPath = generated(forgedCandidateHistoryRepo, 'inventory.json');
    const forgedCandidateHistory = JSON.parse(readFileSync(forgedCandidateHistoryPath, 'utf8'));
    const candidate = forgedCandidateHistory.adoptionReview.candidates
      .find((item) => forgedCandidateHistory.entries.some((entry) => entry.path === item.path));
    candidate.history.baselineCommit = 'f'.repeat(40);
    forgedCandidateHistory.entries.find((entry) => entry.path === candidate.path).baselineCommit = candidate.history.baselineCommit;
    delete forgedCandidateHistory.adoptionReview.receiptDigest;
    forgedCandidateHistory.adoptionReview.receiptDigest = digestJson(forgedCandidateHistory.adoptionReview);
    rehashAuthorityChain(forgedCandidateHistory);
    writeFileSync(forgedCandidateHistoryPath, `${JSON.stringify(forgedCandidateHistory, null, 2)}\n`);
    commit(forgedCandidateHistoryRepo, 'commit forged candidate history');
  }
  const forgedCandidateHistoryCheck = result.status === 0
    ? run(['check', '--root', forgedCandidateHistoryRepo, ...COLLECTION], forgedCandidateHistoryRepo) : result;
  check('reachable adoption sources bind the complete candidate history profile', result.status === 0
    && forgedCandidateHistoryCheck.status === 1
    && forgedCandidateHistoryCheck.output.includes('adoption review history drift'),
  `${result.output}\n${forgedCandidateHistoryCheck.output}`);

  const forgedEntryHistoryRepo = join(work, 'forged-adopted-entry-history'); cpSync(repo, forgedEntryHistoryRepo, { recursive: true });
  git(['reset', '--hard', '-q', 'HEAD^'], forgedEntryHistoryRepo);
  result = run(['adopt', '--root', forgedEntryHistoryRepo, ...COLLECTION], forgedEntryHistoryRepo);
  if (result.status === 0) {
    const forgedEntryHistoryPath = generated(forgedEntryHistoryRepo, 'inventory.json');
    const forgedEntryHistory = JSON.parse(readFileSync(forgedEntryHistoryPath, 'utf8'));
    forgedEntryHistory.entries[0].baselineCommit = 'e'.repeat(40);
    rehashAuthorityChain(forgedEntryHistory);
    writeFileSync(forgedEntryHistoryPath, `${JSON.stringify(forgedEntryHistory, null, 2)}\n`);
    commit(forgedEntryHistoryRepo, 'commit forged entry history');
  }
  const forgedEntryHistoryCheck = result.status === 0
    ? run(['check', '--root', forgedEntryHistoryRepo, ...COLLECTION], forgedEntryHistoryRepo) : result;
  check('adopted entry history must match its covering review candidate', result.status === 0
    && forgedEntryHistoryCheck.status === 1
    && forgedEntryHistoryCheck.output.includes('adopted record history does not match its review receipt'),
  `${result.output}\n${forgedEntryHistoryCheck.output}`);

  const incrementalRepo = join(work, 'incremental-admission'); cpSync(repo, incrementalRepo, { recursive: true });
  writeFileSync(join(incrementalRepo, '.git', 'info', 'exclude'), 'incremental-review.json\nincremental-two.json\nempty-review.json\nrequired-review.json\n');
  const genesisInventory = JSON.parse(readFileSync(generated(incrementalRepo, 'inventory.json'), 'utf8'));
  const genesisCitations = JSON.parse(readFileSync(generated(incrementalRepo, 'citations.json'), 'utf8'));
  const genesisLedger = readFileSync(generated(incrementalRepo, 'curation.jsonl'));
  write(incrementalRepo, 'records/incremental.md', `# Incremental

[live](records/mutable/result.json)
[frozen](records/frozen/incremental.json)
`);
  write(incrementalRepo, 'records/frozen/incremental.json', '{"incremental":1}\n');
  commit(incrementalRepo, 'commit authority after genesis');
  result = run(['check', '--root', incrementalRepo, ...COLLECTION], incrementalRepo);
  check('committed post-genesis records report pending admission', result.status === 1
    && result.output.includes('pending-admission') && result.output.includes('records/incremental.md'), result.output);
  const beforeIncrementalPlan = generatedSnapshot(incrementalRepo);
  result = run(['plan-adoption', '--incremental', '--root', incrementalRepo, ...COLLECTION,
    '--out', 'incremental-review.json'], incrementalRepo);
  const incrementalPlanPath = join(incrementalRepo, 'incremental-review.json');
  const incrementalPlan = result.status === 0 && existsSync(incrementalPlanPath)
    ? JSON.parse(readFileSync(incrementalPlanPath, 'utf8')) : null;
  const incrementalCandidatePaths = incrementalPlan?.candidates?.map((candidate) => candidate.path).sort() || [];
  check('incremental planning profiles only the committed immutable delta without generated writes', result.status === 0
    && incrementalPlan?.version === 2 && incrementalPlan?.mode === 'incremental'
    && JSON.stringify(incrementalCandidatePaths) === JSON.stringify([
      'records/frozen/incremental.json', 'records/incremental.md',
    ]) && generatedMatches(incrementalRepo, beforeIncrementalPlan), result.output);
  result = run(['adopt', '--root', incrementalRepo, ...COLLECTION, '--review', 'incremental-review.json'], incrementalRepo);
  let firstIncrementalOutput = null;
  try { firstIncrementalOutput = JSON.parse(result.output); } catch { /* asserted below */ }
  const firstIncrementalInventory = result.status === 0
    ? JSON.parse(readFileSync(generated(incrementalRepo, 'inventory.json'), 'utf8')) : null;
  const firstIncrementalCitations = result.status === 0
    ? JSON.parse(readFileSync(generated(incrementalRepo, 'citations.json'), 'utf8')) : null;
  check('incremental adoption preserves every prior authority object and the genesis receipt', result.status === 0
    && firstIncrementalOutput?.citations === 2
    && firstIncrementalInventory?.version === 3
    && digestJson(firstIncrementalInventory.entries.slice(0, genesisInventory.entries.length)) === digestJson(genesisInventory.entries)
    && digestJson(firstIncrementalInventory.artifacts.slice(0, genesisInventory.artifacts.length)) === digestJson(genesisInventory.artifacts)
    && firstIncrementalInventory.artifacts.find((artifact) => artifact.path === 'records/frozen/incremental.json')?.provenance === 'adopted'
    && digestJson(firstIncrementalInventory.adoptionReview) === digestJson(genesisInventory.adoptionReview)
    && digestJson(firstIncrementalCitations.entries.slice(0, genesisCitations.entries.length)) === digestJson(genesisCitations.entries)
    && genesisLedger.equals(readFileSync(generated(incrementalRepo, 'curation.jsonl'))), result.output);
  const firstAuthorityBatches = firstIncrementalInventory?.authorityBatches || [];
  check('first incremental mutation extends genesis with a reviewed authority batch', firstAuthorityBatches.length === 2
    && firstAuthorityBatches[0].type === 'genesis-adoption'
    && firstAuthorityBatches[1].type === 'incremental-adoption'
    && firstAuthorityBatches[1].previousBatchDigest === firstAuthorityBatches[0].batchDigest
    && firstAuthorityBatches[1].review?.receiptDigest === firstAuthorityBatches[1].reviewReceiptDigest,
  JSON.stringify(firstAuthorityBatches));
  const incrementalEntry = firstIncrementalInventory?.entries.find((entry) => entry.path === 'records/incremental.md');
  const firstIncrementalCheck = result.status === 0 ? run(['check', '--root', incrementalRepo, ...COLLECTION], incrementalRepo) : result;
  const firstIncrementalStrict = result.status === 0
    ? run(['verify-history', '--strict', '--root', incrementalRepo, ...COLLECTION], incrementalRepo) : result;
  check('incremental authority keeps deterministic IDs and passes complete-history verification', result.status === 0
    && incrementalEntry?.id === recordId(UUID, 'records/incremental.md')
    && firstIncrementalCheck.status === 0 && firstIncrementalStrict.status === 0,
  `${result.output}\n${firstIncrementalCheck.output}\n${firstIncrementalStrict.output}`);
  commit(incrementalRepo, 'admit first incremental authority');

  const earlyIncrementalSourceRepo = join(work, 'incremental-source-candidate-binding'); cpSync(incrementalRepo, earlyIncrementalSourceRepo, { recursive: true });
  const earlyIncrementalInventoryPath = generated(earlyIncrementalSourceRepo, 'inventory.json');
  const earlyIncrementalInventory = JSON.parse(readFileSync(earlyIncrementalInventoryPath, 'utf8'));
  const earlyIncrementalBatch = earlyIncrementalInventory.authorityBatches[1];
  const earlyIncrementalSource = git(['rev-parse', `${earlyIncrementalBatch.sourceHead}^`], earlyIncrementalSourceRepo).trim();
  earlyIncrementalBatch.sourceHead = earlyIncrementalSource;
  earlyIncrementalBatch.review.sourceHead = earlyIncrementalSource;
  rehashAuthorityChain(earlyIncrementalInventory);
  writeFileSync(earlyIncrementalInventoryPath, `${JSON.stringify(earlyIncrementalInventory, null, 2)}\n`);
  commit(earlyIncrementalSourceRepo, 'commit early incremental source binding');
  result = run(['check', '--root', earlyIncrementalSourceRepo, ...COLLECTION], earlyIncrementalSourceRepo);
  check('incremental review source must contain every admitted candidate', result.status === 1
    && result.output.includes('adoption review source does not contain its candidate'), result.output);

  const firstIncrementalCommitted = JSON.parse(readFileSync(generated(incrementalRepo, 'inventory.json'), 'utf8'));
  write(incrementalRepo, 'records/incremental-two.md', '# Incremental two\n');
  commit(incrementalRepo, 'commit second authority batch');
  result = run(['plan-adoption', '--incremental', '--root', incrementalRepo, ...COLLECTION,
    '--out', 'incremental-two.json'], incrementalRepo);
  if (result.status === 0) {
    result = run(['adopt', '--root', incrementalRepo, ...COLLECTION, '--review', 'incremental-two.json'], incrementalRepo);
  }
  const secondIncrementalInventory = result.status === 0
    ? JSON.parse(readFileSync(generated(incrementalRepo, 'inventory.json'), 'utf8')) : null;
  const secondAuthorityBatches = secondIncrementalInventory?.authorityBatches || [];
  check('a second incremental batch extends both authority prefixes and the batch chain', result.status === 0
    && digestJson(secondIncrementalInventory.entries.slice(0, firstIncrementalCommitted.entries.length)) === digestJson(firstIncrementalCommitted.entries)
    && digestJson(secondIncrementalInventory.artifacts.slice(0, firstIncrementalCommitted.artifacts.length)) === digestJson(firstIncrementalCommitted.artifacts)
    && digestJson(secondAuthorityBatches.slice(0, firstIncrementalCommitted.authorityBatches.length)) === digestJson(firstIncrementalCommitted.authorityBatches)
    && secondAuthorityBatches.at(-1)?.type === 'incremental-adoption'
    && secondAuthorityBatches.at(-1)?.previousBatchDigest === firstIncrementalCommitted.authorityBatches.at(-1).batchDigest,
  `${result.output}\n${JSON.stringify(secondAuthorityBatches)}`);
  const secondIncrementalCheck = result.status === 0 ? run(['check', '--root', incrementalRepo, ...COLLECTION], incrementalRepo) : result;
  check('two committed incremental batches remain conformant', result.status === 0 && secondIncrementalCheck.status === 0,
    `${result.output}\n${secondIncrementalCheck.output}`);
  commit(incrementalRepo, 'admit second incremental authority');

  const rewrittenBatchRepo = join(work, 'rewritten-committed-authority-batch');
  cpSync(incrementalRepo, rewrittenBatchRepo, { recursive: true });
  const rewrittenBatchPath = generated(rewrittenBatchRepo, 'inventory.json');
  const rewrittenBatchInventory = JSON.parse(readFileSync(rewrittenBatchPath, 'utf8'));
  rewrittenBatchInventory.authorityBatches[1].review.candidates.reverse();
  rehashAuthorityChain(rewrittenBatchInventory);
  writeFileSync(rewrittenBatchPath, `${JSON.stringify(rewrittenBatchInventory, null, 2)}\n`);
  commit(rewrittenBatchRepo, 'rewrite committed authority batch');
  result = run(['check', '--root', rewrittenBatchRepo, ...COLLECTION], rewrittenBatchRepo);
  check('committed authority batches remain a canonical append-only prefix', result.status === 1
    && result.output.includes('authority batch chain changed at entry 2'), result.output);

  const forgedBaseBindingsRepo = join(work, 'forged-authority-base-bindings');
  cpSync(incrementalRepo, forgedBaseBindingsRepo, { recursive: true });
  write(forgedBaseBindingsRepo, 'records/forged-bindings.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Forged bindings\n');
  git(['add', 'records/forged-bindings.md'], forgedBaseBindingsRepo);
  result = run(['append', '--root', forgedBaseBindingsRepo, ...COLLECTION,
    '--record', 'records/forged-bindings.md'], forgedBaseBindingsRepo);
  if (result.status === 0) {
    const forgedBindingsPath = generated(forgedBaseBindingsRepo, 'inventory.json');
    const forgedBindingsInventory = JSON.parse(readFileSync(forgedBindingsPath, 'utf8'));
    const forgedBindingsBatch = forgedBindingsInventory.authorityBatches.at(-1);
    forgedBindingsBatch.baseBindings.inventorySha256 = '0'.repeat(64);
    rehashAuthorityBatch(forgedBindingsBatch);
    writeFileSync(forgedBindingsPath, `${JSON.stringify(forgedBindingsInventory, null, 2)}\n`);
    commit(forgedBaseBindingsRepo, 'commit forged authority predecessor binding');
  }
  const forgedBindingsCheck = result.status === 0
    ? run(['check', '--root', forgedBaseBindingsRepo, ...COLLECTION], forgedBaseBindingsRepo) : result;
  check('authority batches bind the exact generated predecessor state', result.status === 0
    && forgedBindingsCheck.status === 1
    && forgedBindingsCheck.output.includes('authority batch base bindings do not match its predecessor state'),
  `${result.output}\n${forgedBindingsCheck.output}`);

  const incrementalTwoId = secondIncrementalInventory?.entries.find((entry) => entry.path === 'records/incremental-two.md')?.id;
  const preIncrementalCurationBatches = digestJson(secondIncrementalInventory?.authorityBatches || []);
  result = run(['curate', '--root', incrementalRepo, ...COLLECTION, '--record', incrementalTwoId,
    '--state', JSON.stringify({ status: 'superseded', supersededBy: incrementalEntry.id }),
    '--at', '2026-08-28T01:00:00.000Z'], incrementalRepo);
  const incrementalCurationCheck = result.status === 0
    ? run(['check', '--root', incrementalRepo, ...COLLECTION], incrementalRepo) : result;
  const incrementalCurationInventory = result.status === 0
    ? JSON.parse(readFileSync(generated(incrementalRepo, 'inventory.json'), 'utf8')) : null;
  const incrementalCurationEvents = result.status === 0
    ? readFileSync(generated(incrementalRepo, 'curation.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  check('incrementally admitted records use the ordinary supersession ledger and semantic index', result.status === 0
    && incrementalCurationCheck.status === 0 && incrementalCurationEvents.at(-1)?.recordId === incrementalTwoId
    && incrementalCurationEvents.at(-1)?.state?.status === 'superseded'
    && readFileSync(generated(incrementalRepo, 'index.md'), 'utf8').includes('superseded')
    && digestJson(incrementalCurationInventory?.authorityBatches || []) === preIncrementalCurationBatches,
  `${result.output}\n${incrementalCurationCheck.output}`);
  commit(incrementalRepo, 'curate incremental authority');

  const corruptCurationRepo = join(work, 'curation-post-write-rollback'); cpSync(incrementalRepo, corruptCurationRepo, { recursive: true });
  const corruptCurationSnapshot = generatedSnapshot(corruptCurationRepo);
  result = runWithScript(corruptPostWriteScript, ['curate', '--root', corruptCurationRepo, ...COLLECTION,
    '--record', incrementalTwoId, '--state', '{"status":"post-write-proof"}', '--at', '2026-08-28T01:30:00.000Z'],
  corruptCurationRepo, { CODE_OPS_EVAL_CORRUPT_WRITE: '1' });
  check('curation restores the prior ledger and index when post-write verification fails', result.status === 1
    && result.output.includes('curation ledger predecessor chain is invalid')
    && generatedMatches(corruptCurationRepo, corruptCurationSnapshot), result.output);

  const shallowManifestRaceRepo = join(work, 'shallow-post-write-manifest-race'); cpSync(incrementalRepo, shallowManifestRaceRepo, { recursive: true });
  const alternateManifest = fixtureManifest(); alternateManifest.recordCollections[0].id = 'evidence-new';
  write(shallowManifestRaceRepo, 'alternate-manifest.json', `${JSON.stringify(alternateManifest, null, 2)}\n`);
  const alternateManifestOid = git(['hash-object', '-w', 'alternate-manifest.json'], shallowManifestRaceRepo).trim();
  writeFileSync(join(shallowManifestRaceRepo, '.git', 'shallow'), `${git(['rev-parse', 'HEAD'], shallowManifestRaceRepo).trim()}\n`);
  const shallowManifestRaceScript = instrumentedRecordsScript('shallow-post-write-manifest-race-script', (source) => source.replace(
    '  manifestSha256(context);\n  const { rows } = collect(context);',
    `  manifestSha256(context);
  globalThis.__codeOpsEvalRunChecks = (globalThis.__codeOpsEvalRunChecks || 0) + 1;
  if (globalThis.__codeOpsEvalRunChecks === 2 && process.env.CODE_OPS_EVAL_SWAP_OID) {
    git(context.root, ['update-index', '--cacheinfo', '100644', process.env.CODE_OPS_EVAL_SWAP_OID, context.manifestRepoPath]);
    delete process.env.CODE_OPS_EVAL_SWAP_OID;
  }
  const { rows } = collect(context);`,
  ));
  const shallowManifestRaceSnapshot = generatedSnapshot(shallowManifestRaceRepo);
  result = runWithScript(shallowManifestRaceScript, ['render', '--root', shallowManifestRaceRepo, ...COLLECTION],
    shallowManifestRaceRepo, { CODE_OPS_EVAL_SWAP_OID: alternateManifestOid });
  check('post-write verification closes the manifest index race even without history', result.status === 1
    && result.output.includes('documentation manifest Git-index state changed during operation')
    && generatedMatches(shallowManifestRaceRepo, shallowManifestRaceSnapshot), result.output);

  const precedenceRepo = join(work, 'pending-evidence-precedence'); cpSync(incrementalRepo, precedenceRepo, { recursive: true });
  write(precedenceRepo, 'records/pending-with-index-failure.md', '# Pending while evidence is invalid\n');
  commit(precedenceRepo, 'commit pending record before evidence failure');
  const precedenceIndexPath = generated(precedenceRepo, 'index.md');
  const precedenceIndex = readFileSync(precedenceIndexPath, 'utf8');
  writeFileSync(precedenceIndexPath, precedenceIndex.replace(`<a id="${incrementalEntry.id}"></a>`, ''));
  result = run(['check', '--root', precedenceRepo, ...COLLECTION], precedenceRepo);
  check('existing semantic evidence failures take precedence over pending admission', result.status === 1
    && result.output.includes('semantic index anchors drift') && !result.output.includes('pending-admission'), result.output);

  const emptyIncrementalSnapshot = generatedSnapshot(incrementalRepo);
  result = run(['plan-adoption', '--incremental', '--root', incrementalRepo, ...COLLECTION,
    '--out', 'empty-review.json'], incrementalRepo);
  let emptyPlanOutput = null;
  try { emptyPlanOutput = JSON.parse(result.output); } catch { /* asserted below */ }
  check('empty incremental planning is an exit-zero write-free no-op', result.status === 0
    && emptyPlanOutput?.mode === 'incremental' && emptyPlanOutput?.status === 'no-op'
    && emptyPlanOutput?.reason === 'no-pending-admission' && emptyPlanOutput?.candidates === 0
    && !existsSync(join(incrementalRepo, 'empty-review.json'))
    && generatedMatches(incrementalRepo, emptyIncrementalSnapshot), result.output);
  const unsafeEmptyPlan = join(work, 'absolute-empty-review.json');
  result = run(['plan-adoption', '--incremental', '--root', incrementalRepo, ...COLLECTION,
    '--out', unsafeEmptyPlan], incrementalRepo);
  check('empty incremental planning still rejects an absolute output path before writes', result.status === 1
    && result.output.includes('adoption review path must be repository-relative and safe') && !existsSync(unsafeEmptyPlan)
    && generatedMatches(incrementalRepo, emptyIncrementalSnapshot), result.output);
  result = run(['plan-adoption', '--incremental', '--require-delta', '--root', incrementalRepo, ...COLLECTION,
    '--out', 'required-review.json'], incrementalRepo);
  check('require-delta refuses an empty incremental plan without writes', result.status === 1
    && result.output.includes('incremental admission requires at least one pending immutable path')
    && !existsSync(join(incrementalRepo, 'required-review.json'))
    && generatedMatches(incrementalRepo, emptyIncrementalSnapshot), result.output);

  const nativeMigrationRepo = join(work, 'native-v2-migration'); mkdirSync(nativeMigrationRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], nativeMigrationRepo);
  write(nativeMigrationRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(nativeMigrationRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(nativeMigrationRepo, 'records/one.md', '# Legacy v2 record\n');
  write(nativeMigrationRepo, 'records/mutable/result.json', '{"live":true}\n');
  write(nativeMigrationRepo, 'records/frozen/stable.json', '{"stable":true}\n');
  write(nativeMigrationRepo, 'records/exec/probe.py', 'print("legacy")\n');
  write(nativeMigrationRepo, 'records/literal[0].json', '{"literal":true}\n');
  commit(nativeMigrationRepo, 'seed legacy authority');
  let legacyV2BaselineCheck = { status: 1, output: 'legacy v2 baseline was not constructed' };
  result = run(['adopt', '--root', nativeMigrationRepo, ...COLLECTION], nativeMigrationRepo);
  if (result.status === 0) {
    const legacyInventoryPath = generated(nativeMigrationRepo, 'inventory.json');
    const legacyInventory = JSON.parse(readFileSync(legacyInventoryPath, 'utf8'));
    legacyInventory.version = 2;
    delete legacyInventory.authorityBatches;
    for (const artifact of legacyInventory.artifacts || []) delete artifact.provenance;
    writeFileSync(legacyInventoryPath, `${JSON.stringify(legacyInventory, null, 2)}\n`);
    run(['render', '--root', nativeMigrationRepo, ...COLLECTION], nativeMigrationRepo);
    legacyV2BaselineCheck = run(['check', '--root', nativeMigrationRepo, ...COLLECTION], nativeMigrationRepo);

    const wrongGenesisReviewRepo = join(work, 'wrong-genesis-review-version');
    cpSync(nativeMigrationRepo, wrongGenesisReviewRepo, { recursive: true });
    const wrongGenesisReviewPath = generated(wrongGenesisReviewRepo, 'inventory.json');
    const wrongGenesisReview = JSON.parse(readFileSync(wrongGenesisReviewPath, 'utf8'));
    wrongGenesisReview.adoptionReview.version = 2;
    wrongGenesisReview.adoptionReview.mode = 'incremental';
    wrongGenesisReview.adoptionReview.baseBindings = {
      authorityBatchHead: null,
      citationsSha256: '0'.repeat(64),
      curationLedgerSha256: '0'.repeat(64),
      indexSha256: '0'.repeat(64),
      inventorySha256: '0'.repeat(64),
    };
    delete wrongGenesisReview.adoptionReview.receiptDigest;
    wrongGenesisReview.adoptionReview.receiptDigest = digestJson(wrongGenesisReview.adoptionReview);
    writeFileSync(wrongGenesisReviewPath, `${JSON.stringify(wrongGenesisReview, null, 2)}\n`);
    const wrongGenesisReviewCheck = run(['check', '--root', wrongGenesisReviewRepo, ...COLLECTION], wrongGenesisReviewRepo);
    check('singular genesis adoption review requires receipt version one', wrongGenesisReviewCheck.status === 1
      && wrongGenesisReviewCheck.output.includes('invalid record adoption review'), wrongGenesisReviewCheck.output);

    commit(nativeMigrationRepo, 'establish legacy v2 baseline');
  }
  const nativeMigrationGenesis = JSON.parse(readFileSync(generated(nativeMigrationRepo, 'inventory.json'), 'utf8'));
  write(nativeMigrationRepo, 'records/native-migration.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Native migration\n');
  git(['add', 'records/native-migration.md'], nativeMigrationRepo);
  result = run(['append', '--root', nativeMigrationRepo, ...COLLECTION, '--record', 'records/native-migration.md'], nativeMigrationRepo);
  const nativeMigrationInventory = result.status === 0
    ? JSON.parse(readFileSync(generated(nativeMigrationRepo, 'inventory.json'), 'utf8')) : null;
  const nativeMigrationCheck = result.status === 0 ? run(['check', '--root', nativeMigrationRepo, ...COLLECTION], nativeMigrationRepo) : result;
  check('native append migrates v2 authority before recording native membership', result.status === 0
    && legacyV2BaselineCheck.status === 0 && nativeMigrationCheck.status === 0 && nativeMigrationInventory?.version === 3
    && nativeMigrationInventory.authorityBatches?.map((batch) => batch.type).join(',') === 'v2-migration,native-append'
    && digestJson(nativeMigrationInventory.adoptionReview) === digestJson(nativeMigrationGenesis.adoptionReview)
    && digestJson(nativeMigrationInventory.entries.slice(0, nativeMigrationGenesis.entries.length)) === digestJson(nativeMigrationGenesis.entries)
    && nativeMigrationInventory.artifacts.slice(0, nativeMigrationGenesis.artifacts.length)
      .every((artifact) => !Object.hasOwn(artifact, 'provenance')),
  `${result.output}\n${legacyV2BaselineCheck.output}\n${nativeMigrationCheck.output}`);

  const missingIncrementalReviewRepo = join(work, 'missing-incremental-review');
  cpSync(incrementalRepo, missingIncrementalReviewRepo, { recursive: true });
  const missingIncrementalReviewPath = generated(missingIncrementalReviewRepo, 'inventory.json');
  const missingIncrementalReview = JSON.parse(readFileSync(missingIncrementalReviewPath, 'utf8'));
  const unreviewedIncrementalBatch = missingIncrementalReview.authorityBatches.at(-1);
  unreviewedIncrementalBatch.review = null;
  unreviewedIncrementalBatch.reviewReceiptDigest = null;
  rehashAuthorityBatch(unreviewedIncrementalBatch);
  writeFileSync(missingIncrementalReviewPath, `${JSON.stringify(missingIncrementalReview, null, 2)}\n`);
  result = run(['check', '--root', missingIncrementalReviewRepo, ...COLLECTION], missingIncrementalReviewRepo);
  check('an incremental authority batch cannot discard its embedded review receipt', result.status === 1
    && result.output.includes('incremental authority batch lacks its review receipt'), result.output);

  const embeddedNativeReviewRepo = join(work, 'native-batch-with-review');
  cpSync(nativeMigrationRepo, embeddedNativeReviewRepo, { recursive: true });
  const embeddedNativeReviewPath = generated(embeddedNativeReviewRepo, 'inventory.json');
  const embeddedNativeReview = JSON.parse(readFileSync(embeddedNativeReviewPath, 'utf8'));
  const reviewedNativeBatch = embeddedNativeReview.authorityBatches.at(-1);
  reviewedNativeBatch.review = structuredClone(embeddedNativeReview.adoptionReview);
  rehashAuthorityBatch(reviewedNativeBatch);
  writeFileSync(embeddedNativeReviewPath, `${JSON.stringify(embeddedNativeReview, null, 2)}\n`);
  result = run(['check', '--root', embeddedNativeReviewRepo, ...COLLECTION], embeddedNativeReviewRepo);
  check('a non-incremental authority batch cannot embed an adoption review', result.status === 1
    && result.output.includes('non-incremental authority batch embeds a review'), result.output);

  const desynchronizedGenesisRepo = join(work, 'desynchronized-genesis-source');
  cpSync(incrementalRepo, desynchronizedGenesisRepo, { recursive: true });
  const desynchronizedGenesisPath = generated(desynchronizedGenesisRepo, 'inventory.json');
  const desynchronizedGenesis = JSON.parse(readFileSync(desynchronizedGenesisPath, 'utf8'));
  const desynchronizedGenesisBatch = desynchronizedGenesis.authorityBatches[0];
  desynchronizedGenesisBatch.sourceHead = git(['rev-parse', 'HEAD'], desynchronizedGenesisRepo).trim();
  rehashAuthorityBatch(desynchronizedGenesisBatch);
  writeFileSync(desynchronizedGenesisPath, `${JSON.stringify(desynchronizedGenesis, null, 2)}\n`);
  result = run(['check', '--root', desynchronizedGenesisRepo, ...COLLECTION], desynchronizedGenesisRepo);
  check('genesis authority cannot desynchronize from its adoption review source', result.status === 1
    && result.output.includes('authority genesis contradicts its adoption review'), result.output);

  const manufacturedMigrationProvenanceRepo = join(work, 'manufactured-migration-provenance');
  cpSync(nativeMigrationRepo, manufacturedMigrationProvenanceRepo, { recursive: true });
  const manufacturedMigrationProvenancePath = generated(manufacturedMigrationProvenanceRepo, 'inventory.json');
  const manufacturedMigrationProvenance = JSON.parse(readFileSync(manufacturedMigrationProvenancePath, 'utf8'));
  const inheritedArtifactRef = manufacturedMigrationProvenance.authorityBatches[0].objects
    .find((ref) => ref.type === 'artifact');
  manufacturedMigrationProvenance.artifacts.find((artifact) => artifact.path === inheritedArtifactRef.path)
    .provenance = 'adopted';
  rehashAuthorityChain(manufacturedMigrationProvenance);
  writeFileSync(manufacturedMigrationProvenancePath, `${JSON.stringify(manufacturedMigrationProvenance, null, 2)}\n`);
  result = run(['check', '--root', manufacturedMigrationProvenanceRepo, ...COLLECTION], manufacturedMigrationProvenanceRepo);
  check('a v2 migration batch cannot manufacture artifact provenance', result.status === 1
    && result.output.includes('v2 migration cannot manufacture artifact provenance'), result.output);

  const unreachableNativeSourceRepo = join(work, 'unreachable-native-source');
  cpSync(nativeMigrationRepo, unreachableNativeSourceRepo, { recursive: true });
  const unreachableNativeSourcePath = generated(unreachableNativeSourceRepo, 'inventory.json');
  const unreachableNativeSource = JSON.parse(readFileSync(unreachableNativeSourcePath, 'utf8'));
  unreachableNativeSource.authorityBatches.at(-1).sourceHead = 'f'.repeat(40);
  rehashAuthorityBatch(unreachableNativeSource.authorityBatches.at(-1));
  writeFileSync(unreachableNativeSourcePath, `${JSON.stringify(unreachableNativeSource, null, 2)}\n`);
  result = run(['check', '--root', unreachableNativeSourceRepo, ...COLLECTION], unreachableNativeSourceRepo);
  check('native authority requires a source commit reachable from HEAD', result.status === 1
    && result.output.includes('authority batch source commit is not reachable from HEAD'), result.output);

  const malformedNativeRefRepo = join(work, 'malformed-native-reference');
  cpSync(nativeMigrationRepo, malformedNativeRefRepo, { recursive: true });
  const malformedNativeRefPath = generated(malformedNativeRefRepo, 'inventory.json');
  const malformedNativeRef = JSON.parse(readFileSync(malformedNativeRefPath, 'utf8'));
  malformedNativeRef.authorityBatches.at(-1).objects = [null];
  rehashAuthorityBatch(malformedNativeRef.authorityBatches.at(-1));
  writeFileSync(malformedNativeRefPath, `${JSON.stringify(malformedNativeRef, null, 2)}\n`);
  result = run(['check', '--root', malformedNativeRefRepo, ...COLLECTION], malformedNativeRefRepo);
  check('malformed native authority references report their schema error without crashing', result.status === 1
    && result.output.includes('invalid authority object reference') && !result.output.includes('TypeError'), result.output);

  const uncoveredAuthorityRepo = join(work, 'uncovered-authority'); cpSync(nativeMigrationRepo, uncoveredAuthorityRepo, { recursive: true });
  const uncoveredAuthorityPath = generated(uncoveredAuthorityRepo, 'inventory.json');
  const uncoveredAuthority = JSON.parse(readFileSync(uncoveredAuthorityPath, 'utf8'));
  const uncoveredBatch = uncoveredAuthority.authorityBatches.at(-1);
  uncoveredBatch.objects = [];
  const previouslyCovered = uncoveredAuthority.authorityBatches.slice(0, -1).flatMap((batch) => batch.objects);
  uncoveredBatch.authorityDigest = authorityRefDigest(previouslyCovered);
  rehashAuthorityBatch(uncoveredBatch);
  writeFileSync(uncoveredAuthorityPath, `${JSON.stringify(uncoveredAuthority, null, 2)}\n`);
  result = run(['check', '--root', uncoveredAuthorityRepo, ...COLLECTION], uncoveredAuthorityRepo);
  check('validly rehashed batches cannot leave authority objects uncovered', result.status === 1
    && result.output.includes('authority object lacks batch coverage'), result.output);

  const duplicateCoverageRepo = join(work, 'duplicate-authority-coverage'); cpSync(nativeMigrationRepo, duplicateCoverageRepo, { recursive: true });
  const duplicateCoveragePath = generated(duplicateCoverageRepo, 'inventory.json');
  const duplicateCoverage = JSON.parse(readFileSync(duplicateCoveragePath, 'utf8'));
  const duplicateRef = structuredClone(duplicateCoverage.authorityBatches.at(-1).objects[0]);
  duplicateCoverage.authorityBatches[0].objects.push(duplicateRef);
  duplicateCoverage.authorityBatches[0].objects.sort((left, right) => {
    const leftKey = `${left.type}:${left.path}`; const rightKey = `${right.type}:${right.path}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  duplicateCoverage.authorityBatches[0].authorityDigest = authorityRefDigest(duplicateCoverage.authorityBatches[0].objects);
  rehashAuthorityBatch(duplicateCoverage.authorityBatches[0]);
  duplicateCoverage.authorityBatches[1].previousBatchDigest = duplicateCoverage.authorityBatches[0].batchDigest;
  duplicateCoverage.authorityBatches[1].baseBindings.authorityBatchHead = duplicateCoverage.authorityBatches[0].batchDigest;
  duplicateCoverage.authorityBatches[1].priorAuthorityDigest = duplicateCoverage.authorityBatches[0].authorityDigest;
  rehashAuthorityBatch(duplicateCoverage.authorityBatches[1]);
  writeFileSync(duplicateCoveragePath, `${JSON.stringify(duplicateCoverage, null, 2)}\n`);
  result = run(['check', '--root', duplicateCoverageRepo, ...COLLECTION], duplicateCoverageRepo);
  check('validly rehashed batches cannot duplicate authority coverage', result.status === 1
    && result.output.includes('authority object has duplicate batch coverage'), result.output);

  const batchProvenanceRepo = join(work, 'authority-batch-provenance'); cpSync(incrementalRepo, batchProvenanceRepo, { recursive: true });
  write(batchProvenanceRepo, 'records/native-provenance.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Native provenance\n');
  git(['add', 'records/native-provenance.md'], batchProvenanceRepo);
  const batchProvenanceSeed = run(['append', '--root', batchProvenanceRepo, ...COLLECTION,
    '--record', 'records/native-provenance.md'], batchProvenanceRepo);

  const adoptedRecordNativeRepo = join(work, 'adopted-record-in-native-batch'); cpSync(batchProvenanceRepo, adoptedRecordNativeRepo, { recursive: true });
  const adoptedRecordNativePath = generated(adoptedRecordNativeRepo, 'inventory.json');
  const adoptedRecordNative = JSON.parse(readFileSync(adoptedRecordNativePath, 'utf8'));
  const relabeledRecord = adoptedRecordNative.entries.find((entry) => entry.provenance === 'adopted');
  relabeledRecord.provenance = 'native';
  relabeledRecord.introducedCommit = null;
  relabeledRecord.introducedIndexHead = adoptedRecordNative.authorityBatches.at(-1).sourceHead;
  relabeledRecord.supersedes = [];
  delete relabeledRecord.baselineCommit;
  moveAuthorityRef(adoptedRecordNative, adoptedRecordNative.authorityBatches[0], adoptedRecordNative.authorityBatches.at(-1),
    (ref) => ref.type === 'record' && ref.path === relabeledRecord.path);
  writeFileSync(adoptedRecordNativePath, `${JSON.stringify(adoptedRecordNative, null, 2)}\n`);
  result = run(['check', '--root', adoptedRecordNativeRepo, ...COLLECTION], adoptedRecordNativeRepo);
  check('a validly rehashed native batch cannot relabel a historical record as native', batchProvenanceSeed.status === 0
    && result.status === 1 && result.output.includes('native authority batch contradicts record provenance'),
  `${batchProvenanceSeed.output}\n${result.output}`);

  const adoptedArtifactNativeRepo = join(work, 'adopted-artifact-in-native-batch'); cpSync(batchProvenanceRepo, adoptedArtifactNativeRepo, { recursive: true });
  const adoptedArtifactNativePath = generated(adoptedArtifactNativeRepo, 'inventory.json');
  const adoptedArtifactNative = JSON.parse(readFileSync(adoptedArtifactNativePath, 'utf8'));
  const relabeledArtifact = adoptedArtifactNative.artifacts.find((artifact) => artifact.provenance === 'adopted');
  relabeledArtifact.provenance = 'native';
  relabeledArtifact.introducedIndexHead = adoptedArtifactNative.authorityBatches.at(-1).sourceHead;
  moveAuthorityRef(adoptedArtifactNative, adoptedArtifactNative.authorityBatches[0], adoptedArtifactNative.authorityBatches.at(-1),
    (ref) => ref.type === 'artifact' && ref.path === relabeledArtifact.path);
  writeFileSync(adoptedArtifactNativePath, `${JSON.stringify(adoptedArtifactNative, null, 2)}\n`);
  result = run(['check', '--root', adoptedArtifactNativeRepo, ...COLLECTION], adoptedArtifactNativeRepo);
  check('a validly rehashed native batch cannot relabel a historical frozen artifact as native', batchProvenanceSeed.status === 0
    && result.status === 1 && result.output.includes('native authority batch contradicts artifact provenance'),
  `${batchProvenanceSeed.output}\n${result.output}`);

  const reusedNativeRepo = join(work, 'reused-path-forged-native'); mkdirSync(reusedNativeRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], reusedNativeRepo);
  write(reusedNativeRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(reusedNativeRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(reusedNativeRepo, 'records/one.md', '# Seed\n');
  commit(reusedNativeRepo, 'seed surviving authority');
  git(['checkout', '-q', '-b', 'hidden-native-history'], reusedNativeRepo);
  write(reusedNativeRepo, 'records/reused.md', '# Historical incarnation\n');
  commit(reusedNativeRepo, 'seed a historical record path on a side branch');
  git(['rm', 'records/reused.md'], reusedNativeRepo);
  commit(reusedNativeRepo, 'delete the historical record path on the side branch');
  git(['checkout', '-q', 'main'], reusedNativeRepo);
  write(reusedNativeRepo, 'README.md', '# Mainline advancement\n');
  commit(reusedNativeRepo, 'advance main before hidden native history');
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval',
    'merge', '--no-ff', '-m', 'merge hidden native history', 'hidden-native-history'], reusedNativeRepo);
  result = run(['adopt', '--root', reusedNativeRepo, ...COLLECTION], reusedNativeRepo);
  if (result.status === 0) commit(reusedNativeRepo, 'adopt the surviving record');
  write(reusedNativeRepo, 'records/legitimate.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Legitimate native\n');
  git(['add', 'records/legitimate.md'], reusedNativeRepo);
  const legitimateNative = run(['append', '--root', reusedNativeRepo, ...COLLECTION,
    '--record', 'records/legitimate.md'], reusedNativeRepo);
  const reusedInventoryPath = generated(reusedNativeRepo, 'inventory.json');
  const reusedInventory = JSON.parse(readFileSync(reusedInventoryPath, 'utf8'));
  const reusedCitations = JSON.parse(readFileSync(generated(reusedNativeRepo, 'citations.json'), 'utf8'));
  const reusedLedgerText = readFileSync(generated(reusedNativeRepo, 'curation.jsonl'), 'utf8').trim();
  const reusedEvents = reusedLedgerText ? reusedLedgerText.split(/\r?\n/).map(JSON.parse) : [];
  const forgedNativeBase = fixtureGeneratedBindings(reusedInventory, reusedCitations, reusedEvents);
  const forgedNativeSource = reusedInventory.authorityBatches.at(-1).sourceHead;
  write(reusedNativeRepo, 'records/reused.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Reused native\n');
  git(['add', 'records/reused.md'], reusedNativeRepo);
  const reusedEntry = {
    id: recordId(UUID, 'records/reused.md'), identityVersion: 1, path: 'records/reused.md', provenance: 'native',
    sha256: sha256(readFileSync(join(reusedNativeRepo, 'records', 'reused.md'))), kind: 'record', policy: 'append-only',
    introducedCommit: null, introducedIndexHead: forgedNativeSource, supersedes: [],
  };
  const priorNativeRefs = inventoryAuthorityRefs(reusedInventory);
  reusedInventory.entries.push(reusedEntry);
  const reusedRef = { type: 'record', path: reusedEntry.path, objectDigest: digestJson(reusedEntry) };
  const forgedNativeBatch = {
    version: 1, sequence: reusedInventory.authorityBatches.length + 1, type: 'native-append',
    previousBatchDigest: reusedInventory.authorityBatches.at(-1).batchDigest, sourceHead: forgedNativeSource,
    manifestSha256: sha256(readFileSync(join(reusedNativeRepo, 'hub', '98 System', 'DOCS_MANIFEST.json'))),
    priorAuthorityDigest: authorityRefDigest(priorNativeRefs),
    authorityDigest: authorityRefDigest([...priorNativeRefs, reusedRef]), baseBindings: forgedNativeBase,
    objects: [reusedRef], review: null, reviewReceiptDigest: null,
  };
  rehashAuthorityBatch(forgedNativeBatch); reusedInventory.authorityBatches.push(forgedNativeBatch);
  writeFileSync(reusedInventoryPath, `${JSON.stringify(reusedInventory, null, 2)}\n`);
  result = run(['check', '--root', reusedNativeRepo, ...COLLECTION], reusedNativeRepo);
  check('merge-simplified history cannot hide an earlier exact path from a forged native batch', legitimateNative.status === 0
    && result.status === 1 && result.output.includes('native authority path has history before admission: records/reused.md'),
  `${legitimateNative.output}\n${result.output}`);

  const reusedArtifactRepo = join(work, 'reused-artifact-forged-native'); mkdirSync(reusedArtifactRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], reusedArtifactRepo);
  write(reusedArtifactRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(reusedArtifactRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(reusedArtifactRepo, 'records/one.md', '# Seed\n');
  write(reusedArtifactRepo, 'records/frozen/reused.json', '{"historical":true}\n');
  commit(reusedArtifactRepo, 'seed a historical artifact path');
  git(['rm', 'records/frozen/reused.json'], reusedArtifactRepo); commit(reusedArtifactRepo, 'delete the historical artifact path');
  result = run(['adopt', '--root', reusedArtifactRepo, ...COLLECTION], reusedArtifactRepo);
  if (result.status === 0) commit(reusedArtifactRepo, 'adopt before the native artifact transaction');
  write(reusedArtifactRepo, 'records/native-artifact.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Native artifact\n');
  write(reusedArtifactRepo, 'records/frozen/template.json', '{"native":true}\n');
  git(['add', 'records/native-artifact.md', 'records/frozen/template.json'], reusedArtifactRepo);
  const legitimateArtifactBatch = run(['append', '--root', reusedArtifactRepo, ...COLLECTION,
    '--record', 'records/native-artifact.md'], reusedArtifactRepo);
  const reusedArtifactPath = generated(reusedArtifactRepo, 'inventory.json');
  const reusedArtifactInventory = JSON.parse(readFileSync(reusedArtifactPath, 'utf8'));
  const nativeArtifact = reusedArtifactInventory.artifacts.find((artifact) => artifact.path === 'records/frozen/template.json');
  nativeArtifact.path = 'records/frozen/reused.json';
  const nativeArtifactBatch = reusedArtifactInventory.authorityBatches.at(-1);
  nativeArtifactBatch.objects.find((ref) => ref.path === 'records/frozen/template.json').path = nativeArtifact.path;
  rehashAuthorityChain(reusedArtifactInventory);
  git(['rm', '-f', 'records/frozen/template.json'], reusedArtifactRepo);
  write(reusedArtifactRepo, 'records/frozen/reused.json', '{"native":true}\n');
  git(['add', 'records/frozen/reused.json'], reusedArtifactRepo);
  writeFileSync(reusedArtifactPath, `${JSON.stringify(reusedArtifactInventory, null, 2)}\n`);
  result = run(['check', '--root', reusedArtifactRepo, ...COLLECTION], reusedArtifactRepo);
  check('native artifact authority cannot reuse a historically deleted exact path', legitimateArtifactBatch.status === 0
    && result.status === 1 && result.output.includes('native authority path has history before admission: records/frozen/reused.json'),
  `${legitimateArtifactBatch.output}\n${result.output}`);

  const separatedNativeRepo = join(work, 'native-path-before-batch'); cpSync(repo, separatedNativeRepo, { recursive: true });
  write(separatedNativeRepo, 'records/separated.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Separated native\n');
  git(['add', 'records/separated.md'], separatedNativeRepo);
  const separatedNative = run(['append', '--root', separatedNativeRepo, ...COLLECTION,
    '--record', 'records/separated.md'], separatedNativeRepo);
  if (separatedNative.status === 0) {
    git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm',
      'commit native path before its authority batch', '--only', '--', 'records/separated.md'], separatedNativeRepo);
    commit(separatedNativeRepo, 'commit delayed native authority batch');
  }
  result = separatedNative.status === 0
    ? run(['check', '--root', separatedNativeRepo, ...COLLECTION], separatedNativeRepo)
    : separatedNative;
  check('native authority path must first appear in the same commit as its batch', separatedNative.status === 0
    && result.status === 1 && result.output.includes('native authority path was not introduced with its batch: records/separated.md'),
  `${separatedNative.output}\n${result.output}`);

  const falseMigrationRepo = join(work, 'fresh-v3-false-migration'); mkdirSync(falseMigrationRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], falseMigrationRepo);
  write(falseMigrationRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(falseMigrationRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(falseMigrationRepo, 'records/one.md', '# Fresh v3\n'); commit(falseMigrationRepo, 'seed fresh collection');
  result = run(['adopt', '--root', falseMigrationRepo, ...COLLECTION], falseMigrationRepo);
  const falseMigrationPath = generated(falseMigrationRepo, 'inventory.json');
  const falseMigrationInventory = JSON.parse(readFileSync(falseMigrationPath, 'utf8'));
  falseMigrationInventory.authorityBatches[0].type = 'v2-migration';
  falseMigrationInventory.authorityBatches[0].baseBindings = {
    inventorySha256: '0'.repeat(64), citationsSha256: '0'.repeat(64), curationLedgerSha256: '0'.repeat(64),
    indexSha256: '0'.repeat(64), authorityBatchHead: null,
  };
  rehashAuthorityBatch(falseMigrationInventory.authorityBatches[0]);
  writeFileSync(falseMigrationPath, `${JSON.stringify(falseMigrationInventory, null, 2)}\n`);
  result = run(['check', '--root', falseMigrationRepo, ...COLLECTION], falseMigrationRepo);
  check('a fresh v3 collection cannot claim a migration without a committed v2 predecessor', result.status === 1
    && result.output.includes('v2 migration authority requires an observed committed v2 predecessor'), result.output);

  const expandedMigrationRepo = join(work, 'expanded-v2-migration-batch'); cpSync(nativeMigrationRepo, expandedMigrationRepo, { recursive: true });
  const expandedMigrationPath = generated(expandedMigrationRepo, 'inventory.json');
  const expandedMigration = JSON.parse(readFileSync(expandedMigrationPath, 'utf8'));
  moveAuthorityRef(expandedMigration, expandedMigration.authorityBatches.at(-1), expandedMigration.authorityBatches[0],
    (ref) => ref.type === 'record');
  writeFileSync(expandedMigrationPath, `${JSON.stringify(expandedMigration, null, 2)}\n`);
  result = run(['check', '--root', expandedMigrationRepo, ...COLLECTION], expandedMigrationRepo);
  check('a rehashed v2 migration batch cannot absorb newly appended authority', result.status === 1
    && result.output.includes('v2 migration authority batch does not exactly cover inherited objects'), result.output);

  const staleIncrementalRepo = join(work, 'stale-incremental-binding'); cpSync(incrementalRepo, staleIncrementalRepo, { recursive: true });
  writeFileSync(join(staleIncrementalRepo, '.git', 'info', 'exclude'), 'stale-incremental.json\n');
  write(staleIncrementalRepo, 'records/planned.md', '# Planned incremental authority\n');
  commit(staleIncrementalRepo, 'commit planned authority');
  result = run(['plan-adoption', '--incremental', '--root', staleIncrementalRepo, ...COLLECTION,
    '--out', 'stale-incremental.json'], staleIncrementalRepo);
  const stalePlanSucceeded = result.status === 0;
  const preCurationInventory = JSON.parse(readFileSync(generated(staleIncrementalRepo, 'inventory.json'), 'utf8'));
  const preCurationLedger = readFileSync(generated(staleIncrementalRepo, 'curation.jsonl'));
  const curatedRecord = preCurationInventory.entries[0].id;
  const racingMutation = run(['curate', '--root', staleIncrementalRepo, ...COLLECTION,
    '--record', curatedRecord, '--state', '{"status":"reviewed"}', '--at', '2026-08-28T00:00:00.000Z'], staleIncrementalRepo);
  if (racingMutation.status === 0) commit(staleIncrementalRepo, 'commit concurrent curation mutation');
  const staleGenerated = generatedSnapshot(staleIncrementalRepo);
  result = stalePlanSucceeded && racingMutation.status === 0
    ? run(['adopt', '--root', staleIncrementalRepo, ...COLLECTION, '--review', 'stale-incremental.json'], staleIncrementalRepo)
    : racingMutation;
  const staleInventory = JSON.parse(readFileSync(generated(staleIncrementalRepo, 'inventory.json'), 'utf8'));
  check('curation can advance generated bindings without rewriting authority membership', racingMutation.status === 0
    && staleInventory.authorityBatches?.at(-1)?.batchDigest === preCurationInventory.authorityBatches?.at(-1)?.batchDigest
    && !preCurationLedger.equals(readFileSync(generated(staleIncrementalRepo, 'curation.jsonl'))), racingMutation.output);
  check('concurrent generated mutation makes an incremental receipt stale before generated writes', stalePlanSucceeded
    && racingMutation.status === 0 && result.status === 1
    && result.output.includes('adoption review is stale: sourceHead changed')
    && generatedMatches(staleIncrementalRepo, staleGenerated), result.output);

  const consumedReceiptSnapshot = generatedSnapshot(incrementalRepo);
  result = run(['adopt', '--root', incrementalRepo, ...COLLECTION, '--review', 'incremental-two.json'], incrementalRepo);
  check('a consumed incremental receipt cannot be replayed', result.status === 1
    && result.output.includes('adoption review is stale: sourceHead changed')
    && generatedMatches(incrementalRepo, consumedReceiptSnapshot), result.output);

  const sharedLockRepo = join(work, 'shared-lock-primary'); cpSync(incrementalRepo, sharedLockRepo, { recursive: true });
  const sharedLockSibling = join(work, 'shared-lock-sibling');
  git(['worktree', 'add', '-q', '-b', 'lock-sibling', sharedLockSibling, 'HEAD'], sharedLockRepo);
  write(sharedLockSibling, 'records/locked-native.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Locked native\n');
  git(['add', 'records/locked-native.md'], sharedLockSibling);
  const primaryCommonDir = resolve(sharedLockRepo, git(['rev-parse', '--git-common-dir'], sharedLockRepo).trim());
  const siblingCommonDir = resolve(sharedLockSibling, git(['rev-parse', '--git-common-dir'], sharedLockSibling).trim());
  const sharedMutationLock = join(primaryCommonDir, 'code-ops-record-locks', `${UUID}.lock`);
  mkdirSync(sharedMutationLock, { recursive: true });
  writeFileSync(join(sharedMutationLock, 'owner.json'), `${JSON.stringify({
    pid: process.pid, token: '33333333-3333-4333-8333-333333333333', acquiredAt: new Date().toISOString(),
  })}\n`);
  const sharedLockSnapshot = generatedSnapshot(sharedLockSibling);
  result = run(['append', '--root', sharedLockSibling, ...COLLECTION, '--record', 'records/locked-native.md'], sharedLockSibling);
  check('sibling worktrees observe one clone-wide collection mutation lock', primaryCommonDir === siblingCommonDir
    && result.status === 1 && result.output.includes('collection mutation lock is held')
    && generatedMatches(sharedLockSibling, sharedLockSnapshot), result.output);
  rmSync(sharedMutationLock, { recursive: true, force: false });
  result = run(['append', '--root', sharedLockSibling, ...COLLECTION, '--record', 'records/locked-native.md'], sharedLockSibling);
  const unlockedInventory = result.status === 0
    ? JSON.parse(readFileSync(generated(sharedLockSibling, 'inventory.json'), 'utf8')) : null;
  check('released clone-wide lock permits the waiting authority mutation', result.status === 0
    && unlockedInventory?.authorityBatches?.at(-1)?.type === 'native-append', result.output);

  const ownerlessLockRepo = join(work, 'ownerless-collection-lock'); cpSync(incrementalRepo, ownerlessLockRepo, { recursive: true });
  const ownerlessCommonDir = resolve(ownerlessLockRepo, git(['rev-parse', '--git-common-dir'], ownerlessLockRepo).trim());
  const ownerlessLock = join(ownerlessCommonDir, 'code-ops-record-locks', `${UUID}.lock`);
  mkdirSync(ownerlessLock, { recursive: true });
  const ownerlessSnapshot = generatedSnapshot(ownerlessLockRepo);
  result = run(['curate', '--root', ownerlessLockRepo, ...COLLECTION, '--record', incrementalTwoId,
    '--state', '{"status":"reviewed"}', '--at', '2026-08-28T02:00:00.000Z'], ownerlessLockRepo);
  check('a recent ownerless collection lock refuses promptly without generated writes', result.status === 1
    && result.output.includes('collection mutation lock is held')
    && generatedMatches(ownerlessLockRepo, ownerlessSnapshot), result.output);
  const ownerlessStaleTime = new Date('2000-01-01T00:00:00.000Z');
  utimesSync(ownerlessLock, ownerlessStaleTime, ownerlessStaleTime);
  result = run(['curate', '--root', ownerlessLockRepo, ...COLLECTION, '--record', incrementalTwoId,
    '--state', '{"status":"reviewed"}', '--at', '2026-08-28T02:00:00.000Z'], ownerlessLockRepo);
  check('an aged ownerless collection lock is recovered for the waiting mutation', result.status === 0
    && !existsSync(ownerlessLock), result.output);

  const staleReplacementScript = instrumentedRecordsScript('stale-lock-replacement-script', (source) => source.replace(
    /(      const quarantine = `\$\{lock\}\.stale-\$\{randomUUID\(\)\}`;\r?\n)/,
    (match) => `${match}      if (process.env.CODE_OPS_EVAL_REPLACE_STALE_LOCK === '1') {\n        const replacement = \`${'${lock}'}.replacement\`;\n        mkdirSync(replacement);\n        writeFileSync(join(replacement, 'owner.json'), '{"pid":1,"token":"fresh-owner","acquiredAt":"2026-08-28T02:30:00.000Z"}\\n');\n        rmSync(lock, { recursive: true, force: true });\n        renameSync(replacement, lock);\n      }\n`,
  ));
  const staleReplacementRepo = join(work, 'stale-lock-replacement'); cpSync(incrementalRepo, staleReplacementRepo, { recursive: true });
  const staleReplacementCommonDir = resolve(staleReplacementRepo, git(['rev-parse', '--git-common-dir'], staleReplacementRepo).trim());
  const staleReplacementLock = join(staleReplacementCommonDir, 'code-ops-record-locks', `${UUID}.lock`);
  mkdirSync(staleReplacementLock, { recursive: true });
  writeFileSync(join(staleReplacementLock, 'owner.json'), '{"pid":999999999,"token":"stale-owner","acquiredAt":"2000-01-01T00:00:00.000Z"}\n');
  utimesSync(staleReplacementLock, ownerlessStaleTime, ownerlessStaleTime);
  const staleReplacementSnapshot = generatedSnapshot(staleReplacementRepo);
  result = runWithScript(staleReplacementScript, ['curate', '--root', staleReplacementRepo, ...COLLECTION,
    '--record', incrementalTwoId, '--state', '{"status":"replacement-race"}', '--at', '2026-08-28T02:30:00.000Z'],
  staleReplacementRepo, { CODE_OPS_EVAL_REPLACE_STALE_LOCK: '1' });
  const staleReplacementOwner = existsSync(join(staleReplacementLock, 'owner.json'))
    ? JSON.parse(readFileSync(join(staleReplacementLock, 'owner.json'), 'utf8')) : null;
  check('stale recovery refuses a lock replaced after its stale verdict without removing the replacement', result.status === 1
    && result.output.includes('collection mutation lock changed during stale recovery')
    && staleReplacementOwner?.token === 'fresh-owner'
    && generatedMatches(staleReplacementRepo, staleReplacementSnapshot), result.output);
  rmSync(staleReplacementLock, { recursive: true, force: false });

  const interruptedRecoveryScript = instrumentedRecordsScript('interrupted-stale-recovery-script', (source) => source.replace(
    /      const quarantined = lockIdentity\(quarantine\);\r?\n/,
    (match) => `${match}      if (process.env.CODE_OPS_EVAL_INTERRUPT_STALE_RECOVERY === '1') throw new Error('synthetic interrupted stale recovery');\n`,
  ));
  const interruptedRecoveryRepo = join(work, 'interrupted-stale-recovery'); cpSync(incrementalRepo, interruptedRecoveryRepo, { recursive: true });
  const interruptedRecoveryCommonDir = resolve(interruptedRecoveryRepo, git(['rev-parse', '--git-common-dir'], interruptedRecoveryRepo).trim());
  const interruptedRecoveryLock = join(interruptedRecoveryCommonDir, 'code-ops-record-locks', `${UUID}.lock`);
  mkdirSync(interruptedRecoveryLock, { recursive: true });
  writeFileSync(join(interruptedRecoveryLock, 'owner.json'), '{"pid":999999999,"token":"stale-owner","acquiredAt":"2000-01-01T00:00:00.000Z"}\n');
  utimesSync(interruptedRecoveryLock, ownerlessStaleTime, ownerlessStaleTime);
  result = runWithScript(interruptedRecoveryScript, ['curate', '--root', interruptedRecoveryRepo, ...COLLECTION,
    '--record', incrementalTwoId, '--state', '{"status":"interrupted-recovery"}', '--at', '2026-08-28T02:45:00.000Z'],
  interruptedRecoveryRepo, { CODE_OPS_EVAL_INTERRUPT_STALE_RECOVERY: '1' });
  const interruptedQuarantines = readdirSync(join(interruptedRecoveryCommonDir, 'code-ops-record-locks'))
    .filter((name) => name.startsWith(`${UUID}.lock.stale-`));
  result = run(['curate', '--root', interruptedRecoveryRepo, ...COLLECTION, '--record', incrementalTwoId,
    '--state', '{"status":"recovered-after-interruption"}', '--at', '2026-08-28T02:45:30.000Z'], interruptedRecoveryRepo);
  check('an interrupted stale recovery leaves an inert quarantine and does not block the next mutation', result.status === 0
    && interruptedQuarantines.length === 1, result.output);
  rmSync(join(interruptedRecoveryCommonDir, 'code-ops-record-locks', interruptedQuarantines[0]), { recursive: true, force: false });

  const releaseFailureScript = instrumentedRecordsScript('release-failure-script', (source) => source.replace(
    /function releaseMutationLock\(lease\) \{\r?\n/,
    (match) => `${match}  if (process.env.CODE_OPS_EVAL_RELEASE_FAILURE === '1') throw new Error('synthetic release failure');\n`,
  ));
  const releaseSuccessRepo = join(work, 'release-failure-after-success'); cpSync(incrementalRepo, releaseSuccessRepo, { recursive: true });
  const releaseSuccessLedger = generated(releaseSuccessRepo, 'curation.jsonl');
  const releaseSuccessBefore = readFileSync(releaseSuccessLedger, 'utf8').trim().split(/\r?\n/).filter(Boolean).length;
  result = runWithScriptCaptured(releaseFailureScript, ['curate', '--root', releaseSuccessRepo, ...COLLECTION,
    '--record', incrementalTwoId, '--state', '{"status":"release-proof"}', '--at', '2026-08-28T03:00:00.000Z'],
  releaseSuccessRepo, { CODE_OPS_EVAL_RELEASE_FAILURE: '1' });
  const releaseSuccessAfter = readFileSync(releaseSuccessLedger, 'utf8').trim().split(/\r?\n/).filter(Boolean).length;
  const releaseSuccessCheck = run(['check', '--root', releaseSuccessRepo, ...COLLECTION], releaseSuccessRepo);
  check('a release anomaly cannot turn a durable mutation into a retry-triggering failure', result.status === 0
    && result.output.includes('warning: collection mutation lock was not released')
    && releaseSuccessAfter === releaseSuccessBefore + 1 && releaseSuccessCheck.status === 0,
  `${result.output}\n${releaseSuccessCheck.output}`);
  const releaseSuccessCommonDir = resolve(releaseSuccessRepo, git(['rev-parse', '--git-common-dir'], releaseSuccessRepo).trim());
  rmSync(join(releaseSuccessCommonDir, 'code-ops-record-locks', `${UUID}.lock`), { recursive: true, force: true });

  const lostLeaseScript = instrumentedRecordsScript('lost-lease-script', (source) => source.replace(
    /function releaseMutationLock\(lease\) \{\r?\n/,
    (match) => `${match}  if (process.env.CODE_OPS_EVAL_LOST_LEASE === '1') writeFileSync(lease.owner, '{"pid":1,"token":"replacement-owner","acquiredAt":"2026-08-28T03:30:00.000Z"}\\n');\n`,
  ));
  const lostLeaseRepo = join(work, 'lost-lease-after-success'); cpSync(incrementalRepo, lostLeaseRepo, { recursive: true });
  const lostLeaseLedger = generated(lostLeaseRepo, 'curation.jsonl');
  const lostLeaseBefore = readFileSync(lostLeaseLedger, 'utf8').trim().split(/\r?\n/).filter(Boolean).length;
  result = runWithScript(lostLeaseScript, ['curate', '--root', lostLeaseRepo, ...COLLECTION,
    '--record', incrementalTwoId, '--state', '{"status":"lost-lease-proof"}', '--at', '2026-08-28T03:30:00.000Z'],
  lostLeaseRepo, { CODE_OPS_EVAL_LOST_LEASE: '1' });
  const lostLeaseAfter = readFileSync(lostLeaseLedger, 'utf8').trim().split(/\r?\n/).filter(Boolean).length;
  const lostLeaseCheck = run(['check', '--root', lostLeaseRepo, ...COLLECTION], lostLeaseRepo);
  check('a lost lease after durable mutation is fatal without inviting a retry', result.status === 3
    && lostLeaseAfter === lostLeaseBefore + 1 && lostLeaseCheck.status === 0
    && result.output.includes('durable mutation completed') && result.output.includes('do not retry'), `${result.output}\n${lostLeaseCheck.output}`);
  const lostLeaseCommonDir = resolve(lostLeaseRepo, git(['rev-parse', '--git-common-dir'], lostLeaseRepo).trim());
  rmSync(join(lostLeaseCommonDir, 'code-ops-record-locks', `${UUID}.lock`), { recursive: true, force: true });

  const identityOnlyLostLeaseScript = instrumentedRecordsScript('identity-only-lost-lease-script', (source) => source.replace(
    /function releaseMutationLock\(lease\) \{\r?\n/,
    (match) => `${match}  if (process.env.CODE_OPS_EVAL_REPLACE_LEASE_IDENTITY === '1') {\n    rmSync(lease.lock, { recursive: true, force: true });\n    mkdirSync(lease.lock);\n    writeFileSync(lease.owner, JSON.stringify({ pid: 1, token: lease.token, acquiredAt: '2026-08-28T03:35:00.000Z' }) + '\\n');\n  }\n`,
  ));
  const identityOnlyLostLeaseRepo = join(work, 'identity-only-lost-lease-after-success'); cpSync(incrementalRepo, identityOnlyLostLeaseRepo, { recursive: true });
  const identityOnlyLostLeaseLedger = generated(identityOnlyLostLeaseRepo, 'curation.jsonl');
  const identityOnlyLostLeaseBefore = readFileSync(identityOnlyLostLeaseLedger, 'utf8').trim().split(/\r?\n/).filter(Boolean).length;
  result = runWithScript(identityOnlyLostLeaseScript, ['curate', '--root', identityOnlyLostLeaseRepo, ...COLLECTION,
    '--record', incrementalTwoId, '--state', '{"status":"identity-only-lost-lease-proof"}', '--at', '2026-08-28T03:35:00.000Z'],
  identityOnlyLostLeaseRepo, { CODE_OPS_EVAL_REPLACE_LEASE_IDENTITY: '1' });
  const identityOnlyLostLeaseAfter = readFileSync(identityOnlyLostLeaseLedger, 'utf8').trim().split(/\r?\n/).filter(Boolean).length;
  check('an identity-only replacement with the same token is fatal after durable mutation', result.status === 3
    && identityOnlyLostLeaseAfter === identityOnlyLostLeaseBefore + 1
    && result.output.includes('durable mutation completed') && result.output.includes('do not retry'), result.output);
  const identityOnlyLostLeaseCommonDir = resolve(identityOnlyLostLeaseRepo, git(['rev-parse', '--git-common-dir'], identityOnlyLostLeaseRepo).trim());
  rmSync(join(identityOnlyLostLeaseCommonDir, 'code-ops-record-locks', `${UUID}.lock`), { recursive: true, force: true });

  const lostLeaseBeforeWriteScript = instrumentedRecordsScript('lost-lease-before-write-script', (source) => source.replace(
    /function assertMutationLease\(lease\) \{\r?\n/,
    (match) => `${match}  if (process.env.CODE_OPS_EVAL_LOST_LEASE_BEFORE_WRITE === '1') {\n    rmSync(lease.lock, { recursive: true, force: true });\n    mkdirSync(lease.lock);\n    writeFileSync(lease.owner, '{"pid":1,"token":"replacement-owner","acquiredAt":"2026-08-28T03:40:00.000Z"}\\n');\n  }\n`,
  ));
  const lostLeaseBeforeWriteRepo = join(work, 'lost-lease-before-write'); cpSync(incrementalRepo, lostLeaseBeforeWriteRepo, { recursive: true });
  const lostLeaseBeforeWriteSnapshot = generatedSnapshot(lostLeaseBeforeWriteRepo);
  result = runWithScript(lostLeaseBeforeWriteScript, ['curate', '--root', lostLeaseBeforeWriteRepo, ...COLLECTION,
    '--record', incrementalTwoId, '--state', '{"status":"lost-lease-before-write"}', '--at', '2026-08-28T03:40:00.000Z'],
  lostLeaseBeforeWriteRepo, { CODE_OPS_EVAL_LOST_LEASE_BEFORE_WRITE: '1' });
  const lostLeaseBeforeWriteCommonDir = resolve(lostLeaseBeforeWriteRepo, git(['rev-parse', '--git-common-dir'], lostLeaseBeforeWriteRepo).trim());
  const lostLeaseBeforeWriteLock = join(lostLeaseBeforeWriteCommonDir, 'code-ops-record-locks', `${UUID}.lock`);
  check('a lost lease before authority write is fatal without overwriting the replacement lock', result.status === 1
    && result.output.includes('collection mutation lock ownership changed before authority write')
    && existsSync(lostLeaseBeforeWriteLock)
    && generatedMatches(lostLeaseBeforeWriteRepo, lostLeaseBeforeWriteSnapshot), result.output);
  rmSync(lostLeaseBeforeWriteLock, { recursive: true, force: true });

  const releaseErrorRepo = join(work, 'release-failure-after-mutation-error'); cpSync(incrementalRepo, releaseErrorRepo, { recursive: true });
  const releaseErrorLedger = readFileSync(generated(releaseErrorRepo, 'curation.jsonl'));
  result = runWithScript(releaseFailureScript, ['curate', '--root', releaseErrorRepo, ...COLLECTION,
    '--record', `REC-${'Z'.repeat(26)}`, '--state', '{"status":"invalid"}'], releaseErrorRepo,
  { CODE_OPS_EVAL_RELEASE_FAILURE: '1' });
  check('a release anomaly preserves the original mutation error', result.status === 1
    && result.output.includes('unknown record') && result.output.includes('warning: collection mutation lock was not released')
    && releaseErrorLedger.equals(readFileSync(generated(releaseErrorRepo, 'curation.jsonl'))), result.output);

  const corruptIncrementalRepo = join(work, 'incremental-post-write-rollback'); cpSync(incrementalRepo, corruptIncrementalRepo, { recursive: true });
  writeFileSync(join(corruptIncrementalRepo, '.git', 'info', 'exclude'), 'corrupt-incremental.json\n');
  write(corruptIncrementalRepo, 'records/post-write.md', '# Post-write verification\n');
  commit(corruptIncrementalRepo, 'commit pending post-write evidence');
  result = run(['plan-adoption', '--incremental', '--root', corruptIncrementalRepo, ...COLLECTION,
    '--out', 'corrupt-incremental.json'], corruptIncrementalRepo);
  const corruptIncrementalSnapshot = generatedSnapshot(corruptIncrementalRepo);
  if (result.status === 0) {
    result = runWithScript(corruptPostWriteScript, ['adopt', '--root', corruptIncrementalRepo, ...COLLECTION,
      '--review', 'corrupt-incremental.json'], corruptIncrementalRepo, { CODE_OPS_EVAL_CORRUPT_WRITE: '1' });
  }
  check('incremental admission restores prior authority when post-write verification fails', result.status === 1
    && result.output.includes('invalid record inventory header')
    && generatedMatches(corruptIncrementalRepo, corruptIncrementalSnapshot), result.output);

  const scheduledRepo = join(work, 'scheduled-mutable-incremental'); mkdirSync(scheduledRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], scheduledRepo);
  write(scheduledRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  const scheduledManifest = fixtureManifest();
  scheduledManifest.recordCollections[0].classificationVersion = 2;
  scheduledManifest.recordCollections[0].scopes = [
    { id: 'records', match: ['*.md'], paths: [], kind: 'record', policy: 'append-only' },
    { id: 'jsonl-default', match: ['**/*.jsonl'], paths: [], kind: 'artifact', policy: 'frozen' },
    { id: 'daily-live', match: [], paths: ['live/day_profile.jsonl'], kind: 'artifact', policy: 'mutable' },
  ];
  write(scheduledRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(scheduledManifest, null, 2)}\n`);
  write(scheduledRepo, 'records/seed.md', '# Seed\n\n[live](records/live/day_profile.jsonl)\n');
  write(scheduledRepo, 'records/closed/seed.jsonl', '{"closed":true}\n');
  write(scheduledRepo, 'records/live/day_profile.jsonl', '{"day":1}\n');
  commit(scheduledRepo, 'seed scheduled collection');
  result = run(['adopt', '--root', scheduledRepo, ...COLLECTION], scheduledRepo);
  if (result.status === 0) commit(scheduledRepo, 'adopt scheduled collection');
  writeFileSync(join(scheduledRepo, '.git', 'info', 'exclude'), 'scheduled-review.json\n');
  write(scheduledRepo, 'records/later.md', '# Later scheduled evidence\n');
  write(scheduledRepo, 'records/live/day_profile.jsonl', '{"day":1}\n{"day":2}\n');
  commit(scheduledRepo, 'scheduled record and mutable row');
  result = run(['plan-adoption', '--incremental', '--root', scheduledRepo, ...COLLECTION,
    '--out', 'scheduled-review.json'], scheduledRepo);
  const scheduledReview = result.status === 0
    ? JSON.parse(readFileSync(join(scheduledRepo, 'scheduled-review.json'), 'utf8')) : null;
  check('incremental planning keeps broad immutable globs behind exact mutable paths', result.status === 0
    && scheduledReview?.candidates?.map((candidate) => candidate.path).join(',') === 'records/later.md'
    && !scheduledReview?.candidates?.some((candidate) => candidate.path === 'records/live/day_profile.jsonl'), result.output);
  if (result.status === 0) {
    result = run(['adopt', '--root', scheduledRepo, ...COLLECTION, '--review', 'scheduled-review.json'], scheduledRepo);
  }
  if (result.status === 0) commit(scheduledRepo, 'admit scheduled evidence');
  write(scheduledRepo, 'records/live/day_profile.jsonl', '{"day":1}\n{"day":2}\n{"day":3}\n');
  const scheduledCheck = result.status === 0 ? run(['check', '--root', scheduledRepo, ...COLLECTION], scheduledRepo) : result;
  check('scheduled mutable appends remain warnings after incremental immutable admission', result.status === 0
    && scheduledCheck.status === 0 && scheduledCheck.output.includes('"warnings":1'),
  `${result.output}\n${scheduledCheck.output}`);

  const originalRecord = readFileSync(join(repo, 'records', 'one.md'), 'utf8');
  const revertedHistoryRepo = join(work, 'reverted-record-history'); cpSync(repo, revertedHistoryRepo, { recursive: true });
  write(revertedHistoryRepo, 'records/one.md', `${originalRecord}\ntransient rewrite\n`);
  commit(revertedHistoryRepo, 'temporarily rewrite adopted record');
  write(revertedHistoryRepo, 'records/one.md', originalRecord);
  commit(revertedHistoryRepo, 'restore adopted record bytes');
  result = run(['check', '--root', revertedHistoryRepo, ...COLLECTION], revertedHistoryRepo);
  check('retained reviewed transitions expose a post-adoption edit and revert', result.status === 1
    && result.output.includes('adoption review history drift'), result.output);

  const receiptDigestRepo = join(work, 'receipt-digest-mismatch'); cpSync(repo, receiptDigestRepo, { recursive: true });
  const receiptDigestPath = generated(receiptDigestRepo, 'inventory.json');
  const receiptDigestInventory = JSON.parse(readFileSync(receiptDigestPath, 'utf8'));
  receiptDigestInventory.adoptionReview.sourceHead = '0'.repeat(40);
  writeFileSync(receiptDigestPath, `${JSON.stringify(receiptDigestInventory, null, 2)}\n`);
  result = run(['check', '--root', receiptDigestRepo, ...COLLECTION], receiptDigestRepo);
  check('receipt field tampering without a new digest fails', result.status === 1
    && result.output.includes('record adoption review digest mismatch'), result.output);

  const receiptRewriteRepo = join(work, 'receipt-history-rewrite'); cpSync(repo, receiptRewriteRepo, { recursive: true });
  const receiptRewritePath = generated(receiptRewriteRepo, 'inventory.json');
  const receiptRewriteInventory = JSON.parse(readFileSync(receiptRewritePath, 'utf8'));
  receiptRewriteInventory.adoptionReview.sourceHead = '0'.repeat(40);
  delete receiptRewriteInventory.adoptionReview.receiptDigest;
  receiptRewriteInventory.adoptionReview.receiptDigest = digestJson(receiptRewriteInventory.adoptionReview);
  rehashAuthorityChain(receiptRewriteInventory);
  writeFileSync(receiptRewritePath, `${JSON.stringify(receiptRewriteInventory, null, 2)}\n`);
  commit(receiptRewriteRepo, 'replace committed adoption receipt');
  result = run(['check', '--root', receiptRewriteRepo, ...COLLECTION], receiptRewriteRepo);
  check('a re-digested receipt cannot replace committed adoption authority', result.status === 1
    && result.output.includes('record adoption review changed after introduction'), result.output);

  const emptyReceiptRepo = join(work, 'empty-adoption-receipt'); cpSync(repo, emptyReceiptRepo, { recursive: true });
  const emptyReceiptPath = generated(emptyReceiptRepo, 'inventory.json');
  const emptyReceiptInventory = JSON.parse(readFileSync(emptyReceiptPath, 'utf8'));
  emptyReceiptInventory.adoptionReview.candidates = [];
  emptyReceiptInventory.adoptionReview.reviewed = [];
  delete emptyReceiptInventory.adoptionReview.receiptDigest;
  emptyReceiptInventory.adoptionReview.receiptDigest = digestJson(emptyReceiptInventory.adoptionReview);
  rehashAuthorityChain(emptyReceiptInventory);
  writeFileSync(emptyReceiptPath, `${JSON.stringify(emptyReceiptInventory, null, 2)}\n`);
  commit(emptyReceiptRepo, 'forge empty adoption receipt');
  squashCurrentTree(emptyReceiptRepo, 'introduce forged empty adoption receipt');
  result = run(['check', '--root', emptyReceiptRepo, ...COLLECTION], emptyReceiptRepo);
  check('adoption receipt must cover every original immutable candidate', result.status === 1
    && result.output.includes('adoption review is missing original candidate'), result.output);

  const forgedRiskRepo = join(work, 'forged-adoption-risk'); cpSync(repo, forgedRiskRepo, { recursive: true });
  const forgedRiskPath = generated(forgedRiskRepo, 'inventory.json');
  const forgedRiskInventory = JSON.parse(readFileSync(forgedRiskPath, 'utf8'));
  forgedRiskInventory.adoptionReview.sourceHead = '0'.repeat(40);
  forgedRiskInventory.adoptionReview.candidates[0].history.contentTransitions = 99;
  forgedRiskInventory.adoptionReview.candidates[0].adoptionReadiness = 'ready';
  forgedRiskInventory.adoptionReview.candidates[0].reason = 'stable-so-far';
  forgedRiskInventory.adoptionReview.reviewed = [];
  delete forgedRiskInventory.adoptionReview.receiptDigest;
  forgedRiskInventory.adoptionReview.receiptDigest = digestJson(forgedRiskInventory.adoptionReview);
  writeFileSync(forgedRiskPath, `${JSON.stringify(forgedRiskInventory, null, 2)}\n`);
  commit(forgedRiskRepo, 'forge inconsistent adoption receipt');
  squashCurrentTree(forgedRiskRepo, 'introduce internally inconsistent adoption receipt');
  result = run(['check', '--root', forgedRiskRepo, ...COLLECTION], forgedRiskRepo);
  check('receipt readiness and reason must agree with its recorded risk', result.status === 1
    && result.output.includes('invalid adoption review candidate'), result.output);

  const forgedSourceRepo = join(work, 'forged-source-head'); cpSync(revisedRepo, forgedSourceRepo, { recursive: true });
  const forgedSourcePath = generated(forgedSourceRepo, 'inventory.json');
  const forgedSourceInventory = JSON.parse(readFileSync(forgedSourcePath, 'utf8'));
  forgedSourceInventory.adoptionReview.sourceHead = '0'.repeat(40);
  forgedSourceInventory.adoptionReview.candidates[0].history.contentTransitions = 0;
  forgedSourceInventory.adoptionReview.candidates[0].adoptionReadiness = 'ready';
  forgedSourceInventory.adoptionReview.candidates[0].reason = 'stable-so-far';
  forgedSourceInventory.adoptionReview.reviewed = [];
  delete forgedSourceInventory.adoptionReview.receiptDigest;
  forgedSourceInventory.adoptionReview.receiptDigest = digestJson(forgedSourceInventory.adoptionReview);
  rehashAuthorityChain(forgedSourceInventory);
  writeFileSync(forgedSourcePath, `${JSON.stringify(forgedSourceInventory, null, 2)}\n`);
  commit(forgedSourceRepo, 'introduce forged adoption receipt');
  result = run(['check', '--root', forgedSourceRepo, ...COLLECTION], forgedSourceRepo);
  check('forged lower transition counts cannot replace committed adoption authority', result.status === 1
    && result.output.includes('adoption review history drift'), result.output);

  const relabeled = join(work, 'relabeled'); cpSync(repo, relabeled, { recursive: true });
  const relabeledManifestPath = join(relabeled, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const relabeledManifest = JSON.parse(readFileSync(relabeledManifestPath, 'utf8'));
  relabeledManifest.recordCollections[0].id = 'renamed-evidence';
  writeFileSync(relabeledManifestPath, `${JSON.stringify(relabeledManifest, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], relabeled);
  result = run(['check', '--root', relabeled, '--collection', 'renamed-evidence'], relabeled);
  check('collection label changes preserve identities and conformance', result.status === 0, result.output);

  const migratedScope = join(work, 'migrated-scope-v2'); cpSync(repo, migratedScope, { recursive: true });
  const migratedManifestPath = join(migratedScope, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const migratedManifest = JSON.parse(readFileSync(migratedManifestPath, 'utf8'));
  migratedManifest.recordCollections[0].classificationVersion = 2;
  migratedManifest.recordCollections[0].scopes = [
    { id: 'records', match: ['*.md'], paths: [], kind: 'record', policy: 'append-only' },
    { id: 'mutable', match: ['mutable/**'], paths: [], kind: 'artifact', policy: 'mutable' },
    { id: 'frozen', match: ['frozen/**'], paths: [], kind: 'artifact', policy: 'frozen' },
    { id: 'executables', match: ['exec/**'], paths: [], kind: 'executable', policy: 'frozen' },
    { id: 'literal-bracket', match: [], paths: ['literal[0].json'], kind: 'artifact', policy: 'frozen' },
  ];
  writeFileSync(migratedManifestPath, `${JSON.stringify(migratedManifest, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], migratedScope);
  const migratedInventoryBefore = readFileSync(generated(migratedScope, 'inventory.json'));
  result = run(['check', '--root', migratedScope, ...COLLECTION], migratedScope);
  check('policy-equivalent scope v1 to v2 migration preserves adopted baselines', result.status === 0
    && migratedInventoryBefore.equals(readFileSync(generated(migratedScope, 'inventory.json'))), result.output);
  const reclassifiedScope = join(work, 'reclassified-scope-v2'); cpSync(migratedScope, reclassifiedScope, { recursive: true });
  const reclassifiedManifestPath = join(reclassifiedScope, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const reclassifiedManifest = JSON.parse(readFileSync(reclassifiedManifestPath, 'utf8'));
  reclassifiedManifest.recordCollections[0].scopes[0] = {
    id: 'records', match: ['*.md'], paths: [], kind: 'artifact', policy: 'frozen',
  };
  writeFileSync(reclassifiedManifestPath, `${JSON.stringify(reclassifiedManifest, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], reclassifiedScope);
  result = run(['check', '--root', reclassifiedScope, ...COLLECTION], reclassifiedScope);
  check('scope v2 migration cannot reclassify an adopted record', result.status === 1
    && result.output.includes('immutable record deleted, renamed, or reclassified'), result.output);

  const deletedRecord = join(work, 'deleted-record'); cpSync(repo, deletedRecord, { recursive: true });
  unlinkSync(join(deletedRecord, 'records', 'one.md')); git(['add', '-u'], deletedRecord);
  result = run(['check', '--root', deletedRecord, ...COLLECTION], deletedRecord);
  check('adopted record deletion fails', result.status === 1 && result.output.includes('deleted, renamed'), result.output);
  const renamedRecord = join(work, 'renamed-record'); cpSync(repo, renamedRecord, { recursive: true });
  git(['mv', 'records/one.md', 'records/renamed.md'], renamedRecord);
  result = run(['check', '--root', renamedRecord, ...COLLECTION], renamedRecord);
  check('adopted record rename fails', result.status === 1 && result.output.includes('deleted, renamed'), result.output);

  const uninventoriedRecord = join(work, 'uninventoried-record'); cpSync(repo, uninventoriedRecord, { recursive: true });
  write(uninventoriedRecord, 'records/extra.md', '# Uninventoried record\n');
  git(['add', 'records/extra.md'], uninventoriedRecord);
  result = run(['check', '--root', uninventoriedRecord, ...COLLECTION], uninventoriedRecord);
  check('tracked records cannot bypass the inventory', result.status === 1
    && result.output.includes('record missing from inventory'), result.output);
  const uninventoriedFrozen = join(work, 'uninventoried-frozen'); cpSync(repo, uninventoriedFrozen, { recursive: true });
  write(uninventoriedFrozen, 'records/frozen/new.json', '{"new":true}\n');
  git(['add', 'records/frozen/new.json'], uninventoriedFrozen);
  result = run(['check', '--root', uninventoriedFrozen, ...COLLECTION], uninventoriedFrozen);
  check('tracked frozen artifacts cannot bypass the inventory', result.status === 1
    && result.output.includes('frozen artifact missing from inventory'), result.output);

  const candidatePinRepo = join(work, 'candidate-pin'); cpSync(repo, candidatePinRepo, { recursive: true });
  write(candidatePinRepo, 'records/one.md', `${originalRecord}\ncommitted rewrite\n`);
  const candidatePinPath = generated(candidatePinRepo, 'inventory.json');
  const candidatePinInventory = JSON.parse(readFileSync(candidatePinPath, 'utf8'));
  candidatePinInventory.entries[0].sha256 = sha256(readFileSync(join(candidatePinRepo, 'records', 'one.md')));
  rehashAuthorityChain(candidatePinInventory);
  writeFileSync(candidatePinPath, `${JSON.stringify(candidatePinInventory, null, 2)}\n`);
  run(['render', '--root', candidatePinRepo, ...COLLECTION], candidatePinRepo); commit(candidatePinRepo, 'coordinated immutable rewrite');
  result = run(['check', '--root', candidatePinRepo, ...COLLECTION], candidatePinRepo);
  check('committed body plus inventory rehash cannot bypass the adoption receipt', result.status === 1
    && result.output.includes('adoption review candidate is not pinned by inventory'), result.output);

  const committedRewrite = join(work, 'committed-rewrite'); cpSync(repo, committedRewrite, { recursive: true });
  const rewrittenInventoryPath = generated(committedRewrite, 'inventory.json');
  const rewrittenInventory = JSON.parse(readFileSync(rewrittenInventoryPath, 'utf8'));
  rewrittenInventory.entries[0].operatorNote = 'rewritten after authority introduction';
  rehashAuthorityChain(rewrittenInventory);
  writeFileSync(rewrittenInventoryPath, `${JSON.stringify(rewrittenInventory, null, 2)}\n`);
  commit(committedRewrite, 'rewrite committed inventory metadata');
  result = run(['check', '--root', committedRewrite, ...COLLECTION], committedRewrite);
  check('committed inventory metadata rewrites fail historical monotonicity', result.status === 1
    && result.output.includes('record inventory changed'), result.output);

  const renamedHubRewrite = join(work, 'renamed-hub-rewrite'); cpSync(repo, renamedHubRewrite, { recursive: true });
  git(['mv', 'hub', 'knowledge-hub'], renamedHubRewrite);
  const movedManifestPath = join(renamedHubRewrite, 'knowledge-hub', '98 System', 'DOCS_MANIFEST.json');
  const movedManifest = JSON.parse(readFileSync(movedManifestPath, 'utf8'));
  movedManifest.hub = 'knowledge-hub';
  writeFileSync(movedManifestPath, `${JSON.stringify(movedManifest, null, 2)}\n`);
  const movedInventoryPath = join(renamedHubRewrite, 'knowledge-hub', '98 System', 'Records', 'inventory.json');
  const movedInventory = JSON.parse(readFileSync(movedInventoryPath, 'utf8'));
  movedInventory.entries[0].operatorNote = 'rewritten after authority introduction';
  rehashAuthorityChain(movedInventory);
  writeFileSync(movedInventoryPath, `${JSON.stringify(movedInventory, null, 2)}\n`);
  commit(renamedHubRewrite, 'move hub with rewritten inventory metadata');
  result = run(['check', '--root', renamedHubRewrite, ...COLLECTION], renamedHubRewrite);
  check('hub rename cannot hide a committed inventory rewrite', result.status === 1
    && result.output.includes('record inventory changed'), result.output);

  if (process.platform !== 'win32') {
    const literalHubRepo = join(work, 'literal-hub'); mkdirSync(literalHubRepo, { recursive: true });
    git(['init', '--quiet', '-b', 'main'], literalHubRepo);
    write(literalHubRepo, ':hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
    const literalHubManifest = fixtureManifest(); literalHubManifest.hub = ':hub';
    write(literalHubRepo, ':hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(literalHubManifest, null, 2)}\n`);
    write(literalHubRepo, 'records/one.md', '# Literal pathspec record\n');
    commit(literalHubRepo, 'seed literal-pathspec hub');
    result = run(['adopt', '--root', literalHubRepo, ...COLLECTION], literalHubRepo);
    check('literal-pathspec fixture adopts', result.status === 0, result.output);
    commit(literalHubRepo, 'adopt literal-pathspec hub');
    const literalInventoryPath = join(literalHubRepo, ':hub', '98 System', 'Records', 'inventory.json');
    const literalInventory = JSON.parse(readFileSync(literalInventoryPath, 'utf8'));
    literalInventory.entries[0].operatorNote = 'rewritten under a pathspec-like hub';
    rehashAuthorityChain(literalInventory);
    writeFileSync(literalInventoryPath, `${JSON.stringify(literalInventory, null, 2)}\n`);
    commit(literalHubRepo, 'rewrite inventory under literal-pathspec hub');
    result = run(['check', '--root', literalHubRepo, ...COLLECTION], literalHubRepo);
    check('pathspec-like hub names cannot hide inventory history', result.status === 1
      && result.output.includes('record inventory changed'), result.output);

    const symlinkRepo = join(work, 'symlink-record'); mkdirSync(symlinkRepo, { recursive: true });
    git(['init', '--quiet', '-b', 'main'], symlinkRepo);
    write(symlinkRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
    write(symlinkRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
    write(work, 'outside-evidence.md', 'outside repository bytes\n');
    mkdirSync(join(symlinkRepo, 'records'), { recursive: true });
    symlinkSync('../../outside-evidence.md', join(symlinkRepo, 'records', 'linked.md'));
    commit(symlinkRepo, 'seed tracked symlink');
    result = run(['adopt', '--root', symlinkRepo, ...COLLECTION], symlinkRepo);
    check('adoption rejects tracked symlinks before hashing external bytes', result.status === 1
      && result.output.includes('unsupported Git index mode 120000'), result.output);
  }

  const citationRewrite = join(work, 'citation-rewrite'); cpSync(repo, citationRewrite, { recursive: true });
  const rewrittenCitationsPath = generated(citationRewrite, 'citations.json');
  const rewrittenCitations = JSON.parse(readFileSync(rewrittenCitationsPath, 'utf8'));
  rewrittenCitations.entries[0].sourceLine += 1;
  writeFileSync(rewrittenCitationsPath, `${JSON.stringify(rewrittenCitations, null, 2)}\n`); commit(citationRewrite, 'rewrite citation baseline');
  result = run(['check', '--root', citationRewrite, ...COLLECTION], citationRewrite);
  check('committed citation baseline rewrites fail', result.status === 1 && result.output.includes('citation inventory changed'), result.output);

  const ledgerRewrite = join(work, 'ledger-rewrite'); cpSync(repo, ledgerRewrite, { recursive: true });
  run(['curate', '--root', ledgerRewrite, ...COLLECTION, '--record', firstId, '--at', '2026-01-01T00:00:00.000Z', '--state', '{"status":"reviewed"}'], ledgerRewrite);
  commit(ledgerRewrite, 'append valid curation');
  const ledgerRewritePath = generated(ledgerRewrite, 'curation.jsonl');
  const rewrittenEvent = JSON.parse(readFileSync(ledgerRewritePath, 'utf8').trim());
  rewrittenEvent.state.status = 'rewritten'; delete rewrittenEvent.eventDigest; rewrittenEvent.eventDigest = digestJson(rewrittenEvent);
  writeFileSync(ledgerRewritePath, `${JSON.stringify(rewrittenEvent)}\n`);
  run(['render', '--root', ledgerRewrite, ...COLLECTION], ledgerRewrite); commit(ledgerRewrite, 'rehash committed curation');
  result = run(['check', '--root', ledgerRewrite, ...COLLECTION], ledgerRewrite);
  check('committed ledger rehashes fail historical monotonicity', result.status === 1 && result.output.includes('ledger rewrote committed history'), result.output);

  const uuidRewrite = join(work, 'uuid-rewrite'); cpSync(repo, uuidRewrite, { recursive: true });
  const uuidManifestPath = join(uuidRewrite, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const uuidManifest = JSON.parse(readFileSync(uuidManifestPath, 'utf8'));
  uuidManifest.recordCollections[0].collectionUuid = '33333333-3333-4333-8333-333333333333';
  writeFileSync(uuidManifestPath, `${JSON.stringify(uuidManifest, null, 2)}\n`); commit(uuidRewrite, 'replace collection identity');
  result = run(['check', '--root', uuidRewrite, ...COLLECTION], uuidRewrite);
  check('committed collection UUID replacement fails', result.status === 1 && result.output.includes('permanent record collection'), result.output);

  const unknownEvent = {
    collectionUuid: UUID, sequence: 1, previousEventDigest: null,
    recordId: 'REC-AAAAAAAAAAAAAAAAAAAAAAAAAA', previousRecordEventDigest: null,
    state: { status: 'reviewed' }, curatedAt: '2026-01-01T00:00:00.000Z',
  };
  unknownEvent.eventDigest = digestJson(unknownEvent);
  writeFileSync(generated(repo, 'curation.jsonl'), `${JSON.stringify(unknownEvent)}\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('validly hashed curation for an unknown record fails', result.status === 1 && result.output.includes('unknown record'), result.output);
  restoreFromHead(repo, 'hub/98 System/Records/curation.jsonl');

  const unknownCitationRepo = join(work, 'unknown-citation'); cpSync(repo, unknownCitationRepo, { recursive: true });
  const unknownCitationPath = generated(unknownCitationRepo, 'citations.json');
  const unknownCitations = JSON.parse(readFileSync(unknownCitationPath, 'utf8'));
  unknownCitations.entries.push({ ...unknownCitations.entries[0], recordId: 'REC-AAAAAAAAAAAAAAAAAAAAAAAAAA' });
  writeFileSync(unknownCitationPath, `${JSON.stringify(unknownCitations, null, 2)}\n`);
  result = run(['check', '--root', unknownCitationRepo, ...COLLECTION], unknownCitationRepo);
  check('valid citation-shaped entries for unknown records fail', result.status === 1
    && result.output.includes('citation references unknown record'), result.output);

  const unknownPrefixRepo = join(work, 'unknown-prefix'); cpSync(repo, unknownPrefixRepo, { recursive: true });
  write(unknownPrefixRepo, 'hub/unknown-prefix.md', '# Unknown record\n\n`REC-ZZZZZZZZ`\n');
  git(['add', 'hub/unknown-prefix.md'], unknownPrefixRepo);
  result = run(['check', '--root', unknownPrefixRepo, ...COLLECTION], unknownPrefixRepo);
  check('unknown record prefixes in vault prose fail', result.status === 1
    && result.output.includes('record prefix REC-ZZZZZZZZ is unresolved'), result.output);

  const nestedPrefixRepo = join(work, 'nested-prefix'); cpSync(repo, nestedPrefixRepo, { recursive: true });
  write(nestedPrefixRepo, 'hub/nested-prefix.md', '# Nested record\n\n- outer bullet\n    - nested bullet references REC-ZZZZZZZZ\n');
  git(['add', 'hub/nested-prefix.md'], nestedPrefixRepo);
  result = run(['check', '--root', nestedPrefixRepo, ...COLLECTION], nestedPrefixRepo);
  check('unknown record prefixes in nested list prose fail', result.status === 1
    && result.output.includes('record prefix REC-ZZZZZZZZ is unresolved'), result.output);

  const lazyPrefixRepo = join(work, 'lazy-prefix'); cpSync(repo, lazyPrefixRepo, { recursive: true });
  write(lazyPrefixRepo, 'hub/lazy-prefix.md', '# Lazy record\n\nParagraph\n    continuation references REC-XXXXXXXX\n');
  git(['add', 'hub/lazy-prefix.md'], lazyPrefixRepo);
  result = run(['check', '--root', lazyPrefixRepo, ...COLLECTION], lazyPrefixRepo);
  check('indented paragraph continuations remain visible to record-prefix checks', result.status === 1
    && result.output.includes('record prefix REC-XXXXXXXX is unresolved'), result.output);

  const quotedLazyPrefixRepo = join(work, 'quoted-lazy-prefix'); cpSync(repo, quotedLazyPrefixRepo, { recursive: true });
  write(quotedLazyPrefixRepo, 'hub/quoted-lazy-prefix.md', '# Quoted lazy record\n\n> Paragraph\n    continuation references REC-VVVVVVVV\n');
  git(['add', 'hub/quoted-lazy-prefix.md'], quotedLazyPrefixRepo);
  result = run(['check', '--root', quotedLazyPrefixRepo, ...COLLECTION], quotedLazyPrefixRepo);
  check('lazy blockquote continuations remain visible to record-prefix checks', result.status === 1
    && result.output.includes('record prefix REC-VVVVVVVV is unresolved'), result.output);

  const indentedPrefixRepo = join(work, 'indented-prefix'); cpSync(repo, indentedPrefixRepo, { recursive: true });
  write(indentedPrefixRepo, 'hub/indented-prefix.md', '# Indented record\n\n    REC-ASDFGHJK\n');
  git(['add', 'hub/indented-prefix.md'], indentedPrefixRepo);
  result = run(['check', '--root', indentedPrefixRepo, ...COLLECTION], indentedPrefixRepo);
  check('unambiguous top-level indented record examples do not create citation debt', result.status === 0, result.output);

  const fencedPrefixRepo = join(work, 'fenced-prefix-example'); cpSync(repo, fencedPrefixRepo, { recursive: true });
  write(fencedPrefixRepo, 'hub/fenced-prefix-example.md', `# Record examples

\`\`\`yaml
supersedes: ["REC-ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
\`\`\`

~~~yaml
supersedes: ["REC-ZYXWVUTSRQPONMLKJIHGFEDCBA"]
~~~

~~~~yaml
REC-ZZZZZZZZ
~~~
~~~~

> ~~~yaml
> supersedes: ["REC-QWERTYUIOPASDFGHJKLZXCVBNM"]
> ~~~
`);
  git(['add', 'hub/fenced-prefix-example.md'], fencedPrefixRepo);
  result = run(['check', '--root', fencedPrefixRepo, ...COLLECTION], fencedPrefixRepo);
  check('fenced record examples do not create citation debt', result.status === 0, result.output);

  const quotedFenceExitRepo = join(work, 'quoted-fence-exit'); cpSync(repo, quotedFenceExitRepo, { recursive: true });
  write(quotedFenceExitRepo, 'hub/quoted-fence-exit.md', `# Quoted fence exit

> \`\`\`yaml
> supersedes: []
Visible reference: REC-ZZZZZZZZ
> \`\`\`
`);
  git(['add', 'hub/quoted-fence-exit.md'], quotedFenceExitRepo);
  result = run(['check', '--root', quotedFenceExitRepo, ...COLLECTION], quotedFenceExitRepo);
  check('record-prefix scanning resumes when a blockquote container ends', result.status === 1
    && result.output.includes('record prefix REC-ZZZZZZZZ is unresolved'), result.output);

  const nestedQuoteExitRepo = join(work, 'nested-quote-exit'); cpSync(repo, nestedQuoteExitRepo, { recursive: true });
  write(nestedQuoteExitRepo, 'hub/nested-quote-exit.md', `# Nested quote exit

> > \`\`\`yaml
> Visible reference: REC-XXXXXXXX
> > \`\`\`
`);
  git(['add', 'hub/nested-quote-exit.md'], nestedQuoteExitRepo);
  result = run(['check', '--root', nestedQuoteExitRepo, ...COLLECTION], nestedQuoteExitRepo);
  check('record-prefix scanning resumes at a parent blockquote depth', result.status === 1
    && result.output.includes('record prefix REC-XXXXXXXX is unresolved'), result.output);

  const quotedFenceEofRepo = join(work, 'quoted-fence-eof'); cpSync(repo, quotedFenceEofRepo, { recursive: true });
  write(quotedFenceEofRepo, 'hub/quoted-fence-eof.md', '# Quoted fence EOF\n\n> ```yaml\n> supersedes: []\n');
  git(['add', 'hub/quoted-fence-eof.md'], quotedFenceEofRepo);
  result = run(['check', '--root', quotedFenceEofRepo, ...COLLECTION], quotedFenceEofRepo);
  check('a blockquote container may close its fence at end of file', result.status === 0, result.output);

  const listFenceExitRepo = join(work, 'list-fence-exit'); cpSync(repo, listFenceExitRepo, { recursive: true });
  write(listFenceExitRepo, 'hub/list-fence-exit.md', '# List fence exit\n\n- example\n  ```yaml\n  supersedes: []\n\nVisible reference: REC-VVVVVVVV\n');
  git(['add', 'hub/list-fence-exit.md'], listFenceExitRepo);
  result = run(['check', '--root', listFenceExitRepo, ...COLLECTION], listFenceExitRepo);
  check('record-prefix scanning resumes when a list container ends', result.status === 1
    && result.output.includes('record prefix REC-VVVVVVVV is unresolved')
    && !result.output.includes('unterminated Markdown fence'), result.output);

  const listFenceEofRepo = join(work, 'list-fence-eof'); cpSync(repo, listFenceEofRepo, { recursive: true });
  write(listFenceEofRepo, 'hub/list-fence-eof.md', '# List fence EOF\n\n- example\n  ```yaml\n  supersedes: []\n');
  git(['add', 'hub/list-fence-eof.md'], listFenceEofRepo);
  result = run(['check', '--root', listFenceEofRepo, ...COLLECTION], listFenceEofRepo);
  check('a list container may close its fence at end of file', result.status === 0, result.output);

  const invalidBacktickInfoRepo = join(work, 'invalid-backtick-info'); cpSync(repo, invalidBacktickInfoRepo, { recursive: true });
  write(invalidBacktickInfoRepo, 'hub/invalid-backtick-info.md', '# Invalid backtick info\n\n```yaml `invalid\nREC-ASDFGHJK\n');
  git(['add', 'hub/invalid-backtick-info.md'], invalidBacktickInfoRepo);
  result = run(['check', '--root', invalidBacktickInfoRepo, ...COLLECTION], invalidBacktickInfoRepo);
  check('backticks in a backtick-fence info string do not suppress record prefixes', result.status === 1
    && result.output.includes('record prefix REC-ASDFGHJK is unresolved'), result.output);

  const validTildeInfoRepo = join(work, 'valid-tilde-info'); cpSync(repo, validTildeInfoRepo, { recursive: true });
  write(validTildeInfoRepo, 'hub/valid-tilde-info.md', '# Valid tilde info\n\n~~~yaml `valid\nREC-QWERTYUI\n~~~\n');
  git(['add', 'hub/valid-tilde-info.md'], validTildeInfoRepo);
  result = run(['check', '--root', validTildeInfoRepo, ...COLLECTION], validTildeInfoRepo);
  check('backticks remain valid in tilde-fence info strings', result.status === 0, result.output);

  const deeperQuoteContentRepo = join(work, 'deeper-quote-content'); cpSync(repo, deeperQuoteContentRepo, { recursive: true });
  write(deeperQuoteContentRepo, 'hub/deeper-quote-content.md', '# Deeper quote content\n\n```yaml\n> REC-POIUYTRE\n```\n');
  git(['add', 'hub/deeper-quote-content.md'], deeperQuoteContentRepo);
  result = run(['check', '--root', deeperQuoteContentRepo, ...COLLECTION], deeperQuoteContentRepo);
  check('deeper blockquote markers remain content inside a top-level fence', result.status === 0, result.output);

  const nestedListFenceRepo = join(work, 'nested-list-fence'); cpSync(repo, nestedListFenceRepo, { recursive: true });
  write(nestedListFenceRepo, 'hub/nested-list-fence.md', '# Nested list fence\n\n- outer\n    - inner\n      ```yaml\n      REC-LKJHGFDS\n      ```\n');
  git(['add', 'hub/nested-list-fence.md'], nestedListFenceRepo);
  result = run(['check', '--root', nestedListFenceRepo, ...COLLECTION], nestedListFenceRepo);
  check('nested-list fenced record examples remain masked', result.status === 0, result.output);

  const tabListFenceRepo = join(work, 'tab-list-fence'); cpSync(repo, tabListFenceRepo, { recursive: true });
  write(tabListFenceRepo, 'hub/tab-list-fence.md', '# Tab list fence\n\n-\touter\n    ```yaml\n    REC-MNBVCXZL\n    ```\n');
  git(['add', 'hub/tab-list-fence.md'], tabListFenceRepo);
  result = run(['check', '--root', tabListFenceRepo, ...COLLECTION], tabListFenceRepo);
  check('tab-indented list fences use marker-relative columns', result.status === 0, result.output);

  const tabContinuationFenceRepo = join(work, 'tab-continuation-fence'); cpSync(repo, tabContinuationFenceRepo, { recursive: true });
  write(tabContinuationFenceRepo, 'hub/tab-continuation-fence.md', '# Tab continuation fence\n\n- outer\n  ```yaml\n\tREC-CXCVBNML\n\t```\n');
  git(['add', 'hub/tab-continuation-fence.md'], tabContinuationFenceRepo);
  result = run(['check', '--root', tabContinuationFenceRepo, ...COLLECTION], tabContinuationFenceRepo);
  check('tab expansion preserves list-fence continuation content', result.status === 0, result.output);

  const orderedInterruptionRepo = join(work, 'ordered-interruption'); cpSync(repo, orderedInterruptionRepo, { recursive: true });
  write(orderedInterruptionRepo, 'hub/ordered-interruption.md', '# Ordered interruption\n\nParagraph\n2. ```yaml\n   REC-AZERTYUI\n');
  git(['add', 'hub/ordered-interruption.md'], orderedInterruptionRepo);
  result = run(['check', '--root', orderedInterruptionRepo, ...COLLECTION], orderedInterruptionRepo);
  check('non-one ordered markers cannot hide prefixes by interrupting prose', result.status === 1
    && result.output.includes('record prefix REC-AZERTYUI is unresolved'), result.output);

  const emptyInterruptionRepo = join(work, 'empty-interruption'); cpSync(repo, emptyInterruptionRepo, { recursive: true });
  write(emptyInterruptionRepo, 'hub/empty-interruption.md', '# Empty interruption\n\nParagraph\n2.\n    ```yaml\n    REC-SDFGHJKL\n');
  git(['add', 'hub/empty-interruption.md'], emptyInterruptionRepo);
  result = run(['check', '--root', emptyInterruptionRepo, ...COLLECTION], emptyInterruptionRepo);
  check('empty list markers cannot hide prefixes by interrupting prose', result.status === 1
    && result.output.includes('record prefix REC-SDFGHJKL is unresolved'), result.output);

  const orderedOneFenceRepo = join(work, 'ordered-one-fence'); cpSync(repo, orderedOneFenceRepo, { recursive: true });
  write(orderedOneFenceRepo, 'hub/ordered-one-fence.md', '# Ordered one fence\n\nParagraph\n1. ```yaml\n   REC-DFGHJKLA\n');
  git(['add', 'hub/ordered-one-fence.md'], orderedOneFenceRepo);
  result = run(['check', '--root', orderedOneFenceRepo, ...COLLECTION], orderedOneFenceRepo);
  check('ordered-one list fences may interrupt prose', result.status === 0, result.output);

  const resumedPrefixRepo = join(work, 'resumed-prefix-scan'); cpSync(repo, resumedPrefixRepo, { recursive: true });
  write(resumedPrefixRepo, 'hub/resumed-prefix-scan.md', `# Closed example

\`\`\`yaml
supersedes: ["REC-ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
\`\`\`

Visible reference: REC-ZZZZZZZZ
`);
  git(['add', 'hub/resumed-prefix-scan.md'], resumedPrefixRepo);
  result = run(['check', '--root', resumedPrefixRepo, ...COLLECTION], resumedPrefixRepo);
  check('record-prefix scanning resumes after a valid fence closure', result.status === 1
    && result.output.includes('record prefix REC-ZZZZZZZZ is unresolved'), result.output);

  const unterminatedFenceRepo = join(work, 'unterminated-prefix-fence'); cpSync(repo, unterminatedFenceRepo, { recursive: true });
  write(unterminatedFenceRepo, 'hub/unterminated-prefix-fence.md', `# Broken example

\`\`\`yaml
supersedes: []

REC-ZZZZZZZZ
`);
  git(['add', 'hub/unterminated-prefix-fence.md'], unterminatedFenceRepo);
  result = run(['check', '--root', unterminatedFenceRepo, ...COLLECTION], unterminatedFenceRepo);
  check('unterminated fences fail before they can suppress record references', result.status === 1
    && result.output.includes('unterminated Markdown fence in hub/unterminated-prefix-fence.md:3'), result.output);

  const deadRepo = join(work, 'resolved-to-dead'); cpSync(repo, deadRepo, { recursive: true });
  unlinkSync(join(deadRepo, 'records', 'mutable', 'stream.jsonl')); git(['add', '-u'], deadRepo);
  result = run(['check', '--root', deadRepo, ...COLLECTION], deadRepo);
  check('resolved-to-dead citation regressions block', result.status === 1 && result.output.includes('resolved-to-dead'), result.output);

  write(repo, 'records/one.md', `${originalRecord}\nchanged\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('immutable record edits fail', result.status === 1 && result.output.includes('immutable record drift'), result.output);
  write(repo, 'records/one.md', originalRecord);
  const frozen = readFileSync(join(repo, 'records', 'frozen', 'stable.json'), 'utf8');
  write(repo, 'records/frozen/stable.json', '{"stable":false}\n');
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('frozen artifact drift fails', result.status === 1 && result.output.includes('frozen artifact drift'), result.output);
  write(repo, 'records/frozen/stable.json', frozen);
  const mutable = readFileSync(join(repo, 'records', 'mutable', 'result.json'), 'utf8');
  write(repo, 'records/mutable/result.json', '{"PRIMARY":{"summary":2},"A":[0]}\n');
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('mutable artifact drift warns without failing', result.status === 0 && result.output.includes('"warnings":1'), result.output);
  write(repo, 'records/mutable/result.json', mutable);

  const canonicalIndex = readFileSync(generated(repo, 'index.md'), 'utf8');
  writeFileSync(generated(repo, 'index.md'), `${canonicalIndex}\nPresentation-only note.\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('semantic index permits presentation-only changes', result.status === 0, result.output);
  writeFileSync(generated(repo, 'index.md'), canonicalIndex.replace(`<a id="${firstId}"></a>`, ''));
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('semantic index requires every record anchor', result.status === 1 && result.output.includes('anchors drift'), result.output);
  writeFileSync(generated(repo, 'index.md'), canonicalIndex);
  const staleSemanticIndex = join(work, 'stale-semantic-index'); cpSync(repo, staleSemanticIndex, { recursive: true });
  result = run(['curate', '--root', staleSemanticIndex, ...COLLECTION, '--record', firstId,
    '--at', '2026-01-01T00:00:00.000Z', '--state', '{"status":"reviewed"}'], staleSemanticIndex);
  check('semantic index fixture can curate a record', result.status === 0, result.output);
  writeFileSync(generated(staleSemanticIndex, 'index.md'), canonicalIndex);
  result = run(['check', '--root', staleSemanticIndex, ...COLLECTION], staleSemanticIndex);
  check('semantic index detects stale curation state even when anchors match', result.status === 1
    && result.output.includes('semantic index drift'), result.output);
  const staleLockRepo = join(work, 'stale-curation-lock'); cpSync(repo, staleLockRepo, { recursive: true });
  const staleLockCommon = resolve(staleLockRepo, git(['rev-parse', '--git-common-dir'], staleLockRepo).trim());
  const staleLock = join(staleLockCommon, 'code-ops-record-locks', `${UUID}.lock`);
  mkdirSync(staleLock, { recursive: true });
  writeFileSync(join(staleLock, 'owner.json'), '{"pid":999999999,"token":"stale-owner","acquiredAt":"2000-01-01T00:00:00.000Z"}\n');
  const staleTime = new Date('2000-01-01T00:00:00.000Z'); utimesSync(staleLock, staleTime, staleTime);
  result = run(['curate', '--root', staleLockRepo, ...COLLECTION, '--record', firstId,
    '--at', '2026-01-01T00:00:00.000Z', '--state', '{"status":"reviewed"}'], staleLockRepo);
  check('curation recovers a stale lock whose recorded process is gone', result.status === 0, result.output);

  result = run(['curate', '--root', repo, ...COLLECTION, '--record', firstId.slice(0, 12), '--at', '2026-01-01T00:00:00.000Z', '--state', '{"status":"reviewed","owner":"ops"}'], repo);
  check('curation accepts an unambiguous short ID', result.status === 0, result.output);
  result = run(['curate', '--root', repo, ...COLLECTION, '--record', firstId, '--at', '2026-01-02T00:00:00.000Z', '--state', '{"status":"superseded","owner":"ops"}'], repo);
  check('curation corrections append complete state', result.status === 0, result.output);
  const goodLedger = readFileSync(generated(repo, 'curation.jsonl'), 'utf8');
  const ledgerLines = goodLedger.trimEnd().split('\n');
  const tampered = JSON.parse(ledgerLines[0]); tampered.state.status = 'tampered'; ledgerLines[0] = JSON.stringify(tampered);
  writeFileSync(generated(repo, 'curation.jsonl'), `${ledgerLines.join('\n')}\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('ledger tampering fails the digest chain', result.status === 1 && result.output.includes('digest mismatch'), result.output);
  writeFileSync(generated(repo, 'curation.jsonl'), goodLedger);
  writeFileSync(generated(repo, 'curation.jsonl'), `${goodLedger}${goodLedger.split('\n')[1]}\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('ledger forks or duplicate sequence fail', result.status === 1 && result.output.includes('predecessor chain'), result.output);
  writeFileSync(generated(repo, 'curation.jsonl'), goodLedger);
  run(['render', '--root', repo, ...COLLECTION], repo);
  commit(repo, 'record curation');

  write(repo, 'records/two.md', `---
recordSchema: 1
supersedes: ["${firstId}"]
---
# Two

[mutable](records/mutable/result.json)
[frozen](records/frozen/native.json)
`);
  write(repo, 'records/frozen/native.json', '{"native":true}\n');
  git(['add', 'records/two.md', 'records/frozen/native.json'], repo);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/two.md'], repo);
  check('native append stages record metadata transaction', result.status === 0 && result.output.includes('records/two.md'), result.output);
  const nativeInventory = JSON.parse(readFileSync(generated(repo, 'inventory.json'), 'utf8'));
  check('native append snapshots new immutable artifacts', nativeInventory.artifacts.some((item) => item.path === 'records/frozen/native.json'
    && item.provenance === 'native'), JSON.stringify(nativeInventory));
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('native append passes staged-tree checks', result.status === 0, result.output);
  commit(repo, 'append native record');

  const dirtyManifestRepo = join(work, 'dirty-manifest-native-append');
  cpSync(repo, dirtyManifestRepo, { recursive: true });
  const dirtyManifestPath = join(dirtyManifestRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const dirtyManifest = JSON.parse(readFileSync(dirtyManifestPath, 'utf8'));
  dirtyManifest.recordCollections[0].scopes[0].pattern = '**/*.md';
  writeFileSync(dirtyManifestPath, `${JSON.stringify(dirtyManifest, null, 2)}\n`);
  write(dirtyManifestRepo, 'records/nested/native.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Dirty manifest native\n');
  git(['add', 'records/nested/native.md'], dirtyManifestRepo);
  const dirtyManifestSnapshot = generatedSnapshot(dirtyManifestRepo);
  result = run(['append', '--root', dirtyManifestRepo, ...COLLECTION,
    '--record', 'records/nested/native.md'], dirtyManifestRepo);
  check('native append refuses a worktree manifest that differs from the Git index', result.status === 1
    && result.output.includes('documentation manifest differs between the Git index and working tree')
    && generatedMatches(dirtyManifestRepo, dirtyManifestSnapshot), result.output);

  const filteredManifestRepo = join(work, 'non-injective-manifest-filter');
  cpSync(repo, filteredManifestRepo, { recursive: true });
  const filteredManifestPath = join(filteredManifestRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  write(filteredManifestRepo, 'canonical-manifest.json', readFileSync(filteredManifestPath, 'utf8'));
  write(filteredManifestRepo, '.gitattributes', '"hub/98 System/DOCS_MANIFEST.json" filter=fixed\n');
  git(['config', 'filter.fixed.clean', 'cat canonical-manifest.json'], filteredManifestRepo);
  git(['config', 'filter.fixed.smudge', 'cat'], filteredManifestRepo);
  commit(filteredManifestRepo, 'configure a non-injective manifest filter');
  const broaderFilteredManifest = JSON.parse(readFileSync(filteredManifestPath, 'utf8'));
  broaderFilteredManifest.recordCollections[0].scopes[0].pattern = '**/*.md';
  writeFileSync(filteredManifestPath, `${JSON.stringify(broaderFilteredManifest, null, 2)}\n`);
  const filterHidesManifestDifference = !git(['diff', '--name-only', '--', 'hub/98 System/DOCS_MANIFEST.json'], filteredManifestRepo).trim();
  write(filteredManifestRepo, 'records/nested/filtered.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Filtered manifest native\n');
  git(['add', 'records/nested/filtered.md'], filteredManifestRepo);
  const filteredManifestSnapshot = generatedSnapshot(filteredManifestRepo);
  result = run(['append', '--root', filteredManifestRepo, ...COLLECTION,
    '--record', 'records/nested/filtered.md'], filteredManifestRepo);
  check('Git-index manifest semantics survive a non-injective worktree clean filter', filterHidesManifestDifference
    && result.status === 1 && result.output.includes('invalid collection classification')
    && generatedMatches(filteredManifestRepo, filteredManifestSnapshot), result.output);

  const swappedManifestRepo = join(work, 'mid-operation-manifest-index-swap');
  cpSync(repo, swappedManifestRepo, { recursive: true });
  const swappedManifest = fixtureManifest();
  swappedManifest.recordCollections[0].scopes[0].pattern = '**/*.md';
  write(swappedManifestRepo, 'swapped-manifest.json', `${JSON.stringify(swappedManifest, null, 2)}\n`);
  const swappedManifestOid = git(['hash-object', '-w', 'swapped-manifest.json'], swappedManifestRepo).trim();
  write(swappedManifestRepo, 'records/index-race.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Index race\n');
  git(['add', 'records/index-race.md'], swappedManifestRepo);
  const indexSwapScript = instrumentedRecordsScript('mid-operation-manifest-index-swap-script', (source) => source.replace(
    'function manifestSha256(context) {\n',
    `function manifestSha256(context) {
  if (process.env.RECORD_EVAL_SWAP_OID) {
    git(context.root, ['update-index', '--cacheinfo', '100644', process.env.RECORD_EVAL_SWAP_OID, context.manifestRepoPath]);
    delete process.env.RECORD_EVAL_SWAP_OID;
  }
`,
  ));
  const indexSwapSnapshot = generatedSnapshot(swappedManifestRepo);
  result = runWithScript(indexSwapScript, ['append', '--root', swappedManifestRepo, ...COLLECTION,
    '--record', 'records/index-race.md'], swappedManifestRepo, { RECORD_EVAL_SWAP_OID: swappedManifestOid });
  check('native append refuses a manifest index swap before generated writes', result.status === 1
    && result.output.includes('documentation manifest Git-index state changed during operation')
    && generatedMatches(swappedManifestRepo, indexSwapSnapshot), result.output);

  const forgedManifestBatchRepo = join(work, 'forged-authority-manifest-binding');
  cpSync(repo, forgedManifestBatchRepo, { recursive: true });
  write(forgedManifestBatchRepo, 'records/forged-manifest.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Forged manifest binding\n');
  git(['add', 'records/forged-manifest.md'], forgedManifestBatchRepo);
  result = run(['append', '--root', forgedManifestBatchRepo, ...COLLECTION,
    '--record', 'records/forged-manifest.md'], forgedManifestBatchRepo);
  if (result.status === 0) {
    const forgedManifestInventoryPath = generated(forgedManifestBatchRepo, 'inventory.json');
    const forgedManifestInventory = JSON.parse(readFileSync(forgedManifestInventoryPath, 'utf8'));
    const forgedManifestBatch = forgedManifestInventory.authorityBatches.at(-1);
    forgedManifestBatch.manifestSha256 = '0'.repeat(64);
    rehashAuthorityBatch(forgedManifestBatch);
    writeFileSync(forgedManifestInventoryPath, `${JSON.stringify(forgedManifestInventory, null, 2)}\n`);
    commit(forgedManifestBatchRepo, 'commit forged authority manifest binding');
  }
  const forgedManifestBatchCheck = result.status === 0
    ? run(['check', '--root', forgedManifestBatchRepo, ...COLLECTION], forgedManifestBatchRepo) : result;
  check('committed authority batches bind their introduction-state manifest', result.status === 0
    && forgedManifestBatchCheck.status === 1
    && forgedManifestBatchCheck.output.includes('authority batch manifest does not match its introduction state'),
  `${result.output}\n${forgedManifestBatchCheck.output}`);

  const unterminatedAppendRepo = join(work, 'unterminated-native-append'); cpSync(repo, unterminatedAppendRepo, { recursive: true });
  write(unterminatedAppendRepo, 'records/broken.md', `---
recordSchema: 1
supersedes: []
---
# Broken

~~~yaml
[proof](records/frozen/stable.json)
`);
  git(['add', 'records/broken.md'], unterminatedAppendRepo);
  const unterminatedAppendInventory = readFileSync(generated(unterminatedAppendRepo, 'inventory.json'));
  result = run(['append', '--root', unterminatedAppendRepo, ...COLLECTION, '--record', 'records/broken.md'], unterminatedAppendRepo);
  check('native append rejects an unterminated fence before generated writes', result.status === 1
    && result.output.includes('unterminated Markdown fence in records/broken.md:7')
    && unterminatedAppendInventory.equals(readFileSync(generated(unterminatedAppendRepo, 'inventory.json'))), result.output);

  const reusedAppendRepo = join(work, 'reused-native-append'); cpSync(repo, reusedAppendRepo, { recursive: true });
  write(reusedAppendRepo, 'records/reused.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# First incarnation\n');
  commit(reusedAppendRepo, 'commit un-inventoried record incarnation');
  git(['rm', 'records/reused.md'], reusedAppendRepo); commit(reusedAppendRepo, 'remove un-inventoried record incarnation');
  write(reusedAppendRepo, 'records/reused.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Replacement incarnation\n');
  git(['add', 'records/reused.md'], reusedAppendRepo);
  const reusedInventoryBefore = readFileSync(generated(reusedAppendRepo, 'inventory.json'));
  result = run(['append', '--root', reusedAppendRepo, ...COLLECTION, '--record', 'records/reused.md'], reusedAppendRepo);
  check('native append rejects a reused record path before generated writes', result.status === 1
    && result.output.includes('new path with no reachable history')
    && reusedInventoryBefore.equals(readFileSync(generated(reusedAppendRepo, 'inventory.json'))), result.output);

  const reclassifiedAppendRepo = join(work, 'reclassified-native-artifact'); cpSync(repo, reclassifiedAppendRepo, { recursive: true });
  const reclassifiedAppendManifestPath = join(reclassifiedAppendRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const reclassifiedAppendManifest = JSON.parse(readFileSync(reclassifiedAppendManifestPath, 'utf8'));
  reclassifiedAppendManifest.recordCollections[0].classificationVersion = 2;
  reclassifiedAppendManifest.recordCollections[0].scopes = [
    { id: 'records', match: ['*.md'], paths: [], kind: 'record', policy: 'append-only' },
    { id: 'mutable', match: ['mutable/**'], paths: [], kind: 'artifact', policy: 'mutable' },
    { id: 'reclassified-result', match: [], paths: ['mutable/result.json'], kind: 'artifact', policy: 'frozen' },
    { id: 'frozen', match: ['frozen/**'], paths: [], kind: 'artifact', policy: 'frozen' },
    { id: 'executables', match: ['exec/**'], paths: [], kind: 'executable', policy: 'frozen' },
    { id: 'literal-bracket', match: [], paths: ['literal[0].json'], kind: 'artifact', policy: 'frozen' },
  ];
  writeFileSync(reclassifiedAppendManifestPath, `${JSON.stringify(reclassifiedAppendManifest, null, 2)}\n`);
  write(reclassifiedAppendRepo, 'records/three.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Three\n');
  write(reclassifiedAppendRepo, 'records/mutable/result.json', '{"PRIMARY":{"summary":2},"A":[0]}\n');
  git(['add', 'hub/98 System/DOCS_MANIFEST.json', 'records/three.md', 'records/mutable/result.json'], reclassifiedAppendRepo);
  result = run(['append', '--root', reclassifiedAppendRepo, ...COLLECTION, '--record', 'records/three.md'], reclassifiedAppendRepo);
  check('native append rejects historically mutable paths reclassified as immutable', result.status === 1
    && result.output.includes('new immutable artifact path with no reachable history'), result.output);

  const mergeHiddenAppendRepo = join(work, 'merge-hidden-native-history'); cpSync(repo, mergeHiddenAppendRepo, { recursive: true });
  git(['checkout', '-q', '-b', 'hidden-history'], mergeHiddenAppendRepo);
  write(mergeHiddenAppendRepo, 'records/hidden.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Hidden record\n');
  write(mergeHiddenAppendRepo, 'records/frozen/hidden.json', '{"hidden":true}\n');
  commit(mergeHiddenAppendRepo, 'add paths on side branch');
  git(['rm', 'records/hidden.md', 'records/frozen/hidden.json'], mergeHiddenAppendRepo);
  commit(mergeHiddenAppendRepo, 'remove paths on side branch');
  git(['checkout', '-q', 'main'], mergeHiddenAppendRepo);
  write(mergeHiddenAppendRepo, 'README.md', '# Mainline advancement\n');
  commit(mergeHiddenAppendRepo, 'advance main before hidden-history merge');
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval',
    'merge', '--no-ff', '-m', 'merge hidden path history', 'hidden-history'], mergeHiddenAppendRepo);
  const mergeHiddenInventoryBefore = readFileSync(generated(mergeHiddenAppendRepo, 'inventory.json'));
  write(mergeHiddenAppendRepo, 'records/hidden.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Replacement record\n');
  git(['add', 'records/hidden.md'], mergeHiddenAppendRepo);
  result = run(['append', '--root', mergeHiddenAppendRepo, ...COLLECTION, '--record', 'records/hidden.md'], mergeHiddenAppendRepo);
  check('native append rejects record history hidden by merge simplification', result.status === 1
    && result.output.includes('new path with no reachable history')
    && mergeHiddenInventoryBefore.equals(readFileSync(generated(mergeHiddenAppendRepo, 'inventory.json'))), result.output);
  git(['reset', '--quiet', 'HEAD', '--', 'records/hidden.md'], mergeHiddenAppendRepo);
  unlinkSync(join(mergeHiddenAppendRepo, 'records', 'hidden.md'));
  write(mergeHiddenAppendRepo, 'records/hidden-artifact.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Hidden artifact replacement\n');
  write(mergeHiddenAppendRepo, 'records/frozen/hidden.json', '{"replacement":true}\n');
  git(['add', 'records/hidden-artifact.md', 'records/frozen/hidden.json'], mergeHiddenAppendRepo);
  result = run(['append', '--root', mergeHiddenAppendRepo, ...COLLECTION, '--record', 'records/hidden-artifact.md'], mergeHiddenAppendRepo);
  check('native append rejects artifact history hidden by merge simplification', result.status === 1
    && result.output.includes('new immutable artifact path with no reachable history')
    && mergeHiddenInventoryBefore.equals(readFileSync(generated(mergeHiddenAppendRepo, 'inventory.json'))), result.output);

  const shallowArtifactClassRepo = join(work, 'shallow-artifact-classification'); cpSync(repo, shallowArtifactClassRepo, { recursive: true });
  const shallowArtifactManifestPath = join(shallowArtifactClassRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const shallowArtifactManifest = JSON.parse(readFileSync(shallowArtifactManifestPath, 'utf8'));
  shallowArtifactManifest.recordCollections[0].scopes.find((scope) => scope.pattern === 'frozen/**').policy = 'superseded';
  writeFileSync(shallowArtifactManifestPath, `${JSON.stringify(shallowArtifactManifest, null, 2)}\n`);
  commit(shallowArtifactClassRepo, 'reclassify frozen artifacts');
  writeFileSync(join(shallowArtifactClassRepo, '.git', 'shallow'), `${git(['rev-parse', 'HEAD'], shallowArtifactClassRepo).trim()}\n`);
  result = run(['check', '--root', shallowArtifactClassRepo, ...COLLECTION], shallowArtifactClassRepo);
  check('shallow checks still bind immutable artifact classification', result.status === 1
    && result.output.includes('frozen artifact deleted, renamed, or reclassified'), result.output);

  write(repo, 'records/missing-image.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Missing image\n\n![proof](records/missing.png)\n');
  git(['add', 'records/missing-image.md'], repo);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/missing-image.md'], repo);
  check('native append rejects unresolved image evidence', result.status === 1 && result.output.includes('unresolved citation'), result.output);
  git(['reset', '--quiet', 'HEAD', '--', 'records/missing-image.md'], repo); unlinkSync(join(repo, 'records', 'missing-image.md'));

  write(repo, 'records/missing-reference.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Missing reference\n\n[proof][missing]\n\n[missing]: records/missing-reference.json\n');
  git(['add', 'records/missing-reference.md'], repo);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/missing-reference.md'], repo);
  check('native append rejects unresolved reference evidence', result.status === 1 && result.output.includes('unresolved citation'), result.output);
  git(['reset', '--quiet', 'HEAD', '--', 'records/missing-reference.md'], repo); unlinkSync(join(repo, 'records', 'missing-reference.md'));

  write(repo, 'records/bad.md', '# Missing native schema\n');
  git(['add', 'records/bad.md'], repo);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/bad.md'], repo);
  check('native records require the explicit schema', result.status === 1 && result.output.includes('frontmatter'), result.output);
  git(['reset', '--quiet', 'HEAD', '--', 'records/bad.md'], repo); unlinkSync(join(repo, 'records', 'bad.md'));
  write(repo, 'records/three.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Three\n');
  git(['add', 'records/three.md'], repo);
  writeFileSync(generated(repo, 'inventory.json'), `${readFileSync(generated(repo, 'inventory.json'), 'utf8')} `);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/three.md'], repo);
  check('append refuses pre-existing generated edits', result.status === 1 && result.output.includes('pre-existing generated-file edit'), result.output);
  restoreFromHead(repo, 'hub/98 System/Records/inventory.json');
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/three.md', '--no-stage'], repo);
  check('advanced no-stage mode writes without staging generated files', result.status === 0
    && !git(['diff', '--cached', '--name-only'], repo).includes('inventory.json'), result.output);

  const unsafeNoStageRepo = join(work, 'unsafe-no-stage-pending'); cpSync(incrementalRepo, unsafeNoStageRepo, { recursive: true });
  write(unsafeNoStageRepo, 'records/unadmitted.md', '# Unadmitted committed authority\n');
  commit(unsafeNoStageRepo, 'commit unrelated pending authority');
  write(unsafeNoStageRepo, 'records/staged-native.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Staged native\n');
  git(['add', 'records/staged-native.md'], unsafeNoStageRepo);
  const unsafeNoStageSnapshot = generatedSnapshot(unsafeNoStageRepo);
  result = run(['append', '--root', unsafeNoStageRepo, ...COLLECTION,
    '--record', 'records/staged-native.md', '--no-stage'], unsafeNoStageRepo);
  const unsafeNoStageStaged = git(['diff', '--cached', '--name-only'], unsafeNoStageRepo).trim().split('\n').filter(Boolean);
  check('no-stage append rolls back when unrelated committed authority is pending admission', result.status === 1
    && result.output.includes('pending-admission: record missing from inventory: records/unadmitted.md')
    && generatedMatches(unsafeNoStageRepo, unsafeNoStageSnapshot)
    && unsafeNoStageStaged.join(',') === 'records/staged-native.md', result.output);

  const citationPath = generated(repo, 'citations.json');
  const locatorDoc = JSON.parse(readFileSync(citationPath, 'utf8'));
  const located = locatorDoc.entries.find((item) => item.target?.blobOid);
  const originalLocatorPath = located.target.path;
  const originalLocatorCommit = located.target.commitOid;
  located.target.blobOid = '0'.repeat(located.target.blobOid.length);
  writeFileSync(citationPath, `${JSON.stringify(locatorDoc, null, 2)}\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('bad Git locator recovers by authoritative content digest', result.status === 0, result.output);
  result = run(['reindex-locators', '--root', repo, ...COLLECTION], repo);
  const reindexedCitation = JSON.parse(readFileSync(citationPath, 'utf8')).entries
    .find((item) => item.recordId === located.recordId && item.sourceLine === located.sourceLine && item.rawTarget === located.rawTarget);
  check('locator reindex regenerates cache fields without rewriting provenance', result.status === 0
    && result.output.includes('locatorsUpdated')
    && reindexedCitation.target.path === originalLocatorPath
    && reindexedCitation.target.commitOid === originalLocatorCommit, result.output);

  commit(repo, 'snapshot advanced operations');
  const shallow = join(work, 'shallow');
  git(['clone', '--quiet', '--depth=1', `file:///${repo.replaceAll('\\', '/')}`, shallow], work);
  result = run(['check', '--root', shallow, ...COLLECTION], shallow);
  check('ordinary shallow checks warn but remain conformance checks', result.status === 0 && result.output.includes('history-unavailable'), result.output);
  result = run(['verify-history', '--strict', '--root', shallow, ...COLLECTION], shallow);
  check('strict history verification exits as infrastructure failure', result.status === 2 && result.output.includes('infrastructure history unavailable'), result.output);
  result = run(['adopt', '--root', shallow, ...COLLECTION], shallow);
  check('shallow adoption refuses before writing', result.status === 2 && result.output.includes('adoption refused'), result.output);

  const partial = join(work, 'partial'); cpSync(repo, partial, { recursive: true });
  git(['config', 'extensions.partialclone', 'origin'], partial);
  result = run(['verify-history', '--strict', '--root', partial, ...COLLECTION], partial);
  check('partial/promisor configuration fails strict history', result.status === 2 && result.output.includes('partial repository'), result.output);

  const lost = join(work, 'lost'); mkdirSync(lost, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], lost);
  write(lost, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(lost, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(lost, 'records/one.md', '# Lost evidence\n\n[lost](records/frozen/lost.json)\n');
  write(lost, 'records/frozen/lost.json', '{"lost":true}\n');
  commit(lost, 'seed recoverable evidence');
  unlinkSync(join(lost, 'records', 'frozen', 'lost.json')); commit(lost, 'remove evidence target');
  result = run(['adopt', '--root', lost, ...COLLECTION], lost);
  const lostCitationsPath = generated(lost, 'citations.json');
  const lostCitations = JSON.parse(readFileSync(lostCitationsPath, 'utf8'));
  lostCitations.entries.find((item) => item.state === 'redirected').target.targetSha256 = 'f'.repeat(64);
  writeFileSync(lostCitationsPath, `${JSON.stringify(lostCitations, null, 2)}\n`);
  commit(lost, 'adopt unavailable evidence baseline');
  result = run(['check', '--root', lost, ...COLLECTION], lost);
  check('missing authoritative content with complete history is evidence-lost', result.status === 1 && result.output.includes('evidence-lost'), result.output);

  const scopeRepo = join(work, 'scope'); cpSync(repo, scopeRepo, { recursive: true });
  const scopeManifestPath = join(scopeRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const generatedBoundaryRepo = join(work, 'generated-boundary'); cpSync(repo, generatedBoundaryRepo, { recursive: true });
  const generatedBoundaryManifestPath = join(generatedBoundaryRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const generatedBoundary = JSON.parse(readFileSync(generatedBoundaryManifestPath, 'utf8'));
  generatedBoundary.recordCollections[0].index = '40 Engineering/ordinary.md';
  writeFileSync(generatedBoundaryManifestPath, `${JSON.stringify(generatedBoundary, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], generatedBoundaryRepo);
  result = run(['classify', '--root', generatedBoundaryRepo, ...COLLECTION], generatedBoundaryRepo);
  check('record engine independently confines generated paths to the reserved Records directory', result.status === 1
    && result.output.includes('outside 98 System/Records/'), result.output);
  const overlap = JSON.parse(readFileSync(scopeManifestPath, 'utf8'));
  overlap.recordCollections[0].scopes.push({ pattern: '*.md', kind: 'artifact', policy: 'mutable' });
  writeFileSync(scopeManifestPath, `${JSON.stringify(overlap, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], scopeRepo);
  result = run(['classify', '--root', scopeRepo, ...COLLECTION], scopeRepo);
  check('multiple matching scopes fail classification', result.status === 1 && result.output.includes('invalid collection classification'), result.output);
  const zero = fixtureManifest(); writeFileSync(scopeManifestPath, `${JSON.stringify(zero, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], scopeRepo);
  write(scopeRepo, 'records/unclassified.bin', 'x'); git(['add', 'records/unclassified.bin'], scopeRepo);
  result = run(['classify', '--root', scopeRepo, ...COLLECTION], scopeRepo);
  check('zero matching scopes fail classification', result.status === 1 && result.output.includes('invalid collection classification'), result.output);
  const forbidden = fixtureManifest(); forbidden.recordCollections[0].scopes.push({ pattern: '**/*.pyc', kind: 'forbidden', policy: 'forbidden' });
  writeFileSync(scopeManifestPath, `${JSON.stringify(forbidden, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], scopeRepo);
  write(scopeRepo, 'records/cache/bad.pyc', 'x'); git(['add', 'records/cache/bad.pyc'], scopeRepo);
  result = run(['classify', '--root', scopeRepo, ...COLLECTION], scopeRepo);
  check('tracked pyc files are forbidden', result.status === 1 && result.output.includes('bad.pyc'), result.output);

  const legacyRepo = join(work, 'legacy'); cpSync(repo, legacyRepo, { recursive: true });
  const legacyManifestPath = join(legacyRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const legacy = JSON.parse(readFileSync(legacyManifestPath, 'utf8'));
  const immutableBeforeLegacy = readFileSync(join(legacyRepo, 'records', 'one.md'), 'utf8');
  legacy.legacyPaths = [
    { path: 'records/one.md', disposition: 'pointer', target: 'hub/Standard.md', requiredBy: [{ kind: 'external', ref: 'requirements.txt' }] },
  ];
  writeFileSync(legacyManifestPath, `${JSON.stringify(legacy, null, 2)}\n`);
  write(legacyRepo, 'requirements.txt', 'consumer requires records/one.md\n');
  git(['add', 'hub/98 System/DOCS_MANIFEST.json', 'requirements.txt'], legacyRepo);
  result = run(['render', '--legacy', '--root', legacyRepo, ...COLLECTION], legacyRepo);
  check('legacy paths cannot overwrite immutable record bytes', result.status === 1
    && result.output.includes('overlaps governed records')
    && readFileSync(join(legacyRepo, 'records', 'one.md'), 'utf8') === immutableBeforeLegacy, result.output);
  legacy.legacyPaths = [
    { path: 'docs/old.md', disposition: 'pointer', target: 'hub/Standard.md', requiredBy: [{ kind: 'external', ref: 'requirements.txt' }] },
    { path: 'docs/gone.md', disposition: 'tombstone', target: 'hub/Standard.md', requiredBy: [{ kind: 'external', ref: 'requirements.txt' }] },
  ];
  writeFileSync(legacyManifestPath, `${JSON.stringify(legacy, null, 2)}\n`);
  write(legacyRepo, 'requirements.txt', 'consumer requires docs/old.md and docs/gone.md\n');
  git(['add', 'hub/98 System/DOCS_MANIFEST.json', 'requirements.txt'], legacyRepo);
  result = run(['render', '--legacy', '--root', legacyRepo, ...COLLECTION], legacyRepo);
  check('eligible legacy pointers and tombstones render exact bounded files', result.status === 0
    && readFileSync(join(legacyRepo, 'docs', 'old.md'), 'utf8').includes('legacy-pointer v1')
    && readFileSync(join(legacyRepo, 'docs', 'gone.md'), 'utf8').includes('tombstone v1'), result.output);
  result = run(['check', '--root', legacyRepo, ...COLLECTION], legacyRepo);
  check('legacy generated files pass mechanical eligibility checks', result.status === 0, result.output);
  legacy.legacyPaths[0].requiredBy = [{ kind: 'external', ref: 'missing.txt' }];
  writeFileSync(legacyManifestPath, `${JSON.stringify(legacy, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], legacyRepo);
  result = run(['render', '--legacy', '--root', legacyRepo, ...COLLECTION], legacyRepo);
  check('ineligible legacy paths fail closed', result.status === 1 && result.output.includes('ineligible legacy path'), result.output);

  const recordPointerRepo = join(work, 'record-qualified-pointer'); mkdirSync(recordPointerRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], recordPointerRepo);
  write(recordPointerRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(recordPointerRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(recordPointerRepo, 'docs/old.md', '# Old authored location\n');
  write(recordPointerRepo, 'records/one.md', '# Record\n\n[old](docs/old.md)\n');
  commit(recordPointerRepo, 'seed record-qualified legacy path');
  result = run(['adopt', '--root', recordPointerRepo, ...COLLECTION], recordPointerRepo);
  check('record-qualified pointer fixture adopts before migration', result.status === 0, result.output);
  commit(recordPointerRepo, 'adopt before pointer migration');
  const pointerInventory = JSON.parse(readFileSync(generated(recordPointerRepo, 'inventory.json'), 'utf8'));
  const pointerManifestPath = join(recordPointerRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const pointerManifest = JSON.parse(readFileSync(pointerManifestPath, 'utf8'));
  pointerManifest.legacyPaths = [{
    path: 'docs/old.md', disposition: 'pointer', target: 'hub/Standard.md',
    requiredBy: [{ kind: 'record', ref: pointerInventory.entries[0].id }],
  }];
  writeFileSync(pointerManifestPath, `${JSON.stringify(pointerManifest, null, 2)}\n`);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], recordPointerRepo);
  result = run(['render', '--legacy', '--root', recordPointerRepo, ...COLLECTION], recordPointerRepo);
  const pointerRender = result;
  result = run(['check', '--root', recordPointerRepo, ...COLLECTION], recordPointerRepo);
  check('record-qualified pointer migration preserves pinned history and passes', pointerRender.status === 0 && result.status === 0, `${pointerRender.output}\n${result.output}`);
  if (executedCases !== expectedCases) throw new Error(`expected ${expectedCases} cases but executed ${executedCases}`);
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`\nrecord-collections eval passed (${executedCases}/${expectedCases} cases)`);
} catch (error) {
  const message = error instanceof Error ? error.message : (() => {
    try { return String(error); } catch { return '<unstringifiable thrown value>'; }
  })();
  console.error(`\nrecord-collections eval aborted (${executedCases}/${expectedCases} cases): ${message}`);
  process.exitCode = 1;
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
