#!/usr/bin/env node
// Context-audit regression eval — pins the transcript parser (scripts/transcript-lib.mjs), the
// CLI (scripts/context-audit.mjs), and the SessionEnd receipt hook
// (plugins/code-ops-suite/hooks/session-receipt.mjs) against a synthetic fixture:
//   - usage repeated across the lines of one assistant message is counted ONCE, as the per-field
//     MAX (the fixture's duplicate lines carry differing partial counts, so first-wins, last-wins,
//     and naive sums all fail);
//   - tool results are attributed to their tool, subagent threads are summed apart from main;
//   - `cd <dir> &&` prefixes are stripped from Bash families; repeat reads are counted;
//   - a non-JSON line is skipped, never fatal; sanitized output carries no fixture path,
//     `--raw` does; `--json` parses;
//   - the hook appends exactly one v1 row to $CODE_OPS_RECEIPTS with the same token totals,
//     and exits 0 with no row on garbage stdin or a missing transcript;
//   - the row carries the handoff arm, the highest band the session's marker reached, and
//     whether the transcript shows a /code-ops-suite:handoff call; a row without those fields
//     still aggregates under `--by-arm`;
//   - context shape (fixture-shape): per-turn context bands, the first and max context of a
//     thread, a cache-rewrite turn, the agent type read from a sibling `.meta.json` (a malformed
//     one reads as `unknown`), the three rendered sections, and `--all` across project directories.
//
//   node evals/context-audit/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { summarizeTranscript, mergeSummaries, normalizeUsage, subagentFilesFor, measurementTranscriptFor, projectSlug } from '../../scripts/transcript-lib.mjs';
import { tally } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const cli = join(root, 'scripts', 'context-audit.mjs');
const hook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'session-receipt.mjs');
const fixture = join(here, 'fixture');
const mainFile = join(fixture, 'sess-1.jsonl');

const { fails, expect } = tally();
const run = (args, opts = {}) => spawnSync('node', args, { encoding: 'utf8', ...opts });

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n');
const codexUsage = (input, read, write, output, thinking) => ({ input_tokens: input, cached_input_tokens: read,
  cache_write_input_tokens: write, output_tokens: output, reasoning_output_tokens: thinking, total_tokens: input + output });
const codexRows = [
  { type: 'session_meta', payload: { cwd: root } },
  { type: 'turn_context', payload: { turn_id: 't1', model: 'codex-model-a' } },
  { type: 'response_item', payload: { type: 'message', id: 'm1', role: 'user', content: [{ type: 'input_text', text: 'request' }] } },
  { type: 'response_item', payload: { type: 'function_call', call_id: 'call1', name: 'exec_command', arguments: '{"cmd":"rg PRIVATEPATTERN"}' } },
  { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call1', output: 'tool result' } },
  { type: 'response_item', payload: { type: 'message', id: 'm2', role: 'assistant', content: [{ type: 'output_text', text: 'answer' }] } },
  { type: 'token_usage_record', payload: { response_id: 'r1', turn_id: 't1', usage: codexUsage(100, 40, 10, 20, 5) } },
  { type: 'token_usage_record', payload: { response_id: 'r1', turn_id: 't1', usage: codexUsage(100, 40, 10, 20, 5) } },
  { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: codexUsage(100, 40, 10, 20, 5), last_token_usage: codexUsage(100, 40, 10, 20, 5) } } },
  { type: 'turn_context', payload: { turn_id: 't2', model: 'codex-model-b' } },
  { type: 'token_usage_record', payload: { response_id: 'r2', turn_id: 't2', usage: codexUsage(200, 100, 20, 30, 8) } },
  { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: codexUsage(300, 140, 30, 50, 13), last_token_usage: codexUsage(200, 100, 20, 30, 8) } } },
];
const cx = summarizeTranscript(jsonl(codexRows));
expect(cx.normalizedUsage.input === 130 && cx.normalizedUsage.cacheRead === 140 && cx.normalizedUsage.cacheCreate === 30
  && cx.normalizedUsage.total === 350 && cx.normalizedUsage.thinking === 13, `Codex response dedup and disjoint input: ${JSON.stringify(cx.normalizedUsage)}`);
expect(cx.usageByModel['codex-model-a']?.total === 120 && cx.usageByModel['codex-model-b']?.total === 230, 'Codex model attribution joins turn_id');
expect(cx.messages.user === 1 && cx.messages.assistant === 1 && cx.toolCalls.exec_command === 1
  && cx.toolResultChars.exec_command === 11 && cx.textChars.assistant === 6 && cx.contextAtEnd === 200, 'Codex content and tool attribution');
expect(!JSON.stringify(cx.largest).includes('PRIVATEPATTERN'), 'Codex sanitized labels exclude tool arguments');
const legacyRows = codexRows.filter((r) => r.type !== 'token_usage_record');
legacyRows.push(legacyRows.at(-1));
const legacy = summarizeTranscript(jsonl(legacyRows));
expect(legacy.normalizedUsage.total === 350 && legacy.usageByModel.UNKNOWN?.total === 350,
  'Codex cumulative counters dedup without inventing per-model attribution');
const absent = normalizeUsage({ input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, total_tokens: 120 }, 'codex');
expect(absent.input === 'UNKNOWN' && absent.cacheCreate === 'UNKNOWN' && absent.thinking === 'UNKNOWN'
  && absent.total === 120, 'missing Codex categories UNKNOWN, independently reported total retained');
expect(normalizeUsage({ input_tokens: -1, output_tokens: 0 }).input === 'UNKNOWN', 'invalid telemetry is UNKNOWN');
const partial = summarizeTranscript(jsonl([
  { type: 'token_usage_record', payload: { response_id: 'partial', usage: codexUsage(100, 40, 10, 20, 5) } },
  { type: 'token_usage_record', payload: { response_id: 'partial', usage: codexUsage(100, 50, 10, 30, 8) } },
]));
expect(partial.normalizedUsage.input === 40 && partial.normalizedUsage.cacheRead === 50
  && partial.normalizedUsage.total === 130, 'Codex partial-response maxima apply before subtracting cached categories');
