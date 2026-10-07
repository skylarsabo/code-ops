// Baseline adoption, citation resolution, identity, and atomic writes. The body moved verbatim from the former single-file eval.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractCitations, recordId, resolvePrefix, writeAtomically } from '../../scripts/record-lib.mjs';
import { UUID, COLLECTION, work, check, run, git, commit, write, fixtureManifest, generated, seedFixture } from './harness.mjs';

export function runSection() {
  let result;
  const repo = seedFixture();

  result = run(['adopt', '--root', repo, ...COLLECTION], repo);
  check('adoption writes all four baselines', result.status === 0
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => existsSync(generated(repo, name))), result.output);
  const ambientRootAlias = join(work, 'ambient-root-alias');
  symlinkSync(repo, ambientRootAlias, process.platform === 'win32' ? 'junction' : 'dir');
  result = run(['render', '--root', ambientRootAlias, ...COLLECTION], ambientRootAlias);
  check('ambient repository root aliases permit representative writes', result.status === 0, result.output);
  const linkedOutputRepo = join(work, 'linked-output');
  cpSync(repo, linkedOutputRepo, { recursive: true });
  const linkedOutput = join(linkedOutputRepo, 'hub', '98 System', 'Records');
  const linkedOutputTarget = join(work, 'linked-output-target');
  const preservedIndex = readFileSync(join(repo, 'hub', '98 System', 'Records', 'index.md'), 'utf8');
  rmSync(linkedOutput, { recursive: true, force: true });
  mkdirSync(linkedOutputTarget, { recursive: true });
  for (const name of ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md']) {
    writeFileSync(join(linkedOutputTarget, name), readFileSync(generated(repo, name)));
  }
  symlinkSync(linkedOutputTarget, linkedOutput, process.platform === 'win32' ? 'junction' : 'dir');
  result = run(['render', '--root', linkedOutputRepo, ...COLLECTION], linkedOutputRepo);
  check('intra-repository aliases still reject writes before mutation', result.status === 1
    && result.output.includes('path escapes repository through a link')
    && readFileSync(join(linkedOutputTarget, 'index.md'), 'utf8') === preservedIndex, result.output);

  const inventory = JSON.parse(readFileSync(generated(repo, 'inventory.json'), 'utf8'));
  const citations = JSON.parse(readFileSync(generated(repo, 'citations.json'), 'utf8')).entries;
  const firstId = inventory.entries[0].id;
  check('identity is deterministic and label-independent', firstId === recordId(UUID, 'records/one.md'), firstId);
  check('collection split changes the namespace', firstId !== recordId('22222222-2222-4222-8222-222222222222', 'records/one.md'));
  check('exact Git path casing is identity-bearing', firstId !== recordId(UUID, 'records/ONE.md'));
  let nonNfcRejected = false;
  try { recordId(UUID, 'records/cafe\u0301.md'); } catch { nonNfcRejected = true; }
  check('non-NFC paths are rejected', nonNfcRejected);
  let drivePathRejected = false;
  try { recordId(UUID, 'C:/Windows/System32/evidence.md'); } catch { drivePathRejected = true; }
  check('Windows drive-qualified record paths are rejected on every platform', drivePathRejected);
  check('eight-character prefixes resolve', resolvePrefix(firstId.slice(0, 12), [firstId]) === firstId);
  let ambiguousPrefix = false;
  try { resolvePrefix('REC-AAAAAAAA', ['REC-AAAAAAAAAAAAAAAAAAAAAAAAAA', 'REC-AAAAAAAABBBBBBBBBBBBBBBBBB']); } catch { ambiguousPrefix = true; }
  check('ambiguous short prefixes fail', ambiguousPrefix);
  check('an unmatched backtick does not suppress a live citation', extractCitations('unmatched ` then [proof](records/missing.json)').length === 1);
  check('a shorter fence cannot close a longer fence', extractCitations('````md\n[hidden](records/missing.json)\n```\n[still hidden](records/missing.json)\n````').length === 0);
  check('multiline code spans do not create citation debt', extractCitations('`code span\n[example](records/missing.json)\n`').length === 0);
  check('unequal backtick runs remain literal citation text', extractCitations('`` [proof](records/missing.json) ```').length === 1);
  check('escaped backticks remain literal citation text', extractCitations('\\` [proof](records/missing.json) \\`').length === 1);
  check('escaped link openers do not create citation debt', extractCitations('Literal: \\[proof](records/missing.json)').length === 0);
  check('indented code blocks do not create citation debt', extractCitations('    [proof](records/missing.json)').length === 0);
  check('citation extraction resumes when a blockquote fence container ends',
    extractCitations('> ```yaml\n> example: true\n[proof](records/missing.json)').length === 1);
  check('citation extraction resumes when a list fence container ends',
    extractCitations('- example\n  ```yaml\n  hidden: true\n\n[proof](records/missing.json)').length === 1);
  check('invalid backtick-fence info strings do not suppress citations',
    extractCitations('```yaml `invalid\n[proof](records/missing.json)').length === 1);
  let unterminatedCitationError = '';
  try {
    extractCitations('```yaml\nexample: true\n[proof](records/missing.json)', 'records/broken.md');
  } catch (error) {
    unterminatedCitationError = String(error);
  }
  check('citation extraction rejects an unterminated fence',
    unterminatedCitationError.includes('unterminated Markdown fence in records/broken.md:1'),
    unterminatedCitationError);
  const atomicDir = join(work, 'atomic-probe'); mkdirSync(join(atomicDir, 'not-a-file'), { recursive: true });
  writeFileSync(join(atomicDir, 'first.txt'), 'before');
  let atomicRejected = false;
  try { writeAtomically([[join(atomicDir, 'first.txt'), 'after'], [join(atomicDir, 'not-a-file'), 'invalid']]); } catch { atomicRejected = true; }
  check('atomic preflight preserves earlier files when a later destination is invalid', atomicRejected
    && readFileSync(join(atomicDir, 'first.txt'), 'utf8') === 'before');
  const atomicRealDir = join(work, 'atomic-real');
  const atomicAliasDir = join(work, 'atomic-alias');
  mkdirSync(atomicRealDir, { recursive: true });
  writeFileSync(join(atomicRealDir, 'evidence.md'), 'immutable evidence');
  let symlinkWriteRejected = false;
  try {
    symlinkSync(atomicRealDir, atomicAliasDir, process.platform === 'win32' ? 'junction' : 'dir');
    try { writeAtomically([[join(atomicAliasDir, 'evidence.md'), 'clobbered']]); }
    catch { symlinkWriteRejected = true; }
  } catch { symlinkWriteRejected = process.platform === 'win32'; }
  check('atomic writes reject symlinked parent directories before changing evidence', symlinkWriteRejected
    && readFileSync(join(atomicRealDir, 'evidence.md'), 'utf8') === 'immutable evidence');

  const ambiguousRepo = join(work, 'ambiguous-history'); mkdirSync(ambiguousRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], ambiguousRepo);
  git(['config', 'user.email', 'eval@example.com'], ambiguousRepo);
  git(['config', 'user.name', 'Eval'], ambiguousRepo);
  write(ambiguousRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(ambiguousRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(ambiguousRepo, 'base without target');
  git(['checkout', '-qb', 'left'], ambiguousRepo);
  write(ambiguousRepo, 'records/mutable/branch.json', '{"branch":"A"}\n'); commit(ambiguousRepo, 'target A');
  git(['checkout', '-q', 'main'], ambiguousRepo);
  git(['checkout', '-qb', 'right'], ambiguousRepo);
  write(ambiguousRepo, 'records/mutable/branch.json', '{"branch":"B"}\n'); commit(ambiguousRepo, 'target B');
  git(['checkout', '-q', 'main'], ambiguousRepo);
  git(['merge', '--no-ff', 'left', '-m', 'merge left'], ambiguousRepo);
  try { git(['merge', '--no-ff', 'right', '-m', 'merge right'], ambiguousRepo); } catch { /* resolve add/add as deletion */ }
  if (existsSync(join(ambiguousRepo, 'records', 'mutable', 'branch.json'))) unlinkSync(join(ambiguousRepo, 'records', 'mutable', 'branch.json'));
  git(['add', '-A'], ambiguousRepo);
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', 'merge right with target deleted'], ambiguousRepo);
  write(ambiguousRepo, 'records/one.md', '# Record\n\n[target](records/mutable/branch.json)\n'); commit(ambiguousRepo, 'add record after deletion');
  result = run(['adopt', '--root', ambiguousRepo, ...COLLECTION], ambiguousRepo);
  const ambiguousCitations = result.status === 0
    ? JSON.parse(readFileSync(generated(ambiguousRepo, 'citations.json'), 'utf8')).entries : [];
  check('divergent reachable history remains ambiguous instead of choosing a branch', result.status === 0
    && ambiguousCitations.some((item) => item.state === 'ambiguous' && item.historicalCandidates?.length === 2 && !item.target), result.output);

  const futureRepo = join(work, 'future-history'); mkdirSync(futureRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], futureRepo);
  write(futureRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(futureRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(futureRepo, 'records/one.md', '# Record\n\n[future](records/mutable/future.json)\n'); commit(futureRepo, 'record before target');
  write(futureRepo, 'records/mutable/future.json', '{"future":true}\n'); commit(futureRepo, 'future target');
  result = run(['adopt', '--root', futureRepo, ...COLLECTION], futureRepo);
  const futureCitations = result.status === 0 ? JSON.parse(readFileSync(generated(futureRepo, 'citations.json'), 'utf8')).entries : [];
  check('adoption never binds content created after record introduction', result.status === 0
    && futureCitations.some((item) => item.rawTarget.endsWith('future.json') && item.state === 'dead-at-adoption' && !item.target), result.output);
  check('defensive literal-bracket path resolves exact first', citations.some((item) => item.rawTarget === 'records/literal[0].json'
    && item.resolvedVia.join(',') === 'exact' && item.state === 'resolved-immutable'), JSON.stringify(citations));
  check('compound suffixes retain applied order', citations.some((item) => item.rawTarget.includes('["PRIMARY"]#summary')
    && item.resolvedVia.join(',') === 'accessor-stripped,fragment-stripped'), JSON.stringify(citations));
  check('repeated accessors resolve in order', citations.some((item) => item.rawTarget.includes('["A"][0]')
    && item.resolvedVia.join(',') === 'accessor-stripped,accessor-stripped'), JSON.stringify(citations));
  check('range, symbol, fragment, and relative forms resolve', ['range-stripped', 'symbol-stripped', 'fragment-stripped'].every((via) => citations.some((item) => item.resolvedVia.includes(via)))
    && citations.some((item) => item.rawTarget.startsWith('./') && item.state === 'resolved-mutable'), JSON.stringify(citations));
  check('glob and baseline-dead citations remain visible debt', citations.some((item) => item.state === 'glob')
    && citations.some((item) => item.state === 'dead-at-adoption'), JSON.stringify(citations));
  check('Markdown image destinations are inventoried and digest-pinned', citations.some((item) => item.rawTarget.endsWith('chart.png')
    && item.state === 'resolved-mutable' && /^[0-9a-f]{64}$/.test(item.target.targetSha256)), JSON.stringify(citations));
  check('reference links and images resolve at their use sites', citations.some((item) => item.rawTarget === 'records/mutable/result.json' && item.sourceLine === 14)
    && citations.some((item) => item.rawTarget === 'records/mutable/chart.png' && item.sourceLine === 15), JSON.stringify(citations));
  check('shortcut and collapsed references resolve', citations.some((item) => item.rawTarget === 'records/mutable/stream.jsonl')
    && citations.some((item) => item.rawTarget === 'records/frozen/stable.json'), JSON.stringify(citations));
  check('fenced and inline code examples are not citations', !citations.some((item) => item.rawTarget.includes('never-code') || item.rawTarget.includes('never-fence')), JSON.stringify(citations));
  check('deleted targets recover as digest-pinned redirects', citations.some((item) => item.rawTarget.endsWith('old.json')
    && item.state === 'redirected' && /^[0-9a-f]{64}$/.test(item.target.targetSha256)), JSON.stringify(citations));

  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('fresh adoption passes semantic and history checks', result.status === 0
    && inventory.artifacts.every((artifact) => artifact.provenance === 'adopted'), result.output);
  commit(repo, 'adopt records');

}
