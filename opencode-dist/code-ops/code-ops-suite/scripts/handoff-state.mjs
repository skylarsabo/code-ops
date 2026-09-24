#!/usr/bin/env node
// Handoff state in one command each way: draft the mechanical half of HANDOFF.md, and verify a
// handoff on resume in a single pass. It also opens a session's own run folder and finds the live
// head of a handoff chain.
//
//   node scripts/handoff-state.mjs open <slug> [--name <name>] [--session <id>] [--hub <dir>] [--root <repo>]
//   node scripts/handoff-state.mjs draft --run <dir> [--base <ref>] [--out <file>] [--name <base name>] [--session <id>] [--root <repo>]
//   node scripts/handoff-state.mjs resume <HANDOFF.md | session name> [--session <id>] [--root <repo>]
//   node scripts/handoff-state.mjs live <HANDOFF.md | session name | session id> [--root <repo>]
//
// SESSIONS. One run folder belongs to one session. Its SESSION.json holds
// `{"v":1,"sessionId","name","hop","predecessor","createdAt"}`. The session id is `--session`, else
// env CLAUDE_CODE_SESSION_ID, else CODEX_SESSION_ID, else null. With an id, `open` and a passing
// `resume` also write the session record at transcript-lib.mjs sessionRecordPath(cwd, id), under
// env CODE_OPS_HOME when set (evals point it at a temp dir), else the OS home directory. Without
// an id, the record is skipped silently.
//
// OPEN creates `<hub>/80 Runs/<YYYY-MM-DD>-<slug>/` (suffix -2, -3 when taken) with SESSION.json
// (hop 0, no predecessor), a header-only TASKS.md, and RUN_LOG.md, then prints the folder. The hub
// is `--hub`, else the first `80 Runs/` in the root or a `*-docs` folder beside it, as the
// SessionStart card scans them.
//
// LIVE walks HANDOFF.consumed successor links from a handoff's run folder, or from the run folder
// of a session named by id, id prefix, or name, to the head of the chain. It prints the head's
// session name, id, and run folder, and marks the head "awaiting resume" when that run already
// wrote an unconsumed HANDOFF.md.
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
// placeholder carries no confidence label. The run folder's SESSION.json `predecessor` sets the
// lineage before the heuristic does: null means Predecessor none. Draft fills `Session: <base
// name> HO <n>` and `Hop: <n>`, where n is the predecessor's Hop plus 1, or 1 without a
// predecessor. The base name is `--name`, else the PROGRAM.md `# PROGRAM:` title, else the
// SESSION.json name without its ` HO <n>` suffix. Draft refuses an `--out` whose folder holds
// HANDOFF.consumed, or whose SESSION.json names a different session id than the current one.
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
// functions, so each step spawns `process.execPath`. A session name in place of the path matches
// the `Session:` line of an unconsumed handoff in the hub run folders, case-insensitively; no
// match or several list the candidates and exit 1. A passing resume creates the successor run
// folder `<date>-<program slug>-ho<n>` beside the handoff's folder, where n is the handoff's Hop
// (1 for a legacy handoff). It writes that folder's SESSION.json, a TASKS.md seeded with the open
// items verbatim, RUN_LOG.md, and the session record, and the version 2 HANDOFF.consumed names it.
//
// Exit: 0 = done; 1 = a step failed, --out exists or is refused, or a name matched no single
// handoff; 2 = usage error.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrDie, usage, die, git, walkFiles } from './cli-lib.mjs';
import { sessionRecordPath } from './transcript-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = [
  'usage: handoff-state.mjs open <slug> [--name <name>] [--session <id>] [--hub <dir>] [--root <repo>]',
  '       handoff-state.mjs draft --run <dir> [--base <ref>] [--out <file>] [--name <base name>] [--session <id>] [--root <repo>]',
  '       handoff-state.mjs resume <HANDOFF.md | session name> [--session <id>] [--root <repo>]',
  '       handoff-state.mjs live <HANDOFF.md | session name | session id> [--root <repo>]',
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

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const writeJson = (file, body) => writeFileSync(file, `${JSON.stringify(body)}\n`);
const sessionIdOf = (flags) => flags.session || process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_SESSION_ID || null;
const programTitle = (file) => (file && existsSync(file) ? /^# PROGRAM:[^\S\r\n]*(.+?)\s*$/m.exec(readFileSync(file, 'utf8'))?.[1] : null) ?? null;
const hopOf = (text) => { const n = Number(pathValue(sectionBody(text, 'program'), 'Hop')); return Number.isInteger(n) && n > 0 ? n : null; };

// HANDOFF.consumed in `dir`, or null when absent. The version 2 body is JSON; the legacy body is one
// ISO timestamp line, read as a marker with no successor link. Existence alone means consumed.
function readConsumed(dir) {
  const file = join(dir, 'HANDOFF.consumed');
  if (!existsSync(file)) return null;
  const body = readJson(file);
  if (body && body.v === 2) return body;
  return { v: 1, consumedAt: readFileSync(file, 'utf8').trim() || null, bySession: null, successorRun: null, name: null };
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// The first of `<name>`, `<name>-2`, `<name>-3`, ... that does not exist under `parent`.
function freeDir(parent, name) {
  let dir = join(parent, name);
  for (let i = 2; existsSync(dir); i++) dir = join(parent, `${name}-${i}`);
  return dir;
}

// The hub run folders, scanned as the SessionStart card scans them: `80 Runs/` in the repository
// root and in each `*-docs` folder beside it. `all` keeps the candidates that do not exist yet.
function runsRoots(root, all = false) {
  const hubs = [root];
  try {
    for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && e.name.endsWith('-docs')) hubs.push(join(root, e.name));
  } catch { /* unreadable root: no hub */ }
  const runs = hubs.map((h) => join(h, '80 Runs'));
  return all ? runs : runs.filter((r) => existsSync(r));
}

// Every HANDOFF.md one level under the hub run folders, with its Session line and consumed state.
function handoffsIn(root) {
  const out = [];
  for (const runs of runsRoots(root)) {
    let folders = [];
    try { folders = readdirSync(runs, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
    for (const f of folders) {
      const dir = join(runs, f.name);
      const file = join(dir, 'HANDOFF.md');
      if (!existsSync(file)) continue;
      out.push({ file, dir, session: pathValue(sectionBody(readFileSync(file, 'utf8'), 'program'), 'Session'), consumed: existsSync(join(dir, 'HANDOFF.consumed')) });
    }
  }
  return out;
}

// The session record for `sid`, keyed by this process's cwd as the hooks key it by theirs.
const recordFile = (sid) => sessionRecordPath(process.cwd(), sid, process.env.CODE_OPS_HOME || homedir());
function writeSessionRecord(sid, { name, runDir, resumed, hop }) {
  if (!sid) return;
  const file = recordFile(sid);
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, { v: 1, sessionId: sid, name, runDir, resumed, hop, updatedAt: new Date().toISOString() });
}

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
  return fromPredecessor(first.file, root, repoPath);
}

// The lineage a known predecessor handoff implies: its Program, its Hop, and its open items not
// yet closed in PROGRAM.md.
function fromPredecessor(file, root, repoPath) {
  const text = readFileSync(file, 'utf8');
  const program = pathValue(sectionBody(text, 'program'), 'Program');
  const programFile = program && (isAbsolute(program) ? program : resolve(root, program));
  const known = Boolean(programFile) && existsSync(programFile);
  const closed = new Set(known ? bullets(sectionBody(readFileSync(programFile, 'utf8'), 'closed items')).map(itemId).filter(Boolean) : []);
  return {
    program: known ? program : "[FILL: path to this program's PROGRAM.md ledger; the predecessor names none that resolves]",
    programFile: known ? programFile : null,
    predecessor: repoPath(file),
    priorHop: hopOf(text),
    carried: bullets(sectionBody(text, 'open items')).filter((l) => !closed.has(itemId(l))),
    closedKnown: known,
  };
}

// The lineage the run folder's SESSION.json declares, or null when it has none. A null
// predecessor means the session opened as new work, so Predecessor is none.
function declaredLineage(session, root, repoPath) {
  if (!session || !('predecessor' in session)) return null;
  if (session.predecessor === null) return { program: "[FILL: path to this program's PROGRAM.md ledger]", predecessor: 'none', carried: [] };
  const file = isAbsolute(session.predecessor) ? session.predecessor : resolve(root, session.predecessor);
  if (!existsSync(file)) return { program: "[FILL: path to this program's PROGRAM.md ledger]", predecessor: `[FILL: SESSION.json names predecessor ${session.predecessor}, which does not resolve]`, carried: [] };
  return fromPredecessor(file, root, repoPath);
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
  const sid = sessionIdOf(flags);
  // A folder holding HANDOFF.consumed belongs to a handoff already resumed, so a handoff written
  // there would never be advertised; a folder another session owns is that session's state.
  if (flags.out) {
    const outDir = dirname(resolve(flags.out));
    if (existsSync(join(outDir, 'HANDOFF.consumed'))) {
      die(`refusing to draft into ${repoPath(outDir)}: it holds HANDOFF.consumed, so its handoff was already resumed. Write into this session's own run folder (co run open, or the successor run folder resume printed).`);
    }
    const owner = readJson(join(outDir, 'SESSION.json'))?.sessionId;
    if (owner && sid && owner !== sid) die(`refusing to draft into ${repoPath(outDir)}: its SESSION.json belongs to session ${owner}, not this session ${sid}.`);
  }
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
  const own = readJson(join(runDir, 'SESSION.json'));
  const lin = declaredLineage(own, root, repoPath) ?? lineage(runDir, root, repoPath);
  const taskIds = new Set(open.map(itemId).filter(Boolean));
  const carried = [];
  for (const line of lin.carried) {
    const id = itemId(line);
    if (id && done.has(id)) carried.push(`[FILL: ${id} is checked in TASKS.md; record it in PROGRAM.md Closed items]`);
    else if (!id || !taskIds.has(id)) carried.push(line);
  }
  if (lin.carried.length && !lin.closedKnown) carried.push('[FILL: confirm the carried items against PROGRAM.md Closed items]');
  const openItems = [...open, ...carried];

  // The successor's name and hop. A predecessor without a Hop line is legacy: its successor took
  // the name `HO 1`, recorded as this run's SESSION.json hop when resume wrote it.
  const hop = lin.predecessor === 'none' ? 1
    : lin.predecessor.startsWith('[FILL:') ? null
      : (lin.priorHop ?? (Number(own?.hop) || 1)) + 1;
  const base = flags.name || programTitle(lin.programFile) || (typeof own?.name === 'string' ? own.name.replace(/ HO \d+$/, '') : null)
    || '[FILL: the program base name, the PROGRAM.md "# PROGRAM:" title]';
  const hopText = hop ?? '[FILL: the predecessor\'s Hop plus 1, or 1 without a predecessor]';

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
    `Session: ${base} HO ${hopText}`,
    `Hop: ${hopText}`,
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

// A path, or the one unconsumed handoff whose Session line matches `arg` case-insensitively.
function resolveHandoff(arg, root) {
  if (existsSync(arg)) return arg;
  const pending = handoffsIn(root).filter((h) => !h.consumed);
  const hits = pending.filter((h) => h.session && h.session.toLowerCase() === arg.toLowerCase());
  if (hits.length === 1) return hits[0].file;
  const rel = (p) => relative(root, p).replace(/\\/g, '/');
  const shown = (hits.length ? hits : pending).map((h) => `  ${h.session ?? '(no Session line)'} -> ${rel(h.file)}`);
  die([`${hits.length ? 'ambiguous session name' : 'no file or unconsumed handoff Session line matches'}: ${arg}`,
    hits.length ? 'candidates:' : 'unconsumed handoffs:', ...(shown.length ? shown : ['  none'])].join('\n'));
}

function resume(arg, flags) {
  const root = resolve(flags.root);
  const target = resolveHandoff(arg, root);
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
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

  // The successor run folder, chosen before the check so the consumed marker can name it, and
  // created only after the check passes. A legacy handoff with no Hop line counts as hop 1.
  const program = sectionBody(text, 'program');
  const hop = hopOf(text) ?? 1;
  const programPath = pathValue(program, 'Program');
  const programFile = programPath && (isAbsolute(programPath) ? programPath : resolve(root, programPath));
  const slug = (programFile ? basename(dirname(programFile)) : basename(dirname(resolve(target)))).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'program';
  const name = pathValue(program, 'Session') || `${programTitle(programFile) ?? slug} HO ${hop}`;
  const successor = freeDir(dirname(dirname(resolve(target))), `${today()}-${slug}-ho${hop}`);
  const sid = sessionIdOf(flags);
  const consume = ['--consume', '--successor', repoPath(successor), '--name', name, ...(sid ? ['--session', sid] : [])];

  const check = step('check-handoff.mjs', [target, '--root', root, ...(failures === 0 ? consume : [])]);
  report('handoff check', check);
  if (failures === 0) {
    const created = new Date().toISOString();
    const openLines = bullets(sectionBody(text, 'open items'));
    mkdirSync(successor, { recursive: true });
    writeJson(join(successor, 'SESSION.json'), { v: 1, sessionId: sid, name, hop, predecessor: repoPath(resolve(target)), createdAt: created });
    writeFileSync(join(successor, 'TASKS.md'), `# Tasks\n${openLines.length ? `\n${openLines.join('\n')}\n` : ''}`);
    writeFileSync(join(successor, 'RUN_LOG.md'), `# Run log\n\n- ${created}: ${name} resumed ${repoPath(resolve(target))}.\n`);
    writeSessionRecord(sid, { name, runDir: repoPath(successor), resumed: repoPath(resolve(target)), hop });
  }
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
  if (failures === 0) {
    lines.push(`consumed: ${join(dirname(target), 'HANDOFF.consumed')}`, `session name: ${name}`, `successor run: ${repoPath(successor)}`);
  } else lines.push(`not consumed: ${failures} step(s) failed`);

  console.log(lines.join('\n'));
  return failures === 0 ? 0 : 1;
}

function open(slug, flags) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) usage([`x run open needs a slug of letters, digits, and hyphens: ${slug}`, ...USAGE]);
  const root = resolve(flags.root);
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
  const all = runsRoots(root, true);
  const runs = flags.hub ? join(resolve(flags.hub), '80 Runs') : (runsRoots(root)[0] ?? all[1] ?? all[0]);
  const dir = freeDir(runs, `${today()}-${slug}`);
  mkdirSync(runs, { recursive: true });
  mkdirSync(dir);
  const sid = sessionIdOf(flags);
  const name = flags.name || slug;
  const created = new Date().toISOString();
  writeJson(join(dir, 'SESSION.json'), { v: 1, sessionId: sid, name, hop: 0, predecessor: null, createdAt: created });
  writeFileSync(join(dir, 'TASKS.md'), '# Tasks\n');
  writeFileSync(join(dir, 'RUN_LOG.md'), `# Run log\n\n- ${created}: ${name} opened this run as new work.\n`);
  writeSessionRecord(sid, { name, runDir: repoPath(dir), resumed: null, hop: 0 });
  console.log(repoPath(dir));
  return 0;
}

