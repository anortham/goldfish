/**
 * Checkpoint storage and retrieval
 *
 * Checkpoints are stored as individual markdown files with YAML frontmatter:
 * {project}/.memories/{date}/{HHMMSS}_{hash}.md
 */

import { join } from 'path';
import { readFile, writeFile, readdir, rename, mkdir } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Checkpoint, CheckpointInput } from './types';
import { getMemoriesDir, ensureMemoriesDir } from './workspace';
import { getGitContext } from './git';
import { withLock } from './lock';
import { generateSummary } from './summary';

/**
 * Generate a deterministic checkpoint ID from timestamp and description.
 * Format: checkpoint_{first 8 hex chars of SHA-256 hash}
 */
export function generateCheckpointId(timestamp: string, description: string): string {
  const input = `${timestamp}:${description}`;
  const hash = new Bun.CryptoHasher('sha256')
    .update(input)
    .digest('hex')
    .slice(0, 8);
  return `checkpoint_${hash}`;
}

/**
 * Get the filename for a checkpoint file.
 * Format: HHMMSS_first4ofhash.md
 */
export function getCheckpointFilename(checkpoint: Checkpoint): string {
  // Extract HH:MM:SS from ISO timestamp
  const timePart = checkpoint.timestamp.substring(11, 19); // "HH:MM:SS"
  const hhmmss = timePart.replace(/:/g, '');

  // Extract first 4 chars of the hash portion of the ID
  const hash4 = checkpoint.id.replace('checkpoint_', '').slice(0, 4);

  return `${hhmmss}_${hash4}.md`;
}

/**
 * Format a checkpoint as YAML frontmatter + markdown body
 */
export function formatCheckpoint(checkpoint: Checkpoint): string {
  // Build frontmatter object with only present fields
  const frontmatter: Record<string, unknown> = {
    id: checkpoint.id,
    timestamp: checkpoint.timestamp
  };

  if (checkpoint.tags && checkpoint.tags.length > 0) {
    frontmatter.tags = checkpoint.tags;
  }

  if (checkpoint.git) {
    // Only include git fields that are present
    const git: Record<string, unknown> = {};
    if (checkpoint.git.branch) git.branch = checkpoint.git.branch;
    if (checkpoint.git.commit) git.commit = checkpoint.git.commit;
    if (checkpoint.git.files && checkpoint.git.files.length > 0) {
      git.files = checkpoint.git.files;
    }
    if (Object.keys(git).length > 0) {
      frontmatter.git = git;
    }
  }

  if (checkpoint.summary) {
    frontmatter.summary = checkpoint.summary;
  }

  const yaml = stringifyYaml(frontmatter).trim();
  return `---\n${yaml}\n---\n\n${checkpoint.description}\n`;
}

/**
 * Parse a single checkpoint from a YAML frontmatter markdown file
 */
export function parseCheckpointFile(content: string): Checkpoint {
  // Split on frontmatter delimiters
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid checkpoint file: no YAML frontmatter found');
  }

  const yamlContent = match[1]!;
  const body = match[2]!.trim();

  const frontmatter = parseYaml(yamlContent) as {
    id: string;
    timestamp: string;
    tags?: string[];
    git?: { branch?: string; commit?: string; files?: string[] };
    summary?: string;
  };

  const checkpoint: Checkpoint = {
    id: frontmatter.id,
    timestamp: frontmatter.timestamp,
    description: body
  };

  if (frontmatter.tags) checkpoint.tags = frontmatter.tags;
  if (frontmatter.git) checkpoint.git = frontmatter.git;
  if (frontmatter.summary) checkpoint.summary = frontmatter.summary;

  return checkpoint;
}

/**
 * Save a checkpoint as an individual file
 * Uses atomic write-then-rename to prevent corruption
 */
