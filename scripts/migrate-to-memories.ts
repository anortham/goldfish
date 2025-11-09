#!/usr/bin/env bun

/**
 * Migration script to convert old markdown checkpoints to new JSONL memories
 *
 * Usage:
 *   bun run scripts/migrate-to-memories.ts [workspace] [target-dir]
 *
 * Examples:
 *   bun run scripts/migrate-to-memories.ts goldfish ./
 *   bun run scripts/migrate-to-memories.ts goldfish ./ --dry-run
 *
 * This reads checkpoints from ~/.goldfish/{workspace}/checkpoints/*.md
 * and writes them to {target-dir}/.goldfish/memories/*.jsonl
 */

import { readdir, readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { getWorkspacePath } from '../src/workspace';
import { parseCheckpointFile } from '../src/checkpoints';
import { appendJsonl } from '../src/storage/jsonl';
import type { Checkpoint } from '../src/types';
import type { Memory, MemoryType, MemorySource } from '../src/storage/types';

/**
 * Migration options
 */
export interface MigrateCheckpointsOptions {
  workspace: string;        // Source workspace name
  targetDir: string;        // Target directory for .goldfish/memories/
  dryRun?: boolean;         // Preview without writing
  goldfishBase?: string;    // Custom goldfish base path (for testing)
}

/**
 * Migration result
 */
export interface MigrationResult {
  checkpointsRead: number;      // Total checkpoints read from markdown
  memoriesWritten: number;      // Total memories written to JSONL
  filesCreated: string[];       // List of JSONL files created
  skipped: number;              // Checkpoints skipped (invalid/empty)
  errors: string[];             // Any errors encountered
}

/**
 * Converts a checkpoint to a memory object
 *
 * Maps checkpoint fields to memory fields:
 * - description → content
 * - timestamp → timestamp
 * - tags → tags
 *
 * Memory type is inferred from checkpoint tags or description:
 * - bug-fix, fix → bug-fix
 * - feature, feat → feature
 * - refactor → refactor
 * - decision, architecture → decision
 * - insight, learning → insight
 * - default → observation
 *
 * Source is set to 'agent' (most checkpoints are agent-generated)
 */
export function checkpointToMemory(checkpoint: Checkpoint): Memory {
  // Infer memory type from tags
  let type: MemoryType = 'observation'; // default

  if (checkpoint.tags) {
    if (checkpoint.tags.includes('bug-fix') || checkpoint.tags.includes('fix')) {
      type = 'bug-fix';
    } else if (checkpoint.tags.includes('feature') || checkpoint.tags.includes('feat')) {
      type = 'feature';
    } else if (checkpoint.tags.includes('refactor')) {
      type = 'refactor';
    } else if (checkpoint.tags.includes('decision') || checkpoint.tags.includes('architecture')) {
      type = 'decision';
    } else if (checkpoint.tags.includes('insight') || checkpoint.tags.includes('learning')) {
      type = 'insight';
    }
  }

  const memory: Memory = {
    type,
    source: 'agent' as MemorySource,
    content: checkpoint.description,
    timestamp: checkpoint.timestamp,
    tags: checkpoint.tags
  };

  return memory;
}

/**
 * Migrates checkpoints from markdown to JSONL memories
 *
 * Process:
 * 1. Read all checkpoint files from ~/.goldfish/{workspace}/checkpoints/
 * 2. Parse each markdown file to extract checkpoints
 * 3. Convert each checkpoint to a memory object
 * 4. Group memories by date (YYYY-MM-DD)
 * 5. Write to {targetDir}/.goldfish/memories/YYYY-MM-DD.jsonl
 *
 * @param options Migration options
 * @returns Migration statistics
 */
export async function migrateCheckpointsToMemories(
  options: MigrateCheckpointsOptions
): Promise<MigrationResult> {
  const result: MigrationResult = {
    checkpointsRead: 0,
    memoriesWritten: 0,
    filesCreated: [],
    skipped: 0,
    errors: []
  };

  // Get source checkpoints directory
  const workspacePath = options.goldfishBase
    ? join(options.goldfishBase, options.workspace)
    : getWorkspacePath(options.workspace);
  const checkpointsDir = join(workspacePath, 'checkpoints');

  // Check if checkpoints directory exists
  if (!existsSync(checkpointsDir)) {
    return result; // No checkpoints to migrate
  }

  // Read all checkpoint markdown files
  const files = await readdir(checkpointsDir);
  const markdownFiles = files.filter(f => f.endsWith('.md'));

  if (markdownFiles.length === 0) {
    return result; // No checkpoint files
  }

  // Parse all checkpoints from markdown files
  const allCheckpoints: Checkpoint[] = [];

  for (const file of markdownFiles) {
    const filePath = join(checkpointsDir, file);
    try {
      const content = await readFile(filePath, 'utf-8');
      const checkpoints = parseCheckpointFile(content);
      allCheckpoints.push(...checkpoints);
    } catch (error: any) {
      result.errors.push(`Failed to read ${file}: ${error.message}`);
    }
  }

  result.checkpointsRead = allCheckpoints.length;

  if (allCheckpoints.length === 0) {
    return result;
  }

  // Convert checkpoints to memories and group by date
  const memoriesByDate = new Map<string, Memory[]>();

  for (const checkpoint of allCheckpoints) {
    // Validate checkpoint
    if (!checkpoint.description || checkpoint.description.trim() === '') {
      result.skipped++;
      continue;
    }

    // Validate timestamp
    const timestamp = new Date(checkpoint.timestamp);
    if (isNaN(timestamp.getTime())) {
      result.skipped++;
      continue;
    }

    // Convert to memory
    const memory = checkpointToMemory(checkpoint);

    // Group by date (YYYY-MM-DD)
    const dateKey = checkpoint.timestamp.split('T')[0]!;

    if (!memoriesByDate.has(dateKey)) {
      memoriesByDate.set(dateKey, []);
    }

    memoriesByDate.get(dateKey)!.push(memory);
  }

  // If dry run, just count what would be written
  if (options.dryRun) {
    return result;
  }

  // Write memories to JSONL files
  const memoriesDir = join(options.targetDir, '.goldfish', 'memories');
  await mkdir(memoriesDir, { recursive: true });

  for (const [dateKey, memories] of memoriesByDate.entries()) {
    const jsonlPath = join(memoriesDir, `${dateKey}.jsonl`);
    const relativePath = `.goldfish/memories/${dateKey}.jsonl`;

    try {
      // Write each memory as a line in JSONL
      for (const memory of memories) {
        await appendJsonl(jsonlPath, memory);
        result.memoriesWritten++;
      }

      result.filesCreated.push(relativePath);
    } catch (error: any) {
      result.errors.push(`Failed to write ${relativePath}: ${error.message}`);
    }
  }

  return result;
}

/**
 * CLI entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: bun run scripts/migrate-to-memories.ts <workspace> <target-dir> [--dry-run]');
    console.error('');
    console.error('Examples:');
    console.error('  bun run scripts/migrate-to-memories.ts goldfish ./');
    console.error('  bun run scripts/migrate-to-memories.ts goldfish ./ --dry-run');
    process.exit(1);
  }

  const workspace = args[0];
  const targetDir = args[1];
  const dryRun = args.includes('--dry-run');

  console.log(`🔄 Migrating checkpoints to memories`);
  console.log(`   Workspace: ${workspace}`);
  console.log(`   Target: ${targetDir}/.goldfish/memories/`);
  console.log(`   Dry run: ${dryRun}`);
  console.log('');

  try {
    const result = await migrateCheckpointsToMemories({
      workspace,
      targetDir,
      dryRun
    });

    console.log('');
    console.log('✅ Migration complete!');
    console.log(`   Checkpoints read: ${result.checkpointsRead}`);
    console.log(`   Memories written: ${result.memoriesWritten}`);
    console.log(`   Skipped: ${result.skipped}`);
    console.log(`   Files created: ${result.filesCreated.length}`);

    if (result.errors.length > 0) {
      console.log('');
      console.log('⚠️  Errors encountered:');
      result.errors.forEach(err => console.log(`   - ${err}`));
    }

    if (dryRun) {
      console.log('');
      console.log('ℹ️  This was a dry run. No files were written.');
    }
  } catch (error: any) {
    console.error('');
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.main) {
  main();
}
