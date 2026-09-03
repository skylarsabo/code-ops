#!/usr/bin/env node
// Repo map generator for orchestrated runs.
// WHY: operatives waste turns re-deriving layout and definitions by search. This
// walks the tree ONCE (git ls-files, so .gitignore is respected) and emits a compact
// definition map that every operative brief hands over; search is then used to go
// deeper than the map, not to re-orient. Truncation is always announced, never
// silent. Generation failure is advisory to a run, never blocking.
//   node scripts/repo-map.mjs [--root <dir>] [--out <file>] [--max-file-kb <N>]
// Exit 0 = map written; 1 = bad invocation, unwritable --out, or not a git work tree.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, extname } from 'node:path';
import { CODE } from './symbol-lib.mjs';

const argv = process.argv.slice(2);
let root = '.', out = null, maxKb = 512;
for (let i = 0; i < argv.length; i++) {
  const need = (f) => {
    const v = argv[++i];
    if (v === undefined || v.trim() === '' || v.startsWith('--')) { console.error(`  x ${f} needs a value`); process.exit(1); }
    return v;
  };
  if (argv[i] === '--root') root = need('--root');
  else if (argv[i] === '--out') out = need('--out');
  else if (argv[i] === '--max-file-kb') {
    maxKb = Number(need('--max-file-kb'));
    if (!Number.isFinite(maxKb) || maxKb < 0) { console.error('  x --max-file-kb needs a non-negative number'); process.exit(1); }
  }
  else { console.error(`  x unknown flag: ${argv[i]}`); process.exit(1); }
}
root = resolve(root);
out = out ? resolve(out) : join(root, 'REPO_MAP.md');

const MAX_DEFS_PER_FILE = 40;
// The code definition rules come from symbol-lib.mjs, so the map, the graph, the outline, and
// the index all call the same line a definition. A Markdown heading is a landmark rather than a
// definition, so it stays here: the map is the only reader that wants one.
const MD_RULES = [[/^(#{1,2})\s+(.+)/, 'h']];
const rulesFor = (ext) => (ext === '.md' ? MD_RULES : CODE[ext]?.defs);

let files;
try {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: root, timeout: 10000, maxBuffer: 64 * 1024 * 1024 })
    .toString().split('\0').filter(Boolean);
} catch {
  console.error('  x not a git work tree (repo-map requires git ls-files)');
  process.exit(1);
}

const lines = [];
let scanned = 0, skippedBig = 0, skippedBin = 0, unreadable = 0;
try {
  const sha = execFileSync('git', ['log', '-1', '--format=%H'], { cwd: root, timeout: 10000 }).toString().trim();
  lines.push(`# REPO_MAP — generated at ${sha}`, '');
} catch {
  lines.push('# REPO_MAP — generated (no HEAD sha available)', '');
}
for (const f of files.sort()) {
  let buf;
  try { buf = readFileSync(join(root, f)); } catch { lines.push(`${f} (unreadable)`); unreadable++; continue; }
  if (buf.length > maxKb * 1024) { lines.push(`${f} (skipped: >${maxKb} KB)`); skippedBig++; continue; }
  if (buf.subarray(0, 8000).includes(0)) { lines.push(`${f} (binary)`); skippedBin++; continue; }
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const fileLines = text.split('\n');
  const rules = rulesFor(extname(f).toLowerCase());
  lines.push(`${f} (${fileLines.length} lines)`);
  scanned++;
  if (!rules) continue;
  const defs = [];
  for (let n = 0; n < fileLines.length; n++) {
    for (const [re, kind] of rules) {
      const m = re.exec(fileLines[n]);
      if (m) { defs.push(`  ${n + 1}: ${kind === 'h' ? m[1] : kind} ${m[2] ?? m[1]}`); break; }
    }
  }
  lines.push(...defs.slice(0, MAX_DEFS_PER_FILE));
  if (defs.length > MAX_DEFS_PER_FILE) lines.push(`  (+${defs.length - MAX_DEFS_PER_FILE} more truncated)`);
}
lines.push('', `— ${files.length} files: ${scanned} scanned, ${skippedBig} skipped (size), ${skippedBin} binary, ${unreadable} unreadable.`);
try { writeFileSync(out, lines.join('\n') + '\n'); } catch (e) {
  console.error(`  x cannot write ${out}: ${e.message}`);
  process.exit(1);
}
console.log(`repo map written: ${out} (${files.length} files)`);
