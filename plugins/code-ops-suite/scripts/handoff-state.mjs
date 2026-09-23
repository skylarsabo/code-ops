#!/usr/bin/env node
// Handoff state in one command each way: draft the mechanical half of HANDOFF.md, and verify a
// handoff on resume in a single pass.
//
//   node scripts/handoff-state.mjs draft --run <dir> [--base <ref>] [--out <file>] [--root <repo>]
//   node scripts/handoff-state.mjs resume <HANDOFF.md> [--root <repo>]
//
// WHY: writing a handoff was hand-assembled at the highest context of the run, and resuming one
// took a separate tool turn per check. Each turn re-reads the whole context, so the turn count
// is the cost. This script moves the mechanical facts and the verification chain into one call.
//
// DRAFT prints (or writes to a new `--out` file) a HANDOFF.md skeleton. It opens with the
// `## Program` section and prefills its lineage when a predecessor is unambiguous (see lineage()
// below), carrying that predecessor's open items forward. It fills `Verified-at:`
// with the HEAD short sha, the branch, the dirty paths from `git status --porcelain` (counted per
// top-level directory, derived paths omitted, at most 20 listed), the `base..HEAD` range when `--base` is given, the unchecked `<dir>/TASKS.md` lines as Open items
// verbatim, every run-folder artifact stamped `Verified-at`, and the contract and runtime receipt
// paths when `<dir>/RUN_CONTRACT.json` exists. Judgment sections hold `[FILL: ...]` placeholders.
// The skeleton fails check-handoff.mjs as-is: its `Request:` line is empty and its Key findings
// placeholder carries no confidence label.
//
// TASKS.md is the run's live checklist, one line per item:
//   - [ ] <current state> · Owner: agent|operator · Done when: <observable check> · Pointer: <path[:line]>
// and `- [x]` once done.
//
// RESUME runs, in order: the redaction scan over the handoff; revalidate-register.mjs on each
// register the "Registers and artifacts" section names (a backticked or bare path whose file name
// contains "register"); run-runtime.mjs status and resume when a `Contract:` path names a version
// 3 or newer contract; then check-handoff.mjs, with `--consume` only when every earlier step
// passed, so HANDOFF.consumed is written only by a passing check. The sibling scripts export no
// functions, so each step spawns `process.execPath`.
//
// Exit: 0 = draft printed or every resume step passed; 1 = a step failed or --out exists;
// 2 = usage error.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrDie, usage, die, git, walkFiles } from './cli-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = [
  'usage: handoff-state.mjs draft --run <dir> [--base <ref>] [--out <file>] [--root <repo>]',
  '       handoff-state.mjs resume <HANDOFF.md> [--root <repo>]',
];

