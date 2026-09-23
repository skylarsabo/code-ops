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
//   1. Every required heading is present: Goal and state of play, Scope and constraints, Work
//      completed, Key findings, In-flight boundaries, Open items, Registers and artifacts,
//      Decisions made, Traps and dead ends, Authority, and Carried context. Matched by heading
//      prefix, so a parenthetical suffix such as "Decisions made (reason; rejected options)"
//      still matches. The first six answer the five questions an operator asks a resumed
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
//      for re-derives the objective from artifacts and drifts off it.
//   8. Every top-level bullet under "## Key findings" carries a confidence label of CONFIRMED,
//      PROBABLE, or SPECULATIVE. A finding handed on without one is read as certain.
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

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
  }
}

// ---- 7. the operator's original request, verbatim, inside Goal and state of play ----
const goalSection = secs.find((s) => s.heading.toLowerCase().startsWith('goal and state of play'));
// The text must sit on the `Request:` line itself, so the horizontal-whitespace classes keep the
// match from running past the newline into the next paragraph.
if (goalSection && !/^[-*\t ]*Request:[^\S\r\n]*\S/m.test(goalSection.body)) {
  violations.push('"## Goal and state of play" has no non-empty "Request:" line carrying the operator\'s original request');
}

// ---- 8. Key findings: every bullet carries a confidence label ----
const findingsSection = secs.find((s) => s.heading.toLowerCase().startsWith('key findings'));
if (findingsSection) {
  for (const line of findingsSection.body.split('\n').filter((l) => /^[-*]\s+/.test(l))) {
    if (!CONFIDENCE_RE.test(line)) {
      violations.push(`Key findings entry carries no confidence label (CONFIRMED|PROBABLE|SPECULATIVE): ${line.trim().slice(0, 70)}`);
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
