#!/usr/bin/env node
// Vault conformance checker for the code-ops suite — the per-repo Obsidian vault standard
// (docs/techniques/vault-standard.md). Runs against a vault directory in any repo.
//
//   node scripts/check-vault-standard.mjs <vault-dir>
//
// WHY: the standard's value is that an agent dropped into any repo can predict where a note
// lives and what its frontmatter says, without reading the vault first. That prediction is only
// safe if a machine, not a reader's goodwill, decides whether the vault still conforms. So this
// checker is fail-CLOSED: an unreadable Standard.md, a missing machinery folder, or one note
// with no `status` exits 1. A vault that cannot be checked is a vault whose layout claims are
// unverified, which is the same trust position as a vault that fails.
//
// WHAT IT CHECKS
//   1. `Standard.md` exists at the vault root and its frontmatter carries `standard-version` —
//      the conformance copy is what makes the vault self-describing offline, and the version is
//      what makes a stale copy visible.
//   2. The machinery folders exist: `00 Inbox`, `90 Templates`, `95 Attachments`, `98 System`,
//      `99 Archive`. `80 Runs` is a WARNING when absent, never a failure: a profile may gitignore
//      it (the code-ops profile does), so a fresh clone legitimately has no such directory.
//   3. Every two-digit-prefixed top-level folder in the 80-99 band is one of the machinery
//      folders. The band is reserved; a domain folder numbered into it breaks the sidebar
//      contract and hides itself among the bookkeeping.
//   4. At least one domain folder exists in the 10-79 band. A vault with only machinery holds
//      no judgment, so nothing routes to it.
//   5. Every `.md` note carries `type`, `status`, and `updated` frontmatter, and `status` is one
//      of `draft`, `current`, `accepted`, `superseded`, or a profile status the vault's own
//      Standard.md declares.
//
// WHAT IT DELIBERATELY DOES NOT CHECK (and why)
//   - `.obsidian/` — Obsidian's own config, not notes.
//   - `90 Templates/` — templates carry placeholder frontmatter (`{{date:YYYY-MM-DD}}`), which
//     is correct for a template and invalid for a note.
//   - The vault-root `README.md` — the git host's entry point to the folder, not a vault note;
//     frontmatter would render as noise on the host.
//   - UPPER_SNAKE_CASE filenames (`DISPATCH_LEDGER.md`, `SSOT_MAP.md`, `FINDINGS_REGISTER.md`) —
//     canonical suite artifacts whose grammar other tools parse. The standard keeps their
//     filenames and their format unchanged inside a run folder; adding frontmatter to one would
//     break the reader it was written for.
//
// A profile status is declared by writing the phrase `profile status` on a line of Standard.md
// with the value in backticks, e.g. "`lab-entry` notes use the profile status `recorded`". The
// declaration therefore lives in the same prose a human reads, rather than in a second list that
// drifts from it.
//
// Exit: 0 conformant (one-line OK); 1 at least one violation; 2 usage error.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const MACHINERY = ['00 Inbox', '80 Runs', '90 Templates', '95 Attachments', '98 System', '99 Archive'];
// `80 Runs` is the one machinery folder a profile may leave off disk (gitignored run artifacts).
const OPTIONAL_MACHINERY = new Set(['80 Runs']);
const BASE_STATUSES = ['draft', 'current', 'accepted', 'superseded'];
const NUMBERED_DIR = /^(\d{2}) (.+)$/;
const UPPER_SNAKE = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', '90 Templates']);

const violations = [];
const warnings = [];
const fail = (m) => violations.push(m);
const warn = (m) => warnings.push(m);

function usage() {
  console.error('usage: check-vault-standard.mjs <vault-dir>');
  process.exit(2);
}

// Minimal YAML front-matter reader: the leading `---` block, `key: value` at top level only.
// Deliberately not a YAML parser — the four fields this checker rules on are all scalars, and a
// dependency-free repo may not grow one for a conformance check.
function frontmatter(text) {
  const body = text.replace(/^﻿/, '');
  if (!/^---\r?\n/.test(body)) return null;
  const end = body.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = body.slice(4, end);
  const out = {};
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (/^\s/.test(line)) continue; // nested list item or block scalar — not a top-level key
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// Profile statuses are declared in prose: a line naming `profile status` with the value in
// backticks. Every backticked token on such a line is taken as a declared status, because the
// sentence that introduces one names it and nothing else in backticks worth confusing it with.
function profileStatuses(standardText) {
  const found = new Set();
  for (const line of standardText.split('\n')) {
    if (!/profile status/i.test(line)) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const v = m[1].trim();
      if (/^[a-z][a-z0-9-]*$/.test(v)) found.add(v);
    }
  }
  return found;
}

