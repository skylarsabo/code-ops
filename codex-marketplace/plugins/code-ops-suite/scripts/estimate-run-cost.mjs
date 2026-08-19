#!/usr/bin/env node
// Pre-run cost ESTIMATOR for the code-ops suite — the forward-looking half of the cost
// machinery whose backward-looking half is /code-ops-suite:run-cost-audit.
//
//   node scripts/estimate-run-cost.mjs --runs <dir> [--skill <name>] [--repo-size <mb>] [--json <path>]
//
// WHY: docs/handbook/09-cost-and-scoping.md says cost is a control you hold, set at Phase 0 —
// but every mechanical reading the suite produced arrived AFTER the run, when the budget was
// already spent. calibration-metrics.mjs and run-cost-audit measure a finished run; nothing
// answered "how many dispatches is this shape of run likely to take?" before it started. This
// script answers that from the only honest source available: the DISPATCH_LEDGER.md files of
// prior runs, read with the same grammar their writer used (docs/techniques/artifact-grammars.md
// grammar (a)).
//
// WHAT IT DOES NOT DO: no token-price math. Per-token prices drift between providers and
// between months, so a dollar figure printed here would age into a confident wrong number. The
// estimate is a DISPATCH COUNT RANGE and a MODEL-CLASS MIX, and it says exactly that. Multiply
// by your own current prices if you want money.
//
// n < 3 is a GUESS, and says so: a range drawn from one or two prior runs is a sample, not a
// distribution. The caveat block is printed loudly rather than folded into a footnote, because
// the failure this exists to prevent is a lead reading "median 7" off two runs as a plan.
//
// Exit: 0 always for a readable request — including an absent or empty --runs dir, which prints
// "no prior runs, no estimate" and returns 0. An estimator that fails a run because it has no
// history would make adopting it a risk; it is advisory by construction. 2 on a usage error.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { modelClassOf, MODEL_CLASS_ORDER } from './model-tiers.mjs';
import { LEDGER_ROW_RE, LEDGER_STATUSES } from './ledger-grammar.mjs';

// Grammar (a) comes from scripts/ledger-grammar.mjs, shared with the writer
// (dispatch-ledger.mjs) and the post-run scorer (calibration-metrics.mjs).
const LEDGER_NAME = 'DISPATCH_LEDGER.md';
const MAX_DEPTH = 3;
const MIN_COMPARABLE = 3;

function usage(message) {
  if (message) console.error(`x ${message}`);
  console.error('usage: estimate-run-cost.mjs --runs <dir> [--skill <name>] [--repo-size <mb>] [--json <path>]');
  process.exit(2);
}

const KNOWN = new Set(['--runs', '--skill', '--repo-size', '--json']);
const flags = {};
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!KNOWN.has(a)) usage(`unknown argument: ${a}`);
    const v = argv[++i];
    if (v === undefined || v.trim() === '' || v.startsWith('--')) usage(`${a} needs a value`);
    flags[a] = v;
  }
}
if (!('--runs' in flags)) usage('--runs <dir> is required');
// Number.isFinite, not just `>= 0`: `Number('Infinity') >= 0` is true, and an accepted
// `Infinity` would be echoed back in the recorded-not-applied note as if it were a size.
{
  const n = Number(flags['--repo-size']);
  if ('--repo-size' in flags && !(Number.isFinite(n) && n >= 0)) usage('--repo-size must be a non-negative number of megabytes');
}

// ---------------------------------------------------------------- collect prior runs

// Walks the runs tree for DISPATCH_LEDGER.md files, bounded by MAX_DEPTH and skipping dot
// directories and node_modules — the same bounded-walk shape calibration-metrics.mjs uses, so a
// vault's `80 Runs/YYYY-MM-DD slug/` and a flat dated-docs tree both resolve without a flag.
//
// The cap is reported, never silent: `cappedAt` collects every directory the walk refused to
// descend into. Without it, a ledger deeper than MAX_DEPTH produced the confident wrong
// sentence "no DISPATCH_LEDGER.md found under this tree" about a tree that has one.
const cappedAt = [];
function findLedgers(dir, depth = 0) {
  const found = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return found; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (depth < MAX_DEPTH) found.push(...findLedgers(full, depth + 1));
      else cappedAt.push(full);
    } else if (e.isFile() && e.name === LEDGER_NAME) {
      found.push(full);
    }
  }
  return found;
}

