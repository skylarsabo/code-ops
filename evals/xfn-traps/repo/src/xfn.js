// Internal order helpers. No annotations. Some lines are genuine defects; some are
// safe only because of a guard in another function. Read the whole file.
export function keyFor(obj) {
  return String(obj && obj.id);
}

// ---- pair 1: unvalidated slice bound ----
function sliceTopA(items, n) {
  return items.slice(0, n);
}
export function pageClamped(req) {
  return sliceTopA(req.items, Math.min(req.n ?? 0, 100));
}

function sliceTopB(items, n) {
  return items.slice(0, n);
}
export function pageRaw(req) {
  return sliceTopB(req.items, req.n);
}

// ---- pair 2: non-json branch ----
function renderA(ctype, body) {
  if (ctype !== 'json') return dangerA(body);
  return JSON.stringify(body);
}
export function emitJson(body) {
  return renderA('json', body);
}

function renderB(ctype, body) {
  if (ctype !== 'json') return dangerB(body);
  return JSON.stringify(body);
}
export function emitAny(ctype, body) {
  return renderB(ctype, body);
}

// ---- pair 3: null dereference ----
function useNameA(u) {
  return u.name.toUpperCase();
}
export function greet(id) {
  const u = lookup(id);
  if (!u) return 'guest';
  return useNameA(u);
}

function useNameB(u) {
  return u.name.toUpperCase();
}
export function greetRaw(id) {
  return useNameB(lookup(id));
}

// ---- pair 4: discount percent bound ----
function applyDiscountA(price, pct) {
  return price - price * pct;
}
export function checkoutClamped(price, pct) {
  return applyDiscountA(price, Math.max(0, Math.min(pct, 1)));
}

function applyDiscountB(price, pct) {
  return price - price * pct;
}
export function checkoutRaw(price, pct) {
  return applyDiscountB(price, pct);
}

// stubs
const dangerA = (b) => String(b).length;
const dangerB = (b) => String(b).length;
const lookup = (id) => (id ? { name: 'x' } : null);
