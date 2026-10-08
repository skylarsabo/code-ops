#!/usr/bin/env node
// Regression eval for the plugin release-tooling scripts:
//   scripts/sync-vendored.mjs, scripts/vendored-manifest.mjs,
//   scripts/bump-plugin-version.mjs, scripts/check-plugin-bump.mjs,
//   scripts/integrate-branch.mjs (its pure, git-free exports only — see section 1f)
//
//   node evals/release-tooling/run.mjs   (exit 0 = pass)
//
// Each script resolves its own ROOT one level up from its own scripts/ dir, so every case
// builds a throwaway <case>/scripts/<script>.mjs + surrounding tree and spawns the real
// script against it — the actual repo tree is never touched.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tally } from '../harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPTS_DIR = join(REPO, 'scripts');

const { fails, check } = tally();

// Spawn the real script directly (never a shell string); capture status via the thrown
// error's .status on non-zero exit, per execFileSync semantics.
const run = (scriptPath, args, opts = {}) => {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8', timeout: 10000, ...opts });
    return { status: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
};

// -c core.autocrlf=false / core.safecrlf=false keep fixture output deterministic and quiet
// regardless of the operator's global git config (these disposable repos never leave tmpdir).
const GIT_BASE_OPTS = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
const git = (args, cwd) => execFileSync('git', [...GIT_BASE_OPTS, ...args], { cwd, timeout: 10000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
// -c commit.gpgsign=false scopes only to these disposable fixture repos (deleted at the end of
// this run) so the eval does not depend on the operator's global gpg-signing configuration.
const gitCommit = (cwd, message) =>
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval Runner', '-c', 'commit.gpgsign=false', 'commit', '-m', message], cwd);

const copyScript = (name, destDir) => {
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, name);
  writeFileSync(dest, readFileSync(join(SCRIPTS_DIR, name)));
  return dest;
};

const work = mkdtempSync(join(tmpdir(), 'coh-release-tooling-'));
try {
  // ================================================================================
  // 1a. sync-vendored.mjs
  // ================================================================================
  {
    const caseDir = join(work, 'sync-vendored');
    const scriptsDir = join(caseDir, 'scripts');
    const scriptPath = copyScript('sync-vendored.mjs', scriptsDir);
    // Minimal own manifest (not the real one) so the fixture stays self-contained.
    writeFileSync(
      join(scriptsDir, 'vendored-manifest.mjs'),
      "export const RUNTIME_SCRIPTS = [\n  { name: 'widget.mjs', plugins: ['demo-plugin'] },\n];\n"
    );
    const canonicalContent = "export const widget = 'canonical-v1';\n";
    writeFileSync(join(scriptsDir, 'widget.mjs'), canonicalContent);
    const targetDir = join(caseDir, 'plugins', 'demo-plugin', 'scripts');
    mkdirSync(targetDir, { recursive: true });
    const staleContent = "export const widget = 'stale-v0';\n";
    writeFileSync(join(targetDir, 'widget.mjs'), staleContent);
    const targetPath = join(targetDir, 'widget.mjs');

    const r1 = run(scriptPath, ['--check']);
    check('sync-vendored: --check on drifted copy exits 1', r1.status === 1);
    check('sync-vendored: --check reports a drift line', /drift:.*widget\.mjs/.test(r1.stdout));

    const r2 = run(scriptPath, []);
    check('sync-vendored: write mode exits 0', r2.status === 0);
    const afterSync = readFileSync(targetPath);
    check(
      'sync-vendored: write mode makes the vendored copy byte-identical',
      Buffer.compare(afterSync, Buffer.from(canonicalContent)) === 0
    );

    const r3 = run(scriptPath, ['--check']);
    check('sync-vendored: --check after sync exits 0', r3.status === 0);
    check("sync-vendored: --check after sync reports 'no drift'", r3.stdout.includes('no drift'));

    // --check is the only flag this script recognizes (boolean-only); it does not take a value,
    // so there is no blank-value case to probe — only unknown-flag rejection.
    const r4 = run(scriptPath, ['--bogus-flag']);
    check('sync-vendored: unknown flag exits 2', r4.status === 2);
  }

  // ================================================================================
  // 1b. vendored-manifest.mjs (the real one) — structural assertions, no lint duplication
  // ================================================================================
  {
    const manifestUrl = pathToFileURL(join(SCRIPTS_DIR, 'vendored-manifest.mjs')).href;
    const { RUNTIME_SCRIPTS } = await import(manifestUrl);
    check(
      'vendored-manifest: exports a non-empty RUNTIME_SCRIPTS array',
      Array.isArray(RUNTIME_SCRIPTS) && RUNTIME_SCRIPTS.length > 0
    );

    const badShape = [];
    const badRootScript = [];
    const badPluginCopy = [];
    for (const entry of RUNTIME_SCRIPTS) {
      const nameOk = typeof entry?.name === 'string' && entry.name.endsWith('.mjs');
      const pluginsOk = Array.isArray(entry?.plugins) && entry.plugins.length > 0 && entry.plugins.every((p) => typeof p === 'string');
      if (!nameOk || !pluginsOk) { badShape.push(JSON.stringify(entry)); continue; }
      if (!existsSync(join(SCRIPTS_DIR, entry.name))) badRootScript.push(`scripts/${entry.name}`);
      for (const p of entry.plugins) {
        const pluginCopyPath = join(REPO, 'plugins', p, 'scripts', entry.name);
        if (!existsSync(pluginCopyPath)) badPluginCopy.push(`plugins/${p}/scripts/${entry.name}`);
      }
    }
    check('vendored-manifest: every entry has a string .name ending .mjs and a non-empty string[] .plugins', badShape.length === 0);
    check('vendored-manifest: every named root script exists under scripts/', badRootScript.length === 0);
    check('vendored-manifest: every plugins/<p>/scripts/<name> path exists in the repo', badPluginCopy.length === 0);
    if (badShape.length) console.log('  bad shape: ' + badShape.join('; '));
    if (badRootScript.length) console.log('  missing root scripts: ' + badRootScript.join('; '));
    if (badPluginCopy.length) console.log('  missing plugin copies: ' + badPluginCopy.join('; '));
  }

  // ================================================================================
  // 1c. bump-plugin-version.mjs
  // ================================================================================
  {
    const buildBumpFixture = (caseName, pluginName, pluginVersion, marketplaceVersion) => {
      const caseDir = join(work, caseName);
      const scriptsDir = join(caseDir, 'scripts');
      const scriptPath = copyScript('bump-plugin-version.mjs', scriptsDir);

      const pluginDir = join(caseDir, 'plugins', pluginName);
      const claudePluginDir = join(pluginDir, '.claude-plugin');
      mkdirSync(claudePluginDir, { recursive: true });
      const pluginJsonPath = join(claudePluginDir, 'plugin.json');
      writeFileSync(pluginJsonPath, `{\n  "name": "${pluginName}",\n  "version": "${pluginVersion}",\n  "description": "eval fixture plugin"\n}\n`);

      const marketRoot = join(caseDir, '.claude-plugin');
      mkdirSync(marketRoot, { recursive: true });
      const marketplacePath = join(marketRoot, 'marketplace.json');
      writeFileSync(
        marketplacePath,
        `{\n  "name": "code-ops",\n  "plugins": [\n    {\n      "name": "${pluginName}",\n      "source": "./plugins/${pluginName}",\n      "version": "${marketplaceVersion}"\n    }\n  ]\n}\n`
      );

      const changelogPath = join(pluginDir, 'CHANGELOG.md');
      writeFileSync(changelogPath, `# ${pluginName} changelog\n\nAll notable changes.\n\n## ${pluginVersion}\n- initial release notes.\n`);

      return { scriptPath, pluginJsonPath, marketplacePath, changelogPath };
    };

    // minor bump
    {
      const f = buildBumpFixture('bump-minor', 'demo-plugin', '1.2.3', '1.2.3');
      const originalPj = readFileSync(f.pluginJsonPath, 'utf8');
      const originalMkt = readFileSync(f.marketplacePath, 'utf8');
      const r = run(f.scriptPath, ['demo-plugin', 'minor']);
      check('bump-plugin-version: minor bump exits 0', r.status === 0);
      const pj = readFileSync(f.pluginJsonPath, 'utf8');
      check(
        'bump-plugin-version: minor bump swaps only the version value in plugin.json (indentation/formatting untouched)',
        pj === originalPj.replace('"version": "1.2.3"', '"version": "1.3.0"')
      );
      const mkt = readFileSync(f.marketplacePath, 'utf8');
      check(
        'bump-plugin-version: minor bump swaps only the version value in marketplace.json',
        mkt === originalMkt.replace('"version": "1.2.3"', '"version": "1.3.0"')
      );
      const cl = readFileSync(f.changelogPath, 'utf8');
      check(
        'bump-plugin-version: CHANGELOG gains a "## 1.3.0" section with a TODO stub',
        cl.includes('## 1.3.0\n- **TODO** — describe the change.\n')
      );
      const idxNew = cl.indexOf('## 1.3.0');
      const idxOld = cl.indexOf('## 1.2.3');
      check('bump-plugin-version: new CHANGELOG section sits above the old one', idxNew !== -1 && idxOld !== -1 && idxNew < idxOld);
    }

    // explicit X.Y.Z bump
    {
      const f = buildBumpFixture('bump-explicit', 'demo-plugin', '1.2.3', '1.2.3');
      const originalPj = readFileSync(f.pluginJsonPath, 'utf8');
      const r = run(f.scriptPath, ['demo-plugin', '2.0.0']);
      check('bump-plugin-version: explicit X.Y.Z bump exits 0', r.status === 0);
      const pj = readFileSync(f.pluginJsonPath, 'utf8');
      check('bump-plugin-version: explicit X.Y.Z bump sets that exact version', pj === originalPj.replace('"version": "1.2.3"', '"version": "2.0.0"'));
    }

    // the target version already has a CHANGELOG heading: no stub, no duplicate heading
    {
      const f = buildBumpFixture('bump-existing-heading', 'demo-plugin', '1.2.3', '1.2.3');
      const written = readFileSync(f.changelogPath, 'utf8').replace('## 1.2.3', '## 1.3.0\n- written before the bump.\n\n## 1.2.3');
      writeFileSync(f.changelogPath, written);
      const r = run(f.scriptPath, ['demo-plugin', 'minor']);
      check('bump-plugin-version: bump onto an existing CHANGELOG heading exits 0', r.status === 0);
      check(
        'bump-plugin-version: an existing "## 1.3.0" heading gets no TODO stub and no duplicate',
        readFileSync(f.changelogPath, 'utf8') === written
      );
    }

    // bad bump spec
    {
      const f = buildBumpFixture('bump-badspec', 'demo-plugin', '1.2.3', '1.2.3');
      const r = run(f.scriptPath, ['demo-plugin', 'not-a-real-spec']);
      check('bump-plugin-version: unrecognized bump spec exits 2', r.status === 2);
    }

    // unknown plugin
    {
      const caseDir = join(work, 'bump-unknown-plugin');
      const scriptPath = copyScript('bump-plugin-version.mjs', join(caseDir, 'scripts'));
      const r = run(scriptPath, ['no-such-plugin', 'minor']);
      // Documented behavior: exit 0 = bumped, 1 = failure (bad plugin among them), 2 = bad invocation.
      // An unknown plugin directory is a failure, not a bad invocation.
      check('bump-plugin-version: unknown plugin directory exits 1 (documented as a failure, not bad invocation)', r.status === 1);
    }

    // marketplace/plugin.json version skew -> refusal, no writes
    {
      const f = buildBumpFixture('bump-skew', 'demo-plugin', '1.2.3', '1.9.9');
      const beforePj = readFileSync(f.pluginJsonPath);
      const beforeMkt = readFileSync(f.marketplacePath);
      const beforeCl = readFileSync(f.changelogPath);
      const r = run(f.scriptPath, ['demo-plugin', 'minor']);
      check('bump-plugin-version: version skew refuses to bump, exits 1', r.status === 1);
      check('bump-plugin-version: version skew names "reconcile" in the error', r.stderr.includes('reconcile'));
      check('bump-plugin-version: version skew leaves plugin.json unchanged', Buffer.compare(beforePj, readFileSync(f.pluginJsonPath)) === 0);
      check('bump-plugin-version: version skew leaves marketplace.json unchanged', Buffer.compare(beforeMkt, readFileSync(f.marketplacePath)) === 0);
      check('bump-plugin-version: version skew leaves CHANGELOG.md unchanged', Buffer.compare(beforeCl, readFileSync(f.changelogPath)) === 0);
    }
  }

  // ================================================================================
  // 1d. check-plugin-bump.mjs
  // ================================================================================
  {
    const caseDir = join(work, 'check-plugin-bump');
    const scriptPath = copyScript('check-plugin-bump.mjs', join(caseDir, 'scripts'));

    git(['init', '--quiet', '-b', 'main'], caseDir);

    const pluginDir = join(caseDir, 'plugins', 'demo-plugin');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{\n  "name": "demo-plugin",\n  "version": "1.0.0"\n}\n');
    writeFileSync(join(pluginDir, 'CHANGELOG.md'), '# demo-plugin changelog\n\n## 1.0.0\n- initial.\n');
    writeFileSync(join(pluginDir, 'other.md'), 'baseline notes\n');
    git(['add', '-A'], caseDir);
    gitCommit(caseDir, 'base');
    const baseSha = git(['rev-parse', 'HEAD'], caseDir).trim();

    // A. edit other.md only -> exit 1, names the plugin, no bump + no changelog
    writeFileSync(join(pluginDir, 'other.md'), 'baseline notes\nedited\n');
    git(['add', '-A'], caseDir);
    gitCommit(caseDir, 'edit other only');
    const rA = run(scriptPath, ['--base', baseSha], { cwd: caseDir });
    check('check-plugin-bump: other.md-only edit exits 1', rA.status === 1);
    check('check-plugin-bump: violation names demo-plugin', rA.stderr.includes('demo-plugin'));
    check('check-plugin-bump: violation notes version unchanged', rA.stderr.includes('version unchanged'));
    check('check-plugin-bump: violation notes changelog not touched', rA.stderr.includes('not touched'));

    // B. also bump plugin.json + edit CHANGELOG.md -> exit 0 OK
    writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{\n  "name": "demo-plugin",\n  "version": "1.1.0"\n}\n');
    writeFileSync(join(pluginDir, 'CHANGELOG.md'), '# demo-plugin changelog\n\n## 1.1.0\n- bumped.\n\n## 1.0.0\n- initial.\n');
    git(['add', '-A'], caseDir);
    gitCommit(caseDir, 'bump plus changelog');
    const afterBSha = git(['rev-parse', 'HEAD'], caseDir).trim();
    const rB = run(scriptPath, ['--base', baseSha], { cwd: caseDir });
    check('check-plugin-bump: bump + changelog exits 0', rB.status === 0);
    check('check-plugin-bump: bump + changelog reports OK', rB.stdout.includes('OK'));
    check('check-plugin-bump: bump + changelog names demo-plugin as clean', rB.stdout.includes('demo-plugin'));

    // C. --base bogus-ref -> exit 0 with a skip note (the one documented fail-open path)
    const rC = run(scriptPath, ['--base', 'bogus-ref-zzz'], { cwd: caseDir });
    check('check-plugin-bump: unresolvable --base exits 0', rC.status === 0);
    check(
      'check-plugin-bump: unresolvable --base reports a skip note',
      rC.stdout.includes('did not resolve') && rC.stdout.includes('skipping')
    );

    // D. no args -> exit 2
    const rD = run(scriptPath, [], { cwd: caseDir });
    check('check-plugin-bump: no args exits 2', rD.status === 2);

    // E. --base "" -> exit 2
    const rE = run(scriptPath, ['--base', ''], { cwd: caseDir });
    check('check-plugin-bump: --base "" exits 2', rE.status === 2);

    // F. codex-marketplace/plugins/<p>/... change only -> exit 0 (derived tree ignored)
    mkdirSync(join(caseDir, 'codex-marketplace', 'plugins', 'demo-plugin'), { recursive: true });
    writeFileSync(join(caseDir, 'codex-marketplace', 'plugins', 'demo-plugin', 'note.md'), 'derived artifact\n');
    git(['add', '-A'], caseDir);
    gitCommit(caseDir, 'codex-marketplace derived change');
    const rF = run(scriptPath, ['--base', afterBSha], { cwd: caseDir });
    check('check-plugin-bump: codex-marketplace-only change exits 0', rF.status === 0);
    check('check-plugin-bump: codex-marketplace-only change reports nothing to check', rF.stdout.includes('nothing to check'));
  }

  // ================================================================================
  // 1e. check-plugin-bump.mjs — changelog CONTENT gate (must add a non-blank line)
  // ================================================================================
  {
    const mkContentFixture = (caseName) => {
      const caseDir = join(work, caseName);
      const scriptPath = copyScript('check-plugin-bump.mjs', join(caseDir, 'scripts'));
      git(['init', '--quiet', '-b', 'main'], caseDir);
      const pluginDir = join(caseDir, 'plugins', 'demo-plugin');
      mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
      writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{\n  "name": "demo-plugin",\n  "version": "1.0.0"\n}\n');
      writeFileSync(join(pluginDir, 'CHANGELOG.md'), '# demo-plugin changelog\n\n## 1.0.0\n- initial.\n');
      git(['add', '-A'], caseDir);
      gitCommit(caseDir, 'base');
      const baseSha = git(['rev-parse', 'HEAD'], caseDir).trim();
      return { caseDir, scriptPath, pluginDir, baseSha };
    };

    // G. version bumped, but the CHANGELOG.md diff adds only a blank line — no real entry.
    {
      const { caseDir, scriptPath, pluginDir, baseSha } = mkContentFixture('check-plugin-bump-changelog-noop');
      writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{\n  "name": "demo-plugin",\n  "version": "1.1.0"\n}\n');
      writeFileSync(join(pluginDir, 'CHANGELOG.md'), '# demo-plugin changelog\n\n## 1.0.0\n- initial.\n\n');
      git(['add', '-A'], caseDir);
      gitCommit(caseDir, 'bump version, changelog gets only a trailing blank line');
      const rG = run(scriptPath, ['--base', baseSha], { cwd: caseDir });
      check('check-plugin-bump: changelog touched with only a blank-line addition exits 1', rG.status === 1);
      check('check-plugin-bump: blank-line-only edit names "adds no non-blank line"', rG.stderr.includes('adds no non-blank line'));
    }

    // H. version bumped, and CHANGELOG.md gains a real added bullet -> exit 0.
    {
      const { caseDir, scriptPath, pluginDir, baseSha } = mkContentFixture('check-plugin-bump-changelog-real');
      writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{\n  "name": "demo-plugin",\n  "version": "1.1.0"\n}\n');
      writeFileSync(join(pluginDir, 'CHANGELOG.md'), '# demo-plugin changelog\n\n## 1.1.0\n- Added a real changelog bullet describing the change.\n\n## 1.0.0\n- initial.\n');
      git(['add', '-A'], caseDir);
      gitCommit(caseDir, 'bump version and add a real changelog bullet');
      const rH = run(scriptPath, ['--base', baseSha], { cwd: caseDir });
      check('check-plugin-bump: version bump + real changelog bullet exits 0', rH.status === 0);
      check('check-plugin-bump: real changelog bullet reports OK', rH.stdout.includes('OK'));
    }
  }

  // ================================================================================
  // 1e2. check-plugin-bump.mjs — changelog.d/ fragments. A NEW non-blank fragment satisfies the
  // changelog rule in place of the CHANGELOG.md head; the version rule still applies; an edited,
  // renamed, or deleted fragment never counts.
  // ================================================================================
  {
    const FRAGMENT = 'changelog.d/add-thing.md';
    const mkFragmentFixture = (caseName) => {
      const caseDir = join(work, caseName);
      const scriptPath = copyScript('check-plugin-bump.mjs', join(caseDir, 'scripts'));
      copyScript('changelog-fragments.mjs', join(caseDir, 'scripts'));
      git(['init', '--quiet', '-b', 'main'], caseDir);
      const pluginDir = join(caseDir, 'plugins', 'demo-plugin');
      mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
      mkdirSync(join(pluginDir, 'changelog.d'), { recursive: true });
      writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{\n  "name": "demo-plugin",\n  "version": "1.0.0"\n}\n');
      writeFileSync(join(pluginDir, 'CHANGELOG.md'), '# demo-plugin changelog\n\n## 1.0.0\n- initial.\n');
      writeFileSync(join(pluginDir, 'changelog.d', 'older.md'), '- An earlier fragment already on the base.\n');
      git(['add', '-A'], caseDir);
      gitCommit(caseDir, 'base');
      const baseSha = git(['rev-parse', 'HEAD'], caseDir).trim();
      const bump = () => writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{\n  "name": "demo-plugin",\n  "version": "1.1.0"\n}\n');
      const finish = (message) => { git(['add', '-A'], caseDir); gitCommit(caseDir, message); return run(scriptPath, ['--base', baseSha], { cwd: caseDir }); };
      return { caseDir, pluginDir, bump, finish };
    };

    // I. version bumped + a new non-blank fragment, CHANGELOG.md untouched -> exit 0.
    {
      const f = mkFragmentFixture('check-plugin-bump-fragment-ok');
      f.bump();
      writeFileSync(join(f.pluginDir, FRAGMENT), '- Added the thing.\n');
      const r = f.finish('bump plus new fragment');
      check('check-plugin-bump: bump + new non-blank fragment (CHANGELOG.md untouched) exits 0', r.status === 0 && r.stdout.includes('OK'));
    }

    // J. a new fragment with only blank lines -> exit 1, names the fragment.
    {
      const f = mkFragmentFixture('check-plugin-bump-fragment-empty');
      f.bump();
      writeFileSync(join(f.pluginDir, FRAGMENT), '\n\n  \n');
      const r = f.finish('bump plus blank fragment');
      check('check-plugin-bump: a blank fragment exits 1 and says it adds no non-blank line', r.status === 1 && r.stderr.includes(`plugins/demo-plugin/${FRAGMENT} adds no non-blank line`));
    }

    // K. a valid new fragment but the version did not move -> exit 1 (the version rule stays).
    {
      const f = mkFragmentFixture('check-plugin-bump-fragment-unbumped');
      writeFileSync(join(f.pluginDir, FRAGMENT), '- Added the thing.\n');
      const r = f.finish('fragment without a bump');
      check('check-plugin-bump: a fragment with the version unchanged exits 1', r.status === 1 && r.stderr.includes('version unchanged'));
    }

    // L. a fragment that exists at the base and is only edited -> exit 1.
    {
      const f = mkFragmentFixture('check-plugin-bump-fragment-edited');
      f.bump();
      writeFileSync(join(f.pluginDir, 'changelog.d', 'older.md'), '- An earlier fragment already on the base.\n- A line this PR appended.\n');
      const r = f.finish('bump plus edited old fragment');
      check('check-plugin-bump: an edited (not new) fragment exits 1 and says it is not new', r.status === 1 && r.stderr.includes('is not a new file'));
    }

    // L2. a fragment that is only renamed, and one that is only deleted -> exit 1.
    {
      const f = mkFragmentFixture('check-plugin-bump-fragment-renamed');
      f.bump();
      git(['mv', 'plugins/demo-plugin/changelog.d/older.md', `plugins/demo-plugin/${FRAGMENT}`], f.caseDir);
      const r = f.finish('bump plus renamed fragment');
      check('check-plugin-bump: a renamed fragment exits 1', r.status === 1 && r.stderr.includes('is not a new file'));
      const g = mkFragmentFixture('check-plugin-bump-fragment-deleted');
      g.bump();
      rmSync(join(g.pluginDir, 'changelog.d', 'older.md'));
      const r2 = g.finish('bump plus deleted fragment');
      check('check-plugin-bump: a deleted fragment exits 1 with the changelog-not-touched reason', r2.status === 1 && r2.stderr.includes('not touched'));
    }

    // M. both paths together: a CHANGELOG.md head entry and a new fragment -> exit 0.
    {
      const f = mkFragmentFixture('check-plugin-bump-fragment-both');
      f.bump();
      writeFileSync(join(f.pluginDir, 'CHANGELOG.md'), '# demo-plugin changelog\n\n## 1.1.0\n- Head entry.\n\n## 1.0.0\n- initial.\n');
      writeFileSync(join(f.pluginDir, FRAGMENT), '- Added the thing.\n');
      const r = f.finish('bump plus head entry plus fragment');
      check('check-plugin-bump: a CHANGELOG.md entry and a new fragment together exit 0', r.status === 0 && r.stdout.includes('OK'));
    }

    // N. a blank CHANGELOG.md touch beside a real fragment -> exit 0 (the fragment carries the entry);
    // a blank CHANGELOG.md touch beside a blank fragment -> exit 1 naming both.
    {
      const f = mkFragmentFixture('check-plugin-bump-fragment-blank-head');
      f.bump();
      writeFileSync(join(f.pluginDir, 'CHANGELOG.md'), '# demo-plugin changelog\n\n## 1.0.0\n- initial.\n\n');
      writeFileSync(join(f.pluginDir, FRAGMENT), '- Added the thing.\n');
      check('check-plugin-bump: a blank CHANGELOG.md touch beside a real fragment exits 0', f.finish('blank head plus fragment').status === 0);
      const g = mkFragmentFixture('check-plugin-bump-fragment-both-blank');
      g.bump();
      writeFileSync(join(g.pluginDir, 'CHANGELOG.md'), '# demo-plugin changelog\n\n## 1.0.0\n- initial.\n\n');
      writeFileSync(join(g.pluginDir, FRAGMENT), '\n');
      const r2 = g.finish('blank head plus blank fragment');
      check('check-plugin-bump: a blank CHANGELOG.md touch beside a blank fragment exits 1 naming both', r2.status === 1 && r2.stderr.includes('CHANGELOG.md touched but adds no non-blank line') && r2.stderr.includes('adds no non-blank line — a fragment'));
    }

    // O. a plugin edit with no bump, no changelog, and no fragment still fails closed. The
    // missing-base skip (case C above) stays the only fail-open path.
    {
      const f = mkFragmentFixture('check-plugin-bump-fragment-failopen');
      writeFileSync(join(f.pluginDir, 'other.md'), 'edited\n');
      const r = f.finish('edit without bump, changelog, or fragment');
      check('check-plugin-bump: a plugin edit with no bump, changelog, or fragment still exits 1', r.status === 1);
    }

    // P. bump-plugin-version.mjs --fragment bumps both manifests and leaves CHANGELOG.md alone.
    {
      const caseDir = join(work, 'bump-fragment-flag');
      const scriptPath = copyScript('bump-plugin-version.mjs', join(caseDir, 'scripts'));
      const pluginDir = join(caseDir, 'plugins', 'demo-plugin');
      mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
      mkdirSync(join(caseDir, '.claude-plugin'), { recursive: true });
      writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), '{\n  "name": "demo-plugin",\n  "version": "1.2.3"\n}\n');
      writeFileSync(join(caseDir, '.claude-plugin', 'marketplace.json'), '{\n  "plugins": [\n    {\n      "name": "demo-plugin",\n      "version": "1.2.3"\n    }\n  ]\n}\n');
      const changelog = '# demo-plugin changelog\n\n## 1.2.3\n- initial.\n';
      writeFileSync(join(pluginDir, 'CHANGELOG.md'), changelog);
      const r = run(scriptPath, ['demo-plugin', 'minor', '--fragment']);
      check('bump-plugin-version: --fragment bump exits 0 and moves both versions', r.status === 0
        && readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8').includes('"1.3.0"')
        && readFileSync(join(caseDir, '.claude-plugin', 'marketplace.json'), 'utf8').includes('"1.3.0"'));
      check('bump-plugin-version: --fragment leaves CHANGELOG.md byte-identical (no stub)', readFileSync(join(pluginDir, 'CHANGELOG.md'), 'utf8') === changelog && r.stdout.includes('changelog.d/<slug>.md'));
      check('bump-plugin-version: an unknown flag still exits 2', run(scriptPath, ['demo-plugin', 'minor', '--bogus']).status === 2);
    }
  }

  // ================================================================================
  // 1e3. changelog-fragments.mjs — the one rule that folds fragments into a changelog. Folding is
  // idempotent and the dist render equals the assembled file, so --check holds before and after.
  // ================================================================================
  {
    const frag = await import(pathToFileURL(join(SCRIPTS_DIR, 'changelog-fragments.mjs')).href);
    const head = '# Changelog\n\nIntro.\n\n';
    const old = '## 1.0.0\n- Older.\n';
    check('changelog-fragments: no fragment (or only blank ones) returns the text unchanged',
      frag.assembleChangelog(head + old, [], '1.1.0') === head + old && frag.assembleChangelog(head + old, ['\n \n'], '1.1.0') === head + old);
    const folded = frag.assembleChangelog(head + old, ['- A.\n', '- B.\n'], '1.1.0');
    check('changelog-fragments: fragments become a new section above the first existing one, in order',
      folded === `${head}## 1.1.0\n- A.\n- B.\n\n${old}`);
    check('changelog-fragments: an assembled changelog renders to itself (stable before and after assembly)',
      frag.assembleChangelog(folded, [], '1.1.0') === folded);
    const headed = `${head}## 1.1.0\n- Head entry.\n\n${old}`;
    check('changelog-fragments: with a "## <version>" section present, fragments join the end of that section',
      frag.assembleChangelog(headed, ['- A.\n'], '1.1.0') === `${head}## 1.1.0\n- Head entry.\n- A.\n\n${old}`);
    check('changelog-fragments: a final section takes fragments before its trailing newline',
      frag.assembleChangelog('# C\n\n## 1.1.0\n- Head.\n', ['- A.\n'], '1.1.0') === '# C\n\n## 1.1.0\n- Head.\n- A.\n');
    check('changelog-fragments: a changelog with no sections gets one appended',
      frag.assembleChangelog('# C\n', ['- A.\n'], '1.1.0') === '# C\n\n## 1.1.0\n- A.\n');
    check('changelog-fragments: the changelog keeps its CRLF line endings',
      frag.assembleChangelog((head + old).replace(/\n/g, '\r\n'), ['- A.\n- B.\n'], '1.1.0') === folded.replace(/\n/g, '\r\n'));
    check('changelog-fragments: FRAGMENT_PATH_RE matches one file directly under changelog.d/ only',
      frag.FRAGMENT_PATH_RE.test('plugins/rigor/changelog.d/x.md') && !frag.FRAGMENT_PATH_RE.test('plugins/rigor/changelog.d/sub/x.md')
      && !frag.FRAGMENT_PATH_RE.test('plugins/rigor/changelog.d/x.txt') && !frag.FRAGMENT_PATH_RE.test('codex-marketplace/plugins/rigor/changelog.d/x.md'));
    const fragDir = join(work, 'frag-read');
    mkdirSync(join(fragDir, 'changelog.d'), { recursive: true });
    writeFileSync(join(fragDir, 'changelog.d', 'b.md'), '- B.\r\n');
    writeFileSync(join(fragDir, 'changelog.d', 'a.md'), '- A.\n');
    writeFileSync(join(fragDir, 'changelog.d', 'note.txt'), 'ignored\n');
    check('changelog-fragments: readFragments returns the .md files sorted by name with LF endings',
      JSON.stringify(frag.readFragments(fragDir)) === JSON.stringify([{ name: 'a.md', body: '- A.\n' }, { name: 'b.md', body: '- B.\n' }])
      && frag.readFragments(join(work, 'no-such-dir')).length === 0);

    // The assemble command. Render = what the Codex builder does with the plugin (LF text, fragments
    // folded under the manifest version). `assembleCase` builds a throwaway tree around a copy of the
    // script (real or mutated), renders, assembles, renders again, and reports what changed.
    const render = (pluginDir) => frag.assembleChangelog(
      readFileSync(join(pluginDir, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n'),
      frag.readFragments(pluginDir).map((f) => f.body),
      JSON.parse(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')).version);
    const assembleCase = (label, scriptText, fragments = { 'b-second.md': '- B.\n', 'a-first.md': '- A.\n' }) => {
      const caseDir = join(work, `assemble-${label}`);
      const pluginDir = join(caseDir, 'plugins', 'demo-plugin');
      mkdirSync(join(caseDir, 'scripts'), { recursive: true });
      mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
      mkdirSync(join(pluginDir, 'changelog.d'), { recursive: true });
      const script = join(caseDir, 'scripts', 'changelog-fragments.mjs');
      writeFileSync(script, scriptText);
      writeFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo-plugin', version: '1.1.0' }));
      writeFileSync(join(pluginDir, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0\n- Old.\n');
      for (const [name, body] of Object.entries(fragments)) writeFileSync(join(pluginDir, 'changelog.d', name), body);
      const before = render(pluginDir);
      const checkBefore = run(script, ['assemble', '--check']);
      const r = run(script, ['assemble']);
      const after = render(pluginDir);
      return {
        r, checkBefore, pluginDir, before, script,
        same: before === after,
        left: frag.readFragments(pluginDir).length,
        changelog: readFileSync(join(pluginDir, 'CHANGELOG.md'), 'utf8'),
      };
    };
    const realScript = readFileSync(join(SCRIPTS_DIR, 'changelog-fragments.mjs'), 'utf8');
    const good = assembleCase('real', realScript);
    check('changelog-fragments assemble: the render is byte-identical before and after, with zero fragments left',
      good.r.status === 0 && good.same && good.left === 0 && good.changelog === good.before);
    check('changelog-fragments assemble: fragments fold in name order into a new section above the first',
      good.changelog === '# Changelog\n\n## 1.1.0\n- A.\n- B.\n\n## 1.0.0\n- Old.\n');
    check('changelog-fragments assemble: --check exits 1 while fragments exist and writes nothing',
      good.checkBefore.status === 1 && good.checkBefore.stdout.includes('unassembled 2'));
    const again = run(good.script, ['assemble']);
    const checkAfter = run(good.script, ['assemble', '--check']);
    check('changelog-fragments assemble: no fragments is a no-op (exit 0), and --check then exits 0',
      again.status === 0 && checkAfter.status === 0 && readFileSync(join(good.pluginDir, 'CHANGELOG.md'), 'utf8') === good.changelog);
    check('changelog-fragments assemble: an unknown --plugin exits 2',
      run(good.script, ['assemble', '--plugin', 'no-such-plugin']).status === 2 && run(good.script, ['assemble', '--plugin', 'demo-plugin']).status === 0);
    check('changelog-fragments assemble: a bad verb or a stray argument exits 2',
      run(good.script, []).status === 2 && run(good.script, ['assemble', '--bogus']).status === 2 && run(good.script, ['assemble', '--plugin']).status === 2);
    const blank = assembleCase('blank', realScript, { 'only-blank.md': '\n \n' });
    check('changelog-fragments assemble: a blank fragment leaves CHANGELOG.md unchanged and is removed',
      blank.r.status === 0 && blank.changelog === '# Changelog\n\n## 1.0.0\n- Old.\n' && blank.left === 0);
    // Mutants the eval must catch: folding without deleting, and a different fold order.
    const keep = assembleCase('mutant-keep', realScript.replace('for (const f of fragments) rmSync(', 'for (const f of []) rmSync('));
    check('changelog-fragments assemble: mutant that folds without deleting is caught',
      keep.left !== 0 && !(keep.same && keep.left === 0));
    const reversed = assembleCase('mutant-order', realScript.replace('fragments.map((f) => f.body), version)', 'fragments.map((f) => f.body).reverse(), version)'));
    check('changelog-fragments assemble: mutant that folds in a different order is caught',
      reversed.changelog !== good.changelog && !(reversed.same && reversed.left === 0));
  }

  // ================================================================================
  // 1f. integrate-branch.mjs — pure, git-free exports only (parseWorkflowJobSteps,
  // classifyStep, selectSteps, pluginNeedsBump, integrationLinks). Everything else in that script shells out
  // to git and to the real gate/build scripts, which is what its --dry-run smoke run
  // (invoked directly, not through this eval) exercises instead.
  // ================================================================================
  {
    const mod = await import(pathToFileURL(join(SCRIPTS_DIR, 'integrate-branch.mjs')).href);

    // A small fixture in the exact shape parseWorkflowJobSteps expects: two jobs, so job-block
    // truncation at the next 2-space key is exercised, plus one of each step shape it handles.
    const fixtureYaml = [
      'jobs:',
      '  structural-lint:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@deadbeef',
      '        with:',
      '          fetch-depth: 0',
      '',
      '      - name: Plain node step',
      '        run: node scripts/lint-plugins.mjs',
      '',
      '      - name: Eval-dir step',
      '        run: node evals/example-dir/run.mjs',
      '',
      '      - name: Block eval-dir step',
      '        run: |',
      '          node evals/other-dir/run.mjs',
      '          node evals/other-dir/second.mjs',
      '',
      '      - name: Shell construct step',
      '        run: |',
      '          for f in evals/*/ANSWER_KEY.json; do',
      '            node evals/score.mjs "$f" --check',
      '          done',
      '',
      '      - name: Guarded step (PR only)',
      '        if: github.event_name == \'pull_request\'',
      '        run: node scripts/check-plugin-bump.mjs --base "origin/main"',
      '',
      '      - name: Env step',
      '        env:',
      '          FOO: bar',
      '        run: node scripts/scan-ai-tells.mjs',
      '  other-job:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - name: Not in the first job',
      '        run: node scripts/lint-plugins.mjs',
    ].join('\n');

    const steps = mod.parseWorkflowJobSteps(fixtureYaml, 'structural-lint');
    check('integrate-branch: parseWorkflowJobSteps finds every named run: step in the job, and none past its boundary', steps.length === 6 && steps.every((s) => s.name !== 'Not in the first job'));
    check('integrate-branch: single-line run: is captured verbatim', steps[0].run === 'node scripts/lint-plugins.mjs');
    check('integrate-branch: block run: joins its lines with a newline', steps[2].run === 'node evals/other-dir/run.mjs\nnode evals/other-dir/second.mjs');
    check('integrate-branch: if: guard is detected', steps[4].hasIf === true && steps[0].hasIf === false);
    check('integrate-branch: env: block is detected', steps[5].hasEnv === true && steps[0].hasEnv === false);

    // Case: a sharded gate job. The aggregate's own steps plus every shard it needs are
    // selected, in needs: order; a shard it does not need is not; all three needs: forms parse;
    // a needed shard with no steps throws instead of dropping out of selection.
    {
      const sharded = [
        'jobs:',
        '  gate-shard-2:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Second shard step',
        '        run: node evals/two/run.mjs',
        '  gate-shard-1:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: First shard step',
        '        run: node evals/one/run.mjs',
        '  unrelated:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Unrelated step',
        '        run: node evals/three/run.mjs',
        '  gate:',
        '    if: always()',
        '    needs: [gate-shard-1, gate-shard-2]',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Require every shard to succeed',
        '        env:',
        '          NEEDS_JSON: x',
        '        run: node -e "0"',
        '  block-gate:',
        '    needs:',
        '      - gate-shard-2',
        '    runs-on: ubuntu-latest',
        '  scalar-gate:',
        '    needs: gate-shard-1',
        '    runs-on: ubuntu-latest',
        '  broken-gate:',
        '    needs: [gate-shard-1, missing-shard]',
        '    runs-on: ubuntu-latest',
      ].join('\n');
      const names = mod.parseWorkflowGateSteps(sharded, 'gate').map((s) => s.name);
      check('integrate-branch: a gate job covers every needed shard in needs: order, then its own steps', JSON.stringify(names) === JSON.stringify(['First shard step', 'Second shard step', 'Require every shard to succeed']));
      check('integrate-branch: needs: parses in flow, block, and scalar form', JSON.stringify(mod.parseWorkflowJobNeeds(sharded, 'block-gate')) === '["gate-shard-2"]' && JSON.stringify(mod.parseWorkflowJobNeeds(sharded, 'scalar-gate')) === '["gate-shard-1"]');
      let threw = false; try { mod.parseWorkflowGateSteps(sharded, 'broken-gate'); } catch { threw = true; }
      check('integrate-branch: a needed shard with no steps fails closed', threw);
      check('integrate-branch: the real workflow gate covers its lint and record steps', (() => { const real = mod.parseWorkflowGateSteps(readFileSync(join(SCRIPTS_DIR, '..', '.github', 'workflows', 'validate.yml'), 'utf8'), 'structural-lint').map((s) => s.name); return real.includes('Structural lint (the gate)') && real.includes('Durable record-collection regression eval') && real.includes('Attack-chain graph regression eval'); })());
    }

    check('integrate-branch: classifyStep accepts a plain node step', mod.classifyStep(steps[0]).runnable === true);
    check('integrate-branch: classifyStep rejects an if:-guarded step', mod.classifyStep(steps[4]).runnable === false && /if: guard/.test(mod.classifyStep(steps[4]).reason));
    check('integrate-branch: classifyStep rejects an env: step', mod.classifyStep(steps[5]).runnable === false && /env\/secrets/.test(mod.classifyStep(steps[5]).reason));
    check('integrate-branch: classifyStep rejects a shell-construct step', mod.classifyStep(steps[3]).runnable === false && /shell\/non-node/.test(mod.classifyStep(steps[3]).reason));

    // Case: a changed file under evals/<dir>/ selects that dir's step.
    {
      const { selected, skipped } = mod.selectSteps({ alwaysSelect: [],
        steps, changedPaths: ['evals/example-dir/fixture.json'], full: false, evalDirRefersToScript: () => false,
      });
      check('integrate-branch: a changed file under evals/<dir>/ selects that dir\'s step', selected.some((s) => s.step.name === 'Eval-dir step'));
      check('integrate-branch: an unrelated runnable step stays skipped', skipped.some((s) => s.step.name === 'Plain node step'));
    }

    // Case: a changed scripts/<name>.mjs selects the evals/<dir>/ step(s) that reference its
    // basename, via the injected (git-free) evalDirRefersToScript lookup.
    {
      const { selected } = mod.selectSteps({ alwaysSelect: [],
        steps, changedPaths: ['scripts/lint-plugins.mjs'], full: false,
        evalDirRefersToScript: (dir, basename) => dir === 'other-dir' && basename === 'lint-plugins.mjs',
      });
      check('integrate-branch: a changed script selects the evals/<dir>/ step that references it', selected.some((s) => s.step.name === 'Block eval-dir step'));
      check('integrate-branch: it does not select an evals/<dir>/ step the lookup does not confirm', !selected.some((s) => s.step.name === 'Eval-dir step'));
    }

    // Case: a changed module outside scripts/ (a hook) selects its eval, but a changed run.mjs
    // never matches by basename, because every eval has one.
    {
      const lookup = (dir, basename) => dir === 'other-dir' && ['ladder-card.mjs', 'run.mjs'].includes(basename);
      const hook = mod.selectSteps({ alwaysSelect: [], steps, changedPaths: ['plugins/code-ops-suite/hooks/ladder-card.mjs'], full: false, evalDirRefersToScript: lookup });
      check('integrate-branch: a changed hook module selects the evals/<dir>/ step that references it', hook.selected.some((s) => s.step.name === 'Block eval-dir step'));
      const runner = mod.selectSteps({ alwaysSelect: [], steps, changedPaths: ['evals/unrelated/run.mjs'], full: false, evalDirRefersToScript: lookup });
      check('integrate-branch: a changed run.mjs does not select another eval by basename', !runner.selected.some((s) => s.step.name === 'Block eval-dir step'));
    }

    // Case: an unrelated change selects nothing from the workflow steps (the structural chain,
    // which integrate-branch.mjs always runs regardless of selection, lives outside this pure
    // function and is exercised by the --dry-run smoke run instead).
    {
      const { selected } = mod.selectSteps({ alwaysSelect: [],
        steps, changedPaths: ['README.md'], full: false, evalDirRefersToScript: () => false,
      });
      check('integrate-branch: an unrelated change selects no workflow step', selected.length === 0);
    }

    // Case: the always-selected citation gate runs on every change, fails closed when no step
    // names it, and is present in the real workflow.
    {
      const citation = { name: 'Doc line-citation gate', run: 'node scripts/check-doc-citations.mjs', hasIf: false, hasEnv: false };
      const { selected } = mod.selectSteps({
        steps: [...steps, citation], changedPaths: ['README.md'], full: false, evalDirRefersToScript: () => false,
        alwaysSelect: ['scripts/check-doc-citations.mjs'],
      });
      check('integrate-branch: an always-selected step runs for an unrelated change', selected.length === 1 && selected[0].step === citation && /^always: scripts\/check-doc-citations\.mjs/.test(selected[0].reason));
      let missing = false;
      try { mod.selectSteps({ steps, changedPaths: [], full: false, evalDirRefersToScript: () => false, alwaysSelect: ['scripts/check-doc-citations.mjs'] }); } catch (e) { missing = /check-doc-citations\.mjs/.test(e.message); }
      check('integrate-branch: an always-selected path that matches no step fails closed', missing);
      check('integrate-branch: ALWAYS_SELECT names the citation gate', mod.ALWAYS_SELECT.includes('scripts/check-doc-citations.mjs'));
      const real = mod.parseWorkflowGateSteps(readFileSync(join(SCRIPTS_DIR, '..', '.github', 'workflows', 'validate.yml'), 'utf8'), 'structural-lint');
      const realPick = mod.selectSteps({ steps: real, changedPaths: ['README.md'], full: false, evalDirRefersToScript: () => false });
      check('integrate-branch: the real workflow selects the Doc line-citation gate for an unrelated change', realPick.selected.some((s) => s.step.name === 'Doc line-citation gate'));
    }

    // Case: --full selects every runnable step regardless of the changed set, but still skips
    // an if:-guarded, env:-needing, or shell-construct step.
    {
      const { selected, skipped } = mod.selectSteps({ alwaysSelect: [],
        steps, changedPaths: [], full: true, evalDirRefersToScript: () => false,
      });
      check('integrate-branch: --full selects every runnable step', selected.length === 3 && selected.every((s) => s.reason === '--full'));
      check('integrate-branch: --full still skips a guarded/shell-construct/env step', skipped.length === 3);
    }

    // Case: bump-detection idempotence. Before a bump the base and current versions are equal;
    // after one the current version has moved, so a second pass over the same plan never
    // reports the plugin as needing another bump. A brand-new plugin (absent at base) and an
    // unreadable current plugin.json are the two edge rules the same function encodes.
    check('integrate-branch: pluginNeedsBump is true when the version has not moved since base', mod.pluginNeedsBump('1.2.3', '1.2.3') === true);
    check('integrate-branch: pluginNeedsBump is false once the version has moved (idempotent re-run)', mod.pluginNeedsBump('1.2.3', '1.3.0') === false);
    check('integrate-branch: pluginNeedsBump treats a plugin absent at base as already differing', mod.pluginNeedsBump(null, '1.0.0') === false);
    check('integrate-branch: pluginNeedsBump returns null when the current version cannot be read', mod.pluginNeedsBump('1.2.3', null) === null);

    // integrationLinks: each touched plugin's manifest and changelog, then each stale atlas
    // section, in that order, keeping only paths the injected exists() confirms. The missing
    // rigor changelog and the missing atlas section prove the filter drops absent files.
    const present = new Set(['plugins/code-ops-suite/.claude-plugin/plugin.json', 'plugins/code-ops-suite/CHANGELOG.md',
      'plugins/rigor/.claude-plugin/plugin.json', 'code-ops-docs/98 System/Atlas/sections/hooks.md']);
    const links = mod.integrationLinks({ touched: ['code-ops-suite', 'rigor'], stale: ['hooks', 'gone'], exists: (p) => present.has(p) });
    check('integrate-branch: integrationLinks links manifests, changelogs, and stale atlas sections that exist, in order',
      JSON.stringify(links) === JSON.stringify([
        ['code-ops-suite manifest', 'plugins/code-ops-suite/.claude-plugin/plugin.json'],
        ['code-ops-suite changelog', 'plugins/code-ops-suite/CHANGELOG.md'],
        ['rigor manifest', 'plugins/rigor/.claude-plugin/plugin.json'],
        ['atlas section hooks', 'code-ops-docs/98 System/Atlas/sections/hooks.md'],
      ]));
    check('integrate-branch: integrationLinks is empty with nothing touched or stale',
      mod.integrationLinks({ touched: [], stale: [], exists: () => true }).length === 0);

    // --changelog: the entry replaces the bump script's stub before regeneration. An empty entry,
    // one that still carries **TODO**, and a changelog with no stub (a re-run) are the three edges.
    const stub = '- **TODO** — describe the change.';
    const changelog = `# Changelog\n\n## 1.2.0\n${stub}\n\n## 1.1.0\n- Older.\n`;
    check('integrate-branch: changelogEntryProblem refuses an empty or whitespace-only entry', mod.changelogEntryProblem('') !== null && mod.changelogEntryProblem(' \n\t\n') !== null);
    check('integrate-branch: changelogEntryProblem refuses an entry that still contains **TODO**', /TODO/.test(mod.changelogEntryProblem(`- Done.\n${stub}\n`) ?? ''));
    check('integrate-branch: changelogEntryProblem accepts a written entry', mod.changelogEntryProblem('- **Fixed** - the thing.\n') === null);
    check('integrate-branch: replaceChangelogStub swaps the stub for the entry and keeps the older sections',
      mod.replaceChangelogStub(changelog, '- **Fixed** - the thing.\n') === '# Changelog\n\n## 1.2.0\n- **Fixed** - the thing.\n\n## 1.1.0\n- Older.\n');
    check('integrate-branch: replaceChangelogStub returns null when no stub remains (idempotent re-run)',
      mod.replaceChangelogStub('# Changelog\n\n## 1.2.0\n- Done.\n', '- X.\n') === null);
    // --changelog writes plugins/<plugin>/changelog.d/<slug>.md, named for the branch.
    check('integrate-branch: fragmentSlug turns a topic branch into a file-safe name',
      mod.fragmentSlug('eng/Changelog Fragments') === 'eng-changelog-fragments' && mod.fragmentSlug('eng/x.y_z') === 'eng-x.y_z');
    check('integrate-branch: fragmentSlug refuses a branch that names no topic',
      ['', 'HEAD', 'main', 'master', '///', null, undefined].every((b) => mod.fragmentSlug(b) === null));
    check('integrate-branch: replaceChangelogStub gives the entry the file\'s CRLF line endings',
      mod.replaceChangelogStub(changelog.replace(/\n/g, '\r\n'), '- A.\n- B.\n').includes('- A.\r\n- B.\r\n\r\n## 1.1.0'));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} release-tooling regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all release-tooling regression checks passed.');
