// @vitest-environment node

// HttpInterceptor uses globalThis["require"]("http") in its constructor.
// vitest exposes `require` locally but NOT on globalThis, so bridge it.
(globalThis as any).require ??= require;

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "http";
import { EventEmitter } from "events";
import { HttpInterceptor } from "@/limelight";
import { NetworkPhase, NetworkType } from "@/types";

const createMockClientRequest = () => {
  const req = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    getHeaders: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  };
  req.write = vi.fn(() => true);
  req.end = vi.fn(() => req);
  req.getHeaders = vi.fn(() => ({}));
  req.destroyed = false;
  return req;
};

const createMockIncomingMessage = (
  overrides: {
    statusCode?: number;
    statusMessage?: string;
    headers?: Record<string, string>;
  } = {},
) => {
  const res = new EventEmitter() as EventEmitter & {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string>;
  };
  res.statusCode = overrides.statusCode ?? 200;
  res.statusMessage = overrides.statusMessage ?? "OK";
  res.headers = overrides.headers ?? { "content-type": "application/json" };
  return res;
};

// ---------------------------------------------------------------------------

describe("HttpInterceptor", () => {
  let interceptor: HttpInterceptor;
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let getSessionIdSpy: ReturnType<typeof vi.fn>;

  let originalHttpRequest: typeof http.request;
  let originalHttpGet: typeof http.get;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Save real methods
    originalHttpRequest = http.request;
    originalHttpGet = http.get;

    // Replace http.request with a mock BEFORE the interceptor constructor
    // captures the "original" reference
    mockRequest = vi.fn(() => createMockClientRequest());
    http.request = mockRequest as any;
    http.get = mockRequest as any;

    sendMessageSpy = vi.fn();
    getSessionIdSpy = vi.fn(() => "test-session-123");

    interceptor = new HttpInterceptor(sendMessageSpy, getSessionIdSpy);
  });

  afterEach(() => {
    interceptor.cleanup();
    // Restore real methods
    http.request = originalHttpRequest;
    http.get = originalHttpGet;
    vi.clearAllMocks();
  });

  // =========================================================================
  // setup()
  // =========================================================================

  describe("setup()", () => {
    it("should intercept http.request and emit REQUEST + RESPONSE events", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      // Make a request through the patched http.request
      const req = http.request("http://api.example.com/users", {
        method: "POST",
      });

      // Simulate writing body and ending
      req.end(JSON.stringify({ name: "test" }));

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: NetworkPhase.REQUEST,
          networkType: NetworkType.HTTP,
          url: "http://api.example.com/users",
          method: "POST",
        }),
      );

      // Simulate response
      const mockRes = createMockIncomingMessage({ statusCode: 201 });
      mockReq.emit("response", mockRes);
      mockRes.emit("data", Buffer.from('{"id":1}'));
      mockRes.emit("end");

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: NetworkPhase.RESPONSE,
          networkType: NetworkType.HTTP,
          status: 201,
          ok: true,
        }),
      );
    });

    it("should intercept http.get and emit REQUEST + RESPONSE events", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      http.get("http://api.example.com/data");

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: NetworkPhase.REQUEST,
          networkType: NetworkType.HTTP,
          method: "GET",
        }),
      );
    });

    it("should inject trace header into outgoing request", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      http.request({ hostname: "api.example.com", path: "/test" });

      // The mock should have been called with options containing the trace header
      const callArgs = mockRequest.mock.calls[0];
      const options = callArgs?.[0];
      expect(options.headers["x-limelight-trace-id"]).toBeDefined();
    });

    it("should use custom traceHeaderName from config", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({
        enableNetworkInspector: true,
        traceHeaderName: "x-custom-trace",
      });

      http.request({ hostname: "api.example.com", path: "/test" });

      const callArgs = mockRequest.mock.calls[0];
      const options = callArgs?.[0];
      expect(options.headers["x-custom-trace"]).toBeDefined();
    });

    it("should prevent double setup", () => {
      const consoleSpy = vi.spyOn(console, "warn");

      interceptor.setup({
        enableNetworkInspector: true,
        enableInternalLogging: true,
      });

      interceptor.setup({
        enableNetworkInspector: true,
        enableInternalLogging: true,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("already set up"),
      );
    });
  });

  // =========================================================================
  // Request / Response capture
  // =========================================================================

  describe("request and response capture", () => {
    it("should capture request body from write() + end()", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "api.example.com",
        path: "/data",
        method: "POST",
      });

      req.write("chunk1");
      req.end("chunk2");

      const requestEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.REQUEST,
      )?.[0];

      expect(requestEvent).toBeDefined();
      expect(requestEvent.body?.raw).toContain("chunk1");
      expect(requestEvent.body?.raw).toContain("chunk2");
    });

    it("should capture response body", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "api.example.com",
        path: "/data",
      });
      req.end();

      const mockRes = createMockIncomingMessage();
      mockReq.emit("response", mockRes);
      mockRes.emit("data", Buffer.from('{"result":'));
      mockRes.emit("data", Buffer.from('"ok"}'));
      mockRes.emit("end");

      const responseEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.RESPONSE,
      )?.[0];

      expect(responseEvent).toBeDefined();
      expect(responseEvent.body?.raw).toContain('"ok"');
    });

    it("should capture binary responses as placeholder text", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "cdn.example.com",
        path: "/image.png",
      });
      req.end();

      const mockRes = createMockIncomingMessage({
        headers: { "content-type": "image/png" },
      });
      mockReq.emit("response", mockRes);
      mockRes.emit("data", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      mockRes.emit("end");

      const responseEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.RESPONSE,
      )?.[0];

      expect(responseEvent.body?.raw).toContain("[Binary Data: image/png]");
    });

    it("should link request and response with the same id and traceId", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "api.example.com",
        path: "/test",
      });
      req.end();

      const mockRes = createMockIncomingMessage();
      mockReq.emit("response", mockRes);
      mockRes.emit("end");

      const requestEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.REQUEST,
      )?.[0];
      const responseEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.RESPONSE,
      )?.[0];

      expect(requestEvent.id).toBe(responseEvent.id);
      expect(requestEvent.traceId).toBe(responseEvent.traceId);
    });

    it("should not send duplicate REQUEST events on double end()", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      // Simulate what http.get does: interceptRequest returns req, then get calls req.end()
      const req = http.request({
        hostname: "api.example.com",
        path: "/test",
      });
      req.end();
      req.end(); // second call — should be no-op for event emission

      const requestEvents = sendMessageSpy.mock.calls.filter(
        (call: any[]) => call[0].phase === NetworkPhase.REQUEST,
      );

      expect(requestEvents).toHaveLength(1);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe("error handling", () => {
    it("should emit ERROR event on request error", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "nonexistent.invalid",
        path: "/test",
      });
      req.end();

      mockReq.emit("error", new Error("ECONNREFUSED"));

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: NetworkPhase.ERROR,
          networkType: NetworkType.HTTP,
          errorMessage: "ECONNREFUSED",
        }),
      );
    });

    it("should emit ERROR event on timeout", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "slow.example.com",
        path: "/test",
      });
      req.end();

      mockReq.emit("timeout");

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: NetworkPhase.ERROR,
          networkType: NetworkType.HTTP,
          errorMessage: "Request timeout",
        }),
      );
    });

    it("should emit ABORT event when request is destroyed before response", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "api.example.com",
        path: "/test",
      });
      req.end();

      // Simulate destroy + close
      mockReq.destroyed = true;
      mockReq.emit("close");

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: NetworkPhase.ABORT,
          networkType: NetworkType.HTTP,
          errorMessage: "Request aborted",
        }),
      );
    });

    it("should not emit duplicate events for error after response", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "api.example.com",
        path: "/test",
      });
      req.end();

      // Response arrives first
      const mockRes = createMockIncomingMessage();
      mockReq.emit("response", mockRes);
      mockRes.emit("end");

      // Then an error fires (e.g. socket hangup after response)
      mockReq.emit("error", new Error("socket hang up"));

      const errorEvents = sendMessageSpy.mock.calls.filter(
        (call: any[]) =>
          call[0].phase === NetworkPhase.ERROR ||
          call[0].phase === NetworkPhase.ABORT,
      );

      expect(errorEvents).toHaveLength(0);
    });

    it("should not emit ABORT when close fires without destroyed", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "api.example.com",
        path: "/test",
      });
      req.end();

      // Normal close (not destroyed)
      mockReq.destroyed = false;
      mockReq.emit("close");

      const abortEvents = sendMessageSpy.mock.calls.filter(
        (call: any[]) => call[0].phase === NetworkPhase.ABORT,
      );

      expect(abortEvents).toHaveLength(0);
    });
  });

  // =========================================================================
  // Filtering
  // =========================================================================

  describe("traffic filtering", () => {
    it("should skip Limelight server traffic", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({
        enableNetworkInspector: true,
        serverUrl: "ws://localhost:8080/limelight",
      });

      http.request("http://localhost:8080/limelight");

      // Should have called the original mock but NOT sent any Limelight events
      expect(mockRequest).toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // beforeSend hook
  // =========================================================================

  describe("beforeSend", () => {
    it("should drop request event when beforeSend returns null", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      const beforeSend = vi.fn(() => null);

      interceptor.setup({
        enableNetworkInspector: true,
        beforeSend,
      });

      const req = http.request({
        hostname: "api.example.com",
        path: "/sensitive",
        method: "GET",
      });
      req.end();

      expect(beforeSend).toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it("should allow beforeSend to modify request events", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      const beforeSend = vi.fn((event: any) => ({
        ...event,
        url: "[REDACTED]",
      }));

      interceptor.setup({
        enableNetworkInspector: true,
        beforeSend,
      });

      const req = http.request({
        hostname: "api.example.com",
        path: "/data",
      });
      req.end();

      const requestEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.REQUEST,
      )?.[0];

      expect(requestEvent.url).toBe("[REDACTED]");
    });

    it("should drop response event when beforeSend returns null", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      const beforeSend = vi.fn((event: any) => {
        if (event.phase === NetworkPhase.RESPONSE) return null;
        return event;
      });

      interceptor.setup({
        enableNetworkInspector: true,
        beforeSend,
      });

      const req = http.request({
        hostname: "api.example.com",
        path: "/data",
      });
      req.end();

      const mockRes = createMockIncomingMessage();
      mockReq.emit("response", mockRes);
      mockRes.emit("end");

      const responseEvents = sendMessageSpy.mock.calls.filter(
        (call: any[]) => call[0].phase === NetworkPhase.RESPONSE,
      );

      expect(responseEvents).toHaveLength(0);
    });
  });

  // =========================================================================
  // Headers
  // =========================================================================

  describe("header handling", () => {
    it("should redact sensitive headers in request events", () => {
      const mockReq = createMockClientRequest();
      mockReq.getHeaders = vi.fn(() => ({
        authorization: "Bearer secret",
        "content-type": "application/json",
      }));
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "api.example.com",
        path: "/test",
        headers: { authorization: "Bearer secret" },
      });
      req.end();

      const requestEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.REQUEST,
      )?.[0];

      expect(requestEvent.headers["authorization"]).toBe("[REDACTED]");
    });

    it("should redact sensitive headers in response events", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "api.example.com",
        path: "/test",
      });
      req.end();

      const mockRes = createMockIncomingMessage({
        headers: {
          "set-cookie": "session=abc123",
          "content-type": "application/json",
        },
      });
      mockReq.emit("response", mockRes);
      mockRes.emit("end");

      const responseEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.RESPONSE,
      )?.[0];

      expect(responseEvent.headers["set-cookie"]).toBe("[REDACTED]");
      expect(responseEvent.headers["content-type"]).toBe("application/json");
    });
  });

  // =========================================================================
  // URL resolution
  // =========================================================================

  describe("URL resolution", () => {
    it("should resolve URL from options when no URL string provided", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request({
        hostname: "api.example.com",
        port: 3000,
        path: "/users?page=1",
        method: "GET",
      });
      req.end();

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://api.example.com:3000/users?page=1",
        }),
      );
    });

    it("should use URL string directly when provided", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({ enableNetworkInspector: true });

      const req = http.request("http://api.example.com/items");
      req.end();

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "http://api.example.com/items",
        }),
      );
    });
  });

  // =========================================================================
  // cleanup()
  // =========================================================================

  describe("cleanup()", () => {
    it("should restore original http.request after cleanup", () => {
      interceptor.setup({ enableNetworkInspector: true });

      // After setup, http.request is patched
      expect(http.request).not.toBe(mockRequest);

      interceptor.cleanup();

      // After cleanup, http.request is restored to what the interceptor
      // saved as "original" (our mockRequest)
      expect(http.request).toBe(mockRequest);
    });

    it("should warn when cleanup is called without setup", () => {
      const consoleSpy = vi.spyOn(console, "warn");

      // Create a new interceptor that hasn't been set up, with logging on
      const freshInterceptor = new HttpInterceptor(
        sendMessageSpy,
        getSessionIdSpy,
      );
      // Need to set config with enableInternalLogging — but config is set in setup()
      // so we need to call setup first, then cleanup twice
      freshInterceptor.setup({
        enableNetworkInspector: true,
        enableInternalLogging: true,
      });
      freshInterceptor.cleanup();
      freshInterceptor.cleanup(); // second call should warn

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("not set up"),
      );
    });
  });

  // =========================================================================
  // Concurrent requests
  // =========================================================================

  describe("concurrent requests", () => {
    it("should track concurrent requests independently", () => {
      const mockReq1 = createMockClientRequest();
      const mockReq2 = createMockClientRequest();
      mockRequest.mockReturnValueOnce(mockReq1).mockReturnValueOnce(mockReq2);

      interceptor.setup({ enableNetworkInspector: true });

      const req1 = http.request({
        hostname: "api.example.com",
        path: "/first",
        method: "GET",
      });
      req1.end();

      const req2 = http.request({
        hostname: "api.example.com",
        path: "/second",
        method: "POST",
      });
      req2.end();

      // Respond to req2 first
      const mockRes2 = createMockIncomingMessage({ statusCode: 201 });
      mockReq2.emit("response", mockRes2);
      mockRes2.emit("end");

      // Then respond to req1
      const mockRes1 = createMockIncomingMessage({ statusCode: 200 });
      mockReq1.emit("response", mockRes1);
      mockRes1.emit("end");

      const requestEvents = sendMessageSpy.mock.calls.filter(
        (call: any[]) => call[0].phase === NetworkPhase.REQUEST,
      );
      const responseEvents = sendMessageSpy.mock.calls.filter(
        (call: any[]) => call[0].phase === NetworkPhase.RESPONSE,
      );

      expect(requestEvents).toHaveLength(2);
      expect(responseEvents).toHaveLength(2);

      // Each request/response pair should share the same id
      const req1Id = requestEvents.find((e: any[]) =>
        e[0].url.includes("/first"),
      )?.[0].id;
      const req2Id = requestEvents.find((e: any[]) =>
        e[0].url.includes("/second"),
      )?.[0].id;

      expect(req1Id).not.toBe(req2Id);

      const res1Id = responseEvents.find((e: any[]) => e[0].status === 200)?.[0]
        .id;
      const res2Id = responseEvents.find((e: any[]) => e[0].status === 201)?.[0]
        .id;

      expect(req1Id).toBe(res1Id);
      expect(req2Id).toBe(res2Id);
    });
  });

  // =========================================================================
  // Body capture disabled
  // =========================================================================

  describe("disableBodyCapture", () => {
    it("should not capture bodies when disableBodyCapture is true", () => {
      const mockReq = createMockClientRequest();
      mockRequest.mockReturnValue(mockReq);

      interceptor.setup({
        enableNetworkInspector: true,
        disableBodyCapture: true,
      });

      const req = http.request({
        hostname: "api.example.com",
        path: "/data",
        method: "POST",
      });
      req.end(JSON.stringify({ secret: "data" }));

      const mockRes = createMockIncomingMessage();
      mockReq.emit("response", mockRes);
      mockRes.emit("data", Buffer.from('{"result":"ok"}'));
      mockRes.emit("end");

      const requestEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.REQUEST,
      )?.[0];
      const responseEvent = sendMessageSpy.mock.calls.find(
        (call: any[]) => call[0].phase === NetworkPhase.RESPONSE,
      )?.[0];

      expect(requestEvent.body?.format).toBe("NONE");
      expect(responseEvent.body?.format).toBe("NONE");
    });
  });
});
