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
//                      ADVISORY_LINES, hard at HARD_LINES)
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
  const nonBlank = lines.filter((l) => l.replace(/\r$/, '').trim() !== '').length;

  const hits = { hard: [], advisory: [] };

  if (nonBlank > HARD_LINES) hits.hard.push({ cat: 'LENGTH', line: 0, snippet: `${nonBlank} non-blank lines (hard bound ${HARD_LINES})` });
  else if (nonBlank > ADVISORY_LINES) hits.advisory.push({ cat: 'LENGTH', line: 0, snippet: `${nonBlank} non-blank lines (advisory bound ${ADVISORY_LINES})` });

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
