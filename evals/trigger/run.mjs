#!/usr/bin/env node
// Skill-trigger harness regression eval: the logic only, with no model call and no network.
//
//   node evals/trigger/run.mjs   (exit 0 = pass)
//
// Covers query-set validation (fail closed), stream-json trigger detection on recorded
// transcripts, the seeded stratified split, scoring, the run loop (a capped session is a non-fire,
// any other error fails), env scrubbing, and the spawn builder.
// The model-in-the-loop runner is evals/trigger/trigger.mjs; it is never a merge gate.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tally } from '../harness.mjs';
import { buildSpawn, resolveClaude, scrubEnv, sessionEnv } from './lib/env.mjs';
import { claudeArgs } from './lib/claude.mjs';
import { parseQuerySet } from './lib/queries.mjs';
import { renderMarkdown, sameSkill, scoreResults } from './lib/score.mjs';
import { stratifiedSplit } from './lib/split.mjs';
import { createDetector, detectTranscript } from './lib/stream.mjs';
import { assertNoAnswerKeys, findAnswerKeys, makeSessionCopy, withSessionCopy } from './lib/target.mjs';
import { collectRuns, DEFAULT_TARGET, parseArgs } from './trigger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { fails, check } = tally();
const fixture = (n) => readFileSync(join(HERE, 'fixtures', n), 'utf8');
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

// ---- query-set parsing ----------------------------------------------------------------------
const S = 'researcher:research-verify';
const good = { skill: S, queries: [
  { query: 'verify x', expect: S, stratum: 'p' },
  { query: 'design y', expect: 'researcher:research-spike', stratum: 'n' },
  { query: 'hello', expect: 'none', stratum: 'u' },
] };
const parse = (o) => parseQuerySet(typeof o === 'string' ? o : JSON.stringify(o));
const mutate = (fn) => { const c = JSON.parse(JSON.stringify(good)); fn(c); return c; };
check('queries: a valid set parses', parse(good).queries.length === 3);
check('queries: the shipped research-verify set parses and is balanced', (() => {
  const set = parseQuerySet(readFileSync(join(HERE, 'queries', 'research-verify.json'), 'utf8'));
  const pos = set.queries.filter((q) => q.expect === set.skill).length;
  return set.queries.length >= 18 && pos >= 8 && set.queries.length - pos >= 8;
})());
check('queries: invalid JSON throws', throws(() => parse('{nope')));
check('queries: a non-object throws', throws(() => parse('[]')));
check('queries: a bad skill id throws', throws(() => parse(mutate((c) => { c.skill = 'research-verify'; }))));
check('queries: empty queries throws', throws(() => parse(mutate((c) => { c.queries = []; }))));
check('queries: an empty query text throws', throws(() => parse(mutate((c) => { c.queries[0].query = '  '; }))));
check('queries: a bad expect throws', throws(() => parse(mutate((c) => { c.queries[1].expect = 'sibling'; }))));
check('queries: a missing stratum throws', throws(() => parse(mutate((c) => { delete c.queries[0].stratum; }))));
check('queries: a duplicate query throws', throws(() => parse(mutate((c) => { c.queries[1].query = 'verify x'; }))));
check('queries: no positive throws', throws(() => parse(mutate((c) => { c.queries[0].expect = 'none'; }))));
check('queries: no negative throws', throws(() => parse(mutate((c) => { c.queries = [c.queries[0]]; }))));

