// Genesis authority forgeries. The body moved verbatim from the former single-file eval.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestJson } from '../../scripts/record-lib.mjs';
import { COLLECTION, GENERATED_NAMES, work, check, run, runWithScript, git, commit, write, fixtureManifest, generated, rehashAuthorityBatch, rehashAuthorityChain, adoptedFixture, makeCorruptPostWriteScript } from './harness.mjs';

export function runSection() {
  let result;
  const repo = adoptedFixture();
  const corruptPostWriteScript = makeCorruptPostWriteScript();

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

}
