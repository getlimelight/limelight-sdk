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
  pretty = false,
): string => {
  const seen = new WeakMap<object, string>();

  const process = (val: unknown, currentDepth: number, path: string): any => {
    if (val === null) return null;
    if (val === undefined) return "[undefined]";
    if (typeof val === "bigint") return `${val}n`;
    if (typeof val === "symbol") return `[Symbol: ${val.description || ""}]`;
    if (typeof val === "function") {
      return `[Function: ${val.name || "anonymous"}]`;
    }
    if (typeof val !== "object") return val;

    if (currentDepth >= maxDepth) {
      return "[Max Depth]";
    }

    const seenPath = seen.get(val);

    if (seenPath !== undefined) {
      return `[Circular → ${seenPath}]`;
    }

    seen.set(val, path || "root");

    if (val instanceof Error) {
      return {
        __type: "Error",
        name: val.name,
        message: val.message,
        stack: val.stack,
        ...Object.fromEntries(
          Object.entries(val).filter(
            ([k]) => !["name", "message", "stack"].includes(k),
          ),
        ),
      };
    }

    if (val instanceof Date) {
      return { __type: "Date", value: val.toISOString() };
    }

    if (val instanceof RegExp) {
      return { __type: "RegExp", value: val.toString() };
    }

    if (val instanceof Map) {
      return {
        __type: "Map",
        size: val.size,
        entries: Array.from(val.entries()).map(([k, v], i) => [
          process(k, currentDepth + 1, `${path}.Map[${i}].key`),
          process(v, currentDepth + 1, `${path}.Map[${i}].value`),
        ]),
      };
    }

    if (val instanceof Set) {
      return {
        __type: "Set",
        size: val.size,
        values: Array.from(val).map((v, i) =>
          process(v, currentDepth + 1, `${path}.Set[${i}]`),
        ),
      };
    }

    if (val instanceof WeakMap) {
      return { __type: "WeakMap", note: "[Contents not enumerable]" };
    }
    if (val instanceof WeakSet) {
      return { __type: "WeakSet", note: "[Contents not enumerable]" };
    }

    if (val instanceof Promise) {
      return { __type: "Promise", note: "[Pending state not accessible]" };
    }

    if (val instanceof ArrayBuffer) {
      return { __type: "ArrayBuffer", byteLength: val.byteLength };
    }

    if (ArrayBuffer.isView(val)) {
      const typedArray = val as any;
      return {
        __type: val.constructor.name,
        length: typedArray.length ?? typedArray.byteLength,
        preview:
          typedArray.length <= 10
            ? Array.from(typedArray.slice?.(0, 10) ?? [])
            : `[${typedArray.length} items]`,
      };
    }

    if (typeof URL !== "undefined" && val instanceof URL) {
      return { __type: "URL", href: val.href };
    }

    if (
      typeof URLSearchParams !== "undefined" &&
      val instanceof URLSearchParams
    ) {
      return {
        __type: "URLSearchParams",
        entries: Object.fromEntries(val.entries()),
      };
    }

    if (
      val &&
      typeof (val as any).$$typeof === "symbol" &&
      String((val as any).$$typeof).includes("react.element")
    ) {
      return {
        __type: "ReactElement",
        type:
          typeof (val as any).type === "function"
            ? (val as any).type.name || "Component"
            : (val as any).type || "unknown",
        key: (val as any).key,
      };
    }

    if (Array.isArray(val)) {
      return val.map((item, i) =>
        process(item, currentDepth + 1, `${path}[${i}]`),
      );
    }

    const result: Record<string, any> = {};
    const proto = Object.getPrototypeOf(val);

    if (proto && proto.constructor && proto.constructor.name !== "Object") {
      result.__type = proto.constructor.name;
    }

    for (const key in val) {
      if (Object.prototype.hasOwnProperty.call(val, key)) {
        try {
          result[key] = process(
            (val as any)[key],
            currentDepth + 1,
            `${path}.${key}`,
          );
        } catch (e) {
          result[key] =
            `[Error accessing property: ${e instanceof Error ? e.message : String(e)}]`;
        }
      }
    }

    return result;
  };

  try {
    const processed = process(value, 0, "root");
    return JSON.stringify(processed, null, pretty ? 2 : undefined);
  } catch (error) {
    return JSON.stringify({
      __error: "Stringification failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
