#!/usr/bin/env node
// Handoff state in one command each way: draft the mechanical half of HANDOFF.md, and verify a
// handoff on resume in a single pass. It also opens a session's own run folder and finds the live
// head of a handoff chain.
//
//   node scripts/handoff-state.mjs open <slug> [--name <name>] [--session <id>] [--host-session <id>] [--hub <dir>] [--root <repo>]
//   node scripts/handoff-state.mjs draft --run <dir> [--base <ref>] [--out <file>] [--name <base name>] [--session <id>] [--root <repo>]
//   node scripts/handoff-state.mjs resume <HANDOFF.md | session name> [--session <id>] [--host-session <id>] [--root <repo>]
//   node scripts/handoff-state.mjs live <HANDOFF.md | session name | session id | host session id> [--root <repo>]
//
// SESSIONS. One run folder belongs to one session. Its SESSION.json holds
// `{"v":1,"sessionId","hostSessionId","name","hop","predecessor","createdAt"}`. The session id is
// `--session`, else env CLAUDE_CODE_SESSION_ID, else CODEX_SESSION_ID, else null. hostSessionId is
// `--host-session`, else null: the host's own id when it differs from the session id, such as a
// Claude desktop app `local_<uuid>`. With a session id, `open` and a passing `resume` also write
// the session record at `<home>/.claude/code-ops/sessions/<repo key>/<id>.json` (see BOARD), under
// env CODE_OPS_HOME when set (evals point it at a temp dir), else the OS home directory. The
// record adds `worktree`, the worktree top relative to the repository root, so a session in any
// worktree of one repository resolves its run folder. Readers also read the older store at
// transcript-lib.mjs sessionRecordPath(cwd, id), keyed by the working directory, which records
// written before the repository key still use. Without an id, the record is skipped silently.
//
// BOARD. The presence board holds one record per session and repository at
// `<home>/.claude/code-ops/board/<repo key>/<session>.json`. The repository key is the repository
// folder name plus a hash of its git common directory, which a worktree's `.git` file names in
// one read, so every worktree of a repository shares one key without a git process. A record holds
// the session id, host session id, name, branch, worktree, run folder, claimed paths, recent edits
// with timestamps, a one-line task, a heartbeat, and `ended`. Every path is relative to the
// worktree top, and no record holds an absolute path. `open` and a passing `resume` write the
// record, and a resume claims the program's scope documents. The PostToolUse edit hook records
// edits and the SessionEnd hook marks the record ended. A record whose heartbeat is older than 30
// minutes lists as idle.
//   node scripts/handoff-state.mjs board                      (list the board)
//   node scripts/handoff-state.mjs board-claim <path...> [--session <id>]
//   node scripts/handoff-state.mjs board-release [<path...>] [--session <id>]   (no path: all)
//   node scripts/handoff-state.mjs board-task <text...> [--session <id>]
// `co board`, `co board claim`, `co board release`, and `co board task` reach these.
//
// OPEN creates `<hub>/80 Runs/<YYYY-MM-DD>-<slug>/` (suffix -2, -3 when taken) with SESSION.json
// (hop 0, no predecessor), a header-only TASKS.md, and RUN_LOG.md, then prints the folder. The hub
// is `--hub`, else the first `80 Runs/` in the root or a `*-docs` folder beside it, as the
// SessionStart card scans them.
//
// LIVE walks HANDOFF.consumed successor links from a handoff's run folder, or from the run folder
// of a session named by id, id prefix, host session id, or name, to the head of the chain. It
// prints the head's session name, id, host session id when recorded, and run folder, and marks the
// head "awaiting resume" when that run already wrote an unconsumed HANDOFF.md.
//
// WHY: writing a handoff was hand-assembled at the highest context of the run, and resuming one
// took a separate tool turn per check. Each turn re-reads the whole context, so the turn count
// is the cost. This script moves the mechanical facts and the verification chain into one call.
//
// DRAFT prints (or writes to a new `--out` file) a HANDOFF.md skeleton. It opens with the
// `## Program` section and prefills its lineage when a predecessor is unambiguous (see lineage()
// below), carrying that predecessor's open items forward. It fills `Verified-at:`
// with the HEAD short sha, the branch, the dirty paths from `git status --porcelain --untracked-files=all`
// (counted per top-level directory, derived paths omitted, at most 20 listed, each with a content
// hash), the `base..HEAD` range when `--base` is given, the unchecked `<dir>/TASKS.md` lines as Open items
// verbatim, every run-folder artifact stamped `Verified-at`, and the contract and runtime receipt
// paths when `<dir>/RUN_CONTRACT.json` exists. Judgment sections hold `[FILL: ...]` placeholders.
// The skeleton fails check-handoff.mjs as-is: its `Request:` line is empty and its Key findings
// placeholder carries no confidence label. The run folder's SESSION.json `predecessor` sets the
// lineage before the heuristic does: null means Predecessor none. Draft fills `Session: <base
// name> HO <n>` and `Hop: <n>`, where n is the predecessor's Hop plus 1, or 1 without a
// predecessor. The base name is `--name`, else the predecessor handoff's Session line, else the
// SESSION.json name, each without its ` HO <n>` suffix and in its recorded case, else the
// PROGRAM.md `# PROGRAM:` title, so a hop never renames itself after the ledger. A known
// predecessor's Decisions made, Traps and dead ends, and Carried context bullets carry forward as
// `- [FILL: confirm still true] <bullet>` lines, as many as fit the 8 KB cap, then a count of the
// rest. Draft refuses an `--out` whose folder holds
// HANDOFF.consumed, or whose SESSION.json names a different session id than the current one.
//
// LEDGER GRAMMAR 2. When the Program ledger has a `Grammar: 2` line, draft shows an open item
// whose line equals its ledger line, or that already shows only id and title, as id and title. Every
// other item is active: it keeps its full line, gains an `Anchor:` copied from its `Pointer:
// path:line`, or `[FILL: verbatim text from the cited line]` without a line, and with `--out` is
// written back to the ledger's Open items by id. Each pending decision whose Hop is older than the
// writing session's hop (the handoff's Hop minus one) is listed as `- [FILL: disposition] <title>`.
// `--program <PROGRAM.md>` names the ledger when the lineage names none, as on a first hop. Resume
// seeds TASKS.md with the ledger line of each carried item. `program-archive` (`co program archive`)
// is documented at archive() below, and `program-split` and `program-merge` (`co program split|merge`) at split()
// and merge().
//
// SCOPE DIGESTS. With `--out` and a Program ledger that resolves, draft also writes
// SCOPE_DIGESTS.md beside the handoff, which keeps them outside the handoff's 8 KB cap. It holds one
// `## \`<path>\`` entry per PROGRAM.md scope document: `Hash: sha256:<hex>` of the working-tree
// bytes, `Verified-at: <sha>`, and a digest paragraph. A directory hashes each file's relative path,
// size, and bytes in sorted path order; a path that does not exist hashes to `none`. An entry whose
// hash equals the predecessor's SCOPE_DIGESTS.md entry keeps that digest and its Verified-at;
// every other entry gets `[FILL: digest]` stamped with HEAD. The Registers and artifacts section
// points at the file. Draft refuses to overwrite an existing SCOPE_DIGESTS.md.
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
// The summary ends with a `links:` block of markdown links, relative to --root with spaces as
// %20: the Program file, each PROGRAM.md scope document, SCOPE_DIGESTS.md when present, the
// handoff, the successor run, and each
// open item's Pointer. A passing resume prints `set title: "<session name>"` as its last line.
// Each check-handoff.mjs `warning:` line, such as a check 16 unanchored pointer, prints in the
// summary and never changes the exit code. When SCOPE_DIGESTS.md sits beside the handoff, a
// `scope digests` step fails while it holds a `[FILL:` placeholder, and the summary marks each
// PROGRAM.md scope document `unchanged` (its hash matches: read the digest, not the file),
// `changed` (re-read it), or `missing` (no entry). A handoff without the file skips both.
// A scope document the check reports MOVED through FORWARDING.json is hashed and linked at its new path.
// On a grammar 2 ledger the summary also lists, per `promoted:` id: `warning: UNLANDED` when the id is not
// sealed on the working tree (staged in intake, or unresolved: exit code unchanged), and `DRIFTED` when its
// status is now superseded or amended but was not at the handoff's `Verified-at` commit.
//
// LINKS. `open`, `draft`, and `resume` each print a `links:` block through linksBlock(), the one
// formatter; integrate-branch.mjs imports it too. `open` prints the run folder on its first line,
// then links it. `draft` links the handoff file, SCOPE_DIGESTS.md when it wrote one, the run
// folder, the Program file and the
// predecessor handoff when they resolve, and each open item's Pointer. With `--out` the block
// follows `wrote <file>` on stdout; without it the block prints on stderr, so stdout stays the
// skeleton alone. The command-line entry runs only when this file is the entry point.
//
// PROGRAM OVERLAP (design C6). `open --program <PROGRAM.md>` and `resume` compare the program's
// `## Scope documents` paths with those of every other live program on the presence board, one
// whose head run folder is not yet handed off. Each shared path prints `  warning: program <slug>
// (live head: <name>) also lists <path>` under a `program overlap:` line placed just before the
// `links:` block; more than one shared path with one program adds a `co program merge` suggestion.
// It never blocks and never changes an exit code; a missing or corrupt board, ledger, or file
// skips silently. `open --program` records the path in SESSION.json so other sessions find it.
// CODE_OPS_PEER_GUARD=off disables it. Names and repo-relative paths only.
//
// PENDING AGENTS. A background agent reports only to the session that launched it, so a handoff
// written while one is unreported orphans it. Draft reads the agent ledger (agent-ledger.mjs) and
// refuses, exit 1, while this session has an agent still `dispatched`: it prints one
// `<agent_id> <agent_type> <age> <description>` line each and names the two ways out. The ledger keys
// on the hook payload `session_id`, which is the session id above (the session record the routing
// card reads is keyed the same way), so draft matches the session id, SESSION.json's sessionId, and
// its hostSessionId. With none of them known it matches launches by the repository root and says
// so. `--pending-agents-ok` drafts anyway and writes each pending agent as a `Pending agent:` state
// line in In-flight boundaries. CODE_OPS_AGENT_LEDGER=off skips the check.
//
// Exit: 0 = done; 1 = a step failed, --out exists or is refused, pending agents block the draft,
// or a name matched no single handoff; 2 = usage error.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrDie, usage, die, git, walkFiles } from './cli-lib.mjs';
import { formatLine, pendingAgents } from './agent-ledger.mjs';
import { sessionRecordPath } from './transcript-lib.mjs';
import { ANCHOR_RE } from './citation-lib.mjs';
import { hubOf, promotedIds, recordState } from './promotion-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = [
  'usage: handoff-state.mjs open <slug> [--name <name>] [--program <PROGRAM.md>] [--session <id>] [--host-session <id>] [--hub <dir>] [--root <repo>]',
  '       handoff-state.mjs draft --run <dir> [--base <ref>] [--out <file>] [--name <base name>] [--program <PROGRAM.md>] [--session <id>] [--pending-agents-ok] [--root <repo>]',
  '       handoff-state.mjs program-archive <PROGRAM.md | program slug> [--root <repo>]',
  '       handoff-state.mjs program-split <PROGRAM.md | program slug> --into <a>,<b>[,...] --assign <id>=<child>[,...] [--root <repo>]',
  '       handoff-state.mjs program-merge <PROGRAM.md | program slug> --into <PROGRAM.md | program slug> [--head-ended] [--root <repo>]',
  '       handoff-state.mjs resume <HANDOFF.md | session name> [--session <id>] [--host-session <id>] [--root <repo>]',
  '       handoff-state.mjs live <HANDOFF.md | session name | session id | host session id> [--root <repo>]',
  '       handoff-state.mjs board | board-claim <path...> | board-release [<path...>] | board-task <text...> [--session <id>]',
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

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const writeJson = (file, body) => writeFileSync(file, `${JSON.stringify(body)}\n`);
const sessionIdOf = (flags) => flags.session || process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_SESSION_ID || null;
const programTitle = (file) => (file && existsSync(file) ? /^# PROGRAM:[^\S\r\n]*(.+?)\s*$/m.exec(readFileSync(file, 'utf8'))?.[1] : null) ?? null;
// A session name without its trailing ` HO <n>`, in its recorded case; null for a blank name or
// an unfilled placeholder.
const baseName = (name) => (typeof name === 'string' && name.trim() && !name.includes('[FILL:') ? name.trim().replace(/ HO \d+$/, '') : null);
// A markdown link to a root-relative path: forward slashes, each segment percent-encoded, so a
// space reads %20 and the link stays clickable.
const mdLink = (label, path) => `[${label}](${path.split('/').map(encodeURIComponent).join('/')})`;
// The `links:` block from [label, root-relative path, shown text] entries; shown defaults to the path.
export const linksBlock = (entries) => ['links:', ...entries.map(([label, path, shown = path]) => `  ${label}: ${mdLink(shown, path)}`)];
// One link entry per open item's Pointer, with any :line suffix kept in the shown text only.
const pointerEntries = (items, root, repoPath) => items.flatMap((item) => {
  const pointer = /\bPointer:\s*`?([^`·]+?)`?\s*(?:·|$)/.exec(item)?.[1];
  return pointer ? [[`${itemId(item) ?? 'open item'} pointer`, repoPath(resolve(root, pointer.replace(/:\d+(?:-\d+)?$/, ''))), pointer]] : [];
});
// Ledger grammar 2 (check-handoff.mjs checks 11 to 18): a PROGRAM.md with a `Grammar: 2` line.
// Draft, resume, and archive read its Open items by leading id and its decisions' Hop and Disposition.
const leadId = (line) => /^[-*]\s+(?:\[[ xX]\]\s+)?([A-Z][A-Z0-9]*-\d+)\b/.exec(line)?.[1] ?? null;
const bulletLead = (line) => /^[-*]\s+(?:\[[ xX]\]\s+)?/.exec(line)?.[0] ?? '- ';
// An item's title: its text after the bullet and checkbox, up to the first ` · ` field.
const titleOf = (line) => line.slice(bulletLead(line).length).split(' · ')[0].trim();
const isGrammar2 = (text) => /^[-*\t ]*Grammar:[^\S\r\n]*2\s*$/m.test(text);
const PENDING_RE = /\bDisposition:\s*pending\s*(?:·|$)/;
const SETTLED_RE = /\bDisposition:\s*(local|dropped|promoted:[^\s·]+)\s*(?:·|$)/;
function ledgerOf(programFile) {
  const text = programFile && existsSync(programFile) ? readFileSync(programFile, 'utf8') : '';
  return {
    grammar2: isGrammar2(text),
    open: new Map(bullets(sectionBody(text, 'open items')).map((l) => [leadId(l), l]).filter(([id]) => id)),
    pending: bullets(sectionBody(text, 'decisions ledger')).filter((l) => PENDING_RE.test(l))
      .map((line) => ({ line, hop: Number(/\bHop:\s*(\d+)/.exec(line)?.[1]) })),
  };
}
// L3: an open item whose `Pointer: path:line` has no Anchor gains one, copied from the cited line.
// A pointer without a line, or a blank or unquotable line, gains a placeholder, because check 16
// fails a bare pointer under grammar 2.
const ANCHOR_CHARS = 60;
function anchored(item, root) {
  if (!/\bPointer:/.test(item) || ANCHOR_RE.test(item)) return item;
  const m = /\bPointer:\s*`?([^`·]+?):(\d+)(?:-\d+)?`?\s*(?:·|$)/.exec(item);
  const file = m && resolve(root, m[1].trim());
  const text = file && isFile(file) ? (readFileSync(file, 'utf8').split('\n')[Number(m[2]) - 1] ?? '').trim().slice(0, ANCHOR_CHARS).trim() : '';
  if (text && !text.includes('`')) return `${item} · Anchor: \`${text}\``;
  if (text && !text.includes('"')) return `${item} · Anchor: "${text}"`;
  return `${item} · Anchor: [FILL: verbatim text from the cited line]`;
}
const hopOf = (text) => { const n = Number(pathValue(sectionBody(text, 'program'), 'Hop')); return Number.isInteger(n) && n > 0 ? n : null; };

// The backticked scope-document paths of a PROGRAM.md, in ledger order.
const scopeDocs = (programFile) => bullets(sectionBody(readFileSync(programFile, 'utf8'), 'scope documents'))
  .map((doc) => /`([^`]+)`/.exec(doc)?.[1]).filter(Boolean);
const DIGESTS = 'SCOPE_DIGESTS.md';
const FILL_DIGEST = '[FILL: digest]';

// The content hash of a scope document's working-tree bytes. The size prefix keeps a file boundary
// from shifting inside a directory hash.
function scopeHash(path) {
  let stat;
  try { stat = statSync(path); } catch { return 'none'; }
  const hash = createHash('sha256');
  const files = stat.isDirectory() ? walkFiles(path).sort() : [path];
  for (const file of files) {
    const bytes = readFileSync(file);
    if (stat.isDirectory()) hash.update(`${relative(path, file).replace(/\\/g, '/')}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return `sha256:${hash.digest('hex')}`;
}

