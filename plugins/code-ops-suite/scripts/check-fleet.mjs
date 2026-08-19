#!/usr/bin/env node
// Fleet conformance checker for the code-ops suite — the multi-repo standard
// (docs/techniques/fleet-standard.md). Runs against a FLEET.json manifest.
//
//   node scripts/check-fleet.mjs <FLEET.json>
//
// WHY: every skill in the suite operates on one repo. An operator standardizing several
// repos has no way to ask the question this checker answers — which members are on the
// standard, and how far out each one sits — without visiting them one at a time and
// holding the comparison in their head.
//
// Membership is TWO-SIDED, and that is the load-bearing rule. The manifest names a repo,
// and the repo consents by carrying the phrase `fleet member: yes` in a `## Fleet` section
// of its own standards contract. A named repo that has not consented is reported and never
// operated on, which is why declining costs a repo nothing: it does nothing. This checker
// only reads, so it cannot violate the rule itself, but it is the component that DEFINES
// consent for every fleet operation downstream, and a fleet run that could write the phrase
// it then reads would have a formality rather than a consent rule.
//
// Fail-CLOSED, the same trust position as check-vault-standard.mjs: a member path that does
// not resolve, a contract that cannot be read, or a vault check that could not run reports
// UNKNOWN, and UNKNOWN fails the run for a consenting member. A check that did not execute
// proves nothing.
//
// OUTPUT is the CONFORMANCE_REPORT.md surface-row grammar of
// docs/techniques/artifact-grammars.md, section (d): | surface | verdict | checker | evidence |.
// calibration-metrics.mjs therefore ingests a fleet report with no parser change. That grammar
// counts a REPEATED surface cell as unparseable, so each row's surface cell is the member's
// kebab slug joined to the surface name (`ripper-vault`), and two members whose slugs collide
// are a manifest-shape error rather than a silently-dropped row.
//
// SURFACES, per member:
//   <slug>-consent   CONFORMANT when the contract carries the phrase, ABSENT otherwise.
//                    ABSENT is NOT a failure — it is the repo exercising the consent rule.
//                    A non-consenting member gets this row and no others: the remaining
//                    surfaces describe a repo this run has no mandate over.
//   <slug>-contract  The contract pair exists and matches one accepted parity mode:
//                    byte-identical copies, or a short pointer file naming the substantive
//                    one as required reading (docs/techniques/vault-standard.md, Host parity).
//   <slug>-vault     `<repo>-docs/` exists and check-vault-standard.mjs exits 0 against it.
//                    ABSENT is advisory, never a failure: vault adoption stays voluntary
//                    (decision D-002), so a fleet must not enforce what a repo may decline.
//
// Exit: 0 conformant; 1 a manifest-shape error or a consenting member failing a surface;
//       2 usage error.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// The vault checker ships beside this one in both trees — the repo-root scripts/ and every
// plugin's vendored scripts/ — so resolving it as a sibling works from either invocation root.
const VAULT_CHECKER = join(HERE, 'check-vault-standard.mjs');

const MANIFEST_VERSION = 1;
const MEMBER_KEYS = new Set(['path', 'profile', 'roles']);
const CONSENT_PHRASE = 'fleet member: yes';
const CONTRACT_FILES = ['CLAUDE.md', 'AGENTS.md'];
// A pointer file is short by construction: it names the substantive contract as required
// reading and stops. The cap is generous enough for a real pointer and far below any
// substantive contract, so a pair that has genuinely DRIFTED cannot pass as a pointer pair.
const POINTER_MAX_LINES = 40;
// A pointer names the file it defers to in its FIRST PARAGRAPH — the opening run of non-blank
// body lines. A file that mentions the other name below that is discussing it, not pointing at
// it. A paragraph rather than a fixed line count: a real pointer may open with a sentence or two
// of preamble before the pointing sentence, and a three-line window reported that legitimate
// pointer DRIFTED.
// A pointer must SAY that the file it names is binding. Accepting any short file that merely
// mentions the other name would pass a stub that says nothing, which is the fail-open case.
const REQUIRED_READING = /required reading|canonical contract|read (?:it|this|that) first/i;

function usage() {
  console.error('usage: check-fleet.mjs <FLEET.json>');
  process.exit(2);
}

// ---- manifest shape --------------------------------------------------------------
// Every violation here aborts before a single member is touched. A manifest the checker
// half-understands is the one input that could send a fleet operation at the wrong repo.
const shapeErrors = [];
const shapeFail = (m) => shapeErrors.push(m);

