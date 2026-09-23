#!/usr/bin/env node
// HANDOFF.md structural checker: the mechanical floor under the handoff skill's write
// contract (plugins/code-ops-suite/skills/handoff/SKILL.md).
//
//   node scripts/check-handoff.mjs <HANDOFF.md> [--root <repo>] [--strict-anchors] [--consume]
//
// WHY: a handoff whose Open items carry no owner, whose Authority section is missing, or that
// grew past what a fresh session reads before acting degrades unnoticed until a resumed
// session stalls on it. This applies the same fail-closed pattern as scan-redaction.mjs and
// check-vault-standard.mjs to the handoff's shape, not its prose quality. Nothing here reads
// for truth, only for structure.
//
// WHAT IT CHECKS
//   1. Every required heading is present: Program, Goal and state of play, Scope and constraints, Work
//      completed, Key findings, In-flight boundaries, Open items, Registers and artifacts,
//      Decisions made, Traps and dead ends, Authority, and Carried context. Matched by heading
//      prefix, so a parenthetical suffix such as "Decisions made (reason; rejected options)"
//      still matches. Goal through Open items answer the five questions an operator asks a resumed
//      session: what was worked on, what was found, what is in progress, what is left, and what
//      the scope and constraints are.
//   2. A `Verified-at:` line exists somewhere in the file: the resume contract's re-verify
//      anchor.
//   3. The file is at or under SIZE_CAP_BYTES. Detail belongs in the run-folder files the
//      handoff points at, never inline.
//   4. Every top-level bullet under "## Open items" carries both `Owner: agent|operator` and
//      `Done when:`.
//   5. No "## Open items" bullet opens with an imperative verb, from a small documented list.
//      The write contract states what is true, never what the next session should do. This is
//      a first-word heuristic, not a grammar check, so it can both over- and under-flag.
//   6. L-062: every `path:line · Anchor: <delimited text>` pointer RESOLVES against the working
//      tree, through the same resolver the register gate uses (citation-lib.mjs). Shape alone
//      proved nothing: a handoff could point a resumed session at a line that had moved, drifted,
//      or vanished and still pass. One status prints per pointer. `GONE` (the file is missing),
//      `DRIFTED` (the anchor is nowhere in the file) and `AMBIGUOUS` (the pointer escapes root or
//      matches several files) fail closed. `MOVED` (the anchor sits on a different line of the
//      same file) is a warning by default, because the successor can still find the code, and a
//      violation under `--strict-anchors`. An `Anchor:` of `<REDACTED-LINE>` is checked for line
//      existence only, exactly as the register gate treats it.
//   7. A non-empty `Request:` line sits inside "## Goal and state of play", carrying the
//      operator's original request verbatim. A resumed session that cannot read what was asked
//      for re-derives the objective from artifacts and drifts off it. No `[FILL:` placeholder
//      from `co handoff draft` may remain on any line.
//   8. Every top-level bullet under "## Key findings" carries a confidence label of CONFIRMED,
//      PROBABLE, or SPECULATIVE. A finding handed on without one is read as certain.
//   9. Program lineage. A handoff chain lost the original goal, the design docs, and older
//      decisions after three or four hops, because each HANDOFF.md held only its own session.
//      So "## Program" (heading 1 above) must carry `Program: <path>` and
//      `Predecessor: <path to prior HANDOFF.md | none>`, each path absolute or relative to
//      --root. Every top-level Open items bullet carries a stable id token such as `OI-7`; the
//      first token on the bullet is the item's id across hops. The Program path must resolve to
//      a PROGRAM.md at or under PROGRAM_CAP_BYTES with the PROGRAM_HEADINGS sections, a
//      non-empty goal, a leading YYYY-MM-DD date on every Request history bullet, and this
//      handoff's own `Request:` text inside Request history. Every Scope documents bullet names
//      a backticked path that exists, plus `Status:` and `Role:`. Every Closed items bullet
//      carries an id. When Predecessor is a path, it must resolve, its `Request:` text must sit
//      in Request history, and each of its open-item ids must appear as the id of a bullet in
//      this handoff's Open items or in PROGRAM.md Closed items. A dropped item fails by id.
//
// `--consume` writes `HANDOFF.consumed` beside the file, holding one ISO timestamp line, and
// only when every check above passes. The resume direction writes it once verification
// finishes, and the SessionStart routing card treats its presence as "already picked up", so a
// consumed handoff stops being advertised to later sessions.
//
// Advisory (never gating): a `Verified-at:` sha that is not the current HEAD, so a resumed
// session re-verifies before trusting the handoff's claims.
//
// Status (never gating): `same-tree: Verified-at matches HEAD on a clean tree` prints when the
// `Verified-at:` sha is the current HEAD and `git status --porcelain` lists nothing but the
// handoff file itself. Gitignored run scratch never appears there. A resumed session may then
// take FRESH anchors without re-reading each file (handoff SKILL.md, resume direction).
//
// Exit: 0 = conformant; 1 = at least one violation (listed on stderr); 2 = usage error.
// Pointer statuses and advisories print on stderr, so stdout carries only the one-line verdict.

