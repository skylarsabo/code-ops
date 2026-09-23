// @ts-check
// Shape detectors and compression stages behind scripts/digest.mjs — pure functions, no I/O,
// so the regression eval (evals/digest/run.mjs) can call them directly on a corpus file.
//
// WHY: the measured baseline (code-ops-docs/55 Operations/MEASUREMENTS.md) puts tool results at
// 77.6% of all context characters, with Bash second behind Read. Most of those bytes are shaped:
// a unified diff, a compiler's diagnostics, a test runner's roll-call, a stack trace, a file
// listing, a log stream. A detector per SHAPE covers the long tail that a filter per COMMAND
// never reaches, and anything unrecognized passes through under a cap.
//
// The contract is loss-bounded, not best-effort. `mustKeep(shape, raw, digested)` names the lines
// a digest of that shape may never drop: every line matching ERROR_RE, the final line, and a
// per-shape addition (failing tests, diff headers, one line per diagnostic file). digestText
// enforces the same set BY CONSTRUCTION — it computes the protected line numbers once, and every
// stage refuses to drop or rewrite a protected line. A stage called bare, outside digestText, has
// no such protection, which is how the eval proves the contract is able to fail.
//
// Line accounting is exact. Items carry their source line number, so every elision renders as
// `[elided N lines: sed -n 'A,Bp' <raw path>]` with real numbers, and every raw line ends up in
// exactly one of three sets: kept, folded (a duplicate collapsed into its representative), or
// inside one elision range. The eval checks that partition.

// ------------------------------------------------------------------ types

/**
 * @typedef {{ t: 'line', n: number, s: string }} LineItem
 * @typedef {{ t: 'note', s: string }} NoteItem
 * @typedef {{ t: 'elide', from: number, to: number, count: number }} ElideItem
 * @typedef {LineItem | NoteItem | ElideItem} Item
 * @typedef {{ cap?: number, head?: number, tail?: number, line?: number, cwd?: string, rawPath?: string | null,
 *   shape?: string, argv?: string[], offset?: number }} DigestOptions
 * @typedef {DigestOptions & { protect: Set<number>, folded: number[] }} StageContext
 * @typedef {(items: Item[], ctx: StageContext) => Item[]} Stage
 * @typedef {{ text: string, lines: string[], argv: string[], bias: string | null }} ShapeInput
 * @typedef {{ detect: (c: ShapeInput) => boolean, stages: string[], mustKeep: string[] }} Shape
 * @typedef {null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }} JsonValue
 */

// ------------------------------------------------------------------ constants

export const DEFAULTS = { cap: 200, head: 20, tail: 60, line: 400 };

// The must-keep trigger. A line matching this survives every stage, whatever the shape.
export const ERROR_RE = /\b(?:error|fail|failed|failure|exception|panic|fatal|traceback|cannot|not found|denied|refused)\b/i;

// Past this many matching lines the digest keeps the first N and STATES the total, rather than
// quietly keeping a prefix. Retention never becomes silent truncation.
export const ERROR_LINE_CAP = 200;

