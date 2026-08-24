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
  mkdirSync(join(hub, 'Area'), { recursive: true }); mkdirSync(join(hub, 'Elsewhere'), { recursive: true }); mkdirSync(join(hub, 'Notes'), { recursive: true });
  writeFileSync(join(hub, 'Area', 'Target.md'), '# Target\n\n## Deep section\n\n## Foo\n\n## Foo-1\n\n## Foo\n'); writeFileSync(join(hub, 'Area', 'README.md'), '# Area\n'); writeFileSync(join(hub, 'Elsewhere', 'Target.md'), '# Other target\n'); writeFileSync(join(hub, 'Notes', 'Unique.md'), '# Unique\n');
  writeFileSync(join(hub, 'Home.md'), '[valid](Area/Target.md)\n'); let result = run(); check('valid exact-case link passes', result.status === 0, result.out);
  writeFileSync(join(hub, 'Home.md'), '[directory](Area/)\n'); result = run(); check('hub-internal directory link fails closed', result.status === 1 && /hub-internal target is a directory/.test(result.out), result.out);
  writeFileSync(join(hub, 'Home.md'), '[index](Area/README.md)\n'); result = run(); check('explicit hub index note passes', result.status === 0, result.out);
  writeFileSync(join(hub, 'Home.md'), '# Local section\n\n[local](#local-section) [cross-file](Area/Target.md#deep-section)\n'); result = run(); check('local and cross-file heading fragments pass', result.status === 0, result.out);
  writeFileSync(join(hub, 'Home.md'), '[collision-safe duplicate](Area/Target.md#foo-2)\n'); result = run(); check('duplicate heading fragments avoid explicit-suffix collisions', result.status === 0, result.out);
  writeFileSync(join(hub, 'Home.md'), '[missing heading](Area/Target.md#missing-section)\n'); result = run(); check('missing heading fragment fails closed', result.status === 1 && /heading fragment does not exist/.test(result.out), result.out);
  writeFileSync(join(hub, 'Home.md'), '[[Area/Target]] [[Area/Target.md]] [[Area/Target#Heading|display]] [[Area/Target#^block-id]] [[Unique]]\n'); result = run(); check('vault-relative, extensionless, heading, block, alias, and unique-basename wikilinks pass', result.status === 0, result.out);
  writeFileSync(join(hub, 'Home.md'), '[[Target]]\n'); result = run(); check('ambiguous basename wikilink fails closed', result.status === 1 && /wikilink target is ambiguous/.test(result.out), result.out);
  writeFileSync(join(hub, 'Home.md'), '[[Area/Missing]]\n'); result = run(); check('missing wikilink fails closed', result.status === 1 && /wikilink target does not exist/.test(result.out), result.out);
  writeFileSync(join(hub, 'Home.md'), '[[Area/Target]] [[Area/Missing]]\n'); result = run(); check('adjacent valid and missing wikilinks retain the missing failure', result.status === 1 && /Area\/Missing/.test(result.out), result.out);
  writeFileSync(join(hub, 'Home.md'), '`[[Area/Missing]]` and [[Area/Target]]\n    [[Area/Missing]]\n```md\n[[Area/Missing]]\n```\n'); result = run(); check('inline, indented, and fenced code examples do not suppress live wikilinks', result.status === 0, result.out);
  writeFileSync(join(hub, 'Home.md'), '[root](..)\n'); result = run(); check('repository root is an exact-case Markdown target', result.status === 0, result.out);
  writeFileSync(join(hub, 'Home.md'), '[missing](Area/Missing.md)\n'); result = run(); check('missing target fails closed', result.status === 1 && /target does not exist/.test(result.out), result.out);
  writeFileSync(join(hub, 'Home.md'), '[case](area/Target.md)\n'); result = run(); check('case mismatch fails portably', result.status === 1 && /target case differs|target does not exist/.test(result.out), result.out);
  writeFileSync(join(hub, 'Home.md'), '[escape](../../outside.md)\n'); result = run(); check('repository escape fails closed', result.status === 1 && /escapes repository/.test(result.out), result.out);
} finally { rmSync(outer, { recursive: true, force: true }); }
if (failures.length) { console.error(`\n${failures.join('\n')}`); process.exit(1); } console.log('\ndoc-links eval passed');
