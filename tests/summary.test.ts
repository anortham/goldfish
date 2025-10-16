import { describe, it, expect } from 'bun:test';
import { generateSummary } from '../src/summary';

/**
 * Test automatic summary generation for long checkpoint descriptions
 */

describe('Summary generation', () => {
  describe('generateSummary', () => {
    it('returns undefined for short descriptions (< 150 chars)', () => {
      const short = 'Fixed bug in authentication';
      const summary = generateSummary(short);

      expect(summary).toBeUndefined();
    });

    it('generates summary for long descriptions (>= 150 chars)', () => {
      const long = 'Successfully refactored the entire authentication system to use JWT tokens instead of session cookies. Updated all middleware, tests, and documentation. Added refresh token support and improved error handling for expired tokens. All 42 tests passing.';
      const summary = generateSummary(long);

      expect(summary).toBeDefined();
      expect(summary!.length).toBeLessThan(long.length);
      expect(summary!.length).toBeLessThanOrEqual(150);
    });

    it('extracts first sentence as summary', () => {
      const description = 'Refactored authentication system to use modern JWT token-based authentication. Updated middleware and tests. Added refresh token support. Improved error handling for expired tokens.';
      const summary = generateSummary(description);

      expect(summary).toBe('Refactored authentication system to use modern JWT token-based authentication');
    });

    it('handles descriptions without sentence breaks', () => {
      const description = 'A'.repeat(200); // 200 char string with no sentence breaks
      const summary = generateSummary(description);

      expect(summary).toBeDefined();
      expect(summary!.length).toBeLessThanOrEqual(150);
      expect(summary!.endsWith('...')).toBe(true);
    });

    it('preserves complete sentences under 150 chars', () => {
      const description = 'This is a moderately long description that exceeds the 150 character threshold but the first sentence is actually quite reasonable and should be preserved as the summary.';
      const summary = generateSummary(description);

      expect(summary).toBeDefined();
      expect(summary!.length).toBeLessThanOrEqual(150);
    });

    it('handles multi-line descriptions', () => {
      const description = `Refactored authentication system to use JWT tokens.

Updated all middleware, tests, and documentation.
Added refresh token support and improved error handling.`;

      const summary = generateSummary(description);

      expect(summary).toBeDefined();
      expect(summary).toBe('Refactored authentication system to use JWT tokens');
    });
  });
});
