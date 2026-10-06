#!/usr/bin/env node
// Render the per-host global contracts from the one authored source.
//
//   node scripts/render-global-contracts.mjs [--check] [--stats]
//
// global-contracts/AGENTS.source.md is the only authored global contract. This script writes
// global-contracts/AGENTS.claude.md, AGENTS.codex.md, and AGENTS.grok.md, which sync-global.mjs
// installs. The derived files carry no header and no timestamp, because installed bytes cost
// tokens in every session and the output must be byte-stable.
//
// Source directives each sit alone on a line:
//   <!-- host: claude,codex -->  ...  <!-- /host -->   a block for the listed hosts; no nesting
//   <!-- backstop: path [switch=NAME] -->              a pointer check, stripped from the output
//   <!-- note: text -->                                a comment, stripped from the output
// Untagged text is for all hosts. A source error fails closed: an unclosed, nested, or stray
// directive, an unknown or empty host list, a backstop path that does not exist, a switch name
// absent from INFRASTRUCTURE.md, or a directive that shares its line with other text.
//
// Leak guard: after rendering, a render that holds a term reserved for another host fails.
// --check renders in memory and compares with the files on disk (LF normalized). It reports
// stale, missing, and unexpected files, and any other .md file in global-contracts/.
// --stats prints the word count of each render.
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

// Split the source into chunks at the directives. hosts is null for text every host gets.
function parse(text) {
  const errors = [];
  const chunks = [];
  let buffer = [];
  let block = null;
  const infra = existsSync(INFRASTRUCTURE) ? lf(readFileSync(INFRASTRUCTURE, 'utf8')) : '';
  const flush = (hosts) => { chunks.push({ hosts, text: buffer.join('\n') }); buffer = []; };
  lf(text).split('\n').forEach((raw, index) => {
    const at = `${SOURCE}:${index + 1}`;
    const trimmed = raw.trim();
    if (!trimmed.includes('<!--') && !trimmed.includes('-->')) { buffer.push(raw); return; }
    const body = /^<!--\s*(.*?)\s*-->$/.exec(trimmed)?.[1];
    if (body === undefined || body.includes('<!--') || body.includes('-->')) { errors.push(`${at}: a directive must sit alone on its line`); return; }
    const host = /^host:\s*(.*)$/.exec(body);
    const backstop = /^backstop:\s*(\S+)(?:\s+switch=(\S+))?$/.exec(body);
    if (host) {
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
  flush(null);
  return { chunks, errors };
}

function renderHost(chunks, host) {
  const body = chunks.filter((c) => !c.hosts || c.hosts.has(host)).map((c) => c.text.trim()).filter(Boolean).join('\n\n');
  return `${body.replace(/\n{3,}/g, '\n\n')}\n`;
}

const fail = (lines) => { for (const l of lines) console.error(l); process.exit(1); };

if (!existsSync(join(DIR, SOURCE))) fail([`FAIL: missing ${SOURCE} in global-contracts/`]);
const { chunks, errors } = parse(readFileSync(join(DIR, SOURCE), 'utf8'));
if (errors.length) fail(errors.map((e) => `FAIL: ${e}`));

const renders = Object.fromEntries(HOSTS.map((host) => [host, renderHost(chunks, host)]));
const leaks = HOSTS.flatMap((host) => FORBIDDEN[host].filter((term) => renders[host].includes(term)).map((term) => `FAIL: the ${host} render contains the reserved term ${JSON.stringify(term)}`));
if (leaks.length) fail(leaks);

if (STATS) for (const host of HOSTS) console.log(`${host.padEnd(6)} ${words(renders[host])} words`);

const expected = new Set([SOURCE, ...HOSTS.map(outName)]);
const unexpected = readdirSync(DIR).filter((f) => f.endsWith('.md') && !expected.has(f));
const problems = unexpected.map((f) => `unexpected file: global-contracts/${f} (the source is ${SOURCE}; delete it)`);
for (const host of HOSTS) {
  const file = join(DIR, outName(host));
  const live = existsSync(file) ? lf(readFileSync(file, 'utf8')) : null;
  if (CHECK) {
    if (live === null) problems.push(`missing generated file: global-contracts/${outName(host)}`);
    else if (live !== renders[host]) problems.push(`stale generated file: global-contracts/${outName(host)}`);
  } else if (live !== renders[host]) {
    writeFileSync(file, renders[host]);
    console.log(`wrote global-contracts/${outName(host)}`);
  }
}
if (problems.length) fail([...problems.map((p) => `FAIL: ${p}`), ...(CHECK ? ['Run: node scripts/render-global-contracts.mjs'] : [])]);
if (CHECK) console.log('ok: global contracts are up to date');
