#!/usr/bin/env node
// HANDOFF.md structural checker: the mechanical floor under the handoff skill's write
// contract (plugins/code-ops-suite/skills/handoff/SKILL.md).
//
//   node scripts/check-handoff.mjs <HANDOFF.md> [--root <repo>] [--strict-anchors]
//     [--consume [--session <id>] [--successor <run dir>] [--name <session name>]]
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
//      this handoff's Open items or in PROGRAM.md Closed items. A dropped item fails by id. An id
//      also passes when a PROGRAM.md Open items bullet, or an archive bullet, carries it with
//      `Forwarded-to:` (a split or merge moved it), or when a PROGRAM.md Open items bullet carries
//      `Was: <program>/<id>` naming the predecessor's own program and the id (a merge imported it).
//      When the predecessor's `Program:` names another ledger (a split child's first hop, a merge
//      target's first hop), forwardedIn() also reads that ledger and its archive: an id it forwards
//      with `Forwarded-to: <slug>/<id>` passes when <slug> is this program, or when this ledger has
//      `Split-from: <predecessor program>`, so a sibling's id passes. An id forwarded nowhere fails.
//  10. Session chain. "## Program" may carry `Session: <base name> HO <n>`, the name the successor
//      session takes, and `Hop: <n>`. A handoff without both lines is legacy and passes. When
//      either is present, both must be: Hop is a positive integer and Session ends with ` HO <Hop>`.
//  19. Convergence (DEC-74). A PROGRAM.md `## Finish line` section, whose bullets start `- F<n> `,
//      opts in. Then "## Open items" holds at most OPEN_CAP bullets, each carries `Blocks: F<n>`
//      (a comma list is allowed) on its own line or its ledger line, and every F id it names is on
//      the Finish line. The rest of the open set lives in `BACKLOG.md` beside PROGRAM.md as `- OI-<n>`
//      lines. A predecessor open item now in BACKLOG.md passes and is reported as `deferred`. With no
//      Finish line, more than OPEN_CAP open items only warns. A chained handoff also prints
//      `burn-down: active N (predecessor M, +a -r), backlog B`, with ` GROWING` when N exceeds M.
//  16. Every `Pointer:` in "## Open items", here and in PROGRAM.md when the ledger has that
//      section, carries a delimited `Anchor:`. Under grammar 1 this warns and never gates, because
//      existing chains carry bare pointers. Under grammar 2 it fails closed.
//
// LEDGER GRAMMAR 2 (design Workstream L). A PROGRAM.md with a `Grammar: 2` line opts in. A ledger
// without the line is grammar 1, and checks 11 to 18 do not run, so older chains stay resumable.
// Grammar 2 requires a sixth ledger section, "## Open items", whose bullets lead with an id and carry
// `Owner:` and `Done when:`. `PROGRAM.archive.md` beside the ledger, written by `co program
// archive`, holds moved Request history, Decisions ledger, and Closed items bullets. Check 9's
// request lineage and closed ids, and checks 13 and 18, read both files whenever the archive exists.
//  11. Every Decisions ledger bullet leads with `DEC-<n>` and carries `Hop: <n>` and
//      `Disposition: pending|local|dropped|promoted:<record id>`.
//  12. A decision's Hop is the hop of the session that made it: its handoff's `Hop:` minus one,
//      because a handoff's Hop names its successor. A decision older than that must not be
//      `pending`, which gives one hop of grace. A grammar 2 handoff must carry `Hop:`.
//  13. Every DEC id in the predecessor's "## Decisions made" appears in the ledger, its archive,
//      or a `Was: <program>/<id>` trail. A decision that a split or merge forwarded keeps its id
//      leading its ledger bullet with `Forwarded-to:` appended, so it counts as in the ledger. A
//      DEC id the predecessor's own ledger forwarded to this program or a sibling passes by the
//      same forwardedIn() rule as check 9.
//  15. Every "## Decisions made" and "## Open items" bullet here leads with its id. A decision adds
//      at most one clause: no ` · ` field, no `Rejected:`, and no second sentence or semicolon. An
//      active open item keeps its full line. A carried one shows only id and title, and check 4
//      reads its `Owner:` and `Done when:` from the ledger's Open items.
//  17. An open item whose `Owner:` or `Done when:` differs from the predecessor's line carries
//      `Revised:` on its handoff line or its ledger line. A predecessor line carried as id and
//      title compares against the nearest ancestor handoff that holds the full line; with no such
//      ancestor on disk, the item is skipped.
//  18. No DEC or OI id leads two bullets across the ledger and its archive.
//  14. Every `Disposition: promoted:<record id>` in the ledger or its archive resolves on the working
//      tree, through recordState() in promotion-lib.mjs: sealed in `state.json`, or staged in
//      `intake.jsonl` awaiting its seal. An id in neither fails. A staged id passes, because the
//      record lands only when its branch merges; `co handoff resume` reports it UNLANDED.
//
// FORWARDING (design L4). A scope-document path, or a pointer path that would report GONE, falls back
// to `<hub>/98 System/FORWARDING.json` (forwardPath() in record-lib.mjs, repo-relative paths). A
// forwarded hit that exists reports MOVED, a warning, never GONE. The file loads on the first miss,
// and an invalid one (forwardingErrors(), a JSON error, or a cycle) is a violation, never a silent pass.
//
// `--consume` writes `HANDOFF.consumed` beside the file only when every check above passes. Its
// body is the version 2 JSON `{"v":2,"consumedAt","bySession","successorRun","name"}`. bySession is
// `--session`, else env CLAUDE_CODE_SESSION_ID, else CODEX_SESSION_ID, else null; successorRun and
// name come from `--successor` and `--name`, else null. Readers still accept the legacy body of
// one ISO timestamp line, and the file's existence alone means consumed. The resume direction writes it once verification
// finishes, and the SessionStart routing card treats its presence as "already picked up", so a
// consumed handoff stops being advertised to later sessions.
//
// Advisory (never gating): a `Verified-at:` sha that is not the current HEAD, so a resumed
// session re-verifies before trusting the handoff's claims.
//
// Status (never gating): `same-tree: Verified-at matches HEAD and the dirty paths the handoff
// recorded` prints when the `Verified-at:` sha is the current HEAD, `git status --porcelain
// --untracked-files=all`, less the handoff file and the SCOPE_DIGESTS.md beside it, names exactly
// the `- Dirty:` paths `co handoff draft` recorded, and each such path still matches its recorded
// content hash. A record without hashes never matches. A handoff with no such record needs a
// clean tree. Gitignored run scratch never appears there. A
// resumed session may then take FRESH anchors without re-reading each file (handoff SKILL.md,
// resume direction).
//
// Exit: 0 = conformant; 1 = at least one violation (listed on stderr); 2 = usage error.
// Pointer statuses, advisories, and `warning:` lines print on stderr, so stdout carries only the
// one-line verdict. A warning never changes the exit code.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { parseOrDie, usage, git } from './cli-lib.mjs';
// Imported by relative specifier: check-handoff.mjs ships vendored into
// plugins/code-ops-suite/scripts/, and the library ships beside it.
import { ANCHOR_RE, anchorValue, extractRefs, createResolver, resolveRef, readLineAt } from './citation-lib.mjs';
import { hubOf, promotedIds, recordState } from './promotion-lib.mjs';
import { forwardingErrors, forwardPath } from './record-lib.mjs';

