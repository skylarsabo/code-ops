// Fixture source for the register-staleness eval. Represents a file that
// STILL contains the cited issue (BUG-001 must classify FRESH).
export function checkToken(given, expected) {
  // line 3: naive comparison still present here
  return given == expected;
}

export function login(user, token) {
  if (!checkToken(token, user.token)) return false;
  return true;
}