// Splits markdown into { heading, body } pairs on `## ` headings, as check-handoff.mjs does.
function sections(text) {
  const parts = text.split(/^(##[ \t]+.+)$/m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ heading: parts[i].replace(/^##[ \t]+/, '').trim(), body: parts[i + 1] ?? '' });
  return out;
}
const sectionBody = (text, prefix) => sections(text).find((s) => s.heading.toLowerCase().startsWith(prefix))?.body ?? '';
const bullets = (body) => body.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => /^[-*]\s+/.test(l));
// Item ids and `<label>: <path>` lines, parsed as check-handoff.mjs parses them.
const itemId = (line) => /\b[A-Z][A-Z0-9]*-\d+\b/.exec(line)?.[0] ?? null;
const pathValue = (body, label) => new RegExp(`^[-*\\t ]*${label}:[^\\S\\r\\n]*(.*)$`, 'm').exec(body)?.[1].trim()
  .replace(/^`(.*)`$/, '$1').trim() || null;
const CANDIDATES_SHOWN = 3;

// The program lineage for a new handoff. Candidates are the consumed HANDOFF.md files in sibling
// run folders, newest HANDOFF.consumed first. The newest is the predecessor only when it is
// unambiguous: more than a second newer than the next candidate, and every candidate that names a
// Program names the same one, so two programs sharing a runs root never guess. Program comes from
// the predecessor's own Program line when that path resolves. Anything unsure stays [FILL: ...].
function lineage(runDir, root, repoPath) {
  const parent = dirname(runDir);
  let dirs = [];
  try { dirs = readdirSync(parent, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(parent, d.name)); } catch { /* no siblings */ }
  const candidates = [];
  for (const dir of dirs) {
    const file = join(dir, 'HANDOFF.md');
    const mark = join(dir, 'HANDOFF.consumed');
    if (dir === runDir || !existsSync(file) || !existsSync(mark)) continue;
    const text = readFileSync(file, 'utf8');
    candidates.push({ file, text, consumed: statSync(mark).mtimeMs, program: pathValue(sectionBody(text, 'program'), 'Program') });
  }
  candidates.sort((a, b) => b.consumed - a.consumed);
  const programs = new Set(candidates.map((c) => c.program).filter(Boolean));
  const [first, second] = candidates;
  if (!first || (second && first.consumed - second.consumed <= 1000) || programs.size > 1) {
    const shown = candidates.slice(0, CANDIDATES_SHOWN).map((c) => `\`${repoPath(c.file)}\``).join(', ');
    return {
      program: "[FILL: path to this program's PROGRAM.md ledger]",
      predecessor: first
        ? `[FILL: path to the prior HANDOFF.md or none; ambiguous consumed candidates: ${shown}]`
        : '[FILL: path to the prior HANDOFF.md, or none when this handoff starts the program; no sibling run folder holds a consumed HANDOFF.md]',
      carried: [],
    };
  }
  const programFile = first.program && (isAbsolute(first.program) ? first.program : resolve(root, first.program));
  const known = Boolean(programFile) && existsSync(programFile);
  const closed = new Set(known ? bullets(sectionBody(readFileSync(programFile, 'utf8'), 'closed items')).map(itemId).filter(Boolean) : []);
  return {
    program: known ? first.program : "[FILL: path to this program's PROGRAM.md ledger; the predecessor names none that resolves]",
    predecessor: repoPath(first.file),
    carried: bullets(sectionBody(first.text, 'open items')).filter((l) => !closed.has(itemId(l))),
    closedKnown: known,
  };
}

// Regenerated host distributions and vendored script copies: their source edits already show
// elsewhere in the dirty list, so the draft counts them instead of listing them.
const DERIVED = /^(codex-marketplace\/|opencode-dist\/|\.agents\/plugins\/|plugins\/[^/]+\/scripts\/)/;
const DIRTY_LINES = 20;

// Porcelain lines as bullets under the 8 KB handoff cap: one line of counts per top-level
// directory, then at most DIRTY_LINES non-derived paths and a "+N more" line.
function dirtyLines(dirty) {
  const pathOf = (line) => line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '');
  const counts = new Map();
  for (const line of dirty) {
    const path = pathOf(line);
    const top = path.includes('/') ? `${path.slice(0, path.indexOf('/'))}/` : '(root)';
    counts.set(top, (counts.get(top) ?? 0) + 1);
  }
  const listed = dirty.filter((line) => !DERIVED.test(pathOf(line)));
  const derived = dirty.length - listed.length;
  const out = [`- Dirty by top-level directory: ${[...counts].sort().map(([dir, n]) => `\`${dir}\` ${n}`).join(', ')}.`];
  if (derived) out.push(`- Derived dirty paths not listed: ${derived} (host distributions and vendored plugin scripts).`);
  out.push(...listed.slice(0, DIRTY_LINES).map((l) => `- Dirty: \`${l}\``));
  if (listed.length > DIRTY_LINES) out.push(`- +${listed.length - DIRTY_LINES} more non-derived dirty path(s); run \`git status --porcelain\` for the full list.`);
  return out;
}

