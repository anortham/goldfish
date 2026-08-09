---
id: mcp-sdk-v2-stateless-migration
title: MCP SDK v2 stateless migration
status: completed
created: 2026-08-08T21:41:50.085Z
updated: 2026-08-09T01:43:05.646Z
tags:
  - mcp
  - sdk-v2
  - stateless
  - migration
  - complete
  - verification
---

## Goal

Migrate Goldfish to MCP TypeScript SDK v2 while preserving legacy clients and supporting modern stateless stdio clients.

## Outcome

- Migrated to the split `@modelcontextprotocol/server` and `@modelcontextprotocol/client` v2 packages.
- One stdio command serves legacy 2025-era and modern 2026-07-28 clients.
- Legacy roots discovery remains available; modern clients use explicit `workspace`, `GOLDFISH_WORKSPACE`, or cwd recovery.
- Added spawned modern and legacy protocol compatibility coverage.
- Prepared and merged version 7.7.0 documentation and metadata.

## Verification

The implementation branch passed the full Bun suite (627 tests), typecheck, version-surface checks, and whitespace checks. The remaining release actions are the annotated tag, separate main/tag pushes, and GitHub release publication.
