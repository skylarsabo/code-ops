#!/usr/bin/env node
// Output-digest regression eval — pins the compressor (scripts/digest-lib.mjs) and its CLI
// (scripts/digest.mjs) against a corpus of synthetic command output, one file per shape.
//
// The claim under test is loss-bounded compression, so the eval measures BOTH sides and refuses
// to let one buy the other:
//   - `mustKeep(shape, raw, digested).ok` holds for every fixture, and the literal lines named in
//     corpus/MUST_KEEP.json survive verbatim;
//   - each fixture meets its measured reduction floor, and the plain passthrough fixture comes
//     back byte-identical;
//   - every raw line is accounted for exactly once: kept, folded into a duplicate count, or
//     inside one elision range, with the printed `[elided N lines: sed -n 'A,Bp' <path>]` markers
//     matching the reported ranges, disjoint, ascending, and never covering a kept line;
//   - the CLI passes the child's exit code through, writes one raw file plus one receipt row,
//     honors `--no-store`, exits 127 on a missing executable and 2 without `--`, keeps a
//     synthetic error line verbatim, and offsets stderr line numbers past the stdout section so
//     the recovery hints address the raw file correctly;
//   - the mutation control: `capTail` applied ALONE to the diagnostics fixture (outside the
//     pipeline that protects must-keep lines) makes `mustKeep` report missing lines, so the
//     contract is proven able to fail rather than trivially true.
//
//   node evals/digest/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const cli = join(root, 'scripts', 'digest.mjs');
const corpus = join(here, 'corpus');
const lib = await import(pathToFileURL(join(root, 'scripts', 'digest-lib.mjs')).href);

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };
const run = (args, opts = {}) => spawnSync('node', args, { encoding: 'utf8', cwd: root, ...opts });
const ELIDE_RE = /^\[elided (\d+) lines(?:: sed -n '(\d+),(\d+)p' (.+))?\]$/;

const spec = JSON.parse(readFileSync(join(corpus, 'MUST_KEEP.json'), 'utf8'));

// Every corpus file is declared, and every declared file exists. A fixture added without an
// expectation would otherwise be scored by nothing at all.
const files = readdirSync(corpus).filter((f) => f.endsWith('.txt')).sort();
expect(files.length >= 11, `the corpus needs one fixture per shape plus passthrough and progress, found ${files.length}`);
for (const f of files) expect(Object.hasOwn(spec.fixtures, f), `corpus/${f} has no entry in MUST_KEEP.json`);
for (const f of Object.keys(spec.fixtures)) expect(files.includes(f), `MUST_KEEP.json names a missing fixture: ${f}`);
const shapesCovered = new Set(Object.values(spec.fixtures).map((x) => x.shape));
for (const shape of Object.keys(lib.SHAPES)) expect(shapesCovered.has(shape), `no fixture exercises the ${shape} shape`);

