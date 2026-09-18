#!/usr/bin/env node
// SessionStart hook: prints a hard-capped routing card so the lead defaults into
// standard operating mode from the first turn. After compaction it adds a short restore
// instruction; unlike PreCompact stdout, SessionStart context is consumed by Claude/Codex.
//
// Grok passive-hook stdout is ignored, so its instruction files carry this doctrine and this
// hook emits nothing there. Fail-open: any error exits 0 silently.
//
//   node hooks/routing-card.mjs

import { readFileSync } from 'node:fs';

function main() {
  if (process.env.GROK_PLUGIN_ROOT) return 0;
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '') || '{}'); } catch { /* ordinary start */ }
  const lines = [
    'code-ops standard operating mode',
    'debug a bug -> code-ops-suite:debug',
    'ship a feature/change -> code-ops-suite:ship',
    'audit/quality sweep -> code-ops-suite:full-sweep or rigor:rigor-sweep',
  'privacy/leak concern -> privacy-opsec-suite:full-sweep',
    'library/dependency decision -> researcher:library-eval',
    'claim verification -> researcher:research-verify',
    'everything (broad/multi-domain) -> code-ops-suite:everything',
    'substantive work -> frontier orchestrator plus strong operatives; delegate every independently briefable unit and launch at least two disjoint units in parallel when possible',
    'the root continuously synthesizes, challenges assumptions, reprioritizes, and redirects; inline busy work requires a stated trivial-or-indivisible exception',
    'a dispatch costs context times turns: use the narrowest shipped agent (code-ops-suite:implementer for build work, never general-purpose), name a round budget in the brief, keep breadth agents at their declared tier, and batch independent tool calls',
    'premium frontier peers only for the hardest bounded architecture, refutation, or synthesis; verdicts and acceptance stay with the lead',
    'say in a line what you are about to do, give brief updates while you work, and close with a recap that stands on its own',
    'only you see a command\'s output; put what the user needs to read in your reply',
    'context economy: skim before reading, query the symbol index before a map, digest output is on by default, size is a tie-breaker behind correctness, boundaries, performance, and readability',
    'see: in the code-ops repository, https://github.com/skylarsabo/code-ops/blob/main/code-ops-docs/40%20Engineering/Handbook/11-standard-operating-mode.md and https://github.com/skylarsabo/code-ops/blob/main/code-ops-docs/40%20Engineering/Techniques/dispatch-brief-template.md',
  ];
  if (payload?.source === 'compact') {
    lines.push('compaction resume: restore decisions, constraints, completed and open work, exact identifiers, and named durable artifacts before continuing; never restore redacted values');
  }
  console.log(lines.join('\n'));
  return 0;
}

try {
  process.exit(main());
} catch {
  process.exit(0);
}
