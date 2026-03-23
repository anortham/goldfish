#!/usr/bin/env bun
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const workspace = process.cwd();
const memoriesDir = join(workspace, '.memories');

let hasMemory = false;
let staleCount = 0;

try {
  try {
    statSync(join(memoriesDir, 'MEMORY.md'));
    hasMemory = true;
  } catch { /* no memory */ }

  let lastTimestamp = 0;
  try {
    const raw = readFileSync(join(memoriesDir, '.last-consolidated'), 'utf-8');
    const state = JSON.parse(raw);
    lastTimestamp = new Date(state.timestamp).getTime();
  } catch { /* no state */ }

  // Count stale checkpoints (uses file mtime as approximation;
  // actual consolidation tool uses checkpoint YAML timestamps for precision)
  try {
    const entries = readdirSync(memoriesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dateDir = join(memoriesDir, entry.name);
      const files = readdirSync(dateDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const mtime = statSync(join(dateDir, file)).mtimeMs;
        if (mtime > lastTimestamp) staleCount++;
      }
    }
  } catch { /* no dirs */ }
} catch { /* no memories dir */ }

let message = 'Use the goldfish recall tool to restore context from previous sessions. Call recall() with default parameters.';

if (hasMemory && staleCount > 0) {
  message += ` You have ${staleCount} unconsolidated checkpoint(s); dispatch consolidation after orienting.`;
} else if (hasMemory && staleCount === 0) {
  message += ' Memory is up to date.';
} else if (!hasMemory) {
  message += ' No consolidated memory exists yet; consider running consolidation after your first few checkpoints.';
}

message += ' If there is an active plan or recent checkpoints, briefly summarize them so the user knows you have context. If nothing is found, continue without comment.';

console.log(message);
