import { dirname } from 'path';
import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import { withLock } from './lock';

let tempFileCounter = 0;

function getTempPath(filePath: string): string {
  tempFileCounter += 1;
  return `${filePath}.tmp.${Date.now()}.${process.pid}.${tempFileCounter}`;
}

// Windows rename-over-existing fails with a transient sharing violation
// (EPERM/EACCES/EBUSY) when the destination is briefly held open — e.g. a
// concurrent replace, a reader that has not closed yet, or an AV scan.
// POSIX rename never reports these for a plain replace, so retry only there.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_MAX_RETRIES = 10;
const RENAME_RETRY_DELAY_MS = 5;

async function renameReplacing(tempPath: string, filePath: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tempPath, filePath);
      return;
    } catch (error: any) {
      const retryable = process.platform === 'win32'
        && RENAME_RETRY_CODES.has(error?.code)
        && attempt < RENAME_MAX_RETRIES;
      if (!retryable) throw error;
      await new Promise(resolve => setTimeout(resolve, RENAME_RETRY_DELAY_MS));
    }
  }
}

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = getTempPath(filePath);
  await writeFile(tempPath, content, 'utf-8');

  try {
    await renameReplacing(tempPath, filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT' && process.platform === 'win32') {
      await writeFile(filePath, content, 'utf-8');
      try {
        await unlink(tempPath);
      } catch {}
      return;
    }

    try {
      await unlink(tempPath);
    } catch {}
    throw error;
  }
}

export async function atomicWriteLocked(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await withLock(filePath, async () => {
    await atomicWriteFile(filePath, content);
  });
}
