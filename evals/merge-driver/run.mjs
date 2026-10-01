#!/usr/bin/env node
// Regression eval for the derived-file merge driver (scripts/derived-merge.mjs).
//
//   node evals/merge-driver/run.mjs   (exit 0 = pass)
//
// Each scenario builds a throwaway repository, installs the driver through install-git-hooks.mjs,
// and merges two branches that regenerated the same derived file. The repository carries the real
// pre-commit and pre-merge-commit hooks and the real docs-manifest.mjs. Only the atlas gate is a
// stub, because evals/atlas-check covers it and a fixture atlas adds nothing to a merge test.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { tally, withDetail } from '../harness.mjs';

const ROOT = process.cwd();
const work = mkdtempSync(join(tmpdir(), 'coh-merge-driver-'));
const { fails, check } = tally(withDetail);
const HUB = 'project-docs';
const MANIFEST = `${HUB}/98 System/DOCS_MANIFEST.json`;
const INTAKE = `${HUB}/98 System/Records/intake.jsonl`;
const ATLAS_MANIFEST = `${HUB}/98 System/Atlas/MANIFEST.json`;
const REQUIRED = ['architecture', 'contracts', 'data-model', 'engineering-standards', 'api-reference', 'ci-delivery', 'infrastructure', 'observability', 'design-system', 'guides', 'atlas'];
const SCRIPTS = ['docs-manifest.mjs', 'docs-extract.mjs', 'context-index-lib.mjs', 'record-lib.mjs', 'derived-merge.mjs', 'install-git-hooks.mjs'];

const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', ...args], { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, out: `${result.stdout || ''}${result.stderr || ''}`.trim() };
};
const node = (cwd, ...args) => {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, out: `${result.stdout || ''}${result.stderr || ''}`.trim() };
};
const put = (repo, path, text) => { mkdirSync(resolve(repo, path, '..'), { recursive: true }); writeFileSync(join(repo, path), text); };
const read = (repo, path) => readFileSync(join(repo, path), 'utf8');
const commit = (repo, message) => { git(repo, 'add', '-A'); return git(repo, 'commit', '--no-verify', '-qm', message); };
const manifestCheck = (repo) => node(repo, 'scripts/docs-manifest.mjs', 'check');
const unmerged = (repo) => [...new Set(git(repo, 'ls-files', '-u').out.split('\n').filter(Boolean).map((line) => line.split('\t')[1]))];
const clean = (repo) => git(repo, 'status', '--porcelain').out === '';

// A repository whose manifest digests depend on src/**, with the hooks and the driver installed.
function fixture(name, { install = true, scriptsDir = join(ROOT, 'scripts') } = {}) {
  const repo = join(work, name);
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  for (const file of SCRIPTS) cpSync(join(scriptsDir, file), join(repo, 'scripts', file));
  put(repo, 'scripts/atlas-check.mjs', 'process.exit(0);\n');
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  for (const hook of ['pre-commit', 'pre-merge-commit', 'post-merge']) cpSync(join(ROOT, '.githooks', hook), join(repo, '.githooks', hook));
  cpSync(join(ROOT, '.gitattributes'), join(repo, '.gitattributes'));
  for (const id of REQUIRED) put(repo, `${HUB}/40 Engineering/${id}.md`, `# ${id}\n`);
  put(repo, 'src/a.md', 'one\ntwo\nthree\n');
  put(repo, 'src/b.md', 'alpha\nbeta\ngamma\n');
  put(repo, MANIFEST, `${JSON.stringify({
    version: 1, hub: HUB,
    domains: REQUIRED.map((id) => ({ id, path: `40 Engineering/${id}.md`, status: 'current', sources: ['src/**'], sourceDigest: '', contentDigest: '' })),
  }, null, 2)}\n`);
  put(repo, ATLAS_MANIFEST, '{\n  "stamp": "base"\n}\n');
  put(repo, INTAKE, '{"line":"base"}\n');
  git(repo, 'init', '-q', '-b', 'main');
  node(repo, 'scripts/docs-manifest.mjs', 'sync');
  commit(repo, 'seed');
  if (install) node(repo, 'scripts/install-git-hooks.mjs');
  return repo;
}

// Branch `left` and `right` each change one source file and regenerate the manifest.
function diverge(repo, { leftFile = 'src/a.md', rightFile = 'src/b.md', leftText = 'ONE\ntwo\nthree\n', rightText = 'alpha\nbeta\nGAMMA\n' } = {}) {
  git(repo, 'checkout', '-qb', 'right');
  put(repo, rightFile, rightText);
  node(repo, 'scripts/docs-manifest.mjs', 'sync');
  commit(repo, 'right');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'checkout', '-qb', 'left');
  put(repo, leftFile, leftText);
  node(repo, 'scripts/docs-manifest.mjs', 'sync');
  commit(repo, 'left');
}

