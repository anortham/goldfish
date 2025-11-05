/**
 * CLI detection utilities for external LLM tools
 *
 * Detects availability of claude and gemini CLI commands
 */

import { spawn } from 'child_process';

export interface CLIAvailability {
  hasClaude: boolean;
  hasGemini: boolean;
}

/**
 * Check if a command exists on the system PATH
 */
export async function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('which', [cmd], {
      stdio: 'pipe',
      shell: false
    });

    let resolved = false;

    proc.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        resolve(code === 0);
      }
    });

    proc.on('error', () => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });

    // Timeout after 1 second
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve(false);
      }
    }, 1000);
  });
}

/**
 * Detect which CLI tools are available
 */
export async function detectAvailableCLIs(): Promise<CLIAvailability> {
  const [hasClaude, hasGemini] = await Promise.all([
    commandExists('claude'),
    commandExists('gemini')
  ]);

  return { hasClaude, hasGemini };
}
