// Child environment and claude binary resolution.
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// Session variables that make a child claude think it is nested. Matched case-insensitively
// because win32 env keys are case-insensitive; CLAUDECODE has no underscore, so it is matched bare.
const SESSION = /^(claudecode|claude_code_.*|claude_agent_sdk_.*|claude_plugin_.*)$/i;
// Auth and provider selection that must survive the scrub.
const KEEP = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']);

/** A copy of env without session variables. Auth variables stay (compared case-insensitively). */
export function scrubEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (SESSION.test(k) && !KEEP.has(k.toUpperCase())) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The session environment: scrubbed, with the routing card set explicitly. Off (the default) keeps
 * the card from steering a query; on measures the routing path that real sessions use.
 */
export function sessionEnv(env, routingCard = 'off') {
  return { ...scrubEnv(env), CODE_OPS_ROUTING_CARD: routingCard };
}

/** First existing claude executable on PATH, or null. On win32 prefer .exe over .cmd shims. */
export function resolveClaude(env = process.env, platform = process.platform, exists = existsSync) {
  const pathVar = Object.entries(env).find(([k]) => k.toLowerCase() === 'path')?.[1] ?? '';
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const dir of pathVar.split(delimiter).filter(Boolean))
    for (const name of names) {
      const p = join(dir, name);
      if (exists(p)) return p;
    }
  return null;
}

/** True for a win32 batch shim, which needs cmd.exe to run. */
export const isShim = (bin) => /\.(cmd|bat)$/i.test(bin);

const SAFE_ARG = /^[A-Za-z0-9_.:\\/-]+$/;

/**
 * The spawn command for claude. The query is never an argument (it goes on stdin), so every
 * argument is a flag or a repo path. A shim route re-checks each argument against a strict
 * allow-list (no spaces, no shell metacharacters) and refuses anything else, so cmd.exe never
 * sees text it could interpret.
 */
export function buildSpawn(bin, args) {
  if (!isShim(bin)) return { command: bin, args, shim: false };
  for (const a of [bin, ...args]) if (!SAFE_ARG.test(a)) throw new Error(`refusing unsafe argument for cmd.exe shim: ${JSON.stringify(a)}`);
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', bin, ...args], shim: true };
}
