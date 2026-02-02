/**
 * Detects and returns the global object in various JavaScript environments.
 * @returns {typeof globalThis} The detected global object.
 */
export const detectGlobalObject = (): typeof globalThis => {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof window !== "undefined") return window;
  if (typeof global !== "undefined") return global;
  if (typeof self !== "undefined") return self;
  throw new Error("Unable to locate global object");
};