// Kebab slug for the surface cell. Grammar (d) accepts /[a-z0-9]+(-[a-z0-9]+)*/, so anything
// outside that alphabet folds to a hyphen and runs collapse. An empty result is refused rather
// than emitted, because a row with no surface cell is unparseable at the far end.
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// The evidence cell is free text inside a pipe-delimited row, so a pipe in a checker message
// would split the row and make it unparseable. Newlines collapse for the same reason.
const cell = (s) => String(s).replace(/[|]/g, '/').replace(/\s*\r?\n\s*/g, ' ').trim();

const argv = process.argv.slice(2);
if (argv.length !== 1 || argv[0].startsWith('-')) usage();
const manifestPath = resolve(argv[0]);
if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
  console.error(`x not a file: ${manifestPath}`);
  process.exit(2);
}
const workspace = dirname(manifestPath);

let manifest = null;
let parsed = false;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  parsed = true;
} catch (e) {
  shapeFail(`manifest is not valid JSON: ${e.message}`);
}

const members = [];
if (parsed) {
  // `parsed` rather than a null test: JSON `null` is a successful parse of a manifest that is
  // not an object, and treating it as "nothing to say" would exit 0 on an empty fleet file.
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest))
    shapeFail('manifest is not a JSON object');
  else {
    if (manifest.version !== MANIFEST_VERSION)
      shapeFail(`manifest \`version\` is ${JSON.stringify(manifest.version)}, not ${MANIFEST_VERSION} — a manifest of an unknown version is refused rather than guessed at`);
    if (!Array.isArray(manifest.members))
      shapeFail('manifest `members` is not an array');
    else if (manifest.members.length === 0)
      shapeFail('manifest `members` is empty — a fleet of no repos has nothing to check');
    else {
      const seenSlug = new Map();
      const seenPath = new Map();
      manifest.members.forEach((raw, i) => {
        const at = `members[${i}]`;
        if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
          shapeFail(`${at} is not an object`);
          return;
        }
        for (const k of Object.keys(raw))
          if (!MEMBER_KEYS.has(k))
            shapeFail(`${at} carries unknown key \`${k}\` — an ignored key is how a typo in \`profile\` becomes an unenforced claim`);
        if (typeof raw.path !== 'string' || raw.path.trim() === '') {
          shapeFail(`${at} has no non-empty \`path\``);
          return;
        }
        if (typeof raw.profile !== 'string' || raw.profile.trim() === '')
          shapeFail(`${at} has no non-empty \`profile\``);
        if (!Array.isArray(raw.roles) || raw.roles.some((r) => typeof r !== 'string'))
          shapeFail(`${at} \`roles\` is not an array of strings`);
        const abs = resolve(workspace, raw.path);
        const slug = slugify(basename(abs));
        if (slug === '') {
          shapeFail(`${at} path '${raw.path}' yields an empty surface slug — name the member directory in letters or digits`);
          return;
        }
        if (seenSlug.has(slug))
          shapeFail(`${at} path '${raw.path}' and ${seenSlug.get(slug)} both slug to '${slug}' — the report needs one surface cell per member, so a collision would drop a member's rows`);
        else seenSlug.set(slug, at);
        if (seenPath.has(abs))
          shapeFail(`${at} repeats the path already listed by ${seenPath.get(abs)}`);
        else seenPath.set(abs, at);
        members.push({ at, dir: abs, slug, declared: raw.path, profile: raw.profile });
      });
    }
  }
}

if (shapeErrors.length) {
  for (const e of shapeErrors) console.log(`  !!  MANIFEST  ${e}`);
  console.log(`\n${shapeErrors.length} manifest-shape error(s) in ${manifestPath}. No member was checked.`);
  process.exit(1);
}

// ---- per-member surfaces ---------------------------------------------------------
const rows = [];
let failures = 0;
// A surface fails the run only for a CONSENTING member, and only on these verdicts. ABSENT is
// deliberately outside the set: it is the verdict for a repo declining consent and for a repo
// carrying no vault, and both are legitimate states this checker reports rather than punishes.
const FAILING = new Set(['DRIFTED', 'UNKNOWN']);
function row(member, surface, verdict, checker, evidence, { counts = true } = {}) {
  rows.push(`| ${member.slug}-${surface} | ${verdict} | ${checker} | ${cell(evidence)} |`);
  if (counts && FAILING.has(verdict)) failures += 1;
}

function readContract(dir) {
  const found = {};
  for (const f of CONTRACT_FILES) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    try { found[f] = readFileSync(p, 'utf8'); }
    catch (e) { found[f] = null; found[`${f}:error`] = e.message; }
  }
  return found;
}

