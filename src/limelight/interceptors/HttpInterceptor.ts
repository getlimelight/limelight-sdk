import type http from "http";
import type https from "https";
import {
  HttpMethod,
  LimelightConfig,
  LimelightMessage,
  NetworkErrorEvent,
  NetworkPhase,
  NetworkType,
} from "@/types";
import {
  formatRequestName,
  getInitiator,
  isBinaryContentType,
  redactSensitiveHeaders,
  resolveUrl,
  serializeBody,
} from "@/helpers";
import { generateRequestId } from "@/protocol";
import { getTraceContext } from "@/limelight/context";
import { MAX_BODY_SIZE } from "@/constants";

export class HttpInterceptor {
  private originalHttpRequest: typeof http.request | null = null;
  private originalHttpGet: typeof http.get | null = null;
  private originalHttpsRequest: typeof https.request | null = null;
  private originalHttpsGet: typeof https.get | null = null;

  private httpModule: typeof http | null = null;
  private httpsModule: typeof https | null = null;

  private config: LimelightConfig | null = null;
  private isSetup = false;

  constructor(
    private sendMessage: (message: LimelightMessage) => void,
    private getSessionId: () => string,
  ) {
    try {
      const _require = globalThis["require"] as typeof require;
      this.httpModule = _require("http");
      this.httpsModule = _require("https");

      this.originalHttpRequest = this.httpModule!.request;
      this.originalHttpGet = this.httpModule!.get;
      this.originalHttpsRequest = this.httpsModule!.request;
      this.originalHttpsGet = this.httpsModule!.get;
    } catch {
      // Browser / React Native - http module not available
    }
  }

  setup(config: LimelightConfig) {
    if (this.isSetup) {
      if (this.config?.enableInternalLogging) {
        console.warn("[Limelight] HTTP interceptor already set up");
      }

      return;
    }

    if (!this.httpModule || !this.httpsModule) {
      if (config?.enableInternalLogging) {
        console.warn(
          "[Limelight] Node http module not available, skipping HTTP interception",
        );
      }

      return;
    }

    this.isSetup = true;
    this.config = config;

    const self = this;
    const httpMod = this.httpModule;
    const httpsMod = this.httpsModule;

    httpMod.request = (...args: any[]) => {
      return self.interceptRequest(
        "http:",
        self.originalHttpRequest!,
        httpMod,
        args,
      );
    };

    httpMod.get = (...args: any[]) => {
      const req = self.interceptRequest(
        "http:",
        self.originalHttpRequest!,
        httpMod,
        args,
      );
      req.end();
      return req;
    };

    httpsMod.request = (...args: any[]) => {
      return self.interceptRequest(
        "https:",
        self.originalHttpsRequest!,
        httpsMod,
        args,
      );
    };

    httpsMod.get = (...args: any[]) => {
      const req = self.interceptRequest(
        "https:",
        self.originalHttpsRequest!,
        httpsMod,
        args,
      );
      req.end();
      return req;
    };
  }

  private interceptRequest(
    protocol: string,
    originalMethod: typeof http.request,
    module: typeof http | typeof https,
    args: any[],
  ): http.ClientRequest {
    let url: string | URL | undefined;
    let options: http.RequestOptions;
    let callback: ((res: http.IncomingMessage) => void) | undefined;

    if (typeof args[0] === "string" || args[0] instanceof URL) {
      url = args[0];

      if (typeof args[1] === "function") {
        options = {};
        callback = args[1];
      } else {
        options = args[1] || {};
        callback = args[2];
      }
    } else {
      options = args[0] || {};
      callback = args[1];
    }

    let resolvedUrl: string;

    if (url) {
      resolvedUrl = url.toString();
    } else {
      resolvedUrl = resolveUrl(protocol, options);
    }

    const limelightServerUrl = this.config?.serverUrl || "";

    if (limelightServerUrl && resolvedUrl.includes(limelightServerUrl)) {
      return originalMethod.apply(module, args as any);
    }

    const self = this;
    const requestId = generateRequestId();
    const startTime = Date.now();
    const initiator = getInitiator();

    const traceHeaderName =
      this.config?.traceHeaderName ?? "x-limelight-trace-id";
    const existingTraceId = getTraceContext()?.getStore()?.traceId;
    const traceId = existingTraceId || generateRequestId();

    if (!options.headers) {
      options.headers = {};
    }

    (options.headers as Record<string, string>)[traceHeaderName] = traceId;

    const method = (options.method || "GET").toUpperCase() as HttpMethod;

    let patchedArgs: any[];

    if (url) {
      patchedArgs = callback ? [url, options, callback] : [url, options];
    } else {
      patchedArgs = callback ? [options, callback] : [options];
    }

    const req: http.ClientRequest = originalMethod.apply(
      module,
      patchedArgs as any,
    );

    const bodyChunks: Buffer[] = [];
    let totalBodySize = 0;
    let requestEventSent = false;
    const originalWrite = req.write.bind(req);
    const originalEnd = req.end.bind(req);

    req.write = (
      chunk: any,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ): boolean => {
      if (chunk && totalBodySize < MAX_BODY_SIZE) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bodyChunks.push(buf);
        totalBodySize += buf.length;
      }
      return originalWrite(chunk, encodingOrCallback as any, callback as any);
    };