const USAGE = 'usage: check-handoff.mjs <HANDOFF.md> [--root <repo>] [--strict-anchors] [--consume [--session <id>] [--successor <run dir>] [--name <session name>]]';
const { flags, positional } = parseOrDie(process.argv.slice(2), {
  root: { value: true, default: '.', missing: 'needs a path' },
  'strict-anchors': { value: false },
  consume: { value: false },
  session: { value: true },
  successor: { value: true },
  name: { value: true },
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
// Grammar 2 (checks 11 to 18): the id must lead the bullet, after an optional checkbox.
const leadId = (line) => /^[-*]\s+(?:\[[ xX]\]\s+)?([A-Z][A-Z0-9]*-\d+)\b/.exec(line)?.[1] ?? null;
const ARCHIVE_NAME = 'PROGRAM.archive.md';
// Check 19: a ledger with a "## Finish line" section opts in to a capped, finish-tied open set.
const BACKLOG_NAME = 'BACKLOG.md';
const OPEN_CAP = 12;
const finishId = (line) => /^[-*]\s+(F\d+)\b/.exec(line)?.[1] ?? null;
// The F ids a line's `Blocks:` field names, or null when the field is absent or empty.
const blocksOf = (line) => {
  const ids = /\bBlocks:([^·]*)/.exec(line)?.[1].split(/[,\s]+/).filter(Boolean) ?? [];
  return ids.length ? ids : null;
};
const DISPOSITION_RE = /\bDisposition:\s*(pending|local|dropped|promoted:[^\s·]+)\s*(?:·|$)/;
const ownerOf = (line) => /\bOwner:\s*(agent|operator)\b/i.exec(line)?.[1].toLowerCase() ?? null;
const doneWhenOf = (line) => { const m = /\bDone when:([^·]*)/.exec(line); return m ? squash(m[1]) : null; };
const bulletsOf = (body) => body.split('\n').filter((l) => /^[-*]\s+/.test(l));
const findSection = (list, name) => list.find((s) => s.heading.toLowerCase().startsWith(name.toLowerCase()));
// The text after `<label>:` on its own line, bulleted or not, or null when the line is absent.
const labelValue = (body, label) => new RegExp(`^[-*\\t ]*${label}:[^\\S\\r\\n]*(.*)$`, 'm').exec(body)?.[1].trim() ?? null;
const pathValue = (body, label) => labelValue(body, label)?.replace(/^`(.*)`$/, '$1').trim() || null;
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const agreedSlug = (line) => /\bAgreed-with:\s*([A-Za-z0-9][\w.-]*)/.exec(line)?.[1] ?? null;
// The decision text of a ledger bullet: what follows its leading DEC id and date, up to the first ` · ` field.
const decisionText = (line) => squash(line.replace(/^[-*]\s+DEC-\d+\s*(?:\d{4}-\d{2}-\d{2})?/, '').split('·')[0]);
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
const warnings = [];
const secs = sections(text);

// ---- forwarding: where `path` moved to, repo-relative, or null ----
// FORWARDING.json loads on the first miss. Its own failure is a violation, reported once per cause.
let forwarding = null;
let forwardingLoaded = false;
function loadForwarding() {
  const hub = hubOf(flags.root);
  const file = hub === null ? null : join(flags.root, hub, '98 System', 'FORWARDING.json');
  if (!file || !existsSync(file)) return null;
  try {
    const document = JSON.parse(readFileSync(file, 'utf8'));
    const errors = forwardingErrors(document);
    if (errors.length) throw new Error(errors.join('; '));
    return document;
  } catch (err) {
    violations.push(`FORWARDING.json is invalid, so a missing path cannot be forwarded: ${err.message}`);
    return null;
  }
}
function forwardedTo(path) {
  const repoPath = relative(resolve(flags.root), inRoot(path)).replace(/\\/g, '/');
  if (repoPath.startsWith('..') || isAbsolute(repoPath)) return null;
  if (!forwardingLoaded) { forwardingLoaded = true; forwarding = loadForwarding(); }
  if (!forwarding) return null;
  try { return forwardPath(forwarding, repoPath); } catch (err) {
    violations.push(`FORWARDING.json is invalid, so a missing path cannot be forwarded: ${err.message}`);
    return null;
  }
}

// ---- 16. every Open items Pointer: carries an Anchor: (a warning under grammar 1) ----
// Each text run after a `Pointer:` label, up to the next one, must hold a delimited Anchor:.
function unanchoredPointers(body, source, gate) {
  for (const line of body.split('\n')) {
    for (const run of line.split(/\bPointer:/).slice(1)) {
      if (ANCHOR_RE.test(run)) continue;
      const pointer = `Pointer: ${run.split('·')[0].trim().slice(0, 70)}`;
      (gate ? violations : warnings).push(`check 16: ${source} Open items pointer carries no delimited Anchor: ${[itemId(line), pointer].filter(Boolean).join(' ')}`);
    }
  }
}

// The ledger loads before check 4, because under grammar 2 a carried open item takes its Owner:
// and Done when: from the ledger's Open items.
const programSection = findSection(secs, 'Program');
const programPath = programSection ? pathValue(programSection.body, 'Program') : null;
const program = programPath && isFile(inRoot(programPath)) ? checkProgram(inRoot(programPath), programPath) : null;
const grammar2 = program?.grammar2 === true;

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
    // Grammar 2: a bullet with neither label is a carried item, and its full line is the ledger's.
    const carried = grammar2 && !/\bOwner:/i.test(line) && !/\bDone when:/i.test(line);
    const full = carried ? program.openById.get(leadId(line)) : line;
    if (carried && !full) {
      violations.push(`check 4: carried open item ${leadId(line) ?? shown} is not in PROGRAM.md "## Open items", so its Owner: and Done when: cannot be read`);
    } else {
      if (!/\bOwner:\s*(agent|operator)\b/i.test(full)) {
        violations.push(`Open items entry missing "Owner: agent|operator": ${shown}`);
      }
      if (!/\bDone when:/i.test(full)) {
        violations.push(`Open items entry missing "Done when:": ${shown}`);
      }
    }
    if (grammar2 && itemId(line) && !leadId(line)) {
      violations.push(`check 15: Open items entry does not lead with its id: ${shown}`);
    }
    if (IMPERATIVE_RE.test(line)) {
      violations.push(`Open items entry opens with an imperative verb: ${shown}`);
    }
    if (!itemId(line)) {
      violations.push(`Open items entry carries no stable id token such as OI-7: ${shown}`);
    }
  }
  unanchoredPointers(openSection.body, 'HANDOFF.md', grammar2);
}

