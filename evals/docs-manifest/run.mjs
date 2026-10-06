#!/usr/bin/env node
// Regression coverage for generic manifest discovery, interior globs, and installed extraction.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { tally, withDetail } from '../harness.mjs';

const ROOT = process.cwd();
const work = mkdtempSync(join(tmpdir(), 'coh-docs-manifest-'));
const { fails: failures, check } = tally(withDetail);
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
  for (const file of ['docs-manifest.mjs', 'docs-extract.mjs', 'context-index-lib.mjs', 'record-lib.mjs']) {
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
    ['collection roots reject whitespace and dot segments', (m) => { m.recordCollections[0].root = 'evidence/ .'; }, 'root must be a safe repository-relative path'],
    ['collection roots cannot overlap', (m) => { m.recordCollections.push(validCollection('other', '22222222-2222-4222-8222-222222222222', 'evidence/nested', 'other')); }, 'root overlaps another record collection'],
    ['collection root casing follows the Git index', (m) => { m.recordCollections[0].root = 'EVIDENCE'; }, 'root casing differs from Git index'],
    ['collections require total scopes', (m) => { m.recordCollections[0].scopes = []; }, 'needs scopes'],
    ['scope keys are closed', (m) => { m.recordCollections[0].scopes[0].extra = true; }, 'scope 1 has unknown key extra'],
    ['scope keys are complete', (m) => { delete m.recordCollections[0].scopes[0].policy; }, 'scope 1 is missing policy'],
    ['scope patterns are safe', (m) => { m.recordCollections[0].scopes[0].pattern = '/**/*.md'; }, 'scope 1 has an invalid pattern'],
    ['scope kind and policy pairs are closed', (m) => { m.recordCollections[0].scopes[0].policy = 'mutable'; }, 'scope 1 has an invalid kind/policy pair'],
    ['scope kind and policy values cannot exploit string coercion', (m) => {
      m.recordCollections[0].scopes[0].kind = ['record'];
      m.recordCollections[0].scopes[0].policy = ['append-only'];
    }, 'scope 1 has an invalid kind/policy pair'],
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

  // Manifest v3 (vault standard v5). v2 stays valid unchanged, and v3 values need the v3 opt-in.
  const checkManifest = (candidate) => {
    writeFileSync(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`);
    return run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  };
  writeFileSync(standardPath, '---\nstandard-version: 5\n---\n\n# Standard\n');
  result = checkManifest(versionTwo);
  check('upgrade-without-conform-adds-no-failure: v2 manifest passes unchanged under standard v5', result.status === 0, result.out);
  const v2WithRecords = structuredClone(versionTwo); v2WithRecords.recordCollections = [validCollection()];
  result = checkManifest(v2WithRecords);
  check('v2 manifest with a record collection passes unchanged under standard v5', result.status === 0, result.out);
  for (const [name, mutate, fragment] of [
    ['v2 rejects the v3 closeout value', (m) => { m.runs.tracking = 'closeout'; }, 'runs.tracking must be tracked or ignored'],
    ['v2 rejects the v3 retain key', (m) => { m.runs.retain = []; }, 'runs has unknown key retain'],
    ['v2 rejects the v3 drafts block', (m) => { m.drafts = { maxAgeDays: 21, statuses: ['draft'] }; }, 'manifest has unknown key drafts'],
    ['v2 rejects the v3 state block', (m) => { m.state = {}; }, 'manifest has unknown key state'],
    ['v2 rejects the v3 relocated disposition', (m) => { m.legacyPaths = [{ path: 'docs/old', disposition: 'relocated', target: 'project-docs/40 Engineering', requiredBy: [{ kind: 'commit', ref: 'abc' }] }]; }, 'invalid disposition'],
    ['v2 rejects the v3 removed disposition', (m) => { m.legacyPaths = [{ path: 'docs/old', disposition: 'removed', requiredBy: [{ kind: 'commit', ref: 'abc' }] }]; }, 'invalid disposition'],
  ]) expectV2Error(name, mutate, fragment);
  const versionThree = {
    ...structuredClone(versionTwo), version: 3,
    runs: { tracking: 'closeout', retain: ['2026-09-11-migration/P4/**/RECEIPT*.md'] },
    drafts: { maxAgeDays: 21, statuses: ['draft', 'current', 'accepted', 'superseded'] },
    state: { '20 Decisions/REGISTER.md': { budgetWords: 3000 }, '10 Design/INDEX.md': { budgetWords: 3000 } },
  };
  versionThree.recordCollections = [validCollection()];
  result = checkManifest(versionThree);
  check('manifest v3 is valid under vault standard v5', result.status === 0, result.out);
  const digitSlug = structuredClone(versionThree); digitSlug.drafts.statuses = ['9-lives'];
  result = checkManifest(digitSlug);
  check('manifest v3 accepts a digit-led draft status slug', result.status === 0, result.out);
  for (const [tracking, label] of [['tracked', 'tracked'], ['ignored', 'ignored']]) {
    const plain = structuredClone(versionThree); plain.runs = { tracking, retain: [] }; plain.state = {};
    result = checkManifest(plain);
    check(`manifest v3 accepts ${label} runs with no retain globs and no state surfaces`, result.status === 0, result.out);
  }
  const relocatedEntry = { path: 'docs/old-root', disposition: 'relocated', target: 'project-docs/40 Engineering', requiredBy: [{ kind: 'commit', ref: 'abc' }] };
  const removedEntry = { path: 'docs/gone', disposition: 'removed', requiredBy: [{ kind: 'commit', ref: 'abc' }] };
  const withLegacy = structuredClone(versionThree); withLegacy.legacyPaths = [relocatedEntry, removedEntry];
  result = checkManifest(withLegacy);
  check('manifest v3 accepts relocated and removed legacy dispositions', result.status === 0, result.out);
  writeFileSync(standardPath, '---\nstandard-version: 4\n---\n\n# Standard\n');
  result = checkManifest(versionThree);
  check('manifest v3 fails under vault standard v4', result.status === 1 && result.out.includes('manifest version 3 requires Standard.md standard-version 5'), result.out);
  writeFileSync(standardPath, '---\nstandard-version: 5\n---\n\n# Standard\n');
  result = checkManifest({ ...structuredClone(versionThree), version: 4 });
  check('unknown manifest versions fail closed', result.status === 1 && result.out.includes('manifest must use version 1, 2, or 3'), result.out);
  const v3Cases = [
    ['v3 requires the drafts block', (m) => { delete m.drafts; }, 'manifest is missing drafts'],
    ['v3 requires the state block', (m) => { delete m.state; }, 'manifest is missing state'],
    ['v3 run tracking is closed', (m) => { m.runs.tracking = 'sometimes'; }, 'runs.tracking must be tracked, closeout, or ignored'],
    ['v3 runs keys are closed', (m) => { m.runs.extra = true; }, 'runs has unknown key extra'],
    ['v3 runs require retain', (m) => { delete m.runs.retain; }, 'runs is missing retain'],
    ['v3 retain is an array', (m) => { m.runs.retain = 'RECEIPT*.md'; }, 'runs.retain must be an array of unique safe run-relative globs'],
    ['v3 retain globs are safe', (m) => { m.runs.retain = ['../escape/**']; }, 'runs.retain must be an array of unique safe run-relative globs'],
    ['v3 retain globs are strings', (m) => { m.runs.retain = [7]; }, 'runs.retain must be an array of unique safe run-relative globs'],
    ['v3 retain globs are unique', (m) => { m.runs.retain = ['a/**', 'a/**']; }, 'runs.retain must be an array of unique safe run-relative globs'],
    ['v3 retain applies only under closeout', (m) => { m.runs.tracking = 'tracked'; }, 'runs.retain applies only when runs.tracking is closeout'],
    ['v3 drafts keys are closed', (m) => { m.drafts.extra = true; }, 'drafts has unknown key extra'],
    ['v3 drafts is an object', (m) => { m.drafts = []; }, 'drafts must be an object'],
    ['v3 drafts max age is positive', (m) => { m.drafts.maxAgeDays = 0; }, 'drafts.maxAgeDays must be a positive integer'],
    ['v3 drafts max age is an integer', (m) => { m.drafts.maxAgeDays = 1.5; }, 'drafts.maxAgeDays must be a positive integer'],
    ['v3 drafts max age is not a string', (m) => { m.drafts.maxAgeDays = '21'; }, 'drafts.maxAgeDays must be a positive integer'],
    ['v3 draft statuses are non-empty', (m) => { m.drafts.statuses = []; }, 'drafts.statuses must be a non-empty array of unique slug statuses'],
    ['v3 draft statuses are slugs', (m) => { m.drafts.statuses = ['Draft']; }, 'drafts.statuses must be a non-empty array of unique slug statuses'],
    // Same slugs as evals/vault-standard/run.mjs, which pins check-vault-standard.mjs to this rule.
    ['v3 draft statuses reject a trailing hyphen', (m) => { m.drafts.statuses = ['a-']; }, 'drafts.statuses must be a non-empty array of unique slug statuses'],
    ['v3 draft statuses reject a doubled hyphen', (m) => { m.drafts.statuses = ['a--b']; }, 'drafts.statuses must be a non-empty array of unique slug statuses'],
    ['v3 draft statuses are unique', (m) => { m.drafts.statuses = ['draft', 'draft']; }, 'drafts.statuses must be a non-empty array of unique slug statuses'],
    ['v3 state is an object', (m) => { m.state = []; }, 'state must be an object'],
    ['v3 state surfaces are safe', (m) => { m.state = { '../escape.md': { budgetWords: 10 } }; }, 'must be a unique hub-relative Markdown path'],
    ['v3 state surfaces are Markdown', (m) => { m.state = { '98 System/TRIAGE.txt': { budgetWords: 10 } }; }, 'must be a unique hub-relative Markdown path'],
    ['v3 state surfaces are not globs', (m) => { m.state = { '20 Decisions/*.md': { budgetWords: 10 } }; }, 'must be a unique hub-relative Markdown path'],
    ['v3 state surfaces are unique under case folding', (m) => { m.state = { 'Home.md': { budgetWords: 10 }, 'HOME.md': { budgetWords: 10 } }; }, 'must be a unique hub-relative Markdown path'],
    ['v3 state budget keys are closed', (m) => { m.state['10 Design/INDEX.md'].extra = 1; }, 'state surface 10 Design/INDEX.md has unknown key extra'],
    ['v3 state budget is required', (m) => { m.state['10 Design/INDEX.md'] = {}; }, 'state surface 10 Design/INDEX.md is missing budgetWords'],
    ['v3 state budget is positive', (m) => { m.state['10 Design/INDEX.md'].budgetWords = 0; }, 'budgetWords must be a positive integer'],
    ['v3 state budget is not a string', (m) => { m.state['10 Design/INDEX.md'].budgetWords = '3000'; }, 'budgetWords must be a positive integer'],
    ['v3 legacy dispositions stay closed', (m) => { m.legacyPaths = [{ ...relocatedEntry, disposition: 'move' }]; }, 'invalid disposition'],
    ['v3 relocated needs a target', (m) => { const entry = structuredClone(relocatedEntry); delete entry.target; m.legacyPaths = [entry]; }, 'legacy path 1 is missing target'],
    ['v3 relocated target stays in the hub', (m) => { m.legacyPaths = [{ ...relocatedEntry, target: 'evidence' }]; }, 'target must be inside the documentation hub'],
    ['v3 relocated target must exist', (m) => { m.legacyPaths = [{ ...relocatedEntry, target: 'project-docs/missing-root' }]; }, 'relocated target does not exist'],
    ['v3 relocated source must be gone', (m) => { m.legacyPaths = [{ ...relocatedEntry, path: 'scripts' }]; }, 'is relocated but still exists on disk'],
    ['v3 removed path must not exist', (m) => { m.legacyPaths = [{ ...removedEntry, path: 'scripts' }]; }, 'is removed but still exists on disk'],
    ['v3 removed carries no target', (m) => { m.legacyPaths = [{ ...removedEntry, target: 'project-docs/Standard.md' }]; }, 'legacy path 1 has unknown key target'],
    ['v3 removed keeps the evidence rule', (m) => { m.legacyPaths = [{ ...removedEntry, requiredBy: [] }]; }, 'needs qualifying requiredBy evidence'],
  ];
  for (const [name, mutate, fragment] of v3Cases) {
    const candidate = structuredClone(versionThree); mutate(candidate);
    const probe = checkManifest(candidate);
    check(name, probe.status === 1 && probe.out.includes(fragment), probe.out);
  }
  for (const [label, base] of [['v2', v2WithRecords], ['v3', versionThree]]) {
    const nullEntry = structuredClone(base); nullEntry.legacyPaths = [null];
    const probe = checkManifest(nullEntry);
    check(`${label} null legacy path entry is a validation error, not a crash`, probe.status === 1
      && probe.out.includes('legacy path 1 has an invalid or duplicate path') && !probe.out.includes('TypeError'), probe.out);
  }
  writeFileSync(join(repo, 'evidence', 'one.md'), '# Evidence\n\nv3 change\n');
  checkManifest(versionThree);
  const v3Output = join(repo, 'v3-plan.json');
  result = run(join(repo, 'scripts', 'docs-extract.mjs'), ['plan', '--root', repo, '--out', v3Output], repo);
  const v3Receipt = result.status === 0 ? JSON.parse(readFileSync(v3Output, 'utf8')) : null;
  check('manifest v3 extraction keeps bounded record context', result.status === 0 && v3Receipt?.version === 3
    && v3Receipt.records?.length === 1 && v3Receipt.records[0].affectedSources?.includes('evidence/one.md'), result.out);
  writeFileSync(join(repo, 'evidence', 'one.md'), '# Evidence\n');
  writeFileSync(standardPath, '---\nstandard-version: 4\n---\n\n# Standard\n');

  const validScopeV2 = validCollection();
  validScopeV2.classificationVersion = 2;
  validScopeV2.scopes = [
    { id: 'markdown-default', match: ['**/*.md'], paths: [], kind: 'record', policy: 'append-only' },
    { id: 'one-exact', match: [], paths: ['one.md'], kind: 'record', policy: 'append-only' },
  ];
  const scopeV2Manifest = structuredClone(versionTwo); scopeV2Manifest.recordCollections = [validScopeV2];
  writeFileSync(manifestPath, `${JSON.stringify(scopeV2Manifest, null, 2)}\n`);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('scope v2 accepts a broad glob with an exact tracked-path exception', result.status === 0, result.out);
  writeFileSync(join(repo, 'evidence', 'untracked.md'), '# Correctly cased untracked evidence\n');
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('correctly cased untracked collection files do not affect index classification', result.status === 0, result.out);
  rmSync(join(repo, 'evidence', 'untracked.md'), { force: true });
  const untrackedExactManifest = structuredClone(scopeV2Manifest);
  untrackedExactManifest.recordCollections[0].scopes[1].paths = ['untracked-exact.md'];
  writeFileSync(join(repo, 'evidence', 'untracked-exact.md'), '# Untracked exact selector\n');
  writeFileSync(manifestPath, `${JSON.stringify(untrackedExactManifest, null, 2)}\n`);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
  check('scope v2 exact selectors remain Git-index authoritative', result.status === 1
    && result.out.includes('exact path is not tracked'), result.out);
  rmSync(join(repo, 'evidence', 'untracked-exact.md'), { force: true });
  writeFileSync(manifestPath, `${JSON.stringify(scopeV2Manifest, null, 2)}\n`);
  if (process.platform !== 'win32') {
    mkdirSync(join(repo, 'EVIDENCE'), { recursive: true });
    writeFileSync(join(repo, 'EVIDENCE', 'untracked.md'), '# Mis-cased untracked evidence\n');
    result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
    check('untracked collection-root casing aliases remain fail-closed', result.status === 1
      && result.out.includes('root casing differs from Git index'), result.out);
    rmSync(join(repo, 'EVIDENCE'), { recursive: true, force: true });
  }
  const scopeV2Before = structuredClone(scopeV2Manifest.recordCollections[0]);
  result = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['sync', '--root', repo], repo);
  const scopeV2After = JSON.parse(readFileSync(manifestPath, 'utf8')).recordCollections[0];
  check('manifest sync preserves scope v2 policy byte-for-byte', result.status === 0
    && JSON.stringify(scopeV2After) === JSON.stringify(scopeV2Before), result.out);
  const expectScopeV2Error = (name, mutate, fragment) => {
    const candidate = structuredClone(scopeV2Manifest); mutate(candidate.recordCollections[0]);
    writeFileSync(manifestPath, `${JSON.stringify(candidate, null, 2)}\n`);
    const probe = run(join(repo, 'scripts', 'docs-manifest.mjs'), ['check', '--root', repo], repo);
    check(name, probe.status === 1 && probe.out.includes(fragment), probe.out);
  };
  expectScopeV2Error('classificationVersion is explicit when v2 is selected', (collection) => { collection.classificationVersion = 1; }, 'classificationVersion must be 2 when present');
  expectScopeV2Error('scope v2 ids are unique slugs', (collection) => { collection.scopes[1].id = collection.scopes[0].id; }, 'invalid or duplicate id');
  expectScopeV2Error('scope v2 selector arrays reject duplicates', (collection) => { collection.scopes[0].match.push('**/*.md'); }, 'duplicate match selectors');
  expectScopeV2Error('scope v2 requires at least one selector', (collection) => { collection.scopes[0].match = []; }, 'needs at least one match or path selector');
  expectScopeV2Error('scope v2 exact paths reject wildcard syntax', (collection) => { collection.scopes[1].paths = ['*.md']; }, 'invalid exact path selector');
  expectScopeV2Error('scope v2 exact paths must exist in the Git index', (collection) => { collection.scopes[1].paths = ['missing.md']; }, 'exact path is not tracked');
  expectScopeV2Error('scope v2 exact paths use exact Git casing', (collection) => { collection.scopes[1].paths = ['ONE.md']; }, 'exact path casing differs from Git index');
  expectScopeV2Error('scope v2 exact owners cannot collide', (collection) => { collection.scopes[0].paths = ['one.md']; }, 'duplicates exact path');
  expectScopeV2Error('scope v2 kind and policy values cannot exploit string coercion', (collection) => {
    collection.scopes[0].kind = ['record']; collection.scopes[0].policy = ['append-only'];
  }, 'invalid kind/policy pair');
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

  // upgrade-without-conform-adds-no-failure (guarantee 1 of the rollout): a repository whose manifest is
  // still v2 passes the previous gate chain and the current one alike, even when its notes would break
  // every manifest-v3 draft rule. The previous chain is HEAD's own scripts, read with git show. The
  // outcome is asserted directly as well, so the case still guards the tree when HEAD already holds
  // the current scripts (a merge commit in CI), where the old-versus-new comparison is trivially equal.
  const upgrade = join(work, 'upgrade');
  const chainScripts = ['docs-manifest.mjs', 'context-index-lib.mjs', 'record-lib.mjs', 'check-vault-standard.mjs', 'cli-lib.mjs'];
  const headScripts = join(work, 'head-scripts');
  mkdirSync(headScripts, { recursive: true });
  for (const file of chainScripts) writeFileSync(join(headScripts, file), execFileSync('git', ['show', `HEAD:scripts/${file}`], { cwd: ROOT }));
  const hub = join(upgrade, 'docs-hub');
  const dormantNote = (type, status, updated, extra = '', body = '') => `---\ntype: ${type}\nstatus: ${status}\nupdated: ${updated}\n${extra}---\n\n${body}# Note\n`;
  const upgradeFiles = {
    'src/code.txt': 'source\n',
    'docs-hub/Standard.md': '---\ntype: standard\nstatus: current\nupdated: 2026-08-18\nstandard-version: 4\n---\n\n# Standard\n',
    'docs-hub/00 Home.md': dormantNote('home', 'current', '2026-08-18'),
    'docs-hub/README.md': '# Readme\n',
    'docs-hub/10 Design/Superseded without link.md': dormantNote('design', 'superseded', '2020-01-01'),
    'docs-hub/10 Design/Promoted draft.md': dormantNote('design', 'draft', '2020-01-01', '', 'PROMOTED long ago\n\n'),
    'docs-hub/10 Design/Sourced page.md': dormantNote('synthesis', 'current', '2020-01-01', 'sources: src/**\n'),
    'docs-hub/10 Design/Unsourced synthesis.md': dormantNote('synthesis', 'current', '2020-01-01'),
    ...Object.fromEntries(['00 Inbox', '90 Templates', '95 Attachments', '99 Archive'].map((d) => [`docs-hub/${d}/.gitkeep`, ''])),
    ...Object.fromEntries(required.map((id) => [`docs-hub/40 Engineering/${id}.md`, `# ${id}\n`])),
    'docs-hub/98 System/DOCS_MANIFEST.json': `${JSON.stringify({
      version: 2, hub: 'docs-hub', runs: { tracking: 'ignored' }, recordCollections: [], legacyPaths: [],
      domains: required.map((id) => ({ id, path: `40 Engineering/${id}.md`, status: 'current', sources: ['src/**'], sourceDigest: '', contentDigest: '' })),
    }, null, 2)}\n`,
  };
  for (const [path, body] of Object.entries(upgradeFiles)) {
    mkdirSync(join(upgrade, path, '..'), { recursive: true });
    writeFileSync(join(upgrade, path), body);
  }
  git(['init', '--quiet', '-b', 'main'], upgrade);
  git(['add', '-A'], upgrade);
  // Only the manifest's own scripts are needed to stamp the digests, and they are removed again so
  // neither chain sees them as repository files.
  mkdirSync(join(upgrade, 'scripts'), { recursive: true });
  for (const file of ['docs-manifest.mjs', 'context-index-lib.mjs', 'record-lib.mjs']) cpSync(join(ROOT, 'scripts', file), join(upgrade, 'scripts', file));
  result = run(join(upgrade, 'scripts', 'docs-manifest.mjs'), ['sync', '--root', upgrade], upgrade);
  check('v2 upgrade fixture syncs', result.status === 0, result.out);
  rmSync(join(upgrade, 'scripts'), { recursive: true, force: true });
  git(['add', '-A'], upgrade);
  const chain = (scripts) => [
    run(join(scripts, 'docs-manifest.mjs'), ['check', '--root', upgrade], upgrade),
    run(join(scripts, 'check-vault-standard.mjs'), [hub], upgrade),
  ];
  const oldChain = chain(headScripts);
  const newChain = chain(join(ROOT, 'scripts'));
  check('upgrade-without-conform-adds-no-failure: the current chain passes a v2 vault whose notes break every v3 draft rule',
    newChain.every((r) => r.status === 0), newChain.map((r) => r.out).join('\n'));
  check('upgrade-without-conform-adds-no-failure: the previous chain (HEAD scripts) reaches the same outcome',
    oldChain.every((r, i) => r.status === newChain[i].status), `old ${oldChain.map((r) => r.status)} new ${newChain.map((r) => r.status)}`);
  const renderSkipped = run(join(ROOT, 'scripts', 'check-vault-standard.mjs'), [hub, '--render'], upgrade);
  check('upgrade-without-conform-adds-no-failure: --render on the v2 vault writes nothing', renderSkipped.status === 0
    && !existsSync(join(hub, '98 System', 'TRIAGE.md')) && !existsSync(join(hub, '10 Design', 'INDEX.md')), renderSkipped.out);

  // Read modes: --index, --attested, --only, and the plain-sync unstaged warning. One fixture with
  // distinct sources per domain, so a single edit drifts a known set. `atlas` digests all of src/**,
  // `architecture` src/a/** and `contracts` src/b/**. The rest digest scripts/**.
  const modes = join(work, 'modes');
  const script = join(modes, 'scripts', 'docs-manifest.mjs');
  const modesManifest = join(modes, 'project-docs', '98 System', 'DOCS_MANIFEST.json');
  const sourcesOf = { architecture: ['src/a/**'], contracts: ['src/b/**'], atlas: ['src/**'] };
  const both = (args) => {
    const r = spawnSync(process.execPath, [script, ...args, '--root', modes], { cwd: modes, encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}${r.stderr}` };
  };
  const stampedDomains = () => Object.fromEntries(JSON.parse(readFileSync(modesManifest, 'utf8')).domains.map((d) => [d.id, `${d.sourceDigest}${d.contentDigest}`]));
  const commitAll = (message) => { git(['add', '-A'], modes); git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', message], modes); return git(['rev-parse', 'HEAD'], modes).trim(); };
  const staleIds = () => [...both(['check']).all.matchAll(/- ([a-z-]+) (?:source|content) digest is stale/g)].map((m) => m[1]).filter((id, i, all) => all.indexOf(id) === i).sort();
  mkdirSync(join(modes, 'scripts'), { recursive: true });
  mkdirSync(join(modes, 'src', 'a'), { recursive: true });
  mkdirSync(join(modes, 'src', 'b'), { recursive: true });
  mkdirSync(join(modes, 'project-docs', '98 System'), { recursive: true });
  mkdirSync(join(modes, 'project-docs', '40 Engineering'), { recursive: true });
  for (const file of ['docs-manifest.mjs', 'context-index-lib.mjs', 'record-lib.mjs']) cpSync(join(ROOT, 'scripts', file), join(modes, 'scripts', file));
  writeFileSync(join(modes, 'src', 'a', 'x.txt'), 'a0\n');
  writeFileSync(join(modes, 'src', 'b', 'x.txt'), 'b0\n');
  for (const id of required) writeFileSync(join(modes, 'project-docs', '40 Engineering', `${id}.md`), `# ${id}\n`);
  writeFileSync(modesManifest, `${JSON.stringify({
    version: 1, hub: 'project-docs',
    domains: required.map((id) => ({ id, path: `40 Engineering/${id}.md`, status: 'current', sources: sourcesOf[id] || ['scripts/**'], sourceDigest: '', contentDigest: '' })),
  }, null, 2)}\n`);
  git(['init', '--quiet', '-b', 'main'], modes);
  let r = both(['sync']);
  check('modes fixture syncs', r.status === 0 && both(['check']).status === 0, r.all);
  const seed = commitAll('seed');

  // --index reads the index: unstaged edits and untracked files never enter a digest.
  writeFileSync(join(modes, 'src', 'a', 'x.txt'), 'a-unstaged\n');
  writeFileSync(join(modes, 'src', 'a', 'untracked.txt'), 'new\n');
  check('check fails on a working tree with unstaged edits and untracked files', staleIds().join() === 'architecture,atlas', staleIds().join());
  r = both(['check', '--index']);
  check('check --index ignores unstaged edits and untracked files', r.status === 0, r.all);
  const before = readFileSync(modesManifest, 'utf8');
  r = both(['sync', '--index']);
  check('sync --index with only unstaged edits stamps nothing and does not warn', r.status === 0 && readFileSync(modesManifest, 'utf8') === before && !r.err.includes('unstaged'), r.all);
  r = both(['sync']);
  check('plain sync warns about unstaged inputs and does not refuse', r.status === 0 && /warn 2 unstaged path\(s\)/.test(r.err) && r.err.includes('src/a/untracked.txt'), r.all);
  git(['checkout', '--', 'project-docs'], modes);
  rmSync(join(modes, 'src', 'a', 'untracked.txt'));
  git(['add', 'src/a/x.txt'], modes);
  check('check --index fails once the edit is staged and the manifest is stale', both(['check', '--index']).status === 1, both(['check', '--index']).all);
  r = both(['sync', '--index']);
  check('sync --index writes the manifest without staging it', r.status === 0 && !r.err.includes('unstaged')
    && both(['check', '--index']).status === 1, r.all);
  git(['add', 'project-docs'], modes);
  check('check --index passes once the stamped manifest is staged', both(['check', '--index']).status === 0, both(['check', '--index']).all);
  writeFileSync(join(modes, 'src', 'a', 'x.txt'), 'a-later-unstaged\n');
  check('check --index passes while an unstaged edit sits on top', both(['check', '--index']).status === 0, both(['check', '--index']).all);
  git(['checkout', '--', 'src'], modes);
  git(['reset', '--hard', '--quiet', seed], modes);

  // --only stamps one domain. The other drifted domain keeps its bytes.
  writeFileSync(join(modes, 'src', 'a', 'x.txt'), 'a-only\n');
  const preOnly = stampedDomains();
  r = both(['sync', '--only', 'atlas']);
  const postOnly = stampedDomains();
  check('--only atlas stamps atlas and no other domain', r.status === 0 && postOnly.atlas !== preOnly.atlas
    && Object.keys(preOnly).filter((id) => id !== 'atlas').every((id) => postOnly[id] === preOnly[id]), r.all);
  check('--only atlas leaves architecture stale', staleIds().join() === 'architecture', staleIds().join());
  check('--only rejects an unknown domain', both(['sync', '--only', 'nope']).status === 1, both(['sync', '--only', 'nope']).all);
  git(['reset', '--hard', '--quiet', seed], modes);

  // --attested: side one (s1) edits src/a and syncs. Side two edits src/b, stamps atlas only, and
  // leaves contracts stale. `merged` takes side two's manifest with side one's src/a, as a merge
  // that kept our manifest would. architecture and atlas drift only through the combination and both
  // sides attested them. contracts was stale on side two, so it stays stale.
  git(['checkout', '-q', '-b', 's1'], modes);
  writeFileSync(join(modes, 'src', 'a', 'x.txt'), 'a1\n');
  both(['sync']);
  const side1 = commitAll('side one');
  git(['checkout', '-q', '-b', 's2', seed], modes);
  writeFileSync(join(modes, 'src', 'b', 'x.txt'), 'b2\n');
  both(['sync', '--only', 'atlas']);
  const side2 = commitAll('side two');
  git(['checkout', '-q', '-b', 'merged'], modes);
  git(['checkout', side1, '--', 'src/a/x.txt'], modes);
  commitAll('combined trees, manifest from side two');
  check('the combined tree is stale for architecture, atlas and contracts', staleIds().join() === 'architecture,atlas,contracts', staleIds().join());
  const preAtt = stampedDomains();
  r = both(['sync', '--attested', `${side2},${side1}`]);
  const postAtt = stampedDomains();
  check('--attested stamps the domains fresh at both revs', r.status === 0 && postAtt.architecture !== preAtt.architecture && postAtt.atlas !== preAtt.atlas, r.all);
  check('--attested leaves a domain stale at one rev untouched and names it', postAtt.contracts === preAtt.contracts
    && r.out.includes('left stale, not attested') && r.out.includes('contracts') && staleIds().join() === 'contracts', r.all);
  check('--attested keeps the bytes of every domain it did not stamp', Object.keys(preAtt).filter((id) => !['architecture', 'atlas'].includes(id)).every((id) => postAtt[id] === preAtt[id]), r.all);
  git(['checkout', '--', 'project-docs'], modes);
  r = both(['sync', '--attested', side1]);
  check('--attested with one rev attests contracts, which was fresh there', r.status === 0 && staleIds().length === 0, r.all);
  git(['checkout', '--', 'project-docs'], modes);
  const reshaped = JSON.parse(readFileSync(modesManifest, 'utf8'));
  reshaped.domains.find((d) => d.id === 'architecture').sources = ['src/**'];
  writeFileSync(modesManifest, `${JSON.stringify(reshaped, null, 2)}\n`);
  r = both(['sync', '--attested', side1]);
  check('--attested does not attest a domain whose sources changed since the rev', r.status === 0 && r.out.includes('left stale') && r.out.includes('architecture'), r.all);
  git(['checkout', '--', 'project-docs'], modes);
  for (const [name, args, code] of [
    ['--attested rejects an unknown rev', ['sync', '--attested', 'no-such-rev'], 1],
    ['--attested rejects an empty rev', ['sync', '--attested', `${side1},`], 2],
    ['--attested is sync only', ['check', '--attested', side1], 2],
    ['--only is sync only', ['check', '--only', 'atlas'], 2],
    ['--index is not valid for plan', ['plan', '--index'], 2],
    ['--attested and --all conflict', ['sync', '--attested', side1, '--all'], 2],
  ]) { r = both(args); check(name, r.status === code, r.all); }
} finally { rmSync(work, { recursive: true, force: true }); }
if (failures.length) { console.error(`\n${failures.join('\n')}`); process.exit(1); }
console.log('\ndocs-manifest eval passed');
