---
name: tor-egress-audit
description: "Use when you need to prove no traffic escapes the proxy or Tor. Owns network egress and routing."
---

# Tor and egress audit: no traffic leaks the user

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `privacy-opsec-suite:tor-egress-audit`.** First read the bundled
`<plugin-root>/CONVENTIONS.md`. Search the plugin directory for it if the path does
not resolve. It defines the operating model, the central anonymity and OpSec model (`§A`),
the interaction protocol, the safety rails, the schemas, and the lenses this skill
references by section.

- **Mode:** AUDIT.
- **Produces:** an egress map and findings in `LEAK_REGISTER.md`, plus a summary.
- **Escalation:** surface any clearnet or DNS leak as critical.

## Phase 0: enumerate every egress path  *(checkpoint)*

Dispatch the explorer subagent to list all outbound network behavior: HTTP clients, raw
sockets, DNS, telemetry and analytics, third-party SDKs, CDNs, and fonts, webhooks, and
update and connectivity checks. For each one, record the intended routing, meaning what must
go over Tor, SOCKS, or the proxy, and what is intentionally direct.

> **CHECKPOINT:** present the egress map and the intended routing. Confirm the scope and the
> routing policy.

## Phase 1: verify that the routing actually holds

- **Proxy enforcement.** Does the traffic that must be anonymized actually traverse the
  SOCKS or Tor proxy? Find any client or library that bypasses it through a direct connect,
  a hardcoded host or IP address, a library that ignores proxy settings, a background task,
  or native code.
- **Fail-closed behavior.** On a proxy or circuit failure, does the system stop, or does it
  fall back to clearnet or a direct path? It must fail closed. Check the error and retry
  paths specifically.
- **DNS leaks.** Are lookups resolved through the proxy, for example over SOCKS5h or remote
  DNS, and never through the system resolver? Hunt for direct `getaddrinfo` and
  local-resolver calls.
- **Stream and connection isolation.** Are unrelated activities or identities on separate
  circuits, through per-action SOCKS authentication isolation, so an exit node or an observer
  cannot correlate them?
- **Onion services, when one is served.** Check the version 3 onion configuration. The
  server's real IP address must never be bound or leaked, so it listens on localhost, has no
  stray clearnet listener, and puts no IP address in a header, a log, or an error page.
  There must be no mixed clearnet and onion resources, such as absolute clearnet URLs,
  third-party assets, or redirects, because they break anonymity. Check descriptor and host
  hygiene, and confirm that `Server`, `Date`, and the error pages leak nothing.
- **Leak vectors.** Check WebRTC and STUN for the real IP address, an IPv6 leak when the
  proxy is IPv4-only, NTP and other time sources, captive-portal and connectivity checks,
  link prefetch and preconnect, `Referer`, redirect chains to clearnet, and operating-system
  telemetry.
- **Header and TLS uniformity.** Check for a consistent `User-Agent` and `Accept-*` set, and
  check SNI, ECH, and the TLS fingerprint.

Keep tiers honest at the point of use. A leak you did not reproduce or directly observe is
PROBABLE at most, never CONFIRMED (`§6`). When you are unsure between two tiers, pick the
lower one.

## Deliverables

An egress map classifying every path as anonymized, intentionally clear, or a leak. Findings
on the `§6` schema, with leak-class `egress` or `observability`, written into
`LEAK_REGISTER.md`. A summary led by any clearnet, DNS, or WebRTC leak.

## Done when

Every egress path is classified. Fail-closed behavior is verified on all failure paths.
DNS-through-proxy resolution and stream isolation are verified, and onion-service hygiene is
checked where it applies. Every leak carries a concrete remediation.
