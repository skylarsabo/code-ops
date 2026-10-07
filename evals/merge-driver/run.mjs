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
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
// A repository that commits has a committer. The hooks run under the caller's git, but a direct call to derived-merge.mjs reads this.
const setIdentity = (repo) => { git(repo, 'config', 'user.email', 'eval@example.com'); git(repo, 'config', 'user.name', 'Eval'); };
const read = (repo, path) => readFileSync(join(repo, path), 'utf8');
const commit = (repo, message) => { git(repo, 'add', '-A'); return git(repo, 'commit', '--no-verify', '-qm', message); };
const manifestCheck = (repo) => node(repo, 'scripts/docs-manifest.mjs', 'check');
const unmerged = (repo) => [...new Set(git(repo, 'ls-files', '-u').out.split('\n').filter(Boolean).map((line) => line.split('\t')[1]))];
const clean = (repo) => git(repo, 'status', '--porcelain').out === '';
// The domains `docs-manifest check` calls stale, one entry each.
const staleIn = (repo) => [...new Set([...manifestCheck(repo).out.matchAll(/(\S+) (?:source|content) digest is stale/g)].map((m) => m[1]))];
const placeholders = (repo) => (read(repo, MANIFEST).match(/"regenerated"/g) || []).length;

// A repository whose manifest digests depend on src/**, with the hooks and the driver installed.
// With `split`, the domains digest different files, so a merge can leave one domain unattested:
// architecture reads src/a.md, contracts reads src/c.md, and the rest read src/b.md.
const SPLIT = { architecture: ['src/a.md'], contracts: ['src/c.md'] };
function fixture(name, { install = true, scriptsDir = join(ROOT, 'scripts'), split = false } = {}) {
  const repo = join(work, name);
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  for (const file of SCRIPTS) cpSync(join(scriptsDir, file), join(repo, 'scripts', file));
  put(repo, 'scripts/atlas-check.mjs', 'process.exit(0);\n');
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  for (const hook of ['pre-commit', 'pre-push', 'pre-merge-commit', 'post-merge', 'post-rewrite']) cpSync(join(ROOT, '.githooks', hook), join(repo, '.githooks', hook));
  cpSync(join(ROOT, '.gitattributes'), join(repo, '.gitattributes'));
  for (const id of REQUIRED) put(repo, `${HUB}/40 Engineering/${id}.md`, `# ${id}\n`);
  put(repo, 'src/a.md', 'one\ntwo\nthree\n');
  put(repo, 'src/b.md', 'alpha\nbeta\ngamma\n');
  if (split) put(repo, 'src/c.md', 'x\ny\nz\n');
  put(repo, MANIFEST, `${JSON.stringify({
    version: 1, hub: HUB,
    domains: REQUIRED.map((id) => ({ id, path: `40 Engineering/${id}.md`, status: 'current', sources: (split && SPLIT[id]) || (split ? ['src/b.md'] : ['src/**']), sourceDigest: '', contentDigest: '' })),
  }, null, 2)}\n`);
  put(repo, ATLAS_MANIFEST, '{\n  "stamp": "base"\n}\n');
  put(repo, INTAKE, '{"line":"base"}\n');
  git(repo, 'init', '-q', '-b', 'main');
  setIdentity(repo);
  node(repo, 'scripts/docs-manifest.mjs', 'sync');
  commit(repo, 'seed');
  if (install) node(repo, 'scripts/install-git-hooks.mjs');
  return repo;
}

