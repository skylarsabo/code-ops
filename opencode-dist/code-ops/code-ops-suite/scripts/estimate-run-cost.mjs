#!/usr/bin/env node
// Pre-run cost ESTIMATOR for the code-ops suite — the forward-looking half of the cost
// machinery whose backward-looking half is /code-ops-suite:run-cost-audit.
//
//   node scripts/estimate-run-cost.mjs --runs <dir> [--skill <name>] [--model <id>]
//                                      [--root <repo> --prices <snapshot.json>]
//                                      [--repo-size <mb>] [--json <path>]
//
// WHY: code-ops-docs/40 Engineering/Handbook/09-cost-and-scoping.md says cost is a control you hold, set at Phase 0 —
// but every mechanical reading the suite produced arrived AFTER the run, when the budget was
// already spent. calibration-metrics.mjs and run-cost-audit measure a finished run; nothing
// answered "how many dispatches is this shape of run likely to take?" before it started. This
// script answers that from the only honest source available: the DISPATCH_LEDGER.md files of
// prior runs, read with the same grammar their writer used (code-ops-docs/40 Engineering/Techniques/artifact-grammars.md
// grammar (a)).
//
// PRICE DISCIPLINE: no built-in prices. With --root and --prices, the script joins finalized
// runtime receipts to an operator-supplied dated price snapshot. Without both, it reports only
// the dispatch range, model-class mix, and any observed token usage.
//
// n < 3 is a GUESS, and says so: a range drawn from one or two prior runs is a sample, not a
// distribution. The caveat block is printed loudly rather than folded into a footnote, because
// the failure this exists to prevent is a lead reading "median 7" off two runs as a plan.
//
// Exit: 0 always for a readable request — including an absent or empty --runs dir, which prints
// "no prior runs, no estimate" and returns 0. An estimator that fails a run because it has no
// history would make adopting it a risk; it is advisory by construction. 2 on a usage error.

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, basename, relative, isAbsolute } from 'node:path';
import { modelClassOf, MODEL_CLASS_ORDER } from './model-tiers.mjs';
import { LEDGER_ROW_RE, LEDGER_STATUSES } from './ledger-grammar.mjs';
import { replayRuntimeReceipts } from './runtime-lib.mjs';
import { sha256 } from './context-index-lib.mjs';

// Grammar (a) comes from scripts/ledger-grammar.mjs, shared with the writer
// (dispatch-ledger.mjs) and the post-run scorer (calibration-metrics.mjs).
const LEDGER_NAME = 'DISPATCH_LEDGER.md';
const MAX_DEPTH = 3;
const MIN_COMPARABLE = 3;

function usage(message) {
  if (message) console.error(`x ${message}`);
  console.error('usage: estimate-run-cost.mjs --runs <dir> [--skill <name>] [--model <id>] [--root <repo> --prices <snapshot.json>] [--repo-size <mb>] [--json <path>]');
  process.exit(2);
}

