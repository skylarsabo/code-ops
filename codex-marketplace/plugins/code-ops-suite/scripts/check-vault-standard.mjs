#!/usr/bin/env node
// Vault conformance checker for the code-ops suite — the per-repo Obsidian vault standard
// (code-ops-docs/40 Engineering/Techniques/vault-standard.md). Runs against a vault directory in any repo.
//
//   node scripts/check-vault-standard.mjs <vault-dir>                check (default)
//   node scripts/check-vault-standard.mjs <vault-dir> --render       write the generated surfaces
//   node scripts/check-vault-standard.mjs <vault-dir> --stamp <page> record a page's sourceDigest
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
//   9. `status` is one of `draft`, `current`, `accepted`, `superseded`, or a profile status. Manifest
//      v3 declares profile statuses in `drafts.statuses`; otherwise they come from the
//      vault's own Standard.md prose.
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
// DRAFT RULES (manifest v3 only). They apply only when DOCS_MANIFEST.json is version 3, so a
// version 1 or 2 vault sees no new failure from an upgrade until it opts in. Design:
// code-ops-docs/10 Design/Program state handoffs and coordination 2026-09.md, W4.
//  11. `status` must come from `drafts.statuses`. The manifest list replaces the built-in and
//      prose vocabulary, so it is the one place a status is declared.
//  12. `superseded` needs a `superseded-by` frontmatter link (`[[Note]]`, or a vault path) that
//      resolves to another note in the vault.
//  13. A `draft` whose first 30 lines carry an uppercase PROMOTED or SUPERSEDED marker fails: the
//      note already left the draft state and its status must say so.
//  14. `10 Design/INDEX.md` and `98 System/TRIAGE.md` are generated. Check mode fails when either
//      is missing or differs from what --render would write. Triage items are a `draft` older than
//      `drafts.maxAgeDays` (by `updated`) with no `next:` line, and a `type: synthesis` note with
//      no `sources:` and no update within `drafts.maxAgeDays`. A file under `99 Archive/` is never
//      an item, because an archived file moves whole and keeps its status. An item stays listed until its
//      cause clears and keeps the date it first entered the queue. Triage is a queue, never a
//      failure by itself.
//  15. A note that declares `sources:` (globs, as a flow list, a comma list, or a block list) fails
//      when the files those globs match no longer hash to its `sourceDigest:` frontmatter value.
//      The digest is docs-manifest.mjs's own (matchSources + hashPaths), taken over the git file
//      list of the repository holding the vault, excluding the page itself. `--stamp <page>`
//      records the current digest. The page's frontmatter is the only place the digest lives.
//
// DECISION REGISTER (any manifest version; the gate is the file's presence).
//  16. A vault that carries `20 Decisions/REGISTER.md` keeps it whole.
//      Row ids come from five families (D, ADR, DEC, EVO, RBS) and are unique. Every `DEC-<n>`
//      cited in the vault has a row, every decision note and ADR has a row, and every committed
//      link in a Source cell resolves. A run folder or program ledger is a code-span path under
//      `80 Runs/`, checked for form only: that folder is gitignored and absent from CI, so a link
//      into it fails. Section 16 below states the rest.
//
// Exit: 0 conformant (one-line OK), rendered, or stamped; 1 at least one violation or a failed
// render/stamp; 2 usage error. --render on a vault whose manifest is not version 3 writes nothing
// and exits 0.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, basename, dirname } from 'node:path';
import { git } from './cli-lib.mjs';

const MACHINERY = ['00 Inbox', '80 Runs', '90 Templates', '95 Attachments', '98 System', '99 Archive'];
// `80 Runs` is the one machinery folder a profile may leave off disk (gitignored run artifacts).
const OPTIONAL_MACHINERY = new Set(['80 Runs']);
const BASE_STATUSES = ['draft', 'current', 'accepted', 'superseded'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // must match SLUG_RE in docs-manifest.mjs
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
  console.error('usage: check-vault-standard.mjs <vault-dir> [--render | --stamp <page>]');
  process.exit(2);
}

