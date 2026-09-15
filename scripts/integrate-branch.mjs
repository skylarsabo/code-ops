#!/usr/bin/env node
// Per-PR integration runner: the mechanical steps CLAUDE.md requires of every change, so a
// helper (human or agent) only has to make the judgment calls this script cannot make for it.
//
//   node scripts/integrate-branch.mjs [--base <ref>] [--bump <plugin>:<major|minor|patch>]...
//                                      [--full] [--dry-run]
//
// Default --base is origin/main. Steps, in order:
//   1. Plugin version bump - any plugins/<name>/ path in the changed set whose version still
//      equals <base>'s needs a bump (§ CLAUDE.md "After editing anything under plugins/<name>/").
//      A matching --bump <plugin>:<spec> runs it through bump-plugin-version.mjs; an unmatched
//      one is a failure naming the plugin. Already-bumped plugins are skipped - re-running never
//      double-bumps.
//   2. Regenerate the host distributions: build-codex-marketplace.mjs and build-opencode-dist.mjs
//      in write mode.
//   3. Documentation manifest: docs-manifest.mjs sync, then check.
//   4. Atlas freshness for this repo's own atlas (read-only). A stale section is a pending
//      judgment item - this script prints the section and the stamp command and never stamps it;
//      only a human (or an agent that has actually re-verified the prose) should run that.
//   5. Gates: the structural chain from CLAUDE.md "Before declaring any change done" always runs,
//      plus every applicable step from the first job (structural-lint) of
//      .github/workflows/validate.yml - applicable meaning its `run:` text names a changed path,
//      or it runs an eval under evals/<dir>/ where either a changed file lives under that dir or
//      a file in that dir references a changed scripts/<name>.mjs basename. --full runs every
//      runnable step regardless of the changed set. A step guarded by `if:`, one that needs
//      env/secrets, or one whose `run:` is not a plain sequence of `node ...` invocations is
//      skipped and named, because this runner never shells out - every command is spawned via
//      execFileSync(process.execPath, ...), so quoting is argv-exact and identical on Windows and
//      POSIX (see the atlas step's quoted `"code-ops-docs/98 System/Atlas"` path).
//
// A pending judgment item (a plugin needing a --bump nobody supplied, a stale atlas section, or a
// plugin CHANGELOG.md still carrying bump-plugin-version.mjs's "- **TODO** - describe the
// change." stub) is reported but never auto-resolved.
//
// --dry-run performs no write and runs no build/sync/gate step: it prints the changed set, the
// bump plan, and the selected/skipped gate steps, using only git plumbing and the two read-only
// checkers (check-plugin-bump.mjs, atlas-check.mjs check) to keep that preview accurate.
//
// Exit: 0 = every step passed and no judgment item is pending (including under --dry-run, where
// this is a verdict on the preview); 1 = a step failed or a judgment item is pending; 2 = bad
// invocation.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrDie, walkFiles } from './cli-lib.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// This repository's own atlas (CLAUDE.md "The documentation hub"; the same path
// .github/workflows/validate.yml's "Atlas freshness" step stamps against).
const ATLAS_DIR = 'code-ops-docs/98 System/Atlas';
const USAGE = 'usage: integrate-branch.mjs [--base <ref>] [--bump <plugin>:<major|minor|patch>]... [--full] [--dry-run]';

// ---------------------------------------------------------------- git plumbing

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024, ...opts });
}
function gitTry(args, opts = {}) {
  try { return { ok: true, out: git(args, opts) }; }
  catch (e) { return { ok: false, out: '', err: String(e.stderr || e.message).trim() }; }
}

