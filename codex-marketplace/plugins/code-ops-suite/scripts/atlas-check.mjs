#!/usr/bin/env node
// Atlas checker for the code-ops suite — the per-repo knowledge cache with mechanical
// staleness (docs/techniques/atlas.md). Runs INSIDE a target repo, never against this one.
//
//   node scripts/atlas-check.mjs init  --atlas <dir>
//   node scripts/atlas-check.mjs add   --atlas <dir> --section <slug> --scope <pathspec> [--scope <pathspec> ...]
//   node scripts/atlas-check.mjs check --atlas <dir> [--root <repo>] [--gate]
//   node scripts/atlas-check.mjs stamp --atlas <dir> --section <slug> [--root <dir>] [--at <sha>]
//   node scripts/atlas-check.mjs inbox --atlas <dir> --note <text> [--root <dir>]
//
// WHY: a written-down understanding of a repo is only worth reading if you can tell,
// mechanically, whether it still describes the code. The atlas pins each section to the
// commit it was verified at; `check` asks git whether anything inside that section's scope
// has moved since. FRESH sections are consumed as truth without re-verification; STALE ones
// are leads, not facts. The staleness signal is deliberately fail-SAFE (an unknown or
// unparseable `verifiedAt` reports STALE, never an error that hides the section), while the
// manifest schema is fail-CLOSED (a malformed manifest exits 1 even without --gate — a
// manifest that cannot be parsed vacates every freshness claim in it).
//
// MANIFEST.json (the ONLY place stamps and scopes live; hands never edit it — `add` and
// `stamp` do):
//   { "version": 1,
//     "sections": [ { "slug": "<kebab>", "file": "sections/<slug>.md",
//                     "scope": ["<git pathspec>", ...], "verifiedAt": "<sha>" } ] }
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
// Scope matching is git's own pathspec semantics, not a reimplemented globber: staleness is
// `git diff --name-only <verifiedAt> -- <scope...>` (no `..HEAD`, so the working tree counts
// too — an uncommitted edit to a scoped tracked file is already a reason to distrust the
// section) and coverage is `git ls-files -- <scope...>`. The same strings therefore mean the
// same thing to the checker and to a human running git by hand. `check` adds one internal
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
// Exit: 0 clean (check without --gate is always 0 unless the manifest is malformed);
//       1 violation-or-gated (malformed manifest, refused write, unknown slug/sha, or
//         --gate with at least one STALE section);
//       2 usage error (unknown subcommand, unknown flag, missing/blank flag value).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, appendFileSync, realpathSync } from 'node:fs';
import { resolve, join, sep, relative, isAbsolute } from 'node:path';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// A stamp is an immutable object name, never a ref. See the moving-ref note in the header.
const SHA_RE = /^[0-9a-f]{7,40}$/;
const UNVERIFIED = 'unverified';
const MAX_LISTED_PATHS = 10;
const INBOX_HEADER = '# Atlas inbox\n\n'
  + 'Append-only dated observations. Fold them into their sections, then clear the folded lines.\n\n';

