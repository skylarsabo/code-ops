// Shared by compact-snapshot.mjs (PreCompact) and session-receipt.mjs (SessionEnd), so both hooks
// start the recall prebuild the same way. Not a hook: hooks.json registers no command for it. Every
// host render that ships those two hooks copies the whole hooks/ tree, so this sibling import holds.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Prebuilds the transcript recall index (`transcript-recall.mjs build`) in a detached child, so
// a later `co recall` call finds it current. The hook never waits for the child and a spawn failure
// changes nothing it does: a build that never ran is caught up by the first recall call. The child
// runs in the payload's `cwd`, because the index directory keys on it. `CODE_OPS_RECALL` of `off`,
// `0`, or `false` skips the spawn, and so does a payload without a session id and a transcript.
export function spawnRecallBuild(sessionId, transcriptPath, cwd) {
  try {
    if (/^(off|0|false)$/i.test(process.env.CODE_OPS_RECALL ?? '') || !sessionId || !transcriptPath) return;
    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'transcript-recall.mjs');
    if (!existsSync(script)) return;
    const child = spawn(process.execPath, [script, 'build', '--session', sessionId, '--transcript', transcriptPath], {
      cwd: existsSync(cwd) ? cwd : undefined, detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
  } catch { /* the lazy build on the first recall call covers it */ }
}
