#!/usr/bin/env node
// Judgment-eval scorer. Compares a skill's findings against a fixture answer key
// and reports the two axes that matter: RECALL (did it find the planted issues?)
// and FALSE POSITIVES (did it flag the decoys — intentional non-issues?).
//
//   node evals/score.mjs <answer-key.json> <candidate>            # score a skill run
//   node evals/score.mjs <answer-key.json> --check                # verify the key matches the fixture
//
// <candidate> is either a JSON array of {file,line,...} or a Markdown register
// (file:line pairs are extracted). Matching is by path-suffix + line within tolerance.
// Exits non-zero on a FAIL verdict (pass --no-exit to inspect without gating).
// The model-in-the-loop part (running the skill) is manual; this scoring is deterministic.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join, sep } from 'node:path';

const args = process.argv.slice(2);
const keyPath = args[0];
const check = args.includes('--check');
const noExit = args.includes('--no-exit') || args.includes('--report-only');
const tolArg = args.indexOf('--tolerance');
// BUG-009: do not mistake the --tolerance VALUE for the candidate path.
const candidatePath = args.slice(1).find((a, i) => !a.startsWith('--') && i !== tolArg);
if (!keyPath) { console.error('usage: score.mjs <answer-key.json> <candidate>|--check [--tolerance N] [--no-exit]'); process.exit(2); }

const key = JSON.parse(readFileSync(keyPath, 'utf8'));
// BUG-010: a malformed --tolerance must fail loudly, not silently disable matching (NaN).
let tol = key.lineTolerance ?? 3;
if (tolArg >= 0) {
  tol = Number(args[tolArg + 1]);
  if (!Number.isFinite(tol) || tol < 0) { console.error('x --tolerance needs a non-negative number'); process.exit(2); }
}
// SCR-012: validate the RESOLVED tolerance (key-derived or CLI). A typo'd key.lineTolerance
// (e.g. a string or negative) must fail loudly, not silently collapse matching to recall 0.
if (!Number.isFinite(tol) || tol < 0) { console.error('x lineTolerance (answer key or --tolerance) must be a non-negative number'); process.exit(2); }
const keyDir = resolve(dirname(resolve(keyPath)));
const repoRoot = resolve(keyDir, key.repo ?? 'repo');
// SEC-005: the fixture root must stay under the key's own directory.
if (repoRoot !== keyDir && !repoRoot.startsWith(keyDir + sep)) { console.error('x key.repo escapes the key directory'); process.exit(2); }
const planted = key.planted ?? [];
const decoys = key.decoys ?? [];

const confined = (p) => { const f = resolve(repoRoot, p); return (f === repoRoot || f.startsWith(repoRoot + sep)) ? f : null; };

// ---- --check: verify each anchor is still on its cited line (fixture drift guard)
if (check) {
  const problems = [];
  for (const item of [...planted, ...decoys]) {
    const f = confined(item.file);
    if (!f) { problems.push(`${item.id}: ${item.file} escapes the fixture root`); continue; }
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
// EVAL-002: a key with no planted items measures nothing — refuse rather than reporting 100%.
if (!planted.length) { console.error('x answer key defines no planted items — nothing to score'); process.exit(2); }

let cand = [];
if (candidatePath.endsWith('.json')) {
  cand = JSON.parse(readFileSync(candidatePath, 'utf8'));
  // SCR-019: a single object / null candidate must give a clean diagnostic, not an unhandled TypeError.
  if (!Array.isArray(cand)) { console.error('x candidate JSON must be an array of {file,line} objects'); process.exit(2); }
} else {
  // BUG-012: require a known file extension so version strings / host:port are not parsed as refs.
  const re = /\b((?:[\w.-]+\/)*[\w.-]+\.(?:mjs|cjs|js|tsx?|jsx|json|md|markdown|txt|ya?ml|toml|sh|py|rb|go|rs|java|cpp|cc|css|html?)):(\d+)\b/gi;
  for (const m of readFileSync(candidatePath, 'utf8').matchAll(re)) cand.push({ file: m[1], line: Number(m[2]) });
}

// EVAL-008: match on a path SUFFIX (+ basename), not basename alone, so a wrong-directory
// citation does not earn recall credit and same-basename files in different dirs don't collide.
function pathMatch(a, b) {
  const na = String(a).replace(/\\/g, '/').replace(/^\.?\//, '');
  const nb = String(b).replace(/\\/g, '/').replace(/^\.?\//, '');
  if (basename(na) !== basename(nb)) return false;
  return na === nb || na.endsWith('/' + nb) || nb.endsWith('/' + na);
}
const nearest = (c, items) => {
  let best = null, bestD = Infinity;
  for (const it of items) { if (!pathMatch(c.file, it.file)) continue; const d = Math.abs(c.line - it.line); if (d <= tol && d < bestD) { bestD = d; best = it; } }
  return { best, bestD };
};

// EVAL-009: count decoy false-positives INDEPENDENTLY. A candidate equidistant between a
// real bug and a look-alike decoy is scored as the decoy (fail-safe for precision), so an
// ambiguous flag can never inflate recall while hiding the decoy hit.
const hitPlanted = new Set();
const flaggedDecoyIds = new Set();
const unkeyed = [];
for (const c of cand) {
  const p = nearest(c, planted);
  const d = nearest(c, decoys);
  if (p.best && d.best) { if (p.bestD < d.bestD) hitPlanted.add(p.best.id); else flaggedDecoyIds.add(d.best.id); }
  else if (p.best) hitPlanted.add(p.best.id);
  else if (d.best) flaggedDecoyIds.add(d.best.id);
  else unkeyed.push(c);
}
const found = planted.filter((p) => hitPlanted.has(p.id));
const missed = planted.filter((p) => !hitPlanted.has(p.id));
const flaggedDecoys = decoys.filter((d) => flaggedDecoyIds.has(d.id));
const recall = found.length / planted.length;

console.log(`# ${basename(keyPath)} — scored against ${basename(candidatePath)} (±${tol} lines)`);
console.log(`Recall:          ${found.length}/${planted.length} planted found (${Math.round(recall * 100)}%)`);
if (missed.length) console.log(`  missed:        ${missed.map((m) => m.id).join(', ')}`);
console.log(`False positives: ${flaggedDecoys.length}/${decoys.length} decoys flagged${flaggedDecoys.length ? ' — ' + flaggedDecoys.map((d) => d.id).join(', ') : ''}`);
console.log(`Unkeyed flags:   ${unkeyed.length} (not planted, not a decoy — real extra finds or noise; review by hand)`);

const tRecall = key.thresholds?.recall ?? 0.7;
const tMaxDecoys = key.thresholds?.maxDecoys ?? 0;
const pass = recall >= tRecall && flaggedDecoys.length <= tMaxDecoys;
console.log(`Verdict:         ${pass ? 'PASS' : 'FAIL'} (need recall >= ${Math.round(tRecall * 100)}% and <= ${tMaxDecoys} decoys flagged)`);
if (!pass && !noExit) process.exit(1);
