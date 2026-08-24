#!/usr/bin/env node
// Vault conformance checker for the code-ops suite — the per-repo Obsidian vault standard
// (code-ops-docs/40 Engineering/Techniques/vault-standard.md). Runs against a vault directory in any repo.
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
//   1. `Standard.md` exists at the vault root and its frontmatter carries a `standard-version`
//      of at least MIN_STANDARD_VERSION — the conformance copy is what makes the vault
//      self-describing offline, and the version is what makes a stale copy visible. A version
//      that is merely present proves nothing, so the pinned floor is what gives it teeth.
//   2. `00 Home.md` and `README.md` exist at the vault root: the content map an agent enters
//      through, and the git host's entry point to the folder.
//   3. The machinery folders exist: `00 Inbox`, `90 Templates`, `95 Attachments`, `98 System`,
//      `99 Archive`. `80 Runs` is a WARNING when absent, never a failure: a profile may gitignore
//      it (the code-ops profile does), so a fresh clone legitimately has no such directory.
//   4. Every top-level folder carries the two-digit numeric prefix. An un-numbered folder sorts
//      outside the band scheme and is the signature of a half-finished migration.
//   5. Every two-digit-prefixed top-level folder in the 80-99 band is one of the machinery
//      folders. The band is reserved; a domain folder numbered into it breaks the sidebar
//      contract and hides itself among the bookkeeping.
//   6. Nothing is numbered below 10 except `00 Inbox`, the only such folder the standard defines.
//   7. At least one domain folder exists in the 10-79 band. A vault with only machinery holds
//      no judgment, so nothing routes to it.
//   8. Every `.md` note carries `type`, `status`, and `updated` frontmatter.
//   9. `status` is one of `draft`, `current`, `accepted`, `superseded`, or a profile status the
//      vault's own Standard.md declares.
//  10. `updated` is a YYYY-MM-DD date.
//
// WHAT IT DELIBERATELY DOES NOT CHECK (and why)
//   - `.obsidian/` — Obsidian's own config, not notes.
//   - `90 Templates/` — templates carry placeholder frontmatter (`{{date:YYYY-MM-DD}}`), which
//     is correct for a template and invalid for a note.
//   - The vault-root `README.md` — the git host's entry point to the folder, not a vault note;
//     frontmatter would render as noise on the host. Rule 2 checks that it exists; rule 8 skips it.
//   - Canonical suite artifacts, whose grammar other tools parse. The standard keeps their
//     filenames and their format unchanged inside a run folder; adding frontmatter to one would
//     break the reader it was written for. Two arms recognise them, and a filename needs only one:
//     the explicit CANONICAL_ARTIFACTS list below, and the UPPER_SNAKE shape rule.
//
// A profile status is declared by writing the phrase `profile status` immediately followed by the
// value in backticks, e.g. "`lab-entry` notes use the profile status `recorded`". Only that one
// token counts, so a sentence that also names note types in backticks declares no extra statuses.
// The declaration therefore lives in the same prose a human reads, rather than in a second list
// that drifts from it.
//
// Exit: 0 conformant (one-line OK); 1 at least one violation; 2 usage error.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const MACHINERY = ['00 Inbox', '80 Runs', '90 Templates', '95 Attachments', '98 System', '99 Archive'];
// `80 Runs` is the one machinery folder a profile may leave off disk (gitignored run artifacts).
const OPTIONAL_MACHINERY = new Set(['80 Runs']);
const BASE_STATUSES = ['draft', 'current', 'accepted', 'superseded'];
const NUMBERED_DIR = /^(\d{2}) (.+)$/;
// The lowest `standard-version` this checker accepts. Bump it in the same change that makes a
// vault-standard revision binding, and publish the new value in the SSOT prose
// (code-ops-docs/40 Engineering/Techniques/vault-standard.md) so a vault author can read the number they must reach.
const MIN_STANDARD_VERSION = 3;
// The canonical run artifacts of code-ops-docs/40 Engineering/Techniques/vault-standard.md's artifact table. They are
// exempt from the note rules by name, not by stem shape, because a bare all-caps stem
// (`HANDOFF`) is indistinguishable from an ordinary note (`README`, `TODO`, `NOTES`) and the
// shape rule below therefore refuses it. Listing them is what keeps that refusal safe.
const CANONICAL_ARTIFACTS = new Set([
  'FINDINGS_REGISTER.md',
  'LEAK_REGISTER.md',
  'EXECUTIVE_SUMMARY.md',
  'DISPATCH_LEDGER.md',
  'REPO_MAP.md',
  'REFUTATION_LOG.md',
  'RUN_RECEIPTS.md',
  'HANDOFF.md',
  'EGRESS_MANIFEST.md',
]);
// The second arm, for the open-ended rest of the family (`SSOT_MAP.md`, `GROUND_TRUTH.md`,
// `ACCEPTANCE_REVIEW.md`, and whatever a future skill names): at least one underscore is
// required, because a bare all-caps stem is an ordinary note and exempting the shape outright
// would let a per-folder README skip every frontmatter rule. A bare stem is exempt only by
// being named in CANONICAL_ARTIFACTS above.
const UPPER_SNAKE = /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', '.local-legacy', '90 Templates']);
const MANIFEST_STATUSES = new Set(['current', 'not-applicable']);

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
    if (m) out[m[1]] = unquote(m[2].trim());
  }
  return out;
}

