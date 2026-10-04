#!/usr/bin/env node
// Compact snapshot: writes COMPACT_SNAPSHOT.md, the bounded file a session reads after host
// compaction to recover what a summary loses, so the operator never repeats a word, a grant, or a
// peer message. The design is "Compaction snapshot and message threads" in the agent state machine
// design doc.
//
//   node scripts/compact-snapshot.mjs [--session <id>] [--transcript <file>] [--run <dir>] [--json]
//   co snapshot [--session <id>] [--transcript <file>] [--run <dir>] [--json]
//
// It needs `--session` or `--run`. The run folder is `--run`, else the folder whose SESSION.json names
// the session in `sessionId` or `hostSessionId`. The transcript is `--transcript`, else the host's
// default file for the session. A missing piece never aborts the write: the header says `partial` and
// names it. Each write replaces the file. `--json` prints the result fields instead of one line.
//
// SECTIONS, in budget order (characters, 12,000 in all): Operator words 4,800, Running work 2,000,
// Active items 3,600, Peers 1,200. Truncation, when a section or the total runs over: stub older
// operator messages (never one of 80 characters or fewer, never an answer), then cut item lines,
// then drop quiet peers, then cut running-work descriptions. Ids, report paths, and reply-owed peers
// are never cut. The parsing lives in conversationOf() (transcript-lib.mjs); running agents come live
// from the agent ledger, so a snapshot cannot show a stale agent state.
//
// SAFETY. (1) The write is a temporary file renamed over the target. (2) The header records the
// `compact_boundary` count of the transcript, which the card compares to its own count. (3) A
// missing transcript, run folder, TASKS.md, or ledger is named in a `partial` status. (4) Text passes
// through the redaction scanner (scan-redaction.mjs) before it is written, and a message the scanner
// cannot vouch for becomes a stub that keeps only its transcript line. (5) The file goes in the run
// folder only when `git check-ignore` says that path is ignored; otherwise it goes to the home state
// directory (`<home>/.claude/code-ops/snapshots/<slug of stateRoot(cwd)>/<session slug>.md`), and a
// reader tries that repository-root key before the raw-cwd key.
//
// Library: buildSnapshot() is pure given its inputs and a `mask` function; createSnapshot() reads the
// inputs and writes the file; readSnapshotHeader() and snapshotState() are the card's read side.
//
// Exit: 0 = written; 1 = the write failed; 2 = usage error.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatAge, pendingReport } from './agent-ledger.mjs';
import { parseOrDie, usage } from './cli-lib.mjs';
import { conversationOf, defaultTranscriptDir, handoffMarkerPath, projectSlug, stateRoot } from './transcript-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = 'usage: compact-snapshot.mjs [--session <id>] [--transcript <file>] [--run <dir>] [--json]  (needs --session or --run)';

export const SNAPSHOT_FILE = 'COMPACT_SNAPSHOT.md';
export const BUDGET = { total: 12_000, words: 4_800, work: 2_000, items: 3_600, peers: 1_200 };
const WORD_CUT = 600;
const WORD_HEAD = 400;
const WORD_TAIL = 150;
const STUB_CUT = 80;
const ITEM_MAX = 16;
const ITEM_STEPS = [240, 160, 120, 80, 60];
const DESC_STEPS = [80, 40, 20, 0];
const PEER_CUT = 200;
const TASKS_BYTES = 65_536;
const RUN_SCAN = 200;
const WITHHELD = '[withheld: masking failed]';