// The entries of a SCOPE_DIGESTS.md, keyed by path, as { hash, verifiedAt, digest }.
function readDigests(file) {
  const entries = new Map();
  for (const { heading, body } of sections(readFileSync(file, 'utf8'))) {
    const digest = body.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => !/^(Hash|Verified-at):/.test(l)).join('\n').trim();
    entries.set(heading.replace(/^`(.*)`$/, '$1'), { hash: pathValue(body, 'Hash'), verifiedAt: pathValue(body, 'Verified-at'), digest });
  }
  return entries;
}

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

const storeHome = () => process.env.CODE_OPS_HOME || homedir();
const slugOf = (s) => String(s).replace(/[^A-Za-z0-9]/g, '-');
const forward = (p) => p.replace(/\\/g, '/');
const BOARD_IDLE_MS = 30 * 60 * 1000;
const BOARD_EDITS = 20;
const GIT_WALK_LIMIT = 64;

// The repository a working directory belongs to. It walks up to the first `.git`; a worktree's
// `.git` file names `<common>/worktrees/<name>`, so its parent's parent is the common directory,
// one file read and no git process. Outside a repository the directory itself is the repository.
// `top` is the worktree top and `worktree` is that top relative to the repository root.
export function repoIdentity(cwd) {
  let dir = resolve(cwd);
  for (let i = 0; i < GIT_WALK_LIMIT; i++) {
    const dotgit = join(dir, '.git');
    let stat = null;
    try { stat = statSync(dotgit); } catch { /* not here */ }
    if (stat) {
      let gitDir = dotgit;
      let common = dotgit;
      if (stat.isFile()) {
        const m = /^gitdir:[^\S\r\n]*(.+?)\s*$/m.exec(readFileSync(dotgit, 'utf8'));
        if (!m) break;
        gitDir = resolve(dir, m[1]);
        common = basename(dirname(gitDir)) === 'worktrees' ? dirname(dirname(gitDir)) : gitDir;
      }
      const repoRoot = basename(common) === '.git' ? dirname(common) : common;
      return { key: repoKey(repoRoot, common), top: dir, repoRoot, gitDir, worktree: forward(relative(repoRoot, dir)) || '.' };
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const top = resolve(cwd);
  return { key: repoKey(top, top), top, repoRoot: top, gitDir: null, worktree: '.' };
}

// The folder name keeps the key readable; the hash keeps the absolute path out of every file name.
function repoKey(repoRoot, common) {
  const norm = forward(resolve(common));
  const hash = createHash('sha256').update(process.platform === 'win32' ? norm.toLowerCase() : norm).digest('hex').slice(0, 12);
  return `${slugOf(basename(repoRoot)) || 'repo'}-${hash}`;
}

const branchOf = (ident) => {
  try {
    const head = readFileSync(join(ident.gitDir, 'HEAD'), 'utf8').trim();
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 12);
  } catch { return null; }
};

// The directory a record's run folder resolves against: its worktree when it names one.
export const recordBase = (rec, ident, fallback) => (typeof rec.worktree === 'string' ? resolve(ident.repoRoot, rec.worktree) : fallback);

// Every session record for the repository `cwd` belongs to: the repository-keyed store first, then
// the older working-directory store, one record per session id.
export function sessionRecords(cwd, home = storeHome()) {
  const ident = repoIdentity(cwd);
  const stores = [join(home, '.claude', 'code-ops', 'sessions', ident.key), dirname(sessionRecordPath(cwd, 'x', home))];
  const seen = new Set();
  const out = [];
  for (const store of stores) {
    let files = [];
    try { files = readdirSync(store).filter((f) => f.endsWith('.json')); } catch { continue; }
    for (const f of files) {
      const r = readJson(join(store, f));
      if (!r || typeof r.runDir !== 'string' || !r.runDir || seen.has(r.sessionId ?? f)) continue;
      seen.add(r.sessionId ?? f);
      out.push(r);
    }
  }
  return { ident, records: out };
}

function writeSessionRecord(sid, { hostSessionId, name, runDir, resumed, hop }) {
  if (!sid) return;
  const ident = repoIdentity(process.cwd());
  const file = join(storeHome(), '.claude', 'code-ops', 'sessions', ident.key, `${slugOf(sid)}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, { v: 1, sessionId: sid, hostSessionId, name, worktree: ident.worktree, runDir, resumed, hop, updatedAt: new Date().toISOString() });
}

const boardDir = (ident, home) => join(home, '.claude', 'code-ops', 'board', ident.key);

// A path relative to the worktree top, or null for a path outside it.
export function boardPath(ident, p) {
  const rel = forward(relative(ident.top, resolve(ident.top, String(p))));
  return !rel || rel.startsWith('../') || rel === '..' || isAbsolute(rel) ? null : rel;
}

// Reads, changes, and rewrites this session's board record. `change` edits the record in place.
// A missing or corrupt record starts fresh. Every write refreshes the heartbeat.
export function updateBoard(cwd, sid, change, home = storeHome()) {
  if (!sid) return null;
  const ident = repoIdentity(cwd);
  const file = join(boardDir(ident, home), `${slugOf(sid)}.json`);
  const prior = readJson(file);
  const rec = prior && typeof prior === 'object' && !Array.isArray(prior) ? prior : {};
  rec.v = 1;
  rec.sessionId = sid;
  rec.branch = ident.gitDir ? branchOf(ident) : null;
  rec.worktree = ident.worktree;
  if (!Array.isArray(rec.claims)) rec.claims = [];
  if (!Array.isArray(rec.edits)) rec.edits = [];
  change(rec, ident);
  rec.heartbeat = new Date().toISOString();
  mkdirSync(dirname(file), { recursive: true });
  writeJson(file, rec);
  return rec;
}

export const boardEdits = (paths) => (rec, ident) => {
  const at = new Date().toISOString();
  const fresh = paths.map((p) => boardPath(ident, p)).filter(Boolean);
  rec.edits = [...fresh.map((path) => ({ path, at })), ...rec.edits.filter((e) => e && !fresh.includes(e.path))].slice(0, BOARD_EDITS);
  rec.ended = null;
};

// Every record on the board for `cwd`'s repository, newest heartbeat first, each with `state`
// live, idle, or ended. Unreadable records are skipped.
export function readBoard(cwd, home = storeHome(), now = Date.now()) {
  const ident = repoIdentity(cwd);
  let files = [];
  try { files = readdirSync(boardDir(ident, home)).filter((f) => f.endsWith('.json')); } catch { return []; }
  return files.map((f) => readJson(join(boardDir(ident, home), f)))
    .filter((r) => r && typeof r === 'object' && typeof r.sessionId === 'string')
    .map((r) => ({ ...r, state: r.ended ? 'ended' : now - Date.parse(r.heartbeat) > BOARD_IDLE_MS || Number.isNaN(Date.parse(r.heartbeat)) ? 'idle' : 'live' }))
    .sort((a, b) => String(b.heartbeat).localeCompare(String(a.heartbeat)));
}

function board(command, positional, flags) {
  if (command === 'board') {
    const rows = readBoard(process.cwd());
    if (!rows.length) { console.log('board: no sessions recorded for this repository'); return 0; }
    const list = (xs) => (Array.isArray(xs) && xs.length ? xs.join(', ') : 'none');
    for (const r of rows) {
      console.log(`${r.name ?? r.sessionId.slice(0, 8)} [${r.state}] branch ${r.branch ?? 'unknown'} · worktree ${r.worktree ?? '.'} · heartbeat ${r.heartbeat ?? 'never'}`);
      console.log(`  session: ${r.sessionId}${r.hostSessionId ? ` · host session: ${r.hostSessionId}` : ''}${r.runDir ? ` · run: ${r.runDir}` : ''}`);
      if (r.task) console.log(`  task: ${r.task}`);
      console.log(`  claims: ${list(r.claims)}`);
      console.log(`  recent edits: ${list((r.edits ?? []).slice(0, 5).map((e) => `${e.path} (${e.at})`))}`);
    }
    return 0;
  }
  const sid = sessionIdOf(flags);
  if (!sid) die(`${command} needs a session id: --session <id>, or CLAUDE_CODE_SESSION_ID or CODEX_SESSION_ID in the environment`);
  if (command === 'board-task') {
    updateBoard(process.cwd(), sid, (rec) => { rec.task = positional.join(' ').replace(/\s+/g, ' ').trim().slice(0, 200) || null; });
    return 0;
  }
  const rec = updateBoard(process.cwd(), sid, (r, ident) => {
    const paths = positional.map((p) => boardPath(ident, p));
    if (paths.includes(null)) die(`${command}: every path must sit inside the worktree`);
    r.claims = command === 'board-claim' ? [...new Set([...r.claims, ...paths])]
      : paths.length ? r.claims.filter((c) => !paths.includes(c)) : [];
  });
  console.log(`claims: ${rec.claims.length ? rec.claims.join(', ') : 'none'}`);
  return 0;
}

// Board writes from open and resume never fail the command that made them.
function boardNote(sid, fields, claims = []) {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_PEER_GUARD ?? '')) return;
  try {
    updateBoard(process.cwd(), sid, (rec, ident) => {
      Object.assign(rec, fields, { ended: null });
      rec.claims = [...new Set([...rec.claims, ...claims.map((p) => boardPath(ident, p)).filter(Boolean)])];
    });
  } catch { /* the board is advisory */ }
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

// The lineage a known predecessor handoff implies: its Program, its Hop, its Session name, its
// open items not yet closed in PROGRAM.md, and its judgment bullets to confirm.
function fromPredecessor(file, root, repoPath) {
  const text = readFileSync(file, 'utf8');
  const program = pathValue(sectionBody(text, 'program'), 'Program');
  const session = pathValue(sectionBody(text, 'program'), 'Session');
  const programFile = program && (isAbsolute(program) ? program : resolve(root, program));
  const known = Boolean(programFile) && existsSync(programFile);
  const closed = new Set(known ? bullets(sectionBody(readFileSync(programFile, 'utf8'), 'closed items')).map(itemId).filter(Boolean) : []);
  return {
    program: known ? program : "[FILL: path to this program's PROGRAM.md ledger; the predecessor names none that resolves]",
    programFile: known ? programFile : null,
    predecessor: repoPath(file),
    priorHop: hopOf(text),
    priorSession: session,
    carried: bullets(sectionBody(text, 'open items')).filter((l) => !closed.has(itemId(l))),
    judgment: Object.fromEntries(JUDGMENT.map(([key, heading]) => [key, bullets(sectionBody(text, heading))])),
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

// The judgment sections a draft carries forward from a known predecessor, as [key, heading].
const JUDGMENT = [['decisions', 'decisions made'], ['traps', 'traps and dead ends'], ['context', 'carried context']];
const HANDOFF_CAP = 8 * 1024; // check-handoff.mjs SIZE_CAP_BYTES.
const CONFIRM = '- [FILL: confirm still true] ';

// Regenerated host distributions and vendored script copies: their source edits already show
// elsewhere in the dirty list, so the draft counts them instead of listing them.
const DERIVED = /^(codex-marketplace\/|opencode-dist\/|\.agents\/plugins\/|plugins\/[^/]+\/scripts\/)/;
const DIRTY_LINES = 20;
const DIRTY_HASH_HEX = 16;

// A dirty path's content token, so check-handoff.mjs can tell a file edited after the draft from
// the one the draft saw: `sha256:` and the first DIRTY_HASH_HEX hex of its working-tree bytes, or
// `none` when the path is gone. It is null for a git-quoted path or a non-file, and the draft then
// records no token, which the check reads as a changed tree. check-handoff.mjs dirtyHash is a copy.
function dirtyHash(top, line) {
  const raw = line.slice(3).split(' -> ').pop();
  if (raw.startsWith('"')) return null;
  let stat;
  try { stat = statSync(join(top, raw)); } catch { return 'none'; }
  if (!stat.isFile()) return null;
  try {
    return `sha256:${createHash('sha256').update(readFileSync(join(top, raw))).digest('hex').slice(0, DIRTY_HASH_HEX)}`;
  } catch { return null; }
}

// Porcelain lines as bullets under the 8 KB handoff cap: one line of counts per top-level
// directory, then at most DIRTY_LINES non-derived paths, each with its dirtyHash token, and a
// "+N more" line. `top` is the worktree root the porcelain paths are relative to.
function dirtyLines(dirty, top) {
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
  out.push(...listed.slice(0, DIRTY_LINES).map((l) => {
    const hash = dirtyHash(top, l);
    return `- Dirty: \`${l}\`${hash ? ` · ${hash}` : ''}`;
  }));
  if (listed.length > DIRTY_LINES) out.push(`- +${listed.length - DIRTY_LINES} more non-derived dirty path(s); run \`git status --porcelain --untracked-files=all\` for the full list.`);
  return out;
}