// ---- one fence state machine, three consumers -------------------------------------
// Everything that reads a contract as markdown reads it through here, so heading detection,
// consent matching, and the pointer test cannot disagree about what a fence is. They did
// disagree before: the consent matcher stripped fences and the section scanner did not, so a
// `## Fleet` written INSIDE an example fence closed the real section and hid a genuine consent.
//
// THE RULE SET, stated once here and mirrored in docs/techniques/fleet-standard.md. Every
// markdown shape this checker recognizes is decided in this function and nowhere else, which
// is what stops the consent matcher and the section scanner from disagreeing again. A yielded
// line is `code` when markdown would render it verbatim; a `code` line is never markup, never a
// heading, and never consent.
//
// Containers first, leaf blocks second, which is CommonMark's own order:
//   - A uniform blockquote prefix (`>` markers, each with an optional space) is stripped before
//     any leaf test. A blockquoted fence therefore opens a block exactly as a bare one does.
//
// Fenced blocks (CommonMark 4.5):
//   - A line whose first non-whitespace run is three or more backticks or three or more
//     tildes OPENS a fenced block.
//   - The block CLOSES at a later line whose fence uses the SAME character, is at least as
//     long as the opener, and carries nothing but whitespace after it.
//   - An UNTERMINATED fence suppresses to the end of the input. Reading the rest of a file as
//     markup after an opened fence is the fail-open direction: it would let unclosed example
//     text enroll the repo.
//   - The opening and closing fence lines are themselves inside the block. Neither is markup.
//
// Indented code blocks (CommonMark 4.4):
//   - A line indented four or more spaces, or by a tab, is code WHERE such a block can begin:
//     after a blank line, at the start of the input, or after another indented-code line.
//     Four spaces after a line of prose is a lazy paragraph continuation, not code.
//   - No indented block begins while a list is open, because there the same indent is list
//     content. A list opens at a bullet or ordered marker and closes at the next non-blank
//     line indented less than four spaces that is not itself a marker.
//   - Two or three spaces of indent are decoration, not code. That is the boundary the
//     consent matcher's tolerated prefix is cut to, so the two agree by construction.
//
// Deliberately not implemented: a backtick opener's ban on backticks in its info string, which
// would only ever suppress MORE text, and the checker's safe direction is to suppress.
// One or more `>`, never zero: a `*` here would also match the empty prefix and strip the
// leading whitespace off every ordinary line, which would hide every indented code block.
const QUOTE_PREFIX = /^ {0,3}(?:>[ \t]?)+/;
const FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/;
const INDENTED_CODE = /^(?: {4,}|\t)/;
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;

function* markdownLines(text) {
  let char = null;
  let len = 0;
  let prevBlank = true;
  let prevCode = false;
  let listOpen = false;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(QUOTE_PREFIX, '');
    const blank = line.trim() === '';
    const indented = INDENTED_CODE.test(line);
    // An open indented block wins over a fence opener, per CommonMark: a fence marker inside
    // indented code is content. Testing the fence first would open a block that never closes
    // and suppress the real consent line below it — a silent false decline.
    if (char === null && !blank && indented && !listOpen && (prevBlank || prevCode)) {
      yield { line: raw, code: true };
      prevCode = true;
      prevBlank = false;
      continue;
    }
    const m = FENCE.exec(line);
    if (char !== null) {
      if (m && m[1][0] === char && m[1].length >= len && m[2].trim() === '') char = null;
      yield { line: raw, code: true };
      prevBlank = false;
      prevCode = false;
      continue;
    }
    if (m) {
      char = m[1][0];
      len = m[1].length;
      yield { line: raw, code: true };
      prevBlank = false;
      prevCode = false;
      continue;
    }
    // Everything reaching here is blank, or markup: the indented-code branch above already
    // took every line that starts or continues an indented block.
    if (!blank && !indented) listOpen = LIST_MARKER.test(line);
    yield { line: raw, code: false };
    // A blank line neither starts nor ends an indented block, so `prevCode` survives it.
    if (!blank) prevCode = false;
    prevBlank = blank;
  }
}

