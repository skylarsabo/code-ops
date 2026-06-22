// Telemetry + egress client. Some real anonymity leaks, some intentional safe patterns.
import { fetch, torAgent, logger, redact, stableDeviceId, requestUuid } from './deps.js';

export function trackRaw(event, user, req) {
  // logs raw identifiers
  logger.info('event', { type: event, email: user.email, ip: req.ip });
}

export function trackSafe(event, user) {
  // identifiers redacted before logging
  logger.info('event', { type: event, user: redact(user.email) });
}

export async function sendFailOpen(url, body) {
  try {
    return await fetch(url, { agent: torAgent });
  } catch (e) {
    return await fetch(url, { body });
  }
}

export function pingProxy(url) {
  // always routed through the Tor agent; no fallback
  return fetch(url, { agent: torAgent });
}

export function setClientCookie(res) {
  res.setCookie('cid', stableDeviceId(), { maxAge: 31536000 });
}

export function tagRequest(res) {
  res.setHeader('X-Request-Id', requestUuid());
}
