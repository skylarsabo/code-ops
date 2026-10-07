#!/usr/bin/env node
// Advisory gap-link check for a pull request body.
//
//   node scripts/check-gap-link.mjs <pr-text-file> [--doc <direction-note>]
//
// WHY: the direction note ranks the suite's open gaps, and a change that advances one should say
// so where a reviewer reads it. This reads the PR body and reports whether it links a row of the
// note's gap table, either as `Gap: G4` (a comma list names several) or as
// `[[Suite direction 2026-08#G4]]`.
//
// ADVISORY BY DESIGN: a body with no link, or a link to an id the table lacks, prints a note and
// the script still exits 0. Promotion to a failing gate waits for zero false positives over three
// weeks (operator decision 2026-10-06). The script also exits 0 when the note or the body file is
// unreadable, so it can never fail a run for a reason outside the body's content.
//
// Exit: 0 always on content; 2 on a usage error (no body file, an unknown flag).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The note lives in the code-ops repository hub; an adopting repo has no such file and skips.
export const DEFAULT_DOC = join(ROOT, 'code-ops-docs', '10 Design', 'Suite direction 2026-08.md'); // in the code-ops repository

// The ids of the gap table: rows whose first cell is G<n>.
export function gapIds(docText) {
  return [...docText.matchAll(/^\|\s*(G\d+)\s*\|/gm)].map((m) => m[1]);
}

// The ids a PR body names, upper-cased and de-duplicated, in order of first appearance.
export function gapLinks(body) {
  const found = [];
  const add = (id) => { const up = id.toUpperCase(); if (!found.includes(up)) found.push(up); };
  for (const m of body.matchAll(/\bGap:\s*(G\d+(?:\s*,\s*G\d+)*)/gi)) for (const id of m[1].split(',')) add(id.trim());
  for (const m of body.matchAll(/Suite direction 2026-08(?:\.md)?#(G\d+)\b/gi)) add(m[1]);
  return found;
}

// { ok, linked, unknown, note }: ok when the body links at least one id the table holds.
export function assess(body, ids) {
  const linked = gapLinks(body);
  const known = linked.filter((id) => ids.includes(id));
  const unknown = linked.filter((id) => !ids.includes(id));
  if (known.length) return { ok: true, linked: known, unknown, note: `gap link accepted (${known.join(', ')})` };
  if (unknown.length) return { ok: false, linked: [], unknown, note: `the body names ${unknown.join(', ')}, which the gap table does not list` };
  return { ok: false, linked: [], unknown: [], note: 'the body links no gap row' };
}

function main(argv) {
  const rest = [...argv];
  let doc = DEFAULT_DOC;
  let bodyFile = null;
  while (rest.length) {
    const a = rest.shift();
    if (a === '--doc') { doc = rest.shift(); if (!doc) return usage('--doc needs a path'); }
    else if (a.startsWith('-')) return usage(`unknown flag ${a}`);
    else if (bodyFile === null) bodyFile = a;
    else return usage('one body file only');
  }
  if (bodyFile === null) return usage('name the PR body file');

  if (!existsSync(doc)) { console.log('gap-link: skipped (no direction note in this repository)'); return 0; }
  let body;
  let ids;
  try {
    body = existsSync(bodyFile) ? readFileSync(bodyFile, 'utf8') : '';
    ids = gapIds(readFileSync(doc, 'utf8'));
  } catch (e) {
    console.log(`gap-link: skipped (${e.code || 'read error'})`);
    return 0;
  }
  if (!ids.length) { console.log('gap-link: skipped (the direction note has no gap table)'); return 0; }

  const r = assess(body, ids);
  if (r.ok) { console.log(`gap-link: ${r.note}`); return 0; }
  const advice = `Advisory: ${r.note}. Link the gap this change advances as "Gap: ${ids[0]}" or "[[Suite direction 2026-08#${ids[0]}]]" (ids ${ids[0]} to ${ids[ids.length - 1]}), or ignore this note when no gap applies.`;
  console.log(`gap-link: ${advice}`);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::notice title=Direction gap link::${advice}`);
  return 0;
}

function usage(msg) {
  console.error(`check-gap-link: ${msg}\nusage: node scripts/check-gap-link.mjs <pr-text-file> [--doc <direction-note>]`);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
