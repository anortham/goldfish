import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join, isAbsolute } from 'path';
import { rm, mkdir, writeFile, readFile, readdir } from 'fs/promises';
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

// Flip the case of a Windows drive letter (C: -> c:). Returns the path
// unchanged on POSIX, where paths have no drive letter and case is
// significant, so case-dedup tests degenerate to exact-match dedup there.
function flipDriveLetterCase(path: string): string {
  return path.replace(/^([A-Za-z]):/, (_, drive: string) =>
    (drive === drive.toLowerCase() ? drive.toUpperCase() : drive.toLowerCase()) + ':'
  );
}

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

  it('respects GOLDFISH_HOME env var', () => {
    const savedHome = process.env.GOLDFISH_HOME;
    try {
      process.env.GOLDFISH_HOME = '/tmp/custom-goldfish-home';
      const path = getRegistryPath();
      expect(path).toBe(join('/tmp/custom-goldfish-home', 'registry.json'));
    } finally {
      if (savedHome === undefined) {
        delete process.env.GOLDFISH_HOME;
      } else {
        process.env.GOLDFISH_HOME = savedHome;
      }
    }
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

  it('deduplicates Windows paths that differ only by drive-letter case', async () => {
    const projectPath = join(TEST_DIR, 'case-dedup-test');
    await mkdir(projectPath, { recursive: true });

    // Pre-populate registry with a drive-letter-case variant of the path
    // (simulates a harness whose process.cwd() reports a lowercase drive).
    // On POSIX there is no drive letter, so the variant equals the original
    // and this degenerates to the plain idempotency case.
    const caseVariant = flipDriveLetterCase(projectPath.replace(/\\/g, '/'));
    const seedRegistry = {
      projects: [{
        path: caseVariant,
        name: 'case-dedup-test',
        registered: new Date().toISOString()
      }]
    };
    await writeFile(join(GOLDFISH_DIR, 'registry.json'), JSON.stringify(seedRegistry), 'utf-8');

    await registerProject(projectPath, GOLDFISH_DIR);

    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry.projects).toHaveLength(1);
  });

  it('backs up a corrupt registry instead of silently wiping registered projects', async () => {
    // A corrupt registry.json must not be silently overwritten — that would
    // permanently drop every other registered project on the next write.
    const garbage = '{ "projects": [ {"path": "/home/a/proj-a"  truncated...';
    await writeFile(join(GOLDFISH_DIR, 'registry.json'), garbage, 'utf-8');

    const projectPath = join(TEST_DIR, 'post-corruption');
    await mkdir(projectPath, { recursive: true });
    await registerProject(projectPath, GOLDFISH_DIR);

    // Registry self-heals: the new project is registered.
    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0]!.name).toBe('post-corruption');

    // The corrupt content is preserved in a backup, not destroyed.
    const files = await readdir(GOLDFISH_DIR);
    const backups = files.filter(f => f.startsWith('registry.json.corrupt'));
    expect(backups).toHaveLength(1);
    const backupContent = await readFile(join(GOLDFISH_DIR, backups[0]!), 'utf-8');
    expect(backupContent).toBe(garbage);
  });

  it('backs up a corrupt registry on the unregister path instead of leaving it', async () => {
    // Any mutation attempt against a corrupt registry should preserve the bad
    // content and heal the file, not silently leave the corruption in place.
    const garbage = 'not json at all }{';
    await writeFile(join(GOLDFISH_DIR, 'registry.json'), garbage, 'utf-8');

    const projectPath = join(TEST_DIR, 'never-registered');
    await mkdir(projectPath, { recursive: true });
    await unregisterProject(projectPath, GOLDFISH_DIR);

    // The corrupt content is preserved in a backup.
    const files = await readdir(GOLDFISH_DIR);
    const backups = files.filter(f => f.startsWith('registry.json.corrupt'));
    expect(backups).toHaveLength(1);
    const backupContent = await readFile(join(GOLDFISH_DIR, backups[0]!), 'utf-8');
    expect(backupContent).toBe(garbage);

    // Reads after healing return a clean empty registry, not a parse error.
    const registry = await getRegistry(GOLDFISH_DIR);
    expect(registry.projects).toEqual([]);
  });

  it('leaves no temp or lock files behind after register and unregister', async () => {
    const projectPath = join(TEST_DIR, 'temp-cleanup-project');
    await mkdir(projectPath, { recursive: true });

    await registerProject(projectPath, GOLDFISH_DIR);
    await unregisterProject(projectPath, GOLDFISH_DIR);

    const files = await readdir(GOLDFISH_DIR);
    expect(files.filter(name => name.includes('.tmp.') || name.endsWith('.lock'))).toEqual([]);
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

  it('removes an entry that differs only by drive-letter case', async () => {
    const projectPath = join(TEST_DIR, 'case-unregister-test');
    await mkdir(projectPath, { recursive: true });

    await registerProject(projectPath, GOLDFISH_DIR);
    expect((await getRegistry(GOLDFISH_DIR)).projects).toHaveLength(1);

    // Unregister using a drive-letter-case variant of the same path.
    await unregisterProject(flipDriveLetterCase(projectPath), GOLDFISH_DIR);
    expect((await getRegistry(GOLDFISH_DIR)).projects).toHaveLength(0);
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

  it('collapses case-variant duplicate entries already in the registry file', async () => {
    // Registries written by earlier versions can contain the same project
    // twice under different drive-letter casings. Listing must heal that on
    // read so cross-workspace recall does not scan the project twice.
    const projectPath = join(TEST_DIR, 'case-heal-test');
    await mkdir(join(projectPath, '.memories'), { recursive: true });

    const normalized = projectPath.replace(/\\/g, '/');
    const seedRegistry = {
      projects: [
        { path: normalized, name: 'case-heal-test', registered: '2026-01-01T00:00:00.000Z' },
        { path: flipDriveLetterCase(normalized), name: 'case-heal-test', registered: '2026-02-01T00:00:00.000Z' }
      ]
    };
    await writeFile(join(GOLDFISH_DIR, 'registry.json'), JSON.stringify(seedRegistry), 'utf-8');

    const projects = await listRegisteredProjects(GOLDFISH_DIR);
    expect(projects).toHaveLength(1);
    // First occurrence wins; the registry file itself is not rewritten.
    expect(projects[0]!.path).toBe(normalized);
  });

  it('collapses literal Windows drive-case duplicate entries already in the registry file', async () => {
    const projectPath = join(TEST_DIR, 'drive-case-heal-test');
    await mkdir(join(projectPath, '.memories'), { recursive: true });

    // Two entries differing only in drive-letter case (harnesses vary in the
    // casing process.cwd() reports). On POSIX there is no drive letter, so the
    // variants coincide and this degenerates to the exact-duplicate case.
    const normalized = projectPath.replace(/\\/g, '/');
    const upperDrive = normalized.charAt(0).toUpperCase() + normalized.slice(1);
    const lowerDrive = normalized.charAt(0).toLowerCase() + normalized.slice(1);

    const seedRegistry = {
      projects: [
        { path: upperDrive, name: 'drive-case-heal-test', registered: '2026-01-01T00:00:00.000Z' },
        { path: lowerDrive, name: 'drive-case-heal-test', registered: '2026-02-01T00:00:00.000Z' }
      ]
    };
    await writeFile(join(GOLDFISH_DIR, 'registry.json'), JSON.stringify(seedRegistry), 'utf-8');

    const projects = await listRegisteredProjects(GOLDFISH_DIR);

    expect(projects).toHaveLength(1);
    expect(projects[0]!.path).toBe(upperDrive);
  });

  it('collapses exact duplicate entries already in the registry file', async () => {
    const projectPath = join(TEST_DIR, 'exact-heal-test');
    await mkdir(join(projectPath, '.memories'), { recursive: true });

    const normalized = projectPath.replace(/\\/g, '/');
    const seedRegistry = {
      projects: [
        { path: normalized, name: 'exact-heal-test', registered: '2026-01-01T00:00:00.000Z' },
        { path: normalized.replace(/\//g, '\\'), name: 'exact-heal-test', registered: '2026-02-01T00:00:00.000Z' }
      ]
    };
    await writeFile(join(GOLDFISH_DIR, 'registry.json'), JSON.stringify(seedRegistry), 'utf-8');

    const projects = await listRegisteredProjects(GOLDFISH_DIR);
    expect(projects).toHaveLength(1);
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
