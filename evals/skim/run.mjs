#!/usr/bin/env node
// Skim regression eval — pins the read-side outline tool (scripts/skim.mjs) against fixtures
// under evals/skim/fixture/:
//   - every outline line number matches the fixture's own line number for that construct;
//   - Markdown sections partition the file flatly, so the spans sum to the file's length;
//   - the outline of a code file prints structure and never a body line, which is the whole
//     token guarantee (the fixture's bodies carry a token that must never appear);
//   - `--range A,B` prints exactly the requested gutter lines, `--range A` prints 41, and a
//     range past end-of-file clamps instead of inventing lines;
//   - `--max` truncates out loud with a `+N more` line rather than silently;
//   - a binary file prints its header and `binary`, a missing file exits 1, a bad flag exits 2;
//   - `--json` parses and carries exactly the entries the text outline printed.
//
//   node evals/skim/run.mjs   (exit 0 = pass)

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const cli = join(root, 'scripts', 'skim.mjs');
const fixture = (name) => join(here, 'fixture', name);

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };
const run = (args) => spawnSync('node', [cli, ...args], { encoding: 'utf8', cwd: root });
const rows = (stdout) => stdout.split('\n').filter((l) => l !== '');
// The fixture's own line number for the first line matching `re`, counting from 1.
const lineOf = (name, re) => readFileSync(fixture(name), 'utf8').split('\n').findIndex((l) => re.test(l)) + 1;
const entryLines = (stdout) => rows(stdout).slice(1).map((l) => Number(/^\s*(\d+):/.exec(l)?.[1]));

// Markdown: one row per real heading, line numbers from the fixture, flat spans that sum to
// the file's length (the fixture's first line is its first heading, so nothing sits above it).
const md = run([fixture('doc.md')]);
expect(md.status === 0, `markdown outline should exit 0, got ${md.status}: ${md.stderr}`);
const mdRows = rows(md.stdout);
const mdLines = readFileSync(fixture('doc.md'), 'utf8').replace(/\n$/, '').split('\n');
expect(mdRows[0] === `${fixture('doc.md')} · ${mdLines.length} lines · ${readFileSync(fixture('doc.md')).length} bytes · markdown`, `markdown header, got ${mdRows[0]}`);
expect(mdRows.length === 6, `five headings plus the header, got ${mdRows.length}`);
expect(entryLines(md.stdout).join(',') === '1,5,9,13,22', `heading line numbers, got ${entryLines(md.stdout).join(',')}`);
expect(/^ 9: h3 Nested subsection \[4\]$/m.test(md.stdout), `the nested heading keeps its level and span, got:\n${md.stdout}`);
const spans = mdRows.slice(1).map((l) => Number(/\[(\d+)\]$/.exec(l)?.[1]));
expect(spans.reduce((a, b) => a + b, 0) === mdLines.length, `flat spans sum to the file length (${mdLines.length}), got ${spans.join('+')}`);
expect(!/not a heading/.test(md.stdout), 'a heading inside a fenced block is code, not structure');

// Code: definitions, imports and exports with real line numbers, and no body content at all.
const js = run([fixture('mod.mjs')]);
expect(js.status === 0, `code outline should exit 0, got ${js.status}: ${js.stderr}`);
expect(!js.stdout.includes('ZZBODYTOKEN'), `the outline must print no body line, got:\n${js.stdout}`);
expect(rows(js.stdout).length === 10, `two imports, two consts, two functions, one class, two exports, got ${rows(js.stdout).length - 1} entries`);
expect(new RegExp(`^${lineOf('mod.mjs', /^export function alpha/)}: fn +alpha$`, 'm').test(js.stdout), `alpha at its own line, got:\n${js.stdout}`);
expect(new RegExp(`^${lineOf('mod.mjs', /^export class Gamma/)}: class +Gamma$`, 'm').test(js.stdout), 'Gamma at its own line');
expect(!/ method$/m.test(js.stdout), 'an indented class member is not a top-level definition');
const jsDefs = run([fixture('mod.mjs'), '--defs']);
expect(rows(jsDefs.stdout).length === 6, `--defs drops the imports and exports, got ${rows(jsDefs.stdout).length - 1} entries`);
expect(!/import|export/.test(jsDefs.stdout.split('\n').slice(1).join('\n')), '--defs prints declarations only');

const py = run([fixture('sample.py')]);
expect(py.status === 0, `python outline should exit 0, got ${py.status}: ${py.stderr}`);
expect(!py.stdout.includes('ZZPYBODY'), `the python outline must print no body line, got:\n${py.stdout}`);
expect(entryLines(py.stdout).join(',') === `2,3,${lineOf('sample.py', /^def first/)},${lineOf('sample.py', /^class Second/)},${lineOf('sample.py', /^async def third/)}`, `python line numbers, got ${entryLines(py.stdout).join(',')}`);

// JSON: top-level keys only, at their own lines, with array lengths from a real parse.
const jsonFixture = run([fixture('data.json')]);
expect(entryLines(jsonFixture.stdout).join(',') === '2,3,4,5,9', `top-level key line numbers, got ${entryLines(jsonFixture.stdout).join(',')}`);
expect(/^4: key tags \[3\]$/m.test(jsonFixture.stdout) && /^9: key empty \[0\]$/m.test(jsonFixture.stdout), `array lengths, got:\n${jsonFixture.stdout}`);
expect(!/inner/.test(jsonFixture.stdout), 'a nested key is not top-level structure');

// JSONL: the header carries the record count, the outline the first record's keys.
const jsonl = run([fixture('records.jsonl')]);
expect(/ 3 lines /.test(jsonl.stdout), `jsonl header counts records, got ${rows(jsonl.stdout)[0]}`);
expect(rows(jsonl.stdout).slice(1).join('|') === '1: key id|1: key kind|1: key note', `first-record keys, got ${rows(jsonl.stdout).slice(1).join('|')}`);

