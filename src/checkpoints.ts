/**
 * Checkpoint storage and retrieval
 *
 * Checkpoints are stored in daily markdown files:
 * ~/.goldfish/{workspace}/checkpoints/YYYY-MM-DD.md
 */

import { join } from 'path';
import { readFile, writeFile, readdir, rename } from 'fs/promises';
import type { Checkpoint, CheckpointInput } from './types';
import { getWorkspacePath, ensureWorkspaceDir, getCurrentWorkspace } from './workspace';
import { getGitContext } from './git';

/**
 * Format a checkpoint as markdown
 */
export function formatCheckpoint(checkpoint: Checkpoint): string {
  // Extract time from ISO timestamp (UTC)
  const time = checkpoint.timestamp.substring(11, 16);  // HH:MM

  const lines: string[] = [];

  // Header with time
  lines.push(`## ${time} - ${checkpoint.description}`);
  lines.push('');

  // Optional metadata fields
  if (checkpoint.tags && checkpoint.tags.length > 0) {
    lines.push(`- **Tags**: ${checkpoint.tags.join(', ')}`);
  }
  if (checkpoint.gitBranch) {
    lines.push(`- **Branch**: ${checkpoint.gitBranch}`);
  }
  if (checkpoint.gitCommit) {
    lines.push(`- **Commit**: ${checkpoint.gitCommit}`);
  }
  if (checkpoint.files && checkpoint.files.length > 0) {
    lines.push(`- **Files**: ${checkpoint.files.join(', ')}`);
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Parse a checkpoint markdown file into structured objects
 */
export function parseCheckpointFile(content: string, date?: string): Checkpoint[] {
  if (!content.trim()) {
    return [];
  }

  const checkpoints: Checkpoint[] = [];

  // Split by checkpoint headers (## HH:MM)
  const sections = content.split(/^## /m).slice(1);  // Skip content before first header

  for (const section of sections) {
    const lines = section.split('\n');
    const firstLine = lines[0];

    if (!firstLine) continue;

    // Parse header: "HH:MM - Description"
    const match = firstLine.match(/^(\d{2}:\d{2}) - (.+)$/);
    if (!match) continue;

    const [, time, description] = match;

    // Build timestamp (use provided date or extract from content)
    let timestamp: string;
    if (date) {
      timestamp = `${date}T${time}:00.000Z`;
    } else {
      // Try to extract date from file header
      const dateMatch = content.match(/# Checkpoints for (\d{4}-\d{2}-\d{2})/);
      const extractedDate = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];
      timestamp = `${extractedDate}T${time}:00.000Z`;
    }

    // Parse metadata fields
    let tags: string[] | undefined;
    let gitBranch: string | undefined;
    let gitCommit: string | undefined;
    let files: string[] | undefined;

    for (const line of lines.slice(1)) {
      const tagMatch = line.match(/^- \*\*Tags\*\*: (.+)$/);
      if (tagMatch) {
        tags = tagMatch[1]!.split(', ').map(t => t.trim());
      }

      const branchMatch = line.match(/^- \*\*Branch\*\*: (.+)$/);
      if (branchMatch) {
        gitBranch = branchMatch[1]!.trim();
      }

      const commitMatch = line.match(/^- \*\*Commit\*\*: (.+)$/);
      if (commitMatch) {
        gitCommit = commitMatch[1]!.trim();
      }

      const filesMatch = line.match(/^- \*\*Files\*\*: (.+)$/);
      if (filesMatch) {
        files = filesMatch[1]!.split(', ').map(f => f.trim());
      }
    }

    checkpoints.push({
      timestamp,
      description: description!,
      tags,
      gitBranch,
      gitCommit,
      files
    });
  }

  return checkpoints;
}

/**
 * Save a checkpoint to the appropriate daily file
 * Uses atomic write-then-rename to prevent corruption
 */
export async function saveCheckpoint(input: CheckpointInput): Promise<void> {
  const workspace = input.workspace || getCurrentWorkspace();
  await ensureWorkspaceDir(workspace);

  // Create checkpoint with current timestamp
  const timestamp = new Date().toISOString();
  const gitContext = getGitContext();

  const checkpoint: Checkpoint = {
    timestamp,
    description: input.description,
    tags: input.tags,
    gitBranch: gitContext.branch,
    gitCommit: gitContext.commit,
    files: gitContext.files
  };

  // Determine file path (daily file)
  const date = timestamp.split('T')[0]!;
  const checkpointsDir = join(getWorkspacePath(workspace), 'checkpoints');
  const filePath = join(checkpointsDir, `${date}.md`);

  // Read existing content (if file exists)
  let existingContent = '';
  try {
    existingContent = await readFile(filePath, 'utf-8');
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    // File doesn't exist, create with header
    existingContent = `# Checkpoints for ${date}\n\n`;
  }

  // Append formatted checkpoint
  const formattedCheckpoint = formatCheckpoint(checkpoint);
  const newContent = existingContent + formattedCheckpoint;

  // Atomic write (write to temp file, then rename)
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tempPath, newContent, 'utf-8');
  await rename(tempPath, filePath);
}

/**
 * Get all checkpoints for a specific day
 */
export async function getCheckpointsForDay(
  workspace: string,
  date: string
): Promise<Checkpoint[]> {
  const filePath = join(
    getWorkspacePath(workspace),
    'checkpoints',
    `${date}.md`
  );

  try {
    const content = await readFile(filePath, 'utf-8');
    return parseCheckpointFile(content, date);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Get all checkpoints across a date range (inclusive)
 */
export async function getCheckpointsForDateRange(
  workspace: string,
  fromDate: string,
  toDate: string
): Promise<Checkpoint[]> {
  const checkpointsDir = join(getWorkspacePath(workspace), 'checkpoints');

  let files: string[];
  try {
    files = await readdir(checkpointsDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  // Filter to date range and sort
  const from = new Date(fromDate);
  const to = new Date(toDate);

  const relevantFiles = files
    .filter(f => f.endsWith('.md'))
    .filter(f => {
      const fileDate = f.replace('.md', '');
      const date = new Date(fileDate);
      return date >= from && date <= to;
    })
    .sort();

  // Load all checkpoints
  const allCheckpoints: Checkpoint[] = [];
  for (const file of relevantFiles) {
    const date = file.replace('.md', '');
    const checkpoints = await getCheckpointsForDay(workspace, date);
    allCheckpoints.push(...checkpoints);
  }

  // Sort by timestamp
  return allCheckpoints.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
