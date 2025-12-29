# Limelight SDK

> **Chrome DevTools for React Native** - Real-time debugging with GraphQL-first network inspection, console streaming, and intelligent issue detection.

[![npm version](https://img.shields.io/npm/v/@getlimelight/sdk.svg)](https://www.npmjs.com/package/@getlimelight/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

## Features

- 🔍 **Network Inspection** - Capture and analyze all network requests (fetch & XMLHttpRequest)
- 🎯 **GraphQL-First** - Automatic GraphQL operation detection, complexity analysis, and query parsing
- 📊 **Console Streaming** - Real-time console logs with source detection and stack traces
- 🛡️ **Privacy-First** - Automatic redaction of sensitive headers and configurable data filtering
- ⚡ **Zero Config** - Works out of the box with sensible defaults
- 🎨 **Type Safe** - Full TypeScript support with comprehensive type definitions
- 🔌 **Framework Agnostic** - Works with React Native, Expo, and web applications

## Installation

```bash
npm install @getlimelight/sdk
```

```bash
yarn add @getlimelight/sdk
```

```bash
pnpm add @getlimelight/sdk
```

## Quick Start

### Basic Usage

```typescript
import { Limelight } from "@getlimelight/sdk";

// That's it! One line to start debugging
Limelight.connect({ projectKey: "project-123" });
```

### React Native

```typescript
import { Limelight } from "@getlimelight/sdk";

Limelight.connect({ projectKey: "project-123" });
```

### Expo

```typescript
import { Limelight } from "@getlimelight/sdk";
import Constants from "expo-constants";

Limelight.connect({
  projectKey: "project-123",
  enabled: __DEV__,
  appName: Constants.expoConfig?.name,
});
```

## Configuration

### Configuration Options

```typescript
import { Limelight } from '@getlimelight/sdk';

Limelight.connect({
  // The only required field: project Id:
  projectKey: string;

  // Optional: Platform identifier (auto-detected)
  platform?: string;

  // Optional: Custom server URL (defaults to ws://localhost:8080)
  serverUrl?: string;

  // Optional: Your app name
  appName?: string;

  // Optional: Enable/disable the SDK (defaults to true)
  enabled?: boolean;

  // Optional: Enable network request interception (defaults to true)
  enableNetworkInspector?: boolean;

  // Optional: Enable console log capture (defaults to true)
  enableConsole?: boolean;

  // Optional: Enable GraphQL operation detection (defaults to true)
  enableGraphQL?: boolean;

  // Optional: Disable request/response body capture (defaults to false)
  disableBodyCapture?: boolean;

  // Optional: Filter or modify events before sending
  beforeSend?: (event: LimelightMessage) => LimelightMessage | null;
});
```

### Example: Production-Safe Setup

```typescript
import { Limelight } from "@getlimelight/sdk";

Limelight.connect({
  projectKey: "project-123",
  enabled: __DEV__, // Only enable in development
  appName: "MyAwesomeApp",
});
```

### Example: Custom Server URL

```typescript
import { Limelight } from "@getlimelight/sdk";

Limelight.connect({
  projectKey: "project-123",
  serverUrl: "ws://192.168.1.100:8080", // Your computer's IP
  appName: "MyApp",
});
```

### beforeSend Hook

Filter or modify events before they're sent to the server:

```typescript
import { Limelight } from "@getlimelight/sdk";

Limelight.connect({
  beforeSend: (event) => {
    // Filter out specific URLs
    if (event.phase === "NETWORK" && event.url.includes("/analytics")) {
      return null; // Don't send this event
    }

    // Redact sensitive data from console logs
    if (event.phase === "CONSOLE") {
      event.args = event.args.map((arg) =>
        typeof arg === "string"
          ? arg.replace(/password=\w+/g, "password=***")
          : arg
      );
    }

    return event;
  },
});
```

## What Gets Captured

### Network Requests

- ✅ Fetch API requests
- ✅ XMLHttpRequest (XHR)
- ✅ Request/response headers
- ✅ Request/response bodies
- ✅ GraphQL operations (queries, mutations, subscriptions)
- ✅ GraphQL complexity analysis
- ✅ Request timing and duration
- ✅ Error responses

**Automatically Redacted Headers:**

- `authorization`
- `cookie`
- `x-api-key`
- `x-auth-token`
- And more...

### Console Logs

- ✅ All console methods (log, warn, error, info, debug, trace)
- ✅ Stack traces
- ✅ Source detection (app, library, React Native, native)
- ✅ Timestamps
- ✅ Argument serialization (with circular reference handling)

### GraphQL Support

Limelight automatically detects and parses GraphQL operations:

```typescript
// This request will be detected as a GraphQL query
fetch("/graphql", {
  method: "POST",
  body: JSON.stringify({
    query: `
      query GetUser($id: ID!) {
        user(id: $id) {
          name
          email
        }
      }
    `,
    variables: { id: "123" },
  }),
});

// Limelight captures:
// - Operation type (query/mutation/subscription)
// - Operation name (GetUser)
// - Query complexity
// - Variables
// - Response data
```

## API Reference

### Limelight

#### Methods

##### `Limelight.connect(config?: LimelightConfig): void`

Connects to the Limelight server and starts intercepting network requests and console logs.

```typescript
import { Limelight } from "@getlimelight/sdk";

// Minimal usage
Limelight.connect({ projectKey: "project-123" });

// With configuration
Limelight.connect({
  enabled: __DEV__,
  appName: "MyApp",
  projectKey: "project-123",
});
```

##### `Limelight.disconnect(): void`

Disconnects from the Limelight server and stops all interception.

```typescript
Limelight.disconnect();
```

## Event Types

### Network Events

```typescript
interface NetworkEvent {
  id: string;
  phase: "NETWORK_REQUEST" | "NETWORK_RESPONSE";
  type: "NETWORK";
  timestamp: number;
  sessionId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  status?: number;
  duration?: number;
  isGraphQL?: boolean;
  graphQLOperation?: {
    type: "query" | "mutation" | "subscription";
    name: string;
    complexity: number;
  };
}
```

### Console Events

```typescript
interface ConsoleEvent {
  id: string;
  phase: "CONSOLE";
  type: "CONSOLE";
  level: "log" | "warn" | "error" | "info" | "debug" | "trace";
  timestamp: number;
  sessionId: string;
  source: "APP" | "LIBRARY" | "REACT_NATIVE" | "NATIVE";
  args: string[];
  stackTrace?: string;
}
```

## Advanced Usage

### Disable Specific Features

```typescript
import { Limelight } from "@getlimelight/sdk";

Limelight.connect({
  projectKey: "project-123",
  enableNetworkInspector: true, // Capture network requests
  enableConsole: true, // Capture console logs
  enableGraphQL: false, // Disable GraphQL parsing
  disableBodyCapture: false, // Capture request/response bodies
});
```

### Environment-Specific Configuration

```typescript
import { Limelight } from "@getlimelight/sdk";

const getConfig = () => {
  if (process.env.NODE_ENV === "production") {
    return { enabled: false };
  }

  if (process.env.STAGING === "true") {
    return {
      serverUrl: "wss://limelight-staging.yourcompany.com",
      enabled: true,
    };
  }

  return {
    projectKey: "project-123",
    serverUrl: "ws://localhost:8080",
    enabled: true,
  };
};

Limelight.connect(getConfig());
```

### Filtering Sensitive Routes

```typescript
import { Limelight } from "@getlimelight/sdk";

const SENSITIVE_ROUTES = ["/auth", "/payment", "/checkout"];

Limelight.connect({
  beforeSend: (event) => {
    if (event.phase === "NETWORK" || event.phase === "NETWORK_REQUEST") {
      const isSensitive = SENSITIVE_ROUTES.some((route) =>
        event.url.includes(route)
      );

      if (isSensitive) {
        return null; // Don't send sensitive requests
      }
    }

    return event;
  },
});
```

## TypeScript Support

Limelight is written in TypeScript and provides full type definitions:

```typescript
import {
  Limelight,
  LimelightConfig,
  LimelightMessage,
  NetworkEvent,
  ConsoleEvent,
} from "@getlimelight/sdk";

const config: LimelightConfig = {
  enabled: __DEV__,
  appName: "MyApp",
  beforeSend: (event: LimelightMessage) => {
    // Full type safety
    if (event.phase === "NETWORK") {
      console.log(event.url); // TypeScript knows this exists
    }

    return event;
  },
};

Limelight.connect(config);
```

## Performance

Limelight is designed to have minimal performance impact:

- **Non-blocking**: All network interception happens asynchronously
- **Efficient serialization**: Smart stringification with circular reference handling
- **Message queuing**: Buffers messages when disconnected to prevent blocking
- **Configurable depth limits**: Prevents deep object traversal overhead
- **Production safe**: Easy to disable in production builds

## Security & Privacy

### Automatic Redaction

Limelight automatically redacts sensitive headers:

- Authorization tokens
- API keys
- Cookies
- Session tokens

### Custom Filtering

Use the `beforeSend` hook to implement custom privacy rules:

```typescript
import { Limelight } from "@getlimelight/sdk";

Limelight.connect({
  beforeSend: (event) => {
    // Remove PII from request bodies
    if (event.phase === "NETWORK_REQUEST" && event.body) {
      try {
        const body = JSON.parse(event.body);
        delete body.ssn;
        delete body.creditCard;
        event.body = JSON.stringify(body);
      } catch {
        // Not JSON, leave as-is
      }
    }
    return event;
  },
});
```

### Disable Body Capture

For maximum privacy, disable request/response body capture entirely:

```typescript
Limelight.connect({
  projectKey: "project-123",
  disableBodyCapture: true, // Only capture headers and metadata
});
```

## Troubleshooting

### Connection Issues

If you're having trouble connecting:

1. **Check your server is running** - Make sure the Limelight server is running on the specified port
2. **Verify the URL** - Default is `ws://localhost:8080`, but you may need your computer's IP address for physical devices
3. **Enable in config** - Ensure `enabled: true` (or omit it, as it defaults to true)

```typescript
import { Limelight } from "@getlimelight/sdk";

// For physical devices, use your computer's IP
Limelight.connect({
  projectKey: "project-123",
  serverUrl: "ws://192.168.1.100:8080", // Replace with your IP
  enabled: true,
});
```

### Not Seeing Network Requests

1. Make sure `enableNetworkInspector` is not set to `false`
2. Ensure `Limelight.connect()` is called early in your app
3. Check if `beforeSend` is filtering out requests

### Console Logs Not Appearing

1. Ensure `enableConsole` is not set to `false`
2. Verify `Limelight.connect()` is called before logs occur
3. Check the WebSocket connection is established

## Examples

See the `/examples` directory for complete working examples:

- Basic React Native app
- Expo app with environment configuration
- Next.js web application
- Custom filtering and privacy controls

## License

MIT © LIMELIGHT

## Support

- 📧 Email: hello@getlimelight.io
- 🐛 Issues: [GitHub Issues](https://github.com/getlimelight/limelight/issues)

---

Built with ❤️ for React Native developers