// The agents this session launched and never saw report, newest first, plus a note when the match
// fell back to the repository root. The ledger keys on the hook payload session_id; every id this
// draft knows for the session is tried, because a desktop session's hostSessionId may be the key.
function pendingForDraft(sid, own, root) {
  if (/^(off|0|false)$/i.test(process.env.CODE_OPS_AGENT_LEDGER ?? '')) return { agents: [], note: null };
  const ids = [...new Set([sid, own?.sessionId, own?.hostSessionId].filter((id) => typeof id === 'string' && id))];
  if (!ids.length) {
    return { agents: pendingAgents({ cwd: root }), note: `no session id is known (set CLAUDE_CODE_SESSION_ID or pass --session), so agents are matched by directory ${root}` };
  }
  const byId = new Map();
  for (const id of ids) for (const agent of pendingAgents({ sessionId: id })) byId.set(agent.agent_id, agent);
  return { agents: [...byId.values()].sort((a, b) => Date.parse(b.launched_at) - Date.parse(a.launched_at)), note: null };
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
  // --untracked-files=all lists each untracked file, so a file added inside an untracked folder
  // after the draft changes the set. check-handoff.mjs makes the same call.
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
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
  const pendingNow = pendingForDraft(sid, own, root);
  if (pendingNow.agents.length && !flags['pending-agents-ok']) {
    console.error(`x refusing to draft: ${pendingNow.agents.length} agent(s) launched by this session have not reported${pendingNow.note ? ` (${pendingNow.note})` : ''}:`);
    for (const agent of pendingNow.agents) console.error(`  ${formatLine(agent)}`);
    console.error('Wait for them to report, or pass --pending-agents-ok to draft and record them in In-flight boundaries.');
    return 1;
  }
  let lin = declaredLineage(own, root, repoPath) ?? lineage(runDir, root, repoPath);
  // A first hop has no predecessor to name its ledger, so --program names it (OI-29).
  if (flags.program && !lin.programFile) {
    const file = resolve(root, flags.program);
    if (!isFile(file)) die(`--program does not resolve to a file: ${flags.program}`);
    lin = { ...lin, program: repoPath(file), programFile: file };
  }
  const taskIds = new Set(open.map(itemId).filter(Boolean));
  const carried = [];
  for (const line of lin.carried) {
    const id = itemId(line);
    if (id && done.has(id)) carried.push(`[FILL: ${id} is checked in TASKS.md; record it in PROGRAM.md Closed items]`);
    else if (!id || !taskIds.has(id)) carried.push(line);
  }
  if (lin.carried.length && !lin.closedKnown) carried.push('[FILL: confirm the carried items against PROGRAM.md Closed items]');
  // Grammar 2 sorts open items into two tiers. A carried item, unchanged from its ledger line or
  // shown as id and title, keeps only id and title here. An active item keeps its full line.
  const ledger = ledgerOf(lin.programFile);
  const active = [];
  const openItems = [...open, ...carried].map((item) => {
    const full = ledger.grammar2 ? ledger.open.get(leadId(item)) : null;
    const same = full && (item.slice(bulletLead(item).length) === full.slice(bulletLead(full).length) || (!/\bOwner:/.test(item) && !/\bDone when:/.test(item)));
    if (same) return `${bulletLead(item)}${titleOf(full)}`;
    if (!ledger.grammar2) return item;
    const line = anchored(item, root);
    if (leadId(line) && !line.includes('[FILL:')) active.push(line);
    return line;
  });

  // The successor's name and hop. A predecessor without a Hop line is legacy: its successor took
  // the name `HO 1`, recorded as this run's SESSION.json hop when resume wrote it.
  const hop = lin.predecessor === 'none' ? 1
    : lin.predecessor.startsWith('[FILL:') ? null
      : (lin.priorHop ?? (Number(own?.hop) || 1)) + 1;
  // Check 12: a pending decision from before the writing session's hop needs a disposition. The
  // writing session is the handoff's Hop minus one, because a handoff's Hop names its successor.
  const unsettled = ledger.grammar2 && hop ? ledger.pending.filter((d) => d.hop < hop - 1).map((d) => `- [FILL: disposition] ${titleOf(d.line)}`) : [];
  // The established session name outranks the ledger title, so a hop keeps its name.
  const base = flags.name || baseName(lin.priorSession) || baseName(own?.name) || programTitle(lin.programFile)
    || '[FILL: the program base name, the PROGRAM.md "# PROGRAM:" title]';
  const hopText = hop ?? '[FILL: the predecessor\'s Hop plus 1, or 1 without a predecessor]';

  const skip = new Set(['HANDOFF.md', 'HANDOFF.consumed', DIGESTS]);
  const artifacts = walkFiles(runDir, (f) => !skip.has(basename(f))).map(repoPath).sort()
    .map((p) => `- \`${p}\` · Verified-at: ${head}`);
  const contractPath = join(runDir, 'RUN_CONTRACT.json');
  if (existsSync(contractPath)) {
    const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
    const receipts = contract.runtime?.receipts ? ` · Runtime receipts: \`${contract.runtime.receipts}\`` : '';
    artifacts.push(`- Contract: \`${repoPath(contractPath)}\` (version ${contract.version})${receipts}`);
  }

  // Scope digests beside --out: a document whose hash matches the predecessor's filled entry keeps
  // that digest; every other document gets a placeholder, so the writer summarizes only changes.
  const digestsFile = flags.out && lin.programFile ? join(dirname(resolve(flags.out)), DIGESTS) : null;
  const priorFile = isFile(resolve(root, lin.predecessor)) ? join(dirname(resolve(root, lin.predecessor)), DIGESTS) : null;
  const prior = priorFile && existsSync(priorFile) ? readDigests(priorFile) : new Map();
  const digests = (digestsFile ? scopeDocs(lin.programFile) : []).map((path) => {
    const hash = scopeHash(resolve(root, path));
    const was = prior.get(path);
    const kept = was && was.hash === hash && was.digest && !was.digest.includes('[FILL:');
    return { path, hash, verifiedAt: kept ? was.verifiedAt : head, digest: kept ? was.digest : FILL_DIGEST };
  });
  if (digests.length) {
    const toFill = digests.filter((d) => d.digest === FILL_DIGEST).length;
    artifacts.push(`- Scope digests: \`${repoPath(digestsFile)}\` · Verified-at: ${head} · ${digests.length - toFill} carried unchanged, ${toFill} to write`);
  }

  const render = (carry) => [
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
    ...(dirty.length ? dirtyLines(dirty, git(['rev-parse', '--show-toplevel'], { cwd: root })) : ['- Working tree clean.']),
    ...pendingNow.agents.map((a) => `- Pending agent: ${formatLine(a).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\[FILL:/g, '[fill:')} · launched ${a.launched_at}`),
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
    ledger.grammar2
      ? '[FILL: one `- DEC-<n> <one clause>` line per decision made this hop; its reason and rejected options go in the PROGRAM.md Decisions ledger]'
      : '[FILL: each decision with its reason and the options rejected]',
    ...unsettled,
    ...carry.decisions,
    '',
    '## Traps and dead ends',
    '',
    '[FILL: approaches that failed and tempting mistakes]',
    ...carry.traps,
    '',
    '## Authority',
    '',
    "[FILL: the operator's grants in their exact words, with scope; the handoff cannot broaden them]",
    '',
    '## Carried context',
    '',
    '[FILL: pointers to run-folder files holding analysis the next session needs]',
    ...carry.context,
    '',
  ].join('\n');

  // The predecessor's judgment bullets, in section order, as many as fit under the cap; each
  // section then counts what it left out, so nothing drops silently.
  const carry = { decisions: [], traps: [], context: [] };
  let room = HANDOFF_CAP - Buffer.byteLength(render(carry)) - 160 * JUDGMENT.length;
  for (const [key] of JUDGMENT) {
    const list = lin.judgment?.[key] ?? [];
    let kept = 0;
    for (const line of list) {
      const out = `${CONFIRM}${line.replace(/^[-*]\s+/, '')}`;
      const cost = Buffer.byteLength(out) + 1;
      if (cost > room) break;
      carry[key].push(out);
      room -= cost;
      kept++;
    }
    if (kept < list.length) carry[key].push(`[FILL: ${list.length - kept} more predecessor bullet(s) not carried under the 8 KB cap; confirm them in ${lin.predecessor}]`);
  }
  const text = render(carry);

  const links = [
    ...(flags.out ? [['handoff draft', repoPath(resolve(flags.out))]] : []),
    ...(digests.length ? [['scope digests', repoPath(digestsFile)]] : []),
    ['run', repoPath(runDir)],
    ...(lin.programFile ? [['program', repoPath(lin.programFile)]] : []),
    ...(isFile(resolve(root, lin.predecessor)) ? [['predecessor', lin.predecessor]] : []),
    ...pointerEntries(openItems, root, repoPath),
  ];
  if (!flags.out) {
    process.stdout.write(text);
    console.error(linksBlock(links).join('\n'));
    return 0;
  }
  if (existsSync(flags.out)) die(`refusing to overwrite ${flags.out}`);
  if (digests.length && existsSync(digestsFile)) die(`refusing to overwrite ${repoPath(digestsFile)}`);
  writeFileSync(flags.out, text);
  if (digests.length) {
    writeFileSync(digestsFile, [`# Scope digests: ${basename(runDir)}`, '',
      ...digests.flatMap((d) => [`## \`${d.path}\``, '', `Hash: ${d.hash}`, `Verified-at: ${d.verifiedAt}`, '', d.digest, ''])].join('\n'));
  }
  const written = active.length ? writeBack(lin.programFile, active) : 0;
  console.log([`wrote ${flags.out}`, ...(written ? [`updated ${repoPath(lin.programFile)}: ${written} open item line(s)`] : []), ...linksBlock(links)].join('\n'));
  return 0;
}

