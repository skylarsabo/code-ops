#!/usr/bin/env node
// Opt this checkout into the tracked pre-commit hook that regenerates and stages the derived
// host distributions, and register the derived-file merge driver (scripts/derived-merge.mjs).
// CI remains the fail-closed backstop for clones
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
import { driverRegistered, ensureAttributes, registerDriver } from './derived-merge.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS_PATH = '.githooks';
const HOOK_NAMES = ['pre-commit', 'pre-merge-commit', 'post-merge'];
const HOOK_PATHS = HOOK_NAMES.map((name) => resolve(ROOT, HOOKS_PATH, name));
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
for (const hook of HOOK_PATHS) {
  if (!existsSync(hook)) {
    console.error(`x tracked hook is missing: ${hook}`);
    process.exit(2);
  }
}

let current = '';
try { current = git(['config', '--get', 'core.hooksPath']); } catch { /* unset is expected */ }

if (check) {
  if (current === HOOKS_PATH) {
    const driver = driverRegistered(ROOT);
    if (!driver.registered || !driver.attributes) {
      console.error('x the derived-file merge driver is not fully installed. Run: node scripts/install-git-hooks.mjs');
      process.exit(1);
    }
    console.log(`OK — repository hooks and the derived-file merge driver are installed (${HOOKS_PATH}).`);
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
if (process.platform !== 'win32') for (const hook of HOOK_PATHS) chmodSync(hook, 0o755);
// A merge runs no pre-commit hook mid-merge, so the driver records the derived files that
// conflicted and the commit hooks regenerate them. See scripts/derived-merge.mjs.
registerDriver(ROOT);
ensureAttributes(ROOT);
console.log(`Installed repository hooks (${HOOKS_PATH}). Pre-commit will regenerate and stage the derived host distributions. The derived-file merge driver is registered, so a merge regenerates conflicting derived files instead of stopping on them.`);
