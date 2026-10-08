#!/usr/bin/env node
// Transcript recall: after host compaction, a session recovers exact earlier detail from its own
// host transcript (a JSONL file) without reading the whole file. Every answer ends at the original
// bytes and is checked by sha256. It makes no model call and runs nothing on a hot path.
//
//   node scripts/transcript-recall.mjs <status|outline|search|zoom|build> --session <id>
//        [--agent <agentId>] [--transcript <file>] [--id <@off+len>|--line <n>] [--terms <text>] [--kind text|tool|error]
//        [--depth 1] [--page 0] [--budget 4000] [--json]
//   co recall <command> ...        (the same script)
//
// INDEX. `<CODE_OPS_HOME or home>/.claude/code-ops/recall/<projectSlug(stateRoot(cwd))>/<session slug>/`
// holds `meta.json` (version, transcript, indexedBytes, the sha256 of the last indexed line, the
// boundary count, and the resume point) and `tree.json` (the nodes). It stores anchors and masked
// labels, never raw transcript bytes. The first call whose index is missing, or behind the file,
// builds it: from the resume point when the sha256 of the last indexed line still matches, else from
// scratch. Only lines that end in a newline count, so a half-written last line waits. An O_EXCL
// lock file with a stale PID and age check keeps two builders apart. `build` also rebuilds after a
// shrink or a same-size rewrite; every other command keeps the old index, so `zoom` meets the
// changed bytes and fails closed.
//
// TREE. L0 session; L1 epoch (the rows between two `compact_boundary` rows); L2 turn (one operator
// prompt to the next, or the rows of an epoch that no prompt opens); L3 step (one assistant
// `message.id` group); L4 block (an assistant row with text or tool_use, joined to its tool_result
// rows by `tool_use_id`, or an operator prompt, or a tool_result with no tool_use). Sidechain rows,
// `isCompactSummary` rows, and thinking-only rows are never nodes. Every node anchors at its first
// row: a block id is `@<off>+<len>` and is the only leaf; an interior id adds `:<kind>` (`:step`,
// `:turn`, `:epoch`, `:session`), so a one-row step and its block never share an id. A uuid is an
// alias for a block. `line:<n>` is the transcript line of a block's row or of one of its results.
// Every label is computed (no model) and masked before it is written.
//
// COMMANDS, each bounded by --budget bytes of output (pages by --page):
//   status   index age, indexedBytes, file size, boundaries, node count, whether it is current.
//   outline  child labels of --id (default the session) down to --depth.
//   search   scans the raw transcript bytes at query time, ranks blocks by term hits (exact
//            identifiers weigh more), returns id, label, score, and a masked snippet.
//   zoom     an interior node lists its child labels; a block re-reads its rows, checks sha256, and
//            fails closed with `anchor drift` on a mismatch or truncation. Output is masked.
//   build    brings the index up to date and reports how (full, incremental, none).
//
// SAFETY. Raw transcript text never reaches output: labels are masked before they are stored, a
// search snippet and a zoom page are masked before they are cut, and the terms are never echoed.
// The masker (compact-snapshot.mjs maskTexts, backed by scan-redaction.mjs) redacts the fail-closed
// secret shapes, whole lines at a time, and redactBlocks() first replaces a private key block (BEGIN
// to END, every line between) with one marker, because the scanner flags only the BEGIN line. Neither
// catches a shape it has no rule for, and a failed mask withholds the text. `CODE_OPS_RECALL=off|0|false` turns every command into a one-line
// notice with exit 0.
//
// Exit: 0 = answered; 1 = failed closed (anchor drift, unknown node, no transcript, masking failed,
// lock timeout); 2 = usage error. With --json a failure prints {"error": ...} on stdout, with no
// transcript content.

import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOrDie, usage } from './cli-lib.mjs';
import { maskTexts, redactBlocks } from './compact-snapshot.mjs';
import { atomicWrite } from './context-index-lib.mjs';
import { bashFamily, defaultTranscriptDir, isBoundary, isOperatorPrompt, projectSlug, stateRoot, walkLines } from './transcript-lib.mjs';

const USAGE = 'usage: transcript-recall.mjs <status|outline|search|zoom|build> --session <id> [--agent <agentId>] [--transcript <file>] [--id <@off+len>|--line <n>] [--terms <text>] [--kind text|tool|error] [--depth 1] [--page 0] [--budget 4000] [--json]';
const COMMANDS = ['status', 'outline', 'search', 'zoom', 'build'];
const KINDS = ['text', 'tool', 'error'];
const VERSION = 1;
const LABEL_MAX = 200;
const HEAD_MAX = 100;
const DEFAULT_BUDGET = 4000;
const MIN_BUDGET = 200;
const MAX_DEPTH = 8;
const SEARCH_TOP = 20;
const SNIPPET_RADIUS = 90;
const MASK_WINDOW = 131_072;
const LOCK_STALE_MS = 120_000;
const LOCK_WAIT_MS = 20_000;
const WITHHELD = '[withheld: masking failed]';
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MARKER = /^\s*(?:[-*>]\s+)?(?:\*\*)?(?:Decision:|CONFIRMED\b|PROBABLE\b|error\b)/i;
const ID_RE = /^@(\d+)\+(\d+)(?::(session|epoch|turn|step))?$/;
const KEYS = ['id', 'kind', 'parent', 'off', 'len', 'sha256', 'uuid', 'bk', 'err', 'res', 'bnd', 'f', 'label'];

