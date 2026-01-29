// __tests__/XHRInterceptor.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { XHRInterceptor } from "@/limelight";

describe("XHRInterceptor", () => {
  let interceptor: XHRInterceptor;
  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let getSessionIdSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMessageSpy = vi.fn();
    getSessionIdSpy = vi.fn(() => "test-session");
    interceptor = new XHRInterceptor(sendMessageSpy, getSessionIdSpy);
  });

  afterEach(() => {
    interceptor.cleanup();
  });

  it("should intercept XHR requests", async () => {
    interceptor.setup({
      enableNetworkInspector: true,
      projectKey: "project-123",
    });

    const xhr = new XMLHttpRequest();

    const requestComplete = new Promise<void>((resolve, reject) => {
      xhr.addEventListener("load", () => resolve());
      xhr.addEventListener("error", () => reject(new Error("XHR failed")));
    });

    xhr.open("GET", "https://jsonplaceholder.typicode.com/todos/1");
    xhr.send();

    await requestComplete;

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "REQUEST",
        method: "GET",
      }),
    );

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "RESPONSE",
        status: 200,
      }),
    );
  });

  it("should capture request headers", () => {
    interceptor.setup({
      enableNetworkInspector: true,
      projectKey: "project-123",
    });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.example.com/test");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("X-Custom-Header", "test-value");

    // Don't actually send, just verify headers were captured
    expect((xhr as any)._limelightData.headers).toEqual({
      "Content-Type": "application/json",
      "X-Custom-Header": "test-value",
    });
  });

  it("should handle XHR errors", async () => {
    interceptor.setup({
      enableNetworkInspector: true,
      projectKey: "project-123",
    });

    const xhr = new XMLHttpRequest();

    const errorPromise = new Promise<void>((resolve) => {
      xhr.addEventListener("error", () => resolve());
    });

    xhr.open("GET", "https://invalid-domain-that-does-not-exist.com");
    xhr.send();

    await errorPromise;

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "ERROR",
        errorMessage: "Network request failed",
      }),
    );
  });

  it("should handle XHR abort", async () => {
    interceptor.setup({
      enableNetworkInspector: true,
      projectKey: "project-123",
    });

    const xhr = new XMLHttpRequest();

    const abortPromise = new Promise<void>((resolve) => {
      xhr.addEventListener("abort", () => resolve());
    });

    xhr.open("GET", "https://jsonplaceholder.typicode.com/todos/1");
    xhr.send();
    xhr.abort();

    await abortPromise;

    expect(sendMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "ABORT",
        errorMessage: "Request aborted",
      }),
    );
  });

  it("should clean up event listeners after request completes", async () => {
    interceptor.setup({
      enableNetworkInspector: true,
      projectKey: "project-123",
    });

    const xhr = new XMLHttpRequest();

    const loadPromise = new Promise<void>((resolve) => {
      xhr.addEventListener("load", () => resolve());
    });

    xhr.open("GET", "https://jsonplaceholder.typicode.com/todos/1");
    xhr.send();

    await loadPromise;

    // Wait a tick for cleanup
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect((xhr as any)._limelightData).toBeUndefined();
  });
});
