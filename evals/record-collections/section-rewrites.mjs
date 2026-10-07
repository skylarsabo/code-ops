// Committed rewrites of inventory, citations, ledger, and identity. The body moved verbatim from the former single-file eval.
import { cpSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { digestJson, recordId, sha256 } from '../../scripts/record-lib.mjs';
import { UUID, COLLECTION, work, check, run, git, commit, write, fixtureManifest, generated, rehashAuthorityChain, restoreFromHead, adoptedFixture } from './harness.mjs';

export function runSection() {
  let result;
  const repo = adoptedFixture();
  const firstId = JSON.parse(readFileSync(generated(repo, 'inventory.json'), 'utf8')).entries[0].id;
  const originalRecord = readFileSync(join(repo, 'records', 'one.md'), 'utf8');

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

}
