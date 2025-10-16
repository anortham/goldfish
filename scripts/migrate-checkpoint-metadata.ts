#!/usr/bin/env bun
/**
 * One-time migration script to add metadata to existing checkpoints
 *
 * This adds summary and charCount metadata to all checkpoints with descriptions > 150 chars
 * that don't already have metadata.
 *
 * Usage:
 *   bun scripts/migrate-checkpoint-metadata.ts --dry-run   # Preview changes
 *   bun scripts/migrate-checkpoint-metadata.ts             # Apply changes
 */

import { readdir, readFile, writeFile, rename } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { parseCheckpointFile, formatCheckpoint } from '../src/checkpoints';
import { generateSummary } from '../src/summary';

const GOLDFISH_DIR = join(homedir(), '.goldfish');
const isDryRun = process.argv.includes('--dry-run');

interface MigrationStats {
  workspaces: number;
  filesScanned: number;
  checkpointsProcessed: number;
  checkpointsUpdated: number;
  errors: number;
}

async function getWorkspaces(): Promise<string[]> {
  try {
    const entries = await readdir(GOLDFISH_DIR, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => e.name);
  } catch {
    return [];
  }
}

async function getCheckpointFiles(workspace: string): Promise<string[]> {
  const checkpointsDir = join(GOLDFISH_DIR, workspace, 'checkpoints');
  try {
    const files = await readdir(checkpointsDir);
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => join(checkpointsDir, f));
  } catch {
    return [];
  }
}

async function migrateCheckpointFile(filePath: string, stats: MigrationStats): Promise<void> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const checkpoints = parseCheckpointFile(content);

    let modified = false;

    for (const checkpoint of checkpoints) {
      stats.checkpointsProcessed++;

      // Skip if already has metadata
      if (checkpoint.summary || checkpoint.charCount) {
        continue;
      }

      // Generate metadata if needed
      const summary = generateSummary(checkpoint.description);
      if (summary) {
        checkpoint.summary = summary;
        checkpoint.charCount = checkpoint.description.length;
        modified = true;
        stats.checkpointsUpdated++;

        if (isDryRun) {
          console.log(`  Would update: ${checkpoint.description.substring(0, 60)}...`);
        }
      }
    }

    // Write back if modified
    if (modified && !isDryRun) {
      const newContent = checkpoints.map(formatCheckpoint).join('\n---\n\n');
      const tmpPath = `${filePath}.tmp`;
      await writeFile(tmpPath, newContent, 'utf-8');
      await rename(tmpPath, filePath);
    }
  } catch (error) {
    stats.errors++;
    console.error(`Error processing ${filePath}:`, error);
  }
}

async function main() {
  console.log('🐠 Goldfish Checkpoint Metadata Migration');
  console.log('=========================================\n');

  if (isDryRun) {
    console.log('🔍 DRY RUN MODE - No files will be modified\n');
  } else {
    console.log('⚠️  LIVE MODE - Files will be updated\n');
  }

  const stats: MigrationStats = {
    workspaces: 0,
    filesScanned: 0,
    checkpointsProcessed: 0,
    checkpointsUpdated: 0,
    errors: 0
  };

  const workspaces = await getWorkspaces();
  stats.workspaces = workspaces.length;

  console.log(`Found ${workspaces.length} workspaces\n`);

  for (const workspace of workspaces) {
    const files = await getCheckpointFiles(workspace);
    if (files.length === 0) continue;

    console.log(`📂 ${workspace} (${files.length} files)`);
    stats.filesScanned += files.length;

    for (const file of files) {
      await migrateCheckpointFile(file, stats);
    }

    console.log();
  }

  console.log('Summary');
  console.log('=======');
  console.log(`Workspaces:           ${stats.workspaces}`);
  console.log(`Files scanned:        ${stats.filesScanned}`);
  console.log(`Checkpoints processed: ${stats.checkpointsProcessed}`);
  console.log(`Checkpoints updated:   ${stats.checkpointsUpdated}`);
  console.log(`Errors:               ${stats.errors}`);

  if (isDryRun) {
    console.log('\n✅ Dry run complete. Run without --dry-run to apply changes.');
  } else {
    console.log('\n✅ Migration complete!');
  }
}

main().catch(console.error);
