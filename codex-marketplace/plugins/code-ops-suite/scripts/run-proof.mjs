#!/usr/bin/env node
// Execution-receipt ledger for the code-ops suite — the mechanical floor under "I ran it".
//
//   node scripts/run-proof.mjs record [--receipts <path>] -- <cmd ...>
//   node scripts/run-proof.mjs verify <RUN_RECEIPTS.md> [--only RCPT-NNN] [--root <repo>] [--report-only]
//
// WHY: the proven field failure is fabricated tool output — a transcript that SHOWS a passing
// run that never happened. `record` wraps the real execution: it spawns the command directly
// (everything after `--`; first token = executable, no shell), tees stdout+stderr through to
// the console, appends a receipt row
//
//   | RCPT-NNN | <ISO timestamp> | <git HEAD sha> | <exit code> | <sha256 of output> | <command> |
//
// to the receipts ledger (default RUN_RECEIPTS.md in cwd; created with its header if absent;
// numbering = max existing RCPT + 1), then exits with the wrapped command's own exit code —
// a failing test still fails the wrapper, and the row is the receipt a reviewer can replay.
//
// `verify` re-executes every row's command from the repo root and compares EXIT CODES — the
// exit code is the contract. Output-hash differences are advisory only (timestamps, tmp paths
// and stream interleaving make output legitimately vary). Each command is printed BEFORE it
// runs, so a hung or hostile replay is attributable. Replaying a model-authored ledger is an
// injection surface: verify REFUSES (fail closed; skip+warn under --report-only) any row whose
// command tokens contain `..` traversal, an absolute path outside --root, or a shell
// metacharacter (; | & $ ` < >) — and any row it cannot parse. No shell is involved on record
// or replay; on Windows that means the command must be a real executable (node, git, python),
// not a .cmd/.bat shim.
//
// Exit: record → the wrapped command's exit code (2 on usage / unrecordable command, 127 if
// the executable cannot be spawned — no receipt is written for a run that never happened).
// verify → non-zero on any exit-code mismatch, refused row, or unparseable row, unless
// --report-only.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, isAbsolute, sep } from 'node:path';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const META_RE = /[;|&$`<>]/; // shell metacharacters — refused on replay (see header)

function usage() {
  console.error('usage: run-proof.mjs record [--receipts <path>] -- <cmd ...>');
  console.error('       run-proof.mjs verify <RUN_RECEIPTS.md> [--only RCPT-NNN] [--root <repo>] [--report-only]');
  process.exit(2);
}

function headSha(cwd) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).toString().trim(); }
  catch { return 'unknown'; } // outside a repo the receipt still records the run, just unpinned
}

// A token is stored raw when it round-trips through whitespace splitting; anything with
// whitespace or a double quote is JSON-quoted so verify reconstructs the exact argv. A `|`
// or newline cannot live in a markdown table cell (and `|` is refused on replay anyway) —
// refuse to record those rather than write a row that can never verify.
function encodeToken(t) {
  if (t.includes('|') || /[\r\n]/.test(t)) {
    console.error(`x cannot record a command token containing '|' or a newline in a table row: ${JSON.stringify(t)}`);
    process.exit(2);
  }
  return t === '' || /\s|"/.test(t) ? JSON.stringify(t) : t;
}

// Inverse of encodeToken: whitespace-split, except a token opening with `"` is parsed as a
// JSON string. Returns null on anything malformed (unterminated quote, bad escape) — the
// caller treats that row as unparseable and fails closed.
function parseCommandCell(cell) {
  const tokens = [];
  let i = 0;
  while (i < cell.length) {
    if (cell[i] === ' ') { i++; continue; }
    if (cell[i] === '"') {
      let j = i + 1, esc = false;
      while (j < cell.length && (esc || cell[j] !== '"')) { esc = !esc && cell[j] === '\\'; j++; }
      if (j >= cell.length) return null;
      try { tokens.push(JSON.parse(cell.slice(i, j + 1))); } catch { return null; }
      i = j + 1;
    } else {
      let j = i;
      while (j < cell.length && cell[j] !== ' ') j++;
      tokens.push(cell.slice(i, j));
      i = j;
    }
  }
  return tokens.length ? tokens : null;
}

// ---------------------------------------------------------------- record