// git diff --name-only <mergeBase> (one ref, no HEAD) diffs the merge-base against the working
// tree directly - committed changes since the merge-base AND uncommitted/staged edits in one
// call. Untracked non-ignored files never appear in a diff, so they are unioned in separately.
function changedSet(base) {
  const mb = gitTry(['merge-base', base, 'HEAD']);
  if (!mb.ok) return null;
  const mergeBase = mb.out.trim();
  const tracked = git(['diff', '--name-only', '-z', mergeBase]).split('\0').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

// ---------------------------------------------------------------- step 1: plugin version bump

const PLUGIN_TOUCHED_RE = /^plugins\/([^/]+)\//;
const TODO_STUB = '- **TODO** — describe the change.'; // exact stub bump-plugin-version.mjs writes

function touchedPlugins(paths) {
  const set = new Set();
  for (const p of paths) { const m = PLUGIN_TOUCHED_RE.exec(p); if (m) set.add(m[1]); }
  return [...set].sort();
}

function stripBom(text) { return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text; }

function readVersionSafe(text) {
  try {
    const parsed = JSON.parse(stripBom(text));
    return typeof parsed?.version === 'string' ? parsed.version : null;
  } catch { return null; }
}

function pluginVersionAtBase(base, name) {
  const r = gitTry(['show', `${base}:plugins/${name}/.claude-plugin/plugin.json`]);
  return r.ok ? readVersionSafe(r.out) : null;
}
function pluginVersionOnDisk(name) {
  const abs = join(ROOT, 'plugins', name, '.claude-plugin', 'plugin.json');
  if (!existsSync(abs)) return null;
  try { return readVersionSafe(readFileSync(abs, 'utf8')); } catch { return null; }
}

// Mirrors check-plugin-bump.mjs's own version-comparison rule exactly (a plugin.json absent at
// <base> - a brand-new plugin - counts as already differing). Pure and git-free so the eval can
// pin idempotence without a fixture repo: once a plugin is bumped, its base/current versions
// differ and this returns false, so a second run of the same plan never re-bumps it.
export function pluginNeedsBump(baseVersion, currentVersion) {
  if (typeof currentVersion !== 'string') return null; // can't read HEAD's plugin.json - not this gate's call
  if (typeof baseVersion !== 'string') return false; // absent at base: brand-new, already differs
  return baseVersion === currentVersion;
}

function callCheckPluginBump(base) {
  const script = join(ROOT, 'scripts', 'check-plugin-bump.mjs');
  try {
    const out = execFileSync(process.execPath, [script, '--base', base], { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
    return { status: 0, stdout: out, stderr: '' };
  } catch (e) {
    return { status: e.status ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function todoStub(name) {
  const abs = join(ROOT, 'plugins', name, 'CHANGELOG.md');
  if (!existsSync(abs)) return false;
  try { return readFileSync(abs, 'utf8').includes(TODO_STUB); } catch { return false; }
}

// Read-only: computes the bump plan without writing anything. check-plugin-bump.mjs's own
// touched-plugin detection is scoped to committed history (`<base>...HEAD`), which cannot see a
// plugin touched only in the working tree or as an untracked file - the working-tree-inclusive
// changed set this script deliberately uses (see changedSet above). It is still called here, for
// parity with the CI gate and to surface its exact diagnostics (including the changelog-content
// check this script does not re-derive); its output is unioned with a local fallback, using the
// identical version-comparison rule (pluginNeedsBump), for any touched plugin it never mentions.
function planBump(base, changed) {
  const touched = touchedPlugins(changed);
  const plan = { touched, needing: [], clean: [], gateDiagnostics: '' };
  if (touched.length === 0) return plan;

  const gate = callCheckPluginBump(base);
  plan.gateDiagnostics = (gate.stdout + gate.stderr).trim();
  const mentioned = new Set();
  for (const line of plan.gateDiagnostics.split('\n')) {
    const m = /^x (\S[^:]*): /.exec(line);
    if (m) mentioned.add(m[1]);
  }
  const okList = /\(([^)]+)\)\.$/.exec(gate.stdout.trim());
  if (okList) for (const name of okList[1].split(',').map((s) => s.trim())) mentioned.add(name);

  for (const name of touched) {
    const versionUnchanged = new RegExp(`^x ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: .*version unchanged`, 'm').test(plan.gateDiagnostics);
    let needs;
    if (mentioned.has(name)) {
      needs = versionUnchanged;
    } else {
      // Not in the gate's committed-history view at all - touched only via the working tree or
      // an untracked file. Fall back to the identical comparison directly.
      needs = pluginNeedsBump(pluginVersionAtBase(base, name), pluginVersionOnDisk(name));
    }
    if (needs) plan.needing.push(name); else plan.clean.push(name);
  }
  return plan;
}

function runBumpStep({ base, changed, bumpMap, dryRun, log }) {
  const plan = planBump(base, changed);
  const result = { failed: [], bumped: [], skippedAlreadyBumped: [], judgmentItems: [] };
  if (plan.touched.length === 0) { log('  no plugins/<name>/ paths in the changed set.'); return result; }
  log(`  touched: ${plan.touched.join(', ')}`);
  if (plan.gateDiagnostics) for (const line of plan.gateDiagnostics.split('\n')) log(`    [check-plugin-bump] ${line}`);

  for (const name of plan.clean) result.skippedAlreadyBumped.push(name);
  if (result.skippedAlreadyBumped.length) log(`  already bumped since ${base}: ${result.skippedAlreadyBumped.join(', ')} (skipping - idempotent)`);

  for (const name of plan.needing) {
    const spec = bumpMap.get(name);
    if (!spec) {
      log(`  x ${name} needs a version bump - pass --bump ${name}:<major|minor|patch>`);
      result.failed.push(name);
      continue;
    }
    if (dryRun) { log(`  would bump ${name} (${spec}) - --dry-run, not writing`); result.bumped.push(name); continue; }
    const script = join(ROOT, 'scripts', 'bump-plugin-version.mjs');
    try {
      const out = execFileSync(process.execPath, [script, name, spec], { cwd: ROOT, encoding: 'utf8', timeout: 20000 });
      for (const line of out.trim().split('\n')) log(`    ${line}`);
      result.bumped.push(name);
    } catch (e) {
      log(`  x bump-plugin-version.mjs failed for ${name}: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
      result.failed.push(name);
    }
  }

  for (const name of plan.touched) {
    if (todoStub(name)) result.judgmentItems.push(`plugins/${name}/CHANGELOG.md still carries the bump script's TODO stub - fill in the change description`);
  }
  return result;
}

// ---------------------------------------------------------------- steps 2-4: build, docs, atlas

function runNode(args, { label, log }) {
  try {
    const out = execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    log(`  ok ${label}`);
    return { ok: true, out };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    log(`  FAIL ${label}`);
    for (const line of out.trim().split('\n').slice(-20)) log(`    ${line}`);
    return { ok: false, out };
  }
}

function runBuildStep(log) {
  const a = runNode([join(ROOT, 'scripts', 'build-codex-marketplace.mjs')], { label: 'build-codex-marketplace.mjs', log });
  const b = runNode([join(ROOT, 'scripts', 'build-opencode-dist.mjs')], { label: 'build-opencode-dist.mjs', log });
  return a.ok && b.ok;
}

function runDocsStep(log) {
  const script = join(ROOT, 'scripts', 'docs-manifest.mjs');
  const a = runNode([script, 'sync'], { label: 'docs-manifest.mjs sync', log });
  const b = runNode([script, 'check'], { label: 'docs-manifest.mjs check', log });
  return a.ok && b.ok;
}

// Read-only in every mode (atlas-check.mjs check never writes; only `stamp` does, and this
// script never calls it). Returns { ok, judgmentItems }, one judgment item per stale section
// naming the exact stamp command an operator who has re-verified the prose would run.
function runAtlasStep(log) {
  const script = join(ROOT, 'scripts', 'atlas-check.mjs');
  const r = execTry([script, 'check', '--atlas', ATLAS_DIR, '--root', ROOT], { timeout: 60000 });
  const text = (r.out || '') + (r.err || '');
  for (const line of text.trim().split('\n')) log(`  [atlas] ${line}`);
  const stale = [...text.matchAll(/!!\s+STALE\s+(\S+)/g)].map((m) => m[1]);
  const judgmentItems = stale.map(
    (slug) => `atlas section '${slug}' is STALE - re-verify the prose, then: node scripts/atlas-check.mjs stamp --atlas "${ATLAS_DIR}" --section ${slug}`
  );
  return { ok: r.ok !== false, judgmentItems };
}

function execTry(args, opts = {}) {
  try { return { ok: true, out: execFileSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }) }; }
  catch (e) { return { ok: false, out: e.stdout || '', err: e.stderr || '' }; }
}

// ---------------------------------------------------------------- step 5: workflow step selection

// Extracts one job's run-steps from the workflow YAML by line-oriented scanning (fixed 2-space
// indent per nesting level, matching this file's own shape - see the header comment). Not a
// general YAML parser; it only has to survive this repository's one workflow file, which the
// eval pins with a fixture of the same shape.
export function parseWorkflowJobSteps(yamlText, jobName) {
  const lines = yamlText.split('\n').map((l) => l.replace(/\r$/, ''));
  const jobHeaderRe = new RegExp(`^ {2}${jobName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`);
  const start = lines.findIndex((l) => jobHeaderRe.test(l));
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^ {2}\S/.test(lines[i])) { end = i; break; }
  const block = lines.slice(start, end);

  const stepsIdx = block.findIndex((l) => /^ {4}steps:\s*$/.test(l));
  if (stepsIdx === -1) return [];
  const body = block.slice(stepsIdx + 1);

  const items = [];
  let cur = null;
  for (const line of body) {
    if (/^ {6}-\s/.test(line)) { if (cur) items.push(cur); cur = [line]; }
    else if (cur) cur.push(line);
  }
  if (cur) items.push(cur);

  const steps = [];
  for (const itemLines of items) {
    const nameM = /^ {6}- name: (.+)$/.exec(itemLines[0]);
    if (!nameM) continue; // an action step (uses:) or anything unnamed is not a run: step
    const name = nameM[1].trim();
    const hasIf = itemLines.some((l) => /^ {8}if: /.test(l));
    const hasEnv = itemLines.some((l) => /^ {8}env:\s*$/.test(l));

    let run = null;
    const single = itemLines.find((l) => /^ {8}run: (?!\|\s*$).+$/.test(l));
    if (single) {
      run = /^ {8}run: (.+)$/.exec(single)[1].trim();
    } else {
      const blockAt = itemLines.findIndex((l) => /^ {8}run: \|\s*$/.test(l));
      if (blockAt !== -1) {
        const runLines = [];
        for (let i = blockAt + 1; i < itemLines.length; i++) {
          const l = itemLines[i];
          if (l.trim() === '') { runLines.push(''); continue; }
          if (!/^ {10}/.test(l)) break;
          runLines.push(l.slice(10));
        }
        while (runLines.length && runLines[runLines.length - 1] === '') runLines.pop();
        run = runLines.join('\n');
      }
    }
    steps.push({ name, run, hasIf, hasEnv });
  }
  return steps;
}

// Whether a step's run: text is something this runner can execute: no if:/env: guard, no
// unresolved `${{ }}` expression, and every non-blank/non-comment line is a plain `node ...`
// invocation - this runner never shells out, so a bash construct (a for-loop, `command -v`, a
// glob) is out of scope, named as such rather than silently skipped.
export function classifyStep(step) {
  if (!step.run) return { runnable: false, reason: 'no run: directive (an action step)' };
  if (step.hasIf) return { runnable: false, reason: 'if: guard - needs workflow-event context this tool does not have' };
  if (step.hasEnv) return { runnable: false, reason: 'needs env/secrets this tool does not provide' };
  if (step.run.includes('${{')) return { runnable: false, reason: 'contains an unresolved GitHub Actions expression' };
  const codeLines = step.run.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  if (codeLines.length === 0) return { runnable: false, reason: 'empty run: body' };
  const nonNode = codeLines.find((l) => !/^node\b/.test(l));
  if (nonNode) return { runnable: false, reason: `needs a shell/non-node construct: ${nonNode.slice(0, 60)}` };
  return { runnable: true, reason: null };
}

// Pure selection over already-parsed steps and an already-computed changed set. `evalDirRefersToScript(dir, basename)`
// is injected so the eval can test the reference rule with fabricated content, and the real CLI
// backs it with a file-content scan under evals/<dir>/.
export function selectSteps({ steps, changedPaths, full, evalDirRefersToScript }) {
  // Any changed module, not only scripts/: a hook's eval names hooks/<x>.mjs. run.mjs is excluded
  // because every eval has one; the evals/<dir>/ rule below covers a changed eval runner.
  const changedScriptBasenames = [...new Set(
    changedPaths.map((p) => p.split('/').pop()).filter((b) => b.endsWith('.mjs') && b !== 'run.mjs')
  )];
  const selected = [];
  const skipped = [];
  for (const step of steps) {
    const cls = classifyStep(step);
    if (!cls.runnable) { skipped.push({ step, reason: cls.reason }); continue; }
    if (full) { selected.push({ step, reason: '--full' }); continue; }

    const directHit = changedPaths.find((p) => step.run.includes(p));
    if (directHit) { selected.push({ step, reason: `run: references changed path ${directHit}` }); continue; }

    const dirs = [...new Set([...step.run.matchAll(/evals\/([^/\s"'|]+)\//g)].map((m) => m[1]))];
    let matched = null;
    for (const dir of dirs) {
      if (changedPaths.some((p) => p.startsWith(`evals/${dir}/`))) { matched = `changed file under evals/${dir}/`; break; }
      const viaScript = changedScriptBasenames.find((b) => evalDirRefersToScript(dir, b));
      if (viaScript) { matched = `evals/${dir}/ references changed scripts/${viaScript}`; break; }
    }
    if (matched) { selected.push({ step, reason: matched }); continue; }
    skipped.push({ step, reason: 'no changed path or evals/<dir> reference matched' });
  }
  return { selected, skipped };
}

// Real (non-pure) backing for evalDirRefersToScript: does any file under evals/<dir>/ contain
// `basename` as a substring. Cheap enough per call - the number of distinct evals/<dir>/ names a
// job1 run: text references is small, and there are at most a handful of changed script basenames.
function makeEvalDirRefersToScript() {
  const cache = new Map();
  return (dir, basename) => {
    const abs = join(ROOT, 'evals', dir);
    if (!existsSync(abs)) return false;
    if (!cache.has(dir)) {
      const text = walkFiles(abs).map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');
      cache.set(dir, text);
    }
    return cache.get(dir).includes(basename);
  };
}

function tokenizeRunLine(line) {
  const tokens = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    while (i < n && /\s/.test(line[i])) i++;
    if (i >= n) break;
    let tok = '';
    while (i < n && !/\s/.test(line[i])) {
      const c = line[i];
      if (c === '"' || c === "'") {
        const q = c;
        i++;
        while (i < n && line[i] !== q) { tok += line[i]; i++; }
        i++;
      } else { tok += c; i++; }
    }
    tokens.push(tok);
  }
  return tokens;
}

function runSelectedStep(step, log) {
  const codeLines = step.run.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  let output = '';
  for (const line of codeLines) {
    const tokens = tokenizeRunLine(line); // tokens[0] is the literal "node" from the workflow text
    try {
      output += execFileSync(process.execPath, tokens.slice(1), { cwd: ROOT, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      output += (e.stdout || '') + (e.stderr || '');
      log(`  FAIL ${step.name}`);
      for (const l of output.trim().split('\n').slice(-20)) log(`    ${l}`);
      return { ok: false, output };
    }
  }
  log(`  ok ${step.name}`);
  return { ok: true, output };
}

const STRUCTURAL_CHAIN = [
  { label: 'lint-plugins.mjs', args: [join(ROOT, 'scripts', 'lint-plugins.mjs')] },
  { label: 'check-no-deps.mjs', args: [join(ROOT, 'scripts', 'check-no-deps.mjs')] },
  { label: 'build-codex-marketplace.mjs --check', args: [join(ROOT, 'scripts', 'build-codex-marketplace.mjs'), '--check'] },
  { label: 'build-opencode-dist.mjs --check', args: [join(ROOT, 'scripts', 'build-opencode-dist.mjs'), '--check'] },
];

// ---------------------------------------------------------------- CLI

async function main() {
  const { flags } = parseOrDie(process.argv.slice(2), {
    base: { value: true, default: 'origin/main' },
    bump: { value: true, many: true },
    full: { value: false },
    'dry-run': { value: false },
  }, USAGE);

  const base = flags.base;
  const dryRun = Boolean(flags['dry-run']);
  const full = Boolean(flags.full);
  const bumpMap = new Map();
  for (const spec of flags.bump) {
    const m = /^([^:]+):(major|minor|patch)$/.exec(spec);
    if (!m) { console.error(`x --bump ${spec} must be <plugin>:<major|minor|patch>`); process.exit(2); }
    bumpMap.set(m[1], m[2]);
  }
  if (!gitTry(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).ok) {
    console.error(`x --base ${base} does not resolve to a commit`);
    process.exit(2);
  }

  const changed = changedSet(base);
  console.log(`# integrate-branch  base=${base}${dryRun ? '  (dry-run)' : ''}`);
  console.log(`changed set (${changed.length}):`);
  for (const p of changed) console.log(`  ${p}`);

  let anyFailed = false;
  const judgmentItems = [];

  console.log('\n== step 1: plugin version bump ==');
  const bumpResult = runBumpStep({ base, changed, bumpMap, dryRun, log: (l) => console.log(l) });
  if (bumpResult.failed.length) anyFailed = true;
  judgmentItems.push(...bumpResult.judgmentItems);

  console.log('\n== step 5 selection (workflow steps) ==');
  const workflowPath = join(ROOT, '.github', 'workflows', 'validate.yml');
  const steps = parseWorkflowJobSteps(readFileSync(workflowPath, 'utf8'), 'structural-lint');
  const { selected, skipped } = selectSteps({ steps, changedPaths: changed, full, evalDirRefersToScript: makeEvalDirRefersToScript() });
  for (const { step, reason } of selected) console.log(`  select  ${step.name}  - ${reason}`);
  for (const { step, reason } of skipped) console.log(`  skip    ${step.name}  - ${reason}`);

  if (dryRun) {
    console.log('\n== step 4: atlas (read-only preview) ==');
    const atlas = runAtlasStep((l) => console.log(l));
    judgmentItems.push(...atlas.judgmentItems);
    console.log('\n--dry-run: no build, docs-manifest, or gate step was executed.');
    const pending = judgmentItems.length > 0;
    if (pending) { console.log('\npending judgment item(s):'); for (const j of judgmentItems) console.log(`  - ${j}`); }
    process.exit(anyFailed || pending ? 1 : 0);
  }

  console.log('\n== step 2: regenerate host distributions ==');
  if (!runBuildStep((l) => console.log(l))) anyFailed = true;

  console.log('\n== step 3: documentation manifest ==');
  if (!runDocsStep((l) => console.log(l))) anyFailed = true;

  console.log('\n== step 4: atlas freshness ==');
  const atlas = runAtlasStep((l) => console.log(l));
  judgmentItems.push(...atlas.judgmentItems);

  console.log('\n== step 5: gates ==');
  const gateResults = [];
  for (const gate of STRUCTURAL_CHAIN) {
    const r = runNode(gate.args, { label: gate.label, log: (l) => console.log(l) });
    gateResults.push({ name: gate.label, ok: r.ok });
  }
  for (const { step } of selected) {
    const r = runSelectedStep(step, (l) => console.log(l));
    gateResults.push({ name: step.name, ok: r.ok });
  }
  const failedGates = gateResults.filter((g) => !g.ok);
  if (failedGates.length) anyFailed = true;

  console.log('\n== summary ==');
  for (const g of gateResults) console.log(`  ${g.ok ? 'PASS' : 'FAIL'}  ${g.name}`);
  const pending = judgmentItems.length > 0;
  if (pending) { console.log('\npending judgment item(s):'); for (const j of judgmentItems) console.log(`  - ${j}`); }
  console.log(`\n${anyFailed ? 'FAILED' : 'OK'} - ${anyFailed ? 'one or more steps failed' : 'every step passed'}${pending ? '; judgment item(s) pending' : ''}.`);
  process.exit(anyFailed || pending ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