const KNOWN = new Set(['--runs', '--skill', '--model', '--root', '--prices', '--repo-size', '--json']);
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
if ('--prices' in flags && !('--root' in flags)) usage('--prices requires --root so runtime receipt paths are unambiguous');
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
  const models = new Set();
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
    if (stamped) models.add(stamped);
    const cls = stamped ? modelClassOf(stamped) : 'unstamped';
    byClass.set(cls, (byClass.get(cls) ?? 0) + 1);
  }
  const folder = resolve(ledgerPath, '..');
  const contractPath = join(folder, 'RUN_CONTRACT.json');
  const resultPath = join(folder, 'RUN_CONTRACT_RESULT.json');
  const contractBacked = existsSync(contractPath);
  let contract = null;
  let contractSha256 = null;
  let finalized = !contractBacked;
  if (contractBacked && existsSync(resultPath)) {
    try {
      const contractBytes = readFileSync(contractPath);
      contract = JSON.parse(contractBytes);
      contractSha256 = sha256(contractBytes);
      const result = JSON.parse(readFileSync(resultPath, 'utf8'));
      finalized = result.status === 'PASS'
        && result.version === 1
        && typeof contract.runId === 'string'
        && result.runId === contract.runId
        && result.revision === contract.revision
        && typeof contract.head === 'string'
        && result.head === contract.head;
    } catch {
      finalized = false;
    }
  }
  if (contractBacked && contract === null) {
    try { const contractBytes = readFileSync(contractPath); contract = JSON.parse(contractBytes); contractSha256 = sha256(contractBytes); } catch { /* lifecycle caveat handles it */ }
  }
  return { folder, label: basename(folder), dispatches, malformed, byClass, models, contract, contractSha256, contractBacked, finalized };
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
let skillFilterFellBack = false;
let modelFilterEmpty = false;
if (allRuns.length && '--skill' in flags) {
  const matched = allRuns.filter((r) => matchesSkill(r, flags['--skill']));
  if (matched.length) {
    comparable = matched;
    basis = `${matched.length} prior run(s) whose folder names carry "${flags['--skill']}"`;
  } else {
    skillFilterFellBack = true;
    basis = `all ${allRuns.length} prior run(s) — none carry "${flags['--skill']}" in their folder name`;
  }
}
if (allRuns.length && '--model' in flags) {
  const matched = comparable.filter((run) => run.models.has(flags['--model']));
  if (matched.length) {
    comparable = matched;
    basis += `; ${matched.length} use model "${flags['--model']}"`;
  } else {
    comparable = [];
    modelFilterEmpty = true;
    basis += `; none use model "${flags['--model']}"`;
  }
}

function loadPrices(path) {
  let value;
  try { value = JSON.parse(readFileSync(resolve(path), 'utf8')); }
  catch (error) { usage(`cannot read price snapshot: ${error.message}`); }
  if (!value || Array.isArray(value) || value.version !== 1 || typeof value.currency !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.effectiveAt || '') || !value.perMillionTokens
    || Array.isArray(value.perMillionTokens) || typeof value.perMillionTokens !== 'object') usage('price snapshot must be version 1 with currency, effectiveAt, and perMillionTokens');
  for (const [model, rates] of Object.entries(value.perMillionTokens)) {
    if (!model || !rates || Array.isArray(rates) || typeof rates !== 'object'
      || Object.keys(rates).sort().join(',') !== 'cacheRead,cacheWrite,input,output'
      || Object.values(rates).some((rate) => !Number.isFinite(rate) || rate < 0)) usage(`price snapshot has invalid rates for ${model}`);
  }
  return value;
}

function usageForRun(run, root) {
  const receipt = run.contract?.version === 3 && run.contract.runtime?.receipts;
  if (!receipt || typeof receipt !== 'string') return null;
  const rootPath = resolve(root);
  const path = resolve(rootPath, receipt);
  const rel = relative(rootPath, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !existsSync(path)) return null;
  let replayed;
  try { replayed = replayRuntimeReceipts(readFileSync(path, 'utf8')); } catch { return null; }
  const binding = replayed.activeBinding;
  if (!binding || binding.runId !== run.contract.runId || binding.contractRevision !== run.contract.revision
    || binding.head !== run.contract.head || binding.contractSha256 !== run.contractSha256) return null;
  const byModel = new Map();
  for (const event of replayed.events) {
    const observation = event.observation;
    if (!observation || observation.observability !== 'observed' || !observation.model) continue;
    if (!byModel.has(observation.model)) byModel.set(observation.model, { observations: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, unknown: new Set() });
    const usage = byModel.get(observation.model);
    usage.observations++;
    for (const [field, key] of [['inputTokens', 'input'], ['cacheReadInputTokens', 'cacheRead'], ['cacheWriteInputTokens', 'cacheWrite'], ['outputTokens', 'output'], ['reasoningTokens', 'reasoning']]) {
      if (Number.isSafeInteger(observation[field])) usage[key] += observation[field];
      else usage.unknown.add(key);
    }
  }
  return byModel.size ? byModel : null;
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
  model: flags['--model'] ?? null,
  repoSizeMb: '--repo-size' in flags ? Number(flags['--repo-size']) : null,
  priorRuns: allRuns.length,
  comparableRuns: comparable.length,
  // The count the estimate actually rests on: run folders whose ledger yielded at least one
  // parseable row. `comparableRuns` counts folders, which is not the same number.
  usableRuns: 0,
  emptyLedgerRuns: 0,
  inProgressRuns: 0,
  depthCappedDirs: cappedAt.length,
  skillFilterFellBack,
  modelFilterEmpty,
  estimate: null,
  modelClassMix: null,
  actualUsage: null,
  actualCost: null,
  caveats: [],
};

