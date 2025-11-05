/**
 * Distillation module for LLM-based checkpoint summarization
 *
 * Uses Claude or Gemini CLI to create compact, query-specific summaries
 */

import { spawn } from 'child_process';
import type { Checkpoint, DistillResult } from './types';
import { detectAvailableCLIs } from './cli-utils';

export interface DistillOptions {
  provider?: 'claude' | 'gemini' | 'auto' | 'none';
  model?: string;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Simple token estimation (1 token ≈ 4 characters)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build distillation prompt from checkpoints and context
 */
export function buildDistillPrompt(
  checkpoints: Checkpoint[],
  context: string,
  maxTokens: number = 500
): string {
  const checkpointList = checkpoints.map((c, i) => {
    const tags = c.tags?.join(', ') || 'none';
    const branch = c.gitBranch || 'unknown';
    const files = c.files?.join(', ') || 'none';

    return `${i + 1}. [${c.timestamp}] ${c.description}
   Tags: ${tags}
   Branch: ${branch}
   Files: ${files}`;
  }).join('\n\n');

  return `You are helping an AI agent recall relevant work context efficiently.

Session Context: ${context}

Retrieved Checkpoints (${checkpoints.length} items):
${checkpointList}

Task: Distill these checkpoints into a concise summary (${maxTokens} tokens max) that:
1. Focuses on what's most relevant to the current session context
2. Preserves technical details (file names, function names, commit hashes, bug descriptions)
3. Groups related work together
4. Highlights key decisions and their rationale
5. Notes any blockers or unresolved issues

Format as 3-5 bullet points. Be concise but preserve critical details.`;
}

/**
 * Simple extraction fallback (current behavior)
 */
export function simpleExtraction(checkpoints: Checkpoint[]): DistillResult {
  if (checkpoints.length === 0) {
    return {
      summary: 'No checkpoints found.',
      provider: 'simple',
      cached: false,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0
    };
  }

  const summaries = checkpoints.map(c =>
    c.summary || c.description.split('.')[0]
  );

  const summary = `Recent work:\n- ${summaries.join('\n- ')}`;

  return {
    summary,
    provider: 'simple',
    cached: false,
    tokensIn: 0,
    tokensOut: estimateTokens(summary),
    latencyMs: 0
  };
}

/**
 * Try distillation with Claude CLI
 */
async function tryClaudeDistillation(
  prompt: string,
  options: DistillOptions
): Promise<DistillResult | null> {
  const start = Date.now();

  return new Promise((resolve) => {
    const args = [
      '-p', prompt
    ];

    // Add model if specified
    if (options.model) {
      args.unshift('--model', options.model);
    }

    const proc = spawn('claude', args, {
      stdio: 'pipe',
      timeout: options.timeout || 30000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn('Claude CLI failed:', stderr);
        resolve(null);
        return;
      }

      const summary = stdout.trim();

      resolve({
        summary,
        provider: 'claude',
        cached: false,
        tokensIn: estimateTokens(prompt),
        tokensOut: estimateTokens(summary),
        latencyMs: Date.now() - start
      });
    });

    proc.on('error', (error) => {
      console.warn('Claude CLI error:', error);
      resolve(null);
    });
  });
}

/**
 * Try distillation with Gemini CLI
 */
async function tryGeminiDistillation(
  prompt: string,
  options: DistillOptions
): Promise<DistillResult | null> {
  const start = Date.now();

  return new Promise((resolve) => {
    const proc = spawn('gemini', ['-p', prompt], {
      stdio: 'pipe',
      timeout: options.timeout || 30000
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.warn('Gemini CLI failed:', stderr);
        resolve(null);
        return;
      }

      const summary = stdout.trim();

      resolve({
        summary,
        provider: 'gemini',
        cached: false,
        tokensIn: estimateTokens(prompt),
        tokensOut: estimateTokens(summary),
        latencyMs: Date.now() - start
      });
    });

    proc.on('error', (error) => {
      console.warn('Gemini CLI error:', error);
      resolve(null);
    });
  });
}

/**
 * Distill checkpoints into a compact summary using available LLM CLI tools
 */
export async function distillCheckpoints(
  checkpoints: Checkpoint[],
  context: string,
  options: DistillOptions = {}
): Promise<DistillResult> {
  // Early return for empty checkpoints
  if (checkpoints.length === 0) {
    return simpleExtraction(checkpoints);
  }

  // If provider is explicitly 'none', use simple extraction
  if (options.provider === 'none') {
    return simpleExtraction(checkpoints);
  }

  // Build prompt
  const prompt = buildDistillPrompt(checkpoints, context, options.maxTokens || 500);

  let result: DistillResult | null = null;

  // Try providers based on option
  if (options.provider === 'claude') {
    result = await tryClaudeDistillation(prompt, options);
  } else if (options.provider === 'gemini') {
    result = await tryGeminiDistillation(prompt, options);
  } else {
    // Auto mode: detect available CLIs and try them
    const availability = await detectAvailableCLIs();

    if (availability.hasClaude) {
      result = await tryClaudeDistillation(prompt, options);
    }

    if (!result && availability.hasGemini) {
      result = await tryGeminiDistillation(prompt, options);
    }
  }

  // Fallback to simple extraction if all CLI attempts failed
  if (!result) {
    return simpleExtraction(checkpoints);
  }

  return result;
}

/**
 * Calculate token reduction percentage
 */
export function calculateTokenReduction(
  checkpoints: Checkpoint[],
  distillResult: DistillResult
): number {
  const originalTokens = checkpoints.reduce(
    (sum, c) => sum + estimateTokens(c.description),
    0
  );

  if (originalTokens === 0) {
    return 0;
  }

  const reduction = Math.round(((originalTokens - distillResult.tokensOut) / originalTokens) * 100);

  // Return 0 if distilled version is longer (negative reduction doesn't make sense)
  return Math.max(0, reduction);
}
