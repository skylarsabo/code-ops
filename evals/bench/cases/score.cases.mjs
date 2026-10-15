// Cases and mutants for evals/bench/lib/score.mjs. Wired into evals/bench/run.mjs by the lead:
// `await cases(check)` where check(name, ok, detail) is the tally helper.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { countLines } from '../lib/report-run.mjs';
import { planTasks } from '../lib/runner.mjs';
import { bootstrap, f05, matchFindings, renderReport, resolveProof, scoreUnit, summarizeSkill, verdict } from '../lib/score.mjs';

const near = (a, b) => Math.abs(a - b) < 1e-9;
const BH = 'rigor:bug-hunt';
const DR = 'rigor:deep-review';
const DEBUG = 'code-ops-suite:debug';
const SHIP = 'code-ops-suite:ship';

const entry = (id, kind, file, line) => ({ id, kind, class: 'x', file, line, anchor: 'a', oracle: `${id}.test.js` });
const key = (entries, extra = {}) => ({ task: 't1', skill: BH, canary: 'c', lineTolerance: 3, entries, oracles: [], cleanChange: false, ...extra });
const KEY = key([entry('d1', 'defect', 'src/a.js', 10), entry('d2', 'defect', 'src/b.js', 50), entry('x1', 'decoy', 'src/c.js', 30)]);
const at = (file, line, extra = {}) => ({ file, line, anchor: 'a', tier: 'LIKELY', proof: '', summary: 's', ...extra });

let counter = 0;
const unit = (over = {}) => {
  counter += 1;
  return {
    unitId: `u${counter}`, task: 't1', skill: BH, arm: 'skill', rep: 1, exitCode: 0, timedOut: false, capHit: false,
    wallMs: 1000, turns: 5, costUsd: 1, audit: { void: false, triggers: [] }, voidReruns: 0,
    findings: [], verdict: null, summary: null, after: { oracles: {}, visibleFailures: 0, headCommits: 1 }, proofs: [],
    ...over,
  };
};

const matrix = (skill, minDelta) => ({ id: skill, metric: 'm', minDelta, tasks: 1 });
const summarize = (skill, units, keys, over = {}) =>
  summarizeSkill({ skill, matrixSkill: matrix(skill, 0.1), units, keys, srcLines: 1000, iterations: 200, seed: 7, ...over });

const guardOk = { applies: true, skill: 0, control: 0, limit: 0, margin: 0, holds: true };
const hand = (over = {}) => ({
  skill: BH, minDelta: 0.1, effect: 0.3, lo: 0.1, hi: 0.5,
  instrument: { saturated: false, voidShare: 0, tripped: false },
  guards: {
    inflation: { ...guardOk, margin: 0.05 }, decoy: { ...guardOk, margin: 0.5 }, regressions: guardOk,
    falseBlocks: guardOk, unkeyed: guardOk,
  },
  costRatio: 1, wallRatio: 1, ...over,
});
const withGuard = (name, patch) => {
  const s = hand();
  s.guards[name] = { ...s.guards[name], ...patch };
  return s;
};

