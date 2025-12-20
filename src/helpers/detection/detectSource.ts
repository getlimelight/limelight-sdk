import { ConsoleSource } from "../..";

/**
 * Detects the source of a console log by analyzing the stack trace.
 * @return {ConsoleSource} The detected source of the console log.
 */
export const detectLogSource = (): ConsoleSource => {
  try {
    const stack = new Error().stack;

    if (!stack) return ConsoleSource.APP;

    const stackLines = stack.split("\n");

    for (let i = 3; i < stackLines.length; i++) {
      const line = stackLines[i];

      if (line === undefined) return ConsoleSource.APP;

      if (
        line.includes("node_modules/react-native/") ||
        line.includes("react-native/Libraries/") ||
        line.includes("MessageQueue.js") ||
        line.includes("BatchedBridge")
      ) {
        return ConsoleSource.REACT_NATIVE;
      }

      if (line.includes("[native code]") || line.includes("NativeModules")) {
        return ConsoleSource.NATIVE;
      }

      if (!line.includes("node_modules/")) {
        return ConsoleSource.APP;
      }

      if (!line.includes("node_modules/")) {
        return ConsoleSource.APP;
      }
    }

    return ConsoleSource.APP;
  } catch {
    return ConsoleSource.APP;
  }
};
