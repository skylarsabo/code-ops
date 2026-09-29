// Shared lookup for promoted ledger decisions. A grammar-2 decision promoted by
// `co decide promote` carries `Disposition: promoted:<record id>`, and its record lives in
// the documentation hub's records layer: sealed in `98 System/Records/state.json`, or staged
// in `98 System/Records/intake.jsonl` until the base branch seals it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './cli-lib.mjs';

export const PROMOTED_RE = /Disposition:\s*promoted:([^\s·`]+)/;
const DEC_RE = /\bDEC-\d+\b/;
const MANIFEST_TAIL = '/98 System/DOCS_MANIFEST.json';

// Each promoted decision in a ledger's text, as { dec, recordId, line }.
/** @param {string} text */
export function promotedIds(text) {
  const out = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const promoted = line.match(PROMOTED_RE);
    if (!promoted) continue;
    out.push({ dec: line.match(DEC_RE)?.[0] ?? null, recordId: promoted[1], line: index + 1 });
  }
  return out;
}

// The hub directory named by the one tracked manifest at `ref`, or on the working tree when
// `ref` is null. Null when the repository has no documentation manifest.
/** @param {string} root @param {string|null} [ref] */
export function hubOf(root, ref = null) {
  let paths;
  try {
    paths = ref
      ? git(['ls-tree', '-r', '--name-only', ref], { cwd: root }).split('\n')
      : git(['ls-files'], { cwd: root }).split('\n');
  } catch { return null; }
  const matches = paths.filter((path) => path.endsWith(MANIFEST_TAIL));
  return matches.length === 1 ? matches[0].slice(0, -MANIFEST_TAIL.length) : null;
}

/** @param {string} root @param {string} path @param {string|null} ref */
function readAt(root, path, ref) {
  if (!ref) return existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : null;
  try { return git(['show', `${ref}:${path}`], { cwd: root }); } catch { return null; }
}

// Where a record id stands at `ref` (the working tree when null):
// { where: 'sealed' | 'pending' | null, status: string | null }.
// `sealed` means state.json lists it with no pendingSeal. `pending` means state.json marks it
// pending seal or intake.jsonl names it by record id or intake id. `where: null` means unresolved.
/** @param {string} root @param {string} recordId @param {{ ref?: string|null, hub?: string|null }} [options] */
export function recordState(root, recordId, { ref = null, hub = hubOf(root, ref) } = {}) {
  if (hub === null) return { where: null, status: null };
  const stateText = readAt(root, `${hub}/98 System/Records/state.json`, ref);
  let records = [];
  try { records = stateText ? JSON.parse(stateText).records || [] : []; } catch { records = []; }
  const record = records.find((candidate) => candidate.id === recordId);
  if (record) return { where: record.pendingSeal ? 'pending' : 'sealed', status: record.status ?? null };
  const intakeText = readAt(root, `${hub}/98 System/Records/intake.jsonl`, ref) || '';
  for (const raw of intakeText.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    let line;
    try { line = JSON.parse(raw); } catch { continue; }
    if (line.type === 'record' && (line.recordId === recordId || line.intakeId === recordId)) {
      return { where: 'pending', status: 'in-force' };
    }
  }
  return { where: null, status: null };
}