function cmdRecord(args) {
  let receipts = 'RUN_RECEIPTS.md';
  let i = 0;
  for (; i < args.length; i++) {
    if (args[i] === '--') { i++; break; }
    if (args[i] === '--receipts') {
      receipts = args[++i];
      if (receipts === undefined || receipts.trim() === '' || receipts.startsWith('--')) { console.error('x --receipts needs a path'); process.exit(2); }
    } else { console.error(`x unknown argument before '--': ${args[i]}`); usage(); }
  }
  const cmd = args.slice(i);
  if (cmd.length === 0) { console.error('x record needs a command after --'); usage(); }
  const encoded = cmd.map(encodeToken).join(' '); // validate BEFORE running, not after
  if (cmd.some((t) => META_RE.test(t)))
    console.error('(run-proof) note: a token contains a shell metacharacter — verify will refuse to replay this row');

  const receiptsPath = resolve(receipts);
  const chunks = [];
  const [exe, ...rest] = cmd;
  // No-hang invariant exception, deliberate: this IS the proof command (arbitrary, caller-chosen —
  // a test suite or build can legitimately run minutes). Bounding it here would fabricate a false
  // failure receipt for a run that was still in progress, which is worse than a slow one.
  const child = spawn(exe, rest, { stdio: ['inherit', 'pipe', 'pipe'] });
  child.on('error', (e) => {
    // The command never ran — writing a receipt for it would itself be a fabricated run.
    console.error(`x could not execute ${exe}: ${e.message}`);
    process.exit(127);
  });
  child.stdout.on('data', (d) => { chunks.push(d); process.stdout.write(d); });
  child.stderr.on('data', (d) => { chunks.push(d); process.stderr.write(d); });
  child.on('close', (code, signal) => {
    const exit = code ?? 1; // killed by a signal → record a failure, never a fabricated success
    let text;
    try { text = existsSync(receiptsPath) ? readFileSync(receiptsPath, 'utf8') : null; }
    catch (e) { console.error(`x cannot read receipts file ${receipts}: ${e.message}`); process.exit(2); }
    if (text === null) {
      text = '# Run receipts\n\n'
        + 'Append-only execution ledger written by scripts/run-proof.mjs. Each row is a receipt\n'
        + 'for a real run; replay with: node scripts/run-proof.mjs verify <this file>\n\n'
        + '| id | recorded (UTC) | head | exit | sha256(output) | command |\n'
        + '| --- | --- | --- | --- | --- | --- |\n';
    }
    let max = 0;
    for (const m of text.matchAll(/\bRCPT-(\d+)\b/g)) max = Math.max(max, Number(m[1]));
    const id = `RCPT-${String(max + 1).padStart(3, '0')}`;
    const row = `| ${id} | ${new Date().toISOString()} | ${headSha(process.cwd())} | ${exit} | ${sha256(Buffer.concat(chunks))} | ${encoded} |\n`;
    if (!text.endsWith('\n')) text += '\n';
    writeFileSync(receiptsPath, text + row);
    if (signal) console.error(`(run-proof) command killed by ${signal} — recorded exit ${exit}`);
    console.error(`(run-proof) ${id} exit ${exit} → ${receipts}`);
    process.exit(exit); // pass the wrapped command's exit code through
  });
}

// ---------------------------------------------------------------- verify

