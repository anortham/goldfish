import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteFile, atomicWriteLocked } from '../src/file-io';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'goldfish-file-io-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('atomicWriteFile', () => {
  it('writes content without leaving temp files behind', async () => {
    const filePath = join(tempDir, 'sample.json');
    await atomicWriteFile(filePath, '{"ok":true}\n');

    expect(await readFile(filePath, 'utf-8')).toBe('{"ok":true}\n');
    expect((await readdir(tempDir)).filter(name => name.includes('.tmp.'))).toEqual([]);
  });

  it('handles same-path concurrent writes in the same millisecond', async () => {
    const filePath = join(tempDir, 'colliding.json');
    const originalNow = Date.now;
    Date.now = () => 1234567890;

    try {
      await Promise.all([
        atomicWriteFile(filePath, '{"value":"first"}\n'),
        atomicWriteFile(filePath, '{"value":"second"}\n')
      ]);
    } finally {
      Date.now = originalNow;
    }

    const finalContent = await readFile(filePath, 'utf-8');
    expect(['{"value":"first"}\n', '{"value":"second"}\n']).toContain(finalContent);
    expect((await readdir(tempDir)).filter(name => name.includes('.tmp.'))).toEqual([]);
  });
});

describe('atomicWriteLocked', () => {
  it('serializes overlapping writes to the same file', async () => {
    const filePath = join(tempDir, 'locked.json');
    await Promise.all([
      atomicWriteLocked(filePath, '{"value":"first"}\n'),
      atomicWriteLocked(filePath, '{"value":"second"}\n')
    ]);

    const finalContent = await readFile(filePath, 'utf-8');
    expect(['{"value":"first"}\n', '{"value":"second"}\n']).toContain(finalContent);
    expect((await readdir(tempDir)).filter(name => name.includes('.tmp.'))).toEqual([]);
  });
});
