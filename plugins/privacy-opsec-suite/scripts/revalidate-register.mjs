#!/usr/bin/env node
// Register freshness checker for the code-ops suite.
//
//   node scripts/revalidate-register.mjs <register.md> [...more] [--root <repo>] [--report-only]
//
// WHY: registers are live backlogs (CONVENTIONS SSOT). The proven field failure is
// a register that re-lists items already fixed in code — stale findings get re-ranked
// and re-shown. This re-greps each item's cited `file:line` against the CURRENT tree
// so a skill (or CI) can drop/re-tier anything that no longer reproduces BEFORE acting
// on it. It is a FLOOR, not a proof: PRESENT means the location still exists, not that
// the original defect is still there — confirm survivors by reading them.
//
// Statuses per item:
//   FRESH    every cited file:line still exists and is in range
//   MOVED    file exists but the cited line is now out of range (code shifted/shrank)
//   GONE     a cited file no longer exists (strong signal the item was resolved/moved)
//   NO-REF   the item cites no file:line (can't be auto-checked — verify by hand)
// Plus an advisory when an item's `Verified-at:` sha != the repo's current HEAD.
//
// Exit: non-zero if any item is MOVED/GONE/NO-REF (needs re-triage), unless --report-only.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, isAbsolute, join } from 'node:path';

const argv = process.argv.slice(2);
const reportOnly = argv.includes('--report-only');
let root = '.';
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') root = argv[++i];
  else if (argv[i] === '--report-only') continue;
  else files.push(argv[i]);
}
if (files.length === 0) {
  console.error('usage: revalidate-register.mjs <register.md> [...] [--root <repo>] [--report-only]');
  process.exit(2);
}
root = resolve(root);

let headSha = null;
try { headSha = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git repo */ }

const ID_RE = /\b([A-Z][A-Z0-9]{1,}-\d{1,6})\b/g;
const REF_RE = /([A-Za-z0-9._][A-Za-z0-9._/-]*\.[A-Za-z0-9]+):(\d+)/g;
const VERIFIED_RE = /Verified-at:\s*([0-9a-f]{7,40}|HEAD)\b/i;

function lineCount(absPath) {
  try { return readFileSync(absPath, 'utf8').split('\n').length; } catch { return -1; }
}

let totalStale = 0;
let totalItems = 0;

for (const file of files) {
  const regPath = isAbsolute(file) ? file : resolve(file);
  if (!existsSync(regPath)) { console.error(`x register not found: ${file}`); totalStale++; continue; }
  const text = readFileSync(regPath, 'utf8');
  const ids = [...text.matchAll(ID_RE)];
  console.log(`\n# ${file}${headSha ? `  (HEAD ${headSha})` : ''}`);
  if (ids.length === 0) { console.log('  (no item IDs found — not a register, or a free-form doc)'); continue; }

  // Merge blocks by ID (an ID may recur; take the union of refs across its occurrences).
  const items = new Map();
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i][1];
    const block = text.slice(ids[i].index, ids[i + 1]?.index ?? text.length);
    const cur = items.get(id) ?? { refs: [], verifiedAt: null };
    for (const m of block.matchAll(REF_RE)) cur.refs.push({ path: m[1], line: Number(m[2]) });
    const v = block.match(VERIFIED_RE);
    if (v && !cur.verifiedAt) cur.verifiedAt = v[1];
    items.set(id, cur);
  }

  for (const [id, item] of items) {
    totalItems++;
    let status = 'FRESH';
    const notes = [];
    if (item.refs.length === 0) {
      status = 'NO-REF';
    } else {
      for (const r of item.refs) {
        const abs = join(root, r.path);
        if (!existsSync(abs) || !statSync(abs).isFile()) { status = 'GONE'; notes.push(`${r.path} missing`); continue; }
        const lc = lineCount(abs);
        if (lc >= 0 && r.line > lc) { if (status !== 'GONE') status = 'MOVED'; notes.push(`${r.path}:${r.line} > ${lc} lines`); }
      }
    }
    if (item.verifiedAt && headSha && item.verifiedAt !== 'HEAD' && item.verifiedAt !== headSha)
      notes.push(`Verified-at ${item.verifiedAt} != HEAD ${headSha} — re-confirm`);
    if (status !== 'FRESH') totalStale++;
    const flag = status === 'FRESH' ? 'ok ' : '!! ';
    console.log(`  ${flag}${status.padEnd(6)} ${id}${notes.length ? '  — ' + notes.join('; ') : ''}`);
  }
}

console.log(`\n${totalItems} item(s), ${totalStale} needing re-triage.`);
if (totalStale > 0 && !reportOnly) {
  console.error('Stale or unverifiable items found — re-confirm against current code before acting on this register.');
  process.exit(1);
}
