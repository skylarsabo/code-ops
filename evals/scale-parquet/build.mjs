#!/usr/bin/env node
// Derives the scale-parquet judgment fixture from the bench target and its bug-hunt seeds.
//
//   node evals/scale-parquet/build.mjs           write repo/, ANSWER_KEY.json, and ANSWER_KEY.md
//   node evals/scale-parquet/build.mjs --check   exit 1 when a tracked file differs from the derivation
//
// repo/ is the bench sandbox for one task that plants every bug-hunt seed except DROPPED, without
// its .git directory. The comparison is byte-exact; .gitattributes checks text out with LF on
// every host, so the derivation and the tracked bytes agree on Windows and Linux.

import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_SEED_GAP } from '../bench/bench.mjs';
import { deriveKey, materialize } from '../bench/lib/sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, '..', 'bench', 'targets', 'hyparquet');
const REPO = 'repo';
const KEY_JSON = 'ANSWER_KEY.json';
const KEY_MD = 'ANSWER_KEY.md';
// A headroom fixture: one strong control run found 15 of 18 defects, so the scorer default recall
// of 0.7 would pass or fail on a two-item swing. The decoy bar stays at the default of none.
const THRESHOLDS = { recall: 0.5, maxDecoys: 0 };

// Seeds that cannot share the tree with the rest, and why. Every other bug-hunt seed is planted.
const DROPPED = {
  'bh-sort-slice-order': 'it makes the bh-query-metadata-alias decoy oracle fail, and it sits 9 lines from bh-query-return-await',
  'bh-scan-offset-fallback': 'its decoy oracle fails under bh-scan-column-await and bh-offset-index-fields',
  'bh-prefetch-slice-edge': 'it makes the bh-read-return-promise decoy oracle fail',
  'bh-bloom-min-size': 'it sits 8 lines from bh-bloom-truncated-silent',
};

const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);
// A Markdown code span; a doubled fence keeps a backtick inside the code literal.
const code = (s) => (s.includes('`') ? `\`\` ${s} \`\`` : `\`${s}\``);

/** A deterministic description of what a seed changed, from its find and replace text. */
function change(seed) {
  const was = lines(seed.find);
  const now = lines(seed.replace);
  const removed = was.filter((l) => !now.includes(l));
  const added = now.filter((l) => !was.includes(l));
  if (!removed.length && !added.length) return `swaps the order of ${was.map(code).join(' and ')}`;
  if (!added.length) return `removes ${removed.map(code).join(' and ')}`;
  return `${removed.map(code).join(' / ')} became ${added.map(code).join(' / ')}`;
}

function walk(dir, rel = '', out = new Map()) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) walk(join(dir, ent.name), r, out);
    else out.set(r, readFileSync(join(dir, ent.name)));
  }
  return out;
}

