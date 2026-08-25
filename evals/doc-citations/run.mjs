#!/usr/bin/env node
// Regression coverage for manifest-routed citation checks and citation syntax enforcement.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'scripts', 'check-doc-citations.mjs');
const work = mkdtempSync(join(tmpdir(), 'coh-doc-citations-'));
const failures = [];
const check = (name, pass, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); if (!pass) failures.push(`${name}: ${detail}`); };
const run = (script, cwd, args = []) => {
  try { return { status: 0, out: execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' }) }; }
  catch (error) { return { status: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` }; }
};
const git = (args, cwd) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
function buildCase(name, currentBody, ignoredBody = '') {
  const root = join(work, name);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'project-docs', '98 System'), { recursive: true });
  mkdirSync(join(root, 'project-docs', 'Reference'), { recursive: true });
  mkdirSync(join(root, 'project-docs', 'Ignored'), { recursive: true });
  mkdirSync(join(root, 'source', 'Interior Space'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'check-doc-citations.mjs'), readFileSync(SCRIPT));
  writeFileSync(join(root, 'scripts', 'target.mjs'), Array.from({ length: 10 }, (_, i) => `// ${i + 1}`).join('\n') + '\n');
  writeFileSync(join(root, 'source', 'Interior Space', 'target.mjs'), '// spaced directory\n');
  writeFileSync(join(root, 'project-docs', 'Reference', 'test.md'), currentBody);
  writeFileSync(join(root, 'project-docs', 'Ignored', 'ignored.md'), ignoredBody);
  writeFileSync(join(root, 'project-docs', '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify({ version: 1, hub: 'project-docs', domains: [
    { id: 'reference', path: 'Reference', status: 'current', sources: [], sourceDigest: '', contentDigest: '' },
    { id: 'ignored', path: 'Ignored', status: 'not-applicable', evidence: 'The ignored target is deliberately excluded from this regression fixture.', sources: [], sourceDigest: '', contentDigest: '' },
  ] }, null, 2)}\n`);
  git(['init', '--quiet', '-b', 'main'], root); git(['add', '-A'], root);
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'seed'], root);
  return { root, script: join(root, 'scripts', 'check-doc-citations.mjs') };
}
try {
  {
    const fixture = buildCase('valid', 'See `scripts/target.mjs:3`, `scripts/target.mjs:2-9`, and `source/Interior Space/target.mjs:1`.\n');
    const result = run(fixture.script, fixture.root);
    check('manifest targets pass valid citations', result.status === 0 && result.out.includes('manifest-owned'), result.out);
  }
  {
    const fixture = buildCase('manifest-v2', 'See `scripts/target.mjs:3`.\n');
    const manifestPath = join(fixture.root, 'project-docs', '98 System', 'DOCS_MANIFEST.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    Object.assign(manifest, { version: 2, runs: { tracking: 'ignored' }, recordCollections: [], legacyPaths: [] });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = run(fixture.script, fixture.root);
    check('manifest v2 targets receive the same citation gate', result.status === 0 && result.out.includes('manifest-owned'), result.out);
  }
  {
    const fixture = buildCase('not-applicable', '# Current\n', 'Broken `scripts/nope.mjs:999` in recorded non-applicability evidence.\n');
    const result = run(fixture.script, fixture.root);
    check('not-applicable target remains citation-gated', result.status === 1 && result.out.includes('target file does not exist'), result.out);
  }
  {
    const fixture = buildCase('oob', 'See `scripts/target.mjs:11`.\n');
    const result = run(fixture.script, fixture.root);
    check('out-of-bounds citation fails closed', result.status === 1 && result.out.includes("exceeds target's 10 line(s)"), result.out);
  }
  {
    const fixture = buildCase('missing', 'See `scripts/nope.mjs:1`.\n');
    const result = run(fixture.script, fixture.root);
    check('missing citation target fails closed', result.status === 1 && result.out.includes('target file does not exist'), result.out);
  }
  {
    const fixture = buildCase('bracket-missing', 'See [scripts/nope.mjs:1] for details.\n');
    const result = run(fixture.script, fixture.root);
    check('bracketed citation is detected', result.status === 1 && result.out.includes('scripts/nope.mjs:1'), result.out);
  }
  {
    const fixture = buildCase('bare-prose', 'See scripts/target.mjs:3 for details.\n');
    const result = run(fixture.script, fixture.root);
    check('preceding prose is not swallowed into bare citation', result.status === 0, result.out);
  }
  {
    const fixture = buildCase('spaced-filename', 'A filename with spaces is prose, not a citation: `scripts/missing target.mjs:1`.\n');
    const result = run(fixture.script, fixture.root);
    check('spaces are allowed only in interior directory segments', result.status === 0, result.out);
  }
  {
    const fixture = buildCase('fence', '```text\nscripts/nope.mjs:999\n```\n');
    const result = run(fixture.script, fixture.root);
    check('fenced citation is ignored', result.status === 0, result.out);
  }
  {
    const fixture = buildCase('range', 'See `scripts/target.mjs:9-2`.\n');
    const result = run(fixture.script, fixture.root);
    check('inverted range fails closed', result.status === 1 && result.out.includes('range end 2 is before start 9'), result.out);
  }
  {
    const fixture = buildCase('flag', '# Fixture\n');
    const result = run(fixture.script, fixture.root, ['--verbose']);
    check('unknown flag exits two', result.status === 2, result.out);
  }
} finally { rmSync(work, { recursive: true, force: true }); }
if (failures.length) { console.error(`\n${failures.join('\n')}`); process.exit(1); }
console.log('\ndoc-citations eval passed');