const collapse = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
const cutTo = (text, max) => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`);

// Masks each text through the redaction scanner, the suite's one secret-shape floor. The scanner is a
// CLI that runs on import and exports nothing, so each text goes to a temporary .md file in one
// directory scan, and a line the scanner flags as fail-closed (an AWS key, a token, a private key, a
// JWT, a bearer token, a quoted secret) becomes `<REDACTED:secret-shape>`. Warn-only shapes (emails,
// addresses, long blobs) are left, because they would also delete operator words that merely mention
// one. A text the scanner did not list comes back null, and a scanner that fails or exits non-zero
// throws, so the caller stubs instead of writing raw text.
export function maskTexts(texts, { scanner = join(HERE, 'scan-redaction.mjs') } = {}) {
  if (!texts.length) return [];
  const dir = mkdtempSync(join(tmpdir(), 'compact-snapshot-'));
  try {
    texts.forEach((text, i) => writeFileSync(join(dir, `m${i}.md`), text));
    const run = spawnSync(process.execPath, [scanner, dir, '--report-only'], { encoding: 'utf8', timeout: 20_000 });
    if (run.error || run.status !== 0) throw new Error(`redaction scanner failed (${run.error?.code ?? `exit ${run.status}`})`);
    const listed = new Set();
    const flagged = new Map();
    let label = null;
    for (const line of run.stdout.split('\n')) {
      const head = /^# (m\d+)\.md/.exec(line);
      if (head) { label = head[1]; listed.add(label); continue; }
      const hit = /^\s+!! \w+\s+L(\d+)\b/.exec(line);
      if (hit && label) flagged.set(label, (flagged.get(label) ?? new Set()).add(Number(hit[1])));
    }
    return texts.map((text, i) => {
      if (!listed.has(`m${i}`)) return null;
      const bad = flagged.get(`m${i}`);
      return bad ? text.split('\n').map((l, n) => (bad.has(n + 1) ? '<REDACTED:secret-shape>' : l)).join('\n') : text;
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// A mask that throws, or returns the wrong shape, stubs every text rather than passing one through.
function maskAll(texts, mask) {
  try {
    const out = mask(texts);
    if (Array.isArray(out) && out.length === texts.length) return out.map((t) => (typeof t === 'string' ? collapse(t) : null));
  } catch { /* every text becomes a stub */ }
  return texts.map(() => null);
}

// One thread per session peer, keyed by its full `from-session` id (the name when it sends none). A
// thread is reply-owed when the peer's last message sits later in the transcript than the lead's last
// SendMessage to it, matched on name or session id. There is no awaiting-reply state.
function threadsOf(peerMessages, outbound) {
  const last = new Map();
  for (const m of peerMessages) {
    const key = m.session || m.name;
    const prior = last.get(key);
    if (!prior || m.line > prior.line) last.set(key, { name: m.name || prior?.name || '', session: m.session, text: m.text, at: m.at, line: m.line });
  }
  const sentLine = (t) => Math.max(0, ...outbound.filter((o) => {
    const to = o.to.trim().toLowerCase();
    return (t.name && to === t.name.toLowerCase()) || (t.session && to === t.session.toLowerCase());
  }).map((o) => o.line));
  return [...last.values()].map((t) => ({ ...t, owed: t.line > sentLine(t) }));
}

// The pure builder. `conversation` is conversationOf() output or null, `running` the ledger's pending
// agents or null, `items` `{ total, lines: [{ n, text }] }` or null; a null input is named in a
// `partial` status. `mask(texts)` returns one masked string or null per text, or throws.
export function buildSnapshot({ conversation = null, running = null, items = null, now = Date.now(), sessionId = '', mask = maskTexts, missing = [] } = {}) {
  const gaps = [...missing];
  if (!conversation) gaps.push('transcript');
  if (!running) gaps.push('agent ledger');
  if (!items && !gaps.includes('run folder')) gaps.push('TASKS.md');
  const convo = conversation ?? { operatorWords: [], answers: [], peerMessages: [], outbound: [], work: [], boundaries: 0 };

  const words = [...convo.operatorWords.map((w) => ({ ...w, kind: 'prompt' })), ...convo.answers.map((a) => ({ ...a, kind: 'answer' }))]
    .sort((a, b) => a.line - b.line);
  const threads = threadsOf(convo.peerMessages, convo.outbound).sort((a, b) => b.line - a.line);
  const owed = threads.filter((t) => t.owed);
  const quiet = threads.filter((t) => !t.owed);
  const work = [
    ...(running ?? []).map((a) => ({ kind: 'agent', id: a.agent_id, type: a.agent_type, age: formatAge(a.age_ms), report: a.report_path || '', text: a.description })),
    ...convo.work.filter((w) => w.kind !== 'agent' && !w.closed && !(w.kind === 'wakeup' && w.dueAt <= now))
      .map((w) => ({ kind: w.kind, id: w.id, type: w.type, age: w.kind === 'wakeup' ? `due in ${formatAge(w.dueAt - now)}` : formatAge(w.at === null ? 0 : now - w.at), report: '', text: w.description })),
  ];
  const itemLines = (items?.lines ?? []).slice(0, ITEM_MAX);

  // One scanner pass for every free-text field. Ids, paths, names, and ages are not masked.
  const masked = maskAll([...words.map((w) => w.text), ...owed.map((t) => t.text), ...work.map((w) => w.text ?? ''), ...itemLines.map((i) => i.text)], mask);
  let at = 0;
  words.forEach((w) => { w.body = masked[at++]; });
  owed.forEach((t) => { t.body = masked[at++]; });
  work.forEach((w) => { w.body = masked[at++]; });
  itemLines.forEach((i) => { i.body = masked[at++]; });

  const state = { itemCut: ITEM_STEPS[0], descCut: DESC_STEPS[0], quietShown: quiet.length };
  const section = (title, lines) => `## ${title}\n${lines.length ? lines.join('\n') : 'none'}\n`;
  const sections = () => ({
    words: section(`Operator words (${words.length}, oldest first)`, words.map((w) => {
      const head = `- L${w.line} ${w.kind}${w.at === null ? '' : ` ${formatAge(now - w.at)}`}`;
      if (w.body === null) return `${head}: ${WITHHELD}`;
      if (w.stub) return `${head}: ${cutTo(w.body, STUB_CUT)} [stub, transcript line ${w.line}]`;
      if (w.body.length <= WORD_CUT) return `${head}: ${w.body}`;
      return `${head}: ${w.body.slice(0, WORD_HEAD)} [${w.body.length - WORD_HEAD - WORD_TAIL} chars omitted, transcript line ${w.line}] ${w.body.slice(-WORD_TAIL)}`;
    })),
    work: section(`Running work (${work.length})`, work.map((w) => {
      const desc = w.body && state.descCut ? cutTo(w.body, state.descCut) : '';
      return `- ${w.kind} ${w.id} ${w.type || '-'} ${w.age}${w.report ? ` report: ${w.report}` : ''}${desc ? ` - ${desc}` : ''}`;
    })),
    items: section(`Active items (${itemLines.length} of ${items?.total ?? 0} shown, TASKS.md)`, itemLines.map((i) =>
      `- ${i.body === null ? `${WITHHELD} (TASKS.md line ${i.n})` : cutTo(i.body, state.itemCut)}`)),
    peers: section(`Peers (${owed.length} reply-owed, ${quiet.length} quiet)`, [
      ...owed.map((t) => `- REPLY OWED ${t.name || '-'} ${t.session || '-'}${t.at === null ? '' : ` ${formatAge(now - t.at)}`}: ${t.body === null ? `${WITHHELD} (transcript line ${t.line})` : cutTo(t.body, PEER_CUT)}`),
      ...quiet.slice(0, state.quietShown).map((t) => `- quiet ${t.name || '-'} ${t.session || '-'}`),
      ...(state.quietShown < quiet.length ? [`- (${quiet.length - state.quietShown} more quiet not shown)`] : []),
    ]),
  });
  const reducers = {
    words: () => { const w = words.find((e) => e.kind === 'prompt' && e.body !== null && e.body.length > STUB_CUT && !e.stub); if (w) w.stub = true; return Boolean(w); },
    items: () => { const next = ITEM_STEPS.find((c) => c < state.itemCut); if (next !== undefined) state.itemCut = next; return next !== undefined; },
    peers: () => { if (state.quietShown <= 0) return false; state.quietShown--; return true; },
    work: () => { const next = DESC_STEPS.find((c) => c < state.descCut); if (next !== undefined) state.descCut = next; return next !== undefined; },
  };
  const counts = { words: words.length, running: work.length, items: items?.total ?? 0, peers: owed.length };
  const render = () => {
    const parts = sections();
    const header = ['# Compact snapshot', `Written: ${new Date(now).toISOString()}`, `Session: ${sessionId || 'unknown'}`, `Boundaries: ${convo.boundaries}`,
      `Status: ${gaps.length ? 'partial' : 'complete'}`, ...(gaps.length ? [`Missing: ${gaps.join(', ')}`] : []),
      `Counts: operator words ${counts.words}, running work ${counts.running}, active items ${counts.items}, reply-owed peers ${counts.peers}`].join('\n');
    return { parts, text: `${header}\n\n${Object.values(parts).join('\n')}` };
  };

  // Pass one takes each section to its own budget, pass two the total, both in the truncation order.
  for (const name of Object.keys(reducers)) while (render().parts[name].length > BUDGET[name] && reducers[name]());
  for (const name of Object.keys(reducers)) while (render().text.length > BUDGET.total && reducers[name]());
  const { text } = render();
  return { text, counts, status: gaps.length ? 'partial' : 'complete', missing: gaps, boundaries: convo.boundaries, chars: text.length, overBudget: text.length > BUDGET.total };
}