// L1: an active item's line is the ledger's current line, so draft writes it back to the ledger's
// Open items by id: it replaces a changed line and appends a new id. Returns the lines changed.
function writeBack(programFile, items) {
  const lines = readFileSync(programFile, 'utf8').split('\n');
  const heading = lines.findIndex((l) => /^##[ \t]+open items/i.test(l));
  if (heading < 0) return 0;
  let end = lines.findIndex((l, i) => i > heading && /^##[ \t]/.test(l));
  if (end < 0) end = lines.length;
  let changed = 0;
  for (const item of items) {
    const at = lines.findIndex((l, i) => i > heading && i < end && leadId(l) === leadId(item));
    if (at >= 0 && lines[at].replace(/\r$/, '') === item) continue;
    if (at >= 0) lines[at] = item;
    else {
      let last = end;
      while (last - 1 > heading && !lines[last - 1].trim()) last--;
      lines.splice(last, 0, item);
      end++;
    }
    changed++;
  }
  if (changed) writeFileSync(programFile, lines.join('\n'));
  return changed;
}

// PROGRAM ARCHIVE (`co program archive`, design L5 and DEC-32): moves settled ledger state into
// PROGRAM.archive.md beside a grammar 2 ledger, so the ledger stays under its 32 KB cap. It moves
// every Closed items bullet, every decision whose Disposition is settled, and each Request history
// entry except the first and the last REQUESTS_KEPT, each verbatim with its indented continuation
// lines, blank-separated ones included. A pending or dispositionless decision stays, so size
// management never buries an unsettled one. New entries insert after the last entry under the same
// heading of the archive it already holds, so prior archive prose survives; a new archive holds only
// the Request history, Decisions ledger, and Closed items headings. A CRLF file keeps its line ending.
// It exits 1 whenever the ledger is still over the cap, including when nothing can move.
const ARCHIVE_NAME = 'PROGRAM.archive.md';
const ARCHIVED = ['request history', 'decisions ledger', 'closed items'];
const REQUESTS_KEPT = 10;
const PROGRAM_CAP = 32 * 1024; // check-handoff.mjs PROGRAM_CAP_BYTES.
// Each top-level bullet with its indented continuation lines, as { section, start, end } line
// ranges, where section is the lower-cased archived heading it sits under, or null. Blank lines
// belong to an entry only when an indented line follows them. `headingOf` maps a line to the section
// name it opens: null for another heading, undefined for a non-heading.
function entriesOf(lines, headingOf = archivedHeading) {
  const out = [];
  let section = null;
  lines.forEach((l, i) => {
    const heading = headingOf(l);
    if (heading !== undefined) { section = heading; return; }
    if (/^[-*]\s+/.test(l)) out.push({ section, start: i, end: i + 1 });
    else if (/^\s+\S/.test(l) && out.length && lines.slice(out.at(-1).end, i).every((b) => !b.trim())) out.at(-1).end = i + 1;
  });
  return out;
}
// The archived heading a line opens, lower-cased; null for any other heading, undefined for a non-heading.
function archivedHeading(l) {
  const h = /^##[ \t]+(.+)$/.exec(l);
  return h ? ARCHIVED.find((name) => h[1].trim().toLowerCase().startsWith(name)) ?? null : undefined;
}
// Reads a file as LF lines and reports its line ending, so a CRLF file keeps it on write.
function linesOf(file) {
  const raw = readFileSync(file, 'utf8');
  return { lines: raw.replace(/\r\n/g, '\n').split('\n'), eol: raw.includes('\r\n') ? '\r\n' : '\n' };
}
const titleCase = (name) => name[0].toUpperCase() + name.slice(1);
function programFileOf(arg, root) {
  const direct = resolve(root, arg);
  if (isFile(direct)) return direct;
  const found = runsRoots(root).map((r) => join(r, 'programs', arg, 'PROGRAM.md')).find(isFile);
  return found ?? die(`no PROGRAM.md at ${arg} or under a hub's 80 Runs/programs/${arg}/`);
}
function archive(arg, flags) {
  const root = resolve(flags.root);
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
  const file = programFileOf(arg, root);
  const { lines, eol } = linesOf(file);
  if (!isGrammar2(lines.join('\n'))) die(`refusing to archive ${repoPath(file)}: it has no "Grammar: 2" line, so its decisions carry no disposition to read`);
  const entries = entriesOf(lines);
  const requests = entries.filter((e) => e.section === 'request history');
  const keep = new Set([requests[0], ...requests.slice(-REQUESTS_KEPT)]);
  const text = (e) => lines.slice(e.start, e.end);
  const moving = entries.filter((e) => (e.section === 'request history' && !keep.has(e))
    || (e.section === 'decisions ledger' && SETTLED_RE.test(lines[e.start]))
    || e.section === 'closed items');
  const unsettled = entries.filter((e) => e.section === 'decisions ledger' && !SETTLED_RE.test(lines[e.start])).length;
  if (!moving.length) {
    const size = Buffer.byteLength(lines.join(eol), 'utf8');
    console.log(`nothing to archive in ${repoPath(file)}; ${unsettled} unsettled decision(s) stay`
      + (size > PROGRAM_CAP ? `\n${repoPath(file)}: ${size} bytes against the ${PROGRAM_CAP}-byte cap; still over it, and nothing settled can move` : ''));
    return size > PROGRAM_CAP ? 1 : 0;
  }
  const target = join(dirname(file), ARCHIVE_NAME);
  const title = /^# PROGRAM:[^\S\r\n]*(.+?)\s*$/m.exec(lines.join('\n'))?.[1] ?? basename(dirname(file));
  const held = isFile(target) ? linesOf(target) : null;
  const base = held?.lines ?? [`# PROGRAM archive: ${title}`, '', ...ARCHIVED.flatMap((name) => [`## ${titleCase(name)}`, ''])];
  // Each heading's moved entries go after the last entry it holds, else after the heading, else at the end.
  const heldEntries = entriesOf(base);
  const inserts = [];
  for (const name of ARCHIVED) {
    const add = moving.filter((e) => e.section === name).flatMap(text);
    if (!add.length) continue;
    const last = heldEntries.filter((e) => e.section === name).at(-1);
    const heading = base.findIndex((l) => archivedHeading(l) === name);
    let at = base.length;
    if (last) at = last.end;
    else if (heading >= 0) for (at = heading + 1; at < base.length && !base[at].trim(); at++);
    inserts.push({ at, lines: last ? add : heading >= 0 ? [...add, ''] : [`## ${titleCase(name)}`, '', ...add, ''] });
  }
  for (const ins of inserts.sort((a, b) => b.at - a.at)) base.splice(ins.at, 0, ...ins.lines);
  const gone = new Set(moving.flatMap((e) => Array.from({ length: e.end - e.start }, (_, k) => e.start + k)));
  const kept = lines.filter((_, i) => !gone.has(i)).join(eol);
  writeFileSync(target, base.join(held?.eol ?? eol));
  writeFileSync(file, kept);
  const count = (name) => moving.filter((e) => e.section === name).length;
  const bytes = Buffer.byteLength(kept, 'utf8');
  console.log([
    `archived ${count('request history')} request(s), ${count('decisions ledger')} decision(s), and ${count('closed items')} closed item(s) into ${repoPath(target)}`,
    `${unsettled} unsettled decision(s) stay in the ledger`,
    `${repoPath(file)}: ${bytes} bytes against the ${PROGRAM_CAP}-byte cap${bytes > PROGRAM_CAP ? '; still over it' : ''}`,
    ...linksBlock([['program', repoPath(file)], ['archive', repoPath(target)]]),
  ].join('\n'));
  return bytes > PROGRAM_CAP ? 1 : 0;
}

// PROGRAM SPLIT AND MERGE (`co program split|merge`, design L5). Both read the ledger sections
// through entriesOf() and keep each entry's indented continuation lines. A CRLF ledger keeps its line
// ending. Both refuse a ledger with no "Grammar: 2" line or a `Status: merged into` or `Status: closed`
// line under its goal, and each validates everything before it writes anything.
//
// split <slug> --into <a>,<b> --assign <id>=<child>,...: each open item and each pending decision
// without `Forwarded-to:` goes to exactly one child, and the command exits 1 naming every unassigned
// id. It writes programs/<child>/PROGRAM.md beside the parent, and refuses a child that already has
// one. A child ledger holds `Split-from: <parent>` and the parent's goal, every parent request (the
// archive's too, in date order), the parent's Scope documents, and its assigned items with their
// original ids. The parent keeps every item and gains ` · Forwarded-to: <child>/<id>` on each. The
// parent takes no further hops after a split, so its forwarded pending decisions stay pending.
//
// merge <from> --into <to> [--head-ended]: the inverse. It appends the source's requests to the
// target's Request history tagged `[from <slug>]` after the date, adds the source's Scope documents
// whose path the target lacks, and imports each open item and pending decision under the next free id
// of its prefix across the target's ledger and archive, with ` · Was: <from>/<old id>`. An id named in
// an imported line's text is renumbered with its target, except inside `Anchor:` and `Pointer:`. The
// source gains `Status: merged into <to>` under its goal and ` · Forwarded-to: <to>/<new id>` on each
// imported item. An imported decision keeps its source `Hop:`, so check 12 fails it at the target's next
// handoff while it is pending: merge prints `settle <new id>: imported pending from <from>/<old id>;
// check 12 fails it at the next handoff` for each one. It refuses while a handoff of the source has a running head: an unconsumed handoff
// (awaiting resume) or a consumed chain whose last run folder has no handoff yet, as `live` reports,
// unless `--head-ended` is passed. A source with no handoff on disk has no signal, so it merges.
// Both exit 1 when a written ledger is over its 32 KB cap.
const LEDGER_SECTIONS = ['program goal', 'request history', 'scope documents', 'open items', 'decisions ledger', 'closed items'];
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/i;
const FORWARDED_RE = /\bForwarded-to:\s*\S/;
const ENDED_RE = /^[-*\t ]*Status:[^\S\r\n]*(merged into .+?|closed)\s*$/m;
const ledgerHeading = (l) => {
  const h = /^##[ \t]+(.+)$/.exec(l);
  return h ? LEDGER_SECTIONS.find((name) => h[1].trim().toLowerCase().startsWith(name)) ?? null : undefined;
};
const trimBlank = (ls) => {
  let from = 0;
  let to = ls.length;
  while (from < to && !ls[from].trim()) from++;
  while (to > from && !ls[to - 1].trim()) to--;
  return ls.slice(from, to);
};
const sectionLines = (lines, name) => {
  const at = lines.findIndex((l) => ledgerHeading(l) === name);
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && /^##[ \t]/.test(l));
  return lines.slice(at + 1, end < 0 ? lines.length : end);
};
// A ledger for split and merge: its lines, and its entries per section as { start, end, id, text }.
// `movable` lists the open items and pending decisions not yet forwarded.
function readProgram(arg, root, verb) {
  const file = programFileOf(arg, root);
  const shown = relative(root, file).replace(/\\/g, '/');
  const { lines, eol } = linesOf(file);
  const text = lines.join('\n');
  if (!isGrammar2(text)) die(`refusing to ${verb} ${shown}: it has no "Grammar: 2" line`);
  const ended = ENDED_RE.exec(text)?.[1];
  if (ended) die(`refusing to ${verb} ${shown}: it is already "Status: ${ended}"`);
  const entries = entriesOf(lines, ledgerHeading).map((e) => ({ ...e, id: leadId(lines[e.start]), text: lines.slice(e.start, e.end) }));
  const inSection = (name) => entries.filter((e) => e.section === name);
  const open = inSection('open items');
  const noId = open.filter((e) => !e.id);
  if (noId.length) die(`refusing to ${verb} ${shown}: ${noId.length} open item(s) lead with no id, such as: ${noId[0].text[0].trim().slice(0, 70)}`);
  const movable = [...open, ...inSection('decisions ledger').filter((e) => e.id && PENDING_RE.test(e.text[0]))].filter((e) => !FORWARDED_RE.test(e.text[0]));
  return { file, shown, slug: basename(dirname(file)), lines, eol, inSection, movable };
}
// The ledger's Request history entries and its archive's, each as a block of lines, in date order.
function requestBlocks(program) {
  const archiveFile = join(dirname(program.file), ARCHIVE_NAME);
  const blocksOf = (lines) => entriesOf(lines, ledgerHeading).filter((e) => e.section === 'request history').map((e) => lines.slice(e.start, e.end));
  const dateOf = (block) => /^[-*]\s+(\d{4}-\d{2}-\d{2})/.exec(block[0])?.[1] ?? '';
  return [...blocksOf(program.lines), ...(isFile(archiveFile) ? blocksOf(linesOf(archiveFile).lines) : [])].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
}
// Inserts `add` after the last entry under a ledger heading, else under the heading, else at the end.
function appendTo(lines, name, add) {
  if (!add.length) return;
  const last = entriesOf(lines, ledgerHeading).filter((e) => e.section === name).at(-1);
  if (last) { lines.splice(last.end, 0, ...add); return; }
  const heading = lines.findIndex((l) => ledgerHeading(l) === name);
  if (heading < 0) { lines.push('', `## ${titleCase(name)}`, '', ...add, ''); return; }
  let at = heading + 1;
  while (at < lines.length && !lines[at].trim()) at++;
  lines.splice(at, 0, ...(at === heading + 1 ? [''] : []), ...add, '');
}
const markForwarded = (lines, entry, target) => { lines[entry.start] = `${lines[entry.start].trimEnd()} · Forwarded-to: ${target}`; };
const ledgerBytes = (lines, eol) => Buffer.byteLength(lines.join(eol), 'utf8');
const capNote = (bytes) => `${bytes} bytes against the ${PROGRAM_CAP}-byte cap${bytes > PROGRAM_CAP ? '; over it, run co program archive' : ''}`;

function split(arg, flags) {
  const root = resolve(flags.root);
  const parent = readProgram(arg, root, 'split');
  const children = flags.into.split(',').map((c) => c.trim()).filter(Boolean);
  if (children.length < 2 || new Set(children).size !== children.length || !children.every((c) => SLUG_RE.test(c))) {
    die(`--into needs two or more distinct child slugs of letters, digits, and hyphens: ${flags.into}`);
  }
  const problems = [];
  const assigned = new Map();
  for (const pair of flags.assign.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [id, child, ...rest] = pair.split('=').map((p) => p.trim());
    if (!id || !child || rest.length) die(`--assign takes <id>=<child> pairs: ${pair}`);
    if (assigned.has(id)) problems.push(`${id} is assigned twice`);
    assigned.set(id, child);
  }
  const known = new Set(parent.movable.map((e) => e.id));
  for (const [id, child] of assigned) {
    if (!known.has(id)) problems.push(`${id} is neither an open item nor a pending decision of ${parent.slug}`);
    if (!children.includes(child)) problems.push(`${id} is assigned to ${child}, which --into does not name`);
  }
  const unassigned = [...known].filter((id) => !assigned.has(id));
  if (unassigned.length) problems.unshift(`${unassigned.length} item(s) unassigned: ${unassigned.join(', ')}`);
  const dirOf = (child) => join(dirname(dirname(parent.file)), child);
  for (const child of children) if (existsSync(join(dirOf(child), 'PROGRAM.md'))) problems.push(`${child} already has a ledger at ${relative(root, join(dirOf(child), 'PROGRAM.md')).replace(/\\/g, '/')}`);
  if (problems.length) die(`refusing to split ${parent.shown}: ${problems.join('; ')}`);

  const goal = trimBlank(sectionLines(parent.lines, 'program goal'));
  const requests = requestBlocks(parent).flat();
  const scope = parent.inSection('scope documents').flatMap((e) => e.text);
  const section = (name, body) => [`## ${name}`, '', ...body, ...(body.length ? [''] : [])];
  const written = children.map((child) => {
    const mine = parent.movable.filter((e) => assigned.get(e.id) === child);
    const ofSection = (name) => mine.filter((e) => e.section === name).flatMap((e) => e.text);
    const lines = [`# PROGRAM: ${child}`, '', 'Grammar: 2', '', ...section('Program goal', [`Split-from: ${parent.slug}`, '', ...goal]),
      ...section('Request history', requests), ...section('Scope documents', scope), ...section('Open items', ofSection('open items')),
      ...section('Decisions ledger', ofSection('decisions ledger')), ...section('Closed items', [])];
    return { child, file: join(dirOf(child), 'PROGRAM.md'), lines, open: mine.filter((e) => e.section === 'open items').length, decisions: mine.filter((e) => e.section === 'decisions ledger').length };
  });
  for (const e of parent.movable) markForwarded(parent.lines, e, `${assigned.get(e.id)}/${e.id}`);
  for (const w of written) { mkdirSync(dirname(w.file), { recursive: true }); writeFileSync(w.file, w.lines.join(parent.eol)); }
  writeFileSync(parent.file, parent.lines.join(parent.eol));
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
  const sizes = written.map((w) => ledgerBytes(w.lines, parent.eol));
  console.log([
    `split ${parent.shown} into ${children.join(', ')}; each parent item now carries Forwarded-to:`,
    ...written.map((w, i) => `${repoPath(w.file)}: ${w.open} open item(s), ${w.decisions} pending decision(s), ${capNote(sizes[i])}`),
    ...linksBlock([['parent', parent.shown], ...written.map((w) => [w.child, repoPath(w.file)])]),
  ].join('\n'));
  return sizes.some((n) => n > PROGRAM_CAP) ? 1 : 0;
}

// The first handoff of a program whose head is running, as walkHead() reports it, else null.
function runningHead(programFile, root) {
  for (const h of handoffsIn(root)) {
    const ledger = pathValue(sectionBody(readFileSync(h.file, 'utf8'), 'program'), 'Program');
    if (!ledger || resolve(root, ledger) !== programFile) continue;
    const head = walkHead(h.dir, root, root);
    if (head.running) return head;
  }
  return null;
}

function merge(arg, flags) {
  const root = resolve(flags.root);
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
  const src = readProgram(arg, root, 'merge');
  const dst = readProgram(flags.into, root, 'merge into');
  if (src.file === dst.file) die(`refusing to merge ${src.shown} into itself`);
  if (!flags['head-ended']) {
    const head = runningHead(src.file, root);
    if (head) die(`refusing to merge ${src.shown}: its head session looks running (${head.state}, run dir ${repoPath(head.dir)}); pass --head-ended once it has ended`);
  }
  // The next free id of each prefix, over every top-level bullet of the target's ledger and archive.
  const archiveFile = join(dirname(dst.file), ARCHIVE_NAME);
  const top = new Map();
  for (const l of [...dst.lines, ...(isFile(archiveFile) ? linesOf(archiveFile).lines : [])]) {
    const m = /^[-*]\s+(?:\[[ xX]\]\s+)?([A-Z][A-Z0-9]*)-(\d+)\b/.exec(l);
    if (m) top.set(m[1], Math.max(top.get(m[1]) ?? 0, Number(m[2])));
  }
  const fresh = new Map();
  for (const e of src.movable) {
    const prefix = e.id.replace(/-\d+$/, '');
    top.set(prefix, (top.get(prefix) ?? 0) + 1);
    fresh.set(e.id, `${prefix}-${top.get(prefix)}`);
  }
  // Renumbers each mapped id in a line's fields, and in a continuation line, but not in an Anchor or Pointer.
  const remap = (l) => l.split(' · ').map((f) => (/^(?:Anchor|Pointer):/.test(f) ? f : f.replace(/\b[A-Z][A-Z0-9]*-\d+\b/g, (id) => fresh.get(id) ?? id))).join(' · ');
  const imported = (name) => src.movable.filter((e) => e.section === name)
    .flatMap((e) => e.text.map((l, i) => (i ? remap(l) : `${remap(l).trimEnd()} · Was: ${src.slug}/${e.id}`)));
  const tag = `[from ${src.slug}]`;
  const requests = requestBlocks(src).flatMap((block) => block.map((l, i) => (i ? l
    : /^[-*]\s+\d{4}-\d{2}-\d{2}/.test(l) ? l.replace(/^([-*]\s+\d{4}-\d{2}-\d{2})/, (_, lead) => `${lead} ${tag}`) : l.replace(/^([-*]\s+)/, (_, lead) => `${lead}${tag} `))));
  const docPath = (block) => /`([^`]+)`/.exec(block.text[0])?.[1];
  const held = new Set(dst.inSection('scope documents').map(docPath));
  const scope = src.inSection('scope documents').filter((e) => !held.has(docPath(e))).flatMap((e) => e.text);
  appendTo(dst.lines, 'request history', requests);
  appendTo(dst.lines, 'scope documents', scope);
  appendTo(dst.lines, 'open items', imported('open items'));
  appendTo(dst.lines, 'decisions ledger', imported('decisions ledger'));
  for (const e of src.movable) markForwarded(src.lines, e, `${dst.slug}/${fresh.get(e.id)}`);
  const goal = src.lines.findIndex((l) => ledgerHeading(l) === 'program goal');
  if (goal < 0) src.lines.push('', '## Program goal', '', `Status: merged into ${dst.slug}`, '');
  else src.lines.splice(goal + 1, 0, '', `Status: merged into ${dst.slug}`);
  writeFileSync(dst.file, dst.lines.join(dst.eol));
  writeFileSync(src.file, src.lines.join(src.eol));
  const bytes = ledgerBytes(dst.lines, dst.eol);
  console.log([
    `merged ${src.shown} into ${dst.shown}: ${requestBlocks(src).length} request(s), ${scope.filter((l) => /^[-*]\s/.test(l)).length} new scope document(s), ${fresh.size} item(s) renumbered`,
    ...[...fresh].map(([old, now]) => `${old} -> ${now} (Was: ${src.slug}/${old})`),
    ...src.movable.filter((e) => e.section === 'decisions ledger')
      .map((e) => `settle ${fresh.get(e.id)}: imported pending from ${src.slug}/${e.id}; check 12 fails it at the next handoff`),
    `${dst.shown}: ${capNote(bytes)}`,
    ...linksBlock([['target', dst.shown], ['source', src.shown]]),
  ].join('\n'));
  return bytes > PROGRAM_CAP ? 1 : 0;
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

// The register as this ledger's promoted decisions see it. A promoted id not sealed on the working tree is
// UNLANDED, a warning: the record lands when its branch merges. An id superseded or amended now, that was not
// at the handoff's Verified-at commit, is DRIFTED: another program changed a rule this one relies on.
const CHANGED = new Set(['superseded', 'amended']);
function registerLines(programFile, handoffText, root) {
  if (!programFile || !ledgerOf(programFile).grammar2) return [];
  const archiveFile = join(dirname(programFile), ARCHIVE_NAME);
  const promoted = promotedIds([programFile, archiveFile].filter(existsSync).map((f) => readFileSync(f, 'utf8')).join('\n'));
  const hub = hubOf(root);
  const sha = /^Verified-at:\s*([0-9a-f]{7,40})\b/im.exec(handoffText)?.[1];
  let known = false;
  try { known = Boolean(sha) && git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`], { cwd: root }) !== ''; } catch { /* an unknown sha cannot show drift */ }
  const lines = [];
  for (const { dec, recordId } of promoted) {
    const label = `${dec ?? 'decision'} promoted:${recordId}`;
    const now = recordState(root, recordId, { hub });
    if (now.where !== 'sealed') lines.push(`warning: UNLANDED ${label}: ${now.where === 'pending' ? 'staged in intake, not yet sealed' : 'in neither state.json nor intake'}`);
    if (known && CHANGED.has(now.status) && !CHANGED.has(recordState(root, recordId, { ref: sha }).status)) {
      lines.push(`DRIFTED ${label}: now ${now.status}, not at Verified-at ${sha}`);
    }
  }
  return lines;
}

