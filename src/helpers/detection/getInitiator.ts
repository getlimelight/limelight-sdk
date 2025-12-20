/**
 * Gets the function name and file location of the caller that initiated the current function.
 * @returns A string representing the initiator function and its file location.
 */
export const getInitiator = (): string => {
  try {
    const stack = new Error().stack;
    if (!stack) return "unknown";

    const lines = stack.split("\n");
    const callerLine = lines[4] || lines[3];

    if (!callerLine) return "unknown";

    const match = callerLine.match(/at (.+) \((.+):(\d+):(\d+)\)/);
    if (match) {
      const [, functionName, filePath, line] = match;
      const fileName = filePath?.split("/").pop();

      return `${functionName} (${fileName}:${line})`;
    }

    return callerLine.trim();
  } catch {
    return "unknown";
  }
};