// ---- 19. convergence: a Finish line caps the open set and ties each item to an F id ----
// Without a Finish line the cap only warns, so older programs keep passing. A carried item reads its
// Blocks: from the ledger line, as check 4 reads Owner: and Done when:.
const info = [];
if (program) {
  const items = bulletsOf(openSection?.body ?? '');
  if (items.length > OPEN_CAP) {
    const msg = `check 19: ${items.length} open items exceed the cap of ${OPEN_CAP}; move the rest to programs/${basename(dirname(inRoot(programPath)))}/${BACKLOG_NAME}`;
    (program.finish?.size ? violations : warnings).push(msg);
  }
  if (program.finish?.size) {
    for (const line of items) {
      const shown = line.trim().slice(0, 70);
      const blocks = blocksOf(line) ?? blocksOf(program.openById.get(leadId(line)) ?? '');
      if (!blocks) violations.push(`check 19: open item lacks "Blocks: F<n>" naming the Finish line item it serves: ${shown}`);
      for (const f of blocks ?? []) if (!program.finish.has(f)) violations.push(`check 19: open item Blocks: ${f} is not in PROGRAM.md "## Finish line": ${shown}`);
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
  const grammar = labelValue(body, 'Grammar');
  if (grammar !== null && !/^[12]$/.test(grammar)) violations.push(`${tag} "Grammar:" must be 1 or 2, found: ${grammar}`);
  const grammar2 = grammar === '2';
  for (const h of grammar2 ? [...PROGRAM_HEADINGS, 'Open items'] : PROGRAM_HEADINGS) {
    if (!findSection(ps, h)) violations.push(`${tag} missing required heading: "## ${h}"`);
  }
  // The archive `co program archive` writes beside the ledger. Its bullets count as the ledger's.
  const archiveFile = join(dirname(file), ARCHIVE_NAME);
  const archiveText = isFile(archiveFile) ? readFileSync(archiveFile, 'utf8') : '';
  const as = sections(archiveText);
  const archived = (h) => bulletsOf(findSection(as, h)?.body ?? '');
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
    else if (!existsSync(inRoot(doc))) {
      const moved = forwardedTo(doc);
      if (moved && existsSync(inRoot(moved))) warnings.push(`MOVED scope document ${doc} -> ${moved}`);
      else violations.push(`${tag} Scope document does not exist on the tree: ${doc}`);
    }
    if (!/\bStatus:\s*\S/.test(line) || !/\bRole:\s*\S/.test(line)) violations.push(`${tag} Scope documents entry missing "Status:" or "Role:": ${shownLine}`);
  }
  const closed = new Set();
  const closedLines = bulletsOf(findSection(ps, 'Closed items')?.body ?? '');
  for (const line of closedLines) {
    const id = itemId(line);
    if (id) closed.add(id);
    else violations.push(`${tag} Closed items entry carries no stable id token: ${line.trim().slice(0, 70)}`);
  }
  for (const line of archived('Closed items')) if (itemId(line)) closed.add(itemId(line));
  const ledgerOpen = findSection(ps, 'Open items');
  if (ledgerOpen) unanchoredPointers(ledgerOpen.body, `PROGRAM.md (${shown})`, grammar2);
  const requests = [history?.body ?? '', ...archived('Request history')].join('\n');
  // Ids a split or merge moved: `Forwarded-to:` on an Open items or archive bullet, and `Was: <program>/<id>`
  // on an Open items bullet, kept as `<program>/<id>` because the id is only unique within its program.
  const openLines = bulletsOf(ledgerOpen?.body ?? '');
  const forwarded = new Set([...openLines, ...as.flatMap((s) => bulletsOf(s.body))].filter((l) => /\bForwarded-to:\s*\S/.test(l)).map(itemId).filter(Boolean));
  const was = new Set(openLines.flatMap((l) => [...l.matchAll(/\bWas:\s*([^\s/]+)\/([A-Z][A-Z0-9]*-\d+)\b/g)].map((m) => `${m[1]}/${m[2]}`)));
  const finishSection = findSection(ps, 'Finish line');
  const finish = finishSection ? new Set(bulletsOf(finishSection.body).map(finishId).filter(Boolean)) : null;
  if (finish && !finish.size) violations.push(`${tag} "## Finish line" holds no "- F<n> ..." bullet`);
  const backlogFile = join(dirname(file), BACKLOG_NAME);
  const backlog = new Set(isFile(backlogFile) ? bulletsOf(readFileSync(backlogFile, 'utf8')).map(leadId).filter(Boolean) : []);
  const result = { history: squash(requests), closed, grammar2, forwarded, was, finish, backlog, openById: new Map(), decisions: [], decisionIds: new Set() };
  if (!grammar2) return result;

  // L1: a grammar 2 open item keeps today's line and leads with its id.
  for (const line of bulletsOf(ledgerOpen?.body ?? '')) {
    const shownLine = line.trim().slice(0, 70);
    const id = leadId(line);
    if (!id) violations.push(`${tag} Open items entry does not lead with a stable id token: ${shownLine}`);
    else result.openById.set(id, line);
    if (!ownerOf(line) || doneWhenOf(line) === null) violations.push(`${tag} Open items entry missing "Owner: agent|operator" or "Done when:": ${shownLine}`);
  }
  // ---- 11. every decision carries a DEC id, a Hop, and a Disposition ----
  const decisionLines = bulletsOf(findSection(ps, 'Decisions ledger')?.body ?? '');
  for (const line of decisionLines) {
    const shownLine = line.trim().slice(0, 70);
    const id = /^[-*]\s+(DEC-\d+)\b/.exec(line)?.[1];
    const hop = /\bHop:\s*(\d+)\s*(?:·|$)/.exec(line)?.[1];
    const disposition = DISPOSITION_RE.exec(line)?.[1];
    if (!id || hop === undefined || !disposition) {
      violations.push(`check 11: ${tag} Decisions ledger entry needs a leading DEC-<n>, "Hop: <n>", and "Disposition: pending|local|dropped|promoted:<id>": ${shownLine}`);
    }
    if (id && hop !== undefined && disposition) result.decisions.push({ id, hop: Number(hop), disposition });
  }
  // ---- 11b. an Agreed-with decision has its counterpart in the peer program's ledger (warn only) ----
  for (const line of decisionLines) {
    const peer = agreedSlug(line);
    if (peer) agreedWithWarning(line, peer, basename(dirname(file)), join(dirname(dirname(file)), peer, 'PROGRAM.md'));
  }
  // ---- 14. every promoted id resolves on the working tree: sealed, or staged in intake ----
  const promoted = promotedIds(`${body}\n${archiveText}`);
  const hub = promoted.length ? hubOf(flags.root) : null;
  for (const { dec, recordId } of promoted) {
    if (recordState(flags.root, recordId, { hub }).where === null) {
      violations.push(`check 14: ${tag} ${dec ?? 'a decision'} promoted:${recordId} resolves in neither state.json nor intake on the working tree`);
    }
  }
  // ---- 13 and 18 read the ledger and its archive; a Was: trail names an imported id ----
  const archivedDecisions = archived('Decisions ledger');
  for (const line of [...decisionLines, ...archivedDecisions]) {
    const id = /^[-*]\s+(DEC-\d+)\b/.exec(line)?.[1];
    if (id) result.decisionIds.add(id);
    for (const m of line.matchAll(/\bWas:\s*(?:\S+\/)?(DEC-\d+)\b/g)) result.decisionIds.add(m[1]);
  }
  // ---- 18. no DEC or OI id leads two bullets across the ledger and its archive ----
  const seen = new Map();
  for (const line of [...decisionLines, ...bulletsOf(ledgerOpen?.body ?? ''), ...closedLines, ...archivedDecisions, ...archived('Closed items')]) {
    const id = leadId(line);
    if (id && /^(DEC|OI)-/.test(id)) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, n] of seen) if (n > 1) violations.push(`check 18: ${id} leads ${n} bullets across ${tag} and ${ARCHIVE_NAME}; ids are unique within a program`);
  return result;
}

