#!/usr/bin/env node
// Docs-and-standards alignment gate: every house standard page is named where the repo's
// contracts live, and every standard those contracts name exists.
//
//   node scripts/check-docs-standards-alignment.mjs [--root <repo-root>]
//
// A standard is any `*-standard.md` file directly under the Techniques folder, found by
// listing the folder, so a new standard joins the rule the moment it lands. The two rules:
//
//   1. Named. Each standard is named by AGENTS.md, a plugin CONVENTIONS.md, or the prose of a
//      plugin skill or agent. AGENTS.md names the writing and code standards; the suite skills
//      name the vault and fleet standards. A page named nowhere binds no one.
//   2. Exists. Each `<name>-standard.md` those same files name is a page in the folder, so a
//      renamed or deleted standard cannot leave a citation behind.
//
// The gate fails closed: a missing Techniques folder, AGENTS.md, or plugins folder is a finding.
// Exit 0 = aligned, 1 = findings, 2 = usage.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUT, PLUGINS_DIR, conventionsRel, layoutPath } from './layout-manifest.mjs';

const STANDARD_PAGE = /-standard\.md$/;
// A whole lowercase page name ending in `-standard.md`: not a `.mjs` script such as
// `check-vault-standard.mjs`, and not the tail of a name with an uppercase or underscore part.
const STANDARD_CITATION = /(?<![\w-])[a-z][a-z0-9]*(?:-[a-z0-9]+)*-standard\.md(?![\w])/g;
const CONTRACT_FILE = 'AGENTS.md';

const readText = (path) => readFileSync(path, 'utf8').replace(/^﻿/, '');
const listDir = (dir) => (existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir).sort() : []);

// Every file whose prose may name a standard: the repo contract, each plugin's CONVENTIONS.md,
// and each plugin's skill and agent bodies. Plugins are discovered, never listed.
function citingFiles(root) {
  const files = [CONTRACT_FILE];
  for (const plugin of listDir(join(root, PLUGINS_DIR))) {
    const base = `${PLUGINS_DIR}/${plugin}`;
    if (!statSync(join(root, base)).isDirectory()) continue;
    files.push(conventionsRel(plugin));
    for (const skill of listDir(join(root, base, 'skills'))) files.push(`${base}/skills/${skill}/SKILL.md`);
    for (const agent of listDir(join(root, base, 'agents'))) if (agent.endsWith('.md')) files.push(`${base}/agents/${agent}`);
  }
  return files.filter((file) => existsSync(join(root, ...file.split('/'))));
}

// Returns the findings for the tree at root: an empty array means aligned.
export function checkDocsStandards(root) {
  const problems = [];
  const techniques = layoutPath('techniques', root);
  if (!existsSync(techniques) || !statSync(techniques).isDirectory()) problems.push(`missing standards folder: ${LAYOUT.techniques}`);
  if (!existsSync(join(root, CONTRACT_FILE))) problems.push(`missing ${CONTRACT_FILE}`);
  if (!existsSync(join(root, PLUGINS_DIR))) problems.push(`missing ${PLUGINS_DIR}/ folder`);
  if (problems.length) return problems;

  const standards = listDir(techniques).filter((name) => STANDARD_PAGE.test(name));
  const citedBy = new Map(); // page name -> files that name it
  for (const file of citingFiles(root)) {
    for (const name of new Set(readText(join(root, ...file.split('/'))).match(STANDARD_CITATION) ?? [])) {
      citedBy.set(name, [...(citedBy.get(name) ?? []), file]);
    }
  }
  for (const name of standards) {
    if (!citedBy.has(name)) problems.push(`${LAYOUT.techniques}/${name} is named by no ${CONTRACT_FILE}, CONVENTIONS.md, skill, or agent`);
  }
  for (const [name, files] of citedBy) {
    if (!standards.includes(name)) problems.push(`${files[0]} names ${name}, which is not a page in ${LAYOUT.techniques}`);
  }
  return problems.sort();
}

function main(argv) {
  const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (argv.length && !(argv.length === 2 && argv[0] === '--root' && argv[1])) {
    console.error('usage: node scripts/check-docs-standards-alignment.mjs [--root <repo-root>]');
    return 2;
  }
  const problems = checkDocsStandards(argv.length ? resolve(argv[1]) : defaultRoot);
  if (problems.length) {
    for (const problem of problems) console.error(`docs-standards-alignment: ${problem}`);
    return 1;
  }
  console.log('docs-standards-alignment: every standard is named and every named standard exists');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
