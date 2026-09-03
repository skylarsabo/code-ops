#!/usr/bin/env node
// Atlas checker for the code-ops suite — the per-repo knowledge cache with mechanical
// staleness (code-ops-docs/40 Engineering/Techniques/atlas.md). Runs INSIDE a target repo, never against this one.
//
//   node scripts/atlas-check.mjs init  --atlas <dir>
//   node scripts/atlas-check.mjs add   --atlas <dir> --section <slug> --scope <pathspec> [--scope <pathspec> ...]
//   node scripts/atlas-check.mjs check --atlas <dir> [--root <repo>] [--gate] [--claims-gate] [--stats]
//   node scripts/atlas-check.mjs stamp --atlas <dir> --section <slug> [--root <dir>] [--at <sha>]
//   node scripts/atlas-check.mjs scope <slug> --atlas <dir> --suggest [--root <dir>]
//   node scripts/atlas-check.mjs inbox --atlas <dir> --note <text> [--root <dir>]
//
// WHY: a written-down understanding of a repo is only worth reading if you can tell,
// mechanically, whether it still describes the code. A default stamp binds each section to
// both a diagnostic commit and a versioned digest of its exact scopes, staged index, and
// index-to-worktree state. The digest survives squash merges because it describes content,
// not branch topology. FRESH sections are consumed as truth without re-verification; STALE
// ones are leads, not facts. The staleness signal is deliberately fail-SAFE, while the
// manifest schema is fail-CLOSED (a malformed manifest exits 1 even without --gate — a
// manifest that cannot be parsed vacates every freshness claim in it).
//
// MANIFEST.json (the ONLY place stamps and scopes live; hands never edit it — `add` and
// `stamp` do):
//   { "version": 1,
//     "sections": [ { "slug": "<kebab>", "file": "sections/<slug>.md",
//                     "scope": ["<git pathspec>", ...], "verifiedAt": "<sha>",
//                     "verifiedDigest": "<optional sha256>",
//                     "claims": [ { "file": "<repo-relative>", "line": <n>,
//                                   "anchor": "<optional verbatim substring>" } ] } ] }
//
// CLAIMS: the digest answers "did anything in scope move", which is a whole-section verdict. A
// claim answers the finer question the reader actually has — "is THIS sentence still true" — so a
// section whose scope moved keeps the claims that did not. A claim is a `path:line` citation in
// the section's own prose; `stamp` records one per citation with an anchor copied verbatim from
// the cited line, and `check` classifies them through revalidate-register.mjs, the register
// classifier, rather than a second one of its own. Two freshness mechanisms become one.
// The digest verdict is unchanged by any of this: the claim report is printed beneath it, and
// only the opt-in `--claims-gate` turns a non-FRESH claim into exit 1.
//
// `verifiedAt` is lowercase hex, 7-40 chars, or the single placeholder 'unverified' that `add`
// writes for a section nobody has stamped yet. Anything else — HEAD, @, a branch, a tag — is a
// schema violation, because a moving ref re-points the pin at whatever it names later and the
// section can then never go stale: the diff is always taken against the present. Shape is not
// sufficient, though: a branch or tag NAMED like a sha ('deadbeef') passes it, and rev-parse
// prefers refs over abbreviated object names, so the pin would still move. Every value claimed
// to be a pin is therefore also checked at RESOLUTION time — the full sha must extend the given
// value (see resolvePin) — and a hex-named ref fails closed the same way HEAD does.
//
// Scope matching is git's own pathspec semantics, not a reimplemented globber. Digest-backed
// sections are FRESH only when the framed raw index and worktree state matches exactly; a
// default stamp therefore requires scoped work to be staged. Legacy sections without a digest
// use `git diff --name-only <verifiedAt> -- <scope...>`. Coverage uses `git ls-files`.
// `check` adds one internal
// pathspec of its own — `:(exclude)<atlas dir>` — so the atlas cannot invalidate itself; see
// the note on it in cmdCheck.
//
// A scope that matches no tracked file at all is a DEAD scope (a typo, or a tree that moved),
// reported STALE: it silently reports FRESH forever otherwise, since nothing can ever change
// inside a scope that covers nothing. It is a per-section trust failure, not a malformed
// manifest, so it is fail-safe STALE rather than fail-closed.
//
// Coverage sweep (the atlas's own tree excluded from both sides): every first path segment of
// `git ls-files` that no section's scope actually
// MATCHES A TRACKED FILE UNDER is reported "unmapped" — advisory only, even under --gate,
// because an unmapped path is a scoping todo, not a trust violation.
//
// Exit: 0 clean (check without --gate or --claims-gate is always 0 unless the manifest is
//         malformed);
//       1 violation-or-gated (malformed manifest, refused write, unknown slug/sha, a scope
//         suggestion with no symbol index, --gate with at least one STALE section, or
//         --claims-gate with at least one claim the register classifier did not call FRESH);
//       2 usage error (unknown subcommand, unknown flag, missing/blank flag value).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, appendFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A stamp is an immutable object name, never a ref. See the moving-ref note in the header.
const SHA_RE = /^[0-9a-f]{7,40}$/;
const UNVERIFIED = 'unverified';
const MAX_LISTED_PATHS = 10;
const INBOX_HEADER = '# Atlas inbox\n\n'
  + 'Append-only dated observations. Fold them into their sections, then clear the folded lines.\n\n';

// ---- claims ---------------------------------------------------------------
// The citation grammar is the register's own (revalidate-register.mjs REF_RE): a path whose last
// segment carries a known code or documentation extension, a colon, then a line number. A range
// citation (`file.mjs:10-20`) claims its first line, exactly as a register reads one. A path
// containing a space is outside the grammar in both tools and is therefore not a claim.
const CLAIM_REF_RE = /\b((?:[\w.-]+\/)*[\w.-]+\.(?:mjs|cjs|js|tsx?|jsx|json|md|markdown|txt|ya?ml|toml|sh|py|rb|go|rs|java|cpp|cc|css|html?)):(\d+)\b/gi;
const MAX_ANCHOR = 80;
// The register's sentinel for an anchor that may not be written down. It downgrades that item to a
// line-existence check instead of forcing a secret substring into the manifest.
const REDACTED_ANCHOR = '<REDACTED-LINE>';
// Deliberately broad, and fail-safe in the only direction that matters: a false positive costs one
// claim its DRIFTED check, while a false negative would copy a credential into a tracked file.
const SECRET_LINE_RE = /(?:api[_-]?key|secret|passw(?:or)?d|token|credential|private[_-]?key)\s*[:=]\s*\S|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
// One item per claim, in the grammar revalidate-register.mjs parses. The status line it prints per
// item is `  ok FRESH     ATL-001  — <notes>`; the two flags and the em dash are its own format.
const CLAIM_STATUS_RE = /^\s+(?:ok|!!)\s+([A-Z-]+)\s+(ATL-\d{3,})\s*(?:—\s*(.*))?$/;
const CLAIM_FRESH = 'FRESH';