// ---- stream-json detection ------------------------------------------------------------------
{
  const r = detectTranscript(fixture('skill-first.jsonl'));
  check('stream: Skill first is detected', r.skill === 'researcher:research-verify' && r.toolsBefore.length === 0, JSON.stringify(r));
  check('stream: detection stops before the later result event', r.costUsd === null);
}
{
  const r = detectTranscript(fixture('no-skill.jsonl'));
  check('stream: no Skill gives null and reads the cost', r.skill === null && r.costUsd === 0.03, JSON.stringify(r));
}
{
  const r = detectTranscript(fixture('skill-after-tools.jsonl'));
  check('stream: Skill after other tools is still the first Skill', r.skill === 'researcher:research-spike' && r.toolsBefore.join() === 'Grep,Read', JSON.stringify(r));
}
{
  const r = detectTranscript(fixture('malformed-lines.jsonl'));
  check('stream: malformed lines are skipped and counted', r.skill === 'library-eval' && r.malformed === 3, JSON.stringify(r));
}
check('stream: a namespaced id from another plugin is kept whole', detectTranscript(fixture('namespaced.jsonl')).skill === 'code-ops-suite:mech');
check('stream: an error result is recorded', detectTranscript(fixture('error-result.jsonl')).error === 'Credit balance is too low');
check('stream: an error result that is not the cap is not capped', detectTranscript(fixture('error-result.jsonl')).capped === false);
{
  const r = detectTranscript(fixture('budget-capped.jsonl'));
  check('stream: a budget-capped result is capped with no skill and its cost', r.capped === true && r.skill === null && r.costUsd === 0.5093 && r.toolsBefore.join() === 'Read', JSON.stringify(r));
}
check('stream: a leading slash is stripped', (() => {
  const d = createDetector();
  d.feed('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"/researcher:research-verify"}}]}}');
  return d.state.skill === 'researcher:research-verify';
})());
check('stream: a non-Skill tool named in text is not a trigger', detectTranscript('{"type":"assistant","message":{"content":[{"type":"text","text":"Skill researcher:x"}]}}').skill === null);
check('stream: a Skill block without an id is ignored', detectTranscript('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{}}]}}').skill === null);
check('stream: CRLF line endings parse', detectTranscript(fixture('skill-first.jsonl').replace(/\n/g, '\r\n')).skill === 'researcher:research-verify');

// ---- stratified split -----------------------------------------------------------------------
{
  const qs = [];
  for (let i = 0; i < 10; i++) qs.push({ query: `p${i}`, expect: S, stratum: 'pos' });
  for (let i = 0; i < 10; i++) qs.push({ query: `n${i}`, expect: 'none', stratum: 'neg' });
  qs.push({ query: 'solo', expect: 'none', stratum: 'one' });
  const a = stratifiedSplit(qs, { seed: 7, testFraction: 0.4 });
  const b = stratifiedSplit(qs.slice().reverse(), { seed: 7, testFraction: 0.4 });
  const names = (x) => x.map((q) => q.query).sort().join();
  check('split: deterministic and independent of input order', names(a.test) === names(b.test) && names(a.train) === names(b.train));
  check('split: partitions every query exactly once', a.train.length + a.test.length === qs.length && new Set([...a.train, ...a.test].map((q) => q.query)).size === qs.length);
  check('split: stratified (4 of 10 per large stratum in test)', ['pos', 'neg'].every((s) => a.test.filter((q) => q.stratum === s).length === 4));
  check('split: a one-query stratum stays in train', a.train.some((q) => q.query === 'solo'));
  check('split: a different seed changes the test set', names(stratifiedSplit(qs, { seed: 8, testFraction: 0.4 }).test) !== names(a.test));
  check('split: a bad fraction throws', throws(() => stratifiedSplit(qs, { testFraction: 2 })));
}

// ---- scoring --------------------------------------------------------------------------------
{
  const runs = (...skills) => skills.map((skill) => ({ skill, costUsd: skill ? null : 0.5 }));
  const t = scoreResults(S, [
    { query: 'a', expect: S, stratum: 'pos', runs: runs(S, null, 'research-verify') },
    { query: 'b', expect: 'researcher:research-spike', stratum: 'sib', runs: runs('researcher:research-spike', S, 'researcher:library-eval') },
    { query: 'c', expect: 'none', stratum: 'none', runs: runs(null, S) },
  ]);
  check('score: hit rate counts namespaced and bare ids', t.hits === 2 && t.positiveRuns === 3 && Math.abs(t.hitRate - 2 / 3) < 1e-9, JSON.stringify(t));
  check('score: false fires exclude the expected sibling', t.falseFires === 3 && t.negativeRuns === 5, JSON.stringify(t));
  check('score: false fires are tallied by the skill that fired', t.falseFiresBySibling[S] === 2 && t.falseFiresBySibling['researcher:library-eval'] === 1, JSON.stringify(t.falseFiresBySibling));
  check('score: cost sums only the numeric costs', t.totalCostUsd === 1 && t.runs === 8);
  check('score: stratum correctness', t.byStratum.pos.correct === 2 && t.byStratum.sib.correct === 1 && t.byStratum.none.correct === 1, JSON.stringify(t.byStratum));
  check('score: no costs gives null', scoreResults(S, [{ query: 'a', expect: S, stratum: 'p', runs: [{ skill: S, costUsd: null }] }]).totalCostUsd === null);
  check('score: sameSkill does not match a different namespace', !sameSkill('other:research-verify', S) && sameSkill('research-verify', S) && !sameSkill(null, S));
  check('score: markdown carries the skill and rates', (() => { const m = renderMarkdown(t); return m.includes(S) && m.includes('67%'); })());
  check('score: no capped run gives a zero count', t.cappedRuns === 0);
  const c = scoreResults(S, [
    { query: 'a', expect: S, stratum: 'pos', runs: [{ skill: null, costUsd: 0.5, capped: true }, { skill: S, costUsd: null }] },
    { query: 'b', expect: 'none', stratum: 'none', runs: [{ skill: null, costUsd: 0.25, capped: true }] },
  ]);
  check('score: a capped run counts as a non-fire with its cost', c.cappedRuns === 2 && c.hits === 1 && c.positiveRuns === 2 && c.falseFires === 0 && c.byStratum.none.correct === 1 && c.totalCostUsd === 0.75, JSON.stringify(c));
  check('score: markdown reports the capped count and marks a capped run', (() => {
    const m = renderMarkdown(c, { detail: [{ query: 'b', expect: 'none', runs: [{ skill: null, costUsd: 0.25, capped: true }] }] });
    return m.includes('Capped runs (no skill)') && m.includes('| 2 |') && m.includes('none (capped)');
  })());
}