// The run folder a live-head walk starts from: a handoff's own folder, or the run folder of the
// session named by exact id, a unique id prefix of 8 or more characters, or name.
function liveStart(arg, root) {
  if (existsSync(arg) && statSync(arg).isFile()) return dirname(resolve(arg));
  const store = dirname(recordFile('x'));
  let records = [];
  try { records = readdirSync(store).filter((f) => f.endsWith('.json')).map((f) => readJson(join(store, f))).filter((r) => r && r.runDir); } catch { /* no records */ }
  const want = arg.toLowerCase();
  const prefixed = arg.length >= 8 ? records.filter((r) => String(r.sessionId).startsWith(arg)) : [];
  const named = records.filter((r) => typeof r.name === 'string' && r.name.toLowerCase() === want)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const rec = records.find((r) => r.sessionId === arg) ?? (prefixed.length === 1 ? prefixed[0] : null) ?? named[0];
  if (rec) return resolve(root, rec.runDir);
  const hits = handoffsIn(root).filter((h) => h.session && h.session.toLowerCase() === want);
  if (hits.length === 1) return hits[0].dir;
  die(hits.length ? `ambiguous session name: ${arg} matches ${hits.length} handoffs` : `no handoff, session record, or Session line matches: ${arg}`);
}

function live(arg, flags) {
  const root = resolve(flags.root);
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
  let dir = liveStart(arg, root);
  const seen = new Set();
  let hops = 0;
  let state = 'live';
  for (;;) {
    seen.add(dir);
    const handoff = join(dir, 'HANDOFF.md');
    if (!existsSync(handoff)) break;
    const mark = readConsumed(dir);
    if (!mark) {
      const next = pathValue(sectionBody(readFileSync(handoff, 'utf8'), 'program'), 'Session');
      state = `awaiting resume: ${repoPath(handoff)} is not consumed${next ? `; its successor takes the name ${next}` : ''}`;
      break;
    }
    const next = mark.successorRun && resolve(root, mark.successorRun);
    if (!next) { state = 'unknown: a legacy HANDOFF.consumed names no successor run'; break; }
    if (seen.has(next) || !existsSync(next)) { state = `unknown: successor run ${mark.successorRun} ${seen.has(next) ? 'loops back' : 'is missing'}`; break; }
    dir = next;
    hops++;
  }
  const session = readJson(join(dir, 'SESSION.json')) ?? {};
  console.log([
    `head session: ${session.name ?? 'unknown'}`,
    `session id: ${session.sessionId ?? 'unknown'}`,
    `run dir: ${repoPath(dir)}`,
    `state: ${state}`,
    `hops walked: ${hops}`,
  ].join('\n'));
  return 0;
}

const [command, ...rest] = process.argv.slice(2);
const { flags, positional } = parseOrDie(rest, {
  run: { value: true },
  base: { value: true },
  out: { value: true },
  root: { value: true, default: '.', missing: 'needs a path' },
  name: { value: true },
  session: { value: true },
  hub: { value: true },
}, USAGE.join('\n'));
const noDraftFlags = !flags.run && !flags.base && !flags.out;
if (command === 'draft' && positional.length === 0 && !flags.hub) process.exit(draft(flags));
if (command === 'resume' && positional.length === 1 && noDraftFlags && !flags.name && !flags.hub) process.exit(resume(positional[0], flags));
if (command === 'open' && positional.length === 1 && noDraftFlags) process.exit(open(positional[0], flags));
if (command === 'live' && positional.length === 1 && noDraftFlags && !flags.name && !flags.session && !flags.hub) process.exit(live(positional[0], flags));
usage(USAGE);
