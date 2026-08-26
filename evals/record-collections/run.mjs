#!/usr/bin/env node
// Synthetic-only regression coverage. The literal-bracket case is deliberately defensive.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digestJson, extractCitations, recordId, resolvePrefix, sha256, writeAtomically } from '../../scripts/record-lib.mjs';

const ROOT = process.cwd();
const SCRIPT = join(ROOT, 'scripts', 'records.mjs');
const failures = [];
const UUID = '11111111-1111-4111-8111-111111111111';
const COLLECTION = ['--collection', 'evidence'];
const expectedCases = process.platform === 'win32' ? 106 : 109;
let executedCases = 0;
let work;

function check(name, condition, detail = '') {
  executedCases += 1;
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) { failures.push(`${name}: ${detail}`); if (detail) console.log(detail); }
}
function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status ?? 1, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
}
function git(args, cwd, binary = false) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd, encoding: binary ? 'buffer' : 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function commit(repo, message) {
  git(['add', '-A'], repo);
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval', 'commit', '-qm', message], repo);
}
function squashCurrentTree(repo, message) {
  const tree = git(['rev-parse', 'HEAD^{tree}'], repo).trim();
  const head = git([
    '-c', 'user.email=eval@example.com', '-c', 'user.name=Eval',
    'commit-tree', tree, '-m', message,
  ], repo).trim();
  git(['reset', '--hard', head], repo);
}
function write(repo, path, text) {
  const target = join(repo, ...path.split('/'));
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, text);
}
function fixtureManifest() {
  return {
    version: 2, hub: 'hub', runs: { tracking: 'ignored' }, domains: [], legacyPaths: [],
    recordCollections: [{
      collectionUuid: UUID, id: 'evidence', identityVersion: 1, root: 'records',
      inventory: '98 System/Records/inventory.json', citations: '98 System/Records/citations.json',
      curationLedger: '98 System/Records/curation.jsonl', index: '98 System/Records/index.md',
      scopes: [
        { pattern: '*.md', kind: 'record', policy: 'append-only' },
        { pattern: 'mutable/**', kind: 'artifact', policy: 'mutable' },
        { pattern: 'frozen/**', kind: 'artifact', policy: 'frozen' },
        { pattern: 'exec/**', kind: 'executable', policy: 'frozen' },
        { pattern: 'literal[0].json', kind: 'artifact', policy: 'frozen' },
      ],
    }],
  };
}
function generated(repo, name) { return join(repo, 'hub', '98 System', 'Records', name); }
function restoreFromHead(repo, path) { write(repo, path, git(['show', `HEAD:${path}`], repo)); }