// ---- run loop -------------------------------------------------------------------------------
{
  const qs = [{ query: 'q1', expect: 'none', stratum: 'a' }, { query: 'q2', expect: S, stratum: 'b' }];
  const fake = (outcomes) => {
    let i = 0;
    const seen = [];
    return { seen, run: async (q) => { seen.push(q.query); return outcomes[i++] ?? { skill: null, costUsd: 0.01, toolsBefore: [], error: null, capped: false }; } };
  };
  const quiet = () => {};
  const capped = { skill: null, costUsd: 0.51, toolsBefore: ['Read'], error: 'error_max_budget_usd', capped: true };
  const a = fake([capped, { skill: null, costUsd: 0.02, toolsBefore: [], error: null, capped: false }, { skill: S, costUsd: null, toolsBefore: [], error: null, capped: false }]);
  const ra = await collectRuns(qs, 2, a.run, quiet);
  check('loop: a capped run is recorded as a non-fire and the loop continues', ra.failure === null && a.seen.join() === 'q1,q1,q2,q2' && ra.results.length === 2
    && JSON.stringify(ra.results[0].runs[0]) === JSON.stringify({ skill: null, costUsd: 0.51, toolsBefore: ['Read'], capped: true }) && ra.results[1].runs[0].skill === S, JSON.stringify(ra));
  check('loop: an uncapped run carries no capped marker', !('capped' in ra.results[0].runs[1]));
  const b = fake([capped, { skill: null, costUsd: 0.1, toolsBefore: [], error: 'Credit balance is too low', capped: false }]);
  const rb = await collectRuns(qs, 2, b.run, quiet);
  check('loop: any other error still fails and stops the loop', /Credit balance is too low/.test(rb.failure ?? '') && b.seen.join() === 'q1,q1' && rb.results.length === 1 && rb.results[0].runs.length === 1, JSON.stringify(rb));
  const c = fake([{ skill: null, costUsd: null, toolsBefore: [], error: 'timeout', capped: false }]);
  const rc = await collectRuns(qs, 2, c.run, quiet);
  check('loop: a timeout is not treated as capped', rc.failure?.includes('timeout') === true && rc.results.length === 0 && c.seen.length === 1);
}

