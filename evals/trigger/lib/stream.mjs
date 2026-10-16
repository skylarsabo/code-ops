// stream-json trigger detection. A "trigger" is the first Skill tool_use in an assistant message.

/** Parse one stream line. Returns the object, or null for blank or malformed lines. */
export function parseLine(line) {
  const s = String(line).trim();
  if (!s || s[0] !== '{') return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch { return null; }
}

/** The skill id of the first Skill tool_use inside one stream event, or null. */
export function skillFromEvent(ev) {
  if (!ev || ev.type !== 'assistant' || !Array.isArray(ev.message?.content)) return null;
  for (const block of ev.message.content) {
    if (block?.type === 'tool_use' && block.name === 'Skill') {
      const id = block.input?.skill ?? block.input?.command;
      if (typeof id === 'string' && id.trim()) return id.trim().replace(/^\//, '');
    }
  }
  return null;
}

/**
 * Incremental detector. feed(line) returns true once the first Skill is seen, which is the
 * caller's cue to kill the process. Cost comes from the result event when present.
 */
export function createDetector() {
  const state = { skill: null, toolsBefore: [], costUsd: null, error: null, malformed: 0, done: false };
  return {
    state,
    feed(line) {
      if (state.done) return true;
      if (String(line).trim() === '') return false;
      const ev = parseLine(line);
      if (!ev) { state.malformed += 1; return false; }
      if (ev.type === 'result') {
        if (typeof ev.total_cost_usd === 'number') state.costUsd = ev.total_cost_usd;
        if (ev.is_error === true) state.error = String(ev.result ?? ev.subtype ?? 'error').slice(0, 300);
      }
      if (ev.type !== 'assistant' || !Array.isArray(ev.message?.content)) return false;
      for (const b of ev.message.content) {
        if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
        const skill = b.name === 'Skill' ? skillFromEvent({ type: 'assistant', message: { content: [b] } }) : null;
        if (skill) { state.skill = skill; state.done = true; return true; }
        if (b.name !== 'Skill') state.toolsBefore.push(b.name);
      }
      return false;
    },
  };
}

/** Detect over a whole transcript text (used by the fixtures eval). */
export function detectTranscript(text) {
  const d = createDetector();
  for (const line of String(text).split(/\r?\n/)) if (d.feed(line)) break;
  return { ...d.state };
}
