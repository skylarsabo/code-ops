# Redaction discipline

This page turns the suite's secrets rule into a habit you can apply without re-reading the
source. Read it before you write a finding, an evidence line, a register, a commit message,
or a chat reply that quotes code. It also names the mechanical gate that checks your output.

> Secrets and PII are radioactive. They contaminate everything they touch:
> findings, evidence lines, registers, commit messages, and chat transcripts. The
> rule is mechanical and absolute. **Redact to `<REDACTED:reason>` everywhere.
> Never reproduce a live secret, a real IP address, or a real identifier, not even
> "just in the evidence."** A discovered *live* secret is a **critical**
> finding. Report *where* it is and *how to rotate* it, never its value.

The privacy-opsec-suite defines this rail in `CONVENTIONS.md` §4 and in the `explorer`
subagent contract. `leak-incident-response` echoes the principle of working from redacted
evidence, but without the full placeholder form.

## Exec summary (stop here if that is all you need)

1. **One placeholder, always:** `<REDACTED:reason>`. The `reason` names a *class*,
   never the value. Use `<REDACTED:api-key>`, `<REDACTED:ip>`, `<REDACTED:email>`,
   or `<REDACTED:session-token>`. Never paste the secret "for context."
2. **Redact in the evidence too.** The evidence line is the easiest place to
   slip, because it is *supposed* to be proof. Proof is the *pattern and location*,
   not the live value. Show enough to confirm the finding yourself. Show nothing an
   adversary could use.
3. **A live secret is a `critical` finding, reported by location and rotation,
   never by value.** Write "Hardcoded AWS key at `src/config.ts:14`. Rotate the key in
   IAM, purge it from git history, and move it to the secrets manager." The value never
   appears, not in the register, not in the PR, and not in chat.
4. **Redaction is not editing the code.** Finding a live secret does not mean you
   silently delete it. You *report* it by location and rotation steps. The fix lands
   through the hardening loop with the developer, like any always-gated change
   (`CONVENTIONS.md` §4).
5. **Run the mechanical floor before shipping.** `node scripts/scan-redaction.mjs <artifacts>`
   fails closed on a deliverable that leaks (`CONVENTIONS.md` §4).
6. **It ties to the privacy lenses and the leak-class labels.** A redacted
   finding still carries a **Lens** and a **Leak-class** (`secret`, `metadata`,
   `identification`, and the rest), so it routes and ranks like everything else.

---

## How a secret spreads

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

Each arrow is a copy you cannot recall. A register is committed. A commit is
pushed. A transcript may be retained. Redacting at the *source* of your output, which is
the evidence line, is the only point where you have full control. Past that point the
copies are out of your hands. Treat the value as something that must never enter the
pipeline at all.

This is the same fail-closed instinct the suite applies to egress (`CONVENTIONS.md`
§A): when in doubt, the most privacy-preserving option wins. When you are unsure about a
value, redact it.

## The placeholder, precisely

The canonical form (`CONVENTIONS.md` §4) is:

```
<REDACTED:reason>
```

- **`reason` names the class, never the content.** It tells the reader *what kind
  of sensitive thing* was here, so the finding stays legible. Use `<REDACTED:ip>`,
  `<REDACTED:bearer-token>`, `<REDACTED:pii>`, `<REDACTED:user-id>`, or
  `<REDACTED:onion-address>`. It must not encode, hash, truncate, or hint at the
  value. "First 4 chars are `sk-l`" is a leak.
- **One placeholder per distinct sensitive datum.** A reader can then see *how
  many* things were present and of what classes, which is itself signal. A log
  line carrying both an IP address and an email is worse than one carrying neither.
- **Apply it uniformly:** in evidence, in the finding's Scenario and Impact, in
  the Disconfirmation note, in any quoted log or stack trace, in commit messages,
  and in anything you say in chat. The `explorer` subagent operates under exactly
  this rule: *"Never emit real identifiers, IPs, or user data. Redact to
  `<REDACTED:reason>` and report patterns, not values."*

## Before and after: a finding's evidence line

The discipline is easiest to see on a real-shaped evidence line. Suppose an
audit such as `metadata-leak-audit` finds a log statement that prints the client
IP address and a bearer token on an error path.

**Before, unsafe. Never write this.**

