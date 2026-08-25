#!/usr/bin/env node
// Regression coverage for generic manifest discovery, interior globs, and installed extraction.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const work = mkdtempSync(join(tmpdir(), 'coh-docs-manifest-'));
const failures = [];
const check = (name, pass, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); if (!pass) failures.push(`${name}: ${detail}`); };
const run = (script, args, cwd) => {
  try { return { status: 0, out: execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' }) }; }
  catch (error) { return { status: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` }; }
};
const git = (args, cwd) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
try {
  const repo = join(work, 'fixture');
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  mkdirSync(join(repo, 'plugins', 'alpha', 'skills', 'sample'), { recursive: true });
  mkdirSync(join(repo, 'project-docs', '98 System'), { recursive: true });
  mkdirSync(join(repo, 'project-docs', '40 Engineering'), { recursive: true });
  mkdirSync(join(repo, 'evidence'), { recursive: true });
  for (const file of ['docs-manifest.mjs', 'docs-extract.mjs', 'context-index-lib.mjs']) {
    cpSync(join(ROOT, 'scripts', file), join(repo, 'scripts', file));
  }
  writeFileSync(join(repo, 'plugins', 'alpha', 'skills', 'sample', 'SKILL.md'), '# Sample\n');
  const required = ['architecture', 'contracts', 'data-model', 'engineering-standards', 'api-reference', 'ci-delivery', 'infrastructure', 'observability', 'design-system', 'guides', 'atlas'];
  for (const id of required) writeFileSync(join(repo, 'project-docs', '40 Engineering', `${id}.md`), `# ${id}\n`);
  writeFileSync(join(repo, 'evidence', 'one.md'), '# Evidence\n');
  const manifestPath = join(repo, 'project-docs', '98 System', 'DOCS_MANIFEST.json');
  writeFileSync(manifestPath, `${JSON.stringify({
    version: 1,
    hub: 'project-docs',
    domains: required.map((id) => ({
      id, path: `40 Engineering/${id}.md`, status: 'current',
      sources: id === 'api-reference' ? ['plugins/*/skills/**'] : ['scripts/**'], sourceDigest: '', contentDigest: '',
    })),
  }, null, 2)}\n`);
  git(['init', '--quiet', '-b', 'main'], repo);
  git(['add', '-A'], repo);
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'seed'], repo);

  let result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['sync', '--root', repo], repo);
  check('non-code-ops hub syncs', result.status === 0, result.out);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('non-code-ops hub validates', result.status === 0, result.out);

  const completeManifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const standardPath = join(repo, 'project-docs', 'Standard.md');
  writeFileSync(standardPath, '---\nstandard-version: 4\n---\n\n# Standard\n');
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('manifest v1 remains valid under vault standard v4', result.status === 0, result.out);

  const versionTwo = { version: 2, hub: completeManifest.hub, runs: { tracking: 'ignored' }, recordCollections: [], legacyPaths: [], domains: completeManifest.domains };
  const validCollection = (id = 'evidence', uuid = '11111111-1111-4111-8111-111111111111', root = 'evidence', suffix = id) => ({
    id, collectionUuid: uuid, identityVersion: 1, root,
    inventory: `98 System/Records/${suffix}/inventory.json`, citations: `98 System/Records/${suffix}/citations.json`,
    curationLedger: `98 System/Records/${suffix}/curation.jsonl`, index: `98 System/Records/${suffix}/index.md`,
    scopes: [{ pattern: '**/*.md', kind: 'record', policy: 'append-only' }],
  });
  const expectV2Error = (name, mutate, fragment) => {
    const candidate = structuredClone(versionTwo);
    candidate.recordCollections = [validCollection()];
    mutate(candidate);
    writeFileSync(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`);
    const probe = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
    check(name, probe.status === 1 && probe.out.includes(fragment), probe.out);
  };
  writeFileSync(standardPath, '---\nstandard-version: 3\n---\n\n# Standard\n');
  writeFileSync(manifestPath, `${JSON.stringify(versionTwo, null, 2)}\n`);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('manifest v2 fails under vault standard v3', result.status === 1 && result.out.includes('requires Standard.md standard-version 4'), result.out);
  writeFileSync(standardPath, '---\nstandard-version: 4\n---\n\n# Standard\n');
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('manifest v2 is valid under vault standard v4 without records', result.status === 0, result.out);
  const invalidRuns = structuredClone(versionTwo); invalidRuns.runs.tracking = 'sometimes';
  writeFileSync(manifestPath, `${JSON.stringify(invalidRuns, null, 2)}\n`);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('manifest v2 run tracking is explicit and closed', result.status === 1 && result.out.includes('runs.tracking must be tracked or ignored'), result.out);
  const validationCases = [
    ['recordCollections must be an array', (m) => { m.recordCollections = {}; }, 'recordCollections must be an array'],
    ['legacyPaths must be an array', (m) => { m.legacyPaths = {}; }, 'legacyPaths must be an array'],
    ['record collections are objects', (m) => { m.recordCollections = [null]; }, 'record collection <unknown> must be an object'],
    ['collection keys are closed', (m) => { m.recordCollections[0].extra = true; }, 'has unknown key extra'],
    ['collection keys are complete', (m) => { delete m.recordCollections[0].index; }, 'is missing index'],
    ['collection ids use the stable slug form', (m) => { m.recordCollections[0].id = 'Bad ID'; }, 'invalid or duplicate record collection id'],
    ['collection ids are unique', (m) => { m.recordCollections.push(validCollection('evidence', '22222222-2222-4222-8222-222222222222', 'other', 'other')); }, 'invalid or duplicate record collection id'],
    ['collection UUIDs are valid', (m) => { m.recordCollections[0].collectionUuid = 'not-a-uuid'; }, 'invalid or duplicate collectionUuid'],
    ['collection UUIDs are unique', (m) => { m.recordCollections.push(validCollection('other', m.recordCollections[0].collectionUuid, 'other', 'other')); }, 'invalid or duplicate collectionUuid'],
    ['identity versions are explicit', (m) => { m.recordCollections[0].identityVersion = 2; }, 'identityVersion must be 1'],
    ['collection roots are repository relative', (m) => { m.recordCollections[0].root = '../evidence'; }, 'root must be a safe repository-relative path'],
    ['collection roots cannot overlap', (m) => { m.recordCollections.push(validCollection('other', '22222222-2222-4222-8222-222222222222', 'evidence/nested', 'other')); }, 'root overlaps another record collection'],
    ['collection root casing follows the Git index', (m) => { m.recordCollections[0].root = 'EVIDENCE'; }, 'root casing differs from Git index'],
    ['collections require total scopes', (m) => { m.recordCollections[0].scopes = []; }, 'needs scopes'],
    ['scope keys are closed', (m) => { m.recordCollections[0].scopes[0].extra = true; }, 'scope 1 has unknown key extra'],
    ['scope keys are complete', (m) => { delete m.recordCollections[0].scopes[0].policy; }, 'scope 1 is missing policy'],
    ['scope patterns are safe', (m) => { m.recordCollections[0].scopes[0].pattern = '/**/*.md'; }, 'scope 1 has an invalid pattern'],
    ['scope kind and policy pairs are closed', (m) => { m.recordCollections[0].scopes[0].policy = 'mutable'; }, 'scope 1 has an invalid kind/policy pair'],
    ['generated record paths cannot be reused', (m) => { m.recordCollections.push(validCollection('other', '22222222-2222-4222-8222-222222222222', 'other', 'evidence')); }, 'reuses generated record path'],
    ['legacy path keys are closed', (m) => { m.legacyPaths = [{ path: 'docs/old.md', disposition: 'pointer', target: 'project-docs/Standard.md', requiredBy: [{ kind: 'commit', ref: 'abc' }], extra: true }]; }, 'legacy path 1 has unknown key extra'],
    ['legacy paths are unique', (m) => { const e = { path: 'docs/old.md', disposition: 'pointer', target: 'project-docs/Standard.md', requiredBy: [{ kind: 'commit', ref: 'abc' }] }; m.legacyPaths = [e, structuredClone(e)]; }, 'invalid or duplicate path'],
    ['legacy dispositions are closed', (m) => { m.legacyPaths = [{ path: 'docs/old.md', disposition: 'move', target: 'project-docs/Standard.md', requiredBy: [{ kind: 'commit', ref: 'abc' }] }]; }, 'invalid disposition'],
    ['legacy paths cannot overlap records', (m) => { m.legacyPaths = [{ path: 'evidence/old.md', disposition: 'pointer', target: 'project-docs/Standard.md', requiredBy: [{ kind: 'commit', ref: 'abc' }] }]; }, 'overlaps an immutable record root'],
    ['legacy paths cannot overlap generated metadata', (m) => { m.legacyPaths = [{ path: `${m.hub}/${m.recordCollections[0].index}`, disposition: 'pointer', target: 'project-docs/Standard.md', requiredBy: [{ kind: 'commit', ref: 'abc' }] }]; }, 'overlaps generated record metadata'],
    ['legacy targets stay in the hub', (m) => { m.legacyPaths = [{ path: 'docs/old.md', disposition: 'pointer', target: 'README.md', requiredBy: [{ kind: 'commit', ref: 'abc' }] }]; }, 'target must be inside the documentation hub'],
    ['legacy evidence has a strict schema', (m) => { m.legacyPaths = [{ path: 'docs/old.md', disposition: 'pointer', target: 'project-docs/Standard.md', requiredBy: [{ kind: 'guess', ref: 'abc' }] }]; }, 'needs qualifying requiredBy evidence'],
    ['record-backed legacy evidence uses a record ID prefix', (m) => { m.legacyPaths = [{ path: 'docs/old.md', disposition: 'pointer', target: 'project-docs/Standard.md', requiredBy: [{ kind: 'record', ref: 'missing' }] }]; }, 'record evidence must use a record ID prefix'],
  ];
  for (const [name, mutate, fragment] of validationCases) expectV2Error(name, mutate, fragment);
  const unverifiedLegacy = structuredClone(versionTwo);
  unverifiedLegacy.legacyPaths = [{ path: 'docs/old.md', disposition: 'pointer', target: 'project-docs/Standard.md', requiredBy: [{ kind: 'external', ref: 'missing.txt' }] }];
  writeFileSync(manifestPath, `${JSON.stringify(unverifiedLegacy, null, 2)}\n`);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('legacy exemptions require a collection-backed CI verifier', result.status === 1
    && result.out.includes('legacyPaths require a record collection'), result.out);
  writeFileSync(manifestPath, `${JSON.stringify(versionTwo, null, 2)}\n`);
  const overlappingRecords = structuredClone(versionTwo);
  overlappingRecords.recordCollections = [{
    id: 'evidence', collectionUuid: '11111111-1111-4111-8111-111111111111', identityVersion: 1,
    root: 'PROJECT-DOCS', inventory: '98 System/Records/inventory.json', citations: '98 System/Records/citations.json',
    curationLedger: '98 System/Records/curation.jsonl', index: '98 System/Records/index.md',
    scopes: [{ pattern: '**/*.md', kind: 'record', policy: 'append-only' }],
  }];
  writeFileSync(manifestPath, `${JSON.stringify(overlappingRecords, null, 2)}\n`);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('generated record metadata cannot case-fold into its immutable root', result.status === 1 && result.out.includes('overlaps its immutable root'), result.out);
  const outsideRecords = structuredClone(versionTwo);
  outsideRecords.recordCollections = [{
    id: 'evidence', collectionUuid: '11111111-1111-4111-8111-111111111111', identityVersion: 1,
    root: 'docs/evidence', inventory: '98 System/Elsewhere/inventory.json', citations: '98 System/Records/citations.json',
    curationLedger: '98 System/Records/curation.jsonl', index: '98 System/Records/index.md', scopes: [{ pattern: '**/*.md', kind: 'record', policy: 'append-only' }],
  }];
  writeFileSync(manifestPath, `${JSON.stringify(outsideRecords, null, 2)}\n`);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('generated record paths stay inside the reserved Records directory', result.status === 1 && result.out.includes('must be inside 98 System/Records/'), result.out);
  const extractionManifest = structuredClone(versionTwo);
  extractionManifest.recordCollections = [validCollection()];
  writeFileSync(manifestPath, `${JSON.stringify(extractionManifest, null, 2)}\n`);
  writeFileSync(join(repo, 'evidence', 'one.md'), '# Evidence\n\nchanged\n');
  const v2Output = join(repo, 'v2-plan.json');
  result = run(join(repo, 'scripts', 'docs-extract.mjs'), ['plan', '--root', repo, '--out', v2Output], repo);
  const v2Receipt = result.status === 0 ? JSON.parse(readFileSync(v2Output, 'utf8')) : null;
  check('manifest v2 extraction carries bounded record context', result.status === 0 && v2Receipt?.version === 2
    && v2Receipt.records?.length === 1
    && v2Receipt.records[0].affectedSources?.includes('evidence/one.md'), result.out);
  writeFileSync(manifestPath, `${JSON.stringify(completeManifest, null, 2)}\n`);

  writeFileSync(manifestPath, `${JSON.stringify({ ...completeManifest, profile: 'generic', domains: completeManifest.domains.filter((domain) => domain.id !== 'architecture') }, null, 2)}\n`);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('profile flag cannot bypass required domains', result.status === 1 && result.out.includes('unknown key profile') && result.out.includes('missing required documentation domain architecture'), result.out);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['plan', '--root', repo], repo);
  check('plan fails closed on structural manifest errors', result.status === 1 && result.out.includes('unknown key profile') && result.out.includes('missing required documentation domain architecture'), result.out);

  const vacuousManifest = structuredClone(completeManifest);
  vacuousManifest.domains.find((domain) => domain.id === 'architecture').sources = ['missing-sources/**'];
  writeFileSync(manifestPath, `${JSON.stringify(vacuousManifest, null, 2)}\n`);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['sync', '--root', repo], repo);
  check('sync rejects source patterns that match no repository files', result.status === 1 && result.out.includes('architecture source patterns match no repository files'), result.out);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('check rejects source patterns that match no repository files', result.status === 1 && result.out.includes('architecture source patterns match no repository files'), result.out);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['plan', '--root', repo], repo);
  check('plan rejects source patterns that match no repository files', result.status === 1 && result.out.includes('architecture source patterns match no repository files'), result.out);
  writeFileSync(manifestPath, `${JSON.stringify(completeManifest, null, 2)}\n`);

  writeFileSync(join(repo, 'plugins', 'alpha', 'skills', 'sample', 'SKILL.md'), '# Sample\nchanged\n');
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['plan', '--root', repo], repo);
  const plan = result.status === 0 ? JSON.parse(result.out) : null;
  const api = plan?.domains.find((domain) => domain.id === 'api-reference');
  check('interior wildcard matches skill source', result.status === 0 && api?.affectedSources.includes('plugins/alpha/skills/sample/SKILL.md'), result.out);

  const output = join(repo, 'plan.json');
  result = run(join(repo, 'scripts', 'docs-extract.mjs'), ['plan', '--root', repo, '--out', output], repo);
  const receipt = result.status === 0 ? JSON.parse(readFileSync(output, 'utf8')) : null;
  check('installed extractor resolves sibling manifest script', result.status === 0 && receipt?.hub === 'project-docs' && receipt.tasks?.some((task) => task.target === 'project-docs/40 Engineering/api-reference.md'), result.out);
} finally { rmSync(work, { recursive: true, force: true }); }
if (failures.length) { console.error(`\n${failures.join('\n')}`); process.exit(1); }
console.log('\ndocs-manifest eval passed');
