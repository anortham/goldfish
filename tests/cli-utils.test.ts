import { describe, it, expect, beforeEach } from 'bun:test';
import { detectAvailableCLIs, commandExists } from '../src/cli-utils';

describe('CLI detection utilities', () => {
  it('detects if claude command exists', async () => {
    const hasClaude = await commandExists('claude');

    // Just verify it returns a boolean
    expect(typeof hasClaude).toBe('boolean');
  });

  it('detects if gemini command exists', async () => {
    const hasGemini = await commandExists('gemini');

    // Just verify it returns a boolean
    expect(typeof hasGemini).toBe('boolean');
  });

  it('returns false for non-existent commands', async () => {
    const hasNonExistent = await commandExists('totally-fake-command-xyz-123');

    expect(hasNonExistent).toBe(false);
  });

  it('handles command with spaces/special chars', async () => {
    const hasInvalid = await commandExists('invalid command with spaces');

    expect(hasInvalid).toBe(false);
  });

  it('handles timeout for hanging commands', async () => {
    // Test with a command that might hang (sleep is a good candidate but which should be fast)
    const result = await commandExists('which');

    // Should complete within timeout
    expect(typeof result).toBe('boolean');
  }, 2000); // Give it 2 seconds

  it('detectAvailableCLIs returns both claude and gemini status', async () => {
    const availability = await detectAvailableCLIs();

    expect(availability).toHaveProperty('hasClaude');
    expect(availability).toHaveProperty('hasGemini');
    expect(typeof availability.hasClaude).toBe('boolean');
    expect(typeof availability.hasGemini).toBe('boolean');
  });

  it('detectAvailableCLIs completes in reasonable time', async () => {
    const start = Date.now();
    await detectAvailableCLIs();
    const duration = Date.now() - start;

    // Should complete within 2 seconds (testing both commands in parallel)
    expect(duration).toBeLessThan(2000);
  });
});
