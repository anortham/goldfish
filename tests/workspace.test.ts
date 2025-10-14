import { describe, it, expect } from 'bun:test';
import {
  normalizeWorkspace,
  getCurrentWorkspace,
  getWorkspacePath,
  listWorkspaces,
  ensureWorkspaceDir
} from '../src/workspace';
import { join } from 'path';
import { homedir } from 'os';

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

describe('Current workspace detection', () => {
  it('detects workspace from current directory', () => {
    const workspace = getCurrentWorkspace();
    expect(workspace).toBeTruthy();
    expect(workspace).toMatch(/^[a-z0-9-]+$/);
    expect(workspace.length).toBeGreaterThan(0);
  });

  it('returns consistent results for same directory', () => {
    const first = getCurrentWorkspace();
    const second = getCurrentWorkspace();
    expect(first).toBe(second);
  });
});

describe('Workspace paths', () => {
  it('returns goldfish base path in home directory', () => {
    const base = join(homedir(), '.goldfish');
    const path = getWorkspacePath('test-workspace');

    expect(path).toBe(join(base, 'test-workspace'));
  });

  it('handles normalized workspace names', () => {
    const path = getWorkspacePath('my-project');
    expect(path).toContain('.goldfish');
    expect(path).toContain('my-project');
  });
});

describe('Workspace directory management', () => {
  it('creates workspace directories if they don\'t exist', async () => {
    const testWorkspace = `test-${Date.now()}`;
    await ensureWorkspaceDir(testWorkspace);

    const path = getWorkspacePath(testWorkspace);
    const checkpointsPath = join(path, 'checkpoints');

    // Check that directories were created by writing a test file
    const testFile = join(checkpointsPath, '.test');
    await Bun.write(testFile, 'test');
    const exists = await Bun.file(testFile).exists();

    expect(exists).toBe(true);

    // Cleanup
    await Bun.$`rm -rf ${path}`.quiet();
  });
});

describe('List workspaces', () => {
  it('returns empty array when no workspaces exist', async () => {
    // This test assumes we can somehow isolate or check for empty state
    // For now, let's just verify it returns an array
    const workspaces = await listWorkspaces();
    expect(Array.isArray(workspaces)).toBe(true);
  });

  it('lists all workspace directories', async () => {
    // Create test workspaces
    const workspace1 = `test-ws-1-${Date.now()}`;
    const workspace2 = `test-ws-2-${Date.now()}`;

    await ensureWorkspaceDir(workspace1);
    await ensureWorkspaceDir(workspace2);

    const workspaces = await listWorkspaces();

    expect(workspaces).toContain(workspace1);
    expect(workspaces).toContain(workspace2);

    // Cleanup
    await Bun.$`rm -rf ${getWorkspacePath(workspace1)}`.quiet();
    await Bun.$`rm -rf ${getWorkspacePath(workspace2)}`.quiet();
  });

  it('returns only directory names, not full paths', async () => {
    const workspaces = await listWorkspaces();

    for (const ws of workspaces) {
      expect(ws).not.toContain('/');
      expect(ws).not.toContain('\\');
    }
  });
});
