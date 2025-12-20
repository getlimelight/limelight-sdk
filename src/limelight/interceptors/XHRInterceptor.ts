import {
  LimelightConfig,
  LimelightMessage,
  HttpMethod,
  NetworkErrorEvent,
  NetworkPhase,
  NetworkType,
} from "@/types";
import {
  redactSensitiveHeaders,
  serializeBody,
  formatRequestName,
  getInitiator,
} from "@/helpers";
import { generateRequestId } from "@/protocol";

type XHROpenArgs = Parameters<typeof XMLHttpRequest.prototype.open>;

declare global {
  interface XMLHttpRequest {
    _limelightData?: {
      id: string;
      method: string;
      url: string;
      headers: Record<string, string>;
      startTime: number;
      skipIntercept?: boolean;
      listeners?: Map<string, EventListener>;
    };
  }
}

export class XHRInterceptor {
  private originalXHROpen: typeof XMLHttpRequest.prototype.open;
  private originalXHRSend: typeof XMLHttpRequest.prototype.send;
  private originalXHRSetRequestHeader: typeof XMLHttpRequest.prototype.setRequestHeader;

  private isSetup = false;
  private config: LimelightConfig | null = null;

  constructor(
    private sendMessage: (message: LimelightMessage) => void,
    private getSessionId: () => string
  ) {
    this.originalXHROpen = XMLHttpRequest.prototype.open;
    this.originalXHRSend = XMLHttpRequest.prototype.send;
    this.originalXHRSetRequestHeader =
      XMLHttpRequest.prototype.setRequestHeader;
  }

