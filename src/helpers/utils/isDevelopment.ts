/**
 * Detects if the current environment is a development environment.
 * Supports React Native, Node.js, Vite, and Webpack.
 */
export const isDevelopment = (): boolean => {
  try {
    const g = globalThis as any;

    // 1. React Native (Hermes/Metro)
    // Check this first as it's the most specific
    if (typeof g.__DEV__ !== "undefined") return !!g.__DEV__;

    // 2. Node.js / Standard Bundlers
    if (typeof process !== "undefined" && process.env?.NODE_ENV) {
      return process.env.NODE_ENV !== "production";
    }

    /**
     * 3. Vite / Modern ESM
     * We avoid using 'import.meta' literal to prevent Hermes/React Native from
     * throwing a Syntax Error during the parsing phase.
     */
    const importMeta = (g as any).import?.meta;
    if (importMeta?.env?.DEV) {
      return true;
    }

    // Fallback for Vite if the above doesn't catch it
    // @ts-ignore
    if (typeof g.import !== "undefined" && g.import.meta?.env?.DEV) {
      return true;
    }
  } catch (e) {
    // If anything fails (like a strict CSP), default to true for Dev tools
    return true;
  }

  return true;
};
