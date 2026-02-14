export interface TraceStore {
  traceId: string;
}

interface TraceContextLike {
  getStore(): TraceStore | undefined;
  run<T>(store: TraceStore, callback: (...args: any[]) => T, ...args: any[]): T;
}

let _resolved = false;
let _traceContext: TraceContextLike | undefined;

/**
 * Returns the AsyncLocalStorage-backed trace context if available (Node.js only).
 * Returns undefined in browser environments where AsyncLocalStorage is not available.
 *
 * @returns {TraceContextLike | undefined} The trace context or undefined if not available.
 */
export const getTraceContext = (): TraceContextLike | undefined => {
  if (!_resolved) {
    _resolved = true;
    try {
      const { AsyncLocalStorage } = require("node:async_hooks");
      _traceContext = new AsyncLocalStorage() as TraceContextLike;
    } catch {
      // Browser environment — AsyncLocalStorage not available
    }
  }

  return _traceContext;
};
