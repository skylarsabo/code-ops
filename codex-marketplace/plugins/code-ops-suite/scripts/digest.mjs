#!/usr/bin/env node
// Shape-keyed, loss-bounded compressor for command output — runs a command, keeps the raw bytes
// on disk, and prints a compressed view whose must-keep content is proven by a deterministic eval.
//
//   node scripts/digest.mjs [--cap <lines>] [--head <n>] [--tail <n>] [--line <chars>]
//                           [--shape auto|<name>] [--store <dir>] [--no-store] [--json]
//                           -- <exe> [args...]
//
// WHY: the receipted baseline in `code-ops-docs/55 Operations/MEASUREMENTS.md` puts tool results
// at 77.6% of all context characters. Truncating them saves bytes and hopes nothing important was
// in the part that went. This does the opposite: the shape detectors in `digest-lib.mjs` decide
// what a stream IS, the stages compress what that shape can spare, and `mustKeep` names what no
// digest may drop — every error line, the final line, failing tests, diff headers, one line per
// diagnostic file. Ratio never trades against retention. Every elided region prints the exact
// `sed -n 'A,Bp' <raw path>` that brings it back, and the trailer carries the exit code, the
// shape, the before-and-after line counts, and the raw file's sha256.
//
// The command is spawned DIRECTLY (first token after `--` is the executable, no shell), stdout
// and stderr captured apart. The child's exit code becomes this process's exit code, always — a
// failing build still fails the wrapper. `--` is required; a missing one exits 2 with usage, and
// an executable that cannot be spawned exits 127.
//
// Receipt store: `--store`, else `$CODE_OPS_DIGEST_DIR`, else
// `~/.claude/code-ops/digest/<project slug of cwd>/` — a home-directory path by default, so a raw
// output can never be committed by accident. Raw bytes go to `<store>/<ISO date>/<HHMMSS>-<sha8>.txt`
// and one JSON line is appended to `<store>/DIGEST_RECEIPTS.jsonl`. Store writes FAIL OPEN: an
// unwritable store prints the digest with `raw -` rather than losing the run.
//
// Everything is printed on stdout, including the stderr section, because the digest is one report
// and its trailer must be the last line a reader sees. `--json` prints one object instead.
//
// Exit: the wrapped command's exit code; 2 on usage error; 127 when the executable cannot spawn.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const lib = await import(pathToFileURL(join(HERE, 'digest-lib.mjs')).href);
const { DEFAULTS, SHAPES, detectShape, digestText } = lib;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function usage(message) {
  if (message) console.error(`x ${message}`);
  console.error('usage: digest.mjs [--cap <lines>] [--head <n>] [--tail <n>] [--line <chars>]');
  console.error('                  [--shape auto|<name>] [--store <dir>] [--no-store] [--json] -- <exe> [args...]');
  console.error(`shapes: auto, ${Object.keys(SHAPES).join(', ')}`);
  process.exit(2);
}

// ---------------------------------------------------------------- windows .cmd shims
//
// Transplanted from scripts/run-proof.mjs (`wherePath`, `spawnSpec`, `escapeCmdShim`,
// `escapeCmdArg`) so the digest spawns the same set of commands the receipt ledger can.
// Node refuses to spawn a .cmd/.bat file without a shell (EINVAL, CVE-2024-27980 hardening) and
// a bare shim name like `npm` does not resolve at all. Handing the line to a shell would break
// the no-shell contract, so instead: resolve the executable, and only when it IS a .cmd/.bat
// shim, rewrite the spawn to `cmd.exe /d /s /c "<line>"` with quote-for-argv plus a SINGLE caret
// pass. The single pass is deliberate — see the note in run-proof.mjs for why it beats
// cross-spawn's double pass through both shim styles.

