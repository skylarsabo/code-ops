---
type: decision
status: accepted
updated: 2026-08-18
tags:
  - meta
  - standard
---

# D-002 vault adoption stays voluntary

## Decision

Vault adoption is not lint-gated. A repo with no vault is legitimate, and no gate in this marketplace fails a repo for lacking one.

The enforcement mechanism is measurement, not refusal. `conform` reports the vault surface as `ABSENT` when a repo carries no vault. The conformance snapshot trends that value over time, so an absent vault is visible rather than silent. A repo that wants hard enforcement adds `check-vault-standard.mjs` to its own CI, which is what code-ops itself does.

## Context

The vault standard landed as a layout every repo of this operator already wanted. External adopters are a different case. They install one plugin, run one skill, and judge the suite on that. A gate demanding a whole documentation tree before the first run turns an incremental trial into a migration project.

The suite's own doctrine already separates these two ideas. A machine check that reports a fact is cheap and safe to run everywhere. A gate that blocks on a fact is a promise about what the repo must contain, and that promise belongs to the repo, not to the marketplace.

## Options considered

1. **Measurement, with per-repo opt-in enforcement.** Chosen. `conform` reports `ABSENT`, the snapshot trends it, and a repo escalates to a gate by wiring the checker into its own CI.
2. **A lint gate requiring a vault.** Rejected: it breaks incremental adoption. An adopter evaluating one skill would have to build a documentation tree first, and the gate would fail every repo that legitimately keeps its docs elsewhere.
3. **Silence — check nothing when no vault exists.** Rejected: `ABSENT` becomes invisible. A repo that meant to adopt a vault and never did would look identical to a repo that decided against one, and no trend would ever surface the drift.

## Consequences

`check-vault-standard.mjs` stays fail-closed about a vault's *contents* and silent about its *existence*. The two behaviors are deliberate and must not be merged.

The conformance snapshot is the place to read adoption. A rising count of `ABSENT` surfaces are a signal for the operator to act on, never an automatic failure.

This repo remains the reference case for the escalated form: `.github/workflows/validate.yml` runs the checker against `code-ops-docs/` on every push, so code-ops holds itself to the gate it declines to impose.

## Related

- [[Standard]]
- [[D-001 adopt vault standard]]
- `docs/techniques/vault-standard.md`