// The PROGRAM.md a run folder belongs to: its SESSION.json `program`, else its own handoff's Program
// line, else its predecessor handoff's. Null when none resolves to a file.
function programOfRun(dir, base) {
  const programLine = (file) => { try { return pathValue(sectionBody(readFileSync(file, 'utf8'), 'program'), 'Program'); } catch { return null; } };
  const session = readJson(join(dir, 'SESSION.json')) ?? {};
  const named = (typeof session.program === 'string' && session.program) || programLine(join(dir, 'HANDOFF.md'))
    || (typeof session.predecessor === 'string' && programLine(resolve(base, session.predecessor))) || null;
  const file = named && (isAbsolute(named) ? named : resolve(base, named));
  return file && isFile(file) ? file : null;
}

// C6: warning lines for each scope document another live program in this repository also lists.
// The block is empty for no overlap, and any failure skips silently: the warning never blocks.
const OVERLAP_LINES = 10;
const scopeKey = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
function overlapLines(programFile, root, sid) {
  try {
    if (!programFile || !isFile(programFile) || /^(off|0|false)$/i.test(process.env.CODE_OPS_PEER_GUARD ?? '')) return [];
    const mine = new Set(scopeDocs(programFile).map(scopeKey));
    if (!mine.size) return [];
    const ident = repoIdentity(process.cwd());
    const own = forward(relative(root, programFile));
    const others = new Map();
    for (const rec of readBoard(process.cwd())) {
      if (rec.state !== 'live' || rec.sessionId === sid || typeof rec.runDir !== 'string' || !rec.runDir) continue;
      const base = recordBase(rec, ident, root);
      const dir = resolve(base, rec.runDir);
      const file = programOfRun(dir, base);
      if (!file || walkHead(dir, base, base).dir !== dir) continue;
      const key = forward(relative(base, file));
      if (key === own) continue;
      const known = others.get(key);
      const name = String(rec.name ?? rec.sessionId.slice(0, 8)).replace(/\s+/g, ' ').trim().slice(0, 80);
      if (known) { known.names.add(name); continue; }
      const text = readFileSync(file, 'utf8');
      if (ENDED_RE.test(text)) continue;
      const shared = scopeDocs(file).map(scopeKey).filter((p) => mine.has(p));
      others.set(key, { slug: basename(dirname(file)), names: new Set([name]), shared: shared.length ? shared : null });
    }
    const all = [];
    for (const { slug, names, shared } of others.values()) {
      if (!shared) continue;
      all.push(...shared.map((p) => `  warning: program ${slug} (live head: ${[...names].join(' and ')}) also lists ${p}`));
      if (shared.length > 1) all.push(`  suggest: ${shared.length} shared paths with ${slug}; if they are one effort, run co program merge ${basename(dirname(programFile))} --into ${slug}`);
    }
    const shown = all.length > OVERLAP_LINES ? [...all.slice(0, OVERLAP_LINES), `  ... ${all.length - OVERLAP_LINES} more`] : all;
    return shown.length ? ['program overlap:', ...shown] : [];
  } catch { return []; }
}

