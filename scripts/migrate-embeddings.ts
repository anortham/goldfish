#!/usr/bin/env bun

/**
 * Migration script to generate embeddings for existing checkpoints
 *
 * Usage:
 *   bun run scripts/migrate-embeddings.ts [workspace]
 *
 * Examples:
 *   bun run scripts/migrate-embeddings.ts              # Migrate current workspace
 *   bun run scripts/migrate-embeddings.ts goldfish     # Migrate specific workspace
 *   bun run scripts/migrate-embeddings.ts --all        # Migrate all workspaces
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { getWorkspacePath, getCurrentWorkspace, listWorkspaces } from '../src/workspace';
import { getEmbeddingEngine, closeAllEngines } from '../src/embeddings';
import { parseCheckpointFile } from '../src/checkpoints';
import type { Checkpoint } from '../src/types';

/**
 * Migrate embeddings for a single workspace
 */
async function migrateWorkspace(workspace: string): Promise<void> {
  console.log(`\n📦 Migrating workspace: ${workspace}`);

  const workspacePath = getWorkspacePath(workspace);
  const checkpointsDir = join(workspacePath, 'checkpoints');

  // Check if checkpoints directory exists
  try {
    await readdir(checkpointsDir);
  } catch (error) {
    console.log(`  ⚠️  No checkpoints directory found, skipping`);
    return;
  }

  // Read all checkpoint files
  const files = await readdir(checkpointsDir);
  const markdownFiles = files.filter(f => f.endsWith('.md'));

  if (markdownFiles.length === 0) {
    console.log(`  ℹ️  No checkpoint files found, skipping`);
    return;
  }

  console.log(`  📄 Found ${markdownFiles.length} checkpoint files`);

  // Parse all checkpoints
  const allCheckpoints: Checkpoint[] = [];

  for (const file of markdownFiles) {
    const filePath = join(checkpointsDir, file);
    const content = await readFile(filePath, 'utf-8');
    const checkpoints = parseCheckpointFile(content);
    allCheckpoints.push(...checkpoints);
  }

  console.log(`  📝 Found ${allCheckpoints.length} checkpoints`);

  if (allCheckpoints.length === 0) {
    console.log(`  ℹ️  No checkpoints to migrate`);
    return;
  }

  // Initialize embedding engine
  const engine = await getEmbeddingEngine(workspace);

  // Check which checkpoints already have embeddings
  const checkpointsToEmbed: Checkpoint[] = [];

  for (const checkpoint of allCheckpoints) {
    const existing = await engine.getEmbedding(checkpoint.timestamp);
    if (!existing) {
      checkpointsToEmbed.push(checkpoint);
    }
  }

  console.log(`  🔄 Need to embed ${checkpointsToEmbed.length} checkpoints (${allCheckpoints.length - checkpointsToEmbed.length} already embedded)`);

  if (checkpointsToEmbed.length === 0) {
    console.log(`  ✅ All checkpoints already have embeddings`);
    return;
  }

  // Generate embeddings in batches
  console.log(`  ⚙️  Generating embeddings...`);
  const startTime = Date.now();

  await engine.embedBatch(checkpointsToEmbed);

  const duration = Date.now() - startTime;
  const perCheckpoint = (duration / checkpointsToEmbed.length).toFixed(0);

  console.log(`  ✅ Generated ${checkpointsToEmbed.length} embeddings in ${duration}ms (~${perCheckpoint}ms per checkpoint)`);
}

/**
 * Main migration function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  console.log('🔄 Goldfish Embedding Migration\n');

  try {
    if (args.length === 0) {
      // Migrate current workspace
      const workspace = getCurrentWorkspace();
      await migrateWorkspace(workspace);
    } else if (args[0] === '--all') {
      // Migrate all workspaces
      const workspaces = await listWorkspaces();
      console.log(`📚 Found ${workspaces.length} workspaces\n`);

      for (const workspace of workspaces) {
        await migrateWorkspace(workspace);
      }
    } else {
      // Migrate specific workspace
      const workspace = args[0];
      await migrateWorkspace(workspace);
    }

    console.log('\n✅ Migration complete!');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    // Clean up
    await closeAllEngines();
  }
}

// Run migration
main();
