# Atlas

The Atlas is the repository's freshness-gated cache of codebase judgment.

- [Manifest](MANIFEST.json) maps sections to exact repository scopes and verification digests.
- [Inbox](INBOX.md) captures observations awaiting consolidation.
- [Plugin and skill judgment](sections/plugins-and-skills.md)
- [Gate-script judgment](sections/gate-scripts.md)
- [Evaluation and calibration judgment](sections/evals-and-calibration.md)
- [Generated-host judgment](sections/codex-render.md)
- [CI workflow judgment](sections/ci-workflows.md)
- [Documentation-doctrine judgment](sections/docs-doctrine.md)
- [Root-contract judgment](sections/root-contracts.md)

Run `node scripts/atlas-check.mjs check --atlas "code-ops-docs/98 System/Atlas" --gate` before trusting a section.