// YAML lets a scalar be written bare, single-quoted, or double-quoted, and the three mean the
// same thing. Strip one matched surrounding pair so `status: "draft"` is the value `draft`, not
// the value `"draft"` — rejecting a legal spelling of a legal value is a false violation, and a
// false violation in a fail-closed gate is what teaches a reader to bypass it. Only a matched
// pair is stripped, so an apostrophe or an unbalanced quote survives into the value and is
// reported, as it should be.
function unquote(v) {
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0])
    return v.slice(1, -1);
  return v;
}

// Profile statuses are declared in prose: the phrase `profile status` immediately followed by the
// value in backticks. Only the token in that position counts — scavenging every backticked token
// on the line would admit note types named in the same sentence, which is fail-open exactly for
// the vaults that extend the vocabulary.
function profileStatuses(standardText) {
  const found = new Set();
  for (const m of standardText.matchAll(/profile status\s+`([^`]+)`/gi)) {
    const v = m[1].trim();
    if (/^[a-z][a-z0-9-]*$/.test(v)) found.add(v);
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

// The manifest owns published reference targets, not arbitrary note folders. The shared vault
// layout publishes references in the 30-79 domain bands, ADRs under 20 Decisions/ADRs, and the
// Atlas under 98 System/Atlas. Keeping this boundary here prevents an extra manifest domain from
// turning a working-note band such as 10 Design into a blanket frontmatter exemption.
function isPublishedManifestTarget(domain) {
  if (!domain || typeof domain.path !== 'string' || !MANIFEST_STATUSES.has(domain.status)) return false;
  const path = domain.path.replaceAll('\\', '/').replace(/\/$/, '');
  if (path === '20 Decisions/ADRs' || path.startsWith('20 Decisions/ADRs/')) return true;
  if (path === '98 System/Atlas' || path.startsWith('98 System/Atlas/')) return true;
  const match = /^(\d{2}) [^/]+(?:\/|$)/.exec(path);
  if (!match) return false;
  const band = Number(match[1]);
  return band >= 30 && band <= 79;
}

const argv = process.argv.slice(2);
if (argv.length !== 1 || argv[0].startsWith('-')) usage();
const vault = resolve(argv[0]);
if (!existsSync(vault) || !statSync(vault).isDirectory()) {
  console.error(`x not a directory: ${vault}`);
  process.exit(2);
}
const rel = (p) => p.slice(vault.length + 1).replaceAll('\\', '/');
const manifestOwned = new Set();
const generatedRecords = new Set();
let docsManifestVersion = null;
const docsManifestPath = join(vault, '98 System', 'DOCS_MANIFEST.json');
if (existsSync(docsManifestPath)) {
  try {
    const docsManifest = JSON.parse(readFileSync(docsManifestPath, 'utf8'));
    docsManifestVersion = docsManifest.version;
    if (![1, 2].includes(docsManifest.version) || docsManifest.hub !== basename(vault) || !Array.isArray(docsManifest.domains)) {
      fail('98 System/DOCS_MANIFEST.json does not declare this vault as its version 1 or 2 hub');
    } else for (const domain of docsManifest.domains) {
      if (isPublishedManifestTarget(domain)) manifestOwned.add(domain.path.replaceAll('\\', '/').replace(/\/$/, ''));
    }
    if (docsManifest.version === 2) {
      if (!Array.isArray(docsManifest.recordCollections)) fail('manifest version 2 has no recordCollections array');
      for (const collection of docsManifest.recordCollections || []) for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
        if (typeof collection?.[key] === 'string') generatedRecords.add(collection[key].replaceAll('\\', '/'));
      }
    }
  } catch (error) { fail(`98 System/DOCS_MANIFEST.json cannot be parsed: ${error.message}`); }
}

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
  else {
    const v = Number(fm['standard-version']);
    if (!Number.isFinite(v))
      fail(`Standard.md frontmatter has \`standard-version: ${fm['standard-version']}\`, which is not a number — the version must be an integer this checker can compare against ${MIN_STANDARD_VERSION}`);
    else if (v < MIN_STANDARD_VERSION)
      fail(`Standard.md claims \`standard-version: ${v}\`, below the current standard-version ${MIN_STANDARD_VERSION} — re-copy the body from code-ops-docs/40 Engineering/Techniques/vault-standard.md, re-append the profile, and bump the stamp`);
    else if (docsManifestVersion === 2 && v < 4)
      fail('Standard.md must claim `standard-version: 4` or newer when DOCS_MANIFEST.json uses version 2');
  }
  for (const s of profileStatuses(standardText)) statuses.add(s);
}

