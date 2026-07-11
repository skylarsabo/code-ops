---
name: anon-session-audit
description: "Use when you need to verify sessions are truly unlinkable. Owns linkability/session identity — not network egress or file metadata."
---

# ANON SESSION AUDIT — Are Sessions Truly Unlinkable

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:anon-session-audit`.** First read the bundled `<plugin-root>/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** AUDIT · **Produces:** findings → `LEAK_REGISTER.md`; summary.

## Phase 0 — Map identity & sessions  *(checkpoint)*
Trace how identity and sessions work: session identifiers, cookies/tokens, the account model (account-less? guest? ephemeral?), lifecycle (create/resume/expire/logout), and where session state is stored client- and server-side.
> **CHECKPOINT:** present the session/identity map; confirm scope.

## Phase 1 — Hunt linkability
- **Cross-request / cross-session linkability:** can two requests or two sessions be tied to one user? Reused tokens, stable identifiers, account binding.
- **Hidden persistent identifiers:** device IDs, `localStorage`/IndexedDB, `ETag`/cache-as-supercookie, HSTS/TLS-session-resumption tracking, canvas/storage fallbacks — anything that silently re-associates a returning "anonymous" user.
- **Session integrity:** fixation, predictable/low-entropy tokens, missing rotation, resumption that leaks prior identity, cookie flags/scope (`HttpOnly`/`Secure`/`SameSite`, domain too broad).
- **Lifecycle:** does logout *fully* clear state? forward secrecy of session keys? expiry actually enforced server-side?
- **Defaults:** is the logged-out/guest path genuinely unlinkable, and is anonymous the **default** (no silent persistent identity created)?

Tier honesty at point of use: a leak you did not reproduce or directly observe is PROBABLE at most — never CONFIRMED (`§6`); when unsure between tiers, pick the lower.
## Deliverables
Findings (schema `§6`, leak-class `linkability`/`identification`) → `LEAK_REGISTER.md`; a short summary of the linkability posture and the highest-risk vectors.

## Done when
The session/identity model is fully traced for linkability; hidden-ID vectors checked; defaults verified anonymous; findings have evidence + remediation.
