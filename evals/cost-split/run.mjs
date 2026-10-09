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
//   c.   Unpriced ids. `claude-fable-5-1` (no entry) is listed with its tokens and costs nothing in
//        the subtotal. An id with no entry is never $0 and never aliased to a family rate.
//   i.   Haiku 5.5 (OI-17) prices per message: a prompt (input + cache read + cache write) over
//        100,000 puts the whole request in the higher tier. One message at exactly 100,000 and one
//        at 100,200 price at the low and high rates; the report names the working assumption.
//   d.   A message with no usage lands under UNKNOWN and is reported as incomplete.
//   e.   `--check` exits 1 for the fixture with unpriced ids, 0 for a fixture whose ids are all
//        priced, and 1 for a directory with no transcripts.
//   f.   Peak context per agent type: the median and p90 over each type's threads.
//   h.   Advisor calls (OI-11). Tokens sit in `usage.iterations[]` entries of type `advisor_message`
//        beside the lead's own, so a call prices under the iteration's model id and never changes the
//        lead row. Streamed lines repeat a message id and a tool id, so calls and tokens count once.
//        The caller split, a call with no usage, a missing iteration model, and an unpriced advisor
//        id each have a case, and the line-level `advisorModel` alias is never used as a price key.
//   j.   Forked sessions (OI-29). A fork repeats its parent's message ids in a second file. An id counts
//        once across every file read, a line with no id counts per line, and a Haiku 5.5 repeat prices once.
//   g.   DEC-6. The script keeps its own table: it does not import model-tiers.mjs, and
//        `PROVIDER_PRICES` gains no Anthropic key, which would change the opencode distribution.
//   k.   Window. `--since` counts a message by its own timestamp, in the main thread and in each
//        subagent thread. A line with no timestamp follows the last one before it.
//   l.   Cost per merged PR, from a fixture git repo: merges are two-parent commits whose subject
//        starts `Merge pull request #<n>`, counted in the window; `--all` skips the section.
//   m.   Context columns: turns over 250,000 input side, and compact_boundary rows once per uuid.
//
// MUTATION CONTROL. A copy of the script that prices an unknown id at the Opus rate (the family
// alias V-REF found) runs on the same fixture and on the advisor fixture. The unpriced assertions
// must fail on both. Cases k, l, and m each cut one line of the script in the same way.
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

// Workflow fixture (OI-27). Workflow agents sit at `subagents/workflows/<run>/agent-*.jsonl`
// beside a flat agent. Each has a distinct token count, and one has no meta file.
const wf = join(tmp, 'wf');
writeLines(join(wf, 'w1.jsonl'), [line('w0', OPUS, usage(1000, 0, 0, 1000))]);
const wfSub = (rel, type, lines) => {
  const file = join(wf, 'w1', 'subagents', ...rel);
  writeLines(file, lines);
  if (type) writeFileSync(file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ agentType: type }));
};
wfSub(['agent-flat.jsonl'], 'code-ops-suite:implementer', [line('w1', SONNET, usage(100, 0, 0, 100))]);
wfSub(['workflows', 'wf_one', 'agent-v.jsonl'], 'code-ops-suite:verifier', [line('w2', SONNET, usage(200, 0, 0, 200))]);
wfSub(['workflows', 'wf_two', 'agent-n.jsonl'], null, [line('w3', SONNET, usage(300, 0, 0, 300))]);
wfSub(['workflows', 'wf_two', 'deeper', 'agent-z.jsonl'], null, [line('w4', SONNET, usage(900, 0, 0, 900))]);

// Fork fixture (OI-29). f2 is a fork of f1: it repeats k1, k2, and the Haiku 5.5 message kh, then adds
// k3. Both files carry one line with no message id, and those count per line.
const fork = join(tmp, 'fork');
const shared = [line('k1', OPUS, usage(100, 0, 0, 100)), line('k2', OPUS, usage(200, 0, 0, 200)), line('kh', HAIKU5, usage(1000, 0, 0, 100)), line(undefined, OPUS, usage(10, 0, 0, 0))];
writeLines(join(fork, 'f1.jsonl'), shared);
writeLines(join(fork, 'f2.jsonl'), [...shared, line('k3', OPUS, usage(300, 0, 0, 300))]);

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
//    Implementer Haiku 5.5, one low-tier message: (1000*0.1 + 100*0.5) / 1e6 = 0.00015
check('a. priced subtotal sums the priced rows only', near(rep.totals.pricedUsd, 0.2299), String(rep.totals.pricedUsd));
check('a. kind split keeps lead and subagent apart', rep.byKind.some((k) => k.kind === 'lead' && k.model === OPUS && near(k.usd, 0.196))
  && rep.byKind.some((k) => k.kind === 'subagent' && k.model === SONNET && near(k.usd, 0.0265)), JSON.stringify(rep.byKind));