// CSI, OSC, and two-byte escapes. Progress bars and colored runners emit all three.
const ANSI_RE = /\u001B\[[0-9;?]*[ -/]*[@-~]|\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[@-Z\\-_]/g;

// A diagnostic names a FILE, so the first field must end in a dot extension. Without that
// anchor an ISO timestamp (`2026-09-02T10:00:00.101Z`) parses as `file:line:` and a log stream
// classifies as diagnostics.
const DIAG_RE = /^(\S*?[A-Za-z0-9_)\]]\.[A-Za-z][A-Za-z0-9]{0,7}):(\d+)(?::(\d+))?[: ]/;
const DIFF_HEAD_RE = /^(?:diff --git |index |--- |\+\+\+ |@@ |new file mode |deleted file mode |old mode |new mode |similarity index |rename from |rename to |Binary files )/;
const FRAME_RE = [
  /^\s+at\s+.*\((.+):\d+:\d+\)\s*$/,
  /^\s+at\s+(.+):\d+:\d+\s*$/,
  /^\s+File "(.+)", line \d+/,
];
const TEST_MARKERS = [
  /^\s*(?:PASS|FAIL)\s+\S/,
  /^\s*[✓✕✗×]\s/,
  /^Tests:\s/,
  /^\s*(?:ok|not ok) \d+/,
  /^test result:/,
  /^\s*--- (?:FAIL|PASS):/,
  /^ok\s+\S+\s+[\d.]+s\s*$/,
  /^#\s+(?:pass|fail)\s+\d+/,
  /\b(?:PASSED|FAILED)\b/,
  /\b\d+ passed\b/,
  /passed in [\d.]+s/,
];
const FAILING_TEST_RE = /^\s*(?:FAIL\s+\S|[✕✗×]\s|--- FAIL:|not ok \d+)|\bFAILED\b/;
const TEST_SUMMARY_RE = /^(?:Tests:|test result:|#\s+(?:pass|fail)\b)|\b\d+ (?:passed|failed)\b/;
const LOG_RE = /^(?:\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}|\[(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL)\]|(?:TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL):)/;
const LISTING_RE = /^\s*(?:[A-Z?!]{1,2}\s+)?\S+$/;
const PATH_LEAD_RE = /^\s*([A-Za-z0-9_.@+-]+(?:[\\/][A-Za-z0-9_.@+-]+)+)/;
// Every capture group this file reads is mandatory in its pattern, so a match always sets it and
// each `?? ''` on a group read never applies.

// ------------------------------------------------------------------ text helpers

/** @param {unknown} s */
export function stripAnsiText(s) {
  return String(s).replace(ANSI_RE, '');
}

// A progress line rewrites itself with carriage returns. Only the final segment ever reached a
// human eye, so only the final segment is worth a context slot.
/** @param {string} s */
export function lastCarriageSegment(s) {
  if (!s.includes('\r')) return s;
  const segs = s.split('\r');
  while (segs.length > 1 && segs[segs.length - 1] === '') segs.pop();
  return segs.at(-1) ?? ''; // split always returns at least one segment
}

/** @param {unknown} s */
export function normalizeText(s) {
  return lastCarriageSegment(stripAnsiText(s));
}

/** @param {unknown} text */
export function splitLines(text) {
  const t = String(text ?? '');
  if (t === '') return { lines: [], endsWithNewline: false };
  const endsWithNewline = t.endsWith('\n');
  const parts = t.split('\n');
  if (endsWithNewline) parts.pop();
  return { lines: parts, endsWithNewline };
}

// Raw text as the pipeline's line array: ANSI stripped, carriage-return progress collapsed.
/** @param {unknown} text */
export function normalizedLines(text) {
  return splitLines(text).lines.map(normalizeText);
}

/**
 * @param {string[]} lines
 * @param {number} [offset]
 * @returns {LineItem[]}
 */
export function itemsOf(lines, offset = 0) {
  return lines.map((s, i) => ({ t: 'line', n: offset + i + 1, s }));
}

/**
 * @param {Item[]} items
 * @param {string | null} [rawPath]
 */
export function renderItems(items, rawPath = null) {
  return items.map((it) => {
    if (it.t === 'line' || it.t === 'note') return it.s;
    return rawPath
      ? `[elided ${it.count} lines: sed -n '${it.from},${it.to}p' ${rawPath}]`
      : `[elided ${it.count} lines]`;
  });
}

// Rebuild an item list from a keep decision, coalescing every run of dropped lines (and any
// elision already standing in that run) into ONE elision spanning the whole source range. A note
// breaks a run, so ranges stay disjoint and ascending. `count` is the range width, which is also
// the number of source lines absent from the output inside it — a line folded away earlier sits
// inside the range and is likewise absent.
/**
 * @param {Item[]} items
 * @param {boolean[]} keep
 * @returns {Item[]}
 */
