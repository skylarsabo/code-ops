---
description: "Use when you need a verified, code-grounded orientation guide (with an architecture diagram) for a new contributor."
disable-model-invocation: true
---

# CODEBASE ONBOARDING — Generate the Orientation Guide

**Invoked as `/code-ops-suite:onboarding`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` bundled with this plugin (search the plugin directory for it if needed) — it defines the operating model, interaction protocol, safety rails, schemas, and quality lenses this skill references by section.
**Mode:** DOCUMENT · **Produces:** `ONBOARDING.md` (or a small `docs/onboarding/` set) with an architecture diagram, following the documentation quality standard (`§13`).

Produce a high-quality, **code-grounded** orientation guide so a new engineer — or a fresh agent — becomes productive fast. **Code is ground truth** — verify everything; don't just paraphrase existing (possibly drifted) docs, and **run the setup steps** to confirm they work. Flag uncertainties as open questions rather than inventing.

## Phase 0 — Map the system  *(checkpoint)*
Stack and runtimes; services/modules and how they fit; data models; main user-facing flows; entry points; build/test/run commands; conventions/patterns; and (if the system handles sensitive data) its data-handling/privacy model. Ingest the reconciled SSOT docs and service map if present (noting any drift for the doc-alignment prompt).
> **CHECKPOINT:** confirm the audience (new engineer / external contributor / future agent) and emphasis; share the system map and proposed outline; then write it.

## Phase 1 — Write the guide
In a sensible reading order: **the mental model** (what the product is, core concepts, the 30-second "how it fits"); **architecture** (services/modules, request/data flow, with a **diagram** matching the real map); **repo tour** (where everything lives); **getting started** (clone→install→configure→run→test, **verified by running it**; redact secret values; note pitfalls); **key flows** (trace 2–3 important flows end-to-end through the actual code); **conventions & standards** (style, patterns, testing approach, "how to add X"); **the data-handling/security rules a contributor must not break** (if applicable); **gotchas & sharp edges** (the non-obvious, the surprising-but-intentional — use history to explain); **glossary**.

**Quality bar:** accurate (verified, not invented), genuinely useful (what a newcomer needs to be productive, not an exhaustive dump), concise but complete, skimmable.

## Deliverables
A single **`ONBOARDING.md`** or a small `docs/onboarding/` set — matching the repo's docs convention and placed inside its SSOT structure so it stays maintained. Include the architecture diagram. List open questions for the developer.

## Done when
A newcomer could (a) understand what the product is and how it's built, (b) get it running from the verified steps, (c) follow the key flows in the code, and (d) know the conventions and the rules they must not break. Everything verified against code; setup steps confirmed; open questions flagged, not invented. Present the guide and note where it lives.