// Warns when the peer ledger is missing, unreadable, or holds no `Agreed-with: <own slug>` entry with the same decision
// text. Reads at most 4 * PROGRAM_CAP_BYTES, and an unreadable or oversized peer ledger is a warning, never a failure.
function agreedWithWarning(line, peer, own, peerFile) {
  const text = decisionText(line);
  const tag = `check 11: Agreed-with ${peer} entry "${text.slice(0, 50)}"`;
  try {
    if (!isFile(peerFile)) return void warnings.push(`${tag} has no peer ledger at programs/${peer}/PROGRAM.md`);
    if (statSync(peerFile).size > PROGRAM_CAP_BYTES * 4) return void warnings.push(`${tag}: programs/${peer}/PROGRAM.md is too large to compare`);
    const match = bulletsOf(readFileSync(peerFile, 'utf8')).some((l) => agreedSlug(l) === own && decisionText(l) === text);
    if (!match) warnings.push(`${tag} has no counterpart in programs/${peer}/PROGRAM.md (an entry with Agreed-with: ${own} and the same text)`);
  } catch { warnings.push(`${tag}: programs/${peer}/PROGRAM.md could not be read`); }
}

// Ids the predecessor's own ledger forwarded to this program: when the predecessor's Program: names another
// ledger (a split child's first hop, a merge target's first hop), its Open items, Decisions ledger, and archive
// bullets that carry `Forwarded-to: <slug>/<id>` count as carried, when <slug> is this program, or when this
// ledger has `Split-from: <predecessor program>`, which makes each forward target a sibling. Every other id
// the predecessor holds is still checked, so an id forwarded nowhere still fails.
function forwardedIn(priorPath) {
  const none = new Set();
  const [priorFile, ownFile] = [priorPath && inRoot(priorPath), programPath && inRoot(programPath)];
  if (!priorFile || !isFile(priorFile) || !ownFile || resolve(priorFile) === resolve(ownFile)) return none;
  const [priorSlug, ownSlug] = [basename(dirname(priorFile)), basename(dirname(ownFile))];
  const splitFrom = pathValue(readFileSync(ownFile, 'utf8'), 'Split-from');
  const archiveFile = join(dirname(priorFile), ARCHIVE_NAME);
  const held = [...sections(readFileSync(priorFile, 'utf8')), ...(isFile(archiveFile) ? sections(readFileSync(archiveFile, 'utf8')) : [])];
  const ids = new Set();
  for (const line of held.flatMap((sec) => bulletsOf(sec.body))) {
    const target = /\bForwarded-to:\s*([^\s/·]+)\//.exec(line)?.[1];
    if (target && (target === ownSlug || splitFrom === priorSlug)) ids.add(itemId(line));
  }
  ids.delete(null);
  return ids;
}

