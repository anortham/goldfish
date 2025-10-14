import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { recall, searchCheckpoints, parseSince } from '../src/recall';
import { saveCheckpoint } from '../src/checkpoints';
import { savePlan } from '../src/plans';
import { getWorkspacePath, ensureWorkspaceDir } from '../src/workspace';
import { rm } from 'fs/promises';
import type { Checkpoint } from '../src/types';

const TEST_WORKSPACE_A = `test-recall-a-${Date.now()}`;
const TEST_WORKSPACE_B = `test-recall-b-${Date.now()}`;

beforeEach(async () => {
  await ensureWorkspaceDir(TEST_WORKSPACE_A);
  await ensureWorkspaceDir(TEST_WORKSPACE_B);
});

afterEach(async () => {
  await rm(getWorkspacePath(TEST_WORKSPACE_A), { recursive: true, force: true });
  await rm(getWorkspacePath(TEST_WORKSPACE_B), { recursive: true, force: true });
});

describe('Basic recall functionality', () => {
  beforeEach(async () => {
    // Create some test checkpoints
    await saveCheckpoint({
      description: 'Fixed authentication bug',
      tags: ['bug-fix', 'auth'],
      workspace: TEST_WORKSPACE_A
    });

    await saveCheckpoint({
      description: 'Added OAuth2 support',
      tags: ['feature', 'auth'],
      workspace: TEST_WORKSPACE_A
    });

    await saveCheckpoint({
      description: 'Refactored database queries',
      tags: ['refactor', 'database'],
      workspace: TEST_WORKSPACE_A
    });
  });

  it('returns checkpoints from today by default', async () => {
    const result = await recall({ workspace: TEST_WORKSPACE_A });

    expect(result.checkpoints).toHaveLength(3);
    expect(result.checkpoints[0]!.description).toBe('Fixed authentication bug');
  });

  it('filters by number of days', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      days: 1
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('uses current workspace if not specified', async () => {
    // Save checkpoint to current workspace
    const currentWorkspace = process.cwd().split('/').pop()!;
    await ensureWorkspaceDir(currentWorkspace);

    await saveCheckpoint({
      description: 'Current workspace test',
      workspace: currentWorkspace
    });

    const result = await recall({});

    const hasCurrentWorkspace = result.checkpoints.some(
      c => c.description === 'Current workspace test'
    );
    expect(hasCurrentWorkspace).toBe(true);

    // Cleanup
    await rm(getWorkspacePath(currentWorkspace), { recursive: true, force: true });
  });
});

describe('Search functionality', () => {
  beforeEach(async () => {
    await saveCheckpoint({
      description: 'Fixed JWT authentication timeout',
      tags: ['bug-fix', 'auth', 'jwt'],
      workspace: TEST_WORKSPACE_A
    });

    await saveCheckpoint({
      description: 'Added OAuth2 Google integration',
      tags: ['feature', 'auth', 'oauth'],
      workspace: TEST_WORKSPACE_A
    });

    await saveCheckpoint({
      description: 'Refactored user database schema',
      tags: ['refactor', 'database', 'users'],
      workspace: TEST_WORKSPACE_A
    });
  });

  it('searches by description text', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      search: 'authentication'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.description).toContain('JWT authentication');
  });

  it('searches by tags', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      search: 'database'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.tags).toContain('database');
  });

  it('performs fuzzy matching', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      search: 'authenticaton'  // Typo
    });

    // Should still find authentication-related checkpoints
    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('returns empty array when no matches found', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      search: 'nonexistent-term-xyz'
    });

    expect(result.checkpoints).toEqual([]);
  });

  it('ranks results by relevance', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      search: 'auth'
    });

    // Results should be sorted by relevance
    // Checkpoints with 'auth' in description or tags should rank higher
    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(
      result.checkpoints[0]!.description.toLowerCase().includes('auth') ||
      result.checkpoints[0]!.tags?.some(t => t.includes('auth'))
    ).toBe(true);
  });
});

