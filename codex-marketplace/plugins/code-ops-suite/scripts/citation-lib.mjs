// @ts-check
// Shared resolver for the `path:line · Anchor: <delimited text>` citation grammar
// (code-ops-docs/40 Engineering/Techniques/artifact-grammars.md, sections (b) and (c)).
//
// WHY: revalidate-register.mjs grew the only working reader of that grammar and exported
// nothing, so check-handoff.mjs validated a handoff's shape while its anchored pointers went
// unresolved. A handoff could name a line that had moved, drifted, or vanished and still pass.
// This module is the one place the grammar, its confinement rules, and its FRESH/MOVED/
// DRIFTED/GONE ranking live, so the two checkers cannot drift apart.
//
// Library only — no side effects on import, no argv reading at module scope. It is imported as
// `./citation-lib.mjs` so a vendored copy under plugins/<name>/scripts/ resolves the sibling
// copy rather than a repository-root path that does not ship.

import { readFileSync, existsSync, statSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, join, sep, basename } from 'node:path';

// file:line where the filename ends in a known code/doc extension — prevents matching version
// strings (v1.2.3:4), host:port (h.io:8080) and IP:port (1.1.1.1:53) as references. The
// directory part is matched segment-by-segment so the path quantifiers cannot overlap (no ReDoS).
// L-045: a segment unit is a path char, a bracketed route param ([id], [...slug], [[...opt]]), or a
// parenthesized route group ((auth)). Each unit starts on a distinct char and brackets close before
// the next unit, so the units cannot overlap either. A citation may start on a [ or ( unit only at a
// token start, optionally after a ../, ./ or / prefix that the SEC-004 restore below puts back; a
// [ or ( inside a path is never a fresh start, which keeps retries on a long path from multiplying.
// The [ or ( lookahead runs before the lookbehind, so the lookbehind scans back only at those two
// chars and a long / or ./ run adds no per-position backward scan.
// PAR-013: a citation may also start on a . that opens a dot-led segment (.github/x.yml:1), with the
// same token-start lookbehind. A . before . or / fails the \w lookahead, so traversal is unchanged.
export const REF_RE = /(?:\b|(?=\.\w)(?<=^|[^\w.\/[\])-])|(?=[[(])(?<=(?:^|[^\w.\/[\])-])(?:\.{0,2}\/)*))((?:(?:[\w.-]|\[\[?[\w.-]+\]\]?|\([\w.-]+\))+\/)*(?:[\w.-]|\[\[?[\w.-]+\]\]?|\([\w.-]+\))+\.(?:mjs|cjs|js|tsx?|jsx|json|md|markdown|txt|ya?ml|toml|sh|py|rb|go|rs|java|cpp|cc|css|html?)):(\d+)\b/gi;

export const VERIFIED_RE = /Verified-at:\s*([0-9a-f]{7,40}|HEAD)\b/i;

