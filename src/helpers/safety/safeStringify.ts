/**
 * Safely stringifies a value, handling circular references, special types,
 * and non-serializable values.
 * @param {unknown} value - The value to stringify.
 * @param {number} [maxDepth=10] - Maximum depth to traverse objects.
 * @param {boolean} [pretty=false] - Whether to pretty-print the JSON.
 * @returns {string} The safely stringified JSON string.
 */
export const safeStringify = (
  value: unknown,
  maxDepth = 10,
  pretty = false
): string => {
  const seen = new WeakMap<object, true>();

  const process = (val: unknown, currentDepth: number): any => {
    if (val === null) return null;
    if (val === undefined) return "[undefined]";
    if (typeof val === "bigint") return `${val}n`;
    if (typeof val === "symbol") return val.toString();
    if (typeof val === "function") {
      return `[Function: ${val.name || "anonymous"}]`;
    }
    if (typeof val !== "object") return val;

    if (currentDepth >= maxDepth) {
      return "[Max Depth]";
    }

    if (seen.has(val)) {
      return "[Circular]";
    }
    seen.set(val, true);

    if (val instanceof Error) {
      return {
        __type: "Error",
        name: val.name,
        message: val.message,
        stack: val.stack,
      };
    }

    if (val instanceof Date) {
      return val.toISOString();
    }

    if (val instanceof RegExp) {
      return val.toString();
    }

    if (val instanceof Map) {
      const obj: Record<string, any> = {};
      val.forEach((v, k) => {
        const key = typeof k === "string" ? k : String(k);
        obj[key] = process(v, currentDepth + 1);
      });
      return obj;
    }

    if (val instanceof Set) {
      return Array.from(val).map((v) => process(v, currentDepth + 1));
    }

    if (ArrayBuffer.isView(val)) {
      return `[${val.constructor.name}(${(val as any).length})]`;
    }

    if (Array.isArray(val)) {
      return val.map((item) => process(item, currentDepth + 1));
    }

    const result: Record<string, any> = {};
    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        result[key] = process((val as any)[key], currentDepth + 1);
      }
    }

    return result;
  };

  try {
    const processed = process(value, 0);
    return JSON.stringify(processed, null, pretty ? 2 : 0);
  } catch (error) {
    return JSON.stringify({
      __error: "Stringification failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