class Fail extends Error {}
class Drift extends Fail {
  constructor() { super('anchor drift'); }
}
class MaskError extends Fail {
  constructor() { super('masking failed'); }
}

export const recallEnabled = (env = process.env) => !/^(?:off|0|false)$/i.test(String(env.CODE_OPS_RECALL ?? '').trim());

// A subagent index sits beside the main one, keyed on session plus agent, so the two never collide.
export function indexDir(cwd, session, home = process.env.CODE_OPS_HOME || homedir(), agent = null) {
  const key = agent ? `${projectSlug(session)}--agent-${projectSlug(agent)}` : projectSlug(session);
  return join(home, '.claude', 'code-ops', 'recall', projectSlug(stateRoot(cwd)), key);
}

// The host names a subagent id with letters, digits, and hyphens; anything else could leave the directory.
const AGENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const collapse = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
const cut = (text, max) => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`);
const byteLen = (value) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value));

// ---------------------------------------------------------------- masking: the one choke point

// redactBlocks() (compact-snapshot.mjs) replaces a whole private key block with one marker. maskTexts
// runs it too, but it also runs here where text first leaves a row (sectionsOf and the label
// sources), because a slice or a cut made before masking could separate a body line from its BEGIN.

// Every string that leaves this script or lands in the index passes through here.
function maskAll(texts) {
  if (!texts.length) return [];
  let out;
  try {
    out = maskTexts(texts);
  } catch { throw new MaskError(); }
  if (!Array.isArray(out) || out.length !== texts.length || out.some((t) => typeof t !== 'string')) throw new MaskError();
  return out;
}

// One scanner run for many one-line strings: the strings travel as the lines of a single text.
function maskLines(strings) {
  if (!strings.length) return [];
  const lines = maskAll([strings.join('\n')])[0].split('\n');
  if (lines.length !== strings.length) throw new MaskError();
  return lines;
}

// ---------------------------------------------------------------- reading rows

const parseRow = (text) => {
  if (!text.trim()) return null;
  try {
    const o = JSON.parse(text);
    return o && typeof o === 'object' ? o : null;
  } catch { return null; }
};

const contentText = (c) => {
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map((b) => (typeof b?.text === 'string' ? b.text : '')).filter(Boolean).join('\n') : '';
};

// The readable parts of one row, in order: `kinds` says which --kind filters count the part.
function sectionsOf(o) {
  const out = [];
  const content = o.message?.content;
  if (typeof content === 'string') return [{ head: o.type === 'user' ? 'prompt' : 'text', body: redactBlocks(content), kinds: ['text'] }];
  if (!Array.isArray(content)) return out;
  for (const b of content) {
    if (b?.type === 'text' && typeof b.text === 'string') out.push({ head: o.type === 'user' ? 'prompt' : 'assistant text', body: redactBlocks(b.text), kinds: ['text'] });
    else if (b?.type === 'tool_use') out.push({ head: `tool_use ${collapse(b.name)}`, body: redactBlocks(JSON.stringify(b.input ?? {})), kinds: ['tool'] });
    else if (b?.type === 'tool_result') {
      const err = b.is_error === true;
      out.push({ head: err ? 'tool_result (error)' : 'tool_result', body: redactBlocks(contentText(b.content)), kinds: err ? ['tool', 'error'] : ['tool'] });
    }
  }
  return out;
}

function readAt(fd, off, len) {
  const bytes = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = readSync(fd, bytes, got, len - got, off + got);
    if (!n) break;
    got += n;
  }
  return got === len ? bytes : null;
}

function readFrom(file, off) {
  const fd = openSync(file, 'r');
  try {
    const size = statSync(file).size;
    return readAt(fd, off, Math.max(0, size - off)) ?? Buffer.alloc(0);
  } finally { closeSync(fd); }
}

// ---------------------------------------------------------------- the build

const toolTarget = (name, input) => {
  if (name === 'Bash') return `Bash ${bashFamily(input?.command)}`;
  const arg = input?.file_path ?? input?.notebook_path ?? input?.path ?? input?.pattern ?? input?.subagent_type;
  return typeof arg === 'string' && arg ? `${name} ${collapse(arg)}` : name;
};

const firstSentence = (text) => {
  const flat = collapse(text);
  return cut(/^(.*?[.!?])(?:\s|$)/.exec(flat)?.[1] ?? flat, HEAD_MAX);
};

const resultStatus = (r) => (r.err ? (r.exit ? `exit ${r.exit} error` : 'error') : r.exit ? `exit ${r.exit}` : 'ok');

const topN = (map, n) => [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);
const histogram = (pairs) => pairs.map(([name, n]) => (n > 1 ? `${name} x${n}` : name)).join(', ');

// Scans buf (the file from byte `base`, whose first line has number `firstLine`) and returns the
// nodes it creates after `kept`, the nodes before the resume point. Labels are masked in one batch.
// In a subagent transcript every row is a sidechain row, so `sidechain` makes them the main thread.
function scan(buf, base, firstLine, kept, root, sidechain = false) {
  const list = [...kept];
  const created = [];
  const pending = new Map();
  let epoch = null;
  for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === 'epoch') { epoch = list[i]; break; }
  let turn = null;
  let step = null;
  let tail = null;
  let partial = 0;

  const make = (kind, row, parent, extra = {}) => {
    const n = {
      id: kind === 'block' ? `@${row.off}+${row.len}` : `@${row.off}+${row.len}:${kind}`,
      kind, parent: parent.id, off: row.off, len: row.len, sha256: row.sha256, ...extra, _turn: turn, _line: row.line,
    };
    list.push(n);
    created.push(n);
    return n;
  };
  const needTurn = (row) => {
    if (!epoch) epoch = make('epoch', row, root);
    if (!turn) {
      turn = make('turn', row, epoch, { _raw: { tools: new Map(), files: new Map(), promptLine: 0 } });
      turn._turn = turn;
    }
  };
  const closeTurn = () => { turn = null; step = null; pending.clear(); };

  for (const rec of walkLines(buf)) {
    if (rec.off + rec.len >= buf.length) { partial = buf.length - rec.off; break; }
    let digest = null;
    const row = {
      off: base + rec.off, len: rec.len, line: firstLine + rec.line - 1,
      get sha256() { return (digest ??= sha256(buf.subarray(rec.off, rec.off + rec.len))); },
    };
    tail = row;
    if (!root) root = { id: `@${row.off}+${row.len}:session`, kind: 'session', parent: null, off: row.off, len: row.len, sha256: row.sha256 };
    const o = parseRow(rec.text);
    if (!o) continue;
    if (isBoundary(o)) {
      closeTurn();
      epoch = make('epoch', row, root, { bnd: true });
      continue;
    }
    if ((o.isSidechain === true && !sidechain) || o.isCompactSummary === true) continue;
    const content = o.message?.content;
    if (o.type === 'user' && Array.isArray(content)) {
      let orphan = null;
      for (const b of content) {
        if (b?.type !== 'tool_result') continue;
        const text = contentText(b.content);
        const info = { bytes: Buffer.byteLength(text), err: b.is_error === true, exit: /^Exit code (\d+)/.exec(text)?.[1] ?? null };
        const owner = pending.get(b.tool_use_id);
        if (owner) {
          pending.delete(b.tool_use_id);
          owner._raw.results.push(info);
          if (!owner.res.some((r) => r.off === row.off)) owner.res.push({ off: row.off, len: row.len, sha256: row.sha256 });
          if (info.err) owner.err = true;
        } else {
          if (!orphan) {
            needTurn(row);
            orphan = make('block', row, step ?? turn, { bk: 'tool', _raw: { tools: [], results: [], orphan: true } });
          }
          orphan._raw.results.push(info);
          if (info.err) orphan.err = true;
        }
      }
    }
    if (isOperatorPrompt(o)) {
      closeTurn();
      needTurn(row);
      turn._raw.promptLine = row.line;
      make('block', row, turn, { bk: 'text', uuid: typeof o.uuid === 'string' ? o.uuid : undefined, _raw: { prompt: row.line } });
      continue;
    }
    if (o.type === 'assistant' && Array.isArray(content)) {
      const texts = content.filter((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim()).map((b) => redactBlocks(b.text));
      const uses = content.filter((b) => b?.type === 'tool_use' && typeof b.id === 'string');
      if (!texts.length && !uses.length) continue;
      needTurn(row);
      const mid = typeof o.message?.id === 'string' ? o.message.id : null;
      if (!step || !mid || step._mid !== mid) {
        step = make('step', row, turn, { _mid: mid, _raw: { first: '', markers: [], tools: new Map() } });
      }
      for (const t of texts) {
        step._raw.first ||= firstSentence(t);
        for (const ln of t.split('\n')) if (MARKER.test(ln) && step._raw.markers.length < 3) step._raw.markers.push(cut(collapse(ln), HEAD_MAX));
      }
      const block = make('block', row, step, {
        bk: uses.length ? 'tool' : 'text',
        uuid: typeof o.uuid === 'string' ? o.uuid : undefined,
        res: uses.length ? [] : undefined,
        _raw: { head: cut(collapse(texts.join(' ')), 80), tools: uses.map((u) => toolTarget(String(u.name), u.input)), results: [] },
      });
      for (const u of uses) {
        pending.set(u.id, block);
        const name = String(u.name);
        step._raw.tools.set(name, (step._raw.tools.get(name) ?? 0) + 1);
        turn._raw.tools.set(name, (turn._raw.tools.get(name) ?? 0) + 1);
        const file = FILE_TOOLS.has(name) ? u.input?.file_path ?? u.input?.notebook_path : null;
        if (typeof file === 'string' && file) turn._raw.files.set(collapse(file), (turn._raw.files.get(collapse(file)) ?? 0) + 1);
      }
    }
  }

  // Raw label text for every created block and step, and the file names of created turns, in one mask run.
  const raw = new Map();
  const want = (text) => { const line = collapse(redactBlocks(text)); raw.set(line, null); return line; };
  for (const n of created) {
    if (n.kind === 'block') {
      const r = n._raw;
      if (r.prompt) n.label = `prompt line:${r.prompt}`;
      else if (r.orphan) n._label = want(cut(`result (unpaired) | ${r.results.map(resultStatus).join(', ')} | ${r.results.reduce((s, x) => s + x.bytes, 0)}B`, LABEL_MAX));
      else if (!r.tools.length) n._label = want(cut(`text: ${r.head}`, LABEL_MAX));
      else {
        const shown = r.tools.slice(0, 3).join('; ') + (r.tools.length > 3 ? ` +${r.tools.length - 3}` : '');
        const tail2 = r.results.length ? `${[...new Set(r.results.map(resultStatus))].join(', ')} | ${r.results.reduce((s, x) => s + x.bytes, 0)}B` : 'no result';
        n._label = want(cut(`${shown} | ${tail2}`, LABEL_MAX));
      }
      if (n.err && n._turn) n._turn._errors = (n._turn._errors ?? 0) + 1;
    } else if (n.kind === 'step') {
      const r = n._raw;
      const lead = r.first || `tools: ${histogram(topN(r.tools, 5))}`;
      n._label = want(cut([lead, ...r.markers].join(' | '), LABEL_MAX));
    } else if (n.kind === 'turn') {
      n._files = topN(n._raw.files, 5);
      for (const [file] of n._files) want(file);
    }
  }
  const strings = [...raw.keys()];
  const masked = maskLines(strings);
  strings.forEach((s, i) => raw.set(s, cut(masked[i], LABEL_MAX)));
  for (const n of created) {
    if (n._label !== undefined) n.label = raw.get(n._label);
    else if (n.kind === 'turn') {
      n.f = {
        tools: Object.fromEntries(topN(n._raw.tools, 8)),
        files: n._files.map(([file, count]) => [raw.get(file), count]),
        errors: n._errors ?? 0,
      };
      n.label = cut([
        n.f.tools && Object.keys(n.f.tools).length ? `tools ${histogram(Object.entries(n.f.tools))}` : 'no tools',
        n.f.files.length ? `files ${n.f.files.slice(0, 3).map(([file]) => cut(file.length > 40 ? `…${file.slice(-39)}` : file, 40)).join(', ')}` : '',
        n.f.errors ? `errors ${n.f.errors}` : '',
        n._raw.promptLine ? `prompt line:${n._raw.promptLine}` : 'continuation (no prompt)',
      ].filter(Boolean).join(' | '), LABEL_MAX);
    }
  }
  return { list, root, tail, partial };
}

// Epoch, session, and the resume point depend on the whole list, so they are computed last.
function finish(list, root) {
  const counts = { epoch: 0, turn: 0, step: 0, block: 0 };
  const turnsOf = new Map();
  for (const n of list) {
    counts[n.kind]++;
    if (n.kind === 'turn') (turnsOf.get(n.parent) ?? turnsOf.set(n.parent, []).get(n.parent)).push(n);
  }
  let k = 0;
  for (const n of list) {
    if (n.kind !== 'epoch') continue;
    k++;
    const turns = turnsOf.get(n.id) ?? [];
    const files = new Map();
    for (const t of turns) for (const [file, count] of t.f?.files ?? []) files.set(file, (files.get(file) ?? 0) + count);
    const top = topN(files, 3).map(([file]) => cut(file.length > 40 ? `…${file.slice(-39)}` : file, 40));
    n.label = cut(`epoch ${k}: ${turns.length} turn${turns.length === 1 ? '' : 's'}${top.length ? ` | top files ${top.join(', ')}` : ''}`, LABEL_MAX);
  }
  const boundaries = list.filter((n) => n.bnd).length;
  root.label = `session: ${counts.epoch} epochs, ${counts.turn} turns, ${counts.step} steps, ${counts.block} blocks, ${boundaries} compactions`;
  // Resume from the last turn, or the last epoch when it has none, and from the earliest node the
  // same row created, so the restart recreates every node that row made.
  let resumeAt = list.length - 1;
  while (resumeAt >= 0 && list[resumeAt].kind !== 'turn' && list[resumeAt].kind !== 'epoch') resumeAt--;
  while (resumeAt > 0 && list[resumeAt - 1].off === list[resumeAt].off) resumeAt--;
  return { boundaries, resumeAt, nodes: [root, ...list] };
}

const plain = (n) => {
  const out = {};
  for (const k of KEYS) if (n[k] !== undefined && !(k === 'res' && !n.res.length)) out[k] = n[k];
  return out;
};

function treeText(nodes) {
  return `{"version":${VERSION},"nodes":[\n${nodes.map((n) => JSON.stringify(plain(n))).join(',\n')}\n]}\n`;
}

// ---------------------------------------------------------------- index files

function loadIndex(ctx) {
  try {
    const meta = JSON.parse(readFileSync(join(ctx.dir, 'meta.json'), 'utf8'));
    const text = readFileSync(join(ctx.dir, 'tree.json'), 'utf8');
    if (meta.version !== VERSION || meta.transcript !== ctx.transcript || meta.treeSha256 !== sha256(text)) return null;
    const nodes = JSON.parse(text).nodes;
    const byId = new Map();
    const kids = new Map();
    const byOff = new Map();
    const byUuid = new Map();
    const push = (map, key, n) => (map.get(key) ?? map.set(key, []).get(key)).push(n);
    nodes.forEach((n, i) => {
      byId.set(n.id, n);
      if (n.parent) push(kids, n.parent, n);
      if (n.kind !== 'block') return;
      push(byOff, n.off, n);
      for (const r of n.res ?? []) push(byOff, r.off, n);
      if (n.uuid && !byUuid.has(n.uuid)) byUuid.set(n.uuid, n);
    });
    return { meta, nodes, byId, kids, byOff, byUuid };
  } catch { return null; }
}

function tailMatches(ctx, meta) {
  if (!meta.tailLen) return true;
  let fd;
  try {
    fd = openSync(ctx.transcript, 'r');
    const bytes = readAt(fd, meta.tailOff, meta.tailLen);
    return Boolean(bytes) && sha256(bytes) === meta.tailSha256;
  } catch { return false; } finally { if (fd !== undefined) closeSync(fd); }
}

// What the index needs: 'full', 'extend', or null. Only growth triggers work; a shrink or a
// same-size rewrite keeps the old index so zoom meets the changed bytes (`rebuildOnDrift` is `build`).
function needOf(ctx, idx, rebuildOnDrift) {
  if (!idx) return 'full';
  const size = statSync(ctx.transcript).size;
  const ok = tailMatches(ctx, idx.meta);
  if (size > idx.meta.indexedBytes + idx.meta.partial) return ok ? 'extend' : 'full';
  return rebuildOnDrift && (!ok || size < idx.meta.indexedBytes + idx.meta.partial) ? 'full' : null;
}

function writeIndex(ctx, idx) {
  const at = idx?.meta.resume;
  const buf = readFrom(ctx.transcript, at?.off ?? 0);
  const scanned = scan(buf, at?.off ?? 0, at?.line ?? 1, idx ? idx.nodes.slice(1, 1 + at.idx) : [], idx?.nodes[0] ?? null, ctx.sidechain);
  const indexedBytes = scanned.tail ? scanned.tail.off + scanned.tail.len + 1 : 0;
  if (idx && indexedBytes === idx.meta.indexedBytes && scanned.partial === idx.meta.partial) return false;
  const built = scanned.root ? finish(scanned.list, scanned.root) : { boundaries: 0, resumeAt: -1, nodes: [] };
  const resumeNode = built.resumeAt >= 0 ? built.nodes[1 + built.resumeAt] : null;
  const text = treeText(built.nodes);
  atomicWrite(join(ctx.dir, 'tree.json'), text);
  atomicWrite(join(ctx.dir, 'meta.json'), `${JSON.stringify({
    version: VERSION,
    transcript: ctx.transcript,
    indexedBytes,
    partial: scanned.partial,
    tailOff: scanned.tail?.off ?? 0,
    tailLen: scanned.tail?.len ?? 0,
    tailSha256: scanned.tail?.sha256 ?? '',
    boundaries: built.boundaries,
    nodeCount: built.nodes.length,
    treeSha256: sha256(text),
    resume: resumeNode?._line ? { idx: built.resumeAt, off: resumeNode.off, line: resumeNode._line } : { idx: 0, off: 0, line: 1 },
    builtAt: Date.now(),
  }, null, 1)}
