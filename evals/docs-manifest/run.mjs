#!/usr/bin/env node
// Regression coverage for generic manifest discovery, interior globs, and installed extraction.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { tally, withDetail } from '../harness.mjs';
import { RUN_TIER_DAYS, listRunTiers, runRetentionTier } from '../../scripts/docs-manifest.mjs';

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

  // Run retention tiers: age from the YYYY-MM-DD name prefix, mtime when the name has no valid date,
  // and the day constants pinned on both sides of each boundary. The fixture "today" is 2026-10-07.
  check('the tier constants keep the documented ages', RUN_TIER_DAYS.active === 30 && RUN_TIER_DAYS.distillReady === 180, JSON.stringify(RUN_TIER_DAYS));
  const DAY = 86_400_000; const NOW = Date.UTC(2026, 9, 7, 12);
  const dated = (days) => `${new Date(NOW - days * DAY).toISOString().slice(0, 10)}-run`;
  for (const [days, tier] of [[0, 'active'], [30, 'active'], [31, 'distill-ready'], [180, 'distill-ready'], [181, 'archive'], [400, 'archive']]) {
    const got = runRetentionTier(dated(days), 0, NOW);
    check(`a name dated ${days} days ago is ${tier}`, got.tier === tier && got.ageDays === days && got.source === 'name', JSON.stringify(got));
  }
  const lateSameDay = runRetentionTier('2026-10-07-run', 0, Date.UTC(2026, 9, 7, 23, 59));
  check('age counts whole UTC days, so a same-day run is age 0 at 23:59', lateSameDay.ageDays === 0 && lateSameDay.tier === 'active', JSON.stringify(lateSameDay));
  check('a future-dated name clamps to age 0', runRetentionTier('2026-12-25-run', 0, NOW).ageDays === 0, 'future');
  check('a date prefix followed by a space still dates the folder', runRetentionTier('2026-09-13 audit', 0, NOW).source === 'name', 'space');
  check('the name date wins over a fresh mtime', runRetentionTier('2026-01-01-old', NOW, NOW).tier === 'archive', 'name over mtime');
  const undated = runRetentionTier('scratch', NOW - 3 * DAY, NOW);
  check('an undated name uses the mtime', undated.source === 'mtime' && undated.ageDays === 3 && undated.tier === 'active', JSON.stringify(undated));
  check('the mtime fallback uses the same boundaries', [30, 31, 180, 181].map((days) => runRetentionTier('scratch', NOW - days * DAY, NOW).tier).join()
    === 'active,distill-ready,distill-ready,archive', 'mtime boundaries');
  for (const bad of ['2026-02-30-run', '2026-13-01-run', '2026-9-1-run', '20260901-run', '12026-09-01-run', '2026-09-011-run']) {
    check(`${bad} is not a valid date prefix and falls back to mtime`, runRetentionTier(bad, NOW - 40 * DAY, NOW).source === 'mtime', bad);
  }
  check('a path argument ages by its last segment', runRetentionTier('project-docs/80 Runs/2026-08-01-x', 0, NOW).name === '2026-08-01-x', 'basename');

  const runsHub = join(modes, 'project-docs', '80 Runs');
  const expected = {
    '2026-10-07-today': 'active/0/name', '2026-09-07-edge-active': 'active/30/name', '2026-09-06-edge-ready': 'distill-ready/31/name',
    '2026-04-10-edge-ready-top': 'distill-ready/180/name', '2026-04-09-edge-archive': 'archive/181/name',
    'undated-fresh': 'active/6/mtime', 'undated-old': 'archive/644/mtime', '2026-02-30-bad-date': 'distill-ready/67/mtime',
  };
  const stamps = { 'undated-fresh': '2026-10-01T12:00:00Z', 'undated-old': '2025-01-01T12:00:00Z', '2026-02-30-bad-date': '2026-08-01T12:00:00Z' };
  for (const name of Object.keys(expected)) {
    mkdirSync(join(runsHub, name), { recursive: true });
    writeFileSync(join(runsHub, name, 'RUN_LOG.md'), '# log\n');
    if (stamps[name]) utimesSync(join(runsHub, name), new Date(stamps[name]), new Date(stamps[name]));
  }
  writeFileSync(join(runsHub, 'INDEX.md'), '# index\n');
  const listing = readdirSync(runsHub, { recursive: true }).sort().join('|');
  const got = Object.fromEntries(listRunTiers(runsHub, NOW).map((row) => [row.name, `${row.tier}/${row.ageDays}/${row.source}`]));
  check('the fixture runs get the expected tiers, ages, and sources', Object.keys(expected).every((name) => got[name] === expected[name])
    && Object.keys(got).length === Object.keys(expected).length, JSON.stringify(got));
  r = both(['runs', '--now', '2026-10-07']);
  const lineOf = (name) => r.out.split('\n').find((line) => line.endsWith(` ${name}`)) || '';
  const tierOf = (name) => { const at = r.out.indexOf(lineOf(name)); return ['active', 'distill-ready', 'archive'].filter((tier) => r.out.indexOf(`${tier} (`) <= at).pop(); };
  check('runs prints each folder under its tier with age and source, and skips plain files', r.status === 0
    && r.out.includes('active (3)') && r.out.includes('distill-ready (3)') && r.out.includes('archive (2)') && !r.out.includes('INDEX.md')
    && Object.keys(expected).every((name) => tierOf(name) === expected[name].split('/')[0] && lineOf(name).includes(`${expected[name].split('/')[1]}d  ${expected[name].split('/')[2]}`)), r.all);
  check('runs changes nothing on disk', readdirSync(runsHub, { recursive: true }).sort().join('|') === listing, 'listing changed');
  for (const [name, args] of [['--now is runs only', ['check', '--now', '2026-10-07']], ['runs rejects --all', ['runs', '--all']],
    ['runs rejects --index', ['runs', '--index']], ['--now rejects a non-date', ['runs', '--now', 'today']],
    ['--now rejects an impossible date', ['runs', '--now', '2026-02-30']]]) {
    r = both(args); check(name, r.status === 2, r.all);
  }

  // Atlas stamp bytes: the atlas domain digest ignores exactly the per-section fields that
  // `atlas-check.mjs stamp` writes (verifiedAt, verifiedDigest, claims) and nothing else. A mutant
  // copy of the script, with the strip reverted or widened, must fail this block.
  const realScript = readFileSync(join(ROOT, 'scripts', 'docs-manifest.mjs'), 'utf8');
  const STRIP = "new Set(['verifiedAt', 'verifiedDigest', 'claims'])";
  const atlasOutcomes = (name, scriptText) => {
    const fx = join(work, `atlas-${name}`);
    const atlasDir = join(fx, 'project-docs', '98 System', 'Atlas');
    mkdirSync(join(fx, 'scripts'), { recursive: true });
    mkdirSync(join(atlasDir, 'sections'), { recursive: true });
    mkdirSync(join(fx, 'project-docs', '40 Engineering'), { recursive: true });
    for (const file of ['context-index-lib.mjs', 'record-lib.mjs']) cpSync(join(ROOT, 'scripts', file), join(fx, 'scripts', file));
    writeFileSync(join(fx, 'scripts', 'docs-manifest.mjs'), scriptText);
    for (const id of required.filter((entry) => entry !== 'atlas')) writeFileSync(join(fx, 'project-docs', '40 Engineering', `${id}.md`), `# ${id}\n`);
    const atlasManifest = join(atlasDir, 'MANIFEST.json');
    const section = (extra) => ({ slug: 's', file: 'sections/s.md', scope: ['scripts'], verifiedAt: 'a'.repeat(40), ...extra });
    const writeAtlas = (s) => writeFileSync(atlasManifest, `${JSON.stringify({ version: 1, sections: [s] }, null, 2)}\n`);
    writeAtlas(section({ verifiedDigest: 'b'.repeat(64), claims: [{ file: 'scripts/context-index-lib.mjs', line: 1, anchor: 'one' }] }));
    writeFileSync(join(atlasDir, 'sections', 's.md'), '# S\n\nThe script cites scripts/context-index-lib.mjs:1.\n');
    writeFileSync(join(fx, 'project-docs', '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify({
      version: 1, hub: 'project-docs',
      domains: required.map((id) => ({ id, path: id === 'atlas' ? '98 System/Atlas' : `40 Engineering/${id}.md`, status: 'current', sources: ['scripts/**'], sourceDigest: '', contentDigest: '' })),
    }, null, 2)}\n`);
    git(['init', '--quiet', '-b', 'main'], fx);
    git(['add', '-A'], fx);
    git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'seed'], fx);
    const probe = (args) => run(join(fx, 'scripts', 'docs-manifest.mjs'), [...args, '--root', fx], fx);
    const out = { synced: probe(['sync']).status === 0 && probe(['check']).status === 0 };
    const stampedAtlas = JSON.parse(readFileSync(atlasManifest, 'utf8'));
    stampedAtlas.sections[0] = section({ verifiedAt: 'c'.repeat(40), verifiedDigest: 'd'.repeat(64), claims: [{ file: 'scripts/context-index-lib.mjs', line: 2, anchor: 'two' }] });
    writeFileSync(atlasManifest, `${JSON.stringify(stampedAtlas, null, 2)}\n`);
    out.stampOnly = probe(['check']).status === 0;
    stampedAtlas.sections[0] = section({});
    writeFileSync(atlasManifest, `${JSON.stringify(stampedAtlas, null, 2)}\n`);
    out.stampRemoved = probe(['check']).status === 0;
    writeAtlas(section({ verifiedDigest: 'b'.repeat(64), claims: [{ file: 'scripts/context-index-lib.mjs', line: 1, anchor: 'one' }] }));
    const proseFile = join(atlasDir, 'sections', 's.md');
    const prose = readFileSync(proseFile, 'utf8');
    writeFileSync(proseFile, prose.replace('cites', 'no longer cites'));
    const proseCheck = probe(['check']);
    out.proseCaught = proseCheck.status === 1 && proseCheck.out.includes('atlas content digest is stale');
    writeFileSync(proseFile, prose);
    writeAtlas(section({ scope: ['plugins'], verifiedDigest: 'b'.repeat(64), claims: [{ file: 'scripts/context-index-lib.mjs', line: 1, anchor: 'one' }] }));
    out.scopeCaught = probe(['check']).status === 1;
    writeAtlas(section({ slug: 'renamed', verifiedDigest: 'b'.repeat(64), claims: [{ file: 'scripts/context-index-lib.mjs', line: 1, anchor: 'one' }] }));
    out.slugCaught = probe(['check']).status === 1;
    return out;
  };
  const atlasReal = atlasOutcomes('real', realScript);
  check('atlas fixture syncs and checks', atlasReal.synced, JSON.stringify(atlasReal));
  check('atlas: a stamp-only change (verifiedAt, verifiedDigest, claims) passes check', atlasReal.stampOnly, JSON.stringify(atlasReal));
  check('atlas: removing the stamp fields passes check', atlasReal.stampRemoved, JSON.stringify(atlasReal));
  check('atlas: a section prose edit without a sync fails check', atlasReal.proseCaught, JSON.stringify(atlasReal));
  check('atlas: a scope edit without a sync fails check', atlasReal.scopeCaught, JSON.stringify(atlasReal));
  check('atlas: a slug edit without a sync fails check', atlasReal.slugCaught, JSON.stringify(atlasReal));
  check('the strip definition is present for the mutants', realScript.includes(STRIP), STRIP);
  const revert = atlasOutcomes('revert', realScript.replace(STRIP, 'new Set([])'));
  check('mutant: a reverted strip fails the stamp-only case', revert.synced && !revert.stampOnly, JSON.stringify(revert));
  const widened = atlasOutcomes('widen', realScript.replace(STRIP, "new Set(['verifiedAt', 'verifiedDigest', 'claims', 'scope', 'slug'])"));
  check('mutant: a widened strip fails the scope and slug cases', widened.synced && !widened.scopeCaught && !widened.slugCaught, JSON.stringify(widened));
  const everything = atlasOutcomes('all', realScript.replace('return Buffer.from(JSON.stringify({ ...atlas, sections }));', 'return Buffer.from("");'));
  check('mutant: ignoring the whole manifest fails the scope case', everything.synced && !everything.scopeCaught, JSON.stringify(everything));

  // Digest file store (`"digestStore": "files"`): each domain digest is its own file under
  // `<hub>/98 System/Digests/`, named `<id>.<source|content>.<first 16 hex of the digest>`. The fixture starts in JSON
  // mode so the unchanged path and `migrate` are covered, then every case runs on a copy of the
  // migrated base.
  const ident = ['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval'];
  const fixtureTool = (dir) => (args) => {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'docs-manifest.mjs'), ...args, '--root', dir], { cwd: dir, encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}${r.stderr}` };
  };
  const commitIn = (dir, message) => { git(['add', '-A'], dir); git([...ident, 'commit', '-qm', message], dir); return git(['rev-parse', 'HEAD'], dir).trim(); };
  const digestDirOf = (dir) => join(dir, 'project-docs', '98 System', 'Digests');
  const digestNames = (dir) => (existsSync(digestDirOf(dir)) ? readdirSync(digestDirOf(dir)).sort() : []);
  const manifestOf = (dir) => join(dir, 'project-docs', '98 System', 'DOCS_MANIFEST.json');
  const staleOf = (tool) => [...tool(['check']).all.matchAll(/- ([a-z-]+) (?:source|content) digest is stale/g)].map((m) => m[1]).filter((id, i, all) => all.indexOf(id) === i).sort().join();
  const hex = (char) => char.repeat(64);
  const short = (digest) => digest.slice(0, 16);

  const fmJson = join(work, 'fm-json');
  for (const sub of ['scripts', 'src/a', 'src/b', 'project-docs/98 System', 'project-docs/40 Engineering']) mkdirSync(join(fmJson, sub), { recursive: true });
  for (const file of ['docs-manifest.mjs', 'context-index-lib.mjs', 'record-lib.mjs']) cpSync(join(ROOT, 'scripts', file), join(fmJson, 'scripts', file));
  writeFileSync(join(fmJson, 'src', 'a', 'x.txt'), 'a0\n');
  writeFileSync(join(fmJson, 'src', 'b', 'x.txt'), 'b0\n');
  writeFileSync(join(fmJson, 'project-docs', 'Standard.md'), '---\nstandard-version: 4\n---\n\n# Standard\n');
  for (const id of required) writeFileSync(join(fmJson, 'project-docs', '40 Engineering', `${id}.md`), `# ${id}\n`);
  writeFileSync(manifestOf(fmJson), `${JSON.stringify({
    version: 2, hub: 'project-docs', runs: { tracking: 'ignored' }, recordCollections: [], legacyPaths: [],
    domains: required.map((id) => ({ id, path: `40 Engineering/${id}.md`, status: 'current', sources: sourcesOf[id] || ['scripts/**'], sourceDigest: '', contentDigest: '' })),
  }, null, 2)}\n`);
  git(['init', '--quiet', '-b', 'main'], fmJson);
  const jsonTool = fixtureTool(fmJson);
  r = jsonTool(['sync']);
  const jsonManifest = JSON.parse(readFileSync(manifestOf(fmJson), 'utf8'));
  check('files store: JSON mode is unchanged (digests in the manifest, no Digests folder, no digestStore key)', r.status === 0
    && jsonTool(['check']).status === 0 && digestNames(fmJson).length === 0 && !('digestStore' in jsonManifest)
    && jsonManifest.domains.every((d) => /^[0-9a-f]{64}$/.test(d.sourceDigest) && /^[0-9a-f]{64}$/.test(d.contentDigest)), r.all);
  const jsonBase = commitIn(fmJson, 'json base');
  writeFileSync(join(fmJson, 'src', 'a', 'x.txt'), 'a-stale\n');
  const staleJson = readFileSync(manifestOf(fmJson), 'utf8');
  r = jsonTool(['migrate']);
  check('files store: migrate refuses a stale manifest and writes nothing', r.status === 1 && readFileSync(manifestOf(fmJson), 'utf8') === staleJson && digestNames(fmJson).length === 0, r.all);
  git(['checkout', '--', 'src'], fmJson);
  r = jsonTool(['migrate', '--index']);
  check('files store: migrate takes no flag but --root', r.status === 2, r.all);
  r = jsonTool(['migrate']);
  const migrated = JSON.parse(readFileSync(manifestOf(fmJson), 'utf8'));
  check('files store: migrate sets the key, strips the digests, and writes 22 files', r.status === 0 && migrated.digestStore === 'files'
    && migrated.domains.every((d) => !('sourceDigest' in d) && !('contentDigest' in d)) && digestNames(fmJson).length === 22, r.all);
  check('files store: JSON-mode and files-mode check give the same verdict on the migration', jsonTool(['check']).status === 0, jsonTool(['check']).all);
  check('files store: migrate refuses a manifest that already uses the store', jsonTool(['migrate']).status === 1, jsonTool(['migrate']).all);
  check('files store: JSON-mode manifest and digest files agree on the digest', (() => {
    const old = JSON.parse(git(['show', `${jsonBase}:project-docs/98 System/DOCS_MANIFEST.json`], fmJson));
    return old.domains.every((d) => digestNames(fmJson).includes(`${d.id}.source.${short(d.sourceDigest)}`) && digestNames(fmJson).includes(`${d.id}.content.${short(d.contentDigest)}`));
  })(), digestNames(fmJson).join());
  const fmBase = commitIn(fmJson, 'files base');
  const scenario = (name) => {
    const dir = join(work, `fm-${name}`);
    cpSync(fmJson, dir, { recursive: true });
    return { dir, tool: fixtureTool(dir) };
  };
  const manifestBytes = (dir) => readFileSync(manifestOf(dir), 'utf8');

  {
    const { dir, tool } = scenario('drift');
    const json = manifestBytes(dir);
    writeFileSync(join(dir, 'src', 'a', 'x.txt'), 'a1\n');
    check('files store: a source edit makes check fail with the stale text', tool(['check']).status === 1 && staleOf(tool) === 'architecture,atlas', staleOf(tool));
    r = tool(['sync']);
    check('files store: sync restamps the drifted domains and leaves the manifest bytes alone', r.status === 0 && tool(['check']).status === 0
      && manifestBytes(dir) === json && digestNames(dir).length === 22, r.all);
    const names = digestNames(dir);
    r = tool(['sync', '--all']);
    check('files store: sync --all on a fresh store changes nothing', r.status === 0 && digestNames(dir).join() === names.join() && manifestBytes(dir) === json, r.all);
    r = tool(['sync', '--only', 'atlas']);
    check('files store: sync --only works', r.status === 0, r.all);
  }
  {
    const { dir, tool } = scenario('two');
    const extra = join(digestDirOf(dir), `architecture.source.${short(hex('f'))}`);
    writeFileSync(extra, `${hex('f')}\n`);
    r = tool(['check']);
    check('files store: two files for one domain and kind fail check as stale', r.status === 1 && staleOf(tool) === 'architecture'
      && r.all.includes('architecture source digest is stale'), r.all);
    r = tool(['sync']);
    check('files store: sync resolves a duplicate and leaves one file', r.status === 0 && tool(['check']).status === 0 && !existsSync(extra)
      && digestNames(dir).filter((n) => n.startsWith('architecture.source.')).length === 1, r.all);
  }
  {
    const { dir, tool } = scenario('missing');
    const doomed = digestNames(dir).find((n) => n.startsWith('contracts.content.'));
    rmSync(join(digestDirOf(dir), doomed));
    r = tool(['check']);
    check('files store: a missing digest file is stale (also while git still lists it)', r.status === 1 && r.all.includes('contracts content digest is stale'), r.all);
    r = tool(['sync']);
    check('files store: sync writes the missing file back', r.status === 0 && digestNames(dir).includes(doomed) && tool(['check']).status === 0, r.all);
  }
  for (const [label, mutate, fragment] of [
    ['a malformed name', (dir) => writeFileSync(join(digestDirOf(dir), 'architecture.source.xyz'), 'x\n'), 'malformed digest file name'],
    ['an uppercase digest name', (dir) => writeFileSync(join(digestDirOf(dir), `architecture.source.${short(hex('A'))}`), `${hex('A')}\n`), 'malformed digest file name'],
    ['a file in a subfolder', (dir) => { mkdirSync(join(digestDirOf(dir), 'sub'), { recursive: true }); writeFileSync(join(digestDirOf(dir), 'sub', 'x'), 'x\n'); }, 'malformed digest file name'],
    ['an orphan file', (dir) => writeFileSync(join(digestDirOf(dir), `nope.source.${short(hex('c'))}`), `${hex('c')}\n`), 'digest file for unknown domain nope'],
    ['content whose prefix differs from the name', (dir) => {
      const name = digestNames(dir).find((n) => n.startsWith('guides.source.'));
      writeFileSync(join(digestDirOf(dir), name), `${hex('e')}\n`);
    }, 'digest file content is not the 64-hex digest its name prefixes'],
    ['content shorter than 64 hex', (dir) => {
      const name = digestNames(dir).find((n) => n.startsWith('guides.source.'));
      writeFileSync(join(digestDirOf(dir), name), `${name.split('.')[2]}\n`);
    }, 'digest file content is not the 64-hex digest its name prefixes'],
    ['a full 64-hex file name', (dir) => writeFileSync(join(digestDirOf(dir), `architecture.source.${hex('f')}`), `${hex('f')}\n`), 'malformed digest file name'],
  ]) {
    const { dir, tool } = scenario(`bad-${label.replace(/\W+/g, '-')}`);
    mutate(dir);
    const before = digestNames(dir).join();
    r = tool(['check']);
    const refused = tool(['sync']);
    check(`files store: ${label} is a structural error for check`, r.status === 1 && r.all.includes(fragment), r.all);
    check(`files store: sync refuses ${label}`, refused.status === 1 && refused.all.includes('documentation manifest invalid') && digestNames(dir).join() === before, refused.all);
  }
  {
    // A 64-bit prefix collision: a file with the right name and a valid-looking but different digest.
    // It parses, yet differs from the computed digest, so check fails closed and sync repairs it.
    const { dir, tool } = scenario('collision');
    const name = digestNames(dir).find((n) => n.startsWith('guides.source.'));
    const genuine = readFileSync(join(digestDirOf(dir), name), 'utf8');
    writeFileSync(join(digestDirOf(dir), name), `${name.split('.')[2]}${'0'.repeat(48)}
`);
    r = tool(['check']);
    check('files store: a same-prefix file with a different digest fails closed as stale', r.status === 1 && staleOf(tool) === 'guides' && r.all.includes('guides source digest is stale'), r.all);
    r = tool(['sync']);
    check('files store: sync replaces the same-prefix forgery with the genuine digest', r.status === 0 && tool(['check']).status === 0 && readFileSync(join(digestDirOf(dir), name), 'utf8') === genuine, r.all);
  }
  {
    const { dir, tool } = scenario('leftover');
    const leftover = JSON.parse(manifestBytes(dir));
    leftover.domains[0].sourceDigest = hex('1');
    writeFileSync(manifestOf(dir), `${JSON.stringify(leftover, null, 2)}\n`);
    r = tool(['check']);
    const refused = tool(['sync']);
    check('files store: a digest key left on a domain is a structural error', r.status === 1 && r.all.includes('must not carry sourceDigest'), r.all);
    check('files store: sync refuses a domain that still carries a digest key', refused.status === 1 && refused.all.includes('documentation manifest invalid'), refused.all);
    leftover.digestStore = 'json'; delete leftover.domains[0].sourceDigest;
    writeFileSync(manifestOf(dir), `${JSON.stringify(leftover, null, 2)}\n`);
    check('files store: digestStore accepts only "files"', tool(['check']).all.includes('digestStore must be "files"'), tool(['check']).all);
    const v1 = JSON.parse(manifestBytes(dir)); v1.digestStore = 'files'; v1.version = 1;
    delete v1.runs; delete v1.recordCollections; delete v1.legacyPaths;
    writeFileSync(manifestOf(dir), `${JSON.stringify(v1, null, 2)}\n`);
    check('files store: version 1 does not take the key', tool(['check']).all.includes('manifest has unknown key digestStore'), tool(['check']).all);
  }
  {
    // --index: the file deleted on disk but still staged counts as present, and a staged deletion counts as missing.
    const { dir, tool } = scenario('index');
    const victim = digestNames(dir).find((n) => n.startsWith('observability.source.'));
    rmSync(join(digestDirOf(dir), victim));
    check('files store: an unstaged deletion fails the working-tree check', tool(['check']).status === 1 && staleOf(tool) === 'observability', staleOf(tool));
    check('files store: --index still sees the unstaged deletion as present', tool(['check', '--index']).status === 0, tool(['check', '--index']).all);
    git(['rm', '--cached', '-q', '--', `project-docs/98 System/Digests/${victim}`], dir);
    r = tool(['check', '--index']);
    check('files store: --index counts a staged deletion as missing', r.status === 1 && r.all.includes('observability source digest is stale'), r.all);
    r = tool(['sync', '--index']);
    check('files store: sync --index restores the staged deletion on disk', r.status === 0 && digestNames(dir).includes(victim), r.all);
    git(['add', '-A'], dir);
    check('files store: --index passes once the file is staged again', tool(['check', '--index']).status === 0, tool(['check', '--index']).all);
  }
  {
    // --attested: the same shape as the JSON-mode case above, with the store holding the digests.
    const { dir, tool } = scenario('attested');
    git(['checkout', '-q', '-b', 's1'], dir);
    writeFileSync(join(dir, 'src', 'a', 'x.txt'), 'a1\n');
    tool(['sync']);
    const one = commitIn(dir, 'side one');
    git(['checkout', '-q', '-b', 's2', fmBase], dir);
    writeFileSync(join(dir, 'src', 'b', 'x.txt'), 'b2\n');
    tool(['sync', '--only', 'atlas']);
    const two = commitIn(dir, 'side two');
    git(['checkout', '-q', '-b', 'merged'], dir);
    git(['checkout', one, '--', 'src/a/x.txt'], dir);
    commitIn(dir, 'combined trees, digest files from side two');
    check('files store: the combined tree is stale for architecture, atlas and contracts', staleOf(tool) === 'architecture,atlas,contracts', staleOf(tool));
    r = tool(['sync', '--attested', `${two},${one}`]);
    check('files store: --attested restamps the domains fresh at both revs and names the rest', r.status === 0
      && r.out.includes('left stale, not attested') && r.out.includes('contracts') && staleOf(tool) === 'contracts', r.all);
    git(['checkout', '--', 'project-docs'], dir); git(['clean', '-fdq', '--', 'project-docs'], dir);
    r = tool(['sync', '--attested', one]);
    check('files store: --attested with one rev attests contracts, which was fresh there', r.status === 0 && staleOf(tool) === '', r.all);
    git(['checkout', '--', 'project-docs'], dir); git(['clean', '-fdq', '--', 'project-docs'], dir);
    git(['checkout', '-q', '-b', 'dup', one], dir);
    writeFileSync(join(digestDirOf(dir), `architecture.source.${hex('f')}`), `${hex('f')}\n`);
    const duplicated = commitIn(dir, 'ambiguous architecture');
    git(['checkout', '-q', 'merged'], dir);
    r = tool(['sync', '--attested', duplicated]);
    check('files store: a rev with two files for the domain does not attest it', r.status === 0 && r.out.includes('left stale') && r.out.includes('architecture'), r.all);
  }
  {
    // Two branches restamp the same domain and git merges the digest files without a conflict.
    const { dir, tool } = scenario('merge');
    git(['checkout', '-q', '-b', 'b1'], dir);
    writeFileSync(join(dir, 'src', 'a', 'x.txt'), 'a-left\n');
    tool(['sync']);
    commitIn(dir, 'left');
    git(['checkout', '-q', '-b', 'b2', fmBase], dir);
    writeFileSync(join(dir, 'src', 'a', 'y.txt'), 'a-right\n');
    tool(['sync']);
    commitIn(dir, 'right');
    const tree = spawnSync('git', ['merge-tree', '--write-tree', 'b1', 'b2'], { cwd: dir, encoding: 'utf8' });
    check('files store: merge-tree of two branches that restamp one domain exits 0', tree.status === 0, `${tree.stdout}${tree.stderr}`);
    git(['checkout', '-q', 'b1'], dir);
    const merge = spawnSync('git', [...ident, 'merge', '--no-edit', 'b2'], { cwd: dir, encoding: 'utf8' });
    check('files store: the real merge exits 0', merge.status === 0, `${merge.stdout}${merge.stderr}`);
    check('files store: the merged tree fails check (two files per restamped domain)', tool(['check']).status === 1 && staleOf(tool) === 'architecture,atlas', staleOf(tool));
    r = tool(['sync']);
    check('files store: sync resolves the merged tree', r.status === 0 && tool(['check']).status === 0, r.all);
  }
} finally { rmSync(work, { recursive: true, force: true }); }
if (failures.length) { console.error(`\n${failures.join('\n')}`); process.exit(1); }
console.log('\ndocs-manifest eval passed');