const grokUsage = (inputTokens, cachedReadTokens, cacheCreationTokens, outputTokens, reasoningTokens, modelCalls) => ({
  inputTokens, cachedReadTokens, cacheCreationTokens, outputTokens, reasoningTokens,
  totalTokens: inputTokens + outputTokens, modelCalls,
  modelUsage: { 'grok-model-a': { inputTokens, cachedReadTokens, cacheCreationTokens, outputTokens, reasoningTokens, totalTokens: inputTokens + outputTokens, modelCalls } },
});
const grok = summarizeTranscript(jsonl([
  { timestamp: 1000, method: '_x.ai/session/update', params: { sessionId: 'g1', update: { sessionUpdate: 'turn_completed', prompt_id: 'p1', usage: grokUsage(100, 70, 10, 10, 4, 1) } } },
  { timestamp: 1001, method: '_x.ai/session/update', params: { sessionId: 'g1', update: { sessionUpdate: 'turn_completed', prompt_id: 'p1', usage: grokUsage(150, 100, 10, 20, 6, 2) } } },
  { timestamp: 1002, method: '_x.ai/session/update', params: { sessionId: 'g1', update: { sessionUpdate: 'turn_completed', prompt_id: 'p2', usage: grokUsage(50, 20, 0, 10, 2, 1) } } },
]));
expect(grok.normalizedUsage.input === 70 && grok.normalizedUsage.cacheRead === 120
  && grok.normalizedUsage.cacheCreate === 10 && grok.normalizedUsage.output === 30
  && grok.normalizedUsage.thinking === 8 && grok.normalizedUsage.total === 230,
`Grok cumulative snapshots deduplicate per prompt: ${JSON.stringify(grok.normalizedUsage)}`);
expect(grok.usageByModel['grok-model-a']?.total === 230 && grok.models['grok-model-a'] === 3
  && grok.hosts.grok === 2 && grok.contextAtEnd === 50 && grok.durationMs === 2000,
`Grok model, prompt, context, and numeric timestamp accounting: ${JSON.stringify(grok)}`);
const noTelemetry = summarizeTranscript(jsonl([{ type: 'response_item', payload: { type: 'message', id: 'no-usage', role: 'assistant', content: [] } }]));
expect(noTelemetry.normalizedUsage.total === 'UNKNOWN', 'Codex assistant without usage telemetry is UNKNOWN');
const merged = mergeSummaries([cx, summarizeTranscript(jsonl([{ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, total_tokens: 120 } } } }]))]);
expect(merged.normalizedUsage.total === 470 && merged.normalizedUsage.thinking === 'UNKNOWN', 'merged normalized totals retain UNKNOWN categories');
const codexDir = mkdtempSync(join(tmpdir(), 'ca-codex-'));
const dated = join(codexDir, '2026', '09', '01');
mkdirSync(dated, { recursive: true });
appendFileSync(join(dated, 'one.jsonl'), jsonl(codexRows));
appendFileSync(join(dated, 'other.jsonl'), jsonl([{ type: 'session_meta', payload: { cwd: codexDir } }, ...codexRows.slice(1)]));
const codexCli = run([cli, '--host', 'codex', '--transcripts', codexDir, '--cwd', root, '--json']);
try {
  const c = JSON.parse(codexCli.stdout);
  expect(codexCli.status === 0 && c.files === 1 && c.all.normalizedUsage.total === 350, 'Codex CLI discovers date directories and filters by session metadata cwd');
  expect(!codexCli.stdout.includes(root) && !codexCli.stdout.includes('PRIVATEPATTERN'), 'Codex CLI omits cwd and tool arguments');
} catch { fails.push('Codex CLI JSON must parse'); }
const codexAll = run([cli, '--host', 'codex', '--transcripts', codexDir, '--all', '--json']);
expect(codexAll.status === 0 && JSON.parse(codexAll.stdout || '{}').files === 2, 'Codex CLI --all explicitly includes other projects');
expect(run([cli, '--host', 'unsupported']).status === 2, 'unsupported host exits 2');
rmSync(codexDir, { recursive: true, force: true });

// Codex stores child rollouts beside the parent, linked by session_meta parent_thread_id.
const codexLinkDir = mkdtempSync(join(tmpdir(), 'ca-codex-links-'));
const linkedUsage = (id, parent, n) => jsonl([
  { type: 'session_meta', payload: { id, ...(parent ? { parent_thread_id: parent, source: { subagent: { thread_spawn: { parent_thread_id: parent } } } } : {}) } },
  { type: 'token_usage_record', payload: { response_id: `r-${id}`, usage: codexUsage(n, 0, 0, 1, 0) } },
]);
const codexParent = join(codexLinkDir, 'parent.jsonl');
appendFileSync(codexParent, linkedUsage('parent', null, 10));
appendFileSync(join(codexLinkDir, 'child.jsonl'), linkedUsage('child', 'parent', 20));
appendFileSync(join(codexLinkDir, 'grandchild.jsonl'), linkedUsage('grandchild', 'child', 30));
appendFileSync(join(codexLinkDir, 'unrelated.jsonl'), linkedUsage('unrelated', null, 40));
expect(subagentFilesFor(codexParent).map((f) => f.split(/[\\/]/).at(-1)).join(',') === 'child.jsonl,grandchild.jsonl',
  `Codex child graph includes descendants only: ${JSON.stringify(subagentFilesFor(codexParent))}`);

