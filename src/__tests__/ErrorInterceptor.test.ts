import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ErrorInterceptor } from "@/limelight";
import { LimelightConfig } from "@/types";

describe("ErrorInterceptor", () => {
  let interceptor: ErrorInterceptor;
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let getSessionIdSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessageSpy = vi.fn();
    getSessionIdSpy = vi.fn(() => "test-session");
    interceptor = new ErrorInterceptor(sendMessageSpy, getSessionIdSpy);
  });

  afterEach(() => {
    interceptor.cleanup();
  });

  it("should capture unhandledRejection events", () => {
    interceptor.setup({ enableConsole: true } as LimelightConfig);

    const error = new Error("Promise rejected");
    process.emit("unhandledRejection" as any, error, Promise.resolve());

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "CONSOLE",
        level: "error",
        args: expect.arrayContaining([
          expect.stringContaining("unhandledRejection"),
        ]),
      }),
    );
  });

  it("should include stack trace in error events", () => {
    interceptor.setup({ enableConsole: true } as LimelightConfig);

    const error = new Error("Test error with stack");
    process.emit("unhandledRejection" as any, error, Promise.resolve());

    const call = sendMessageSpy.mock.calls?.[0]?.[0];
    expect(call.stackTrace).toBeDefined();
    expect(call.stackTrace).toContain("Test error with stack");
  });

  it("should handle non-Error rejection reasons", () => {
    interceptor.setup({ enableConsole: true } as LimelightConfig);

    process.emit("unhandledRejection" as any, "string rejection", Promise.resolve());

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "CONSOLE",
        level: "error",
        args: expect.arrayContaining([
          expect.stringContaining("string rejection"),
        ]),
      }),
    );
  });

  it("should not set up if already set up", () => {
    interceptor.setup({ enableConsole: true } as LimelightConfig);
    interceptor.setup({ enableConsole: true } as LimelightConfig);

    const error = new Error("Test");
    process.emit("unhandledRejection" as any, error, Promise.resolve());

    // Should only fire once (not doubled from double-setup)
    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("should remove listeners on cleanup", () => {
    interceptor.setup({ enableConsole: true } as LimelightConfig);
    interceptor.cleanup();

    // Add a temporary handler so the emitted rejection doesn't propagate to vitest
    const noop = () => {};
    process.on("unhandledRejection", noop);

    const error = new Error("After cleanup");
    process.emit("unhandledRejection" as any, error, Promise.resolve());

    expect(sendMessageSpy).not.toHaveBeenCalled();

    process.removeListener("unhandledRejection", noop);
  });

  it("should respect beforeSend hook", () => {
    const config: LimelightConfig = {
      enableConsole: true,
      beforeSend: vi.fn(() => null),
    };

    interceptor.setup(config);

    const error = new Error("Filtered error");
    process.emit("unhandledRejection" as any, error, Promise.resolve());

    expect(config.beforeSend).toHaveBeenCalled();
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });
});
