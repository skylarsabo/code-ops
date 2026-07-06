#!/usr/bin/env node
// Proof-manifest integrity checker — add-only protection for proof tests.
//
//   node scripts/check-proof-integrity.mjs record <PROOF_MANIFEST.md> <finding-id> <path...>
//   node scripts/check-proof-integrity.mjs verify <PROOF_MANIFEST.md> [--root <repo>] [--report-only]
//
// WHY: the canonical weak-agent cheat is editing a failing proof test until it passes — the
// test that demonstrated a finding quietly becomes a test that demonstrates nothing, and the
// finding "resolves" without the code changing. `record` pins each proof file's content
// against its finding id, one line per file:
//
//   <finding-id> <sha256-of-file> <repo-relative path>
//
// `verify` recomputes every pin and fails closed on any missing or hash-mismatched file. The
// ONLY sanctioned way to change a pinned file is an explicit, auditable amendment appended
// LATER in the manifest:
//
//   PROOF-AMENDED: <finding-id> <new-sha256> <reason>
//
// which re-pins that finding to the file's new content. Every amendment encountered is
// printed LOUDLY, even when it passes — silence is the failure mode this guards against.
// A deleted pinned file always fails: an amendment can re-pin content, not absence.
//
// Scope: add-only applies to manifest-listed paths ONLY. New files anywhere are fine — the
// tree is never scanned. Paths resolve against --root (default cwd) and must stay confined
// under it; escapes and unparseable manifest lines fail closed.
//
// Exit: non-zero on any missing/tampered/escaping pin or unparseable line, unless --report-only.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, sep } from 'node:path';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function usage() {
  console.error('usage: check-proof-integrity.mjs record <PROOF_MANIFEST.md> <finding-id> <path...>');
  console.error('       check-proof-integrity.mjs verify <PROOF_MANIFEST.md> [--root <repo>] [--report-only]');
  process.exit(2);
}

// ---------------------------------------------------------------- record

function cmdRecord(args) {
  const [manifest, findingId, ...paths] = args;
  if (!manifest || !findingId || paths.length === 0) usage();
  if (!/^[A-Za-z][\w.-]*$/.test(findingId)) { console.error(`x finding id must be a bare token like BUG-007 (got: ${findingId})`); process.exit(2); }
  const root = process.cwd();
  const pins = [];
  for (const p of paths) {
    const abs = resolve(root, p);
    const rel = relative(root, abs).replace(/\\/g, '/');
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) { console.error(`x ${p} escapes the repo root — refusing to pin it`); process.exit(2); }
    let buf;
    try { buf = readFileSync(abs); } catch (e) { console.error(`x cannot read ${p}: ${e.message}`); process.exit(2); }
    pins.push(`${findingId} ${sha256(buf)} ${rel}`);
  }
  const manifestPath = resolve(manifest);
  let text;
  try { text = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf8') : null; }
  catch (e) { console.error(`x cannot read manifest ${manifest}: ${e.message}`); process.exit(2); }
  if (text === null) {
    text = '# Proof manifest — sha256 pins for proof tests/fixtures (scripts/check-proof-integrity.mjs).\n'
      + '# One pin per line: <finding-id> <sha256> <repo-relative path>. Changing a pinned file\n'
      + '# requires an explicit later line: PROOF-AMENDED: <finding-id> <new-sha256> <reason>\n\n';
  }
  if (!text.endsWith('\n')) text += '\n';
  writeFileSync(manifestPath, text + pins.join('\n') + '\n');
  for (const l of pins) console.log('  + ' + l);
}

// ---------------------------------------------------------------- verify

const AMEND_RE = /^PROOF-AMENDED:\s+(\S+)\s+([0-9a-fA-F]{64})\s+(.*\S.*)$/;
const ENTRY_RE = /^(\S+)\s+([0-9a-fA-F]{64})\s+(.+)$/;

function cmdVerify(args) {
  let manifest = null, root = '.', reportOnly = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--report-only') reportOnly = true;
    else if (a === '--root') {
      root = args[++i];
      if (root === undefined || root.startsWith('--')) { console.error('x --root needs a path'); process.exit(2); }
    } else if (manifest === null) manifest = a;
    else { console.error(`x unexpected argument: ${a}`); usage(); }
  }
  if (manifest === null) usage();
  root = resolve(root);
  if (!existsSync(manifest)) { console.error(`x manifest not found: ${manifest}`); process.exit(2); }

  const entries = [], amendments = [], unparseable = [];
  readFileSync(manifest, 'utf8').split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '').trimEnd();
    if (!line.trim() || line.startsWith('#')) return; // header/comment lines
    if (/^PROOF-AMENDED\b/i.test(line)) {
      const m = line.match(AMEND_RE);
      // An amendment missing its sha or reason is not a lesser amendment — it is unparseable.
      if (!m) { unparseable.push(`L${i + 1}: ${line.slice(0, 80)}`); return; }
      amendments.push({ id: m[1], sha: m[2].toLowerCase(), reason: m[3].trim(), line: i + 1 });
      return;
    }
    const m = line.match(ENTRY_RE);
    if (!m) { unparseable.push(`L${i + 1}: ${line.slice(0, 80)}`); return; }
    entries.push({ id: m[1], sha: m[2].toLowerCase(), path: m[3].trim(), line: i + 1 });
  });

  console.log(`# ${manifest}  (root ${root}) — ${entries.length} pin(s), ${amendments.length} amendment(s)`);
  // Every amendment is announced LOUDLY up front, pass or fail — an amendment that slips by
  // unread is exactly the cheat this script exists to catch.
  for (const a of amendments)
    console.log(`  !! AMENDED    PROOF-AMENDED at L${a.line}: ${a.id} re-pinned to ${a.sha.slice(0, 12)}... — reason: ${a.reason}`);

  let bad = 0, ok = 0;
  for (const u of unparseable) { bad++; console.log(`  !! UNPARSEABLE ${u}`); }
  for (const e of entries) {
    const abs = resolve(root, e.path);
    if (!abs.startsWith(root + sep)) { bad++; console.log(`  !! ESCAPES    ${e.id} ${e.path} resolves outside --root — refusing to read it`); continue; }
    let buf;
    try { buf = readFileSync(abs); }
    catch { bad++; console.log(`  !! MISSING    ${e.id} ${e.path} — pinned proof file is gone (an amendment cannot excuse absence)`); continue; }
    const cur = sha256(buf);
    if (cur === e.sha) { ok++; console.log(`  ok ${e.id}  ${e.path}`); continue; }
    const amend = amendments.find((a) => a.line > e.line && a.id === e.id && a.sha === cur);
    if (amend) { ok++; console.log(`  ok ${e.id}  ${e.path} — content changed, re-pinned by PROOF-AMENDED at L${amend.line} (see notice above)`); }
    else { bad++; console.log(`  !! TAMPERED   ${e.id} ${e.path} — pinned ${e.sha.slice(0, 12)}..., current ${cur.slice(0, 12)}..., no matching PROOF-AMENDED re-pin`); }
  }

  console.log(`\n${entries.length} pin(s): ${ok} intact, ${bad} failing.`);
  if (bad > 0 && !reportOnly) {
    console.error('Proof integrity violated — a pinned proof file was edited, removed, or the manifest is corrupt. Fail closed.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------- dispatch

const argv = process.argv.slice(2);
if (argv[0] === 'record') cmdRecord(argv.slice(1));
else if (argv[0] === 'verify') cmdVerify(argv.slice(1));
else usage();
