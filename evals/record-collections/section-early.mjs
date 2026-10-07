// Classification, scope v2, history batches, oversized blobs, and copy handling. The body moved verbatim from the former single-file eval.
import { cpSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adoptionHistoryProfiles, digestJson, historyPathBatches, indexSnapshot, jsonl, sha256, targetsAt } from '../../scripts/record-lib.mjs';
import { ROOT, COLLECTION, work, execFileSync, check, run, runWithScript, git, commit, write, fixtureManifest, generated, seedFixture } from './harness.mjs';

export function runSection() {
  const repo = seedFixture();

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

  const copyRepo = join(work, 'copied-record'); mkdirSync(copyRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], copyRepo);
  const copySource = 'records/source.md'; const copyDestination = 'records/copy.md';
  const copySourceText = `${Array.from({ length: 40 }, (_, line) => `shared evidence line ${line}`).join('\n')}\n`;
  const copyDestinationText = `${copySourceText}one appended line\n`;
  write(copyRepo, copySource, copySourceText); commit(copyRepo, 'add copy source');
  const copyCollection = fixtureManifest().recordCollections[0];
  const copyRow = (path) => ({ path, kind: 'record', policy: 'append-only' });
  const sourceBeforeCopy = adoptionHistoryProfiles(copyRepo, copyCollection, [copyRow(copySource)]).get(copySource);
  write(copyRepo, copyDestination, copyDestinationText); commit(copyRepo, 'add similar copy');
  const copyCommit = git(['rev-parse', 'HEAD'], copyRepo).trim();
  const copyLog = git(['log', '--follow', '--format=%H%x00', '--raw', '-z', '-M', '--no-abbrev', '--', `:(literal)${copyDestination}`], copyRepo);
  let copyProfiles = null; let copyProfileError = '';
  try { copyProfiles = adoptionHistoryProfiles(copyRepo, copyCollection, [copyRow(copySource), copyRow(copyDestination)]); }
  catch (error) { copyProfileError = error.message; }
  const copiedProfile = copyProfiles?.get(copyDestination);
  check('fixture history reports the similar add as a copy record', /\sC\d+\0/.test(copyLog), copyLog.replaceAll('\0', ' '));
  check('a copy never alters the history profile of its source',
    JSON.stringify(copyProfiles?.get(copySource)) === JSON.stringify(sourceBeforeCopy)
    && sourceBeforeCopy.history.contentTransitions === 0 && sourceBeforeCopy.adoptionReadiness === 'ready',
  `${copyProfileError}${JSON.stringify(copyProfiles?.get(copySource))}`);
  check('a copy destination profiles as a plain add at the copy commit',
    copiedProfile?.history?.admittedCommit === copyCommit && copiedProfile.history.firstRelevantCommit === copyCommit
    && copiedProfile.history.contentTransitions === 0 && copiedProfile.history.priorIncarnations === 0
    && copiedProfile.adoptionReadiness === 'ready' && copiedProfile.reason === 'stable-so-far'
    && copiedProfile.historyDigest === digestJson({
      path: copyDestination,
      lineageEvents: [{ status: 'A', oldPath: copyDestination, newPath: copyDestination, oldSha256: null, newSha256: sha256(Buffer.from(copyDestinationText)) }],
      priorEvents: [],
    }), `${copyProfileError}${JSON.stringify(copiedProfile)}`);

  let legacyCopyProfiles = null;
  try {
    legacyCopyProfiles = adoptionHistoryProfiles(copyRepo, copyCollection, [copyRow(copySource), copyRow(copyDestination)],
      { legacyCopyBound: () => true });
  } catch (error) { copyProfileError = error.message; }
  const unboundLegacy = adoptionHistoryProfiles(copyRepo, copyCollection, [copyRow(copySource), copyRow(copyDestination)],
    { legacyCopyBound: () => false });
  check('the legacy copy reading charges the copy to its source only inside the bound',
    legacyCopyProfiles?.get(copySource)?.history?.contentTransitions === 1
    && legacyCopyProfiles.get(copySource).history.lastRelevantCommit === copyCommit
    && legacyCopyProfiles.get(copyDestination).historyDigest === copiedProfile?.historyDigest
    && JSON.stringify([...unboundLegacy]) === JSON.stringify([...copyProfiles]), `${copyProfileError}${JSON.stringify(legacyCopyProfiles?.get(copySource))}`);

  // A release through 1.85.0 read every copy as a change to its source. This script reproduces that reading.
  const copyLegacyRelease = join(work, 'legacy-copy-release'); mkdirSync(copyLegacyRelease, { recursive: true });
  const fixedLibrary = readFileSync(join(ROOT, 'scripts', 'record-lib.mjs'), 'utf8');
  const copyLegacyLibrary = fixedLibrary.replace('legacyCopyBound = null,', 'legacyCopyBound = () => true,');
  if (copyLegacyLibrary === fixedLibrary) throw new Error('instrumentation anchor was not found for legacy-copy-release');
  writeFileSync(join(copyLegacyRelease, 'record-lib.mjs'), copyLegacyLibrary);
  for (const name of ['records.mjs', 'context-index-lib.mjs']) cpSync(join(ROOT, 'scripts', name), join(copyLegacyRelease, name));
  const copyLegacyScript = join(copyLegacyRelease, 'records.mjs');
  const copyLegacyRepo = join(work, 'legacy-copy-review'); cpSync(copyRepo, copyLegacyRepo, { recursive: true });
  write(copyLegacyRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(copyLegacyRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(copyLegacyRepo, 'add hub');
  writeFileSync(join(copyLegacyRepo, '.git', 'info', 'exclude'), 'adoption-review.json\n');
  result = runWithScript(copyLegacyScript, ['plan-adoption', '--root', copyLegacyRepo, ...COLLECTION, '--out', 'adoption-review.json'], copyLegacyRepo);
  const copyLegacyReviewPath = join(copyLegacyRepo, 'adoption-review.json');
  const copyLegacyReview = result.status === 0 ? JSON.parse(readFileSync(copyLegacyReviewPath, 'utf8')) : null;
  const legacySourceCandidate = copyLegacyReview?.candidates?.find((candidate) => candidate.path === copySource);
  if (legacySourceCandidate) {
    legacySourceCandidate.disposition = 'freeze-current';
    legacySourceCandidate.rationale = 'The source bytes never changed.';
    writeFileSync(copyLegacyReviewPath, `${JSON.stringify(copyLegacyReview, null, 2)}\n`);
  }
  check('the legacy reading plans a copied source as historically revised',
    legacySourceCandidate?.reason === 'historically-revised' && legacySourceCandidate.history.contentTransitions === 1, result.output);
  result = runWithScript(copyLegacyScript, ['adopt', '--root', copyLegacyRepo, ...COLLECTION, '--review', 'adoption-review.json'], copyLegacyRepo);
  if (result.status === 0) commit(copyLegacyRepo, 'adopt under the legacy copy reading');
  const legacyAdoptOutput = result.output;
  result = run(['check', '--root', copyLegacyRepo, ...COLLECTION], copyLegacyRepo);
  check('a review written under the legacy copy reading still verifies', result.status === 0, `${legacyAdoptOutput}${result.output}`);
  const forgedRepo = join(work, 'forged-copy-review'); cpSync(copyLegacyRepo, forgedRepo, { recursive: true });
  write(copyLegacyRepo, 'records/later-copy.md', `${copySourceText}another appended line\n`);
  commit(copyLegacyRepo, 'copy the adopted source again');
  writeFileSync(join(copyLegacyRepo, '.git', 'info', 'exclude'), 'adoption-review.json\nincremental-review.json\n');
  result = run(['plan-adoption', '--incremental', '--root', copyLegacyRepo, ...COLLECTION, '--out', 'incremental-review.json'], copyLegacyRepo);
  const laterPlanOutput = result.output;
  result = result.status === 0
    ? run(['adopt', '--root', copyLegacyRepo, ...COLLECTION, '--review', 'incremental-review.json'], copyLegacyRepo) : result;
  if (result.status === 0) commit(copyLegacyRepo, 'admit the later copy');
  const laterAdoptOutput = result.output;
  result = run(['check', '--root', copyLegacyRepo, ...COLLECTION], copyLegacyRepo);
  const legacyLaterCheck = runWithScript(copyLegacyScript, ['check', '--root', copyLegacyRepo, ...COLLECTION], copyLegacyRepo);
  check('a copy admitted after the review never drifts the adopted source', result.status === 0
    && legacyLaterCheck.status === 1 && /records\/(?:source|copy)\.md/.test(legacyLaterCheck.output),
  `${laterPlanOutput}${laterAdoptOutput}${result.output}${legacyLaterCheck.output}`);
  const forgedInventoryPath = generated(forgedRepo, 'inventory.json');
  const forgedText = existsSync(forgedInventoryPath) ? readFileSync(forgedInventoryPath, 'utf8') : '';
  check('fixture inventory stores the reviewed transition count', forgedText.includes('"contentTransitions": 1'));
  writeFileSync(forgedInventoryPath, forgedText.replace('"contentTransitions": 1', '"contentTransitions": 2'));
  result = run(['check', '--root', forgedRepo, ...COLLECTION], forgedRepo);
  check('a review matching neither copy reading still fails', result.status === 1, result.output);

  const copiedRecordCliRepo = join(work, 'copied-record-cli'); mkdirSync(copiedRecordCliRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], copiedRecordCliRepo);
  write(copiedRecordCliRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(copiedRecordCliRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  const copiedRecordCliBody = Array.from({ length: 60 }, (_, line) => `Observation ${line + 1} of the recorded evidence run.`).join('\n');
  write(copiedRecordCliRepo, 'records/source.md', `# Source record\n${copiedRecordCliBody}\n`);
  commit(copiedRecordCliRepo, 'add the source record');
  write(copiedRecordCliRepo, 'records/copy.md', `# Copied record\n${copiedRecordCliBody}\nOne added observation that makes this a near copy.\n`);
  commit(copiedRecordCliRepo, 'add a record copied from the source record');
  const copiedRecordCliAdmission = git(['rev-parse', 'HEAD'], copiedRecordCliRepo).trim();
  writeFileSync(join(copiedRecordCliRepo, '.git', 'info', 'exclude'), 'adoption-review.json\n');
  result = run(['plan-adoption', '--root', copiedRecordCliRepo, ...COLLECTION, '--out', 'adoption-review.json'], copiedRecordCliRepo);
  const copiedRecordCliPlan = result.status === 0
    ? JSON.parse(readFileSync(join(copiedRecordCliRepo, 'adoption-review.json'), 'utf8')) : null;
  const copiedRecordCliSource = copiedRecordCliPlan?.candidates?.find((candidate) => candidate.path === 'records/source.md');
  const copiedRecordCliTarget = copiedRecordCliPlan?.candidates?.find((candidate) => candidate.path === 'records/copy.md');
  check('the CLI leaves a copied source untouched and starts the copy at its own admission',
    result.status === 0
    && copiedRecordCliSource?.adoptionReadiness === 'ready' && copiedRecordCliSource.history.contentTransitions === 0
    && copiedRecordCliSource.history.lastRelevantCommit === copiedRecordCliSource.history.admittedCommit
    && copiedRecordCliTarget?.adoptionReadiness === 'ready' && copiedRecordCliTarget.history.contentTransitions === 0
    && copiedRecordCliTarget.history.admittedCommit === copiedRecordCliAdmission
    && copiedRecordCliTarget.history.firstRelevantCommit === copiedRecordCliAdmission,
    `${result.output}${JSON.stringify(copiedRecordCliPlan?.candidates)}`);
  const copiedRecordCliAdopt = run(['adopt', '--root', copiedRecordCliRepo, ...COLLECTION], copiedRecordCliRepo);
  if (copiedRecordCliAdopt.status === 0) commit(copiedRecordCliRepo, 'adopt the source and copied records');
  const copiedRecordCliStrict = copiedRecordCliAdopt.status === 0
    ? run(['verify-history', '--strict', '--root', copiedRecordCliRepo, ...COLLECTION], copiedRecordCliRepo) : copiedRecordCliAdopt;
  check('the CLI adopts a copied record without review',
    copiedRecordCliAdopt.status === 0 && copiedRecordCliStrict.status === 0,
    `${copiedRecordCliAdopt.output}${copiedRecordCliStrict.output}`);

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

}
