---
description: "Use when you need to prove no traffic escapes the proxy/Tor; checks proxy enforcement, fail-closed, DNS/WebRTC/IPv6 leaks, stream isolation, onion-service hygiene. Owns network egress + routing."
disable-model-invocation: true
---

# TOR / EGRESS AUDIT — No Traffic Leaks the User

**Invoked as `/privacy-opsec-suite:tor-egress-audit`.** First read the bundled `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` (search the plugin directory for it if needed) — it defines the operating model, the central **anonymity & OpSec model** (§A), the interaction protocol, safety rails, schemas, and lenses this skill references by section.
**Mode:** AUDIT · **Produces:** an egress map + findings → `LEAK_REGISTER.md`; summary. Surface any clearnet/DNS leak as **critical**.

## Phase 0 — Enumerate every egress path  *(checkpoint)*
List **all** outbound network behavior: HTTP clients, raw sockets, DNS, telemetry/analytics, third-party SDKs/CDNs/fonts, webhooks, update/connectivity checks. For each, record the **intended** routing — which must go over Tor/SOCKS/proxy and which is intentionally direct.
> **CHECKPOINT:** present the egress map and intended routing; confirm scope and the routing policy.

## Phase 1 — Verify the routing actually holds
- **Proxy enforcement:** does traffic that must be anonymized actually traverse the SOCKS/Tor proxy? Find any client/library that bypasses it — direct connects, hardcoded hosts/IPs, libraries that ignore proxy settings, background tasks, or native code.
- **Fail-closed:** on proxy/circuit failure, does it **stop**, or fall back to clearnet / a direct path? It must fail closed. Check error and retry paths specifically.
- **DNS leaks:** are lookups resolved *through* the proxy (e.g. SOCKS5h / remote DNS), never via the system resolver? Hunt direct `getaddrinfo`/local-resolver calls.
- **Stream / connection isolation:** are unrelated activities or identities on separate circuits (per-action SOCKS auth isolation) so an exit/observer can't correlate them?
- **Onion services (if served):** v3 onion config; the server's real IP is never bound or leaked (listen on localhost, no stray clearnet listener, no IP in headers/logs/error pages); **no mixed clearnet+onion resources** (absolute clearnet URLs, third-party assets, redirects) that break anonymity; descriptor/host hygiene; `Server`/`Date`/error pages don't leak.
- **Leak vectors:** WebRTC/STUN (real IP), IPv6 leak when the proxy is IPv4-only, NTP/time sources, captive-portal/connectivity checks, link prefetch/preconnect, `Referer`, redirect chains to clearnet, OS-level telemetry.
- **Header/TLS uniformity:** consistent `User-Agent`/`Accept-*`; SNI/ECH; TLS fingerprint.

## Deliverables
An **egress map** classifying every path as *anonymized / intentionally-clear / leak*; findings (schema `§6`, leak-class `egress`/`observability`) → `LEAK_REGISTER.md`; a summary led by any clearnet/DNS/WebRTC leak.

Tier honesty at point of use: a leak you did not reproduce or directly observe is PROBABLE at most — never CONFIRMED (`§6`); when unsure between tiers, pick the lower.

## Done when
Every egress path is classified; **fail-closed** verified on all failure paths; DNS-through-proxy and stream isolation verified; onion-service hygiene checked (if applicable); leaks have concrete remediation.