// Plain text: the first five lines plus every section marker, and no filler body line.
const txt = run([fixture('plain.txt')]);
expect(rows(txt.stdout).length === 13, `five preview rows, seven markers, one header, got ${rows(txt.stdout).length}`);
expect(!/body line/.test(txt.stdout), 'an unstructured file still prints no body');
expect(/^ 51: marker == section 50 ==$/m.test(txt.stdout), `markers keep their line numbers, got:\n${txt.stdout}`);

// Ranges: the read primitive. Exact width, the 40-line default, and a clamp past end-of-file.
const three = run([fixture('plain.txt'), '--range', '10,12']);
expect(three.status === 0 && rows(three.stdout).length === 3, `--range 10,12 prints three lines, got ${rows(three.stdout).length}`);
expect(rows(three.stdout).every((l, i) => l.startsWith(`${10 + i}  `)), `gutters carry the real line numbers, got:\n${three.stdout}`);
expect(rows(three.stdout)[0].endsWith('body line 9 filler'), `the gutter's text is the file's own line, got ${rows(three.stdout)[0]}`);
const forty = run([fixture('plain.txt'), '--range', '5']);
expect(rows(forty.stdout).length === 41, `--range 5 prints 41 lines (5 through 45), got ${rows(forty.stdout).length}`);
const clamped = run([fixture('plain.txt'), '--range', '395,500']);
expect(rows(clamped.stdout).length === 6, `a range past end-of-file clamps to 6 lines, got ${rows(clamped.stdout).length}`);
const wayPast = run([fixture('plain.txt'), '--range', '900,950']);
expect(rows(wayPast.stdout).length === 1, `a range wholly past end-of-file clamps to the last line, got ${rows(wayPast.stdout).length}`);
expect(rows(clamped.stdout).length + 0 === 6 && /^400 /.test(rows(clamped.stdout)[5]), `the clamp ends at the last real line, got ${rows(clamped.stdout)[5]}`);

// Truncation is announced, never silent.
const capped = run([fixture('plain.txt'), '--max', '3']);
expect(rows(capped.stdout).length === 5, `--max 3 prints a header, three rows, and one more-line, got ${rows(capped.stdout).length}`);
expect(rows(capped.stdout)[4] === '+9 more (use --range)', `the truncation line names the count, got ${rows(capped.stdout)[4]}`);

// Binary, missing file, bad invocation.
const bin = run([fixture('blob.bin')]);
expect(bin.status === 0 && rows(bin.stdout).length === 2 && rows(bin.stdout)[1] === 'binary', `a binary file prints its header and binary, got:\n${bin.stdout}`);
expect(/· binary$/.test(rows(bin.stdout)[0]), `the binary header names the kind, got ${rows(bin.stdout)[0]}`);
expect(run([fixture('blob.bin'), '--range', '1,2']).status === 1, 'a range over a binary file exits 1');
const missing = run([join(here, 'fixture', 'no-such-file.md')]);
expect(missing.status === 1, `a missing file exits 1, got ${missing.status}`);
expect(missing.stdout === '', 'a missing file prints nothing to stdout');
expect(run([fixture('doc.md'), '--nope']).status === 2, 'an unknown flag exits 2');
expect(run([]).status === 2, 'no file argument exits 2');
expect(run([fixture('doc.md'), '--range', 'x']).status === 2, 'a malformed range exits 2');
expect(run([fixture('doc.md'), '--max', '0']).status === 2, '--max 0 exits 2');

// --json carries exactly what the text outline printed.
for (const name of ['doc.md', 'mod.mjs', 'sample.py', 'data.json', 'records.jsonl', 'plain.txt']) {
  const text = run([fixture(name)]);
  const asJson = run([fixture(name), '--json']);
  expect(asJson.status === 0, `--json should exit 0 for ${name}, got ${asJson.status}: ${asJson.stderr}`);
  let parsed = null;
  try { parsed = JSON.parse(asJson.stdout); } catch { fails.push(`--json output must parse for ${name}`); }
  if (!parsed) continue;
  expect(parsed.outline.length === rows(text.stdout).length - 1, `${name}: --json outline.length must equal the text entry count, got ${parsed.outline.length} vs ${rows(text.stdout).length - 1}`);
  expect(parsed.path === fixture(name) && parsed.bytes === readFileSync(fixture(name)).length, `${name}: --json path and byte count`);
  expect(parsed.outline.every((e) => Number.isInteger(e.line) && typeof e.kind === 'string' && typeof e.name === 'string' && (e.span === null || Number.isInteger(e.span))), `${name}: every --json entry has line, kind, name, span`);
  expect(parsed.outline.map((e) => e.line).join(',') === entryLines(text.stdout).join(','), `${name}: --json line numbers match the text outline`);
}
const cappedJson = JSON.parse(run([fixture('plain.txt'), '--max', '3', '--json']).stdout);
expect(cappedJson.outline.length === 3 && cappedJson.omitted === 9, `--json honors --max and reports what it dropped, got ${cappedJson.outline.length}/${cappedJson.omitted}`);

if (fails.length) {
  for (const f of fails) console.error(`  x ${f}`);
  console.error(`\nskim eval FAILED (${fails.length})`);
  process.exit(1);
}
console.log('ok   outline line numbers, flat Markdown spans, definitions without bodies');
console.log('ok   ranges print exactly what was asked and clamp at end-of-file');
console.log('ok   truncation announced, binary and missing files handled, --json matches the text');
console.log('\nskim eval passed');