import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { parseOrDie, usage, git } from './cli-lib.mjs';
// Imported by relative specifier: check-handoff.mjs ships vendored into
// plugins/code-ops-suite/scripts/, and the library ships beside it.
import { ANCHOR_RE, anchorValue, extractRefs, createResolver, resolveRef, readLineAt } from './citation-lib.mjs';

const USAGE = 'usage: check-handoff.mjs <HANDOFF.md> [--root <repo>] [--strict-anchors] [--consume]';
const { flags, positional } = parseOrDie(process.argv.slice(2), {
  root: { value: true, default: '.', missing: 'needs a path' },
  'strict-anchors': { value: false },
  consume: { value: false },
}, USAGE);
if (positional.length !== 1) usage(USAGE);
const [target] = positional;
if (!existsSync(target)) usage([`x not found: ${target}`, USAGE]);

let text;
try {
  text = readFileSync(target, 'utf8');
} catch (err) {
  console.error(`x cannot read ${target}: ${err.message}`);
  process.exit(2);
}

const SIZE_CAP_BYTES = 8 * 1024; // ~8 KB (design cap): detail lives in pointed-at files, not inline.

// Listed in the order the write contract writes them: the five an operator asks about first,
// then the rest. Order is documentation here, never a check; only presence gates.
const REQUIRED_HEADINGS = [
  'Program',
  'Goal and state of play',
  'Scope and constraints',
  'Work completed',
  'Key findings',
  'In-flight boundaries',
  'Open items',
  'Registers and artifacts',
  'Decisions made',
  'Traps and dead ends',
  'Authority',
  'Carried context',
];

// The house confidence labels (CLAUDE.md, "Ground claims and verification"), which every Key
// findings bullet must carry so a successor knows what was executed and what was inferred.
const CONFIDENCE_RE = /\b(CONFIRMED|PROBABLE|SPECULATIVE|UNVERIFIED)\b/;

// A short, documented verb list for the imperative-led heuristic (check 5). Every conformant
// example in the write contract opens an Open items line with an id or a noun phrase, such as
// "PAR-003 fix: not started", never one of these. Words that also open noun-phrase labels
// ("Review receipts", "Merge of #151", "Test coverage") stay off the list, because this check fails closed.
const IMPERATIVE_VERBS = [
  'fix', 'implement', 'run', 'add', 'remove', 'write', 'verify', 'investigate', 'resume',
  'continue', 'build', 'create', 'deploy', 'push', 'make', 'configure', 'refactor', 'debug',
  'ensure', 'confirm', 'apply', 'enable', 'disable', 'finish', 'rename', 'replace', 'do',
];
const IMPERATIVE_RE = new RegExp(`^[-*]\\s+(?:\\[[ xX]\\]\\s+)?(${IMPERATIVE_VERBS.join('|')})\\b`, 'i');

// PROGRAM.md, the durable ledger one program's handoffs share (check 9). It outlives every run
// folder, so its cap sits well above the handoff's own.
const PROGRAM_CAP_BYTES = 32 * 1024;
const PROGRAM_HEADINGS = ['Program goal', 'Request history', 'Scope documents', 'Decisions ledger', 'Closed items'];
// A stable item id such as OI-7, PAR-100, or FEAT-012. The first one on a bullet is its id.
const ITEM_ID_RE = /\b[A-Z][A-Z0-9]*-\d+\b/;
const itemId = (line) => ITEM_ID_RE.exec(line)?.[0] ?? null;
const bulletsOf = (body) => body.split('\n').filter((l) => /^[-*]\s+/.test(l));
const findSection = (list, name) => list.find((s) => s.heading.toLowerCase().startsWith(name.toLowerCase()));
// The text after `<label>:` on its own line, bulleted or not, or null when the line is absent.
const labelValue = (body, label) => new RegExp(`^[-*\\t ]*${label}:[^\\S\\r\\n]*(.*)$`, 'm').exec(body)?.[1].trim() ?? null;
const pathValue = (body, label) => labelValue(body, label)?.replace(/^`(.*)`$/, '$1').trim() || null;
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const inRoot = (p) => (isAbsolute(p) ? p : resolve(flags.root, p));
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

