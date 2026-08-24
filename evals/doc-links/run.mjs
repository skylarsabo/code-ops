#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'); const script = join(repo, 'scripts', 'check-doc-links.mjs'); const outer = mkdtempSync(join(tmpdir(), 'coh-links-')); const hub = join(outer, 'repo-docs'); const failures = [];
const run = () => { try { return { status: 0, out: execFileSync(process.execPath, [script, '--root', outer, '--hub', 'repo-docs'], { encoding: 'utf8' }) }; } catch (error) { return { status: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` }; } };
const check = (name, pass, detail = '') => { console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`); if (!pass) failures.push(`${name}: ${detail}`); };
try {
  mkdirSync(join(hub, 'Area'), { recursive: true }); writeFileSync(join(hub, 'Area', 'Target.md'), '# Target\n'); writeFileSync(join(hub, 'Home.md'), '[valid](Area/Target.md)\n'); let result = run(); check('valid exact-case link passes', result.status === 0, result.out);
  writeFileSync(join(hub, 'Home.md'), '[missing](Area/Missing.md)\n'); result = run(); check('missing target fails closed', result.status === 1 && /target does not exist/.test(result.out), result.out);
  writeFileSync(join(hub, 'Home.md'), '[case](area/Target.md)\n'); result = run(); check('case mismatch fails portably', result.status === 1 && /target case differs|target does not exist/.test(result.out), result.out);
  writeFileSync(join(hub, 'Home.md'), '[escape](../../outside.md)\n'); result = run(); check('repository escape fails closed', result.status === 1 && /escapes repository/.test(result.out), result.out);
} finally { rmSync(outer, { recursive: true, force: true }); }
if (failures.length) { console.error(`\n${failures.join('\n')}`); process.exit(1); } console.log('\ndoc-links eval passed');