function rebuild(items, keep) {
  /** @type {Item[]} */
  const out = [];
  /** @type {{ from: number, to: number } | null} */
  let pend = null;
  /** @type {(from: number, to: number) => void} */
  const span = (from, to) => { pend = pend ? { from: Math.min(pend.from, from), to: Math.max(pend.to, to) } : { from, to }; };
  const flush = () => {
    if (!pend) return;
    out.push({ t: 'elide', from: pend.from, to: pend.to, count: pend.to - pend.from + 1 });
    pend = null;
  };
  for (const [i, it] of items.entries()) {
    if (it.t === 'elide') { span(it.from, it.to); continue; }
    if (it.t === 'line' && !keep[i]) { span(it.n, it.n); continue; }
    flush();
    out.push(it);
  }
  flush();
  return out;
}

// Folding removes a line WITHOUT an elision marker: its content survives in the representative
// line's `[x N]` count, so there is nothing to recover with sed. The number is recorded so the
// eval can still account for every source line.
/**
 * @param {Item[]} items
 * @param {boolean[]} keep
 * @param {StageContext} ctx
 */
function removeFolded(items, keep, ctx) {
  /** @type {Item[]} */
  const out = [];
  for (const [i, it] of items.entries()) {
    if (it.t === 'line' && !keep[i]) { ctx.folded.push(it.n); continue; }
    out.push(it);
  }
  return out;
}

/** @type {(ctx: StageContext, it: Item) => boolean} */
const guarded = (ctx, it) => it.t === 'line' && ctx.protect.has(it.n);

// ------------------------------------------------------------------ stages

/**
 * @param {Item[]} items
 * @returns {Item[]}
 */
export function stripAnsi(items) {
  return items.map((it) => (it.t === 'line' ? { ...it, s: normalizeText(it.s) } : it));
}

/** @type {Stage} */
export function foldDuplicates(items, ctx) {
  const keep = items.map(() => true);
  // Consecutive run of identical lines: the first carries the count, the rest fold away.
  for (let i = 0; i < items.length;) {
    const it = items[i];
    if (it?.t !== 'line') { i++; continue; }
    let j = i + 1;
    while (j < items.length) {
      const next = items[j];
      if (next?.t !== 'line' || next.s !== it.s) break;
      j++;
    }
    const run = j - i;
    if (run > 1 && !guarded(ctx, it)) {
      items[i] = { ...it, s: `${it.s} [x ${run}]` };
      for (let k = i + 1; k < j; k++) keep[k] = false;
    }
    i = j;
  }
  let dropped = 0;
  // Non-consecutive repeats: three occurrences establish the pattern; the rest are noise.
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const [i, it] of items.entries()) {
    if (it.t !== 'line' || !keep[i]) continue;
    const n = (seen.get(it.s) || 0) + 1;
    seen.set(it.s, n);
    if (n > 3 && !guarded(ctx, it)) { keep[i] = false; dropped++; }
  }
  const out = removeFolded(items, keep, ctx);
  if (dropped > 0) out.push({ t: 'note', s: `[repeated: ${dropped} lines dropped beyond 3 occurrences]` });
  return out;
}

/** @type {Stage} */
export function factorPrefix(items, ctx) {
  const hits = [];
  for (const [i, it] of items.entries()) {
    if (it.t !== 'line' || guarded(ctx, it)) continue;
    const m = PATH_LEAD_RE.exec(it.s);
    if (!m) continue;
    const segs = (m[1] ?? '').split(/[\\/]/);
    if (segs.length < 3) continue; // need >= 2 directory segments plus a leaf
    hits.push({ i, segs: segs.slice(0, -1) });
  }
  const [firstHit] = hits;
  if (hits.length < 5 || !firstHit) return items;
  let common = firstHit.segs;
  for (const h of hits) {
    let k = 0;
    while (k < common.length && k < h.segs.length && common[k] === h.segs[k]) k++;
    common = common.slice(0, k);
    if (common.length < 2) return items;
  }
  const prefix = `${common.join('/')}/`;
  const alt = `${common.join('\\')}\\`;
  const out = items.slice();
  let first = -1;
  for (const h of hits) {
    const it = out[h.i];
    if (it?.t !== 'line') continue; // every hit indexes a line item
    const cut = it.s.startsWith(prefix) ? prefix.length : (it.s.startsWith(alt) ? alt.length : -1);
    if (cut < 0) continue;
    out[h.i] = { ...it, s: it.s.slice(cut) };
    if (first < 0) first = h.i;
  }
  if (first < 0) return items;
  out.splice(first, 0, { t: 'note', s: `[prefix ${prefix}]` });
  return out;
}

