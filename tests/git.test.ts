import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getGitContext, isGitRepository } from '../src/git';

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
});
