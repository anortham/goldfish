import { describe, it, expect } from 'bun:test';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe('MCP SDK dependencies', () => {
  it('uses the stable v2 server and client package split', async () => {
    const packageJson = JSON.parse(
      await readFile(join(repoRoot, 'package.json'), 'utf-8')
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(packageJson.dependencies['@modelcontextprotocol/server']).toBe('^2.0.0');
    expect(packageJson.devDependencies['@modelcontextprotocol/client']).toBe('^2.0.0');
    expect(packageJson.dependencies).not.toHaveProperty('@modelcontextprotocol/sdk');
  });
});
