---
id: memory-schema-upgrade-for-decision-recall
title: Memory Schema Upgrade for Decision Recall
status: active
created: 2026-02-25T02:00:16.719Z
updated: 2026-02-25T02:00:16.719Z
tags:
  - memory-schema
  - recall-quality
  - backward-compatible
---

## Goal
Increase memory usefulness for codebase understanding by capturing structured decision metadata while remaining backward-compatible with existing checkpoints.

## Scope
- Add optional structured fields to checkpoint schema
- Persist/parse new fields in YAML frontmatter
- Improve fuzzy recall relevance using structured fields
- Expose new schema in checkpoint tool input
- Validate confidence input range
- Add tests for serialization, parsing, recall search, handlers, and tool schema

## Tasks
- [x] Add optional structured fields to `Checkpoint` and `CheckpointInput`
- [x] Serialize/parse structured fields in `src/checkpoints.ts`
- [x] Include structured fields in checkpoint save flow
- [x] Add confidence validation in checkpoint handler
- [x] Extend recall search keys with structured fields
- [x] Show key structured fields in recall handler output
- [x] Expose structured fields in `checkpoint` tool schema
- [x] Add test coverage for all new behaviors

## Backward Compatibility
Existing memories are unchanged. New fields are optional and only appear when provided in new checkpoints.

## Follow-up
- Add a memory quality linter to warn when high-value fields are missing on decision/incident checkpoints
- Consider field-weight tuning based on real query evals