// An optional `Anchor:` — a verbatim substring of the cited line (CONVENTIONS §9/§E), delimited so
// it can carry spaces and punctuation. When present, the cited line must still contain it or the
// citation is DRIFTED. Four delimiter forms, doubled backticks first: CommonMark's own escape for a
// span that itself contains a backtick (`` Anchor: ``pad(`x`, 2)`` ``), then a single backtick, a
// double quote, and a single quote. The doubled form is tried first because the single-backtick
// alternative would otherwise read the opening pair as an empty span and lose the anchor. A
// backslash is NOT an escape here: anchors copy source lines verbatim, so unescaping would rewrite
// every existing anchor whose line carries a backslash.
export const ANCHOR_RE = /Anchor:\s*(?:``([^\n]+?)``|`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)')/i;

// The anchor text an ANCHOR_RE match carries, or null when there is no match. A doubled-backtick
// span drops one leading and one trailing space when it has both, exactly as CommonMark does, so
// the padding that keeps such a span unambiguous never becomes part of the compared substring.
/** @param {RegExpMatchArray | null | undefined} match */
export function anchorValue(match) {
  if (!match) return null;
  if (match[1] != null) {
    const raw = match[1];
    return raw.startsWith(' ') && raw.endsWith(' ') && raw.trim() !== '' ? raw.slice(1, -1) : raw;
  }
  return match[2] ?? match[3] ?? match[4] ?? null;
}

// L-045/R-011: R-011's sanitized calibration note reported the revalidator still reads a spaced
// document name as gone in prose (a vault with spaced folder names, e.g.
// `40 Engineering/Techniques/some-doc.md`), even though PR-140 already gave the backtick-delimited
// form a spaced reading. widenSpacedPath below extends that reading to ANY ordinary REF_RE match —
// unquoted prose, a Location field, a markdown link target, bold, or quotes.
//
// L-045 (fix): widening used to run only when REF_RE's own literal tail did not already exist,
// and it tried the shortest extension first. PR-140's backtick reading took the WHOLE backticked
// span ahead of any tail match, so `docs/My Folder/guide.md:3` never even looked at a same-named
// decoy at `Folder/guide.md`. The narrower, shortest-first widen regressed that: a short decoy that
// happens to exist made the literal tail "direct", skipped widening altogether, and read MOVED (or
// a wrong FRESH) against the decoy instead of the real, longer path the citation actually names.
// Widening now always runs first for a non-escaping match, and tries the LONGEST extension first —
// the literal text contains the whole scanned window, so the longest candidate that names a real
// in-root file is the most faithful reading. Only when no widened candidate resolves does the
// unwidened literal tail get its turn (the pre-widening behavior, now a fallback rather than a gate).
const WIDEN_ALLOWED_RE = /[\w.\-/ ]/; // backward-scan charset: word chars, ., -, /, and a single space
const WIDEN_SCAN_MAX = 256; // bounds the backward char scan per match (linear, not quadratic)
const WIDEN_MAX_WORDS = 8;  // bounds the existsSync attempts per match (nearest space positions kept)
// Extend a REF_RE match's path backward across space-separated prose words, trying the LONGEST
// extension first — L-045. Accepts a candidate only when it names a real in-root file and carries
// no raw `.` or `..` segment — the same fail-closed rule PR-140 used for the backtick spaced
// reading, so the PR-140 shadowing case (`../x.ts:1 q/../R/docs/My Folder/guide.md:3`, L-045 in
// evals/script-guards) still falls through to the unwidened literal path and reads AMBIGUOUS, not
// FRESH. A traversal-looking prefix (../, ./, or a bare /) at the scanned window's own start gets
// exactly one attempt — the whole window — so a shorter cut can never silently drop it and resolve
// only the text after it (FWD_PREFIX_RE below matches the same shape).
/**
 * @param {string} before
 * @param {string} root
 * @param {string} matchedPath
 * @returns {string | null}
 */
export function widenSpacedPath(before, root, matchedPath) {
  const window = before.length > WIDEN_SCAN_MAX ? before.slice(before.length - WIDEN_SCAN_MAX) : before;
  let start = window.length;
  while (start > 0 && WIDEN_ALLOWED_RE.test(window[start - 1])) start--;
  const raw = window.slice(start).replace(/^ +/, '');
  if (!raw) return null;
  /** @type {(prefix: string) => string | null} */
  const safeHit = (prefix) => {
    if (!prefix) return null;
    const candidate = prefix + matchedPath;
    if (candidate.split(/[\\/]/).some((seg) => seg === '.' || seg === '..')) return null;
    const abs = resolve(root, candidate);
    if (abs !== root && !abs.startsWith(root + sep)) return null;
    return existsSync(abs) && statSync(abs).isFile() ? candidate : null;
  };
  if (/^(?:\.{0,2}\/)/.test(raw)) {
    const hit = safeHit(raw);
    if (hit) return hit;
  } else {
    // L-045: collect at most WIDEN_MAX_WORDS space positions nearest the match, then try
    // candidates from the whole scanned window down to the nearest single word — the longest real
    // file wins, so a full `docs/My Folder/guide.md` beats a shorter decoy `Folder/guide.md` that
    // also happens to exist.
    const cuts = [];
    for (let i = raw.length - 1; i >= 0 && cuts.length < WIDEN_MAX_WORDS; i--) if (raw[i] === ' ') cuts.push(i);
    cuts.reverse(); // farthest (longest candidate) first, nearest (shortest) last
    for (const prefix of [raw, ...cuts.map((i) => raw.slice(i + 1))]) {
      const hit = safeHit(prefix);
      if (hit) return hit;
    }
  }
  // No safe in-root real file at any width. As PR-140 did for the backtick spaced reading, still
  // surface the full extension when it genuinely escapes root (not merely lexically collapsed back
  // in via a raw . or .. segment — the SH-01 shadowing trick) — the confinement check then flags it
  // AMBIGUOUS with its real extent instead of leaving an unwidened tail to read GONE or, worse,
  // FRESH against an unrelated decoy of the same short name.
  const full = raw + matchedPath;
  const fullAbs = resolve(root, full);
  return fullAbs !== root && !fullAbs.startsWith(root + sep) ? full : null;
}

// PAR-003 (fix): restore what REF_RE's leading boundary dropped before a match, so the
// confinement check downstream classifies every escaping form AMBIGUOUS, never FRESH — a
// forward-slash traversal (../, ./, /), one followed by a dot-led/dash-led segment (../.foo,
// ../-foo), a backslash-separated traversal (..\, .\, \), or a drive letter (C:\, C:/). Backslash
// and drive-letter forms are flagged directly (`escaping: true`) instead of folded into the
// restored path text: REF_RE's char class matches neither `\` nor `:`, so nothing survives for
// `resolve()` to reject, and `resolve()`'s own backslash handling is win32-only — a citation
// must classify the same on every host, not only on Windows. Both the backward scan and the
// FWD_PREFIX_RE match run against a PATH_SCAN_MAX-bounded tail window, never the full preceding
// block — a real traversal prefix is a handful of characters, but `before` can be the whole item
// block, and a `$`-anchored regex retried from every earlier start position over an unbounded
// string is its own quadratic trap (a prior fix already had to remove one for the same reason —
// see L-045 in evals/script-guards).
const PATH_SCAN_MAX = 4096;
const FWD_PREFIX_RE = /(?:\.{0,2}\/)+[.-]?$/;
/**
 * @param {string} before
 * @param {string} matched
 */
export function restoreCitationPrefix(before, matched) {
  const window = before.length > PATH_SCAN_MAX ? before.slice(before.length - PATH_SCAN_MAX) : before;
  let escaping = false;
  let i = window.length - 1;
  for (; i >= 0; i--) {
    const c = window[i];
    if (c === '\\' || (c === ':' && /[A-Za-z]/.test(window[i - 1] ?? ''))) { escaping = true; break; }
    if (!/[\w.\-\\/:]/.test(c)) break; // left the path-shaped run immediately before the match
  }
  // A path-shaped run longer than the window hides its start, so fail closed rather than FRESH.
  if (i < 0 && window.length < before.length) escaping = true;
  const fwd = window.match(FWD_PREFIX_RE);
  return { path: (fwd ? fwd[0] : '') + matched, escaping };
}

// Every citation in `text`, as { path, line, escaping } in document order. The prefix restore and
// the spaced-path widen both apply, so a caller sees the same path the register checker sees.
/** @typedef {{ path: string, line: number, escaping: boolean }} CitationRef */

/**
 * @param {string} text
 * @param {string} root
 * @returns {CitationRef[]}
 */
export function extractRefs(text, root) {
  const refs = [];
  for (const m of text.matchAll(REF_RE)) {
    // SEC-004/PAR-003 (fix): see restoreCitationPrefix — restores a dropped forward-slash
    // prefix and flags a backslash/drive-letter one directly, so the confinement check
    // classifies every escaping form AMBIGUOUS instead of FRESH.
    const restored = restoreCitationPrefix(text.slice(0, m.index), m[1]);
    let path = restored.path;
    // L-045/R-011: every non-escaping match gets a widen attempt (see widenSpacedPath)
    // BEFORE the unwidened literal tail is used — PR-140's backtick reading always preferred the
    // whole spaced span over the tail, and the widen must too, or a short decoy that happens to
    // exist at the literal tail wins over the real, longer path the citation names (L-045). An
    // already-escaping match is never widened, so a traversal ref keeps reading AMBIGUOUS.
    if (!restored.escaping) {
      const widened = widenSpacedPath(text.slice(0, m.index), root, m[1]);
      if (widened) path = widened;
      // else: keep the literal tail as restored above — resolved by resolveRef directly if it
      // exists, or by bare name (BUG-008) if not.
    }
    refs.push({ path, line: Number(m[2]), escaping: restored.escaping });
  }
  return refs;
}

/** @param {string} absPath */
export function lineCount(absPath) {
  try {
    const t = readFileSync(absPath, 'utf8');
    if (t.length === 0) return 0;
    const nl = (t.match(/\n/g) || []).length;
    return t.endsWith('\n') ? nl : nl + 1; // a trailing newline does not add a line
  } catch { return -1; }
}

// Read a single 1-indexed line's text (for the optional Anchor check); null if unreadable/out of range.
/**
 * @param {string} absPath
 * @param {number} lineNo
 */
export function readLineAt(absPath, lineNo) {
  try {
    const line = readFileSync(absPath, 'utf8').split('\n')[lineNo - 1];
    return line ?? null;
  } catch { return null; }
}

// SCR-014: explicit status precedence so a later MOVED cannot clobber an earlier AMBIGUOUS.
export const RANK = { FRESH: 0, MOVED: 1, DRIFTED: 2, AMBIGUOUS: 3, GONE: 4 };
/** @type {(cur: keyof typeof RANK, next: keyof typeof RANK) => keyof typeof RANK} */
export const escalate = (cur, next) => (RANK[next] > RANK[cur] ? next : cur);

// A resolver binds one repository root: its real path (root itself may be reached through a
// symlink — PAR-003) and the lazily built file index a bare-filename citation needs.
/** @param {string} root */
export function createResolver(root) {
  const abs = resolve(root);
  let rootReal = abs;
  try { rootReal = realpathSync(abs); } catch { /* root may not exist yet under report-only tooling */ }
  /** @type {string[] | null} */
  let fileIndex = null;
  // Walk the repo once (excluding .git/node_modules) so a bare-filename ref (cited without its
  // directory) can be resolved to its real location instead of being falsely reported GONE.
  const indexFiles = () => {
    if (fileIndex) return fileIndex;
    /** @type {string[]} */
    const files = [];
    fileIndex = files;
    /** @type {(dir: string, depth: number) => void} */
    const walk = (dir, depth) => {
      if (depth > 16) return;
      let entries;
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.isFile()) files.push(full);
      }
    };
    walk(abs, 0);
    return fileIndex;
  };
  // PAR-003 (fix): the literal-path confinement check only rules out an escaping path STRING — a
  // citation may still name a real in-root path that is itself a symlink or junction pointing
  // outside root, and a plain existsSync/statSync follows it silently. Resolve the real
  // filesystem path once links are followed and require it under root's own real path too.
  /** @type {(target: string) => boolean} */
  const realpathContained = (target) => {
    let real;
    try { real = realpathSync(target); } catch { return true; } // unreadable — the caller's existsSync gates it
    return real === rootReal || real.startsWith(rootReal + sep);
  };
  /** @type {(refPath: string) => string[]} */
  const findByName = (refPath) => {
    const norm = refPath.replace(/\\/g, '/').replace(/^\.?\//, '');
    const idx = indexFiles().map((f) => ({ full: f, slash: f.replace(/\\/g, '/') }));
    const bySuffix = idx.filter((f) => f.slash.endsWith('/' + norm)).map((f) => f.full);
    if (bySuffix.length) return bySuffix;
    const base = basename(norm);
    return idx.filter((f) => basename(f.slash) === base).map((f) => f.full);
  };
  return { root: abs, rootReal, indexFiles, realpathContained, findByName };
}

// Classify one citation against the tree: { status, note, target }. `target` is the resolved file
// whose cited line an anchor can be compared against, and is null for every non-FRESH status.
/**
 * @param {ReturnType<typeof createResolver>} resolver
 * @param {CitationRef} ref
 */
export function resolveRef(resolver, ref) {
  const { root } = resolver;
  if (ref.escaping) return { status: 'AMBIGUOUS', note: `${ref.path} escapes root — not checked`, target: null };
  const abs = resolve(root, ref.path);
  // SEC-004: refuse to stat paths escaping root.
  if (abs !== root && !abs.startsWith(root + sep)) return { status: 'AMBIGUOUS', note: `${ref.path} escapes root — not checked`, target: null };
  if (existsSync(abs) && statSync(abs).isFile()) {
    if (!resolver.realpathContained(abs)) // PAR-003: an in-root symlink/junction may target outside root
      return { status: 'AMBIGUOUS', note: `${ref.path} resolves outside root via symlink — not checked`, target: null };
    const lc = lineCount(abs);
    if (lc >= 0 && ref.line > lc) return { status: 'MOVED', note: `${ref.path}:${ref.line} > ${lc} lines`, target: null };
    return { status: 'FRESH', note: null, target: abs };
  }
  // BUG-008: literal path missing — resolve by name before declaring GONE.
  const found = resolver.findByName(ref.path);
  if (found.length === 1) {
    const lc = lineCount(found[0]);
    if (lc >= 0 && ref.line > lc) return { status: 'MOVED', note: `${ref.path} (as ${found[0].slice(root.length + 1)}):${ref.line} > ${lc} lines`, target: null };
    return { status: 'FRESH', note: null, target: found[0] };
  }
  if (found.length > 1) return { status: 'AMBIGUOUS', note: `${ref.path}: ${found.length} files match by name — verify by hand`, target: null };
  return { status: 'GONE', note: `${ref.path} missing`, target: null };
}
