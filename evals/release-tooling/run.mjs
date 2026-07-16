#!/usr/bin/env node
// Regression eval for the plugin release-tooling scripts:
//   scripts/sync-vendored.mjs, scripts/vendored-manifest.mjs,
//   scripts/bump-plugin-version.mjs, scripts/check-plugin-bump.mjs
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

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPTS_DIR = join(REPO, 'scripts');

const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };

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
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} release-tooling regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all release-tooling regression checks passed.');
