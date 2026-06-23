# Choosing an automation level

A code-changing run asks you one question up front: **how much may the agent apply on its own before it stops and asks you?** That setting is the *automation level*. You set it once at the start of the run; it then governs every code-changing step until the run ends. This page tells you which level to pick, what each one actually does, and the categories that stop for you no matter what you chose.

## The short version

Three levels, plus a floor that overrides all of them.

| Level | What it does | When to use it |
| --- | --- | --- |
| `gated` *(default)* | Pauses for your approval at every fix or closure batch. Nothing lands without a yes. | The default. Unfamiliar code, high-stakes work, or any time you want to see each change before it lands. |
| `auto-safe` *(recommended ceiling)* | Auto-applies only **NOW-SAFE** items — each on a branch, behavior-preserving, test-backed, trivially revertible. Pauses for everything else. | You trust the suite on the mechanical items and want to spend your attention on the judgment calls. The highest level worth setting. |
| `auto-all` | *Not recommended.* Auto-applies beyond NOW-SAFE. | Rarely. Even here the always-gated categories below still stop, and architectural (NEEDS-DESIGN) items are never auto-applied. |

Two rules hold at every level: the **always-gated categories** (security/auth, secrets, data migrations and destructive ops, public API/contract changes) stop for your approval regardless of the level you picked, and **nothing ever auto-merges** — even auto-applied fixes land as commits or PRs for you to review.

If you read nothing else: start at `gated`, move to `auto-safe` once you trust the run, and treat `auto-all` as a level you have to justify.

This setting is the same across the whole suite. The canonical definition lives in [code-ops-suite `CONVENTIONS.md` §4](../../plugins/code-ops-suite/CONVENTIONS.md); the verification-layer copy is [rigor `CONVENTIONS.md` §4](../../plugins/rigor/CONVENTIONS.md), where `auto-safe` additionally requires each item be **CONFIRMED**. Orchestrators surface it as an explicit checkpoint — for example, `everything` asks for it in Phase 0 ([SKILL.md](../../plugins/code-ops-suite/skills/everything/SKILL.md)).

---

## The levels in depth

Everything below is for an engineer who already knows Claude Code and wants to know exactly where each line falls. The deciding concept is the **track** an item is classified into — NOW-SAFE, NEEDS-REVIEW, or NEEDS-DESIGN — defined in [code-ops-suite `CONVENTIONS.md` §6](../../plugins/code-ops-suite/CONVENTIONS.md) and covered as a technique in [reading a findings register](reading-a-findings-register.md). The automation level is, in effect, a rule about *which tracks the agent may apply without asking.*

### `gated` — the default

Pause for your approval at each fix or closure batch. No item of any track lands without an explicit yes. This is what you get if you say nothing.

Pick `gated` when you are working in code you do not yet trust the agent to touch unsupervised, when the blast radius of a wrong edit is large, or when you simply want to watch the work go by. The cost is your attention at every batch; the benefit is that you see and approve each change before it exists in the tree.

### `auto-safe` — the recommended ceiling

Auto-apply **only NOW-SAFE items**, and pause for everything else.

NOW-SAFE is a deliberately narrow track ([§6](../../plugins/code-ops-suite/CONVENTIONS.md)): an item is NOW-SAFE only if it is self-contained, local, small, **behavior-preserving** (or fixing behavior that is unambiguously a bug with an obvious fix), touches no contract/API/schema, is test-covered or quickly testable, and is **trivially revertible**. When `auto-safe` applies such an item it does so on a branch, test-backed, behavior-preserving, and trivially revertible — the four properties that make an auto-apply safe to undo. In the rigor verification layer, `auto-safe` adds one more bar: the item must be **CONFIRMED** (reproduced, not merely suspected) and carry a failing→passing regression test that clears the regression guard ([rigor `CONVENTIONS.md` §4](../../plugins/rigor/CONVENTIONS.md)).

