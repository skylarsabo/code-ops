#!/usr/bin/env node
// Regression eval for scripts/check-action-pins.mjs.
//
//   node evals/action-pins/run.mjs   (exit 0 = pass)

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', '..', 'scripts', 'check-action-pins.mjs');
const SHA = '0123456789abcdef0123456789abcdef01234567';
const SETUP_SHA = '89abcdef0123456789abcdef0123456789abcdef';

const pin = (identity, sha = SHA, version = 'v1.2.3') => ({
  sha,
  version,
  repository: `https://github.com/${identity.split('/').slice(0, 2).join('/')}`,
  license: 'MIT',
  tagVerification: 'fixture verification',
  runtime: 'node24',
  workflowPermissions: [],
  egress: 'fixture endpoint',
  telemetry: 'fixture posture',
  advisories: [],
});
const policy = (sources = ['.github/workflows'], actions = { 'acme/action': pin('acme/action') }) => JSON.stringify({
  schemaVersion: 1,
  reviewedAt: '2026-08-29',
  nodeVersionFile: '.node-version',
  sources,
  actions,
  allowLocalActions: true,
}, null, 2);

const fails = [];
const check = (name, condition, detail) => {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${name}`);
  if (!condition) fails.push(`${name}${detail ? ` - ${detail}` : ''}`);
};

const run = (root) => spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
const work = mkdtempSync(join(tmpdir(), 'coh-action-pins-'));
const writeCase = (name, workflow, { sources, actions, nodeVersion = '24' } = {}) => {
  const root = join(work, name);
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'actions-lock.json'), policy(sources, actions));
  if (nodeVersion !== null) writeFileSync(join(root, '.node-version'), `${nodeVersion}\n`);
  if (workflow !== null) writeFileSync(join(root, '.github', 'workflows', 'test.yml'), workflow);
  return root;
};

try {
  let root = writeCase('valid-direct', `steps:\n  - uses: acme/action@${SHA} # v1.2.3\n`);
  let output = run(root);
  check('valid direct pin passes', output.status === 0, output.stderr);

  root = writeCase('valid-quoted', `steps:\n  - "uses": "acme/action@${SHA}" # v1.2.3\n`);
  output = run(root);
  check('quoted key and value pass', output.status === 0, output.stderr);

  root = writeCase('valid-local', 'steps:\n  - uses: ./local-action\n');
  mkdirSync(join(root, 'local-action'));
  writeFileSync(join(root, 'local-action', 'action.yml'), 'runs:\n  using: composite\n  steps: []\n');
  output = run(root);
  check('existing local action passes', output.status === 0, output.stderr);

  root = writeCase('local-composite-nested-unapproved', 'steps:\n  - uses: ./local-action\n');
  mkdirSync(join(root, 'local-action'));
  writeFileSync(join(root, 'local-action', 'action.yml'), 'runs:\n  using: composite\n  steps:\n    - uses: evil/action@v1\n');
  output = run(root);
  check('local composite dependencies remain governed', output.status === 1 && /not allowlisted|mutable/.test(output.stderr), output.stderr);

  root = writeCase('local-workflow-nested-unapproved', 'jobs:\n  call:\n    uses: ./.github/workflows/local.yml\n');
  writeFileSync(join(root, '.github', 'workflows', 'local.yml'), 'steps:\n  - uses: evil/action@v1\n');
  output = run(root);
  check('local reusable workflow dependencies remain governed', output.status === 1 && /not allowlisted|mutable/.test(output.stderr), output.stderr);

  root = writeCase('valid-anchor', `steps:\n  - uses: &shared acme/action@${SHA} # v1.2.3\n  - uses: *shared\n`);
  output = run(root);
  check('attached anchor and alias pass', output.status === 0, output.stderr);

  root = writeCase('valid-external-anchor', `x-action: &shared "acme/action@${SHA}" # v1.2.3\nsteps:\n  - uses: *shared\n`);
  output = run(root);
  check('separate scalar anchor and alias pass', output.status === 0, output.stderr);

  root = writeCase('block-scalar-decoy', `steps:\n  - run: |\n      echo "uses: evil/action@v1"\n      echo "node-version: 18"\n  - uses: acme/action@${SHA} # v1.2.3\n`);
  output = run(root);
  check('block-scalar decoys stay out of semantic scanning', output.status === 0, output.stderr);

  const reusable = 'acme/workflows/.github/workflows/check.yml';
  root = writeCase('reusable-workflow', `jobs:\n  call:\n    uses: ${reusable}@${SHA} # v1.2.3\n`, {
    actions: { [reusable]: pin(reusable) },
  });
  output = run(root);
  check('allowlisted reusable workflow subpath passes', output.status === 0, output.stderr);

  root = writeCase('valid-setup-node', `steps:\n  - uses: actions/setup-node@${SETUP_SHA} # v7.0.0\n    with:\n      node-version-file: '.node-version'\n`, {
    actions: { 'actions/setup-node': pin('actions/setup-node', SETUP_SHA, 'v7.0.0') },
  });
  output = run(root);
  check('setup-node consuming the Node SSOT passes', output.status === 0, output.stderr);

  root = writeCase('valid-bare-dash-setup-node', `steps:\n  -\n    uses: actions/setup-node@${SETUP_SHA} # v7.0.0\n    with:\n      node-version-file: '.node-version'\n`, {
    actions: { 'actions/setup-node': pin('actions/setup-node', SETUP_SHA, 'v7.0.0') },
  });
  output = run(root);
  check('setup-node under a bare list marker consumes the Node SSOT', output.status === 0, output.stderr);

  root = writeCase('flow-bypass', 'steps: [{ uses: evil/action@v1 }]\n');
  output = run(root);
  check('flow-style uses cannot bypass scanning', output.status === 1 && /non-canonical uses/.test(output.stderr), output.stderr);

  root = writeCase('json-bypass', '{"steps":[{"uses":"evil/action@v1"}]}\n');
  output = run(root);
  check('JSON workflow syntax fails closed', output.status === 1 && /JSON or top-level flow/.test(output.stderr), output.stderr);

  root = writeCase('mutable-tag', 'steps:\n  - uses: acme/action@v1 # v1.2.3\n');
  output = run(root);
  check('mutable tag fails closed', output.status === 1 && /mutable/.test(output.stderr), output.stderr);

  root = writeCase('unlisted', `steps:\n  - uses: other/action@${SHA} # v1.2.3\n`);
  output = run(root);
  check('unlisted action fails closed', output.status === 1 && /not allowlisted/.test(output.stderr), output.stderr);

  root = writeCase('wrong-sha', 'steps:\n  - uses: acme/action@fedcba9876543210fedcba9876543210fedcba98 # v1.2.3\n');
  output = run(root);
  check('wrong SHA fails closed', output.status === 1 && /does not match policy/.test(output.stderr), output.stderr);

  root = writeCase('missing-version', `steps:\n  - uses: acme/action@${SHA}\n`);
  output = run(root);
  check('missing version annotation fails closed', output.status === 1 && /version annotation/.test(output.stderr), output.stderr);

  root = writeCase('wrong-version', `steps:\n  - uses: acme/action@${SHA} # v1.2.4\n`);
  output = run(root);
  check('wrong version annotation fails closed', output.status === 1 && /version annotation/.test(output.stderr), output.stderr);

  root = writeCase('unresolved-alias', 'steps:\n  - uses: *missing\n');
  output = run(root);
  check('unresolved alias fails closed', output.status === 1 && /unresolved/.test(output.stderr), output.stderr);

  root = writeCase('unsafe-local', 'steps:\n  - uses: ./../outside\n');
  output = run(root);
  check('upward local path fails closed', output.status === 1 && /unsafe/.test(output.stderr), output.stderr);

  root = writeCase('missing-local', 'steps:\n  - uses: ./missing-action\n');
  output = run(root);
  check('missing local action fails closed', output.status === 1 && /missing or non-physical/.test(output.stderr), output.stderr);

  root = writeCase('hardcoded-node', `steps:\n  - uses: acme/action@${SHA} # v1.2.3\n    with:\n      node-version: '18'\n`);
  output = run(root);
  check('hard-coded Node version fails closed', output.status === 1 && /hard-coded node-version/.test(output.stderr), output.stderr);

  root = writeCase('setup-node-missing-ssot', `steps:\n  - uses: actions/setup-node@${SETUP_SHA} # v7.0.0\n`, {
    actions: { 'actions/setup-node': pin('actions/setup-node', SETUP_SHA, 'v7.0.0') },
  });
  output = run(root);
  check('setup-node without the Node SSOT input fails closed', output.status === 1 && /exactly one node-version-file/.test(output.stderr), output.stderr);

  root = writeCase('setup-node-cannot-borrow-next-step', `steps:\n  - uses: actions/setup-node@${SETUP_SHA} # v7.0.0\n  -\n    name: unrelated\n    with:\n      node-version-file: '.node-version'\n`, {
    actions: { 'actions/setup-node': pin('actions/setup-node', SETUP_SHA, 'v7.0.0') },
  });
  output = run(root);
  check('setup-node cannot borrow the next bare-list step input', output.status === 1 && /exactly one node-version-file/.test(output.stderr), output.stderr);

  root = writeCase('setup-node-wrong-ssot', `steps:\n  - uses: actions/setup-node@${SETUP_SHA} # v7.0.0\n    with:\n      node-version-file: '.tool-versions'\n`, {
    actions: { 'actions/setup-node': pin('actions/setup-node', SETUP_SHA, 'v7.0.0') },
  });
  output = run(root);
  check('setup-node with another version file fails closed', output.status === 1 && /node-version-file must equal/.test(output.stderr), output.stderr);

  root = writeCase('missing-node-ssot', `steps:\n  - uses: acme/action@${SHA} # v1.2.3\n`, { nodeVersion: null });
  output = run(root);
  check('missing Node SSOT file fails closed', output.status === 1 && /nodeVersionFile is missing/.test(output.stderr), output.stderr);

  root = writeCase('missing-source', null, { sources: ['.github/missing'] });
  output = run(root);
  check('missing declared source fails closed', output.status === 1 && /declared source is missing/.test(output.stderr), output.stderr);

  root = writeCase('overlapping-sources', `steps:\n  - uses: acme/action@${SHA} # v1.2.3\n`, {
    sources: ['.github/workflows', '.github/workflows/test.yml'],
  });
  output = run(root);
  check('overlapping sources scan each YAML file once', output.status === 0 && /OK - 1 YAML file/.test(output.stdout), output.stderr);

  root = writeCase('missing-review-metadata', `steps:\n  - uses: acme/action@${SHA} # v1.2.3\n`);
  const missingMetadata = JSON.parse(policy());
  delete missingMetadata.actions['acme/action'].telemetry;
  writeFileSync(join(root, '.github', 'actions-lock.json'), JSON.stringify(missingMetadata));
  output = run(root);
  check('missing action review metadata fails closed', output.status === 1 && /missing review metadata/.test(output.stderr), output.stderr);

  root = writeCase('major-only-label', `steps:\n  - uses: acme/action@${SHA} # v1\n`);
  const majorOnly = JSON.parse(policy());
  majorOnly.actions['acme/action'].version = 'v1';
  writeFileSync(join(root, '.github', 'actions-lock.json'), JSON.stringify(majorOnly));
  output = run(root);
  check('non-exact action version label fails closed', output.status === 1 && /full v-prefixed semantic version/.test(output.stderr), output.stderr);

  root = writeCase('malformed-policy', `steps:\n  - uses: acme/action@${SHA} # v1.2.3\n`);
  writeFileSync(join(root, '.github', 'actions-lock.json'), '{"schemaVersion": 2}');
  output = run(root);
  check('malformed policy fails closed', output.status === 1 && /schemaVersion/.test(output.stderr), output.stderr);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL - ${fails.length} action-pin regression check(s) failed:`);
  for (const failure of fails) console.error('  x ' + failure);
  process.exit(1);
}
console.log('\nOK - all action-pin regression checks passed.');
