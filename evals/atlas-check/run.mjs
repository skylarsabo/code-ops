#!/usr/bin/env node
// Regression eval for scripts/atlas-check.mjs — pins every subcommand against real git
// repos built at runtime (git init + commits in temp dirs; evals/register-staleness/run.mjs
// is the precedent for git-backed evals).
//
// Covered: init scaffolds and refuses to overwrite; FRESH when nothing in scope moved since
// the stamp; STALE naming the triggering path(s) when a scoped file changed; an unknown sha
// reports STALE with a reason instead of erroring; an unmapped top-level path is an advisory
// that still exits 0; --gate exits 1 on STALE but NOT on unmapped-only; a malformed manifest
// exits 1 in every shape (bad JSON, wrong version, dup slug, missing section file, empty
// scope, pathspec magic) even without --gate; stamp moves verifiedAt to HEAD (and to an
// explicit --at) and turns the section FRESH; stamp refuses an unknown slug and an
// unresolvable sha; inbox appends the dated short-sha line and refuses empty/multi-line
// notes; usage errors exit 2. Plus the coverage RULE itself: a scope that matches no tracked
// file may not launder its top-level segment as mapped.
//
//   node evals/atlas-check/run.mjs   (exit 0 = pass)

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'atlas-check.mjs');

const fails = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) fails.push(detail ? `${name} — ${String(detail).slice(0, 400)}` : name);
};

const run = (args, cwd) => {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30000, cwd: cwd ?? REPO });
    return { status: 0, out: stdout };
  } catch (e) {
    return { status: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
};

// ---- scratch git repos ------------------------------------------------------
const cleanupDirs = [];
const g = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });

function newRepo(tag) {
  const dir = mkdtempSync(join(tmpdir(), `atlas-${tag}-`));
  cleanupDirs.push(dir);
  // -c init.defaultBranch keeps the hint quiet without needing a git >= 2.28 `-b` flag.
  g(dir, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  // Local identity: CI runners have no global user.name/user.email, so commits would fail.
  g(dir, ['config', 'user.name', 'Atlas Eval']);
  g(dir, ['config', 'user.email', 'atlas-eval@example.invalid']);
  g(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}
function put(dir, rel, text) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}
function commit(dir, msg, paths) {
  // Explicit-path staging when `paths` is given: a scenario that means to touch ONE scope must
  // not sweep in an unrelated worktree edit (a manifest rewritten between commits) and make a
  // second section stale for the wrong reason.
  g(dir, paths ? ['add', '--', ...paths] : ['add', '-A']);
  g(dir, ['commit', '-q', '-m', msg]);
  return g(dir, ['rev-parse', 'HEAD']).trim();
}
const manifestPath = (dir) => join(dir, 'docs', 'atlas', 'MANIFEST.json');
const writeManifest = (dir, obj) => writeFileSync(manifestPath(dir), typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n');
const readManifest = (dir) => JSON.parse(readFileSync(manifestPath(dir), 'utf8'));

try {
  // ============================================================ A. main repo
  const A = newRepo('main');
  put(A, 'src/app.js', 'export const app = 1;\n');
  put(A, 'src/util.js', 'export const util = 1;\n');
  put(A, 'docs/guide.md', '# guide\n');
  put(A, 'tools/build.sh', 'echo build\n');
  put(A, 'README.md', '# repo\n');
  commit(A, 'initial');

  const atlasA = join(A, 'docs', 'atlas');

  // ---- a. init scaffolds ----------------------------------------------------
  const a = run(['init', '--atlas', atlasA]);
  check('a. init exits 0', a.status === 0, a.out);
  check('a. init writes MANIFEST.json with an empty section list',
    existsSync(manifestPath(A)) && readManifest(A).version === 1 && Array.isArray(readManifest(A).sections) && readManifest(A).sections.length === 0,
    existsSync(manifestPath(A)) ? readFileSync(manifestPath(A), 'utf8') : '(no manifest)');
  check('a. init writes INBOX.md', existsSync(join(atlasA, 'INBOX.md')), a.out);
  check('a. init creates sections/', existsSync(join(atlasA, 'sections')), a.out);

  // ---- b. init refuses to overwrite an existing manifest --------------------
  const b = run(['init', '--atlas', atlasA]);
  check('b. re-running init exits 1', b.status === 1, b.out);
  check('b. it says it refuses to overwrite', /refusing to overwrite an existing atlas/.test(b.out), b.out);

  // Seed two sections by hand (the eval is the fixture author; stamp is exercised below).
  put(A, 'docs/atlas/sections/core.md', '# Core\n\nCharter: the src tree.\n');
  put(A, 'docs/atlas/sections/documentation.md', '# Documentation\n\nCharter: the docs tree.\n');
  writeManifest(A, {
    version: 1,
    sections: [
      { slug: 'core', file: 'sections/core.md', scope: ['src/**'], verifiedAt: '0'.repeat(40) },
      { slug: 'documentation', file: 'sections/documentation.md', scope: ['docs/**'], verifiedAt: '0'.repeat(40) },
    ],
  });
  const c1 = commit(A, 'add atlas');
  // Both sections start pinned at the atlas commit.
  const mA = readManifest(A);
  mA.sections.forEach((s) => { s.verifiedAt = c1; });
  writeManifest(A, mA);

  // ---- c. FRESH when nothing in scope moved --------------------------------
  const c = run(['check', '--atlas', atlasA]);
  check('c. check exits 0 on a fresh atlas', c.status === 0, c.out);
  check('c. core is FRESH', /ok\s+FRESH\s+core\b/.test(c.out), c.out);
  check('c. documentation is FRESH', /ok\s+FRESH\s+documentation\b/.test(c.out), c.out);
  check('c. summary counts 2 sections, 0 stale', /2 section\(s\), 0 stale, 2 unmapped\./.test(c.out), c.out);
  check('c. the report names HEAD', /# atlas .*\(HEAD [0-9a-f]{7}\)/.test(c.out), c.out);

  // The runs above execute with cwd = this repo, so an identical result here proves the repo
  // root is derived from the atlas dir's own git toplevel, not from the caller's cwd.
  const cRoot = run(['check', '--atlas', atlasA, '--root', A]);
  check('c. an explicit --root gives the same verdict as the derived one',
    cRoot.status === 0 && /ok\s+FRESH\s+core\b/.test(cRoot.out) && /2 section\(s\), 0 stale, 2 unmapped\./.test(cRoot.out), cRoot.out);

  // ---- d. unmapped top-level paths are advisories, exit still 0 -------------
  check('d. an unmapped top-level DIR is advised', /advisory: unmapped top-level path 'tools'/.test(c.out), c.out);
  check('d. an unmapped top-level FILE is advised', /advisory: unmapped top-level path 'README\.md'/.test(c.out), c.out);
  check('d. a mapped top-level path is NOT advised', !/unmapped top-level path 'src'/.test(c.out) && !/unmapped top-level path 'docs'/.test(c.out), c.out);
  check('d. the advisory calls itself a scoping todo, not a trust violation', /scoping todo, not a trust violation/.test(c.out), c.out);

  // ---- e. --gate does NOT fail on unmapped-only ----------------------------
  const e = run(['check', '--atlas', atlasA, '--gate']);
  check('e. --gate exits 0 when the only findings are unmapped advisories', e.status === 0, e.out);
  check('e. --gate still prints the unmapped advisory', /unmapped top-level path 'tools'/.test(e.out), e.out);

  // ---- f. STALE when a scoped file changed ---------------------------------
  put(A, 'src/app.js', 'export const app = 2;\n');
  const c2 = commit(A, 'touch app', ['src/app.js']);
  const f = run(['check', '--atlas', atlasA]);
  check('f. check without --gate still exits 0 with a stale section', f.status === 0, f.out);
  check('f. core is STALE and names the triggering path',
    /!!\s+STALE\s+core\s+— 1 scoped path\(s\) changed since [0-9a-f]{7}: src\/app\.js/.test(f.out), f.out);
  check('f. the untouched section stays FRESH', /ok\s+FRESH\s+documentation\b/.test(f.out), f.out);
  check('f. summary counts 1 stale', /2 section\(s\), 1 stale, 2 unmapped\./.test(f.out), f.out);

  // ---- g. --gate exits 1 on STALE ------------------------------------------
  const gg = run(['check', '--atlas', atlasA, '--gate']);
  check('g. --gate exits 1 when a section is STALE', gg.status === 1, gg.out);
  check('g. the gate message says leads, not facts', /leads, not facts/.test(gg.out), gg.out);

  // ---- h. stamp moves verifiedAt to HEAD; check turns FRESH ----------------
  const h = run(['stamp', '--atlas', atlasA, '--section', 'core']);
  check('h. stamp exits 0', h.status === 0, h.out);
  check('h. stamp reports the move', /\(atlas\) stamped core: [0-9a-f]{7} -> [0-9a-f]{7}/.test(h.out), h.out);
  check('h. verifiedAt is now HEAD', readManifest(A).sections.find((s) => s.slug === 'core').verifiedAt === c2, readFileSync(manifestPath(A), 'utf8'));
  const h2 = run(['check', '--atlas', atlasA, '--gate']);
  check('h. check turns FRESH after the stamp and --gate passes', h2.status === 0 && /ok\s+FRESH\s+core\b/.test(h2.out), h2.out);

  // stamp --at <sha> pins an explicit commit (and resolves a short sha to the full one).
  const h3 = run(['stamp', '--atlas', atlasA, '--section', 'core', '--at', c1.slice(0, 8)]);
  check('h. stamp --at accepts a short sha', h3.status === 0, h3.out);
  check('h. --at is stored as the resolved full sha', readManifest(A).sections.find((s) => s.slug === 'core').verifiedAt === c1, readFileSync(manifestPath(A), 'utf8'));
  const h4 = run(['check', '--atlas', atlasA]);
  check('h. rolling the stamp back makes the section STALE again', /!!\s+STALE\s+core\b/.test(h4.out), h4.out);
  run(['stamp', '--atlas', atlasA, '--section', 'core']); // restore to HEAD

  // ---- i. stamp refuses an unknown slug and an unresolvable sha ------------
  const i1 = run(['stamp', '--atlas', atlasA, '--section', 'not-a-section']);
  check('i. stamp on an unknown slug exits 1', i1.status === 1, i1.out);
  check('i. it names the unknown slug and lists the known ones', /unknown section slug: not-a-section.*known slugs: core, documentation/s.test(i1.out), i1.out);
  const i2 = run(['stamp', '--atlas', atlasA, '--section', 'core', '--at', 'deadbee']);
  check('i. stamp with an unresolvable sha exits 1', i2.status === 1, i2.out);
  check('i. the manifest is untouched by the refused stamp', readManifest(A).sections.find((s) => s.slug === 'core').verifiedAt === c2, readFileSync(manifestPath(A), 'utf8'));

  // ---- j. unknown sha in the manifest -> STALE with a reason ---------------
  const mj = readManifest(A);
  mj.sections.find((s) => s.slug === 'core').verifiedAt = 'deadbee';
  writeManifest(A, mj);
  const j = run(['check', '--atlas', atlasA]);
  check('j. an unresolvable verifiedAt is STALE, not an error (fail-safe)', j.status === 0, j.out);
  check('j. the reason names the sha', /!!\s+STALE\s+core\s+— verifiedAt 'deadbee' does not resolve to a commit/.test(j.out), j.out);
  const j2 = run(['check', '--atlas', atlasA, '--gate']);
  check('j. --gate fails on the unknown-sha section', j2.status === 1, j2.out);
  writeManifest(A, (() => { const m = readManifest(A); m.sections.find((s) => s.slug === 'core').verifiedAt = c2; return m; })());

  // ---- k. inbox appends the dated line -------------------------------------
  const k = run(['inbox', '--atlas', atlasA, '--note', 'the retry loop in src/app.js is load-bearing']);
  check('k. inbox exits 0', k.status === 0, k.out);
  const inbox = readFileSync(join(atlasA, 'INBOX.md'), 'utf8');
  check('k. the entry is `- <YYYY-MM-DD> <short-sha>: <text>`',
    /^- \d{4}-\d{2}-\d{2} [0-9a-f]{7}: the retry loop in src\/app\.js is load-bearing$/m.test(inbox), inbox);
  run(['inbox', '--atlas', atlasA, '--note', 'second observation']);
  const inbox2 = readFileSync(join(atlasA, 'INBOX.md'), 'utf8');
  check('k. inbox is append-only (both entries present)',
    /: the retry loop/.test(inbox2) && /: second observation$/m.test(inbox2), inbox2);
  const k3 = run(['inbox', '--atlas', atlasA, '--note', '   ']);
  check('k. an empty note is refused (exit 2 — blank flag value)', k3.status === 2, k3.out);
  const k4 = run(['inbox', '--atlas', atlasA, '--note', 'line one\nline two']);
  check('k. a multi-line note is refused (exit 1)', k4.status === 1 && /single line/.test(k4.out), k4.out);

  // ============================================================ B. coverage rule
  // A scope that matches NO tracked file may not launder its top-level segment as mapped:
  // `src/auth/**` covers segment `src` only when such a file actually exists.
  const B = newRepo('coverage');
  put(B, 'src/app.js', 'app\n');
  put(B, 'tools/x.js', 'x\n');
  put(B, 'docs/atlas/sections/auth.md', '# Auth\n');
  writeManifest(B, { version: 1, sections: [{ slug: 'auth', file: 'sections/auth.md', scope: ['src/auth/**'], verifiedAt: '0'.repeat(40) }] });
  const bSha = commit(B, 'init');
  writeManifest(B, { version: 1, sections: [{ slug: 'auth', file: 'sections/auth.md', scope: ['src/auth/**'], verifiedAt: bSha }] });
  const bcov = run(['check', '--atlas', join(B, 'docs', 'atlas')]);
  check('l. a scope matching no tracked file leaves its top segment unmapped',
    /unmapped top-level path 'src'/.test(bcov.out), bcov.out);
  check('l. sibling top-level paths are unmapped too', /unmapped top-level path 'tools'/.test(bcov.out), bcov.out);
  check('l. the atlas own tree IS mapped only if a scope hits it (docs is unmapped here)',
    /unmapped top-level path 'docs'/.test(bcov.out), bcov.out);
  check('l. the empty-scope section is FRESH (nothing in scope can have moved)', /ok\s+FRESH\s+auth\b/.test(bcov.out), bcov.out);
  check('l. unmapped count is 3, exit 0', /1 section\(s\), 0 stale, 3 unmapped\./.test(bcov.out) && bcov.status === 0, bcov.out);

  // Now create the file the scope pointed at: the segment becomes mapped.
  put(B, 'src/auth/token.js', 'token\n');
  commit(B, 'add auth');
  const bcov2 = run(['check', '--atlas', join(B, 'docs', 'atlas')]);
  check('l. once a tracked file matches the scope, its top segment is mapped',
    !/unmapped top-level path 'src'/.test(bcov2.out) && /unmapped top-level path 'tools'/.test(bcov2.out), bcov2.out);

  // ============================================================ C. malformed manifests
  const C = newRepo('malformed');
  put(C, 'src/a.js', 'a\n');
  put(C, 'docs/atlas/sections/one.md', '# One\n');
  writeManifest(C, { version: 1, sections: [] });
  const cSha = commit(C, 'init');
  const atlasC = join(C, 'docs', 'atlas');
  const good = { slug: 'one', file: 'sections/one.md', scope: ['src/**'], verifiedAt: cSha };
  const bad = [
    ['bad JSON', '{ "version": 1, "sections": [ '],
    ['wrong version', { version: 2, sections: [good] }],
    ['sections not an array', { version: 1, sections: {} }],
    ['non-kebab slug', { version: 1, sections: [{ ...good, slug: 'Not_Kebab' }] }],
    ['duplicate slugs', { version: 1, sections: [good, { ...good }] }],
    ['missing section file', { version: 1, sections: [{ ...good, file: 'sections/gone.md' }] }],
    ['section file escaping the atlas dir', { version: 1, sections: [{ ...good, file: '../../src/a.js' }] }],
    ['empty scope', { version: 1, sections: [{ ...good, scope: [] }] }],
    ['pathspec magic in scope', { version: 1, sections: [{ ...good, scope: [':(exclude)src'] }] }],
    ['non-string verifiedAt', { version: 1, sections: [{ ...good, verifiedAt: 12345 }] }],
  ];
  for (const [label, body] of bad) {
    writeManifest(C, body);
    const r1 = run(['check', '--atlas', atlasC]);
    const r2 = run(['stamp', '--atlas', atlasC, '--section', 'one']);
    check(`m. malformed manifest (${label}) exits 1 without --gate`, r1.status === 1, r1.out);
    check(`m. malformed manifest (${label}) is reported MALFORMED`, /!!\s+MALFORMED/.test(r1.out), r1.out);
    check(`m. stamp refuses a malformed manifest (${label})`, r2.status === 1, r2.out);
  }
  writeManifest(C, { version: 1, sections: [good] });
  const cOk = run(['check', '--atlas', atlasC]);
  check('m. the repaired manifest passes', cOk.status === 0 && /ok\s+FRESH\s+one\b/.test(cOk.out), cOk.out);

  // A missing manifest is a fail-closed error too (never "0 sections, all fresh").
  const missing = run(['check', '--atlas', join(C, 'docs', 'no-atlas-here')]);
  check('m. a missing manifest exits 1 naming init', missing.status === 1 && /no MANIFEST\.json/.test(missing.out) && /init/.test(missing.out), missing.out);

  // ============================================================ D. usage errors
  check('n. no subcommand exits 2', run([]).status === 2);
  check('n. an unknown subcommand exits 2', run(['frobnicate', '--atlas', atlasC]).status === 2);
  check('n. an unknown flag exits 2', run(['check', '--atlas', atlasC, '--bogus', 'x']).status === 2);
  check('n. a flag with no value exits 2', run(['check', '--atlas']).status === 2);
  check('n. check without --atlas exits 2', run(['check']).status === 2);
  check('n. stamp without --section exits 2', run(['stamp', '--atlas', atlasC]).status === 2);
  check('n. inbox without --note exits 2', run(['inbox', '--atlas', atlasC]).status === 2);
} finally {
  for (const d of cleanupDirs) {
    try { rmSync(d, { recursive: true, force: true, maxRetries: 3 }); } catch { /* windows file locks — scratch dir, harmless */ }
  }
}

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} atlas-check regression check(s) failed:`);
  for (const f of fails) console.error('  x ' + f);
  process.exit(1);
}
console.log('\nOK — all atlas-check regression checks passed.');
