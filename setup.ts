#!/usr/bin/env bun
/**
 * Goldfish Setup Script
 *
 * Initializes Goldfish and installs slash commands to ~/.claude/commands/
 * Ensures users always have the latest command definitions.
 */

import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

const CLAUDE_HOME = path.join(os.homedir(), ".claude");
const COMMANDS_DIR = path.join(CLAUDE_HOME, "commands");
const SOURCE_COMMANDS = path.join(MODULE_DIR, ".claude", "commands");
const GOLDFISH_HOME = path.join(os.homedir(), ".goldfish");

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copyCommands(force = false) {
  const sourceFiles = await fs.readdir(SOURCE_COMMANDS);
  const commandFiles = sourceFiles.filter(f => f.endsWith('.md'));

  let copied = 0;
  let skipped = 0;

  for (const file of commandFiles) {
    const sourcePath = path.join(SOURCE_COMMANDS, file);
    const destPath = path.join(COMMANDS_DIR, file);

    if (!force && await fileExists(destPath)) {
      console.log(`⏭️  Skipping ${file} (already exists)`);
      skipped++;
    } else {
      await fs.copyFile(sourcePath, destPath);
      console.log(`📋 Copied ${file}`);
      copied++;
    }
  }

  return { copied, skipped };
}

async function verifyInstallation(): Promise<boolean> {
  try {
    // Check if goldfish home exists
    const goldfishExists = await fileExists(GOLDFISH_HOME);

    // Check if commands were installed
    const commandsExist = await fileExists(COMMANDS_DIR);
    if (!commandsExist) return false;

    const commandFiles = await fs.readdir(COMMANDS_DIR);
    const goldfishCommands = ['checkpoint.md', 'recall.md', 'standup.md', 'plan-status.md'];
    const hasCommands = goldfishCommands.some(cmd => commandFiles.includes(cmd));

    return hasCommands;
  } catch {
    return false;
  }
}

async function setup(options: { force?: boolean } = {}) {
  console.log("🐠 Setting up Goldfish...\n");

  try {
    // Create directory structure
    console.log(`📁 Creating directory structure`);
    await fs.mkdir(COMMANDS_DIR, { recursive: true });
    await fs.mkdir(GOLDFISH_HOME, { recursive: true });

    // Copy slash commands
    console.log("\n📋 Installing slash commands:");
    const { copied, skipped } = await copyCommands(options.force);

    // Success message
    console.log(`\n✅ Setup complete!`);
    console.log(`   • ${copied} command${copied !== 1 ? 's' : ''} installed`);
    if (skipped > 0) {
      console.log(`   • ${skipped} existing command${skipped !== 1 ? 's' : ''} preserved`);
    }

    console.log(`\n📍 Your Goldfish files are located at:`);
    console.log(`   Commands: ${COMMANDS_DIR}`);
    console.log(`   Storage:  ${GOLDFISH_HOME}`);

    console.log(`\n🔧 Next steps:`);
    console.log(`   1. Add Goldfish to your Claude Code config (~/.claude/settings.json):`);
    console.log(`      {`);
    console.log(`        "mcpServers": {`);
    console.log(`          "goldfish": {`);
    console.log(`            "command": "bun",`);
    console.log(`            "args": ["run", "${path.join(MODULE_DIR, "src", "server.ts")}"]`);
    console.log(`          }`);
    console.log(`        }`);
    console.log(`      }`);
    console.log(`   2. Restart Claude Code`);
    console.log(`   3. Try the new commands:`);
    console.log(`      • /recall          - Basic recall`);
    console.log(`      • /recall 2h       - Last 2 hours`);
    console.log(`      • /recall smart auth bugs - Semantic search + distillation (NEW!)`);
    console.log(`      • /standup         - Cross-workspace standup`);
    console.log(`      • /checkpoint      - Manual checkpoint`);

    if (skipped > 0 && !options.force) {
      console.log(`\n💡 To overwrite existing commands, run: bun run setup --force`);
    }

    // Verify installation
    console.log("\n🔍 Verifying installation...");
    const isValid = await verifyInstallation();

    if (isValid) {
      console.log("✅ Installation verified successfully!");
      console.log("   • Directory structure created");
      console.log("   • Slash commands installed");
    } else {
      console.log("⚠️  Installation verification failed");
      console.log("   Please try running setup again or check file permissions");
    }

  } catch (error) {
    console.error("❌ Setup failed:", error);
    process.exit(1);
  }
}

