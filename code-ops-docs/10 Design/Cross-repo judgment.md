---
type: design
status: draft
updated: 2026-08-18
tags:
  - design
  - fleet
---

# Cross-repo judgment

The fleet standard and `check-fleet.mjs` landed the mechanical half of multi-repo work: a manifest, a consent rule, and one conformance table across members. They deliberately stop short of the judgment half. This note states what that half is, why it is harder than it looks, and what would have to be true before any code ships.

## The problem

Two things a fleet operator wants, and neither exists:

1. **The same finding in N repos.** A sweep across four members reports one root-cause defect four times, once per member, with four ids and four pieces of evidence. The operator triages it four times. Worse, a fix in one member leaves the other three entries open, so the backlog says three repos are broken when one class of bug is.
2. **Judgment that spans repos.** Some facts are true of the fleet, not of a member: a shared convention, a cross-repo interface, a doctrine clause and its adoption state. Today that judgment has no home. It goes into whichever repo's vault the operator was in, and the other three never see it.

## Sub-problem one: freshness across independent histories

The atlas answers freshness with a `verifiedAt` commit and a git diff over a scope. The mechanism is exact and it is single-repo by construction. A shared section covering four repos has no single commit that means current, because the four histories advance independently and no ordering relates them.

The workable shape is one section with **per-repo stamps inside it**: the judgment is written once, and its freshness is a map from member to `verifiedAt`, checked per member against that member's own history. The section is then FRESH for some members and STALE for others at the same instant, which is correct and which every consumer must handle. A section that collapses to one verdict is either falsely fresh (any member current) or permanently stale (all members must agree), and both are worse than the honest split verdict.

The open question is not the data shape. It is where the section lives. A shared section inside one member's vault makes that member's checkout a dependency of the other three, which the fleet standard's consent rule argues against: a member can leave, and its vault leaves with it.

## Sub-problem two: similarity and the false merge

Deduplication needs a rule for "the same finding". Every candidate rule is a guess:

- **Same normalized message.** Cheap, and wrong across repos with different identifiers in the message.
- **Same rule or lens plus same code shape.** Better, and it merges two genuinely different defects that a shared lens happened to flag.
- **Same root cause, judged by a model.** Closest to what the operator means, and the least reproducible, which the suite's own evidence doctrine refuses for anything load-bearing.

The asymmetry is the whole design constraint. **A false merge is strictly worse than a duplicate.** A duplicate costs a second triage. A false merge deletes a real finding from the backlog, and it deletes it silently — nobody triages what is not listed, and the closing gate reports green. So any dedup that ships must be a *grouping* that keeps every original entry addressable, never a merge that drops one.

## Candidate designs

**A. Grouping only, no merge.** The fleet run emits the per-member registers unchanged, plus a `FLEET_GROUPS.md` mapping a group id to the member findings it links. Nothing is deleted, and the operator triages the group.
*Failure mode:* it does not reduce work by much. The operator still reads N entries, and a wrong grouping is cheap but noisy enough that people stop reading the groups.

**B. A fleet register with member-scoped entries.** One `FINDINGS_REGISTER.md` at fleet scope, where each entry carries a member list and a per-member status. A fix closes one member's slot and the entry stays open until every slot closes.
*Failure mode:* it needs the freshness map from sub-problem one to be solved first, and an entry spanning four repos has four evidence citations that go stale at four different rates. The register grammar has no cell for that today, so this is a grammar change, not a feature.

**C. Doctrine-only fleet judgment, findings stay per-repo.** Accept that findings do not federate. The fleet layer carries only doctrine and conformance — what `check-fleet.mjs` already does — and cross-repo judgment is limited to notes about the fleet itself, in the operator's own vault.
*Failure mode:* it leaves the N-duplicates problem entirely unsolved, and the operator's manual dedup becomes permanent. It is the honest option if the prototype shows similarity rules do not clear the false-merge bar.

## Recommendation

Prototype against the real four-repo fleet before any code ships. Run one sweep per member, collect the four registers, and hand-classify which entries an operator would call the same finding. That gives a labeled set, which is the only way to know whether any similarity rule reaches a false-merge rate near zero — and near zero is the bar, because the failure is silent.

If the labeled set shows the duplicates are few, choose C and stop. If the duplicates are many and the boundaries are clean, build A first, because grouping is reversible and merging is not. Reach for B only once a grammar change for per-member freshness is worth making on its own.

Related: `code-ops-docs/40 Engineering/Techniques/fleet-standard.md`, `code-ops-docs/40 Engineering/Techniques/atlas.md`, [[Suite direction 2026-08]].