// Demotion candidates (DEC-74): open items whose line text is identical across this handoff and its
// previous four predecessors. The walk follows `Predecessor:` and ends quietly at a missing file;
// fewer than UNCHANGED_HOPS handoffs in the chain prints no line.
const UNCHANGED_HOPS = 5;
function unchangedItems(target, root) {
  const chain = [];
  const seen = new Set();
  for (let file = target; file && chain.length < UNCHANGED_HOPS && !seen.has(file) && isFile(file);) {
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    chain.push(new Map(bullets(sectionBody(text, 'open items')).map((l) => [itemId(l), l.trim()]).filter(([id]) => id)));
    const next = pathValue(sectionBody(text, 'program'), 'Predecessor');
    file = next && !/^none$/i.test(next) ? resolve(root, next) : null;
  }
  if (chain.length < UNCHANGED_HOPS) return [];
  const [first, ...older] = chain;
  const ids = [...first].filter(([id, line]) => older.every((m) => m.get(id) === line)).map(([id]) => id);
  return [`unchanged ${UNCHANGED_HOPS}+ hops: ${ids.join(', ') || 'none'}`];
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
  const hostSessionId = flags['host-session'] || null;
  const consume = ['--consume', '--successor', repoPath(successor), '--name', name, ...(sid ? ['--session', sid] : [])];

  // Scope digests, before the check so an unfilled file blocks the consume. A handoff without the
  // file resumes as before.
  const digestsFile = join(dirname(resolve(target)), DIGESTS);
  const hasDigests = existsSync(digestsFile);
  const docs = programFile && existsSync(programFile) ? scopeDocs(programFile) : [];
  const scope = [];
  if (hasDigests) {
    const unfilled = readFileSync(digestsFile, 'utf8').split('\n').filter((l) => l.includes('[FILL:')).length;
    report('scope digests', { ok: unfilled === 0, all: `${repoPath(digestsFile)}: ${unfilled} line(s) still hold a "[FILL:" placeholder` });
  }

  const check = step('check-handoff.mjs', [target, '--root', root, ...(failures === 0 ? consume : [])]);
  report('handoff check', check);
  // A scope document that moved (FORWARDING.json, resolved by the check) is read at its new path.
  const moved = new Map([...check.err.matchAll(/^ {2}warning: MOVED scope document (.+) -> (.+)$/gm)].map((m) => [m[1], m[2]]));
  const docAt = (path) => resolve(root, moved.get(path) ?? path);
  if (hasDigests) {
    const recorded = readDigests(digestsFile);
    for (const path of docs) {
      const entry = recorded.get(path);
      if (!entry) scope.push(`  missing ${path}: no digest entry; read the document`);
      else if (entry.hash === scopeHash(docAt(path))) scope.push(`  unchanged ${path}: read its digest, not the document`);
      else scope.push(`  changed ${path}: re-read the document`);
    }
  }
  if (failures === 0) {
    const created = new Date().toISOString();
    // Grammar 2: a carried item shows only id and title, so TASKS.md takes its ledger line.
    const ledger = ledgerOf(programFile);
    const openLines = bullets(sectionBody(text, 'open items'))
      .map((l) => (ledger.grammar2 && !/\bOwner:/.test(l) && ledger.open.get(leadId(l))) || l);
    mkdirSync(successor, { recursive: true });
    writeJson(join(successor, 'SESSION.json'), { v: 1, sessionId: sid, hostSessionId, name, hop, predecessor: repoPath(resolve(target)), createdAt: created });
    writeFileSync(join(successor, 'TASKS.md'), `# Tasks\n${openLines.length ? `\n${openLines.join('\n')}\n` : ''}`);
    writeFileSync(join(successor, 'RUN_LOG.md'), `# Run log\n\n- ${created}: ${name} resumed ${repoPath(resolve(target))}.\n`);
    writeSessionRecord(sid, { hostSessionId, name, runDir: repoPath(successor), resumed: repoPath(resolve(target)), hop });
    boardNote(sid, { hostSessionId, name, runDir: repoPath(successor), task: `${programTitle(programFile) ?? name} (resumed hop ${hop})` },
      docs.map((p) => resolve(root, p)));
  }
  const anchors = [...check.err.matchAll(/^ {2}(FRESH|MOVED|DRIFTED|GONE|AMBIGUOUS|NO-REF)\s+(.*)$/gm)];
  const counts = {};
  for (const [, status] of anchors) counts[status] = (counts[status] ?? 0) + 1;
  lines.push(`same-tree: ${check.err.includes('same-tree:') ? 'yes' : 'no'}`);
  lines.push(`anchors: ${Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}`);
  lines.push(...anchors.filter(([, s]) => s !== 'FRESH').map(([, s, where]) => `   ${s} ${where}`));
  lines.push(...[...check.err.matchAll(/^ {2}warning: (.*)$/gm)].map(([, w]) => `warning: ${w}`));
  lines.push(...registerLines(programFile, text, root));
  if (hasDigests) lines.push(`scope documents (digests in ${repoPath(digestsFile)}):`, ...(scope.length ? scope : ['  none']));

  lines.push(...[...check.err.matchAll(/^ {2}(burn-down: .*)$/gm)].map((m) => m[1]), ...unchangedItems(target, root));
  const open = bullets(sectionBody(text, 'open items'));
  const byOwner =(owner) => open.filter((l) => new RegExp(`\\bOwner:\\s*${owner}\\b`, 'i').test(l)).map((l) => `  ${l}`);
  lines.push('Blocked on operator:', ...(byOwner('operator').length ? byOwner('operator') : ['  none']));
  lines.push('Agent-owned:', ...(byOwner('agent').length ? byOwner('agent') : ['  none']));
  if (failures === 0) {
    lines.push(`consumed: ${join(dirname(target), 'HANDOFF.consumed')}`, `session name: ${name}`, `successor run: ${repoPath(successor)}`);
  } else lines.push(`not consumed: ${failures} step(s) failed`);

  // Clickable links for the operator: the ledger, its scope documents, the handoff, the successor
  // run, and each open item's Pointer, with any :line suffix kept in the label only.
  const links = [];
  if (programFile && existsSync(programFile)) links.push(['program', repoPath(programFile)]);
  links.push(...docs.map((path) => ['scope document', repoPath(docAt(path)), path]));
  if (hasDigests) links.push(['scope digests', repoPath(digestsFile)]);
  links.push(['handoff', repoPath(resolve(target))]);
  if (failures === 0) links.push(['successor run', repoPath(successor)]);
  links.push(...pointerEntries(open, root, repoPath));
  lines.push(...overlapLines(programFile, root, sid), ...linksBlock(links));
  if (failures === 0) lines.push(`set title: "${name}"`);

  console.log(lines.join('\n'));
  return failures === 0 ? 0 : 1;
}

