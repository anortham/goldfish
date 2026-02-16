# Goldfish v5.0.0 — Status

## Done (Revival Complete)

- [x] Phase 1: Strip dead code (embeddings, distillation, store tool)
- [x] Phase 2: New checkpoint format (YAML frontmatter, individual files, .memories/)
- [x] Phase 3: Cross-project registry (~/.goldfish/registry.json)
- [x] Phase 4: Claude Code plugin structure (skills, hooks, .mcp.json)
- [x] Phase 5: Documentation update

## What's Next

### From Real Usage
- [ ] Tune hook prompts based on actual agent behavior
- [ ] Tune skill language based on session observations
- [ ] Evaluate checkpoint frequency in practice (too many? too few?)

### Potential Future Features (Evidence Required)
- [ ] Checkpoint pruning/archival (if .memories/ grows too large)
- [ ] Plan templates (if pattern emerges from usage)
- [ ] Checkpoint export/reporting (if standups aren't enough)
- [ ] Migration tool for v4 → v5 checkpoint format

### Open Questions
- Is the PreCompact hook reliable enough? Does Claude actually checkpoint before compaction?
- Does the SessionStart hook fire consistently? Any startup delay issues?
- Is the ExitPlanMode → plan save hook working as expected?
- Should skills be more or less prescriptive? 
- JSON output from the tools makes no sense. We are burning extra tokens. We need readable output.
