#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const snapshotScript = join(repo, 'scripts', 'context-snapshot.mjs');
const bundleScript = join(repo, 'scripts', 'context-bundle.mjs');
const outer = mkdtempSync(join(tmpdir(), 'coh-bundle-'));
const root = join(outer, 'repo');
const runDir = join(root, 'run');
const cache = join(outer, 'cache');
const failures = [];
const check = (name, pass, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); if (!pass) failures.push(`${name}: ${detail}`); };
const run = (script, args) => { try { return { status: 0, out: execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' }) }; } catch (error) { return { status: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` }; } };
try {
  mkdirSync(join(root, 'src'), { recursive: true }); mkdirSync(join(root, 'other')); mkdirSync(runDir); mkdirSync(join(root, 'docs', 'atlas', 'sections'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'run/\n');
  writeFileSync(join(root, 'src', 'a.js'), "import { b } from './b.js';\nexport const a = b;\n");
  writeFileSync(join(root, 'src', 'b.js'), 'export const b = 1;\n'); writeFileSync(join(root, 'other', 'c.js'), 'export const c = 2;\n');
  execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['config', 'user.email', 'eval@example.test'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'Eval'], { cwd: root }); execFileSync('git', ['add', '.'], { cwd: root }); execFileSync('git', ['commit', '-qm', 'initial'], { cwd: root }); const initialHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  writeFileSync(join(root, 'docs', 'atlas', 'sections', 'source.md'), 'fresh atlas excerpt\n'); writeFileSync(join(root, 'docs', 'atlas', 'MANIFEST.json'), JSON.stringify({ version: 1, sections: [{ slug: 'source', file: 'sections/source.md', scope: ['src/a.js'], verifiedAt: initialHead }] })); execFileSync('git', ['add', 'docs'], { cwd: root }); execFileSync('git', ['commit', '-qm', 'atlas'], { cwd: root });
  const snapshotPath = join(runDir, 'CONTEXT_SNAPSHOT.json'); let result = run(snapshotScript, ['prepare', '--root', root, '--out', snapshotPath, '--cache', cache, '--atlas', 'docs/atlas']);
  check('snapshot prepares', result.status === 0, result.out); const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const base = {
    version: 2, revision: 1, runId: 'bundle-eval', head: snapshot.head, objective: 'Evaluate bounded context bundles.', nonGoals: ['No implementation.'],
    lead: { model: 'gpt-5.6-sol', tier: 'frontier', effort: 'high' }, quality: { dimensions: ['correctness'], criteria: [{ id: 'Q-001', dimension: 'correctness', description: 'Bundle is scoped.', oracle: 'command', proof: 'Eval passes.', blocking: true, owner: 'tool' }] },
    budget: { maxDispatches: 1, maxParallel: 1, maxRetriesPerUnit: 1 }, sharedContext: ['README.md'], replanOn: ['scope-change', 'new-dependency', 'failed-dispatch', 'quality-gate-failure', 'context-drift'],
    context: { snapshot: 'CONTEXT_SNAPSHOT.json', snapshotId: snapshot.snapshotId, bundleDir: 'bundles', untrackedPolicy: 'metadata', maxBundleBytes: 20000, maxAtlasExcerptBytes: 1000 },
    units: [{ id: 'D-001', phase: 'test', wave: 1, lens: 'scope', mode: 'read', role: 'explorer', kind: 'breadth', model: 'gpt-5.6-terra', tier: 'strong', effort: 'medium', brief: 'Inspect scoped imports', scope: ['src/a.js'], artifact: 'reports/D-001.md', dependsOn: [], qualityCriteria: ['Q-001'] }],
  };
  const contractPath = join(runDir, 'RUN_CONTRACT.json'); writeFileSync(contractPath, `${JSON.stringify(base, null, 2)}\n`);
  const out = join(runDir, 'bundles', 'D-001.json'); result = run(bundleScript, ['build', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--cache', cache, '--out', out]);
  const bundle = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  check('bundle includes scope and direct dependency only', result.status === 0 && bundle.context.files.some((file) => file.path === 'src/a.js') && bundle.context.files.some((file) => file.path === 'src/b.js') && !bundle.context.files.some((file) => file.path === 'other/c.js'), result.out);
  check('bundle actualBytes equals its final serialized byte length', bundle.actualBytes === Buffer.byteLength(readFileSync(out)), JSON.stringify({ actualBytes: bundle.actualBytes }));
  check('fresh atlas output includes a bounded excerpt', bundle.context.atlas[0]?.verdict === 'FRESH' && bundle.context.atlas[0]?.excerpt === 'fresh atlas excerpt\n', JSON.stringify(bundle.context.atlas));
  base.context.maxAtlasExcerptBytes = 1; writeFileSync(contractPath, `${JSON.stringify(base, null, 2)}\n`); result = run(bundleScript, ['build', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--cache', cache, '--out', out]); const overflowAtlas = JSON.parse(readFileSync(out, 'utf8')); check('fresh atlas excerpt respects its independent budget', result.status === 0 && overflowAtlas.context.atlas[0]?.verdict === 'FRESH' && overflowAtlas.context.atlas[0]?.excerpt === null, result.out); base.context.maxAtlasExcerptBytes = 1000; writeFileSync(contractPath, `${JSON.stringify(base, null, 2)}\n`);
  const previousPath = join(runDir, 'PREVIOUS_SNAPSHOT.json'); writeFileSync(previousPath, JSON.stringify(snapshot)); const deltaPath = join(runDir, 'CONTEXT_DELTA.json'); result = run(snapshotScript, ['delta', '--from', previousPath, '--to', snapshotPath, '--out', deltaPath]); const forged = JSON.parse(readFileSync(deltaPath, 'utf8')); forged.payload = 'must-not-pass'; writeFileSync(deltaPath, JSON.stringify(forged)); result = run(bundleScript, ['build', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--cache', cache, '--out', out, '--previous', previousPath, '--delta', deltaPath]); check('schema-valid forged delta fails closed', result.status === 1 && /delta does not match/.test(result.out), result.out);
  result = run(snapshotScript, ['delta', '--from', previousPath, '--to', snapshotPath, '--out', deltaPath]); result = run(bundleScript, ['build', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--cache', cache, '--out', out, '--previous', previousPath, '--delta', deltaPath]); const deltaBundle = JSON.parse(readFileSync(out, 'utf8')); check('bound delta emits no arbitrary records outside scope', result.status === 0 && deltaBundle.context.delta.relevant.length === 0 && !JSON.stringify(deltaBundle.context.delta).includes('payload'), result.out);
  const forgedReceipt = { ...snapshot, state: { ...snapshot.state, staged: [{ status: 'A', path: 'src/a.js' }] } }; const forgedBoundDelta = JSON.parse(readFileSync(deltaPath, 'utf8')); forgedBoundDelta.changed.staged = forgedReceipt.state.staged; writeFileSync(snapshotPath, JSON.stringify(forgedReceipt)); writeFileSync(deltaPath, JSON.stringify(forgedBoundDelta)); result = run(bundleScript, ['build', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--cache', cache, '--out', out, '--previous', previousPath, '--delta', deltaPath]); check('tampered receipt state cannot authorize fabricated delta', result.status === 1 && /self-inconsistent/.test(result.out), result.out); writeFileSync(snapshotPath, JSON.stringify(snapshot));
  result = run(bundleScript, ['verify', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--bundle', out]); check('bundle verifies against contract', result.status === 0, result.out);
  base.units[0].scope = ['missing']; writeFileSync(contractPath, `${JSON.stringify(base, null, 2)}\n`); rmSync(out, { force: true }); result = run(bundleScript, ['build', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--cache', cache, '--out', out]); check('empty scope fails closed without a READY bundle', result.status === 1 && existsSync(`${out}.EMPTY_SCOPE`) && !existsSync(out), result.out);
  base.units[0].scope = ['src/a.js']; writeFileSync(contractPath, `${JSON.stringify(base, null, 2)}\n`); result = run(bundleScript, ['build', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--cache', cache, '--out', out]);
  check('later READY build clears stale empty-scope marker', result.status === 0 && !existsSync(`${out}.EMPTY_SCOPE`) && existsSync(out), result.out);
  base.units[0].scope = ['src']; writeFileSync(contractPath, `${JSON.stringify(base, null, 2)}\n`); result = run(bundleScript, ['build', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--cache', cache, '--out', out]);
  check('broad scope fails with explicit marker', result.status === 1 && existsSync(`${out}.BROAD_CONTEXT_REQUIRED`), result.out);
  base.units[0].scope = ['src/a.js']; base.context.maxBundleBytes = 250; writeFileSync(contractPath, `${JSON.stringify(base, null, 2)}\n`); result = run(bundleScript, ['build', '--root', root, '--contract', contractPath, '--unit', 'D-001', '--cache', cache, '--out', out]);
  check('byte overflow fails instead of truncating', result.status === 1 && existsSync(`${out}.BUDGET_EXCEEDED`), result.out);
  writeFileSync(join(root, 'src', 'a.js'), "import { b } from './b.js';\nexport const a = b + 1;\n"); result = run(snapshotScript, ['verify', '--root', root, '--snapshot', snapshotPath]); check('snapshot drift fails verification', result.status === 1, result.out);
} finally { rmSync(outer, { recursive: true, force: true }); }
if (failures.length) { console.error(`\n${failures.join('\n')}`); process.exit(1); }
console.log('\ncontext-bundle eval passed');