// Minimal YAML front-matter reader: the leading `---` block, `key: value` at top level only.
// Deliberately not a YAML parser — the four fields this checker rules on are all scalars, and a
// dependency-free repo may not grow one for a conformance check.
const LISTS = Symbol('block lists');
function frontmatter(text) {
  const body = text.replace(/^﻿/, '');
  if (!/^---\r?\n/.test(body)) return null;
  const end = body.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = body.slice(4, end);
  const out = { [LISTS]: {} };
  let last = null;
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (/^\s/.test(line)) {
      // A block-list item under an empty key is kept apart from the scalar, so a key written as a
      // list never satisfies a rule that reads it as a scalar. Other nested lines stay ignored.
      const item = /^\s+-\s+(.+)$/.exec(line);
      if (item && last && out[last] === '') (out[LISTS][last] ??= []).push(unquote(item[1].trim()));
      continue;
    }
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) { out[m[1]] = unquote(m[2].trim()); last = m[1]; }
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

// Untracked paths git ignores under the vault, relative to it, with a wholly ignored directory
// ending in `/`. Local scratch such as `80 Runs/` is absent from CI, so ruling on it would make
// a local run fail where CI passes. `--others` lists only untracked paths, so a tracked note is
// never skipped even when an ignore pattern matches it. Outside a git work tree, or when git
// fails, the set is empty and every note is checked, so a git failure can only widen coverage.
function gitIgnored(dir) {
  let out;
  try { out = git(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z', '--', '.'], { cwd: dir }); }
  catch { return new Set(); }
  return new Set(out.split('\0').filter((p) => p !== '' && p !== './'));
}

function walkNotes(dir, vault, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || ignored.has(`${rel(abs)}/`)) continue;
      walkNotes(abs, vault, acc);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !ignored.has(rel(abs))) {
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
let mode = 'check';
let stampPage = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--render' && mode === 'check') mode = 'render';
  else if (argv[i] === '--stamp' && mode === 'check' && i + 1 < argv.length && !argv[i + 1].startsWith('-')) { mode = 'stamp'; stampPage = argv[++i].replaceAll('\\', '/'); }
  else if (argv[i].startsWith('-')) usage();
  else positional.push(argv[i]);
}
if (positional.length !== 1) usage();
const vault = resolve(positional[0]);
if (!existsSync(vault) || !statSync(vault).isDirectory()) {
  console.error(`x not a directory: ${vault}`);
  process.exit(2);
}
const ignored = gitIgnored(vault);
const rel = (p) => p.slice(vault.length + 1).replaceAll('\\', '/');
const manifestOwned = new Set();
const generatedRecords = new Set();
// Hub-relative folders of the manifest record collections whose root sits inside this hub.
const recordRoots = new Set();
let docsManifestVersion = null;
// Manifest v3 declares draft statuses in `drafts.statuses`, which replaces the profile prose.
let manifestStatuses = null;
let maxAgeDays = null;
const docsManifestPath = join(vault, '98 System', 'DOCS_MANIFEST.json');
if (existsSync(docsManifestPath)) {
  try {
    const docsManifest = JSON.parse(readFileSync(docsManifestPath, 'utf8'));
    docsManifestVersion = docsManifest.version;
    if (![1, 2, 3].includes(docsManifest.version) || docsManifest.hub !== basename(vault) || !Array.isArray(docsManifest.domains)) {
      fail('98 System/DOCS_MANIFEST.json does not declare this vault as its version 1, 2, or 3 hub');
    } else for (const domain of docsManifest.domains) {
      if (isPublishedManifestTarget(domain)) manifestOwned.add(domain.path.replaceAll('\\', '/').replace(/\/$/, ''));
    }
    if (docsManifest.version === 2 || docsManifest.version === 3) {
      if (!Array.isArray(docsManifest.recordCollections)) fail(`manifest version ${docsManifest.version} has no recordCollections array`);
      for (const collection of docsManifest.recordCollections || []) for (const key of ['inventory', 'citations', 'curationLedger', 'index']) {
        if (typeof collection?.[key] === 'string' && collection[key].startsWith('98 System/Records/')) generatedRecords.add(collection[key].replaceAll('\\', '/'));
      }
      // A collection root is repo-relative. One that a relocation moved into the hub holds record
      // bytes, which are immutable and hash-chained, so they cannot gain note frontmatter. Only a
      // strict subfolder of the hub with plain segments counts: a root of the hub itself, `.`, or
      // `..` would exempt notes it does not own.
      for (const collection of docsManifest.recordCollections || []) {
        const root = typeof collection?.root === 'string' ? collection.root.replaceAll('\\', '/').replace(/\/$/, '') : '';
        const inside = root.startsWith(`${basename(vault)}/`) ? root.slice(basename(vault).length + 1) : '';
        if (inside && inside.split('/').every((part) => part && part !== '.' && part !== '..')) recordRoots.add(inside);
      }
    }
    if (docsManifest.version === 3) {
      const listed = docsManifest.drafts?.statuses;
      if (!Array.isArray(listed) || !listed.length || !listed.every((s) => typeof s === 'string' && SLUG_RE.test(s)))
        fail('manifest version 3 has no valid drafts.statuses array');
      else manifestStatuses = listed;
      const age = docsManifest.drafts?.maxAgeDays;
      if (!Number.isInteger(age) || age < 1) fail('manifest version 3 has no valid drafts.maxAgeDays positive integer');
      else maxAgeDays = age;
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
      fail(`Standard.md claims \`standard-version: ${v}\`, below the current standard-version ${MIN_STANDARD_VERSION} — re-copy the body from reference/vault-standard.md bundled with the code-ops-suite plugin, re-append the profile, and bump the stamp`);
    else if (docsManifestVersion === 2 && v < 4)
      fail('Standard.md must claim `standard-version: 4` or newer when DOCS_MANIFEST.json uses version 2');
    else if (docsManifestVersion === 3 && v < 5)
      fail('Standard.md must claim `standard-version: 5` or newer when DOCS_MANIFEST.json uses version 3');
  }
  if (!manifestStatuses) for (const s of profileStatuses(standardText)) statuses.add(s);
}
// Manifest v3 makes drafts.statuses the whole vocabulary (rule 11), not an addition to it.
if (manifestStatuses) statuses = new Set(manifestStatuses);
const draftRules = manifestStatuses !== null && maxAgeDays !== null;
const INDEX_PATH = '10 Design/INDEX.md';
const TRIAGE_PATH = '98 System/TRIAGE.md';
// The generated surfaces are exempt from the note rules by exact path, like the generated record
// indexes, because they carry no note frontmatter. Rule 14 fails either file unless it equals
// what --render writes, so the exemption cannot hide hand-written content.
if (draftRules) { generatedRecords.add(INDEX_PATH); generatedRecords.add(TRIAGE_PATH); }

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
const walked = walkNotes(vault, vault, []);
// Every walked note, exempt or not, is a legal `superseded-by` target; only the checked ones carry rules.
const noteStems = walked.map((abs) => rel(abs).replace(/\.md$/i, ''));
const checked = [];
for (const abs of walked) {
  const name = basename(abs);
  const stem = name.slice(0, -3);
  if (abs === standardPath) continue;
  if (name === 'README.md' && rel(abs) === 'README.md') continue;
  const notePath = rel(abs);
  if (generatedRecords.has(notePath)) continue;
  if ([...recordRoots].some((root) => notePath.startsWith(`${root}/`))) continue;
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
    fail(`${rel(abs)}: status '${fm.status}' is not one of ${[...statuses].join(', ')} — ${manifestStatuses ? 'a v3 vault declares its statuses in DOCS_MANIFEST.json drafts.statuses' : 'a profile adds a status by declaring it in Standard.md'}`);
  if (fm.updated && !DATE_RE.test(fm.updated))
    fail(`${rel(abs)}: updated '${fm.updated}' is not a YYYY-MM-DD date`);
  checked.push({ path: notePath, text, fm });
}

// ---- 16. Decision register (opt in by writing `20 Decisions/REGISTER.md`) -----------------------
// One table row per recorded decision: ID | Date | Decision | Status | Source. A vault with no
// register is silent, like D-002 says of vault adoption itself. A vault with one gets four checks:
// ids are unique, every id cited as `DEC-<n>` anywhere in the vault has a row, every decision note
// (`20 Decisions/D-NNN ...`, `20 Decisions/ADRs/NNNN-...`) has a row, and every committed link in
// a Source cell resolves. A run folder or program ledger lives under `80 Runs/`, which is
// gitignored and absent from CI (scripts/check-doc-links.mjs skips that folder for the same
// reason), so a Source cell names it as a code-span path, never a link. The path is checked for
// form and never for existence. A link into `80 Runs/` fails: it resolves on one machine only.
const REGISTER_PATH = '20 Decisions/REGISTER.md';
const REGISTER_STATUSES = new Set(['in-force', 'amended', 'superseded', 'historical']);
// Five id families: D-NNN decision notes, ADR-NNNN records, DEC-N program-ledger decisions, and the
// register-local EVO-N and RBS-N for the two ledgers whose entries carry no number of their own.
const REGISTER_ID = /^(?:D-\d+|ADR-\d{4}|DEC-\d+|EVO-\d+|RBS-\d+)$/;
const LEDGER_ID = /^(?:DEC|EVO|RBS)-/;
// A run source is well formed under `80 Runs/`, with no backslash, no `.` or `..` segment, and no edge space.
const runSourceOk = (p) => p.startsWith('80 Runs/') && !p.includes('\\') && p === p.trim() && !p.split('/').some((s) => s === '.' || s === '..');
const LEDGER_SOURCE = /^80 Runs\/programs\/[^/]+\/PROGRAM[^/]*\.md$/;
const DECISION_NOTE = /^20 Decisions\/(D-\d+)[ .]/;
const ADR_NOTE = /^20 Decisions\/ADRs\/(\d{4})-/;

function registerLinkTargets(cell) {
  const targets = [];
  for (const m of cell.matchAll(/\[\[([^\]]+)\]\]/g)) targets.push({ wiki: true, target: m[1].split('|')[0].split('#')[0].trim() });
  for (const m of cell.matchAll(/\]\(([^)\s]+)[^)]*\)/g)) {
    if (/^(?:https?:|mailto:)/i.test(m[1])) continue;
    let target = m[1].split('#')[0];
    try { target = decodeURIComponent(target); } catch { /* an undecodable target fails to resolve below */ }
    targets.push({ wiki: false, target });
  }
  return targets;
}

