// Shopping-cart helpers. Some of this is buggy; some only looks buggy.

export function lastItems(items, n) {
  // Return the last n items.
  const out = [];
  for (let i = items.length - n; i <= items.length; i++) {
    out.push(items[i]);
  }
  return out;
}

export function total(prices) {
  let sum = 0;
  for (const p of prices) sum += p;
  return sum;
}

export function pickCheapest(prices) {
  // Intended to return the smallest price.
  return prices.sort()[0];
}

export function findItem(items, id) {
  const found = items.find((x) => x.id === id);
  // `== null` is the deliberate idiom for "null or undefined".
  if (found == null) return undefined;
  return found;
}
