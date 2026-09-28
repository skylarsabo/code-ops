// Synthetic W2 coverage: manifest v3, intake, seal, relocate-root, typed events, and the register.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { forwardingErrors, forwardPath, readJsonl, recordId } from '../../scripts/record-lib.mjs';

const UUID = '22222222-2222-4222-8222-222222222222';
const COLLECTION = ['--collection', 'evidence'];
const AT = ['--at', '2026-09-28T00:00:00.000Z'];

function v3Manifest(overrides = {}) {
  return {
    version: 3, hub: 'hub', runs: { tracking: 'ignored', retain: 5 }, domains: [{ id: 'records' }], legacyPaths: [],
    recordCollections: [{
      collectionUuid: UUID, id: 'evidence', identityVersion: 1, root: 'records',
      inventory: '98 System/Records/inventory.json', citations: '98 System/Records/citations.json',
      curationLedger: '98 System/Records/curation.jsonl', index: '98 System/Records/index.md',
      scopes: [
        { pattern: '*.md', kind: 'record', policy: 'append-only' },
        { pattern: 'frozen/**', kind: 'artifact', policy: 'frozen' },
      ],
    }],
    ...overrides,
  };
}
function nativeRecord(fields, body) {
  return `---\nrecordSchema: 1\nsupersedes: []\n${fields.join('\n')}\n---\n# ${body}\n`;
}

