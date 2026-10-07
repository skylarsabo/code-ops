// Scheduled mutable appends and re-review receipts. The body moved verbatim from the former single-file eval.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestJson, jsonl } from '../../scripts/record-lib.mjs';
import { COLLECTION, work, check, run, git, commit, squashCurrentTree, write, fixtureManifest, generated, rehashAuthorityChain, adoptedFixture } from './harness.mjs';

export function runSection() {
  let result;
  const repo = adoptedFixture();

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

  const reReviewArgs = (root, path) => ['re-review', '--root', root, ...COLLECTION, '--record', path,
    '--reviewer', 'operator', '--rationale', 'restored bytes equal the reviewed bytes', '--at', '2026-09-24T00:00:00Z'];
  const reReviewFork = (name) => { const target = join(work, name); cpSync(revertedHistoryRepo, target, { recursive: true }); return target; };
  result = run(reReviewArgs(repo, 'records/one.md'), repo);
  check('re-review refuses a path whose history gained no content transitions', result.status === 1
    && result.output.includes('history gained no content transitions'), result.output);
  const reReviewBytesRepo = reReviewFork('re-review-bytes-differ');
  write(reReviewBytesRepo, 'records/one.md', `${originalRecord}\nlasting rewrite\n`);
  commit(reReviewBytesRepo, 'rewrite adopted record after restore');
  result = run(reReviewArgs(reReviewBytesRepo, 'records/one.md'), reReviewBytesRepo);
  check('re-review refuses current bytes that differ from the reviewed digest', result.status === 1
    && result.output.includes('current bytes differ from the reviewed digest'), result.output);
  const reReviewDirtyRepo = reReviewFork('re-review-dirty');
  write(reReviewDirtyRepo, 'records/one.md', `${originalRecord}\nuncommitted\n`);
  result = run(reReviewArgs(reReviewDirtyRepo, 'records/one.md'), reReviewDirtyRepo);
  check('re-review refuses a dirty worktree', result.status === 1
    && result.output.includes('re-review requires a clean worktree'), result.output);
  const reReviewRepo = reReviewFork('re-review-accept');
  result = run(reReviewArgs(reReviewRepo, 'records/missing.md'), reReviewRepo);
  check('re-review refuses a path that is not admitted', result.status === 1
    && result.output.includes('re-review requires an admitted path'), result.output);
  result = run(reReviewArgs(reReviewRepo, 'records/one.md'), reReviewRepo);
  const reReviewCheck = run(['check', '--root', reReviewRepo, ...COLLECTION], reReviewRepo);
  const reReviewInventory = JSON.parse(readFileSync(generated(reReviewRepo, 'inventory.json'), 'utf8'));
  const reReceipt = reReviewInventory.reReviews?.[0];
  check('re-review records a receipt that preserves the original review and clears drift', result.status === 0
    && reReviewCheck.status === 0 && reReviewInventory.adoptionReview?.candidates?.some((item) => item.path === 'records/one.md')
    && reReceipt?.reviewer === 'operator' && reReceipt.examinedCommits.length === 2
    && reReceipt.candidate.history.contentTransitions > 0, `${result.output}\n${reReviewCheck.output}`);
  commit(reReviewRepo, 'record re-review');
  result = run(['check', '--root', reReviewRepo, ...COLLECTION], reReviewRepo);
  check('a committed re-review keeps check green', result.status === 0, result.output);
  const sideRepo = reReviewFork('re-review-side-branch');
  const sideSource = JSON.parse(readFileSync(generated(sideRepo, 'inventory.json'), 'utf8')).adoptionReview.sourceHead;
  const sideBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'], sideRepo).trim();
  const evalIdentity = ['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval'];
  git(['checkout', '-q', '--detach', sideSource], sideRepo);
  git([...evalIdentity, 'commit', '-q', '--amend', '--allow-empty', '-m', 'rewritten review source'], sideRepo);
  git([...evalIdentity, 'cherry-pick', '--allow-empty', '--keep-redundant-commits', `${sideSource}..${sideBranch}`], sideRepo);
  git(['checkout', '-q', '-B', sideBranch], sideRepo);
  result = run(reReviewArgs(sideRepo, 'records/one.md'), sideRepo);
  const sideReceipt = JSON.parse(readFileSync(generated(sideRepo, 'inventory.json'), 'utf8')).reReviews?.[0];
  check('re-review accepts a prior review source left on a side branch', result.status === 0
    && sideReceipt?.priorSourceHead === sideSource && sideReceipt.examinedCommits.length >= 2, result.output);
  const reTamperRepo = join(work, 're-review-tamper'); cpSync(reReviewRepo, reTamperRepo, { recursive: true });
  const reTamperInventory = JSON.parse(readFileSync(generated(reTamperRepo, 'inventory.json'), 'utf8'));
  reTamperInventory.reReviews[0].rationale = 'forged';
  writeFileSync(generated(reTamperRepo, 'inventory.json'), `${JSON.stringify(reTamperInventory, null, 2)}\n`);
  result = run(['check', '--root', reTamperRepo, ...COLLECTION], reTamperRepo);
  check('a tampered re-review receipt fails', result.status === 1
    && result.output.includes('invalid record re-review receipt'), result.output);
  const { receiptDigest: _forgedDigest, ...forgedReceipt } = {
    ...reTamperInventory.reReviews[0], rationale: reReceipt.rationale, reviewer: 'someone else',
  };
  reTamperInventory.reReviews[0] = { ...forgedReceipt, receiptDigest: digestJson(forgedReceipt) };
  writeFileSync(generated(reTamperRepo, 'inventory.json'), `${JSON.stringify(reTamperInventory, null, 2)}\n`);
  result = run(['check', '--root', reTamperRepo, ...COLLECTION], reTamperRepo);
  check('a re-digested committed re-review cannot be rewritten', result.status === 1
    && result.output.includes('record re-review chain changed at entry 1'), result.output);

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

}
