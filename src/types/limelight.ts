import {
  ConsoleEvent,
  NetworkErrorEvent,
  NetworkRequest,
  NetworkResponse,
} from "./index";
import { RenderBatch, TransactionEvent } from "./render";

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
  projectKey: string;
  /**
   * The platform of the application (e.g., "ios", "android").
   */
  platform?: string;
  /**
   * The URL of the Limelight server to connect to.
   */
  serverUrl?: string;
  /**
   * The name of the application being monitored.
   */
  appName?: string;
  /**
   * Flag to enable or disable the Limelight SDK.
   */
  enabled?: boolean;
  /**
   * Flag to enable or disable network request inspection.
   */
  enableNetworkInspector?: boolean;
  /**
   * Flag to enable or disable console event capturing.
   */
  enableConsole?: boolean;
  /**
   * Flag to enable or disable GraphQL request capturing.
   */
  enableGraphQL?: boolean;
  /**
   * Flag to disable capturing of request and response bodies.
   */
  disableBodyCapture?: boolean;
  /**
   * Flag to enable or disable render inspection.
   */
  enableRenderInspector?: boolean;
  /**
   * A callback function to modify or filter events before they are sent to the server.
   */
  beforeSend?: (event: LimelightMessage) => LimelightMessage | null;
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
  | RenderBatch
  | TransactionEvent;