export function runW2Cases({ work, check, run, git, commit, write, generated, rehashAuthorityChain }) {
  const manifestFile = (repo) => join(repo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const writeManifest = (repo, manifest) => write(repo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(manifest, null, 2)}\n`);
  const ledgerBytes = (repo) => readFileSync(generated(repo, 'curation.jsonl'));
  const intakePath = (repo) => join(repo, 'hub', '98 System', 'Records', 'intake.jsonl');
  const readIntakeLines = (repo) => (existsSync(intakePath(repo)) ? readJsonl(intakePath(repo)) : []);

  // Manifest v3 acceptance and the review-fix cases.
  const repo = join(work, 'w2-v3'); mkdirSync(repo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], repo);
  write(repo, 'hub/Standard.md', '---\nstandard-version: 5\n---\n# Standard\n');
  writeManifest(repo, v3Manifest());
  write(repo, 'records/one.md', '# Draft evidence\n');
  commit(repo, 'add evidence');
  write(repo, 'records/one.md', '# Final evidence\n');
  write(repo, 'records/frozen/data.json', '{"frozen":true}\n');
  commit(repo, 'revise evidence before freeze');
  writeFileSync(join(repo, '.git', 'info', 'exclude'), 'adoption-review.json\n');
  let result = run(['plan-adoption', '--root', repo, ...COLLECTION, '--out', 'adoption-review.json'], repo);
  const reviewFile = join(repo, 'adoption-review.json');
  const plan = result.status === 0 ? JSON.parse(readFileSync(reviewFile, 'utf8')) : { candidates: [] };
  for (const candidate of plan.candidates) {
    if (candidate.adoptionReadiness !== 'review-required') continue;
    candidate.disposition = 'freeze-current';
    candidate.rationale = 'The final reviewed bytes are the intended immutable baseline.';
  }
  writeFileSync(reviewFile, `${JSON.stringify(plan, null, 2)}\n`);
  result = run(['adopt', '--root', repo, ...COLLECTION, '--review', 'adoption-review.json'], repo);
  const adopted = result.status === 0 && plan.candidates.some((candidate) => candidate.adoptionReadiness === 'review-required');
  if (result.status === 0) commit(repo, 'adopt under manifest v3');
  const checked = run(['check', '--root', repo, ...COLLECTION], repo);
  check('w2: a v3 manifest with a reviewed collection adopts and passes check', adopted && checked.status === 0, `${result.output}\n${checked.output}`);

  const removedRepo = join(work, 'w2-v3-removed'); cpSync(repo, removedRepo, { recursive: true });
  writeManifest(removedRepo, v3Manifest({ legacyPaths: [{ path: 'old/gone', disposition: 'removed' }] }));
  commit(removedRepo, 'record a removed legacy root');
  result = run(['check', '--root', removedRepo, ...COLLECTION], removedRepo);
  check('w2: a v3 removed legacy entry without a target loads', result.status === 0, result.output);
  const removedV2 = v3Manifest({ version: 2, runs: { tracking: 'ignored' }, legacyPaths: [{ path: 'old/gone', disposition: 'removed' }] });
  writeManifest(removedRepo, removedV2);
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], removedRepo);
  result = run(['check', '--root', removedRepo, ...COLLECTION], removedRepo);
  check('w2: a v2 legacy entry without a target still fails closed', result.status === 1
    && result.output.includes('legacy path overlaps'), result.output);
  writeManifest(removedRepo, v3Manifest({ version: 4 }));
  git(['add', 'hub/98 System/DOCS_MANIFEST.json'], removedRepo);
  result = run(['check', '--root', removedRepo, ...COLLECTION], removedRepo);
  check('w2: an unknown manifest version fails closed', result.status === 1 && result.output.includes('manifest v2 or v3'), result.output);

  // Native admission on the base head carries the meaning object.
  const d1 = nativeRecord(['kind: decision', 'title: Record format', 'topic: records', 'key: records/format',
    'decides: Each record is one Markdown file.'], 'D1');
  write(repo, 'records/d1.md', d1);
  git(['add', 'records/d1.md'], repo);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/d1.md'], repo);
  const d1Id = recordId(UUID, 'records/d1.md');
  if (result.status === 0) {
    commit(repo, 'append d1');
    write(repo, 'records/s1.md', nativeRecord(['kind: summary', 'title: Quarter summary', 'topic: records'], 'S1'));
    git(['add', 'records/s1.md'], repo);
    result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/s1.md'], repo);
    if (result.status === 0) commit(repo, 'append s1');
  }
  const inventory = JSON.parse(readFileSync(generated(repo, 'inventory.json'), 'utf8'));
  check('w2: native append on the base head stores the meaning object', result.status === 0
    && inventory.entries.find((entry) => entry.id === d1Id)?.meaning?.key === 'records/format', result.output);
  result = run(['curate', '--root', repo, ...COLLECTION, '--record', d1Id, '--state', '{"status":"reviewed"}'], repo);
  check('w2: v3 curation enforces the closed status set', result.status === 1 && result.output.includes('curation status must be one of'), result.output);

  // A branch routes curation and a new record to intake. The ledger does not move.
  git(['checkout', '--quiet', '-b', 'feat'], repo);
  write(repo, 'notes/feat.txt', 'branch work\n');
  commit(repo, 'branch work off the base head');
  const ledgerBefore = ledgerBytes(repo);
  result = run(['curate', '--root', repo, ...COLLECTION, '--record', d1Id, '--state', '{"status":"amended"}', ...AT], repo);
  check('w2: curate off the base head routes to intake and leaves the chain unchanged', result.status === 0
    && result.output.includes('"routed":"intake"') && ledgerBefore.equals(ledgerBytes(repo)) && readIntakeLines(repo).length === 1, result.output);
  const d2Intake = 'hub/98 System/Records/intake/evidence/d2.md';
  write(repo, d2Intake, nativeRecord([`amends: ["${d1Id}"]`, 'kind: amendment', 'title: Record format amendment',
    'topic: records', 'key: records/format', 'decides: Records also carry frontmatter.'], 'D2'));
  git(['add', d2Intake], repo);
  result = run(['intake', '--root', repo, ...COLLECTION, '--record', d2Intake, ...AT], repo);
  const d2Line = readIntakeLines(repo).find((line) => line.type === 'record');
  check('w2: intake records a staged body with its future record id', result.status === 0
    && d2Line?.recordId === recordId(UUID, 'records/d2.md') && ledgerBefore.equals(ledgerBytes(repo)), result.output);
  commit(repo, 'branch intake');

  result = run(['render', '--register', '--root', repo, ...COLLECTION], repo);
  const registerFile = join(repo, 'hub', '20 Decisions', 'REGISTER.md');
  const register = existsSync(registerFile) ? readFileSync(registerFile, 'utf8') : '';
  check('w2: the register groups decisions by topic and marks pending seals', result.status === 0
    && register.includes('## records') && register.includes('## Summaries')
    && register.includes(`${d1Id} (pending seal INT-`) && register.includes(`${d2Line?.intakeId} (pending seal)`)
    && register.indexOf('## records') < register.indexOf('## Summaries'), `${result.output}\n${register}`);
  git(['clean', '--quiet', '-fd', '--', 'hub/20 Decisions', 'hub/98 System/Records/state.json'], repo);

  // A seal on a fresh branch at the base head admits the body and applies the curation.
  git(['checkout', '--quiet', 'main'], repo);
  git(['merge', '--quiet', '--ff-only', 'feat'], repo);
  const preSeal = join(work, 'w2-pre-seal'); cpSync(repo, preSeal, { recursive: true });
  git(['checkout', '--quiet', '-b', 'seal-1'], repo);
  result = run(['seal', '--root', repo, ...COLLECTION, '--base', 'main', ...AT], repo);
  let sealedInventory = null;
  if (result.status === 0) {
    commit(repo, 'seal intake');
    sealedInventory = JSON.parse(readFileSync(generated(repo, 'inventory.json'), 'utf8'));
  }
  const sealedEvents = readJsonl(generated(repo, 'curation.jsonl'));
  const sealCheck = run(['check', '--root', repo, ...COLLECTION], repo);
  check('w2: seal admits intake bodies, appends typed curate events, and clears intake', result.status === 0
    && sealCheck.status === 0 && existsSync(join(repo, 'records', 'd2.md')) && !existsSync(intakePath(repo))
    && sealedInventory?.entries.some((entry) => entry.path === 'records/d2.md' && entry.amends?.[0] === d1Id)
    && sealedEvents.at(-1)?.type === 'curate' && sealedEvents.at(-1)?.state?.status === 'amended', `${result.output}\n${sealCheck.output}`);

  // Two branches curate the same record from the same basis. The seal names both lines.
  const staleRepo = join(work, 'w2-stale'); cpSync(repo, staleRepo, { recursive: true });
  git(['checkout', '--quiet', 'main'], staleRepo);
  git(['merge', '--quiet', '--ff-only', 'seal-1'], staleRepo);
  git(['checkout', '--quiet', '-b', 'left'], staleRepo);
  write(staleRepo, 'notes/left.txt', 'left\n');
  commit(staleRepo, 'left branch work');
  run(['curate', '--root', staleRepo, ...COLLECTION, '--record', d1Id, '--state', '{"status":"superseded"}', ...AT], staleRepo);
  const leftLine = readIntakeLines(staleRepo)[0];
  git(['reset', '--quiet', '--hard', 'main'], staleRepo);
  write(staleRepo, 'notes/right.txt', 'right\n');
  commit(staleRepo, 'right branch work');
  run(['curate', '--root', staleRepo, ...COLLECTION, '--record', d1Id, '--state', '{"status":"historical"}', ...AT], staleRepo);
  const rightLine = readIntakeLines(staleRepo)[0];
  git(['checkout', '--quiet', 'main'], staleRepo);
  write(staleRepo, 'hub/98 System/Records/intake.jsonl', `${JSON.stringify(leftLine)}\n${JSON.stringify(rightLine)}\n`);
  commit(staleRepo, 'union of two branch intakes');
  git(['checkout', '--quiet', '-b', 'seal-2'], staleRepo);
  const staleLedger = ledgerBytes(staleRepo);
  result = run(['seal', '--root', staleRepo, ...COLLECTION, '--base', 'main', ...AT], staleRepo);
  check('w2: seal refuses a stale basis and names both intake lines', result.status === 1 && Boolean(leftLine && rightLine)
    && result.output.includes(`intake line ${rightLine?.intakeId} basis`) && result.output.includes(`intake line ${leftLine?.intakeId} moved it`)
    && staleLedger.equals(ledgerBytes(staleRepo)), result.output);

  // A second seal cut from the pre-seal base cannot land on top of the first.
  git(['checkout', '--quiet', '-b', 'seal-late'], preSeal);
  result = run(['seal', '--root', preSeal, ...COLLECTION, '--base', 'main', ...AT], preSeal);
  let lateBinding = { status: 1, output: result.output };
  if (result.status === 0 && sealedInventory) {
    const late = JSON.parse(readFileSync(generated(preSeal, 'inventory.json'), 'utf8'));
    const lateBatch = structuredClone(late.authorityBatches.at(-1));
    const forged = structuredClone(sealedInventory);
    const lateRecord = 'records/d3.md';
    const lateEntry = structuredClone(late.entries.find((entry) => entry.path === 'records/d2.md'));
    write(repo, lateRecord, readFileSync(join(preSeal, 'records', 'd2.md')));
    lateEntry.path = lateRecord; lateEntry.id = recordId(UUID, lateRecord);
    forged.entries.push(lateEntry);
    lateBatch.sequence = forged.authorityBatches.length + 1;
    lateBatch.objects = [{ type: 'record', path: lateRecord, objectDigest: '' }];
    forged.authorityBatches.push(lateBatch);
    const preservedBindings = structuredClone(lateBatch.baseBindings);
    rehashAuthorityChain(forged);
    forged.authorityBatches.at(-1).baseBindings = { ...preservedBindings, authorityBatchHead: forged.authorityBatches.at(-2).batchDigest };
    rehashAuthorityChain(forged);
    writeFileSync(generated(repo, 'inventory.json'), `${JSON.stringify(forged, null, 2)}\n`);
    commit(repo, 'land a stale second seal');
    lateBinding = run(['check', '--root', repo, ...COLLECTION], repo);
    git(['reset', '--quiet', '--hard', 'HEAD~1'], repo);
  }
  check('w2: a second seal from a stale base fails its base bindings', lateBinding.status === 1
    && lateBinding.output.includes('base bindings do not match'), lateBinding.output);

  // relocate-root moves the whole collection. Identity paths and ids survive the move.
  const moveRepo = join(work, 'w2-move'); cpSync(repo, moveRepo, { recursive: true });
  const moveManifest = JSON.parse(readFileSync(manifestFile(moveRepo), 'utf8'));
  moveManifest.recordCollections[0].root = 'archive/records';
  const movedInventoryBefore = readFileSync(generated(moveRepo, 'inventory.json'));
  const badMoveRepo = join(work, 'w2-move-bad'); cpSync(moveRepo, badMoveRepo, { recursive: true });
  for (const target of [moveRepo, badMoveRepo]) {
    mkdirSync(join(target, 'archive'), { recursive: true });
    git(['mv', 'records', 'archive/records'], target);
    writeManifest(target, moveManifest);
    git(['add', 'hub/98 System/DOCS_MANIFEST.json'], target);
  }
  result = run(['relocate-root', '--root', moveRepo, ...COLLECTION, '--from', 'records', ...AT], moveRepo);
  if (result.status === 0) commit(moveRepo, 'relocate the collection root');
  const moveCheck = run(['check', '--root', moveRepo, ...COLLECTION], moveRepo);
  const moveHistory = run(['verify-history', '--strict', '--root', moveRepo, ...COLLECTION], moveRepo);
  check('w2: relocate-root keeps record ids and passes check with reviewed adoption records', result.status === 0
    && moveCheck.status === 0 && movedInventoryBefore.equals(readFileSync(generated(moveRepo, 'inventory.json'))), `${result.output}\n${moveCheck.output}`);
  check('w2: strict history verification passes after relocation', moveHistory.status === 0, moveHistory.output);

  result = run(['render', '--register', '--root', moveRepo, ...COLLECTION], moveRepo);
  const movedState = existsSync(join(moveRepo, 'hub', '98 System', 'Records', 'state.json'))
    ? JSON.parse(readFileSync(join(moveRepo, 'hub', '98 System', 'Records', 'state.json'), 'utf8')) : { records: [] };
  const movedD1 = movedState.records.find((record) => record.id === d1Id);
  check('w2: a relocate-root event does not overwrite the folded status', result.status === 0
    && readJsonl(generated(moveRepo, 'curation.jsonl')).at(-1)?.type === 'relocate-root'
    && movedD1?.status === 'amended' && movedD1?.path === 'archive/records/d1.md', result.output);

  write(badMoveRepo, 'archive/records/d1.md', `${d1}\nedited after the move\n`);
  git(['add', 'archive/records/d1.md'], badMoveRepo);
  const badLedger = ledgerBytes(badMoveRepo);
  result = run(['relocate-root', '--root', badMoveRepo, ...COLLECTION, '--from', 'records', ...AT], badMoveRepo);
  check('w2: relocate-root is rejected when record bytes differ', result.status === 1
    && result.output.includes('bytes differ at archive/records/d1.md') && badLedger.equals(ledgerBytes(badMoveRepo)), result.output);

  // FORWARDING.json schema.
  const forwarding = { version: 1, forwards: [{ from: 'docs/old', to: 'hub/new', movedAt: '2026-09-28', reason: 'vault move' }] };
  check('w2: FORWARDING.json accepts a valid document and resolves a prefix', forwardingErrors(forwarding).length === 0
    && forwardPath(forwarding, 'docs/old/a.md') === 'hub/new/a.md' && forwardPath(forwarding, 'docs/other.md') === null);
  const badForwarding = { version: 2, forwards: [{ from: '../x', to: 'y', movedAt: '2026-09-28', reason: 'r' }, { from: 'a', to: 'b' }] };
  check('w2: FORWARDING.json rejects a wrong version, unsafe paths, and missing keys', forwardingErrors(badForwarding).length === 3);
  let cycle = '';
  try {
    forwardPath({ version: 1, forwards: [{ from: 'a', to: 'b', movedAt: 'x', reason: 'r' }, { from: 'b', to: 'a', movedAt: 'x', reason: 'r' }] }, 'a/f');
  } catch (error) { cycle = error.message; }
  check('w2: FORWARDING.json cycles fail closed', cycle.includes('cycle'), cycle);
}
