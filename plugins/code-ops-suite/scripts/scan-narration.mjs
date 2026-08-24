#!/usr/bin/env node
// Deterministic run-artifact prose scanner — the mechanical floor under length/register
// discipline for run summaries (EXECUTIVE_SUMMARY.md and similar), sibling to
// scan-ai-tells.mjs (which scans commit/PR text, not run artifacts).
//
// WHY: the doctrine that a lead's report is a compact synthesis, not a narrated transcript
// (CLAUDE.md "lead's reports are compact syntheses"; suite CONVENTIONS §12 "Length discipline
// for run summaries") had no mechanical backstop — only a reviewer's eye. This catches the
// mechanical half: length, first-person play-by-play, wholesale register restatement, filler.
//
//   node scripts/scan-narration.mjs <file> [...more] [--report-only]
//
// Scans run-artifact TEXT for:
//   LENGTH             non-blank line count over the "roughly one page" bound (advisory at
//                      ADVISORY_LINES, hard at HARD_LINES). Register-shaped files (basename
//                      matches /register/i) are exempt from this flat file-level cap and are
//                      instead checked per-entry — see REGISTER_ENTRY_* below.
//   PROCESS-NARRATION  first-person / play-by-play run narration ("I then", "let me", ...)
//   RESTATEMENT        an EXECUTIVE_SUMMARY-shaped file inlining 5+ consecutive register
//                      table rows instead of linking to the register
//   FILLER             hedging/ceremony phrases ("it is worth noting", "in conclusion", ...)
//
// Exit: a single tallied verdict, fail-closed wins over hits. 2 = a missing target file or a
// usage/config error (no target, unknown flag) — reported even when hits were also found,
// never silently downgraded to 1. Otherwise 1 = a HARD violation found (LENGTH > HARD_LINES,
// or any PROCESS-NARRATION hit) unless --report-only, 0 = clean or advisory-only.

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const USAGE = 'usage: scan-narration.mjs <file> [...more] [--report-only] [--help]';

const argv = process.argv.slice(2);
let reportOnly = false;
const files = [];
for (const a of argv) {
  if (a === '--help' || a === '-h') { console.log(USAGE); process.exit(0); }
  else if (a === '--report-only') reportOnly = true;
  // An unrecognized --flag must not fall through to "treat it as a file" — a typo'd flag would
  // otherwise silently scan nothing relevant and report clean.
  else if (a.startsWith('--')) { console.error(`x unknown argument: ${a}`); process.exit(2); }
  else files.push(a);
}

// The "roughly one page" bound from CONVENTIONS §12 (length discipline for run summaries):
// advisory once a report drifts past a page, hard once it's clearly a transcript, not a synthesis.
const ADVISORY_LINES = 60;
const HARD_LINES = 120;

// A register file (basename matches /register/i, mirroring how RESTATEMENT below gates on
// /summary/i) is exempt from the flat file-level LENGTH cap above. Calibration evidence from
// two independent real-scale runs (evals/CALIBRATION_TABLE.md, both 2026-07-28 rows) showed the
// flat cap is right for run summaries but wrong for registers: a legitimate 49-finding
// FINDINGS_REGISTER.md blew the 120-line hard cap ~2.5x in both runs while every individual
// entry was tight. The cap's intent (CONVENTIONS §12: registers are live backlogs/SSOT — the
// doctrine is prose discipline, not finding-count suppression) is better served by a per-entry
// budget: a register with 200 tight entries should pass; one 30-line rambling entry should fail.
const isRegisterArtifact = (label) => /register/i.test(label);