function usage() {
  console.error('usage: atlas-check.mjs init  --atlas <dir>');
  console.error('       atlas-check.mjs add   --atlas <dir> --section <slug> --scope <pathspec> [--scope <pathspec> ...]');
  console.error('       atlas-check.mjs check --atlas <dir> [--root <repo>] [--gate]');
  console.error('       atlas-check.mjs stamp --atlas <dir> --section <slug> [--root <dir>] [--at <sha>]');
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
function git(args, cwd) {
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

const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '');

// Resolve a rev to a full commit sha, or null. `^{commit}` so a tag or tree-ish that is not a
// commit is rejected rather than silently stamped.
function resolveCommit(root, rev) {
  const r = git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], root);
  const sha = r.ok ? r.out.trim() : '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
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
// atlas dir (the normal case — docs/atlas lives inside the repo it describes), else cwd.
function repoRootOf(atlasDir, explicit) {
  if (explicit) return resolve(explicit);
  if (existsSync(atlasDir)) {
    const r = git(['rev-parse', '--show-toplevel'], atlasDir);
    if (r.ok && r.out.trim()) return resolve(r.out.trim());
  }
  return resolve('.');
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
  const rest = args.filter((a) => a !== '--gate');
  const f = parseFlags(rest, new Set(['--atlas', '--root']));
  if (!('--atlas' in f)) { console.error('x check needs --atlas'); usage(); }
  const atlasDir = atlasDirOf(f);
  const root = repoRootOf(atlasDir, f['--root']);

  // The atlas dir is excluded from its own staleness diff and coverage sweep. WHY: `stamp`
  // rewrites MANIFEST.json inside the atlas dir, so a section whose scope covers that dir (the
  // ordinary case — atlas at docs/atlas, a section scoped `docs/**`) is made stale by the very
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
  const canon = (p) => { try { return realpathSync.native(p); } catch { return p; } };
  const atlasRel = relative(canon(root), canon(atlasDir)).split(sep).join('/');
  // `'..'` is the exact-parent case and carries no trailing slash, so a startsWith('../') test
  // alone misses it and hands git `:(exclude)..`, which git rejects outright.
  const excludeAtlas = (atlasRel === '' || atlasRel === '..' || atlasRel.startsWith('../') || isAbsolute(atlasRel))
    ? [] : [`:(exclude)${atlasRel}`];

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
  for (const [idx, s] of manifest.sections.entries()) {
    // Fail CLOSED on a hex-named ref, for the same reason the shape rule rejects `HEAD`: this is
    // a manifest whose pin lies, not a stamp that has aged out. The shape rule and this
    // resolution rule are separate and both load-bearing — `main` is caught by shape,
    // `deadbeef` only here.
    // The placeholder never touches resolution: a ref that happens to be NAMED 'unverified'
    // would otherwise resolve and hand every never-stamped section a moving FRESH pin.
    if (s.verifiedAt === UNVERIFIED) {
      stale++;
      console.log(`  !!  STALE  ${s.slug}  — never stamped ('${UNVERIFIED}'): write the prose, verify it, then stamp`);
      continue;
    }
    const { sha: pinned, movingRef } = resolvePin(root, s.verifiedAt);
    if (movingRef) {
      console.log(`  !!  MALFORMED  sections[${idx}].verifiedAt ${MOVING_PIN_REASON(s.verifiedAt)}`);
      console.log('\n1 manifest schema violation(s) — fix the manifest before trusting any section.');
      process.exit(1);
    }
    if (!pinned) {
      stale++;
      console.log(`  !!  STALE  ${s.slug}  — verifiedAt '${s.verifiedAt}' does not resolve to a commit in this repo (re-verify and re-stamp)`);
      continue;
    }
    // A scope matching zero tracked files can never produce a diff hit, so it would report FRESH
    // forever on a claim nobody can invalidate. Catch it before the diff verdict and call it what
    // it is: a section whose scope no longer points at the code. Per-section trust failure, so
    // STALE — not a manifest schema violation, since the store itself is well-formed.
    const alive = git(['ls-files', '--', ...s.scope, ...excludeAtlas], root);
    if (alive.ok && lines(alive.out).length === 0) {
      stale++;
      // Name the real cause when the scope sits inside the excluded atlas tree: that is not a
      // typo but a section trying to describe the atlas itself, which freshness tracking
      // deliberately does not cover.
      const insideAtlas = excludeAtlas.length > 0
        && s.scope.every((g) => g === atlasRel || g.startsWith(`${atlasRel}/`));
      if (insideAtlas)
        console.log(`  !!  STALE  ${s.slug}  — scope lies inside the atlas directory ('${atlasRel}'), which is excluded from freshness tracking: the atlas does not describe itself; re-scope it at the code`);
      else
        console.log(`  !!  STALE  ${s.slug}  — scope matches no tracked file (dead scope: a typo or a moved tree; re-scope and re-stamp)`);
      continue;
    }
    // `<pinned> --` (no `..HEAD`) diffs the pin against the WORKING TREE, so an uncommitted edit
    // to a scoped tracked file reads STALE too — the fail-safe direction. Untracked files are
    // outside any diff and stay invisible until they are added.
    const d = git(['diff', '--name-only', pinned, '--', ...s.scope, ...excludeAtlas], root);
    if (!d.ok) {
      stale++;
      console.log(`  !!  STALE  ${s.slug}  — cannot diff since ${pinned.slice(0, 7)}: ${d.err.trim().split('\n')[0]}`);
      continue;
    }
    const hits = lines(d.out);
    if (hits.length === 0) {
      console.log(`  ok  FRESH  ${s.slug}  (verified at ${pinned.slice(0, 7)}; scope: ${s.scope.join(', ')})`);
      continue;
    }
    stale++;
    const shown = hits.slice(0, MAX_LISTED_PATHS);
    const more = hits.length > shown.length ? `, +${hits.length - shown.length} more` : '';
    console.log(`  !!  STALE  ${s.slug}  — ${hits.length} scoped path(s) changed since ${pinned.slice(0, 7)}: ${shown.join(', ')}${more}`);
  }

  // ---- coverage sweep (advisory, even under --gate) --------------------------
  // Same exclusion on both sides of the sweep: the atlas's own tree neither needs coverage nor
  // grants it, so it is neither reported unmapped nor able to mark a segment mapped.
  const tracked = git(['ls-files', '--', ...excludeAtlas], root);
  const unmapped = [];
  if (!tracked.ok) {
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

  console.log(`\n${manifest.sections.length} section(s), ${stale} stale, ${unmapped.length} unmapped.`);
  if (stale && gate) {
    console.error('--gate: stale section(s) present — re-derive and re-stamp them, or treat their claims as leads, not facts.');
    process.exit(1);
  }
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
  target.verifiedAt = sha;
  try { writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n'); }
  catch (e) { console.error(`x cannot write ${path}: ${e.message}`); process.exit(1); }
  console.log(`(atlas) stamped ${target.slug}: ${String(before).slice(0, 7)} -> ${sha.slice(0, 7)}`);
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
else if (argv[0] === 'inbox') cmdInbox(argv.slice(1));
else usage();
