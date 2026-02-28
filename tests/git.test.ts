import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getGitContext, isGitRepository, MAX_GIT_FILES } from '../src/git';

let originalCwd: string | null = null;
let repoDir: string | null = null;

afterEach(async () => {
  if (originalCwd) {
    process.chdir(originalCwd);
    originalCwd = null;
  }
  if (repoDir) {
    await rm(repoDir, { recursive: true, force: true });
    repoDir = null;
  }
});

describe('Git context', () => {
  it('includes untracked files in changed files list', async () => {
    originalCwd = process.cwd();
    repoDir = await mkdtemp(join(tmpdir(), 'git-context-'));
    process.chdir(repoDir);

    await Bun.spawn(['git', 'init'], {
      stdout: 'ignore',
      stderr: 'ignore'
    }).exited;

    await writeFile('tracked.txt', 'initial');
    await Bun.spawn(['git', 'add', 'tracked.txt']).exited;
    await Bun.spawn(
      ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
      { stdout: 'ignore', stderr: 'ignore' }
    ).exited;

    await writeFile('untracked.txt', 'hello');

    const context = getGitContext();
    expect(context.files).toBeDefined();
    expect(context.files).toContain('untracked.txt');
  });

  it('returns empty object when not in git repository', async () => {
    originalCwd = process.cwd();
    repoDir = await mkdtemp(join(tmpdir(), 'non-git-'));
    process.chdir(repoDir);

    // Not a git repo
    const context = getGitContext();
    expect(context).toEqual({});
  });

  it('detects git repository correctly', async () => {
    originalCwd = process.cwd();
    repoDir = await mkdtemp(join(tmpdir(), 'git-detect-'));
    process.chdir(repoDir);

    // Not a git repo initially
    expect(isGitRepository()).toBe(false);

    // Initialize git repo
    await Bun.spawn(['git', 'init'], {
      stdout: 'ignore',
      stderr: 'ignore'
    }).exited;

    // Now it should be detected
    expect(isGitRepository()).toBe(true);
  });

  it('returns false for git detection when git command fails', async () => {
    originalCwd = process.cwd();
    repoDir = await mkdtemp(join(tmpdir(), 'git-fail-'));
    process.chdir(repoDir);

    // Mock git command failure by being in a directory without git
    // The function should handle exceptions gracefully
    expect(isGitRepository()).toBe(false);
  });

  it('excludes .memories/ files from changed files list', async () => {
    originalCwd = process.cwd();
    repoDir = await mkdtemp(join(tmpdir(), 'git-memories-'));
    process.chdir(repoDir);

    await Bun.spawn(['git', 'init'], { stdout: 'ignore', stderr: 'ignore' }).exited;

    await writeFile('tracked.txt', 'initial');
    await Bun.spawn(['git', 'add', 'tracked.txt']).exited;
    await Bun.spawn(
      ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
      { stdout: 'ignore', stderr: 'ignore' }
    ).exited;

    // Create .memories/ files (should be excluded)
    await mkdir('.memories/2026-02-28', { recursive: true });
    await writeFile('.memories/2026-02-28/checkpoint.md', 'checkpoint data');
    await writeFile('.memories/.active-plan', 'some-plan-id');

    // Create a normal untracked file (should be included)
    await writeFile('real-change.txt', 'hello');

    const context = getGitContext();
    expect(context.files).toBeDefined();
    expect(context.files).toContain('real-change.txt');
    expect(context.files!.every(f => !f.startsWith('.memories/'))).toBe(true);
  });

  it('caps file list at MAX_GIT_FILES entries', async () => {
    originalCwd = process.cwd();
    repoDir = await mkdtemp(join(tmpdir(), 'git-cap-'));
    process.chdir(repoDir);

    await Bun.spawn(['git', 'init'], { stdout: 'ignore', stderr: 'ignore' }).exited;

    await writeFile('initial.txt', 'initial');
    await Bun.spawn(['git', 'add', 'initial.txt']).exited;
    await Bun.spawn(
      ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
      { stdout: 'ignore', stderr: 'ignore' }
    ).exited;

    // Create more than MAX_GIT_FILES untracked files
    for (let i = 0; i < MAX_GIT_FILES + 10; i++) {
      await writeFile(`file-${String(i).padStart(3, '0')}.txt`, `content ${i}`);
    }

    const context = getGitContext();
    expect(context.files).toBeDefined();
    expect(context.files!.length).toBe(MAX_GIT_FILES);
  });
});