// A run folder whose ledger yielded no parseable row contributed no evidence. Counting it as a
// run that cost 0 dispatches pulls the min to 0, drags the median down, AND satisfies
// MIN_COMPARABLE with a run that proves nothing — suppressing the guess caveat exactly when it
// is most needed. `dispatch-ledger.mjs phase` produces such a ledger for any run that opened a
// phase and died before its first dispatch, so this is an ordinary artifact, not a corner case.
// Zero-row runs are excluded from the basis and reported by name instead.
const inProgress = comparable.filter((r) => r.contractBacked && !r.finalized);
const usable = comparable.filter((r) => r.finalized && r.dispatches > 0);
const emptyLedgers = comparable.filter((r) => r.finalized && r.dispatches === 0);
machine.usableRuns = usable.length;
machine.emptyLedgerRuns = emptyLedgers.length;
machine.inProgressRuns = inProgress.length;

if (comparable.length && !usable.length) {
  p(`  basis: ${basis}`);
  p(inProgress.length === comparable.length
    ? '  no estimate — every comparable contract-backed run is still in progress.'
    : '  no estimate — every comparable ledger parsed to zero dispatch rows.');
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

if (usable.length && '--root' in flags) {
  const aggregate = new Map();
  let runsWithUsage = 0;
  for (const run of usable) {
    const byModel = usageForRun(run, flags['--root']);
    if (!byModel) continue;
    runsWithUsage++;
    for (const [model, usage] of byModel) {
      if (!aggregate.has(model)) aggregate.set(model, { observations: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0, unknown: new Set() });
      const total = aggregate.get(model);
      total.observations += usage.observations;
      for (const key of ['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning']) total[key] += usage[key];
      for (const key of usage.unknown) total.unknown.add(key);
    }
  }
  const modelUsage = Object.fromEntries([...aggregate].sort(([left], [right]) => left.localeCompare(right)).map(([model, usage]) => [model, {
    observations: usage.observations,
    ...Object.fromEntries(['input', 'cacheRead', 'cacheWrite', 'output', 'reasoning'].map((key) => [key, usage.unknown.has(key) ? 'UNKNOWN' : usage[key]])),
  }]));
  machine.actualUsage = { runsWithUsage, comparableRuns: usable.length, models: modelUsage };
  p();
  p(`  observed token usage: ${runsWithUsage}/${usable.length} comparable run(s) carry attributable runtime receipts`);
  for (const [model, usage] of Object.entries(modelUsage)) {
    p(`    ${model}: input ${usage.input}, cache-read ${usage.cacheRead}, cache-write ${usage.cacheWrite}, output ${usage.output}, reasoning-subset ${usage.reasoning}`);
  }
  if (runsWithUsage < usable.length) {
    machine.caveats.push(`${usable.length - runsWithUsage} comparable run(s) have no attributable runtime usage`);
  }
  if ('--prices' in flags) {
    const prices = loadPrices(flags['--prices']);
    const byModel = {};
    let total = 0;
    let complete = runsWithUsage === usable.length && usable.length > 0;
    for (const [model, usage] of Object.entries(modelUsage)) {
      const rates = prices.perMillionTokens[model];
      const keys = ['input', 'cacheRead', 'cacheWrite', 'output'];
      if (!rates || keys.some((key) => !Number.isFinite(usage[key]))) {
        byModel[model] = 'UNKNOWN'; complete = false; continue;
      }
      const cost = keys.reduce((sum, key) => sum + usage[key] * rates[key] / 1_000_000, 0);
      byModel[model] = Number(cost.toFixed(6)); total += cost;
    }
    machine.actualCost = {
      currency: prices.currency,
      effectiveAt: prices.effectiveAt,
      scope: 'attributed-runtime-observations-only',
      comparableRunCoverageComplete: runsWithUsage === usable.length && usable.length > 0,
      byModel,
      attributedObservedSubtotal: !runsWithUsage ? null : complete ? Number(total.toFixed(6)) : 'UNKNOWN',
    };
    p(`  attributed observed cost at operator snapshot ${prices.effectiveAt} (${prices.currency}): ${machine.actualCost.attributedObservedSubtotal}`);
    for (const [model, cost] of Object.entries(byModel)) p(`    ${model}: ${cost}`);
    p('  this subtotal covers attributed runtime observations, not a provider invoice or proof that every call was observed.');
    p('  reasoning tokens are reported for control only and are already included in output pricing.');
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
    p('     magnitude, and scope the run on the levers in code-ops-docs/40 Engineering/Handbook/09-cost-and-scoping.md');
    p('     rather than on this line.');
  }
  if (emptyLedgers.length) {
    machine.caveats.push(`${emptyLedgers.length} run(s) carry no parseable dispatch rows — excluded from the range`);
    p();
    p(`  !! CAVEAT — ${emptyLedgers.length} run folder(s) carry a ledger with no parseable dispatch rows (an`);
    p('     aborted or not-yet-started run, or rows the grammar cannot read). Excluded from the');
    p('     range rather than counted as 0:');
    for (const r of emptyLedgers) p(`       ${r.label}${r.malformed ? ` (${r.malformed} unparseable row(s))` : ''}`);
  }
  if (inProgress.length) {
    machine.caveats.push(`${inProgress.length} contract-backed run(s) have no successful final result — excluded from the range`);
    p();
    p(`  !! CAVEAT — ${inProgress.length} contract-backed run(s) have no successful final result.`);
    p('     They are still running, failed finalization, or carry an unreadable result. Excluded');
    p('     from history so partial work cannot train the next run\'s estimate:');
    for (const r of inProgress) p(`       ${r.label}`);
  }
  if (skillFilterFellBack) {
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
    p('     code-ops-docs/40 Engineering/Techniques/artifact-grammars.md.');
  }
}

if (modelFilterEmpty) {
  machine.caveats.push(`no comparable run used model "${flags['--model']}" — no model-specific estimate is available`);
  p();
  p(`  !! CAVEAT — no comparable prior run used model "${flags['--model']}".`);
  p('     No model-specific range or observed-cost estimate is reported.');
}

// A bounded sweep says what it dropped. Reported outside the comparable block, because the
// case that misleads hardest is the one where the walk found nothing at all.
if (cappedAt.length) {
  machine.caveats.push(`${cappedAt.length} directory(ies) below ${MAX_DEPTH} levels were not searched`);
  p();
  const one = cappedAt.length === 1;
  p(`  !! CAVEAT — the walk stops at ${MAX_DEPTH} levels below --runs, so ${cappedAt.length} ${one ? 'directory was' : 'directories were'}`);
  p(`     not searched. Any ${LEDGER_NAME} below ${one ? 'it' : 'them'} would be absent from this estimate:`);
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
p('  The forward estimate remains a DISPATCH range and model-class mix. Runtime token and cost');
p('  totals are historical observations only. Price math runs solely from an explicit dated');
p('  operator snapshot, because built-in prices would age into a confident wrong number.');

const text = out.join('\n') + '\n';
process.stdout.write(text);
if ('--json' in flags) {
  try { writeFileSync(resolve(flags['--json']), JSON.stringify(machine, null, 2) + '\n'); }
  catch (e) { console.error(`x cannot write ${flags['--json']}: ${e.message}`); process.exit(2); }
}
process.exit(0);
