---
description: "Use when you need an accurate API or interface reference for a codebase, generated from the code and types, not from memory."
---

# API-DOCS: The Interface Reference

**Invoked as `/code-ops-suite:api-docs`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md`,
and especially the **documentation quality standard (`§13`)** this doc obeys. For this
DOCUMENT-mode skill the binding sections are §2 (tools and in-house docs lookup), §3
(interaction), §4 (safety rails), §12 (SSOT and registers), and §13 (doc standard). Read those
five. The fan-out and fix machinery (§1, §5 to §8, §11) does not apply here.
**Mode:** DOCUMENT. **Produces:** `API.md`, or one file per service, in the repo's docs
location.

## Phase 0: the public surface  *(checkpoint)*

Dispatch an `explorer` operative to find the public surface: HTTP routes, a GraphQL schema,
RPC or gRPC services, or a library's exported API. When there is no real external surface, say
so and stop. Confirm which surfaces to cover, and the docs location.

## Phase 1: the reference, one entry per operation

Generate each entry from the handlers and the types or schema, never from memory. For each
endpoint, operation, or export, record the signature, the parameters, the request and response
**shapes** with the type or schema `file:line` linked, the auth and permissions, the error
responses and status codes, the side effects, and the rate limits. Group entries logically, and
use a table for the matrix.

## Phase 2: the orientation that makes it usable

Write a short "how to call it" orientation covering the base URL, auth, and versioning. Add one
**real** example per common operation, drawn from tests or call-sites and never invented. Add a
Mermaid sequence diagram for any multi-call flow that is not trivial.

## The assembly, per `§13`

Lead with an executive summary naming what the API does, the auth model, and the entry points.
Then give the reference. Cite `file:line`. Mark inferred behavior `UNVERIFIED`. Stamp the SHA.

## Done when

- Every documented operation maps to a real handler or export, cited, with accurate shapes taken from the types or schema.
- Auth and errors are covered.
- Every example is real.
- An integrating engineer could call the API correctly from this doc alone.
