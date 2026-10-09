#!/usr/bin/env node
// Prints the brief template for one suite agent: each field on the `Brief requires:` line of
// the agent's `## Contract` section, as one `Label:` line in contract order, ready to fill.
//
//   node scripts/brief-template.mjs <plugin>:<agent> [--continue <checkpoint report>] [--anchors <path[:line]>...]
//                                                        (also `co brief <plugin>:<agent>`)
//
// WHY: the dispatch guard (hooks/dispatch-guard.mjs) denies a dispatch whose brief lacks one of
// those fields, and its denial lists only the missing labels in this same form. This prints the
// whole set before the first dispatch. The Round budget line comes prefilled with the agent's
// measured default (route-unit.mjs defaultRoundBudget). The fields are read as the guard's requiredFields reads
// them, and the agent file resolves through hooks/agent-file.mjs, the resolver both hooks
// share: beside this script in a code-ops-suite copy, or under plugins/code-ops-suite/ in the
// repository checkout. A plugin copy without that resolver reports it, never guesses.
//
// --continue <report> relaunches an operative that stopped at its round budget. It prefills the
// brief from that operative's checkpoint report, which implementer.md asks to hold the work done
// with file:line evidence, what remains, the exact next action, and the uncommitted state. The
// Scope line, a `Continues:` line, and the Done so far, Remaining, and Dirty paths blocks come
// from the report by label match alone, with no model call, and a part the report lacks reads
// `(not in checkpoint)`. Carried text is quoted with `> ` so it never passes for a brief field,
// and it is bounded so a long report cannot bloat the brief.
//
// --anchors <path[:line]>... appends an `Anchors:` block so the operative skips its orientation reads.
// Each path gets the outline `skim.mjs` prints for the file as it is now (headings or symbols with
// line numbers), headed by the path and any `:line` target the lead named. The block is quoted like
// carried text, holds about ANCHOR_BUDGET characters (quote heads counted) with a visible truncation
// note, and marks a missing path `(not found)` and an unreadable one with skim's reason. The list
// ends at a flag or a `<plugin>:<agent>` argument. The outline is a hint: the operative re-validates it.
//
// Exit: 0 with the template on stdout; 2 when the type is not `<plugin>:<agent>` in a suite
// plugin, the definition is missing, its Contract has no `Brief requires:` line, or the
// --continue report cannot be read.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESOLVERS = [
  join(HERE, '..', 'hooks', 'agent-file.mjs'),
  join(HERE, '..', 'plugins', 'code-ops-suite', 'hooks', 'agent-file.mjs'),
];
const USAGE = 'usage: brief-template.mjs <plugin>:<agent> [--continue <checkpoint report>] [--anchors <path[:line]>...]   (for example code-ops-suite:implementer)';
// Carried checkpoint text stays under CARRY_BUDGET characters; one line clips at LINE_CAP and the Scope at SCOPE_CAP.
const CARRY_BUDGET = 4000;
const LINE_CAP = 300;
const SCOPE_CAP = 600;
// The Anchors block stays near ANCHOR_BUDGET characters, split evenly across the named paths.
const ANCHOR_BUDGET = 2500;
const MISSING = '(not in checkpoint)';
// The label words that open each part of a checkpoint. The first class that matches wins, so
// "Not done" is remaining work and "Next action" is not done work.
const PART_LABELS = [
  ['next', /\bnext\b/i],
  ['remaining', /\b(?:remain\w*|to ?do|left|not done|outstanding)\b/i],
  ['dirty', /\b(?:dirty|uncommitted|partial|in[- ]flight)\b/i],
  ['scope', /^scope$/i],
  ['done', /\b(?:done|completed?|changed|progress|evidence)\b/i],
];
// A line that opens a part: an optional heading or list marker, an optional bold, a label, then a
// colon with the first text of the part, or nothing after a heading or a bold label.
const OPENER = /^(?:(#{1,6})\s+|([-*+]|\d+\.)\s+)?(\*\*|__)?([A-Za-z][A-Za-z0-9 ()/-]{0,38}?)(?:\*\*|__)?\s*(?::\s*(?:\*\*|__)?\s*(.*)|)$/;

function fail(message) {
  console.error(message);
  process.exit(2);
}

// The part a checkpoint line opens, as { part, rest } with part null for a label no part claims, or
// null when the line is content. A flush-left or heading label ends the part before it even when
// unknown; a bulleted label opens a part only when it is one.
function opener(line) {
  const m = OPENER.exec(line);
  if (!m) return null;
  const [whole, heading, bullet, bold, label, rest = ''] = m;
  const part = PART_LABELS.find(([, pattern]) => pattern.test(label.trim()))?.[0] ?? null;
  if (!whole.includes(':') && !heading && !bold) return null;
  if (bullet && !part) return null;
  return { part, rest: rest.trim() };
}

const clip = (line, cap = LINE_CAP) => (line.length > cap ? `${line.slice(0, cap - 3)}...` : line);

// Splits a checkpoint report into its parts by label. Fenced lines are content and blank lines
// drop. A report with no dirty part still yields the lines that mark a path partial or complete.
function parseCheckpoint(text) {
  const parts = { scope: [], done: [], remaining: [], next: [], dirty: [] };
  const marked = [];
  let current = null;
  let fenced = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const opens = fenced ? null : opener(line);
    if (opens) {
      current = opens.part ? parts[opens.part] : null;
      if (opens.rest) current?.push(opens.rest);
      continue;
    }
    if (!line.trim()) continue;
    current?.push(line);
    if (/\b(?:partial|complete)\b/i.test(line) && /[\w.-]+\.\w{1,6}\b|[\w.-]+[\\/][\w.-]+/.test(line)) marked.push(line.trim());
  }
  if (!parts.dirty.length) parts.dirty = marked;
  parts.scope = parts.scope.length ? [clip(parts.scope.join(' '), SCOPE_CAP)] : [];
  for (const key of ['done', 'remaining', 'next', 'dirty']) parts[key] = parts[key].map((line) => clip(line));
  return parts;
}

// Keeps whole lines in order until the budget runs out; a dropped tail becomes one count line.
function carry(lines, budget) {
  const kept = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length > budget) break;
    kept.push(line);
    used += line.length;
  }
  const dropped = lines.slice(kept.length);
  if (dropped.length) kept.push(`(elided ${dropped.length} lines, ${dropped.reduce((n, l) => n + l.length, 0)} chars)`);
  return { lines: kept, used };
}