/** @type {Stage} */
export function foldStack(items, ctx) {
  /** @type {(s: string) => string | null} */
  const frameOf = (s) => {
    for (const re of FRAME_RE) { const m = re.exec(s); if (m) return m[1] ?? ''; }
    return null;
  };
  const cwd = String(ctx.cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = [];
  for (const [i, it] of items.entries()) if (it.t === 'line' && frameOf(it.s) !== null) idx.push(i);
  if (idx.length < 4) return items;
  const keep = items.map(() => true);
  for (const [k, i] of idx.entries()) {
    if (k < 2 || k === idx.length - 1) continue;
    const it = items[i];
    if (it?.t !== 'line') continue; // idx holds only line-item indexes
    if (guarded(ctx, it)) continue;
    const p = String(frameOf(it.s)).replace(/\\/g, '/');
    if (cwd && p.startsWith(cwd)) continue; // an in-repo frame is the one a reader acts on
    keep[i] = false;
  }
  return rebuild(items, keep);
}

/** @type {Stage} */
export function groupDiagnostics(items, ctx) {
  /** @type {Map<string, number>} */
  const perFile = new Map();
  /** @type {Map<string, number>} */
  const perRule = new Map();
  /** @type {(s: string) => string | null} */
  const ruleOf = (s) => {
    const a = /\b([A-Z]{1,5}\d{2,5})\b/.exec(s);
    if (a) return a[1] ?? '';
    const b = /\(([a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*)\)\s*$/.exec(s);
    return b ? b[1] ?? '' : null;
  };
  const keep = items.map(() => true);
  let total = 0;
  for (const [i, it] of items.entries()) {
    if (it.t !== 'line') continue;
    const m = DIAG_RE.exec(it.s);
    if (!m) continue;
    total++;
    const file = m[1] ?? '';
    const n = (perFile.get(file) || 0) + 1;
    perFile.set(file, n);
    const rule = ruleOf(it.s);
    if (rule) perRule.set(rule, (perRule.get(rule) || 0) + 1);
    if (n > 5 && !guarded(ctx, it)) keep[i] = false;
  }
  if (total === 0) return items;
  const out = rebuild(items, keep);
  if (perRule.size >= 3) {
    const ranked = [...perRule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    out.push({ t: 'note', s: `[rules: ${ranked.map(([r, c]) => `${r} x ${c}`).join(', ')}]` });
  }
  out.push({ t: 'note', s: `[diagnostics: ${total} in ${perFile.size} ${perFile.size === 1 ? 'file' : 'files'}]` });
  return out;
}

/** @type {Stage} */
export function budgetDiff(items, ctx) {
  const kind = items.map((it) => {
    if (it.t !== 'line') return 'other';
    if (DIFF_HEAD_RE.test(it.s)) return 'head';
    return /^[+-]/.test(it.s) ? 'change' : 'ctx';
  });
  const keep = items.map((it, i) => it.t !== 'line' || kind[i] !== 'ctx');
  for (let i = 0; i < items.length; i++) {
    if (kind[i] !== 'change') continue;
    for (let d = 1; d <= 2; d++) {
      if (i - d >= 0 && kind[i - d] === 'ctx') keep[i - d] = true;
      if (i + d < items.length && kind[i + d] === 'ctx') keep[i + d] = true;
    }
  }
  // Per-file ceiling: past 120 kept lines one file has already told its story.
  let budget = 0;
  for (const [i, it] of items.entries()) {
    if (it.t !== 'line') continue;
    if (kind[i] === 'head' && /^diff --git /.test(it.s)) budget = 0;
    if (!keep[i]) continue;
    budget++;
    if (budget > 120 && !guarded(ctx, it) && kind[i] !== 'head') keep[i] = false;
  }
  for (const [i, it] of items.entries()) if (guarded(ctx, it)) keep[i] = true;
  return rebuild(items, keep);
}

/**
 * @param {JsonValue} v
 * @param {number} depth
 * @returns {string}
 */
function summarizeValue(v, depth) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'boolean' || t === 'number') return t;
  if (typeof v === 'string') return `string(${v.length})`;
  if (Array.isArray(v)) {
    // A parsed JSON array has no holes, so `first` is undefined only when the array is empty.
    const [first] = v;
    if (first === undefined || depth <= 0) return `array[${v.length}]`;
    return `array[${v.length}] of ${summarizeValue(first, depth - 1)}`;
  }
  if (typeof v !== 'object') return t; // unreachable: the checks above cover every other JSON type
  const entries = Object.entries(v);
  if (depth <= 0) return `object(${entries.length} keys)`;
  return `{ ${entries.slice(0, 12).map(([k, value]) => `${k}: ${summarizeValue(value, depth - 1)}`).join(', ')}${entries.length > 12 ? ', ...' : ''} }`;
}

/** @type {Stage} */
export function summarizeJson(items, ctx) {
  const lines = items.filter((it) => it.t === 'line');
  if (lines.length <= 60) return items;
  let parsed;
  try { parsed = JSON.parse(lines.map((it) => it.s).join('\n')); } catch { return items; }
  const bytes = lines.reduce((a, it) => a + it.s.length + 1, 0);
  /** @type {Item[]} */
  const notes = [{ t: 'note', s: `[json: ${bytes} bytes, ${lines.length} lines]` }];
  if (Array.isArray(parsed)) {
    notes.push({ t: 'note', s: `  root: array[${parsed.length}]` });
    if (parsed.length) notes.push({ t: 'note', s: `  [0]: ${summarizeValue(parsed[0], 2)}` });
  } else if (parsed && typeof parsed === 'object') {
    for (const k of Object.keys(parsed)) notes.push({ t: 'note', s: `  ${k}: ${summarizeValue(parsed[k], 2)}` });
  } else {
    notes.push({ t: 'note', s: `  root: ${summarizeValue(parsed, 2)}` });
  }
  const keep = items.map((it) => (it.t === 'line' ? guarded(ctx, it) : true));
  return [...notes, ...rebuild(items, keep)];
}

/** @type {Stage} */
export function truncateLines(items, ctx) {
  const max = Math.max(1, Number(ctx.line) || DEFAULTS.line);
  return items.map((it) => {
    if (it.t !== 'line' || it.s.length <= max) return it;
    return { ...it, s: `${it.s.slice(0, max)} …[+${it.s.length - max} chars]` };
  });
}

/** @type {Stage} */
export function capTail(items, ctx) {
  const cap = Math.max(1, Number(ctx.cap) || DEFAULTS.cap);
  if (items.length <= cap) return items;
  const head = Math.max(0, Number.isFinite(Number(ctx.head)) ? Number(ctx.head) : DEFAULTS.head);
  const tail = Math.max(0, Number.isFinite(Number(ctx.tail)) ? Number(ctx.tail) : DEFAULTS.tail);
  const keep = items.map((it, i) => i < head || i >= items.length - tail || guarded(ctx, it));
  return rebuild(items, keep);
}

/** @type {Record<string, Stage>} */
const STAGES = { stripAnsi, foldDuplicates, factorPrefix, foldStack, groupDiagnostics, budgetDiff, summarizeJson, truncateLines, capTail };

// The fixed application order. A shape selects a subset; the order never changes with the shape,
// so two shapes that enable the same stages produce the same pipeline.
export const STAGE_ORDER = ['stripAnsi', 'foldDuplicates', 'factorPrefix', 'foldStack', 'groupDiagnostics', 'budgetDiff', 'summarizeJson', 'truncateLines', 'capTail'];

// ------------------------------------------------------------------ shapes

/** @type {(lines: string[], re: RegExp) => number} */
const count = (lines, re) => lines.reduce((a, s) => a + (re.test(s) ? 1 : 0), 0);
/** @type {(lines: string[]) => string[]} */
const nonEmpty = (lines) => lines.filter((s) => s.trim() !== '');

/** @param {string[]} lines */
function looksTabular(lines) {
  // Lookahead, not a consuming match: `a  b  c` has three column boundaries, and a consuming
  // pattern would eat `b` and count two.
  const seps = lines.map((s) => (s.trim() === '' ? -1 : (s.match(/\S(?= {2,}\S)|\|/g) || []).length));
  let run = 1;
  for (const [i, sep] of seps.entries()) {
    if (i > 0 && sep >= 3 && sep === seps[i - 1]) { run++; if (run >= 3) return true; }
    else run = 1;
  }
  return false;
}

/** @type {Record<string, Shape>} */
export const SHAPES = {
  json: {
    detect: (c) => {
      const t = c.text.trim();
      if (!(t.startsWith('{') || t.startsWith('['))) return false;
      try { JSON.parse(t); return true; } catch { return false; }
    },
    stages: ['stripAnsi', 'summarizeJson', 'truncateLines', 'capTail'],
    mustKeep: [],
  },
  diff: {
    detect: (c) => count(c.lines, /^diff --git /) > 0
      || (count(c.lines, /^@@ /) > 0 && count(c.lines, /^--- /) > 0 && count(c.lines, /^\+\+\+ /) > 0),
    stages: ['stripAnsi', 'budgetDiff', 'truncateLines', 'capTail'],
    mustKeep: ['diffHeaders'],
  },
  test: {
    detect: (c) => c.lines.reduce((a, s) => a + (TEST_MARKERS.some((re) => re.test(s)) ? 1 : 0), 0) >= 2,
    stages: ['stripAnsi', 'foldDuplicates', 'factorPrefix', 'truncateLines', 'capTail'],
    mustKeep: ['testNames'],
  },
  diagnostics: {
    detect: (c) => count(c.lines, DIAG_RE) >= 3,
    stages: ['stripAnsi', 'foldDuplicates', 'factorPrefix', 'groupDiagnostics', 'truncateLines', 'capTail'],
    mustKeep: ['diagFiles'],
  },
  stack: {
    detect: (c) => c.lines.reduce((a, s) => a + (FRAME_RE.some((re) => re.test(s)) ? 1 : 0), 0) >= 2,
    stages: ['stripAnsi', 'foldDuplicates', 'foldStack', 'truncateLines', 'capTail'],
    mustKeep: [],
  },
  log: {
    detect: (c) => { const ne = nonEmpty(c.lines); return ne.length >= 4 && count(ne, LOG_RE) * 2 >= ne.length; },
    stages: ['stripAnsi', 'foldDuplicates', 'factorPrefix', 'truncateLines', 'capTail'],
    mustKeep: [],
  },
  table: {
    detect: (c) => looksTabular(c.lines),
    stages: ['stripAnsi', 'foldDuplicates', 'truncateLines', 'capTail'],
    mustKeep: [],
  },
  listing: {
    detect: (c) => { const ne = nonEmpty(c.lines); return ne.length >= 5 && count(ne, LISTING_RE) * 10 >= ne.length * 7; },
    stages: ['stripAnsi', 'foldDuplicates', 'factorPrefix', 'truncateLines', 'capTail'],
    mustKeep: [],
  },
  plain: {
    detect: () => true,
    stages: ['stripAnsi', 'foldDuplicates', 'factorPrefix', 'truncateLines', 'capTail'],
    mustKeep: [],
  },
};

export const SHAPE_ORDER = ['json', 'diff', 'test', 'diagnostics', 'stack', 'log', 'table', 'listing', 'plain'];

// The command the caller typed is weaker evidence than the bytes it produced, so it only decides
// the cases the detectors leave open.
/** @param {unknown[]} [argv] */
export function biasFromArgv(argv = []) {
  const a = argv.map((x) => String(x));
  // split always returns at least one segment, so the fallback never applies.
  /** @type {(i: number) => string} */
  const at = (i) => (a[i] || '').replace(/\\/g, '/').split('/').pop() ?? '';
  for (let i = 0; i < a.length; i++) {
    const w = at(i);
    if (w === 'git') {
      const sub = a[i + 1];
      if (sub === 'diff' || sub === 'show') return 'diff';
      if (sub === 'status' || sub === 'ls-files') return 'listing';
    }
    if (w === 'ls' || w === 'find' || w === 'tree') return 'listing';
    if (/^(jest|vitest|pytest|mocha|ava|tap|nyc)$/.test(w)) return 'test';
    if (w === 'cargo' && a[i + 1] === 'test') return 'test';
    if (w === 'go' && a[i + 1] === 'test') return 'test';
  }
  return null;
}

/**
 * @param {unknown} stdout
 * @param {unknown} [stderr]
 * @param {string[]} [argv]
 */
export function detectShape(stdout, stderr = '', argv = []) {
  const text = stderr && String(stderr).trim() ? `${stdout}\n${stderr}` : String(stdout ?? '');
  const lines = normalizedLines(text);
  const bias = biasFromArgv(argv);
  const c = { text: normalizeText(String(stdout ?? '')), lines, argv, bias };
  for (const name of SHAPE_ORDER) {
    if (name === 'plain') break;
    const shape = SHAPES[name];
    if (!shape) throw new Error(`SHAPE_ORDER names an unknown shape: ${name}`);
    if (shape.detect(c)) return name;
  }
  return bias || 'plain';
}

// ------------------------------------------------------------------ the must-keep contract

// The line numbers a digest of this shape may never drop, plus the raw match count so a digest
// past ERROR_LINE_CAP can state what it left behind instead of hiding it.
/**
 * @param {string} shape
 * @param {string[]} lines
 * @param {number} [offset]
 */
export function requiredLineNumbers(shape, lines, offset = 0) {
  /** @type {Set<number>} */
  const set = new Set();
  const spec = SHAPES[shape]?.mustKeep ?? [];
  let errorCount = 0;
  let kept = 0;
  for (const [i, line] of lines.entries()) {
    if (!ERROR_RE.test(line)) continue;
    errorCount++;
    if (kept < ERROR_LINE_CAP) { set.add(offset + i + 1); kept++; }
  }
  const last = lines.findLastIndex((line) => line.trim() !== '');
  if (last >= 0) set.add(offset + last + 1);
  if (spec.includes('diffHeaders')) {
    for (const [i, line] of lines.entries()) if (/^(?:diff --git |@@ )/.test(line)) set.add(offset + i + 1);
  }
  if (spec.includes('testNames')) {
    for (const [i, line] of lines.entries()) {
      if (FAILING_TEST_RE.test(line) || TEST_SUMMARY_RE.test(line)) set.add(offset + i + 1);
    }
  }
  return { set, errorCount };
}

// Does `digested` still carry everything a digest of this shape owes its reader? Comparison is
// verbatim on the ANSI-normalized raw line, allowing for line truncation (the first `line`
// characters) and for a fold count appended to the representative line.
/**
 * @param {string} shape
 * @param {unknown} raw
 * @param {unknown} digested
 * @param {{ line?: number }} [opts]
 */
export function mustKeep(shape, raw, digested, opts = {}) {
  const lineChars = Math.max(1, Number(opts.line) || DEFAULTS.line);
  const rawLines = Array.isArray(raw) ? raw.map(normalizeText) : normalizedLines(raw);
  const outLines = Array.isArray(digested) ? digested.map(String) : splitLines(digested).lines;
  const { set, errorCount } = requiredLineNumbers(shape, rawLines);
  /** @type {(text: string) => boolean} */
  const present = (text) => {
    const pre = text.slice(0, lineChars);
    return outLines.some((d) => d === text || (pre !== '' && d.startsWith(pre)));
  };
  /** @type {string[]} */
  const missing = [];
  for (const n of [...set].sort((a, b) => a - b)) {
    const text = rawLines[n - 1] ?? ''; // every number in set is a 1-based index into rawLines
    if (!present(text)) missing.push(`line ${n}: ${text.slice(0, 120)}`);
  }
  if (errorCount > ERROR_LINE_CAP && !outLines.some((d) => d === `[error lines: ${errorCount} matched, first ${ERROR_LINE_CAP} kept]`)) {
    missing.push(`the digest must state that ${errorCount} error lines matched`);
  }
  if ((SHAPES[shape]?.mustKeep ?? []).includes('diagFiles')) {
    /** @type {Set<string>} */
    const files = new Set();
    for (const s of rawLines) { const m = DIAG_RE.exec(s); if (m) files.add(m[1] ?? ''); }
    for (const f of files) {
      if (!outLines.some((d) => { const m = DIAG_RE.exec(d); return m !== null && (m[1] === f || f.endsWith(`/${m[1]}`) || f.endsWith(`\\${m[1]}`)); })) {
        missing.push(`no surviving diagnostic for ${f}`);
      }
    }
    if (files.size && !outLines.some((d) => /^\[diagnostics: \d+ in \d+ files?\]$/.test(d))) {
      missing.push('the digest must state the diagnostic totals');
    }
  }
  return { ok: missing.length === 0, missing };
}

// ------------------------------------------------------------------ the pipeline

// Compress one stream. `offset` shifts every reported line number, so a stderr digest written
// after stdout into one raw file still names real `sed -n 'A,Bp'` ranges in that file.
/**
 * @param {unknown} raw
 * @param {DigestOptions} [opts]
 */
export function digestText(raw, opts = {}) {
  /** @type {DigestOptions & typeof DEFAULTS & { cwd: string, rawPath: string | null, shape: string, argv: string[], offset: number }} */
  const o = { ...DEFAULTS, cwd: process.cwd(), rawPath: null, shape: 'auto', argv: [], offset: 0, ...opts };
  const { lines: srcLines, endsWithNewline } = splitLines(raw);
  const shape = o.shape && o.shape !== 'auto' ? o.shape : detectShape(raw, '', o.argv);
  // Own keys only: a name such as `toString` must not resolve through the prototype.
  const shapeDef = Object.hasOwn(SHAPES, shape) ? SHAPES[/** @type {keyof typeof SHAPES} */ (shape)] : undefined;
  if (!shapeDef) throw new Error(`unknown shape: ${shape}`);
  const bytesIn = String(raw ?? '').length;
  if (srcLines.length === 0) {
    return { shape, text: String(raw ?? ''), lines: [], linesIn: 0, linesOut: 0, bytesIn, bytesOut: bytesIn, kept: [], elisions: [], folded: [], errorCount: 0 };
  }
  let items = stripAnsi(itemsOf(srcLines, o.offset));
  // The same values stripAnsi just gave each line item.
  const normalized = srcLines.map(normalizeText);
  const { set, errorCount } = requiredLineNumbers(shape, normalized, o.offset);
  /** @type {StageContext} */
  const ctx = { ...o, shape, protect: set, folded: [] };
  if (errorCount > ERROR_LINE_CAP) items.push({ t: 'note', s: `[error lines: ${errorCount} matched, first ${ERROR_LINE_CAP} kept]` });
  const enabled = shapeDef.stages;
  for (const name of STAGE_ORDER) {
    if (name === 'stripAnsi' || !enabled.includes(name)) continue;
    const stage = STAGES[name];
    if (!stage) throw new Error(`STAGE_ORDER names an unknown stage: ${name}`);
    items = stage(items, ctx);
  }
  const outLines = renderItems(items, o.rawPath);
  const text = outLines.join('\n') + (endsWithNewline ? '\n' : '');
  return {
    shape,
    text,
    lines: outLines,
    linesIn: srcLines.length,
    linesOut: outLines.length,
    bytesIn,
    bytesOut: text.length,
    kept: items.filter((i) => i.t === 'line').map((i) => i.n),
    elisions: items.filter((i) => i.t === 'elide').map(({ from, to, count: c }) => ({ from, to, count: c })),
    folded: ctx.folded.slice().sort((a, b) => a - b),
    errorCount,
  };
}
