/**
 * Simple file locking mechanism using lock files
 *
 * Uses atomic operations to create lock files, preventing race conditions
 * in concurrent file operations.
 */

import { writeFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const MAX_LOCK_AGE_MS = 30000; // 30 seconds - locks older than this are considered stale
const LOCK_RETRY_DELAY_MS = 10;
const MAX_LOCK_ATTEMPTS = 3000; // 30 seconds total (10ms * 3000)

/**
 * Acquire a lock for a specific file path
 * Returns a release function that MUST be called to release the lock
 */
export async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;
  const lockData = JSON.stringify({
    pid: process.pid,
    timestamp: Date.now()
  });

  let attempts = 0;

  while (attempts < MAX_LOCK_ATTEMPTS) {
    try {
      // Try to create lock file exclusively (fails if exists)
      await writeFile(lockPath, lockData, { flag: 'wx' });

      // Lock acquired! Return release function
      return async () => {
        try {
          await unlink(lockPath);
        } catch {
          // Lock file may have been cleaned up already
        }
      };
    } catch (error: any) {
      if (error.code === 'EEXIST') {
        // Lock file exists - check if it's stale
        try {
          const existingLock = JSON.parse(await Bun.file(lockPath).text());
          const age = Date.now() - existingLock.timestamp;

          if (age > MAX_LOCK_AGE_MS) {
            // Stale lock - remove it and retry
            try {
              await unlink(lockPath);
            } catch {
              // Another process may have removed it
            }
          }
        } catch {
          // Lock file is corrupted or being written - wait and retry
        }

        // Wait a bit and retry
        attempts++;
        await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      } else {
        // Some other error - propagate it
        throw error;
      }
    }
  }

  throw new Error(`Failed to acquire lock for ${filePath} after ${MAX_LOCK_ATTEMPTS} attempts`);
}

/**
 * Execute a function with a lock held
 * Automatically releases lock when done (even if function throws)
 */
export async function withLock<T>(
  filePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const release = await acquireLock(filePath);

  try {
    return await fn();
  } finally {
    await release();
  }
}
