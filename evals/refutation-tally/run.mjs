#!/usr/bin/env node
// Refutation tally regression eval: the pure rule (scripts/refutation-tally.mjs) and its CLI.
//
//   node evals/refutation-tally/run.mjs   (exit 0 = pass)
//
// One group of cases per rule, then the cases that guard the fail-closed edges. The CLI cases spawn
// the real script with a file path and with stdin.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally as refutationTally } from '../../scripts/refutation-tally.mjs';
import { tally } from '../harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'refutation-tally.mjs');
const { fails, check } = tally();

const LENSES = ['reachability', 'impact', 'defenses'];
const vote = (lens, verdict = 'SURVIVED', severity) => ({ lens, verdict, ...(severity ? { severity } : {}) });
const panel = (verdicts, severities = []) => LENSES.map((lens, i) => vote(lens, verdicts[i], severities[i]));
const finding = (over = {}) => ({
  id: 'F1', file: 'src/a.mjs', line: 10, class: 'injection', tier: 'PROBABLE', severity: 'high',
  votes: panel(['SURVIVED', 'SURVIVED', 'SURVIVED']), ...over,
});
const run = (findings, extra = {}) => refutationTally({ findings, ...extra }).findings;
const one = (f, extra) => run([f], extra)[0];
const summary = (r) => `${r.outcome} ${r.tier} ${r.severity} survived=${r.survived}`;

// ---- rule 1: merge ----------------------------------------------------------------------
{
  const [r, ...rest] = run([
    finding({ id: 'A', tier: 'PROBABLE', severity: 'high', votes: panel(['SURVIVED', 'SURVIVED', 'SURVIVED']) }),
    finding({ id: 'B', tier: 'SPECULATIVE', severity: 'medium', votes: panel(['SURVIVED', 'SURVIVED', 'SURVIVED']) }),
  ]);
  check('merge: same file, line, class gives one finding', rest.length === 0 && r.id === 'A' && r.merged.join() === 'B', JSON.stringify(r));
  check('merge: takes the lower tier and the lower severity', r.tier === 'SPECULATIVE' && r.severity === 'medium', summary(r));
}
check('merge: a CONFIRMED member keeps the group CONFIRMED and BYPASS', (() => {
  const [r, ...rest] = run([finding({ id: 'A', tier: 'SPECULATIVE' }), finding({ id: 'B', tier: 'CONFIRMED' })]);
  return rest.length === 0 && r.tier === 'CONFIRMED' && r.outcome === 'BYPASS';
})());
check('merge: a different class does not merge', run([finding({ id: 'A' }), finding({ id: 'B', class: 'other' })]).length === 2);
check('merge: a different line does not merge', run([finding({ id: 'A' }), finding({ id: 'B', line: 11 })]).length === 2);
check('merge: one REFUTED vote makes that lens REFUTED', (() => {
  const r = one(finding({ votes: [...panel(['SURVIVED', 'SURVIVED', 'SURVIVED'])] }));
  const [m] = run([
    finding({ id: 'A', votes: panel(['SURVIVED', 'SURVIVED', 'SURVIVED']) }),
    finding({ id: 'B', votes: panel(['REFUTED', 'SURVIVED', 'SURVIVED']) }),
  ]);
  return r.lenses.reachability === 'SURVIVED' && m.lenses.reachability === 'REFUTED' && m.survived === 2 && m.tier === 'SPECULATIVE';
})());
check('merge: findings without a usable file, line, and class never merge', run([finding({ id: 'A', file: undefined }), finding({ id: 'B', file: undefined })]).length === 2);

// ---- rule 2: CONFIRMED bypass -----------------------------------------------------------
{
  const r = one(finding({ tier: 'CONFIRMED', severity: 'critical', votes: [] }));
  check('bypass: CONFIRMED passes through unchanged', r.outcome === 'BYPASS' && r.tier === 'CONFIRMED' && r.severity === 'critical', summary(r));
  const refuted = one(finding({ tier: 'CONFIRMED', votes: panel(['REFUTED', 'REFUTED', 'REFUTED']) }));
  check('bypass: a fully refuting panel does not remove CONFIRMED', refuted.outcome === 'BYPASS' && refuted.tier === 'CONFIRMED', summary(refuted));
}

