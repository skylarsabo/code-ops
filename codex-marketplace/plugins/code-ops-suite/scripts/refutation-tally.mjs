#!/usr/bin/env node
// Refutation tally: a script, not a model, decides whether a finding survives a three-lens panel.
//
// WHY: a refutation panel (reachability, impact, defenses) returns votes, and a model that also
// counts them can round a doubtful panel up. This script counts the votes the same way each time and
// can only lower a tier or a severity, never raise either. Every rule fails closed.
//
//   node scripts/refutation-tally.mjs <input.json>     read a file
//   node scripts/refutation-tally.mjs -                read stdin
//
// Input:  { "findings": [ { id, file, line, class, tier, severity, votes: [ { lens, verdict, severity? } ] } ],
//           "keepUnproven"?: boolean }
// Output: { "findings": [ { id, merged, outcome, tier, severity, survived, lenses, reasons, ignored } ] }
// Exit:   0 = valid input, 2 = the top level is not a JSON object with a findings array, or a read failed.
//
// Rules, in order.
//   1. Findings with the same file, line, and class merge. The first id stays and the rest go to
//      `merged`. The merged tier and severity are the lower ones, except that a CONFIRMED member keeps
//      the group CONFIRMED, because its executed repro still stands. Votes combine per lens, so one
//      REFUTED vote makes that lens REFUTED. A finding with no usable file, line, or class never merges.
//   2. A CONFIRMED finding passes through with outcome BYPASS. Only an executed repro grants CONFIRMED.
//   3. Each lens counts as REFUTED when its vote is missing, malformed, unknown, or in conflict. A vote
//      is malformed when it has an unknown verdict or a severity outside the enum. A vote for an
//      unknown lens is ignored and listed in `ignored`.
//   4. Three SURVIVED lenses cap the tier at PROBABLE, two at SPECULATIVE. Fewer than two drop the
//      finding, or keep it at SPECULATIVE when keepUnproven is true.
//   5. The output tier is the lower of the input tier and the cap, so survival never raises a tier.
//   6. The output severity is the lower median of the SURVIVED lenses' severities (the lower middle
//      value for an even count), never above the input severity. A vote with no severity uses the
//      finding's severity. A kept finding with no SURVIVED lens keeps the input severity.
//   7. The outcome is KEPT when tier and severity both equal the input, and DOWNGRADED when either
//      drops, including a finding kept as unproven. BYPASS and DROPPED come from rules 2 and 4. A DROPPED finding has a null tier and severity.
//
// An input tier or severity outside its enum counts as the lowest value.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LENSES = ['reachability', 'impact', 'defenses'];
const TIERS = ['SPECULATIVE', 'PROBABLE', 'CONFIRMED']; // ascending
const SEVERITIES = ['low', 'medium', 'high', 'critical']; // ascending
const CAP_BY_SURVIVED = { 3: 'PROBABLE', 2: 'SPECULATIVE' };

const rank = (order, value) => Math.max(0, order.indexOf(value)); // unknown -> lowest
const lowerOf = (order, a, b) => (rank(order, a) <= rank(order, b) ? order[rank(order, a)] : order[rank(order, b)]);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function mergeKey(f, index) {
  const usable = typeof f.file === 'string' && Number.isFinite(f.line) && typeof f.class === 'string';
  return usable ? JSON.stringify([f.file, f.line, f.class]) : `unmerged:${index}`;
}

function mergeFindings(findings) {
  const groups = new Map();
  findings.forEach((f, index) => {
    if (!isObject(f)) {
      groups.set(`bad:${index}`, { id: null, merged: [], tier: 'SPECULATIVE', severity: 'low', votes: [], malformed: true });
      return;
    }
    const key = mergeKey(f, index);
    const tier = TIERS[rank(TIERS, f.tier)];
    const severity = SEVERITIES[rank(SEVERITIES, f.severity)];
    const votes = Array.isArray(f.votes) ? f.votes : [];
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { id: f.id ?? null, merged: [], tier, severity, votes: [...votes] });
      return;
    }
    group.merged.push(f.id ?? null);
    group.tier = group.tier === 'CONFIRMED' || tier === 'CONFIRMED' ? 'CONFIRMED' : lowerOf(TIERS, group.tier, tier);
    group.severity = lowerOf(SEVERITIES, group.severity, severity);
    group.votes.push(...votes);
  });
  return [...groups.values()];
}