if (programSection) {
  const predecessor = pathValue(programSection.body, 'Predecessor');
  if (!programPath) violations.push('"## Program" has no non-empty "Program: <path>" line');
  if (!predecessor) violations.push('"## Program" has no "Predecessor: <path to prior HANDOFF.md | none>" line');
  if (programPath && !program) violations.push(`Program path does not resolve to a file: ${programPath}`);
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
      const priorPath = pathValue(findSection(prior, 'Program')?.body ?? '', 'Program') ?? '';
      const priorProgram = basename(dirname(priorPath));
      const movedIn = forwardedIn(priorPath);
      const carried = new Set([...program.closed, ...program.forwarded, ...movedIn, ...bulletsOf(openSection?.body ?? '').map(itemId).filter(Boolean)]);
      const priorOpen = bulletsOf(findSection(prior, 'Open items')?.body ?? '');
      const deferred = [];
      for (const line of priorOpen) {
        const id = itemId(line);
        if (!id) violations.push(`predecessor open item carries no id, so its carry-forward cannot be checked: ${line.trim().slice(0, 70)}`);
        else if (carried.has(id) || program.was.has(`${priorProgram}/${id}`)) continue;
        else if (program.backlog.has(id)) deferred.push(id);
        else violations.push(`predecessor open item ${id} was dropped: it is in neither "## Open items", PROGRAM.md "## Closed items", ${BACKLOG_NAME}, nor a Forwarded-to: or Was: trail`);
      }
      if (deferred.length) info.push(`deferred: ${deferred.join(', ')} (moved to ${BACKLOG_NAME})`);
      // Burn-down: active items now against the predecessor's, with the ids added and removed.
      const nowOpen = bulletsOf(openSection?.body ?? '');
      const [nowIds, priorIds] = [nowOpen, priorOpen].map((list) => new Set(list.map(itemId).filter(Boolean)));
      const [added, removed] = [[...nowIds].filter((i) => !priorIds.has(i)).length, [...priorIds].filter((i) => !nowIds.has(i)).length];
      info.push(`burn-down: active ${nowOpen.length} (predecessor ${priorOpen.length}, +${added} -${removed}), backlog ${program.backlog.size}${nowOpen.length > priorOpen.length ? ' GROWING' : ''}`);
      if (grammar2) grammar2Lineage(prior, predecessor, movedIn);
    }
  }
  // ---- 10. session chain: Session and Hop come as a pair, or not at all (legacy) ----
  const session = labelValue(programSection.body, 'Session');
  const hop = labelValue(programSection.body, 'Hop');
  if (session !== null || hop !== null) {
    if (!/^[1-9]\d*$/.test(hop ?? '')) violations.push(`"## Program" Hop: must be a positive integer beside Session:, found: ${hop ?? 'no Hop line'}`);
    else if (!session || !new RegExp(`\\S HO ${hop}$`).test(session)) violations.push(`"## Program" Session: must end with " HO ${hop}" to match Hop: ${hop}, found: ${session ?? 'no Session line'}`);
  }
  // ---- 12. no decision older than the writing session's hop stays pending ----
  if (grammar2) {
    if (!/^[1-9]\d*$/.test(hop ?? '')) violations.push('check 12: a handoff on a grammar 2 ledger needs "Hop: <n>" in "## Program"');
    else {
      const writer = Number(hop) - 1;
      for (const d of program.decisions) {
        if (d.disposition === 'pending' && d.hop < writer) violations.push(`check 12: ${d.id} from hop ${d.hop} is still pending at hop ${writer}; settle its Disposition`);
      }
    }
  }
}