// Entry-boundary detection for registers, reused verbatim (ID_RE / ID_IGNORE / isItemId) from
// scripts/revalidate-register.mjs so the two tools agree on where one entry ends and the next
// begins — an item ID like `BUG-007` or `PERF-003` starts a new entry. ID_IGNORE skips common
// standards/identifiers (RFC-2616, CVE-2021-44228, ISO-8601, UTF-8, SHA-256) that legitimately
// appear in a finding's prose without being an item boundary.
// The optional letter before the serial admits a reviewer-round-lettered ID (FND-A12) that the
// digits-only form made invisible; the prefix stays at 2+ chars so a single letter can't start one.
const ID_RE = /\b([A-Z][A-Z0-9]{1,}-[A-Z]?\d{1,6})\b/g;
const ID_IGNORE = new Set(['RFC', 'ISO', 'CVE', 'CWE', 'CAPEC', 'GHSA', 'UTF', 'SHA', 'MD', 'AES', 'RGB', 'HTTP', 'HTTPS', 'IEEE', 'ANSI', 'FIPS', 'NIST', 'PEP', 'ECMA', 'UTC', 'GMT', 'IPV']);
function isItemId(id, after, afterNext) {
  if (ID_IGNORE.has(id.split('-')[0].toUpperCase())) return false;
  // Only a digit after the trailing '-' marks a longer numeric token (CVE-2021-44228); a slug
  // suffix (BUG-042-auth-bypass) is still a real item ID.
  if (after === '-' && /\d/.test(afterNext || '')) return false;
  return true;
}

// Per-entry budget (named constants, not the flat file cap): advisory at 10 non-blank lines,
// hard at 20. Calibrated so a normal Tier/Location/Anchor/... labeled block (CONVENTIONS §12
// schema, ~5-8 lines) passes cleanly while a block that has grown prose padding is flagged.
const REGISTER_ENTRY_ADVISORY_LINES = 10;
const REGISTER_ENTRY_HARD_LINES = 20;
// Preamble (title/intro before the first entry) keeps its own small fixed budget so headers
// stay tight without capping how many entries the register may hold.
const REGISTER_PREAMBLE_ADVISORY_LINES = 15;
const REGISTER_PREAMBLE_HARD_LINES = 30;

const countNonBlank = (lines) => lines.filter((l) => l.replace(/\r$/, '').trim() !== '').length;

// An entry begins only at an ENTRY-HEADING POSITION: the start of a line, optionally behind
// markdown heading markers or a table row's leading pipe (the entry forms in
// code-ops-docs/40 Engineering/Techniques/artifact-grammars.md §(b)). An ID cited mid-line in evidence prose
// ("duplicate of BUG-003") is a reference, not a boundary, and must not split an entry in two.
// Composed from ID_RE's own source so the ID shape cannot drift between the two scans.
const ENTRY_ID_RE = new RegExp('^[ \\t]*(?:#{1,6}[ \\t]+|\\|[ \\t]*)?' + ID_RE.source);

function isEntryHead(line) {
  const m = ENTRY_ID_RE.exec(line);
  return !!m && isItemId(m[1], line[m[0].length], line[m[0].length + 1]);
}

// An entry runs to the last line that BELONGS to it — it is terminated by the next entry head,
// by a covered-negative `NO-FINDINGS:` line, or by a non-entry markdown heading that opens a new
// section (code-ops-docs/40 Engineering/Techniques/artifact-grammars.md §(b) "Where an entry ends"). Without a
// terminator, a register's trailing covered-negative block was charged to its final entry and
// reliably blew that entry's hard bound on a register whose entries were all tight — the same
// budget in calibration-metrics.mjs terminates entries identically.
const NO_FINDINGS_RE = /^[ \t]*NO-FINDINGS:\s*\S/;
const SECTION_HEADING_RE = /^[ \t]*#{1,6}[ \t]+/;
const isEntryTerminator = (line) => NO_FINDINGS_RE.test(line) || (SECTION_HEADING_RE.test(line) && !isEntryHead(line));

function entryEndLine(lines, startLine, nextEntryLine) {
  const limit = nextEntryLine ?? lines.length;
  for (let i = startLine + 1; i < limit; i++) {
    if (isEntryTerminator(lines[i])) return i;
  }
  return nextEntryLine; // undefined = runs to EOF, exactly as before
}

