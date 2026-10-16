// Query-set parsing and validation. Fails closed: any malformed field throws.

const SKILL_ID = /^[a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*$/;
const NEGATIVE = 'none';

/** Parse and validate a query-set JSON text. Returns { skill, queries }. Throws on bad input. */
export function parseQuerySet(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new Error(`query set is not valid JSON: ${e.message}`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('query set must be a JSON object');
  if (typeof doc.skill !== 'string' || !SKILL_ID.test(doc.skill)) throw new Error('query set "skill" must be a plugin:skill id');
  if (!Array.isArray(doc.queries) || doc.queries.length === 0) throw new Error('query set "queries" must be a non-empty array');
  const seen = new Set();
  const queries = doc.queries.map((q, i) => {
    const at = `queries[${i}]`;
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new Error(`${at} must be an object`);
    if (typeof q.query !== 'string' || q.query.trim() === '') throw new Error(`${at}.query must be a non-empty string`);
    if (typeof q.expect !== 'string' || !(q.expect === NEGATIVE || SKILL_ID.test(q.expect)))
      throw new Error(`${at}.expect must be "none" or a plugin:skill id`);
    if (typeof q.stratum !== 'string' || q.stratum.trim() === '') throw new Error(`${at}.stratum must be a non-empty string`);
    if (seen.has(q.query)) throw new Error(`${at}.query duplicates an earlier query`);
    seen.add(q.query);
    return { query: q.query, expect: q.expect, stratum: q.stratum };
  });
  if (!queries.some((q) => q.expect === doc.skill)) throw new Error('query set has no positive query (expect equal to "skill")');
  if (!queries.some((q) => q.expect !== doc.skill)) throw new Error('query set has no negative query');
  return { skill: doc.skill, queries };
}
