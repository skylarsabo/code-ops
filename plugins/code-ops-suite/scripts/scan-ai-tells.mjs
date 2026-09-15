#!/usr/bin/env node
// Deterministic AI/tooling-trace scanner — the mechanical floor under authorship-hygiene.
//
// WHY: a commit/PR that carries an AI attribution trailer or assistant-voice prose is a
// traceless-publishing violation the moment it's pushed; catching it mechanically at the
// gate is cheaper than relying on a human proofreading every message by eye.
//
//   node scripts/scan-ai-tells.mjs <file> [...more] [--git <range>] [--command <file>]
//     [--report-only] [--emdash-max N] [--emdash-baseline-rev <pre-edit-revision>]
//
// --command reads a shell command string from <file>. It scans the raw command and, as a
// second target, the text a `git commit`, `gh pr create|edit|merge`, or `gh api` in it would
// publish: each message, trailer, title, body, and field value on its own line, plus heredoc
// bodies. The union of both targets' hits is the verdict.
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

const USAGE = 'usage: scan-ai-tells.mjs <file> [...] [--git <range>] [--command <file>] [--report-only]';
// An unrecognized --flag never falls through to "treat it as a file" — a typo'd flag would
// otherwise silently scan nothing relevant and report clean. `raw` on the two value-carrying
// gate flags keeps their own diagnostics: --emdash-max reports the value it was handed, and
// --git rejects a smuggled option by name below, before git runs.
const { flags, positional: files } = parseOrDie(process.argv.slice(2), {
  'report-only': { value: false },
  'emdash-max': { value: true, raw: true, missing: 'needs a positive number (got: <missing>)' },
  'emdash-baseline-rev': { value: true, missing: 'needs a revision' },
  git: { value: true, raw: true, missing: 'needs a range' },
  command: { value: true, missing: 'needs a file' },
});
const reportOnly = flags['report-only'] === true;
const emdashBaselineRev = flags['emdash-baseline-rev'];
const gitRange = flags.git;
const commandFile = flags.command;
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
if (emdashBaselineRev && commandFile !== undefined) die('--emdash-baseline-rev cannot be combined with --command', 2);

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

// ---- --command: the text a publishing command would publish ----------------------------
// The first TRAILER rule is anchored at line start, so a trailer passed as a second -m value,
// a --trailer value, or an inline --body sits mid-line in the raw command and scans clean.
// publishedText() lexes the command and puts each published value on its own line, so the
// unchanged rules see it. The lexer feeds a scanner, not a shell: it never throws, and a
// construct it does not model still meets the raw-command scan.

const WORD_END = /[\s;&|<>()]/;

// Reads one shell word at `i` and returns its unquoted value and end index. A quoted `\n`
// becomes a newline, because the author wrote it meaning one and a trailer after it must
// reach line start. `$(...)` and backtick spans are kept verbatim.
function readWord(src, i) {
  let value = '';
  while (i < src.length && !WORD_END.test(src[i])) {
    const c = src[i];
    if (c === '\\') {
      if (src[i + 1] !== '\n') value += src[i + 1] ?? '';
      i += 2;
    } else if (c === "'" || (c === '$' && src[i + 1] === "'")) {
      const ansi = c === '$';
      const start = i + (ansi ? 2 : 1);
      let j = start;
      while (j < src.length && src[j] !== "'") j += ansi && src[j] === '\\' ? 2 : 1;
      const body = src.slice(start, j);
      value += ansi
        ? body.replace(/\\([\s\S])/g, (_, ch) => (ch === 'n' ? '\n' : ch === 't' ? '\t' : ch))
        : body.replace(/\\n/g, '\n');
      i = j + 1;
    } else if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          value += next === 'n' ? '\n' : next === '\n' ? '' : '"\\$`'.includes(next) ? next : `\\${next}`;
          i += 2;
        } else if (src.startsWith('$(', i)) {
          const end = lex(src, i + 2, true).end;
          value += src.slice(i, end);
          i = end;
        } else value += src[i++];
      }
      i++;
    } else if (src.startsWith('$(', i)) {
      const end = lex(src, i + 2, true).end;
      value += src.slice(i, end);
      i = end;
    } else if (c === '`') {
      const close = src.indexOf('`', i + 1);
      const end = close === -1 ? src.length : close + 1;
      value += src.slice(i, end);
      i = end;
    } else value += src[i++];
  }
  return { value, end: i };
}

// Reads the bodies of the heredocs opened on the line that just ended, in order.
function readHeredocs(src, i, pending) {
  for (const { segment, delimiter, strip } of pending) {
    const body = [];
    while (i < src.length) {
      const newline = src.indexOf('\n', i);
      const line = src.slice(i, newline === -1 ? src.length : newline).replace(/\r$/, '');
      i = newline === -1 ? src.length : newline + 1;
      if ((strip ? line.replace(/^\t+/, '') : line) === delimiter) break;
      body.push(line);
    }
    segment.heredocs.push(body.join('\n'));
  }
  return i;
}