// Splits the body into { heading, body } pairs on top-level (## ) headings, in document order.
function sections(body) {
  const parts = body.split(/^(##[ \t]+.+)$/m);
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ heading: parts[i].replace(/^##[ \t]+/, '').trim(), body: parts[i + 1] ?? '' });
  }
  return out;
}

const violations = [];
const secs = sections(text);

// ---- 1. required headings ----
for (const required of REQUIRED_HEADINGS) {
  const present = secs.some((s) => s.heading.toLowerCase().startsWith(required.toLowerCase()));
  if (!present) violations.push(`missing required heading: "## ${required}"`);
}

// ---- 2. Verified-at line ----
if (!/^Verified-at:\s*\S+/m.test(text)) violations.push('missing a "Verified-at:" line');

// ---- 3. size cap ----
const sizeBytes = Buffer.byteLength(text, 'utf8');
if (sizeBytes > SIZE_CAP_BYTES) {
  violations.push(`file is ${sizeBytes} bytes, over the ${SIZE_CAP_BYTES}-byte cap. Move detail into pointed-at files`);
}

// ---- 4 & 5. Open items: Owner/Done when, and no imperative-led lines ----
const openSection = secs.find((s) => s.heading.toLowerCase().startsWith('open items'));
if (openSection) {
  const bullets = openSection.body.split('\n').filter((l) => /^[-*]\s+/.test(l));
  for (const line of bullets) {
    const shown = line.trim().slice(0, 70);
    if (!/\bOwner:\s*(agent|operator)\b/i.test(line)) {
      violations.push(`Open items entry missing "Owner: agent|operator": ${shown}`);
    }
    if (!/\bDone when:/i.test(line)) {
      violations.push(`Open items entry missing "Done when:": ${shown}`);
    }
    if (IMPERATIVE_RE.test(line)) {
      violations.push(`Open items entry opens with an imperative verb: ${shown}`);
    }
    if (!itemId(line)) {
      violations.push(`Open items entry carries no stable id token such as OI-7: ${shown}`);
    }
  }
}

// ---- 7. the operator's original request, verbatim, inside Goal and state of play ----
const goalSection = secs.find((s) => s.heading.toLowerCase().startsWith('goal and state of play'));
// The text must sit on the `Request:` line itself, so the horizontal-whitespace classes keep the
// match from running past the newline into the next paragraph.
if (goalSection && !/^[-*\t ]*Request:[^\S\r\n]*\S/m.test(goalSection.body)) {
  violations.push('"## Goal and state of play" has no non-empty "Request:" line carrying the operator\'s original request');
}

// ---- 7b. no unfilled draft placeholder survives anywhere in the file ----
const unfilled = text.split('\n').filter((line) => line.includes('[FILL:')).length;
if (unfilled) violations.push(`${unfilled} line(s) still hold a "[FILL:" placeholder from \`co handoff draft\``);

// ---- 8. Key findings: every bullet carries a confidence label ----
const findingsSection = secs.find((s) => s.heading.toLowerCase().startsWith('key findings'));
if (findingsSection) {
  for (const line of findingsSection.body.split('\n').filter((l) => /^[-*]\s+/.test(l))) {
    if (!CONFIDENCE_RE.test(line)) {
      violations.push(`Key findings entry carries no confidence label (CONFIRMED|PROBABLE|SPECULATIVE): ${line.trim().slice(0, 70)}`);
    }
  }
}

// ---- 9. Program lineage: the durable ledger and the carry-forward from the predecessor ----
// Checks PROGRAM.md's own shape and returns its Request history text and closed-item ids.
function checkProgram(file, shown) {
  const body = readFileSync(file, 'utf8');
  const tag = `PROGRAM.md (${shown})`;
  const bytes = Buffer.byteLength(body, 'utf8');
  if (bytes > PROGRAM_CAP_BYTES) {
    violations.push(`${tag} is ${bytes} bytes, over the ${PROGRAM_CAP_BYTES}-byte cap. Move superseded detail into pointed-at files`);
  }
  const ps = sections(body);
  for (const h of PROGRAM_HEADINGS) {
    if (!findSection(ps, h)) violations.push(`${tag} missing required heading: "## ${h}"`);
  }
  const goal = findSection(ps, 'Program goal');
  if (goal && !goal.body.trim()) violations.push(`${tag} "## Program goal" is empty`);
  const history = findSection(ps, 'Request history');
  if (history) {
    const entries = bulletsOf(history.body);
    if (entries.length === 0) violations.push(`${tag} "## Request history" holds no dated request`);
    for (const line of entries) {
      if (!/^[-*]\s+\d{4}-\d{2}-\d{2}\b/.test(line)) violations.push(`${tag} Request history entry has no leading YYYY-MM-DD date: ${line.trim().slice(0, 70)}`);
    }
  }
  for (const line of bulletsOf(findSection(ps, 'Scope documents')?.body ?? '')) {
    const shownLine = line.trim().slice(0, 70);
    const doc = /`([^`\n]+)`/.exec(line)?.[1].trim();
    if (!doc) violations.push(`${tag} Scope documents entry names no backticked path: ${shownLine}`);
    else if (!existsSync(inRoot(doc))) violations.push(`${tag} Scope document does not exist on the tree: ${doc}`);
    if (!/\bStatus:\s*\S/.test(line) || !/\bRole:\s*\S/.test(line)) violations.push(`${tag} Scope documents entry missing "Status:" or "Role:": ${shownLine}`);
  }
  const closed = new Set();
  for (const line of bulletsOf(findSection(ps, 'Closed items')?.body ?? '')) {
    const id = itemId(line);
    if (id) closed.add(id);
    else violations.push(`${tag} Closed items entry carries no stable id token: ${line.trim().slice(0, 70)}`);
  }
  return { history: squash(history?.body ?? ''), closed };
}

const programSection = findSection(secs, 'Program');
if (programSection) {
  const programPath = pathValue(programSection.body, 'Program');
  const predecessor = pathValue(programSection.body, 'Predecessor');
  if (!programPath) violations.push('"## Program" has no non-empty "Program: <path>" line');
  if (!predecessor) violations.push('"## Program" has no "Predecessor: <path to prior HANDOFF.md | none>" line');
  let program = null;
  if (programPath) {
    if (isFile(inRoot(programPath))) program = checkProgram(inRoot(programPath), programPath);
    else violations.push(`Program path does not resolve to a file: ${programPath}`);
  }
  const ownRequest = labelValue(goalSection?.body ?? '', 'Request');
  if (program && ownRequest && !program.history.includes(squash(ownRequest))) {
    violations.push(`this handoff's Request: text is not in PROGRAM.md "## Request history": ${ownRequest.slice(0, 70)}`);
  }
  if (predecessor && !/^none$/i.test(predecessor)) {
    if (!isFile(inRoot(predecessor))) {
      violations.push(`Predecessor path does not resolve to a file: ${predecessor}`);
    } else if (program) {
      const prior = sections(readFileSync(inRoot(predecessor), 'utf8'));
      const priorRequest = labelValue(findSection(prior, 'Goal and state of play')?.body ?? '', 'Request');
      if (!priorRequest) violations.push(`predecessor ${predecessor} has no "Request:" line to carry forward`);
      else if (!program.history.includes(squash(priorRequest))) {
        violations.push(`the predecessor's Request: text is not in PROGRAM.md "## Request history": ${priorRequest.slice(0, 70)}`);
      }
      const carried = new Set([...program.closed, ...bulletsOf(openSection?.body ?? '').map(itemId).filter(Boolean)]);
      for (const line of bulletsOf(findSection(prior, 'Open items')?.body ?? '')) {
        const id = itemId(line);
        if (!id) violations.push(`predecessor open item carries no id, so its carry-forward cannot be checked: ${line.trim().slice(0, 70)}`);
        else if (!carried.has(id)) violations.push(`predecessor open item ${id} was dropped: it is in neither "## Open items" nor PROGRAM.md "## Closed items"`);
      }
    }
  }
}

