#!/usr/bin/env node
// Deterministic secrets/PII scanner — the mechanical floor under redaction hygiene.
//
// WHY: an audit deliverable (a register, a handoff, a report) that quotes the evidence it
// found can itself become the leak; scanning the suite's own output artifacts before they're
// shared catches that mechanically instead of relying on the author noticing on re-read.
//
//   node scripts/scan-redaction.mjs <file> [...more] [--report-only]
//
// Scans the suite's own OUTPUT artifacts (registers, reports, handoffs) so an audit
// deliverable can't itself become the leak. Two tiers, by confidence:
//
//   FAIL-CLOSED (high-precision secret shapes — a hit is almost never a false alarm):
//     AWSKEY    AKIA/ASIA + 16 uppercase alnum      (e.g. AKIAIOSFODNN7EXAMPLE)
//     GHTOKEN   ghp_/gho_/ghs_/ghu_/github_pat_ ... (e.g. ghp_EXAMPLE0000000000000000000000000000)
//     PEM       -----BEGIN ... PRIVATE KEY-----     (e.g. -----BEGIN EXAMPLE PRIVATE KEY-----)
//     JWT       eyJ<b64url>.eyJ<b64url>.<sig>        (e.g. eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJFWEFNUExFIn0.SIGNATURE_EXAMPLE)
//     BEARER    Bearer + 20+ token chars            (e.g. Bearer EXAMPLE0TOKEN0000000000000000)
//     KVSECRET  password|secret|token|api_key = "8+ char literal"  (e.g. password = "EXAMPLE_ONLY_00")
//
//   WARN-ONLY (report, never fail — lower-precision, human triages):
//     HIENTROPY 40+ char base64-ish blob outside a Verified-at/sha context
//     EMAIL     real-shaped emails (example.com/.org/.net are doc placeholders, skipped)
//     BAREIP    IPv4 outside the RFC-5737 documentation ranges
//
// Allowlisted (never flagged): <REDACTED:...> / <REDACTED-LINE> placeholders; the RFC-5737
// (192.0.2.x / 198.51.100.x / 203.0.113.x) and RFC-3849 (2001:db8::) documentation ranges;
// example.com/.org/.net emails; hex on a line carrying `Verified-at` or `sha`; and this
// script's own literal category examples above (so a doc quoting them stays quiet).
//
// Exit: a single tallied verdict, fail-closed wins over hits. 2 = a missing target file or a
// usage error (no target, unknown flag) — reported even when secret hits were also found,
// never silently downgraded to 1. Otherwise 1 = any FAIL-CLOSED secret shape found (unless
// --report-only), 0 = clean. WARN-ONLY hits are always reported but never change the exit code.

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';

const argv = process.argv.slice(2);
let reportOnly = false;
const files = [];
for (const a of argv) {
  if (a === '--report-only') { reportOnly = true; continue; }
  // An unrecognized --flag must not fall through to "treat it as a file" — a typo'd flag would
  // otherwise silently scan nothing relevant and report clean.
  if (a.startsWith('--')) { console.error(`x unknown argument: ${a}`); process.exit(2); }
  files.push(a);
}

// The exact example literals embedded in this file's own header. A scanned artifact that
// reproduces one verbatim (a guide documenting this scanner) is quoting, not leaking.
const SELF_EXAMPLES = new Set([
  'AKIAIOSFODNN7EXAMPLE',
  'ghp_EXAMPLE0000000000000000000000000000',
  '-----BEGIN EXAMPLE PRIVATE KEY-----',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJFWEFNUExFIn0.SIGNATURE_EXAMPLE',
  'Bearer EXAMPLE0TOKEN0000000000000000',
  'password = "EXAMPLE_ONLY_00"',
  'EXAMPLE_ONLY_00',
]);

// <REDACTED:reason> and <REDACTED-LINE> are the suite's own scrub placeholders — the whole
// point of a redacted artifact — so a quoted literal that IS one is never a secret.
const REDACTED_RE = /<REDACTED(?::[^>]*)?>|<REDACTED-LINE>/;

const FAIL_CLOSED = new Set(['AWSKEY', 'GHTOKEN', 'PEM', 'JWT', 'BEARER', 'KVSECRET']);

