import { BodyFormat, SerializedBody } from "@/types";

/**
 * Serializes various body types into a normalized format.
 * Handles JSON, text, FormData, Blob, ArrayBuffer, and others.
 * Returns size estimates and previews for easy display.
 *
 * @param input The body input to serialize
 * @returns SerializedBody object or undefined
 */
export const serializeBody = (
  input: any,
  disableBodyCapture?: boolean
): SerializedBody | undefined => {
  if (disableBodyCapture) {
    return { format: BodyFormat.NONE, size: 0, preview: "" };
  }

  if (!input) {
    return {
      format: BodyFormat.NONE,
      size: 0,
      preview: "",
    };
  }

  try {
    // JSON
    if (typeof input === "object") {
      const json = JSON.stringify(input);
      return {
        format: BodyFormat.JSON,
        size: json.length,
        preview: json.slice(0, 200),
        raw: json,
      };
    }

    // Text
    if (typeof input === "string") {
      return {
        format: BodyFormat.TEXT,
        size: input.length,
        preview: input.slice(0, 200),
        raw: input,
      };
    }

    // FormData
    if (typeof FormData !== "undefined" && input instanceof FormData) {
      return {
        format: BodyFormat.FORM_DATA,
        size: 0,
        preview: "[FormData]",
      };
    }

    // Blob
    if (typeof Blob !== "undefined" && input instanceof Blob) {
      return {
        format: BodyFormat.BLOB,
        size: input.size,
        preview: "[Blob]",
      };
    }

    // ArrayBuffer
    if (input instanceof ArrayBuffer) {
      return {
        format: BodyFormat.ARRAY_BUFFER,
        size: input.byteLength,
        preview: "[ArrayBuffer]",
      };
    }

    // Fallback
    return {
      format: BodyFormat.UNSERIALIZABLE,
      size: 0,
      preview: String(input),
    };
  } catch {
    return {
      format: BodyFormat.UNSERIALIZABLE,
      size: 0,
      preview: "[Unserializable]",
    };
  }
};
