/**
 * Shared utility for counting unconsolidated checkpoints.
 * Used by session-start and pre-compact hooks.
 *
 * Parses frontmatter timestamps (not file mtime) and applies a 30-day
 * age filter so the count matches what recall and the consolidate handler
 * actually process.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getConsolidationStatePath } from '../src/workspace';
import { CONSOLIDATION_AGE_LIMIT_DAYS } from '../src/checkpoints';

/** Regex to extract the timestamp field from YAML frontmatter. */
const TIMESTAMP_RE = /^---\n[\s\S]*?timestamp:\s*"?([^"\n]+)"?\n[\s\S]*?---/;

/**
 * Extract the ISO 8601 timestamp from a checkpoint file's YAML frontmatter.
 * Returns null if the file has no parseable frontmatter timestamp.
 */
function extractTimestamp(content: string): string | null {
  const match = content.match(TIMESTAMP_RE);
  return match ? match[1]!.trim() : null;
}

export function countStaleCheckpoints(memoriesDir: string): number {
  let staleCount = 0;
  let lastTimestamp = 0;

  const projectPath = memoriesDir.replace(/[/\\]\.memories$/, '');

  // Try new machine-local path first
  try {
    const raw = readFileSync(getConsolidationStatePath(projectPath), 'utf-8');
    const state = JSON.parse(raw);
    lastTimestamp = new Date(state.timestamp).getTime();
  } catch {
    // Fall back to legacy location
    try {
      const raw = readFileSync(join(memoriesDir, '.last-consolidated'), 'utf-8');
      const state = JSON.parse(raw);
      lastTimestamp = new Date(state.timestamp).getTime();
    } catch { /* no state */ }
  }

  const ageLimit = Date.now() - CONSOLIDATION_AGE_LIMIT_DAYS * 24 * 60 * 60 * 1000;

  try {
    const entries = readdirSync(memoriesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
      const dateDir = join(memoriesDir, entry.name);
      const files = readdirSync(dateDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        try {
          const content = readFileSync(join(dateDir, file), 'utf-8');
          const ts = extractTimestamp(content);
          if (!ts) continue; // Skip files without parseable frontmatter
          const cpTime = new Date(ts).getTime();
          if (!Number.isFinite(cpTime)) continue;
          if (cpTime > lastTimestamp && cpTime >= ageLimit) {
            staleCount++;
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch { /* no dirs */ }

  return staleCount;
}