function checkRegister() {
  const registerFile = join(vault, REGISTER_PATH);
  if (!existsSync(registerFile)) return;
  let text;
  try { text = readFileSync(registerFile, 'utf8'); }
  catch (e) { fail(`${REGISTER_PATH}: cannot read: ${e.message}`); return; }
  const ids = new Set();
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
    if (cells[0] === 'ID' || cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const id = cells[0];
    const where = `${REGISTER_PATH}: row ${id || '(no id)'}`;
    if (cells.length !== 5) { fail(`${where} has ${cells.length} cells, not the 5 of ID | Date | Decision | Status | Source`); continue; }
    if (!REGISTER_ID.test(id)) fail(`${where}: the id must look like D-004, ADR-0002, DEC-73, EVO-1, or RBS-1`);
    else if (ids.has(id)) fail(`${where}: the id appears twice`);
    ids.add(id);
    const [, date, decision, status, source] = cells;
    if (!DATE_RE.test(date)) fail(`${where}: date '${date}' is not a YYYY-MM-DD date`);
    if (!decision) fail(`${where}: the decision text is empty`);
    if (!REGISTER_STATUSES.has(status)) fail(`${where}: status '${status}' is not one of ${[...REGISTER_STATUSES].join(', ')}`);
    const spans = [...source.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((s) => s.startsWith('80 Runs/'));
    for (const span of spans) if (!runSourceOk(span)) fail(`${where}: source path \`${span}\` is malformed: name it as \`80 Runs/<folder>/...\` with no backslash and no \`..\` segment`);
    const links = registerLinkTargets(source);
    for (const { wiki, target } of links) {
      if (/(?:^|\/)80 Runs(?:\/|$)/.test(target.replaceAll('\\', '/'))) { fail(`${where}: a link into 80 Runs/ resolves on one machine only. Write the path as a code span`); continue; }
      const stem = target.replace(/\.md$/i, '');
      const found = wiki
        ? stem !== '' && noteStems.some((s) => s === stem || s.endsWith(`/${stem}`))
        : target !== '' && existsSync(resolve(dirname(registerFile), target));
      if (!found) fail(`${where}: link target '${target}' does not resolve`);
    }
    if (!spans.length && !links.length) fail(`${where}: the Source cell cites no run folder, program ledger, or committed note`);
    if (LEDGER_ID.test(id) && !spans.some((s) => LEDGER_SOURCE.test(s))) fail(`${where}: a DEC, EVO, or RBS row must cite its program ledger as \`80 Runs/programs/<slug>/PROGRAM.md\``);
  }
  for (const abs of walked) {
    const path = rel(abs);
    if (path === REGISTER_PATH) continue;
    const owed = DECISION_NOTE.exec(path)?.[1] ?? (ADR_NOTE.exec(path) ? `ADR-${ADR_NOTE.exec(path)[1]}` : null);
    if (owed && !ids.has(owed)) fail(`${path}: decision ${owed} has no row in ${REGISTER_PATH}`);
    let body;
    try { body = readFileSync(abs, 'utf8'); }
    catch (e) { fail(`${path}: cannot read: ${e.message}`); continue; }
    for (const cited of new Set(body.match(/\bDEC-\d+\b/g) ?? []))
      if (!ids.has(cited)) fail(`${path}: cites ${cited}, which has no row in ${REGISTER_PATH}`);
  }
}
checkRegister();

// ---- 11-15. Draft rules, generated surfaces, and source digests (manifest v3 only) ------------
const MS_PER_DAY = 86_400_000;
const today = new Date().toISOString().slice(0, 10);
const ageDays = (updated) => (Date.parse(today) - Date.parse(updated)) / MS_PER_DAY;
const PROMOTION_MARKER = /\b(?:PROMOTED|SUPERSEDED)\b/;
const ARCHIVE_DIR = '99 Archive/';
const nextLine = (text) => /^\s*next:[ \t]*(\S.*)$/im.exec(text)?.[1].trim() ?? null;

// `superseded-by: [[Name#heading|alias]]`, `[[dir/Name.md]]`, or a bare vault path. A bare name
// resolves like an Obsidian link: by full vault path, or by file name anywhere in the vault.
function supersededByResolves(value, ownPath) {
  const inner = /^\[\[([^\]]+)\]\]$/.exec(value.trim())?.[1] ?? value.trim();
  const target = inner.split('|')[0].split('#')[0].trim().replace(/\.md$/i, '');
  const own = ownPath.replace(/\.md$/i, '');
  return target !== '' && target !== own && noteStems.some((stem) => stem !== own && (stem === target || stem.endsWith(`/${target}`)));
}

