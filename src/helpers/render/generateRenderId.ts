let counter = 0;

/**
 * Generates a unique ID using timestamp + counter + random.
 * Handles high-frequency calls without collision.
 *
 * Format: `{base36-timestamp}{counter}-{random}`
 * Example: `lq2x5k0-a7b3`
 */
export const generateRenderId = (): string => {
  const timestamp = Date.now().toString(36);
  const count = (counter++).toString(36);
  const random = Math.random().toString(36).substring(2, 6);

  // Reset counter periodically to keep IDs shorter
  if (counter > 1000) counter = 0;

  return `${timestamp}${count}-${random}`;
};
