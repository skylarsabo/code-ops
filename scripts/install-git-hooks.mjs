#!/usr/bin/env node
// Opt this checkout into the tracked pre-commit hook that regenerates and stages only
// the Codex marketplace artifacts. CI remains the fail-closed backstop for clones
// where hooks have not been installed or were bypassed.
//
// WHY: a derived-artifact drift gate only holds if the regeneration actually ran before
// the commit; this makes "install the hook" a single idempotent command instead of a
// manual `git config` step every clone has to remember.
//
//   node scripts/install-git-hooks.mjs
//   node scripts/install-git-hooks.mjs --check
//   node scripts/install-git-hooks.mjs --force
//
// Exit: 0 = installed (or --check confirms installed), 1 = --check reports hooks not
// installed, 2 = usage/config error (bad flags, wrong checkout, missing tracked hook,
// or a conflicting core.hooksPath without --force).

import { chmodSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS_PATH = '.githooks';
const HOOK_PATH = resolve(ROOT, HOOKS_PATH, 'pre-commit');
const args = process.argv.slice(2);
const check = args.includes('--check');
const force = args.includes('--force');

if (args.some((arg) => arg !== '--check' && arg !== '--force') || (check && force)) {
  console.error('usage: node scripts/install-git-hooks.mjs [--check | --force]');
  process.exit(2);
}

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf8', timeout: 10000, ...options }).trim();
}

const worktreeRoot = resolve(git(['rev-parse', '--show-toplevel']));
if (worktreeRoot !== ROOT) {
  console.error(`x run this script from its repository checkout (expected ${ROOT}, got ${worktreeRoot})`);
  process.exit(2);
}
if (!existsSync(HOOK_PATH)) {
  console.error(`x tracked hook is missing: ${HOOK_PATH}`);
  process.exit(2);
}

let current = '';
try { current = git(['config', '--get', 'core.hooksPath']); } catch { /* unset is expected */ }

if (check) {
  if (current === HOOKS_PATH) {
    console.log(`OK — repository hooks are installed (${HOOKS_PATH}).`);
    process.exit(0);
  }
  console.error(`x repository hooks are not installed (core.hooksPath is ${current ? JSON.stringify(current) : 'unset'}). Run: node scripts/install-git-hooks.mjs`);
  process.exit(1);
}

if (current && current !== HOOKS_PATH && !force) {
  console.error(`x refusing to override effective core.hooksPath ${JSON.stringify(current)}. Re-run with --force if that replacement is intentional.`);
  process.exit(2);
}

git(['config', '--local', 'core.hooksPath', HOOKS_PATH]);
if (process.platform !== 'win32') chmodSync(HOOK_PATH, 0o755);
console.log(`Installed repository hooks (${HOOKS_PATH}). Pre-commit will regenerate and stage only .agents/plugins/marketplace.json and codex-marketplace/.`);
