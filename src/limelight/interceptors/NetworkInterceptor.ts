import {
  HttpMethod,
  LimelightConfig,
  LimelightMessage,
  NetworkErrorEvent,
  NetworkPhase,
  NetworkRequest,
  NetworkType,
} from "@/types";
import {
  formatRequestName,
  getInitiator,
  isGraphQLRequest,
  parseGraphQL,
  redactSensitiveHeaders,
  serializeBody,
} from "@/helpers";
import { generateRequestId } from "@/protocol";

export class NetworkInterceptor {
  private originalFetch: typeof fetch;
  private config: LimelightConfig | null = null;
  private isSetup = false;

  constructor(
    private sendMessage: (message: LimelightMessage) => void,
    private getSessionId: () => string
  ) {
    this.originalFetch = global.fetch;
  }

  /**
   * Sets up fetch interception by wrapping the global fetch function.
   * Intercepts all fetch requests to capture network events.
   * Prevents double setup to avoid losing original fetch reference.
   * @param {LimelightConfig} config - Configuration object for Limelight
   * @returns {void}
   */
  setup(config: LimelightConfig) {
    if (this.isSetup) {
      console.warn("[Limelight] Network interceptor already set up");
      return;
    }
    this.isSetup = true;

    this.config = config;
    const self = this;

    global.fetch = async function (
      input: string | Request | URL,
      init: RequestInit = {}
    ): Promise<Response> {
      const requestId = generateRequestId();
      const startTime = Date.now();

      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : input.url;

      const method = (init.method || "GET") as HttpMethod;

      const modifiedInit = { ...init };

      const headers: Record<string, string> = {};

      if (modifiedInit.headers instanceof Headers) {
        modifiedInit.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
      } else if (modifiedInit.headers) {
        Object.entries(modifiedInit.headers).forEach(([key, value]) => {
          headers[key.toLowerCase()] = value;
        });
      }

      headers["x-limelight-intercepted"] = "fetch";

      modifiedInit.headers = new Headers(headers);

      let requestBodyToSerialize = init.body;

      if (input instanceof Request && !requestBodyToSerialize) {
        try {
          const clonedRequest = input.clone();
          const contentType = clonedRequest.headers.get("content-type") || "";

          if (
            contentType.includes("application/json") ||
            contentType.includes("text/")
          ) {
            requestBodyToSerialize = await clonedRequest.text();
          } else {
            requestBodyToSerialize = await clonedRequest.blob();
          }
        } catch {
          requestBodyToSerialize = undefined;
          console.warn(
            "[Limelight] Failed to read request body from Request object"
          );
        }
      }

      const requestBody = serializeBody(
        requestBodyToSerialize,
        self.config?.disableBodyCapture
      );

      let graphqlData: NetworkRequest["graphql"] = undefined;

      if (self.config?.enableGraphQL && isGraphQLRequest(url, requestBody)) {
        // Pass the raw string to the parser, not the serialized object
        const rawBody = requestBody?.raw;
        if (rawBody) {
          graphqlData = parseGraphQL(rawBody) ?? undefined;
        }
      }

      let requestEvent: LimelightMessage = {
        id: requestId,
        sessionId: self.getSessionId(),
        timestamp: startTime,
        phase: NetworkPhase.REQUEST,
        networkType: NetworkType.FETCH,
        url,
        method: method,
        headers: redactSensitiveHeaders(headers),
        body: requestBody,
        name: formatRequestName(url),
        initiator: getInitiator(),
        requestSize: requestBody?.size ?? 0,
        graphql: graphqlData,
      };

      if (self.config?.beforeSend) {
        const modifiedEvent = self.config.beforeSend(requestEvent);

        if (!modifiedEvent) {
          return self.originalFetch(input, modifiedInit);
        }

        if (modifiedEvent.phase !== NetworkPhase.REQUEST) {
          console.error("[Limelight] beforeSend must return same event type");
          return self.originalFetch(input, modifiedInit);
        }

        requestEvent = modifiedEvent;
      }

      self.sendMessage(requestEvent);

      try {
        const response = await self.originalFetch(input, modifiedInit);
        const clone = response.clone();
        const endTime = Date.now();
        const duration = endTime - startTime;
        const responseHeaders: Record<string, string> = {};

        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        let responseText: string | undefined;

        try {
          responseText = await clone.text();
        } catch (cloneError) {
          responseText = undefined;
        }

        const responseBody = serializeBody(
          responseText,
          self.config?.disableBodyCapture
        );

        let responseEvent: LimelightMessage = {
          id: requestId,
          sessionId: self.getSessionId(),
          timestamp: endTime,
          phase: NetworkPhase.RESPONSE,
          networkType: NetworkType.FETCH,
          status: response.status,
          statusText: response.statusText,
          headers: redactSensitiveHeaders(responseHeaders),
          body: responseBody,
          duration,
          responseSize: responseBody?.size ?? 0,
          redirected: response.redirected,
          ok: response.ok,
        };

        if (self.config?.beforeSend) {
          const modifiedEvent = self.config.beforeSend(responseEvent);

          if (!modifiedEvent) {
            return response;
          }

          if (modifiedEvent.phase !== NetworkPhase.RESPONSE) {
            console.error("[Limelight] beforeSend must return same event type");
            return response;
          }

          responseEvent = modifiedEvent;
        }

        self.sendMessage(responseEvent);
        return response;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorStack = err instanceof Error ? err.stack : undefined;

        let errorEvent: NetworkErrorEvent = {
          id: requestId,
          sessionId: self.getSessionId(),
          timestamp: Date.now(),
          phase: NetworkPhase.ERROR,
          networkType: NetworkType.FETCH,
          errorMessage: errorMessage,
          stack: errorStack,
        };

        if (self.config?.beforeSend) {
          const modifiedEvent = self.config.beforeSend(errorEvent);

          if (modifiedEvent && modifiedEvent.phase === NetworkPhase.ERROR) {
            errorEvent = modifiedEvent;
          }
        }

        self.sendMessage(errorEvent);

        throw err;
      }
    };
  }

  /**
   * Restores the original fetch function and removes all interception.
   * @returns {void}
   */
  cleanup() {
    if (!this.isSetup) {
      console.warn("[Limelight] Network interceptor not set up");
      return;
    }
    this.isSetup = false;

    global.fetch = this.originalFetch;
  }
}