function walkNotes(dir, vault, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkNotes(abs, vault, acc);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      acc.push(abs);
    }
  }
  return acc;
}

const argv = process.argv.slice(2);
if (argv.length !== 1 || argv[0].startsWith('-')) usage();
const vault = resolve(argv[0]);
if (!existsSync(vault) || !statSync(vault).isDirectory()) {
  console.error(`x not a directory: ${vault}`);
  process.exit(2);
}
const rel = (p) => p.slice(vault.length + 1).replaceAll('\\', '/');

// ---- 1. Standard.md and its version -----------------------------------------------
const standardPath = join(vault, 'Standard.md');
let statuses = new Set(BASE_STATUSES);
let standardText = '';
if (!existsSync(standardPath)) {
  fail('Standard.md is missing from the vault root — the vault has no conformance copy, so nothing states which standard it claims to follow');
} else {
  try { standardText = readFileSync(standardPath, 'utf8'); }
  catch (e) { fail(`Standard.md cannot be read: ${e.message}`); }
  const fm = frontmatter(standardText);
  if (!fm) fail('Standard.md has no YAML frontmatter block');
  else if (!fm['standard-version']) fail("Standard.md frontmatter has no `standard-version` — an unversioned conformance copy cannot be told from a stale one");
  for (const s of profileStatuses(standardText)) statuses.add(s);
}

// ---- 2-4. Folder layout -------------------------------------------------------------
const topDirs = readdirSync(vault, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name);
const topSet = new Set(topDirs);
const machinerySet = new Set(MACHINERY);

for (const m of MACHINERY) {
  if (topSet.has(m)) continue;
  if (OPTIONAL_MACHINERY.has(m)) warn(`machinery folder '${m}/' is absent — expected when a profile gitignores it, a violation otherwise`);
  else fail(`machinery folder '${m}/' is missing`);
}

const domains = [];
for (const name of topDirs) {
  const m = NUMBERED_DIR.exec(name);
  if (!m) continue;
  const band = Number(m[1]);
  if (band >= 80 && !machinerySet.has(name))
    fail(`folder '${name}/' sits in the reserved machinery band (80-99) but is not a machinery folder — renumber it into the 10-79 domain band`);
  if (band >= 10 && band <= 79) domains.push(name);
}
if (domains.length === 0)
  fail('no domain folder in the 10-79 band — a vault of machinery alone holds no judgment and nothing routes to it');

// ---- 5. Note frontmatter -------------------------------------------------------------
for (const abs of walkNotes(vault, vault, [])) {
  const name = basename(abs);
  const stem = name.slice(0, -3);
  if (abs === standardPath) continue;
  if (name === 'README.md' && rel(abs) === 'README.md') continue;
  if (UPPER_SNAKE.test(stem)) continue; // canonical suite artifact, parsed by other tools
  let text;
  try { text = readFileSync(abs, 'utf8'); }
  catch (e) { fail(`${rel(abs)}: cannot read: ${e.message}`); continue; }
  const fm = frontmatter(text);
  if (!fm) { fail(`${rel(abs)}: no YAML frontmatter block`); continue; }
  for (const key of ['type', 'status', 'updated'])
    if (!fm[key]) fail(`${rel(abs)}: frontmatter has no \`${key}\``);
  if (fm.status && !statuses.has(fm.status))
    fail(`${rel(abs)}: status '${fm.status}' is not one of ${[...statuses].join(', ')} — a profile adds a status by declaring it in Standard.md`);
  if (fm.updated && !DATE_RE.test(fm.updated))
    fail(`${rel(abs)}: updated '${fm.updated}' is not a YYYY-MM-DD date`);
}

// ---- report ---------------------------------------------------------------------------
for (const w of warnings) console.log(`  ..  WARN  ${w}`);
if (violations.length) {
  for (const v of violations) console.log(`  !!  VIOLATION  ${v}`);
  console.log(`\n${violations.length} vault conformance violation(s) in ${vault}.`);
  process.exit(1);
}
console.log(`(vault) OK ${vault} — layout, Standard.md, and note frontmatter conform${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
