import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import WS from "ws";
import { LimelightClient } from "@/limelight";

global.WebSocket = WS as any;

describe("LimelightClient", () => {
  let client: LimelightClient;
  let mockServer: WS.Server;

  beforeEach(async () => {
    // Reset the singleton if you are using it, or just create a new instance
    client = new LimelightClient();

    await new Promise<void>((resolve, reject) => {
      mockServer = new WS.Server({ port: 8080 });
      mockServer.on("listening", () => resolve());
      mockServer.on("error", (err) => reject(err));
    });
  });

  afterEach(async () => {
    // 1. Clear any pending timers first (essential for fakeTimers)
    vi.clearAllTimers();
    vi.useRealTimers();

    // 2. Use the client's built-in reset to kill WS and internal timers
    client.reset();

    // 3. Force close all client connections on the server
    mockServer.clients.forEach((client) => {
      client.terminate();
    });

    // 4. Close the mock server
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });
  });

  describe("connect()", () => {
    it("should establish WebSocket connection", async () => {
      const connectPromise = new Promise((resolve) => {
        mockServer.on("connection", (socket) => {
          resolve(socket);
        });
      });

      client.connect({
        serverUrl: "ws://localhost:8080",
        appName: "Test App",
        projectKey: "project-123",
      });

      await expect(connectPromise).resolves.toBeDefined();
    });

    it("should prevent duplicate connections", async () => {
      const consoleSpy = vi.spyOn(console, "warn");

      // Wait for first connection to establish
      const firstConnect = new Promise((resolve) => {
        mockServer.once("connection", () => resolve(true));
      });

      client.connect({
        serverUrl: "ws://localhost:8080",
        projectKey: "project-123",
        enableInternalLogging: true, // Add this
      });

      await firstConnect;
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Try to connect again - also needs the flag
      client.connect({
        serverUrl: "ws://localhost:8080",
        projectKey: "project-123",
        enableInternalLogging: true, // Add this
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Already connected"),
      );
    });

    it("should handle connection failures with retry", async () => {
      vi.useFakeTimers();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // 1. Capture the original WebSocket
      const OriginalWS = global.WebSocket;

      // 2. Mock WebSocket to prevent real network calls (ECONNREFUSED)
      global.WebSocket = vi.fn().mockImplementation(() => ({
        readyState: 0, // CONNECTING
        close: vi.fn(),
        send: vi.fn(),
        // These will be assigned by the client
        onopen: null,
        onerror: null,
        onclose: null,
      })) as any;

      // 3. Connect (this now uses our mock)
      client.connect({
        serverUrl: "ws://localhost:8080",
        projectKey: "project-123",
      });

      // 4. Manually trigger the failure on the mock instance
      const wsInstance = (client as any).ws;
      if (wsInstance.onerror)
        wsInstance.onerror(new Error("Simulated Failure"));
      if (wsInstance.onclose) wsInstance.onclose();

      // 5. Advance timers to trigger the attemptReconnect()
      await vi.advanceTimersByTimeAsync(1000);

      expect((client as any).reconnectAttempts).toBeGreaterThan(0);

      // Cleanup
      global.WebSocket = OriginalWS;
      errorSpy.mockRestore();
      vi.useRealTimers();
    });
  });

  describe("message queueing", () => {
    it("should queue messages when disconnected", () => {
      const message = {
        phase: "CONSOLE" as const,
        sessionId: "test-session",
        timestamp: Date.now(),
        data: { test: true },
      };

      // Send without connection
      (client as any).sendMessage(message);

      // Verify message is queued
      expect((client as any).messageQueue).toHaveLength(1);
    });

    it("should flush queue on connection", async () => {
      const messages: any[] = [];

      const messagePromise = new Promise<void>((resolve) => {
        let receivedCount = 0;
        mockServer.on("connection", (socket) => {
          socket.on("message", (data) => {
            messages.push(JSON.parse(data.toString()));
            receivedCount++;
            // Wait for at least 2 queued messages (plus CONNECT message)
            if (receivedCount >= 2) {
              resolve();
            }
          });
        });
      });

      // Queue messages while disconnected
      (client as any).messageQueue.push({
        phase: "CONSOLE",
        sessionId: "test",
        timestamp: Date.now(),
        data: { test: 1 },
      });
      (client as any).messageQueue.push({
        phase: "CONSOLE",
        sessionId: "test",
        timestamp: Date.now(),
        data: { test: 2 },
      });

      // Connect and wait for messages to flush
      client.connect({
        serverUrl: "ws://localhost:8080",
        projectKey: "project-123",
      });

      await messagePromise;

      // Should have at least the 2 queued messages
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    it("should drop oldest message when queue is full", () => {
      const maxSize = (client as any).maxQueueSize;

      // Fill queue beyond max size
      for (let i = 0; i < maxSize + 5; i++) {
        (client as any).sendMessage({
          phase: "CONSOLE",
          sessionId: "test",
          timestamp: Date.now(),
          data: { id: i },
        });
      }

      expect((client as any).messageQueue).toHaveLength(maxSize);
      // First 5 should have been dropped, so first in queue should be id: 5
      expect((client as any).messageQueue[0].data.id).toBe(5);
    });
  });
});
