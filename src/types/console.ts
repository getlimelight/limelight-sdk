import { EventType } from "./core";

/**
 * Console log levels
 */
export enum ConsoleLevel {
  LOG = "log",
  WARN = "warn",
  ERROR = "error",
  INFO = "info",
  DEBUG = "debug",
  TRACE = "trace",
}

/**
 * Where logs originate from
 */
export enum ConsoleSource {
  APP = "app",
  LIBRARY = "library",
  REACT_NATIVE = "react-native",
  NATIVE = "native",
}

/**
 * Type of console log
 */
export enum ConsoleType {
  EXCEPTION = "exception",
  WARNING = "warning",
  NETWORK = "network",
  PERFORMANCE = "performance",
  GENERAL = "general",
}

/**
 * Console log event from the app
 */
export interface ConsoleEvent {
  id: string;
  phase: "CONSOLE";
  type: EventType.CONSOLE;
  level: ConsoleLevel;
  timestamp: number;
  sessionId: string;
  source: ConsoleSource;
  consoleType: ConsoleType;
  args: string[];
  stackTrace?: string;
}