// One prior run's readable facts. `dispatches` counts parseable rows only; an unparseable row is
// counted separately and reported, because a run whose ledger half-parsed would otherwise lower
// the range with a number that is not its real dispatch count.
function readRun(ledgerPath) {
  let text;
  try { text = readFileSync(ledgerPath, 'utf8'); }
  catch { return null; }
  let dispatches = 0;
  let malformed = 0;
  const byClass = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line.startsWith('|')) continue;
    if (/^\|\s*id\s*\|/i.test(line)) continue;
    if (/^\|(\s*:?-+:?\s*\|)+$/.test(line)) continue;
    const m = LEDGER_ROW_RE.exec(line);
    if (!m) { malformed++; continue; }
    const [, , role, , , status] = m;
    if (!LEDGER_STATUSES.includes(status)) { malformed++; continue; }
    dispatches++;
    const at = role.lastIndexOf('@');
    const stamped = at === -1 ? '' : role.slice(at + 1).trim();
    const cls = stamped ? modelClassOf(stamped) : 'unstamped';
    byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
  }
  const folder = resolve(ledgerPath, '..');
  return { folder, label: basename(folder), dispatches, malformed, byClass };
}

// A run is comparable to a named skill when the skill's name appears in its folder label. Run
// folders are named `YYYY-MM-DD slug` (vault standard), and the slug is what carries the skill.
// Both sides are normalized to lowercase kebab so `run-cost-audit`, `Run Cost Audit`, and
// `run_cost_audit` all match one another.
const kebab = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const matchesSkill = (run, skill) => kebab(run.label).includes(kebab(skill));

const runsDir = resolve(flags['--runs']);
const dirPresent = existsSync(runsDir) && statSync(runsDir).isDirectory();
const allRuns = dirPresent
  ? findLedgers(runsDir).map(readRun).filter(Boolean).sort((a, b) => a.label.localeCompare(b.label))
  : [];

const out = [];
const p = (s = '') => out.push(s);
p(`# estimate-run-cost — ${runsDir}`);
p();

if (!dirPresent) {
  p(`  no prior runs, no estimate — ${runsDir} does not exist or is not a directory.`);
} else if (allRuns.length === 0) {
  p(cappedAt.length
    ? `  no prior runs, no estimate — no ${LEDGER_NAME} found within ${MAX_DEPTH} levels of this tree.`
    : `  no prior runs, no estimate — no ${LEDGER_NAME} found under this tree.`);
}

// ---------------------------------------------------------------- select the comparable set

let comparable = allRuns;
let basis = `all ${allRuns.length} prior run(s)`;
let fellBack = false;
if (allRuns.length && '--skill' in flags) {
  const matched = allRuns.filter((r) => matchesSkill(r, flags['--skill']));
  if (matched.length) {
    comparable = matched;
    basis = `${matched.length} prior run(s) whose folder names carry "${flags['--skill']}"`;
  } else {
    fellBack = true;
    basis = `all ${allRuns.length} prior run(s) — none carry "${flags['--skill']}" in their folder name`;
  }
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { min: s[0], max: s[s.length - 1], median: Number.isInteger(median) ? median : Number(median.toFixed(1)) };
}

const machine = {
  runsDir,
  skill: flags['--skill'] ?? null,
  repoSizeMb: '--repo-size' in flags ? Number(flags['--repo-size']) : null,
  priorRuns: allRuns.length,
  comparableRuns: comparable.length,
  // The count the estimate actually rests on: run folders whose ledger yielded at least one
  // parseable row. `comparableRuns` counts folders, which is not the same number.
  usableRuns: 0,
  emptyLedgerRuns: 0,
  depthCappedDirs: cappedAt.length,
  skillFilterFellBack: fellBack,
  estimate: null,
  modelClassMix: null,
  caveats: [],
};

// A run folder whose ledger yielded no parseable row contributed no evidence. Counting it as a
// run that cost 0 dispatches pulls the min to 0, drags the median down, AND satisfies
// MIN_COMPARABLE with a run that proves nothing — suppressing the guess caveat exactly when it
// is most needed. `dispatch-ledger.mjs phase` produces such a ledger for any run that opened a
// phase and died before its first dispatch, so this is an ordinary artifact, not a corner case.
// Zero-row runs are excluded from the basis and reported by name instead.
const usable = comparable.filter((r) => r.dispatches > 0);
const emptyLedgers = comparable.filter((r) => r.dispatches === 0);
machine.usableRuns = usable.length;
machine.emptyLedgerRuns = emptyLedgers.length;

if (comparable.length && !usable.length) {
  p(`  basis: ${basis}`);
  p('  no estimate — every comparable ledger parsed to zero dispatch rows.');
}

