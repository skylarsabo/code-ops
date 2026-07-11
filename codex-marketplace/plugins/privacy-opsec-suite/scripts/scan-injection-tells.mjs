#!/usr/bin/env node
// Deterministic prompt-injection tell scanner — a mechanical FLOOR under a human/agent audit
// of third-party content an agent ingests (dependency READMEs, vendored skills, MCP tool
// descriptions). It is triage input, never a filter: it surfaces tells cheaply for a reviewer.
//
//   node scripts/scan-injection-tells.mjs <file> [...more] [--fail-on=<categories>]
//
// Categories (all reported; see --fail-on for gating):
//   ZEROWIDTH  zero-width chars (U+200B-200D, U+FEFF) + bidi controls (U+202A-202E, U+2066-2069).
//              A U+200D between two emoji codepoints is an emoji ZWJ join, NOT a tell — exempt.
//   COMMENT    HTML comment carrying an agent-directed imperative (ignore/disregard/execute/run/
//              fetch/send/you must/system:) — a classic "hide it where a human skims past it".
//   OVERRIDE   'ignore (all )?(previous|prior|above) instructions'-family + 'disregard your ...'.
//              Quoting the phrase (in backticks or a string) still hits — flagging a quote is cheap.
//   IMPERATIVE agent-directed imperative in a data position: a line opening 'You are now',
//              'From now on', or 'New instructions:'.
//   BLOB       base64 blob 120+ chars or hex 80+ outside a hash/integrity context (a sha256/384/512
//              integrity attr, a Verified-at hex, and lockfile-style lines are allowlisted).
//   TOOLCALL   tool-call-shaped markup smuggled into content (antml:/function_calls/tool_use tags,
//              or a JSON "tool_calls" key).
//
// Default exit is 0 even with hits — the scan feeds triage, it does not block. Opt in to gating
// with --fail-on=CAT1,CAT2: exit 1 only if one of those categories hit. A misconfigured category
// name fails closed (exit 2) rather than silently gating nothing.

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const ALL_CATS = ['ZEROWIDTH', 'COMMENT', 'OVERRIDE', 'IMPERATIVE', 'BLOB', 'TOOLCALL'];

const argv = process.argv.slice(2);
const failOnArg = argv.find((a) => a.startsWith('--fail-on='));
const failOn = new Set();
if (failOnArg) {
  for (const raw of failOnArg.slice('--fail-on='.length).split(',')) {
    const cat = raw.trim().toUpperCase();
    if (!cat) continue;
    if (!ALL_CATS.includes(cat)) {
      console.error(`x --fail-on: unknown category ${raw} (known: ${ALL_CATS.join(', ')})`);
      process.exit(2); // fail closed on a malformed gate config rather than gating nothing
    }
    failOn.add(cat);
  }
}
const files = argv.filter((a) => !a.startsWith('--'));

// --- ZEROWIDTH: character-level, with the emoji-ZWJ carve-out ---
const isEmojiCp = (cp) =>
  (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x1f1e6 && cp <= 0x1f1ff) ||
  (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff) ||
  cp === 0x2764 || (cp >= 0x2190 && cp <= 0x21ff);
// True if the code point in direction `dir` from i (skipping variation selectors) is an emoji.
function neighborIsEmoji(cps, i, dir) {
  for (let j = i + dir; j >= 0 && j < cps.length; j += dir) {
    const cp = cps[j].codePointAt(0);
    if (cp === 0xfe0f || cp === 0xfe0e) continue; // variation selector — look past it
    return isEmojiCp(cp);
  }
  return false;
}
function zeroWidthHit(line) {
  const cps = Array.from(line);
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i].codePointAt(0);
    const isZW = cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff;
    const isBidi = (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);
    if (!isZW && !isBidi) continue;
    if (cp === 0x200d && neighborIsEmoji(cps, i, -1) && neighborIsEmoji(cps, i, 1)) continue;
    return true;
  }
  return false;
}

