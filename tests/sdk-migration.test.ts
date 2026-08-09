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

describe('MCP SDK documentation', () => {
  it('documents the MCP v2 server package in maintained technical docs', async () => {
    const maintainedDocs = [
      'AGENTS.md',
      'CLAUDE.md',
      'README.md',
      'CONTRIBUTING.md',
      join('docs', 'IMPLEMENTATION.md')
    ];

    for (const path of maintainedDocs) {
      const content = await readFile(join(repoRoot, path), 'utf-8');
      expect(content).toContain('@modelcontextprotocol/server');
      expect(content).not.toContain('@modelcontextprotocol/sdk');
    }
  });
});
