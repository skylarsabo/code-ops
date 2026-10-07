// Promotion, merge, rename, and lineage-reuse adoption review. The body moved verbatim from the former single-file eval.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COLLECTION, work, check, run, git, commit, squashCurrentTree, write, fixtureManifest, generated } from './harness.mjs';

export function runSection() {
  let result;

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

}