// Library-level assertions through the CLI's --json view.
const j = run([cli, '--transcripts', fixture, '--json']);
expect(j.status === 0, `--json should exit 0, got ${j.status}: ${j.stderr}`);
let agg = null;
try { agg = JSON.parse(j.stdout); } catch { fails.push('--json output must parse'); }
if (agg) {
  const m = agg.main, s = agg.subagents, a = agg.all;
  expect(agg.files === 2, `files should be 2 (main + subagent), got ${agg.files}`);
  expect(m.messages.assistant === 6, `main assistant messages deduped to 6, got ${m.messages.assistant}`);
  expect(m.messages.user === 1, `human turns counted without tool-result carriers: 1, got ${m.messages.user}`);
  expect(m.usage.input === 212, `main input tokens 100+50+50+1+1+10 = 212 once, got ${m.usage.input}`);
  expect(m.usage.cacheRead === 2402, `main cache read 300+600+700+1+1+800 = 2402, got ${m.usage.cacheRead}`);
  expect(m.usage.cacheCreate === 200, `main cache create is the per-field max (200, not 150 or 350), got ${m.usage.cacheCreate}`);
  expect(m.usage.output === 107, `main output max(40,60)+20+20+1+1+5 = 107, got ${m.usage.output}`);
  expect(m.usage.thinking === 10, `main thinking 10 once, got ${m.usage.thinking}`);
  expect(m.usage.total === 212 + 2402 + 200 + 107, `main total, got ${m.usage.total}`);
  expect(m.normalizedUsage.total === m.usage.total && m.normalizedUsage.thinking === 'UNKNOWN', 'Claude normalized totals match legacy; absent thinking telemetry stays UNKNOWN');
  expect(m.usageByModel['model-x']?.total === 1330 && m.usageByModel['model-y']?.total === 1591, 'Claude per-model usage deduplicates streamed chunks');
  expect(s.usage.input === 7 && s.usage.cacheCreate === 11 && s.usage.cacheRead === 13 && s.usage.output === 3, `subagent usage 7/11/13/3, got ${JSON.stringify(s.usage)}`);
  expect(a.usage.input === 219, `all input = 212 + 7, got ${a.usage.input}`);
  expect(m.models['model-x'] === 2 && m.models['model-y'] === 4, `main model mix x:2 y:4, got ${JSON.stringify(m.models)}`);
  expect(s.models['model-z'] === 1, `subagent model z:1, got ${JSON.stringify(s.models)}`);
  expect(m.toolCalls.Bash === 3 && m.toolCalls.Read === 2, `main tool calls Bash:3 Read:2, got ${JSON.stringify(m.toolCalls)}`);
  expect(m.toolResultChars.Bash === 39, `Bash result chars 32+4+3, got ${m.toolResultChars.Bash}`);
  expect(m.toolResultChars.Read === 36, `Read result chars 18*2 = 36, got ${m.toolResultChars.Read}`);
  expect(s.toolResultChars.Grep === 23, `subagent Grep chars 23, got ${s.toolResultChars.Grep}`);
  expect(a.toolResultCharsTotal === 39 + 36 + 23, `all tool result chars, got ${a.toolResultCharsTotal}`);
  expect(m.bashFamilies['git status'] === 32, `cd-prefix stripped family "git status" = 32, got ${JSON.stringify(m.bashFamilies)}`);
  expect(!('cd' in m.bashFamilies) && !Object.keys(m.bashFamilies).some((k) => k.startsWith('cd')), 'no "cd" family may survive');
  expect(m.bashFamilies['(script)'] === undefined && m.bashFamilies['node'] === 4, `a path-bearing command keys as its command word only, got ${JSON.stringify(m.bashFamilies)}`);
  expect(!Object.keys(m.bashFamilies).some((k) => /[./\\"']/.test(k)), `no family key may carry a path fragment, quote, or extension: ${JSON.stringify(Object.keys(m.bashFamilies))}`);
  expect(m.bashFamilies['rg'] === 3, `a command outside the subcommand allow-list keys as the bare word, got ${JSON.stringify(m.bashFamilies)}`);
  expect(Object.keys(m.bashFamilies).every((k) => /^(\(\w+\)|[A-Za-z][A-Za-z0-9-]*( [A-Za-z][A-Za-z0-9-]*)?)$/.test(k)), `family keys are one or two plain words: ${JSON.stringify(Object.keys(m.bashFamilies))}`);
  expect(m.largest.length >= 3 && m.largest[0].chars === 32 && m.largest[0].label === 'Bash git status' && m.largest.every((r, i) => i === 0 || m.largest[i - 1].chars >= r.chars), `largest is sorted descending with the 32-char Bash result first, got ${JSON.stringify(m.largest)}`);
  expect(m.repeatReads.paths === 1 && m.repeatReads.extraReads === 1 && m.repeatReads.extraChars === 18, `repeat reads 1/1/18, got ${JSON.stringify(m.repeatReads)}`);
  expect(m.textChars.thinking === 10 && m.textChars.assistant === 5, `text chars thinking 10 / assistant 4+1, got ${JSON.stringify(m.textChars)}`);
  expect(m.firstTs === '2026-09-01T10:00:00.000Z' && m.lastTs === '2026-09-01T10:10:00.000Z', `window, got ${m.firstTs}..${m.lastTs}`);
  expect(!/secret-file|patch-secret|private dir|C:\/repo|SECRETPATTERN|INTERNALHOST|SECRETNAME/.test(JSON.stringify(agg)), 'sanitized --json must not carry any fixture path, basename, pattern, host, or argument word');
  expect(agg.dir === undefined, 'sanitized --json must not carry the transcript dir');
}

// Markdown report: sanitized labels, exit 0.
const md = run([cli, '--transcripts', fixture]);
expect(md.status === 0, `markdown should exit 0, got ${md.status}`);
expect(/# Context audit/.test(md.stdout), 'markdown header');
expect(/\| git status \| 32 \|/.test(md.stdout), 'markdown family row');
expect(!/secret-file|patch-secret|private dir|SECRETPATTERN|INTERNALHOST|SECRETNAME/.test(md.stdout), 'sanitized markdown must not carry any fixture path, basename, pattern, or host');
expect(/Read \*\.ts/.test(md.stdout), 'sanitized Read label keeps only the extension');

// --raw keeps the truncated path for local inspection.
const raw = run([cli, '--transcripts', fixture, '--raw']);
expect(raw.status === 0 && raw.stdout.includes('secret-file.ts'), '--raw keeps the path');

// Context shape: per-turn context, bands, cache rewrites, and the agent-type table.
const shapeFixture = join(here, 'fixture-shape');
const shapeJson = run([cli, '--transcripts', shapeFixture, '--json']);
expect(shapeJson.status === 0, `shape fixture --json should exit 0, got ${shapeJson.status}: ${shapeJson.stderr}`);
let shape = null;
try { shape = JSON.parse(shapeJson.stdout); } catch { fails.push('shape fixture --json must parse'); }
if (shape) {
  const m = shape.main, s = shape.subagents;
  expect(m.turns === 3 && m.contextFirst === 50000 && m.contextMax === 210000,
    `main context shape 3/50000/210000, got ${m.turns}/${m.contextFirst}/${m.contextMax}`);
  expect(m.threads.length === 1 && m.threads[0].inputSide === 380000,
    `merged main keeps one thread carrying 380000 input-side tokens, got ${JSON.stringify(m.threads)}`);
  const bandsOf = (x) => x.contextBands.map((b) => `${b.turns}:${b.tokens}`).join(',');
  expect(bandsOf(m) === '1:50000,0:0,1:120000,0:0,1:210000,0:0',
    `main turns land in the 0-60K, 100K-150K, and 200K-300K bands, got ${bandsOf(m)}`);
  expect(m.cacheRewrites.turns === 1 && m.cacheRewrites.tokens === 79000,
    `one non-first turn recreates over half of a context above 40K, got ${JSON.stringify(m.cacheRewrites)}`);
  expect(s.threads.length === 2 && s.turns === 3 && bandsOf(s) === '2:40000,1:70000,0:0,0:0,0:0,0:0',
    `subagent threads merge their bands, got ${s.threads.length}/${s.turns}/${bandsOf(s)}`);
  expect(s.cacheRewrites.turns === 0, `no subagent turn qualifies as a rewrite, got ${JSON.stringify(s.cacheRewrites)}`);
  const verifier = shape.byAgentType['verifier / model-sub'];
  expect(verifier?.threads === 1 && verifier?.turns === 2 && verifier?.medianContextFirst === 30000
    && verifier?.medianContextMax === 70000 && verifier?.inputSide === 100000,
    `the sibling meta file names the agent type, got ${JSON.stringify(shape.byAgentType)}`);
  expect(shape.byAgentType['unknown / model-other']?.inputSide === 10000,
    `a malformed meta file reads as agent type unknown, got ${JSON.stringify(Object.keys(shape.byAgentType))}`);
}
const shapeMd = run([cli, '--transcripts', shapeFixture]);
expect(/## Context shape/.test(shapeMd.stdout) && /## Spend by context band/.test(shapeMd.stdout)
  && /## Subagents by agent type/.test(shapeMd.stdout), 'markdown carries the three context-shape sections');
expect(shapeMd.stdout.indexOf('## Context shape') > shapeMd.stdout.indexOf('## Exact tokens')
  && shapeMd.stdout.indexOf('## Context shape') < shapeMd.stdout.indexOf('## Context bytes by source'),
  'the context-shape sections follow the exact-tokens table');
expect(/\| 100K-150K \| 1 \| 120,000 \|/.test(shapeMd.stdout), `the band table lists the 100K-150K turn, got:\n${shapeMd.stdout}`);
expect(/Full cache rewrites .*main 1 turn\(s\), 79,000 tokens/.test(shapeMd.stdout), 'the rewrite line reports main turns and tokens');
expect(/\| verifier \/ model-sub \| 1 \| 2 \| 30,000 \| 70,000 \| 100,000 \|/.test(shapeMd.stdout),
  `the agent-type table is sorted by input-side tokens, got:\n${shapeMd.stdout}`);

// `--all` without `--transcripts`: every project under the host's transcript root, merged.
const homeDir = mkdtempSync(join(tmpdir(), 'ca-home-'));
const projectRoot = join(homeDir, '.claude', 'projects');
for (const slug of ['C--proj-a', 'C--proj-b']) {
  mkdirSync(join(projectRoot, slug), { recursive: true });
  appendFileSync(join(projectRoot, slug, 'sess-shape.jsonl'), readFileSync(join(shapeFixture, 'sess-shape.jsonl'), 'utf8'));
}
const homeEnv = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
const allJson = run([cli, '--all', '--json'], { env: homeEnv });
try {
  const a = JSON.parse(allJson.stdout);
  expect(allJson.status === 0 && a.files === 2 && a.main.turns === 6 && a.main.threads.length === 2,
    `--all merges every project directory, got ${allJson.stdout.slice(0, 200)}`);
  expect(a.projects.length === 2 && a.projects.every((p) => p.mainInputSide === 380000),
    `--all reports per-project input-side totals, got ${JSON.stringify(a.projects)}`);
} catch { fails.push(`--all --json must parse, got ${allJson.stdout.slice(0, 120)}${allJson.stderr.slice(0, 120)}`); }
const allMd = run([cli, '--all'], { env: homeEnv });
expect(/## Projects/.test(allMd.stdout) && /\| project-1 \| 380,000 \|/.test(allMd.stdout) && !/C--proj-/.test(allMd.stdout),
  `--all renders the per-project totals table without path-derived slugs, got:\n${allMd.stdout.slice(-400)}`);
const allRaw = run([cli, '--all', '--raw'], { env: homeEnv });
expect(/\| C--proj-[ab] \| 380,000 \|/.test(allRaw.stdout), `--all --raw names the project slugs, got:\n${allRaw.stdout.slice(-400)}`);
const allSince = run([cli, '--all', '--since', '2026-09-03T00:00:00Z'], { env: homeEnv });
expect(allSince.status === 1, `--since still filters per file by its last timestamp, got ${allSince.status}`);
rmSync(homeDir, { recursive: true, force: true });

// Empty dir → exit 1.
const empty = mkdtempSync(join(tmpdir(), 'ca-empty-'));
const e = run([cli, '--transcripts', empty]);
expect(e.status === 1, `empty transcript dir should exit 1, got ${e.status}`);

// Bad flag → exit 2.
expect(run([cli, '--nope']).status === 2, 'unknown flag should exit 2');

// Hook: appends one row with matching totals; garbage / missing transcript → exit 0, no row.
const tmp = mkdtempSync(join(tmpdir(), 'ca-hook-'));
const ledger = join(tmp, 'nested', 'receipts.jsonl');
// A fake home per hook run, so the handoff marker the receipt reads is this eval's, never the
// operator's own `~/.claude/code-ops/handoff/`.
const hookHome = join(tmp, 'home');
mkdirSync(hookHome, { recursive: true });
const env = { ...process.env, CODE_OPS_RECEIPTS: ledger, HOME: hookHome, USERPROFILE: hookHome };
// The eval must not inherit an arm switch from the operator's own session.
for (const k of ['CODE_OPS_DIGEST', 'CODE_OPS_LADDER_CARD', 'CODE_OPS_INDEX', 'CODE_OPS_HANDOFF_CARD', 'CODE_OPS_HANDOFF_PICKUP', 'CODE_OPS_DISPATCH_GUARD']) delete env[k];
const payload = JSON.stringify({ session_id: 'sess-1', transcript_path: mainFile, cwd: root, hook_event_name: 'SessionEnd', reason: 'other' });
const h1 = run([hook], { input: payload, env });
expect(h1.status === 0, `hook should exit 0, got ${h1.status}: ${h1.stderr}`);
expect(h1.stdout === '', 'hook must print nothing to the model');
expect(existsSync(ledger), 'hook should create the ledger (with parent dirs)');
if (existsSync(ledger)) {
  const rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  expect(rows.length === 1, `one row, got ${rows.length}`);
  const r = rows[0] || {};
  expect(r.v === 1 && r.sessionId === 'sess-1' && r.reason === 'other', `row identity, got ${JSON.stringify(r).slice(0, 200)}`);
  expect(r.tokens?.main?.input === 212 && r.tokens?.main?.cacheRead === 2402 && r.tokens?.main?.output === 107, `row main tokens, got ${JSON.stringify(r.tokens)}`);
  expect(r.tokens?.subagents?.input === 7, `row subagent tokens, got ${JSON.stringify(r.tokens?.subagents)}`);
  expect(r.files === 2 && r.skipped === 0 && r.turns === 6 && r.durationMs === 600000, `row files/skipped/turns/duration, got ${r.files}/${r.skipped}/${r.turns}/${r.durationMs}`);
  expect(r.toolCalls?.Bash === 3 && r.toolCalls?.Read === 2, `row tool calls, got ${JSON.stringify(r.toolCalls)}`);
  expect(!JSON.stringify(r).includes('secret-file'), 'row must not carry file contents or paths from the transcript');
  expect(r.arms && r.arms.digest === true && r.arms.ladderCard === true && r.arms.index === true && r.arms.handoffCard === true
    && r.arms.handoffPickup === true && r.arms.dispatchGuard === true, `row records every arm on under a clean environment, because each is on unless its switch says off, got ${JSON.stringify(r.arms)}`);
  expect(r.handoff && r.handoff.band === 0 && r.handoff.invoked === false, `a session with no marker and no handoff command records band 0 and invoked false, got ${JSON.stringify(r.handoff)}`);
  expect(Number.isInteger(r.contextAtEnd) && r.contextAtEnd > 0, `row carries the context resident at session end, got ${r.contextAtEnd}`);
  expect(JSON.stringify(r.skills) === '{}', `a session with no skill invocation records an empty skills object, got ${JSON.stringify(r.skills)}`);
}
const h2 = run([hook], { input: 'not json at all', env });
expect(h2.status === 0, `garbage stdin should exit 0, got ${h2.status}`);
const h3 = run([hook], { input: JSON.stringify({ transcript_path: join(tmp, 'missing.jsonl') }), env });
expect(h3.status === 0, `missing transcript should exit 0, got ${h3.status}`);
if (existsSync(ledger)) {
  const n = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length;
  expect(n === 1, `garbage and missing must not append rows, ledger has ${n}`);
}
const camelLedger = join(tmp, 'camel', 'receipts.jsonl');
const camel = run([hook], { input: JSON.stringify({ sessionId: 'codex-session', transcriptPath: mainFile, cwd: root }), env: { ...env, CODE_OPS_RECEIPTS: camelLedger } });
expect(camel.status === 0 && existsSync(camelLedger) && JSON.parse(readFileSync(camelLedger, 'utf8')).sessionId === 'codex-session', 'Codex camel-case session payload appends a receipt');
const codexLedger = join(tmp, 'codex', 'receipts.jsonl');
const codexReceipt = run([hook], { input: JSON.stringify({ sessionId: 'codex-parent', transcriptPath: codexParent, cwd: root }), env: { ...env, CODE_OPS_RECEIPTS: codexLedger } });
const codexRow = existsSync(codexLedger) ? JSON.parse(readFileSync(codexLedger, 'utf8')) : {};
expect(codexReceipt.status === 0 && codexRow.files === 3 && codexRow.tokens?.main?.total === 11
  && codexRow.tokens?.subagents?.total === 52,
  `Codex receipt follows child and grandchild rollouts: ${JSON.stringify(codexRow)}`);
const grokDir = mkdtempSync(join(tmpdir(), 'ca-grok-hook-'));
const grokChat = join(grokDir, 'chat_history.jsonl');
const grokUpdates = join(grokDir, 'updates.jsonl');
appendFileSync(grokChat, '{}\n');
appendFileSync(grokUpdates, jsonl([
  { timestamp: 1000, params: { sessionId: 'g1', update: { prompt_id: 'p1', usage: grokUsage(100, 70, 10, 10, 4, 1) } } },
  { timestamp: 1001, params: { sessionId: 'g1', update: { prompt_id: 'p1', usage: grokUsage(150, 100, 10, 20, 6, 2) } } },
]));
expect(measurementTranscriptFor(grokChat) === grokUpdates, 'Grok chat transcript resolves its sibling usage stream');
const grokLedger = join(tmp, 'grok', 'receipts.jsonl');
const grokReceipt = run([hook], { input: JSON.stringify({ session_id: 'grok-session', transcript_path: grokChat, cwd: root }),
  env: { ...env, CODE_OPS_RECEIPTS: grokLedger, GROK_PLUGIN_ROOT: join(root, 'plugins', 'code-ops-suite') } });
const grokRow = existsSync(grokLedger) ? JSON.parse(readFileSync(grokLedger, 'utf8')) : {};
expect(grokReceipt.status === 0 && grokRow.tokens?.main?.total === 170 && grokRow.models?.['grok-model-a'] === 2
  && grokRow.arms?.ladderCard === false && grokRow.arms?.handoffCard === true && grokRow.arms?.handoffPickup === false,
  `Grok receipt reads deduplicated updates; ladder and pickup stay off, handoff follows the switch: ${JSON.stringify(grokRow)}`);
rmSync(grokDir, { recursive: true, force: true });

// receipts mode reads the ledger back.
const rc = run([cli, 'receipts', '--ledger', ledger, '--cwd', root, '--json']);
expect(rc.status === 0, `receipts --json should exit 0, got ${rc.status}: ${rc.stderr}`);
try {
  const r = JSON.parse(rc.stdout);
  expect(r.sessions === 1 && r.usage.input === 219 && r.durationMs === 600000, `receipts aggregate, got ${rc.stdout.slice(0, 200)}`);
} catch { fails.push('receipts --json must parse'); }

// A second row from another directory: --all sees both, --cwd root sees one.
appendFileSync(ledger, JSON.stringify({ v: 1, ts: '2026-09-01T11:00:00.000Z', sessionId: 'other', cwd: join(tmp, 'elsewhere'), durationMs: 1000, models: { 'model-q': 1 }, turns: 1, toolCalls: {}, toolResultChars: 0, files: 1, skipped: 0, tokens: { main: { input: 5, cacheRead: 0, cacheCreate: 0, output: 1, thinking: 0, total: 6 }, subagents: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0, total: 0 } } }) + '\n');
const rcAll = run([cli, 'receipts', '--ledger', ledger, '--all', '--json']);
expect(rcAll.status === 0 && JSON.parse(rcAll.stdout || '{}').sessions === 2, 'receipts --all reads every row');
const rcRoot = run([cli, 'receipts', '--ledger', ledger, '--cwd', root, '--json']);
expect(rcRoot.status === 0 && JSON.parse(rcRoot.stdout || '{}').sessions === 1, 'receipts --cwd filters to one directory even with other rows present');
// Off switch: no row, no file, exit 0.
// The guard must return before any write: with the value `off`, a missing guard would
// treat `off` as a relative ledger path and create a file named `off` in the cwd.
const offDir = mkdtempSync(join(tmpdir(), 'ca-off-'));
const rowsBefore = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length;
for (const v of ['off', '0', 'false']) {
  const hOff = run([hook], { input: payload, cwd: offDir, env: { ...process.env, CODE_OPS_RECEIPTS: v } });
  expect(hOff.status === 0 && hOff.stdout === '', `CODE_OPS_RECEIPTS=${v} exits 0 with no stdout`);
  expect(!existsSync(join(offDir, v)), `CODE_OPS_RECEIPTS=${v} must not create a file named ${v}`);
}
expect(readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length === rowsBefore, 'the off switch appends nothing to the real ledger');
rmSync(offDir, { recursive: true, force: true });
// Arm names, as `armKey` builds them: the keys whose value is exactly true, sorted, joined by `+`.
const FULL_ARM = 'digest+dispatchGuard+handoffCard+handoffPickup+index+ladderCard';
const TWO_OFF_ARM = 'digest+dispatchGuard+handoffCard+handoffPickup';
const CARD_OFF_ARM = 'digest+dispatchGuard+handoffPickup+index+ladderCard';
// Arms: a session with two switches off records it, and --by-arm reads that arm against the full set.
const hArm = run([hook], { input: payload, env: { ...env, CODE_OPS_INDEX: 'off', CODE_OPS_LADDER_CARD: 'off' } });
expect(hArm.status === 0 && hArm.stdout === '', 'the hook stays silent with an arm switch on');
const armRows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
expect(armRows.at(-1)?.arms?.digest === true && armRows.at(-1)?.arms?.index === false && armRows.at(-1)?.arms?.ladderCard === false, `the two-switch-off arm is recorded, got ${JSON.stringify(armRows.at(-1)?.arms)}`);
const byArm = run([cli, 'receipts', '--ledger', ledger, '--all', '--by-arm', '--json']);
try {
  const groups = JSON.parse(byArm.stdout).byArm;
  const names = groups.map((g) => g.arm).sort();
  expect(names.join(',') === `${TWO_OFF_ARM},${FULL_ARM},unknown`, `by-arm groups the two-switch arm, the full default, and the pre-switch row as unknown, got ${names.join(',')}`);
  const digest = groups.find((g) => g.arm === TWO_OFF_ARM);
  const last = armRows.at(-1);
  const rowTokens = ['main', 'subagents'].reduce((n, k) => n + ['input', 'cacheRead', 'cacheCreate', 'output'].reduce((m, f) => m + (last.tokens?.[k]?.[f] || 0), 0), 0);
  expect(digest.sessions === 1 && digest.perSession.tokens === rowTokens && digest.perSession.contextAtEnd === last.contextAtEnd, `by-arm reports per-session means from the row, got ${JSON.stringify(digest)}`);
} catch { fails.push(`receipts --by-arm --json must parse, got ${byArm.stdout.slice(0, 120)}${byArm.stderr.slice(0, 120)}`); }
const byArmText = run([cli, 'receipts', '--ledger', ledger, '--all', '--by-arm']);
expect(byArmText.stdout.includes(`| ${TWO_OFF_ARM} | 1 |`) && byArmText.stdout.includes(`| ${FULL_ARM} | 1 |`), `the text table lists one row per arm, got:\n${byArmText.stdout}`);
expect(/\| Nudged \| Handed off \|/.test(byArmText.stdout), `the text table carries the handoff columns, got:\n${byArmText.stdout}`);

// Handoff arm: the marker band, the operator's own /code-ops-suite:handoff call, the off switch,
// and an old row that carries neither field.
const hoHome = join(tmp, 'handoff-home');
const markerDir = join(hoHome, '.claude', 'code-ops', 'handoff', projectSlug(root));
mkdirSync(markerDir, { recursive: true });
const writeMarker = (sessionId, marker) => appendFileSync(join(markerDir, `${projectSlug(sessionId)}.json`), JSON.stringify(marker));
// band 0 with peak 2: the session compacted back under the threshold after two nudges, and the
// receipt still reports that it was nudged.
writeMarker('sess-1', { v: 1, band: 0, peak: 2, ts: '2026-09-01T10:00:00.000Z' });
writeMarker('sess-invoked', { v: 1, band: 1, peak: 1, ts: '2026-09-01T10:00:00.000Z' });
const invokedFile = join(tmp, 'invoked.jsonl');
const HANDOFF_COMMAND = '<command-message>code-ops-suite:handoff</command-message>\n<command-name>/code-ops-suite:handoff</command-name>';
const hoAssistant = { type: 'assistant', message: { id: 'ho-1', model: 'model-x', usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } } };
appendFileSync(invokedFile, jsonl([
  { type: 'user', message: { role: 'user', content: 'build the thing' } },
  hoAssistant,
  { type: 'user', message: { role: 'user', content: HANDOFF_COMMAND } },
]));
// Neither counts as handing off: a first-prompt command resumes an earlier session, and the
// marker quoted in a tool result or a plain prompt is talk about the command.
const resumedFile = join(tmp, 'resumed.jsonl');
appendFileSync(resumedFile, jsonl([
  { type: 'user', message: { role: 'user', content: HANDOFF_COMMAND } },
  hoAssistant,
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: HANDOFF_COMMAND }] } },
  { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Run <command-name>/code-ops-suite:handoff</command-name> now' }] } },
]));
const hoLedger = join(tmp, 'handoff', 'receipts.jsonl');
const hoEnv = { ...env, CODE_OPS_RECEIPTS: hoLedger, HOME: hoHome, USERPROFILE: hoHome };
const hoRows = () => readFileSync(hoLedger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
expect(run([hook], { input: payload, env: hoEnv }).status === 0, 'the marker-bearing receipt exits 0');
expect(hoRows().at(-1)?.handoff?.band === 2 && hoRows().at(-1)?.handoff?.invoked === false,
  `the row reads the highest band the marker reached, got ${JSON.stringify(hoRows().at(-1)?.handoff)}`);
const invokedPayload = JSON.stringify({ session_id: 'sess-invoked', transcript_path: invokedFile, cwd: root, hook_event_name: 'SessionEnd' });
expect(run([hook], { input: invokedPayload, env: hoEnv }).status === 0, 'the invoked receipt exits 0');
const invokedRow = hoRows().at(-1);
expect(invokedRow?.handoff?.band === 1 && invokedRow?.handoff?.invoked === true,
  `the command marker in the transcript records invoked, got ${JSON.stringify(invokedRow?.handoff)}`);
expect(!JSON.stringify(invokedRow).includes('command-name'), 'the row stores the boolean, never transcript text');
const resumedPayload = JSON.stringify({ session_id: 'sess-resumed', transcript_path: resumedFile, cwd: root, hook_event_name: 'SessionEnd' });
expect(run([hook], { input: resumedPayload, env: hoEnv }).status === 0, 'the resumed receipt exits 0');
expect(hoRows().at(-1)?.handoff?.invoked === false,
  `a first-prompt resume and a quoted marker do not record invoked, got ${JSON.stringify(hoRows().at(-1)?.handoff)}`);
const offPayload = JSON.stringify({ session_id: 'sess-ho-off', transcript_path: mainFile, cwd: root, hook_event_name: 'SessionEnd' });
expect(run([hook], { input: offPayload, env: { ...hoEnv, CODE_OPS_HANDOFF_CARD: 'off' } }).status === 0, 'the switched-off receipt exits 0');
expect(hoRows().at(-1)?.arms?.handoffCard === false && hoRows().at(-1)?.handoff?.band === 0,
  `CODE_OPS_HANDOFF_CARD=off records the arm off and no band, got ${JSON.stringify(hoRows().at(-1)?.arms)}`);
// The two newest arms read their own switches, on a ledger of their own so the by-arm counts
// below keep their denominators.
const newArmLedger = join(tmp, 'new-arms', 'receipts.jsonl');
expect(run([hook], { input: payload, env: { ...env, CODE_OPS_RECEIPTS: newArmLedger, CODE_OPS_HANDOFF_PICKUP: 'off', CODE_OPS_DISPATCH_GUARD: 'off' } }).status === 0,
  'the receipt with the pickup and guard switches off exits 0');
const newArmRow = existsSync(newArmLedger) ? JSON.parse(readFileSync(newArmLedger, 'utf8')) : {};
expect(newArmRow.arms?.handoffPickup === false && newArmRow.arms?.dispatchGuard === false && newArmRow.arms?.handoffCard === true,
  `the pickup and guard switches record their own arms off, got ${JSON.stringify(newArmRow.arms)}`);
// `warn` lifts only the guard's hard stop, so the arm stays on: every advisory still runs.
const warnLedger = join(tmp, 'warn-arm', 'receipts.jsonl');
run([hook], { input: payload, env: { ...env, CODE_OPS_RECEIPTS: warnLedger, CODE_OPS_DISPATCH_GUARD: 'warn' } });
expect(existsSync(warnLedger) && JSON.parse(readFileSync(warnLedger, 'utf8')).arms?.dispatchGuard === true,
  'CODE_OPS_DISPATCH_GUARD=warn records the guard arm on');

// An old row: no arms, no handoff. It groups as unknown and joins neither handoff denominator.
appendFileSync(hoLedger, JSON.stringify({ v: 1, ts: '2026-09-15T00:00:00.000Z', sessionId: 'old', cwd: root, durationMs: 1000, turns: 1, toolCalls: {}, tokens: { main: { input: 1, cacheRead: 0, cacheCreate: 0, output: 1, thinking: 0, total: 2 } } }) + '\n');
const hoByArm = run([cli, 'receipts', '--ledger', hoLedger, '--all', '--by-arm', '--json']);
try {
  const groups = JSON.parse(hoByArm.stdout).byArm;
  const full = groups.find((g) => g.arm === FULL_ARM);
  expect(full?.sessions === 3 && full?.handoff.known === 3 && full?.handoff.nudged === 2 && full?.handoff.invoked === 1,
    `the on arm counts both nudged sessions and the one that handed off, got ${JSON.stringify(full)}`);
  const offArm = groups.find((g) => g.arm === CARD_OFF_ARM);
  expect(offArm?.sessions === 1 && offArm?.handoff.nudged === 0, `the off arm carries its own denominator, got ${JSON.stringify(offArm)}`);
  const old = groups.find((g) => g.arm === 'unknown');
  expect(old?.sessions === 1 && old?.handoff.known === 0 && old?.handoff.nudged === 0,
    `a row without the fields still aggregates and counts as absent, got ${JSON.stringify(old)}`);
} catch { fails.push(`handoff --by-arm --json must parse, got ${hoByArm.stdout.slice(0, 160)}${hoByArm.stderr.slice(0, 160)}`); }
// Skills: Skill tool calls and namespaced slash commands count by colon-form id, a leading slash
// stripped. A host built-in, a meta prompt, a quoted tag, and a non-id value count nothing.
const skillsFile = join(tmp, 'skills.jsonl');
const skillCall = (id, skill) => ({ type: 'assistant', message: { id, model: 'model-x', content: [{ type: 'tool_use', id: `tu-${id}`, name: 'Skill', input: { skill } }],
  usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 1 } } });
