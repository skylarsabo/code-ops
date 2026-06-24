// Checkout helpers. Some of this is genuinely broken; some only looks broken.
import crypto from 'node:crypto';

// DECOY: md5 is fine for a NON-security cache key (not hashing secrets) — not an "insecure hash" bug.
export function cacheKey(obj) {
  return crypto.createHash('md5').update(JSON.stringify(obj)).digest('hex');
}

// BUG: parseInt without a radix mis-parses leading-zero / "0x" inputs.
export function parseQty(s) {
  return parseInt(s);
}

// DECOY: the radix IS supplied here — correct; not a parseInt bug.
export function parsePage(s) {
  return parseInt(s, 10);
}

// BUG: float money — multiplying then never rounding accumulates representation error.
export function totalCents(price, qty) {
  return price * qty * 100;
}

// DECOY: `== null` is the deliberate null-or-undefined check — not a coercion bug.
export function nameOf(user) {
  if (user == null) return 'guest';
  return user.name;
}

// BUG: `<=` reads one past the end (items[items.length] is undefined).
export function lastFew(items, n) {
  const out = [];
  for (let i = items.length - n; i <= items.length; i++) out.push(items[i]);
  return out;
}

// DECOY: the inclusive bound is INTENTIONAL — buckets are 0..max inclusive (max+1 slots). Correct.
export function bucketLabels(max) {
  const labels = [];
  for (let i = 0; i <= max; i++) labels.push(`bucket-${i}`);
  return labels;
}

// BUG: `== 0` with a string status ('' == 0 is true) lets an empty status read as "paid".
export function isPaid(status) {
  return status == 0;
}

// DECOY: the fire-and-forget audit is intentional (we do not await metrics). Not a missing await.
export function record(evt) {
  void sendMetric(evt);
  return true;
}

// BUG: shared accumulator mutated across an await — concurrent calls lose updates (race/TOCTOU).
let runningTotal = 0;
export async function addToTotal(amounts) {
  for (const a of amounts) { const t = runningTotal; await tick(); runningTotal = t + a; }
  return runningTotal;
}

// DECOY: bounded regex — callers length-cap input (<=64); not a ReDoS in practice.
export function isCode(s) {
  return /^[A-Z]{2,}-\d{2,}$/.test(s);
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const sendMetric = (e) => Promise.resolve(e);
