// @ts-check
// Shared partial acceptance semantics; completion remains the finalizer's concern.
import { existsSync, readFileSync } from 'node:fs';
import { TIER_RANK, modelRankOf } from './model-tiers.mjs';

export const ACCEPT_HEADER = '| criterion | attempt | verdict | proof | accepted by | reason |\n| --- | --- | --- | --- | --- | --- |\n';

/** @typedef {{ id: string, owner: string }} Criterion */

/**
 * @param {Criterion} criterion
 * @param {string} actor
 */
export function actorError(criterion, actor) {
  if (criterion.owner === 'tool' && actor !== 'tool') return 'actor does not match criterion owner';
  if (criterion.owner === 'user' && actor !== 'user') return 'actor does not match criterion owner';
  if (['lead', 'reviewer'].includes(criterion.owner)) {
    const match = actor.match(/^([^@]+)@(.+)$/);
    const rank = match && modelRankOf(match[2]);
    if (!match || match[1] !== criterion.owner || !Number.isInteger(rank) || /** @type {number} */ (rank) < TIER_RANK.strong) return 'actor must be owner@strong-or-better-model';
  }
  return null;
}

/**
 * @param {string} path
 * @param {{ quality: { criteria: Criterion[] } }} contract
 */
export function parseAcceptance(path, contract) {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  if (!text.startsWith(ACCEPT_HEADER)) throw new Error(`acceptance ledger has invalid header: ${path}`);
  const rows = [];
  const attempts = new Map();
  const criteria = new Map(contract.quality.criteria.map((criterion) => [criterion.id, criterion]));
  for (const [index, line] of text.slice(ACCEPT_HEADER.length).split(/\r?\n/).entries()) {
    if (!line) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    const label = `acceptance ledger row ${index + 3}`;
    if (!line.startsWith('|') || !line.endsWith('|') || cells.length !== 6 || !/^Q-\d{3}$/.test(cells[0])
      || !/^\d+$/.test(cells[1]) || !['PASS', 'FAIL', 'UNKNOWN', 'N/A'].includes(cells[2])) {
      throw new Error(`acceptance ledger has malformed row ${index + 3}`);
    }
    const row = { criterion: cells[0], attempt: Number(cells[1]), verdict: cells[2], proof: cells[3], actor: cells[4], reason: cells[5] };
    const criterion = criteria.get(row.criterion);
    if (!criterion) throw new Error(`${label} names unknown criterion ${row.criterion}`);
    const expected = (attempts.get(row.criterion) || 0) + 1;
    if (row.attempt !== expected) throw new Error(`${label} breaks attempt sequence for ${row.criterion}`);
    attempts.set(row.criterion, row.attempt);
    if (!row.proof) throw new Error(`${label} has empty proof`);
    const problem = actorError(criterion, row.actor);
    if (problem) throw new Error(`${label}: ${problem}`);
    rows.push(row);
  }
  return rows;
}
