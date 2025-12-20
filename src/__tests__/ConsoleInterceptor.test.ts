// __tests__/ConsoleInterceptor.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ConsoleInterceptor } from "../limelight/interceptors/ConsoleInterceptor";
import { LimelightConfig } from "..";
import { safeStringify } from "../helpers/safety/safeStringify";

describe("ConsoleInterceptor", () => {
  let interceptor: ConsoleInterceptor;
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let getSessionIdSpy: ReturnType<typeof vi.fn>;
  let originalConsole: Console;

  beforeEach(() => {
    originalConsole = { ...console };
    sendMessageSpy = vi.fn();
    getSessionIdSpy = vi.fn(() => "test-session");
    interceptor = new ConsoleInterceptor(sendMessageSpy, getSessionIdSpy);
  });

  afterEach(() => {
    interceptor.cleanup();

    Object.assign(console, originalConsole);
  });

  it("should intercept console.log", () => {
    interceptor.setup({ enableConsole: true });

    console.log("test message", { data: "value" });

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "CONSOLE",
        level: "log",
        args: expect.arrayContaining([expect.stringContaining("test message")]),
      })
    );
  });

  it("should intercept all console methods", () => {
    interceptor.setup({ enableConsole: true });

    console.log("log");
    console.warn("warn");
    console.error("error");
    console.info("info");
    console.debug("debug");

    expect(sendMessageSpy).toHaveBeenCalledTimes(5);
  });

  it("should handle BigInt", () => {
    expect(safeStringify(BigInt(123))).toBe('"123n"');
  });

  it("should handle circular references", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const result = safeStringify(obj);
    expect(result).toContain("[Circular]");
  });

  it("should handle undefined", () => {
    expect(safeStringify(undefined)).toBe('"[undefined]"');
  });

  it("should handle functions", () => {
    const result = safeStringify(() => {});
    expect(result).toMatch(/\[Function/);
  });
  it("should prevent infinite loops from internal logging", async () => {
    const beforeSend = vi.fn((event) => {
      console.log("inside beforeSend");
      return event;
    });

    interceptor.setup({
      enableConsole: true,
      beforeSend,
    });

    console.log("user log");

    expect(sendMessageSpy).toHaveBeenCalledTimes(1);
  });

  it("should capture stack traces", () => {
    const sendMessageSpy = vi.fn();
    const interceptor = new ConsoleInterceptor(
      sendMessageSpy,
      () => "session-id"
    );

    // Call setup with a config object
    interceptor.setup({} as LimelightConfig);

    console.log("test");

    const call = sendMessageSpy?.mock?.calls?.[0]?.[0];
    expect(call).toBeDefined();
    expect(call.stackTrace).toBeDefined();
    expect(typeof call.stackTrace).toBe("string");
    expect(call.stackTrace.length).toBeGreaterThan(0);
    // Verify it looks like a stack trace (has "at" or line numbers)
    expect(call.stackTrace).toMatch(/at\s+|:\d+:\d+/);

    interceptor.cleanup();
  });

  it("should respect beforeSend hook", () => {
    const beforeSend = vi.fn(() => null);

    interceptor.setup({
      enableConsole: true,
      beforeSend,
    });

    console.log("blocked message");

    expect(beforeSend).toHaveBeenCalled();
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("should restore original console on cleanup", () => {
    const original = console.log;

    interceptor.setup({ enableConsole: true });
    expect(console.log).not.toBe(original);

    interceptor.cleanup();
    expect(console.log).toBe(original);
  });
});