// ---- 15. Decisions made bullets point at the ledger, never copy it ----
// One clause: no ledger field separator, no Rejected: list, and no second sentence or semicolon.
if (grammar2) {
  for (const line of bulletsOf(findSection(secs, 'Decisions made')?.body ?? '')) {
    const shown = line.trim().slice(0, 70);
    const lead = /^[-*]\s+DEC-\d+\b(.*)$/.exec(line.replace(/\r$/, ''));
    if (!lead) violations.push(`check 15: Decisions made entry does not lead with its DEC id: ${shown}`);
    else if (/ · |\bRejected:|[.;!?]\s+\S|;/.test(lead[1])) violations.push(`check 15: Decisions made entry adds more than one clause; the ledger holds the reason and rejected options: ${shown}`);
  }
}

function labelled(line) { return ownerOf(line) !== null && doneWhenOf(line) !== null; }
// Walks the Predecessor: chain from `from` for the first open item `id` that carries both labels.
// deferred(ANCESTOR_HOPS, run scratch may be absent offline: a missing ancestor or a cycle ends the
// walk and a change against it goes uncaught; upgrade path: record the baseline in the ledger)
function ancestorLine(from, id) {
  const ANCESTOR_HOPS = 25;
  const seen = new Set();
  let cursor = from;
  for (let hops = 0; hops < ANCESTOR_HOPS; hops++) {
    const next = pathValue(findSection(cursor, 'Program')?.body ?? '', 'Predecessor');
    if (!next || /^none$/i.test(next) || seen.has(next) || !isFile(inRoot(next))) return null;
    seen.add(next);
    cursor = sections(readFileSync(inRoot(next), 'utf8'));
    const held = bulletsOf(findSection(cursor, 'Open items')?.body ?? '').find((l) => leadId(l) === id);
    if (held && labelled(held)) return held;
  }
  return null;
}