// ---- 6. anchored pointers resolve against the working tree ----
// The pointer sits before its own `Anchor:` label (artifact-grammars section (b)), so only the
// text ahead of the label is scanned for citations. A file:line inside the anchor's own quoted
// substring is part of the anchor, never a second pointer.
const resolver = createResolver(flags.root);
const strictAnchors = flags['strict-anchors'] === true;
const statuses = [];
for (const raw of text.split('\n')) {
  const line = raw.replace(/\r$/, '');
  const labelled = ANCHOR_RE.exec(line);
  if (!labelled) continue;
  const anchor = anchorValue(labelled);
  const refs = extractRefs(line.slice(0, labelled.index), resolver.root);
  if (refs.length === 0) {
    statuses.push({ status: 'NO-REF', where: line.trim().slice(0, 70), note: 'an anchor with no file:line pointer beside it' });
    continue;
  }
  for (const ref of refs) {
    const where = `${ref.path}:${ref.line}`;
    const { status, note, target: file } = resolveRef(resolver, ref);
    if (status !== 'FRESH' || !file) { statuses.push({ status, where, note }); continue; }
    if (anchor === '<REDACTED-LINE>') { statuses.push({ status, where, note: 'redacted anchor — line-existence check only' }); continue; }
    const cited = readLineAt(file, ref.line);
    if (cited != null && cited.includes(anchor)) { statuses.push({ status: 'FRESH', where, note: null }); continue; }
    // The anchor is not on the cited line. Somewhere else in the same file means the pointer's
    // line number went stale while the code it names survived, which a successor can still
    // follow, so that is MOVED. Nowhere in the file means the code itself changed: DRIFTED.
    const at = readFileSync(file, 'utf8').split('\n').findIndex((l) => l.includes(anchor));
    if (at >= 0) statuses.push({ status: 'MOVED', where, note: `anchor now on line ${at + 1}` });
    else statuses.push({ status: 'DRIFTED', where, note: `anchor ${JSON.stringify(anchor)} is not in the file` });
  }
}
// NO-REF is reported and never gates: an `Anchor:` written in the handoff's own prose, with no
// pointer beside it, is a writing slip rather than a stale claim about the tree.
const GATING = new Set(['GONE', 'DRIFTED', 'AMBIGUOUS']);
for (const s of statuses) {
  console.error(`  ${s.status.padEnd(9)} ${s.where}${s.note ? '  — ' + s.note : ''}`);
  if (GATING.has(s.status) || (s.status === 'MOVED' && strictAnchors))
    violations.push(`pointer ${s.status}: ${s.where}${s.note ? ' — ' + s.note : ''}`);
}

