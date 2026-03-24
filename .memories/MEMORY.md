## Decisions and Rationale

- **Checkpoint frequency tuning (twice recalibrated):** First rewrite reduced over-checkpointing (100+/day). Second round added positive triggers back after agents stopped checkpointing entirely because "Do NOT" lists suppressed the impulse. Current balance: milestone-focused, positive framing only.
- **Three-layer structured field enforcement:** Instructions (strongest) > tool description (hints) > handler nudges (runtime feedback). Rejected making fields required at the schema level because agents hit validation errors and drop `type` entirely to avoid failures.
- **Duplicate MCP registration removed:** Deleted `.mcp.json`; plugin.json is the canonical registration path. Both registering the same server caused ~500 tokens/session of duplicate instructions.
- **Semantic search runs uncapped on first use:** Removed the 3-item/150ms budget cap. Gotcha: `setTimeout(fn, Infinity)` overflows the 32-bit int and fires immediately; `maxMs` is now optional.
- **`GOLDFISH_HOME` env var for test isolation:** `workspace.test.ts` mutating `HOME` caused `semantic-cache.test.ts` to fail in full suite runs. The env var decouples goldfish home from system HOME.
- **Consolidation lifecycle:** Fresh checkpoints (days) for session continuity, consolidated into MEMORY.md (weeks) for decisions/rationale, graduated to CLAUDE.md (months) for long-term. 30-day age filter enforces this.
- **Agent teams for parallel code review (v6.3.0):** Spawned 5 review agents (by functional area) then 4 fix agents (each owning distinct files). Avoids merge conflicts and lets agents go deep on their area. Workflow validated, worth repeating for large cross-cutting changes.

## Gotchas

- **Batch cursor bug (fixed v6.0.3):** Consolidation prompt told the subagent to write "now" as `.last-consolidated` timestamp. When processing batches of 50, this jumped past remaining checkpoints. Fixed to use last batch checkpoint's timestamp.
- **`readManifest` stripping fields:** Round-tripping through `readManifest` was dropping `workspacePath` from semantic manifests. Found during v5.9.0 spec review.
- **Parameter aliasing matters:** Copilot users passed `planId` but handler expected `id`, causing silent failures. The v6.3.0 fix added aliases, but watch for this pattern in any new tool parameters.

## Deferred Work

- Checkpoint metadata aliases, handler `args:any` typing, hook script tests (low priority, monitor for user reports).

## Recurring Anti-Pattern

Across five iterations (original Goldfish, Tusk, .NET, 4.0, 5.x) and the Miller all-in-one attempt, the failure mode is always the same: trying to unify code intelligence + memory + semantics into one surface creates reliability and identity conflicts. Keep Goldfish as deterministic memory system-of-record; make semantics optional/pluggable.
