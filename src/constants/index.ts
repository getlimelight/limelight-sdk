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
 * The WebSocket URL for Limelight web app connections.
 */
export const LIMELIGHT_WEB_WSS_URL = "wss://api.getlimelight.io";

/**
 * The WebSocket URL for Limelight desktop app connections.
 */
export const LIMELIGHT_DESKTOP_WSS_URL = "ws://localhost:8484";

/**
 * The current protocol version used by Limelight.
 */
export const PROTOCOL_VERSION = "0.1.0";

/**
 * The WebSocket path for Limelight connections.
 */
export const WS_PATH = "/limelight";

/**
 * The current SDK version of Limelight.
 */
declare const __SDK_VERSION__: string;
export const SDK_VERSION =
  typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "test-version";

/**
 * Thresholds for suspicious render detection.
 */
export const RENDER_THRESHOLDS = {
  HOT_VELOCITY: 5,
  HIGH_RENDER_COUNT: 50,
  VELOCITY_WINDOW_MS: 2000,
  SNAPSHOT_INTERVAL_MS: 1000,
  MIN_DELTA_TO_EMIT: 1,
  MAX_PROP_KEYS_TO_TRACK: 20, // Don't track more than this many unique props
  MAX_PROP_CHANGES_PER_SNAPSHOT: 10, // Limit delta array size
  TOP_PROPS_TO_REPORT: 5, // Only report top N changed props
} as const;
