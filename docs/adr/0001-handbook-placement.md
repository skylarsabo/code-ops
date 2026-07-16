# 1. Handbook placement: suite-wide, tracked, repo-root `docs/`

- Status: Accepted
- Date: 2026-06-23

## Context

The code-ops suite ships several plugins from a single monorepo, and we need a
home for the how-to handbook (narrative guides, repeatable techniques, and the
cross-cutting reference material that ties the plugins together). Before
choosing a location we verified the constraints that actually govern the
decision.

### What is tracked vs. gitignored

`git check-ignore` confirms a clean split between the candidate handbook paths
and the working/scratch paths:

| Path | Status |
| --- | --- |
| `docs/handbook/` | tracked-eligible |
| `docs/guides/` | tracked-eligible |
| `docs/techniques/` | tracked-eligible |
| `docs/specs/` | gitignored |
| `docs/superpowers/` | gitignored |
| `docs/code-ops-run/` | gitignored |

The handbook must live in version control so it ships with the repo, gets
reviewed in PRs, and stays diffable. That immediately rules out
`docs/specs/`, `docs/superpowers/`, and `docs/code-ops-run/`, which are
gitignored (local specs, vendored superpowers material, and per-run audit
artifacts respectively — intentionally not part of the published source of
truth). The `docs/handbook/`, `docs/guides/`, and `docs/techniques/` paths are
tracked-eligible and are the correct home.

### The marketplace-install caveat

The suite is also consumable via marketplace install of individual plugins.
Installing a single plugin delivers only that plugin's `plugins/<name>/`
folder — it does **not** deliver the repo-root `docs/` tree. A handbook placed
under repo-root `docs/` is therefore for **repo browsers** (people who clone or
view the monorepo), not for single-plugin installers. To bridge that gap, each
plugin's `README` points back to the suite handbook so an installed plugin still
has a discoverable trail to the full how-to material.

### Journeys cross plugins

Real user journeys span multiple plugins rather than staying inside one. A
unified, suite-wide hub lets a single guide walk a journey end to end across
plugin boundaries, with one place to cross-link techniques. Per-plugin
handbooks would fragment those journeys, duplicate shared content, and drift
independently. A single hub beats N partial handbooks.

### Freshness is enforced at different levels

Keeping a tracked, suite-wide handbook honest relies on a mix of mechanical
gates and convention, not one uniform CI check:

- `scripts/lint-plugins.mjs` checks plugin/handbook parity as a **per-push CI
  gate** (`validate.yml`) — it fails the build on drift.
- `scripts/check-doc-citations.mjs` checks that `path:line` citations across
  `docs/handbook/`, `docs/techniques/`, `docs/guides/`, and `docs/adr/` still
  resolve against the current tree — a **mechanical script, run on demand**,
  not yet wired into a per-push gate.
- `Verified-at:` stamps tie documents to the commit they were last verified
  against — a **convention**, checked by eye at review time, with no
  mechanical enforcement of its own.
- doc-alignment checks catch drift between docs and the code/plugins they
  describe, run as a **scheduled/manual sweep**, not per push.

The per-push gates make some classes of drift fail loudly; `Verified-at:` and
the doc-alignment sweep still depend on review discipline to catch the rest.

## Decision

The suite-wide how-to handbook lives in **tracked** `docs/handbook/` (alongside
`docs/guides/` and `docs/techniques/`), authored **suite-wide rather than
per-plugin**.

It is explicitly **not** placed in the gitignored `docs/specs/`,
`docs/superpowers/`, or `docs/code-ops-run/` paths.

Each plugin's `README` points to the suite handbook so single-plugin installs
retain a path back to the full documentation.

## Consequences

- A single source of truth: cross-plugin journeys are documented once, in one
  hub, with shared techniques cross-linked rather than duplicated.
- The handbook is versioned, reviewable, and diffable. Freshness enforcement
  is mixed, not uniformly CI-gated: `lint-plugins.mjs` parity is a per-push
  gate and `check-doc-citations.mjs` line-citations are a mechanical script
  run on demand, while `Verified-at:` stamps are convention only (no
  mechanical check) and doc-alignment checks run as a scheduled/manual sweep.
- **Tradeoff:** single-plugin marketplace installers do **not** receive the
  handbook on install — they get only `plugins/<name>/` and rely on the
  plugin `README` pointer back to the repo. The handbook primarily serves repo
  browsers. Revisit this if there is demand to deliver handbook content
  directly to single-plugin installs (e.g. bundling a relevant subset into each
  `plugins/<name>/`).

*Verified-at: c2b37e9*
