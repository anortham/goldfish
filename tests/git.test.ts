import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getGitContext, isGitRepository, resolveGitCaptureCwd, MAX_GIT_FILES } from '../src/git';

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

    const context = await getGitContext();
    expect(context.files).toBeDefined();
    expect(context.files).toContain('untracked.txt');
  });

  it('returns empty object when not in git repository', async () => {
    originalCwd = process.cwd();
    repoDir = await mkdtemp(join(tmpdir(), 'non-git-'));
    process.chdir(repoDir);

    // Not a git repo
    const context = await getGitContext();
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

    const context = await getGitContext();
    expect(context.files).toBeDefined();
    expect(context.files).toContain('real-change.txt');
    expect(context.files!.every(f => !f.startsWith('.memories/'))).toBe(true);
  });

  it('uses optional cwd parameter instead of process.cwd()', async () => {
    // Create a separate git repo in a temp directory
    const targetDir = await mkdtemp(join(tmpdir(), 'git-cwd-'));
    try {
      await Bun.spawn(['git', 'init'], {
        cwd: targetDir,
        stdout: 'ignore',
        stderr: 'ignore'
      }).exited;

      await writeFile(join(targetDir, 'target-file.txt'), 'hello');
      await Bun.spawn(['git', 'add', 'target-file.txt'], { cwd: targetDir }).exited;
      await Bun.spawn(
        ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
        { cwd: targetDir, stdout: 'ignore', stderr: 'ignore' }
      ).exited;

      // Create an untracked file in the target repo
      await writeFile(join(targetDir, 'new-in-target.txt'), 'content');

      // Call getGitContext with the cwd parameter (NOT changing process.cwd())
      const context = await getGitContext(targetDir);
      expect(context.files).toBeDefined();
      expect(context.files).toContain('new-in-target.txt');
    } finally {
      await rm(targetDir, { recursive: true, force: true });
    }
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

    const context = await getGitContext();
    expect(context.files).toBeDefined();
    expect(context.files!.length).toBe(MAX_GIT_FILES);
  });

  it('includes staged files before the first commit when HEAD is unborn', async () => {
    originalCwd = process.cwd();
    repoDir = await mkdtemp(join(tmpdir(), 'git-unborn-head-'));
    process.chdir(repoDir);

    await Bun.spawn(['git', 'init'], { stdout: 'ignore', stderr: 'ignore' }).exited;

    await writeFile('staged-before-first-commit.txt', 'hello');
    await Bun.spawn(['git', 'add', 'staged-before-first-commit.txt']).exited;

    const context = await getGitContext();
    expect(context.commit).toBeUndefined();
    expect(context.files).toContain('staged-before-first-commit.txt');
  });
});

async function runGitCommand(args: string[], cwd: string): Promise<void> {
  await Bun.spawn(['git', ...args], { cwd, stdout: 'ignore', stderr: 'ignore' }).exited;
}

async function initRepoWithCommit(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await runGitCommand(['init', '-b', 'main'], dir);
  await writeFile(join(dir, 'file.txt'), 'initial');
  await runGitCommand(['add', 'file.txt'], dir);
  await runGitCommand(
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'],
    dir
  );
}