```markdown
- **Evidence:** error handler logs the full request context at
  `src/server/error.ts:73`:
  `logger.error("auth failed", { ip: "203.0.113.47",
   authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiO…" })`
```

That evidence line *is the leak now*. It copies a real IP address and a live token into
the register, which then gets committed and pushed. The finding meant to *fix* a leak
just created a worse one.

**After, redacted. This is the standard.**

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
> [reading-a-findings-register.md](reading-a-findings-register.md), where `SEC-042`'s
> evidence ends "Secret/PII in the trace redacted to `<REDACTED:pii>`." The
> finding stays fully actionable with the value gone.

## The Anchor on a secret-bearing line

Every finding also carries an **Anchor**, a verbatim substring copied from the cited line
so `revalidate-register.mjs` can detect a drifted citation. A secret-bearing line makes
that requirement dangerous, so the schema carves out a rule for it.

On a secret-bearing line the Anchor must be a non-secret substring: the variable name or
the keyword, never any part of the value. When no safe substring exists, use
`Anchor: <REDACTED-LINE>`, which the checker treats as a line-existence check only. The
atlas stamper follows the same rule and writes the same sentinel for a credential-shaped
line, so an atlas claim never carries a secret either.

## The special case: a live secret

A real, currently valid credential found in the tree is not an ordinary finding. Examples
are a hardcoded API key, a committed `.env`, a private key, or a token in git history.
Under `CONVENTIONS.md` §4 and §7 it is **`critical`**, the same rank as a real
deanonymization, and it has its own reporting shape.

**Report three things, and only these three:**

1. **Location:** `file:line`. If the secret is in history, add the commit and the fact
   that it persists in history even after deletion from `HEAD`.
2. **Class:** what kind of secret, given through the redaction reason
   (`<REDACTED:api-key>`, `<REDACTED:private-key>`), so severity and blast radius stay
   legible.
3. **Rotation steps:** the credential is burned the moment it was committed, so the fix
   is always rotate, then purge, then prevent, never merely "delete the line":
   - **Rotate or revoke** the credential at its source, which is the provider console,
     the CA, or the secrets manager, so the exposed value is dead.
   - **Purge** it from history if it was ever committed, through a history rewrite or the
     provider's secret-scanning remediation. Deletion from `HEAD` alone leaves it in every
     clone.
   - **Prevent recurrence.** Move the secret to a manager or to env injection, add a
     pre-commit secret scanner, and pin a regression guard through the hardening loop.

**Never report:** the value, any prefix or suffix of it, or a reversible
transformation of it.

A redacted critical-secret finding reads like this, fully actionable and with zero
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

The fix is **always-gated** (`CONVENTIONS.md` §4). Secret handling never
auto-applies and never auto-merges, whatever the automation level.

## The mechanical floor over your own artifacts

Habit is not the last line of defense. `CONVENTIONS.md` §4 names a fail-closed check over
the run's own output artifacts, which are the registers, reports, summaries, and handoffs:

```bash
node scripts/scan-redaction.mjs <artifacts>
```

A hit means the deliverable itself leaks. Clean it before it ships. Inside an installed
plugin the same script is at `${CLAUDE_PLUGIN_ROOT}/scripts/scan-redaction.mjs`.

The scanner covers artifacts, not every file a run touches. Three local stores now hold
raw text that never reaches a model and never leaves the machine, and each stays out of
the repository by default:

- The output digest writes raw command output under `~/.claude/code-ops/digest/<slug>/`, or
  under `$CODE_OPS_DIGEST_DIR`. Set `CODE_OPS_DIGEST_STORE=off` to keep the compression and
  write nothing.
- The session receipt appends one row per session to
  `~/.claude/code-ops/session-receipts.jsonl`, or to `$CODE_OPS_RECEIPTS`. Set
  `CODE_OPS_RECEIPTS=off` to write nothing.
- `context-audit.mjs` sanitizes its report by default. `--raw` keeps truncated commands and
  paths, so treat a `--raw` report as local-inspection output and never paste it into an
  artifact.

## Redaction, the privacy lens, and the leak-class labels

Redaction is not a separate workflow. It is the safe-handling layer *under* the
normal finding schema (`CONVENTIONS.md` §6). A redacted finding still carries two labels:

- a **Lens** (`§9`), most often **Secrets & supply-chain trust** for a live
  credential, **Metadata minimization** for PII and identifiers in logs, telemetry, or
  errors, or **Identification & fingerprinting** for a re-identifying value
- a **Leak-class** label (`§6`), one of
  `linkability | observability | identification | metadata | egress | secret | correlation`

So redaction does not erase the finding's routing. A `secret`-class critical
still ranks at the top under `§7`, which ranks by severity times exploitability. A
`metadata`-class identifier in logs still routes by track. The placeholder governs only
*how the value is represented*. The lens and the leak-class govern *what the finding means
and where it goes*. The two are orthogonal by design, so you never have to choose between
reporting it usefully and reporting it safely.

One scope reminder from `CONVENTIONS.md` §0: this suite does **defensive** work. You are
finding and neutralizing leaks in *your own* system. Redaction discipline applies
to *your users' and your system's* secrets and identifiers. You are never
collecting, reproducing, or deanonymizing a third party.

## A short checklist

Run this before any finding, evidence line, register write, commit, or message
leaves your hands:

- [ ] Does any line contain a real secret, key, token, password, IP address, email,
      username, account ID, device ID, onion address, or other identifier?
- [ ] If yes, is each replaced by `<REDACTED:reason>` with the reason naming the
      *class*, not the value (no prefix, hash, or hint)?
- [ ] Does the evidence still prove the finding from **pattern + `file:line`**
      alone, without the value?
- [ ] Is the Anchor a non-secret substring, or the `<REDACTED-LINE>` sentinel?
- [ ] Is a *live* secret marked **`critical`**, leak-class **`secret`**, with
      **location + rotation steps** and **no value**?
- [ ] Is the secret-handling fix routed as **always-gated** (the developer confirms, and
      it is never auto-merged)?
- [ ] Did `node scripts/scan-redaction.mjs` pass over every artifact you are about to ship?
- [ ] Did you avoid "investigating" by adding PII logging or echoing the value
      into output (`leak-incident-response` Phase 0: do not make it worse)?

If every box is checked, the value never entered the pipeline, and the finding is
still fully actionable.

## See also

- [Privacy & OpSec primer](../Handbook/06-privacy-opsec-primer.md): the privacy
  lens, the leak-class labels, and the anonymity and OpSec model this discipline
  serves.
- [Respond to a suspected leak](../../70 Guides/respond-to-a-suspected-leak.md):
  the end-to-end guide for when the radioactive thing is already loose
  (`leak-incident-response` runs triage, contain, scope, and plan, without making it
  worse).
- [Reading and acting on a findings register](reading-a-findings-register.md):
  the finding schema and how the redacted **Evidence** field is meant to read.
- [Evidence and tiers](../Handbook/05-evidence-and-tiers.md): what `critical`
  and `CONFIRMED` require, which a live-secret finding always is.
- [Shell discipline](shell-discipline.md): staging by explicit path, so a local store
  never reaches a commit.

*Verified-at: b0ffede*
