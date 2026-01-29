# Limelight SDK

> **Chrome DevTools for React Native** - Real-time debugging with state inspection, network monitoring, console streaming, and render tracking.

[![npm version](https://img.shields.io/npm/v/@getlimelight/sdk.svg)](https://www.npmjs.com/package/@getlimelight/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)](https://www.typescriptlang.org/)

## Documentation

📚 **Full documentation at [docs.getlimelight.io](https://docs.getlimelight.io)**

## Features

- 🔮 **State Inspection** - Debug Zustand and Redux stores in real-time
- 🔍 **Network Monitoring** - Inspect all HTTP requests with GraphQL-first support
- 📊 **Console Streaming** - View logs with stack traces and source detection
- ⚡ **Render Tracking** - Find why components re-render
- 🛡️ **Privacy-First** - Automatic redaction of sensitive data
- 🎨 **Zero Config** - Works out of the box

## Installation

```bash
npm install @getlimelight/sdk
```

## Quick Start

### Desktop App

```typescript
import { Limelight } from "@getlimelight/sdk";

Limelight.connect();
```

### Web App (with project key)

```typescript
import { Limelight } from "@getlimelight/sdk";

Limelight.connect({
  projectKey: "your-project-key",
});
```

### With State Inspection

```typescript
import { Limelight } from "@getlimelight/sdk";
import { useUserStore } from "./stores/user";
import { useCartStore } from "./stores/cart";

Limelight.connect({
  stores: {
    user: useUserStore,
    cart: useCartStore,
  },
});
```

Works with **Zustand** and **Redux** out of the box.

## Configuration

```typescript
Limelight.connect({
  // Connect to web app (optional for desktop)
  projectKey: "your-project-key",

  // State stores to inspect
  stores: {
    user: useUserStore,
    cart: useCartStore,
  },

  // Feature flags (all default to true)
  enabled: __DEV__,
  enableNetworkInspector: true,
  enableConsole: true,
  enableStateInspector: true,
  enableRenderInspector: true,

  // Filter or modify events
  beforeSend: (event) => {
    // Return null to filter out, or modify and return
    return event;
  },
});
```

## Learn More

- [Quick Start Guide](https://docs.getlimelight.io/quickstart)
- [State Inspection](https://docs.getlimelight.io/features/state)
- [Network Monitoring](https://docs.getlimelight.io/features/network)
- [Console Streaming](https://docs.getlimelight.io/features/console)
- [Render Tracking](https://docs.getlimelight.io/features/renders)
- [Configuration Reference](https://docs.getlimelight.io/configuration)

## License

MIT © Limelight

---

[Documentation](https://docs.getlimelight.io) · [GitHub](https://github.com/getlimelight/limelight) · [Issues](https://github.com/getlimelight/limelight/issues)
