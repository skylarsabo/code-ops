---
type: design
status: draft
updated: 2026-09-03
tags:
  - design
  - fleet
---

# Cross-repo judgment

The fleet standard and `scripts/check-fleet.mjs` landed the mechanical half of multi-repo work: a manifest, a consent rule, and one conformance table across members. They deliberately stop short of the judgment half. This note states what the judgment half is, why it is harder than it looks, and what would have to be true before any code ships.

## The problem

A fleet operator wants two things, and neither exists:

1. **One finding reported once, not once per member.** A sweep across four members reports one root-cause defect four times, with four identifiers and four pieces of evidence. The operator triages it four times. A fix in one member leaves the other three entries open, so the backlog says three repositories are broken when one class of bug is.
2. **Judgment that spans repositories.** Some facts are true of the fleet, not of a member: a shared convention, a cross-repo interface, a doctrine clause and its adoption state. That judgment has no home today. It goes into whichever repository's vault the operator was in, and the other three never see it.

## Sub-problem one: freshness across independent histories

The atlas answers freshness with a per-repo `verifiedDigest` and a diagnostic `verifiedAt` stamp. The digest binds versioned, exact scope declarations and tracked state. The mechanism is single-repo by construction. A shared section covering four repositories has no single current state, because the histories advance independently.

The workable shape is one section carrying **per-repo digest and diagnostic stamps inside it**. The judgment is written once. Freshness is a map from member to `verifiedDigest` and `verifiedAt`, checked against each member's tracked state. A section can be FRESH for some members and STALE for others at the same instant. Every consumer must handle that split, because one verdict would be falsely fresh or permanently stale.

The open question is not the data shape. It is where the section lives. A shared section inside one member's vault makes that member's checkout a dependency of the other three, which the fleet standard's consent rule argues against: a member can leave, and its vault leaves with it.

## Sub-problem two: similarity and the false merge

Deduplication needs a rule for "the same finding". Every candidate rule is a guess:

- **Same normalized message.** Cheap, and wrong across repositories whose messages carry different identifiers.
- **Same rule or lens plus same code shape.** Better, and it merges two genuinely different defects that a shared lens happened to flag.
- **Same root cause, judged by a model.** Closest to what the operator means, and the least reproducible, which the suite's evidence doctrine refuses for anything load-bearing.

The asymmetry decides the design. **A false merge is strictly worse than a duplicate.** A duplicate costs a second triage. A false merge deletes a real finding from the backlog, and it deletes it silently, because nobody triages what is not listed and the closing gate reports green. So any deduplication that ships must be a *grouping* that keeps every original entry addressable, never a merge that drops one.

## Candidate designs

**A. Grouping only, no merge.** The fleet run emits the per-member registers unchanged, plus a `FLEET_GROUPS.md` mapping a group identifier to the member findings it links. Nothing is deleted, and the operator triages the group.
*Failure mode:* it does not reduce work by much. The operator still reads one entry per member, and a wrong grouping is cheap but noisy enough that people stop reading the groups.

**B. A fleet register with member-scoped entries.** One `FINDINGS_REGISTER.md` at fleet scope, where each entry carries a member list and a per-member status. A fix closes one member's slot, and the entry stays open until every slot closes.
*Failure mode:* it needs the freshness map from sub-problem one first, and an entry spanning four repositories has four evidence citations that go stale at four different rates. The register grammar has no cell for that today, so this is a grammar change rather than a feature.

**C. Doctrine-only fleet judgment, findings stay per-repo.** Accept that findings do not federate. The fleet layer carries only doctrine and conformance, which is what `check-fleet.mjs` already does, and cross-repo judgment is limited to notes about the fleet itself, in the operator's own vault.
*Failure mode:* it leaves the duplicate problem unsolved, and the operator's manual deduplication becomes permanent. It is the honest option if the prototype shows similarity rules do not clear the false-merge bar.

## Recommendation

Prototype against the real four-repo fleet before any code ships. Run one sweep per member, collect the four registers, and hand-classify which entries an operator would call the same finding. That gives a labeled set, which is the only way to know whether any similarity rule reaches a false-merge rate near zero. Near zero is the bar, because the failure is silent.

If the labeled set shows the duplicates are few, choose C and stop. If the duplicates are many and the boundaries are clean, build A first, because grouping is reversible and merging is not. Reach for B only once a grammar change for per-member freshness is worth making on its own.

Related: `code-ops-docs/40 Engineering/Techniques/fleet-standard.md`, `code-ops-docs/40 Engineering/Techniques/atlas.md`, [[Suite direction 2026-08]].