// Locates each entry's start line (0-based) in a register-shaped text. Returns null when the
// text carries no parseable item IDs at an entry position — despite the /register/i filename, it
// isn't actually register-shaped content, so the caller falls back to the flat file-level cap
// instead of silently exempting a free-form doc that merely has "register" in its name.
function findRegisterEntries(text) {
  const lines = text.split('\n').map((raw) => raw.replace(/\r$/, ''));
  const ids = [];
  lines.forEach((line, lineNo) => {
    if (isEntryHead(line)) ids.push({ id: ENTRY_ID_RE.exec(line)[1], startLine: lineNo });
  });
  if (ids.length === 0) return null;
  return ids.map((e, i) => ({
    id: e.id,
    startLine: e.startLine,
    endLine: entryEndLine(lines, e.startLine, i + 1 < ids.length ? ids[i + 1].startLine : undefined),
  }));
}

// Multi-word phrases only (never a bare \bi\b) so acronyms/compounds like "I/O" or "I-node"
// can never trip this — word-boundary phrase matching, not single-letter matching.
const PROCESS_NARRATION_CHECKS = [
  { re: /\bi then\b/i, label: 'I then' },
  { re: /\bnext i\b/i, label: 'next I' },
  { re: /\bwe proceeded to\b/i, label: 'we proceeded to' },
  { re: /\bthe agent then\b/i, label: 'the agent then' },
  { re: /\bafter that\b/i, label: 'after that' },
  { re: /\bi was able to\b/i, label: 'I was able to' },
  { re: /\blet me\b/i, label: 'let me' },
];

const FILLER_CHECKS = [
  { re: /\bit is worth noting\b/i, label: 'it is worth noting' },
  { re: /\bas mentioned above\b/i, label: 'as mentioned above' },
  { re: /\bin conclusion\b/i, label: 'in conclusion' },
  { re: /\bto summarize\b/i, label: 'to summarize' },
  { re: /\bimportantly,/i, label: 'importantly,' },
];

// A register table row: `| cell | cell | ... |`. Requires at least two pipe-delimited cells
// so a single stray '|' in prose (rare, but possible) doesn't count as a row.
const TABLE_ROW_RE = /^\s*\|.+\|.+\|\s*$/;
const RESTATEMENT_RUN_THRESHOLD = 5;
// Restatement only applies to summary-shaped artifacts (EXECUTIVE_SUMMARY.md and similar) —
// a register file itself is *supposed* to be all table rows; only a summary that inlines the
// register wholesale, instead of linking to it (CONVENTIONS §12), is the violation.
const isSummaryArtifact = (label) => /summary/i.test(label);

