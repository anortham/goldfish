import { describe, it, expect, afterEach } from 'bun:test';
import {
  normalizeWorkspace,
  resolveWorkspace,
  getMemoriesDir,
  getBriefsDir,
  getPlansDir,
  ensureMemoriesDir,
  getGoldfishHomeDir,
  getSemanticWorkspaceKey,
  getConsolidationStateDir,
  getConsolidationStatePath,
} from '../src/workspace';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { rm, stat } from 'fs/promises';
import { pathToFileURL } from 'url';

describe('Workspace normalization', () => {
  it('normalizes full Unix path to simple name', () => {
    expect(normalizeWorkspace('/Users/user/source/goldfish'))
      .toBe('goldfish');
    expect(normalizeWorkspace('/Users/user/source/goldfish/'))
      .toBe('goldfish');
  });

  it('normalizes full Windows path to simple name', () => {
    expect(normalizeWorkspace('C:\\source\\goldfish'))
      .toBe('goldfish');
    expect(normalizeWorkspace('C:\\source\\goldfish\\'))
      .toBe('goldfish');
    expect(normalizeWorkspace('C:\\Users\\user\\source\\goldfish'))
      .toBe('goldfish');
  });

  it('handles package names (@org/name → org-name)', () => {
    expect(normalizeWorkspace('@coa/goldfish-mcp'))
      .toBe('coa-goldfish-mcp');
    expect(normalizeWorkspace('@modelcontextprotocol/sdk'))
      .toBe('modelcontextprotocol-sdk');
  });

  it('handles scoped package paths in filesystem paths', () => {
    expect(normalizeWorkspace('/home/dev/@org/project'))
      .toBe('org-project');
    expect(normalizeWorkspace('/Users/dev/source/@org/my-project'))
      .toBe('org-my-project');
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
  const originalCwd = process.cwd();

  function makeTmpDir(): string {
    const dir = join(tmpdir(), `test-goldfish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    process.chdir(originalCwd);

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
      expect(getMemoriesDir('/some/path')).toBe(join('/some/path', '.memories'));
      expect(getMemoriesDir('/Users/user/source/goldfish')).toBe(join('/Users/user/source/goldfish', '.memories'));
    });
  });

  describe('getPlansDir', () => {
    it('returns {cwd}/.memories/plans/ when no arg is provided', () => {
      const result = getPlansDir();
      expect(result).toBe(join(process.cwd(), '.memories', 'plans'));
    });

    it('returns {projectPath}/.memories/plans/ when a path is provided', () => {
      expect(getPlansDir('/some/path')).toBe(join('/some/path', '.memories', 'plans'));
      expect(getPlansDir('/Users/user/source/goldfish')).toBe(join('/Users/user/source/goldfish', '.memories', 'plans'));
    });
  });

  describe('getBriefsDir', () => {
    it('returns {cwd}/.memories/briefs/ when no arg is provided', () => {
      const result = getBriefsDir();
      expect(result).toBe(join(process.cwd(), '.memories', 'briefs'));
    });

    it('returns {projectPath}/.memories/briefs/ when a path is provided', () => {
      expect(getBriefsDir('/some/path')).toBe(join('/some/path', '.memories', 'briefs'));
      expect(getBriefsDir('/Users/user/source/goldfish')).toBe(join('/Users/user/source/goldfish', '.memories', 'briefs'));
    });
  });

  describe('ensureMemoriesDir', () => {
    it('creates .memories/, .memories/briefs/, and .memories/plans/ directories', async () => {
      const tmpDir = makeTmpDir();
      // tmpDir itself doesn't exist yet — ensureMemoriesDir should create it recursively
      await ensureMemoriesDir(tmpDir);

      const memoriesStat = await stat(join(tmpDir, '.memories'));
      expect(memoriesStat.isDirectory()).toBe(true);

      const briefsStat = await stat(join(tmpDir, '.memories', 'briefs'));
      expect(briefsStat.isDirectory()).toBe(true);

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

    it('uses cwd when no arg is provided', async () => {
      const tmpDir = makeTmpDir();
      await Bun.write(join(tmpDir, '.keep'), '');
      process.chdir(tmpDir);

      await ensureMemoriesDir();

      const memoriesStat = await stat(join(tmpDir, '.memories'));
      expect(memoriesStat.isDirectory()).toBe(true);

      const briefsStat = await stat(join(tmpDir, '.memories', 'briefs'));
      expect(briefsStat.isDirectory()).toBe(true);

      const plansStat = await stat(join(tmpDir, '.memories', 'plans'));
      expect(plansStat.isDirectory()).toBe(true);
    });
  });
});

describe('resolveWorkspace', () => {
  const originalEnv = process.env.GOLDFISH_WORKSPACE;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GOLDFISH_WORKSPACE;
    else process.env.GOLDFISH_WORKSPACE = originalEnv;
  });

  it('returns explicit path when provided', () => {
    process.env.GOLDFISH_WORKSPACE = '/env/path';
    expect(resolveWorkspace('/explicit/path')).toBe('/explicit/path');
  });

  it('returns GOLDFISH_WORKSPACE when no explicit path', () => {
    process.env.GOLDFISH_WORKSPACE = '/env/path';
    expect(resolveWorkspace()).toBe('/env/path');
  });

  it('uses the first valid file root when no explicit path or env var exists', () => {
    delete process.env.GOLDFISH_WORKSPACE;

    expect(resolveWorkspace(undefined, {
      roots: [
        { uri: 'https://example.com/not-a-file-root' },
        { uri: pathToFileURL('/roots/project one').href }
      ],
      cwd: '/fallback/cwd'
    })).toBe('/roots/project one');
  });

  it('treats "current" same as undefined', () => {
    process.env.GOLDFISH_WORKSPACE = '/env/path';
    expect(resolveWorkspace('current')).toBe('/env/path');
  });

  it('treats "current" as a roots-aware fallback when env is unset', () => {
    delete process.env.GOLDFISH_WORKSPACE;

    expect(resolveWorkspace('current', {
      roots: [{ uri: pathToFileURL('/roots/current-project').href }],
      cwd: '/fallback/cwd'
    })).toBe('/roots/current-project');
  });

  it('prefers env var over roots', () => {
    process.env.GOLDFISH_WORKSPACE = '/env/path';

    expect(resolveWorkspace(undefined, {
      roots: [{ uri: pathToFileURL('/roots/project').href }],
      cwd: '/fallback/cwd'
    })).toBe('/env/path');
  });

  it('falls back to cwd when no env var', () => {
    delete process.env.GOLDFISH_WORKSPACE;
    expect(resolveWorkspace()).toBe(process.cwd());
  });

  it('ignores empty string GOLDFISH_WORKSPACE', () => {
    process.env.GOLDFISH_WORKSPACE = '';
    expect(resolveWorkspace()).toBe(process.cwd());
  });

  it('falls back to cwd when roots are empty or invalid', () => {
    delete process.env.GOLDFISH_WORKSPACE;

    expect(resolveWorkspace(undefined, {
      roots: [
        { uri: 'notaurl' },
        { uri: 'https://example.com/not-a-file-root' }
      ],
      cwd: '/fallback/cwd'
    })).toBe('/fallback/cwd');
  });
});

describe('Goldfish home and workspace key', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  });

  it('uses the goldfish home directory from HOME or USERPROFILE', () => {
    process.env.HOME = '/test/home';
    process.env.USERPROFILE = '/test/profile';
    expect(getGoldfishHomeDir()).toBe(join('/test/home', '.goldfish'));

    delete process.env.HOME;
    expect(getGoldfishHomeDir()).toBe(join('/test/profile', '.goldfish'));
  });

  it('uses GOLDFISH_HOME when set, ignoring HOME and USERPROFILE', () => {
    const originalGoldfishHome = process.env.GOLDFISH_HOME;

    try {
      process.env.GOLDFISH_HOME = '/custom/goldfish';
      process.env.HOME = '/test/home';
      process.env.USERPROFILE = '/test/profile';

      expect(getGoldfishHomeDir()).toBe('/custom/goldfish');
    } finally {
      if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME;
      else process.env.GOLDFISH_HOME = originalGoldfishHome;
    }
  });

  it('normalizes relative and absolute paths to the same workspace key', () => {
    const absolutePath = resolve(process.cwd(), 'fixtures/semantic-workspace');
    const relativePath = './fixtures/semantic-workspace';

    expect(getSemanticWorkspaceKey(relativePath))
      .toBe(getSemanticWorkspaceKey(absolutePath));
  });

  it('returns a stable key for the same path and a different key for different paths', () => {
    const firstPath = resolve('/workspace/one');
    const secondPath = resolve('/workspace/two');

    expect(getSemanticWorkspaceKey(firstPath))
      .toBe(getSemanticWorkspaceKey(firstPath));
    expect(getSemanticWorkspaceKey(firstPath))
      .not.toBe(getSemanticWorkspaceKey(secondPath));
  });
});

describe('getConsolidationStateDir', () => {
  it('returns path under goldfish home', () => {
    const result = getConsolidationStateDir();
    expect(result).toBe(join(getGoldfishHomeDir(), 'consolidation-state'));
  });
});

describe('getConsolidationStatePath', () => {
  it('returns per-workspace JSON file path with hash suffix', () => {
    const projectPath = '/Users/dev/source/goldfish';
    const key = getSemanticWorkspaceKey(projectPath);
    const result = getConsolidationStatePath(projectPath);
    expect(result).toBe(join(getGoldfishHomeDir(), 'consolidation-state', `goldfish_${key}.json`));
  });

  it('normalizes workspace name and appends hash suffix', () => {
    const projectPath = '/Users/dev/source/@org/my-project';
    const key = getSemanticWorkspaceKey(projectPath);
    const result = getConsolidationStatePath(projectPath);
    expect(result).toBe(join(getGoldfishHomeDir(), 'consolidation-state', `org-my-project_${key}.json`));
  });

  it('produces different filenames for two projects with the same directory name', () => {
    const workPath = '/work/app';
    const personalPath = '/personal/app';
    expect(getConsolidationStatePath(workPath)).not.toBe(getConsolidationStatePath(personalPath));
  });
});
