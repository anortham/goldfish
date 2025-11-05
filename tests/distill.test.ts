import { describe, it, expect, beforeEach } from 'bun:test';
import { distillCheckpoints, buildDistillPrompt, simpleExtraction } from '../src/distill';
import type { Checkpoint } from '../src/types';

describe('Distillation module', () => {
  const sampleCheckpoints: Checkpoint[] = [
    {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: 'Fixed authentication bug in JWT token validation. The issue was in the token expiry check logic.',
      tags: ['bug-fix', 'auth', 'security'],
      gitBranch: 'fix/auth-bug',
      files: ['src/auth/jwt.ts']
    },
    {
      timestamp: '2025-11-05T11:00:00.000Z',
      description: 'Added user login with OAuth2 integration for Google and GitHub providers.',
      tags: ['feature', 'auth'],
      gitBranch: 'feature/oauth2',
      files: ['src/auth/oauth.ts', 'src/auth/providers.ts']
    },
    {
      timestamp: '2025-11-05T12:00:00.000Z',
      description: 'Refactored database migration scripts to use TypeORM. Improved error handling and rollback support.',
      tags: ['refactor', 'database'],
      gitBranch: 'refactor/migrations',
      files: ['src/db/migrations/']
    }
  ];

  describe('buildDistillPrompt', () => {
    it('creates a prompt with checkpoint details', () => {
      const prompt = buildDistillPrompt(sampleCheckpoints, 'authentication work', 500);

      expect(prompt).toContain('Session Context: authentication work');
      expect(prompt).toContain('Retrieved Checkpoints (3 items)');
      expect(prompt).toContain('Fixed authentication bug');
      expect(prompt).toContain('OAuth2 integration');
      expect(prompt).toContain('database migration');
      expect(prompt).toContain('500 tokens max');
    });

    it('includes tags, branches, and files in prompt', () => {
      const prompt = buildDistillPrompt(sampleCheckpoints.slice(0, 1), 'auth bug', 300);

      expect(prompt).toContain('Tags: bug-fix, auth, security');
      expect(prompt).toContain('Branch: fix/auth-bug');
      expect(prompt).toContain('Files: src/auth/jwt.ts');
    });

    it('handles checkpoints without optional fields', () => {
      const minimalCheckpoint: Checkpoint = {
        timestamp: '2025-11-05T10:00:00.000Z',
        description: 'Simple checkpoint'
      };

      const prompt = buildDistillPrompt([minimalCheckpoint], 'test', 500);

      expect(prompt).toContain('Simple checkpoint');
      expect(prompt).toContain('Tags: none');
      expect(prompt).toContain('Branch: unknown');
      expect(prompt).toContain('Files: none');
    });
  });

  describe('simpleExtraction', () => {
    it('creates a simple bullet-point summary', () => {
      const result = simpleExtraction(sampleCheckpoints);

      expect(result.summary).toContain('Recent work:');
      expect(result.provider).toBe('simple');
      expect(result.cached).toBe(false);
      expect(result.tokensIn).toBe(0);
      expect(result.tokensOut).toBeGreaterThan(0);
      expect(result.latencyMs).toBe(0);
    });

    it('uses summaries when available', () => {
      const checkpointsWithSummaries: Checkpoint[] = [
        {
          timestamp: '2025-11-05T10:00:00.000Z',
          description: 'This is a very long description that goes on and on.',
          summary: 'Short summary'
        }
      ];

      const result = simpleExtraction(checkpointsWithSummaries);

      expect(result.summary).toContain('Short summary');
      expect(result.summary).not.toContain('very long description');
    });

    it('falls back to first sentence when no summary', () => {
      const checkpoints: Checkpoint[] = [
        {
          timestamp: '2025-11-05T10:00:00.000Z',
          description: 'First sentence. Second sentence. Third sentence.'
        }
      ];

      const result = simpleExtraction(checkpoints);

      expect(result.summary).toContain('First sentence');
      expect(result.summary).not.toContain('Second sentence');
    });
  });

  describe('distillCheckpoints', () => {
    it('falls back to simple extraction when no CLI available', async () => {
      const result = await distillCheckpoints(
        sampleCheckpoints,
        'authentication work',
        { provider: 'none' }
      );

      expect(result.provider).toBe('simple');
      expect(result.summary).toContain('Recent work:');
      expect(result.cached).toBe(false);
    });

    it('returns result with expected structure', async () => {
      const result = await distillCheckpoints(
        sampleCheckpoints,
        'auth bug fixes',
        { provider: 'none' }
      );

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('provider');
      expect(result).toHaveProperty('cached');
      expect(result).toHaveProperty('tokensIn');
      expect(result).toHaveProperty('tokensOut');
      expect(result).toHaveProperty('latencyMs');
    });

    it('handles empty checkpoint array', async () => {
      const result = await distillCheckpoints(
        [],
        'test context',
        { provider: 'none' }
      );

      expect(result.provider).toBe('simple');
      expect(result.summary).toBeDefined();
    });

    it('accepts maxTokens option', async () => {
      const result = await distillCheckpoints(
        sampleCheckpoints,
        'test',
        { provider: 'none', maxTokens: 100 }
      );

      expect(result).toBeDefined();
      // Simple extraction doesn't enforce maxTokens, but should accept the option
    });
  });
});
