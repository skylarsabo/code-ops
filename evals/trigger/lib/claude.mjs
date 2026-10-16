// Spawn one `claude -p` session for one query and stop at the first Skill tool_use.
import { spawn, spawnSync } from 'node:child_process';
import { buildSpawn, sessionEnv } from './env.mjs';
import { createDetector } from './stream.mjs';

/** The claude argument list. The query is not in it; it goes on stdin. */
export function claudeArgs({ pluginDirs, budgetUsd, settingSources, model }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', String(budgetUsd),
    '--no-session-persistence', '--disallowedTools', 'Bash,Edit,Write,NotebookEdit'];
  if (settingSources) args.push('--setting-sources', settingSources);
  if (model) args.push('--model', model);
  for (const d of pluginDirs) args.push('--plugin-dir', d);
  return args;
}

function kill(child, shim) {
  if (shim && process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true });
  else child.kill();
}

/**
 * Run one query. Resolves { skill, costUsd, toolsBefore, error, capped, killed, exitCode }.
 * Early stop: the process is killed when the first Skill tool_use arrives, so costUsd is null
 * for a triggered run (the result event never arrives).
 */
export function runQuery(bin, query, opts) {
  const { command, args, shim } = buildSpawn(bin, claudeArgs(opts));
  return new Promise((resolve) => {
    const det = createDetector();
    let killed = false;
    let buf = '';
    let stderr = '';
    const child = spawn(command, args, { cwd: opts.cwd, env: sessionEnv(process.env, opts.routingCard ?? 'off'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stop = () => { killed = true; kill(child, shim); };
    const timer = setTimeout(() => { det.state.error ??= 'timeout'; stop(); }, opts.timeoutMs ?? 240000);
    child.stdin.on('error', () => {});
    child.stdin.end(query);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!killed && det.feed(line)) stop();
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-500); });
    child.on('error', (e) => { det.state.error ??= `spawn failed: ${e.message}`; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!killed && buf.trim()) det.feed(buf);
      const s = det.state;
      if (!s.skill && !s.error && code !== 0) s.error = `exit ${code}: ${stderr.trim().slice(-200)}`;
      resolve({ skill: s.skill, costUsd: s.costUsd, toolsBefore: s.toolsBefore, error: s.error, capped: s.capped, killed, exitCode: code });
    });
  });
}