// High-precision secret shapes. `lit` names the capture group holding the sensitive literal
// (KVSECRET quotes it); absent means the whole match is the secret.
const SECRET_CHECKS = [
  { cat: 'AWSKEY', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { cat: 'GHTOKEN', re: /\b(?:gh[posu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { cat: 'PEM', re: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g },
  { cat: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { cat: 'BEARER', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g },
  { cat: 'KVSECRET', re: /\b(?:password|passwd|secret|token|api[_-]?key)\b\s*[:=]\s*(["'])([^"']{8,})\1/gi, lit: 2 },
];

// RFC-5737 documentation IPv4 prefixes — safe to print in an example, never a real leak.
const DOC_IP = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];
const HIENTROPY_RE = /[A-Za-z0-9+/]{40,}/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const DOC_EMAIL_RE = /@(?:[a-z0-9-]+\.)*example\.(?:com|org|net)$/i;
// A line carrying a Verified-at citation or a sha label is a hash context, not a secret one.
const HASH_CONTEXT = /verified-at|\bsha\b|sha\d{3}|sha-\d/i;

// A redaction scanner must not itself print the secret it flags — show the shape, not the value.
const mask = (s) => (s.length <= 4 ? '****' : `${s.slice(0, 4)}...[${s.length}]`);
const snippetFor = (line, value) => line.replace(value, mask(value)).trim().slice(0, 70);

function isAllowed(full, value) {
  if (REDACTED_RE.test(value)) return true;
  if (SELF_EXAMPLES.has(full.trim()) || SELF_EXAMPLES.has(value.trim())) return true;
  return false;
}

function scanText(text) {
  const hits = [];
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    const at = i + 1;

    // --- fail-closed secret shapes ---
    for (const c of SECRET_CHECKS) {
      c.re.lastIndex = 0;
      for (const m of line.matchAll(c.re)) {
        const value = c.lit ? m[c.lit] : m[0];
        if (isAllowed(m[0], value)) continue;
        hits.push({ cat: c.cat, line: at, snippet: snippetFor(line, value) });
        break; // one hit per category per line — mirrors scan-ai-tells's per-check contract
      }
    }

    // --- warn-only, context-sensitive ---
    if (!HASH_CONTEXT.test(line)) {
      HIENTROPY_RE.lastIndex = 0;
      for (const m of line.matchAll(HIENTROPY_RE)) {
        if (isAllowed(m[0], m[0])) continue;
        hits.push({ cat: 'HIENTROPY', line: at, snippet: snippetFor(line, m[0]) });
        break;
      }
    }
    EMAIL_RE.lastIndex = 0;
    for (const m of line.matchAll(EMAIL_RE)) {
      if (DOC_EMAIL_RE.test(m[0]) || isAllowed(m[0], m[0])) continue;
      hits.push({ cat: 'EMAIL', line: at, snippet: snippetFor(line, m[0]) });
      break;
    }
    IPV4_RE.lastIndex = 0;
    for (const m of line.matchAll(IPV4_RE)) {
      if (DOC_IP.some((re) => re.test(m[0])) || isAllowed(m[0], m[0])) continue;
      hits.push({ cat: 'BAREIP', line: at, snippet: snippetFor(line, m[0]) });
      break;
    }
  });
  return hits;
}

// A missing target file is a config/usage error, not a scan result — tracked separately from
// hit counts so it can win at the end even when secret hits were also found (fail-closed wins;
// a masked 2-vs-1 exit would let a broken invocation quietly report as merely "dirty").
let hadError = false;
const targets = [];
for (const f of files) {
  if (!existsSync(f)) { console.error(`x not found: ${f}`); hadError = true; continue; }
  targets.push({ label: basename(f), text: readFileSync(f, 'utf8') });
}
if (targets.length === 0 && !hadError) { console.error('usage: scan-redaction.mjs <file> [...] [--report-only]'); process.exit(2); }

let secretTotal = 0, warnTotal = 0;
for (const t of targets) {
  const hits = scanText(t.text);
  secretTotal += hits.filter((h) => FAIL_CLOSED.has(h.cat)).length;
  warnTotal += hits.filter((h) => !FAIL_CLOSED.has(h.cat)).length;
  console.log(`\n# ${t.label}${hits.length ? '' : '  — clean'}`);
  for (const h of hits) {
    const marker = FAIL_CLOSED.has(h.cat) ? '!!' : '~~';
    console.log(`  ${marker} ${h.cat.padEnd(11)} ${h.line ? 'L' + h.line : '  '}  ${h.snippet}`);
  }
}
console.log(`\n${secretTotal} secret/PII hit(s) + ${warnTotal} warning(s) across ${targets.length} target(s).`);
if (hadError) process.exit(2); // fail-closed wins even when secret hits were also found above
if (secretTotal > 0 && !reportOnly) {
  console.error('Secret/PII shape found in an output artifact — redact it before publishing (fail-closed).');
  process.exit(1);
}
