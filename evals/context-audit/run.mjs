#!/usr/bin/env node
// Context-audit regression eval — pins the transcript parser (scripts/transcript-lib.mjs), the
// CLI (scripts/context-audit.mjs), and the SessionEnd receipt hook
// (plugins/code-ops-suite/hooks/session-receipt.mjs) against a synthetic fixture:
//   - usage repeated across the lines of one assistant message is counted ONCE (max per field);
//   - tool results are attributed to their tool, subagent threads are summed apart from main;
//   - `cd <dir> &&` prefixes are stripped from Bash families; repeat reads are counted;
//   - a non-JSON line is skipped, never fatal; sanitized output carries no fixture path,
//     `--raw` does; `--json` parses;
//   - the hook appends exactly one v1 row to $CODE_OPS_RECEIPTS with the same token totals,
//     and exits 0 with no row on garbage stdin or a missing transcript.
//
//   node evals/context-audit/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
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
  expect(m.messages.assistant === 4, `main assistant messages deduped to 4, got ${m.messages.assistant}`);
  expect(m.usage.input === 210, `main input tokens 100+50+50+10 = 210 once, got ${m.usage.input}`);
  expect(m.usage.cacheRead === 2400, `main cache read 300+600+700+800 = 2400, got ${m.usage.cacheRead}`);
  expect(m.usage.cacheCreate === 200, `main cache create 200 once, got ${m.usage.cacheCreate}`);
  expect(m.usage.output === 85, `main output 40+20+20+5 = 85, got ${m.usage.output}`);
  expect(m.usage.thinking === 10, `main thinking 10 once, got ${m.usage.thinking}`);
  expect(m.usage.total === 210 + 2400 + 200 + 85, `main total, got ${m.usage.total}`);
  expect(s.usage.input === 7 && s.usage.cacheCreate === 11 && s.usage.cacheRead === 13 && s.usage.output === 3, `subagent usage 7/11/13/3, got ${JSON.stringify(s.usage)}`);
  expect(a.usage.input === 217, `all input = 210 + 7, got ${a.usage.input}`);
  expect(m.models['model-x'] === 2 && m.models['model-y'] === 2, `main model mix x:2 y:2, got ${JSON.stringify(m.models)}`);
  expect(s.models['model-z'] === 1, `subagent model z:1, got ${JSON.stringify(s.models)}`);
  expect(m.toolCalls.Bash === 1 && m.toolCalls.Read === 2, `main tool calls Bash:1 Read:2, got ${JSON.stringify(m.toolCalls)}`);
  expect(m.toolResultChars.Bash === 32, `Bash result chars 32, got ${m.toolResultChars.Bash}`);
  expect(m.toolResultChars.Read === 36, `Read result chars 18*2 = 36, got ${m.toolResultChars.Read}`);
  expect(s.toolResultChars.Grep === 23, `subagent Grep chars 23, got ${s.toolResultChars.Grep}`);
  expect(a.toolResultCharsTotal === 32 + 36 + 23, `all tool result chars, got ${a.toolResultCharsTotal}`);
  expect(m.bashFamilies['git status'] === 32, `cd-prefix stripped family "git status" = 32, got ${JSON.stringify(m.bashFamilies)}`);
  expect(!('cd' in m.bashFamilies) && !Object.keys(m.bashFamilies).some((k) => k.startsWith('cd')), 'no "cd" family may survive');
  expect(m.repeatReads.paths === 1 && m.repeatReads.extraReads === 1 && m.repeatReads.extraChars === 18, `repeat reads 1/1/18, got ${JSON.stringify(m.repeatReads)}`);
  expect(m.textChars.thinking === 10 && m.textChars.assistant === 4, `text chars thinking 10 / assistant 4, got ${JSON.stringify(m.textChars)}`);
  expect(m.firstTs === '2026-09-01T10:00:00.000Z' && m.lastTs === '2026-09-01T10:10:00.000Z', `window, got ${m.firstTs}..${m.lastTs}`);
  expect(!JSON.stringify(agg).includes('secret-file'), 'sanitized --json must not carry a fixture path');
  expect(agg.dir === undefined, 'sanitized --json must not carry the transcript dir');
}

// Markdown report: sanitized labels, exit 0.
const md = run([cli, '--transcripts', fixture]);
expect(md.status === 0, `markdown should exit 0, got ${md.status}`);
expect(/# Context audit/.test(md.stdout), 'markdown header');
expect(/\| git status \| 32 \|/.test(md.stdout), 'markdown family row');
expect(!md.stdout.includes('secret-file'), 'sanitized markdown must not carry a fixture path');
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
  expect(r.tokens?.main?.input === 210 && r.tokens?.main?.cacheRead === 2400, `row main tokens, got ${JSON.stringify(r.tokens)}`);
  expect(r.tokens?.subagents?.input === 7, `row subagent tokens, got ${JSON.stringify(r.tokens?.subagents)}`);
  expect(r.files === 2 && r.turns === 4 && r.durationMs === 600000, `row files/turns/duration, got ${r.files}/${r.turns}/${r.durationMs}`);
  expect(r.toolCalls?.Bash === 1 && r.toolCalls?.Read === 2, `row tool calls, got ${JSON.stringify(r.toolCalls)}`);
  expect(!JSON.stringify(r).includes('secret-file'), 'row must not carry file contents or paths from the transcript');
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
const rc = run([cli, 'receipts', '--ledger', ledger, '--json']);
expect(rc.status === 0, `receipts --json should exit 0, got ${rc.status}: ${rc.stderr}`);
try {
  const r = JSON.parse(rc.stdout);
  expect(r.sessions === 1 && r.usage.input === 217 && r.durationMs === 600000, `receipts aggregate, got ${rc.stdout.slice(0, 200)}`);
} catch { fails.push('receipts --json must parse'); }

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
console.log('\ncontext-audit eval passed');
