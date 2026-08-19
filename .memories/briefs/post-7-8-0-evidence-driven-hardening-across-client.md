---
id: post-7-8-0-evidence-driven-hardening-across-client
title: "Post-7.8.0: evidence-driven hardening across clients"
status: active
created: 2026-08-19T00:19:51.973Z
updated: 2026-08-19T00:19:51.973Z
tags:
  - direction
  - 7.8.0
  - windows
  - cursor
  - description-file
  - evidence-based
---

## Where Goldfish stands

7.8.0 shipped 2026-08-18: checkpoint `description_file` (long bodies skip tool-call JSON after a real Windows failure report) plus the first-class Cursor plugin from the station machine. Goldfish now targets four clients: Claude Code, Codex, Cursor (native plugin), and VS Code/Copilot (MCP + repo instructions).

## Direction

Stay in subtract-and-harden mode. Features come only from real usage reports (the TODO "From Real Usage" section is the intake queue). The Windows report → verify → `description_file` → release cycle is the template: verify the mechanism before building.

## Constraints that must survive

- Version bumps now touch **seven** surfaces — `.cursor-plugin/plugin.json` joined the list; `tests/server.test.ts` enforces sync.
- Push branch and tag separately; run `bun run check:version-tag` after tagging.
- No recurring hooks (7.0 lesson). SessionStart only, static content, on all three plugin hosts.
- Never let Goldfish delete a user file: `description_file` deliberately leaves the draft in place.

## Open watch items

- Does `description_file` actually get used on Windows? Watch for follow-up reports before adding more transport workarounds.
- Remaining From Real Usage items: skill language tuning, checkpoint frequency evaluation.
- Cursor workspace binding relies on the project `.cursor/mcp.json` fallback for writes; watch for real friction.
