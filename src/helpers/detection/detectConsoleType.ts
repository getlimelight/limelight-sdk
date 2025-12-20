import { ConsoleType } from "../..";

/**
 * Detects the type of console message based on its level and content.
 * @param level - The console log level (e.g., "log", "warn", "error", "info", "debug").
 * @param args - The arguments passed to the console method.
 * @returns The detected ConsoleType.
 */
export const detectConsoleType = (
  level: "log" | "warn" | "error" | "info" | "debug" | "trace",
  args: any[]
): ConsoleType => {
  const messageStr = args
    .map((arg) => {
      try {
        return typeof arg === "object" ? JSON.stringify(arg) : String(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ")
    .toLowerCase();

  if (level === "error") {
    if (
      messageStr.includes("error:") ||
      messageStr.includes("exception") ||
      messageStr.includes("uncaught") ||
      messageStr.includes("unhandled") ||
      args.some((arg) => arg instanceof Error)
    ) {
      return ConsoleType.EXCEPTION;
    }
  }

  if (level === "warn") {
    return ConsoleType.WARNING;
  }

  if (
    messageStr.includes("network") ||
    messageStr.includes("fetch") ||
    messageStr.includes("request") ||
    messageStr.includes("response") ||
    messageStr.includes("http") ||
    messageStr.includes("api") ||
    messageStr.includes("graphql") ||
    messageStr.includes("xhr")
  ) {
    return ConsoleType.NETWORK;
  }

  if (
    messageStr.includes("performance") ||
    messageStr.includes("slow") ||
    messageStr.includes("render") ||
    messageStr.includes("fps") ||
    messageStr.includes("memory") ||
    messageStr.includes("optimization") ||
    messageStr.includes("bottleneck")
  ) {
    return ConsoleType.PERFORMANCE;
  }

  return ConsoleType.GENERAL;
};