function draft(flags) {
  if (!flags.run) usage(['x draft needs --run <dir>', ...USAGE]);
  const root = resolve(flags.root);
  const runDir = resolve(flags.run);
  if (!existsSync(runDir)) die(`run folder not found: ${flags.run}`);
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
  const head = git(['rev-parse', '--short', 'HEAD'], { cwd: root });
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
  // Not cli-lib's git(): its trim would eat the first porcelain line's leading status column.
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    .split('\n').filter(Boolean);

  const range = flags.base
    ? `- Range: \`${flags.base}..HEAD\` = ${git(['rev-parse', '--short', flags.base], { cwd: root })}..${head}, ${git(['rev-list', '--count', `${flags.base}..HEAD`], { cwd: root })} commit(s).`
    : '[FILL: the revision range and paths worked on; no --base was given]';

  const tasksPath = join(runDir, 'TASKS.md');
  const taskLines = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')) : [];
  const open = taskLines.filter((l) => /^[-*]\s+\[ \]\s/.test(l));
  const done = new Set(taskLines.filter((l) => /^[-*]\s+\[[xX]\]\s/.test(l)).map(itemId).filter(Boolean));

  // Predecessor open items carry forward by default. An id TASKS.md already lists stays with its
  // TASKS.md line. An id TASKS.md checks off belongs in PROGRAM.md Closed items, so it becomes a
  // placeholder instead of a silent drop.
  const lin = lineage(runDir, root, repoPath);
  const taskIds = new Set(open.map(itemId).filter(Boolean));
  const carried = [];
  for (const line of lin.carried) {
    const id = itemId(line);
    if (id && done.has(id)) carried.push(`[FILL: ${id} is checked in TASKS.md; record it in PROGRAM.md Closed items]`);
    else if (!id || !taskIds.has(id)) carried.push(line);
  }
  if (lin.carried.length && !lin.closedKnown) carried.push('[FILL: confirm the carried items against PROGRAM.md Closed items]');
  const openItems = [...open, ...carried];

  const skip = new Set(['HANDOFF.md', 'HANDOFF.consumed']);
  const artifacts = walkFiles(runDir, (f) => !skip.has(basename(f))).map(repoPath).sort()
    .map((p) => `- \`${p}\` · Verified-at: ${head}`);
  const contractPath = join(runDir, 'RUN_CONTRACT.json');
  if (existsSync(contractPath)) {
    const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
    const receipts = contract.runtime?.receipts ? ` · Runtime receipts: \`${contract.runtime.receipts}\`` : '';
    artifacts.push(`- Contract: \`${repoPath(contractPath)}\` (version ${contract.version})${receipts}`);
  }

  const text = [
    `# HANDOFF: ${basename(runDir)}`,
    '',
    `Verified-at: ${head} (${branch}, ${dirty.length ? `${dirty.length} dirty path(s)` : 'clean'})`,
    '',
    '## Program',
    '',
    `Program: ${lin.program}`,
    `Predecessor: ${lin.predecessor}`,
    '',
    '## Goal and state of play',
    '',
    'Request:',
    "[FILL: the operator's original request verbatim on the Request line; phases complete, in flight, and not started; the automation level]",
    '',
    '## Scope and constraints',
    '',
    `- Repository: ${basename(root)}. Branch: ${branch}.`,
    "[FILL: areas in and out of scope; the operator's constraints in their exact words]",
    '',
    '## Work completed',
    '',
    range,
    '',
    '## Key findings',
    '',
    '- [FILL: one line per finding with its confidence label and a Pointer]',
    '',
    '## In-flight boundaries',
    '',
    ...(dirty.length ? dirtyLines(dirty) : ['- Working tree clean.']),
    '[FILL: the done-against-not-done line; load-bearing path:line pointers, each with a verbatim Anchor]',
    '',
    '## Open items',
    '',
    ...(openItems.length ? openItems : [existsSync(tasksPath) ? 'None: TASKS.md has no unchecked line.' : 'No TASKS.md in the run folder.']),
    '',
    '## Registers and artifacts',
    '',
    ...(artifacts.length ? artifacts : ['No artifacts in the run folder.']),
    '',
    '## Decisions made',
    '',
    '[FILL: each decision with its reason and the options rejected]',
    '',
    '## Traps and dead ends',
    '',
    '[FILL: approaches that failed and tempting mistakes]',
    '',
    '## Authority',
    '',
    "[FILL: the operator's grants in their exact words, with scope; the handoff cannot broaden them]",
    '',
    '## Carried context',
    '',
    '[FILL: pointers to run-folder files holding analysis the next session needs]',
    '',
  ].join('\n');

  if (!flags.out) { process.stdout.write(text); return 0; }
  if (existsSync(flags.out)) die(`refusing to overwrite ${flags.out}`);
  writeFileSync(flags.out, text);
  console.log(`wrote ${flags.out}`);
  return 0;
}