// The run folder whose SESSION.json names the session in `sessionId` or `hostSessionId`, as an
// absolute path, or null. It follows sessionRunFolder() in hooks/routing-card.mjs: the working
// directory's `80 Runs/` and each `*-docs` hub's, newest folder name first, at most RUN_SCAN folders.
export function findRunFolder(cwd, sessionId) {
  if (!sessionId) return null;
  let entries;
  try { entries = readdirSync(cwd, { withFileTypes: true }); } catch { return null; }
  const hubs = [cwd, ...entries.filter((e) => e.isDirectory() && e.name.endsWith('-docs')).map((e) => join(cwd, e.name))];
  const folders = [];
  for (const hub of hubs) {
    const runs = join(hub, '80 Runs');
    try { for (const f of readdirSync(runs, { withFileTypes: true })) if (f.isDirectory()) folders.push({ dir: join(runs, f.name), name: f.name }); } catch { /* no runs here */ }
  }
  folders.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  for (const { dir } of folders.slice(0, RUN_SCAN)) {
    try {
      const session = JSON.parse(readFileSync(join(dir, 'SESSION.json'), 'utf8'));
      if (session?.sessionId === sessionId || session?.hostSessionId === sessionId) return dir;
    } catch { /* no readable SESSION.json */ }
  }
  return null;
}