const sourcePatterns = (fm) => {
  const scalar = fm.sources ?? '';
  const items = scalar === '' ? (fm[LISTS].sources ?? []) : scalar.replace(/^\[|\]$/g, '').split(',').map((v) => unquote(v.trim()));
  return items.filter(Boolean);
};

const triage = [];
const indexed = [];
const sourcePages = [];
if (draftRules) for (const { path, text, fm } of checked) {
  if (fm.status === 'superseded' && !(fm['superseded-by'] && supersededByResolves(fm['superseded-by'], path)))
    fail(`${path}: status superseded needs a \`superseded-by\` frontmatter link that resolves to another note in the vault`);
  if (fm.status === 'draft' && PROMOTION_MARKER.test(text.split('\n').slice(0, 30).join('\n')))
    fail(`${path}: a draft carries a PROMOTED or SUPERSEDED marker in its first 30 lines — set its status to match, or remove the marker`);
  // An archived file moved whole and keeps its frontmatter, so it is no live draft or page.
  const old = DATE_RE.test(fm.updated ?? '') && ageDays(fm.updated) > maxAgeDays && !path.startsWith(ARCHIVE_DIR);
  if (old && fm.status === 'draft' && nextLine(text) === null) triage.push({ path, rule: 'stale-draft' });
  const patterns = sourcePatterns(fm);
  if (old && fm.type === 'synthesis' && fm.status !== 'superseded' && !patterns.length) triage.push({ path, rule: 'unsourced-synthesis' });
  if (patterns.length) sourcePages.push({ path, patterns, recorded: fm.sourceDigest });
  if (path.startsWith('10 Design/') && DATE_RE.test(fm.updated ?? '')) indexed.push({ path, status: fm.status, updated: fm.updated, next: nextLine(text) });
}

