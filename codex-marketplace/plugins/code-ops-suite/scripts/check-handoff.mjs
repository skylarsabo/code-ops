#!/usr/bin/env node
// HANDOFF.md structural checker: the mechanical floor under the handoff skill's write
// contract (plugins/code-ops-suite/skills/handoff/SKILL.md).
//
//   node scripts/check-handoff.mjs <HANDOFF.md>
//
// WHY: a handoff whose Open items carry no owner, whose Authority section is missing, or that
// grew past what a fresh session reads before acting degrades unnoticed until a resumed
// session stalls on it. This applies the same fail-closed pattern as scan-redaction.mjs and
// check-vault-standard.mjs to the handoff's shape, not its prose quality. Nothing here reads
// for truth, only for structure.
//
// WHAT IT CHECKS
//   1. Every required heading is present: Goal and state of play, Registers and artifacts,
//      Decisions made, Traps and dead ends, In-flight boundaries, Open items, Authority, and
//      Carried context. Matched by heading prefix, so a parenthetical suffix such as
//      "Decisions made (reason; rejected options)" still matches.
//   2. A `Verified-at:` line exists somewhere in the file: the resume contract's re-verify
//      anchor.
//   3. The file is at or under SIZE_CAP_BYTES. Detail belongs in the run-folder files the
//      handoff points at, never inline.
//   4. Every top-level bullet under "## Open items" carries both `Owner: agent|operator` and
//      `Done when:`.
//   5. No "## Open items" bullet opens with an imperative verb, from a small documented list.
//      The write contract states what is true, never what the next session should do. This is
//      a first-word heuristic, not a grammar check, so it can both over- and under-flag.
//
// Exit: 0 = conformant; 1 = at least one violation (listed on stderr); 2 = usage error.

import { existsSync, readFileSync } from 'node:fs';
import { parseOrDie, usage } from './cli-lib.mjs';

const USAGE = 'usage: check-handoff.mjs <HANDOFF.md>';
const { positional } = parseOrDie(process.argv.slice(2), {}, USAGE);
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

const SIZE_CAP_BYTES = 6 * 1024; // ~6 KB (design cap): detail lives in pointed-at files, not inline.

const REQUIRED_HEADINGS = [
  'Goal and state of play',
  'Registers and artifacts',
  'Decisions made',
  'Traps and dead ends',
  'In-flight boundaries',
  'Open items',
  'Authority',
  'Carried context',
];

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

if (violations.length) {
  console.error(`x ${target}: ${violations.length} violation(s)`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`OK — ${target} conforms (${sizeBytes} bytes).`);
process.exit(0);
