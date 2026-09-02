#!/usr/bin/env node
// PreCompact hook: hands the host one instruction for what a compaction summary must keep,
// so a compacted session resumes without redoing work or losing a stated constraint.
//
// WHY: a client-side summary that drops a decision, a constraint, or an exact identifier
// costs a full re-derivation later. The six items below are the ones a resumed session
// cannot reconstruct from the tree alone. The text is emitted as `additionalContext` and
// reaches only the compaction step, never an ordinary turn, so it adds no per-turn tokens.
//
// No stdin parsing; the payload (compaction_trigger, transcript_path) is irrelevant to the
// instruction. Fail-open: any error exits 0 with no output.

const INSTRUCTION = [
  'Compaction summary: the next context continues this work without redoing it or being told the constraints again. Preserve, in this order:',
  '(1) every problem met and how each was handled or resolved;',
  '(2) every option raised, tried, or set aside, and why;',
  '(3) everything asked for, decided, agreed, ruled out, or established as a preference, constraint, or boundary, in the words used;',
  '(4) exactly where things stand now: what is covered, settled, or complete;',
  '(5) everything still open, unresolved, promised, or expected next;',
  '(6) names, numbers, dates, paths, commit ids, register ids, links, and exact wording that would be hard to reconstruct.',
  "Keep what the developer said, asked for, or established close to their own words. Condense the assistant's own reasoning to its conclusions and outputs. Be complete on the six items even at the cost of length, and concise on everything else.",
  'Run artifacts on disk (registers, ledgers, receipts, HANDOFF.md) remain the authority; name their paths rather than restating their contents.',
].join('\n');

try {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreCompact', additionalContext: INSTRUCTION },
  }));
  process.exit(0);
} catch {
  process.exit(0);
}