export async function cases(check) {
  // ---- matching ----
  const hit = (file, line, k = KEY) => matchFindings([at(file, line)], k);
  check('score: exact path and line hits the defect', hit('src/a.js', 10).defects[0] === 'd1');
  check('score: absolute path suffix hits', hit('/tmp/sbx/src/a.js', 10).defects[0] === 'd1');
  check('score: ./ and backslash forms hit', hit('./src/a.js', 10).defects.length === 1 && hit('src\\a.js', 10).defects.length === 1);
  check('score: bare basename hits', hit('a.js', 10).defects.length === 1);
  check('score: different directory is unkeyed', hit('lib/a.js', 10).unkeyed === 1);
  check('score: suffix must sit on a path boundary', hit('xsrc/a.js', 10).unkeyed === 1);
  check('score: different basename is unkeyed', hit('src/ab.js', 10).unkeyed === 1);
  check('score: tolerance 3 hits at +3 and -3', hit('src/a.js', 13).defects.length === 1 && hit('src/a.js', 7).defects.length === 1);
  check('score: tolerance 3 misses at +4 and -4', hit('src/a.js', 14).unkeyed === 1 && hit('src/a.js', 6).unkeyed === 1);
  check('score: the key lineTolerance is honored', hit('src/a.js', 14, key(KEY.entries, { lineTolerance: 4 })).defects.length === 1);
  check('score: a non-numeric line is unkeyed', hit('src/a.js', 'ten').unkeyed === 1 && matchFindings([null], KEY).unkeyed === 1);
  check('score: a decoy hit lands on the decoy', hit('src/c.js', 31).decoys[0] === 'x1');
  const AMB = key([entry('d1', 'defect', 'src/a.js', 20), entry('x1', 'decoy', 'src/a.js', 22)]);
  const amb = hit('src/a.js', 21, AMB);
  check('score: ambiguous match counts as the decoy hit', amb.decoys[0] === 'x1' && amb.defects.length === 0 && amb.perFinding[0].ambiguous);
  check('score: the same line near only the defect is a defect hit', hit('src/a.js', 18, AMB).defects[0] === 'd1');
  const twice = matchFindings([at('src/a.js', 10), at('src/a.js', 11)], KEY);
  check('score: defects are counted once however many findings hit them', twice.defects.length === 1);

  // ---- F0.5 and unit scoring ----
  check('score: f05 is 0 with no hits and never NaN', f05(0, 0, 4) === 0 && f05(0, 3, 0) === 0 && f05(0, 0, 0) === 0);
  check('score: f05 on 3 hits, 1 decoy, 3 misses is 15/22', near(f05(3, 1, 3), 15 / 22));
  check('score: f05 weights precision over recall', f05(2, 0, 2) > f05(2, 2, 0));
  check('score: f05 of a perfect unit is 1', near(f05(2, 0, 0), 1));
  const none = scoreUnit(unit({ findings: [at('src/zzz.js', 1)] }), KEY);
  check('score: a unit with only unkeyed findings scores 0, not NaN', none.primary === 0 && none.unkeyed === 1 && none.fp === 0);
  const one = scoreUnit(unit({ findings: [at('src/a.js', 10)] }), KEY);
  check('score: one of two defects is F0.5 5/6', near(one.primary, 0.625 / 0.75) && one.tp === 1 && one.fn === 1);
  const noisy = scoreUnit(unit({ findings: [at('src/a.js', 10), at('src/q.js', 1), at('src/r.js', 2)] }), KEY);
  check('score: unkeyed findings do not change F0.5', near(noisy.primary, one.primary) && noisy.unkeyed === 2);
  const decoyed = scoreUnit(unit({ findings: [at('src/a.js', 10), at('src/c.js', 30)] }), KEY);
  check('score: a decoy hit lowers F0.5 to 0.5', near(decoyed.primary, 0.5) && decoyed.decoyHits === 1);
  check('score: null findings score as empty', scoreUnit(unit({ findings: null }), KEY).primary === 0);
  check('score: a void unit has no primary metric', scoreUnit(unit({ findings: [at('src/a.js', 10)], audit: { void: true, triggers: [] } }), KEY).primary === null);

  // ---- debug and ship ----
  const DK = key([entry('d1', 'defect', 'src/a.js', 10)], { skill: DEBUG, oracles: ['d1.test.js'] });
  const dbg = (after) => scoreUnit(unit({ skill: DEBUG, after }), DK).primary;
  check('score: debug resolved when the oracle passes and the visible suite is green', dbg({ oracles: { 'd1.test.js': true }, visibleFailures: 0 }) === 1);
  check('score: debug not resolved when the oracle fails', dbg({ oracles: { 'd1.test.js': false }, visibleFailures: 0 }) === 0);
  check('score: debug not resolved on a visible regression', dbg({ oracles: { 'd1.test.js': true }, visibleFailures: 1 }) === 0);
  check('score: debug not resolved when the oracle did not run', dbg({ oracles: {}, visibleFailures: 0 }) === 0 && dbg(null) === 0);
  const SK = key([], { skill: SHIP, oracles: ['a.test.js', 'b.test.js'] });
  const ship = (a, b, vf) => scoreUnit(unit({ skill: SHIP, after: { oracles: { 'a.test.js': a, 'b.test.js': b }, visibleFailures: vf } }), SK).primary;
  check('score: ship accepted when every acceptance oracle passes', ship(true, true, 0) === 1);
  check('score: ship not accepted when one oracle fails', ship(true, false, 0) === 0);
  check('score: ship not accepted on a visible regression', ship(true, true, 2) === 0);
  check('score: regressions are the visible failure count', scoreUnit(unit({ skill: SHIP, after: { oracles: {}, visibleFailures: 3 } }), SK).regressions === 3);

  // ---- deep-review clean task ----
  const CLEAN = key([entry('x1', 'decoy', 'src/c.js', 30)], { skill: DR, cleanChange: true });
  const cleanBlock = scoreUnit(unit({ skill: DR, task: 'clean', verdict: 'block', findings: [at('src/c.js', 30)] }), CLEAN);
  check('score: the clean change has no primary metric', cleanBlock.primary === null && cleanBlock.falseBlock);
  check('score: approve on the clean change is not a false block', !scoreUnit(unit({ skill: DR, verdict: 'approve' }), CLEAN).falseBlock);
  check('score: block on a defective change is not a false block', !scoreUnit(unit({ skill: DR, verdict: 'block', findings: [at('src/a.js', 10)] }), key(KEY.entries, { skill: DR })).falseBlock);
  const drKeys = { t1: key(KEY.entries, { skill: DR }), clean: CLEAN };
  const drUnits = (cleanVerdict) => ['skill', 'control'].flatMap((arm) => [1, 2, 3, 4].flatMap((rep) => [
    unit({ skill: DR, arm, rep, task: 't1', findings: arm === 'skill' ? [at('src/a.js', 10), at('src/b.js', 50)] : [at('src/a.js', 10)] }),
    unit({ skill: DR, arm, rep, task: 'clean', verdict: arm === 'skill' ? cleanVerdict : 'approve', findings: [at('src/c.js', 30)] }),
  ]));
  const drBlock = summarize(DR, drUnits('block'), drKeys);
  const drApprove = summarize(DR, drUnits('approve'), drKeys);
  check('score: the clean task is excluded from the effect', near(drBlock.effect, 1 - 5 / 6) && near(drApprove.effect, drBlock.effect));
  check('score: the clean task does not feed the decoy guard', drBlock.guards.decoy.skill === 0 && drBlock.guards.decoy.holds);
  check('score: false-block guard breaches when the skill blocks the clean change', !drBlock.guards.falseBlocks.holds && drBlock.guards.falseBlocks.skill === 1);
  check('score: false-block guard holds when the skill approves it', drApprove.guards.falseBlocks.holds);

  // ---- guards ----
  const hunt = (skillUnits, controlUnits, over = {}) => summarize(BH, [
    ...skillUnits.map((u, i) => unit({ ...u, arm: 'skill', rep: i + 1 })),
    ...controlUnits.map((u, i) => unit({ ...u, arm: 'control', rep: i + 1 })),
  ], { t1: KEY }, over);
  const withDecoy = { findings: [at('src/c.js', 30)] };
  const quiet = { findings: [] };
  check('score: decoy guard holds at exactly control plus 0.5', hunt([withDecoy, withDecoy, quiet, quiet], [quiet, quiet, quiet, quiet]).guards.decoy.holds);
  check('score: decoy guard breaches above control plus 0.5', !hunt([withDecoy, withDecoy, withDecoy, quiet], [quiet, quiet, quiet, quiet]).guards.decoy.holds);
  const confirmed = (n, badIndexes) => ({
    findings: Array.from({ length: n }, (_, i) => at(`src/n${i}.js`, 1, { tier: 'CONFIRMED' })),
    proofs: Array.from({ length: n }, (_, i) => ({ index: i, resolves: !badIndexes.includes(i) })),
  });
  check('score: inflation guard holds at exactly control plus 0.05', hunt([confirmed(20, [0])], [confirmed(20, [])]).guards.inflation.holds);
  check('score: inflation guard breaches above control plus 0.05', !hunt([confirmed(20, [0, 1])], [confirmed(20, [])]).guards.inflation.holds);
  const decoyConfirmed = { findings: [at('src/c.js', 30, { tier: 'CONFIRMED' })], proofs: [{ index: 0, resolves: true }] };
  check('score: a confirmed decoy hit counts as inflated even with a resolving proof', hunt([decoyConfirmed], [quiet]).guards.inflation.skill === 1);
  check('score: a confirmed finding with no proof entry is inflated', hunt([{ findings: [at('src/n.js', 1, { tier: 'CONFIRMED' })], proofs: [] }], [quiet]).guards.inflation.skill === 1);
  check('score: only CONFIRMED findings enter the inflation rate', hunt([{ findings: [at('src/n.js', 1)] }], [quiet]).guards.inflation.skill === 0);
  const unkeyedN = (n) => ({ findings: Array.from({ length: n }, (_, i) => at(`src/u${i}.js`, 1)) });
  check('score: unkeyed guard holds at exactly 1.5 times control', hunt([unkeyedN(3)], [unkeyedN(2)]).guards.unkeyed.holds);
  const wide = hunt([unkeyedN(3)], [unkeyedN(1)]);
  check('score: unkeyed guard breaches above 1.5 times control', !wide.guards.unkeyed.holds && near(wide.guards.unkeyed.skill, 3));
  check('score: adjudication of at least half true lifts the unkeyed guard', hunt([unkeyedN(3)], [unkeyedN(1)], { adjudicatedTrueShare: 0.5 }).guards.unkeyed.holds
    && !hunt([unkeyedN(3)], [unkeyedN(1)], { adjudicatedTrueShare: 0.4 }).guards.unkeyed.holds);
  check('score: unkeyed rate scales with the computed line count', near(hunt([unkeyedN(3)], [unkeyedN(1)], { srcLines: 3000 }).guards.unkeyed.skill, 1));

  const DEBUG_KEYS = { t1: DK };
  const dunit = (arm, rep, ok, vf = 0) => unit({ skill: DEBUG, arm, rep, after: { oracles: { 'd1.test.js': ok }, visibleFailures: vf } });
  const dbgSummary = (skillVf) => summarize(DEBUG, [
    ...[1, 2, 3, 4].map((r) => dunit('skill', r, true, r === 1 ? skillVf : 0)),
    ...[1, 2, 3, 4].map((r) => dunit('control', r, false)),
  ], DEBUG_KEYS);
  check('score: regression guard breaches when the skill breaks a pristine test', !dbgSummary(1).guards.regressions.holds);
  check('score: regression guard holds when both arms match', dbgSummary(0).guards.regressions.holds);
  check('score: the regression guard applies to debug but not to bug-hunt', dbgSummary(0).guards.regressions.applies && !hunt([quiet], [quiet]).guards.regressions.applies);

  // ---- cost, wall, caps, timeouts ----
  const costly = summarize(DEBUG, [
    dunit('skill', 1, true), dunit('control', 1, false),
  ].map((u, i) => ({ ...u, costUsd: i === 0 ? 5 : 1, wallMs: i === 0 ? 4000 : 1000, capHit: i === 0, timedOut: i === 1 })), DEBUG_KEYS);
  check('score: cost and wall ratios are skill mean over control mean', near(costly.costRatio, 5) && near(costly.wallRatio, 4));
  check('score: cap hits and timeouts are counted per arm', costly.capHits.skill === 1 && costly.capHits.control === 0 && costly.timeouts.control === 1 && costly.timeouts.skill === 0);
  const freeControl = summarize(DEBUG, [dunit('skill', 1, true), { ...dunit('control', 1, false), costUsd: 0 }], DEBUG_KEYS);
  check('score: a zero-cost control makes the cost ratio infinite', freeControl.costRatio === Infinity);

  // ---- voids ----
  const mixed = (voidCount) => summarize(DEBUG, [
    ...[1, 2, 3, 4].map((r) => dunit('skill', r, true)),
    ...[1, 2, 3, 4].map((r, i) => (i < voidCount ? { ...dunit('control', r, true), audit: { void: true, triggers: [] } } : dunit('control', r, false))),
  ], DEBUG_KEYS);
  const v2 = mixed(2);
  check('score: void units are excluded from the metric and the unit count', v2.units.control === 2 && near(v2.effect, 1) && v2.voids.control === 2);
  check('score: a void share of exactly 25% does not trip the instrument rule', !v2.instrument.tripped && near(v2.instrument.voidShare, 0.25));
  const v3 = mixed(3);
  check('score: a void share over 25% trips the instrument rule', v3.instrument.tripped);
  check('score: a tripped instrument rule gives INCONCLUSIVE (instrument)', verdict(v3).verdict === 'INCONCLUSIVE (instrument)');
  const flip = summarize(DEBUG, [
    ...[1, 2].map((r) => dunit('skill', r, true)),
    { ...dunit('skill', 3, false), audit: { void: true, triggers: [] } },
    ...[1, 2].map((r) => dunit('control', r, false)),
  ], DEBUG_KEYS);
  check('score: voiding a failing unit does not lower the skill mean', near(flip.effect, 1));
  const sat = summarize(DEBUG, [
    ...[1, 2, 3, 4].map((r) => dunit('skill', r, true)),
    ...[1, 2, 3, 4].map((r) => dunit('control', r, true)),
  ], DEBUG_KEYS);
  check('score: a control that scores 0.9 or more on every task trips the instrument rule', sat.instrument.saturated && verdict(sat).verdict === 'INCONCLUSIVE (instrument)');

  // ---- bootstrap ----
  const spread = [{ skill: [0.8, 0.9, 1, 0.7], control: [0.1, 0.2, 0, 0.1] }, { skill: [0.6, 0.9, 0.8, 0.7], control: [0.2, 0.1, 0.3, 0.2] }];
  const b1 = bootstrap(spread, { iterations: 300, seed: 11 });
  const b2 = bootstrap(spread, { iterations: 300, seed: 11 });
  check('score: bootstrap is deterministic for a fixed seed', JSON.stringify(b1) === JSON.stringify(b2));
  check('score: a different seed changes the interval', JSON.stringify(bootstrap(spread, { iterations: 300, seed: 12 })) !== JSON.stringify(b1));
  check('score: bootstrap effect is the mean of per-task mean differences', near(b1.effect, ((0.85 - 0.1) + (0.75 - 0.2)) / 2));
  check('score: a clear effect has an interval above 0 around the effect', b1.lo > 0.3 && b1.lo <= b1.effect && b1.hi >= b1.effect && b1.hi < 1);
  const sure = bootstrap([{ skill: [1, 1, 1, 1], control: [0, 0, 0, 0] }], { iterations: 50, seed: 3 });
  check('score: a deterministic effect of 1 has a degenerate interval at 1', sure.effect === 1 && sure.lo === 1 && sure.hi === 1);
  const same = bootstrap([{ skill: [0, 1, 0, 1], control: [0, 1, 0, 1] }], { iterations: 400, seed: 3 });
  check('score: no effect has an interval that includes 0', same.effect === 0 && same.lo < 0 && same.hi > 0);
  check('score: a task missing an arm is dropped, and none left gives null', bootstrap([{ skill: [1], control: [] }], { iterations: 10, seed: 1 }).effect === null
    && near(bootstrap([{ skill: [1], control: [] }, ...spread], { iterations: 10, seed: 1 }).effect, b1.effect));

  // ---- the six verdict branches ----
  const V = (s) => verdict(s).verdict;
  check('verdict 1: saturated control is INCONCLUSIVE (instrument), never KEEP', V(hand({ instrument: { saturated: true, voidShare: 0, tripped: true } })) === 'INCONCLUSIVE (instrument)');
  check('verdict 1: more than 25% void is INCONCLUSIVE (instrument)', V(hand({ instrument: { saturated: false, voidShare: 0.3, tripped: true } })) === 'INCONCLUSIVE (instrument)');
  check('verdict 2: KEEP when everything clears', V(hand()) === 'KEEP');
  check('verdict 2: KEEP at the minimum delta exactly', V(hand({ effect: 0.1, lo: 0.01 })) === 'KEEP');
  check('verdict 2 mutant: effect below the minimum delta is not KEEP', V(hand({ effect: 0.09, lo: 0.01 })) === 'INCONCLUSIVE (power)');
  check('verdict 2 mutant: a lower bound of 0 is not KEEP', V(hand({ lo: 0 })) === 'INCONCLUSIVE (power)');
  check('verdict 2: cost and wall ratios of exactly 4.0 still KEEP', V(hand({ costRatio: 4, wallRatio: 4 })) === 'KEEP');
  check('verdict 3: a cost ratio over 4.0 is FIX (cost or guard)', V(hand({ costRatio: 4.5 })) === 'FIX (cost or guard)');
  check('verdict 3: a wall ratio over 4.0 is FIX (cost or guard)', V(hand({ wallRatio: 4.01 })) === 'FIX (cost or guard)');
  for (const g of ['inflation', 'decoy', 'regressions', 'falseBlocks', 'unkeyed']) {
    check(`verdict 3: a breached ${g} guard is FIX (cost or guard)`, V(withGuard(g, { holds: false })) === 'FIX (cost or guard)');
  }
  check('verdict 3 mutant: a breach on a guard that does not apply is ignored', V(withGuard('falseBlocks', { applies: false, holds: false })) === 'KEEP');
  const valueless = { effect: 0.05, lo: -0.1, hi: 0.2 };
  const vInfl = hand(valueless);
  vInfl.guards.inflation = { ...guardOk, margin: 0.05, skill: 0, control: 0.15 };
  check('verdict 4: interval includes 0 and inflation beats control by twice the bound is FIX (guard value)', V(vInfl) === 'FIX (guard value)');
  const vDecoy = hand(valueless);
  vDecoy.guards.decoy = { ...guardOk, margin: 0.5, skill: 0, control: 1 };
  check('verdict 4: decoy hits beating control by twice the bound is FIX (guard value)', V(vDecoy) === 'FIX (guard value)');
  const vShort = hand(valueless);
  vShort.guards.inflation = { ...guardOk, margin: 0.05, skill: 0, control: 0.09 };
  check('verdict 4 mutant: beating control by less than twice the bound is not FIX (guard value)', V(vShort) === 'INCONCLUSIVE (power)');
  const vPositive = hand();
  vPositive.guards.inflation = { ...guardOk, margin: 0.05, skill: 0, control: 0.5 };
  check('verdict 4 mutant: an interval above 0 never takes the guard-value branch', V(vPositive) === 'KEEP');
  const vRetire = hand({ effect: 0, lo: -0.1, hi: 0.05 });
  check('verdict 5: an upper bound below the minimum delta is RETIRE candidate', V(vRetire) === 'RETIRE candidate');
  check('verdict 5 mutant: an upper bound at the minimum delta is not RETIRE', V(hand({ effect: 0, lo: -0.1, hi: 0.1 })) === 'INCONCLUSIVE (power)');
  const retireValue = hand({ effect: 0, lo: -0.1, hi: 0.05 });
  retireValue.guards.inflation = { ...guardOk, margin: 0.05, skill: 0, control: 0.2 };
  check('verdict 5 mutant: step 4 takes precedence over RETIRE', V(retireValue) === 'FIX (guard value)');
  check('verdict 5: a worse-than-control interval is RETIRE candidate', V(hand({ effect: -0.3, lo: -0.4, hi: -0.1 })) === 'RETIRE candidate');
  check('verdict 6: an interval spanning the minimum delta is INCONCLUSIVE (power)', V(hand({ effect: 0.1, lo: -0.1, hi: 0.3 })) === 'INCONCLUSIVE (power)');
  check('verdict 6: no scored task is INCONCLUSIVE (power)', V(hand({ effect: null, lo: null, hi: null })) === 'INCONCLUSIVE (power)');
  check('verdict: every result carries reasons', ['KEEP', 'FIX', 'RETIRE'].every(() => verdict(hand()).reasons.length > 0) && verdict(vRetire).reasons.length > 0);

  // ---- end to end through summarizeSkill ----
  const e2e = (skillOk) => summarize(DEBUG, [
    ...[1, 2, 3, 4].map((r) => dunit('skill', r, skillOk)),
    ...[1, 2, 3, 4].map((r) => dunit('control', r, false)),
  ], DEBUG_KEYS);
  check('score: a skill that resolves every debug unit against a failing control is KEEP', V(e2e(true)) === 'KEEP');
  check('score: a skill no better than a failing control is not KEEP', V(e2e(false)) !== 'KEEP');

  // ---- report ----
  const rep1 = renderReport({ plan: { id: 'snap-1', seed: 42, models: ['m1', 'm2'], nested: { x: 1 } }, summaries: [e2e(true)] });
  const rep2 = renderReport({ plan: { id: 'snap-1', seed: 42, models: ['m1', 'm2'], nested: { x: 1 } }, summaries: [e2e(true)] });
  check('score: the report is deterministic Markdown with the pre-registration block first', rep1 === rep2 && rep1.indexOf('## Pre-registration') < rep1.indexOf('## Results'));
  check('score: the report carries the plan fields, the skill row, and the verdict', rep1.includes('- id: snap-1') && rep1.includes('- models: m1, m2') && !rep1.includes('nested')
    && rep1.includes(`| ${DEBUG} |`) && rep1.includes('| KEEP |'));
  check('score: the report marks a breached guard', renderReport({ plan: {}, summaries: [dbgSummary(1)] }).includes('BREACH'));

  // ---- proof resolution ----
  const base = mkdtempSync(join(tmpdir(), 'bench-score-'));
  try {
    const sbx = join(base, 'sbx');
    mkdirSync(join(sbx, 'src'), { recursive: true });
    mkdirSync(join(sbx, 'test'), { recursive: true });
    mkdirSync(join(sbx, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(sbx, 'src', 'a.js'), 'export const a = 1;\n');
    writeFileSync(join(sbx, 'test', 'a.test.js'), "test('adds two numbers', () => {});\n");
    writeFileSync(join(sbx, 'node_modules', 'dep', 'dep.test.js'), "test('hidden dependency test', () => {});\n");
    writeFileSync(join(sbx, 'BENCH_FINDINGS.json'), '[]\n');
    writeFileSync(join(base, 'outside.txt'), 'x\n');
    const sha = 'a'.repeat(64);
    writeFileSync(join(sbx, 'RUN_RECEIPTS.md'), [
      '| RCPT-001 | 2026-01-01T00:00:00Z | abc1234 | 0 | ' + sha + ' | node --test |',
      '| RCPT-002 | 2026-01-01T00:00:01Z | abc1234 | 1 | ' + sha + ' | node --test |',
      '| RCPT-003 | 2026-01-01T00:00:02Z | abc1234 | 0 | short | node --test |',
      '',
    ].join('\r\n'));
    const bare = join(base, 'bare');
    mkdirSync(bare);
    const r = (proof, dir = sbx) => resolveProof(proof, dir);
    check('proof: a receipt present in RUN_RECEIPTS.md resolves', r('Reproduced, see RCPT-001'));
    check('proof: a receipt absent from RUN_RECEIPTS.md does not resolve', !r('RCPT-009'));
    check('proof: a receipt with a matching exit code resolves', r('RCPT-002 exit 1'));
    check('proof: a receipt with a wrong exit code does not resolve', !r('RCPT-002 exit 0'));
    check('proof: a malformed receipt row is not a receipt', !r('RCPT-003'));
    check('proof: a receipt cited without a RUN_RECEIPTS.md does not resolve', !r('RCPT-001', bare));
    check('proof: an existing sandbox file resolves', r('see src/a.js') && r('`src/a.js:1` shows it'));
    check('proof: a missing sandbox file does not resolve', !r('see src/missing.js'));
    check('proof: a path escaping the sandbox does not resolve', !r('`../outside.txt`'));
    check('proof: the bench output file is not evidence', !r('BENCH_FINDINGS.json') && !r('RUN_RECEIPTS.md'));
    check('proof: a test name found in a sandbox test file resolves', r('the test `adds two numbers` fails'));
    check('proof: a test name absent from every test file does not resolve', !r('the test `subtracts numbers` fails'));
    check('proof: a test name inside node_modules does not resolve', !r('`hidden dependency test`'));
    check('proof: a bare command string does not resolve', !r('`npm test` fails') && !r('ran node --test and it failed'));
    check('proof: an empty or missing proof does not resolve', !r('') && !r(undefined));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }

  // --target filter: only the named target's tasks; an unknown name is refused, not ignored.
  const m = { targets: [{ name: 'a' }, { name: 'b' }], tasks: [{ id: 'a1', target: 'a' }, { id: 'b1', target: 'b' }, { id: 'a2', target: 'a' }] };
  check('plan: no --target keeps every task', planTasks(m, undefined).length === 3);
  check('plan: --target keeps only that target', planTasks(m, 'a').map((t) => t.id).join() === 'a1,a2');
  let refused = false;
  try { planTasks(m, 'c'); } catch { refused = true; }
  check('plan: an unknown --target is refused', refused);

  // Target size: JavaScript outside test/, dist/, docs/, and ANSWER_KEY.* counts.
  const tree = mkdtempSync(join(tmpdir(), 'bench-lines-'));
  try {
    const put = (rel, text) => { mkdirSync(join(tree, rel, '..'), { recursive: true }); writeFileSync(join(tree, rel), text); };
    put('modules/a.js', 'a\nb\n');
    put('index.mjs', 'c\n');
    put('test/a.test.js', 'x\nx\nx\n');
    put('ANSWER_KEY.oracles/o.test.js', 'x\n');
    put('docs/d.js', 'x\n');
    put('data/blob.parquet', 'x\nx\n');
    check('size: counts source JavaScript only', countLines(tree) === 3, String(countLines(tree)));
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}