// Absolute-path candidates inside a token — the token itself, plus any embedded absolute
// path (Windows drive or unix /) hiding inside e.g. a `node -e` script string.
function absCandidates(token) {
  const out = [];
  if (isAbsolute(token)) out.push(token);
  for (const m of token.matchAll(/[A-Za-z]:[\\/][^\s'"`;|&<>)]*/g)) out.push(m[0]);
  for (const m of token.matchAll(/(?:^|['"`(=,\s])(\/[^\s'"`;|&<>):]*)/g)) out.push(m[1]);
  return out;
}

function screenTokens(tokens, root) {
  const reasons = [];
  for (const t of tokens) {
    if (META_RE.test(t)) reasons.push(`shell metacharacter in ${JSON.stringify(t.slice(0, 40))}`);
    if (t.includes('..')) reasons.push(`'..' traversal in ${JSON.stringify(t.slice(0, 40))}`);
    for (const p of absCandidates(t)) {
      const abs = resolve(root, p);
      if (abs !== root && !abs.startsWith(root + sep)) reasons.push(`absolute path outside --root: ${p.slice(0, 60)}`);
    }
  }
  return reasons;
}

function parseReceipt(cells) {
  if (cells.length !== 6) return null;
  const [id, when, head, exit, hash, cmdCell] = cells;
  if (!/^RCPT-\d+$/.test(id)) return null;
  if (!when || !head) return null;
  if (!/^-?\d+$/.test(exit)) return null;
  if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
  const tokens = parseCommandCell(cmdCell);
  if (!tokens) return null;
  return { id, exit: Number(exit), hash: hash.toLowerCase(), tokens, cmdText: cmdCell };
}

function cmdVerify(args) {
  let file = null, only = null, root = '.', reportOnly = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--report-only') reportOnly = true;
    else if (a === '--only') {
      only = args[++i];
      if (only === undefined || only.trim() === '' || only.startsWith('--')) { console.error('x --only needs a receipt id (RCPT-NNN)'); process.exit(2); }
    } else if (a === '--root') {
      root = args[++i];
      if (root === undefined || root.trim() === '' || root.startsWith('--')) { console.error('x --root needs a path'); process.exit(2); }
    } else if (file === null) file = a;
    else { console.error(`x unexpected argument: ${a}`); usage(); }
  }
  if (file === null) usage();
  root = resolve(root);
  if (!existsSync(file)) { console.error(`x receipts file not found: ${file}`); process.exit(2); }

  const lines = readFileSync(file, 'utf8').split('\n');
  let receipts = [];
  const unparseable = [];
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\r$/, '').trim();
    if (!line.startsWith('|')) return; // prose/heading — only table rows are receipts
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells[0] === 'id' || cells.every((c) => /^:?-+:?$/.test(c))) return; // table header / rule
    const rec = parseReceipt(cells);
    if (!rec) { unparseable.push(`L${idx + 1}: ${line.slice(0, 80)}`); return; }
    receipts.push({ ...rec, line: idx + 1 });
  });
  if (only) {
    receipts = receipts.filter((r) => r.id === only);
    if (receipts.length === 0) { console.error(`x no receipt ${only} in ${file}`); process.exit(2); }
  }

  console.log(`# ${file}  (root ${root}) — replaying ${receipts.length} receipt(s)`);
  let bad = 0, ok = 0, skipped = 0;
  for (const u of unparseable) { bad++; console.log(`  !! UNPARSEABLE ${u}`); }
  for (const r of receipts) {
    const reasons = screenTokens(r.tokens, root);
    if (reasons.length) {
      // Never execute a refused command — not even under --report-only.
      if (reportOnly) { skipped++; console.log(`  ~~ REFUSED (skipped)  ${r.id}  ${reasons.join('; ')}`); }
      else { bad++; console.log(`  !! REFUSED   ${r.id}  ${reasons.join('; ')}`); }
      continue;
    }
    console.log(`  > ${r.id}  $ ${r.cmdText}`); // print BEFORE running — a hang is attributable
    // No-hang invariant exception, deliberate (same as record's spawn above): this replays the
    // same arbitrary, caller-chosen proof command, which can legitimately run long. Screening
    // (screenTokens, above) is the guard against a hostile replay, not a timeout.
    const res = spawnSync(r.tokens[0], r.tokens.slice(1), { cwd: root });
    if (res.error || res.status === null) {
      bad++;
      console.log(`  !! MISMATCH  ${r.id}  recorded exit ${r.exit}, replay ${res.error ? `could not execute (${res.error.message})` : `killed by ${res.signal}`}`);
      continue;
    }
    if (res.status !== r.exit) {
      bad++;
      console.log(`  !! MISMATCH  ${r.id}  recorded exit ${r.exit}, replay exited ${res.status}`);
      continue;
    }
    ok++;
    const h = sha256(Buffer.concat([res.stdout ?? Buffer.alloc(0), res.stderr ?? Buffer.alloc(0)]));
    console.log(`  ok ${r.id}  exit ${res.status}${h === r.hash ? '' : '  (output hash differs — advisory only, output legitimately varies)'}`);
  }

  console.log(`\n${receipts.length} receipt(s): ${ok} verified, ${bad} failing${skipped ? `, ${skipped} refused+skipped` : ''}.`);
  if (bad > 0 && !reportOnly) {
    console.error('Receipt verification failed — a recorded run does not reproduce (or the ledger is corrupt). Fail closed.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------- dispatch

const argv = process.argv.slice(2);
if (argv[0] === 'record') cmdRecord(argv.slice(1));
else if (argv[0] === 'verify') cmdVerify(argv.slice(1));
else usage();
