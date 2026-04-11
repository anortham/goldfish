import { dirname } from 'path';
import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import { withLock } from './lock';

let tempFileCounter = 0;

function getTempPath(filePath: string): string {
  tempFileCounter += 1;
  return `${filePath}.tmp.${Date.now()}.${process.pid}.${tempFileCounter}`;
}

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = getTempPath(filePath);
  await writeFile(tempPath, content, 'utf-8');

  try {
    await rename(tempPath, filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT' && process.platform === 'win32') {
      await writeFile(filePath, content, 'utf-8');
      try {
        await unlink(tempPath);
      } catch {}
      return;
    }

    throw error;
  }
}

export async function atomicWriteLocked(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await withLock(filePath, async () => {
    await atomicWriteFile(filePath, content);
  });
}