// Splits a command into simple commands, each { words, heredocs }. In nested mode it stops
// after the `)` that closes a `$(`, so a quoted substitution with a heredoc parses whole.
function lex(src, i = 0, nested = false) {
  const segments = [];
  let segment = { words: [], heredocs: [] };
  let pending = [];
  let depth = 0;
  const flush = () => {
    if (segment.words.length) segments.push(segment);
    segment = { words: [], heredocs: [] };
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      i = readHeredocs(src, i + 1, pending);
      pending = [];
      flush();
    } else if (c === ' ' || c === '\t' || c === '\r') i++;
    else if (c === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (src.startsWith('<<<', i)) i += 3;
    else if (src.startsWith('<<', i)) {
      i += 2;
      const strip = src[i] === '-';
      if (strip) i++;
      while (src[i] === ' ' || src[i] === '\t') i++;
      const { value, end } = readWord(src, i);
      i = end;
      if (value) pending.push({ segment, delimiter: value, strip });
    } else if (c === '<' || c === '>') i += src[i + 1] === '&' ? 2 : 1;
    else if (c === ')' && nested && depth === 0) {
      flush();
      return { segments, end: i + 1 };
    } else if (';&|()'.includes(c)) {
      if (c === '(') depth++;
      if (c === ')') depth = Math.max(0, depth - 1);
      if (!(c === '&' && src[i + 1] === '>')) flush();
      i++;
    } else {
      const { value, end } = readWord(src, i);
      segment.words.push(value);
      i = end;
    }
  }
  flush();
  return { segments, end: i };
}

// Collects the values of the `long` options and the `short` letters. `takesValue` lists
// every short letter that consumes a value, and `attachedOnly` the letters whose optional
// value must be attached, so a cluster such as `-am` or `-Sm` parses the way the tool does.
function optionValues(args, { long, short, takesValue, attachedOnly = '', abbreviate = false }) {
  const values = [];
  const known = (name) => long.some((option) => option === name || (abbreviate && name.length > 2 && option.startsWith(name)));
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (!known(eq === -1 ? arg : arg.slice(0, eq))) continue;
      if (eq !== -1) values.push(arg.slice(eq + 1));
      else if (i + 1 < args.length) values.push(args[++i]);
    } else if (arg.startsWith('-')) {
      for (let j = 1; j < arg.length; j++) {
        if (attachedOnly.includes(arg[j])) break;
        if (!takesValue.includes(arg[j])) continue;
        const value = j + 1 < arg.length ? arg.slice(j + 1) : args[++i];
        if (short.includes(arg[j]) && value !== undefined) values.push(value);
        break;
      }
    }
  }
  return values;
}

// Value-taking short flags per command, from `git commit -h` and each gh command's --help.
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);
const GH_PR_VALUE_FLAGS = { create: 'aBbFHlmprRTt', edit: 'BbFmRt', merge: 'AbFRt' };

function programName(word) { return word.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase(); }

// The values one simple command would publish, or null when it publishes nothing we scan.
function publishedValues(words) {
  const at = words.findIndex((word) => ['git', 'gh'].includes(programName(word)));
  if (at === -1) return null;
  let i = at + 1;
  if (programName(words[at]) === 'git') {
    while (i < words.length && words[i].startsWith('-')) i += GIT_GLOBAL_WITH_VALUE.has(words[i]) ? 2 : 1;
    if (words[i] !== 'commit') return null;
    return optionValues(words.slice(i + 1), {
      long: ['--message', '--trailer'], short: 'm', takesValue: 'CcFmt', attachedOnly: 'Su', abbreviate: true,
    });
  }
  if (words[i] === 'pr' && Object.hasOwn(GH_PR_VALUE_FLAGS, words[i + 1])) {
    return optionValues(words.slice(i + 2), {
      long: ['--title', '--body', '--subject'], short: 'bt', takesValue: GH_PR_VALUE_FLAGS[words[i + 1]],
    });
  }
  if (words[i] === 'api') {
    return optionValues(words.slice(i + 1), { long: ['--field', '--raw-field'], short: 'fF', takesValue: 'FfHpqtX' })
      .map((field) => field.slice(field.indexOf('=') + 1));
  }
  return null;
}

function publishedText(command) {
  const blocks = [];
  for (const { words, heredocs } of lex(command).segments) {
    const values = publishedValues(words);
    if (values) blocks.push(...values, ...heredocs);
  }
  return blocks.join('\n');
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
if (commandFile !== undefined) {
  if (!existsSync(commandFile)) { console.error(`x not found: ${commandFile}`); hadError = true; }
  else {
    const command = readFileSync(commandFile, 'utf8');
    targets.push({ label: 'command', text: command }, { label: 'command published values', text: publishedText(command) });
  }
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
