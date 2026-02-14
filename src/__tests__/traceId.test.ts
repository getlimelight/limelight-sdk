import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NetworkInterceptor } from "@/limelight";
import { createHttpMiddleware } from "@/limelight/middleware";
import { EventEmitter } from "events";

const createMockReq = (overrides: Record<string, any> = {}) => {
  return {
    method: "GET",
    url: "/api/users",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
    },
    body: undefined,
    ...overrides,
  } as any;
};

const createMockRes = () => {
  const res = new EventEmitter() as any;

  res.statusCode = 200;
  res.statusMessage = "OK";
  res.getHeaders = vi.fn(() => ({ "content-type": "application/json" }));
  res.write = vi.fn((chunk: any) => true);
  res.end = vi.fn((chunk?: any) => {
    res.emit("finish");
    return res;
  });

  return res;
};

describe("NetworkInterceptor trace ID", () => {
  let interceptor: NetworkInterceptor;
  let originalFetch: typeof fetch;
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let getSessionIdSpy: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;
    sendMessageSpy = vi.fn();
    getSessionIdSpy = vi.fn(() => "test-session");
    interceptor = new NetworkInterceptor(sendMessageSpy, getSessionIdSpy);
  });

  afterEach(() => {
    interceptor.cleanup();
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("should inject x-limelight-trace-id header on outgoing requests", async () => {
    mockFetch.mockResolvedValue(new Response("ok"));
    interceptor.setup({ enableNetworkInspector: true });

    await fetch("https://api.example.com/test");

    const [, init] = mockFetch.mock.calls[0]!;
    const headers = init.headers as Headers;
    expect(headers.get("x-limelight-trace-id")).toBeTruthy();
  });

  it("should include traceId in REQUEST and RESPONSE messages", async () => {
    mockFetch.mockResolvedValue(new Response("ok"));
    interceptor.setup({ enableNetworkInspector: true });

    await fetch("https://api.example.com/test");

    const requestEvent = sendMessageSpy.mock.calls.find(
      (call: any[]) => call[0].phase === "REQUEST",
    )?.[0];

    const responseEvent = sendMessageSpy.mock.calls.find(
      (call: any[]) => call[0].phase === "RESPONSE",
    )?.[0];

    expect(requestEvent.traceId).toBeTruthy();
    expect(responseEvent.traceId).toBe(requestEvent.traceId);
  });

  it("should include traceId in ERROR messages", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));
    interceptor.setup({ enableNetworkInspector: true });

    await expect(fetch("https://api.example.com/test")).rejects.toThrow();

    const requestEvent = sendMessageSpy.mock.calls.find(
      (call: any[]) => call[0].phase === "REQUEST",
    )?.[0];

    const errorEvent = sendMessageSpy.mock.calls.find(
      (call: any[]) => call[0].phase === "ERROR",
    )?.[0];

    expect(errorEvent.traceId).toBe(requestEvent.traceId);
  });

  it("should not overwrite existing x-limelight-trace-id header", async () => {
    mockFetch.mockResolvedValue(new Response("ok"));
    interceptor.setup({ enableNetworkInspector: true });

    await fetch("https://api.example.com/test", {
      headers: { "x-limelight-trace-id": "manual-trace-123" },
    });

    const [, init] = mockFetch.mock.calls[0]!;
    const headers = init.headers as Headers;

    expect(headers.get("x-limelight-trace-id")).toBe("manual-trace-123");

    const requestEvent = sendMessageSpy.mock.calls.find(
      (call: any[]) => call[0].phase === "REQUEST",
    )?.[0];
    expect(requestEvent.traceId).toBe("manual-trace-123");
  });

  it("should use custom traceHeaderName from config", async () => {
    mockFetch.mockResolvedValue(new Response("ok"));
    interceptor.setup({
      enableNetworkInspector: true,
      traceHeaderName: "x-custom-trace",
    });

    await fetch("https://api.example.com/test");

    const [, init] = mockFetch.mock.calls[0]!;
    const headers = init.headers as Headers;
    expect(headers.get("x-custom-trace")).toBeTruthy();
    expect(headers.get("x-limelight-trace-id")).toBeNull();
  });
});

describe("httpMiddleware trace ID", () => {
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let getSessionIdSpy: ReturnType<typeof vi.fn>;
  let getConfigSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessageSpy = vi.fn();
    getSessionIdSpy = vi.fn(() => "test-session");
    getConfigSpy = vi.fn(() => ({
      enabled: true,
      enableNetworkInspector: true,
    }));
  });

  it("should read trace ID from incoming request header", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq({
      headers: {
        host: "localhost:3000",
        "x-limelight-trace-id": "incoming-trace-456",
      },
    });

    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    const requestEvent = sendMessageSpy.mock.calls[0]?.[0];
    expect(requestEvent.traceId).toBe("incoming-trace-456");
  });

  it("should generate a trace ID when not present in headers", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    const requestEvent = sendMessageSpy.mock.calls[0]?.[0];
    expect(requestEvent.traceId).toBeTruthy();
    expect(requestEvent.traceId).toMatch(/^req-/);
  });

  it("should include same traceId in both REQUEST and RESPONSE events", () => {
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

    const requestEvent = sendMessageSpy.mock.calls[0]?.[0];
    const responseEvent = sendMessageSpy.mock.calls[1]?.[0];

    expect(requestEvent.traceId).toBe(responseEvent.traceId);
  });

  it("should set limelightTraceId on the request object", () => {
    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq({
      headers: {
        "x-limelight-trace-id": "from-client",
      },
    });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(req.limelightTraceId).toBe("from-client");
  });

  it("should use custom traceHeaderName from config", () => {
    getConfigSpy = vi.fn(() => ({
      enabled: true,
      enableNetworkInspector: true,
      traceHeaderName: "x-custom-trace",
    }));

    const middleware = createHttpMiddleware(
      sendMessageSpy,
      getSessionIdSpy,
      getConfigSpy,
    );

    const req = createMockReq({
      headers: {
        host: "localhost:3000",
        "x-custom-trace": "custom-trace-789",
      },
    });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res, next);

    const requestEvent = sendMessageSpy.mock.calls[0]?.[0];
    expect(requestEvent.traceId).toBe("custom-trace-789");
  });
});