// Rule 15's digest is docs-manifest.mjs's own, imported only when a page needs it.
async function pageDigest(path, patterns) {
  const { repoFiles, matchSources, hashPaths } = await import('./docs-manifest.mjs');
  const root = dirname(vault);
  const self = `${basename(vault)}/${path}`;
  const paths = matchSources(repoFiles(root), patterns, (file) => file === self);
  return { count: paths.length, digest: paths.length ? hashPaths(root, paths) : null };
}
if (draftRules && mode === 'check') for (const page of sourcePages) {
  let found;
  try { found = await pageDigest(page.path, page.patterns); }
  catch (e) { fail(`${page.path}: cannot compute the sources digest: ${e.message.split('\n')[0]}`); continue; }
  if (!found.count) fail(`${page.path}: sources ${page.patterns.join(', ')} match no repository files`);
  else if (!page.recorded) fail(`${page.path}: declares sources but no \`sourceDigest:\` — run check-vault-standard.mjs <vault> --stamp "${page.path}"`);
  else if (page.recorded !== found.digest) fail(`${page.path}: a source changed after its recorded sourceDigest — review the page against its sources, then run check-vault-standard.mjs <vault> --stamp "${page.path}"`);
}

const TRIAGE_LINE = /^- (.+) \| ([a-z-]+) \| (\d{4}-\d{2}-\d{2})$/;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const GENERATED_NOTE = '<!-- Generated by check-vault-standard.mjs --render. Do not edit. -->';

