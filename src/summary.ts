/**
 * Summary generation for checkpoint descriptions
 */

const SUMMARY_THRESHOLD = 150; // Generate summary if description exceeds this
const MAX_SUMMARY_LENGTH = 150;

/**
 * Generate a concise summary for long checkpoint descriptions
 * Returns undefined if description is already short enough
 *
 * Strategy:
 * 1. If description < 150 chars: return undefined (no summary needed)
 * 2. Extract first sentence (up to . or newline)
 * 3. If first sentence > 150 chars: truncate at 147 chars + "..."
 * 4. Return summary
 */
export function generateSummary(description: string): string | undefined {
  // No summary needed for short descriptions
  if (description.length < SUMMARY_THRESHOLD) {
    return undefined;
  }

  // Extract first sentence (split on period followed by space, or newline)
  const sentences = description.split(/\.(?:\s|$)|\n/);
  let firstSentence = sentences[0]?.trim() || '';

  // If first sentence is still too long, truncate it
  if (firstSentence.length > MAX_SUMMARY_LENGTH) {
    firstSentence = firstSentence.substring(0, MAX_SUMMARY_LENGTH - 3) + '...';
  }

  return firstSentence;
}
