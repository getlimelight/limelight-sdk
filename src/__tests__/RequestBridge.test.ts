import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  NetworkPhase,
  NetworkType,
  GraphqlOprtation,
  LimelightMessage,
} from "@/types";
import { RequestBridge } from "@/limelight/bridges/RequestBridge";

describe("RequestBridge", () => {
  let bridge: RequestBridge;
  let sendMessage: ReturnType<typeof vi.fn>;
  let getSessionId: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage = vi.fn();
    getSessionId = vi.fn(() => "session-456");
    bridge = new RequestBridge(sendMessage, getSessionId);
  });

  describe("startRequest", () => {
    it("sends a REQUEST event with correct fields", () => {
      const requestId = bridge.startRequest({
        url: "https://api.example.com/graphql",
        method: "POST",
      });

      expect(requestId).toMatch(/^req-\d+-[a-z0-9]+$/);
      expect(sendMessage).toHaveBeenCalledTimes(1);

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.id).toMatch(/^req-\d+-[a-z0-9]+$/);
      expect(event.sessionId).toBe("session-456");
      expect(event.phase).toBe(NetworkPhase.REQUEST);
      expect(event.networkType).toBe(NetworkType.FETCH);
      expect(event.url).toBe("https://api.example.com/graphql");
      expect(event.method).toBe("POST");
      expect(event.initiator).toBe("manual");
    });

    it("defaults method to POST", () => {
      bridge.startRequest({ url: "https://api.example.com/graphql" });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.method).toBe("POST");
    });

    it("uppercases the method", () => {
      bridge.startRequest({
        url: "https://api.example.com/data",
        method: "get",
      });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.method).toBe("GET");
    });

    it("includes headers when provided", () => {
      bridge.startRequest({
        url: "https://api.example.com/graphql",
        headers: {
          "content-type": "application/json",
          authorization: "[REDACTED]",
        },
      });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.headers).toEqual({
        "content-type": "application/json",
        authorization: "[REDACTED]",
      });
    });

    it("includes graphql data when provided", () => {
      bridge.startRequest({
        url: "https://api.example.com/graphql",
        graphql: {
          operationName: "GetUser",
          operationType: "query",
          variables: { id: "123" },
          query: "query GetUser($id: ID!) { user(id: $id) { name } }",
        },
      });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.graphql).toEqual({
        operationName: "GetUser",
        operationType: GraphqlOprtation.QUERY,
        variables: { id: "123" },
        query: "query GetUser($id: ID!) { user(id: $id) { name } }",
      });
    });

    it("normalizes lowercase operation types to enums", () => {
      bridge.startRequest({
        url: "https://api.example.com/graphql",
        graphql: { operationType: "mutation" },
      });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.graphql.operationType).toBe(GraphqlOprtation.MUTATION);
    });

    it("normalizes subscription operation type", () => {
      bridge.startRequest({
        url: "https://api.example.com/graphql",
        graphql: { operationType: "subscription" },
      });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.graphql.operationType).toBe(GraphqlOprtation.SUB);
    });

    it("uses custom name when provided", () => {
      bridge.startRequest({
        url: "https://api.example.com/graphql",
        name: "MyCustomRequest",
      });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.name).toBe("MyCustomRequest");
    });

    it("auto-constructs body from graphql config when body not provided", () => {
      bridge.startRequest({
        url: "https://api.example.com/graphql",
        graphql: {
          operationName: "GetUser",
          variables: { id: "123" },
          query: "query GetUser($id: ID!) { user(id: $id) { name } }",
        },
      });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.body.raw).toContain("GetUser");
      expect(event.body.raw).toContain('"id":"123"');
    });
  });

  describe("endRequest", () => {
    it("sends a RESPONSE event with correct fields", () => {
      const requestId = bridge.startRequest({
        url: "https://api.example.com/graphql",
      });

      sendMessage.mockClear();

      bridge.endRequest(requestId, {
        status: 200,
        body: { data: { user: { name: "John" } } },
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.id).toBe(requestId);
      expect(event.phase).toBe(NetworkPhase.RESPONSE);
      expect(event.status).toBe(200);
      expect(event.ok).toBe(true);
      expect(event.duration).toBeGreaterThanOrEqual(0);
    });

    it("sets ok to false for error status codes", () => {
      const requestId = bridge.startRequest({
        url: "https://api.example.com/graphql",
      });

      sendMessage.mockClear();

      bridge.endRequest(requestId, { status: 404 });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.ok).toBe(false);
    });

    it("sets ok to true for 2xx status codes", () => {
      const requestId = bridge.startRequest({
        url: "https://api.example.com/graphql",
      });

      sendMessage.mockClear();

      bridge.endRequest(requestId, { status: 201 });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.ok).toBe(true);
    });

    it("includes response headers when provided", () => {
      const requestId = bridge.startRequest({
        url: "https://api.example.com/graphql",
      });

      sendMessage.mockClear();

      bridge.endRequest(requestId, {
        status: 200,
        headers: { "content-type": "application/json" },
      });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.headers).toEqual({ "content-type": "application/json" });
    });

    it("does nothing for unknown requestId", () => {
      sendMessage.mockClear();

      bridge.endRequest("unknown-id", { status: 200 });

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("logs warning for unknown requestId when internal logging enabled", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      bridge.setConfig({ enableInternalLogging: true } as any);
      bridge.endRequest("unknown-id", { status: 200 });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No pending request found"),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("failRequest", () => {
    it("sends an ERROR event with Error object", () => {
      const requestId = bridge.startRequest({
        url: "https://api.example.com/graphql",
      });

      sendMessage.mockClear();

      const error = new Error("Network failed");
      bridge.failRequest(requestId, error);

      expect(sendMessage).toHaveBeenCalledTimes(1);

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.id).toBe(requestId);
      expect(event.phase).toBe(NetworkPhase.ERROR);
      expect(event.errorMessage).toBe("Network failed");
      expect(event.stack).toBeDefined();
    });

    it("sends an ERROR event with string error", () => {
      const requestId = bridge.startRequest({
        url: "https://api.example.com/graphql",
      });

      sendMessage.mockClear();

      bridge.failRequest(requestId, "Something went wrong");

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.errorMessage).toBe("Something went wrong");
      expect(event.stack).toBeUndefined();
    });

    it("does nothing for unknown requestId", () => {
      sendMessage.mockClear();

      bridge.failRequest("unknown-id", new Error("test"));

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("beforeSend hook", () => {
    it("allows modifying request events", () => {
      bridge.setConfig({
        beforeSend: (event: LimelightMessage) => {
          if (event.phase === NetworkPhase.REQUEST) {
            return { ...event, url: "https://modified.com" };
          }
          return event;
        },
      } as any);

      bridge.startRequest({ url: "https://original.com" });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.url).toBe("https://modified.com");
    });

    it("allows filtering out requests by returning null", () => {
      bridge.setConfig({
        beforeSend: () => null,
      } as any);

      bridge.startRequest({ url: "https://api.example.com" });

      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("allows modifying response events", () => {
      bridge.setConfig({
        beforeSend: (event: LimelightMessage) => {
          if (event.phase === NetworkPhase.RESPONSE) {
            return { ...event, status: 999 };
          }
          return event;
        },
      } as any);

      const requestId = bridge.startRequest({ url: "https://api.example.com" });
      sendMessage.mockClear();

      bridge.endRequest(requestId, { status: 200 });

      const event = sendMessage.mock.calls[0]?.[0];
      expect(event.status).toBe(999);
    });
  });

  describe("cleanup", () => {
    it("clears all pending requests", () => {
      bridge.startRequest({ url: "https://api.example.com/1" });
      bridge.startRequest({ url: "https://api.example.com/2" });

      bridge.cleanup();

      sendMessage.mockClear();

      bridge.endRequest("req-123", { status: 200 });

      expect(sendMessage).not.toHaveBeenCalled();
    });
  });
});
