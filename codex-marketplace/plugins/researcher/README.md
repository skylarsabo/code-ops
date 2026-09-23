# Researcher for Codex

> Generated in the code-ops repository (https://github.com/skylarsabo/code-ops) by `scripts/build-codex-marketplace.mjs` from the canonical Claude source. Do not edit this directory directly.

Code-grounded research workflows: ground in the codebase (or given materials), gather external knowledge, and propose improvements, design briefs, library evaluations, and new ideas. Every claim is cited and tiered; local-first with disclosed, fail-closed egress. It proposes and hands implementation to the other suites. Developer-in-the-loop.

## Use

Name a workflow in Codex as `researcher:<skill>`. Every generated skill sets `policy.allow_implicit_invocation: true`, matching the Claude-side model-invocable policy.

## Skills

- `ecosystem-watch` — Use to learn what changed in our stack that needs action: dependency updates, CVEs, deprecations, and new capabilities. Schedulable, discovery only, no code.
- `library-eval` — Use to decide on adopting a library or approach, A versus B versus building it, with code-grounded fit, migration cost, and a tiered verdict. Writes no code.
- `research-ideate` — Use for novel feature ideas grounded in our code, its domain, and opt-in web trends. Writes no code. For code-only ideas, use code-ops-suite:feature-discovery.
- `research-improve` — Use for improvements to our existing code grounded in external best practice, not a generic checklist. Writes no code, and proposes and hands off instead.
- `research-spike` — Use when a task, feature, or plan needs a code-grounded design brief before anyone builds it. Writes no code.
- `research-sweep` — Use for code-grounded research as one developer-in-the-loop pipeline, local-first with opt-in disclosed web. Orchestrates and proposes; writes no code.
- `research-verify` — Use to fact-check a claim, recommendation, or draft research adversarially against sources and our code before anyone acts on it. Review only; writes no code.

## Packaging notes

- The complete workflow text and conventions are rendered from `plugins/researcher/` in the code-ops repository.
- Claude-specific GitHub Action examples are intentionally not bundled here.
- Root-level `agents/*.md` files are collaboration-subagent briefing templates. Their machine-readable minimum tiers are in `agents/model-floors.json`; the lead selects a supported runtime model before dispatch.

For source history and release notes, see the generated `CHANGELOG.md` and the repository root.
