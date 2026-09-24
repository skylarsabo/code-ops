#!/usr/bin/env node
// Regression eval for the high-severity script-guard fixes (2026-06-23 scripts audit, SCR-001..005).
// Each check asserts the FIXED behavior and fails (exit 1) if a guard regresses. It exercises the
// real, unmodified scripts: the lib-docs helpers directly, revalidate-register / research-manifest
// over child processes against throwaway fixtures. Import samples live in fixtures/*.txt so the
// zero-dependency gate does not scan them as real source.
//
//   node evals/script-guards/run.mjs   (exit 0 = all guards hold)

import { safeFetchUrl, findTypes, readCapped } from '../../scripts/lib-docs.mjs';
import { findThirdPartySpecs } from '../../scripts/check-no-deps.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const FIX = join(HERE, 'fixtures');
const fails = [];
const check = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails.push(name); };
const runNode = (args) => {
  try { return { code: 0, out: execFileSync('node', args, { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') }; }
};

// SCR-002 — safeFetchUrl rejects IPv4-mapped IPv6 (the SSRF bypass)
check('SCR-002 reject [::ffff:127.0.0.1]', safeFetchUrl('https://[::ffff:127.0.0.1]/') === false);
check('SCR-002 reject [::ffff:169.254.169.254]', safeFetchUrl('https://[::ffff:169.254.169.254]/') === false);
check('SCR-002 allow public host', safeFetchUrl('https://example.com/') === true);
check('SCR-002 reject [::1]', safeFetchUrl('https://[::1]/') === false);

const work = mkdtempSync(join(tmpdir(), 'coh-sg-'));
try {
  // SCR-001 — a package `types` value that escapes the package dir is refused (the evil dir has
  // no in-dir type file, so a correct guard returns null rather than reading the out-of-dir secret).
  const evilDir = join(work, 'node_modules', 'evilpkg');
  const goodDir = join(work, 'node_modules', 'goodpkg');
  mkdirSync(evilDir, { recursive: true });
  mkdirSync(goodDir, { recursive: true });
  writeFileSync(join(work, 'secret.d.ts'), 'export const STOLEN = 1;\n'); // outside any package dir
  writeFileSync(join(goodDir, 'index.d.ts'), 'export const ok = 1;\n');
  const evilRes = findTypes({ dir: evilDir, types: '../../secret.d.ts' });
  check('SCR-001 traversal types refused', evilRes === null && evilRes !== join(work, 'secret.d.ts'));
  check('SCR-001 in-dir types resolved', findTypes({ dir: goodDir, types: 'index.d.ts' }) === join(goodDir, 'index.d.ts'));

  // SCR-003 — an escaping citation is classified AMBIGUOUS and gates (non-zero exit)
  const root3 = join(work, 'r3');
  mkdirSync(join(root3, 'etc'), { recursive: true });
  writeFileSync(join(root3, 'etc', 'passwd.js'), 'a\nb\nc\n'); // coincidental in-repo file
  const reg = join(work, 'reg.md');
  writeFileSync(reg, '## BUG-1\nLocation: ../../etc/passwd.js:2\n');
  const r3 = runNode([join(REPO, 'scripts', 'revalidate-register.mjs'), reg, '--root', root3]);
  check('SCR-003 escaping ref classified AMBIGUOUS', /AMBIGUOUS/.test(r3.out));
  check('SCR-003 escaping ref gates (non-zero)', r3.code !== 0);

  // SCR-004 — a URL in the free-text `why` column does NOT whitelist its host
  const man = join(work, 'EGRESS_MANIFEST.md');
  const rm = join(REPO, 'scripts', 'research-manifest.mjs');
  runNode([rm, 'record', '--tool', 'test', '--url', 'https://a.test/x', '--why', 'cross-checked against https://evil.test/leak', '--manifest', man]);
  const art = join(work, 'art.md');
  writeFileSync(art, 'We relied on https://evil.test/leak for this.\n');
  check('SCR-004 why-column URL not whitelisted (undisclosed → non-zero)', runNode([rm, 'validate', art, '--manifest', man]).code !== 0);
  const art2 = join(work, 'art2.md');
  writeFileSync(art2, 'We relied on https://a.test/x for this.\n');
  check('SCR-004 structured url host disclosed (control → zero)', runNode([rm, 'validate', art2, '--manifest', man]).code === 0);

  // SCR-005 / SCR-009 — multiline and dynamic bare imports are caught; node:/relative are not
  check('SCR-005 multiline import caught', findThirdPartySpecs(readFileSync(join(FIX, 'multiline.txt'), 'utf8')).includes('axios'));
  check('SCR-009 dynamic import caught', findThirdPartySpecs(readFileSync(join(FIX, 'dynamic.txt'), 'utf8')).includes('lodash'));
  check('node/relative imports not flagged', findThirdPartySpecs(readFileSync(join(FIX, 'clean.txt'), 'utf8')).length === 0);

  // --- medium/low fixes (2026-06-23 audit) ---

  // SCR-013 — readCapped enforces the byte cap even when a single chunk exceeds it
  let served = false;
  const bigResp = { body: { getReader: () => ({ read: async () => (served ? { done: true } : (served = true, { done: false, value: new Uint8Array(1024 * 1024) })), cancel: async () => {} }) } };
  check('SCR-013 readCapped caps an oversized chunk', (await readCapped(bigResp, 100)).length <= 100);

  // SCR-011 — empty `description:` (next physical line is another key) is flagged; a real one is not
  const DESC_RE = /^description:[ \t]*\S/m;
  check('SCR-011 empty description not matched', DESC_RE.test('description:\nname: foo') === false);
  check('SCR-011 real description matched', DESC_RE.test('description: Does a thing\nname: foo') === true);

  // SCR-012 — a typo'd key.lineTolerance fails loudly (exit 2), not a silent recall collapse
  const badKey = join(work, 'badkey.json');
  writeFileSync(badKey, JSON.stringify({ repo: '.', planted: [{ id: 'P1', file: 'a.js', line: 1, anchor: 'x' }], lineTolerance: 'three' }));
  const emptyCand = join(work, 'empty.json');
  writeFileSync(emptyCand, '[]');
  check('SCR-012 bad lineTolerance exits 2', runNode([join(REPO, 'evals', 'score.mjs'), badKey, emptyCand]).code === 2);

  // SCR-019 — a non-array candidate gives a clean exit 2, not an unhandled TypeError
  const objCand = join(work, 'obj.json');
  writeFileSync(objCand, JSON.stringify({ file: 'a.js', line: 1 }));
  check('SCR-019 non-array candidate exits 2', runNode([join(REPO, 'evals', 'score.mjs'), join(REPO, 'evals', 'bug-garden', 'ANSWER_KEY.json'), objCand]).code === 2);

  // SCR-016 — an option-like --git range token is rejected before git runs
  const msg = join(work, 'msg.txt');
  writeFileSync(msg, 'a normal commit message\n');
  check('SCR-016 option-like --git token rejected', runNode([join(REPO, 'scripts', 'scan-ai-tells.mjs'), msg, '--git', '--output=x HEAD']).code === 2);

  // SCR-020 — a request with id but no method gets -32600 (Invalid Request), not -32601
  const code = await new Promise((res) => {
    const cp = spawn('node', [join(REPO, 'scripts', 'lib-docs-mcp.mjs')], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const done = (v) => { clearTimeout(t); try { cp.kill(); } catch { /* ignore */ } res(v); };
    const t = setTimeout(() => done(null), 5000);
    cp.stdout.on('data', (d) => {
      out += d;
      for (const ln of out.split('\n')) {
        if (!ln.trim()) continue;
        try { const m = JSON.parse(ln); if (m.id === 1) return done(m.error && m.error.code); } catch { /* partial */ }
      }
    });
    cp.stdin.write('{"jsonrpc":"2.0","id":1}\n'); // no method
  });
  check('SCR-020 missing method maps to -32600', code === -32600);

  // --- remaining audit fixes (2026-06-23) ---

  // SCR-010 — an import written inside a comment is not a false positive; a real import still is
  const realImport = readFileSync(join(FIX, 'multiline.txt'), 'utf8');
  check('SCR-010 import in a line comment not flagged', findThirdPartySpecs('// ' + realImport.replace(/\n/g, ' ')).length === 0);
  check('SCR-010 import in a block comment not flagged', findThirdPartySpecs('/*\n' + realImport + '\n*/').length === 0);
  check('SCR-010 real import still flagged', findThirdPartySpecs(realImport).includes('axios'));

  // SCR-014 — for a multi-ref item, AMBIGUOUS outranks MOVED (label precedence)
  const r14 = join(work, 'r14');
  mkdirSync(join(r14, 'a'), { recursive: true });
  mkdirSync(join(r14, 'b'), { recursive: true });
  writeFileSync(join(r14, 'a', 'dup.js'), 'x\n');
  writeFileSync(join(r14, 'b', 'dup.js'), 'x\n'); // dup.js: 2 files match by name → AMBIGUOUS
  writeFileSync(join(r14, 'only.js'), 'a\nb\n');   // 2 lines → :999 is MOVED
  const reg14 = join(work, 'reg14.md');
  writeFileSync(reg14, '## BUG-1\nLocation: dup.js:1\nLocation: only.js:999\n');
  const out14 = runNode([join(REPO, 'scripts', 'revalidate-register.mjs'), reg14, '--root', r14, '--report-only']).out;
  check('SCR-014 AMBIGUOUS outranks MOVED', /AMBIGUOUS/.test(out14) && !/MOVED/.test(out14));

  // SCR-015 — a slug-style item ID (BUG-042-auth-bypass) is recognized, not dropped
  const reg15 = join(work, 'reg15.md');
  writeFileSync(reg15, '## BUG-042-auth-bypass\nLocation: nope.js:5\n');
  const r15 = runNode([join(REPO, 'scripts', 'revalidate-register.mjs'), reg15, '--root', work]);
  check('SCR-015 slug-style ID recognized + gates', /BUG-042/.test(r15.out) && r15.code !== 0);

  // L-045 — framework route segments ([id], [...slug], [[...opt]], (auth)) and backtick-delimited
  // spaced paths resolve as the whole path. Before the fix the bracket and group citations matched
  // only their tail, gained a restored "/" prefix, and read as escaping root (AMBIGUOUS). The
  // fixture below carries two kinds of same-tail decoy on purpose: `a/Folder/guide.md` and
  // `b/Folder/guide.md` make the bare tail "Folder/guide.md" ambiguous BY NAME (>1 file matches,
  // used by the SH-01/dot-segment shadowing cases), while a literal top-level `Folder/guide.md` (1
  // line, L-045) makes the bare tail exist DIRECTLY but too short — the widen must not stop there.
  const r45 = join(work, 'r45');
  for (const p of ['app/users/[id]/page.tsx', 'app/(auth)/login/route.ts', 'pages/posts/[...slug].tsx',
    'app/[[...opt]]/page.tsx', 'docs/My Folder/guide.md', 'a/Folder/guide.md', 'b/Folder/guide.md', 'scripts/x.mjs',
    'other/nested/My Room/notes.md', '40 Engineering/My Folder/guide.md']) {
    mkdirSync(dirname(join(r45, p)), { recursive: true });
    writeFileSync(join(r45, p), 'l\n'.repeat(20));
  }
  // L-045: a same-tail decoy that also exists, one file shorter than the real spaced target — the
  // widen must prefer the longest real extension (the target), never stop at a shorter real file
  // just because it happens to exist too. Each decoy's line count is picked below its citations'
  // line, so picking the decoy reads MOVED instead of FRESH — the check has teeth.
  for (const [p, n] of [['Folder/guide.md', 1], ['Room/notes.md', 1], ['Engineering/My Folder/guide.md', 6]]) {
    mkdirSync(dirname(join(r45, p)), { recursive: true });
    writeFileSync(join(r45, p), 'l\n'.repeat(n));
  }
  const cases45 = [
    ['BUG-451', 'app/users/[id]/page.tsx:12', 'FRESH', 'L-045 accept unquoted [id] segment'],
    ['BUG-452', 'app/(auth)/login/route.ts:8', 'FRESH', 'L-045 accept unquoted (auth) group'],
    ['BUG-453', '`pages/posts/[...slug].tsx:2`', 'FRESH', 'L-045 accept backticked [...slug] filename'],
    ['BUG-454', '`app/[[...opt]]/page.tsx:2`', 'FRESH', 'L-045 accept backticked [[...opt]] segment'],
    ['BUG-455', '`docs/My Folder/guide.md:3`', 'FRESH', 'L-045 accept spaced path in backticks'],
    ['BUG-456', '(see `app/(auth)/login/route.ts:8`)', 'FRESH', 'L-045 accept group citation inside prose parens'],
    ['BUG-457', '`node scripts/x.mjs:3`', 'FRESH', 'L-045 backticked command keeps its path reading'],
    // R-011 (was AMBIGUOUS, "L-045 unquoted prose is not greedy across spaces"): R-011's sanitized
    // calibration note reported this exact shape — a spaced document name cited unquoted in prose —
    // still reading as gone against a real vault. widenSpacedPath now gives unquoted prose the same
    // backward-widened reading backticks already had, so this is a deliberate, evidenced widening of
    // the assertion below, not a loosened gate: BUG-462..469 (traversal, absolute, and the SH-01/
    // dot-segment shadowing cases) still hold, proving the widen stays fail-closed on every escaping
    // or ambiguous shape it was ever asked to reject.
    ['BUG-461', 'docs/My Folder/guide.md:3', 'FRESH', 'L-045/R-011 accept unquoted spaced path in prose'],
    ['BUG-462', '../x.ts:1', 'AMBIGUOUS', 'L-045 reject ../ traversal'],
    ['BUG-463', './../x.ts:1', 'AMBIGUOUS', 'L-045 reject ./../ traversal'],
    ['BUG-464', '/etc/x.ts:1', 'AMBIGUOUS', 'L-045 reject absolute path'],
    ['BUG-465', '../[id]/page.tsx:1', 'AMBIGUOUS', 'L-045 reject traversal before a bracket segment'],
    ['BUG-466', '`../My Folder/x.md:3`', 'AMBIGUOUS', 'L-045 reject traversal in a spaced backticked path'],
    ['BUG-467', 'v1.2.3:4 and h.io:8080 and 1.1.1.1:53', 'NO-REF', 'L-045 reject version, host:port, IP:port'],
    // SH-01: resolve() collapses the nonexistent "x.ts:1 q" segment and the root's own basename leads
    // back in, so the spaced reading names a real in-root file. It must not swallow the escaping ref.
    ['BUG-468', '`../x.ts:1 q/../r45/docs/My Folder/guide.md:3`', 'AMBIGUOUS', 'L-045 spaced reading cannot swallow an escaping ref (SH-01)'],
    ['BUG-469', '`docs/My Folder/../My Folder/guide.md:3`', null, 'L-045 in-root spaced path with a .. segment stays fail-closed'],
    // R-011 acceptance shapes: the same spaced target read through evidence prose, a Location field
    // already covered by BUG-461, a markdown link target, bold, quotes, and trailing punctuation.
    ['BUG-471', 'Evidence: see docs/My Folder/guide.md:3 for the pattern.', 'FRESH', 'R-011 accept unquoted evidence prose'],
    ['BUG-472', '[guide](docs/My Folder/guide.md:3)', 'FRESH', 'R-011 accept markdown link target (raw space)'],
    ['BUG-473', '**docs/My Folder/guide.md:3**', 'FRESH', 'R-011 accept bold-wrapped spaced path'],
    ['BUG-474', '"docs/My Folder/guide.md:3"', 'FRESH', 'R-011 accept quoted spaced path'],
    ['BUG-475', 'docs/My Folder/guide.md:3, confirms it.', 'FRESH', 'R-011 accept spaced path followed by punctuation'],
    // %20 is left unwidened on purpose: decoding percent-escapes is a distinct concern from the
    // space-token widening this lesson covers, and the un-decoded tail still fails closed (AMBIGUOUS
    // via the bare-basename fallback below), never FRESH.
    ['BUG-476', '[guide](docs/My%20Folder/guide.md:3)', 'AMBIGUOUS', 'R-011 %20 link target stays unwidened (out of scope)'],
    ['BUG-477', 'run node scripts/x.mjs:3 to see it.', 'FRESH', 'R-011 unquoted command-shaped text keeps its direct path reading'],
    // The PR-140 SH-01 shadowing probe, unquoted (the widening's new surface) — must still not
    // swallow the escaping ../x.ts:1 ref into the safe-looking spaced tail.
    ['BUG-478', '../x.ts:1 q/../r45/docs/My Folder/guide.md:3', 'AMBIGUOUS', 'R-011 unquoted SH-01 shadow stays AMBIGUOUS'],
    // A contrived probe: a stray space right after a bare ../ must not let a nearer, shorter cut
    // silently drop the traversal marker and resolve only the text after it.
    ['BUG-479', '../ docs/My Folder/guide.md:3', 'AMBIGUOUS', 'R-011 traversal marker survives a stray space before the widened text'],
    // L-045 (fix, was a bare-tail-decoy tradeoff before widening ran unconditionally): a spaced
    // path whose bare tail also exists elsewhere as a shorter, unrelated file (`Room/notes.md`, 1
    // line) must still resolve to the full, real target (`other/nested/My Room/notes.md`, 20 lines).
    // Line 15 is out of range for the 1-line decoy, so a regression back to the literal-tail-first
    // order would read MOVED here, not FRESH.
    ['BUG-480', 'other/nested/My Room/notes.md:15', 'FRESH', 'L-045/R-011 full path wins over a same-tail decoy'],
    // L-045: the widen used to run only when the literal tail did not already exist, and tried the
    // shortest extension first — so a short decoy at the literal tail (`Folder/guide.md`, 1 line)
    // was taken directly and read MOVED against the citation's real line, instead of widening to the
    // full, real spaced target (`docs/My Folder/guide.md`, 20 lines). Widening now always runs first
    // and tries the longest extension first, so the full path wins in both the backticked and the
    // unquoted form. Line 15 is out of range for the 1-line decoy, so a regression reads MOVED here.
    ['BUG-901', '`docs/My Folder/guide.md:15`', 'FRESH', 'L-045 backticked spaced path beats a shorter same-tail decoy'],
    ['BUG-902', 'docs/My Folder/guide.md:15', 'FRESH', 'L-045 unquoted spaced path beats a shorter same-tail decoy'],
    // L-045: two real nested extensions of the same tail — `Engineering/My Folder/guide.md` (6
    // lines) and the full `40 Engineering/My Folder/guide.md` (20 lines) — the longest candidate is
    // tried first, so the full path wins even though a shorter real file is also reachable. Line 15
    // is out of range for the 6-line file, so picking it instead would read MOVED, not FRESH.
    ['BUG-903', '`40 Engineering/My Folder/guide.md:15`', 'FRESH', 'L-045 longest widened extension wins over a shorter real nested extension'],
  ];
  const reg45 = join(work, 'reg45.md');
  writeFileSync(reg45, cases45.map(([id, loc]) => `## ${id}\nLocation: ${loc}\n`).join('\n'));
  const out45 = runNode([join(REPO, 'scripts', 'revalidate-register.mjs'), reg45, '--root', r45, '--report-only']).out;
  for (const [id, , want, name] of cases45) {
    const line = out45.split('\n').find((l) => new RegExp(`\\b${id}\\b`).test(l)) || '';
    // A null expectation accepts any gating status; it only forbids a FRESH that would hide the item.
    check(name, want ? new RegExp(`\\b${want}\\s+${id}\\b`).test(line) : /^\s*!!\s/.test(line) && !/FRESH/.test(line));
  }

  // PAR-013 — a dot-led first segment starts the citation. Before the fix the match began after the
  // dot, named github/workflows/validate.yml and hidden/x.ts, and read AMBIGUOUS through the
  // same-name decoys. A dot after a word character stays inside the path it already belonged to.
  const r13 = join(work, 'r13');
  for (const p of ['.github/workflows/validate.yml', 'other/validate.yml', '.hidden/x.ts', 'y/x.ts', 'config.github/x.yml']) {
    mkdirSync(dirname(join(r13, p)), { recursive: true });
    writeFileSync(join(r13, p), 'l\n'.repeat(5));
  }
  const cases13 = [
    ['BUG-131', '.github/workflows/validate.yml:1', 'FRESH', 'PAR-013 accept dot-led .github citation'],
    ['BUG-132', 'see .hidden/x.ts:3', 'FRESH', 'PAR-013 accept dot-led hidden directory'],
    ['BUG-133', 'config.github/x.yml:1', 'FRESH', 'PAR-013 dot after a word char keeps its path'],
  ];
  const reg13 = join(work, 'reg13.md');
  writeFileSync(reg13, cases13.map(([id, loc]) => `## ${id}\nLocation: ${loc}\n`).join('\n'));
  const out13 = runNode([join(REPO, 'scripts', 'revalidate-register.mjs'), reg13, '--root', r13, '--report-only']).out;
  for (const [id, , want, name] of cases13) {
    const line = out13.split('\n').find((l) => new RegExp(`\\b${id}\\b`).test(l)) || '';
    check(name, new RegExp(`\\b${want}\\s+${id}\\b`).test(line));
  }

  // L-045 — the widened grammar keeps its non-overlapping structure: long bracket, group, slash, and
  // backtick runs with no valid citation finish fast instead of backtracking without bound. The bare
  // / and ./ runs pin the lookbehind ordering, which once scanned back from every position. PAR-013: the
  // .a run is sized like the a/ run, and the spaced .a run tries the dot-led start at every dot.
  // R-011: widenSpacedPath bounds itself two ways — WIDEN_SCAN_MAX caps the backward char scan per
  // failing match, and WIDEN_MAX_WORDS caps the existsSync attempts, so neither a very long
  // single-token run nor a very long run of one-char "words" ahead of a failing match turns into an
  // unbounded scan or an unbounded number of filesystem calls.
  const reg45p = join(work, 'reg45p.md');
  writeFileSync(reg45p, ['## BUG-470', `Location: ${'[[a]/'.repeat(20000)}x.ts`, `Location: ${'(a)/'.repeat(20000)}x`,
    `Location: ${'[a'.repeat(20000)}.ts:1`, `Location: \`${'a /'.repeat(20000)}.ts:1`, `Location: ${'a/'.repeat(5000)}x`,
    `Location: ${'/'.repeat(80000)}`, `Location: ${'./'.repeat(40000)}`, `Location: ${'.a'.repeat(5000)}`, `Location: ${' .a'.repeat(40000)}`,
    // PAR-003: a long run just ahead of a real citation, once with the escaping char (backslash)
    // first so the backward scan exits on its first step, once with none so it runs its full
    // PATH_SCAN_MAX-bounded walk without ever finding one — bounded either way, not O(block length).
    `Location: ${'\\'.repeat(20000)}x.ts:1`, `Location: ${'/'.repeat(20000)}x.ts:1`,
    // R-011: a long run of one-char space-separated "words" ahead of a failing match (stresses
    // WIDEN_MAX_WORDS), and one very long single unbroken token ahead of a failing match (stresses
    // WIDEN_SCAN_MAX) — both repeated many times over.
    ...Array.from({ length: 4000 }, (_, i) => `Location: ${'w '.repeat(50)}missing${i}.ts:1`),
    ...Array.from({ length: 4000 }, (_, i) => `Location: ${'w'.repeat(4000)}missing${i}.ts:1`),
    ''].join('\n'));
  const t45 = Date.now();
  runNode([join(REPO, 'scripts', 'revalidate-register.mjs'), reg45p, '--root', r45, '--report-only']);
  check('L-045 pathological path input completes under 5s', Date.now() - t45 < 5000);

  // PAR-003 — the SEC-004 prefix restore only recovered a forward-slash traversal prefix. A
  // backslash traversal, a backslash drive-letter citation, or a forward-slash traversal followed
  // by a dot-led or dash-led segment dropped their whole escaping prefix (REF_RE's char class
  // matches neither `\` nor `:`, and a dot/dash right after `/` can't open a fresh match per
  // PAR-013's own lookbehind) and read FRESH against a same-named in-root decoy. Each must read
  // AMBIGUOUS exactly like a plain `../` traversal (SCR-003) does, on every host, not only
  // Windows — the fix detects them directly rather than leaning on resolve()'s win32-only
  // backslash handling. The control proves a genuine in-root citation still reads FRESH.
  const rPar = join(work, 'rpar');
  mkdirSync(rPar, { recursive: true });
  writeFileSync(join(rPar, 'evil.js'), 'l\n'.repeat(20)); // same-named in-root decoy target
  const casesPar = [
    ['PARBUG-001', String.raw`..\x\evil.js:10`, 'AMBIGUOUS', 'PAR-003 reject backslash traversal'],
    ['PARBUG-002', String.raw`C:\x\evil.js:10`, 'AMBIGUOUS', 'PAR-003 reject drive-letter (backslash) citation'],
    ['PARBUG-003', '../.foo/evil.js:10', 'AMBIGUOUS', 'PAR-003 reject traversal + dot-led segment'],
    ['PARBUG-004', '../-foo/evil.js:10', 'AMBIGUOUS', 'PAR-003 reject traversal + dash-led segment'],
    ['PARBUG-005', 'evil.js:1', 'FRESH', 'PAR-003 control: in-root citation stays FRESH'],
    ['PARBUG-007', '..\\' + './'.repeat(2100) + 'evil.js:1', 'AMBIGUOUS', 'PAR-003 reject an escaping prefix longer than the scan window'],
  ];
  const regPar = join(work, 'regpar.md');
  writeFileSync(regPar, casesPar.map(([id, loc]) => `## ${id}\nLocation: ${loc}\n`).join('\n'));
  const outPar = runNode([join(REPO, 'scripts', 'revalidate-register.mjs'), regPar, '--root', rPar, '--report-only']).out;
  for (const [id, , want, name] of casesPar) {
    const line = outPar.split('\n').find((l) => new RegExp(`\\b${id}\\b`).test(l)) || '';
    check(name, new RegExp(`\\b${want}\\s+${id}\\b`).test(line));
  }

  // PAR-003 — a symlink or junction inside root that targets outside root: the literal-path
  // confinement check passes (the citation names a real in-root path), and a plain
  // existsSync/statSync follows the link, so the item read FRESH through the escaping target.
  // Creating a symlink needs privilege this Windows runner may not grant by default — skip ONLY
  // there, and only after confirming the failure is a permission error; a non-Windows host (or a
  // Windows host that actually has the privilege) must run the real check, never pass vacuously.
  const rSym = join(work, 'rsym');
  mkdirSync(rSym, { recursive: true });
  writeFileSync(join(work, 'secret-outside.js'), 's\n'.repeat(20));
  let symlinkErr = null;
  try { symlinkSync(join(work, 'secret-outside.js'), join(rSym, 'link.js'), 'file'); }
  catch (e) { symlinkErr = e; }
  if (!symlinkErr) {
    const regSym = join(work, 'regsym.md');
    writeFileSync(regSym, '## PARBUG-006\nLocation: link.js:1\n');
    const outSym = runNode([join(REPO, 'scripts', 'revalidate-register.mjs'), regSym, '--root', rSym, '--report-only']).out;
    const lineSym = outSym.split('\n').find((l) => /PARBUG-006/.test(l)) || '';
    check('PAR-003 reject symlink resolving outside root', /\bAMBIGUOUS\s+PARBUG-006\b/.test(lineSym));
  } else if (process.platform === 'win32') {
    console.log(`skip  PAR-003 symlink escape (no privilege on win32: ${symlinkErr.code})`);
  } else {
    check(`PAR-003 symlink escape must execute on ${process.platform} CI, not skip (${symlinkErr.code})`, false);
  }

  // SCR-018 — a root-level third-party import is caught by the whole-repo scan
  const sb = join(work, 'sb');
  mkdirSync(join(sb, 'scripts'), { recursive: true });
  copyFileSync(join(REPO, 'scripts', 'check-no-deps.mjs'), join(sb, 'scripts', 'check-no-deps.mjs'));
  const offender = join(sb, 'offender.mjs');
  writeFileSync(offender, readFileSync(join(FIX, 'multiline.txt'), 'utf8')); // root-level bare import
  check('SCR-018 root-level offender caught', runNode([join(sb, 'scripts', 'check-no-deps.mjs')]).code === 1);
  rmSync(offender);
  check('SCR-018 clean sandbox passes', runNode([join(sb, 'scripts', 'check-no-deps.mjs')]).code === 0);

  // SCR-006 — a tools/call still in flight when stdin closes is drained, not dropped
  const drained = await new Promise((res) => {
    const cp = spawn('node', [join(REPO, 'scripts', 'lib-docs-mcp.mjs')], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const fin = (v) => { clearTimeout(t); try { cp.kill(); } catch { /* ignore */ } res(v); };
    const t = setTimeout(() => fin(false), 8000);
    cp.stdout.on('data', (d) => {
      out += d;
      for (const ln of out.split('\n')) { if (!ln.trim()) continue; try { if (JSON.parse(ln).id === 7) return fin(true); } catch { /* partial */ } }
    });
    cp.stdin.write('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get-docs","arguments":{"library":"nope"}}}\n');
    cp.stdin.end(); // close immediately — the drain must still deliver the id:7 response
  });
  check('SCR-006 in-flight response drained on stdin end', drained === true);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// A help request is a success: --help and -h print the usage line to stdout and exit 0, even on
// the scripts whose own parser used to reject it as an unknown flag or ignore it and run the gate.
for (const script of ['preflight', 'repo-map', 'records', 'worker-brief', 'import-graph', 'integrate-branch', 'check-no-deps', 'lint-plugins']) {
  for (const flag of ['--help', '-h']) {
    const r = runNode([join(REPO, 'scripts', `${script}.mjs`), flag]);
    check(`${script} ${flag} exits 0 with usage`, r.code === 0 && r.out.startsWith(`usage: ${script}.mjs`));
  }
}
check('repo-map unknown flag still exits 1', runNode([join(REPO, 'scripts', 'repo-map.mjs'), '--bogus']).code === 1);

if (fails.length) {
  console.error(`\nFAIL — ${fails.length} script-guard regression check(s) failed: ${fails.join(', ')}`);
  process.exit(1);
}
console.log('\nOK — all script-guard regression checks passed.');
