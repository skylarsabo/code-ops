#!/usr/bin/env node
// Burn-down: a read-only convergence counter for one program (finish line F4). It answers whether
// the program's active items stay within the cap and stop growing.
//
//   node scripts/burndown.mjs [--program <slug | PROGRAM.md>] [--run <dir>] [--root <dir>] [--json]
//   co burndown [--program <slug>] [--run <dir>] [--json]
//
// Output, one line:
//   active N/12, backlog B, closed C[, missing Blocks K][ OVER CAP][ GROWING]
// OVER CAP marks N above the cap. GROWING marks N above the open-item count of the predecessor
// handoff, as check-handoff.mjs check 19 does. `missing Blocks K` appears only when the ledger has a
// `## Finish line`, and counts the active items that name no `Blocks: F<n>`. `--json` prints the same
// fields plus the program, the run folder, and the source of the active set.
//
// SOURCES. A program is `programs/<slug>/PROGRAM.md` under `80 Runs/` in the root or in a `*-docs`
// folder beside it. Its run is the newest run folder that belongs to it: a folder named
// `<date>-<slug>-ho<n>`, or one whose SESSION.json `program` or HANDOFF.md `Program:` line names
// the ledger. Active items are the ledger's `## Open items` bullets when the ledger declares
// `Grammar: 2`, else the unchecked id-led lines of the run's TASKS.md. Backlog is the id-led bullets
// of BACKLOG.md beside the ledger. Closed is the Closed items bullets of the ledger and its archive.
// Without `--program`, the program is the one the newest run folder belongs to. `--run` pins the
// run folder and, without `--program`, takes the program from it.
//
// The check-handoff.mjs and handoff-state.mjs parsers are script-shaped and export nothing, so the
// few section and bullet helpers below follow theirs line for line. The cap matches OPEN_CAP there.
//
// Library: `burndown({ program, runDir, root })` returns the fields and `formatLine(result)` the line.
//
// Writes nothing. Exit: 0 always; 2 = usage error, including a program or run that does not resolve.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrDie, usage, UsageError } from './cli-lib.mjs';

const USAGE = 'usage: burndown.mjs [--program <slug | PROGRAM.md>] [--run <dir>] [--root <dir>] [--json]';
const OPEN_CAP = 12;
const ARCHIVE_NAME = 'PROGRAM.archive.md';
const BACKLOG_NAME = 'BACKLOG.md';
const RUN_NAME_RE = /^\d{4}-\d{2}-\d{2}-(.+?)-ho\d+(?:-\d+)?$/;

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const readText = (file) => (isFile(file) ? readFileSync(file, 'utf8').replace(/\r/g, '') : '');
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const slash = (p) => p.replace(/\\/g, '/');

