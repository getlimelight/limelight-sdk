import { NetworkInterceptor } from "./interceptors/NetworkInterceptor";
import { XHRInterceptor } from "./interceptors/XHRInterceptor";
import { ConsoleInterceptor } from "./interceptors/ConsoleInterceptor";
import { LimelightConfig, LimelightMessage } from "../types";
import { safeStringify } from "../helpers/safety/safeStringify";
import { isDevelopment } from "../helpers/utils/isDevelopment";
import { DEFAULT_PORT, WS_PATH } from "../constants";
import { createSessionId } from "../protocol";

class LimelightClient {
  private ws: WebSocket | null = null;
  private config: LimelightConfig | null = null;
  private sessionId: string = "";

  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private messageQueue: LimelightMessage[] = [];
  private maxQueueSize = 100;

  private networkInterceptor: NetworkInterceptor;
  private xhrInterceptor: XHRInterceptor;
  private consoleInterceptor: ConsoleInterceptor;

  constructor() {
    this.networkInterceptor = new NetworkInterceptor(
      this.sendMessage.bind(this),
      () => this.sessionId
    );
    this.xhrInterceptor = new XHRInterceptor(
      this.sendMessage.bind(this),
      () => this.sessionId
    );
    this.consoleInterceptor = new ConsoleInterceptor(
      this.sendMessage.bind(this),
      () => this.sessionId
    );
  }

  /**
   * Configures the Limelight client with the provided settings.
   * Sets up network, XHR, and console interceptors based on the configuration.
   * @internal
   * @private
   * @param {LimelightConfig} config - Configuration object for Limelight
   * @returns {void}
   */
  private configure(config: LimelightConfig) {
    const isEnabled = config.enabled ?? isDevelopment();

    this.config = {
      appName: "Limelight App",
      serverUrl: `ws://localhost:${DEFAULT_PORT}${WS_PATH}`,
      enabled: isEnabled,
      enableNetworkInspector: true,
      enableConsole: true,
      enableGraphQL: true,
      ...config,
    };

    if (!this.config.enabled) {
      return;
    }

    this.sessionId = createSessionId();

    try {
      if (this.config.enableNetworkInspector) {
        this.networkInterceptor.setup(this.config);
        this.xhrInterceptor.setup(this.config);
      }

      if (this.config.enableConsole) {
        this.consoleInterceptor.setup(this.config);
      }
    } catch (error) {
      console.error("[Limelight] Failed to setup interceptors:", error);
    }
  }

  /**
   * Establishes a WebSocket connection to the Limelight server.
   * If a config object is provided, it will configure the client before connecting.
   *
   * If no config is provided and the client hasn't been configured, it will use default settings.
   *
   * Prevents multiple simultaneous connections and handles reconnection logic.
   *
   * @param {LimelightConfig} [config] - Optional configuration object.
   * @returns {void}
   */
  connect(config?: LimelightConfig) {
    if (config) {
      this.configure(config);
    } else if (!this.config) {
      this.configure({});
    }

    if (!this.config?.enabled) {
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn("[Limelight] Already connected. Call disconnect() first.");
      return;
    }

    if (this.ws) {
      const oldWs = this.ws;

      oldWs.onclose = null;
      oldWs.onerror = null;
      oldWs.onopen = null;

      // 1 is OPEN
      if (oldWs.readyState === 1) {
        oldWs.close();
      }

      this.ws = null;
    }
    const { serverUrl, appName, platform } = this.config;

    if (!serverUrl) {
      console.error("[Limelight] serverUrl missing in configuration.");
      return;
    }

    try {
      this.ws = new WebSocket(serverUrl);

      const message: LimelightMessage = {
        phase: "CONNECT",
        sessionId: this.sessionId,
        timestamp: Date.now(),
        data: {
          appName: appName,
          platform: platform || "react-native",
        },
      };

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.flushMessageQueue();
        this.sendMessage(message);
      };

      this.ws.onerror = (error) => {
        console.error("[Limelight] WebSocket error:", error);
      };

      this.ws.onclose = () => {
        this.attemptReconnect();
      };
    } catch (error) {
      console.error("[Limelight] Failed to connect:", error);
      this.attemptReconnect();
    }
  }

  /**
   * Attempts to reconnect to the Limelight server using exponential backoff.
   * Will retry up to maxReconnectAttempts times with increasing delays.
   * Maximum delay is capped at 30 seconds.
   * @private
   * @returns {void}
   */
  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Sends all queued messages to the server.
   * Only executes if the WebSocket connection is open.
   * @private
   * @returns {void}
   */
  private flushMessageQueue() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      try {
        this.ws.send(safeStringify(message));
      } catch (error) {
        console.error("[Limelight] Failed to send queued message:", error);
      }
    }
  }

  /**
   * Sends a message to the Limelight server or queues it if not connected.
   * Messages are automatically queued when the connection is not open.
   * If the queue is full, the oldest message will be dropped.
   * @private
   * @param {LimelightMessage} message - The message to send
   * @returns {void}
   */
  private sendMessage(message: LimelightMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.flushMessageQueue();

      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(safeStringify(message));
        } catch (error) {
          console.error("[Limelight] Failed to send message:", error);
          this.messageQueue.push(message);
        }
      } else {
        this.messageQueue.push(message);
      }
    } else {
      if (this.messageQueue.length >= this.maxQueueSize) {
        console.warn("[Limelight] Message queue full, dropping oldest message");
        this.messageQueue.shift();
      }
      this.messageQueue.push(message);
    }
  }

  /**
   * Disconnects from the Limelight server and cleans up resources.
   * Closes the WebSocket connection, removes all interceptors, and resets connection state.
   * Preserves configuration and session ID for potential reconnection.
   * @returns {void}
   */
  disconnect() {
    if (this.ws) {
      // 1. Detach all listeners first so no logic runs after this
      this.ws.onopen = null;
      this.ws.onerror = null;
      this.ws.onclose = null;

      try {
        // 2. Only attempt to close if it's not already closed/closing
        if (this.ws.readyState === 0 || this.ws.readyState === 1) {
          // We use terminate if available (Node ws), otherwise close (Browser)
          if (
            "terminate" in this.ws &&
            typeof (this.ws as any).terminate === "function"
          ) {
            // For Node ws: check if socket exists before terminating
            // This prevents "closed before established" errors
            if ((this.ws as any)._socket) {
              (this.ws as any).terminate();
            } else {
              // If socket doesn't exist yet, just set readyState to CLOSED
              // to prevent the connection from completing
              (this.ws as any).readyState = 3; // CLOSED
            }
          } else {
            this.ws.close();
          }
        }
      } catch (e) {
        // Silently ignore WebSocket closure errors during cleanup
      }

      this.ws = null;
    }

    // Clear timers and interceptors...
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.networkInterceptor.cleanup();
    this.xhrInterceptor.cleanup();
    this.consoleInterceptor.cleanup();

    this.reconnectAttempts = 0;
    this.messageQueue = [];
  }

  /**
   * Performs a complete reset of the Limelight client.
   * Disconnects from the server and clears all configuration and session data.
   * After calling reset(), connect() must be called again.
   * @returns {void}
   */
  reset() {
    this.disconnect();
    this.config = null;
    this.sessionId = "";
  }
}

export const Limelight = new LimelightClient();
export { LimelightClient };