// ---- advisory: the handoff's Verified-at sha is not the current HEAD ----
const stamped = text.match(/^Verified-at:\s*([0-9a-f]{7,40})\b/im);
let headSha = null;
try { headSha = git(['rev-parse', '--short', 'HEAD'], { cwd: resolver.root }); } catch { /* not a git repo */ }
if (stamped && headSha && !stamped[1].startsWith(headSha) && !headSha.startsWith(stamped[1]))
  console.error(`  advisory: Verified-at ${stamped[1]} != HEAD ${headSha}: re-verify the handoff's claims before acting on them`);

// ---- status: same tree, so FRESH anchors need no re-read ----
// WHY: a resume on the very tree the handoff verified re-read every anchored file for nothing.
// The handoff file is excluded because writing it dirties the tree it describes. Any git
// failure leaves the status unprinted, which only costs the successor the slow path.
else if (stamped && headSha) {
  const own = relative(resolver.root, resolve(target)).replace(/\\/g, '/');
  const exclude = own && !own.startsWith('../') && !isAbsolute(own) ? [`:(exclude,literal)${own}`] : [];
  let dirty = null;
  try { dirty = git(['status', '--porcelain', '--untracked-files=all', '--', '.', ...exclude], { cwd: resolver.root }); } catch { /* not decidable */ }
  if (dirty === '') console.error('  same-tree: Verified-at matches HEAD on a clean tree');
}

if (violations.length) {
  console.error(`x ${target}: ${violations.length} violation(s)`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
// A passing check is the only thing that may mark the handoff consumed: the marker tells later
// sessions the state was picked up and verified, so writing it beside an unchecked file would
// retire a handoff nobody read. Marker path and unwritable-directory handling stay simple, and a
// write failure is reported rather than swallowed, because the caller asked for the marker.
if (flags.consume === true) {
  const marker = join(dirname(target), 'HANDOFF.consumed');
  try {
    writeFileSync(marker, `${new Date().toISOString()}\n`);
    console.error(`  consumed: wrote ${marker}`);
  } catch (err) {
    console.error(`x cannot write ${marker}: ${err.message}`);
    process.exit(1);
  }
}
console.log(`OK — ${target} conforms (${sizeBytes} bytes).`);
process.exit(0);
