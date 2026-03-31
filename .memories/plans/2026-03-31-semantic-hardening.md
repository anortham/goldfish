---
id: 2026-03-31-semantic-hardening
title: Semantic hardening
status: active
created: 2026-03-31T21:36:49.982Z
updated: 2026-03-31T21:36:49.982Z
tags:
  - semantic
  - hardening
  - recall
  - embeddings
---

# Semantic hardening

## Goal
Make semantic recall opportunistic and bounded so search always returns lexical results, broken derived cache state self-recovers, and embedder aborts do not break queue serialization.

## Spec and Plan
- Spec: `docs/superpowers/specs/2026-03-31-semantic-hardening-design.md`
- Plan: `docs/superpowers/plans/2026-03-31-semantic-hardening.md`

## Scope
- Add timeout-backed query embedding fallback in `src/recall.ts`
- Bound search-triggered semantic maintenance by item/time budgets
- Normalize or reset broken semantic cache state in `src/semantic-cache.ts`
- Make prune acquire the semantic cache lock before deletion
- Tighten cold-start abort and queue behavior in `src/transformers-embedder.ts`
- Update `docs/IMPLEMENTATION.md` to match the new behavior

## Execution Notes
- TDD only: every behavior starts with a failing test
- Keep the current derived-cache format, no background indexing system
- Use targeted commits per task from the implementation plan
- Verify with the semantic test slice, then `bun test`