const command = (name) => `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>`;
appendFileSync(skillsFile, jsonl([
  { type: 'user', message: { role: 'user', content: command('code-ops-suite:ship') } },
  skillCall('sk-1', 'code-ops-suite:handoff'),
  skillCall('sk-2', '/rigor:refute'),
  skillCall('sk-3', 'rm -rf; echo <secret>'),
  { type: 'user', message: { role: 'user', content: [{ type: 'text', text: command('code-ops-suite:handoff') }] } },
  { type: 'user', message: { role: 'user', content: command('clear') } },
  { type: 'user', isMeta: true, message: { role: 'user', content: command('code-ops-suite:ship') } },
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-sk-1', content: command('code-ops-suite:ship') }] } },
  { type: 'user', message: { role: 'user', content: `Run ${command('code-ops-suite:ship')} later` } },
]));
const skillsLedger = join(tmp, 'skills', 'receipts.jsonl');
expect(run([hook], { input: JSON.stringify({ session_id: 'sess-skills', transcript_path: skillsFile, cwd: root }), env: { ...env, CODE_OPS_RECEIPTS: skillsLedger } }).status === 0,
  'the skills receipt exits 0');
const skillsRow = existsSync(skillsLedger) ? JSON.parse(readFileSync(skillsLedger, 'utf8')) : {};
const wantSkills = { 'code-ops-suite:ship': 1, 'code-ops-suite:handoff': 2, 'rigor:refute': 1 };
const sortedJson = (o) => JSON.stringify(Object.fromEntries(Object.entries(o || {}).sort()));
expect(sortedJson(skillsRow.skills) === sortedJson(wantSkills), `Skill calls and slash commands count by id, got ${JSON.stringify(skillsRow.skills)}`);
expect(!JSON.stringify(skillsRow).includes('secret'), 'a Skill input that is not an id never reaches the row');
appendFileSync(skillsLedger, readFileSync(skillsLedger, 'utf8').split('\n')[0].replace('sess-skills', 'sess-skills-2') + '\n');
appendFileSync(skillsLedger, JSON.stringify({ v: 1, ts: '2026-09-15T00:00:00.000Z', sessionId: 'pre-skills', cwd: root, durationMs: 1, turns: 1, toolCalls: {}, tokens: {} }) + '\n');
const rcSkills = run([cli, 'receipts', '--ledger', skillsLedger, '--all', '--json']);
try {
  const agg = JSON.parse(rcSkills.stdout);
  expect(agg.sessions === 3 && agg.skills?.['code-ops-suite:handoff'] === 4 && agg.skills?.['rigor:refute'] === 2,
    `receipts sums skills across rows and tolerates a row without the field, got ${JSON.stringify(agg.skills)}`);
} catch { fails.push(`receipts --json with skills must parse, got ${rcSkills.stdout.slice(0, 160)}${rcSkills.stderr.slice(0, 160)}`); }
const rcSkillsText = run([cli, 'receipts', '--ledger', skillsLedger, '--all']);
expect(rcSkillsText.stdout.includes('| code-ops-suite:handoff | 4 |'), `the text summary lists skill invocations, got:\n${rcSkillsText.stdout}`);