/** Every derived file, keyed by its path relative to this directory. */
function derive() {
  const seeds = JSON.parse(readFileSync(join(TARGET, 'ANSWER_KEY.seeds', 'bug-hunt.json'), 'utf8'));
  const missing = Object.keys(DROPPED).filter((id) => !seeds.some((s) => s.id === id));
  if (missing.length) throw new Error(`dropped seeds not in the seed file: ${missing.join(', ')}`);
  const byId = new Map(seeds.map((s) => [s.id, s]));
  const task = { id: 'scale-parquet', skill: 'rigor:bug-hunt', seeds: seeds.map((s) => s.id).filter((id) => !(id in DROPPED)) };
  const { entries, lineTolerance } = deriveKey({ task, seeds, changes: [], targetDir: TARGET, canary: null });
  for (const a of entries) {
    for (const b of entries) {
      if (a.id < b.id && a.file === b.file && Math.abs(a.line - b.line) < MIN_SEED_GAP) throw new Error(`${a.id} and ${b.id} are closer than ${MIN_SEED_GAP} lines in ${a.file}`);
    }
  }
  const files = new Map();
  const dest = mkdtempSync(join(tmpdir(), 'scale-parquet-'));
  try {
    materialize({ task, seeds, changes: [], targetDir: TARGET, dest });
    for (const [rel, bytes] of walk(dest)) if (!rel.startsWith('.git/')) files.set(`${REPO}/${rel}`, bytes);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
  const item = (e) => ({ id: e.id, file: e.file, line: e.line, anchor: e.anchor, category: e.class, oracle: e.oracle });
  const planted = entries.filter((e) => e.kind === 'defect').map((e) => ({ ...item(e), desc: change(byId.get(e.id)) }));
  const decoys = entries.filter((e) => e.kind === 'decoy').map((e) => ({ ...item(e), why: `an equivalent rewrite that keeps its oracle green: ${change(byId.get(e.id))}` }));
  const key = { fixture: 'scale-parquet', repo: REPO, lineTolerance, thresholds: THRESHOLDS, planted, decoys };
  files.set(KEY_JSON, Buffer.from(`${JSON.stringify(key, null, 2)}\n`));
  files.set(KEY_MD, Buffer.from(answerKeyMd(key)));
  return files;
}

function answerKeyMd(key) {
  const cell = (s) => s.replace(/\|/g, '\\|');
  const row = (x, text) => `| ${x.id} | \`${x.file}:${x.line}\` | ${x.category} | ${cell(text)} |`;
  return [
    '# scale-parquet: answer key',
    '',
    `A Parquet reader (\`repo/\`, about 6,100 source lines) with **${key.planted.length} planted defects** and **${key.decoys.length} decoys**, derived by \`build.mjs\` from the bench target and its bug-hunt seeds. Each defect fails a hidden oracle; each decoy is an equivalent rewrite whose oracle passes. Do not hand-edit: run \`node evals/scale-parquet/build.mjs\`.`,
    '',
    'Keep this file, `ANSWER_KEY.json`, `build.mjs`, and `evals/bench/` out of any context you give the skill: the bench target is the unseeded source, so a diff against it reveals every seed.',
    '',
    `Pass bar: recall at least ${key.thresholds.recall * 100}% and at most ${key.thresholds.maxDecoys} decoy flagged, matched within ${key.lineTolerance} lines.`,
    '',
    '## Planted defects (should be found)',
    '| ID | Location | Category | What changed |',
    '|----|----------|----------|--------------|',
    ...key.planted.map((p) => row(p, p.desc)),
    '',
    '## Decoys (should NOT be flagged)',
    '| ID | Location | Category | Why it is fine |',
    '|----|----------|----------|----------------|',
    ...key.decoys.map((d) => row(d, d.why)),
    '',
  ].join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const want = derive();
  if (!check) {
    rmSync(join(HERE, REPO), { recursive: true, force: true });
    for (const [rel, bytes] of want) {
      mkdirSync(dirname(join(HERE, rel)), { recursive: true });
      writeFileSync(join(HERE, rel), bytes);
    }
    console.log(`wrote ${want.size} files`);
    return;
  }
  const have = existsSync(join(HERE, REPO)) ? walk(join(HERE, REPO), REPO) : new Map();
  for (const rel of [KEY_JSON, KEY_MD]) if (existsSync(join(HERE, rel))) have.set(rel, readFileSync(join(HERE, rel)));
  const problems = [];
  for (const [rel, bytes] of want) {
    if (!have.has(rel)) problems.push(`missing ${rel}`);
    else if (!have.get(rel).equals(bytes)) problems.push(`differs ${rel}`);
  }
  for (const rel of have.keys()) if (!want.has(rel)) problems.push(`not derived ${rel}`);
  if (problems.length) {
    console.error('FAIL: scale-parquet drifted from its derivation; run node evals/scale-parquet/build.mjs');
    for (const p of problems) console.error(`  x ${p}`);
    process.exit(1);
  }
  console.log(`OK: scale-parquet matches its derivation (${want.size} files)`);
}

main();
