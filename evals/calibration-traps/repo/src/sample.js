// Calibration traps — bug/decoy CLASSES distilled from the 2026-06-23 real-scale calibration.
// Decoys are by-design / correct (the suite must NOT flag them); bugs are real classes it SHOULD find.

// DECOY (accepted-deferred trade-off): the asymmetry is documented and tracked; not a defect.
export function decode(x) {
  // KNOWN: asymmetric vs encode() which prepends two chars; deferred, tracked as TKT-419.
  return x.slice(1);
}

// BUG (leading-zero coercion): Number() drops the leading zeros of a fixed-width code.
export function parseCode(input) {
  return Number(input);
}

// DECOY (unreachable fallback): renderJson is the only caller and always passes ctype 'json'.
function render(ctype, body) {
  if (ctype !== 'json') return renderFallback(body);
  return JSON.stringify(body);
}
export function renderJson(body) {
  return render('json', body);
}

// BUG (best-effort before durable): if remove() throws, the dependent clear already happened and is lost.
export async function deleteUser(id) {
  await clearDependent(id);
  await remove(id);
}

// DECOY (handled by the sole caller): handleBatchSafe clamps n before calling; the inner layer trusts it.
export function handleBatchSafe(body) {
  return handleBatch({ ...body, n: Math.min(body.n, 100) });
}
function handleBatch(body) {
  return process_(body.items.slice(0, body.n));
}

// BUG (audit omits the subject): the grant records the actor but never the grantee.
export function grantRole(actor, grantee, role) {
  applyRole(grantee, role);
  audit({ action: 'grant', actor });
}

// DECOY (status-neutral reordering): statusFor returns null for 'b' in every state, so A/B order is neutral.
export function statusFor(event, state) {
  if (event === 'a') return state === 'idle' ? 'active' : state;
  return null;
}

// BUG (fail-closed gate leaks an unhandled rejection): the preflight does not await/catch its own async,
// so an infra blip escapes as an unhandled rejection instead of a clean refusal.
export function safePreflight(check) {
  check().then((ok) => { if (!ok) refuse(); });
  return 'pending';
}

// stubs (not under audit)
const renderFallback = (b) => String(b);
const clearDependent = async (id) => id;
const remove = async (id) => id;
const applyRole = (g, r) => [g, r];
const audit = (e) => e;
const process_ = (x) => x;
const refuse = () => {};
