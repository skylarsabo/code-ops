---
name: onboarding
description: "Use when you need a verified, code-grounded orientation guide, with an architecture diagram, for a new contributor."
---

# CODEBASE ONBOARDING: Generate the Orientation Guide

**Codex path rule:** Resolve `<plugin-root>` as the installed root of this plugin (the directory containing `CONVENTIONS.md`); use it for every bundled script or reference path.

**Invoke in Codex by naming `code-ops-suite:onboarding`.** First read the
`<plugin-root>/CONVENTIONS.md` bundled with this plugin. Search the plugin directory for
it if needed. It defines the operating model, interaction protocol, safety rails, schemas, and
quality lenses this skill references by section. For this DOCUMENT-mode skill the binding
sections are §2 (tools and in-house docs lookup), §3 (interaction), §4 (safety rails), §12 (SSOT
and registers), and §13 (doc standard). Read those five. The fan-out and fix machinery (§1, §5 to
§8, §11) does not apply here.
**Mode:** DOCUMENT · **Produces:** `ONBOARDING.md`, or a small `docs/onboarding/` set, with an
architecture diagram, following the documentation quality standard (`§13`).

Produce a high-quality, **code-grounded** orientation guide, so a new engineer or a fresh agent
becomes productive fast. **Code is ground truth.** Verify everything. Do not paraphrase existing
docs, which may have drifted, and **run the setup steps** to confirm they work. Flag
uncertainties as open questions rather than inventing answers.

## Phase 0: the system map  *(checkpoint)*

Dispatch an `explorer` operative to map the stack and runtimes, the services and modules and how
they fit, the data models, the main user-facing flows, the entry points, the build and test and
run commands, and the conventions and patterns. When the system handles sensitive data, have it
map the data-handling and privacy model too. Ingest the reconciled SSOT docs and service map when
present, noting any drift for the doc-alignment prompt.

> **CHECKPOINT:** confirm the audience (new engineer, external contributor, or future agent) and the emphasis. Share the system map and the proposed outline, then write the guide.

## Phase 1: the guide

Write the sections in a sensible reading order:
- **The mental model:** what the product is, the core concepts, and the 30-second account of how it fits together.
- **Architecture:** the services and modules, the request and data flow, and a **diagram** matching the real map.
- **Repo tour:** where everything lives.
- **Getting started:** clone, install, configure, run, and test, **verified by running it**, with secret values redacted and the pitfalls noted.
- **Key flows:** two or three important flows traced end to end through the actual code.
- **Conventions and standards:** the style, the patterns, the testing approach, and how to add a new unit of the common kind.
- **The data-handling and security rules a contributor must not break**, when applicable.
- **Gotchas and sharp edges:** the non-obvious and the surprising-but-intentional, explained with history.
- **Glossary.**

**The quality bar.** The guide is accurate because it is verified rather than invented. It is
genuinely useful, covering what a newcomer needs to be productive rather than dumping everything.
It is concise but complete, and it is skimmable.

## Deliverables

A single **`ONBOARDING.md`**, or a small `docs/onboarding/` set, matching the repo's docs
convention and placed inside its SSOT structure so it stays maintained. Include the architecture
diagram. List the open questions for the developer.

## Done when

A newcomer could do all four of these from the guide:
1. Understand what the product is and how it is built.
2. Get it running from the verified steps.
3. Follow the key flows in the code.
4. Know the conventions and the rules they must not break.

And the guide itself is verified against code, its setup steps are confirmed, and its open
questions are flagged rather than invented. Present the guide and note where it lives.
