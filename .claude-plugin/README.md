# Goldfish Memory Plugin

Persistent memory system for AI agents that survives context resets, crashes, and time away from your projects.

## Features

### 🧠 Automatic Memory Skills
- **session-memory** - Auto-restores context at session start (MANDATORY)
- **progress-tracking** - Proactively checkpoints work at key moments

### ⚡ Quick Commands
- `/standup [days]` - Cross-workspace activity report
- `/recall [search]` - Search your memory with fuzzy matching
- `/plans` - View and manage long-term plans

### 🔧 MCP Tools (Used by Skills)
- `checkpoint` - Save work progress
- `recall` - Restore session context
- `plan` - Manage strategic work

## Installation

### Via Plugin Marketplace (Recommended)
```
/plugin install goldfish-memory@your-marketplace
```

### Manual Installation
1. Clone or copy the goldfish directory to your projects
2. Add to `.claude/settings.json`:
```json
{
  "plugins": ["path/to/goldfish/.claude-plugin"]
}
```
3. Restart Claude Code

## Quick Start

### Session Start (Automatic)
The `session-memory` skill activates automatically:
```
→ Claude: "Welcome back! You were working on JWT authentication
          in the feature/auth branch. Last checkpoint:
          'Fixed token expiration bug'. Resume work?"
```

### During Work (Automatic)
The `progress-tracking` skill checkpoints automatically:
```
[You fix a bug and tests pass]
→ Claude: "All tests green! ✅"
   [Automatically checkpoints: "Fixed JWT expiration bug with test coverage"]
```

### Manual Commands
```bash
# Yesterday's standup
/standup

# Search for specific work
/recall authentication

# View your plans
/plans
```

## How It Works

### Storage Location
```
~/.goldfish/
  {workspace}/
    checkpoints/2025-11-01.md    # Daily checkpoint files
    plans/auth-system.md         # Individual plans
    .active-plan                 # Current focus
```

### Data Format
All data is **human-readable markdown**:

```markdown
## 14:30:00 - Fixed JWT authentication timeout

**Tags:** bug-fix, auth, critical
**Branch:** feature/auth
**Files:** src/auth/jwt.ts

Implemented refresh token rotation.
```

### Git-Friendly
- Plain text, perfect for version control
- No binary databases
- Edit manually if needed
- Portable across machines

## Skill Behavior

### session-memory Skill
**Activates:** Session start, context reset, "what was I doing?"

**Behavior:**
1. Calls `recall({ days: 7, limit: 20 })`
2. Analyzes checkpoints + active plans
3. Presents concise summary (2-3 sentences)
4. Suggests next steps

**Does NOT ask permission** - Just restores context automatically.

### progress-tracking Skill
**Activates:** Task completion, bug fixes, discoveries, milestones

**Checkpoints automatically when:**
- Tests pass
- Bug fixed
- Feature implemented
- Important discovery made
- Before risky changes

**Does NOT ask permission** - Checkpoints proactively.

## Command Usage

### /standup [days]
Cross-workspace activity report:
```bash
/standup      # Yesterday (default)
/standup 7    # Last week
```

Output:
```
📊 Standup Report - Last 1 day

🎯 goldfish (4 checkpoints)
  ✅ Implemented atomic file operations
  ✅ Added cross-workspace recall
  📋 Active: "Goldfish 4.0 Release"

🎯 julie (3 checkpoints)
  ✅ Fixed UTF-8 handling
  ...
```

### /recall [search] [flags]
Search memory:
```bash
/recall authentication           # Fuzzy search
/recall 14                       # Last 14 days
/recall --all redis              # All workspaces
/recall bug fix                  # Multiple terms
```

### /plans [action] [id]
Manage plans:
```bash
/plans                           # List all
/plans auth-redesign             # View specific
/plans activate payment-system   # Set active
/plans complete goldfish-release # Mark done
```

## Performance

- Checkpoint save: ~10ms
- Recall (7 days): ~30-150ms
- Search (100 checkpoints): ~15ms
- Instant at session start

## Philosophy

**Radical Simplicity**
- Markdown files, no database
- Human-readable, git-friendly
- Survives anything (crashes, resets, time)

**Proactive, Not Reactive**
- Skills act automatically
- No permission requests
- Builds memory naturally

**Transparent Storage**
- Edit with any text editor
- Grep-able, searchable
- No lock-in, portable

## Troubleshooting

### Memory not restoring
- Ensure session-memory skill is enabled
- Check `~/.goldfish/{workspace}/` exists
- Verify recall tool works: Call it manually

### Checkpoints not saving
- Check workspace has write permissions
- Verify Goldfish MCP server is running
- Test checkpoint manually

### Cross-workspace recall slow
- Normal for many workspaces (parallelized)
- Reduce days: `/standup 1` instead of `/standup 30`

## Requirements

- **Runtime:** Bun 1.0+
- **MCP SDK:** ^1.0.4
- **Claude Code:** Latest version

## License

MIT - See LICENSE file in the goldfish directory
