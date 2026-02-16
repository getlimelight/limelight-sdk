import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";
import { createHttpMiddleware } from "@/limelight/middleware";
import { LimelightConfig, NetworkPhase, NetworkType } from "@/types";

function createMockReq(overrides: Record<string, any> = {}) {
  return {
    method: "GET",
    url: "/api/users",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      authorization: "Bearer secret-token",
    },
    body: undefined,
    ...overrides,
  } as any;
}

function createMockRes() {
  const res = new EventEmitter() as any;
  const chunks: Buffer[] = [];

  res.statusCode = 200;
  res.statusMessage = "OK";
  res.getHeaders = vi.fn(() => ({
    "content-type": "application/json",
  }));
  res.write = vi.fn((chunk: any) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  });
  res.end = vi.fn((chunk?: any) => {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    res.emit("finish");
    return res;
  });

  return res;
}

describe("httpMiddleware", () => {
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let getSessionIdSpy: ReturnType<typeof vi.fn>;
  let getConfigSpy: ReturnType<typeof vi.fn>;
  let config: LimelightConfig;

  beforeEach(() => {
    sendMessageSpy = vi.fn();
    getSessionIdSpy = vi.fn(() => "test-session");
    config = {
      enabled: true,
      enableNetworkInspector: true,
      enableConsole: true,
    };
    getConfigSpy = vi.fn(() => config);
  });

  it("should send REQUEST event on request start", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: NetworkPhase.REQUEST,
        networkType: NetworkType.INCOMING,
        url: "/api/users",
        method: "GET",
      }),
    );
  });

  it("should send RESPONSE event when response finishes", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    res.end(JSON.stringify({ users: [] }));

    expect(sendMessageSpy).toHaveBeenCalledTimes(2);

    const responseCall = sendMessageSpy.mock.calls[1]?.[0];
    expect(responseCall.phase).toBe(NetworkPhase.RESPONSE);
    expect(responseCall.networkType).toBe(NetworkType.INCOMING);
    expect(responseCall.status).toBe(200);
    expect(responseCall.duration).toBeGreaterThanOrEqual(0);
  });

  it("should redact sensitive headers", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    const requestCall = sendMessageSpy.mock.calls[0]?.[0];
    expect(requestCall.headers.authorization).toBe("[REDACTED]");
    expect(requestCall.headers.host).toBe("localhost:3000");
  });

  it("should capture request body from req.body", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq({
      method: "POST",
      body: { name: "test" },
    });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    const requestCall = sendMessageSpy.mock.calls[0]?.[0];
    expect(requestCall.body?.raw).toContain("test");
  });

  it("should capture response body from res.end()", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    res.end('{"result":"ok"}');

    const responseCall = sendMessageSpy.mock.calls[1]?.[0];
    expect(responseCall.body?.raw).toContain("ok");
  });

  it("should truncate bodies exceeding maxBodySize", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
      { maxBodySize: 16 },
    );

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    res.end("A".repeat(100));

    const responseCall = sendMessageSpy.mock.calls[1]?.[0];
    expect(responseCall.body?.raw).toContain("...[truncated]");
    expect(responseCall.body?.raw?.length).toBeLessThan(100);
  });

  it("should link request and response with same id", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);
    res.end("done");

    const requestId = sendMessageSpy.mock.calls[0]?.[0].id;
    const responseId = sendMessageSpy.mock.calls[1]?.[0].id;
    expect(requestId).toBe(responseId);
  });

  it("should respect beforeSend hook", () => {
    config.beforeSend = vi.fn(() => null);

    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(config.beforeSend).toHaveBeenCalled();
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("should handle missing req.body gracefully", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq({ body: undefined });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(sendMessageSpy).toHaveBeenCalled();
    const requestCall = sendMessageSpy.mock.calls[0]?.[0];
    expect(requestCall.body?.format).toBe("NONE");
  });
});