function renderIndex() {
  const groups = new Map((manifestStatuses ?? []).map((s) => [s, []]));
  for (const entry of indexed) groups.get(entry.status)?.push(entry);
  const body = [];
  for (const [status, entries] of groups) {
    if (!entries.length) continue;
    body.push(`## ${status}`, '');
    for (const e of entries.sort((a, b) => byText(a.path, b.path)))
      body.push(`- [[${e.path.replace(/\.md$/i, '')}]] · updated ${e.updated} · next: ${e.next ?? '(none)'}`);
    body.push('');
  }
  return `---\ntype: index\ngenerated: true\n---\n\n${GENERATED_NOTE}\n\n# Design index\n\n${body.join('\n')}${body.length ? '' : 'No notes.\n'}`;
}

// An item already listed keeps its date. A new item enters today. Only the set of items can go
// stale, since a listed item's date is copied from the file, so the check never drifts by day.
function renderTriage(previous) {
  const dates = new Map();
  for (const line of previous.replace(/\r\n/g, '\n').split('\n')) {
    const m = TRIAGE_LINE.exec(line);
    const key = m && `${m[1]}\0${m[2]}`;
    if (m && (!dates.has(key) || m[3] < dates.get(key))) dates.set(key, m[3]);
  }
  const lines = triage.sort((a, b) => byText(a.path, b.path) || byText(a.rule, b.rule))
    .map((i) => `- ${i.path} | ${i.rule} | ${dates.get(`${i.path}\0${i.rule}`) ?? today}`);
  return `---\ntype: triage\ngenerated: true\n---\n\n${GENERATED_NOTE}\n\n# Triage queue\n\nOne line per item: path | rule | date entered.\n\n${lines.length ? `${lines.join('\n')}\n` : 'No open items.\n'}`;
}

