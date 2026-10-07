// Shared fixture helpers for the record-collections eval sections. Each section runs in its own
// child process, so the module state below (counters, temp directories) is private to one section.
import { execFileSync as execFile, spawnSync as spawnChild } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { citationAuthority, digestJson, indexSemantic, jsonl, sha256 } from '../../scripts/record-lib.mjs';

export const ROOT = process.cwd();
export const SCRIPT = join(ROOT, 'scripts', 'records.mjs');
export const UUID = '11111111-1111-4111-8111-111111111111';
export const COLLECTION = ['--collection', 'evidence'];
export const GENERATED_NAMES = ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'];
let executedCases = 0;
let spawnCount = 0;
const failures = [];

// A seal posts change-feed events under CODE_OPS_HOME. Every child inherits this temp home, so
// the eval never writes into the operator's real store.
const FEED_HOME = mkdtempSync(join(tmpdir(), 'records-home-'));
process.env.CODE_OPS_HOME = FEED_HOME;
export const work = mkdtempSync(join(tmpdir(), 'code-ops-records-'));
process.on('exit', () => { rmSync(FEED_HOME, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });

export const counts = () => ({ cases: executedCases, spawns: spawnCount, failures: [...failures] });

// Every child this file starts goes through these two wrappers, so the closing line reports the
// spawn count that dominates the Windows leg. Grandchildren (records.mjs calling git) are not counted.
export function execFileSync(...args) { spawnCount += 1; return execFile(...args); }
export function spawnSync(...args) { spawnCount += 1; return spawnChild(...args); }
export function check(name, condition, detail = '') {
  executedCases += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) { failures.push(`${name}: ${detail}`); if (detail) console.log(detail); }
}
export function run(args, cwd) {
  return runWithScript(SCRIPT, args, cwd);
}
export function runWithScript(script, args, cwd, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env },
    });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status ?? 1, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
}
export function runWithScriptCaptured(script, args, cwd, env = {}) {
  const child = spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env },
  });
  return {
    status: child.status ?? 1,
    output: `${child.stdout || ''}${child.stderr || ''}${child.error ? `\n${child.error.message}` : ''}`,
  };
}
export function git(args, cwd, binary = false) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd, encoding: binary ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}
export function configuredGit(args, cwd, binary = false) {
  return execFileSync('git', args, {
    cwd, encoding: binary ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}
export function commit(repo, message) {
  git(['add', '-A'], repo);
  git(['-c', 'gc.auto=0', '-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', message], repo);
}
export function squashCurrentTree(repo, message) {
  const tree = git(['rev-parse', 'HEAD^{tree}'], repo).trim();
  const head = git([
    '-c', 'user.email=eval@example.com', '-c', 'user.name=Eval',
    'commit-tree', tree, '-m', message,
  ], repo).trim();
  git(['reset', '--hard', head], repo);
}
export function write(repo, path, text) {
  const target = join(repo, ...path.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, text);
}
export function instrumentedRecordsScript(name, transform) {
  const directory = join(work, name); mkdirSync(directory, { recursive: true });
  const source = readFileSync(SCRIPT, 'utf8'); const instrumented = transform(source);
  if (instrumented === source) throw new Error(`instrumentation anchor was not found for ${name}`);
  const script = join(directory, 'records.mjs'); writeFileSync(script, instrumented);
  cpSync(join(ROOT, 'scripts', 'record-lib.mjs'), join(directory, 'record-lib.mjs'));
  cpSync(join(ROOT, 'scripts', 'context-index-lib.mjs'), join(directory, 'context-index-lib.mjs'));
  return script;
}
export function fixtureManifest() {
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
export function generated(repo, name) { return join(repo, 'hub', '98 System', 'Records', name); }
export function generatedSnapshot(repo) {
  return new Map(GENERATED_NAMES.map((name) => [name, readFileSync(generated(repo, name))]));
}
export function generatedMatches(repo, snapshot) {
  return GENERATED_NAMES.every((name) => snapshot.get(name).equals(readFileSync(generated(repo, name))));
}
export function authorityRefDigest(refs) {
  return digestJson([...refs].sort((left, right) => {
    const leftKey = `${left.type}:${left.path}`; const rightKey = `${right.type}:${right.path}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  }));
}
export function inventoryAuthorityRefs(inventory) {
  return [
    ...(inventory.entries || []).map((entry) => ({ type: 'record', path: entry.path, objectDigest: digestJson(entry) })),
    ...(inventory.artifacts || []).map((artifact) => ({ type: 'artifact', path: artifact.path, objectDigest: digestJson(artifact) })),
  ].sort((left, right) => {
    const leftKey = `${left.type}:${left.path}`; const rightKey = `${right.type}:${right.path}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}
export function fixtureGeneratedBindings(inventory, citations, events) {
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
export function rehashAuthorityBatch(batch) {
  const { batchDigest: _batchDigest, ...authority } = batch;
  batch.batchDigest = digestJson(authority);
}
export function rehashAuthorityChain(inventory) {
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
export function moveAuthorityRef(inventory, fromBatch, toBatch, predicate) {
  const index = fromBatch.objects.findIndex(predicate);
  if (index < 0) throw new Error('authority forgery fixture could not find the requested object');
  toBatch.objects.push(fromBatch.objects.splice(index, 1)[0]);
  rehashAuthorityChain(inventory);
}
export function restoreFromHead(repo, path) { write(repo, path, git(['show', `HEAD:${path}`], repo)); }

// The fixture every section starts from: the seed repository, with and without adoption.
export function seedFixture(name = 'fixture') {
  const repo = join(work, name);
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
  return repo;
}
export function adoptedFixture(name = 'fixture') {
  const repo = seedFixture(name);
  const adopted = run(['adopt', '--root', repo, ...COLLECTION], repo);
  if (adopted.status !== 0) throw new Error(`fixture adoption failed: ${adopted.output}`);
  commit(repo, 'adopt records');
  return repo;
}

// records.mjs with a hook that corrupts the first generated write, for the rollback cases.
export function makeCorruptPostWriteScript() {
  return instrumentedRecordsScript('generated-post-write-script', (source) => source.replace(
    /(    writeAtomically\(writes\);\r?\n    wrote = true;\r?\n)(    verify\(\);)/,
    `$1    if (process.env.CODE_OPS_EVAL_CORRUPT_WRITE === '1') writeFileSync(writes[0][0], '{"corrupt":true}\\n');\n$2`,
  ));
}
