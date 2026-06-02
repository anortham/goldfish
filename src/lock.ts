/**
 * Simple file locking mechanism using lock files
 *
 * Uses atomic operations to create lock files, preventing race conditions
 * in concurrent file operations.
 */

import { writeFile, unlink, readFile, rename } from 'fs/promises';
import { randomBytes } from 'crypto';
import { hostname } from 'os';
import { getLogger } from './logger';

const MAX_LOCK_AGE_MS = 30000; // 30 seconds - locks older than this are considered stale
const LOCK_RETRY_DELAY_MS = 10;
const MAX_LOCK_ATTEMPTS = 3000; // 30 seconds total (10ms * 3000)

const HOST = hostname();

interface LockData {
  pid?: number;
  timestamp?: number;
  nonce?: string;
  host?: string;
}

/**
 * Only EEXIST means "another holder has the lock" (O_EXCL create collided).
 * Any other error (EPERM/EACCES on a read-only or sandboxed directory, EROFS,
 * etc.) means we genuinely cannot create the lock file, so retrying for 30s is
 * pointless — fail fast. Treating EPERM as contention caused a 30s stall on
 * read-only ~/.goldfish before every checkpoint save.
 */
export function isLockHeldError(code: unknown): boolean {
  return code === 'EEXIST';
}

/**
 * Is a process alive on THIS host? `process.kill(pid, 0)` sends no signal but
 * throws ESRCH when no such process exists. EPERM means the process exists but
 * is owned by another user — still alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

/**
 * Decide whether an existing lock can be reclaimed.
 *
 * Liveness beats age: a lock whose owning pid is provably alive on this host is
 * never stale, no matter how old (a slow holder on a loaded box or networked FS
 * must not be force-stolen). A lock whose owner is provably dead on this host is
 * stale immediately (fast crash recovery). When we cannot check liveness (lock
 * from another host, or no pid) we fall back to the age threshold. A lock with
 * no usable timestamp is malformed and treated as stale so a corrupt lock file
 * cannot wedge writers forever.
 */
export function isStaleLock(lock: LockData | null | undefined): boolean {
  if (!lock || typeof lock !== 'object') {
    return true;
  }

  if (typeof lock.pid === 'number' && lock.host && lock.host === HOST) {
    return !isProcessAlive(lock.pid);
  }

  const ts = typeof lock.timestamp === 'number' ? lock.timestamp : NaN;
  if (Number.isNaN(ts)) {
    return true;
  }
  return Date.now() - ts > MAX_LOCK_AGE_MS;
}

function buildLockData(nonce: string): string {
  return JSON.stringify({
    pid: process.pid,
    timestamp: Date.now(),
    nonce,
    host: HOST
  });
}

function makeRelease(lockPath: string, nonce: string): () => Promise<void> {
  return async () => {
    try {
      const current = JSON.parse(await readFile(lockPath, 'utf-8'));
      if (current.nonce === nonce) {
        await unlink(lockPath);
      }
    } catch {
      // Lock file may have been cleaned up already or is unreadable.
    }
  };
}

/**
 * Atomically claim ownership of stealing a stale/malformed lock.
 *
 * Uses rename (atomic on a single filesystem) so that among many racers exactly
 * one wins the right to remove a given stale lock — this closes the
 * unlink-then-create TOCTOU window where two waiters could both delete and both
 * re-create the lock, breaking mutual exclusion.
 *
 * Returns true when progress was made (we stole it, or someone else already
 * moved it away), false when we could not steal it (e.g. permission denied).
 */
async function stealStaleLock(lockPath: string, token: string): Promise<boolean> {
  const stolenPath = `${lockPath}.stale.${token}`;
  try {
    await rename(lockPath, stolenPath);
  } catch (error: any) {
    // Someone else already renamed/removed it — that's progress, retry create.
    if (error?.code === 'ENOENT') {
      return true;
    }
    // Could not steal (e.g. read-only directory). Caller will count the attempt.
    return false;
  }
  try {
    await unlink(stolenPath);
  } catch {
    // The stolen marker will age out / be retried; not fatal.
  }
  return true;
}

/**
 * Acquire a lock for a specific file path
 * Returns a release function that MUST be called to release the lock
 */
export async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;
  const nonce = randomBytes(8).toString('hex');
  const lockData = buildLockData(nonce);

  let attempts = 0;

  while (attempts < MAX_LOCK_ATTEMPTS) {
    try {
      // Try to create lock file exclusively (fails if exists)
      await writeFile(lockPath, lockData, { flag: 'wx' });
      return makeRelease(lockPath, nonce);
    } catch (error: any) {
      if (!isLockHeldError(error?.code)) {
        // Cannot create the lock at all (permissions / read-only FS). Fail fast.
        throw new Error(
          `Failed to acquire lock for ${filePath}: ${error?.code ?? error?.message ?? 'unknown error'}`
        );
      }

      // Increment attempts unconditionally to prevent infinite loops
      // (e.g. when a stale lock can't be deleted due to permissions).
      attempts++;
      if (attempts >= MAX_LOCK_ATTEMPTS) {
        throw new Error(`Failed to acquire lock for ${filePath} after ${MAX_LOCK_ATTEMPTS} attempts`);
      }

      // Lock file exists — decide whether it is stale and reclaim it atomically.
      let parsed: LockData | null = null;
      let lockGone = false;
      try {
        parsed = JSON.parse(await readFile(lockPath, 'utf-8')) as LockData;
      } catch (readError: any) {
        if (readError?.code === 'ENOENT') {
          lockGone = true; // lock vanished between create and read — retry now
        } else {
          parsed = null; // unreadable/corrupt JSON — treat as stale below
        }
      }

      if (lockGone) {
        continue;
      }

      if (isStaleLock(parsed)) {
        getLogger().warn(
          `stale lock detected: ${lockPath} (pid=${parsed?.pid ?? '?'}, host=${parsed?.host ?? '?'})`
        );
        // Whether or not the steal succeeds, loop and retry create. A failed
        // steal (e.g. read-only dir) keeps counting attempts toward the cap, so
        // an undeletable stale lock fails fast rather than hanging.
        await stealStaleLock(lockPath, `${nonce}.${attempts}`);
        continue;
      }

      // Valid live lock — wait and retry.
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }

  throw new Error(`Failed to acquire lock for ${filePath} after ${MAX_LOCK_ATTEMPTS} attempts`);
}

/**
 * Try to acquire a lock within a short timeout budget.
 * Returns a release function on success, or null if the lock is already held.
 * Only real filesystem errors throw.
 */
export async function tryAcquireLock(
  filePath: string,
  timeoutMs: number
): Promise<(() => Promise<void>) | null> {
  const lockPath = `${filePath}.lock`;
  const nonce = randomBytes(8).toString('hex');
  const lockData = buildLockData(nonce);

  const maxAttempts = Math.max(1, Math.floor(timeoutMs / LOCK_RETRY_DELAY_MS));
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      await writeFile(lockPath, lockData, { flag: 'wx' });
      return makeRelease(lockPath, nonce);
    } catch (error: any) {
      if (!isLockHeldError(error?.code)) {
        throw error; // Real filesystem error (permissions, read-only FS, ...)
      }
      attempts++;
      if (attempts >= maxAttempts) {
        return null; // Timed out, return null instead of throwing
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
    }
  }

  return null;
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