// ---- env scrubbing and spawn ----------------------------------------------------------------
{
  const out = scrubEnv({ CLAUDECODE: '1', claudecode: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', claude_code_ssse_port: '1', CLAUDE_AGENT_SDK_VERSION: '1',
    CLAUDE_CODE_OAUTH_TOKEN: 'tok', ANTHROPIC_API_KEY: 'k', PATH: 'p', Path: 'q', CLAUDECODEX: 'keep' });
  check('env: session variables are removed case-insensitively', !('CLAUDECODE' in out) && !('claudecode' in out) && !('CLAUDE_CODE_ENTRYPOINT' in out) && !('claude_code_ssse_port' in out) && !('CLAUDE_AGENT_SDK_VERSION' in out), Object.keys(out).join());
  check('env: auth variables survive', out.CLAUDE_CODE_OAUTH_TOKEN === 'tok' && out.ANTHROPIC_API_KEY === 'k');
  check('env: unrelated variables survive, including a near-miss name', out.PATH === 'p' && out.Path === 'q' && out.CLAUDECODEX === 'keep');
  check('env: the input is not mutated', (() => { const e = { CLAUDECODE: '1' }; scrubEnv(e); return e.CLAUDECODE === '1'; })());
}
{
  const exists = (p) => p.endsWith('claude.cmd');
  check('spawn: win32 resolves a .cmd shim from a case-variant Path key', resolveClaude({ Path: 'C:\\x;C:\\y' }, 'win32', exists)?.endsWith('claude.cmd') === true);
  check('spawn: a missing binary resolves to null', resolveClaude({ PATH: '/a' }, 'linux', () => false) === null);
  const exe = buildSpawn('C:\\bin\\claude.exe', ['-p', '--plugin-dir', 'C:\\r\\plugins\\a']);
  check('spawn: an .exe runs directly without a shell', exe.command === 'C:\\bin\\claude.exe' && !exe.shim);
  const shim = buildSpawn('C:\\bin\\claude.cmd', ['-p', '--max-budget-usd', '0.5']);
  check('spawn: a .cmd shim runs through cmd.exe /c', shim.command === 'cmd.exe' && shim.args.slice(0, 4).join(' ') === '/d /s /c C:\\bin\\claude.cmd' && shim.shim);
  check('spawn: the shim refuses shell metacharacters in an argument', ['a&calc', 'a|b', 'a"b', 'a b', '%PATH%', 'a^b', 'a\nb'].every((a) => throws(() => buildSpawn('C:\\bin\\claude.cmd', [a]))));
  const args = claudeArgs({ pluginDirs: ['/p/a', '/p/b'], budgetUsd: 0.5, settingSources: 'project' });
  check('spawn: arguments carry the cap, stream-json, and one plugin-dir each', args.join(' ').includes('--max-budget-usd 0.5') && args.includes('stream-json') && args.filter((a) => a === '--plugin-dir').length === 2);
  check('spawn: the query is never an argument', !claudeArgs({ pluginDirs: [], budgetUsd: 1 }).some((a) => a.includes('query')));
}

// ---- session environment ------------------------------------------------------------------------
check('env: the session env turns the routing card off', sessionEnv({ PATH: 'p' }).CODE_OPS_ROUTING_CARD === 'off');
check('env: the session env overrides an ambient routing card and still scrubs', (() => {
  const e = sessionEnv({ CODE_OPS_ROUTING_CARD: 'on', CLAUDECODE: '1', PATH: 'p' });
  return e.CODE_OPS_ROUTING_CARD === 'off' && !('CLAUDECODE' in e) && e.PATH === 'p';
})());
check('env: the session env turns the routing card on when asked and still scrubs', (() => {
  const e = sessionEnv({ CODE_OPS_ROUTING_CARD: 'off', CLAUDECODE: '1', PATH: 'p' }, 'on');
  return e.CODE_OPS_ROUTING_CARD === 'on' && !('CLAUDECODE' in e) && e.PATH === 'p';
})());
check('env: scrubEnv keeps CODE_OPS_ROUTING_CARD', scrubEnv({ CODE_OPS_ROUTING_CARD: 'off' }).CODE_OPS_ROUTING_CARD === 'off');