export async function saveCheckpoint(input: CheckpointInput): Promise<Checkpoint> {
  const projectPath = input.workspace || process.cwd();
  await ensureMemoriesDir(projectPath);

  // Create checkpoint with current timestamp
  const timestamp = new Date().toISOString();
  const gitContext = getGitContext();

  // Generate deterministic ID
  const id = generateCheckpointId(timestamp, input.description);

  const checkpoint: Checkpoint = {
    id,
    timestamp,
    description: input.description
  };

  if (input.tags) checkpoint.tags = input.tags;

  // Set git context as nested object
  if (gitContext.branch || gitContext.commit || gitContext.files) {
    checkpoint.git = gitContext;
  }

  // Auto-generate summary for long descriptions
  const summary = generateSummary(input.description);
  if (summary) {
    checkpoint.summary = summary;
  }

  // Determine file path
  const date = timestamp.split('T')[0]!;
  const memoriesDir = getMemoriesDir(projectPath);
  const dateDir = join(memoriesDir, date);

  // Ensure date directory exists
  await mkdir(dateDir, { recursive: true });

  const filename = getCheckpointFilename(checkpoint);
  const filePath = join(dateDir, filename);

  // Use file lock on the date directory to prevent name collisions
  await withLock(dateDir, async () => {
    // Atomic write (write to temp file, then rename)
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    const content = formatCheckpoint(checkpoint);
    await writeFile(tempPath, content, 'utf-8');
    await rename(tempPath, filePath);
  });

  return checkpoint;
}

/**
 * Get all checkpoints for a specific day
 */
export async function getCheckpointsForDay(
  projectPath: string,
  date: string
): Promise<Checkpoint[]> {
  const dateDir = join(getMemoriesDir(projectPath), date);

  let files: string[];
  try {
    files = await readdir(dateDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const mdFiles = files.filter(f => f.endsWith('.md')).sort();

  const checkpoints: Checkpoint[] = [];
  for (const file of mdFiles) {
    try {
      const content = await readFile(join(dateDir, file), 'utf-8');
      const checkpoint = parseCheckpointFile(content);
      checkpoints.push(checkpoint);
    } catch {
      // Skip files that can't be parsed (e.g., corrupted)
      continue;
    }
  }

  // Sort by timestamp
  return checkpoints.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * Get all checkpoints across a date range (inclusive)
 *
 * @param projectPath - Path to the project directory
 * @param fromDate - ISO 8601 timestamp or YYYY-MM-DD date
 * @param toDate - ISO 8601 timestamp or YYYY-MM-DD date
 */
export async function getCheckpointsForDateRange(
  projectPath: string,
  fromDate: string,
  toDate: string
): Promise<Checkpoint[]> {
  const memoriesDir = getMemoriesDir(projectPath);

  let entries: string[];
  try {
    entries = await readdir(memoriesDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  // Parse timestamps (handles both ISO timestamps and YYYY-MM-DD dates)
  const fromTimestamp = new Date(fromDate).getTime();

  // If toDate is a date-only string (no time component), treat it as end of day
  let toTimestamp: number;
  if (toDate.includes('T')) {
    toTimestamp = new Date(toDate).getTime();
  } else {
    toTimestamp = new Date(toDate + 'T23:59:59.999Z').getTime();
  }

  // Extract date portions to determine which directories to scan
  const fromDateOnly = fromDate.split('T')[0]!;
  const toDateOnly = toDate.split('T')[0]!;

  const from = new Date(fromDateOnly);
  const to = new Date(toDateOnly);

  // Filter to date directories within range
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const relevantDirs = entries
    .filter(e => datePattern.test(e))
    .filter(e => {
      const dirDate = new Date(e);
      return dirDate >= from && dirDate <= to;
    })
    .sort();

  // Load all checkpoints from relevant directories
  const allCheckpoints: Checkpoint[] = [];
  for (const dir of relevantDirs) {
    const checkpoints = await getCheckpointsForDay(projectPath, dir);
    allCheckpoints.push(...checkpoints);
  }

  // Filter by actual timestamp (not just directory date)
  const filtered = allCheckpoints.filter(checkpoint => {
    const checkpointTime = new Date(checkpoint.timestamp).getTime();
    return checkpointTime >= fromTimestamp && checkpointTime <= toTimestamp;
  });

  // Sort by timestamp
  return filtered.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
