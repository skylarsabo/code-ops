# Generated opencode distribution

This directory is generated from the canonical packages under `../plugins/` by
`node scripts/build-opencode-dist.mjs`. Do not edit files here directly; change the
source package and rerun the renderer.

## Install

Copy the contents into your opencode config directory — `~/.config/opencode/` for a
global install, or `.opencode/` inside a repository for a project-local one:

```bash
cp -R opencode-dist/. ~/.config/opencode/
```

The layout is deliberate. `plugins/code-ops-traceless.js` resolves its scanner through
`../code-ops/code-ops-suite/scripts/`, so moving directories apart breaks the gate.

## What lands where

- `skills/` — 65 skills, discovered by the model through opencode's `skill` tool.
- `commands/` — 65 slash commands, one per skill, for user invocation.
- `agents/` — 8 subagents, with their Claude tool allowlists translated to opencode permissions.
- `code-ops/` — per-plugin `CONVENTIONS.md` and the runtime scripts the skills invoke.
- `plugins/` — the traceless-publishing gate, ported to an opencode plugin hook.
- `opencode.json` — an example config binding every agent to its tier. Merge it into
  your own config rather than overwriting one you already have.

## Naming

opencode's skill and agent namespaces are flat and its names cannot contain a colon, so
every name is prefixed with its plugin: `/code-ops-suite:ship` becomes `/code-ops-suite-ship`.
The prefix is load-bearing — `full-sweep` ships in two plugins and `explorer` in two more.

See `MODEL_TIERS.md` for model bindings and `PLATFORM_COMPATIBILITY.md` for the full
list of host transforms.
