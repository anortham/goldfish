#!/usr/bin/env bun
import { statSync } from 'fs';
import { join } from 'path';
import { countStaleCheckpoints } from './count-stale';

const workspace = process.cwd();
const memoriesDir = join(workspace, '.memories');

let hasMemory = false;
let staleCount = 0;

try {
  try {
    statSync(join(memoriesDir, 'MEMORY.md'));
    hasMemory = true;
  } catch { /* no memory */ }

  staleCount = countStaleCheckpoints(memoriesDir);
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
