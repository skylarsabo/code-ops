#!/usr/bin/env node
// Render the per-host global contracts from the one authored source.
//
//   node scripts/render-global-contracts.mjs [--check] [--stats]
//
// global-contracts/AGENTS.source.md is the only authored global contract. This script writes
// global-contracts/AGENTS.claude.md, AGENTS.codex.md, and AGENTS.grok.md, which sync-global.mjs
// installs. The derived files carry no header and no timestamp, because installed bytes cost
// tokens in every session and the output must be byte-stable. It also writes
// plugins/code-ops-suite/hooks/lead-doctrine.claude.md, the lead-only part of the claude render.
//
// Source directives each sit alone on a line:
//   <!-- host: claude,codex -->  ...  <!-- /host -->   a block for the listed hosts; no nesting
//   <!-- audience: lead -->  ...  <!-- /audience -->   text only the session lead needs; no nesting
//   <!-- backstop: path [switch=NAME] -->              a pointer check, stripped from the output
//   <!-- note: text -->                                a comment, stripped from the output
// Untagged text is for all hosts. A source error fails closed: an unclosed, nested, or stray
// directive, an unknown or empty host list, a backstop path that does not exist, a switch name
// absent from INFRASTRUCTURE.md, or a directive that shares its line with other text.
//
// Audience blocks sit outside host blocks: a host block may sit inside an audience block, and an
// audience marker inside a host block fails. An audience block holds no heading line. The claude
// render drops audience text, and the lead file holds it in source order under the ## heading of
// its section. Every other render strips the markers and keeps the text inline. A marker may
// split a paragraph after a line that ends a sentence; the inline renders then join the two
// lines with one space, so their bytes do not change.
//
// Leak guard: after rendering, a render that holds a term reserved for another host fails, and
// the lead file is held to the claude terms. --check renders in memory and compares with the
// files on disk (LF normalized). It reports stale, missing, and unexpected files, and any other
// .md file in global-contracts/.
// --stats prints the word count of each render and of the lead file.
//
// Exit: 0 = ok; 1 = drift or a source error; 2 = usage error.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'global-contracts');
const SOURCE = 'AGENTS.source.md';
const INFRASTRUCTURE = join(ROOT, 'code-ops-docs', '50 Platform', 'INFRASTRUCTURE.md');
const HOSTS = ['claude', 'codex', 'grok'];
const outName = (host) => `AGENTS.${host}.md`;
const LEAD_HOST = 'claude';
const LEAD_FILE = 'plugins/code-ops-suite/hooks/lead-doctrine.claude.md';
const LEAD_HEADER = '# Lead doctrine\n\nThis is the lead-only part of the user-wide contract, generated from `global-contracts/AGENTS.source.md` and never hand-edited.';

