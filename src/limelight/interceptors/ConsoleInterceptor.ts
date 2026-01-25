import { detectConsoleType, detectLogSource, safeStringify } from "@/helpers";
import {
  ConsoleEvent,
  ConsoleLevel,
  EventType,
  LimelightConfig,
  LimelightMessage,
} from "@/types";

export class ConsoleInterceptor {
  private originalConsole: Partial<Console> = {};
  private counter = 0;
  private isSetup = false;
  private isInternalLog = false;
  private config: LimelightConfig | null = null;

  constructor(
    private sendMessage: (message: LimelightMessage) => void,
    private getSessionId: () => string,
  ) {}

  /**
   * Sets up console interception by wrapping console methods.
   * Intercepts log, warn, error, info, debug, trace methods to capture console output.
   * Prevents double setup and infinite loops from internal logging.
   * @param {LimelightConfig} config - Configuration object for Limelight
   * @returns {void}
   */
  setup(config: LimelightConfig) {
    if (this.isSetup) {
      if (this.config?.enableInternalLogging) {
        console.warn("[Limelight] Console interceptor already set up");
      }

      return;
    }

    this.isSetup = true;
    this.config = config;

    const self = this;
    const methods: ConsoleLevel[] = [
      ConsoleLevel.LOG,
      ConsoleLevel.WARN,
      ConsoleLevel.ERROR,
      ConsoleLevel.INFO,
      ConsoleLevel.DEBUG,
      ConsoleLevel.TRACE,
    ];

    methods.forEach((level) => {
      const original = console[level];
      this.originalConsole[level] = original;

      console[level] = function (...args: any[]) {
        if (self.isInternalLog) {
          return original.apply(console, args);
        }

        self.isInternalLog = true;

        try {
          const source = detectLogSource();
          const consoleType = detectConsoleType(level, args);
          const stackTrace = self.captureStackTrace();

          let consoleEvent: ConsoleEvent = {
            id: `${self.getSessionId()}-${Date.now()}-${self.counter++}`,
            phase: "CONSOLE",
            type: EventType.CONSOLE,
            level: level,
            timestamp: Date.now(),
            sessionId: self.getSessionId(),
            source: source,
            consoleType: consoleType,
            args: args.map((arg) => safeStringify(arg)),
            stackTrace: stackTrace,
          };

          if (self.config?.beforeSend) {
            const modifiedEvent = self.config.beforeSend(consoleEvent);

            if (!modifiedEvent) {
              return original.apply(console, args);
            }

            if (modifiedEvent.phase !== "CONSOLE") {
              // always log an error if beforeSend returns wrong type
              console.error(
                "[Limelight] beforeSend must return same event type",
              );
              return original.apply(console, args);
            }

            consoleEvent = modifiedEvent as ConsoleEvent;
          }

          self.sendMessage(consoleEvent);
        } catch (error) {
          // Silently fail to avoid breaking user's console.log
        } finally {
          self.isInternalLog = false;
        }

        return original.apply(console, args);
      };
    });
  }

  /**
   * Captures the current stack trace, filtering out internal frames.
   * @private
   * @returns {string | undefined} Formatted stack trace or undefined if unavailable
   */
  private captureStackTrace(): string | undefined {
    try {
      const error = new Error();
      const stack = error.stack;

      if (!stack) return undefined;

      const relevantLines = stack
        .split("\n")
        .slice(3)
        .filter(
          (line) =>
            !line.includes("ConsoleInterceptor") && !line.includes("limelight"),
        );

      return relevantLines.length > 0 ? relevantLines.join("\n") : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Restores original console methods and removes all interception.
   * @returns {void}
   */
  cleanup() {
    if (!this.isSetup) {
      if (this.config?.enableInternalLogging) {
        console.warn("[Limelight] Console interceptor not set up");
      }

      return;
    }
    this.isSetup = false;

    Object.entries(this.originalConsole).forEach(([method, fn]) => {
      if (fn) {
        (console as any)[method] = fn;
      }
    });

    this.originalConsole = {};
  }
}