const readOrEmpty = (path) => { try { return readFileSync(join(vault, path), 'utf8'); } catch { return ''; } };
const surfaces = () => [
  ...(existsSync(join(vault, '10 Design')) ? [[INDEX_PATH, renderIndex()]] : []),
  [TRIAGE_PATH, renderTriage(readOrEmpty(TRIAGE_PATH))],
];

if (draftRules && mode === 'check') for (const [path, expected] of surfaces()) {
  const actual = readOrEmpty(path).replace(/\r\n/g, '\n');
  if (actual === '') fail(`${path} is missing — it is generated: run check-vault-standard.mjs <vault> --render`);
  else if (actual !== expected) fail(`${path} is stale against the vault — it is generated: run check-vault-standard.mjs <vault> --render`);
}

if (mode === 'render') {
  if (docsManifestVersion !== 3) { console.log('(vault) render skipped: DOCS_MANIFEST.json is not version 3, so there are no generated surfaces'); process.exit(0); }
  if (!draftRules) { for (const v of violations) console.log(`  !!  VIOLATION  ${v}`); process.exit(1); }
  if (!existsSync(join(vault, '98 System'))) { console.error("x '98 System/' is missing, so TRIAGE.md has nowhere to render"); process.exit(1); }
  const written = [];
  for (const [path, text] of surfaces()) { writeFileSync(join(vault, path), text); written.push(path); }
  console.log(`(vault) rendered ${written.join(', ')} — ${triage.length} triage item(s)`);
  process.exit(0);
}

if (mode === 'stamp') {
  const page = sourcePages.find((p) => p.path === stampPage);
  if (!draftRules) { console.error('x --stamp needs a valid manifest version 3 vault'); process.exit(1); }
  if (!page) { console.error(`x ${stampPage} is not a checked note in this vault that declares \`sources:\``); process.exit(1); }
  let found;
  try { found = await pageDigest(page.path, page.patterns); }
  catch (e) { console.error(`x cannot compute the sources digest: ${e.message.split('\n')[0]}`); process.exit(1); }
  if (!found.count) { console.error(`x sources ${page.patterns.join(', ')} match no repository files`); process.exit(1); }
  const file = join(vault, page.path);
  const eol = readFileSync(file, 'utf8').includes('\r\n') ? '\r\n' : '\n';
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const close = lines.indexOf('---', 1);
  const at = lines.findIndex((l, i) => i > 0 && i < close && /^sourceDigest:/.test(l));
  if (at === -1) lines.splice(close, 0, `sourceDigest: ${found.digest}`); else lines[at] = `sourceDigest: ${found.digest}`;
  writeFileSync(file, lines.join(eol));
  console.log(`(vault) stamped ${page.path} sourceDigest ${found.digest.slice(0, 12)} over ${found.count} file(s)`);
  process.exit(0);
}

// ---- report ---------------------------------------------------------------------------
for (const w of warnings) console.log(`  ..  WARN  ${w}`);
if (violations.length) {
  for (const v of violations) console.log(`  !!  VIOLATION  ${v}`);
  console.log(`\n${violations.length} vault conformance violation(s) in ${vault}.`);
  process.exit(1);
}
console.log(`(vault) OK ${vault} — layout, Standard.md, and note frontmatter conform${warnings.length ? ` (${warnings.length} warning(s))` : ''}.`);