function scanText(label, text) {
  const lines = text.split('\n');
  const nonBlank = countNonBlank(lines);

  const hits = { hard: [], advisory: [] };

  // Register-shaped files with parseable entries get the per-entry budget instead of the flat
  // file cap; everything else (including a /register/i file with zero parseable IDs) keeps the
  // flat-cap behavior exactly as before.
  const registerEntries = isRegisterArtifact(label) ? findRegisterEntries(text) : null;

  if (registerEntries) {
    const preambleLines = lines.slice(0, registerEntries[0].startLine);
    const preambleNonBlank = countNonBlank(preambleLines);
    if (preambleNonBlank > REGISTER_PREAMBLE_HARD_LINES) hits.hard.push({ cat: 'LENGTH', line: 1, snippet: `preamble: ${preambleNonBlank} non-blank lines (hard bound ${REGISTER_PREAMBLE_HARD_LINES})` });
    else if (preambleNonBlank > REGISTER_PREAMBLE_ADVISORY_LINES) hits.advisory.push({ cat: 'LENGTH', line: 1, snippet: `preamble: ${preambleNonBlank} non-blank lines (advisory bound ${REGISTER_PREAMBLE_ADVISORY_LINES})` });

    for (const e of registerEntries) {
      const entryLines = lines.slice(e.startLine, e.endLine ?? lines.length);
      const entryNonBlank = countNonBlank(entryLines);
      if (entryNonBlank > REGISTER_ENTRY_HARD_LINES) hits.hard.push({ cat: 'LENGTH', line: e.startLine + 1, snippet: `${e.id}: ${entryNonBlank} non-blank lines (hard per-entry bound ${REGISTER_ENTRY_HARD_LINES})` });
      else if (entryNonBlank > REGISTER_ENTRY_ADVISORY_LINES) hits.advisory.push({ cat: 'LENGTH', line: e.startLine + 1, snippet: `${e.id}: ${entryNonBlank} non-blank lines (advisory per-entry bound ${REGISTER_ENTRY_ADVISORY_LINES})` });
    }
  } else {
    if (nonBlank > HARD_LINES) hits.hard.push({ cat: 'LENGTH', line: 0, snippet: `${nonBlank} non-blank lines (hard bound ${HARD_LINES})` });
    else if (nonBlank > ADVISORY_LINES) hits.advisory.push({ cat: 'LENGTH', line: 0, snippet: `${nonBlank} non-blank lines (advisory bound ${ADVISORY_LINES})` });
  }

  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    for (const c of PROCESS_NARRATION_CHECKS) if (c.re.test(line)) hits.hard.push({ cat: 'PROCESS-NARRATION', line: i + 1, snippet: line.trim().slice(0, 70) });
    for (const c of FILLER_CHECKS) if (c.re.test(line)) hits.advisory.push({ cat: 'FILLER', line: i + 1, snippet: line.trim().slice(0, 70) });
  });

  if (isSummaryArtifact(label)) {
    let runStart = -1, runLen = 0;
    const flushRun = (endIdx) => {
      if (runLen >= RESTATEMENT_RUN_THRESHOLD) {
        hits.advisory.push({
          cat: 'RESTATEMENT',
          line: runStart + 1,
          snippet: `${runLen} consecutive table rows (L${runStart + 1}-L${endIdx}) — link to the register instead (CONVENTIONS §12)`,
        });
      }
    };
    lines.forEach((raw, i) => {
      const line = raw.replace(/\r$/, '');
      if (TABLE_ROW_RE.test(line)) {
        if (runLen === 0) runStart = i;
        runLen++;
      } else {
        flushRun(i);
        runLen = 0;
        runStart = -1;
      }
    });
    if (runLen >= RESTATEMENT_RUN_THRESHOLD) flushRun(lines.length);
  }

  return hits;
}

let hadError = false;
const targets = [];
for (const f of files) {
  if (!existsSync(f)) { console.error(`x not found: ${f}`); hadError = true; continue; }
  targets.push({ label: basename(f), text: readFileSync(f, 'utf8') });
}
if (targets.length === 0 && !hadError) { console.error(USAGE); process.exit(2); }

let hardTotal = 0, advisoryTotal = 0;
for (const t of targets) {
  const { hard, advisory } = scanText(t.label, t.text);
  hardTotal += hard.length;
  advisoryTotal += advisory.length;
  const clean = hard.length === 0 && advisory.length === 0;
  console.log(`\n# ${t.label}${clean ? '  — clean' : ''}`);
  for (const h of hard) console.log(`  !! ${h.cat.padEnd(17)} ${h.line ? 'L' + h.line : '  '}  ${h.snippet}`);
  for (const h of advisory) console.log(`  .. ${h.cat.padEnd(17)} ${h.line ? 'L' + h.line : '  '}  ${h.snippet}`);
}
console.log(`\n${hardTotal} hard violation(s), ${advisoryTotal} advisory finding(s) across ${targets.length} target(s).`);
if (hadError) process.exit(2); // fail-closed wins even when hits were also found above
if (hardTotal > 0 && !reportOnly) {
  console.error('Run-artifact narration violation found — clean it before publishing (fail-closed).');
  process.exit(1);
}
