# leak-lab — answer key

A tiny telemetry/egress client (`repo/`) with **3 real anonymity leaks** and **3 decoys** (safe patterns that look like leaks). Measures the privacy audits — `privacy-opsec-suite:tor-egress-audit`, `metadata-leak-audit`, `anon-session-audit` (or `full-sweep`) — on recall and false-positive rate.

Keep this file out of any context you give the skill.

## Planted leaks (should be found)
| ID | Location | Leak-class | What leaks |
|----|----------|-----------|------------|
| LEAK-1 | `src/client.js:6` | metadata | raw `email` + `ip` written to a log line. |
| LEAK-2 | `src/client.js:18` | egress | clearnet `fetch` fallback in `catch` bypasses the Tor agent (fail-open). |
| LEAK-3 | `src/client.js:28` | linkability | persistent 1-year `cid` cookie set from a stable device id. |

## Decoys (should NOT be flagged)
| ID | Location | Why it's fine |
|----|----------|---------------|
| DEC-1 | `src/client.js:11` | the email is `redact(...)`-ed before logging. |
| DEC-2 | `src/client.js:24` | always routed through `torAgent`, no fallback — correct fail-closed egress. |
| DEC-3 | `src/client.js:32` | `X-Request-Id` is a per-request correlation id, not a persistent/identifying value. |

Flagging DEC-2 (a correctly-proxied call) or DEC-1 (a redacted log) is the classic privacy false positive this suite is meant to avoid.
