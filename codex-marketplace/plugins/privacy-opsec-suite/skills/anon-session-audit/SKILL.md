---
name: anon-session-audit
description: "Use when you need to verify sessions are truly unlinkable. Owns linkability and session identity, not network egress or file metadata."
---

# Anonymous session audit: are sessions truly unlinkable

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:anon-session-audit`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** AUDIT.
- **Produces:** findings in `LEAK_REGISTER.md`, plus a summary.

## Phase 0: map identity and sessions  *(checkpoint)*

Dispatch the explorer subagent to trace how identity and sessions work: the session
identifiers, the cookies and tokens, the account model (account-less, guest, or ephemeral),
the lifecycle of create, resume, expire, and log out, and where session state is stored on
the client and on the server.

> **CHECKPOINT:** present the session and identity map, then confirm the scope.

## Phase 1: hunt linkability

- **Cross-request and cross-session linkability.** Can two requests, or two sessions, be
  tied to one user through a reused token, a stable identifier, or account binding?
- **Hidden persistent identifiers.** Look for device IDs, `localStorage` and IndexedDB,
  `ETag` or cache used as a supercookie, HSTS and TLS-session-resumption tracking, and
  canvas or storage fallbacks. Any of them can silently re-associate a returning anonymous
  user.
- **Session integrity.** Look for fixation, predictable or low-entropy tokens, missing
  rotation, resumption that leaks a prior identity, and cookie flags and scope, meaning
  `HttpOnly`, `Secure`, `SameSite`, and a domain set too broad.
- **Lifecycle.** Does logging out fully clear the state? Do the session keys have forward
  secrecy? Is expiry actually enforced on the server?
- **Defaults.** Is the logged-out or guest path genuinely unlinkable, and is anonymous the
  default, with no silent persistent identity created?

Keep tiers honest at the point of use. A leak you did not reproduce or directly observe is
PROBABLE at most, never CONFIRMED (`§6`). When you are unsure between two tiers, pick the
lower one.

## Deliverables

Findings on the `§6` schema, with leak-class `linkability` or `identification`, written into
`LEAK_REGISTER.md`. A short summary of the linkability posture and the highest-risk vectors.

## Done when

The session and identity model is fully traced for linkability. Hidden-identifier vectors
are checked, the defaults are verified anonymous, and every finding carries its evidence and
a remediation.