const stateHome = () => process.env.CODE_OPS_HOME || homedir();

// Where the snapshot goes when the run folder is not ignored or not known. The key is the repository
// root (`stateRoot`), as the session record and the handoff marker are keyed, so the PreCompact hook
// and the SessionStart card find one file when their payload cwds differ.
export function homeSnapshotPath(cwd, sessionId, home = stateHome(), key = projectSlug(stateRoot(cwd))) {
  return join(home, '.codex', 'code-ops', 'snapshots', key, `${projectSlug(sessionId || 'manual')}.md`);
}

// The home copies to read, in order: the root key, then the raw-cwd key an older build wrote.
export function homeSnapshotPaths(cwd, sessionId, home = stateHome()) {
  return [...new Set([projectSlug(stateRoot(cwd)), projectSlug(cwd)])].map((key) => homeSnapshotPath(cwd, sessionId, home, key));
}

// True only when git reports the path ignored; a path outside a repository, a missing git, or any
// error reads as not ignored, so the file never lands where it could be committed.
function gitIgnored(path) {
  const run = spawnSync('git', ['check-ignore', '-q', '--', path], { cwd: dirname(path), stdio: 'ignore', timeout: 5000 });
  return run.status === 0;
}

// The temporary-file-then-rename write. Returns the path and where it went (`run` or `home`).
export function writeSnapshot(text, { runDir, cwd = process.cwd(), sessionId = '', home = stateHome(), isIgnored = gitIgnored } = {}) {
  const inRun = runDir ? join(runDir, SNAPSHOT_FILE) : null;
  const useRun = Boolean(inRun) && isIgnored(inRun);
  const path = useRun ? inRun : homeSnapshotPath(cwd, sessionId, home);
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  try { writeFileSync(temp, text); renameSync(temp, path); } catch (error) { rmSync(temp, { force: true }); throw error; }
  return { path, location: useRun ? 'run' : 'home' };
}

// The unchecked lines of the run folder's TASKS.md, or null when the file cannot be read. `total` is
// the whole unchecked count; `lines` are the first ITEM_MAX, uncut (the builder cuts after masking).
function readItems(runDir) {
  let text;
  try { text = readFileSync(join(runDir, 'TASKS.md'), 'utf8').slice(0, TASKS_BYTES); } catch { return null; }
  const open = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const item = /^[ \t]*[-*][ \t]+\[ \][ \t]+(.*)$/.exec(line)?.[1];
    if (item) open.push({ n: i + 1, text: item });
  });
  return { total: open.length, lines: open.slice(0, ITEM_MAX) };
}