// Retention: --purge-before rewrites the ledger keeping rows at or after the cutoff.
const beforePurge = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length;
const purge = run([cli, 'receipts', '--ledger', ledger, '--purge-before', '2026-09-01T12:00:00Z', '--json']);
try {
  const p = JSON.parse(purge.stdout);
  expect(purge.status === 0 && p.removed === 1 && p.kept === beforePurge - 1, `purge removes the one row dated before the cutoff, got ${purge.stdout}`);
} catch { fails.push(`receipts --purge-before --json must parse, got ${purge.stdout.slice(0, 120)}${purge.stderr.slice(0, 120)}`); }
const afterPurge = readFileSync(ledger, 'utf8').split('\n').filter(Boolean);
expect(afterPurge.length === beforePurge - 1 && !afterPurge.some((l) => l.includes('"sessionId":"other"')), 'the purged ledger keeps every later row and drops the dated one');
expect(!existsSync(`${ledger}.purge-${process.pid}`), 'the purge leaves no scratch file beside the ledger');
const badDate = run([cli, 'receipts', '--ledger', ledger, '--purge-before', 'yesterday']);
expect(badDate.status === 2, `a non-ISO cutoff exits 2, got ${badDate.status}`);
const rcOther = run([cli, 'receipts', '--ledger', ledger, '--cwd', tmp, '--json']);
expect(rcOther.status === 0 && JSON.parse(rcOther.stdout || '{}').sessions === 0, 'receipts --cwd filters rows to that directory');

rmSync(tmp, { recursive: true, force: true });
rmSync(empty, { recursive: true, force: true });
rmSync(codexLinkDir, { recursive: true, force: true });

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\ncontext-audit eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('ok   usage deduplicated by message id; main and subagent threads apart');
console.log('ok   tool attribution, cd-stripped families, repeat reads, sanitized vs raw labels');
console.log('ok   SessionEnd receipt hook appends one row, prints nothing, fails open');
console.log('ok   receipts record the arm switches and the context at end; --by-arm reads arms against none');
console.log('ok   receipts record the handoff band and whether the operator ran the handoff command; old rows still aggregate');
console.log('ok   receipts count skill invocations by id from Skill calls and slash commands; none records {}');
console.log('ok   --purge-before rewrites the ledger by date and reports what it removed');
console.log('ok   context shape: per-turn bands, cache rewrites, agent types, and --all across projects');
console.log('\ncontext-audit eval passed');
