import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// Logger tests use a temp directory to avoid polluting ~/.goldfish/logs/
let TEST_LOG_DIR: string;

beforeEach(async () => {
  TEST_LOG_DIR = await mkdtemp(join(tmpdir(), 'goldfish-logger-'));
});

afterEach(async () => {
  // Reset the logger module between tests
  const { _resetForTests } = await import('../src/logger');
  _resetForTests();
  await rm(TEST_LOG_DIR, { recursive: true, force: true });
});

describe('logger', () => {
  describe('initialization', () => {
    it('creates log directory on first write', async () => {
      const logDir = join(TEST_LOG_DIR, 'logs');
      const { createLogger } = await import('../src/logger');
      const log = createLogger({ logDir });

      await log.info('test message');
      await log.flush();

      const files = await readdir(logDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^goldfish-\d{4}-\d{2}-\d{2}\.log$/);
    });
  });

  describe('log levels', () => {
    it('writes info messages', async () => {
      const { createLogger } = await import('../src/logger');
      const log = createLogger({ logDir: TEST_LOG_DIR });

      await log.info('server started');
      await log.flush();

      const files = await readdir(TEST_LOG_DIR);
      expect(files.length).toBeGreaterThan(0);
      const content = await readFile(join(TEST_LOG_DIR, files[0]!), 'utf-8');
      expect(content).toContain('[INFO]');
      expect(content).toContain('server started');
    });

    it('writes warn messages', async () => {
      const { createLogger } = await import('../src/logger');
      const log = createLogger({ logDir: TEST_LOG_DIR });

      await log.warn('stale lock detected');
      await log.flush();

      const files = await readdir(TEST_LOG_DIR);
      expect(files.length).toBeGreaterThan(0);
      const content = await readFile(join(TEST_LOG_DIR, files[0]!), 'utf-8');
      expect(content).toContain('[WARN]');
      expect(content).toContain('stale lock detected');
    });

    it('writes error messages with optional error object', async () => {
      const { createLogger } = await import('../src/logger');
      const log = createLogger({ logDir: TEST_LOG_DIR });

      const err = new Error('something broke');
      await log.error('plan save failed', err);
      await log.flush();

      const files = await readdir(TEST_LOG_DIR);
      expect(files.length).toBeGreaterThan(0);
      const content = await readFile(join(TEST_LOG_DIR, files[0]!), 'utf-8');
      expect(content).toContain('[ERROR]');
      expect(content).toContain('plan save failed');
      expect(content).toContain('something broke');
    });

    it('writes debug messages only when level is debug', async () => {
      const { createLogger } = await import('../src/logger');

      // Default level (info) should skip debug
      const log1 = createLogger({ logDir: TEST_LOG_DIR, level: 'info' });
      await log1.debug('hidden message');
      await log1.flush();

      const files1 = await readdir(TEST_LOG_DIR);
      if (files1.length > 0) {
        const content = await readFile(join(TEST_LOG_DIR, files1[0]!), 'utf-8');
        expect(content).not.toContain('hidden message');
      }

      // Debug level should include debug
      const { _resetForTests } = await import('../src/logger');
      _resetForTests();

      const log2 = createLogger({ logDir: TEST_LOG_DIR, level: 'debug' });
      await log2.debug('visible message');
      await log2.flush();

      const files2 = await readdir(TEST_LOG_DIR);
      expect(files2.length).toBeGreaterThan(0);
      const content2 = await readFile(join(TEST_LOG_DIR, files2[files2.length - 1]!), 'utf-8');
      expect(content2).toContain('[DEBUG]');
      expect(content2).toContain('visible message');
    });
  });

  describe('log format', () => {
    it('includes ISO timestamp', async () => {
      const { createLogger } = await import('../src/logger');
      const log = createLogger({ logDir: TEST_LOG_DIR });

      await log.info('test');
      await log.flush();

      const files = await readdir(TEST_LOG_DIR);
      expect(files.length).toBeGreaterThan(0);
      const content = await readFile(join(TEST_LOG_DIR, files[0]!), 'utf-8');
      // ISO 8601 timestamp pattern
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('each log entry is one line', async () => {
      const { createLogger } = await import('../src/logger');
      const log = createLogger({ logDir: TEST_LOG_DIR });

      await log.info('first');
      await log.info('second');
      await log.flush();

      const files = await readdir(TEST_LOG_DIR);
      expect(files.length).toBeGreaterThan(0);
      const content = await readFile(join(TEST_LOG_DIR, files[0]!), 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2);
      expect(lines[0]!).toContain('first');
      expect(lines[1]!).toContain('second');
    });
  });

  describe('rotation', () => {
    it('cleans up log files older than retention period', async () => {
      const { createLogger } = await import('../src/logger');

      // Create fake old log files
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      const oldFileName = `goldfish-${oldDate.toISOString().slice(0, 10)}.log`;
      await writeFile(join(TEST_LOG_DIR, oldFileName), 'old log content');

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 1);
      const recentFileName = `goldfish-${recentDate.toISOString().slice(0, 10)}.log`;
      await writeFile(join(TEST_LOG_DIR, recentFileName), 'recent log content');

      const log = createLogger({ logDir: TEST_LOG_DIR, retentionDays: 7 });
      await log.cleanup();

      const files = await readdir(TEST_LOG_DIR);
      expect(files).not.toContain(oldFileName);
      expect(files).toContain(recentFileName);
    });
  });

  describe('resilience', () => {
    it('does not throw when log directory is unwritable', async () => {
      const { createLogger } = await import('../src/logger');
      const log = createLogger({ logDir: '/nonexistent/deeply/nested/path' });

      // Should not throw, logging failures are silent
      await log.info('this should not throw');
    });
  });
});