function open(slug, flags) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) usage([`x run open needs a slug of letters, digits, and hyphens: ${slug}`, ...USAGE]);
  const root = resolve(flags.root);
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
  const programFile = flags.program ? resolve(root, flags.program) : null;
  if (programFile && !isFile(programFile)) die(`--program does not resolve to a file: ${flags.program}`);
  const all = runsRoots(root, true);
  const runs = flags.hub ? join(resolve(flags.hub), '80 Runs') : (runsRoots(root)[0] ?? all[1] ?? all[0]);
  const dir = freeDir(runs, `${today()}-${slug}`);
  mkdirSync(runs, { recursive: true });
  mkdirSync(dir);
  const sid = sessionIdOf(flags);
  const hostSessionId = flags['host-session'] || null;
  const name = flags.name || slug;
  const created = new Date().toISOString();
  writeJson(join(dir, 'SESSION.json'), { v: 1, sessionId: sid, hostSessionId, name, hop: 0, predecessor: null, ...(programFile && { program: repoPath(programFile) }), createdAt: created });
  writeFileSync(join(dir, 'TASKS.md'), '# Tasks\n');
  writeFileSync(join(dir, 'RUN_LOG.md'), `# Run log\n\n- ${created}: ${name} opened this run as new work.\n`);
  writeSessionRecord(sid, { hostSessionId, name, runDir: repoPath(dir), resumed: null, hop: 0 });
  boardNote(sid, { hostSessionId, name, runDir: repoPath(dir), task: name });
  console.log([repoPath(dir), ...overlapLines(programFile, root, sid), ...linksBlock([['run', repoPath(dir)]])].join('\n'));
  return 0;
}

