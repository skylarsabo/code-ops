// Incremental admission, native migration, lock recovery, and rollback. The body moved verbatim from the former single-file eval.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { digestJson, recordId, sha256 } from '../../scripts/record-lib.mjs';
import { UUID, COLLECTION, work, check, run, runWithScript, runWithScriptCaptured, git, commit, write, instrumentedRecordsScript, fixtureManifest, generated, generatedSnapshot, generatedMatches, authorityRefDigest, inventoryAuthorityRefs, fixtureGeneratedBindings, rehashAuthorityBatch, rehashAuthorityChain, moveAuthorityRef, adoptedFixture, makeCorruptPostWriteScript } from './harness.mjs';

export function runSection() {
  let result;
  const repo = adoptedFixture();
  const corruptPostWriteScript = makeCorruptPostWriteScript();

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

  const readCacheRepo = join(work, 'git-read-cache-invalidation'); cpSync(incrementalRepo, readCacheRepo, { recursive: true });
  write(readCacheRepo, 'cache-probe.md', '# Cache probe\n');
  const readCacheScript = instrumentedRecordsScript('git-read-cache-invalidation-script', (source) => source.replace(
    '  manifestSha256(context);\n  const { rows } = collect(context);',
    `  manifestSha256(context);
  const probe = 'cache-probe.md'; const failures = [];
  if (trackedPaths(context.root).includes(probe)) failures.push('probe was tracked before git add');
  if (pathHasHistory(context.root, probe)) failures.push('probe had history before git commit');
  git(context.root, ['add', probe]);
  if (!trackedPaths(context.root).includes(probe)) failures.push('tracked-path read is stale after git add');
  git(context.root, ['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'cache probe']);
  if (!pathHasHistory(context.root, probe)) failures.push('history read is stale after git commit');
  console.log(failures.length ? 'git-read-cache stale: ' + failures.join('; ') : 'git-read-cache fresh');
  process.exit(failures.length ? 1 : 0);
  const { rows } = collect(context);`,
  ));
  result = runWithScript(readCacheScript, ['check', '--root', readCacheRepo, ...COLLECTION], readCacheRepo);
  check('cached Git reads refresh after this process stages and commits', result.status === 0
    && result.output.includes('git-read-cache fresh'), result.output);

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

  // The old lock directory is renamed aside, not removed, so the new one cannot reuse its inode and the lease identity check sees a new directory on every filesystem.
  const identityOnlyLostLeaseScript = instrumentedRecordsScript('identity-only-lost-lease-script', (source) => source.replace(
    /function releaseMutationLock\(lease\) \{\r?\n/,
    (match) => `${match}  if (process.env.CODE_OPS_EVAL_REPLACE_LEASE_IDENTITY === '1') {\n    renameSync(lease.lock, lease.lock + '.replaced');\n    mkdirSync(lease.lock);\n    writeFileSync(lease.owner, JSON.stringify({ pid: 1, token: lease.token, acquiredAt: '2026-08-28T03:35:00.000Z' }) + '\\n');\n  }\n`,
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
}
