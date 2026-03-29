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
    statSync(join(memoriesDir, 'memory.yaml'));
    hasMemory = true;
  } catch {
    try {
      statSync(join(memoriesDir, 'MEMORY.md'));
      hasMemory = true;
    } catch { /* no memory */ }
  }

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

// Behavioral context injected via additionalContext (uncapped, unlike server instructions).
// This supplements the 2k-capped server instructions with guidance that benefits from
// being front-loaded every session.
const additionalContext = `Goldfish reminders for this session:
- Checkpoint BEFORE git commits, not after. The checkpoint file must be included in the commit so it's available on other machines.
- Always commit .memories/ to source control. Never add it to .gitignore.
- Never ask permission to checkpoint or save plans. Just do it.`;

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext,
  },
}));
// Plain text message for the main hook output
console.error(message);
