#!/usr/bin/env node
// Egress manifest recorder + validator for the researcher plugin — the mechanical floor
// under its "local-first, disclosed egress" model (CONVENTIONS §A). Zero-dependency Node ESM.
//
// WHY: an undisclosed web fetch inside a research artifact is invisible to a reviewer unless
// every citation is cross-checked against what was actually disclosed; this makes that
// cross-check mechanical instead of relying on the agent's own say-so.
//
//   node research-manifest.mjs record --tool <t> --url <u> --why <w> [--host <h>] [--manifest <path>]
//   node research-manifest.mjs validate <artifact.md> [...more] [--manifest <path>] [--report-only]
//
// record:   append one disclosed external request to EGRESS_MANIFEST.md (creating it if needed).
// validate: a research artifact must not cite a web source it did not disclose. Every http(s) URL
//           cited in an artifact must have a matching host in the manifest; otherwise the egress
//           was undisclosed → fail closed (exit 1, unless --report-only). An artifact that cites no
//           web source (local-only research) passes trivially — that is the default, private path.
//
// Exit: record → 0 on success, 2 on a missing/blank --url or an unresolvable host. validate → 0
// clean, 1 undisclosed citation(s) or an unreadable artifact (unless --report-only), 2 on a usage
// error (no files given, or an unrecognized --flag).

import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const reportOnly = argv.includes('--report-only');
const manifestPath = resolve(flag('--manifest') || 'EGRESS_MANIFEST.md');

const URL_RE = /\bhttps?:\/\/[^\s)<>"'`\]]+/gi;
const stripTrailing = (u) => u.replace(/[).,;:'"\]]+$/, '');
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return null; } };

const HEADER = '# Egress Manifest\n\nEvery external (web) request the researcher made, disclosed per CONVENTIONS §A.\n\n| timestamp | tool | host | url | why |\n| --- | --- | --- | --- | --- |\n';

function recordedHosts() {
  if (!existsSync(manifestPath)) return new Set();
  const hosts = new Set();
  // SEC (fix): derive disclosed hosts ONLY from the structured `host` and `url` table columns,
  // never from a free-text `why` cell (a URL in a rationale must not silently whitelist its host),
  // and honor the explicit `--host` override recorded in the host column (incl. non-http(s) urls).
  for (const line of readFileSync(manifestPath, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim()); // ['', timestamp, tool, host, url, why, '']
    const host = cells[3], url = cells[4];
    if (!host || host === 'host' || /^-+$/.test(host)) continue; // skip the header + separator rows
    hosts.add(host.toLowerCase());
    const hu = hostOf(stripTrailing(url || ''));
    if (hu) hosts.add(hu);
  }
  return hosts;
}

if (cmd === 'record') {
  const tool = flag('--tool') || 'unknown';
  const urlRaw = flag('--url');
  const url = stripTrailing(urlRaw && urlRaw.trim() !== '' ? urlRaw : '');
  const why = flag('--why') || '';
  const hostRaw = flag('--host');
  const host = (hostRaw && hostRaw.trim() !== '' ? hostRaw : null) || hostOf(url); // explicit override allowed (blank/whitespace-only ignored); otherwise derived from the url
  if (!url || !host) { console.error('x record needs --url (http/https); --host optional'); process.exit(2); }
  if (!existsSync(manifestPath)) writeFileSync(manifestPath, HEADER);
  const ts = new Date().toISOString();
  const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  appendFileSync(manifestPath, `| ${ts} | ${esc(tool)} | ${esc(host)} | ${esc(url)} | ${esc(why)} |\n`);
  console.log(`recorded: ${host} (${tool})`);
  process.exit(0);
}

if (cmd === 'validate') {
  // Positional pass — consume --manifest+value and --report-only by position (no value-based indexOf).
  const files = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') { i++; continue; }
    if (a === '--report-only') continue;
    // An unrecognized --flag must not be silently swallowed — it would otherwise vanish with
    // no trace instead of surfacing the typo (a missing/misspelled --report-only, say).
    if (a.startsWith('--')) { console.error(`x unknown argument: ${a}`); process.exit(2); }
    files.push(a);
  }
  if (files.length === 0) { console.error('usage: research-manifest.mjs validate <artifact.md> [...] [--manifest <path>] [--report-only]'); process.exit(2); }
  const disclosed = recordedHosts();
  let undisclosed = 0, cited = 0, unreadable = 0;
  for (const f of files) {
    const abs = resolve(f);
    if (!existsSync(abs)) { console.error(`x not found: ${f}`); unreadable++; continue; }
    if (abs === manifestPath) continue; // never validate the manifest against itself
    const text = readFileSync(abs, 'utf8');
    const urls = [...new Set([...text.matchAll(URL_RE)].map((m) => stripTrailing(m[0])))];
    for (const u of urls) {
      const h = hostOf(u);
      if (!h) continue;
      cited++;
      if (!disclosed.has(h)) { undisclosed++; console.error(`  !! undisclosed egress: ${f} cites ${u} (host ${h}) with no EGRESS_MANIFEST entry`); }
    }
  }
  console.log(`\n${cited} external citation(s) checked, ${undisclosed} undisclosed, ${unreadable} unreadable.`);
  if ((undisclosed + unreadable) > 0 && !reportOnly) {
    console.error('Undisclosed external source(s) or unreadable artifact(s) — record/remove citations (or fix the path) before publishing.');
    process.exit(1);
  }
  process.exit(0);
}

console.error('usage: research-manifest.mjs <record|validate> ...');
process.exit(2);
