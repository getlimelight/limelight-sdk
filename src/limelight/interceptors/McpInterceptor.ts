import {
  BodyFormat,
  HttpMethod,
  LimelightConfig,
  LimelightMessage,
  NetworkPhase,
  NetworkType,
} from "@/types";
import { generateRequestId } from "@/protocol";

export class McpInterceptor {
  private isSetup = false;
  private config: LimelightConfig | null = null;

  private pendingRequests = new Map<
    string | number,
    { requestId: string; startTime: number; method: string }
  >();

  private originalStdoutWrite: typeof process.stdout.write | null = null;
  private stdinListener: ((chunk: Buffer) => void) | null = null;

  private stdinBuffer = "";
  private stdoutBuffer = "";

  constructor(
    private sendMessage: (message: LimelightMessage) => void,
    private getSessionId: () => string,
  ) {}

  setup(config: LimelightConfig) {
    if (this.isSetup) return;
    if (typeof process === "undefined" || !process.stdin || !process.stdout)
      return;

    this.isSetup = true;
    this.config = config;

    this.stdinListener = (chunk: Buffer) => {
      const data = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      this.stdinBuffer += data;
      this.extractMessages("stdin");
    };
    process.stdin.on("data", this.stdinListener);

    const self = this;
    this.originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalWrite = this.originalStdoutWrite;

    (process.stdout as any).write = function (
      chunk: any,
      encoding?: any,
      callback?: any,
    ): boolean {
      const data = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
      self.stdoutBuffer += data;
      self.extractMessages("stdout");
      return originalWrite.call(process.stdout, chunk, encoding, callback);
    };
  }

  private extractMessages(source: "stdin" | "stdout") {
    const buffer = source === "stdin" ? this.stdinBuffer : this.stdoutBuffer;
    const lines = buffer.split("\n");
    const remaining = lines.pop() || "";

    if (source === "stdin") {
      this.stdinBuffer = remaining;
    } else {
      this.stdoutBuffer = remaining;
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("{")) continue;

      try {
        const message = JSON.parse(trimmed);
        if (message.jsonrpc !== "2.0") continue;

        if (source === "stdin") {
          this.handleIncomingMessage(message);
        } else {
          this.handleOutgoingMessage(message);
        }
      } catch {
        // Not valid JSON, skip
      }
    }
  }

  private handleIncomingMessage(message: any) {
    if (!message.method) return;

    const requestId = generateRequestId();
    const startTime = Date.now();

    if (message.id !== undefined) {
      this.pendingRequests.set(message.id, {
        requestId,
        startTime,
        method: message.method,
      });
    }

    const params = message.params;
    const body = params ? JSON.stringify(params) : undefined;
    const toolName = message.method === "tools/call" ? params?.name : undefined;

    let requestEvent: LimelightMessage = {
      id: requestId,
      sessionId: this.getSessionId(),
      timestamp: startTime,
      phase: NetworkPhase.REQUEST,
      networkType: NetworkType.MCP,
      url: `mcp://${message.method}${toolName ? `/${toolName}` : ""}`,
      method: HttpMethod.POST,
      headers: { "jsonrpc-id": String(message.id ?? "") },
      body: body
        ? {
            format: BodyFormat.JSON,
            size: body.length,
            preview: body.slice(0, 200),
            raw: body,
          }
        : undefined,
      name: toolName || message.method,
      initiator: "mcp-stdio",
      requestSize: body?.length ?? 0,
    };

    if (this.config?.beforeSend) {
      const modified = this.config.beforeSend(requestEvent);
      if (!modified) return;
      if (modified.phase === NetworkPhase.REQUEST) {
        requestEvent = modified;
      }
    }

    this.sendMessage(requestEvent);
  }

  private handleOutgoingMessage(message: any) {
    if (message.id === undefined || message.method) return;

    const pending = this.pendingRequests.get(message.id);
    if (!pending) return;

    const endTime = Date.now();
    const duration = endTime - pending.startTime;

    this.pendingRequests.delete(message.id);

    if (message.error) {
      let errorEvent: LimelightMessage = {
        id: pending.requestId,
        sessionId: this.getSessionId(),
        timestamp: endTime,
        phase: NetworkPhase.ERROR,
        networkType: NetworkType.MCP,
        errorMessage: message.error.message || "MCP Error",
        stack: message.error.data
          ? JSON.stringify(message.error.data)
          : undefined,
      };

      if (this.config?.beforeSend) {
        const modified = this.config.beforeSend(errorEvent);
        if (!modified) return;
        if (modified.phase === NetworkPhase.ERROR) {
          errorEvent = modified;
        }
      }

      this.sendMessage(errorEvent);
    } else {
      const body = JSON.stringify(message.result ?? {});

      let responseEvent: LimelightMessage = {
        id: pending.requestId,
        sessionId: this.getSessionId(),
        timestamp: endTime,
        phase: NetworkPhase.RESPONSE,
        networkType: NetworkType.MCP,
        status: 200,
        statusText: "OK",
        headers: { "jsonrpc-id": String(message.id) },
        body: {
          format: BodyFormat.JSON,
          size: body.length,
          preview: body.slice(0, 200),
          raw: body,
        },
        duration,
        responseSize: body.length,
        redirected: false,
        ok: true,
      };

      if (this.config?.beforeSend) {
        const modified = this.config.beforeSend(responseEvent);
        if (!modified) return;
        if (modified.phase === NetworkPhase.RESPONSE) {
          responseEvent = modified;
        }
      }

      this.sendMessage(responseEvent);
    }
  }

  cleanup() {
    if (!this.isSetup) return;
    this.isSetup = false;

    if (this.originalStdoutWrite) {
      process.stdout.write = this.originalStdoutWrite;
      this.originalStdoutWrite = null;
    }

    if (this.stdinListener) {
      process.stdin.removeListener("data", this.stdinListener);
      this.stdinListener = null;
    }

    this.pendingRequests.clear();
    this.stdinBuffer = "";
    this.stdoutBuffer = "";
  }
}
