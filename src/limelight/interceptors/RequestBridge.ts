import {
  LimelightConfig,
  LimelightMessage,
  NetworkPhase,
  NetworkType,
  NetworkRequest,
  NetworkResponse,
  NetworkErrorEvent,
  HttpMethod,
} from "@/types";
import {
  serializeBody,
  redactSensitiveHeaders,
  formatRequestName,
  normalizeOperationType,
} from "@/helpers";
import { generateRequestId } from "@/protocol";
import {
  RequestBridgeConfig,
  ResponseBridgeConfig,
} from "@/types/request-bridge";

interface PendingRequest {
  startTime: number;
  config: RequestBridgeConfig;
}

export class RequestBridge {
  private pendingRequests = new Map<string, PendingRequest>();
  private config: LimelightConfig | null = null;

  constructor(
    private sendMessage: (message: LimelightMessage) => void,
    private getSessionId: () => string,
  ) {
    // No-op
  }

  /**
   * Updates the config reference (called when LimelightClient configures)
   * @param config The new Limelight configuration or null to disable
   */
  setConfig(config: LimelightConfig | null) {
    this.config = config;
  }

  /**
   * Starts tracking a manual request. Returns a requestId to use with endRequest/failRequest.
   * @param config The request configuration
   * @returns The generated request ID
   */
  startRequest(config: RequestBridgeConfig): string {
    const requestId = generateRequestId();
    const startTime = Date.now();

    this.pendingRequests.set(requestId, { startTime, config });

    let bodyToSerialize = config.body;

    if (config.graphql && !config.body) {
      bodyToSerialize = JSON.stringify({
        operationName: config.graphql.operationName,
        variables: config.graphql.variables,
        query: config.graphql.query,
      });
    }

    const method = (config.method?.toUpperCase() || "POST") as HttpMethod;
    const headers = config.headers || {};

    const requestBody = serializeBody(
      typeof bodyToSerialize === "string"
        ? bodyToSerialize
        : JSON.stringify(bodyToSerialize),
      this.config?.disableBodyCapture,
    );

    let requestEvent: NetworkRequest = {
      id: requestId,
      sessionId: this.getSessionId(),
      timestamp: startTime,
      phase: NetworkPhase.REQUEST,
      networkType: NetworkType.FETCH,
      url: config.url,
      method,
      headers: redactSensitiveHeaders(headers),
      body: requestBody,
      name: config.name || formatRequestName(config.url),
      initiator: "manual",
      requestSize: requestBody?.size ?? 0,
      graphql: config.graphql
        ? {
            operationName: config.graphql.operationName,
            operationType: normalizeOperationType(config.graphql.operationType),
            variables: config.graphql.variables,
            query: config.graphql.query,
          }
        : undefined,
    };

    if (this.config?.beforeSend) {
      const modifiedEvent = this.config.beforeSend(requestEvent);

      if (!modifiedEvent) {
        this.pendingRequests.delete(requestId);
        return requestId;
      }

      if (modifiedEvent.phase !== NetworkPhase.REQUEST) {
        console.error("[Limelight] beforeSend must return same event type");
        return requestId;
      }

      requestEvent = modifiedEvent as NetworkRequest;
    }

    this.sendMessage(requestEvent);

    return requestId;
  }

  /**
   * Completes a tracked request with a successful response.
   * @param requestId The ID returned from startRequest
   * @param response The response data
   */
  endRequest(requestId: string, response: ResponseBridgeConfig): void {
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      if (this.config?.enableInternalLogging) {
        console.warn(
          `[Limelight] No pending request found for id: ${requestId}`,
        );
      }
      return;
    }

    this.pendingRequests.delete(requestId);

    const endTime = Date.now();
    const duration = endTime - pending.startTime;

    const responseHeaders = response.headers || {};
    const responseBody = serializeBody(
      typeof response.body === "string"
        ? response.body
        : JSON.stringify(response.body),
      this.config?.disableBodyCapture,
    );

    let responseEvent: NetworkResponse = {
      id: requestId,
      sessionId: this.getSessionId(),
      timestamp: endTime,
      phase: NetworkPhase.RESPONSE,
      networkType: NetworkType.FETCH,
      status: response.status,
      statusText: response.statusText || "",
      headers: redactSensitiveHeaders(responseHeaders),
      body: responseBody,
      duration,
      responseSize: responseBody?.size ?? 0,
      redirected: false,
      ok: response.status >= 200 && response.status < 300,
    };

    if (this.config?.beforeSend) {
      const modifiedEvent = this.config.beforeSend(responseEvent);

      if (!modifiedEvent) {
        return;
      }

      if (modifiedEvent.phase !== NetworkPhase.RESPONSE) {
        console.error("[Limelight] beforeSend must return same event type");
        return;
      }

      responseEvent = modifiedEvent as NetworkResponse;
    }

    this.sendMessage(responseEvent);
  }

  /**
   * Completes a tracked request with an error.
   * @param requestId The ID returned from startRequest
   * @param error The error object or message
   */
  failRequest(requestId: string, error: Error | string): void {
    const pending = this.pendingRequests.get(requestId);

    if (!pending) {
      if (this.config?.enableInternalLogging) {
        console.warn(
          `[Limelight] No pending request found for id: ${requestId}`,
        );
      }
      return;
    }

    this.pendingRequests.delete(requestId);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    let errorEvent: NetworkErrorEvent = {
      id: requestId,
      sessionId: this.getSessionId(),
      timestamp: Date.now(),
      phase: NetworkPhase.ERROR,
      networkType: NetworkType.FETCH,
      errorMessage,
      stack: errorStack,
    };

    if (this.config?.beforeSend) {
      const modifiedEvent = this.config.beforeSend(errorEvent);

      if (modifiedEvent && modifiedEvent.phase === NetworkPhase.ERROR) {
        errorEvent = modifiedEvent as NetworkErrorEvent;
      }
    }

    this.sendMessage(errorEvent);
  }

  /**
   * Cleans up any pending requests (called on disconnect)
   */
  cleanup() {
    this.pendingRequests.clear();
  }
}
