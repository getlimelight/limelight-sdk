/**
 * Generates a unique session ID using the current timestamp and a random string.
 *
 * @return A unique session ID.
 */
export const createSessionId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(7)}`;
};

/**
 * Generates a unique request ID using the current timestamp and a random string.
 *
 * @return A unique request ID.
 */
export const generateRequestId = (): string => {
  return `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
};
