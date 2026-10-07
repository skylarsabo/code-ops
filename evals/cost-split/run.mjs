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
//   g.   DEC-6. The script keeps its own table: it does not import model-tiers.mjs, and
//        `PROVIDER_PRICES` gains no Anthropic key, which would change the opencode distribution.
//
// MUTATION CONTROL. A copy of the script that prices an unknown id at the Opus rate (the family
// alias V-REF found) runs on the same fixture. The unpriced assertions must fail on it.
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

rmSync(tmp, { recursive: true, force: true });
if (fails.length) {
  console.error(`\n${fails.length} check(s) failed:\n- ${fails.join('\n- ')}`);
  process.exit(1);
}
console.log('\ncost-split eval: all checks pass');