function usage() {
  console.error('usage: atlas-check.mjs init  --atlas <dir>');
  console.error('       atlas-check.mjs add   --atlas <dir> --section <slug> --scope <pathspec> [--scope <pathspec> ...]');
  console.error('       atlas-check.mjs check --atlas <dir> [--root <repo>] [--gate] [--claims-gate] [--stats]');
  console.error('       atlas-check.mjs stamp --atlas <dir> --section <slug> [--root <dir>] [--at <sha>]');
  console.error('       atlas-check.mjs scope <slug> --atlas <dir> --suggest [--root <dir>]');
  console.error('       atlas-check.mjs inbox --atlas <dir> --note <text> [--root <dir>]');
  process.exit(2);
}

// Flags whose value is free text an author chose, not a path or a slug, and may therefore
// legitimately begin with a flag-shaped token ("--gate is load-bearing here"). The blank and
// missing-value checks still apply, as do the subcommand's own content rules.
const FREE_TEXT_FLAGS = new Set(['--note']);

// Shared flag parser (dispatch-ledger.mjs house form): --flag value pairs, rejecting a
// missing/blank value or one that looks like another flag, so a typo'd flag cannot swallow
// the next one and be misread as a path. Flags named in `repeatable` collect into an array
// instead; every other flag stays single-valued, last-wins.
function parseFlags(args, known, repeatable = new Set()) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!known.has(a)) { console.error(`x unknown argument: ${a}`); usage(); }
    const v = args[++i];
    if (v === undefined || v.trim() === '' || (v.startsWith('--') && !FREE_TEXT_FLAGS.has(a))) {
      console.error(`x ${a} needs a value`); process.exit(2);
    }
    if (repeatable.has(a)) (out[a] ??= []).push(v);
    else out[a] = v;
  }
  return out;
}

