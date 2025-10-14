#!/usr/bin/env bash

set -e  # Exit on error

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMMANDS_SRC="$PROJECT_ROOT/.claude/commands"
COMMANDS_DEST="$HOME/.claude/commands"

echo "Installing Goldfish slash commands..."
echo ""

# Verify source directory exists
if [ ! -d "$COMMANDS_SRC" ]; then
    echo "❌ Error: Command files not found at $COMMANDS_SRC"
    exit 1
fi

# Create destination directory if it doesn't exist
if [ ! -d "$COMMANDS_DEST" ]; then
    echo "Creating $COMMANDS_DEST..."
    mkdir -p "$COMMANDS_DEST"
fi

# Copy command files
echo "Copying commands from $COMMANDS_SRC to $COMMANDS_DEST..."
cp "$COMMANDS_SRC"/*.md "$COMMANDS_DEST/"

echo ""
echo "✅ Successfully installed Goldfish slash commands!"
echo ""
echo "The following commands are now available in all your projects:"
echo "  /checkpoint  - Save a checkpoint manually"
echo "  /recall      - Recall recent work context"
echo "  /standup     - Generate standup report across all workspaces"
echo "  /plan-status - Show active plan status"
echo ""
echo "These commands will work immediately in Claude Code."
