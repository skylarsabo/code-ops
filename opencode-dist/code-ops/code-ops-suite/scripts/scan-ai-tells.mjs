#!/usr/bin/env node
// Deterministic AI/tooling-trace scanner — the mechanical floor under authorship-hygiene.
//
// WHY: a commit/PR that carries an AI attribution trailer or assistant-voice prose is a
// traceless-publishing violation the moment it's pushed; catching it mechanically at the
// gate is cheaper than relying on a human proofreading every message by eye.
//
//   node scripts/scan-ai-tells.mjs <file> [...more] [--git <range>] [--report-only] [--emdash-max N]
//
// Scans commit-message / PR-body TEXT (not code idioms — that's the skill's judgment job)
// for the giveaways that mark a commit/PR as AI/tool-authored:
//   TRAILER    attribution trailers (Co-Authored-By: Claude/..., "Generated with/by ...", 🤖)
//   TOOL       tool/assistant markers (Claude Code, Cursor, Copilot, "as an AI language model", ...)
//   EMOJI      any emoji (most devs' commit/PR text has none)
//   EMDASH     em-dash (—) density at/over a threshold (default 3)
//   PHRASE     assistant-prose tells (Notably, / Importantly, / Here's what / In summary,)
//   BOILERPLATE the Claude PR template heading "## Test plan"
//
// Exit: a single tallied verdict, fail-closed wins over hits. 2 = a missing target file, a
// failed `git log`, or a usage/config error (no target, unknown flag, bad --emdash-max) —
// reported even when hits were also found, never silently downgraded to 1. Otherwise 1 =
// any AI-trace hit found (unless --report-only), 0 = clean.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
let reportOnly = false;
let sawEmdashMax = false, emdashMaxRaw;
let gitRange = null;
const files = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--report-only') reportOnly = true;
  else if (a === '--emdash-max') { sawEmdashMax = true; emdashMaxRaw = argv[++i]; }
  else if (a === '--git') gitRange = argv[++i]; // option-like values are rejected below, before git runs
  // An unrecognized --flag must not fall through to "treat it as a file" — a typo'd flag would
  // otherwise silently scan nothing relevant and report clean.
  else if (a.startsWith('--')) { console.error(`x unknown argument: ${a}`); process.exit(2); }
  else files.push(a);
}
const EMDASH_MAX = (() => {
  if (!sawEmdashMax) return 3;
  const n = Number(emdashMaxRaw);
  if (!Number.isFinite(n) || n < 1) {
    console.error(`x --emdash-max needs a positive number (got: ${emdashMaxRaw ?? '<missing>'})`);
    process.exit(2); // fail closed on a malformed gate config rather than silently disabling the check
  }
  return n;
})();

// Includes regional-indicator flags (1F1E6-1F1FF) and the low band from 231A (watch/hourglass/alarm) up.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{1F000}-\u{1F0FF}\u{231A}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/u;
const LINE_CHECKS = [
  // Concrete tool/vendor names only — no bare \bai\b (it false-positives on .ai emails and the surname "Ai").
  { cat: 'TRAILER', re: /^\s*co-authored-by:\s*.*\b(claude|anthropic|codex|openai|gpt|chatgpt|copilot|gemini|bard|codeium|windsurf|llama|mistral|deepseek|aider|perplexity|tabnine)\b/i },
  { cat: 'TRAILER', re: /generated (with|by)\b.*(claude|codex|openai|cursor|copilot|chatgpt|gemini|bard|codeium|windsurf|llama|mistral|deepseek|aider|llm)/i },
  { cat: 'TOOL', re: /\b(claude code|codex(?: cli)?|cursor|github copilot|chatgpt|gemini|codeium|windsurf|aider|as an ai language model|i am an ai|large language model)\b/i },
  { cat: 'PHRASE', re: /(^|\s)(notably,|importantly,|in summary,)/i },
  { cat: 'PHRASE', re: /here's what (i|we)\b/i },
  { cat: 'BOILERPLATE', re: /^#{1,4}\s*test plan\b/i },
];

function scanText(label, text) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    for (const c of LINE_CHECKS) if (c.re.test(line)) hits.push({ cat: c.cat, line: i + 1, snippet: line.trim().slice(0, 70) });
    if (EMOJI.test(line)) hits.push({ cat: 'EMOJI', line: i + 1, snippet: line.trim().slice(0, 70) });
  });
  const emdashes = (text.match(/[–—―−]/g) || []).length; // em/en/horizontal-bar/minus look-alikes
  if (emdashes >= EMDASH_MAX) hits.push({ cat: 'EMDASH', line: 0, snippet: `${emdashes} em-dashes (threshold ${EMDASH_MAX})` });
  return { label, hits };
}

// A missing target file or a failed git log is a config/usage error, not a scan result — tracked
// separately from hit counts so it can win at the end even when hits were also found (fail-closed
// wins; a masked 2-vs-1 exit would let a broken invocation quietly report as merely "dirty").
let hadError = false;
const targets = [];
for (const f of files) {
  if (!existsSync(f)) { console.error(`x not found: ${f}`); hadError = true; continue; }
  targets.push({ label: basename(f), text: readFileSync(f, 'utf8') });
}
if (gitRange) {
  // execFileSync (no shell) — the range is passed as argv tokens, so shell metacharacters cannot inject.
  // SCR-016: also reject option-like tokens (leading '-') so a range value cannot smuggle git options
  // (e.g. --output=<path>); a real rev-range never starts with '-'. A trailing '--' marks end-of-options.
  const rangeTokens = gitRange.split(/\s+/).filter(Boolean);
  if (rangeTokens.some((t) => t.startsWith('-'))) { console.error(`x --git range must not contain option-like tokens: ${gitRange}`); process.exit(2); }
  try { targets.push({ label: `git ${gitRange}`, text: execFileSync('git', ['log', '--format=%B', ...rangeTokens, '--'], { encoding: 'utf8', timeout: 10000 }) }); }
  catch (e) { console.error(`x git log ${gitRange} failed: ${e.message}`); hadError = true; }
}
if (targets.length === 0 && !hadError) { console.error('usage: scan-ai-tells.mjs <file> [...] [--git <range>] [--report-only]'); process.exit(2); }

let total = 0;
for (const t of targets) {
  const { hits } = scanText(t.label, t.text);
  total += hits.length;
  console.log(`\n# ${t.label}${hits.length ? '' : '  — clean'}`);
  for (const h of hits) console.log(`  !! ${h.cat.padEnd(11)} ${h.line ? 'L' + h.line : '  '}  ${h.snippet}`);
}
console.log(`\n${total} AI-trace hit(s) across ${targets.length} target(s).`);
if (hadError) process.exit(2); // fail-closed wins even when hits were also found above
if (total > 0 && !reportOnly) {
  console.error('AI/tooling trace found — clean it before publishing (fail-closed).');
  process.exit(1);
}
