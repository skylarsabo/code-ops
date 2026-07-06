#!/usr/bin/env node
// Auto-apply diff gate regression eval — asserts check-autofix-scope denies the always-gated
// categories mechanically (auth paths, workflows, oversize, export-touching, missing tests),
// honors config-file extensions, rejects option-smuggling refs, and above all fails closed:
// with no mode flags even a perfectly clean diff is denied.
//
//   node evals/autofix-scope/run.mjs   (exit 0 = pass)
//
// Fixture diffs are generated into a temp dir at runtime (the eval owns no checked-in fixtures).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gate = resolve(here, '..', '..', 'scripts', 'check-autofix-scope.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'autofix-scope-eval-'));
const put = (name, text) => { const p = join(tmp, name); writeFileSync(p, text); return p; };
const run = (args) => spawnSync('node', [gate, ...args], { encoding: 'utf8' });
const AUTO = ['--interactive', '--level', 'auto-safe'];

// --- fixtures -------------------------------------------------------------
// Clean: 1 file, 4 changed lines, no gated path, no export lines. The @@ hunk header carries
// "export function" as a decoy — hunk headers and context must never trigger EXPORTS.
const clean = put('clean.diff', `diff --git a/src/lib/format.mjs b/src/lib/format.mjs
index 3f9c2ab..8d1e4f0 100644
--- a/src/lib/format.mjs
+++ b/src/lib/format.mjs
@@ -12,7 +12,7 @@ export function fmt(n) {
   const parts = [];
   if (n < 0) {
-    parts.push('-');
-    n = -n;
+    parts.push('-'); // sign first, magnitude second
+    n = Math.abs(n);
   }
   return parts.join('') + String(n);
 }
`);

const auth = put('auth.diff', `diff --git a/src/auth/login.mjs b/src/auth/login.mjs
index 1a2b3c4..5d6e7f8 100644
--- a/src/auth/login.mjs
+++ b/src/auth/login.mjs
@@ -20,5 +20,5 @@ function checkPassword(user, pw) {
   if (!user) return false;
-  return timingSafeEqual(hashOf(pw), user.hash);
+  return timingSafeEqual(hashOf(pw), user.pwHash);
 }
`);

const workflow = put('workflow.diff', `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
index aaa1111..bbb2222 100644
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -8,3 +8,3 @@ jobs:
   build:
-    runs-on: ubuntu-22.04
+    runs-on: ubuntu-24.04
`);

// Oversize: 60 changed lines in one otherwise-innocent file (> default maxLines 50).
const oversize = put('oversize.diff', `diff --git a/src/lib/big.mjs b/src/lib/big.mjs
index ccc3333..ddd4444 100644
--- a/src/lib/big.mjs
+++ b/src/lib/big.mjs
@@ -1,2 +1,62 @@
 const table = [
${Array.from({ length: 60 }, (_, i) => `+  'row ${i}',`).join('\n')}
 ];
`);

const exportsDiff = put('exports.diff', `diff --git a/src/lib/api.mjs b/src/lib/api.mjs
index eee5555..fff6666 100644
--- a/src/lib/api.mjs
+++ b/src/lib/api.mjs
@@ -30,3 +30,7 @@ function internalHelper() {
   return 1;
 }
+
+export function newPublicApi(x) {
+  return internalHelper() + x;
+}
`);

const withTest = put('withtest.diff', `diff --git a/src/lib/format.mjs b/src/lib/format.mjs
index 3f9c2ab..8d1e4f0 100644
--- a/src/lib/format.mjs
+++ b/src/lib/format.mjs
@@ -13,3 +13,3 @@ export function fmt(n) {
   if (n < 0) {
-    n = -n;
+    n = Math.abs(n);
   }
diff --git a/test/format.test.mjs b/test/format.test.mjs
index abc0001..abc0002 100644
--- a/test/format.test.mjs
+++ b/test/format.test.mjs
@@ -5,2 +5,3 @@ assert.equal(fmt(1), '1');
 assert.equal(fmt(0), '0');
+assert.equal(fmt(-1), '-1');
`);

// Not in the seeded denylist — only denied when a config root adds vendor/** to extraDenyGlobs.
const vendor = put('vendor.diff', `diff --git a/vendor/lib.js b/vendor/lib.js
index 1230000..4560000 100644
--- a/vendor/lib.js
+++ b/vendor/lib.js
@@ -1,3 +1,3 @@
 (function () {
-  var counter = 1;
+  var counter = 2;
 })();
`);

const plainRoot = join(tmp, 'plain-root');
mkdirSync(plainRoot);
const cfgRoot = join(tmp, 'cfg-root');
mkdirSync(cfgRoot);
writeFileSync(join(cfgRoot, '.autofix-scope.json'), JSON.stringify({ extraDenyGlobs: ['vendor/**'] }));

// --- cases ----------------------------------------------------------------
let failed = 0;
const out = (r) => (r.stdout || '') + (r.stderr || '');
const check = (name, r, wantStatus, wantRe) => {
  const o = out(r);
  if (r.status !== wantStatus || (wantRe && !wantRe.test(o))) {
    failed++;
    console.error(`FAIL ${name} — want exit ${wantStatus}${wantRe ? ` matching ${wantRe}` : ''}, got exit ${r.status}\n--- output ---\n${o}--- end ---`);
  } else console.log(`ok   ${name}`);
};

check('clean diff passes under --interactive --level auto-safe', run(['--diff', clean, '--root', plainRoot, ...AUTO]), 0, /ALLOW/);
check('fail-closed default: NO FLAGS denies even the clean diff', run(['--diff', clean, '--root', plainRoot]), 1, /MODE/);
check('--level gated denies everything too', run(['--diff', clean, '--root', plainRoot, '--interactive', '--level', 'gated']), 1, /MODE/);
check('auth-path edit denied (DENYLIST)', run(['--diff', auth, '--root', plainRoot, ...AUTO]), 1, /DENYLIST.*auth/);
check('workflow-file edit denied (DENYLIST)', run(['--diff', workflow, '--root', plainRoot, ...AUTO]), 1, /DENYLIST.*workflows/);
check('oversize diff denied (SIZE)', run(['--diff', oversize, '--root', plainRoot, ...AUTO]), 1, /SIZE/);
check('export-touching diff denied (EXPORTS)', run(['--diff', exportsDiff, '--root', plainRoot, ...AUTO]), 1, /EXPORTS/);
check('--require-test denies a no-test diff (TESTEVIDENCE)', run(['--diff', clean, '--root', plainRoot, ...AUTO, '--require-test']), 1, /TESTEVIDENCE/);
check('--require-test passes a with-test diff', run(['--diff', withTest, '--root', plainRoot, ...AUTO, '--require-test']), 0, /ALLOW/);
check('without --require-test the missing test is advisory only', run(['--diff', clean, '--root', plainRoot, ...AUTO]), 0, /advisory/);
check('vendor diff passes with no config (control)', run(['--diff', vendor, '--root', plainRoot, ...AUTO]), 0, /ALLOW/);
check('config extraDenyGlobs extends the denylist', run(['--diff', vendor, '--root', cfgRoot, ...AUTO]), 1, /DENYLIST.*vendor/);
check('--git rejects an option-like ref token', run(['--git', '--output=pwn', ...AUTO]), 2, /option-like/);

rmSync(tmp, { recursive: true, force: true });

if (failed) {
  console.error(`\nFAIL — autofix-scope eval: ${failed} case(s) failed.`);
  process.exit(1);
}
console.log('\nPASS — autofix-scope eval: gated categories denied mechanically, config extension honored, option-smuggling ref rejected, and the no-flags default fails closed.');