const CMD_META_RE = /([()\][%!^"`<>&|;, *?])/g;
const escapeCmdShim = (s) => s.replace(CMD_META_RE, '^$1');

function escapeCmdArg(s) {
  let a = String(s).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  a = `"${a}"`;
  return a.replace(CMD_META_RE, '^$1');
}

// PATH-only lookup: the `$path:` pattern prefix stops `where` searching the working directory,
// so a repo under audit cannot plant a shim that hijacks a bare-name command.
function wherePath(exe) {
  try {
    return execFileSync('where', [`$path:${exe}`], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 })
      .toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch { return []; }
}

// A token that names (or resolves to) an EXISTING .cmd/.bat shim is rewritten through cmd.exe;
// anything that resolves to a real executable — or does not resolve at all — spawns unchanged, so
// the ordinary "cannot spawn" path still fires (exit 127) for a missing command. cmd.exe must
// never be handed a name it cannot find, because cmd itself exits 1 and that would report a
// command failure for a command that never ran.
function spawnSpec(exe, args, cwd = process.cwd()) {
  const plain = { file: exe, args, options: {} };
  if (process.platform !== 'win32' || /[*?]/.test(exe)) return plain;
  let shim = null;
  if (!/[\\/]/.test(exe) && !/\.[a-z0-9]+$/i.test(exe)) {
    for (const hit of wherePath(exe)) {
      if (/\.(exe|com)$/i.test(hit)) return plain;
      if (/\.(cmd|bat)$/i.test(hit)) { shim = hit; break; }
    }
    if (!shim) return plain;
  } else if (/\.(cmd|bat)$/i.test(exe)) {
    if (/[\\/]/.test(exe)) {
      const abs = resolve(cwd, exe);
      if (!existsSync(abs)) return plain;
      shim = abs;
    } else {
      const local = resolve(cwd, exe);
      if (existsSync(local)) shim = local;
      else shim = wherePath(exe).find((h) => /\.(cmd|bat)$/i.test(h)) ?? null;
      if (!shim) return plain;
    }
  } else return plain;
  const line = [escapeCmdShim(shim), ...args.map(escapeCmdArg)].join(' ');
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}

// ---------------------------------------------------------------- arguments

function parse(argv) {
  const o = { ...DEFAULTS, shape: 'auto', store: null, noStore: false, json: false };
  let i = 0;
  const num = (name) => {
    const v = Number(argv[++i]);
    if (!Number.isFinite(v) || v < 0) usage(`${name} needs a non-negative number`);
    return v;
  };
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { i++; break; }
    else if (a === '--cap') o.cap = num('--cap');
    else if (a === '--head') o.head = num('--head');
    else if (a === '--tail') o.tail = num('--tail');
    else if (a === '--line') o.line = num('--line');
    else if (a === '--shape') {
      o.shape = argv[++i];
      if (o.shape !== 'auto' && !Object.hasOwn(SHAPES, o.shape || '')) usage(`unknown shape: ${o.shape}`);
    } else if (a === '--store') {
      o.store = argv[++i];
      if (!o.store || o.store.startsWith('--')) usage('--store needs a directory');
    } else if (a === '--no-store') o.noStore = true;
    else if (a === '--json') o.json = true;
    else usage(`unknown argument before '--': ${a}`);
  }
  const cmd = argv.slice(i);
  if (i === 0 || (i >= argv.length && argv[i - 1] !== '--')) usage("a '--' separator and a command are required");
  if (cmd.length === 0) usage("no command after '--'");
  return { o, cmd };
}

// ---------------------------------------------------------------- receipt store

// Same rule as transcript-lib.projectSlug: every non-alphanumeric byte becomes a dash, so one
// checkout's raw outputs never mix with another's.
const projectSlug = (cwd) => String(cwd).replace(/[^A-Za-z0-9]/g, '-');

function storeDir(o) {
  if (o.store) return resolve(o.store);
  if (process.env.CODE_OPS_DIGEST_DIR) return resolve(process.env.CODE_OPS_DIGEST_DIR);
  return join(homedir(), '.claude', 'code-ops', 'digest', projectSlug(process.cwd()));
}

// Returns the raw path and its digest, or null when storing is off or fails. Never throws: an
// unwritable store loses the recovery hints, not the run.
function storeRaw(o, body, ts) {
  if (o.noStore) return null;
  try {
    const dir = storeDir(o);
    const day = ts.slice(0, 10);
    const clock = ts.slice(11, 19).replace(/:/g, '');
    const hash = sha256(body);
    const target = join(dir, day, `${clock}-${hash.slice(0, 8)}.txt`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    return { dir, path: target, sha256: hash };
  } catch { return null; }
}

function appendReceipt(dir, row) {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'DIGEST_RECEIPTS.jsonl'), `${JSON.stringify(row)}\n`);
  } catch { /* fail open: the digest is still correct without its ledger row */ }
}