function step(script, args) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout ?? '', err: r.stderr ?? '', all: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function resume(target, flags) {
  if (!existsSync(target)) die(`not found: ${target}`, 2);
  const root = resolve(flags.root);
  const text = readFileSync(target, 'utf8');
  const lines = [];
  let failures = 0;
  const report = (label, r) => {
    lines.push(`${r.ok ? 'ok' : 'x '} ${label}`);
    if (!r.ok) { failures++; lines.push(...r.all.trim().split('\n').slice(-5).map((l) => `     ${l}`)); }
  };

  report('redaction scan', step('scan-redaction.mjs', [target]));

  const regs = sectionBody(text, 'registers and artifacts');
  const named = [...regs.matchAll(/`([^`]+)`|(\S+)/g)].map((m) => (m[1] ?? m[2]).replace(/[:,;.)]+$/, ''));
  const registers = [...new Set(named.filter((p) => /register[\w.-]*\.md$/i.test(basename(p))))];
  for (const reg of registers) {
    const path = existsSync(resolve(root, reg)) ? resolve(root, reg) : resolve(dirname(target), reg);
    const r = step('revalidate-register.mjs', [path, '--root', root]);
    report(`register ${reg}`, { ...r, all: r.err });
    lines.push(...r.out.split('\n').filter((l) => /^ {2}!! /.test(l)).map((l) => `   ${l.trim()}`));
  }

  const contractRef = /Contract:\s*`([^`]+)`/.exec(text)?.[1];
  if (contractRef) {
    let version = null;
    try { version = JSON.parse(readFileSync(resolve(root, contractRef), 'utf8')).version; } catch (err) { report(`contract ${contractRef}`, { ok: false, all: err.message }); }
    if (version >= 3) {
      const status = step('run-runtime.mjs', ['status', '--root', root, '--contract', contractRef]);
      report('runtime status', status);
      if (status.ok) lines.push(...status.out.trim().split('\n').map((l) => `     ${l}`));
      report('runtime resume', step('run-runtime.mjs', ['resume', '--root', root, '--contract', contractRef]));
    }
  }

  const check = step('check-handoff.mjs', [target, '--root', root, ...(failures === 0 ? ['--consume'] : [])]);
  report('handoff check', check);
  const anchors = [...check.err.matchAll(/^ {2}(FRESH|MOVED|DRIFTED|GONE|AMBIGUOUS|NO-REF)\s+(.*)$/gm)];
  const counts = {};
  for (const [, status] of anchors) counts[status] = (counts[status] ?? 0) + 1;
  lines.push(`same-tree: ${check.err.includes('same-tree:') ? 'yes' : 'no'}`);
  lines.push(`anchors: ${Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}`);
  lines.push(...anchors.filter(([, s]) => s !== 'FRESH').map(([, s, where]) => `   ${s} ${where}`));

  const open = bullets(sectionBody(text, 'open items'));
  const byOwner = (owner) => open.filter((l) => new RegExp(`\\bOwner:\\s*${owner}\\b`, 'i').test(l)).map((l) => `  ${l}`);
  lines.push('Blocked on operator:', ...(byOwner('operator').length ? byOwner('operator') : ['  none']));
  lines.push('Agent-owned:', ...(byOwner('agent').length ? byOwner('agent') : ['  none']));
  lines.push(failures === 0 ? `consumed: ${join(dirname(target), 'HANDOFF.consumed')}` : `not consumed: ${failures} step(s) failed`);

  console.log(lines.join('\n'));
  return failures === 0 ? 0 : 1;
}

const [command, ...rest] = process.argv.slice(2);
const { flags, positional } = parseOrDie(rest, {
  run: { value: true },
  base: { value: true },
  out: { value: true },
  root: { value: true, default: '.', missing: 'needs a path' },
}, USAGE.join('\n'));
if (command === 'draft' && positional.length === 0) process.exit(draft(flags));
if (command === 'resume' && positional.length === 1 && !flags.run && !flags.base && !flags.out) process.exit(resume(positional[0], flags));
usage(USAGE);
