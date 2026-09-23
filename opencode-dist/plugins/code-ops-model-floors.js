// OpenCode runtime adapters, generated from the canonical code-ops contracts.
//
// The plugin API exposes chat.params after the host resolves an agent and model but before
// the request reaches the provider. Throwing here blocks a known below-floor or unclassified
// binding. Unknown models fail closed: accepting them would turn a declared floor into prose.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = {
  "code-ops-suite-explorer": "light",
  "code-ops-suite-implementer": "strong",
  "code-ops-suite-reviewer": "strong",
  "privacy-opsec-suite-explorer": "light",
  "privacy-opsec-suite-privacy-reviewer": "strong",
  "rigor-tracer": "strong",
  "rigor-verifier": "strong",
  "researcher-claim-checker": "mid",
  "researcher-gatherer": "light"
};
const RANK = {
  "light": 0,
  "mid": 1,
  "strong": 2,
  "frontier": 3
};
const KNOWN_MODELS = {
  "anthropic": {
    "claude-haiku-4-5-20251001": "light",
    "claude-sonnet-5": "mid",
    "claude-opus-5-5": "strong",
    "claude-fable-5-1": "frontier"
  },
  "xai": {
    "grok-4.7": "frontier",
    "grok-build-0.1": "light"
  },
  "openai": {
    "gpt-6-luna": "light",
    "gpt-5.1": "mid",
    "gpt-5.6-terra": "strong",
    "gpt-6-sol": "frontier",
    "gpt-6-astra": "frontier"
  },
  "google": {
    "gemini-3.1-flash-lite": "light",
    "gemini-3.6-flash": "mid",
    "gemini-3.1-pro-preview": "frontier"
  },
  "zai": {
    "glm-5": "light",
    "glm-5.1": "mid",
    "glm-5.2": "frontier"
  },
  "moonshotai": {
    "kimi-k2.6": "light",
    "kimi-k2.7-code": "mid",
    "kimi-k3": "frontier"
  },
  "deepseek": {
    "deepseek-v4-flash": "mid",
    "deepseek-v4-pro": "frontier"
  },
  "mistral": {
    "magistral-small": "light",
    "mistral-medium-latest": "mid",
    "magistral-medium-latest": "frontier"
  },
  "opencode": {
    "muse-spark-1.3-contributor-free": "strong"
  },
  "github-copilot": {
    "gpt-6-luna": "light",
    "gemini-3.8-flash": "mid",
    "gpt-6-sol": "frontier",
    "claude-opus-5.5": "strong",
    "grok-4.7": "strong",
    "claude-haiku-4.5": "light",
    "mai-code-1.1-flash": "light"
  },
  "accepted": {
    "claude-opus-5": "strong",
    "gpt-5.6-luna": "light",
    "gpt-5.6-sol": "frontier",
    "grok-4.6": "frontier",
    "claude-haiku-4-5": "light",
    "claude-haiku-4.5": "light",
    "claude-opus-5.5": "strong",
    "claude-fable-5.1": "frontier"
  }
};
const TIER_BY_ID = {
  "claude-haiku-4-5-20251001": "light",
  "claude-sonnet-5": "mid",
  "claude-opus-5-5": "strong",
  "claude-fable-5-1": "frontier",
  "grok-4.7": "frontier",
  "gpt-6-luna": "light",
  "gpt-5.1": "mid",
  "gpt-5.6-terra": "strong",
  "gpt-6-sol": "frontier",
  "gemini-3.1-flash-lite": "light",
  "gemini-3.6-flash": "mid",
  "gemini-3.1-pro-preview": "frontier",
  "glm-5": "light",
  "glm-5.1": "mid",
  "glm-5.2": "frontier",
  "kimi-k2.6": "light",
  "kimi-k2.7-code": "mid",
  "kimi-k3": "frontier",
  "deepseek-v4-flash": "mid",
  "deepseek-v4-pro": "frontier",
  "magistral-small": "light",
  "mistral-medium-latest": "mid",
  "magistral-medium-latest": "frontier",
  "muse-spark-1.3-contributor-free": "strong",
  "gemini-3.8-flash": "mid",
  "gpt-6-astra": "frontier",
  "grok-build-0.1": "light",
  "claude-opus-5.5": "strong",
  "claude-haiku-4.5": "light",
  "mai-code-1.1-flash": "light",
  "claude-opus-5": "strong",
  "gpt-5.6-luna": "light",
  "gpt-5.6-sol": "frontier",
  "grok-4.6": "frontier",
  "claude-haiku-4-5": "light",
  "claude-fable-5.1": "frontier"
};
// Read by the lifecycle chooser and the cost report, never by this gate.
const MODEL_PRICES = {
  "github-copilot": {
    "grok-4.7": {
      "input": 2,
      "cached": 0.5,
      "output": 6,
      "longContext": {
        "above": 200000,
        "input": 4,
        "cached": 1,
        "output": 12
      },
      "verifiedAt": "2026-09-23",
      "source": "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing"
    },
    "gpt-6-sol": {
      "input": 2,
      "cached": 0.2,
      "cacheWrite": 2.5,
      "output": 10,
      "longContext": {
        "above": 272000,
        "input": 4,
        "cached": 0.4,
        "cacheWrite": 5,
        "output": 15
      },
      "verifiedAt": "2026-09-23",
      "source": "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing"
    },
    "gpt-6-luna": {
      "input": 0.1,
      "cached": 0.01,
      "cacheWrite": 0.125,
      "output": 0.5,
      "longContext": {
        "above": 272000,
        "input": 0.2,
        "cached": 0.02,
        "cacheWrite": 0.25,
        "output": 0.75
      },
      "verifiedAt": "2026-09-23",
      "source": "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing"
    },
    "gemini-3.8-flash": {
      "input": 0.75,
      "cached": 0.075,
      "output": 3.75,
      "verifiedAt": "2026-09-23",
      "source": "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing"
    },
    "mai-code-1.1-flash": {
      "input": 0.2,
      "cached": 0.02,
      "output": 1.2,
      "verifiedAt": "2026-09-23",
      "source": "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing"
    },
    "claude-haiku-4.5": {
      "input": 1,
      "cached": 0.1,
      "cacheWrite": 1.25,
      "output": 5,
      "verifiedAt": "2026-09-23",
      "source": "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing"
    },
    "claude-opus-5.5": {
      "input": 4,
      "cached": 0.2,
      "cacheWrite": 5,
      "output": 20,
      "verifiedAt": "2026-09-23",
      "source": "https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing"
    }
  }
};
const ROUTING_CARD = "code-ops standard operating mode\ndebug a bug -> /code-ops-suite-debug\nship a feature/change -> /code-ops-suite-ship\naudit/quality sweep -> /code-ops-suite-full-sweep or /rigor-rigor-sweep\nprivacy/leak concern -> /privacy-opsec-suite-full-sweep\nlibrary/dependency decision -> /researcher-library-eval\nclaim verification -> /researcher-research-verify\neverything (broad/multi-domain) -> /code-ops-suite-everything\nsubstantive work -> frontier lead, task-based tiers, disjoint units in parallel when the graph allows; strong is the judgment floor\na dispatch costs context times turns: /code-ops-suite-implementer for build work, a round budget, breadth agents at their declared tier\none frontier peer only for a bounded architecture, refutation, mathematics, or synthesis decision; the lead keeps the verdict\nsay what you are about to do, then close with a recap that stands on its own\nonly you see a command's output; put what the user needs to read in your reply\ncontext economy: read the named convention sections only, skim before a whole file, and query the symbol index before a map";
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));
const SUITE_ROOT = join(PLUGIN_DIR, '..', 'code-ops', 'code-ops-suite');
const DIGEST_HOOK = join(SUITE_ROOT, 'hooks', 'digest-rewrite.mjs');
const QUERY = join(SUITE_ROOT, 'scripts', 'context-query.mjs');
const COMPACTION_CONTEXT = [
  'Compaction summary: the next context continues this work without redoing it or being told the constraints again. Preserve, in this order:',
  '(1) every problem met and how each was handled or resolved;',
  '(2) every option raised, tried, or set aside, and why;',
  '(3) everything asked for, decided, agreed, ruled out, or established as a preference, constraint, or boundary, in the words used;',
  '(4) exactly where things stand now: what is covered, settled, or complete;',
  '(5) everything still open, unresolved, promised, or expected next;',
  '(6) names, numbers, dates, paths, commit ids, register ids, links, and exact wording that would be hard to reconstruct.',
  "Keep what the developer said, asked for, or established close to their own words. Condense the assistant's own reasoning to its conclusions and outputs. Be complete on the six items even at the cost of length, and concise on everything else.",
  'Keep every <REDACTED:reason> marker as it stands and never restore a redacted value.',
  'Run artifacts on disk (registers, ledgers, receipts, HANDOFF.md) remain the authority; name their paths rather than restating their contents.',
].join('\n');

