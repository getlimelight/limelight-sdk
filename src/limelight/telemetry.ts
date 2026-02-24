import {
  POSTHOG_API_KEY,
  POSTHOG_HOST,
  SDK_VERSION,
  STORAGE_KEY,
} from "@/constants";
import { hasDOM, isServer } from "@/helpers";

let anonymousId: string | null = null;
let enabled = false;
let framework = "unknown";

/**
 * Detects the framework being used by the host application.
 * Checks for React Native, Next.js (server and client), React web, and Node.js.
 * @returns string - The detected framework name.
 */
const detectFramework = (): string => {
  try {
    if (typeof navigator !== "undefined" && "ReactNative" in navigator)
      return "react-native";

    if (
      typeof process !== "undefined" &&
      (process.env?.__NEXT_RUNTIME__ || process.env?.NEXT_RUNTIME)
    )
      return "next";

    if (typeof window !== "undefined" && (window as any).__NEXT_DATA__)
      return "next";

    if (hasDOM()) return "react";

    if (isServer()) return "node";
  } catch {
    // Ignore detection failures
  }

  return "unknown";
};

/**
 * Generates a random UUID v4 string for use as an anonymous device identifier.
 * @returns string - A random UUID v4 string.
 */
const generateId = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

/**
 * Retrieves or creates a persistent anonymous device ID.
 * Tries localStorage (browser), then the file system (Node.js), then falls back to in-memory.
 * The ID is never tied to any user identity.
 * @returns string - The anonymous device ID.
 */
const getOrCreateAnonymousId = (): string => {
  if (anonymousId) return anonymousId;

  try {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY);

      if (stored) {
        anonymousId = stored;
        return anonymousId;
      }

      anonymousId = generateId();
      localStorage.setItem(STORAGE_KEY, anonymousId);
      return anonymousId;
    }
  } catch {
    // localStorage not available or blocked
  }

  try {
    const _require = globalThis["require"] as typeof require;

    if (_require) {
      const fs = _require("fs");
      const os = _require("os");
      const path = _require("path");
      const filePath = path.join(os.homedir(), ".limelight_telemetry_id");

      try {
        anonymousId = fs.readFileSync(filePath, "utf-8").trim();

        if (anonymousId) return anonymousId;
      } catch {
        // File doesn't exist yet
      }

      anonymousId = generateId();
      fs.writeFileSync(filePath, anonymousId, "utf-8");

      return anonymousId;
    }
  } catch {
    // Not in Node.js or fs not available
  }

  anonymousId = generateId();
  return anonymousId;
};

/**
 * Sends a single event to PostHog's capture API.
 * Fire-and-forget — errors are silently ignored so telemetry never affects SDK behavior.
 * @param string event - The event name to capture.
 * @param Record<string, unknown> properties - Additional properties to include with the event.
 */
const capture = (event: string, properties: Record<string, unknown> = {}) => {
  if (!enabled) return;

  try {
    const payload = {
      api_key: POSTHOG_API_KEY,
      event,
      distinct_id: getOrCreateAnonymousId(),
      properties: {
        ...properties,
        sdk_version: SDK_VERSION,
        framework,
      },
    };

    fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    // Silently ignore telemetry failures
  }
};

/**
 * The telemetry module for Limelight SDK. Provides methods to initialize telemetry, track session start/end, timeline generation, and shutdown.
 */
export const telemetry = {
  init(telemetryEnabled: boolean) {
    enabled = telemetryEnabled;

    if (!enabled) return;

    framework = detectFramework();

    capture("sdk_initialized", {
      framework,
      device_id: getOrCreateAnonymousId(),
    });
  },

  sessionStarted() {
    capture("sdk_session_started");
  },

  sessionEnded(durationSeconds: number, eventCount: number) {
    capture("sdk_session_ended", {
      duration_seconds: durationSeconds,
      event_count: eventCount,
    });
  },

  timelineGenerated(eventsCorrelated: number) {
    capture("sdk_timeline_generated", {
      events_correlated: eventsCorrelated,
      framework,
    });
  },

  shutdown() {
    enabled = false;
    anonymousId = null;
  },
};
