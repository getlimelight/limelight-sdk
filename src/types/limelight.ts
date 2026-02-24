import { CommandAckEvent } from "./commands";
import {
  ConsoleEvent,
  NetworkErrorEvent,
  NetworkRequest,
  NetworkResponse,
} from "./index";
import { RenderSnapshot, TransactionEvent } from "./render";
import { StateInitEvent, StateUpdateEvent } from "./state";

/**
 * Configuration options for Limelight SDK.
 *
 * @example
 * ```ts
 * import { LimelightConfig } from "@limelight-sdk/sdk";
 *
 * const config: LimelightConfig = {
 * appName: "MyReactNativeApp",
 * enabled: true,
 * enableNetworkInspector: true,
 * enableConsole: true,
 * enableGraphQL: false,
 * disableBodyCapture: false,
 * beforeSend: (event) => {
 *  // Modify event or return null to drop the event
 *  return event;
 * },
 * serverUrl: "ws://localhost:8080/limelight",
 * };
 * ```
 */
export interface LimelightConfig {
  /**
   * The unique project key for authenticating with the Limelight server.
   */
  projectKey?: string;
  /**
   * The platform of the application. Auto-detected if not provided.
   */
  platform?:
    | "ios"
    | "android"
    | "web"
    | "react-native"
    | "node"
    | (string & {});
  /**
   * The URL of the Limelight server to connect to. If not provided, it falls back to the local wss server url if there is no project key, or the web wss url if there is a project key.
   */
  serverUrl?: string;
  /**
   * The name of the application being monitored.
   */
  appName?: string;
  /**
   * Flag to enable or disable the Limelight SDK.
   * @default true (SDK is enabled by default)
   */
  enabled?: boolean;
  /**
   * Flag to enable or disable network request inspection.
   * @default true
   */
  enableNetworkInspector?: boolean;
  /**
   * Flag to enable or disable console event capturing.
   * @default true
   */
  enableConsole?: boolean;
  /**
   * Flag to enable or disable GraphQL request capturing.
   * @default true
   */
  enableGraphQL?: boolean;
  /**
   * Flag to disable capturing of request and response bodies.
   * @default false (bodies are captured by default)
   */
  disableBodyCapture?: boolean;
  /**
   * Flag to enable or disable render inspection.
   * @default true
   */
  enableRenderInspector?: boolean;
  /**
   * Zustand store hooks or Redux stores, keyed by display name
   * @example { user: useUserStore, cart: useCartStore }
   */
  stores?: Record<string, unknown>;
  /**
   * Flag to enable or disable state inspection
   * @default true (if stores are provided)
   */
  enableStateInspector?: boolean;
  /**
   * Flag to enable or disable internal logging for the Limelight SDK
   * @default false
   */
  enableInternalLogging?: boolean;
  /**
   * Target destination for events. Set to "mcp" to send events to the MCP server at ws://localhost:9229.
   */
  target?: "mcp";
  /**
   * Custom header name used for trace ID propagation across client and server.
   * @default 'x-limelight-trace-id'
   */
  traceHeaderName?: string;
  /**
   * A callback function to modify or filter events before they are sent to the server
   */
  beforeSend?: (event: LimelightMessage) => LimelightMessage | null;
  /**
   * Custom WebSocket implementation for Node.js environments where WebSocket
   * is not globally available (Node < 22). Pass the `ws` package constructor.
   * @example
   * import WebSocket from 'ws';
   * Limelight.connect({ webSocketImpl: WebSocket });
   */
  webSocketImpl?: new (url: string, protocols?: string | string[]) => WebSocket;
  /**
   * Enable anonymous usage telemetry. Only sends event counts, durations,
   * and framework type — never any runtime data, user code, or request content.
   * @default true
   */
  telemetry?: boolean;
}

/**
 * Represents a connection or disconnection event in the Limelight SDK.
 */
export interface ConnectionEvent {
  phase: "CONNECT" | "DISCONNECT";
  sessionId: string;
  timestamp: number;
  data: {
    appName?: string;
    platform?: string;
    reason?: string; // for disconnect
    projectKey: string;
    sdkVersion: string;
  };
}

/**
 * Union type representing all possible Limelight messages.
 */
export type LimelightMessage =
  | NetworkRequest
  | NetworkResponse
  | NetworkErrorEvent
  | ConsoleEvent
  | ConnectionEvent
  | RenderSnapshot
  | TransactionEvent
  | StateInitEvent
  | StateUpdateEvent
  | CommandAckEvent;
