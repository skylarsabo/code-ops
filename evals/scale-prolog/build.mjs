#!/usr/bin/env node
// Derives the scale-prolog judgment fixture from the bench target and its bug-hunt and
// codebase-audit seeds.
//
//   node evals/scale-prolog/build.mjs           write repo/, ANSWER_KEY.json, and ANSWER_KEY.md
//   node evals/scale-prolog/build.mjs --check   exit 1 when a tracked file differs from the derivation
//
// repo/ is the bench sandbox for one task that plants every seed of both families except DROPPED,
// without its .git directory. The comparison is byte-exact; .gitattributes checks text out with LF
// on every host, so the derivation and the tracked bytes agree on Windows and Linux.

import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_SEED_GAP } from '../bench/bench.mjs';
import { deriveKey, materialize } from '../bench/lib/sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TARGET = join(HERE, '..', 'bench', 'targets', 'tau-prolog');
const SEED_FILES = ['bug-hunt.json', 'codebase-audit.json'];
const REPO = 'repo';
const KEY_JSON = 'ANSWER_KEY.json';
const KEY_MD = 'ANSWER_KEY.md';
// A headroom fixture, harder than scale-parquet, so its recall bar matches that fixture's 0.5
// rather than the scorer default of 0.7. The decoy bar stays at the default of none.
const THRESHOLDS = { recall: 0.5, maxDecoys: 0 };

// Seeds that cannot share the tree with the rest, and why. Every other seed of both families is
// planted. The two families were written apart, so some pairs edit the same site.
const DROPPED = {
  'ca-arg-last': 'it edits the same site as bh-arg-last',
  'ca-answers-await': 'it edits the same site as bh-promise-answers-await',
  'ca-random-between-top': 'it edits the same site as bh-random-between-upper',
  'ca-succ-positive': 'it edits the same site as bh-succ-zero',
  'bh-random-int-rounding': `it sits within ${MIN_SEED_GAP} lines of ca-random-float-bound`,
  'bh-functor-zero-arity': `it sits within ${MIN_SEED_GAP} lines of bh-functor-arity-sign`,
  'ca-abolish-zero-arity': `it sits within ${MIN_SEED_GAP} lines of bh-abolish-arity-limit`,
  'ca-compare-equal-order': 'it edits the same site as ca-compare-order-domain',
  'ca-compare-order-domain': `it sits within ${MIN_SEED_GAP} lines of bh-compare-args-swapped`,
  'bh-subatom-sum-guard': 'it edits the same site as ca-sub-atom-total',
  'ca-sub-atom-total': `it sits within ${MIN_SEED_GAP} lines of ca-sub-atom-length`,
  'bh-list-to-set-compare': `it sits within ${MIN_SEED_GAP} lines of ca-list-to-set-rescan`,
  'ca-list-to-set-countdown': `it sits within ${MIN_SEED_GAP} lines of ca-list-to-set-rescan`,
  'ca-reverse-source': `it sits within ${MIN_SEED_GAP} lines of ca-reverse-bad-tail`,
  'ca-consult-rejects': `it sits within ${MIN_SEED_GAP} lines of ca-consult-options`,
  'ca-get-prop-inherited': `it sits within ${MIN_SEED_GAP} lines of ca-get-prop-defined`,
  'ca-set-seed-value': 'it makes the ca-random-member-index decoy oracle fail',
  'ca-mulberry-divisor': 'its decoy oracle fails under bh-random-float-flag',
  'ca-await-suspend': 'it makes the ca-future-all-count decoy oracle fail',
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
  const seeds = SEED_FILES.flatMap((f) => JSON.parse(readFileSync(join(TARGET, 'ANSWER_KEY.seeds', f), 'utf8')));
  const byId = new Map(seeds.map((s) => [s.id, s]));
  if (byId.size !== seeds.length) throw new Error('a seed id appears in both seed files');
  const missing = Object.keys(DROPPED).filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`dropped seeds not in the seed files: ${missing.join(', ')}`);
  const task = { id: 'scale-prolog', skill: 'rigor:bug-hunt', seeds: seeds.map((s) => s.id).filter((id) => !(id in DROPPED)) };
  const { entries, lineTolerance } = deriveKey({ task, seeds, changes: [], targetDir: TARGET, canary: null });
  for (const a of entries) {
    for (const b of entries) {
      if (a.id < b.id && a.file === b.file && Math.abs(a.line - b.line) < MIN_SEED_GAP) throw new Error(`${a.id} and ${b.id} are closer than ${MIN_SEED_GAP} lines in ${a.file}`);
    }
  }
  const files = new Map();
  const dest = mkdtempSync(join(tmpdir(), 'scale-prolog-'));
  try {
    materialize({ task, seeds, changes: [], targetDir: TARGET, dest });
    for (const [rel, bytes] of walk(dest)) if (!rel.startsWith('.git/')) files.set(`${REPO}/${rel}`, bytes);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
  const item = (e) => ({ id: e.id, file: e.file, line: e.line, anchor: e.anchor, category: e.class, oracle: e.oracle });
  const planted = entries.filter((e) => e.kind === 'defect').map((e) => ({ ...item(e), desc: change(byId.get(e.id)) }));
  const decoys = entries.filter((e) => e.kind === 'decoy').map((e) => ({ ...item(e), why: `an equivalent rewrite that keeps its oracle green: ${change(byId.get(e.id))}` }));
  const key = { fixture: 'scale-prolog', repo: REPO, lineTolerance, thresholds: THRESHOLDS, planted, decoys };
  files.set(KEY_JSON, Buffer.from(`${JSON.stringify(key, null, 2)}\n`));
  files.set(KEY_MD, Buffer.from(answerKeyMd(key)));
  return files;
}

function answerKeyMd(key) {
  const cell = (s) => s.replace(/\|/g, '\\|');
  const row = (x, text) => `| ${x.id} | \`${x.file}:${x.line}\` | ${x.category} | ${cell(text)} |`;
  return [
    '# scale-prolog: answer key',
    '',
    `A Prolog interpreter (\`repo/\`, about 12,100 source lines, one file of about 9,100) with **${key.planted.length} planted defects** and **${key.decoys.length} decoys**, derived by \`build.mjs\` from the bench target and its bug-hunt and codebase-audit seeds. Each defect fails a hidden oracle; each decoy is an equivalent rewrite whose oracle passes. Do not hand-edit: run \`node evals/scale-prolog/build.mjs\`.`,
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
    console.error('FAIL: scale-prolog drifted from its derivation; run node evals/scale-prolog/build.mjs');
    for (const p of problems) console.error(`  x ${p}`);
    process.exit(1);
  }
  console.log(`OK: scale-prolog matches its derivation (${want.size} files)`);
}

main();