const measured = [];
for (const f of files) {
  const x = spec.fixtures[f] || {};
  const raw = readFileSync(join(corpus, f), 'utf8');
  const rawLines = raw.split('\n').slice(0, -1);
  const rawPath = `corpus/${f}`;
  const d = lib.digestText(raw, { cwd: x.cwd || process.cwd(), rawPath });
  const out = d.text === '' ? [] : d.text.replace(/\n$/, '').split('\n');

  expect(d.shape === x.shape, `${f}: detected shape ${d.shape}, expected ${x.shape}`);

  const mk = lib.mustKeep(d.shape, raw, d.text);
  expect(mk.ok, `${f}: must-keep violated — ${JSON.stringify(mk.missing.slice(0, 3))}`);
  for (const line of x.contains || []) {
    expect(rawLines.includes(line), `${f}: MUST_KEEP.json names a line the fixture does not contain: ${line}`);
    expect(out.includes(line), `${f}: the digest dropped a declared must-keep line: ${line}`);
  }

  const lineReduction = d.linesIn === 0 ? 0 : 1 - d.linesOut / d.linesIn;
  const byteReduction = d.bytesIn === 0 ? 0 : 1 - d.bytesOut / d.bytesIn;
  measured.push({ f, shape: d.shape, linesIn: d.linesIn, linesOut: d.linesOut, lineReduction, byteReduction });
  expect(lineReduction >= x.minLineReduction, `${f}: line reduction ${(lineReduction * 100).toFixed(1)}% is below the ${(x.minLineReduction * 100).toFixed(0)}% floor`);
  if (x.minByteReduction !== undefined) {
    expect(byteReduction >= x.minByteReduction, `${f}: byte reduction ${(byteReduction * 100).toFixed(1)}% is below the ${(x.minByteReduction * 100).toFixed(0)}% floor`);
  }
  if (x.byteIdentical) expect(d.text === raw, `${f}: a fixture under the cap must pass through byte-identical`);
  if (x.stripped) {
    expect(!d.text.includes(String.fromCharCode(27)), `${f}: an escape sequence survived the digest`);
    expect(!/\r/.test(d.text), `${f}: a carriage return survived the digest`);
    expect(/100%/.test(d.text) && !/ 40%/.test(d.text), `${f}: only the final carriage-return segment should survive`);
  }

  // Elision accounting: the printed markers, the reported ranges, and the kept/folded sets must
  // describe the same partition of the raw line numbers.
  const marks = out.map((l) => ELIDE_RE.exec(l)).filter(Boolean);
  expect(marks.length === d.elisions.length, `${f}: ${marks.length} printed elision markers against ${d.elisions.length} reported ranges`);
  const kept = new Set(d.kept);
  const folded = new Set(d.folded);
  let last = 0;
  marks.forEach((m, i) => {
    const [count, from, to, path] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
    const e = d.elisions[i] || {};
    expect(path === rawPath, `${f}: elision ${i} names ${path}, not the raw path`);
    expect(count === e.count && from === e.from && to === e.to, `${f}: printed elision ${i} (${from},${to},${count}) does not match the reported range ${JSON.stringify(e)}`);
    expect(count === to - from + 1, `${f}: elision ${i} claims ${count} lines for the range ${from},${to}`);
    expect(from > last, `${f}: elision ranges must ascend and not overlap (${from} after ${last})`);
    expect(to <= d.linesIn, `${f}: elision ${i} names line ${to} past the ${d.linesIn}-line raw output`);
    for (let n = from; n <= to; n++) expect(!kept.has(n), `${f}: elision ${i} covers line ${n}, which the digest also kept`);
    last = to;
  });
  let unaccounted = 0;
  for (let n = 1; n <= d.linesIn; n++) {
    if (kept.has(n) || folded.has(n)) continue;
    if (!d.elisions.some((e) => n >= e.from && n <= e.to)) unaccounted++;
  }
  expect(unaccounted === 0, `${f}: ${unaccounted} raw lines are neither kept, folded, nor inside an elision range`);
}

// A stage called bare has no must-keep protection, which is the point: the contract can fail.
{
  const raw = readFileSync(join(corpus, 'diagnostics.txt'), 'utf8');
  const items = lib.itemsOf(lib.normalizedLines(raw));
  const bare = lib.capTail(items, { ...lib.DEFAULTS, protect: new Set(), folded: [] });
  const mk = lib.mustKeep('diagnostics', raw, lib.renderItems(bare, null).join('\n'));
  expect(!mk.ok && mk.missing.length > 0, 'capTail applied alone must violate must-keep — a contract that cannot fail proves nothing');
}

// Long-line truncation keeps the leading characters the contract compares against.
{
  const long = `${'x'.repeat(1200)}\n`;
  const d = lib.digestText(long, { line: 400 });
  expect(d.text.startsWith('x'.repeat(400)), 'truncation must keep the first --line characters');
  expect(/\[\+800 chars\]/.test(d.text), 'truncation must state how many characters it removed');
  expect(lib.mustKeep('plain', long, d.text).ok, 'a truncated line must still satisfy must-keep');
}

// ---------------------------------------------------------------- the CLI

const tmp = mkdtempSync(join(tmpdir(), 'digest-'));
const store = join(tmp, 'store');

const e3 = run([cli, '--store', store, '--', 'node', '-e', "console.log('a'); console.log('b'); process.exit(3)"]);
expect(e3.status === 3, `the child's exit code must pass through, got ${e3.status}`);
const trailer = e3.stdout.trim().split('\n').pop();
const tm = /^\[exit (\d+) · (\S+) · (\d+) lines → (\d+) · raw (.+) · sha256:([0-9a-f]{12})\]$/.exec(trailer || '');
expect(tm !== null, `the last line must be the trailer, got ${JSON.stringify(trailer)}`);
if (tm) {
  expect(tm[1] === '3', `the trailer must carry the exit code, got ${tm[1]}`);
  expect(tm[2] === 'plain', `the trailer must name the shape, got ${tm[2]}`);
  expect(existsSync(tm[5]), `the trailer must name a raw file that exists: ${tm[5]}`);
  if (existsSync(tm[5])) expect(readFileSync(tm[5], 'utf8') === 'a\nb\n', 'the raw file holds the untouched output');
}
const ledger = join(store, 'DIGEST_RECEIPTS.jsonl');
expect(existsSync(ledger), 'the store must carry DIGEST_RECEIPTS.jsonl');
if (existsSync(ledger)) {
  const rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  expect(rows.length === 1, `one receipt row per run, got ${rows.length}`);
  const r = rows[0] || {};
  expect(r.v === 1 && r.exit === 3 && r.shape === 'plain', `receipt identity, got ${JSON.stringify(r).slice(0, 160)}`);
  expect(Array.isArray(r.argv) && r.argv.join(' ').startsWith('node -e'), 'the receipt records the argv as given');
  expect(typeof r.sha256 === 'string' && r.sha256.length === 64 && r.raw === (tm ? tm[5] : ''), 'the receipt binds the raw file and its digest');
  expect(r.linesIn === 2 && r.bytesIn === 4, `receipt line and byte counts, got ${r.linesIn}/${r.bytesIn}`);
}