  /**
   * Sets up XHR interception by wrapping XMLHttpRequest methods.
   * Intercepts open, setRequestHeader, and send to capture network events.
   * Prevents double setup to avoid losing original method references.
   * @param {LimelightConfig} config - Configuration object for Limelight
   * @returns {void}
   */
  setup(config: LimelightConfig) {
    if (this.isSetup) {
      console.warn("[Limelight] XHR interceptor already set up");
      return;
    }
    this.isSetup = true;
    this.config = config;

    const self = this;

    XMLHttpRequest.prototype.open = function (method: string, url: string) {
      this._limelightData = {
        id: generateRequestId(),
        method,
        url,
        headers: {},
        startTime: Date.now(),
        listeners: new Map(),
      };

      return self.originalXHROpen.apply(
        this,
        arguments as unknown as XHROpenArgs
      );
    };

    XMLHttpRequest.prototype.setRequestHeader = function (
      header: string,
      value: string
    ) {
      if (this._limelightData) {
        this._limelightData.headers[header] = value;

        if (
          header.toLowerCase() === "x-limelight-intercepted" &&
          value === "fetch"
        ) {
          this._limelightData.skipIntercept = true;
        }
      }

      return self.originalXHRSetRequestHeader.apply(this, arguments as any);
    };

    XMLHttpRequest.prototype.send = function (body) {
      const data = this._limelightData;

      if (data?.skipIntercept) {
        return self.originalXHRSend.apply(this, arguments as any);
      }

      if (data) {
        const requestBody = serializeBody(
          body,
          self.config?.disableBodyCapture
        );

        let requestEvent: LimelightMessage = {
          id: data.id,
          sessionId: self.getSessionId(),
          timestamp: data.startTime,
          phase: NetworkPhase.REQUEST,
          networkType: NetworkType.XHR,
          url: data.url,
          method: data.method as HttpMethod,
          headers: redactSensitiveHeaders(data.headers),
          body: requestBody,
          name: formatRequestName(data.url),
          initiator: getInitiator(),
          requestSize: requestBody?.size ?? 0,
        };

        if (self.config?.beforeSend) {
          const modifiedEvent = self.config.beforeSend(requestEvent);

          if (!modifiedEvent) {
            return self.originalXHRSend.apply(this, arguments as any);
          }

          if (modifiedEvent.phase !== NetworkPhase.REQUEST) {
            console.error("[Limelight] beforeSend must return same event type");
            return self.originalXHRSend.apply(this, arguments as any);
          }

          requestEvent = modifiedEvent;
        }

        self.sendMessage(requestEvent);

        let responseSent = false;

        /**
         * Removes all event listeners and cleans up after request completion.
         */
        const cleanup = () => {
          if (data.listeners) {
            data.listeners.forEach((listener, event) => {
              this.removeEventListener(event, listener);
            });
            data.listeners.clear();
          }
          // Clear the data to allow GC
          delete this._limelightData;
        };

        /**
         * Sends the response event.
         * Ensures response is only sent once using responseSent flag.
         */
        const sendResponse = () => {
          if (responseSent) return;
          responseSent = true;

          const endTime = Date.now();
          const duration = endTime - data.startTime;
          const responseHeaders = self.parseResponseHeaders(
            this.getAllResponseHeaders()
          );

          const responseBody = serializeBody(
            this.responseText || this.response,
            self.config?.disableBodyCapture
          );

          let responseEvent: LimelightMessage = {
            id: data.id,
            sessionId: self.getSessionId(),
            timestamp: endTime,
            phase: NetworkPhase.RESPONSE,
            networkType: NetworkType.XHR,
            status: this.status,
            statusText: this.statusText,
            headers: redactSensitiveHeaders(responseHeaders),
            body: responseBody,
            duration: duration,
            responseSize: responseBody?.size ?? 0,
            redirected: false,
            ok: this.status >= 200 && this.status < 300,
          };

          if (self.config?.beforeSend) {
            const modifiedEvent = self.config.beforeSend(responseEvent);

            if (!modifiedEvent) {
              return;
            }

            if (modifiedEvent.phase !== NetworkPhase.RESPONSE) {
              console.error(
                "[Limelight] beforeSend must return same event type"
              );
              return;
            }

            responseEvent = modifiedEvent;
          }

          self.sendMessage(responseEvent);
          cleanup.call(this);
        };

        /**
         * Sends an error event.
         * Also sets responseSent to prevent duplicate response events.
         */
        const sendError = (errorMessage: string) => {
          if (responseSent) return;
          responseSent = true;

          let errorEvent: NetworkErrorEvent = {
            id: data.id,
            sessionId: self.getSessionId(),
            timestamp: Date.now(),
            phase: NetworkPhase.ERROR,
            networkType: NetworkType.XHR,
            errorMessage: errorMessage,
          };

          if (self.config?.beforeSend) {
            const modifiedEvent = self.config.beforeSend(errorEvent);

            if (modifiedEvent && modifiedEvent.phase === NetworkPhase.ERROR) {
              errorEvent = modifiedEvent;
            }
          }

          self.sendMessage(errorEvent);
          cleanup.call(this);
        };

        const readyStateChangeHandler = function (this: XMLHttpRequest) {
          if (
            (this.readyState === 3 || this.readyState === 4) &&
            this.status !== 0
          ) {
            sendResponse.call(this);
          }
        };

        const loadHandler = function (this: XMLHttpRequest) {
          sendResponse.call(this);
        };

        const errorHandler = function (this: XMLHttpRequest) {
          sendError("Network request failed");
          cleanup.call(this);
        };

        const abortHandler = function (this: XMLHttpRequest) {
          sendError("Request aborted");
          cleanup.call(this);
        };

        const timeoutHandler = function (this: XMLHttpRequest) {
          sendError("Request timeout");
          cleanup.call(this);
        };

        const loadEndHandler = function (this: XMLHttpRequest) {
          cleanup.call(this);
        };

        this.addEventListener("readystatechange", readyStateChangeHandler);
        this.addEventListener("load", loadHandler);
        this.addEventListener("error", errorHandler);
        this.addEventListener("abort", abortHandler);
        this.addEventListener("timeout", timeoutHandler);
        this.addEventListener("loadend", loadEndHandler);

        data.listeners!.set("readystatechange", readyStateChangeHandler);
        data.listeners!.set("load", loadHandler);
        data.listeners!.set("error", errorHandler);
        data.listeners!.set("abort", abortHandler);
        data.listeners!.set("timeout", timeoutHandler);
        data.listeners!.set("loadend", loadEndHandler);
      }

      return self.originalXHRSend.apply(this, arguments as any);
    };
  }

  /**
   * Parses raw HTTP header string into a key-value object.
   * @private
   * @param {string} headerString - Raw header string from getAllResponseHeaders()
   * @returns {Record<string, string>} Parsed headers object
   */
  private parseResponseHeaders(headerString: string): Record<string, string> {
    const headers: Record<string, string> = {};

    headerString.split("\r\n").forEach((line) => {
      const colonIndex = line.indexOf(": ");
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex);
        const value = line.substring(colonIndex + 2);
        headers[key] = value;
      }
    });

    return headers;
  }

  /**
   * Restores original XMLHttpRequest methods and removes all interception.
   * @returns {void}
   */
  cleanup() {
    if (!this.isSetup) {
      console.warn("[Limelight] XHR interceptor not set up");
      return;
    }
    this.isSetup = false;

    XMLHttpRequest.prototype.open = this.originalXHROpen;
    XMLHttpRequest.prototype.send = this.originalXHRSend;
    XMLHttpRequest.prototype.setRequestHeader =
      this.originalXHRSetRequestHeader;
  }
}