if (usable.length) {
  const st = stats(usable.map((r) => r.dispatches));
  machine.estimate = st;

  const mix = new Map();
  let mixTotal = 0;
  for (const r of usable) {
    for (const [cls, n] of r.byClass) { mix.set(cls, (mix.get(cls) ?? 0) + n); mixTotal += n; }
  }
  const order = [...MODEL_CLASS_ORDER, 'unstamped'].filter((k) => mix.has(k));
  machine.modelClassMix = Object.fromEntries(order.map((k) => [k, mix.get(k)]));

  p(`  basis: ${basis}`);
  p(`  dispatch-count range: min ${st.min}, median ${st.median}, max ${st.max}`);
  p(`  model-class mix (${mixTotal} dispatch(es) across the comparable set):`);
  for (const k of order) {
    const share = mixTotal ? ((mix.get(k) / mixTotal) * 100).toFixed(1) : '0.0';
    p(`    ${k}: ${mix.get(k)} (${share}%)`);
  }
  p();
  p('  comparable runs:');
  for (const r of usable) {
    p(`    ${r.label}: ${r.dispatches} dispatch(es)${r.malformed ? `, ${r.malformed} unparseable row(s)` : ''}`);
  }
}

if (comparable.length) {
  // ---- caveats: every reason this number is weaker than it looks, stated where it is read.
  // The n<3 guard counts runs that yielded rows, not run folders.
  if (usable.length && usable.length < MIN_COMPARABLE) {
    machine.caveats.push(`n=${usable.length} — fewer than ${MIN_COMPARABLE} comparable runs with dispatch rows`);
    p();
    p('  !! CAVEAT — THIS IS A GUESS, NOT AN ESTIMATE');
    p(`     Drawn from ${usable.length} comparable run(s). A range needs at least ${MIN_COMPARABLE}`);
    p('     to be a distribution rather than a sample; below that the min and the max are');
    p('     two observations, and the median is one of them. Read it as an order of');
    p('     magnitude, and scope the run on the levers in docs/handbook/09-cost-and-scoping.md');
    p('     rather than on this line.');
  }
  if (emptyLedgers.length) {
    machine.caveats.push(`${emptyLedgers.length} run(s) recorded no dispatches — excluded from the range`);
    p();
    p(`  !! CAVEAT — ${emptyLedgers.length} run folder(s) carry a ledger with no dispatch rows (an aborted`);
    p('     or not-yet-started run). They are excluded from the range rather than counted as 0:');
    for (const r of emptyLedgers) p(`       ${r.label}${r.malformed ? ` (${r.malformed} unparseable row(s))` : ''}`);
  }
  if (fellBack) {
    machine.caveats.push(`no run folder matched "${flags['--skill']}" — the estimate covers every prior run`);
    p();
    p(`  !! CAVEAT — no prior run folder names "${flags['--skill']}". The range above mixes every`);
    p('     shape of run in the tree, so it is broader than the one you are about to start.');
  }
  const withMalformed = comparable.filter((r) => r.malformed);
  if (withMalformed.length) {
    machine.caveats.push(`${withMalformed.length} comparable run(s) carry unparseable ledger rows`);
    p();
    p(`  !! CAVEAT — ${withMalformed.length} comparable run(s) carry unparseable ledger rows; their`);
    p('     dispatch counts are floors, not counts. Check them against grammar (a) in');
    p('     docs/techniques/artifact-grammars.md.');
  }
}

// A bounded sweep says what it dropped. Reported outside the comparable block, because the
// case that misleads hardest is the one where the walk found nothing at all.
if (cappedAt.length) {
  machine.caveats.push(`${cappedAt.length} directory(ies) below ${MAX_DEPTH} levels were not searched`);
  p();
  const one = cappedAt.length === 1;
  p(`  !! CAVEAT — the walk stops at ${MAX_DEPTH} levels below --runs, so ${cappedAt.length} ${one ? 'directory was' : 'directories were'}`);
  p(`     not searched. A ${LEDGER_NAME} under ${one ? 'it' : 'one of them'} is absent from this estimate:`);
  for (const d of cappedAt.slice(0, 5)) p(`       ${d}`);
  if (cappedAt.length > 5) p(`       ... and ${cappedAt.length - 5} more`);
}

if ('--repo-size' in flags) {
  machine.caveats.push('repo size is recorded, not applied — prior runs carry no size record to scale against');
  p();
  p(`  note: --repo-size ${flags['--repo-size']} MB is recorded and NOT applied. A DISPATCH_LEDGER.md`);
  p('     records no repo size, so there is nothing to regress the range against; scaling by');
  p('     size here would be an invented model. Use it as your own read on where in the range');
  p('     to sit — larger repo, higher in the range.');
}

p();
p('  This estimator counts DISPATCHES and their model-class mix. It does no token-price math:');
p('  per-token prices drift between providers and between months, so a figure printed here');
p('  would age into a confident wrong number. Multiply by your own current prices.');

const text = out.join('\n') + '\n';
process.stdout.write(text);
if ('--json' in flags) {
  try { writeFileSync(resolve(flags['--json']), JSON.stringify(machine, null, 2) + '\n'); }
  catch (e) { console.error(`x cannot write ${flags['--json']}: ${e.message}`); process.exit(2); }
}
process.exit(0);
