import type http from "http";

/**
 * Resolves the full URL from the given HTTP request options.
 *
 * @param protocol The protocol to use (e.g. "http:" or "https:")
 * @param options The HTTP request options containing host, port, and path
 * @returns The fully resolved URL as a string
 */
export const resolveUrl = (
  protocol: string,
  options: http.RequestOptions,
): string => {
  const host = options.hostname || options.host || "localhost";
  const port = options.port ? `:${options.port}` : "";
  const path = options.path || "/";
  return `${protocol}//${host}${port}${path}`;
};