`auto-safe` pauses for NEEDS-REVIEW (real, but behavior-changing, contract-touching, non-trivial, or risky), NEEDS-DESIGN (architectural or cross-cutting), and the always-gated categories. This is the level to reach for once a run has earned your trust on the mechanical items: it spends the agent's autonomy on the changes that are boring to approve one by one, and reserves your attention for the changes that genuinely need judgment. It is called the *recommended ceiling* because there is rarely a good reason to grant more.

### `auto-all` — not recommended

Auto-apply beyond NOW-SAFE. The suite marks this *not recommended* and keeps two guardrails even here: the always-gated categories still stop for you ([code-ops-suite §4](../../plugins/code-ops-suite/CONVENTIONS.md)), and NEEDS-DESIGN items are never auto-applied ([rigor §4](../../plugins/rigor/CONVENTIONS.md)). Choosing `auto-all` means accepting that behavior-changing and contract-adjacent NEEDS-REVIEW items may land without a per-item yes. Use it only when you have a strong reason and a cheap way to review the result in bulk afterward.

---

## The always-gated categories

Some changes stop for your approval **regardless of the automation level** — including `auto-all`. They are the categories where a wrong autonomous edit is expensive or irreversible ([code-ops-suite §4](../../plugins/code-ops-suite/CONVENTIONS.md)):

- **Security / auth changes** — anything touching authentication, authorization, or a security control.
- **Secret handling** — secrets are radioactive ([§4 safety rails](../../plugins/code-ops-suite/CONVENTIONS.md)); a live secret is a critical finding, never auto-touched.
- **Data migrations and destructive / irreversible operations** — schema migrations, deletions, history rewrites, anything you cannot trivially undo.
- **Public API / contract changes** — anything that alters a contract a consumer depends on.

These exist because no automation level should be able to make an irreversible, security-relevant, or consumer-visible change on its own. If an item falls into one of these categories, the run stops and asks — that is the floor.

## Nothing ever auto-merges

Every level applies fixes as commits or PRs on a branch. **None of them merge.** Even at `auto-all`, even for a NOW-SAFE one-liner, the change lands as reviewable work and waits for you ([code-ops-suite §4](../../plugins/code-ops-suite/CONVENTIONS.md): *"Never auto-merge — even auto-applied fixes land as commits/PRs for review"*; [rigor §4](../../plugins/rigor/CONVENTIONS.md)). The automation level decides how much the agent writes without asking; it never decides what reaches your main branch. That gate is always yours.

---

## A decision guide

Three rows to settle the choice quickly.

| Your situation | Pick | Why |
| --- | --- | --- |
| Unfamiliar code, high stakes, or you want to see every change | `gated` | The default. You approve each batch before it lands; maximum visibility, maximum control. |
| You trust the run on mechanical items and want to focus your attention on judgment calls | `auto-safe` | The recommended ceiling. Only NOW-SAFE items land unattended (branched, test-backed, revertible); everything risky still stops. |
| You have a specific, justified reason to apply beyond NOW-SAFE and a cheap way to review in bulk | `auto-all` | Not recommended. Use sparingly — the always-gated floor and NEEDS-DESIGN still hold, but behavior-changing items may land without a per-item yes. |

How to set it: every code-changing run takes the level up front. The default is `gated` if you say nothing; orchestrators ask explicitly (`everything` Phase 0, [SKILL.md](../../plugins/code-ops-suite/skills/everything/SKILL.md)). You can also steer mid-run — "auto-approve the low-risk ones," "always open a PR per item" — and the run remembers it ([§3 interaction protocol](../../plugins/code-ops-suite/CONVENTIONS.md)).

## Related

- [Reading a findings register](reading-a-findings-register.md) — the NOW-SAFE / NEEDS-REVIEW / NEEDS-DESIGN tracks the level acts on.
- [The disconfirmation pass](disconfirmation-pass.md) — how items earn the CONFIRMED tier that `auto-safe` requires in the rigor layer.
- [04 · Registers and freshness](../handbook/04-registers-and-freshness.md) — the registers that hold the items being applied.

*Verified-at: c2b37e9*
