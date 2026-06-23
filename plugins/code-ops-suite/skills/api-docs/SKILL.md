---
description: "Use when you need an accurate API/interface reference for a codebase — endpoints or exported surface with signatures, request/response shapes, auth, errors, and real examples — generated from the code and types, not memory."
disable-model-invocation: true
---

# API-DOCS — The Interface Reference

**Invoked as `/code-ops-suite:api-docs`.** First read the `${CLAUDE_PLUGIN_ROOT}/CONVENTIONS.md` — especially the **documentation quality standard (`§13`)** this doc obeys.
**Mode:** DOCUMENT. **Produces:** `API.md` (or per-service) in the repo's docs location.

## Phase 0 — Detect the surface  *(checkpoint)*
Find the public surface: HTTP routes, a GraphQL schema, RPC/gRPC services, or a library's exported API. If there is no real external surface, say so and stop. Confirm which surface(s) + the docs location.

## Phase 1 — Reference per operation
For each endpoint/operation/export, generated from the handlers + types/schema (not memory): signature, parameters, request and response **shapes** (link the type/schema `file:line`), auth/permissions, error responses + status codes, side effects, and rate limits. Group logically; use tables for the matrix.

## Phase 2 — Make it usable
A short "how to call it" orientation (base URL/auth, versioning), one **real** example per common operation (drawn from tests or call-sites, never invented), and a Mermaid sequence diagram for any non-trivial multi-call flow.

## Assemble (per `§13`)
Exec summary (what the API does, the auth model, the entry points), then the reference. Cite `file:line`; mark inferred behavior `UNVERIFIED`; stamp the SHA.

## Done when
Every documented operation maps to a real handler/export (cited) with accurate shapes from the types/schema; auth + errors are covered; examples are real; an integrating engineer could call the API correctly from this doc alone.