// Checks 13 and 17 compare the predecessor handoff against this one and the grammar 2 ledger.
function grammar2Lineage(prior, predecessor, movedIn) {
  // ---- 13. every DEC id the predecessor made reaches the ledger, its archive, or a Was: trail ----
  const priorDecisions = findSection(prior, 'Decisions made')?.body ?? '';
  for (const id of new Set(priorDecisions.match(/(?<![\w/-])DEC-\d+\b/g) ?? [])) {
    if (!program.decisionIds.has(id) && !movedIn.has(id)) violations.push(`check 13: predecessor decision ${id} is in neither PROGRAM.md "## Decisions ledger", ${ARCHIVE_NAME}, nor a Was: trail`);
  }
  // ---- 17. a changed Owner: or Done when: carries Revised: ----
  const current = new Map(bulletsOf(openSection?.body ?? '').map((l) => [leadId(l), l]));
  for (const bullet of bulletsOf(findSection(prior, 'Open items')?.body ?? '')) {
    const id = leadId(bullet);
    const line = current.get(id);
    if (!id || !line) continue; // an absent id is check 9's
    // A predecessor line carried as id and title holds no labels, so the baseline is the nearest
    // ancestor handoff that holds the full line. No ancestor on disk leaves nothing to compare.
    const was = labelled(bullet) ? bullet : ancestorLine(prior, id);
    if (!was) continue;
    const ledger = program.openById.get(id) ?? '';
    const now = ownerOf(line) ? line : ledger;
    if (ownerOf(now) === ownerOf(was) && doneWhenOf(now) === doneWhenOf(was)) continue;
    if (!/\bRevised:\s*hop\s+\d+/i.test(line) && !/\bRevised:\s*hop\s+\d+/i.test(ledger)) {
      violations.push(`check 17: open item ${id} changed its Owner: or Done when: since ${predecessor} but carries no "Revised: hop <n> · <reason>"`);
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
    let judged = judgePointer(ref, anchor);
    // A missing file falls back to FORWARDING.json. A forwarded hit that resolves is MOVED at best.
    const to = judged.status === 'GONE' ? forwardedTo(ref.path) : null;
    if (to) {
      judged = judgePointer({ ...ref, path: to }, anchor);
      if (judged.status === 'FRESH' || judged.status === 'MOVED') judged = { status: 'MOVED', note: `forwarded to ${to}${judged.note ? `; ${judged.note}` : ''}` };
    }
    statuses.push({ ...judged, where });
  }
}
// One citation against the tree: { status, note }.
function judgePointer(ref, anchor) {
  const { status, note, target: file } = resolveRef(resolver, ref);
  if (status !== 'FRESH' || !file) return { status, note };
  if (anchor === '<REDACTED-LINE>') return { status, note: 'redacted anchor — line-existence check only' };
  const cited = readLineAt(file, ref.line);
  if (cited != null && cited.includes(anchor)) return { status: 'FRESH', note: null };
  // The anchor is not on the cited line. Somewhere else in the same file means the pointer's
  // line number went stale while the code it names survived, which a successor can still
  // follow, so that is MOVED. Nowhere in the file means the code itself changed: DRIFTED.
  const at = readFileSync(file, 'utf8').split('\n').findIndex((l) => l.includes(anchor));
  if (at >= 0) return { status: 'MOVED', note: `anchor now on line ${at + 1}` };
  return { status: 'DRIFTED', note: `anchor ${JSON.stringify(anchor)} is not in the file` };
}
// NO-REF is reported and never gates: an `Anchor:` written in the handoff's own prose, with no
// pointer beside it, is a writing slip rather than a stale claim about the tree.
const GATING = new Set(['GONE', 'DRIFTED', 'AMBIGUOUS']);
for (const s of statuses) {
  console.error(`  ${s.status.padEnd(9)} ${s.where}${s.note ? '  — ' + s.note : ''}`);
  if (GATING.has(s.status) || (s.status === 'MOVED' && strictAnchors))
    violations.push(`pointer ${s.status}: ${s.where}${s.note ? ' — ' + s.note : ''}`);
}

// The dirty record `co handoff draft` writes (dirtyLines in scripts/handoff-state.mjs): one
// "- Dirty: `<porcelain line>` · <token>" bullet per listed path, a count of the derived paths it
// leaves out, and a "+N more" line when it truncates the list. Keep DERIVED, porcelainPath, and
// dirtyHash in step with it.
const DERIVED = /^(codex-marketplace\/|opencode-dist\/|\.agents\/plugins\/|plugins\/[^/]+\/scripts\/)/;
const DIRTY_HASH_HEX = 16;
const porcelainPath = (line) => line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '');
// The draft's content token for one porcelain line: `sha256:` and the first DIRTY_HASH_HEX hex of
// the working-tree bytes, `none` for a path that is gone, null when it cannot be hashed.
function dirtyHash(top, line) {
  const raw = line.slice(3).split(' -> ').pop();
  if (raw.startsWith('"')) return null;
  let stat;
  try { stat = statSync(join(top, raw)); } catch { return 'none'; }
  if (!stat.isFile()) return null;
  try {
    return `sha256:${createHash('sha256').update(readFileSync(join(top, raw))).digest('hex').slice(0, DIRTY_HASH_HEX)}`;
  } catch { return null; }
}
// True when the porcelain lines name exactly the paths the handoff recorded, and each recorded path
// still hashes to its recorded token. Derived paths match by count because the draft counts them
// instead of listing them. A truncated list cannot be compared, so it never matches. A recorded path
// without a token (a record from before tokens, or an unhashable path) never matches, so the resume
// re-verifies. A handoff with no record matches only a clean tree. `skip` holds the handoff file and
// its SCOPE_DIGESTS.md, which the draft writes after it reads the tree.
function sameDirtySet(handoff, dirty, skip, top) {
  if (/^- \+\d+ more non-derived dirty path/m.test(handoff)) return false;
  const recorded = new Map([...handoff.matchAll(/^- Dirty: `(.+)`(?: · (sha256:[0-9a-f]+|none))?\s*$/gm)]
    .map((m) => [porcelainPath(m[1]), m[2]]));
  for (const p of skip) recorded.delete(p);
  const derived = Number(handoff.match(/^- Derived dirty paths not listed: (\d+)\b/m)?.[1] ?? 0);
  const current = new Map(dirty.map((line) => [porcelainPath(line), line]));
  const unlisted = [...current.keys()].filter((p) => !recorded.has(p));
  return [...recorded].every(([p, hash]) => hash && current.has(p) && dirtyHash(top, current.get(p)) === hash)
    && unlisted.length === derived && unlisted.every((p) => DERIVED.test(p));
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
// The dirty set must equal the one the handoff recorded, so a resume on the tree the draft saw
// takes the fast path even when the session left uncommitted work.
else if (stamped && headSha) {
  const repoRel = (p) => relative(resolver.root, p).replace(/\\/g, '/');
  const own = repoRel(resolve(target));
  const digests = repoRel(join(dirname(resolve(target)), 'SCOPE_DIGESTS.md'));
  const inRoot = own && !own.startsWith('../') && !isAbsolute(own);
  let dirty = null;
  let top = null;
  try {
    // The same porcelain call as `co handoff draft`, so both sides use one path form. Not cli-lib's
    // git(): its trim would eat the first line's leading status column.
    const exclude = inRoot ? ['--', `:(exclude,literal)${own}`, `:(exclude,literal)${digests}`] : [];
    dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', ...exclude],
      { cwd: resolver.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
    top = git(['rev-parse', '--show-toplevel'], { cwd: resolver.root });
  } catch { /* not decidable */ }
  if (dirty && top && sameDirtySet(text, dirty, [own, digests], top)) console.error('  same-tree: Verified-at matches HEAD and the dirty paths the handoff recorded');
}

for (const w of warnings) console.error(`  warning: ${w}`);
for (const line of info) console.error(`  ${line}`);

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
    const bySession = flags.session || process.env.CLAUDE_CODE_SESSION_ID || process.env.CODEX_SESSION_ID || null;
    const body = { v: 2, consumedAt: new Date().toISOString(), bySession, successorRun: flags.successor ?? null, name: flags.name ?? null };
    writeFileSync(marker, `${JSON.stringify(body)}\n`);
    console.error(`  consumed: wrote ${marker}`);
  } catch (err) {
    console.error(`x cannot write ${marker}: ${err.message}`);
    process.exit(1);
  }
}
console.log(`OK — ${target} conforms (${sizeBytes} bytes).`);
process.exit(0);