describe('Cross-workspace functionality', () => {
  beforeEach(async () => {
    await saveCheckpoint({
      description: 'Work on project A',
      tags: ['project-a'],
      workspace: TEST_WORKSPACE_A
    });

    await saveCheckpoint({
      description: 'Work on project B',
      tags: ['project-b'],
      workspace: TEST_WORKSPACE_B
    });
  });

  it('aggregates across all workspaces when workspace="all"', async () => {
    const result = await recall({ workspace: 'all', days: 1 });

    expect(result.checkpoints.length).toBeGreaterThanOrEqual(2);

    const hasProjectA = result.checkpoints.some(c => c.tags?.includes('project-a'));
    const hasProjectB = result.checkpoints.some(c => c.tags?.includes('project-b'));

    expect(hasProjectA).toBe(true);
    expect(hasProjectB).toBe(true);
  });

  it('returns workspace summary when workspace="all"', async () => {
    const result = await recall({ workspace: 'all', days: 1 });

    expect(result.workspaces).toBeDefined();
    expect(result.workspaces!.length).toBeGreaterThanOrEqual(2);

    const workspaceNames = result.workspaces!.map(w => w.name);
    expect(workspaceNames).toContain(TEST_WORKSPACE_A);
    expect(workspaceNames).toContain(TEST_WORKSPACE_B);
  });

  it('includes checkpoint count per workspace', async () => {
    const result = await recall({ workspace: 'all', days: 1 });

    const workspaceA = result.workspaces!.find(w => w.name === TEST_WORKSPACE_A);
    expect(workspaceA).toBeDefined();
    expect(workspaceA!.checkpointCount).toBeGreaterThan(0);
  });

  it('searches across all workspaces', async () => {
    const result = await recall({
      workspace: 'all',
      search: 'project',
      days: 1
    });

    expect(result.checkpoints.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Active plan integration', () => {
  beforeEach(async () => {
    await saveCheckpoint({
      description: 'Working on auth',
      workspace: TEST_WORKSPACE_A
    });
  });

  it('includes active plan in recall results', async () => {
    await savePlan({
      id: 'auth-plan',
      title: 'Authentication System',
      content: '## Goals\n- JWT\n- OAuth2',
      workspace: TEST_WORKSPACE_A,
      activate: true
    });

    const result = await recall({ workspace: TEST_WORKSPACE_A });

    expect(result.activePlan).toBeDefined();
    expect(result.activePlan!.id).toBe('auth-plan');
    expect(result.activePlan!.title).toBe('Authentication System');
  });

  it('returns null activePlan when no plan is active', async () => {
    const result = await recall({ workspace: TEST_WORKSPACE_A });

    expect(result.activePlan).toBeNull();
  });

  it('includes active plan even with search filter', async () => {
    await savePlan({
      id: 'test-plan',
      title: 'Test Plan',
      content: 'Content',
      workspace: TEST_WORKSPACE_A,
      activate: true
    });

    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      search: 'auth'  // Search term doesn't match plan
    });

    // Active plan should still be included
    expect(result.activePlan).toBeDefined();
    expect(result.activePlan!.id).toBe('test-plan');
  });
});

describe('Date range filtering', () => {
  it('respects from/to date range', async () => {
    await saveCheckpoint({
      description: 'Test checkpoint',
      workspace: TEST_WORKSPACE_A
    });

    const today = new Date().toISOString().split('T')[0]!;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]!;

    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      from: today,
      to: tomorrow
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('returns empty when date range excludes checkpoints', async () => {
    await saveCheckpoint({
      description: 'Today',
      workspace: TEST_WORKSPACE_A
    });

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
    const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().split('T')[0]!;

    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      from: twoDaysAgo,
      to: yesterday
    });

    expect(result.checkpoints).toEqual([]);
  });
});

describe('Checkpoint search (fuse.js)', () => {
  const checkpoints: Checkpoint[] = [
    {
      timestamp: '2025-10-13T10:00:00.000Z',
      description: 'Fixed authentication bug in JWT validation',
      tags: ['bug-fix', 'auth', 'jwt']
    },
    {
      timestamp: '2025-10-13T11:00:00.000Z',
      description: 'Added OAuth2 Google integration',
      tags: ['feature', 'auth', 'oauth']
    },
    {
      timestamp: '2025-10-13T12:00:00.000Z',
      description: 'Refactored database connection pooling',
      tags: ['refactor', 'database', 'performance']
    }
  ];

  it('searches across description and tags', () => {
    const results = searchCheckpoints('auth', checkpoints);

    expect(results.length).toBeGreaterThan(0);
    expect(results.every(c =>
      c.description.toLowerCase().includes('auth') ||
      c.tags?.some(t => t.includes('auth'))
    )).toBe(true);
  });

  it('returns checkpoints sorted by relevance score', () => {
    const results = searchCheckpoints('authentication', checkpoints);

    // 'authentication bug' should rank higher than 'OAuth2' for this query
    expect(results[0]!.description).toContain('authentication');
  });

  it('handles typos with fuzzy matching', () => {
    const results = searchCheckpoints('databse', checkpoints);  // Typo

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.description).toContain('database');
  });

  it('returns empty array for no matches', () => {
    const results = searchCheckpoints('nonexistent', checkpoints);
    expect(results).toEqual([]);
  });

  it('searches partial words', () => {
    const results = searchCheckpoints('refact', checkpoints);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.description).toContain('Refactored');
  });
});

