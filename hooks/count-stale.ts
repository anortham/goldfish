/**
 * Shared utility for counting unconsolidated checkpoints.
 * Used by session-start and pre-compact hooks.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export function countStaleCheckpoints(memoriesDir: string): number {
  let staleCount = 0;

  let lastTimestamp = 0;
  try {
    const raw = readFileSync(join(memoriesDir, '.last-consolidated'), 'utf-8');
    const state = JSON.parse(raw);
    lastTimestamp = new Date(state.timestamp).getTime();
  } catch { /* no state */ }

  try {
    const entries = readdirSync(memoriesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
      const dateDir = join(memoriesDir, entry.name);
      const files = readdirSync(dateDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const mtime = statSync(join(dateDir, file)).mtimeMs;
        if (mtime > lastTimestamp) staleCount++;
      }
    }
  } catch { /* no dirs */ }

  return staleCount;
}
