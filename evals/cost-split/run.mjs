#!/usr/bin/env node
// Regression eval for scripts/cost-split.mjs, the by-model and by-agent cost split (MT-C3, D-008).
//
// A throwaway transcript tree holds one main session and two subagent threads. Every dollar figure
// below is computed by hand from the fixture's token counts and the list prices in the script's own
// table, never read off the tool and never compared with any earlier measurement:
//
//   a.   Priced split. One Opus lead, one Sonnet implementer, and one Haiku 4.5 thread with no meta
//        file (type `unknown`) each price to the hand-computed USD and the priced subtotal sums them.
//   b.   Per-field max. One lead message id appears twice and the later record raises output, so the
//        lead's output is the later figure once, not the first figure and not the sum.
//   c.   Unpriced ids. `claude-fable-5-1` (no entry) and `claude-haiku-5-5` (a per-request tier the
//        session totals cannot apply) are listed with their tokens and cost nothing in the subtotal.
//        An id with no entry is never $0 and never aliased to a family rate.
//   d.   A message with no usage lands under UNKNOWN and is reported as incomplete.
//   e.   `--check` exits 1 for the fixture with unpriced ids, 0 for a fixture whose ids are all
//        priced, and 1 for a directory with no transcripts.
//   f.   Peak context per agent type: the median and p90 over each type's threads.
//   h.   Advisor calls (OI-11). Tokens sit in `usage.iterations[]` entries of type `advisor_message`
//        beside the lead's own, so a call prices under the iteration's model id and never changes the
//        lead row. Streamed lines repeat a message id and a tool id, so calls and tokens count once.
//        The caller split, a call with no usage, a missing iteration model, and an unpriced advisor
//        id each have a case, and the line-level `advisorModel` alias is never used as a price key.
//   g.   DEC-6. The script keeps its own table: it does not import model-tiers.mjs, and
//        `PROVIDER_PRICES` gains no Anthropic key, which would change the opencode distribution.
//
// MUTATION CONTROL. A copy of the script that prices an unknown id at the Opus rate (the family
// alias V-REF found) runs on the same fixture and on the advisor fixture. The unpriced assertions
// must fail on both.
//
//   node evals/cost-split/run.mjs   (exit 0 = all assertions pass)

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDER_PRICES } from '../../scripts/model-tiers.mjs';
import { tally } from '../harness.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPTS = join(REPO, 'scripts');
const { fails, check } = tally();
const tmp = mkdtempSync(join(tmpdir(), 'cost-split-'));

const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5', HAIKU4 = 'claude-haiku-4-5-20251001';
const FABLE = 'claude-fable-5-1', HAIKU5 = 'claude-haiku-5-5';