describe('parseSince - human-friendly time span parser', () => {
  it('parses minutes (30m)', () => {
    const now = new Date();
    const result = parseSince('30m');

    const expectedMs = now.getTime() - (30 * 60 * 1000);
    const tolerance = 100; // 100ms tolerance for test execution time

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });

  it('parses hours (2h)', () => {
    const now = new Date();
    const result = parseSince('2h');

    const expectedMs = now.getTime() - (2 * 60 * 60 * 1000);
    const tolerance = 100;

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });

  it('parses days (3d)', () => {
    const now = new Date();
    const result = parseSince('3d');

    const expectedMs = now.getTime() - (3 * 24 * 60 * 60 * 1000);
    const tolerance = 100;

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });

  it('parses ISO 8601 timestamps', () => {
    const timestamp = '2025-10-14T15:30:00.000Z';
    const result = parseSince(timestamp);

    expect(result.toISOString()).toBe(timestamp);
  });

  it('parses YYYY-MM-DD dates', () => {
    const date = '2025-10-14';
    const result = parseSince(date);

    expect(result.toISOString().split('T')[0]).toBe(date);
  });

  it('throws error for invalid format', () => {
    expect(() => parseSince('invalid')).toThrow(/Invalid since format/);
  });

  it('throws error for invalid unit', () => {
    expect(() => parseSince('5x')).toThrow(/Invalid since format/);
  });

  it('throws error for missing number', () => {
    expect(() => parseSince('h')).toThrow(/Invalid since format/);
  });

  it('handles single digit values', () => {
    const now = new Date();
    const result = parseSince('1h');

    const expectedMs = now.getTime() - (1 * 60 * 60 * 1000);
    const tolerance = 100;

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });

  it('handles large values', () => {
    const now = new Date();
    const result = parseSince('365d');

    const expectedMs = now.getTime() - (365 * 24 * 60 * 60 * 1000);
    const tolerance = 100;

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });
});

describe('recall with since parameter', () => {
  beforeEach(async () => {
    await ensureWorkspaceDir(TEST_WORKSPACE_A);
  });

  afterEach(async () => {
    await rm(getWorkspacePath(TEST_WORKSPACE_A), { recursive: true, force: true });
  });

  it('recalls checkpoints from last 2 hours using "2h"', async () => {
    // Create a checkpoint now
    await saveCheckpoint({
      description: 'Recent work',
      workspace: TEST_WORKSPACE_A
    });

    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      since: '2h'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.description).toBe('Recent work');
  });

  it('recalls checkpoints from last 30 minutes using "30m"', async () => {
    await saveCheckpoint({
      description: 'Very recent work',
      workspace: TEST_WORKSPACE_A
    });

    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      since: '30m'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('recalls checkpoints from last 3 days using "3d"', async () => {
    await saveCheckpoint({
      description: 'Recent work',
      workspace: TEST_WORKSPACE_A
    });

    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      since: '3d'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('recalls checkpoints from ISO timestamp', async () => {
    await saveCheckpoint({
      description: 'Test checkpoint',
      workspace: TEST_WORKSPACE_A
    });

    // Use a timestamp from 1 hour ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      since: oneHourAgo
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('since parameter takes priority over days parameter', async () => {
    await saveCheckpoint({
      description: 'Test',
      workspace: TEST_WORKSPACE_A
    });

    // Both parameters provided - 'since' should win
    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      since: '1h',
      days: 7  // Should be ignored
    });

    // Verify it used 'since' (checkpoints exist)
    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('falls back to days parameter when since not provided', async () => {
    await saveCheckpoint({
      description: 'Test',
      workspace: TEST_WORKSPACE_A
    });

    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      days: 1
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('uses default (2 days) when neither since nor days provided', async () => {
    await saveCheckpoint({
      description: 'Test',
      workspace: TEST_WORKSPACE_A
    });

    const result = await recall({
      workspace: TEST_WORKSPACE_A
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('combines since with search parameter', async () => {
    await saveCheckpoint({
      description: 'Authentication work',
      tags: ['auth'],
      workspace: TEST_WORKSPACE_A
    });

    await saveCheckpoint({
      description: 'Database work',
      tags: ['database'],
      workspace: TEST_WORKSPACE_A
    });

    const result = await recall({
      workspace: TEST_WORKSPACE_A,
      since: '1h',
      search: 'auth'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.description).toContain('Authentication');
  });
});