// b. The repeated message id counts once at its per-field maximum: output 2000 + 1000, not 500 + 1000 or 3500.
check('b. repeated message id takes the per-field max', lead?.output === 3000 && lead.messages === 2, JSON.stringify(lead));

// c. Unpriced ids are listed, with tokens, and add nothing to the subtotal.
const ids = rep.unpriced.map((u) => u.model).sort();
check('c. exactly the unpinned id is listed; Haiku 5.5 is priced', JSON.stringify(ids) === JSON.stringify([FABLE]), JSON.stringify(ids));
const fable = rep.unpriced.find((u) => u.model === FABLE);
check('c. an unpriced id carries its tokens and a reason', fable?.input === 100 && fable.output === 50 && fable.messages === 1 && fable.reason === 'no price pinned', JSON.stringify(fable));
check('c. unpriced rows have no USD', rep.rows.filter((r) => !r.priced).every((r) => r.usd === null));
const text = run(script, ['--transcripts', mixed]);
check('c. text report lists the unpriced id and labels the subtotal', /## Unpriced model ids[\s\S]*claude-fable-5-1/.test(text.stdout)
  && text.stdout.includes('Priced subtotal, excludes unpriced ids: $0.23.'), text.stdout.slice(-400));
check('c. a Haiku 5.5 message in the fixture prints the tier assumption', text.stdout.includes('prompt = input + cache read + cache write tokens of one request'), text.stdout.slice(-600));

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

// i. Haiku 5.5 per-message tiers, hand-computed from the rates in the script's table.
//    Under: prompt 20000+70000+10000 = 100000, not over, low tier:
//      (20000*0.1 + 70000*0.01 + 10000*0.125 + 2000*0.5) / 1e6 = 4950 / 1e6 = 0.00495
//    Over: prompt 30000+60000+10200 = 100200, whole request at the high tier. The id repeats with a
//    lower first output, so the per-field max (2000) applies:
//      (30000*0.5 + 60000*0.05 + 10200*0.625 + 2000*2.5) / 1e6 = 29375 / 1e6 = 0.029375
//    Row: 2 messages, input 50000, cache read 130000, cache write 20200, output 4000, USD 0.034325.
//    Low-tier-everywhere would give 0.00495 + 0.005875 = 0.010825.
const tier = join(tmp, 'tier');
writeLines(join(tier, 't1.jsonl'), [
  line('h1', HAIKU5, usage(20000, 70000, 10000, 2000)),
  line('h2', HAIKU5, usage(30000, 60000, 10200, 1000)),
  line('h2', HAIKU5, usage(30000, 60000, 10200, 2000)),
]);
const tierRun = json(script, tier);
const hr = row(tierRun.rep ?? { rows: [] }, 'lead', HAIKU5);
check('i. Haiku 5.5 prices per message across the 100,000 prompt threshold', hr?.messages === 2 && hr.input === 50000 && hr.cacheRead === 130000 && hr.cacheWrite === 20200 && hr.output === 4000 && hr.priced && near(hr.usd, 0.034325), JSON.stringify(hr));
check('i. the report counts the messages over the threshold', tierRun.rep?.tiered.length === 1 && tierRun.rep.tiered[0].messages === 2 && tierRun.rep.tiered[0].overThreshold === 1 && tierRun.rep.unpriced.length === 0, JSON.stringify(tierRun.rep?.tiered));
check('i. --check exits 0 for a Haiku 5.5 fixture', run(script, ['--transcripts', tier, '--check']).status === 0);
// The lead thread's peak is the 100,200 turn, so it counts as one thread over the step; the
// implementer thread in the mixed fixture (peak 15,200) counts none.
const tierCtx = tierRun.rep?.context.find((c) => c.group === 'lead');
check('i. the context table counts a thread whose peak crosses the 100,000 step', tierCtx?.peakMax === 100200 && tierCtx.overStep === 1, JSON.stringify(tierCtx));
check('f. a thread under the step has max 15200 and counts none over it', peak?.peakMax === 15200 && peak.overStep === 0, JSON.stringify(peak));
check('i. the text report prints the max and over-step columns', /\| Max peak \| Over 100K \|/.test(run(script, ['--transcripts', tier]).stdout));

