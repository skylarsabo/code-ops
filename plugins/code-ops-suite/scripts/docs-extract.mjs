#!/usr/bin/env node
// Produces deterministic extraction work from the repository's sole documentation manifest.
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, sha256 } from './context-index-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_SCRIPT = resolve(HERE, 'docs-manifest.mjs');
function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
function usage() { die('usage: docs-extract.mjs plan --root <repo> --out <file>', 2); }
function flags(args) {
  const out = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!['--root', '--out'].includes(key) || out[key] !== undefined || !value || value.startsWith('--')) usage();
    out[key] = value;
  }
  return out;
}
const args = process.argv.slice(2);
if (args.shift() !== 'plan') usage();
const parsed = flags(args);
if (!parsed['--root'] || !parsed['--out']) usage();
const root = resolve(parsed['--root']); const out = resolve(parsed['--out']);
let plan;
try { plan = JSON.parse(execFileSync(process.execPath, [MANIFEST_SCRIPT, 'plan', '--root', root], { cwd: root, encoding: 'utf8' })); }
catch (error) { die(String(error.stdout || error.stderr || error.message).trim()); }
const tasks = plan.domains.map((domain, index) => ({
  id: `DOC-${String(index + 1).padStart(3, '0')}`,
  domain: domain.id,
  target: domain.path,
  sources: domain.affectedSources,
  instruction: domain.status === 'not-applicable'
    ? 'Revalidate the recorded non-applicability evidence.'
    : 'Extract current claims from the listed changed sources; update only this canonical target.',
}));
const receipt = { version: 1, hub: plan.hub, manifestSha256: plan.manifestSha256, changedSha256: sha256(JSON.stringify(plan.changed)), tasks };
atomicWrite(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`ok documentation extraction plan (${tasks.length} task(s))`);
