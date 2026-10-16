// Seeded, deterministic, stratified train/test split.

/** mulberry32 PRNG from a 32-bit integer seed. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string to a 32-bit integer. */
export function hashSeed(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Split queries into { train, test }. Each stratum is sorted by query text (so input order
 * does not matter), shuffled with the seed, and the first round(n * fraction) go to test.
 * A stratum of one query stays in train.
 */
export function stratifiedSplit(queries, { seed = 1, testFraction = 0.4 } = {}) {
  if (!Number.isFinite(testFraction) || testFraction < 0 || testFraction > 1) throw new Error('testFraction must be between 0 and 1');
  const byStratum = new Map();
  for (const q of queries) {
    if (!byStratum.has(q.stratum)) byStratum.set(q.stratum, []);
    byStratum.get(q.stratum).push(q);
  }
  const train = [];
  const test = [];
  for (const stratum of [...byStratum.keys()].sort()) {
    const items = byStratum.get(stratum).slice().sort((a, b) => (a.query < b.query ? -1 : a.query > b.query ? 1 : 0));
    const rand = prng((seed >>> 0) ^ hashSeed(stratum));
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    const nTest = items.length < 2 ? 0 : Math.round(items.length * testFraction);
    test.push(...items.slice(0, nTest));
    train.push(...items.slice(nTest));
  }
  return { train, test };
}
