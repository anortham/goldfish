/**
 * Shared utility for counting unconsolidated checkpoints.
 * Used by session-start and pre-compact hooks.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export function countStaleCheckpoints(memoriesDir: string): number {
  let staleCount = 0;

  let lastTimestamp = 0;

  // Try new location first: ~/.goldfish/consolidation-state/{workspace}.json
  const goldfishHome = process.env.GOLDFISH_HOME || join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.goldfish');
  const projectPath = memoriesDir.replace(/[/\\]\.memories$/, '');
  let workspaceName = projectPath.replace(/^.*[/\\]/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!workspaceName) workspaceName = 'default';
  const newStatePath = join(goldfishHome, 'consolidation-state', `${workspaceName}.json`);

  try {
    const raw = readFileSync(newStatePath, 'utf-8');
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
