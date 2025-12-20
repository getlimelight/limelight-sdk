/**
 * Constants used throughout the Limelight application.
 */
export const SENSITIVE_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "api-key",
  "apikey",
  "proxy-authorization",
  "x-csrf-token",
  "x-xsrf-token",
  "x-auth",
  "auth-token",
  "access-token",
  "secret",
  "x-secret",
  "bearer",
];

/**
 * The current protocol version used by Limelight.
 */
export const PROTOCOL_VERSION = "0.1.0";

/**
 * Default port number for the Limelight WebSocket server.
 */
export const DEFAULT_PORT = 9090;

/**
 * The WebSocket path for Limelight connections.
 */
export const WS_PATH = "/limelight";
