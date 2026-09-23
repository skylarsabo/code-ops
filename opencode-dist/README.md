# Generated opencode distribution

This directory is generated in the code-ops repository (https://github.com/skylarsabo/code-ops)
from the canonical packages under `../plugins/` by `node scripts/build-opencode-dist.mjs`.
Do not edit files here directly; change the source package and rerun the renderer.

## Install

Copy the contents into your opencode config directory — `~/.config/opencode/` for a
global install, or `.opencode/` inside a repository for a project-local one:

```bash
cp -R opencode-dist/. ~/.config/opencode/
```

The layout is deliberate. `plugins/code-ops-traceless.js` resolves its scanner through
`../code-ops/code-ops-suite/scripts/`, so moving directories apart breaks the gate.

## What lands where

- `skills/` — 62 skills, discovered by the model through opencode's `skill` tool.
- `commands/` — 62 slash commands, one per skill, for user invocation.
- `agents/` — 11 subagents, with their Claude tool allowlists translated to opencode permissions.
- `code-ops/` — per-plugin `CONVENTIONS.md`, reference specs that skills cite, runtime
  scripts, and non-discoverable tier-floor carriers for the vendored preflight scripts.
- `plugins/` — the traceless-publishing gate, the model-floor gate, and the lifecycle
  plugin. `code-ops/cost-report.mjs` reads the lifecycle cost ledger.
- `opencode.json` — an example config binding every agent to its tier. Merge it into
  your own config rather than overwriting one you already have.

## Naming

opencode's skill and agent namespaces are flat and its names cannot contain a colon, so
every name is prefixed with its plugin: `/code-ops-suite:ship` becomes `/code-ops-suite-ship`.
The prefix is load-bearing — `full-sweep` ships in two plugins and `explorer` in two more.

See `MODEL_TIERS.md` for model bindings and `PLATFORM_COMPATIBILITY.md` for the full
list of host transforms.