    req.end = (
      chunk?: any,
      encodingOrCallback?: BufferEncoding | (() => void),
      callback?: () => void,
    ): http.ClientRequest => {
      if (
        chunk &&
        typeof chunk !== "function" &&
        totalBodySize < MAX_BODY_SIZE
      ) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bodyChunks.push(buf);
        totalBodySize += buf.length;
      }

      if (!requestEventSent) {
        requestEventSent = true;

        const fullBody =
          bodyChunks.length > 0
            ? Buffer.concat(bodyChunks).toString("utf-8")
            : undefined;

        const headers: Record<string, string> = {};
        const rawHeaders = req.getHeaders();

        for (const [key, value] of Object.entries(rawHeaders)) {
          if (value !== undefined) {
            headers[key.toLowerCase()] = Array.isArray(value)
              ? value.join(", ")
              : String(value);
          }
        }

        const requestBody = serializeBody(
          fullBody,
          self.config?.disableBodyCapture,
        );

        let requestEvent: LimelightMessage = {
          id: requestId,
          traceId,
          sessionId: self.getSessionId(),
          timestamp: startTime,
          phase: NetworkPhase.REQUEST,
          networkType: NetworkType.HTTP,
          url: resolvedUrl,
          method,
          headers: redactSensitiveHeaders(headers),
          body: requestBody,
          name: formatRequestName(resolvedUrl),
          initiator,
          requestSize: requestBody?.size ?? 0,
        };

        if (self.config?.beforeSend) {
          const modifiedEvent = self.config.beforeSend(requestEvent);

          if (!modifiedEvent) {
            return originalEnd(
              chunk,
              encodingOrCallback as any,
              callback as any,
            );
          }

          if (modifiedEvent.phase !== NetworkPhase.REQUEST) {
            console.error("[Limelight] beforeSend must return same event type");
            return originalEnd(
              chunk,
              encodingOrCallback as any,
              callback as any,
            );
          }

          requestEvent = modifiedEvent;
        }

        self.sendMessage(requestEvent);
      }

