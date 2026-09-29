#!/usr/bin/env node
// Program lifecycle commands over a grammar-2 PROGRAM.md ledger (code-ops-docs design L3 and L5).
//
//   node scripts/program-lifecycle.mjs promote DEC-<n> --program <PROGRAM.md | slug> [--root <repo>] [--collection <id>] [--topic <text>] [--key <domain/subject>] [--decides <text>]
//   node scripts/program-lifecycle.mjs close <PROGRAM.md | slug> [--root <repo>] [--base <ref>] [--outcome <text>]
// `co decide promote` and `co program close` reach these.
//
// PROMOTE moves one decision into the documentation hub's records layer in one step. It refuses
// unless the ledger has a `Grammar: 2` line and the DEC sits in its Decisions ledger with
// `Disposition: pending` or `local`. It then runs four writes in this order: (1) a native
// `kind: decision` record body under `<hub>/98 System/Records/intake/<collection>/`, staged in git;
// (2) `records.mjs intake` for that body, which appends the intake line and prints the record id;
// (3) the ledger line's `Disposition:` set to `promoted:<record id>`; (4) `records.mjs render
// --register`. A failure in (1) or (2) unstages and removes the body and leaves the ledger untouched.
// The ledger write is last before the render, so a ledger that says `promoted:` always has its
// intake line. A render failure leaves both written and consistent, and the register is one
// `co docs records render --register` away. Git and the filesystem give no cross-file transaction,
// so this order is the atomicity. No curation intake line is written: `records.mjs curate` refuses a
// record that is not yet in the inventory, and a decision record is `in-force` until curated.
// The record's `decides` is the ledger title, at most 25 words, else `--decides` supplies it. Its
// `topic` defaults to the program slug and its `key` to `decisions/<slug>-<dec id>`.
//
// CLOSE ends a program. It refuses, naming every blocker, while a Decisions-ledger entry is
// `pending`, an open item lacks `Forwarded-to:` to a successor with `Owner: operator`, a handoff of
// the program is unconsumed, or a `promoted:` id is not sealed on `--base` (default `main`). Ledger
// and archive are both read. It writes `CLOSEOUT.md` beside the ledger (goal, outcome, revision
// range, each promoted decision linked to its register line, counts), adds `Status: closed` under
// the goal heading, and updates `INDEX.md` in the runs folder that holds `programs/<slug>/`.
//
// Exit: 0 = done; 1 = refused or a step failed; 2 = usage error.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { die, git, parseOrDie, usage } from './cli-lib.mjs';
import { linksBlock } from './handoff-state.mjs';
import { hubOf, promotedIds, recordState } from './promotion-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = [
  'usage: program-lifecycle.mjs promote DEC-<n> --program <PROGRAM.md | slug> [--root <repo>] [--collection <id>] [--topic <text>] [--key <domain/subject>] [--decides <text>]',
  '       program-lifecycle.mjs close <PROGRAM.md | slug> [--root <repo>] [--base <ref>] [--outcome <text>]',
];
const ARCHIVE_NAME = 'PROGRAM.archive.md';
const MAX_DECIDES_WORDS = 25;
const KEY_PART_RE = /^[a-z0-9]+(?:-[a-z0-9]+){0,4}$/;

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const repoPath = (root, p) => relative(root, p).replace(/\\/g, '/');
const today = () => new Date().toISOString().slice(0, 10);
const isGrammar2 = (text) => /^[-*\t ]*Grammar:[^\S\r\n]*2\s*$/m.test(text);
const leadId = (line) => /^[-*]\s+(?:\[[ xX]\]\s+)?([A-Z][A-Z0-9]*-\d+)\b/.exec(line)?.[1] ?? null;
const dispositionOf = (line) => /\bDisposition:\s*([^\s·]+)/.exec(line)?.[1] ?? null;
const hopOf = (line) => /\bHop:\s*(\d+)/.exec(line)?.[1] ?? null;
const mdLink = (label, path, fragment = '') => `[${label}](${path.split('/').map(encodeURIComponent).join('/')}${fragment})`;

