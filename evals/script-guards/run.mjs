#!/usr/bin/env node
// Regression eval for the high-severity script-guard fixes (2026-06-23 scripts audit, SCR-001..005).
// Each check asserts the FIXED behavior and fails (exit 1) if a guard regresses. It exercises the
// real, unmodified scripts: the lib-docs helpers directly, revalidate-register / research-manifest
// over child processes against throwaway fixtures. Import samples live in fixtures/*.txt so the
// zero-dependency gate does not scan them as real source.
//
//   node evals/script-guards/run.mjs   (exit 0 = all guards hold)

import { safeFetchUrl, findTypes } from '../../scripts/lib-docs.mjs';
import { findThirdPartySpecs } from '../../scripts/check-no-deps.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIX = join(HERE, 'fixtures');
const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };
const runNode = (args) => {
  try { return { code: 0, out: execFileSync('node', args, { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};

// SCR-002 — safeFetchUrl rejects IPv4-mapped IPv6 (the SSRF bypass)
check('SCR-002 reject [::ffff:127.0.0.1]', safeFetchUrl('https://[::ffff:127.0.0.1]/') === false);
check('SCR-002 reject [::ffff:169.254.169.254]', safeFetchUrl('https://[::ffff:169.254.169.254]/') === false);
check('SCR-002 allow public host', safeFetchUrl('https://example.com/') === true);
check('SCR-002 reject [::1]', safeFetchUrl('https://[::1]/') === false);

const work = mkdtempSync(join(tmpdir(), 'coh-sg-'));
try {
  // SCR-001 — a package `types` value that escapes the package dir is refused (the evil dir has
  // no in-dir type file, so a correct guard returns null rather than reading the out-of-dir secret).
  const evilDir = join(work, 'node_modules', 'evilpkg');
  const goodDir = join(work, 'node_modules', 'goodpkg');
  mkdirSync(evilDir, { recursive: true });
  mkdirSync(goodDir, { recursive: true });
  writeFileSync(join(work, 'secret.d.ts'), 'export const STOLEN = 1;\n'); // outside any package dir
  writeFileSync(join(goodDir, 'index.d.ts'), 'export const ok = 1;\n');
  const evilRes = findTypes({ dir: evilDir, types: '../../secret.d.ts' });
  check('SCR-001 traversal types refused', evilRes === null && evilRes !== join(work, 'secret.d.ts'));
  check('SCR-001 in-dir types resolved', findTypes({ dir: goodDir, types: 'index.d.ts' }) === join(goodDir, 'index.d.ts'));

  // SCR-003 — an escaping citation is classified AMBIGUOUS and gates (non-zero exit)
  const root3 = join(work, 'r3');
  mkdirSync(join(root3, 'etc'), { recursive: true });
  writeFileSync(join(root3, 'etc', 'passwd.js'), 'a\nb\nc\n'); // coincidental in-repo file
  const reg = join(work, 'reg.md');
  writeFileSync(reg, '## BUG-1\nLocation: ../../etc/passwd.js:2\n');
  const r3 = runNode([join(REPO, 'scripts', 'revalidate-register.mjs'), reg, '--root', root3]);
  check('SCR-003 escaping ref classified AMBIGUOUS', /AMBIGUOUS/.test(r3.out));
  check('SCR-003 escaping ref gates (non-zero)', r3.code !== 0);

  // SCR-004 — a URL in the free-text `why` column does NOT whitelist its host
  const man = join(work, 'EGRESS_MANIFEST.md');
  const rm = join(REPO, 'scripts', 'research-manifest.mjs');
  runNode([rm, 'record', '--tool', 'test', '--url', 'https://a.test/x', '--why', 'cross-checked against https://evil.test/leak', '--manifest', man]);
  const art = join(work, 'art.md');
  writeFileSync(art, 'We relied on https://evil.test/leak for this.\n');
  check('SCR-004 why-column URL not whitelisted (undisclosed → non-zero)', runNode([rm, 'validate', art, '--manifest', man]).code !== 0);
  const art2 = join(work, 'art2.md');
  writeFileSync(art2, 'We relied on https://a.test/x for this.\n');
  check('SCR-004 structured url host disclosed (control → zero)', runNode([rm, 'validate', art2, '--manifest', man]).code === 0);

  // SCR-005 / SCR-009 — multiline and dynamic bare imports are caught; node:/relative are not
  check('SCR-005 multiline import caught', findThirdPartySpecs(readFileSync(join(FIX, 'multiline.txt'), 'utf8')).includes('axios'));
  check('SCR-009 dynamic import caught', findThirdPartySpecs(readFileSync(join(FIX, 'dynamic.txt'), 'utf8')).includes('lodash'));
  check('node/relative imports not flagged', findThirdPartySpecs(readFileSync(join(FIX, 'clean.txt'), 'utf8')).length === 0);
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} script-guard regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all script-guard regression checks passed.');
