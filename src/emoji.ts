/**
 * Goldfish emoji utilities
 */

const FISH_EMOJIS = ['🐠', '🐟', '🐡', '🐋', '🐳', '🦈'] as const;

/**
 * Get a random fish emoji for visual feedback
 */
export function getFishEmoji(): string {
  return FISH_EMOJIS[Math.floor(Math.random() * FISH_EMOJIS.length)];
}