// The Scope text and the continuation blocks for a brief. The budget goes first to the Scope, then
// to what remains and the dirty paths, and last to the evidence of what is done, which the lead can
// re-read from the files.
function continuation(parts, reportPath) {
  let left = CARRY_BUDGET;
  const take = (lines) => {
    const out = carry(lines, left);
    left -= out.used;
    return out.lines;
  };
  const scope = take(parts.scope);
  const remaining = take(parts.remaining);
  const next = take(parts.next);
  const dirty = take(parts.dirty);
  const done = take(parts.done);
  const quote = (lines) => lines.map((line) => `> ${line}`);
  const block = (label, lines) => (lines.length ? [`${label}:`, ...quote(lines)] : [`${label}: ${MISSING}`]);
  const remainingBlock = remaining.length || next.length
    ? [
      'Remaining:',
      ...quote(remaining.length ? remaining : [`remaining work ${MISSING}`]),
      ...(next.length ? ['> Next action:', ...next.map((line) => `>   ${line}`)] : [`> Next action: ${MISSING}`]),
    ]
    : [`Remaining: ${MISSING}`];
  return {
    scope: scope[0] ?? '',
    lines: [`Continues: ${reportPath}`, ...block('Done so far', done), ...remainingBlock, ...block('Dirty paths', dirty)],
  };
}

// One anchor as { file, target }: a trailing :N or :N-M is the lead's line target, kept as given.
function parseAnchor(spec) {
  const m = /^(.+?):(\d+(?:-\d+)?)$/.exec(spec);
  return m ? { file: m[1], target: m[2] } : { file: spec, target: '' };
}

// The Anchors block lines. Each outline comes from skim.mjs run now, so it matches the file as it
// stands at brief time; a path skim cannot read is (not found).
function anchorBlock(specs) {
  const skim = join(HERE, 'skim.mjs');
  const share = Math.floor(ANCHOR_BUDGET / specs.length);
  const out = ['Anchors:'];
  for (const spec of specs) {
    const { file, target } = parseAnchor(spec);
    const head = target ? `${file} (target :${target})` : file;
    const run = existsSync(skim) ? spawnSync(process.execPath, [skim, file, '--max', '40'], { encoding: 'utf8' }) : null;
    if (!run || run.status !== 0) {
      // A file that exists but cannot be outlined reports skim's own reason; a missing one reads (not found).
      const reason = existsSync(file) ? run?.stderr.trim().replace(/^x\s+/, '').split(/\r?\n/)[0] : '';
      out.push(`> ${head} ${run ? `(${reason || 'not found'})` : '(outline unavailable)'}`);
      continue;
    }
    // The budget counts the `> ` heads and the indent, so the block stays near ANCHOR_BUDGET.
    const outline = run.stdout.split(/\r?\n/).filter(Boolean).slice(1).map((l) => `>   ${clip(l, 120)}`);
    out.push(`> ${head}`, ...carry(outline, share - head.length - 2).lines);
  }
  return out;
}