function sections(text) {
  const parts = text.split(/^(##[ \t]+.+)$/m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) out.push({ heading: parts[i].replace(/^##[ \t]+/, '').trim(), body: parts[i + 1] ?? '' });
  return out;
}
const sectionBody = (text, name) => sections(text).find((s) => s.heading.toLowerCase().startsWith(name))?.body ?? null;
const bulletsOf = (body) => (body ?? '').split('\n').filter((l) => /^[-*]\s+/.test(l));
const leadId = (line) => /^[-*]\s+(?:\[[ xX]\]\s+)?([A-Z][A-Z0-9]*-\d+)\b/.exec(line)?.[1] ?? null;
const hasBlocks = (line) => (/\bBlocks:([^·]*)/.exec(line)?.[1].split(/[,\s]+/).filter(Boolean).length ?? 0) > 0;
const labelValue = (body, label) => new RegExp(`^[-*\\t ]*${label}:[^\\S\\r\\n]*(.*)$`, 'm').exec(body ?? '')?.[1].trim().replace(/^`(.*)`$/, '$1').trim() || null;

// The hub run folders: `80 Runs/` in the root and in each `*-docs` folder beside it.
function runsRoots(root) {
  const hubs = [root];
  try {
    for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && e.name.endsWith('-docs')) hubs.push(join(root, e.name));
  } catch { /* unreadable root: no hub */ }
  return hubs.map((h) => join(h, '80 Runs')).filter(isDir);
}

// Run folders under the hub run folders, oldest first. A numeric compare orders ho9 before ho10.
function runFolders(root) {
  const dirs = runsRoots(root).flatMap((runs) => {
    try { return readdirSync(runs, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'programs').map((d) => join(runs, d.name)); } catch { return []; }
  });
  return dirs.sort((a, b) => basename(a).localeCompare(basename(b), 'en', { numeric: true }));
}

// The PROGRAM.md a run folder names: its SESSION.json `program`, else its HANDOFF.md `Program:` line.
function ledgerOfRun(dir, root) {
  const session = readJson(join(dir, 'SESSION.json')) ?? {};
  const named = (typeof session.program === 'string' && session.program) || labelValue(sectionBody(readText(join(dir, 'HANDOFF.md')), 'program'), 'Program');
  const file = named && resolve(root, named);
  return file && isFile(file) ? file : null;
}
const slugOfRun = (dir, root) => { const ledger = ledgerOfRun(dir, root); return ledger ? basename(dirname(ledger)) : RUN_NAME_RE.exec(basename(dir))?.[1] ?? null; };

// A `--program` value is a PROGRAM.md path or a slug under a hub's `80 Runs/programs/`.
function ledgerOfProgram(arg, root) {
  const direct = resolve(root, arg);
  if (isFile(direct)) return direct;
  const found = runsRoots(root).map((r) => join(r, 'programs', arg, 'PROGRAM.md')).find(isFile);
  if (!found) throw new UsageError(`no PROGRAM.md at ${arg} or under a hub's 80 Runs/programs/${arg}/`);
  return found;
}

// The predecessor handoff's open-item count, or null when the run names no predecessor that resolves.
function predecessorOpen(runDir, root) {
  if (!runDir) return null;
  const session = readJson(join(runDir, 'SESSION.json')) ?? {};
  const named = (typeof session.predecessor === 'string' && session.predecessor)
    || labelValue(sectionBody(readText(join(runDir, 'HANDOFF.md')), 'program'), 'Predecessor');
  const file = named && !/^none$/i.test(named) ? resolve(root, named) : null;
  if (!file || !isFile(file)) return null;
  return bulletsOf(sectionBody(readText(file), 'open items')).length;
}

export function burndown({ program = null, runDir = null, root = '.' } = {}) {
  const base = resolve(root);
  const runArg = runDir ? resolve(base, runDir) : null;
  if (runArg && !isDir(runArg)) throw new UsageError(`--run is not a directory: ${runDir}`);
  const runs = runFolders(base);
  let ledger = program ? ledgerOfProgram(program, base) : runArg && ledgerOfRun(runArg, base);
  const slug = ledger ? basename(dirname(ledger)) : program ?? (runArg && slugOfRun(runArg, base)) ?? runs.map((d) => slugOfRun(d, base)).findLast(Boolean);
  if (!slug) throw new UsageError('no program resolves: name one with --program <slug>');
  ledger ??= runsRoots(base).map((r) => join(r, 'programs', slug, 'PROGRAM.md')).find(isFile) ?? null;
  const run = runArg ?? runs.filter((d) => slugOfRun(d, base) === slug).at(-1) ?? null;
  const ledgerText = readText(ledger ?? '');
  const ledgerDir = ledger ? dirname(ledger) : null;

  const grammar2 = labelValue(ledgerText, 'Grammar') === '2' && sectionBody(ledgerText, 'open items') !== null;
  const ledgerOpen = bulletsOf(sectionBody(ledgerText, 'open items')).filter(leadId);
  const tasks = readText(run ? join(run, 'TASKS.md') : '').split('\n').filter((l) => /^[-*]\s+\[ \]\s/.test(l) && leadId(l));
  const source = grammar2 ? 'ledger' : run && isFile(join(run, 'TASKS.md')) ? 'tasks' : 'none';
  const active = grammar2 ? ledgerOpen : tasks;

  const finish = sectionBody(ledgerText, 'finish line') !== null;
  const ledgerLine = new Map(ledgerOpen.map((l) => [leadId(l), l]));
  // A TASKS.md line may carry only the id and title, so its ledger line supplies the Blocks field.
  const missingBlocks = finish ? active.filter((l) => !hasBlocks(l) && !hasBlocks(ledgerLine.get(leadId(l)) ?? '')).length : null;

  const archiveText = ledgerDir ? readText(join(ledgerDir, ARCHIVE_NAME)) : '';
  const closed = bulletsOf(sectionBody(ledgerText, 'closed items')).length + bulletsOf(sectionBody(archiveText, 'closed items')).length;
  const backlog = new Set(bulletsOf(ledgerDir ? readText(join(ledgerDir, BACKLOG_NAME)) : '').map(leadId).filter(Boolean)).size;
  const predecessor = predecessorOpen(run, base);
  const repoPath = (p) => (p ? slash(relative(base, p)) : null);
  return {
    program: slug,
    ledger: repoPath(ledger),
    run: repoPath(run),
    source,
    active: active.length,
    cap: OPEN_CAP,
    backlog,
    closed,
    predecessor,
    finishLine: finish,
    missingBlocks,
    overCap: active.length > OPEN_CAP,
    growing: predecessor !== null && active.length > predecessor,
  };
}

export const formatLine = (r) => `active ${r.active}/${r.cap}, backlog ${r.backlog}, closed ${r.closed}${r.missingBlocks === null ? '' : `, missing Blocks ${r.missingBlocks}`}${r.overCap ? ' OVER CAP' : ''}${r.growing ? ' GROWING' : ''}`;

function cli(argv) {
  const { flags, positional } = parseOrDie(argv, {
    program: { value: true },
    run: { value: true },
    root: { value: true, default: '.', missing: 'needs a path' },
    json: { value: false },
  }, USAGE);
  if (positional.length) usage(USAGE);
  let result;
  try {
    result = burndown({ program: flags.program, runDir: flags.run, root: flags.root });
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    usage([`x ${error.message}`, USAGE]);
  }
  console.log(flags.json ? JSON.stringify(result, null, 2) : formatLine(result));
  return 0;
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) process.exitCode = cli(process.argv.slice(2));