try {
  work = mkdtempSync(join(tmpdir(), 'code-ops-records-'));
  const repo = join(work, 'fixture');
  mkdirSync(repo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], repo);
  write(repo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(repo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(repo, 'records/mutable/result.json', '{"PRIMARY":{"summary":1},"A":[0]}\n');
  write(repo, 'records/mutable/stream.jsonl', '{"row":1}\n');
  write(repo, 'records/mutable/chart.png', 'synthetic-image-bytes');
  write(repo, 'records/frozen/stable.json', '{"stable":true}\n');
  write(repo, 'records/frozen/old.json', '{"historical":true}\n');
  write(repo, 'records/exec/probe.py', 'print("synthetic")\n');
  write(repo, 'records/literal[0].json', '{"literal":true}\n');
  write(repo, 'records/one.md', `# One

[literal](records/literal[0].json)
[compound](records/mutable/result.json["PRIMARY"]#summary)
[repeated](records/mutable/result.json["A"][0])
[range](records/frozen/stable.json:1-2)
[symbol](records/exec/probe.py::main)
[fragment](records/frozen/stable.json#stable)
[glob](records/mutable/*.json)
[dead](records/never-created.json)
[relative](./mutable/stream.jsonl#row)
![proof](records/mutable/chart.png)
[history](records/frozen/old.json)
[reference proof][artifact]
![reference image][chart-ref]
[shortcut]
[collapsed][]

\`[inline example](records/never-code.json)\`

~~~md
[fenced example](records/never-fence.json)
~~~

[artifact]: records/mutable/result.json
[chart-ref]: records/mutable/chart.png
[shortcut]: records/mutable/stream.jsonl
[collapsed]: records/frozen/stable.json
`);
  commit(repo, 'seed record and targets');
  unlinkSync(join(repo, 'records', 'frozen', 'old.json'));
  commit(repo, 'retire old target');

  let result = run(['classify', '--root', repo, ...COLLECTION], repo);
  check('Git-index classification is total', result.status === 0 && result.output.includes('append-only'), result.output);
  const rootCasingRepo = join(work, 'root-casing'); mkdirSync(rootCasingRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], rootCasingRepo);
  write(rootCasingRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  const rootCasingManifest = fixtureManifest();
  rootCasingManifest.recordCollections[0].root = 'RECORDS';
  write(rootCasingRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(rootCasingManifest, null, 2)}\n`);
  write(rootCasingRepo, 'records/one.md', '# Casing probe\n');
  commit(rootCasingRepo, 'seed mismatched root casing');
  result = run(['classify', '--root', rootCasingRepo, ...COLLECTION], rootCasingRepo);
  check('collection root casing must match the Git index', result.status === 1 && result.output.includes('root casing differs'), result.output);
  result = run(['classify', '--root', repo, ...COLLECTION, '--typo', 'ignored'], repo);
  check('unknown CLI options fail closed', result.status === 1 && result.output.includes('unknown option --typo'), result.output);
  result = run(['check', '--strict', '--root', repo, ...COLLECTION], repo);
  check('recognized options fail on the wrong command', result.status === 1 && result.output.includes('--strict is not valid for check'), result.output);
  result = run(['verify-history', '--root', repo, ...COLLECTION], repo);
  check('history verification requires explicit strict mode', result.status === 1 && result.output.includes('requires --strict'), result.output);

  const scopeV2Repo = join(work, 'scope-v2'); mkdirSync(scopeV2Repo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], scopeV2Repo);
  write(scopeV2Repo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  const scopeV2Manifest = fixtureManifest();
  scopeV2Manifest.recordCollections[0].classificationVersion = 2;
  scopeV2Manifest.recordCollections[0].scopes = [
    { id: 'jsonl-default', match: ['general/**', '**/*.jsonl'], paths: [], kind: 'artifact', policy: 'frozen' },
    { id: 'day-profile-live', match: [], paths: ['special/day_profile.jsonl'], kind: 'artifact', policy: 'mutable' },
  ];
  write(scopeV2Repo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(scopeV2Manifest, null, 2)}\n`);
  write(scopeV2Repo, 'records/general/frozen.jsonl', '{"frozen":true}\n');
  write(scopeV2Repo, 'records/special/day_profile.jsonl', '{"mutable":true}\n');
  commit(scopeV2Repo, 'seed scope v2 exception');
  result = run(['classify', '--root', scopeV2Repo, ...COLLECTION], scopeV2Repo);
  const firstScopeV2 = result.status === 0 ? JSON.parse(result.output) : null;
  const reversedScopeV2 = structuredClone(scopeV2Manifest);
  reversedScopeV2.recordCollections[0].scopes.reverse();
  for (const scope of reversedScopeV2.recordCollections[0].scopes) {
    scope.match.reverse();
    scope.paths.reverse();
  }
  writeFileSync(join(scopeV2Repo, 'hub', '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify(reversedScopeV2, null, 2)}\n`);
  const reversedResult = run(['classify', '--root', scopeV2Repo, ...COLLECTION], scopeV2Repo);
  const secondScopeV2 = reversedResult.status === 0 ? JSON.parse(reversedResult.output) : null;
  const selectedScope = (value) => value?.rows?.find((row) => row.path.endsWith('day_profile.jsonl'));
  check('scope v2 exact paths outrank broad globs independent of order', result.status === 0 && reversedResult.status === 0
    && selectedScope(firstScopeV2)?.scopeId === 'day-profile-live'
    && selectedScope(firstScopeV2)?.resolution === 'exact-path'
    && firstScopeV2?.rows?.find((row) => row.path.endsWith('general/frozen.jsonl'))?.scopeId === 'jsonl-default'
    && JSON.stringify(selectedScope(firstScopeV2)) === JSON.stringify(selectedScope(secondScopeV2)), `${result.output}\n${reversedResult.output}`);
  const unmatchedScopeV2 = join(work, 'scope-v2-unmatched'); cpSync(scopeV2Repo, unmatchedScopeV2, { recursive: true });
  writeFileSync(join(unmatchedScopeV2, 'hub', '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify(scopeV2Manifest, null, 2)}\n`);
  write(unmatchedScopeV2, 'records/unclassified.txt', 'not governed\n');
  commit(unmatchedScopeV2, 'add unclassified collection path');
  result = run(['adopt', '--root', unmatchedScopeV2, ...COLLECTION], unmatchedScopeV2);
  check('scope v2 zero-match refuses adoption without generated files', result.status === 1
    && result.output.includes('invalid collection classification')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(unmatchedScopeV2, name))), result.output);
  const ambiguousScopeV2 = structuredClone(scopeV2Manifest);
  ambiguousScopeV2.recordCollections[0].scopes.push({
    id: 'jsonl-second-owner', match: ['general/**'], paths: [], kind: 'artifact', policy: 'frozen',
  });
  writeFileSync(join(scopeV2Repo, 'hub', '98 System', 'DOCS_MANIFEST.json'), `${JSON.stringify(ambiguousScopeV2, null, 2)}\n`);
  commit(scopeV2Repo, 'introduce ambiguous scope v2 policy');
  result = run(['adopt', '--root', scopeV2Repo, ...COLLECTION], scopeV2Repo);
  check('scope v2 glob ambiguity refuses adoption without generated files', result.status === 1
    && result.output.includes('invalid collection classification')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(scopeV2Repo, name))), result.output);

  const promotedRepo = join(work, 'promoted-record'); mkdirSync(promotedRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], promotedRepo);
  write(promotedRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(promotedRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(promotedRepo, 'drafts/promoted.md', '# Promoted record\n');
  commit(promotedRepo, 'create draft');
  mkdirSync(join(promotedRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], promotedRepo);
  commit(promotedRepo, 'promote record');
  const promotionCommit = git(['rev-parse', 'HEAD'], promotedRepo).trim();
  result = run(['adopt', '--root', promotedRepo, ...COLLECTION], promotedRepo);
  const promotedInventory = result.status === 0 ? JSON.parse(readFileSync(generated(promotedRepo, 'inventory.json'), 'utf8')) : null;
  let promotedPathExists = false;
  try { git(['cat-file', '-e', `${promotionCommit}:records/promoted.md`], promotedRepo); promotedPathExists = true; } catch { /* asserted below */ }
  check('pre-adoption promotion resolves the exact current path introduction', result.status === 0
    && promotedInventory?.entries?.[0]?.introducedCommit === promotionCommit
    && promotedPathExists
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => existsSync(generated(promotedRepo, name))), result.output);
  const stableRewriteRepo = join(work, 'stable-history-rewrite'); cpSync(promotedRepo, stableRewriteRepo, { recursive: true });
  commit(stableRewriteRepo, 'adopt stable promoted record');
  squashCurrentTree(stableRewriteRepo, 'squashed stable adoption');
  result = run(['check', '--root', stableRewriteRepo, ...COLLECTION], stableRewriteRepo);
  check('stable adoption authority survives a content-preserving squash', result.status === 0, result.output);

  const revisedPromotionRepo = join(work, 'revised-promotion'); mkdirSync(revisedPromotionRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], revisedPromotionRepo);
  write(revisedPromotionRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(revisedPromotionRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(revisedPromotionRepo, 'drafts/promoted.md', '# Draft evidence\n');
  commit(revisedPromotionRepo, 'create promoted draft');
  write(revisedPromotionRepo, 'drafts/promoted.md', '# Revised evidence\n');
  commit(revisedPromotionRepo, 'revise promoted draft');
  mkdirSync(join(revisedPromotionRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], revisedPromotionRepo);
  commit(revisedPromotionRepo, 'promote revised record');
  result = run(['adopt', '--root', revisedPromotionRepo, ...COLLECTION], revisedPromotionRepo);
  check('pre-promotion revisions require review after exact-path admission', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(revisedPromotionRepo, name))), result.output);

  const mergedPromotionRepo = join(work, 'merged-revised-promotion'); mkdirSync(mergedPromotionRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], mergedPromotionRepo);
  write(mergedPromotionRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(mergedPromotionRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(mergedPromotionRepo, 'seed collection policy');
  git(['checkout', '-q', '-b', 'draft-work'], mergedPromotionRepo);
  write(mergedPromotionRepo, 'drafts/promoted.md', '# Branch draft\n');
  commit(mergedPromotionRepo, 'create branch draft');
  write(mergedPromotionRepo, 'drafts/promoted.md', '# Branch revision\n');
  commit(mergedPromotionRepo, 'revise branch draft');
  mkdirSync(join(mergedPromotionRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], mergedPromotionRepo);
  commit(mergedPromotionRepo, 'promote branch record');
  git(['checkout', '-q', 'main'], mergedPromotionRepo);
  git(['-c', 'user.email=eval@example.com', '-c', 'user.name=Eval',
    'merge', '--no-ff', '-m', 'merge promoted record', 'draft-work'], mergedPromotionRepo);
  result = run(['adopt', '--root', mergedPromotionRepo, ...COLLECTION], mergedPromotionRepo);
  check('merged pre-promotion revisions remain visible to adoption review', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(mergedPromotionRepo, name))), result.output);

  const reusedPromotionRepo = join(work, 'reused-promotion-source'); mkdirSync(reusedPromotionRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], reusedPromotionRepo);
  write(reusedPromotionRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(reusedPromotionRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(reusedPromotionRepo, 'drafts/promoted.md', '# First incarnation\n');
  commit(reusedPromotionRepo, 'create first source incarnation');
  git(['rm', 'drafts/promoted.md'], reusedPromotionRepo);
  commit(reusedPromotionRepo, 'delete first source incarnation');
  write(reusedPromotionRepo, 'drafts/promoted.md', '# Second incarnation\n');
  commit(reusedPromotionRepo, 'recreate source path');
  mkdirSync(join(reusedPromotionRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], reusedPromotionRepo);
  commit(reusedPromotionRepo, 'promote reused source path');
  result = run(['adopt', '--root', reusedPromotionRepo, ...COLLECTION], reusedPromotionRepo);
  check('reused promotion source paths require review before generated writes', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(reusedPromotionRepo, name))), result.output);

  const reusedIntermediateRepo = join(work, 'reused-intermediate-promotion'); mkdirSync(reusedIntermediateRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], reusedIntermediateRepo);
  write(reusedIntermediateRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(reusedIntermediateRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(reusedIntermediateRepo, 'drafts/promoted.md', '# Prior intermediate incarnation\n');
  commit(reusedIntermediateRepo, 'create intermediate path');
  git(['rm', 'drafts/promoted.md'], reusedIntermediateRepo);
  commit(reusedIntermediateRepo, 'delete intermediate path');
  write(reusedIntermediateRepo, 'raw/origin.md', '# Current origin\n');
  commit(reusedIntermediateRepo, 'create terminal origin');
  mkdirSync(join(reusedIntermediateRepo, 'drafts'), { recursive: true });
  git(['mv', 'raw/origin.md', 'drafts/promoted.md'], reusedIntermediateRepo);
  commit(reusedIntermediateRepo, 'move through reused intermediate path');
  mkdirSync(join(reusedIntermediateRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], reusedIntermediateRepo);
  commit(reusedIntermediateRepo, 'promote through intermediate path');
  result = run(['adopt', '--root', reusedIntermediateRepo, ...COLLECTION], reusedIntermediateRepo);
  check('multi-hop promotion preserves prior intermediate-path incarnations', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(reusedIntermediateRepo, name))), result.output);

  const postDepartureReuseRepo = join(work, 'post-departure-lineage-reuse'); mkdirSync(postDepartureReuseRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], postDepartureReuseRepo);
  write(postDepartureReuseRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(postDepartureReuseRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(postDepartureReuseRepo, 'raw/origin.md', '# Live origin\n');
  commit(postDepartureReuseRepo, 'create live origin');
  write(postDepartureReuseRepo, 'drafts/.keep', '');
  git(['mv', 'raw/origin.md', 'drafts/stage.md'], postDepartureReuseRepo);
  commit(postDepartureReuseRepo, 'move live evidence to staging');
  write(postDepartureReuseRepo, 'raw/origin.md', '# Unrelated reuse\n');
  commit(postDepartureReuseRepo, 'reuse departed origin path');
  git(['rm', 'raw/origin.md'], postDepartureReuseRepo);
  commit(postDepartureReuseRepo, 'delete reused origin path');
  git(['mv', 'drafts/stage.md', 'drafts/promoted.md'], postDepartureReuseRepo);
  commit(postDepartureReuseRepo, 'advance staged evidence');
  mkdirSync(join(postDepartureReuseRepo, 'records'), { recursive: true });
  git(['mv', 'drafts/promoted.md', 'records/promoted.md'], postDepartureReuseRepo);
  commit(postDepartureReuseRepo, 'promote evidence after origin reuse');
  result = run(['adopt', '--root', postDepartureReuseRepo, ...COLLECTION], postDepartureReuseRepo);
  check('post-departure reuse on any lineage segment requires review', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(postDepartureReuseRepo, name))), result.output);

  const stagedNativeRepo = join(work, 'staged-native-classification'); mkdirSync(stagedNativeRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], stagedNativeRepo);
  write(stagedNativeRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(stagedNativeRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  commit(stagedNativeRepo, 'seed staged native policy');
  write(stagedNativeRepo, 'records/native.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Native record\n');
  git(['add', 'records/native.md'], stagedNativeRepo);
  result = run(['classify', '--root', stagedNativeRepo, ...COLLECTION], stagedNativeRepo);
  check('classification separates staged native partition validity from adoption readiness', result.status === 0
    && result.output.includes('"classificationStatus": "partition-valid"')
    && result.output.includes('"status": "pending-commit"')
    && result.output.includes('"adoptionReadiness": "pending-commit"'), result.output);

  const revisedRepo = join(work, 'revised-record'); mkdirSync(revisedRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], revisedRepo);
  write(revisedRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(revisedRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(revisedRepo, 'records/one.md', '# Draft evidence\n');
  commit(revisedRepo, 'add evidence');
  write(revisedRepo, 'records/one.md', '# Final evidence\n');
  commit(revisedRepo, 'revise evidence before freeze');
  writeFileSync(join(revisedRepo, '.git', 'info', 'exclude'), 'adoption-review.json\n');
  result = run(['classify', '--root', revisedRepo, ...COLLECTION], revisedRepo);
  check('classification reports historical immutable revision as review required', result.status === 0
    && result.output.includes('"adoptionReadiness": "review-required"')
    && result.output.includes('"historyDigest"'), result.output);
  result = run(['adopt', '--root', revisedRepo, ...COLLECTION], revisedRepo);
  check('review-required adoption refuses without creating generated files', result.status === 1
    && result.output.includes('adoption review required')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(revisedRepo, name))), result.output);
  result = run(['plan-adoption', '--root', revisedRepo, ...COLLECTION, '--out', 'adoption-review.json'], revisedRepo);
  const reviewPath = join(revisedRepo, 'adoption-review.json');
  const reviewPlan = result.status === 0 ? JSON.parse(readFileSync(reviewPath, 'utf8')) : null;
  if (reviewPlan?.candidates?.[0]) {
    reviewPlan.candidates[0].disposition = 'freeze-current';
    reviewPlan.candidates[0].rationale = 'The final reviewed bytes are the intended immutable baseline.';
    writeFileSync(reviewPath, `${JSON.stringify(reviewPlan, null, 2)}\n`);
  }
  const staleReviewRepo = join(work, 'stale-review'); cpSync(revisedRepo, staleReviewRepo, { recursive: true });
  write(staleReviewRepo, 'records/one.md', '# Changed after review\n');
  commit(staleReviewRepo, 'change after review');
  result = run(['adopt', '--root', staleReviewRepo, ...COLLECTION, '--review', 'adoption-review.json'], staleReviewRepo);
  check('history movement invalidates a review receipt before any generated write', result.status === 1
    && result.output.includes('adoption review is stale')
    && ['inventory.json', 'citations.json', 'curation.jsonl', 'index.md'].every((name) => !existsSync(generated(staleReviewRepo, name))), result.output);
  result = run(['adopt', '--root', revisedRepo, ...COLLECTION, '--review', 'adoption-review.json'], revisedRepo);
  const reviewedInventory = result.status === 0 ? JSON.parse(readFileSync(generated(revisedRepo, 'inventory.json'), 'utf8')) : null;
  check('digest-bound review permits adoption and persists its receipt', result.status === 0
    && reviewedInventory?.version === 2
    && /^[0-9a-f]{64}$/.test(reviewedInventory?.adoptionReview?.receiptDigest || '')
    && reviewedInventory?.adoptionReview?.reviewed?.[0]?.disposition === 'freeze-current', result.output);

  const rewrittenHistoryRepo = join(work, 'rewritten-reviewed-history'); cpSync(revisedRepo, rewrittenHistoryRepo, { recursive: true });
  commit(rewrittenHistoryRepo, 'adopt reviewed record');
  squashCurrentTree(rewrittenHistoryRepo, 'squashed reviewed adoption');
  result = run(['check', '--root', rewrittenHistoryRepo, ...COLLECTION], rewrittenHistoryRepo);
  check('content-preserving history rewrites retain reviewed adoption authority', result.status === 0, result.output);

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
  check('fresh adoption passes semantic and history checks', result.status === 0, result.output);
  commit(repo, 'adopt records');
  const originalRecord = readFileSync(join(repo, 'records', 'one.md'), 'utf8');
  const revertedHistoryRepo = join(work, 'reverted-record-history'); cpSync(repo, revertedHistoryRepo, { recursive: true });
  write(revertedHistoryRepo, 'records/one.md', `${originalRecord}\ntransient rewrite\n`);
  commit(revertedHistoryRepo, 'temporarily rewrite adopted record');
  write(revertedHistoryRepo, 'records/one.md', originalRecord);
  commit(revertedHistoryRepo, 'restore adopted record bytes');
  result = run(['check', '--root', revertedHistoryRepo, ...COLLECTION], revertedHistoryRepo);
  check('ancestral post-adoption edit and revert remains history drift', result.status === 1
    && result.output.includes('adoption review history drift'), result.output);

  const relabeled = join(work, 'relabeled'); cpSync(repo, relabeled, { recursive: true });
  const relabeledManifestPath = join(relabeled, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const relabeledManifest = JSON.parse(readFileSync(relabeledManifestPath, 'utf8'));
  relabeledManifest.recordCollections[0].id = 'renamed-evidence';
  writeFileSync(relabeledManifestPath, `${JSON.stringify(relabeledManifest, null, 2)}\n`);
  result = run(['check', '--root', relabeled, '--collection', 'renamed-evidence'], relabeled);
  check('collection label changes preserve identities and conformance', result.status === 0, result.output);

  const migratedScope = join(work, 'migrated-scope-v2'); cpSync(repo, migratedScope, { recursive: true });
  const migratedManifestPath = join(migratedScope, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const migratedManifest = JSON.parse(readFileSync(migratedManifestPath, 'utf8'));
  migratedManifest.recordCollections[0].classificationVersion = 2;
  migratedManifest.recordCollections[0].scopes = [
    { id: 'records', match: ['*.md'], paths: [], kind: 'record', policy: 'append-only' },
    { id: 'mutable', match: ['mutable/**'], paths: [], kind: 'artifact', policy: 'mutable' },
    { id: 'frozen', match: ['frozen/**'], paths: [], kind: 'artifact', policy: 'frozen' },
    { id: 'executables', match: ['exec/**'], paths: [], kind: 'executable', policy: 'frozen' },
    { id: 'literal-bracket', match: [], paths: ['literal[0].json'], kind: 'artifact', policy: 'frozen' },
  ];
  writeFileSync(migratedManifestPath, `${JSON.stringify(migratedManifest, null, 2)}\n`);
  const migratedInventoryBefore = readFileSync(generated(migratedScope, 'inventory.json'));
  result = run(['check', '--root', migratedScope, ...COLLECTION], migratedScope);
  check('policy-equivalent scope v1 to v2 migration preserves adopted baselines', result.status === 0
    && migratedInventoryBefore.equals(readFileSync(generated(migratedScope, 'inventory.json'))), result.output);
  const reclassifiedScope = join(work, 'reclassified-scope-v2'); cpSync(migratedScope, reclassifiedScope, { recursive: true });
  const reclassifiedManifestPath = join(reclassifiedScope, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const reclassifiedManifest = JSON.parse(readFileSync(reclassifiedManifestPath, 'utf8'));
  reclassifiedManifest.recordCollections[0].scopes[0] = {
    id: 'records', match: ['*.md'], paths: [], kind: 'artifact', policy: 'frozen',
  };
  writeFileSync(reclassifiedManifestPath, `${JSON.stringify(reclassifiedManifest, null, 2)}\n`);
  result = run(['check', '--root', reclassifiedScope, ...COLLECTION], reclassifiedScope);
  check('scope v2 migration cannot reclassify an adopted record', result.status === 1
    && result.output.includes('immutable record deleted, renamed, or reclassified'), result.output);

  const deletedRecord = join(work, 'deleted-record'); cpSync(repo, deletedRecord, { recursive: true });
  unlinkSync(join(deletedRecord, 'records', 'one.md')); git(['add', '-u'], deletedRecord);
  result = run(['check', '--root', deletedRecord, ...COLLECTION], deletedRecord);
  check('adopted record deletion fails', result.status === 1 && result.output.includes('deleted, renamed'), result.output);
  const renamedRecord = join(work, 'renamed-record'); cpSync(repo, renamedRecord, { recursive: true });
  git(['mv', 'records/one.md', 'records/renamed.md'], renamedRecord);
  result = run(['check', '--root', renamedRecord, ...COLLECTION], renamedRecord);
  check('adopted record rename fails', result.status === 1 && result.output.includes('deleted, renamed'), result.output);

  const uninventoriedRecord = join(work, 'uninventoried-record'); cpSync(repo, uninventoriedRecord, { recursive: true });
  write(uninventoriedRecord, 'records/extra.md', '# Uninventoried record\n');
  git(['add', 'records/extra.md'], uninventoriedRecord);
  result = run(['check', '--root', uninventoriedRecord, ...COLLECTION], uninventoriedRecord);
  check('tracked records cannot bypass the inventory', result.status === 1
    && result.output.includes('record missing from inventory'), result.output);
  const uninventoriedFrozen = join(work, 'uninventoried-frozen'); cpSync(repo, uninventoriedFrozen, { recursive: true });
  write(uninventoriedFrozen, 'records/frozen/new.json', '{"new":true}\n');
  git(['add', 'records/frozen/new.json'], uninventoriedFrozen);
  result = run(['check', '--root', uninventoriedFrozen, ...COLLECTION], uninventoriedFrozen);
  check('tracked frozen artifacts cannot bypass the inventory', result.status === 1
    && result.output.includes('frozen artifact missing from inventory'), result.output);

  const committedRewrite = join(work, 'committed-rewrite'); cpSync(repo, committedRewrite, { recursive: true });
  write(committedRewrite, 'records/one.md', `${originalRecord}\ncommitted rewrite\n`);
  const rewrittenInventoryPath = generated(committedRewrite, 'inventory.json');
  const rewrittenInventory = JSON.parse(readFileSync(rewrittenInventoryPath, 'utf8'));
  rewrittenInventory.entries[0].sha256 = sha256(readFileSync(join(committedRewrite, 'records', 'one.md')));
  writeFileSync(rewrittenInventoryPath, `${JSON.stringify(rewrittenInventory, null, 2)}\n`);
  run(['render', '--root', committedRewrite, ...COLLECTION], committedRewrite); commit(committedRewrite, 'coordinated immutable rewrite');
  result = run(['check', '--root', committedRewrite, ...COLLECTION], committedRewrite);
  check('committed body plus inventory rehash cannot bypass the adoption receipt', result.status === 1
    && result.output.includes('adoption review candidate is not pinned by inventory'), result.output);

  const renamedHubRewrite = join(work, 'renamed-hub-rewrite'); cpSync(repo, renamedHubRewrite, { recursive: true });
  git(['mv', 'hub', 'knowledge-hub'], renamedHubRewrite);
  const movedManifestPath = join(renamedHubRewrite, 'knowledge-hub', '98 System', 'DOCS_MANIFEST.json');
  const movedManifest = JSON.parse(readFileSync(movedManifestPath, 'utf8'));
  movedManifest.hub = 'knowledge-hub';
  writeFileSync(movedManifestPath, `${JSON.stringify(movedManifest, null, 2)}\n`);
  write(renamedHubRewrite, 'records/one.md', `${originalRecord}\nrewrite hidden behind a hub move\n`);
  const movedInventoryPath = join(renamedHubRewrite, 'knowledge-hub', '98 System', 'Records', 'inventory.json');
  const movedInventory = JSON.parse(readFileSync(movedInventoryPath, 'utf8'));
  movedInventory.entries[0].sha256 = sha256(readFileSync(join(renamedHubRewrite, 'records', 'one.md')));
  writeFileSync(movedInventoryPath, `${JSON.stringify(movedInventory, null, 2)}\n`);
  run(['render', '--root', renamedHubRewrite, ...COLLECTION], renamedHubRewrite);
  commit(renamedHubRewrite, 'move hub with coordinated immutable rewrite');
  result = run(['check', '--root', renamedHubRewrite, ...COLLECTION], renamedHubRewrite);
  check('hub rename cannot hide a coordinated immutable rewrite', result.status === 1
    && result.output.includes('adoption review candidate is not pinned by inventory'), result.output);

  if (process.platform !== 'win32') {
    const literalHubRepo = join(work, 'literal-hub'); mkdirSync(literalHubRepo, { recursive: true });
    git(['init', '--quiet', '-b', 'main'], literalHubRepo);
    write(literalHubRepo, ':hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
    const literalHubManifest = fixtureManifest(); literalHubManifest.hub = ':hub';
    write(literalHubRepo, ':hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(literalHubManifest, null, 2)}\n`);
    write(literalHubRepo, 'records/one.md', '# Literal pathspec record\n');
    commit(literalHubRepo, 'seed literal-pathspec hub');
    result = run(['adopt', '--root', literalHubRepo, ...COLLECTION], literalHubRepo);
    check('literal-pathspec fixture adopts', result.status === 0, result.output);
    commit(literalHubRepo, 'adopt literal-pathspec hub');
    write(literalHubRepo, 'records/one.md', '# Rewritten literal pathspec record\n');
    const literalInventoryPath = join(literalHubRepo, ':hub', '98 System', 'Records', 'inventory.json');
    const literalInventory = JSON.parse(readFileSync(literalInventoryPath, 'utf8'));
    literalInventory.entries[0].sha256 = sha256(readFileSync(join(literalHubRepo, 'records', 'one.md')));
    writeFileSync(literalInventoryPath, `${JSON.stringify(literalInventory, null, 2)}\n`);
    run(['render', '--root', literalHubRepo, ...COLLECTION], literalHubRepo);
    commit(literalHubRepo, 'attempt coordinated rewrite under literal-pathspec hub');
    result = run(['check', '--root', literalHubRepo, ...COLLECTION], literalHubRepo);
    check('pathspec-like hub names cannot disable append-only history', result.status === 1
      && result.output.includes('adoption review candidate is not pinned by inventory'), result.output);

    const symlinkRepo = join(work, 'symlink-record'); mkdirSync(symlinkRepo, { recursive: true });
    git(['init', '--quiet', '-b', 'main'], symlinkRepo);
    write(symlinkRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
    write(symlinkRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
    write(work, 'outside-evidence.md', 'outside repository bytes\n');
    mkdirSync(join(symlinkRepo, 'records'), { recursive: true });
    symlinkSync('../../outside-evidence.md', join(symlinkRepo, 'records', 'linked.md'));
    commit(symlinkRepo, 'seed tracked symlink');
    result = run(['adopt', '--root', symlinkRepo, ...COLLECTION], symlinkRepo);
    check('adoption rejects tracked symlinks before hashing external bytes', result.status === 1
      && result.output.includes('unsupported Git index mode 120000'), result.output);
  }

  const citationRewrite = join(work, 'citation-rewrite'); cpSync(repo, citationRewrite, { recursive: true });
  const rewrittenCitationsPath = generated(citationRewrite, 'citations.json');
  const rewrittenCitations = JSON.parse(readFileSync(rewrittenCitationsPath, 'utf8'));
  rewrittenCitations.entries[0].sourceLine += 1;
  writeFileSync(rewrittenCitationsPath, `${JSON.stringify(rewrittenCitations, null, 2)}\n`); commit(citationRewrite, 'rewrite citation baseline');
  result = run(['check', '--root', citationRewrite, ...COLLECTION], citationRewrite);
  check('committed citation baseline rewrites fail', result.status === 1 && result.output.includes('citation inventory changed'), result.output);

  const ledgerRewrite = join(work, 'ledger-rewrite'); cpSync(repo, ledgerRewrite, { recursive: true });
  run(['curate', '--root', ledgerRewrite, ...COLLECTION, '--record', firstId, '--at', '2026-01-01T00:00:00.000Z', '--state', '{"status":"reviewed"}'], ledgerRewrite);
  commit(ledgerRewrite, 'append valid curation');
  const ledgerRewritePath = generated(ledgerRewrite, 'curation.jsonl');
  const rewrittenEvent = JSON.parse(readFileSync(ledgerRewritePath, 'utf8').trim());
  rewrittenEvent.state.status = 'rewritten'; delete rewrittenEvent.eventDigest; rewrittenEvent.eventDigest = digestJson(rewrittenEvent);
  writeFileSync(ledgerRewritePath, `${JSON.stringify(rewrittenEvent)}\n`);
  run(['render', '--root', ledgerRewrite, ...COLLECTION], ledgerRewrite); commit(ledgerRewrite, 'rehash committed curation');
  result = run(['check', '--root', ledgerRewrite, ...COLLECTION], ledgerRewrite);
  check('committed ledger rehashes fail historical monotonicity', result.status === 1 && result.output.includes('ledger rewrote committed history'), result.output);

  const uuidRewrite = join(work, 'uuid-rewrite'); cpSync(repo, uuidRewrite, { recursive: true });
  const uuidManifestPath = join(uuidRewrite, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const uuidManifest = JSON.parse(readFileSync(uuidManifestPath, 'utf8'));
  uuidManifest.recordCollections[0].collectionUuid = '33333333-3333-4333-8333-333333333333';
  writeFileSync(uuidManifestPath, `${JSON.stringify(uuidManifest, null, 2)}\n`); commit(uuidRewrite, 'replace collection identity');
  result = run(['check', '--root', uuidRewrite, ...COLLECTION], uuidRewrite);
  check('committed collection UUID replacement fails', result.status === 1 && result.output.includes('permanent record collection'), result.output);

  const unknownEvent = {
    collectionUuid: UUID, sequence: 1, previousEventDigest: null,
    recordId: 'REC-AAAAAAAAAAAAAAAAAAAAAAAAAA', previousRecordEventDigest: null,
    state: { status: 'reviewed' }, curatedAt: '2026-01-01T00:00:00.000Z',
  };
  unknownEvent.eventDigest = digestJson(unknownEvent);
  writeFileSync(generated(repo, 'curation.jsonl'), `${JSON.stringify(unknownEvent)}\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('validly hashed curation for an unknown record fails', result.status === 1 && result.output.includes('unknown record'), result.output);
  restoreFromHead(repo, 'hub/98 System/Records/curation.jsonl');

  const unknownCitationRepo = join(work, 'unknown-citation'); cpSync(repo, unknownCitationRepo, { recursive: true });
  const unknownCitationPath = generated(unknownCitationRepo, 'citations.json');
  const unknownCitations = JSON.parse(readFileSync(unknownCitationPath, 'utf8'));
  unknownCitations.entries.push({ ...unknownCitations.entries[0], recordId: 'REC-AAAAAAAAAAAAAAAAAAAAAAAAAA' });
  writeFileSync(unknownCitationPath, `${JSON.stringify(unknownCitations, null, 2)}\n`);
  result = run(['check', '--root', unknownCitationRepo, ...COLLECTION], unknownCitationRepo);
  check('valid citation-shaped entries for unknown records fail', result.status === 1
    && result.output.includes('citation references unknown record'), result.output);

  const unknownPrefixRepo = join(work, 'unknown-prefix'); cpSync(repo, unknownPrefixRepo, { recursive: true });
  write(unknownPrefixRepo, 'hub/unknown-prefix.md', '# Unknown record\n\n`REC-ZZZZZZZZ`\n');
  git(['add', 'hub/unknown-prefix.md'], unknownPrefixRepo);
  result = run(['check', '--root', unknownPrefixRepo, ...COLLECTION], unknownPrefixRepo);
  check('unknown record prefixes in vault prose fail', result.status === 1
    && result.output.includes('record prefix REC-ZZZZZZZZ is unresolved'), result.output);

  const deadRepo = join(work, 'resolved-to-dead'); cpSync(repo, deadRepo, { recursive: true });
  unlinkSync(join(deadRepo, 'records', 'mutable', 'stream.jsonl')); git(['add', '-u'], deadRepo);
  result = run(['check', '--root', deadRepo, ...COLLECTION], deadRepo);
  check('resolved-to-dead citation regressions block', result.status === 1 && result.output.includes('resolved-to-dead'), result.output);

  write(repo, 'records/one.md', `${originalRecord}\nchanged\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('immutable record edits fail', result.status === 1 && result.output.includes('immutable record drift'), result.output);
  write(repo, 'records/one.md', originalRecord);
  const frozen = readFileSync(join(repo, 'records', 'frozen', 'stable.json'), 'utf8');
  write(repo, 'records/frozen/stable.json', '{"stable":false}\n');
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('frozen artifact drift fails', result.status === 1 && result.output.includes('frozen artifact drift'), result.output);
  write(repo, 'records/frozen/stable.json', frozen);
  const mutable = readFileSync(join(repo, 'records', 'mutable', 'result.json'), 'utf8');
  write(repo, 'records/mutable/result.json', '{"PRIMARY":{"summary":2},"A":[0]}\n');
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('mutable artifact drift warns without failing', result.status === 0 && result.output.includes('"warnings":1'), result.output);
  write(repo, 'records/mutable/result.json', mutable);

  const canonicalIndex = readFileSync(generated(repo, 'index.md'), 'utf8');
  writeFileSync(generated(repo, 'index.md'), `${canonicalIndex}\nPresentation-only note.\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('semantic index permits presentation-only changes', result.status === 0, result.output);
  writeFileSync(generated(repo, 'index.md'), canonicalIndex.replace(`<a id="${firstId}"></a>`, ''));
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('semantic index requires every record anchor', result.status === 1 && result.output.includes('anchors drift'), result.output);
  writeFileSync(generated(repo, 'index.md'), canonicalIndex);
  const staleSemanticIndex = join(work, 'stale-semantic-index'); cpSync(repo, staleSemanticIndex, { recursive: true });
  result = run(['curate', '--root', staleSemanticIndex, ...COLLECTION, '--record', firstId,
    '--at', '2026-01-01T00:00:00.000Z', '--state', '{"status":"reviewed"}'], staleSemanticIndex);
  check('semantic index fixture can curate a record', result.status === 0, result.output);
  writeFileSync(generated(staleSemanticIndex, 'index.md'), canonicalIndex);
  result = run(['check', '--root', staleSemanticIndex, ...COLLECTION], staleSemanticIndex);
  check('semantic index detects stale curation state even when anchors match', result.status === 1
    && result.output.includes('semantic index drift'), result.output);
  const staleLockRepo = join(work, 'stale-curation-lock'); cpSync(repo, staleLockRepo, { recursive: true });
  const staleLock = `${generated(staleLockRepo, 'curation.jsonl')}.lock`;
  mkdirSync(staleLock);
  writeFileSync(join(staleLock, 'owner.json'), '{"pid":999999999,"acquiredAt":"2000-01-01T00:00:00.000Z"}\n');
  const staleTime = new Date('2000-01-01T00:00:00.000Z'); utimesSync(staleLock, staleTime, staleTime);
  result = run(['curate', '--root', staleLockRepo, ...COLLECTION, '--record', firstId,
    '--at', '2026-01-01T00:00:00.000Z', '--state', '{"status":"reviewed"}'], staleLockRepo);
  check('curation recovers a stale lock whose recorded process is gone', result.status === 0, result.output);

  result = run(['curate', '--root', repo, ...COLLECTION, '--record', firstId.slice(0, 12), '--at', '2026-01-01T00:00:00.000Z', '--state', '{"status":"reviewed","owner":"ops"}'], repo);
  check('curation accepts an unambiguous short ID', result.status === 0, result.output);
  result = run(['curate', '--root', repo, ...COLLECTION, '--record', firstId, '--at', '2026-01-02T00:00:00.000Z', '--state', '{"status":"superseded","owner":"ops"}'], repo);
  check('curation corrections append complete state', result.status === 0, result.output);
  const goodLedger = readFileSync(generated(repo, 'curation.jsonl'), 'utf8');
  const ledgerLines = goodLedger.trimEnd().split('\n');
  const tampered = JSON.parse(ledgerLines[0]); tampered.state.status = 'tampered'; ledgerLines[0] = JSON.stringify(tampered);
  writeFileSync(generated(repo, 'curation.jsonl'), `${ledgerLines.join('\n')}\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('ledger tampering fails the digest chain', result.status === 1 && result.output.includes('digest mismatch'), result.output);
  writeFileSync(generated(repo, 'curation.jsonl'), goodLedger);
  writeFileSync(generated(repo, 'curation.jsonl'), `${goodLedger}${goodLedger.split('\n')[1]}\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('ledger forks or duplicate sequence fail', result.status === 1 && result.output.includes('predecessor chain'), result.output);
  writeFileSync(generated(repo, 'curation.jsonl'), goodLedger);
  run(['render', '--root', repo, ...COLLECTION], repo);
  commit(repo, 'record curation');

  write(repo, 'records/two.md', `---
recordSchema: 1
supersedes: ["${firstId}"]
---
# Two

[mutable](records/mutable/result.json)
[frozen](records/frozen/native.json)
`);
  write(repo, 'records/frozen/native.json', '{"native":true}\n');
  git(['add', 'records/two.md', 'records/frozen/native.json'], repo);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/two.md'], repo);
  check('native append stages record metadata transaction', result.status === 0 && result.output.includes('records/two.md'), result.output);
  const nativeInventory = JSON.parse(readFileSync(generated(repo, 'inventory.json'), 'utf8'));
  check('native append snapshots new immutable artifacts', nativeInventory.artifacts.some((item) => item.path === 'records/frozen/native.json'), JSON.stringify(nativeInventory));
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('native append passes staged-tree checks', result.status === 0, result.output);
  commit(repo, 'append native record');

  write(repo, 'records/missing-image.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Missing image\n\n![proof](records/missing.png)\n');
  git(['add', 'records/missing-image.md'], repo);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/missing-image.md'], repo);
  check('native append rejects unresolved image evidence', result.status === 1 && result.output.includes('unresolved citation'), result.output);
  git(['reset', '--quiet', 'HEAD', '--', 'records/missing-image.md'], repo); unlinkSync(join(repo, 'records', 'missing-image.md'));

  write(repo, 'records/missing-reference.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Missing reference\n\n[proof][missing]\n\n[missing]: records/missing-reference.json\n');
  git(['add', 'records/missing-reference.md'], repo);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/missing-reference.md'], repo);
  check('native append rejects unresolved reference evidence', result.status === 1 && result.output.includes('unresolved citation'), result.output);
  git(['reset', '--quiet', 'HEAD', '--', 'records/missing-reference.md'], repo); unlinkSync(join(repo, 'records', 'missing-reference.md'));

  write(repo, 'records/bad.md', '# Missing native schema\n');
  git(['add', 'records/bad.md'], repo);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/bad.md'], repo);
  check('native records require the explicit schema', result.status === 1 && result.output.includes('frontmatter'), result.output);
  git(['reset', '--quiet', 'HEAD', '--', 'records/bad.md'], repo); unlinkSync(join(repo, 'records', 'bad.md'));
  write(repo, 'records/three.md', '---\nrecordSchema: 1\nsupersedes: []\n---\n# Three\n');
  git(['add', 'records/three.md'], repo);
  writeFileSync(generated(repo, 'inventory.json'), `${readFileSync(generated(repo, 'inventory.json'), 'utf8')} `);
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/three.md'], repo);
  check('append refuses pre-existing generated edits', result.status === 1 && result.output.includes('pre-existing generated-file edit'), result.output);
  restoreFromHead(repo, 'hub/98 System/Records/inventory.json');
  result = run(['append', '--root', repo, ...COLLECTION, '--record', 'records/three.md', '--no-stage'], repo);
  check('advanced no-stage mode writes without staging generated files', result.status === 0
    && !git(['diff', '--cached', '--name-only'], repo).includes('inventory.json'), result.output);

  const citationPath = generated(repo, 'citations.json');
  const locatorDoc = JSON.parse(readFileSync(citationPath, 'utf8'));
  const located = locatorDoc.entries.find((item) => item.target?.blobOid);
  const originalLocatorPath = located.target.path;
  const originalLocatorCommit = located.target.commitOid;
  located.target.blobOid = '0'.repeat(located.target.blobOid.length);
  writeFileSync(citationPath, `${JSON.stringify(locatorDoc, null, 2)}\n`);
  result = run(['check', '--root', repo, ...COLLECTION], repo);
  check('bad Git locator recovers by authoritative content digest', result.status === 0, result.output);
  result = run(['reindex-locators', '--root', repo, ...COLLECTION], repo);
  const reindexedCitation = JSON.parse(readFileSync(citationPath, 'utf8')).entries
    .find((item) => item.recordId === located.recordId && item.sourceLine === located.sourceLine && item.rawTarget === located.rawTarget);
  check('locator reindex regenerates cache fields without rewriting provenance', result.status === 0
    && result.output.includes('locatorsUpdated')
    && reindexedCitation.target.path === originalLocatorPath
    && reindexedCitation.target.commitOid === originalLocatorCommit, result.output);

  commit(repo, 'snapshot advanced operations');
  const shallow = join(work, 'shallow');
  git(['clone', '--quiet', '--depth=1', `file:///${repo.replaceAll('\\', '/')}`, shallow], work);
  result = run(['check', '--root', shallow, ...COLLECTION], shallow);
  check('ordinary shallow checks warn but remain conformance checks', result.status === 0 && result.output.includes('history-unavailable'), result.output);
  result = run(['verify-history', '--strict', '--root', shallow, ...COLLECTION], shallow);
  check('strict history verification exits as infrastructure failure', result.status === 2 && result.output.includes('infrastructure history unavailable'), result.output);
  result = run(['adopt', '--root', shallow, ...COLLECTION], shallow);
  check('shallow adoption refuses before writing', result.status === 2 && result.output.includes('adoption refused'), result.output);

  const partial = join(work, 'partial'); cpSync(repo, partial, { recursive: true });
  git(['config', 'extensions.partialclone', 'origin'], partial);
  result = run(['verify-history', '--strict', '--root', partial, ...COLLECTION], partial);
  check('partial/promisor configuration fails strict history', result.status === 2 && result.output.includes('partial repository'), result.output);

  const lost = join(work, 'lost'); mkdirSync(lost, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], lost);
  write(lost, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(lost, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(lost, 'records/one.md', '# Lost evidence\n\n[lost](records/frozen/lost.json)\n');
  write(lost, 'records/frozen/lost.json', '{"lost":true}\n');
  commit(lost, 'seed recoverable evidence');
  unlinkSync(join(lost, 'records', 'frozen', 'lost.json')); commit(lost, 'remove evidence target');
  result = run(['adopt', '--root', lost, ...COLLECTION], lost);
  const lostCitationsPath = generated(lost, 'citations.json');
  const lostCitations = JSON.parse(readFileSync(lostCitationsPath, 'utf8'));
  lostCitations.entries.find((item) => item.state === 'redirected').target.targetSha256 = 'f'.repeat(64);
  writeFileSync(lostCitationsPath, `${JSON.stringify(lostCitations, null, 2)}\n`);
  commit(lost, 'adopt unavailable evidence baseline');
  result = run(['check', '--root', lost, ...COLLECTION], lost);
  check('missing authoritative content with complete history is evidence-lost', result.status === 1 && result.output.includes('evidence-lost'), result.output);

  const scopeRepo = join(work, 'scope'); cpSync(repo, scopeRepo, { recursive: true });
  const scopeManifestPath = join(scopeRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const generatedBoundaryRepo = join(work, 'generated-boundary'); cpSync(repo, generatedBoundaryRepo, { recursive: true });
  const generatedBoundaryManifestPath = join(generatedBoundaryRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const generatedBoundary = JSON.parse(readFileSync(generatedBoundaryManifestPath, 'utf8'));
  generatedBoundary.recordCollections[0].index = '40 Engineering/ordinary.md';
  writeFileSync(generatedBoundaryManifestPath, `${JSON.stringify(generatedBoundary, null, 2)}\n`);
  result = run(['classify', '--root', generatedBoundaryRepo, ...COLLECTION], generatedBoundaryRepo);
  check('record engine independently confines generated paths to the reserved Records directory', result.status === 1
    && result.output.includes('outside 98 System/Records/'), result.output);
  const overlap = JSON.parse(readFileSync(scopeManifestPath, 'utf8'));
  overlap.recordCollections[0].scopes.push({ pattern: '*.md', kind: 'artifact', policy: 'mutable' });
  writeFileSync(scopeManifestPath, `${JSON.stringify(overlap, null, 2)}\n`);
  result = run(['classify', '--root', scopeRepo, ...COLLECTION], scopeRepo);
  check('multiple matching scopes fail classification', result.status === 1 && result.output.includes('invalid collection classification'), result.output);
  const zero = fixtureManifest(); writeFileSync(scopeManifestPath, `${JSON.stringify(zero, null, 2)}\n`);
  write(scopeRepo, 'records/unclassified.bin', 'x'); git(['add', 'records/unclassified.bin'], scopeRepo);
  result = run(['classify', '--root', scopeRepo, ...COLLECTION], scopeRepo);
  check('zero matching scopes fail classification', result.status === 1 && result.output.includes('invalid collection classification'), result.output);
  const forbidden = fixtureManifest(); forbidden.recordCollections[0].scopes.push({ pattern: '**/*.pyc', kind: 'forbidden', policy: 'forbidden' });
  writeFileSync(scopeManifestPath, `${JSON.stringify(forbidden, null, 2)}\n`);
  write(scopeRepo, 'records/cache/bad.pyc', 'x'); git(['add', 'records/cache/bad.pyc'], scopeRepo);
  result = run(['classify', '--root', scopeRepo, ...COLLECTION], scopeRepo);
  check('tracked pyc files are forbidden', result.status === 1 && result.output.includes('bad.pyc'), result.output);

  const legacyRepo = join(work, 'legacy'); cpSync(repo, legacyRepo, { recursive: true });
  const legacyManifestPath = join(legacyRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const legacy = JSON.parse(readFileSync(legacyManifestPath, 'utf8'));
  const immutableBeforeLegacy = readFileSync(join(legacyRepo, 'records', 'one.md'), 'utf8');
  legacy.legacyPaths = [
    { path: 'records/one.md', disposition: 'pointer', target: 'hub/Standard.md', requiredBy: [{ kind: 'external', ref: 'requirements.txt' }] },
  ];
  writeFileSync(legacyManifestPath, `${JSON.stringify(legacy, null, 2)}\n`);
  write(legacyRepo, 'requirements.txt', 'consumer requires records/one.md\n');
  git(['add', 'hub/98 System/DOCS_MANIFEST.json', 'requirements.txt'], legacyRepo);
  result = run(['render', '--legacy', '--root', legacyRepo, ...COLLECTION], legacyRepo);
  check('legacy paths cannot overwrite immutable record bytes', result.status === 1
    && result.output.includes('overlaps governed records')
    && readFileSync(join(legacyRepo, 'records', 'one.md'), 'utf8') === immutableBeforeLegacy, result.output);
  legacy.legacyPaths = [
    { path: 'docs/old.md', disposition: 'pointer', target: 'hub/Standard.md', requiredBy: [{ kind: 'external', ref: 'requirements.txt' }] },
    { path: 'docs/gone.md', disposition: 'tombstone', target: 'hub/Standard.md', requiredBy: [{ kind: 'external', ref: 'requirements.txt' }] },
  ];
  writeFileSync(legacyManifestPath, `${JSON.stringify(legacy, null, 2)}\n`);
  write(legacyRepo, 'requirements.txt', 'consumer requires docs/old.md and docs/gone.md\n');
  git(['add', 'hub/98 System/DOCS_MANIFEST.json', 'requirements.txt'], legacyRepo);
  result = run(['render', '--legacy', '--root', legacyRepo, ...COLLECTION], legacyRepo);
  check('eligible legacy pointers and tombstones render exact bounded files', result.status === 0
    && readFileSync(join(legacyRepo, 'docs', 'old.md'), 'utf8').includes('legacy-pointer v1')
    && readFileSync(join(legacyRepo, 'docs', 'gone.md'), 'utf8').includes('tombstone v1'), result.output);
  result = run(['check', '--root', legacyRepo, ...COLLECTION], legacyRepo);
  check('legacy generated files pass mechanical eligibility checks', result.status === 0, result.output);
  legacy.legacyPaths[0].requiredBy = [{ kind: 'external', ref: 'missing.txt' }];
  writeFileSync(legacyManifestPath, `${JSON.stringify(legacy, null, 2)}\n`);
  result = run(['render', '--legacy', '--root', legacyRepo, ...COLLECTION], legacyRepo);
  check('ineligible legacy paths fail closed', result.status === 1 && result.output.includes('ineligible legacy path'), result.output);

  const recordPointerRepo = join(work, 'record-qualified-pointer'); mkdirSync(recordPointerRepo, { recursive: true });
  git(['init', '--quiet', '-b', 'main'], recordPointerRepo);
  write(recordPointerRepo, 'hub/Standard.md', '---\nstandard-version: 4\n---\n# Standard\n');
  write(recordPointerRepo, 'hub/98 System/DOCS_MANIFEST.json', `${JSON.stringify(fixtureManifest(), null, 2)}\n`);
  write(recordPointerRepo, 'docs/old.md', '# Old authored location\n');
  write(recordPointerRepo, 'records/one.md', '# Record\n\n[old](docs/old.md)\n');
  commit(recordPointerRepo, 'seed record-qualified legacy path');
  result = run(['adopt', '--root', recordPointerRepo, ...COLLECTION], recordPointerRepo);
  check('record-qualified pointer fixture adopts before migration', result.status === 0, result.output);
  commit(recordPointerRepo, 'adopt before pointer migration');
  const pointerInventory = JSON.parse(readFileSync(generated(recordPointerRepo, 'inventory.json'), 'utf8'));
  const pointerManifestPath = join(recordPointerRepo, 'hub', '98 System', 'DOCS_MANIFEST.json');
  const pointerManifest = JSON.parse(readFileSync(pointerManifestPath, 'utf8'));
  pointerManifest.legacyPaths = [{
    path: 'docs/old.md', disposition: 'pointer', target: 'hub/Standard.md',
    requiredBy: [{ kind: 'record', ref: pointerInventory.entries[0].id }],
  }];
  writeFileSync(pointerManifestPath, `${JSON.stringify(pointerManifest, null, 2)}\n`);
  result = run(['render', '--legacy', '--root', recordPointerRepo, ...COLLECTION], recordPointerRepo);
  const pointerRender = result;
  result = run(['check', '--root', recordPointerRepo, ...COLLECTION], recordPointerRepo);
  check('record-qualified pointer migration preserves pinned history and passes', pointerRender.status === 0 && result.status === 0, `${pointerRender.output}\n${result.output}`);
  if (executedCases !== expectedCases) throw new Error(`expected ${expectedCases} cases but executed ${executedCases}`);
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(`\nrecord-collections eval passed (${executedCases}/${expectedCases} cases)`);
} catch (error) {
  const message = error instanceof Error ? error.message : (() => {
    try { return String(error); } catch { return '<unstringifiable thrown value>'; }
  })();
  console.error(`\nrecord-collections eval aborted (${executedCases}/${expectedCases} cases): ${message}`);
  process.exitCode = 1;
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
