#!/usr/bin/env node
// Reads the cost ledger the lifecycle overlay appends at every session idle and
// reports spend per session, day, and model. `--check` applies the profile's
// `cost_gates` and exits 1 on a breach, so the same command serves as a gate.
//
// Usage: node cost-report.mjs [--ledger <path>] [--profile <path>] [--since <days>] [--json] [--check]
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const home = join(homedir(), '.claude', 'code-ops');
const ledgerPath = value('--ledger') ?? process.env.CODE_OPS_COST_LEDGER ?? join(home, 'opencode-cost.jsonl');
const profilePath = value('--profile') ?? process.env.CODE_OPS_MODEL_PROFILE ?? join(home, 'opencode-model-profile.json');
const sinceDays = Number(value('--since'));

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

function readLedger(path) {
  if (!existsSync(path)) return [];
  const last = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      // Rows are running totals. The last one per session is the session.
      if (row?.sessionId) last.set(row.sessionId, row);
    } catch { /* a torn line is skipped, never fatal */ }
  }
  return [...last.values()];
}

const profile = readJson(profilePath);
const rate = Number(profile.credits_per_usd) > 0 ? Number(profile.credits_per_usd) : null;
const cap = Number(profile.budget_credits) > 0 ? Number(profile.budget_credits) : null;
const gates = profile.cost_gates ?? {};
const creditsOf = (row) => (rate ? row.costUsd * rate : row.credits ?? 0);

// A flat-rate host reports zero cost. When the operator has put per-million
// token prices in the profile (`prices.<model id>: { input, cached, output }`),
// the row is priced from its own token counts and marked estimated.
const bare = (id) => String(id).split('/').pop();
function priced(row) {
  if (row.costUsd > 0) return row;
  const price = (row.models ?? []).map((id) => profile.prices?.[id] ?? profile.prices?.[bare(id)]).find(Boolean);
  if (!price || !row.tokens) return row;
  const t = row.tokens;
  const usd = ((t.input + t.cacheCreate) * (price.input ?? 0) + t.cacheRead * (price.cached ?? price.input ?? 0)
    + (t.output + t.thinking) * (price.output ?? 0)) / 1e6;
  return { ...row, costUsd: usd, estimated: true };
}

let rows = readLedger(ledgerPath).map(priced);
if (sinceDays > 0) {
  const floor = Date.now() - sinceDays * 86_400_000;
  rows = rows.filter((row) => Date.parse(row.ts) >= floor);
}

const leads = rows.filter((row) => !row.parentId);
const childrenOf = (id) => rows.filter((row) => row.parentId === id);
const sessions = leads.map((lead) => {
  const kids = childrenOf(lead.sessionId);
  const usd = lead.costUsd + kids.reduce((n, k) => n + k.costUsd, 0);
  const turns = lead.turns + kids.reduce((n, k) => n + k.turns, 0);
  return {
    sessionId: lead.sessionId,
    estimated: [lead, ...kids].some((r) => r.estimated),
    day: String(lead.ts).slice(0, 10),
    models: [...new Set([lead, ...kids].flatMap((r) => r.models ?? []))],
    turns,
    leadTurns: lead.turns,
    dispatches: lead.dispatches ?? 0,
    contextPeak: lead.contextPeak ?? 0,
    cacheHitRate: lead.cacheHitRate,
    usd,
    credits: creditsOf(lead) + kids.reduce((n, k) => n + creditsOf(k), 0),
    leadShare: usd > 0 ? lead.costUsd / usd : null,
    usdPerTurn: turns > 0 ? usd / turns : 0,
  };
});

const sum = (list, pick) => list.reduce((n, item) => n + pick(item), 0);
const byKey = (list, key) => {
  const out = new Map();
  for (const item of list) {
    for (const k of [].concat(key(item))) {
      const slot = out.get(k) ?? { usd: 0, credits: 0, turns: 0, sessions: 0 };
      slot.usd += item.usd; slot.credits += item.credits; slot.turns += item.turns; slot.sessions += 1;
      out.set(k, slot);
    }
  }
  return out;
};

const now = new Date();
const month = now.toISOString().slice(0, 7);
const monthRows = sessions.filter((s) => s.day.startsWith(month));
const monthCredits = sum(monthRows, (s) => s.credits);
const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
const firstDay = monthRows.length ? Number(monthRows.map((s) => s.day).sort()[0].slice(8)) : now.getDate();
const elapsed = Math.max(1, now.getDate() - firstDay + 1);
// Projected from the first measured day, so an install mid-month is not diluted.
const projected = monthCredits / elapsed * daysInMonth;

