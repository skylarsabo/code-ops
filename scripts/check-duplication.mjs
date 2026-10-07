#!/usr/bin/env node
// Report-only duplication scan. It counts the words that sit in a DUP_NGRAM-word run (40 words)
// a file shares verbatim with an earlier file, then splits that count into pinned and unpinned.
// A pinned run lies inside a registry passage (scripts/doctrine-passages.mjs) that the repository
// repeats on purpose; an unpinned run is the copy a reader should consider replacing with a
// reference. The script never fails a build: it exits 0 unless a file cannot be read.
//
// Scanned files, in sorted order: every .md under the documentation root except the skipped
// scratch and archive, then each plugin's CONVENTIONS.md. The first file to carry a run owns it;
// each later file that repeats it counts those words as redundant.
//
// Usage: node scripts/check-duplication.mjs [--json] [--top N]

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DUP_NGRAM, SHARED_PASSAGES, normWords } from './doctrine-passages.mjs';
import { DOCS_ROOT, DOCS_SCAN_SKIP, PLUGIN_NAMES, conventionsRel } from './layout-manifest.mjs';

const hashGram = (words, at) => createHash('md5').update(words.slice(at, at + DUP_NGRAM).join(' ')).digest('hex').slice(0, 16);

function walkMarkdown(root, rel, skip, out) {
  const entries = readdirSync(join(root, ...rel.split('/')), { withFileTypes: true });
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (e.name.startsWith('.')) continue;
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) {
      if (!skip.includes(child)) walkMarkdown(root, child, skip, out);
    } else if (e.isFile() && e.name.endsWith('.md')) out.push(child);
  }
}

// Every file the scan reads, repo-relative POSIX paths, docs first then each CONVENTIONS.md.
export function scanFiles(root) {
  const files = [];
  walkMarkdown(root, DOCS_ROOT, DOCS_SCAN_SKIP, files);
  for (const plugin of PLUGIN_NAMES) files.push(conventionsRel(plugin));
  return files;
}

// Hashes of each DUP_NGRAM-word window inside a registry passage long enough to hold one.
function pinnedGrams() {
  const set = new Set();
  for (const { text } of SHARED_PASSAGES) {
    const w = normWords(text);
    for (let i = 0; i + DUP_NGRAM <= w.length; i++) set.add(hashGram(w, i));
  }
  return set;
}

export function scan(root) {
  const pinned = pinnedGrams();
  const owner = new Map();
  const perFile = [];
  let totalWords = 0;
  const files = scanFiles(root);
  for (const rel of files) {
    const words = normWords(readFileSync(join(root, ...rel.split('/')), 'utf8'));
    totalWords += words.length;
    const redundant = new Set();
    const inPinned = new Set();
    for (let i = 0; i + DUP_NGRAM <= words.length; i++) {
      const h = hashGram(words, i);
      const first = owner.get(h);
      if (first === undefined) owner.set(h, rel);
      else if (first !== rel) {
        for (let k = i; k < i + DUP_NGRAM; k++) redundant.add(k);
        if (pinned.has(h)) for (let k = i; k < i + DUP_NGRAM; k++) inPinned.add(k);
      }
    }
    let pinnedWords = 0;
    for (const k of redundant) if (inPinned.has(k)) pinnedWords++;
    if (redundant.size) perFile.push({ file: rel, redundant: redundant.size, pinned: pinnedWords, unpinned: redundant.size - pinnedWords });
  }
  perFile.sort((a, b) => b.unpinned - a.unpinned || b.redundant - a.redundant || (a.file < b.file ? -1 : 1));
  const sum = (key) => perFile.reduce((n, f) => n + f[key], 0);
  return {
    ngram: DUP_NGRAM,
    files: files.length,
    words: totalWords,
    redundant: sum('redundant'),
    pinned: sum('pinned'),
    unpinned: sum('unpinned'),
    perFile,
  };
}

function main(argv) {
  const json = argv.includes('--json');
  const topAt = argv.indexOf('--top');
  const top = topAt >= 0 ? Number.parseInt(argv[topAt + 1], 10) : 10;
  if (topAt >= 0 && !(top >= 0)) {
    process.stderr.write('check-duplication: --top needs a non-negative integer\n');
    return 2;
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = scan(root);
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  const pct = result.words ? ((100 * result.redundant) / result.words).toFixed(1) : '0.0';
  console.log(`check-duplication: ${result.files} files, ${result.words} words, ${result.ngram}-word runs repeated across files`);
  console.log(`redundant words: ${result.redundant} (${pct}%), pinned ${result.pinned}, unpinned ${result.unpinned}`);
  for (const f of result.perFile.slice(0, top)) {
    console.log(`  ${String(f.unpinned).padStart(6)} unpinned  ${String(f.pinned).padStart(6)} pinned  ${f.file}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
