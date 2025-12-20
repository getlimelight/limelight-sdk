/**
 * Convert bytes to KB
 * @retrusn string in KB
 */
export const formatBytes = (bytes: number | undefined): string => {
  if (!bytes) return "0";
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