export const CodeOpsModelFloors = async ({ directory = process.cwd() } = {}) => ({
  config: async (config) => {
    config.mcp ??= {};
    config.mcp['code-ops-docs'] ??= { type: 'local', command: ['node', join(SUITE_ROOT, 'scripts', 'lib-docs-mcp.mjs')], enabled: true };
    config.mcp['code-ops-query'] ??= { type: 'local', command: ['node', join(SUITE_ROOT, 'scripts', 'context-query-mcp.mjs')], enabled: true };
  },
  'chat.params': async (input) => {
    // A tier clone (`<agent>-frontier`, `<agent>-lead`) is held to its base agent's floor.
    const agent = String(input?.agent ?? '').replace(/-(light|mid|strong|frontier|lead)$/, '');
    const required = REQUIRED[input?.agent] ?? REQUIRED[agent];
    if (!required) return;
    const provider = input?.model?.providerID;
    const model = input?.model?.id;
    const actual = typeof provider === 'string' && typeof model === 'string'
      ? (KNOWN_MODELS[provider]?.[model] ?? TIER_BY_ID[model])
      : undefined;
    if (actual === undefined || RANK[actual] < RANK[required]) {
      const selected = typeof provider === 'string' && typeof model === 'string'
        ? `${provider}/${model}`
        : 'an unresolved model';
      throw new Error(
        `Model-floor gate: agent "${input?.agent}" requires ${required}, but ${selected} is ${actual ?? "not in the verified tier table"}. Choose a listed ${required}-or-higher binding from MODEL_TIERS.md.`,
      );
    }
  },
  'tool.execute.before': async (input, output) => {
    if (input?.tool !== 'bash') return;
    const run = spawnSync('node', [DIGEST_HOOK], {
      cwd: directory, encoding: 'utf8', timeout: 2000,
      input: JSON.stringify({ toolName: 'bash', input: output?.args, cwd: directory }),
    });
    if (run.status !== 0 || !run.stdout.trim()) return;
    try {
      const updated = JSON.parse(run.stdout).hookSpecificOutput?.updatedInput;
      if (updated && typeof updated === 'object') output.args = updated;
    } catch { /* canonical hook is fail-open */ }
  },
  event: async ({ event }) => {
    if (event?.type !== 'file.edited' || /^(off|0|false)$/i.test(process.env.CODE_OPS_INDEX ?? '')) return;
    const file = event.properties?.file;
    if (typeof file !== 'string' || !file) return;
    spawnSync('node', [QUERY, 'refresh', file], { cwd: directory, timeout: 5000, stdio: 'ignore' });
  },
  'experimental.chat.system.transform': async (_input, output) => {
    output.system.push(ROUTING_CARD);
  },
  'experimental.session.compacting': async (_input, output) => {
    output.context.push(COMPACTION_CONTEXT);
  },
});
