import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NetworkInterceptor } from "@/limelight";
import { parseGraphQL } from "@/helpers";

describe("NetworkInterceptor", () => {
  let interceptor: NetworkInterceptor;

  let originalFetch: typeof fetch;

  let sendMessageSpy: ReturnType<typeof vi.fn>;
  let getSessionIdSpy: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Save original fetch
    originalFetch = global.fetch;

    // Create mock fetch that will be used as the "original" fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch as any;

    sendMessageSpy = vi.fn();
    getSessionIdSpy = vi.fn(() => "test-session-123");

    interceptor = new NetworkInterceptor(sendMessageSpy, getSessionIdSpy);
  });

  afterEach(() => {
    interceptor.cleanup();
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  describe("setup()", () => {
    it("should intercept fetch requests", async () => {
      const mockResponse = new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

      mockFetch.mockResolvedValue(mockResponse);

      interceptor.setup({
        enableNetworkInspector: true,
        enableGraphQL: false,
        projectKey: "project-123",
      });

      await fetch("https://api.example.com/test", {
        method: "POST",
        body: JSON.stringify({ data: "test" }),
      });

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "REQUEST",
          url: "https://api.example.com/test",
          method: "POST",
        }),
      );

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "RESPONSE",
          status: 200,
        }),
      );
    });

    it("should detect GraphQL requests", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ data: {} }), {
          headers: { "content-type": "application/json" },
        }),
      );

      interceptor.setup({
        enableNetworkInspector: true,
        enableGraphQL: true,
        projectKey: "project-123",
      });

      await fetch("https://api.example.com/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "query GetUser { user { id name } }",
        }),
      });

      await vi.waitFor(() => {
        expect(sendMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            graphql: expect.objectContaining({
              query: expect.stringContaining("GetUser"),
            }),
          }),
        );
      });
    });

    it("should handle malformed GraphQL queries", () => {
      const result = parseGraphQL("not valid graphql");
      expect(result).toBeNull(); // or whatever your error handling does
    });

    it("should handle fetch errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      interceptor.setup({
        enableNetworkInspector: true,
        projectKey: "project-123",
      });

      await expect(fetch("https://api.example.com/test")).rejects.toThrow(
        "Network error",
      );

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: "ERROR",
          errorMessage: "Network error",
        }),
      );
    });

    it("should respect beforeSend hook", async () => {
      const beforeSend = vi.fn((event) => {
        if (event.url?.includes("sensitive")) {
          return null; // Block request
        }
        return event;
      });

      mockFetch.mockResolvedValue(new Response("ok"));

      interceptor.setup({
        enableNetworkInspector: true,
        beforeSend,
        projectKey: "project-123",
      });

      await fetch("https://api.example.com/sensitive-data");

      expect(beforeSend).toHaveBeenCalled();
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it("should prevent double setup", () => {
      const consoleSpy = vi.spyOn(console, "warn");

      interceptor.setup({
        enableNetworkInspector: true,
        projectKey: "project-123",
        enabgleInternalLogging: true,
      });

      interceptor.setup({
        enableNetworkInspector: true,
        projectKey: "project-123",
        enabgleInternalLogging: true,
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("already set up"),
      );
    });
  });

  describe("cleanup()", () => {
    it("should restore original fetch", () => {
      const fetchBeforeSetup = global.fetch;

      interceptor.setup({
        enableNetworkInspector: true,
        projectKey: "project-123",
      });
      expect(global.fetch).not.toBe(fetchBeforeSetup);

      interceptor.cleanup();
      expect(global.fetch).toBe(fetchBeforeSetup);
    });
  });

  describe("edge cases", () => {
    it("should handle Request object as input", async () => {
      mockFetch.mockResolvedValue(new Response("ok"));

      interceptor.setup({
        enableNetworkInspector: true,
        projectKey: "project-123",
      });

      const request = new Request("https://api.example.com/test", {
        method: "POST",
        body: JSON.stringify({ data: "test" }),
      });

      await fetch(request);

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://api.example.com/test",
        }),
      );
    });

    it("should handle URL object as input", async () => {
      mockFetch.mockResolvedValue(new Response("ok"));

      interceptor.setup({
        enableNetworkInspector: true,
        projectKey: "project-123",
      });

      await fetch(new URL("https://api.example.com/test"));

      expect(sendMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "https://api.example.com/test",
        }),
      );
    });

    it("should redact sensitive headers", async () => {
      mockFetch.mockResolvedValue(new Response("ok"));

      interceptor.setup({
        enableNetworkInspector: true,
        projectKey: "project-123",
      });

      await fetch("https://api.example.com/test", {
        headers: {
          Authorization: "Bearer secret-token",
          "X-API-Key": "secret-key",
        },
      });

      const requestEvent = sendMessageSpy.mock.calls.find(
        (call) => call[0].phase === "REQUEST",
      )?.[0];

      expect(requestEvent).toBeDefined();
      expect(requestEvent.headers["authorization"]).toBe("[REDACTED]");
      expect(requestEvent.headers["x-api-key"]).toBe("[REDACTED]");
    });
  });
});
