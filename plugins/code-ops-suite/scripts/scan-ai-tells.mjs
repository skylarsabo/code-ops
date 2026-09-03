#!/usr/bin/env node
// Deterministic AI/tooling-trace scanner — the mechanical floor under authorship-hygiene.
//
// WHY: a commit/PR that carries an AI attribution trailer or assistant-voice prose is a
// traceless-publishing violation the moment it's pushed; catching it mechanically at the
// gate is cheaper than relying on a human proofreading every message by eye.
//
//   node scripts/scan-ai-tells.mjs <file> [...more] [--git <range>] [--report-only]
//     [--emdash-max N] [--emdash-baseline-rev <pre-edit-revision>]
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
// failed Git read, or a usage/config error (no target, unknown flag, bad --emdash-max) —
// reported even when hits were also found, never silently downgraded to 1. Otherwise 1 =
// any AI-trace hit found (unless --report-only), 0 = clean.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { die, parseOrDie, usage } from './cli-lib.mjs';

const USAGE = 'usage: scan-ai-tells.mjs <file> [...] [--git <range>] [--report-only]';
// An unrecognized --flag never falls through to "treat it as a file" — a typo'd flag would
// otherwise silently scan nothing relevant and report clean. `raw` on the two value-carrying
// gate flags keeps their own diagnostics: --emdash-max reports the value it was handed, and
// --git rejects a smuggled option by name below, before git runs.
const { flags, positional: files } = parseOrDie(process.argv.slice(2), {
  'report-only': { value: false },
  'emdash-max': { value: true, raw: true, missing: 'needs a positive number (got: <missing>)' },
  'emdash-baseline-rev': { value: true, missing: 'needs a revision' },
  git: { value: true, raw: true, missing: 'needs a range' },
});
const reportOnly = flags['report-only'] === true;
const emdashBaselineRev = flags['emdash-baseline-rev'];
const gitRange = flags.git;
const EMDASH_MAX = (() => {
  if (flags['emdash-max'] === undefined) return 3;
  const n = Number(flags['emdash-max']);
  // fail closed on a malformed gate config rather than silently disabling the check
  if (!Number.isFinite(n) || n < 1) die(`--emdash-max needs a positive number (got: ${flags['emdash-max']})`, 2);
  return n;
})();

if (emdashBaselineRev !== undefined && (!emdashBaselineRev || emdashBaselineRev.startsWith('-'))) {
  die('--emdash-baseline-rev needs a revision', 2);
}
if (emdashBaselineRev && (files.length !== 1 || gitRange)) {
  die('--emdash-baseline-rev requires exactly one file target and cannot be combined with --git', 2);
}

