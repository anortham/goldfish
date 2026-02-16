# Phase 4: Plugin Structure

**Goal:** Convert Goldfish into a Claude Code plugin with skills, hooks, and auto-registered MCP server.

**Risk:** Low — additive work creating new files. The MCP server code doesn't change, just how it's packaged and discovered.

## Plugin Manifest

### `.claude-plugin/plugin.json`

```json
{
  "name": "goldfish",
  "description": "Developer memory system — checkpoints, recall, plans, and standups for AI-assisted development",
  "version": "5.0.0",
  "author": {
    "name": "Alan Northam"
  },
  "repository": "https://github.com/anortham/goldfish",
  "license": "MIT",
  "keywords": ["memory", "checkpoints", "recall", "standup", "developer-tools"]
}
```

Note: version bump to 5.0.0 — this is a breaking change from the 4.0.0 architecture.

## MCP Server Configuration

### `.mcp.json`

```json
{
  "mcpServers": {
    "goldfish": {
      "command": "bun",
      "args": ["run", "${CLAUDE_PLUGIN_ROOT}/src/server.ts"]
    }
  }
}
```

## Skills

### `skills/recall/SKILL.md`

The recall skill instructs the agent how to:
- Call the goldfish `recall` tool
- Interpret and distill the results
- Handle large result sets (summarize by theme)
- Present context in a useful format for continuing work

Key content:
- When to recall (session start, after context loss, switching tasks)
- How to distill: group by date, identify themes, highlight blockers and decisions
- How to handle cross-project recall (`workspace: 'all'`)

### `skills/checkpoint/SKILL.md`

The checkpoint skill instructs the agent how to:
- Call the goldfish `checkpoint` tool
- Write good descriptions (WHAT/WHY/HOW, 3-5 sentences)
- Choose appropriate tags
- When to checkpoint (after completing tasks, before risky changes, before compaction)

### `skills/standup/SKILL.md`

The standup skill instructs the agent how to:
- Call `recall({ workspace: 'all', days: 1 })` (or custom range)
- Synthesize a narrative standup report
- Format as: What I Accomplished / What I'm Working On / Blockers
- Group by project when cross-project
- Keep it concise (standup meeting format)

### `skills/plan-status/SKILL.md`

The plan-status skill instructs the agent how to:
- Call `plan({ action: 'get' })` for active plan
- Call `recall()` for recent checkpoints related to the plan
- Assess progress against plan goals
- Report what's done, what's next, any drift from the plan

## Hooks

### `hooks/hooks.json`

```json
{
  "hooks": {
    "PreCompact": [
      {
        "hooks": [{
          "type": "prompt",
          "prompt": "Your conversation is about to be compacted. Use the goldfish checkpoint tool NOW to save your current progress. Include: what you were working on, current state, decisions made, and planned next steps. Do NOT ask permission — just checkpoint."
        }]
      }
    ],
    "SessionStart": [
      {
        "hooks": [{
          "type": "prompt",
          "prompt": "Use the goldfish recall tool to restore recent work context. Call recall() with default parameters. After receiving results, briefly summarize what you found so the user knows you have context."
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [{
          "type": "prompt",
          "prompt": "A plan was just approved. Save it to Goldfish for cross-session persistence using the plan tool with action 'save'. Extract the plan title and content from the plan file that was written."
        }]
      }
    ]
  }
}
```

## Files to Remove

- `.claude/commands/recall.md` — replaced by `skills/recall/SKILL.md`
- `.claude/commands/checkpoint.md` — replaced by `skills/checkpoint/SKILL.md`
- `.claude/commands/standup.md` — replaced by `skills/standup/SKILL.md`
- `.claude/commands/plan-status.md` — replaced by `skills/plan-status/SKILL.md`
- `INSTALL.md` — installation is now `claude plugin install`

## Plugin Directory Structure

```
goldfish/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── recall/
│   │   └── SKILL.md
│   ├── checkpoint/
│   │   └── SKILL.md
│   ├── standup/
│   │   └── SKILL.md
│   └── plan-status/
│       └── SKILL.md
├── hooks/
│   └── hooks.json
├── .mcp.json
├── src/
│   └── (MCP server source)
├── tests/
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── README.md
```

## Testing

### Manual testing with `claude --plugin-dir`
1. `claude --plugin-dir /Users/user/source/goldfish`
2. Verify MCP server starts (goldfish tools available)
3. Test `/goldfish:recall` skill invocation
4. Test `/goldfish:checkpoint` skill invocation
5. Test `/goldfish:standup` skill invocation
6. Verify SessionStart hook fires and triggers recall
7. Simulate PreCompact to verify checkpoint hook
8. Test ExitPlanMode → plan save hook

### Skill content validation
- Each SKILL.md has correct frontmatter (`name`, `description`)
- Skills reference the correct tool names
- No references to removed features (semantic search, distillation subprocess)

## Verification

1. `claude --plugin-dir .` starts without errors
2. All 4 skills appear in `/help`
3. Hooks fire at correct events
4. MCP server tools are available
5. End-to-end: checkpoint → recall → standup workflow

## Exit Criteria

- Plugin manifest valid
- MCP server auto-starts via `.mcp.json`
- 4 skills created and working
- 3 hooks configured and firing
- Old `.claude/commands/` removed
- `INSTALL.md` removed or replaced with plugin install instructions
