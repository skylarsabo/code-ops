#!/usr/bin/env node
// SessionStart hook: prints a hard-capped routing card so the lead defaults into
// standard operating mode (delegate, don't do it inline) from the first turn.
//
// No stdin parsing needed (SessionStart may pass a JSON payload, but this hook
// ignores it); it only ever prints the fixed card below. Fail-open: any error
// here exits 0 silently rather than surfacing noise at session start.
//
//   node hooks/routing-card.mjs

function main() {
  const lines = [
    'code-ops standard operating mode',
    'debug a bug -> /code-ops-suite:debug',
    'ship a feature/change -> /code-ops-suite:ship',
    'audit/quality sweep -> /code-ops-suite:full-sweep or /rigor:rigor-sweep',
    'privacy/leak concern -> /privacy-opsec-suite skills',
    'library/dependency decision -> /researcher:library-eval',
    'claim verification -> /researcher:research-verify',
    'everything (broad/multi-domain) -> /code-ops-suite:everything',
    'operatives at the strong tier for judgment work; effort by ambiguity; verdicts stay with the lead',
    'see: docs/handbook/11-standard-operating-mode.md and docs/techniques/dispatch-brief-template.md',
  ];
  console.log(lines.join('\n'));
  return 0;
}

try {
  process.exit(main());
} catch {
  process.exit(0);
}
