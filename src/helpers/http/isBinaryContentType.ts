import { BINARY_CONTENT_TYPES } from "@/constants";

/**
 * Checks if a given content type is considered binary.
 * @param {string} contentType - The content type to check.
 * @returns {boolean} True if the content type is binary, false otherwise.
 */
export const isBinaryContentType = (contentType: string): boolean => {
  return BINARY_CONTENT_TYPES.some((type) =>
    contentType.toLowerCase().includes(type),
  );
};
