import type { IncomingMessage, ServerResponse } from "http";
import {
  HttpMethod,
  LimelightConfig,
  LimelightMessage,
  NetworkPhase,
  NetworkType,
} from "@/types";
import { redactSensitiveHeaders, serializeBody } from "@/helpers";
import { generateRequestId } from "@/protocol";
import { getTraceContext } from "@/limelight/context";

const DEFAULT_MAX_BODY_SIZE = 64 * 1024; // 64KB

export interface MiddlewareOptions {
  /** Maximum body size to capture in bytes. Bodies larger than this are truncated. Default: 64KB */
  maxBodySize?: number;
}

/**
 * Captures incoming request data and sends REQUEST/RESPONSE events through
 * the Limelight message protocol. Shared logic used by both Express middleware
 * and Next.js wrapper.
 *
 * @param req Incoming HTTP request object (Node.js IncomingMessage)
 * @param res HTTP response object (Node.js ServerResponse)
 * @param sendMessage Function to send Limelight messages to the server
 * @param getSessionId Function to retrieve the current Limelight session ID
 * @param config Current Limelight configuration object
 * @param options Optional middleware options (e.g. maxBodySize)
 * @returns void
 */
export const captureRequest = (
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  sendMessage: (message: LimelightMessage) => void,
  getSessionId: () => string,
  config: LimelightConfig | null,
  options?: MiddlewareOptions,
) => {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const maxBodySize = options?.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

  const traceHeaderName = config?.traceHeaderName ?? "x-limelight-trace-id";
  const incomingTraceId = req.headers[traceHeaderName] as string | undefined;
  const traceId = incomingTraceId || generateRequestId();
  (req as any).limelightTraceId = traceId;

  const url = req.url || "/";
  const method = (req.method || "GET").toUpperCase() as HttpMethod;

  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      headers[key.toLowerCase()] = Array.isArray(value)
        ? value.join(", ")
        : value;
    }
  }

  let requestBody = serializeBody(req.body, config?.disableBodyCapture);

  if (requestBody?.raw && requestBody.raw.length > maxBodySize) {
    requestBody = {
      ...requestBody,
      raw: requestBody.raw.slice(0, maxBodySize) + "...[truncated]",
      size: requestBody.size,
    };
  }

  let requestEvent: LimelightMessage = {
    id: requestId,
    traceId,
    sessionId: getSessionId(),
    timestamp: startTime,
    phase: NetworkPhase.REQUEST,
    networkType: NetworkType.INCOMING,
    url,
    method,
    headers: redactSensitiveHeaders(headers),
    body: requestBody,
    name: url.split("?")[0]?.split("/").filter(Boolean).pop() ?? "/",
    initiator: "incoming",
    requestSize: requestBody?.size ?? 0,
  };

  if (config?.beforeSend) {
    const modified = config.beforeSend(requestEvent);

    if (!modified) return;
    if (modified.phase !== NetworkPhase.REQUEST) {
      console.error("[Limelight] beforeSend must return same event type");
      return;
    }

    requestEvent = modified;
  }

  sendMessage(requestEvent);

  const chunks: Buffer[] = [];
  let totalSize = 0;
  const originalWrite = res.write;
  const originalEnd = res.end;

  res.write = function (chunk: any, ...args: any[]): boolean {
    if (chunk && totalSize < maxBodySize) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      totalSize += buf.length;
    }
    return originalWrite.apply(res, [chunk, ...args] as any);
  };

  res.end = function (chunk: any, ...args: any[]): ServerResponse {
    if (chunk && totalSize < maxBodySize) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      totalSize += buf.length;
    }
    return originalEnd.apply(res, [chunk, ...args] as any);
  };

  res.on("finish", () => {
    const endTime = Date.now();
    const duration = endTime - startTime;

    const responseHeaders: Record<string, string> = {};
    const rawHeaders = res.getHeaders();

    for (const [key, value] of Object.entries(rawHeaders)) {
      if (value) {
        responseHeaders[key.toLowerCase()] = Array.isArray(value)
          ? value.join(", ")
          : String(value);
      }
    }

    let responseBodyStr: string | undefined;

    if (chunks.length > 0 && !config?.disableBodyCapture) {
      const full = Buffer.concat(chunks);
      const fullStr = full.toString("utf-8");

      responseBodyStr =
        fullStr.length > maxBodySize
          ? fullStr.slice(0, maxBodySize) + "...[truncated]"
          : fullStr;
    }

    const responseBody = serializeBody(
      responseBodyStr,
      config?.disableBodyCapture,
    );

    let responseEvent: LimelightMessage = {
      id: requestId,
      traceId,
      sessionId: getSessionId(),
      timestamp: endTime,
      phase: NetworkPhase.RESPONSE,
      networkType: NetworkType.INCOMING,
      status: res.statusCode,
      statusText: res.statusMessage || "",
      headers: redactSensitiveHeaders(responseHeaders),
      body: responseBody,
      duration,
      responseSize: responseBody?.size ?? 0,
      redirected: false,
      ok: res.statusCode >= 200 && res.statusCode < 300,
    };

    if (config?.beforeSend) {
      const modified = config.beforeSend(responseEvent);
      if (!modified) return;
      if (modified.phase !== NetworkPhase.RESPONSE) {
        console.error("[Limelight] beforeSend must return same event type");
        return;
      }
      responseEvent = modified;
    }

    sendMessage(responseEvent);
  });
};

/**
 * Creates an Express/Connect-compatible middleware that captures incoming
 * HTTP requests and responses, sending them through the Limelight protocol.
 *
 * Place this middleware AFTER body-parser middleware (express.json(), etc.)
 * so that req.body is available for request body capture.
 *
 * @param sendMessage Function to send Limelight messages to the server
 * @param getSessionId Function to retrieve the current Limelight session ID
 * @param getConfig Function to retrieve the current Limelight configuration
 * @param options Optional middleware options (e.g. maxBodySize)
 * @returns An Express/Connect middleware function
 */
export const createHttpMiddleware = (
  sendMessage: (message: LimelightMessage) => void,
  getSessionId: () => string,
  getConfig: () => LimelightConfig | null,
  options?: MiddlewareOptions,
) => {
  return (
    req: IncomingMessage & { body?: unknown },
    res: ServerResponse,
    next: () => void,
  ) => {
    captureRequest(req, res, sendMessage, getSessionId, getConfig(), options);
    const traceId = (req as any).limelightTraceId as string | undefined;
    const ctx = getTraceContext();
    if (ctx && traceId) {
      ctx.run({ traceId }, next);
    } else {
      next();
    }
  };
};