// The lower-cased section a `## ` heading opens, or undefined for a line that is not one.
const headingOf = (line) => /^##[ \t]+(.+)$/.exec(line)?.[1].trim().toLowerCase();
// The `[start, end)` line range of the section whose heading starts with `name`, or null.
function sectionRange(lines, name) {
  const at = lines.findIndex((l) => headingOf(l)?.startsWith(name));
  if (at < 0) return null;
  const next = lines.findIndex((l, i) => i > at && headingOf(l) !== undefined);
  return [at + 1, next < 0 ? lines.length : next];
}
// Each top-level bullet of a section as { index, line }.
function bulletsOf(lines, name) {
  const range = sectionRange(lines, name);
  if (!range) return [];
  return lines.slice(...range).map((line, i) => ({ index: range[0] + i, line })).filter((b) => /^[-*]\s+/.test(b.line));
}
const linesOf = (text) => text.replace(/\r\n/g, '\n').split('\n');

// A ledger by path or program slug. The slug resolves under `programs/<slug>/PROGRAM.md` of each
// runs folder: the repository root's, a `*-docs` folder's, and the manifest hub's.
function runsRoots(root) {
  const hubs = [root];
  try {
    for (const e of readdirSync(root, { withFileTypes: true })) if (e.isDirectory() && e.name.endsWith('-docs')) hubs.push(join(root, e.name));
  } catch { /* unreadable root: no hub */ }
  const hub = hubOf(root);
  if (hub) hubs.push(join(root, hub));
  return [...new Set(hubs)].map((h) => join(h, '80 Runs'));
}
function readLedger(arg, root, verb) {
  const direct = resolve(root, arg);
  const file = isFile(direct) ? direct : runsRoots(root).map((r) => join(r, 'programs', arg, 'PROGRAM.md')).find(isFile);
  if (!file) die(`no PROGRAM.md at ${arg} or under a hub's 80 Runs/programs/${arg}/`);
  const shown = repoPath(root, file);
  const raw = readFileSync(file, 'utf8');
  if (!isGrammar2(raw)) die(`refusing to ${verb} ${shown}: it has no "Grammar: 2" line`);
  const status = /^[-*\t ]*Status:[^\S\r\n]*(merged into .+?|closed)\s*$/m.exec(raw)?.[1];
  if (status) die(`refusing to ${verb} ${shown}: it is already "Status: ${status}"`);
  const archiveFile = join(dirname(file), ARCHIVE_NAME);
  return {
    file, shown, slug: basename(dirname(file)), eol: raw.includes('\r\n') ? '\r\n' : '\n', lines: linesOf(raw),
    archive: isFile(archiveFile) ? linesOf(readFileSync(archiveFile, 'utf8')) : [],
  };
}

