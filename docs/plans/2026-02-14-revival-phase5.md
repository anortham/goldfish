# Phase 5: Update Docs & Clean Up

**Goal:** Update all documentation to reflect the new architecture. Remove stale references. Ensure a new contributor (human or AI) can understand the project.

**Risk:** None — documentation only.

## Files to Update

### `CLAUDE.md` (project instructions for AI agents)

Major updates needed:
- **Architecture Overview:** Update storage section — `.memories/` not `~/.goldfish/`
- **Core Modules table:** Remove store, embeddings, distill, database, sync, storage modules. Add registry.
- **Key Types:** Update `Checkpoint` type (add `id`, restructure git as nested object). Remove `SearchResult`, `DistillResult`. Remove semantic/distill from `RecallOptions`.
- **Storage structure:** Update to show `.memories/` with per-file checkpoints
- **Tech Stack:** Remove heavyweight deps. List only 3 runtime deps.
- **Test count:** Update to reflect actual count after removal
- **Line counts:** Update module sizes
- **Plugin context:** Mention this is a Claude Code plugin
- **Remove references to:** embeddings, semantic search, distillation, store tool, Julie integration phases, sqlite-vec, hnswlib, onnxruntime, @xenova/transformers

### `README.md` (user-facing documentation)

Major rewrite:
- **Installation:** Plugin install instead of manual MCP config
- **Tools:** 3 tools (checkpoint, recall, plan) not 4
- **Skills:** Document the 4 skills (recall, checkpoint, standup, plan-status)
- **Hooks:** Document automatic behaviors (PreCompact, SessionStart, ExitPlanMode)
- **Storage:** Explain project-level `.memories/` and cross-project registry
- **Remove:** RAG/semantic search section, distillation section, store tool section
- **Add:** Plugin development/testing section

### `CONTRIBUTING.md` (developer guide)

Updates:
- **Architecture quick reference:** Updated module list
- **Directory structure:** Reflect plugin layout
- **Dependencies:** 3 runtime deps only
- **Remove references to:** embeddings, store, distillation

### `docs/IMPLEMENTATION.md` (technical specification)

Major rewrite:
- **Data format:** New YAML frontmatter checkpoint format
- **Storage architecture:** Project-level `.memories/`, registry at `~/.goldfish/`
- **Module descriptions:** Updated for current code
- **Phase descriptions:** Replace old phases with current architecture

### `TODO.md`

Replace entirely — the old TODO was about the Julie separation. New TODO should reflect:
- What's done (the revival)
- What's next (real-world usage feedback, potential future features)
- Open questions (hook tuning, skill refinement based on usage)

### `AGENTS.md`

Update pointer to reflect plugin structure.

### `package.json`

- Update `description`
- Update `version` to 5.0.0
- Remove stale scripts (`migrate`, `migrate:all`, `setup`)
- Verify `main`/entry point is correct for MCP server

## Files to Remove

- `INSTALL.md` — replaced by plugin install
- Any lingering references to Windows paths (`c:\source\`) in docs

## Verification

1. Read each doc file — no references to removed features
2. New contributor could follow CLAUDE.md to understand the project
3. README.md accurately describes how to install and use
4. CONTRIBUTING.md accurately describes how to develop
5. Module table in CLAUDE.md matches actual src/ files
6. Test count in CLAUDE.md matches `bun test` output

## Exit Criteria

- All docs accurate and consistent
- No references to embeddings, distillation, store tool, Julie integration
- README has plugin installation instructions
- CLAUDE.md has correct module table and line counts
- TODO.md reflects current state
- Version bumped to 5.0.0 across package.json and plugin.json