// --- line-level regex tells ---
const OVERRIDE_RES = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/i,
  /\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|your)\s+(?:instructions?|prompt|guidance)\b/i,
];
const IMPERATIVE_RE = /^\s*(?:[>*\-#]+\s*)?(?:you are now|from now on|new instructions:)/i;
const TOOLCALL_RES = [
  /<\/?\s*antml:[a-z_]+/i,
  /<\/?\s*(?:function_calls|invoke|tool_use|tool_call|function_results)\b/i,
  /["']tool_calls["']\s*:/i,
];
// HTML comment (may span lines) whose body carries an agent-directed imperative.
const COMMENT_RE = /<!--([\s\S]*?)-->/g;
const COMMENT_IMPERATIVE = /\b(?:ignore|disregard|execute|run|fetch|send|you must)\b|system:/i;
// A line that is a legitimate integrity/hash context — its long token is a checksum, not a payload.
const HASH_CONTEXT = /integrity\s*[=:]|sha(?:256|384|512)-|verified-at|["']integrity["']\s*:|^\s*resolved\s+["']/i;
const BASE64_BLOB = /[A-Za-z0-9+/]{120,}={0,2}/;
const HEX_BLOB = /\b[0-9a-fA-F]{80,}\b/;

// Render invisible tells (zero-width, bidi controls) as a visible middot so the snippet is legible.
const INVISIBLE_RE = /[\u200B-\u200D\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const snippet = (s) => s.replace(INVISIBLE_RE, "·").trim().slice(0, 70);

function scanText(text) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const at = i + 1;
    if (zeroWidthHit(line)) hits.push({ cat: 'ZEROWIDTH', line: at, snippet: snippet(line) });
    if (OVERRIDE_RES.some((re) => re.test(line))) hits.push({ cat: 'OVERRIDE', line: at, snippet: snippet(line) });
    if (IMPERATIVE_RE.test(line)) hits.push({ cat: 'IMPERATIVE', line: at, snippet: snippet(line) });
    if (TOOLCALL_RES.some((re) => re.test(line))) hits.push({ cat: 'TOOLCALL', line: at, snippet: snippet(line) });
    if (!HASH_CONTEXT.test(line) && (BASE64_BLOB.test(line) || HEX_BLOB.test(line)))
      hits.push({ cat: 'BLOB', line: at, snippet: snippet(line) });
  });
  // COMMENT can span lines; scan the whole text and map the match back to its opening line.
  COMMENT_RE.lastIndex = 0;
  for (const m of text.matchAll(COMMENT_RE)) {
    if (!COMMENT_IMPERATIVE.test(m[1])) continue;
    const at = text.slice(0, m.index).split('\n').length;
    hits.push({ cat: 'COMMENT', line: at, snippet: snippet(m[0]) });
  }
  return hits;
}

const targets = [];
for (const f of files) {
  if (!existsSync(f)) { console.error(`x not found: ${f}`); process.exitCode = 2; continue; }
  targets.push({ label: basename(f), text: readFileSync(f, 'utf8') });
}
if (targets.length === 0) { console.error('usage: scan-injection-tells.mjs <file> [...] [--fail-on=<categories>]'); process.exit(2); }

let total = 0;
const gatedHit = [];
for (const t of targets) {
  const hits = scanText(t.text).sort((a, b) => a.line - b.line || a.cat.localeCompare(b.cat));
  total += hits.length;
  const counts = {};
  for (const h of hits) {
    counts[h.cat] = (counts[h.cat] || 0) + 1;
    if (failOn.has(h.cat)) gatedHit.push(`${t.label}:${h.line} ${h.cat}`);
  }
  console.log(`\n# ${t.label}${hits.length ? '' : '  — clean'}`);
  for (const h of hits) console.log(`  !! ${h.cat.padEnd(11)} ${h.line ? 'L' + h.line : '  '}  ${h.snippet}`);
  if (hits.length) console.log(`  . ${ALL_CATS.filter((c) => counts[c]).map((c) => `${c}=${counts[c]}`).join('  ')}`);
}
console.log(`\n${total} injection tell(s) across ${targets.length} target(s)${failOn.size ? ` — gating on ${[...failOn].join(',')}` : ' (report-only)'}.`);
if (gatedHit.length > 0) {
  console.error(`Gated injection tell(s) found: ${gatedHit.join(', ')} (fail-closed via --fail-on).`);
  process.exit(1);
}
