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
// scope, pathspec magic, a moving-ref verifiedAt) even without --gate; stamp moves verifiedAt
// to HEAD (and to an explicit --at) and turns the section FRESH; stamp refuses an unknown slug
// and an unresolvable sha; inbox appends the dated short-sha line and refuses empty/multi-line
// notes; usage errors exit 2. Plus the coverage RULE itself: a scope that matches no tracked
// file may not launder its top-level segment as mapped; the pin SHAPE rule (lowercase hex 7-40
// or the 'unverified' placeholder, which is fail-safe STALE and not MALFORMED); `add`
// registering a STALE-until-stamped section; and working-tree staleness — an uncommitted edit
// to a scoped tracked file is STALE, and reverting it is FRESH again. Plus the two rules that
// keep a verdict honest: the atlas dir is excluded from its own diff and coverage sweep, so a
// section scoped over the atlas (docs/** with the atlas at docs/atlas) can actually converge to
// FRESH while a real edit in scope still flips it; and a scope matching no tracked file is a
// DEAD scope reported STALE rather than a permanent false FRESH. Plus the moving-pin hazard that
// the shape rule alone does NOT catch: a branch NAMED like a sha ('deadbeef') is refused at
// resolution time in both check and stamp, while stamp's default HEAD still resolves; and the
// exclusion-path edge where the atlas dir is the repo root's own parent.
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
  // `documentation` is scoped narrowly to the guide so this fixture's assertions stay about one
  // file; the wide `docs/**` scope that also covers the atlas dir is exercised in F below, where
  // the self-invalidation rule is the point. Working-tree staleness gets scenario E.
  put(A, 'docs/atlas/sections/core.md', '# Core\n\nCharter: the src tree.\n');
  put(A, 'docs/atlas/sections/documentation.md', '# Documentation\n\nCharter: the docs tree.\n');
  writeManifest(A, {
    version: 1,
    sections: [
      { slug: 'core', file: 'sections/core.md', scope: ['src/**'], verifiedAt: '0'.repeat(40) },
      { slug: 'documentation', file: 'sections/documentation.md', scope: ['docs/guide.md'], verifiedAt: '0'.repeat(40) },
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
  // The atlas's own tree is out of the sweep on both sides: `docs` holds nothing but the atlas
  // here, so it is neither mapped nor advised as unmapped.
  check("l. the atlas's own tree is not swept at all (no 'docs' advisory)",
    !/unmapped top-level path 'docs'/.test(bcov.out), bcov.out);
  check('l. a scope matching nothing is a DEAD scope, reported STALE',
    /!!\s+STALE\s+auth\s+— scope matches no tracked file \(dead scope/.test(bcov.out), bcov.out);
  check('l. unmapped count is 2, exit 0 without --gate', /1 section\(s\), 1 stale, 2 unmapped\./.test(bcov.out) && bcov.status === 0, bcov.out);
  check('l. --gate fails on a dead scope', run(['check', '--atlas', join(B, 'docs', 'atlas'), '--gate']).status === 1);

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
    // Moving refs are fail-CLOSED, not fail-safe STALE: a pin that re-resolves on every run can
    // never report stale, so the manifest lies rather than ages.
    ['moving-ref verifiedAt (HEAD)', { version: 1, sections: [{ ...good, verifiedAt: 'HEAD' }] }],
    ['moving-ref verifiedAt (@)', { version: 1, sections: [{ ...good, verifiedAt: '@' }] }],
    // `main` is caught by the SHAPE rule (not hex). The hex-NAMED ref ('deadbeef') passes shape
    // and is caught by the RESOLUTION rule instead — scenario H below. Two separate rules, both
    // pinned, because either one alone leaves a moving pin reachable.
    ['moving-ref verifiedAt (branch)', { version: 1, sections: [{ ...good, verifiedAt: 'main' }] }],
    ['uppercase-hex verifiedAt', { version: 1, sections: [{ ...good, verifiedAt: 'DEADBEEF' }] }],
    ['too-short verifiedAt', { version: 1, sections: [{ ...good, verifiedAt: good.verifiedAt.slice(0, 6) }] }],
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

  // The moving-ref refusal must NAME the rule, not just fail — an author who wrote `HEAD` has to
  // learn why it is not a pin.
  writeManifest(C, { version: 1, sections: [{ ...good, verifiedAt: 'HEAD' }] });
  const mv = run(['check', '--atlas', atlasC]);
  check('o. the moving-ref refusal names the shape rule and the placeholder',
    mv.status === 1 && /lowercase hex, 7-40 chars/.test(mv.out) && /'unverified'/.test(mv.out), mv.out);
  check('o. the moving-ref refusal explains the hazard (a moving ref never goes stale)',
    /moving ref/.test(mv.out) && /never be reported stale/.test(mv.out), mv.out);

  // The one designated placeholder is fail-SAFE, not a schema violation: an unstamped section is
  // an honest STALE, not a broken manifest.
  writeManifest(C, { version: 1, sections: [{ ...good, verifiedAt: 'unverified' }] });
  const uv = run(['check', '--atlas', atlasC]);
  check("o. verifiedAt 'unverified' exits 0 and is STALE, not MALFORMED",
    uv.status === 0 && /!!\s+STALE\s+one\b/.test(uv.out) && !/MALFORMED/.test(uv.out), uv.out);
  const uv2 = run(['check', '--atlas', atlasC, '--gate']);
  check("o. --gate fails on an 'unverified' section", uv2.status === 1, uv2.out);

  // The placeholder must never reach rev resolution: a ref NAMED 'unverified' would otherwise
  // resolve and hand every never-stamped section a moving FRESH pin.
  g(C, ['branch', 'unverified']);
  const uv3 = run(['check', '--atlas', atlasC]);
  check("o. a ref named 'unverified' does not make the placeholder resolve",
    uv3.status === 0 && /!!\s+STALE\s+one\s+— never stamped/.test(uv3.out) && !/FRESH\s+one\b/.test(uv3.out), uv3.out);
  const uvStamp = run(['stamp', '--atlas', atlasC, '--section', 'one', '--at', 'unverified']);
  check("o. stamp --at 'unverified' is refused as a category error",
    uvStamp.status === 1 && /never-stamped placeholder, not a rev/.test(uvStamp.err + uvStamp.out), uvStamp.err + uvStamp.out);
  g(C, ['branch', '-D', 'unverified']);

  // A scope living inside the atlas dir is dead by exclusion, and the report must name that
  // cause rather than suggest a typo.
  writeManifest(C, { version: 1, sections: [{ ...good, scope: ['docs/atlas/**'] }] });
  const ia = run(['check', '--atlas', atlasC]);
  check('o. a scope inside the atlas dir names the exclusion as the cause',
    ia.status === 0 && /scope lies inside the atlas directory/.test(ia.out) && !/a typo or a moved tree/.test(ia.out), ia.out);
  writeManifest(C, { version: 1, sections: [good] });

  // ============================================================ E. add + working tree
  const E = newRepo('add');
  put(E, 'src/a.js', 'a\n');
  put(E, 'lib/b.js', 'b\n');
  commit(E, 'init');
  const atlasE = join(E, 'docs', 'atlas');
  run(['init', '--atlas', atlasE]);

  const p1 = run(['add', '--atlas', atlasE, '--section', 'core', '--scope', 'src/**']);
  check('p. add exits 0', p1.status === 0, p1.out);
  const eSec = readManifest(E).sections.find((s) => s.slug === 'core');
  check('p. add appends a schema-valid entry pinned to the placeholder',
    eSec && eSec.file === 'sections/core.md' && JSON.stringify(eSec.scope) === '["src/**"]' && eSec.verifiedAt === 'unverified',
    JSON.stringify(eSec));
  const stub = existsSync(join(atlasE, 'sections', 'core.md')) ? readFileSync(join(atlasE, 'sections', 'core.md'), 'utf8') : '';
  check('p. add writes the section file with a title and a charter placeholder',
    /^# core$/m.test(stub) && /Charter:/.test(stub) && /deliberately leaves out/.test(stub), stub);

  const p2 = run(['check', '--atlas', atlasE]);
  check('p. a freshly added section is STALE until stamped', /!!\s+STALE\s+core\b/.test(p2.out) && p2.status === 0, p2.out);
  check('p. --gate fails on it', run(['check', '--atlas', atlasE, '--gate']).status === 1);

  // Repeatable --scope collects; other flags stay single-valued.
  const p3 = run(['add', '--atlas', atlasE, '--section', 'libs', '--scope', 'lib/**', '--scope', 'src/shared/**']);
  check('p. --scope is repeatable', p3.status === 0
    && JSON.stringify(readManifest(E).sections.find((s) => s.slug === 'libs').scope) === '["lib/**","src/shared/**"]', p3.out);

  const p4 = run(['add', '--atlas', atlasE, '--section', 'core', '--scope', 'src/**']);
  check('p. add refuses a duplicate slug (exit 1)', p4.status === 1 && /already exists/.test(p4.out), p4.out);
  check('p. the refused duplicate did not touch the manifest', readManifest(E).sections.length === 2, readFileSync(manifestPath(E), 'utf8'));

  const p5 = run(['add', '--atlas', atlasE, '--section', 'sneaky', '--scope', ':(exclude)src']);
  check('p. add refuses pathspec magic in --scope (exit 1)', p5.status === 1 && /pathspec magic/.test(p5.out), p5.out);
  check('p. the refused scope created no section file and no entry',
    readManifest(E).sections.length === 2 && !existsSync(join(atlasE, 'sections', 'sneaky.md')), readFileSync(manifestPath(E), 'utf8'));

  // stamp alone is mechanically enough to turn an added section FRESH.
  run(['stamp', '--atlas', atlasE, '--section', 'core']);
  run(['stamp', '--atlas', atlasE, '--section', 'libs']);
  const p6 = run(['check', '--atlas', atlasE]);
  check('p. stamping an added section turns it FRESH', /ok\s+FRESH\s+core\b/.test(p6.out) && p6.status === 0, p6.out);

  // ---- q. working-tree staleness (uncommitted edits count) ------------------
  writeFileSync(join(E, 'src', 'a.js'), 'a2\n');
  const q1 = run(['check', '--atlas', atlasE]);
  check('q. an UNCOMMITTED edit to a scoped tracked file flips FRESH -> STALE',
    /!!\s+STALE\s+core\s+— 1 scoped path\(s\) changed since [0-9a-f]{7}: src\/a\.js/.test(q1.out), q1.out);
  check('q. the message says changed-since, not committed-since', !/committed/.test(q1.out), q1.out);
  writeFileSync(join(E, 'src', 'a.js'), 'a\n');
  const q2 = run(['check', '--atlas', atlasE]);
  check('q. reverting the edit flips it back to FRESH', /ok\s+FRESH\s+core\b/.test(q2.out) && q2.status === 0, q2.out);

  // An UNTRACKED file is outside git's diff by construction — the documented boundary.
  put(E, 'src/untracked.js', 'new\n');
  const q3 = run(['check', '--atlas', atlasE]);
  check('q. an untracked file in scope does not make the section stale', /ok\s+FRESH\s+core\b/.test(q3.out), q3.out);
  rmSync(join(E, 'src', 'untracked.js'), { force: true });

  // ---- r. a free-text note may begin with a flag-shaped token ---------------
  const r1 = run(['inbox', '--atlas', atlasE, '--note', '--gate is load-bearing in the closing phase']);
  check('r. a note starting with a flag-shaped token is accepted', r1.status === 0, r1.out);
  check('r. it is appended verbatim',
    /^- \d{4}-\d{2}-\d{2} [0-9a-f]{7}: --gate is load-bearing in the closing phase$/m.test(readFileSync(join(atlasE, 'INBOX.md'), 'utf8')),
    readFileSync(join(atlasE, 'INBOX.md'), 'utf8'));
  // The exemption is scoped to --note: a flag-shaped value for a path/slug flag is still refused.
  // This must exercise the `v.startsWith('--') && !FREE_TEXT_FLAGS.has(a)` branch, not the
  // missing-value one — so the flag-shaped value has to be a token cmdCheck does NOT strip
  // (`--gate` is filtered out positionally before parseFlags ever sees it, which would make this
  // a plain missing-value rejection and prove nothing about the exemption).
  const r2 = run(['check', '--atlas', '--root', 'x']);
  check('r. a flag-shaped value for a non-free-text flag is refused (exit 2)',
    r2.status === 2 && /--atlas needs a value/.test(r2.out), r2.out);
  const r3 = run(['inbox', '--atlas', atlasE, '--note', 'a\nb']);
  check('r. a flag-shaped exemption does not bypass the single-line rule', r3.status === 1 && /single line/.test(r3.out), r3.out);

  // ============================================================ F. self-invalidation
  // The atlas lives INSIDE a scope (atlas at docs/atlas, section scoped `docs/**`). Every stamp
  // rewrites MANIFEST.json under docs/atlas, so without excluding the atlas dir from the diff the
  // section is made stale by the very write meant to freshen it and can never read FRESH.
  const F = newRepo('selfinv');
  put(F, 'docs/guide.md', '# guide\n');
  put(F, 'src/a.js', 'a\n');
  const atlasF = join(F, 'docs', 'atlas');
  run(['init', '--atlas', atlasF]);
  run(['add', '--atlas', atlasF, '--section', 'documentation', '--scope', 'docs/**']);
  run(['add', '--atlas', atlasF, '--section', 'core', '--scope', 'src/**']);
  commit(F, 'init with atlas');
  run(['stamp', '--atlas', atlasF, '--section', 'documentation']);
  const s1 = run(['check', '--atlas', atlasF]);
  check('s. a section whose scope covers the atlas dir reaches FRESH after a stamp',
    /ok\s+FRESH\s+documentation\b/.test(s1.out), s1.out);
  // Stamping a SIBLING section rewrites the same MANIFEST.json — still inside `docs/**`.
  run(['stamp', '--atlas', atlasF, '--section', 'core']);
  const s2 = run(['check', '--atlas', atlasF, '--gate']);
  check('s. it stays FRESH after a sibling stamp rewrites the manifest under its scope',
    s2.status === 0 && /ok\s+FRESH\s+documentation\b/.test(s2.out), s2.out);
  // The exclusion is surgical: a real file in the scope still flips it.
  writeFileSync(join(F, 'docs', 'guide.md'), '# guide v2\n');
  const s3 = run(['check', '--atlas', atlasF]);
  check('s. a real edit inside the scope still flips it STALE',
    /!!\s+STALE\s+documentation\s+— 1 scoped path\(s\) changed since [0-9a-f]{7}: docs\/guide\.md/.test(s3.out), s3.out);
  check('s. and the manifest path is NOT among the triggering paths', !/MANIFEST\.json/.test(s3.out), s3.out);

  // ============================================================ G. dead scope repair
  const G = newRepo('deadscope');
  put(G, 'src/auth/token.js', 'token\n');
  put(G, 'docs/atlas/sections/auth.md', '# Auth\n');
  writeManifest(G, { version: 1, sections: [{ slug: 'auth', file: 'sections/auth.md', scope: ['srcc/auth/**'], verifiedAt: '0'.repeat(40) }] });
  const gSha = commit(G, 'init');
  const atlasG = join(G, 'docs', 'atlas');
  writeManifest(G, { version: 1, sections: [{ slug: 'auth', file: 'sections/auth.md', scope: ['srcc/auth/**'], verifiedAt: gSha }] });
  const t1 = run(['check', '--atlas', atlasG]);
  check('t. a typo\'d scope reads STALE naming the dead scope, not FRESH',
    /!!\s+STALE\s+auth\s+— scope matches no tracked file \(dead scope: a typo or a moved tree; re-scope and re-stamp\)/.test(t1.out), t1.out);
  check('t. --gate fires on it', run(['check', '--atlas', atlasG, '--gate']).status === 1);
  check('t. it is a per-section trust failure, not a manifest schema violation',
    t1.status === 0 && !/MALFORMED/.test(t1.out), t1.out);
  // Repair: fix the scope and re-stamp -> FRESH.
  writeManifest(G, { version: 1, sections: [{ slug: 'auth', file: 'sections/auth.md', scope: ['src/auth/**'], verifiedAt: gSha }] });
  run(['stamp', '--atlas', atlasG, '--section', 'auth']);
  const t2 = run(['check', '--atlas', atlasG, '--gate']);
  check('t. re-scoping and re-stamping turns it FRESH', t2.status === 0 && /ok\s+FRESH\s+auth\b/.test(t2.out), t2.out);

  // ============================================================ H. hex-named ref pin
  // The shape rule only proves a value LOOKS like an object name. `git branch deadbeef` makes a
  // REF whose name passes it, and rev-parse prefers refs over abbreviated object names — so the
  // pin would follow the branch and the section would read FRESH forever. Caught at RESOLUTION
  // (the full sha must extend the given value), fail-closed like any other moving pin.
  const H = newRepo('hexref');
  put(H, 'src/a.js', 'a\n');
  put(H, 'docs/atlas/sections/one.md', '# One\n');
  writeManifest(H, { version: 1, sections: [] });
  const hSha = commit(H, 'init');
  const atlasH = join(H, 'docs', 'atlas');
  const hGood = { slug: 'one', file: 'sections/one.md', scope: ['src/**'], verifiedAt: hSha };
  g(H, ['branch', 'deadbeef']);

  writeManifest(H, { version: 1, sections: [{ ...hGood, verifiedAt: 'deadbeef' }] });
  const u1 = run(['check', '--atlas', atlasH]);
  check('u. a hex-NAMED branch as verifiedAt exits 1 (fail-closed, not FRESH)', u1.status === 1, u1.out);
  check('u. it is reported MALFORMED, naming the ref/moving-pin hazard',
    /!!\s+MALFORMED\s+sections\[0\]\.verifiedAt "deadbeef" looks like an object name but resolves to a REF/.test(u1.out)
    && /could never be reported stale/.test(u1.out), u1.out);
  check('u. it is not silently FRESH', !/FRESH/.test(u1.out), u1.out);
  // The corresponding write path refuses too, so the hazard cannot be stamped in.
  const u2 = run(['stamp', '--atlas', atlasH, '--section', 'one', '--at', 'deadbeef']);
  check('u. stamp --at on a hex-named branch is refused (exit 1)', u2.status === 1, u2.out);
  check('u. the refusal names the same rule', /refusing to stamp: --at "deadbeef" looks like an object name but resolves to a REF/.test(u2.out), u2.out);
  check('u. the refused stamp left verifiedAt untouched', readManifest(H).sections[0].verifiedAt === 'deadbeef', readFileSync(manifestPath(H), 'utf8'));

  // The guard is scoped to sha-CLAIMED values: stamp's default HEAD is legitimately symbolic and
  // still resolves normally.
  const u3 = run(['stamp', '--atlas', atlasH, '--section', 'one']);
  check('u. the default HEAD stamp is unaffected by the guard', u3.status === 0 && readManifest(H).sections[0].verifiedAt === hSha, u3.out);

  // With the ref gone, 'deadbeef' is no longer resolvable at all in this repo, so the value falls
  // through to the ordinary fail-SAFE path: STALE with a reason, exit 0 without --gate. (It would
  // only be a true abbreviated object name if a commit's sha happened to start with those 8 hex
  // digits, which no fixture commit does.)
  g(H, ['branch', '-D', 'deadbeef']);
  writeManifest(H, { version: 1, sections: [{ ...hGood, verifiedAt: 'deadbeef' }] });
  const u4 = run(['check', '--atlas', atlasH]);
  check('u. once the ref is deleted the same value is STALE-unresolvable, not MALFORMED',
    u4.status === 0 && /!!\s+STALE\s+one\s+— verifiedAt 'deadbeef' does not resolve to a commit/.test(u4.out) && !/MALFORMED/.test(u4.out), u4.out);

  // ============================================================ I. atlas as the root's parent
  // relative() returns exactly '..' (no trailing slash) when the atlas dir IS the repo root's
  // parent. That is outside the repo, so no self-exclusion is needed or possible; handing git
  // `:(exclude)..` instead makes it bail out with a fatal.
  const P = mkdtempSync(join(tmpdir(), 'atlas-parent-'));
  cleanupDirs.push(P);
  const PR = join(P, 'repo');
  mkdirSync(PR, { recursive: true });
  g(PR, ['-c', 'init.defaultBranch=main', 'init', '-q']);
  g(PR, ['config', 'user.name', 'Atlas Eval']);
  g(PR, ['config', 'user.email', 'atlas-eval@example.invalid']);
  g(PR, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(PR, 'a.js'), 'a\n');
  mkdirSync(join(PR, 'src'), { recursive: true });
  writeFileSync(join(PR, 'src', 'b.js'), 'b\n');
  g(PR, ['add', '-A']);
  g(PR, ['commit', '-q', '-m', 'init']);
  const pSha = g(PR, ['rev-parse', 'HEAD']).trim();
  mkdirSync(join(P, 'sections'), { recursive: true });
  writeFileSync(join(P, 'sections', 'one.md'), '# One\n');
  writeFileSync(join(P, 'MANIFEST.json'),
    JSON.stringify({ version: 1, sections: [{ slug: 'one', file: 'sections/one.md', scope: ['src/**'], verifiedAt: pSha }] }, null, 2) + '\n');
  const v1 = run(['check', '--atlas', P, '--root', PR]);
  check('v. an atlas dir at the repo root\'s parent runs without a git fatal', !/fatal:/.test(v1.out), v1.out);
  check('v. the exclusion is skipped and the section still gets a real verdict',
    v1.status === 0 && /ok\s+FRESH\s+one\b/.test(v1.out), v1.out);
  check('v. the coverage sweep still runs (the root\'s own files are swept)',
    /unmapped top-level path 'a\.js'/.test(v1.out), v1.out);

  // ============================================================ D. usage errors
  check('n. no subcommand exits 2', run([]).status === 2);
  check('n. an unknown subcommand exits 2', run(['frobnicate', '--atlas', atlasC]).status === 2);
  check('n. an unknown flag exits 2', run(['check', '--atlas', atlasC, '--bogus', 'x']).status === 2);
  check('n. a flag with no value exits 2', run(['check', '--atlas']).status === 2);
  check('n. check without --atlas exits 2', run(['check']).status === 2);
  check('n. stamp without --section exits 2', run(['stamp', '--atlas', atlasC]).status === 2);
  check('n. inbox without --note exits 2', run(['inbox', '--atlas', atlasC]).status === 2);
  check('n. add without --scope exits 2', run(['add', '--atlas', atlasC, '--section', 'two']).status === 2);
  check('n. add without --section exits 2', run(['add', '--atlas', atlasC, '--scope', 'src/**']).status === 2);
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