// Merge `right` into `left` and state what a correct driver leaves behind. Returns failures.
function mergeIsCleanAndFresh(repo) {
  const problems = [];
  const merge = git(repo, 'merge', '--no-edit', 'right');
  if (merge.status !== 0) problems.push(`merge exited ${merge.status}: ${merge.out.split('\n').slice(-3).join(' | ')}`);
  if (unmerged(repo).length) problems.push(`unmerged paths remain: ${unmerged(repo).join(', ')}`);
  if (existsSync(join(repo, '.git', 'MERGE_HEAD'))) problems.push('merge still in progress');
  if (read(repo, MANIFEST).includes('<<<<<<<') || read(repo, MANIFEST).includes('"regenerated"')) problems.push('manifest holds conflict markers or placeholder digests');
  const merged = read(repo, MANIFEST);
  node(repo, 'scripts/docs-manifest.mjs', 'sync');
  if (read(repo, MANIFEST) !== merged) problems.push('merged manifest differs from a fresh regeneration');
  const verdict = manifestCheck(repo);
  if (verdict.status !== 0) problems.push(`docs-manifest check failed: ${verdict.out.split('\n').slice(0, 2).join(' | ')}`);
  git(repo, 'checkout', '--', MANIFEST);
  if (!clean(repo)) problems.push(`tree is not clean after the merge: ${git(repo, 'status', '--porcelain').out}`);
  return problems;
}

// The failing-generator setup: `right` points a domain at a missing file, so the merged manifest
// cannot regenerate. Returns the branch heads, with `left` checked out.
function divergeBroken(repo) {
  git(repo, 'checkout', '-qb', 'right');
  const parsed = JSON.parse(read(repo, MANIFEST));
  parsed.domains[0].path = '40 Engineering/missing.md';
  put(repo, MANIFEST, `${JSON.stringify(parsed, null, 2)}\n`);
  commit(repo, 'right points a domain at a missing file');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'checkout', '-qb', 'left');
  put(repo, 'src/a.md', 'ONE\ntwo\nthree\n');
  node(repo, 'scripts/docs-manifest.mjs', 'sync');
  commit(repo, 'left');
}

// Merge the broken branch and state what a fail-closed driver leaves behind. Returns failures.
function failureStaysClosed(repo) {
  const problems = [];
  const before = git(repo, 'rev-parse', 'HEAD').out;
  const result = git(repo, 'merge', '--no-edit', 'right');
  if (result.status === 0) problems.push('the merge completed');
  if (git(repo, 'rev-parse', 'HEAD').out !== before) problems.push('HEAD moved');
  if (!unmerged(repo).includes(MANIFEST)) problems.push(`manifest is not conflicted in the index (unmerged: ${unmerged(repo).join() || 'none'})`);
  if (git(repo, 'commit', '--no-edit').status === 0) problems.push('git commit succeeded with a stale manifest');
  if (!/regeneration failed/.test(result.out) || !/derived-merge\.mjs regenerate/.test(result.out)) problems.push(`the message lacks the cause or the fix: ${result.out.slice(-200)}`);
  return problems;
}

