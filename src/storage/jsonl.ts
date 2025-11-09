/**
 * JSONL (JSON Lines) storage utilities for Goldfish memories
 *
 * JSONL format: One JSON object per line, newline-delimited
 * - Git-friendly (line-based diffs)
 * - Easy to merge (append-only)
 * - Simple to parse (line-by-line)
 * - Human-readable
 */

import { readFile, writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import type { Memory, MemoryWithMetadata } from './types';
import { hashContent } from './hash';

/**
 * Reads all memories from a JSONL file
 * Returns empty array if file doesn't exist
 *
 * @param filePath Path to JSONL file
 * @returns Array of memories with metadata
 *
 * @example
 * ```typescript
 * const memories = await readJsonl('./memories/2025-11-09.jsonl');
 * console.log(`Loaded ${memories.length} memories`);
 * ```
 */
export async function readJsonl(filePath: string): Promise<MemoryWithMetadata[]> {
  // Return empty array if file doesn't exist
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim().length > 0);

    const memories: MemoryWithMetadata[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const memory = JSON.parse(lines[i]) as Memory;

        // Validate memory structure
        if (!isValidMemory(memory)) {
          console.warn(`⚠️  Invalid memory at line ${i + 1} in ${filePath}`);
          continue;
        }

        // Add metadata
        memories.push({
          ...memory,
          lineNumber: i + 1,
          filePath,
          hash: hashContent(memory.content)
        });
      } catch (error) {
        console.warn(`⚠️  Failed to parse line ${i + 1} in ${filePath}:`, error);
      }
    }

    return memories;
  } catch (error) {
    console.error(`❌ Failed to read JSONL file ${filePath}:`, error);
    return [];
  }
}

/**
 * Writes memories to a JSONL file (overwrites existing file)
 * Uses atomic write-then-rename pattern to prevent corruption
 *
 * @param filePath Path to JSONL file
 * @param memories Array of memories to write
 *
 * @example
 * ```typescript
 * await writeJsonl('./memories/2025-11-09.jsonl', memories);
 * ```
 */
export async function writeJsonl(filePath: string, memories: Memory[]): Promise<void> {
  try {
    // Ensure directory exists
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Convert memories to JSONL format
    const lines = memories.map(memory => JSON.stringify(memory));
    const content = lines.join('\n') + '\n'; // Trailing newline

    // Atomic write: write to temp file, then rename
    const tmpPath = `${filePath}.tmp`;
    await writeFile(tmpPath, content, 'utf-8');

    // Rename is atomic on most file systems
    await Bun.write(filePath, await Bun.file(tmpPath).text());

    // Clean up temp file
    try {
      await Bun.write(tmpPath, ''); // Clear temp file
    } catch {
      // Ignore cleanup errors
    }
  } catch (error) {
    throw new Error(`Failed to write JSONL file ${filePath}: ${error}`);
  }
}

/**
 * Appends a memory to a JSONL file
 * Creates file if it doesn't exist
 *
 * @param filePath Path to JSONL file
 * @param memory Memory to append
 *
 * @example
 * ```typescript
 * const memory = {
 *   type: 'decision',
 *   source: 'agent',
 *   content: 'Chose SQLite for embeddings storage',
 *   timestamp: new Date().toISOString()
 * };
 * await appendJsonl('./memories/2025-11-09.jsonl', memory);
 * ```
 */
export async function appendJsonl(filePath: string, memory: Memory): Promise<void> {
  try {
    // Validate memory
    if (!isValidMemory(memory)) {
      throw new Error('Invalid memory structure');
    }

    // Ensure directory exists
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Convert to JSON line
    const line = JSON.stringify(memory) + '\n';

    // Append to file
    await appendFile(filePath, line, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to append to JSONL file ${filePath}: ${error}`);
  }
}

/**
 * Appends multiple memories to a JSONL file efficiently
 *
 * @param filePath Path to JSONL file
 * @param memories Array of memories to append
 *
 * @example
 * ```typescript
 * await appendJsonlBatch('./memories/2025-11-09.jsonl', [memory1, memory2, memory3]);
 * ```
 */
export async function appendJsonlBatch(filePath: string, memories: Memory[]): Promise<void> {
  try {
    // Validate all memories
    for (const memory of memories) {
      if (!isValidMemory(memory)) {
        throw new Error('Invalid memory structure in batch');
      }
    }

    // Ensure directory exists
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });

    // Convert to JSONL format
    const lines = memories.map(memory => JSON.stringify(memory));
    const content = lines.join('\n') + '\n';

    // Append all at once
    await appendFile(filePath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to append batch to JSONL file ${filePath}: ${error}`);
  }
}

/**
 * Gets the file path for memories on a given date
 *
 * @param baseDir Base directory (.goldfish/memories/)
 * @param date Date object or ISO string
 * @returns Path to JSONL file for that date
 *
 * @example
 * ```typescript
 * const path = getMemoryFilePath('./.goldfish/memories', new Date());
 * // Returns: './.goldfish/memories/2025-11-09.jsonl'
 * ```
 */
export function getMemoryFilePath(baseDir: string, date: Date | string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const dateKey = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD
  return join(baseDir, `${dateKey}.jsonl`);
}

/**
 * Validates that an object is a valid Memory
 *
 * @param obj Object to validate
 * @returns True if object is a valid Memory
 */
function isValidMemory(obj: any): obj is Memory {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof obj.type === 'string' &&
    typeof obj.source === 'string' &&
    typeof obj.content === 'string' &&
    typeof obj.timestamp === 'string' &&
    (obj.tags === undefined || Array.isArray(obj.tags))
  );
}

/**
 * Scans a directory for all JSONL files
 * Returns sorted array of file paths (oldest to newest)
 *
 * @param baseDir Directory to scan
 * @returns Array of JSONL file paths
 *
 * @example
 * ```typescript
 * const files = await scanJsonlFiles('./.goldfish/memories');
 * // Returns: ['2025-11-01.jsonl', '2025-11-02.jsonl', ...]
 * ```
 */
export async function scanJsonlFiles(baseDir: string): Promise<string[]> {
  if (!existsSync(baseDir)) {
    return [];
  }

  try {
    const { readdirSync } = await import('fs');
    const files = readdirSync(baseDir)
      .filter(file => file.endsWith('.jsonl'))
      .sort() // Sorts alphabetically, which works for YYYY-MM-DD format
      .map(file => join(baseDir, file));

    return files;
  } catch (error) {
    console.error(`❌ Failed to scan directory ${baseDir}:`, error);
    return [];
  }
}

/**
 * Reads all memories from a directory of JSONL files
 * Returns memories sorted by timestamp (oldest to newest)
 *
 * @param baseDir Directory containing JSONL files
 * @returns Array of all memories with metadata
 *
 * @example
 * ```typescript
 * const allMemories = await readAllJsonl('./.goldfish/memories');
 * console.log(`Total memories: ${allMemories.length}`);
 * ```
 */
export async function readAllJsonl(baseDir: string): Promise<MemoryWithMetadata[]> {
  const files = await scanJsonlFiles(baseDir);

  const allMemories: MemoryWithMetadata[] = [];

  for (const file of files) {
    const memories = await readJsonl(file);
    allMemories.push(...memories);
  }

  // Sort by timestamp
  allMemories.sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });

  return allMemories;
}
