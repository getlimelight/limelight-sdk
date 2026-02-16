/**
 * Returns true if DOM APIs are available (window + document).
 * True in browsers, false in Node.js and React Native.
 */
export const hasDOM = (): boolean =>
  typeof window !== "undefined" && typeof document !== "undefined";

/**
 * Returns true if running without DOM APIs (Node.js, React Native).
 */
export const isServer = (): boolean => !hasDOM();