async function status() {
  console.log("🐠 Goldfish Status\n");

  const exists = await fileExists(GOLDFISH_HOME);
  console.log(`Storage: ${GOLDFISH_HOME}`);
  console.log(`Status: ${exists ? '✅ Exists' : '❌ Not found'}`);

  const commandsExist = await fileExists(COMMANDS_DIR);
  console.log(`\nCommands: ${COMMANDS_DIR}`);
  console.log(`Status: ${commandsExist ? '✅ Exists' : '❌ Not found'}`);

  if (exists) {
    try {
      const workspaces = await fs.readdir(GOLDFISH_HOME);
      const realWorkspaces = workspaces.filter(w => !w.startsWith('.'));

      console.log(`\nWorkspaces (${realWorkspaces.length}):`);
      for (const workspace of realWorkspaces.slice(0, 5)) {
        console.log(`  📦 ${workspace}`);

        // Count checkpoints
        const checkpointsDir = path.join(GOLDFISH_HOME, workspace, 'checkpoints');
        if (await fileExists(checkpointsDir)) {
          const files = await fs.readdir(checkpointsDir);
          console.log(`     ${files.length} checkpoint file${files.length !== 1 ? 's' : ''}`);
        }
      }
      if (realWorkspaces.length > 5) {
        console.log(`  ... and ${realWorkspaces.length - 5} more`);
      }
    } catch (error) {
      console.log(`\n⚠️  Error reading contents: ${error}`);
    }
  } else {
    console.log("\nRun 'bun run setup' to initialize Goldfish");
  }

  if (commandsExist) {
    try {
      const commands = await fs.readdir(COMMANDS_DIR);
      const mdFiles = commands.filter(f => f.endsWith('.md'));
      console.log(`\nInstalled Commands (${mdFiles.length}):`);
      for (const file of mdFiles) {
        console.log(`  📋 ${file.replace('.md', '')}`);
      }
    } catch (error) {
      console.log(`\n⚠️  Error reading commands: ${error}`);
    }
  }
}

async function reset() {
  console.log("🔄 Resetting Goldfish slash commands to defaults...\n");

  if (await fileExists(COMMANDS_DIR)) {
    console.log("🗑️  Removing existing Goldfish commands");
    const commands = await fs.readdir(COMMANDS_DIR);
    const goldfishCommands = ['checkpoint.md', 'recall.md', 'standup.md', 'plan-status.md'];

    for (const cmd of goldfishCommands) {
      if (commands.includes(cmd)) {
        await fs.unlink(path.join(COMMANDS_DIR, cmd));
        console.log(`   Removed ${cmd}`);
      }
    }
  }

  await setup({ force: true });
}

// Parse command line arguments
const args = process.argv.slice(2);
const command = args[0];
const hasForceFlag = args.includes('--force');

async function main() {
  switch (command) {
    case 'reset':
      await reset();
      break;
    case 'status':
      await status();
      break;
    case 'help':
      console.log("🐠 Goldfish Setup\n");
      console.log("Commands:");
      console.log("  setup [--force]  Initialize Goldfish and install slash commands (default)");
      console.log("  reset           Remove and reinstall all slash commands");
      console.log("  status          Show current Goldfish installation status");
      console.log("  help            Show this help message");
      break;
    default:
      await setup({ force: hasForceFlag });
  }
}

main().catch(console.error);