// ---- 2. The two vault-root files ---------------------------------------------------
for (const f of ['00 Home.md', 'README.md']) {
  if (!existsSync(join(vault, f)))
    fail(`'${f}' is missing from the vault root — the standard puts the content map (\`00 Home.md\`) and the git host's entry point (\`README.md\`) there`);
}

// ---- 3-7. Folder layout -------------------------------------------------------------
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
  if (!m) {
    // Skipping this used to make the folder invisible, so a migration that renamed half the tree
    // and stopped still exited 0. An un-numbered folder is the signature of that half-finished
    // state, which is the case the checker most needs to catch.
    fail(`folder '${name}/' has no two-digit numeric prefix — every top-level vault folder is numbered ('00 Inbox/', '10 Design/', '80 Runs/'); rename it into the band it belongs to`);
    continue;
  }
  const band = Number(m[1]);
  if (band >= 80 && !machinerySet.has(name))
    fail(`folder '${name}/' sits in the reserved machinery band (80-99) but is not a machinery folder — renumber it into the 10-79 domain band`);
  if (band < 10 && !machinerySet.has(name))
    fail(`folder '${name}/' is numbered below 10, where '00 Inbox/' is the only folder the standard defines — renumber it into the 10-79 domain band`);
  if (band >= 10 && band <= 79) domains.push(name);
}
if (domains.length === 0)
  fail('no domain folder in the 10-79 band — a vault of machinery alone holds no judgment and nothing routes to it');

// ---- 8-10. Note frontmatter -----------------------------------------------------------
for (const abs of walkNotes(vault, vault, [])) {
  const name = basename(abs);
  const stem = name.slice(0, -3);
  if (abs === standardPath) continue;
  if (name === 'README.md' && rel(abs) === 'README.md') continue;
  const notePath = rel(abs);
  if (generatedRecords.has(notePath)) continue;
  if ([...manifestOwned].some((owned) => notePath === owned || notePath.startsWith(`${owned}/`))) continue;
  // Canonical suite artifact, parsed by other tools: named in the list, or all-caps with an
  // underscore. `README.md` is already past, and no other bare stem reaches either arm.
  if (CANONICAL_ARTIFACTS.has(name) || UPPER_SNAKE.test(stem)) continue;
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