`);
  return true;
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function lockStale(path) {
  try {
    const held = JSON.parse(readFileSync(path, 'utf8'));
    if (Date.now() - held.at > LOCK_STALE_MS) return true;
    try { process.kill(held.pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; }
  } catch {
    try { return Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS; } catch { return false; }
  }
}

function withLock(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'build.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (lockStale(path)) { try { unlinkSync(path); } catch { /* another process took it */ } continue; }
      if (Date.now() > deadline) throw new Fail('another recall build holds the lock');
      sleep(100);
    }
  }
  try { return fn(); } finally { try { unlinkSync(path); } catch { /* already gone */ } }
}

// Brings the index up to date. Returns the loaded index and what ran: full, incremental, or none.
function refresh(ctx, { rebuildOnDrift = false } = {}) {
  let idx = loadIndex(ctx);
  if (!needOf(ctx, idx, rebuildOnDrift)) return { idx, action: 'none' };
  return withLock(ctx.dir, () => {
    idx = loadIndex(ctx);
    const need = needOf(ctx, idx, rebuildOnDrift);
    if (!need) return { idx, action: 'none' };
    const wrote = writeIndex(ctx, need === 'extend' ? idx : null);
    return { idx: loadIndex(ctx), action: wrote ? (need === 'extend' ? 'incremental' : 'full') : 'none' };
  });
}

// ---------------------------------------------------------------- output helpers

function paginate(items, budget, page) {
  const pages = [[]];
  let used = 0;
  for (const item of items) {
    const size = byteLen(item) + 1;
    if (used + size > budget && pages.at(-1).length) { pages.push([]); used = 0; }
    pages.at(-1).push(item);
    used += size;
  }
  return { slice: pages[page] ?? [], pages: pages.length, total: items.length };
}

// Trims the named text fields until the item fits the budget on its own.
function shrink(item, fields, budget) {
  for (const f of fields) {
    const over = byteLen(item) - budget;
    if (over > 0 && typeof item[f] === 'string') item[f] = cut(item[f], Math.max(8, item[f].length - over - 1));
  }
  return item;
}

function pageText(text, budget, page) {
  const bytes = Buffer.from(text, 'utf8');
  const edge = (i) => { let at = Math.min(i, bytes.length); while (at < bytes.length && (bytes[at] & 0xc0) === 0x80) at++; return at; };
  return { text: bytes.subarray(edge(page * budget), edge((page + 1) * budget)).toString('utf8'), pages: Math.max(1, Math.ceil(bytes.length / budget)) };
}

// ---------------------------------------------------------------- commands

function resolveNode(ctx, idx, opts) {
  if (opts.line !== undefined) {
    let off = null;
    for (const rec of walkLines(readFileSync(ctx.transcript))) if (rec.line === opts.line) { off = rec.off; break; }
    const hit = off === null ? null : idx.byOff.get(off)?.[0];
    if (!hit) throw new Fail(`line:${opts.line} is not an indexed block`);
    return hit;
  }
  if (!opts.id) return idx.nodes[0];
  const lineRef = /^line:(\d+)$/.exec(opts.id);
  if (lineRef) return resolveNode(ctx, idx, { line: Number(lineRef[1]) });
  const node = idx.byId.get(opts.id) ?? idx.byUuid.get(opts.id);
  if (!node) throw new Fail('unknown node');
  return node;
}

function outlineItems(idx, node, depth) {
  const items = [];
  const walk = (parent, d) => {
    for (const child of idx.kids.get(parent.id) ?? []) {
      items.push({ id: child.id, kind: child.kind, label: child.label, depth: depth - d + 1 });
      if (d > 1) walk(child, d - 1);
    }
  };
  walk(node, depth);
  return items;
}

function cmdStatus(ctx, { idx, action }) {
  const size = statSync(ctx.transcript).size;
  const m = idx.meta;
  const current = size === m.indexedBytes + m.partial && tailMatches(ctx, m);
  return {
    command: 'status', action, current, ageSeconds: Math.max(0, Math.round((Date.now() - m.builtAt) / 1000)),
    indexedBytes: m.indexedBytes, fileSize: size, boundaries: m.boundaries, nodes: m.nodeCount, transcript: m.transcript,
  };
}

function cmdOutline(ctx, { idx }, opts) {
  const node = resolveNode(ctx, idx, opts);
  const { slice, pages, total } = paginate(outlineItems(idx, node, opts.depth).map((it) => shrink(it, ['label'], opts.budget - 2)), opts.budget, opts.page);
  return { command: 'outline', id: node.id, label: node.label, items: slice, total, page: opts.page, pages };
}

function verifyAnchor(fd, size, a) {
  if (a.off + a.len > size) throw new Drift();
  const bytes = readAt(fd, a.off, a.len);
  if (!bytes || sha256(bytes) !== a.sha256) throw new Drift();
  return bytes;
}

function cmdZoom(ctx, { idx }, opts) {
  const node = resolveNode(ctx, idx, opts);
  const fd = openSync(ctx.transcript, 'r');
  try {
    const size = statSync(ctx.transcript).size;
    const anchors = [node, ...(node.res ?? [])];
    const rows = anchors.map((a) => verifyAnchor(fd, size, a));
    if (node.kind !== 'block') return { ...cmdOutline(ctx, { idx }, { ...opts, id: node.id, depth: 1 }), command: 'zoom', verified: true };
    const parts = [];
    rows.forEach((bytes, i) => {
      const o = parseRow(bytes.toString('utf8').replace(/^﻿/, '').replace(/\r$/, ''));
      if (!o) throw new Fail('row unreadable');
      if (i > 0 && !o.message) return;
      for (const s of sectionsOf(o)) if (i === 0 || s.head.startsWith('tool_result')) parts.push(`[${s.head}]\n${s.body}`);
    });
    const masked = maskAll([parts.join('\n')])[0];
    const { text, pages } = pageText(masked, opts.budget, opts.page);
    return {
      command: 'zoom', id: node.id, label: node.label, verified: true,
      anchors: anchors.map((a) => ({ off: a.off, len: a.len, sha256: a.sha256, verified: true })),
      page: opts.page, pages, text,
    };
  } finally { closeSync(fd); }
}

// Exact identifiers (a SHA, a PR number, a path, an id, a test name) outweigh plain words.
const weightOf = (term) => (/^[0-9a-f]{7,64}$/.test(term) || /^#?\d+$/.test(term) || /[\\/]/.test(term) || /\.\w{1,5}$/.test(term)
  || (/\d/.test(term) && /[a-z]/.test(term) && term.length >= 6) || (/[_:-]/.test(term) && /[a-z]/.test(term) && term.length >= 6) ? 5 : 1);

function cmdSearch(ctx, { idx }, opts) {
  const terms = [...new Set(String(opts.terms ?? '').toLowerCase().split(/\s+/).filter(Boolean))];
  if (!terms.length) throw new UsageProblem('search needs --terms');
  const found = new Map();
  for (const rec of walkLines(readFileSync(ctx.transcript))) {
    const owners = idx.byOff.get(rec.off);
    if (!owners) continue;
    const o = parseRow(rec.text);
    if (!o) continue;
    const sections = sectionsOf(o).filter((s) => !opts.kind || s.kinds.includes(opts.kind));
    for (const s of sections) {
      const lower = s.body.toLowerCase();
      for (const term of terms) {
        let count = 0;
        let at = lower.indexOf(term);
        const first = at;
        while (at !== -1 && count < 64) { count++; at = lower.indexOf(term, at + term.length); }
        if (!count) continue;
        for (const node of owners) {
          const hit = found.get(node.id) ?? found.set(node.id, { node, score: 0, seen: new Map(), where: null }).get(node.id);
          hit.seen.set(term, (hit.seen.get(term) ?? 0) + count);
          if (!hit.where || weightOf(term) > hit.where.w) hit.where = { w: weightOf(term), body: s.body, pos: first, term };
        }
      }
    }
  }
  const ranked = [...found.values()].map((h) => ({ ...h, score: [...h.seen].reduce((s, [t, c]) => s + weightOf(t) * (1 + Math.floor(Math.log2(c))), 0) }))
    .sort((a, b) => b.score - a.score || a.node.off - b.node.off).slice(0, SEARCH_TOP);
  const windows = ranked.map((h) => {
    const { body, pos } = h.where;
    const from = Math.max(0, pos - MASK_WINDOW / 2);
    return body.slice(from, from + MASK_WINDOW);
  });
  let snippets;
  try { snippets = maskAll(windows); } catch { snippets = windows.map(() => null); }
  const results = ranked.map((h, i) => {
    let snippet = WITHHELD;
    if (snippets[i] !== null) {
      const text = snippets[i];
      const at = text.toLowerCase().indexOf(h.where.term);
      const from = Math.max(0, (at === -1 ? 0 : at) - SNIPPET_RADIUS);
      snippet = cut(collapse(text.slice(from, from + 2 * SNIPPET_RADIUS)), 2 * SNIPPET_RADIUS);
    }
    return shrink({ id: h.node.id, label: h.node.label, score: h.score, snippet }, ['snippet', 'label'], opts.budget - 2);
  });
  const { slice, pages, total } = paginate(results, opts.budget, opts.page);
  return { command: 'search', results: slice, total, page: opts.page, pages };
}

class UsageProblem extends Error {}

function render(out) {
  switch (out.command) {
    case 'status':
      return `index ${out.current ? 'current' : 'NOT current'} (${out.action}): ${out.indexedBytes} of ${out.fileSize} bytes indexed, ${out.nodes} nodes, ${out.boundaries} compactions, built ${out.ageSeconds}s ago`;
    case 'build':
      return `build ${out.action}: ${out.nodes} nodes, ${out.indexedBytes} bytes indexed`;
    case 'outline':
      return [`${out.id} ${out.label}`, ...out.items.map((it) => `${'  '.repeat(it.depth)}${it.id} ${it.label}`), `page ${out.page + 1}/${out.pages}, ${out.total} items`].join('\n');
    case 'search':
      return [...out.results.map((r) => `${r.id} score ${r.score} ${r.label}\n    ${r.snippet}`), `page ${out.page + 1}/${out.pages}, ${out.total} results`].join('\n');
    default:
      return out.items ? render({ ...out, command: 'outline' })
        : `${out.id} ${out.label} verified ${out.anchors.map((a) => a.sha256.slice(0, 12)).join(',')} page ${out.page + 1}/${out.pages}\n${out.text}`;
  }
}

function run(command, ctx, opts) {
  if (command === 'build') {
    const { idx, action } = refresh(ctx, { rebuildOnDrift: true });
    return { command, action, nodes: idx.meta.nodeCount, indexedBytes: idx.meta.indexedBytes };
  }
  const state = refresh(ctx);
  if (!state.idx) throw new Fail('index unreadable');
  return { status: cmdStatus, outline: cmdOutline, search: cmdSearch, zoom: cmdZoom }[command](ctx, state, opts);
}

function cli(argv) {
  const json = argv.includes('--json');
  if (!recallEnabled()) {
    const note = 'transcript recall is disabled (CODE_OPS_RECALL=off)';
    console.log(json ? JSON.stringify({ disabled: true, note }) : note);
    return 0;
  }
  const { flags, positional } = parseOrDie(argv, {
    session: { value: true }, agent: { value: true }, transcript: { value: true }, id: { value: true }, line: { value: true },
    terms: { value: true }, kind: { value: true }, depth: { value: true }, page: { value: true }, budget: { value: true }, json: { value: false },
  }, USAGE);
  const bad = (message) => usage([`x ${message}`, USAGE]);
  const [command, ...extra] = positional;
  if (!COMMANDS.includes(command) || extra.length) bad(`command must be one of ${COMMANDS.join(', ')}`);
  if (!flags.session) bad('--session is required');
  const int = (name, fallback, min, max = Infinity) => {
    if (flags[name] === undefined) return fallback;
    const n = Number(flags[name]);
    if (!Number.isInteger(n) || n < min || n > max) bad(`--${name} must be an integer from ${min}${max === Infinity ? ' up' : ` to ${max}`}`);
    return n;
  };
  if (flags.kind !== undefined && !KINDS.includes(flags.kind)) bad(`--kind must be one of ${KINDS.join(', ')}`);
  if (flags.id !== undefined && flags.line !== undefined) bad('--id and --line are exclusive');
  const opts = {
    id: flags.id, line: flags.line === undefined ? undefined : int('line', 0, 1), terms: flags.terms, kind: flags.kind,
    depth: int('depth', 1, 1, MAX_DEPTH), page: int('page', 0, 0), budget: int('budget', DEFAULT_BUDGET, MIN_BUDGET),
  };
  if (command === 'search' && !String(opts.terms ?? '').trim()) bad('search needs --terms');
  if (command === 'zoom' && opts.id === undefined && opts.line === undefined) bad('zoom needs --id or --line');
  const agent = flags.agent ?? null;
  if (agent !== null && !AGENT_RE.test(agent)) bad('--agent must be letters, digits, "_" or "-" (up to 64)');
  if (agent !== null && flags.transcript === undefined && !AGENT_RE.test(flags.session)) bad('--session must be a plain id with --agent');
  const cwd = process.cwd();
  const mainDir = defaultTranscriptDir(cwd);
  const transcript = resolve(flags.transcript ?? (agent
    ? join(mainDir, flags.session, 'subagents', `agent-${agent}.jsonl`)
    : join(mainDir, `${flags.session}.jsonl`)));
  const ctx = { session: flags.session, transcript, dir: indexDir(cwd, flags.session, undefined, agent), sidechain: agent !== null, json };
  const fail = (message) => {
    if (json) console.log(JSON.stringify({ error: message }));
    else console.error(`x ${message}`);
    return 1;
  };
  try {
    if (!statSync(transcript, { throwIfNoEntry: false })?.isFile()) return fail('transcript not found');
    const out = run(command, ctx, opts);
    console.log(json ? JSON.stringify(out) : render(out));
    return 0;
  } catch (e) {
    if (e instanceof Fail) return fail(e.message);
    if (e instanceof UsageProblem) return bad(e.message);
    return fail(`recall failed (${e.code ?? e.name})`);
  }
}

const isMain = () => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } };
if (isMain()) process.exitCode = cli(process.argv.slice(2));