const COMMON = ['Grok', 'spawn_subagent', 'xai', '184,000', 'Agent Dashboard'];
const FORBIDDEN = {
  claude: [...COMMON, 'Astra', '258,000'],
  codex: [...COMMON, 'Fable', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'],
  grok: ['Astra', '258,000', 'Fable', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'],
};

const USAGE = 'usage: node scripts/render-global-contracts.mjs [--check] [--stats]';
const args = process.argv.slice(2);
if (args.some((a) => a !== '--check' && a !== '--stats')) { console.error(USAGE); process.exit(2); }
const CHECK = args.includes('--check');
const STATS = args.includes('--stats');

const lf = (text) => text.replace(/\r\n/g, '\n');
const words = (text) => text.split(/\s+/).filter(Boolean).length;

// Split the source into chunks at the directives. hosts is null for text every host gets; lead
// marks audience text; glue marks a chunk that continues the paragraph of the chunk before it.
function parse(text) {
  const errors = [];
  const chunks = [];
  let buffer = [];
  let block = null;
  let audience = null;
  let glue = false;
  const infra = existsSync(INFRASTRUCTURE) ? lf(readFileSync(INFRASTRUCTURE, 'utf8')) : '';
  const flush = (hosts) => { chunks.push({ hosts, lead: Boolean(audience), glue, text: buffer.join('\n') }); buffer = []; glue = false; };
  const lines = lf(text).split('\n');
  const isText = (line) => line !== undefined && line.trim() !== '' && !line.includes('<!--') && !line.includes('-->');
  lines.forEach((raw, index) => {
    const at = `${SOURCE}:${index + 1}`;
    const trimmed = raw.trim();
    if (!trimmed.includes('<!--') && !trimmed.includes('-->')) {
      if (audience && /^#{1,6}\s/.test(trimmed)) errors.push(`${at}: an audience block cannot hold a heading (opened at ${audience.at})`);
      buffer.push(raw);
      return;
    }
    const body = /^<!--\s*(.*?)\s*-->$/.exec(trimmed)?.[1];
    if (body === undefined || body.includes('<!--') || body.includes('-->')) { errors.push(`${at}: a directive must sit alone on its line`); return; }
    const host = /^host:\s*(.*)$/.exec(body);
    const audienceOpen = /^audience:\s*(.*)$/.exec(body);
    const backstop = /^backstop:\s*(\S+)(?:\s+switch=(\S+))?$/.exec(body);
    if (audienceOpen || body === '/audience') {
      const midParagraph = isText(lines[index - 1]) && isText(lines[index + 1]);
      if (block) { errors.push(`${at}: an audience marker cannot sit inside a host block (opened at ${block.at})`); return; }
      if (audienceOpen && audience) { errors.push(`${at}: nested audience block (opened at ${audience.at})`); return; }
      if (audienceOpen && audienceOpen[1] !== 'lead') { errors.push(`${at}: unknown audience: ${audienceOpen[1] || '(empty)'}; the only audience is lead`); return; }
      if (!audienceOpen && !audience) { errors.push(`${at}: stray /audience`); return; }
      if (midParagraph && !/[.!?]$/.test(lines[index - 1].trim())) { errors.push(`${at}: an audience marker inside a paragraph must follow a line that ends a sentence`); return; }
      flush(null);
      audience = audienceOpen ? { at } : null;
      glue = midParagraph;
    } else if (host) {
      if (block) { errors.push(`${at}: nested host block (opened at ${block.at})`); return; }
      const names = host[1].split(',').map((n) => n.trim());
      if (!host[1].trim() || names.some((n) => !HOSTS.includes(n))) { errors.push(`${at}: host list must name only ${HOSTS.join(', ')}`); return; }
      flush(null);
      block = { at, hosts: new Set(names) };
    } else if (body === '/host') {
      if (!block) { errors.push(`${at}: stray /host`); return; }
      flush(block.hosts);
      block = null;
    } else if (backstop) {
      if (!existsSync(join(ROOT, backstop[1]))) errors.push(`${at}: backstop path does not exist: ${backstop[1]}`);
      if (backstop[2] && !infra.includes(`\`${backstop[2]}\``)) errors.push(`${at}: switch ${backstop[2]} is not in INFRASTRUCTURE.md`);
      flush(block ? block.hosts : null);
    } else if (/^note:/.test(body)) {
      flush(block ? block.hosts : null);
    } else {
      errors.push(`${at}: unknown directive: ${body}`);
    }
  });
  if (block) errors.push(`${SOURCE}: host block opened at ${block.at} is never closed`);
  if (audience) errors.push(`${SOURCE}: audience block opened at ${audience.at} is never closed`);
  flush(null);
  return { chunks, errors };
}

const finish = (body) => `${body.replace(/\n{3,}/g, '\n\n')}\n`;

// The lead host's render drops audience text; every other render keeps it inline and rejoins a
// split paragraph.
function renderHost(chunks, host) {
  const split = host === LEAD_HOST;
  let body = '';
  for (const c of chunks) {
    const text = c.text.trim();
    if (!text || (c.hosts && !c.hosts.has(host)) || (split && c.lead)) continue;
    body += body ? `${c.glue && !split ? ' ' : '\n\n'}${text}` : text;
  }
  return finish(body);
}

// The lead file: the lead host's audience text, each run under the ## heading of its section.
function renderLead(chunks) {
  const parts = [LEAD_HEADER];
  let heading = null;
  let written = null;
  for (const c of chunks) {
    const text = c.text.trim();
    if (!text || (c.hosts && !c.hosts.has(LEAD_HOST))) continue;
    if (!c.lead) { heading = text.split('\n').filter((l) => /^##\s/.test(l)).pop() ?? heading; continue; }
    if (heading && heading !== written) { parts.push(heading); written = heading; }
    parts.push(text);
  }
  return finish(parts.join('\n\n'));
}

const fail = (lines) => { for (const l of lines) console.error(l); process.exit(1); };

if (!existsSync(join(DIR, SOURCE))) fail([`FAIL: missing ${SOURCE} in global-contracts/`]);
const { chunks, errors } = parse(readFileSync(join(DIR, SOURCE), 'utf8'));
if (errors.length) fail(errors.map((e) => `FAIL: ${e}`));

// Each output names the host whose FORBIDDEN terms it is held to.
const outputs = [
  ...HOSTS.map((host) => ({ host, label: `${host} render`, name: host, path: `global-contracts/${outName(host)}`, text: renderHost(chunks, host) })),
  { host: LEAD_HOST, label: 'lead file', name: 'lead', path: LEAD_FILE, text: renderLead(chunks) },
];
const leaks = outputs.flatMap((o) => FORBIDDEN[o.host].filter((term) => o.text.includes(term)).map((term) => `FAIL: the ${o.label} contains the reserved term ${JSON.stringify(term)}`));
if (leaks.length) fail(leaks);

if (STATS) for (const o of outputs) console.log(`${o.name.padEnd(6)} ${words(o.text)} words`);

const expected = new Set([SOURCE, ...HOSTS.map(outName)]);
const unexpected = readdirSync(DIR).filter((f) => f.endsWith('.md') && !expected.has(f));
const problems = unexpected.map((f) => `unexpected file: global-contracts/${f} (the source is ${SOURCE}; delete it)`);
for (const o of outputs) {
  const file = join(ROOT, o.path);
  const live = existsSync(file) ? lf(readFileSync(file, 'utf8')) : null;
  if (CHECK) {
    if (live === null) problems.push(`missing generated file: ${o.path}`);
    else if (live !== o.text) problems.push(`stale generated file: ${o.path}`);
  } else if (live !== o.text) {
    writeFileSync(file, o.text);
    console.log(`wrote ${o.path}`);
  }
}
if (problems.length) fail([...problems.map((p) => `FAIL: ${p}`), ...(CHECK ? ['Run: node scripts/render-global-contracts.mjs'] : [])]);
if (CHECK) console.log('ok: global contracts are up to date');
