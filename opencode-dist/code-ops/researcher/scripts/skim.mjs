#!/usr/bin/env node
// File outline for range reading: see a file's structure, then read the range you need.
//
// WHY: reads are the largest single slice of an operative's context, and most of that is a
// whole file read to reach a few lines of it. This prints the file's shape (headings,
// definitions, keys, sizes, line numbers), so the next call is `--range A,B` instead of
// another whole read. It is the read-side counterpart of the output digest.
//
//   node scripts/skim.mjs <file> [--range A,B] [--defs] [--max <n>] [--json]
//
// The token guarantee: outline mode prints structure, never bodies. Headings, definition
// names, and keys only, each truncated to 80 characters, plus, for an unstructured text
// file that has no such structure to report, its first five lines. File content beyond that
// reaches stdout only through `--range`, which the caller asked for by line number.
//
// Truncation is always announced: an outline longer than `--max` ends with a `+N more` line,
// and a shortened name ends in `...`.
//
// Exit 0 = printed; 1 = a missing or unreadable file, or a binary file under `--range`;
// 2 = bad invocation.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const NAME_MAX = 80;
const trunc = (s) => {
  const t = s.trim();
  return t.length > NAME_MAX ? `${t.slice(0, NAME_MAX - 3)}...` : t;
};
const usage = (message) => {
  console.error(`x ${message}`);
  console.error('usage: node scripts/skim.mjs <file> [--range A,B] [--defs] [--max <n>] [--json]');
  process.exit(2);
};

