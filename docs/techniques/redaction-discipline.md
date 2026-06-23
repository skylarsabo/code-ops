# Technique — Redaction Discipline

> Secrets and PII are radioactive. They contaminate everything they touch —
> findings, evidence lines, registers, commit messages, chat transcripts. The
> rule is mechanical and absolute: **redact to `<REDACTED:reason>` everywhere,
> and never reproduce a live secret, real IP, or real identifier — not even
> "just in the evidence."** A discovered *live* secret is a **critical**
> finding: you report *where* it is and *how to rotate* it, never its value.

This is the privacy-opsec-suite's most-repeated safety rail, defined in
`CONVENTIONS.md` §4 and the `explorer` subagent contract; the principle (work
from redacted evidence) is echoed in `leak-incident-response` but without the
full placeholder form. This page turns it into a habit you can apply without
re-reading the source.

## Exec summary (stop here if that is all you need)

1. **One placeholder, always:** `<REDACTED:reason>`. The `reason` is a *class*,
   not the value — `<REDACTED:api-key>`, `<REDACTED:ip>`, `<REDACTED:email>`,
   `<REDACTED:session-token>`. Never paste the secret "for context."
2. **Redact in the evidence too.** The evidence line is the easiest place to
   slip — it is *supposed* to be proof. Proof is the *pattern and location*, not
   the live value. Show enough to confirm the finding yourself; show nothing an
   adversary could use.
3. **A live secret is a `critical` finding, reported by location + rotation —
   never by value.** "Hardcoded AWS key at `src/config.ts:14`; rotate the key in
   IAM, purge from git history, move to the secrets manager." The value never
   appears, not in the register, not in the PR, not in chat.
4. **Redaction is not editing the code.** Finding a live secret does not mean you
   silently delete it. You *report* it (location + rotation steps); the fix lands
   through the hardening loop with the developer, like any always-gated change
   (`CONVENTIONS.md` §4).
5. **It ties to the privacy lenses and the leak-class labels.** A redacted
   finding still carries a **Lens** and a **Leak-class** (`secret`, `metadata`,
   `identification`, …) so it routes and ranks like everything else.

---

## Why "radioactive" is the right metaphor

A secret or a real identifier does not just sit in the source file you found it
in. The moment you quote it, it spreads to wherever your output goes:

```mermaid
flowchart LR
  src[Live secret in code<br/>src/config.ts:14] --> ev[Evidence line]
  ev --> reg[LEAK_REGISTER.md]
  ev --> chat[Chat transcript]
  reg --> commit[Commit / PR]
  commit --> remote[Remote git history]
  chat --> logs[Tool / session logs]
  remote --> forever[(Effectively<br/>permanent)]
  logs --> forever
  classDef bad fill:#5a1e1e,stroke:#c0392b,color:#fff;
  class src,forever bad;
```

Each arrow is a copy you cannot recall. A register is committed; a commit is
pushed; a transcript may be retained. Redacting at the *source* of your output —
the evidence line — is the only point where you have full control. After that it
is out of your hands. Treat the value as something that must never enter the
pipeline at all.

This is the same fail-closed instinct the suite applies to egress (`CONVENTIONS.md`
§A): when in doubt, the most privacy-preserving option wins. With a value you are unsure
about, redact it.

## The placeholder, precisely

The canonical form (`CONVENTIONS.md` §4) is:

```
<REDACTED:reason>
```

- **`reason` names the class, never the content.** It tells the reader *what kind
  of sensitive thing* was here so the finding stays legible — `<REDACTED:ip>`,
  `<REDACTED:bearer-token>`, `<REDACTED:pii>`, `<REDACTED:user-id>`,
  `<REDACTED:onion-address>`. It must not encode, hash, truncate, or hint at the
  value. "First 4 chars are `sk-l`" is a leak.
- **One placeholder per distinct sensitive datum**, so a reader can see *how
  many* things were present and of what classes — that itself is signal (a log
  line carrying both an IP and an email is worse than one carrying neither).
- **Apply it uniformly:** in evidence, in the finding's Scenario and Impact, in
  the Disconfirmation note, in any quoted log or stack trace, in commit messages,
  and in anything you say in chat. The `explorer` subagent operates under exactly
  this rule: *"Never emit real identifiers, IPs, or user data. Redact to
  `<REDACTED:reason>` and report patterns, not values."*

## Before / after: a finding's evidence line

The discipline is easiest to see on a real-shaped evidence line. Suppose an
audit (say `metadata-leak-audit`) finds a log statement that prints the client
IP and a bearer token on an error path.

**Before — unsafe. Never write this.**