// Mutation control: price an unknown id at the Opus rate.
const mutantDir = join(tmp, 'mutant');
mkdirSync(mutantDir);
for (const name of ['cost-split.mjs', 'cli-lib.mjs', 'transcript-lib.mjs']) copyFileSync(join(SCRIPTS, name), join(mutantDir, name));
const alias = "const price = Object.hasOwn(PRICES, row.model) ? PRICES[row.model] : null;";
check('mutation target exists in the script', source.includes(alias));
writeFileSync(join(mutantDir, 'cost-split.mjs'), source.replace(alias, "const price = PRICES[row.model] ?? PRICES['claude-opus-5-5'];"));
const mutant = json(join(mutantDir, 'cost-split.mjs'), mixed);
check('mutation: aliasing an unknown id empties the unpriced list', mutant.rep?.unpriced.length === 0, JSON.stringify(mutant.rep?.unpriced));
check('mutation: aliasing changes the subtotal', !near(mutant.rep?.totals.pricedUsd, 0.2299));
check('mutation: --check no longer fails', run(join(mutantDir, 'cost-split.mjs'), ['--transcripts', mixed, '--check']).status === 0);
const mutantAdv = json(join(mutantDir, 'cost-split.mjs'), advX);
check('mutation: aliasing empties the unpriced advisor list', mutantAdv.rep?.unpriced.length === 0 && run(join(mutantDir, 'cost-split.mjs'), ['--transcripts', advX, '--check']).status === 0, JSON.stringify(mutantAdv.rep?.unpriced));

// j. Hand-computed. Opus lead: input 100+200+300 + 2 id-less lines of 10 = 620, output 600,
//    (620*4 + 600*20) / 1e6 = 0.01448, over 5 messages. Haiku 5.5 low tier, once: (1000*0.1 + 100*0.5) / 1e6 = 0.00015.
//    Per-file dedupe would give Opus input 920 / 7 messages and a second Haiku message.
const forkRep = json(script, fork).rep ?? { rows: [] };
const forkOpus = row(forkRep, 'lead', OPUS), forkHaiku = row(forkRep, 'lead', HAIKU5);
check('j. a message id repeated in a forked file counts once', forkOpus?.input === 620 && forkOpus.output === 600 && forkOpus.messages === 5 && near(forkOpus.usd, 0.01448), JSON.stringify(forkOpus));
check('j. a Haiku 5.5 message repeated in a fork prices once', forkHaiku?.messages === 1 && near(forkHaiku.usd, 0.00015), JSON.stringify(forkHaiku));

// Mutation control: price every Haiku 5.5 message at the low tier. The tier assertions must fail.
const tierPick = "const tierOf = (spec, u) => (u.input + u.cacheRead + u.cacheWrite > spec.threshold ? spec.high : spec.low);";
check('mutation target exists for the tier pick', source.includes(tierPick));
writeFileSync(join(mutantDir, 'cost-split.mjs'), source.replace(tierPick, 'const tierOf = (spec) => spec.low;'));
const lowMutant = json(join(mutantDir, 'cost-split.mjs'), tier);
const lowRow = row(lowMutant.rep ?? { rows: [] }, 'lead', HAIKU5);
check('mutation: all-low-tier pricing fails the hand total', near(lowRow?.usd, 0.010825) && !near(lowRow?.usd, 0.034325), JSON.stringify(lowRow));
check('mutation: all-low-tier pricing counts no message over the threshold', lowMutant.rep?.tiered[0]?.overThreshold === 0, JSON.stringify(lowMutant.rep?.tiered));

