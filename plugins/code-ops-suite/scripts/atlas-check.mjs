#!/usr/bin/env node
// Atlas checker for the code-ops suite — the per-repo knowledge cache with mechanical
// staleness (docs/techniques/atlas.md). Runs INSIDE a target repo, never against this one.
//
//   node scripts/atlas-check.mjs init  --atlas <dir>
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
// MANIFEST.json (the ONLY place stamps and scopes live; hands never edit it — `stamp` does):
//   { "version": 1,
//     "sections": [ { "slug": "<kebab>", "file": "sections/<slug>.md",
//                     "scope": ["<git pathspec>", ...], "verifiedAt": "<sha>" } ] }
//
// Scope matching is git's own pathspec semantics, not a reimplemented globber: staleness is
// `git diff --name-only <verifiedAt>..HEAD -- <scope...>` and coverage is `git ls-files --
// <scope...>`. The same strings therefore mean the same thing to the checker and to a human
// running git by hand.
//
// Coverage sweep: every first path segment of `git ls-files` that no section's scope actually
// MATCHES A TRACKED FILE UNDER is reported "unmapped" — advisory only, even under --gate,
// because an unmapped path is a scoping todo, not a trust violation.
//
// Exit: 0 clean (check without --gate is always 0 unless the manifest is malformed);
//       1 violation-or-gated (malformed manifest, refused write, unknown slug/sha, or
//         --gate with at least one STALE section);
//       2 usage error (unknown subcommand, unknown flag, missing/blank flag value).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, appendFileSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LISTED_PATHS = 10;
const INBOX_HEADER = '# Atlas inbox\n\n'
  + 'Append-only dated observations. Fold them into their sections, then clear the folded lines.\n\n';

function usage() {
  console.error('usage: atlas-check.mjs init  --atlas <dir>');
  console.error('       atlas-check.mjs check --atlas <dir> [--root <repo>] [--gate]');
  console.error('       atlas-check.mjs stamp --atlas <dir> --section <slug> [--root <dir>] [--at <sha>]');
  console.error('       atlas-check.mjs inbox --atlas <dir> --note <text> [--root <dir>]');
  process.exit(2);
}

// Shared flag parser (dispatch-ledger.mjs house form): --flag value pairs, rejecting a
// missing/blank value or one that looks like another flag, so a typo'd flag cannot swallow
// the next one and be misread as a path.
function parseFlags(args, known) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!known.has(a)) { console.error(`x unknown argument: ${a}`); usage(); }
    const v = args[++i];
    if (v === undefined || v.trim() === '' || v.startsWith('--')) { console.error(`x ${a} needs a value`); process.exit(2); }
    out[a] = v;
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

    if (typeof s.verifiedAt !== 'string' || s.verifiedAt.trim() === '') violations.push(`${at}.verifiedAt must be a non-empty sha string`);
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

// ---------------------------------------------------------------- check

function cmdCheck(args) {
  const gate = args.includes('--gate');
  const rest = args.filter((a) => a !== '--gate');
  const f = parseFlags(rest, new Set(['--atlas', '--root']));
  if (!('--atlas' in f)) { console.error('x check needs --atlas'); usage(); }
  const atlasDir = atlasDirOf(f);
  const root = repoRootOf(atlasDir, f['--root']);

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
  for (const s of manifest.sections) {
    const pinned = resolveCommit(root, s.verifiedAt);
    if (!pinned) {
      stale++;
      console.log(`  !!  STALE  ${s.slug}  — verifiedAt '${s.verifiedAt}' does not resolve to a commit in this repo (re-verify and re-stamp)`);
      continue;
    }
    const d = git(['diff', '--name-only', `${pinned}..HEAD`, '--', ...s.scope], root);
    if (!d.ok) {
      stale++;
      console.log(`  !!  STALE  ${s.slug}  — cannot diff ${pinned.slice(0, 7)}..HEAD: ${d.err.trim().split('\n')[0]}`);
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
  const tracked = git(['ls-files'], root);
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
      const m = git(['ls-files', '--', ...allScopes], root);
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
  const sha = resolveCommit(root, rev);
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
else if (argv[0] === 'check') cmdCheck(argv.slice(1));
else if (argv[0] === 'stamp') cmdStamp(argv.slice(1));
else if (argv[0] === 'inbox') cmdInbox(argv.slice(1));
else usage();
