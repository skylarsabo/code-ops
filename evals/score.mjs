#!/usr/bin/env node
// Judgment-eval scorer. Compares a skill's findings against a fixture answer key
// and reports the two axes that matter: RECALL (did it find the planted issues?)
// and FALSE POSITIVES (did it flag the decoys — intentional non-issues?).
//
//   node evals/score.mjs <answer-key.json> <candidate>   # score a skill run
//   node evals/score.mjs <answer-key.json> --check        # verify the key matches the fixture
//
// <candidate> is either a JSON array of {file,line,...} or a Markdown register
// (file:line pairs are extracted). Matching is by basename + line within tolerance.
// The model-in-the-loop part (running the skill) is manual; this scoring is deterministic.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';

const args = process.argv.slice(2);
const keyPath = args[0];
const check = args.includes('--check');
const strict = args.includes('--strict');
const tolArg = args.indexOf('--tolerance');
const candidatePath = args.slice(1).find((a) => !a.startsWith('--'));
if (!keyPath) { console.error('usage: score.mjs <answer-key.json> <candidate>|--check [--tolerance N] [--strict]'); process.exit(2); }

const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const tol = tolArg >= 0 ? Number(args[tolArg + 1]) : (key.lineTolerance ?? 3);
const keyDir = dirname(resolve(keyPath));
const repoRoot = join(keyDir, key.repo ?? 'repo');
const planted = key.planted ?? [];
const decoys = key.decoys ?? [];

// ---- --check: verify each anchor is still on its cited line (fixture drift guard)
if (check) {
  const problems = [];
  for (const item of [...planted, ...decoys]) {
    const f = join(repoRoot, item.file);
    if (!existsSync(f)) { problems.push(`${item.id}: file missing ${item.file}`); continue; }
    const lines = readFileSync(f, 'utf8').split('\n');
    const line = lines[item.line - 1] ?? '';
    if (item.anchor && !line.includes(item.anchor))
      problems.push(`${item.id}: ${item.file}:${item.line} no longer contains anchor '${item.anchor}' (got: ${line.trim().slice(0, 60)})`);
  }
  if (problems.length) { console.error('FAIL — answer key drifted from fixture:'); for (const p of problems) console.error('  x ' + p); process.exit(1); }
  console.log(`OK — answer key matches fixture (${planted.length} planted + ${decoys.length} decoys anchored).`);
  process.exit(0);
}

// ---- score a candidate
if (!candidatePath || !existsSync(candidatePath)) { console.error('candidate file not found: ' + candidatePath); process.exit(2); }
let cand = [];
if (candidatePath.endsWith('.json')) {
  cand = JSON.parse(readFileSync(candidatePath, 'utf8'));
} else {
  const re = /([A-Za-z0-9._][A-Za-z0-9._/-]*\.[A-Za-z0-9]+):(\d+)/g;
  for (const m of readFileSync(candidatePath, 'utf8').matchAll(re)) cand.push({ file: m[1], line: Number(m[2]) });
}
// Assign each candidate to its SINGLE nearest keyed item within tolerance, so one
// finding can never satisfy two different items (independent of fixture spacing).
const keyed = [...planted, ...decoys];
const hitIds = new Set();
const unkeyed = [];
for (const c of cand) {
  let best = null, bestD = Infinity;
  for (const it of keyed) {
    if (basename(c.file) !== basename(it.file)) continue;
    const d = Math.abs(c.line - it.line);
    if (d <= tol && d < bestD) { bestD = d; best = it; }
  }
  if (best) hitIds.add(best.id); else unkeyed.push(c);
}
const found = planted.filter((p) => hitIds.has(p.id));
const missed = planted.filter((p) => !hitIds.has(p.id));
const flaggedDecoys = decoys.filter((d) => hitIds.has(d.id));
const recall = planted.length ? found.length / planted.length : 1;

console.log(`# ${basename(keyPath)} — scored against ${basename(candidatePath)} (±${tol} lines)`);
console.log(`Recall:          ${found.length}/${planted.length} planted found (${Math.round(recall * 100)}%)`);
if (missed.length) console.log(`  missed:        ${missed.map((m) => m.id).join(', ')}`);
console.log(`False positives: ${flaggedDecoys.length}/${decoys.length} decoys flagged${flaggedDecoys.length ? ' — ' + flaggedDecoys.map((d) => d.id).join(', ') : ''}`);
console.log(`Unkeyed flags:   ${unkeyed.length} (not planted, not a decoy — real extra finds or noise; review by hand)`);

const tRecall = key.thresholds?.recall ?? 0.7;
const tMaxDecoys = key.thresholds?.maxDecoys ?? 0;
const pass = recall >= tRecall && flaggedDecoys.length <= tMaxDecoys;
console.log(`Verdict:         ${pass ? 'PASS' : 'FAIL'} (need recall >= ${Math.round(tRecall * 100)}% and <= ${tMaxDecoys} decoys flagged)`);
if (!pass && strict) process.exit(1);