const noStore = run([cli, '--no-store', '--', 'node', '-e', "console.log('x')"]);
expect(noStore.status === 0, `--no-store should exit with the child's code, got ${noStore.status}`);
expect(/ · raw - · /.test(noStore.stdout), `--no-store must report no raw path, got ${JSON.stringify(noStore.stdout.trim().split('\n').pop())}`);
expect(!/sed -n/.test(noStore.stdout), '--no-store must not print an unrecoverable sed hint');

expect(run([cli, '--no-store', '--', 'a-command-that-does-not-exist-42']).status === 127, 'a missing executable must exit 127');
const spawnErr = run([cli, '--no-store', '--', 'a-command-that-does-not-exist-42']);
expect(/^digest: cannot spawn a-command-that-does-not-exist-42/m.test(spawnErr.stderr), `the spawn failure must name the executable, got ${spawnErr.stderr.trim()}`);
expect(run([cli, 'node', '-e', '1']).status === 2, 'a command without -- must exit 2');
expect(run([cli]).status === 2, 'no arguments must exit 2');
expect(run([cli, '--shape', 'nosuchshape', '--', 'node', '-e', '1']).status === 2, 'an unknown shape must exit 2');

// A synthetic error line survives the CLI verbatim, even when the surrounding output is capped.
const errRun = run([cli, '--no-store', '--', 'node', '-e',
  "for (let i=0;i<400;i++) console.log('routine line ' + i); console.log('the widget cannot be resolved');"]);
expect(errRun.status === 0, `the error-line run should exit 0, got ${errRun.status}`);
expect(errRun.stdout.split('\n').includes('the widget cannot be resolved'), 'an error line must survive verbatim');
expect(errRun.stdout.split('\n').length < 200, 'the digest must still cap a 401-line output');

// --json carries the same parts, and stderr line numbers are offset past the stdout section so
// the sed hints address the raw file rather than the stderr stream.
const both = run([cli, '--store', store, '--json', '--', 'node', '-e',
  "for (let i=0;i<300;i++) console.log('out ' + i); for (let i=0;i<300;i++) console.error('err ' + i);"]);
expect(both.status === 0, `the two-stream run should exit 0, got ${both.status}: ${both.stderr}`);
let parsed = null;
try { parsed = JSON.parse(both.stdout); } catch { fails.push('--json output must parse'); }
if (parsed) {
  expect(typeof parsed.shape === 'string' && typeof parsed.exit === 'number', '--json carries the shape and exit code');
  expect(parsed.stdout.includes('out 0') && parsed.stderr.includes('err 0'), '--json keeps both streams apart');
  expect(/^\[exit 0 · /.test(parsed.trailer), '--json carries the trailer');
  expect(parsed.receipt && existsSync(parsed.receipt.raw), '--json carries a receipt naming an existing raw file');
  if (parsed.receipt && existsSync(parsed.receipt.raw)) {
    const rawFile = readFileSync(parsed.receipt.raw, 'utf8').split('\n');
    expect(rawFile[300] === '----- stderr -----', `the raw file separates the streams at line 301, got ${JSON.stringify(rawFile[300])}`);
    const errMarks = parsed.stderr.split('\n').map((l) => ELIDE_RE.exec(l)).filter(Boolean);
    expect(errMarks.length > 0, 'the stderr digest should elide something at 300 lines');
    for (const m of errMarks) {
      expect(Number(m[2]) > 301, `a stderr elision must address the raw file past the separator, got line ${m[2]}`);
      expect(Number(m[3]) <= rawFile.length, `a stderr elision must stay inside the raw file, got line ${m[3]}`);
    }
  }
}

rmSync(tmp, { recursive: true, force: true });

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\ndigest eval FAILED (${fails.length})`);
  process.exit(1);
}
for (const m of measured) {
  console.log(`ok   ${m.f.padEnd(18)} ${m.shape.padEnd(12)} ${String(m.linesIn).padStart(4)} -> ${String(m.linesOut).padStart(4)} lines  ${(m.lineReduction * 100).toFixed(1).padStart(5)}% fewer  ${(m.byteReduction * 100).toFixed(1).padStart(5)}% fewer bytes`);
}
console.log('ok   must-keep holds on every fixture; capTail alone violates it');
console.log('ok   every raw line is kept, folded, or inside one elision range');
console.log('ok   the CLI passes the exit code through, stores one raw file and one receipt row');
console.log('\ndigest eval passed');
