import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join, isAbsolute } from 'path';
import { rm, mkdir, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import {
  getRegistryPath,
  getRegistry,
  registerProject,
  unregisterProject,
  listRegisteredProjects,
} from '../src/registry';

// Each test run gets a unique temp directory to avoid collisions
const TEST_DIR = join(tmpdir(), `test-registry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const GOLDFISH_DIR = join(TEST_DIR, '.goldfish');

beforeEach(async () => {
  await mkdir(GOLDFISH_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('Registry path', () => {
  it('returns ~/.goldfish/registry.json', () => {
    const path = getRegistryPath();
    expect(path).toMatch(/\.goldfish[/\\]registry\.json$/);
    // Should be an absolute path starting from home
    expect(isAbsolute(path)).toBe(true);
  });
});

describe('Get registry', () => {
  it('returns empty registry when file does not exist', async () => {
    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry).toEqual({ projects: [] });
  });

  it('reads existing registry file', async () => {
    const registryData = {
      projects: [
        { path: '/home/user/project-a', name: 'project-a', registered: '2025-10-14T00:00:00.000Z' },
      ],
    };
    await writeFile(join(GOLDFISH_DIR, 'registry.json'), JSON.stringify(registryData), 'utf-8');

    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry.projects).toHaveLength(1);
    const entry = registry.projects[0]!;
    expect(entry.path).toBe('/home/user/project-a');
    expect(entry.name).toBe('project-a');
    expect(entry.registered).toBe('2025-10-14T00:00:00.000Z');
  });

  it('returns empty registry for corrupted JSON', async () => {
    await writeFile(join(GOLDFISH_DIR, 'registry.json'), '{not valid json!!!', 'utf-8');

    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry).toEqual({ projects: [] });
  });
});

describe('Register project', () => {
  it('registers a new project', async () => {
    const projectPath = join(TEST_DIR, 'my-project');
    await mkdir(projectPath, { recursive: true });

    await registerProject(projectPath, GOLDFISH_DIR);

    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry.projects).toHaveLength(1);
    const entry = registry.projects[0]!;
    expect(entry.path).toBe(projectPath.replace(/\\/g, '/'));
    expect(entry.name).toBe('my-project');
    // Timestamp should be a valid ISO 8601 string
    expect(new Date(entry.registered).toISOString()).toBe(entry.registered);
  });

  it('is idempotent (no duplicate entries)', async () => {
    const projectPath = join(TEST_DIR, 'my-project');
    await mkdir(projectPath, { recursive: true });

    await registerProject(projectPath, GOLDFISH_DIR);
    await registerProject(projectPath, GOLDFISH_DIR);
    await registerProject(projectPath, GOLDFISH_DIR);

    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry.projects).toHaveLength(1);
  });

  it('uses normalizeWorkspace for name', async () => {
    const projectPath = join(TEST_DIR, 'My_Fancy.Project');
    await mkdir(projectPath, { recursive: true });

    await registerProject(projectPath, GOLDFISH_DIR);

    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry.projects[0]!.name).toBe('my-fancy-project');
  });

  it('stores absolute path', async () => {
    // Use a relative-ish path (with ..) to verify it gets resolved
    const projectPath = join(TEST_DIR, 'a', '..', 'my-project');
    await mkdir(join(TEST_DIR, 'my-project'), { recursive: true });

    await registerProject(projectPath, GOLDFISH_DIR);

    const registry = await getRegistry(GOLDFISH_DIR);
    // Should be resolved to absolute path without ..
    const entry = registry.projects[0]!;
    expect(entry.path).not.toContain('..');
    expect(entry.path).toBe(join(TEST_DIR, 'my-project').replace(/\\/g, '/'));
  });

  it('creates goldfish directory if needed', async () => {
    // Remove the pre-created goldfish dir
    await rm(GOLDFISH_DIR, { recursive: true, force: true });

    const nestedDir = join(TEST_DIR, 'nested', '.goldfish');
    const projectPath = join(TEST_DIR, 'my-project');
    await mkdir(projectPath, { recursive: true });

    await registerProject(projectPath, nestedDir);

    const registry = await getRegistry(nestedDir);
    expect(registry.projects).toHaveLength(1);
  });

  it('handles concurrent registrations safely', async () => {
    const projects = Array.from({ length: 5 }, (_, i) => join(TEST_DIR, `project-${i}`));
    await Promise.all(projects.map(p => mkdir(p, { recursive: true })));

    // Register all 5 concurrently
    await Promise.all(projects.map(p => registerProject(p, GOLDFISH_DIR)));

    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry.projects).toHaveLength(5);

    // Each project should appear exactly once (normalize paths for cross-platform comparison)
    const paths = registry.projects.map(p => p.path).sort();
    const expectedPaths = projects.map(p => p.replace(/\\/g, '/')).sort();
    expect(paths).toEqual(expectedPaths);
  });

  it('stores paths with forward slashes (cross-platform normalization)', async () => {
    const projectPath = join(TEST_DIR, 'slash-test');
    await mkdir(projectPath, { recursive: true });

    await registerProject(projectPath, GOLDFISH_DIR);

    const registry = await getRegistry(GOLDFISH_DIR);
    // Stored path should use forward slashes only (no backslashes)
    expect(registry.projects[0]!.path).not.toContain('\\');
  });

  it('deduplicates paths with mixed separators', async () => {
    const projectPath = join(TEST_DIR, 'dedup-test');
    await mkdir(projectPath, { recursive: true });

    // Pre-populate registry with a backslash version of the path
    // (simulates a Windows-created entry being read on any OS)
    const backslashPath = projectPath.replace(/\//g, '\\');
    const seedRegistry = {
      projects: [{
        path: backslashPath,
        name: 'dedup-test',
        registered: new Date().toISOString()
      }]
    };
    await writeFile(join(GOLDFISH_DIR, 'registry.json'), JSON.stringify(seedRegistry), 'utf-8');

    // Register with forward slashes — should detect the existing backslash entry
    await registerProject(projectPath, GOLDFISH_DIR);

    const registry = await getRegistry(GOLDFISH_DIR);
    // Should still be a single entry, not duplicated
    expect(registry.projects).toHaveLength(1);
  });
});

describe('Unregister project', () => {
  it('removes a registered project', async () => {
    const projectPath = join(TEST_DIR, 'my-project');
    await mkdir(projectPath, { recursive: true });

    await registerProject(projectPath, GOLDFISH_DIR);
    expect((await getRegistry(GOLDFISH_DIR)).projects).toHaveLength(1);

    await unregisterProject(projectPath, GOLDFISH_DIR);
    expect((await getRegistry(GOLDFISH_DIR)).projects).toHaveLength(0);
  });

  it('creates goldfish directory if needed', async () => {
    // Remove the pre-created goldfish dir
    await rm(GOLDFISH_DIR, { recursive: true, force: true });

    const nestedDir = join(TEST_DIR, 'nested', '.goldfish');
    const projectPath = join(TEST_DIR, 'my-project');
    await mkdir(projectPath, { recursive: true });

    // Should not throw even when the directory doesn't exist yet
    await unregisterProject(projectPath, nestedDir);

    // Directory should have been created
    const registry = await getRegistry(nestedDir);
    expect(registry).toEqual({ projects: [] });
  });

  it('is no-op for unregistered project', async () => {
    const projectPath = join(TEST_DIR, 'my-project');
    await mkdir(projectPath, { recursive: true });

    // Register one project
    await registerProject(projectPath, GOLDFISH_DIR);

    // Try to unregister a different project - should not throw
    await unregisterProject(join(TEST_DIR, 'nonexistent'), GOLDFISH_DIR);

    // Original project should still be there (normalize for comparison)
    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0]!.path).toBe(projectPath.replace(/\\/g, '/'));
  });
});

describe('List registered projects', () => {
  it('returns empty array when no projects registered', async () => {
    const projects = await listRegisteredProjects(GOLDFISH_DIR);
    expect(projects).toEqual([]);
  });

  it('returns registered projects', async () => {
    const projectPath = join(TEST_DIR, 'my-project');
    await mkdir(join(projectPath, '.memories'), { recursive: true });

    await registerProject(projectPath, GOLDFISH_DIR);

    const projects = await listRegisteredProjects(GOLDFISH_DIR);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.path).toBe(projectPath.replace(/\\/g, '/'));
    expect(projects[0]!.name).toBe('my-project');
  });

  it('filters out stale projects (no .memories/ directory)', async () => {
    const validProject = join(TEST_DIR, 'valid-project');
    const staleProject = join(TEST_DIR, 'stale-project');
    await mkdir(join(validProject, '.memories'), { recursive: true });
    await mkdir(staleProject, { recursive: true }); // No .memories/

    await registerProject(validProject, GOLDFISH_DIR);
    await registerProject(staleProject, GOLDFISH_DIR);

    const projects = await listRegisteredProjects(GOLDFISH_DIR);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.path).toBe(validProject.replace(/\\/g, '/'));
  });

  it('sorts by name', async () => {
    const projectC = join(TEST_DIR, 'charlie');
    const projectA = join(TEST_DIR, 'alpha');
    const projectB = join(TEST_DIR, 'bravo');

    for (const p of [projectC, projectA, projectB]) {
      await mkdir(join(p, '.memories'), { recursive: true });
    }

    // Register in non-alphabetical order
    await registerProject(projectC, GOLDFISH_DIR);
    await registerProject(projectA, GOLDFISH_DIR);
    await registerProject(projectB, GOLDFISH_DIR);

    const projects = await listRegisteredProjects(GOLDFISH_DIR);
    expect(projects.map(p => p.name)).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('does not modify registry file when filtering stale entries', async () => {
    const validProject = join(TEST_DIR, 'valid-project');
    const staleProject = join(TEST_DIR, 'stale-project');
    await mkdir(join(validProject, '.memories'), { recursive: true });
    await mkdir(staleProject, { recursive: true }); // No .memories/

    await registerProject(validProject, GOLDFISH_DIR);
    await registerProject(staleProject, GOLDFISH_DIR);

    // Read registry file content before listing
    const beforeContent = await readFile(join(GOLDFISH_DIR, 'registry.json'), 'utf-8');

    // List should filter stale entries
    const projects = await listRegisteredProjects(GOLDFISH_DIR);
    expect(projects).toHaveLength(1);

    // Registry file should be unchanged
    const afterContent = await readFile(join(GOLDFISH_DIR, 'registry.json'), 'utf-8');
    expect(afterContent).toBe(beforeContent);
  });
});