// ---- rule 3: lenses fail closed ---------------------------------------------------------
{
  const missing = one(finding({ votes: panel(['SURVIVED', 'SURVIVED']).slice(0, 2) }));
  check('lens: a missing vote counts as REFUTED', missing.lenses.defenses === 'REFUTED' && missing.survived === 2, summary(missing));
  const malformed = one(finding({ votes: [vote('reachability'), vote('impact'), { lens: 'defenses', verdict: 'MAYBE' }] }));
  check('lens: an unknown verdict counts as REFUTED', malformed.lenses.defenses === 'REFUTED' && malformed.survived === 2, summary(malformed));
  const garbage = one(finding({ votes: [vote('reachability'), vote('impact'), 'SURVIVED', null, 7] }));
  check('lens: a non-object vote counts as REFUTED and is reported', garbage.lenses.defenses === 'REFUTED' && garbage.ignored.includes('(malformed vote)'), JSON.stringify(garbage));
  const badSeverity = one(finding({ votes: [vote('reachability'), vote('impact'), vote('defenses', 'SURVIVED', 'severe')] }));
  check('lens: a severity outside the enum counts as REFUTED', badSeverity.lenses.defenses === 'REFUTED', summary(badSeverity));
  const conflict = one(finding({ votes: [...panel(['SURVIVED', 'SURVIVED', 'SURVIVED']), vote('impact', 'REFUTED')] }));
  check('lens: conflicting votes count as REFUTED', conflict.lenses.impact === 'REFUTED' && conflict.survived === 2, summary(conflict));
  const noVotes = one(finding({ votes: undefined }));
  check('lens: a finding with no votes array has 0 survived', noVotes.survived === 0 && noVotes.outcome === 'DROPPED', summary(noVotes));
  const unknown = one(finding({ votes: [...panel(['SURVIVED', 'SURVIVED', 'SURVIVED']), vote('style')] }));
  check('lens: an unknown lens is ignored and reported', unknown.survived === 3 && unknown.ignored.join() === 'style', JSON.stringify(unknown));
}

// ---- rules 4 and 5: counts, cap, and drop -----------------------------------------------
{
  const three = one(finding({ tier: 'PROBABLE' }));
  check('cap: 3 of 3 SURVIVED keeps PROBABLE', three.tier === 'PROBABLE' && three.outcome === 'KEPT', summary(three));
  const two = one(finding({ tier: 'PROBABLE', votes: panel(['SURVIVED', 'REFUTED', 'SURVIVED']) }));
  check('cap: 2 of 3 SURVIVED caps at SPECULATIVE', two.tier === 'SPECULATIVE' && two.outcome === 'DOWNGRADED', summary(two));
  const one1 = one(finding({ votes: panel(['SURVIVED', 'REFUTED', 'REFUTED']) }));
  check('drop: 1 of 3 SURVIVED drops the finding', one1.outcome === 'DROPPED' && one1.tier === null && one1.severity === null, summary(one1));
  const kept = one(finding({ tier: 'PROBABLE', votes: panel(['SURVIVED', 'REFUTED', 'REFUTED']) }), { keepUnproven: true });
  check('keepUnproven: 1 of 3 on a PROBABLE input is DOWNGRADED to SPECULATIVE', kept.outcome === 'DOWNGRADED' && kept.tier === 'SPECULATIVE', summary(kept));
  const keptNone = one(finding({ votes: panel(['REFUTED', 'REFUTED', 'REFUTED']) }), { keepUnproven: true });
  check('keepUnproven: 0 of 3 on a PROBABLE input is DOWNGRADED to SPECULATIVE', keptNone.outcome === 'DOWNGRADED' && keptNone.tier === 'SPECULATIVE' && keptNone.survived === 0, summary(keptNone));
  const notTrue = one(finding({ votes: panel(['REFUTED', 'REFUTED', 'REFUTED']) }), { keepUnproven: 'true' });
  check('keepUnproven: only the boolean true keeps', notTrue.outcome === 'DROPPED', summary(notTrue));
}
{
  const spec = one(finding({ tier: 'SPECULATIVE' }));
  check('tier: a SPECULATIVE input with 3 of 3 SURVIVED stays SPECULATIVE', spec.tier === 'SPECULATIVE' && spec.outcome === 'KEPT', summary(spec));
  const tiers = ['PROBABLE', 'SPECULATIVE', 'BOGUS', undefined];
  const counts = [['SURVIVED', 'SURVIVED', 'SURVIVED'], ['SURVIVED', 'SURVIVED', 'REFUTED'], ['SURVIVED', 'REFUTED', 'REFUTED'], []];
  const outs = tiers.flatMap((tier) => counts.map((c) => one(finding({ tier, votes: c.length ? panel(c) : [] }), { keepUnproven: true })));
  check('tier: a non-CONFIRMED input never comes out CONFIRMED', outs.every((r) => r.tier !== 'CONFIRMED'), outs.map(summary).join('; '));
  check('tier: an unknown input tier counts as SPECULATIVE', one(finding({ tier: 'BOGUS' })).tier === 'SPECULATIVE');
}

