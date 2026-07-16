#!/usr/bin/env node
// Doc line-citation gate for the suite handbook.
//
// WHY: handbook/techniques/guides/adr prose cites code and other docs as
// `path:N` / `path:N-M` load-bearing evidence (e.g. the finding schema
// citation in docs/techniques/reading-a-findings-register.md). Code and docs
// move; a citation's line number does not move with them, so it silently
// drifts onto the wrong text. `revalidate-register.mjs` guards this for
// register findings; nothing previously guarded it for the handbook's own
// doc prose. This closes that gap for the docs this repo tracks directly.
//
//   node scripts/check-doc-citations.mjs
//
// Scope: every tracked `.md` file under docs/handbook, docs/techniques,
// docs/guides, docs/adr (enumerated via `git ls-files -z`, so a gitignored
// scratch doc is never scanned).
//
// A citation is `path:N` or `path:N-M`, where `path` contains at least one
// `/` and ends in one of mjs|js|md|yml|yaml|json (the suite's own source/doc
// extensions), delimited on both sides by whitespace, a backtick, a paren,
// a quote, or a bracket — so prose like "line 29" or a clock/version string
// is never matched. For each citation: the cited path must exist in the repo
// (relative to root, and stay inside it) and N (and M, when a range, with
// M >= N) must be <= that file's current line count.
//
// Fenced ``` code blocks are skipped. Tested against the real corpus before
// adding this: docs/techniques/reading-a-findings-register.md ships a
// synthetic, explicitly-fictional example register entry inside a fence
// (`src/api/orders.ts:88` and friends) that cites paths which do not exist
// anywhere in this repo by design — without the fence skip this script would
// flag fabricated illustrative paths as broken citations.
//
// Violations print `x <doc>:<docline> cites <path>:<N[-M]> — <reason>`.
//
// Exit: 0 = every citation resolves; 1 = >=1 violation; 2 = bad invocation
// (an unknown or blank flag — this script takes none — or not a git work tree).

import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['docs/handbook', 'docs/techniques', 'docs/guides', 'docs/adr'];

const argv = process.argv.slice(2);
if (argv.length) {
  const bad = argv[0];
  console.error(bad.trim() === '' ? 'x blank flag' : `x unknown flag: ${bad}`);
  console.error('usage: check-doc-citations.mjs   (no flags; scans docs/handbook, docs/techniques, docs/guides, docs/adr)');
  process.exit(2);
}

let tracked;
try {
  tracked = execFileSync('git', ['ls-files', '-z', '--', ...SCAN_DIRS], { cwd: ROOT, timeout: 10000, maxBuffer: 64 * 1024 * 1024 })
    .toString().split('\0').filter(Boolean);
} catch {
  console.error('x not a git work tree (check-doc-citations requires git ls-files)');
  process.exit(2);
}
const docs = tracked.filter((f) => f.toLowerCase().endsWith('.md')).sort();

// Delimiter classes chosen to be conservative: a path must be introduced by
// whitespace/backtick/paren/quote/bracket (or line start) and the line
// number(s) must be followed by the same family (or line end/punctuation) —
// this is what keeps prose ("...SKILL.md), "Recurring schedule", line 29")
// from matching while still catching backtick-delimited citations.
const CITE_RE = /(?:^|[\s(`"'[])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:mjs|js|md|yml|yaml|json)):([0-9]+)(?:-([0-9]+))?(?=$|[\s`)\]"'.,;:])/g;

function lineCount(absPath) {
  let text;
  try { text = readFileSync(absPath, 'utf8'); } catch { return -1; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM
  if (text.length === 0) return 0;
  const nl = (text.match(/\n/g) || []).length;
  return text.endsWith('\n') ? nl : nl + 1; // a trailing newline does not add a line
}

// null = resolves cleanly; a string = the violation reason.
function checkCitation(citPath, startLn, endLn) {
  if (startLn < 1) return 'line 0 is not a valid line number';
  if (endLn < startLn) return `range end ${endLn} is before start ${startLn}`;
  const abs = resolve(ROOT, citPath);
  if (!(abs === ROOT || abs.startsWith(ROOT + sep))) return 'path escapes the repo root';
  if (!existsSync(abs)) return 'target file does not exist';
  let stat;
  try { stat = statSync(abs); } catch { return 'target file does not exist'; }
  if (!stat.isFile()) return 'target path is not a file';
  const total = lineCount(abs);
  if (total < 0) return 'target file is unreadable';
  const over = Math.max(startLn, endLn);
  if (over > total) return `line ${over} exceeds target's ${total} line(s)`;
  return null;
}

const violations = [];
for (const rel of docs) {
  let text;
  try { text = readFileSync(resolve(ROOT, rel), 'utf8'); } catch { continue; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s{0,3}```/.test(line)) { inFence = !inFence; continue; } // fence marker itself never cites
    if (inFence) continue;
    for (const m of line.matchAll(CITE_RE)) {
      const citPath = m[1];
      const startRaw = m[2], endRaw = m[3];
      const reason = checkCitation(citPath, Number(startRaw), endRaw !== undefined ? Number(endRaw) : Number(startRaw));
      if (reason) {
        const label = `${citPath}:${startRaw}${endRaw !== undefined ? `-${endRaw}` : ''}`;
        violations.push(`${rel}:${i + 1} cites ${label} — ${reason}`);
      }
    }
  }
}

if (violations.length) {
  for (const v of violations) console.error(`x ${v}`);
  console.error(`\n${violations.length} violation(s) across ${docs.length} doc(s) scanned.`);
  process.exit(1);
}
console.log(`OK — ${docs.length} doc(s) scanned in ${SCAN_DIRS.join(', ')}; every path:line citation resolves.`);
