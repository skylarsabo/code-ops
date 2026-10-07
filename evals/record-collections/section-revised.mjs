// Reviewed adoption of a revised record, checkout filters, and a forged review source head. The body moved verbatim from the former single-file eval.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestJson } from '../../scripts/record-lib.mjs';
import { COLLECTION, work, check, run, git, configuredGit, commit, squashCurrentTree, write, fixtureManifest, generated, rehashAuthorityChain, seedFixture } from './harness.mjs';

export function runSection() {
  let result;
  const repo = seedFixture();

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
  const portableReviewRepo = join(work, 'portable-review-alias'); cpSync(revisedRepo, portableReviewRepo, { recursive: true });
  writeFileSync(join(portableReviewRepo, '.git', 'info', 'exclude'), 'adoption-review.json\nreview/\n');
  write(portableReviewRepo, 'Review/Victim.json', 'tracked authority\n');
  git(['add', '-f', 'Review/Victim.json'], portableReviewRepo);
  commit(portableReviewRepo, 'add tracked mixed-case authority');
  const reviewVictim = join(portableReviewRepo, 'Review', 'Victim.json');
  const reviewVictimBytes = readFileSync(reviewVictim);
  result = run(['plan-adoption', '--root', portableReviewRepo, ...COLLECTION, '--out', 'review/victim.json'], portableReviewRepo);
  check('adoption review output rejects a portable alias of a tracked path without mutation', result.status === 1
    && result.output.includes('tracked Git path') && readFileSync(reviewVictim).equals(reviewVictimBytes), result.output);
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

}
