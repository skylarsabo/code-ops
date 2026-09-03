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
//     and exits 0 with no row on garbage stdin or a missing transcript.
//
//   node evals/context-audit/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const cli = join(root, 'scripts', 'context-audit.mjs');
const hook = join(root, 'plugins', 'code-ops-suite', 'hooks', 'session-receipt.mjs');
const fixture = join(here, 'fixture');
const mainFile = join(fixture, 'sess-1.jsonl');

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };
const run = (args, opts = {}) => spawnSync('node', args, { encoding: 'utf8', ...opts });

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

// Empty dir → exit 1.
const empty = mkdtempSync(join(tmpdir(), 'ca-empty-'));
const e = run([cli, '--transcripts', empty]);
expect(e.status === 1, `empty transcript dir should exit 1, got ${e.status}`);

// Bad flag → exit 2.
expect(run([cli, '--nope']).status === 2, 'unknown flag should exit 2');

// Hook: appends one row with matching totals; garbage / missing transcript → exit 0, no row.
const tmp = mkdtempSync(join(tmpdir(), 'ca-hook-'));
const ledger = join(tmp, 'nested', 'receipts.jsonl');
const env = { ...process.env, CODE_OPS_RECEIPTS: ledger };
// The eval must not inherit an arm switch from the operator's own session.
for (const k of ['CODE_OPS_DIGEST', 'CODE_OPS_LADDER_CARD', 'CODE_OPS_INDEX']) delete env[k];
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
  expect(r.arms && r.arms.digest === true && r.arms.ladderCard === true && r.arms.index === true, `row records every arm on under a clean environment, because each is on unless its switch says off, got ${JSON.stringify(r.arms)}`);
  expect(Number.isInteger(r.contextAtEnd) && r.contextAtEnd > 0, `row carries the context resident at session end, got ${r.contextAtEnd}`);
}
const h2 = run([hook], { input: 'not json at all', env });
expect(h2.status === 0, `garbage stdin should exit 0, got ${h2.status}`);
const h3 = run([hook], { input: JSON.stringify({ transcript_path: join(tmp, 'missing.jsonl') }), env });
expect(h3.status === 0, `missing transcript should exit 0, got ${h3.status}`);
if (existsSync(ledger)) {
  const n = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).length;
  expect(n === 1, `garbage and missing must not append rows, ledger has ${n}`);
}

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
// Arms: a session with two switches off records it, and --by-arm reads that arm against the full set.
const hArm = run([hook], { input: payload, env: { ...env, CODE_OPS_INDEX: 'off', CODE_OPS_LADDER_CARD: 'off' } });
expect(hArm.status === 0 && hArm.stdout === '', 'the hook stays silent with an arm switch on');
const armRows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
expect(armRows.at(-1)?.arms?.digest === true && armRows.at(-1)?.arms?.index === false && armRows.at(-1)?.arms?.ladderCard === false, `the digest-only arm is recorded, got ${JSON.stringify(armRows.at(-1)?.arms)}`);
const byArm = run([cli, 'receipts', '--ledger', ledger, '--all', '--by-arm', '--json']);
try {
  const groups = JSON.parse(byArm.stdout).byArm;
  const names = groups.map((g) => g.arm).sort();
  expect(names.join(',') === 'digest,digest+index+ladderCard,unknown', `by-arm groups the digest-only arm, the full default, and the pre-switch row as unknown, got ${names.join(',')}`);
  const digest = groups.find((g) => g.arm === 'digest');
  const last = armRows.at(-1);
  const rowTokens = ['main', 'subagents'].reduce((n, k) => n + ['input', 'cacheRead', 'cacheCreate', 'output'].reduce((m, f) => m + (last.tokens?.[k]?.[f] || 0), 0), 0);
  expect(digest.sessions === 1 && digest.perSession.tokens === rowTokens && digest.perSession.contextAtEnd === last.contextAtEnd, `by-arm reports per-session means from the row, got ${JSON.stringify(digest)}`);
} catch { fails.push(`receipts --by-arm --json must parse, got ${byArm.stdout.slice(0, 120)}${byArm.stderr.slice(0, 120)}`); }
const byArmText = run([cli, 'receipts', '--ledger', ledger, '--all', '--by-arm']);
expect(/\| digest \| 1 \|/.test(byArmText.stdout) && /\| digest\+index\+ladderCard \| 1 \|/.test(byArmText.stdout), `the text table lists one row per arm, got:\n${byArmText.stdout}`);
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

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\ncontext-audit eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('ok   usage deduplicated by message id; main and subagent threads apart');
console.log('ok   tool attribution, cd-stripped families, repeat reads, sanitized vs raw labels');
console.log('ok   SessionEnd receipt hook appends one row, prints nothing, fails open');
console.log('ok   receipts record the arm switches and the context at end; --by-arm reads arms against none');
console.log('ok   --purge-before rewrites the ledger by date and reports what it removed');
console.log('\ncontext-audit eval passed');
