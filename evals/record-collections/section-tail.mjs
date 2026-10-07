// Drift, curation, native append, shallow clones, scopes, and legacy paths. The body moved verbatim from the former single-file eval.
import { cpSync, mkdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UUID, COLLECTION, work, check, run, runWithScript, git, commit, write, instrumentedRecordsScript, fixtureManifest, generated, generatedSnapshot, generatedMatches, rehashAuthorityBatch, restoreFromHead, adoptedFixture } from './harness.mjs';

export function runSection() {
  let result;
  const repo = adoptedFixture();
  const firstId = JSON.parse(readFileSync(generated(repo, 'inventory.json'), 'utf8')).entries[0].id;
  const originalRecord = readFileSync(join(repo, 'records', 'one.md'), 'utf8');

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
}