// Every git call is explicit about cwd and bounded by a timeout — a hung git must not hang a
// gate. Never throws: callers decide whether a failure is fail-safe (STALE) or fail-closed.
let gitCallCount = 0;
function git(args, cwd) {
  gitCallCount++;
  try {
    const out = execFileSync('git', args, {
      cwd, encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out, err: '' };
  } catch (e) {
    return { ok: false, out: e.stdout ? String(e.stdout) : '', err: (e.stderr ? String(e.stderr) : '') || e.message };
  }
}
function gitBuffer(args, cwd) {
  gitCallCount++;
  try { return { ok: true, out: execFileSync('git', args, { cwd, encoding: 'buffer', timeout: 20000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch { return { ok: false, out: null }; }
}

const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '');

// Resolve a rev to a full commit sha, or null. `^{commit}` so a tag or tree-ish that is not a
// commit is rejected rather than silently stamped.
function resolveCommit(root, rev) {
  const r = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], root);
  const sha = r.ok ? r.out.trim() : '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}
function indexedPaths(output) {
  const paths = [];
  for (const entry of output.toString('utf8').split('\0')) {
    if (!entry) continue;
    const tab = entry.indexOf('\t');
    if (tab < 0 || tab === entry.length - 1) return null;
    paths.push(entry.slice(tab + 1));
  }
  return paths;
}
function scopeDigest(root, scope, excludeAtlas) {
  const index = gitBuffer(['ls-files', '-s', '-z', '--', ...scope, ...excludeAtlas], root);
  const dirty = gitBuffer(['diff', '--ignore-submodules=none', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-renames', '--', ...scope, ...excludeAtlas], root);
  const unmerged = gitBuffer(['ls-files', '-u', '-z', '--', ...scope, ...excludeAtlas], root);
  const flags = gitBuffer(['ls-files', '-v', '-z', '--', ...scope, ...excludeAtlas], root);
  if (!index.ok || !dirty.ok || !unmerged.ok || !flags.ok || unmerged.out.length) return null;
  for (const entry of flags.out.toString('utf8').split('\0')) if (entry && (/^[a-z]/.test(entry) || /^[SM]/.test(entry))) return null;
  const paths = indexedPaths(index.out);
  if (paths === null) return null;
  const frame = (value) => Buffer.concat([Buffer.from(String(value.length)), Buffer.from([0]), value]);
  const scopeBytes = Buffer.from(scope.join('\0'));
  return {
    digest: createHash('sha256').update(Buffer.from('atlas-scope-digest-v2\0')).update(frame(scopeBytes)).update(frame(index.out)).update(frame(dirty.out)).digest('hex'),
    paths,
  };
}

// Resolve a value that CLAIMS to be a sha pin — a manifest `verifiedAt`, or `stamp --at <sha>`.
// Returns { sha, movingRef }.
//
// WHY this is not just resolveCommit: the shape rule (SHA_RE) only proves a value LOOKS like an
// object name. `git branch deadbeef` creates a ref whose NAME passes that rule, and rev-parse
// prefers refs over abbreviated object names, so it resolves as the branch — a moving pin
// wearing hex, and the section reads FRESH forever. The distinguishing fact is cheap: the full
// sha an abbreviation resolves to always EXTENDS it, while a ref's tip does not (and if it
// coincidentally does, the value was a genuine object match anyway). The guard is deliberately
// scoped to values claimed to be pins: HEAD in check's header and stamp's default HEAD are
// legitimately symbolic, and `unverified` is not SHA_RE-shaped, so all three pass through
// untouched.
function resolvePin(root, value) {
  const full = resolveCommit(root, value);
  if (full && SHA_RE.test(value) && !full.startsWith(value.toLowerCase()))
    return { sha: null, movingRef: true };
  return { sha: full, movingRef: false };
}

// The one sentence both the check and the stamp path use for a hex-named ref, so an author who
// hits it in either place learns the same rule.
const MOVING_PIN_REASON = (value) =>
  `${JSON.stringify(value)} looks like an object name but resolves to a REF (a branch or tag NAMED like a sha) — `
  + 'git rev-parse prefers refs over abbreviated object names, so the pin would move with the ref and the '
  + 'section could never be reported stale. Rename or delete that ref, or pin the full object name.';

function atlasDirOf(flags) {
  const dir = resolve(flags['--atlas']);
  return dir;
}

// The repo the scopes are relative to: --root if given, else the git toplevel containing the
// atlas dir (the normal case — code-ops-docs/98 System/Atlas lives inside the repo it describes), else cwd.
function repoRootOf(atlasDir, explicit) {
  if (explicit) return resolve(explicit);
  if (existsSync(atlasDir)) {
    const r = git(['rev-parse', '--show-toplevel'], atlasDir);
    if (r.ok && r.out.trim()) return resolve(r.out.trim());
  }
  return resolve('.');
}
function atlasExclusion(root, atlasDir) {
  const canon = (path) => { try { return realpathSync.native(path); } catch { return path; } };
  const atlasRel = relative(canon(root), canon(atlasDir)).split(sep).join('/');
  return { atlasRel, exclude: (atlasRel === '' || atlasRel === '..' || atlasRel.startsWith('../') || isAbsolute(atlasRel)) ? [] : [`:(exclude)${atlasRel}`] };
}

// ---------------------------------------------------------------- claims

const here = dirname(fileURLToPath(import.meta.url));
const readLineAt = (abs, lineNo) => {
  try { return readFileSync(abs, 'utf8').split('\n')[lineNo - 1] ?? null; } catch { return null; }
};

// The anchor a stamp records for one claim: a verbatim substring of the cited line, trimmed,
// backtick-free, and at most 80 characters. Every step keeps the result a contiguous substring of
// the line, so the register's DRIFTED test stays a plain `includes`. Backticks are excluded
// because the register delimits an anchor with them. Returns null when the line yields nothing.
function anchorFor(lineText) {
  if (lineText === null) return null;
  const raw = lineText.replace(/\r$/, '');
  if (SECRET_LINE_RE.test(raw)) return REDACTED_ANCHOR;
  let text = raw.trim();
  if (text.includes('`')) text = text.split('`').map((part) => part.trim()).sort((a, b) => b.length - a.length)[0] ?? '';
  text = text.slice(0, MAX_ANCHOR).trimEnd();
  return text === '' ? null : text;
}

// Every citation in a section's prose, in document order, deduplicated by `file:line`. A citation
// that escapes the repo root is dropped: it is not a claim ABOUT this repo, and resolving it would
// read a path outside the tree the atlas is stamped against.
function claimsFor(root, atlasDir, section) {
  let prose;
  try { prose = readFileSync(resolve(atlasDir, section.file), 'utf8'); } catch { return null; }
  const out = [];
  const seen = new Set();
  for (const m of prose.matchAll(CLAIM_REF_RE)) {
    const file = m[1].replace(/\\/g, '/');
    const line = Number(m[2]);
    const key = `${file}:${line}`;
    if (!Number.isSafeInteger(line) || line < 1 || seen.has(key)) continue;
    seen.add(key);
    const abs = resolve(root, file);
    if (abs !== root && !abs.startsWith(root + sep)) continue;
    const claim = { file, line };
    const anchor = anchorFor(readLineAt(abs, line));
    if (anchor !== null) claim.anchor = anchor;
    out.push(claim);
  }
  return out;
}

function renderClaimRegister(items) {
  const lines = ['# Atlas claims', '',
    'Generated by atlas-check.mjs for one `check` run and deleted when it ends. Never commit it.', ''];
  for (const item of items) {
    lines.push(`### ${item.id}`);
    lines.push(`File: \`${item.claim.file}:${item.claim.line}\``);
    if (item.claim.anchor !== undefined) lines.push(`Anchor: \`${item.claim.anchor}\``);
    lines.push(`Verified-at: ${item.verifiedAt}`);
    lines.push('');
  }
  return lines.join('\n');
}

// Classify every section's claims through the register classifier, in one child process over one
// temporary register. Reusing revalidate-register.mjs is the point: the atlas and a findings
// register cannot then disagree about what a drifted citation is. Returns a status per item id;
// an item the classifier did not report stays 'unchecked', which is not FRESH and therefore gates.
function classifyClaims(root, sections) {
  const items = [];
  for (const s of sections)
    for (const claim of s.claims ?? [])
      items.push({ id: `ATL-${String(items.length + 1).padStart(3, '0')}`, slug: s.slug, claim, verifiedAt: String(s.verifiedAt).slice(0, 7) });
  if (items.length === 0) return { items, statuses: new Map(), error: null };
  const script = join(here, 'revalidate-register.mjs');
  if (!existsSync(script)) return { items, statuses: new Map(), error: `revalidate-register.mjs is not beside ${here}` };
  let dir = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'atlas-claims-'));
    const registerPath = join(dir, 'ATLAS_CLAIMS.md');
    writeFileSync(registerPath, renderClaimRegister(items));
    let out;
    try {
      out = execFileSync(process.execPath, [script, registerPath, '--root', root, '--report-only'],
        { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      // --report-only exits 0 on findings, so a non-zero exit is the classifier itself failing.
      return { items, statuses: new Map(), error: (e.stderr ? String(e.stderr) : e.message).trim().split('\n')[0] };
    }
    const statuses = new Map();
    for (const line of lines(out)) {
      const m = CLAIM_STATUS_RE.exec(line);
      if (!m) continue;
      // The classifier's `Verified-at != HEAD` line is an advisory about the SECTION's pin, which
      // the section verdict above already reports. Drop it so the claim detail carries only what
      // is specific to the claim.
      const note = (m[3] ?? '').split('; ').filter((n) => !/^Verified-at \S+ != HEAD /.test(n)).join('; ');
      statuses.set(m[2], { status: m[1], note });
    }
    return { items, statuses, error: null };
  } catch (e) {
    return { items, statuses: new Map(), error: e.message };
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* scratch dir */ } }
  }
}

// ---------------------------------------------------------------- manifest

// Loads and schema-validates MANIFEST.json. Returns { manifest, violations } — violations is a
// list of human-readable schema failures; a non-empty list is always fatal for the caller
// (fail closed), never a downgraded advisory.
function loadManifest(atlasDir) {
  const path = join(atlasDir, 'MANIFEST.json');
  const violations = [];
  if (!existsSync(path)) return { path, manifest: null, violations: [`no MANIFEST.json at ${path} — run \`atlas-check init --atlas ${atlasDir}\` first`] };
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { return { path, manifest: null, violations: [`cannot read ${path}: ${e.message}`] }; }
  let manifest;
  try { manifest = JSON.parse(raw); }
  catch (e) { return { path, manifest: null, violations: [`MANIFEST.json is not valid JSON: ${e.message}`] }; }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest))
    return { path, manifest: null, violations: ['MANIFEST.json must be a JSON object'] };
  if (manifest.version !== 1) violations.push(`version must be 1 (got ${JSON.stringify(manifest.version)})`);
  if (!Array.isArray(manifest.sections)) {
    violations.push('sections must be an array');
    return { path, manifest, violations };
  }

  const seen = new Set();
  manifest.sections.forEach((s, i) => {
    const at = `sections[${i}]`;
    if (s === null || typeof s !== 'object' || Array.isArray(s)) { violations.push(`${at} must be an object`); return; }
    const slug = s.slug;
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) violations.push(`${at}.slug must be kebab-case (got ${JSON.stringify(slug)})`);
    else if (seen.has(slug)) violations.push(`${at}.slug '${slug}' is duplicated — slugs must be unique`);
    else seen.add(slug);

    if (typeof s.file !== 'string' || s.file.trim() === '') violations.push(`${at}.file must be a non-empty string`);
    else {
      const abs = resolve(atlasDir, s.file);
      if (abs !== atlasDir && !abs.startsWith(atlasDir + sep)) violations.push(`${at}.file '${s.file}' escapes the atlas dir`);
      else if (!existsSync(abs) || !statSync(abs).isFile()) violations.push(`${at}.file '${s.file}' does not exist under ${atlasDir}`);
    }

    if (!Array.isArray(s.scope) || s.scope.length === 0) violations.push(`${at}.scope must be a non-empty array of git pathspecs`);
    else s.scope.forEach((g, j) => {
      if (typeof g !== 'string' || g.trim() === '') violations.push(`${at}.scope[${j}] must be a non-empty string`);
      // ':' opens git's pathspec-magic syntax (:(exclude), :/, ...) — a scope may not smuggle
      // one in, or the checker's "what does this section cover" answer stops being auditable.
      else if (g.startsWith(':')) violations.push(`${at}.scope[${j}] '${g}' uses git pathspec magic (leading ':') — not allowed`);
    });

    // A stamp must be an immutable object name (lowercase hex, 7-40) or the one sanctioned
    // placeholder. A moving ref — HEAD, @, a branch, a tag — would re-point the pin at whatever
    // it names at read time, so the section could never go stale: fail CLOSED, not STALE, because
    // this is a manifest that lies rather than a stamp that has aged out.
    if (typeof s.verifiedAt !== 'string' || s.verifiedAt.trim() === '') violations.push(`${at}.verifiedAt must be a non-empty sha string`);
    else if (s.verifiedAt !== UNVERIFIED && !SHA_RE.test(s.verifiedAt))
      violations.push(`${at}.verifiedAt ${JSON.stringify(s.verifiedAt)} is not a commit sha — it must be lowercase hex, 7-40 chars, or the placeholder '${UNVERIFIED}'. A moving ref (HEAD, @, a branch, a tag) resolves afresh on every run, so a section pinned to one can never be reported stale`);
    if ('verifiedDigest' in s && (typeof s.verifiedDigest !== 'string' || !/^[0-9a-f]{64}$/.test(s.verifiedDigest))) violations.push(`${at}.verifiedDigest must be a lowercase SHA-256 digest`);

    // Claims are fail-CLOSED like the rest of the schema: a malformed claim list is a manifest that
    // cannot be read, not a section that has aged out. `anchor` is optional — a cited line that
    // yields no usable substring is checked for existence only, exactly as an anchorless register
    // item is.
    if ('claims' in s) {
      if (!Array.isArray(s.claims)) violations.push(`${at}.claims must be an array`);
      else s.claims.forEach((c, j) => {
        const cat = `${at}.claims[${j}]`;
        if (c === null || typeof c !== 'object' || Array.isArray(c)) { violations.push(`${cat} must be an object`); return; }
        if (typeof c.file !== 'string' || c.file.trim() === '') violations.push(`${cat}.file must be a non-empty repo-relative path`);
        if (!Number.isSafeInteger(c.line) || c.line < 1) violations.push(`${cat}.line must be a positive integer`);
        if ('anchor' in c && (typeof c.anchor !== 'string' || c.anchor === '' || c.anchor.length > MAX_ANCHOR || /[`\r\n]/.test(c.anchor)))
          violations.push(`${cat}.anchor must be a backtick-free single line of at most ${MAX_ANCHOR} characters`);
      });
    }
  });
  return { path, manifest, violations };
}

function reportViolations(violations) {
  for (const v of violations) console.log(`  !!  MALFORMED  ${v}`);
  console.log(`\n${violations.length} manifest schema violation(s) — fix the manifest before trusting any section.`);
  process.exit(1);
}

// ---------------------------------------------------------------- init

function cmdInit(args) {
  const f = parseFlags(args, new Set(['--atlas']));
  if (!('--atlas' in f)) { console.error('x init needs --atlas'); usage(); }
  const atlasDir = atlasDirOf(f);
  const manifestPath = join(atlasDir, 'MANIFEST.json');
  // Refuse to overwrite: the manifest carries every stamp in the repo, so a re-run of init
  // must never be able to silently blank them.
  if (existsSync(manifestPath)) {
    console.error(`x refusing to overwrite an existing atlas: ${manifestPath} already exists`);
    process.exit(1);
  }
  try {
    mkdirSync(join(atlasDir, 'sections'), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify({ version: 1, sections: [] }, null, 2) + '\n');
    if (!existsSync(join(atlasDir, 'INBOX.md'))) writeFileSync(join(atlasDir, 'INBOX.md'), INBOX_HEADER);
  } catch (e) {
    console.error(`x cannot scaffold atlas at ${atlasDir}: ${e.message}`);
    process.exit(1);
  }
  console.log(`(atlas) scaffolded ${manifestPath} (0 sections), INBOX.md, sections/`);
}

// ---------------------------------------------------------------- add

// Registers a new section: manifest entry plus a stub prose file. The stamp is deliberately
// the `unverified` placeholder, so the section reports STALE from the moment it exists and
// only a `stamp` — after someone actually wrote and checked the prose — can make it FRESH.
function cmdAdd(args) {
  const f = parseFlags(args, new Set(['--atlas', '--section', '--scope']), new Set(['--scope']));
  for (const req of ['--atlas', '--section', '--scope'])
    if (!(req in f)) { console.error(`x add needs ${req}`); usage(); }
  const atlasDir = atlasDirOf(f);
  const slug = f['--section'];
  const scope = f['--scope'];

  if (!SLUG_RE.test(slug)) { console.error(`x --section '${slug}' must be kebab-case (a-z, 0-9, single hyphens)`); process.exit(1); }
  // Same rule the schema enforces, applied at the door: a scope carrying git pathspec magic
  // would make "what does this section cover" unauditable.
  for (const g of scope)
    if (g.startsWith(':')) { console.error(`x --scope '${g}' uses git pathspec magic (leading ':') — not allowed`); process.exit(1); }

  const { path, manifest, violations } = loadManifest(atlasDir);
  if (violations.length) reportViolations(violations);
  if (manifest.sections.some((s) => s.slug === slug)) {
    console.error(`x section '${slug}' already exists — pick another slug, or edit its prose and re-stamp it`);
    process.exit(1);
  }

  const rel = `sections/${slug}.md`;
  const abs = join(atlasDir, 'sections', `${slug}.md`);
  if (existsSync(abs)) { console.error(`x refusing to overwrite existing prose at ${abs}`); process.exit(1); }
  const stub = `# ${slug}\n\nCharter: replace this line with one sentence naming what this section covers and what it deliberately leaves out.\n`;
  try {
    mkdirSync(join(atlasDir, 'sections'), { recursive: true });
    writeFileSync(abs, stub);
    manifest.sections.push({ slug, file: rel, scope: [...scope], verifiedAt: UNVERIFIED });
    writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  } catch (e) {
    console.error(`x cannot add section '${slug}': ${e.message}`);
    process.exit(1);
  }
  console.log(`(atlas) added ${slug} -> ${rel} (scope: ${scope.join(', ')}; verifiedAt '${UNVERIFIED}' — STALE until you write the prose and stamp it)`);
}

// ---------------------------------------------------------------- check

function cmdCheck(args) {
  const gate = args.includes('--gate');
  const claimsGate = args.includes('--claims-gate');
  const stats = args.includes('--stats');
  const rest = args.filter((a) => a !== '--gate' && a !== '--claims-gate' && a !== '--stats');
  const f = parseFlags(rest, new Set(['--atlas', '--root']));
  if (!('--atlas' in f)) { console.error('x check needs --atlas'); usage(); }
  const atlasDir = atlasDirOf(f);
  const root = repoRootOf(atlasDir, f['--root']);

  // The atlas dir is excluded from its own staleness diff and coverage sweep. WHY: `stamp`
  // rewrites MANIFEST.json inside the atlas dir, so a section whose scope covers that dir (the
  // ordinary case — atlas at code-ops-docs/98 System/Atlas, a section scoped `docs/**`) is made stale by the very
  // write meant to freshen it, and can never converge to FRESH. `:(exclude)` is git's own
  // pathspec magic; the manifest's ban on a leading ':' governs manifest CONTENT (what a human
  // wrote as a scope, which must stay auditable), not the checker's internal pathspecs.
  // Edge: if the atlas dir is outside the repo root, or IS the root, no relative path usable as
  // an exclusion exists — outside the root nothing in the repo is being rewritten so none is
  // needed, and at the root an exclusion would blank every scope. Skip it in both cases.
  // Canonicalize both sides first: on Windows one side may arrive as an 8.3 short name
  // (RUNNER~1) while git reports the long form, and relative() across the two aliases yields a
  // ../-prefixed path that silently disables the exclusion — the exact self-invalidation the
  // exclusion exists to prevent.
  const { atlasRel, exclude: excludeAtlas } = atlasExclusion(root, atlasDir);
  // `'..'` is the exact-parent case and carries no trailing slash, so a startsWith('../') test
  // alone misses it and hands git `:(exclude)..`, which git rejects outright.

  const { manifest, violations } = loadManifest(atlasDir);
  const head = resolveCommit(root, 'HEAD');
  console.log(`# atlas ${atlasDir}${head ? `  (HEAD ${head.slice(0, 7)})` : '  (HEAD unresolved)'}`);
  if (violations.length) reportViolations(violations);
  // A repo with no resolvable HEAD cannot answer "what changed since" for any section — that is
  // a broken checkout, not a fresh atlas. Fail closed rather than report everything FRESH.
  if (!head) {
    console.log(`  !!  MALFORMED  cannot resolve HEAD in ${root} — not a git repo, or a repo with no commits`);
    console.log('\n1 manifest schema violation(s) — fix the manifest before trusting any section.');
    process.exit(1);
  }

  let stale = 0;
  const pinCache = new Map();
  // One classifier run for every claim in the manifest, before the section loop, so the report
  // beneath each section verdict costs one child process for the whole check rather than one per
  // section.
  const claimReport = classifyClaims(root, manifest.sections);
  const claimIds = new Map();
  for (const item of claimReport.items) claimIds.set(`${item.slug}\0${item.claim.file}:${item.claim.line}`, item.id);
  let claimsTotal = 0;
  let claimsUnfresh = 0;

  // Prints one section's claim report beneath its freshness verdict. A section citing nothing
  // prints `claims: none`: it makes no claim a reader could check, which is a fact about the
  // section, not a failure.
  const reportClaims = (s) => {
    const claims = s.claims ?? [];
    if (claims.length === 0) { console.log(`      claims: none`); return; }
    const counts = { fresh: 0, moved: 0, drifted: 0, gone: 0, other: 0 };
    const offenders = [];
    for (const claim of claims) {
      claimsTotal++;
      const id = claimIds.get(`${s.slug}\0${claim.file}:${claim.line}`);
      const found = id ? claimReport.statuses.get(id) : undefined;
      const status = claimReport.error ? 'UNCHECKED' : (found?.status ?? 'UNCHECKED');
      const bucket = { FRESH: 'fresh', MOVED: 'moved', DRIFTED: 'drifted', GONE: 'gone' }[status] ?? 'other';
      counts[bucket]++;
      if (status === CLAIM_FRESH) continue;
      claimsUnfresh++;
      const note = claimReport.error ?? found?.note ?? 'the classifier reported no status for this claim';
      offenders.push(`        !!  ${status}  ${claim.file}:${claim.line}${note ? `  — ${note}` : ''}`);
    }
    const other = counts.other ? `, ${counts.other} other` : '';
    console.log(`      claims: ${counts.fresh} fresh, ${counts.moved} moved, ${counts.drifted} drifted, ${counts.gone} gone${other}`);
    for (const line of offenders) console.log(line);
  };

  // The freshness verdict for one section. Extracted from the loop body unchanged except that its
  // early exits became returns, so every verdict path is followed by the same claim report.
  const reportSection = (s, idx) => {
    // Fail CLOSED on a hex-named ref, for the same reason the shape rule rejects `HEAD`: this is
    // a manifest whose pin lies, not a stamp that has aged out. The shape rule and this
    // resolution rule are separate and both load-bearing — `main` is caught by shape,
    // `deadbeef` only here.
    // The placeholder never touches resolution: a ref that happens to be NAMED 'unverified'
    // would otherwise resolve and hand every never-stamped section a moving FRESH pin.
    if (s.verifiedAt === UNVERIFIED) {
      stale++;
      console.log(`  !!  STALE  ${s.slug}  — never stamped ('${UNVERIFIED}'): write the prose, verify it, then stamp`);
      return;
    }
    if (!pinCache.has(s.verifiedAt)) pinCache.set(s.verifiedAt, resolvePin(root, s.verifiedAt));
    const { sha: pinned, movingRef } = pinCache.get(s.verifiedAt);
    if (movingRef) {
      console.log(`  !!  MALFORMED  sections[${idx}].verifiedAt ${MOVING_PIN_REASON(s.verifiedAt)}`);
      console.log('\n1 manifest schema violation(s) — fix the manifest before trusting any section.');
      process.exit(1);
    }
    const digestState = s.verifiedDigest ? scopeDigest(root, s.scope, excludeAtlas) : null;
    const digestMatches = digestState !== null && digestState.digest === s.verifiedDigest;
    if (!pinned && !digestMatches) {
      stale++;
      console.log(`  !!  STALE  ${s.slug}  — verifiedAt '${s.verifiedAt}' does not resolve to a commit in this repo (re-verify and re-stamp)`);
      return;
    }
    // A scope matching zero tracked files can never produce a diff hit, so it would report FRESH
    // forever on a claim nobody can invalidate. Catch it before the diff verdict and call it what
    // it is: a section whose scope no longer points at the code. Per-section trust failure, so
    // STALE — not a manifest schema violation, since the store itself is well-formed.
    const alive = digestState === null
      ? git(['ls-files', '--', ...s.scope, ...excludeAtlas], root)
      : { ok: true, paths: digestState.paths };
    if (alive.ok && (alive.paths ?? lines(alive.out)).length === 0) {
      stale++;
      // Diagnose causally: if the same scope DOES match tracked files once the atlas exclusion
      // is lifted, the exclusion is the cause — the scope only covers the atlas's own tree,
      // which freshness tracking deliberately does not cover — not a typo. This catches both a
      // scope inside the atlas dir and one a level up whose only tracked content is the atlas.
      const woExclude = excludeAtlas.length > 0 ? git(['ls-files', '--', ...s.scope], root) : null;
      if (woExclude?.ok && lines(woExclude.out).length > 0)
        console.log(`  !!  STALE  ${s.slug}  — scope matches only the atlas directory ('${atlasRel}'), which is excluded from freshness tracking: the atlas does not describe itself; re-scope it at the code`);
      else
        console.log(`  !!  STALE  ${s.slug}  — scope matches no tracked file (dead scope: a typo or a moved tree; re-scope and re-stamp)`);
      return;
    }
    // `<pinned> --` (no `..HEAD`) diffs the pin against the WORKING TREE, so an uncommitted edit
    // to a scoped tracked file reads STALE too — the fail-safe direction. Untracked files are
    // outside any diff and stay invisible until they are added.
    if (digestMatches) {
      console.log(`  ok  FRESH  ${s.slug}  (verified digest ${s.verifiedDigest.slice(0, 7)}; scope: ${s.scope.join(', ')})`);
      return;
    }
    if (s.verifiedDigest) {
      stale++;
      if (pinned) {
        const diagnostic = git(['diff', '--ignore-submodules=none', '--name-only', pinned, '--', ...s.scope, ...excludeAtlas], root);
        const hits = diagnostic.ok ? lines(diagnostic.out) : [];
        const shown = hits.slice(0, MAX_LISTED_PATHS).join(', '); const more = hits.length > MAX_LISTED_PATHS ? `, +${hits.length - MAX_LISTED_PATHS} more` : '';
        console.log(`  !!  STALE  ${s.slug}  — ${hits.length} scoped path(s) changed since ${pinned.slice(0, 7)}: ${shown}${more}`);
      } else console.log(`  !!  STALE  ${s.slug}  — scoped tracked-state digest changed and verifiedAt '${s.verifiedAt}' does not resolve`);
      return;
    }
    if (!pinned) {
      stale++;
      console.log(`  !!  STALE  ${s.slug}  — scoped tracked-state digest changed and verifiedAt '${s.verifiedAt}' does not resolve (re-verify and re-stamp)`);
      return;
    }
    const baseline = pinned;
    const d = git(['diff', '--ignore-submodules=none', '--name-only', baseline, '--', ...s.scope, ...excludeAtlas], root);
    if (!d.ok) {
      stale++;
      console.log(`  !!  STALE  ${s.slug}  — cannot diff since ${baseline.slice(0, 7)}: ${d.err.trim().split('\n')[0]}`);
      return;
    }
    const hits = lines(d.out);
    if (hits.length === 0) {
      console.log(`  ok  FRESH  ${s.slug}  (verified at ${baseline.slice(0, 7)}; scope: ${s.scope.join(', ')})`);
      return;
    }
    stale++;
    const shown = hits.slice(0, MAX_LISTED_PATHS);
    const more = hits.length > shown.length ? `, +${hits.length - shown.length} more` : '';
    console.log(`  !!  STALE  ${s.slug}  — ${hits.length} scoped path(s) changed since ${baseline.slice(0, 7)}: ${shown.join(', ')}${more}`);
  };

  for (const [idx, s] of manifest.sections.entries()) {
    reportSection(s, idx);
    reportClaims(s);
  }

  // ---- coverage sweep (advisory, even under --gate) --------------------------
  // Same exclusion on both sides of the sweep: the atlas's own tree neither needs coverage nor
  // grants it, so it is neither reported unmapped nor able to mark a segment mapped.
  const tracked = git(['ls-files', '--', ...excludeAtlas], root);
  const unmapped = [];
  let sweepRan = true;
  if (!tracked.ok) {
    sweepRan = false;
    console.log(`  advisory: coverage sweep skipped — git ls-files failed in ${root}: ${tracked.err.trim().split('\n')[0]}`);
  } else {
    const topOf = (p) => p.split('/')[0]; // git always reports forward slashes, on every platform
    const allTop = new Set(lines(tracked.out).map(topOf));
    const allScopes = manifest.sections.flatMap((s) => s.scope);
    // Covered = a top-level segment that some scope matches a TRACKED FILE under. A scope of
    // `src/auth/**` therefore covers segment `src` only if such a file actually exists — a
    // scope pointing at nothing may not launder a whole top-level tree as mapped.
    const covered = new Set();
    if (allScopes.length) {
      const m = git(['ls-files', '--', ...allScopes, ...excludeAtlas], root);
      if (!m.ok) {
        console.log(`  !!  MALFORMED  a scope pathspec was rejected by git: ${m.err.trim().split('\n')[0]}`);
        console.log('\n1 manifest schema violation(s) — fix the manifest before trusting any section.');
        process.exit(1);
      }
      for (const p of lines(m.out)) covered.add(topOf(p));
    }
    for (const t of [...allTop].sort()) if (!covered.has(t)) unmapped.push(t);
    for (const t of unmapped)
      console.log(`  advisory: unmapped top-level path '${t}' — no section scope matches a tracked file under it (scoping todo, not a trust violation)`);
  }

  // The summary must not claim coverage a skipped sweep never established.
  const unmappedCell = sweepRan ? `${unmapped.length} unmapped` : 'unmapped unknown (sweep skipped)';
  console.log(`\n${manifest.sections.length} section(s), ${stale} stale, ${unmappedCell}.`);
  if (claimsTotal) console.log(`${claimsTotal} claim(s), ${claimsUnfresh} needing re-verification.`);
  if (stats) console.log(`git subprocesses: ${gitCallCount}`);
  // Two independent gates. `--gate` still owns the section verdict and its meaning is unchanged;
  // `--claims-gate` owns the finer question and fires on any claim the register classifier did not
  // call FRESH, an unclassifiable one included.
  const gated = (stale && gate) || (claimsUnfresh && claimsGate);
  if (stale && gate)
    console.error('--gate: stale section(s) present — re-derive and re-stamp them, or treat their claims as leads, not facts.');
  if (claimsUnfresh && claimsGate)
    console.error(`--claims-gate: ${claimsUnfresh} claim(s) no longer sit on the code they cite — re-read those lines and re-stamp the section.`);
  if (gated) process.exit(1);
}

// ---------------------------------------------------------------- stamp

function cmdStamp(args) {
  const f = parseFlags(args, new Set(['--atlas', '--section', '--at', '--root']));
  for (const req of ['--atlas', '--section'])
    if (!(req in f)) { console.error(`x stamp needs ${req}`); usage(); }
  const atlasDir = atlasDirOf(f);
  const root = repoRootOf(atlasDir, f['--root']);

  const { path, manifest, violations } = loadManifest(atlasDir);
  if (violations.length) reportViolations(violations);

  const target = manifest.sections.find((s) => s.slug === f['--section']);
  if (!target) {
    const known = manifest.sections.map((s) => s.slug).join(', ') || '(none)';
    console.error(`x unknown section slug: ${f['--section']} — known slugs: ${known}`);
    process.exit(1);
  }
  const rev = f['--at'] ?? 'HEAD';
  // The placeholder is not a rev: even if a ref named 'unverified' exists, stamping "at" it is
  // a category error — refuse rather than resolve.
  if (rev === UNVERIFIED) { console.error(`x '--at ${UNVERIFIED}' is the never-stamped placeholder, not a rev — stamp at HEAD or a sha`); process.exit(1); }
  // Same guard as check, same reason: an `--at` that LOOKS like an object name but resolves as a
  // ref would write a pin that moves. The default `HEAD` (and any other symbolic rev) is
  // legitimately a ref and resolves normally — only sha-shaped values are held to this.
  const { sha, movingRef } = resolvePin(root, rev);
  if (movingRef) { console.error(`x refusing to stamp: --at ${MOVING_PIN_REASON(rev)}`); process.exit(1); }
  if (!sha) { console.error(`x '${rev}' does not resolve to a commit in ${root}`); process.exit(1); }

  const before = target.verifiedAt;
  if (!('--at' in f)) {
    const exclusion = atlasExclusion(root, atlasDir).exclude;
    const unstaged = gitBuffer(['diff', '--ignore-submodules=none', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', '--no-renames', '--', ...target.scope, ...exclusion], root);
    if (!unstaged.ok || unstaged.out.length) { console.error('x refusing to stamp with scoped unstaged changes'); process.exit(1); }
  }
  target.verifiedAt = sha;
  if (!('--at' in f)) {
    const digestState = scopeDigest(root, target.scope, atlasExclusion(root, atlasDir).exclude);
    if (!digestState) { console.error('x cannot calculate scoped tracked-state digest; refusing to stamp'); process.exit(1); }
    target.verifiedDigest = digestState.digest;
  } else delete target.verifiedDigest;
  // Claims are recorded in both modes. They describe the section's prose against the CURRENT tree,
  // which is what `check` re-classifies, so a historical `--at` pin does not change what a claim
  // means — only what the section's digest asserts.
  const claims = claimsFor(root, atlasDir, target);
  if (claims === null) { console.error(`x cannot read section prose at ${resolve(atlasDir, target.file)}; refusing to stamp`); process.exit(1); }
  if (claims.length) target.claims = claims; else delete target.claims;
  try { writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n'); }
  catch (e) { console.error(`x cannot write ${path}: ${e.message}`); process.exit(1); }
  console.log(`(atlas) stamped ${target.slug}: ${String(before).slice(0, 7)} -> ${sha.slice(0, 7)} (${claims.length} claim(s))`);
}

// ---------------------------------------------------------------- scope

// How many scoped files one suggestion queries. Each one costs a child process that loads the
// symbol index, so a scope covering a whole tree is bounded rather than left to run for minutes.
const MAX_SCOPE_BLAST = 200;

// Derives a section's neighbors from the symbol index's import edges, so a scope can be drawn at a
// module boundary instead of at whatever directory a hand typed. It reads `context-query.mjs blast
// --json` and writes nothing: the output is a pathspec list for the operator to pass to
// `add --scope`.
//
// Ceiling: `blast --json` reports the IMPORTER direction only (scripts/context-query.mjs, case
// 'blast'), so a suggestion names the files that import the scope, not the ones the scope imports.
// Depth is 1, because a file two hops out is a neighboring section rather than a wider scope.
function cmdScope(args) {
  const rest = args.filter((a) => a !== '--suggest');
  const suggest = args.includes('--suggest');
  const slug = rest[0] !== undefined && !rest[0].startsWith('--') ? rest.shift() : null;
  const f = parseFlags(rest, new Set(['--atlas', '--root']));
  if (!('--atlas' in f)) { console.error('x scope needs --atlas'); usage(); }
  if (slug === null) { console.error('x scope needs a section slug'); usage(); }
  if (!suggest) { console.error('x scope needs --suggest — suggesting is its only mode, and it never writes'); usage(); }
  const atlasDir = atlasDirOf(f);
  const root = repoRootOf(atlasDir, f['--root']);

  const { manifest, violations } = loadManifest(atlasDir);
  if (violations.length) reportViolations(violations);
  const target = manifest.sections.find((s) => s.slug === slug);
  if (!target) {
    const known = manifest.sections.map((s) => s.slug).join(', ') || '(none)';
    console.error(`x unknown section slug: ${slug} — known slugs: ${known}`);
    process.exit(1);
  }

  const query = join(here, 'context-query.mjs');
  if (!existsSync(query)) { console.error(`x context-query.mjs is not beside ${here}`); process.exit(1); }
  const ask = (queryArgs) => {
    try {
      return { ok: true, out: execFileSync(process.execPath, [query, ...queryArgs, '--root', root, '--json', '--no-stale-check'],
        { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch { return { ok: false, out: '' }; }
  };
  // `status` is the one query command that does NOT build an index on demand, so it is the honest
  // test for "is there an index". Building one here would hide the operator's real state behind a
  // slow side effect they did not ask for.
  if (!ask(['status']).ok) {
    console.error('x no symbol index for this repo — run `node scripts/context-query.mjs refresh` first, then re-run this suggestion');
    process.exit(1);
  }

  const scoped = git(['ls-files', '--', ...target.scope, ...atlasExclusion(root, atlasDir).exclude], root);
  if (!scoped.ok) { console.error(`x cannot list the scope of '${slug}': ${scoped.err.trim().split('\n')[0]}`); process.exit(1); }
  const files = lines(scoped.out);
  const inScope = new Set(files);
  const queried = files.slice(0, MAX_SCOPE_BLAST);
  const neighbors = new Map();
  for (const file of queried) {
    const r = ask(['blast', file, '--depth', '1']);
    if (!r.ok) continue; // not an indexed code file — the index covers code, a scope covers anything
    let data;
    try { data = JSON.parse(r.out); } catch { continue; }
    for (const importer of data.importers ?? []) {
      if (typeof importer?.file !== 'string' || inScope.has(importer.file)) continue;
      if (!neighbors.has(importer.file)) neighbors.set(importer.file, new Set());
      neighbors.get(importer.file).add(file);
    }
  }

  console.log(`# atlas scope suggestion for ${slug}  (current scope: ${target.scope.join(', ')})`);
  console.log(`  ${files.length} tracked file(s) in scope; ${queried.length} queried for import edges at depth 1`);
  if (queried.length < files.length)
    console.log(`  advisory: capped at ${MAX_SCOPE_BLAST} scoped file(s) — narrow the scope for a complete answer`);
  const suggested = [...neighbors.keys()].sort();
  for (const p of suggested) {
    const via = [...neighbors.get(p)].sort();
    const shown = via.slice(0, 3).join(', ');
    console.log(`  ${p}  (imports ${shown}${via.length > 3 ? `, +${via.length - 3} more` : ''})`);
  }
  console.log(`\n${suggested.length} neighbor(s) outside the current scope. Pass them to \`add --scope\`:`);
  console.log(suggested.length ? `  ${suggested.map((p) => `--scope ${p}`).join(' ')}` : '  (none — the scope already covers every depth-1 importer)');
}

// ---------------------------------------------------------------- inbox

function cmdInbox(args) {
  const f = parseFlags(args, new Set(['--atlas', '--note', '--root']));
  for (const req of ['--atlas', '--note'])
    if (!(req in f)) { console.error(`x inbox needs ${req}`); usage(); }
  const atlasDir = atlasDirOf(f);
  const note = f['--note'].trim();
  if (note === '') { console.error('x --note must not be empty'); process.exit(1); }
  // One line: a multi-line note breaks the append-only `- <date> <sha>: <text>` grammar that
  // makes consolidation (fold the entry, delete the line) mechanical.
  if (/[\r\n]/.test(note)) { console.error('x --note must be a single line'); process.exit(1); }
  if (!existsSync(atlasDir)) { console.error(`x atlas dir not found: ${atlasDir}`); process.exit(1); }

  const root = repoRootOf(atlasDir, f['--root']);
  const head = resolveCommit(root, 'HEAD');
  const sha = head ? head.slice(0, 7) : 'unknown';
  if (!head) console.log('  advisory: HEAD did not resolve — the entry is stamped \'unknown\' (an inbox note is a log, not a gate)');
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const inboxPath = join(atlasDir, 'INBOX.md');
  const line = `- ${date} ${sha}: ${note}\n`;
  try {
    if (!existsSync(inboxPath)) writeFileSync(inboxPath, INBOX_HEADER);
    else {
      const cur = readFileSync(inboxPath, 'utf8');
      if (cur !== '' && !cur.endsWith('\n')) appendFileSync(inboxPath, '\n');
    }
    appendFileSync(inboxPath, line);
  } catch (e) {
    console.error(`x cannot append to ${inboxPath}: ${e.message}`);
    process.exit(1);
  }
  console.log(`(atlas) inbox += ${date} ${sha}: ${note}`);
}

// ---------------------------------------------------------------- dispatch

const argv = process.argv.slice(2);
if (argv[0] === 'init') cmdInit(argv.slice(1));
else if (argv[0] === 'add') cmdAdd(argv.slice(1));
else if (argv[0] === 'check') cmdCheck(argv.slice(1));
else if (argv[0] === 'stamp') cmdStamp(argv.slice(1));
else if (argv[0] === 'scope') cmdScope(argv.slice(1));
else if (argv[0] === 'inbox') cmdInbox(argv.slice(1));
else usage();