// The run folder a live-head walk starts from: a handoff's own folder, or the run folder of the
// session named by exact id, exact host session id, a unique id prefix of 8 or more characters, or
// name.
function liveStart(arg, root) {
  if (existsSync(arg) && statSync(arg).isFile()) return { dir: dirname(resolve(arg)), base: root };
  const { ident, records } = sessionRecords(root);
  const want = arg.toLowerCase();
  const prefixed = arg.length >= 8 ? records.filter((r) => String(r.sessionId).startsWith(arg)) : [];
  const named = records.filter((r) => typeof r.name === 'string' && r.name.toLowerCase() === want)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const rec = records.find((r) => r.sessionId === arg) ?? records.find((r) => r.hostSessionId === arg) ?? (prefixed.length === 1 ? prefixed[0] : null) ?? named[0];
  if (rec) { const base = recordBase(rec, ident, root); return { dir: resolve(base, rec.runDir), base }; }
  const hits = handoffsIn(root).filter((h) => h.session && h.session.toLowerCase() === want);
  if (hits.length === 1) return { dir: hits[0].dir, base: root };
  die(hits.length ? `ambiguous session name: ${arg} matches ${hits.length} handoffs` : `no handoff, session record, or Session line matches: ${arg}`);
}

// Walks consumed handoffs from a run folder to the head run folder. `running` is true when the head is
// live (its folder has no handoff yet) or awaiting resume (its handoff is unconsumed).
function walkHead(dir, base, root) {
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
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
    const next = mark.successorRun && resolve(base, mark.successorRun);
    if (!next) { state = 'unknown: a legacy HANDOFF.consumed names no successor run'; break; }
    if (seen.has(next) || !existsSync(next)) { state = `unknown: successor run ${mark.successorRun} ${seen.has(next) ? 'loops back' : 'is missing'}`; break; }
    dir = next;
    hops++;
  }
  return { dir, state, hops, running: state === 'live' || state.startsWith('awaiting resume') };
}

function live(arg, flags) {
  const root = resolve(flags.root);
  const repoPath = (p) => relative(root, p).replace(/\\/g, '/');
  const { dir: start, base } = liveStart(arg, root);
  const { dir, state, hops } = walkHead(start, base, root);
  const session = readJson(join(dir, 'SESSION.json')) ?? {};
  console.log([
    `head session: ${session.name ?? 'unknown'}`,
    `session id: ${session.sessionId ?? 'unknown'}`,
    ...(session.hostSessionId ? [`host session: ${session.hostSessionId}`] : []),
    `run dir: ${repoPath(dir)}`,
    `state: ${state}`,
    `hops walked: ${hops}`,
  ].join('\n'));
  return 0;
}

// co.mjs sets argv[1] to this file before importing it, so both entries pass. The module URL is
// symlink-resolved, so argv[1] is resolved the same way before the compare.
function isEntry() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

if (isEntry()) {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseOrDie(rest, {
    run: { value: true },
    base: { value: true },
    out: { value: true },
    root: { value: true, default: '.', missing: 'needs a path' },
    name: { value: true },
    session: { value: true },
    hub: { value: true },
    'host-session': { value: true },
    program: { value: true },
    into: { value: true },
    assign: { value: true },
    'head-ended': { value: false },
    'pending-agents-ok': { value: false },
  }, USAGE.join('\n'));
  if (flags.program && command !== 'draft' && command !== 'open') usage(USAGE);
  const onlyFlags = (...names) => Object.keys(flags).every((k) => k === 'root' || names.includes(k));
  if (command === 'program-split' && positional.length === 1 && flags.into && flags.assign && onlyFlags('into', 'assign')) process.exit(split(positional[0], flags));
  if (command === 'program-merge' && positional.length === 1 && flags.into && onlyFlags('into', 'head-ended')) process.exit(merge(positional[0], flags));
  if (command === 'program-archive' && positional.length === 1 && Object.keys(flags).every((k) => k === 'root')) process.exit(archive(positional[0], flags));
  if (/^board(-claim|-release|-task)?$/.test(command ?? '') && !flags.run && !flags.base && !flags.out && !flags.name && !flags.hub && !flags['host-session']
    && (command === 'board' ? positional.length === 0 : command === 'board-release' || positional.length > 0)) process.exit(board(command, positional, flags));
  const noDraftFlags = !flags.run && !flags.base && !flags.out;
  const host = flags['host-session'];
  if (command === 'draft' && positional.length === 0 && !flags.hub && !host) process.exit(draft(flags));
  if (command === 'resume' && positional.length === 1 && noDraftFlags && !flags.name && !flags.hub) process.exit(resume(positional[0], flags));
  if (command === 'open' && positional.length === 1 && noDraftFlags) process.exit(open(positional[0], flags));
  if (command === 'live' && positional.length === 1 && noDraftFlags && !flags.name && !flags.session && !flags.hub && !host) process.exit(live(positional[0], flags));
  usage(USAGE);
}
