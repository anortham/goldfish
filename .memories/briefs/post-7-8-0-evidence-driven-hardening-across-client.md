---
id: post-7-8-0-evidence-driven-hardening-across-client
title: Fail-closed workspace identity across MCP clients
status: completed
created: 2026-08-19T00:19:51.973Z
updated: 2026-08-31T01:04:28.120Z
tags:
  - direction
  - workspace-binding
  - mcp-2
  - stateless
  - codex
  - cursor
---

## Goal

End the recurring Codex and Cursor workspace-binding failures by making project identity explicit and fail-closed.

## Why now

A live Codex plugin call resolved Goldfish's own plugin cache as the project. Six months of cwd, Roots, registry, and parent-walk recovery have not produced a safe cross-client default. MCP 2026-07-28 removes protocol sessions and deprecates Roots, so hidden activation state is not a durable answer.

## Direction

For user-level MCP registrations, every workspace-scoped call must carry an explicit absolute workspace path unless a fixed `GOLDFISH_WORKSPACE` or supported legacy Roots response supplies it. Cwd and registry data may suggest candidates in errors but must never authorize reads or writes. Do not add `activate_workspace` server-local state.

## Constraints

- Preserve project-level `GOLDFISH_WORKSPACE` convenience.
- Preserve `recall({ workspace: "all" })`.
- Keep legacy Roots only as a compatibility input during its support window.
- Reject relative paths and `workspace: "current"` when no trusted binding exists.
- Remove obsolete recovery behavior rather than leave a path that can silently return.
- TDD is mandatory. User data must never land in a plugin cache or unrelated repository.

## Success criteria

Codex and Cursor user-level calls without explicit identity fail with actionable guidance. Explicit workspace calls work across checkpoint, recall, and brief. Modern stateless calls do not depend on session state.

## Reference

- `docs/plans/2026-08-30-fail-closed-workspace-identity-design.md`
