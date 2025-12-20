import { SENSITIVE_HEADERS } from "@/constants";

/**
 * Redacts sensitive headers from a given headers object.
 * @param {Record<string, string>} headers - The headers object to redact.
 */
export const redactSensitiveHeaders = (
  headers: Record<string, string>
): Record<string, string> => {
  const redacted = { ...headers };

  Object.keys(redacted).forEach((key) => {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      redacted[key] = "[REDACTED]";
    }
  });

  return redacted;
};
