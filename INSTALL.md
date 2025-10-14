# Goldfish Installation Guide

## For Claude Code

### Step 1: Install Goldfish

```bash
# Clone the repository
git clone git@github.com:anortham/goldfish.git
cd goldfish

# Install dependencies
bun install

# Verify installation
bun test
```

All 106 tests should pass.

### Step 2: Configure Claude Code

Edit `~/.claude/settings.json` and add the goldfish MCP server:

```json
{
  "mcpServers": {
    "goldfish": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/goldfish/src/server.ts"]
    }
  }
}
```

**Important:** Replace `/absolute/path/to/goldfish` with the actual path where you cloned goldfish.

### Step 3: Restart Claude Code

Quit and restart Claude Code completely.

### Step 4: Verify Installation

Start a new chat in Claude Code and try:

```
Use recall() to check for any previous context
```

You should see Claude use the recall tool. Even if there's no previous context, the tool should work without errors.

## Testing the Installation

### Test 1: Checkpoint

In Claude Code, say:

```
Save a checkpoint: "Testing goldfish installation"
```

Claude should use the `checkpoint` tool and confirm the checkpoint was saved.

### Test 2: Recall

Say:

```
What context do you have from previous sessions?
```

Claude should call `recall()` and show your test checkpoint.

### Test 3: Plan

Say:

```
Create a plan for testing goldfish features
```

Claude should create and save a plan using the `plan` tool.

### Test 4: Cross-workspace

Navigate to a different directory and repeat the tests. Goldfish should automatically detect the new workspace and keep data separate.

## Storage Location

Goldfish stores data in:

```
~/.goldfish/
  {workspace}/
    checkpoints/
      2025-10-13.md
    plans/
      test-plan.md
    .active-plan
```

You can view your data anytime with:

```bash
ls -la ~/.goldfish/
cat ~/.goldfish/{workspace}/checkpoints/$(date +%Y-%m-%d).md
```

## Slash Commands (Optional)

You can also use slash commands directly:

- `/checkpoint [description]` - Manual checkpoint
- `/recall [search]` - Recall with optional search
- `/standup [days]` - Generate standup report
- `/plan-status` - Show active plan

To enable these, copy the plugin files:

```bash
cp -r plugin/.claude ~/.claude/goldfish-commands
```

## Troubleshooting

### Server Won't Start

Check if bun is installed:

```bash
bun --version
```

### Tools Not Appearing

1. Check `~/.claude/settings.json` for syntax errors
2. Verify the path to `server.ts` is absolute
3. Restart Claude Code completely (quit, don't just close window)
4. Check Claude Code logs for errors

### Data Not Persisting

Check if `~/.goldfish/` directory was created:

```bash
ls -la ~/.goldfish/
```

If it doesn't exist, try running the server manually:

```bash
cd /path/to/goldfish
bun run src/server.ts
```

Then test with MCP inspector:

```bash
npx @modelcontextprotocol/inspector bun run src/server.ts
```

## Uninstallation

1. Remove from `~/.claude/settings.json`
2. Delete goldfish directory
3. (Optional) Delete data: `rm -rf ~/.goldfish/`

## Getting Help

- GitHub Issues: https://github.com/anortham/goldfish/issues
- Review `CLAUDE.md` for development details
- Check `docs/IMPLEMENTATION.md` for technical details
