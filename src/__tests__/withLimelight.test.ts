import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "events";
import { LimelightConfig } from "@/types";

vi.mock("@/limelight/context", () => ({
  getTraceContext: vi.fn(),
}));

vi.mock("./httpMiddleware", () => ({
  captureRequest: vi.fn(),
}));

vi.mock("@/limelight/middleware/httpMiddleware", () => ({
  captureRequest: vi.fn(),
}));

import { createWithLimelight } from "@/limelight/middleware/withLimelight";
import { captureRequest } from "@/limelight/middleware/httpMiddleware";
import { getTraceContext } from "@/limelight/context";

const mockedCaptureRequest = vi.mocked(captureRequest);
const mockedGetTraceContext = vi.mocked(getTraceContext);

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
  res.write = vi.fn(() => true);
  res.end = vi.fn(() => {
    res.emit("finish");
    return res;
  });
  return res;
};

describe("createWithLimelight", () => {
  let sendMessage: ReturnType<typeof vi.fn>;
  let getSessionId: ReturnType<typeof vi.fn>;
  let getConfig: ReturnType<typeof vi.fn>;
  let config: LimelightConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage = vi.fn();
    getSessionId = vi.fn(() => "test-session");
    config = {
      enabled: true,
      enableNetworkInspector: true,
      enableConsole: true,
    };
    getConfig = vi.fn(() => config);
    mockedGetTraceContext.mockReturnValue(undefined);
  });

  it("should return a function that wraps a handler", () => {
    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    expect(typeof withLimelight).toBe("function");

    const handler = vi.fn();
    const wrapped = withLimelight(handler);

    expect(typeof wrapped).toBe("function");
  });

  it("should call captureRequest with correct arguments", () => {
    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    const handler = vi.fn();
    const wrapped = withLimelight(handler);

    const req = createMockReq();
    const res = createMockRes();

    wrapped(req, res);

    expect(mockedCaptureRequest).toHaveBeenCalledWith(
      req,
      res,
      sendMessage,
      getSessionId,
      config,
      undefined,
    );
  });

  it("should pass middleware options to captureRequest", () => {
    const options = { maxBodySize: 1024 };
    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
      options,
    );

    const handler = vi.fn();
    const wrapped = withLimelight(handler);

    const req = createMockReq();
    const res = createMockRes();

    wrapped(req, res);

    expect(mockedCaptureRequest).toHaveBeenCalledWith(
      req,
      res,
      sendMessage,
      getSessionId,
      config,
      options,
    );
  });

  it("should call the original handler with req and res", () => {
    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    const handler = vi.fn();
    const wrapped = withLimelight(handler);

    const req = createMockReq();
    const res = createMockRes();

    wrapped(req, res);

    expect(handler).toHaveBeenCalledWith(req, res);
  });

  it("should call handler directly when no trace context is available", () => {
    mockedGetTraceContext.mockReturnValue(undefined);

    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    const handler = vi.fn();
    const wrapped = withLimelight(handler);

    const req = createMockReq();
    const res = createMockRes();

    wrapped(req, res);

    expect(handler).toHaveBeenCalledWith(req, res);
  });

  it("should run handler inside trace context when traceId is available", () => {
    const mockRun = vi.fn((_store, callback) => callback());
    mockedGetTraceContext.mockReturnValue({
      getStore: vi.fn(),
      run: mockRun,
    });

    // captureRequest sets limelightTraceId on the request
    mockedCaptureRequest.mockImplementation((req) => {
      (req as any).limelightTraceId = "trace-123";
    });

    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    const handler = vi.fn();
    const wrapped = withLimelight(handler);

    const req = createMockReq();
    const res = createMockRes();

    wrapped(req, res);

    expect(mockRun).toHaveBeenCalledWith(
      { traceId: "trace-123" },
      expect.any(Function),
    );
    expect(handler).toHaveBeenCalledWith(req, res);
  });

  it("should call handler directly when trace context exists but no traceId", () => {
    const mockRun = vi.fn();
    mockedGetTraceContext.mockReturnValue({
      getStore: vi.fn(),
      run: mockRun,
    });

    // captureRequest does NOT set limelightTraceId
    mockedCaptureRequest.mockImplementation(() => {});

    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    const handler = vi.fn();
    const wrapped = withLimelight(handler);

    const req = createMockReq();
    const res = createMockRes();

    wrapped(req, res);

    expect(mockRun).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(req, res);
  });

  it("should propagate sync handler side effects", () => {
    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    const handler = vi.fn((_req: any, res: any) => {
      res.end("done");
    });
    const wrapped = withLimelight(handler);

    const req = createMockReq();
    const res = createMockRes();

    wrapped(req, res);

    expect(res.end).toHaveBeenCalledWith("done");
  });

  it("should handle async handlers", async () => {
    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    const handler = vi.fn(async (_req: any, res: any) => {
      res.end("async-done");
    });
    const wrapped = withLimelight(handler);

    const req = createMockReq();
    const res = createMockRes();

    await wrapped(req, res);

    expect(res.end).toHaveBeenCalledWith("async-done");
  });

  it("should handle async handlers via trace context run", async () => {
    const mockRun = vi.fn((_store, callback) => callback());
    mockedGetTraceContext.mockReturnValue({
      getStore: vi.fn(),
      run: mockRun,
    });

    mockedCaptureRequest.mockImplementation((req) => {
      (req as any).limelightTraceId = "trace-456";
    });

    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    const handler = vi.fn(async (_req: any, res: any) => {
      res.end("traced-done");
    });
    const wrapped = withLimelight(handler);

    const req = createMockReq();
    const res = createMockRes();

    await wrapped(req, res);

    expect(mockRun).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalledWith("traced-done");
  });

  it("should evaluate getConfig on each request", () => {
    const withLimelight = createWithLimelight(
      sendMessage,
      getSessionId,
      getConfig,
    );

    const handler = vi.fn();
    const wrapped = withLimelight(handler);

    wrapped(createMockReq(), createMockRes());
    wrapped(createMockReq(), createMockRes());

    expect(getConfig).toHaveBeenCalledTimes(2);
  });
});