      return originalEnd(chunk, encodingOrCallback as any, callback as any);
    };

    let responseSent = false;

    req.on("response", (res: http.IncomingMessage) => {
      const responseChunks: Buffer[] = [];
      let responseSize = 0;

      res.on("data", (chunk: Buffer | string) => {
        if (responseSize < MAX_BODY_SIZE) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          responseChunks.push(buf);
          responseSize += buf.length;
        }
      });

      res.on("end", () => {
        if (responseSent) return;
        responseSent = true;

        const endTime = Date.now();
        const duration = endTime - startTime;

        const responseHeaders: Record<string, string> = {};

        if (res.headers) {
          for (const [key, value] of Object.entries(res.headers)) {
            if (value) {
              responseHeaders[key.toLowerCase()] = Array.isArray(value)
                ? value.join(", ")
                : value;
            }
          }
        }

        const contentType = responseHeaders["content-type"] || "";
        let responseBodyStr: string | undefined;

        if (responseChunks.length > 0) {
          if (isBinaryContentType(contentType)) {
            responseBodyStr = `[Binary Data: ${contentType}]`;
          } else {
            const full = Buffer.concat(responseChunks);
            responseBodyStr =
              full.length > MAX_BODY_SIZE
                ? full.toString("utf-8", 0, MAX_BODY_SIZE) + "...[truncated]"
                : full.toString("utf-8");
          }
        }

        const responseBody = serializeBody(
          responseBodyStr,
          self.config?.disableBodyCapture,
        );

        const statusCode = res.statusCode ?? 0;

        let responseEvent: LimelightMessage = {
          id: requestId,
          traceId,
          sessionId: self.getSessionId(),
          timestamp: endTime,
          phase: NetworkPhase.RESPONSE,
          networkType: NetworkType.HTTP,
          status: statusCode,
          statusText: res.statusMessage || "",
          headers: redactSensitiveHeaders(responseHeaders),
          body: responseBody,
          duration,
          responseSize: responseBody?.size ?? 0,
          redirected: false,
          ok: statusCode >= 200 && statusCode < 300,
        };

        if (self.config?.beforeSend) {
          const modifiedEvent = self.config.beforeSend(responseEvent);

          if (!modifiedEvent) return;

          if (modifiedEvent.phase !== NetworkPhase.RESPONSE) {
            console.error("[Limelight] beforeSend must return same event type");
            return;
          }

          responseEvent = modifiedEvent;
        }

        self.sendMessage(responseEvent);
      });
    });

    req.on("error", (err: Error) => {
      if (responseSent) return;
      responseSent = true;

      let errorEvent: NetworkErrorEvent = {
        id: requestId,
        traceId,
        sessionId: self.getSessionId(),
        timestamp: Date.now(),
        phase: NetworkPhase.ERROR,
        networkType: NetworkType.HTTP,
        errorMessage: err.message || "Network request failed",
        stack: err.stack,
      };

      if (self.config?.beforeSend) {
        const modifiedEvent = self.config.beforeSend(errorEvent);

        if (
          modifiedEvent &&
          (modifiedEvent.phase === NetworkPhase.ERROR ||
            modifiedEvent.phase === NetworkPhase.ABORT)
        ) {
          errorEvent = modifiedEvent;
        }
      }

      self.sendMessage(errorEvent);
    });

    req.on("timeout", () => {
      if (responseSent) return;
      responseSent = true;

      let errorEvent: NetworkErrorEvent = {
        id: requestId,
        traceId,
        sessionId: self.getSessionId(),
        timestamp: Date.now(),
        phase: NetworkPhase.ERROR,
        networkType: NetworkType.HTTP,
        errorMessage: "Request timeout",
      };

      if (self.config?.beforeSend) {
        const modifiedEvent = self.config.beforeSend(errorEvent);

        if (
          modifiedEvent &&
          (modifiedEvent.phase === NetworkPhase.ERROR ||
            modifiedEvent.phase === NetworkPhase.ABORT)
        ) {
          errorEvent = modifiedEvent;
        }
      }

      self.sendMessage(errorEvent);
    });

    req.on("close", () => {
      if (responseSent) return;
      if (!req.destroyed) return;

      responseSent = true;

      let errorEvent: NetworkErrorEvent = {
        id: requestId,
        traceId,
        sessionId: self.getSessionId(),
        timestamp: Date.now(),
        phase: NetworkPhase.ABORT,
        networkType: NetworkType.HTTP,
        errorMessage: "Request aborted",
      };

      if (self.config?.beforeSend) {
        const modifiedEvent = self.config.beforeSend(errorEvent);
        if (
          modifiedEvent &&
          (modifiedEvent.phase === NetworkPhase.ERROR ||
            modifiedEvent.phase === NetworkPhase.ABORT)
        ) {
          errorEvent = modifiedEvent;
        }
      }

      self.sendMessage(errorEvent);
    });

    return req;
  }

  cleanup() {
    if (!this.isSetup) {
      if (this.config?.enableInternalLogging) {
        console.warn("[Limelight] HTTP interceptor not set up");
      }
      return;
    }

    this.isSetup = false;

    if (this.httpModule && this.originalHttpRequest) {
      this.httpModule.request = this.originalHttpRequest;
    }

    if (this.httpModule && this.originalHttpGet) {
      this.httpModule.get = this.originalHttpGet;
    }

    if (this.httpsModule && this.originalHttpsRequest) {
      this.httpsModule.request = this.originalHttpsRequest;
    }

    if (this.httpsModule && this.originalHttpsGet) {
      this.httpsModule.get = this.originalHttpsGet;
    }
  }
}
