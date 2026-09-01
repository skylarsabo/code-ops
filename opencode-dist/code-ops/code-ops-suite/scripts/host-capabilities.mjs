#!/usr/bin/env node
// Writes and validates explicit host capability receipts without guessing from a model name.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertNoTrackedPortableAlias, atomicWrite, checkedPath, safeRelative } from './context-index-lib.mjs';
import {
  CAPABILITY_STATES,
  loadHostCapabilities,
  validateHostCapabilities,
} from './runtime-lib.mjs';

function die(message, code = 1) { console.error(`x ${message}`); process.exit(code); }
function usage() {
  die('usage: host-capabilities.mjs init --root <repo> --out <repo-relative-path> --host <name> --provider <name> --model <name> --source operator|host-probe|provider-docs --prompt-caching <state> --compaction <state> --context-editing <state> --host-memory <state> --task-budget <state>\n'
    + '       host-capabilities.mjs check --root <repo> --file <repo-relative-path>', 2);
}

function flags(args, known) {
  const out = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!known.has(key) || out[key] !== undefined) usage();
    const value = args[++index];
    if (!value || value.startsWith('--')) usage();
    out[key] = value;
  }
  return out;
}

const command = process.argv[2];
if (command === 'init') {
  const names = ['--root', '--out', '--host', '--provider', '--model', '--source', '--prompt-caching', '--compaction', '--context-editing', '--host-memory', '--task-budget'];
  const f = flags(process.argv.slice(3), new Set(names));
  if (names.some((name) => !f[name])) usage();
  try {
    const root = resolve(f['--root']);
    if (!safeRelative(f['--out'])) throw new Error('--out must be a repository-relative path');
    assertNoTrackedPortableAlias(root, f['--out'], 'host capabilities output');
    const out = checkedPath(root, f['--out']);
    if (existsSync(out)) throw new Error(`host capabilities already exist: ${f['--out']}`);
    const value = {
      version: 1,
      host: f['--host'],
      provider: f['--provider'],
      model: f['--model'],
      source: f['--source'],
      observedAt: new Date().toISOString(),
      capabilities: {
        promptCaching: f['--prompt-caching'],
        compaction: f['--compaction'],
        contextEditing: f['--context-editing'],
        hostMemory: f['--host-memory'],
        taskBudget: f['--task-budget'],
      },
    };
    const errors = validateHostCapabilities(value);
    if (errors.length) throw new Error(errors.join('; '));
    atomicWrite(out, `${JSON.stringify(value, null, 2)}\n`);
    const loaded = loadHostCapabilities(root, f['--out']);
    console.log(`ok host capabilities ${loaded.sha256}`);
  } catch (error) { die(error.message); }
} else if (command === 'check') {
  const f = flags(process.argv.slice(3), new Set(['--root', '--file']));
  if (!f['--root'] || !f['--file']) usage();
  try {
    const loaded = loadHostCapabilities(resolve(f['--root']), f['--file']);
    console.log(`ok host capabilities ${loaded.sha256}`);
  } catch (error) { die(error.message); }
} else usage();

// Keep the accepted vocabulary visible to command readers without a second schema table.
export { CAPABILITY_STATES };