// Branch `left` and `right` each change one source file and regenerate the manifest.
function diverge(repo, { leftFile = 'src/a.md', rightFile = 'src/b.md', leftText = 'ONE\ntwo\nthree\n', rightText = 'alpha\nbeta\nGAMMA\n', sync = (cwd) => node(cwd, 'scripts/docs-manifest.mjs', 'sync') } = {}) {
  git(repo, 'checkout', '-qb', 'right');
  put(repo, rightFile, rightText);
  sync(repo);
  commit(repo, 'right');
  git(repo, 'checkout', '-q', 'main');
  git(repo, 'checkout', '-qb', 'left');
  put(repo, leftFile, leftText);
  sync(repo);
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

// The hook scenarios (S3, S4, S6, S7, S9) run the real hooks. This repository has the layout the
// pre-commit hook expects: the atlas folder and the manifest sit under code-ops-docs, the atlas domain
// reads every file outside the hub, and a canonical script is vendored into a plugin copy. The atlas
// gate is a stub that reads two flag files in .git, because evals/atlas-check covers the real gate.
const HOOKS = ['pre-commit', 'pre-push', 'pre-merge-commit', 'post-merge', 'post-rewrite'];
const AHUB = 'code-ops-docs';
const AMANIFEST = `${AHUB}/98 System/DOCS_MANIFEST.json`;
const ATLAS_DIR = `${AHUB}/98 System/Atlas`;
const ATLAS_STAMP = `${ATLAS_DIR}/MANIFEST.json`;
const ATLAS_GATE_STUB = [
  "import { existsSync } from 'node:fs';",
  "if (existsSync('.git/atlas-stale') || (process.argv.includes('--claims-gate') && existsSync('.git/claims-stale'))) {",
  "  console.error('  !! STALE core  (stub)');",
  '  process.exit(1);',
  '}',
  'process.exit(0);',
  '',
].join('\n');
function atlasFixture(name, { hooksDir = join(ROOT, '.githooks') } = {}) {
  const repo = join(work, name);
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  for (const file of [...SCRIPTS, 'sync-vendored.mjs']) cpSync(join(ROOT, 'scripts', file), join(repo, 'scripts', file));
  put(repo, 'scripts/atlas-check.mjs', ATLAS_GATE_STUB);
  for (const build of ['build-codex-marketplace.mjs', 'build-opencode-dist.mjs']) put(repo, `scripts/${build}`, 'process.exit(0);\n');
  // The renderers are stubs, but the hook stages the paths they write, so those paths must exist.
  for (const path of ['.agents/plugins/marketplace.json', 'codex-marketplace/stub.txt', 'opencode-dist/stub.txt']) put(repo, path, 'stub\n');
  put(repo, 'scripts/vendored-manifest.mjs', "export const RUNTIME_SCRIPTS = [{ name: 'tool.mjs', plugins: ['pa'] }];\n");
  put(repo, 'scripts/tool.mjs', 'export const v = 1;\n');
  put(repo, 'plugins/pa/scripts/tool.mjs', 'export const v = 1;\n');
  mkdirSync(join(repo, '.githooks'), { recursive: true });
  for (const hook of HOOKS) cpSync(join(hooksDir, hook), join(repo, '.githooks', hook));
  cpSync(join(ROOT, '.gitattributes'), join(repo, '.gitattributes'));
  for (const id of REQUIRED) put(repo, `${AHUB}/40 Engineering/${id}.md`, `# ${id}\n`);
  put(repo, `${ATLAS_DIR}/sections/core.md`, '# core\n');
  put(repo, ATLAS_STAMP, '{\n  "stamp": "base"\n}\n');
  put(repo, 'src/a.md', 'one\ntwo\nthree\n');
  put(repo, 'src/b.md', 'alpha\nbeta\ngamma\n');
  put(repo, AMANIFEST, `${JSON.stringify({
    version: 1, hub: AHUB,
    domains: REQUIRED.map((id) => (id === 'atlas'
      ? { id, path: '98 System/Atlas', status: 'current', sources: ['**'], sourceDigest: '', contentDigest: '' }
      : { id, path: `40 Engineering/${id}.md`, status: 'current', sources: ['src/**'], sourceDigest: '', contentDigest: '' })),
  }, null, 2)}\n`);
  git(repo, 'init', '-q', '-b', 'main');
  setIdentity(repo);
  node(repo, 'scripts/docs-manifest.mjs', 'sync');
  commit(repo, 'seed');
  node(repo, 'scripts/install-git-hooks.mjs');
  return repo;
}
// Run git with extra environment, for the off switch.
const gitWith = (cwd, env, ...args) => {
  const result = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  return { status: result.status ?? 1, out: `${result.stdout || ''}${result.stderr || ''}`.trim() };
};
const stampAtlas = (repo, value = 'stamped') => put(repo, ATLAS_STAMP, `{\n  "stamp": "${value}"\n}\n`);
const domainsAt = (repo, rev) => Object.fromEntries(JSON.parse(git(repo, 'show', `${rev}:${AMANIFEST}`).out).domains.map((domain) => [domain.id, domain]));
// True when the staged manifest is the one HEAD holds, so the hook stamped nothing.
const manifestUnstamped = (repo) => git(repo, 'diff', '--cached', '--quiet', 'HEAD', '--', AMANIFEST).status === 0;
// A hook set with one line of pre-commit broken, for the mutant checks.
function mutateHook(name, from, to) {
  const dir = join(work, `mutant-hook-${name}`);
  mkdirSync(dir, { recursive: true });
  for (const hook of HOOKS) cpSync(join(ROOT, '.githooks', hook), join(dir, hook));
  const source = readFileSync(join(dir, 'pre-commit'), 'utf8');
  if (!source.includes(from)) throw new Error(`hook mutant ${name}: anchor not found, the eval is stale`);
  writeFileSync(join(dir, 'pre-commit'), source.replace(from, () => to));
  return dir;
}
// Stage a canonical script change and an atlas stamp, but not the vendored copy the hook must refresh.
function stageRevendor(repo) {
  put(repo, 'scripts/tool.mjs', 'export const v = 2;\n');
  stampAtlas(repo);
  git(repo, 'add', 'scripts/tool.mjs', ATLAS_DIR);
  return git(repo, 'commit', '-qm', 'script change with a stamp');
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

  // 2b. core.hooksPath may name this checkout's .githooks by absolute path, in the short or the long
  // spelling of a Windows temp folder. That is ours: it passes --check, install leaves it alone, and
  // the driver still registers. A path that resolves elsewhere is foreign.
  const hooksPath = (repo) => git(repo, 'config', '--local', '--get', 'core.hooksPath').out;
  for (const [label, spell] of [['absolute path', (p) => p], ['canonical absolute path', (p) => realpathSync.native(p)]]) {
    const abs = fixture(`abs-${label.split(' ')[0]}`, { install: false });
    const value = spell(join(abs, '.githooks'));
    git(abs, 'config', '--local', 'core.hooksPath', value);
    const installed = node(abs, 'scripts/install-git-hooks.mjs');
    const verdict = node(abs, 'scripts/install-git-hooks.mjs', '--check');
    check(`hooksPath (${label}): install succeeds, --check passes, the value is unchanged`, installed.status === 0 && verdict.status === 0 && hooksPath(abs) === value, `${installed.status}/${verdict.status} ${installed.out.slice(-120)} / ${verdict.out.slice(-120)} / ${hooksPath(abs)}`);
    check(`hooksPath (${label}): the merge driver is registered`, git(abs, 'config', '--local', '--get', 'merge.code-ops-derived.driver').out.includes('derived-merge.mjs'), git(abs, 'config', '--local', '--get-regexp', '^merge\\.').out);
  }
  const foreign = fixture('foreign-hooks', { install: false });
  const elsewhere = join(work, 'other-hooks');
  mkdirSync(elsewhere, { recursive: true });
  git(foreign, 'config', '--local', 'core.hooksPath', elsewhere);
  const foreignCheck = node(foreign, 'scripts/install-git-hooks.mjs', '--check');
  const foreignInstall = node(foreign, 'scripts/install-git-hooks.mjs');
  check('hooksPath (elsewhere): --check fails, install exits 2 without --force, the value is unchanged', foreignCheck.status === 1 && foreignInstall.status === 2 && hooksPath(foreign) === elsewhere, `${foreignCheck.status}/${foreignInstall.status} / ${hooksPath(foreign)}`);
  const missing = fixture('missing-hooks', { install: false });
  git(missing, 'config', '--local', 'core.hooksPath', join(work, 'no-such-folder'));
  check('hooksPath (nonexistent): --check fails without throwing', node(missing, 'scripts/install-git-hooks.mjs', '--check').status === 1);

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
  // The generators read the index, so the fix is staged before the retry.
  put(broken, `${HUB}/40 Engineering/missing.md`, '# missing\n');
  git(broken, 'add', '-A');
  const retry = node(broken, 'scripts/derived-merge.mjs', 'regenerate');
  check('regeneration failure: after the fix, regenerate resolves the conflict', retry.status === 0 && !unmerged(broken).length, retry.out.slice(-200));
  // The repointed domain had no correct digests at the right tip, so no side attested it (S5).
  check('regeneration failure: the repointed domain is named as unattested', /left stale/.test(retry.out) && /architecture/.test(retry.out), retry.out.slice(-300));
  const refused = git(broken, 'commit', '--no-edit');
  check('regeneration failure: the commit is refused until a person stamps the domain', refused.status !== 0 && staleIn(broken).join() === 'architecture', `${refused.status} ${staleIn(broken).join()} ${refused.out.slice(-160)}`);
  node(broken, 'scripts/docs-manifest.mjs', 'sync');
  git(broken, 'add', '-A');
  const done = git(broken, 'commit', '--no-edit');
  check('regeneration failure: after a deliberate sync the merge commits with a fresh manifest', done.status === 0 && manifestCheck(broken).status === 0, done.out.slice(-200));

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

  // 7b. An adopter runs the driver from a plugin cache outside the repository and merges inside a
  // linked worktree nested under it. Git runs the driver from that worktree's top level and every
  // worktree shares one config, so only an absolute path reaches the script from there.
  let adopters = 0;
  const adopterMerge = (scriptsDir, preMerge = 'regenerate --amend-after') => {
    const name = `adopter-${adopters++}`;
    const repo = fixture(name, { install: false, scriptsDir });
    const cache = join(work, `${name} plugin cache`, 'scripts');
    cpSync(join(repo, 'scripts'), cache, { recursive: true });
    rmSync(join(repo, 'scripts'), { recursive: true, force: true });
    const self = `node "${join(cache, 'derived-merge.mjs').split('\\').join('/')}"`;
    for (const [hook, command] of [['pre-commit', 'regenerate'], ['pre-merge-commit', preMerge], ['post-merge', 'amend']]) put(repo, `.githooks/${hook}`, `#!/bin/sh\n${self} ${command}\n`);
    put(repo, '.gitignore', '.claude/\n');
    commit(repo, 'adopter layout');
    git(repo, 'config', 'core.hooksPath', '.githooks');
    const installed = node(repo, join(cache, 'derived-merge.mjs'), 'install');
    commit(repo, 'driver attributes');
    diverge(repo, { sync: (cwd) => node(cwd, join(cache, 'docs-manifest.mjs'), 'sync') });
    git(repo, 'checkout', '-q', 'main');
    const tree = join(repo, '.claude', 'worktrees', 'nested');
    git(repo, 'worktree', 'add', '-q', tree, 'left');
    const merge = git(tree, 'merge', '--no-edit', 'right');
    const fresh = node(tree, join(cache, 'docs-manifest.mjs'), 'check');
    return { repo, tree, cache, installed, merge, fresh };
  };
  const adopter = adopterMerge(join(ROOT, 'scripts'));
  check('adopter worktree: install registers the driver', adopter.installed.status === 0, adopter.installed.out.slice(-200));
  check('adopter worktree: the driver runs, with no MODULE_NOT_FOUND', adopter.merge.status === 0 && !/MODULE_NOT_FOUND|Cannot find module/.test(adopter.merge.out), adopter.merge.out.slice(-300));
  check('adopter worktree: the merge leaves no conflict and a fresh manifest', !unmerged(adopter.tree).length && adopter.fresh.status === 0 && !read(adopter.tree, MANIFEST).includes('"regenerated"'), `unmerged: ${unmerged(adopter.tree).join() || 'none'} / ${adopter.fresh.out.slice(0, 160)}`);
  const adopterCheck = (cwd) => node(cwd, join(adopter.cache, 'derived-merge.mjs'), 'check');
  check('adopter check: passes from the main checkout and from the worktree', adopterCheck(adopter.repo).status === 0 && adopterCheck(adopter.tree).status === 0, `${adopterCheck(adopter.repo).out} / ${adopterCheck(adopter.tree).out}`);

  // 7c. check resolves the registered script. A missing file or a relative path fails it loudly.
  const setDriver = (value) => git(adopter.repo, 'config', '--local', 'merge.code-ops-derived.driver', value);
  setDriver(`node "${join(work, 'gone', 'derived-merge.mjs').split('\\').join('/')}" driver %O %A %B %P`);
  const goneCheck = adopterCheck(adopter.tree);
  check('check: a registered script that does not exist fails and names the path', goneCheck.status === 1 && /does not exist/.test(goneCheck.out) && goneCheck.out.includes('gone/derived-merge.mjs'), goneCheck.out);
  setDriver('node ../../../scripts/derived-merge.mjs driver %O %A %B %P');
  const relativeCheck = adopterCheck(adopter.repo);
  check('check: a relative driver path fails', relativeCheck.status === 1 && /not a quoted absolute path/.test(relativeCheck.out), relativeCheck.out);

  // 7d. S8: a host tool that runs `git merge` in a linked worktree reaches the hooks through the
  // shared .githooks path. With reconcile as the merge hook, git names the merged head only in
  // GITHEAD_<sha>, and the merge commit still ends up with fresh digests.
  const viaWorktree = adopterMerge(join(ROOT, 'scripts'), 'reconcile --amend-after');
  check('S8 worktree: reconcile restamps the merge and post-merge folds it into the commit', viaWorktree.merge.status === 0 && viaWorktree.fresh.status === 0 && !placeholders(viaWorktree.tree) && clean(viaWorktree.tree), `${viaWorktree.merge.out.slice(-200)} / ${viaWorktree.fresh.out.slice(0, 160)}`);
  check('S8 worktree: HEAD holds the restamped manifest', git(viaWorktree.tree, 'diff', '--quiet', 'HEAD', '--', MANIFEST).status === 0, git(viaWorktree.tree, 'status', '--porcelain').out);

  // 9. S1: both sides changed the manifest, and the PR stamped only one of the two domains it touched.
  // The merge restamps what both sides attested and leaves the unstamped domain stale and refused.
  const s1 = (repo) => {
    const problems = [];
    git(repo, 'checkout', '-qb', 'right');
    put(repo, 'src/b.md', 'alpha\nbeta\nGAMMA\n');
    node(repo, 'scripts/docs-manifest.mjs', 'sync');
    commit(repo, 'right');
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'checkout', '-qb', 'left');
    put(repo, 'src/a.md', 'ONE\ntwo\nthree\n');
    put(repo, 'src/c.md', 'X\ny\nz\n');
    node(repo, 'scripts/docs-manifest.mjs', 'sync', '--only', 'contracts');
    commit(repo, 'left stamps contracts and skips architecture');
    const merge = git(repo, 'merge', '--no-edit', 'right');
    if (merge.status === 0) problems.push('the merge committed a stale domain');
    if (staleIn(repo).join() !== 'architecture') problems.push(`stale domains: ${staleIn(repo).join() || 'none'}`);
    if (placeholders(repo) !== 2) problems.push(`${placeholders(repo)} placeholder digests, expected the 2 of architecture`);
    if (!/left stale/.test(merge.out) || !/architecture/.test(merge.out) || !/docs-manifest\.mjs sync/.test(merge.out)) problems.push(`the refusal lacks the domain or the fix: ${merge.out.slice(-240)}`);
    return problems;
  };
  const s1Repo = fixture('s1-unattested', { split: true });
  const s1Problems = s1(s1Repo);
  check('S1: only the domain the PR left unstamped stays stale, and the commit is refused', s1Problems.length === 0, s1Problems.join('; '));
  node(s1Repo, 'scripts/docs-manifest.mjs', 'sync');
  git(s1Repo, 'add', '-A');
  const s1Done = git(s1Repo, 'commit', '--no-edit');
  check('S1: a deliberate sync then lets the merge commit', s1Done.status === 0 && manifestCheck(s1Repo).status === 0 && git(s1Repo, 'rev-list', '--parents', '-n1', 'HEAD').out.split(' ').length === 3, s1Done.out.slice(-200));

  // 10. S2: reconcile restamps through MERGE_HEAD when the merge has stopped before its commit.
  const s2 = fixture('s2-reconcile', { split: true });
  diverge(s2, { leftFile: 'src/a.md', rightFile: 'src/b.md' });
  const stopped = git(s2, 'merge', '--no-commit', '--no-ff', 'right');
  const reconciled = node(s2, 'scripts/derived-merge.mjs', 'reconcile');
  check('S2: reconcile restamps the stopped merge from MERGE_HEAD', stopped.status === 0 && reconciled.status === 0 && manifestCheck(s2).status === 0 && !placeholders(s2) && git(s2, 'diff', '--quiet', '--', MANIFEST).status === 0, `${stopped.out.slice(-120)} / ${reconciled.out.slice(-160)} / ${manifestCheck(s2).out.slice(0, 120)}`);
  const s2Commit = git(s2, 'commit', '--no-edit');
  check('S2: the stopped merge then commits with a fresh manifest', s2Commit.status === 0 && manifestCheck(s2).status === 0 && clean(s2), s2Commit.out.slice(-200));
  const off = fixture('s2-off', { split: true });
  diverge(off, { leftFile: 'src/a.md', rightFile: 'src/b.md' });
  git(off, 'merge', '--no-commit', '--no-ff', 'right');
  const offRun = spawnSync(process.execPath, ['scripts/derived-merge.mjs', 'reconcile'], { cwd: off, encoding: 'utf8', env: { ...process.env, CODE_OPS_DIGEST_AUTOFIX: 'off' } });
  check('S2: CODE_OPS_DIGEST_AUTOFIX=off leaves the manifest as the merge wrote it', offRun.status === 0 && placeholders(off) > 0, `${offRun.status} ${placeholders(off)}`);

  // 10b. A one-sided merge never calls the driver. The merge hook runs reconcile, which names the
  // parents it attested against, so it saw both through GITHEAD_<sha>. The PR's own stale domain
  // stays stale (S5): no side stamps it by machine.
  const oneSided = (repo, leftWork) => {
    git(repo, 'checkout', '-qb', 'right');
    put(repo, 'src/b.md', 'alpha\nbeta\nGAMMA\n');
    node(repo, 'scripts/docs-manifest.mjs', 'sync');
    commit(repo, 'right');
    const rightTip = git(repo, 'rev-parse', 'HEAD').out;
    git(repo, 'checkout', '-q', 'main');
    git(repo, 'checkout', '-qb', 'left');
    leftWork();
    commit(repo, 'left');
    const leftTip = git(repo, 'rev-parse', 'HEAD').out;
    return { merge: git(repo, 'merge', '--no-edit', 'right'), leftTip, rightTip };
  };
  const stale1 = fixture('s2-one-sided-stale', { split: true });
  const staleRun = oneSided(stale1, () => put(stale1, 'src/a.md', 'ONE\ntwo\nthree\n'));
  check('S5: a one-sided merge leaves the PR\'s unstamped domain stale and names it', staleIn(stale1).join() === 'architecture' && /left stale/.test(staleRun.merge.out) && /architecture/.test(staleRun.merge.out), `${staleIn(stale1).join()} / ${staleRun.merge.out.slice(-240)}`);
  check('S2: the reconcile hook attested against both parents', staleRun.merge.out.includes(staleRun.leftTip) && staleRun.merge.out.includes(staleRun.rightTip), staleRun.merge.out.slice(-300));
  const fresh1 = fixture('s2-one-sided-fresh', { split: true });
  const freshRun = oneSided(fresh1, () => put(fresh1, 'notes/readme.md', 'unrelated\n'));
  check('S2: a one-sided merge with nothing to restamp commits fresh and clean', freshRun.merge.status === 0 && manifestCheck(fresh1).status === 0 && clean(fresh1) && !/left stale/.test(freshRun.merge.out), freshRun.merge.out.slice(-200));

  // 11. rewrite: a rebase takes one side of the manifest, so the tip is stale. rewrite attests against
  // the old tip and the new base, then amends the tip with the manifest alone.
  const rw = fixture('rewrite');
  diverge(rw);
  const oldTip = git(rw, 'rev-parse', 'HEAD').out;
  const baseTip = git(rw, 'rev-parse', 'right').out;
  git(rw, 'rebase', 'right');
  git(rw, 'checkout', '--ours', '--', MANIFEST);
  git(rw, 'add', MANIFEST);
  const resumed = git(rw, '-c', 'core.hooksPath=.nohooks', '-c', 'core.editor=true', 'rebase', '--continue');
  const rebasedTip = git(rw, 'rev-parse', 'HEAD').out;
  check('rewrite: the rebase ends with a stale manifest', resumed.status === 0 && manifestCheck(rw).status !== 0, `${resumed.status} ${resumed.out.slice(-160)}`);
  const rewriteArgs = ['scripts/derived-merge.mjs', 'rewrite', '--old', oldTip, '--base', baseTip, '--amend'];
  const original = read(rw, MANIFEST);
  put(rw, MANIFEST, `${original} `);
  const dirty = node(rw, ...rewriteArgs);
  check('rewrite: a manifest with unstaged edits is left alone and the command is printed', dirty.status === 0 && read(rw, MANIFEST) === `${original} ` && git(rw, 'rev-parse', 'HEAD').out === rebasedTip && dirty.out.includes('rewrite --old'), dirty.out.slice(-240));
  put(rw, MANIFEST, original);
  const rewritten = node(rw, ...rewriteArgs);
  check('rewrite: the manifest is restamped, fresh, and committed into the tip', rewritten.status === 0 && manifestCheck(rw).status === 0 && clean(rw), `${rewritten.status} ${rewritten.out.slice(-240)}`);
  check('rewrite: the tip differs from the rebased tip by the manifest only, on the same parent and subject', git(rw, 'diff', '--name-only', rebasedTip, 'HEAD').out === MANIFEST && git(rw, 'rev-parse', 'HEAD^').out === baseTip && git(rw, 'log', '-1', '--format=%s').out === 'left', git(rw, 'diff', '--name-only', rebasedTip, 'HEAD').out);
  const rwStale = fixture('rewrite-unattested', { split: true });
  git(rwStale, 'checkout', '-qb', 'right');
  put(rwStale, 'src/b.md', 'alpha\nbeta\nGAMMA\n');
  node(rwStale, 'scripts/docs-manifest.mjs', 'sync');
  commit(rwStale, 'right');
  git(rwStale, 'checkout', '-q', 'main');
  git(rwStale, 'checkout', '-qb', 'left');
  put(rwStale, 'src/a.md', 'ONE\ntwo\nthree\n');
  commit(rwStale, 'left skips the stamp');
  const staleOld = git(rwStale, 'rev-parse', 'HEAD').out;
  git(rwStale, 'rebase', 'right');
  const staleTip = git(rwStale, 'rev-parse', 'HEAD').out;
  const refusedRewrite = node(rwStale, 'scripts/derived-merge.mjs', 'rewrite', '--old', staleOld, '--base', git(rwStale, 'rev-parse', 'right').out, '--amend');
  check('rewrite: a domain the PR never stamped stays stale, HEAD and the manifest are untouched', refusedRewrite.status === 1 && /left stale/.test(refusedRewrite.out) && git(rwStale, 'rev-parse', 'HEAD').out === staleTip && clean(rwStale), `${refusedRewrite.status} ${refusedRewrite.out.slice(-240)}`);

  // 12. S4: the author stamps an atlas section after the manifest sync, so only the atlas content digest
  // is stale. The pre-commit hook restamps that digest and nothing else, and the commit passes.
  const c2 = atlasFixture('class2');
  stampAtlas(c2);
  git(c2, 'add', '-A');
  const c2Commit = git(c2, 'commit', '-qm', 'stamp an atlas section');
  const c2Before = domainsAt(c2, 'HEAD~1');
  const c2After = domainsAt(c2, 'HEAD');
  const onlyAtlasContent = Object.keys(c2Before).every((id) => (id === 'atlas'
    ? c2Before[id].sourceDigest === c2After[id].sourceDigest && c2Before[id].contentDigest !== c2After[id].contentDigest
    : JSON.stringify(c2Before[id]) === JSON.stringify(c2After[id])));
  check('S4: a stamp committed after the manifest sync restamps the atlas content digest only, and the commit passes', c2Commit.status === 0 && onlyAtlasContent && manifestCheck(c2).status === 0 && clean(c2) && /Restamped the atlas content digest/.test(c2Commit.out), `${c2Commit.status} ${c2Commit.out.slice(-240)} / ${manifestCheck(c2).out.slice(0, 120)}`);
  check('S4: the commit holds the stamp and the manifest and nothing else', git(c2, 'diff', '--name-only', 'HEAD~1', 'HEAD').out.split('\n').sort().join() === [ATLAS_STAMP, AMANIFEST].sort().join(), git(c2, 'diff', '--name-only', 'HEAD~1', 'HEAD').out);

  // 12b. Class 3: a source edit with no manifest sync stays refused, and the hook stamps nothing.
  // The printed remedy (sync --index, then git add the manifest) then lets the commit through.
  const c3 = atlasFixture('class3');
  put(c3, 'src/a.md', 'EDITED\ntwo\nthree\n');
  stampAtlas(c3);
  git(c3, 'add', '-A');
  const c3Commit = git(c3, 'commit', '-qm', 'source edit without a sync');
  check('class 3: a source edit without a sync is refused with the index remedy, and the manifest is not stamped', c3Commit.status !== 0 && manifestUnstamped(c3) && /docs-manifest\.mjs sync --index/.test(c3Commit.out) && !/Restamped/.test(c3Commit.out), `${c3Commit.status} ${c3Commit.out.slice(-300)}`);
  node(c3, 'scripts/docs-manifest.mjs', 'sync', '--index');
  git(c3, 'add', AMANIFEST);
  const c3Retry = git(c3, 'commit', '-qm', 'source edit with a sync');
  check('class 3: after sync --index and git add the commit passes with a fresh manifest', c3Retry.status === 0 && manifestCheck(c3).status === 0 && clean(c3), `${c3Retry.status} ${c3Retry.out.slice(-240)}`);

  // 12c. S4 with a re-vendor: the hook refreshes a plugin copy the atlas domain reads, so the atlas
  // source digest is stale too. That is not the class 2 case, so the hook refuses and stamps nothing.
  const rv = atlasFixture('revendor');
  const rvCommit = stageRevendor(rv);
  check('S4: a staged script change the hook re-vendors is refused, not laundered into a stamp', rvCommit.status !== 0 && manifestUnstamped(rv) && !/Restamped/.test(rvCommit.out) && git(rv, 'diff', '--cached', '--name-only').out.split('\n').includes('plugins/pa/scripts/tool.mjs'), `${rvCommit.status} ${rvCommit.out.slice(-300)} / ${git(rv, 'diff', '--cached', '--name-only').out}`);
  node(rv, 'scripts/docs-manifest.mjs', 'sync', '--index');
  git(rv, 'add', AMANIFEST);
  const rvRetry = git(rv, 'commit', '-qm', 'script change with a stamp and a sync');
  check('S4: sync --index hashes the re-vendored copy the hook staged, so the retry passes', rvRetry.status === 0 && manifestCheck(rv).status === 0 && clean(rv), `${rvRetry.status} ${rvRetry.out.slice(-240)} / ${manifestCheck(rv).out.slice(0, 120)}`);

  // 12d. S9: an atlas section is STALE, or a claim no longer sits on its code. The hook stamps nothing,
  // refuses the commit, and prints the section's stamp command.
  const gateStale = atlasFixture('gate-stale');
  stampAtlas(gateStale);
  git(gateStale, 'add', '-A');
  writeFileSync(join(gateStale, '.git', 'atlas-stale'), '');
  const gateCommit = git(gateStale, 'commit', '-qm', 'stamp with a stale section');
  check('S9: a failing atlas gate refuses the commit, names the stamp command, and stamps nothing', gateCommit.status !== 0 && manifestUnstamped(gateStale) && /atlas-check\.mjs stamp --atlas .* --section core/.test(gateCommit.out) && !/Restamped/.test(gateCommit.out), `${gateCommit.status} ${gateCommit.out.slice(-300)}`);
  const claimsStale = atlasFixture('claims-stale');
  stampAtlas(claimsStale);
  git(claimsStale, 'add', '-A');
  writeFileSync(join(claimsStale, '.git', 'claims-stale'), '');
  const claimsCommit = git(claimsStale, 'commit', '-qm', 'stamp with an unfresh claim');
  check('S9: a passing atlas gate with a failing claims gate still refuses and stamps nothing', claimsCommit.status !== 0 && manifestUnstamped(claimsStale) && !/Restamped/.test(claimsCommit.out), `${claimsCommit.status} ${claimsCommit.out.slice(-300)}`);

  // 12e. S6: a manifest with unstaged edits is never restamped, because the tool writes the working
  // file and git add stages it whole. The hook refuses and leaves the working file alone.
  const dirtyRepo = atlasFixture('dirty-manifest');
  stampAtlas(dirtyRepo);
  const dirtyText = `${read(dirtyRepo, AMANIFEST)} `;
  put(dirtyRepo, AMANIFEST, dirtyText);
  git(dirtyRepo, 'add', '--', ATLAS_STAMP);
  const dirtyCommit = git(dirtyRepo, 'commit', '-qm', 'stamp with a dirty manifest');
  check('S6: a manifest with unstaged edits is not restamped, and the working file is untouched', dirtyCommit.status !== 0 && manifestUnstamped(dirtyRepo) && read(dirtyRepo, AMANIFEST) === dirtyText && !/Restamped/.test(dirtyCommit.out), `${dirtyCommit.status} ${dirtyCommit.out.slice(-240)}`);

  // 12f. CODE_OPS_DIGEST_AUTOFIX=off restores the earlier behavior: the hook neither checks nor stamps.
  const offRepo = atlasFixture('autofix-off');
  stampAtlas(offRepo);
  git(offRepo, 'add', '-A');
  const offCommit = gitWith(offRepo, { CODE_OPS_DIGEST_AUTOFIX: 'off' }, 'commit', '-qm', 'stamp with the autofix off');
  check('autofix off: the stamp commits and the atlas content digest is left stale', offCommit.status === 0 && manifestCheck(offRepo).status !== 0 && /atlas content digest is stale/.test(manifestCheck(offRepo).out), `${offCommit.status} ${manifestCheck(offRepo).out.slice(0, 160)}`);

  // 12g. A commit made partway through a rebase sees an intermediate manifest, so the atlas trigger skips it.
  const midRepo = atlasFixture('mid-rebase');
  git(midRepo, 'checkout', '-qb', 'topic');
  stampAtlas(midRepo, 'topic');
  put(midRepo, 'src/a.md', 'TOPIC\ntwo\nthree\n');
  node(midRepo, 'scripts/docs-manifest.mjs', 'sync');
  commit(midRepo, 'topic');
  git(midRepo, 'checkout', '-q', 'main');
  put(midRepo, 'src/a.md', 'MAIN\ntwo\nthree\n');
  node(midRepo, 'scripts/docs-manifest.mjs', 'sync');
  commit(midRepo, 'main moved');
  git(midRepo, 'checkout', '-q', 'topic');
  git(midRepo, 'rebase', 'main');
  put(midRepo, 'src/a.md', 'RESOLVED\ntwo\nthree\n');
  git(midRepo, 'checkout', '--ours', '--', AMANIFEST);
  git(midRepo, 'add', '-A');
  const midContinue = git(midRepo, '-c', 'core.editor=true', 'rebase', '--continue');
  check('rebase: a conflict commit that stages atlas files is not refused for an intermediate manifest', midContinue.status === 0 && git(midRepo, 'rev-list', '--count', 'main..HEAD').out === '1', `${midContinue.status} ${midContinue.out.slice(-300)}`);

  // 13. S3: a rebase takes one side of the manifest and runs no merge driver. post-rewrite restamps what
  // the old tip and the new base both attested, and amends the tip with the manifest alone.
  const hookRebase = fixture('hook-rebase');
  diverge(hookRebase);
  const hrBase = git(hookRebase, 'rev-parse', 'right').out;
  git(hookRebase, 'rebase', 'right');
  git(hookRebase, 'checkout', '--ours', '--', MANIFEST);
  git(hookRebase, 'add', MANIFEST);
  const hrDone = git(hookRebase, '-c', 'core.editor=true', 'rebase', '--continue');
  check('S3: the rebase ends with a fresh manifest, amended into the tip', hrDone.status === 0 && manifestCheck(hookRebase).status === 0 && clean(hookRebase) && /amended HEAD/.test(hrDone.out), `${hrDone.status} ${hrDone.out.slice(-300)} / ${manifestCheck(hookRebase).out.slice(0, 120)}`);
  check('S3: the tip is one commit on the new base with its own subject and files', git(hookRebase, 'rev-parse', 'HEAD^').out === hrBase && git(hookRebase, 'log', '-1', '--format=%s').out === 'left' && git(hookRebase, 'diff', '--name-only', 'HEAD^', 'HEAD').out.split('\n').sort().join() === ['src/a.md', MANIFEST].sort().join(), git(hookRebase, 'diff', '--name-only', 'HEAD^', 'HEAD').out);
  const hookRebaseOff = fixture('hook-rebase-off');
  diverge(hookRebaseOff);
  const offEnv = { CODE_OPS_DIGEST_AUTOFIX: 'off' };
  gitWith(hookRebaseOff, offEnv, 'rebase', 'right');
  git(hookRebaseOff, 'checkout', '--ours', '--', MANIFEST);
  git(hookRebaseOff, 'add', MANIFEST);
  gitWith(hookRebaseOff, offEnv, '-c', 'core.editor=true', 'rebase', '--continue');
  check('S3: CODE_OPS_DIGEST_AUTOFIX=off leaves the rebased manifest stale', manifestCheck(hookRebaseOff).status !== 0, manifestCheck(hookRebaseOff).out.slice(0, 120));
  const hookRebaseStale = fixture('hook-rebase-unattested', { split: true });
  git(hookRebaseStale, 'checkout', '-qb', 'right');
  put(hookRebaseStale, 'src/b.md', 'alpha\nbeta\nGAMMA\n');
  node(hookRebaseStale, 'scripts/docs-manifest.mjs', 'sync');
  commit(hookRebaseStale, 'right');
  git(hookRebaseStale, 'checkout', '-q', 'main');
  git(hookRebaseStale, 'checkout', '-qb', 'left');
  put(hookRebaseStale, 'src/a.md', 'ONE\ntwo\nthree\n');
  commit(hookRebaseStale, 'left skips the stamp');
  const hrsRebase = git(hookRebaseStale, 'rebase', 'right');
  check('S3: a domain the PR never stamped stays stale after the rebase, which still completes', hrsRebase.status === 0 && staleIn(hookRebaseStale).join() === 'architecture' && /left stale/.test(hrsRebase.out) && clean(hookRebaseStale), `${hrsRebase.status} ${staleIn(hookRebaseStale).join()} ${hrsRebase.out.slice(-240)}`);

  // 13b. S7: main took the first commit of the branch as a squash, and the rest replays onto main with
  // rebase --onto. The old tip still holds its own attested tree, and the new base is main.
  const squash = fixture('hook-squash');
  git(squash, 'checkout', '-qb', 'pr');
  put(squash, 'src/a.md', 'ONE\ntwo\nthree\n');
  node(squash, 'scripts/docs-manifest.mjs', 'sync');
  commit(squash, 'pr one');
  const prOne = git(squash, 'rev-parse', 'HEAD').out;
  put(squash, 'src/a.md', 'ONE\nTWO\nthree\n');
  node(squash, 'scripts/docs-manifest.mjs', 'sync');
  commit(squash, 'pr two');
  git(squash, 'checkout', '-q', 'main');
  put(squash, 'src/a.md', 'ONE\ntwo\nthree\n');
  put(squash, 'src/b.md', 'alpha\nbeta\nGAMMA\n');
  node(squash, 'scripts/docs-manifest.mjs', 'sync');
  commit(squash, 'squash of pr one, plus main work');
  const mainTip = git(squash, 'rev-parse', 'main').out;
  git(squash, 'checkout', '-q', 'pr');
  git(squash, 'rebase', '--onto', 'main', prOne, 'pr');
  git(squash, 'checkout', '--ours', '--', MANIFEST);
  git(squash, 'add', MANIFEST);
  const squashDone = git(squash, '-c', 'core.editor=true', 'rebase', '--continue');
  check('S7: rebase --onto after a squash ends with a fresh manifest on the squashed base', squashDone.status === 0 && manifestCheck(squash).status === 0 && clean(squash) && git(squash, 'rev-parse', 'HEAD^').out === mainTip, `${squashDone.status} ${squashDone.out.slice(-300)} / ${manifestCheck(squash).out.slice(0, 120)}`);

  // 12h. The freshness checks run once, at the end of the hook, after the merge regeneration and every
  // other write. With the autofix off, nothing else triggers them on a driver merge, so the merge must
  // still be refused when the atlas gate fails.
  const lateCheck = atlasFixture('late-check');
  diverge(lateCheck);
  writeFileSync(join(lateCheck, '.git', 'atlas-stale'), '');
  const lateTip = git(lateCheck, 'rev-parse', 'HEAD').out;
  const lateMerge = gitWith(lateCheck, { CODE_OPS_DIGEST_AUTOFIX: 'off' }, 'merge', '--no-edit', 'right');
  check('a driver merge with the autofix off still meets the atlas gate and is refused', lateMerge.status !== 0 && git(lateCheck, 'rev-parse', 'HEAD').out === lateTip && /atlas-check --gate/.test(lateMerge.out), `${lateMerge.status} ${lateMerge.out.slice(-300)}`);

  // 14. Mutants for the hooks. Each broken hook must fail the scenario that guards it.
  const claimsMutant = atlasFixture('mutant-claims', { hooksDir: mutateHook('claims', '--gate --claims-gate) >/dev/null', '--gate) >/dev/null') });
  stampAtlas(claimsMutant);
  git(claimsMutant, 'add', '-A');
  writeFileSync(join(claimsMutant, '.git', 'claims-stale'), '');
  check('mutant: a restamp that skips the claims gate is caught', git(claimsMutant, 'commit', '-qm', 'stamp with an unfresh claim').status === 0, 'the commit was still refused');
  const sourceMutant = atlasFixture('mutant-source', { hooksDir: mutateHook('source', "= 'atlas content digest is stale' ] || return 1", ']') });
  check('mutant: a restamp that accepts a stale source digest is caught', stageRevendor(sourceMutant).status === 0, 'the commit was still refused');
  const forceMutant = atlasFixture('mutant-force', { hooksDir: mutateHook('force', '  force_check=1', '  force_check=0') });
  diverge(forceMutant);
  writeFileSync(join(forceMutant, '.git', 'atlas-stale'), '');
  check('mutant: a merge regeneration that never triggers the final check is caught', gitWith(forceMutant, { CODE_OPS_DIGEST_AUTOFIX: 'off' }, 'merge', '--no-edit', 'right').status === 0, 'the merge was still refused');

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
  const noRegen = fixture('mutant-no-regen', { scriptsDir: mutate('no-regen', "const result = spawnSync(process.execPath, [join(SCRIPTS, tool), ...args.map(", "const result = spawnSync(process.execPath, ['-e', '0', ...args.map(") });
  diverge(noRegen);
  const noRegenProblems = mergeIsCleanAndFresh(noRegen);
  check('mutant: a regeneration that runs no generator is caught', noRegenProblems.length > 0, 'the merged manifest passed as fresh');
  // Mutant B: a failed regeneration is ignored instead of restoring the conflict.
  const failOpen = fixture('mutant-fail-open', { scriptsDir: mutate('fail-open', 'if (!failures.length) {', 'if (!failures.length || true) {') });
  divergeBroken(failOpen);
  check('mutant: a fail-open regeneration is caught', failureStaysClosed(failOpen).length > 0, 'the failure scenario passed against a driver that ignores a failed regeneration');
  // Mutant C: the 2.40.0 registration, a path relative to the checkout that ran install.
  const relativeDriver = adopterMerge(mutate('relative-driver', '`node ${quote(forward(driverScript(root, scriptsDir)))} ${DRIVER_ARGS}`', '`node ${forward(relative(root, driverScript(root, scriptsDir)))} ${DRIVER_ARGS}`'));
  check('mutant: a relative driver path fails the nested-worktree merge', relativeDriver.merge.status !== 0 || unmerged(relativeDriver.tree).length > 0, relativeDriver.merge.out.slice(-200));
  // Mutant D: check trusts the registered value without looking for the file.
  const blindCheck = adopterMerge(mutate('blind-check', 'if (!existsSync(script)) return', 'if (false) return'));
  git(blindCheck.repo, 'config', '--local', 'merge.code-ops-derived.driver', `node "${join(work, 'gone', 'derived-merge.mjs').split('\\').join('/')}" driver %O %A %B %P`);
  check('mutant: a check that skips the existence test is caught', node(blindCheck.tree, join(blindCheck.cache, 'derived-merge.mjs'), 'check').status === 0, 'check still failed on a missing script');
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\n${fails.length} merge-driver check(s) failed:`);
  for (const failure of fails) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('\nOK merge-driver eval');