const raw = process.argv.slice(2);
// --anchors takes every argument up to the next flag or an agent type (`<plugin>:<agent>`).
const AGENT_TYPE = /^[A-Za-z][\w-]*:[A-Za-z][\w-]*$/;
const anchors = [];
const args = [];
let anchoring = false;
for (const arg of raw) {
  if (arg === '--anchors') anchoring = true;
  else if (anchoring && !arg.startsWith('-') && !AGENT_TYPE.test(arg)) anchors.push(arg);
  else {
    anchoring = false;
    args.push(arg);
  }
}
const anchorFlags = raw.filter((arg) => arg === '--anchors').length;
if (anchorFlags && !anchors.length) fail(USAGE);
if (args[0] === '--help' || args[0] === '-h') {
  console.log(USAGE);
  process.exit(0);
}
const at = args.indexOf('--continue');
const reportPath = at < 0 ? '' : args[at + 1] ?? '';
const rest = at < 0 ? args : args.filter((_, i) => i !== at && i !== at + 1);
if (rest.length !== 1 || (at >= 0 && (!reportPath || reportPath.startsWith('--')))) fail(USAGE);
const type = rest[0].trim();

const resolver = RESOLVERS.find((path) => existsSync(path));
if (!resolver) fail('brief-template: hooks/agent-file.mjs is not bundled beside this script');
const { agentFile } = await import(pathToFileURL(resolver).href);

const path = agentFile(type);
if (!path) fail(`brief-template: no agent definition for ${type}; name a suite agent as <plugin>:<agent>`);
const text = readFileSync(path, 'utf8');
// The same two patterns as requiredFields in hooks/dispatch-guard.mjs.
const section = /^## Contract[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? '';
const line = /^Brief requires:[ \t]*(.+)$/m.exec(section)?.[1] ?? '';
const fields = line.split(',').map((field) => field.trim()).filter(Boolean);
if (!fields.length) fail(`brief-template: ${type} declares no Brief requires line in its Contract`);

// route-unit.mjs sits beside this script in a plugin copy and in the checkout. A copy without it
// keeps the bare Round budget label; only the Tier lines below need it.
const routeUnit = existsSync(join(HERE, 'route-unit.mjs'))
  && (fields.includes('Tier') || fields.includes('Round budget'))
  ? await import(pathToFileURL(join(HERE, 'route-unit.mjs')).href)
  : null;
const lines = fields.map((field) => (field === 'Round budget' && routeUnit ? `${field}: ${routeUnit.defaultRoundBudget(type)}` : `${field}:`));
// A --continue brief carries the prior checkpoint after the fields, and its Scope fills the Scope line.
if (reportPath) {
  let report;
  try {
    report = readFileSync(reportPath, 'utf8');
  } catch (error) {
    fail(`brief-template: cannot read the checkpoint report ${reportPath} (${error.code ?? error.message})`);
  }
  const carried = continuation(parseCheckpoint(report), reportPath);
  const scopeAt = lines.indexOf('Scope:');
  if (scopeAt >= 0 && carried.scope) lines[scopeAt] = `Scope: ${carried.scope}`;
  lines.push(...carried.lines);
}
// An agent that requires Tier also gets the values those lines take and the command that prints them,
// preceded by the optional Size line, whose sizes and default budgets route-unit.mjs owns.
if (fields.includes('Tier') && routeUnit) {
  const { SIZE_ROUND_BUDGET, UNIT_SIZES } = routeUnit;
  lines.push(
    `Size takes ${UNIT_SIZES.join('|')} and is optional; add a \`Size:\` line only to record the unit's size. Default Round budget by size: ${UNIT_SIZES.map((size) => `${size}=${SIZE_ROUND_BUDGET[size]}`).join(', ')}.`,
    'Tier takes light|mid|strong|premium|frontier; Effort takes low|medium|high; Route basis takes `<kind>; surface=<s>; ambiguity=<a>; reversible=<yes|no>`; add `Route override: <reason>` only to depart from the route.',
    'Print them with: co route --kind <k> --ambiguity <l|m|h> --reversible <yes|no> --scope <path>',
  );
}
if (anchors.length) lines.push(...anchorBlock(anchors));
console.log(lines.join('\n'));
