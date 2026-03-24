/**
 * Simple file logger for Goldfish MCP Server
 *
 * Writes timestamped log lines to ~/.goldfish/logs/goldfish-YYYY-MM-DD.log
 * Async fire-and-forget writes. Silent on failure (logging should never crash the server).
 */

import { appendFile, mkdir, readdir, unlink } from 'fs/promises';
import { join } from 'path';
import { getGoldfishHomeDir } from './workspace.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

interface LoggerOptions {
  logDir?: string;
  level?: LogLevel;
  retentionDays?: number;
}

interface Logger {
  debug(message: string): Promise<void>;
  info(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  error(message: string, err?: Error): Promise<void>;
  flush(): Promise<void>;
  cleanup(): Promise<void>;
}

const DEFAULT_RETENTION_DAYS = 7;

let activeLogger: Logger | null = null;

function getLogFileName(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `goldfish-${date}.log`;
}

function formatLine(level: LogLevel, message: string, err?: Error): string {
  const timestamp = new Date().toISOString();
  const tag = `[${level.toUpperCase()}]`;
  let line = `${timestamp} ${tag} ${message}`;
  if (err) {
    line += ` | ${err.message}`;
  }
  return line + '\n';
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const logDir = options.logDir ?? join(getGoldfishHomeDir(), 'logs');
  const minLevel = options.level ?? (process.env.GOLDFISH_LOG_LEVEL as LogLevel) ?? 'info';
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;

  let dirEnsured = false;
  let buffer: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;

  async function ensureDir(): Promise<boolean> {
    if (dirEnsured) return true;
    try {
      await mkdir(logDir, { recursive: true });
      dirEnsured = true;
      return true;
    } catch {
      return false;
    }
  }

  async function writeBuffer(): Promise<void> {
    if (buffer.length === 0) return;

    const lines = buffer.join('');
    buffer = [];

    if (!(await ensureDir())) return;

    const filePath = join(logDir, getLogFileName());
    try {
      await appendFile(filePath, lines, 'utf-8');
    } catch {
      // Silent failure - logging should never crash the server
    }
  }

  function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPromise = writeBuffer();
    }, 50);
  }

  async function write(level: LogLevel, message: string, err?: Error): Promise<void> {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[minLevel]) return;

    buffer.push(formatLine(level, message, err));
    scheduleFlush();
  }

  const logger: Logger = {
    debug: (message) => write('debug', message),
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message, err?) => write('error', message, err),

    async flush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (flushPromise) await flushPromise;
      await writeBuffer();
    },

    async cleanup(): Promise<void> {
      try {
        const files = await readdir(logDir);
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

        for (const file of files) {
          if (!file.startsWith('goldfish-') || !file.endsWith('.log')) continue;

          // Extract date from filename: goldfish-YYYY-MM-DD.log
          const dateStr = file.slice('goldfish-'.length, -'.log'.length);
          const fileDate = new Date(dateStr + 'T00:00:00Z').getTime();
          if (isNaN(fileDate)) continue;

          if (fileDate < cutoff) {
            try {
              await unlink(join(logDir, file));
            } catch {
              // Ignore individual delete failures
            }
          }
        }
      } catch {
        // Silent failure
      }
    }
  };

  activeLogger = logger;
  return logger;
}

/**
 * Get the active logger instance, creating a default one if needed.
 */
export function getLogger(): Logger {
  if (!activeLogger) {
    activeLogger = createLogger();
  }
  return activeLogger;
}

/**
 * Reset logger state (for tests only)
 */
export function _resetForTests(): void {
  activeLogger = null;
}