// Mutation control: dedupe per file only (the claimed set never remembers). The fork assertions must fail.
const claimedInit = 'const claimed = new Set();';
check('mutation target exists for the cross-file claim', source.includes(claimedInit));
writeFileSync(join(mutantDir, 'cost-split.mjs'), source.replace(claimedInit, 'const claimed = { has: () => false, add() {} };'));
const forkMutant = json(join(mutantDir, 'cost-split.mjs'), fork).rep ?? { rows: [] };
check('mutation: per-file dedupe counts the forked ids twice', row(forkMutant, 'lead', OPUS)?.input === 920 && row(forkMutant, 'lead', HAIKU5)?.messages === 2, JSON.stringify(row(forkMutant, 'lead', OPUS)));

// OI-27: Workflow agent threads count, grouped by their own meta agent type; deeper nesting does not.
const wfRun = json(script, wf);
const wfOut = (group) => row(wfRun.rep ?? { rows: [] }, group, SONNET)?.output;
check('wf. nested Workflow agents are counted (files, threads)', wfRun.rep?.files === 4 && wfRun.rep.subagentThreads === 3, JSON.stringify([wfRun.rep?.files, wfRun.rep?.subagentThreads]));
check('wf. a Workflow agent groups by its meta agent type', wfOut('agent:code-ops-suite:verifier') === 200, String(wfOut('agent:code-ops-suite:verifier')));
check('wf. a Workflow agent with no meta file groups as unknown', wfOut('agent:unknown') === 300, String(wfOut('agent:unknown')));
check('wf. the flat agent is counted once', wfOut('agent:code-ops-suite:implementer') === 100, String(wfOut('agent:code-ops-suite:implementer')));
check('wf. a directory below the run folder is not read', !wfRun.stdout.includes('"output": 900') && !wfRun.stdout.includes('"output":900'));

// Mutation control: the flat read that skips Workflow agents. The wf assertions must fail.
const libSource = readFileSync(join(SCRIPTS, 'transcript-lib.mjs'), 'utf8');
const nested = '...runs.flatMap((e) => jsonl(join(flows, e.name)))';
check('mutation target exists for the Workflow read', libSource.includes(nested));
writeFileSync(join(mutantDir, 'transcript-lib.mjs'), libSource.replace(nested, ''));
writeFileSync(join(mutantDir, 'cost-split.mjs'), source);
const flatMutant = json(join(mutantDir, 'cost-split.mjs'), wf);
check('mutation: the flat read drops the Workflow agents', flatMutant.rep?.subagentThreads === 1 && flatMutant.rep.files === 2, JSON.stringify([flatMutant.rep?.files, flatMutant.rep?.subagentThreads]));

// k. Window (--since). Only a message whose own timestamp is at or after the date counts, in the main
//    thread and in each subagent thread; a line with no timestamp follows its thread's last one.
//    Window starts 2026-10-02. Lead Opus in window: wi (2000 in, 500 out) and the untimestamped wn1
//    (100, 100) after it; the untimestamped wn0 (7, 7) follows the pre-window wo, so it is out.
//    (2100*4 + 600*20) / 1e6 = 0.0204. Subagent Sonnet in window: (400*2 + 400*10) / 1e6 = 0.0048.
//    The old rule (a whole session whose last message is in the window) would add wo and wn0: input 3107.
//    With no window, w2's 5000 joins as well: 8107, which is also what the first mutant below reports.
const SINCE = '2026-10-02T00:00:00Z';
const stamped = (ts, id, model, u) => JSON.stringify({
  type: 'assistant', ...(ts ? { timestamp: ts } : {}),
  message: { id, model, usage: u, content: [{ type: 'text', text: 'x' }] },
});
const win = join(tmp, 'win');
writeLines(join(win, 'w1.jsonl'), [
  stamped('2026-10-01T10:00:00Z', 'wo', OPUS, usage(1000, 0, 0, 1000)),
  stamped(null, 'wn0', OPUS, usage(7, 0, 0, 7)),
  stamped('2026-10-05T10:00:00Z', 'wi', OPUS, usage(2000, 0, 0, 500)),
  stamped(null, 'wn1', OPUS, usage(100, 0, 0, 100)),
]);
writeLines(join(win, 'w2.jsonl'), [stamped('2026-09-20T10:00:00Z', 'wp', OPUS, usage(5000, 0, 0, 5000))]);
const winSub = (name, lines) => {
  writeLines(join(win, 'w1', 'subagents', `${name}.jsonl`), lines);
  writeFileSync(join(win, 'w1', 'subagents', `${name}.meta.json`), JSON.stringify({ agentType: 'code-ops-suite:implementer' }));
};
winSub('agent-new', [stamped('2026-10-01T11:00:00Z', 'ws0', SONNET, usage(300, 0, 0, 300)), stamped('2026-10-06T11:00:00Z', 'ws1', SONNET, usage(400, 0, 0, 400))]);
winSub('agent-old', [stamped('2026-09-25T11:00:00Z', 'ws2', SONNET, usage(9000, 0, 0, 9000))]);
const winRun = (script_, extra = []) => {
  const r = run(script_, ['--transcripts', win, '--since', SINCE, '--json', ...extra]);
  return { ...r, rep: r.status === 0 ? JSON.parse(r.stdout) : null };
};
const winRep = winRun(script).rep;
const winLead = row(winRep ?? { rows: [] }, 'lead', OPUS);
const winSubRow = row(winRep ?? { rows: [] }, 'agent:code-ops-suite:implementer', SONNET);
check('k. only messages at or after --since count in the main thread; an untimestamped line follows the last timestamp before it', winLead?.input === 2100 && winLead.output === 600 && winLead.messages === 2 && near(winLead.usd, 0.0204), JSON.stringify(winLead));
check('k. only in-window messages count in a subagent thread', winSubRow?.input === 400 && winSubRow.output === 400 && near(winSubRow.usd, 0.0048), JSON.stringify(winSubRow));
check('k. a session and a subagent thread wholly before the window are not counted', winRep?.sessions === 1 && winRep.subagentThreads === 1 && winRep.files === 2, JSON.stringify([winRep?.sessions, winRep?.subagentThreads, winRep?.files]));
check('k. the priced subtotal is the in-window sum', near(winRep?.totals.pricedUsd, 0.0252), String(winRep?.totals.pricedUsd));
const winAll = json(script, win).rep;
check('k. without --since every message counts', row(winAll ?? { rows: [] }, 'lead', OPUS)?.input === 8107, JSON.stringify(row(winAll ?? { rows: [] }, 'lead', OPUS)));

