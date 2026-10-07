#!/usr/bin/env node
// Redundancy measure (the D-016 method): 12-word shingles over the authored .md files, counting
// the passages of 40 or more words that two or more of those files share. A passage costs
// words * (files - 1) redundant words. The script reads blobs through git, so it measures any
// commit without a checkout, and it is report-only: it never fails a build.
//
// This is not scripts/check-duplication.mjs. That gate uses 40-word runs over a different file
// set and splits pinned from unpinned passages. This script is the baseline reading that
// MEASUREMENTS.md records, so its file set and exclusions stay fixed.
//
// Usage: node scripts/measure-redundancy.mjs [--rev <commit>] [--all] [--json]
//   --rev   the commit to measure (default HEAD)
//   --all   keep the two superseded design documents that the D-016 reading excludes
//   --json  print the full result, passages included, as JSON

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrDie } from './cli-lib.mjs';

const SHINGLE = 12;
const PASSAGE_WORDS = 40;
const USAGE = 'usage: measure-redundancy.mjs [--rev <commit>] [--all] [--json]';

// Derived hosts, the vendored script copies, the eval fixtures, and the reference or
// generated-artifact documents repeat other files by design, so the reading skips them.
const SKIPPED = [
  /^(opencode-dist|codex-marketplace|\.agents|evals)\//,
  /^plugins\/[^/]+\/(reference|scripts)\//,
  /\/Techniques\/artifact/,
  /\/Techniques\/(subagent-trade-offs|vault-standard|calibration-protocol|atlas|fleet-standard)\.md$/,
];
// Superseded by later designs. D-016 leaves them out of the baseline.
const SUPERSEDED = /Docs state and history 2026-09|Handoff fidelity and session coordination 2026-09/;

// Passage classes, first match wins. A class names who owns the repeat.
const CLASSES = [
  ['A conventions-blocks', (f) => /CONVENTIONS\.md$/.test(f)],
  ['B global-contract', (f) => /^global-contracts\//.test(f) || /AGENTS[^/]*\.md$/.test(f)],
  ['C skill-stanza', (f) => /SKILL\.md$/.test(f)],
  ['D changelog', (f) => /CHANGELOG\.md$/.test(f)],
  ['E design-docs', (f) => f.startsWith('code-ops-docs/10 Design/')],
];
const classOf = (files) => (CLASSES.find(([, inClass]) => files.every(inClass)) ?? ['F other'])[0];

export const isMeasured = (path, all = false) =>
  path.endsWith('.md') && !SKIPPED.some((re) => re.test(path)) && (all || !SUPERSEDED.test(path));

const words = (text) => text.replace(/[`*_#>|-]/g, ' ').split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());

// texts: Map of path to file text. Returns every passage, largest redundant cost first.
export function findPassages(texts) {
  const tokens = new Map([...texts].map(([path, text]) => [path, words(text)]));
  const owners = new Map(); // shingle -> Set of paths that carry it
  for (const [path, toks] of tokens) {
    for (let i = 0; i + SHINGLE <= toks.length; i++) {
      const shingle = toks.slice(i, i + SHINGLE).join(' ');
      if (!owners.has(shingle)) owners.set(shingle, new Set());
      owners.get(shingle).add(path);
    }
  }
  // A passage is a run of consecutive shingles that the same set of files shares.
  const found = new Map();
  for (const [path, toks] of tokens) {
    let run = null;
    const close = () => {
      if (!run || run.end - run.start < PASSAGE_WORDS) return;
      const opening = toks.slice(run.start, run.start + 10).join(' ');
      const id = `${run.key}#${opening}`; // the same passage seen from each owner counts once
      if (!found.has(id)) found.set(id, { files: run.files, words: run.end - run.start, opening });
    };
    for (let i = 0; i + SHINGLE <= toks.length; i++) {
      const sharers = owners.get(toks.slice(i, i + SHINGLE).join(' '));
      const files = sharers.size >= 2 ? [...sharers].sort() : null;
      const key = files && files.join('|');
      if (run && key === run.key) {
        run.end = i + SHINGLE;
        continue;
      }
      close();
      run = files ? { key, files, start: i, end: i + SHINGLE } : null;
    }
    close();
  }
  return [...found.values()]
    .map((p) => ({ ...p, redundant: p.words * (p.files.length - 1) }))
    .sort((a, b) => b.redundant - a.redundant || (a.opening < b.opening ? -1 : 1));
}

export function summarize(passages) {
  const classes = {};
  for (const p of passages) {
    const c = (classes[classOf(p.files)] ??= { passages: 0, redundant: 0 });
    c.passages++;
    c.redundant += p.redundant;
  }
  const redundant = passages.reduce((sum, p) => sum + p.redundant, 0);
  return { passages: passages.length, redundant, classes: Object.fromEntries(Object.entries(classes).sort()) };
}

// The blobs of every measured path at `rev`, read through one git process.
export function readBlobs(rev, { cwd = process.cwd(), all = false } = {}) {
  const run = (args, input) => {
    const r = spawnSync('git', args, { cwd, input, maxBuffer: 1 << 30 });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${String(r.stderr).trim() || 'no output'}`);
    return r.stdout;
  };
  const paths = run(['ls-tree', '-r', '-z', '--name-only', rev]).toString('utf8').split('\0').filter((p) => p && isMeasured(p, all));
  const out = run(['cat-file', '--batch'], paths.map((p) => `${rev}:${p}\n`).join(''));
  const texts = new Map();
  let at = 0;
  for (const path of paths) {
    const eol = out.indexOf(10, at);
    const size = Number(out.toString('utf8', at, eol).split(' ')[2]);
    texts.set(path, out.toString('utf8', eol + 1, eol + 1 + size));
    at = eol + size + 2; // the header line, the blob, and the newline that follows it
  }
  return texts;
}

function main(argv) {
  const { flags } = parseOrDie(argv, { rev: { value: true, default: 'HEAD' }, all: {}, json: {} }, USAGE);
  let texts;
  try {
    texts = readBlobs(flags.rev, { all: flags.all });
  } catch (error) {
    console.error(`measure-redundancy: ${error.message}`);
    return 1;
  }
  const passages = findPassages(texts);
  const summary = summarize(passages);
  if (flags.json) {
    console.log(JSON.stringify({ rev: flags.rev, files: texts.size, ...summary, list: passages }, null, 2));
    return 0;
  }
  console.log(`measure-redundancy: rev ${flags.rev}, ${texts.size} files, ${summary.passages} passages, ${summary.redundant} redundant words`);
  for (const [name, c] of Object.entries(summary.classes)) console.log(`  ${name}: ${c.passages} passages, ${c.redundant} redundant words`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
