#!/usr/bin/env node
// Deterministic AI/tooling-trace scanner — the mechanical floor under authorship-hygiene.
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
// Exit non-zero on any hit (so it can gate a push fail-closed), unless --report-only.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
const reportOnly = argv.includes('--report-only');
const emIdx = argv.indexOf('--emdash-max');
const EMDASH_MAX = emIdx >= 0 ? Number(argv[emIdx + 1]) : 3;
const gitIdx = argv.indexOf('--git');
const gitRange = gitIdx >= 0 ? argv[gitIdx + 1] : null;
const files = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--git' && argv[i - 1] !== '--emdash-max');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/u;
const LINE_CHECKS = [
  { cat: 'TRAILER', re: /^\s*co-authored-by:\s*.*(claude|anthropic|gpt|copilot|chatgpt|\bai\b)/i },
  { cat: 'TRAILER', re: /generated (with|by)\b.*(claude|cursor|copilot|chatgpt|llm)/i },
  { cat: 'TOOL', re: /\b(claude code|cursor|github copilot|chatgpt|as an ai language model|i am an ai|large language model)\b/i },
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
  const emdashes = (text.match(/—/g) || []).length;
  if (emdashes >= EMDASH_MAX) hits.push({ cat: 'EMDASH', line: 0, snippet: `${emdashes} em-dashes (threshold ${EMDASH_MAX})` });
  return { label, hits };
}

const targets = [];
for (const f of files) {
  if (!existsSync(f)) { console.error(`x not found: ${f}`); process.exitCode = 2; continue; }
  targets.push({ label: basename(f), text: readFileSync(f, 'utf8') });
}
if (gitRange) {
  try { targets.push({ label: `git ${gitRange}`, text: execSync(`git log --format=%B ${gitRange}`, { encoding: 'utf8' }) }); }
  catch (e) { console.error(`x git log ${gitRange} failed: ${e.message}`); process.exitCode = 2; }
}
if (targets.length === 0) { console.error('usage: scan-ai-tells.mjs <file> [...] [--git <range>] [--report-only]'); process.exit(2); }

let total = 0;
for (const t of targets) {
  const { hits } = scanText(t.label, t.text);
  total += hits.length;
  console.log(`\n# ${t.label}${hits.length ? '' : '  — clean'}`);
  for (const h of hits) console.log(`  !! ${h.cat.padEnd(11)} ${h.line ? 'L' + h.line : '  '}  ${h.snippet}`);
}
console.log(`\n${total} AI-trace hit(s) across ${targets.length} target(s).`);
if (total > 0 && !reportOnly) {
  console.error('AI/tooling trace found — clean it before publishing (fail-closed).');
  process.exit(1);
}