const usage = (input, cacheRead, cacheCreate, output) => ({
  input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate, output_tokens: output,
});
let clock = Date.parse('2026-10-01T00:00:00Z');
const line = (id, model, u) => JSON.stringify({
  type: 'assistant', timestamp: new Date(clock += 1000).toISOString(),
  message: { id, model, ...(u ? { usage: u } : {}), content: [{ type: 'text', text: 'x' }] },
});
const writeLines = (file, lines) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${lines.join('\n')}\n`); };

// The priced-and-unpriced fixture.
const mixed = join(tmp, 'mixed');
writeLines(join(mixed, 's1.jsonl'), [
  line('m1', OPUS, usage(1000, 100000, 20000, 500)),
  line('m1', OPUS, usage(1000, 100000, 20000, 2000)),
  line('m2', OPUS, usage(500, 50000, 0, 1000)),
  line('m3', FABLE, usage(100, 0, 0, 50)),
  line('m4', OPUS, null),
]);
const sub = (name, type, lines) => {
  writeLines(join(mixed, 's1', 'subagents', `${name}.jsonl`), lines);
  if (type) writeFileSync(join(mixed, 's1', 'subagents', `${name}.meta.json`), JSON.stringify({ agentType: type }));
};
sub('agent-a', 'code-ops-suite:implementer', [
  line('m5', SONNET, usage(200, 10000, 5000, 800)),
  line('m6', HAIKU5, usage(1000, 0, 0, 100)),
  line('m7', SONNET, usage(100, 2000, 0, 300)),
]);
sub('agent-b', null, [line('m8', HAIKU4, usage(1000, 0, 1000, 1000))]);

// A fixture whose ids are all priced.
const clean = join(tmp, 'clean');
writeLines(join(clean, 's2.jsonl'), [line('c1', OPUS, usage(1000, 0, 0, 1000))]);

// Advisor fixtures. `adv` is one session with a streamed lead call, a second lead call, one subagent
// call with usage, and one subagent call without. `advX` carries an unpriced advisor id and an
// iteration with no model. `advNone` carries a call with no usage at all. The `advisorModel` field is
// the host's line-level alias; the script must ignore it.
const iter = (type, input, output, model) => ({ type, input_tokens: input, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...(model ? { model } : {}) });
const advLine = (id, model, u, { call, advisor = [] } = {}) => JSON.stringify({
  type: 'assistant', advisorModel: 'opus', timestamp: new Date(clock += 1000).toISOString(),
  message: {
    id, model, usage: { ...u, iterations: [iter('message', u.input_tokens, u.output_tokens), ...advisor] },
    content: call ? [{ type: 'server_tool_use', id: call, name: 'advisor', input: {} }] : [{ type: 'text', text: 'x' }],
  },
});
const adv = join(tmp, 'adv');
const L1 = { call: 'srv1', advisor: [iter('advisor_message', 150000, 7000, OPUS)] };
writeLines(join(adv, 'a1.jsonl'), [
  advLine('l1', OPUS, usage(10, 1000, 0, 500), L1),
  advLine('l1', OPUS, usage(10, 1000, 0, 500), L1),
  advLine('l1', OPUS, usage(10, 1000, 0, 500), { advisor: L1.advisor }),
  advLine('l2', OPUS, usage(0, 0, 0, 0), { call: 'srv2', advisor: [iter('advisor_message', 50000, 2000, OPUS)] }),
]);
writeLines(join(adv, 'a1', 'subagents', 'agent-x.jsonl'), [
  advLine('s1', SONNET, usage(100, 0, 0, 100), { call: 'srv3', advisor: [iter('advisor_message', 20000, 1000, OPUS)] }),
  advLine('s2', SONNET, usage(0, 0, 0, 0), { call: 'srv4' }),
]);
writeFileSync(join(adv, 'a1', 'subagents', 'agent-x.meta.json'), JSON.stringify({ agentType: 'code-ops-suite:implementer' }));
const advX = join(tmp, 'advX');
writeLines(join(advX, 'b1.jsonl'), [
  advLine('x1', OPUS, usage(1, 0, 0, 1), { call: 'srv5', advisor: [iter('advisor_message', 1000, 100, FABLE)] }),
  advLine('x2', OPUS, usage(1, 0, 0, 1), { call: 'srv6', advisor: [iter('advisor_message', 10, 1)] }),
]);
const advNone = join(tmp, 'advNone');
writeLines(join(advNone, 'c1.jsonl'), [advLine('n1', OPUS, usage(1, 0, 0, 1), { call: 'srv7' })]);

const run = (script, args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const json = (script, dir) => {
  const r = run(script, ['--transcripts', dir, '--json']);
  return { ...r, rep: r.status === 0 ? JSON.parse(r.stdout) : null };
};
const row = (rep, group, model) => rep.rows.find((r) => r.group === group && r.model === model);
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
const script = join(SCRIPTS, 'cost-split.mjs');

const full = json(script, mixed);
const rep = full.rep;
check('fixture runs and reports JSON', Boolean(rep), full.stderr);

// a. Hand-computed per million-token list prices.
//    Lead Opus: (1500*4 + 150000*0.2 + 20000*5 + 3000*20) / 1e6 = 0.196
//    Implementer Sonnet: (300*2 + 12000*0.2 + 5000*2.5 + 1100*10) / 1e6 = 0.0265
//    Unknown-type Haiku 4.5: (1000*1 + 0 + 1000*1.25 + 1000*5) / 1e6 = 0.00725
const lead = row(rep, 'lead', OPUS);
check('a. lead Opus tokens and USD', lead?.input === 1500 && lead.cacheRead === 150000 && lead.cacheWrite === 20000 && near(lead.usd, 0.196), JSON.stringify(lead));
const impl = row(rep, 'agent:code-ops-suite:implementer', SONNET);
check('a. implementer Sonnet USD', impl?.input === 300 && impl.cacheRead === 12000 && impl.cacheWrite === 5000 && impl.output === 1100 && near(impl.usd, 0.0265), JSON.stringify(impl));
const haiku = row(rep, 'agent:unknown', HAIKU4);
check('a. Haiku 4.5 thread with no meta file prices under agent:unknown', near(haiku?.usd, 0.00725), JSON.stringify(haiku));
check('a. priced subtotal sums the priced rows only', near(rep.totals.pricedUsd, 0.22975), String(rep.totals.pricedUsd));
check('a. kind split keeps lead and subagent apart', rep.byKind.some((k) => k.kind === 'lead' && k.model === OPUS && near(k.usd, 0.196))
  && rep.byKind.some((k) => k.kind === 'subagent' && k.model === SONNET && near(k.usd, 0.0265)), JSON.stringify(rep.byKind));

// b. The repeated message id counts once at its per-field maximum: output 2000 + 1000, not 500 + 1000 or 3500.
check('b. repeated message id takes the per-field max', lead?.output === 3000 && lead.messages === 2, JSON.stringify(lead));

// c. Unpriced ids are listed, with tokens, and add nothing to the subtotal.
const ids = rep.unpriced.map((u) => u.model).sort();
check('c. exactly the two unpriced ids are listed', JSON.stringify(ids) === JSON.stringify([FABLE, HAIKU5].sort()), JSON.stringify(ids));
const fable = rep.unpriced.find((u) => u.model === FABLE);
check('c. an unpriced id carries its tokens and a reason', fable?.input === 100 && fable.output === 50 && fable.messages === 1 && fable.reason === 'no price pinned', JSON.stringify(fable));
check('c. Haiku 5.5 names its per-request tier', /100k/.test(rep.unpriced.find((u) => u.model === HAIKU5)?.reason ?? ''));
check('c. unpriced rows have no USD', rep.rows.filter((r) => !r.priced).every((r) => r.usd === null));
const text = run(script, ['--transcripts', mixed]);
check('c. text report lists the unpriced id and labels the subtotal', /## Unpriced model ids[\s\S]*claude-fable-5-1/.test(text.stdout)
  && text.stdout.includes('Priced subtotal, excludes unpriced ids: $0.23.'), text.stdout.slice(-400));

// d. A message with no usage is incomplete, never priced.
check('d. missing usage is reported as incomplete', rep.incomplete.some((i) => i.model === 'UNKNOWN'), JSON.stringify(rep.incomplete));

// e. --check.
check('e. --check exits 1 with unpriced ids', run(script, ['--transcripts', mixed, '--check']).status === 1);
const cleanRun = run(script, ['--transcripts', clean, '--check']);
check('e. --check exits 0 when every id is priced', cleanRun.status === 0, cleanRun.stderr);
check('e. no transcripts exits 1', run(script, ['--transcripts', join(tmp, 'absent'), '--check']).status === 1);
check('e. a bad flag exits 2', run(script, ['--nope']).status === 2);

// f. Peak context: the input side of the largest turn, per agent type.
const peak = rep.context.find((c) => c.group === 'agent:code-ops-suite:implementer');
check('f. implementer peak context is the largest turn input side', peak?.threads === 1 && peak.turnsMedian === 3 && peak.peakMedian === 15200 && peak.peakP90 === 15200, JSON.stringify(peak));

// g. DEC-6: the table is the script's own.
const source = readFileSync(script, 'utf8');
check('g. the script imports nothing from model-tiers.mjs', !/model-tiers/.test(source.replace(/\/\/.*$/gm, '')));
check('g. PROVIDER_PRICES gains no Anthropic key', Object.keys(PROVIDER_PRICES).every((k) => !/anthropic|claude/i.test(k)), Object.keys(PROVIDER_PRICES).join(','));

// h. Advisor calls.
//    Lead Opus: (10*4 + 1000*0.2 + 500*20) / 1e6 = 0.01024, from the top-level fields alone.
//    Advisor Opus, three usages: input 150000+50000+20000 = 220000, output 7000+2000+1000 = 10000,
//    (220000*4 + 10000*20) / 1e6 = 1.08, over messages 3.
//    Subagent Sonnet: (100*2 + 100*10) / 1e6 = 0.0012. Priced subtotal: 0.01024 + 0.0012 + 1.08 = 1.09144.
const advRun = json(script, adv);
const a = advRun.rep;
check('h. advisor fixture runs', Boolean(a), advRun.stderr);
const advRow = row(a, 'advisor', OPUS);
check('h. advisor tokens price under the iteration model id', advRow?.kind === 'advisor' && advRow.input === 220000 && advRow.output === 10000 && advRow.cacheRead === 0 && advRow.messages === 3 && near(advRow.usd, 1.08), JSON.stringify(advRow));
const advLead = row(a, 'lead', OPUS);
check('h. the advisor iteration never changes the lead row', advLead?.input === 10 && advLead.cacheRead === 1000 && advLead.output === 500 && near(advLead.usd, 0.01024), JSON.stringify(advLead));
check('h. the line-level advisorModel alias is never a price key', a.rows.every((r) => r.model !== 'opus'), JSON.stringify(a.rows.map((r) => r.model)));
check('h. subtotal includes the advisor row once', near(a.totals.pricedUsd, 1.09144), String(a.totals.pricedUsd));
const advSession = a.advisor.sessions[0];
check('h. streamed repeats count one call each; the caller split holds', a.advisor.calls === 4 && a.advisor.leadCalls === 2 && a.advisor.subagentCalls === 2 && a.advisor.sessions.length === 1
  && advSession.session === 'a1' && advSession.leadCalls === 2 && advSession.subagentCalls === 2, JSON.stringify(a.advisor));
check('h. a call with no advisor iteration is counted as usage absent', a.advisor.usageAbsent === 1 && advSession.usageAbsent === 1, JSON.stringify(a.advisor));
const advText = run(script, ['--transcripts', adv]).stdout;
check('h. text report names the session and the absent usage', /## Advisor calls[\s\S]*\| a1 \| 2 \| 2 \| 1 \|/.test(advText) && advText.includes('Usage is absent for 1 of 4 call(s)'), advText.slice(-500));
check('h. --check exits 0 when every advisor id is priced, even with a usage-absent call', run(script, ['--transcripts', adv, '--check']).status === 0);

const advXRun = json(script, advX);
const ax = advXRun.rep;
const axIds = ax?.unpriced.map((u) => u.model).sort();
check('h. an unpriced advisor id and a missing iteration model are listed', JSON.stringify(axIds) === JSON.stringify([FABLE, 'UNKNOWN'].sort()), JSON.stringify(ax?.unpriced));
const axFable = ax?.unpriced.find((u) => u.model === FABLE);
check('h. the unpriced advisor id carries its tokens and no USD', axFable?.input === 1000 && axFable.output === 100 && row(ax, 'advisor', FABLE)?.usd === null, JSON.stringify(axFable));
check('h. an iteration with no model marks its row incomplete', ax?.incomplete.some((i) => i.group === 'advisor' && i.model === 'UNKNOWN'), JSON.stringify(ax?.incomplete));
check('h. --check exits 1 for an unpriced advisor id', run(script, ['--transcripts', advX, '--check']).status === 1);

const none = json(script, advNone).rep;
const noneText = run(script, ['--transcripts', advNone]).stdout;
check('h. a transcript with no advisor usage reports the count only', none?.advisor.calls === 1 && none.advisor.usageAbsent === 1 && !none.rows.some((r) => r.group === 'advisor'), JSON.stringify(none?.advisor));
check('h. the text report says the usage is absent', noneText.includes('The transcripts carry no advisor usage'), noneText.slice(-400));
check('h. a transcript without advisor calls prints None', /## Advisor calls\s+None\./.test(run(script, ['--transcripts', clean]).stdout));

// Mutation control: price an unknown id at the Opus rate.
const mutantDir = join(tmp, 'mutant');
mkdirSync(mutantDir);
for (const name of ['cost-split.mjs', 'cli-lib.mjs', 'transcript-lib.mjs']) copyFileSync(join(SCRIPTS, name), join(mutantDir, name));
const alias = "const price = Object.hasOwn(PRICES, row.model) ? PRICES[row.model] : null;";
check('mutation target exists in the script', source.includes(alias));
writeFileSync(join(mutantDir, 'cost-split.mjs'), source.replace(alias, "const price = PRICES[row.model] ?? PRICES['claude-opus-5-5'];"));
const mutant = json(join(mutantDir, 'cost-split.mjs'), mixed);
check('mutation: aliasing an unknown id empties the unpriced list', mutant.rep?.unpriced.length === 0, JSON.stringify(mutant.rep?.unpriced));
check('mutation: aliasing changes the subtotal', !near(mutant.rep?.totals.pricedUsd, 0.22975));
check('mutation: --check no longer fails', run(join(mutantDir, 'cost-split.mjs'), ['--transcripts', mixed, '--check']).status === 0);
const mutantAdv = json(join(mutantDir, 'cost-split.mjs'), advX);
check('mutation: aliasing empties the unpriced advisor list', mutantAdv.rep?.unpriced.length === 0 && run(join(mutantDir, 'cost-split.mjs'), ['--transcripts', advX, '--check']).status === 0, JSON.stringify(mutantAdv.rep?.unpriced));

rmSync(tmp, { recursive: true, force: true });
if (fails.length) {
  console.error(`\n${fails.length} check(s) failed:\n- ${fails.join('\n- ')}`);
  process.exit(1);
}
console.log('\ncost-split eval: all checks pass');
