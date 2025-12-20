/**
 * Represents a single frame in a stack trace.
 */
export interface StackFrame {
  fileName: string;
  lineNumber?: number;
  columnNumber?: number;
  functionName?: string;
  source: string;
}

/**
 * Represents a parsed stack trace with its frames and raw string.
 */
export interface ParsedStackTrace {
  frames: StackFrame[];
  raw: string;
}
