---
id: reduce-goldfish-tool-overuse
title: Reduce Goldfish Tool Overuse
status: active
created: 2026-02-28T23:44:19.798Z
updated: 2026-02-28T23:44:19.798Z
tags:
  - refactor
  - behavioral-language
  - tool-overuse
---

# Reduce Goldfish Tool Overuse: Fewer Checkpoints, User-Initiated Recall

## Changes
1. Remove SessionStart hook (keep PreCompact + ExitPlanMode)
2. Rewrite tools.ts checkpoint + recall descriptions (drop MANDATORY, add anti-patterns)
3. Rewrite instructions.ts (milestone focus, anti-patterns)
4. Update skills/recall (user-initiated)
5. Update skills/checkpoint (tighter frequency, anti-patterns)
6. Filter .memories/ from git file lists + cap at 30
7. Update server test assertions
8. Update docs (CLAUDE.md, CONTRIBUTING.md, IMPLEMENTATION.md)
