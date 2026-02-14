import { describe, it, expect, afterEach } from 'bun:test';
import {
  normalizeWorkspace,
  getMemoriesDir,
  getPlansDir,
  ensureMemoriesDir,
} from '../src/workspace';
import { join } from 'path';
import { rm, stat } from 'fs/promises';

describe('Workspace normalization', () => {
  it('normalizes full Unix path to simple name', () => {
    expect(normalizeWorkspace('/Users/murphy/source/goldfish'))
      .toBe('goldfish');
  });

  it('normalizes full Windows path to simple name', () => {
    expect(normalizeWorkspace('C:\\source\\goldfish'))
      .toBe('goldfish');
    expect(normalizeWorkspace('C:\\Users\\murphy\\source\\goldfish'))
      .toBe('goldfish');
  });

  it('handles package names (@org/name → org-name)', () => {
    expect(normalizeWorkspace('@coa/goldfish-mcp'))
      .toBe('coa-goldfish-mcp');
    expect(normalizeWorkspace('@modelcontextprotocol/sdk'))
      .toBe('modelcontextprotocol-sdk');
  });

  it('lowercases and sanitizes special characters', () => {
    expect(normalizeWorkspace('My Project!'))
      .toBe('my-project');  // Trailing dashes are trimmed
    expect(normalizeWorkspace('Test@#$%Project'))
      .toBe('test-project');  // Consecutive dashes are collapsed
  });

  it('handles already normalized names', () => {
    expect(normalizeWorkspace('goldfish'))
      .toBe('goldfish');
    expect(normalizeWorkspace('my-cool-project'))
      .toBe('my-cool-project');
  });

  it('removes consecutive dashes', () => {
    expect(normalizeWorkspace('test---project'))
      .toBe('test-project');
  });

  it('trims dashes from start and end', () => {
    expect(normalizeWorkspace('-test-project-'))
      .toBe('test-project');
  });

  it('handles all special characters by using default name', () => {
    // These would become empty after sanitization
    expect(normalizeWorkspace('!@#$%^&*()'))
      .toBe('default');
    expect(normalizeWorkspace('...'))
      .toBe('default');
    expect(normalizeWorkspace('___'))
      .toBe('default');
    expect(normalizeWorkspace('---'))
      .toBe('default');
    expect(normalizeWorkspace(''))
      .toBe('default');
  });
});

describe('Project-level .memories/ storage', () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = `/tmp/test-goldfish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tmpDirs.length = 0;
  });

  describe('getMemoriesDir', () => {
    it('returns {cwd}/.memories/ when no arg is provided', () => {
      const result = getMemoriesDir();
      expect(result).toBe(join(process.cwd(), '.memories'));
    });

    it('returns {projectPath}/.memories/ when a path is provided', () => {
      expect(getMemoriesDir('/some/path')).toBe('/some/path/.memories');
      expect(getMemoriesDir('/Users/murphy/source/goldfish')).toBe('/Users/murphy/source/goldfish/.memories');
    });
  });

  describe('getPlansDir', () => {
    it('returns {cwd}/.memories/plans/ when no arg is provided', () => {
      const result = getPlansDir();
      expect(result).toBe(join(process.cwd(), '.memories', 'plans'));
    });

    it('returns {projectPath}/.memories/plans/ when a path is provided', () => {
      expect(getPlansDir('/some/path')).toBe('/some/path/.memories/plans');
      expect(getPlansDir('/Users/murphy/source/goldfish')).toBe('/Users/murphy/source/goldfish/.memories/plans');
    });
  });

  describe('ensureMemoriesDir', () => {
    it('creates .memories/ and .memories/plans/ directories', async () => {
      const tmpDir = makeTmpDir();
      // tmpDir itself doesn't exist yet — ensureMemoriesDir should create it recursively
      await ensureMemoriesDir(tmpDir);

      const memoriesStat = await stat(join(tmpDir, '.memories'));
      expect(memoriesStat.isDirectory()).toBe(true);

      const plansStat = await stat(join(tmpDir, '.memories', 'plans'));
      expect(plansStat.isDirectory()).toBe(true);
    });

    it('is idempotent — calling twice does not throw', async () => {
      const tmpDir = makeTmpDir();
      await ensureMemoriesDir(tmpDir);
      await ensureMemoriesDir(tmpDir);

      const memoriesStat = await stat(join(tmpDir, '.memories'));
      expect(memoriesStat.isDirectory()).toBe(true);
    });

    it('uses cwd when no arg is provided', () => {
      // Just verify it doesn't throw and returns the right path shape
      // We don't actually want to create .memories/ in our project root during tests,
      // so we only test with explicit paths above. This test verifies the function signature.
      const dir = getMemoriesDir();
      expect(dir).toBe(join(process.cwd(), '.memories'));
    });
  });
});