function runScript(script, args, root) {
  const r = spawnSync(process.execPath, [join(HERE, script), ...args], { cwd: root, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

// ---- promote ----

function promote(decId, flags) {
  const root = resolve(flags.root);
  if (!/^DEC-\d+$/.test(decId ?? '')) usage(USAGE);
  const ledger = readLedger(flags.program, root, 'promote');
  const entry = bulletsOf(ledger.lines, 'decisions ledger').find((b) => leadId(b.line) === decId);
  if (!entry) die(`refusing to promote ${decId}: ${ledger.shown} has no such entry under Decisions ledger (the archive is not searched)`);
  const disposition = dispositionOf(entry.line);
  if (disposition !== 'pending' && disposition !== 'local') {
    die(`refusing to promote ${decId}: its Disposition is ${disposition ?? 'missing'}, and only pending or local promote`);
  }

  const title = entry.line.replace(/^[-*]\s+DEC-\d+\s+(?:\d{4}-\d{2}-\d{2}\s+)?/, '').split(' · ')[0].trim();
  const decides = (flags.decides ?? title).trim();
  if (!decides) die(`refusing to promote ${decId}: its ledger line has no title to use as decides`);
  if (decides.split(/\s+/).length > MAX_DECIDES_WORDS) {
    die(`refusing to promote ${decId}: its title runs past ${MAX_DECIDES_WORDS} words; pass --decides with a shorter statement`);
  }
  const key = flags.key ?? `decisions/${ledger.slug}-${decId.toLowerCase()}`;
  const subject = key.split('/')[1] ?? '';
  if (key.split('/').length !== 2 || !KEY_PART_RE.test(key.split('/')[0]) || !KEY_PART_RE.test(subject)) {
    die(`refusing to promote ${decId}: key ${key} is not <domain>/<subject> of lower-case words; pass --key`);
  }
  const hub = hubOf(root);
  if (!hub) die('refusing to promote: the repository tracks no DOCS_MANIFEST.json');
  const manifest = JSON.parse(readFileSync(join(root, hub, '98 System', 'DOCS_MANIFEST.json'), 'utf8'));
  if (!(manifest.recordCollections ?? []).some((c) => c.id === flags.collection)) {
    die(`refusing to promote ${decId}: the manifest has no record collection "${flags.collection}"; pass --collection`);
  }

  const hop = hopOf(entry.line);
  const body = [
    '---', 'recordSchema: 1', 'supersedes: []', 'kind: decision',
    `title: ${JSON.stringify(title || decides)}`, `topic: ${JSON.stringify(flags.topic ?? ledger.slug)}`, `key: ${key}`,
    `decides: ${JSON.stringify(decides)}`, `source: ${JSON.stringify(`program ${ledger.slug}${hop ? ` hop ${hop}` : ''}, ${decId}`)}`,
    '---', `# ${title || decides}`, '', `Ledger entry in ${ledger.shown}:`, '', `> ${entry.line.replace(/^[-*]\s+/, '')}`, '',
  ].join('\n');
  const rel = `${hub}/98 System/Records/intake/${flags.collection}/${ledger.slug}-${decId.toLowerCase()}.md`;
  const abs = join(root, rel);
  if (existsSync(abs)) die(`refusing to promote ${decId}: ${rel} already exists`);

  // Writes 1 and 2. A failure removes the staged body, so the ledger and the tree stay as they were.
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  const undo = () => {
    try { git(['rm', '--cached', '-q', '-f', '--', rel], { cwd: root }); } catch { /* not staged */ }
    rmSync(abs, { force: true });
  };
  try { git(['add', '--', rel], { cwd: root }); } catch (error) { undo(); die(`refusing to promote ${decId}: cannot stage ${rel}: ${error.message}`); }
  const intake = runScript('records.mjs', ['intake', '--root', root, '--collection', flags.collection, '--record', rel], root);
  let recordId;
  try { recordId = JSON.parse(intake.out.split('\n').at(-1)).recordId; } catch { recordId = null; }
  if (!intake.ok || !recordId) { undo(); die(`promote ${decId} failed at records intake; the ledger is untouched:\n${intake.err}`); }

  // Write 3, last before the render: the ledger only ever names an id whose intake line exists.
  ledger.lines[entry.index] = entry.line.replace(/(\bDisposition:\s*)(?:pending|local)/, `$1promoted:${recordId}`);
  writeFileSync(ledger.file, ledger.lines.join(ledger.eol));

  // Write 4.
  const render = runScript('records.mjs', ['render', '--register', '--root', root, '--collection', flags.collection], root);
  if (!render.ok) {
    die(`promote ${decId}: the ledger and intake are written, and the register render failed; rerun records.mjs render --register --collection ${flags.collection}:\n${render.err}`);
  }
  const register = `${hub}/20 Decisions/REGISTER.md`;
  console.log([
    `promoted ${decId} of ${ledger.shown} as ${recordId} (was Disposition: ${disposition})`,
    `intake body: ${rel}`,
    ...linksBlock([['ledger', ledger.shown], ['record body', rel], ['register', register]]),
  ].join('\n'));
  return 0;
}

// ---- close ----

const NAMES_SUCCESSOR = /\bForwarded-to:\s*\S/;

// Handoffs of this program that no session consumed, as repository paths.
function unconsumedHandoffs(ledgerFile, root) {
  const out = [];
  for (const runs of runsRoots(root)) {
    let folders = [];
    try { folders = readdirSync(runs, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
    for (const f of folders) {
      const file = join(runs, f.name, 'HANDOFF.md');
      if (!isFile(file) || existsSync(join(runs, f.name, 'HANDOFF.consumed'))) continue;
      const program = /^Program:[^\S\r\n]*(.+?)\s*$/m.exec(readFileSync(file, 'utf8'))?.[1]?.replace(/^`(.*)`$/, '$1').trim();
      if (program && resolve(root, program) === ledgerFile) out.push(repoPath(root, file));
    }
  }
  return out;
}

// The line of the register that names `recordId`, on `base` first and on the tree second.
function registerLine(root, registerPath, base, recordId) {
  const texts = [];
  try { texts.push(git(['show', `${base}:${registerPath}`], { cwd: root })); } catch { /* not on base */ }
  if (isFile(join(root, registerPath))) texts.push(readFileSync(join(root, registerPath), 'utf8'));
  for (const text of texts) {
    const at = linesOf(text).findIndex((l) => l.includes(recordId));
    if (at >= 0) return at + 1;
  }
  return null;
}

function close(arg, flags) {
  const root = resolve(flags.root);
  const ledger = readLedger(arg, root, 'close');
  const all = [...ledger.lines, ...ledger.archive];
  const decisions = [...bulletsOf(ledger.lines, 'decisions ledger'), ...bulletsOf(ledger.archive, 'decisions ledger')];
  const blockers = [];

  const pending = decisions.filter((b) => dispositionOf(b.line) === 'pending').map((b) => leadId(b.line) ?? b.line.slice(0, 40));
  if (pending.length) blockers.push(`${pending.length} pending decision(s): ${pending.join(', ')}`);

  const open = bulletsOf(ledger.lines, 'open items').filter((b) => !/^[-*]\s+\[[xX]\]/.test(b.line));
  const stuck = open.filter((b) => !(NAMES_SUCCESSOR.test(b.line) && /\bOwner:\s*operator\b/.test(b.line))).map((b) => leadId(b.line) ?? b.line.slice(0, 40));
  if (stuck.length) blockers.push(`${stuck.length} open item(s) not forwarded to a successor with Owner: operator: ${stuck.join(', ')}`);

  const unconsumed = unconsumedHandoffs(ledger.file, root);
  if (unconsumed.length) blockers.push(`${unconsumed.length} unconsumed handoff(s): ${unconsumed.join(', ')}`);

  const promoted = promotedIds(all.join('\n'));
  try { git(['rev-parse', '--verify', '--quiet', `${flags.base}^{commit}`], { cwd: root }); } catch { die(`base ref ${flags.base} does not resolve; pass --base`); }
  const baseHub = hubOf(root, flags.base);
  const unsealed = promoted.filter((p) => recordState(root, p.recordId, { ref: flags.base, hub: baseHub }).where !== 'sealed')
    .map((p) => `${p.dec ?? 'entry'} (${p.recordId})`);
  if (unsealed.length) blockers.push(`${unsealed.length} promoted id(s) not sealed on ${flags.base}: ${unsealed.join(', ')}`);
  if (blockers.length) die(`refusing to close ${ledger.shown}:\n- ${blockers.join('\n- ')}`);

  const goal = sectionRange(ledger.lines, 'program goal');
  const goalText = goal ? ledger.lines.slice(...goal).join('\n').trim() : '';
  const counts = { promoted: promoted.length, local: 0, dropped: 0 };
  for (const b of decisions) {
    const d = dispositionOf(b.line);
    if (d === 'local' || d === 'dropped') counts[d]++;
  }
  const closedItems = [...bulletsOf(ledger.lines, 'closed items'), ...bulletsOf(ledger.archive, 'closed items')].length;
  const outcome = flags.outcome ?? `${decisions.length} decision(s) settled: ${counts.promoted} promoted, ${counts.local} local, ${counts.dropped} dropped. ${closedItems} item(s) closed. ${open.length} open item(s) forwarded to an operator.`;

  const dir = dirname(ledger.file);
  const closeout = join(dir, 'CLOSEOUT.md');
  const hub = baseHub ?? hubOf(root);
  const registerPath = hub ? `${hub}/20 Decisions/REGISTER.md` : null;
  const linked = promoted.map((p) => {
    const at = registerPath ? registerLine(root, registerPath, flags.base, p.recordId) : null;
    const link = at ? ` at ${mdLink('REGISTER.md', repoPath(dir, join(root, registerPath)), `#L${at}`)}` : ' (no register line)';
    return `- ${p.dec ?? 'entry'}: ${p.recordId}${link}`;
  });
  const first = git(['log', '--diff-filter=A', '--format=%h', '--', ledger.shown], { cwd: root }).split('\n').filter(Boolean).at(-1);
  const head = git(['rev-parse', '--short', 'HEAD'], { cwd: root }).trim();
  writeFileSync(closeout, [
    `# CLOSEOUT: ${ledger.slug}`, '', `Closed: ${today()}`, `Ledger: ${mdLink('PROGRAM.md', 'PROGRAM.md')}`, '',
    '## Goal', '', goalText || '(none recorded)', '', '## Outcome', '', outcome, '',
    '## Revision range', '', first ? `${first}..${head} (first commit of the ledger to HEAD; base ${flags.base})` : `none recorded (the ledger has no commit; HEAD ${head})`, '',
    '## Promoted decisions', '', ...(linked.length ? linked : ['None.']), '',
    '## Counts', '', `- Closed items: ${closedItems}`, `- Local decisions: ${counts.local}`, `- Promoted decisions: ${counts.promoted}`, '',
  ].join('\n'));

  const at = ledger.lines.findIndex((l) => /^##[ \t]+Program goal/i.test(l));
  if (at < 0) ledger.lines.push('', '## Program goal', '', 'Status: closed', '');
  else ledger.lines.splice(at + 1, 0, '', 'Status: closed');
  writeFileSync(ledger.file, ledger.lines.join(ledger.eol));

  const runs = dirname(dirname(dir));
  const indexFile = join(runs, 'INDEX.md');
  const entry = `- ${mdLink(ledger.slug, `programs/${ledger.slug}/PROGRAM.md`)} · closed ${today()} · ${mdLink('CLOSEOUT', `programs/${ledger.slug}/CLOSEOUT.md`)}`;
  const index = existsSync(indexFile) ? linesOf(readFileSync(indexFile, 'utf8')) : ['# Runs index', ''];
  const known = index.findIndex((l) => l.includes(`programs/${ledger.slug}/`));
  if (known >= 0) index[known] = entry;
  else index.splice(index.at(-1) === '' ? index.length - 1 : index.length, 0, entry);
  if (index.at(-1) !== '') index.push('');
  writeFileSync(indexFile, index.join('\n'));

  console.log([
    `closed ${ledger.shown}: ${counts.promoted} promoted, ${counts.local} local, ${closedItems} closed item(s), ${open.length} forwarded open item(s)`,
    ...linksBlock([['closeout', repoPath(root, closeout)], ['ledger', ledger.shown], ['index', repoPath(root, indexFile)]]),
  ].join('\n'));
  return 0;
}

// co.mjs sets argv[1] to this file before importing it, so both entries pass.
function isEntry() {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

if (isEntry()) {
  const [command, ...rest] = process.argv.slice(2);
  const { flags, positional } = parseOrDie(rest, {
    root: { value: true, default: '.', missing: 'needs a path' },
    program: { value: true },
    collection: { value: true, default: 'decisions' },
    topic: { value: true },
    key: { value: true },
    decides: { value: true },
    base: { value: true, default: 'main' },
    outcome: { value: true },
  }, USAGE.join('\n'));
  if (command === 'promote' && positional.length === 1 && flags.program) process.exit(promote(positional[0], flags));
  if (command === 'close' && positional.length === 1) process.exit(close(positional[0], flags));
  usage(USAGE);
}
