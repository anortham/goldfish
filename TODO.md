# Goldfish -- Backlog

## Consolidation Tuning (Needs Real Usage Data)
- [ ] Tune consolidation subagent prompt based on real output quality
- [ ] Monitor semantic search quality with memory sections in the index
- [ ] Evaluate consolidation frequency (too aggressive? too lazy?)

## From Real Usage
- [ ] Tune hook prompts based on actual agent behavior
- [ ] Tune skill language based on session observations
- [ ] Evaluate checkpoint frequency in practice (too many? too few?)

## Potential Future Features (Evidence Required)
- [ ] Checkpoint pruning/archival (consolidation reduces urgency since memory.yaml captures the essence)
- [ ] Plan templates (if pattern emerges from usage)
- [ ] Checkpoint export/reporting (memory.yaml summaries in cross-project recall may solve this)
- [ ] Tiered temporal rollups: daily -> weekly -> monthly summaries (if single memory.yaml proves insufficient for long-lived projects)

## Open Questions
- Is the PreCompact hook reliable enough? Does Claude actually checkpoint before compaction?
- Does the SessionStart hook fire consistently? Any startup delay issues?
- Is the ExitPlanMode -> plan save hook working as expected?
- Should skills be more or less prescriptive?

## Low Priority (No Evidence of Impact)
- [ ] Checkpoint handler: optional metadata aliases (`next` vs `next_steps`, `symbols` vs `affected_symbols`)
- [ ] No tests for hook scripts (hooks have non-trivial logic but are standalone scripts)
