#!/usr/bin/env node
// Regression coverage for manifest-routed line and commit citation checks.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(REPO, 'scripts', 'check-doc-citations.mjs');
const RECORD_LIB = join(REPO, 'scripts', 'record-lib.mjs');
const work = mkdtempSync(join(tmpdir(), 'coh-doc-citations-'));
const failures = [];
const check = (name, pass, detail = '') => {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`);
  if (!pass) failures.push(`${name}: ${detail}`);
};
const run = (script, cwd, args = []) => {
  try { return { status: 0, out: execFileSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' }) }; }
  catch (error) { return { status: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` }; }
};
const git = (args, cwd) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' }).trim();
function buildCase(name, currentBody, ignoredBody = '') {
  const root = join(work, name);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'project-docs', '98 System'), { recursive: true });
  mkdirSync(join(root, 'project-docs', 'Reference'), { recursive: true });
  mkdirSync(join(root, 'project-docs', 'Ignored'), { recursive: true });
  mkdirSync(join(root, 'source', 'Interior Space'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'check-doc-citations.mjs'), readFileSync(SCRIPT));
  writeFileSync(join(root, 'scripts', 'record-lib.mjs'), readFileSync(RECORD_LIB));
  writeFileSync(join(root, 'scripts', 'target.mjs'), Array.from({ length: 10 }, (_, i) => `// ${i + 1}`).join('\n') + '\n');
  writeFileSync(join(root, 'source', 'Interior Space', 'target.mjs'), '// spaced directory\n');
  writeFileSync(join(root, 'project-docs', 'Reference', 'test.md'), currentBody);
  writeFileSync(join(root, 'project-docs', 'Ignored', 'ignored.md'), ignoredBody);
  writeFileSync(join(root, 'project-docs', '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify({ version: 1, hub: 'project-docs', domains: [
    { id: 'reference', path: 'Reference', status: 'current', sources: [], sourceDigest: '', contentDigest: '' },
    { id: 'ignored', path: 'Ignored', status: 'not-applicable', evidence: 'The ignored target is deliberately included in this regression fixture.', sources: [], sourceDigest: '', contentDigest: '' },
  ] }, null, 2)}\n`);
  git(['init', '--quiet', '-b', 'main'], root);
  git(['add', '-A'], root);
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'seed'], root);
  return { root, script: join(root, 'scripts', 'check-doc-citations.mjs'), head: git(['rev-parse', 'HEAD'], root) };
}
function setCurrentBody(fixture, body) { writeFileSync(join(fixture.root, 'project-docs', 'Reference', 'test.md'), body); }
try {
  {
    const f = buildCase('valid', 'See `scripts/target.mjs:3`, `scripts/target.mjs:2-9`, and `source/Interior Space/target.mjs:1`.\n');
    const r = run(f.script, f.root);
    check('manifest targets pass valid citations', r.status === 0 && r.out.includes('manifest-owned'), r.out);
  }
  {
    const f = buildCase('manifest-v2', 'See `scripts/target.mjs:3`.\n');
    const path = join(f.root, 'project-docs', '98 System', 'DOCS_MANIFEST.json');
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    Object.assign(manifest, { version: 2, runs: { tracking: 'ignored' }, recordCollections: [], legacyPaths: [] });
    writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
    check('manifest v2 targets receive the same citation gate', run(f.script, f.root).status === 0);
  }
  {
    const f = buildCase('not-applicable', '# Current\n', 'Broken `scripts/nope.mjs:999` in recorded non-applicability evidence.\n');
    const r = run(f.script, f.root);
    check('not-applicable target remains citation-gated', r.status === 1 && r.out.includes('target file does not exist'), r.out);
  }
  {
    const f = buildCase('oob', 'See `scripts/target.mjs:11`.\n');
    const r = run(f.script, f.root);
    check('out-of-bounds citation fails closed', r.status === 1 && r.out.includes("exceeds target's 10 line(s)"), r.out);
  }
  {
    const f = buildCase('missing', 'See `scripts/nope.mjs:1`.\n');
    const r = run(f.script, f.root);
    check('missing citation target fails closed', r.status === 1 && r.out.includes('target file does not exist'), r.out);
  }
  {
    const f = buildCase('bracket-missing', 'See [scripts/nope.mjs:1] for details.\n');
    const r = run(f.script, f.root);
    check('bracketed citation is detected', r.status === 1 && r.out.includes('scripts/nope.mjs:1'), r.out);
  }
  {
    const f = buildCase('bare-prose', 'See scripts/target.mjs:3 for details.\n');
    check('preceding prose is not swallowed into bare citation', run(f.script, f.root).status === 0);
  }
  {
    const f = buildCase('spaced-filename', 'A filename with spaces is prose, not a citation: `scripts/missing target.mjs:1`.\n');
    check('spaces are allowed only in interior directory segments', run(f.script, f.root).status === 0);
  }
  {
    const f = buildCase('fence', '```text\nscripts/nope.mjs:999\n```\n');
    check('fenced line citation is ignored', run(f.script, f.root).status === 0);
  }
  {
    const f = buildCase('range', 'See `scripts/target.mjs:9-2`.\n');
    const r = run(f.script, f.root);
    check('inverted range fails closed', r.status === 1 && r.out.includes('range end 2 is before start 9'), r.out);
  }
  {
    const f = buildCase('flag', '# Fixture\n');
    check('unknown flag exits two', run(f.script, f.root, ['--verbose']).status === 2);
  }
  {
    const f = buildCase('commit-forms', '# Evidence\n');
    setCurrentBody(f, `Verified-at: ${f.head}\nOBSOLETE-AT: ${f.head.slice(0, 7)}\nImplementation evidence: commit \`${f.head}\`\n`);
    check('reachable commits pass all three field forms', run(f.script, f.root).status === 0);
  }
  {
    const f = buildCase('missing-commit', 'Verified-at: 0000000000000000000000000000000000000000\n');
    const r = run(f.script, f.root);
    check('missing commit fails closed', r.status === 1 && r.out.includes('does not resolve'), r.out);
  }
  {
    const f = buildCase('malformed-commit', 'Verified-at:\nVerified-at: abcdef\nOBSOLETE-AT: deadbeeZ\nImplementation evidence: commit `1234567` trailing\n');
    const r = run(f.script, f.root);
    check('missing, malformed, and trailing values fail closed', r.status === 1 && r.out.includes('is missing') && r.out.includes('at least 7') && r.out.includes('must be hexadecimal') && r.out.includes('trailing content'), r.out);
  }
  {
    const f = buildCase('overlong-commit', '# Evidence\n');
    setCurrentBody(f, `Verified-at: ${f.head}0\n`);
    const r = run(f.script, f.root);
    check('overlong full object ID fails closed', r.status === 1 && r.out.includes('exceeds this repository'), r.out);
  }
  {
    const f = buildCase('unreachable-commit', '# Evidence\n');
    git(['checkout', '--orphan', 'orphan'], f.root);
    git(['rm', '-rf', '.'], f.root);
    writeFileSync(join(f.root, 'orphan.txt'), 'orphan\n');
    git(['add', 'orphan.txt'], f.root);
    git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'orphan'], f.root);
    const orphan = git(['rev-parse', 'HEAD'], f.root);
    git(['checkout', '--quiet', 'main'], f.root);
    setCurrentBody(f, `Verified-at: ${orphan}\n`);
    const r = run(f.script, f.root);
    check('present but unreachable commit fails durable reachability', r.status === 1 && r.out.includes('not a durable ancestor'), r.out);
  }
  {
    const f = buildCase('commit-fence-pin', '```text\nVerified-at: deadbeef\n```\n~~~text\nVerified-at: deadbeef\n~~~\n````text\n```\nVerified-at: deadbeef\n````\nDependency pin: package@deadbeef\n');
    check('backtick and tilde fences plus third-party at-pins are inert', run(f.script, f.root).status === 0);
  }
  {
    const f = buildCase('commit-inline-code', 'Literal `Verified-at: deadbeef` remains an example.\n');
    check('closed inline-code fields are inert', run(f.script, f.root).status === 0);
    setCurrentBody(f, 'Unmatched ` then Verified-at: deadbeef\n');
    const r = run(f.script, f.root);
    check('unmatched backticks cannot suppress live fields', r.status === 1 && r.out.includes('does not resolve'), r.out);
  }
  {
    const f = buildCase('shallow-history', 'Verified-at: 0000000000000000000000000000000000000000\n');
    writeFileSync(join(f.root, '.git', 'shallow'), `${f.head}\n`);
    const r = run(f.script, f.root);
    check('shallow missing history is a distinct infrastructure failure', r.status === 2 && r.out.includes('infrastructure failure: shallow repository'), r.out);
  }
} finally { rmSync(work, { recursive: true, force: true }); }
if (failures.length) { console.error(`\n${failures.join('\n')}`); process.exit(1); }
console.log('\ndoc-citations eval passed');