// One lens verdict from every vote cast for that lens. Returns { verdict, severity, why }.
function readLens(lens, votes, fallbackSeverity) {
  const cast = votes.filter((v) => isObject(v) && v.lens === lens);
  if (!cast.length) return { verdict: 'REFUTED', why: `${lens}: no vote` };
  let severity = null;
  for (const v of cast) {
    if (v.verdict !== 'SURVIVED' && v.verdict !== 'REFUTED') return { verdict: 'REFUTED', why: `${lens}: unknown verdict` };
    if (v.severity !== undefined && !SEVERITIES.includes(v.severity)) return { verdict: 'REFUTED', why: `${lens}: malformed severity` };
    if (v.verdict === 'REFUTED') return { verdict: 'REFUTED', why: `${lens}: refuted` };
    const s = v.severity ?? fallbackSeverity;
    severity = severity === null ? s : lowerOf(SEVERITIES, severity, s);
  }
  return { verdict: 'SURVIVED', severity };
}

function ignoredLenses(votes) {
  const out = [];
  for (const v of votes) {
    if (!isObject(v)) out.push('(malformed vote)');
    else if (!LENSES.includes(v.lens)) out.push(typeof v.lens === 'string' ? v.lens : '(malformed vote)');
  }
  return [...new Set(out)];
}

function tallyOne(g, keepUnproven) {
  const base = { id: g.id, merged: g.merged };
  const reasons = [];
  if (g.malformed) return { ...base, outcome: 'DROPPED', tier: null, severity: null, survived: 0, lenses: {}, reasons: ['finding is not an object'], ignored: [] };
  const read = LENSES.map((lens) => [lens, readLens(lens, g.votes, g.severity)]);
  const lenses = Object.fromEntries(read.map(([lens, r]) => [lens, r.verdict]));
  const survivors = read.filter(([, r]) => r.verdict === 'SURVIVED');
  const survived = survivors.length;
  const ignored = ignoredLenses(g.votes);
  for (const [, r] of read) if (r.why) reasons.push(r.why);
  const done = (outcome, tier, severity, why) => ({ ...base, outcome, tier, severity, survived, lenses, reasons: [...reasons, why], ignored });

  if (g.tier === 'CONFIRMED') return done('BYPASS', g.tier, g.severity, 'CONFIRMED passes through; a panel never grants or removes it');

  const cap = CAP_BY_SURVIVED[survived];
  if (!cap && !keepUnproven) return done('DROPPED', null, null, `${survived} of 3 lenses survived`);
  const tier = lowerOf(TIERS, g.tier, cap ?? 'SPECULATIVE');
  const sorted = survivors.map(([, r]) => r.severity).sort((a, b) => rank(SEVERITIES, a) - rank(SEVERITIES, b));
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : g.severity;
  const severity = lowerOf(SEVERITIES, g.severity, median);
  const unchanged = tier === g.tier && severity === g.severity;
  const why = cap ? `${survived} of 3 lenses survived, cap ${cap}` : `${survived} of 3 lenses survived, kept as unproven`;
  return done(unchanged ? 'KEPT' : 'DOWNGRADED', tier, severity, why);
}

export function tally(input) {
  const keepUnproven = input.keepUnproven === true;
  return { findings: mergeFindings(input.findings).map((g) => tallyOne(g, keepUnproven)) };
}

function main(args) {
  if (args.length !== 1) {
    console.error('usage: refutation-tally.mjs <input.json | ->');
    return 2;
  }
  let input;
  try {
    input = JSON.parse(readFileSync(args[0] === '-' ? 0 : args[0], 'utf8'));
  } catch (err) {
    console.error(`refutation-tally: cannot read input: ${err.message.split('\n')[0]}`);
    return 2;
  }
  if (!isObject(input) || !Array.isArray(input.findings)) {
    console.error('refutation-tally: input must be a JSON object with a findings array');
    return 2;
  }
  console.log(JSON.stringify(tally(input), null, 2));
  return 0;
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isEntryPoint()) process.exit(main(process.argv.slice(2)));
