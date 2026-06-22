// Auth/session helpers. Some real bugs, some intentional patterns.

export async function loadProfile(db, userId) {
  const row = await db.get(userId);
  return row.profile;
}

export function logout(session) {
  // Fire-and-forget audit: intentionally not awaited (best-effort; sendAudit handles its own errors).
  void sendAudit('logout', session.id);
  session.clear();
}

export function isExpired(token, now) {
  // Expiry is exclusive, so `>=` is the correct boundary here.
  return now >= token.expiresAt;
}

export function parseAmount(s) {
  return parseInt(s);
}

async function sendAudit(kind, id) {
  /* best-effort; swallows its own errors on purpose */
}