try {
  // 1. The control proves the scenario conflicts without the driver, so the passes below mean something.
  const control = fixture('control', { install: false });
  git(control, 'config', 'core.hooksPath', '.githooks');
  diverge(control);
  const controlMerge = git(control, 'merge', '--no-edit', 'right');
  check('control: without the driver the same merge conflicts on the manifest', controlMerge.status !== 0 && unmerged(control).includes(MANIFEST), controlMerge.out.slice(-200));

  // 2. Both branches regenerated the manifest. The merge ends clean and equals a fresh regeneration.
  const both = fixture('both');
  diverge(both);
  const problems = mergeIsCleanAndFresh(both);
  check('clean auto-merge: manifest regenerates, merge commits, tree is clean', problems.length === 0, problems.join('; '));
  check('clean auto-merge: the merge commit has two parents', git(both, 'rev-list', '--parents', '-n1', 'HEAD').out.split(' ').length === 3);
  check('check: install-git-hooks --check reports the driver', node(both, 'scripts/install-git-hooks.mjs', '--check').status === 0);

  // 3. A real source conflict plus a derived conflict: the driver defers the manifest, a person
  // resolves the source, and the commit regenerates against the resolved tree.
  const mixed = fixture('mixed');
  diverge(mixed, { leftFile: 'src/a.md', rightFile: 'src/a.md', leftText: 'ONE\ntwo\nthree\n', rightText: 'uno\ntwo\nthree\n' });
  const stop = git(mixed, 'merge', '--no-edit', 'right');
  check('mixed: the merge stops on the source file only', stop.status !== 0 && unmerged(mixed).join() === 'src/a.md', `${stop.out.slice(-160)} / unmerged: ${unmerged(mixed).join()}`);
  put(mixed, 'src/a.md', 'RESOLVED\ntwo\nthree\n');
  git(mixed, 'add', 'src/a.md');
  const finish = git(mixed, 'commit', '--no-edit');
  const mixedCheck = manifestCheck(mixed);
  check('mixed: the commit regenerates the manifest against the resolved tree', finish.status === 0 && mixedCheck.status === 0 && clean(mixed), `${finish.out.slice(-200)} / ${mixedCheck.out.slice(0, 120)}`);

  // 4. A regeneration that fails leaves the conflict in place and the merge uncommitted.
  const broken = fixture('broken');
  divergeBroken(broken);
  const closed = failureStaysClosed(broken);
  check('regeneration failure: the conflict stays, nothing commits, the message names cause and fix', closed.length === 0, closed.join('; '));
  // The person fixes the cause and the same command finishes the job.
  put(broken, `${HUB}/40 Engineering/missing.md`, '# missing\n');
  const retry = node(broken, 'scripts/derived-merge.mjs', 'regenerate');
  check('regeneration failure: after the fix, regenerate resolves the conflict', retry.status === 0 && !unmerged(broken).length, retry.out.slice(-200));
  git(broken, 'add', '-A');
  const done = git(broken, 'commit', '--no-edit');
  check('regeneration failure: the merge then commits with a fresh manifest', done.status === 0 && manifestCheck(broken).status === 0, done.out.slice(-200));

  // 5. Intake files keep both sides' lines. Other files that both branches edit still conflict.
  const intake = fixture('intake');
  git(intake, 'checkout', '-qb', 'right');
  put(intake, INTAKE, `${read(intake, INTAKE)}{"line":"right"}\n`);
  commit(intake, 'right intake');
  git(intake, 'checkout', '-q', 'main');
  git(intake, 'checkout', '-qb', 'left');
  put(intake, INTAKE, `${read(intake, INTAKE)}{"line":"left"}\n`);
  commit(intake, 'left intake');
  const union = git(intake, 'merge', '--no-edit', 'right');
  const lines = read(intake, INTAKE).split('\n').filter(Boolean);
  check('intake: both appended lines survive and the merge is clean', union.status === 0 && lines.length === 3 && lines.some((l) => l.includes('left')) && lines.some((l) => l.includes('right')), `${union.out.slice(-160)} / ${lines.join(' ')}`);

  // 6. The atlas manifest is never auto-resolved: its stamps record a person's judgment.
  const atlas = fixture('atlas');
  git(atlas, 'checkout', '-qb', 'right');
  put(atlas, ATLAS_MANIFEST, '{\n  "stamp": "right"\n}\n');
  commit(atlas, 'right stamp');
  git(atlas, 'checkout', '-q', 'main');
  git(atlas, 'checkout', '-qb', 'left');
  put(atlas, ATLAS_MANIFEST, '{\n  "stamp": "left"\n}\n');
  commit(atlas, 'left stamp');
  git(atlas, 'merge', '--no-edit', 'right');
  check('atlas: a conflicting atlas manifest stays a conflict', unmerged(atlas).includes(ATLAS_MANIFEST), `unmerged: ${unmerged(atlas).join()}`);

  // 7. A rebase never runs the commit hooks mid-pick, so it must not take a side silently.
  const rebase = fixture('rebase');
  diverge(rebase);
  const rebased = git(rebase, 'rebase', 'right');
  check('rebase: a conflicting manifest stops the rebase', rebased.status !== 0 && unmerged(rebase).includes(MANIFEST), `${rebased.out.slice(-160)} / unmerged: ${unmerged(rebase).join()}`);
  git(rebase, 'rebase', '--abort');

  // 8. Mutants. Each broken driver must fail the scenario that guards it, or the eval proves nothing.
  const mutate = (name, from, to) => {
    const dir = join(work, `mutant-${name}`);
    mkdirSync(dir, { recursive: true });
    for (const file of SCRIPTS) cpSync(join(ROOT, 'scripts', file), join(dir, file));
    const source = readFileSync(join(dir, 'derived-merge.mjs'), 'utf8');
    if (!source.includes(from)) throw new Error(`mutant ${name}: anchor not found, the eval is stale`);
    writeFileSync(join(dir, 'derived-merge.mjs'), source.replace(from, () => to));
    return dir;
  };
  // Mutant A: regeneration reports success without running any generator.
  const noRegen = fixture('mutant-no-regen', { scriptsDir: mutate('no-regen', "const result = spawnSync(process.execPath, [join(SCRIPTS, tool), ...args]", "const result = spawnSync(process.execPath, ['-e', '0', ...args]") });
  diverge(noRegen);
  const noRegenProblems = mergeIsCleanAndFresh(noRegen);
  check('mutant: a regeneration that runs no generator is caught', noRegenProblems.length > 0, 'the merged manifest passed as fresh');
  // Mutant B: a failed regeneration is ignored instead of restoring the conflict.
  const failOpen = fixture('mutant-fail-open', { scriptsDir: mutate('fail-open', 'if (!failures.length) {', 'if (!failures.length || true) {') });
  divergeBroken(failOpen);
  check('mutant: a fail-open regeneration is caught', failureStaysClosed(failOpen).length > 0, 'the failure scenario passed against a driver that ignores a failed regeneration');
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} merge-driver check(s) failed:`);
  for (const failure of fails) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nOK merge-driver eval');
