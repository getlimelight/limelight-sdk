import { safeStringify } from "@/helpers";
import {
  ConsoleLevel,
  ConsoleSource,
  ConsoleType,
  EventType,
  LimelightConfig,
  LimelightMessage,
} from "@/types";

/**
 * Captures uncaught exceptions and unhandled promise rejections in Node.js
 * and sends them as CONSOLE error events through the Limelight protocol.
 *
 * Only activates in server environments where `process` is available.
 */
export class ErrorInterceptor {
  private isSetup = false;
  private config: LimelightConfig | null = null;
  private counter = 0;

  private uncaughtExceptionHandler: ((error: Error) => void) | null = null;
  private unhandledRejectionHandler:
    | ((reason: unknown, promise: Promise<unknown>) => void)
    | null = null;

  constructor(
    private sendMessage: (message: LimelightMessage) => void,
    private getSessionId: () => string,
  ) {}

  setup(config: LimelightConfig) {
    if (this.isSetup) {
      if (this.config?.enableInternalLogging) {
        console.warn("[Limelight] Error interceptor already set up");
      }
      return;
    }

    if (typeof process === "undefined" || !process.on) {
      return;
    }

    this.isSetup = true;
    this.config = config;

    this.uncaughtExceptionHandler = (error: Error) => {
      this.sendErrorEvent(error, "uncaughtException");
      // Give the WebSocket time to actually send the error event over the wire
      // before exiting. 200ms is enough for a local/LAN WebSocket flush.
      setTimeout(() => {
        process.exit(1);
      }, 200);
    };

    this.unhandledRejectionHandler = (reason: unknown) => {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));
      this.sendErrorEvent(error, "unhandledRejection");
    };

    process.on("uncaughtException", this.uncaughtExceptionHandler);
    process.on("unhandledRejection", this.unhandledRejectionHandler);
  }

  cleanup() {
    if (!this.isSetup) return;

    this.isSetup = false;

    if (this.uncaughtExceptionHandler) {
      process.removeListener(
        "uncaughtException",
        this.uncaughtExceptionHandler,
      );
      this.uncaughtExceptionHandler = null;
    }

    if (this.unhandledRejectionHandler) {
      process.removeListener(
        "unhandledRejection",
        this.unhandledRejectionHandler,
      );
      this.unhandledRejectionHandler = null;
    }

    this.config = null;
  }

  private sendErrorEvent(error: Error, source: string) {
    const sessionId = this.getSessionId();

    const event: LimelightMessage = {
      id: `${sessionId}-${Date.now()}-${this.counter++}`,
      phase: "CONSOLE",
      type: EventType.CONSOLE,
      level: ConsoleLevel.ERROR,
      timestamp: Date.now(),
      sessionId,
      source: ConsoleSource.APP,
      consoleType: ConsoleType.EXCEPTION,
      args: [safeStringify(`[${source}] ${error.message}`)],
      stackTrace: error.stack,
    };

    if (this.config?.beforeSend) {
      const modified = this.config.beforeSend(event);

      if (!modified) return;
    }

    this.sendMessage(event);
  }
}