// ---- per-session target copy ----------------------------------------------------------------------
{
  const scratch = mkdtempSync(join(tmpdir(), 'trigger-eval-'));
  try {
    const src = join(scratch, 'src');
    const put = (rel, text = 'x') => { const p = join(src, ...rel.split('/')); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };
    put('src/a.js'); put('LICENSE'); put('PROVENANCE.md'); put('ANSWER_KEY.seeds/s.json'); put('ANSWER_KEY.changes'); put('test/answer_key.oracles');
    put('deep/ANSWER_KEY.x/y.txt'); put('node_modules/m/i.js');
    const copy = makeSessionCopy(src);
    try {
      check('target: a planted answer key is left out of the copy', findAnswerKeys(copy).length === 0 && !existsSync(join(copy, 'ANSWER_KEY.seeds')) && !existsSync(join(copy, 'test', 'answer_key.oracles')) && !existsSync(join(copy, 'deep', 'ANSWER_KEY.x')));
      check('target: source code and LICENSE are copied, PROVENANCE.md and node_modules are not', existsSync(join(copy, 'src', 'a.js')) && existsSync(join(copy, 'LICENSE')) && !existsSync(join(copy, 'PROVENANCE.md')) && !existsSync(join(copy, 'node_modules')));
      writeFileSync(join(copy, 'ANSWER_KEY.late'), 'x');
      check('target: the fail-closed check throws when an answer key is in a copy', throws(() => assertNoAnswerKeys(copy)) && findAnswerKeys(copy).join() === 'ANSWER_KEY.late');
    } finally { rmSync(copy, { recursive: true, force: true }); }

    const a = makeSessionCopy(src);
    const b = makeSessionCopy(src);
    try {
      writeFileSync(join(a, 'src', 'a.js'), 'changed');
      check('target: each session gets its own copy', a !== b && readFileSync(join(b, 'src', 'a.js'), 'utf8') === 'x' && readFileSync(join(src, 'src', 'a.js'), 'utf8') === 'x');
    } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }

    let seen = null;
    await withSessionCopy(src, async (dir) => { seen = dir; });
    check('target: the copy is removed after the session', seen !== null && !existsSync(seen));
    let failed = null;
    try { await withSessionCopy(src, async (dir) => { failed = dir; throw new Error('killed'); }); } catch { /* expected */ }
    check('target: the copy is removed when the session throws', failed !== null && !existsSync(failed));
    let locked = null;
    const eperm = () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); };
    const warn = console.warn;
    console.warn = () => {};
    let result;
    try { result = await withSessionCopy(src, async (dir) => { locked = dir; return 'done'; }, eperm); } finally { console.warn = warn; }
    check('target: a copy that cannot be removed is left behind without ending the run', result === 'done' && locked !== null && existsSync(locked));
    if (locked) rmSync(locked, { recursive: true, force: true });
  } finally { rmSync(scratch, { recursive: true, force: true }); }

  const real = makeSessionCopy(DEFAULT_TARGET);
  try {
    check('target: the default copy has the hyparquet source and no answer key or provenance', existsSync(join(real, 'src', 'bloom.js')) && existsSync(join(real, 'LICENSE')) && !existsSync(join(real, 'PROVENANCE.md')) && findAnswerKeys(real).length === 0);
  } finally { rmSync(real, { recursive: true, force: true }); }
  check('target: a missing source throws before any copy is kept', throws(() => makeSessionCopy(join(tmpdir(), 'trigger-no-such-target'))));
}

// ---- argument parsing -----------------------------------------------------------------------
check('args: defaults and required flags', (() => { const o = parseArgs(['--queries', 'q.json', '--out', 'o']); return o.runs === 3 && o.split === 'all' && o.budget === 0.5; })());
check('args: --target is optional and takes a folder', parseArgs(['--queries', 'q', '--out', 'o']).target === null && parseArgs(['--queries', 'q', '--out', 'o', '--target', 'd']).target === 'd');
check('args: --routing-card defaults to off and takes on', parseArgs(['--queries', 'q', '--out', 'o']).routingCard === 'off' && parseArgs(['--queries', 'q', '--out', 'o', '--routing-card', 'on']).routingCard === 'on');
check('args: a bad --routing-card throws', throws(() => parseArgs(['--queries', 'q', '--out', 'o', '--routing-card', 'yes'])));
check('score: markdown records the routing card state', renderMarkdown(scoreResults(S, []), { split: 'all', seed: 1, runsPerQuery: 3, routingCard: 'on' }).includes('routing card on'));
check('args: a missing --out throws', throws(() => parseArgs(['--queries', 'q.json'])));
check('args: an unknown flag throws', throws(() => parseArgs(['--queries', 'q', '--out', 'o', '--x'])));
check('args: a bad number throws', throws(() => parseArgs(['--queries', 'q', '--out', 'o', '--runs', '0'])));
check('args: a bad split throws', throws(() => parseArgs(['--queries', 'q', '--out', 'o', '--split', 'dev'])));

if (fails.length) {
  console.error(`\nFAIL — trigger eval: ${fails.length} failing check(s)`);
  for (const f of fails) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('PASS — trigger eval: the harness parses fail-closed, detects the first Skill, splits deterministically, scores, records a capped session as a non-fire, scrubs the env, copies the target without answer keys per session, and refuses unsafe shim arguments.');
