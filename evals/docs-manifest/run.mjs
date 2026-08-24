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
  for (const file of ['docs-manifest.mjs', 'docs-extract.mjs', 'context-index-lib.mjs']) {
    cpSync(join(ROOT, 'scripts', file), join(repo, 'scripts', file));
  }
  writeFileSync(join(repo, 'plugins', 'alpha', 'skills', 'sample', 'SKILL.md'), '# Sample\n');
  const required = ['architecture', 'contracts', 'data-model', 'engineering-standards', 'api-reference', 'ci-delivery', 'infrastructure', 'observability', 'design-system', 'guides', 'atlas'];
  for (const id of required) writeFileSync(join(repo, 'project-docs', '40 Engineering', `${id}.md`), `# ${id}\n`);
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
  writeFileSync(manifestPath, `${JSON.stringify(versionTwo, null, 2)}\n`);
  const v2Output = join(repo, 'v2-plan.json');
  result = run(join(repo, 'scripts', 'docs-extract.mjs'), ['plan', '--root', repo, '--out', v2Output], repo);
  const v2Receipt = result.status === 0 ? JSON.parse(readFileSync(v2Output, 'utf8')) : null;
  check('manifest v2 extraction carries bounded record context', result.status === 0 && v2Receipt?.version === 2 && Array.isArray(v2Receipt.records) && v2Receipt.records.length === 0, result.out);
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
