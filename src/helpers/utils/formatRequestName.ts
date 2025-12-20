/**
 * Formats a request name based on the URL.
 * * Extracts the last segment of the URL path to use as the request name.
 * * If the URL is invalid, it returns the original URL.
 * * @param {string} url - The URL of the request.
 * * @returns {string} - The formatted request name.
 */
export const formatRequestName = (url: string) => {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    const segments = path.split("/").filter(Boolean);
    return segments[segments.length - 1] || path || url;
  } catch {
    return url;
  }
};
