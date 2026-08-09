---
id: mcp-sdk-v2-stateless-migration
title: MCP SDK v2 stateless migration
status: active
created: 2026-08-08T21:41:50.085Z
updated: 2026-08-09T01:09:31.010Z
tags:
  - mcp
  - sdk-v2
  - stateless
  - migration
  - complete
  - verification
---

## Goal

Migrate Goldfish from `@modelcontextprotocol/sdk` v1 to the split MCP SDK v2 packages and support both legacy and modern stateless stdio clients.

## Approved direction

- Preserve one Goldfish server factory and one tool surface.
- Execute the migration in three serialized TDD commits: v2 legacy baseline, modern stdio compatibility, then docs/version metadata.
- Keep legacy roots discovery; modern requests require `workspace` or `GOLDFISH_WORKSPACE` until modern roots MRTR is designed separately.
- Prove modern behavior with a spawned, protocol-pinned stdio client because v2 in-memory transport is legacy-only.
- Prepare version 7.7.0, but do not tag, push, publish, or release without later approval.

## Constraints

Implementation is complete in `/home/murphy/source/goldfish/.worktrees/mcp-sdk-v2-stateless-migration` on branch `mcp-sdk-v2-stateless-migration`. The original planning checkout remains separate and untouched by implementation. No push, tag, publish, deploy, or release action has been authorized. Do not broaden the migration into modern roots MRTR.

## References

- `docs/plans/2026-08-08-mcp-sdk-v2-stateless-migration-design.md`
- `docs/plans/2026-08-08-mcp-sdk-v2-stateless-migration-plan.md`

## Success

Legacy clients retain current behavior, modern stateless clients work over stdio, roots are never requested for modern calls, explicit workspace precedence is preserved, and all repository gates pass.

## Status

Implementation complete and locally verified. Awaiting separate user direction for integration and release handling.
