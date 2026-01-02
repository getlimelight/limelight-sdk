// Global accessor for render interceptor (avoids hook requirements)
let globalGetTransactionId: (() => string | null) | null = null;

/**
 * Gets the current transaction ID from anywhere (for render interceptor use).
 * Returns null if no provider is mounted or no transaction is active.
 * @return {string | null} The current transaction ID or null.
 */
export const getCurrentTransactionId = (): string | null => {
  return globalGetTransactionId?.() ?? null;
};