```markdown
- **Evidence:** error handler logs the full request context at
  `src/server/error.ts:73`:
  `logger.error("auth failed", { ip: "203.0.113.47",
   authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiO…" })`
```

That evidence line *is the leak now*. It copies a real IP and a live token into
the register, which gets committed and pushed. The finding meant to *fix* a leak
just created a worse one.

**After — redacted. This is the standard.**

```markdown
- **Evidence:** error handler logs the full request context at
  `src/server/error.ts:73`:
  `logger.error("auth failed", { ip: <REDACTED:ip>,
   authorization: <REDACTED:bearer-token> })`. Two identifiers
  (client IP + a live session token) reach the log sink unredacted on
  every auth failure.
```

Note what survived the redaction: the **`file:line`**, the **shape** of the call,
*which* fields leak, *which classes* they are, and the *condition* (every auth
failure). That is everything a reviewer needs to confirm the finding and write
the fix. What vanished is the only thing an adversary could use: the values.

> The same move appears in the cross-suite example at
> [reading-a-findings-register.md](reading-a-findings-register.md) — `SEC-042`'s
> evidence ends "Secret/PII in the trace redacted to `<REDACTED:pii>`." The
> finding is fully actionable with the value gone.

## The special case: a *live* secret

A real, currently-valid credential found in the tree (a hardcoded API key, a
committed `.env`, a private key, a token in git history) is not an ordinary
finding. Per `CONVENTIONS.md` §4 and §7 it is **`critical`** — the same tier as a
real deanonymization — and it has its own reporting shape:

**Report three things, and only these three:**

1. **Location** — `file:line` (and, if in history, the commit and the fact that
   it persists in history even after deletion from `HEAD`).
2. **Class** — what kind of secret, via the redaction reason (`<REDACTED:api-key>`,
   `<REDACTED:private-key>`), so severity and blast radius are legible.
3. **Rotation steps** — the credential is *burned the moment it was committed*, so
   the fix is always **rotate, then purge, then prevent**, not merely "delete the
   line":
   - **Rotate / revoke** the credential at its source (the provider console, the
     CA, the secrets manager) so the exposed value is dead.
   - **Purge** it from history if it was ever committed (history rewrite or the
     provider's secret-scanning remediation) — deletion from `HEAD` alone leaves
     it in every clone.
   - **Prevent recurrence:** move the secret to a manager/env injection, add a
     pre-commit secret scanner (a deterministic backstop the README calls for),
     and pin a regression guard via the hardening loop.

**Never report:** the value, any prefix/suffix of it, or a reversible
transformation of it.

A redacted critical-secret finding reads like this — fully actionable, zero
exposure:

```markdown
### SEC-101 · Live AWS access key hardcoded in source
- **Lens:** secrets & supply-chain trust · **Leak-class:** secret
- **Severity:** critical · **Tier:** CONFIRMED
- **Location:** `src/deploy/uploader.py:9` (also present in history since the
  initial commit — survives a HEAD-only deletion)
- **Evidence:** `AWS_ACCESS_KEY_ID = <REDACTED:aws-access-key>` assigned to a
  module-level constant and used by the S3 client at `:21`. Value confirmed
  live (matches the active-key format and is referenced by a working code path).
- **Remediation (rotate → purge → prevent):** (1) deactivate the key in IAM and
  issue a new one; (2) purge it from git history and rotate any downstream that
  cached it; (3) load from the secrets manager / env, add a pre-commit secret
  scan, and add a test asserting no credential literal in the deploy module.
- **Track:** NEEDS-REVIEW *(always-gated: secret handling)*
```

The fix is **always-gated** (`CONVENTIONS.md` §4): secret handling never
auto-applies and never auto-merges, regardless of automation level.

## How redaction fits the privacy lens and the leak-class labels

Redaction is not a separate workflow — it is the safe-handling layer *under* the
normal finding schema (`CONVENTIONS.md` §6). A redacted finding still carries:

- a **Lens** (`§9`) — most often **Secrets & supply-chain trust** for a live
  credential, **Metadata minimization** for PII/identifiers in logs/telemetry/
  errors, or **Identification & fingerprinting** for a re-identifying value; and
- a **Leak-class** label (`§6`): one of
  `linkability | observability | identification | metadata | egress | secret | correlation`.

So redaction does not erase the finding's routing — a `secret`-class critical
still ranks at the top by the severity floor (`§7`), a `metadata`-class
identifier-in-logs still routes by track. The placeholder only governs *how the
value is represented*; the lens and leak-class govern *what the finding means and
where it goes*. The two are orthogonal, by design: you never have to choose
between "report it usefully" and "report it safely."

One scope reminder from `CONVENTIONS.md` §0: this is **defensive** work — you are
finding and neutralizing leaks in *your own* system. Redaction discipline applies
to *your users' and your system's* secrets and identifiers. You are never
collecting, reproducing, or deanonymizing a third party.

## A short checklist

Run this before any finding, evidence line, register write, commit, or message
leaves your hands:

- [ ] Does any line contain a real secret, key, token, password, IP, email,
      username, account ID, device ID, onion address, or other identifier?
- [ ] If yes, is each replaced by `<REDACTED:reason>` with the reason naming the
      *class*, not the value (no prefix, hash, or hint)?
- [ ] Does the evidence still prove the finding from **pattern + `file:line`**
      alone, without the value?
- [ ] Is a *live* secret marked **`critical`**, leak-class **`secret`**, with
      **location + rotation steps** and **no value**?
- [ ] Is the secret-handling fix routed as **always-gated** (developer confirms;
      never auto-merged)?
- [ ] Did you avoid "investigating" by adding PII logging or echoing the value
      into output (`leak-incident-response` Phase 0: do not make it worse)?

If every box is checked, the value never entered the pipeline, and the finding is
still fully actionable.

## See also

- [Privacy & OpSec primer](../handbook/06-privacy-opsec-primer.md) — the privacy
  lens, the leak-class labels, and the anonymity & OpSec model this discipline
  serves.
- [Respond to a suspected leak](../guides/respond-to-a-suspected-leak.md) —
  the end-to-end guide for when the radioactive thing is already loose
  (`leak-incident-response`: triage → contain → scope → plan, without making it
  worse).
- [Reading and acting on a findings register](reading-a-findings-register.md) —
  the finding schema and how the redacted **Evidence** field is meant to read.
- [Evidence and tiers](../handbook/05-evidence-and-tiers.md) — what `critical`
  and `CONFIRMED` require, which a live-secret finding always is.

*Verified-at: c2b37e9*