// Reads the inputs, builds, and writes. Every input that cannot be read is named in the status.
export function createSnapshot({ sessionId = '', transcriptPath, runDir, cwd = process.cwd(), home = stateHome(), now = Date.now(), mask = maskTexts, isIgnored = gitIgnored } = {}) {
  const transcript = transcriptPath ?? (sessionId ? join(defaultTranscriptDir(cwd), `${sessionId}.jsonl`) : null);
  let conversation = null;
  try { if (transcript) conversation = conversationOf(readFileSync(transcript, 'utf8')); } catch { /* a missing transcript is partial */ }
  const run = runDir ? resolve(runDir) : findRunFolder(cwd, sessionId);
  let running = null;
  try { running = pendingReport({ sessionId: sessionId || undefined, cwd: sessionId ? undefined : cwd, runDir: run ?? undefined }).agents; } catch { /* the ledger is named missing */ }
  const built = buildSnapshot({ conversation, running, items: run ? readItems(run) : null, now, sessionId, mask, missing: run ? [] : ['run folder'] });
  return { ...built, ...writeSnapshot(built.text, { runDir: run ?? undefined, cwd, sessionId, home, isIgnored }) };
}

// The card's read side: the header of a written snapshot, or null when it is not one.
export function readSnapshotHeader(text) {
  const head = String(text).split(/\r?\n\r?\n/, 1)[0];
  if (!head.startsWith('# Compact snapshot')) return null;
  const field = (name) => new RegExp(`^${name}: (.*)$`, 'm').exec(head)?.[1]?.trim();
  const counts = /^Counts: operator words (\d+), running work (\d+), active items (\d+), reply-owed peers (\d+)$/m.exec(head);
  return {
    writtenAt: field('Written') ?? '',
    sessionId: field('Session') ?? '',
    boundaries: Number(field('Boundaries')),
    status: field('Status') ?? '',
    missing: (field('Missing') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    counts: counts ? { words: Number(counts[1]), running: Number(counts[2]), items: Number(counts[3]), peers: Number(counts[4]) } : null,
  };
}

// `fresh` when the card's boundary count is exactly one above the header's (PreCompact writes before
// its own boundary lands); anything else, including an unreadable header, is `stale`.
export function snapshotState(header, boundaries) {
  return header && Number.isInteger(header.boundaries) && Number.isInteger(boundaries) && boundaries === header.boundaries + 1 ? 'fresh' : 'stale';
}

// The handoff marker's sibling. PreCompact and PostCompact set `pending`. The next Grok
// PostToolUse names the path once, then clears the flag. A normal host summary does not
// carry the four snapshot sections, so the lead reads the file after the compact.
export function compactMarkerPath(marker) {
  return String(marker).replace(/\.json$/, '.compact.json');
}

export function markCompactPending(marker, path) {
  if (!marker || typeof path !== 'string' || !path) return;
  try {
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(compactMarkerPath(marker), JSON.stringify({ v: 1, path, pending: true }));
  } catch { /* the compact still proceeds */ }
}

export function takeCompactLine(marker) {
  if (!marker) return null;
  const file = compactMarkerPath(marker);
  let body;
  try { body = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  if (!body?.pending || typeof body.path !== 'string' || !body.path) return null;
  try { writeFileSync(file, JSON.stringify({ ...body, pending: false })); } catch { return null; }
  return `Read ${body.path} before trusting the host summary. It holds operator words, running work, open items, and reply-owed peers.`;
}

export function markSnapshotRestore({ sessionId, cwd = process.cwd(), home = stateHome(), path }) {
  if (!sessionId || !path) return;
  markCompactPending(handoffMarkerPath(cwd, sessionId, home), path);
}

function cli(argv) {
  const { flags, positional } = parseOrDie(argv, {
    session: { value: true },
    transcript: { value: true },
    run: { value: true },
    json: { value: false },
  }, USAGE);
  if (positional.length || (!flags.session && !flags.run)) usage(USAGE);
  let result;
  try {
    result = createSnapshot({ sessionId: flags.session ?? '', transcriptPath: flags.transcript, runDir: flags.run });
  } catch (error) {
    console.error(`x snapshot write failed: ${error.message}`);
    return 1;
  }
  const { path, location, status, missing, boundaries, counts, chars, overBudget } = result;
  if (flags.json) console.log(JSON.stringify({ path, location, status, missing, boundaries, counts, chars, overBudget }, null, 2));
  else console.log(`snapshot ${status}${missing.length ? ` (missing: ${missing.join(', ')})` : ''} at ${path} (${location === 'run' ? 'run folder' : 'home state'}): ${counts.words} operator words, ${counts.running} running, ${counts.items} items, ${counts.peers} reply-owed peers, ${boundaries} boundaries`);
  return 0;
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) process.exitCode = cli(process.argv.slice(2));
