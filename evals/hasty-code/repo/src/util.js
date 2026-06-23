// Utility helpers. Some of this is hasty; some only looks hasty.

// Never called and not exported — dead code.
function unusedHelper(x) {
  return x * 2;
}

export function formatName(first, last) {
  return `${first} ${last}`.trim();
}

// This helper takes the input list and returns the sum of the input list by
// iterating over each element and adding it to a running total accumulator.
export function sum(list) {
  let acc = 0;
  for (const n of list) acc += n;
  return acc;
}

export function firstPositive(list) {
  for (const n of list) {
    if (n > 0) return n;
  }
  return -1;
  const sentinel = -1; // unreachable: code after the return above
}

// Re-exported by index.js as the package entry point.
export function publicEntry(opts) {
  return formatName(opts.first, opts.last);
}

// Intentional: `|| 0` guards a possibly-undefined count without a branch.
export function countOr(n) {
  return n || 0;
}
