#!/usr/bin/env node
// Sync vendored runtime scripts: copies each scripts/vendored-manifest.mjs entry from the
// canonical scripts/<name> over every plugins/<plugin>/scripts/<name> it lists, byte-identical.
// scripts/lint-plugins.mjs enforces the same manifest as a CI gate (check 6); this script is
// what actually performs the copy — the pre-commit hook runs it when a manifest-listed
// canonical script is staged.
//
//   node scripts/sync-vendored.mjs            write mode: copy every drifted/missing file
//   node scripts/sync-vendored.mjs --check     report drift only, write nothing
//
// Exit 0 = synced/clean, 1 = drift found (--check) or a copy failure, 2 = bad invocation.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_SCRIPTS } from './vendored-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => p.slice(ROOT.length + 1).replaceAll('\\', '/');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
if (args.some((a) => a !== '--check')) {
  console.error('usage: node scripts/sync-vendored.mjs [--check]');
  process.exit(2);
}

let synced = 0;
let current = 0;
let issue = false;

for (const entry of RUNTIME_SCRIPTS) {
  const canonicalPath = join(ROOT, 'scripts', entry.name);
  if (!existsSync(canonicalPath)) {
    console.error(`x missing canonical scripts/${entry.name}`);
    issue = true;
    continue;
  }
  const canon = readFileSync(canonicalPath, 'utf8');
  for (const pluginName of entry.plugins) {
    const targetDir = join(ROOT, 'plugins', pluginName, 'scripts');
    const targetPath = join(targetDir, entry.name);
    const existing = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : null;
    if (existing === canon) {
      current += 1;
      continue;
    }
    if (checkOnly) {
      console.log(`drift: ${rel(targetPath)}`);
      issue = true;
      continue;
    }
    try {
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(targetPath, canon);
      console.log(rel(targetPath));
      synced += 1;
    } catch (e) {
      console.error(`x failed to write ${rel(targetPath)}: ${e.message}`);
      issue = true;
    }
  }
}

if (checkOnly) {
  if (issue) {
    console.error('\nFAIL — vendored copies have drifted; run: node scripts/sync-vendored.mjs');
    process.exit(1);
  }
  console.log(`OK — ${current} file(s) current, no drift.`);
  process.exit(0);
}

if (issue) {
  console.error('\nFAIL — one or more vendored copies could not be synced.');
  process.exit(1);
}
console.log(`OK — ${synced} file(s) synced (${current} already current).`);
process.exit(0);