// Keep topology arrows, box drawing, and ordinary text symbols clean. Bare
// pictographs retain the old symbol-block coverage except for box drawing, and
// add the supplemental pictograph plane. VS16 remains an explicit emoji signal.
const EMOJI = /(?:\p{Emoji_Presentation}|\p{Regional_Indicator}|(?=[\u{231A}-\u{24FF}\u{2580}-\u{27BF}\u{2B00}-\u{2BFF}\u{3030}\u{303D}\u{3297}\u{3299}\u{1F000}-\u{1FFFF}])\p{Extended_Pictographic}|\p{Extended_Pictographic}\uFE0F|[#*0-9]\uFE0F?\u20E3)/u;
const LINE_CHECKS = [
  // Concrete tool/vendor names only — no bare \bai\b (it false-positives on .ai emails and the surname "Ai").
  { cat: 'TRAILER', re: /^\s*co-authored-by:\s*.*\b(claude|anthropic|codex|openai|gpt|chatgpt|copilot|gemini|bard|codeium|windsurf|llama|mistral|deepseek|aider|perplexity|tabnine)\b/i },
  { cat: 'TRAILER', re: /generated (with|by)\b.*(claude|codex|openai|cursor|copilot|chatgpt|gemini|bard|codeium|windsurf|llama|mistral|deepseek|aider|llm)/i },
  { cat: 'TOOL', re: /\b(claude code|codex(?: cli)?|cursor|github copilot|chatgpt|gemini|codeium|windsurf|aider|as an ai language model|i am an ai|large language model)\b/i },
  { cat: 'PHRASE', re: /(^|\s)(notably,|importantly,|in summary,)/i },
  { cat: 'PHRASE', re: /here's what (i|we)\b/i },
  { cat: 'BOILERPLATE', re: /^#{1,4}\s*test plan\b/i },
];

function emdashCount(text) { return (text.match(/[–—―−]/g) || []).length; }

function historicalText(file, revision) {
  const target = resolve(file); const cwd = dirname(target); let root; let commit;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { throw new Error('--emdash-baseline-rev requires a tracked target in a Git repository'); }
  const targetPath = relative(resolve(root), target);
  if (!targetPath || targetPath === '..' || targetPath.startsWith(`..${sep}`) || isAbsolute(targetPath)) {
    throw new Error('--emdash-baseline-rev requires a tracked target in a Git repository');
  }
  const gitPath = targetPath.split(sep).join('/');
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', `:(literal)${gitPath}`], {
      cwd: root, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { throw new Error('--emdash-baseline-rev requires a tracked target in a Git repository'); }
  try {
    commit = execFileSync('git', ['rev-parse', '--verify', `${revision}^{commit}`], {
      cwd: root, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { throw new Error('--emdash-baseline-rev could not resolve a commit'); }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
      cwd: root, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { throw new Error('--emdash-baseline-rev must resolve to an ancestor of HEAD'); }
  try {
    return execFileSync('git', ['cat-file', '-p', `${commit}:${gitPath}`], {
      cwd: root, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch { throw new Error('--emdash-baseline-rev could not read the target at that revision'); }
}

function scanText(label, text, emdashBaseline = 0) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    for (const c of LINE_CHECKS) if (c.re.test(line)) hits.push({ cat: c.cat, line: i + 1, snippet: line.trim().slice(0, 70) });
    if (EMOJI.test(line)) hits.push({ cat: 'EMOJI', line: i + 1, snippet: line.trim().slice(0, 70) });
  });
  const emdashes = emdashCount(text); // em/en/horizontal-bar/minus look-alikes
  const netGrowth = Math.max(0, emdashes - emdashBaseline);
  if (netGrowth >= EMDASH_MAX) {
    const baseline = emdashBaselineRev ? `; net growth ${netGrowth} above baseline ${emdashBaseline}` : '';
    hits.push({ cat: 'EMDASH', line: 0, snippet: `${emdashes} em-dashes${baseline} (threshold ${EMDASH_MAX})` });
  }
  return { label, hits };
}

// A missing target file or failed Git read is a config/usage error, not a scan result — tracked
// separately from hit counts so it can win at the end even when hits were also found (fail-closed
// wins; a masked 2-vs-1 exit would let a broken invocation quietly report as merely "dirty").
let hadError = false;
const targets = [];
let emdashBaseline = 0;
for (const f of files) {
  if (!existsSync(f)) { console.error(`x not found: ${f}`); hadError = true; continue; }
  targets.push({ label: basename(f), text: readFileSync(f, 'utf8') });
}
if (emdashBaselineRev && targets.length === 1) {
  try { emdashBaseline = emdashCount(historicalText(files[0], emdashBaselineRev)); }
  catch (error) { console.error(`x ${error.message}`); hadError = true; }
}
if (gitRange) {
  // execFileSync (no shell) — the range is passed as argv tokens, so shell metacharacters cannot inject.
  // SCR-016: also reject option-like tokens (leading '-') so a range value cannot smuggle git options
  // (e.g. --output=<path>); a real rev-range never starts with '-'. A trailing '--' marks end-of-options.
  const rangeTokens = gitRange.split(/\s+/).filter(Boolean);
  if (rangeTokens.some((t) => t.startsWith('-'))) die(`--git range must not contain option-like tokens: ${gitRange}`, 2);
  try { targets.push({ label: `git ${gitRange}`, text: execFileSync('git', ['log', '--format=%B', ...rangeTokens, '--'], { encoding: 'utf8', timeout: 10000 }) }); }
  catch (e) { console.error(`x git log ${gitRange} failed: ${e.message}`); hadError = true; }
}
if (targets.length === 0 && !hadError) usage(USAGE);

let total = 0;
for (const t of targets) {
  const { hits } = scanText(t.label, t.text, emdashBaseline);
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