// ---- rules 6 and 7: severity and outcome ------------------------------------------------
{
  const median = (sev) => one(finding({ severity: 'critical', votes: panel(['SURVIVED', 'SURVIVED', 'SURVIVED'], sev) })).severity;
  check('severity: odd count takes the median', median(['low', 'critical', 'medium']) === 'medium');
  const even = one(finding({ severity: 'critical', votes: panel(['SURVIVED', 'SURVIVED', 'REFUTED'], ['high', 'low', 'critical']) }));
  check('severity: even count takes the lower middle value', even.severity === 'low', summary(even));
  const evenWide = one(finding({ severity: 'critical', votes: panel(['SURVIVED', 'SURVIVED', 'REFUTED'], ['critical', 'high']) }));
  check('severity: the lower of two middle values', evenWide.severity === 'high', summary(evenWide));
  const ignoredRefuted = one(finding({ severity: 'critical', votes: panel(['SURVIVED', 'SURVIVED', 'REFUTED'], ['high', 'high', 'low']) }));
  check('severity: a REFUTED vote severity is not counted', ignoredRefuted.severity === 'high', summary(ignoredRefuted));
  const fallback = one(finding({ severity: 'medium', votes: panel(['SURVIVED', 'SURVIVED', 'SURVIVED']) }));
  check('severity: a vote without severity uses the finding severity', fallback.severity === 'medium', summary(fallback));
  const capped = one(finding({ severity: 'low', votes: panel(['SURVIVED', 'SURVIVED', 'SURVIVED'], ['critical', 'critical', 'critical']) }));
  check('severity: never exceeds the input severity', capped.severity === 'low', summary(capped));
  check('outcome: KEPT when tier and severity are unchanged', fallback.outcome === 'KEPT');
  check('outcome: DOWNGRADED when severity drops', median(['low', 'low', 'low']) === 'low' && one(finding({ severity: 'critical', votes: panel(['SURVIVED', 'SURVIVED', 'SURVIVED'], ['low', 'low', 'low']) })).outcome === 'DOWNGRADED');
  check('outcome: DOWNGRADED when tier drops', two().outcome === 'DOWNGRADED');
}
function two() {
  return one(finding({ votes: panel(['SURVIVED', 'SURVIVED', 'REFUTED']) }));
}

// ---- the input is not changed -----------------------------------------------------------
{
  const input = { findings: [finding({ id: 'A' }), finding({ id: 'B' })] };
  const before = JSON.stringify(input);
  refutationTally(input);
  check('tally does not mutate its input', JSON.stringify(input) === before);
  check('output carries the contract keys', Object.keys(one(finding())).join() === 'id,merged,outcome,tier,severity,survived,lenses,reasons,ignored');
}

// ---- the CLI ----------------------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'code-ops-refutation-tally-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const cli = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', input });
const file = (name, body) => { const p = join(dir, name); writeFileSync(p, body); return p; };
const good = JSON.stringify({ findings: [finding()] });

const fromFile = cli([file('good.json', good)]);
check('cli: exits 0 on valid input from a file', fromFile.status === 0 && JSON.parse(fromFile.stdout).findings[0].outcome === 'KEPT', fromFile.stderr);
const fromStdin = cli(['-'], good);
check('cli: reads stdin with -', fromStdin.status === 0 && JSON.parse(fromStdin.stdout).findings[0].id === 'F1', fromStdin.stderr);
const empty = cli(['-'], '{"findings":[]}');
check('cli: an empty findings array is valid', empty.status === 0 && JSON.parse(empty.stdout).findings.length === 0);
const garbage = cli(['-'], 'not json {');
check('cli: exits 2 on garbage input', garbage.status === 2 && garbage.stderr.trim().split('\n').length === 1 && garbage.stdout === '', garbage.stderr);
for (const [name, body] of [['array', '[]'], ['no-findings', '{}'], ['findings-object', '{"findings":{}}'], ['null', 'null'], ['string', '"x"']]) {
  const r = cli(['-'], body);
  check(`cli: exits 2 when the top level is ${name}`, r.status === 2 && r.stderr.trim().split('\n').length === 1, `${r.status} ${r.stderr}`);
}
check('cli: exits 2 on a missing file', cli([join(dir, 'absent.json')]).status === 2);
check('cli: exits 2 with no argument', cli([]).status === 2);
check('cli: a malformed finding inside a valid envelope exits 0 and drops it', (() => {
  const r = cli(['-'], '{"findings":[7,{"id":"x"}]}');
  return r.status === 0 && JSON.parse(r.stdout).findings.every((f) => f.outcome === 'DROPPED');
})());

if (fails.length) {
  console.error('FAIL — refutation-tally eval:');
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('PASS — refutation-tally eval: the tally merges, fails closed, never raises a tier or severity, and never produces CONFIRMED.');
