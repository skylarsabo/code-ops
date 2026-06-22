// Fixture source. The register cites util.js:500, which is now past EOF
// (the file shrank), so BUG-002 must classify MOVED.
export function slice2(arr, n) {
  return arr.slice(0, n);
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}