// ---------------------------------------------------------------- run

const { o, cmd } = parse(process.argv.slice(2));
const [exe, ...rest] = cmd;
const spec = spawnSpec(exe, rest);

let child;
try { child = spawn(spec.file, spec.args, { stdio: ['inherit', 'pipe', 'pipe'], ...spec.options }); }
catch (e) { console.error(`digest: cannot spawn ${exe}: ${e.message}`); process.exit(127); }
child.on('error', (e) => { console.error(`digest: cannot spawn ${exe}: ${e.message}`); process.exit(127); });

const outChunks = [];
const errChunks = [];
child.stdout.on('data', (d) => outChunks.push(d));
child.stderr.on('data', (d) => errChunks.push(d));

child.on('close', (code, signal) => {
  const exit = code ?? 1; // killed by a signal is a failure, never a fabricated success
  const stdout = Buffer.concat(outChunks).toString('utf8');
  const stderr = Buffer.concat(errChunks).toString('utf8');
  const ts = new Date().toISOString();
  const shape = o.shape === 'auto' ? detectShape(stdout, stderr, cmd) : o.shape;

  const SEP = '----- stderr -----';
  const hasErr = stderr !== '';
  const body = hasErr ? `${stdout}${stdout.endsWith('\n') || stdout === '' ? '' : '\n'}${SEP}\n${stderr}` : stdout;
  const stored = storeRaw(o, body, ts);
  const rawPath = stored ? stored.path : null;

  // stderr sits after stdout and the separator inside the raw file, so its digest must report
  // file-absolute line numbers or every `sed -n` hint it prints would be wrong.
  const outLines = stdout === '' ? 0 : stdout.split('\n').length - (stdout.endsWith('\n') ? 1 : 0);
  const offset = hasErr ? outLines + 1 : 0;
  const opts = { cap: o.cap, head: o.head, tail: o.tail, line: o.line, shape, argv: cmd, rawPath, cwd: process.cwd() };
  const dOut = digestText(stdout, opts);
  const dErr = hasErr ? digestText(stderr, { ...opts, offset }) : null;

  const printed = [];
  if (dOut.text !== '') printed.push(dOut.text.replace(/\n$/, ''));
  if (dErr) { printed.push(SEP); if (dErr.text !== '') printed.push(dErr.text.replace(/\n$/, '')); }

  const linesIn = dOut.linesIn + (dErr ? dErr.linesIn + 1 : 0);
  const bodyLines = printed.join('\n');
  const linesOut = (bodyLines === '' ? 0 : bodyLines.split('\n').length) + 1; // + the trailer
  const digestSha = stored ? stored.sha256 : sha256(body);
  const trailer = `[exit ${exit} · ${shape} · ${linesIn} lines → ${linesOut} · raw ${rawPath ?? '-'} · sha256:${digestSha.slice(0, 12)}]`;

  if (stored) {
    appendReceipt(stored.dir, {
      v: 1,
      ts,
      cwd: process.cwd(),
      argv: cmd,
      exit,
      shape,
      bytesIn: body.length,
      bytesOut: bodyLines.length + trailer.length + 1,
      linesIn,
      linesOut,
      sha256: stored.sha256,
      raw: stored.path,
    });
  }

  if (o.json) {
    process.stdout.write(`${JSON.stringify({
      shape,
      exit,
      stdout: dOut.text,
      stderr: dErr ? dErr.text : '',
      trailer,
      receipt: stored ? { raw: stored.path, sha256: stored.sha256, dir: stored.dir } : null,
    })}\n`);
  } else {
    if (bodyLines !== '') process.stdout.write(`${bodyLines}\n`);
    process.stdout.write(`${trailer}\n`);
  }
  if (signal) console.error(`digest: command killed by ${signal} — reported exit ${exit}`);
  process.exit(exit);
});
