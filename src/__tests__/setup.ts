// __tests__/setup.ts
import { beforeEach, afterEach, vi } from "vitest";

// Reset all mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});

// Clean up global state
afterEach(() => {
  vi.restoreAllMocks();
});