describe('resolveGitCaptureCwd', () => {
  let baseDir: string | null = null;
  let removeWorktree: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (removeWorktree) {
      await removeWorktree();
      removeWorktree = null;
    }
    if (baseDir) {
      await rm(baseDir, { recursive: true, force: true });
      baseDir = null;
    }
  });

  it('resolveGitCaptureCwd uses the worktree toplevel when caller cwd is a same-repo worktree', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'g2-sibling-'));
    const mainDir = join(baseDir, 'main');
    await initRepoWithCommit(mainDir);
    const worktreeDir = join(baseDir, 'wt');
    await runGitCommand(['worktree', 'add', worktreeDir, '-b', 'wt-branch'], mainDir);
    removeWorktree = () => runGitCommand(['worktree', 'remove', '--force', worktreeDir], mainDir);

    const capture = await resolveGitCaptureCwd(mainDir, worktreeDir);

    expect(await realpath(capture.cwd)).toBe(await realpath(worktreeDir));
    expect(capture.worktree).toBeDefined();
    expect(await realpath(capture.worktree!)).toBe(await realpath(worktreeDir));
  });

  it('caller cwd main/src with workspace main keeps query cwd at toplevel and omits worktree', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'g2-subdir-'));
    const mainDir = join(baseDir, 'main');
    await initRepoWithCommit(mainDir);
    const srcDir = join(mainDir, 'src');
    await mkdir(srcDir);
    await writeFile(join(srcDir, 'foo.ts'), 'export {};');

    const capture = await resolveGitCaptureCwd(mainDir, srcDir);

    expect(await realpath(capture.cwd)).toBe(await realpath(mainDir));
    expect(capture.worktree).toBeUndefined();

    const context = await getGitContext(capture.cwd);
    expect(context.files).toContain('src/foo.ts');
  });

  it('mixed-separator path keys compare equal', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'g2-separators-'));
    const mainDir = join(baseDir, 'main');
    await initRepoWithCommit(mainDir);
    const srcDir = join(mainDir, 'src');
    await mkdir(srcDir);

    const noisyCallerCwd = `${mainDir}/.//src/`;
    const noisyWorkspacePath = `${mainDir}//`;
    const capture = await resolveGitCaptureCwd(noisyWorkspacePath, noisyCallerCwd);

    expect(await realpath(capture.cwd)).toBe(await realpath(mainDir));
    expect(capture.worktree).toBeUndefined();
  });

  it('nested git worktree add inside the main tree records git.worktree and the worktree branch', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'g2-nested-'));
    const mainDir = join(baseDir, 'main');
    await initRepoWithCommit(mainDir);
    const worktreeDir = join(mainDir, 'wt');
    await runGitCommand(['worktree', 'add', worktreeDir, '-b', 'nested-branch'], mainDir);
    removeWorktree = () => runGitCommand(['worktree', 'remove', '--force', worktreeDir], mainDir);

    const capture = await resolveGitCaptureCwd(mainDir, worktreeDir);

    expect(await realpath(capture.cwd)).toBe(await realpath(worktreeDir));
    expect(capture.worktree).toBeDefined();
    expect(await realpath(capture.worktree!)).toBe(await realpath(worktreeDir));

    const context = await getGitContext(capture.cwd);
    expect(context.branch).toBe('nested-branch');
  });

  it('different-repo caller cwd uses the workspace path and omits git.worktree', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'g2-other-repo-'));
    const workspaceRepo = join(baseDir, 'workspace');
    const otherRepo = join(baseDir, 'other');
    await initRepoWithCommit(workspaceRepo);
    await initRepoWithCommit(otherRepo);

    const capture = await resolveGitCaptureCwd(workspaceRepo, otherRepo);

    expect(capture.cwd).toBe(workspaceRepo);
    expect(capture.worktree).toBeUndefined();
  });

  it('git-common-dir failure falls back to the workspace path', async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'g2-no-common-'));
    const workspaceRepo = join(baseDir, 'workspace');
    await initRepoWithCommit(workspaceRepo);
    const nonGitDir = join(baseDir, 'plain');
    await mkdir(nonGitDir);

    const fromNonGitCaller = await resolveGitCaptureCwd(workspaceRepo, nonGitDir);
    expect(fromNonGitCaller).toEqual({ cwd: workspaceRepo });

    const fromNonGitWorkspace = await resolveGitCaptureCwd(nonGitDir, workspaceRepo);
    expect(fromNonGitWorkspace).toEqual({ cwd: nonGitDir });

    const fromMissingCaller = await resolveGitCaptureCwd(workspaceRepo, join(baseDir, 'missing'));
    expect(fromMissingCaller).toEqual({ cwd: workspaceRepo });
  });
});