// Definition regexes copied from the RULES table in scripts/repo-map.mjs, deliberately as a
// copy: repo-map.mjs walks the whole tree at import time, so it cannot be imported for its
// table alone. Coarse by design — a map, not a parser. Import and export rows are this
// file's own addition, because an operative orienting in a module wants its edges too.
const JS_DEFS = [
  [/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/, 'fn'],
  [/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/, 'const'],
];
const JS = { defs: JS_DEFS, imports: /^\s*(?:import[\s({]|(?:const|let|var)\s+.*\brequire\()/, exports: /^\s*(?:export\b|module\.exports\b)/ };
const CODE = {
  '.js': JS, '.mjs': JS, '.cjs': JS, '.jsx': JS, '.ts': JS, '.tsx': JS,
  '.py': { defs: [[/^(?:async\s+)?def\s+(\w+)/, 'def'], [/^class\s+(\w+)/, 'class']], imports: /^\s*(?:import|from)\s/, exports: null },
  '.go': { defs: [[/^func\s+(?:\([^)]*\)\s*)?(\w+)/, 'func'], [/^type\s+(\w+)/, 'type']], imports: /^\s*import[\s(]/, exports: null },
  '.rs': {
    defs: [
      [/^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/, 'fn'],
      [/^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+(\w+)/, 'type'],
      [/^impl(?:<[^>]*>)?\s+([\w:]+)/, 'impl'],
    ],
    imports: /^\s*(?:pub\s+)?use\s/, exports: null,
  },
  '.java': { defs: [[/^\s{0,4}(?:public|protected|private)?\s*(?:abstract\s+|static\s+|final\s+|sealed\s+)*(?:class|interface|record|enum)\s+(\w+)/, 'type']], imports: /^\s*import\s/, exports: null },
  '.cs': { defs: [[/^\s{0,4}(?:public|internal|protected|private)?\s*(?:abstract\s+|static\s+|sealed\s+|partial\s+)*(?:class|interface|record|struct|enum)\s+(\w+)/, 'type']], imports: /^\s*using\s+[A-Za-z_]/, exports: null },
};

const argv = process.argv.slice(2);
let file = null, range = null, defsOnly = false, max = 120, asJson = false;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  const need = (flag) => {
    const value = argv[++i];
    if (value === undefined || value.trim() === '' || value.startsWith('--')) usage(`${flag} needs a value`);
    return value;
  };
  if (arg === '--range') range = parseRange(need('--range'));
  else if (arg === '--defs') defsOnly = true;
  else if (arg === '--json') asJson = true;
  else if (arg === '--max') {
    max = Number(need('--max'));
    if (!Number.isInteger(max) || max < 1) usage('--max needs a positive integer');
  } else if (arg.startsWith('--')) usage(`unknown flag: ${arg}`);
  else if (file === null) file = arg;
  else usage('one file at a time');
}
if (file === null) usage('a file path is required');

function parseRange(spec) {
  const m = /^(\d+)(?:,(\d+))?$/.exec(spec.trim());
  if (!m) usage('--range takes A or A,B');
  const a = Number(m[1]);
  if (a < 1) usage('--range starts at line 1');
  const b = m[2] === undefined ? a + 40 : Number(m[2]);
  if (b < a) usage('--range end must not precede its start');
  return { a, b };
}

let buf;
try { buf = readFileSync(file); } catch (error) { console.error(`x cannot read ${file}: ${error.code || error.message}`); process.exit(1); }

const binary = buf.subarray(0, 8192).includes(0);
let lines = [];
if (!binary) {
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  if (text.endsWith('\n')) text = text.slice(0, -1);
  lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}
// A binary file is never decoded; its line count is its newline bytes.
let lineCount = lines.length;
if (binary) {
  let newlines = 0;
  for (const byte of buf) if (byte === 0x0A) newlines++;
  lineCount = newlines + (buf.length > 0 && buf[buf.length - 1] !== 0x0A ? 1 : 0);
}

if (range) {
  if (binary) { console.error(`x ${file} is binary; --range reads text`); process.exit(1); }
  const from = Math.min(Math.max(range.a, 1), lines.length);
  const to = Math.min(range.b, lines.length);
  const width = String(to).length;
  for (let n = from; n <= to; n++) console.log(`${String(n).padStart(width)}  ${lines[n - 1]}`);
  process.exit(0);
}

const ext = extname(file).toLowerCase();
const kind = binary ? 'binary'
  : ext === '.md' || ext === '.markdown' ? 'markdown'
    : ext === '.json' ? 'json'
      : ext === '.jsonl' || ext === '.ndjson' ? 'jsonl'
        : Object.hasOwn(CODE, ext) ? 'code' : 'text';

// Markdown sections partition the file flatly: a heading owns every line down to the next
// heading of any level. Flat, not nested, so the spans of a file sum to its length below the
// first heading, and no line is counted twice. Headings inside a fence are code, not structure.
function markdownOutline() {
  const heads = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const fenced = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (fenced) {
      if (fence === null) fence = fenced[1][0];
      else if (fenced[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^(#{1,6})\s+(.+)$/.exec(lines[i]);
    if (m) heads.push({ line: i + 1, kind: `h${m[1].length}`, name: trunc(m[2]), span: 0 });
  }
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].line - 1 : lines.length;
    heads[i].span = end - heads[i].line + 1;
  }
  return heads;
}

function codeOutline() {
  const rules = CODE[ext];
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let matched = false;
    for (const [re, defKind] of rules.defs) {
      const m = re.exec(line);
      if (m) { out.push({ line: i + 1, kind: defKind, name: trunc(m[1]), span: null }); matched = true; break; }
    }
    if (matched) continue;
    if (rules.imports && rules.imports.test(line)) out.push({ line: i + 1, kind: 'import', name: trunc(line), span: null });
    else if (rules.exports && rules.exports.test(line)) out.push({ line: i + 1, kind: 'export', name: trunc(line), span: null });
  }
  return out;
}

// Top-level keys and their line numbers come from a depth scan, so a malformed document still
// yields an outline; array lengths come from a real parse, so a malformed one simply omits them.
function jsonOutline() {
  const text = lines.join('\n');
  const out = [];
  let depth = 0, line = 1, inString = false, escaped = false, value = '', valueLine = 0, last = null, lastLine = 0;
  for (const ch of text) {
    if (ch === '\n') { line++; continue; }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') { inString = false; last = value; lastLine = valueLine; }
      else value += ch;
      continue;
    }
    if (ch === '"') { inString = true; value = ''; valueLine = line; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ':' && depth === 1 && last !== null) {
      out.push({ line: lastLine, kind: 'key', name: trunc(last), span: null });
      last = null;
    }
  }
  let root = null;
  try { root = JSON.parse(text); } catch { /* an unparseable document still has keys and lines */ }
  if (Array.isArray(root)) return [{ line: 1, kind: 'array', name: '(root array)', span: root.length }];
  if (root && typeof root === 'object') {
    for (const entry of out) if (Array.isArray(root[entry.name])) entry.span = root[entry.name].length;
  }
  return out;
}

function jsonlOutline() {
  const index = lines.findIndex((l) => l.trim() !== '');
  if (index === -1) return [];
  let record = null;
  try { record = JSON.parse(lines[index]); } catch { return []; }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
  return Object.keys(record).map((key) => ({ line: index + 1, kind: 'key', name: trunc(key), span: null }));
}

const MARKERS = [/^#/, /^==/, /^--/, /^\[/];
const shoutedLine = (line) => {
  const t = line.trim();
  return t !== '' && t === t.toUpperCase() && /[A-Z]/.test(t) && t.split(/\s+/).length >= 3;
};
function textOutline() {
  const seen = new Set();
  const out = [];
  const add = (i, entryKind) => {
    if (seen.has(i)) return;
    seen.add(i);
    out.push({ line: i + 1, kind: entryKind, name: trunc(lines[i]), span: null });
  };
  for (let i = 0; i < Math.min(5, lines.length); i++) add(i, 'head');
  for (let i = 0; i < lines.length; i++) {
    if (MARKERS.some((re) => re.test(lines[i])) || shoutedLine(lines[i])) add(i, 'marker');
  }
  return out.sort((a, b) => a.line - b.line);
}

const OUTLINERS = { markdown: markdownOutline, code: codeOutline, json: jsonOutline, jsonl: jsonlOutline, text: textOutline };
let outline = binary ? [] : OUTLINERS[kind]();
// --defs narrows to declarations: definitions, headings, and keys. Import, export, and the
// plain-text preview rows are edges and previews, not declarations.
if (defsOnly) outline = outline.filter((e) => !['import', 'export', 'head'].includes(e.kind));
const omitted = Math.max(0, outline.length - max);
const shown = outline.slice(0, max);

if (asJson) {
  console.log(JSON.stringify({ path: file, lines: lineCount, bytes: buf.length, kind, outline: shown, omitted }, null, 2));
  process.exit(0);
}
console.log(`${file} · ${lineCount} lines · ${buf.length} bytes · ${kind}`);
if (binary) { console.log('binary'); process.exit(0); }
if (shown.length === 0) { console.log('(no outline entries)'); process.exit(0); }
const lineWidth = Math.max(...shown.map((e) => String(e.line).length));
const kindWidth = Math.max(...shown.map((e) => e.kind.length));
// The bracketed number is the section's line count for Markdown and the array's length for JSON.
for (const entry of shown) {
  console.log(`${String(entry.line).padStart(lineWidth)}: ${entry.kind.padEnd(kindWidth)} ${entry.name}${entry.span === null ? '' : ` [${entry.span}]`}`.trimEnd());
}
if (omitted > 0) console.log(`+${omitted} more (use --range)`);