const totals = {
  sessions: sessions.length,
  usd: sum(sessions, (s) => s.usd),
  credits: sum(sessions, (s) => s.credits),
  turns: sum(sessions, (s) => s.turns),
  month,
  monthCredits,
  projectedMonthCredits: projected,
  budgetCredits: cap,
};
totals.usdPerTurn = totals.turns > 0 ? totals.usd / totals.turns : 0;

const breaches = [];
const gate = (name, test, text) => { if (gates[name] !== undefined && test(Number(gates[name]))) breaches.push(`${name}: ${text}`); };
for (const s of sessions) {
  const id = s.sessionId.slice(0, 12);
  gate('max_session_credits', (max) => s.credits > max, `session ${id} spent ${s.credits.toFixed(1)} credits`);
  gate('max_context_peak', (max) => s.contextPeak > max, `session ${id} peaked at ${s.contextPeak.toLocaleString('en-US')} tokens of context`);
  gate('max_usd_per_turn', (max) => s.turns >= 5 && s.usdPerTurn > max, `session ${id} cost $${s.usdPerTurn.toFixed(3)} per turn`);
  gate('min_cache_hit_rate', (min) => s.leadTurns >= 5 && s.cacheHitRate !== null && s.cacheHitRate < min, `session ${id} cache hit rate ${(s.cacheHitRate * 100).toFixed(1)}%`);
}
gate('max_projected_month_credits', (max) => projected > max, `month projects to ${projected.toFixed(0)} credits`);

if (flag('--json')) {
  console.log(JSON.stringify({ ledger: ledgerPath, totals, baseline: profile.baseline ?? null, sessions, breaches }, null, 2));
} else {
  const money = (n) => `$${n.toFixed(2)}`;
  console.log(`Cost ledger: ${ledgerPath}`);
  if (!sessions.length) console.log('No measured sessions yet. The overlay appends a row at every session idle.');
  console.log(`Sessions ${totals.sessions} · turns ${totals.turns} · ${money(totals.usd)} · ${totals.credits.toFixed(1)} credits · ${money(totals.usdPerTurn)} per turn`);
  if (profile.baseline?.usd_per_turn) {
    const delta = totals.usdPerTurn / profile.baseline.usd_per_turn - 1;
    console.log(`Baseline ${money(profile.baseline.usd_per_turn)} per turn (${profile.baseline.note ?? 'operator measured'}): ${totals.turns ? `${(delta * 100).toFixed(0)}% against it` : 'no turns to compare'}`);
  }
  if (cap) console.log(`Month ${month}: ${monthCredits.toFixed(1)} of ${cap} credits measured, projecting ${projected.toFixed(0)} (${(projected / cap * 100).toFixed(0)}% of budget)`);
  console.log('\nBy day:');
  for (const [day, v] of [...byKey(sessions, (s) => s.day)].sort()) console.log(`  ${day}  ${v.sessions} sessions  ${v.turns} turns  ${money(v.usd)}  ${v.credits.toFixed(1)} credits`);
  console.log('\nBy model (a session counts under each model it used):');
  for (const [model, v] of byKey(sessions, (s) => s.models)) console.log(`  ${model}  ${v.sessions} sessions  ${money(v.usd)}`);
  console.log('\nSessions, dearest first:');
  for (const s of [...sessions].sort((a, b) => b.usd - a.usd).slice(0, 15)) {
    const hit = s.cacheHitRate === null || s.cacheHitRate === undefined ? 'n/a' : `${(s.cacheHitRate * 100).toFixed(0)}%`;
    const lead = s.leadShare === null ? 'n/a' : `${(s.leadShare * 100).toFixed(0)}%`;
    console.log(`  ${s.day} ${s.sessionId.slice(0, 12)}  ${money(s.usd)}  ${s.credits.toFixed(1)}cr  ${s.turns} turns  peak ${Math.round(s.contextPeak / 1000)}k  cache ${hit}  lead share ${lead}  dispatches ${s.dispatches}${s.estimated ? '  (estimated from profile prices)' : ''}`);
  }
  if (breaches.length) console.log(`\nGate breaches:\n${breaches.map((b) => `  ${b}`).join('\n')}`);
  else if (Object.keys(gates).length) console.log('\nAll cost gates hold.');
}

if (flag('--check') && breaches.length) process.exit(1);