// Consent is the phrase inside a `## Fleet` section, not the phrase anywhere in the file. A
// contract that discusses the fleet rule in prose — this repo's own does — must not thereby
// enroll itself. The section runs from its heading to the next UNFENCED heading of the same
// level or higher, so a phrase in a later section does not count either.
//
// The heading test trims a closed-ATX heading's trailing hashes (`## Fleet ##`). That form
// fails in the safe direction — the section is never entered, so the repo is skipped rather
// than operated on — but it makes a genuinely enrolled repo invisible, and the operator's
// only signal is a row that reads like a deliberate decline.
//
// Returns the section's lines with their code state, not a joined string: the consent test
// needs to know which of them are code.
function consentSection(text) {
  let inside = false;
  const body = [];
  for (const entry of markdownLines(text)) {
    if (!entry.code) {
      const h = /^(#{1,6})\s+(.*)$/.exec(entry.line);
      if (h) {
        const level = h[1].length;
        if (inside && level <= 2) break;
        if (!inside && level === 2 && h[2].trim().replace(/\s*#+$/, '').toLowerCase() === 'fleet') { inside = true; continue; }
      }
    }
    if (inside) body.push(entry);
  }
  return inside ? body : null;
}

// Consent is the phrase on a LINE OF ITS OWN, not the phrase anywhere in the section. A
// substring match over the section body inverts the load-bearing rule: a contract that
// documents the rule, or declines it in writing while quoting the phrase it declines, would
// enroll itself. Both are ordinary ways to write a refusal, and consent is what authorizes
// fleet mode to WRITE to a member — so a false positive here authorizes edits to a repo that
// said no in writing. Section-scoping alone does not cover discussion INSIDE the section.
//
// One blockquote or list-bullet marker, and up to three spaces of indent, are allowed before
// the phrase: they are ordinary markdown decoration on a line that is still the repo's own
// assertion. The three-space cap is not arbitrary — it is the indented-code boundary the line
// stream enforces above, so a four-space indent is presentation the stream has already called
// code, and this pattern cannot disagree with it. A CODE line never counts, wherever it sits,
// because a code block is how a contract SHOWS the phrase without saying it. Matching is
// case-insensitive, which the `beta` fixture pins.
const CONSENT_LINE = /^ {0,3}(?:[>*-][ \t]*)?fleet member:[ \t]*yes[ \t]*$/i;

const hasConsent = (text) => {
  const section = consentSection(text);
  return section !== null && section.some((e) => !e.code && CONSENT_LINE.test(e.line));
};

// Parity mode, per docs/techniques/vault-standard.md "Host parity": byte-identical copies, or a
// pointer pair where the short file names the substantive one as required reading. Anything
// else is two contracts that have drifted, which is invisible to whichever host reads the other.
function parityMode(found) {
  const present = CONTRACT_FILES.filter((f) => typeof found[f] === 'string');
  if (present.length < CONTRACT_FILES.length) return { verdict: 'ABSENT', why: `contract pair incomplete — present: ${present.join(', ') || 'neither file'}` };
  const [a, b] = CONTRACT_FILES.map((f) => found[f]);
  if (a === b) return { verdict: 'CONFORMANT', why: 'parity mode: byte-identical pair' };
  const shortName = a.split('\n').length <= b.split('\n').length ? CONTRACT_FILES[0] : CONTRACT_FILES[1];
  const otherName = shortName === CONTRACT_FILES[0] ? CONTRACT_FILES[1] : CONTRACT_FILES[0];
  const short = found[shortName];
  const other = found[otherName];
  // A pointer is a file that is SUBSTANTIALLY nothing but the pointer, which takes three
  // tests, not one length cap. Length alone would call any short file a pointer, and a
  // substantive contract that happens to be short and to open by naming its twin — "`CLAUDE.md`
  // is a generated copy of this file; this is required reading" — would be read as a stub and
  // reported DRIFTED. So: short, saying the named file is binding, naming it in its first
  // paragraph rather than in passing, and carrying no heading of its own AT ANY DEPTH. A
  // `## Fleet` heading is the one exception, because consent must be readable from either half
  // of the pair — and a `###` subheading under it is a section of the pointer's own, so it is
  // refused like any other.
  const isPointer = (t, names) => {
    if (t.split('\n').length > POINTER_MAX_LINES) return false;
    if (!t.includes(names) || !REQUIRED_READING.test(t)) return false;
    const lead = [];
    let leadClosed = false;
    const headings = [];
    for (const { line, code } of markdownLines(t)) {
      if (code) continue;
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        if (h[1].length >= 2) headings.push(h[2].trim().replace(/\s*#+$/, '').toLowerCase());
        continue;
      }
      // Blank lines, headings, and the consent line are markup and enrollment, not contract
      // body. A pointer's body IS the pointer, so the named file has to be in its first
      // paragraph — the opening run of body lines, which the first blank line below them ends.
      if (line.trim() === '') {
        if (lead.length) leadClosed = true;
        continue;
      }
      if (CONSENT_LINE.test(line)) continue;
      if (!leadClosed) lead.push(line);
    }
    if (!lead.join('\n').includes(names)) return false;
    return headings.every((h) => h === 'fleet');
  };
  // The degenerate case: BOTH files are pointers naming each other, so neither is the
  // substantive contract and every host reads a stub. That is strictly worse than the drift
  // this branch exists to catch, and it is the one state the pointer test alone let through.
  // Rejecting it here rather than by lowering POINTER_MAX_LINES, which would wrongly reject a
  // legitimately short substantive contract.
  if (isPointer(short, otherName) && isPointer(other, shortName))
    return { verdict: 'DRIFTED', why: 'both contract files are pointers naming each other — neither is the substantive contract, so every host reads a stub' };
  if (isPointer(short, otherName))
    return { verdict: 'CONFORMANT', why: `parity mode: pointer pair, ${shortName} points at ${otherName}` };
  return { verdict: 'DRIFTED', why: 'the two contract files differ and the shorter one is not a pointer naming the other as required reading' };
}

for (const m of members) {
  if (!existsSync(m.dir) || !statSync(m.dir).isDirectory()) {
    row(m, 'consent', 'UNKNOWN', 'check-fleet.mjs', `member path '${m.declared}' does not resolve to a directory — consent could not be read`);
    continue;
  }
  const found = readContract(m.dir);
  const readError = CONTRACT_FILES.find((f) => found[`${f}:error`]);
  if (readError) {
    row(m, 'consent', 'UNKNOWN', 'check-fleet.mjs', `${readError} cannot be read: ${found[`${readError}:error`]}`);
    continue;
  }
  const texts = CONTRACT_FILES.map((f) => found[f]).filter((t) => typeof t === 'string');
  const consenting = texts.some(hasConsent);
  if (!consenting) {
    // Not a failure, and the last row this member gets. `named, not consenting` is the
    // reported state the fleet standard defines, and the run continues past it.
    row(m, 'consent', 'ABSENT', 'check-fleet.mjs', `named, not consenting — no \`${CONSENT_PHRASE}\` in a '## Fleet' section of the contract`);
    continue;
  }
  row(m, 'consent', 'CONFORMANT', 'check-fleet.mjs', `\`${CONSENT_PHRASE}\` in the '## Fleet' section of the contract`);

  const parity = parityMode(found);
  row(m, 'contract', parity.verdict === 'ABSENT' ? 'ABSENT' : parity.verdict, 'check-fleet.mjs', parity.why,
    // An incomplete pair on a CONSENTING member IS a failure: consent was read from a contract
    // the other host never sees. ABSENT is otherwise outside the failing set, so it is counted
    // explicitly here rather than by widening the set for every surface.
    { counts: false });
  if (parity.verdict !== 'CONFORMANT') failures += 1;

  const vaultDir = join(m.dir, `${basename(m.dir)}-docs`);
  if (!existsSync(vaultDir)) {
    row(m, 'vault', 'ABSENT', 'check-vault-standard.mjs', `no '${basename(m.dir)}-docs/' — vault adoption is voluntary, so this is reported, not failed`);
    continue;
  }
  const r = spawnSync(process.execPath, [VAULT_CHECKER, vaultDir], { encoding: 'utf8' });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const firstProblem = out.split('\n').find((l) => /VIOLATION|^x /.test(l)) || out.split('\n')[0] || '';
  if (r.error || r.status === null)
    row(m, 'vault', 'UNKNOWN', 'check-vault-standard.mjs', `the vault checker did not run: ${r.error ? r.error.message : 'no exit status'}`);
  else if (r.status === 0)
    row(m, 'vault', 'CONFORMANT', 'check-vault-standard.mjs', 'exit 0');
  else if (r.status === 1)
    row(m, 'vault', 'DRIFTED', 'check-vault-standard.mjs', `exit 1: ${firstProblem}`);
  else
    row(m, 'vault', 'UNKNOWN', 'check-vault-standard.mjs', `exit ${r.status}: ${firstProblem}`);
}

// ---- report ----------------------------------------------------------------------
console.log('| surface | verdict | checker | evidence |');
console.log('| --- | --- | --- | --- |');
for (const r of rows) console.log(r);
console.log('');
if (failures) {
  console.log(`(fleet) ${failures} surface failure(s) across ${members.length} member(s) in ${manifestPath}.`);
  process.exit(1);
}
console.log(`(fleet) OK ${manifestPath} — ${members.length} member(s), every consenting member conformant on every surface it carries.`);