// l. Cost per merged PR. A throwaway git repo is built with commit-tree, so every parent list and
//    commit time is exact. Merges (two parents, subject `Merge pull request #<n>`): #11 on 2026-09-15,
//    #12 on 2026-10-03, #13 on 2026-10-05. Not merged PRs: a one-parent commit whose subject names
//    #99, and a two-parent merge whose subject is not a PR merge. In the 2026-10-02 window two PRs
//    merged, so lead 0.0204 / 2 = 0.0102 and total 0.0252 / 2 = 0.0126.
const gitEnv = (date) => ({
  ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
  GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
});
const gitIn = (dir, args, date = '2026-09-01T00:00:00Z', input = '') => spawnSync('git', args, { cwd: dir, encoding: 'utf8', input, env: gitEnv(date) }).stdout.trim();
function buildRepo(dir, spec) {
  mkdirSync(dir, { recursive: true });
  gitIn(dir, ['init', '-q']);
  const tree = gitIn(dir, ['mktree']);
  const made = {};
  let head = null;
  for (const [name, message, date, ...parents] of spec) {
    head = made[name] = gitIn(dir, ['commit-tree', tree, ...parents.flatMap((p) => ['-p', made[p]]), '-m', message], date);
  }
  gitIn(dir, ['update-ref', 'refs/heads/main', head]);
  gitIn(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
}
const repo = join(tmp, 'repo');
buildRepo(repo, [
  ['root', 'root', '2026-09-01T00:00:00Z'],
  ['a', 'feature a', '2026-09-14T00:00:00Z', 'root'],
  ['m1', 'Merge pull request #11 from x/a', '2026-09-15T00:00:00Z', 'root', 'a'],
  ['b', 'feature b', '2026-10-02T12:00:00Z', 'm1'],
  ['m2', 'Merge pull request #12 from x/b', '2026-10-03T00:00:00Z', 'm1', 'b'],
  ['c', 'feature c', '2026-10-04T00:00:00Z', 'm2'],
  ['m3', 'Merge pull request #13 from x/c', '2026-10-05T00:00:00Z', 'm2', 'c'],
  ['sq', 'Merge pull request #99 from x/z', '2026-10-06T00:00:00Z', 'm3'],
  ['d', 'feature d', '2026-10-06T12:00:00Z', 'sq'],
  ['mb', "Merge branch 'topic'", '2026-10-07T00:00:00Z', 'sq', 'd'],
]);
const bare = join(tmp, 'bare');
buildRepo(bare, [['root', 'root', '2026-09-01T00:00:00Z'], ['next', 'next', '2026-10-03T00:00:00Z', 'root']]);
const prRun = (script_, extra, since = SINCE) => {
  const r = run(script_, ['--transcripts', win, ...(since ? ['--since', since] : []), '--json', ...extra]);
  return { ...r, rep: r.status === 0 ? JSON.parse(r.stdout) : null };
};
const pr = prRun(script, ['--cwd', repo]).rep?.perPr;
check('l. the cwd repo is the default; merges in the window are counted', pr?.mergedPrs === 2 && near(pr.leadUsd, 0.0204) && near(pr.totalUsd, 0.0252), JSON.stringify(pr));
check('l. lead and total USD divide by the merged PR count', near(pr?.leadUsdPerPr, 0.0102) && near(pr?.totalUsdPerPr, 0.0126), JSON.stringify(pr));
const prElsewhere = prRun(script, ['--repo', repo]).rep?.perPr;
check('l. --repo overrides the cwd project', prElsewhere?.mergedPrs === 2, JSON.stringify(prElsewhere));
check('l. without --since the whole history counts', prRun(script, ['--repo', repo], null).rep?.perPr?.mergedPrs === 3);
check('l. a later --since narrows the count', prRun(script, ['--repo', repo], '2026-10-04T00:00:00Z').rep?.perPr?.mergedPrs === 1);
const prNone = prRun(script, ['--repo', bare]).rep?.perPr;
check('l. a repo with no PR merge reports zero and no per-PR cost', prNone?.mergedPrs === 0 && prNone.leadUsdPerPr === null && prNone.totalUsdPerPr === null, JSON.stringify(prNone));
const prText = run(script, ['--transcripts', win, '--since', SINCE, '--repo', repo]).stdout;
check('l. the text report prints the per-PR table', /## Cost per merged PR[\s\S]*\| 2 \| \$0\.02 \| \$0\.03 \| \$0\.01 \| \$0\.01 \|/.test(prText), prText.slice(-700));
const prNoneText = run(script, ['--transcripts', win, '--since', SINCE, '--repo', bare]).stdout;
check('l. the text report says when no PR merged', /## Cost per merged PR\s+No PR merged in /.test(prNoneText), prNoneText.slice(-500));
const prAbsent = prRun(script, ['--repo', join(tmp, 'no-such-repo')]);
check('l. a path that is not a git repository skips the section and still exits 0', prAbsent.status === 0 && prAbsent.rep?.perPr === null && /not a readable git repository/.test(prAbsent.rep?.perPrNote ?? ''), prAbsent.stderr);
const home = join(tmp, 'home');
writeLines(join(home, '.claude', 'projects', 'p1', 'w1.jsonl'), readFileSync(join(win, 'w1.jsonl'), 'utf8').trim().split('\n'));
const allRun = spawnSync(process.execPath, [script, '--all', '--since', SINCE, '--json', '--repo', repo], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
const allRep = allRun.status === 0 ? JSON.parse(allRun.stdout) : null;
check('l. --all skips the section with one line naming the reason', allRep?.perPr === null && /needs a single project/.test(allRep?.perPrNote ?? '') && allRep.files === 1, allRun.stderr || allRun.stdout.slice(0, 300));

// m. Context columns. f1 holds five assistant turns by input side: x1 300,000 (over), x2 exactly 250,000
//    (not over), x3 streamed twice (first 6, then 260,000: the per-field max puts it over), x4 100,000.
//    f2 is a fork: it repeats x1 and the boundary b1, then adds x5 at 260,000 (over) and boundary b3.
//    Over 250K turns: x1, x3, x5 = 3. Boundaries by uuid: b1, b2, b3 = 3.
const boundaryRow = (uuid) => JSON.stringify({ type: 'system', subtype: 'compact_boundary', uuid, timestamp: new Date(clock += 1000).toISOString(), content: 'Conversation compacted' });
const ctxDir = join(tmp, 'ctx');
const x1 = line('x1', OPUS, usage(100000, 150000, 50000, 10));
writeLines(join(ctxDir, 'f1.jsonl'), [
  x1, boundaryRow('b1'),
  line('x2', OPUS, usage(125000, 125000, 0, 5)),
  line('x3', OPUS, usage(1, 2, 3, 4)), line('x3', OPUS, usage(100000, 160000, 0, 4)),
  boundaryRow('b2'), line('x4', OPUS, usage(100000, 0, 0, 1)),
]);
writeLines(join(ctxDir, 'f2.jsonl'), [x1, boundaryRow('b1'), line('x5', OPUS, usage(260000, 0, 0, 1)), boundaryRow('b3')]);
const ctxRun = json(script, ctxDir);
const ctxLead = ctxRun.rep?.context.find((c) => c.group === 'lead');
check('m. turns with an input side over 250,000 are counted once per message id', ctxLead?.over250kTurns === 3, JSON.stringify(ctxLead));
check('m. compact_boundary rows are counted once per uuid across files', ctxLead?.compactions === 3, JSON.stringify(ctxLead));
check('m. the existing context fields are unchanged', ctxLead?.threads === 2 && ctxLead.peakMax === 300000 && ctxLead.overStep === 2, JSON.stringify(ctxLead));
check('m. the text table appends both columns after the existing ones', /\| Over 100K \| Over 250K turns \| Compactions \|/.test(run(script, ['--transcripts', ctxDir]).stdout));

// Mutation controls for k, l, and m. Each cuts one line; the matching assertions must fail.
const mutate = (name, target, replacement) => {
  check(`mutation target exists: ${name}`, source.includes(target));
  writeFileSync(join(mutantDir, 'transcript-lib.mjs'), libSource);
  writeFileSync(join(mutantDir, 'cost-split.mjs'), source.replace(target, replacement));
  return join(mutantDir, 'cost-split.mjs');
};
const keepAll = mutate('window test', 'const inWindow = (stamp, sinceMs) => stamp === null || stamp >= sinceMs;', 'const inWindow = () => true;');
const keepAllLead = row(winRun(keepAll).rep ?? { rows: [] }, 'lead', OPUS);
check('mutation: keeping pre-window messages inflates the lead row', keepAllLead?.input === 8107 && !near(keepAllLead.usd, 0.0204), JSON.stringify(keepAllLead));
const dropUntimed = mutate('untimestamped inheritance', 'if (r.stamp !== null) current = r.stamp;', 'current = r.stamp;');
const dropRep = winRun(dropUntimed).rep;
check('mutation: an untimestamped line that does not follow the last timestamp changes the lead row', row(dropRep ?? { rows: [] }, 'lead', OPUS)?.input !== 2100, JSON.stringify(row(dropRep ?? { rows: [] }, 'lead', OPUS)));
const anyMerge = mutate('merge-only log', "'--merges', ", '');
check('mutation: counting one-parent commits miscounts the merged PRs', prRun(anyMerge, ['--cwd', repo]).rep?.perPr?.mergedPrs === 3, JSON.stringify(prRun(anyMerge, ['--cwd', repo]).rep?.perPr));
const offByOne = mutate('PR count', '.filter(Boolean)).size', '.filter(Boolean)).size + 1');
check('mutation: an off-by-one count fails the merged PR assertion', prRun(offByOne, ['--cwd', repo]).rep?.perPr?.mergedPrs === 3);
const noThreshold = mutate('250K threshold', 'export const OVER_TURN = 250000;', 'export const OVER_TURN = 25000000;');
check('mutation: a raised threshold misses the over-250K turns', json(noThreshold, ctxDir).rep?.context.find((c) => c.group === 'lead')?.over250kTurns === 0);
const noBoundary = mutate('boundary test', 'if (isBoundary(o)) {', 'if (false) {');
check('mutation: ignoring compact_boundary misses the compactions', json(noBoundary, ctxDir).rep?.context.find((c) => c.group === 'lead')?.compactions === 0);
const noUuid = mutate('boundary dedupe', 'if (seenBoundaries.has(o.uuid)) continue;', '');
check('mutation: no uuid dedupe counts the forked boundary twice', json(noUuid, ctxDir).rep?.context.find((c) => c.group === 'lead')?.compactions === 4);

rmSync(tmp,{ recursive: true, force: true });
if (fails.length) {
  console.error(`\n${fails.length} check(s) failed:\n- ${fails.join('\n- ')}`);
  process.exit(1);
}
console.log('\ncost-split eval: all checks pass');
