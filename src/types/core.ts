import {
  GraphqlOprtation,
  GraphQLRequest,
  GraphQLResponse,
  ConsoleEvent,
} from "./index";

// ============================================================================
// ENUMS
// ============================================================================

export enum NetworkType {
  FETCH = "fetch",
  XHR = "xhr",
  GRAPHQL = "graphql",
}

export enum NetworkPhase {
  CONNECT = "CONNECT",
  REQUEST = "REQUEST",
  RESPONSE = "RESPONSE",
  ERROR = "ERROR",
  ABORT = "ABORT",
}

export enum BodyFormat {
  TEXT = "TEXT",
  JSON = "JSON",
  FORM_DATA = "FORM_DATA",
  BLOB = "BLOB",
  ARRAY_BUFFER = "ARRAY_BUFFER",
  NONE = "NONE",
  UNSERIALIZABLE = "UNSERIALIZABLE",
}

export enum HttpMethod {
  GET = "GET",
  POST = "POST",
  PUT = "PUT",
  PATCH = "PATCH",
  DELETE = "DELETE",
  HEAD = "HEAD",
  OPTIONS = "OPTIONS",
  TRACE = "TRACE",
  CONNECT = "CONNECT",
}

export enum HttpStatusClass {
  INFORMATIONAL = 100,
  SUCCESS = 200,
  REDIRECTION = 300,
  CLIENT_ERROR = 400,
  SERVER_ERROR = 500,
}

// ============================================================================
// BODY SERIALIZATION
// ============================================================================

/**
 * Normalized serialized body format
 */
export interface SerializedBody {
  format: BodyFormat;
  size: number; // bytes (approx)
  preview: string; // truncated view ("{...}", "[FormData]", "[Blob]")
  raw?: string; // optional full string version when feasible
}

// ============================================================================
// NETWORK EVENTS (sent by SDK)
// ============================================================================

/**
 * Base shape all network events share
 */
export interface BaseNetworkEvent {
  id: string; // request ID linking request/response/error
  sessionId: string;
  timestamp: number; // unix ms
  phase: NetworkPhase;
  networkType: NetworkType;
  graphql?: {
    operationName?: string;
    operationType?: GraphqlOprtation | null;
    variables?: any;
    query?: string;
  };
}

/**
 * The REQUEST event your RN client sends first
 */
export interface NetworkRequest extends BaseNetworkEvent {
  phase: NetworkPhase.REQUEST;
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: SerializedBody;
  name: string; // short friendly name ("/posts", "countries")
  initiator: string; // "fetch()", "graphql()", "axios", etc
  requestSize: number; // estimated byte size of outbound payload
}

/**
 * The RESPONSE event (2nd step)
 */
export interface NetworkResponse extends BaseNetworkEvent {
  phase: NetworkPhase.RESPONSE;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: SerializedBody;
  duration: number; // ms
  responseSize: number; // bytes
  redirected: boolean;
  ok: boolean;
}

/**
 * NETWORK ERROR (3rd possible outcome)
 */
export interface NetworkErrorEvent extends BaseNetworkEvent {
  phase: NetworkPhase.ERROR | NetworkPhase.ABORT;
  errorMessage: string;
  stack?: string;
}

/**
 * CONNECT event (session start)
 */
export interface ConnectEvent {
  phase: NetworkPhase.CONNECT;
  sessionId: string;
  timestamp: number;
  data: {
    appName: string;
    platform: "ios" | "android";
  };
}

// ============================================================================
// WEB UI HELPER TYPES
// ============================================================================

/**
 * Request with its corresponding response (for UI display)
 */
export interface NetworkRequestWithResponse extends NetworkRequest {
  response?: NetworkResponse;
  status?: number;
  duration?: number;
  error?: NetworkErrorEvent;
}

export enum EventType {
  NETWORK = "NETWORK",
  CONSOLE = "CONSOLE",
}

// ============================================================================
// UNION TYPES
// ============================================================================
/**
 * All possible events that can be sent over WebSocket
 */
export type NetworkEvent =
  | ConnectEvent
  | NetworkRequest
  | NetworkResponse
  | NetworkErrorEvent
  | GraphQLRequest
  | GraphQLResponse;

export type LimelightEvent = NetworkEvent | ConsoleEvent;

// ============================================================================
// SESSION
// ============================================================================
export interface Session {
  id: string;
  appName: string;
  platform: "ios" | "android";
  connectedAt: number;
}

// ============================================================================
// WEB UI HELPER TYPES
// ============================================================================
/**
 * Request with its corresponding response (for UI display)
 */
export interface NetworkRequestWithResponse extends NetworkRequest {
  response?: NetworkResponse;
  status?: number;
  duration?: number;
}
